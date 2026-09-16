import { Request, Response, NextFunction } from 'express';
import { authService } from '../../services/authService.js';

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];
  const verified = authService.verifyToken(token);

  if (!verified.valid) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Token expired or invalid' });
  }

  (req as any).adminUser = verified.payload;
  next();
}
