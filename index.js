/**
 * Congressional Trade Bot v3.3.0
 * Telegram bot for tracking U.S. Congress stock trades
 */

const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const CONFIG = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  adminId: process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null,
  dataFile: process.env.DATA_DIR 
    ? path.join(process.env.DATA_DIR, 'data.json')
    : path.join(__dirname, 'data.json'),
  checkInterval: 60 * 60 * 1000,
  retries: 2,
  timeout: 15000,
};

// ==================== STATE ====================
let state = { subscribers: [], seen: [], lastCheck: null };
let botInfo = null;
let lastUpdateId = 0;
let polling = false;
const debugLog = [];
const rateLimits = new Map();

// ==================== TICKER LOOKUP ====================
const TICKERS = {
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
  LOW: "Lowe's Companies", MCD: "McDonald's Corp", SBUX: 'Starbucks Corp', NKE: 'Nike Inc',
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

// ==================== HELPERS ====================
const log = (...a) => {
  const m = `[${new Date().toISOString().slice(11,19)}] ${a.join(' ')}`;
  console.log(m);
  debugLog.push(m);
  if (debugLog.length > 50) debugLog.shift();
};
const delay = ms => new Promise(r => setTimeout(r, ms));
const isGroup = id => id < 0;
const parseValue = s => s?.match(/\$?([\d,]+)/)?.[1]?.replace(/,/g, '') * 1 || null;
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const clean = s => String(s||'').replace(/[<>"'&]/g,'').slice(0,100);
const company = (t,d) => (d && d !== t && d.length > 2) ? d : (TICKERS[t] || '');

function rateLimit(id) {
  const now = Date.now();
  if (now - (rateLimits.get(id)||0) < 1000) return true;
  rateLimits.set(id, now);
  if (rateLimits.size > 10000) {
    for (const [k,v] of rateLimits) if (now - v > 60000) rateLimits.delete(k);
  }
  return false;
}

// ==================== PERSISTENCE ====================
function load() {
  log(`📁 Data: ${CONFIG.dataFile}`);
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const d = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
      state = {
        subscribers: (d.subscribers||[]).filter(i => typeof i === 'number'),
        seen: (d.seen||[]).filter(i => typeof i === 'string').slice(-2000),
        lastCheck: typeof d.lastCheck === 'string' ? d.lastCheck : null
      };
      log(`📂 Loaded ${state.subscribers.length} subs`);
    } else if (process.env.SUBSCRIBERS) {
      try {
        const ids = JSON.parse(process.env.SUBSCRIBERS);
        if (Array.isArray(ids)) {
          state.subscribers = ids.filter(i => typeof i === 'number');
          log(`📂 From env: ${state.subscribers.length}`);
          save();
        }
      } catch {}
    }
  } catch (e) { log('Load err:', e.message); }
}

function save() {
  try {
    state.seen = state.seen.slice(-2000);
    const tmp = CONFIG.dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, CONFIG.dataFile);
  } catch (e) { log('Save err:', e.message); }
}

// ==================== DATA SOURCES ====================
const SOURCES = [
  {
    name: 'Quiver',
    url: 'https://api.quiverquant.com/beta/live/congresstrading',
    parse: d => d.map(t => ({
      id: `${t.Representative}-${t.Ticker}-${t.TransactionDate}`,
      name: t.Representative, ticker: t.Ticker, date: t.TransactionDate,
      party: t.Party==='D'?'Democrat':t.Party==='R'?'Republican':t.Party,
      state: t.District?.slice(0,2)||'',
      chamber: t.House==='Representatives'?'house':'senate',
      company: company(t.Ticker, t.Description),
      type: t.Transaction, value: parseValue(t.Range),
    }))
  },
  {
    name: 'House',
    url: 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json',
    parse: d => d.map(t => ({
      id: `${t.representative}-${t.ticker}-${t.transaction_date}`,
      name: t.representative, ticker: t.ticker, date: t.transaction_date,
      party: t.party||'', state: t.state||t.district||'', chamber: 'house',
      company: company(t.ticker, t.asset_description),
      type: t.type||t.transaction_type, value: t.amount,
    })).sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,500)
  },
  {
    name: 'Senate',
    url: 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json',
    parse: d => d.map(t => ({
      id: `${t.senator}-${t.ticker}-${t.transaction_date}`,
      name: t.senator, ticker: t.ticker, date: t.transaction_date,
      party: t.party||'', state: t.state||'', chamber: 'senate',
      company: company(t.ticker, t.asset_description),
      type: t.type||t.transaction_type, value: t.amount,
    })).sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,500)
  }
];

