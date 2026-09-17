import { Context, InputFile, InlineKeyboard } from 'grammy';
import { serviceRepo } from '../../database/repositories/serviceRepo.js';
import { validityRepo } from '../../database/repositories/validityRepo.js';
import { userRepo } from '../../database/repositories/userRepo.js';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { mappingRepo } from '../../database/repositories/mappingRepo.js';
import { licenseRepo } from '../../database/repositories/licenseRepo.js';
import { licenseApiService, extractLicenseKeyString } from '../../services/licenseApiService.js';
import { fulfillmentService } from '../../services/fulfillmentService.js';
import { binancePayService } from '../../services/binancePayService.js';
import { upiService } from '../../services/upiService.js';
import { paymentRepo } from '../../database/repositories/paymentRepo.js';
import { currencyService } from '../../services/currencyService.js';
import { keyboards } from '../keyboards.js';
import crypto from 'crypto';

export async function handleShopMenu(ctx: Context) {
  const services = serviceRepo.getAll(true); // Only active, enabled services

  if (services.length === 0) {
    const text = `
🎮 <b>CHOOSE YOUR GAME</b>

📦 <b>AVAILABLE PRODUCTS</b>

⚡ <b>Premium Keys</b>
🚀 <b>Instant Delivery</b>
🔒 <b>Secure Payment</b>
💬 <b>24/7 Support</b>

👇 <b>SELECT YOUR PRODUCT</b>

<i>No active products are available right now. Please check back shortly!</i>
`.trim();
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboards.backToMain() });
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboards.backToMain() });
    return;
  }

  // Exact requested header structure:
  // 1. CHOOSE YOUR GAME
  // 2. AVAILABLE PRODUCTS
  // 3. Feature highlights (Premium Keys, Instant Delivery, Secure Payment, 24/7 Support)
  // 4. SELECT YOUR PRODUCT (immediately preceding the product buttons list)
  const text = `
🎮 <b>CHOOSE YOUR GAME</b>

📦 <b>AVAILABLE PRODUCTS</b>

⚡ <b>Premium Keys</b>
🚀 <b>Instant Delivery</b>
🔒 <b>Secure Payment</b>
💬 <b>24/7 Support</b>

👇 <b>SELECT YOUR PRODUCT</b>
`.trim();
  const kb = keyboards.servicesList(services);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

export async function handleServiceSelect(ctx: Context, serviceId: string) {
  const service = serviceRepo.getById(serviceId);
  if (!service || !service.is_active) {
    await ctx.answerCallbackQuery({ text: 'This product is currently unavailable.', show_alert: true });
    return handleShopMenu(ctx);
  }

  const validities = validityRepo.getByServiceIdWithStock(serviceId, true); // Only active validities
  const usdRate = currencyService.getUsdRate();
  const from = ctx.from;
  const user = from ? userRepo.getByTelegramId(from.id) : null;
  const region = currencyService.detectUserRegion(from, user);

  if (validities.length === 0) {
    const text = `🎮 <b>${escapeHtml(service.name)}</b>\n\n${service.description ? escapeHtml(service.description) + '\n\n' : ''}No validity plans are active for this product at the moment.`;
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboards.servicesList(serviceRepo.getAll(true)) });
    await ctx.answerCallbackQuery();
    return;
  }

  const text = `
🎮 <b>${escapeHtml(service.name)}</b>
${service.description ? `<i>${escapeHtml(service.description)}</i>\n` : ''}
Select Validity:
`.trim();

  // Shows Validity with User Default Currency prioritized
  const kb = keyboards.validitiesList(serviceId, validities, region.isIndia, usdRate);
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  await ctx.answerCallbackQuery();
}

/**
 * Step 4 & 5: When user selects a validity:
 * 1. DO NOT immediately open payment.
 * 2. Perform LIVE stock/availability check with the mapped API / Service Provider.
 */
