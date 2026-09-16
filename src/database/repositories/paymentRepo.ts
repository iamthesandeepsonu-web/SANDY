import { db, runTransaction, queryOne, queryAll } from '../db.js';
import { userRepo } from './userRepo.js';
import crypto from 'crypto';

export interface Payment {
  id: string;
  user_id: string;
  telegram_id: number;
  payment_method: 'UPI_AUTO' | 'BINANCE_PAY';
  amount: number;
  reference_id: string;
  external_tx_id: string | null;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  qr_payload: string | null;
  metadata: string | null;
  created_at: string;
  verified_at: string | null;
  user_name?: string;
  user_username?: string;
}

export const paymentRepo = {
  create(data: {
    userId: string;
    telegramId: number;
    paymentMethod: 'UPI_AUTO' | 'BINANCE_PAY';
    amount: number;
    referenceId: string;
    qrPayload?: string;
    metadata?: Record<string, any>;
  }): Payment {
    const id = 'pay_' + crypto.randomBytes(8).toString('hex');
    db.prepare(`
      INSERT INTO payments (
        id, user_id, telegram_id, payment_method, amount, reference_id, 
        status, qr_payload, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).run(
      id,
      data.userId,
      data.telegramId,
      data.paymentMethod,
      data.amount,
      data.referenceId,
      data.qrPayload || null,
      data.metadata ? JSON.stringify(data.metadata) : null
    );

    return this.getById(id)!;
  },

  getById(id: string): Payment | null {
    return queryOne<Payment>(`
      SELECT p.*, u.first_name as user_name, u.username as user_username
      FROM payments p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, id);
  },

  getByReferenceId(refId: string): Payment | null {
    return queryOne<Payment>(`
      SELECT p.*, u.first_name as user_name, u.username as user_username
      FROM payments p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.reference_id = ?
    `, refId);
  },

  completePayment(paymentId: string, externalTxId?: string): { payment: Payment; alreadyProcessed: boolean } {
    return runTransaction(() => {
      const payment = this.getById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.status === 'COMPLETED') {
        return { payment, alreadyProcessed: true };
      }

      db.prepare(`
        UPDATE payments 
        SET status = 'COMPLETED', external_tx_id = ?, verified_at = datetime('now')
        WHERE id = ?
      `).run(externalTxId || payment.external_tx_id || 'AUTO_VERIFIED_' + Date.now(), paymentId);

      // Safely credit user wallet
      userRepo.adjustBalance(
        payment.user_id,
        payment.amount,
        'TOPUP',
        `Wallet top-up via ${payment.payment_method} (Ref: ${payment.reference_id})`,
        payment.reference_id
      );

      return { payment: this.getById(paymentId)!, alreadyProcessed: false };
    });
  },

  failPayment(paymentId: string, reason?: string) {
    db.prepare(`
      UPDATE payments 
      SET status = 'FAILED', metadata = json_set(COALESCE(metadata, '{}'), '$.fail_reason', ?)
      WHERE id = ?
    `).run(reason || 'Payment failed', paymentId);
  },

  updateMetadata(paymentId: string, metadata: Record<string, any>) {
    db.prepare(`
      UPDATE payments 
      SET metadata = ?
      WHERE id = ?
    `).run(JSON.stringify(metadata), paymentId);
  },

  list(filters: { userId?: string; telegramId?: number; paymentMethod?: string; status?: string; limit?: number; offset?: number }): { payments: Payment[]; total: number } {
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    let sql = `
      SELECT p.*, u.first_name as user_name, u.username as user_username
      FROM payments p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (filters.userId) {
      sql += ' AND p.user_id = ?';
      params.push(filters.userId);
    }
    if (filters.telegramId) {
      sql += ' AND p.telegram_id = ?';
      params.push(filters.telegramId);
    }
    if (filters.paymentMethod) {
      sql += ' AND p.payment_method = ?';
      params.push(filters.paymentMethod);
    }
    if (filters.status) {
      sql += ' AND p.status = ?';
      params.push(filters.status);
    }

    const countSql = sql.replace('SELECT p.*, u.first_name as user_name, u.username as user_username', 'SELECT COUNT(*) as count');
    const countRow = queryOne<{ count: number }>(countSql, ...params);

    sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = queryAll<Payment>(sql, ...params);
    return { payments: rows, total: Number(countRow?.count || 0) };
  }
};
