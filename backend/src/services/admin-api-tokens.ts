/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * Per-user API token handling (hashed token storage, revokable, expirable)
 */

import crypto from 'crypto';
import { getDatabase } from '../database.js';
import { isStaffRole, normalizeRole } from '../utils/roles.js';
import { formatSqlDateTime } from '../utils/sql-date.js';

const API_TOKEN_PREFIX = 'bhat_';
const API_TOKEN_PATTERN = /^bhat_[A-Za-z0-9_-]{20,220}$/;

export interface AdminApiTokenRecord {
  id: string;
  adminUserId: string;
  label: string;
  tokenPrefix: string;
  createdAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  isExpired: boolean;
  isActive: boolean;
}

export interface ResolvedAdminApiToken {
  id: string;
  adminUserId: string;
  username: string | null;
  role: string | null;
}

function normalizeTokenInternal(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!API_TOKEN_PATTERN.test(normalized)) return '';
  return normalized;
}

function normalizeLabel(value: unknown): string {
  return String(value || '').trim().slice(0, 120);
}

function normalizeOptionalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return formatSqlDateTime(parsed);
}

function parseSqlDate(value: unknown): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const date = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function mapAdminApiTokenRow(row: any): AdminApiTokenRecord | null {
  if (!row) return null;
  const id = String(row.id || '').trim();
  const adminUserId = String(row.admin_user_id || '').trim();
  const tokenPrefix = String(row.token_prefix || '').trim();
  if (!id || !adminUserId || !tokenPrefix) return null;
  const revokedAt = row.revoked_at || null;
  const expiresAt = row.expires_at || null;
  const now = Date.now();
  const expired = !!expiresAt && parseSqlDate(expiresAt) > 0 && parseSqlDate(expiresAt) <= now;
  const active = !revokedAt && !expired;
  return {
    id,
    adminUserId,
    label: String(row.label || '').trim(),
    tokenPrefix,
    createdAt: row.created_at || null,
    expiresAt,
    lastUsedAt: row.last_used_at || null,
    revokedAt,
    revokeReason: row.revoke_reason || null,
    isExpired: expired,
    isActive: active,
  };
}

function hashToken(tokenValue: string): string {
  return crypto.createHash('sha256').update(tokenValue).digest('hex');
}

export function normalizeAdminApiTokenValue(value: unknown): string {
  return normalizeTokenInternal(value);
}

export function generateAdminApiTokenValue(): string {
  return `${API_TOKEN_PREFIX}${crypto.randomBytes(30).toString('base64url')}`;
}

export async function listOwnAdminApiTokens(adminUserId: string): Promise<AdminApiTokenRecord[]> {
  const userId = String(adminUserId || '').trim();
  if (!userId) return [];
  const db = getDatabase();
  const rows = await db.all(
    `SELECT id, admin_user_id, label, token_prefix, created_at, expires_at, last_used_at, revoked_at, revoke_reason
     FROM admin_api_tokens
     WHERE admin_user_id = ?
     ORDER BY datetime(created_at) DESC`,
    [userId]
  );
  return (rows || [])
    .map((row: any) => mapAdminApiTokenRow(row))
    .filter((row): row is AdminApiTokenRecord => !!row);
}

