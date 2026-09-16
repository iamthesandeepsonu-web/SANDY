import { db, queryOne, queryAll } from '../db.js';
import crypto from 'crypto';

export interface Validity {
  id: string;
  service_id: string;
  name: string;
  price: number;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ValidityWithStock extends Validity {
  service_name?: string;
  available_stock: number;
  used_stock: number;
  total_stock: number;
  api_mapping_id?: string | null;
  external_product_id?: string | null;
  external_product_name?: string | null;
  is_api_mapped: boolean;
}

export const validityRepo = {
  getByServiceId(serviceId: string, onlyActive = false): Validity[] {
    if (onlyActive) {
      return queryAll<Validity>('SELECT * FROM validities WHERE service_id = ? AND is_active = 1 ORDER BY sort_order ASC, price ASC', serviceId);
    }
    return queryAll<Validity>('SELECT * FROM validities WHERE service_id = ? ORDER BY sort_order ASC, price ASC', serviceId);
  },

  getByServiceIdWithStock(serviceId: string, onlyActive = false): ValidityWithStock[] {
    const list = this.getByServiceId(serviceId, onlyActive);
    return list.map(val => this.enrichWithStock(val));
  },

  getAllWithStock(): ValidityWithStock[] {
    const list = queryAll<Validity & { service_name: string }>(`
      SELECT v.*, s.name as service_name 
      FROM validities v 
      JOIN services s ON v.service_id = s.id 
      ORDER BY s.sort_order ASC, v.sort_order ASC, v.price ASC
    `);

    return list.map(val => this.enrichWithStock(val));
  },

  getById(id: string): Validity | null {
    return queryOne<Validity>('SELECT * FROM validities WHERE id = ?', id);
  },

  getByIdWithStock(id: string): ValidityWithStock | null {
    const row = this.getById(id);
    if (!row) return null;
    return this.enrichWithStock(row);
  },

  enrichWithStock(val: Validity & { service_name?: string }): ValidityWithStock {
    const stockRow = queryOne<{ total: number; available: number | null; used: number | null }>(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_used = 0 THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN is_used = 1 THEN 1 ELSE 0 END) as used
      FROM licenses 
      WHERE service_id = ? AND validity_id = ?
    `, val.service_id, val.id);

    const mapping = queryOne<{ id: string; external_product_id: string; external_product_name: string }>(`
      SELECT * FROM api_mappings 
      WHERE service_id = ? AND validity_id = ? AND is_enabled = 1
    `, val.service_id, val.id);

    return {
      ...val,
      total_stock: Number(stockRow?.total || 0),
      available_stock: Number(stockRow?.available || 0),
      used_stock: Number(stockRow?.used || 0),
      api_mapping_id: mapping ? mapping.id : null,
      external_product_id: mapping ? mapping.external_product_id : null,
      external_product_name: mapping ? mapping.external_product_name : null,
      is_api_mapped: Boolean(mapping)
    };
  },

  create(serviceId: string, name: string, price: number, customId?: string, isActive = 1, sortOrder = 0): Validity {
    const id = customId ? customId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') : 'val_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO validities (id, service_id, name, price, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, serviceId, name.trim(), price, isActive ? 1 : 0, sortOrder);

    return this.getById(id)!;
  },

  update(id: string, updates: { name?: string; price?: number; is_active?: number; sort_order?: number }): Validity {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error('Validity not found');
    }

    const name = updates.name !== undefined ? updates.name.trim() : existing.name;
    const price = updates.price !== undefined ? updates.price : existing.price;
    const is_active = updates.is_active !== undefined ? updates.is_active : existing.is_active;
    const sort_order = updates.sort_order !== undefined ? updates.sort_order : existing.sort_order;

    db.prepare(`
      UPDATE validities 
      SET name = ?, price = ?, is_active = ?, sort_order = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, price, is_active, sort_order, id);

    return this.getById(id)!;
  },

  delete(id: string): boolean {
    db.prepare('DELETE FROM validities WHERE id = ?').run(id);
    return true;
  }
};
