import { db, queryOne, queryAll } from '../db.js';

export const settingsRepo = {
  get(key: string, defaultValue = ''): string {
    const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    return row ? row.value : defaultValue;
  },

  getBoolean(key: string, defaultValue = false): boolean {
    const val = this.get(key, defaultValue ? 'true' : 'false');
    return val === 'true' || val === '1';
  },

  getNumber(key: string, defaultValue = 0): number {
    const val = this.get(key, String(defaultValue));
    const num = parseFloat(val);
    return isNaN(num) ? defaultValue : num;
  },

  getUsdRate(): number {
    return this.getNumber('usd_conversion_rate', 83.0);
  },

  calculateUsd(inrPrice: number): number {
    const rate = this.getUsdRate();
    if (rate <= 0) return 0;
    return parseFloat((inrPrice / rate).toFixed(2));
  },

  getAll(): Record<string, string> {
    const rows = queryAll<{ key: string; value: string }>('SELECT key, value FROM settings');
    const map: Record<string, string> = {};
    for (const r of rows) {
      map[r.key] = r.value;
    }
    return map;
  },

  set(key: string, value: string) {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
  },

  setMany(map: Record<string, string>) {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `);

    for (const [key, value] of Object.entries(map)) {
      stmt.run(key, value);
    }
  }
};
