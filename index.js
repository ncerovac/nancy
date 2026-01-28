const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const CONFIG = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  checkInterval: 60 * 60 * 1000,
  dataFile: path.join(__dirname, 'data.json'),
};

// ==================== STATE ====================
let state = { subscribers: [], seen: [], lastCheck: null };
let botInfo = null;
let lastUpdateId = 0;
let polling = false;

// ==================== DATA SOURCES ====================
const SOURCES = [
  {
    name: 'Quiver Quant',
    url: 'https://api.quiverquant.com/beta/live/congresstrading',
    parse: data => data.map(t => ({
      id: `${t.Representative}-${t.Ticker}-${t.TransactionDate}`,
      name: t.Representative,
      party: t.Party === 'D' ? 'Democrat' : t.Party === 'R' ? 'Republican' : t.Party,
      state: t.District?.slice(0, 2) || '',
      chamber: t.House === 'Representatives' ? 'house' : 'senate',
      ticker: t.Ticker,
      company: t.Description || t.Ticker,
      type: t.Transaction,
      date: t.TransactionDate,
      value: parseValue(t.Range),
    }))
  },
  {
    name: 'House Stock Watcher',
    url: 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json',
    parse: data => data.slice(0, 200).map(t => ({
      id: `${t.representative}-${t.ticker}-${t.transaction_date}`,
      name: t.representative,
      party: t.party || '',
      state: t.state || t.district || '',
      chamber: 'house',
      ticker: t.ticker,
      company: t.asset_description || '',
      type: t.type || t.transaction_type,
      date: t.transaction_date,
      value: t.amount,
    }))
  },
  {
    name: 'Senate Stock Watcher',
    url: 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json',
    parse: data => data.slice(0, 200).map(t => ({
      id: `${t.senator}-${t.ticker}-${t.transaction_date}`,
      name: t.senator,
      party: t.party || '',
      state: t.state || '',
      chamber: 'senate',
      ticker: t.ticker,
      company: t.asset_description || '',
      type: t.type || t.transaction_type,
      date: t.transaction_date,
      value: t.amount,
    }))
  }
];

// ==================== HELPERS ====================
const parseValue = str => str?.match(/\$?([\d,]+)/)?.[1]?.replace(/,/g, '') * 1 || null;
const isGroup = id => id < 0;
const delay = ms => new Promise(r => setTimeout(r, ms));
const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

function load() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      state = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
      log(`📂 Loaded ${state.subscribers.length} subscribers`);
    }
  } catch (e) { log('Load error:', e.message); }
}

function save() {
  state.seen = state.seen.slice(-2000);
  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(state));
}

// ==================== TELEGRAM ====================
async function tg(method, params = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
    return data;
  } catch (e) {
    if (!e.message?.includes('Conflict')) log(`TG ${method}:`, e.message);
    return null;
  }
}

const send = (chatId, text) => tg('sendMessage', { 
  chat_id: chatId, 
  text, 
  parse_mode: 'HTML', 
  disable_web_page_preview: true 
});

// ==================== DATA FETCHING ====================
async function fetchTrades(limit = 100, days = null) {
  for (const src of SOURCES) {
    try {
      log(`Trying ${src.name}...`);
      const res = await fetch(src.url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) continue;
      
      let trades = src.parse(await res.json());
      if (days) {
        const cutoff = Date.now() - days * 86400000;
        trades = trades.filter(t => new Date(t.date) >= cutoff);
      }
      log(`✅ ${src.name}: ${trades.length} trades`);
      return trades.slice(0, limit);
    } catch (e) { log(`${src.name}:`, e.message); }
  }
  return [];
}

