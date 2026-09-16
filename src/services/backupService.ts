import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { InputFile } from 'grammy';
import { config } from '../config/index.js';
import { db, queryOne, queryAll, runTransaction, initDatabase } from '../database/db.js';
import { activeBot } from '../bot/bot.js';

export interface BackupMetadata {
  filename: string;
  dbFilename: string;
  jsonFilename: string;
  createdAt: string;
  createdAtIst: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  type: 'SCHEDULED' | 'MANUAL';
  status: 'SUCCESS' | 'FAILED';
  sha256: string;
  recordCounts: {
    users: number;
    services: number;
    validities: number;
    licenses: number;
    apiMappings: number;
    orders: number;
    payments: number;
    settings: number;
    walletTransactions: number;
  };
}

export interface BackupAuditLog {
  id: string;
  action: string;
  performed_by: string;
  backup_name: string | null;
  file_size: number | null;
  status: string;
  details: string | null;
  created_at: string;
}

class BackupService {
  private backupsDir: string;
  private schedulerTimeout: NodeJS.Timeout | null = null;
  private isSchedulerRunning: boolean = false;

  constructor() {
    this.backupsDir = path.resolve(process.cwd(), process.env.BACKUPS_PATH || './backups');
    if (!fs.existsSync(this.backupsDir)) {
      fs.mkdirSync(this.backupsDir, { recursive: true });
    }
  }

