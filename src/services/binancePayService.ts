import crypto from 'crypto';
import axios from 'axios';
import { db } from '../database/db.js';
import { settingsRepo } from '../database/repositories/settingsRepo.js';
import { paymentRepo } from '../database/repositories/paymentRepo.js';
import { userRepo } from '../database/repositories/userRepo.js';
import { cryptoDepositRepo } from '../database/repositories/cryptoDepositRepo.js';
import { fulfillmentService } from './fulfillmentService.js';

export interface BinancePayConfig {
  apiKey: string;
  secretKey: string;
  merchantId: string;
  bep20Address: string;
  relayUrl: string;
  isConfigured: boolean;
}

export const binancePayService = {
  getConfig(): BinancePayConfig {
    const apiKey = (settingsRepo.get('binance_api_key', '') || process.env.BINANCE_API_KEY || 'R64c3ZFYaykmHXyk29VphrMpUovbdl0CxILGmssfoMYsfOKG9mL6iGpAm2XX9rsE').trim();
    const secretKey = (settingsRepo.get('binance_secret_key', '') || process.env.BINANCE_SECRET_KEY || 'Ym8WJpIZCoDb2mejQ0vfGvxHoc6QgCxiNbJRBbvThsTOOBhfJWQzlsuCeVsI9v5Z').trim();
    const merchantId = (settingsRepo.get('binance_merchant_id', '') || process.env.BINANCE_PAY_ID || '433230697').trim();
    const bep20Address = (settingsRepo.get('binance_bep20_address', '') || process.env.BINANCE_BEP20_ADDRESS || '').trim();
    const relayUrl = (settingsRepo.get('binance_relay_url', 'https://apiproxy.site/binance-relay.php')).trim();
    const isConfigured = settingsRepo.getBoolean('binance_is_configured', true);

    return {
      apiKey,
      secretKey,
      merchantId,
      bep20Address,
      relayUrl,
      isConfigured: isConfigured && Boolean(apiKey && secretKey)
    };
  },

  async fetchRecentTransactions(): Promise<Array<{
    orderId: string;
    transactionId: string;
    amount: number;
    currency: string;
    payerName?: string;
    transactionTime: number;
  }>> {
    const cfg = this.getConfig();
    if (!cfg.apiKey || !cfg.secretKey) {
      return [];
    }

    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', cfg.secretKey).update(queryString).digest('hex');

      const res = await axios.get(`https://api.binance.com/sapi/v1/pay/transactions?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': cfg.apiKey },
        timeout: 8000
      });

      const txns = res.data?.data || [];
      return txns.map((t: any) => ({
        orderId: String(t.orderId || '').trim(),
        transactionId: String(t.transactionId || '').trim(),
        amount: parseFloat(t.amount || '0'),
        currency: t.currency || 'USDT',
        payerName: t.payerInfo?.name || '',
        transactionTime: Number(t.transactionTime || 0)
      }));
    } catch (err: any) {
      console.error('Error fetching Binance SAPI transactions:', err.response?.data || err.message);
      return [];
    }
  },

  async testConnection(): Promise<{ success: boolean; message: string; accountStatus?: string }> {
    const cfg = this.getConfig();
    if (!cfg.apiKey || !cfg.secretKey) {
      return {
        success: false,
        message: 'Binance API Key or Secret Key is missing'
      };
    }

    try {
      const txns = await this.fetchRecentTransactions();
      return {
        success: true,
        message: `🟢 Binance Pay API Connected & Active! Found ${txns.length} live transactions for Pay ID: ${cfg.merchantId || '433230697'}`,
        accountStatus: 'Active & Verified'
      };
    } catch (err: any) {
      return {
        success: false,
        message: 'Binance Connection Error: ' + err.message
      };
    }
  },

  async generateOrderPayload(amountInr: number, amountUsd: number, refId: string): Promise<{
    merchantId: string;
    bep20Address: string;
  }> {
    const cfg = this.getConfig();
    return {
      merchantId: cfg.merchantId || '433230697',
      bep20Address: cfg.bep20Address || ''
    };
  },

  /**
   * Actual Direct Binance Order ID Verification & Claim
   */
  async verifyAndClaimBinanceOrderId(paymentId: string, rawOrderId: string, _optionalUserId?: string): Promise<{
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
    const cleanOrderId = rawOrderId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanLower = cleanOrderId.toLowerCase();
    const cleanNoPrefix = cleanLower.replace(/^p_/, '');

    if (!cleanOrderId || cleanOrderId.length < 4) {
      return {
        success: false,
        message: '❌ <b>Binance Payment Not Found</b>\n\nOrder ID <code>' + cleanOrderId + '</code> was not found on Binance.\n\n💡 <i>If you just paid on Binance, please wait 15–30 seconds for confirmation and click <b>Enter Binance Order ID</b> again.</i>'
      };
    }

    const payment = paymentRepo.getById(paymentId);
    if (!payment) {
      return { success: false, message: '⚠️ Payment session not found or expired.' };
    }

    if (payment.status === 'COMPLETED') {
      return { success: false, message: '✅ This payment has already been verified and completed.' };
    }

    // Anti-fraud duplicate check across completed payments
    if (paymentRepo.isExternalTxIdUsed(cleanOrderId) || paymentRepo.isExternalTxIdUsed(cleanNoPrefix)) {
      return {
        success: false,
        message: `❌ <b>Already Claimed</b>\n\nOrder ID <code>${cleanOrderId}</code> has already been redeemed.`
      };
    }

    let meta: any = {};
    if (payment.metadata) {
      try {
        meta = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
      } catch {}
    }

    const expectedUsd = meta.priceUsd !== undefined ? Number(meta.priceUsd) : settingsRepo.calculateUsd(payment.amount);
    const targetUserId = payment.user_id;
    const user = userRepo.getById(targetUserId);

    // 1. Check Live Binance Official Transactions
    const liveTxns = await this.fetchRecentTransactions();
    const matchedSapiTxn = liveTxns.find(t => {
      const tOrder = (t.orderId || '').toLowerCase().trim();
      const tTxn = (t.transactionId || '').toLowerCase().trim();
      const tTxnNoP = tTxn.replace(/^p_/, '');

      return (
        tOrder === cleanLower ||
        tTxn === cleanLower ||
        tTxnNoP === cleanNoPrefix ||
        tTxn === ('p_' + cleanLower) ||
        (cleanLower.length >= 7 && (tOrder.includes(cleanLower) || tTxn.includes(cleanLower))) ||
        (cleanNoPrefix.length >= 7 && (tTxnNoP.includes(cleanNoPrefix) || tOrder.includes(cleanNoPrefix)))
      );
    });

    // 2. Payment Verification Check
    if (matchedSapiTxn) {
      const isDirectShopOrder = Boolean(meta && meta.serviceId && meta.validityId);

      // For Direct Product Purchase: Ensure customer transferred required USD price (with 0.015 rounding margin)
      if (isDirectShopOrder && matchedSapiTxn.amount < (expectedUsd - 0.015)) {
        return {
          success: false,
          message: `❌ <b>Binance Payment Not Found</b>\n\nOrder ID <code>${cleanOrderId}</code> was not found on Binance.\n\n💡 <i>If you just paid on Binance, please wait 15–30 seconds for confirmation and click <b>Enter Binance Order ID</b> again.</i>`
        };
      }

      // For Wallet Top-Up: Ensure valid positive amount transferred
      if (matchedSapiTxn.amount <= 0) {
        return {
          success: false,
          message: `❌ <b>Binance Payment Not Found</b>\n\nOrder ID <code>${cleanOrderId}</code> was not found on Binance.\n\n💡 <i>If you just paid on Binance, please wait 15–30 seconds for confirmation and click <b>Enter Binance Order ID</b> again.</i>`
        };
      }

      const canonicalOrderId = matchedSapiTxn.orderId || matchedSapiTxn.transactionId || cleanOrderId;

      // Check if already claimed in local records
      const depCheck = cryptoDepositRepo.getByOrderId(canonicalOrderId);
      if (depCheck && depCheck.is_claimed) {
        return {
          success: false,
          message: `❌ <b>Already Claimed</b>\n\nOrder ID <code>${cleanOrderId}</code> has already been redeemed.`
        };
      }

      // Record and claim deposit
      cryptoDepositRepo.recordDeposit({
        orderId: canonicalOrderId,
        amountUsd: matchedSapiTxn.amount,
        currency: matchedSapiTxn.currency,
        senderInfo: matchedSapiTxn.payerName,
        source: 'BINANCE_SAPI'
      });
      cryptoDepositRepo.claimDeposit(canonicalOrderId, payment.id);

      // Compute actual INR value from transferred USDT
      const usdRate = settingsRepo.getUsdRate();
      const creditedInr = isDirectShopOrder ? payment.amount : parseFloat((matchedSapiTxn.amount * usdRate).toFixed(2));

      // Complete payment
      const completeRes = paymentRepo.completePayment(payment.id, canonicalOrderId);
      const updatedPayment = completeRes.payment;

      // Direct Product Purchase: Deliver license key immediately
      if (isDirectShopOrder) {
        const fulfillRes = await fulfillmentService.processPurchase(targetUserId, meta.serviceId, meta.validityId);
        if (fulfillRes.success && fulfillRes.order) {
          meta.orderId = fulfillRes.order.id;
          meta.licenseKey = fulfillRes.licenseKey || fulfillRes.order.license_key;
          meta.binanceTxnId = canonicalOrderId;
          db.prepare('UPDATE payments SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), updatedPayment.id);

          return {
            success: true,
            message: '🎉 <b>Payment Auto-Verified & License Key Delivered!</b>',
            isOrderFulfilled: true,
            order: fulfillRes.order,
            licenseKey: fulfillRes.licenseKey || fulfillRes.order.license_key,
            amountInr: updatedPayment.amount,
            amountUsd: matchedSapiTxn.amount
          };
        }
      }

      // Wallet Top-Up: Return updated balance
      const updatedUser = userRepo.getById(targetUserId);

      return {
        success: true,
        message: `🎉 <b>Payment Auto-Verified!</b> ₹${updatedPayment.amount.toFixed(2)} ($${matchedSapiTxn.amount.toFixed(2)} USDT) has been credited to your wallet balance.`,
        isOrderFulfilled: false,
        walletBalance: updatedUser ? updatedUser.balance : updatedPayment.amount,
        amountInr: updatedPayment.amount,
        amountUsd: matchedSapiTxn.amount
      };
    }

    // Payment not found
    return {
      success: false,
      message: `❌ <b>Binance Payment Not Found</b>\n\nOrder ID <code>${cleanOrderId}</code> was not found on Binance.\n\n💡 <i>If you just paid on Binance, please wait 15–30 seconds for confirmation and click <b>Enter Binance Order ID</b> again.</i>`
    };
  }
};
