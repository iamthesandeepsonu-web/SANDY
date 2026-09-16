import { Context, InputFile } from 'grammy';
import { userRepo } from '../../database/repositories/userRepo.js';
import { paymentRepo } from '../../database/repositories/paymentRepo.js';
import { orderRepo } from '../../database/repositories/orderRepo.js';
import { upiService } from '../../services/upiService.js';
import { binancePayService } from '../../services/binancePayService.js';
import { fulfillmentService } from '../../services/fulfillmentService.js';
import { keyboards } from '../keyboards.js';
import { escapeHtml } from './shopHandler.js';
import crypto from 'crypto';

// In-memory conversation state for custom amount entry
const userWaitingForAmount = new Set<number>();

export async function handleWalletMenu(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);

  const text = `
💰 <b>Add Balance / Top Up Wallet</b>

💳 <b>Current Balance:</b> ₹${user.balance.toFixed(2)}

Select or enter the amount you want to add to your wallet balance:
`.trim();

  const kb = keyboards.walletPresets();

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

export function promptCustomAmount(ctx: Context) {
  if (ctx.from) {
    userWaitingForAmount.add(ctx.from.id);
  }

  const text = `
✏️ <b>Enter Custom Amount</b>

Please send the exact amount you wish to add (Minimum: ₹10, Maximum: ₹50,000).
Example: <code>450</code> or <code>1200</code>
`.trim();

  return ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: keyboards.backToMain()
  });
}

export async function handleCustomAmountText(ctx: Context, text: string) {
  const from = ctx.from;
  if (!from || !userWaitingForAmount.has(from.id)) return false;

  const amount = parseFloat(text.trim());
  if (isNaN(amount) || amount < 10 || amount > 50000) {
    await ctx.reply('⚠️ Please enter a valid number between ₹10 and ₹50,000.\nExample: <code>450</code>', {
      parse_mode: 'HTML',
      reply_markup: keyboards.backToMain()
    });
    return true;
  }

  userWaitingForAmount.delete(from.id);
  await handleSelectPaymentMethod(ctx, Math.round(amount));
  return true;
}

export async function handleSelectPaymentMethod(ctx: Context, amount: number) {
  const text = `
💰 <b>Top Up: ₹${amount.toFixed(2)}</b>

Choose your preferred payment method below to complete the top-up:
`.trim();

  const kb = keyboards.paymentMethods(amount);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

export async function handleUpiPayment(ctx: Context, amount: number) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);
  const refId = 'UPI' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();

  const qrData = await upiService.generateUpiQr(amount, refId);

  const payment = paymentRepo.create({
    userId: user.id,
    telegramId: from.id,
    paymentMethod: 'UPI_AUTO',
    amount,
    referenceId: refId,
    qrPayload: qrData.payload,
    metadata: { vpa: qrData.vpa, merchant: qrData.merchantName }
  });

  const caption = `
⚡ <b>Pay with UPI Auto — ₹${amount.toFixed(2)}</b>

📱 <b>Scan the QR Code</b> above using any UPI App (GPay, PhonePe, Paytm, BHIM, CRED).

💵 <b>Amount:</b> ₹${amount.toFixed(2)}
🆔 <b>Reference ID:</b> <code>${refId}</code>
🏦 <b>UPI VPA:</b> <code>${qrData.vpa}</code>
⏱️ <b>Status:</b> 🟡 <i>Pending Payment Verification</i>

<i>Your wallet will be credited automatically once the transaction is verified.</i>
`.trim();

  if (ctx.callbackQuery) {
    await ctx.deleteMessage().catch(() => {});
  }

  await ctx.replyWithPhoto(new InputFile(qrData.qrBuffer, `upi-qr-${refId}.png`), {
    caption,
    parse_mode: 'HTML',
    reply_markup: keyboards.paymentPendingActions(payment.id)
  });
}

export async function handleBinancePayment(ctx: Context, amount: number) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);
  const refId = 'BPAY' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();

  const orderRes = await binancePayService.createOrder({
    merchantTradeNo: refId,
    orderAmount: amount,
    goodsTitle: `Wallet Top-Up (₹${amount})`
  });

  const payment = paymentRepo.create({
    userId: user.id,
    telegramId: from.id,
    paymentMethod: 'BINANCE_PAY',
    amount,
    referenceId: refId,
    qrPayload: orderRes.qrContent,
    metadata: { prepayId: orderRes.prepayId, bep20: orderRes.bep20Address }
  });

  const text = `
🟡 <b>Pay with Binance Pay — ₹${amount.toFixed(2)}</b>

💰 <b>Amount:</b> ₹${amount.toFixed(2)} (or equivalent USDT)
🆔 <b>Order Reference ID:</b> <code>${refId}</code>
${orderRes.bep20Address ? `🌐 <b>BEP20 USDT Address:</b>\n<code>${orderRes.bep20Address}</code>\n` : ''}
⏱️ <b>Status:</b> 🟡 <i>Pending Payment Confirmation</i>

<i>Once paid, click 'Check Payment Status' below or wait for automatic webhook confirmation.</i>
`.trim();

  const kb = keyboards.paymentPendingActions(payment.id);

  if (orderRes.qrDataUrl) {
    const base64Data = orderRes.qrDataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (ctx.callbackQuery) {
      await ctx.deleteMessage().catch(() => {});
    }
    await ctx.replyWithPhoto(new InputFile(buffer, `binance-qr-${refId}.png`), {
      caption: text,
      parse_mode: 'HTML',
      reply_markup: kb
    });
    return;
  }

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

