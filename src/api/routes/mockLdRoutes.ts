import { Router } from 'express';
import crypto from 'crypto';

export const mockLdRoutes = Router();

// Simulated provider catalog
const mockCatalog = [
  { id: 'LD_PROD_APPLE_1D', name: 'Apple VIP Key (1 Day)', category: 'Gaming', price: 3.5, in_stock: true, stock_count: 95 },
  { id: 'LD_PROD_APPLE_7D', name: 'Apple VIP Key (7 Days)', category: 'Gaming', price: 7.2, in_stock: true, stock_count: 50 },
  { id: 'LD_PROD_APPLE_30D', name: 'Apple VIP Key (30 Days)', category: 'Gaming', price: 18.0, in_stock: true, stock_count: 24 },
  { id: 'LD_PROD_BGMI_1D', name: 'BGMI Undetected Pass (1 Day)', category: 'Mobile Gaming', price: 2.8, in_stock: true, stock_count: 120 },
  { id: 'LD_PROD_BGMI_7D', name: 'BGMI Undetected Pass (7 Days)', category: 'Mobile Gaming', price: 8.5, in_stock: true, stock_count: 42 },
  { id: 'LD_PROD_FREEFIRE_30D', name: 'FreeFire Pro Pass (30 Days)', category: 'Mobile Gaming', price: 12.0, in_stock: false, stock_count: 0 }
];

let mockProviderBalance = 4850.50;

// Provider status & connection check
mockLdRoutes.get('/status', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.includes('Bearer ')) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized: Missing API Token' });
  }

  return res.json({
    status: 'success',
    provider: 'LicenseDashboard Global API v2.4',
    balance: mockProviderBalance,
    currency: 'USD',
    uptime: '99.98%'
  });
});

// Provider product catalog
mockLdRoutes.get('/products', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.includes('Bearer ')) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized: Missing API Token' });
  }

  return res.json({
    status: 'success',
    products: mockCatalog
  });
});

// Provider order / key issuance
mockLdRoutes.post('/order', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.includes('Bearer ')) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized: Missing API Token' });
  }

  const { product_id, client_order_id } = req.body;
  const product = mockCatalog.find(p => p.id === product_id);

  if (!product) {
    return res.status(404).json({
      status: 'error',
      error_code: 'PRODUCT_NOT_FOUND',
      message: 'Specified product ID not found in license catalog'
    });
  }

  if (!product.in_stock || (product.stock_count !== undefined && product.stock_count <= 0)) {
    return res.status(400).json({
      status: 'error',
      error_code: 'OUT_OF_STOCK',
      message: 'Provider product is currently out of stock'
    });
  }

  // Deduct provider simulated balance and issue key
  mockProviderBalance -= (product.price || 0);
  if (product.stock_count) product.stock_count -= 1;

  const keySegment = crypto.randomBytes(4).toString('hex').toUpperCase();
  const generatedKey = `LD-KEY-${product_id.replace('LD_PROD_', '')}-${keySegment}-${Date.now().toString().slice(-4)}`;
  const txId = 'LD_TX_' + crypto.randomBytes(6).toString('hex').toUpperCase();

  return res.json({
    status: 'success',
    tx_id: txId,
    client_order_id,
    product_id,
    license_key: generatedKey,
    remaining_balance: mockProviderBalance,
    issued_at: new Date().toISOString()
  });
});
