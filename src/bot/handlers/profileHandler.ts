import { Context } from 'grammy';
import { userRepo } from '../../database/repositories/userRepo.js';
import { keyboards } from '../keyboards.js';

export async function handleProfile(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);
  const joinedDate = new Date(user.created_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const text = `
👤 <b>User Profile & Account Information</b>

🆔 <b>User ID:</b> <code>${user.telegram_id}</code>
👤 <b>Name:</b> ${escapeHtml(user.first_name || 'N/A')}
🔰 <b>Account Type:</b> ${escapeHtml(user.account_type)}
💰 <b>Current Balance:</b> ₹${user.balance.toFixed(2)}
📦 <b>Total Orders:</b> ${user.total_orders}
💳 <b>Total Amount Spent:</b> ₹${user.total_spent.toFixed(2)}
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
