import crypto from 'crypto';
import { InlineKeyboard, GrammyError, HttpError } from 'grammy';
import { activeBot } from '../bot/bot.js';
import { db, queryAll, queryOne } from '../database/db.js';
import { config } from '../config/index.js';

export interface BroadcastOptions {
  message: string;
  photoUrl?: string;
  buttonText?: string;
  buttonUrl?: string;
  adminUsername?: string;
}

export interface BroadcastResult {
  id: string;
  totalTargets: number;
  sentCount: number;
  failedCount: number;
  blockedCount: number;
  status: string;
  durationSeconds: number;
}

export interface BroadcastCampaign {
  id: string;
  message: string;
  photo_url?: string;
  button_text?: string;
  button_url?: string;
  total_targets: number;
  sent_count: number;
  failed_count: number;
  status: string;
  created_by: string;
  created_at: string;
}

class BroadcastService {
  /**
   * Helper to build inline keyboard if button text and URL are specified
   */
  private buildInlineKeyboard(buttonText?: string, buttonUrl?: string): InlineKeyboard | undefined {
    if (buttonText && buttonUrl && buttonText.trim() && buttonUrl.trim()) {
      let finalUrl = buttonUrl.trim();
      if (!/^https?:\/\//i.test(finalUrl)) {
        finalUrl = 'https://' + finalUrl;
      }
      return new InlineKeyboard().url(buttonText.trim(), finalUrl);
    }
    return undefined;
  }

  /**
   * Send test broadcast to Admin only
   */
  async sendTestPreview(options: BroadcastOptions, targetTelegramId?: number): Promise<{ success: boolean; message: string }> {
    if (!activeBot || !activeBot.api) {
      throw new Error('Telegram Bot is not active. Make sure BOT_TOKEN is configured.');
    }

    const recipientId = targetTelegramId || config.admin.telegramIds[0];
    if (!recipientId) {
      throw new Error('No target Admin Telegram ID configured.');
    }

    const replyMarkup = this.buildInlineKeyboard(options.buttonText, options.buttonUrl);

    try {
      if (options.photoUrl && options.photoUrl.trim()) {
        await activeBot.api.sendPhoto(recipientId, options.photoUrl.trim(), {
          caption: options.message,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        });
      } else {
        await activeBot.api.sendMessage(recipientId, options.message, {
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        });
      }

      return {
        success: true,
        message: `✅ Test broadcast preview delivered successfully to Telegram ID: ${recipientId}`
      };
    } catch (err: any) {
      const errMsg = err.description || err.message || String(err);
      throw new Error(`Failed to send test preview: ${errMsg}`);
    }
  }

  /**
   * Mass Broadcast to All Registered Users with Safe Pacing
   */
  async sendBroadcast(options: BroadcastOptions): Promise<BroadcastResult> {
    if (!options.message || !options.message.trim()) {
      throw new Error('Broadcast message cannot be empty.');
    }

    // 1. Fetch all distinct telegram IDs
    const users = queryAll<{ telegram_id: number }>('SELECT DISTINCT telegram_id FROM users WHERE telegram_id IS NOT NULL');
    const targetIds = users.map(u => u.telegram_id).filter(Boolean);

    const campaignId = 'bc_' + crypto.randomBytes(6).toString('hex');
    const replyMarkup = this.buildInlineKeyboard(options.buttonText, options.buttonUrl);
    const startTime = Date.now();

    // 2. Insert initial campaign record
    try {
      db.prepare(`
        INSERT INTO broadcast_campaigns (id, message, photo_url, button_text, button_url, total_targets, sent_count, failed_count, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'IN_PROGRESS', ?, datetime('now'))
      `).run(
        campaignId,
        options.message,
        options.photoUrl?.trim() || null,
        options.buttonText?.trim() || null,
        options.buttonUrl?.trim() || null,
        targetIds.length,
        options.adminUsername || 'Admin'
      );
    } catch (e) {
      console.error('Failed to insert initial broadcast log:', e);
    }

    if (targetIds.length === 0) {
      db.prepare("UPDATE broadcast_campaigns SET status = 'COMPLETED' WHERE id = ?").run(campaignId);
      return {
        id: campaignId,
        totalTargets: 0,
        sentCount: 0,
        failedCount: 0,
        blockedCount: 0,
        status: 'COMPLETED',
        durationSeconds: 0
      };
    }

    let sentCount = 0;
    let failedCount = 0;
    let blockedCount = 0;

    // If bot instance is in standby/mock mode
    if (!activeBot || !activeBot.api) {
      console.log(`ℹ️ [BROADCAST] Active bot not running in background, simulated delivery for ${targetIds.length} users.`);
      sentCount = targetIds.length;
    } else {
      // 3. Batch processing (25 messages per batch with 1000ms delay to strictly respect Telegram 30 msg/s limit)
      const BATCH_SIZE = 25;
      for (let i = 0; i < targetIds.length; i += BATCH_SIZE) {
        const batch = targetIds.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (tgId) => {
            try {
              if (options.photoUrl && options.photoUrl.trim()) {
                await activeBot!.api.sendPhoto(tgId, options.photoUrl.trim(), {
                  caption: options.message,
                  parse_mode: 'HTML',
                  reply_markup: replyMarkup
                });
              } else {
                await activeBot!.api.sendMessage(tgId, options.message, {
                  parse_mode: 'HTML',
                  reply_markup: replyMarkup
                });
              }
              sentCount++;
            } catch (err: any) {
              failedCount++;
              if (err instanceof GrammyError) {
                if (err.description.includes('bot was blocked') || err.description.includes('user is deactivated')) {
                  blockedCount++;
                }
              }
            }
          })
        );

        // Pacing delay between batches if more targets remain
        if (i + BATCH_SIZE < targetIds.length) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    const durationSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));

    // 4. Update campaign status
    try {
      db.prepare(`
        UPDATE broadcast_campaigns 
        SET sent_count = ?, failed_count = ?, status = 'COMPLETED'
        WHERE id = ?
      `).run(sentCount, failedCount, campaignId);
    } catch (e) {
      console.error('Failed to update broadcast campaign record:', e);
    }

    console.log(`📢 [BROADCAST COMPLETED] ID: ${campaignId} | Targets: ${targetIds.length} | Sent: ${sentCount} | Failed: ${failedCount} | Blocked: ${blockedCount} (${durationSeconds}s)`);

    return {
      id: campaignId,
      totalTargets: targetIds.length,
      sentCount,
      failedCount,
      blockedCount,
      status: 'COMPLETED',
      durationSeconds
    };
  }

  /**
   * Get past broadcast campaign history
   */
  getHistory(limit = 20): BroadcastCampaign[] {
    return queryAll<BroadcastCampaign>(`
      SELECT * FROM broadcast_campaigns 
      ORDER BY created_at DESC 
      LIMIT ?
    `, limit);
  }
}

export const broadcastService = new BroadcastService();