// ==================== TELEGRAM ====================
async function tg(method, params = {}) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${CONFIG.token}/${method}`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(params)
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.description);
    return d;
  } catch (e) {
    if (!e.message?.includes('Conflict')) log(`TG ${method}:`, e.message);
    return null;
  }
}
const send = (id, txt) => tg('sendMessage', {chat_id:id, text:txt, parse_mode:'HTML', disable_web_page_preview:true});

// ==================== FETCH TRADES ====================
async function fetchTrades(limit = 100, days = null) {
  for (let i = 0; i <= CONFIG.retries; i++) {
    if (i > 0) { log(`Retry ${i}...`); await delay(1000); }
    
    for (const src of SOURCES) {
      try {
        log(`Trying ${src.name}...`);
        const r = await fetch(src.url, {
          headers: {'User-Agent':'Mozilla/5.0','Accept':'application/json'},
          signal: AbortSignal.timeout(CONFIG.timeout)
        });
        if (!r.ok) { log(`${src.name}: ${r.status}`); continue; }
        
        let trades = src.parse(await r.json());
        trades.sort((a,b) => new Date(b.date)-new Date(a.date));
        
        if (days) {
          const cut = Date.now() - days * 86400000;
          trades = trades.filter(t => { const d=new Date(t.date); return !isNaN(d) && d >= cut; });
        }
        
        log(`✅ ${src.name}: ${trades.length}`);
        return { trades: trades.slice(0, limit), ok: true };
      } catch (e) { log(`${src.name}: ${e.message}`); }
    }
  }
  log('❌ All failed');
  return { trades: [], ok: false };
}

// ==================== FORMATTING ====================
function fmt(t, i = 0) {
  const type = (t.type||'').toLowerCase();
  const emoji = /buy|purchase/.test(type)?'🟢':/sell|sale/.test(type)?'🔴':'⚪';
  const party = t.party==='Democrat'?'Dem':t.party==='Republican'?'Rep':esc(t.party);
  const loc = [party, esc(t.state)].filter(Boolean).join(', ');
  const chamber = t.chamber==='senate'?'🏛️':'🏠';
  const val = t.value ? `$${Number(t.value).toLocaleString()}` : 'N/A';
  
  const ticker = clean(t.ticker);
  const comp = esc(t.company);
  let asset = comp || 'Unknown';
  if (ticker && ticker !== 'N/A') {
    const link = `<a href="https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}">${esc(ticker)}</a>`;
    asset = comp && comp !== ticker ? `${link} — ${comp}` : link;
  }
  
  return `${i?`<b>${i}.</b> `:''}${emoji} <b>${asset}</b>
   📋 ${esc((type||'trade').toUpperCase())}
   👤 ${esc(t.name)} ${loc?`(${loc})`:''} ${chamber}
   💰 ${val} | 📅 ${esc(t.date)}`;
}

const fmtShort = t => {
  const type = (t.type||'').slice(0,4).toUpperCase();
  return `${/BUY|PURC/.test(type)?'🟢':'🔴'} <b>${esc(t.ticker)}</b> | ${esc(t.name)} | ${esc(type)}`;
};

// ==================== COMMANDS ====================
const CMD = {
  async start(cid, arg) {
    if (typeof arg === 'string' && arg.startsWith('search_')) {
      const q = clean(decodeURIComponent(arg.replace('search_', '')));
      if (q) return CMD.search(cid, q);
    }
    const {username,title} = typeof arg === 'object' ? arg : {username:'user',title:null};
    if (!state.subscribers.includes(cid)) {
      state.subscribers.push(cid);
      save();
      log(`✅ New: ${cid} ${title?`(${esc(title)})`:`@${esc(username)}`}`);
    }
    const g = isGroup(cid);
    await send(cid, `🏛️ <b>Congressional Trade Alerts</b>

${g?'📢 <b>Group alerts enabled!</b>\n\n':''}Track stock trades by U.S. Congress members.

<b>📌 WHY IT MATTERS</b>
Congress must disclose trades within 45 days.

