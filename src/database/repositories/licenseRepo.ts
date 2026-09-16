import { db, runTransaction, queryOne, queryAll } from '../db.js';

export interface License {
  id: number;
  service_id: string;
  validity_id: string;
  license_key: string;
  is_used: number;
  used_by_user_id: string | null;
  used_by_order_id: string | null;
  used_at: string | null;
  added_at: string;
}

export interface LicenseWithDetails extends License {
  service_name?: string;
  validity_name?: string;
}

export const licenseRepo = {
  addBulk(serviceId: string, validityId: string, rawKeysText: string): { added: number; duplicates: number; empty: number } {
    const lines = rawKeysText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      return { added: 0, duplicates: 0, empty: 0 };
    }

    const insertStmt = db.prepare(`
      INSERT INTO licenses (service_id, validity_id, license_key, is_used)
      VALUES (?, ?, ?, 0)
    `);

    let added = 0;
    runTransaction(() => {
      for (const key of lines) {
        insertStmt.run(serviceId, validityId, key);
        added++;
      }
    });

    return { added, duplicates: 0, empty: 0 };
  },

  getAvailableCount(serviceId: string, validityId: string): number {
    const row = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count 
      FROM licenses 
      WHERE service_id = ? AND validity_id = ? AND is_used = 0
    `, serviceId, validityId);
    return Number(row?.count || 0);
  },

  claimOneLocalLicense(serviceId: string, validityId: string, userId: string, orderId: string): License | null {
    // Atomic lock and claim of 1 unused key strictly matching service_id AND validity_id
    return runTransaction(() => {
      const candidate = queryOne<License>(`
        SELECT * FROM licenses 
        WHERE service_id = ? AND validity_id = ? AND is_used = 0 
        LIMIT 1
      `, serviceId, validityId);

      if (!candidate) {
        return null;
      }

      db.prepare(`
        UPDATE licenses 
        SET is_used = 1, used_by_user_id = ?, used_by_order_id = ?, used_at = datetime('now')
        WHERE id = ?
      `).run(userId, orderId, candidate.id);

      return {
        ...candidate,
        is_used: 1,
        used_by_user_id: userId,
        used_by_order_id: orderId,
        used_at: new Date().toISOString()
      };
    });
  },

  list(filters: { serviceId?: string; validityId?: string; isUsed?: number; limit?: number; offset?: number; search?: string }): { licenses: LicenseWithDetails[]; total: number } {
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    let sql = `
      SELECT l.*, s.name as service_name, v.name as validity_name 
      FROM licenses l
      JOIN services s ON l.service_id = s.id
      JOIN validities v ON l.validity_id = v.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (filters.serviceId) {
      sql += ' AND l.service_id = ?';
      params.push(filters.serviceId);
    }
    if (filters.validityId) {
      sql += ' AND l.validity_id = ?';
      params.push(filters.validityId);
    }
    if (filters.isUsed !== undefined) {
      sql += ' AND l.is_used = ?';
      params.push(filters.isUsed);
    }
    if (filters.search && filters.search.trim()) {
      sql += ' AND l.license_key LIKE ?';
      params.push(`%${filters.search.trim()}%`);
    }

    const countSql = sql.replace('SELECT l.*, s.name as service_name, v.name as validity_name', 'SELECT COUNT(*) as count');
    const countRow = queryOne<{ count: number }>(countSql, ...params);

    sql += ' ORDER BY l.id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = queryAll<LicenseWithDetails>(sql, ...params);
    return { licenses: rows, total: Number(countRow?.count || 0) };
  },

  delete(id: number): boolean {
    db.prepare('DELETE FROM licenses WHERE id = ?').run(id);
    return true;
  }
};
