import { settingsRepo } from '../database/repositories/settingsRepo.js';

export interface BinancePayConfig {
  apiKey: string;
  secretKey: string;
  merchantId: string;
  bep20Address: string;
  relayUrl: string;
  isConfigured: boolean;
}

/**
 * Binance Payment Service Stub (Backend Reset)
 * All previous API integrations, SAPI queries, OpenAPI queries, and webhook handlers
 * have been completely removed awaiting new implementation specifications.
 */
export const binancePayService = {
  getConfig(): BinancePayConfig {
    const apiKey = (settingsRepo.get('binance_api_key', '') || process.env.BINANCE_API_KEY || '').trim();
    const secretKey = (settingsRepo.get('binance_secret_key', '') || process.env.BINANCE_SECRET_KEY || '').trim();
    const merchantId = (settingsRepo.get('binance_merchant_id', '') || process.env.BINANCE_PAY_ID || '').trim();
    const bep20Address = (settingsRepo.get('binance_bep20_address', '') || process.env.BINANCE_BEP20_ADDRESS || '').trim();
    const relayUrl = (settingsRepo.get('binance_relay_url', '')).trim();
    const isConfigured = settingsRepo.getBoolean('binance_is_configured', false);

    return {
      apiKey,
      secretKey,
      merchantId,
      bep20Address,
      relayUrl,
      isConfigured: isConfigured && Boolean(apiKey && secretKey)
    };
  },

  async testConnection(): Promise<{ success: boolean; message: string; accountStatus?: string }> {
    return {
      success: false,
      message: 'Binance payment gateway backend is reset and awaiting new configuration.',
      accountStatus: 'Reset / Pending Setup'
    };
  },

  async generateOrderPayload(_amountInr: number, _amountUsd: number, _refId: string): Promise<{
    merchantId: string;
    bep20Address: string;
  }> {
    const cfg = this.getConfig();
    return {
      merchantId: cfg.merchantId,
      bep20Address: cfg.bep20Address
    };
  },

  /**
   * Placeholder verification stub - old verification and claim logic removed
   */
  async verifyAndClaimBinanceOrderId(_paymentId: string, _rawOrderId: string, _optionalUserId?: string): Promise<{
    success: boolean;
    message: string;
    isPendingReview?: boolean;
    isOrderFulfilled?: boolean;
    order?: any;
    licenseKey?: string;
    walletBalance?: number;
    amountInr?: number;
    amountUsd?: number;
  }> {
    return {
      success: false,
      message: '⚠️ <b>Binance Payment Gateway Reset</b>\n\nThe Binance payment gateway backend is currently undergoing a clean reset and setup. Please use UPI payment or contact support.'
    };
  }
};
