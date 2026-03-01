/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Admin Panel API
 */

import express, { Request, Response } from 'express';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import bcryptjs from 'bcryptjs';
import { authMiddleware, staffOnly, adminOnly } from '../middleware/auth.js';
import { getDatabase, type AppDatabase } from '../database.js';
import { loadConfig } from '../config.js';
import { createAdminUser, updateAdminPassword } from '../services/admin.js';
import { buildClassificationPromptForDebug } from '../services/classification.js';
import { enrichGeoAndWeather } from '../services/geo-enrichment.js';
import {
  cancelAiQueueItem,
  deleteAiQueueItem,
  listAiQueue,
  retryAiQueueItem,
  testAIProvider,
} from '../services/ai.js';
import {
  deleteLlmConnection,
  getConnectionModels,
  LLM_TASK_CAPABILITIES,
  loadLlmChatbotSettings,
  modelMatchesCapabilityFilter,
  listLlmConnections,
  type LlmConnection,
  loadLlmTaskRouting,
  resolveLlmRuntimeSelection,
  saveLlmChatbotSettings,
  saveLlmTaskRouting,
  upsertLlmConnection,
} from '../services/llm-hub.js';
import {
  deleteEmailQueueItem,
  listEmailQueue,
  resendEmailQueueItem,
  retryEmailQueueItem,
  sendEmail,
} from '../services/email.js';
import {
  getMailboxAttachmentBinary,
  getMailboxMessageById,
  getMailboxStats,
  listMailboxMessages,
  syncMailboxInbox,
} from '../services/mailbox.js';
import {
  getSetting,
  getSystemPrompt,
  loadAiAnalysisMemorySettings,
  loadAiCredentials,
  loadImageAiSettings,
  loadImapSettings,
  loadImapSettingsForTenant,
  loadSystemPrompts,
  loadAiSettings,
  loadSmtpSettings,
  loadSmtpSettingsForTenant,
  loadTenantEffectiveEmailSettings,
  loadWeatherApiSettings,
  normalizeWeatherApiSettings,
  saveTenantImapSettings,
  saveTenantSmtpSettings,
  setSetting,
} from '../services/settings.js';
import {
  loadMunicipalContactsSettings,
  saveMunicipalContactsSettings,
} from '../services/municipal-contacts.js';
import { endAdminSession, getRequestIp, getRequestUserAgent, writeJournalEntry } from '../services/admin-journal.js';
import {
  NOTIFICATION_EVENT_DEFINITIONS,
  createAdminNotification,
  deleteAdminNotification,
  getUserNotificationPreferences,
  listAdminNotifications,
  sendSystemChatNotifications,
  setUserNotificationPreferences,
  updateAdminNotificationStatus,
} from '../services/admin-notifications.js';
import {
  getAdminPushPublicKey,
  isAdminPushEnabled,
  revokeAdminPushSubscription,
  sendAdminPushToUser,
  upsertAdminPushSubscription,
} from '../services/admin-push.js';
import {
  extractFeedTokenFromRequest,
  getOwnActiveFeedToken,
  markFeedTokenUsed,
  normalizeFeedScope,
  resolveActiveFeedToken,
  resolveFeedPath,
  revokeOwnFeedToken,
  rotateOwnFeedToken,
} from '../services/feed-tokens.js';
import {
  createOwnAdminApiToken,
  listOwnAdminApiTokens,
  revokeOwnAdminApiToken,
} from '../services/admin-api-tokens.js';
import {
  buildTotpOtpAuthUri,
  cleanupAllowedOrigins,
  consumeAdminAuthChallenge,
  createAdminAuthChallenge,
  createAdminPasskey,
  disableAdminTotpFactor,
  deriveRelyingPartyId,
  generateTotpSecret,
  isAdminTotpEnabled,
  listAdminPasskeys,
  revokeAdminPasskey,
  saveAdminTotpFactor,
  verifyAdminTotpCode,
  verifyTotpCode,
  verifyPasskeyRegistrationClientData,
} from '../services/admin-security.js';
import {
  createPlatformBlogPost,
  deletePlatformBlogPost,
  getPlatformBlogPostById,
  listPlatformBlogPosts,
  updatePlatformBlogPost,
} from '../services/platform-blog.js';
import {
  buildTicketVisibilitySql,
  buildAdminCapabilities,
  loadAdminAccessContext,
  resolveAdminEffectiveRole,
} from '../services/rbac.js';
import type {
  SystemUpdateStatus,
  UpdateBackupSnapshot,
  UpdateMigrationSnapshot,
  UpdatePreflightReport,
} from '../models/system-update.js';
import { getRegisteredMigrationCount } from '../db/migrations/index.js';
import { formatSqlDateTime } from '../utils/sql-date.js';
import { broadcastCitizenMessage } from '../services/citizen-messages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, '..');
const EXECUTIONS_FILE = path.resolve(__dirname, '..', '..', 'knowledge', 'executions.json');
const config = loadConfig();

const router = express.Router();

function sanitizeConnectionInput(input: any): Record<string, any> {
  if (!input || typeof input !== 'object') return {};
  return {
    id: typeof input.id === 'string' ? input.id : undefined,
    name: typeof input.name === 'string' ? input.name : undefined,
    baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : undefined,
    authMode: input.authMode === 'oauth' ? 'oauth' : input.authMode === 'api_key' ? 'api_key' : undefined,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : undefined,
    oauthTokenId: typeof input.oauthTokenId === 'string' ? input.oauthTokenId : undefined,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
    defaultModel: typeof input.defaultModel === 'string' ? input.defaultModel : undefined,
  };
}

function sanitizeChatbotSettingsInput(input: any): Record<string, any> {
  const root = input && typeof input === 'object' ? input : {};
  const nestedSettings =
    root.settings && typeof root.settings === 'object' && !Array.isArray(root.settings)
      ? root.settings
      : null;
  const nestedChatbotSettings =
    root.chatbotSettings && typeof root.chatbotSettings === 'object' && !Array.isArray(root.chatbotSettings)
      ? root.chatbotSettings
      : null;
  const nestedChatbot =
    root.chatbot && typeof root.chatbot === 'object' && !Array.isArray(root.chatbot)
      ? root.chatbot
      : null;
  const source: Record<string, any> = nestedSettings || nestedChatbotSettings || nestedChatbot || root;
  const routeRaw = source.route && typeof source.route === 'object' && !Array.isArray(source.route)
    ? source.route
    : {};
  const contextSourcesRaw = source.contextSources && typeof source.contextSources === 'object'
    ? source.contextSources
    : {};
  const capabilityFilterRaw = source.capabilityFilter && typeof source.capabilityFilter === 'object'
    ? source.capabilityFilter
    : {};
  const payload: Record<string, any> = {};

  if (typeof source.enabled === 'boolean') {
    payload.enabled = source.enabled;
  }

  const resolvedConnectionId =
    typeof source.connectionId === 'string'
      ? source.connectionId
      : typeof source.connection === 'string'
      ? source.connection
      : source.connection && typeof source.connection === 'object' && typeof source.connection.id === 'string'
      ? source.connection.id
      : typeof source.connection_id === 'string'
      ? source.connection_id
      : typeof source.providerConnectionId === 'string'
      ? source.providerConnectionId
      : typeof source.provider_connection_id === 'string'
      ? source.provider_connection_id
      : typeof routeRaw.connectionId === 'string'
      ? routeRaw.connectionId
      : typeof routeRaw.connection === 'string'
      ? routeRaw.connection
      : undefined;
  if (typeof resolvedConnectionId === 'string') {
    payload.connectionId = resolvedConnectionId;
  }

  const resolvedModelId =
    typeof source.modelId === 'string'
      ? source.modelId
      : typeof source.model === 'string'
      ? source.model
      : source.model && typeof source.model === 'object' && typeof source.model.id === 'string'
      ? source.model.id
      : source.model && typeof source.model === 'object' && typeof source.model.value === 'string'
      ? source.model.value
      : source.model && typeof source.model === 'object' && typeof source.model.name === 'string'
      ? source.model.name
      : typeof source.model_id === 'string'
      ? source.model_id
      : typeof source.aiModel === 'string'
      ? source.aiModel
      : typeof source.ai_model === 'string'
      ? source.ai_model
      : typeof source.chatbotModelId === 'string'
      ? source.chatbotModelId
      : typeof source.chatbot_model_id === 'string'
      ? source.chatbot_model_id
      : typeof routeRaw.modelId === 'string'
      ? routeRaw.modelId
      : typeof routeRaw.model === 'string'
      ? routeRaw.model
      : undefined;
  if (typeof resolvedModelId === 'string') {
    payload.modelId = resolvedModelId;
  }

  if (capabilityFilterRaw && typeof capabilityFilterRaw === 'object') {
    const capabilityFilter: Record<string, boolean> = {};
    if (Object.prototype.hasOwnProperty.call(capabilityFilterRaw, 'requireVision')) {
      capabilityFilter.requireVision = capabilityFilterRaw.requireVision === true;
    }
    if (Object.prototype.hasOwnProperty.call(capabilityFilterRaw, 'requireTts')) {
      capabilityFilter.requireTts = capabilityFilterRaw.requireTts === true;
    }
    if (Object.prototype.hasOwnProperty.call(capabilityFilterRaw, 'requireImageGeneration')) {
      capabilityFilter.requireImageGeneration = capabilityFilterRaw.requireImageGeneration === true;
    }
    if (Object.keys(capabilityFilter).length > 0) {
      payload.capabilityFilter = capabilityFilter;
    }
  }

  if (typeof source.systemPrompt === 'string') {
    payload.systemPrompt = source.systemPrompt;
  }

  if (contextSourcesRaw && typeof contextSourcesRaw === 'object') {
    const contextSources: Record<string, boolean> = {};
    if (Object.prototype.hasOwnProperty.call(contextSourcesRaw, 'adminProfile')) {
      contextSources.adminProfile = contextSourcesRaw.adminProfile === true;
    }
    if (Object.prototype.hasOwnProperty.call(contextSourcesRaw, 'accessScopes')) {
      contextSources.accessScopes = contextSourcesRaw.accessScopes === true;
    }
    if (Object.prototype.hasOwnProperty.call(contextSourcesRaw, 'recentTickets')) {
      contextSources.recentTickets = contextSourcesRaw.recentTickets === true;
    }
    if (Object.prototype.hasOwnProperty.call(contextSourcesRaw, 'openNotifications')) {
      contextSources.openNotifications = contextSourcesRaw.openNotifications === true;
    }
    if (Object.prototype.hasOwnProperty.call(contextSourcesRaw, 'aiQueueSummary')) {
      contextSources.aiQueueSummary = contextSourcesRaw.aiQueueSummary === true;
    }
    if (Object.keys(contextSources).length > 0) {
      payload.contextSources = contextSources;
    }
  }

  if (Number.isFinite(Number(source.maxHistoryMessages))) {
    payload.maxHistoryMessages = Number(source.maxHistoryMessages);
  }
  if (Number.isFinite(Number(source.maxContextChars))) {
    payload.maxContextChars = Number(source.maxContextChars);
  }
  if (Number.isFinite(Number(source.temperature))) {
    payload.temperature = Number(source.temperature);
  }

  return payload;
}

function inferLegacyProviderFromConnection(connection: LlmConnection): 'openai' | 'askcodi' {
  const marker = `${connection.name} ${connection.baseUrl}`.toLowerCase();
  if (marker.includes('askcodi')) return 'askcodi';
  return 'openai';
}

async function resolveLegacyProviderConnection(provider: 'openai' | 'askcodi'): Promise<LlmConnection | null> {
  const connections = await listLlmConnections(false);
  const enabled = connections.filter((entry) => entry.enabled !== false);
  const preferred = enabled.find((entry) => inferLegacyProviderFromConnection(entry) === provider);
  return preferred || enabled[0] || connections[0] || null;
}

/**
 * GET /api/admin/ai/situation-report/feed/atom
 * Atom-Feed fuer KI-Lageberichte (token-basiert, fuer Feed-Reader geeignet)
 */
router.get('/ai/situation-report/feed/atom', async (req: Request, res: Response): Promise<any> => {
  try {
    const control = await loadSituationReportControlSettings();
    if (!control.atomFeedEnabled) {
      return res.status(403).json({ message: 'Atom-Feed fuer KI-Lageberichte ist deaktiviert.' });
    }

    const providedToken = extractFeedTokenFromRequest(req, 'x-ai-situation-feed-token');
    const resolvedToken = await resolveActiveFeedToken('ai_situation', providedToken);
    if (!resolvedToken) {
      res.setHeader('WWW-Authenticate', 'Basic realm="behebes-ai-situation-feed"');
      return res.status(401).json({ message: 'Feed-Authentifizierung fehlgeschlagen.' });
    }
    await markFeedTokenUsed(resolvedToken.id);

    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
    const reportTypeFilterRaw = String(req.query?.reportType || '').trim();
    const reportTypeFilter =
      reportTypeFilterRaw === 'operations' ||
      reportTypeFilterRaw === 'category_workflow' ||
      reportTypeFilterRaw === 'free_analysis'
        ? reportTypeFilterRaw
        : '';

    const db = getDatabase();
    let query = `
      SELECT id, report_type, scope_key, days, max_tickets, created_at, updated_at, result_json
      FROM ai_situation_reports
      WHERE status = 'completed'
    `;
    const params: any[] = [];
    if (reportTypeFilter) {
      query += ' AND report_type = ?';
      params.push(reportTypeFilter);
    }
    query += ' ORDER BY datetime(created_at) DESC LIMIT ?';
    params.push(limit);

    const rows = await db.all(query, params);
    const requestBaseUrl = resolveRequestBaseUrl(req);
    const adminBaseUrl = String(config.adminUrl || '').trim().replace(/\/+$/, '') || requestBaseUrl;
    const selfUrlObject = new URL(`${requestBaseUrl}${req.originalUrl || req.path}`);
    selfUrlObject.searchParams.delete('token');
    const selfUrl = selfUrlObject.toString();
    const feedUpdatedAt =
      rows.length > 0
        ? safeIsoTimestamp(rows[0]?.updated_at || rows[0]?.created_at)
        : new Date().toISOString();

    const entries = (rows || [])
      .map((row: any) => {
        const reportId = String(row?.id || '').trim();
        if (!reportId) return '';
        const result = parseJsonIfPossible(row?.result_json) || {};
        const parsed = result?.ai?.dePseudonymizedParsed || result?.ai?.parsed || {};
        const reportType = normalizeSituationReportType(row?.report_type || result?.reportType, 'operations');
        const reportTypeLabel = resolveSituationReportTypeLabel(reportType);
        const summarySource =
          typeof parsed?.summary === 'string' && parsed.summary.trim()
            ? parsed.summary.trim()
            : typeof parsed?.categoryWorkflowSummary === 'string' && parsed.categoryWorkflowSummary.trim()
            ? parsed.categoryWorkflowSummary.trim()
            : typeof result?.summary === 'string' && result.summary.trim()
            ? result.summary.trim()
            : '';
        const summary = summarySource.replace(/\s+/g, ' ').trim().slice(0, 900);
        const ticketCount = Number(result?.ticketCount || 0);
        const scopeKey = String(row?.scope_key || result?.scopeKey || '').trim();
        const reportUrl = `${adminBaseUrl}/admin-settings/ai-situation?reportId=${encodeURIComponent(reportId)}`;
        const updated = safeIsoTimestamp(row?.updated_at || row?.created_at);
        const published = safeIsoTimestamp(row?.created_at || row?.updated_at);
        const title = `[${reportTypeLabel}] ${reportId.slice(0, 8)} · ${ticketCount} Tickets`;
        const summaryLines = [
          `Typ: ${reportTypeLabel}`,
          `Report-ID: ${reportId}`,
          `Scope-Key: ${scopeKey || '–'}`,
          `Zeitraum: ${Number(row?.days || 0)} Tage`,
          `Max Tickets: ${Number(row?.max_tickets || 0)}`,
          `Ausgewertete Tickets: ${Number.isFinite(ticketCount) ? ticketCount : 0}`,
          summary ? `Zusammenfassung: ${summary}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        return [
          '<entry>',
          `  <id>urn:behebes:situation-report:${escapeXml(reportId)}</id>`,
          `  <title>${escapeXml(title)}</title>`,
          `  <updated>${escapeXml(updated)}</updated>`,
          `  <published>${escapeXml(published)}</published>`,
          `  <link href="${escapeXml(reportUrl)}" rel="alternate" />`,
          `  <author><name>behebes.AI Lagebild</name></author>`,
          `  <summary>${escapeXml(summaryLines)}</summary>`,
          '</entry>',
        ].join('\n');
      })
      .filter(Boolean)
      .join('\n');

    const feed = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom">',
      '  <id>urn:behebes:situation-reports:feed</id>',
      '  <title>behebes.AI KI-Lageberichte</title>',
      `  <updated>${escapeXml(feedUpdatedAt)}</updated>`,
      `  <link rel="self" href="${escapeXml(selfUrl)}" />`,
      `  <link rel="alternate" href="${escapeXml(adminBaseUrl)}/admin-settings/ai-situation" />`,
      entries,
      '</feed>',
    ].join('\n');

    res.setHeader('Content-Type', 'application/atom+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).send(feed);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Erstellen des KI-Lagebild-Atom-Feeds',
      error: error?.message || String(error),
    });
  }
});

router.use(authMiddleware, staffOnly);
router.use((req: Request, _res: Response, next) => {
  const method = req.method.toUpperCase();
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    return next();
  }
  if (req.path.startsWith('/journal')) {
    return next();
  }

  const bodyKeys = req.body && typeof req.body === 'object'
    ? Object.keys(req.body).slice(0, 30)
    : [];

  void writeJournalEntry({
    eventType: 'ADMIN_API_MUTATION',
    severity: 'info',
    adminUserId: req.userId || null,
    username: req.username || null,
    role: req.role || null,
    sessionId: req.sessionId || null,
    method: req.method,
    path: req.originalUrl || req.path,
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    details: { bodyKeys },
  }).catch((error) => {
    console.error('ADMIN_API_MUTATION journal write failed:', error);
  });

  return next();
});

function convertToCamelCase(obj: any): any {
  if (!obj) return obj;
  const result: any = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
    result[camelKey] = obj[key];
  }
  return result;
}

function parseJsonIfPossible(value: any): any {
  if (typeof value !== 'string' || !value.trim()) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

async function resolveRequestAdminCapabilities(
  req: Request
): Promise<{ access: Awaited<ReturnType<typeof loadAdminAccessContext>>; capabilities: Set<string> }> {
  const access = await loadAdminAccessContext(normalizeText(req.userId), normalizeText(req.role));
  const capabilities = new Set(buildAdminCapabilities(access));
  return { access, capabilities };
}

function hasAnyCapability(capabilities: Set<string>, required: string[]): boolean {
  for (const capability of required) {
    if (capabilities.has(capability)) return true;
  }
  return false;
}

async function requireGlobalEmailSettingsAccess(req: Request, res: Response): Promise<boolean> {
  const { capabilities } = await resolveRequestAdminCapabilities(req);
  if (hasAnyCapability(capabilities, ['settings.email.global.manage'])) {
    return true;
  }
  res.status(403).json({ message: 'Keine Berechtigung für globale SMTP/IMAP-Einstellungen.' });
  return false;
}

async function requirePlatformAiSettingsAccess(req: Request, res: Response): Promise<boolean> {
  const { access, capabilities } = await resolveRequestAdminCapabilities(req);
  if (access.isGlobalAdmin && hasAnyCapability(capabilities, ['settings.ai.global.manage'])) {
    return true;
  }
  res.status(403).json({ message: 'Keine Berechtigung für globale KI-Gedächtnis-Einstellungen.' });
  return false;
}

async function requireTenantEmailSettingsAccess(req: Request, res: Response, tenantId: string): Promise<boolean> {
  const normalizedTenantId = normalizeText(tenantId);
  if (!normalizedTenantId) {
    res.status(400).json({ message: 'tenantId fehlt.' });
    return false;
  }
  const { access, capabilities } = await resolveRequestAdminCapabilities(req);
  if (!hasAnyCapability(capabilities, ['settings.email.tenant.manage'])) {
    res.status(403).json({ message: 'Keine Berechtigung für tenant-spezifische SMTP/IMAP-Einstellungen.' });
    return false;
  }
  if (access.isGlobalAdmin || access.tenantAdminTenantIds.includes(normalizedTenantId)) {
    return true;
  }
  res.status(403).json({ message: 'Für diesen Mandanten sind Adminrechte erforderlich.' });
  return false;
}

function resolveAdminContextTenantId(req: Request): string {
  const modeHeader = normalizeText(req.headers['x-admin-context-mode']).toLowerCase();
  const tenantHeader = normalizeText(req.headers['x-admin-context-tenant-id']);
  const tenantQuery = typeof req.query?.tenantId === 'string' ? normalizeText(req.query.tenantId) : '';
  if (modeHeader === 'tenant' && tenantHeader) return tenantHeader;
  return tenantQuery || tenantHeader;
}

type OpsTimeRange = '24h' | '7d' | '30d';

function normalizeOpsTimeRange(value: unknown): OpsTimeRange {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === '24h' || normalized === '7d' || normalized === '30d') {
    return normalized as OpsTimeRange;
  }
  return '7d';
}

function buildOpsSinceTimestamp(range: OpsTimeRange): string {
  const now = Date.now();
  const deltaMs =
    range === '24h'
      ? 24 * 60 * 60 * 1000
      : range === '30d'
      ? 30 * 24 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000;
  return new Date(now - deltaMs).toISOString();
}

function normalizeTicketClosedStatuses(): string[] {
  return ['closed', 'resolved', 'done', 'completed', 'cancelled'].map((entry) => entry.toLowerCase());
}

function normalizeTicketProcessingStatuses(): string[] {
  return ['in_progress', 'processing', 'assigned', 'ongoing'].map((entry) => entry.toLowerCase());
}

function extractJsonFromAiText(raw: string): Record<string, any> | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const normalized = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    const direct = JSON.parse(normalized);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as Record<string, any>;
  } catch {
    // continue
  }
  const match = normalized.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
  } catch {
    return null;
  }
  return null;
}

function hashNormalizedValue(value: string): string {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function parsePseudonymPoolEntries(raw: unknown): string[] {
  const parsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  if (!parsed) return [];
  const source = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as any).entries)
    ? (parsed as any).entries
    : [];
  return source
    .map((entry: unknown) => String(entry || '').trim())
    .filter((entry: string) => entry.length > 0);
}

async function loadPseudonymPool(poolType: string): Promise<string[]> {
  const db = getDatabase();
  const row = await db.get(
    `SELECT entries_json
     FROM llm_pseudonym_pools
     WHERE pool_type = ?
     ORDER BY version DESC, updated_at DESC, created_at DESC
     LIMIT 1`,
    [poolType]
  );
  const normalizedType = String(poolType || '').trim().toLowerCase() === 'email' ? 'email' : 'name';
  return normalizePseudonymEntriesForType(row?.entries_json, normalizedType);
}

function fallbackPseudoName(index: number): string {
  const normalizedIndex = Math.max(0, Math.floor(index));
  const first = DEFAULT_FIRST_NAMES[normalizedIndex % DEFAULT_FIRST_NAMES.length] || `Name${normalizedIndex + 1}`;
  const last =
    DEFAULT_LAST_NAMES[Math.floor(normalizedIndex / DEFAULT_FIRST_NAMES.length) % DEFAULT_LAST_NAMES.length] ||
    `Person${Math.floor(normalizedIndex / DEFAULT_FIRST_NAMES.length) + 1}`;
  return `${first} ${last}`.trim();
}

const FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS = [
  'buerger',
  'hinweis',
  'service',
  'meldung',
  'ticket',
  'kommunal',
  'info',
];
const FALLBACK_PSEUDO_EMAIL_TLDS = ['de', 'com', 'net', 'org', 'eu', 'info'];
const DEFAULT_PSEUDO_EMAIL_FALLBACK_DOMAINS = [
  'buergerservice.de',
  'hinweispost.net',
  'meldestelle.org',
  'kommunalinfo.eu',
  'ticketmail.com',
  'stadtinfo.info',
];

function fallbackPseudoEmail(index: number): string {
  const normalizedIndex = Math.max(0, Math.floor(index));
  const firstStem = FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS[normalizedIndex % FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS.length];
  const secondStem =
    FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS[
      Math.floor(normalizedIndex / FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS.length) % FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS.length
    ];
  const stem = firstStem === secondStem ? firstStem : `${firstStem}${secondStem}`;
  const tld = FALLBACK_PSEUDO_EMAIL_TLDS[normalizedIndex % FALLBACK_PSEUDO_EMAIL_TLDS.length];
  const localPart = `${firstStem}.${secondStem}.${String(normalizedIndex + 1).padStart(3, '0')}`.replace(/\.+/g, '.');
  return `${localPart}@${stem}.${tld}`;
}

function isLegacyPseudoName(value: unknown): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return /^reporter[-_\s]?\d{1,8}$/.test(normalized) || /^pseudo[-_\s]?reporter[-_\s]?\d{1,8}$/.test(normalized);
}

function isLegacyPseudoEmail(value: unknown): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized.includes('@')) return false;
  const domain = normalized.split('@')[1] || '';
  if (!domain) return false;
  if (domain === 'pseudo.local') return true;
  return /\.(local|localhost|invalid|test|example)$/i.test(domain);
}

async function ensurePseudonymValue(input: {
  scopeKey: string;
  entityType: 'name' | 'email';
  realValue: string;
  pool: string[];
  fallback: (index: number) => string;
  ttlDays?: number;
}): Promise<string> {
  const db = getDatabase();
  const normalized = String(input.realValue || '').trim();
  if (!normalized) return '';
  const ttlDays = Number.isFinite(Number(input.ttlDays)) ? Math.max(1, Number(input.ttlDays)) : 90;
  const hash = hashNormalizedValue(normalized);
  const now = Date.now();

  const existing = await db.get(
    `SELECT id, pseudo_value
     FROM llm_pseudonym_mappings
     WHERE scope_key = ?
       AND entity_type = ?
       AND real_value_hash = ?
       AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.scopeKey, input.entityType, hash]
  );
  if (existing?.pseudo_value) {
    const currentPseudo = String(existing.pseudo_value || '').trim();
    const isLegacy =
      input.entityType === 'name' ? isLegacyPseudoName(currentPseudo) : isLegacyPseudoEmail(currentPseudo);
    if (!isLegacy) {
      return currentPseudo;
    }
    if (existing?.id) {
      await db.run(`UPDATE llm_pseudonym_mappings SET expires_at = CURRENT_TIMESTAMP WHERE id = ?`, [existing.id]);
    }
  }

  const usedRows = await db.all(
    `SELECT pseudo_value
     FROM llm_pseudonym_mappings
     WHERE scope_key = ?
       AND entity_type = ?
       AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))`,
    [input.scopeKey, input.entityType]
  );
  const usedSet = new Set((usedRows || []).map((row: any) => String(row?.pseudo_value || '').trim()).filter(Boolean));
  const fromPool = input.pool.find((candidate) => !usedSet.has(candidate));
  const pseudo = fromPool || input.fallback(usedSet.size);
  const expiresAt = formatSqlDateTime(new Date(now + ttlDays * 24 * 60 * 60 * 1000));

  await db.run(
    `INSERT INTO llm_pseudonym_mappings (
      id, scope_key, entity_type, real_value_hash, pseudo_value, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      `psm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      input.scopeKey,
      input.entityType,
      hash,
      pseudo,
      expiresAt,
    ]
  );
  return pseudo;
}

type PseudonymPoolType = 'name' | 'email';
type SituationReportType = 'operations' | 'category_workflow' | 'free_analysis';

interface SituationReportControlSettings {
  enabled: boolean;
  pseudonymizeNames: boolean;
  pseudonymizeEmails: boolean;
  mappingTtlDays: number;
  defaultDays: number;
  defaultMaxTickets: number;
  includeClosedByDefault: boolean;
  autoRunEnabled: boolean;
  autoRunIntervalMinutes: number;
  autoRunScopeKey: string;
  autoRunNotifyOnRisk: boolean;
  autoRunNotifyOnAbuse: boolean;
  autoRunNotifyOnMessenger: boolean;
  autoRunEmailEnabled: boolean;
  autoRunEmailRecipients: string[];
  autoRunEmailSubject: string;
  autoRunEmailLastSentAt: string | null;
  autoRunEmailLastError: string | null;
  atomFeedEnabled: boolean;
  lastAutoRunAt: string | null;
  lastAutoRunError: string | null;
}

interface AnalysisMemorySettings {
  enabled: boolean;
  includeInPrompts: boolean;
  autoPersist: boolean;
  maxContextEntries: number;
  maxContextChars: number;
  retentionDays: number;
  additionalInstruction: string;
  maxAutoSummaryChars: number;
}

interface AnalysisMemoryRecord {
  id: string;
  scopeKey: string;
  reportType: SituationReportType | string;
  source: string;
  summary: string;
  details?: Record<string, any> | null;
  promptInstruction?: string | null;
  confidence?: number | null;
  reportId?: string | null;
  createdByAdminId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface PseudonymPoolRecord {
  id: string;
  poolType: PseudonymPoolType;
  version: number;
  entries: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

const PSEUDONYM_POOL_TYPES: PseudonymPoolType[] = ['name', 'email'];
const SITUATION_REPORT_TYPE_LABELS: Record<SituationReportType, string> = {
  operations: 'Operatives Lagebild',
  category_workflow: 'Kategorien & Workflow-Beratung',
  free_analysis: 'Freie Analyse',
};
const SITUATION_REPORT_CONTROL_KEY = 'aiSituationReportControl';
const DEFAULT_SITUATION_REPORT_CONTROL: SituationReportControlSettings = {
  enabled: true,
  pseudonymizeNames: true,
  pseudonymizeEmails: true,
  mappingTtlDays: 90,
  defaultDays: 30,
  defaultMaxTickets: 600,
  includeClosedByDefault: true,
  autoRunEnabled: false,
  autoRunIntervalMinutes: 30,
  autoRunScopeKey: 'situation-report-stable',
  autoRunNotifyOnRisk: true,
  autoRunNotifyOnAbuse: true,
  autoRunNotifyOnMessenger: true,
  autoRunEmailEnabled: false,
  autoRunEmailRecipients: [],
  autoRunEmailSubject: 'Automatisches KI-Lagebild',
  autoRunEmailLastSentAt: null,
  autoRunEmailLastError: null,
  atomFeedEnabled: false,
  lastAutoRunAt: null,
  lastAutoRunError: null,
};
let situationReportAutoTimer: NodeJS.Timeout | null = null;
let situationReportAutoLoopInitialized = false;
let situationReportAutoRunActive = false;

function sanitizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeSituationReportType(
  value: unknown,
  fallback: SituationReportType = 'operations'
): SituationReportType {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (
    normalized === 'free_analysis' ||
    normalized === 'free-analysis' ||
    normalized === 'free' ||
    normalized === 'custom'
  ) {
    return 'free_analysis';
  }
  if (normalized === 'category_workflow' || normalized === 'category-workflow' || normalized === 'workflow_advisory') {
    return 'category_workflow';
  }
  if (normalized === 'operations' || normalized === 'operational' || normalized === 'lagebild') {
    return 'operations';
  }
  return fallback;
}

function resolveSituationReportTypeLabel(value: unknown): string {
  const type = normalizeSituationReportType(value, 'operations');
  return SITUATION_REPORT_TYPE_LABELS[type] || SITUATION_REPORT_TYPE_LABELS.operations;
}

function parseJsonObject(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, any>;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeAnalysisMemorySource(value: unknown): 'auto' | 'manual' {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized === 'manual' ? 'manual' : 'auto';
}

function normalizeAnalysisMemoryRecord(row: any): AnalysisMemoryRecord {
  const reportType = normalizeSituationReportType(row?.report_type || row?.reportType, 'operations');
  const confidenceRaw = Number(row?.confidence);
  return {
    id: String(row?.id || ''),
    scopeKey: String(row?.scope_key || row?.scopeKey || 'situation-report-stable').trim() || 'situation-report-stable',
    reportType,
    source: normalizeAnalysisMemorySource(row?.source),
    summary: String(row?.summary || '').trim(),
    details: parseJsonObject(row?.details_json || row?.detailsJson),
    promptInstruction: String(row?.prompt_instruction || row?.promptInstruction || '').trim() || null,
    confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : null,
    reportId: String(row?.report_id || row?.reportId || '').trim() || null,
    createdByAdminId: String(row?.created_by_admin_id || row?.createdByAdminId || '').trim() || null,
    createdAt: row?.created_at || row?.createdAt || null,
    updatedAt: row?.updated_at || row?.updatedAt || null,
  };
}

async function loadAnalysisMemorySettings(): Promise<AnalysisMemorySettings> {
  const { values } = await loadAiAnalysisMemorySettings();
  return {
    enabled: values.enabled !== false,
    includeInPrompts: values.includeInPrompts !== false,
    autoPersist: values.autoPersist !== false,
    maxContextEntries: Math.max(1, Math.min(40, Number(values.maxContextEntries || 8))),
    maxContextChars: Math.max(400, Math.min(60000, Number(values.maxContextChars || 5000))),
    retentionDays: Math.max(1, Math.min(3650, Number(values.retentionDays || 365))),
    additionalInstruction: String(values.additionalInstruction || '').trim(),
    maxAutoSummaryChars: Math.max(200, Math.min(4000, Number(values.maxAutoSummaryChars || 900))),
  };
}

async function cleanupAnalysisMemory(retentionDays: number): Promise<void> {
  const db = getDatabase();
  const days = Math.max(1, Math.min(3650, Math.floor(Number(retentionDays) || 365)));
  try {
    await db.run(
      `DELETE FROM ai_analysis_memory
       WHERE datetime(created_at) < datetime('now', ?)`,
      [`-${days} days`]
    );
  } catch (error) {
    console.warn('Failed to cleanup ai_analysis_memory:', error);
  }
}

function buildAnalysisMemoryPromptContext(entries: AnalysisMemoryRecord[], maxChars: number): string {
  if (!Array.isArray(entries) || entries.length === 0) return 'Kein Memory-Kontext vorhanden.';
  const lines: string[] = [];
  for (const entry of entries) {
    const createdAt = safeIsoTimestamp(entry.createdAt || new Date().toISOString());
    const dateLabel = createdAt.slice(0, 10);
    const typeLabel = resolveSituationReportTypeLabel(entry.reportType);
    const sourceLabel = entry.source === 'manual' ? 'manuell' : 'auto';
    const summary = String(entry.summary || '').trim();
    if (!summary) continue;
    lines.push(`- [${dateLabel}] ${typeLabel} (${sourceLabel}): ${summary}`);
    if (entry.promptInstruction) {
      lines.push(`  Prompt-Notiz: ${entry.promptInstruction}`);
    }
  }
  const merged = lines.join('\n').trim();
  if (!merged) return 'Kein Memory-Kontext vorhanden.';
  if (merged.length <= maxChars) return merged;
  return `${merged.slice(0, Math.max(0, maxChars - 32)).trimEnd()}\n... (Memory gekürzt)`;
}

async function loadRecentAnalysisMemory(input: {
  scopeKey: string;
  reportType: SituationReportType;
  includeCrossType?: boolean;
  settings: AnalysisMemorySettings;
}): Promise<AnalysisMemoryRecord[]> {
  if (!input.settings.enabled) return [];
  const db = getDatabase();
  const limit = Math.max(1, Math.min(40, input.settings.maxContextEntries));
  const scopeKey = String(input.scopeKey || 'situation-report-stable').trim() || 'situation-report-stable';
  const includeCrossType = input.includeCrossType !== false;

  const rows = includeCrossType
    ? await db.all(
        `SELECT *
         FROM ai_analysis_memory
         WHERE scope_key = ?
         ORDER BY datetime(created_at) DESC
         LIMIT ?`,
        [scopeKey, limit]
      )
    : await db.all(
        `SELECT *
         FROM ai_analysis_memory
         WHERE scope_key = ? AND report_type = ?
         ORDER BY datetime(created_at) DESC
         LIMIT ?`,
        [scopeKey, input.reportType, limit]
      );

  return (rows || []).map((row: any) => normalizeAnalysisMemoryRecord(row)).filter((row) => !!row.id && !!row.summary);
}

async function insertAnalysisMemoryEntry(input: {
  scopeKey: string;
  reportType: SituationReportType;
  source: 'auto' | 'manual';
  summary: string;
  details?: Record<string, any> | null;
  promptInstruction?: string | null;
  confidence?: number | null;
  reportId?: string | null;
  createdByAdminId?: string | null;
}): Promise<AnalysisMemoryRecord> {
  const summary = String(input.summary || '').trim();
  if (!summary) {
    throw new Error('Memory summary ist erforderlich.');
  }
  const db = getDatabase();
  const id = `aim_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const scopeKey = String(input.scopeKey || 'situation-report-stable').trim() || 'situation-report-stable';
  const reportType = normalizeSituationReportType(input.reportType, 'operations');
  const promptInstruction = String(input.promptInstruction || '').trim();
  const confidenceRaw = Number(input.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : null;
  const detailsJson =
    input.details && typeof input.details === 'object' ? JSON.stringify(input.details) : null;

  await db.run(
    `INSERT INTO ai_analysis_memory (
      id, scope_key, report_type, source, summary, details_json, prompt_instruction,
      confidence, report_id, created_by_admin_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      id,
      scopeKey,
      reportType,
      input.source,
      summary,
      detailsJson,
      promptInstruction || null,
      confidence,
      input.reportId || null,
      input.createdByAdminId || null,
    ]
  );

  const row = await db.get(`SELECT * FROM ai_analysis_memory WHERE id = ? LIMIT 1`, [id]);
  return normalizeAnalysisMemoryRecord(row || { id, scope_key: scopeKey, report_type: reportType, summary, source: input.source });
}

function normalizeOptionalSituationReportTypeFilter(value: unknown): SituationReportType | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'all' || normalized === 'any') return null;
  if (
    normalized === 'operations' ||
    normalized === 'operational' ||
    normalized === 'lagebild' ||
    normalized === 'category_workflow' ||
    normalized === 'category-workflow' ||
    normalized === 'workflow_advisory' ||
    normalized === 'free_analysis' ||
    normalized === 'free-analysis' ||
    normalized === 'free' ||
    normalized === 'custom'
  ) {
    return normalizeSituationReportType(normalized, 'operations');
  }
  return null;
}

function buildHistoryMemoryFallbackSummary(input: {
  reportType: SituationReportType | null;
  scopeKey: string;
  compactReports: Array<Record<string, any>>;
}): string {
  const typeLabel = input.reportType ? resolveSituationReportTypeLabel(input.reportType) : 'Analyse-Mix';
  const keyFindings = input.compactReports
    .flatMap((entry) => toStringList(entry?.keyFindings))
    .filter(Boolean)
    .slice(0, 5);
  const recommendedActions = input.compactReports
    .flatMap((entry) => toStringList(entry?.recommendedActions))
    .filter(Boolean)
    .slice(0, 4);
  const base = [
    `${typeLabel}: ${input.compactReports.length} historische Reports fuer Scope ${input.scopeKey} verdichtet.`,
    keyFindings.length > 0 ? `Kernaussagen: ${keyFindings.join(' | ')}` : '',
    recommendedActions.length > 0 ? `Wiederkehrende Maßnahmen: ${recommendedActions.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return compactText(base, 1400);
}

function normalizeEmailAddress(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return '';
  return normalized;
}

function normalizeEmailAddressList(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
    ? value
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    const email = normalizeEmailAddress(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    result.push(email);
    if (result.length >= 40) break;
  }
  return result;
}

function safeIsoTimestamp(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return new Date().toISOString();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function escapeXml(value: unknown): string {
  const normalized = String(value ?? '');
  return normalized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveRequestBaseUrl(req: Request): string {
  const host = String(req.get('host') || '').trim();
  if (!host) return String(req.protocol || 'http').toLowerCase() + '://localhost';
  const protocol = String(req.protocol || 'http').toLowerCase();
  return `${protocol}://${host}`;
}

function normalizeOriginUrl(input: string): string {
  try {
    const parsed = new URL(String(input || '').trim());
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return '';
  }
}

function resolveWebAuthnOrigins(req: Request): string[] {
  const requestOrigin = normalizeOriginUrl(resolveRequestBaseUrl(req));
  const configuredAdminOrigin = normalizeOriginUrl(config.adminUrl || '');
  return cleanupAllowedOrigins([requestOrigin, configuredAdminOrigin]);
}

function resolveWebAuthnRpId(req: Request): string {
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').trim();
  const rpId = deriveRelyingPartyId(host);
  if (rpId) return rpId;
  const adminOrigin = normalizeOriginUrl(config.adminUrl || '');
  if (adminOrigin) {
    return new URL(adminOrigin).hostname;
  }
  return 'localhost';
}

interface PackageMetadata {
  name: string;
  version: string;
  description: string;
  path: string;
  available: boolean;
}

interface GitHistoryEntry {
  commit: string;
  shortCommit: string;
  authoredAt: string;
  author: string;
  subject: string;
}

interface GitMetadataSnapshot {
  available: boolean;
  branch: string | null;
  headCommit: string | null;
  describe: string | null;
  history: GitHistoryEntry[];
  fetchedAt: string;
  error?: string;
}

interface BuildMetadataSnapshot {
  appVersion: string;
  envBuildId: string | null;
  envBuildTime: string | null;
  envCommitRef: string | null;
}

interface DatabaseStructureColumnInfo {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: any;
  primaryKeyOrder: number;
}

interface DatabaseStructureForeignKeyInfo {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
  match: string;
}

interface DatabaseStructureTableInfo {
  name: string;
  rowCount: number;
  createSql: string;
  columns: DatabaseStructureColumnInfo[];
  foreignKeys: DatabaseStructureForeignKeyInfo[];
}

interface DatabaseStructureSnapshot {
  database: {
    pageCount: number;
    pageSize: number;
    sizeBytes: number;
    sizeMb: number;
  };
  tableCount: number;
  tables: DatabaseStructureTableInfo[];
  generatedAt: string;
}

function loadPackageMetadata(filePath: string): PackageMetadata {
  const fallbackName = path.basename(path.dirname(filePath)) || 'unknown';
  if (!existsSync(filePath)) {
    return {
      name: fallbackName,
      version: 'unbekannt',
      description: '',
      path: filePath,
      available: false,
    };
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, any>;
    return {
      name: String(parsed?.name || fallbackName),
      version: String(parsed?.version || 'unbekannt'),
      description: String(parsed?.description || ''),
      path: filePath,
      available: true,
    };
  } catch {
    return {
      name: fallbackName,
      version: 'unbekannt',
      description: '',
      path: filePath,
      available: false,
    };
  }
}

const PACKAGE_METADATA = {
  workspace: loadPackageMetadata(path.resolve(WORKSPACE_ROOT, 'package.json')),
  backend: loadPackageMetadata(path.resolve(BACKEND_ROOT, 'package.json')),
  admin: loadPackageMetadata(path.resolve(WORKSPACE_ROOT, 'admin', 'package.json')),
  frontend: loadPackageMetadata(path.resolve(WORKSPACE_ROOT, 'frontend', 'package.json')),
  ops: loadPackageMetadata(path.resolve(WORKSPACE_ROOT, 'ops', 'package.json')),
};

let gitMetadataCache: { expiresAt: number; snapshot: GitMetadataSnapshot } | null = null;

function runGitCommand(args: string[]): string {
  try {
    const output = execFileSync('git', args, {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 2 * 1024 * 1024,
    });
    return String(output || '').trim();
  } catch {
    return '';
  }
}

function loadGitMetadata(limit = 30): GitMetadataSnapshot {
  const safeLimit = Math.max(1, Math.min(120, Math.floor(Number(limit) || 30)));
  const now = Date.now();
  if (gitMetadataCache && gitMetadataCache.expiresAt > now) {
    return gitMetadataCache.snapshot;
  }

  const fetchedAt = new Date().toISOString();
  if (!existsSync(path.resolve(WORKSPACE_ROOT, '.git'))) {
    const snapshot: GitMetadataSnapshot = {
      available: false,
      branch: null,
      headCommit: null,
      describe: null,
      history: [],
      fetchedAt,
      error: '.git-Verzeichnis nicht gefunden',
    };
    gitMetadataCache = { snapshot, expiresAt: now + 60_000 };
    return snapshot;
  }

  const branch = runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD']) || null;
  const headCommit = runGitCommand(['rev-parse', '--short=12', 'HEAD']) || null;
  const describe = runGitCommand(['describe', '--tags', '--always', '--dirty']) || null;
  const rawHistory = runGitCommand([
    'log',
    `--max-count=${safeLimit}`,
    '--date=iso-strict',
    '--pretty=format:%H%x1f%h%x1f%cI%x1f%an%x1f%s',
  ]);
  const history = rawHistory
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): GitHistoryEntry | null => {
      const [commit, shortCommit, authoredAt, author, subject] = line.split('\x1f');
      if (!commit || !shortCommit || !authoredAt) return null;
      return {
        commit,
        shortCommit,
        authoredAt: safeIsoTimestamp(authoredAt),
        author: String(author || '').trim() || 'unbekannt',
        subject: String(subject || '').trim() || '(ohne Betreff)',
      };
    })
    .filter((entry): entry is GitHistoryEntry => !!entry);

  const available = !!(branch || headCommit || history.length);
  const snapshot: GitMetadataSnapshot = {
    available,
    branch,
    headCommit,
    describe,
    history,
    fetchedAt,
    ...(available ? {} : { error: 'Git-Metadaten nicht verfügbar' }),
  };
  gitMetadataCache = { snapshot, expiresAt: now + 30_000 };
  return snapshot;
}

function detectRuntimeType(): 'docker-compose' | 'node' {
  const composeV2 = path.resolve(WORKSPACE_ROOT, 'docker-compose.yml');
  const composeProd = path.resolve(WORKSPACE_ROOT, 'docker-compose.prod.yml');
  if (existsSync(composeV2) || existsSync(composeProd)) return 'docker-compose';
  return 'node';
}

function loadGitDirtyState(): boolean {
  const porcelain = runGitCommand(['status', '--porcelain']);
  return porcelain.length > 0;
}

function loadLatestGitTag(): string | null {
  const tag = runGitCommand(['describe', '--tags', '--abbrev=0']);
  return tag || null;
}

function loadBuildMetadata(): BuildMetadataSnapshot {
  return {
    appVersion: PACKAGE_METADATA.workspace.version || 'unbekannt',
    envBuildId: process.env.APP_BUILD_ID || process.env.BUILD_ID || process.env.ADMIN_BUILD_ID || null,
    envBuildTime: process.env.APP_BUILD_TIME || process.env.BUILD_TIME || process.env.ADMIN_BUILD_TIME || null,
    envCommitRef: process.env.VITE_COMMIT_SHA || process.env.GIT_COMMIT || process.env.COMMIT_SHA || null,
  };
}

function collectBackupArtifacts(maxDepth = 4): Array<{ path: string; mtimeMs: number }> {
  const backupRoot = path.resolve(WORKSPACE_ROOT, 'backups');
  if (!existsSync(backupRoot)) return [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: backupRoot, depth: 0 }];
  const artifacts: Array<{ path: string; mtimeMs: number }> = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const { dir, depth } = current;
    if (depth > maxDepth) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const absolute = path.resolve(dir, name);
      let stat: ReturnType<typeof statSync> | null = null;
      try {
        stat = statSync(absolute);
      } catch {
        stat = null;
      }
      if (!stat) continue;
      if (stat.isDirectory()) {
        stack.push({ dir: absolute, depth: depth + 1 });
        continue;
      }
      const lowered = name.toLowerCase();
      if (
        lowered.endsWith('.sql') ||
        lowered.endsWith('.sql.gz') ||
        lowered.endsWith('.tar.gz') ||
        lowered.endsWith('.dump')
      ) {
        artifacts.push({ path: absolute, mtimeMs: Number(stat.mtimeMs) });
      }
    }
  }
  artifacts.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return artifacts;
}

function loadBackupSnapshot(requiredMaxAgeHours = 24): UpdateBackupSnapshot {
  const artifacts = collectBackupArtifacts();
  const latest = artifacts[0];
  if (!latest) {
    return {
      available: false,
      latestPath: null,
      latestAt: null,
      ageHours: null,
      artifactCount: 0,
      requiredMaxAgeHours,
      isFresh: false,
    };
  }
  const latestAtIso = new Date(latest.mtimeMs).toISOString();
  const ageHours = Math.max(0, (Date.now() - latest.mtimeMs) / (1000 * 60 * 60));
  return {
    available: true,
    latestPath: latest.path,
    latestAt: latestAtIso,
    ageHours: Number(ageHours.toFixed(2)),
    artifactCount: artifacts.length,
    requiredMaxAgeHours,
    isFresh: ageHours <= requiredMaxAgeHours,
  };
}

function countMigrationDefinitionFiles(): number {
  return getRegisteredMigrationCount();
}

async function tableExistsByProbe(db: AppDatabase, tableName: string): Promise<boolean> {
  try {
    await db.get(`SELECT 1 AS ok FROM ${tableName} LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

async function loadMigrationSnapshot(db: AppDatabase): Promise<UpdateMigrationSnapshot> {
  const schemaMigrationsTable = await tableExistsByProbe(db, 'schema_migrations');
  const migrationFilesCount = countMigrationDefinitionFiles();
  let appliedCount = 0;
  if (schemaMigrationsTable) {
    try {
      const row = await db.get(`SELECT COUNT(*) AS count FROM schema_migrations WHERE COALESCE(success, 1) = 1`);
      appliedCount = Number(row?.count || 0);
    } catch {
      appliedCount = 0;
    }
  }
  const pendingCount = Math.max(0, migrationFilesCount - appliedCount);
  const consistent = schemaMigrationsTable ? pendingCount >= 0 : migrationFilesCount === 0;
  return {
    schemaMigrationsTable,
    appliedCount,
    migrationFilesCount,
    pendingCount,
    consistent,
  };
}

async function ensureSystemUpdateHistoryTable(db: AppDatabase): Promise<void> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS system_update_preflight_history (
      id VARCHAR(80) NOT NULL PRIMARY KEY,
      admin_user_id VARCHAR(80),
      username VARCHAR(255),
      report_json TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

async function appendSystemUpdateHistory(input: {
  db: AppDatabase;
  adminUserId: string | null;
  username: string | null;
  report: Record<string, any>;
}): Promise<void> {
  await ensureSystemUpdateHistoryTable(input.db);
  await input.db.run(
    `INSERT INTO system_update_preflight_history (id, admin_user_id, username, report_json, created_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      `upf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      input.adminUserId,
      input.username,
      JSON.stringify(input.report || {}),
    ]
  );
}

async function listSystemUpdateHistory(db: AppDatabase, limit = 30): Promise<any[]> {
  await ensureSystemUpdateHistoryTable(db);
  const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 30)));
  const rows = await db.all(
    `SELECT id, admin_user_id, username, report_json, created_at
     FROM system_update_preflight_history
     ORDER BY created_at DESC
     LIMIT ?`,
    [safeLimit]
  );
  return (rows || []).map((row: any) => {
    let parsed: any = {};
    try {
      parsed = JSON.parse(String(row?.report_json || '{}'));
    } catch {
      parsed = {};
    }
    return {
      id: String(row?.id || ''),
      adminUserId: row?.admin_user_id ? String(row.admin_user_id) : null,
      username: row?.username ? String(row.username) : null,
      createdAt: row?.created_at ? String(row.created_at) : null,
      report: parsed,
    };
  });
}

function buildUpdateRunbook(input: {
  targetTag: string | null;
  runtimeType: 'docker-compose' | 'node';
}): string[] {
  const target = input.targetTag || '<tag-oder-branch>';
  if (input.runtimeType === 'docker-compose') {
    return [
      `cd ${WORKSPACE_ROOT}`,
      '# 1) Backup erstellen (Pflicht)',
      'curl -fSL -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:3001/api/admin/maintenance/backup -o backups/pre-update-$(date +%Y%m%d-%H%M%S).sql',
      '# 2) Zielstand holen',
      'git fetch --tags --prune',
      `git checkout ${target}`,
      '# 3) Images ohne Cache bauen und Stack neu starten',
      'docker compose -f docker-compose.prod.yml build --no-cache',
      'docker compose -f docker-compose.prod.yml up -d',
      '# 4) Health prüfen',
      'docker compose -f docker-compose.prod.yml ps',
      'docker compose -f docker-compose.prod.yml logs --tail=200 backend',
      '# Rollback (Beispiel)',
      'git checkout <vorheriger-tag> && docker compose -f docker-compose.prod.yml up -d --build',
    ];
  }
  return [
    `cd ${WORKSPACE_ROOT}`,
    '# 1) Backup erstellen (Pflicht)',
    'curl -fSL -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:3001/api/admin/maintenance/backup -o backups/pre-update-$(date +%Y%m%d-%H%M%S).sql',
    '# 2) Zielstand holen',
    'git fetch --tags --prune',
    `git checkout ${target}`,
    '# 3) Abhängigkeiten + Build',
    'npm install',
    'npm --prefix backend run build',
    'npm --prefix admin run build',
    'npm --prefix frontend run build',
    'npm --prefix ops run build',
    '# 4) Dienste neu starten',
    'systemctl restart behebes-backend behebes-proxy',
  ];
}

async function loadSystemUpdateStatus(db: AppDatabase): Promise<SystemUpdateStatus> {
  const gitMetadata = loadGitMetadata(20);
  const latestTagVersion = loadLatestGitTag();
  const runtimeType = detectRuntimeType();
  const backup = loadBackupSnapshot(24);
  const migrations = await loadMigrationSnapshot(db);
  const build = loadBuildMetadata();
  return {
    currentVersion: build.appVersion,
    latestTagVersion,
    build,
    git: {
      available: gitMetadata.available,
      branch: gitMetadata.branch,
      headCommit: gitMetadata.headCommit,
      describe: gitMetadata.describe,
      dirty: loadGitDirtyState(),
    },
    runtimeType,
    backup,
    migrations,
    checkedAt: new Date().toISOString(),
  };
}

function maskTokenValue(value: unknown, keepStart = 6, keepEnd = 4): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const startLen = Math.max(0, Math.floor(keepStart));
  const endLen = Math.max(0, Math.floor(keepEnd));
  if (normalized.length <= startLen + endLen + 2) {
    return `${normalized.slice(0, Math.min(2, normalized.length))}${'*'.repeat(Math.max(3, normalized.length - 2))}`;
  }
  return `${normalized.slice(0, startLen)}${'*'.repeat(8)}${normalized.slice(-endLen)}`;
}

function parseEpochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    const parsedDate = Date.parse(value);
    if (!Number.isNaN(parsedDate)) return parsedDate;
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  if (numeric >= 1_000_000_000_000) return Math.floor(numeric);
  if (numeric >= 1_000_000_000) return Math.floor(numeric * 1000);
  return null;
}

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

async function buildDatabaseStructureSnapshot(db: AppDatabase): Promise<DatabaseStructureSnapshot> {
  const quoteIdentifier = (value: string) =>
    db.dialect === 'mysql'
      ? `\`${String(value || '').replace(/`/g, '``')}\``
      : `"${String(value || '').replace(/"/g, '""')}"`;

  const pageCountRow: any = await db.get(`PRAGMA page_count`);
  const pageSizeRow: any = await db.get(`PRAGMA page_size`);
  const pageCount = Number(pageCountRow?.page_count || pageCountRow?.pageCount || 0);
  const pageSize = Number(pageSizeRow?.page_size || pageSizeRow?.pageSize || 0);
  const sizeBytes = Math.max(0, pageCount * pageSize);

  const tableRows = await db.all(
    `SELECT name, sql
     FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
     ORDER BY name ASC`
  );

  const tables: DatabaseStructureTableInfo[] = [];
  for (const row of tableRows || []) {
    const name = String((row as any)?.name || '').trim();
    if (!name) continue;
    const escapedName = quoteIdentifier(name);

    const rowCountResult: any = await db.get(`SELECT COUNT(*) AS count FROM ${escapedName}`);
    const columnRows = await db.all(`PRAGMA table_info(${escapedName})`);
    const foreignKeyRows = await db.all(`PRAGMA foreign_key_list(${escapedName})`);

    tables.push({
      name,
      rowCount: Number(rowCountResult?.count || 0),
      createSql: String((row as any)?.sql || ''),
      columns: (columnRows || []).map((column: any) => ({
        cid: Number(column?.cid || 0),
        name: String(column?.name || ''),
        type: String(column?.type || ''),
        notNull: Number(column?.notnull || 0) === 1,
        defaultValue: column?.dflt_value === undefined ? null : column?.dflt_value,
        primaryKeyOrder: Number(column?.pk || 0),
      })),
      foreignKeys: (foreignKeyRows || []).map((fk: any) => ({
        id: Number(fk?.id || 0),
        seq: Number(fk?.seq || 0),
        table: String(fk?.table || ''),
        from: String(fk?.from || ''),
        to: String(fk?.to || ''),
        onUpdate: String(fk?.on_update || ''),
        onDelete: String(fk?.on_delete || ''),
        match: String(fk?.match || ''),
      })),
    });
  }

  return {
    database: {
      pageCount,
      pageSize,
      sizeBytes,
      sizeMb: sizeBytes > 0 ? Number((sizeBytes / (1024 * 1024)).toFixed(2)) : 0,
    },
    tableCount: tables.length,
    tables,
    generatedAt: new Date().toISOString(),
  };
}

function normalizeSituationReportControl(value: unknown): SituationReportControlSettings {
  const source = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  return {
    enabled:
      typeof source.enabled === 'boolean'
        ? source.enabled
        : DEFAULT_SITUATION_REPORT_CONTROL.enabled,
    pseudonymizeNames:
      typeof source.pseudonymizeNames === 'boolean'
        ? source.pseudonymizeNames
        : DEFAULT_SITUATION_REPORT_CONTROL.pseudonymizeNames,
    pseudonymizeEmails:
      typeof source.pseudonymizeEmails === 'boolean'
        ? source.pseudonymizeEmails
        : DEFAULT_SITUATION_REPORT_CONTROL.pseudonymizeEmails,
    mappingTtlDays: sanitizeInteger(
      source.mappingTtlDays,
      DEFAULT_SITUATION_REPORT_CONTROL.mappingTtlDays,
      1,
      3650
    ),
    defaultDays: sanitizeInteger(source.defaultDays, DEFAULT_SITUATION_REPORT_CONTROL.defaultDays, 1, 365),
    defaultMaxTickets: sanitizeInteger(
      source.defaultMaxTickets,
      DEFAULT_SITUATION_REPORT_CONTROL.defaultMaxTickets,
      50,
      2000
    ),
    includeClosedByDefault:
      typeof source.includeClosedByDefault === 'boolean'
        ? source.includeClosedByDefault
        : DEFAULT_SITUATION_REPORT_CONTROL.includeClosedByDefault,
    autoRunEnabled:
      typeof source.autoRunEnabled === 'boolean'
        ? source.autoRunEnabled
        : DEFAULT_SITUATION_REPORT_CONTROL.autoRunEnabled,
    autoRunIntervalMinutes: sanitizeInteger(
      source.autoRunIntervalMinutes,
      DEFAULT_SITUATION_REPORT_CONTROL.autoRunIntervalMinutes,
      5,
      1440
    ),
    autoRunScopeKey:
      typeof source.autoRunScopeKey === 'string' && source.autoRunScopeKey.trim()
        ? source.autoRunScopeKey.trim().slice(0, 120)
        : DEFAULT_SITUATION_REPORT_CONTROL.autoRunScopeKey,
    autoRunNotifyOnRisk:
      typeof source.autoRunNotifyOnRisk === 'boolean'
        ? source.autoRunNotifyOnRisk
        : DEFAULT_SITUATION_REPORT_CONTROL.autoRunNotifyOnRisk,
    autoRunNotifyOnAbuse:
      typeof source.autoRunNotifyOnAbuse === 'boolean'
        ? source.autoRunNotifyOnAbuse
        : DEFAULT_SITUATION_REPORT_CONTROL.autoRunNotifyOnAbuse,
    autoRunNotifyOnMessenger:
      typeof source.autoRunNotifyOnMessenger === 'boolean'
        ? source.autoRunNotifyOnMessenger
        : DEFAULT_SITUATION_REPORT_CONTROL.autoRunNotifyOnMessenger,
    autoRunEmailEnabled:
      typeof source.autoRunEmailEnabled === 'boolean'
        ? source.autoRunEmailEnabled
        : DEFAULT_SITUATION_REPORT_CONTROL.autoRunEmailEnabled,
    autoRunEmailRecipients: normalizeEmailAddressList(
      source.autoRunEmailRecipients ?? DEFAULT_SITUATION_REPORT_CONTROL.autoRunEmailRecipients
    ),
    autoRunEmailSubject:
      typeof source.autoRunEmailSubject === 'string' && source.autoRunEmailSubject.trim()
        ? source.autoRunEmailSubject.trim().slice(0, 180)
        : DEFAULT_SITUATION_REPORT_CONTROL.autoRunEmailSubject,
    autoRunEmailLastSentAt:
      typeof source.autoRunEmailLastSentAt === 'string' && source.autoRunEmailLastSentAt.trim()
        ? source.autoRunEmailLastSentAt
        : DEFAULT_SITUATION_REPORT_CONTROL.autoRunEmailLastSentAt,
    autoRunEmailLastError:
      typeof source.autoRunEmailLastError === 'string' && source.autoRunEmailLastError.trim()
        ? source.autoRunEmailLastError
        : DEFAULT_SITUATION_REPORT_CONTROL.autoRunEmailLastError,
    atomFeedEnabled:
      typeof source.atomFeedEnabled === 'boolean'
        ? source.atomFeedEnabled
        : DEFAULT_SITUATION_REPORT_CONTROL.atomFeedEnabled,
    lastAutoRunAt:
      typeof source.lastAutoRunAt === 'string' && source.lastAutoRunAt.trim()
        ? source.lastAutoRunAt
        : DEFAULT_SITUATION_REPORT_CONTROL.lastAutoRunAt,
    lastAutoRunError:
      typeof source.lastAutoRunError === 'string' && source.lastAutoRunError.trim()
        ? source.lastAutoRunError
        : DEFAULT_SITUATION_REPORT_CONTROL.lastAutoRunError,
  };
}

async function loadSituationReportControlSettings(): Promise<SituationReportControlSettings> {
  const stored = await getSetting<Record<string, any>>(SITUATION_REPORT_CONTROL_KEY);
  return normalizeSituationReportControl(stored);
}

async function saveSituationReportControlSettings(
  partial: Partial<SituationReportControlSettings>
): Promise<SituationReportControlSettings> {
  const current = await loadSituationReportControlSettings();
  const next = normalizeSituationReportControl({
    ...current,
    ...partial,
  });
  await setSetting(SITUATION_REPORT_CONTROL_KEY, next);
  return next;
}

function toPseudonymPoolType(value: unknown): PseudonymPoolType | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'name' || normalized === 'email') return normalized;
  return null;
}

function sanitizePseudonymName(raw: unknown): string {
  let value = '';
  if (typeof raw === 'string') {
    value = raw;
  } else if (raw && typeof raw === 'object') {
    const source = raw as Record<string, any>;
    const firstName = String(source.firstName || source.first_name || '').trim();
    const lastName = String(source.lastName || source.last_name || '').trim();
    const fullName = String(source.name || source.fullName || '').trim();
    value = [firstName, lastName].filter(Boolean).join(' ').trim() || fullName;
  }
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (/\[object Object\]/i.test(normalized)) return '';
  if (/[@{}[\]<>]/.test(normalized)) return '';
  if (normalized.length < 2 || normalized.length > 90) return '';
  return normalized;
}

function normalizePseudonymEntriesForType(input: unknown, poolType: PseudonymPoolType): string[] {
  const source =
    typeof input === 'string'
      ? input
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean)
      : Array.isArray(input)
      ? input
      : parsePseudonymPoolEntries(input);

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawEntry of source) {
    const entryRaw =
      poolType === 'name'
        ? sanitizePseudonymName(rawEntry)
        : String(rawEntry || '')
            .trim()
            .toLowerCase();
    const entry = poolType === 'email' ? entryRaw.toLowerCase() : entryRaw;
    if (!entry) continue;
    if (poolType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    normalized.push(entry);
    if (normalized.length >= 10000) break;
  }
  return normalized;
}

function toPseudonymPoolRecord(poolType: PseudonymPoolType, row: any): PseudonymPoolRecord {
  return {
    id: String(row?.id || ''),
    poolType,
    version: Number(row?.version || 1),
    entries: normalizePseudonymEntriesForType(row?.entries_json, poolType),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
  };
}

async function loadLatestPseudonymPoolRecord(poolType: PseudonymPoolType): Promise<PseudonymPoolRecord | null> {
  const db = getDatabase();
  const row = await db.get(
    `SELECT id, pool_type, entries_json, version, created_at, updated_at
     FROM llm_pseudonym_pools
     WHERE pool_type = ?
     ORDER BY version DESC, updated_at DESC, created_at DESC
     LIMIT 1`,
    [poolType]
  );
  if (!row) return null;
  return toPseudonymPoolRecord(poolType, row);
}

async function savePseudonymPool(input: {
  poolType: PseudonymPoolType;
  entries: string[];
  mode?: 'replace' | 'append';
}): Promise<PseudonymPoolRecord> {
  const db = getDatabase();
  const latest = await loadLatestPseudonymPoolRecord(input.poolType);
  const baseEntries = input.mode === 'append' && latest ? latest.entries : [];
  const mergedEntries = normalizePseudonymEntriesForType([...baseEntries, ...input.entries], input.poolType);
  const nextVersion = latest ? Number(latest.version || 0) + 1 : 1;
  const id = `psp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  await db.run(
    `INSERT INTO llm_pseudonym_pools (id, pool_type, entries_json, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, input.poolType, JSON.stringify(mergedEntries), nextVersion]
  );

  return {
    id,
    poolType: input.poolType,
    version: nextVersion,
    entries: mergedEntries,
    createdAt: null,
    updatedAt: null,
  };
}

function slugifyEmailLocalPart(value: string): string {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');
  if (!normalized) return '';
  return normalized.slice(0, 48);
}

function normalizeDomainPool(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawEntry of input) {
    const entry = String(rawEntry || '').trim().toLowerCase();
    if (!entry) continue;
    if (!/^[a-z0-9.-]+$/.test(entry)) continue;
    if (!entry.includes('.')) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    normalized.push(entry);
    if (normalized.length >= 1000) break;
  }
  return normalized;
}

function buildGeneratedEmailPool(input: {
  names: string[];
  fallbackDomains: string[];
  requestedCount: number;
}): string[] {
  const requestedCount = Math.max(1, Math.min(5000, Math.floor(input.requestedCount)));
  const domains = input.fallbackDomains.length > 0 ? input.fallbackDomains : DEFAULT_PSEUDO_EMAIL_FALLBACK_DOMAINS;
  const entries: string[] = [];
  const seen = new Set<string>();
  let index = 0;
  while (entries.length < requestedCount) {
    const nameCandidate = input.names[index % Math.max(1, input.names.length)] || '';
    const localPartBase = slugifyEmailLocalPart(nameCandidate) || `reporter-${String(index + 1).padStart(4, '0')}`;
    const localPart = index < input.names.length ? localPartBase : `${localPartBase}.${String(index + 1).padStart(3, '0')}`;
    const domain = domains[index % domains.length];
    const entry = `${localPart}@${domain}`.toLowerCase();
    if (!seen.has(entry)) {
      seen.add(entry);
      entries.push(entry);
    }
    index += 1;
    if (index > requestedCount * 10) break;
  }
  return entries;
}

async function loadPseudonymMappingStats(): Promise<{
  name: { total: number; active: number; expired: number };
  email: { total: number; active: number; expired: number };
  distinctScopes: number;
}> {
  const db = getDatabase();
  const rows = await db.all(
    `SELECT entity_type,
            COUNT(*) AS total,
            SUM(CASE WHEN expires_at IS NULL OR datetime(expires_at) >= datetime('now') THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN expires_at IS NOT NULL AND datetime(expires_at) < datetime('now') THEN 1 ELSE 0 END) AS expired
     FROM llm_pseudonym_mappings
     GROUP BY entity_type`
  );
  const scopes = await db.get(
    `SELECT COUNT(DISTINCT scope_key) AS total
     FROM llm_pseudonym_mappings
     WHERE expires_at IS NULL OR datetime(expires_at) >= datetime('now')`
  );

  const defaultStats = { total: 0, active: 0, expired: 0 };
  const statsByType: Record<PseudonymPoolType, { total: number; active: number; expired: number }> = {
    name: { ...defaultStats },
    email: { ...defaultStats },
  };
  for (const row of rows || []) {
    const poolType = toPseudonymPoolType(row?.entity_type);
    if (!poolType) continue;
    statsByType[poolType] = {
      total: Number(row?.total || 0),
      active: Number(row?.active || 0),
      expired: Number(row?.expired || 0),
    };
  }

  return {
    name: statsByType.name,
    email: statsByType.email,
    distinctScopes: Number(scopes?.total || 0),
  };
}

async function loadPseudonymPreviewRows(limit = 250): Promise<{
  mappingRows: Array<{
    id: string;
    scopeKey: string;
    entityType: PseudonymPoolType;
    pseudoValue: string;
    createdAt: string | null;
    expiresAt: string | null;
    isActive: boolean;
  }>;
  ticketReporterRows: Array<{
    ticketId: string;
    scopeKey: string;
    pseudoName: string;
    pseudoFirstName: string;
    pseudoLastName: string;
    pseudoEmail: string;
    createdAt: string | null;
    updatedAt: string | null;
    ticketStatus: string | null;
    ticketCreatedAt: string | null;
    ticketUpdatedAt: string | null;
  }>;
}> {
  const db = getDatabase();
  const safeLimit = Math.max(20, Math.min(1000, Math.floor(Number(limit) || 250)));
  const [mappingRowsRaw, ticketRowsRaw] = await Promise.all([
    db.all(
      `SELECT id, scope_key, entity_type, pseudo_value, created_at, expires_at,
              CASE
                WHEN expires_at IS NULL OR datetime(expires_at) >= datetime('now') THEN 1
                ELSE 0
              END AS is_active
       FROM llm_pseudonym_mappings
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
      [safeLimit]
    ),
    db.all(
      `SELECT tp.ticket_id, tp.scope_key, tp.pseudo_name, tp.pseudo_first_name, tp.pseudo_last_name,
              tp.pseudo_email, tp.created_at, tp.updated_at,
              t.status AS ticket_status, t.created_at AS ticket_created_at, t.updated_at AS ticket_updated_at
       FROM ticket_reporter_pseudonyms tp
       LEFT JOIN tickets t ON t.id = tp.ticket_id
       ORDER BY datetime(tp.updated_at) DESC
       LIMIT ?`,
      [safeLimit]
    ),
  ]);

  const mappingRows = (mappingRowsRaw || [])
    .map((row: any) => {
      const entityType = toPseudonymPoolType(row?.entity_type);
      if (!entityType) return null;
      return {
        id: String(row?.id || ''),
        scopeKey: String(row?.scope_key || ''),
        entityType,
        pseudoValue: String(row?.pseudo_value || ''),
        createdAt: row?.created_at || null,
        expiresAt: row?.expires_at || null,
        isActive: Number(row?.is_active || 0) === 1,
      };
    })
    .filter((row): row is {
      id: string;
      scopeKey: string;
      entityType: PseudonymPoolType;
      pseudoValue: string;
      createdAt: string | null;
      expiresAt: string | null;
      isActive: boolean;
    } => row !== null);

  const ticketReporterRows = (ticketRowsRaw || []).map((row: any) => ({
    ticketId: String(row?.ticket_id || ''),
    scopeKey: String(row?.scope_key || ''),
    pseudoName: String(row?.pseudo_name || ''),
    pseudoFirstName: String(row?.pseudo_first_name || ''),
    pseudoLastName: String(row?.pseudo_last_name || ''),
    pseudoEmail: String(row?.pseudo_email || ''),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    ticketStatus: row?.ticket_status || null,
    ticketCreatedAt: row?.ticket_created_at || null,
    ticketUpdatedAt: row?.ticket_updated_at || null,
  }));

  return { mappingRows, ticketReporterRows };
}

interface PseudonymFillControlSettings {
  enabled: boolean;
  running: boolean;
  intervalSeconds: number;
  fillNamesEnabled: boolean;
  fillEmailsEnabled: boolean;
  chunkSizeNames: number;
  chunkSizeEmails: number;
  targetNamePoolSize: number;
  targetEmailPoolSize: number;
  useAiGenerator: boolean;
  lastRunSource: 'none' | 'ai' | 'mixed' | 'deterministic';
  lastRunRequestedNames: number;
  lastRunRequestedEmails: number;
  lastRunAddedNames: number;
  lastRunAddedEmails: number;
  lastRunAt: string | null;
  lastError: string | null;
}

interface PseudonymFillProgress {
  nameCount: number;
  emailCount: number;
  targetNamePoolSize: number;
  targetEmailPoolSize: number;
  nameMissing: number;
  emailMissing: number;
  done: boolean;
}

const DEFAULT_FIRST_NAMES = [
  'Alex', 'Sam', 'Chris', 'Nico', 'Mika', 'Robin', 'Lea', 'Mara', 'Tina', 'Lena',
  'Jonas', 'Finn', 'Lukas', 'Milan', 'Nora', 'Mia', 'Ida', 'Jana', 'Paula', 'Sina',
  'Emil', 'Noah', 'Tom', 'Jan', 'David', 'Ben', 'Max', 'Tim', 'Kai', 'Rene',
  'Anna', 'Eva', 'Marie', 'Lia', 'Elif', 'Sofia', 'Lina', 'Kira', 'Mona', 'Nele',
];
const DEFAULT_LAST_NAMES = [
  'Becker', 'Schmidt', 'Mueller', 'Schulz', 'Hoffmann', 'Wagner', 'Koch', 'Bauer', 'Richter', 'Klein',
  'Wolf', 'Neumann', 'Schroeder', 'Werner', 'Braun', 'Hofmann', 'Hartmann', 'Schmitz', 'Krueger', 'Meier',
  'Schuster', 'Winter', 'Voigt', 'Mayer', 'Krause', 'Sommer', 'Engel', 'Arnold', 'Peters', 'Fischer',
  'Ludwig', 'Dietrich', 'Kaiser', 'Seidel', 'Otto', 'Lorenz', 'Graf', 'Franke', 'Busch', 'Kuhn',
];

const PSEUDONYM_FILL_CONTROL_KEY = 'aiPseudonymFillControl';
const DEFAULT_PSEUDONYM_FILL_CONTROL: PseudonymFillControlSettings = {
  enabled: true,
  running: false,
  intervalSeconds: 20,
  fillNamesEnabled: true,
  fillEmailsEnabled: true,
  chunkSizeNames: 40,
  chunkSizeEmails: 40,
  targetNamePoolSize: 1500,
  targetEmailPoolSize: 1500,
  useAiGenerator: false,
  lastRunSource: 'none',
  lastRunRequestedNames: 0,
  lastRunRequestedEmails: 0,
  lastRunAddedNames: 0,
  lastRunAddedEmails: 0,
  lastRunAt: null,
  lastError: null,
};
let pseudonymFillTimer: NodeJS.Timeout | null = null;
let pseudonymFillLoopInitialized = false;
let pseudonymFillChunkRunning = false;

function normalizePseudonymFillControlSettings(value: unknown): PseudonymFillControlSettings {
  const source = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const base = {
    ...DEFAULT_PSEUDONYM_FILL_CONTROL,
    ...source,
  };
  return {
    enabled: base.enabled !== false,
    running: base.running === true,
    intervalSeconds: sanitizeInteger(base.intervalSeconds, DEFAULT_PSEUDONYM_FILL_CONTROL.intervalSeconds, 5, 300),
    fillNamesEnabled: base.fillNamesEnabled !== false,
    fillEmailsEnabled: base.fillEmailsEnabled !== false,
    chunkSizeNames: sanitizeInteger(base.chunkSizeNames, DEFAULT_PSEUDONYM_FILL_CONTROL.chunkSizeNames, 5, 300),
    chunkSizeEmails: sanitizeInteger(base.chunkSizeEmails, DEFAULT_PSEUDONYM_FILL_CONTROL.chunkSizeEmails, 5, 300),
    targetNamePoolSize: sanitizeInteger(
      base.targetNamePoolSize,
      DEFAULT_PSEUDONYM_FILL_CONTROL.targetNamePoolSize,
      100,
      20000
    ),
    targetEmailPoolSize: sanitizeInteger(
      base.targetEmailPoolSize,
      DEFAULT_PSEUDONYM_FILL_CONTROL.targetEmailPoolSize,
      100,
      20000
    ),
    useAiGenerator: base.useAiGenerator === true,
    lastRunSource:
      base.lastRunSource === 'ai' || base.lastRunSource === 'mixed' || base.lastRunSource === 'deterministic'
        ? base.lastRunSource
        : 'none',
    lastRunRequestedNames: sanitizeInteger(base.lastRunRequestedNames, 0, 0, 100000),
    lastRunRequestedEmails: sanitizeInteger(base.lastRunRequestedEmails, 0, 0, 100000),
    lastRunAddedNames: sanitizeInteger(base.lastRunAddedNames, 0, 0, 100000),
    lastRunAddedEmails: sanitizeInteger(base.lastRunAddedEmails, 0, 0, 100000),
    lastRunAt: typeof base.lastRunAt === 'string' && base.lastRunAt.trim() ? base.lastRunAt : null,
    lastError: typeof base.lastError === 'string' && base.lastError.trim() ? base.lastError : null,
  };
}

async function loadPseudonymFillControlSettings(): Promise<PseudonymFillControlSettings> {
  const stored = await getSetting<Record<string, any>>(PSEUDONYM_FILL_CONTROL_KEY);
  return normalizePseudonymFillControlSettings(stored);
}

async function savePseudonymFillControlSettings(
  partial: Partial<PseudonymFillControlSettings>
): Promise<PseudonymFillControlSettings> {
  const current = await loadPseudonymFillControlSettings();
  const next = normalizePseudonymFillControlSettings({
    ...current,
    ...partial,
  });
  await setSetting(PSEUDONYM_FILL_CONTROL_KEY, next);
  return next;
}

async function getPseudonymPoolEntryCount(poolType: PseudonymPoolType): Promise<number> {
  const latest = await loadLatestPseudonymPoolRecord(poolType);
  return Array.isArray(latest?.entries) ? latest!.entries.length : 0;
}

async function loadPseudonymFillProgress(
  control?: PseudonymFillControlSettings
): Promise<PseudonymFillProgress> {
  const resolvedControl = control || (await loadPseudonymFillControlSettings());
  const [nameCount, emailCount] = await Promise.all([
    getPseudonymPoolEntryCount('name'),
    getPseudonymPoolEntryCount('email'),
  ]);
  const nameMissing = resolvedControl.fillNamesEnabled
    ? Math.max(0, resolvedControl.targetNamePoolSize - nameCount)
    : 0;
  const emailMissing = resolvedControl.fillEmailsEnabled
    ? Math.max(0, resolvedControl.targetEmailPoolSize - emailCount)
    : 0;
  const done = nameMissing === 0 && emailMissing === 0;
  return {
    nameCount,
    emailCount,
    targetNamePoolSize: resolvedControl.targetNamePoolSize,
    targetEmailPoolSize: resolvedControl.targetEmailPoolSize,
    nameMissing,
    emailMissing,
    done,
  };
}

function createPseudoNameChunk(startIndex: number, count: number): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  let index = Math.max(0, startIndex);
  while (results.length < count) {
    const first = DEFAULT_FIRST_NAMES[index % DEFAULT_FIRST_NAMES.length] || `Name${index + 1}`;
    const last =
      DEFAULT_LAST_NAMES[Math.floor(index / DEFAULT_FIRST_NAMES.length) % DEFAULT_LAST_NAMES.length] ||
      `Person${Math.floor(index / DEFAULT_FIRST_NAMES.length) + 1}`;
    const entry = `${first} ${last}`.trim();
    if (!seen.has(entry)) {
      seen.add(entry);
      results.push(entry);
    }
    index += 1;
    if (index > startIndex + count * 20) break;
  }
  return results;
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDePseudonymReplacementEntries(mapping: Map<string, string>): Array<{ from: string; to: string }> {
  const entries: Array<{ from: string; to: string }> = [];
  for (const [pseudoRaw, clearRaw] of mapping.entries()) {
    const pseudo = String(pseudoRaw || '').trim();
    const clear = String(clearRaw || '').trim();
    if (!pseudo || !clear) continue;
    entries.push({ from: pseudo, to: clear });

    const reporterMatch = pseudo.match(/^reporter-(\d{2,})$/i);
    if (reporterMatch) {
      const suffix = reporterMatch[1];
      const suffixCompact = String(Number(suffix));
      entries.push({ from: `reporter-${suffix}`, to: clear });
      entries.push({ from: `reporter_${suffix}`, to: clear });
      entries.push({ from: `reporter ${suffix}`, to: clear });
      if (suffixCompact && suffixCompact !== 'NaN') {
        entries.push({ from: `reporter-${suffixCompact}`, to: clear });
        entries.push({ from: `reporter_${suffixCompact}`, to: clear });
        entries.push({ from: `reporter ${suffixCompact}`, to: clear });
      }
    }
  }
  return entries.sort((a, b) => b.from.length - a.from.length);
}

function replacePseudonymsInText(value: string, mapping: Map<string, string>): string {
  let result = String(value || '');
  const replacements = buildDePseudonymReplacementEntries(mapping);
  for (const replacement of replacements) {
    if (!replacement.from || !replacement.to) continue;
    const regex = new RegExp(escapeRegExp(replacement.from), 'gi');
    result = result.replace(regex, () => replacement.to);
  }
  return result;
}

function dePseudonymizeValue(value: any, mapping: Map<string, string>, depth = 0): any {
  if (depth > 8) return value;
  if (typeof value === 'string') {
    return replacePseudonymsInText(value, mapping);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => dePseudonymizeValue(entry, mapping, depth + 1));
  }
  if (value && typeof value === 'object') {
    const next: Record<string, any> = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = dePseudonymizeValue(child, mapping, depth + 1);
    }
    return next;
  }
  return value;
}

function splitPseudoName(value: string): { firstName: string; lastName: string } {
  const normalized = String(value || '').trim();
  if (!normalized) return { firstName: '', lastName: '' };
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: parts[0] || '', lastName: '' };
  }
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

async function upsertTicketReporterPseudonym(input: {
  ticketId: string;
  scopeKey: string;
  pseudoName: string;
  pseudoEmail: string;
}) {
  const ticketId = String(input.ticketId || '').trim();
  if (!ticketId) return;
  const pseudoName = String(input.pseudoName || '').trim();
  const pseudoEmail = String(input.pseudoEmail || '').trim();
  const split = splitPseudoName(pseudoName);
  const db = getDatabase();
  await db.run(
    `INSERT INTO ticket_reporter_pseudonyms (
      ticket_id, scope_key, pseudo_name, pseudo_first_name, pseudo_last_name, pseudo_email, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(ticket_id)
    DO UPDATE SET
      scope_key = excluded.scope_key,
      pseudo_name = excluded.pseudo_name,
      pseudo_first_name = excluded.pseudo_first_name,
      pseudo_last_name = excluded.pseudo_last_name,
      pseudo_email = excluded.pseudo_email,
      updated_at = CURRENT_TIMESTAMP`,
    [ticketId, input.scopeKey || null, pseudoName || null, split.firstName || null, split.lastName || null, pseudoEmail || null]
  );
}

interface SituationWorkflowSummary {
  id: string;
  ticketId: string;
  templateId: string;
  title: string;
  status: string;
  executionMode: string;
  blockedReason: string;
  startedAt: string | null;
  completedAt: string | null;
  durationHours: number | null;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningTasks: number;
  pendingTasks: number;
}

function parseIsoMs(value: unknown): number {
  const source = String(value || '').trim();
  if (!source) return 0;
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeDurationHours(startIso: unknown, endIso: unknown): number | null {
  const startMs = parseIsoMs(startIso);
  if (startMs <= 0) return null;
  const endMs = parseIsoMs(endIso);
  const targetMs = endMs > 0 ? endMs : Date.now();
  const diff = Math.max(0, targetMs - startMs);
  return Number((diff / (1000 * 60 * 60)).toFixed(2));
}

function loadSituationWorkflowSummariesByTicket(): Map<string, SituationWorkflowSummary> {
  const byTicket = new Map<string, SituationWorkflowSummary>();
  try {
    const content = readFileSync(EXECUTIONS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    const executions = Array.isArray(parsed) ? parsed : [];

    for (const entry of executions) {
      const ticketId = String(entry?.ticketId || '').trim();
      if (!ticketId) continue;
      const tasks = Array.isArray(entry?.tasks) ? entry.tasks : [];
      const startedAt = String(entry?.startedAt || '').trim() || null;
      const completedAt = String(entry?.completedAt || '').trim() || null;
      const candidate: SituationWorkflowSummary = {
        id: String(entry?.id || '').trim(),
        ticketId,
        templateId: String(entry?.templateId || '').trim(),
        title: String(entry?.title || '').trim(),
        status: String(entry?.status || '').trim(),
        executionMode: String(entry?.executionMode || '').trim(),
        blockedReason: String(entry?.blockedReason || '').trim(),
        startedAt,
        completedAt,
        durationHours: computeDurationHours(startedAt, completedAt),
        totalTasks: tasks.length,
        completedTasks: tasks.filter((task: any) => String(task?.status || '').toUpperCase() === 'COMPLETED').length,
        failedTasks: tasks.filter((task: any) => String(task?.status || '').toUpperCase() === 'FAILED').length,
        runningTasks: tasks.filter((task: any) => String(task?.status || '').toUpperCase() === 'RUNNING').length,
        pendingTasks: tasks.filter((task: any) => String(task?.status || '').toUpperCase() === 'PENDING').length,
      };
      const existing = byTicket.get(ticketId);
      const candidateTime = parseIsoMs(candidate.startedAt || candidate.completedAt || '');
      const existingTime = existing ? parseIsoMs(existing.startedAt || existing.completedAt || '') : 0;
      if (!existing || candidateTime >= existingTime) {
        byTicket.set(ticketId, candidate);
      }
    }
  } catch {
    // ignore malformed/missing workflow file for report context
  }
  return byTicket;
}

async function storeSituationReportRun(input: {
  createdByAdminId?: string | null;
  reportType: SituationReportType;
  scopeKey: string;
  days: number;
  maxTickets: number;
  includeClosed: boolean;
  pseudonymizeNames: boolean;
  pseudonymizeEmails: boolean;
  result: Record<string, any>;
  rawData: Record<string, any>;
}): Promise<string> {
  const reportId = `sr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const db = getDatabase();
  await db.run(
    `INSERT INTO ai_situation_reports (
      id, created_by_admin_id, report_type, scope_key, days, max_tickets, include_closed, pseudonymize_names,
      pseudonymize_emails, status, started_at, finished_at, result_json, raw_data_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      reportId,
      input.createdByAdminId || null,
      input.reportType,
      input.scopeKey,
      input.days,
      input.maxTickets,
      input.includeClosed ? 1 : 0,
      input.pseudonymizeNames ? 1 : 0,
      input.pseudonymizeEmails ? 1 : 0,
      JSON.stringify(input.result || {}),
      JSON.stringify(input.rawData || {}),
    ]
  );
  return reportId;
}

function pickPseudonymChunkValue(parsed: Record<string, any>, keyCandidates: string[]): unknown {
  const containers: Array<Record<string, any>> = [
    parsed,
    parsed?.chunk && typeof parsed.chunk === 'object' ? parsed.chunk : null,
    parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : null,
    parsed?.result && typeof parsed.result === 'object' ? parsed.result : null,
    parsed?.data && typeof parsed.data === 'object' ? parsed.data : null,
  ].filter((value): value is Record<string, any> => !!value);

  for (const container of containers) {
    for (const key of keyCandidates) {
      if (Object.prototype.hasOwnProperty.call(container, key)) {
        return container[key];
      }
    }
  }
  return [];
}

async function generatePseudonymFillChunkWithAi(input: {
  nameCount: number;
  emailCount: number;
  currentNames: string[];
  currentEmails: string[];
}): Promise<{ names: string[]; emails: string[] }> {
  const nameCount = Math.max(0, Math.min(300, Math.floor(input.nameCount)));
  const emailCount = Math.max(0, Math.min(300, Math.floor(input.emailCount)));
  if (nameCount === 0 && emailCount === 0) {
    return { names: [], emails: [] };
  }
  const promptBase = await getSystemPrompt('llmPseudonymPoolPrompt');
  const prompt = `${promptBase}

Erzeuge EINEN Chunk fuer die Pseudonym-Datenbank.
Antwortformat (streng JSON, keine Markdown-Umrahmung):
{
  "namePool": ["Vorname Nachname", "..."],
  "emailPool": ["name@beispielmail.de", "..."]
}

Regeln:
- Nur Strings in Arrays.
- Keine Objekte.
- Name-Eintraege ausschliesslich "Vorname Nachname".
- E-Mail-Eintraege muessen RFC-aehnlich gueltig sein.
- E-Mail-Domains muessen echte Domains mit TLD sein (z. B. .de, .com, .org, .net, .eu, .info).
- Keine lokalen/reservierten TLDs wie .local, .localhost, .invalid, .test, .example.
- Keine Duplikate.
- Keine bestehenden Werte wiederholen.

Gewuenschte Anzahl:
- namePool: ${nameCount}
- emailPool: ${emailCount}

Bereits vorhandene Namen (Ausschnitt):
${JSON.stringify(input.currentNames.slice(-120), null, 2)}

Bereits vorhandene E-Mails (Ausschnitt):
${JSON.stringify(input.currentEmails.slice(-120), null, 2)}
`.trim();

  const raw = await testAIProvider(prompt, {
    purpose: 'admin_pseudonym_fill_chunk',
    meta: {
      source: 'routes.admin.pseudonym_fill_chunk_ai',
      nameCount,
      emailCount,
    },
  });
  const parsed = extractJsonFromAiText(raw) || {};
  const names = normalizePseudonymEntriesForType(
    pickPseudonymChunkValue(parsed, ['namePool', 'names', 'name_pool', 'namePseudonyms', 'pseudonymNames']),
    'name'
  ).slice(0, nameCount);
  const emails = normalizePseudonymEntriesForType(
    pickPseudonymChunkValue(parsed, ['emailPool', 'emails', 'email_pool', 'emailPseudonyms', 'pseudonymEmails']),
    'email'
  ).slice(0, emailCount);
  return { names, emails };
}

async function runPseudonymFillChunk(source: 'timer' | 'manual' = 'timer'): Promise<{
  control: PseudonymFillControlSettings;
  progress: PseudonymFillProgress;
}> {
  if (pseudonymFillChunkRunning) {
    const control = await loadPseudonymFillControlSettings();
    const progress = await loadPseudonymFillProgress(control);
    return { control, progress };
  }
  pseudonymFillChunkRunning = true;
  try {
    const control = await loadPseudonymFillControlSettings();
    if (!control.enabled || (!control.running && source === 'timer')) {
      const progress = await loadPseudonymFillProgress(control);
      return { control, progress };
    }

    const [currentNamePool, currentEmailPool] = await Promise.all([
      loadPseudonymPool('name'),
      loadPseudonymPool('email'),
    ]);

    const namesMissing = control.fillNamesEnabled ? Math.max(0, control.targetNamePoolSize - currentNamePool.length) : 0;
    const emailsMissing = control.fillEmailsEnabled ? Math.max(0, control.targetEmailPoolSize - currentEmailPool.length) : 0;

    let generatedNames: string[] = [];
    let generatedEmails: string[] = [];
    let aiAddedNames = 0;
    let aiAddedEmails = 0;
    let fallbackUsed = false;
    const currentNameSet = new Set(currentNamePool);
    const currentEmailSet = new Set(currentEmailPool);

    const requestedNameCount = Math.min(control.chunkSizeNames, namesMissing);
    const requestedEmailCount = Math.min(control.chunkSizeEmails, emailsMissing);
    const requestedTotal = requestedNameCount + requestedEmailCount;
    const aiAttempted = control.useAiGenerator === true && requestedTotal > 0;

    if (aiAttempted) {
      try {
        const aiChunk = await generatePseudonymFillChunkWithAi({
          nameCount: requestedNameCount,
          emailCount: requestedEmailCount,
          currentNames: currentNamePool,
          currentEmails: currentEmailPool,
        });
        generatedNames = normalizePseudonymEntriesForType(aiChunk.names, 'name').filter(
          (entry) => !currentNameSet.has(entry)
        );
        generatedEmails = normalizePseudonymEntriesForType(aiChunk.emails, 'email').filter(
          (entry) => !currentEmailSet.has(entry)
        );
        aiAddedNames = generatedNames.length;
        aiAddedEmails = generatedEmails.length;
      } catch (error: any) {
        console.warn('AI pseudonym fill chunk failed; fallback to deterministic generator.', error);
      }
    }

    if (requestedNameCount > 0 && generatedNames.length < requestedNameCount) {
      const generatedNameSet = new Set(generatedNames);
      const fallbackNames = createPseudoNameChunk(
        currentNamePool.length + generatedNames.length,
        Math.max(requestedNameCount - generatedNames.length, requestedNameCount)
      );
      for (const entry of normalizePseudonymEntriesForType(fallbackNames, 'name')) {
        if (currentNameSet.has(entry) || generatedNameSet.has(entry)) continue;
        generatedNameSet.add(entry);
        generatedNames.push(entry);
        fallbackUsed = true;
        if (generatedNames.length >= requestedNameCount) break;
      }
    }

    if (requestedEmailCount > 0 && generatedEmails.length < requestedEmailCount) {
      const generatedEmailSet = new Set(generatedEmails);
      const sourceNames = generatedNames.length > 0 ? [...currentNamePool, ...generatedNames] : currentNamePool;
      const fallbackEmails = buildGeneratedEmailPool({
        names: sourceNames.length > 0 ? sourceNames : createPseudoNameChunk(0, 30),
        fallbackDomains: DEFAULT_PSEUDO_EMAIL_FALLBACK_DOMAINS,
        requestedCount: Math.max(requestedEmailCount - generatedEmails.length, requestedEmailCount),
      });
      for (const entry of normalizePseudonymEntriesForType(fallbackEmails, 'email')) {
        if (currentEmailSet.has(entry) || generatedEmailSet.has(entry)) continue;
        generatedEmailSet.add(entry);
        generatedEmails.push(entry);
        fallbackUsed = true;
        if (generatedEmails.length >= requestedEmailCount) break;
      }
    }

    let actualAddedNames = 0;
    let actualAddedEmails = 0;
    if (generatedNames.length > 0) {
      const savedPool = await savePseudonymPool({
        poolType: 'name',
        entries: generatedNames,
        mode: 'append',
      });
      actualAddedNames = Math.max(0, savedPool.entries.length - currentNamePool.length);
    }
    if (generatedEmails.length > 0) {
      const savedPool = await savePseudonymPool({
        poolType: 'email',
        entries: generatedEmails,
        mode: 'append',
      });
      actualAddedEmails = Math.max(0, savedPool.entries.length - currentEmailPool.length);
    }

    const progress = await loadPseudonymFillProgress(control);
    const done = progress.done;
    let lastRunSource: PseudonymFillControlSettings['lastRunSource'] = 'none';
    if (requestedTotal > 0) {
      if (!aiAttempted) {
        lastRunSource = 'deterministic';
      } else if (!fallbackUsed) {
        lastRunSource = 'ai';
      } else if (aiAddedNames + aiAddedEmails > 0) {
        lastRunSource = 'mixed';
      } else {
        lastRunSource = 'deterministic';
      }
    }
    const updatedControl = await savePseudonymFillControlSettings({
      lastRunAt: new Date().toISOString(),
      lastError: null,
      lastRunSource,
      lastRunRequestedNames: requestedNameCount,
      lastRunRequestedEmails: requestedEmailCount,
      lastRunAddedNames: actualAddedNames,
      lastRunAddedEmails: actualAddedEmails,
      running: done ? false : control.running,
    });

    if (done && pseudonymFillTimer) {
      clearInterval(pseudonymFillTimer);
      pseudonymFillTimer = null;
    }

    return {
      control: updatedControl,
      progress,
    };
  } catch (error: any) {
    const updatedControl = await savePseudonymFillControlSettings({
      lastRunAt: new Date().toISOString(),
      lastRunSource: 'none',
      lastRunRequestedNames: 0,
      lastRunRequestedEmails: 0,
      lastRunAddedNames: 0,
      lastRunAddedEmails: 0,
      lastError: error?.message || String(error),
    });
    const progress = await loadPseudonymFillProgress(updatedControl);
    return {
      control: updatedControl,
      progress,
    };
  } finally {
    pseudonymFillChunkRunning = false;
  }
}

async function ensurePseudonymFillLoop() {
  if (pseudonymFillLoopInitialized) return;
  pseudonymFillLoopInitialized = true;
  const control = await loadPseudonymFillControlSettings();
  if (!control.enabled || !control.running) return;
  const intervalMs = Math.max(5000, control.intervalSeconds * 1000);
  if (pseudonymFillTimer) clearInterval(pseudonymFillTimer);
  pseudonymFillTimer = setInterval(() => {
    void runPseudonymFillChunk('timer');
  }, intervalMs);
}

function updatePseudonymFillLoop(control: PseudonymFillControlSettings) {
  if (pseudonymFillTimer) {
    clearInterval(pseudonymFillTimer);
    pseudonymFillTimer = null;
  }
  if (!control.enabled || !control.running) return;
  const intervalMs = Math.max(5000, control.intervalSeconds * 1000);
  pseudonymFillTimer = setInterval(() => {
    void runPseudonymFillChunk('timer');
  }, intervalMs);
}

interface DashboardCacheEntry<T> {
  payload: T;
  expiresAt: number;
}

const DASHBOARD_STATS_CACHE_TTL_MS = 10_000;
const DASHBOARD_ANALYTICS_CACHE_TTL_MS = 15_000;
const dashboardStatsCache = new Map<string, DashboardCacheEntry<any>>();
const dashboardAnalyticsCache = new Map<string, DashboardCacheEntry<any>>();

function readDashboardCache<T>(cache: Map<string, DashboardCacheEntry<T>>, key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

function writeDashboardCache<T>(
  cache: Map<string, DashboardCacheEntry<T>>,
  key: string,
  payload: T,
  ttlMs: number
): void {
  cache.set(key, {
    payload,
    expiresAt: Date.now() + Math.max(250, ttlMs),
  });
}

const OPEN_TICKET_STATUSES = ['pending_validation', 'pending', 'open', 'assigned', 'in-progress'];
const CLOSED_TICKET_STATUSES = ['completed', 'closed'];
const OPEN_TICKET_STATUSES_SQL = OPEN_TICKET_STATUSES.map((status) => `'${status}'`).join(', ');
const CLOSED_TICKET_STATUSES_SQL = CLOSED_TICKET_STATUSES.map((status) => `'${status}'`).join(', ');

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMetric(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function calculateMedian(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function calculatePercentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - previous) / previous) * 100;
}

function buildDashboardDatabaseInfo() {
  if (config.databaseClient === 'mysql') {
    const host = String(config.mysql.host || '').trim() || 'mysql';
    const port = Number(config.mysql.port || 3306);
    const database = String(config.mysql.database || '').trim() || 'behebes_ai';
    return {
      client: 'mysql' as const,
      label: 'MySQL',
      connection: `${host}:${port}/${database}`,
    };
  }

  const sqlitePath = String(config.databasePath || '').trim() || './data/app.db';
  return {
    client: 'sqlite' as const,
    label: 'SQLite',
    connection: sqlitePath,
  };
}

function buildDateRange(days: number): string[] {
  const range: string[] = [];
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    range.push(d.toISOString().slice(0, 10));
  }
  return range;
}

async function buildSqlDump(): Promise<string> {
  const db = getDatabase();
  const quoteIdentifier = (value: string) =>
    db.dialect === 'mysql'
      ? `\`${String(value || '').replace(/`/g, '')}\``
      : `"${String(value || '').replace(/"/g, '""')}"`;
  const lines: string[] = [];
  if (db.dialect === 'mysql') {
    lines.push('SET FOREIGN_KEY_CHECKS=0;');
    lines.push('START TRANSACTION;');
  } else {
    lines.push('PRAGMA foreign_keys=OFF;');
    lines.push('BEGIN TRANSACTION;');
  }

  const schemaRows = await db.all(
    `SELECT type, name, tbl_name, sql
     FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
     ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 WHEN 'view' THEN 3 ELSE 4 END, name`
  );

  for (const row of schemaRows) {
    if (row?.sql) {
      lines.push(`${row.sql};`);
    }
  }

  const tables = schemaRows.filter((row: any) => row.type === 'table');
  for (const table of tables) {
    const tableName = table.name;
    const columnsInfo = await db.all(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
    const columnNames = columnsInfo.map((col: any) => col.name);
    if (columnNames.length === 0) continue;

    const rows = await db.all(`SELECT * FROM ${quoteIdentifier(tableName)}`);
    if (!rows || rows.length === 0) continue;

    const columnList = columnNames.map((col) => quoteIdentifier(col)).join(', ');
    for (const row of rows) {
      const values = columnNames.map((col) => serializeSqlValue(row[col]));
      lines.push(`INSERT INTO ${quoteIdentifier(tableName)} (${columnList}) VALUES (${values.join(', ')});`);
    }
  }

  lines.push('COMMIT;');
  if (db.dialect === 'mysql') {
    lines.push('SET FOREIGN_KEY_CHECKS=1;');
  } else {
    lines.push('PRAGMA foreign_keys=ON;');
  }
  return lines.join('\n');
}

function persistSqlBackupArtifact(sql: string, stamp: string): { absolutePath: string; relativePath: string } {
  const backupRoot = path.resolve(WORKSPACE_ROOT, 'backups');
  mkdirSync(backupRoot, { recursive: true });
  const fileName = `behebes-ai-backup-${stamp}.sql`;
  const absolutePath = path.resolve(backupRoot, fileName);
  writeFileSync(absolutePath, sql, 'utf-8');
  const relativePath = path.relative(WORKSPACE_ROOT, absolutePath) || fileName;
  return { absolutePath, relativePath };
}

function serializeSqlValue(value: any): string {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) {
    return `X'${value.toString('hex')}'`;
  }
  if (value instanceof Uint8Array) {
    return `X'${Buffer.from(value).toString('hex')}'`;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  const text = String(value).replace(/'/g, "''");
  return `'${text}'`;
}

/**
 * GET /api/admin/dashboard/stats
 * Dashboard-Statistiken mit genauen Metriken
 */
router.get('/dashboard/stats', async (req: Request, res: Response) => {
  try {
    const cacheKey = 'dashboard_stats_v1';
    const cached = readDashboardCache(dashboardStatsCache, cacheKey);
    if (cached) {
      res.setHeader('X-Dashboard-Cache', 'HIT');
      return res.json(cached);
    }

    const db = getDatabase();
    
    const totalSubmissions = await db.get(`SELECT COUNT(*) as count FROM submissions`);
    const openTickets = await db.get(`SELECT COUNT(*) as count FROM tickets WHERE status IN ('open', 'assigned', 'in-progress')`);
    const closedTickets = await db.get(`SELECT COUNT(*) as count FROM tickets WHERE status IN ('completed', 'closed')`);
    const avgResolution = await db.get(`
      SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24) as avg_hours
      FROM tickets
      WHERE status IN ('completed', 'closed')
    `);
    
    const payload = {
      totalSubmissions: totalSubmissions?.count || 0,
      openTickets: openTickets?.count || 0,
      closedTickets: closedTickets?.count || 0,
      averageResolutionTime: Math.round(avgResolution?.avg_hours || 0),
      database: buildDashboardDatabaseInfo(),
    };
    writeDashboardCache(dashboardStatsCache, cacheKey, payload, DASHBOARD_STATS_CACHE_TTL_MS);
    res.setHeader('X-Dashboard-Cache', 'MISS');
    return res.json(payload);
  } catch (error) {
    console.error('[admin/dashboard/stats] Failed to load dashboard stats', error);
    return res.status(500).json({ message: 'Fehler beim Abrufen der Statistiken' });
  }
});

/**
 * GET /api/admin/dashboard/analytics
 * Umfassende Ticket-Analysen nach Ort, Zeit und Kategorie
 */
router.get('/dashboard/analytics', async (req: Request, res: Response) => {
  try {
    const requestedDays = Number.parseInt(String(req.query.days || '90'), 10);
    const periodDays = Number.isFinite(requestedDays) ? Math.min(365, Math.max(7, requestedDays)) : 90;
    const cacheKey = `dashboard_analytics_v1:${periodDays}`;
    const cached = readDashboardCache(dashboardAnalyticsCache, cacheKey);
    if (cached) {
      res.setHeader('X-Dashboard-Cache', 'HIT');
      return res.json(cached);
    }

    const db = getDatabase();
    const sinceModifier = `-${periodDays} days`;
    const doubleSinceModifier = `-${periodDays * 2} days`;
    const dailyStartModifier = `-${Math.max(0, periodDays - 1)} days`;

    const totalsRow = await db.get(
      `
        SELECT
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN status IN (${OPEN_TICKET_STATUSES_SQL}) THEN 1 ELSE 0 END) AS open_tickets,
          SUM(CASE WHEN status IN (${CLOSED_TICKET_STATUSES_SQL}) THEN 1 ELSE 0 END) AS closed_tickets,
          SUM(CASE WHEN created_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS created_in_period,
          SUM(CASE WHEN status IN (${CLOSED_TICKET_STATUSES_SQL}) AND updated_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS closed_in_period,
          SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS with_coordinates,
          SUM(CASE WHEN TRIM(COALESCE(city, '')) <> '' THEN 1 ELSE 0 END) AS with_known_city
        FROM tickets
      `,
      [sinceModifier, sinceModifier]
    );

    const resolutionRows = await db.all(
      `
        SELECT (julianday(updated_at) - julianday(created_at)) * 24 AS hours
        FROM tickets
        WHERE status IN (${CLOSED_TICKET_STATUSES_SQL})
          AND created_at IS NOT NULL
          AND updated_at IS NOT NULL
          AND updated_at >= datetime('now', ?)
      `,
      [sinceModifier]
    );
    const resolutionHours = resolutionRows
      .map((row: any) => toFiniteNumber(row?.hours))
      .filter((value: number) => value >= 0);
    const averageResolutionHoursRaw = resolutionHours.length
      ? resolutionHours.reduce((sum, value) => sum + value, 0) / resolutionHours.length
      : 0;
    const medianResolutionHoursRaw = calculateMedian(resolutionHours);

    const categoryRows = await db.all(
      `
        SELECT
          COALESCE(NULLIF(TRIM(category), ''), 'Unbekannt') AS category,
          COUNT(*) AS total_count,
          SUM(CASE WHEN status IN (${OPEN_TICKET_STATUSES_SQL}) THEN 1 ELSE 0 END) AS open_count,
          SUM(CASE WHEN status IN (${CLOSED_TICKET_STATUSES_SQL}) THEN 1 ELSE 0 END) AS closed_count,
          AVG(
            CASE
              WHEN status IN (${CLOSED_TICKET_STATUSES_SQL}) AND updated_at IS NOT NULL
              THEN (julianday(updated_at) - julianday(created_at)) * 24
            END
          ) AS avg_resolution_hours
        FROM tickets
        WHERE created_at >= datetime('now', ?)
        GROUP BY category
        ORDER BY total_count DESC, category ASC
        LIMIT 30
      `,
      [sinceModifier]
    );

    const cityRows = await db.all(
      `
        SELECT
          CASE
            WHEN TRIM(COALESCE(city, '')) <> '' THEN TRIM(city)
            WHEN TRIM(COALESCE(postal_code, '')) <> '' THEN 'PLZ ' || TRIM(postal_code)
            ELSE 'Unbekannt'
          END AS city_label,
          COUNT(*) AS total_count,
          SUM(CASE WHEN status IN (${OPEN_TICKET_STATUSES_SQL}) THEN 1 ELSE 0 END) AS open_count,
          SUM(CASE WHEN status IN (${CLOSED_TICKET_STATUSES_SQL}) THEN 1 ELSE 0 END) AS closed_count,
          SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS with_coordinates
        FROM tickets
        WHERE created_at >= datetime('now', ?)
        GROUP BY city_label
        ORDER BY total_count DESC, city_label ASC
        LIMIT 25
      `,
      [sinceModifier]
    );

    const statusRows = await db.all(
      `
        SELECT status, COUNT(*) AS count
        FROM tickets
        WHERE created_at >= datetime('now', ?)
        GROUP BY status
        ORDER BY count DESC, status ASC
      `,
      [sinceModifier]
    );

    const createdRows = await db.all(
      `
        SELECT date(created_at) AS day, COUNT(*) AS count
        FROM tickets
        WHERE created_at >= date('now', ?)
        GROUP BY date(created_at)
        ORDER BY day ASC
      `,
      [dailyStartModifier]
    );
    const closedRows = await db.all(
      `
        SELECT date(updated_at) AS day, COUNT(*) AS count
        FROM tickets
        WHERE status IN (${CLOSED_TICKET_STATUSES_SQL})
          AND updated_at >= date('now', ?)
        GROUP BY date(updated_at)
        ORDER BY day ASC
      `,
      [dailyStartModifier]
    );
    const openBaselineRow = await db.get(
      `
        SELECT COUNT(*) AS count
        FROM tickets
        WHERE created_at < date('now', ?)
          AND (
            status IN (${OPEN_TICKET_STATUSES_SQL})
            OR (status IN (${CLOSED_TICKET_STATUSES_SQL}) AND updated_at >= date('now', ?))
          )
      `,
      [dailyStartModifier, dailyStartModifier]
    );

    const createdMap = new Map<string, number>();
    const closedMap = new Map<string, number>();
    createdRows.forEach((row: any) => {
      if (!row?.day) return;
      createdMap.set(String(row.day), toFiniteNumber(row.count));
    });
    closedRows.forEach((row: any) => {
      if (!row?.day) return;
      closedMap.set(String(row.day), toFiniteNumber(row.count));
    });

    const dateRange = buildDateRange(periodDays);
    let rollingOpen = Math.max(0, toFiniteNumber(openBaselineRow?.count));
    const timeSeries = dateRange.map((day) => {
      const createdCount = createdMap.get(day) || 0;
      const closedCount = closedMap.get(day) || 0;
      rollingOpen = Math.max(0, rollingOpen + createdCount - closedCount);
      return {
        day,
        createdCount,
        closedCount,
        openBalance: rollingOpen,
      };
    });

    const weekdayRows = await db.all(
      `
        SELECT CAST(strftime('%w', created_at) AS INTEGER) AS weekday, COUNT(*) AS count
        FROM tickets
        WHERE created_at >= datetime('now', ?)
        GROUP BY weekday
      `,
      [sinceModifier]
    );
    const weekdayMap = new Map<number, number>();
    weekdayRows.forEach((row: any) => {
      const weekday = Number.parseInt(String(row?.weekday ?? ''), 10);
      if (Number.isNaN(weekday)) return;
      weekdayMap.set(weekday, toFiniteNumber(row?.count));
    });
    const weekdayLabels = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const byWeekday = weekdayLabels.map((label, index) => ({
      weekday: index,
      label,
      count: weekdayMap.get(index) || 0,
    }));

    const hourRows = await db.all(
      `
        SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS count
        FROM tickets
        WHERE created_at >= datetime('now', ?)
        GROUP BY hour
      `,
      [sinceModifier]
    );
    const hourMap = new Map<number, number>();
    hourRows.forEach((row: any) => {
      const hour = Number.parseInt(String(row?.hour ?? ''), 10);
      if (Number.isNaN(hour)) return;
      hourMap.set(hour, toFiniteNumber(row?.count));
    });
    const byHour = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hourMap.get(hour) || 0,
    }));

    const backlogRow = await db.get(`
      SELECT
        SUM(CASE WHEN (julianday('now') - julianday(created_at)) < 1 THEN 1 ELSE 0 END) AS lt1d,
        SUM(CASE WHEN (julianday('now') - julianday(created_at)) >= 1 AND (julianday('now') - julianday(created_at)) < 3 THEN 1 ELSE 0 END) AS d1to3,
        SUM(CASE WHEN (julianday('now') - julianday(created_at)) >= 3 AND (julianday('now') - julianday(created_at)) < 7 THEN 1 ELSE 0 END) AS d3to7,
        SUM(CASE WHEN (julianday('now') - julianday(created_at)) >= 7 AND (julianday('now') - julianday(created_at)) < 14 THEN 1 ELSE 0 END) AS d7to14,
        SUM(CASE WHEN (julianday('now') - julianday(created_at)) >= 14 THEN 1 ELSE 0 END) AS gte14d
      FROM tickets
      WHERE status IN (${OPEN_TICKET_STATUSES_SQL})
    `);

    const hotspotRows = await db.all(
      `
        SELECT
          ROUND(latitude, 2) AS lat_bucket,
          ROUND(longitude, 2) AS lon_bucket,
          COUNT(*) AS count
        FROM tickets
        WHERE created_at >= datetime('now', ?)
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
        GROUP BY lat_bucket, lon_bucket
        ORDER BY count DESC
        LIMIT 80
      `,
      [sinceModifier]
    );

    const trendCountRow = await db.get(
      `
        SELECT
          SUM(CASE WHEN created_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS current_created,
          SUM(CASE WHEN created_at < datetime('now', ?) AND created_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS previous_created,
          SUM(CASE WHEN status IN (${CLOSED_TICKET_STATUSES_SQL}) AND updated_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS current_closed,
          SUM(CASE WHEN status IN (${CLOSED_TICKET_STATUSES_SQL}) AND updated_at < datetime('now', ?) AND updated_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS previous_closed
        FROM tickets
      `,
      [sinceModifier, sinceModifier, doubleSinceModifier, sinceModifier, sinceModifier, doubleSinceModifier]
    );
    const trendResolutionRow = await db.get(
      `
        SELECT
          AVG(
            CASE
              WHEN status IN (${CLOSED_TICKET_STATUSES_SQL}) AND updated_at >= datetime('now', ?)
              THEN (julianday(updated_at) - julianday(created_at)) * 24
            END
          ) AS current_avg_resolution,
          AVG(
            CASE
              WHEN status IN (${CLOSED_TICKET_STATUSES_SQL}) AND updated_at < datetime('now', ?) AND updated_at >= datetime('now', ?)
              THEN (julianday(updated_at) - julianday(created_at)) * 24
            END
          ) AS previous_avg_resolution
        FROM tickets
        WHERE created_at IS NOT NULL
          AND updated_at IS NOT NULL
      `,
      [sinceModifier, sinceModifier, doubleSinceModifier]
    );

    const createdInPeriod = toFiniteNumber(totalsRow?.created_in_period);
    const categoryBase = createdInPeriod || categoryRows.reduce((sum: number, row: any) => sum + toFiniteNumber(row?.total_count), 0) || 1;
    const cityBase = createdInPeriod || cityRows.reduce((sum: number, row: any) => sum + toFiniteNumber(row?.total_count), 0) || 1;

    const byCategory = categoryRows.map((row: any) => {
      const totalCount = toFiniteNumber(row?.total_count);
      return {
        category: String(row?.category || 'Unbekannt'),
        totalCount,
        openCount: toFiniteNumber(row?.open_count),
        closedCount: toFiniteNumber(row?.closed_count),
        avgResolutionHours: roundMetric(toFiniteNumber(row?.avg_resolution_hours), 2),
        share: roundMetric((totalCount / categoryBase) * 100, 1),
      };
    });

    const byCity = cityRows.map((row: any) => {
      const totalCount = toFiniteNumber(row?.total_count);
      return {
        city: String(row?.city_label || 'Unbekannt'),
        totalCount,
        openCount: toFiniteNumber(row?.open_count),
        closedCount: toFiniteNumber(row?.closed_count),
        withCoordinates: toFiniteNumber(row?.with_coordinates),
        share: roundMetric((totalCount / cityBase) * 100, 1),
      };
    });

    const mapHotspots = hotspotRows
      .map((row: any) => {
        const latitude = Number(row?.lat_bucket);
        const longitude = Number(row?.lon_bucket);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }
        return {
          latitude,
          longitude,
          count: toFiniteNumber(row?.count),
        };
      })
      .filter((entry: any) => entry !== null);

    const currentCreated = toFiniteNumber(trendCountRow?.current_created);
    const previousCreated = toFiniteNumber(trendCountRow?.previous_created);
    const currentClosed = toFiniteNumber(trendCountRow?.current_closed);
    const previousClosed = toFiniteNumber(trendCountRow?.previous_closed);
    const currentAvgResolution = toFiniteNumber(trendResolutionRow?.current_avg_resolution);
    const previousAvgResolution = toFiniteNumber(trendResolutionRow?.previous_avg_resolution);
    const createdPercentChange = calculatePercentChange(currentCreated, previousCreated);
    const closedPercentChange = calculatePercentChange(currentClosed, previousClosed);
    const resolutionPercentChange = calculatePercentChange(currentAvgResolution, previousAvgResolution);

    const payload = {
      generatedAt: new Date().toISOString(),
      periodDays,
      totals: {
        totalTickets: toFiniteNumber(totalsRow?.total_tickets),
        openTickets: toFiniteNumber(totalsRow?.open_tickets),
        closedTickets: toFiniteNumber(totalsRow?.closed_tickets),
        createdInPeriod,
        closedInPeriod: toFiniteNumber(totalsRow?.closed_in_period),
        averageResolutionHours: roundMetric(averageResolutionHoursRaw, 2),
        medianResolutionHours: roundMetric(medianResolutionHoursRaw, 2),
        withCoordinates: toFiniteNumber(totalsRow?.with_coordinates),
        withKnownCity: toFiniteNumber(totalsRow?.with_known_city),
        uniqueCategories: byCategory.length,
        uniqueCities: byCity.length,
        openBacklog: toFiniteNumber(totalsRow?.open_tickets),
      },
      trend: {
        created: {
          current: currentCreated,
          previous: previousCreated,
          percentChange: createdPercentChange === null ? null : roundMetric(createdPercentChange, 1),
        },
        closed: {
          current: currentClosed,
          previous: previousClosed,
          percentChange: closedPercentChange === null ? null : roundMetric(closedPercentChange, 1),
        },
        resolutionHours: {
          current: roundMetric(currentAvgResolution, 2),
          previous: roundMetric(previousAvgResolution, 2),
          percentChange: resolutionPercentChange === null ? null : roundMetric(resolutionPercentChange, 1),
        },
      },
      byCategory,
      byCity,
      byStatus: statusRows.map((row: any) => ({
        status: String(row?.status || 'unknown'),
        count: toFiniteNumber(row?.count),
      })),
      timeSeries,
      byWeekday,
      byHour,
      backlogAge: [
        { bucket: '< 24h', count: toFiniteNumber(backlogRow?.lt1d) },
        { bucket: '1-3 Tage', count: toFiniteNumber(backlogRow?.d1to3) },
        { bucket: '3-7 Tage', count: toFiniteNumber(backlogRow?.d3to7) },
        { bucket: '7-14 Tage', count: toFiniteNumber(backlogRow?.d7to14) },
        { bucket: '>= 14 Tage', count: toFiniteNumber(backlogRow?.gte14d) },
      ],
      mapHotspots,
    };
    writeDashboardCache(dashboardAnalyticsCache, cacheKey, payload, DASHBOARD_ANALYTICS_CACHE_TTL_MS);
    res.setHeader('X-Dashboard-Cache', 'MISS');
    return res.json(payload);
  } catch (error) {
    console.error('[admin/dashboard/analytics] Failed to load dashboard analytics', error);
    return res.status(500).json({ message: 'Fehler beim Abrufen der Statistikdaten' });
  }
});

/**
 * GET /api/admin/dashboard
 * Dashboard-Statistiken (deprecated, use /dashboard/stats)
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    
    const stats = {
      totalTickets: await db.get(`SELECT COUNT(*) as count FROM tickets`),
      openTickets: await db.get(`SELECT COUNT(*) as count FROM tickets WHERE status = 'open'`),
      inProgress: await db.get(`SELECT COUNT(*) as count FROM tickets WHERE status = 'in-progress'`),
      completed: await db.get(`SELECT COUNT(*) as count FROM tickets WHERE status = 'completed'`),
      criticalPriority: await db.get(`SELECT COUNT(*) as count FROM tickets WHERE priority = 'critical'`),
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Abrufen der Dashboard-Daten' });
  }
});

/**
 * POST /api/admin/users
 * Neuen Admin-Benutzer erstellen (nur ADMIN)
 */
router.post('/users', adminOnly, async (req: Request, res: Response) => {
  try {
    const { username, password, role } = req.body;
    const db = getDatabase();
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username und Passwort erforderlich' });
    }
    
    const admin = await createAdminUser(db, { username, password, role: role || 'SACHBEARBEITER' });
    res.json({ admin: { id: admin.id, username: admin.username, role: admin.role } });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Erstellen des Benutzers' });
  }
});

/**
 * GET /api/admin/users
 * Liste aller Admin-Benutzer
 */
router.get('/users', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const users = await db.all(
      `SELECT id, username, role, active, created_at FROM admin_users ORDER BY created_at DESC`
    );
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen der Benutzer' });
  }
});

/**
 * GET /api/admin/sessions
 * Übersicht über aktive (oder alle) Admin-Sessions inkl. Session-Cookie-Wert
 */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'active';
    if (!['active', 'all', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Ungültiger Statusfilter' });
    }
    const limit = Math.min(300, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);

    let whereClause = '';
    if (status === 'active') whereClause = 'WHERE s.is_active = 1';
    if (status === 'inactive') whereClause = 'WHERE s.is_active = 0';

    const db = getDatabase();
    const rows = await db.all(
      `SELECT
         s.id,
         s.admin_user_id,
         s.username,
         s.role,
         s.ip_address,
         s.user_agent,
         s.remember_me,
         s.issued_at,
         s.last_seen_at,
         s.expires_at,
         s.logged_out_at,
         s.is_active,
         s.logout_reason
       FROM admin_sessions s
       ${whereClause}
       ORDER BY s.issued_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const totalRow = await db.get(
      `SELECT COUNT(*) as count FROM admin_sessions s ${whereClause}`
    );
    const activeRow = await db.get(`SELECT COUNT(*) as count FROM admin_sessions WHERE is_active = 1`);
    const inactiveRow = await db.get(`SELECT COUNT(*) as count FROM admin_sessions WHERE is_active = 0`);

    const items = rows.map((row: any) => {
      const item = convertToCamelCase(row);
      return {
        ...item,
        sessionCookie: `admin_session=${row.id}`,
        isExpired:
          !!row.expires_at &&
          !Number.isNaN(Date.parse(String(row.expires_at))) &&
          Date.parse(String(row.expires_at)) < Date.now(),
      };
    });

    return res.json({
      items,
      total: totalRow?.count || 0,
      counts: {
        active: activeRow?.count || 0,
        inactive: inactiveRow?.count || 0,
      },
      status,
      limit,
      offset,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Abrufen der Sessions' });
  }
});

/**
 * POST /api/admin/sessions/revoke-bulk
 * Mehrere Sessions beenden
 */
router.post('/sessions/revoke-bulk', async (req: Request, res: Response) => {
  try {
    const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reason = reasonRaw ? reasonRaw.slice(0, 120) : 'revoked_by_admin';

    const incoming = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
    const sessionIds: string[] = Array.from(
      new Set(
        incoming
          .filter((value: unknown): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );

    if (sessionIds.length === 0) {
      return res.status(400).json({ message: 'sessionIds ist erforderlich' });
    }
    if (sessionIds.length > 500) {
      return res.status(400).json({ message: 'Maximal 500 Sessions pro Anfrage erlaubt' });
    }

    const db = getDatabase();
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = await db.all(
      `SELECT id, username, is_active FROM admin_sessions WHERE id IN (${placeholders})`,
      sessionIds
    );
    const existingIds = new Set(rows.map((row: any) => String(row.id)));
    const missing = sessionIds.filter((id) => !existingIds.has(id));
    const activeIds = rows
      .filter((row: any) => row.is_active === 1 || row.is_active === true)
      .map((row: any) => String(row.id));

    if (activeIds.length > 0) {
      const activePlaceholders = activeIds.map(() => '?').join(', ');
      await db.run(
        `UPDATE admin_sessions
         SET is_active = 0,
             logged_out_at = COALESCE(logged_out_at, CURRENT_TIMESTAMP),
             logout_reason = COALESCE(logout_reason, ?)
         WHERE id IN (${activePlaceholders})`,
        [reason, ...activeIds]
      );
    }

    await writeJournalEntry({
      eventType: 'SESSION_REVOKE_BULK',
      severity: 'warning',
      adminUserId: req.userId || null,
      username: req.username || null,
      role: req.role || null,
      sessionId: req.sessionId || null,
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      details: {
        requested: sessionIds.length,
        revoked: activeIds.length,
        missing: missing.length,
        reason,
      },
    });

    return res.json({
      message: `${activeIds.length} Session(s) beendet`,
      requested: sessionIds.length,
      revoked: activeIds.length,
      alreadyInactive: rows.length - activeIds.length,
      missing,
      selfRevoked: !!req.sessionId && activeIds.includes(req.sessionId),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Beenden der Sessions' });
  }
});

/**
 * POST /api/admin/sessions/:id/revoke
 * Einzelne Session beenden
 */
router.post('/sessions/:id/revoke', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Session-ID erforderlich' });
    }

    const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reason = reasonRaw ? reasonRaw.slice(0, 120) : 'revoked_by_admin';

    const db = getDatabase();
    const session = await db.get(
      `SELECT id, username, is_active
       FROM admin_sessions
       WHERE id = ?`,
      [id]
    );

    if (!session) {
      return res.status(404).json({ message: 'Session nicht gefunden' });
    }

    if (session.is_active === 1 || session.is_active === true) {
      await endAdminSession(id, reason);
    }

    await writeJournalEntry({
      eventType: 'SESSION_REVOKED',
      severity: 'warning',
      adminUserId: req.userId || null,
      username: req.username || null,
      role: req.role || null,
      sessionId: req.sessionId || null,
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      details: {
        targetSessionId: id,
        targetUsername: session.username || null,
        reason,
        wasActive: session.is_active === 1 || session.is_active === true,
      },
    });

    return res.json({
      message: 'Session beendet',
      id,
      selfRevoked: req.sessionId === id,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Beenden der Session' });
  }
});

/**
 * DELETE /api/admin/sessions
 * Mehrere Session-Einträge löschen
 */
router.delete('/sessions', async (req: Request, res: Response) => {
  try {
    const incoming = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
    const sessionIds: string[] = Array.from(
      new Set(
        incoming
          .filter((value: unknown): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );
    if (sessionIds.length === 0) {
      return res.status(400).json({ message: 'sessionIds ist erforderlich' });
    }
    if (sessionIds.length > 500) {
      return res.status(400).json({ message: 'Maximal 500 Sessions pro Anfrage erlaubt' });
    }

    const db = getDatabase();
    const placeholders = sessionIds.map(() => '?').join(', ');
    const result: any = await db.run(
      `DELETE FROM admin_sessions WHERE id IN (${placeholders})`,
      sessionIds
    );

    return res.json({
      message: `${result?.changes || 0} Session-Eintrag/Einträge gelöscht`,
      deleted: result?.changes || 0,
      selfDeleted: !!req.sessionId && sessionIds.includes(req.sessionId),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Löschen der Sessions' });
  }
});

/**
 * DELETE /api/admin/sessions/:id
 * Einzelnen Session-Eintrag löschen
 */
router.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Session-ID erforderlich' });
    }
    const db = getDatabase();
    const result: any = await db.run(`DELETE FROM admin_sessions WHERE id = ?`, [id]);
    if (!result?.changes) {
      return res.status(404).json({ message: 'Session nicht gefunden' });
    }
    return res.json({
      message: 'Session-Eintrag gelöscht',
      selfDeleted: req.sessionId === id,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Löschen der Session' });
  }
});

/**
 * GET /api/admin/citizen-accounts
 * Übersicht über Bürgerkonten inkl. Session-Metriken
 */
router.get('/citizen-accounts', async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'active';
    if (!['active', 'all', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Ungültiger Statusfilter' });
    }
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '150'), 10) || 150));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);

    const statusWhere =
      status === 'active'
        ? 'WHERE x.active_session_count > 0'
        : status === 'inactive'
        ? 'WHERE x.active_session_count = 0'
        : '';

    const db = getDatabase();
    const baseSql = `
      SELECT
        a.id,
        a.email_normalized,
        a.email_original,
        a.created_at,
        a.verified_at,
        a.last_login_at,
        COALESCE(metrics.total_session_count, 0) AS total_session_count,
        COALESCE(metrics.active_session_count, 0) AS active_session_count,
        COALESCE(metrics.revoked_session_count, 0) AS revoked_session_count,
        metrics.last_seen_at
      FROM citizen_accounts a
      LEFT JOIN (
        SELECT
          s.account_id,
          COUNT(*) AS total_session_count,
          SUM(
            CASE
              WHEN s.revoked_at IS NULL
                AND (s.expires_at IS NULL OR datetime(s.expires_at) >= datetime('now'))
              THEN 1 ELSE 0
            END
          ) AS active_session_count,
          SUM(
            CASE
              WHEN s.revoked_at IS NOT NULL
                OR (s.expires_at IS NOT NULL AND datetime(s.expires_at) < datetime('now'))
              THEN 1 ELSE 0
            END
          ) AS revoked_session_count,
          MAX(s.last_seen_at) AS last_seen_at
        FROM citizen_sessions s
        GROUP BY s.account_id
      ) metrics ON metrics.account_id = a.id
    `;

    const rows = await db.all(
      `
      SELECT *
      FROM (${baseSql}) x
      ${statusWhere}
      ORDER BY datetime(COALESCE(x.last_seen_at, x.last_login_at, x.created_at)) DESC, x.email_normalized ASC
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const totalRow = await db.get(
      `
      SELECT COUNT(*) AS count
      FROM (${baseSql}) x
      ${statusWhere}`
    );

    const countRows = await db.all(
      `
      SELECT state, COUNT(*) AS count
      FROM (
        SELECT
          CASE
            WHEN COALESCE(metrics.active_session_count, 0) > 0 THEN 'active'
            ELSE 'inactive'
          END AS state
        FROM citizen_accounts a
        LEFT JOIN (
          SELECT
            s.account_id,
            SUM(
              CASE
                WHEN s.revoked_at IS NULL
                  AND (s.expires_at IS NULL OR datetime(s.expires_at) >= datetime('now'))
                THEN 1 ELSE 0
              END
            ) AS active_session_count
          FROM citizen_sessions s
          GROUP BY s.account_id
        ) metrics ON metrics.account_id = a.id
      ) grouped
      GROUP BY state`
    );
    const counts = { active: 0, inactive: 0 };
    (countRows || []).forEach((row: any) => {
      const key = String(row?.state || '').trim() === 'active' ? 'active' : 'inactive';
      counts[key] = Number(row?.count || 0);
    });

    const items = (rows || []).map((row: any) => ({
      id: String(row?.id || ''),
      emailNormalized: String(row?.email_normalized || ''),
      emailOriginal: String(row?.email_original || row?.email_normalized || ''),
      createdAt: row?.created_at || null,
      verifiedAt: row?.verified_at || null,
      lastLoginAt: row?.last_login_at || null,
      lastSeenAt: row?.last_seen_at || null,
      totalSessionCount: Number(row?.total_session_count || 0),
      activeSessionCount: Number(row?.active_session_count || 0),
      revokedSessionCount: Number(row?.revoked_session_count || 0),
    }));

    return res.json({
      items,
      total: Number(totalRow?.count || 0),
      counts,
      status,
      limit,
      offset,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Abrufen der Bürgerkonten' });
  }
});

/**
 * POST /api/admin/citizen-accounts/:id/revoke
 * Alle aktiven Sessions eines Bürgerkontos beenden
 */
router.post('/citizen-accounts/:id/revoke', async (req: Request, res: Response) => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Bürgerkonto-ID erforderlich' });
    const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reason = reasonRaw ? reasonRaw.slice(0, 120) : 'revoked_by_admin';

    const db = getDatabase();
    const account = await db.get(
      `SELECT id, email_normalized
       FROM citizen_accounts
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    if (!account?.id) {
      return res.status(404).json({ message: 'Bürgerkonto nicht gefunden' });
    }

    const result: any = await db.run(
      `UPDATE citizen_sessions
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
       WHERE account_id = ?
         AND revoked_at IS NULL`,
      [id]
    );
    const revokedCount = Number(result?.changes || 0);

    await writeJournalEntry({
      eventType: 'CITIZEN_ACCOUNT_REVOKED',
      severity: 'warning',
      adminUserId: req.userId || null,
      username: req.username || null,
      role: req.role || null,
      sessionId: req.sessionId || null,
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      details: {
        citizenAccountId: id,
        citizenEmail: account.email_normalized || null,
        revokedSessions: revokedCount,
        reason,
      },
    });

    return res.json({
      message: revokedCount > 0 ? `${revokedCount} Bürger-Session(s) beendet` : 'Keine aktive Bürger-Session gefunden',
      revoked: revokedCount,
      accountId: id,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Beenden der Bürger-Sessions' });
  }
});

/**
 * DELETE /api/admin/citizen-accounts/:id
 * Bürgerkonto inkl. Sessions löschen
 */
router.delete('/citizen-accounts/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Bürgerkonto-ID erforderlich' });

    const db = getDatabase();
    const account = await db.get(
      `SELECT id, email_normalized
       FROM citizen_accounts
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    if (!account?.id) {
      return res.status(404).json({ message: 'Bürgerkonto nicht gefunden' });
    }

    const sessionCountRow = await db.get(
      `SELECT COUNT(*) AS count
       FROM citizen_sessions
       WHERE account_id = ?`,
      [id]
    );

    await db.run(`DELETE FROM citizen_magic_links WHERE account_id = ?`, [id]);
    await db.run(`DELETE FROM citizen_auth_audit WHERE citizen_account_id = ?`, [id]);
    const result: any = await db.run(`DELETE FROM citizen_accounts WHERE id = ?`, [id]);

    if (!result?.changes) {
      return res.status(404).json({ message: 'Bürgerkonto nicht gefunden' });
    }

    await writeJournalEntry({
      eventType: 'CITIZEN_ACCOUNT_DELETED',
      severity: 'warning',
      adminUserId: req.userId || null,
      username: req.username || null,
      role: req.role || null,
      sessionId: req.sessionId || null,
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      details: {
        citizenAccountId: id,
        citizenEmail: account.email_normalized || null,
        deletedSessions: Number(sessionCountRow?.count || 0),
      },
    });

    return res.json({
      message: 'Bürgerkonto gelöscht',
      id,
      deletedSessions: Number(sessionCountRow?.count || 0),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Löschen des Bürgerkontos' });
  }
});

/**
 * GET /api/admin/citizen-sessions
 * Übersicht über aktive (oder alle) Bürger-Sessions
 */
router.get('/citizen-sessions', async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'active';
    if (!['active', 'all', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Ungültiger Statusfilter' });
    }
    const limit = Math.min(600, Math.max(1, parseInt(String(req.query.limit || '250'), 10) || 250));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);

    const statusWhere =
      status === 'active'
        ? `WHERE s.revoked_at IS NULL
             AND (s.expires_at IS NULL OR datetime(s.expires_at) >= datetime('now'))`
        : status === 'inactive'
        ? `WHERE s.revoked_at IS NOT NULL
             OR (s.expires_at IS NOT NULL AND datetime(s.expires_at) < datetime('now'))`
        : '';

    const db = getDatabase();
    const rows = await db.all(
      `SELECT
         s.id,
         s.account_id,
         s.frontend_profile_token,
         s.user_agent,
         s.ip,
         s.created_at,
         s.last_seen_at,
         s.expires_at,
         s.revoked_at,
         a.email_normalized,
         a.email_original,
         a.last_login_at
       FROM citizen_sessions s
       JOIN citizen_accounts a ON a.id = s.account_id
       ${statusWhere}
       ORDER BY datetime(s.last_seen_at) DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const totalRow = await db.get(
      `SELECT COUNT(*) as count
       FROM citizen_sessions s
       ${statusWhere}`
    );
    const activeRow = await db.get(
      `SELECT COUNT(*) as count
       FROM citizen_sessions s
       WHERE s.revoked_at IS NULL
         AND (s.expires_at IS NULL OR datetime(s.expires_at) >= datetime('now'))`
    );
    const inactiveRow = await db.get(
      `SELECT COUNT(*) as count
       FROM citizen_sessions s
       WHERE s.revoked_at IS NOT NULL
          OR (s.expires_at IS NOT NULL AND datetime(s.expires_at) < datetime('now'))`
    );

    const nowMs = Date.now();
    const items = (rows || []).map((row: any) => {
      const expiresAtRaw = String(row?.expires_at || '').trim();
      const revokedAtRaw = String(row?.revoked_at || '').trim();
      const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN;
      const isExpired = Number.isFinite(expiresAtMs) ? expiresAtMs < nowMs : false;
      return {
        id: String(row?.id || ''),
        accountId: String(row?.account_id || ''),
        frontendProfileToken: String(row?.frontend_profile_token || ''),
        userAgent: String(row?.user_agent || ''),
        ipAddress: String(row?.ip || ''),
        createdAt: row?.created_at || null,
        lastSeenAt: row?.last_seen_at || null,
        expiresAt: row?.expires_at || null,
        revokedAt: row?.revoked_at || null,
        isExpired,
        isActive: !revokedAtRaw && !isExpired,
        citizenEmail: String(row?.email_original || row?.email_normalized || ''),
        citizenEmailNormalized: String(row?.email_normalized || ''),
        citizenLastLoginAt: row?.last_login_at || null,
      };
    });

    return res.json({
      items,
      total: Number(totalRow?.count || 0),
      counts: {
        active: Number(activeRow?.count || 0),
        inactive: Number(inactiveRow?.count || 0),
      },
      status,
      limit,
      offset,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Abrufen der Bürger-Sessions' });
  }
});

/**
 * POST /api/admin/citizen-sessions/:id/revoke
 * Einzelne Bürger-Session beenden
 */
router.post('/citizen-sessions/:id/revoke', async (req: Request, res: Response) => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'Session-ID erforderlich' });
    }
    const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reason = reasonRaw ? reasonRaw.slice(0, 120) : 'revoked_by_admin';

    const db = getDatabase();
    const session = await db.get(
      `SELECT s.id, s.account_id, s.revoked_at, a.email_normalized
       FROM citizen_sessions s
       LEFT JOIN citizen_accounts a ON a.id = s.account_id
       WHERE s.id = ?
       LIMIT 1`,
      [id]
    );

    if (!session?.id) {
      return res.status(404).json({ message: 'Bürger-Session nicht gefunden' });
    }

    if (!session.revoked_at) {
      await db.run(
        `UPDATE citizen_sessions
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [id]
      );
    }

    await writeJournalEntry({
      eventType: 'CITIZEN_SESSION_REVOKED',
      severity: 'warning',
      adminUserId: req.userId || null,
      username: req.username || null,
      role: req.role || null,
      sessionId: req.sessionId || null,
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      details: {
        citizenSessionId: id,
        citizenAccountId: String(session.account_id || ''),
        citizenEmail: String(session.email_normalized || ''),
        reason,
      },
    });

    return res.json({
      message: 'Bürger-Session beendet',
      id,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Beenden der Bürger-Session' });
  }
});

/**
 * DELETE /api/admin/citizen-sessions/:id
 * Einzelnen Bürger-Session-Eintrag löschen
 */
router.delete('/citizen-sessions/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'Session-ID erforderlich' });
    }
    const db = getDatabase();
    const session = await db.get(
      `SELECT s.id, s.account_id, a.email_normalized
       FROM citizen_sessions s
       LEFT JOIN citizen_accounts a ON a.id = s.account_id
       WHERE s.id = ?
       LIMIT 1`,
      [id]
    );
    if (!session?.id) {
      return res.status(404).json({ message: 'Bürger-Session nicht gefunden' });
    }
    const result: any = await db.run(`DELETE FROM citizen_sessions WHERE id = ?`, [id]);
    if (!result?.changes) {
      return res.status(404).json({ message: 'Bürger-Session nicht gefunden' });
    }

    await writeJournalEntry({
      eventType: 'CITIZEN_SESSION_DELETED',
      severity: 'warning',
      adminUserId: req.userId || null,
      username: req.username || null,
      role: req.role || null,
      sessionId: req.sessionId || null,
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      details: {
        citizenSessionId: id,
        citizenAccountId: String(session.account_id || ''),
        citizenEmail: String(session.email_normalized || ''),
      },
    });

    return res.json({ message: 'Bürger-Session gelöscht', id });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Löschen der Bürger-Session' });
  }
});

/**
 * POST /api/admin/citizen-messages/broadcast
 * Broadcast-Nachricht an aktive Bürger-PWA-Konten
 */
router.post('/citizen-messages/broadcast', adminOnly, async (req: Request, res: Response) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!title || !body) {
      return res.status(400).json({ message: 'Titel und Nachrichtentext sind erforderlich' });
    }

    const modeRaw = typeof req.body?.mode === 'string' ? req.body.mode.trim().toLowerCase() : 'all_active';
    const mode: 'all_active' | 'account_ids' = modeRaw === 'account_ids' ? 'account_ids' : 'all_active';
    const sendPush = req.body?.sendPush !== false;
    const actionUrlRaw = typeof req.body?.actionUrl === 'string' ? req.body.actionUrl.trim() : '';
    if (
      actionUrlRaw &&
      !actionUrlRaw.startsWith('/') &&
      !/^https?:\/\//i.test(actionUrlRaw)
    ) {
      return res.status(400).json({ message: 'actionUrl muss mit "/" oder "http(s)://" beginnen' });
    }

    const accountIdsRaw = Array.isArray(req.body?.accountIds) ? req.body.accountIds : [];
    const accountIds: string[] = Array.from(
      new Set(
        accountIdsRaw
          .filter((value: unknown): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );
    if (mode === 'account_ids' && accountIds.length === 0) {
      return res.status(400).json({ message: 'accountIds sind für den Modus "account_ids" erforderlich' });
    }
    if (accountIds.length > 5000) {
      return res.status(400).json({ message: 'Maximal 5000 accountIds pro Anfrage erlaubt' });
    }

    const result = await broadcastCitizenMessage({
      mode,
      accountIds,
      title,
      body,
      actionUrl: actionUrlRaw || null,
      sourceRef: req.userId ? `admin:${req.userId}` : 'admin:broadcast',
      sendPush,
      metadata: {
        initiatedByAdminId: req.userId || null,
        initiatedByUsername: req.username || null,
        mode,
      },
    });

    await writeJournalEntry({
      eventType: 'CITIZEN_MESSAGE_BROADCAST',
      severity: 'info',
      adminUserId: req.userId || null,
      username: req.username || null,
      role: req.role || null,
      sessionId: req.sessionId || null,
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      details: {
        mode,
        sendPush,
        title: title.slice(0, 120),
        targetedAccounts: result.targetedAccounts,
        createdMessages: result.createdMessages,
        pushedMessages: result.pushedMessages,
        failedPushMessages: result.failedPushMessages,
      },
    });

    return res.json({
      message: `${result.createdMessages} App-Nachricht(en) erstellt`,
      ...result,
    });
  } catch (error: any) {
    const rawMessage = String(error?.message || 'Fehler beim Versenden der Bürgernachrichten');
    if (rawMessage === 'title_and_body_required') {
      return res.status(400).json({ message: 'Titel und Nachrichtentext sind erforderlich' });
    }
    return res.status(500).json({ message: rawMessage });
  }
});

/**
 * GET /api/admin/system-info
 * Konsolidierte Systeminformationen fuer Administrations- und Betriebsdiagnose
 */
router.get('/system-info', adminOnly, async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const nowMs = Date.now();
    const runtimeStartedAt = new Date(nowMs - Math.floor(process.uptime() * 1000)).toISOString();

    const [
      aiSettings,
      aiCredentials,
      databaseStructure,
      sessionTotalRow,
      sessionActiveRow,
      sessionExpiredActiveRow,
      activeSessionRows,
      feedTokenCountRow,
      feedTokenRows,
      oauthRows,
      ticketValidationCountRow,
      ticketValidationRows,
      workflowValidationCountRow,
      workflowValidationRows,
      featureHistoryRows,
    ] = await Promise.all([
      loadAiSettings(),
      loadAiCredentials(true),
      buildDatabaseStructureSnapshot(db),
      db.get(`SELECT COUNT(*) AS count FROM admin_sessions`),
      db.get(`SELECT COUNT(*) AS count FROM admin_sessions WHERE is_active = 1`),
      db.get(
        `SELECT COUNT(*) AS count
         FROM admin_sessions
         WHERE is_active = 1
           AND expires_at IS NOT NULL
           AND datetime(expires_at) < datetime('now')`
      ),
      db.all(
        `SELECT id, admin_user_id, username, role, ip_address, user_agent, remember_me,
                issued_at, last_seen_at, expires_at
         FROM admin_sessions
         WHERE is_active = 1
         ORDER BY datetime(last_seen_at) DESC
         LIMIT 300`
      ),
      db.get(`SELECT COUNT(*) AS count FROM admin_feed_tokens WHERE revoked_at IS NULL`),
      db.all(
        `SELECT t.id, t.admin_user_id, t.scope, t.token, t.created_at, t.last_used_at,
                u.username, u.role
         FROM admin_feed_tokens t
         LEFT JOIN admin_users u ON u.id = t.admin_user_id
         WHERE t.revoked_at IS NULL
         ORDER BY datetime(t.created_at) DESC
         LIMIT 300`
      ),
      db.all(
        `SELECT id, provider, account_id, expires_at, created_at, updated_at
         FROM oauth_tokens
         ORDER BY datetime(updated_at) DESC
         LIMIT 200`
      ),
      db.get(
        `SELECT COUNT(*) AS count
         FROM ticket_validations
         WHERE validated_at IS NULL
           AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))`
      ),
      db.all(
        `SELECT id, ticket_id, submission_id, citizen_email, validation_token, created_at, expires_at
         FROM ticket_validations
         WHERE validated_at IS NULL
           AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))
         ORDER BY datetime(created_at) DESC
         LIMIT 300`
      ),
      db.get(
        `SELECT COUNT(*) AS count
         FROM workflow_validations
         WHERE validated_at IS NULL
           AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))`
      ),
      db.all(
        `SELECT id, execution_id, task_id, ticket_id, recipient_email, validation_token, created_at, expires_at
         FROM workflow_validations
         WHERE validated_at IS NULL
           AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))
         ORDER BY datetime(created_at) DESC
         LIMIT 300`
      ),
      db.all(
        `SELECT id, event_type, severity, username, method, path, created_at, details
         FROM admin_journal
         WHERE event_type = 'ADMIN_API_MUTATION'
            OR path LIKE '/api/admin/config/%'
            OR path LIKE '/api/admin/templates%'
            OR path LIKE '/api/admin/config/prompts%'
            OR path LIKE '/api/admin/knowledge%'
            OR path LIKE '/api/admin/workflows%'
            OR path LIKE '/api/admin/translation-planner%'
            OR path LIKE '/api/admin/maintenance/%'
         ORDER BY datetime(created_at) DESC
         LIMIT 160`
      ),
    ]);

    const activeSessions = (activeSessionRows || []).map((row: any) => {
      const expiresAtRaw = String(row?.expires_at || '').trim();
      const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN;
      const isExpired = Number.isFinite(expiresAtMs) ? expiresAtMs <= nowMs : false;
      return {
        id: String(row?.id || ''),
        adminUserId: String(row?.admin_user_id || ''),
        username: String(row?.username || ''),
        role: String(row?.role || ''),
        ipAddress: String(row?.ip_address || ''),
        userAgent: String(row?.user_agent || ''),
        rememberMe: isTruthyFlag(row?.remember_me),
        issuedAt: row?.issued_at || null,
        lastSeenAt: row?.last_seen_at || null,
        expiresAt: row?.expires_at || null,
        isExpired,
      };
    });

    const feedTokens = (feedTokenRows || []).map((row: any) => ({
      id: String(row?.id || ''),
      adminUserId: String(row?.admin_user_id || ''),
      username: String(row?.username || ''),
      role: String(row?.role || ''),
      scope: String(row?.scope || ''),
      tokenMasked: maskTokenValue(row?.token),
      tokenLength: String(row?.token || '').length,
      createdAt: row?.created_at || null,
      lastUsedAt: row?.last_used_at || null,
    }));

    const oauthTokens = (oauthRows || []).map((row: any) => {
      const expiresAtMs = parseEpochMs(row?.expires_at);
      return {
        id: String(row?.id || ''),
        provider: String(row?.provider || ''),
        accountId: String(row?.account_id || ''),
        expiresAtMs,
        expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
        isExpired: expiresAtMs !== null ? expiresAtMs <= nowMs : false,
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
      };
    });
    const oauthActiveCount = oauthTokens.filter((item) => !item.isExpired).length;

    const ticketValidationTokens = (ticketValidationRows || []).map((row: any) => {
      const expiresAtRaw = String(row?.expires_at || '').trim();
      const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN;
      const isExpired = Number.isFinite(expiresAtMs) ? expiresAtMs <= nowMs : false;
      return {
        id: String(row?.id || ''),
        ticketId: String(row?.ticket_id || ''),
        submissionId: String(row?.submission_id || ''),
        citizenEmail: String(row?.citizen_email || ''),
        tokenMasked: maskTokenValue(row?.validation_token),
        tokenLength: String(row?.validation_token || '').length,
        createdAt: row?.created_at || null,
        expiresAt: row?.expires_at || null,
        isExpired,
      };
    });

    const workflowValidationTokens = (workflowValidationRows || []).map((row: any) => {
      const expiresAtRaw = String(row?.expires_at || '').trim();
      const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN;
      const isExpired = Number.isFinite(expiresAtMs) ? expiresAtMs <= nowMs : false;
      return {
        id: String(row?.id || ''),
        executionId: String(row?.execution_id || ''),
        taskId: String(row?.task_id || ''),
        ticketId: String(row?.ticket_id || ''),
        recipientEmail: String(row?.recipient_email || ''),
        tokenMasked: maskTokenValue(row?.validation_token),
        tokenLength: String(row?.validation_token || '').length,
        createdAt: row?.created_at || null,
        expiresAt: row?.expires_at || null,
        isExpired,
      };
    });

    const gitMetadata = loadGitMetadata(40);
    const buildMetadata = loadBuildMetadata();
    const featureHistory = (featureHistoryRows || []).map((row: any) => ({
      id: String(row?.id || ''),
      createdAt: row?.created_at || null,
      eventType: String(row?.event_type || ''),
      severity: String(row?.severity || 'info'),
      username: String(row?.username || ''),
      method: String(row?.method || ''),
      path: String(row?.path || ''),
      details: parseJsonIfPossible(row?.details),
    }));

    const memoryUsage = process.memoryUsage();
    const warnings: string[] = [];
    if (!gitMetadata.available) warnings.push('Git-Historie ist nicht verfügbar.');
    if (!PACKAGE_METADATA.admin.available) warnings.push('admin/package.json konnte nicht gelesen werden.');
    if (!PACKAGE_METADATA.frontend.available) warnings.push('frontend/package.json konnte nicht gelesen werden.');
    if (!PACKAGE_METADATA.ops.available) warnings.push('ops/package.json konnte nicht gelesen werden.');

    return res.json({
      generatedAt: new Date().toISOString(),
      warnings,
      backend: {
        framework: 'node-express',
        runtime: {
          nodeVersion: process.version,
          pid: process.pid,
          uptimeSeconds: Math.floor(process.uptime()),
          startedAt: runtimeStartedAt,
          platform: process.platform,
          arch: process.arch,
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            process.env.TZ ||
            'UTC',
          memory: {
            rssBytes: memoryUsage.rss,
            heapTotalBytes: memoryUsage.heapTotal,
            heapUsedBytes: memoryUsage.heapUsed,
            externalBytes: memoryUsage.external,
          },
        },
        environment: {
          nodeEnv: config.nodeEnv,
          port: config.port,
          trustProxy: config.trustProxy,
          frontendUrl: config.frontendUrl,
          adminUrl: config.adminUrl,
        },
        database: {
          client: config.databaseClient,
          sqlitePath: config.databaseClient === 'sqlite' ? config.databasePath : null,
          mysql:
            config.databaseClient === 'mysql'
              ? {
                  host: config.mysql.host,
                  port: config.mysql.port,
                  database: config.mysql.database,
                  migrationSourcePath: config.mysql.migrationSourcePath,
                }
              : null,
        },
        ai: {
          provider: aiSettings.values.provider,
          model: aiSettings.values.model,
          providerSource: aiSettings.sources.provider,
          modelSource: aiSettings.sources.model,
          credentials: {
            askcodiBaseUrl: aiCredentials.values.askcodiBaseUrl,
            hasOpenaiClientId: !!String(aiCredentials.values.openaiClientId || '').trim(),
            hasOpenaiClientSecret: !!String(aiCredentials.values.openaiClientSecret || '').trim(),
            hasAskcodiApiKey: !!String(aiCredentials.values.askcodiApiKey || '').trim(),
            openaiClientIdSource: aiCredentials.sources.openaiClientId,
            openaiClientSecretSource: aiCredentials.sources.openaiClientSecret,
            askcodiApiKeySource: aiCredentials.sources.askcodiApiKey,
            askcodiBaseUrlSource: aiCredentials.sources.askcodiBaseUrl,
          },
        },
      },
      versions: {
        workspace: PACKAGE_METADATA.workspace,
        backend: PACKAGE_METADATA.backend,
        admin: PACKAGE_METADATA.admin,
        frontend: PACKAGE_METADATA.frontend,
        ops: PACKAGE_METADATA.ops,
      },
      build: {
        appVersion: buildMetadata.appVersion,
        envBuildId: buildMetadata.envBuildId,
        envBuildTime: buildMetadata.envBuildTime,
        envCommitRef: buildMetadata.envCommitRef,
        git: {
          available: gitMetadata.available,
          branch: gitMetadata.branch,
          headCommit: gitMetadata.headCommit,
          describe: gitMetadata.describe,
          fetchedAt: gitMetadata.fetchedAt,
          error: gitMetadata.error || null,
        },
      },
      sessions: {
        totalCount: Number(sessionTotalRow?.count || 0),
        activeCount: Number(sessionActiveRow?.count || 0),
        activeButExpiredCount: Number(sessionExpiredActiveRow?.count || 0),
        active: activeSessions,
      },
      tokens: {
        summary: {
          openFeedTokens: Number(feedTokenCountRow?.count || 0),
          openOauthTokens: oauthActiveCount,
          storedOauthTokens: oauthTokens.length,
          openTicketValidationTokens: Number(ticketValidationCountRow?.count || 0),
          openWorkflowValidationTokens: Number(workflowValidationCountRow?.count || 0),
        },
        feedTokens,
        oauthTokens,
        ticketValidationTokens,
        workflowValidationTokens,
      },
      databaseStructure,
      buildHistory: gitMetadata.history,
      featureHistory,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Systeminfos konnten nicht geladen werden',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/system/update/status
 * Liefert konsolidierten Update-Status fuer gefuehrte manuelle Updates.
 */
router.get('/system/update/status', adminOnly, async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const status = await loadSystemUpdateStatus(db);
    const shouldRecordStatusCheck = isTruthyFlag(req.query?.record);
    if (shouldRecordStatusCheck) {
      const blockedReasons: string[] = [];
      if (!status.git.available) blockedReasons.push('Git-Metadaten nicht verfügbar.');
      if (!status.migrations.consistent) blockedReasons.push('Migrationsstatus ist inkonsistent.');
      if (!status.backup.available) {
        blockedReasons.push('Kein Backup-Artefakt gefunden.');
      } else if (!status.backup.isFresh) {
        blockedReasons.push(`Letztes Backup ist älter als ${status.backup.requiredMaxAgeHours}h.`);
      }
      const report: UpdatePreflightReport = {
        kind: 'status_check',
        ok: blockedReasons.length === 0,
        blockedReasons,
        checks: {
          gitAvailable: {
            ok: status.git.available,
            detail: status.git.available ? 'Git-Metadaten verfügbar.' : 'Git-Metadaten nicht verfügbar.',
          },
          backupFresh: {
            ok: status.backup.available && status.backup.isFresh,
            detail: status.backup.available
              ? status.backup.isFresh
                ? 'Backup vorhanden und aktuell.'
                : `Backup vorhanden, aber älter als ${status.backup.requiredMaxAgeHours}h.`
              : 'Kein Backup-Artefakt gefunden.',
          },
          migrationsConsistent: {
            ok: status.migrations.consistent,
            detail: status.migrations.consistent
              ? 'Migrationsstatus konsistent.'
              : 'schema_migrations und Migrationsdateien sind nicht konsistent.',
          },
        },
        status,
        durationMs: 0,
        checkedAt: new Date().toISOString(),
      };
      try {
        await appendSystemUpdateHistory({
          db,
          adminUserId: normalizeText(req.userId) || null,
          username: normalizeText(req.username) || null,
          report,
        });
      } catch {
        // status should still return even if history write fails
      }
    }
    return res.json(status);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Update-Status konnte nicht ermittelt werden.',
      error: String(error?.message || error),
    });
  }
});

/**
 * POST /api/admin/system/update/preflight
 * Pflicht-Checks vor manuellen Updates (inkl. Backup-Gate).
 */
router.post('/system/update/preflight', adminOnly, async (req: Request, res: Response) => {
  const db = getDatabase();
  const startedAt = Date.now();
  let dbReachable = false;
  let dbError = '';
  try {
    await db.get('SELECT 1 AS ok');
    dbReachable = true;
  } catch (error: any) {
    dbReachable = false;
    dbError = String(error?.message || error || 'db_unreachable');
  }

  const status = await loadSystemUpdateStatus(db);
  const composeProdPath = path.resolve(WORKSPACE_ROOT, 'docker-compose.prod.yml');
  const composePath = path.resolve(WORKSPACE_ROOT, 'docker-compose.yml');
  const composeExists = existsSync(composeProdPath) || existsSync(composePath);
  const migrationConsistent = status.migrations.consistent;
  const backupFresh = status.backup.available && status.backup.isFresh;
  const backupBlockingReason = !status.backup.available
    ? 'Kein Backup-Artefakt gefunden.'
    : !status.backup.isFresh
    ? `Letztes Backup ist älter als ${status.backup.requiredMaxAgeHours}h.`
    : '';
  const blockedReasons: string[] = [];
  if (!dbReachable) blockedReasons.push('Datenbank ist nicht erreichbar.');
  if (!composeExists && status.runtimeType === 'docker-compose') {
    blockedReasons.push('Docker-Compose-Datei fehlt.');
  }
  if (!migrationConsistent) blockedReasons.push('Migrationsstatus ist inkonsistent.');
  if (!backupFresh) blockedReasons.push(backupBlockingReason || 'Backup-Prüfung fehlgeschlagen.');

  const report: UpdatePreflightReport = {
    kind: 'preflight',
    ok: blockedReasons.length === 0,
    blockedReasons,
    checks: {
      dbReachable: {
        ok: dbReachable,
        detail: dbReachable ? 'Datenbank erreichbar.' : dbError || 'Datenbank nicht erreichbar.',
      },
      composePresent: {
        ok: status.runtimeType !== 'docker-compose' || composeExists,
        detail:
          status.runtimeType !== 'docker-compose'
            ? 'Runtime ist nicht docker-compose.'
            : composeExists
            ? 'Compose-Datei gefunden.'
            : 'Compose-Datei nicht gefunden.',
      },
      backupFresh: {
        ok: backupFresh,
        detail: backupFresh ? 'Backup vorhanden und aktuell.' : backupBlockingReason || 'Backup fehlt/zu alt.',
      },
      migrationsConsistent: {
        ok: migrationConsistent,
        detail: migrationConsistent
          ? 'Migrationsstatus konsistent.'
          : 'schema_migrations und Migrationsdateien sind nicht konsistent.',
      },
      gitAvailable: {
        ok: status.git.available,
        detail: status.git.available ? 'Git-Metadaten verfügbar.' : 'Git-Metadaten nicht verfügbar.',
      },
    },
    status,
    durationMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  };

  try {
    await appendSystemUpdateHistory({
      db,
      adminUserId: normalizeText(req.userId) || null,
      username: normalizeText(req.username) || null,
      report,
    });
  } catch {
    // preflight should still return even if history write fails
  }

  return res.json(report);
});

/**
 * GET /api/admin/system/update/runbook
 * Liefert ein manuelles, kopierbares Update-Runbook (keine Server-seitige Ausfuehrung).
 */
router.get('/system/update/runbook', adminOnly, async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const status = await loadSystemUpdateStatus(db);
    const targetTag = normalizeText(req.query?.targetTag || '') || status.latestTagVersion || null;
    const commands = buildUpdateRunbook({
      targetTag,
      runtimeType: status.runtimeType,
    });
    return res.json({
      runtimeType: status.runtimeType,
      targetTag,
      generatedAt: new Date().toISOString(),
      commands,
      notes: [
        'Vor jedem Update ist ein frisches Backup verpflichtend.',
        'Die Kommandos werden bewusst nicht serverseitig ausgeführt.',
        'Bei Problemen zuerst Logs prüfen, dann auf vorherigen Tag zurückrollen.',
      ],
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Runbook konnte nicht erstellt werden.',
      error: String(error?.message || error),
    });
  }
});

/**
 * GET /api/admin/system/update/history
 * Historie der Preflight-Läufe (auditierbar).
 */
router.get('/system/update/history', adminOnly, async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query?.limit || 30))));
    const items = await listSystemUpdateHistory(db, limit);
    return res.json({
      items,
      count: items.length,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Update-Historie konnte nicht geladen werden.',
      error: String(error?.message || error),
    });
  }
});

/**
 * GET /api/admin/journal
 * Journal mit Login/Logout/Auth-Ereignissen
 */
router.get('/journal', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
    const eventType = typeof req.query.eventType === 'string' ? req.query.eventType.trim() : '';

    const db = getDatabase();
    const whereParts: string[] = [];
    const params: any[] = [];
    if (eventType) {
      whereParts.push('event_type = ?');
      params.push(eventType);
    }
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT *
       FROM admin_journal
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalRow = await db.get(
      `SELECT COUNT(*) as count FROM admin_journal ${whereSql}`,
      params
    );
    const events = await db.all(
      `SELECT event_type, COUNT(*) as count
       FROM admin_journal
       GROUP BY event_type
       ORDER BY count DESC, event_type ASC`
    );

    return res.json({
      items: rows.map((row: any) => {
        const converted = convertToCamelCase(row);
        return {
          ...converted,
          details: parseJsonIfPossible(row.details),
        };
      }),
      total: totalRow?.count || 0,
      availableEventTypes: events.map((item: any) => ({
        eventType: item.event_type,
        count: item.count,
      })),
      limit,
      offset,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Abrufen des Journals' });
  }
});

/**
 * DELETE /api/admin/journal/:id
 * Einzelnen Journal-Eintrag löschen
 */
router.delete('/journal/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'id erforderlich' });
    const db = getDatabase();
    const result: any = await db.run(`DELETE FROM admin_journal WHERE id = ?`, [id]);
    if (!result?.changes) {
      return res.status(404).json({ message: 'Journal-Eintrag nicht gefunden' });
    }
    return res.json({ message: 'Journal-Eintrag gelöscht' });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Löschen des Journal-Eintrags' });
  }
});

/**
 * DELETE /api/admin/journal
 * Mehrere Journal-Einträge löschen
 */
router.delete('/journal', async (req: Request, res: Response) => {
  try {
    const incoming = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids: string[] = Array.from(
      new Set(
        incoming
          .filter((value: unknown): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );

    if (ids.length === 0) {
      return res.status(400).json({ message: 'ids ist erforderlich' });
    }
    if (ids.length > 1000) {
      return res.status(400).json({ message: 'Maximal 1000 Einträge pro Anfrage erlaubt' });
    }

    const db = getDatabase();
    const placeholders = ids.map(() => '?').join(', ');
    const result: any = await db.run(`DELETE FROM admin_journal WHERE id IN (${placeholders})`, ids);
    return res.json({
      message: `${result?.changes || 0} Journal-Eintrag/Einträge gelöscht`,
      deleted: result?.changes || 0,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Löschen der Journal-Einträge' });
  }
});

/**
 * GET /api/admin/notifications/events
 * Metadaten der verfügbaren Notification-Events
 */
router.get('/notifications/events', async (_req: Request, res: Response): Promise<any> => {
  return res.json({
    events: NOTIFICATION_EVENT_DEFINITIONS,
  });
});

/**
 * GET /api/admin/notifications
 * Notification Center Feed (rollen- und präferenzgefiltert)
 */
router.get('/notifications', async (req: Request, res: Response): Promise<any> => {
  try {
    const statusRaw = String(req.query?.status || 'all').trim().toLowerCase();
    const severityRaw = String(req.query?.severity || 'all').trim().toLowerCase();
    const eventType = typeof req.query?.eventType === 'string' ? req.query.eventType.trim() : '';
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
    const offset = Math.max(0, Number(req.query?.offset || 0));
    const payload = await listAdminNotifications({
      adminUserId: req.userId || null,
      role: req.role || null,
      status:
        statusRaw === 'open' || statusRaw === 'read' || statusRaw === 'resolved'
          ? (statusRaw as 'open' | 'read' | 'resolved')
          : 'all',
      severity:
        severityRaw === 'info' || severityRaw === 'warning' || severityRaw === 'error'
          ? (severityRaw as 'info' | 'warning' | 'error')
          : 'all',
      eventType,
      limit,
      offset,
    });
    return res.json(payload);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der Benachrichtigungen',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/admin/notifications/:id
 * Notification Status setzen (open|read|resolved)
 */
router.patch('/notifications/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Notification-ID fehlt.' });
    const statusRaw = String(req.body?.status || '').trim().toLowerCase();
    const status =
      statusRaw === 'open' || statusRaw === 'read' || statusRaw === 'resolved'
        ? (statusRaw as 'open' | 'read' | 'resolved')
        : null;
    if (!status) {
      return res.status(400).json({ message: 'status muss open, read oder resolved sein.' });
    }
    const updated = await updateAdminNotificationStatus({
      id,
      status,
      resolvedByAdminId: status === 'resolved' ? req.userId || null : null,
    });
    if (!updated) {
      return res.status(404).json({ message: 'Benachrichtigung nicht gefunden.' });
    }
    return res.json({ message: 'Benachrichtigung aktualisiert.', id, status });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Aktualisieren der Benachrichtigung',
      error: error?.message || String(error),
    });
  }
});

/**
 * DELETE /api/admin/notifications/:id
 * Notification löschen
 */
router.delete('/notifications/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Notification-ID fehlt.' });
    const deleted = await deleteAdminNotification(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Benachrichtigung nicht gefunden.' });
    }
    return res.json({ message: 'Benachrichtigung gelöscht.', id });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Löschen der Benachrichtigung',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/me/notification-preferences
 * Benutzerspezifische Notification-Präferenzen
 */
router.get('/me/notification-preferences', async (req: Request, res: Response): Promise<any> => {
  try {
    const payload = await getUserNotificationPreferences(req.userId || '', req.role || null);
    return res.json(payload);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der Benachrichtigungs-Einstellungen',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/admin/me/notification-preferences
 * Benutzerspezifische Notification-Präferenzen speichern
 */
router.patch('/me/notification-preferences', async (req: Request, res: Response): Promise<any> => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const updates = items
      .map((item: any) => ({
        eventType: String(item?.eventType || '').trim(),
        enabled: item?.enabled === true,
      }))
      .filter((item) => item.eventType.length > 0);
    await setUserNotificationPreferences(req.userId || '', updates);
    const payload = await getUserNotificationPreferences(req.userId || '', req.role || null);
    return res.json({
      message: 'Benachrichtigungs-Einstellungen gespeichert.',
      ...payload,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Speichern der Benachrichtigungs-Einstellungen',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/me
 * Eigenes Profil laden
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = await db.get(
      `SELECT id, username, email, first_name, last_name, job_title, work_phone, role,
              COALESCE(is_global_admin, 0) AS is_global_admin,
              active, created_at, updated_at
       FROM admin_users
       WHERE id = ?`,
      [req.userId]
    );

    if (!user) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden' });
    }

    const [totpEnabled, passkeys] = await Promise.all([
      isAdminTotpEnabled(db, String(req.userId || '').trim()),
      listAdminPasskeys(db, String(req.userId || '').trim()),
    ]);

    res.json({
      id: user.id,
      username: user.username,
      email: user.email || '',
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      jobTitle: user.job_title || '',
      workPhone: user.work_phone || '',
      role: user.role,
      isGlobalAdmin: Number(user.is_global_admin || 0) === 1,
      active: !!user.active,
      totpEnabled,
      passkeyCount: passkeys.length,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Laden des Benutzerprofils' });
  }
});

/**
 * GET /api/admin/me/access-context
 * Liefert den aufgelösten Zugriffskontext inkl. effektiver Rolle und Capabilities.
 */
router.get('/me/access-context', async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = String(req.userId || '').trim();
    const role = String(req.role || '').trim();
    const access = await loadAdminAccessContext(userId, role);
    const effectiveRole = resolveAdminEffectiveRole(access);
    const capabilities = buildAdminCapabilities(access);
    const contextModes =
      access.isGlobalAdmin
        ? ['global', 'tenant']
        : access.tenantIds.length > 0
        ? ['tenant']
        : ['global'];

    return res.json({
      userId: access.userId,
      role: access.role,
      effectiveRole,
      capabilities,
      isGlobalAdmin: access.isGlobalAdmin,
      tenantIds: access.tenantIds,
      tenantAdminTenantIds: access.tenantAdminTenantIds,
      orgScopes: access.orgScopes,
      context: {
        availableModes: contextModes,
        defaultMode: contextModes.includes('global') ? 'global' : 'tenant',
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden des Zugriffskontexts',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/push/public-key
 * Public VAPID key for admin/staff web push subscriptions.
 */
router.get('/push/public-key', async (_req: Request, res: Response): Promise<any> => {
  return res.json({
    available: isAdminPushEnabled(),
    publicKey: getAdminPushPublicKey(),
  });
});

/**
 * POST /api/admin/push/subscribe
 * Register or refresh an admin/staff push subscription.
 */
router.post('/push/subscribe', async (req: Request, res: Response): Promise<any> => {
  try {
    if (!isAdminPushEnabled()) {
      return res.status(409).json({ message: 'Admin Push ist aktuell deaktiviert.' });
    }
    const subscription = req.body?.subscription && typeof req.body.subscription === 'object'
      ? req.body.subscription
      : req.body;
    const saved = await upsertAdminPushSubscription({
      adminUserId: normalizeText(req.userId),
      sessionId: normalizeText(req.sessionId),
      userAgent: getRequestUserAgent(req),
      subscription,
    });
    return res.json({ ok: true, id: saved.id });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('invalid_push_subscription')) {
      return res.status(400).json({ message: 'Ungültige Push-Subscription.' });
    }
    return res.status(500).json({
      message: 'Push-Subscription konnte nicht gespeichert werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/push/unsubscribe
 * Revoke one or all push subscriptions for the authenticated admin/staff user.
 */
router.post('/push/unsubscribe', async (req: Request, res: Response): Promise<any> => {
  try {
    const revoked = await revokeAdminPushSubscription({
      adminUserId: normalizeText(req.userId),
      sessionId: normalizeText(req.sessionId),
      endpoint: normalizeText(req.body?.endpoint),
    });
    return res.json({ ok: true, revoked });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Push-Subscription konnte nicht entfernt werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/push/test
 * Send a test push notification to current user.
 */
router.post('/push/test', async (req: Request, res: Response): Promise<any> => {
  try {
    const title = normalizeText(req.body?.title) || 'Testbenachrichtigung';
    const body = normalizeText(req.body?.body) || 'Admin Push funktioniert.';
    const url = normalizeText(req.body?.url) || '/ops/dashboard';
    const result = await sendAdminPushToUser(normalizeText(req.userId), {
      title,
      body,
      url,
      tag: 'admin-push-test',
      eventType: 'push_test',
    });
    return res.json({
      ok: true,
      ...result,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Test-Push konnte nicht versendet werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/mobile/dashboard
 * Lightweight operations dashboard aggregation for mobile-first clients.
 */
router.get('/mobile/dashboard', async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = normalizeText(req.userId);
    const role = normalizeText(req.role);
    const access = await loadAdminAccessContext(userId, role);
    const effectiveRole = resolveAdminEffectiveRole(access);
    const timeRange = normalizeOpsTimeRange(req.query?.timeRange);
    const since = buildOpsSinceTimestamp(timeRange);
    const tenantFilter = normalizeText(resolveAdminContextTenantId(req) || req.query?.tenantId);
    const orgUnitFilter = normalizeText(req.query?.orgUnitId);

    if (tenantFilter && !access.isGlobalAdmin && !access.tenantIds.includes(tenantFilter)) {
      return res.status(403).json({ message: 'Kein Zugriff auf den gewählten Mandanten.' });
    }

    if (orgUnitFilter && !access.isGlobalAdmin) {
      const orgScoped = access.readableOrgUnitIds.includes(orgUnitFilter) || access.writableOrgUnitIds.includes(orgUnitFilter);
      if (!orgScoped) {
        const db = getDatabase();
        const row = await db.get<any>(
          `SELECT tenant_id
           FROM org_units
           WHERE id = ?
           LIMIT 1`,
          [orgUnitFilter]
        );
        const orgTenantId = normalizeText(row?.tenant_id);
        if (!orgTenantId || !access.tenantAdminTenantIds.includes(orgTenantId)) {
          return res.status(403).json({ message: 'Kein Zugriff auf die gewählte Organisationseinheit.' });
        }
      }
    }

    const db = getDatabase();
    const visibility = buildTicketVisibilitySql(access, { tableAlias: 't' });
    const ticketWhereParts: string[] = [`(${visibility.sql})`];
    const ticketParams: any[] = [...visibility.params];

    if (tenantFilter) {
      ticketWhereParts.push(`t.tenant_id = ?`);
      ticketParams.push(tenantFilter);
    }
    if (orgUnitFilter) {
      ticketWhereParts.push(
        `(t.owning_org_unit_id = ? OR t.primary_assignee_org_unit_id = ? OR EXISTS (
           SELECT 1
           FROM ticket_collaborators tc
           WHERE tc.ticket_id = t.id
             AND tc.org_unit_id = ?
         ))`
      );
      ticketParams.push(orgUnitFilter, orgUnitFilter, orgUnitFilter);
    }

    const ticketWhere = ticketWhereParts.join(' AND ');
    const closedStatuses = normalizeTicketClosedStatuses();
    const processingStatuses = normalizeTicketProcessingStatuses();
    const closedPlaceholders = closedStatuses.map(() => '?').join(', ');
    const processingPlaceholders = processingStatuses.map(() => '?').join(', ');
    const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [{ count: myOpenCount }, { count: myOverdueCount }, { count: teamOpenCount }, { count: teamProcessingCount }] =
      await Promise.all([
        db.get<any>(
          `SELECT COUNT(*) AS count
           FROM tickets t
           WHERE ${ticketWhere}
             AND COALESCE(LOWER(t.status), 'open') NOT IN (${closedPlaceholders})
             AND t.primary_assignee_user_id = ?`,
          [...ticketParams, ...closedStatuses, userId]
        ),
        db.get<any>(
          `SELECT COUNT(*) AS count
           FROM tickets t
           WHERE ${ticketWhere}
             AND COALESCE(LOWER(t.status), 'open') NOT IN (${closedPlaceholders})
             AND datetime(t.created_at) <= datetime(?)`,
          [...ticketParams, ...closedStatuses, staleThreshold]
        ),
        db.get<any>(
          `SELECT COUNT(*) AS count
           FROM tickets t
           WHERE ${ticketWhere}
             AND COALESCE(LOWER(t.status), 'open') NOT IN (${closedPlaceholders})`,
          [...ticketParams, ...closedStatuses]
        ),
        db.get<any>(
          `SELECT COUNT(*) AS count
           FROM tickets t
           WHERE ${ticketWhere}
             AND COALESCE(LOWER(t.status), 'open') IN (${processingPlaceholders})`,
          [...ticketParams, ...processingStatuses]
        ),
      ]);

    const myTaskRow = await db.get<any>(
      `SELECT COUNT(*) AS count
       FROM workflow_internal_tasks w
       INNER JOIN tickets t ON t.id = w.ticket_id
       WHERE ${ticketWhere}
         AND w.assignee_user_id = ?
         AND COALESCE(LOWER(w.status), 'pending') IN ('pending', 'in_progress')`,
      [...ticketParams, userId]
    );

    const tenantAdminInSql =
      access.tenantAdminTenantIds.length > 0 ? access.tenantAdminTenantIds.map(() => '?').join(', ') : 'NULL';
    const readableOrgInSql =
      access.readableOrgUnitIds.length > 0 ? access.readableOrgUnitIds.map(() => '?').join(', ') : 'NULL';

    const unreadChatRow = await db.get<any>(
      `SELECT COUNT(*) AS count
       FROM admin_chat_messages m
       LEFT JOIN admin_chat_message_reads r
         ON r.message_id = m.id
        AND r.admin_user_id = ?
       LEFT JOIN org_units ou ON ou.id = m.group_id
       WHERE m.sender_admin_user_id <> ?
         AND r.message_id IS NULL
         AND (
           (m.conversation_type = 'direct' AND m.recipient_admin_user_id = ?)
           OR (
             m.conversation_type = 'group'
             AND m.group_kind = 'custom'
             AND EXISTS (
               SELECT 1
               FROM admin_chat_custom_groups g
               LEFT JOIN admin_chat_custom_group_members gm
                 ON gm.group_id = g.id
                AND gm.admin_user_id = ?
               WHERE g.id = m.group_id
                 AND (g.created_by_admin_id = ? OR gm.admin_user_id = ?)
             )
           )
           OR (
             m.conversation_type = 'group'
             AND m.group_kind = 'org'
             AND (
               ? = 1
               OR ou.tenant_id IN (${tenantAdminInSql})
               OR m.group_id IN (${readableOrgInSql})
             )
           )
         )`,
      [
        userId,
        userId,
        userId,
        userId,
        userId,
        userId,
        access.isGlobalAdmin ? 1 : 0,
        ...access.tenantAdminTenantIds,
        ...access.readableOrgUnitIds,
      ]
    );

    const notificationSummary = await listAdminNotifications({
      adminUserId: userId,
      role,
      status: 'open',
      severity: 'all',
      eventType: '',
      limit: 1,
      offset: 0,
    });

    const recentTickets = await db.all<any>(
      `SELECT
         t.id,
         t.category,
         t.priority,
         t.status,
         t.tenant_id,
         t.owning_org_unit_id,
         t.primary_assignee_user_id,
         t.updated_at,
         t.created_at
       FROM tickets t
       WHERE ${ticketWhere}
         AND datetime(COALESCE(t.updated_at, t.created_at)) >= datetime(?)
       ORDER BY datetime(COALESCE(t.updated_at, t.created_at)) DESC
       LIMIT 12`,
      [...ticketParams, since]
    );

    const workflowHotspots = await db.all<any>(
      `SELECT
         COALESCE(NULLIF(TRIM(w.title), ''), 'Workflow-Aufgabe') AS title,
         COUNT(*) AS count
       FROM workflow_internal_tasks w
       INNER JOIN tickets t ON t.id = w.ticket_id
       WHERE ${ticketWhere}
         AND datetime(w.created_at) >= datetime(?)
       GROUP BY COALESCE(NULLIF(TRIM(w.title), ''), 'Workflow-Aufgabe')
       ORDER BY count DESC, title ASC
       LIMIT 6`,
      [...ticketParams, since]
    );

    const recentTasks = await db.all<any>(
      `SELECT
         w.id,
         w.workflow_execution_id AS execution_id,
         w.ticket_id,
         COALESCE(NULLIF(TRIM(w.title), ''), 'Workflow-Aufgabe') AS title,
         COALESCE(NULLIF(TRIM(w.mode), ''), 'TASK') AS task_type,
         COALESCE(NULLIF(TRIM(w.status), ''), 'pending') AS status,
         w.created_at,
         COALESCE(w.completed_at, w.created_at) AS updated_at
       FROM workflow_internal_tasks w
       INNER JOIN tickets t ON t.id = w.ticket_id
       WHERE ${ticketWhere}
         AND COALESCE(LOWER(w.status), 'pending') IN ('pending', 'in_progress', 'blocked')
       ORDER BY datetime(COALESCE(w.completed_at, w.created_at)) DESC
       LIMIT 12`,
      [...ticketParams]
    );

    return res.json({
      generatedAt: new Date().toISOString(),
      role: effectiveRole,
      filters: {
        tenantId: tenantFilter || null,
        orgUnitId: orgUnitFilter || null,
        timeRange,
      },
      me: {
        openTickets: Number(myOpenCount || 0),
        overdueTickets: Number(myOverdueCount || 0),
        openTasks: Number(myTaskRow?.count || 0),
        unreadChatCount: Number(unreadChatRow?.count || 0),
        openNotifications: Number(notificationSummary?.total || 0),
      },
      team: {
        openTickets: Number(teamOpenCount || 0),
        processingTickets: Number(teamProcessingCount || 0),
      },
      recent: {
        tickets: (recentTickets || []).map((row: any) => ({
          id: normalizeText(row?.id),
          category: normalizeText(row?.category),
          priority: normalizeText(row?.priority),
          status: normalizeText(row?.status),
          tenantId: normalizeText(row?.tenant_id),
          owningOrgUnitId: normalizeText(row?.owning_org_unit_id),
          primaryAssigneeUserId: normalizeText(row?.primary_assignee_user_id),
          updatedAt: row?.updated_at || row?.created_at || null,
        })),
        workflowHotspots: (workflowHotspots || []).map((row: any) => ({
          title: normalizeText(row?.title) || 'Workflow-Aufgabe',
          count: Number(row?.count || 0),
        })),
        tasks: (recentTasks || []).map((row: any) => ({
          id: normalizeText(row?.id),
          executionId: normalizeText(row?.execution_id),
          ticketId: normalizeText(row?.ticket_id),
          title: normalizeText(row?.title) || 'Workflow-Aufgabe',
          taskType: normalizeText(row?.task_type) || 'TASK',
          status: normalizeText(row?.status) || 'pending',
          updatedAt: row?.updated_at || row?.created_at || null,
        })),
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Mobiles Dashboard konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/admin/me
 * Eigenes Profil aktualisieren
 */
router.patch('/me', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const firstName = typeof req.body?.firstName === 'string' ? req.body.firstName.trim() : '';
    const lastName = typeof req.body?.lastName === 'string' ? req.body.lastName.trim() : '';
    const jobTitle = typeof req.body?.jobTitle === 'string' ? req.body.jobTitle.trim() : '';
    const workPhone = typeof req.body?.workPhone === 'string' ? req.body.workPhone.trim() : '';

    if (!username) {
      return res.status(400).json({ message: 'Benutzername ist erforderlich' });
    }

    if (!email) {
      return res.status(400).json({ message: 'E-Mail ist erforderlich' });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      return res.status(400).json({ message: 'Ungültige E-Mail-Adresse' });
    }

    const conflict = await db.get(
      `SELECT id FROM admin_users WHERE (username = ? OR email = ?) AND id != ? LIMIT 1`,
      [username, email, req.userId]
    );
    if (conflict) {
      return res.status(409).json({ message: 'Benutzername oder E-Mail ist bereits vergeben' });
    }

    await db.run(
      `UPDATE admin_users
       SET username = ?, email = ?, first_name = ?, last_name = ?, job_title = ?, work_phone = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [username, email, firstName || null, lastName || null, jobTitle || null, workPhone || null, req.userId]
    );

    const updated = await db.get(
      `SELECT id, username, email, first_name, last_name, job_title, work_phone, role, active, created_at, updated_at
       FROM admin_users
       WHERE id = ?`,
      [req.userId]
    );

    return res.json({
      message: 'Profil aktualisiert',
      user: {
        id: updated.id,
        username: updated.username,
        email: updated.email || '',
        firstName: updated.first_name || '',
        lastName: updated.last_name || '',
        jobTitle: updated.job_title || '',
        workPhone: updated.work_phone || '',
        role: updated.role,
        active: !!updated.active,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Aktualisieren des Profils' });
  }
});

/**
 * POST /api/admin/me/password
 * Eigenes Passwort ändern (mit Verifikation des alten Passworts)
 */
router.post('/me/password', async (req: Request, res: Response): Promise<any> => {
  try {
    const oldPassword = typeof req.body?.oldPassword === 'string' ? req.body.oldPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!oldPassword) {
      return res.status(400).json({ message: 'Aktuelles Passwort ist erforderlich' });
    }
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'Neues Passwort muss mindestens 8 Zeichen lang sein' });
    }

    const db = getDatabase();
    const user = await db.get(`SELECT id, password_hash FROM admin_users WHERE id = ?`, [req.userId]);
    if (!user) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden' });
    }

    const isOldPasswordValid = await bcryptjs.compare(oldPassword, user.password_hash);
    if (!isOldPasswordValid) {
      return res.status(401).json({ message: 'Aktuelles Passwort ist falsch' });
    }

    await updateAdminPassword(db, req.userId!, newPassword);
    return res.json({ message: 'Passwort aktualisiert' });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Aktualisieren des Passworts' });
  }
});

/**
 * GET /api/admin/me/security
 * Sicherheitsstatus (Passkeys/TOTP) für den eingeloggten Benutzer
 */
router.get('/me/security', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich' });
    }

    const [totpEnabled, passkeys] = await Promise.all([
      isAdminTotpEnabled(db, adminUserId),
      listAdminPasskeys(db, adminUserId),
    ]);

    return res.json({
      totpEnabled,
      passkeys: passkeys.map((entry) => ({
        id: entry.id,
        label: entry.label || '',
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
        transports: entry.transports,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Sicherheitsstatus konnte nicht geladen werden',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/me/passkeys/registration/options
 * Startet die Passkey-Registrierung
 */
router.post('/me/passkeys/registration/options', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const adminUserId = String(req.userId || '').trim();
    const label = String(req.body?.label || '').trim().slice(0, 100);
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich' });
    }

    const user = await db.get<any>(
      `SELECT id, username, email, first_name, last_name
       FROM admin_users
       WHERE id = ?
       LIMIT 1`,
      [adminUserId]
    );
    if (!user) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden' });
    }

    const rpId = resolveWebAuthnRpId(req);
    const origins = resolveWebAuthnOrigins(req);
    const challenge = await createAdminAuthChallenge(db, {
      purpose: 'passkey_registration',
      adminUserId,
      payload: {
        rpId,
        origins,
        label: label || null,
      },
      ttlSeconds: 300,
    });
    const passkeys = await listAdminPasskeys(db, adminUserId);
    const displayName = `${String(user.first_name || '').trim()} ${String(user.last_name || '').trim()}`
      .replace(/\s+/g, ' ')
      .trim();

    return res.json({
      challengeId: challenge.id,
      publicKey: {
        challenge: challenge.challenge,
        rp: {
          name: 'behebes.AI Admin',
          id: rpId,
        },
        user: {
          id: Buffer.from(String(user.id || ''), 'utf8').toString('base64url'),
          name: String(user.username || ''),
          displayName: displayName || String(user.email || user.username || 'Admin'),
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        timeout: 60000,
        attestation: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        excludeCredentials: passkeys.map((entry) => ({
          type: 'public-key',
          id: entry.credentialId,
          transports: entry.transports,
        })),
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Passkey-Registrierung konnte nicht gestartet werden',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/me/passkeys/registration/verify
 * Speichert einen neu registrierten Passkey
 */
router.post('/me/passkeys/registration/verify', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich' });
    }

    const challengeId = String(req.body?.challengeId || '').trim();
    const credential = req.body?.credential && typeof req.body.credential === 'object'
      ? req.body.credential
      : null;
    if (!challengeId || !credential) {
      return res.status(400).json({ message: 'challengeId und credential sind erforderlich' });
    }

    const challenge = await consumeAdminAuthChallenge(db, {
      challengeId,
      purpose: 'passkey_registration',
      adminUserId,
    });
    if (!challenge) {
      return res.status(401).json({ message: 'Passkey-Challenge ungültig oder abgelaufen' });
    }

    const response = credential.response && typeof credential.response === 'object'
      ? credential.response
      : {};
    verifyPasskeyRegistrationClientData({
      clientDataJSON: String(response.clientDataJSON || ''),
      expectedChallenge: challenge.challenge,
      allowedOrigins: cleanupAllowedOrigins(
        Array.isArray(challenge.payload?.origins)
          ? challenge.payload.origins.map((entry: any) => String(entry || ''))
          : resolveWebAuthnOrigins(req)
      ),
    });

    const credentialId =
      typeof credential.rawId === 'string'
        ? credential.rawId.trim()
        : typeof credential.id === 'string'
        ? credential.id.trim()
        : '';
    const publicKeySpki = String(response.publicKey || credential.publicKey || '').trim();
    const coseAlgorithm = Number(response.publicKeyAlgorithm ?? credential.publicKeyAlgorithm);
    const transports = Array.isArray(response.transports)
      ? response.transports
      : Array.isArray(credential.transports)
      ? credential.transports
      : [];
    const label = String(req.body?.label || challenge.payload?.label || '').trim().slice(0, 100);

    if (!credentialId || !publicKeySpki) {
      return res.status(400).json({ message: 'Passkey-Daten unvollständig' });
    }

    let created;
    try {
      created = await createAdminPasskey(db, {
        adminUserId,
        credentialId,
        publicKeySpki,
        coseAlgorithm: Number.isFinite(coseAlgorithm) ? Math.trunc(coseAlgorithm) : -7,
        label,
        transports: transports.map((entry: any) => String(entry || '').trim()).filter(Boolean),
        createdByAdminId: adminUserId,
      });
    } catch (saveError: any) {
      const dbCode = String(saveError?.code || '');
      if (dbCode === 'SQLITE_CONSTRAINT' || dbCode === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: 'Dieser Passkey ist bereits registriert.' });
      }
      throw saveError;
    }

    return res.json({
      message: 'Passkey gespeichert',
      passkey: {
        id: created.id,
        label: created.label || '',
        createdAt: created.createdAt,
        lastUsedAt: created.lastUsedAt,
        transports: created.transports,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      message: 'Passkey konnte nicht gespeichert werden',
      error: error?.message || String(error),
    });
  }
});

/**
 * DELETE /api/admin/me/passkeys/:id
 * Widerruft einen Passkey des eingeloggten Benutzers
 */
router.delete('/me/passkeys/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const adminUserId = String(req.userId || '').trim();
    const passkeyId = String(req.params?.id || '').trim();
    if (!adminUserId || !passkeyId) {
      return res.status(400).json({ message: 'Passkey-ID fehlt' });
    }

    const revoked = await revokeAdminPasskey(db, {
      passkeyId,
      adminUserId,
      revokedByAdminId: adminUserId,
    });
    if (!revoked) {
      return res.status(404).json({ message: 'Passkey nicht gefunden' });
    }

    return res.json({ message: 'Passkey widerrufen' });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Passkey konnte nicht widerrufen werden',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/me/security/totp/setup
 * Erzeugt ein temporäres TOTP-Setup (Secret + Setup-Token)
 */
router.post('/me/security/totp/setup', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich' });
    }

    const user = await db.get<any>(
      `SELECT username, email
       FROM admin_users
       WHERE id = ?
       LIMIT 1`,
      [adminUserId]
    );
    if (!user) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden' });
    }

    const secret = generateTotpSecret();
    const accountName = String(user.email || user.username || 'admin').trim() || 'admin';
    const issuer = 'behebes.AI';
    const setup = await createAdminAuthChallenge(db, {
      purpose: 'totp_setup',
      adminUserId,
      payload: {
        secret,
      },
      ttlSeconds: 600,
    });

    return res.json({
      setupToken: setup.id,
      secret,
      issuer,
      accountName,
      otpAuthUrl: buildTotpOtpAuthUri({
        issuer,
        accountName,
        secret,
      }),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'TOTP-Setup konnte nicht gestartet werden',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/me/security/totp/enable
 * Aktiviert TOTP nach Verifikation eines Codes
 */
router.post('/me/security/totp/enable', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich' });
    }

    const setupToken = String(req.body?.setupToken || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!setupToken || !code) {
      return res.status(400).json({ message: 'setupToken und Code sind erforderlich' });
    }

    const setup = await consumeAdminAuthChallenge(db, {
      challengeId: setupToken,
      purpose: 'totp_setup',
      adminUserId,
    });
    if (!setup) {
      return res.status(401).json({ message: 'Setup-Token ungültig oder abgelaufen' });
    }

    const secret = String(setup.payload?.secret || '').trim();
    if (!secret || !verifyTotpCode(secret, code, { window: 1 })) {
      return res.status(400).json({ message: 'TOTP-Code ungültig' });
    }

    await saveAdminTotpFactor(db, {
      adminUserId,
      secretBase32: secret,
      enabled: true,
      updatedByAdminId: adminUserId,
    });

    return res.json({
      message: 'TOTP aktiviert',
      totpEnabled: true,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'TOTP konnte nicht aktiviert werden',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/me/security/totp/disable
 * Deaktiviert TOTP nach Codebestätigung
 */
router.post('/me/security/totp/disable', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich' });
    }

    const code = String(req.body?.code || '').trim();
    if (!code) {
      return res.status(400).json({ message: 'TOTP-Code ist erforderlich' });
    }

    const valid = await verifyAdminTotpCode(db, {
      adminUserId,
      code,
      window: 1,
    });
    if (!valid) {
      return res.status(401).json({ message: 'TOTP-Code ungültig' });
    }

    const changed = await disableAdminTotpFactor(db, {
      adminUserId,
      updatedByAdminId: adminUserId,
    });

    return res.json({
      message: changed ? 'TOTP deaktiviert' : 'TOTP war bereits deaktiviert',
      totpEnabled: false,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'TOTP konnte nicht deaktiviert werden',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/password
 * Eigenes Passwort ändern
 */
router.post('/password', async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const db = getDatabase();

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen lang sein' });
    }

    if (oldPassword) {
      const user = await db.get(`SELECT password_hash FROM admin_users WHERE id = ?`, [req.userId]);
      if (!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }
      const isOldPasswordValid = await bcryptjs.compare(oldPassword, user.password_hash);
      if (!isOldPasswordValid) {
        return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
      }
    }

    await updateAdminPassword(db, req.userId!, newPassword);
    res.json({ message: 'Passwort aktualisiert' });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Passworts' });
  }
});

/**
 * GET /api/admin/logs
 * AI-Entscheidungslogs
 */
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const db = getDatabase();
    const logs = await db.all(
      `SELECT * FROM ai_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json(logs.map((log: any) => convertToCamelCase(log)));
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Abrufen der Logs' });
  }
});

/**
 * GET /api/admin/logs/:ticketId
 * Liefert den neuesten AI-Log-Eintrag für ein Ticket
 */
router.get('/logs/:ticketId', async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const db = getDatabase();
    const log = await db.get(
      `SELECT * FROM ai_logs WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1`,
      [ticketId]
    );

    if (!log) return res.status(404).json({ message: 'Kein AI-Log für dieses Ticket gefunden' });

    res.json(convertToCamelCase(log));
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Abrufen des AI-Logs' });
  }
});

/**
 * DELETE /api/admin/logs/:id
 * Einzelnen AI-Log-Eintrag löschen
 */
router.delete('/logs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'id erforderlich' });
    const db = getDatabase();
    const result: any = await db.run(`DELETE FROM ai_logs WHERE id = ?`, [id]);
    if (!result?.changes) {
      return res.status(404).json({ message: 'AI-Log nicht gefunden' });
    }
    return res.json({ message: 'AI-Log gelöscht' });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Löschen des AI-Logs' });
  }
});

/**
 * DELETE /api/admin/logs
 * Mehrere AI-Log-Einträge löschen
 */
router.delete('/logs', async (req: Request, res: Response) => {
  try {
    const incoming = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids: string[] = Array.from(
      new Set(
        incoming
          .filter((value: unknown): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );

    if (ids.length === 0) {
      return res.status(400).json({ message: 'ids ist erforderlich' });
    }
    if (ids.length > 1000) {
      return res.status(400).json({ message: 'Maximal 1000 Einträge pro Anfrage erlaubt' });
    }

    const db = getDatabase();
    const placeholders = ids.map(() => '?').join(', ');
    const result: any = await db.run(`DELETE FROM ai_logs WHERE id IN (${placeholders})`, ids);
    return res.json({
      message: `${result?.changes || 0} AI-Log(s) gelöscht`,
      deleted: result?.changes || 0,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Löschen der AI-Logs' });
  }
});

/**
 * GET /api/admin/email-queue
 * Mail-Queue inkl. Statuszähler
 */
router.get('/email-queue', async (req: Request, res: Response) => {
  try {
    const allowed = new Set(['all', 'pending', 'retry', 'processing', 'sent', 'failed', 'cancelled']);
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    if (!allowed.has(status)) {
      return res.status(400).json({ message: 'Ungültiger Statusfilter' });
    }

    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);

    const result = await listEmailQueue({
      status: status as 'all' | 'pending' | 'retry' | 'processing' | 'sent' | 'failed' | 'cancelled',
      limit,
      offset,
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Abrufen der Mail-Queue', error: error?.message || String(error) });
  }
});

/**
 * POST /api/admin/email-queue/:id/retry
 * Queue-Eintrag erneut zustellen (gleicher Eintrag)
 */
router.post('/email-queue/:id/retry', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await retryEmailQueueItem(id);
    if (!item) {
      return res.status(404).json({ message: 'Queue-Eintrag nicht gefunden' });
    }
    return res.json({ message: 'Queue-Eintrag zur erneuten Zustellung markiert', item });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Retry', error: error?.message || String(error) });
  }
});

/**
 * POST /api/admin/email-queue/:id/resend
 * Queue-Eintrag duplizieren und als neue E-Mail erneut versenden
 */
router.post('/email-queue/:id/resend', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await resendEmailQueueItem(id);
    if (!item) {
      return res.status(404).json({ message: 'Queue-Eintrag nicht gefunden' });
    }
    return res.json({ message: 'Neue E-Mail zum Versand eingeplant', item });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Neuversand', error: error?.message || String(error) });
  }
});

/**
 * DELETE /api/admin/email-queue/:id
 * Queue-Eintrag löschen
 */
router.delete('/email-queue/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await deleteEmailQueueItem(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Queue-Eintrag nicht gefunden' });
    }
    return res.json({ message: 'Queue-Eintrag gelöscht' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Löschen', error: error?.message || String(error) });
  }
});

/**
 * GET /api/admin/mailbox/messages
 * Liste importierter IMAP-Nachrichten
 */
router.get('/mailbox/messages', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(300, Math.max(1, parseInt(String(req.query.limit || '80'), 10) || 80));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
    const ticketId = typeof req.query.ticketId === 'string' ? req.query.ticketId.trim() : '';
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const result = await listMailboxMessages({
      limit,
      offset,
      ticketId: ticketId || undefined,
      query: query || undefined,
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Abrufen des Postfachs',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/mailbox/messages/:messageId
 * Nachrichtendetails inkl. Anhänge
 */
router.get('/mailbox/messages/:messageId', async (req: Request, res: Response) => {
  try {
    const messageId = String(req.params.messageId || '').trim();
    if (!messageId) {
      return res.status(400).json({ message: 'messageId fehlt' });
    }
    const message = await getMailboxMessageById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Nachricht nicht gefunden' });
    }
    return res.json(message);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der Nachricht',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/mailbox/messages/:messageId/attachments/:attachmentId/download
 * Einzelnen E-Mail-Anhang herunterladen
 */
router.get('/mailbox/messages/:messageId/attachments/:attachmentId/download', async (req: Request, res: Response) => {
  try {
    const messageId = String(req.params.messageId || '').trim();
    const attachmentId = String(req.params.attachmentId || '').trim();
    if (!messageId || !attachmentId) {
      return res.status(400).json({ message: 'messageId und attachmentId sind erforderlich' });
    }
    const attachment = await getMailboxAttachmentBinary(messageId, attachmentId);
    if (!attachment) {
      return res.status(404).json({ message: 'Anhang nicht gefunden' });
    }
    const fileName = String(attachment.fileName || 'attachment.bin').replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(attachment.byteSize || attachment.data.length));
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.status(200).send(attachment.data);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Herunterladen des Anhangs',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/mailbox/sync
 * Manuelle IMAP-Synchronisierung auslösen
 */
router.post('/mailbox/sync', adminOnly, async (req: Request, res: Response) => {
  try {
    const tenantId = resolveAdminContextTenantId(req);
    if (tenantId) {
      const tenantAllowed = await requireTenantEmailSettingsAccess(req, res, tenantId);
      if (!tenantAllowed) return;
    } else {
      const globalAllowed = await requireGlobalEmailSettingsAccess(req, res);
      if (!globalAllowed) return;
    }

    const result = await syncMailboxInbox({ tenantId: tenantId || undefined });
    return res.json({
      message: 'Postfach-Synchronisierung abgeschlossen',
      tenantId: tenantId || null,
      ...result,
    });
  } catch (error: any) {
    return res.status(400).json({
      message: 'Postfach-Synchronisierung fehlgeschlagen',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/mailbox/stats
 * Kennzahlen zum IMAP-Postfach
 */
router.get('/mailbox/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getMailboxStats();
    return res.json(stats);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der Postfachstatistik',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/ai-queue
 * KI-Queue inkl. Statuszähler
 */
router.get('/ai-queue', async (req: Request, res: Response) => {
  try {
    const allowed = new Set(['all', 'pending', 'retry', 'processing', 'done', 'failed', 'cancelled']);
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    if (!allowed.has(status)) {
      return res.status(400).json({ message: 'Ungültiger Statusfilter' });
    }

    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);

    const result = await listAiQueue({
      status: status as 'all' | 'pending' | 'retry' | 'processing' | 'done' | 'failed' | 'cancelled',
      limit,
      offset,
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Abrufen der KI-Queue', error: error?.message || String(error) });
  }
});

/**
 * POST /api/admin/ai-queue/:id/retry
 * KI-Queue-Eintrag erneut einplanen
 */
router.post('/ai-queue/:id/retry', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await retryAiQueueItem(id);
    if (!item) {
      return res.status(404).json({ message: 'Queue-Eintrag nicht gefunden' });
    }
    return res.json({ message: 'KI-Queue-Eintrag erneut eingeplant', item });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Retry', error: error?.message || String(error) });
  }
});

/**
 * POST /api/admin/ai-queue/:id/cancel
 * KI-Queue-Eintrag abbrechen (nur pending/retry)
 */
router.post('/ai-queue/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await cancelAiQueueItem(id);
    if (!item) {
      return res.status(404).json({ message: 'Eintrag nicht abbrechbar oder nicht gefunden' });
    }
    return res.json({ message: 'KI-Queue-Eintrag abgebrochen', item });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Abbrechen', error: error?.message || String(error) });
  }
});

/**
 * DELETE /api/admin/ai-queue/:id
 * KI-Queue-Eintrag löschen
 */
router.delete('/ai-queue/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await deleteAiQueueItem(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Queue-Eintrag nicht gefunden' });
    }
    return res.json({ message: 'KI-Queue-Eintrag gelöscht' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Löschen', error: error?.message || String(error) });
  }
});

/**
 * POST /api/admin/ai-queue/test-run
 * Testlauf über dieselbe KI-Queue-Pipeline mit optionalem Provider/Modell-Override
 */
router.post('/ai-queue/test-run', adminOnly, async (req: Request, res: Response) => {
  try {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      return res.status(400).json({ message: 'prompt ist erforderlich.' });
    }

    const purpose =
      typeof req.body?.purpose === 'string' && req.body.purpose.trim()
        ? req.body.purpose.trim()
        : 'admin_ai_queue_test_run';
    const taskKey =
      typeof req.body?.taskKey === 'string' && req.body.taskKey.trim()
        ? req.body.taskKey.trim()
        : '';
    const connectionId =
      typeof req.body?.connectionId === 'string' && req.body.connectionId.trim()
        ? req.body.connectionId.trim()
        : '';
    const modelId =
      typeof req.body?.modelId === 'string' && req.body.modelId.trim()
        ? req.body.modelId.trim()
        : '';

    const llmRuntime = await resolveLlmRuntimeSelection({
      purpose,
      taskKey: taskKey || undefined,
      connectionId: connectionId || undefined,
      modelId: modelId || undefined,
    });

    const result = await testAIProvider(prompt, {
      purpose,
      taskKey: taskKey || undefined,
      connectionId: connectionId || undefined,
      modelId: modelId || undefined,
      meta: {
        source: 'routes.admin.ai_queue.test_run',
        initiatedBy: req.userId || null,
        testRun: true,
      },
      waitTimeoutMs: Number.isFinite(Number(req.body?.waitTimeoutMs))
        ? Math.max(1000, Math.min(15 * 60 * 1000, Number(req.body.waitTimeoutMs)))
        : undefined,
    });

    return res.json({
      message: 'Testlauf über KI-Queue abgeschlossen.',
      output: result,
      provider: llmRuntime.connectionName || llmRuntime.connectionId,
      connectionId: llmRuntime.connectionId,
      model: llmRuntime.model,
      taskKey: llmRuntime.taskKey,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'KI-Queue-Testlauf fehlgeschlagen.',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/classify/test
 * Debug: Klassifizierungs-Prompt testen und Rohantwort anzeigen
 */
router.post('/classify/test', async (req: Request, res: Response) => {
  try {
    const {
      description,
      location,
      address,
      city,
      postalCode,
      latitude,
      longitude,
      weatherReport,
    } = req.body || {};

    if (!description || typeof description !== 'string') {
      return res.status(400).json({ message: 'description ist erforderlich' });
    }

    const combinedLocation =
      location ||
      [address, postalCode, city]
        .filter(Boolean)
        .join(', ');

    const { systemPrompt, userPrompt, combinedPrompt } =
      await buildClassificationPromptForDebug({
        description,
        location: combinedLocation,
        address,
        city,
        postalCode,
        latitude: typeof latitude === 'number' ? latitude : undefined,
        longitude: typeof longitude === 'number' ? longitude : undefined,
        weatherReport:
          weatherReport && typeof weatherReport === 'object' && !Array.isArray(weatherReport)
            ? weatherReport
            : undefined,
      });

    const aiResponse = await testAIProvider(combinedPrompt, {
      purpose: 'classification_debug',
      meta: {
        source: 'routes.admin.classify_test',
      },
    });

    return res.json({
      promptSent: combinedPrompt,
      systemPrompt,
      userPrompt,
      llmResponse: aiResponse,
    });
  } catch (error: any) {
    console.error('Classify test error:', error);
    const rawMessage = String(error?.message || '').trim();
    const providerStatusMatch =
      rawMessage.match(/KI-Provider Aufruf fehlgeschlagen:\s*([45]\d{2})/i) ||
      rawMessage.match(/\b([45]\d{2}) status code\b/i);
    if (providerStatusMatch) {
      const providerStatus = Number(providerStatusMatch[1]);
      const authOrQuota = providerStatus === 401 || providerStatus === 402 || providerStatus === 403;
      return res.status(502).json({
        message: authOrQuota
          ? `KI-Provider verweigert den Aufruf (${providerStatus}). API-Key, Guthaben und Modell prüfen.`
          : `KI-Provider-Fehler (${providerStatus}). Bitte Provider und Modell-Konfiguration prüfen.`,
        details: rawMessage,
      });
    }

    if (rawMessage.includes('Zeitüberschreitung beim Warten auf KI-Queue-Ergebnis')) {
      return res.status(504).json({
        message: 'Timeout beim Testen des Klassifizierungs-Prompts (KI-Queue).',
        details: rawMessage,
      });
    }

    if (rawMessage.includes('KI-Queue konnte nicht erstellt werden')) {
      return res.status(503).json({
        message: 'KI-Queue konnte nicht erstellt werden. Datenbank- und Queue-Status prüfen.',
        details: rawMessage,
      });
    }

    return res.status(500).json({
      message: rawMessage || 'Fehler beim Testen des Klassifizierungs-Prompts',
    });
  }
});

/**
 * PATCH /api/admin/logs/:ticketId
 * Aktualisiert Admin-Feedback für den neuesten AI-Log eines Tickets
 */
router.patch('/logs/:ticketId', async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { feedback, newCategory, isCorrect } = req.body;
    const db = getDatabase();

    // Find latest log id for ticket
    const latest = await db.get(
      `SELECT id FROM ai_logs WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1`,
      [ticketId]
    );

    if (!latest) return res.status(404).json({ message: 'Kein AI-Log für dieses Ticket gefunden' });

    await db.run(
      `UPDATE ai_logs SET admin_feedback = ?, feedback_is_correct = ?, corrected_category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [feedback || null, typeof isCorrect === 'boolean' ? (isCorrect ? 1 : 0) : null, newCategory || null, latest.id]
    );

    const updated = await db.get(`SELECT * FROM ai_logs WHERE id = ?`, [latest.id]);
    res.json(convertToCamelCase(updated));
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Speichern des Feedbacks' });
  }
});

/**
 * GET /api/admin/config/municipal-contacts
 * Kommunale Ansprechpartner-Konfiguration abrufen
 */
router.get('/config/municipal-contacts', adminOnly, async (_req: Request, res: Response) => {
  try {
    const config = await loadMunicipalContactsSettings();
    return res.json(config);
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Abrufen der kommunalen Ansprechpartner.' });
  }
});

/**
 * PATCH /api/admin/config/municipal-contacts
 * Kommunale Ansprechpartner-Konfiguration speichern
 */
router.patch('/config/municipal-contacts', adminOnly, async (req: Request, res: Response) => {
  try {
    const existing = await loadMunicipalContactsSettings();
    const incoming =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, any>)
        : {};
    const fallbackIncoming =
      incoming.fallback && typeof incoming.fallback === 'object' && !Array.isArray(incoming.fallback)
        ? (incoming.fallback as Record<string, any>)
        : {};
    const merged = {
      ...existing,
      ...incoming,
      fallback: {
        ...(existing.fallback || {}),
        ...fallbackIncoming,
      },
      entries: Array.isArray(incoming.entries) ? incoming.entries : existing.entries,
    };
    const saved = await saveMunicipalContactsSettings(merged);
    return res.json({
      message: 'Kommunale Ansprechpartner gespeichert.',
      ...saved,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Speichern der kommunalen Ansprechpartner.' });
  }
});

/**
 * GET /api/admin/config/smtp
 * SMTP-Konfiguration abrufen
 */
router.get('/config/smtp', adminOnly, async (req: Request, res: Response) => {
  try {
    const allowed = await requireGlobalEmailSettingsAccess(req, res);
    if (!allowed) return;
    const { values, sources } = await loadSmtpSettings(true);
    res.json({ ...values, sources });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Abrufen der SMTP-Config' });
  }
});

/**
 * PATCH /api/admin/config/smtp
 * SMTP-Konfiguration aktualisieren
 */
router.patch('/config/smtp', adminOnly, async (req: Request, res: Response) => {
  try {
    const allowed = await requireGlobalEmailSettingsAccess(req, res);
    if (!allowed) return;
    const {
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassword,
      smtpFromEmail,
      smtpFromName,
    } = req.body;

    const { values: existing } = await loadSmtpSettings(false);
    const nextConfig = {
      smtpHost: smtpHost || existing.smtpHost,
      smtpPort: smtpPort ? smtpPort.toString() : existing.smtpPort,
      smtpUser: smtpUser || existing.smtpUser,
      smtpPassword:
        smtpPassword === '***'
          ? existing.smtpPassword
          : typeof smtpPassword === 'string'
          ? smtpPassword
          : existing.smtpPassword,
      smtpFromEmail: smtpFromEmail || existing.smtpFromEmail,
      smtpFromName: smtpFromName || existing.smtpFromName,
    };

    if (!nextConfig.smtpHost || !nextConfig.smtpPort || !nextConfig.smtpUser || !nextConfig.smtpFromEmail) {
      return res.status(400).json({
        message: 'Host, Port, Benutzer und From-Email sind erforderlich',
      });
    }

    await setSetting('smtp', nextConfig);

    // Update environment variables (fallback)
    process.env.SMTP_HOST = nextConfig.smtpHost;
    process.env.SMTP_PORT = nextConfig.smtpPort;
    process.env.SMTP_USER = nextConfig.smtpUser;
    if (nextConfig.smtpPassword) {
      process.env.SMTP_PASSWORD = nextConfig.smtpPassword;
    }
    process.env.SMTP_FROM_EMAIL = nextConfig.smtpFromEmail;
    process.env.SMTP_FROM_NAME = nextConfig.smtpFromName || 'OI App';

    res.json({
      message: 'SMTP-Konfiguration aktualisiert',
    });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Aktualisieren der SMTP-Config' });
  }
});

/**
 * GET /api/admin/config/imap
 * IMAP-Konfiguration abrufen
 */
router.get('/config/imap', adminOnly, async (_req: Request, res: Response) => {
  try {
    const allowed = await requireGlobalEmailSettingsAccess(_req, res);
    if (!allowed) return;
    const { values, sources } = await loadImapSettings(true);
    return res.json({ ...values, sources });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Abrufen der IMAP-Config' });
  }
});

/**
 * PATCH /api/admin/config/imap
 * IMAP-Konfiguration aktualisieren
 */
router.patch('/config/imap', adminOnly, async (req: Request, res: Response) => {
  try {
    const allowed = await requireGlobalEmailSettingsAccess(req, res);
    if (!allowed) return;
    const {
      enabled,
      imapHost,
      imapPort,
      imapSecure,
      imapUser,
      imapPassword,
      imapMailbox,
      syncLimit,
      syncIntervalMinutes,
    } = req.body || {};

    const { values: existing } = await loadImapSettings(false);
    const nextConfig = {
      enabled: typeof enabled === 'boolean' ? enabled : existing.enabled,
      imapHost: typeof imapHost === 'string' ? imapHost.trim() : existing.imapHost,
      imapPort:
        imapPort !== undefined && imapPort !== null && String(imapPort).trim()
          ? String(imapPort).trim()
          : existing.imapPort,
      imapSecure: typeof imapSecure === 'boolean' ? imapSecure : existing.imapSecure,
      imapUser: typeof imapUser === 'string' ? imapUser.trim() : existing.imapUser,
      imapPassword:
        imapPassword === '***'
          ? existing.imapPassword
          : typeof imapPassword === 'string'
          ? imapPassword
          : existing.imapPassword,
      imapMailbox:
        typeof imapMailbox === 'string' && imapMailbox.trim() ? imapMailbox.trim() : existing.imapMailbox,
      syncLimit: Number.isFinite(Number(syncLimit))
        ? Math.max(1, Math.min(500, Math.floor(Number(syncLimit))))
        : existing.syncLimit,
      syncIntervalMinutes: Number.isFinite(Number(syncIntervalMinutes))
        ? Math.max(1, Math.min(1440, Math.floor(Number(syncIntervalMinutes))))
        : existing.syncIntervalMinutes,
    };

    if (nextConfig.enabled && (!nextConfig.imapHost || !nextConfig.imapUser || !nextConfig.imapPassword)) {
      return res.status(400).json({
        message: 'Für aktiviertes IMAP sind Host, Benutzer und Passwort erforderlich',
      });
    }

    await setSetting('imap', nextConfig);

    process.env.IMAP_ENABLED = nextConfig.enabled ? 'true' : 'false';
    process.env.IMAP_HOST = nextConfig.imapHost || '';
    process.env.IMAP_PORT = nextConfig.imapPort || '993';
    process.env.IMAP_SECURE = nextConfig.imapSecure ? 'true' : 'false';
    process.env.IMAP_USER = nextConfig.imapUser || '';
    if (nextConfig.imapPassword) process.env.IMAP_PASSWORD = nextConfig.imapPassword;
    process.env.IMAP_MAILBOX = nextConfig.imapMailbox || 'INBOX';
    process.env.IMAP_SYNC_LIMIT = String(nextConfig.syncLimit || 80);
    process.env.IMAP_SYNC_INTERVAL_MINUTES = String(nextConfig.syncIntervalMinutes || 2);

    return res.json({
      message: 'IMAP-Konfiguration aktualisiert',
    });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Aktualisieren der IMAP-Config' });
  }
});

/**
 * GET /api/admin/tenants/:tenantId/config/smtp
 * Tenant-spezifische SMTP-Konfiguration (effektive Werte) abrufen
 */
router.get('/tenants/:tenantId/config/smtp', adminOnly, async (req: Request, res: Response) => {
  try {
    const tenantId = normalizeText(req.params?.tenantId);
    const allowed = await requireTenantEmailSettingsAccess(req, res, tenantId);
    if (!allowed) return;
    const { values, sources } = await loadSmtpSettingsForTenant(tenantId, true);
    return res.json({
      tenantId,
      ...values,
      sources,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der tenant-spezifischen SMTP-Config',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/admin/tenants/:tenantId/config/smtp
 * Tenant-spezifische SMTP-Konfiguration speichern
 */
router.patch('/tenants/:tenantId/config/smtp', adminOnly, async (req: Request, res: Response) => {
  try {
    const tenantId = normalizeText(req.params?.tenantId);
    const allowed = await requireTenantEmailSettingsAccess(req, res, tenantId);
    if (!allowed) return;

    const {
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassword,
      smtpFromEmail,
      smtpFromName,
    } = req.body || {};

    const { values: existing } = await loadSmtpSettingsForTenant(tenantId, false);
    const nextConfig = {
      smtpHost: normalizeText(smtpHost) || existing.smtpHost,
      smtpPort: normalizeText(smtpPort) || existing.smtpPort,
      smtpUser: normalizeText(smtpUser) || existing.smtpUser,
      smtpPassword:
        smtpPassword === '***'
          ? existing.smtpPassword
          : typeof smtpPassword === 'string'
          ? smtpPassword
          : existing.smtpPassword,
      smtpFromEmail: normalizeText(smtpFromEmail) || existing.smtpFromEmail,
      smtpFromName: normalizeText(smtpFromName) || existing.smtpFromName,
    };

    if (!nextConfig.smtpHost || !nextConfig.smtpPort || !nextConfig.smtpUser || !nextConfig.smtpFromEmail) {
      return res.status(400).json({
        message: 'Host, Port, Benutzer und From-Email sind erforderlich',
      });
    }

    await saveTenantSmtpSettings(tenantId, nextConfig, normalizeText(req.userId) || null);
    return res.json({ message: 'Tenant-SMTP-Konfiguration aktualisiert.' });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Speichern der tenant-spezifischen SMTP-Config',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/tenants/:tenantId/config/imap
 * Tenant-spezifische IMAP-Konfiguration (effektive Werte) abrufen
 */
router.get('/tenants/:tenantId/config/imap', adminOnly, async (req: Request, res: Response) => {
  try {
    const tenantId = normalizeText(req.params?.tenantId);
    const allowed = await requireTenantEmailSettingsAccess(req, res, tenantId);
    if (!allowed) return;
    const { values, sources } = await loadImapSettingsForTenant(tenantId, true);
    return res.json({
      tenantId,
      ...values,
      sources,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der tenant-spezifischen IMAP-Config',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/admin/tenants/:tenantId/config/imap
 * Tenant-spezifische IMAP-Konfiguration speichern
 */
router.patch('/tenants/:tenantId/config/imap', adminOnly, async (req: Request, res: Response) => {
  try {
    const tenantId = normalizeText(req.params?.tenantId);
    const allowed = await requireTenantEmailSettingsAccess(req, res, tenantId);
    if (!allowed) return;

    const {
      enabled,
      imapHost,
      imapPort,
      imapSecure,
      imapUser,
      imapPassword,
      imapMailbox,
      syncLimit,
      syncIntervalMinutes,
    } = req.body || {};

    const { values: existing } = await loadImapSettingsForTenant(tenantId, false);
    const nextConfig = {
      enabled: typeof enabled === 'boolean' ? enabled : existing.enabled,
      imapHost: typeof imapHost === 'string' ? imapHost.trim() : existing.imapHost,
      imapPort:
        imapPort !== undefined && imapPort !== null && String(imapPort).trim()
          ? String(imapPort).trim()
          : existing.imapPort,
      imapSecure: typeof imapSecure === 'boolean' ? imapSecure : existing.imapSecure,
      imapUser: typeof imapUser === 'string' ? imapUser.trim() : existing.imapUser,
      imapPassword:
        imapPassword === '***'
          ? existing.imapPassword
          : typeof imapPassword === 'string'
          ? imapPassword
          : existing.imapPassword,
      imapMailbox:
        typeof imapMailbox === 'string' && imapMailbox.trim() ? imapMailbox.trim() : existing.imapMailbox,
      syncLimit: Number.isFinite(Number(syncLimit))
        ? Math.max(1, Math.min(500, Math.floor(Number(syncLimit))))
        : existing.syncLimit,
      syncIntervalMinutes: Number.isFinite(Number(syncIntervalMinutes))
        ? Math.max(1, Math.min(1440, Math.floor(Number(syncIntervalMinutes))))
        : existing.syncIntervalMinutes,
    };

    if (nextConfig.enabled && (!nextConfig.imapHost || !nextConfig.imapUser || !nextConfig.imapPassword)) {
      return res.status(400).json({
        message: 'Für aktiviertes IMAP sind Host, Benutzer und Passwort erforderlich',
      });
    }

    await saveTenantImapSettings(tenantId, nextConfig, normalizeText(req.userId) || null);
    return res.json({ message: 'Tenant-IMAP-Konfiguration aktualisiert.' });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Speichern der tenant-spezifischen IMAP-Config',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/tenants/:tenantId/config/email/effective
 * Effektive SMTP/IMAP-Konfiguration eines Mandanten inkl. Quellen
 */
router.get('/tenants/:tenantId/config/email/effective', adminOnly, async (req: Request, res: Response) => {
  try {
    const tenantId = normalizeText(req.params?.tenantId);
    const allowed = await requireTenantEmailSettingsAccess(req, res, tenantId);
    if (!allowed) return;
    const payload = await loadTenantEffectiveEmailSettings(tenantId, true);
    return res.json(payload);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der effektiven Tenant-E-Mail-Konfiguration',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/llm/connections
 * Liste aller OpenAI-kompatiblen LLM-Verbindungen
 */
router.get('/llm/connections', adminOnly, async (req: Request, res: Response) => {
  try {
    const maskSecrets = String(req.query?.maskSecrets || 'true').trim().toLowerCase() !== 'false';
    const connections = await listLlmConnections(maskSecrets);
    return res.json({ items: connections });
  } catch (error: any) {
    return res.status(500).json({ message: 'LLM-Verbindungen konnten nicht geladen werden.', error: error?.message || String(error) });
  }
});

/**
 * POST /api/admin/llm/connections
 * Neue LLM-Verbindung anlegen
 */
router.post('/llm/connections', adminOnly, async (req: Request, res: Response) => {
  try {
    const connection = await upsertLlmConnection(sanitizeConnectionInput(req.body));
    const masked = { ...connection, apiKey: connection.apiKey ? '***' : '' };
    return res.status(201).json({ item: masked, message: 'LLM-Verbindung erstellt.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'LLM-Verbindung konnte nicht erstellt werden.', error: error?.message || String(error) });
  }
});

/**
 * PATCH /api/admin/llm/connections/:id
 * LLM-Verbindung aktualisieren
 */
router.patch('/llm/connections/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'connection id fehlt.' });
    }
    const connection = await upsertLlmConnection({
      ...sanitizeConnectionInput(req.body),
      id,
    });
    const masked = { ...connection, apiKey: connection.apiKey ? '***' : '' };
    return res.json({ item: masked, message: 'LLM-Verbindung gespeichert.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'LLM-Verbindung konnte nicht gespeichert werden.', error: error?.message || String(error) });
  }
});

/**
 * DELETE /api/admin/llm/connections/:id
 * LLM-Verbindung löschen
 */
router.delete('/llm/connections/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'connection id fehlt.' });
    }
    const deleted = await deleteLlmConnection(id);
    if (!deleted) {
      return res.status(404).json({ message: 'LLM-Verbindung nicht gefunden.' });
    }
    return res.json({ message: 'LLM-Verbindung gelöscht.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'LLM-Verbindung konnte nicht gelöscht werden.', error: error?.message || String(error) });
  }
});

/**
 * GET /api/admin/llm/connections/:id/models
 * Modelle einer Verbindung laden (mit Cache)
 */
router.get('/llm/connections/:id/models', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ message: 'connection id fehlt.' });
    const refresh = String(req.query?.refresh || '').trim().toLowerCase() === 'true';
    const visionOnly = String(req.query?.visionOnly || '').trim().toLowerCase() === 'true';
    const requireTts = String(req.query?.requireTts || '').trim().toLowerCase() === 'true';
    const requireImageGeneration = String(req.query?.requireImageGeneration || '').trim().toLowerCase() === 'true';
    const models = await getConnectionModels(id, { refresh });
    const filtered = models.filter((entry) =>
      modelMatchesCapabilityFilter(entry, {
        requireVision: visionOnly,
        requireTts,
        requireImageGeneration,
      })
    );
    return res.json({ items: filtered, refreshed: refresh });
  } catch (error: any) {
    return res.status(500).json({ message: 'Modelle konnten nicht geladen werden.', error: error?.message || String(error) });
  }
});

/**
 * POST /api/admin/llm/connections/:id/models/refresh
 * Modellliste einer Verbindung aktiv aktualisieren
 */
router.post('/llm/connections/:id/models/refresh', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ message: 'connection id fehlt.' });
    const models = await getConnectionModels(id, { refresh: true });
    return res.json({ items: models, refreshed: true, message: 'Modelle aktualisiert.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Modell-Refresh fehlgeschlagen.', error: error?.message || String(error) });
  }
});

/**
 * GET /api/admin/llm/task-routing
 * Task -> Provider/Modell Routen laden
 */
router.get('/llm/task-routing', adminOnly, async (_req: Request, res: Response) => {
  try {
    const routing = await loadLlmTaskRouting();
    return res.json({
      routing,
      tasks: Object.entries(LLM_TASK_CAPABILITIES).map(([taskKey, meta]) => ({
        taskKey,
        requiresVision: meta.requiresVision,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Task-Routing konnte nicht geladen werden.', error: error?.message || String(error) });
  }
});

/**
 * PATCH /api/admin/llm/task-routing
 * Task -> Provider/Modell Routen speichern
 */
router.patch('/llm/task-routing', adminOnly, async (req: Request, res: Response) => {
  try {
    const routing = await saveLlmTaskRouting(req.body?.routing ?? req.body);
    return res.json({ routing, message: 'Task-Routing gespeichert.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Task-Routing konnte nicht gespeichert werden.', error: error?.message || String(error) });
  }
});

/**
 * GET /api/admin/llm/chatbot-settings
 * Persönliche Assistenz-Chatbot-Konfiguration laden
 */
router.get('/llm/chatbot-settings', adminOnly, async (_req: Request, res: Response) => {
  try {
    const settings = await loadLlmChatbotSettings();
    return res.json({
      settings,
      contextOptions: [
        { key: 'adminProfile', label: 'Eigenes Profil (Name, Rolle)' },
        { key: 'accessScopes', label: 'Mandanten- und Orga-Scopes' },
        { key: 'recentTickets', label: 'Aktuelle Tickets (kompakt)' },
        { key: 'openNotifications', label: 'Offene Admin-Benachrichtigungen' },
        { key: 'aiQueueSummary', label: 'KI-Queue Überblick' },
      ],
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Chatbot-Einstellungen konnten nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/admin/llm/chatbot-settings
 * Persönliche Assistenz-Chatbot-Konfiguration speichern
 */
router.patch('/llm/chatbot-settings', adminOnly, async (req: Request, res: Response) => {
  try {
    const settings = await saveLlmChatbotSettings(sanitizeChatbotSettingsInput(req.body));
    return res.json({
      settings,
      message: 'Chatbot-Einstellungen gespeichert.',
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Chatbot-Einstellungen konnten nicht gespeichert werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/config/ai/credentials
 * Liefert maskierte KI-Credentials (nur ADMIN)
 */
router.get('/config/ai/credentials', adminOnly, async (req: Request, res: Response) => {
  try {
    const { values, sources } = await loadAiCredentials(true);
    const askCodiConnection = await resolveLegacyProviderConnection('askcodi');
    res.json({
      ...values,
      askcodiApiKey: askCodiConnection?.apiKey ? '***' : values.askcodiApiKey,
      askcodiBaseUrl: askCodiConnection?.baseUrl || values.askcodiBaseUrl,
      sources,
    });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Abrufen der KI-Credentials' });
  }
});

/**
 * PATCH /api/admin/config/ai/credentials
 * Setze/aktualisiere KI-Credentials zur Laufzeit (nur ADMIN)
 */
router.patch('/config/ai/credentials', adminOnly, async (req: Request, res: Response) => {
  try {
    const { openaiClientId, openaiClientSecret, askcodiApiKey, askcodiBaseUrl } = req.body;

    const { values: existing } = await loadAiCredentials(false);
    const nextConfig = {
      openaiClientId: typeof openaiClientId === 'string' ? openaiClientId : existing.openaiClientId,
      openaiClientSecret:
        openaiClientSecret === '***'
          ? existing.openaiClientSecret
          : typeof openaiClientSecret === 'string'
          ? openaiClientSecret
          : existing.openaiClientSecret,
      askcodiApiKey:
        askcodiApiKey === '***'
          ? existing.askcodiApiKey
          : typeof askcodiApiKey === 'string'
          ? askcodiApiKey
          : existing.askcodiApiKey,
      askcodiBaseUrl: typeof askcodiBaseUrl === 'string' ? askcodiBaseUrl : existing.askcodiBaseUrl,
    };

    await setSetting('aiCredentials', nextConfig);

    if (nextConfig.askcodiBaseUrl || nextConfig.askcodiApiKey) {
      await upsertLlmConnection({
        id: 'legacy-askcodi',
        name: 'Legacy AskCodi',
        baseUrl: nextConfig.askcodiBaseUrl || 'https://api.askcodi.com/v1',
        authMode: 'api_key',
        apiKey: nextConfig.askcodiApiKey || '',
        enabled: true,
      });
    }

    // Update environment variables (fallback)
    if (nextConfig.openaiClientId) process.env.OPENAI_CLIENT_ID = nextConfig.openaiClientId;
    if (nextConfig.openaiClientSecret) process.env.OPENAI_CLIENT_SECRET = nextConfig.openaiClientSecret;
    if (nextConfig.askcodiApiKey) process.env.ASKCODI_API_KEY = nextConfig.askcodiApiKey;
    if (nextConfig.askcodiBaseUrl) process.env.ASKCODI_BASE_URL = nextConfig.askcodiBaseUrl;

    res.json({ message: 'KI-Credentials aktualisiert' });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Aktualisieren der KI-Credentials' });
  }
});

/**
 * GET /api/admin/config/ai
 * Abrufen der aktuellen KI-Provider-Konfiguration
 */
router.get('/config/ai', adminOnly, async (req: Request, res: Response) => {
  try {
    const { values: aiConfig, sources } = await loadAiSettings();
    const routing = await loadLlmTaskRouting();
    const connections = await listLlmConnections(false);
    const defaultConnection = connections.find((entry) => entry.id === routing.defaultRoute.connectionId) || connections[0];
    const inferredProvider = defaultConnection
      ? inferLegacyProviderFromConnection(defaultConnection)
      : aiConfig.provider;
    const resolvedModel = String(routing.defaultRoute.modelId || aiConfig.model || defaultConnection?.defaultModel || '').trim();
    const openAiConnection = await resolveLegacyProviderConnection('openai');
    const askCodiConnection = await resolveLegacyProviderConnection('askcodi');
    const [openaiModels, askcodiModels] = await Promise.all([
      openAiConnection ? getConnectionModels(openAiConnection.id, { refresh: false }) : Promise.resolve([]),
      askCodiConnection ? getConnectionModels(askCodiConnection.id, { refresh: false }) : Promise.resolve([]),
    ]);

    return res.json({
      provider: inferredProvider,
      model: resolvedModel || aiConfig.model,
      availableProviders: ['openai', 'askcodi'],
      availableModels: {
        openai:
          openaiModels.length > 0
            ? openaiModels.map((entry) => entry.id)
            : ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1-mini'],
        askcodi:
          askcodiModels.length > 0
            ? askcodiModels.map((entry) => entry.id)
            : ['openai/gpt-5-mini', 'openai/gpt-4o-mini'],
      },
      sources,
    });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Abrufen der KI-Konfiguration' });
  }
});

/**
 * PATCH /api/admin/config/ai
 * Wechseln des KI-Providers und Modells
 */
router.patch('/config/ai', adminOnly, async (req: Request, res: Response) => {
  try {
    const { provider, model } = req.body;

    if (!provider || !model) {
      return res.status(400).json({
        message: 'Provider und Model sind erforderlich',
      });
    }

    const normalizedProvider = provider === 'askcodi' ? 'askcodi' : 'openai';
    const connection = await resolveLegacyProviderConnection(normalizedProvider);
    if (!connection) {
      return res.status(400).json({
        message: `Für Provider "${normalizedProvider}" ist keine LLM-Verbindung hinterlegt.`,
      });
    }

    const currentRouting = await loadLlmTaskRouting();
    const nextRouting = {
      ...currentRouting,
      defaultRoute: {
        connectionId: connection.id,
        modelId: String(model || '').trim(),
      },
    };
    await saveLlmTaskRouting(nextRouting);
    await setSetting('ai', { provider: normalizedProvider, model: String(model || '').trim() });
    process.env.AI_PROVIDER = normalizedProvider;
    process.env.AI_MODEL = String(model || '').trim();

    return res.json({
      message: `KI-Provider zu ${normalizedProvider} mit Modell ${model} gewechselt`,
      provider: normalizedProvider,
      model: String(model || '').trim(),
    });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Aktualisieren der KI-Konfiguration' });
  }
});

/**
 * GET /api/admin/config/ai/memory
 * Analyse-Memory Einstellungen + letzte Einträge
 */
router.get('/config/ai/memory', adminOnly, async (_req: Request, res: Response) => {
  try {
    if (!(await requirePlatformAiSettingsAccess(_req, res))) return;
    const { values, sources } = await loadAiAnalysisMemorySettings();
    await cleanupAnalysisMemory(values.retentionDays);
    const db = getDatabase();
    const rows = await db.all(
      `SELECT *
       FROM ai_analysis_memory
       ORDER BY datetime(created_at) DESC
       LIMIT 120`
    );
    return res.json({
      settings: values,
      sources,
      entries: (rows || []).map((row: any) => normalizeAnalysisMemoryRecord(row)),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Analyse-Memory konnte nicht geladen werden.' });
  }
});

/**
 * PATCH /api/admin/config/ai/memory
 * Analyse-Memory Einstellungen speichern
 */
router.patch('/config/ai/memory', adminOnly, async (req: Request, res: Response) => {
  try {
    if (!(await requirePlatformAiSettingsAccess(req, res))) return;
    const incoming = req.body && typeof req.body === 'object' ? (req.body as Record<string, any>) : {};
    const { values: current } = await loadAiAnalysisMemorySettings();
    const next = {
      enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : current.enabled,
      includeInPrompts:
        typeof incoming.includeInPrompts === 'boolean' ? incoming.includeInPrompts : current.includeInPrompts,
      autoPersist: typeof incoming.autoPersist === 'boolean' ? incoming.autoPersist : current.autoPersist,
      maxContextEntries: Number.isFinite(Number(incoming.maxContextEntries))
        ? Math.max(1, Math.min(40, Math.floor(Number(incoming.maxContextEntries))))
        : current.maxContextEntries,
      maxContextChars: Number.isFinite(Number(incoming.maxContextChars))
        ? Math.max(400, Math.min(60000, Math.floor(Number(incoming.maxContextChars))))
        : current.maxContextChars,
      retentionDays: Number.isFinite(Number(incoming.retentionDays))
        ? Math.max(1, Math.min(3650, Math.floor(Number(incoming.retentionDays))))
        : current.retentionDays,
      additionalInstruction:
        typeof incoming.additionalInstruction === 'string'
          ? incoming.additionalInstruction.trim()
          : current.additionalInstruction,
      maxAutoSummaryChars: Number.isFinite(Number(incoming.maxAutoSummaryChars))
        ? Math.max(200, Math.min(4000, Math.floor(Number(incoming.maxAutoSummaryChars))))
        : current.maxAutoSummaryChars,
    };
    await setSetting('aiAnalysisMemory', next);
    await cleanupAnalysisMemory(next.retentionDays);
    return res.json({ settings: next, message: 'Analyse-Memory gespeichert.' });
  } catch (error) {
    return res.status(500).json({ message: 'Analyse-Memory konnte nicht gespeichert werden.' });
  }
});

/**
 * POST /api/admin/config/ai/memory/entries
 * Manuellen Memory-Eintrag anlegen
 */
router.post('/config/ai/memory/entries', adminOnly, async (req: Request, res: Response) => {
  try {
    if (!(await requirePlatformAiSettingsAccess(req, res))) return;
    const summary = String(req.body?.summary || '').trim();
    if (!summary) {
      return res.status(400).json({ message: 'summary ist erforderlich.' });
    }
    const scopeKey = String(req.body?.scopeKey || '').trim() || 'situation-report-stable';
    const reportType = normalizeSituationReportType(req.body?.reportType, 'free_analysis');
    const promptInstruction = String(req.body?.promptInstruction || '').trim();
    const confidence = Number(req.body?.confidence);
    const details =
      req.body?.details && typeof req.body.details === 'object' && !Array.isArray(req.body.details)
        ? (req.body.details as Record<string, any>)
        : null;
    const entry = await insertAnalysisMemoryEntry({
      scopeKey,
      reportType,
      source: 'manual',
      summary,
      details,
      promptInstruction: promptInstruction || null,
      confidence: Number.isFinite(confidence) ? confidence : null,
      reportId: typeof req.body?.reportId === 'string' ? req.body.reportId.trim() : null,
      createdByAdminId: req.userId || null,
    });
    return res.json({ entry, message: 'Memory-Eintrag erstellt.' });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Memory-Eintrag konnte nicht erstellt werden.' });
  }
});

/**
 * POST /api/admin/config/ai/memory/compress-history
 * Verdichtet historische Analyse-Läufe per Prompt in einen neuen Memory-Eintrag
 */
router.post('/config/ai/memory/compress-history', adminOnly, async (req: Request, res: Response) => {
  try {
    if (!(await requirePlatformAiSettingsAccess(req, res))) return;
    const scopeKey = String(req.body?.scopeKey || '').trim() || 'situation-report-stable';
    const reportTypeFilter = normalizeOptionalSituationReportTypeFilter(req.body?.reportType);
    const days = sanitizeInteger(req.body?.days, 180, 1, 3650);
    const maxReports = sanitizeInteger(req.body?.maxReports, 14, 2, 80);
    const promptInstruction = String(req.body?.promptInstruction || '').trim();

    const memorySettings = await loadAnalysisMemorySettings();
    await cleanupAnalysisMemory(memorySettings.retentionDays);

    const db = getDatabase();
    const params: any[] = [scopeKey, `-${days} days`];
    let query = `
      SELECT id, report_type, scope_key, created_at, result_json
      FROM ai_situation_reports
      WHERE status = 'completed'
        AND scope_key = ?
        AND datetime(created_at) >= datetime('now', ?)
    `;
    if (reportTypeFilter) {
      query += ' AND report_type = ?';
      params.push(reportTypeFilter);
    }
    query += ' ORDER BY datetime(created_at) DESC LIMIT ?';
    params.push(maxReports);

    const rows = await db.all(query, params);
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({
        message: 'Keine historischen Analysen für die Verdichtung gefunden.',
      });
    }

    const compactReports = (rows || [])
      .map((row: any) => {
        const reportId = String(row?.id || '').trim();
        if (!reportId) return null;
        const result = parseJsonIfPossible(row?.result_json) || {};
        const reportType = normalizeSituationReportType(row?.report_type || result?.reportType, 'operations');
        const parsed = result?.ai?.dePseudonymizedParsed || result?.ai?.parsed || {};
        const summarySource =
          String(parsed?.summary || parsed?.categoryWorkflowSummary || parsed?.answer || result?.summary || '').trim();
        return {
          reportId,
          reportType,
          reportTypeLabel: resolveSituationReportTypeLabel(reportType),
          generatedAt: row?.created_at || result?.generatedAt || null,
          scopeKey: String(row?.scope_key || result?.scopeKey || '').trim() || scopeKey,
          ticketCount: Number(result?.ticketCount || 0),
          analysisQuestion: String(result?.analysisQuestion || '').trim() || null,
          summary: compactText(summarySource, 560),
          keyFindings: toStringList(parsed?.keyFindings || parsed?.riskSignals || parsed?.lifecycleRisks).slice(0, 8),
          recommendedActions: toStringList(
            parsed?.recommendedActions || parsed?.immediateActions || parsed?.operationalRecommendations
          ).slice(0, 8),
          reporterRisks: toStringList(parsed?.reporterRisks).slice(0, 6),
        };
      })
      .filter(Boolean) as Array<Record<string, any>>;

    if (compactReports.length === 0) {
      return res.status(404).json({
        message: 'Keine auswertbaren historischen Analysen für die Verdichtung gefunden.',
      });
    }

    const memoryContextEntries = memorySettings.enabled && memorySettings.includeInPrompts
      ? await loadRecentAnalysisMemory({
          scopeKey,
          reportType: reportTypeFilter || 'operations',
          includeCrossType: true,
          settings: memorySettings,
        })
      : [];
    const memoryContextPrompt = buildAnalysisMemoryPromptContext(
      memoryContextEntries,
      Math.min(memorySettings.maxContextChars, 5000)
    );
    const memoryCompressionPromptBase = await getSystemPrompt('aiSituationMemoryCompressionPrompt');
    const fallbackSummary = buildHistoryMemoryFallbackSummary({
      reportType: reportTypeFilter,
      scopeKey,
      compactReports,
    });

    const historyCompressionPrompt = `${memoryCompressionPromptBase}

AUFGABE:
- Verdichte mehrere historische Analysen zu einem stabilen Langzeit-Memory.
- Priorisiere wiederkehrende Muster, belastbare Risiken und Maßnahmen mit hoher Wirkung.
- Markiere Unsicherheiten als offene Fragen statt als Fakten.
- Antworte nur als JSON im bekannten Format.

Scope-Key: ${scopeKey}
Berichtstyp-Filter: ${reportTypeFilter ? resolveSituationReportTypeLabel(reportTypeFilter) : 'Alle'}
Historische Reports: ${compactReports.length}
Zeitraum: letzte ${days} Tage

Zusatzanweisung:
${promptInstruction || memorySettings.additionalInstruction || 'Keine'}

Bestehender Memory-Kontext:
${memoryContextPrompt}

Historische Analyse-Zusammenfassungen (kompakt JSON):
${JSON.stringify(compactReports, null, 2)}
`.trim();

    const compressedRaw = await testAIProvider(historyCompressionPrompt, {
      purpose: 'admin_situation_report_memory_history_compression',
      waitTimeoutMs: 10 * 60 * 1000,
      meta: {
        source: 'routes.admin.config.ai.memory.compress_history',
        scopeKey,
        reportType: reportTypeFilter || 'all',
        days,
        maxReports: compactReports.length,
      },
    });
    const compressedParsed = extractJsonFromAiText(compressedRaw) || {};
    const summaryRaw = String(compressedParsed?.summary || '').trim() || fallbackSummary;
    const confidenceRaw = Number(compressedParsed?.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : null;
    const summary = summaryRaw.slice(0, memorySettings.maxAutoSummaryChars);

    const entry = await insertAnalysisMemoryEntry({
      scopeKey,
      reportType: reportTypeFilter || 'operations',
      source: 'manual',
      summary,
      promptInstruction: promptInstruction || null,
      confidence,
      createdByAdminId: req.userId || null,
      details: {
        mode: 'history_compression',
        days,
        reportTypeFilter: reportTypeFilter || 'all',
        sourceReportCount: compactReports.length,
        sourceReportIds: compactReports.map((entry) => entry.reportId).slice(0, 80),
        signals: toStringList(compressedParsed?.signals).slice(0, 12),
        openQuestions: toStringList(compressedParsed?.openQuestions).slice(0, 12),
        recommendedFollowUp: toStringList(compressedParsed?.recommendedFollowUp).slice(0, 12),
      },
    });

    return res.json({
      entry,
      usedReports: compactReports.length,
      message: 'Historische Analysen wurden erfolgreich verdichtet.',
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Historische Analysen konnten nicht verdichtet werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * DELETE /api/admin/config/ai/memory/entries/:id
 * Memory-Eintrag löschen
 */
router.delete('/config/ai/memory/entries/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    if (!(await requirePlatformAiSettingsAccess(req, res))) return;
    const memoryId = String(req.params?.id || '').trim();
    if (!memoryId) {
      return res.status(400).json({ message: 'id ist erforderlich.' });
    }
    const db = getDatabase();
    await db.run(`DELETE FROM ai_analysis_memory WHERE id = ?`, [memoryId]);
    return res.json({ message: 'Memory-Eintrag gelöscht.' });
  } catch (error) {
    return res.status(500).json({ message: 'Memory-Eintrag konnte nicht gelöscht werden.' });
  }
});

/**
 * GET /api/admin/config/image-ai
 * Abrufen der separaten Bild-KI-Konfiguration
 */
router.get('/config/image-ai', adminOnly, async (_req: Request, res: Response) => {
  try {
    const { values, sources } = await loadImageAiSettings(false);
    const routing = await loadLlmTaskRouting();
    const imageRoute = routing.routes.image_to_text || routing.defaultRoute;
    const connections = await listLlmConnections(false);
    const connection = connections.find((entry) => entry.id === imageRoute.connectionId) || null;
    const responsePayload = {
      enabled: values.enabled || (connection?.enabled === true),
      model: String(imageRoute.modelId || values.model || '').trim() || values.model,
      apiKey: connection?.apiKey ? '***' : values.apiKey ? '***' : '',
      baseUrl: String(connection?.baseUrl || values.baseUrl || '').trim(),
      prompt: values.prompt,
      detail: values.detail,
      maxTokens: values.maxTokens,
      temperature: values.temperature,
      connectionId: connection?.id || imageRoute.connectionId || '',
      sources,
    };
    return res.json(responsePayload);
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Abrufen der Bild-KI-Konfiguration' });
  }
});

/**
 * PATCH /api/admin/config/image-ai
 * Setzen der separaten Bild-KI-Konfiguration
 */
router.patch('/config/image-ai', adminOnly, async (req: Request, res: Response) => {
  try {
    const {
      enabled,
      model,
      apiKey,
      baseUrl,
      prompt,
      detail,
      maxTokens,
      temperature,
    } = req.body || {};

    const { values: existing } = await loadImageAiSettings(false);
    const currentRouting = await loadLlmTaskRouting();
    const detailRaw = String((detail ?? existing.detail) || '').trim().toLowerCase();
    const normalizedDetail = detailRaw === 'low' || detailRaw === 'high' ? detailRaw : 'auto';
    const normalizedMaxTokens = Number.isFinite(Number(maxTokens))
      ? Math.max(64, Math.min(4000, Math.floor(Number(maxTokens))))
      : existing.maxTokens;
    const normalizedTemperature = Number.isFinite(Number(temperature))
      ? Math.max(0, Math.min(2, Number(temperature)))
      : existing.temperature;
    const nextConfig = {
      enabled: typeof enabled === 'boolean' ? enabled : existing.enabled,
      model: typeof model === 'string' ? model.trim() || existing.model : existing.model,
      apiKey:
        apiKey === '***'
          ? existing.apiKey
          : typeof apiKey === 'string'
          ? apiKey.trim()
          : existing.apiKey,
      baseUrl: typeof baseUrl === 'string' ? baseUrl.trim() || existing.baseUrl : existing.baseUrl,
      prompt: typeof prompt === 'string' ? prompt.trim() || existing.prompt : existing.prompt,
      detail: normalizedDetail,
      maxTokens: normalizedMaxTokens,
      temperature: normalizedTemperature,
    };

    const routeConnectionIdRaw =
      typeof req.body?.connectionId === 'string'
        ? req.body.connectionId
        : currentRouting.routes.image_to_text?.connectionId || currentRouting.defaultRoute.connectionId;
    let routeConnectionId = String(routeConnectionIdRaw || '').trim();
    if (nextConfig.baseUrl || nextConfig.apiKey) {
      const updatedConnection = await upsertLlmConnection({
        id: routeConnectionId || 'legacy-image-ai',
        name: 'Legacy Bild-KI',
        baseUrl: nextConfig.baseUrl || existing.baseUrl,
        authMode: 'api_key',
        apiKey: nextConfig.apiKey || '',
        enabled: nextConfig.enabled !== false,
        defaultModel: nextConfig.model,
      });
      routeConnectionId = updatedConnection.id;
    }

    const nextRouting = {
      ...currentRouting,
      routes: {
        ...currentRouting.routes,
        image_to_text: {
          connectionId: routeConnectionId,
          modelId: nextConfig.model,
        },
      },
    };
    await saveLlmTaskRouting(nextRouting);

    if (typeof prompt === 'string') {
      const { values: systemPrompts } = await loadSystemPrompts();
      const nextSystemPrompts = {
        ...systemPrompts,
        imageAnalysisPrompt: nextConfig.prompt,
      };
      await setSetting('systemPrompts', nextSystemPrompts);
      process.env.IMAGE_ANALYSIS_PROMPT = nextConfig.prompt;
    }

    await setSetting('imageAi', nextConfig);

    process.env.IMAGE_AI_ENABLED = nextConfig.enabled ? 'true' : 'false';
    process.env.IMAGE_AI_MODEL = nextConfig.model;
    process.env.IMAGE_AI_BASE_URL = nextConfig.baseUrl;
    process.env.IMAGE_AI_PROMPT = nextConfig.prompt;
    process.env.IMAGE_AI_DETAIL = nextConfig.detail;
    process.env.IMAGE_AI_MAX_TOKENS = String(nextConfig.maxTokens);
    process.env.IMAGE_AI_TEMPERATURE = String(nextConfig.temperature);
    process.env.IMAGE_AI_API_KEY = nextConfig.apiKey || '';

    return res.json({ message: 'Bild-KI-Konfiguration aktualisiert' });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Aktualisieren der Bild-KI-Konfiguration' });
  }
});

/**
 * GET /api/admin/config/weather-api
 * Abrufen der Wetter-API-Konfiguration
 */
router.get('/config/weather-api', adminOnly, async (_req: Request, res: Response) => {
  try {
    const { values, sources } = await loadWeatherApiSettings(true);
    return res.json({ ...values, sources });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Laden der Wetter-API-Konfiguration' });
  }
});

/**
 * PATCH /api/admin/config/weather-api
 * Speichern der Wetter-API-Konfiguration
 */
router.patch('/config/weather-api', adminOnly, async (req: Request, res: Response) => {
  try {
    const incoming = req.body && typeof req.body === 'object' ? req.body : {};
    const { values: existing } = await loadWeatherApiSettings(false);
    const normalizedCandidate = normalizeWeatherApiSettings(
      {
        ...existing,
        ...incoming,
        apiKey:
          incoming && typeof (incoming as any).apiKey === 'string'
            ? (incoming as any).apiKey === '***'
              ? existing.apiKey
              : (incoming as any).apiKey
            : existing.apiKey,
      },
      existing
    );

    await setSetting('weatherApi', normalizedCandidate);

    process.env.WEATHER_API_ENABLED = normalizedCandidate.enabled ? 'true' : 'false';
    process.env.WEATHER_API_ARCHIVE_BASE_URL = normalizedCandidate.archiveBaseUrl;
    process.env.WEATHER_API_FORECAST_BASE_URL = normalizedCandidate.forecastBaseUrl;
    process.env.WEATHER_API_KEY = normalizedCandidate.apiKey || '';
    process.env.WEATHER_API_KEY_MODE = normalizedCandidate.apiKeyMode;
    process.env.WEATHER_API_KEY_HEADER_NAME = normalizedCandidate.apiKeyHeaderName;
    process.env.WEATHER_API_KEY_QUERY_PARAM = normalizedCandidate.apiKeyQueryParam;
    process.env.WEATHER_API_TIMEOUT_MS = String(normalizedCandidate.timeoutMs);
    process.env.WEATHER_API_USER_AGENT = normalizedCandidate.userAgent;
    process.env.WEATHER_API_TEMPERATURE_UNIT = normalizedCandidate.temperatureUnit;
    process.env.WEATHER_API_WIND_SPEED_UNIT = normalizedCandidate.windSpeedUnit;
    process.env.WEATHER_API_PRECIPITATION_UNIT = normalizedCandidate.precipitationUnit;

    return res.json({ message: 'Wetter-API-Konfiguration gespeichert' });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Speichern der Wetter-API-Konfiguration' });
  }
});

/**
 * POST /api/admin/config/weather-api/test
 * Testet die aktuelle Wetter-API-Konfiguration mit einer Beispielabfrage
 */
router.post('/config/weather-api/test', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const { values: weatherConfig } = await loadWeatherApiSettings(false);
    if (weatherConfig.enabled === false) {
      return res.status(400).json({ message: 'Wetter-API ist deaktiviert.' });
    }

    const latitudeRaw = Number(req.body?.latitude);
    const longitudeRaw = Number(req.body?.longitude);
    const latitude = Number.isFinite(latitudeRaw) ? latitudeRaw : 49.4453;
    const longitude = Number.isFinite(longitudeRaw) ? longitudeRaw : 7.7694;
    const reportedAt =
      typeof req.body?.reportedAt === 'string' && req.body.reportedAt.trim()
        ? req.body.reportedAt
        : new Date().toISOString();
    const address = typeof req.body?.address === 'string' ? req.body.address : '';
    const postalCode = typeof req.body?.postalCode === 'string' ? req.body.postalCode : '';
    const city = typeof req.body?.city === 'string' ? req.body.city : '';

    const enrichment = await enrichGeoAndWeather({
      latitude,
      longitude,
      address,
      postalCode,
      city,
      reportedAt,
    });

    if (!enrichment.weatherReport) {
      return res.status(502).json({
        message: 'Wetterdaten konnten nicht geladen werden. Bitte Konfiguration prüfen.',
        weatherSource: enrichment.weatherSource,
      });
    }

    return res.json({
      message: 'Wetter-API-Test erfolgreich',
      weatherSource: enrichment.weatherSource,
      nominatimSource: enrichment.nominatimSource,
      weatherReport: enrichment.weatherReport,
      nominatimRaw: enrichment.nominatimRaw || null,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Wetter-API-Test fehlgeschlagen',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/feed-tokens/self/:scope
 * Liefert den aktiven Feed-Token des aktuellen Admin-Users für den Scope
 */
router.get('/feed-tokens/self/:scope', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich.' });
    }
    const scope = normalizeFeedScope(req.params?.scope);
    if (!scope) {
      return res.status(400).json({ message: 'Ungültiger Feed-Scope.' });
    }
    const token = await getOwnActiveFeedToken(adminUserId, scope);
    return res.json({
      scope,
      feedPath: resolveFeedPath(scope),
      token,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Feed-Token konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/feed-tokens/self/:scope/rotate
 * Erzeugt einen neuen Feed-Token für den aktuellen Admin-User und widerruft den alten
 */
router.post('/feed-tokens/self/:scope/rotate', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich.' });
    }
    const scope = normalizeFeedScope(req.params?.scope);
    if (!scope) {
      return res.status(400).json({ message: 'Ungültiger Feed-Scope.' });
    }
    const token = await rotateOwnFeedToken({
      adminUserId,
      scope,
      actorAdminUserId: adminUserId,
      revokeReason: 'rotated',
    });
    return res.json({
      message: 'Feed-Token neu erzeugt.',
      scope,
      feedPath: resolveFeedPath(scope),
      token,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Feed-Token konnte nicht erzeugt werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * DELETE /api/admin/feed-tokens/self/:scope
 * Widerruft den aktiven Feed-Token des aktuellen Admin-Users für den Scope
 */
router.delete('/feed-tokens/self/:scope', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich.' });
    }
    const scope = normalizeFeedScope(req.params?.scope);
    if (!scope) {
      return res.status(400).json({ message: 'Ungültiger Feed-Scope.' });
    }
    const result = await revokeOwnFeedToken({
      adminUserId,
      scope,
      actorAdminUserId: adminUserId,
      reason: 'revoked_by_user',
    });
    return res.json({
      message: result.revoked > 0 ? 'Feed-Token widerrufen.' : 'Kein aktiver Feed-Token vorhanden.',
      scope,
      revoked: result.revoked,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Feed-Token konnte nicht widerrufen werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/api-tokens
 * Listet API-Tokens des aktuellen Admin-Users (ohne Klartext-Token)
 */
router.get('/api-tokens', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich.' });
    }

    const statusRaw = String(req.query?.status || 'active').trim().toLowerCase();
    const status: 'active' | 'all' | 'revoked' =
      statusRaw === 'all' ? 'all' : statusRaw === 'revoked' ? 'revoked' : 'active';

    const allItems = await listOwnAdminApiTokens(adminUserId);
    const items =
      status === 'all'
        ? allItems
        : status === 'revoked'
        ? allItems.filter((entry) => !!entry.revokedAt)
        : allItems.filter((entry) => entry.isActive);

    const counts = {
      active: allItems.filter((entry) => entry.isActive).length,
      revoked: allItems.filter((entry) => !!entry.revokedAt).length,
      expired: allItems.filter((entry) => entry.isExpired && !entry.revokedAt).length,
      total: allItems.length,
    };

    return res.json({
      items,
      counts,
      status,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'API-Tokens konnten nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/api-tokens
 * Erzeugt einen neuen API-Token (Klartext wird nur einmal ausgegeben)
 */
router.post('/api-tokens', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich.' });
    }

    const label = typeof req.body?.label === 'string' ? req.body.label : '';
    const expiresAtRaw = req.body?.expiresAt;
    const expiresAtNormalized = expiresAtRaw === null || expiresAtRaw === '' ? null : expiresAtRaw;

    const created = await createOwnAdminApiToken({
      adminUserId,
      actorAdminUserId: adminUserId,
      label,
      expiresAt: expiresAtNormalized,
    });

    return res.status(201).json({
      message: 'API-Token erzeugt.',
      token: created.token,
      item: created.record,
    });
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('ablaufdatum') || message.includes('ungültiges')) {
      return res.status(400).json({ message: error?.message || 'Ungültige Eingabe.' });
    }
    return res.status(500).json({
      message: 'API-Token konnte nicht erzeugt werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/api-tokens/:id/revoke
 * Widerruft einen API-Token des aktuellen Admin-Users
 */
router.post('/api-tokens/:id/revoke', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich.' });
    }
    const tokenId = String(req.params?.id || '').trim();
    if (!tokenId) {
      return res.status(400).json({ message: 'Token-ID fehlt.' });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'revoked_by_user';
    const result = await revokeOwnAdminApiToken({
      adminUserId,
      tokenId,
      actorAdminUserId: adminUserId,
      reason,
    });
    if (result.revoked <= 0) {
      return res.status(404).json({ message: 'Kein aktiver API-Token gefunden.' });
    }
    return res.json({
      message: 'API-Token widerrufen.',
      revoked: result.revoked,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'API-Token konnte nicht widerrufen werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/platform-blog
 * Listet Plattform-Blogposts für den Admin-Editor.
 */
router.get('/platform-blog', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const statusRaw = String(req.query?.status || 'all').trim().toLowerCase();
    const status: 'all' | 'draft' | 'scheduled' | 'published' | 'archived' =
      statusRaw === 'draft' ||
      statusRaw === 'scheduled' ||
      statusRaw === 'published' ||
      statusRaw === 'archived'
        ? statusRaw
        : 'all';
    const search = typeof req.query?.search === 'string' ? req.query.search : '';
    const limitRaw = Number(req.query?.limit);
    const offsetRaw = Number(req.query?.offset);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, Math.floor(limitRaw))) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const result = await listPlatformBlogPosts({
      status,
      search,
      limit,
      offset,
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Plattform-Blog konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/platform-blog/:id
 * Lädt einen Plattform-Blogpost für Bearbeitung/Preview.
 */
router.get('/platform-blog/:id', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'Beitrags-ID fehlt.' });
    }
    const item = await getPlatformBlogPostById(id);
    if (!item) {
      return res.status(404).json({ message: 'Blogbeitrag nicht gefunden.' });
    }
    return res.json({ item });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Blogbeitrag konnte nicht geladen werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/platform-blog
 * Erstellt einen neuen Plattform-Blogpost.
 */
router.post('/platform-blog', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich.' });
    }
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const created = await createPlatformBlogPost(payload, adminUserId);
    return res.status(201).json({
      message: 'Blogbeitrag erstellt.',
      item: created,
    });
  } catch (error: any) {
    const message = String(error?.message || '').trim();
    if (message) {
      return res.status(400).json({ message });
    }
    return res.status(500).json({
      message: 'Blogbeitrag konnte nicht erstellt werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/admin/platform-blog/:id
 * Aktualisiert einen Plattform-Blogpost.
 */
router.patch('/platform-blog/:id', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich.' });
    }
    const id = String(req.params?.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'Beitrags-ID fehlt.' });
    }
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const updated = await updatePlatformBlogPost(id, payload, adminUserId);
    if (!updated) {
      return res.status(404).json({ message: 'Blogbeitrag nicht gefunden.' });
    }
    return res.json({
      message: 'Blogbeitrag aktualisiert.',
      item: updated,
    });
  } catch (error: any) {
    const message = String(error?.message || '').trim();
    if (message) {
      return res.status(400).json({ message });
    }
    return res.status(500).json({
      message: 'Blogbeitrag konnte nicht aktualisiert werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * DELETE /api/admin/platform-blog/:id
 * Löscht einen Plattform-Blogpost.
 */
router.delete('/platform-blog/:id', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const id = String(req.params?.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'Beitrags-ID fehlt.' });
    }
    const result = await deletePlatformBlogPost(id);
    if (result.deleted <= 0) {
      return res.status(404).json({ message: 'Blogbeitrag nicht gefunden.' });
    }
    return res.json({
      message: 'Blogbeitrag gelöscht.',
      deleted: result.deleted,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Blogbeitrag konnte nicht gelöscht werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/ai/situation-report/control
 * Laufzeitsteuerung fuer KI-Lagebild und Pseudonymisierung
 */
router.get('/ai/situation-report/control', adminOnly, async (_req: Request, res: Response): Promise<any> => {
  try {
    await ensureSituationReportAutoLoop();
    const control = await loadSituationReportControlSettings();
    return res.json(control);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der Lagebild-Steuerung',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/admin/ai/situation-report/control
 * Aktualisiert die Laufzeitsteuerung fuer KI-Lagebild und Pseudonymisierung
 */
router.patch('/ai/situation-report/control', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const next = await saveSituationReportControlSettings(req.body && typeof req.body === 'object' ? req.body : {});
    updateSituationReportAutoLoop(next);
    if (next.enabled && next.autoRunEnabled) {
      void runSituationReportAutoCycle('control-save');
    }
    return res.json({
      message: 'Lagebild-Steuerung gespeichert',
      control: next,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Speichern der Lagebild-Steuerung',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/ai/situation-report/feed-token/rotate
 * Erzeugt ein neues Feed-Token fuer den KI-Lagebericht-Atom-Feed
 */
router.post('/ai/situation-report/feed-token/rotate', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const adminUserId = String(req.userId || '').trim();
    if (!adminUserId) {
      return res.status(401).json({ message: 'Authentifizierung erforderlich.' });
    }
    const token = await rotateOwnFeedToken({
      adminUserId,
      scope: 'ai_situation',
      actorAdminUserId: adminUserId,
      revokeReason: 'rotated',
    });
    const control = await loadSituationReportControlSettings();
    return res.json({
      message: 'Feed-Token neu erzeugt.',
      control,
      scope: 'ai_situation',
      feedPath: resolveFeedPath('ai_situation'),
      token,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Erzeugen des Feed-Tokens',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/ai/pseudonym-pools
 * Liefert aktuelle Pseudonym-Pools und Mapping-Statistiken
 */
router.get('/ai/pseudonym-pools', adminOnly, async (_req: Request, res: Response): Promise<any> => {
  try {
    await ensurePseudonymFillLoop();
    const [namePool, emailPool, stats, control, fillControl, previewRows] = await Promise.all([
      loadLatestPseudonymPoolRecord('name'),
      loadLatestPseudonymPoolRecord('email'),
      loadPseudonymMappingStats(),
      loadSituationReportControlSettings(),
      loadPseudonymFillControlSettings(),
      loadPseudonymPreviewRows(300),
    ]);
    const fillProgress = await loadPseudonymFillProgress(fillControl);

    return res.json({
      pools: {
        name: namePool || {
          id: '',
          poolType: 'name',
          version: 0,
          entries: [],
          createdAt: null,
          updatedAt: null,
        },
        email: emailPool || {
          id: '',
          poolType: 'email',
          version: 0,
          entries: [],
          createdAt: null,
          updatedAt: null,
        },
      },
      mappingStats: stats,
      mappingRows: previewRows.mappingRows,
      ticketReporterRows: previewRows.ticketReporterRows,
      control,
      fillControl,
      fillProgress,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der Pseudonym-Pools',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/admin/ai/pseudonym-pools/:poolType
 * Aktualisiert Name/E-Mail-Pool (replace|append)
 */
router.patch('/ai/pseudonym-pools/:poolType', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const poolType = toPseudonymPoolType(req.params.poolType);
    if (!poolType) {
      return res.status(400).json({ message: 'poolType muss "name" oder "email" sein.' });
    }

    const mode = req.body?.mode === 'append' ? 'append' : 'replace';
    const entries = normalizePseudonymEntriesForType(
      req.body?.entriesText ?? req.body?.entries ?? [],
      poolType
    );

    const saved = await savePseudonymPool({
      poolType,
      entries,
      mode,
    });

    return res.json({
      message: `Pseudonym-Pool (${poolType}) gespeichert`,
      pool: saved,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Speichern des Pseudonym-Pools',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/ai/pseudonym-pools/generate
 * Erzeugt Pseudonym-Pools per KI und speichert optional
 */
router.post('/ai/pseudonym-pools/generate', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const nameCount = sanitizeInteger(req.body?.nameCount, 150, 10, 5000);
    const emailCount = sanitizeInteger(req.body?.emailCount, 150, 10, 5000);
    const domainCount = sanitizeInteger(req.body?.domainCount, 12, 1, 200);
    const save = req.body?.save === true;
    const saveMode: 'replace' | 'append' = req.body?.saveMode === 'append' ? 'append' : 'replace';

    const promptBase = await getSystemPrompt('llmPseudonymPoolPrompt');
    const prompt = `${promptBase}

ZIEL:
- Namen: ${nameCount}
- E-Mail-Adressen: ${emailCount}
- Domains: ${domainCount}

Optional darfst du zusaetzlich "emailPool" liefern.
Wenn "emailPool" fehlt, wird aus namePool + emailDomainPool serverseitig ein Pool gebaut.

Regeln:
- emailDomainPool nur als vollstaendige Domains mit TLD (z. B. servicepost.de, kommunalmail.net).
- Keine lokalen/reservierten TLDs: .local, .localhost, .invalid, .test, .example.
`.trim();

    const aiRaw = await testAIProvider(prompt, {
      purpose: 'admin_pseudonym_pool_generation',
      meta: {
        source: 'routes.admin.pseudonym_pool_generate',
        nameCount,
        emailCount,
        domainCount,
      },
    });
    const parsed = extractJsonFromAiText(aiRaw) || {};

    let generatedNames = normalizePseudonymEntriesForType(
      pickPseudonymChunkValue(parsed, ['namePool', 'names', 'name_pool', 'namePseudonyms', 'pseudonymNames']),
      'name'
    );
    if (generatedNames.length < nameCount) {
      while (generatedNames.length < nameCount) {
        generatedNames.push(fallbackPseudoName(generatedNames.length));
      }
    } else {
      generatedNames = generatedNames.slice(0, nameCount);
    }

    const domainPool = normalizeDomainPool(
      pickPseudonymChunkValue(parsed, ['emailDomainPool', 'domains', 'domainPool', 'emailDomains'])
    ).slice(0, domainCount);
    let generatedEmails = normalizePseudonymEntriesForType(
      pickPseudonymChunkValue(parsed, ['emailPool', 'emails', 'email_pool', 'emailPseudonyms', 'pseudonymEmails']),
      'email'
    );
    if (generatedEmails.length < emailCount) {
      generatedEmails = buildGeneratedEmailPool({
        names: generatedNames,
        fallbackDomains: domainPool,
        requestedCount: emailCount,
      });
    } else {
      generatedEmails = generatedEmails.slice(0, emailCount);
    }

    let savedPools: { name?: PseudonymPoolRecord; email?: PseudonymPoolRecord } | null = null;
    if (save) {
      const [savedName, savedEmail] = await Promise.all([
        savePseudonymPool({
          poolType: 'name',
          entries: generatedNames,
          mode: saveMode,
        }),
        savePseudonymPool({
          poolType: 'email',
          entries: generatedEmails,
          mode: saveMode,
        }),
      ]);
      savedPools = { name: savedName, email: savedEmail };
    }

    return res.json({
      generatedAt: new Date().toISOString(),
      generated: {
        names: generatedNames,
        emails: generatedEmails,
        domains: domainPool,
      },
      ai: {
        raw: aiRaw,
        parsed,
      },
      saved: save,
      saveMode,
      pools: savedPools,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Generieren der Pseudonym-Pools',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/ai/pseudonym-fill/control
 * Steuerung fuer chunkweise Hintergrund-Befuellung der Pseudonym-Pools
 */
router.get('/ai/pseudonym-fill/control', adminOnly, async (_req: Request, res: Response): Promise<any> => {
  try {
    await ensurePseudonymFillLoop();
    const control = await loadPseudonymFillControlSettings();
    const progress = await loadPseudonymFillProgress(control);
    return res.json({ control, progress });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der Pseudonym-Fuellsteuerung',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/admin/ai/pseudonym-fill/control
 * Start/Stopp und Parameter fuer die Hintergrund-Befuellung
 */
router.patch('/ai/pseudonym-fill/control', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const next = await savePseudonymFillControlSettings(req.body && typeof req.body === 'object' ? req.body : {});
    updatePseudonymFillLoop(next);
    if (next.enabled && next.running) {
      void runPseudonymFillChunk('manual');
    }
    const progress = await loadPseudonymFillProgress(next);
    return res.json({
      message: 'Pseudonym-Fuellsteuerung gespeichert',
      control: next,
      progress,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Speichern der Pseudonym-Fuellsteuerung',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/ai/pseudonym-fill/run-chunk
 * Fuehrt einen einzelnen Fuell-Lauf sofort aus
 */
router.post('/ai/pseudonym-fill/run-chunk', adminOnly, async (_req: Request, res: Response): Promise<any> => {
  try {
    const result = await runPseudonymFillChunk('manual');
    return res.json({
      message: 'Pseudonym-Fuelllauf ausgefuehrt',
      ...result,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Ausfuehren des Pseudonym-Fuelllaufs',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/ai/pseudonym-mappings/reset
 * Loescht Pseudonym-Mappings (optional gefiltert)
 */
router.post('/ai/pseudonym-mappings/reset', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const scopeKey = typeof req.body?.scopeKey === 'string' ? req.body.scopeKey.trim() : '';
    const entityType = toPseudonymPoolType(req.body?.entityType);
    const expiredOnly = req.body?.expiredOnly === true;

    const whereParts: string[] = [];
    const params: Array<string> = [];
    if (scopeKey) {
      whereParts.push('scope_key = ?');
      params.push(scopeKey);
    }
    if (entityType) {
      whereParts.push('entity_type = ?');
      params.push(entityType);
    }
    if (expiredOnly) {
      whereParts.push(`expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')`);
    }
    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const result = await db.run(`DELETE FROM llm_pseudonym_mappings ${whereClause}`, params);

    const stats = await loadPseudonymMappingStats();
    return res.json({
      deleted: Number(result?.changes || 0),
      scopeKey: scopeKey || null,
      entityType: entityType || null,
      expiredOnly,
      mappingStats: stats,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Loeschen der Pseudonym-Mappings',
      error: error?.message || String(error),
    });
  }
});

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function resolveSuspiciousReporterPatterns(parsed: Record<string, any>): Array<{ reporter: string; score: number; reason: string }> {
  const rawEntries: any[] = [];
  const append = (value: unknown) => {
    if (Array.isArray(value)) rawEntries.push(...value);
  };
  append(parsed?.suspiciousReporterPatterns);
  append(parsed?.stages?.reporters?.suspiciousReporterPatterns);
  append(parsed?.reporterAbuseScores);
  append(parsed?.stages?.reporters?.reporterAbuseScores);
  return rawEntries
    .map((entry) => ({
      reporter: String(entry?.reporter || '').trim(),
      score: Number(entry?.score),
      reason: String(entry?.reason || entry?.explanation || '').trim(),
    }))
    .filter((entry) => entry.reporter && Number.isFinite(entry.score))
    .map((entry) => ({
      ...entry,
      score: Math.max(0, Math.min(1, entry.score)),
    }));
}

function resolveReporterAbuseScores(parsed: Record<string, any>): Array<{
  reporter: string;
  score: number;
  riskLevel: string;
  reason: string;
  signals: string[];
}> {
  const rawEntries: any[] = [];
  const append = (value: unknown) => {
    if (Array.isArray(value)) rawEntries.push(...value);
  };
  append(parsed?.reporterAbuseScores);
  append(parsed?.stages?.reporters?.reporterAbuseScores);

  return rawEntries
    .map((entry) => ({
      reporter: String(entry?.reporter || '').trim(),
      score: Number(entry?.score),
      riskLevel: String(entry?.riskLevel || entry?.risk || '').trim().toLowerCase(),
      reason: String(entry?.reason || entry?.explanation || '').trim(),
      signals: toStringList(entry?.signals),
    }))
    .filter((entry) => entry.reporter && Number.isFinite(entry.score))
    .map((entry) => ({
      ...entry,
      score: Math.max(0, Math.min(1, entry.score)),
      riskLevel:
        entry.riskLevel === 'kritisch' ||
        entry.riskLevel === 'critical' ||
        entry.riskLevel === 'hoch' ||
        entry.riskLevel === 'high' ||
        entry.riskLevel === 'mittel' ||
        entry.riskLevel === 'medium' ||
        entry.riskLevel === 'niedrig' ||
        entry.riskLevel === 'low'
          ? entry.riskLevel
          : '',
    }));
}

function normalizeReporterIdentity(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeDescriptionSignature(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(0, Math.min(1, value));
  return Number(clamped.toFixed(3));
}

function compactText(value: unknown, maxChars = 160): string {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  const limit = Math.max(1, maxChars - 1);
  return `${normalized.slice(0, limit).trimEnd()}…`;
}

interface TicketPromptContextBuildResult {
  json: string;
  totalTickets: number;
  includedTickets: number;
  truncated: boolean;
  descriptionIncluded: boolean;
}

function buildTicketPromptContext(
  tickets: Array<Record<string, any>>,
  options?: {
    maxEntries?: number;
    maxChars?: number;
    descriptionChars?: number;
    locationChars?: number;
  }
): TicketPromptContextBuildResult {
  const totalTickets = Array.isArray(tickets) ? tickets.length : 0;
  const maxEntries = Math.max(10, Math.min(300, Number(options?.maxEntries || 120)));
  const maxChars = Math.max(2500, Math.min(120000, Number(options?.maxChars || 22000)));
  const descriptionChars = Math.max(60, Math.min(600, Number(options?.descriptionChars || 220)));
  const locationChars = Math.max(30, Math.min(220, Number(options?.locationChars || 120)));

  const base = (tickets || []).slice(0, maxEntries);
  const mapTicket = (ticket: Record<string, any>, includeDescription: boolean) => ({
    id: String(ticket?.id || '').trim(),
    category: String(ticket?.category || '').trim(),
    priority: String(ticket?.priority || '').trim(),
    status: String(ticket?.status || '').trim(),
    location: compactText(ticket?.location, locationChars),
    ...(includeDescription
      ? {
          description: compactText(ticket?.description, descriptionChars),
        }
      : {}),
    createdAt: ticket?.createdAt || null,
    updatedAt: ticket?.updatedAt || null,
    lifecycle: {
      ticketAgeHours:
        Number.isFinite(Number(ticket?.lifecycle?.ticketAgeHours)) ? Number(ticket.lifecycle.ticketAgeHours) : null,
      closedCycleHours:
        Number.isFinite(Number(ticket?.lifecycle?.closedCycleHours)) ? Number(ticket.lifecycle.closedCycleHours) : null,
      lastUpdateAgeHours:
        Number.isFinite(Number(ticket?.lifecycle?.lastUpdateAgeHours)) ? Number(ticket.lifecycle.lastUpdateAgeHours) : null,
    },
    reporter: {
      reporterKey: String(ticket?.reporter?.reporterKey || '').trim() || null,
      stablePseudoName: String(ticket?.reporter?.stablePseudoName || '').trim() || null,
      stablePseudoEmail: String(ticket?.reporter?.stablePseudoEmail || '').trim() || null,
      banalHeuristicScore: Number.isFinite(Number(ticket?.reporter?.banalHeuristicScore))
        ? roundScore(Number(ticket.reporter.banalHeuristicScore))
        : null,
      missingLocation: ticket?.reporter?.missingLocation === true,
    },
    workflow: ticket?.workflow
      ? {
          templateId: String(ticket?.workflow?.templateId || '').trim() || null,
          title: compactText(ticket?.workflow?.title, 100) || null,
          status: String(ticket?.workflow?.status || '').trim() || null,
          durationHours: Number.isFinite(Number(ticket?.workflow?.durationHours))
            ? Number(ticket.workflow.durationHours)
            : null,
          totalTasks: Number.isFinite(Number(ticket?.workflow?.totalTasks)) ? Number(ticket.workflow.totalTasks) : null,
          completedTasks: Number.isFinite(Number(ticket?.workflow?.completedTasks))
            ? Number(ticket.workflow.completedTasks)
            : null,
          failedTasks: Number.isFinite(Number(ticket?.workflow?.failedTasks)) ? Number(ticket.workflow.failedTasks) : null,
          pendingTasks: Number.isFinite(Number(ticket?.workflow?.pendingTasks)) ? Number(ticket.workflow.pendingTasks) : null,
        }
      : null,
  });

  let descriptionIncluded = true;
  let compact = base.map((ticket) => mapTicket(ticket, true));
  let compactJson = JSON.stringify(compact, null, 2);

  while (compactJson.length > maxChars && compact.length > 20) {
    const nextLength = Math.max(20, Math.floor(compact.length * 0.85));
    compact = compact.slice(0, nextLength);
    compactJson = JSON.stringify(compact, null, 2);
  }

  if (compactJson.length > maxChars) {
    descriptionIncluded = false;
    compact = base.slice(0, compact.length).map((ticket) => mapTicket(ticket, false));
    compactJson = JSON.stringify(compact, null, 2);
  }

  while (compactJson.length > maxChars && compact.length > 10) {
    compact = compact.slice(0, Math.max(10, compact.length - 5));
    compactJson = JSON.stringify(compact, null, 2);
  }

  return {
    json: compactJson,
    totalTickets,
    includedTickets: compact.length,
    truncated: compact.length < totalTickets || !descriptionIncluded,
    descriptionIncluded,
  };
}

function resolveAbuseLevel(score: number): 'niedrig' | 'mittel' | 'hoch' | 'kritisch' {
  if (score >= 0.85) return 'kritisch';
  if (score >= 0.65) return 'hoch';
  if (score >= 0.4) return 'mittel';
  return 'niedrig';
}

async function createDedupedSituationNotification(input: {
  eventType: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  dedupeSignature: string;
  dedupeHours?: number;
  roleScope?: 'all' | 'admin' | 'staff';
  context?: Record<string, any> | null;
  relatedExecutionId?: string | null;
}): Promise<{ created: boolean; id: string | null }> {
  const db = getDatabase();
  const dedupeHours = sanitizeInteger(input.dedupeHours, 24, 1, 168);
  const safeSignature = String(input.dedupeSignature || '').replace(/"/g, '\\"');
  const existing = await db.get(
    `SELECT id
     FROM admin_notifications
     WHERE event_type = ?
       AND status IN ('open', 'read')
       AND datetime(created_at) >= datetime('now', ?)
       AND context_json LIKE ?
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [input.eventType, `-${dedupeHours} hours`, `%\"signature\":\"${safeSignature}\"%`]
  );
  if (existing?.id) {
    return { created: false, id: String(existing.id) };
  }

  const created = await createAdminNotification({
    eventType: input.eventType,
    severity: input.severity,
    roleScope: input.roleScope || 'staff',
    title: input.title,
    message: input.message,
    relatedExecutionId: input.relatedExecutionId || null,
    context: {
      ...(input.context || {}),
      signature: input.dedupeSignature,
    },
  });
  return { created: true, id: created.id };
}

async function emitSituationReportNotifications(input: {
  control: SituationReportControlSettings;
  scopeKey: string;
  reportId: string;
  parsed: Record<string, any>;
  frequentReporterPatterns: Array<{ reporter: string; totalReports: number; banalReports: number; banalRatio: number; lastAt: string | null }>;
  pseudoTickets: Array<Record<string, any>>;
}): Promise<{
  abuseDetected: boolean;
  riskDetected: boolean;
  abuseSignals: number;
  riskSignals: number;
  createdNotificationIds: string[];
  messengerDelivered: number;
}> {
  const createdNotificationIds: string[] = [];

  const suspiciousPatterns = resolveSuspiciousReporterPatterns(input.parsed).filter((entry) => entry.score >= 0.65);
  const heuristicAbuse = input.frequentReporterPatterns.filter(
    (entry) => entry.totalReports >= 6 && Number(entry.banalRatio || 0) >= 0.6
  );
  const abuseSignals = suspiciousPatterns.length + heuristicAbuse.length;

  const parsedRiskSignals = Array.from(
    new Set([
      ...toStringList(input.parsed?.riskSignals),
      ...toStringList(input.parsed?.stages?.overview?.riskSignals),
    ])
  );
  const criticalPriorities = new Set(['critical', 'kritisch']);
  const criticalTicketCount = input.pseudoTickets.filter((ticket) =>
    criticalPriorities.has(String(ticket?.priority || '').trim().toLowerCase())
  ).length;
  const dangerKeywordRegex = /(brand|rauch|explosion|gas|eingest[üu]rzt|stromschlag|hochwasser|lebensgefahr|unfall)/i;
  const dangerKeywordCount = input.pseudoTickets.filter((ticket) =>
    dangerKeywordRegex.test(String(ticket?.description || ''))
  ).length;
  const riskSignals = parsedRiskSignals.length + (criticalTicketCount > 0 ? 1 : 0) + (dangerKeywordCount > 0 ? 1 : 0);

  if (input.control.autoRunNotifyOnAbuse && abuseSignals > 0) {
    const topReporterKeys = heuristicAbuse.slice(0, 6).map((entry) => entry.reporter).join('|');
    const suspiciousKeys = suspiciousPatterns.slice(0, 6).map((entry) => entry.reporter).join('|');
    const dedupeSignature = hashNormalizedValue(
      `abuse|${input.scopeKey}|${topReporterKeys}|${suspiciousKeys}|${abuseSignals}`
    ).slice(0, 24);
    const severity: 'warning' | 'error' = abuseSignals >= 5 ? 'error' : 'warning';
    const created = await createDedupedSituationNotification({
      eventType: 'situation_report_abuse_detected',
      severity,
      title: 'Moeglicher Missbrauch in Meldelagen erkannt',
      message: `Lagebild meldet ${abuseSignals} Missbrauchshinweise (Heuristik + KI-Risiken). Bitte Reporter-Muster pruefen.`,
      dedupeSignature,
      relatedExecutionId: input.reportId,
      context: {
        scopeKey: input.scopeKey,
        reportId: input.reportId,
        abuseSignals,
        heuristicAbuse: heuristicAbuse.slice(0, 10),
        suspiciousPatterns: suspiciousPatterns.slice(0, 10),
      },
    });
    if (created.created && created.id) createdNotificationIds.push(created.id);
  }

  if (input.control.autoRunNotifyOnRisk && riskSignals > 0) {
    const riskKey = parsedRiskSignals.slice(0, 8).join('|');
    const dedupeSignature = hashNormalizedValue(
      `risk|${input.scopeKey}|${riskKey}|critical:${criticalTicketCount}|danger:${dangerKeywordCount}`
    ).slice(0, 24);
    const severity: 'warning' | 'error' =
      criticalTicketCount > 0 || parsedRiskSignals.length >= 2 || dangerKeywordCount >= 2 ? 'error' : 'warning';
    const created = await createDedupedSituationNotification({
      eventType: 'situation_report_risk_detected',
      severity,
      title: 'Gefaehrliche Lage-Signale im KI-Lagebild',
      message: `Lagebild meldet kritische Risikoindikatoren (${riskSignals} Signale). Bitte zeitnah priorisieren.`,
      dedupeSignature,
      relatedExecutionId: input.reportId,
      context: {
        scopeKey: input.scopeKey,
        reportId: input.reportId,
        parsedRiskSignals,
        criticalTicketCount,
        dangerKeywordCount,
      },
    });
    if (created.created && created.id) createdNotificationIds.push(created.id);
  }

  let messengerDelivered = 0;
  if (input.control.autoRunNotifyOnMessenger) {
    try {
      const chatSummary = [
        `Neues KI-Lagebild wurde erzeugt (Scope: ${input.scopeKey}).`,
        `Bericht-ID: ${input.reportId}`,
        `Risikosignale: ${riskSignals}`,
        `Missbrauchssignale: ${abuseSignals}`,
      ].join('\n');
      const chatDispatch = await sendSystemChatNotifications({
        eventType: 'situation_report_new_messenger',
        title: 'Neues KI-Lagebild verfügbar',
        message: chatSummary,
        roleScope: 'staff',
      });
      messengerDelivered = Number(chatDispatch?.delivered || 0);
    } catch (chatError) {
      console.warn('Situation report messenger notification failed:', chatError);
    }
  }

  return {
    abuseDetected: abuseSignals > 0,
    riskDetected: riskSignals > 0,
    abuseSignals,
    riskSignals,
    createdNotificationIds,
    messengerDelivered,
  };
}

function escapeHtmlForEmail(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeSituationReportList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(20, limit)));
}

function buildSituationReportDigestEmailBody(input: {
  reportId: string;
  payload: Record<string, any>;
}): { html: string; text: string } {
  const parsed =
    (input.payload?.ai?.dePseudonymizedParsed as Record<string, any> | null) ||
    (input.payload?.ai?.parsed as Record<string, any> | null) ||
    {};
  const summary =
    String(parsed?.summary || '').trim() ||
    String(parsed?.categoryWorkflowSummary || '').trim() ||
    'Keine Zusammenfassung erzeugt.';
  const hotspots = normalizeSituationReportList(parsed?.hotspots, 8);
  const patterns = normalizeSituationReportList(parsed?.patterns, 8);
  const riskSignals = normalizeSituationReportList(parsed?.riskSignals, 8);
  const immediateActions = normalizeSituationReportList(
    parsed?.immediateActions || parsed?.recommendedActions,
    8
  );
  const reporterRisks = normalizeSituationReportList(
    parsed?.reporterRisks || parsed?.stages?.reporters?.reporterRisks,
    8
  );
  const labelCount = Array.isArray(input.payload?.recommendedLabels)
    ? input.payload.recommendedLabels.length
    : 0;
  const generatedAt = String(input.payload?.generatedAt || '').trim() || new Date().toISOString();
  const scopeKey = String(input.payload?.scopeKey || '').trim() || 'situation-report-stable';
  const ticketCount = Number(input.payload?.ticketCount || 0);

  const renderListHtml = (title: string, values: string[]) =>
    values.length > 0
      ? `<h3 style="margin:16px 0 8px 0;font-size:15px;color:#003762;">${escapeHtmlForEmail(title)}</h3>
         <ul style="margin:0;padding-left:20px;">
           ${values.map((entry) => `<li style="margin:4px 0;">${escapeHtmlForEmail(entry)}</li>`).join('')}
         </ul>`
      : '';
  const renderListText = (title: string, values: string[]) =>
    values.length > 0 ? `${title}:\n${values.map((entry) => `- ${entry}`).join('\n')}\n` : '';

  const html = `
    <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width:760px; margin:0 auto; color:#001c31;">
      <div style="background:#003762;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:20px;">Automatisches KI-Lagebild</h2>
      </div>
      <div style="border:1px solid #d8e1ea;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px;">
        <p style="margin:0 0 10px 0;"><strong>Run-ID:</strong> ${escapeHtmlForEmail(input.reportId)}</p>
        <p style="margin:0 0 10px 0;"><strong>Zeitpunkt:</strong> ${escapeHtmlForEmail(generatedAt)}</p>
        <p style="margin:0 0 10px 0;"><strong>Scope:</strong> ${escapeHtmlForEmail(scopeKey)}</p>
        <p style="margin:0 0 12px 0;"><strong>Tickets:</strong> ${Number.isFinite(ticketCount) ? ticketCount : 0} · <strong>Empfohlene Labels:</strong> ${labelCount}</p>
        <h3 style="margin:12px 0 6px 0;font-size:15px;color:#003762;">Zusammenfassung</h3>
        <p style="margin:0;white-space:pre-wrap;">${escapeHtmlForEmail(summary)}</p>
        ${renderListHtml('Hotspots', hotspots)}
        ${renderListHtml('Muster', patterns)}
        ${renderListHtml('Risikosignale', riskSignals)}
        ${renderListHtml('Sofortmaßnahmen', immediateActions)}
        ${renderListHtml('Reporter-Risiken', reporterRisks)}
      </div>
    </div>
  `.trim();

  const text = [
    'Automatisches KI-Lagebild',
    '',
    `Run-ID: ${input.reportId}`,
    `Zeitpunkt: ${generatedAt}`,
    `Scope: ${scopeKey}`,
    `Tickets: ${Number.isFinite(ticketCount) ? ticketCount : 0}`,
    `Empfohlene Labels: ${labelCount}`,
    '',
    `Zusammenfassung: ${summary}`,
    '',
    renderListText('Hotspots', hotspots),
    renderListText('Muster', patterns),
    renderListText('Risikosignale', riskSignals),
    renderListText('Sofortmaßnahmen', immediateActions),
    renderListText('Reporter-Risiken', reporterRisks),
  ]
    .filter(Boolean)
    .join('\n');

  return { html, text };
}

async function sendSituationReportDigestEmail(input: {
  reportId: string;
  payload: Record<string, any>;
  control: SituationReportControlSettings;
}): Promise<{ sent: number; failed: number; errors: string[] }> {
  const recipients = normalizeEmailAddressList(input.control.autoRunEmailRecipients);
  if (!input.control.autoRunEmailEnabled || recipients.length === 0) {
    return { sent: 0, failed: 0, errors: [] };
  }
  const { html, text } = buildSituationReportDigestEmailBody({
    reportId: input.reportId,
    payload: input.payload,
  });
  const generatedAt = String(input.payload?.generatedAt || '').trim() || new Date().toISOString();
  const subjectBase = String(input.control.autoRunEmailSubject || '').trim() || 'Automatisches KI-Lagebild';
  const subject = `${subjectBase} · ${generatedAt}`;

  const results = await Promise.all(
    recipients.map(async (recipient) => {
      try {
        const ok = await sendEmail({
          to: recipient,
          subject,
          html,
          text,
        });
        return { recipient, ok, error: ok ? null : 'sendEmail returned false' };
      } catch (error: any) {
        return { recipient, ok: false, error: error?.message || String(error) };
      }
    })
  );

  const sent = results.filter((entry) => entry.ok).length;
  const failedEntries = results.filter((entry) => !entry.ok);
  const errors = failedEntries.map((entry) => `${entry.recipient}: ${entry.error || 'Versand fehlgeschlagen'}`);
  return {
    sent,
    failed: failedEntries.length,
    errors,
  };
}

async function executeSituationReportRun(input: {
  requestedByAdminId?: string | null;
  trigger: 'manual' | 'auto';
  reportType?: SituationReportType;
  analysisQuestion?: string;
  days?: number;
  includeClosed?: boolean;
  maxTickets?: number;
  pseudonymizeNames?: boolean;
  pseudonymizeEmails?: boolean;
  scopeKey?: string;
}): Promise<{ reportId: string; resultPayload: Record<string, any> }> {
  type ReporterAggregate = {
    reporter: string;
    stablePseudoName: string;
    stablePseudoEmail: string;
    resolvedName: string;
    resolvedEmail: string;
    resolvedDisplay: string;
    totalReports: number;
    banalReports: number;
    missingLocationReports: number;
    repeatedDescriptionReports: number;
    lastAt: string | null;
    categoryCounts: Map<string, number>;
    descriptionCounts: Map<string, number>;
  };

  type CategoryLifecycleAggregate = {
    category: string;
    ticketCount: number;
    openCount: number;
    closedCount: number;
    totalAgeHours: number;
    totalClosedCycleHours: number;
    closedCycleCount: number;
    withWorkflowCount: number;
    workflowTemplateCounts: Map<string, number>;
  };

  type WorkflowTemplateAggregate = {
    workflowTemplate: string;
    ticketCount: number;
    completedCount: number;
    failedCount: number;
    runningCount: number;
    pausedCount: number;
    totalDurationHours: number;
    durationCount: number;
    avgTasks: number;
  };

  const control = await loadSituationReportControlSettings();
  if (!control.enabled) {
    throw new Error('KI-Lagebild ist aktuell gestoppt. Bitte in der Steuerung starten.');
  }

  const days = sanitizeInteger(input.days, control.defaultDays, 1, 365);
  const includeClosed = typeof input.includeClosed === 'boolean' ? input.includeClosed : control.includeClosedByDefault;
  const maxTickets = sanitizeInteger(input.maxTickets, control.defaultMaxTickets, 50, 2000);
  const pseudonymizeNames =
    typeof input.pseudonymizeNames === 'boolean' ? input.pseudonymizeNames : control.pseudonymizeNames;
  const pseudonymizeEmails =
    typeof input.pseudonymizeEmails === 'boolean' ? input.pseudonymizeEmails : control.pseudonymizeEmails;
  const reportType: SituationReportType =
    input.trigger === 'auto'
      ? 'operations'
      : normalizeSituationReportType(input.reportType, 'operations');
  const analysisQuestion =
    reportType === 'free_analysis'
      ? String(input.analysisQuestion || '').trim()
      : '';
  const scopeKey =
    typeof input.scopeKey === 'string' && input.scopeKey.trim()
      ? input.scopeKey.trim()
      : input.trigger === 'auto'
      ? control.autoRunScopeKey || 'situation-report-stable'
      : 'situation-report-stable';
  const memorySettings = await loadAnalysisMemorySettings();
  await cleanupAnalysisMemory(memorySettings.retentionDays);
  const memoryEntries =
    memorySettings.enabled && memorySettings.includeInPrompts
      ? await loadRecentAnalysisMemory({
          scopeKey,
          reportType,
          includeCrossType: true,
          settings: memorySettings,
        })
      : [];
  const memoryContextPrompt =
    memorySettings.enabled && memorySettings.includeInPrompts
      ? buildAnalysisMemoryPromptContext(memoryEntries, memorySettings.maxContextChars)
      : 'Memory-Kontext deaktiviert.';

  const db = getDatabase();
  const statusWhere = includeClosed ? '' : `AND t.status IN (${OPEN_TICKET_STATUSES_SQL})`;
  const rows = await db.all(
    `SELECT t.id, t.category, t.priority, t.status, t.description, t.address, t.postal_code, t.city,
            t.created_at, t.updated_at, c.name as citizen_name, c.email as citizen_email
     FROM tickets t
     LEFT JOIN citizens c ON c.id = t.citizen_id
     WHERE t.created_at >= datetime('now', ?)
     ${statusWhere}
     ORDER BY t.created_at DESC
     LIMIT ?`,
    [`-${days} days`, maxTickets]
  );

  const namePool = await loadPseudonymPool('name');
  const emailPool = await loadPseudonymPool('email');
  const workflowByTicket = loadSituationWorkflowSummariesByTicket();
  const pseudoTickets: Array<Record<string, any>> = [];
  const banalKeywords = ['banal', 'kleinigkeit', 'winzig', 'nur mal', 'test', 'nichts passiert'];
  const reporterStats = new Map<string, ReporterAggregate>();
  const categoryLifecycleStats = new Map<string, CategoryLifecycleAggregate>();
  const workflowTemplateStats = new Map<string, WorkflowTemplateAggregate>();
  const pseudoToClearMapping = new Map<string, string>();
  const stableScopeKey = 'ticket-reporter-stable';
  let totalTicketAgeHours = 0;
  let totalClosedCycleHours = 0;
  let totalClosedCycleCount = 0;

  for (const row of rows || []) {
    const realName = String(row?.citizen_name || '').trim();
    const realEmail = String(row?.citizen_email || '').trim().toLowerCase();
    const stablePseudoName = await ensurePseudonymValue({
      scopeKey: stableScopeKey,
      entityType: 'name',
      realValue: realName || realEmail || `ticket:${row?.id || ''}`,
      pool: namePool,
      fallback: fallbackPseudoName,
      ttlDays: control.mappingTtlDays,
    });
    const stablePseudoEmail = await ensurePseudonymValue({
      scopeKey: stableScopeKey,
      entityType: 'email',
      realValue: realEmail || realName || `ticket:${row?.id || ''}`,
      pool: emailPool,
      fallback: fallbackPseudoEmail,
      ttlDays: control.mappingTtlDays,
    });

    const resolvedDisplay =
      realName && realEmail ? `${realName} <${realEmail}>` : realName || realEmail || 'Unbekannt';
    if (stablePseudoName) pseudoToClearMapping.set(stablePseudoName, resolvedDisplay);
    if (stablePseudoEmail) pseudoToClearMapping.set(stablePseudoEmail, realEmail || resolvedDisplay);
    await upsertTicketReporterPseudonym({
      ticketId: String(row?.id || ''),
      scopeKey: stableScopeKey,
      pseudoName: stablePseudoName,
      pseudoEmail: stablePseudoEmail,
    });

    const description = String(row?.description || '').trim();
    const location = [row?.address, row?.postal_code, row?.city].filter(Boolean).join(', ');
    const createdAtIso = String(row?.created_at || '').trim() || null;
    const updatedAtIso = String(row?.updated_at || '').trim() || null;
    const ticketAgeHours = computeDurationHours(createdAtIso, null);
    const closedCycleHours = computeDurationHours(createdAtIso, updatedAtIso);
    const statusNormalized = String(row?.status || '').trim().toLowerCase();
    const isClosedTicket = statusNormalized === 'completed' || statusNormalized === 'closed';
    const workflow = workflowByTicket.get(String(row?.id || '').trim()) || null;
    const workflowTemplateKey = String(workflow?.templateId || workflow?.title || '').trim() || 'ohne_workflow';
    if (ticketAgeHours !== null) {
      totalTicketAgeHours += ticketAgeHours;
    }
    if (isClosedTicket && closedCycleHours !== null) {
      totalClosedCycleHours += closedCycleHours;
      totalClosedCycleCount += 1;
    }
    const lowerDescription = description.toLowerCase();
    const trivialByLength = description.length > 0 && description.length < 70;
    const trivialByKeyword = banalKeywords.some((keyword) => lowerDescription.includes(keyword));
    const banalHeuristicScore = trivialByLength || trivialByKeyword ? 0.7 : 0.1;
    const reporterKey = stablePseudoName || stablePseudoEmail || `stable-reporter-${String(row?.id || 'unknown')}`;
    if (reporterKey) pseudoToClearMapping.set(reporterKey, resolvedDisplay);
    const reporterEntry = reporterStats.get(reporterKey) || {
      reporter: reporterKey,
      stablePseudoName,
      stablePseudoEmail,
      resolvedName: realName,
      resolvedEmail: realEmail,
      resolvedDisplay,
      totalReports: 0,
      banalReports: 0,
      missingLocationReports: 0,
      repeatedDescriptionReports: 0,
      lastAt: null,
      categoryCounts: new Map<string, number>(),
      descriptionCounts: new Map<string, number>(),
    };
    reporterEntry.totalReports += 1;
    if (banalHeuristicScore >= 0.6) reporterEntry.banalReports += 1;
    if (!location) reporterEntry.missingLocationReports += 1;
    const category = String(row?.category || '').trim();
    if (category) {
      reporterEntry.categoryCounts.set(category, (reporterEntry.categoryCounts.get(category) || 0) + 1);
    }
    const descriptionSignature = normalizeDescriptionSignature(description);
    if (descriptionSignature) {
      const currentCount = reporterEntry.descriptionCounts.get(descriptionSignature) || 0;
      reporterEntry.descriptionCounts.set(descriptionSignature, currentCount + 1);
      if (currentCount >= 1) {
        reporterEntry.repeatedDescriptionReports += 1;
      }
    }
    reporterEntry.lastAt = row?.created_at || reporterEntry.lastAt;
    reporterStats.set(reporterKey, reporterEntry);

    const categoryKey = String(row?.category || '').trim() || 'Unkategorisiert';
    const categoryEntry = categoryLifecycleStats.get(categoryKey) || {
      category: categoryKey,
      ticketCount: 0,
      openCount: 0,
      closedCount: 0,
      totalAgeHours: 0,
      totalClosedCycleHours: 0,
      closedCycleCount: 0,
      withWorkflowCount: 0,
      workflowTemplateCounts: new Map<string, number>(),
    };
    categoryEntry.ticketCount += 1;
    if (isClosedTicket) categoryEntry.closedCount += 1;
    else categoryEntry.openCount += 1;
    if (ticketAgeHours !== null) categoryEntry.totalAgeHours += ticketAgeHours;
    if (isClosedTicket && closedCycleHours !== null) {
      categoryEntry.totalClosedCycleHours += closedCycleHours;
      categoryEntry.closedCycleCount += 1;
    }
    if (workflow) {
      categoryEntry.withWorkflowCount += 1;
      categoryEntry.workflowTemplateCounts.set(
        workflowTemplateKey,
        (categoryEntry.workflowTemplateCounts.get(workflowTemplateKey) || 0) + 1
      );
    }
    categoryLifecycleStats.set(categoryKey, categoryEntry);

    const workflowEntry = workflowTemplateStats.get(workflowTemplateKey) || {
      workflowTemplate: workflowTemplateKey,
      ticketCount: 0,
      completedCount: 0,
      failedCount: 0,
      runningCount: 0,
      pausedCount: 0,
      totalDurationHours: 0,
      durationCount: 0,
      avgTasks: 0,
    };
    workflowEntry.ticketCount += 1;
    const workflowStatus = String(workflow?.status || '').trim().toUpperCase();
    if (workflowStatus === 'COMPLETED') workflowEntry.completedCount += 1;
    if (workflowStatus === 'FAILED') workflowEntry.failedCount += 1;
    if (workflowStatus === 'RUNNING') workflowEntry.runningCount += 1;
    if (workflowStatus === 'PAUSED') workflowEntry.pausedCount += 1;
    if (workflow?.durationHours !== null && Number.isFinite(Number(workflow?.durationHours))) {
      workflowEntry.totalDurationHours += Number(workflow.durationHours || 0);
      workflowEntry.durationCount += 1;
    }
    if (workflow && Number.isFinite(Number(workflow.totalTasks))) {
      const tasks = Number(workflow.totalTasks || 0);
      const currentMean = workflowEntry.avgTasks;
      const samples = workflowEntry.ticketCount;
      workflowEntry.avgTasks = samples <= 1 ? tasks : Number(((currentMean * (samples - 1) + tasks) / samples).toFixed(2));
    }
    workflowTemplateStats.set(workflowTemplateKey, workflowEntry);

    pseudoTickets.push({
      id: String(row?.id || ''),
      category: String(row?.category || ''),
      priority: String(row?.priority || ''),
      status: String(row?.status || ''),
      description,
      location,
      createdAt: createdAtIso,
      updatedAt: updatedAtIso,
      lifecycle: {
        ticketAgeHours: ticketAgeHours ?? null,
        closedCycleHours: isClosedTicket ? closedCycleHours ?? null : null,
        lastUpdateAgeHours: computeDurationHours(updatedAtIso, null),
      },
      reporter: {
        reporterKey,
        stablePseudoName: stablePseudoName || null,
        stablePseudoEmail: stablePseudoEmail || null,
        banalHeuristicScore,
        missingLocation: !location,
      },
      workflow: workflow
        ? {
            id: workflow.id,
            templateId: workflow.templateId,
            title: workflow.title,
            status: workflow.status,
            executionMode: workflow.executionMode,
            blockedReason: workflow.blockedReason,
            startedAt: workflow.startedAt,
            completedAt: workflow.completedAt,
            durationHours: workflow.durationHours,
            totalTasks: workflow.totalTasks,
            completedTasks: workflow.completedTasks,
            failedTasks: workflow.failedTasks,
            runningTasks: workflow.runningTasks,
            pendingTasks: workflow.pendingTasks,
          }
        : null,
    });
  }

  const frequentReporterPatterns = Array.from(reporterStats.values())
    .map((entry) => {
      const topCategories = Array.from(entry.categoryCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map((item) => item[0]);
      return {
        reporter: entry.reporter,
        totalReports: entry.totalReports,
        banalReports: entry.banalReports,
        banalRatio: entry.totalReports > 0 ? roundScore(entry.banalReports / entry.totalReports) : 0,
        missingLocationReports: entry.missingLocationReports,
        missingLocationRatio:
          entry.totalReports > 0 ? roundScore(entry.missingLocationReports / entry.totalReports) : 0,
        repeatedDescriptionReports: entry.repeatedDescriptionReports,
        repeatedDescriptionRatio:
          entry.totalReports > 0 ? roundScore(entry.repeatedDescriptionReports / entry.totalReports) : 0,
        dominantCategories: topCategories,
        lastAt: entry.lastAt,
      };
    })
    .filter((entry) => entry.totalReports >= 2)
    .sort((a, b) => {
      if (b.totalReports !== a.totalReports) return b.totalReports - a.totalReports;
      if (b.banalRatio !== a.banalRatio) return b.banalRatio - a.banalRatio;
      return (Date.parse(b.lastAt || '') || 0) - (Date.parse(a.lastAt || '') || 0);
    })
    .slice(0, 40);

  const priorityCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  let missingLocationTickets = 0;
  for (const ticket of pseudoTickets) {
    const priority = String(ticket?.priority || '').trim().toLowerCase() || 'unknown';
    const status = String(ticket?.status || '').trim().toLowerCase() || 'unknown';
    const category = String(ticket?.category || '').trim() || 'Unkategorisiert';
    priorityCounts.set(priority, (priorityCounts.get(priority) || 0) + 1);
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    if (!String(ticket?.location || '').trim()) missingLocationTickets += 1;
  }

  const operationalMetrics = {
    ticketCount: pseudoTickets.length,
    missingLocationTickets,
    missingLocationRatio: pseudoTickets.length > 0 ? roundScore(missingLocationTickets / pseudoTickets.length) : 0,
    priorities: Array.from(priorityCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([priority, count]) => ({ priority, count })),
    statuses: Array.from(statusCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count })),
    topCategories: Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([category, count]) => ({ category, count })),
    frequentReporterSampleSize: frequentReporterPatterns.length,
  };

  const categoryLifecycleMetrics = Array.from(categoryLifecycleStats.values())
    .map((entry) => {
      const topWorkflowTemplates = Array.from(entry.workflowTemplateCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([workflowTemplate, count]) => ({ workflowTemplate, count }));
      const workflowCoverage =
        entry.ticketCount > 0 ? roundScore(entry.withWorkflowCount / entry.ticketCount) : 0;
      const avgAgeHours = entry.ticketCount > 0 ? roundScore(entry.totalAgeHours / entry.ticketCount) : 0;
      const avgClosedCycleHours =
        entry.closedCycleCount > 0 ? roundScore(entry.totalClosedCycleHours / entry.closedCycleCount) : 0;
      return {
        category: entry.category,
        ticketCount: entry.ticketCount,
        openCount: entry.openCount,
        closedCount: entry.closedCount,
        workflowCoverage,
        avgAgeHours,
        avgClosedCycleHours,
        topWorkflowTemplates,
      };
    })
    .sort((a, b) => {
      if (b.ticketCount !== a.ticketCount) return b.ticketCount - a.ticketCount;
      if (b.workflowCoverage !== a.workflowCoverage) return a.workflowCoverage - b.workflowCoverage;
      return b.avgAgeHours - a.avgAgeHours;
    })
    .slice(0, 30);

  const workflowTemplateMetrics = Array.from(workflowTemplateStats.values())
    .map((entry) => ({
      workflowTemplate: entry.workflowTemplate,
      ticketCount: entry.ticketCount,
      completedCount: entry.completedCount,
      failedCount: entry.failedCount,
      runningCount: entry.runningCount,
      pausedCount: entry.pausedCount,
      avgDurationHours:
        entry.durationCount > 0 ? roundScore(entry.totalDurationHours / entry.durationCount) : 0,
      avgTasks: roundScore(entry.avgTasks || 0),
      completionRate:
        entry.ticketCount > 0 ? roundScore(entry.completedCount / entry.ticketCount) : 0,
      failureRate:
        entry.ticketCount > 0 ? roundScore(entry.failedCount / entry.ticketCount) : 0,
    }))
    .sort((a, b) => {
      if (b.ticketCount !== a.ticketCount) return b.ticketCount - a.ticketCount;
      if (a.completionRate !== b.completionRate) return a.completionRate - b.completionRate;
      return b.failureRate - a.failureRate;
    })
    .slice(0, 40);

  const ticketLifecycleSummary = {
    ticketCount: pseudoTickets.length,
    avgTicketAgeHours:
      pseudoTickets.length > 0 ? roundScore(totalTicketAgeHours / pseudoTickets.length) : 0,
    avgClosedCycleHours:
      totalClosedCycleCount > 0 ? roundScore(totalClosedCycleHours / totalClosedCycleCount) : 0,
    closedTicketCount: totalClosedCycleCount,
    workflowAttachedCount: pseudoTickets.filter((ticket) => ticket.workflow).length,
  };

  const promptBase = await getSystemPrompt('aiSituationReportPrompt');
  const categoryWorkflowPromptBase = await getSystemPrompt('aiSituationCategoryWorkflowPrompt');
  const freeAnalysisPromptBase = await getSystemPrompt('aiSituationFreeAnalysisPrompt');
  const memoryCompressionPromptBase = await getSystemPrompt('aiSituationMemoryCompressionPrompt');
  const promptTicketContext = buildTicketPromptContext(pseudoTickets, {
    maxEntries: reportType === 'free_analysis' ? 140 : 110,
    maxChars: reportType === 'free_analysis' ? 30000 : 22000,
    descriptionChars: reportType === 'free_analysis' ? 260 : 220,
    locationChars: 120,
  });
  const ticketPayloadJson = promptTicketContext.json;
  const reporterPayloadJson = JSON.stringify(frequentReporterPatterns, null, 2);
  const operationalMetricsJson = JSON.stringify(operationalMetrics, null, 2);
  const categoryLifecycleMetricsJson = JSON.stringify(categoryLifecycleMetrics, null, 2);
  const workflowTemplateMetricsJson = JSON.stringify(workflowTemplateMetrics, null, 2);
  const ticketLifecycleSummaryJson = JSON.stringify(ticketLifecycleSummary, null, 2);
  const knownReporterIdsJson = JSON.stringify(
    Array.from(reporterStats.keys())
      .filter((value) => String(value || '').trim().length > 0)
      .slice(0, 500),
    null,
    2
  );
  const stableReporterPromptHint = `
REPORTER-KONVENTION (wichtig):
- Reporter sind ausschliesslich als STABILE Pseudonyme geliefert (reporterKey/stablePseudoName/stablePseudoEmail).
- Verwende ausschliesslich diese Reporter-Werte, erfinde keine reporter-* IDs.
- Wenn eine Aussage unsicher ist: score <= 0.35 und Unsicherheit klar in reason benennen.
`.trim();
  const promptDatasetHint = `
PROMPT-KONTEXT (kompakt):
- Tickets im Prompt: ${promptTicketContext.includedTickets} von ${promptTicketContext.totalTickets}
- Ticketdaten gekuerzt: ${promptTicketContext.truncated ? 'ja' : 'nein'}
- Ticket-Beschreibung enthalten: ${promptTicketContext.descriptionIncluded ? 'ja' : 'nein'}
`.trim();
  const crossStageQualityHint = `
QUALITAETSREGELN:
- Nur Daten verwenden, die in Tickets/Heuristik/Metriken enthalten sind.
- Keine Halluzinationen, keine neuen Tickets, keine neuen Reporter.
- Score-Felder strikt 0..1.
- Jeder Eintrag muss operativ verwertbar und knapp begründet sein.
`.trim();
  const memoryPromptHint = `
ANALYSE-MEMORY (historisch verdichtet):
${memoryContextPrompt}
${memorySettings.additionalInstruction ? `\nMemory-Zusatzregel:\n${memorySettings.additionalInstruction}` : ''}
`.trim();

  const overviewPrompt = `${promptBase}

AUFGABE 1/3:
- Erstelle ein operatives, belastbares Lagebild mit Fokus auf Trends, Hotspots, Risiken, Priorisierung und Maßnahmen.
- Antworte nur als JSON mit Feldern:
  summary (string, 10-16 Saetze, priorisiert: akut/strukturell/nachrangig),
  hotspots (string[]),
  patterns (string[]),
  riskSignals (string[]),
  immediateActions (string[]),
  operationalRecommendations (string[]),
  resourceHints (string[])

Zeitraum: letzte ${days} Tage
Tickets: ${pseudoTickets.length}
${promptDatasetHint}
${crossStageQualityHint}
${stableReporterPromptHint}
${memoryPromptHint}

Operative Kennzahlen:
${operationalMetricsJson}

Reporter-Muster (Heuristik):
${reporterPayloadJson}

Pseudonymisierte Tickets:
${ticketPayloadJson}
`.trim();

const reporterPrompt = `${promptBase}

AUFGABE 2/3:
- Analysiere nur Reporter-Muster, Missbrauchshinweise und Banalitätsmuster.
- Berücksichtige Häufigkeit, Wiederholungen, Standort-Lücken, Textmuster und Heuristik.
- Antworte nur als JSON mit Feldern:
  reporterRisks (string[]),
  suspiciousReporterPatterns (Array<{reporter:string, score:number, reason:string, signals?:string[]}>),
  reporterAbuseScores (Array<{reporter:string, score:number, riskLevel:string, reason:string, signals:string[]}>),
  abuseTrends (string[])
- reporter in beiden Arrays muss exakt einem gelieferten reporterKey/stablePseudo* entsprechen.
- riskLevel nur: "niedrig" | "mittel" | "hoch" | "kritisch".
- score-Rubrik:
  <=0.35 gering, 0.36-0.64 auffaellig, 0.65-0.84 hoch, >=0.85 kritisch.
- Pro Reporter maximal ein Eintrag in reporterAbuseScores.

${promptDatasetHint}
${crossStageQualityHint}
${stableReporterPromptHint}
${memoryPromptHint}

Zulaessige Reporter-IDs (Auszug):
${knownReporterIdsJson}

Operative Kennzahlen:
${operationalMetricsJson}

Reporter-Muster (Heuristik):
${reporterPayloadJson}

Pseudonymisierte Tickets:
${ticketPayloadJson}
`.trim();

const labelPrompt = `${promptBase}

AUFGABE 3/3:
- Empfehle Ticket-Labels, priorisierte Bearbeitungsmaßnahmen und Koordinationshinweise.
- Antworte nur als JSON mit Feldern:
  recommendedLabels (Array<{ticketId:string,label:string,score:number}>),
  recommendedActions (string[]),
  coordinationHints (string[])
- Für recommendedLabels nur existierende ticketId aus den Daten verwenden.
- Priorisiere Maßnahmen mit hoher Wirkung bei geringer Umsetzungszeit.

${promptDatasetHint}
${crossStageQualityHint}
${stableReporterPromptHint}
${memoryPromptHint}

Operative Kennzahlen:
${operationalMetricsJson}

Pseudonymisierte Tickets:
${ticketPayloadJson}
`.trim();

const categoryWorkflowPrompt = `${categoryWorkflowPromptBase}

AUFGABE:
- Erstelle eine umsetzbare Kategorien- und Workflow-Beratung fuer den operativen Betrieb.
- Nutze explizit Ticketlaufzeiten, Kategorieverteilung, Workflow-Erfolgsraten und Reporter-Muster.
- Antworte nur als JSON mit Feldern:
  summary (string, 8-14 Saetze),
  categoryWorkflowSummary (string),
  lifecycleRisks (string[]),
  categoryFindings (Array<{
    category:string,
    ticketCount:number,
    openCount:number,
    closedCount:number,
    avgAgeHours:number,
    avgClosedCycleHours:number,
    workflowCoverage:number,
    suggestedWorkflowTemplate:string,
    confidence:number,
    bottlenecks:string[],
    actions:string[]
  }>),
  workflowRecommendations (Array<{
    workflowTemplate:string,
    confidence:number,
    fit:string,
    reason:string,
    optimizations:string[],
    risks:string[]
  }>),
  categoryWorkflowMappingSuggestions (Array<{
    category:string,
    recommendedWorkflowTemplate:string,
    confidence:number,
    reason:string,
    expectedImpact:string
  }>),
  optimizationBacklog (Array<{
    title:string,
    impact:string,
    effort:string,
    owner:string,
    reason:string
  }>)

${promptDatasetHint}
${crossStageQualityHint}
${stableReporterPromptHint}
${memoryPromptHint}

Ticketlaufzeit-Summary:
${ticketLifecycleSummaryJson}

Kategorie-Laufzeit- und Workflow-Metriken:
${categoryLifecycleMetricsJson}

Workflow-Metriken:
${workflowTemplateMetricsJson}

Operative Kennzahlen:
${operationalMetricsJson}

Reporter-Muster (Heuristik):
${reporterPayloadJson}

Pseudonymisierte Tickets:
${ticketPayloadJson}
`.trim();

const freeAnalysisPrompt = `${freeAnalysisPromptBase}

AUFGABE:
- Beantworte die benutzerdefinierte Fragestellung direkt.
- Nutze Kennzahlen, Reporter-Muster, Kategorie-/Workflow-Daten und Ticketstichprobe.

Fragestellung:
${analysisQuestion || 'Erstelle eine fokussierte freie Analyse zur aktuellen Meldelage mit priorisierten Maßnahmen.'}

${promptDatasetHint}
${crossStageQualityHint}
${stableReporterPromptHint}
${memoryPromptHint}

Ticketlaufzeit-Summary:
${ticketLifecycleSummaryJson}

Kategorie-Laufzeit- und Workflow-Metriken:
${categoryLifecycleMetricsJson}

Workflow-Metriken:
${workflowTemplateMetricsJson}

Operative Kennzahlen:
${operationalMetricsJson}

Reporter-Muster (Heuristik):
${reporterPayloadJson}

Pseudonymisierte Tickets:
${ticketPayloadJson}
`.trim();

  let overviewRaw = '';
  let reporterRaw = '';
  let labelRaw = '';
  let categoryWorkflowRaw = '';
  let freeAnalysisRaw = '';
  const stageErrors: Array<{ stage: string; error: string }> = [];
  const stageTimeoutMs =
    reportType === 'category_workflow'
      ? 12 * 60 * 1000
      : reportType === 'free_analysis'
      ? 9 * 60 * 1000
      : 8 * 60 * 1000;

  const executeAiStage = async (inputStage: {
    stage: 'overview' | 'reporters' | 'labels' | 'category_workflow' | 'free_analysis';
    purpose: string;
    source: string;
    prompt: string;
    meta?: Record<string, any>;
  }): Promise<string> => {
    try {
      return await testAIProvider(inputStage.prompt, {
        purpose: inputStage.purpose,
        waitTimeoutMs: stageTimeoutMs,
        meta: {
          source: inputStage.source,
          days,
          scopeKey,
          reportType,
          ...inputStage.meta,
        },
      });
    } catch (error: any) {
      const errorMessage = String(error?.message || error || 'Unbekannter KI-Fehler');
      stageErrors.push({ stage: inputStage.stage, error: errorMessage });
      console.warn(`[ai-situation] stage "${inputStage.stage}" failed:`, error);
      return '';
    }
  };

  if (reportType === 'free_analysis') {
    freeAnalysisRaw = await executeAiStage({
      stage: 'free_analysis',
      purpose: 'admin_situation_report_free_analysis',
      source: 'routes.admin.situation_report.free_analysis',
      prompt: freeAnalysisPrompt,
      meta: {
        analysisQuestion: analysisQuestion || null,
      },
    });
  } else {
    overviewRaw = await executeAiStage({
      stage: 'overview',
      purpose: 'admin_situation_report_overview',
      source: 'routes.admin.situation_report.overview',
      prompt: overviewPrompt,
    });
    reporterRaw = await executeAiStage({
      stage: 'reporters',
      purpose: 'admin_situation_report_reporters',
      source: 'routes.admin.situation_report.reporters',
      prompt: reporterPrompt,
    });
    labelRaw = await executeAiStage({
      stage: 'labels',
      purpose: 'admin_situation_report_labels',
      source: 'routes.admin.situation_report.labels',
      prompt: labelPrompt,
    });
    if (reportType === 'category_workflow') {
      categoryWorkflowRaw = await executeAiStage({
        stage: 'category_workflow',
        purpose: 'admin_situation_report_category_workflow',
        source: 'routes.admin.situation_report.category_workflow',
        prompt: categoryWorkflowPrompt,
      });
    }
  }

  if (reportType === 'free_analysis' && !String(freeAnalysisRaw || '').trim()) {
    const details = stageErrors.map((entry) => `${entry.stage}: ${entry.error}`).join(' | ');
    throw new Error(details || 'Freie Analyse konnte nicht erstellt werden.');
  }
  if (
    reportType !== 'free_analysis' &&
    !String(overviewRaw || '').trim() &&
    !String(reporterRaw || '').trim() &&
    !String(labelRaw || '').trim() &&
    (reportType !== 'category_workflow' || !String(categoryWorkflowRaw || '').trim())
  ) {
    const details = stageErrors.map((entry) => `${entry.stage}: ${entry.error}`).join(' | ');
    throw new Error(details || 'Alle Analyse-Stufen sind fehlgeschlagen.');
  }

  const overviewParsed = reportType === 'free_analysis' ? {} : extractJsonFromAiText(overviewRaw) || {};
  const reporterParsed = reportType === 'free_analysis' ? {} : extractJsonFromAiText(reporterRaw) || {};
  const labelParsed = reportType === 'free_analysis' ? {} : extractJsonFromAiText(labelRaw) || {};
  const categoryWorkflowParsed =
    reportType === 'category_workflow' ? extractJsonFromAiText(categoryWorkflowRaw) || {} : {};
  const freeAnalysisParsed =
    reportType === 'free_analysis' ? extractJsonFromAiText(freeAnalysisRaw) || {} : {};
  const parsed: Record<string, any> = {
    ...overviewParsed,
    ...reporterParsed,
    ...labelParsed,
    ...categoryWorkflowParsed,
    ...freeAnalysisParsed,
    stages: {
      overview: overviewParsed,
      reporters: reporterParsed,
      labels: labelParsed,
      categoryWorkflow: categoryWorkflowParsed,
      freeAnalysis: freeAnalysisParsed,
    },
  };

  const recommendedLabels = Array.isArray(parsed?.recommendedLabels)
    ? parsed.recommendedLabels
        .map((entry: any) => ({
          ticketId: String(entry?.ticketId || '').trim(),
          label: String(entry?.label || '').trim(),
          score: Number(entry?.score),
        }))
        .filter((entry: any) => entry.ticketId && entry.label)
    : [];

  const aiReporterAbuseScores = resolveReporterAbuseScores(parsed);
  const aiSuspiciousReporterPatterns = resolveSuspiciousReporterPatterns(parsed);
  const knownReporterIdentitySet = new Set(
    Array.from(reporterStats.keys())
      .map((reporter) => normalizeReporterIdentity(reporter))
      .filter(Boolean)
  );
  const aiReporterScoreByReporter = new Map<
    string,
    { score: number; reason: string; riskLevel: string; signals: string[] }
  >();

  const mergeAiReporterSignal = (entry: {
    reporter: string;
    score: number;
    reason: string;
    riskLevel?: string;
    signals?: string[];
  }) => {
    const key = normalizeReporterIdentity(entry.reporter);
    if (!key) return;
    const current = aiReporterScoreByReporter.get(key);
    const mergedSignals = Array.from(
      new Set([...(current?.signals || []), ...(Array.isArray(entry.signals) ? entry.signals : [])].filter(Boolean))
    ).slice(0, 8);
    if (!current || entry.score > current.score) {
      aiReporterScoreByReporter.set(key, {
        score: roundScore(entry.score),
        reason: String(entry.reason || '').trim(),
        riskLevel: String(entry.riskLevel || '').trim().toLowerCase(),
        signals: mergedSignals,
      });
      return;
    }
    aiReporterScoreByReporter.set(key, {
      ...current,
      signals: mergedSignals,
      reason: current.reason || String(entry.reason || '').trim(),
      riskLevel: current.riskLevel || String(entry.riskLevel || '').trim().toLowerCase(),
    });
  };

  aiReporterAbuseScores.forEach((entry) => mergeAiReporterSignal(entry));
  aiSuspiciousReporterPatterns.forEach((entry) =>
    mergeAiReporterSignal({
      reporter: entry.reporter,
      score: entry.score,
      reason: entry.reason,
      riskLevel: '',
      signals: [],
    })
  );

  const reporterAbuseScores = Array.from(reporterStats.values())
    .map((entry) => {
      const reporterKey = normalizeReporterIdentity(entry.reporter);
      const aiSignal = aiReporterScoreByReporter.get(reporterKey);
      const banalRatio = entry.totalReports > 0 ? roundScore(entry.banalReports / entry.totalReports) : 0;
      const missingLocationRatio =
        entry.totalReports > 0 ? roundScore(entry.missingLocationReports / entry.totalReports) : 0;
      const repeatedDescriptionRatio =
        entry.totalReports > 0 ? roundScore(entry.repeatedDescriptionReports / entry.totalReports) : 0;
      const frequencyRatio = roundScore(Math.max(0, Math.min(1, (entry.totalReports - 1) / 10)));
      const aiSuspicionScore = roundScore(aiSignal?.score || 0);

      const abuseScore = roundScore(
        banalRatio * 0.28 +
          missingLocationRatio * 0.16 +
          repeatedDescriptionRatio * 0.2 +
          frequencyRatio * 0.11 +
          aiSuspicionScore * 0.25
      );
      const abuseLevel = resolveAbuseLevel(abuseScore);
      const dominantCategories = Array.from(entry.categoryCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map((item) => item[0]);

      const reasons: string[] = [];
      if (banalRatio >= 0.5) reasons.push(`Hohe Banalitätsquote (${Math.round(banalRatio * 100)}%).`);
      if (missingLocationRatio >= 0.5)
        reasons.push(`Viele Meldungen ohne belastbare Ortsdaten (${Math.round(missingLocationRatio * 100)}%).`);
      if (repeatedDescriptionRatio >= 0.35)
        reasons.push(`Auffällige Wiederholungen in Beschreibungsmustern (${Math.round(repeatedDescriptionRatio * 100)}%).`);
      if (frequencyRatio >= 0.45) reasons.push(`Erhöhte Meldefrequenz im Zeitraum (${entry.totalReports} Meldungen).`);
      if (aiSignal?.reason) reasons.push(`KI-Hinweis: ${aiSignal.reason}`);
      if (reasons.length === 0) reasons.push('Keine belastbaren Missbrauchshinweise im ausgewählten Zeitraum.');

      return {
        reporter: entry.reporter,
        reporterPseudoName: entry.stablePseudoName || null,
        reporterPseudoEmail: entry.stablePseudoEmail || null,
        reporterResolvedName: entry.resolvedName || null,
        reporterResolvedEmail: entry.resolvedEmail || null,
        reporterResolved: entry.resolvedDisplay || null,
        totalReports: entry.totalReports,
        banalReports: entry.banalReports,
        banalRatio,
        missingLocationReports: entry.missingLocationReports,
        missingLocationRatio,
        repeatedDescriptionReports: entry.repeatedDescriptionReports,
        repeatedDescriptionRatio,
        aiSuspicionScore,
        aiSuspicionReason: aiSignal?.reason || null,
        aiSignals: aiSignal?.signals || [],
        abuseScore,
        abuseLevel,
        dominantCategories,
        lastAt: entry.lastAt,
        reasons,
      };
    })
    .sort((a, b) => {
      if (b.abuseScore !== a.abuseScore) return b.abuseScore - a.abuseScore;
      if (b.totalReports !== a.totalReports) return b.totalReports - a.totalReports;
      return (Date.parse(b.lastAt || '') || 0) - (Date.parse(a.lastAt || '') || 0);
    });

  const normalizedSuspiciousReporterPatterns = aiSuspiciousReporterPatterns
    .filter((entry) => knownReporterIdentitySet.has(normalizeReporterIdentity(entry.reporter)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 120);

  const normalizedReporterAbuseForParsed = reporterAbuseScores.map((entry) => ({
    reporter: entry.reporter,
    score: entry.abuseScore,
    riskLevel: entry.abuseLevel,
    reason: entry.reasons?.[0] || '',
    signals: entry.aiSignals || [],
  }));

  const computedReporterRiskHints = reporterAbuseScores
    .filter((entry) => entry.abuseScore >= 0.65)
    .slice(0, 20)
    .map(
      (entry) =>
        `${entry.reporterResolved || entry.reporter}: Score ${entry.abuseScore.toFixed(2)} (${entry.abuseLevel}), ${entry.totalReports} Meldungen`
    );

  const normalizedReporterRisks = Array.from(
    new Set([
      ...toStringList(parsed?.reporterRisks),
      ...toStringList(parsed?.stages?.reporters?.reporterRisks),
      ...computedReporterRiskHints,
    ])
  ).slice(0, 50);

  const abuseSummary = {
    totalReporters: reporterAbuseScores.length,
    highOrCritical: reporterAbuseScores.filter((entry) => entry.abuseScore >= 0.65).length,
    medium: reporterAbuseScores.filter((entry) => entry.abuseScore >= 0.4 && entry.abuseScore < 0.65).length,
    low: reporterAbuseScores.filter((entry) => entry.abuseScore < 0.4).length,
    maxScore: reporterAbuseScores.length > 0 ? reporterAbuseScores[0].abuseScore : 0,
  };

  const resolvedFrequentReporterPatterns = frequentReporterPatterns.map((entry) => {
    const reporterDetail = reporterStats.get(entry.reporter);
    return {
      ...entry,
      reporterResolved: reporterDetail?.resolvedDisplay || replacePseudonymsInText(entry.reporter, pseudoToClearMapping),
      reporterResolvedName: reporterDetail?.resolvedName || null,
      reporterResolvedEmail: reporterDetail?.resolvedEmail || null,
    };
  });

  const parsedForAlerts: Record<string, any> = {
    ...parsed,
    reporterRisks: normalizedReporterRisks,
    suspiciousReporterPatterns: normalizedSuspiciousReporterPatterns,
    reporterAbuseScores: normalizedReporterAbuseForParsed,
  };
  const stageReporters = parsedForAlerts?.stages?.reporters && typeof parsedForAlerts.stages.reporters === 'object'
    ? parsedForAlerts.stages.reporters
    : {};
  parsedForAlerts.stages = {
    ...(parsedForAlerts.stages && typeof parsedForAlerts.stages === 'object' ? parsedForAlerts.stages : {}),
    reporters: {
      ...stageReporters,
      reporterRisks: normalizedReporterRisks,
      suspiciousReporterPatterns: normalizedSuspiciousReporterPatterns,
      reporterAbuseScores: normalizedReporterAbuseForParsed,
    },
  };

  const baseResultPayload = {
    generatedAt: new Date().toISOString(),
    trigger: input.trigger,
    reportType,
    reportTypeLabel: resolveSituationReportTypeLabel(reportType),
    scopeKey,
    analysisQuestion: analysisQuestion || null,
    reporterIdentityMode: 'stable-pseudonym-only',
    days,
    ticketCount: pseudoTickets.length,
    controlApplied: {
      ...control,
      pseudonymizeNames,
      pseudonymizeEmails,
    },
    frequentReporterPatterns,
    frequentReporterPatternsResolved: resolvedFrequentReporterPatterns,
    operationalMetrics,
    ticketLifecycleSummary,
    categoryLifecycleMetrics,
    workflowTemplateMetrics,
    reporterAbuseSummary: abuseSummary,
    reporterAbuseScores,
    ai: {
      raw: {
        overview: overviewRaw,
        reporters: reporterRaw,
        labels: labelRaw,
        categoryWorkflow: categoryWorkflowRaw || '',
        freeAnalysis: freeAnalysisRaw || '',
      },
      parsed: parsedForAlerts,
      dePseudonymizedRaw: {
        overview: replacePseudonymsInText(overviewRaw, pseudoToClearMapping),
        reporters: replacePseudonymsInText(reporterRaw, pseudoToClearMapping),
        labels: replacePseudonymsInText(labelRaw, pseudoToClearMapping),
        categoryWorkflow: categoryWorkflowRaw
          ? replacePseudonymsInText(categoryWorkflowRaw, pseudoToClearMapping)
          : '',
        freeAnalysis: freeAnalysisRaw
          ? replacePseudonymsInText(freeAnalysisRaw, pseudoToClearMapping)
          : '',
      },
      dePseudonymizedParsed: dePseudonymizeValue(parsedForAlerts, pseudoToClearMapping),
      diagnostics: {
        stageTimeoutMs,
        stageErrors,
        promptContext: {
          totalTickets: promptTicketContext.totalTickets,
          includedTickets: promptTicketContext.includedTickets,
          truncated: promptTicketContext.truncated,
          descriptionIncluded: promptTicketContext.descriptionIncluded,
        },
      },
    },
    memory: {
      enabled: memorySettings.enabled,
      usedForPrompt: memorySettings.enabled && memorySettings.includeInPrompts,
      contextEntries: memoryEntries.length,
      contextChars: memoryContextPrompt.length,
    },
    recommendedLabels,
  };

  const rawDataPayload = {
    pseudoTickets,
    frequentReporterPatterns,
    ticketLifecycleSummary,
    categoryLifecycleMetrics,
    workflowTemplateMetrics,
    reporterAbuseScores,
    pseudoMappingCount: pseudoToClearMapping.size,
  };

  const reportId = await storeSituationReportRun({
    createdByAdminId: input.requestedByAdminId || null,
    reportType,
    scopeKey,
    days,
    maxTickets,
    includeClosed,
    pseudonymizeNames,
    pseudonymizeEmails,
    result: baseResultPayload,
    rawData: rawDataPayload,
  });

  const alerts = await emitSituationReportNotifications({
    control,
    scopeKey,
    reportId,
    parsed: parsedForAlerts,
    frequentReporterPatterns,
    pseudoTickets,
  });

  const resultPayload = {
    ...baseResultPayload,
    alerts,
  };
  await db.run(
    `UPDATE ai_situation_reports
     SET result_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(resultPayload), reportId]
  );

  if (memorySettings.enabled && memorySettings.autoPersist) {
    try {
      const fallbackSummarySource =
        String(
          parsedForAlerts?.summary ||
            parsedForAlerts?.categoryWorkflowSummary ||
            parsedForAlerts?.answer ||
            ''
        ).trim() ||
        `Analyse ${resolveSituationReportTypeLabel(reportType)} mit ${pseudoTickets.length} Tickets abgeschlossen.`;
      let summary = fallbackSummarySource;
      let confidence: number | null = null;
      let details: Record<string, any> = {
        reportType,
        analysisQuestion: analysisQuestion || null,
        keyFindings: toStringList(parsedForAlerts?.keyFindings || parsedForAlerts?.riskSignals).slice(0, 8),
        recommendedActions: toStringList(parsedForAlerts?.recommendedActions || parsedForAlerts?.immediateActions).slice(0, 8),
      };

      const compressionInput = {
        reportType,
        reportTypeLabel: resolveSituationReportTypeLabel(reportType),
        analysisQuestion: analysisQuestion || null,
        generatedAt: resultPayload.generatedAt,
        summary: parsedForAlerts?.summary || null,
        categoryWorkflowSummary: parsedForAlerts?.categoryWorkflowSummary || null,
        answer: parsedForAlerts?.answer || null,
        keyFindings: parsedForAlerts?.keyFindings || [],
        recommendedActions: parsedForAlerts?.recommendedActions || [],
        riskSignals: parsedForAlerts?.riskSignals || [],
        immediateActions: parsedForAlerts?.immediateActions || [],
        lifecycleRisks: parsedForAlerts?.lifecycleRisks || [],
        reporterRisks: parsedForAlerts?.reporterRisks || [],
        operationalMetrics,
        ticketLifecycleSummary,
      };

      try {
        const compressionPrompt = `${memoryCompressionPromptBase}

Report-Typ: ${resolveSituationReportTypeLabel(reportType)}
Freie Fragestellung:
${analysisQuestion || 'n/a'}

Bestehender Memory-Kontext:
${memoryContextPrompt}

Aktuelles Analyseergebnis (JSON):
${JSON.stringify(compressionInput, null, 2)}
`.trim();
        const compressedRaw = await testAIProvider(compressionPrompt, {
          purpose: 'admin_situation_report_memory_compression',
          meta: {
            source: 'routes.admin.situation_report.memory_compression',
            reportId,
            scopeKey,
            reportType,
          },
        });
        const compressedParsed = extractJsonFromAiText(compressedRaw) || {};
        const compressedSummary = String(compressedParsed?.summary || '').trim();
        const confidenceRaw = Number(compressedParsed?.confidence);
        if (compressedSummary) {
          summary = compressedSummary;
        }
        confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : null;
        details = {
          ...details,
          signals: toStringList(compressedParsed?.signals).slice(0, 10),
          openQuestions: toStringList(compressedParsed?.openQuestions).slice(0, 10),
          recommendedFollowUp: toStringList(compressedParsed?.recommendedFollowUp).slice(0, 10),
        };
      } catch (compressionError) {
        console.warn('AI memory compression failed, fallback summary used:', compressionError);
      }

      summary = summary.slice(0, memorySettings.maxAutoSummaryChars);
      await insertAnalysisMemoryEntry({
        scopeKey,
        reportType,
        source: 'auto',
        summary,
        details,
        promptInstruction: analysisQuestion || null,
        confidence,
        reportId,
        createdByAdminId: input.requestedByAdminId || null,
      });
    } catch (memoryError) {
      console.warn('Failed to persist analysis memory entry:', memoryError);
    }
  }

  return {
    reportId,
    resultPayload,
  };
}

async function runSituationReportAutoCycle(source: 'timer' | 'control-save' = 'timer'): Promise<void> {
  if (situationReportAutoRunActive) return;
  situationReportAutoRunActive = true;
  try {
    const control = await loadSituationReportControlSettings();
    if (!control.enabled || !control.autoRunEnabled) return;
    const run = await executeSituationReportRun({
      requestedByAdminId: null,
      trigger: 'auto',
      days: control.defaultDays,
      includeClosed: control.includeClosedByDefault,
      maxTickets: control.defaultMaxTickets,
      pseudonymizeNames: control.pseudonymizeNames,
      pseudonymizeEmails: control.pseudonymizeEmails,
      scopeKey: control.autoRunScopeKey,
    });
    const nowIso = new Date().toISOString();
    const nextUpdate: Partial<SituationReportControlSettings> = {
      lastAutoRunAt: nowIso,
      lastAutoRunError: null,
    };
    if (control.autoRunEmailEnabled && control.autoRunEmailRecipients.length > 0) {
      const mailResult = await sendSituationReportDigestEmail({
        reportId: run.reportId,
        payload: run.resultPayload,
        control,
      });
      if (mailResult.sent > 0) {
        nextUpdate.autoRunEmailLastSentAt = nowIso;
      }
      if (mailResult.failed > 0) {
        const shortError = mailResult.errors[0] || `${mailResult.failed} Versandfehler`;
        nextUpdate.autoRunEmailLastError = shortError.slice(0, 400);
        nextUpdate.lastAutoRunError = `Report erstellt, aber Mailversand mit Fehler: ${shortError}`.slice(0, 500);
      } else {
        nextUpdate.autoRunEmailLastError = null;
      }
    } else {
      nextUpdate.autoRunEmailLastError = null;
    }
    await saveSituationReportControlSettings(nextUpdate);
  } catch (error: any) {
    console.error(`Situation report auto-run failed (${source}):`, error);
    await saveSituationReportControlSettings({
      lastAutoRunAt: new Date().toISOString(),
      lastAutoRunError: error?.message || String(error),
      autoRunEmailLastError: error?.message || String(error),
    });
  } finally {
    situationReportAutoRunActive = false;
  }
}

function updateSituationReportAutoLoop(control: SituationReportControlSettings) {
  if (situationReportAutoTimer) {
    clearInterval(situationReportAutoTimer);
    situationReportAutoTimer = null;
  }
  if (!control.enabled || !control.autoRunEnabled) return;
  const intervalMs = Math.max(5 * 60 * 1000, Number(control.autoRunIntervalMinutes || 30) * 60 * 1000);
  situationReportAutoTimer = setInterval(() => {
    void runSituationReportAutoCycle('timer');
  }, intervalMs);
}

async function ensureSituationReportAutoLoop() {
  if (situationReportAutoLoopInitialized) return;
  situationReportAutoLoopInitialized = true;
  const control = await loadSituationReportControlSettings();
  updateSituationReportAutoLoop(control);
}

/**
 * POST /api/admin/ai/situation-report
 * KI-Lagebild mit pseudonymisierten Reporter-Daten
 */
router.post('/ai/situation-report', async (req: Request, res: Response): Promise<any> => {
  try {
    const run = await executeSituationReportRun({
      requestedByAdminId: req.userId || null,
      trigger: 'manual',
      reportType: normalizeSituationReportType(req.body?.reportType, 'operations'),
      analysisQuestion: req.body?.analysisQuestion,
      days: req.body?.days,
      includeClosed: req.body?.includeClosed,
      maxTickets: req.body?.maxTickets,
      pseudonymizeNames: req.body?.pseudonymizeNames,
      pseudonymizeEmails: req.body?.pseudonymizeEmails,
      scopeKey: req.body?.scopeKey,
    });
    return res.json({
      reportId: run.reportId,
      ...run.resultPayload,
    });
  } catch (error: any) {
    if (String(error?.message || '').includes('KI-Lagebild ist aktuell gestoppt')) {
      const control = await loadSituationReportControlSettings();
      return res.status(409).json({
        message: String(error?.message || 'KI-Lagebild ist gestoppt.'),
        control,
      });
    }
    return res.status(500).json({
      message: 'Fehler beim Erstellen des KI-Lagebilds',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/ai/situation-report/history
 * Historie persistierter KI-Lagebilder
 */
router.get('/ai/situation-report/history', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 30)));
    const offset = Math.max(0, Number(req.query?.offset || 0));
    const db = getDatabase();
    const rows = await db.all(
      `SELECT r.id, r.report_type, r.scope_key, r.days, r.max_tickets, r.include_closed, r.pseudonymize_names, r.pseudonymize_emails,
              r.status, r.started_at, r.finished_at, r.created_at, r.updated_at, r.created_by_admin_id, r.result_json,
              u.username as created_by_username
       FROM ai_situation_reports r
       LEFT JOIN admin_users u ON u.id = r.created_by_admin_id
       ORDER BY datetime(r.created_at) DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const totalRow = await db.get(`SELECT COUNT(*) as total FROM ai_situation_reports`);
    return res.json({
      items: (rows || []).map((row: any) => {
        const parsed = parseJsonIfPossible(row?.result_json) || {};
        const reportType = normalizeSituationReportType(row?.report_type || parsed?.reportType, 'operations');
        return {
          reportType,
          reportTypeLabel: resolveSituationReportTypeLabel(reportType),
          id: String(row?.id || ''),
          scopeKey: row?.scope_key || null,
          days: Number(row?.days || 0),
          maxTickets: Number(row?.max_tickets || 0),
          includeClosed: Number(row?.include_closed || 0) === 1,
          pseudonymizeNames: Number(row?.pseudonymize_names || 0) === 1,
          pseudonymizeEmails: Number(row?.pseudonymize_emails || 0) === 1,
          status: String(row?.status || 'completed'),
          startedAt: row?.started_at || null,
          finishedAt: row?.finished_at || null,
          createdAt: row?.created_at || null,
          updatedAt: row?.updated_at || null,
          createdByAdminId: row?.created_by_admin_id || null,
          createdByUsername: row?.created_by_username || null,
        };
      }),
      total: Number(totalRow?.total || 0),
      limit,
      offset,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der Lagebild-Historie',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/ai/situation-report/latest
 * Kompakte Liste der neuesten Lagebilder für Dashboard/Schnellzugriff
 */
router.get('/ai/situation-report/latest', async (req: Request, res: Response): Promise<any> => {
  try {
    const limit = Math.max(1, Math.min(20, Number(req.query?.limit || 6)));
    const db = getDatabase();
    const rows = await db.all(
      `SELECT id, report_type, scope_key, created_at, result_json, days, max_tickets
       FROM ai_situation_reports
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
      [limit]
    );
    const items = (rows || []).map((row: any) => {
      const result = parseJsonIfPossible(row?.result_json) || {};
      const parsed = result?.ai?.dePseudonymizedParsed || result?.ai?.parsed || {};
      const summary =
        typeof parsed?.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : typeof parsed?.categoryWorkflowSummary === 'string' && parsed.categoryWorkflowSummary.trim()
          ? parsed.categoryWorkflowSummary.trim()
          : typeof result?.summary === 'string' && result.summary.trim()
          ? result.summary.trim()
          : '';
      return {
        id: String(row?.id || ''),
        reportType: normalizeSituationReportType(row?.report_type || result?.reportType, 'operations'),
        reportTypeLabel: resolveSituationReportTypeLabel(row?.report_type || result?.reportType),
        scopeKey: String(row?.scope_key || ''),
        createdAt: row?.created_at || null,
        days: Number(row?.days || 0),
        maxTickets: Number(row?.max_tickets || 0),
        ticketCount: Number(result?.ticketCount || 0),
        summary: summary.slice(0, 420),
      };
    });
    return res.json({ items, limit });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der neuesten Lagebilder',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/ai/situation-report/report/:reportId
 * Einzelnes gespeichertes Lagebild laden
 */
router.get('/ai/situation-report/report/:reportId', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const reportId = String(req.params?.reportId || '').trim();
    if (!reportId) return res.status(400).json({ message: 'reportId fehlt.' });
    const db = getDatabase();
    const row = await db.get(
      `SELECT id, report_type, scope_key, days, max_tickets, include_closed, pseudonymize_names, pseudonymize_emails,
              status, started_at, finished_at, result_json, raw_data_json, created_at, updated_at
       FROM ai_situation_reports
       WHERE id = ?
       LIMIT 1`,
      [reportId]
    );
    if (!row) return res.status(404).json({ message: 'Lagebild nicht gefunden.' });
    const parsedResult = parseJsonIfPossible(row?.result_json) || null;
    const reportType = normalizeSituationReportType(row?.report_type || parsedResult?.reportType, 'operations');
    return res.json({
      id: String(row?.id || ''),
      reportType,
      reportTypeLabel: resolveSituationReportTypeLabel(reportType),
      scopeKey: row?.scope_key || null,
      days: Number(row?.days || 0),
      maxTickets: Number(row?.max_tickets || 0),
      includeClosed: Number(row?.include_closed || 0) === 1,
      pseudonymizeNames: Number(row?.pseudonymize_names || 0) === 1,
      pseudonymizeEmails: Number(row?.pseudonymize_emails || 0) === 1,
      status: String(row?.status || 'completed'),
      startedAt: row?.started_at || null,
      finishedAt: row?.finished_at || null,
      createdAt: row?.created_at || null,
      updatedAt: row?.updated_at || null,
      result: parsedResult,
      rawData: parseJsonIfPossible(row?.raw_data_json) || null,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden des Lagebilds',
      error: error?.message || String(error),
    });
  }
});

/**
 * DELETE /api/admin/ai/situation-report/report/:reportId
 * Gespeichertes Lagebild und Analysedaten loeschen
 */
router.delete('/ai/situation-report/report/:reportId', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const reportId = String(req.params?.reportId || '').trim();
    if (!reportId) return res.status(400).json({ message: 'reportId fehlt.' });
    const db = getDatabase();
    const result = await db.run(`DELETE FROM ai_situation_reports WHERE id = ?`, [reportId]);
    if (!result?.changes) {
      return res.status(404).json({ message: 'Lagebild nicht gefunden.' });
    }
    return res.json({
      message: 'Lagebild und Analysedaten geloescht.',
      reportId,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Loeschen des Lagebilds',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/ai/situation-report/label-apply
 * Persistiert Label-Empfehlungen
 */
router.post('/ai/situation-report/label-apply', async (req: Request, res: Response): Promise<any> => {
  try {
    const source = typeof req.body?.source === 'string' && req.body.source.trim()
      ? req.body.source.trim()
      : 'ai_situation_report';
    const labels = Array.isArray(req.body?.labels) ? req.body.labels : [];
    if (labels.length === 0) {
      return res.status(400).json({ message: 'labels darf nicht leer sein.' });
    }
    const db = getDatabase();
    let inserted = 0;
    const details: Array<{ ticketId: string; label: string; inserted: boolean; message?: string }> = [];
    for (const entry of labels) {
      const ticketId = String(entry?.ticketId || '').trim();
      const label = String(entry?.label || '').trim();
      const scoreRaw = Number(entry?.score);
      const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(1, scoreRaw)) : null;
      if (!ticketId || !label) {
        details.push({ ticketId, label, inserted: false, message: 'ticketId/label fehlt' });
        continue;
      }
      const ticket = await db.get(`SELECT id FROM tickets WHERE id = ?`, [ticketId]);
      if (!ticket) {
        details.push({ ticketId, label, inserted: false, message: 'Ticket nicht gefunden' });
        continue;
      }
      await db.run(
        `INSERT INTO ticket_labels (id, ticket_id, label, score, source)
         VALUES (?, ?, ?, ?, ?)`,
        [`tl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, ticketId, label, score, source]
      );
      inserted += 1;
      details.push({ ticketId, label, inserted: true });
    }

    return res.json({
      inserted,
      total: labels.length,
      source,
      details,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Persistieren der Labels',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/ai/test
 * Teste den aktuellen KI-Provider mit einem Prompt (ADMIN only)
 */
router.post('/ai/test', adminOnly, async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt erforderlich' });
    }

    // Import AI service dynamically to avoid circular imports
    const { testAIProvider } = await import('../services/ai.js');
    
    const response = await testAIProvider(prompt, {
      purpose: 'admin_test',
      meta: {
        source: 'routes.admin.ai_test',
      },
    });
    
    const runtime = await resolveLlmRuntimeSelection({ purpose: 'admin_test' });

    res.json({
      prompt,
      response,
      provider: runtime.connectionName || runtime.connectionId,
      model: runtime.model,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'KI-Test fehlgeschlagen',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/admin/ai/help
 * KI-Hilfe für Fragen zur Bedienung im Admin-Backend
 */
router.post('/ai/help', async (req: Request, res: Response) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const section = typeof req.body?.section === 'string' ? req.body.section.trim() : '';
    const historyInput = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!question || question.length < 3) {
      return res.status(400).json({ message: 'Bitte eine konkrete Frage eingeben.' });
    }

    const history = historyInput
      .slice(-10)
      .map((entry: any) => ({
        role: entry?.role === 'assistant' ? 'assistant' : 'user',
        content: typeof entry?.content === 'string' ? entry.content.trim() : '',
      }))
      .filter((entry: { role: 'user' | 'assistant'; content: string }) => entry.content.length > 0)
      .map((entry: { role: 'user' | 'assistant'; content: string }) => ({
        ...entry,
        content: entry.content.slice(0, 2000),
      }));

    const systemPrompt = await getSystemPrompt('adminAiHelpPrompt');
    const historyBlock = history.length
      ? history
          .map((entry: { role: 'user' | 'assistant'; content: string }) =>
            `${entry.role === 'assistant' ? 'Assistent' : 'Nutzer'}: ${entry.content}`
          )
          .join('\n\n')
      : 'Keine';

    const prompt = `${systemPrompt}

Bereich:
${section || 'allgemein'}

Bisheriger Verlauf:
${historyBlock}

Aktuelle Frage:
${question}

Antwortanforderung:
- Maximal 8 kurze Absätze
- Wenn sinnvoll: nummerierte Schrittfolge
- Konkrete Menüs/Seiten benennen, keine Fantasie-Elemente`;

    const answerRaw = await testAIProvider(prompt, {
      purpose: 'admin_help',
      meta: {
        source: 'routes.admin.ai_help',
        section: section || null,
      },
    });

    const answer = String(answerRaw || '')
      .replace(/```[\s\S]*?```/g, '')
      .trim();

    if (!answer) {
      return res.status(422).json({ message: 'Die KI konnte keine hilfreiche Antwort erzeugen.' });
    }

    const runtime = await resolveLlmRuntimeSelection({ purpose: 'admin_help', taskKey: 'admin_help' });

    return res.json({
      answer,
      provider: runtime.connectionName || runtime.connectionId,
      model: runtime.model,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Abrufen der KI-Hilfe',
      error: error?.message || String(error),
    });
  }
});

const ARCHIVE_CLOSED_TICKET_STATUSES = ['completed', 'closed'];
const DEFAULT_TRANSLATION_CACHE_TTL_DAYS = 30;
const MIN_TRANSLATION_CACHE_TTL_DAYS = 1;
const MAX_TRANSLATION_CACHE_TTL_DAYS = 3650;

function sanitizeMaintenanceDays(value: unknown, fallback: number, min = 1, max = 3650): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function sanitizeTranslationCacheTtlDays(value: unknown, fallback = DEFAULT_TRANSLATION_CACHE_TTL_DAYS): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return Math.max(MIN_TRANSLATION_CACHE_TTL_DAYS, Math.min(MAX_TRANSLATION_CACHE_TTL_DAYS, rounded));
}

async function resolveTranslationCacheTtlDaysSetting(): Promise<number> {
  const stored = await getSetting<any>('translationCacheTtlDays');
  if (typeof stored === 'number') {
    return sanitizeTranslationCacheTtlDays(stored);
  }
  if (stored && typeof stored === 'object') {
    const candidate = (stored as Record<string, unknown>).days ?? (stored as Record<string, unknown>).ttlDays;
    if (candidate !== undefined) {
      return sanitizeTranslationCacheTtlDays(candidate);
    }
  }
  return DEFAULT_TRANSLATION_CACHE_TTL_DAYS;
}

function chunkItems<T>(items: T[], chunkSize = 400): T[][] {
  const chunks: T[][] = [];
  const safeSize = Math.max(1, Math.floor(chunkSize));
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

async function deleteRowsByIds(
  db: ReturnType<typeof getDatabase>,
  table: string,
  column: string,
  ids: string[]
): Promise<number> {
  if (!ids.length) return 0;
  let deleted = 0;
  for (const chunk of chunkItems(ids, 350)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const result: any = await db.run(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`, chunk);
    deleted += Number(result?.changes || 0);
  }
  return deleted;
}

/**
 * GET /api/admin/maintenance/translation-cache-policy
 * Liefert die aktuelle Lebensdauer fuer UI-Translations (in Tagen)
 */
router.get('/maintenance/translation-cache-policy', adminOnly, async (_req: Request, res: Response) => {
  try {
    const ttlDays = await resolveTranslationCacheTtlDaysSetting();
    return res.json({
      ttlDays,
      defaultTtlDays: DEFAULT_TRANSLATION_CACHE_TTL_DAYS,
      minTtlDays: MIN_TRANSLATION_CACHE_TTL_DAYS,
      maxTtlDays: MAX_TRANSLATION_CACHE_TTL_DAYS,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der Translation-Cache-Policy',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/maintenance/translation-cache-policy
 * Setzt die Lebensdauer fuer UI-Translations und kann optional sofort alt bereinigen
 */
router.post('/maintenance/translation-cache-policy', adminOnly, async (req: Request, res: Response) => {
  try {
    const ttlDays = sanitizeTranslationCacheTtlDays(req.body?.ttlDays);
    const pruneNow =
      req.body?.pruneNow === true ||
      req.body?.pruneNow === 1 ||
      String(req.body?.pruneNow || '')
        .trim()
        .toLowerCase() === 'true';

    await setSetting('translationCacheTtlDays', {
      days: ttlDays,
      updatedAt: new Date().toISOString(),
    });

    let prunedUi = 0;
    let prunedEmail = 0;
    if (pruneNow) {
      const db = getDatabase();
      const uiResult: any = await db.run(
        `DELETE FROM translations
         WHERE datetime(updated_at) < datetime('now', ?)`,
        [`-${ttlDays} days`]
      );
      prunedUi = Number(uiResult?.changes || 0);
      const emailResult: any = await db.run(
        `DELETE FROM email_template_translations
         WHERE datetime(updated_at) < datetime('now', ?)`,
        [`-${ttlDays} days`]
      );
      prunedEmail = Number(emailResult?.changes || 0);
    }

    const pruned = prunedUi + prunedEmail;
    return res.json({
      message: pruneNow
        ? `Translation-Cache-Policy gespeichert (${pruned} alte Übersetzungen entfernt).`
        : 'Translation-Cache-Policy gespeichert.',
      ttlDays,
      pruned,
      prunedUi,
      prunedEmail,
      pruneNow,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Speichern der Translation-Cache-Policy',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/maintenance/database-structure
 * Liefert DB-Groesse, Tabellen und Datenstruktur
 */
router.get('/maintenance/database-structure', adminOnly, async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    return res.json(await buildDatabaseStructureSnapshot(db));
  } catch (error: any) {
    return res.status(500).json({
      message: 'DB-Struktur konnte nicht geladen werden',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/maintenance/purge
 * Loescht alle Tickets und Workflows (inkl. zugehoeriger Daten)
 */
router.post('/maintenance/purge', async (req: Request, res: Response) => {
  try {
    const { confirm } = req.body || {};
    if (!confirm) {
      return res.status(400).json({ message: 'confirm=true erforderlich' });
    }

    const db = getDatabase();
    await db.exec('BEGIN');
    await db.run('DELETE FROM workflow_validations');
    await db.run('DELETE FROM ticket_validations');
    await db.run('DELETE FROM ai_logs');
    await db.run('DELETE FROM escalations');
    await db.run('DELETE FROM tickets');
    await db.run('DELETE FROM submission_images');
    await db.run('DELETE FROM submissions');
    await db.exec('COMMIT');

    try {
      writeFileSync(EXECUTIONS_FILE, JSON.stringify([], null, 2));
    } catch (fileError) {
      console.warn('Executions file cleanup failed:', fileError);
    }

    res.json({ message: 'Tickets und Workflows wurden geloescht.' });
  } catch (error: any) {
    try {
      const db = getDatabase();
      await db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({ message: 'Fehler beim Loeschen', error: error?.message || String(error) });
  }
});

/**
 * POST /api/admin/maintenance/cleanup-old-data
 * Bereinigt alte Betriebsdaten anhand einer Tagesgrenze
 */
router.post('/maintenance/cleanup-old-data', adminOnly, async (req: Request, res: Response) => {
  try {
    const { confirm, olderThanDays } = req.body || {};
    if (!confirm) {
      return res.status(400).json({ message: 'confirm=true erforderlich' });
    }
    const days = sanitizeMaintenanceDays(olderThanDays, 90, 1, 3650);
    const cutoffExpr = `-${days} days`;
    const db = getDatabase();

    const deleted: Record<string, number> = {};
    const runDelete = async (key: string, query: string, params: any[] = []) => {
      const result: any = await db.run(query, params);
      deleted[key] = Number(result?.changes || 0);
    };

    await db.exec('BEGIN');
    try {
      await runDelete(
        'translations',
        `DELETE FROM translations WHERE datetime(updated_at) < datetime('now', ?)`,
        [cutoffExpr]
      );
      await runDelete(
        'email_template_translations',
        `DELETE FROM email_template_translations WHERE datetime(updated_at) < datetime('now', ?)`,
        [cutoffExpr]
      );
      await runDelete(
        'admin_journal',
        `DELETE FROM admin_journal WHERE datetime(created_at) < datetime('now', ?)`,
        [cutoffExpr]
      );
      await runDelete(
        'admin_sessions',
        `DELETE FROM admin_sessions
         WHERE is_active = 0
           AND datetime(COALESCE(logged_out_at, last_seen_at, issued_at, created_at)) < datetime('now', ?)`,
        [cutoffExpr]
      );
      await runDelete(
        'admin_notifications',
        `DELETE FROM admin_notifications
         WHERE status != 'open'
           AND datetime(updated_at) < datetime('now', ?)`,
        [cutoffExpr]
      );
      await runDelete(
        'email_queue',
        `DELETE FROM email_queue
         WHERE status IN ('sent', 'failed', 'cancelled')
           AND datetime(updated_at) < datetime('now', ?)`,
        [cutoffExpr]
      );
      await runDelete(
        'ai_queue',
        `DELETE FROM ai_queue
         WHERE status IN ('done', 'failed', 'cancelled')
           AND datetime(updated_at) < datetime('now', ?)`,
        [cutoffExpr]
      );
      await runDelete(
        'llm_pseudonym_mappings',
        `DELETE FROM llm_pseudonym_mappings
         WHERE expires_at IS NOT NULL
           AND datetime(expires_at) < datetime('now')`
      );
      await runDelete(
        'ai_situation_reports',
        `DELETE FROM ai_situation_reports WHERE datetime(created_at) < datetime('now', ?)`,
        [cutoffExpr]
      );
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }

    const totalDeleted = Object.values(deleted).reduce((sum, value) => sum + Number(value || 0), 0);
    return res.json({
      message: `Bereinigung abgeschlossen (${totalDeleted} Datensätze entfernt).`,
      olderThanDays: days,
      deleted,
      totalDeleted,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler bei der Alt-Daten-Bereinigung',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/maintenance/archive-old-tickets
 * Exportiert alte Tickets als JSON und loescht sie danach aus der DB
 */
router.post('/maintenance/archive-old-tickets', adminOnly, async (req: Request, res: Response) => {
  try {
    const { confirm, olderThanDays, closedOnly } = req.body || {};
    if (!confirm) {
      return res.status(400).json({ message: 'confirm=true erforderlich' });
    }
    const days = sanitizeMaintenanceDays(olderThanDays, 180, 1, 3650);
    const cutoffExpr = `-${days} days`;
    const onlyClosed = closedOnly !== false;

    const db = getDatabase();
    const closedPlaceholders = ARCHIVE_CLOSED_TICKET_STATUSES.map(() => '?').join(', ');
    const tickets = await db.all(
      `SELECT t.*,
              c.name AS citizen_name,
              c.email AS citizen_email,
              c.preferred_language AS citizen_preferred_language,
              c.preferred_language_name AS citizen_preferred_language_name
       FROM tickets t
       LEFT JOIN citizens c ON c.id = t.citizen_id
       WHERE datetime(t.created_at) < datetime('now', ?)
         ${onlyClosed ? `AND t.status IN (${closedPlaceholders})` : ''}
       ORDER BY datetime(t.created_at) ASC`,
      onlyClosed ? [cutoffExpr, ...ARCHIVE_CLOSED_TICKET_STATUSES] : [cutoffExpr]
    );

    if (!Array.isArray(tickets) || tickets.length === 0) {
      return res.status(404).json({
        message: 'Keine passenden alten Tickets gefunden.',
        olderThanDays: days,
        closedOnly: onlyClosed,
      });
    }

    const ticketIds = Array.from(
      new Set(
        tickets
          .map((row: any) => String(row?.id || '').trim())
          .filter(Boolean)
      )
    );
    const submissionIds = Array.from(
      new Set(
        tickets
          .map((row: any) => String(row?.submission_id || '').trim())
          .filter(Boolean)
      )
    );

    const fetchRowsByIds = async (table: string, column: string, ids: string[]): Promise<any[]> => {
      if (!ids.length) return [];
      const rows: any[] = [];
      for (const chunk of chunkItems(ids, 350)) {
        const placeholders = chunk.map(() => '?').join(', ');
        const chunkRows = await db.all(`SELECT * FROM ${table} WHERE ${column} IN (${placeholders})`, chunk);
        rows.push(...(chunkRows || []));
      }
      return rows;
    };

    const [aiLogs, escalations, ticketValidations, workflowValidations, comments, dataRequests, labels, ticketPseudos, submissions, submissionImages] =
      await Promise.all([
        fetchRowsByIds('ai_logs', 'ticket_id', ticketIds),
        fetchRowsByIds('escalations', 'ticket_id', ticketIds),
        fetchRowsByIds('ticket_validations', 'ticket_id', ticketIds),
        fetchRowsByIds('workflow_validations', 'ticket_id', ticketIds),
        fetchRowsByIds('ticket_comments', 'ticket_id', ticketIds),
        fetchRowsByIds('workflow_data_requests', 'ticket_id', ticketIds),
        fetchRowsByIds('ticket_labels', 'ticket_id', ticketIds),
        fetchRowsByIds('ticket_reporter_pseudonyms', 'ticket_id', ticketIds),
        fetchRowsByIds('submissions', 'id', submissionIds),
        fetchRowsByIds('submission_images', 'submission_id', submissionIds),
      ]);

    const dataRequestIds = Array.from(
      new Set(
        dataRequests
          .map((row: any) => String(row?.id || '').trim())
          .filter(Boolean)
      )
    );
    const dataRequestAnswers = await fetchRowsByIds('workflow_data_request_answers', 'data_request_id', dataRequestIds);

    const archivePayload = {
      exportedAt: new Date().toISOString(),
      olderThanDays: days,
      closedOnly: onlyClosed,
      ticketCount: ticketIds.length,
      submissionCount: submissionIds.length,
      tickets: (tickets || []).map((row: any) => convertToCamelCase(row)),
      related: {
        aiLogs: (aiLogs || []).map((row: any) => convertToCamelCase(row)),
        escalations: (escalations || []).map((row: any) => convertToCamelCase(row)),
        ticketValidations: (ticketValidations || []).map((row: any) => convertToCamelCase(row)),
        workflowValidations: (workflowValidations || []).map((row: any) => convertToCamelCase(row)),
        comments: (comments || []).map((row: any) => convertToCamelCase(row)),
        dataRequests: (dataRequests || []).map((row: any) => convertToCamelCase(row)),
        dataRequestAnswers: (dataRequestAnswers || []).map((row: any) => convertToCamelCase(row)),
        labels: (labels || []).map((row: any) => convertToCamelCase(row)),
        ticketReporterPseudonyms: (ticketPseudos || []).map((row: any) => convertToCamelCase(row)),
        submissions: (submissions || []).map((row: any) => convertToCamelCase(row)),
        submissionImages: (submissionImages || []).map((row: any) => convertToCamelCase(row)),
      },
    };

    await db.exec('BEGIN');
    try {
      await deleteRowsByIds(db, 'workflow_validations', 'ticket_id', ticketIds);
      await deleteRowsByIds(db, 'ticket_validations', 'ticket_id', ticketIds);
      await deleteRowsByIds(db, 'ai_logs', 'ticket_id', ticketIds);
      await deleteRowsByIds(db, 'escalations', 'ticket_id', ticketIds);
      await deleteRowsByIds(db, 'ticket_comments', 'ticket_id', ticketIds);
      await deleteRowsByIds(db, 'workflow_data_requests', 'ticket_id', ticketIds);
      await deleteRowsByIds(db, 'ticket_labels', 'ticket_id', ticketIds);
      await deleteRowsByIds(db, 'ticket_reporter_pseudonyms', 'ticket_id', ticketIds);
      await deleteRowsByIds(db, 'tickets', 'id', ticketIds);
      await deleteRowsByIds(db, 'submission_images', 'submission_id', submissionIds);
      await deleteRowsByIds(db, 'submissions', 'id', submissionIds);
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const fileName = `ticket-archiv-${days}d-${stamp}.json`;
    const payloadJson = JSON.stringify(archivePayload, null, 2);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Archived-Tickets', String(ticketIds.length));
    res.setHeader('X-Archived-Submissions', String(submissionIds.length));
    return res.status(200).send(payloadJson);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Archivieren alter Tickets',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/maintenance/backup
 * SQL-Dump der Datenbank (ADMIN only)
 */
router.get('/maintenance/backup', adminOnly, async (_req: Request, res: Response) => {
  try {
    const sql = await buildSqlDump();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    let backupArtifactPath = '';
    try {
      const persisted = persistSqlBackupArtifact(sql, stamp);
      backupArtifactPath = persisted.relativePath;
    } catch (error) {
      console.warn('[maintenance/backup] Backup-Artefakt konnte nicht gespeichert werden:', error);
    }
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="behebes-ai-backup-${stamp}.sql"`);
    res.setHeader('X-Backup-Artifact-Stored', backupArtifactPath ? 'true' : 'false');
    if (backupArtifactPath) {
      res.setHeader('X-Backup-Artifact-Path', backupArtifactPath);
    }
    res.send(sql);
  } catch (error: any) {
    res.status(500).json({ message: 'Fehler beim Export', error: error?.message || String(error) });
  }
});

/**
 * POST /api/admin/maintenance/import
 * SQL-Dump importieren (ADMIN only)
 */
router.post(
  '/maintenance/import',
  adminOnly,
  express.text({ type: '*/*', limit: '200mb' }),
  async (req: Request, res: Response) => {
    try {
      const sql = typeof req.body === 'string' ? req.body : '';
      if (!sql.trim()) {
        return res.status(400).json({ message: 'SQL-Dump fehlt' });
      }

      const db = getDatabase();
      const normalized = sql.toUpperCase();
      const hasTransaction =
        normalized.includes('BEGIN TRANSACTION') ||
        normalized.includes('START TRANSACTION') ||
        normalized.includes('BEGIN') ||
        normalized.includes('COMMIT');

      if (!hasTransaction) {
        await db.exec('BEGIN');
      }
      try {
        await db.exec(sql);
        if (!hasTransaction) {
          await db.exec('COMMIT');
        }
      } catch (innerError) {
        if (!hasTransaction) {
          await db.exec('ROLLBACK');
        }
        throw innerError;
      }

      res.json({ message: 'Import erfolgreich abgeschlossen' });
    } catch (error: any) {
      res.status(500).json({ message: 'Import fehlgeschlagen', error: error?.message || String(error) });
    }
  }
);

export async function initializeAdminBackgroundLoops(): Promise<void> {
  try {
    await ensurePseudonymFillLoop();
    await ensureSituationReportAutoLoop();
  } catch (error) {
    console.warn('Failed to initialize admin background loops:', error);
  }
}

export default router;
