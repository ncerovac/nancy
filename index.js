const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  checkIntervalMs: 60 * 60 * 1000, // Check every hour for new trades
  dataFile: path.join(__dirname, 'bot_data.json'),
};

// Data sources (multiple fallbacks)
const DATA_SOURCES = [
  {
    name: 'Quiver Quant',
    url: 'https://api.quiverquant.com/beta/live/congresstrading',
    transform: (data) => data.map(t => ({
      politician: { 
        name: t.Representative, 
        party: t.Party === 'D' ? 'Democrat' : t.Party === 'R' ? 'Republican' : t.Party,
        state: t.District?.substring(0, 2) || '',
        chamber: t.House === 'Representatives' ? 'house' : 'senate'
      },
      asset: { 
        assetTicker: t.Ticker, 
        assetName: t.Description || t.Ticker 
      },
      txType: t.Transaction,
      txDate: t.TransactionDate,
      value: t.Range ? parseRange(t.Range) : null,
      _id: `${t.Representative}-${t.Ticker}-${t.TransactionDate}-${t.Transaction}`
    }))
  },
  {
    name: 'House Stock Watcher',
    url: 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json',
    transform: (data) => data.slice(0, 200).map(t => ({
      politician: {
        name: t.representative,
        party: t.party || '',
        state: t.state || t.district || '',
        chamber: 'house'
      },
      asset: {
        assetTicker: t.ticker,
        assetName: t.asset_description || ''
      },
      txType: t.type || t.transaction_type,
      txDate: t.transaction_date,
      value: t.amount,
      _id: `${t.representative}-${t.ticker}-${t.transaction_date}-${t.type}`
    }))
  },
  {
    name: 'Senate Stock Watcher', 
    url: 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json',
    transform: (data) => data.slice(0, 200).map(t => ({
      politician: {
        name: t.senator,
        party: t.party || '',
        state: t.state || '',
        chamber: 'senate'
      },
      asset: {
        assetTicker: t.ticker,
        assetName: t.asset_description || ''
      },
      txType: t.type || t.transaction_type,
      txDate: t.transaction_date,
      value: t.amount,
      _id: `${t.senator}-${t.ticker}-${t.transaction_date}-${t.type}`
    }))
  }
];

function parseRange(range) {
  if (!range) return null;
  const match = range.match(/\$?([\d,]+)/);
  return match ? parseInt(match[1].replace(/,/g, '')) : null;
}

// In-memory storage (persisted to file)
let botData = {
  subscribers: [], // Array of chat IDs (users and groups)
  seenTrades: [],  // Trade IDs we've already notified about
  lastCheck: null,
};

// ==================== DATA PERSISTENCE ====================

function loadData() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
      botData = {
        subscribers: data.subscribers || [],
        seenTrades: data.seenTrades || [],
        lastCheck: data.lastCheck,
      };
      console.log(`📂 Loaded ${botData.subscribers.length} subscribers`);
    }
  } catch (err) {
    console.error('Error loading data:', err.message);
  }
}

function saveData() {
  const toSave = {
    subscribers: botData.subscribers,
    seenTrades: botData.seenTrades.slice(-2000), // Keep last 2000 to prevent bloat
    lastCheck: botData.lastCheck,
  };
  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(toSave, null, 2));
}

// ==================== TELEGRAM API ====================

