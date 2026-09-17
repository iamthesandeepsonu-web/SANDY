import { Context } from 'grammy';
import { userRepo } from '../../database/repositories/userRepo.js';
import { currencyService } from '../../services/currencyService.js';
import { keyboards } from '../keyboards.js';

export async function handleProfile(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name, from.language_code);
  const region = currencyService.detectUserRegion(from, user);
  const joinedDate = new Date(user.created_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const balanceFormatted = region.isIndia
    ? `₹${user.balance.toFixed(2)}`
    : `$${currencyService.inrToUsd(user.balance).toFixed(2)} USDT (~₹${user.balance.toFixed(2)})`;

  const spentFormatted = region.isIndia
    ? `₹${user.total_spent.toFixed(2)}`
    : `$${currencyService.inrToUsd(user.total_spent).toFixed(2)} USDT (~₹${user.total_spent.toFixed(2)})`;

  const text = `
👤 <b>User Profile & Account Information</b>

🆔 <b>User ID:</b> <code>${user.telegram_id}</code>
👤 <b>Name:</b> ${escapeHtml(user.first_name || 'N/A')}
🔰 <b>Account Type:</b> ${escapeHtml(user.account_type)}
💰 <b>Current Balance:</b> ${balanceFormatted}
📦 <b>Total Orders:</b> ${user.total_orders}
💳 <b>Total Amount Spent:</b> ${spentFormatted}
📅 <b>Joined Date:</b> ${joinedDate}
`.trim();

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboards.backToMain() });
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboards.backToMain() });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
