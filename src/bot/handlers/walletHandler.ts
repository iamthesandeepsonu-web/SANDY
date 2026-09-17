import { Context, InputFile } from 'grammy';
import { userRepo } from '../../database/repositories/userRepo.js';
import { paymentRepo } from '../../database/repositories/paymentRepo.js';
import { orderRepo } from '../../database/repositories/orderRepo.js';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { upiService } from '../../services/upiService.js';
import { binancePayService } from '../../services/binancePayService.js';
import { fulfillmentService } from '../../services/fulfillmentService.js';
import { emailVerificationService } from '../../services/emailVerificationService.js';
import { keyboards } from '../keyboards.js';
import { escapeHtml } from './shopHandler.js';
import crypto from 'crypto';

// In-memory conversation state for custom amount and Binance Order ID entry
const userWaitingForAmount = new Set<number>();
export const userWaitingForBinanceOrderId = new Map<number, string>(); // telegramId -> paymentId

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
      await ctx.reply(`❌ <b>Verification Failed</b>\n\n${escapeHtml(verification.message)}`, {
        parse_mode: 'HTML',
        reply_markup: keyboards.binancePaymentActions(paymentId)
      });
      return true;
    }

    // Success: remove user from waiting map
    userWaitingForBinanceOrderId.delete(from.id);

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
    await ctx.reply(
      `🎉 <b>Binance Payment Verified & Credited!</b>\n\n💰 <b>₹${payment?.amount.toFixed(2) || ''}</b> has been credited to your wallet balance.\n🔢 <b>Binance Txn ID:</b> <code>${escapeHtml(rawOrderId)}</code>\n💳 <b>Current Wallet Balance:</b> ₹${user ? user.balance.toFixed(2) : ''}\n\nUse <b>🛒 Shop Now</b> to purchase digital keys!`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu()
      }
    );
    return true;
  }

  // 2. Check if user is entering custom wallet amount
  if (!userWaitingForAmount.has(from.id)) return false;

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
  const priceUsd = settingsRepo.calculateUsd(amount);

  const orderRes = await binancePayService.createOrder({
    merchantTradeNo: refId,
    orderAmount: priceUsd,
    goodsTitle: `Wallet Top-Up (₹${amount})`
  });

  const binanceCfg = binancePayService.getConfig();
  const merchantPayId = binanceCfg.merchantId || '433230697';

  const payment = paymentRepo.create({
    userId: user.id,
    telegramId: from.id,
    paymentMethod: 'BINANCE_PAY',
    amount,
    referenceId: refId,
    qrPayload: orderRes.qrContent,
    metadata: { prepayId: orderRes.prepayId, bep20: orderRes.bep20Address, priceUsd }
  });

  const text = `
🟡 <b>Pay with Binance Pay — ₹${amount.toFixed(2)}</b>

💵 <b>Amount to Pay:</b> <b>$${priceUsd.toFixed(2)} USDT</b>
💵 <b>Equivalent INR:</b> ₹${amount.toFixed(2)}
🆔 <b>Payment ID:</b> <code>${payment.id}</code>

━━━━━━━━━━━━━━━━━━━━
📌 <b>Payment Steps:</b>

1️⃣ <b>Binance Pay ID:</b>
<code>${merchantPayId}</code>

2️⃣ ${orderRes.bep20Address ? `<b>BEP-20 USDT Address:</b>\n<code>${orderRes.bep20Address}</code>\n\n3️⃣ ` : ''}Send exactly <b>$${priceUsd.toFixed(2)} USDT</b>.
${orderRes.bep20Address ? '4️⃣' : '3️⃣'} Copy the <b>Binance Order ID / Transaction ID</b> from your Binance Pay receipt.
${orderRes.bep20Address ? '5️⃣' : '4️⃣'} Click <b>🔢 Enter Binance Order ID / Txn ID</b> below to verify and get instant credit!
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

  // 1b. If pending and UPI Auto, trigger an immediate IMAP email inbox check
  if (payment.status === 'PENDING' && payment.payment_method === 'UPI_AUTO') {
    try {
      await emailVerificationService.checkEmails();
      payment = paymentRepo.getById(paymentId)!;
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