export async function handleValiditySelect(ctx: Context, serviceId: string, validityId: string) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);
  const service = serviceRepo.getById(serviceId);
  const validity = validityRepo.getById(validityId);

  if (!service || !validity) {
    await ctx.answerCallbackQuery({ text: 'Invalid product selected.', show_alert: true });
    return handleShopMenu(ctx);
  }

  // Inform user that live verification is happening
  await ctx.answerCallbackQuery({ text: '🔍 Checking live provider stock...' });

  // LIVE STOCK/AVAILABILITY CHECK WITH MAPPED SERVICE PROVIDER / API
  const mapping = mappingRepo.getByServiceAndValidity(serviceId, validityId);

  if (mapping && mapping.external_product_id) {
    // Mapped product: Query live Service Provider API
    const stockCheck = await licenseApiService.checkStock(mapping.external_product_id);

    // CASE 1: Stock is NOT AVAILABLE
    if (stockCheck.success && stockCheck.in_stock === false) {
      const text = `
⚠️ <b>OUT OF STOCK</b>

🎮 <b>Product:</b> ${escapeHtml(service.name)}
⏳ <b>Validity:</b> ${escapeHtml(validity.name)}

This product is currently <b>Out of Stock</b> with the Service Provider.

<i>• No balance or credits were deducted.
• Please check back shortly or choose another option.</i>
`.trim();
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToValidities(serviceId)
      });
      return;
    }

    // CASE 2: Service Provider returned an error
    if (!stockCheck.success && stockCheck.error_code !== 'SERVER_ERROR') {
      const text = `
❌ <b>SERVICE PROVIDER RESPONSE</b>

🎮 <b>Product:</b> ${escapeHtml(service.name)} (${escapeHtml(validity.name)})

<b>Provider Message:</b>
<code>${escapeHtml(stockCheck.error_message || 'Service Provider returned an error')}</code>

<i>• No backup stock was used.
• No balance or credits were deducted.</i>
`.trim();
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToValidities(serviceId)
      });
      return;
    }

    // CASE 3: Service Provider is not responding, times out, or server is unavailable
    if (!stockCheck.success) {
      const text = `
⚠️ <b>SERVICE PROVIDER UNAVAILABLE</b>

🎮 <b>Product:</b> ${escapeHtml(service.name)} (${escapeHtml(validity.name)})

The Service Provider server is currently not responding or timed out.

<b>Details:</b>
<code>${escapeHtml(stockCheck.error_message || 'Connection timed out. Server is unavailable.')}</code>

<i>• No backup stock was consumed.
• No balance or credits were deducted.</i>
`.trim();
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToValidities(serviceId)
      });
      return;
    }
  } else {
    // Tier 1: Local Stock Only
    const localStock = licenseRepo.getAvailableCount(serviceId, validityId);
    if (localStock <= 0) {
      const text = `
⚠️ <b>OUT OF STOCK</b>

🎮 <b>Product:</b> ${escapeHtml(service.name)}
⏳ <b>Validity:</b> ${escapeHtml(validity.name)}

Sorry, this product is currently <b>Out of Stock</b> in our local inventory.

<i>• No balance or credits were deducted.
• Please check back later.</i>
`.trim();
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToValidities(serviceId)
      });
      return;
    }
  }

  // STOCK CONFIRMED AVAILABLE -> SHOW PAYMENT OPTIONS
  const region = currencyService.detectUserRegion(from, user);
  const priceUsd = currencyService.inrToUsd(validity.price);
  const usdRate = currencyService.getUsdRate();

  const balanceInfo = region.isIndia
    ? (user.balance >= validity.price
        ? `✅ <b>Wallet Balance:</b> ₹${user.balance.toFixed(2)} (Sufficient)`
        : `⚠️ <b>Wallet Balance:</b> ₹${user.balance.toFixed(2)} (Need ₹${(validity.price - user.balance).toFixed(2)} more)`)
    : (user.balance >= validity.price
        ? `✅ <b>Wallet Balance:</b> $${currencyService.inrToUsd(user.balance).toFixed(2)} USDT (Sufficient)`
        : `⚠️ <b>Wallet Balance:</b> $${currencyService.inrToUsd(user.balance).toFixed(2)} USDT (Need $${currencyService.inrToUsd(validity.price - user.balance).toFixed(2)} more)`);

  const priceHeader = region.isIndia
    ? `💵 <b>Price (INR):</b> ₹${validity.price.toFixed(2)} INR (≈ $${priceUsd.toFixed(2)} USD)`
    : `💵 <b>Price (USDT):</b> $${priceUsd.toFixed(2)} USDT (≈ ₹${validity.price.toFixed(2)} INR)`;

  const text = `
✅ <b>LIVE STOCK CONFIRMED AVAILABLE</b>

🎮 <b>Product:</b> ${escapeHtml(service.name)}
⏳ <b>Plan:</b> ${escapeHtml(validity.name)}
${priceHeader}

👤 <b>Your Account:</b>
${balanceInfo}

👇 <b>SELECT PAYMENT METHOD:</b>
`.trim();

  const kb = keyboards.shopPaymentOptions(serviceId, validityId, validity.price, priceUsd, user.balance, region.isIndia, usdRate);
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

/**
 * Handle Purchase with INR Wallet Balance
 */
