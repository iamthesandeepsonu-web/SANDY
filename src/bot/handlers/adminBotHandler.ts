import { Context, InlineKeyboard } from 'grammy';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { paymentRepo } from '../../database/repositories/paymentRepo.js';
import { fulfillmentService } from '../../services/fulfillmentService.js';
import { userRepo } from '../../database/repositories/userRepo.js';
import { queryOne } from '../../database/db.js';
import { config } from '../../config/index.js';
import { activeBot } from '../bot.js';
import { keyboards } from '../keyboards.js';
import { escapeHtml } from './shopHandler.js';

export function isUserAdmin(telegramId?: number): boolean {
  if (!telegramId) return false;
  return config.admin.telegramIds.includes(telegramId);
}

export async function handleAdminCommand(ctx: Context) {
  const from = ctx.from;
  if (!from || !isUserAdmin(from.id)) {
    return; // Ignore non-admin users
  }

  const isMaintenance = settingsRepo.getBoolean('maintenance_enabled', false);
  const userCountRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
  const userCount = Number(userCountRow?.count || 0);

  const orderCountRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM orders');
  const orderCount = Number(orderCountRow?.count || 0);

  const revenueRow = queryOne<{ total: number | null }>('SELECT SUM(price_paid) as total FROM orders WHERE status = ?', 'COMPLETED');
  const revenue = Number(revenueRow?.total || 0);

  const text = `
🛠️ <b>Admin Control Panel</b>

📊 <b>Quick Stats:</b>
👥 <b>Total Users:</b> ${userCount}
📦 <b>Total Orders:</b> ${orderCount}
💰 <b>Total Revenue:</b> ₹${revenue.toFixed(2)}
⚠️ <b>Maintenance Mode:</b> ${isMaintenance ? '🔴 <b>ACTIVE (Users Blocked)</b>' : '🟢 <b>OFF (Normal Operations)</b>'}

🌐 <b>Web Admin Dashboard:</b> http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/
`.trim();

  const kb = new InlineKeyboard()
    .text(
      isMaintenance ? '🟢 Disable Maintenance' : '🔴 Enable Maintenance',
      'admin_toggle_maint'
    )
    .row()
    .text('🔄 Refresh Stats', 'admin_refresh')
    .row()
    .text('← Back to Main Menu', 'menu_main');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

export async function handleAdminToggleMaintenance(ctx: Context) {
  const from = ctx.from;
  if (!from || !isUserAdmin(from.id)) return;

  const current = settingsRepo.getBoolean('maintenance_enabled', false);
  const next = !current;
  settingsRepo.set('maintenance_enabled', next ? 'true' : 'false');

  await ctx.answerCallbackQuery({
    text: `Maintenance Mode is now ${next ? 'ENABLED' : 'DISABLED'}`,
    show_alert: true
  });

  return handleAdminCommand(ctx);
}

export async function handleAdminApprovePayment(ctx: Context, paymentId: string) {
  const from = ctx.from;
  if (!from || !isUserAdmin(from.id)) {
    return ctx.answerCallbackQuery({ text: 'Unauthorized', show_alert: true });
  }

  const payment = paymentRepo.getById(paymentId);
  if (!payment) {
    return ctx.answerCallbackQuery({ text: 'Payment not found', show_alert: true });
  }

  if (payment.status === 'COMPLETED') {
    return ctx.answerCallbackQuery({ text: 'Payment already approved', show_alert: true });
  }

  let meta: any = {};
  if (payment.metadata) {
    try {
      meta = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
    } catch {}
  }

  const completeRes = paymentRepo.completePayment(payment.id, meta.binanceTxnId || payment.external_tx_id || 'ADMIN_APPROVED_' + Date.now());
  const updatedPayment = completeRes.payment;
  const targetUserId = payment.user_id;

  let deliveredKey = '';
  let orderInfo: any = null;

  if (meta && meta.serviceId && meta.validityId) {
    const fulfillRes = await fulfillmentService.processPurchase(targetUserId, meta.serviceId, meta.validityId);
    if (fulfillRes.success && fulfillRes.order) {
      orderInfo = fulfillRes.order;
      deliveredKey = fulfillRes.licenseKey || fulfillRes.order.license_key;
      meta.orderId = orderInfo.id;
      meta.licenseKey = deliveredKey;
      paymentRepo.updateMetadata(payment.id, meta);

      // Notify customer in Telegram
      if (activeBot && payment.telegram_id) {
        try {
          const custText = `
🎉 <b>Payment Verified & Key Delivered!</b>

📦 <b>Order ID:</b> <code>${orderInfo.id}</code>
🎮 <b>Product:</b> ${escapeHtml(orderInfo.service_name)}
⏳ <b>Validity:</b> ${escapeHtml(orderInfo.validity_name)}
🔢 <b>Binance Txn ID:</b> <code>${escapeHtml(meta.binanceTxnId || payment.reference_id)}</code>

🔑 <b>Your License Key:</b>
<code>${escapeHtml(deliveredKey)}</code>

<i>💡 Tap on the license key above to copy it instantly. Save this message for your reference.</i>
`.trim();
          await activeBot.api.sendMessage(payment.telegram_id, custText, {
            parse_mode: 'HTML',
            reply_markup: keyboards.mainMenu()
          });
        } catch {}
      }
    }
  } else {
    // Wallet topup
    if (activeBot && payment.telegram_id) {
      const user = userRepo.getById(targetUserId);
      try {
        await activeBot.api.sendMessage(
          payment.telegram_id,
          `🎉 <b>Payment Verified & Credited!</b>\n\n💰 <b>₹${payment.amount.toFixed(2)}</b> credited to your wallet balance.\n💳 <b>Current Balance:</b> ₹${user ? user.balance.toFixed(2) : payment.amount.toFixed(2)}`,
          {
            parse_mode: 'HTML',
            reply_markup: keyboards.mainMenu()
          }
        );
      } catch {}
    }
  }

  await ctx.answerCallbackQuery({ text: '✅ Payment Approved & Key Delivered!' });
  try {
    const origText = ctx.callbackQuery?.message?.text || '';
    await ctx.editMessageText(
      `${origText}\n\n━━━━━━━━━━━━━━━━━━━━\n✅ <b>APPROVED BY ADMIN @${from.username || from.first_name}</b>\n${deliveredKey ? `🔑 <b>Delivered Key:</b> <code>${deliveredKey}</code>` : '💰 <b>Wallet Credited</b>'}`,
      { parse_mode: 'HTML' }
    );
  } catch {}
}

export async function handleAdminRejectPayment(ctx: Context, paymentId: string) {
  const from = ctx.from;
  if (!from || !isUserAdmin(from.id)) {
    return ctx.answerCallbackQuery({ text: 'Unauthorized', show_alert: true });
  }

  const payment = paymentRepo.getById(paymentId);
  if (!payment) {
    return ctx.answerCallbackQuery({ text: 'Payment not found', show_alert: true });
  }

  if (payment.status === 'COMPLETED') {
    return ctx.answerCallbackQuery({ text: 'Payment already approved earlier', show_alert: true });
  }

  paymentRepo.failPayment(payment.id, 'REJECTED_BY_ADMIN');

  let meta: any = {};
  if (payment.metadata) {
    try {
      meta = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
    } catch {}
  }

  const expectedUsd = meta.priceUsd || settingsRepo.calculateUsd(payment.amount);

  // Notify customer
  if (activeBot && payment.telegram_id) {
    try {
      await activeBot.api.sendMessage(
        payment.telegram_id,
        `❌ <b>Binance Payment Verification Failed</b>\n\n🆔 <b>Txn ID:</b> <code>${escapeHtml(meta.binanceTxnId || payment.reference_id)}</code>\n💵 <b>Required Amount:</b> $${expectedUsd.toFixed(2)} USDT\n\n⚠️ <i>Reason: Payment amount was incorrect/less than required or transaction was invalid.</i>\n\nPlease contact support @${config.brand.supportUsername} if you believe this is an error.`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboards.mainMenu()
        }
      );
    } catch {}
  }

  await ctx.answerCallbackQuery({ text: '❌ Payment Rejected' });
  try {
    const origText = ctx.callbackQuery?.message?.text || '';
    await ctx.editMessageText(
      `${origText}\n\n━━━━━━━━━━━━━━━━━━━━\n❌ <b>REJECTED BY ADMIN @${from.username || from.first_name} (Underpayment/Invalid)</b>`,
      { parse_mode: 'HTML' }
    );
  } catch {}
}
