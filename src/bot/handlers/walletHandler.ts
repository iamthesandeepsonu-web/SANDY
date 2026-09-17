import { Context, InputFile } from 'grammy';
import { userRepo } from '../../database/repositories/userRepo.js';
import { paymentRepo } from '../../database/repositories/paymentRepo.js';
import { orderRepo } from '../../database/repositories/orderRepo.js';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { upiService } from '../../services/upiService.js';
import { binancePayService } from '../../services/binancePayService.js';
import { fulfillmentService } from '../../services/fulfillmentService.js';
import { currencyService } from '../../services/currencyService.js';
import { keyboards } from '../keyboards.js';
import { escapeHtml } from './shopHandler.js';
import crypto from 'crypto';

// In-memory conversation state for custom amount and Binance Order ID entry
const userWaitingForAmount = new Set<number>();
export const userWaitingForBinanceOrderId = new Map<number, string>(); // telegramId -> paymentId

export async function handleWalletMenu(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name, from.language_code);
  const region = currencyService.detectUserRegion(from, user);

  const balanceText = region.isIndia
    ? `₹${user.balance.toFixed(2)}`
    : `$${currencyService.inrToUsd(user.balance).toFixed(2)} USDT (~₹${user.balance.toFixed(2)})`;

  const text = `
💰 <b>Add Balance / Top Up Wallet</b>

💳 <b>Current Balance:</b> ${balanceText}

Select or enter the amount you want to add to your wallet balance:
`.trim();

  const kb = keyboards.walletPresets(region.isIndia);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

export function promptCustomAmount(ctx: Context) {
  const from = ctx.from;
  if (from) {
    userWaitingForAmount.add(from.id);
  }

  const user = from ? userRepo.getByTelegramId(from.id) : null;
  const region = currencyService.detectUserRegion(from, user);

  const text = region.isIndia
    ? `
✏️ <b>Enter Custom Amount (INR)</b>

Please send the exact amount in INR you wish to add (Minimum: ₹10, Maximum: ₹50,000).
Example: <code>450</code> or <code>1200</code>
`.trim()
    : `
✏️ <b>Enter Custom Amount (USDT)</b>

Please send the exact amount in USDT you wish to add (Minimum: $1, Maximum: $500).
Example: <code>10</code> or <code>25</code>
`.trim();

  return ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: keyboards.backToMain()
  });
}

export async function promptBinanceOrderId(ctx: Context, paymentId: string) {
  const from = ctx.from;
  if (!from) return;

  const payment = paymentRepo.getById(paymentId);
  if (!payment) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Payment session expired or not found.', show_alert: true });
    }
    return;
  }

  userWaitingForBinanceOrderId.set(from.id, paymentId);

  if (ctx.callbackQuery) {
    try {
      await ctx.answerCallbackQuery();
    } catch {}
  }

  const text = `
🔢 <b>Enter Binance Order ID / Txn ID</b>

Please send your <b>Binance Pay Order ID or Transaction ID</b> as a message below to verify your payment.

📌 <b>How to find your Order ID:</b>
Open Binance App ➡️ <b>Pay</b> ➡️ <b>Payment History / Order Details</b> ➡️ Copy <b>Order ID / TxID</b>
<i>Example:</i> <code>2481928374921</code>
`.trim();

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: keyboards.backToMain()
  });
}

