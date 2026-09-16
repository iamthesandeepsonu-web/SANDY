import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

const dbDir = path.dirname(config.db.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(config.db.path);

let transactionDepth = 0;

// Helper for atomic transaction execution with nested transaction support
export function runTransaction<T>(fn: () => T): T {
  if (transactionDepth > 0) {
    return fn();
  }

  transactionDepth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback errors if already rolled back
    }
    throw error;
  } finally {
    transactionDepth = 0;
  }
}

// Type-safe query helpers for node:sqlite
export function queryOne<T>(sql: string, ...params: any[]): T | null {
  const row = db.prepare(sql).get(...params);
  return (row as unknown as T) || null;
}

export function queryAll<T>(sql: string, ...params: any[]): T[] {
  const rows = db.prepare(sql).all(...params);
  return rows as unknown as T[];
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      account_type TEXT DEFAULT 'Regular',
      balance REAL DEFAULT 0.0,
      total_spent REAL DEFAULT 0.0,
      total_orders INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS validities (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL,
      validity_id TEXT NOT NULL,
      license_key TEXT NOT NULL,
      is_used INTEGER DEFAULT 0,
      used_by_user_id TEXT,
      used_by_order_id TEXT,
      used_at TEXT,
      added_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
      FOREIGN KEY (validity_id) REFERENCES validities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_licenses_available 
    ON licenses(service_id, validity_id, is_used);

    CREATE TABLE IF NOT EXISTS api_mappings (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      validity_id TEXT NOT NULL,
      external_product_id TEXT NOT NULL,
      external_product_name TEXT,
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(service_id, validity_id),
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
      FOREIGN KEY (validity_id) REFERENCES validities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      telegram_id INTEGER NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      validity_id TEXT NOT NULL,
      validity_name TEXT NOT NULL,
      price_paid REAL NOT NULL,
      license_key TEXT NOT NULL,
      fulfillment_type TEXT NOT NULL, -- 'LOCAL' or 'API'
      api_tx_id TEXT,
      status TEXT DEFAULT 'COMPLETED', -- 'COMPLETED', 'FAILED', 'REFUNDED'
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_telegram_id ON orders(telegram_id);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      telegram_id INTEGER NOT NULL,
      payment_method TEXT NOT NULL, -- 'UPI_AUTO', 'BINANCE_PAY'
      amount REAL NOT NULL,
      reference_id TEXT UNIQUE NOT NULL,
      external_tx_id TEXT,
      status TEXT DEFAULT 'PENDING', -- 'PENDING', 'COMPLETED', 'FAILED', 'EXPIRED'
      qr_payload TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      verified_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference_id);
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL, -- 'TOPUP', 'PURCHASE', 'REFUND', 'ADMIN_ADJUST'
      balance_before REAL NOT NULL,
      balance_after REAL NOT NULL,
      reference_id TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Default system settings
  const defaultSettings = [
    { key: 'brand_name', value: config.brand.storeName },
    { key: 'support_username', value: config.brand.supportUsername },
    { key: 'currency_symbol', value: config.brand.currencySymbol },
    { key: 'usd_conversion_rate', value: '83.0' },
    { key: 'maintenance_enabled', value: 'false' },
    { key: 'maintenance_message', value: '⚠️ Store is currently under scheduled maintenance.\n\nPlease check back soon! For urgent queries, contact support.' },
    { key: 'binance_api_key', value: 'R64c3ZFYaykmHXyk29VphrMpUovbdl0CxILGmssfoMYsfOKG9mL6iGpAm2XX9rsE' },
    { key: 'binance_secret_key', value: 'Ym8WJpIZCoDb2mejQ0vfGvxHoc6QgCxiNbJRBbvThsTOOBhfJWQzlsuCeVsI9v5Z' },
    { key: 'binance_merchant_id', value: '433230697' },
    { key: 'binance_bep20_address', value: '' },
    { key: 'binance_relay_url', value: 'https://apiproxy.site/binance-relay.php' },
    { key: 'binance_is_configured', value: 'true' },
    { key: 'upi_merchant_vpa', value: 'iamsandeepjha@fam' },
    { key: 'upi_merchant_name', value: 'SANDEEP KUMAR JHA' },
    { key: 'upi_webhook_secret', value: 'upi_secret_key_123' },
    { key: 'upi_is_configured', value: 'true' },
    { key: 'upi_email_enabled', value: 'true' },
    { key: 'upi_imap_host', value: 'imap.gmail.com' },
    { key: 'upi_imap_port', value: '993' },
    { key: 'upi_imap_user', value: 'iamsandeepsonu@gmail.com' },
    { key: 'upi_imap_password', value: 'nrdr syer ukpe mbit' },
    { key: 'upi_payment_timeout_min', value: '15' },
    { key: 'ld_api_endpoint', value: 'https://licencedashboard.shop/api/v1' },
    { key: 'ld_api_token', value: 'ldk_ea19008d65d71e216ce765e6801d0d7684db7a8db385354e' },
    { key: 'ld_api_is_configured', value: 'true' }
  ];

  const insertSetting = db.prepare(`
    INSERT INTO settings (key, value, updated_at) 
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    WHERE settings.value = '' OR settings.value = 'http://localhost:3000/api/payments/webhook/binance' OR settings.value = 'false'
  `);

  for (const s of defaultSettings) {
    insertSetting.run(s.key, s.value);
  }

  // Seed sample services & validities if fresh DB
  const row = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM services');
  const count = row ? Number(row.count) : 0;
  if (count === 0) {
    seedInitialCatalog();
  }
}

function seedInitialCatalog() {
  const insertService = db.prepare(`
    INSERT INTO services (id, name, description, is_active, sort_order)
    VALUES (?, ?, ?, 1, ?)
  `);

  const insertValidity = db.prepare(`
    INSERT INTO validities (id, service_id, name, price, is_active, sort_order)
    VALUES (?, ?, ?, ?, 1, ?)
  `);

  const insertLicense = db.prepare(`
    INSERT INTO licenses (service_id, validity_id, license_key, is_used)
    VALUES (?, ?, ?, 0)
  `);

  const insertMapping = db.prepare(`
    INSERT INTO api_mappings (id, service_id, validity_id, external_product_id, external_product_name, is_enabled)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  runTransaction(() => {
    // 1. Service: Apple
    insertService.run('srv_apple', 'Apple', 'Premium Apple Digital License & VIP Pass', 1);

    insertValidity.run('val_apple_1d', 'srv_apple', '1 Day', 450, 1);
    insertValidity.run('val_apple_7d', 'srv_apple', '7 Days', 800, 2);
    insertValidity.run('val_apple_30d', 'srv_apple', '30 Days', 1850, 3);

    // Seed 3 local licenses for Apple 1 Day
    insertLicense.run('srv_apple', 'val_apple_1d', 'APPLE-1D-PROD-8823-7164');
    insertLicense.run('srv_apple', 'val_apple_1d', 'APPLE-1D-PROD-9912-3341');
    insertLicense.run('srv_apple', 'val_apple_1d', 'APPLE-1D-PROD-4411-9082');

    // Seed 0 local licenses for Apple 7 Days, but map to External LD API Product
    insertMapping.run(
      'map_apple_7d',
      'srv_apple',
      'val_apple_7d',
      'LD_PROD_APPLE_7D',
      'External Provider: Apple 7 Days VIP'
    );

    // 2. Service: BGMI VIP
    insertService.run('srv_bgmi', 'BGMI VIP', 'Undetected Digital License for BGMI', 2);
    insertValidity.run('val_bgmi_1d', 'srv_bgmi', '1 Day', 350, 1);
    insertValidity.run('val_bgmi_7d', 'srv_bgmi', '7 Days', 999, 2);

    insertLicense.run('srv_bgmi', 'val_bgmi_1d', 'BGMI-1D-KEY-A109-FF42');
  });
}

// Auto-initialize DB schema and default settings on import
initDatabase();
