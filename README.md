# ⚡ Telegram Digital License Shop Bot & Admin Dashboard

A professional, dynamic, database-driven Telegram Digital License/Key Shop Bot with a complete Web Admin Dashboard, 2-tier atomic fulfillment engine, UPI Auto & Binance Pay top-up systems, and external License Dashboard (LD) API product mapping.

---

## 🌟 Key Features

- 🛒 **Dynamic Telegram Shop Bot**:
  - Polished `/start` menu with custom promotional greeting.
  - **Dynamic Catalog**: Services, validities, and pricing loaded dynamically from SQLite database (no hardcoding).
  - **Atomic 2-Tier Fulfillment Engine**:
    1. **Tier 1 (Local Stock)**: Instant lock and delivery of available local keys.
    2. **Tier 2 (License Provider API)**: Automatic fallback to mapped external LD API product when local stock is `0`.
    3. **Fail-Safe Rollback**: Auto-refunds user balance if external API is empty or times out.
  - **Race-Condition Protection**: Atomic database locks prevent double allocation across simultaneous customer purchases.
  - **Order History (`My Orders`)**: Instant inspection and one-tap copyable license keys with order IDs.
  - **User Profile (`Profile`)**: User ID, balance, total orders, total spent, joined date.
  - **Wallet Top-Up (`Add Balance`)**: Instant UPI Dynamic QR & Binance Pay checkout.
  - **Maintenance Mode**: Real-time store lockdown with custom notice message.

- 🖥️ **Modern Glassmorphic Web Admin Dashboard**:
  - **Real-Time Overview**: Live revenue, orders count, registered users, active stock count, and recent orders feed.
  - **Game / Service Management**: Add, rename, edit, toggle visibility, and delete services.
  - **Validity & Pricing**: Configure multiple validities per service (e.g. 1 Day, 7 Days, 30 Days) with independent pricing.
  - **License Stock Manager**: Add single license or bulk paste (one key per line) tied to `(Service + Validity)`.
  - **API / License Provider (LD)**: Configure LD Token, test live connection, check provider balance, fetch provider catalog, and map products.
  - **Payment Gateways**: Configure Binance Pay (API Key, Secret, PID, BEP-20) and UPI Auto (VPA, Merchant Name, Webhook Secret) with manual verification fallback.
  - **User & Wallet Control**: Search users by ID or username, inspect full profile, adjust wallet credits (+/-) with audit logs, and ban/unban users.
  - **Maintenance Mode Switch**: One-click toggle switch with custom notice editor.

---

## 🚀 Quickstart Guide

### 1. Requirements
- Node.js (v20+ or v22+)
- npm

### 2. Installation
```bash
# Clone or navigate to the project directory
cd c:/01

# Install dependencies
npm install
```

### 3. Environment Configuration (`.env`)
Create or edit your `.env` file:
```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
JWT_SECRET=your_super_secret_jwt_admin_key_123456

# Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=adminpassword123

# Telegram Bot Configuration
# Get your token from @BotFather on Telegram
BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
ADMIN_TELEGRAM_IDS=123456789

# Database Configuration
DB_PATH=./data/shop.db

# Store Brand
STORE_NAME=ALPHA DIGITAL STORE
SUPPORT_USERNAME=AlphaSupportBot
CURRENCY_SYMBOL=₹
```

### 4. Running the System
```bash
# Development mode (with live reload)
npm run dev

# Run Automated Test Suite
npm run test:sim
```

### 5. Access the Admin Dashboard
Open your web browser and navigate to:
```
http://localhost:3000
```
- **Username**: `admin`
- **Password**: `adminpassword123`

---

## 🏗️ Technical Architecture

```
telegram-shop-bot-admin/
├── public/                     # Admin Dashboard Frontend (SPA)
│   ├── index.html              # Modern Glassmorphic Admin UI
│   ├── styles.css              # Custom CSS3 theme & variables
│   └── app.js                  # Reactive Admin Dashboard logic
├── src/
│   ├── config/index.ts         # Environment variables & defaults
│   ├── database/
│   │   ├── db.ts               # SQLite (node:sqlite WAL mode & transactions)
│   │   └── repositories/       # User, Service, Validity, License, Order, Payment, Mapping, Settings
│   ├── services/
│   │   ├── fulfillmentService.ts # Atomic 2-Tier stock fulfillment engine
│   │   ├── licenseApiService.ts  # License Dashboard API client
│   │   ├── binancePayService.ts  # Binance Pay API integration
│   │   ├── upiService.ts         # Dynamic UPI QR generation
│   │   └── authService.ts        # Admin JWT & bcrypt password verification
│   ├── bot/
│   │   ├── bot.ts              # GrammY bot initialization & middlewares
│   │   ├── keyboards.ts        # Dynamic inline keyboard builder
│   │   └── handlers/           # Start, Shop, Orders, Profile, Wallet, Support, Admin
│   ├── api/
│   │   ├── middlewares/        # Admin JWT auth middleware
│   │   └── routes/             # REST endpoints for Admin Dashboard & Webhooks
│   └── server.ts               # Express server & Bot runner entrypoint
└── scripts/
    └── simulate_test.ts        # 33-step automated test suite
```

---

## 🔒 Security & Concurrency

1. **Atomic Stock Locking**: SQLite `IMMEDIATE` transactions prevent duplicate delivery or race conditions during high-volume concurrent purchases.
2. **Double-Spend Prevention**: Balance deductions and license claims happen in atomic transactions. If external API fulfillment fails, balance is automatically refunded.
3. **Protected Admin Endpoints**: Admin endpoints require signed JWT bearer tokens with secure hashing for passwords (`bcryptjs`).
4. **Credential Masking**: API keys, tokens, and secrets are masked in Admin Dashboard responses.
5. **Idempotency on Payments**: Webhook verification verifies payment status idempotently to prevent duplicate balance credits.
