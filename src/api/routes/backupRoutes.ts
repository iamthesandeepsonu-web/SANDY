import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { backupService } from '../../services/backupService.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const backupRoutes = Router();

// 1. Get List of Backups & Dashboard Stats
backupRoutes.get('/', requireAdmin, (req, res) => {
  try {
    const backups = backupService.listBackups();
    const auditLogs = backupService.getAuditLogs(30);

    const latest = backups.length > 0 ? backups[0] : null;

    return res.json({
      success: true,
      backups,
      latestBackup: latest,
      totalBackups: backups.length,
      auditLogs
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve backups: ' + err.message });
  }
});

// 2. Create Manual Backup Now & Deliver to Telegram
backupRoutes.post('/create', requireAdmin, async (req, res) => {
  try {
    const adminUser = (req as any).adminUser?.username || 'Admin';
    const metadata = await backupService.createBackupAndDeliver(adminUser, 'MANUAL');

    return res.json({
      success: true,
      message: `✅ Disaster-recovery backup created successfully and sent to Telegram!`,
      backup: metadata
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Backup creation failed: ' + err.message });
  }
});

// 3. Download Backup File
backupRoutes.get('/:filename/download', requireAdmin, (req, res) => {
  const filename = path.basename(String(req.params.filename));
  const backupsDir = backupService.getBackupsDirectory();
  const filePath = path.join(backupsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Backup file not found.' });
  }

  const adminUser = (req as any).adminUser?.username || 'Admin';
  const stat = fs.statSync(filePath);
  backupService.logAudit('BACKUP_DOWNLOADED', adminUser, filename, stat.size, 'SUCCESS', 'Admin downloaded backup file');

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (filename.endsWith('.db')) {
    res.setHeader('Content-Type', 'application/x-sqlite3');
  } else {
    res.setHeader('Content-Type', 'application/json');
  }

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

// 4. Delete Backup File
backupRoutes.delete('/:filename', requireAdmin, (req, res) => {
  const filename = String(req.params.filename);
  const adminUser = (req as any).adminUser?.username || 'Admin';

  try {
    const deleted = backupService.deleteBackup(filename, adminUser);
    if (deleted) {
      return res.json({ success: true, message: `Backup "${filename}" deleted successfully.` });
    }
    return res.status(404).json({ success: false, message: 'Backup file not found to delete.' });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Failed to delete backup: ' + err.message });
  }
});

// 5. Restore from existing local backup on server
backupRoutes.post('/restore', requireAdmin, async (req, res) => {
  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ success: false, message: 'Filename is required for restore.' });
  }

  const cleanName = path.basename(filename);
  const backupsDir = backupService.getBackupsDirectory();
  const filePath = path.join(backupsDir, cleanName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Selected backup file does not exist on server.' });
  }

  const adminUser = (req as any).adminUser?.username || 'Admin';

  try {
    const rawBuffer = fs.readFileSync(filePath);
    const result = await backupService.restoreFromData({ rawBuffer, filename: cleanName }, adminUser);

    return res.json({
      success: true,
      message: result.message,
      restoredCounts: result.restoredCounts
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Upload and Restore from user-provided file (JSON or raw DB)
backupRoutes.post('/upload-restore', requireAdmin, async (req, res) => {
  try {
    const { fileBase64, filename, jsonData, data, format } = req.body;
    const adminUser = (req as any).adminUser?.username || 'Admin';

    const finalJson = jsonData || (format === 'json' ? data : null);
    if (finalJson) {
      const result = await backupService.restoreFromData({ jsonContent: finalJson, filename: filename || 'UploadJSON' }, adminUser);
      return res.json({
        success: true,
        message: result.message,
        restoredCounts: result.restoredCounts
      });
    }

    const payload = fileBase64 || data;
    if (!payload) {
      return res.status(400).json({ success: false, message: 'No backup file payload provided.' });
    }

    const cleanBase64 = typeof payload === 'string' ? payload.replace(/^data:[^;]+;base64,/, '') : payload;
    const buffer = Buffer.isBuffer(cleanBase64) ? cleanBase64 : Buffer.from(cleanBase64, 'base64');

    const result = await backupService.restoreFromData({ rawBuffer: buffer, filename: filename || 'UploadedFile' }, adminUser);

    return res.json({
      success: true,
      message: result.message,
      restoredCounts: result.restoredCounts
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Get Audit Logs
backupRoutes.get('/audit-logs', requireAdmin, (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit || '100'), 10);
    const logs = backupService.getAuditLogs(limit);
    return res.json({ success: true, logs });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});
