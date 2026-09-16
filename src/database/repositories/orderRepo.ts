import { db, runTransaction, queryOne, queryAll } from '../db.js';

export interface Order {
  id: string;
  user_id: string;
  telegram_id: number;
  service_id: string;
  service_name: string;
  validity_id: string;
  validity_name: string;
  price_paid: number;
  license_key: string;
  fulfillment_type: 'LOCAL' | 'API';
  api_tx_id: string | null;
  status: 'COMPLETED' | 'FAILED' | 'REFUNDED';
  created_at: string;
  user_name?: string;
  user_username?: string;
}

export const orderRepo = {
  create(orderData: Omit<Order, 'created_at'>): Order {
    return runTransaction(() => {
      db.prepare(`
        INSERT INTO orders (
          id, user_id, telegram_id, service_id, service_name, validity_id, 
          validity_name, price_paid, license_key, fulfillment_type, api_tx_id, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderData.id,
        orderData.user_id,
        orderData.telegram_id,
        orderData.service_id,
        orderData.service_name,
        orderData.validity_id,
        orderData.validity_name,
        orderData.price_paid,
        orderData.license_key,
        orderData.fulfillment_type,
        orderData.api_tx_id || null,
        orderData.status || 'COMPLETED'
      );

      // Increment user total_orders and total_spent
      db.prepare(`
        UPDATE users 
        SET total_orders = total_orders + 1, 
            total_spent = total_spent + ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(orderData.price_paid, orderData.user_id);

      return this.getById(orderData.id)!;
    });
  },

  getById(id: string): Order | null {
    return queryOne<Order>(`
      SELECT o.*, u.first_name as user_name, u.username as user_username
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ?
    `, id);
  },

  getByTelegramId(telegramId: number, limit = 20, offset = 0): { orders: Order[]; total: number } {
    const rows = queryAll<Order>(`
      SELECT * FROM orders 
      WHERE telegram_id = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `, telegramId, limit, offset);

    const countRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM orders WHERE telegram_id = ?', telegramId);
    return { orders: rows, total: Number(countRow?.count || 0) };
  },

  list(filters: { userId?: string; telegramId?: number; serviceId?: string; fulfillmentType?: string; limit?: number; offset?: number; search?: string }): { orders: Order[]; total: number } {
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    let sql = `
      SELECT o.*, u.first_name as user_name, u.username as user_username
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (filters.userId) {
      sql += ' AND o.user_id = ?';
      params.push(filters.userId);
    }
    if (filters.telegramId) {
      sql += ' AND o.telegram_id = ?';
      params.push(filters.telegramId);
    }
    if (filters.serviceId) {
      sql += ' AND o.service_id = ?';
      params.push(filters.serviceId);
    }
    if (filters.fulfillmentType) {
      sql += ' AND o.fulfillment_type = ?';
      params.push(filters.fulfillmentType);
    }
    if (filters.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      sql += ' AND (o.id LIKE ? OR o.license_key LIKE ? OR o.service_name LIKE ? OR u.username LIKE ?)';
      params.push(q, q, q, q);
    }

    const countSql = sql.replace('SELECT o.*, u.first_name as user_name, u.username as user_username', 'SELECT COUNT(*) as count');
    const countRow = queryOne<{ count: number }>(countSql, ...params);

    sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = queryAll<Order>(sql, ...params);
    return { orders: rows, total: Number(countRow?.count || 0) };
  }
};
