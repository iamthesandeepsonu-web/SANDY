import { Router } from 'express';
import fs from 'fs';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';
import { config } from '../../config/index.js';
import { db, queryAll, runTransaction } from '../../database/db.js';

export const settingsRoutes = Router();

// Get General Store & Support Settings
settingsRoutes.get('/', (req, res) => {
  const usdRate = settingsRepo.getUsdRate();
  const brandName = settingsRepo.get('brand_name', 'ALPHA DIGITAL STORE');
  const supportUsername = settingsRepo.get('support_username', 'AlphaSupport');
  const supportLink = settingsRepo.get('support_link', '');
  const supportBtnText = settingsRepo.get('support_btn_text', '💬 Chat with Support Agent');
  const supportMessage = settingsRepo.get('support_message', '');
  const supportChannelUrl = settingsRepo.get('support_channel_url', '');
  const supportChannelLabel = settingsRepo.get('support_channel_label', '📢 Official Updates Channel');
  const supportButtonLabel = settingsRepo.get('support_button_label', '🎧 Support');
  const currencySymbol = settingsRepo.get('currency_symbol', '₹');

  return res.json({
    success: true,
    settings: {
      usdRate,
      brandName,
      supportUsername,
      supportLink,
      supportBtnText,
      supportMessage,
      supportChannelUrl,
      supportChannelLabel,
      supportButtonLabel,
      currencySymbol
    }
  });
});

// Update General Store & Support Settings
settingsRoutes.post('/', requireAdmin, (req, res) => {
  const {
    usdRate,
    brandName,
    supportUsername,
    supportLink,
    supportBtnText,
    supportMessage,
    supportChannelUrl,
    supportChannelLabel,
    supportButtonLabel,
    currencySymbol
  } = req.body;

  if (usdRate !== undefined) {
    const numRate = parseFloat(usdRate);
    if (isNaN(numRate) || numRate <= 0) {
      return res.status(400).json({ success: false, message: 'USD Conversion Rate must be a positive number' });
    }
    settingsRepo.set('usd_conversion_rate', String(numRate));
  }

  if (brandName !== undefined) {
    settingsRepo.set('brand_name', brandName.trim());
  }

  if (supportUsername !== undefined) {
    settingsRepo.set('support_username', supportUsername.trim().replace(/^@/, ''));
  }

  if (supportLink !== undefined) {
    settingsRepo.set('support_link', supportLink.trim());
  }

  if (supportBtnText !== undefined) {
    settingsRepo.set('support_btn_text', supportBtnText.trim());
  }

  if (supportMessage !== undefined) {
    settingsRepo.set('support_message', supportMessage);
  }

  if (supportChannelUrl !== undefined) {
    settingsRepo.set('support_channel_url', supportChannelUrl.trim());
  }

  if (supportChannelLabel !== undefined) {
    settingsRepo.set('support_channel_label', supportChannelLabel.trim());
  }

  if (supportButtonLabel !== undefined) {
    settingsRepo.set('support_button_label', supportButtonLabel.trim());
  }

  if (currencySymbol !== undefined && currencySymbol.trim()) {
    settingsRepo.set('currency_symbol', currencySymbol.trim());
  }

  return res.json({
    success: true,
    message: 'Support & store settings saved successfully!',
    settings: {
      usdRate: settingsRepo.getUsdRate(),
      brandName: settingsRepo.get('brand_name'),
      supportUsername: settingsRepo.get('support_username'),
      supportLink: settingsRepo.get('support_link'),
      supportBtnText: settingsRepo.get('support_btn_text'),
      supportMessage: settingsRepo.get('support_message'),
      supportChannelUrl: settingsRepo.get('support_channel_url'),
      supportChannelLabel: settingsRepo.get('support_channel_label'),
      supportButtonLabel: settingsRepo.get('support_button_label'),
      currencySymbol: settingsRepo.get('currency_symbol')
    }
  });
});

// Download Raw SQLite Database File
settingsRoutes.get('/db/download', requireAdmin, (req, res) => {
  const dbPath = config.db.path;
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ success: false, message: 'Database file not found.' });
  }

  res.setHeader('Content-Disposition', 'attachment; filename="shop_backup_' + Date.now() + '.db"');
  res.setHeader('Content-Type', 'application/x-sqlite3');
  const fileStream = fs.createReadStream(dbPath);
  fileStream.pipe(res);
});

