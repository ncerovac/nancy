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

// Common ticker to company name lookup (for when API doesn't provide it)
const TICKER_NAMES = {
  AAPL: 'Apple Inc', MSFT: 'Microsoft Corp', GOOGL: 'Alphabet Inc', GOOG: 'Alphabet Inc',
  AMZN: 'Amazon.com Inc', META: 'Meta Platforms', NVDA: 'NVIDIA Corp', TSLA: 'Tesla Inc',
  AMD: 'Advanced Micro Devices', INTC: 'Intel Corp', CRM: 'Salesforce Inc', ORCL: 'Oracle Corp',
  NFLX: 'Netflix Inc', DIS: 'Walt Disney Co', PYPL: 'PayPal Holdings', ADBE: 'Adobe Inc',
  CSCO: 'Cisco Systems', AVGO: 'Broadcom Inc', TXN: 'Texas Instruments', QCOM: 'Qualcomm Inc',
  IBM: 'IBM Corp', NOW: 'ServiceNow Inc', UBER: 'Uber Technologies', ABNB: 'Airbnb Inc',
  SQ: 'Block Inc', SHOP: 'Shopify Inc', SNOW: 'Snowflake Inc', PLTR: 'Palantir Technologies',
  JPM: 'JPMorgan Chase', BAC: 'Bank of America', WFC: 'Wells Fargo', C: 'Citigroup',
  GS: 'Goldman Sachs', MS: 'Morgan Stanley', BLK: 'BlackRock Inc', SCHW: 'Charles Schwab',
  V: 'Visa Inc', MA: 'Mastercard Inc', AXP: 'American Express', COF: 'Capital One',
  JNJ: 'Johnson & Johnson', PFE: 'Pfizer Inc', UNH: 'UnitedHealth Group', MRK: 'Merck & Co',
  ABBV: 'AbbVie Inc', LLY: 'Eli Lilly', BMY: 'Bristol-Myers Squibb', AMGN: 'Amgen Inc',
  XOM: 'Exxon Mobil', CVX: 'Chevron Corp', COP: 'ConocoPhillips', SLB: 'Schlumberger',
  WMT: 'Walmart Inc', COST: 'Costco Wholesale', TGT: 'Target Corp', HD: 'Home Depot',
  LOW: 'Lowe\'s Companies', MCD: 'McDonald\'s Corp', SBUX: 'Starbucks Corp', NKE: 'Nike Inc',
  KO: 'Coca-Cola Co', PEP: 'PepsiCo Inc', PM: 'Philip Morris', MO: 'Altria Group',
  PG: 'Procter & Gamble', CL: 'Colgate-Palmolive', KMB: 'Kimberly-Clark', EL: 'Estée Lauder',
  BA: 'Boeing Co', LMT: 'Lockheed Martin', RTX: 'Raytheon Technologies', GD: 'General Dynamics',
  NOC: 'Northrop Grumman', CAT: 'Caterpillar Inc', DE: 'Deere & Company', MMM: '3M Company',
  GE: 'General Electric', HON: 'Honeywell International', UPS: 'United Parcel Service', FDX: 'FedEx Corp',
  T: 'AT&T Inc', VZ: 'Verizon Communications', TMUS: 'T-Mobile US', CMCSA: 'Comcast Corp',
  NEE: 'NextEra Energy', DUK: 'Duke Energy', SO: 'Southern Company', D: 'Dominion Energy',
  AMT: 'American Tower', PLD: 'Prologis Inc', SPG: 'Simon Property Group', EQIX: 'Equinix Inc',
  INTU: 'Intuit Inc', ADP: 'Automatic Data Processing', PAYX: 'Paychex Inc', FISV: 'Fiserv Inc',
  AMAT: 'Applied Materials', LRCX: 'Lam Research', KLAC: 'KLA Corp', MU: 'Micron Technology',
  IQV: 'IQVIA Holdings', ZTS: 'Zoetis Inc', REGN: 'Regeneron Pharmaceuticals', VRTX: 'Vertex Pharmaceuticals',
  F: 'Ford Motor Co', GM: 'General Motors', RIVN: 'Rivian Automotive', LCID: 'Lucid Group',
  AAL: 'American Airlines', DAL: 'Delta Air Lines', UAL: 'United Airlines', LUV: 'Southwest Airlines',
  SPY: 'SPDR S&P 500 ETF', QQQ: 'Invesco QQQ Trust', IWM: 'iShares Russell 2000', DIA: 'SPDR Dow Jones',
  VTI: 'Vanguard Total Stock', VOO: 'Vanguard S&P 500', BND: 'Vanguard Total Bond', GLD: 'SPDR Gold Shares',
};

