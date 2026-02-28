import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';
import { getDatabase } from '../database.js';
import { formatSqlDateTime } from '../utils/sql-date.js';
import { loadConfig } from '../config.js';
import { getRequestIp, getRequestUserAgent } from './admin-journal.js';
import { loadGeneralSettings } from './settings.js';
import { derivePublicBaseUrlFromCallback } from './callback-links.js';

export type CitizenMagicLinkPurpose = 'login' | 'verify_and_login';

export interface CitizenSessionContext {
  sessionId: string;
  accountId: string;
  email: string;
  emailOriginal: string;
  frontendProfileToken: string;
  expiresAt: string;
}

interface CreateMagicLinkInput {
  email: string;
  purpose: CitizenMagicLinkPurpose;
  frontendProfileToken?: string;
  redirectPath?: string;
  requestIp?: string;
}

interface ConsumedMagicLink {
  id: string;
  accountId: string;
  emailNormalized: string;
  frontendProfileToken: string;
  redirectPath: string;
  purpose: CitizenMagicLinkPurpose;
}

interface CreateSessionInput {
  accountId: string;
  frontendProfileToken?: string;
  ipAddress?: string;
  userAgent?: string;
}

const MAGIC_LINK_TTL_MINUTES = 20;
const SESSION_ROLLING_DAYS = 90;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const COOKIE_NAME = 'citizen_session';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const requestLinkByEmail = new Map<string, number[]>();
const requestLinkByIp = new Map<string, number[]>();

function normalizeFrontendToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 80);
}

export function normalizeCitizenEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function validateCitizenEmail(email: unknown): boolean {
  const normalized = String(email || '').trim();
  return !!normalized && normalized.length <= 190 && EMAIL_PATTERN.test(normalized);
}

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseDateMs(value: unknown): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanupRateLimitMap(map: Map<string, number[]>, now: number): void {
  for (const [key, timestamps] of map.entries()) {
    const filtered = timestamps.filter((ts) => now - ts <= ACTIVE_RATE_LIMIT_WINDOW_MS);
    if (filtered.length > 0) {
      map.set(key, filtered);
    } else {
      map.delete(key);
    }
  }
}

function trackRateLimit(map: Map<string, number[]>, key: string, max: number, now: number): boolean {
  if (!key) return true;
  const existing = map.get(key) || [];
  const filtered = existing.filter((ts) => now - ts <= ACTIVE_RATE_LIMIT_WINDOW_MS);
  if (filtered.length >= max) {
    map.set(key, filtered);
    return false;
  }
  filtered.push(now);
  map.set(key, filtered);
  return true;
}

