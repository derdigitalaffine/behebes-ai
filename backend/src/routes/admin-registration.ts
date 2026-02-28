import crypto from 'crypto';
import bcryptjs from 'bcryptjs';
import express, { Request, Response } from 'express';
import { loadConfig } from '../config.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { normalizeAdminBaseUrl } from '../services/callback-links.js';
import { sendEmail } from '../services/email.js';
import { createAdminNotification } from '../services/admin-notifications.js';
import { loadAdminAccessContext } from '../services/rbac.js';
import { formatSqlDateTime } from '../utils/sql-date.js';
import { getRequestIp, getRequestUserAgent, writeJournalEntry } from '../services/admin-journal.js';

const router = express.Router();
const runtimeConfig = loadConfig();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const REGISTRATION_VERIFY_TTL_HOURS = 48;
const ACTIVE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const REQUEST_RATE_LIMIT_EMAIL_MAX = 5;
const REQUEST_RATE_LIMIT_IP_MAX = 40;

type RegistrationStatus =
  | 'pending_email_verification'
  | 'email_verified'
  | 'pending_review'
  | 'approved'
  | 'rejected';
type RegistrationWorkflowState =
  | 'EMAIL_DOUBLE_OPT_IN'
  | 'PROFILE_CAPTURE'
  | 'INTERNAL_PROCESSING'
  | 'APPROVED'
  | 'REJECTED';

interface RegistrationWorkflowHistoryEntry {
  at: string;
  step: RegistrationWorkflowState;
  event: string;
  actorUserId?: string | null;
  note?: string | null;
  metadata?: Record<string, any>;
}

interface TenantDomainEntry {
  tenantId: string;
  tenantName: string;
}

const requestByEmail = new Map<string, number[]>();
const requestByIp = new Map<string, number[]>();

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function validateEmail(email: string): boolean {
  return !!email && email.length <= 190 && EMAIL_PATTERN.test(email);
}

function extractEmailDomain(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at < 0) return '';
  return normalized.slice(at + 1);
}

function normalizeRegistrationDomain(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/^@+/, '');
}

function normalizeRegistrationDomainsFromDb(value: unknown): string[] {
  if (!value) return [];
  const parseArray = (input: unknown): string[] => {
    const source = Array.isArray(input) ? input : [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of source) {
      const domain = normalizeRegistrationDomain(raw);
      if (!domain || !DOMAIN_PATTERN.test(domain) || seen.has(domain)) continue;
      seen.add(domain);
      result.push(domain);
    }
    return result;
  };
  if (Array.isArray(value)) return parseArray(value);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return parseArray(parsed);
    } catch {
      return [];
    }
  }
  return parseArray(trimmed.split(/[\s,;\n\r]+/g));
}

function normalizeUsername(value: unknown): string {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^-+|-+$/g, '')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80);
  return normalized;
}

function buildUsernameFromEmail(email: string): string {
  const local = normalizeEmail(email).split('@')[0] || '';
  const candidate = normalizeUsername(local);
  if (candidate) return candidate;
  return `user_${Date.now()}`;
}

function normalizeIdList(value: unknown, max = 120): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
    ? value.split(/[\s,;\n\r]+/g)
    : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of source) {
    const id = normalizeText(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= max) break;
  }
  return result;
}

function parseJsonArray(value: unknown): any[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadRegistrationReviewAccess(req: Request) {
  const access = await loadAdminAccessContext(
    normalizeText((req as any).userId),
    normalizeText((req as any).role)
  );
  if (access.isGlobalAdmin) {
    return {
      access,
      tenantAdminSet: new Set<string>(),
      canReview: true,
    };
  }
  const tenantAdminSet = new Set((access.tenantAdminTenantIds || []).map((entry) => normalizeText(entry)));
  return {
    access,
    tenantAdminSet,
    canReview: tenantAdminSet.size > 0,
  };
}

function assertRegistrationTenantAccess(
  review: {
    access: { isGlobalAdmin: boolean };
    tenantAdminSet: Set<string>;
    canReview: boolean;
  },
  tenantId: string
): void {
  if (review.access.isGlobalAdmin) return;
  if (!review.canReview) {
    const error = new Error('Nur Plattform- oder Mandanten-Admins dürfen Registrierungen verwalten.');
    (error as any).status = 403;
    throw error;
  }
  const normalizedTenantId = normalizeText(tenantId);
  if (!normalizedTenantId || !review.tenantAdminSet.has(normalizedTenantId)) {
    const error = new Error('Keine Berechtigung für Registrierungen dieses Mandanten.');
    (error as any).status = 403;
    throw error;
  }
}

function parseWorkflowHistory(value: unknown): RegistrationWorkflowHistoryEntry[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry: any) => ({
        at: normalizeText(entry.at || entry.timestamp) || new Date().toISOString(),
        step: (normalizeText(entry.step) as RegistrationWorkflowState) || 'EMAIL_DOUBLE_OPT_IN',
        event: normalizeText(entry.event) || 'unknown',
        actorUserId: normalizeText(entry.actorUserId || entry.actor_user_id) || null,
        note: normalizeText(entry.note) || null,
        metadata:
          entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
            ? entry.metadata
            : undefined,
      }));
  }
  if (typeof value !== 'string') return [];
  try {
    return parseWorkflowHistory(JSON.parse(value));
  } catch {
    return [];
  }
}