const getCompanyName = (ticker, description) => {
  if (description && description !== ticker && description.length > 2) return description;
  return TICKER_NAMES[ticker] || '';
};

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
      company: getCompanyName(t.Ticker, t.Description),
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
      company: getCompanyName(t.ticker, t.asset_description),
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
      company: getCompanyName(t.ticker, t.asset_description),
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

// Sanitize HTML to prevent XSS
const escapeHtml = str => String(str || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Sanitize for URL params
const sanitizeQuery = str => String(str || '')
  .replace(/[<>\"\'&]/g, '')
  .slice(0, 100); // Limit length

function load() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const raw = fs.readFileSync(CONFIG.dataFile, 'utf8');
      const data = JSON.parse(raw);
      
      // Validate loaded data structure
      state = {
        subscribers: Array.isArray(data.subscribers) 
          ? data.subscribers.filter(id => typeof id === 'number') 
          : [],
        seen: Array.isArray(data.seen) 
          ? data.seen.filter(id => typeof id === 'string').slice(-2000)
          : [],
        lastCheck: typeof data.lastCheck === 'string' ? data.lastCheck : null
      };
      
      log(`📂 Loaded ${state.subscribers.length} subscribers`);
    }
  } catch (e) { 
    log('Load error:', e.message);
    // Don't overwrite potentially corrupted file, start fresh in memory
    state = { subscribers: [], seen: [], lastCheck: null };
  }
}

function save() {
  try {
    state.seen = state.seen.slice(-2000);
    const data = JSON.stringify(state);
    // Write to temp file first, then rename (atomic write)
    const tempFile = CONFIG.dataFile + '.tmp';
    fs.writeFileSync(tempFile, data);
    fs.renameSync(tempFile, CONFIG.dataFile);
  } catch (e) {
    log('Save error:', e.message);
  }
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
  const party = t.party === 'Democrat' ? 'Dem' : t.party === 'Republican' ? 'Rep' : escapeHtml(t.party);
  const loc = [party, escapeHtml(t.state)].filter(Boolean).join(', ');
  const chamber = t.chamber === 'senate' ? '🏛️' : '🏠';
  const value = t.value ? `$${Number(t.value).toLocaleString()}` : 'N/A';
  const name = escapeHtml(t.name) || 'Unknown';
  const date = escapeHtml(t.date) || 'N/A';
  
  // Consistent: TICKER (linked to chart) + full company name
  let assetLine = '';
  const ticker = sanitizeQuery(t.ticker);
  const company = escapeHtml(t.company);
  
  if (ticker && ticker !== 'N/A') {
    const tickerLink = `<a href="https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}">${escapeHtml(ticker)}</a>`;
    assetLine = company && company !== ticker 
      ? `${tickerLink} — ${company}`
      : tickerLink;
  } else {
    assetLine = company || 'Unknown';
  }
  
  return `${i ? `<b>${i}.</b> ` : ''}${emoji} <b>${assetLine}</b>
   📋 ${escapeHtml((type || 'trade').toUpperCase())}
   👤 ${name} ${loc ? `(${loc})` : ''} ${chamber}
   💰 ${value} | 📅 ${date}`;
}

function fmtCompact(t) {
  const type = (t.type || '').slice(0, 4).toUpperCase();
  const emoji = /BUY|PURC/.test(type) ? '🟢' : '🔴';
  const ticker = escapeHtml(t.ticker) || '???';
  const company = t.company && t.company !== t.ticker ? ` (${escapeHtml(t.company).slice(0, 20)})` : '';
  const name = escapeHtml(t.name);
  return `${emoji} <b>${ticker}</b>${company} | ${name} | ${escapeHtml(type)}`;
}

// ==================== COMMANDS ====================
// Simple rate limiting
const rateLimits = new Map();
const RATE_LIMIT_MS = 1000; // 1 second between commands per user

function isRateLimited(chatId) {
  const now = Date.now();
  const last = rateLimits.get(chatId) || 0;
  if (now - last < RATE_LIMIT_MS) return true;
  rateLimits.set(chatId, now);
  // Clean old entries periodically
  if (rateLimits.size > 10000) {
    for (const [id, time] of rateLimits) {
      if (now - time > 60000) rateLimits.delete(id);
    }
  }
  return false;
}

