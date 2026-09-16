import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'fallback_secret_key_change_me',
  
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'adminpassword123',
    telegramIds: (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
      .map(id => parseInt(id, 10))
  },

  bot: {
    token: process.env.BOT_TOKEN || '',
    isValidToken: () => {
      const token = process.env.BOT_TOKEN || '';
      return Boolean(token && token.includes(':') && !token.includes('YOUR_TELEGRAM_BOT_TOKEN') && !token.includes('test_mock_token'));
    }
  },

  db: {
    path: path.resolve(process.cwd(), process.env.DB_PATH || './data/shop.db')
  },

  brand: {
    storeName: process.env.STORE_NAME || 'DIGITAL KEYS STORE',
    supportUsername: process.env.SUPPORT_USERNAME || 'SupportTeam',
    currencySymbol: process.env.CURRENCY_SYMBOL || '₹'
  }
};