<b>📊 COMMANDS</b>
/latest • /today • /week • /month
/politicians • /tickers • /search
/top • /stats • /help

${g?'━━━━━━━━━━━━━━━━━━━━━\n💡 All members will receive alerts.':'━━━━━━━━━━━━━━━━━━━━━\n💡 Try /politicians to browse!'}`);
  },

  async stop(cid) {
    state.subscribers = state.subscribers.filter(i => i !== cid);
    save();
    await send(cid, '🛑 <b>Unsubscribed</b>\n\nUse /start to resubscribe.');
  },

  async latest(cid) {
    await send(cid, '⏳ Loading...');
    const {trades, ok} = await fetchTrades(10);
    if (!ok) return send(cid, '⚠️ <b>Data Unavailable</b>\n\nTry again in a few minutes.');
    if (!trades.length) return send(cid, '📭 No trades found.');
    await send(cid, `📊 <b>Latest Trades</b>\n\n${trades.map((t,i)=>fmt(t,i+1)).join('\n\n')}`);
  },

  async today(cid) {
    await send(cid, '⏳ Loading...');
    const {trades, ok} = await fetchTrades(100, 1);
    if (!ok) return send(cid, '⚠️ <b>Data Unavailable</b>\n\nTry again in a few minutes.');
    if (!trades.length) return send(cid, '📭 No trades in last 24h.');
    await send(cid, `📅 <b>Last 24h</b> (${trades.length})\n\n${trades.slice(0,15).map((t,i)=>fmt(t,i+1)).join('\n\n')}${trades.length>15?`\n\n<i>+${trades.length-15} more</i>`:''}`);
  },

  async week(cid) {
    await send(cid, '⏳ Loading...');
    const {trades, ok} = await fetchTrades(200, 7);
    if (!ok) return send(cid, '⚠️ <b>Data Unavailable</b>\n\nTry again in a few minutes.');
    if (!trades.length) return send(cid, '📭 No trades in last 7 days.');
    
    const byDay = trades.reduce((a,t) => { const d=t.date?.slice(0,10)||'?'; (a[d]=a[d]||[]).push(t); return a; }, {});
    let msg = `📆 <b>Last 7 Days</b> (${trades.length})\n\n`;
    Object.keys(byDay).sort().reverse().slice(0,7).forEach(d => {
      msg += `<b>📅 ${d}</b> (${byDay[d].length})\n`;
      byDay[d].slice(0,5).forEach(t => msg += `  ${fmtShort(t)}\n`);
      if (byDay[d].length > 5) msg += `  <i>+${byDay[d].length-5} more</i>\n`;
      msg += '\n';
    });
    await send(cid, msg);
  },

  async month(cid) {
    await send(cid, '⏳ Loading...');
    const {trades, ok} = await fetchTrades(500, 30);
    if (!ok) return send(cid, '⚠️ <b>Data Unavailable</b>\n\nTry again in a few minutes.');
    if (!trades.length) return send(cid, '📭 No trades in last 30 days.');
    
    const buys = trades.filter(t => /buy|purchase/i.test(t.type)).length;
    const sells = trades.length - buys;
    const top = Object.entries(trades.reduce((a,t)=>(a[t.ticker]=(a[t.ticker]||0)+1,a),{}))
      .sort((a,b)=>b[1]-a[1]).slice(0,5);
    
    await send(cid, `🗓️ <b>Last 30 Days</b>

📊 ${trades.length} trades | 🟢 ${buys} buys | 🔴 ${sells} sells
📈 Ratio: ${(buys/(sells||1)).toFixed(2)}

<b>Top Tickers:</b>
${top.map(([t,c],i)=>`${i+1}. <b>${esc(t)}</b> — ${c}`).join('\n')}