// ==================== FORMATTING ====================
function fmt(t, i = 0) {
  const type = (t.type || '').toLowerCase();
  const emoji = /buy|purchase/.test(type) ? '🟢' : /sell|sale/.test(type) ? '🔴' : '⚪';
  const party = t.party === 'Democrat' ? 'Dem' : t.party === 'Republican' ? 'Rep' : t.party;
  const loc = [party, t.state].filter(Boolean).join(', ');
  const chamber = t.chamber === 'senate' ? '🏛️' : '🏠';
  const ticker = t.ticker && t.ticker !== 'N/A' 
    ? `<a href="https://finance.yahoo.com/quote/${t.ticker}">${t.ticker}</a>` + (t.company && t.company !== t.ticker ? ` — ${t.company}` : '')
    : t.company || 'Unknown';
  const value = t.value ? `$${Number(t.value).toLocaleString()}` : 'N/A';
  
  return `${i ? `<b>${i}.</b> ` : ''}${emoji} <b>${ticker}</b>
   📋 ${type.toUpperCase() || 'TRADE'}
   👤 ${t.name} ${loc ? `(${loc})` : ''} ${chamber}
   💰 ${value} | 📅 ${t.date || 'N/A'}`;
}

function fmtCompact(t) {
  const type = (t.type || '').slice(0, 4).toUpperCase();
  const emoji = /BUY|PURC/.test(type) ? '🟢' : '🔴';
  return `${emoji} ${t.ticker} | ${t.name} | ${type}`;
}

