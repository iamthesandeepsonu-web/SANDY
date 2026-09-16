import { Router } from 'express';
import { authService } from '../../services/authService.js';
import { config } from '../../config/index.js';
import { requireAdmin } from '../middlewares/authMiddleware.js';

export const authRoutes = Router();

authRoutes.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  const expectedUsername = (config.admin.username || 'admin').trim().toLowerCase();
  const inputUsername = String(username).trim().toLowerCase();

  const isUserValid = inputUsername === expectedUsername || inputUsername === 'admin';
  const isPassValid = authService.verifyPassword(String(password));

  if (!isUserValid || !isPassValid) {
    return res.status(401).json({ success: false, message: 'Invalid admin username or password' });
  }

  const token = authService.generateToken(username);
  return res.json({
    success: true,
    token,
    user: { username: String(username).trim(), role: 'admin' }
  });
});

authRoutes.get('/status', requireAdmin, (req, res) => {
  return res.json({
    success: true,
    authenticated: true,
    user: (req as any).adminUser
  });
});

authRoutes.post('/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current and new password are required' });
  }

  const isValid = authService.verifyPassword(String(currentPassword));
  if (!isValid) {
    return res.status(400).json({ success: false, message: 'Current password is incorrect' });
  }

  try {
    authService.updatePassword(String(newPassword));
    return res.json({ success: true, message: 'Password updated successfully' });
  } catch (err: any) {
    return res.status(400).json({ success: false, message: err.message });
  }
});
