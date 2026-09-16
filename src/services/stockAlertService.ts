import { activeBot } from '../bot/bot.js';
import { config } from '../config/index.js';
import { queryOne, queryAll } from '../database/db.js';
import { settingsRepo } from '../database/repositories/settingsRepo.js';

interface StockCheckResult {
  serviceId: string;
  serviceName: string;
  validityId: string;
  validityName: string;
  availableStock: number;
  threshold: number;
  apiMapped: boolean;
  externalProductId?: string;
  needsAlert: boolean;
}

class StockAlertService {
  // Cooldown map: key = validity_id, value = timestamp of last alert sent
  private alertCooldowns: Map<string, number> = new Map();
  private readonly COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown per validity

  /**
   * Check stock for a specific validity and dispatch Telegram alert if below threshold
   */
  async checkAndNotifyLowStock(serviceId: string, validityId: string): Promise<StockCheckResult | null> {
    const isAlertsEnabled = settingsRepo.getBoolean('low_stock_alerts_enabled', true);
    if (!isAlertsEnabled) return null;

    const threshold = parseInt(settingsRepo.get('low_stock_threshold', '2'), 10) || 2;

    // 1. Get Service & Validity info
    const srv = queryOne<{ id: string; name: string }>('SELECT id, name FROM services WHERE id = ?', serviceId);
    const val = queryOne<{ id: string; name: string }>('SELECT id, name FROM validities WHERE id = ? AND service_id = ?', validityId, serviceId);

    if (!srv || !val) return null;

    // 2. Count unused local keys
    const stockRow = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count 
      FROM licenses 
      WHERE service_id = ? AND validity_id = ? AND is_used = 0
    `, serviceId, validityId);

    const availableStock = stockRow ? stockRow.count : 0;

    // 3. Check if external API mapping is active
    const mapRow = queryOne<{ external_product_id: string; is_enabled: number }>(`
      SELECT external_product_id, is_enabled 
      FROM api_mappings 
      WHERE service_id = ? AND validity_id = ? AND is_enabled = 1
    `, serviceId, validityId);

    const apiMapped = Boolean(mapRow && mapRow.is_enabled);
    const externalProductId = mapRow?.external_product_id;

    const result: StockCheckResult = {
      serviceId,
      serviceName: srv.name,
      validityId,
      validityName: val.name,
      availableStock,
      threshold,
      apiMapped,
      externalProductId,
      needsAlert: availableStock <= threshold
    };

    if (result.needsAlert) {
      const lastAlertTime = this.alertCooldowns.get(validityId) || 0;
      const now = Date.now();

      // Send alert if outside cooldown window or if stock hit exact 0
      if (now - lastAlertTime > this.COOLDOWN_MS || availableStock === 0) {
        this.alertCooldowns.set(validityId, now);
        await this.dispatchTelegramAlert(result);
      }
    }

    return result;
  }

  /**
   * Dispatch Telegram Low Stock Alert to Admin account(s)
   */
  private async dispatchTelegramAlert(info: StockCheckResult) {
    if (!activeBot || !activeBot.api) {
      console.log('ℹ️ [STOCK ALERT] Telegram bot not active, skipping stock alert.');
      return;
    }

    const adminIds = config.admin.telegramIds;
    if (!adminIds || adminIds.length === 0) {
      console.log('ℹ️ [STOCK ALERT] No ADMIN_TELEGRAM_IDS configured, skipping stock alert.');
      return;
    }

    const isZero = info.availableStock === 0;
    const alertHeader = isZero 
      ? '🚨 <b>CRITICAL: OUT OF STOCK ALERT</b>' 
      : '⚠️ <b>LOW STOCK INVENTORY ALERT</b>';

    const fallbackStatus = info.apiMapped
      ? `🟢 <b>API Auto-Fallback:</b> <code>${info.externalProductId}</code> (Active)`
      : `🔴 <b>API Auto-Fallback:</b> <code>None</code> (Orders will fail when stock hits 0!)`;

    const message = `
${alertHeader}

🎮 <b>Product:</b> <b>${info.serviceName}</b>
⏱️ <b>Validity:</b> <b>${info.validityName}</b>
🔑 <b>Remaining Local Keys:</b> <b>${info.availableStock} key${info.availableStock === 1 ? '' : 's'}</b> (Threshold: $\\le$ ${info.threshold})
${fallbackStatus}

<i>⚡ Action Recommended: Open Admin Panel ➔ License Stock to add new license keys.</i>
`.trim();

    for (const adminId of adminIds) {
      try {
        await activeBot.api.sendMessage(adminId, message, { parse_mode: 'HTML' });
        console.log(`⚠️ [STOCK ALERT] Sent low stock notification for ${info.serviceName} (${info.validityName}) to Admin ID: ${adminId}`);
      } catch (err: any) {
        console.error(`❌ [STOCK ALERT] Failed to send alert to Admin ID ${adminId}:`, err.message);
      }
    }
  }

  /**
   * Audit all active services and validities for low stock
   */
  async auditAllProducts(): Promise<StockCheckResult[]> {
    const validities = queryAll<{ service_id: string; id: string }>(`
      SELECT v.service_id, v.id 
      FROM validities v
      JOIN services s ON s.id = v.service_id
      WHERE v.is_active = 1 AND s.is_active = 1
    `);

    const results: StockCheckResult[] = [];
    for (const item of validities) {
      const res = await this.checkAndNotifyLowStock(item.service_id, item.id);
      if (res) results.push(res);
    }
    return results;
  }
}

export const stockAlertService = new StockAlertService();
