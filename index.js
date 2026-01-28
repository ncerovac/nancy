const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  checkIntervalMs: 60 * 60 * 1000, // Check every hour
  dataFile: path.join(__dirname, 'last_seen_trades.json'),
};

// Data sources for congressional trades
const DATA_SOURCES = {
  house: 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json',
  senate: 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json',
};

// Load last seen trades
function loadLastSeenTrades() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading last seen trades:', err.message);
  }
  return { house: new Set(), senate: new Set(), lastCheck: null };
}

// Save last seen trades
function saveLastSeenTrades(data) {
  const toSave = {
    house: Array.from(data.house),
    senate: Array.from(data.senate),
    lastCheck: data.lastCheck,
  };
  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(toSave, null, 2));
}

// Generate unique ID for a trade
function getTradeId(trade, chamber) {
  if (chamber === 'house') {
    return `${trade.representative}-${trade.ticker}-${trade.transaction_date}-${trade.amount}`;
  }
  return `${trade.senator}-${trade.ticker}-${trade.transaction_date}-${trade.amount}`;
}

// Fetch trades from a data source
async function fetchTrades(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error(`Error fetching trades from ${url}:`, err.message);
    return [];
  }
}

// Send Telegram message
async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.description || 'Telegram API error');
    }
    
    return true;
  } catch (err) {
    console.error('Error sending Telegram message:', err.message);
    return false;
  }
}

// Format trade for Telegram
function formatTrade(trade, chamber) {
  const name = chamber === 'house' ? trade.representative : trade.senator;
  const party = trade.party || '?';
  const state = trade.state || trade.district || '?';
  const type = (trade.type || trade.transaction_type || 'Unknown').toLowerCase();
  const ticker = trade.ticker || 'N/A';
  const company = trade.asset_description || trade.asset || 'Unknown';
  const amount = trade.amount || 'Unknown';
  const date = trade.transaction_date || trade.disclosure_date || 'Unknown';
  
  const emoji = type.includes('purchase') || type.includes('buy') ? '🟢' : 
                type.includes('sale') || type.includes('sell') ? '🔴' : '⚪';
  
  return `${emoji} <b>${ticker}</b> - ${type.toUpperCase()}
🏛️ <b>${name}</b> (${party}-${state})
💰 Amount: ${amount}
🏢 ${company}
📅 ${date}`;
}

// Check for new trades
async function checkForNewTrades() {
  console.log(`[${new Date().toISOString()}] Checking for new trades...`);
  
  const lastSeen = loadLastSeenTrades();
  
  // Convert arrays back to Sets if loaded from file
  if (Array.isArray(lastSeen.house)) {
    lastSeen.house = new Set(lastSeen.house);
  }
  if (Array.isArray(lastSeen.senate)) {
    lastSeen.senate = new Set(lastSeen.senate);
  }
  
  const newTrades = [];
  
  // Check House trades
  const houseTrades = await fetchTrades(DATA_SOURCES.house);
  console.log(`Fetched ${houseTrades.length} House trades`);
  
  for (const trade of houseTrades.slice(0, 500)) {
    const id = getTradeId(trade, 'house');
    if (!lastSeen.house.has(id)) {
      newTrades.push({ trade, chamber: 'house' });
      lastSeen.house.add(id);
    }
  }
  
  // Check Senate trades
  const senateTrades = await fetchTrades(DATA_SOURCES.senate);
  console.log(`Fetched ${senateTrades.length} Senate trades`);
  
  for (const trade of senateTrades.slice(0, 500)) {
    const id = getTradeId(trade, 'senate');
    if (!lastSeen.senate.has(id)) {
      newTrades.push({ trade, chamber: 'senate' });
      lastSeen.senate.add(id);
    }
  }
  
  // Send notifications for new trades
  if (newTrades.length > 0) {
    console.log(`Found ${newTrades.length} new trades!`);
    
    // Limit to 10 most recent to avoid spam on first run
    const tradesToNotify = newTrades.slice(0, 10);
    
    if (newTrades.length > 10) {
      await sendTelegram(`📊 <b>Congressional Trade Alert</b>\n\nFound ${newTrades.length} new trades. Showing most recent 10:`);
    }
    
    for (const { trade, chamber } of tradesToNotify) {
      const message = formatTrade(trade, chamber);
      await sendTelegram(message);
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    console.log('No new trades found.');
  }
  
  // Save updated state
  lastSeen.lastCheck = new Date().toISOString();
  saveLastSeenTrades(lastSeen);
  
  return newTrades.length;
}

// Main function
async function main() {
  console.log('🏛️ Congressional Trade Alert Service');
  console.log('=====================================\n');
  
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    console.error('❌ Missing required environment variables:');
    console.error('   - TELEGRAM_BOT_TOKEN: Your Telegram bot token from @BotFather');
    console.error('   - TELEGRAM_CHAT_ID: Your chat ID (get it from @userinfobot)\n');
    process.exit(1);
  }
  
  await sendTelegram('🚀 <b>Congressional Trade Alert Service Started</b>\n\nYou will receive notifications when members of Congress trade stocks.');
  
  await checkForNewTrades();
  
  console.log(`\nScheduled to check every ${CONFIG.checkIntervalMs / 60000} minutes.`);
  setInterval(checkForNewTrades, CONFIG.checkIntervalMs);
}

main().catch(console.error);
