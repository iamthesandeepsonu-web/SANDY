import { db, queryOne, queryAll, runTransaction } from '../db.js';
import crypto from 'crypto';

export interface CryptoDeposit {
  id: string;
  order_id: string;
  amount_usd: number;
  currency: string;
  sender_info: string | null;
  source: string;
  is_claimed: number;
  claimed_by_payment_id: string | null;
  received_at: string;
}

export const cryptoDepositRepo = {
  recordDeposit(data: {
    orderId: string;
    amountUsd: number;
    currency?: string;
    senderInfo?: string;
    source?: string;
  }): CryptoDeposit {
    const cleanOrderId = data.orderId.trim();
    const existing = this.getByOrderId(cleanOrderId);
    if (existing) {
      return existing;
    }

    const id = 'dep_' + crypto.randomBytes(8).toString('hex');
    db.prepare(`
      INSERT INTO verified_crypto_deposits (
        id, order_id, amount_usd, currency, sender_info, source, is_claimed, claimed_by_payment_id
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
    `).run(
      id,
      cleanOrderId,
      data.amountUsd,
      data.currency || 'USDT',
      data.senderInfo || null,
      data.source || 'EMAIL'
    );

    return this.getByOrderId(cleanOrderId)!;
  },

  getByOrderId(orderId: string): CryptoDeposit | null {
    if (!orderId) return null;
    return queryOne<CryptoDeposit>(`
      SELECT * FROM verified_crypto_deposits WHERE order_id = ?
    `, orderId.trim());
  },

  claimDeposit(orderId: string, paymentId: string): boolean {
    const res = db.prepare(`
      UPDATE verified_crypto_deposits 
      SET is_claimed = 1, claimed_by_payment_id = ?
      WHERE order_id = ? AND is_claimed = 0
    `).run(paymentId, orderId.trim());

    return res.changes > 0;
  },

  listRecent(limit: number = 20): CryptoDeposit[] {
    return queryAll<CryptoDeposit>(`
      SELECT * FROM verified_crypto_deposits ORDER BY received_at DESC LIMIT ?
    `, limit);
  }
};
