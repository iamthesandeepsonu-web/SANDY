import { Router } from 'express';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { binancePayService } from '../../services/binancePayService.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const paymentSettingsRoutes = Router();

paymentSettingsRoutes.get('/', requireAdmin, (req, res) => {
  const binanceConfig = binancePayService.getConfig();
  const upiVpa = settingsRepo.get('upi_merchant_vpa', 'merchant@upi');
  const upiName = settingsRepo.get('upi_merchant_name', 'Digital Keys Store');
  const upiSecret = settingsRepo.get('upi_webhook_secret', 'upi_secret_key_123');
  const upiConfigured = settingsRepo.getBoolean('upi_is_configured', true);

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
    }
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
