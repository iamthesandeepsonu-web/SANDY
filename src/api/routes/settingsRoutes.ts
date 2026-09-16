import { Router } from 'express';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const settingsRoutes = Router();

// Get General Store Settings (USD rate, brand, support, etc.)
settingsRoutes.get('/', (req, res) => {
  const usdRate = settingsRepo.getUsdRate();
  const brandName = settingsRepo.get('brand_name', 'ALPHA DIGITAL STORE');
  const supportUsername = settingsRepo.get('support_username', 'AlphaSupport');
  const currencySymbol = settingsRepo.get('currency_symbol', '₹');

  return res.json({
    success: true,
    settings: {
      usdRate,
      brandName,
      supportUsername,
      currencySymbol
    }
  });
});

// Update USD Conversion Rate & General Settings
settingsRoutes.post('/', requireAdmin, (req, res) => {
  const { usdRate, brandName, supportUsername, currencySymbol } = req.body;

  if (usdRate !== undefined) {
    const numRate = parseFloat(usdRate);
    if (isNaN(numRate) || numRate <= 0) {
      return res.status(400).json({ success: false, message: 'USD Conversion Rate must be a positive number' });
    }
    settingsRepo.set('usd_conversion_rate', String(numRate));
  }

  if (brandName !== undefined && brandName.trim()) {
    settingsRepo.set('brand_name', brandName.trim());
  }

  if (supportUsername !== undefined && supportUsername.trim()) {
    settingsRepo.set('support_username', supportUsername.trim().replace(/^@/, ''));
  }

  if (currencySymbol !== undefined && currencySymbol.trim()) {
    settingsRepo.set('currency_symbol', currencySymbol.trim());
  }

  return res.json({
    success: true,
    message: 'Store settings and USD conversion rate updated successfully!',
    settings: {
      usdRate: settingsRepo.getUsdRate(),
      brandName: settingsRepo.get('brand_name'),
      supportUsername: settingsRepo.get('support_username'),
      currencySymbol: settingsRepo.get('currency_symbol')
    }
  });
});
