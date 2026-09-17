import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { settingsRepo } from '../database/repositories/settingsRepo.js';
import { paymentRepo, Payment } from '../database/repositories/paymentRepo.js';
import { fulfillmentService } from './fulfillmentService.js';
import { activeBot } from '../bot/bot.js';
import { keyboards } from '../bot/keyboards.js';
import { escapeHtml } from '../bot/handlers/shopHandler.js';

export interface EmailUpiConfig {
  enabled: boolean;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string; // Google App Password (16 chars)
  merchantVpa: string;
  merchantName: string;
  timeoutMinutes: number;
}

export interface EmailWorkerStatus {
  isRunning: boolean;
  isConnected: boolean;
  lastCheckAt: string | null;
  lastError: string | null;
  processedCount: number;
  config: {
    enabled: boolean;
    imapUser: string;
    merchantVpa: string;
    merchantName: string;
    imapHost: string;
    timeoutMinutes: number;
  };
}

class EmailVerificationService {
  private client: ImapFlow | null = null;
  private isRunning: boolean = false;
  private isConnected: boolean = false;
  private lastCheckAt: string | null = null;
  private lastError: string | null = null;
  private processedCount: number = 0;
  private pollInterval: NodeJS.Timeout | null = null;
  private isChecking: boolean = false;
  private processedMessageIds = new Set<string>();
  private processedUtrs = new Set<string>();

  getConfig(): EmailUpiConfig {
    const enabled = settingsRepo.getBoolean('upi_email_enabled', true);
    const imapHost = settingsRepo.get('upi_imap_host', 'imap.gmail.com').trim();
    const imapPort = settingsRepo.getNumber('upi_imap_port', 993);
    const imapUser = settingsRepo.get('upi_imap_user', 'iamsandeepsonu@gmail.com').trim();
    const imapPassword = settingsRepo.get('upi_imap_password', 'nrdr syer ukpe mbit').trim().replace(/\s+/g, '');
    const merchantVpa = settingsRepo.get('upi_merchant_vpa', 'iamsandeepjha@fam').trim();
    const merchantName = settingsRepo.get('upi_merchant_name', 'SANDEEP KUMAR JHA').trim();
    const timeoutMinutes = settingsRepo.getNumber('upi_payment_timeout_min', 15);

    return {
      enabled,
      imapHost: imapHost || 'imap.gmail.com',
      imapPort: imapPort || 993,
      imapUser,
      imapPassword,
      merchantVpa,
      merchantName,
      timeoutMinutes: timeoutMinutes > 0 ? timeoutMinutes : 15
    };
  }

  getStatus(): EmailWorkerStatus {
    const cfg = this.getConfig();
    return {
      isRunning: this.isRunning,
      isConnected: this.isConnected,
      lastCheckAt: this.lastCheckAt,
      lastError: this.lastError,
      processedCount: this.processedCount,
      config: {
        enabled: cfg.enabled,
        imapUser: cfg.imapUser,
        merchantVpa: cfg.merchantVpa,
        merchantName: cfg.merchantName,
        imapHost: cfg.imapHost,
        timeoutMinutes: cfg.timeoutMinutes
      }
    };
  }

  async testConnection(testUser?: string, testPass?: string): Promise<{ success: boolean; message: string; mailCount?: number }> {
    const cfg = this.getConfig();
    const user = (testUser || cfg.imapUser).trim();
    const pass = (testPass || cfg.imapPassword).trim().replace(/\s+/g, '');

    if (!user || !pass) {
      return {
        success: false,
        message: 'Gmail User or App Password is missing.'
      };
    }

    const testClient = new ImapFlow({
      host: cfg.imapHost,
      port: cfg.imapPort,
      secure: true,
      auth: {
        user,
        pass
      },
      logger: false
    });

    try {
      await testClient.connect();
      const lock = await testClient.getMailboxLock('INBOX');
      const status = await testClient.status('INBOX', { messages: true, unseen: true });
      lock.release();
      await testClient.logout();

      return {
        success: true,
        message: '🟢 IMAP Connection Successful! Gmail inbox is reachable.',
        mailCount: status.messages
      };
    } catch (err: any) {
      return {
        success: false,
        message: 'IMAP Connection Failed: ' + (err.message || 'Authentication error. Verify 2-Step Verification & 16-digit App Password.')
      };
    }
  }

