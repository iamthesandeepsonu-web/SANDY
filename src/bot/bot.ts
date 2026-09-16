import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config/index.js';
import { settingsRepo } from '../database/repositories/settingsRepo.js';
import { userRepo } from '../database/repositories/userRepo.js';
import { serviceRepo } from '../database/repositories/serviceRepo.js';
import { handleStart } from './handlers/startHandler.js';
import {
  handleShopMenu,
  handleServiceSelect,
  handleValiditySelect,
  handlePurchaseInr,
  handlePurchaseDirectUpi,
  handlePurchaseDirectBinance
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

function parseServiceAndValidity(data: string, prefixes: string[]): { serviceId: string; validityId: string } {
  let raw = data;
  for (const prefix of prefixes) {
    if (raw.startsWith(prefix)) {
      raw = raw.slice(prefix.length);
      break;
    }
  }

  // 1. Explicit '::' delimiter
  if (raw.includes('::')) {
    const [serviceId, validityId] = raw.split('::');
    return { serviceId: serviceId || '', validityId: validityId || '' };
  }

  // 2. Search against database services to accurately match IDs containing '_' (e.g. srv_apple)
  const allServices = serviceRepo.getAll();
  for (const srv of allServices) {
    if (raw.startsWith(srv.id + '_')) {
      const validityId = raw.slice(srv.id.length + 1);
      return { serviceId: srv.id, validityId };
    }
    if (raw === srv.id) {
      return { serviceId: srv.id, validityId: '' };
    }
  }

  // 3. Last resort: split at first underscore
  const firstUnderscore = raw.indexOf('_');
  if (firstUnderscore !== -1) {
    return {
      serviceId: raw.substring(0, firstUnderscore),
      validityId: raw.substring(firstUnderscore + 1)
    };
  }

  return { serviceId: raw, validityId: '' };
}

export let activeBot: Bot | null = null;

export function createTelegramBot(): Bot | null {
  const token = config.bot.token;
  if (!token || !config.bot.isValidToken()) {
    console.log('ℹ️ Telegram Bot Token is not configured or in placeholder mode. Bot polling will run in mock/standby mode.');
    return null;
  }

  const bot = new Bot(token);
  activeBot = bot;

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
    if (data.startsWith('shop_srv::') || data.startsWith('shop_srv_')) {
      const serviceId = data.startsWith('shop_srv::') ? data.replace('shop_srv::', '') : data.replace('shop_srv_', '');
      return handleServiceSelect(ctx, serviceId);
    }

    if (data.startsWith('shop_val::') || data.startsWith('shop_val_')) {
      const { serviceId, validityId } = parseServiceAndValidity(data, ['shop_val::', 'shop_val_']);
      return handleValiditySelect(ctx, serviceId, validityId);
    }

    if (data.startsWith('pay_direct_upi::') || data.startsWith('pay_direct_upi_')) {
      const { serviceId, validityId } = parseServiceAndValidity(data, ['pay_direct_upi::', 'pay_direct_upi_']);
      return handlePurchaseDirectUpi(ctx, serviceId, validityId);
    }

    if (data.startsWith('pay_direct_binance::') || data.startsWith('pay_direct_binance_')) {
      const { serviceId, validityId } = parseServiceAndValidity(data, ['pay_direct_binance::', 'pay_direct_binance_']);
      return handlePurchaseDirectBinance(ctx, serviceId, validityId);
    }

    if (data.startsWith('pay_inr_topup_')) {
      const parts = data.replace('pay_inr_topup_', '').split('_');
      // Format: pay_inr_topup_{serviceId}_{validityId}_{amount}
      const amount = parseFloat(parts[parts.length - 1] || '100');
      return handleSelectPaymentMethod(ctx, amount);
    }

    if (data.startsWith('pay_inr::') || data.startsWith('pay_inr_')) {
      const { serviceId, validityId } = parseServiceAndValidity(data, ['pay_inr::', 'pay_inr_']);
      return handlePurchaseInr(ctx, serviceId, validityId);
    }

    if (data.startsWith('pay_binance::') || data.startsWith('pay_binance_')) {
      const { serviceId, validityId } = parseServiceAndValidity(data, ['pay_binance::', 'pay_binance_']);
      return handlePurchaseDirectBinance(ctx, serviceId, validityId);
    }

    if (data.startsWith('buy_confirm::') || data.startsWith('buy_confirm_')) {
      const { serviceId, validityId } = parseServiceAndValidity(data, ['buy_confirm::', 'buy_confirm_']);
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
