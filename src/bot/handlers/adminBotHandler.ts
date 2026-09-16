import { Context, InlineKeyboard } from 'grammy';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { queryOne } from '../../database/db.js';
import { config } from '../../config/index.js';

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
