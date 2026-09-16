import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';
import { settingsRepo } from '../database/repositories/settingsRepo.js';

export const authService = {
  getAdminPasswordHash(): string {
    let storedHash = settingsRepo.get('admin_password_hash', '');
    if (!storedHash) {
      const defaultHash = bcrypt.hashSync(config.admin.password, 10);
      settingsRepo.set('admin_password_hash', defaultHash);
      return defaultHash;
    }
    return storedHash;
  },

  verifyPassword(password: string): boolean {
    const trimmed = password.trim();
    // 1. Direct match with configured ADMIN_PASSWORD from environment variables
    if (config.admin.password && trimmed === config.admin.password.trim()) {
      return true;
    }
    // 2. Direct match with default fallback
    if (trimmed === 'adminpassword123') {
      return true;
    }
    // 3. Match with stored bcrypt hash
    try {
      const hash = this.getAdminPasswordHash();
      return bcrypt.compareSync(trimmed, hash);
    } catch {
      return false;
    }
  },

  updatePassword(newPassword: string): boolean {
    if (!newPassword || newPassword.trim().length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    const hash = bcrypt.hashSync(newPassword.trim(), 10);
    settingsRepo.set('admin_password_hash', hash);
    return true;
  },

  generateToken(username = 'admin'): string {
    return jwt.sign(
      { role: 'admin', username },
      config.jwtSecret,
      { expiresIn: '30d' }
    );
  },

  verifyToken(token: string): { valid: boolean; payload?: any } {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      return { valid: true, payload };
    } catch {
      return { valid: false };
    }
  }
};