  async start() {
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      console.log('📧 UPI Email Verification Worker is disabled in settings.');
      return;
    }

    if (!cfg.imapUser || !cfg.imapPassword) {
      console.log('⚠️ UPI Email Verification Worker: Missing IMAP credentials.');
      return;
    }

    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log(`📧 Starting UPI Email Verification Worker for ${cfg.imapUser} (VPA: ${cfg.merchantVpa})...`);

    // Run immediate check
    this.checkEmails().catch(() => {});

    // Poll every 15 seconds as a reliable background heartbeat
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => {
      this.checkEmails().catch(() => {});
    }, 15000);
  }

  stop() {
    this.isRunning = false;
    this.isConnected = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.client) {
      try {
        this.client.logout().catch(() => {});
      } catch {}
      this.client = null;
    }
    console.log('🛑 UPI Email Verification Worker stopped.');
  }

  async restart() {
    this.stop();
    await new Promise(r => setTimeout(r, 1000));
    await this.start();
  }

  /**
   * Main Check & Verification Loop
   */
  async checkEmails(force: boolean = false) {
    if (this.isChecking) return;
    this.isChecking = true;

    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.imapUser || !cfg.imapPassword) {
      this.isChecking = false;
      return;
    }

    // Fetch pending payments (both UPI and Binance) from database within timeout window
    const pendingPayments = this.getPendingPayments(cfg.timeoutMinutes);
    if (!force && pendingPayments.length === 0) {
      this.isChecking = false;
      return;
    }

    const client = new ImapFlow({
      host: cfg.imapHost,
      port: cfg.imapPort,
      secure: true,
      auth: {
        user: cfg.imapUser,
        pass: cfg.imapPassword
      },
      logger: false
    });

    try {
      await client.connect();
      this.isConnected = true;
      this.lastError = null;
      this.lastCheckAt = new Date().toISOString();

      const lock = await client.getMailboxLock('INBOX');

      try {
        // Fetch emails from the last 20 minutes (or earliest pending payment)
        let oldestPendingTime = Date.now() - 20 * 60 * 1000;
        for (const p of pendingPayments) {
          const t = new Date(p.created_at).getTime();
          if (t < oldestPendingTime) oldestPendingTime = t;
        }

        const sinceDate = new Date(oldestPendingTime - 60 * 1000);
        const searchCriteria = { since: sinceDate };

        for await (const message of client.fetch(searchCriteria, { source: true, envelope: true, uid: true, flags: true })) {
          if (!message.source) continue;

          const parsed = await simpleParser(message.source);
          const messageId = message.envelope?.messageId || parsed.messageId || `msg_${message.uid}`;
          
          if (this.processedMessageIds.has(messageId)) {
            continue;
          }

          const messageDate = message.envelope?.date ? new Date(message.envelope.date) : (parsed.date ? new Date(parsed.date) : new Date());
          const subject = parsed.subject || '';
          const textContent = (parsed.text || '') + ' ' + (parsed.html ? parsed.html.replace(/<[^>]+>/g, ' ') : '');
          const fromAddress = parsed.from?.text || '';

          // Check if email looks like a UPI payment confirmation
          const isPaymentEmail = this.isPaymentNotification(subject, textContent, fromAddress);

          if (isPaymentEmail) {
            const emailDetails = this.extractPaymentDetails(subject, textContent);
            
            if (emailDetails.amount > 0) {
              // Check if this UTR was already completed in DB
              if (emailDetails.utr) {
                if (this.processedUtrs.has(emailDetails.utr)) {
                  this.processedMessageIds.add(messageId);
                  continue;
                }
                const utrExists = (paymentRepo as any).getByTransactionId ? (paymentRepo as any).getByTransactionId(emailDetails.utr) : null;
                if (utrExists && utrExists.status === 'COMPLETED') {
                  this.processedUtrs.add(emailDetails.utr);
                  this.processedMessageIds.add(messageId);
                  continue;
                }
              }

              // Match against pending payments strictly created BEFORE or AT this email time
              const matchedPayment = this.findMatchingPayment(pendingPayments, emailDetails, messageDate);

              if (matchedPayment) {
                console.log(`🎉 [UPI EMAIL WORKER] Matched Payment: ID ${matchedPayment.id}, Amount: ₹${matchedPayment.amount}, UTR: ${emailDetails.utr || 'AutoVerified'}`);
                
                // Complete payment in database
                const utr = emailDetails.utr || 'EMAIL_VERIFIED_' + Date.now();
                const completeResult = paymentRepo.completePayment(matchedPayment.id, utr);

                if (emailDetails.utr) {
                  this.processedUtrs.add(emailDetails.utr);
                }
                this.processedMessageIds.add(messageId);

                if (!completeResult.alreadyProcessed) {
                  this.processedCount++;
                  await this.fulfillAndNotify(matchedPayment.id);
                }

                // Remove from in-memory pending list to prevent double processing
                const idx = pendingPayments.findIndex(p => p.id === matchedPayment.id);
                if (idx !== -1) pendingPayments.splice(idx, 1);
              }
            }
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (err: any) {
      this.isConnected = false;
      this.lastError = err.message;
    } finally {
      this.isChecking = false;
    }
  }

  private getPendingPayments(timeoutMin: number): Payment[] {
    const listResult = paymentRepo.list({
      status: 'PENDING',
      limit: 100
    });

    const now = Date.now();
    const cutoff = now - timeoutMin * 60 * 1000;

    return listResult.payments.filter(p => {
      const createdTime = new Date(p.created_at).getTime();
      return createdTime >= cutoff;
    });
  }

  private isPaymentNotification(subject: string, text: string, from: string): boolean {
    const lowerSub = subject.toLowerCase();
    const lowerText = text.toLowerCase();
    const lowerFrom = from.toLowerCase();

    // Senders: FamPay, Trio, IDFC, Paytm, PhonePe, Google Pay, SBI, HDFC, ICICI, Kotak, Axis, etc.
    const knownKeywords = [
      'fampay',
      'trio',
      'credited',
      'received',
      'payment received',
      'money received',
      'account credited',
      'inward',
      'deposit',
      'utr'
    ];

    const hasKeyword = knownKeywords.some(kw => lowerSub.includes(kw) || lowerText.includes(kw) || lowerFrom.includes(kw));
    const hasAmountPattern = /(?:rs\.?|inr|₹)\s*[\d,]+|[\d,]+\s*(?:credited|received)/i.test(subject + ' ' + text);

    return hasKeyword && hasAmountPattern;
  }

  private extractPaymentDetails(subject: string, text: string): { amount: number; utr: string | null; refId: string | null } {
    const combined = subject + '\n' + text;

    // Extract Amount (e.g. ₹450, Rs. 450.00, INR 450, 450.00)
    let amount = 0;
    const amountRegexes = [
      /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
      /(?:credited\s+by|received|amount\s+of)\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /([\d,]+(?:\.\d{1,2})?)\s*(?:credited|received|deposited)/i
    ];

    for (const regex of amountRegexes) {
      const match = combined.match(regex);
      if (match && match[1]) {
        const cleanAmountStr = match[1].replace(/,/g, '');
        const parsedAmount = parseFloat(cleanAmountStr);
        if (!isNaN(parsedAmount) && parsedAmount > 0) {
          amount = parsedAmount;
          break;
        }
      }
    }

    // Extract 12-digit UTR / RRN
    let utr: string | null = null;
    const utrRegex = /(?:utr|rrn|ref(?:erence)?\s*(?:no|num|id)?|txn\s*id)[\s:]*([0-9]{12}|[A-Za-z0-9]{10,24})/i;
    const utrMatch = combined.match(utrRegex);
    if (utrMatch && utrMatch[1]) {
      utr = utrMatch[1].trim();
    }

    // Extract custom reference ID if present (e.g. UPI...)
    let refId: string | null = null;
    const refMatch = combined.match(/UPI[A-Z0-9]{6,20}/i);
    if (refMatch) {
      refId = refMatch[0].trim();
    }

    return { amount, utr, refId };
  }



  private findMatchingPayment(
    pendingPayments: Payment[],
    emailDetails: { amount: number; utr: string | null; refId: string | null },
    messageDate: Date
  ): Payment | null {
    const emailTime = messageDate.getTime();

    // 1. Direct Reference ID match (if customer passed ref in remark)
    if (emailDetails.refId) {
      const refMatch = pendingPayments.find(p => p.reference_id.toUpperCase() === emailDetails.refId?.toUpperCase());
      if (refMatch) return refMatch;
    }

    // 2. Exact amount match - STRICT RULE:
    // Email MUST have arrived AFTER the payment was created (with max 45s tolerance for server clock difference)
    const validTimeMatches = pendingPayments.filter(p => {
      const paymentCreatedTime = new Date(p.created_at).getTime();
      const isTimeValid = emailTime >= (paymentCreatedTime - 45_000);
      const isAmountValid = Math.abs(p.amount - emailDetails.amount) < 0.01;
      return isTimeValid && isAmountValid;
    });

    if (validTimeMatches.length === 1) {
      return validTimeMatches[0];
    } else if (validTimeMatches.length > 1) {
      // Sort by closest creation time to email timestamp
      validTimeMatches.sort((a, b) => {
        const diffA = Math.abs(new Date(a.created_at).getTime() - emailTime);
        const diffB = Math.abs(new Date(b.created_at).getTime() - emailTime);
        return diffA - diffB;
      });
      return validTimeMatches[0];
    }

    return null;
  }

  private async fulfillAndNotify(paymentId: string) {
    try {
      const payment = paymentRepo.getById(paymentId);
      if (!payment) return;

      let meta: any = {};
      if (payment.metadata) {
        try {
          meta = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
        } catch {}
      }

      if (meta && meta.serviceId && meta.validityId && !meta.orderId) {
        const result = await fulfillmentService.processPurchase(payment.user_id, meta.serviceId, meta.validityId);
        if (result.success && result.order) {
          const order = result.order;
          const licenseKey = result.licenseKey || order.license_key;
          paymentRepo.updateMetadata(payment.id, {
            ...meta,
            orderId: order.id,
            licenseKey
          });

          if (activeBot && payment.telegram_id) {
            const text = `
🎉 <b>Payment Auto-Verified & Order Fulfilled!</b>

📦 <b>Order ID:</b> <code>${order.id}</code>
🎮 <b>Product:</b> ${escapeHtml(order.service_name)}
⏳ <b>Validity:</b> ${escapeHtml(order.validity_name)}
💰 <b>Amount Paid:</b> ₹${order.price_paid.toFixed(2)}

🔑 <b>Your License Key:</b>
<code>${escapeHtml(licenseKey)}</code>

<i>💡 Tap on the license key above to copy it instantly. Save this message for your reference.</i>
`.trim();

            await activeBot.api.sendMessage(payment.telegram_id, text, {
              parse_mode: 'HTML',
              reply_markup: keyboards.mainMenu()
            }).catch(() => {});
          }
        }
      } else if (activeBot && payment.telegram_id) {
        await activeBot.api.sendMessage(
          payment.telegram_id,
          `🎉 <b>Payment Auto-Verified!</b>\n\n<b>₹${payment.amount.toFixed(2)}</b> has been credited to your wallet balance.\n\nUse <b>🛒 Shop Now</b> to purchase digital keys!`,
          {
            parse_mode: 'HTML',
            reply_markup: keyboards.mainMenu()
          }
        ).catch(() => {});
      }
    } catch (err) {
      console.error('Error during auto-fulfillment notification:', err);
    }
  }
}

export const emailVerificationService = new EmailVerificationService();