export async function handlePurchaseInr(ctx: Context, serviceId: string, validityId: string) {
  const from = ctx.from;
  if (!from) return;

  try {
    await ctx.answerCallbackQuery({ text: 'Processing wallet purchase...' });
  } catch {}

  try {
    const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);
    const service = serviceRepo.getById(serviceId);
    const validity = validityRepo.getById(validityId);

    if (!service || !validity) {
      return handleShopMenu(ctx);
    }

    const priceUsd = settingsRepo.calculateUsd(validity.price);

    // Balance Check
    if (user.balance < validity.price) {
      const diff = validity.price - user.balance;
      const text = `
❌ <b>Insufficient Wallet Balance</b>

🎮 <b>Product:</b> ${escapeHtml(service.name)}
⏳ <b>Validity:</b> ${escapeHtml(validity.name)}
💰 <b>Required Price:</b> ₹${validity.price.toFixed(2)} ($${priceUsd.toFixed(2)})
💳 <b>Your Current Balance:</b> ₹${user.balance.toFixed(2)}
⚠️ <b>Shortage:</b> ₹${diff.toFixed(2)}

Please choose a direct payment method or top up your wallet:
`.trim();

      const kb = new InlineKeyboard()
        .text(`⚡ Pay with UPI — ₹${validity.price.toFixed(2)}`, `pay_direct_upi::${serviceId}::${validityId}`)
        .row()
        .text(`🟡 Pay with Binance — $${priceUsd.toFixed(2)} USDT`, `pay_direct_binance::${serviceId}::${validityId}`)
        .row()
        .text(`💳 Top Up Wallet (+₹${Math.ceil(diff)})`, `wallet_topup_amount_${Math.ceil(diff)}`)
        .row()
        .text('← Back to Validities', `shop_srv::${serviceId}`);

      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: kb
      });
      return;
    }

    const result = await fulfillmentService.processPurchase(user.id, serviceId, validityId);

    if (!result.success) {
      if (result.errorCode === 'OUT_OF_STOCK') {
        await ctx.editMessageText(
          `⚠️ <b>Out of Stock</b>\n\n${escapeHtml(result.errorMessage || 'Product became out of stock during fulfillment.')}\n\n<i>Your wallet balance was NOT deducted.</i>`,
          {
            parse_mode: 'HTML',
            reply_markup: keyboards.backToValidities(serviceId)
          }
        );
        return;
      }

      await ctx.editMessageText(
        `❌ <b>Purchase Failed</b>\n\n<b>Provider Response:</b>\n<code>${escapeHtml(result.errorMessage || 'Provider failed to generate license')}</code>\n\n<i>No balance was deducted. Backup stock was protected.</i>`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboards.backToValidities(serviceId)
        }
      );
      return;
    }

    // SUCCESSFUL PURCHASE
    const order = result.order!;
    const licenseKey = result.licenseKey || order.license_key;
    const paidUsd = settingsRepo.calculateUsd(order.price_paid);
    const updatedUser = userRepo.getById(user.id);
    const currentBalance = updatedUser ? updatedUser.balance : (user.balance - order.price_paid);

    const text = `
🎉 <b>Order Successful!</b>

📦 <b>Order ID:</b> <code>${order.id}</code>
🎮 <b>Product:</b> ${escapeHtml(service.name)}
⏳ <b>Validity:</b> ${escapeHtml(validity.name)}
💰 <b>Amount Paid:</b> ₹${order.price_paid.toFixed(2)} ($${paidUsd.toFixed(2)})
💳 <b>Remaining Balance:</b> ₹${currentBalance.toFixed(2)}

🔑 <b>Your License Key:</b>
<code>${escapeHtml(licenseKey)}</code>

<i>💡 Tap on the license key above to copy it instantly. Save this message for your reference.</i>
`.trim();

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: keyboards.mainMenu()
    });
  } catch (err: any) {
    console.error('Error during wallet purchase:', err);
    try {
      await ctx.editMessageText(`❌ <b>An unexpected error occurred:</b> ${escapeHtml(err.message || 'Please try again later')}`, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToValidities(serviceId)
      });
    } catch {}
  }
}

/**
 * Handle Direct UPI Payment for Selected Product
 */
