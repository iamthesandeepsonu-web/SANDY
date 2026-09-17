import crypto from 'crypto';
import axios, { AxiosRequestConfig } from 'axios';
import { binanceConfigService, BinanceCredentials } from './binanceConfigService.js';

export interface BinancePayTransaction {
  orderId: string;
  transactionId: string;
  amount: number;
  currency: string;
  payerName?: string;
  transactionTime: number;
  fundsDetail?: any[];
}

export interface BinanceOpenApiOrderResult {
  merchantTradeNo: string;
  prepayId?: string;
  transactionId?: string;
  status: string; // 'INITIAL', 'PENDING', 'PAID', 'CANCELED', 'ERROR', 'EXPIRED'
  orderAmount: number;
  currency: string;
  payerInfo?: {
    userId?: string;
    email?: string;
  };
  createTime?: number;
}

export const binanceApiService = {
  OPENAPI_BASE_URL: 'https://bpay.binanceapi.com',
  SAPI_BASE_URL: 'https://api.binance.com',

  generateNonce(length = 32): string {
    return crypto.randomBytes(length / 2).toString('hex');
  },

  generateOpenApiSignature(payload: string, secretKey: string, timestamp: number, nonce: string): string {
    const payloadToSign = timestamp + '\n' + nonce + '\n' + payload + '\n';
    return crypto.createHmac('sha512', secretKey).update(payloadToSign).digest('hex').toUpperCase();
  },

  generateSapiSignature(queryString: string, secretKey: string): string {
    return crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
  },

  async getServerTime(): Promise<{ serverTime: number; latencyMs: number }> {
    const start = Date.now();
    const res = await axios.get(`${this.SAPI_BASE_URL}/api/v3/time`, { timeout: 6000 });
    const latencyMs = Date.now() - start;
    return {
      serverTime: Number(res.data?.serverTime || Date.now()),
      latencyMs
    };
  },

  async fetchPayTransactions(
    credentials?: BinanceCredentials,
    options: { limit?: number; startTimestamp?: number; endTimestamp?: number } = {}
  ): Promise<BinancePayTransaction[]> {
    const creds = credentials || binanceConfigService.getConfig();
    if (!creds.apiKey || !creds.secretKey) {
      return [];
    }

    try {
      const timestamp = Date.now();
      const limit = options.limit || 100;
      let qs = `timestamp=${timestamp}&limit=${limit}`;
      if (options.startTimestamp) qs += `&startTimestamp=${options.startTimestamp}`;
      if (options.endTimestamp) qs += `&endTimestamp=${options.endTimestamp}`;

      const signature = this.generateSapiSignature(qs, creds.secretKey);
      const url = `${this.SAPI_BASE_URL}/sapi/v1/pay/transactions?${qs}&signature=${signature}`;

      const res = await axios.get(url, {
        headers: {
          'X-MBX-APIKEY': creds.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      });

      const txns = res.data?.data || [];
      return txns.map((t: any) => ({
        orderId: String(t.orderId || '').trim(),
        transactionId: String(t.transactionId || '').trim(),
        amount: parseFloat(t.amount || '0'),
        currency: String(t.currency || 'USDT').toUpperCase(),
        payerName: t.payerInfo?.name || t.payerInfo?.nickName || '',
        transactionTime: Number(t.transactionTime || t.time || 0),
        fundsDetail: t.fundsDetail || []
      }));
    } catch (err: any) {
      const errMsg = err.response?.data?.msg || err.response?.data?.message || err.message;
      console.error('Binance SAPI fetchPayTransactions error:', errMsg);
      throw new Error(`Binance SAPI Error: ${errMsg}`);
    }
  },

  async queryOpenApiOrder(
    merchantTradeNo: string,
    prepayId?: string,
    credentials?: BinanceCredentials
  ): Promise<BinanceOpenApiOrderResult | null> {
    const creds = credentials || binanceConfigService.getConfig();
    if (!creds.apiKey || !creds.secretKey) {
      return null;
    }

    const timestamp = Date.now();
    const nonce = this.generateNonce();
    const body: Record<string, any> = {};
    if (merchantTradeNo) body.merchantTradeNo = merchantTradeNo;
    if (prepayId) body.prepayId = prepayId;

    const payload = JSON.stringify(body);
    const signature = this.generateOpenApiSignature(payload, creds.secretKey, timestamp, nonce);

    try {
      const res = await axios.post(`${this.OPENAPI_BASE_URL}/binancepay/openapi/v2/order/query`, body, {
        headers: {
          'Content-Type': 'application/json',
          'BinancePay-Timestamp': timestamp,
          'BinancePay-Nonce': nonce,
          'BinancePay-Certificate-SN': creds.apiKey,
          'BinancePay-Signature': signature
        },
        timeout: 8000
      });

      const data = res.data?.data;
      if (!data) return null;

      return {
        merchantTradeNo: data.merchantTradeNo || merchantTradeNo,
        prepayId: data.prepayId,
        transactionId: data.transactionId,
        status: data.status,
        orderAmount: parseFloat(data.orderAmount || '0'),
        currency: String(data.currency || 'USDT').toUpperCase(),
        payerInfo: data.payerInfo,
        createTime: data.createTime
      };
    } catch (err: any) {
      const errDetail = err.response?.data || err.message;
      console.warn(`OpenAPI order query for ${merchantTradeNo} returned:`, errDetail);
      return null;
    }
  },

  async testConnectivity(credentials?: BinanceCredentials): Promise<{
    success: boolean;
    serverTimeOk: boolean;
    sapiAuthOk: boolean;
    openApiOk: boolean;
    transactionsCount: number;
    message: string;
    latencyMs: number;
  }> {
    const creds = credentials || binanceConfigService.getConfig();
    if (!creds.apiKey || !creds.secretKey) {
      return {
        success: false,
        serverTimeOk: false,
        sapiAuthOk: false,
        openApiOk: false,
        transactionsCount: 0,
        message: 'Binance API Key and Secret Key are required.',
        latencyMs: 0
      };
    }

    let serverTimeOk = false;
    let sapiAuthOk = false;
    let openApiOk = false;
    let transactionsCount = 0;
    let latencyMs = 0;

    // 1. Check Server Time & Connectivity
    try {
      const timeRes = await this.getServerTime();
      serverTimeOk = Boolean(timeRes.serverTime > 0);
      latencyMs = timeRes.latencyMs;
    } catch (e: any) {
      return {
        success: false,
        serverTimeOk: false,
        sapiAuthOk: false,
        openApiOk: false,
        transactionsCount: 0,
        message: `Network connectivity error: ${e.message}`,
        latencyMs: 0
      };
    }

    // 2. Test SAPI Pay Transactions Permissions
    try {
      const txns = await this.fetchPayTransactions(creds, { limit: 5 });
      sapiAuthOk = true;
      transactionsCount = txns.length;
    } catch (e: any) {
      return {
        success: false,
        serverTimeOk,
        sapiAuthOk: false,
        openApiOk: false,
        transactionsCount: 0,
        message: `SAPI Authentication Failed: ${e.message}`,
        latencyMs
      };
    }

    // 3. Test Binance Pay OpenAPI Reachability
    try {
      // Send diagnostic query for a test non-existent probe ID
      const timestamp = Date.now();
      const nonce = this.generateNonce();
      const body = { merchantTradeNo: 'DIAGNOSTIC_PROBE_' + Date.now() };
      const payload = JSON.stringify(body);
      const signature = this.generateOpenApiSignature(payload, creds.secretKey, timestamp, nonce);

      const probeRes = await axios.post(`${this.OPENAPI_BASE_URL}/binancepay/openapi/v2/order/query`, body, {
        headers: {
          'Content-Type': 'application/json',
          'BinancePay-Timestamp': timestamp,
          'BinancePay-Nonce': nonce,
          'BinancePay-Certificate-SN': creds.apiKey,
          'BinancePay-Signature': signature
        },
        timeout: 6000
      });

      // Status 200 or standard Binance Pay business response code indicates OpenAPI is active & responding
      if (probeRes.status === 200) {
        openApiOk = true;
      }
    } catch (e: any) {
      // 400 or 404 with standard Binance Pay error response code (e.g. 400002 / Order not found) means API gateway is reachable and signature was accepted
      if (e.response && (e.response.status === 400 || e.response.status === 404 || e.response.data?.code)) {
        openApiOk = true;
      } else {
        openApiOk = false;
      }
    }

    const allPassed = serverTimeOk && sapiAuthOk;
    return {
      success: allPassed,
      serverTimeOk,
      sapiAuthOk,
      openApiOk,
      transactionsCount,
      message: allPassed
        ? `🟢 Binance API Verified! Found ${transactionsCount} recent Pay transactions. (Latency: ${latencyMs}ms)`
        : 'Binance credentials validation failed.',
      latencyMs
    };
  }
};
