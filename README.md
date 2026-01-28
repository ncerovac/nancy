# 🏛️ Congress Trade Bot

Real-time Telegram alerts when U.S. Congress members trade stocks.

![Version](https://img.shields.io/badge/version-3.3.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-gray)
![Security](https://img.shields.io/badge/security-hardened-brightgreen)

---

## Why?

Congress members must disclose stock trades within 45 days under the STOCK Act. Studies show their portfolios often outperform the market. This bot lets you track what they're buying and selling.

---

## Features

- 🔔 **Real-time alerts** — Get notified when new trades drop
- 👥 **Multi-user** — Works in DMs and group chats
- 🔍 **Search** — Find trades by politician or ticker (clickable!)
- 📊 **Analytics** — Buy/sell ratios, top traders, trends
- 📈 **Chart links** — One-tap to Yahoo Finance
- 🔄 **Auto-retry** — Handles flaky APIs automatically
- 💾 **Persistent storage** — Subscribers survive restarts
- 🔒 **Security hardened** — XSS protection, rate limiting, input validation

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
| `/politicians` | Browse active traders (clickable) |
| `/politicians_all` | View complete list |
| `/tickers` | Browse traded stocks (clickable) |
| `/tickers_all` | View complete list |
| `/search [query]` | Search by name/ticker |
| `/top` | Most active traders |
| `/stats` | Market statistics |
| `/status` | Bot health & uptime |
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
5. Add variables (see below)
6. **Add Volume** for persistent storage:
   - Mount path: `/app/data`
7. Deploy

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `DATA_DIR` | No | Path for persistent storage (set to `/app/data` with Railway volume) |
| `ADMIN_ID` | No | Your Telegram user ID for admin commands |

**Admin commands** (only work for ADMIN_ID):
- `/debug` — View recent logs
- `/subs` — List all subscribers

---

## Self-Hosting

```bash
git clone https://github.com/ncerovac/nancy.git
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

Pulls from multiple sources with automatic fallback and retry:
1. Quiver Quant
2. House Stock Watcher
3. Senate Stock Watcher

Data sourced from official STOCK Act filings.

---

## Security

This bot is security-hardened for public deployment:

| Protection | Description |
|------------|-------------|
| **XSS Prevention** | All output HTML-escaped |
| **Input Validation** | Commands, queries, IDs validated |
| **Rate Limiting** | 1 request/second per user |
| **Safe File I/O** | Atomic writes, validated JSON parsing |
| **No Secrets in Code** | Token loaded from environment only |

⚠️ **Never commit your `TELEGRAM_BOT_TOKEN` to the repo!**

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

## Contributing

PRs welcome! Please ensure any changes maintain security standards.

---

<p align="center">
  <b>⭐ Star if useful!</b>
</p>