export async function createOwnAdminApiToken(input: {
  adminUserId: string;
  actorAdminUserId?: string | null;
  label?: string;
  expiresAt?: string | Date | null;
}): Promise<{ token: string; record: AdminApiTokenRecord }> {
  const adminUserId = String(input.adminUserId || '').trim();
  if (!adminUserId) {
    throw new Error('adminUserId fehlt.');
  }
  const expiresAtSql = normalizeOptionalDate(input.expiresAt);
  if (input.expiresAt !== undefined && input.expiresAt !== null && !expiresAtSql) {
    throw new Error('Ungültiges Ablaufdatum.');
  }
  if (expiresAtSql && parseSqlDate(expiresAtSql) <= Date.now()) {
    throw new Error('Ablaufdatum muss in der Zukunft liegen.');
  }
  const label = normalizeLabel(input.label);
  const actor = String(input.actorAdminUserId || adminUserId).trim() || null;

  const db = getDatabase();
  let attempts = 0;
  while (attempts < 4) {
    attempts += 1;
    const id = `aat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const token = generateAdminApiTokenValue();
    const tokenHash = hashToken(token);
    const tokenPrefix = token.slice(0, 16);

    try {
      await db.run(
        `INSERT INTO admin_api_tokens (
          id, admin_user_id, label, token_hash, token_prefix, created_by_admin_id, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [id, adminUserId, label || null, tokenHash, tokenPrefix, actor, expiresAtSql]
      );

      const inserted = await db.get(
        `SELECT id, admin_user_id, label, token_prefix, created_at, expires_at, last_used_at, revoked_at, revoke_reason
         FROM admin_api_tokens
         WHERE id = ?
         LIMIT 1`,
        [id]
      );
      const mapped = mapAdminApiTokenRow(inserted);
      if (!mapped) {
        throw new Error('API-Token konnte nicht geladen werden.');
      }
      return {
        token,
        record: mapped,
      };
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      const duplicateHash = message.includes('token_hash') || message.includes('unique');
      if (duplicateHash && attempts < 4) continue;
      throw error;
    }
  }

  throw new Error('API-Token konnte nicht erzeugt werden.');
}

export async function revokeOwnAdminApiToken(input: {
  adminUserId: string;
  tokenId: string;
  actorAdminUserId?: string | null;
  reason?: string | null;
}): Promise<{ revoked: number }> {
  const adminUserId = String(input.adminUserId || '').trim();
  const tokenId = String(input.tokenId || '').trim();
  if (!adminUserId || !tokenId) return { revoked: 0 };
  const actor = String(input.actorAdminUserId || adminUserId).trim() || null;
  const reason = String(input.reason || '').trim() || 'revoked_by_user';
  const db = getDatabase();
  const result = await db.run(
    `UPDATE admin_api_tokens
     SET revoked_at = CURRENT_TIMESTAMP,
         revoked_by_admin_id = COALESCE(?, revoked_by_admin_id),
         revoke_reason = COALESCE(revoke_reason, ?)
     WHERE id = ?
       AND admin_user_id = ?
       AND revoked_at IS NULL`,
    [actor, reason, tokenId, adminUserId]
  );
  return { revoked: Number(result?.changes || 0) };
}

export async function resolveActiveAdminApiToken(tokenValue: string): Promise<ResolvedAdminApiToken | null> {
  const normalized = normalizeTokenInternal(tokenValue);
  if (!normalized) return null;
  const tokenHash = hashToken(normalized);
  const db = getDatabase();
  const row = await db.get(
    `SELECT t.id,
            t.admin_user_id,
            t.expires_at,
            t.revoked_at,
            u.username,
            u.role,
            u.active AS user_active
     FROM admin_api_tokens t
     LEFT JOIN admin_users u ON u.id = t.admin_user_id
     WHERE t.token_hash = ?
     ORDER BY datetime(t.created_at) DESC
     LIMIT 1`,
    [tokenHash]
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  const expiresAt = parseSqlDate(row.expires_at);
  if (expiresAt > 0 && expiresAt <= Date.now()) return null;
  const userActive = Number(row.user_active || 0) === 1;
  if (!userActive) return null;
  const role = normalizeRole(row.role) || String(row.role || '').trim() || null;
  if (!isStaffRole(role)) return null;
  return {
    id: String(row.id || '').trim(),
    adminUserId: String(row.admin_user_id || '').trim(),
    username: String(row.username || '').trim() || null,
    role,
  };
}

export async function markAdminApiTokenUsed(tokenId: string): Promise<void> {
  const id = String(tokenId || '').trim();
  if (!id) return;
  const db = getDatabase();
  await db.run(`UPDATE admin_api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
}

