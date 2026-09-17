import { settingsRepo } from '../database/repositories/settingsRepo.js';
import { User } from '../database/repositories/userRepo.js';

export interface CurrencyDetails {
  currency: 'INR' | 'USDT';
  isIndia: boolean;
  symbol: string;
}

export interface ResolvedGatewayAmount {
  payableAmount: number;
  payableCurrency: 'INR' | 'USDT';
  amountInr: number;
  amountUsd: number;
  displayPayable: string;
}

export const currencyService = {
  getUsdRate(): number {
    return settingsRepo.getUsdRate();
  },

  inrToUsd(amountInr: number): number {
    const rate = this.getUsdRate();
    if (rate <= 0) return 0;
    return parseFloat((amountInr / rate).toFixed(2));
  },

  usdToInr(amountUsd: number): number {
    const rate = this.getUsdRate();
    return parseFloat((amountUsd * rate).toFixed(2));
  },

  /**
   * Determine user's default region and currency.
   * India => INR (₹)
   * Non-India => USDT ($)
   */
  detectUserRegion(telegramUser?: { language_code?: string }, storedUser?: User | null): CurrencyDetails {
    const lang = (telegramUser?.language_code || (storedUser as any)?.language_code || '').toLowerCase().trim();

    // Known non-Indian language codes & locales
    const nonIndianLocales = [
      'ru', 'uk', 'uz', 'fa', 'ar', 'es', 'de', 'fr', 'id', 'vi', 
      'tr', 'zh', 'ja', 'ko', 'pt', 'it', 'pl', 'nl', 'th', 'en-us', 
      'en-gb', 'en-ca', 'en-au', 'en-nz', 'en-za', 'az', 'kk', 'ky', 'tg'
    ];

    const isExplicitlyInternational = nonIndianLocales.some(
      code => lang === code || lang.startsWith(code + '-') || lang.startsWith(code + '_')
    );

    // If explicit non-Indian language detected, user is outside India -> USDT
    // Otherwise defaults to India -> INR
    const isIndia = !isExplicitlyInternational;

    return {
      currency: isIndia ? 'INR' : 'USDT',
      isIndia,
      symbol: isIndia ? '₹' : '$'
    };
  },

  formatAmount(amount: number, currency: 'INR' | 'USD' | 'USDT'): string {
    if (currency === 'INR') {
      return `₹${amount.toFixed(2)}`;
    }
    return `$${amount.toFixed(2)} ${currency}`;
  },

  /**
   * IMPORTANT PRIORITY RULE:
   * Payment Gateway Currency > User Default Currency
   *
   * UPI = INR (Always payable in INR)
   * Binance = USD/USDT (Always payable in USD/USDT)
   */
  resolveGatewayAmount(
    amount: number,
    fromCurrency: 'INR' | 'USD' | 'USDT',
    gateway: 'UPI_AUTO' | 'BINANCE_PAY'
  ): ResolvedGatewayAmount {
    let inr: number;
    let usd: number;

    if (fromCurrency === 'INR') {
      inr = amount;
      usd = this.inrToUsd(amount);
    } else {
      usd = amount;
      inr = this.usdToInr(amount);
    }

    if (gateway === 'UPI_AUTO') {
      return {
        payableAmount: inr,
        payableCurrency: 'INR',
        amountInr: inr,
        amountUsd: usd,
        displayPayable: `₹${inr.toFixed(2)}`
      };
    } else {
      return {
        payableAmount: usd,
        payableCurrency: 'USDT',
        amountInr: inr,
        amountUsd: usd,
        displayPayable: `$${usd.toFixed(2)} USDT`
      };
    }
  }
};