<b>Recent:</b>\n\n${trades.slice(0,8).map((t,i)=>fmt(t,i+1)).join('\n\n')}`);
  },

  async top(cid) {
    await send(cid, '⏳ Loading...');
    const {trades, ok} = await fetchTrades(500, 30);
    if (!ok) return send(cid, '⚠️ <b>Data Unavailable</b>\n\nTry again in a few minutes.');
    if (!trades.length) return send(cid, '📭 No trades in last 30 days.');
    
    const traders = trades.reduce((a,t) => { a[t.name]=a[t.name]||{c:0,p:t.party}; a[t.name].c++; return a; }, {});
    const top = Object.entries(traders).sort((a,b)=>b[1].c-a[1].c).slice(0,10);
    const medals = ['🥇','🥈','🥉'];
    
    await send(cid, `🏆 <b>Most Active (30d)</b>\n\n${top.map(([n,{c,p}],i)=>
      `${medals[i]||`${i+1}.`} <b>${esc(n)}</b> (${p==='Democrat'?'Dem':p==='Republican'?'Rep':esc(p)})\n   ${c} trades`
    ).join('\n\n')}\n\n💡 /search [name] for details`);
  },

  async politicians(cid, arg) {
    await send(cid, '⏳ Loading...');
    const {trades, ok} = await fetchTrades(500, 90);
    if (!ok) return send(cid, '⚠️ <b>Data Unavailable</b>\n\nTry again in a few minutes.');
    if (!trades.length) return send(cid, '📭 No trades in last 90 days.');
    
    const pols = trades.reduce((a,t) => { a[t.name]=a[t.name]||{p:t.party,s:t.state,c:0}; a[t.name].c++; return a; }, {});
    const sorted = Object.entries(pols).sort((a,b)=>b[1].c-a[1].c);
    const dems = sorted.filter(([,p])=>p.p==='Democrat');
    const reps = sorted.filter(([,p])=>p.p==='Republican');
    
    const all = arg === 'all';
    const lim = all ? 50 : 10;
    const fmt = ([n,p]) => {
      const ln = clean(n.split(' ').pop());
      return `• <a href="https://t.me/${botInfo?.username}?start=search_${encodeURIComponent(ln)}">${esc(n)}</a>${p.s?` (${esc(p.s)})`:''} — ${p.c}`;
    };
    
    await send(cid, `👥 <b>Politicians (90d)</b>

🔵 <b>Democrats (${dems.length})</b>
${dems.slice(0,lim).map(fmt).join('\n')}${dems.length>lim?`\n<i>+${dems.length-lim}</i>`:''}

🔴 <b>Republicans (${reps.length})</b>
${reps.slice(0,lim).map(fmt).join('\n')}${reps.length>lim?`\n<i>+${reps.length-lim}</i>`:''}
${!all&&(dems.length>lim||reps.length>lim)?'\n━━━━━━━━━━━━━━━━━━━━━\n📋 /politicians_all — View all':''}

