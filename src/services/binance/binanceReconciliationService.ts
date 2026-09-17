import { db } from '../../database/db.js';
import { paymentRepo, Payment } from '../../database/repositories/paymentRepo.js';
import { auditRepo } from '../../database/repositories/auditRepo.js';
import { binanceApiService } from './binanceApiService.js';
import { binanceVerificationService } from './binanceVerificationService.js';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';

export const binanceReconciliationService = {
  /**
   * Reconcile a single pending Binance payment against live transactions
   */
  async reconcilePayment(paymentId: string, adminUser = 'admin'): Promise<{
    success: boolean;
    message: string;
    isPaid?: boolean;
    payment?: Payment;
  }> {
    const payment = paymentRepo.getById(paymentId);
    if (!payment) {
      return { success: false, message: 'Payment record not found' };
    }

    if (payment.status === 'COMPLETED') {
      return { success: true, message: 'Payment is already COMPLETED', isPaid: true, payment };
    }

    if (payment.payment_method !== 'BINANCE_PAY') {
      return { success: false, message: 'Payment is not a Binance Pay payment' };
    }

    let meta: any = {};
    if (payment.metadata) {
      try {
        meta = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
      } catch {}
    }

    const expectedUsd = meta.priceUsd !== undefined ? Number(meta.priceUsd) : settingsRepo.calculateUsd(payment.amount);
    const refId = payment.reference_id;

    // 1. Fetch live transactions from Binance
    try {
      const liveTxns = await binanceApiService.fetchPayTransactions(undefined, { limit: 100 });
      
      // Look for matches on order ID, reference ID, or exact expected amount in recent time window
      const match = liveTxns.find(t => {
        const tOrder = (t.orderId || '').toLowerCase();
        const tTxn = (t.transactionId || '').toLowerCase();
        const refLower = refId.toLowerCase();

        return (
          tOrder === refLower ||
          tTxn === refLower ||
          (refId.length >= 6 && (tOrder.includes(refLower) || tTxn.includes(refLower)))
        );
      });

      if (match) {
        const verifyRes = await binanceVerificationService.verifyAndClaimPayment(
          payment.id,
          match.orderId || match.transactionId,
          String(payment.telegram_id)
        );

        auditRepo.logAdminAction({
          adminUser,
          action: 'BINANCE_PAYMENT_RECONCILED',
          details: `Payment ${payment.id} reconciled via Binance transaction ${match.orderId}. Result: ${verifyRes.success ? 'COMPLETED' : 'FAILED'}`
        });

        const updated = paymentRepo.getById(payment.id)!;
        return {
          success: verifyRes.success,
          message: verifyRes.message,
          isPaid: verifyRes.success,
          payment: updated
        };
      }

      // Check OpenAPI query for reference ID
      const openApiOrder = await binanceApiService.queryOpenApiOrder(refId);
      if (openApiOrder && (openApiOrder.status === 'PAID' || openApiOrder.status === 'SUCCESS')) {
        const verifyRes = await binanceVerificationService.verifyAndClaimPayment(
          payment.id,
          openApiOrder.transactionId || refId,
          String(payment.telegram_id)
        );

        const updated = paymentRepo.getById(payment.id)!;
        return {
          success: verifyRes.success,
          message: verifyRes.message,
          isPaid: verifyRes.success,
          payment: updated
        };
      }

      return {
        success: false,
        message: `No matching completed Binance transaction found for Reference ID: ${refId}. Payment remains PENDING.`,
        isPaid: false,
        payment
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Reconciliation error: ${err.message}`,
        payment
      };
    }
  },

  /**
   * Reconcile all pending Binance payments in batch
   */
  async reconcileAllPending(adminUser = 'admin'): Promise<{
    totalPending: number;
    reconciledCount: number;
    results: Array<{ paymentId: string; referenceId: string; status: string; message: string }>;
  }> {
    const pendingPayments = paymentRepo.list({
      paymentMethod: 'BINANCE_PAY',
      status: 'PENDING',
      limit: 50
    }).payments;

    const results: Array<{ paymentId: string; referenceId: string; status: string; message: string }> = [];
    let reconciledCount = 0;

    for (const p of pendingPayments) {
      const res = await this.reconcilePayment(p.id, adminUser);
      if (res.isPaid) {
        reconciledCount++;
      }
      results.push({
        paymentId: p.id,
        referenceId: p.reference_id,
        status: res.isPaid ? 'COMPLETED' : 'PENDING',
        message: res.message
      });
    }

    auditRepo.logAdminAction({
      adminUser,
      action: 'BINANCE_BATCH_RECONCILIATION',
      details: `Reconciled ${reconciledCount} out of ${pendingPayments.length} pending payments`
    });

    return {
      totalPending: pendingPayments.length,
      reconciledCount,
      results
    };
  }
};
