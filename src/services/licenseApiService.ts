import axios from 'axios';
import crypto from 'crypto';
import { settingsRepo } from '../database/repositories/settingsRepo.js';

export interface LdProduct {
  id: string;
  name: string;
  group_name?: string;
  category?: string;
  price?: number;
  currency?: string;
  in_stock: boolean;
  stock_count?: number;
  validity_days?: number;
}

export interface LdConnectionStatus {
  success: boolean;
  message: string;
  balance?: number;
  currency?: string;
  username?: string;
  lifetime_keys?: number;
  raw?: any;
}

export interface LdOrderResult {
  success: boolean;
  license_key?: string;
  license_keys?: string[];
  external_tx_id?: string;
  error_code?: 'OUT_OF_STOCK' | 'SERVER_ERROR' | 'INVALID_TOKEN' | 'PRODUCT_NOT_FOUND';
  error_message?: string;
}

export const licenseApiService = {
  getEndpoint(): string {
    const raw = settingsRepo.get('ld_api_endpoint', 'https://licencedashboard.shop/api/v1').trim();
    return raw.replace(/\/+$/, '');
  },

  getToken(): string {
    return settingsRepo.get('ld_api_token', 'ldk_ea19008d65d71e216ce765e6801d0d7684db7a8db385354e').trim();
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
      // Try /balance.php (License Dashboard API standard) or /status
      const balanceUrl = endpoint.includes('/api/v1') ? `${endpoint}/balance.php` : `${endpoint}/status`;
      
      const response = await axios.get(balanceUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const resData = response.data;
      if (resData && (resData.ok === true || resData.status === 'success')) {
        const balance = resData.data?.balance_raw !== undefined 
          ? Number(resData.data.balance_raw) 
          : Number(resData.data?.balance || resData.balance || 0);

        return {
          success: true,
          message: 'API Connected / Working',
          balance,
          currency: resData.data?.currency || resData.currency || 'USD',
          username: resData.data?.username,
          lifetime_keys: resData.data?.lifetime_keys,
          raw: resData
        };
      }

      return {
        success: false,
        message: resData?.message || resData?.error || 'API Connection Failed: Unexpected response structure'
      };
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.response?.data?.error || err.message || 'API Connection Failed';
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
      const catalogUrl = endpoint.includes('/api/v1') ? `${endpoint}/catalog.php` : `${endpoint}/products`;

      const response = await axios.get(catalogUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const resData = response.data;
      const flatProducts: LdProduct[] = [];

      // Case 1: Licence Dashboard groups structure: resData.data.groups[...].products[...]
      if (resData.ok && resData.data && Array.isArray(resData.data.groups)) {
        for (const group of resData.data.groups) {
          if (Array.isArray(group.products)) {
            for (const p of group.products) {
              flatProducts.push({
                id: String(p.id),
                name: p.name || `${group.group_name} (${p.validity_days || 1}D)`,
                group_name: group.group_name,
                category: group.group_name,
                price: p.price_raw !== undefined ? Number(p.price_raw) : Number(p.price || 0),
                currency: p.currency || 'USD',
                in_stock: Boolean(p.in_stock && (p.stock_count === undefined || p.stock_count > 0)),
                stock_count: p.stock_count !== undefined ? Number(p.stock_count) : 0,
                validity_days: p.validity_days
              });
            }
          }
        }
        return { success: true, products: flatProducts };
      }

      // Case 2: Standard products list: resData.products or resData.data
      const rawList = Array.isArray(resData.products) ? resData.products : (Array.isArray(resData.data) ? resData.data : []);
      if (rawList.length > 0) {
        for (const p of rawList) {
          flatProducts.push({
            id: String(p.id || p.product_id),
            name: p.name || p.title || `Product #${p.id}`,
            category: p.category || p.group_name,
            price: Number(p.price || p.price_raw || 0),
            currency: p.currency || 'USD',
            in_stock: p.in_stock !== undefined ? Boolean(p.in_stock) : true,
            stock_count: p.stock_count !== undefined ? Number(p.stock_count) : undefined,
            validity_days: p.validity_days
          });
        }
        return { success: true, products: flatProducts };
      }

      return {
        success: false,
        products: [],
        message: 'No products found in provider response'
      };
    } catch (err: any) {
      return {
        success: false,
        products: [],
        message: err.response?.data?.message || err.message || 'Failed to fetch provider products'
      };
    }
  },

  async checkStock(externalProductId: string): Promise<{
    success: boolean;
    in_stock: boolean;
    stock_count?: number;
    error_code?: 'OUT_OF_STOCK' | 'SERVER_ERROR' | 'INVALID_TOKEN' | 'PRODUCT_NOT_FOUND' | 'API_ERROR';
    error_message?: string;
  }> {
    const endpoint = this.getEndpoint();
    const token = this.getToken();

    if (!token) {
      return {
        success: false,
        in_stock: false,
        error_code: 'INVALID_TOKEN',
        error_message: 'License Provider API token is not configured.'
      };
    }

    try {
      const catalogResult = await this.getProducts();
      if (!catalogResult.success) {
        return {
          success: false,
          in_stock: false,
          error_code: 'SERVER_ERROR',
          error_message: catalogResult.message || 'Unable to connect to Service Provider. Please try again later.'
        };
      }

      const match = catalogResult.products.find(
        p => String(p.id).toLowerCase() === String(externalProductId).toLowerCase()
      );

      if (!match) {
        return {
          success: false,
          in_stock: false,
          error_code: 'PRODUCT_NOT_FOUND',
          error_message: `Product ID "${externalProductId}" not found in Provider catalog.`
        };
      }

      if (!match.in_stock || (match.stock_count !== undefined && match.stock_count <= 0)) {
        return {
          success: true,
          in_stock: false,
          stock_count: 0,
          error_code: 'OUT_OF_STOCK',
          error_message: 'External provider is currently out of stock.'
        };
      }

      return {
        success: true,
        in_stock: true,
        stock_count: match.stock_count
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.response?.data?.error || err.message || 'Service Provider is not responding or timed out.';
      return {
        success: false,
        in_stock: false,
        error_code: 'SERVER_ERROR',
        error_message: errMsg
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

    const generateUrl = endpoint.includes('/api/v1') ? `${endpoint}/generate.php` : `${endpoint}/order`;
    const numericPid = parseInt(externalProductId, 10);
    const pidPayload = isNaN(numericPid) ? externalProductId : numericPid;
    const idempotencyKey = crypto.randomBytes(8).toString('hex');

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const response = await axios.post(generateUrl, {
          product_id: pidPayload,
          quantity: 1,
          idempotency_key: idempotencyKey,
          client_order_id: clientOrderId
        }, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        });

        const resData = response.data;

        // Check if response is successful
        if (resData && (resData.ok === true || resData.status === 'success')) {
          let licenseKey = '';
          const keysList: string[] = [];

          if (Array.isArray(resData.data?.keys) && resData.data.keys.length > 0) {
            licenseKey = String(resData.data.keys[0]);
            keysList.push(...resData.data.keys.map(String));
          } else if (Array.isArray(resData.data) && resData.data.length > 0 && resData.data[0].key) {
            licenseKey = String(resData.data[0].key);
            keysList.push(...resData.data.map((item: any) => String(item.key)));
          } else if (resData.data?.license_key || resData.license_key) {
            licenseKey = String(resData.data?.license_key || resData.license_key);
            keysList.push(licenseKey);
          } else if (resData.data?.key) {
            licenseKey = String(resData.data.key);
            keysList.push(licenseKey);
          }

          if (licenseKey) {
            return {
              success: true,
              license_key: licenseKey,
              license_keys: keysList,
              external_tx_id: resData.data?.tx_id || resData.tx_id || 'LD_TX_' + Date.now()
            };
          }
        }

        // Check for out of stock error
        if (
          resData?.error_code === 'OUT_OF_STOCK' || 
          resData?.message?.toLowerCase().includes('out of stock') ||
          resData?.error?.toLowerCase().includes('out of stock') ||
          resData?.data?.in_stock === false
        ) {
          return {
            success: false,
            error_code: 'OUT_OF_STOCK',
            error_message: 'External provider is out of stock'
          };
        }

        return {
          success: false,
          error_code: 'SERVER_ERROR',
          error_message: resData?.message || resData?.error || 'Provider failed to generate license'
        };
      } catch (err: any) {
        // Rate limiting retry (429)
        if (err.response?.status === 429 && attempt < 4) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
          continue;
        }

        if (
          err.response?.status === 400 && 
          (err.response?.data?.error_code === 'OUT_OF_STOCK' || err.response?.data?.message?.toLowerCase().includes('stock'))
        ) {
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

    return {
      success: false,
      error_code: 'SERVER_ERROR',
      error_message: 'Server is not responding. Please try again later.'
    };
  }
};
