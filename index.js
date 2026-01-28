const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  checkIntervalMs: 60 * 60 * 1000, // Check every hour
  dataFile: path.join(__dirname, 'last_seen_trades.json'),
};

// Updated data sources (using APIs that allow server requests)
const DATA_SOURCES = {
  // Capitol Trades API (public)
  capitolTrades: 'https://bff.capitoltrades.com/trades?page=1&pageSize=100',
};

// Load last seen trades
function loadLastSeenTrades() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
      return {
        trades: new Set(Array.isArray(data.trades) ? data.trades : []),
        lastCheck: data.lastCheck
      };
    }
  } catch (err) {
    console.error('Error loading last seen trades:', err.message);
  }
  return { trades: new Set(), lastCheck: null };
}

// Save last seen trades
function saveLastSeenTrades(data) {
  const toSave = {
    trades: Array.from(data.trades).slice(-1000), // Keep last 1000 to prevent file bloat
    lastCheck: data.lastCheck,
  };
  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(toSave, null, 2));
}

// Generate unique ID for a trade
function getTradeId(trade) {
  return `${trade.politician?.name || trade.politicianId}-${trade.asset?.assetTicker || 'N/A'}-${trade.txDate}-${trade.value}`;
}

// Fetch trades from Capitol Trades
async function fetchTrades() {
  try {
    const response = await fetch(DATA_SOURCES.capitolTrades, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CongressTradeAlert/1.0)',
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (err) {
    console.error(`Error fetching trades:`, err.message);
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
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.description || 'Telegram API error');
    }
    
    console.log('✅ Telegram message sent successfully');
    return true;
  } catch (err) {
    console.error('❌ Error sending Telegram message:', err.message);
    return false;
  }
}

// Format trade for Telegram
function formatTrade(trade) {
  const name = trade.politician?.name || 'Unknown';
  const party = trade.politician?.party || '?';
  const state = trade.politician?.state || '?';
  const chamber = trade.politician?.chamber || 'Congress';
  const type = (trade.txType || 'unknown').toLowerCase();
  const ticker = trade.asset?.assetTicker || 'N/A';
  const company = trade.asset?.assetName || 'Unknown';
  const value = trade.value ? `$${trade.value.toLocaleString()}` : 'Unknown';
  const date = trade.txDate || 'Unknown';
  
  const emoji = type.includes('buy') || type.includes('purchase') ? '🟢' : 
                type.includes('sell') || type.includes('sale') ? '🔴' : '⚪';
  
  const chamberEmoji = chamber.toLowerCase() === 'senate' ? '🏛️ Senate' : '🏛️ House';
  
  return `${emoji} <b>${ticker}</b> - ${type.toUpperCase()}

👤 <b>${name}</b> (${party}-${state})
${chamberEmoji}
💰 Value: ${value}
🏢 ${company}
📅 ${date}`;
}

// Check for new trades
async function checkForNewTrades() {
  console.log(`[${new Date().toISOString()}] Checking for new trades...`);
  
  const lastSeen = loadLastSeenTrades();
  const newTrades = [];
  
  const trades = await fetchTrades();
  console.log(`Fetched ${trades.length} trades from Capitol Trades`);
  
  if (trades.length === 0) {
    console.log('No trades fetched. Will retry next cycle.');
    return 0;
  }
  
  for (const trade of trades) {
    const id = getTradeId(trade);
    if (!lastSeen.trades.has(id)) {
      newTrades.push(trade);
      lastSeen.trades.add(id);
    }
  }
  
  // Send notifications for new trades
  if (newTrades.length > 0) {
    console.log(`Found ${newTrades.length} new trades!`);
    
    // Limit to 5 most recent to avoid spam on first run
    const tradesToNotify = newTrades.slice(0, 5);
    
    if (newTrades.length > 5) {
      await sendTelegram(`📊 <b>Congressional Trade Alert</b>\n\nFound ${newTrades.length} new trades. Showing 5 most recent:`);
    }
    
    for (const trade of tradesToNotify) {
      const message = formatTrade(trade);
      await sendTelegram(message);
      await new Promise(r => setTimeout(r, 1000)); // 1 sec delay between messages
    }
  } else {
    console.log('No new trades found.');
  }
  
  // Save updated state
  lastSeen.lastCheck = new Date().toISOString();
  saveLastSeenTrades(lastSeen);
  
  return newTrades.length;
}

// Test Telegram connection
async function testTelegram() {
  console.log('Testing Telegram connection...');
  console.log(`Bot Token: ${CONFIG.telegramBotToken ? '✓ Set' : '✗ Missing'}`);
  console.log(`Chat ID: ${CONFIG.telegramChatId ? '✓ Set (' + CONFIG.telegramChatId + ')' : '✗ Missing'}`);
  
  const success = await sendTelegram('🚀 <b>Congressional Trade Alert Service Started</b>\n\nYou will receive notifications when members of Congress trade stocks.\n\n✅ Connection successful!');
  
  return success;
}

// Main function
async function main() {
  console.log('');
  console.log('🏛️ Congressional Trade Alert Service');
  console.log('=====================================');
  console.log('');
  
  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    console.error('❌ Missing required environment variables:');
    if (!CONFIG.telegramBotToken) console.error('   - TELEGRAM_BOT_TOKEN');
    if (!CONFIG.telegramChatId) console.error('   - TELEGRAM_CHAT_ID');
    console.error('');
    console.error('Set these in Railway Variables tab and redeploy.');
    process.exit(1);
  }
  
  // Test connection first
  const connected = await testTelegram();
  
  if (!connected) {
    console.error('');
    console.error('❌ Failed to connect to Telegram. Please check:');
    console.error('   1. TELEGRAM_BOT_TOKEN is correct (from @BotFather)');
    console.error('   2. TELEGRAM_CHAT_ID is your user ID (from @userinfobot)');
    console.error('   3. You have started a chat with your bot first');
    console.error('');
    // Don't exit - keep trying in case it's a temporary issue
  }
  
  // Initial check
  await checkForNewTrades();
  
  // Schedule periodic checks
  console.log('');
  console.log(`✅ Scheduled to check every ${CONFIG.checkIntervalMs / 60000} minutes.`);
  console.log('');
  
  setInterval(checkForNewTrades, CONFIG.checkIntervalMs);
  
  // Keep process alive
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