async function telegramRequest(method, params = {}) {
  const url = `https://api.telegram.org/bot${CONFIG.telegramBotToken}/${method}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    
    const result = await response.json();
    
    if (!result.ok) {
      throw new Error(result.description || 'Telegram API error');
    }
    
    return result;
  } catch (err) {
    console.error(`Telegram ${method} error:`, err.message);
    return null;
  }
}

async function sendMessage(chatId, text, extra = {}) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

async function setCommands() {
  // Set commands for private chats
  await telegramRequest('setMyCommands', {
    commands: [
      { command: 'start', description: '🚀 Subscribe to trade alerts' },
      { command: 'stop', description: '🛑 Unsubscribe from alerts' },
      { command: 'latest', description: '📊 Show last 10 trades' },
      { command: 'today', description: '📅 Trades from last 24 hours' },
      { command: 'week', description: '📆 Trades from last 7 days' },
      { command: 'month', description: '🗓️ Trades from last 30 days' },
      { command: 'politicians', description: '👥 Browse all politicians' },
      { command: 'tickers', description: '📈 Browse all traded stocks' },
      { command: 'search', description: '🔍 Search trades' },
      { command: 'top', description: '🏆 Most active traders' },
      { command: 'stats', description: '📊 Trading statistics' },
      { command: 'help', description: '❓ How to use this bot' },
    ],
    scope: { type: 'all_private_chats' },
  });
  
  // Set commands for groups
  await telegramRequest('setMyCommands', {
    commands: [
      { command: 'start', description: '🚀 Enable alerts in this group' },
      { command: 'stop', description: '🛑 Disable alerts in this group' },
      { command: 'latest', description: '📊 Show last 10 trades' },
      { command: 'today', description: '📅 Trades from last 24 hours' },
      { command: 'week', description: '📆 Trades from last 7 days' },
      { command: 'politicians', description: '👥 Browse all politicians' },
      { command: 'tickers', description: '📈 Browse all traded stocks' },
      { command: 'search', description: '🔍 Search trades' },
      { command: 'stats', description: '📊 Trading statistics' },
      { command: 'help', description: '❓ How to use this bot' },
    ],
    scope: { type: 'all_group_chats' },
  });
}

// Fetch trades with fallback sources
async function fetchTrades(limit = 100, days = null) {
  for (const source of DATA_SOURCES) {
    try {
      console.log(`Trying ${source.name}...`);
      
      const response = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      
      if (!response.ok) {
        console.log(`${source.name} returned HTTP ${response.status}`);
        continue;
      }
      
      const rawData = await response.json();
      let trades = source.transform(rawData);
      
      // Filter by days if specified
      if (days) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        trades = trades.filter(t => {
          const tradeDate = new Date(t.txDate);
          return tradeDate >= cutoff;
        });
      }
      
      console.log(`✅ ${source.name}: fetched ${trades.length} trades`);
      return trades.slice(0, limit);
      
    } catch (err) {
      console.log(`${source.name} error: ${err.message}`);
      continue;
    }
  }
  
  console.log('❌ All data sources failed');
  return [];
}

async function searchTrades(query, limit = 10) {
  const trades = await fetchTrades(500);
  const q = query.toLowerCase();
  
  return trades.filter(t => {
    const name = (t.politician?.name || '').toLowerCase();
    const ticker = (t.asset?.assetTicker || '').toLowerCase();
    const company = (t.asset?.assetName || '').toLowerCase();
    return name.includes(q) || ticker.includes(q) || company.includes(q);
  }).slice(0, limit);
}

// ==================== FORMATTING ====================

function formatTrade(trade, showIndex = false, index = 0) {
  const name = trade.politician?.name || 'Unknown';
  const party = trade.politician?.party || '?';
  const state = trade.politician?.state || '?';
  const chamber = trade.politician?.chamber || '';
  const type = (trade.txType || 'unknown').toLowerCase();
  const ticker = trade.asset?.assetTicker || 'N/A';
  const company = trade.asset?.assetName || 'Unknown';
  const value = trade.value ? `$${Number(trade.value).toLocaleString()}` : 'Unknown';
  const date = trade.txDate || 'Unknown';
  
  const emoji = type.includes('buy') || type.includes('purchase') ? '🟢' : 
                type.includes('sell') || type.includes('sale') ? '🔴' : '⚪';
  
  const prefix = showIndex ? `<b>${index}.</b> ` : '';
  
  return `${prefix}${emoji} <b>${ticker}</b> - ${type.toUpperCase()}
   👤 ${name} (${party}-${state}) ${chamber === 'senate' ? '🏛️' : '🏠'}
   💰 ${value} | 📅 ${date}
   🏢 <i>${company.substring(0, 40)}${company.length > 40 ? '...' : ''}</i>`;
}

function formatTradeCompact(trade) {
  const name = trade.politician?.name || 'Unknown';
  const type = (trade.txType || '?').substring(0, 4).toUpperCase();
  const ticker = trade.asset?.assetTicker || 'N/A';
  const emoji = type.includes('BUY') || type.includes('PURC') ? '🟢' : '🔴';
  return `${emoji} ${ticker} | ${name} | ${type}`;
}

// ==================== COMMAND HANDLERS ====================

function isGroup(chatId) {
  return chatId < 0; // Group chat IDs are negative
}

async function handleStart(chatId, username, chatTitle = null) {
  const isGroupChat = isGroup(chatId);
  
  if (!botData.subscribers.includes(chatId)) {
    botData.subscribers.push(chatId);
    saveData();
    if (isGroupChat) {
      console.log(`✅ New group subscriber: ${chatId} (${chatTitle})`);
    } else {
      console.log(`✅ New subscriber: ${chatId} (@${username})`);
    }
  }
  
  const groupNote = isGroupChat ? `\n\n<b>📢 Group Mode Active</b>\nThis group will receive alerts when Congress members trade stocks.` : '';
  
  const welcome = `🏛️ <b>Congressional Trade Alerts</b>

Track stock trades made by members of the U.S. Congress in real-time.${groupNote}

━━━━━━━━━━━━━━━━━━━━━

<b>📌 WHY THIS MATTERS</b>

Members of Congress must publicly disclose their stock trades within 45 days under the STOCK Act. Studies have shown congressional portfolios often outperform the market — now you can see what they're buying and selling.

━━━━━━━━━━━━━━━━━━━━━

<b>🔔 ALERTS</b>
You'll automatically receive notifications when new trades are published. Use /stop to disable.

<b>📊 VIEW TRADES</b>
/latest → Most recent 10 trades
/today → Last 24 hours
/week → Last 7 days
/month → Last 30 days + summary

<b>🔍 RESEARCH</b>
/politicians → Browse all active traders
/tickers → Browse all traded stocks
/search → Find specific trades
/top → Most active traders
/stats → Market analysis

<b>❓ HELP</b>
/help → Detailed command guide

━━━━━━━━━━━━━━━━━━━━━

💡 <b>Quick Start:</b> Try /politicians to see who's trading, then /search their name!`;

  await sendMessage(chatId, welcome);
}

