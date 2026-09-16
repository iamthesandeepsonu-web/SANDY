import { Router } from 'express';
import { paymentRepo } from '../../database/repositories/paymentRepo.js';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { fulfillmentService } from '../../services/fulfillmentService.js';
import { activeBot } from '../../bot/bot.js';
import { keyboards } from '../../bot/keyboards.js';
import { escapeHtml } from '../../bot/handlers/shopHandler.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const paymentRoutes = Router();

async function processPaymentCompletionAndNotify(paymentId: string) {
  try {
    const payment = paymentRepo.getById(paymentId);
    if (!payment) return;

    let meta: any = {};
    if (payment.metadata) {
      try {
        meta = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
      } catch {}
    }

    if (meta && meta.serviceId && meta.validityId && !meta.orderId) {
      const result = await fulfillmentService.processPurchase(payment.user_id, meta.serviceId, meta.validityId);
      if (result.success && result.order) {
        const order = result.order;
        const licenseKey = result.licenseKey || order.license_key;
        paymentRepo.updateMetadata(payment.id, {
          ...meta,
          orderId: order.id,
          licenseKey
        });

        if (activeBot && payment.telegram_id) {
          try {
            const text = `
🎉 <b>Payment Confirmed & Order Fulfilled!</b>

📦 <b>Order ID:</b> <code>${order.id}</code>
🎮 <b>Product:</b> ${escapeHtml(order.service_name)}
⏳ <b>Validity:</b> ${escapeHtml(order.validity_name)}
💰 <b>Amount Paid:</b> ₹${order.price_paid.toFixed(2)}

🔑 <b>Your License Key:</b>
<code>${escapeHtml(licenseKey)}</code>

<i>💡 Tap on the license key above to copy it instantly. Save this message for your reference.</i>
`.trim();
            await activeBot.api.sendMessage(payment.telegram_id, text, {
              parse_mode: 'HTML',
              reply_markup: keyboards.mainMenu()
            });
          } catch (e) {
            console.error('Failed to send Telegram fulfillment message:', e);
          }
        }
      }
    } else if (activeBot && payment.telegram_id && (!meta || !meta.serviceId)) {
      try {
        await activeBot.api.sendMessage(
          payment.telegram_id,
          `🎉 <b>Payment Confirmed!</b>\n\n<b>₹${payment.amount.toFixed(2)}</b> has been credited to your wallet balance.\n\nUse <b>🛒 Shop Now</b> to purchase digital keys!`,
          {
            parse_mode: 'HTML',
            reply_markup: keyboards.mainMenu()
          }
        );
      } catch {}
    }
  } catch (err) {
    console.error('Error during payment fulfillment notification:', err);
  }
}

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
paymentRoutes.post('/:id/approve', requireAdmin, async (req, res) => {
  const id = String(req.params.id);

  try {
    const { payment, alreadyProcessed } = paymentRepo.completePayment(id, 'ADMIN_MANUAL_VERIFY');
    if (!alreadyProcessed) {
      await processPaymentCompletionAndNotify(payment.id);
    }
    return res.json({
      success: true,
      message: alreadyProcessed ? 'Payment was already processed' : 'Payment approved and fulfilled successfully!',
      payment
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Webhook for UPI Auto
paymentRoutes.post('/webhook/upi', async (req, res) => {
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
    if (!result.alreadyProcessed) {
      await processPaymentCompletionAndNotify(payment.id);
    }
    return res.json({ success: true, message: 'Payment verified and fulfilled', ...result });
  } else if (status === 'FAILED') {
    paymentRepo.failPayment(payment.id, req.body.reason || 'Payment failed from UPI gateway');
    return res.json({ success: true, message: 'Payment marked as failed' });
  }

  return res.json({ success: true, message: 'Ignored webhook status' });
});

// Webhook for Binance Pay
paymentRoutes.post('/webhook/binance', async (req, res) => {
  const { merchantTradeNo, bizStatus } = req.body;

  if (!merchantTradeNo) {
    return res.status(400).json({ returnCode: 'FAIL', returnMessage: 'Missing merchantTradeNo' });
  }

  const payment = paymentRepo.getByReferenceId(merchantTradeNo);
  if (!payment) {
    return res.status(404).json({ returnCode: 'FAIL', returnMessage: 'Order not found' });
  }

  if (bizStatus === 'PAY_SUCCESS') {
    const result = paymentRepo.completePayment(payment.id, req.body.transactionId || 'BINANCE_TX_' + Date.now());
    if (!result.alreadyProcessed) {
      await processPaymentCompletionAndNotify(payment.id);
    }
    return res.json({ returnCode: 'SUCCESS', returnMessage: null });
  }

  return res.json({ returnCode: 'SUCCESS', returnMessage: null });
});
