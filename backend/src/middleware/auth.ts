/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Authentication Middleware
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { loadConfig } from '../config.js';
import { isAdminRole, isStaffRole, normalizeRole } from '../utils/roles.js';
import {
  markAdminApiTokenUsed,
  normalizeAdminApiTokenValue,
  resolveActiveAdminApiToken,
} from '../services/admin-api-tokens.js';
import {
  expireSessionIfNeeded,
  getAdminSession,
  getRequestIp,
  getRequestUserAgent,
  markAdminSessionSeen,
  writeJournalEntry,
} from '../services/admin-journal.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      username?: string;
      role?: string;
      sessionId?: string;
    }
  }
}

const config = loadConfig();

function extractBearerToken(req: Request): string {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function isLikelyJwtToken(token: string): boolean {
  if (!token) return false;
  const dotCount = token.split('.').length - 1;
  return dotCount === 2;
}

/**
 * JWT Verification Middleware
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const bearerToken = extractBearerToken(req);
  const apiKeyHeaderToken = normalizeAdminApiTokenValue(req.headers['x-api-key']);
  const normalizedBearerApiToken = normalizeAdminApiTokenValue(bearerToken);

  if (!bearerToken && !apiKeyHeaderToken) {
    return res.status(401).json({ error: 'Authentifizierung erforderlich' });
  }

  if (bearerToken && isLikelyJwtToken(bearerToken)) {
    try {
      const decoded = jwt.verify(bearerToken, config.jwtSecret) as any;
      req.userId = decoded.userId;
      req.username = decoded.username;
      req.role = normalizeRole(decoded.role) || decoded.role;
      req.sessionId = typeof decoded.sessionId === 'string' ? decoded.sessionId : undefined;

      // Backward compatibility: allow older tokens without session id
      if (!req.sessionId) {
        return next();
      }

      const isExpired = await expireSessionIfNeeded(req.sessionId);
      if (isExpired) {
        await writeJournalEntry({
          eventType: 'SESSION_EXPIRED',
          severity: 'warning',
          adminUserId: req.userId,
          username: req.username,
          role: req.role,
          sessionId: req.sessionId,
          method: req.method,
          path: req.originalUrl || req.path,
          ipAddress: getRequestIp(req),
          userAgent: getRequestUserAgent(req),
        });
        return res.status(401).json({ error: 'Sitzung ist abgelaufen' });
      }

      const session = await getAdminSession(req.sessionId);
      if (!session || !session.is_active) {
        await writeJournalEntry({
          eventType: 'SESSION_INVALID',
          severity: 'warning',
          adminUserId: req.userId,
          username: req.username,
          role: req.role,
          sessionId: req.sessionId,
          method: req.method,
          path: req.originalUrl || req.path,
          ipAddress: getRequestIp(req),
          userAgent: getRequestUserAgent(req),
        });
        return res.status(401).json({ error: 'Sitzung ist nicht mehr aktiv' });
      }

      await markAdminSessionSeen(req.sessionId);
      return next();
    } catch {
      // JWT invalid: fall through to API key check
    }
  }

  const apiToken = normalizedBearerApiToken || apiKeyHeaderToken;
  if (apiToken) {
    try {
      const resolved = await resolveActiveAdminApiToken(apiToken);
      if (resolved) {
        req.userId = resolved.adminUserId;
        req.username = resolved.username || undefined;
        req.role = resolved.role || undefined;
        req.sessionId = undefined;
        await markAdminApiTokenUsed(resolved.id);
        return next();
      }
    } catch {
      // Continue with auth error + journaling below.
    }
  }

  try {
    await writeJournalEntry({
      eventType: 'AUTH_TOKEN_INVALID',
      severity: 'warning',
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
    });
  } catch {
    // Ignore journaling failures.
  }

  return res.status(401).json({ error: 'Ungültiger oder abgelaufener Token' });
}

/**
 * Staff Role Check Middleware
 */
export function staffOnly(req: Request, res: Response, next: NextFunction) {
  if (!isStaffRole(req.role)) {
    return res.status(403).json({ error: 'Admin-Rechte erforderlich' });
  }
  next();
}

/**
 * Admin Role Check Middleware
 */
export function adminOnly(req: Request, res: Response, next: NextFunction) {
  if (!isAdminRole(req.role)) {
    return res.status(403).json({ error: 'Admin-Rechte erforderlich' });
  }
  next();
}

/**
 * Backward-compatible alias.
 * SUPERADMIN wird intern auf ADMIN normalisiert.
 */
export const superadminOnly = adminOnly;
