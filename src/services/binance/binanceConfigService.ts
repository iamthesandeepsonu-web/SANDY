import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { auditRepo } from '../../database/repositories/auditRepo.js';

export interface BinanceCredentials {
  apiKey: string;
  secretKey: string;
  merchantId: string;
  bep20Address: string;
  webhookUrl: string;
  webhookSecret: string;
  relayUrl: string;
  apiBaseUrl: string;
  configVersion: number;
  isConfigured: boolean;
}

export interface MaskedBinanceConfig {
  apiKeyMasked: string;
  secretKeyConfigured: boolean;
  merchantId: string;
  bep20Address: string;
  webhookUrl: string;
  webhookSecretMasked: string;
  relayUrl: string;
  apiBaseUrl: string;
  configVersion: number;
  isConfigured: boolean;
}

export const binanceConfigService = {
  getConfig(): BinanceCredentials {
    const apiKey = (settingsRepo.get('binance_api_key', '') || '').trim();
    const secretKey = (settingsRepo.get('binance_secret_key', '') || '').trim();
    const merchantId = (settingsRepo.get('binance_merchant_id', '') || '').trim();
    const bep20Address = (settingsRepo.get('binance_bep20_address', '') || '').trim();
    const webhookUrl = (settingsRepo.get('binance_webhook_url', '') || '').trim();
    const webhookSecret = (settingsRepo.get('binance_webhook_secret', '') || '').trim();
    const relayUrl = (settingsRepo.get('binance_relay_url', '') || '').trim();
    const apiBaseUrl = (settingsRepo.get('binance_api_base_url', '') || 'https://api.binance.com').trim();
    const configVersion = settingsRepo.getNumber('binance_config_version', 1);
    const isConfigured = settingsRepo.getBoolean('binance_is_configured', false);

    return {
      apiKey,
      secretKey,
      merchantId,
      bep20Address,
      webhookUrl,
      webhookSecret,
      relayUrl,
      apiBaseUrl,
      configVersion,
      isConfigured: Boolean(isConfigured && apiKey && secretKey)
    };
  },

  getMaskedConfig(): MaskedBinanceConfig {
    const cfg = this.getConfig();
    const apiKeyMasked = cfg.apiKey
      ? (cfg.apiKey.length > 10 ? cfg.apiKey.slice(0, 6) + '...' + cfg.apiKey.slice(-4) : '••••••••')
      : '';
    const webhookSecretMasked = cfg.webhookSecret
      ? (cfg.webhookSecret.length > 6 ? cfg.webhookSecret.slice(0, 3) + '...' + cfg.webhookSecret.slice(-3) : '••••••')
      : '';

    return {
      apiKeyMasked,
      secretKeyConfigured: Boolean(cfg.secretKey),
      merchantId: cfg.merchantId,
      bep20Address: cfg.bep20Address,
      webhookUrl: cfg.webhookUrl,
      webhookSecretMasked,
      relayUrl: cfg.relayUrl,
      apiBaseUrl: cfg.apiBaseUrl,
      configVersion: cfg.configVersion,
      isConfigured: cfg.isConfigured
    };
  },

  /**
   * Safe Live Configuration Switching with Pre-Validation
   */
  async updateConfigSafely(
    newConfig: {
      apiKey?: string;
      secretKey?: string;
      merchantId?: string;
      bep20Address?: string;
      webhookUrl?: string;
      webhookSecret?: string;
      relayUrl?: string;
      apiBaseUrl?: string;
    },
    validateFn: (creds: BinanceCredentials) => Promise<{ success: boolean; message: string }>,
    adminUser = 'admin'
  ): Promise<{ success: boolean; message: string }> {
    const current = this.getConfig();

    const candidateApiKey = newConfig.apiKey !== undefined && !newConfig.apiKey.includes('...')
      ? newConfig.apiKey.trim()
      : current.apiKey;

    const candidateSecretKey = newConfig.secretKey !== undefined && newConfig.secretKey.trim() && !newConfig.secretKey.includes('...')
      ? newConfig.secretKey.trim()
      : current.secretKey;

    const candidateMerchantId = newConfig.merchantId !== undefined
      ? newConfig.merchantId.trim()
      : current.merchantId;

    const candidateBep20 = newConfig.bep20Address !== undefined
      ? newConfig.bep20Address.trim()
      : current.bep20Address;

    const candidateWebhookUrl = newConfig.webhookUrl !== undefined
      ? newConfig.webhookUrl.trim()
      : current.webhookUrl;

    const candidateWebhookSecret = newConfig.webhookSecret !== undefined && !newConfig.webhookSecret.includes('...')
      ? newConfig.webhookSecret.trim()
      : current.webhookSecret;

    const candidateRelayUrl = newConfig.relayUrl !== undefined
      ? newConfig.relayUrl.trim()
      : current.relayUrl;

    const candidateApiBaseUrl = newConfig.apiBaseUrl !== undefined && newConfig.apiBaseUrl.trim()
      ? newConfig.apiBaseUrl.trim()
      : current.apiBaseUrl;

    const nextVersion = current.configVersion + 1;

    const candidateCreds: BinanceCredentials = {
      apiKey: candidateApiKey,
      secretKey: candidateSecretKey,
      merchantId: candidateMerchantId,
      bep20Address: candidateBep20,
      webhookUrl: candidateWebhookUrl,
      webhookSecret: candidateWebhookSecret,
      relayUrl: candidateRelayUrl,
      apiBaseUrl: candidateApiBaseUrl,
      configVersion: nextVersion,
      isConfigured: Boolean(candidateApiKey && candidateSecretKey)
    };

    // If API Key or Secret Key is provided, validate before saving
    let validationWarning = '';
    if (candidateApiKey && candidateSecretKey) {
      const validation = await validateFn(candidateCreds);
      if (!validation.success) {
        const isGeoOrNetwork = validation.message.includes('451') || 
                               validation.message.includes('connectivity') || 
                               validation.message.includes('timeout') ||
                               validation.message.includes('geo');

        // If explicitly bad credentials (401 / Invalid API Key), reject
        if (!isGeoOrNetwork) {
          auditRepo.logAdminAction({
            adminUser,
            action: 'BINANCE_CONFIG_UPDATE_FAILED',
            details: `Validation failed: ${validation.message}`
          });

          return {
            success: false,
            message: `❌ Configuration validation failed: ${validation.message}. Previous working configuration was retained.`
          };
        } else {
          validationWarning = ' (Note: Cloud host geo-restriction detected. Relay proxy is active for Binance API calls)';
        }
      }
    }

    // Validation succeeded -> Save to database
    if (newConfig.apiKey !== undefined && !newConfig.apiKey.includes('...')) {
      settingsRepo.set('binance_api_key', candidateApiKey);
    }
    if (newConfig.secretKey !== undefined && newConfig.secretKey.trim() && !newConfig.secretKey.includes('...')) {
      settingsRepo.set('binance_secret_key', candidateSecretKey);
    }
    if (newConfig.merchantId !== undefined) {
      settingsRepo.set('binance_merchant_id', candidateMerchantId);
    }
    if (newConfig.bep20Address !== undefined) {
      settingsRepo.set('binance_bep20_address', candidateBep20);
    }
    if (newConfig.webhookUrl !== undefined) {
      settingsRepo.set('binance_webhook_url', candidateWebhookUrl);
    }
    if (newConfig.webhookSecret !== undefined && !newConfig.webhookSecret.includes('...')) {
      settingsRepo.set('binance_webhook_secret', candidateWebhookSecret);
    }
    if (newConfig.relayUrl !== undefined) {
      settingsRepo.set('binance_relay_url', candidateRelayUrl);
    }
    if (newConfig.apiBaseUrl !== undefined && newConfig.apiBaseUrl.trim()) {
      settingsRepo.set('binance_api_base_url', candidateApiBaseUrl);
    }

    settingsRepo.set('binance_config_version', String(nextVersion));
    settingsRepo.set('binance_is_configured', candidateCreds.isConfigured ? 'true' : 'false');

    auditRepo.logAdminAction({
      adminUser,
      action: 'BINANCE_CONFIG_UPDATED',
      details: `Binance configuration updated to version v${nextVersion}. Merchant ID: ${candidateMerchantId || 'N/A'}`
    });

    return {
      success: true,
      message: `✅ Binance configuration validated and activated (v${nextVersion})!` + validationWarning
    };
  }
};
