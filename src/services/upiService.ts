import QRCode from 'qrcode';
import { settingsRepo } from '../database/repositories/settingsRepo.js';

export interface UpiConfig {
  merchantVpa: string;
  merchantName: string;
  webhookSecret: string;
  isConfigured: boolean;
}

export const upiService = {
  getConfig(): UpiConfig {
    const merchantVpa = settingsRepo.get('upi_merchant_vpa', 'merchant@upi');
    const merchantName = settingsRepo.get('upi_merchant_name', 'Digital Keys Store');
    const webhookSecret = settingsRepo.get('upi_webhook_secret', 'upi_secret_key_123');
    const isConfigured = settingsRepo.getBoolean('upi_is_configured', true);

    return {
      merchantVpa,
      merchantName,
      webhookSecret,
      isConfigured: isConfigured && Boolean(merchantVpa)
    };
  },

  generateUpiPayload(amount: number, referenceId: string): string {
    const cfg = this.getConfig();
    const encodedName = encodeURIComponent(cfg.merchantName);
    const encodedVpa = encodeURIComponent(cfg.merchantVpa);
    const amountStr = amount.toFixed(2);

    // Standard NPCI UPI URI Specification
    return `upi://pay?pa=${encodedVpa}&pn=${encodedName}&am=${amountStr}&cu=INR&tr=${referenceId}&tn=Wallet_Topup_${referenceId}`;
  },

  async generateUpiQr(amount: number, referenceId: string): Promise<{
    payload: string;
    qrDataUrl: string;
    qrBuffer: Buffer;
    vpa: string;
    merchantName: string;
    amount: number;
    referenceId: string;
  }> {
    const payload = this.generateUpiPayload(amount, referenceId);
    const cfg = this.getConfig();

    const qrDataUrl = await QRCode.toDataURL(payload, {
      margin: 2,
      width: 320,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    const qrBuffer = await QRCode.toBuffer(payload, {
      margin: 2,
      width: 320,
      type: 'png'
    });

    return {
      payload,
      qrDataUrl,
      qrBuffer,
      vpa: cfg.merchantVpa,
      merchantName: cfg.merchantName,
      amount,
      referenceId
    };
  }
};
