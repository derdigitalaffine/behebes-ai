/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * Admin chat API (XMPP bootstrap, history, groups, uploads, notifications)
 */

import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { authMiddleware, staffOnly } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { loadConfig } from '../config.js';
import { buildAdminCapabilities, buildTicketVisibilitySql, loadAdminAccessContext, resolveAdminEffectiveRole } from '../services/rbac.js';
import { sendEmail } from '../services/email.js';
import { isNotificationEnabledForUser, listAdminNotifications } from '../services/admin-notifications.js';
import { sendAdminPushToUsers } from '../services/admin-push.js';
import { listAiQueue, testAIProvider } from '../services/ai.js';
import { loadLlmChatbotSettings, loadLlmTaskRouting, resolveLlmRuntimeSelection } from '../services/llm-hub.js';
import {
  buildCustomGroupRoomJid,
  buildDirectConversationId,
  buildOrgRoomJid,
  ensureXmppAccountForAdmin,
  ensureXmppAccountsForAdmins,
  ensureXmppRoom,
  resolveXmppWebsocketUrl,
} from '../services/xmpp-chat.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CHAT_UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'data', 'chat_uploads');
fs.mkdirSync(CHAT_UPLOAD_ROOT, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, CHAT_UPLOAD_ROOT);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(String(file.originalname || '')).slice(0, 15);
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      cb(null, `chat_${stamp}${ext}`);
    },
  }),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

router.use(authMiddleware, staffOnly);

type ConversationKind = 'direct' | 'org' | 'custom' | 'assistant' | 'system';
type PresenceStatusKey = 'online' | 'away' | 'offline' | 'dnd' | 'custom';

interface ResolvedConversation {
  kind: ConversationKind;
  publicConversationId: string;
  storageConversationId: string;
  targetAdminUserId?: string;
  orgUnitId?: string;
  customGroupId?: string;
  isAssistantConversation?: boolean;
}

interface OrgGroupMember {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

interface MessageReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  reactors: string[];
}

interface ChatPresenceSettingsPayload {
  status: PresenceStatusKey;
  label: string;
  color: string;
  emoji: string;
  expiresAt: string | null;
  updatedAt: string | null;
}

interface ChatDirectoryOrgUnit {
  id: string;
  tenantId: string;
  tenantName: string;
  parentId: string | null;
  name: string;
}

interface ChatDirectoryContactScope {
  contactId: string;
  tenantId: string;
  tenantName: string;
  orgUnitId: string;
  orgUnitName: string;
  canWrite: boolean;
}

interface ChatbotConversationItem {
  id: string;
  senderAdminUserId: string;
  senderDisplayName: string;
  conversationId: string;
  messageKind: string;
  body: string;
  file: null;
  ticketId: null;
  xmppStanzaId: null;
  quote: null;
  reactions: [];
  createdAt: string | null;
  readAtByMe: string | null;
  readByRecipientAt: string | null;
  readByCount: number;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function compareLocaleText(a: string, b: string): number {
  return a.localeCompare(b, 'de', { sensitivity: 'base' });
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function extractTurnUrlHost(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return '';
  const normalized = raw.replace(/^turns?:/i, 'https:');
  try {
    const parsed = new URL(normalized);
    return normalizeText(parsed.hostname).toLowerCase();
  } catch {
    const withoutScheme = raw.replace(/^turns?:/i, '').replace(/^\/\//, '');
    const hostPart = withoutScheme.split('?')[0]?.split('/')[0] || '';
    return normalizeText(hostPart.split(':')[0]).toLowerCase();
  }
}

function isLikelyPublicTurnHost(hostname: string): boolean {
  const host = normalizeText(hostname).toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (host.startsWith('10.') || host.startsWith('127.') || host.startsWith('192.168.')) return false;
    if (host.startsWith('172.')) {
      const second = Number.parseInt(host.split('.')[1] || '', 10);
      if (Number.isFinite(second) && second >= 16 && second <= 31) return false;
    }
    return true;
  }
  if (/^[a-f0-9:]+$/i.test(host)) {
    if (host.startsWith('fd') || host.startsWith('fc') || host.startsWith('fe80')) return false;
    return true;
  }
  return true;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set((values || []).map((entry) => normalizeText(entry)).filter(Boolean)));
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sanitizeMessageBody(value: unknown): string {
  const normalized = String(value || '').replace(/\r/g, '').trim();
  return normalized.slice(0, 12000);
}

const ASSISTANT_CONVERSATION_ID = 'assistant:self';
const CHATBOT_ASSISTANT_USER_ID = 'assistant:bot';
const CHATBOT_ASSISTANT_NAME = 'behebes KI-Assistent';
const CHATBOT_HISTORY_LIMIT_DEFAULT = 120;
const CHATBOT_ASSISTANT_SUBTITLE = 'Persönlicher KI-Assistent';
const SYSTEM_CONVERSATION_ID = 'system:self';
const SYSTEM_CHAT_USER_ID = 'system:bot';
const SYSTEM_CHAT_NAME = 'behebes System';
const SYSTEM_CHAT_SUBTITLE = 'Systemmeldungen und Ticket-Updates';

function normalizeChatbotRole(value: unknown): 'user' | 'assistant' {
  return String(value || '').trim().toLowerCase() === 'assistant' ? 'assistant' : 'user';
}

function truncateText(value: unknown, maxLength: number): string {
  const text = String(value || '').trim();
  if (!Number.isFinite(maxLength) || maxLength <= 0) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, Math.floor(maxLength)));
}

