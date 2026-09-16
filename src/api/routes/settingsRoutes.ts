import { Router } from 'express';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const settingsRoutes = Router();

// Get General Store & Support Settings
settingsRoutes.get('/', (req, res) => {
  const usdRate = settingsRepo.getUsdRate();
  const brandName = settingsRepo.get('brand_name', 'ALPHA DIGITAL STORE');
  const supportUsername = settingsRepo.get('support_username', 'AlphaSupport');
  const supportLink = settingsRepo.get('support_link', '');
  const supportBtnText = settingsRepo.get('support_btn_text', '💬 Chat with Support Agent');
  const supportMessage = settingsRepo.get('support_message', '');
  const supportChannelUrl = settingsRepo.get('support_channel_url', '');
  const supportChannelLabel = settingsRepo.get('support_channel_label', '📢 Official Updates Channel');
  const supportButtonLabel = settingsRepo.get('support_button_label', '🎧 Support');
  const currencySymbol = settingsRepo.get('currency_symbol', '₹');

  return res.json({
    success: true,
    settings: {
      usdRate,
      brandName,
      supportUsername,
      supportLink,
      supportBtnText,
      supportMessage,
      supportChannelUrl,
      supportChannelLabel,
      supportButtonLabel,
      currencySymbol
    }
  });
});

// Update General Store & Support Settings
settingsRoutes.post('/', requireAdmin, (req, res) => {
  const {
    usdRate,
    brandName,
    supportUsername,
    supportLink,
    supportBtnText,
    supportMessage,
    supportChannelUrl,
    supportChannelLabel,
    supportButtonLabel,
    currencySymbol
  } = req.body;

  if (usdRate !== undefined) {
    const numRate = parseFloat(usdRate);
    if (isNaN(numRate) || numRate <= 0) {
      return res.status(400).json({ success: false, message: 'USD Conversion Rate must be a positive number' });
    }
    settingsRepo.set('usd_conversion_rate', String(numRate));
  }

  if (brandName !== undefined) {
    settingsRepo.set('brand_name', brandName.trim());
  }

  if (supportUsername !== undefined) {
    settingsRepo.set('support_username', supportUsername.trim().replace(/^@/, ''));
  }

  if (supportLink !== undefined) {
    settingsRepo.set('support_link', supportLink.trim());
  }

  if (supportBtnText !== undefined) {
    settingsRepo.set('support_btn_text', supportBtnText.trim());
  }

  if (supportMessage !== undefined) {
    settingsRepo.set('support_message', supportMessage);
  }

  if (supportChannelUrl !== undefined) {
    settingsRepo.set('support_channel_url', supportChannelUrl.trim());
  }

  if (supportChannelLabel !== undefined) {
    settingsRepo.set('support_channel_label', supportChannelLabel.trim());
  }

  if (supportButtonLabel !== undefined) {
    settingsRepo.set('support_button_label', supportButtonLabel.trim());
  }

  if (currencySymbol !== undefined && currencySymbol.trim()) {
    settingsRepo.set('currency_symbol', currencySymbol.trim());
  }

  return res.json({
    success: true,
    message: 'Support & store settings saved successfully!',
    settings: {
      usdRate: settingsRepo.getUsdRate(),
      brandName: settingsRepo.get('brand_name'),
      supportUsername: settingsRepo.get('support_username'),
      supportLink: settingsRepo.get('support_link'),
      supportBtnText: settingsRepo.get('support_btn_text'),
      supportMessage: settingsRepo.get('support_message'),
      supportChannelUrl: settingsRepo.get('support_channel_url'),
      supportChannelLabel: settingsRepo.get('support_channel_label'),
      supportButtonLabel: settingsRepo.get('support_button_label'),
      currencySymbol: settingsRepo.get('currency_symbol')
    }
  });
});
