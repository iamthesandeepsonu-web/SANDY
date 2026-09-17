import crypto from 'crypto';
import { paymentRepo } from '../../database/repositories/paymentRepo.js';
import { auditRepo } from '../../database/repositories/auditRepo.js';
import { binanceConfigService } from './binanceConfigService.js';
import { binanceVerificationService } from './binanceVerificationService.js';
import { activeBot } from '../../bot/bot.js';
import { keyboards } from '../../bot/keyboards.js';
import { escapeHtml } from '../../bot/handlers/shopHandler.js';

export const binanceWebhookService = {
  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
    const creds = binanceConfigService.getConfig();
    if (!creds.secretKey) return false;

    const timestamp = String(headers['binancepay-timestamp'] || headers['Binancepay-Timestamp'] || headers['binancePay-timestamp'] || '');
    const nonce = String(headers['binancepay-nonce'] || headers['Binancepay-Nonce'] || headers['binancePay-nonce'] || '');
    const signature = String(headers['binancepay-signature'] || headers['Binancepay-Signature'] || headers['binancePay-signature'] || '');

    if (!timestamp || !nonce || !signature) {
      return false;
    }

    const payloadToSign = timestamp + '\n' + nonce + '\n' + rawBody + '\n';
    const computedSignature = crypto.createHmac('sha512', creds.secretKey).update(payloadToSign).digest('hex').toUpperCase();

    return computedSignature === signature.toUpperCase();
  },

  async handleWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<{
    returnCode: string;
    returnMessage: string | null;
  }> {
    // 1. Signature Verification
    const isValidSignature = this.verifySignature(rawBody, headers);
    if (!isValidSignature) {
      console.warn('Binance Webhook Signature Verification Failed');
      return {
        returnCode: 'FAIL',
        returnMessage: 'Invalid signature'
      };
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { returnCode: 'FAIL', returnMessage: 'Invalid JSON payload' };
    }

    const { bizType, bizId, bizStatus, data } = payload;
    let eventData: any = {};
    if (typeof data === 'string') {
      try {
        eventData = JSON.parse(data);
      } catch {}
    } else if (typeof data === 'object') {
      eventData = data;
    }

    const merchantTradeNo = eventData.merchantTradeNo || eventData.prepayId || bizId;
    const transId = eventData.transId || bizId;
    const totalFee = parseFloat(eventData.totalFee || eventData.orderAmount || '0');
    const currency = String(eventData.currency || 'USDT').toUpperCase();

    auditRepo.logBinanceEvent({
      paymentId: merchantTradeNo || 'WEBHOOK',
      referenceId: merchantTradeNo || 'N/A',
      binanceOrderId: transId,
      eventType: 'WEBHOOK_RECEIVED',
      amountUsd: totalFee,
      status: bizStatus || 'RECEIVED',
      details: `Received Binance Webhook: ${bizType} | Status: ${bizStatus} | Amount: ${totalFee} ${currency}`
    });

    // We only process successful payment events
    if (bizStatus !== 'PAY_SUCCESS' && bizStatus !== 'PAYMENT_SUCCESS' && bizStatus !== 'SUCCESS') {
      return { returnCode: 'SUCCESS', returnMessage: null };
    }

    // 2. Identify Internal Payment Record
    const payment = merchantTradeNo ? paymentRepo.getByReferenceId(merchantTradeNo) : null;
    if (!payment) {
      console.warn(`Binance Webhook: Payment record not found for reference ${merchantTradeNo}`);
      return { returnCode: 'SUCCESS', returnMessage: null };
    }

    // 3. Idempotent Verification & Fulfillment
    if (payment.status === 'COMPLETED') {
      return { returnCode: 'SUCCESS', returnMessage: null };
    }

    const verifyResult = await binanceVerificationService.verifyAndClaimPayment(
      payment.id,
      transId || merchantTradeNo,
      String(payment.telegram_id)
    );

    if (verifyResult.success && activeBot && payment.telegram_id) {
      try {
        if (verifyResult.isOrderFulfilled && verifyResult.order) {
          const order = verifyResult.order;
          const key = verifyResult.licenseKey || order.license_key;
          const successMsg = `
🎉 <b>Payment Confirmed & Key Delivered!</b>

📦 <b>Order ID:</b> <code>${order.id}</code>
🎮 <b>Product:</b> ${escapeHtml(order.service_name)}
⏳ <b>Validity:</b> ${escapeHtml(order.validity_name)}
🔢 <b>Binance Txn ID:</b> <code>${escapeHtml(transId || merchantTradeNo)}</code>

🔑 <b>Your License Key:</b>
<code>${escapeHtml(key)}</code>

<i>💡 Tap on the license key above to copy it instantly.</i>
`.trim();
          await activeBot.api.sendMessage(payment.telegram_id, successMsg, {
            parse_mode: 'HTML',
            reply_markup: keyboards.mainMenu()
          });
        } else {
          await activeBot.api.sendMessage(
            payment.telegram_id,
            `🎉 <b>Binance Payment Verified!</b>\n\n$${totalFee.toFixed(2)} USDT (₹${payment.amount.toFixed(2)}) has been credited to your wallet balance.\n\nUse <b>🛒 Shop Now</b> to purchase keys!`,
            {
              parse_mode: 'HTML',
              reply_markup: keyboards.mainMenu()
            }
          );
        }
      } catch (err) {
        console.error('Error sending Telegram notification after webhook fulfillment:', err);
      }
    }

    return {
      returnCode: 'SUCCESS',
      returnMessage: null
    };
  }
};
