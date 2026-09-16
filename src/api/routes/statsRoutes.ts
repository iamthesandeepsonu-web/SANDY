import { Router } from 'express';
import { db, queryOne, queryAll } from '../../database/db.js';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const statsRoutes = Router();

statsRoutes.get('/overview', requireAdmin, (req, res) => {
  const userCountRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
  const userCount = Number(userCountRow?.count || 0);

  const orderCountRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM orders');
  const orderCount = Number(orderCountRow?.count || 0);

  const revenueRow = queryOne<{ total: number | null }>('SELECT SUM(price_paid) as total FROM orders WHERE status = ?', 'COMPLETED');
  const revenue = Number(revenueRow?.total || 0);

  const stockRow = queryOne<{
    total_licenses: number;
    available_licenses: number | null;
    used_licenses: number | null;
  }>(`
    SELECT 
      COUNT(*) as total_licenses,
      SUM(CASE WHEN is_used = 0 THEN 1 ELSE 0 END) as available_licenses,
      SUM(CASE WHEN is_used = 1 THEN 1 ELSE 0 END) as used_licenses
    FROM licenses
  `);

  const pendingPaymentsRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM payments WHERE status = ?', 'PENDING');
  const pendingPaymentsCount = Number(pendingPaymentsRow?.count || 0);

  const activeMappingsRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM api_mappings WHERE is_enabled = 1');
  const activeMappingsCount = Number(activeMappingsRow?.count || 0);

  const recentOrders = queryAll(`
    SELECT o.*, u.username as user_username
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC 
    LIMIT 6
  `);

  const recentPayments = queryAll(`
    SELECT p.*, u.username as user_username
    FROM payments p
    LEFT JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC 
    LIMIT 6
  `);

  return res.json({
    success: true,
    stats: {
      totalUsers: userCount,
      totalOrders: orderCount,
      totalRevenue: revenue,
      availableStock: Number(stockRow?.available_licenses || 0),
      usedStock: Number(stockRow?.used_licenses || 0),
      totalStock: Number(stockRow?.total_licenses || 0),
      pendingPayments: pendingPaymentsCount,
      activeMappings: activeMappingsCount,
      maintenanceEnabled: settingsRepo.getBoolean('maintenance_enabled', false)
    },
    recentOrders,
    recentPayments
  });
});
