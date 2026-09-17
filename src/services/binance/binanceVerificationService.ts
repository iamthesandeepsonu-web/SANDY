import { db, runTransaction } from '../../database/db.js';
import { paymentRepo, Payment } from '../../database/repositories/paymentRepo.js';
import { userRepo } from '../../database/repositories/userRepo.js';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { auditRepo } from '../../database/repositories/auditRepo.js';
import { fulfillmentService } from '../fulfillmentService.js';
import { binanceApiService, BinancePayTransaction } from './binanceApiService.js';

export interface BinanceVerificationResult {
  success: boolean;
  message: string;
  isOrderFulfilled?: boolean;
  isPendingReview?: boolean;
  order?: any;
  licenseKey?: string;
  walletBalance?: number;
  amountInr?: number;
  amountUsd?: number;
  binanceOrderId?: string;
}

export const binanceVerificationService = {
  /**
   * Verify and claim a Binance payment using Order ID / Transaction ID
   */
  async verifyAndClaimPayment(
    paymentId: string,
    rawOrderId: string,
    _optionalUserId?: string
  ): Promise<BinanceVerificationResult> {
    const cleanOrderId = rawOrderId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanLower = cleanOrderId.toLowerCase();
    const cleanNoPrefix = cleanLower.replace(/^p_/, '');

    if (!cleanOrderId || cleanOrderId.length < 4) {
      return {
        success: false,
        message: `❌ <b>Binance Payment Not Found</b>\n\nOrder ID <code>${cleanOrderId || 'N/A'}</code> was not found on Binance.\n\n💡 <i>Please verify your Order ID and try again in 15–30 seconds.</i>`
      };
    }

    const payment = paymentRepo.getById(paymentId);
    if (!payment) {
      return { success: false, message: '⚠️ Payment session expired or not found.' };
    }

    if (payment.status === 'COMPLETED') {
      return { success: false, message: '✅ This payment has already been verified and completed.' };
    }

    // 1. Anti-fraud duplicate check across completed payments
    if (paymentRepo.isExternalTxIdUsed(cleanOrderId) || paymentRepo.isExternalTxIdUsed(cleanNoPrefix)) {
      auditRepo.logBinanceEvent({
        paymentId: payment.id,
        referenceId: payment.reference_id,
        binanceOrderId: cleanOrderId,
        eventType: 'FAILED',
        status: 'DUPLICATE_CLAIM_ATTEMPT',
        details: `Order ID ${cleanOrderId} already redeemed by another payment`
      });

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

    // Log verification attempt
    auditRepo.logBinanceEvent({
      paymentId: payment.id,
      referenceId: payment.reference_id,
      binanceOrderId: cleanOrderId,
      eventType: 'VERIFICATION_ATTEMPT',
      amountUsd: expectedUsd,
      amountInr: payment.amount,
      status: 'VERIFYING',
      details: `User submitted Order ID ${cleanOrderId} for payment ${payment.id}`
    });

    // 2. Query Live Binance Transactions (SAPI + OpenAPI fallback)
    let matchedTxn: BinancePayTransaction | null = null;

    try {
      const liveTxns = await binanceApiService.fetchPayTransactions(undefined, { limit: 50 });
      matchedTxn = liveTxns.find(t => {
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
      }) || null;
    } catch (e: any) {
      console.warn('Binance SAPI query error during verification:', e.message);
    }

    // Fallback: Check OpenAPI order query if SAPI didn't return
    if (!matchedTxn) {
      try {
        const openApiOrder = await binanceApiService.queryOpenApiOrder(cleanOrderId);
        if (openApiOrder && (openApiOrder.status === 'PAID' || openApiOrder.status === 'SUCCESS')) {
          matchedTxn = {
            orderId: openApiOrder.merchantTradeNo || cleanOrderId,
            transactionId: openApiOrder.transactionId || cleanOrderId,
            amount: openApiOrder.orderAmount,
            currency: openApiOrder.currency || 'USDT',
            transactionTime: openApiOrder.createTime || Date.now()
          };
        }
      } catch {}
    }

    // 3. Process verification result
    if (!matchedTxn) {
      auditRepo.logBinanceEvent({
        paymentId: payment.id,
        referenceId: payment.reference_id,
        binanceOrderId: cleanOrderId,
        eventType: 'FAILED',
        status: 'PAYMENT_NOT_FOUND',
        details: `Order ID ${cleanOrderId} not found in recent Binance transactions`
      });

      return {
        success: false,
        message: `❌ <b>Binance Payment Not Found</b>\n\nOrder ID <code>${cleanOrderId}</code> was not found on Binance.\n\n💡 <i>If you just paid on Binance, please wait 15–30 seconds for confirmation and click <b>Enter Binance Order ID</b> again.</i>`
      };
    }

    // 4. Strict Amount & Currency Validation
    const isDirectShopOrder = Boolean(meta && meta.serviceId && meta.validityId);
    const roundingMargin = 0.015; // 0.015 USD margin for crypto rounding

    if (isDirectShopOrder && matchedTxn.amount < (expectedUsd - roundingMargin)) {
      auditRepo.logBinanceEvent({
        paymentId: payment.id,
        referenceId: payment.reference_id,
        binanceOrderId: cleanOrderId,
        eventType: 'FAILED',
        amountUsd: matchedTxn.amount,
        status: 'UNDERPAID',
        details: `Transferred $${matchedTxn.amount} USDT is less than required $${expectedUsd} USDT`
      });

      return {
        success: false,
        message: `❌ <b>Binance Payment Not Found</b>\n\nOrder ID <code>${cleanOrderId}</code> was not found on Binance.\n\n💡 <i>If you just paid on Binance, please wait 15–30 seconds for confirmation and click <b>Enter Binance Order ID</b> again.</i>`
      };
    }

    if (matchedTxn.amount <= 0) {
      return {
        success: false,
        message: `❌ <b>Invalid Payment Amount</b>\n\nThe transaction amount is $0.00.`
      };
    }

    const canonicalOrderId = matchedTxn.orderId || matchedTxn.transactionId || cleanOrderId;

    // 5. ATOMIC COMPLETION & FULFILLMENT
    return await runTransaction(async () => {
      // Complete payment record
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

          auditRepo.logBinanceEvent({
            paymentId: payment.id,
            referenceId: payment.reference_id,
            binanceOrderId: canonicalOrderId,
            eventType: 'VERIFIED',
            amountUsd: matchedTxn!.amount,
            amountInr: updatedPayment.amount,
            status: 'ORDER_FULFILLED',
            details: `Order fulfilled: ${fulfillRes.order.id} for service ${meta.serviceId}`
          });

          return {
            success: true,
            message: '🎉 <b>Payment Auto-Verified & License Key Delivered!</b>',
            isOrderFulfilled: true,
            order: fulfillRes.order,
            licenseKey: fulfillRes.licenseKey || fulfillRes.order.license_key,
            amountInr: updatedPayment.amount,
            amountUsd: matchedTxn!.amount,
            binanceOrderId: canonicalOrderId
          };
        }
      }

      // Wallet Top-Up: Return updated wallet balance
      const updatedUser = userRepo.getById(targetUserId);

      auditRepo.logBinanceEvent({
        paymentId: payment.id,
        referenceId: payment.reference_id,
        binanceOrderId: canonicalOrderId,
        eventType: 'VERIFIED',
        amountUsd: matchedTxn!.amount,
        amountInr: updatedPayment.amount,
        status: 'WALLET_CREDITED',
        details: `Wallet credited with ₹${updatedPayment.amount.toFixed(2)} ($${matchedTxn!.amount.toFixed(2)} USDT)`
      });

      return {
        success: true,
        message: `🎉 <b>Payment Auto-Verified!</b> $${matchedTxn!.amount.toFixed(2)} USDT (₹${updatedPayment.amount.toFixed(2)}) has been credited to your wallet balance.`,
        isOrderFulfilled: false,
        walletBalance: updatedUser ? updatedUser.balance : updatedPayment.amount,
        amountInr: updatedPayment.amount,
        amountUsd: matchedTxn!.amount,
        binanceOrderId: canonicalOrderId
      };
    });
  }
};
