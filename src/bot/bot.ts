import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config/index.js';
import { settingsRepo } from '../database/repositories/settingsRepo.js';
import { userRepo } from '../database/repositories/userRepo.js';
import { handleStart } from './handlers/startHandler.js';
import {
  handleShopMenu,
  handleServiceSelect,
  handleValiditySelect,
  handlePurchaseInr,
  handlePurchaseBinance
} from './handlers/shopHandler.js';
import { handleMyOrders } from './handlers/ordersHandler.js';
import { handleProfile } from './handlers/profileHandler.js';
import {
  handleWalletMenu,
  promptCustomAmount,
  handleCustomAmountText,
  handleSelectPaymentMethod,
  handleUpiPayment,
  handleBinancePayment,
  handleCheckPayment
} from './handlers/walletHandler.js';
import { handleSupport } from './handlers/supportHandler.js';
import {
  handleAdminCommand,
  handleAdminToggleMaintenance,
  isUserAdmin
} from './handlers/adminBotHandler.js';

export function createTelegramBot(): Bot | null {
  const token = config.bot.token;
  if (!token || !config.bot.isValidToken()) {
    console.log('ℹ️ Telegram Bot Token is not configured or in placeholder mode. Bot polling will run in mock/standby mode.');
    return null;
  }

  const bot = new Bot(token);

  // 1. User tracking middleware
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      userRepo.upsertFromTelegram(ctx.from.id, ctx.from.username, ctx.from.first_name);
    }
    await next();
  });

  // 2. Maintenance Mode Middleware
  bot.use(async (ctx, next) => {
    const isMaintenance = settingsRepo.getBoolean('maintenance_enabled', false);
    const fromId = ctx.from?.id;

    if (isMaintenance && !isUserAdmin(fromId)) {
      const message = settingsRepo.get(
        'maintenance_message',
        '⚠️ Store is currently under scheduled maintenance.\n\nPlease check back soon! For urgent queries, contact support.'
      );
      const supportUsername = settingsRepo.get('support_username', 'AlphaSupport').replace(/^@/, '');

      const kb = new InlineKeyboard()
        .url('🎧 Contact Support', `https://t.me/${supportUsername}`);

      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: 'Store is under maintenance.', show_alert: true });
        try {
          await ctx.editMessageText(message, { reply_markup: kb });
        } catch {
          await ctx.reply(message, { reply_markup: kb });
        }
        return;
      }

      await ctx.reply(message, { reply_markup: kb });
      return;
    }

    await next();
  });

  // Commands
  bot.command('start', handleStart);
  bot.command('admin', handleAdminCommand);

  // Text inputs (e.g. custom topup amount)
  bot.on('message:text', async (ctx) => {
    const handled = await handleCustomAmountText(ctx, ctx.message.text);
    if (!handled) {
      // Default to /start menu
      await handleStart(ctx);
    }
  });

  // Callback Queries Router
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    // Admin routes
    if (data === 'admin_panel' || data === 'admin_refresh') {
      return handleAdminCommand(ctx);
    }
    if (data === 'admin_toggle_maint') {
      return handleAdminToggleMaintenance(ctx);
    }

    // Main Menu routes
    if (data === 'menu_main') {
      return handleStart(ctx);
    }
    if (data === 'menu_shop') {
      return handleShopMenu(ctx);
    }
    if (data === 'menu_orders') {
      return handleMyOrders(ctx, 1);
    }
    if (data === 'menu_profile') {
      return handleProfile(ctx);
    }
    if (data === 'menu_wallet') {
      return handleWalletMenu(ctx);
    }
    if (data === 'menu_support') {
      return handleSupport(ctx);
    }

    // Orders Pagination
    if (data.startsWith('orders_page_')) {
      const page = parseInt(data.replace('orders_page_', ''), 10);
      return handleMyOrders(ctx, page || 1);
    }

    // Shop Flow
    if (data.startsWith('shop_srv_')) {
      const serviceId = data.replace('shop_srv_', '');
      return handleServiceSelect(ctx, serviceId);
    }
    if (data.startsWith('shop_val_')) {
      const parts = data.replace('shop_val_', '').split('_');
      // Format: shop_val_{serviceId}_{validityId}
      const serviceId = parts[0];
      const validityId = parts.slice(1).join('_');
      return handleValiditySelect(ctx, serviceId, validityId);
    }
    if (data.startsWith('pay_inr_topup_')) {
      const parts = data.replace('pay_inr_topup_', '').split('_');
      // Format: pay_inr_topup_{serviceId}_{validityId}_{amount}
      const amount = parseFloat(parts[2] || '100');
      return handleSelectPaymentMethod(ctx, amount);
    }
    if (data.startsWith('pay_inr_')) {
      const parts = data.replace('pay_inr_', '').split('_');
      const serviceId = parts[0];
      const validityId = parts.slice(1).join('_');
      return handlePurchaseInr(ctx, serviceId, validityId);
    }
    if (data.startsWith('pay_binance_')) {
      const parts = data.replace('pay_binance_', '').split('_');
      const serviceId = parts[0];
      const validityId = parts.slice(1).join('_');
      return handlePurchaseBinance(ctx, serviceId, validityId);
    }
    if (data.startsWith('buy_confirm_')) {
      const parts = data.replace('buy_confirm_', '').split('_');
      const serviceId = parts[0];
      const validityId = parts.slice(1).join('_');
      return handlePurchaseInr(ctx, serviceId, validityId);
    }

    // Wallet & Payments Flow
    if (data.startsWith('wallet_preset_')) {
      const amount = parseInt(data.replace('wallet_preset_', ''), 10);
      return handleSelectPaymentMethod(ctx, amount);
    }
    if (data.startsWith('wallet_topup_amount_')) {
      const amount = parseInt(data.replace('wallet_topup_amount_', ''), 10);
      return handleSelectPaymentMethod(ctx, amount);
    }
    if (data === 'wallet_custom_amount') {
      return promptCustomAmount(ctx);
    }
    if (data.startsWith('pay_method_upi_')) {
      const amount = parseFloat(data.replace('pay_method_upi_', ''));
      return handleUpiPayment(ctx, amount);
    }
    if (data.startsWith('pay_method_binance_')) {
      const amount = parseFloat(data.replace('pay_method_binance_', ''));
      return handleBinancePayment(ctx, amount);
    }
    if (data.startsWith('pay_check_')) {
      const paymentId = data.replace('pay_check_', '');
      return handleCheckPayment(ctx, paymentId);
    }

    await ctx.answerCallbackQuery();
  });

  bot.catch((err) => {
    console.error('Telegram Bot Error:', err);
  });

  return bot;
}
