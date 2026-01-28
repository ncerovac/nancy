# 🏛️ Congress Trade Bot

Real-time Telegram alerts when U.S. Congress members trade stocks.

![Version](https://img.shields.io/badge/version-3.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-gray)

---

## Why?

Congress members must disclose stock trades within 45 days under the STOCK Act. Studies show their portfolios often outperform the market. This bot lets you track what they're buying and selling.

---

## Features

- 🔔 **Real-time alerts** — Get notified when new trades drop
- 👥 **Multi-user** — Works in DMs and group chats
- 🔍 **Search** — Find trades by politician or ticker
- 📊 **Analytics** — Buy/sell ratios, top traders, trends
- 📈 **Chart links** — One-tap to Yahoo Finance

---

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Subscribe to alerts |
| `/stop` | Unsubscribe |
| `/latest` | Last 10 trades |
| `/today` | Last 24 hours |
| `/week` | Last 7 days |
| `/month` | Last 30 days + stats |
| `/politicians` | Browse all active traders |
| `/tickers` | Browse all traded stocks |
| `/search [query]` | Search by name/ticker |
| `/top` | Most active traders |
| `/stats` | Market statistics |
| `/help` | Full command guide |

---

## Example Alert

```
🚨 New Trade

🟢 NVDA — NVIDIA Corporation
   📋 PURCHASE
   👤 Nancy Pelosi (Dem, CA) 🏠
   💰 $1,000,001 | 📅 2024-01-15
```

Ticker links directly to Yahoo Finance chart.

---

## Deploy Your Own

### 1. Create Telegram Bot

1. Message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Pick a name and username
4. Copy the API token

### 2. Deploy to Railway

1. Fork this repo
2. Go to [railway.app](https://railway.app)
3. **New Project** → **Deploy from GitHub**
4. Select your fork
5. Add variable: `TELEGRAM_BOT_TOKEN=your_token`
6. Deploy

### 3. Share

Send your bot's username to friends. They just press Start!

---

## Self-Hosting

```bash
git clone https://github.com/yourusername/nancy.git
cd nancy
export TELEGRAM_BOT_TOKEN="your_token"
npm start
```

**Keep running 24/7:**
```bash
npm install -g pm2
pm2 start index.js --name congress-bot
pm2 save && pm2 startup
```

---

## Group Chats

Add the bot to any group:
- Auto-introduces itself
- All members can use commands
- Alerts go to everyone
- `/stop` disables for whole group

---

## Data Sources

Pulls from multiple sources with automatic fallback:
1. Quiver Quant
2. House Stock Watcher
3. Senate Stock Watcher

Data sourced from official STOCK Act filings.

---

## Tech

- **Runtime:** Node.js 18+
- **APIs:** Telegram Bot API, public trade APIs
- **Hosting:** Railway, Render, or any Node host
- **Dependencies:** None (zero npm packages!)

---

## Disclaimer

For informational purposes only. Not financial advice. Trades may be up to 45 days old when disclosed.

---

## License

MIT

---

<p align="center">
  <b>⭐ Star if useful!</b>
</p>