// Export Full Database as JSON
settingsRoutes.get('/db/export', requireAdmin, (req, res) => {
  try {
    const users = queryAll('SELECT * FROM users');
    const services = queryAll('SELECT * FROM services');
    const validities = queryAll('SELECT * FROM validities');
    const licenses = queryAll('SELECT * FROM licenses');
    const api_mappings = queryAll('SELECT * FROM api_mappings');
    const settings = queryAll('SELECT * FROM settings');
    const orders = queryAll('SELECT * FROM orders');
    const payments = queryAll('SELECT * FROM payments');

    return res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      data: {
        users,
        services,
        validities,
        licenses,
        api_mappings,
        settings,
        orders,
        payments
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Failed to export database: ' + err.message });
  }
});

// Import Full Database from JSON Backup (Preserves & Restores all custom data)
settingsRoutes.post('/db/import', requireAdmin, (req, res) => {
  try {
    const { data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, message: 'Invalid backup data provided.' });
    }

    runTransaction(() => {
      // 1. Users
      if (Array.isArray(data.users)) {
        const insUser = db.prepare(`
          INSERT INTO users (id, telegram_id, username, first_name, account_type, balance, total_spent, total_orders, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            telegram_id = excluded.telegram_id,
            username = excluded.username,
            first_name = excluded.first_name,
            account_type = excluded.account_type,
            balance = excluded.balance,
            total_spent = excluded.total_spent,
            total_orders = excluded.total_orders
        `);
        for (const u of data.users) {
          insUser.run(u.id, u.telegram_id, u.username, u.first_name, u.account_type, u.balance, u.total_spent, u.total_orders, u.created_at, u.updated_at);
        }
      }

      // 2. Services
      if (Array.isArray(data.services)) {
        const insService = db.prepare(`
          INSERT INTO services (id, name, description, is_active, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            is_active = excluded.is_active,
            sort_order = excluded.sort_order
        `);
        for (const s of data.services) {
          insService.run(s.id, s.name, s.description, s.is_active, s.sort_order, s.created_at);
        }
      }

      // 3. Validities
      if (Array.isArray(data.validities)) {
        const insVal = db.prepare(`
          INSERT INTO validities (id, service_id, name, price, is_active, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            service_id = excluded.service_id,
            name = excluded.name,
            price = excluded.price,
            is_active = excluded.is_active,
            sort_order = excluded.sort_order
        `);
        for (const v of data.validities) {
          insVal.run(v.id, v.service_id, v.name, v.price, v.is_active, v.sort_order, v.created_at);
        }
      }

      // 4. Licenses
      if (Array.isArray(data.licenses)) {
        const insLic = db.prepare(`
          INSERT OR IGNORE INTO licenses (id, service_id, validity_id, license_key, is_used, created_at, used_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const l of data.licenses) {
          insLic.run(l.id, l.service_id, l.validity_id, l.license_key, l.is_used, l.created_at, l.used_at);
        }
      }

      // 5. API Mappings
      if (Array.isArray(data.api_mappings)) {
        const insMap = db.prepare(`
          INSERT INTO api_mappings (id, service_id, validity_id, external_product_id, external_product_name, is_enabled, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            service_id = excluded.service_id,
            validity_id = excluded.validity_id,
            external_product_id = excluded.external_product_id,
            external_product_name = excluded.external_product_name,
            is_enabled = excluded.is_enabled
        `);
        for (const m of data.api_mappings) {
          insMap.run(m.id, m.service_id, m.validity_id, m.external_product_id, m.external_product_name, m.is_enabled, m.created_at);
        }
      }

      // 6. Settings
      if (Array.isArray(data.settings)) {
        const insSet = db.prepare(`
          INSERT INTO settings (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        for (const st of data.settings) {
          insSet.run(st.key, st.value);
        }
      }
    });

    return res.json({
      success: true,
      message: '✅ Database backup imported & restored successfully! All users, products, and settings are intact.'
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Failed to restore database: ' + err.message });
  }
});
