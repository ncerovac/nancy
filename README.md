# 🏛️ Congressional Trade Alerts (Telegram)

Get instant Telegram notifications when members of Congress trade stocks.

## Setup (5 minutes)

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Follow prompts to name your bot
4. Copy the **API token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Get Your Chat ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your **chat ID** (a number like `123456789`)

### 3. Run the Service

```bash
# Clone/download this folder, then:
cd congress-trade-alerts

# Set your credentials
export TELEGRAM_BOT_TOKEN="your_bot_token_here"
export TELEGRAM_CHAT_ID="your_chat_id_here"

# Run it
npm start
```

## Running 24/7

### Option A: Keep it running on your computer
```bash
# Using PM2 (recommended)
npm install -g pm2
pm2 start index.js --name congress-alerts
pm2 save
pm2 startup
```

### Option B: Deploy to a free cloud service

**Railway.app** (easiest):
1. Push to GitHub
2. Connect to Railway
3. Add environment variables in Railway dashboard
4. Deploy!

**Render.com**:
1. Create a new "Background Worker"
2. Connect your repo
3. Add environment variables
4. Deploy!

## How It Works

- Checks public STOCK Act disclosure data every hour
- Compares against previously seen trades
- Sends you a Telegram message for each new trade
- Stores state locally to avoid duplicate alerts

## Data Sources

- [House Stock Watcher](https://housestockwatcher.com/)
- [Senate Stock Watcher](https://senatestockwatcher.com/)

## Example Alert

```
🟢 NVDA - PURCHASE
🏛️ Nancy Pelosi (D-CA)
💰 Amount: $1,000,001 - $5,000,000
🏢 NVIDIA Corporation
📅 2024-01-15
```

## Customization

Edit `index.js` to:
- Change check frequency (`checkIntervalMs`)
- Filter by specific politicians
- Filter by ticker symbols
- Change alert format

## License

MIT