export async function handleCustomAmountText(ctx: Context, text: string) {
  const from = ctx.from;
  if (!from) return false;

  // 1. Check if user is waiting to enter Binance Order ID
  if (userWaitingForBinanceOrderId.has(from.id)) {
    const paymentId = userWaitingForBinanceOrderId.get(from.id)!;
    const rawOrderId = text.trim();

    if (rawOrderId.startsWith('/') || rawOrderId.toLowerCase() === 'cancel') {
      userWaitingForBinanceOrderId.delete(from.id);
      return false;
    }

    const verification = await binancePayService.verifyAndClaimBinanceOrderId(paymentId, rawOrderId, String(from.id));

    if (!verification.success) {
      await ctx.reply(verification.message, {
        parse_mode: 'HTML',
        reply_markup: keyboards.binancePaymentActions(paymentId)
      });
      return true;
    }

    // Success: remove user from waiting map
    userWaitingForBinanceOrderId.delete(from.id);

    if (verification.isPendingReview) {
      await ctx.reply(verification.message, {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu()
      });
      return true;
    }

    if (verification.isOrderFulfilled && verification.order) {
      const order = verification.order;
      const licenseKey = verification.licenseKey || order.license_key;
      const successText = `
🎉 <b>Payment Verified & Key Delivered!</b>

📦 <b>Order ID:</b> <code>${order.id}</code>
🎮 <b>Product:</b> ${escapeHtml(order.service_name)}
⏳ <b>Validity:</b> ${escapeHtml(order.validity_name)}
🔢 <b>Binance Txn ID:</b> <code>${escapeHtml(rawOrderId)}</code>

🔑 <b>Your License Key:</b>
<code>${escapeHtml(licenseKey)}</code>

<i>💡 Tap on the license key above to copy it instantly. Save this message for your reference.</i>
`.trim();

      await ctx.reply(successText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu()
      });
      return true;
    }

    // Standard Wallet Top-Up success
    const payment = paymentRepo.getById(paymentId);
    const user = payment ? userRepo.getById(payment.user_id) : null;
    const region = currencyService.detectUserRegion(from, user);
    const creditedDisplay = region.isIndia
      ? `₹${payment?.amount.toFixed(2) || ''}`
      : `$${currencyService.inrToUsd(payment?.amount || 0).toFixed(2)} USDT`;

    await ctx.reply(
      `🎉 <b>Binance Payment Verified & Credited!</b>\n\n💰 <b>${creditedDisplay}</b> has been credited to your wallet balance.\n🔢 <b>Binance Txn ID:</b> <code>${escapeHtml(rawOrderId)}</code>\n💳 <b>Current Wallet Balance:</b> ₹${user ? user.balance.toFixed(2) : ''}\n\nUse <b>🛒 Shop Now</b> to purchase digital keys!`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu()
      }
    );
    return true;
  }

  // 2. Check if user is entering custom wallet amount
  if (!userWaitingForAmount.has(from.id)) return false;

  const user = userRepo.getByTelegramId(from.id);
  const region = currencyService.detectUserRegion(from, user);
  const rawNum = parseFloat(text.trim());

  if (region.isIndia) {
    if (isNaN(rawNum) || rawNum < 10 || rawNum > 50000) {
      await ctx.reply('⚠️ Please enter a valid number between ₹10 and ₹50,000.\nExample: <code>450</code>', {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToMain()
      });
      return true;
    }

    userWaitingForAmount.delete(from.id);
    const amountInr = Math.round(rawNum);
    const amountUsd = currencyService.inrToUsd(amountInr);
    await handleSelectPaymentMethod(ctx, amountInr, amountUsd);
    return true;
  } else {
    if (isNaN(rawNum) || rawNum < 1 || rawNum > 500) {
      await ctx.reply('⚠️ Please enter a valid number between $1 and $500 USDT.\nExample: <code>10</code> or <code>25</code>', {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToMain()
      });
      return true;
    }

    userWaitingForAmount.delete(from.id);
    const amountUsd = parseFloat(rawNum.toFixed(2));
    const amountInr = currencyService.usdToInr(amountUsd);
    await handleSelectPaymentMethod(ctx, amountInr, amountUsd);
    return true;
  }
}

export async function handleSelectPaymentMethod(ctx: Context, amountInr: number, amountUsd?: number) {
  const from = ctx.from;
  const user = from ? userRepo.getByTelegramId(from.id) : null;
  const region = currencyService.detectUserRegion(from, user);
  const usd = amountUsd !== undefined ? amountUsd : currencyService.inrToUsd(amountInr);

  const headerText = region.isIndia
    ? `💰 <b>Top Up: ₹${amountInr.toFixed(2)}</b> (≈ $${usd.toFixed(2)} USDT)`
    : `💰 <b>Top Up: $${usd.toFixed(2)} USDT</b> (≈ ₹${amountInr.toFixed(2)})`;

  const text = `
${headerText}

Choose your preferred payment method below to complete the top-up:
`.trim();

  const kb = keyboards.paymentMethods(amountInr, usd);

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

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name, from.language_code);
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

  // UPI ALWAYS displays and charges in INR
  const caption = `
⚡ <b>Pay with UPI Auto — ₹${amount.toFixed(2)}</b>

📱 <b>Scan the QR Code</b> above using any UPI App (GPay, PhonePe, Paytm, BHIM, CRED).

💵 <b>Payable Amount:</b> ₹${amount.toFixed(2)} INR
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

export async function handleBinancePayment(ctx: Context, amountInr: number, amountUsd?: number) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name, from.language_code);
  const refId = 'BPAY' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
  const priceUsd = amountUsd !== undefined ? amountUsd : currencyService.inrToUsd(amountInr);

  const binanceData = await binancePayService.generateOrderPayload(amountInr, priceUsd, refId);
  const merchantPayId = binanceData.merchantId || '';

  const payment = paymentRepo.create({
    userId: user.id,
    telegramId: from.id,
    paymentMethod: 'BINANCE_PAY',
    amount: amountInr,
    referenceId: refId,
    qrPayload: merchantPayId,
    metadata: { bep20: binanceData.bep20Address, priceUsd }
  });

  // Binance ALWAYS displays and charges in USD/USDT
  const text = `
🟡 <b>Pay with Binance Pay — $${priceUsd.toFixed(2)} USDT</b>

