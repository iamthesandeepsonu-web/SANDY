import axios from 'axios';
import { settingsRepo } from '../database/repositories/settingsRepo.js';

export interface LdProduct {
  id: string;
  name: string;
  category?: string;
  price?: number;
  in_stock: boolean;
  stock_count?: number;
  validity?: string;
}

export interface LdConnectionStatus {
  success: boolean;
  message: string;
  balance?: number;
  currency?: string;
  raw?: any;
}

export interface LdOrderResult {
  success: boolean;
  license_key?: string;
  external_tx_id?: string;
  error_code?: 'OUT_OF_STOCK' | 'SERVER_ERROR' | 'INVALID_TOKEN' | 'PRODUCT_NOT_FOUND';
  error_message?: string;
}

export const licenseApiService = {
  getEndpoint(): string {
    return settingsRepo.get('ld_api_endpoint', 'http://localhost:3000/api/mock-ld').trim();
  },

  getToken(): string {
    return settingsRepo.get('ld_api_token', '').trim();
  },

  isConfigured(): boolean {
    return Boolean(this.getToken());
  },

  async testConnection(): Promise<LdConnectionStatus> {
    const endpoint = this.getEndpoint();
    const token = this.getToken();

    if (!token) {
      return {
        success: false,
        message: 'License Dashboard API token is not configured.'
      };
    }

    try {
      const response = await axios.get(`${endpoint}/status`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 6000
      });

      if (response.data && response.data.status === 'success') {
        return {
          success: true,
          message: 'API Connected / Working',
          balance: response.data.balance,
          currency: response.data.currency || 'USD',
          raw: response.data
        };
      }

      return {
        success: false,
        message: response.data?.message || 'API Connection Failed: Unexpected response structure'
      };
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || 'API Connection Failed';
      return {
        success: false,
        message: `API Connection Failed (${errorMsg})`
      };
    }
  },

  async checkBalance(): Promise<{ success: boolean; balance: number; currency: string; message?: string }> {
    const status = await this.testConnection();
    if (status.success) {
      return {
        success: true,
        balance: status.balance !== undefined ? status.balance : 0,
        currency: status.currency || 'USD'
      };
    }
    return {
      success: false,
      balance: 0,
      currency: 'USD',
      message: status.message
    };
  },

  async getProducts(): Promise<{ success: boolean; products: LdProduct[]; message?: string }> {
    const endpoint = this.getEndpoint();
    const token = this.getToken();

    if (!token) {
      return {
        success: false,
        products: [],
        message: 'API Token is missing'
      };
    }

    try {
      const response = await axios.get(`${endpoint}/products`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      });

      if (response.data && Array.isArray(response.data.products)) {
        return {
          success: true,
          products: response.data.products
        };
      }

      return {
        success: false,
        products: [],
        message: 'Invalid products data returned from provider'
      };
    } catch (err: any) {
      return {
        success: false,
        products: [],
        message: err.response?.data?.message || err.message || 'Failed to fetch provider products'
      };
    }
  },

  async orderProduct(externalProductId: string, clientOrderId: string): Promise<LdOrderResult> {
    const endpoint = this.getEndpoint();
    const token = this.getToken();

    if (!token) {
      return {
        success: false,
        error_code: 'INVALID_TOKEN',
        error_message: 'License Dashboard API token is missing'
      };
    }

    try {
      const response = await axios.post(`${endpoint}/order`, {
        product_id: externalProductId,
        client_order_id: clientOrderId,
        timestamp: Date.now()
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (response.data && response.data.status === 'success' && response.data.license_key) {
        return {
          success: true,
          license_key: response.data.license_key,
          external_tx_id: response.data.tx_id || 'LD_TX_' + Date.now()
        };
      }

      if (response.data && response.data.error_code === 'OUT_OF_STOCK') {
        return {
          success: false,
          error_code: 'OUT_OF_STOCK',
          error_message: 'External provider is out of stock'
        };
      }

      return {
        success: false,
        error_code: 'SERVER_ERROR',
        error_message: response.data?.message || 'Provider failed to generate license'
      };
    } catch (err: any) {
      if (err.response?.status === 400 && err.response?.data?.error_code === 'OUT_OF_STOCK') {
        return {
          success: false,
          error_code: 'OUT_OF_STOCK',
          error_message: 'External provider is out of stock'
        };
      }

      return {
        success: false,
        error_code: 'SERVER_ERROR',
        error_message: err.response?.data?.message || err.message || 'Server is not responding. Please try again later.'
      };
    }
  }
};
