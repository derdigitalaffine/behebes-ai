/**
 * Admin session and journal helper service
 */

import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database.js';

type JournalSeverity = 'info' | 'warning' | 'error';

export interface JournalEntryInput {
  eventType: string;
  severity?: JournalSeverity;
  adminUserId?: string | null;
  username?: string | null;
  role?: string | null;
  sessionId?: string | null;
  method?: string | null;
  path?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, any> | null;
}

export interface SessionInput {
  adminUserId: string;
  username: string;
  role: string;
  rememberMe: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt?: string | null;
}

function toJson(details?: Record<string, any> | null): string | null {
  if (!details) return null;
  try {
    return JSON.stringify(details);
  } catch {
    return null;
  }
}

export function getRequestIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return forwardedFor[0];
  }
  if (typeof req.ip === 'string') return req.ip;
  if (typeof req.socket?.remoteAddress === 'string') return req.socket.remoteAddress;
  return '';
}

export function getRequestUserAgent(req: Request): string {
  const value = req.headers['user-agent'];
  return typeof value === 'string' ? value : '';
}

export async function writeJournalEntry(input: JournalEntryInput): Promise<void> {
  try {
    const db = getDatabase();
    await db.run(
      `INSERT INTO admin_journal (
         id, event_type, severity, admin_user_id, username, role, session_id,
         method, path, ip_address, user_agent, details
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        input.eventType,
        input.severity || 'info',
        input.adminUserId || null,
        input.username || null,
        input.role || null,
        input.sessionId || null,
        input.method || null,
        input.path || null,
        input.ipAddress || null,
        input.userAgent || null,
        toJson(input.details),
      ]
    );
  } catch (error) {
    // Journal failures must never block request processing
    console.warn('Failed to write admin journal entry:', error);
  }
}

export async function createAdminSession(input: SessionInput): Promise<string> {
  const db = getDatabase();
  const id = uuidv4();
  await db.run(
    `INSERT INTO admin_sessions (
       id, admin_user_id, username, role, ip_address, user_agent, remember_me, expires_at, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id,
      input.adminUserId,
      input.username,
      input.role,
      input.ipAddress || null,
      input.userAgent || null,
      input.rememberMe ? 1 : 0,
      input.expiresAt || null,
    ]
  );
  return id;
}

export async function markAdminSessionSeen(sessionId: string): Promise<void> {
  const db = getDatabase();
  await db.run(
    `UPDATE admin_sessions
     SET last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ? AND is_active = 1`,
    [sessionId]
  );
}

export async function getAdminSession(sessionId: string): Promise<any | null> {
  const db = getDatabase();
  return db.get(`SELECT * FROM admin_sessions WHERE id = ?`, [sessionId]);
}

export async function endAdminSession(sessionId: string, reason = 'logout'): Promise<void> {
  const db = getDatabase();
  await db.run(
    `UPDATE admin_sessions
     SET is_active = 0,
         logged_out_at = COALESCE(logged_out_at, CURRENT_TIMESTAMP),
         logout_reason = COALESCE(logout_reason, ?)
     WHERE id = ?`,
    [reason, sessionId]
  );
}

export async function expireSessionIfNeeded(sessionId: string): Promise<boolean> {
  const session = await getAdminSession(sessionId);
  if (!session) return true;
  if (!session.is_active) return true;
  if (!session.expires_at) return false;

  const expiresMs = Date.parse(String(session.expires_at || ''));
  if (Number.isNaN(expiresMs)) return false;
  if (expiresMs > Date.now()) return false;

  await endAdminSession(sessionId, 'expired');
  return true;
}
