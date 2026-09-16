import { Router } from 'express';
import { requireAdmin } from '../middlewares/authMiddleware.js';
import { broadcastService } from '../../services/broadcastService.js';
import { stockAlertService } from '../../services/stockAlertService.js';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';

export const broadcastRoutes = Router();

// 1. Send Mass Broadcast to All Users
broadcastRoutes.post('/send', requireAdmin, async (req, res) => {
  try {
    const { message, photoUrl, buttonText, buttonUrl } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Broadcast message text is required.' });
    }

    const adminUser = (req as any).adminUser?.username || 'Admin';

    const result = await broadcastService.sendBroadcast({
      message: message.trim(),
      photoUrl: photoUrl?.trim() || undefined,
      buttonText: buttonText?.trim() || undefined,
      buttonUrl: buttonUrl?.trim() || undefined,
      adminUsername: adminUser
    });

    return res.json({
      success: true,
      message: `🎉 Broadcast sent to ${result.sentCount} of ${result.totalTargets} users (${result.durationSeconds}s)!`,
      result
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Broadcast failed: ' + err.message });
  }
});

// 2. Send Test Broadcast Preview to Admin Telegram
broadcastRoutes.post('/test', requireAdmin, async (req, res) => {
  try {
    const { message, photoUrl, buttonText, buttonUrl, telegramId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message text is required for preview.' });
    }

    const result = await broadcastService.sendTestPreview({
      message: message.trim(),
      photoUrl: photoUrl?.trim() || undefined,
      buttonText: buttonText?.trim() || undefined,
      buttonUrl: buttonUrl?.trim() || undefined
    }, telegramId ? parseInt(telegramId, 10) : undefined);

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Get Broadcast Campaign History
broadcastRoutes.get('/history', requireAdmin, (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const history = broadcastService.getHistory(limit);
    return res.json({ success: true, history });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Low Stock Inventory Audit
broadcastRoutes.get('/stock-alerts/audit', requireAdmin, async (req, res) => {
  try {
    const results = await stockAlertService.auditAllProducts();
    const threshold = settingsRepo.get('low_stock_threshold', '2');
    const enabled = settingsRepo.getBoolean('low_stock_alerts_enabled', true);
    return res.json({
      success: true,
      threshold: parseInt(threshold, 10),
      enabled,
      items: results
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Update Low Stock Threshold & Enabled Status
broadcastRoutes.post('/stock-alerts/settings', requireAdmin, (req, res) => {
  try {
    const { threshold, enabled } = req.body;

    if (threshold !== undefined) {
      const t = parseInt(threshold, 10);
      if (!isNaN(t) && t >= 0) {
        settingsRepo.set('low_stock_threshold', String(t));
      }
    }

    if (enabled !== undefined) {
      settingsRepo.set('low_stock_alerts_enabled', enabled ? 'true' : 'false');
    }

    return res.json({
      success: true,
      message: 'Low stock alert settings updated successfully!',
      settings: {
        threshold: parseInt(settingsRepo.get('low_stock_threshold', '2'), 10),
        enabled: settingsRepo.getBoolean('low_stock_alerts_enabled', true)
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});