function appendWorkflowHistory(
  currentRaw: unknown,
  entry: RegistrationWorkflowHistoryEntry
): string {
  const current = parseWorkflowHistory(currentRaw);
  current.push(entry);
  return JSON.stringify(current.slice(-120));
}

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateToken(bytes = 36): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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

function allowRegistrationRequestRateLimit(email: string, ipAddress: string): boolean {
  const now = Date.now();
  cleanupRateLimitMap(requestByEmail, now);
  cleanupRateLimitMap(requestByIp, now);
  const okEmail = trackRateLimit(requestByEmail, normalizeEmail(email), REQUEST_RATE_LIMIT_EMAIL_MAX, now);
  const okIp = trackRateLimit(requestByIp, normalizeText(ipAddress), REQUEST_RATE_LIMIT_IP_MAX, now);
  return okEmail && okIp;
}

async function loadTenantDomainMap(): Promise<{
  domainToTenant: Map<string, TenantDomainEntry>;
  collisions: string[];
}> {
  const db = getDatabase();
  const rows = await db.all<any>(
    `SELECT id, name, active, registration_email_domains_json
     FROM tenants`
  );
  const domainToTenant = new Map<string, TenantDomainEntry>();
  const collisions = new Set<string>();
  for (const row of rows || []) {
    if (Number(row?.active ?? 1) !== 1) continue;
    const tenantId = normalizeText(row?.id);
    if (!tenantId) continue;
    const tenantName = normalizeText(row?.name) || tenantId;
    const domains = normalizeRegistrationDomainsFromDb(row?.registration_email_domains_json);
    for (const domain of domains) {
      const existing = domainToTenant.get(domain);
      if (existing && existing.tenantId !== tenantId) {
        collisions.add(domain);
        continue;
      }
      if (!existing) {
        domainToTenant.set(domain, {
          tenantId,
          tenantName,
        });
      }
    }
  }
  return {
    domainToTenant,
    collisions: Array.from(collisions),
  };
}

function deriveRequestOrigin(req?: Request | null): string {
  if (!req) return '';
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto || 'http'}://${host}`;
}

async function deriveAdminBaseUrl(req?: Request): Promise<string> {
  const requestOrigin = deriveRequestOrigin(req);
  if (requestOrigin) {
    const fallbackFromRequest = normalizeAdminBaseUrl(`${requestOrigin.replace(/\/+$/g, '')}/admin`);
    if (fallbackFromRequest) return fallbackFromRequest;
  }

  const configuredAdminBase = normalizeAdminBaseUrl(runtimeConfig.adminUrl);
  if (configuredAdminBase) return configuredAdminBase;

  return 'http://localhost:5174/admin';
}

async function buildRegistrationVerificationLink(token: string, req?: Request): Promise<string> {
  const adminBase = await deriveAdminBaseUrl(req);
  const url = new URL(adminBase);
  url.searchParams.set('registerMode', 'verify');
  url.searchParams.set('registerToken', token);
  return url.toString();
}

async function sendRegistrationVerificationEmail(input: {
  email: string;
  tenantName: string;
  verificationLink: string;
}): Promise<boolean> {
  const html = `
    <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #001c31;">
      <h2 style="margin-bottom: 8px;">E-Mail-Bestaetigung fuer Admin-Registrierung</h2>
      <p>Sie haben eine Registrierung fuer den Mandanten <strong>${input.tenantName}</strong> gestartet.</p>
      <p>Bitte bestaetigen Sie Ihre E-Mail-Adresse ueber den folgenden Link:</p>
      <p style="margin: 18px 0;">
        <a href="${input.verificationLink}" style="display:inline-block;background:#003762;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:700;">
          E-Mail bestaetigen
        </a>
      </p>
      <p>Falls der Button nicht funktioniert, nutzen Sie diesen Link:</p>
      <p style="word-break: break-all; background:#eef5fb; padding:10px; border-radius:6px;">${input.verificationLink}</p>
      <p style="color:#4d6479;font-size:12px;">Der Link ist ${REGISTRATION_VERIFY_TTL_HOURS} Stunden gueltig.</p>
    </div>
  `;

  return sendEmail({
    to: input.email,
    subject: 'Admin-Registrierung: Bitte E-Mail bestaetigen',
    html,
  });
}

async function sendRegistrationDecisionEmail(input: {
  email: string;
  approved: boolean;
  note?: string | null;
  req?: Request;
}): Promise<boolean> {
  const adminBase = await deriveAdminBaseUrl(input.req);
  const loginUrl = new URL(adminBase).toString();
  const noteBlock = input.note ? `<p><strong>Hinweis:</strong> ${input.note}</p>` : '';
  const html = input.approved
    ? `
      <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #001c31;">
        <h2 style="margin-bottom: 8px;">Ihre Registrierung wurde freigeschaltet</h2>
        <p>Ihr Admin-Konto wurde geprueft und aktiviert.</p>
        ${noteBlock}
        <p style="margin: 18px 0;">
          <a href="${loginUrl}" style="display:inline-block;background:#003762;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:700;">
            Zum Admin-Login
          </a>
        </p>
      </div>
    `
    : `
      <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #001c31;">
        <h2 style="margin-bottom: 8px;">Ihre Registrierung wurde abgelehnt</h2>
        <p>Die Registrierung konnte nicht freigeschaltet werden.</p>
        ${noteBlock || '<p>Bei Rueckfragen wenden Sie sich bitte an Ihre Administration.</p>'}
      </div>
    `;

  return sendEmail({
    to: input.email,
    subject: input.approved ? 'Admin-Registrierung freigeschaltet' : 'Admin-Registrierung abgelehnt',
    html,
  });
}

