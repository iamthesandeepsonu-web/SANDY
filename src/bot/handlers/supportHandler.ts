import { Context, InlineKeyboard } from 'grammy';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';

export async function handleSupport(ctx: Context) {
  const supportUsername = settingsRepo.get('support_username', 'AlphaSupport');
  const cleanUsername = supportUsername.replace(/^@/, '');
  const customLink = settingsRepo.get('support_link', '');
  const supportUrl = customLink || (cleanUsername ? `https://t.me/${cleanUsername}` : 'https://t.me/AlphaSupport');
  
  const buttonLabel = settingsRepo.get('support_btn_text', '💬 Chat with Support Agent');
  const channelUrl = settingsRepo.get('support_channel_url', '');
  const channelLabel = settingsRepo.get('support_channel_label', '📢 Official Updates Channel');
  
  const customMessage = settingsRepo.get('support_message', '');
  
  let text = customMessage;
  if (!text) {
    text = `
🎧 <b>24/7 Customer Support</b>

Need help with an order, balance top-up, or license key issue?
Our dedicated support team is available around the clock to assist you!

💬 <b>Official Support:</b> ${cleanUsername ? '@' + cleanUsername : 'Support Team'}
⏰ <b>Response Time:</b> Usually within minutes
`.trim();
  }

  const kb = new InlineKeyboard()
    .url(buttonLabel || '💬 Chat with Support Agent', supportUrl);

  if (channelUrl) {
    kb.row().url(channelLabel || '📢 Official Updates Channel', channelUrl);
  }

  kb.row().text('← Back to Main Menu', 'menu_main');

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
      await ctx.answerCallbackQuery();
      return;
    } catch {}
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}