// ==================== COMMANDS ====================
const COMMANDS = {
  async start(chatId, { username, title }) {
    if (!state.subscribers.includes(chatId)) {
      state.subscribers.push(chatId);
      save();
      log(`✅ New: ${chatId} ${title ? `(${title})` : `@${username}`}`);
    }
    const group = isGroup(chatId);
    await send(chatId, `🏛️ <b>Congressional Trade Alerts</b>

${group ? '📢 <b>Group alerts enabled!</b>\n\n' : ''}Track stock trades by U.S. Congress members in real-time.

<b>📌 WHY IT MATTERS</b>
Congress must disclose trades within 45 days. Studies show they often outperform the market.

<b>📊 COMMANDS</b>
/latest • /today • /week • /month
/politicians • /tickers • /search
/top • /stats • /help

${group ? '━━━━━━━━━━━━━━━━━━━━━\n💡 All members will receive alerts.' : '━━━━━━━━━━━━━━━━━━━━━\n💡 Try /politicians to see who\'s trading!'}`);
  },

  async stop(chatId) {
    state.subscribers = state.subscribers.filter(id => id !== chatId);
    save();
    await send(chatId, `🛑 <b>Unsubscribed</b>\n\nUse /start to resubscribe.`);
  },

  async latest(chatId) {
    await send(chatId, '⏳ Loading...');
    const trades = await fetchTrades(10);
    if (!trades.length) return send(chatId, '❌ Could not fetch trades.');
    await send(chatId, `📊 <b>Latest Trades</b>\n\n${trades.map((t, i) => fmt(t, i + 1)).join('\n\n')}`);
  },

  async today(chatId) {
    await send(chatId, '⏳ Loading...');
    const trades = await fetchTrades(100, 1);
    if (!trades.length) return send(chatId, '📭 No trades in last 24h.');
    await send(chatId, `📅 <b>Last 24 Hours</b> (${trades.length})\n\n${trades.slice(0, 15).map((t, i) => fmt(t, i + 1)).join('\n\n')}${trades.length > 15 ? `\n\n<i>+${trades.length - 15} more</i>` : ''}`);
  },

  async week(chatId) {
    await send(chatId, '⏳ Loading...');
    const trades = await fetchTrades(200, 7);
    if (!trades.length) return send(chatId, '📭 No trades in last 7 days.');
    
    const byDay = trades.reduce((acc, t) => {
      const day = t.date?.slice(0, 10) || 'Unknown';
      (acc[day] = acc[day] || []).push(t);
      return acc;
    }, {});
    
    let msg = `📆 <b>Last 7 Days</b> (${trades.length} trades)\n\n`;
    Object.keys(byDay).sort().reverse().slice(0, 7).forEach(day => {
      msg += `<b>📅 ${day}</b> (${byDay[day].length})\n`;
      byDay[day].slice(0, 5).forEach(t => msg += `  ${fmtCompact(t)}\n`);
      if (byDay[day].length > 5) msg += `  <i>+${byDay[day].length - 5} more</i>\n`;
      msg += '\n';
    });
    await send(chatId, msg);
  },

  async month(chatId) {
    await send(chatId, '⏳ Loading...');
    const trades = await fetchTrades(500, 30);
    if (!trades.length) return send(chatId, '📭 No trades in last 30 days.');
    
    const buys = trades.filter(t => /buy|purchase/i.test(t.type)).length;
    const sells = trades.length - buys;
    const tickers = Object.entries(trades.reduce((a, t) => (a[t.ticker] = (a[t.ticker] || 0) + 1, a), {}))
      .sort((a, b) => b[1] - a[1]).slice(0, 5);
    
    await send(chatId, `🗓️ <b>Last 30 Days</b>

📊 ${trades.length} trades | 🟢 ${buys} buys | 🔴 ${sells} sells
📈 Ratio: ${(buys / (sells || 1)).toFixed(2)}

<b>Top Tickers:</b>
${tickers.map(([t, c], i) => `${i + 1}. <b>${t}</b> — ${c}`).join('\n')}

<b>Recent:</b>\n\n${trades.slice(0, 8).map((t, i) => fmt(t, i + 1)).join('\n\n')}`);
  },

  async top(chatId) {
    await send(chatId, '⏳ Loading...');
    const trades = await fetchTrades(500, 30);
    if (!trades.length) return send(chatId, '❌ Could not fetch data.');
    
    const traders = trades.reduce((a, t) => {
      a[t.name] = a[t.name] || { count: 0, party: t.party };
      a[t.name].count++;
      return a;
    }, {});
    
    const top = Object.entries(traders).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];
    
    await send(chatId, `🏆 <b>Most Active (30 Days)</b>\n\n${top.map(([name, { count, party }], i) => 
      `${medals[i] || `${i + 1}.`} <b>${name}</b> (${party === 'Democrat' ? 'Dem' : party === 'Republican' ? 'Rep' : party})\n   ${count} trades`
    ).join('\n\n')}\n\n💡 Use /search [name] to see their trades`);
  },

  async politicians(chatId) {
    await send(chatId, '⏳ Loading...');
    const trades = await fetchTrades(500, 90);
    if (!trades.length) return send(chatId, '❌ Could not fetch data.');
    
    const pols = trades.reduce((a, t) => {
      a[t.name] = a[t.name] || { party: t.party, state: t.state, count: 0 };
      a[t.name].count++;
      return a;
    }, {});
    
    const sorted = Object.entries(pols).sort((a, b) => b[1].count - a[1].count);
    const dems = sorted.filter(([, p]) => p.party === 'Democrat');
    const reps = sorted.filter(([, p]) => p.party === 'Republican');
    
    await send(chatId, `👥 <b>Active Politicians (90 Days)</b>

🔵 <b>Democrats (${dems.length})</b>
${dems.slice(0, 12).map(([n, p]) => `• ${n}${p.state ? ` (${p.state})` : ''} — ${p.count}`).join('\n')}
${dems.length > 12 ? `<i>+${dems.length - 12} more</i>` : ''}

🔴 <b>Republicans (${reps.length})</b>
${reps.slice(0, 12).map(([n, p]) => `• ${n}${p.state ? ` (${p.state})` : ''} — ${p.count}`).join('\n')}
${reps.length > 12 ? `<i>+${reps.length - 12} more</i>` : ''}

💡 /search [name] to see trades`);
  },

  async tickers(chatId) {
    await send(chatId, '⏳ Loading...');
    const trades = await fetchTrades(500, 30);
    if (!trades.length) return send(chatId, '❌ Could not fetch data.');
    
    const tickers = trades.reduce((a, t) => {
      if (!t.ticker || t.ticker === 'N/A') return a;
      a[t.ticker] = a[t.ticker] || { company: t.company, buys: 0, sells: 0 };
      /buy|purchase/i.test(t.type) ? a[t.ticker].buys++ : a[t.ticker].sells++;
      return a;
    }, {});
    
    const sorted = Object.entries(tickers)
      .map(([t, d]) => ({ t, ...d, total: d.buys + d.sells }))
      .sort((a, b) => b.total - a.total).slice(0, 20);
    
    await send(chatId, `📈 <b>Top Stocks (30 Days)</b>\n\n${sorted.map((s, i) => {
      const trend = s.buys > s.sells ? '🟢' : s.sells > s.buys ? '🔴' : '⚪';
      return `<b>${i + 1}. ${s.t}</b> ${trend}\n   ${s.company?.slice(0, 30) || ''}\n   ${s.total} trades (${s.buys}↑ ${s.sells}↓)`;
    }).join('\n\n')}\n\n💡 /search [ticker] to see trades`);
  },

  async search(chatId, query) {
    if (!query || query.length < 2) {
      return send(chatId, `🔍 <b>Search Trades</b>

/search [name or ticker]

<b>Examples:</b>
• /search Pelosi
• /search NVDA
• /search Tesla

💡 Use /politicians or /tickers to browse`);
    }
    
    await send(chatId, `🔍 Searching "${query}"...`);
    const trades = await fetchTrades(500);
    const q = query.toLowerCase();
    const results = trades.filter(t => 
      t.name?.toLowerCase().includes(q) || 
      t.ticker?.toLowerCase().includes(q) || 
      t.company?.toLowerCase().includes(q)
    ).slice(0, 10);
    
    if (!results.length) return send(chatId, `❌ No results for "${query}"`);
    await send(chatId, `🔍 <b>Results: "${query}"</b>\n\n${results.map((t, i) => fmt(t, i + 1)).join('\n\n')}`);
  },

  async stats(chatId) {
    await send(chatId, '⏳ Loading...');
    const trades = await fetchTrades(500, 30);
    if (!trades.length) return send(chatId, '❌ Could not fetch data.');
    
    const buys = trades.filter(t => /buy|purchase/i.test(t.type)).length;
    const sells = trades.length - buys;
    const dems = trades.filter(t => t.party === 'Democrat').length;
    const reps = trades.filter(t => t.party === 'Republican').length;
    const tech = ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'AMD', 'INTC'];
    const techCount = trades.filter(t => tech.includes(t.ticker)).length;
    const ratio = (buys / (sells || 1)).toFixed(2);
    const sentiment = ratio > 1.2 ? '📈 Bullish' : ratio < 0.8 ? '📉 Bearish' : '➡️ Neutral';
    const value = trades.reduce((a, t) => a + (Number(t.value) || 0), 0);
    
    await send(chatId, `📊 <b>Trading Statistics (30 Days)</b>

<b>Activity</b>
• Trades: ${trades.length}
• Est. Value: $${(value / 1e6).toFixed(1)}M+
• Politicians: ${new Set(trades.map(t => t.name)).size}

<b>Sentiment</b>
• 🟢 Buys: ${buys} | 🔴 Sells: ${sells}
• Ratio: ${ratio} ${sentiment}

<b>Party</b>
• 🔵 Dem: ${dems} | 🔴 Rep: ${reps}

<b>Sectors</b>
• Tech: ${techCount} (${((techCount / trades.length) * 100).toFixed(0)}%)

━━━━━━━━━━━━━━━━━━━━━
💡 Congressional portfolios historically beat the S&P 500`);
  },

  async help(chatId) {
    const group = isGroup(chatId);
    await send(chatId, `📖 <b>Help Guide</b>

<b>🔔 ALERTS</b>
/start — Subscribe
/stop — Unsubscribe
Alerts sent hourly when new trades found.

<b>📊 VIEW TRADES</b>
/latest — Last 10 trades
/today — Last 24 hours
/week — Last 7 days
/month — Last 30 days + stats

<b>🔍 RESEARCH</b>
/politicians — Browse active traders
/tickers — Browse traded stocks
/search [query] — Find trades
/top — Most active traders

<b>📈 ANALYSIS</b>
/stats — Buy/sell ratios, trends

<b>💡 TIPS</b>
• Disclosures delayed up to 45 days
• Large trades ($1M+) most significant
• Watch activity before major votes

${group ? '\n<b>👥 GROUP</b>\nAlerts go to all members.' : ''}`);
  }
};