function mapRegistrationRow(row: any, options: { includeHistory?: boolean } = {}) {
  const includeHistory = options.includeHistory === true;
  return {
    id: normalizeText(row?.id),
    emailOriginal: normalizeText(row?.email_original),
    emailNormalized: normalizeText(row?.email_normalized),
    emailDomain: normalizeText(row?.email_domain),
    tenantId: normalizeText(row?.tenant_id),
    tenantName: normalizeText(row?.tenant_name),
    status: normalizeText(row?.status) as RegistrationStatus,
    workflowState: normalizeText(row?.workflow_state) as RegistrationWorkflowState,
    firstName: normalizeText(row?.first_name),
    lastName: normalizeText(row?.last_name),
    username: normalizeText(row?.username),
    requestedOrgUnitIds: normalizeIdList(parseJsonArray(row?.requested_org_unit_ids_json)),
    reviewNote: normalizeText(row?.review_note),
    reviewedBy: normalizeText(row?.reviewed_by) || null,
    reviewedByUsername: normalizeText(row?.reviewed_by_username) || null,
    reviewedAt: normalizeText(row?.reviewed_at) || null,
    approvedUserId: normalizeText(row?.approved_user_id) || null,
    approvedUsername: normalizeText(row?.approved_username) || null,
    emailVerifiedAt: normalizeText(row?.email_verified_at) || null,
    verificationExpiresAt: normalizeText(row?.verification_expires_at) || null,
    createdAt: normalizeText(row?.created_at) || null,
    updatedAt: normalizeText(row?.updated_at) || null,
    workflowHistory: includeHistory ? parseWorkflowHistory(row?.workflow_history_json) : undefined,
  };
}

async function loadTenantOrgUnits(tenantId: string): Promise<Array<{ id: string; name: string; path: string }>> {
  const db = getDatabase();
  const rows = await db.all<any>(
    `SELECT id, parent_id, name
     FROM org_units
     WHERE tenant_id = ?
       AND active = 1
     ORDER BY name ASC`,
    [tenantId]
  );
  const byId = new Map<string, { id: string; parentId: string | null; name: string }>();
  for (const row of rows || []) {
    const id = normalizeText(row?.id);
    if (!id) continue;
    byId.set(id, {
      id,
      parentId: normalizeText(row?.parent_id) || null,
      name: normalizeText(row?.name) || id,
    });
  }

  const pathCache = new Map<string, string>();
  const buildPath = (id: string): string => {
    const cached = pathCache.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node) return id;
    const visited = new Set<string>([id]);
    const segments = [node.name];
    let parentId = node.parentId;
    while (parentId && byId.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId)!;
      segments.unshift(parent.name);
      parentId = parent.parentId;
    }
    const path = segments.join(' / ');
    pathCache.set(id, path);
    return path;
  };

  const result = Array.from(byId.values()).map((entry) => ({
    id: entry.id,
    name: entry.name,
    path: buildPath(entry.id),
  }));

  result.sort((a, b) => a.path.localeCompare(b.path, 'de', { sensitivity: 'base' }));
  return result;
}

async function assertTenantAndOrgUnits(
  tenantId: string,
  orgUnitIds: string[]
): Promise<void> {
  const db = getDatabase();
  const tenant = await db.get<any>(
    `SELECT id
     FROM tenants
     WHERE id = ?`,
    [tenantId]
  );
  if (!tenant?.id) {
    throw new Error('Mandant nicht gefunden.');
  }

  if (orgUnitIds.length === 0) return;
  const placeholders = orgUnitIds.map(() => '?').join(', ');
  const rows = await db.all<any>(
    `SELECT id
     FROM org_units
     WHERE tenant_id = ?
       AND active = 1
       AND id IN (${placeholders})`,
    [tenantId, ...orgUnitIds]
  );
  const existing = new Set((rows || []).map((row: any) => normalizeText(row?.id)).filter(Boolean));
  const missing = orgUnitIds.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    throw new Error(`Ungueltige Organisationseinheit(en): ${Array.from(new Set(missing)).join(', ')}`);
  }
}

async function assertEmailAndUsernameUnique(emailNormalized: string, username: string): Promise<void> {
  const db = getDatabase();
  const existingByEmail = await db.get<any>(
    `SELECT id
     FROM admin_users
     WHERE LOWER(TRIM(COALESCE(email, ''))) = ?
     LIMIT 1`,
    [emailNormalized]
  );
  if (existingByEmail?.id) {
    throw new Error('Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.');
  }

  const existingByUsername = await db.get<any>(
    `SELECT id
     FROM admin_users
     WHERE LOWER(TRIM(username)) = ?
     LIMIT 1`,
    [username.toLowerCase()]
  );
  if (existingByUsername?.id) {
    throw new Error('Ein Benutzer mit diesem Benutzernamen existiert bereits.');
  }
}

async function loadRegistrationByToken(tokenHash: string): Promise<any | null> {
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT r.*, t.name AS tenant_name
     FROM admin_user_registration_requests r
     LEFT JOIN tenants t ON t.id = r.tenant_id
     WHERE r.verification_token_hash = ?
     ORDER BY datetime(r.created_at) DESC
     LIMIT 1`,
    [tokenHash]
  );
  return row || null;
}

async function loadRegistrationById(registrationId: string): Promise<any | null> {
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT r.*,
            t.name AS tenant_name,
            reviewer.username AS reviewed_by_username,
            approved.username AS approved_username
     FROM admin_user_registration_requests r
     LEFT JOIN tenants t ON t.id = r.tenant_id
     LEFT JOIN admin_users reviewer ON reviewer.id = r.reviewed_by
     LEFT JOIN admin_users approved ON approved.id = r.approved_user_id
     WHERE r.id = ?
     LIMIT 1`,
    [registrationId]
  );
  return row || null;
}

