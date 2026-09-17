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

export function extractOrderTokens(rawInput: string): string[] {
  if (!rawInput) return [];
  const tokens = new Set<string>();
  const trimmed = rawInput.trim();

  // 1. Direct alphanumeric token
  const cleanDirect = trimmed.replace(/[^a-zA-Z0-9_-]/g, '');
  if (cleanDirect.length >= 3) tokens.add(cleanDirect);

  // 2. Extract continuous numeric strings (e.g. 454811915688992768, 2481928374921)
  const numbers = trimmed.match(/\d{4,32}/g);
  if (numbers) {
    for (const num of numbers) tokens.add(num);
  }

  // 3. Strip common prefixes like 'Order ID:', 'TxID:', 'Txn ID:'
  const stripped = trimmed
    .replace(/^(order\s*id\s*[:\-\s]*|tx\s*id\s*[:\-\s]*|txn\s*id\s*[:\-\s]*|transaction\s*id\s*[:\-\s]*|ref\s*[:\-\s]*|id\s*[:\-\s]*)/i, '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (stripped.length >= 3) tokens.add(stripped);

  // 4. Add versions without 'p_' or 'P_'
  for (const t of Array.from(tokens)) {
    if (t.toLowerCase().startsWith('p_')) {
      const withoutP = t.substring(2);
      if (withoutP.length >= 3) tokens.add(withoutP);
    }
  }

  return Array.from(tokens);
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
    const candidateTokens = extractOrderTokens(rawOrderId);
    const primaryOrderId = candidateTokens[0] || rawOrderId.trim();

    if (!primaryOrderId || primaryOrderId.length < 3) {
      return {
        success: false,
        message: `❌ <b>Binance Payment Not Found</b>\n\nOrder ID <code>${rawOrderId || 'N/A'}</code> is invalid.\n\n💡 <i>Please check your Binance Pay receipt and enter the numeric Order ID or TxID.</i>`
      };
    }

    const payment = paymentRepo.getById(paymentId);
    if (!payment) {
      return { success: false, message: '⚠️ Payment session expired or not found.' };
    }

    if (payment.status === 'COMPLETED') {
      return { success: false, message: '✅ This payment has already been verified and completed.' };
    }

    // 1. Anti-fraud duplicate check across candidate tokens
    for (const token of candidateTokens) {
      if (paymentRepo.isExternalTxIdUsed(token) || paymentRepo.isExternalTxIdUsed('p_' + token)) {
        auditRepo.logBinanceEvent({
          paymentId: payment.id,
          referenceId: payment.reference_id,
          binanceOrderId: token,
          eventType: 'FAILED',
          status: 'DUPLICATE_CLAIM_ATTEMPT',
          details: `Order ID ${token} already redeemed by another payment`
        });

        return {
          success: false,
          message: `❌ <b>Already Claimed</b>\n\nOrder ID <code>${token}</code> has already been redeemed.`
        };
      }
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
      binanceOrderId: primaryOrderId,
      eventType: 'VERIFICATION_ATTEMPT',
      amountUsd: expectedUsd,
      amountInr: payment.amount,
      status: 'VERIFYING',
      details: `User submitted Order ID ${primaryOrderId} (tokens: ${candidateTokens.join(', ')}) for payment ${payment.id}`
    });

    // 2. Query Live Binance Transactions (SAPI + OpenAPI fallback)
    let matchedTxn: BinancePayTransaction | null = null;
    let liveTxns: BinancePayTransaction[] = [];

    try {
      liveTxns = await binanceApiService.fetchPayTransactions(undefined, { limit: 100 });
      
      matchedTxn = liveTxns.find(t => {
        const tOrder = (t.orderId || '').toLowerCase().trim();
        const tTxn = (t.transactionId || '').toLowerCase().trim();
        const tTxnNoP = tTxn.replace(/^p_/, '');

        for (const tok of candidateTokens) {
          const tokLower = tok.toLowerCase().trim();
          const tokNoP = tokLower.replace(/^p_/, '');

          if (
            tOrder === tokLower ||
            tTxn === tokLower ||
            tTxnNoP === tokNoP ||
            tOrder === tokNoP ||
            tTxn === ('p_' + tokNoP) ||
            (tokNoP.length >= 6 && (tOrder.includes(tokNoP) || tTxn.includes(tokNoP))) ||
            (tOrder.length >= 6 && tokNoP.includes(tOrder))
          ) {
            return true;
          }
        }
        return false;
      }) || null;
    } catch (e: any) {
      console.warn('Binance SAPI query notice during verification:', e.message);
    }

    // Fallback 1: Check OpenAPI order query for all candidate tokens
    if (!matchedTxn) {
      for (const tok of candidateTokens) {
        try {
          const openApiOrder = await binanceApiService.queryOpenApiOrder(tok);
          if (openApiOrder && (openApiOrder.status === 'PAID' || openApiOrder.status === 'SUCCESS')) {
            matchedTxn = {
              orderId: openApiOrder.merchantTradeNo || tok,
              transactionId: openApiOrder.transactionId || tok,
              amount: openApiOrder.orderAmount,
              currency: openApiOrder.currency || 'USDT',
              transactionTime: openApiOrder.createTime || Date.now()
            };
            break;
          }
        } catch {}
      }
    }

    // Fallback 2: Check by reference ID via OpenAPI
    if (!matchedTxn && payment.reference_id) {
      try {
        const openApiOrder = await binanceApiService.queryOpenApiOrder(payment.reference_id);
        if (openApiOrder && (openApiOrder.status === 'PAID' || openApiOrder.status === 'SUCCESS')) {
          matchedTxn = {
            orderId: openApiOrder.merchantTradeNo || payment.reference_id,
            transactionId: openApiOrder.transactionId || payment.reference_id,
            amount: openApiOrder.orderAmount,
            currency: openApiOrder.currency || 'USDT',
            transactionTime: openApiOrder.createTime || Date.now()
          };
        }
      } catch {}
    }

    // Fallback 3: Single matching recent transaction of exact amount in last 30 minutes
    if (!matchedTxn && liveTxns.length > 0 && expectedUsd > 0) {
      const now = Date.now();
      const recentUnclaimed = liveTxns.filter(t => {
        const isRecent = !t.transactionTime || (now - t.transactionTime < 30 * 60 * 1000);
        const amountMatch = Math.abs(t.amount - expectedUsd) <= 0.015;
        const alreadyClaimed = paymentRepo.isExternalTxIdUsed(t.orderId) || paymentRepo.isExternalTxIdUsed(t.transactionId);
        return isRecent && amountMatch && !alreadyClaimed;
      });

      if (recentUnclaimed.length === 1) {
        matchedTxn = recentUnclaimed[0];
      }
    }

    // 3. Process verification result
    if (!matchedTxn) {
      auditRepo.logBinanceEvent({
        paymentId: payment.id,
        referenceId: payment.reference_id,
        binanceOrderId: primaryOrderId,
        eventType: 'FAILED',
        status: 'PAYMENT_NOT_FOUND',
        details: `Order ID ${primaryOrderId} not found in recent Binance transactions`
      });

      return {
        success: false,
        message: `❌ <b>Binance Payment Not Found</b>\n\nOrder ID <code>${primaryOrderId}</code> was not found on Binance.\n\n💡 <i>If you just paid on Binance, please wait 15–30 seconds for confirmation and click <b>Enter Binance Order ID</b> again.</i>`
      };
    }

    // 4. Strict Amount & Currency Validation
    const isDirectShopOrder = Boolean(meta && meta.serviceId && meta.validityId);
    const roundingMargin = 0.015; // 0.015 USD margin for crypto rounding

    if (isDirectShopOrder && matchedTxn.amount < (expectedUsd - roundingMargin)) {
      auditRepo.logBinanceEvent({
        paymentId: payment.id,
        referenceId: payment.reference_id,
        binanceOrderId: primaryOrderId,
        eventType: 'FAILED',
        amountUsd: matchedTxn.amount,
        status: 'UNDERPAID',
        details: `Transferred $${matchedTxn.amount} USDT is less than required $${expectedUsd} USDT`
      });

      return {
        success: false,
        message: `❌ <b>Underpaid Binance Payment</b>\n\nReceived: $${matchedTxn.amount.toFixed(2)} USDT\nRequired: $${expectedUsd.toFixed(2)} USDT\n\n💡 <i>Please contact support if you need assistance.</i>`
      };
    }

    if (matchedTxn.amount <= 0) {
      return {
        success: false,
        message: `❌ <b>Invalid Payment Amount</b>\n\nThe transaction amount is $0.00.`
      };
    }

    const canonicalOrderId = matchedTxn.orderId || matchedTxn.transactionId || primaryOrderId;

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
