import { db, queryOne, queryAll } from '../db.js';

export interface Service {
  id: string;
  name: string;
  description: string | null;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ServiceWithStats extends Service {
  validities_count: number;
  total_licenses: number;
  available_licenses: number;
}

export const serviceRepo = {
  getAll(onlyActive = false): Service[] {
    if (onlyActive) {
      return queryAll<Service>('SELECT * FROM services WHERE is_active = 1 ORDER BY sort_order ASC, name ASC');
    }
    return queryAll<Service>('SELECT * FROM services ORDER BY sort_order ASC, name ASC');
  },

  getAllWithStats(): ServiceWithStats[] {
    const services = queryAll<Service>('SELECT * FROM services ORDER BY sort_order ASC, name ASC');
    return services.map(srv => {
      const valRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM validities WHERE service_id = ?', srv.id);
      const licRow = queryOne<{ total: number; available: number | null }>('SELECT COUNT(*) as total, SUM(CASE WHEN is_used = 0 THEN 1 ELSE 0 END) as available FROM licenses WHERE service_id = ?', srv.id);
      return {
        ...srv,
        validities_count: Number(valRow?.count || 0),
        total_licenses: Number(licRow?.total || 0),
        available_licenses: Number(licRow?.available || 0)
      };
    });
  },

  getById(id: string): Service | null {
    return queryOne<Service>('SELECT * FROM services WHERE id = ?', id);
  },

  create(id: string, name: string, description: string | null = null, isActive = 1, sortOrder = 0): Service {
    const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    db.prepare(`
      INSERT INTO services (id, name, description, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(cleanId, name.trim(), description ? description.trim() : null, isActive ? 1 : 0, sortOrder);

    return this.getById(cleanId)!;
  },

  update(id: string, updates: { name?: string; description?: string | null; is_active?: number; sort_order?: number }): Service {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error('Service not found');
    }

    const name = updates.name !== undefined ? updates.name.trim() : existing.name;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const is_active = updates.is_active !== undefined ? updates.is_active : existing.is_active;
    const sort_order = updates.sort_order !== undefined ? updates.sort_order : existing.sort_order;

    db.prepare(`
      UPDATE services 
      SET name = ?, description = ?, is_active = ?, sort_order = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, description, is_active, sort_order, id);

    return this.getById(id)!;
  },

  delete(id: string): boolean {
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    return true;
  }
};
