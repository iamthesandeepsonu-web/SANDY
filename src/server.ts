import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import { initDatabase } from './database/db.js';
import { createTelegramBot } from './bot/bot.js';

// API Route Handlers
import { authRoutes } from './api/routes/authRoutes.js';
import { serviceRoutes } from './api/routes/serviceRoutes.js';
import { licenseRoutes } from './api/routes/licenseRoutes.js';
import { orderRoutes } from './api/routes/orderRoutes.js';
import { userRoutes } from './api/routes/userRoutes.js';
import { paymentRoutes } from './api/routes/paymentRoutes.js';
import { paymentSettingsRoutes } from './api/routes/paymentSettingsRoutes.js';
import { ldApiRoutes } from './api/routes/ldApiRoutes.js';
import { maintenanceRoutes } from './api/routes/maintenanceRoutes.js';
import { settingsRoutes } from './api/routes/settingsRoutes.js';
import { statsRoutes } from './api/routes/statsRoutes.js';
import { mockLdRoutes } from './api/routes/mockLdRoutes.js';
import { emailVerificationService } from './services/emailVerificationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Initialize database & tables
initDatabase();
console.log('✅ SQLite Database initialized successfully with WAL mode');

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve Admin Dashboard Static Frontend
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/licenses', licenseRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/settings/payments', paymentSettingsRoutes);
app.use('/api/settings/ld', ldApiRoutes);
app.use('/api/settings/maintenance', maintenanceRoutes);
app.use('/api/settings/general', settingsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/mock-ld', mockLdRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: config.brand.storeName,
    time: new Date().toISOString()
  });
});

// Single Page Application Fallback for Admin Web Dashboard
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: 'API route not found' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start Express Web Server
const server = app.listen(config.port, config.host, () => {
  console.log(`🚀 Web Server & Admin API running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`🔑 Default Admin Credentials -> Username: ${config.admin.username} | Password: ${config.admin.password}`);
});

// Start Telegram Bot
const bot = createTelegramBot();
if (bot) {
  bot.start({
    onStart: (botInfo) => {
      console.log(`🤖 Telegram Bot @${botInfo.username} is active and polling for updates!`);
    }
  }).catch((err) => {
    console.error('Failed to start Telegram bot polling:', err.message);
  });
} else {
  console.log('ℹ️ Bot polling skipped (configure BOT_TOKEN in .env to enable polling).');
}

// Start Email Verification Worker
emailVerificationService.start().catch((err) => {
  console.error('Failed to start UPI email verification worker:', err.message);
});

export { app, server };
