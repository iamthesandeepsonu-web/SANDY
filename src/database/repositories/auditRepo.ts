import { db, queryOne, queryAll } from '../db.js';
import crypto from 'crypto';

export interface AdminAuditLog {
  id: string;
  admin_user: string;
  action: string;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface BinancePaymentLog {
  id: string;
  payment_id: string;
  reference_id: string;
  binance_order_id: string | null;
  event_type: 'CREATED' | 'VERIFICATION_ATTEMPT' | 'VERIFIED' | 'FAILED' | 'WEBHOOK_RECEIVED' | 'RECONCILED';
  amount_usd: number | null;
  amount_inr: number | null;
  status: string;
  details: string | null;
  created_at: string;
}

export const auditRepo = {
  logAdminAction(data: {
    adminUser: string;
    action: string;
    details?: string;
    ipAddress?: string;
  }): AdminAuditLog {
    const id = 'aud_' + crypto.randomBytes(8).toString('hex');
    db.prepare(`
      INSERT INTO admin_audit_logs (id, admin_user, action, details, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      data.adminUser,
      data.action,
      data.details || null,
      data.ipAddress || null
    );

    return queryOne<AdminAuditLog>('SELECT * FROM admin_audit_logs WHERE id = ?', id)!;
  },

  listAdminLogs(limit = 50): AdminAuditLog[] {
    return queryAll<AdminAuditLog>(`
      SELECT * FROM admin_audit_logs 
      ORDER BY created_at DESC 
      LIMIT ?
    `, limit);
  },

  logBinanceEvent(data: {
    paymentId: string;
    referenceId: string;
    binanceOrderId?: string | null;
    eventType: 'CREATED' | 'VERIFICATION_ATTEMPT' | 'VERIFIED' | 'FAILED' | 'WEBHOOK_RECEIVED' | 'RECONCILED';
    amountUsd?: number | null;
    amountInr?: number | null;
    status: string;
    details?: string | null;
  }): BinancePaymentLog {
    const id = 'bpl_' + crypto.randomBytes(8).toString('hex');
    db.prepare(`
      INSERT INTO binance_payment_logs (
        id, payment_id, reference_id, binance_order_id, event_type, amount_usd, amount_inr, status, details
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.paymentId,
      data.referenceId,
      data.binanceOrderId || null,
      data.eventType,
      data.amountUsd ?? null,
      data.amountInr ?? null,
      data.status,
      data.details || null
    );

    return queryOne<BinancePaymentLog>('SELECT * FROM binance_payment_logs WHERE id = ?', id)!;
  },

  listBinanceLogs(paymentId?: string, limit = 50): BinancePaymentLog[] {
    if (paymentId) {
      return queryAll<BinancePaymentLog>(`
        SELECT * FROM binance_payment_logs 
        WHERE payment_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `, paymentId, limit);
    }
    return queryAll<BinancePaymentLog>(`
      SELECT * FROM binance_payment_logs 
      ORDER BY created_at DESC 
      LIMIT ?
    `, limit);
  }
};
