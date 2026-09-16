import { Context } from 'grammy';
import { orderRepo } from '../../database/repositories/orderRepo.js';
import { userRepo } from '../../database/repositories/userRepo.js';
import { keyboards } from '../keyboards.js';

const PAGE_SIZE = 5;

export async function handleMyOrders(ctx: Context, page = 1) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);
  const offset = (page - 1) * PAGE_SIZE;
  const { orders, total } = orderRepo.getByTelegramId(from.id, PAGE_SIZE, offset);

  if (total === 0) {
    const text = '📦 <b>My Orders</b>\n\nYou have not placed any orders yet.\n\nBrowse our catalog under <b>🛒 Shop Now</b> to get started!';
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboards.backToMain() });
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboards.backToMain() });
    return;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  let text = `📦 <b>My Orders (Page ${page} of ${totalPages} • Total: ${total})</b>\n\n`;

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const dateStr = new Date(o.created_at).toLocaleString();
    text += `<b>${i + 1 + offset}. ${escapeHtml(o.service_name)} — ${escapeHtml(o.validity_name)}</b>\n`;
    text += `├ <b>Order ID:</b> <code>${o.id}</code>\n`;
    text += `├ <b>Amount:</b> ₹${o.price_paid.toFixed(2)}\n`;
    text += `├ <b>Date:</b> ${dateStr}\n`;
    text += `└ <b>Key:</b> <code>${escapeHtml(o.license_key)}</code>\n\n`;
  }

  text += '<i>Tip: Tap any license key above to copy it to your clipboard.</i>';

  const kb = keyboards.ordersPagination(page, totalPages);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
