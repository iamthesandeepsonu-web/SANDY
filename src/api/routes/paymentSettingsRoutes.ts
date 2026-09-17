import { Router } from 'express';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { binancePayService } from '../../services/binancePayService.js';
import { emailVerificationService } from '../../services/emailVerificationService.js';
import { auditRepo } from '../../database/repositories/auditRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const paymentSettingsRoutes = Router();

paymentSettingsRoutes.get('/', requireAdmin, (req, res) => {
  const binanceMasked = binancePayService.getMaskedConfig();
  const upiVpa = settingsRepo.get('upi_merchant_vpa', 'iamsandeepjha@fam');
  const upiName = settingsRepo.get('upi_merchant_name', 'SANDEEP KUMAR JHA');
  const upiSecret = settingsRepo.get('upi_webhook_secret', 'upi_secret_key_123');
  const upiConfigured = settingsRepo.getBoolean('upi_is_configured', true);
  const emailWorkerStatus = emailVerificationService.getStatus();

  return res.json({
    success: true,
    binance: binanceMasked,
    upi: {
      merchantVpa: upiVpa,
      merchantName: upiName,
      webhookSecretMasked: upiSecret ? upiSecret.slice(0, 3) + '...' + upiSecret.slice(-3) : '',
      isConfigured: upiConfigured
    },
    emailWorker: emailWorkerStatus
  });
});

/**
 * Safe Live Configuration Update with Pre-Validation
 */
paymentSettingsRoutes.post('/binance', requireAdmin, async (req, res) => {
  const { apiKey, secretKey, merchantId, bep20Address, webhookSecret, relayUrl } = req.body;
  const adminUser = (req as any).user?.username || 'admin';

  try {
    const result = await binancePayService.updateConfigSafely(
      { apiKey, secretKey, merchantId, bep20Address, webhookSecret, relayUrl },
      adminUser
    );

    return res.json({
      success: result.success,
      message: result.message
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      message: `Failed to update configuration: ${err.message}`
    });
  }
});

/**
 * Multi-Point Live Integrity Check / Diagnostic Endpoint
 */
paymentSettingsRoutes.post('/binance/test', requireAdmin, async (req, res) => {
  const adminUser = (req as any).user?.username || 'admin';
  try {
    const report = await binancePayService.runIntegrityCheck(adminUser);
    return res.json({
      success: report.success,
      report,
      status: report.success ? 'Connected / Working' : 'Connection Failed / Not Working',
      message: report.summaryMessage,
      accountStatus: report.accountStatus
    });
  } catch (err: any) {
    return res.json({
      success: false,
      status: 'Connection Failed / Not Working',
      message: err.message
    });
  }
});

/**
 * Reconcile single pending Binance payment
 */
paymentSettingsRoutes.post('/binance/reconcile/:id', requireAdmin, async (req, res) => {
  const paymentId = String(req.params.id);
  const adminUser = (req as any).user?.username || 'admin';

  try {
    const result = await binancePayService.reconcilePayment(paymentId, adminUser);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * Batch reconcile all pending Binance payments
 */
paymentSettingsRoutes.post('/binance/reconcile', requireAdmin, async (req, res) => {
  const adminUser = (req as any).user?.username || 'admin';
  try {
    const result = await binancePayService.reconcileAllPending(adminUser);
    return res.json({
      success: true,
      ...result
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * Binance Payment & Audit Logs
 */
paymentSettingsRoutes.get('/binance/logs', requireAdmin, (req, res) => {
  const paymentId = req.query.paymentId ? String(req.query.paymentId) : undefined;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;

  const logs = auditRepo.listBinanceLogs(paymentId, limit);
  return res.json({ success: true, logs });
});

paymentSettingsRoutes.post('/upi', requireAdmin, (req, res) => {
  const { merchantVpa, merchantName, webhookSecret } = req.body;

  if (merchantVpa !== undefined && merchantVpa.trim()) {
    settingsRepo.set('upi_merchant_vpa', merchantVpa.trim());
  }
  if (merchantName !== undefined && merchantName.trim()) {
    settingsRepo.set('upi_merchant_name', merchantName.trim());
  }
  if (webhookSecret !== undefined && webhookSecret.trim() && !webhookSecret.includes('...')) {
    settingsRepo.set('upi_webhook_secret', webhookSecret.trim());
  }

  settingsRepo.set('upi_is_configured', 'true');

  return res.json({
    success: true,
    message: 'UPI settings saved successfully!'
  });
});

// Email IMAP Auto-Verification Settings
paymentSettingsRoutes.get('/email-upi', requireAdmin, (req, res) => {
  return res.json({
    success: true,
    status: emailVerificationService.getStatus()
  });
});

paymentSettingsRoutes.post('/email-upi', requireAdmin, async (req, res) => {
  const { enabled, imapUser, imapPassword, merchantVpa, merchantName, timeoutMinutes } = req.body;

  if (enabled !== undefined) {
    settingsRepo.set('upi_email_enabled', enabled ? 'true' : 'false');
  }
  if (imapUser !== undefined && imapUser.trim()) {
    settingsRepo.set('upi_imap_user', imapUser.trim());
  }
  if (imapPassword !== undefined && imapPassword.trim() && !imapPassword.includes('...')) {
    settingsRepo.set('upi_imap_password', imapPassword.trim().replace(/\s+/g, ''));
  }
  if (merchantVpa !== undefined && merchantVpa.trim()) {
    settingsRepo.set('upi_merchant_vpa', merchantVpa.trim());
  }
  if (merchantName !== undefined && merchantName.trim()) {
    settingsRepo.set('upi_merchant_name', merchantName.trim());
  }
  if (timeoutMinutes !== undefined) {
    settingsRepo.set('upi_payment_timeout_min', String(parseInt(timeoutMinutes, 10) || 15));
  }

  // Restart worker with updated config
  if (enabled) {
    await emailVerificationService.restart();
  } else {
    emailVerificationService.stop();
  }

  return res.json({
    success: true,
    message: '📧 UPI Email Verification settings saved and worker updated successfully!',
    status: emailVerificationService.getStatus()
  });
});

paymentSettingsRoutes.post('/email-upi/test', requireAdmin, async (req, res) => {
  try {
    const result = await emailVerificationService.testConnection();
    return res.json({
      success: result.success,
      status: result.success ? '🟢 IMAP Worker Connected' : '🔴 IMAP Connection Failed',
      message: result.message,
      mailCount: result.mailCount
    });
  } catch (err: any) {
    return res.json({
      success: false,
      status: '🔴 IMAP Connection Failed',
      message: err.message
    });
  }
});

paymentSettingsRoutes.post('/email-upi/toggle', requireAdmin, async (req, res) => {
  const current = settingsRepo.getBoolean('upi_email_enabled', true);
  const next = !current;
  settingsRepo.set('upi_email_enabled', next ? 'true' : 'false');

  if (next) {
    await emailVerificationService.restart();
  } else {
    emailVerificationService.stop();
  }

  return res.json({
    success: true,
    enabled: next,
    message: next ? '🟢 Email Auto-Verification Worker Started' : '🛑 Email Auto-Verification Worker Paused',
    status: emailVerificationService.getStatus()
  });
});
