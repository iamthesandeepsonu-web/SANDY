import { Context, InlineKeyboard } from 'grammy';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { keyboards } from '../keyboards.js';

export async function handleSupport(ctx: Context) {
  const supportUsername = settingsRepo.get('support_username', 'AlphaSupport');
  const cleanUsername = supportUsername.replace(/^@/, '');

  const text = `
🎧 <b>24/7 Customer Support</b>

Need help with an order, balance top-up, or license key issue?
Our dedicated support team is available around the clock to assist you!

💬 <b>Official Support:</b> @${cleanUsername}
⏰ <b>Response Time:</b> Usually within minutes
`.trim();

  const kb = new InlineKeyboard()
    .url('💬 Chat with Support Agent', `https://t.me/${cleanUsername}`)
    .row()
    .text('← Back to Main Menu', 'menu_main');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}
