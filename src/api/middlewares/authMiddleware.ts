import { Request, Response, NextFunction } from 'express';
import { authService } from '../../services/authService.js';

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Missing or invalid token' });
  }

  const verified = authService.verifyToken(token);

  if (!verified.valid) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Token expired or invalid' });
  }

  (req as any).adminUser = verified.payload;
  next();
}
