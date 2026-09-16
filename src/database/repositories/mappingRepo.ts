import { db, queryOne, queryAll } from '../db.js';
import crypto from 'crypto';

export interface ApiMapping {
  id: string;
  service_id: string;
  validity_id: string;
  external_product_id: string;
  external_product_name: string | null;
  is_enabled: number;
  created_at: string;
  updated_at: string;
  service_name?: string;
  validity_name?: string;
}

export const mappingRepo = {
  getAll(): ApiMapping[] {
    return queryAll<ApiMapping>(`
      SELECT m.*, s.name as service_name, v.name as validity_name 
      FROM api_mappings m
      JOIN services s ON m.service_id = s.id
      JOIN validities v ON m.validity_id = v.id
      ORDER BY s.sort_order ASC, v.sort_order ASC
    `);
  },

  getByServiceAndValidity(serviceId: string, validityId: string): ApiMapping | null {
    return queryOne<ApiMapping>(`
      SELECT * FROM api_mappings 
      WHERE service_id = ? AND validity_id = ? AND is_enabled = 1
    `, serviceId, validityId);
  },

  getById(id: string): ApiMapping | null {
    return queryOne<ApiMapping>('SELECT * FROM api_mappings WHERE id = ?', id);
  },

  upsert(serviceId: string, validityId: string, externalProductId: string, externalProductName?: string, isEnabled = 1): ApiMapping {
    const existing = queryOne<ApiMapping>(`
      SELECT * FROM api_mappings 
      WHERE service_id = ? AND validity_id = ?
    `, serviceId, validityId);

    if (existing) {
      db.prepare(`
        UPDATE api_mappings 
        SET external_product_id = ?, external_product_name = ?, is_enabled = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(externalProductId.trim(), externalProductName ? externalProductName.trim() : null, isEnabled ? 1 : 0, existing.id);
      return this.getById(existing.id)!;
    }

    const id = 'map_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO api_mappings (id, service_id, validity_id, external_product_id, external_product_name, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, serviceId, validityId, externalProductId.trim(), externalProductName ? externalProductName.trim() : null, isEnabled ? 1 : 0);

    return this.getById(id)!;
  },

  delete(id: string): boolean {
    db.prepare('DELETE FROM api_mappings WHERE id = ?').run(id);
    return true;
  },

  deleteByServiceAndValidity(serviceId: string, validityId: string): boolean {
    db.prepare('DELETE FROM api_mappings WHERE service_id = ? AND validity_id = ?').run(serviceId, validityId);
    return true;
  }
};