// GET /api/auth/admin/register/config
router.get('/config', async (_req: Request, res: Response): Promise<any> => {
  try {
    const mapping = await loadTenantDomainMap();
    const tenantIds = new Set(Array.from(mapping.domainToTenant.values()).map((entry) => entry.tenantId));
    return res.json({
      enabled: mapping.domainToTenant.size > 0 && mapping.collisions.length === 0,
      requiresEmailVerification: true,
      requiresAdminApproval: true,
      configuredDomainCount: mapping.domainToTenant.size,
      configuredTenantCount: tenantIds.size,
      configurationIssues:
        mapping.collisions.length > 0
          ? ['Mehrdeutige Domain-Zuordnungen erkannt. Bitte Domains je Mandant eindeutig setzen.']
          : [],
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Registrierungskonfiguration konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

// POST /api/auth/admin/register/request-email
router.post('/request-email', async (req: Request, res: Response): Promise<any> => {
  try {
    const emailOriginal = normalizeText(req.body?.email);
    const emailNormalized = normalizeEmail(emailOriginal);
    if (!validateEmail(emailNormalized)) {
      return res.status(400).json({ message: 'Bitte eine gueltige E-Mail-Adresse angeben.' });
    }

    const ipAddress = getRequestIp(req);
    if (!allowRegistrationRequestRateLimit(emailNormalized, ipAddress)) {
      return res.status(429).json({
        message: 'Zu viele Registrierungsanfragen. Bitte spaeter erneut versuchen.',
      });
    }

    const domain = extractEmailDomain(emailNormalized);
    if (!domain) {
      return res.status(400).json({ message: 'E-Mail-Domain konnte nicht ermittelt werden.' });
    }

    const mapping = await loadTenantDomainMap();
    if (mapping.domainToTenant.size === 0) {
      return res.status(503).json({
        message: 'Selbstregistrierung ist aktuell nicht konfiguriert.',
      });
    }
    if (mapping.collisions.includes(domain)) {
      return res.status(409).json({
        message: 'Die E-Mail-Domain ist mehrdeutig konfiguriert. Bitte Administration kontaktieren.',
      });
    }
    const tenant = mapping.domainToTenant.get(domain);
    if (!tenant) {
      return res.status(403).json({
        message: 'Diese E-Mail-Domain ist fuer die Selbstregistrierung nicht freigeschaltet.',
      });
    }

    const db = getDatabase();
    const existingUser = await db.get<any>(
      `SELECT id
       FROM admin_users
       WHERE LOWER(TRIM(COALESCE(email, ''))) = ?
       LIMIT 1`,
      [emailNormalized]
    );
    if (existingUser?.id) {
      return res.status(409).json({ message: 'Ein Benutzerkonto mit dieser E-Mail existiert bereits.' });
    }

    const existingRequest = await db.get<any>(
      `SELECT *
       FROM admin_user_registration_requests
       WHERE email_normalized = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 1`,
      [emailNormalized]
    );

    if (existingRequest?.status === 'approved') {
      return res.status(409).json({ message: 'Diese Registrierung wurde bereits freigeschaltet.' });
    }
    if (existingRequest?.status === 'pending_review') {
      return res.json({
        message: 'Die Registrierung wurde bereits eingereicht und wird derzeit geprueft.',
      });
    }

    const verificationToken = generateToken(36);
    const verificationTokenHash = hashToken(verificationToken);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + REGISTRATION_VERIFY_TTL_HOURS * 60 * 60 * 1000);

    const historyJson = appendWorkflowHistory(existingRequest?.workflow_history_json, {
      at: nowIso,
      step: 'EMAIL_DOUBLE_OPT_IN',
      event: 'verification_requested',
      metadata: {
        email: emailNormalized,
        tenantId: tenant.tenantId,
        ipAddress: normalizeText(ipAddress) || null,
      },
    });

    if (existingRequest?.id) {
      await db.run(
        `UPDATE admin_user_registration_requests
         SET email_original = ?,
             email_normalized = ?,
             email_domain = ?,
             tenant_id = ?,
             status = 'pending_email_verification',
             workflow_state = 'EMAIL_DOUBLE_OPT_IN',
             workflow_history_json = ?,
             verification_token_hash = ?,
             verification_expires_at = ?,
             verification_sent_at = CURRENT_TIMESTAMP,
             email_verified_at = NULL,
             username = NULL,
             first_name = NULL,
             last_name = NULL,
             password_hash = NULL,
             requested_org_unit_ids_json = NULL,
             review_note = NULL,
             reviewed_by = NULL,
             reviewed_at = NULL,
             approved_user_id = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          emailOriginal || emailNormalized,
          emailNormalized,
          domain,
          tenant.tenantId,
          historyJson,
          verificationTokenHash,
          formatSqlDateTime(expiresAt),
          normalizeText(existingRequest.id),
        ]
      );
    } else {
      await db.run(
        `INSERT INTO admin_user_registration_requests (
          id, email_original, email_normalized, email_domain, tenant_id,
          status, workflow_state, workflow_history_json,
          verification_token_hash, verification_expires_at, verification_sent_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending_email_verification', 'EMAIL_DOUBLE_OPT_IN', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          createId('aur'),
          emailOriginal || emailNormalized,
          emailNormalized,
          domain,
          tenant.tenantId,
          historyJson,
          verificationTokenHash,
          formatSqlDateTime(expiresAt),
        ]
      );
    }

    const verificationLink = await buildRegistrationVerificationLink(verificationToken, req);
    const sent = await sendRegistrationVerificationEmail({
      email: emailNormalized,
      tenantName: tenant.tenantName,
      verificationLink,
    });
    if (!sent) {
      return res.status(500).json({
        message: 'Bestaetigungs-E-Mail konnte nicht versendet werden.',
      });
    }

    return res.json({
      message: 'Bitte bestaetigen Sie Ihre E-Mail-Adresse ueber den Link in der E-Mail.',
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Registrierungsanfrage konnte nicht verarbeitet werden.',
      error: error?.message || String(error),
    });
  }
});

// POST /api/auth/admin/register/verify-email
router.post('/verify-email', async (req: Request, res: Response): Promise<any> => {
  try {
    const token = normalizeText(req.body?.token || req.query?.token);
    if (!token) return res.status(400).json({ message: 'Token fehlt.' });
    const tokenHash = hashToken(token);
    const row = await loadRegistrationByToken(tokenHash);
    if (!row?.id) {
      return res.status(404).json({ message: 'Registrierung nicht gefunden oder Link ungueltig.' });
    }

    const status = normalizeText(row.status) as RegistrationStatus;
    const expiresMs = parseDateMs(row.verification_expires_at);
    if (
      expiresMs &&
      expiresMs < Date.now() &&
      (status === 'pending_email_verification' || status === 'email_verified')
    ) {
      return res.status(410).json({ message: 'Der Verifizierungslink ist abgelaufen.' });
    }

    let nextStatus = status;
    let nextWorkflowState = normalizeText(row.workflow_state) as RegistrationWorkflowState;
    if (status === 'pending_email_verification') {
      nextStatus = 'email_verified';
      nextWorkflowState = 'PROFILE_CAPTURE';
      const historyJson = appendWorkflowHistory(row.workflow_history_json, {
        at: new Date().toISOString(),
        step: 'PROFILE_CAPTURE',
        event: 'email_verified',
      });
      const update = await getDatabase().run(
        `UPDATE admin_user_registration_requests
         SET status = 'email_verified',
             workflow_state = 'PROFILE_CAPTURE',
             workflow_history_json = ?,
             email_verified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [historyJson, normalizeText(row.id)]
      );
      if (!update?.changes) {
        return res.status(409).json({ message: 'Registrierung wurde parallel aktualisiert.' });
      }
    }

    const orgUnits = await loadTenantOrgUnits(normalizeText(row.tenant_id));
    const latest = await loadRegistrationByToken(tokenHash);
    return res.json({
      status: nextStatus,
      workflowState: nextWorkflowState,
      registrationToken: token,
      registration: {
        id: normalizeText(latest?.id || row.id),
        email: normalizeText(latest?.email_original || row.email_original),
        firstName: normalizeText(latest?.first_name || row.first_name),
        lastName: normalizeText(latest?.last_name || row.last_name),
        username: normalizeText(latest?.username || row.username),
        tenantId: normalizeText(latest?.tenant_id || row.tenant_id),
        tenantName: normalizeText(latest?.tenant_name || row.tenant_name),
      },
      orgUnits,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'E-Mail-Verifizierung fehlgeschlagen.',
      error: error?.message || String(error),
    });
  }
});

// POST /api/auth/admin/register/complete-profile
router.post('/complete-profile', async (req: Request, res: Response): Promise<any> => {
  try {
    const token = normalizeText(req.body?.token);
    if (!token) return res.status(400).json({ message: 'Token fehlt.' });

    const tokenHash = hashToken(token);
    const row = await loadRegistrationByToken(tokenHash);
    if (!row?.id) {
      return res.status(404).json({ message: 'Registrierung nicht gefunden oder Link ungueltig.' });
    }

    const status = normalizeText(row.status) as RegistrationStatus;
    if (status === 'pending_review') {
      return res.status(409).json({ message: 'Registrierung wurde bereits eingereicht und wird geprueft.' });
    }
    if (status === 'approved') {
      return res.status(409).json({ message: 'Registrierung wurde bereits freigeschaltet.' });
    }
    if (status === 'rejected') {
      return res.status(409).json({ message: 'Registrierung wurde abgelehnt. Bitte neu anfragen.' });
    }

    const expiresMs = parseDateMs(row.verification_expires_at);
    if (expiresMs && expiresMs < Date.now()) {
      return res.status(410).json({ message: 'Der Verifizierungslink ist abgelaufen.' });
    }

    const firstName = normalizeText(req.body?.firstName).slice(0, 120);
    const lastName = normalizeText(req.body?.lastName).slice(0, 120);
    const password = String(req.body?.password || '');
    const orgUnitIds = normalizeIdList(req.body?.orgUnitIds);

    if (!firstName || !lastName) {
      return res.status(400).json({ message: 'Vorname und Nachname sind erforderlich.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ message: 'Passwort muss mindestens 8 Zeichen haben.' });
    }
    if (orgUnitIds.length === 0) {
      return res.status(400).json({ message: 'Bitte mindestens eine Organisationseinheit waehlen.' });
    }

    const tenantId = normalizeText(row.tenant_id);
    await assertTenantAndOrgUnits(tenantId, orgUnitIds);

    const emailNormalized = normalizeEmail(row.email_normalized || row.email_original);
    const usernameInput = normalizeText(req.body?.username || row.username || buildUsernameFromEmail(emailNormalized));
    const username = normalizeUsername(usernameInput || buildUsernameFromEmail(emailNormalized));
    if (!username) {
      return res.status(400).json({ message: 'Benutzername ist ungueltig.' });
    }

    const db = getDatabase();
    const conflictingRequestByUsername = await db.get<any>(
      `SELECT id
       FROM admin_user_registration_requests
       WHERE id != ?
         AND LOWER(TRIM(COALESCE(username, ''))) = ?
         AND status IN ('pending_email_verification', 'email_verified', 'pending_review')
       LIMIT 1`,
      [normalizeText(row.id), username.toLowerCase()]
    );
    if (conflictingRequestByUsername?.id) {
      return res.status(409).json({ message: 'Benutzername ist bereits in einer offenen Registrierung belegt.' });
    }

    await assertEmailAndUsernameUnique(emailNormalized, username);

    const passwordHash = await bcryptjs.hash(password, 10);
    const historyJson = appendWorkflowHistory(row.workflow_history_json, {
      at: new Date().toISOString(),
      step: 'INTERNAL_PROCESSING',
      event: 'profile_submitted',
      metadata: {
        tenantId,
        requestedOrgUnitIds: orgUnitIds,
      },
    });

    await db.run(
      `UPDATE admin_user_registration_requests
       SET status = 'pending_review',
           workflow_state = 'INTERNAL_PROCESSING',
           workflow_history_json = ?,
           email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
           username = ?,
           first_name = ?,
           last_name = ?,
           password_hash = ?,
           requested_org_unit_ids_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        historyJson,
        username,
        firstName,
        lastName,
        passwordHash,
        JSON.stringify(orgUnitIds),
        normalizeText(row.id),
      ]
    );

    void createAdminNotification({
      eventType: 'admin_user_registration_pending',
      severity: 'warning',
      roleScope: 'admin',
      title: 'Neue Benutzerregistrierung',
      message: `${firstName} ${lastName} (${emailNormalized}) wartet auf Freigabe.`,
      context: {
        registrationId: normalizeText(row.id),
        tenantId,
      },
    }).catch(() => undefined);

    return res.json({
      status: 'pending_review',
      workflowState: 'INTERNAL_PROCESSING',
      message: 'Registrierung eingereicht. Ein Admin prueft Ihre Angaben.',
    });
  } catch (error: any) {
    const message = normalizeText(error?.message);
    if (message) {
      return res.status(400).json({ message });
    }
    return res.status(500).json({
      message: 'Profildaten konnten nicht gespeichert werden.',
      error: error?.message || String(error),
    });
  }
});

// POST /api/auth/admin/register/status
router.post('/status', async (req: Request, res: Response): Promise<any> => {
  try {
    const token = normalizeText(req.body?.token);
    if (!token) return res.status(400).json({ message: 'Token fehlt.' });
    const row = await loadRegistrationByToken(hashToken(token));
    if (!row?.id) return res.status(404).json({ message: 'Registrierung nicht gefunden.' });
    return res.json({
      status: normalizeText(row.status),
      workflowState: normalizeText(row.workflow_state),
      reviewedAt: normalizeText(row.reviewed_at) || null,
      reviewNote: normalizeText(row.review_note) || null,
      tenantName: normalizeText(row.tenant_name) || null,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Registrierungsstatus konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

// GET /api/auth/admin/register/requests
router.get('/requests', authMiddleware, adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const review = await loadRegistrationReviewAccess(req);
    if (!review.canReview) {
      return res.status(403).json({ message: 'Keine Berechtigung zur Einsicht von Registrierungen.' });
    }

    const requestedStatus = normalizeText(req.query?.status).toLowerCase();
    const allowed = new Set<RegistrationStatus>([
      'pending_email_verification',
      'email_verified',
      'pending_review',
      'approved',
      'rejected',
    ]);
    const statusFilter = allowed.has(requestedStatus as RegistrationStatus)
      ? (requestedStatus as RegistrationStatus)
      : requestedStatus === 'all'
      ? 'all'
      : 'pending_review';
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 200;

    const db = getDatabase();
    const accessParams: any[] = [];
    const accessWhere =
      review.access.isGlobalAdmin
        ? ''
        : (() => {
            const tenantIds = Array.from(review.tenantAdminSet);
            if (tenantIds.length === 0) {
              return 'WHERE 1 = 0';
            }
            accessParams.push(...tenantIds);
            return `WHERE r.tenant_id IN (${tenantIds.map(() => '?').join(', ')})`;
          })();
    const statusWhere =
      statusFilter === 'all'
        ? ''
        : `${accessWhere ? ' AND ' : 'WHERE '}r.status = ?`;
    if (statusFilter !== 'all') {
      accessParams.push(statusFilter);
    }

    const rows = await db.all<any>(
      `SELECT r.*,
              t.name AS tenant_name,
              reviewer.username AS reviewed_by_username,
              approved.username AS approved_username
       FROM admin_user_registration_requests r
       LEFT JOIN tenants t ON t.id = r.tenant_id
       LEFT JOIN admin_users reviewer ON reviewer.id = r.reviewed_by
       LEFT JOIN admin_users approved ON approved.id = r.approved_user_id
       ${accessWhere}
       ${statusWhere}
       ORDER BY datetime(r.updated_at) DESC, datetime(r.created_at) DESC
       LIMIT ?`,
      [...accessParams, limit]
    );

    return res.json({
      status: statusFilter,
      count: rows.length,
      requests: (rows || []).map((row) => mapRegistrationRow(row)),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Registrierungsanfragen konnten nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

// GET /api/auth/admin/register/requests/:registrationId
router.get(
  '/requests/:registrationId',
  authMiddleware,
  adminOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const review = await loadRegistrationReviewAccess(req);
      if (!review.canReview) {
        return res.status(403).json({ message: 'Keine Berechtigung zur Einsicht von Registrierungen.' });
      }

      const registrationId = normalizeText(req.params.registrationId);
      if (!registrationId) return res.status(400).json({ message: 'registrationId fehlt.' });

      const row = await loadRegistrationById(registrationId);
      if (!row?.id) return res.status(404).json({ message: 'Registrierung nicht gefunden.' });
      assertRegistrationTenantAccess(review, normalizeText(row.tenant_id));

      const requestedOrgUnitIds = normalizeIdList(
        parseJsonArray(row.requested_org_unit_ids_json)
      );
      const orgUnits = await loadTenantOrgUnits(normalizeText(row.tenant_id));
      return res.json({
        request: mapRegistrationRow(row, { includeHistory: true }),
        requestedOrgUnitIds,
        availableOrgUnits: orgUnits,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: 'Registrierungsdetails konnten nicht geladen werden.',
        error: error?.message || String(error),
      });
    }
  }
);

// POST /api/auth/admin/register/requests/:registrationId/decision
router.post(
  '/requests/:registrationId/decision',
  authMiddleware,
  adminOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const review = await loadRegistrationReviewAccess(req);
      if (!review.canReview) {
        return res.status(403).json({ message: 'Keine Berechtigung zur Verarbeitung von Registrierungen.' });
      }

      const registrationId = normalizeText(req.params.registrationId);
      if (!registrationId) return res.status(400).json({ message: 'registrationId fehlt.' });
      const action = normalizeText(req.body?.action).toLowerCase();
      if (action !== 'approve' && action !== 'reject') {
        return res.status(400).json({ message: 'action muss approve oder reject sein.' });
      }

      const db = getDatabase();
      const row = await loadRegistrationById(registrationId);
      if (!row?.id) return res.status(404).json({ message: 'Registrierung nicht gefunden.' });
      assertRegistrationTenantAccess(review, normalizeText(row.tenant_id));

      const currentStatus = normalizeText(row.status) as RegistrationStatus;
      if (currentStatus === 'approved') {
        return res.status(409).json({ message: 'Registrierung wurde bereits freigeschaltet.' });
      }
      if (currentStatus === 'rejected') {
        return res.status(409).json({ message: 'Registrierung wurde bereits abgelehnt.' });
      }
      if (currentStatus !== 'pending_review' && action === 'approve') {
        return res.status(409).json({ message: 'Registrierung ist noch nicht im Freigabestatus.' });
      }

      const actorUserId = normalizeText((req as any).userId);
      const note = normalizeText(req.body?.note || req.body?.comment).slice(0, 2000) || null;

      if (action === 'reject') {
        const historyJson = appendWorkflowHistory(row.workflow_history_json, {
          at: new Date().toISOString(),
          step: 'REJECTED',
          event: 'registration_rejected',
          actorUserId: actorUserId || null,
          note,
        });
        await db.run(
          `UPDATE admin_user_registration_requests
           SET status = 'rejected',
               workflow_state = 'REJECTED',
               workflow_history_json = ?,
               review_note = ?,
               reviewed_by = ?,
               reviewed_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [historyJson, note, actorUserId || null, registrationId]
        );

        await writeJournalEntry({
          eventType: 'ADMIN_USER_REGISTRATION_REJECTED',
          severity: 'info',
          adminUserId: actorUserId || null,
          username: req.username || null,
          role: req.role || null,
          sessionId: req.sessionId || null,
          method: req.method,
          path: req.originalUrl || req.path,
          ipAddress: getRequestIp(req),
          userAgent: getRequestUserAgent(req),
          details: {
            registrationId,
            action: 'reject',
            tenantId: normalizeText(row.tenant_id),
          },
        });

        void sendRegistrationDecisionEmail({
          email: normalizeEmail(row.email_original || row.email_normalized),
          approved: false,
          note,
          req,
        }).catch(() => undefined);

        const updated = await loadRegistrationById(registrationId);
        return res.json({
          request: mapRegistrationRow(updated, { includeHistory: true }),
        });
      }

      const requestedOrgUnits = normalizeIdList(
        parseJsonArray(row.requested_org_unit_ids_json)
      );
      const tenantId = normalizeText(req.body?.tenantId || row.tenant_id);
      if (!review.access.isGlobalAdmin && tenantId !== normalizeText(row.tenant_id)) {
        return res.status(403).json({ message: 'Mandantenwechsel bei Freigabe nur für Plattform-Admins erlaubt.' });
      }
      assertRegistrationTenantAccess(review, tenantId);
      const orgUnitIds = normalizeIdList(req.body?.orgUnitIds ?? requestedOrgUnits);
      const firstName = normalizeText(req.body?.firstName || row.first_name).slice(0, 120);
      const lastName = normalizeText(req.body?.lastName || row.last_name).slice(0, 120);
      const emailOriginal = normalizeText(req.body?.email || row.email_original || row.email_normalized);
      const emailNormalized = normalizeEmail(emailOriginal);
      const emailDomain = extractEmailDomain(emailNormalized);
      const username = normalizeUsername(
        req.body?.username || row.username || buildUsernameFromEmail(emailNormalized)
      );

      if (!firstName || !lastName) {
        return res.status(400).json({ message: 'Vorname und Nachname sind erforderlich.' });
      }
      if (!validateEmail(emailNormalized)) {
        return res.status(400).json({ message: 'E-Mail ist ungueltig.' });
      }
      if (!username) {
        return res.status(400).json({ message: 'Benutzername ist ungueltig.' });
      }

      await assertTenantAndOrgUnits(tenantId, orgUnitIds);

      const domainMapping = await loadTenantDomainMap();
      if (domainMapping.collisions.includes(emailDomain)) {
        return res.status(409).json({
          message: 'Die E-Mail-Domain ist mehrdeutig konfiguriert. Bitte Domain-Zuordnung pruefen.',
        });
      }
      const mappedTenant = domainMapping.domainToTenant.get(emailDomain);
      if (!mappedTenant || mappedTenant.tenantId !== tenantId) {
        return res.status(400).json({
          message: 'E-Mail-Domain passt nicht zur Mandantenzuordnung.',
        });
      }

      const passwordHash = normalizeText(row.password_hash);
      if (!passwordHash || !passwordHash.startsWith('$2')) {
        return res.status(400).json({ message: 'Registrierung enthaelt kein gueltiges Passwort-Hash.' });
      }

      await assertEmailAndUsernameUnique(emailNormalized, username);

      await db.exec('BEGIN');
      try {
        const userId = createId('user');
        await db.run(
          `INSERT INTO admin_users (
            id, username, password_hash, role, active, email, first_name, last_name, is_global_admin, created_at, updated_at
          ) VALUES (?, ?, ?, 'SACHBEARBEITER', 1, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, username, passwordHash, emailNormalized, firstName, lastName]
        );

        await db.run(
          `INSERT INTO admin_user_tenant_scopes (id, admin_user_id, tenant_id, is_tenant_admin)
           VALUES (?, ?, ?, 0)`,
          [createId('auts'), userId, tenantId]
        );

        for (const orgUnitId of orgUnitIds) {
          await db.run(
            `INSERT INTO admin_user_org_scopes (id, admin_user_id, tenant_id, org_unit_id, can_write)
             VALUES (?, ?, ?, ?, 1)`,
            [createId('auos'), userId, tenantId, orgUnitId]
          );
        }

        const historyJson = appendWorkflowHistory(row.workflow_history_json, {
          at: new Date().toISOString(),
          step: 'APPROVED',
          event: 'registration_approved',
          actorUserId: actorUserId || null,
          note,
          metadata: {
            approvedUserId: userId,
            tenantId,
            orgUnitIds,
          },
        });

        await db.run(
          `UPDATE admin_user_registration_requests
           SET email_original = ?,
               email_normalized = ?,
               email_domain = ?,
               tenant_id = ?,
               status = 'approved',
               workflow_state = 'APPROVED',
               workflow_history_json = ?,
               username = ?,
               first_name = ?,
               last_name = ?,
               requested_org_unit_ids_json = ?,
               review_note = ?,
               reviewed_by = ?,
               reviewed_at = CURRENT_TIMESTAMP,
               approved_user_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            emailOriginal || emailNormalized,
            emailNormalized,
            emailDomain,
            tenantId,
            historyJson,
            username,
            firstName,
            lastName,
            JSON.stringify(orgUnitIds),
            note,
            actorUserId || null,
            userId,
            registrationId,
          ]
        );

        await db.exec('COMMIT');

        await writeJournalEntry({
          eventType: 'ADMIN_USER_REGISTRATION_APPROVED',
          severity: 'info',
          adminUserId: actorUserId || null,
          username: req.username || null,
          role: req.role || null,
          sessionId: req.sessionId || null,
          method: req.method,
          path: req.originalUrl || req.path,
          ipAddress: getRequestIp(req),
          userAgent: getRequestUserAgent(req),
          details: {
            registrationId,
            action: 'approve',
            tenantId,
            approvedUserId: userId,
            orgUnitCount: orgUnitIds.length,
          },
        });

        void sendRegistrationDecisionEmail({
          email: emailNormalized,
          approved: true,
          note,
          req,
        }).catch(() => undefined);
      } catch (transactionError) {
        await db.exec('ROLLBACK');
        throw transactionError;
      }

      const updated = await loadRegistrationById(registrationId);
      return res.json({
        request: mapRegistrationRow(updated, { includeHistory: true }),
      });
    } catch (error: any) {
      const message = normalizeText(error?.message);
      if (message) {
        if (
          message.includes('existiert bereits') ||
          message.includes('Ungueltige Organisationseinheit') ||
          message.includes('Mandant nicht gefunden') ||
          message.includes('passt nicht zur Mandantenzuordnung')
        ) {
          return res.status(409).json({ message });
        }
        if (
          message.includes('ungueltig') ||
          message.includes('erforderlich') ||
          message.includes('gueltiges Passwort-Hash')
        ) {
          return res.status(400).json({ message });
        }
      }
      return res.status(500).json({
        message: 'Registrierungsentscheidung konnte nicht gespeichert werden.',
        error: error?.message || String(error),
      });
    }
  }
);

export default router;