export async function handleCheckPayment(ctx: Context, paymentId: string) {
  let payment = paymentRepo.getById(paymentId);
  if (!payment) {
    await ctx.answerCallbackQuery({ text: 'Payment record not found.', show_alert: true });
    return;
  }

  // 1. If pending and Binance Pay, check live Binance API
  if (payment.status === 'PENDING' && payment.payment_method === 'BINANCE_PAY') {
    try {
      const liveCheck = await binancePayService.queryOrder(payment.reference_id);
      if (liveCheck.success && (liveCheck.status === 'PAID' || liveCheck.status === 'SUCCESS')) {
        paymentRepo.completePayment(payment.id, liveCheck.transactionId);
        payment = paymentRepo.getById(paymentId)!;
      }
    } catch {}
  }

  // 2. If Payment is COMPLETED
  if (payment.status === 'COMPLETED') {
    let meta: any = {};
    if (payment.metadata) {
      try {
        meta = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
      } catch {}
    }

    // Direct Product Purchase Fulfillment Flow
    if (meta && meta.serviceId && meta.validityId) {
      // If already fulfilled earlier
      if (meta.orderId) {
        const existingOrder = orderRepo.getById(meta.orderId);
        if (existingOrder) {
          await ctx.answerCallbackQuery({ text: '✅ Order details loaded!' });
          const text = `
🎉 <b>Payment Confirmed & Order Delivered!</b>

📦 <b>Order ID:</b> <code>${existingOrder.id}</code>
🎮 <b>Product:</b> ${escapeHtml(existingOrder.service_name)}
⏳ <b>Validity:</b> ${escapeHtml(existingOrder.validity_name)}
💰 <b>Amount Paid:</b> ₹${existingOrder.price_paid.toFixed(2)}

🔑 <b>Your License Key:</b>
<code>${escapeHtml(existingOrder.license_key)}</code>

<i>💡 Tap on the license key above to copy it instantly. Save this message for your reference.</i>
`.trim();
          await ctx.reply(text, {
            parse_mode: 'HTML',
            reply_markup: keyboards.mainMenu()
          });
          return;
        }
      }

      // Not yet fulfilled: execute purchase fulfillment now
      const result = await fulfillmentService.processPurchase(payment.user_id, meta.serviceId, meta.validityId);

      if (result.success && result.order) {
        const order = result.order;
        const licenseKey = result.licenseKey || order.license_key;
        paymentRepo.updateMetadata(payment.id, {
          ...meta,
          orderId: order.id,
          licenseKey
        });

        await ctx.answerCallbackQuery({ text: '🎉 Payment confirmed! Here is your key.' });
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
        await ctx.reply(text, {
          parse_mode: 'HTML',
          reply_markup: keyboards.mainMenu()
        });
        return;
      }

      // Fulfillment failed (e.g. stock exhausted after payment)
      await ctx.answerCallbackQuery({ text: 'Payment credited to wallet.', show_alert: true });
      const text = `
🎉 <b>Payment Confirmed & Credited to Wallet</b>

💰 <b>₹${payment.amount.toFixed(2)}</b> was added to your wallet balance.
⚠️ <i>${escapeHtml(result.errorMessage || 'Product became out of stock during fulfillment. Your funds are 100% safe in your wallet.')}</i>

You can use your wallet balance anytime via <b>🛒 Shop Now</b>!
`.trim();
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu()
      });
      return;
    }

    // Standard Wallet Top-Up Confirmation Flow
    const user = userRepo.getById(payment.user_id);
    await ctx.answerCallbackQuery({ text: '✅ Payment verified and credited!' });
    await ctx.reply(
      `🎉 <b>Payment Confirmed!</b>\n\n<b>₹${payment.amount.toFixed(2)}</b> has been credited to your wallet balance.\n💳 <b>Current Wallet Balance:</b> ₹${user ? user.balance.toFixed(2) : payment.amount.toFixed(2)}\n\nUse <b>🛒 Shop Now</b> to purchase digital keys!`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu()
      }
    );
    return;
  }

  // 3. Payment still PENDING
  await ctx.answerCallbackQuery({
    text: '🟡 Payment is pending confirmation. Once you complete the payment on your app, click this button again.',
    show_alert: true
  });
}