💵 <b>Payable Amount:</b> <b>$${priceUsd.toFixed(2)} USDT</b>
💵 <b>Equivalent INR:</b> ₹${amountInr.toFixed(2)}
🆔 <b>Payment ID:</b> <code>${payment.id}</code>

━━━━━━━━━━━━━━━━━━━━
📌 <b>Payment Steps:</b>

1️⃣ <b>Binance Pay ID:</b>
<code>${merchantPayId || 'Not configured'}</code>

2️⃣ ${binanceData.bep20Address ? `<b>BEP-20 USDT Address:</b>\n<code>${binanceData.bep20Address}</code>\n\n3️⃣ ` : ''}Send exactly <b>$${priceUsd.toFixed(2)} USDT</b>.
${binanceData.bep20Address ? '4️⃣' : '3️⃣'} Copy the <b>Binance Order ID / Transaction ID</b> from your Binance Pay receipt.
${binanceData.bep20Address ? '5️⃣' : '4️⃣'} Click <b>🔢 Enter Binance Order ID / Txn ID</b> below to verify and get instant credit!
━━━━━━━━━━━━━━━━━━━━
`.trim();

  const kb = keyboards.binancePaymentActions(payment.id);

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
      await ctx.answerCallbackQuery();
      return;
    } catch {}
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

export async function handleCheckPayment(ctx: Context, paymentId: string) {
  const from = ctx.from;
  if (!from) return;

  const payment = paymentRepo.getById(paymentId);
  if (!payment) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Payment session expired or not found.', show_alert: true });
    }
    return;
  }

  const user = userRepo.getById(payment.user_id);
  const region = currencyService.detectUserRegion(from, user);

  if (payment.status === 'COMPLETED') {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: '✅ Payment Verified & Completed!' });
    }

    const balanceFormatted = region.isIndia
      ? `₹${user ? user.balance.toFixed(2) : ''}`
      : `$${user ? currencyService.inrToUsd(user.balance).toFixed(2) : ''} USDT`;

    return ctx.reply(
      `✅ <b>Payment Verified!</b>\n\n💳 <b>Current Wallet Balance:</b> ${balanceFormatted}\n\nUse <b>🛒 Shop Now</b> to purchase digital keys!`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu()
      }
    );
  }

  if (payment.status === 'FAILED' || payment.status === 'EXPIRED') {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: '❌ Payment Expired or Failed.', show_alert: true });
    }
    return ctx.reply(
      `❌ <b>Payment Session Expired</b>\n\nThis payment session has timed out. Please initiate a new top-up.`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu()
      }
    );
  }

  // If Binance Pay and still PENDING, trigger active reconciliation check
  if (payment.payment_method === 'BINANCE_PAY' && payment.status === 'PENDING') {
    if (ctx.callbackQuery) {
      try {
        await ctx.answerCallbackQuery({ text: '🔍 Checking Binance Pay network...' });
      } catch {}
    }

    try {
      const recRes = await binancePayService.reconcilePayment(paymentId, 'telegram_bot');
      if (recRes.isPaid && recRes.payment) {
        const updated = recRes.payment;
        let meta: any = {};
        try {
          meta = typeof updated.metadata === 'string' ? JSON.parse(updated.metadata) : updated.metadata;
        } catch {}

        if (meta && meta.orderId && meta.licenseKey) {
          return ctx.reply(
            `🎉 <b>Payment Verified & Key Delivered!</b>\n\n📦 <b>Order ID:</b> <code>${meta.orderId}</code>\n🎮 <b>Product:</b> ${escapeHtml(meta.productName || 'Product')}\n⏳ <b>Validity:</b> ${escapeHtml(meta.validityName || '')}\n🔢 <b>Binance Txn:</b> <code>${escapeHtml(updated.external_tx_id || '')}</code>\n\n🔑 <b>Your License Key:</b>\n<code>${escapeHtml(meta.licenseKey)}</code>\n\n<i>💡 Tap to copy key.</i>`,
            {
              parse_mode: 'HTML',
              reply_markup: keyboards.mainMenu()
            }
          );
        }

        const balanceFormatted = region.isIndia
          ? `₹${user ? user.balance.toFixed(2) : ''}`
          : `$${currencyService.inrToUsd(user?.balance || 0).toFixed(2)} USDT`;

        return ctx.reply(
          `🎉 <b>Binance Payment Verified & Credited!</b>\n\n💳 <b>Current Wallet Balance:</b> ${balanceFormatted}\n\nUse <b>🛒 Shop Now</b> to purchase digital keys!`,
          {
            parse_mode: 'HTML',
            reply_markup: keyboards.mainMenu()
          }
        );
      }
    } catch (e: any) {
      console.warn('Reconcile error on check status:', e.message);
    }
  }

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({
      text: '⏱️ Payment is pending.\nIf you already paid on Binance, tap "🔢 Enter Binance Order ID / Txn ID" below to verify instantly.',
      show_alert: true
    });
  }
}