async function loadChatbotHistoryRows(adminUserId: string, limit: number): Promise<any[]> {
  const normalizedUserId = normalizeText(adminUserId);
  if (!normalizedUserId) return [];
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(400, Math.floor(limit)))
    : CHATBOT_HISTORY_LIMIT_DEFAULT;
  const db = getDatabase();
  const rows = await db.all<any>(
    `SELECT id, admin_user_id, role, body, provider, model, created_at
     FROM admin_chatbot_messages
     WHERE admin_user_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    [normalizedUserId, boundedLimit]
  );
  return (rows || []).reverse();
}

async function insertChatbotMessage(input: {
  adminUserId: string;
  role: 'user' | 'assistant';
  body: string;
  provider?: string | null;
  model?: string | null;
}): Promise<any> {
  const adminUserId = normalizeText(input.adminUserId);
  const role = normalizeChatbotRole(input.role);
  const body = sanitizeMessageBody(input.body);
  const provider = normalizeText(input.provider || null) || null;
  const model = normalizeText(input.model || null) || null;
  const id = createId('chatbotmsg');
  const db = getDatabase();
  await db.run(
    `INSERT INTO admin_chatbot_messages (
      id, admin_user_id, role, body, provider, model, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, adminUserId, role, body, provider, model]
  );
  const row = await db.get<any>(
    `SELECT id, admin_user_id, role, body, provider, model, created_at
     FROM admin_chatbot_messages
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return row || {
    id,
    admin_user_id: adminUserId,
    role,
    body,
    provider,
    model,
    created_at: new Date().toISOString(),
  };
}

function mapChatbotRowsToConversationItems(input: {
  rows: any[];
  adminUserId: string;
  adminDisplayName: string;
}): ChatbotConversationItem[] {
  const adminUserId = normalizeText(input.adminUserId);
  const adminDisplayName = normalizeText(input.adminDisplayName) || 'Sie';
  return (input.rows || []).map((row: any) => {
    const role = normalizeChatbotRole(row?.role);
    const isAssistant = role === 'assistant';
    return {
      id: normalizeText(row?.id),
      senderAdminUserId: isAssistant ? CHATBOT_ASSISTANT_USER_ID : adminUserId,
      senderDisplayName: isAssistant ? CHATBOT_ASSISTANT_NAME : adminDisplayName,
      conversationId: ASSISTANT_CONVERSATION_ID,
      messageKind: 'text',
      body: String(row?.body || ''),
      file: null,
      ticketId: null,
      xmppStanzaId: null,
      quote: null,
      reactions: [],
      createdAt: row?.created_at || null,
      readAtByMe: null,
      readByRecipientAt: null,
      readByCount: 0,
    };
  });
}

async function buildAssistantContextSummary(input: {
  req: Request;
  adminUserId: string;
  maxContextChars: number;
  includeAdminProfile: boolean;
  includeAccessScopes: boolean;
  includeRecentTickets: boolean;
  includeOpenNotifications: boolean;
  includeAiQueueSummary: boolean;
}): Promise<string> {
  const adminUserId = normalizeText(input.adminUserId);
  const maxContextChars = Number.isFinite(input.maxContextChars)
    ? Math.max(1000, Math.min(100000, Math.floor(input.maxContextChars)))
    : 12000;
  const role = normalizeText(input.req.role);
  const db = getDatabase();
  const parts: string[] = [];
  const access = await loadAdminAccessContext(adminUserId, role);

  if (input.includeAdminProfile) {
    const me = await db.get<any>(
      `SELECT username, email, first_name, last_name, role, job_title, work_phone
       FROM admin_users
       WHERE id = ?
       LIMIT 1`,
      [adminUserId]
    );
    const displayName = formatDisplayName({
      username: me?.username,
      firstName: me?.first_name,
      lastName: me?.last_name,
    });
    parts.push(
      [
        'Admin-Profil:',
        `- Name: ${displayName}`,
        `- Benutzername: ${normalizeText(me?.username) || '-'}`,
        `- E-Mail: ${normalizeText(me?.email) || '-'}`,
        `- Rolle: ${normalizeText(me?.role) || '-'}`,
        `- Funktion: ${normalizeText(me?.job_title) || '-'}`,
        `- Telefon: ${normalizeText(me?.work_phone) || '-'}`,
      ].join('\n')
    );
  }

  if (input.includeAccessScopes) {
    const capabilities = buildAdminCapabilities(access).slice(0, 60);
    parts.push(
      [
        'Zugriffskontext:',
        `- Effektive Rolle: ${resolveAdminEffectiveRole(access)}`,
        `- Global-Admin: ${access.isGlobalAdmin ? 'ja' : 'nein'}`,
        `- Mandanten: ${(access.tenantIds || []).slice(0, 12).join(', ') || '-'}`,
        `- Lesbare Orga-Einheiten: ${(access.readableOrgUnitIds || []).length}`,
        `- Schreibbare Orga-Einheiten: ${(access.writableOrgUnitIds || []).length}`,
        `- Capabilities (Auszug): ${capabilities.join(', ') || '-'}`,
      ].join('\n')
    );
  }

  if (input.includeRecentTickets) {
    const visibility = buildTicketVisibilitySql(access, { tableAlias: 't', requireWrite: false });
    const rows = await db.all<any>(
      `SELECT t.id, t.category, t.priority, t.status, t.updated_at, t.created_at
       FROM tickets t
       WHERE ${visibility.sql}
       ORDER BY datetime(COALESCE(t.updated_at, t.created_at)) DESC
       LIMIT 8`,
      [...visibility.params]
    );
    const lines = (rows || []).map((row: any) => {
      const id = normalizeText(row?.id);
      const category = normalizeText(row?.category) || 'Unkategorisiert';
      const priority = normalizeText(row?.priority) || '-';
      const status = normalizeText(row?.status) || '-';
      const updatedAt = normalizeText(row?.updated_at || row?.created_at) || '-';
      return `- ${id}: ${category} | ${priority} | ${status} | ${updatedAt}`;
    });
    parts.push(['Sichtbare aktuelle Tickets:', lines.length ? lines.join('\n') : '- Keine'].join('\n'));
  }

  if (input.includeOpenNotifications) {
    const notifications = await listAdminNotifications({
      adminUserId,
      role,
      status: 'open',
      severity: 'all',
      eventType: '',
      limit: 5,
      offset: 0,
    });
    const top = (notifications.items || [])
      .slice(0, 5)
      .map((entry) => `- [${entry.severity}] ${truncateText(entry.title, 120)}`);
    parts.push(
      [
        'Offene Hinweise:',
        `- Anzahl: ${Number(notifications.total || 0)}`,
        top.length ? top.join('\n') : '- Keine',
      ].join('\n')
    );
  }

  if (input.includeAiQueueSummary) {
    const queue = await listAiQueue({ status: 'all', limit: 1, offset: 0 });
    const counts = queue.statusCounts || {
      pending: 0,
      retry: 0,
      processing: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    };
    parts.push(
      [
        'KI-Queue-Übersicht:',
        `- Gesamt: ${Number(queue.total || 0)}`,
        `- pending=${Number(counts.pending || 0)}, retry=${Number(counts.retry || 0)}, processing=${Number(counts.processing || 0)}, failed=${Number(counts.failed || 0)}`,
      ].join('\n')
    );
  }

  return truncateText(parts.filter(Boolean).join('\n\n'), maxContextChars);
}

const CHAT_PRESENCE_STATUS_SET = new Set<PresenceStatusKey>([
  'online',
  'away',
  'offline',
  'dnd',
  'custom',
]);

const CHAT_PRESENCE_DEFAULT_COLORS: Record<PresenceStatusKey, string> = {
  online: '#16a34a',
  away: '#f59e0b',
  offline: '#64748b',
  dnd: '#ef4444',
  custom: '#0ea5e9',
};

function normalizePresenceStatus(value: unknown, fallback: PresenceStatusKey = 'online'): PresenceStatusKey {
  const normalized = normalizeText(value).toLowerCase();
  if (CHAT_PRESENCE_STATUS_SET.has(normalized as PresenceStatusKey)) {
    return normalized as PresenceStatusKey;
  }
  return fallback;
}

function normalizePresenceLabel(value: unknown): string {
  return normalizeText(value).slice(0, 80);
}

function normalizePresenceColor(value: unknown, fallback: string): string {
  const normalized = normalizeText(value).toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizePresenceEmoji(value: unknown): string {
  const collapsedWhitespace = normalizeText(value).replace(/\s+/g, ' ');
  return Array.from(collapsedWhitespace).slice(0, 6).join('');
}

function parseIsoDate(value: unknown): Date | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toSqlDateTime(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hour = String(value.getUTCHours()).padStart(2, '0');
  const minute = String(value.getUTCMinutes()).padStart(2, '0');
  const second = String(value.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function normalizePresenceExpiresAt(value: unknown): string | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return parsed.toISOString();
}

function mapPresenceRowToPayload(row: any): ChatPresenceSettingsPayload {
  const status = normalizePresenceStatus(row?.status_key, 'online');
  const fallbackColor = CHAT_PRESENCE_DEFAULT_COLORS[status] || CHAT_PRESENCE_DEFAULT_COLORS.online;
  const color = normalizePresenceColor(row?.custom_color, fallbackColor);
  const rawLabel = normalizePresenceLabel(row?.custom_label);
  const emoji = normalizePresenceEmoji(row?.custom_emoji);
  const expiresAt = normalizePresenceExpiresAt(row?.expires_at);
  const label =
    status === 'custom'
      ? rawLabel || 'Benutzerdefiniert'
      : '';
  return {
    status,
    label,
    color,
    emoji,
    expiresAt,
    updatedAt: row?.updated_at || null,
  };
}

async function loadChatPresenceSettings(adminUserId: string): Promise<ChatPresenceSettingsPayload> {
  const userId = normalizeText(adminUserId);
  if (!userId) {
    return {
      status: 'online',
      label: '',
      color: CHAT_PRESENCE_DEFAULT_COLORS.online,
      emoji: '',
      expiresAt: null,
      updatedAt: null,
    };
  }
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT status_key, custom_label, custom_color, custom_emoji, expires_at, updated_at
     FROM admin_chat_presence_settings
     WHERE admin_user_id = ?
     LIMIT 1`,
    [userId]
  );
  if (!row) {
    return {
      status: 'online',
      label: '',
      color: CHAT_PRESENCE_DEFAULT_COLORS.online,
      emoji: '',
      expiresAt: null,
      updatedAt: null,
    };
  }
  const expiresAt = normalizePresenceExpiresAt(row?.expires_at);
  if (expiresAt) {
    const expiresAtMs = new Date(expiresAt).getTime();
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      await db.run(
        `UPDATE admin_chat_presence_settings
         SET status_key = 'online',
             custom_label = NULL,
             custom_color = ?,
             custom_emoji = NULL,
             expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE admin_user_id = ?`,
        [CHAT_PRESENCE_DEFAULT_COLORS.online, userId]
      );
      return {
        status: 'online',
        label: '',
        color: CHAT_PRESENCE_DEFAULT_COLORS.online,
        emoji: '',
        expiresAt: null,
        updatedAt: new Date().toISOString(),
      };
    }
  }
  return mapPresenceRowToPayload(row);
}

async function saveChatPresenceSettings(
  adminUserId: string,
  input: { status?: unknown; label?: unknown; color?: unknown; emoji?: unknown; expiresAt?: unknown }
): Promise<ChatPresenceSettingsPayload> {
  const userId = normalizeText(adminUserId);
  const status = normalizePresenceStatus(input.status, 'online');
  const baseColor = CHAT_PRESENCE_DEFAULT_COLORS[status] || CHAT_PRESENCE_DEFAULT_COLORS.online;
  const label = status === 'custom' ? normalizePresenceLabel(input.label) : '';
  const emoji = normalizePresenceEmoji(input.emoji);
  const color = status === 'custom'
    ? normalizePresenceColor(input.color, CHAT_PRESENCE_DEFAULT_COLORS.custom)
    : baseColor;
  const expiresAt =
    status === 'online'
      ? null
      : normalizePresenceExpiresAt(input.expiresAt);
  const expiresAtSql = expiresAt ? toSqlDateTime(new Date(expiresAt)) : null;

  const db = getDatabase();
  await db.run(
    `INSERT INTO admin_chat_presence_settings (
      admin_user_id, status_key, custom_label, custom_color, custom_emoji, expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(admin_user_id)
    DO UPDATE SET
      status_key = excluded.status_key,
      custom_label = excluded.custom_label,
      custom_color = excluded.custom_color,
      custom_emoji = excluded.custom_emoji,
      expires_at = excluded.expires_at,
      updated_at = CURRENT_TIMESTAMP`,
    [userId, status, label || null, color, emoji || null, expiresAtSql]
  );

  return loadChatPresenceSettings(userId);
}

function formatDisplayName(input: { username?: unknown; firstName?: unknown; lastName?: unknown }): string {
  const first = normalizeText(input.firstName);
  const last = normalizeText(input.lastName);
  const fullName = `${first} ${last}`.trim();
  if (fullName) return fullName;
  return normalizeText(input.username) || 'Unbekannt';
}

function mapOrgRowsToDirectoryOrgUnits(orgRows: any[]): ChatDirectoryOrgUnit[] {
  const byId = new Map<string, ChatDirectoryOrgUnit>();
  for (const row of orgRows || []) {
    const orgUnitId = normalizeText(row?.id);
    if (!orgUnitId || byId.has(orgUnitId)) continue;
    byId.set(orgUnitId, {
      id: orgUnitId,
      tenantId: normalizeText(row?.tenant_id),
      tenantName: normalizeText(row?.tenant_name),
      parentId: normalizeText(row?.parent_id) || null,
      name: normalizeText(row?.name) || orgUnitId,
    });
  }
  return Array.from(byId.values()).sort((a, b) => {
    const tenantCmp = compareLocaleText(a.tenantName || '', b.tenantName || '');
    if (tenantCmp !== 0) return tenantCmp;
    return compareLocaleText(a.name, b.name);
  });
}

