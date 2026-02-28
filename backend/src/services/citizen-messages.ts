import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import webpush from 'web-push';
import { getDatabase } from '../database.js';
import { loadConfig } from '../config.js';

const ACTIVE_SESSION_SQL = `
  s.revoked_at IS NULL
  AND (s.expires_at IS NULL OR datetime(s.expires_at) >= datetime('now'))
`;

const MAX_MESSAGE_TITLE_LENGTH = 240;
const MAX_MESSAGE_BODY_LENGTH = 12000;
const MAX_MESSAGE_ACTION_URL_LENGTH = 500;
const MAX_SOURCE_REF_LENGTH = 191;
const MAX_SOURCE_TYPE_LENGTH = 64;

let pushInitialized = false;
let pushEnabled = false;
let pushPublicKey: string | null = null;

export interface CitizenAppMessage {
  id: string;
  sourceType: string;
  sourceRef: string | null;
  title: string;
  body: string;
  htmlContent: string | null;
  actionUrl: string | null;
  metadata: Record<string, any> | null;
  createdAt: string | null;
  readAt: string | null;
  deliveredPushAt: string | null;
  isRead: boolean;
}

export interface CitizenAppMessageListResult {
  items: CitizenAppMessage[];
  total: number;
  unreadCount: number;
  limit: number;
  offset: number;
  status: 'all' | 'read' | 'unread';
}

interface CreateCitizenMessageInput {
  accountId: string;
  sourceType?: string;
  sourceRef?: string | null;
  title: string;
  body: string;
  htmlContent?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, any> | null;
  sendPush?: boolean;
}

interface UpsertPushSubscriptionInput {
  accountId: string;
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

interface BroadcastCitizenMessageInput {
  mode: 'all_active' | 'account_ids';
  accountIds?: string[];
  title: string;
  body: string;
  actionUrl?: string | null;
  sourceRef?: string | null;
  sendPush?: boolean;
  metadata?: Record<string, any> | null;
}

interface BroadcastCitizenMessageResult {
  targetMode: 'all_active' | 'account_ids';
  targetedAccounts: number;
  matchedAccounts: number;
  createdMessages: number;
  pushedMessages: number;
  failedPushMessages: number;
}

interface PushSendResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncate(value: string, maxLength: number): string {
  const normalized = String(value || '');
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength);
}

function normalizeSourceType(value: unknown): string {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return 'system';
  return truncate(normalized.replace(/[^a-z0-9_-]/g, '_'), MAX_SOURCE_TYPE_LENGTH) || 'system';
}

