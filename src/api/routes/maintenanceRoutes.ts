import { Router } from 'express';
import { settingsRepo } from '../../database/repositories/settingsRepo.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const maintenanceRoutes = Router();

maintenanceRoutes.get('/', (req, res) => {
  const isEnabled = settingsRepo.getBoolean('maintenance_enabled', false);
  const message = settingsRepo.get(
    'maintenance_message',
    '⚠️ Store is currently under scheduled maintenance.\n\nPlease check back soon! For urgent queries, contact support.'
  );

  return res.json({
    success: true,
    maintenance: {
      enabled: isEnabled,
      message
    }
  });
});

maintenanceRoutes.post('/', requireAdmin, (req, res) => {
  const { enabled, message } = req.body;

  if (enabled !== undefined) {
    settingsRepo.set('maintenance_enabled', enabled ? 'true' : 'false');
  }

  if (message !== undefined && message.trim()) {
    settingsRepo.set('maintenance_message', message.trim());
  }

  const currentEnabled = settingsRepo.getBoolean('maintenance_enabled', false);
  const currentMessage = settingsRepo.get('maintenance_message');

  return res.json({
    success: true,
    message: `Maintenance Mode is now ${currentEnabled ? 'ENABLED (Users blocked)' : 'DISABLED (Normal operations)'}`,
    maintenance: {
      enabled: currentEnabled,
      message: currentMessage
    }
  });
});