async function loadDirectoryContactScopes(
  visibleOrgUnitIds: string[],
  contactIds: string[]
): Promise<ChatDirectoryContactScope[]> {
  const scopedOrgUnitIds = uniqueStrings(visibleOrgUnitIds);
  const scopedContactIds = uniqueStrings(contactIds);
  if (scopedOrgUnitIds.length === 0 || scopedContactIds.length === 0) {
    return [];
  }

  const db = getDatabase();
  const rows = await db.all<any>(
    `SELECT DISTINCT
        s.admin_user_id,
        s.tenant_id,
        s.org_unit_id,
        COALESCE(s.can_write, 0) AS can_write,
        o.name AS org_unit_name,
        t.name AS tenant_name
     FROM admin_user_org_scopes s
     INNER JOIN org_units o ON o.id = s.org_unit_id
     LEFT JOIN tenants t ON t.id = s.tenant_id
     WHERE s.org_unit_id IN (${scopedOrgUnitIds.map(() => '?').join(', ')})
       AND s.admin_user_id IN (${scopedContactIds.map(() => '?').join(', ')})
     ORDER BY t.name ASC, o.name ASC, s.admin_user_id ASC`,
    [...scopedOrgUnitIds, ...scopedContactIds]
  );

  return (rows || [])
    .map((row: any) => ({
      contactId: normalizeText(row?.admin_user_id),
      tenantId: normalizeText(row?.tenant_id),
      tenantName: normalizeText(row?.tenant_name),
      orgUnitId: normalizeText(row?.org_unit_id),
      orgUnitName: normalizeText(row?.org_unit_name),
      canWrite: Number(row?.can_write || 0) === 1,
    }))
    .filter((entry: ChatDirectoryContactScope) => !!entry.contactId && !!entry.orgUnitId);
}

function toRequestOrigin(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

function toPublicDownloadUrl(req: Request, fileId: string): string {
  return `${toRequestOrigin(req)}/api/admin/chat/files/${encodeURIComponent(fileId)}/download`;
}

async function resolveCurrentAccess(req: Request) {
  const userId = normalizeText(req.userId);
  const role = normalizeText(req.role);
  const access = await loadAdminAccessContext(userId, role);
  return {
    userId,
    access,
  };
}

async function ensureOrgGroupAccess(access: Awaited<ReturnType<typeof loadAdminAccessContext>>, orgUnitId: string): Promise<boolean> {
  const db = getDatabase();
  const org = await db.get<any>(
    `SELECT id, tenant_id
     FROM org_units
     WHERE id = ?
     LIMIT 1`,
    [orgUnitId]
  );
  if (!org?.id) return false;
  if (access.isGlobalAdmin) return true;
  const tenantId = normalizeText(org.tenant_id);
  if (tenantId && access.tenantAdminTenantIds.includes(tenantId)) return true;

  const { descendantOrgUnitIds } = await listOrgUnitDescendants(orgUnitId);
  if (descendantOrgUnitIds.length === 0) return false;
  const descendantSet = new Set(descendantOrgUnitIds);
  for (const readableOrgUnitId of access.readableOrgUnitIds || []) {
    if (descendantSet.has(normalizeText(readableOrgUnitId))) {
      return true;
    }
  }
  return false;
}

async function resolveConversation(
  req: Request,
  rawConversationId: unknown
): Promise<ResolvedConversation> {
  const currentUserId = normalizeText(req.userId);
  const source = normalizeText(rawConversationId);
  if (!currentUserId) {
    const error = new Error('Nicht authentifiziert.');
    (error as any).status = 401;
    throw error;
  }
  if (!source) {
    const error = new Error('conversationId fehlt.');
    (error as any).status = 400;
    throw error;
  }

  if (source.startsWith('direct:')) {
    const targetAdminUserId = normalizeText(source.slice('direct:'.length));
    if (!targetAdminUserId) {
      const error = new Error('Ungültige Direct-Conversation.');
      (error as any).status = 400;
      throw error;
    }
    if (targetAdminUserId === currentUserId) {
      const error = new Error('Direktchat mit sich selbst ist nicht zulässig.');
      (error as any).status = 400;
      throw error;
    }
    const storageConversationId = buildDirectConversationId(currentUserId, targetAdminUserId);
    return {
      kind: 'direct',
      publicConversationId: `direct:${targetAdminUserId}`,
      storageConversationId,
      targetAdminUserId,
    };
  }

  if (source.startsWith('org:')) {
    const orgUnitId = normalizeText(source.slice('org:'.length));
    if (!orgUnitId) {
      const error = new Error('Ungültige Orga-Gruppen-ID.');
      (error as any).status = 400;
      throw error;
    }
    const { access } = await resolveCurrentAccess(req);
    const allowed = await ensureOrgGroupAccess(access, orgUnitId);
    if (!allowed) {
      const error = new Error('Kein Zugriff auf diese Orga-Gruppe.');
      (error as any).status = 403;
      throw error;
    }
    return {
      kind: 'org',
      publicConversationId: `org:${orgUnitId}`,
      storageConversationId: `group:org:${orgUnitId}`,
      orgUnitId,
    };
  }

  if (source.startsWith('custom:')) {
    const customGroupId = normalizeText(source.slice('custom:'.length));
    if (!customGroupId) {
      const error = new Error('Ungültige freie Gruppe.');
      (error as any).status = 400;
      throw error;
    }
    const db = getDatabase();
    const membership = await db.get<any>(
      `SELECT g.id
       FROM admin_chat_custom_groups g
       LEFT JOIN admin_chat_custom_group_members m ON m.group_id = g.id
       WHERE g.id = ?
         AND (g.created_by_admin_id = ? OR m.admin_user_id = ?)
       LIMIT 1`,
      [customGroupId, req.userId, req.userId]
    );
    if (!membership?.id) {
      const error = new Error('Kein Zugriff auf diese freie Gruppe.');
      (error as any).status = 403;
      throw error;
    }
    return {
      kind: 'custom',
      publicConversationId: `custom:${customGroupId}`,
      storageConversationId: `group:custom:${customGroupId}`,
      customGroupId,
    };
  }

  if (source === ASSISTANT_CONVERSATION_ID) {
    return {
      kind: 'assistant',
      publicConversationId: ASSISTANT_CONVERSATION_ID,
      storageConversationId: ASSISTANT_CONVERSATION_ID,
      isAssistantConversation: true,
    };
  }

  if (source === SYSTEM_CONVERSATION_ID) {
    return {
      kind: 'system',
      publicConversationId: SYSTEM_CONVERSATION_ID,
      storageConversationId: `system:${currentUserId}`,
      targetAdminUserId: currentUserId,
    };
  }

  const error = new Error('Unbekannte conversationId.');
  (error as any).status = 400;
  throw error;
}

async function listOrgUnitDescendants(orgUnitId: string): Promise<{ tenantId: string; descendantOrgUnitIds: string[] }> {
  const normalizedOrgUnitId = normalizeText(orgUnitId);
  if (!normalizedOrgUnitId) {
    return {
      tenantId: '',
      descendantOrgUnitIds: [],
    };
  }
  const db = getDatabase();
  const orgRow = await db.get<any>(
    `SELECT id, tenant_id
     FROM org_units
     WHERE id = ?
     LIMIT 1`,
    [normalizedOrgUnitId]
  );
  const tenantId = normalizeText(orgRow?.tenant_id);
  if (!tenantId) {
    return {
      tenantId: '',
      descendantOrgUnitIds: [],
    };
  }

  const descendants = await db.all<any>(
    `SELECT DISTINCT descendant_id
     FROM org_unit_closure
     WHERE tenant_id = ?
       AND ancestor_id = ?`,
    [tenantId, normalizedOrgUnitId]
  );
  const descendantOrgUnitIds = uniqueStrings([
    normalizedOrgUnitId,
    ...(descendants || []).map((row: any) => normalizeText(row?.descendant_id)),
  ]);
  return {
    tenantId,
    descendantOrgUnitIds,
  };
}

async function listOrgGroupMembers(orgUnitId: string): Promise<OrgGroupMember[]> {
  const { tenantId, descendantOrgUnitIds } = await listOrgUnitDescendants(orgUnitId);
  if (!tenantId || descendantOrgUnitIds.length === 0) return [];

  const db = getDatabase();
  const placeholders = descendantOrgUnitIds.map(() => '?').join(', ');
  const rows = await db.all<any>(
    `SELECT DISTINCT
        au.id,
        au.email,
        au.username,
        au.first_name,
        au.last_name,
        au.role
     FROM admin_user_org_scopes os
     INNER JOIN admin_users au ON au.id = os.admin_user_id
     WHERE os.tenant_id = ?
       AND os.org_unit_id IN (${placeholders})
       AND COALESCE(au.active, 1) = 1
     ORDER BY au.username ASC`,
    [tenantId, ...descendantOrgUnitIds]
  );

  return (rows || []).map((row: any) => ({
    id: normalizeText(row?.id),
    email: normalizeEmail(row?.email),
    displayName: formatDisplayName({
      username: row?.username,
      firstName: row?.first_name,
      lastName: row?.last_name,
    }),
    role: normalizeText(row?.role) || 'SACHBEARBEITER',
  }));
}

async function loadReactionSummariesForMessages(
  messageIds: string[],
  currentUserId: string
): Promise<Map<string, MessageReactionSummary[]>> {
  const normalizedMessageIds = uniqueStrings(messageIds);
  const normalizedCurrentUserId = normalizeText(currentUserId);
  const result = new Map<string, MessageReactionSummary[]>();
  if (normalizedMessageIds.length === 0) return result;

  const db = getDatabase();
  const placeholders = normalizedMessageIds.map(() => '?').join(', ');
  const rows = await db.all<any>(
    `SELECT r.message_id, r.emoji, r.admin_user_id,
            u.username, u.first_name, u.last_name
     FROM admin_chat_message_reactions r
     LEFT JOIN admin_users u ON u.id = r.admin_user_id
     WHERE r.message_id IN (${placeholders})
     ORDER BY datetime(r.created_at) ASC`,
    normalizedMessageIds
  );

  const byMessage = new Map<string, Map<string, MessageReactionSummary>>();
  for (const row of rows || []) {
    const messageId = normalizeText(row?.message_id);
    const emoji = normalizeText(row?.emoji).slice(0, 32);
    const reactorUserId = normalizeText(row?.admin_user_id);
    if (!messageId || !emoji || !reactorUserId) continue;

    const perEmoji = byMessage.get(messageId) || new Map<string, MessageReactionSummary>();
    const existing = perEmoji.get(emoji) || {
      emoji,
      count: 0,
      reactedByMe: false,
      reactors: [],
    };
    existing.count += 1;
    existing.reactedByMe = existing.reactedByMe || reactorUserId === normalizedCurrentUserId;
    if (existing.reactors.length < 8) {
      existing.reactors.push(
        formatDisplayName({
          username: row?.username,
          firstName: row?.first_name,
          lastName: row?.last_name,
        })
      );
    }
    perEmoji.set(emoji, existing);
    byMessage.set(messageId, perEmoji);
  }

  for (const [messageId, perEmoji] of byMessage.entries()) {
    const list = Array.from(perEmoji.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.emoji.localeCompare(b.emoji);
    });
    result.set(messageId, list);
  }

  return result;
}

