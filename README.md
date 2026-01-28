# 🏛️ Congressional Trade Alerts Bot

> Real-time Telegram alerts when U.S. Congress members trade stocks

---

## 📌 What Is This?

Members of the U.S. Congress are required to publicly disclose their stock trades within 45 days under the [STOCK Act](https://en.wikipedia.org/wiki/STOCK_Act). Studies have shown that congressional portfolios often outperform the market.

This bot monitors those disclosures and sends you instant Telegram alerts when politicians buy or sell stocks.

**Features:**
- 🔔 **Real-time alerts** — Get notified when new trades are published
- 👥 **Multi-user** — Share with friends, works in group chats
- 🔍 **Search** — Look up trades by politician or stock ticker
- 📊 **Analytics** — Buy/sell ratios, most active traders, trends

---

## 🚀 Quick Start

### Use an Existing Bot
If someone shared a bot link with you, just:
1. Click the link or search for the bot on Telegram
2. Press **Start**
3. Done! You'll receive alerts automatically.

### Deploy Your Own (5 minutes)

#### Step 1: Create a Telegram Bot
1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name: `Congressional Trade Alerts`
4. Choose a username: `MyCongressTradesBot` (must be unique)
5. Copy the **API token** you receive

#### Step 2: Deploy to Railway (Free)
1. Fork this repository
2. Go to [railway.app](https://railway.app) and sign in with GitHub
3. Click **New Project** → **Deploy from GitHub repo**
4. Select your forked repo
5. Go to **Variables** and add:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   ```
6. Click **Deploy**

#### Step 3: Share with Friends
Share your bot's username (e.g., `@MyCongressTradesBot`). Anyone can subscribe!

---

## 📱 Bot Commands

### 🔔 Alerts
| Command | Description |
|---------|-------------|
| `/start` | Subscribe to automatic alerts |
| `/stop` | Unsubscribe from alerts |

### 📊 View Trades
| Command | Description |
|---------|-------------|
| `/latest` | Last 10 trades with full details |
| `/today` | All trades from last 24 hours |
| `/week` | Last 7 days, grouped by date |
| `/month` | Last 30 days + statistics |

### 🔍 Research
| Command | Description |
|---------|-------------|
| `/politicians` | Browse all active traders by party |
| `/tickers` | Top 30 most traded stocks |
| `/search [query]` | Search by name, ticker, or company |
| `/top` | Leaderboard of most active traders |

### 📈 Analysis
| Command | Description |
|---------|-------------|
| `/stats` | Buy/sell ratios, party breakdown, trends |

### ❓ Help
| Command | Description |
|---------|-------------|
| `/help` | Detailed guide with examples |

---

## 🔍 Search Examples

```
/search Pelosi        → Nancy Pelosi's trades
/search Tuberville    → Tommy Tuberville's trades
/search NVDA          → All NVIDIA trades
/search AAPL          → All Apple trades
/search Microsoft     → Microsoft trades
/search Tesla         → Tesla trades
```

**Pro tip:** Use `/politicians` to see all active traders, then search their name!

---

## 👥 Group Chat Support

The bot works in Telegram groups:

1. Add the bot to your group
2. The bot will automatically introduce itself
3. All group members can use commands
4. Trade alerts go to the entire group

**For group admins:**
- Use `/start` to enable alerts
- Use `/stop` to disable alerts
- Bot only responds to valid commands (no spam)

---

## 📬 Alert Format

When a new trade is detected, you'll receive:

```
🚨 New Congressional Trade

🟢 NVDA - BUY
   👤 Nancy Pelosi (D-CA) 🏠
   💰 $1,000,001 - $5,000,000 | 📅 2024-01-15
   🏢 NVIDIA Corporation
```

- 🟢 = Buy/Purchase
- 🔴 = Sell/Sale
- 🏠 = House of Representatives
- 🏛️ = Senate

---

## 🛠️ Self-Hosting

### Requirements
- Node.js 18+
- A Telegram Bot Token

### Local Development
```bash
# Clone the repo
git clone https://github.com/yourusername/nancy.git
cd nancy

# Set environment variable
export TELEGRAM_BOT_TOKEN="your_token_here"

# Run
npm start
```

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Your bot token from @BotFather |

### Deployment Options

**Railway** (recommended)
- Free tier available
- Auto-deploys from GitHub

**Render**
1. Create a new "Background Worker"
2. Connect your GitHub repo
3. Add environment variables
4. Deploy

**VPS/Server**
```bash
# Using PM2 for persistence
npm install -g pm2
pm2 start index.js --name congress-bot
pm2 save
pm2 startup
```

---

## 📊 Data Source

Trade data is sourced from [Capitol Trades](https://www.capitoltrades.com/), which aggregates official STOCK Act filings from:
- [House of Representatives](https://disclosures-clerk.house.gov/PublicDisclosure/FinancialDisclosure)
- [Senate](https://efdsearch.senate.gov/search/)

**Note:** Trades may be up to 45 days old when disclosed. This is a limitation of the STOCK Act, not this bot.

---

## ⚠️ Disclaimer

This bot is for informational purposes only. It is not financial advice. Congressional trading data is delayed and should not be used as the sole basis for investment decisions. Always do your own research.

---

## 📄 License

MIT — feel free to fork, modify, and share!

---

## 🙏 Credits

- Data: [Capitol Trades](https://www.capitoltrades.com/)
- Inspired by: [House Stock Watcher](https://housestockwatcher.com/), [Quiver Quant](https://www.quiverquant.com/)

---

<p align="center">
  <b>⭐ Star this repo if you find it useful!</b>
</p>