// ==================== POLLING ====================
async function poll() {
  if (polling) return;
  polling = true;
  
  try {
    const res = await tg('getUpdates', { offset: lastUpdateId + 1, timeout: 30, allowed_updates: ['message'] });
    for (const u of res?.result || []) {
      lastUpdateId = u.update_id;
      await processUpdate(u);
    }
  } catch (e) {
    if (e.message?.includes('Conflict')) await tg('deleteWebhook', { drop_pending_updates: true });
  }
  
  polling = false;
}

async function processUpdate(u) {
  try {
    const msg = u.message;
    if (!msg) return;
    
    // Bot added to group
    if (msg.new_chat_members?.some(m => m.id === botInfo?.id)) {
      log(`🎉 Added to: ${msg.chat.title}`);
      return COMMANDS.start(msg.chat.id, { title: msg.chat.title });
    }
    
    if (!msg.text) return;
    
    const chatId = msg.chat.id;
    const [cmd, ...args] = msg.text.split(' ');
    const command = cmd.toLowerCase().split('@')[0].slice(1);
    
    log(`📨 ${msg.chat.title || '@' + msg.from?.username}: /${command}`);
    
    if (COMMANDS[command]) {
      await COMMANDS[command](chatId, args.join(' ') || { username: msg.from?.username, title: msg.chat.title });
    } else if (cmd.startsWith('/') && msg.chat.type === 'private') {
      await send(chatId, '❓ Unknown command. Try /help');
    }
  } catch (e) { log('Update error:', e.message); }
}

