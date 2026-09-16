import { Router } from 'express';
import { userRepo } from '../../database/repositories/userRepo.js';
import { orderRepo } from '../../database/repositories/orderRepo.js';
import { paymentRepo } from '../../database/repositories/paymentRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const userRoutes = Router();

userRoutes.get('/', requireAdmin, (req, res) => {
  const { limit, offset, search } = req.query;

  const result = userRepo.list(
    limit ? parseInt(String(limit), 10) : 50,
    offset ? parseInt(String(offset), 10) : 0,
    search ? String(search) : ''
  );

  return res.json({ success: true, ...result });
});

userRoutes.get('/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  const user = userRepo.getById(id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const { orders } = orderRepo.getByTelegramId(user.telegram_id, 20, 0);
  const { payments } = paymentRepo.list({ userId: user.id, limit: 20 });
  const walletTransactions = userRepo.getWalletTransactions(user.id);

  return res.json({
    success: true,
    user,
    orders,
    payments,
    walletTransactions
  });
});

userRoutes.post('/:id/balance', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  const { amount, description } = req.body;

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount === 0) {
    return res.status(400).json({ success: false, message: 'Valid positive or negative amount required' });
  }

  try {
    const updatedUser = userRepo.adjustBalance(
      id,
      numAmount,
      'ADMIN_ADJUST',
      description || `Admin manual adjustment (${numAmount > 0 ? '+' : ''}${numAmount})`
    );

    return res.json({
      success: true,
      message: `Balance adjusted by ${numAmount > 0 ? '+' : ''}${numAmount}. New balance: ₹${updatedUser.balance.toFixed(2)}`,
      user: updatedUser
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

userRoutes.post('/:id/ban', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  const { isBanned } = req.body;

  try {
    userRepo.setBanStatus(id, Boolean(isBanned));
    return res.json({
      success: true,
      message: `User has been ${isBanned ? 'banned' : 'unbanned'} successfully`
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});
