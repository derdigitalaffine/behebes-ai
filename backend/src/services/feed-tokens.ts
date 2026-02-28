/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * Per-user revokable feed tokens for Atom subscriptions
 */

import crypto from 'crypto';
import type { Request } from 'express';
import { getDatabase } from '../database.js';
import { isStaffRole } from '../utils/roles.js';

export type FeedScope = 'tickets' | 'ai_situation';

const FEED_SCOPES = new Set<FeedScope>(['tickets', 'ai_situation']);

export interface FeedTokenRecord {
  id: string;
  adminUserId: string;
  scope: FeedScope;
  token: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ResolvedFeedToken {
  id: string;
  adminUserId: string;
  scope: FeedScope;
  username: string | null;
  role: string | null;
  userActive: boolean;
}

function normalizeTokenInternal(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!/^[A-Za-z0-9_-]{16,220}$/.test(normalized)) return '';
  return normalized;
}

function extractBasicAuthPassword(req: Request): string {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader.startsWith('Basic ')) return '';
  const encoded = authHeader.slice(6).trim();
  if (!encoded) return '';
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return '';
    return decoded.slice(separatorIndex + 1).trim();
  } catch {
    return '';
  }
}

function mapFeedTokenRow(row: any): FeedTokenRecord | null {
  if (!row) return null;
  const scope = normalizeFeedScope(row.scope);
  if (!scope) return null;
  const token = normalizeTokenInternal(row.token);
  if (!token) return null;
  return {
    id: String(row.id || ''),
    adminUserId: String(row.admin_user_id || ''),
    scope,
    token,
    createdAt: row.created_at || null,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null,
  };
}

export function normalizeFeedScope(value: unknown): FeedScope | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'ai' || normalized === 'ai-situation' || normalized === 'situation' || normalized === 'situation-report') {
    return 'ai_situation';
  }
  if (normalized === 'tickets' || normalized === 'ticket') {
    return 'tickets';
  }
  if (!FEED_SCOPES.has(normalized as FeedScope)) return null;
  return normalized as FeedScope;
}

export function normalizeFeedTokenValue(value: unknown): string {
  return normalizeTokenInternal(value);
}

export function generateFeedTokenValue(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function resolveFeedPath(scope: FeedScope): string {
  if (scope === 'ai_situation') return '/api/admin/ai/situation-report/feed/atom';
  return '/api/tickets/feed/atom';
}

export function extractFeedTokenFromRequest(req: Request, headerName = 'x-feed-token'): string {
  const queryToken = normalizeTokenInternal(req.query?.token);
  if (queryToken) return queryToken;

  const normalizedHeaderName = String(headerName || 'x-feed-token').trim().toLowerCase();
  const headerValue = req.headers[normalizedHeaderName];
  const headerToken = normalizeTokenInternal(Array.isArray(headerValue) ? headerValue[0] : headerValue);
  if (headerToken) return headerToken;

  const basicPassword = normalizeTokenInternal(extractBasicAuthPassword(req));
  if (basicPassword) return basicPassword;

  return '';
}

export async function getOwnActiveFeedToken(adminUserId: string, scope: FeedScope): Promise<FeedTokenRecord | null> {
  const db = getDatabase();
  const row = await db.get(
    `SELECT id, admin_user_id, scope, token, created_at, last_used_at, revoked_at
     FROM admin_feed_tokens
     WHERE admin_user_id = ? AND scope = ? AND revoked_at IS NULL
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [adminUserId, scope]
  );
  return mapFeedTokenRow(row);
}

export async function rotateOwnFeedToken(input: {
  adminUserId: string;
  scope: FeedScope;
  actorAdminUserId?: string | null;
  revokeReason?: string | null;
}): Promise<FeedTokenRecord> {
  const db = getDatabase();
  const actor = String(input.actorAdminUserId || input.adminUserId || '').trim() || null;
  const reason = String(input.revokeReason || '').trim() || 'rotated';
  const id = `aft_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const token = generateFeedTokenValue();

  await db.run(
    `UPDATE admin_feed_tokens
     SET revoked_at = CURRENT_TIMESTAMP,
         revoked_by_admin_id = COALESCE(?, revoked_by_admin_id),
         revoke_reason = COALESCE(revoke_reason, ?)
     WHERE admin_user_id = ? AND scope = ? AND revoked_at IS NULL`,
    [actor, reason, input.adminUserId, input.scope]
  );

  await db.run(
    `INSERT INTO admin_feed_tokens (
      id, admin_user_id, scope, token, created_by_admin_id, created_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, input.adminUserId, input.scope, token, actor]
  );

  const created = await db.get(
    `SELECT id, admin_user_id, scope, token, created_at, last_used_at, revoked_at
     FROM admin_feed_tokens
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  const mapped = mapFeedTokenRow(created);
  if (!mapped) {
    throw new Error('Feed-Token konnte nicht geladen werden.');
  }
  return mapped;
}

export async function revokeOwnFeedToken(input: {
  adminUserId: string;
  scope: FeedScope;
  actorAdminUserId?: string | null;
  reason?: string | null;
}): Promise<{ revoked: number }> {
  const db = getDatabase();
  const actor = String(input.actorAdminUserId || input.adminUserId || '').trim() || null;
  const reason = String(input.reason || '').trim() || 'revoked_by_user';
  const result = await db.run(
    `UPDATE admin_feed_tokens
     SET revoked_at = CURRENT_TIMESTAMP,
         revoked_by_admin_id = COALESCE(?, revoked_by_admin_id),
         revoke_reason = COALESCE(revoke_reason, ?)
     WHERE admin_user_id = ? AND scope = ? AND revoked_at IS NULL`,
    [actor, reason, input.adminUserId, input.scope]
  );
  return { revoked: Number(result?.changes || 0) };
}

export async function resolveActiveFeedToken(scope: FeedScope, tokenValue: string): Promise<ResolvedFeedToken | null> {
  const token = normalizeTokenInternal(tokenValue);
  if (!token) return null;
  const db = getDatabase();
  const row = await db.get(
    `SELECT t.id,
            t.admin_user_id,
            t.scope,
            u.username,
            u.role,
            u.active as user_active
     FROM admin_feed_tokens t
     LEFT JOIN admin_users u ON u.id = t.admin_user_id
     WHERE t.scope = ?
       AND t.token = ?
       AND t.revoked_at IS NULL
     ORDER BY datetime(t.created_at) DESC
     LIMIT 1`,
    [scope, token]
  );
  if (!row) return null;
  const normalizedScope = normalizeFeedScope(row.scope);
  if (!normalizedScope) return null;
  const userActive = Number(row.user_active || 0) === 1;
  const role = String(row.role || '').trim() || null;
  if (!userActive || !isStaffRole(role)) return null;
  return {
    id: String(row.id || ''),
    adminUserId: String(row.admin_user_id || ''),
    scope: normalizedScope,
    username: String(row.username || '').trim() || null,
    role,
    userActive,
  };
}

export async function markFeedTokenUsed(tokenId: string): Promise<void> {
  const id = String(tokenId || '').trim();
  if (!id) return;
  const db = getDatabase();
  await db.run(`UPDATE admin_feed_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
}
