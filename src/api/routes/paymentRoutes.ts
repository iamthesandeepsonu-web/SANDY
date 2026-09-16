import { Router } from 'express';
import { paymentRepo } from '../../database/repositories/paymentRepo.js';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const paymentRoutes = Router();

// Admin list payments
paymentRoutes.get('/', requireAdmin, (req, res) => {
  const { userId, telegramId, paymentMethod, status, limit, offset } = req.query;

  const result = paymentRepo.list({
    userId: userId ? String(userId) : undefined,
    telegramId: telegramId ? parseInt(String(telegramId), 10) : undefined,
    paymentMethod: paymentMethod ? String(paymentMethod) : undefined,
    status: status ? String(status) : undefined,
    limit: limit ? parseInt(String(limit), 10) : 50,
    offset: offset ? parseInt(String(offset), 10) : 0
  });

  return res.json({ success: true, ...result });
});

// Admin manual approval
paymentRoutes.post('/:id/approve', requireAdmin, (req, res) => {
  const id = String(req.params.id);

  try {
    const { payment, alreadyProcessed } = paymentRepo.completePayment(id, 'ADMIN_MANUAL_VERIFY');
    return res.json({
      success: true,
      message: alreadyProcessed ? 'Payment was already processed' : 'Payment approved and wallet credited successfully!',
      payment
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Webhook for UPI Auto
paymentRoutes.post('/webhook/upi', (req, res) => {
  const { reference_id, amount, status, secret } = req.body;
  const configuredSecret = settingsRepo.get('upi_webhook_secret', '');

  if (configuredSecret && secret !== configuredSecret) {
    return res.status(403).json({ success: false, message: 'Invalid webhook signature/secret' });
  }

  if (!reference_id) {
    return res.status(400).json({ success: false, message: 'Missing reference_id' });
  }

  const payment = paymentRepo.getByReferenceId(reference_id);
  if (!payment) {
    return res.status(404).json({ success: false, message: 'Payment record not found' });
  }

  if (status === 'SUCCESS' || status === 'COMPLETED') {
    const result = paymentRepo.completePayment(payment.id, req.body.tx_id || req.body.utr);
    return res.json({ success: true, message: 'Payment verified and credited', ...result });
  } else if (status === 'FAILED') {
    paymentRepo.failPayment(payment.id, req.body.reason || 'Payment failed from UPI gateway');
    return res.json({ success: true, message: 'Payment marked as failed' });
  }

  return res.json({ success: true, message: 'Ignored webhook status' });
});

// Webhook for Binance Pay
paymentRoutes.post('/webhook/binance', (req, res) => {
  const { merchantTradeNo, bizStatus } = req.body;

  if (!merchantTradeNo) {
    return res.status(400).json({ returnCode: 'FAIL', returnMessage: 'Missing merchantTradeNo' });
  }

  const payment = paymentRepo.getByReferenceId(merchantTradeNo);
  if (!payment) {
    return res.status(404).json({ returnCode: 'FAIL', returnMessage: 'Order not found' });
  }

  if (bizStatus === 'PAY_SUCCESS') {
    paymentRepo.completePayment(payment.id, req.body.transactionId || 'BINANCE_TX_' + Date.now());
    return res.json({ returnCode: 'SUCCESS', returnMessage: null });
  }

  return res.json({ returnCode: 'SUCCESS', returnMessage: null });
});
