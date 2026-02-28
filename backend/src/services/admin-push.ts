import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import webpush from 'web-push';
import { getDatabase } from '../database.js';
import { loadConfig } from '../config.js';

const ACTIVE_ADMIN_SESSION_SQL = `
  COALESCE(s.is_active, 1) = 1
  AND s.logged_out_at IS NULL
  AND (s.expires_at IS NULL OR datetime(s.expires_at) >= datetime('now'))
`;

let pushInitialized = false;
let pushEnabled = false;
let pushPublicKey: string | null = null;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function truncate(value: string, maxLength: number): string {
  const normalized = String(value || '');
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength);
}

function buildEndpointHash(endpoint: string): string {
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

function normalizeRelativeUrl(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return '/ops/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/ops/dashboard';
  return truncate(raw, 500);
}

function ensurePushConfigured(): void {
  if (pushInitialized) return;
  pushInitialized = true;

  const config = loadConfig();
  let publicKey = normalizeText(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || config.webPush.vapidPublicKey);
  let privateKey = normalizeText(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || config.webPush.vapidPrivateKey);
  let subject =
    normalizeText(process.env.WEB_PUSH_VAPID_SUBJECT || config.webPush.vapidSubject) || 'mailto:noreply@example.com';
  if (!/^mailto:|^https?:\/\//i.test(subject)) {
    subject = `mailto:${subject}`;
  }

  if (!publicKey || !privateKey) {
    if (config.nodeEnv !== 'production') {
      const generated = webpush.generateVAPIDKeys();
      publicKey = generated.publicKey;
      privateKey = generated.privateKey;
      console.warn(
        'WebPush VAPID keys missing. Generated ephemeral development keys for admin push. Set WEB_PUSH_VAPID_* for persistent push.'
      );
    } else {
      pushEnabled = false;
      pushPublicKey = null;
      return;
    }
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    pushEnabled = true;
    pushPublicKey = publicKey;
  } catch (error) {
    console.warn('Failed to initialize admin web push:', error);
    pushEnabled = false;
    pushPublicKey = null;
  }
}

export function resetAdminPushConfiguration(): void {
  pushInitialized = false;
  pushEnabled = false;
  pushPublicKey = null;
}

function isRecoverablePushErrorStatus(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

interface AdminPushSubscriptionInput {
  adminUserId: string;
  sessionId?: string;
  userAgent?: string;
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
}

export interface AdminPushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  eventType?: string;
  metadata?: Record<string, any>;
}

export function isAdminPushEnabled(): boolean {
  ensurePushConfigured();
  return pushEnabled;
}

export function getAdminPushPublicKey(): string | null {
  ensurePushConfigured();
  return pushEnabled ? pushPublicKey : null;
}

export async function upsertAdminPushSubscription(input: AdminPushSubscriptionInput): Promise<{ id: string }> {
  const adminUserId = normalizeText(input.adminUserId);
  const sessionId = normalizeText(input.sessionId || '');
  const endpoint = normalizeText(input.subscription?.endpoint);
  const p256dh = normalizeText(input.subscription?.keys?.p256dh);
  const auth = normalizeText(input.subscription?.keys?.auth);
  const userAgent = truncate(normalizeText(input.userAgent || ''), 1000) || null;

  if (!adminUserId) throw new Error('admin_user_id_required');
  if (!endpoint || !p256dh || !auth) throw new Error('invalid_push_subscription');

  const endpointHash = buildEndpointHash(endpoint);
  const id = uuidv4();
  const db = getDatabase();

  await db.run(
    `INSERT INTO admin_push_subscriptions (
       id, admin_user_id, session_id, endpoint_hash, endpoint, p256dh, auth, user_agent,
       created_at, last_seen_at, revoked_at, fail_count, last_error
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, 0, NULL)
     ON CONFLICT(endpoint_hash) DO UPDATE SET
       admin_user_id = excluded.admin_user_id,
       session_id = excluded.session_id,
       endpoint = excluded.endpoint,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent,
       last_seen_at = CURRENT_TIMESTAMP,
       revoked_at = NULL,
       fail_count = 0,
       last_error = NULL`,
    [id, adminUserId, sessionId || null, endpointHash, endpoint, p256dh, auth, userAgent]
  );

  const row = await db.get<any>(
    `SELECT id
     FROM admin_push_subscriptions
     WHERE endpoint_hash = ?
     LIMIT 1`,
    [endpointHash]
  );

  return {
    id: normalizeText(row?.id || id),
  };
}

export async function revokeAdminPushSubscription(input: {
  adminUserId: string;
  sessionId?: string;
  endpoint?: string;
}): Promise<number> {
  const adminUserId = normalizeText(input.adminUserId);
  const sessionId = normalizeText(input.sessionId || '');
  const endpoint = normalizeText(input.endpoint || '');
  if (!adminUserId) return 0;

  const db = getDatabase();

  if (endpoint) {
    const endpointHash = buildEndpointHash(endpoint);
    const result = await db.run(
      `UPDATE admin_push_subscriptions
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
       WHERE admin_user_id = ?
         AND endpoint_hash = ?
         AND revoked_at IS NULL`,
      [adminUserId, endpointHash]
    );
    return Number(result?.changes || 0);
  }

  if (sessionId) {
    const result = await db.run(
      `UPDATE admin_push_subscriptions
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
       WHERE admin_user_id = ?
         AND session_id = ?
         AND revoked_at IS NULL`,
      [adminUserId, sessionId]
    );
    return Number(result?.changes || 0);
  }

  const result = await db.run(
    `UPDATE admin_push_subscriptions
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
     WHERE admin_user_id = ?
       AND revoked_at IS NULL`,
    [adminUserId]
  );
  return Number(result?.changes || 0);
}

async function loadSubscriptionsForAdmin(adminUserId: string): Promise<any[]> {
  const db = getDatabase();
  return db.all(
    `SELECT
       p.id,
       p.endpoint,
       p.p256dh,
       p.auth,
       p.fail_count,
       p.session_id
     FROM admin_push_subscriptions p
     LEFT JOIN admin_sessions s ON s.id = p.session_id
     INNER JOIN admin_users u ON u.id = p.admin_user_id
     WHERE p.admin_user_id = ?
       AND COALESCE(u.active, 1) = 1
       AND p.revoked_at IS NULL
       AND (
         p.session_id IS NULL
         OR (
           s.id IS NOT NULL
           AND ${ACTIVE_ADMIN_SESSION_SQL}
         )
       )
     ORDER BY datetime(COALESCE(p.last_seen_at, p.created_at)) DESC`,
    [adminUserId]
  );
}

export async function sendAdminPushToUser(
  adminUserId: string,
  payload: AdminPushPayload
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  ensurePushConfigured();
  if (!pushEnabled) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const normalizedAdminUserId = normalizeText(adminUserId);
  if (!normalizedAdminUserId) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const subscriptions = await loadSubscriptionsForAdmin(normalizedAdminUserId);
  if (!subscriptions || subscriptions.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const title = truncate(normalizeText(payload.title) || 'Neue Benachrichtigung', 240);
  const body = truncate(normalizeText(payload.body) || 'Es liegt eine neue Benachrichtigung vor.', 12000);
  const url = normalizeRelativeUrl(payload.url || '/ops/dashboard');
  const tag = truncate(normalizeText(payload.tag || ''), 200) || null;
  const eventType = truncate(normalizeText(payload.eventType || ''), 120) || null;
  const metadata =
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? payload.metadata
      : null;

  const db = getDatabase();
  let succeeded = 0;
  let failed = 0;

  for (const row of subscriptions) {
    const subscription = {
      endpoint: String(row?.endpoint || ''),
      keys: {
        p256dh: String(row?.p256dh || ''),
        auth: String(row?.auth || ''),
      },
    };

    if (!subscription.endpoint || !subscription.keys.p256dh || !subscription.keys.auth) {
      continue;
    }

    try {
      await webpush.sendNotification(
        subscription as any,
        JSON.stringify({
          title,
          body,
          url,
          tag,
          eventType,
          metadata,
          timestamp: Date.now(),
        }),
        {
          TTL: 60 * 60 * 12,
          urgency: 'normal',
        }
      );
      succeeded += 1;

      await db.run(
        `UPDATE admin_push_subscriptions
         SET last_seen_at = CURRENT_TIMESTAMP,
             fail_count = 0,
             last_error = NULL
         WHERE id = ?`,
        [row.id]
      );
    } catch (error: any) {
      failed += 1;
      const statusCode = Number(error?.statusCode || 0);
      const nextFailCount = Number(row?.fail_count || 0) + 1;
      const shouldRevoke = isRecoverablePushErrorStatus(statusCode) || nextFailCount >= 5;

      await db.run(
        `UPDATE admin_push_subscriptions
         SET last_seen_at = CURRENT_TIMESTAMP,
             fail_count = ?,
             last_error = ?,
             revoked_at = CASE WHEN ? = 1 THEN COALESCE(revoked_at, CURRENT_TIMESTAMP) ELSE revoked_at END
         WHERE id = ?`,
        [nextFailCount, truncate(String(error?.message || 'push_send_failed'), 2000), shouldRevoke ? 1 : 0, row.id]
      );
    }
  }

  return {
    attempted: subscriptions.length,
    succeeded,
    failed,
  };
}

export async function sendAdminPushToUsers(adminUserIds: string[], payload: AdminPushPayload): Promise<void> {
  const uniqueUserIds = Array.from(
    new Set(
      (adminUserIds || [])
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
    )
  );

  for (const adminUserId of uniqueUserIds) {
    try {
      await sendAdminPushToUser(adminUserId, payload);
    } catch (error) {
      console.warn(`Admin push delivery failed for user ${adminUserId}:`, error);
    }
  }
}