export async function handlePurchaseDirectUpi(ctx: Context, serviceId: string, validityId: string) {
  const from = ctx.from;
  if (!from) return;

  try {
    await ctx.answerCallbackQuery({ text: 'Opening UPI payment...' });
  } catch {}

  try {
    const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);
    const service = serviceRepo.getById(serviceId);
    const validity = validityRepo.getById(validityId);

    if (!service || !validity) {
      return handleShopMenu(ctx);
    }

    const priceUsd = settingsRepo.calculateUsd(validity.price);
    const refId = 'UPI' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

    const qrData = await upiService.generateUpiQr(validity.price, refId);

    const payment = paymentRepo.create({
      userId: user.id,
      telegramId: from.id,
      paymentMethod: 'UPI_AUTO',
      amount: validity.price,
      referenceId: refId,
      qrPayload: qrData.payload,
      metadata: {
        serviceId,
        validityId,
        productName: service.name,
        validityName: validity.name,
        priceUsd
      }
    });

    const text = `
⚡ <b>UPI Auto QR Checkout</b>

🎮 <b>Product:</b> ${escapeHtml(service.name)} (${escapeHtml(validity.name)})
💰 <b>Amount to Pay:</b> <b>₹${validity.price.toFixed(2)}</b>
🆔 <b>Payment ID:</b> <code>${payment.id}</code>

━━━━━━━━━━━━━━━━━━━━
📌 <b>Payment Steps:</b>

1️⃣ <b>Scan the QR code</b> using PhonePe, GPay, Paytm, or BHIM.
2️⃣ Or pay directly to UPI VPA:
<code>${qrData.vpa}</code>

3️⃣ Ensure exact amount <b>₹${validity.price.toFixed(2)}</b> is transferred.
4️⃣ After payment, click <b>Check Payment Status</b> below.
━━━━━━━━━━━━━━━━━━━━
`.trim();

    const kb = keyboards.paymentPendingActions(payment.id);

    try {
      if (qrData.qrBuffer) {
        if (ctx.callbackQuery) {
          try {
            await ctx.deleteMessage();
          } catch {}
        }
        await ctx.replyWithPhoto(new InputFile(qrData.qrBuffer, 'upi_qr.png'), {
          caption: text,
          parse_mode: 'HTML',
          reply_markup: kb
        });
      } else {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: kb
        });
      }
    } catch {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: kb
      });
    }
  } catch (err: any) {
    console.error('Error generating direct UPI QR:', err);
    try {
      await ctx.editMessageText(`❌ <b>Failed to initiate UPI payment:</b> ${escapeHtml(err.message)}`, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToValidities(serviceId)
      });
    } catch {}
  }
}

/**
 * Handle Direct Binance Pay / USDT Checkout for Selected Product
 */
export async function handlePurchaseDirectBinance(ctx: Context, serviceId: string, validityId: string) {
  const from = ctx.from;
  if (!from) return;

  try {
    await ctx.answerCallbackQuery({ text: 'Opening Binance Pay...' });
  } catch {}

  try {
    const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);
    const service = serviceRepo.getById(serviceId);
    const validity = validityRepo.getById(validityId);

    if (!service || !validity) {
      return handleShopMenu(ctx);
    }

    const priceUsd = settingsRepo.calculateUsd(validity.price);
    const refId = 'BIN' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

    const binanceData = await binancePayService.generateOrderPayload(validity.price, priceUsd, refId);

    const payment = paymentRepo.create({
      userId: user.id,
      telegramId: from.id,
      paymentMethod: 'BINANCE_PAY',
      amount: validity.price,
      referenceId: refId,
      qrPayload: binanceData.merchantId,
      metadata: {
        serviceId,
        validityId,
        productName: service.name,
        validityName: validity.name,
        priceUsd,
        bep20: binanceData.bep20Address
      }
    });

    const text = `
🟡 <b>Binance Pay / USDT Checkout</b>

🎮 <b>Product:</b> ${escapeHtml(service.name)} (${escapeHtml(validity.name)})
💵 <b>Amount to Pay:</b> <b>$${priceUsd.toFixed(2)} USDT</b>
💵 <b>Equivalent INR:</b> ₹${validity.price.toFixed(2)}
🆔 <b>Payment ID:</b> <code>${payment.id}</code>

━━━━━━━━━━━━━━━━━━━━
📌 <b>Payment Steps:</b>

1️⃣ <b>Binance Pay ID:</b>
<code>${binanceData.merchantId || '433230697'}</code>

2️⃣ ${binanceData.bep20Address ? `<b>BEP-20 USDT Address:</b>\n<code>${binanceData.bep20Address}</code>\n\n3️⃣ ` : ''}Send exactly <b>$${priceUsd.toFixed(2)} USDT</b>.
${binanceData.bep20Address ? '4️⃣' : '3️⃣'} Copy the <b>Binance Order ID / TxID</b> from your payment receipt.
${binanceData.bep20Address ? '5️⃣' : '4️⃣'} Click <b>🔢 Enter Binance Order ID / Txn ID</b> below for instant key delivery!
━━━━━━━━━━━━━━━━━━━━
`.trim();

    const kb = keyboards.binancePaymentActions(payment.id);

    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: kb
        });
        return;
      } catch {}
    }

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: kb
    });
  } catch (err: any) {
    console.error('Error generating direct Binance payment:', err);
    try {
      await ctx.editMessageText(`❌ <b>Failed to initiate Binance payment:</b> ${escapeHtml(err.message)}`, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToValidities(serviceId)
      });
    } catch {}
  }
}

export function escapeHtml(str: any): string {
  if (str === undefined || str === null) return '';
  let text = typeof str === 'string' ? str : (typeof str === 'object' ? extractLicenseKeyString(str) : String(str));
  if (!text || text === '[object Object]') text = '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
