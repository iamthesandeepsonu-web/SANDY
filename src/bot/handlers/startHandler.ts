import { Context } from 'grammy';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { userRepo } from '../../database/repositories/userRepo.js';
import { keyboards } from '../keyboards.js';

export async function handleStart(ctx: Context) {
  const from = ctx.from;
  if (!from) return;

  const user = userRepo.upsertFromTelegram(from.id, from.username, from.first_name);
  const brandName = settingsRepo.get('brand_name', 'ALPHA DIGITAL STORE');
  const userName = from.first_name || from.username || 'Valued Customer';

  const message = `
<b>${escapeHtml(brandName)}</b>

Hello, <b>${escapeHtml(userName)}</b>!

⚡ <b>Digital Keys Delivered in Seconds</b>
🎧 <b>24/7 Active Support</b>
🔒 <b>100% Secure Payment</b>
🎮 <b>Premium Game Keys</b>
🚀 <b>Instant Delivery 24/7</b>
`.trim();

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu()
      });
      await ctx.answerCallbackQuery();
      return;
    } catch {
      // Fallback to sending new message if edit fails
    }
  }

  await ctx.reply(message, {
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
