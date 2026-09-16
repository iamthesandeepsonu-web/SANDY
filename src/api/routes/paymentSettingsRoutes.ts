import { Router } from 'express';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { binancePayService } from '../../services/binancePayService.js';
import { emailVerificationService } from '../../services/emailVerificationService.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const paymentSettingsRoutes = Router();

paymentSettingsRoutes.get('/', requireAdmin, (req, res) => {
  const binanceConfig = binancePayService.getConfig();
  const upiVpa = settingsRepo.get('upi_merchant_vpa', 'iamsandeepjha@fam');
  const upiName = settingsRepo.get('upi_merchant_name', 'SANDEEP KUMAR JHA');
  const upiSecret = settingsRepo.get('upi_webhook_secret', 'upi_secret_key_123');
  const upiConfigured = settingsRepo.getBoolean('upi_is_configured', true);
  const emailWorkerStatus = emailVerificationService.getStatus();

  return res.json({
    success: true,
    binance: {
      apiKeyMasked: binanceConfig.apiKey ? binanceConfig.apiKey.slice(0, 6) + '...' + binanceConfig.apiKey.slice(-4) : '',
      secretKeyConfigured: Boolean(binanceConfig.secretKey),
      merchantId: binanceConfig.merchantId,
      bep20Address: binanceConfig.bep20Address,
      relayUrl: binanceConfig.relayUrl,
      isConfigured: binanceConfig.isConfigured
    },
    upi: {
      merchantVpa: upiVpa,
      merchantName: upiName,
      webhookSecretMasked: upiSecret ? upiSecret.slice(0, 3) + '...' + upiSecret.slice(-3) : '',
      isConfigured: upiConfigured
    },
    emailWorker: emailWorkerStatus
  });
});

paymentSettingsRoutes.post('/binance', requireAdmin, (req, res) => {
  const { apiKey, secretKey, merchantId, bep20Address, relayUrl } = req.body;

  if (apiKey !== undefined && apiKey.trim() && !apiKey.includes('...')) {
    settingsRepo.set('binance_api_key', apiKey.trim());
  }
  if (secretKey !== undefined && secretKey.trim()) {
    settingsRepo.set('binance_secret_key', secretKey.trim());
  }
  if (merchantId !== undefined) {
    settingsRepo.set('binance_merchant_id', merchantId.trim());
  }
  if (bep20Address !== undefined) {
    settingsRepo.set('binance_bep20_address', bep20Address.trim());
  }
  if (relayUrl !== undefined) {
    settingsRepo.set('binance_relay_url', relayUrl.trim());
  }

  settingsRepo.set('binance_is_configured', 'true');

  return res.json({
    success: true,
    message: 'Binance Pay configuration saved successfully!'
  });
});

paymentSettingsRoutes.post('/binance/test', requireAdmin, async (req, res) => {
  try {
    const result = await binancePayService.testConnection();
    return res.json({
      success: result.success,
      status: result.success ? 'Connected / Working' : 'Connection Failed / Not Working',
      message: result.message,
      accountStatus: result.accountStatus
    });
  } catch (err: any) {
    return res.json({
      success: false,
      status: 'Connection Failed / Not Working',
      message: err.message
    });
  }
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