async function resolveMessageInConversation(
  req: Request,
  messageIdInput: unknown,
  conversationInput: unknown
): Promise<{ messageId: string; conversation: ResolvedConversation }> {
  const messageId = normalizeText(messageIdInput);
  if (!messageId) {
    const error = new Error('messageId fehlt.');
    (error as any).status = 400;
    throw error;
  }

  const conversation = await resolveConversation(req, conversationInput);
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT id, conversation_id
     FROM admin_chat_messages
     WHERE id = ?
     LIMIT 1`,
    [messageId]
  );
  if (!row?.id || normalizeText(row?.conversation_id) !== conversation.storageConversationId) {
    const error = new Error('Nachricht nicht gefunden.');
    (error as any).status = 404;
    throw error;
  }

  return {
    messageId,
    conversation,
  };
}

async function resolveNotificationRecipients(
  senderUserId: string,
  conversation: ResolvedConversation
): Promise<Array<{ id: string; email: string; displayName: string }>> {
  const sender = normalizeText(senderUserId);
  if (!sender) return [];

  const db = getDatabase();
  if (conversation.kind === 'direct' && conversation.targetAdminUserId) {
    const row = await db.get<any>(
      `SELECT id, email, username, first_name, last_name
       FROM admin_users
       WHERE id = ?
         AND COALESCE(active, 1) = 1
       LIMIT 1`,
      [conversation.targetAdminUserId]
    );
    if (!row?.id) return [];
    const email = normalizeEmail(row.email);
    if (!isValidEmail(email)) return [];
    return [
      {
        id: normalizeText(row.id),
        email,
        displayName: formatDisplayName({
          username: row.username,
          firstName: row.first_name,
          lastName: row.last_name,
        }),
      },
    ];
  }

  if (conversation.kind === 'org' && conversation.orgUnitId) {
    const users = await listOrgGroupMembers(conversation.orgUnitId);
    return users.filter((entry) => entry.id !== sender && isValidEmail(entry.email));
  }

  if (conversation.kind === 'custom' && conversation.customGroupId) {
    const rows = await db.all<any>(
      `SELECT DISTINCT au.id, au.email, au.username, au.first_name, au.last_name
       FROM admin_chat_custom_group_members m
       INNER JOIN admin_users au ON au.id = m.admin_user_id
       WHERE m.group_id = ?
         AND COALESCE(au.active, 1) = 1`,
      [conversation.customGroupId]
    );
    return (rows || [])
      .map((row: any) => ({
        id: normalizeText(row?.id),
        email: normalizeEmail(row?.email),
        displayName: formatDisplayName({
          username: row?.username,
          firstName: row?.first_name,
          lastName: row?.last_name,
        }),
      }))
      .filter((entry) => entry.id !== sender && isValidEmail(entry.email));
  }

  return [];
}

async function markConversationMessagesAsRead(conversationStorageId: string, adminUserId: string): Promise<number> {
  const storageConversationId = normalizeText(conversationStorageId);
  const currentUserId = normalizeText(adminUserId);
  if (!storageConversationId || !currentUserId) return 0;
  const db = getDatabase();
  const result = await db.run(
    `INSERT INTO admin_chat_message_reads (message_id, admin_user_id, read_at)
     SELECT m.id, ?, CURRENT_TIMESTAMP
     FROM admin_chat_messages m
     WHERE m.conversation_id = ?
       AND (m.sender_admin_user_id <> ? OR m.message_kind = 'system_notice')
     ON CONFLICT(message_id, admin_user_id)
     DO UPDATE SET read_at = CURRENT_TIMESTAMP`,
    [currentUserId, storageConversationId, currentUserId]
  );
  return Number(result?.changes || 0);
}

async function sendChatEmailNotifications(input: {
  senderId: string;
  senderName: string;
  conversation: ResolvedConversation;
  messageBody: string;
  messageUrl: string;
}): Promise<void> {
  const recipients = await resolveNotificationRecipients(input.senderId, input.conversation);
  if (recipients.length === 0) return;

  const preview = sanitizeMessageBody(input.messageBody).slice(0, 280);
  const subjectPrefix =
    input.conversation.kind === 'direct'
      ? 'Neue Direktnachricht'
      : input.conversation.kind === 'org'
      ? 'Neue Orga-Gruppennachricht'
      : 'Neue Gruppennachricht';
  const subject = `${subjectPrefix} im Admin-Chat`;

  await Promise.all(
    recipients.map(async (recipient) => {
      const html = `
        <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; color:#001c31;">
          <h3 style="margin:0 0 12px 0;">${subject}</h3>
          <p style="margin:0 0 10px 0;">
            <strong>${input.senderName}</strong> hat eine neue Chat-Nachricht gesendet.
          </p>
          <div style="padding:12px;border-radius:8px;background:#f1f6fb;border:1px solid #c8d7e5;margin:0 0 12px 0;">
            ${preview ? preview.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Neue Nachricht'}
          </div>
          <p style="margin:0;">
            <a href="${input.messageUrl}" target="_blank" rel="noreferrer">Chat im Admin-Portal öffnen</a>
          </p>
        </div>
      `;
      const enabled = await isNotificationEnabledForUser({
        adminUserId: recipient.id,
        eventType: 'chat_message_email',
      });
      if (!enabled) return;

      await sendEmail({
        to: recipient.email,
        subject,
        html,
        text: `${subject}\n\n${input.senderName}: ${preview}\n\n${input.messageUrl}`,
      });
    })
  );
}

async function sendChatPushNotifications(input: {
  senderId: string;
  senderName: string;
  conversation: ResolvedConversation;
  messageBody: string;
  conversationId: string;
  ticketId?: string | null;
}): Promise<void> {
  const recipients = await resolveNotificationRecipients(input.senderId, input.conversation);
  if (recipients.length === 0) return;
  const pushRecipients: string[] = [];
  for (const recipient of recipients) {
    const enabled = await isNotificationEnabledForUser({
      adminUserId: recipient.id,
      eventType: 'push_messenger_messages',
    });
    if (enabled) {
      pushRecipients.push(recipient.id);
    }
  }
  if (pushRecipients.length === 0) return;

  const preview = sanitizeMessageBody(input.messageBody).slice(0, 280) || 'Neue Nachricht';
  const title =
    input.conversation.kind === 'direct'
      ? `Direktnachricht von ${input.senderName}`
      : `Neue Chatnachricht (${input.senderName})`;
  const url = `/ops/messenger/${encodeURIComponent(input.conversationId)}`;

  await sendAdminPushToUsers(pushRecipients, {
    title,
    body: preview,
    url,
    tag: `chat-${normalizeText(input.conversationId) || Date.now()}`,
    eventType: 'chat_message',
    metadata: {
      conversationId: input.conversationId,
      ticketId: input.ticketId || null,
      senderName: input.senderName,
    },
  });
}

router.get('/bootstrap', async (req: Request, res: Response) => {
  try {
    const config = loadConfig();
    const userId = normalizeText(req.userId);
    if (!userId) {
      return res.status(401).json({ message: 'Nicht authentifiziert.' });
    }
    const db = getDatabase();
    const me = await db.get<any>(
      `SELECT id, username, email, first_name, last_name, role
       FROM admin_users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!me?.id) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden.' });
    }

    const activeUsers = await db.all<any>(
      `SELECT id, username, email, first_name, last_name, role
       FROM admin_users
       WHERE COALESCE(active, 1) = 1
       ORDER BY username ASC`
    );
    await ensureXmppAccountsForAdmins(
      (activeUsers || []).map((row: any) => ({
        id: normalizeText(row?.id),
        username: normalizeText(row?.username),
      }))
    );

    const ids = (activeUsers || []).map((row: any) => normalizeText(row?.id)).filter(Boolean);
    const placeholders = ids.map(() => '?').join(', ');
    const accountRows =
      ids.length > 0
        ? await db.all<any>(
            `SELECT admin_user_id, xmpp_username
             FROM admin_chat_accounts
             WHERE admin_user_id IN (${placeholders})`,
            ids
          )
        : [];
    const usernameByUserId = new Map<string, string>();
    for (const row of accountRows || []) {
      usernameByUserId.set(normalizeText(row?.admin_user_id), normalizeText(row?.xmpp_username));
    }

    const meCredentials = await ensureXmppAccountForAdmin({
      adminUserId: normalizeText(me.id),
      preferredUsername: normalizeText(me.username) || normalizeText(me.id),
    });
    const websocketUrl = resolveXmppWebsocketUrl(toRequestOrigin(req));
    const mucService = normalizeText(config.xmpp.mucService) || `conference.${config.xmpp.domain || 'localhost'}`;
    const rtcIceServers: Array<{ urls: string[]; username?: string; credential?: string }> = [];
    if (Array.isArray(config.xmpp.rtcStunUrls) && config.xmpp.rtcStunUrls.length > 0) {
      rtcIceServers.push({
        urls: config.xmpp.rtcStunUrls,
      });
    }
    if (Array.isArray(config.xmpp.rtcTurnUrls) && config.xmpp.rtcTurnUrls.length > 0) {
      rtcIceServers.push({
        urls: config.xmpp.rtcTurnUrls,
        username: normalizeText(config.xmpp.rtcTurnUsername) || undefined,
        credential: normalizeText(config.xmpp.rtcTurnCredential) || undefined,
      });
    }
    const normalizedTurnUrls = Array.isArray(config.xmpp.rtcTurnUrls)
      ? config.xmpp.rtcTurnUrls.map((entry) => normalizeText(entry)).filter(Boolean)
      : [];
    const turnUsernameConfigured = normalizeText(config.xmpp.rtcTurnUsername);
    const turnCredentialConfigured = normalizeText(config.xmpp.rtcTurnCredential);
    const turnConfigured = normalizedTurnUrls.length > 0 && !!turnUsernameConfigured && !!turnCredentialConfigured;
    const hasLikelyPublicTurn = normalizedTurnUrls.some((turnUrl) =>
      isLikelyPublicTurnHost(extractTurnUrlHost(turnUrl))
    );
    const bestEffortOnly = !turnConfigured || !hasLikelyPublicTurn;
    const reliabilityHints: string[] = [];
    if (!turnConfigured) {
      reliabilityHints.push('TURN ist nicht vollständig konfiguriert (URLs/Benutzername/Credential fehlen).');
    } else if (!hasLikelyPublicTurn) {
      reliabilityHints.push('TURN scheint nur intern erreichbar zu sein; Internet-Anrufe sind Best-Effort.');
    } else {
      reliabilityHints.push('TURN ist konfiguriert. Qualität hängt von Netzwerk und Browserrichtlinien ab.');
    }
    reliabilityHints.push('iOS/PWA kann zusätzliche Audio-Freigaben (User-Gesture) erfordern.');
    reliabilityHints.push('Bei verbundenem Anruf ohne Ton bitte Audio aktivieren oder den Anruf neu starten.');

    const contacts = (activeUsers || [])
      .map((row: any) => {
        const id = normalizeText(row?.id);
        const xmppUsername = usernameByUserId.get(id) || '';
        const jid = xmppUsername ? `${xmppUsername}@${config.xmpp.domain}` : '';
        return {
          id,
          username: normalizeText(row?.username),
          displayName: formatDisplayName({
            username: row?.username,
            firstName: row?.first_name,
            lastName: row?.last_name,
          }),
          email: normalizeEmail(row?.email),
          role: normalizeText(row?.role) || 'SACHBEARBEITER',
          jid,
        };
      })
      .filter((entry) => !!entry.id && !!entry.jid);

    const { access } = await resolveCurrentAccess(req);
    const orgRows = access.isGlobalAdmin
      ? await db.all<any>(
          `SELECT o.id, o.tenant_id, o.parent_id, o.name, t.name AS tenant_name
           FROM org_units o
           LEFT JOIN tenants t ON t.id = o.tenant_id
           WHERE COALESCE(o.active, 1) = 1
           ORDER BY t.name ASC, o.name ASC`
        )
      : access.tenantIds.length > 0
      ? await db.all<any>(
          `SELECT o.id, o.tenant_id, o.parent_id, o.name, t.name AS tenant_name
           FROM org_units o
           LEFT JOIN tenants t ON t.id = o.tenant_id
           WHERE COALESCE(o.active, 1) = 1
             AND o.tenant_id IN (${access.tenantIds.map(() => '?').join(', ')})
           ORDER BY t.name ASC, o.name ASC`,
          access.tenantIds
        )
      : [];

    const directoryOrgUnits = mapOrgRowsToDirectoryOrgUnits(orgRows || []);
    const visibleOrgUnitIds = directoryOrgUnits.map((entry) => entry.id);
    const contactIds = contacts.map((entry) => normalizeText(entry?.id));
    const directoryContactScopes = await loadDirectoryContactScopes(visibleOrgUnitIds, contactIds);

    const orgGroups = await Promise.all(
      (orgRows || []).map(async (row: any) => {
        const orgUnitId = normalizeText(row?.id);
        const members = await listOrgGroupMembers(orgUnitId);
        return {
          id: `org:${orgUnitId}`,
          type: 'org',
          name: normalizeText(row?.name) || orgUnitId,
          tenantId: normalizeText(row?.tenant_id),
          orgUnitId,
          roomJid: buildOrgRoomJid(orgUnitId),
          members: members.map((member) => ({
            adminUserId: member.id,
            role: 'member',
            displayName: member.displayName,
          })),
        };
      })
    );

    const customGroups = await db.all<any>(
      `SELECT DISTINCT g.id, g.name, g.slug, g.tenant_id, g.created_by_admin_id, g.created_at, g.updated_at
       FROM admin_chat_custom_groups g
       LEFT JOIN admin_chat_custom_group_members m ON m.group_id = g.id
       WHERE g.created_by_admin_id = ? OR m.admin_user_id = ?
       ORDER BY g.name ASC, g.created_at ASC`,
      [userId, userId]
    );
    const customGroupIds = (customGroups || []).map((row: any) => normalizeText(row?.id)).filter(Boolean);
    const customMembersRows =
      customGroupIds.length > 0
        ? await db.all<any>(
            `SELECT m.group_id, m.admin_user_id, m.role,
                    u.username, u.first_name, u.last_name
             FROM admin_chat_custom_group_members m
             LEFT JOIN admin_users u ON u.id = m.admin_user_id
             WHERE m.group_id IN (${customGroupIds.map(() => '?').join(', ')})`,
            customGroupIds
          )
        : [];
    const membersByGroup = new Map<
      string,
      Array<{ adminUserId: string; role: string; displayName: string }>
    >();
    for (const row of customMembersRows || []) {
      const groupId = normalizeText(row?.group_id);
      if (!groupId) continue;
      const bucket = membersByGroup.get(groupId) || [];
      bucket.push({
        adminUserId: normalizeText(row?.admin_user_id),
        role: normalizeText(row?.role) || 'member',
        displayName: formatDisplayName({
          username: row?.username,
          firstName: row?.first_name,
          lastName: row?.last_name,
        }),
      });
      membersByGroup.set(groupId, bucket);
    }

    const normalizedCustomGroups = (customGroups || []).map((row: any) => ({
      id: `custom:${normalizeText(row?.id)}`,
      customGroupId: normalizeText(row?.id),
      type: 'custom',
      name: normalizeText(row?.name) || normalizeText(row?.slug) || 'Freie Gruppe',
      tenantId: normalizeText(row?.tenant_id),
      roomJid: buildCustomGroupRoomJid(normalizeText(row?.id)),
      members: membersByGroup.get(normalizeText(row?.id)) || [],
      createdByAdminId: normalizeText(row?.created_by_admin_id),
      canManageDelete:
        access.isGlobalAdmin ||
        normalizeText(row?.created_by_admin_id) === userId ||
        (!!normalizeText(row?.tenant_id) && access.tenantAdminTenantIds.includes(normalizeText(row?.tenant_id))),
      createdAt: row?.created_at || null,
      updatedAt: row?.updated_at || null,
    }));

    const presence = await loadChatPresenceSettings(userId);
    const chatbotSettings = await loadLlmChatbotSettings();

    return res.json({
      enabled: config.xmpp.enabled,
      xmpp: {
        domain: config.xmpp.domain,
        mucService,
        websocketUrl,
        jid: meCredentials.jid,
        username: meCredentials.username,
        password: meCredentials.password,
        resource: 'admin',
        rtc: {
          iceServers: rtcIceServers,
          bestEffortOnly,
          turnConfigured,
          reliabilityHints,
        },
      },
      me: {
        id: normalizeText(me.id),
        username: normalizeText(me.username),
        displayName: formatDisplayName({
          username: me.username,
          firstName: me.first_name,
          lastName: me.last_name,
        }),
        email: normalizeEmail(me.email),
      },
      settings: {
        emailNotificationsDefault: config.xmpp.emailNotificationsDefault,
        presence,
      },
      assistant: {
        enabled: chatbotSettings.enabled === true,
        conversationId: ASSISTANT_CONVERSATION_ID,
        displayName: CHATBOT_ASSISTANT_NAME,
        subtitle: CHATBOT_ASSISTANT_SUBTITLE,
        resetCommand: '/reset',
      },
      systemUser: {
        enabled: true,
        conversationId: SYSTEM_CONVERSATION_ID,
        displayName: SYSTEM_CHAT_NAME,
        subtitle: SYSTEM_CHAT_SUBTITLE,
      },
      contacts,
      directory: {
        orgUnits: directoryOrgUnits,
        contactScopes: directoryContactScopes,
      },
      groups: {
        org: orgGroups,
        custom: normalizedCustomGroups,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Chat-Bootstrap konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

router.get('/presence/self', async (req: Request, res: Response) => {
  try {
    const userId = normalizeText(req.userId);
    if (!userId) return res.status(401).json({ message: 'Nicht authentifiziert.' });
    const presence = await loadChatPresenceSettings(userId);
    return res.json({ presence });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Präsenzstatus konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

router.patch('/presence/self', async (req: Request, res: Response) => {
  try {
    const userId = normalizeText(req.userId);
    if (!userId) return res.status(401).json({ message: 'Nicht authentifiziert.' });

    const status = normalizePresenceStatus(req.body?.status, 'online');
    if (!CHAT_PRESENCE_STATUS_SET.has(status)) {
      return res.status(400).json({ message: 'Ungültiger Status.' });
    }

    if (status === 'custom') {
      const label = normalizePresenceLabel(req.body?.label);
      if (!label) {
        return res.status(400).json({ message: 'Für benutzerdefinierten Status ist ein Text erforderlich.' });
      }
    }

    const expiresAt = normalizePresenceExpiresAt(req.body?.expiresAt);
    if (normalizeText(req.body?.expiresAt) && !expiresAt) {
      return res.status(400).json({ message: 'Ungültiges Ablaufdatum für den Status.' });
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ message: 'Das Ablaufdatum muss in der Zukunft liegen.' });
    }

    const presence = await saveChatPresenceSettings(userId, {
      status,
      label: req.body?.label,
      color: req.body?.color,
      emoji: req.body?.emoji,
      expiresAt,
    });

    return res.json({
      message: 'Präsenzstatus gespeichert.',
      presence,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Präsenzstatus konnte nicht gespeichert werden.',
      error: error?.message || String(error),
    });
  }
});

router.get('/messages', async (req: Request, res: Response) => {
  try {
    const currentUserId = normalizeText(req.userId);
    if (!currentUserId) {
      return res.status(401).json({ message: 'Nicht authentifiziert.' });
    }
    const conversation = await resolveConversation(req, req.query?.conversationId);
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(400, Math.floor(limitRaw))) : 120;

    if (conversation.kind === 'assistant') {
      const db = getDatabase();
      const me = await db.get<any>(
        `SELECT username, first_name, last_name
         FROM admin_users
         WHERE id = ?
         LIMIT 1`,
        [currentUserId]
      );
      const myDisplayName = formatDisplayName({
        username: me?.username,
        firstName: me?.first_name,
        lastName: me?.last_name,
      });
      const rows = await loadChatbotHistoryRows(currentUserId, limit);
      const items = mapChatbotRowsToConversationItems({
        rows,
        adminUserId: currentUserId,
        adminDisplayName: myDisplayName,
      });
      return res.json({
        conversationId: conversation.publicConversationId,
        items,
        limit,
        total: items.length,
      });
    }

    const db = getDatabase();
    await markConversationMessagesAsRead(conversation.storageConversationId, currentUserId);
    const rows = await db.all<any>(
      `SELECT m.id, m.sender_admin_user_id, m.conversation_type, m.conversation_id, m.recipient_admin_user_id,
              m.group_kind, m.group_id, m.message_kind, m.body, m.file_id, m.ticket_id, m.xmpp_stanza_id,
              m.quoted_message_id, m.quoted_body, m.quoted_sender_name, m.created_at,
              u.username, u.first_name, u.last_name,
              f.original_name AS file_original_name, f.mime_type AS file_mime_type, f.byte_size AS file_byte_size,
              me_read.read_at AS read_by_me_at,
              recipient_read.read_at AS read_by_recipient_at,
              COALESCE(read_counts.read_count, 0) AS read_count
       FROM admin_chat_messages m
       LEFT JOIN admin_users u ON u.id = m.sender_admin_user_id
       LEFT JOIN admin_chat_files f ON f.id = m.file_id
       LEFT JOIN admin_chat_message_reads me_read
         ON me_read.message_id = m.id AND me_read.admin_user_id = ?
       LEFT JOIN admin_chat_message_reads recipient_read
         ON recipient_read.message_id = m.id
        AND recipient_read.admin_user_id = m.recipient_admin_user_id
       LEFT JOIN (
         SELECT message_id, COUNT(*) AS read_count
         FROM admin_chat_message_reads
         GROUP BY message_id
       ) read_counts ON read_counts.message_id = m.id
       WHERE m.conversation_id = ?
       ORDER BY datetime(m.created_at) DESC
      LIMIT ?`,
      [currentUserId, conversation.storageConversationId, limit]
    );

    const messageIds = uniqueStrings((rows || []).map((row: any) => normalizeText(row?.id)));
    const reactionsByMessage = await loadReactionSummariesForMessages(messageIds, currentUserId);

    const items = (rows || [])
      .reverse()
      .map((row: any) => {
        const messageKind = normalizeText(row?.message_kind) || 'text';
        const systemNotice = messageKind === 'system_notice';
        return {
          id: normalizeText(row?.id),
          senderAdminUserId: systemNotice ? SYSTEM_CHAT_USER_ID : normalizeText(row?.sender_admin_user_id),
          senderDisplayName: systemNotice
            ? SYSTEM_CHAT_NAME
            : formatDisplayName({
                username: row?.username,
                firstName: row?.first_name,
                lastName: row?.last_name,
              }),
          conversationId: conversation.publicConversationId,
          messageKind,
          body: String(row?.body || ''),
          file:
            row?.file_id
              ? {
                  id: normalizeText(row?.file_id),
                  originalName: normalizeText(row?.file_original_name) || 'Datei',
                  mimeType: normalizeText(row?.file_mime_type) || 'application/octet-stream',
                  byteSize: Number(row?.file_byte_size || 0),
                  downloadUrl: toPublicDownloadUrl(req, normalizeText(row?.file_id)),
                }
              : null,
          ticketId: normalizeText(row?.ticket_id) || null,
          xmppStanzaId: normalizeText(row?.xmpp_stanza_id) || null,
          quote:
            normalizeText(row?.quoted_body) || normalizeText(row?.quoted_message_id)
              ? {
                  messageId: normalizeText(row?.quoted_message_id) || null,
                  body: normalizeText(row?.quoted_body),
                  senderDisplayName: normalizeText(row?.quoted_sender_name) || '',
                }
              : null,
          reactions: reactionsByMessage.get(normalizeText(row?.id)) || [],
          createdAt: row?.created_at || null,
          readAtByMe: row?.read_by_me_at || null,
          readByRecipientAt: row?.read_by_recipient_at || null,
          readByCount: Number(row?.read_count || 0),
        };
      });

    return res.json({
      conversationId: conversation.publicConversationId,
      items,
      limit,
      total: items.length,
    });
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: error?.message || 'Nachrichten konnten nicht geladen werden.',
      error: status >= 500 ? error?.message || String(error) : undefined,
    });
  }
});

router.post('/messages', async (req: Request, res: Response) => {
  try {
    const senderId = normalizeText(req.userId);
    if (!senderId) return res.status(401).json({ message: 'Nicht authentifiziert.' });

    const conversation = await resolveConversation(req, req.body?.conversationId);
    const messageKind = normalizeText(req.body?.messageKind) || 'text';
    const body = sanitizeMessageBody(req.body?.body);
    const fileId = normalizeText(req.body?.fileId) || null;
    const ticketId = normalizeText(req.body?.ticketId) || null;
    const xmppStanzaId = normalizeText(req.body?.xmppStanzaId) || null;
    const quotedMessageIdInput = normalizeText(req.body?.quotedMessageId) || null;
    if (!body && !fileId && !ticketId) {
      return res.status(400).json({ message: 'Leere Nachricht ist nicht zulässig.' });
    }

    if (conversation.kind === 'system') {
      return res.status(403).json({ message: 'Systemmeldungen sind schreibgeschützt.' });
    }

    if (conversation.kind === 'assistant') {
      if (!body) {
        return res.status(400).json({ message: 'Für den KI-Assistenten ist Text erforderlich.' });
      }
      const db = getDatabase();
      const me = await db.get<any>(
        `SELECT username, first_name, last_name
         FROM admin_users
         WHERE id = ?
         LIMIT 1`,
        [senderId]
      );
      const myDisplayName = formatDisplayName({
        username: me?.username,
        firstName: me?.first_name,
        lastName: me?.last_name,
      });
      const normalizedCommand = body.trim().toLowerCase();
      if (normalizedCommand === '/reset') {
        await db.run(`DELETE FROM admin_chatbot_messages WHERE admin_user_id = ?`, [senderId]);
        const resetRow = await insertChatbotMessage({
          adminUserId: senderId,
          role: 'assistant',
          body: 'Kontext zurückgesetzt. Wir starten neu. Womit soll ich dir helfen?',
        });
        const resetItems = mapChatbotRowsToConversationItems({
          rows: [resetRow],
          adminUserId: senderId,
          adminDisplayName: myDisplayName,
        });
        return res.status(201).json({
          conversationId: ASSISTANT_CONVERSATION_ID,
          reset: true,
          items: resetItems,
          item: resetItems[0] || null,
        });
      }

      const chatbotSettings = await loadLlmChatbotSettings();
      if (chatbotSettings.enabled !== true) {
        return res.status(503).json({ message: 'Der KI-Assistent ist aktuell deaktiviert.' });
      }

      const userRow = await insertChatbotMessage({
        adminUserId: senderId,
        role: 'user',
        body,
      });

      const historyRows = await loadChatbotHistoryRows(
        senderId,
        Number(chatbotSettings.maxHistoryMessages || 16)
      );
      const contextSummary = await buildAssistantContextSummary({
        req,
        adminUserId: senderId,
        maxContextChars: Number(chatbotSettings.maxContextChars || 12000),
        includeAdminProfile: chatbotSettings.contextSources?.adminProfile === true,
        includeAccessScopes: chatbotSettings.contextSources?.accessScopes === true,
        includeRecentTickets: chatbotSettings.contextSources?.recentTickets === true,
        includeOpenNotifications: chatbotSettings.contextSources?.openNotifications === true,
        includeAiQueueSummary: chatbotSettings.contextSources?.aiQueueSummary === true,
      });
      const historyLines = historyRows
        .map((entry: any) => {
          const roleLabel = normalizeChatbotRole(entry?.role) === 'assistant' ? 'Assistent' : 'Nutzer';
          const text = truncateText(entry?.body, 1500);
          if (!text) return '';
          return `${roleLabel}: ${text}`;
        })
        .filter(Boolean)
        .join('\n\n');
      const safeHistory = truncateText(historyLines, Math.max(1200, Number(chatbotSettings.maxContextChars || 12000)));
      const safeContext = truncateText(contextSummary, Math.max(1200, Number(chatbotSettings.maxContextChars || 12000)));
      const taskRouting = await loadLlmTaskRouting();
      const assistantTaskRoute = taskRouting?.routes?.admin_chatbot_assistant || null;
      const effectiveConnectionId =
        normalizeText(assistantTaskRoute?.connectionId) || normalizeText(chatbotSettings.connectionId);
      const effectiveModelId =
        normalizeText(assistantTaskRoute?.modelId) || normalizeText(chatbotSettings.modelId);
      const runtimeInput = {
        purpose: 'admin_chatbot_assistant',
        taskKey: 'admin_chatbot_assistant',
        connectionId: effectiveConnectionId || undefined,
        modelId: effectiveModelId || undefined,
      };
      const runtime = await resolveLlmRuntimeSelection(runtimeInput);

      const prompt = [
        truncateText(chatbotSettings.systemPrompt, 12000),
        'Arbeitsmodus:',
        '- Antworte in klaren, konkreten Schritten.',
        '- Wenn Informationen fehlen, stelle kurze Rückfragen.',
        '- Der Befehl /reset bedeutet, dass der Nutzer den Verlauf löschen möchte.',
        safeContext ? `Verfügbarer Kontext:\n${safeContext}` : 'Verfügbarer Kontext: (keiner)',
        safeHistory ? `Bisheriger Verlauf:\n${safeHistory}` : 'Bisheriger Verlauf: (leer)',
        `Aktuelle Nachricht:\n${body}`,
      ].join('\n\n');

      let assistantText = '';
      try {
        const answerRaw = await testAIProvider(prompt, {
          ...runtimeInput,
          meta: {
            source: 'routes.chat.assistant',
            adminUserId: senderId,
            conversationId: ASSISTANT_CONVERSATION_ID,
          },
        });
        assistantText = truncateText(answerRaw, 16000);
      } catch (assistantError: any) {
        assistantText = `Ich konnte gerade keine Antwort erzeugen (${normalizeText(assistantError?.message) || 'KI-Fehler'}). Bitte versuche es erneut.`;
      }
      if (!assistantText) {
        assistantText = 'Ich konnte dazu gerade keine verwertbare Antwort erzeugen. Bitte formuliere die Frage etwas genauer.';
      }

      const assistantRow = await insertChatbotMessage({
        adminUserId: senderId,
        role: 'assistant',
        body: assistantText,
        provider: runtime.connectionName || runtime.connectionId,
        model: runtime.model,
      });

      const items = mapChatbotRowsToConversationItems({
        rows: [userRow, assistantRow],
        adminUserId: senderId,
        adminDisplayName: myDisplayName,
      });

      return res.status(201).json({
        conversationId: ASSISTANT_CONVERSATION_ID,
        items,
        item: items[0] || null,
        assistantReply: items[1] || null,
      });
    }

    const db = getDatabase();
    let file: any = null;
    if (fileId) {
      file = await db.get<any>(
        `SELECT id, original_name, mime_type, byte_size
         FROM admin_chat_files
         WHERE id = ?
         LIMIT 1`,
        [fileId]
      );
      if (!file?.id) {
        return res.status(404).json({ message: 'Datei nicht gefunden.' });
      }
    }

    let quotedMessageId: string | null = null;
    let quotedBody = '';
    let quotedSenderName = '';
    if (quotedMessageIdInput) {
      const quotedRow = await db.get<any>(
        `SELECT m.id, m.body, u.username, u.first_name, u.last_name
         FROM admin_chat_messages m
         LEFT JOIN admin_users u ON u.id = m.sender_admin_user_id
         WHERE m.id = ?
           AND m.conversation_id = ?
         LIMIT 1`,
        [quotedMessageIdInput, conversation.storageConversationId]
      );
      if (quotedRow?.id) {
        quotedMessageId = normalizeText(quotedRow.id);
        quotedBody = sanitizeMessageBody(quotedRow.body).slice(0, 500);
        quotedSenderName = formatDisplayName({
          username: quotedRow?.username,
          firstName: quotedRow?.first_name,
          lastName: quotedRow?.last_name,
        });
      }
    }

    const messageId = createId('chatmsg');
    await db.run(
      `INSERT INTO admin_chat_messages (
        id,
        sender_admin_user_id,
        conversation_type,
        conversation_id,
        recipient_admin_user_id,
        group_kind,
        group_id,
        message_kind,
        body,
        file_id,
        ticket_id,
        xmpp_stanza_id,
        quoted_message_id,
        quoted_body,
        quoted_sender_name,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        messageId,
        senderId,
        conversation.kind === 'direct' ? 'direct' : 'group',
        conversation.storageConversationId,
        conversation.targetAdminUserId || null,
        conversation.kind === 'org' ? 'org' : conversation.kind === 'custom' ? 'custom' : null,
        conversation.orgUnitId || conversation.customGroupId || null,
        messageKind,
        body || '',
        fileId,
        ticketId,
        xmppStanzaId,
        quotedMessageId,
        quotedBody || null,
        quotedSenderName || null,
      ]
    );

    const sender = await db.get<any>(
      `SELECT username, first_name, last_name
       FROM admin_users
       WHERE id = ?
       LIMIT 1`,
      [senderId]
    );
    const senderName = formatDisplayName({
      username: sender?.username,
      firstName: sender?.first_name,
      lastName: sender?.last_name,
    });
    const adminUrl = normalizeText(loadConfig().adminUrl) || `${toRequestOrigin(req)}/admin`;
    const messageUrl = `${adminUrl.replace(/\/+$/, '')}/?chat=${encodeURIComponent(conversation.publicConversationId)}`;
    void sendChatEmailNotifications({
      senderId,
      senderName,
      conversation,
      messageBody: body,
      messageUrl,
    }).catch((notifyError) => {
      console.warn('Chat email notification failed:', notifyError);
    });
    void sendChatPushNotifications({
      senderId,
      senderName,
      conversation,
      messageBody: body,
      conversationId: conversation.publicConversationId,
      ticketId,
    }).catch((notifyError) => {
      console.warn('Chat push notification failed:', notifyError);
    });

    return res.status(201).json({
      item: {
        id: messageId,
        senderAdminUserId: senderId,
        senderDisplayName: senderName,
        conversationId: conversation.publicConversationId,
        messageKind,
        body,
        file:
          file?.id
            ? {
                id: normalizeText(file.id),
                originalName: normalizeText(file.original_name) || 'Datei',
                mimeType: normalizeText(file.mime_type) || 'application/octet-stream',
                byteSize: Number(file.byte_size || 0),
                downloadUrl: toPublicDownloadUrl(req, normalizeText(file.id)),
              }
            : null,
        ticketId: ticketId || null,
        xmppStanzaId: xmppStanzaId || null,
        quote:
          quotedMessageId || quotedBody
            ? {
                messageId: quotedMessageId,
                body: quotedBody,
                senderDisplayName: quotedSenderName,
              }
            : null,
        reactions: [],
        createdAt: new Date().toISOString(),
        readAtByMe: null,
        readByRecipientAt: null,
        readByCount: 0,
      },
    });
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: error?.message || 'Nachricht konnte nicht gespeichert werden.',
      error: status >= 500 ? error?.message || String(error) : undefined,
    });
  }
});

router.post('/messages/read', async (req: Request, res: Response) => {
  try {
    const currentUserId = normalizeText(req.userId);
    if (!currentUserId) {
      return res.status(401).json({ message: 'Nicht authentifiziert.' });
    }
    const conversation = await resolveConversation(req, req.body?.conversationId);
    if (conversation.kind === 'assistant') {
      return res.json({
        conversationId: conversation.publicConversationId,
        marked: 0,
      });
    }
    const marked = await markConversationMessagesAsRead(conversation.storageConversationId, currentUserId);
    return res.json({
      conversationId: conversation.publicConversationId,
      marked,
    });
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: error?.message || 'Gelesen-Status konnte nicht gesetzt werden.',
      error: status >= 500 ? error?.message || String(error) : undefined,
    });
  }
});

router.post('/messages/:messageId/reactions', async (req: Request, res: Response) => {
  try {
    const currentUserId = normalizeText(req.userId);
    if (!currentUserId) {
      return res.status(401).json({ message: 'Nicht authentifiziert.' });
    }

    const emoji = normalizeText(req.body?.emoji).slice(0, 32);
    if (!emoji) {
      return res.status(400).json({ message: 'Emoji fehlt.' });
    }

    const { messageId, conversation } = await resolveMessageInConversation(
      req,
      req.params?.messageId,
      req.body?.conversationId
    );
    if (conversation.kind === 'system') {
      return res.status(403).json({ message: 'Reaktionen auf Systemmeldungen sind nicht zulässig.' });
    }
    const db = getDatabase();
    await db.run(
      `INSERT INTO admin_chat_message_reactions (id, message_id, admin_user_id, emoji, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(message_id, admin_user_id, emoji)
       DO UPDATE SET created_at = CURRENT_TIMESTAMP`,
      [createId('chatreact'), messageId, currentUserId, emoji]
    );

    const reactionsByMessage = await loadReactionSummariesForMessages([messageId], currentUserId);
    return res.status(201).json({
      messageId,
      conversationId: conversation.publicConversationId,
      reactions: reactionsByMessage.get(messageId) || [],
    });
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: error?.message || 'Reaktion konnte nicht gespeichert werden.',
      error: status >= 500 ? error?.message || String(error) : undefined,
    });
  }
});

router.delete('/messages/:messageId/reactions', async (req: Request, res: Response) => {
  try {
    const currentUserId = normalizeText(req.userId);
    if (!currentUserId) {
      return res.status(401).json({ message: 'Nicht authentifiziert.' });
    }

    const emoji = normalizeText(req.body?.emoji || req.query?.emoji).slice(0, 32);
    if (!emoji) {
      return res.status(400).json({ message: 'Emoji fehlt.' });
    }

    const { messageId, conversation } = await resolveMessageInConversation(
      req,
      req.params?.messageId,
      req.body?.conversationId || req.query?.conversationId
    );
    if (conversation.kind === 'system') {
      return res.status(403).json({ message: 'Reaktionen auf Systemmeldungen sind nicht zulässig.' });
    }
    const db = getDatabase();
    await db.run(
      `DELETE FROM admin_chat_message_reactions
       WHERE message_id = ?
         AND admin_user_id = ?
         AND emoji = ?`,
      [messageId, currentUserId, emoji]
    );

    const reactionsByMessage = await loadReactionSummariesForMessages([messageId], currentUserId);
    return res.json({
      messageId,
      conversationId: conversation.publicConversationId,
      reactions: reactionsByMessage.get(messageId) || [],
    });
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: error?.message || 'Reaktion konnte nicht entfernt werden.',
      error: status >= 500 ? error?.message || String(error) : undefined,
    });
  }
});

router.post('/groups/custom', async (req: Request, res: Response) => {
  try {
    const creatorId = normalizeText(req.userId);
    if (!creatorId) return res.status(401).json({ message: 'Nicht authentifiziert.' });
    const name = normalizeText(req.body?.name).slice(0, 120);
    if (!name) {
      return res.status(400).json({ message: 'Gruppenname ist erforderlich.' });
    }

    const { access } = await resolveCurrentAccess(req);
    const requestedTenantId = normalizeText(req.body?.tenantId);
    const tenantId =
      requestedTenantId ||
      (access.isGlobalAdmin ? '' : access.tenantIds.length > 0 ? access.tenantIds[0] : '');
    if (tenantId && !access.isGlobalAdmin && !access.tenantIds.includes(tenantId)) {
      return res.status(403).json({ message: 'Kein Zugriff auf diesen Mandanten.' });
    }

    const memberIdsRaw = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
    const memberIds = Array.from(
      new Set(
        memberIdsRaw
          .map((entry: unknown) => normalizeText(entry))
          .filter(Boolean)
      )
    );
    if (!memberIds.includes(creatorId)) {
      memberIds.push(creatorId);
    }

    const db = getDatabase();
    const validMembers =
      memberIds.length > 0
        ? await db.all<any>(
            `SELECT id, username
             FROM admin_users
             WHERE id IN (${memberIds.map(() => '?').join(', ')})
               AND COALESCE(active, 1) = 1`,
            memberIds
          )
        : [];
    const validMemberIds = Array.from(new Set((validMembers || []).map((row: any) => normalizeText(row?.id)).filter(Boolean)));
    if (validMemberIds.length === 0) {
      return res.status(400).json({ message: 'Mindestens ein gültiges Mitglied ist erforderlich.' });
    }

    const groupId = createId('chatgrp');
    const slugBase = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'gruppe';
    const slug = `${slugBase}-${groupId.slice(-6).toLowerCase()}`;

    await db.run(
      `INSERT INTO admin_chat_custom_groups (
        id, tenant_id, slug, name, created_by_admin_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [groupId, tenantId || null, slug, name, creatorId]
    );

    for (const memberId of validMemberIds) {
      await db.run(
        `INSERT INTO admin_chat_custom_group_members (
          id, group_id, admin_user_id, role, joined_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [createId('chatgrpm'), groupId, memberId, memberId === creatorId ? 'owner' : 'member']
      );
    }

    const roomJid = buildCustomGroupRoomJid(groupId);
    void ensureXmppRoom(roomJid, name).catch((error) => {
      console.warn('Failed to ensure XMPP room for custom group:', error);
    });

    return res.status(201).json({
      item: {
        id: `custom:${groupId}`,
        customGroupId: groupId,
        type: 'custom',
        name,
        tenantId: tenantId || null,
        roomJid,
        members: validMembers.map((row: any) => ({
          adminUserId: normalizeText(row?.id),
          role: normalizeText(row?.id) === creatorId ? 'owner' : 'member',
          displayName: normalizeText(row?.username) || normalizeText(row?.id),
        })),
        createdByAdminId: creatorId,
        canManageDelete: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Freie Gruppe konnte nicht erstellt werden.',
      error: error?.message || String(error),
    });
  }
});

router.delete('/groups/custom/:groupId', async (req: Request, res: Response) => {
  try {
    const userId = normalizeText(req.userId);
    if (!userId) return res.status(401).json({ message: 'Nicht authentifiziert.' });
    const groupId = normalizeText(req.params?.groupId);
    if (!groupId) return res.status(400).json({ message: 'Gruppen-ID fehlt.' });

    const db = getDatabase();
    const group = await db.get<any>(
      `SELECT id, tenant_id, created_by_admin_id
       FROM admin_chat_custom_groups
       WHERE id = ?
       LIMIT 1`,
      [groupId]
    );
    if (!group?.id) {
      return res.status(404).json({ message: 'Gruppe nicht gefunden.' });
    }

    const { access } = await resolveCurrentAccess(req);
    const tenantId = normalizeText(group?.tenant_id);
    const isCreator = normalizeText(group?.created_by_admin_id) === userId;
    const isTenantAdmin = !!tenantId && access.tenantAdminTenantIds.includes(tenantId);
    const memberRoleRow = await db.get<any>(
      `SELECT role
       FROM admin_chat_custom_group_members
       WHERE group_id = ?
         AND admin_user_id = ?
       LIMIT 1`,
      [groupId, userId]
    );
    const memberRole = normalizeText(memberRoleRow?.role).toLowerCase();
    const canDelete = access.isGlobalAdmin || isCreator || isTenantAdmin || memberRole === 'owner';
    if (!canDelete) {
      return res.status(403).json({ message: 'Keine Berechtigung zum Löschen der Gruppe.' });
    }

    await db.run(
      `DELETE FROM admin_chat_messages
       WHERE group_kind = 'custom'
         AND group_id = ?`,
      [groupId]
    );
    await db.run(
      `DELETE FROM admin_chat_custom_groups
       WHERE id = ?`,
      [groupId]
    );

    return res.json({
      deleted: true,
      customGroupId: groupId,
      conversationId: `custom:${groupId}`,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: error?.message || 'Gruppe konnte nicht gelöscht werden.',
      error: error?.message || String(error),
    });
  }
});

router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const uploaderId = normalizeText(req.userId);
    if (!uploaderId) return res.status(401).json({ message: 'Nicht authentifiziert.' });
    const uploadedFile = (req as any).file as { path: string; originalname: string; mimetype: string; size: number } | undefined;
    if (!uploadedFile) return res.status(400).json({ message: 'Datei fehlt.' });

    const db = getDatabase();
    const fileId = createId('chatfile');
    const storagePath = normalizeText(uploadedFile.path);

    await db.run(
      `INSERT INTO admin_chat_files (
        id,
        uploaded_by_admin_id,
        original_name,
        mime_type,
        byte_size,
        storage_path,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        fileId,
        uploaderId,
        normalizeText(uploadedFile.originalname) || 'Datei',
        normalizeText(uploadedFile.mimetype) || 'application/octet-stream',
        Number(uploadedFile.size || 0),
        storagePath,
      ]
    );

    return res.status(201).json({
      item: {
        id: fileId,
        originalName: normalizeText(uploadedFile.originalname) || 'Datei',
        mimeType: normalizeText(uploadedFile.mimetype) || 'application/octet-stream',
        byteSize: Number(uploadedFile.size || 0),
        downloadUrl: toPublicDownloadUrl(req, fileId),
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Datei konnte nicht hochgeladen werden.',
      error: error?.message || String(error),
    });
  }
});

router.get('/files/:fileId/download', async (req: Request, res: Response) => {
  try {
    const fileId = normalizeText(req.params.fileId);
    if (!fileId) return res.status(400).json({ message: 'fileId fehlt.' });
    const db = getDatabase();
    const file = await db.get<any>(
      `SELECT id, original_name, mime_type, byte_size, storage_path
       FROM admin_chat_files
       WHERE id = ?
       LIMIT 1`,
      [fileId]
    );
    if (!file?.id) {
      return res.status(404).json({ message: 'Datei nicht gefunden.' });
    }
    const storagePath = normalizeText(file.storage_path);
    if (!storagePath || !fs.existsSync(storagePath)) {
      return res.status(404).json({ message: 'Datei ist nicht mehr vorhanden.' });
    }

    const fileName = normalizeText(file.original_name) || 'chat-file.bin';
    res.setHeader('Content-Type', normalizeText(file.mime_type) || 'application/octet-stream');
    res.setHeader('Content-Length', String(Number(file.byte_size || 0)));
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '_')}"`);
    return res.sendFile(path.resolve(storagePath));
  } catch (error: any) {
    return res.status(500).json({
      message: 'Datei konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

router.get('/health', (_req: Request, res: Response) => {
  const config = loadConfig();
  return res.json({
    enabled: config.xmpp.enabled,
    domain: config.xmpp.domain,
    mucService: config.xmpp.mucService,
    websocketUrl: config.xmpp.websocketUrl,
    apiConfigured: !!(normalizeText(config.xmpp.apiUser) && normalizeText(config.xmpp.apiPassword)),
  });
});

export default router;