export function allowCitizenRequestLinkRateLimit(email: string, ipAddress: string): boolean {
  const now = Date.now();
  cleanupRateLimitMap(requestLinkByEmail, now);
  cleanupRateLimitMap(requestLinkByIp, now);

  const okEmail = trackRateLimit(requestLinkByEmail, normalizeCitizenEmail(email), 5, now);
  const okIp = trackRateLimit(requestLinkByIp, String(ipAddress || '').trim(), 30, now);
  return okEmail && okIp;
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((raw) => {
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (!key) return;
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function normalizeRedirectPath(input: unknown): string {
  const raw = String(input || '').trim();
  if (!raw) return '/me';
  if (!raw.startsWith('/')) return '/me';
  if (raw.startsWith('//')) return '/me';
  return raw.slice(0, 240);
}

async function writeCitizenAudit(eventType: string, details: Record<string, any>): Promise<void> {
  try {
    const db = getDatabase();
    await db.run(
      `INSERT INTO citizen_auth_audit (
         id, event_type, citizen_account_id, email_normalized, ip_address, user_agent, details_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        String(eventType || '').trim().slice(0, 80),
        details.accountId || null,
        details.emailNormalized || null,
        details.ipAddress || null,
        details.userAgent || null,
        JSON.stringify(details || {}),
      ]
    );
  } catch {
    // Never block user flows on audit write errors.
  }
}

export async function findCitizenAccountByEmail(email: string): Promise<any | null> {
  const normalized = normalizeCitizenEmail(email);
  if (!normalized) return null;
  const db = getDatabase();
  const account = await db.get(
    `SELECT * FROM citizen_accounts WHERE email_normalized = ? LIMIT 1`,
    [normalized]
  );
  return account || null;
}

export async function ensureCitizenAccount(email: string): Promise<{ id: string; emailNormalized: string; emailOriginal: string }> {
  const normalized = normalizeCitizenEmail(email);
  const original = String(email || '').trim();
  if (!normalized) {
    throw new Error('email_required');
  }

  const db = getDatabase();
  const existing = await findCitizenAccountByEmail(normalized);
  if (existing) {
    return {
      id: String(existing.id || ''),
      emailNormalized: String(existing.email_normalized || normalized),
      emailOriginal: String(existing.email_original || original || normalized),
    };
  }

  const id = uuidv4();
  await db.run(
    `INSERT INTO citizen_accounts (id, email_normalized, email_original, created_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, normalized, original || normalized]
  );

  return {
    id,
    emailNormalized: normalized,
    emailOriginal: original || normalized,
  };
}

export async function markCitizenAccountLoggedIn(accountId: string): Promise<void> {
  const db = getDatabase();
  await db.run(
    `UPDATE citizen_accounts
     SET verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP),
         last_login_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [accountId]
  );
}

export async function createCitizenMagicLink(input: CreateMagicLinkInput): Promise<{ token: string; expiresAt: string }> {
  const db = getDatabase();
  const account = await ensureCitizenAccount(input.email);
  const token = generateOpaqueToken(36);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000);
  const id = uuidv4();

  await db.run(
    `INSERT INTO citizen_magic_links (
       id, account_id, email_normalized, token_hash, purpose,
       frontend_profile_token, redirect_path, expires_at, created_at, created_ip
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [
      id,
      account.id,
      account.emailNormalized,
      tokenHash,
      input.purpose,
      normalizeFrontendToken(input.frontendProfileToken),
      normalizeRedirectPath(input.redirectPath),
      formatSqlDateTime(expiresAt),
      String(input.requestIp || '').trim() || null,
    ]
  );

  await writeCitizenAudit('REQUEST_LINK_CREATED', {
    accountId: account.id,
    emailNormalized: account.emailNormalized,
    purpose: input.purpose,
    ipAddress: String(input.requestIp || '').trim() || null,
    createdAt: nowIso(),
  });

  return {
    token,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function consumeCitizenMagicLink(rawToken: string): Promise<ConsumedMagicLink | null> {
  const token = String(rawToken || '').trim();
  if (!token) return null;
  const db = getDatabase();
  const tokenHash = hashToken(token);

  const link = await db.get(
    `SELECT *
     FROM citizen_magic_links
     WHERE token_hash = ?
       AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [tokenHash]
  );

  if (!link?.id) {
    await writeCitizenAudit('REQUEST_LINK_VERIFY_FAILED', {
      reason: 'not_found_or_consumed',
      tokenHash,
      occurredAt: nowIso(),
    });
    return null;
  }

  const expiresMs = parseDateMs(link.expires_at);
  if (!expiresMs || expiresMs < Date.now()) {
    await writeCitizenAudit('REQUEST_LINK_VERIFY_FAILED', {
      accountId: link.account_id || null,
      emailNormalized: link.email_normalized || null,
      reason: 'expired',
      tokenHash,
      occurredAt: nowIso(),
    });
    return null;
  }

  const result = await db.run(
    `UPDATE citizen_magic_links
     SET consumed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND consumed_at IS NULL`,
    [link.id]
  );
  if (!result?.changes) {
    await writeCitizenAudit('REQUEST_LINK_VERIFY_FAILED', {
      accountId: link.account_id || null,
      emailNormalized: link.email_normalized || null,
      reason: 'already_consumed',
      tokenHash,
      occurredAt: nowIso(),
    });
    return null;
  }

  await writeCitizenAudit('REQUEST_LINK_VERIFIED', {
    accountId: link.account_id || null,
    emailNormalized: link.email_normalized || null,
    purpose: link.purpose || 'login',
    occurredAt: nowIso(),
  });

  return {
    id: String(link.id || ''),
    accountId: String(link.account_id || ''),
    emailNormalized: String(link.email_normalized || ''),
    frontendProfileToken: normalizeFrontendToken(link.frontend_profile_token),
    redirectPath: normalizeRedirectPath(link.redirect_path),
    purpose: String(link.purpose || 'login') === 'verify_and_login' ? 'verify_and_login' : 'login',
  };
}

export async function createCitizenSession(input: CreateSessionInput): Promise<{ token: string; expiresAt: string; sessionId: string }> {
  const db = getDatabase();
  const token = generateOpaqueToken(36);
  const tokenHash = hashToken(token);
  const expiresAtDate = new Date(Date.now() + SESSION_ROLLING_DAYS * 24 * 60 * 60 * 1000);
  const sessionId = uuidv4();

  await db.run(
    `INSERT INTO citizen_sessions (
       id, account_id, session_hash, frontend_profile_token,
       user_agent, ip, created_at, last_seen_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
    [
      sessionId,
      input.accountId,
      tokenHash,
      normalizeFrontendToken(input.frontendProfileToken),
      String(input.userAgent || '').trim() || null,
      String(input.ipAddress || '').trim() || null,
      formatSqlDateTime(expiresAtDate),
    ]
  );

  await markCitizenAccountLoggedIn(input.accountId);
  await writeCitizenAudit('SESSION_CREATED', {
    accountId: input.accountId,
    ipAddress: String(input.ipAddress || '').trim() || null,
    userAgent: String(input.userAgent || '').trim() || null,
    expiresAt: expiresAtDate.toISOString(),
    createdAt: nowIso(),
  });

  return {
    token,
    expiresAt: expiresAtDate.toISOString(),
    sessionId,
  };
}

async function findSessionByToken(rawToken: string): Promise<any | null> {
  const token = String(rawToken || '').trim();
  if (!token) return null;
  const tokenHash = hashToken(token);
  const db = getDatabase();
  const row = await db.get(
    `SELECT s.*, a.email_normalized, a.email_original
     FROM citizen_sessions s
     JOIN citizen_accounts a ON a.id = s.account_id
     WHERE s.session_hash = ?
       AND s.revoked_at IS NULL
     LIMIT 1`,
    [tokenHash]
  );
  return row || null;
}

async function touchCitizenSessionIfNeeded(session: any): Promise<string> {
  const lastSeenMs = parseDateMs(session.last_seen_at || session.created_at || '');
  const now = Date.now();
  const nextExpiry = new Date(now + SESSION_ROLLING_DAYS * 24 * 60 * 60 * 1000);
  const db = getDatabase();
  const needsTouch = !lastSeenMs || now - lastSeenMs >= SESSION_TOUCH_INTERVAL_MS;

  if (needsTouch) {
    await db.run(
      `UPDATE citizen_sessions
       SET last_seen_at = CURRENT_TIMESTAMP,
           expires_at = ?
       WHERE id = ? AND revoked_at IS NULL`,
      [formatSqlDateTime(nextExpiry), session.id]
    );
    return nextExpiry.toISOString();
  }
  const existingExpiresMs = parseDateMs(session.expires_at);
  if (existingExpiresMs > 0) {
    return new Date(existingExpiresMs).toISOString();
  }
  return nextExpiry.toISOString();
}

export async function resolveCitizenSessionFromRequest(req: Request): Promise<CitizenSessionContext | null> {
  const cookies = parseCookieHeader(req.headers.cookie);
  const rawSessionToken = cookies[COOKIE_NAME];
  if (!rawSessionToken) return null;

  const session = await findSessionByToken(rawSessionToken);
  if (!session?.id || !session?.account_id) {
    return null;
  }

  const expiresMs = parseDateMs(session.expires_at);
  if (!expiresMs || expiresMs < Date.now()) {
    const db = getDatabase();
    await db.run(
      `UPDATE citizen_sessions
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
       WHERE id = ?`,
      [session.id]
    );
    await writeCitizenAudit('SESSION_EXPIRED', {
      accountId: session.account_id,
      emailNormalized: session.email_normalized || null,
      sessionId: session.id,
      occurredAt: nowIso(),
    });
    return null;
  }

  const touchedExpiresAt = await touchCitizenSessionIfNeeded(session);
  return {
    sessionId: String(session.id),
    accountId: String(session.account_id),
    email: String(session.email_normalized || ''),
    emailOriginal: String(session.email_original || session.email_normalized || ''),
    frontendProfileToken: normalizeFrontendToken(session.frontend_profile_token),
    expiresAt: touchedExpiresAt,
  };
}

export async function revokeCitizenSessionByRequest(req: Request, reason = 'logout'): Promise<void> {
  const cookies = parseCookieHeader(req.headers.cookie);
  const rawSessionToken = cookies[COOKIE_NAME];
  if (!rawSessionToken) return;

  const session = await findSessionByToken(rawSessionToken);
  if (!session?.id) return;

  const db = getDatabase();
  await db.run(
    `UPDATE citizen_sessions
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
     WHERE id = ?`,
    [session.id]
  );
  await writeCitizenAudit('SESSION_REVOKED', {
    accountId: session.account_id || null,
    emailNormalized: session.email_normalized || null,
    sessionId: session.id,
    reason,
    occurredAt: nowIso(),
  });
}

export function setCitizenSessionCookie(res: Response, token: string): void {
  const config = loadConfig();
  const secure = config.nodeEnv === 'production';
  const maxAgeMs = SESSION_ROLLING_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: maxAgeMs,
    path: '/',
  });
}

export function clearCitizenSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

async function resolveFrontendBaseUrl(request: Request): Promise<string> {
  const config = loadConfig();
  const configured = String(config.frontendUrl || '').trim();
  const forwardedProto = String(request.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const protocol = forwardedProto || (request.secure ? 'https' : 'http');
  const forwardedHost = String(request.get('x-forwarded-host') || '')
    .split(',')[0]
    .trim();
  const requestHost = forwardedHost || String(request.get('host') || '').trim();
  const requestOrigin = requestHost ? `${protocol}://${requestHost}` : '';

  try {
    const { values: general } = await loadGeneralSettings();
    const configuredFromSettings = String(general.callbackUrl || '').trim();
    if (configuredFromSettings) {
      const publicBase = derivePublicBaseUrlFromCallback(configuredFromSettings);
      if (publicBase) return publicBase;
    }
  } catch {
    // Continue with env/request fallback below.
  }

  if (configured) {
    try {
      const configuredUrl = new URL(configured);
      const configuredHost = configuredUrl.hostname.toLowerCase();
      const isLoopbackHost =
        configuredHost === 'localhost' ||
        configuredHost === '127.0.0.1' ||
        configuredHost === '::1';
      const configuredPort = configuredUrl.port || (configuredUrl.protocol === 'https:' ? '443' : '80');
      const isLegacyDevFrontend = isLoopbackHost && (configuredPort === '5173' || configuredPort === '5174');

      // If frontendUrl still points to legacy Vite dev ports, prefer the live request origin.
      if (isLegacyDevFrontend && requestOrigin) {
        return requestOrigin;
      }
      return configuredUrl.toString();
    } catch {
      // Fall through to request-origin fallback below.
    }
  }

  return requestOrigin || 'http://localhost:5173';
}

export async function buildCitizenRedirectUrl(
  req: Request,
  targetPath: string,
  frontendProfileToken?: string
): Promise<string> {
  const base = await resolveFrontendBaseUrl(req);
  let target: URL;
  try {
    target = new URL(base);
  } catch {
    target = new URL('http://localhost:5173');
  }

  const normalizedPath = normalizeRedirectPath(targetPath);
  const basePath = (target.pathname || '/').replace(/\/+$/g, '') || '/';
  target.pathname = basePath === '/' ? normalizedPath : `${basePath}${normalizedPath}`.replace(/\/{2,}/g, '/');
  target.search = '';
  target.hash = '';

  const normalizedFrontendToken = normalizeFrontendToken(frontendProfileToken);
  if (normalizedFrontendToken) {
    target.searchParams.set('frontendToken', normalizedFrontendToken);
  }

  return target.toString();
}

export async function issueCitizenSessionFromEmail(
  req: Request,
  email: string,
  frontendProfileToken?: string
): Promise<{ sessionId: string; expiresAt: string }> {
  const account = await ensureCitizenAccount(email);
  const session = await createCitizenSession({
    accountId: account.id,
    frontendProfileToken,
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  });
  return {
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
  };
}

let cleanupTimer: NodeJS.Timeout | null = null;
let cleanupRunning = false;

export async function cleanupExpiredCitizenAuthData(): Promise<void> {
  const db = getDatabase();
  await db.run(
    `UPDATE citizen_sessions
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
     WHERE revoked_at IS NULL
       AND expires_at IS NOT NULL
       AND datetime(expires_at) < datetime('now')`
  );

  await db.run(
    `DELETE FROM citizen_magic_links
     WHERE consumed_at IS NOT NULL
        OR (expires_at IS NOT NULL AND datetime(expires_at) < datetime('now'))`
  );

  await db.run(
    `DELETE FROM citizen_auth_audit
     WHERE datetime(created_at) < datetime('now', ?)`,
    ['-180 days']
  );
}

export function startCitizenAuthCleanupWorker(): void {
  if (cleanupTimer || cleanupRunning) return;
  cleanupRunning = true;
  void cleanupExpiredCitizenAuthData()
    .catch((error) => {
      console.warn('Citizen auth cleanup failed:', error);
    })
    .finally(() => {
      cleanupRunning = false;
    });

  cleanupTimer = setInterval(() => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    void cleanupExpiredCitizenAuthData()
      .catch((error) => {
        console.warn('Citizen auth cleanup failed:', error);
      })
      .finally(() => {
        cleanupRunning = false;
      });
  }, 10 * 60 * 1000);
}

export const citizenAuthConstants = {
  MAGIC_LINK_TTL_MINUTES,
  SESSION_ROLLING_DAYS,
  COOKIE_NAME,
};

export function getCitizenRequestContext(req: Request): { ipAddress: string; userAgent: string } {
  return {
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  };
}
