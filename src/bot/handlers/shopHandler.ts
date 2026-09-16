import { Context } from 'grammy';
import { serviceRepo } from '../../database/repositories/serviceRepo.js';
import { validityRepo } from '../../database/repositories/validityRepo.js';
import { userRepo } from '../../database/repositories/userRepo.js';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { fulfillmentService } from '../../services/fulfillmentService.js';
import { keyboards } from '../keyboards.js';

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
  const usdRate = settingsRepo.getUsdRate();

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

  // Shows only: Validity | INR Price | USD Price
  const kb = keyboards.validitiesList(serviceId, validities, usdRate);
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  await ctx.answerCallbackQuery();
}

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

  const priceUsd = settingsRepo.calculateUsd(validity.price);

  const balanceStatus = user.balance >= validity.price
    ? `✅ <i>Sufficient balance (₹${user.balance.toFixed(2)})</i>`
    : `⚠️ <i>Insufficient balance. Need ₹${(validity.price - user.balance).toFixed(2)} more.</i>`;

  const text = `
📦 <b>Product Checkout Summary</b>

🔹 <b>Product:</b> ${escapeHtml(service.name)}
🔹 <b>Validity:</b> ${escapeHtml(validity.name)}
💰 <b>Price:</b> ₹${validity.price.toFixed(2)} ($${priceUsd.toFixed(2)})

👤 <b>Your Balance:</b> ₹${user.balance.toFixed(2)}
${balanceStatus}
`.trim();

  const kb = keyboards.purchaseConfirm(serviceId, validityId, validity.price, priceUsd, user.balance);
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  await ctx.answerCallbackQuery();
}

export async function handlePurchaseConfirm(ctx: Context, serviceId: string, validityId: string) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);

  // Notify user that request is processing
  await ctx.answerCallbackQuery({ text: 'Processing your order securely...' });

  const result = await fulfillmentService.processPurchase(user.id, serviceId, validityId);

  if (!result.success) {
    if (result.errorCode === 'INSUFFICIENT_BALANCE') {
      const validity = validityRepo.getById(validityId);
      const price = validity ? validity.price : 0;
      await ctx.editMessageText(
        `❌ <b>Insufficient Balance</b>\n\nYour current wallet balance is <b>₹${user.balance.toFixed(2)}</b>, but this product costs <b>₹${price.toFixed(2)}</b>.\n\nPlease top up your wallet to continue.`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboards.paymentMethods(price)
        }
      );
      return;
    }

    if (result.errorCode === 'OUT_OF_STOCK') {
      await ctx.editMessageText(
        '⚠️ <b>Out of Stock</b>\n\nSorry, this product is currently out of stock. Please check back later or choose another option.',
        {
          parse_mode: 'HTML',
          reply_markup: keyboards.servicesList(serviceRepo.getAll(true))
        }
      );
      return;
    }

    await ctx.editMessageText(
      `⚠️ <b>Notice</b>\n\n${escapeHtml(result.errorMessage || 'Server not responding. Please try again.')}`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToMain()
      }
    );
    return;
  }

  // SUCCESSFUL PURCHASE
  const order = result.order!;
  const licenseKey = result.licenseKey || order.license_key;

  const text = `
🎉 <b>Order Successful!</b>

📦 <b>Order ID:</b> <code>${order.id}</code>
🎮 <b>Product:</b> ${escapeHtml(order.service_name)}
⏱️ <b>Validity:</b> ${escapeHtml(order.validity_name)}
💰 <b>Amount Paid:</b> ₹${order.price_paid.toFixed(2)}
📅 <b>Date:</b> ${new Date(order.created_at).toLocaleString()}

🔑 <b>Your License Key / Digital Code:</b>
<code>${escapeHtml(licenseKey)}</code>

<i>(Tap the key above to copy it instantly)</i>

Thank you for your purchase! You can view your keys anytime under <b>📦 My Orders</b>.
`.trim();

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: keyboards.mainMenu()
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
