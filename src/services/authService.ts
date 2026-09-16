import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';
import { settingsRepo } from '../database/repositories/settingsRepo.js';

export const authService = {
  getAdminPasswordHash(): string {
    let storedHash = settingsRepo.get('admin_password_hash', '');
    if (!storedHash) {
      // Initialize with default admin password
      const defaultHash = bcrypt.hashSync(config.admin.password, 10);
      settingsRepo.set('admin_password_hash', defaultHash);
      return defaultHash;
    }
    return storedHash;
  },

  verifyPassword(password: string): boolean {
    const hash = this.getAdminPasswordHash();
    return bcrypt.compareSync(password, hash);
  },

  updatePassword(newPassword: string): boolean {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    settingsRepo.set('admin_password_hash', hash);
    return true;
  },

  generateToken(username = 'admin'): string {
    return jwt.sign(
      { role: 'admin', username },
      config.jwtSecret,
      { expiresIn: '7d' }
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