💡 Tap name to see trades`);
  },

  politicians_all(cid) { return CMD.politicians(cid, 'all'); },

  async tickers(cid, arg) {
    await send(cid, '⏳ Loading...');
    const {trades, ok} = await fetchTrades(500, 30);
    if (!ok) return send(cid, '⚠️ <b>Data Unavailable</b>\n\nTry again in a few minutes.');
    if (!trades.length) return send(cid, '📭 No trades in last 30 days.');
    
    const tix = trades.reduce((a,t) => {
      if (!t.ticker||t.ticker==='N/A') return a;
      a[t.ticker]=a[t.ticker]||{co:t.company,b:0,s:0};
      /buy|purchase/i.test(t.type)?a[t.ticker].b++:a[t.ticker].s++;
      return a;
    }, {});
    
    const sorted = Object.entries(tix).map(([t,d])=>({t,...d,n:d.b+d.s})).sort((a,b)=>b.n-a.n);
    const all = arg === 'all';
    const lim = all ? 40 : 15;
    
    const msg = sorted.slice(0,lim).map((s,i) => {
      const trend = s.b>s.s?'🟢':s.s>s.b?'🔴':'⚪';
      const tl = `<a href="https://t.me/${botInfo?.username}?start=search_${encodeURIComponent(clean(s.t))}">${esc(s.t)}</a>`;
      const cl = `<a href="https://finance.yahoo.com/quote/${encodeURIComponent(s.t)}">📈</a>`;
      return `<b>${i+1}. ${tl}</b> ${cl} ${trend}\n   ${esc(s.co)?.slice(0,28)||''}\n   ${s.n} (${s.b}↑ ${s.s}↓)`;
    }).join('\n\n');
    
    await send(cid, `📈 <b>Stocks (30d)</b>\n\n${msg}${!all&&sorted.length>lim?`\n━━━━━━━━━━━━━━━━━━━━━\n📋 /tickers_all — All ${sorted.length}`:''}\n\n💡 Tap ticker → trades, 📈 → chart`);
  },

  tickers_all(cid) { return CMD.tickers(cid, 'all'); },

  async search(cid, q) {
    if (!q || q.length < 2) return send(cid, `🔍 <b>Search</b>\n\n/search [name or ticker]\n\n<b>Examples:</b>\n• /search Pelosi\n• /search NVDA`);
    
    const sq = clean(q).slice(0,50);
    if (!sq) return send(cid, '❌ Invalid query.');
    
    await send(cid, `🔍 Searching "${esc(sq)}"...`);
    const {trades, ok} = await fetchTrades(500);
    if (!ok) return send(cid, '⚠️ <b>Data Unavailable</b>\n\nTry again in a few minutes.');
    
    const ql = sq.toLowerCase();
    const res = trades.filter(t => t.name?.toLowerCase().includes(ql) || t.ticker?.toLowerCase().includes(ql) || t.company?.toLowerCase().includes(ql)).slice(0,10);
    
    if (!res.length) return send(cid, `📭 No results for "${esc(sq)}"`);
    await send(cid, `🔍 <b>"${esc(sq)}"</b>\n\n${res.map((t,i)=>fmt(t,i+1)).join('\n\n')}`);
  },

  async stats(cid) {
    await send(cid, '⏳ Loading...');
    const {trades, ok} = await fetchTrades(500, 30);
    if (!ok) return send(cid, '⚠️ <b>Data Unavailable</b>\n\nTry again in a few minutes.');
    if (!trades.length) return send(cid, '📭 No trades in last 30 days.');
    
    const buys = trades.filter(t => /buy|purchase/i.test(t.type)).length;
    const sells = trades.length - buys;
    const dems = trades.filter(t => t.party==='Democrat').length;
    const reps = trades.filter(t => t.party==='Republican').length;
    const tech = ['AAPL','MSFT','GOOGL','GOOG','AMZN','META','NVDA','AMD','INTC'];
    const techN = trades.filter(t => tech.includes(t.ticker)).length;
    const ratio = (buys/(sells||1)).toFixed(2);
    const sent = ratio>1.2?'📈 Bullish':ratio<0.8?'📉 Bearish':'➡️ Neutral';
    const val = trades.reduce((a,t)=>a+(Number(t.value)||0),0);
    
    await send(cid, `📊 <b>Stats (30d)</b>

<b>Activity</b>
• ${trades.length} trades • $${(val/1e6).toFixed(1)}M+
• ${new Set(trades.map(t=>t.name)).size} politicians

<b>Sentiment</b>
• 🟢 ${buys} buys | 🔴 ${sells} sells
• Ratio: ${ratio} ${sent}

<b>Party</b>
• 🔵 Dem: ${dems} | 🔴 Rep: ${reps}

<b>Tech</b>
• ${techN} trades (${((techN/trades.length)*100).toFixed(0)}%)`);
  },

  async help(cid) {
    await send(cid, `📖 <b>Help</b>

<b>🔔 ALERTS</b>
/start — Subscribe
/stop — Unsubscribe

<b>📊 TRADES</b>
/latest • /today • /week • /month

<b>🔍 RESEARCH</b>
/politicians • /tickers • /search • /top

<b>📈 ANALYSIS</b>
/stats — Buy/sell ratios

<b>⚙️ SYSTEM</b>
/status — Bot health`);
  },

  async status(cid) {
    const up = process.uptime();
    const h = Math.floor(up/3600), m = Math.floor((up%3600)/60), s = Math.floor(up%60);
    const lc = state.lastCheck ? new Date(state.lastCheck).toLocaleString('en-US',{timeZone:'UTC'})+' UTC' : 'Never';
    
    await send(cid, `⚙️ <b>Status</b>

