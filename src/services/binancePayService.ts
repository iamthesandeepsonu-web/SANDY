import { binanceConfigService, BinanceCredentials, MaskedBinanceConfig } from './binance/binanceConfigService.js';
import { binanceApiService, BinancePayTransaction } from './binance/binanceApiService.js';
import { binanceVerificationService, BinanceVerificationResult } from './binance/binanceVerificationService.js';
import { binanceWebhookService } from './binance/binanceWebhookService.js';
import { binanceIntegrityCheckService, IntegrityCheckReport } from './binance/binanceIntegrityCheckService.js';
import { binanceReconciliationService } from './binance/binanceReconciliationService.js';

export interface BinancePayConfig {
  apiKey: string;
  secretKey: string;
  merchantId: string;
  bep20Address: string;
  webhookSecret: string;
  relayUrl: string;
  isConfigured: boolean;
}

/**
 * Unified Binance Payment Gateway Service
 * Production-Ready Backend integrating official Binance OpenAPI & SAPI
 */
export const binancePayService = {
  getConfig(): BinancePayConfig {
    return binanceConfigService.getConfig();
  },

  getMaskedConfig(): MaskedBinanceConfig {
    return binanceConfigService.getMaskedConfig();
  },

  async updateConfigSafely(
    newConfig: {
      apiKey?: string;
      secretKey?: string;
      merchantId?: string;
      bep20Address?: string;
      webhookSecret?: string;
      relayUrl?: string;
    },
    adminUser = 'admin'
  ): Promise<{ success: boolean; message: string }> {
    return binanceConfigService.updateConfigSafely(
      newConfig,
      async (creds) => {
        const test = await binanceApiService.testConnectivity(creds);
        return {
          success: test.success,
          message: test.message
        };
      },
      adminUser
    );
  },

  async fetchRecentTransactions(limit = 20): Promise<BinancePayTransaction[]> {
    return binanceApiService.fetchPayTransactions(undefined, { limit });
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
   * Verified Order ID claim with anti-fraud duplicate checks and atomic fulfillment
   */
  async verifyAndClaimBinanceOrderId(
    paymentId: string,
    rawOrderId: string,
    optionalUserId?: string
  ): Promise<BinanceVerificationResult> {
    return binanceVerificationService.verifyAndClaimPayment(paymentId, rawOrderId, optionalUserId);
  },

  /**
   * Run full multi-point diagnostic Integrity Check
   */
  async testConnection(adminUser = 'admin'): Promise<IntegrityCheckReport> {
    return binanceIntegrityCheckService.runFullIntegrityCheck(undefined, adminUser);
  },

  async runIntegrityCheck(adminUser = 'admin'): Promise<IntegrityCheckReport> {
    return binanceIntegrityCheckService.runFullIntegrityCheck(undefined, adminUser);
  },

  /**
   * Reconcile pending payments
   */
  async reconcilePayment(paymentId: string, adminUser = 'admin') {
    return binanceReconciliationService.reconcilePayment(paymentId, adminUser);
  },

  async reconcileAllPending(adminUser = 'admin') {
    return binanceReconciliationService.reconcileAllPending(adminUser);
  },

  /**
   * Webhook processing
   */
  async handleWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>) {
    return binanceWebhookService.handleWebhook(rawBody, headers);
  }
};
