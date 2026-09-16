import { Router } from 'express';
import { orderRepo } from '../../database/repositories/orderRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const orderRoutes = Router();

orderRoutes.get('/', requireAdmin, (req, res) => {
  const { userId, telegramId, serviceId, fulfillmentType, limit, offset, search } = req.query;

  const result = orderRepo.list({
    userId: userId ? String(userId) : undefined,
    telegramId: telegramId ? parseInt(String(telegramId), 10) : undefined,
    serviceId: serviceId ? String(serviceId) : undefined,
    fulfillmentType: fulfillmentType ? String(fulfillmentType) : undefined,
    limit: limit ? parseInt(String(limit), 10) : 50,
    offset: offset ? parseInt(String(offset), 10) : 0,
    search: search ? String(search) : undefined
  });

  return res.json({ success: true, ...result });
});

orderRoutes.get('/:id', requireAdmin, (req, res) => {
  const order = orderRepo.getById(String(req.params.id));
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }
  return res.json({ success: true, order });
});