• Online: 🟢 ${h}h ${m}m ${s}s
• Version: 3.3.0
• Last check: ${lc}
• Subscribers: ${state.subscribers.length}
• Tracked: ${state.seen.length}
• You: ${state.subscribers.includes(cid)?'✅':'❌'}`);
  },

  // Admin
  async debug(cid, _, uid) {
    if (!CONFIG.adminId || uid !== CONFIG.adminId) return;
    await send(cid, `📋 <b>Debug</b>\n\n<code>${esc(debugLog.slice(-30).join('\n'))}</code>`);
  },

  async subs(cid, _, uid) {
    if (!CONFIG.adminId || uid !== CONFIG.adminId) return;
    await send(cid, `👥 <b>Subs</b> (${state.subscribers.length})\n\n${state.subscribers.join('\n')||'None'}`);
  },
};

// ==================== POLLING ====================
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const r = await tg('getUpdates', {offset: lastUpdateId+1, timeout: 30, allowed_updates: ['message']});
    for (const u of r?.result || []) {
      lastUpdateId = u.update_id;
      await processUpdate(u);
    }
  } catch (e) {
    if (e.message?.includes('Conflict')) await tg('deleteWebhook', {drop_pending_updates: true});
  }
  polling = false;
}

async function processUpdate(u) {
  try {
    const msg = u.message;
    if (!msg) return;
    
    const cid = msg.chat?.id;
    if (!cid || typeof cid !== 'number') return;
    
    if (msg.new_chat_members?.some(m => m.id === botInfo?.id)) {
      log(`🎉 Added: ${esc(msg.chat.title)}`);
      return CMD.start(cid, {title: msg.chat.title});
    }
    
    if (!msg.text || typeof msg.text !== 'string') return;
    if (rateLimit(cid)) return;
    
    const [cmd, ...args] = msg.text.slice(0,200).split(' ');
    const c = cmd.toLowerCase().split('@')[0].slice(1);
    
    if (!/^[a-z0-9_]+$/.test(c)) return;
    
    log(`📨 ${esc(msg.chat.title||'@'+msg.from?.username)}: /${c}`);
    
    if (CMD[c]) {
      await CMD[c](cid, args.join(' ')||{username:msg.from?.username,title:msg.chat.title}, msg.from?.id);
    } else if (cmd.startsWith('/') && msg.chat.type === 'private') {
      await send(cid, '❓ Unknown. Try /help');
    }
  } catch (e) { log('Err:', e.message); }
}

// ==================== ALERTS ====================
async function checkAlerts() {
  log('Checking...');
  const {trades, ok} = await fetchTrades(50);
  if (!ok) return log('⚠️ Fetch failed');
  if (!trades.length) return log('No data');
  
  const newT = trades.filter(t => !state.seen.includes(t.id));
  newT.forEach(t => state.seen.push(t.id));
  
  if (newT.length && state.subscribers.length) {
    log(`📢 ${newT.length} new → ${state.subscribers.length} subs`);
    for (const t of newT.slice(0,5)) {
      const m = `🚨 <b>New Trade</b>\n\n${fmt(t)}`;
      for (const id of state.subscribers) { await send(id, m); await delay(50); }
      await delay(300);
    }
  } else log('No new');
  
  state.lastCheck = new Date().toISOString();
  save();
}

// ==================== MAIN ====================
async function main() {
  console.log('\n🏛️ Congressional Trade Bot v3.3.0\n');
  
  if (!CONFIG.token) { console.error('❌ TELEGRAM_BOT_TOKEN required'); process.exit(1); }
  
  load();
  await tg('deleteWebhook', {drop_pending_updates: true});
  await tg('setMyCommands', {commands: [
    {command:'start',description:'🚀 Subscribe'},{command:'stop',description:'🛑 Unsubscribe'},
    {command:'latest',description:'📊 Latest'},{command:'today',description:'📅 24h'},
    {command:'week',description:'📆 7 days'},{command:'month',description:'🗓️ 30 days'},
    {command:'politicians',description:'👥 Politicians'},{command:'tickers',description:'📈 Stocks'},
    {command:'search',description:'🔍 Search'},{command:'top',description:'🏆 Top traders'},
    {command:'stats',description:'📊 Stats'},{command:'status',description:'⚙️ Status'},
    {command:'help',description:'❓ Help'},
  ]});
  
  const me = await tg('getMe');
  botInfo = me?.result;
  log(`✅ @${botInfo?.username}`);
  
  await checkAlerts();
  setInterval(poll, 2000);
  setInterval(checkAlerts, CONFIG.checkInterval);
  
  log('🚀 Running!');
  process.on('SIGTERM', () => { save(); process.exit(0); });
  process.on('SIGINT', () => { save(); process.exit(0); });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