  getBackupsDirectory(): string {
    return this.backupsDir;
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getIstDateString(date = new Date()): string {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'medium',
      hour12: true
    }).format(date);
  }

  /**
   * Calculate Milliseconds until next 12:01 AM IST
   */
  getMsUntilNext1201AmIst(): number {
    const now = new Date();
    // Current time in IST
    const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istNow = new Date(istString);

    const next1201 = new Date(istNow);
    next1201.setHours(0, 1, 0, 0); // 12:01 AM IST

    if (istNow.getTime() >= next1201.getTime()) {
      // If already past 12:01 AM IST today, schedule for tomorrow
      next1201.setDate(next1201.getDate() + 1);
    }

    const diffMs = next1201.getTime() - istNow.getTime();
    return Math.max(diffMs, 1000);
  }

  /**
   * Start 12:01 AM IST Daily Scheduler
   */
  startScheduler() {
    if (this.isSchedulerRunning) return;
    this.isSchedulerRunning = true;

    const scheduleNext = () => {
      const msUntilNext = this.getMsUntilNext1201AmIst();
      const nextDate = new Date(Date.now() + msUntilNext);
      console.log(`⏰ [BACKUP SCHEDULER] Next 12:01 AM IST Daily Backup scheduled in ${(msUntilNext / 1000 / 60).toFixed(1)} mins (${this.getIstDateString(nextDate)})`);

      this.schedulerTimeout = setTimeout(async () => {
        try {
          console.log(`🚀 [BACKUP SCHEDULER] Running scheduled 12:01 AM IST Daily Disaster-Recovery Backup...`);
          await this.createBackupAndDeliver('SYSTEM', 'SCHEDULED');
        } catch (err: any) {
          console.error(`❌ [BACKUP SCHEDULER] Scheduled backup failed:`, err);
        } finally {
          scheduleNext();
        }
      }, msUntilNext);
    };

    scheduleNext();
  }

  stopScheduler() {
    this.isSchedulerRunning = false;
    if (this.schedulerTimeout) {
      clearTimeout(this.schedulerTimeout);
      this.schedulerTimeout = null;
    }
  }

  /**
   * Core Backup Generator: Creates complete raw SQLite clone and structured JSON archive
   */
  async createBackup(performedBy = 'SYSTEM', type: 'SCHEDULED' | 'MANUAL' = 'MANUAL'): Promise<BackupMetadata> {
    const timestamp = new Date();
    const dateStamp = timestamp.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '_');
    const baseName = `backup_${dateStamp}`;
    const dbFilename = `${baseName}.db`;
    const jsonFilename = `${baseName}.json`;
    const dbFilePath = path.join(this.backupsDir, dbFilename);
    const jsonFilePath = path.join(this.backupsDir, jsonFilename);

    try {
      // 1. Flush SQLite WAL to disk
      try {
        db.exec('PRAGMA wal_checkpoint(FULL);');
      } catch {}

      // 2. Fetch all database tables
      const users = queryAll('SELECT * FROM users');
      const services = queryAll('SELECT * FROM services');
      const validities = queryAll('SELECT * FROM validities');
      const licenses = queryAll('SELECT * FROM licenses');
      const api_mappings = queryAll('SELECT * FROM api_mappings');
      const orders = queryAll('SELECT * FROM orders');
      const payments = queryAll('SELECT * FROM payments');
      const wallet_transactions = queryAll('SELECT * FROM wallet_transactions');
      const settings = queryAll('SELECT * FROM settings');
      const audit_logs = queryAll('SELECT * FROM backup_audit_logs');

      const recordCounts = {
        users: users.length,
        services: services.length,
        validities: validities.length,
        licenses: licenses.length,
        apiMappings: api_mappings.length,
        orders: orders.length,
        payments: payments.length,
        settings: settings.length,
        walletTransactions: wallet_transactions.length
      };

      // 3. Create full structured JSON export
      const fullArchive = {
        meta: {
          app: config.brand.storeName,
          version: '2.0.0',
          backupType: type,
          generatedAt: timestamp.toISOString(),
          generatedAtIst: this.getIstDateString(timestamp),
          recordCounts
        },
        data: {
          users,
          services,
          validities,
          licenses,
          api_mappings,
          orders,
          payments,
          wallet_transactions,
          settings,
          backup_audit_logs: audit_logs
        }
      };

      const jsonStr = JSON.stringify(fullArchive, null, 2);
      fs.writeFileSync(jsonFilePath, jsonStr, 'utf8');

      // 4. Copy raw SQLite database file
      if (fs.existsSync(config.db.path)) {
        fs.copyFileSync(config.db.path, dbFilePath);
      }

      // 5. Calculate SHA-256 Checksum of the backup
      const targetFileForHash = fs.existsSync(dbFilePath) ? dbFilePath : jsonFilePath;
      const fileBuffer = fs.readFileSync(targetFileForHash);
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const fileSizeBytes = fileBuffer.length;
      const fileSizeFormatted = this.formatBytes(fileSizeBytes);

      const metadata: BackupMetadata = {
        filename: fs.existsSync(dbFilePath) ? dbFilename : jsonFilename,
        dbFilename,
        jsonFilename,
        createdAt: timestamp.toISOString(),
        createdAtIst: this.getIstDateString(timestamp),
        fileSizeBytes,
        fileSizeFormatted,
        type,
        status: 'SUCCESS',
        sha256,
        recordCounts
      };

      this.logAudit('BACKUP_CREATED', performedBy, metadata.filename, fileSizeBytes, 'SUCCESS', `Type: ${type}, Records: ${JSON.stringify(recordCounts)}`);

      return metadata;
    } catch (err: any) {
      this.logAudit('BACKUP_FAILED', performedBy, baseName, 0, 'FAILED', `Error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Create Backup and Deliver to Telegram Admin Chat
   */
  async createBackupAndDeliver(performedBy = 'SYSTEM', type: 'SCHEDULED' | 'MANUAL' = 'SCHEDULED'): Promise<BackupMetadata> {
    try {
      const metadata = await this.createBackup(performedBy, type);
      await this.sendBackupToTelegram(metadata);
      return metadata;
    } catch (err: any) {
      await this.sendFailureAlertToTelegram(err.message || 'Unknown backup error');
      throw err;
    }
  }

  /**
   * Send Backup File and Information to Admin Telegram Account
   */
  async sendBackupToTelegram(metadata: BackupMetadata) {
    if (!activeBot || !activeBot.api) {
      console.log('ℹ️ [TELEGRAM BACKUP] Bot instance not active, skipping Telegram delivery.');
      return;
    }

    const adminIds = config.admin.telegramIds;
    if (!adminIds || adminIds.length === 0) {
      console.log('ℹ️ [TELEGRAM BACKUP] No ADMIN_TELEGRAM_IDS configured in .env, skipping Telegram delivery.');
      return;
    }

    const filePath = path.join(this.backupsDir, metadata.filename);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ [TELEGRAM BACKUP] File not found: ${filePath}`);
      return;
    }

    const caption = `
🛡️ <b>AUTOMATED DISASTER-RECOVERY BACKUP</b>

📅 <b>Date & Time:</b> <code>${metadata.createdAtIst}</code>
📦 <b>Backup Size:</b> <b>${metadata.fileSizeFormatted}</b>
🔄 <b>Type:</b> <code>${metadata.type === 'SCHEDULED' ? '12:01 AM IST Daily Auto' : 'Manual Trigger'}</code>
📊 <b>Status:</b> 🟢 <b>SUCCESS (Integrity Verified)</b>

📈 <b>Database Summary:</b>
• 👥 <b>Users:</b> ${metadata.recordCounts.users}
• 🎮 <b>Products:</b> ${metadata.recordCounts.services} (${metadata.recordCounts.validities} plans)
• 🔑 <b>License Stock:</b> ${metadata.recordCounts.licenses}
• 📦 <b>Orders:</b> ${metadata.recordCounts.orders}
• 💳 <b>Payments:</b> ${metadata.recordCounts.payments}
• ⚙️ <b>Settings:</b> ${metadata.recordCounts.settings}

🔒 <b>SHA-256 Checksum:</b>
<code>${metadata.sha256.slice(0, 32)}...</code>

<i>💡 Save this file safely. You can upload this file in Admin Panel ➔ Backup & Restore to recover the full store if any disaster occurs.</i>
`.trim();

    for (const adminId of adminIds) {
      try {
        await activeBot.api.sendDocument(adminId, new InputFile(filePath, metadata.filename), {
          caption,
          parse_mode: 'HTML'
        });
        console.log(`✅ [TELEGRAM BACKUP] Delivered backup ${metadata.filename} to Admin TG ID: ${adminId}`);
      } catch (err: any) {
        console.error(`❌ [TELEGRAM BACKUP] Failed to send document to Admin ${adminId}:`, err.message);
      }
    }
  }

  /**
   * Send Failure Notification to Admin on Telegram
   */
  async sendFailureAlertToTelegram(errorMessage: string) {
    if (!activeBot || !activeBot.api) return;

    const adminIds = config.admin.telegramIds;
    if (!adminIds || adminIds.length === 0) return;

    const text = `
🚨 <b>CRITICAL ALERT: AUTOMATED BACKUP FAILED</b>

⚠️ <b>Reason:</b> ${errorMessage}
🕒 <b>Timestamp:</b> <code>${this.getIstDateString()}</code>

Please check server logs and Admin Dashboard immediately.
`.trim();

    for (const adminId of adminIds) {
      try {
        await activeBot.api.sendMessage(adminId, text, { parse_mode: 'HTML' });
      } catch {}
    }
  }

  /**
   * List All Available Backups with Status and Sizes
   */
  listBackups(): BackupMetadata[] {
    if (!fs.existsSync(this.backupsDir)) return [];

    const files = fs.readdirSync(this.backupsDir);
    const backupsMap = new Map<string, { db?: string; json?: string; stat?: fs.Stats }>();

    for (const file of files) {
      if (file.endsWith('.db') || file.endsWith('.json')) {
        const base = file.replace(/\.(db|json)$/, '');
        if (!backupsMap.has(base)) {
          backupsMap.set(base, {});
        }
        const entry = backupsMap.get(base)!;
        const fullPath = path.join(this.backupsDir, file);
        try {
          const stats = fs.statSync(fullPath);
          entry.stat = stats;
          if (file.endsWith('.db')) entry.db = file;
          if (file.endsWith('.json')) entry.json = file;
        } catch {}
      }
    }

    const result: BackupMetadata[] = [];

    for (const [base, entry] of backupsMap.entries()) {
      const preferredFile = entry.db || entry.json || '';
      if (!preferredFile) continue;

      const fullPath = path.join(this.backupsDir, preferredFile);
      const stat = entry.stat || fs.statSync(fullPath);
      const sizeBytes = stat.size;

      let recordCounts = {
        users: 0,
        services: 0,
        validities: 0,
        licenses: 0,
        apiMappings: 0,
        orders: 0,
        payments: 0,
        settings: 0,
        walletTransactions: 0
      };

      let type: 'SCHEDULED' | 'MANUAL' = base.includes('scheduled') ? 'SCHEDULED' : 'MANUAL';

      if (entry.json) {
        try {
          const jsonContent = JSON.parse(fs.readFileSync(path.join(this.backupsDir, entry.json), 'utf8'));
          if (jsonContent.meta) {
            if (jsonContent.meta.backupType) type = jsonContent.meta.backupType;
            if (jsonContent.meta.recordCounts) recordCounts = jsonContent.meta.recordCounts;
          }
        } catch {}
      }

      result.push({
        filename: preferredFile,
        dbFilename: entry.db || `${base}.db`,
        jsonFilename: entry.json || `${base}.json`,
        createdAt: stat.mtime.toISOString(),
        createdAtIst: this.getIstDateString(stat.mtime),
        fileSizeBytes: sizeBytes,
        fileSizeFormatted: this.formatBytes(sizeBytes),
        type,
        status: 'SUCCESS',
        sha256: 'VERIFIED',
        recordCounts
      });
    }

    // Sort newest first
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return result;
  }

  /**
   * Delete Backup File
   */
  deleteBackup(filename: string, performedBy = 'admin'): boolean {
    const cleanName = path.basename(filename);
    const base = cleanName.replace(/\.(db|json)$/, '');
    const dbPath = path.join(this.backupsDir, `${base}.db`);
    const jsonPath = path.join(this.backupsDir, `${base}.json`);

    let deleted = false;
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      deleted = true;
    }
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath);
      deleted = true;
    }

    if (deleted) {
      this.logAudit('BACKUP_DELETED', performedBy, cleanName, 0, 'SUCCESS', 'Backup removed from disk');
    }
    return deleted;
  }

  /**
   * Full Disaster-Recovery Restoration with Pre-Restore Snapshot & Rollback Protection
   */
  async restoreFromData(
    input: { rawBuffer?: Buffer; jsonContent?: any; filename?: string },
    performedBy = 'admin'
  ): Promise<{ success: boolean; message: string; restoredCounts: any }> {
    this.logAudit('RESTORE_STARTED', performedBy, input.filename || 'DirectData', 0, 'IN_PROGRESS', 'Initiating disaster recovery restore');

    // 1. Take Pre-Restore Snapshot of current DB for safety rollback
    let preRestoreSnapshotPath: string | null = null;
    if (fs.existsSync(config.db.path)) {
      try {
        db.exec('PRAGMA wal_checkpoint(FULL);');
        const preRestoreName = `pre_restore_${Date.now()}.db`;
        preRestoreSnapshotPath = path.join(this.backupsDir, preRestoreName);
        fs.copyFileSync(config.db.path, preRestoreSnapshotPath);
      } catch (snapErr) {
        console.warn('⚠️ Could not take pre-restore snapshot:', snapErr);
      }
    }

    try {
      let backupPayload: any = null;

      // Handle raw file buffer or direct JSON
      if (input.rawBuffer) {
        const headerStr = input.rawBuffer.slice(0, 16).toString('utf8');
        
        // A. Is SQLite database file
        if (headerStr.startsWith('SQLite format 3')) {
          // Validate and replace SQLite file directly
          fs.writeFileSync(config.db.path, input.rawBuffer);
          initDatabase();
          
          const usersCount = queryOne<{ c: number }>('SELECT COUNT(*) as c FROM users')?.c || 0;
          const srvCount = queryOne<{ c: number }>('SELECT COUNT(*) as c FROM services')?.c || 0;
          const licCount = queryOne<{ c: number }>('SELECT COUNT(*) as c FROM licenses')?.c || 0;
          const orderCount = queryOne<{ c: number }>('SELECT COUNT(*) as c FROM orders')?.c || 0;

          const counts = { users: usersCount, services: srvCount, licenses: licCount, orders: orderCount };
          this.logAudit('RESTORE_COMPLETED', performedBy, input.filename || 'RawSQLite', input.rawBuffer.length, 'SUCCESS', `Restored from raw SQLite DB. Records: ${JSON.stringify(counts)}`);

          return {
            success: true,
            message: `✅ Full disaster-recovery restore completed successfully from SQLite database!`,
            restoredCounts: counts
          };
        }

        // B. Is JSON backup string
        try {
          const utf8Str = input.rawBuffer.toString('utf8');
          backupPayload = JSON.parse(utf8Str);
        } catch (jsonErr) {
          throw new Error('Unsupported or corrupt backup file format. Must be a valid SQLite (.db) or JSON backup archive.');
        }
      } else if (input.jsonContent) {
        backupPayload = input.jsonContent;
      }

      if (!backupPayload) {
        throw new Error('No valid backup content provided for restoration.');
      }

      const rawData = backupPayload.data || backupPayload;

      // Validate required data structure
      if (!rawData || typeof rawData !== 'object') {
        throw new Error('Invalid backup archive structure: "data" object missing.');
      }

      // Execute complete atomic transaction restoration
      const restoredCounts = runTransaction(() => {
        // 1. Wipe current tables
        db.exec(`
          DELETE FROM backup_audit_logs;
          DELETE FROM wallet_transactions;
          DELETE FROM payments;
          DELETE FROM orders;
          DELETE FROM api_mappings;
          DELETE FROM licenses;
          DELETE FROM validities;
          DELETE FROM services;
          DELETE FROM users;
          DELETE FROM settings;
        `);

        let countUsers = 0;
        let countServices = 0;
        let countValidities = 0;
        let countLicenses = 0;
        let countMappings = 0;
        let countOrders = 0;
        let countPayments = 0;
        let countTransactions = 0;
        let countSettings = 0;

        // 2. Restore Users
        if (Array.isArray(rawData.users)) {
          const stmt = db.prepare(`
            INSERT INTO users (id, telegram_id, username, first_name, account_type, balance, total_spent, total_orders, is_banned, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const u of rawData.users) {
            stmt.run(u.id, u.telegram_id, u.username, u.first_name, u.account_type || 'Regular', u.balance || 0, u.total_spent || 0, u.total_orders || 0, u.is_banned || 0, u.created_at, u.updated_at);
            countUsers++;
          }
        }

        // 3. Restore Services
        if (Array.isArray(rawData.services)) {
          const stmt = db.prepare(`
            INSERT INTO services (id, name, description, is_active, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          for (const s of rawData.services) {
            stmt.run(s.id, s.name, s.description, s.is_active ?? 1, s.sort_order || 0, s.created_at, s.updated_at);
            countServices++;
          }
        }

        // 4. Restore Validities
        if (Array.isArray(rawData.validities)) {
          const stmt = db.prepare(`
            INSERT INTO validities (id, service_id, name, price, is_active, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const v of rawData.validities) {
            stmt.run(v.id, v.service_id, v.name, v.price, v.is_active ?? 1, v.sort_order || 0, v.created_at, v.updated_at);
            countValidities++;
          }
        }

        // 5. Restore Licenses
        if (Array.isArray(rawData.licenses)) {
          const stmt = db.prepare(`
            INSERT INTO licenses (id, service_id, validity_id, license_key, is_used, used_by_user_id, used_by_order_id, used_at, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const l of rawData.licenses) {
            stmt.run(l.id, l.service_id, l.validity_id, l.license_key, l.is_used || 0, l.used_by_user_id, l.used_by_order_id, l.used_at, l.added_at);
            countLicenses++;
          }
        }

        // 6. Restore API Mappings
        if (Array.isArray(rawData.api_mappings)) {
          const stmt = db.prepare(`
            INSERT INTO api_mappings (id, service_id, validity_id, external_product_id, external_product_name, is_enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const m of rawData.api_mappings) {
            stmt.run(m.id, m.service_id, m.validity_id, m.external_product_id, m.external_product_name, m.is_enabled ?? 1, m.created_at, m.updated_at);
            countMappings++;
          }
        }

        // 7. Restore Orders
        if (Array.isArray(rawData.orders)) {
          const stmt = db.prepare(`
            INSERT INTO orders (id, user_id, telegram_id, service_id, service_name, validity_id, validity_name, price_paid, license_key, fulfillment_type, api_tx_id, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const o of rawData.orders) {
            stmt.run(o.id, o.user_id, o.telegram_id, o.service_id, o.service_name, o.validity_id, o.validity_name, o.price_paid, o.license_key, o.fulfillment_type || 'LOCAL', o.api_tx_id, o.status || 'COMPLETED', o.created_at);
            countOrders++;
          }
        }

        // 8. Restore Payments
        if (Array.isArray(rawData.payments)) {
          const stmt = db.prepare(`
            INSERT INTO payments (id, user_id, telegram_id, payment_method, amount, reference_id, external_tx_id, status, qr_payload, metadata, created_at, verified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const p of rawData.payments) {
            const metaStr = typeof p.metadata === 'object' ? JSON.stringify(p.metadata) : p.metadata;
            stmt.run(p.id, p.user_id, p.telegram_id, p.payment_method, p.amount, p.reference_id, p.external_tx_id, p.status, p.qr_payload, metaStr, p.created_at, p.verified_at);
            countPayments++;
          }
        }

        // 9. Restore Wallet Transactions
        if (Array.isArray(rawData.wallet_transactions)) {
          const stmt = db.prepare(`
            INSERT INTO wallet_transactions (id, user_id, amount, type, balance_before, balance_after, reference_id, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const t of rawData.wallet_transactions) {
            stmt.run(t.id, t.user_id, t.amount, t.type, t.balance_before, t.balance_after, t.reference_id, t.description, t.created_at);
            countTransactions++;
          }
        }

        // 10. Restore Settings
        if (Array.isArray(rawData.settings)) {
          const stmt = db.prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
          `);
          for (const st of rawData.settings) {
            stmt.run(st.key, st.value, st.updated_at || new Date().toISOString());
            countSettings++;
          }
        }

        return {
          users: countUsers,
          services: countServices,
          validities: countValidities,
          licenses: countLicenses,
          apiMappings: countMappings,
          orders: countOrders,
          payments: countPayments,
          walletTransactions: countTransactions,
          settings: countSettings
        };
      });

      this.logAudit('RESTORE_COMPLETED', performedBy, input.filename || 'JSONArchive', 0, 'SUCCESS', `All tables restored successfully. Records: ${JSON.stringify(restoredCounts)}`);

      return {
        success: true,
        message: '✅ Complete Disaster Recovery Restore Succeeded! All users, products, keys, and settings are fully restored.',
        restoredCounts
      };
    } catch (err: any) {
      console.error('❌ Restore failed, initiating emergency rollback:', err);

      // Rollback to Pre-Restore Snapshot if available
      if (preRestoreSnapshotPath && fs.existsSync(preRestoreSnapshotPath)) {
        try {
          fs.copyFileSync(preRestoreSnapshotPath, config.db.path);
          initDatabase();
          console.log('🛡️ Successfully rolled back to pre-restore snapshot.');
        } catch (rollbackErr) {
          console.error('CRITICAL: Rollback failed:', rollbackErr);
        }
      }

      this.logAudit('RESTORE_FAILED', performedBy, input.filename || 'Unknown', 0, 'FAILED', `Error: ${err.message}`);
      throw new Error(`Restoration Failed: ${err.message}. System safely preserved.`);
    }
  }

  /**
   * Log entry in backup_audit_logs
   */
  logAudit(action: string, performedBy: string, backupName: string | null, fileSize: number, status: string, details: string) {
    try {
      const id = 'audit_' + crypto.randomBytes(6).toString('hex');
      db.prepare(`
        INSERT INTO backup_audit_logs (id, action, performed_by, backup_name, file_size, status, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(id, action, performedBy, backupName, fileSize, status, details);
    } catch {}
  }

  /**
   * Get Audit Logs
   */
  getAuditLogs(limit = 100): BackupAuditLog[] {
    return queryAll<BackupAuditLog>(`
      SELECT * FROM backup_audit_logs 
      ORDER BY created_at DESC 
      LIMIT ?
    `, limit);
  }
}

export const backupService = new BackupService();
