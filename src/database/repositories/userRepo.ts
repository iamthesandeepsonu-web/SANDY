import { db, runTransaction, queryOne, queryAll } from '../db.js';
import crypto from 'crypto';

export interface User {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  account_type: string;
  balance: number;
  total_spent: number;
  total_orders: number;
  is_banned: number;
  created_at: string;
  updated_at: string;
}

export const userRepo = {
  getByTelegramId(telegramId: number): User | null {
    return queryOne<User>('SELECT * FROM users WHERE telegram_id = ?', telegramId);
  },

  getById(id: string): User | null {
    return queryOne<User>('SELECT * FROM users WHERE id = ?', id);
  },

  upsertFromTelegram(telegramId: number, username?: string, firstName?: string): User {
    const existing = this.getByTelegramId(telegramId);
    if (existing) {
      db.prepare(`
        UPDATE users 
        SET username = ?, first_name = ?, updated_at = datetime('now')
        WHERE telegram_id = ?
      `).run(username || existing.username, firstName || existing.first_name, telegramId);
      return this.getByTelegramId(telegramId)!;
    }

    const id = 'usr_' + crypto.randomBytes(8).toString('hex');
    db.prepare(`
      INSERT INTO users (id, telegram_id, username, first_name, account_type, balance, total_spent, total_orders, is_banned)
      VALUES (?, ?, ?, ?, 'Regular', 0.0, 0.0, 0, 0)
    `).run(id, telegramId, username || null, firstName || null);

    return this.getById(id)!;
  },

  list(limit = 100, offset = 0, search = ''): { users: User[]; total: number } {
    if (search.trim()) {
      const q = `%${search.trim()}%`;
      const rows = queryAll<User>(`
        SELECT * FROM users 
        WHERE username LIKE ? OR first_name LIKE ? OR CAST(telegram_id AS TEXT) LIKE ? OR id LIKE ?
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `, q, q, q, q, limit, offset);

      const countRow = queryOne<{ count: number }>(`
        SELECT COUNT(*) as count FROM users 
        WHERE username LIKE ? OR first_name LIKE ? OR CAST(telegram_id AS TEXT) LIKE ? OR id LIKE ?
      `, q, q, q, q);

      return { users: rows, total: Number(countRow?.count || 0) };
    }

    const rows = queryAll<User>(`
      SELECT * FROM users 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `, limit, offset);

    const countRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    return { users: rows, total: Number(countRow?.count || 0) };
  },

  adjustBalance(userId: string, deltaAmount: number, type: 'TOPUP' | 'PURCHASE' | 'REFUND' | 'ADMIN_ADJUST', description: string, referenceId?: string): User {
    return runTransaction(() => {
      const user = queryOne<User>('SELECT * FROM users WHERE id = ?', userId);
      if (!user) {
        throw new Error('User not found');
      }

      const balanceBefore = user.balance;
      const balanceAfter = Math.max(0, balanceBefore + deltaAmount);

      if (deltaAmount < 0 && balanceBefore + deltaAmount < 0) {
        throw new Error('Insufficient balance');
      }

      db.prepare(`
        UPDATE users 
        SET balance = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(balanceAfter, userId);

      const txId = 'wtx_' + crypto.randomBytes(8).toString('hex');
      db.prepare(`
        INSERT INTO wallet_transactions (id, user_id, amount, type, balance_before, balance_after, reference_id, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(txId, userId, deltaAmount, type, balanceBefore, balanceAfter, referenceId || null, description);

      return { ...user, balance: balanceAfter };
    });
  },

  setBanStatus(userId: string, isBanned: boolean) {
    db.prepare("UPDATE users SET is_banned = ?, updated_at = datetime('now') WHERE id = ?")
      .run(isBanned ? 1 : 0, userId);
  },

  getWalletTransactions(userId: string) {
    return queryAll('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC', userId);
  }
};
