import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { UserModel } from '../models/User';
import { isDbConnected } from '../db';
import { UserRole } from '../models/User';

const DEVELOPMENT_JWT_SECRET = crypto.randomBytes(32).toString('hex');

export function getJwtSecret(): string {
  const configuredSecret = process.env.JWT_SECRET?.trim();
  if (configuredSecret) return configuredSecret;
  if (process.env.NODE_ENV !== 'production' && process.env.STRICT_DB !== 'true') {
    return DEVELOPMENT_JWT_SECRET;
  }
  throw new Error('Authentication service is not configured.');
}

export interface AuthUserPayload {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
  phone?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export function generateToken(payload: AuthUserPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthUserPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.userId !== 'string' ||
      typeof decoded.email !== 'string' ||
      typeof decoded.name !== 'string' ||
      typeof decoded.role !== 'string'
    ) {
      return null;
    }
    return decoded as AuthUserPayload;
  } catch {
    return null;
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = undefined;
    next();
    return;
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (decoded) {
    req.user = decoded;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in to perform this action.',
    });
    return;
  }
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    let verifiedRole = req.user.role;
    if (isDbConnected()) {
      const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      const isConfiguredAdmin =
        req.user.role === 'super_admin' &&
        req.user.email.toLowerCase() === configuredAdminEmail &&
        (req.user.userId === 'admin-env-master' ||
          req.user.userId === `admin-config:${req.user.email.toLowerCase()}`);

      if (!isConfiguredAdmin) {
        if (!mongoose.isValidObjectId(req.user.userId)) {
          res.status(401).json({ success: false, error: 'Authenticated account is invalid.' });
          return;
        }
        try {
          const user = await UserModel.findById(req.user.userId).select('email role');
          if (!user || user.email.toLowerCase() !== req.user.email.toLowerCase()) {
            res.status(401).json({ success: false, error: 'Authenticated account is no longer available.' });
            return;
          }
          verifiedRole = user.role;
        } catch (error) {
          console.error('Failed to validate administrator authorization:', error);
          res.status(503).json({ success: false, error: 'Authorization could not be verified right now.' });
          return;
        }
      }
    }

    if (verifiedRole === 'super_admin') {
      next();
      return;
    }

    if (!allowedRoles.includes(verifiedRole)) {
      res.status(403).json({
        success: false,
        error: `Access denied. Requires one of roles: [${allowedRoles.join(', ')}]`,
      });
      return;
    }
    next();
  };
}