const COMMANDS = {
  async start(chatId, arg) {
    // Handle deep link search (from clicking politician name)
    // Silently route to search without showing /start was triggered
    if (typeof arg === 'string' && arg.startsWith('search_')) {
      const query = sanitizeQuery(decodeURIComponent(arg.replace('search_', '')));
      if (query) return COMMANDS.search(chatId, query);
    }
    
    const { username, title } = typeof arg === 'object' ? arg : { username: 'user', title: null };
    
    if (!state.subscribers.includes(chatId)) {
      state.subscribers.push(chatId);
      save();
      log(`✅ New: ${chatId} ${title ? `(${escapeHtml(title)})` : `@${escapeHtml(username)}`}`);
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
${tickers.map(([t, c], i) => `${i + 1}. <b>${escapeHtml(t)}</b> — ${c}`).join('\n')}

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
      `${medals[i] || `${i + 1}.`} <b>${escapeHtml(name)}</b> (${party === 'Democrat' ? 'Dem' : party === 'Republican' ? 'Rep' : escapeHtml(party)})\n   ${count} trades`
    ).join('\n\n')}\n\n💡 Use /search [name] to see their trades`);
  },

  async politicians(chatId, arg) {
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
    
    // Check if user wants full list
    const showAll = arg === 'all' || arg === 'full';
    const limit = showAll ? 50 : 10;
    
    const formatPol = ([name, p]) => {
      const safeName = escapeHtml(name);
      const searchName = sanitizeQuery(name.split(' ').pop()); // Use last name for search
      const safeState = escapeHtml(p.state);
      return `• <a href="https://t.me/${botInfo?.username}?start=search_${encodeURIComponent(searchName)}">${safeName}</a>${safeState ? ` (${safeState})` : ''} — ${p.count}`;
    };
    
    const demList = dems.slice(0, limit).map(formatPol).join('\n');
    const repList = reps.slice(0, limit).map(formatPol).join('\n');
    
    const demMore = dems.length > limit ? `\n<i>+${dems.length - limit} more</i>` : '';
    const repMore = reps.length > limit ? `\n<i>+${reps.length - limit} more</i>` : '';
    
    const viewAllBtn = !showAll && (dems.length > limit || reps.length > limit) 
      ? `\n━━━━━━━━━━━━━━━━━━━━━\n📋 /politicians_all — View complete list` 
      : '';
    
    await send(chatId, `👥 <b>Active Politicians (90 Days)</b>

🔵 <b>Democrats (${dems.length})</b>
${demList}${demMore}

🔴 <b>Republicans (${reps.length})</b>
${repList}${repMore}
${viewAllBtn}

💡 Tap a name to see their trades`);
  },

  async politicians_all(chatId) {
    return COMMANDS.politicians(chatId, 'all');
  },

  async tickers(chatId, arg) {
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
      .sort((a, b) => b.total - a.total);
    
    const showAll = arg === 'all' || arg === 'full';
    const limit = showAll ? 40 : 15;
    const display = sorted.slice(0, limit);
    
    const msg = display.map((s, i) => {
      const trend = s.buys > s.sells ? '🟢' : s.sells > s.buys ? '🔴' : '⚪';
      const safeTicker = escapeHtml(s.t);
      const safeCompany = escapeHtml(s.company)?.slice(0, 28) || '';
      const tickerLink = `<a href="https://t.me/${botInfo?.username}?start=search_${encodeURIComponent(sanitizeQuery(s.t))}">${safeTicker}</a>`;
      const chartLink = `<a href="https://finance.yahoo.com/quote/${encodeURIComponent(s.t)}">📈</a>`;
      return `<b>${i + 1}. ${tickerLink}</b> ${chartLink} ${trend}\n   ${safeCompany}\n   ${s.total} trades (${s.buys}↑ ${s.sells}↓)`;
    }).join('\n\n');
    
    const viewAllBtn = !showAll && sorted.length > limit 
      ? `\n━━━━━━━━━━━━━━━━━━━━━\n📋 /tickers_all — View all ${sorted.length} stocks` 
      : '';
    
    await send(chatId, `📈 <b>Top Stocks (30 Days)</b>\n\n${msg}${viewAllBtn}\n\n💡 Tap ticker to see trades, 📈 for chart`);
  },

  async tickers_all(chatId) {
    return COMMANDS.tickers(chatId, 'all');
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
    
    // Sanitize and limit query
    const safeQuery = sanitizeQuery(query).slice(0, 50);
    if (!safeQuery) return send(chatId, '❌ Invalid search query.');
    
    await send(chatId, `🔍 Searching "${escapeHtml(safeQuery)}"...`);
    const trades = await fetchTrades(500);
    const q = safeQuery.toLowerCase();
    const results = trades.filter(t => 
      t.name?.toLowerCase().includes(q) || 
      t.ticker?.toLowerCase().includes(q) || 
      t.company?.toLowerCase().includes(q)
    ).slice(0, 10);
    
    if (!results.length) return send(chatId, `❌ No results for "${escapeHtml(safeQuery)}"`);
    await send(chatId, `🔍 <b>Results: "${escapeHtml(safeQuery)}"</b>\n\n${results.map((t, i) => fmt(t, i + 1)).join('\n\n')}`);
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

<b>⚙️ SYSTEM</b>
/status — Bot health & last check time

<b>💡 TIPS</b>
• Disclosures delayed up to 45 days
• Large trades ($1M+) most significant
• Watch activity before major votes

${group ? '\n<b>👥 GROUP</b>\nAlerts go to all members.' : ''}`);
  },

  async status(chatId) {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = Math.floor(uptime % 60);
    
    const lastCheck = state.lastCheck 
      ? new Date(state.lastCheck).toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC'
      : 'Never';
    
    const nextCheck = state.lastCheck
      ? new Date(new Date(state.lastCheck).getTime() + CONFIG.checkInterval).toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC'
      : 'Soon';
    
    const isSubscribed = state.subscribers.includes(chatId);
    
    await send(chatId, `⚙️ <b>Bot Status</b>

<b>🤖 System</b>
• Status: 🟢 Online
• Uptime: ${hours}h ${mins}m ${secs}s
• Version: 3.1.0

<b>⏰ Auto-Alerts</b>
• Check interval: 60 minutes
• Last check: ${lastCheck}
• Next check: ~${nextCheck}

<b>📊 Data</b>
• Subscribers: ${state.subscribers.length}
• Tracked trades: ${state.seen.length}

<b>👤 Your Status</b>
• Subscribed: ${isSubscribed ? '✅ Yes' : '❌ No'}

━━━━━━━━━━━━━━━━━━━━━
💡 Bot checks for new trades every hour and alerts all subscribers automatically.`);
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
    
    const chatId = msg.chat?.id;
    if (!chatId || typeof chatId !== 'number') return; // Validate chatId
    
    // Bot added to group
    if (msg.new_chat_members?.some(m => m.id === botInfo?.id)) {
      log(`🎉 Added to: ${escapeHtml(msg.chat.title)}`);
      return COMMANDS.start(chatId, { title: msg.chat.title });
    }
    
    if (!msg.text || typeof msg.text !== 'string') return;
    
    // Rate limiting
    if (isRateLimited(chatId)) return;
    
    const [cmd, ...args] = msg.text.slice(0, 200).split(' '); // Limit input length
    const command = cmd.toLowerCase().split('@')[0].slice(1);
    
    // Validate command name (alphanumeric and underscore only)
    if (!/^[a-z0-9_]+$/.test(command)) return;
    
    log(`📨 ${escapeHtml(msg.chat.title || '@' + msg.from?.username)}: /${command}`);
    
    // Handle commands with underscores (politicians_all, tickers_all)
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
    commands: [
      { command: 'start', description: '🚀 Subscribe' },
      { command: 'stop', description: '🛑 Unsubscribe' },
      { command: 'latest', description: '📊 Latest trades' },
      { command: 'today', description: '📅 Last 24h' },
      { command: 'week', description: '📆 Last 7 days' },
      { command: 'month', description: '🗓️ Last 30 days' },
      { command: 'politicians', description: '👥 Politicians' },
      { command: 'tickers', description: '📈 Stocks' },
      { command: 'search', description: '🔍 Search' },
      { command: 'top', description: '🏆 Top traders' },
      { command: 'stats', description: '📊 Statistics' },
      { command: 'status', description: '⚙️ Bot health' },
      { command: 'help', description: '❓ Help' },
    ]
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
