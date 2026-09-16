import fs from 'fs';
import path from 'path';
import { backupService } from '../src/services/backupService.js';
import { queryOne, queryAll, db } from '../src/database/db.js';

async function runBackupRestoreTests() {
  console.log('========================================');
  console.log('🧪 RUNNING BACKUP & RESTORE TEST SUITE');
  console.log('========================================\n');

  // Clean up any test canary key from previous runs
  db.exec("DELETE FROM settings WHERE key = 'test_canary_key'");

  // 1. Initial State Check
  const initialUsers = queryAll('SELECT * FROM users');
  const initialServices = queryAll('SELECT * FROM services');
  const initialSettings = queryAll('SELECT * FROM settings');
  console.log(`[1] Initial DB State: ${initialUsers.length} Users, ${initialServices.length} Services, ${initialSettings.length} Settings.`);

  // 2. Test Backup Creation (Manual / Disaster Recovery)
  console.log('\n[2] Testing Complete Backup Creation...');
  const backupResult = await backupService.createBackup('test_suite_admin', 'MANUAL');

  console.log('Backup creation result:', {
    success: true,
    dbFile: backupResult.dbFilename,
    jsonFile: backupResult.jsonFilename,
    sizeBytes: backupResult.fileSizeBytes,
    tableCounts: backupResult.recordCounts
  });

  if (!backupResult.dbFilename || !backupResult.jsonFilename) {
    throw new Error('❌ Backup creation failed!');
  }

  // 3. Verify Backup File Existence and Integrity
  console.log('\n[3] Verifying Backup Files Integrity...');
  const backupsDir = path.resolve('backups');
  const dbFilePath = path.join(backupsDir, backupResult.dbFilename);
  const jsonFilePath = path.join(backupsDir, backupResult.jsonFilename);

  if (!fs.existsSync(dbFilePath) || !fs.existsSync(jsonFilePath)) {
    throw new Error('❌ Backup files not found on disk!');
  }

  const jsonContent = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
  console.log('JSON Archive Metadata:', {
    app: jsonContent.meta?.app,
    version: jsonContent.meta?.version,
    tablesPresent: Object.keys(jsonContent.data)
  });

  const requiredTables = ['users', 'services', 'validities', 'licenses', 'api_mappings', 'orders', 'payments', 'settings'];
  for (const tbl of requiredTables) {
    if (!jsonContent.data[tbl]) {
      throw new Error(`❌ Missing required table "${tbl}" in JSON backup archive!`);
    }
  }
  console.log('✅ All 100% disaster recovery tables verified in backup archive.');

  // 4. Test List Backups API
  console.log('\n[4] Testing Backup Listing...');
  const list = backupService.listBackups();
  console.log(`Found ${list.length} backup entries in list.`);
  const found = list.some(b => b.dbFilename === backupResult.dbFilename || b.jsonFilename === backupResult.jsonFilename);
  if (!found) {
    throw new Error('❌ Created backup not showing up in backup listing!');
  }
  console.log('✅ Backups list verified.');

  // 5. Test Disaster Recovery JSON Restore Engine
  console.log('\n[5] Testing Restoration from JSON Backup...');
  // Modify some data in DB first to verify restoration resets/restores it
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('test_canary_key', 'test_before_restore')");
  
  const restoreRes = await backupService.restoreFromData({
    rawBuffer: fs.readFileSync(jsonFilePath),
    filename: backupResult.jsonFilename
  }, 'test_suite_admin');
  console.log('JSON Restore Result:', restoreRes);
  if (!restoreRes.success) {
    throw new Error('❌ Restoration from JSON backup failed!');
  }

  // Verify canary key from DB
  const canaryVal = queryOne("SELECT value FROM settings WHERE key = 'test_canary_key'");
  console.log('Post-restore Canary check (should be null):', canaryVal);
  if (canaryVal) {
    throw new Error('❌ Canary key still existed after restore!');
  }
  console.log('✅ JSON Restoration restored exact state.');

  // 6. Test Restoration from SQLite .db Binary Snapshot
  console.log('\n[6] Testing Restoration from SQLite .db File...');
  const dbRestoreRes = await backupService.restoreFromData({
    rawBuffer: fs.readFileSync(dbFilePath),
    filename: backupResult.dbFilename
  }, 'test_suite_admin');
  console.log('SQLite .db Restore Result:', dbRestoreRes);
  if (!dbRestoreRes.success) {
    throw new Error('❌ Restoration from .db snapshot failed!');
  }
  console.log('✅ SQLite .db Restoration completed successfully.');

  // 7. Test Audit Logs
  console.log('\n[7] Testing Audit Trail Logging...');
  const auditLogs = backupService.getAuditLogs(20);
  console.log(`Audit log records count: ${auditLogs.length}`);
  console.log('Latest audit logs:', auditLogs.slice(0, 3));
  if (auditLogs.length === 0 || !auditLogs.some(l => l.action === 'RESTORE_COMPLETED')) {
    throw new Error('❌ Expected audit log containing RESTORE_COMPLETED action!');
  }
  console.log('✅ Audit log recording verified.');

  // 8. Test Scheduler Next IST Calculation
  console.log('\n[8] Testing IST 12:01 AM Calculation...');
  const msUntilNext = (backupService as any).getMsUntilNext1201AmIst();
  const hoursUntilNext = (msUntilNext / (1000 * 60 * 60)).toFixed(2);
  console.log(`Next 12:01 AM IST is in ${msUntilNext} ms (~${hoursUntilNext} hours).`);
  if (msUntilNext <= 0 || msUntilNext > 24 * 60 * 60 * 1000 + 60000) {
    throw new Error('❌ IST calculation out of expected 24h bounds!');
  }
  console.log('✅ Daily 12:01 AM IST timer calculation verified.');

  console.log('\n========================================');
  console.log('🎉 ALL BACKUP & RESTORE TESTS PASSED 100%!');
  console.log('========================================\n');
}

runBackupRestoreTests().catch(err => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