async function handleStop(chatId) {
  const isGroupChat = isGroup(chatId);
  const index = botData.subscribers.indexOf(chatId);
  
  if (index > -1) {
    botData.subscribers.splice(index, 1);
    saveData();
  }
  
  const msg = isGroupChat 
    ? `🛑 <b>Alerts Disabled</b>\n\nThis group will no longer receive trade alerts.\n\nUse /start to enable alerts again.`
    : `🛑 <b>Unsubscribed</b>\n\nYou will no longer receive trade alerts.\n\nUse /start to subscribe again anytime.`;
  
  await sendMessage(chatId, msg);
}

async function handleLatest(chatId) {
  await sendMessage(chatId, '⏳ Fetching latest trades...');
  
  const trades = await fetchTrades(10);
  
  if (trades.length === 0) {
    return sendMessage(chatId, '❌ Could not fetch trades. Try again later.');
  }
  
  let msg = `📊 <b>Latest 10 Congressional Trades</b>\n\n`;
  trades.slice(0, 10).forEach((t, i) => {
    msg += formatTrade(t, true, i + 1) + '\n\n';
  });
  
  await sendMessage(chatId, msg);
}

async function handleToday(chatId) {
  await sendMessage(chatId, '⏳ Fetching trades from last 24 hours...');
  
  const trades = await fetchTrades(100, 1);
  
  if (trades.length === 0) {
    return sendMessage(chatId, '📭 No trades in the last 24 hours.');
  }
  
  let msg = `📅 <b>Trades - Last 24 Hours</b>\nFound ${trades.length} trade(s)\n\n`;
  trades.slice(0, 15).forEach((t, i) => {
    msg += formatTrade(t, true, i + 1) + '\n\n';
  });
  
  if (trades.length > 15) {
    msg += `\n<i>...and ${trades.length - 15} more</i>`;
  }
  
  await sendMessage(chatId, msg);
}