// ==================== AUTO ALERTS ====================
async function checkAlerts() {
  log('Checking for new trades...');
  const trades = await fetchTrades(50);
  if (!trades.length) return log('No trades fetched.');
  
  const newTrades = trades.filter(t => !state.seen.includes(t.id));
  newTrades.forEach(t => state.seen.push(t.id));
  
  if (newTrades.length && state.subscribers.length) {
    log(`📢 Alerting ${state.subscribers.length} subs about ${newTrades.length} trades`);
    for (const t of newTrades.slice(0, 5)) {
      const msg = `🚨 <b>New Trade</b>\n\n${fmt(t)}`;
      for (const id of state.subscribers) {
        await send(id, msg);
        await delay(50);
      }
      await delay(300);
    }
  }
  
  state.lastCheck = new Date().toISOString();
  save();
}

// ==================== MAIN ====================
async function main() {
  console.log('\n🏛️ Congressional Trade Bot v3.0\n');
  
  if (!CONFIG.token) {
    console.error('❌ TELEGRAM_BOT_TOKEN required');
    process.exit(1);
  }
  
  load();
  await tg('deleteWebhook', { drop_pending_updates: true });
  
  await tg('setMyCommands', {
    commands: Object.keys(COMMANDS).map(c => ({ 
      command: c, 
      description: { start: '🚀 Subscribe', stop: '🛑 Unsubscribe', latest: '📊 Latest trades', today: '📅 Last 24h', week: '📆 Last 7 days', month: '🗓️ Last 30 days', politicians: '👥 Politicians', tickers: '📈 Stocks', search: '🔍 Search', top: '🏆 Top traders', stats: '📊 Statistics', help: '❓ Help' }[c] 
    }))
  });
  
  const me = await tg('getMe');
  botInfo = me?.result;
  log(`✅ @${botInfo?.username}`);
  
  setInterval(poll, 2000);
  await checkAlerts();
  setInterval(checkAlerts, CONFIG.checkInterval);
  
  log('🚀 Running!\n');
  
  process.on('SIGTERM', () => { save(); process.exit(0); });
  process.on('SIGINT', () => { save(); process.exit(0); });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
