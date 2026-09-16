import { Context, InputFile } from 'grammy';
import { userRepo } from '../../database/repositories/userRepo.js';
import { paymentRepo } from '../../database/repositories/paymentRepo.js';
import { upiService } from '../../services/upiService.js';
import { binancePayService } from '../../services/binancePayService.js';
import { keyboards } from '../keyboards.js';
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
  const payment = paymentRepo.getById(paymentId);
  if (!payment) {
    await ctx.answerCallbackQuery({ text: 'Payment record not found.', show_alert: true });
    return;
  }

  if (payment.status === 'COMPLETED') {
    await ctx.answerCallbackQuery({ text: '✅ Payment has already been verified and credited!', show_alert: true });
    await ctx.reply(
      `🎉 <b>Payment Confirmed!</b>\n\n<b>₹${payment.amount.toFixed(2)}</b> has been credited to your wallet balance.\n\nUse <b>🛒 Shop Now</b> to purchase digital keys!`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu()
      }
    );
    return;
  }

  await ctx.answerCallbackQuery({
    text: '🟡 Payment is currently pending confirmation. Once detected by the gateway, your balance will update automatically.',
    show_alert: true
  });
}