async function handleWeek(chatId) {
  await sendMessage(chatId, '⏳ Fetching trades from last 7 days...');
  
  const trades = await fetchTrades(200, 7);
  
  if (trades.length === 0) {
    return sendMessage(chatId, '📭 No trades in the last 7 days.');
  }
  
  // Group by day
  const byDay = {};
  trades.forEach(t => {
    const day = t.txDate?.substring(0, 10) || 'Unknown';
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(t);
  });
  
  let msg = `📆 <b>Trades - Last 7 Days</b>\nFound ${trades.length} trade(s)\n\n`;
  
  Object.keys(byDay).sort().reverse().slice(0, 7).forEach(day => {
    msg += `<b>📅 ${day}</b> (${byDay[day].length} trades)\n`;
    byDay[day].slice(0, 5).forEach(t => {
      msg += `  ${formatTradeCompact(t)}\n`;
    });
    if (byDay[day].length > 5) {
      msg += `  <i>...+${byDay[day].length - 5} more</i>\n`;
    }
    msg += '\n';
  });
  
  await sendMessage(chatId, msg);
}

async function handleMonth(chatId) {
  await sendMessage(chatId, '⏳ Fetching trades from last 30 days...');
  
  const trades = await fetchTrades(500, 30);
  
  if (trades.length === 0) {
    return sendMessage(chatId, '📭 No trades in the last 30 days.');
  }
  
  // Calculate stats
  const buys = trades.filter(t => (t.txType || '').toLowerCase().includes('buy') || (t.txType || '').toLowerCase().includes('purchase'));
  const sells = trades.filter(t => (t.txType || '').toLowerCase().includes('sell') || (t.txType || '').toLowerCase().includes('sale'));
  
  // Top tickers
  const tickerCount = {};
  trades.forEach(t => {
    const ticker = t.asset?.assetTicker || 'N/A';
    tickerCount[ticker] = (tickerCount[ticker] || 0) + 1;
  });
  const topTickers = Object.entries(tickerCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  
  let msg = `🗓️ <b>Trades - Last 30 Days</b>

📊 <b>Summary:</b>
• Total trades: ${trades.length}
• Buys: ${buys.length} 🟢
• Sells: ${sells.length} 🔴
• Buy/Sell ratio: ${(buys.length / (sells.length || 1)).toFixed(2)}

📈 <b>Most Traded Tickers:</b>
${topTickers.map(([ticker, count], i) => `${i + 1}. <b>${ticker}</b> - ${count} trades`).join('\n')}

<b>Recent trades:</b>\n\n`;

  trades.slice(0, 10).forEach((t, i) => {
    msg += formatTrade(t, true, i + 1) + '\n\n';
  });
  
  await sendMessage(chatId, msg);
}

async function handleTop(chatId) {
  await sendMessage(chatId, '⏳ Analyzing most active traders...');
  
  const trades = await fetchTrades(500, 30);
  
  if (trades.length === 0) {
    return sendMessage(chatId, '❌ Could not fetch data.');
  }
  
  // Count by politician
  const traderCount = {};
  const traderParty = {};
  trades.forEach(t => {
    const name = t.politician?.name || 'Unknown';
    const party = t.politician?.party || '?';
    traderCount[name] = (traderCount[name] || 0) + 1;
    traderParty[name] = party;
  });
  
  const topTraders = Object.entries(traderCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  
  let msg = `🏆 <b>Most Active Traders (30 Days)</b>\n\n`;
  topTraders.forEach(([name, count], i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    msg += `${medal} <b>${name}</b> (${traderParty[name]})\n    ${count} trades\n\n`;
  });
  
  msg += `\n💡 <i>Use /search ${topTraders[0]?.[0]?.split(' ')[1] || 'Name'} to see their trades</i>`;
  
  await sendMessage(chatId, msg);
}

async function handleSearch(chatId, query) {
  if (!query || query.trim().length < 2) {
    return sendMessage(chatId, `🔍 <b>Search Congressional Trades</b>

<b>Usage:</b> /search <i>query</i>

<b>Search by politician:</b>
• /search Pelosi
• /search Tuberville
• /search Greene

<b>Search by stock ticker:</b>
• /search NVDA
• /search AAPL
• /search TSLA

<b>Search by company:</b>
• /search Microsoft
• /search Tesla

━━━━━━━━━━━━━━━━━━━━━
💡 <b>Don't know what to search?</b>
• /politicians - See all active politicians
• /tickers - See all traded stocks`);
  }
  
  await sendMessage(chatId, `🔍 Searching for "${query}"...`);
  
  const trades = await searchTrades(query.trim(), 10);
  
  if (trades.length === 0) {
    return sendMessage(chatId, `❌ No trades found for "${query}"`);
  }
  
  let msg = `🔍 <b>Search Results: "${query}"</b>\nFound ${trades.length} trade(s)\n\n`;
  trades.forEach((t, i) => {
    msg += formatTrade(t, true, i + 1) + '\n\n';
  });
  
  await sendMessage(chatId, msg);
}

async function handleStats(chatId) {
  await sendMessage(chatId, '⏳ Calculating market statistics...');
  
  const trades = await fetchTrades(500, 30);
  
  if (trades.length === 0) {
    return sendMessage(chatId, '❌ Could not fetch data.');
  }
  
  const buys = trades.filter(t => (t.txType || '').toLowerCase().includes('buy') || (t.txType || '').toLowerCase().includes('purchase'));
  const sells = trades.filter(t => (t.txType || '').toLowerCase().includes('sell') || (t.txType || '').toLowerCase().includes('sale'));
  
  // Party breakdown
  const demTrades = trades.filter(t => t.politician?.party === 'Democrat');
  const repTrades = trades.filter(t => t.politician?.party === 'Republican');
  
  // Sector analysis (by ticker patterns)
  const techTickers = ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'AMD', 'INTC', 'CRM', 'ORCL'];
  const techTrades = trades.filter(t => techTickers.includes(t.asset?.assetTicker));
  
  // Calculate total value
  let totalValue = 0;
  trades.forEach(t => {
    if (t.value) totalValue += Number(t.value);
  });
  
  const ratio = (buys.length / (sells.length || 1)).toFixed(2);
  const sentiment = ratio > 1.2 ? '📈 Bullish' : ratio < 0.8 ? '📉 Bearish' : '➡️ Neutral';
  
  let msg = `📈 <b>Congressional Trading Statistics</b>
<i>Last 30 days</i>

━━━━━━━━━━━━━━━━━━━━━

📊 <b>Overall Activity:</b>
• Total trades: ${trades.length}
• Estimated value: $${(totalValue / 1000000).toFixed(1)}M+
• Unique politicians: ${new Set(trades.map(t => t.politician?.name)).size}

💹 <b>Buy/Sell Analysis:</b>
• Buys: ${buys.length} 🟢
• Sells: ${sells.length} 🔴
• Ratio: ${ratio}
• Sentiment: ${sentiment}

🏛️ <b>By Party:</b>
• Democrats: ${demTrades.length} trades
• Republicans: ${repTrades.length} trades

💻 <b>Tech Sector:</b>
• Tech trades: ${techTrades.length} (${((techTrades.length / trades.length) * 100).toFixed(0)}% of total)

━━━━━━━━━━━━━━━━━━━━━
💡 <i>Congress has historically outperformed the S&P 500</i>`;

  await sendMessage(chatId, msg);
}

async function handlePoliticians(chatId) {
  await sendMessage(chatId, '⏳ Fetching list of politicians...');
  
  const trades = await fetchTrades(500, 90); // Last 90 days
  
  if (trades.length === 0) {
    return sendMessage(chatId, '❌ Could not fetch data.');
  }
  
  // Get unique politicians with trade counts
  const politicians = {};
  trades.forEach(t => {
    const name = t.politician?.name;
    const party = t.politician?.party || '?';
    const state = t.politician?.state || '?';
    const chamber = t.politician?.chamber || '';
    if (name) {
      if (!politicians[name]) {
        politicians[name] = { party, state, chamber, count: 0 };
      }
      politicians[name].count++;
    }
  });
  
  // Sort by trade count
  const sorted = Object.entries(politicians)
    .sort((a, b) => b[1].count - a[1].count);
  
  const total = sorted.length;
  
  // Split into Democrats and Republicans
  const dems = sorted.filter(([_, info]) => info.party === 'Democrat');
  const reps = sorted.filter(([_, info]) => info.party === 'Republican');
  
  let msg = `👥 <b>Politicians Trading (Last 90 Days)</b>
Found ${total} active traders

🔵 <b>Democrats (${dems.length}):</b>
${dems.slice(0, 15).map(([name, info]) => `• ${name} (${info.state}) - ${info.count} trades`).join('\n')}
${dems.length > 15 ? `<i>...and ${dems.length - 15} more</i>` : ''}

🔴 <b>Republicans (${reps.length}):</b>
${reps.slice(0, 15).map(([name, info]) => `• ${name} (${info.state}) - ${info.count} trades`).join('\n')}
${reps.length > 15 ? `<i>...and ${reps.length - 15} more</i>` : ''}

━━━━━━━━━━━━━━━━━━━━━
💡 <i>Use /search [name] to see their trades</i>
<i>Example: /search Pelosi</i>`;

  await sendMessage(chatId, msg);
}

async function handleTickers(chatId) {
  await sendMessage(chatId, '⏳ Fetching traded stocks...');
  
  const trades = await fetchTrades(500, 30);
  
  if (trades.length === 0) {
    return sendMessage(chatId, '❌ Could not fetch data.');
  }
  
  // Get unique tickers with counts and buy/sell info
  const tickers = {};
  trades.forEach(t => {
    const ticker = t.asset?.assetTicker;
    const company = t.asset?.assetName || 'Unknown';
    const type = (t.txType || '').toLowerCase();
    const isBuy = type.includes('buy') || type.includes('purchase');
    
    if (ticker && ticker !== 'N/A') {
      if (!tickers[ticker]) {
        tickers[ticker] = { company, buys: 0, sells: 0, total: 0 };
      }
      tickers[ticker].total++;
      if (isBuy) {
        tickers[ticker].buys++;
      } else {
        tickers[ticker].sells++;
      }
    }
  });
  
  // Sort by total trades
  const sorted = Object.entries(tickers)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 30);
  
  let msg = `📈 <b>Most Traded Stocks (Last 30 Days)</b>

`;

  sorted.forEach(([ticker, info], i) => {
    const sentiment = info.buys > info.sells ? '🟢' : info.sells > info.buys ? '🔴' : '⚪';
    msg += `<b>${i + 1}. ${ticker}</b> ${sentiment}
   ${info.company.substring(0, 30)}${info.company.length > 30 ? '...' : ''}
   📊 ${info.total} trades (${info.buys} buys / ${info.sells} sells)\n\n`;
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━
💡 <i>Use /search [ticker] to see all trades</i>
<i>Example: /search NVDA</i>`;

  await sendMessage(chatId, msg);
}

async function handleHelp(chatId) {
  const isGroupChat = isGroup(chatId);
  
  const helpMsg = `📖 <b>Congressional Trade Alerts — Help Guide</b>

━━━━━━━━━━━━━━━━━━━━━

<b>🔔 AUTOMATIC ALERTS</b>

The bot checks for new congressional trades every hour. When new trades are found, ${isGroupChat ? 'this group' : 'you'} will receive an instant notification.

• /start — Enable alerts
• /stop — Disable alerts

━━━━━━━━━━━━━━━━━━━━━

<b>📊 VIEW RECENT TRADES</b>

<b>/latest</b>
Shows the 10 most recent trades with full details including politician name, party, stock ticker, trade type (buy/sell), and value.

<b>/today</b>
All trades from the last 24 hours.

<b>/week</b>
Summary of the last 7 days, grouped by date.

<b>/month</b>
Last 30 days with statistics: total trades, buy/sell ratio, most traded tickers.

━━━━━━━━━━━━━━━━━━━━━

<b>🔍 RESEARCH TOOLS</b>

<b>/politicians</b>
Browse all politicians who have traded in the last 90 days. Lists Democrats and Republicans separately with trade counts. Great for discovering who to track!

<b>/tickers</b>
See the top 30 most traded stocks. Shows buy/sell breakdown for each ticker. Useful for spotting trends.

<b>/search [query]</b>
Search by politician name, stock ticker, or company.

Examples:
• <code>/search Pelosi</code> — Nancy Pelosi's trades
• <code>/search NVDA</code> — All NVIDIA trades  
• <code>/search Microsoft</code> — Microsoft trades

<b>/top</b>
Leaderboard of most active traders in the last 30 days.

━━━━━━━━━━━━━━━━━━━━━

<b>📈 ANALYSIS</b>

<b>/stats</b>
Market statistics including:
• Total trade volume
• Buy/sell ratio & sentiment
• Party breakdown (Dem vs Rep)
• Tech sector activity

━━━━━━━━━━━━━━━━━━━━━

<b>💡 TIPS</b>

• Politicians must disclose within 45 days, so trades may be delayed
• Large trades ($1M+) are often most significant
• Watch for unusual activity before major legislation
• Compare /stats over time to spot trends

━━━━━━━━━━━━━━━━━━━━━

<b>🔗 DATA SOURCE</b>
Trades are sourced from official STOCK Act filings via Capitol Trades.

${isGroupChat ? '\n<b>👥 GROUP MODE</b>\nThis bot works in groups! Alerts go to everyone. Only admins should use /stop to disable.' : ''}`;

  await sendMessage(chatId, helpMsg);
}

// ==================== POLLING FOR UPDATES ====================

let lastUpdateId = 0;
let isPolling = false;

async function clearWebhookAndGetUpdates() {
  // Delete any existing webhook to prevent conflicts
  await telegramRequest('deleteWebhook', { drop_pending_updates: true });
  console.log('✅ Cleared any existing webhooks');
}

async function pollUpdates() {
  if (isPolling) return; // Prevent concurrent polls
  isPolling = true;
  
  try {
    const result = await telegramRequest('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ['message']
    });
    
    if (!result || !result.result) {
      isPolling = false;
      return;
    }
    
    for (const update of result.result) {
      lastUpdateId = update.update_id;
      await processUpdate(update);
    }
  } catch (err) {
    if (err.message?.includes('Conflict')) {
      console.log('⚠️ Polling conflict detected, clearing...');
      await clearWebhookAndGetUpdates();
    } else {
      console.error('Polling error:', err.message);
    }
  }
  
  isPolling = false;
}

async function processUpdate(update) {
  try {
      
      if (update.message?.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text;
        const username = update.message.from?.username || 'unknown';
        const chatTitle = update.message.chat.title || null; // Group name if in group
        const chatType = update.message.chat.type; // 'private', 'group', 'supergroup'
        
        // Log with chat type info
        if (chatType === 'private') {
          console.log(`📨 @${username}: ${text}`);
        } else {
          console.log(`📨 [${chatTitle}] @${username}: ${text}`);
        }
        
        const [command, ...args] = text.split(' ');
        const query = args.join(' ');
        
        // Handle commands (strip bot username for group commands like /start@botname)
        const cleanCommand = command.toLowerCase().split('@')[0];
        
        switch (cleanCommand) {
          case '/start':
            await handleStart(chatId, username, chatTitle);
            break;
          case '/stop':
            await handleStop(chatId);
            break;
          case '/latest':
            await handleLatest(chatId);
            break;
          case '/today':
            await handleToday(chatId);
            break;
          case '/week':
            await handleWeek(chatId);
            break;
          case '/month':
            await handleMonth(chatId);
            break;
          case '/top':
            await handleTop(chatId);
            break;
          case '/politicians':
            await handlePoliticians(chatId);
            break;
          case '/tickers':
            await handleTickers(chatId);
            break;
          case '/search':
            await handleSearch(chatId, query);
            break;
          case '/stats':
            await handleStats(chatId);
            break;
          case '/help':
            await handleHelp(chatId);
            break;
          default:
            // Only respond to unknown commands in private chats to avoid spam in groups
            if (text.startsWith('/') && chatType === 'private') {
              await sendMessage(chatId, '❓ Unknown command. Use /help to see all available commands.');
            }
        }
      }
      
      // Handle when bot is added to a group
      if (update.message?.new_chat_members) {
        const botInfoData = await getBotInfo();
        const wasAdded = update.message.new_chat_members.some(m => m.id === botInfoData?.id);
        if (wasAdded) {
          const chatId = update.message.chat.id;
          const chatTitle = update.message.chat.title;
          console.log(`🎉 Bot added to group: ${chatTitle}`);
          await handleStart(chatId, 'group', chatTitle);
        }
      }
  } catch (err) {
    console.error('Error processing update:', err.message);
  }
}

let botInfo = null;
async function getBotInfo() {
  if (!botInfo) {
    const result = await telegramRequest('getMe');
    botInfo = result?.result || null;
  }
  return botInfo;
}

async function getBotUsername() {
  const info = await getBotInfo();
  return info?.username || '';
}

// ==================== AUTO ALERTS ====================

function getTradeId(trade) {
  return trade._id || `${trade.politician?.name || ''}-${trade.asset?.assetTicker || ''}-${trade.txDate}-${trade.value}`;
}

async function checkAndAlertNewTrades() {
  console.log(`[${new Date().toISOString()}] Checking for new trades...`);
  
  const trades = await fetchTrades(50);
  
  if (trades.length === 0) {
    console.log('No trades fetched from any source.');
    return;
  }
  
  console.log(`Processing ${trades.length} trades...`);
  
  const newTrades = [];
  
  for (const trade of trades) {
    const id = getTradeId(trade);
    if (!botData.seenTrades.includes(id)) {
      newTrades.push(trade);
      botData.seenTrades.push(id);
    }
  }
  
  if (newTrades.length > 0 && botData.subscribers.length > 0) {
    console.log(`📢 Alerting ${botData.subscribers.length} subscribers about ${newTrades.length} new trades`);
    
    for (const trade of newTrades.slice(0, 5)) {
      const msg = `🚨 <b>New Congressional Trade</b>\n\n${formatTrade(trade)}`;
      
      for (const chatId of botData.subscribers) {
        await sendMessage(chatId, msg);
        await new Promise(r => setTimeout(r, 100));
      }
      
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    console.log('No new trades to alert.');
  }
  
  botData.lastCheck = new Date().toISOString();
  saveData();
}

// ==================== MAIN ====================

async function main() {
  console.log('');
  console.log('🏛️ Congressional Trade Alert Bot v2.0');
  console.log('======================================');
  console.log('');
  
  if (!CONFIG.telegramBotToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN is required');
    process.exit(1);
  }
  
  // Load persisted data
  loadData();
  
  // Clear any existing webhooks to prevent conflicts
  await clearWebhookAndGetUpdates();
  
  // Set bot commands menu
  await setCommands();
  console.log('✅ Bot commands registered');
  
  // Get bot info
  const botInfoResult = await telegramRequest('getMe');
  if (botInfoResult?.result) {
    console.log(`✅ Bot: @${botInfoResult.result.username}`);
  }
  
  // Start polling for messages (with longer interval to avoid conflicts)
  console.log('✅ Listening for messages...');
  setInterval(pollUpdates, 2000); // Poll every 2 seconds instead of 1
  
  // Start auto-alerts
  console.log('✅ Auto-alerts scheduled (every 60 minutes)');
  await checkAndAlertNewTrades(); // Initial check
  setInterval(checkAndAlertNewTrades, CONFIG.checkIntervalMs);
  
  console.log('');
  console.log('🚀 Bot is running!');
  console.log('');
  
  // Keep alive
  process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    saveData();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    saveData();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
