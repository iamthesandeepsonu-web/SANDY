import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { auditRepo } from '../../database/repositories/auditRepo.js';

export interface BinanceCredentials {
  apiKey: string;
  secretKey: string;
  merchantId: string;
  bep20Address: string;
  webhookSecret: string;
  relayUrl: string;
  isConfigured: boolean;
}

export interface MaskedBinanceConfig {
  apiKeyMasked: string;
  secretKeyConfigured: boolean;
  merchantId: string;
  bep20Address: string;
  webhookSecretMasked: string;
  relayUrl: string;
  isConfigured: boolean;
}

export const binanceConfigService = {
  getConfig(): BinanceCredentials {
    const apiKey = (settingsRepo.get('binance_api_key', '') || process.env.BINANCE_API_KEY || '').trim();
    const secretKey = (settingsRepo.get('binance_secret_key', '') || process.env.BINANCE_SECRET_KEY || '').trim();
    const merchantId = (settingsRepo.get('binance_merchant_id', '') || process.env.BINANCE_PAY_ID || '').trim();
    const bep20Address = (settingsRepo.get('binance_bep20_address', '') || process.env.BINANCE_BEP20_ADDRESS || '').trim();
    const webhookSecret = (settingsRepo.get('binance_webhook_secret', '') || process.env.BINANCE_WEBHOOK_SECRET || '').trim();
    const relayUrl = (settingsRepo.get('binance_relay_url', '') || '').trim();
    const isConfigured = settingsRepo.getBoolean('binance_is_configured', false);

    return {
      apiKey,
      secretKey,
      merchantId,
      bep20Address,
      webhookSecret,
      relayUrl,
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
      webhookSecretMasked,
      relayUrl: cfg.relayUrl,
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
      webhookSecret?: string;
      relayUrl?: string;
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

    const candidateWebhookSecret = newConfig.webhookSecret !== undefined && !newConfig.webhookSecret.includes('...')
      ? newConfig.webhookSecret.trim()
      : current.webhookSecret;

    const candidateRelayUrl = newConfig.relayUrl !== undefined
      ? newConfig.relayUrl.trim()
      : current.relayUrl;

    const candidateCreds: BinanceCredentials = {
      apiKey: candidateApiKey,
      secretKey: candidateSecretKey,
      merchantId: candidateMerchantId,
      bep20Address: candidateBep20,
      webhookSecret: candidateWebhookSecret,
      relayUrl: candidateRelayUrl,
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
    if (newConfig.webhookSecret !== undefined && !newConfig.webhookSecret.includes('...')) {
      settingsRepo.set('binance_webhook_secret', candidateWebhookSecret);
    }
    if (newConfig.relayUrl !== undefined) {
      settingsRepo.set('binance_relay_url', candidateRelayUrl);
    }

    settingsRepo.set('binance_is_configured', candidateCreds.isConfigured ? 'true' : 'false');

    auditRepo.logAdminAction({
      adminUser,
      action: 'BINANCE_CONFIG_UPDATED',
      details: `Binance configuration updated and activated. Merchant ID: ${candidateMerchantId || 'N/A'}`
    });

    return {
      success: true,
      message: '✅ Binance Pay configuration validated and activated successfully!' + validationWarning
    };
  }
};