function normalizeActionUrl(value: unknown): string | null {
  const raw = normalizeString(value);
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  return truncate(raw, MAX_MESSAGE_ACTION_URL_LENGTH);
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function parseRecipientEmails(to: string): string[] {
  const parts = String(to || '')
    .split(/[;,]/g)
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
  return Array.from(new Set(parts));
}

function stripHtml(input: string): string {
  return String(input || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractFirstUrlFromHtml(html: string): string | null {
  if (!html) return null;
  const hrefMatch = html.match(/<a[^>]+href=['"]([^'"]+)['"]/i);
  if (!hrefMatch?.[1]) return null;
  return normalizeActionUrl(hrefMatch[1]);
}

function extractFirstUrlFromText(text: string): string | null {
  if (!text) return null;
  const urlMatch = text.match(/https?:\/\/[^\s<>"')]+/i);
  if (!urlMatch?.[0]) return null;
  return normalizeActionUrl(urlMatch[0]);
}

function sanitizeMessageTitle(input: string): string {
  return truncate(normalizeString(input) || 'Neue Nachricht', MAX_MESSAGE_TITLE_LENGTH);
}

function sanitizeMessageBody(input: string): string {
  const normalized = String(input || '').trim();
  if (!normalized) return '';
  return truncate(normalized, MAX_MESSAGE_BODY_LENGTH);
}

function buildEndpointHash(endpoint: string): string {
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

function isRecoverablePushErrorStatus(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

function ensurePushConfigured(): void {
  if (pushInitialized) return;
  pushInitialized = true;

  const config = loadConfig();
  let publicKey = normalizeString(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || config.webPush.vapidPublicKey);
  let privateKey = normalizeString(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || config.webPush.vapidPrivateKey);
  let subject =
    normalizeString(process.env.WEB_PUSH_VAPID_SUBJECT || config.webPush.vapidSubject) || 'mailto:noreply@example.com';
  if (!/^mailto:|^https?:\/\//i.test(subject)) {
    subject = `mailto:${subject}`;
  }

  if (!publicKey || !privateKey) {
    if (config.nodeEnv !== 'production') {
      const generated = webpush.generateVAPIDKeys();
      publicKey = generated.publicKey;
      privateKey = generated.privateKey;
      console.warn(
        'WebPush VAPID keys missing. Generated ephemeral development keys. Set WEB_PUSH_VAPID_* for persistent push.'
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
    console.warn('Failed to initialize web push:', error);
    pushEnabled = false;
    pushPublicKey = null;
  }
}

export function resetCitizenPushConfiguration(): void {
  pushInitialized = false;
  pushEnabled = false;
  pushPublicKey = null;
}

export function isCitizenPushEnabled(): boolean {
  ensurePushConfigured();
  return pushEnabled;
}

export function getCitizenPushPublicKey(): string | null {
  ensurePushConfigured();
  return pushEnabled ? pushPublicKey : null;
}

function mapMessageRow(row: any): CitizenAppMessage {
  let metadata: Record<string, any> | null = null;
  if (typeof row?.metadata_json === 'string' && row.metadata_json.trim()) {
    try {
      const parsed = JSON.parse(row.metadata_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, any>;
      }
    } catch {
      metadata = null;
    }
  }

  return {
    id: String(row?.id || ''),
    sourceType: String(row?.source_type || 'system'),
    sourceRef: row?.source_ref ? String(row.source_ref) : null,
    title: String(row?.title || ''),
    body: String(row?.body || ''),
    htmlContent: row?.html_content ? String(row.html_content) : null,
    actionUrl: row?.action_url ? String(row.action_url) : null,
    metadata,
    createdAt: row?.created_at || null,
    readAt: row?.read_at || null,
    deliveredPushAt: row?.delivered_push_at || null,
    isRead: !!row?.read_at,
  };
}

export async function listCitizenAppMessages(
  accountId: string,
  input?: { status?: 'all' | 'read' | 'unread'; limit?: number; offset?: number }
): Promise<CitizenAppMessageListResult> {
  const normalizedAccountId = normalizeString(accountId);
  const status = input?.status === 'read' || input?.status === 'unread' ? input.status : 'all';
  const limit = Math.min(100, Math.max(1, Number(input?.limit || 30)));
  const offset = Math.max(0, Number(input?.offset || 0));
  if (!normalizedAccountId) {
    return { items: [], total: 0, unreadCount: 0, limit, offset, status };
  }

  const db = getDatabase();
  const statusWhere =
    status === 'read' ? 'AND m.read_at IS NOT NULL' : status === 'unread' ? 'AND m.read_at IS NULL' : '';

  const [rows, totalRow, unreadRow] = await Promise.all([
    db.all(
      `SELECT m.*
       FROM citizen_app_messages m
       WHERE m.account_id = ?
       ${statusWhere}
       ORDER BY datetime(m.created_at) DESC, m.id DESC
       LIMIT ? OFFSET ?`,
      [normalizedAccountId, limit, offset]
    ),
    db.get(
      `SELECT COUNT(*) AS count
       FROM citizen_app_messages m
       WHERE m.account_id = ?
       ${statusWhere}`,
      [normalizedAccountId]
    ),
    db.get(
      `SELECT COUNT(*) AS count
       FROM citizen_app_messages
       WHERE account_id = ? AND read_at IS NULL`,
      [normalizedAccountId]
    ),
  ]);

  return {
    items: (rows || []).map((row: any) => mapMessageRow(row)),
    total: Number(totalRow?.count || 0),
    unreadCount: Number(unreadRow?.count || 0),
    limit,
    offset,
    status,
  };
}

export async function getCitizenUnreadMessageCount(accountId: string): Promise<number> {
  const normalizedAccountId = normalizeString(accountId);
  if (!normalizedAccountId) return 0;
  const db = getDatabase();
  const row = await db.get(
    `SELECT COUNT(*) AS count
     FROM citizen_app_messages
     WHERE account_id = ? AND read_at IS NULL`,
    [normalizedAccountId]
  );
  return Number(row?.count || 0);
}

export async function markCitizenMessageReadState(
  accountId: string,
  messageId: string,
  read: boolean
): Promise<boolean> {
  const normalizedAccountId = normalizeString(accountId);
  const normalizedMessageId = normalizeString(messageId);
  if (!normalizedAccountId || !normalizedMessageId) return false;

  const db = getDatabase();
  const result = await db.run(
    `UPDATE citizen_app_messages
     SET read_at = ${read ? 'COALESCE(read_at, CURRENT_TIMESTAMP)' : 'NULL'}
     WHERE id = ? AND account_id = ?`,
    [normalizedMessageId, normalizedAccountId]
  );
  return Number(result?.changes || 0) > 0;
}

export async function markAllCitizenMessagesRead(accountId: string): Promise<number> {
  const normalizedAccountId = normalizeString(accountId);
  if (!normalizedAccountId) return 0;
  const db = getDatabase();
  const result = await db.run(
    `UPDATE citizen_app_messages
     SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE account_id = ? AND read_at IS NULL`,
    [normalizedAccountId]
  );
  return Number(result?.changes || 0);
}

async function loadPushSubscriptionsForAccount(accountId: string): Promise<any[]> {
  const db = getDatabase();
  return db.all(
    `SELECT
       p.id,
       p.endpoint,
       p.p256dh,
       p.auth,
       p.fail_count,
       p.session_id
     FROM citizen_push_subscriptions p
     LEFT JOIN citizen_sessions s ON s.id = p.session_id
     WHERE p.account_id = ?
       AND p.revoked_at IS NULL
       AND (
       p.session_id IS NULL
        OR (
          s.id IS NOT NULL
          AND ${ACTIVE_SESSION_SQL}
        )
       )
     ORDER BY datetime(COALESCE(p.last_seen_at, p.created_at)) DESC`,
    [accountId]
  );
}

async function sendPushToAccount(
  accountId: string,
  payload: { title: string; body: string; url?: string | null; messageId?: string }
): Promise<PushSendResult> {
  ensurePushConfigured();
  if (!pushEnabled) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const db = getDatabase();
  const subscriptions = await loadPushSubscriptionsForAccount(accountId);
  if (!subscriptions || subscriptions.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

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
          title: payload.title,
          body: payload.body,
          url: payload.url || '/me/messages',
          messageId: payload.messageId || null,
          timestamp: Date.now(),
        }),
        {
          TTL: 60 * 60 * 12,
          urgency: 'normal',
        }
      );
      succeeded += 1;
      await db.run(
        `UPDATE citizen_push_subscriptions
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
        `UPDATE citizen_push_subscriptions
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

export async function createCitizenAppMessage(input: CreateCitizenMessageInput): Promise<{
  messageId: string;
  pushed: boolean;
  pushAttempted: number;
  pushSucceeded: number;
  pushFailed: number;
}> {
  const accountId = normalizeString(input.accountId);
  if (!accountId) {
    throw new Error('account_id_required');
  }

  const title = sanitizeMessageTitle(input.title);
  const body = sanitizeMessageBody(input.body);
  if (!title || !body) {
    throw new Error('message_title_and_body_required');
  }

  const sourceType = normalizeSourceType(input.sourceType || 'system');
  const sourceRef = truncate(normalizeString(input.sourceRef || ''), MAX_SOURCE_REF_LENGTH) || null;
  const actionUrl = normalizeActionUrl(input.actionUrl || null);
  const htmlContent = input.htmlContent ? truncate(String(input.htmlContent), 64000) : null;
  const metadataJson =
    input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? JSON.stringify(input.metadata)
      : null;

  const db = getDatabase();
  const messageId = uuidv4();
  await db.run(
    `INSERT INTO citizen_app_messages (
       id, account_id, source_type, source_ref, title, body, html_content, action_url, metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [messageId, accountId, sourceType, sourceRef, title, body, htmlContent, actionUrl, metadataJson]
  );

  let pushResult: PushSendResult = { attempted: 0, succeeded: 0, failed: 0 };
  if (input.sendPush !== false) {
    pushResult = await sendPushToAccount(accountId, {
      title,
      body,
      url: actionUrl || '/me/messages',
      messageId,
    });
    if (pushResult.succeeded > 0) {
      await db.run(
        `UPDATE citizen_app_messages
         SET delivered_push_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [messageId]
      );
    }
  }

  return {
    messageId,
    pushed: pushResult.succeeded > 0,
    pushAttempted: pushResult.attempted,
    pushSucceeded: pushResult.succeeded,
    pushFailed: pushResult.failed,
  };
}

async function resolveActiveAccountIdsByEmail(recipientEmails: string[]): Promise<Map<string, string>> {
  const normalizedEmails = Array.from(new Set(recipientEmails.map((entry) => normalizeEmail(entry)).filter(Boolean)));
  if (normalizedEmails.length === 0) return new Map();

  const db = getDatabase();
  const placeholders = normalizedEmails.map(() => '?').join(', ');
  const rows = await db.all(
    `SELECT a.id, a.email_normalized
     FROM citizen_accounts a
     WHERE a.email_normalized IN (${placeholders})
       AND EXISTS (
         SELECT 1
         FROM citizen_sessions s
         WHERE s.account_id = a.id
           AND ${ACTIVE_SESSION_SQL}
       )`,
    normalizedEmails
  );

  const result = new Map<string, string>();
  (rows || []).forEach((row: any) => {
    const email = normalizeEmail(row?.email_normalized);
    const id = normalizeString(row?.id);
    if (!email || !id) return;
    result.set(email, id);
  });
  return result;
}

export async function mirrorCitizenEmailToAppMessages(input: {
  to: string;
  subject: string;
  html: string;
  text?: string | null;
  sourceRef?: string | null;
  metadata?: Record<string, any> | null;
}): Promise<{ matchedAccounts: number; createdMessages: number; pushedMessages: number }> {
  const recipients = parseRecipientEmails(input.to);
  if (recipients.length === 0) {
    return { matchedAccounts: 0, createdMessages: 0, pushedMessages: 0 };
  }

  const accountByEmail = await resolveActiveAccountIdsByEmail(recipients);
  if (accountByEmail.size === 0) {
    return { matchedAccounts: 0, createdMessages: 0, pushedMessages: 0 };
  }

  const actionUrl =
    extractFirstUrlFromHtml(String(input.html || '')) ||
    extractFirstUrlFromText(String(input.text || '')) ||
    null;
  const messageTitle = sanitizeMessageTitle(String(input.subject || '').trim() || 'Neue Nachricht');
  const rawBody = normalizeString(input.text || '') || stripHtml(String(input.html || ''));
  const messageBody = sanitizeMessageBody(rawBody || 'Sie haben eine neue Nachricht erhalten.');
  if (!messageBody) {
    return { matchedAccounts: accountByEmail.size, createdMessages: 0, pushedMessages: 0 };
  }

  const sourceRef = truncate(normalizeString(input.sourceRef || ''), MAX_SOURCE_REF_LENGTH) || null;
  let createdMessages = 0;
  let pushedMessages = 0;

  for (const email of recipients) {
    const accountId = accountByEmail.get(email);
    if (!accountId) continue;
    try {
      const result = await createCitizenAppMessage({
        accountId,
        sourceType: 'email',
        sourceRef,
        title: messageTitle,
        body: messageBody,
        htmlContent: String(input.html || '').trim() || null,
        actionUrl,
        metadata: {
          ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
          recipientEmail: email,
        },
        sendPush: true,
      });
      createdMessages += 1;
      if (result.pushed) pushedMessages += 1;
    } catch (error) {
      console.warn('Failed to mirror citizen email to app message:', error);
    }
  }

  return {
    matchedAccounts: accountByEmail.size,
    createdMessages,
    pushedMessages,
  };
}

export async function upsertCitizenPushSubscription(input: UpsertPushSubscriptionInput): Promise<{ id: string }> {
  const accountId = normalizeString(input.accountId);
  const sessionId = normalizeString(input.sessionId || '');
  const endpoint = normalizeString(input.subscription?.endpoint);
  const p256dh = normalizeString(input.subscription?.keys?.p256dh);
  const auth = normalizeString(input.subscription?.keys?.auth);
  const userAgent = truncate(normalizeString(input.userAgent || ''), 1000) || null;
  if (!accountId) throw new Error('account_id_required');
  if (!endpoint || !p256dh || !auth) throw new Error('invalid_push_subscription');

  const endpointHash = buildEndpointHash(endpoint);
  const id = uuidv4();
  const db = getDatabase();
  await db.run(
    `INSERT INTO citizen_push_subscriptions (
       id, account_id, session_id, endpoint_hash, endpoint, p256dh, auth, user_agent,
       created_at, last_seen_at, revoked_at, fail_count, last_error
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, 0, NULL)
     ON CONFLICT(endpoint_hash) DO UPDATE SET
       account_id = excluded.account_id,
       session_id = excluded.session_id,
       endpoint = excluded.endpoint,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent,
       last_seen_at = CURRENT_TIMESTAMP,
       revoked_at = NULL,
       fail_count = 0,
       last_error = NULL`,
    [id, accountId, sessionId || null, endpointHash, endpoint, p256dh, auth, userAgent]
  );

  const row = await db.get(
    `SELECT id
     FROM citizen_push_subscriptions
     WHERE endpoint_hash = ?
     LIMIT 1`,
    [endpointHash]
  );
  return {
    id: normalizeString(row?.id || id),
  };
}

export async function revokeCitizenPushSubscription(input: {
  accountId: string;
  sessionId?: string;
  endpoint?: string;
}): Promise<number> {
  const accountId = normalizeString(input.accountId);
  const sessionId = normalizeString(input.sessionId || '');
  const endpoint = normalizeString(input.endpoint || '');
  if (!accountId) return 0;

  const db = getDatabase();
  if (endpoint) {
    const endpointHash = buildEndpointHash(endpoint);
    const result = await db.run(
      `UPDATE citizen_push_subscriptions
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
       WHERE account_id = ?
         AND endpoint_hash = ?
         AND revoked_at IS NULL`,
      [accountId, endpointHash]
    );
    return Number(result?.changes || 0);
  }

  if (sessionId) {
    const result = await db.run(
      `UPDATE citizen_push_subscriptions
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
       WHERE account_id = ?
         AND session_id = ?
         AND revoked_at IS NULL`,
      [accountId, sessionId]
    );
    return Number(result?.changes || 0);
  }

  const result = await db.run(
    `UPDATE citizen_push_subscriptions
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
     WHERE account_id = ?
       AND revoked_at IS NULL`,
    [accountId]
  );
  return Number(result?.changes || 0);
}

function normalizeAccountIdList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const result = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(result));
}

async function resolveBroadcastTargets(input: BroadcastCitizenMessageInput): Promise<string[]> {
  const db = getDatabase();
  if (input.mode === 'all_active') {
    const rows = await db.all(
      `SELECT DISTINCT s.account_id
       FROM citizen_sessions s
       WHERE ${ACTIVE_SESSION_SQL}`
    );
    return Array.from(
      new Set((rows || []).map((row: any) => normalizeString(row?.account_id)).filter(Boolean))
    );
  }

  const accountIds = normalizeAccountIdList(input.accountIds);
  if (accountIds.length === 0) return [];
  const placeholders = accountIds.map(() => '?').join(', ');
  const rows = await db.all(
    `SELECT DISTINCT s.account_id
     FROM citizen_sessions s
     WHERE s.account_id IN (${placeholders})
       AND ${ACTIVE_SESSION_SQL}`,
    accountIds
  );
  return Array.from(
    new Set((rows || []).map((row: any) => normalizeString(row?.account_id)).filter(Boolean))
  );
}

export async function broadcastCitizenMessage(
  input: BroadcastCitizenMessageInput
): Promise<BroadcastCitizenMessageResult> {
  const targetMode: 'all_active' | 'account_ids' = input.mode === 'account_ids' ? 'account_ids' : 'all_active';
  const title = sanitizeMessageTitle(input.title);
  const body = sanitizeMessageBody(input.body);
  const actionUrl = normalizeActionUrl(input.actionUrl || null);
  const sourceRef = truncate(normalizeString(input.sourceRef || ''), MAX_SOURCE_REF_LENGTH) || null;
  if (!title || !body) {
    throw new Error('title_and_body_required');
  }

  const targetAccounts = await resolveBroadcastTargets({
    ...input,
    mode: targetMode,
  });

  let createdMessages = 0;
  let pushedMessages = 0;
  let failedPushMessages = 0;
  for (const accountId of targetAccounts) {
    try {
      const result = await createCitizenAppMessage({
        accountId,
        sourceType: 'admin_broadcast',
        sourceRef,
        title,
        body,
        actionUrl,
        metadata: input.metadata || null,
        sendPush: input.sendPush !== false,
      });
      createdMessages += 1;
      if (result.pushSucceeded > 0) {
        pushedMessages += 1;
      } else if (result.pushAttempted > 0 && result.pushSucceeded === 0) {
        failedPushMessages += 1;
      }
    } catch (error) {
      failedPushMessages += 1;
      console.warn('Failed to broadcast citizen app message:', error);
    }
  }

  return {
    targetMode,
    targetedAccounts: targetAccounts.length,
    matchedAccounts: targetAccounts.length,
    createdMessages,
    pushedMessages,
    failedPushMessages,
  };
}
