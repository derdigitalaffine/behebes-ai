/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Ticket Management API
 */

import express, { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, staffOnly } from '../middleware/auth.js';
import { isAdminRole } from '../utils/roles.js';
import { getDatabase } from '../database.js';
import { loadConfig } from '../config.js';
import { sendStatusChangeNotification } from '../services/email.js';
import { listMailboxMessagesForTicket } from '../services/mailbox.js';
import { queueSubmissionDescriptionTranslation } from '../services/ai.js';
import { loadGeneralSettings } from '../services/settings.js';
import {
  sendNewTicketEmailNotifications,
  sendTicketAssignmentEmailNotifications,
  type TicketAssignmentNotificationRecipient,
} from '../services/ticket-notifications.js';
import {
  extractFeedTokenFromRequest,
  markFeedTokenUsed,
  resolveActiveFeedToken,
} from '../services/feed-tokens.js';
import {
  analyzeImageToText,
  buildImageAiPseudonymizedTicketContext,
  computeImageContentHash,
} from '../services/image-ai.js';
import { publishTicketUpdate } from '../services/realtime.js';
import { attachWorkflowToTicket } from './workflows.js';
import { loadKnowledgeBase, sanitizeText } from '../services/classification.js';
import { enrichGeoAndWeather } from '../services/geo-enrichment.js';
import { formatSqlDateTime } from '../utils/sql-date.js';
import { buildTicketVisibilitySql, loadAdminAccessContext, requireTicketAccess, type AdminAccessContext } from '../services/rbac.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXECUTIONS_FILE = resolve(__dirname, '..', '..', 'knowledge', 'executions.json');
const config = loadConfig();

type WorkflowStatus = 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';

interface WorkflowExecutionSummary {
  id: string;
  ticketId: string;
  templateId?: string;
  title?: string;
  status: WorkflowStatus;
  startedAt?: string;
}

function normalizeIdList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entry of input) {
    const value = String(entry || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

async function getRequestAccessContext(req: Request): Promise<AdminAccessContext> {
  return loadAdminAccessContext(normalizeText((req as any).userId), normalizeText((req as any).role));
}

function resolveRequestContextTenantId(req: Request): string {
  const tenantFromQuery = normalizeText(req.query?.tenantId || req.query?.tenant_id);
  if (tenantFromQuery) return tenantFromQuery;
  const contextMode = normalizeText(req.headers['x-admin-context-mode']).toLowerCase();
  if (contextMode !== 'tenant') return '';
  return normalizeText(req.headers['x-admin-context-tenant-id']);
}

async function ensureTicketScope(
  req: Request,
  res: Response,
  ticketId: string,
  requireWrite = false
): Promise<AdminAccessContext | null> {
  const normalizedTicketId = normalizeText(ticketId);
  if (!normalizedTicketId) {
    res.status(400).json({ message: 'ticketId fehlt' });
    return null;
  }
  const userId = normalizeText((req as any).userId);
  const role = normalizeText((req as any).role);
  const result = await requireTicketAccess(userId, role, normalizedTicketId, requireWrite);
  if (!result.allowed) {
    res.status(403).json({ message: 'Keine Berechtigung für dieses Ticket' });
    return null;
  }

  const contextTenantId = resolveRequestContextTenantId(req);
  if (contextTenantId) {
    if (!result.access.isGlobalAdmin && !result.access.tenantIds.includes(contextTenantId)) {
      res.status(403).json({ message: 'Kein Zugriff auf den gewählten Mandanten.' });
      return null;
    }
    const db = getDatabase();
    const contextTicketRow = await db.get<any>(
      `SELECT tenant_id
       FROM tickets
       WHERE id = ?
       LIMIT 1`,
      [normalizedTicketId]
    );
    const ticketTenantId = normalizeText(contextTicketRow?.tenant_id);
    if (ticketTenantId && ticketTenantId !== contextTenantId) {
      res.status(404).json({ message: 'Ticket im gewählten Mandantenkontext nicht gefunden.' });
      return null;
    }
  }
  return result.access;
}

// Helper: Convert snake_case database columns to camelCase for frontend
function convertToCamelCase(obj: any): any {
  if (!obj) return obj;
  
  const result: any = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = obj[key];
  }
  return result;
}

function parseTimestamp(input?: string): number {
  if (!input) return 0;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function toIsoTimestamp(input?: string): string {
  if (!input) return new Date().toISOString();
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function escapeXml(input: unknown): string {
  const value = String(input ?? '');
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeResponsibilityAuthorityKey(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function resolveResponsibilityAuthority(
  value: unknown,
  allowedAuthorities: string[]
): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const lookup = new Map<string, string>();
  for (const entry of allowedAuthorities) {
    const normalized = normalizeResponsibilityAuthorityKey(entry);
    if (!normalized || lookup.has(normalized)) continue;
    lookup.set(normalized, entry);
  }
  return lookup.get(normalizeResponsibilityAuthorityKey(raw)) || null;
}

async function loadAllowedResponsibilityAuthorities(): Promise<string[]> {
  const { values } = await loadGeneralSettings();
  if (!Array.isArray(values?.responsibilityAuthorities)) return [];
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const rawEntry of values.responsibilityAuthorities) {
    const value = normalizeText(rawEntry);
    if (!value) continue;
    const key = normalizeResponsibilityAuthorityKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push(value);
    if (entries.length >= 30) break;
  }
  return entries;
}

function isGermanLanguageCode(value: unknown): boolean {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'de' || normalized.startsWith('de-');
}

function parseCommentMetadata(raw: unknown): Record<string, any> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, any>;
  } catch {
    return null;
  }
}

function parseJsonValue<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseNominatimRaw(raw: unknown): Record<string, any> | null {
  const parsed = parseJsonValue<Record<string, any> | null>(raw, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

function parseWeatherReportRaw(raw: unknown): Record<string, any> | null {
  const parsed = parseJsonValue<Record<string, any> | null>(raw, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

type ReporterPseudonymPoolType = 'name' | 'email';

function hashNormalizedReporterValue(value: string): string {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function sanitizeReporterPseudonymName(raw: unknown): string {
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

function normalizeReporterPoolEntries(input: unknown, poolType: ReporterPseudonymPoolType): string[] {
  const source = Array.isArray(input)
    ? input
    : typeof input === 'string'
    ? (() => {
        try {
          return JSON.parse(input);
        } catch {
          return [];
        }
      })()
    : input && typeof input === 'object' && Array.isArray((input as any).entries)
    ? (input as any).entries
    : [];

  const values = Array.isArray(source) ? source : [];
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const rawEntry of values) {
    const entry =
      poolType === 'name'
        ? sanitizeReporterPseudonymName(rawEntry)
        : String(rawEntry || '')
            .trim()
            .toLowerCase();
    if (!entry) continue;
    if (poolType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    entries.push(entry);
    if (entries.length >= 10000) break;
  }
  return entries;
}

async function loadReporterPseudonymPool(poolType: ReporterPseudonymPoolType): Promise<string[]> {
  const db = getDatabase();
  const row = await db.get(
    `SELECT entries_json
     FROM llm_pseudonym_pools
     WHERE pool_type = ?
     ORDER BY version DESC, updated_at DESC, created_at DESC
     LIMIT 1`,
    [poolType]
  );
  return normalizeReporterPoolEntries(row?.entries_json, poolType);
}

function fallbackReporterPseudoName(index: number): string {
  return `Reporter-${String(index + 1).padStart(4, '0')}`;
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

function fallbackReporterPseudoEmail(index: number): string {
  const normalizedIndex = Math.max(0, Math.floor(index));
  const firstStem = FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS[normalizedIndex % FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS.length];
  const secondStem =
    FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS[
      Math.floor(normalizedIndex / FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS.length) % FALLBACK_PSEUDO_EMAIL_DOMAIN_STEMS.length
    ];
  const stem = firstStem === secondStem ? firstStem : `${firstStem}${secondStem}`;
  const tld = FALLBACK_PSEUDO_EMAIL_TLDS[normalizedIndex % FALLBACK_PSEUDO_EMAIL_TLDS.length];
  return `reporter-${String(normalizedIndex + 1).padStart(4, '0')}@${stem}.${tld}`;
}

async function ensureReporterPseudonymValue(input: {
  scopeKey: string;
  entityType: ReporterPseudonymPoolType;
  realValue: string;
  pool: string[];
  fallback: (index: number) => string;
  ttlDays?: number;
}): Promise<string> {
  const db = getDatabase();
  const normalized = String(input.realValue || '').trim();
  if (!normalized) return '';
  const ttlDays = Number.isFinite(Number(input.ttlDays)) ? Math.max(1, Number(input.ttlDays)) : 90;
  const hash = hashNormalizedReporterValue(normalized);
  const existing = await db.get(
    `SELECT pseudo_value
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
    return String(existing.pseudo_value);
  }

  const usedRows = await db.all(
    `SELECT pseudo_value
     FROM llm_pseudonym_mappings
     WHERE scope_key = ?
       AND entity_type = ?
       AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))`,
    [input.scopeKey, input.entityType]
  );
  const used = new Set((usedRows || []).map((row: any) => String(row?.pseudo_value || '').trim()).filter(Boolean));
  const fromPool = input.pool.find((candidate) => !used.has(candidate));
  const pseudo = fromPool || input.fallback(used.size);
  const expiresAt = formatSqlDateTime(new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000));

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

function splitReporterPseudoName(value: string): { firstName: string; lastName: string } {
  const normalized = String(value || '').trim();
  if (!normalized) return { firstName: '', lastName: '' };
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
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
  const ticketId = normalizeText(input.ticketId);
  if (!ticketId) return;
  const pseudoName = normalizeText(input.pseudoName);
  const pseudoEmail = normalizeText(input.pseudoEmail);
  const split = splitReporterPseudoName(pseudoName);
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

async function ensureTicketReporterPseudonym(ticketId: string, citizenName: string, citizenEmail: string): Promise<void> {
  const scopeKey = 'ticket-reporter-stable';
  const [namePool, emailPool] = await Promise.all([
    loadReporterPseudonymPool('name'),
    loadReporterPseudonymPool('email'),
  ]);
  const pseudoName = await ensureReporterPseudonymValue({
    scopeKey,
    entityType: 'name',
    realValue: citizenName || citizenEmail || `ticket:${ticketId}`,
    pool: namePool,
    fallback: fallbackReporterPseudoName,
    ttlDays: 90,
  });
  const pseudoEmail = await ensureReporterPseudonymValue({
    scopeKey,
    entityType: 'email',
    realValue: citizenEmail || citizenName || `ticket:${ticketId}`,
    pool: emailPool,
    fallback: fallbackReporterPseudoEmail,
    ttlDays: 90,
  });
  await upsertTicketReporterPseudonym({
    ticketId,
    scopeKey,
    pseudoName,
    pseudoEmail,
  });
}

async function geocodeAddressWithNominatim(query: string): Promise<{
  latitude: number;
  longitude: number;
  address: string;
  postalCode: string;
  city: string;
  source: string;
  nominatimRaw: Record<string, any> | null;
} | null> {
  const trimmed = normalizeText(query);
  if (!trimmed) return null;
  const endpoint = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(
    trimmed
  )}`;
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'behebes-ai/1.0 (Verbandsgemeinde Otterbach Otterberg)',
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Geocoding fehlgeschlagen (${response.status}).`);
  }
  const payload = (await response.json()) as any[];
  const hit = Array.isArray(payload) ? payload[0] : null;
  if (!hit) return null;

  const latitude = Number(hit.lat);
  const longitude = Number(hit.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const details = hit.address && typeof hit.address === 'object' ? hit.address : {};
  const city =
    normalizeText(details.city) ||
    normalizeText(details.town) ||
    normalizeText(details.village) ||
    normalizeText(details.municipality);
  const postalCode = normalizeText(details.postcode);
  const displayName = normalizeText(hit.display_name);

  return {
    latitude,
    longitude,
    address: displayName || trimmed,
    postalCode,
    city,
    source: 'nominatim',
    nominatimRaw: hit && typeof hit === 'object' ? (hit as Record<string, any>) : null,
  };
}

function normalizeImageBuffer(value: any): Buffer | null {
  // Accept sqlite blob representations from different drivers/runtime paths.
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    try {
      return Buffer.from(value, 'base64');
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    try {
      return Buffer.from(value);
    } catch {
      return null;
    }
  }
  if (value?.type === 'Buffer' && Array.isArray(value?.data)) {
    try {
      return Buffer.from(value.data);
    } catch {
      return null;
    }
  }
  return null;
}

function guessImageMimeType(fileName?: string, buffer?: Buffer | null): string {
  const lowered = (fileName || '').toLowerCase();
  if (lowered.endsWith('.png')) return 'image/png';
  if (lowered.endsWith('.gif')) return 'image/gif';
  if (lowered.endsWith('.webp')) return 'image/webp';
  if (lowered.endsWith('.bmp')) return 'image/bmp';
  if (lowered.endsWith('.svg')) return 'image/svg+xml';
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) return 'image/jpeg';

  if (!buffer || buffer.length < 4) return 'image/jpeg';
  const signature = buffer.subarray(0, 4).toString('hex');
  if (signature === '89504e47') return 'image/png';
  if (signature.startsWith('ffd8ff')) return 'image/jpeg';
  if (signature === '47494638') return 'image/gif';
  if (signature === '52494646') return 'image/webp';
  return 'image/jpeg';
}

interface ImageExifSummary {
  hasExif: boolean;
  hasGps: boolean;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  orientation: number | null;
}

function parseImageExifSummary(raw: unknown): ImageExifSummary | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const gpsLatitude = Number(parsed?.gpsLatitude);
    const gpsLongitude = Number(parsed?.gpsLongitude);
    const width = Number(parsed?.width);
    const height = Number(parsed?.height);
    const orientation = Number(parsed?.orientation);
    return {
      hasExif: parsed?.hasExif === true,
      hasGps: parsed?.hasGps === true,
      gpsLatitude: Number.isFinite(gpsLatitude) ? gpsLatitude : null,
      gpsLongitude: Number.isFinite(gpsLongitude) ? gpsLongitude : null,
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
      format: typeof parsed?.format === 'string' ? parsed.format : null,
      orientation: Number.isFinite(orientation) ? orientation : null,
    };
  } catch {
    return null;
  }
}

type ImageAiStatus = 'idle' | 'processing' | 'done' | 'failed';

interface TicketImageAiSummary {
  status: ImageAiStatus;
  description: string | null;
  confidence: number | null;
  model: string | null;
  error: string | null;
  updatedAt: string | null;
}

function normalizeImageAiStatus(value: unknown): ImageAiStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'processing' || normalized === 'done' || normalized === 'failed') {
    return normalized as ImageAiStatus;
  }
  return 'idle';
}

function parseImageAiSummary(row: any): TicketImageAiSummary {
  const confidenceRaw = Number(row?.ai_description_confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : null;
  const description =
    typeof row?.ai_description_text === 'string' && row.ai_description_text.trim()
      ? row.ai_description_text.trim()
      : null;
  const model =
    typeof row?.ai_description_model === 'string' && row.ai_description_model.trim()
      ? row.ai_description_model.trim()
      : null;
  const error =
    typeof row?.ai_description_error === 'string' && row.ai_description_error.trim()
      ? row.ai_description_error.trim()
      : null;
  const updatedAt =
    typeof row?.ai_description_updated_at === 'string' && row.ai_description_updated_at.trim()
      ? row.ai_description_updated_at
      : null;
  return {
    status: normalizeImageAiStatus(row?.ai_description_status),
    description,
    confidence,
    model,
    error,
    updatedAt,
  };
}

function buildTicketImagePayload(row: any): Record<string, any> | null {
  const buffer = normalizeImageBuffer(row?.image_data);
  if (!buffer) return null;
  const mimeType = guessImageMimeType(row?.file_name, buffer);
  const exifSummary = parseImageExifSummary(row?.exif_json);
  return {
    id: row.id,
    fileName: row.file_name || 'bild',
    createdAt: row.created_at || null,
    byteSize: buffer.length,
    mimeType,
    exif: exifSummary,
    analysis: parseImageAiSummary(row),
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
  };
}

function loadWorkflowSummariesByTicket(): Map<string, WorkflowExecutionSummary> {
  try {
    const raw = readFileSync(EXECUTIONS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const executions = Array.isArray(parsed) ? parsed : [];
    const result = new Map<string, WorkflowExecutionSummary>();

    for (const entry of executions) {
      const ticketId = typeof entry?.ticketId === 'string' ? entry.ticketId : '';
      if (!ticketId) continue;
      const status = typeof entry?.status === 'string' ? entry.status : '';
      if (!['RUNNING', 'PAUSED', 'COMPLETED', 'FAILED'].includes(status)) continue;

      const current: WorkflowExecutionSummary = {
        id: String(entry.id || ''),
        ticketId,
        templateId: typeof entry?.templateId === 'string' ? entry.templateId : undefined,
        title: typeof entry?.title === 'string' ? entry.title : undefined,
        status: status as WorkflowStatus,
        startedAt: typeof entry?.startedAt === 'string' ? entry.startedAt : undefined,
      };

      const existing = result.get(ticketId);
      if (!existing || parseTimestamp(current.startedAt) >= parseTimestamp(existing.startedAt)) {
        result.set(ticketId, current);
      }
    }

    return result;
  } catch {
    return new Map<string, WorkflowExecutionSummary>();
  }
}

// Alle Ticket-Routes erfordern Admin-Authentifizierung,
// ausser Atom-Feed (token-basiert fuer Feed-Reader ohne Bearer-Header).
router.use((req: Request, res: Response, next) => {
  if (req.path === '/feed/atom') {
    return next();
  }
  return authMiddleware(req, res, () => staffOnly(req, res, next));
});

/**
 * GET /api/tickets
 * Liste aller Tickets mit Filterung
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, priority, category } = req.query;
    const owningOrgUnitIdFilter = normalizeText(req.query?.owningOrgUnitId || req.query?.owning_org_unit_id);
    const assignmentFilter = normalizeText(req.query?.assignment).toLowerCase();
    const limitRaw = Number(req.query?.limit);
    const offsetRaw = Number(req.query?.offset);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
    const db = getDatabase();
    const access = await getRequestAccessContext(req);
    const tenantIdFilter = resolveRequestContextTenantId(req);
    if (tenantIdFilter && !access.isGlobalAdmin && !access.tenantIds.includes(tenantIdFilter)) {
      return res.status(403).json({ message: 'Kein Zugriff auf den gewählten Mandanten.' });
    }
    const visibility = buildTicketVisibilitySql(access, { tableAlias: 't', requireWrite: false });
    
    let query = `
      SELECT t.*, c.name AS citizen_name, c.email AS citizen_email,
             COALESCE(t.citizen_language, c.preferred_language) AS citizen_preferred_language,
             COALESCE(t.citizen_language_name, c.preferred_language_name) AS citizen_preferred_language_name,
             tp.pseudo_name AS reporter_pseudo_name,
             tp.pseudo_first_name AS reporter_pseudo_first_name,
             tp.pseudo_last_name AS reporter_pseudo_last_name,
             tp.pseudo_email AS reporter_pseudo_email,
             tp.scope_key AS reporter_pseudo_scope_key,
             COALESCE(img.image_count, 0) AS image_count,
             s.original_description AS original_description,
             s.translated_description_de AS translated_description_de,
             s.anonymized_text AS anonymized_text
      FROM tickets t 
      JOIN citizens c ON t.citizen_id = c.id
      JOIN submissions s ON t.submission_id = s.id
      LEFT JOIN ticket_reporter_pseudonyms tp ON tp.ticket_id = t.id
      LEFT JOIN (
        SELECT submission_id, COUNT(*) AS image_count
        FROM submission_images
        GROUP BY submission_id
      ) img ON img.submission_id = t.submission_id
      WHERE 1=1
    `;
    const params: any[] = [];

    query += ` AND (${visibility.sql})`;
    params.push(...visibility.params);
    
    if (status) {
      query += ` AND t.status = ?`;
      params.push(status);
    }
    if (priority) {
      query += ` AND t.priority = ?`;
      params.push(priority);
    }
    if (category) {
      query += ` AND t.category = ?`;
      params.push(category);
    }

    if (tenantIdFilter) {
      query += ` AND t.tenant_id = ?`;
      params.push(tenantIdFilter);
    }

    if (owningOrgUnitIdFilter) {
      query += ` AND t.owning_org_unit_id = ?`;
      params.push(owningOrgUnitIdFilter);
    }

    if (assignmentFilter === 'me') {
      query += ` AND (
        t.primary_assignee_user_id = ?
        OR t.id IN (
          SELECT tc.ticket_id
          FROM ticket_collaborators tc
          WHERE tc.user_id = ?
        )
      )`;
      params.push(normalizeText(req.userId), normalizeText(req.userId));
    } else if (assignmentFilter === 'my_units') {
      const orgIds = access.readableOrgUnitIds || [];
      if (orgIds.length === 0) {
        query += ` AND 1=0`;
      } else {
        const placeholders = orgIds.map(() => '?').join(', ');
        query += ` AND (
          t.owning_org_unit_id IN (${placeholders})
          OR t.primary_assignee_org_unit_id IN (${placeholders})
          OR t.id IN (
            SELECT tc.ticket_id
            FROM ticket_collaborators tc
            WHERE tc.org_unit_id IN (${placeholders})
          )
        )`;
        params.push(...orgIds, ...orgIds, ...orgIds);
      }
    } else if (assignmentFilter === 'unassigned') {
      query += ` AND t.primary_assignee_user_id IS NULL
                 AND t.primary_assignee_org_unit_id IS NULL
                 AND NOT EXISTS (
                   SELECT 1
                   FROM ticket_collaborators tc
                   WHERE tc.ticket_id = t.id
                 )`;
    } else if (assignmentFilter.startsWith('user:')) {
      const assigneeUserId = normalizeText(assignmentFilter.slice('user:'.length));
      if (assigneeUserId) {
        query += ` AND (
          t.primary_assignee_user_id = ?
          OR t.id IN (
            SELECT tc.ticket_id
            FROM ticket_collaborators tc
            WHERE tc.user_id = ?
          )
        )`;
        params.push(assigneeUserId, assigneeUserId);
      }
    } else if (assignmentFilter.startsWith('org:')) {
      const assigneeOrgId = normalizeText(assignmentFilter.slice('org:'.length));
      if (assigneeOrgId) {
        query += ` AND (
          t.primary_assignee_org_unit_id = ?
          OR t.owning_org_unit_id = ?
          OR t.id IN (
            SELECT tc.ticket_id
            FROM ticket_collaborators tc
            WHERE tc.org_unit_id = ?
          )
        )`;
        params.push(assigneeOrgId, assigneeOrgId, assigneeOrgId);
      }
    }
    
    query += ` ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    const tickets = await db.all(query, params);
    const workflowSummaries = loadWorkflowSummariesByTicket();
    const convertedTickets = tickets.map((ticketRow) => {
      const converted = convertToCamelCase(ticketRow);
      const workflow = workflowSummaries.get(converted.id);
      const imageCount = Number(converted.imageCount || 0);
      return {
        ...converted,
        imageCount,
        hasImages: imageCount > 0,
        workflowStarted: !!workflow,
        workflowStatus: workflow?.status || null,
        workflowExecutionId: workflow?.id || null,
        workflowTemplateId: workflow?.templateId || null,
        workflowTitle: workflow?.title || null,
      };
    });
    res.json(convertedTickets);
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Abrufen der Tickets' });
  }
});

/**
 * GET /api/tickets/feed/atom
 * Atom Feed der Ticketliste (user-spezifischer Feed-Token)
 */
router.get('/feed/atom', async (req: Request, res: Response) => {
  try {
    const providedToken = extractFeedTokenFromRequest(req, 'x-ticket-feed-token');
    const resolvedToken = await resolveActiveFeedToken('tickets', providedToken);
    if (!resolvedToken) {
      res.setHeader('WWW-Authenticate', 'Basic realm="behebes-ticket-feed"');
      return res.status(401).json({
        message: 'Feed-Authentifizierung fehlgeschlagen. Bitte persönlichen Feed-Token verwenden.',
      });
    }
    await markFeedTokenUsed(resolvedToken.id);

    const db = getDatabase();
    const statusFilter = normalizeText(req.query?.status || '');
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;

    let query = `
      SELECT t.id,
             t.category,
             t.status,
             t.priority,
             t.address,
             t.city,
             t.created_at,
             t.updated_at,
             c.name AS citizen_name,
             c.email AS citizen_email,
             COALESCE(img.image_count, 0) AS image_count
      FROM tickets t
      JOIN citizens c ON c.id = t.citizen_id
      LEFT JOIN (
        SELECT submission_id, COUNT(*) AS image_count
        FROM submission_images
        GROUP BY submission_id
      ) img ON img.submission_id = t.submission_id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (statusFilter) {
      query += ' AND t.status = ?';
      params.push(statusFilter);
    }
    query += ' ORDER BY COALESCE(t.updated_at, t.created_at) DESC LIMIT ?';
    params.push(limit);

    const rows = await db.all(query, params);
    const workflowSummaries = loadWorkflowSummariesByTicket();
    const adminBaseUrl = String(config.adminUrl || '').trim().replace(/\/+$/, '') || 'http://localhost:5174';
    const requestHost = req.get('host') || `localhost:${config.port}`;
    const selfUrlObject = new URL(`${req.protocol}://${requestHost}${req.originalUrl || req.path}`);
    selfUrlObject.searchParams.delete('token');
    const selfUrl = selfUrlObject.toString();
    const feedUpdatedAt = rows.length > 0
      ? toIsoTimestamp(rows[0]?.updated_at || rows[0]?.created_at)
      : new Date().toISOString();

    const entries = (rows || [])
      .map((row: any) => {
        const ticketId = String(row?.id || '').trim();
        if (!ticketId) return '';
        const ticketUrl = `${adminBaseUrl}/tickets/${encodeURIComponent(ticketId)}`;
        const workflow = workflowSummaries.get(ticketId);
        const reporter = normalizeText(row?.citizen_name) || normalizeText(row?.citizen_email) || 'Unbekannt';
        const summaryLines = [
          `Kategorie: ${normalizeText(row?.category) || '–'}`,
          `Status: ${normalizeText(row?.status) || '–'}`,
          `Prioritaet: ${normalizeText(row?.priority) || '–'}`,
          `Ort: ${normalizeText(row?.city) || normalizeText(row?.address) || '–'}`,
          `Meldende Person: ${reporter}`,
          `Bilder: ${Number(row?.image_count || 0)}`,
          `Workflow: ${workflow ? `${normalizeText(workflow.title) || workflow.id} (${workflow.status})` : 'Nicht gestartet'}`,
        ].join('\n');
        const title = `[${normalizeText(row?.status) || 'ticket'}] ${normalizeText(row?.category) || 'Ticket'} · ${ticketId.slice(0, 8)}`;
        const updated = toIsoTimestamp(row?.updated_at || row?.created_at);
        const published = toIsoTimestamp(row?.created_at || row?.updated_at);

        return [
          '<entry>',
          `  <id>urn:behebes:ticket:${escapeXml(ticketId)}</id>`,
          `  <title>${escapeXml(title)}</title>`,
          `  <updated>${escapeXml(updated)}</updated>`,
          `  <published>${escapeXml(published)}</published>`,
          `  <link href="${escapeXml(ticketUrl)}" rel="alternate" />`,
          `  <author><name>${escapeXml(reporter)}</name></author>`,
          `  <summary>${escapeXml(summaryLines)}</summary>`,
          '</entry>',
        ].join('\n');
      })
      .filter(Boolean)
      .join('\n');

    const feed = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom">',
      '  <id>urn:behebes:tickets:feed</id>',
      '  <title>behebes.AI Tickets</title>',
      `  <updated>${escapeXml(feedUpdatedAt)}</updated>`,
      `  <link rel="self" href="${escapeXml(selfUrl)}" />`,
      `  <link rel="alternate" href="${escapeXml(adminBaseUrl)}/tickets" />`,
      entries,
      '</feed>',
    ].join('\n');

    res.setHeader('Content-Type', 'application/atom+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).send(feed);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Erstellen des Atom-Feeds',
      error: error?.message || 'Unbekannter Fehler',
    });
  }
});

/**
 * POST /api/tickets
 * Ticket manuell im Admin anlegen
 */
router.post('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const access = await getRequestAccessContext(req);

    const citizenName = normalizeText(req.body?.citizenName || req.body?.name || '');
    const citizenEmail = normalizeText(req.body?.citizenEmail || req.body?.email || '').toLowerCase();
    const category = normalizeText(req.body?.category || 'Sonstiges') || 'Sonstiges';
    const responsibilityAuthorityRaw = normalizeText(req.body?.responsibilityAuthority || '');
    const priorityRaw = normalizeText(req.body?.priority || 'medium').toLowerCase();
    const statusRaw = normalizeText(req.body?.status || 'open').toLowerCase();
    const originalDescription = normalizeText(req.body?.description || '');
    const address = normalizeText(req.body?.address || '') || null;
    const postalCode = normalizeText(req.body?.postalCode || '') || null;
    const city = normalizeText(req.body?.city || '') || null;
    const assignedTo = normalizeText(req.body?.assignedTo || '') || null;
    const tenantIdRaw = normalizeText(req.body?.tenantId || req.body?.tenant_id);
    const owningOrgUnitId = normalizeText(req.body?.owningOrgUnitId || req.body?.owning_org_unit_id) || null;
    const primaryAssigneeUserId = normalizeText(
      req.body?.primaryAssigneeUserId || req.body?.primary_assignee_user_id
    ) || null;
    const primaryAssigneeOrgUnitId = normalizeText(
      req.body?.primaryAssigneeOrgUnitId || req.body?.primary_assignee_org_unit_id
    ) || null;
    const collaboratorUserIds = normalizeIdList(
      req.body?.collaboratorUserIds || req.body?.collaborator_user_ids
    );
    const collaboratorOrgUnitIds = normalizeIdList(
      req.body?.collaboratorOrgUnitIds || req.body?.collaborator_org_unit_ids
    );

    if (!citizenName) {
      return res.status(400).json({ message: 'citizenName ist erforderlich.' });
    }
    if (!citizenEmail) {
      return res.status(400).json({ message: 'citizenEmail ist erforderlich.' });
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(citizenEmail)) {
      return res.status(400).json({ message: 'Ungültige E-Mail-Adresse.' });
    }
    if (!originalDescription) {
      return res.status(400).json({ message: 'description ist erforderlich.' });
    }
    const allowedResponsibilityAuthorities = await loadAllowedResponsibilityAuthorities();
    const responsibilityAuthority = resolveResponsibilityAuthority(
      responsibilityAuthorityRaw,
      allowedResponsibilityAuthorities
    );
    if (responsibilityAuthorityRaw && !responsibilityAuthority) {
      return res.status(400).json({
        message: `Ungueltige Zustaendigkeit. Erlaubt: ${allowedResponsibilityAuthorities.join(', ') || 'keine'}.`,
      });
    }

    const allowedStatuses = new Set([
      'pending_validation',
      'pending',
      'open',
      'assigned',
      'in-progress',
      'completed',
      'closed',
    ]);
    const allowedPriorities = new Set(['low', 'medium', 'high', 'critical']);
    if (!allowedStatuses.has(statusRaw)) {
      return res.status(400).json({ message: 'Ungueltiger Status' });
    }
    if (!allowedPriorities.has(priorityRaw)) {
      return res.status(400).json({ message: 'Ungueltige Prioritaet' });
    }
    if (primaryAssigneeUserId && primaryAssigneeOrgUnitId) {
      return res.status(400).json({
        message: 'Es darf nur ein primaerer Bearbeiter gesetzt werden (Benutzer ODER Organisationseinheit).',
      });
    }

    const tenantId = tenantIdRaw || access.tenantIds[0] || 'tenant_default';
    if (!access.isGlobalAdmin && !access.tenantIds.includes(tenantId)) {
      return res.status(403).json({ message: 'Kein Zugriff auf den gewaehlten Mandanten.' });
    }
    const hasTenantWriteAdmin = access.tenantAdminTenantIds.includes(tenantId);
    const hasTenantWriteScope = access.orgScopes.some((scope) => scope.tenantId === tenantId && scope.canWrite);
    if (!access.isGlobalAdmin && !hasTenantWriteAdmin && !hasTenantWriteScope) {
      return res.status(403).json({ message: 'Keine Schreibrechte im gewaehlten Mandanten.' });
    }

    const latitudeRaw = req.body?.latitude;
    const longitudeRaw = req.body?.longitude;
    const latitude =
      latitudeRaw === null || latitudeRaw === undefined || latitudeRaw === ''
        ? null
        : Number(latitudeRaw);
    const longitude =
      longitudeRaw === null || longitudeRaw === undefined || longitudeRaw === ''
        ? null
        : Number(longitudeRaw);
    if (latitude !== null && !Number.isFinite(latitude)) {
      return res.status(400).json({ message: 'Ungueltiger Breitengrad' });
    }
    if (longitude !== null && !Number.isFinite(longitude)) {
      return res.status(400).json({ message: 'Ungueltiger Laengengrad' });
    }

    const tenantRow = await db.get(`SELECT id FROM tenants WHERE id = ?`, [tenantId]);
    if (!tenantRow?.id) {
      return res.status(400).json({ message: 'Unbekannter Mandant.' });
    }

    if (owningOrgUnitId) {
      const owningOrg = await db.get(
        `SELECT id
         FROM org_units
         WHERE id = ?
           AND tenant_id = ?`,
        [owningOrgUnitId, tenantId]
      );
      if (!owningOrg?.id) {
        return res.status(400).json({ message: 'owningOrgUnitId ist im Mandanten nicht vorhanden.' });
      }
      if (!access.isGlobalAdmin && !hasTenantWriteAdmin && !access.writableOrgUnitIds.includes(owningOrgUnitId)) {
        return res.status(403).json({ message: 'Keine Schreibrechte auf die gewaehlte owningOrgUnit.' });
      }
    }

    if (primaryAssigneeUserId) {
      const assigneeUser = await db.get(`SELECT id FROM admin_users WHERE id = ?`, [primaryAssigneeUserId]);
      if (!assigneeUser?.id) {
        return res.status(400).json({ message: 'primaryAssigneeUserId ist unbekannt.' });
      }
    }

    if (primaryAssigneeOrgUnitId) {
      const assigneeOrg = await db.get(
        `SELECT id
         FROM org_units
         WHERE id = ?
           AND tenant_id = ?`,
        [primaryAssigneeOrgUnitId, tenantId]
      );
      if (!assigneeOrg?.id) {
        return res.status(400).json({ message: 'primaryAssigneeOrgUnitId ist im Mandanten nicht vorhanden.' });
      }
    }

    if (collaboratorUserIds.length > 0) {
      const placeholders = collaboratorUserIds.map(() => '?').join(', ');
      const existingUsers = await db.all<any>(
        `SELECT id
         FROM admin_users
         WHERE id IN (${placeholders})`,
        collaboratorUserIds
      );
      const existingSet = new Set((existingUsers || []).map((row: any) => String(row?.id || '').trim()));
      const missing = collaboratorUserIds.filter((id) => !existingSet.has(id));
      if (missing.length > 0) {
        return res.status(400).json({ message: `Unbekannte collaboratorUserIds: ${missing.join(', ')}` });
      }
    }

    if (collaboratorOrgUnitIds.length > 0) {
      const placeholders = collaboratorOrgUnitIds.map(() => '?').join(', ');
      const existingOrgs = await db.all<any>(
        `SELECT id
         FROM org_units
         WHERE tenant_id = ?
           AND id IN (${placeholders})`,
        [tenantId, ...collaboratorOrgUnitIds]
      );
      const existingSet = new Set((existingOrgs || []).map((row: any) => String(row?.id || '').trim()));
      const missing = collaboratorOrgUnitIds.filter((id) => !existingSet.has(id));
      if (missing.length > 0) {
        return res.status(400).json({ message: `Unbekannte collaboratorOrgUnitIds: ${missing.join(', ')}` });
      }
    }

    const existingCitizen = await db.get(
      `SELECT id, preferred_language, preferred_language_name
       FROM citizens
       WHERE email = ?`,
      [citizenEmail]
    );
    const citizenId = existingCitizen?.id || uuidv4();
    const ticketLanguageCode = normalizeText(
      req.body?.citizenLanguage || req.body?.language || existingCitizen?.preferred_language || 'de'
    ).toLowerCase() || 'de';
    const ticketLanguageName = normalizeText(
      req.body?.citizenLanguageName || req.body?.languageName || existingCitizen?.preferred_language_name || ''
    ) || ticketLanguageCode;
    if (existingCitizen) {
      await db.run(
        `UPDATE citizens
         SET name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [citizenName, citizenId]
      );
    } else {
      await db.run(
        `INSERT INTO citizens (id, email, name)
         VALUES (?, ?, ?)`,
        [citizenId, citizenEmail, citizenName]
      );
    }

    const submissionId = uuidv4();
    const anonymizedText = sanitizeText(originalDescription);
    await db.run(
      `INSERT INTO submissions (
        id, citizen_id, anonymized_text, original_description, category, priority,
        latitude, longitude, address, postal_code, city, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        submissionId,
        citizenId,
        anonymizedText,
        originalDescription,
        category,
        priorityRaw,
        latitude,
        longitude,
        address,
        postalCode,
        city,
        statusRaw,
      ]
    );

    const ticketId = uuidv4();
    const legacyAssignedTo = assignedTo || primaryAssigneeUserId || primaryAssigneeOrgUnitId || null;
    await db.run(
      `INSERT INTO tickets (
        id, submission_id, citizen_id, citizen_language, citizen_language_name, category, responsibility_authority, priority, description, status,
        latitude, longitude, address, postal_code, city, assigned_to,
        tenant_id, owning_org_unit_id, primary_assignee_user_id, primary_assignee_org_unit_id, assignment_updated_by, assignment_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        ticketId,
        submissionId,
        citizenId,
        ticketLanguageCode,
        ticketLanguageName,
        category,
        responsibilityAuthority,
        priorityRaw,
        anonymizedText || null,
        statusRaw,
        latitude,
        longitude,
        address,
        postalCode,
        city,
        legacyAssignedTo,
        tenantId,
        owningOrgUnitId,
        primaryAssigneeUserId,
        primaryAssigneeOrgUnitId,
        normalizeText(req.userId) || null,
      ]
    );

    const collaboratorRows = [
      ...collaboratorUserIds.map((userId) => ({ userId, orgUnitId: null as string | null })),
      ...collaboratorOrgUnitIds.map((orgUnitId) => ({ userId: null as string | null, orgUnitId })),
    ];
    for (const collaborator of collaboratorRows) {
      await db.run(
        `INSERT INTO ticket_collaborators (id, ticket_id, tenant_id, user_id, org_unit_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          `tcoll_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          ticketId,
          tenantId,
          collaborator.userId,
          collaborator.orgUnitId,
          normalizeText(req.userId) || null,
        ]
      );
    }

    try {
      await ensureTicketReporterPseudonym(ticketId, citizenName, citizenEmail);
    } catch (error) {
      console.warn('Could not create reporter pseudonym for manual ticket:', error);
    }

    const commentId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await db.run(
      `INSERT INTO ticket_comments (
        id, ticket_id, author_type, author_id, author_name, visibility, comment_type, content, metadata_json
      ) VALUES (?, ?, 'staff', ?, ?, 'internal', 'note', ?, ?)`,
      [
        commentId,
        ticketId,
        normalizeText((req as any).userId) || null,
        normalizeText((req as any).username) || null,
        'Ticket im Admin manuell angelegt.',
        JSON.stringify({
          source: 'admin.ticket.create',
          initialStatus: statusRaw,
          initialPriority: priorityRaw,
          category,
          responsibilityAuthority: responsibilityAuthority || null,
        }),
      ]
    );

    if (!isGermanLanguageCode(ticketLanguageCode) && originalDescription) {
      void queueSubmissionDescriptionTranslation({
        submissionId,
        ticketId,
        sourceText: originalDescription,
        sourceLanguage: ticketLanguageCode,
        sourceLanguageName: ticketLanguageName,
      }).catch((error) => {
        console.warn('Background translation enqueue failed for manual ticket:', error);
      });
    }

    let workflowExecution: any = null;
    const startWorkflow = req.body?.startWorkflow === true || req.body?.startWorkflow === 'true';
    if (startWorkflow) {
      let templateId = normalizeText(req.body?.workflowTemplateId || '');
      if (!templateId) {
        try {
          const knowledge = await loadKnowledgeBase();
          const categories = Array.isArray(knowledge?.categories) ? knowledge.categories : [];
          const match = categories.find((entry: any) => normalizeText(entry?.name) === category);
          templateId =
            normalizeText(match?.workflowTemplateId) ||
            normalizeText(match?.workflowId) ||
            '';
        } catch {
          templateId = '';
        }
      }
      workflowExecution = await attachWorkflowToTicket(ticketId, templateId || 'standard-redmine-ticket', {
        skipIfExisting: true,
      });
    }

    publishTicketUpdate({
      reason: 'ticket.created',
      ticketId,
    });
    void sendNewTicketEmailNotifications(ticketId).catch((error) => {
      console.warn('New ticket email notification failed:', error);
    });

    const createdTicket = await db.get(
      `SELECT t.*, c.name AS citizen_name, c.email AS citizen_email,
              COALESCE(t.citizen_language, c.preferred_language) AS citizen_preferred_language,
              COALESCE(t.citizen_language_name, c.preferred_language_name) AS citizen_preferred_language_name,
              tp.pseudo_name AS reporter_pseudo_name,
              tp.pseudo_first_name AS reporter_pseudo_first_name,
              tp.pseudo_last_name AS reporter_pseudo_last_name,
              tp.pseudo_email AS reporter_pseudo_email,
              tp.scope_key AS reporter_pseudo_scope_key,
              s.original_description AS original_description,
              s.translated_description_de AS translated_description_de,
              s.anonymized_text AS anonymized_text
       FROM tickets t
       JOIN citizens c ON t.citizen_id = c.id
       JOIN submissions s ON t.submission_id = s.id
       LEFT JOIN ticket_reporter_pseudonyms tp ON tp.ticket_id = t.id
       WHERE t.id = ?`,
      [ticketId]
    );
    if (!createdTicket) {
      return res.status(500).json({ message: 'Ticket wurde angelegt, konnte aber nicht geladen werden.' });
    }

    return res.status(201).json({
      ...convertToCamelCase(createdTicket),
      workflowExecution,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Anlegen des Tickets', error: error?.message });
  }
});

/**
 * GET /api/tickets/:ticketId
 * Ticket-Details
 */
router.get('/:ticketId', async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const access = await ensureTicketScope(req, res, ticketId, false);
    if (!access) return;
    const db = getDatabase();
    
    const ticket = await db.get(
      `SELECT t.*, c.name AS citizen_name, c.email AS citizen_email,
              COALESCE(t.citizen_language, c.preferred_language) AS citizen_preferred_language,
              COALESCE(t.citizen_language_name, c.preferred_language_name) AS citizen_preferred_language_name,
              tp.pseudo_name AS reporter_pseudo_name,
              tp.pseudo_first_name AS reporter_pseudo_first_name,
              tp.pseudo_last_name AS reporter_pseudo_last_name,
              tp.pseudo_email AS reporter_pseudo_email,
              tp.scope_key AS reporter_pseudo_scope_key,
              tn.name AS tenant_name,
              owning_org.name AS owning_org_unit_name,
              primary_user.username AS primary_assignee_user_name,
              primary_org.name AS primary_assignee_org_unit_name,
              s.original_description AS original_description,
              s.translated_description_de AS translated_description_de,
              s.anonymized_text AS anonymized_text,
              s.nominatim_raw_json AS submission_nominatim_raw_json,
              s.weather_report_json AS submission_weather_report_json
       FROM tickets t 
       JOIN citizens c ON t.citizen_id = c.id 
       JOIN submissions s ON t.submission_id = s.id
       LEFT JOIN ticket_reporter_pseudonyms tp ON tp.ticket_id = t.id
       LEFT JOIN tenants tn ON tn.id = t.tenant_id
       LEFT JOIN org_units owning_org ON owning_org.id = t.owning_org_unit_id
       LEFT JOIN admin_users primary_user ON primary_user.id = t.primary_assignee_user_id
       LEFT JOIN org_units primary_org ON primary_org.id = t.primary_assignee_org_unit_id
       WHERE t.id = ?`,
      [ticketId]
    );
    
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }
    
    // Get AI logs for this ticket
    const logs = await db.all(
      `SELECT * FROM ai_logs WHERE ticket_id = ? ORDER BY created_at DESC`,
      [ticketId]
    );
    const comments = await db.all(
      `SELECT id, ticket_id, execution_id, task_id, author_type, author_id, author_name,
              visibility, comment_type, content, metadata_json, created_at, updated_at
       FROM ticket_comments
       WHERE ticket_id = ?
       ORDER BY created_at ASC`,
      [ticketId]
    );
    const collaboratorRows = await db.all(
      `SELECT tc.id,
              tc.user_id,
              tc.org_unit_id,
              tc.created_at,
              au.username AS user_username,
              ou.name AS org_unit_name
       FROM ticket_collaborators tc
       LEFT JOIN admin_users au ON au.id = tc.user_id
       LEFT JOIN org_units ou ON ou.id = tc.org_unit_id
       WHERE tc.ticket_id = ?
       ORDER BY tc.created_at ASC`,
      [ticketId]
    );
    const dataRequestRows = await db.all(
      `SELECT dr.id,
              dr.execution_id,
              dr.task_id,
              dr.status,
              dr.parallel_mode,
              dr.requested_questions_json,
              dr.answered_at,
              dr.expires_at,
              dr.created_at,
              (
                SELECT a.answers_json
                FROM workflow_data_request_answers a
                WHERE a.data_request_id = dr.id
                ORDER BY a.created_at DESC
                LIMIT 1
              ) as latest_answers_json,
              (
                SELECT a.raw_payload_json
                FROM workflow_data_request_answers a
                WHERE a.data_request_id = dr.id
                ORDER BY a.created_at DESC
                LIMIT 1
              ) as latest_raw_payload_json,
              (
                SELECT a.created_at
                FROM workflow_data_request_answers a
                WHERE a.data_request_id = dr.id
                ORDER BY a.created_at DESC
                LIMIT 1
              ) as latest_answered_at
       FROM workflow_data_requests dr
       WHERE dr.ticket_id = ?
       ORDER BY dr.created_at DESC`,
      [ticketId]
    );

    const imageRows = await db.all(
      `SELECT id, file_name, image_data, created_at, exif_json,
              ai_description_text, ai_description_confidence, ai_description_model,
              ai_description_status, ai_description_error, ai_description_hash, ai_description_updated_at
       FROM submission_images
       WHERE submission_id = ?
       ORDER BY created_at ASC`,
      [ticket.submission_id]
    );
    const images = (imageRows || []).map((row: any) => buildTicketImagePayload(row)).filter(Boolean);
    const emailMessages = await listMailboxMessagesForTicket(ticketId);
    
    const convertedTicket = convertToCamelCase(ticket);
    const ticketNominatim = parseNominatimRaw(ticket?.nominatim_raw_json);
    const submissionNominatim = parseNominatimRaw(ticket?.submission_nominatim_raw_json);
    const resolvedNominatim = ticketNominatim || submissionNominatim;
    const ticketWeather = parseWeatherReportRaw(ticket?.weather_report_json);
    const submissionWeather = parseWeatherReportRaw(ticket?.submission_weather_report_json);
    const resolvedWeather = ticketWeather || submissionWeather;
    const workflowSummaries = loadWorkflowSummariesByTicket();
    const workflow = workflowSummaries.get(convertedTicket.id);
    const convertedLogs = logs.map(l => convertToCamelCase(l));
    const collaborators = (collaboratorRows || []).map((row: any) => ({
      id: String(row?.id || ''),
      userId: normalizeText(row?.user_id) || null,
      orgUnitId: normalizeText(row?.org_unit_id) || null,
      userName: normalizeText(row?.user_username) || null,
      orgUnitName: normalizeText(row?.org_unit_name) || null,
      createdAt: row?.created_at || null,
    }));
    const convertedComments = (comments || []).map((row: any) => ({
      ...convertToCamelCase(row),
      metadata: parseCommentMetadata(row?.metadata_json),
    }));
    const dataRequests = (dataRequestRows || []).map((row: any) => {
      const parsedRequestPayload = parseJsonValue<any>(row?.requested_questions_json, []);
      const payloadObject =
        parsedRequestPayload && typeof parsedRequestPayload === 'object' && !Array.isArray(parsedRequestPayload)
          ? (parsedRequestPayload as Record<string, any>)
          : null;
      const payloadMeta =
        payloadObject?.meta && typeof payloadObject.meta === 'object' && !Array.isArray(payloadObject.meta)
          ? (payloadObject.meta as Record<string, any>)
          : null;
      const adminFieldsDeRaw =
        Array.isArray(payloadMeta?.adminFieldsDe) ? payloadMeta?.adminFieldsDe : payloadObject?.adminFieldsDe;
      const fields = Array.isArray(adminFieldsDeRaw)
        ? adminFieldsDeRaw
        : Array.isArray(parsedRequestPayload)
        ? parsedRequestPayload
        : payloadObject && Array.isArray(payloadObject.fields)
        ? payloadObject.fields
        : [];
      const latestAnswerRawPayload = parseJsonValue<any>(row?.latest_raw_payload_json, null);
      const translatedAnswersDe =
        latestAnswerRawPayload &&
        typeof latestAnswerRawPayload === 'object' &&
        latestAnswerRawPayload.translatedAnswersDe &&
        typeof latestAnswerRawPayload.translatedAnswersDe === 'object' &&
        !Array.isArray(latestAnswerRawPayload.translatedAnswersDe)
          ? (latestAnswerRawPayload.translatedAnswersDe as Record<string, any>)
          : null;
      const answers = translatedAnswersDe || parseJsonValue<Record<string, any>>(row?.latest_answers_json, {});
      const cycleRaw = payloadMeta?.cycle ?? payloadObject?.cycle;
      const maxCyclesRaw = payloadMeta?.maxCycles ?? payloadObject?.maxCycles;
      const cycle = Number.isFinite(Number(cycleRaw)) ? Math.max(1, Math.floor(Number(cycleRaw))) : null;
      const maxCycles = Number.isFinite(Number(maxCyclesRaw))
        ? Math.max(1, Math.floor(Number(maxCyclesRaw)))
        : null;
      const normalizedFields = Array.isArray(fields)
        ? fields
            .map((field) => ({
              key: normalizeText(field?.key),
              label: normalizeText(field?.label) || normalizeText(field?.key),
              type: normalizeText(field?.type),
              required: field?.required === true,
              options:
                Array.isArray(field?.options)
                  ? field.options
                      .map((option: any) => {
                        const value = normalizeText(option?.value ?? option);
                        if (!value) return null;
                        return {
                          value,
                          label: normalizeText(option?.label) || value,
                        };
                      })
                      .filter((option: any) => option !== null)
                  : [],
            }))
            .filter((field) => field.key)
        : [];
      return {
        id: String(row?.id || ''),
        executionId: normalizeText(row?.execution_id) || null,
        taskId: normalizeText(row?.task_id) || null,
        status: normalizeText(row?.status) || 'pending',
        mode: Number(row?.parallel_mode || 0) === 1 ? 'parallel' : 'blocking',
        createdAt: row?.created_at || null,
        answeredAt: row?.answered_at || row?.latest_answered_at || null,
        expiresAt: row?.expires_at || null,
        cycle,
        maxCycles,
        fields: normalizedFields,
        answers:
          answers && typeof answers === 'object' && !Array.isArray(answers)
            ? answers
            : {},
      };
    });
    res.json({
      ...convertedTicket,
      nominatimRaw: resolvedNominatim,
      weatherReport: resolvedWeather,
      logs: convertedLogs,
      comments: convertedComments,
      dataRequests,
      workflowStarted: !!workflow,
      workflowStatus: workflow?.status || null,
      workflowExecutionId: workflow?.id || null,
      workflowTemplateId: workflow?.templateId || null,
      workflowTitle: workflow?.title || null,
      // Backward compatibility for older frontend code paths
      workflowId: workflow?.id || null,
      images,
      collaborators,
      emailMessages: (emailMessages || []).map((message: any) => ({
        ...message,
        attachments: Array.isArray(message?.attachments)
          ? message.attachments.map((attachment: any) => ({
              ...attachment,
              downloadUrl: `/api/admin/mailbox/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(
                attachment.id
              )}/download`,
            }))
          : [],
      })),
    });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Abrufen des Tickets' });
  }
});

/**
 * POST /api/tickets/:ticketId/images/:imageId/analyze
 * Startet KI-Bildanalyse für ein einzelnes Ticket-Bild
 */
router.post('/:ticketId/images/:imageId/analyze', async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId, imageId } = req.params;
    const access = await ensureTicketScope(req, res, ticketId, true);
    if (!access) return;
    const force = req.body?.force === true;
    const includeDescription = req.body?.includeDescription !== false;
    const includeOsmData = req.body?.includeOsmData === true;
    const includeWeatherData = req.body?.includeWeatherData === true;
    const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId.trim() : '';
    const connectionId = typeof req.body?.connectionId === 'string' ? req.body.connectionId.trim() : '';
    const db = getDatabase();

    const ticket = await db.get(
      `SELECT t.id,
              t.submission_id,
              t.category,
              t.priority,
              t.status,
              t.description,
              t.address,
              t.postal_code,
              t.city,
              t.nominatim_raw_json AS ticket_nominatim_raw_json,
              t.weather_report_json AS ticket_weather_report_json,
              s.anonymized_text AS submission_anonymized_text,
              s.nominatim_raw_json AS submission_nominatim_raw_json,
              s.weather_report_json AS submission_weather_report_json,
              c.name AS citizen_name,
              c.email AS citizen_email,
              tp.pseudo_name AS reporter_pseudo_name,
              tp.pseudo_email AS reporter_pseudo_email,
              COALESCE(t.citizen_language, c.preferred_language) AS citizen_preferred_language
       FROM tickets t
       LEFT JOIN submissions s ON s.id = t.submission_id
       LEFT JOIN citizens c ON c.id = t.citizen_id
       LEFT JOIN ticket_reporter_pseudonyms tp ON tp.ticket_id = t.id
       WHERE t.id = ?`,
      [ticketId]
    );
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    const imageRow = await db.get(
      `SELECT id, file_name, image_data, created_at, exif_json,
              ai_description_text, ai_description_confidence, ai_description_model,
              ai_description_status, ai_description_error, ai_description_hash, ai_description_updated_at
       FROM submission_images
       WHERE id = ? AND submission_id = ?
       LIMIT 1`,
      [imageId, ticket.submission_id]
    );
    if (!imageRow) {
      return res.status(404).json({ message: 'Bild nicht gefunden' });
    }

    const buffer = normalizeImageBuffer(imageRow?.image_data);
    if (!buffer) {
      return res.status(422).json({ message: 'Bilddaten konnten nicht gelesen werden' });
    }

    const imageHash = computeImageContentHash(buffer);
    const cachedSummary = parseImageAiSummary(imageRow);
    const cachedHash = typeof imageRow?.ai_description_hash === 'string' ? imageRow.ai_description_hash.trim() : '';
    if (!force && cachedSummary.description && cachedHash && cachedHash === imageHash && cachedSummary.status === 'done') {
      return res.json({
        message: 'Vorhandene Bildbeschreibung wiederverwendet',
        reused: true,
        image: buildTicketImagePayload(imageRow),
      });
    }

    await db.run(
      `UPDATE submission_images
       SET ai_description_status = 'processing',
           ai_description_error = NULL,
           ai_description_updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [imageId]
    );

    try {
      const nominatimRaw =
        parseNominatimRaw(ticket.ticket_nominatim_raw_json) || parseNominatimRaw(ticket.submission_nominatim_raw_json);
      const weatherReport =
        parseWeatherReportRaw(ticket.ticket_weather_report_json) ||
        parseWeatherReportRaw(ticket.submission_weather_report_json);
      const ticketContext = buildImageAiPseudonymizedTicketContext({
        ticketId: ticket.id,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        description: ticket.submission_anonymized_text || '',
        address: ticket.address,
        postalCode: ticket.postal_code,
        city: ticket.city,
        nominatimRaw,
        weatherReport,
        citizenName: ticket.citizen_name,
        citizenEmail: ticket.citizen_email,
        pseudoName: ticket.reporter_pseudo_name,
        pseudoEmail: ticket.reporter_pseudo_email,
        contextOptions: {
          includeDescription,
          includeOsmData,
          includeWeatherData,
        },
      });
      const mimeType = guessImageMimeType(imageRow?.file_name, buffer);
      const analysis = await analyzeImageToText({
        imageBuffer: buffer,
        mimeType,
        fileName: imageRow?.file_name || null,
        languageCode: ticket.citizen_preferred_language || null,
        ticketContext,
        modelId: modelId || undefined,
        connectionId: connectionId || undefined,
      });

      await db.run(
        `UPDATE submission_images
         SET ai_description_text = ?,
             ai_description_confidence = ?,
             ai_description_model = ?,
             ai_description_status = 'done',
             ai_description_error = NULL,
             ai_description_hash = ?,
             ai_description_updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          analysis.description || null,
          analysis.confidence,
          analysis.model || null,
          analysis.hash || imageHash,
          imageId,
        ]
      );

      const updatedImageRow = await db.get(
        `SELECT id, file_name, image_data, created_at, exif_json,
                ai_description_text, ai_description_confidence, ai_description_model,
                ai_description_status, ai_description_error, ai_description_hash, ai_description_updated_at
         FROM submission_images
         WHERE id = ?`,
        [imageId]
      );

      publishTicketUpdate({
        reason: 'ticket.image.analysis.updated',
        ticketId,
      });

      return res.json({
        message: 'Bildbeschreibung erstellt',
        reused: false,
        analysisOptions: {
          includeDescription,
          includeOsmData,
          includeWeatherData,
          modelId: modelId || null,
          connectionId: connectionId || null,
        },
        image: buildTicketImagePayload(updatedImageRow),
      });
    } catch (analysisError: any) {
      const errorMessage = analysisError?.message || 'Bildanalyse fehlgeschlagen';
      await db.run(
        `UPDATE submission_images
         SET ai_description_status = 'failed',
             ai_description_error = ?,
             ai_description_hash = ?,
             ai_description_updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [errorMessage, imageHash, imageId]
      );
      return res.status(500).json({
        message: 'Bildbeschreibung konnte nicht erstellt werden',
        error: errorMessage,
      });
    }
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler bei der Bildanalyse',
      error: error?.message,
    });
  }
});

/**
 * POST /api/tickets/:ticketId/pseudonymize
 * Erzeugt ein Reporter-Pseudonym fuer ein Ticket (nur wenn noch keines existiert)
 */
router.post('/:ticketId/pseudonymize', async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
    const access = await ensureTicketScope(req, res, ticketId, true);
    if (!access) return;
    const db = getDatabase();
    const ticketRow = await db.get(
      `SELECT t.id,
              c.name AS citizen_name,
              c.email AS citizen_email,
              tp.pseudo_name AS reporter_pseudo_name,
              tp.pseudo_first_name AS reporter_pseudo_first_name,
              tp.pseudo_last_name AS reporter_pseudo_last_name,
              tp.pseudo_email AS reporter_pseudo_email,
              tp.scope_key AS reporter_pseudo_scope_key
       FROM tickets t
       JOIN citizens c ON t.citizen_id = c.id
       LEFT JOIN ticket_reporter_pseudonyms tp ON tp.ticket_id = t.id
       WHERE t.id = ?`,
      [ticketId]
    );

    if (!ticketRow) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    const hasPseudonym = [
      ticketRow.reporter_pseudo_name,
      ticketRow.reporter_pseudo_first_name,
      ticketRow.reporter_pseudo_last_name,
      ticketRow.reporter_pseudo_email,
    ].some((value) => normalizeText(value).length > 0);

    if (!hasPseudonym) {
      await ensureTicketReporterPseudonym(
        ticketId,
        normalizeText(ticketRow.citizen_name),
        normalizeText(ticketRow.citizen_email)
      );
      publishTicketUpdate({
        reason: 'ticket.pseudonymized',
        ticketId,
      });
    }

    const pseudoRow = await db.get(
      `SELECT pseudo_name AS reporter_pseudo_name,
              pseudo_first_name AS reporter_pseudo_first_name,
              pseudo_last_name AS reporter_pseudo_last_name,
              pseudo_email AS reporter_pseudo_email,
              scope_key AS reporter_pseudo_scope_key
       FROM ticket_reporter_pseudonyms
       WHERE ticket_id = ?`,
      [ticketId]
    );

    return res.status(hasPseudonym ? 200 : 201).json({
      message: hasPseudonym ? 'Pseudonym bereits vorhanden' : 'Pseudonym erzeugt',
      created: !hasPseudonym,
      ...convertToCamelCase(pseudoRow || {}),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler bei der Pseudonymisierung',
      error: error?.message,
    });
  }
});

/**
 * GET /api/tickets/:ticketId/comments
 * Kommentar-Timeline eines Tickets
 */
router.get('/:ticketId/comments', async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
    const access = await ensureTicketScope(req, res, ticketId, false);
    if (!access) return;
    const visibilityFilterRaw = String(req.query?.visibility || 'all').trim().toLowerCase();
    const visibilityFilter =
      visibilityFilterRaw === 'public' || visibilityFilterRaw === 'internal'
        ? visibilityFilterRaw
        : 'all';
    const db = getDatabase();
    const ticket = await db.get(`SELECT id FROM tickets WHERE id = ?`, [ticketId]);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    const rows =
      visibilityFilter === 'all'
        ? await db.all(
            `SELECT id, ticket_id, execution_id, task_id, author_type, author_id, author_name,
                    visibility, comment_type, content, metadata_json, created_at, updated_at
             FROM ticket_comments
             WHERE ticket_id = ?
             ORDER BY created_at ASC`,
            [ticketId]
          )
        : await db.all(
            `SELECT id, ticket_id, execution_id, task_id, author_type, author_id, author_name,
                    visibility, comment_type, content, metadata_json, created_at, updated_at
             FROM ticket_comments
             WHERE ticket_id = ? AND visibility = ?
             ORDER BY created_at ASC`,
            [ticketId, visibilityFilter]
          );

    return res.json(
      (rows || []).map((row: any) => ({
        ...convertToCamelCase(row),
        metadata: parseCommentMetadata(row?.metadata_json),
      }))
    );
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Laden der Kommentare', error: error?.message });
  }
});

/**
 * POST /api/tickets/:ticketId/comments
 * Kommentar zu Ticket hinzufügen
 */
router.post('/:ticketId/comments', async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
    const access = await ensureTicketScope(req, res, ticketId, true);
    if (!access) return;
    const content = normalizeText(req.body?.content);
    if (!content) {
      return res.status(400).json({ message: 'content ist erforderlich.' });
    }
    const visibility = req.body?.visibility === 'public' ? 'public' : 'internal';
    const commentTypeRaw = normalizeText(req.body?.commentType || req.body?.type || 'note').toLowerCase();
    const allowedTypes = new Set([
      'note',
      'decision',
      'classification',
      'timeout',
      'data_request',
      'data_response',
      'situation_label',
    ]);
    const commentType = allowedTypes.has(commentTypeRaw) ? commentTypeRaw : 'note';
    const metadata =
      req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
        ? req.body.metadata
        : null;
    const authorType =
      req.body?.authorType === 'ai' || req.body?.authorType === 'system' || req.body?.authorType === 'citizen'
        ? req.body.authorType
        : 'staff';

    const db = getDatabase();
    const ticket = await db.get(`SELECT id FROM tickets WHERE id = ?`, [ticketId]);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    const id = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await db.run(
      `INSERT INTO ticket_comments (
        id, ticket_id, execution_id, task_id, author_type, author_id, author_name,
        visibility, comment_type, content, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        ticketId,
        normalizeText(req.body?.executionId) || null,
        normalizeText(req.body?.taskId) || null,
        authorType,
        normalizeText((req as any).userId) || null,
        normalizeText((req as any).username) || null,
        visibility,
        commentType,
        content,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    const created = await db.get(
      `SELECT id, ticket_id, execution_id, task_id, author_type, author_id, author_name,
              visibility, comment_type, content, metadata_json, created_at, updated_at
       FROM ticket_comments
       WHERE id = ?`,
      [id]
    );
    publishTicketUpdate({
      reason: 'ticket.comment.created',
      ticketId,
    });
    return res.status(201).json({
      ...convertToCamelCase(created),
      metadata: parseCommentMetadata(created?.metadata_json),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Speichern des Kommentars', error: error?.message });
  }
});

/**
 * PATCH /api/tickets/:ticketId/comments/:commentId
 * Kommentar aktualisieren (Inhalt/Sichtbarkeit)
 */
router.patch('/:ticketId/comments/:commentId', async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId, commentId } = req.params;
    const access = await ensureTicketScope(req, res, ticketId, true);
    if (!access) return;
    const contentProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'content');
    const visibilityProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'visibility');
    const metadataProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'metadata');
    if (!contentProvided && !visibilityProvided && !metadataProvided) {
      return res.status(400).json({ message: 'Keine Änderungen angegeben.' });
    }

    const db = getDatabase();
    const existing = await db.get(
      `SELECT id FROM ticket_comments WHERE id = ? AND ticket_id = ?`,
      [commentId, ticketId]
    );
    if (!existing) {
      return res.status(404).json({ message: 'Kommentar nicht gefunden.' });
    }

    const updates: string[] = [];
    const values: any[] = [];
    if (contentProvided) {
      const content = normalizeText(req.body?.content);
      if (!content) {
        return res.status(400).json({ message: 'content darf nicht leer sein.' });
      }
      updates.push('content = ?');
      values.push(content);
    }
    if (visibilityProvided) {
      updates.push('visibility = ?');
      values.push(req.body?.visibility === 'public' ? 'public' : 'internal');
    }
    if (metadataProvided) {
      const metadata =
        req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
          ? req.body.metadata
          : null;
      updates.push('metadata_json = ?');
      values.push(metadata ? JSON.stringify(metadata) : null);
    }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(commentId, ticketId);
    await db.run(
      `UPDATE ticket_comments
       SET ${updates.join(', ')}
       WHERE id = ? AND ticket_id = ?`,
      values
    );

    const updated = await db.get(
      `SELECT id, ticket_id, execution_id, task_id, author_type, author_id, author_name,
              visibility, comment_type, content, metadata_json, created_at, updated_at
       FROM ticket_comments
       WHERE id = ? AND ticket_id = ?`,
      [commentId, ticketId]
    );
    publishTicketUpdate({
      reason: 'ticket.comment.updated',
      ticketId,
    });
    return res.json({
      ...convertToCamelCase(updated),
      metadata: parseCommentMetadata(updated?.metadata_json),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Aktualisieren des Kommentars', error: error?.message });
  }
});

/**
 * PATCH /api/tickets/:ticketId
 * Ticket aktualisieren
 */
router.patch('/:ticketId', async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const access = await ensureTicketScope(req, res, ticketId, true);
    if (!access) return;
    const {
      status,
      assignedTo,
      tenantId,
      owningOrgUnitId,
      primaryAssigneeUserId,
      primaryAssigneeOrgUnitId,
      collaboratorUserIds,
      collaboratorOrgUnitIds,
      category,
      priority,
      description,
      responsibilityAuthority,
      address,
      postalCode,
      city,
      latitude,
      longitude,
    } = req.body;
    const hasTenantId = Object.prototype.hasOwnProperty.call(req.body || {}, 'tenantId');
    const hasOwningOrgUnitId = Object.prototype.hasOwnProperty.call(req.body || {}, 'owningOrgUnitId');
    const hasPrimaryAssigneeUserId = Object.prototype.hasOwnProperty.call(req.body || {}, 'primaryAssigneeUserId');
    const hasPrimaryAssigneeOrgUnitId = Object.prototype.hasOwnProperty.call(req.body || {}, 'primaryAssigneeOrgUnitId');
    const hasCollaboratorUserIds = Object.prototype.hasOwnProperty.call(req.body || {}, 'collaboratorUserIds');
    const hasCollaboratorOrgUnitIds = Object.prototype.hasOwnProperty.call(req.body || {}, 'collaboratorOrgUnitIds');
    const descriptionProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'description');
    const responsibilityAuthorityProvided = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'responsibilityAuthority'
    );
    const normalizedOriginalDescription = descriptionProvided ? normalizeText(description) : '';
    const normalizedAnonymizedDescription = descriptionProvided
      ? sanitizeText(normalizedOriginalDescription)
      : '';
    const db = getDatabase();
    const existing = await db.get(
      `SELECT t.status,
              t.category,
              t.priority,
              t.assigned_to,
              t.responsibility_authority,
              t.address,
              t.postal_code,
              t.city,
              t.latitude,
              t.longitude,
              t.validation_token,
              t.submission_id,
              t.tenant_id,
              t.owning_org_unit_id,
              t.primary_assignee_user_id,
              t.primary_assignee_org_unit_id,
              tn.name AS tenant_name,
              s.original_description AS submission_original_description,
              COALESCE(t.citizen_language, c.preferred_language) AS citizen_language,
              COALESCE(t.citizen_language_name, c.preferred_language_name) AS citizen_language_name,
              c.email as citizen_email,
              c.name as citizen_name
       FROM tickets t
       LEFT JOIN submissions s ON s.id = t.submission_id
       LEFT JOIN tenants tn ON tn.id = t.tenant_id
       LEFT JOIN citizens c ON c.id = t.citizen_id
       WHERE t.id = ?`,
      [ticketId]
    );

    if (!existing) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }
    const existingCollaboratorRows = await db.all<any>(
      `SELECT user_id, org_unit_id
       FROM ticket_collaborators
       WHERE ticket_id = ?`,
      [ticketId]
    );
    const existingCollaboratorUserIds = Array.from(
      new Set(
        (existingCollaboratorRows || [])
          .map((row: any) => normalizeText(row?.user_id))
          .filter(Boolean)
      )
    );
    const existingCollaboratorOrgUnitIds = Array.from(
      new Set(
        (existingCollaboratorRows || [])
          .map((row: any) => normalizeText(row?.org_unit_id))
          .filter(Boolean)
      )
    );
    const existingPrimaryAssigneeUserId = normalizeText(existing.primary_assignee_user_id);
    const existingPrimaryAssigneeOrgUnitId = normalizeText(existing.primary_assignee_org_unit_id);
    const descriptionChanged =
      descriptionProvided &&
      normalizedOriginalDescription !== normalizeText(existing.submission_original_description);

    const nextTenantId =
      hasTenantId
        ? normalizeText(tenantId)
        : normalizeText(existing.tenant_id || '') || access.tenantIds[0] || 'tenant_default';
    if (!nextTenantId) {
      return res.status(400).json({ message: 'tenantId ist erforderlich.' });
    }
    if (!access.isGlobalAdmin && !access.tenantIds.includes(nextTenantId)) {
      return res.status(403).json({ message: 'Kein Zugriff auf den gewaehlten Mandanten.' });
    }
    const hasTenantWriteAdmin = access.tenantAdminTenantIds.includes(nextTenantId);
    const hasTenantWriteScope = access.orgScopes.some((scope) => scope.tenantId === nextTenantId && scope.canWrite);
    if (!access.isGlobalAdmin && !hasTenantWriteAdmin && !hasTenantWriteScope) {
      return res.status(403).json({ message: 'Keine Schreibrechte im gewaehlten Mandanten.' });
    }

    if (hasPrimaryAssigneeUserId && hasPrimaryAssigneeOrgUnitId) {
      const normalizedPrimaryUser = normalizeText(primaryAssigneeUserId);
      const normalizedPrimaryOrg = normalizeText(primaryAssigneeOrgUnitId);
      if (normalizedPrimaryUser && normalizedPrimaryOrg) {
        return res.status(400).json({
          message: 'Es darf nur ein primaerer Bearbeiter gesetzt werden (Benutzer ODER Organisationseinheit).',
        });
      }
    }

    if (hasTenantId) {
      const tenantRow = await db.get(`SELECT id FROM tenants WHERE id = ?`, [nextTenantId]);
      if (!tenantRow?.id) {
        return res.status(400).json({ message: 'Unbekannter Mandant.' });
      }
    }

    const normalizedOwningOrgUnitId = hasOwningOrgUnitId ? normalizeText(owningOrgUnitId) : null;
    if (hasOwningOrgUnitId && normalizedOwningOrgUnitId) {
      const row = await db.get(
        `SELECT id
         FROM org_units
         WHERE id = ?
           AND tenant_id = ?`,
        [normalizedOwningOrgUnitId, nextTenantId]
      );
      if (!row?.id) {
        return res.status(400).json({ message: 'owningOrgUnitId ist im Mandanten nicht vorhanden.' });
      }
      if (!access.isGlobalAdmin && !hasTenantWriteAdmin && !access.writableOrgUnitIds.includes(normalizedOwningOrgUnitId)) {
        return res.status(403).json({ message: 'Keine Schreibrechte auf die gewaehlte owningOrgUnit.' });
      }
    }

    const normalizedPrimaryAssigneeUserId = hasPrimaryAssigneeUserId ? normalizeText(primaryAssigneeUserId) : null;
    if (hasPrimaryAssigneeUserId && normalizedPrimaryAssigneeUserId) {
      const userRow = await db.get(`SELECT id FROM admin_users WHERE id = ?`, [normalizedPrimaryAssigneeUserId]);
      if (!userRow?.id) {
        return res.status(400).json({ message: 'primaryAssigneeUserId ist unbekannt.' });
      }
    }

    const normalizedPrimaryAssigneeOrgUnitId = hasPrimaryAssigneeOrgUnitId
      ? normalizeText(primaryAssigneeOrgUnitId)
      : null;
    if (hasPrimaryAssigneeOrgUnitId && normalizedPrimaryAssigneeOrgUnitId) {
      const row = await db.get(
        `SELECT id
         FROM org_units
         WHERE id = ?
           AND tenant_id = ?`,
        [normalizedPrimaryAssigneeOrgUnitId, nextTenantId]
      );
      if (!row?.id) {
        return res.status(400).json({ message: 'primaryAssigneeOrgUnitId ist im Mandanten nicht vorhanden.' });
      }
    }

    const normalizedCollaboratorUserIds = hasCollaboratorUserIds ? normalizeIdList(collaboratorUserIds) : [];
    if (hasCollaboratorUserIds && normalizedCollaboratorUserIds.length > 0) {
      const placeholders = normalizedCollaboratorUserIds.map(() => '?').join(', ');
      const userRows = await db.all<any>(
        `SELECT id
         FROM admin_users
         WHERE id IN (${placeholders})`,
        normalizedCollaboratorUserIds
      );
      const known = new Set((userRows || []).map((row: any) => String(row?.id || '').trim()));
      const missing = normalizedCollaboratorUserIds.filter((entry) => !known.has(entry));
      if (missing.length > 0) {
        return res.status(400).json({ message: `Unbekannte collaboratorUserIds: ${missing.join(', ')}` });
      }
    }

    const normalizedCollaboratorOrgUnitIds = hasCollaboratorOrgUnitIds ? normalizeIdList(collaboratorOrgUnitIds) : [];
    if (hasCollaboratorOrgUnitIds && normalizedCollaboratorOrgUnitIds.length > 0) {
      const placeholders = normalizedCollaboratorOrgUnitIds.map(() => '?').join(', ');
      const orgRows = await db.all<any>(
        `SELECT id
         FROM org_units
         WHERE tenant_id = ?
           AND id IN (${placeholders})`,
        [nextTenantId, ...normalizedCollaboratorOrgUnitIds]
      );
      const known = new Set((orgRows || []).map((row: any) => String(row?.id || '').trim()));
      const missing = normalizedCollaboratorOrgUnitIds.filter((entry) => !known.has(entry));
      if (missing.length > 0) {
        return res.status(400).json({ message: `Unbekannte collaboratorOrgUnitIds: ${missing.join(', ')}` });
      }
    }

    const nextPrimaryAssigneeUserId = hasPrimaryAssigneeUserId
      ? normalizeText(normalizedPrimaryAssigneeUserId || '')
      : existingPrimaryAssigneeUserId;
    const nextPrimaryAssigneeOrgUnitId = hasPrimaryAssigneeOrgUnitId
      ? normalizeText(normalizedPrimaryAssigneeOrgUnitId || '')
      : existingPrimaryAssigneeOrgUnitId;
    const nextCollaboratorUserIds = hasCollaboratorUserIds
      ? normalizedCollaboratorUserIds
      : existingCollaboratorUserIds;
    const nextCollaboratorOrgUnitIds = hasCollaboratorOrgUnitIds
      ? normalizedCollaboratorOrgUnitIds
      : existingCollaboratorOrgUnitIds;

    const truncateAuditText = (value: string): string => {
      const normalized = normalizeText(value);
      if (!normalized) return '—';
      return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
    };
    const normalizeAuditNumber = (value: unknown): string => {
      if (value === null || value === undefined || value === '') return '';
      const parsed = Number(value);
      return Number.isFinite(parsed) ? String(parsed) : '';
    };
    const formatAuditValue = (value: unknown): string => {
      const normalized = normalizeText(value);
      return normalized || '—';
    };
    const formatAuditList = (values: string[]): string =>
      values.length > 0 ? values.join(', ') : '—';
    const formatTenantLabel = (id: string, name: string): string => {
      const normalizedId = normalizeText(id);
      const normalizedName = normalizeText(name);
      if (normalizedName && normalizedId && normalizedName !== normalizedId) {
        return `${normalizedName} (${normalizedId})`;
      }
      return normalizedName || normalizedId || '—';
    };

    type TicketFieldChange = { field: string; label: string; from: string; to: string };
    const ticketFieldChanges: TicketFieldChange[] = [];
    const addFieldChange = (field: string, label: string, fromRaw: unknown, toRaw: unknown) => {
      const from = formatAuditValue(fromRaw);
      const to = formatAuditValue(toRaw);
      if (from === to) return;
      ticketFieldChanges.push({ field, label, from, to });
    };

    const existingTenantId = normalizeText(existing.tenant_id);
    const existingTenantName = normalizeText(existing.tenant_name);
    let nextTenantName = existingTenantName;
    if (nextTenantId && nextTenantId !== existingTenantId) {
      const nextTenantRow = await db.get(`SELECT name FROM tenants WHERE id = ?`, [nextTenantId]);
      nextTenantName = normalizeText(nextTenantRow?.name);
    }

    const nextStatus = status ? normalizeText(status) : normalizeText(existing.status);
    const nextCategory = category ? normalizeText(category) : normalizeText(existing.category);
    const nextPriority = priority ? normalizeText(priority) : normalizeText(existing.priority);
    const nextAssignedTo =
      hasPrimaryAssigneeUserId || hasPrimaryAssigneeOrgUnitId || hasOwningOrgUnitId || assignedTo !== undefined
        ? normalizeText(normalizeText(assignedTo) || normalizedPrimaryAssigneeUserId || normalizedPrimaryAssigneeOrgUnitId || '')
        : normalizeText(existing.assigned_to);
    const nextAddress = address !== undefined ? normalizeText(address) : normalizeText(existing.address);
    const nextPostalCode = postalCode !== undefined ? normalizeText(postalCode) : normalizeText(existing.postal_code);
    const nextCity = city !== undefined ? normalizeText(city) : normalizeText(existing.city);
    const nextLatitude =
      latitude !== undefined
        ? normalizeAuditNumber(latitude === null ? null : Number(latitude))
        : normalizeAuditNumber(existing.latitude);
    const nextLongitude =
      longitude !== undefined
        ? normalizeAuditNumber(longitude === null ? null : Number(longitude))
        : normalizeAuditNumber(existing.longitude);

    addFieldChange('status', 'Status', normalizeText(existing.status), nextStatus);
    addFieldChange(
      'tenantId',
      'Mandant',
      formatTenantLabel(existingTenantId, existingTenantName),
      formatTenantLabel(nextTenantId, nextTenantName)
    );
    addFieldChange('category', 'Kategorie', normalizeText(existing.category), nextCategory);
    addFieldChange('priority', 'Priorität', normalizeText(existing.priority), nextPriority);
    addFieldChange('assignedTo', 'Legacy-Zuweisung', normalizeText(existing.assigned_to), nextAssignedTo);
    addFieldChange(
      'primaryAssigneeUserId',
      'Primärzuweisung Benutzer',
      existingPrimaryAssigneeUserId,
      nextPrimaryAssigneeUserId
    );
    addFieldChange(
      'primaryAssigneeOrgUnitId',
      'Primärzuweisung Organisation',
      existingPrimaryAssigneeOrgUnitId,
      nextPrimaryAssigneeOrgUnitId
    );
    addFieldChange(
      'owningOrgUnitId',
      'Verantwortliche Organisation',
      normalizeText(existing.owning_org_unit_id),
      normalizeText(normalizedOwningOrgUnitId || normalizeText(existing.owning_org_unit_id))
    );
    addFieldChange(
      'collaboratorUserIds',
      'Mitwirkende Benutzer',
      formatAuditList([...existingCollaboratorUserIds].sort((a, b) => a.localeCompare(b))),
      formatAuditList([...nextCollaboratorUserIds].sort((a, b) => a.localeCompare(b)))
    );
    addFieldChange(
      'collaboratorOrgUnitIds',
      'Mitwirkende Organisationen',
      formatAuditList([...existingCollaboratorOrgUnitIds].sort((a, b) => a.localeCompare(b))),
      formatAuditList([...nextCollaboratorOrgUnitIds].sort((a, b) => a.localeCompare(b)))
    );
    addFieldChange(
      'description',
      'Beschreibung',
      truncateAuditText(normalizeText(existing.submission_original_description)),
      truncateAuditText(descriptionProvided ? normalizedOriginalDescription : normalizeText(existing.submission_original_description))
    );
    addFieldChange('address', 'Adresse', normalizeText(existing.address), nextAddress);
    addFieldChange('postalCode', 'PLZ', normalizeText(existing.postal_code), nextPostalCode);
    addFieldChange('city', 'Ort', normalizeText(existing.city), nextCity);
    addFieldChange('latitude', 'Latitude', normalizeAuditNumber(existing.latitude), nextLatitude);
    addFieldChange('longitude', 'Longitude', normalizeAuditNumber(existing.longitude), nextLongitude);

    const allowedStatuses = new Set([
      'pending_validation',
      'pending',
      'open',
      'assigned',
      'in-progress',
      'completed',
      'closed',
    ]);
    const allowedPriorities = new Set(['low', 'medium', 'high', 'critical']);
    if (status && !allowedStatuses.has(status)) {
      return res.status(400).json({ message: 'Ungueltiger Status' });
    }
    if (priority && !allowedPriorities.has(priority)) {
      return res.status(400).json({ message: 'Ungueltige Prioritaet' });
    }
    const allowedResponsibilityAuthorities = responsibilityAuthorityProvided
      ? await loadAllowedResponsibilityAuthorities()
      : [];
    const resolvedResponsibilityAuthority = responsibilityAuthorityProvided
      ? resolveResponsibilityAuthority(responsibilityAuthority, allowedResponsibilityAuthorities)
      : null;
    if (
      responsibilityAuthorityProvided &&
      normalizeText(responsibilityAuthority).length > 0 &&
      !resolvedResponsibilityAuthority
    ) {
      return res.status(400).json({
        message: `Ungueltige Zustaendigkeit. Erlaubt: ${allowedResponsibilityAuthorities.join(', ') || 'keine'}.`,
      });
    }
    const nextResponsibilityAuthority = responsibilityAuthorityProvided
      ? normalizeText(resolvedResponsibilityAuthority || '')
      : normalizeText(existing.responsibility_authority);
    addFieldChange(
      'responsibilityAuthority',
      'Zuständigkeit',
      normalizeText(existing.responsibility_authority),
      nextResponsibilityAuthority
    );
    
    const updates: string[] = [];
    const params: any[] = [];
    
    if (status) {
      updates.push('status = ?');
      params.push(status);
    }
    if (hasTenantId) {
      updates.push('tenant_id = ?');
      params.push(nextTenantId);
    }
    if (hasOwningOrgUnitId) {
      updates.push('owning_org_unit_id = ?');
      params.push(normalizedOwningOrgUnitId || null);
    }
    if (hasPrimaryAssigneeUserId) {
      updates.push('primary_assignee_user_id = ?');
      params.push(normalizedPrimaryAssigneeUserId || null);
    }
    if (hasPrimaryAssigneeOrgUnitId) {
      updates.push('primary_assignee_org_unit_id = ?');
      params.push(normalizedPrimaryAssigneeOrgUnitId || null);
    }
    if (hasPrimaryAssigneeUserId || hasPrimaryAssigneeOrgUnitId || hasOwningOrgUnitId || assignedTo !== undefined) {
      const fallbackAssigned =
        normalizeText(assignedTo) ||
        normalizedPrimaryAssigneeUserId ||
        normalizedPrimaryAssigneeOrgUnitId ||
        null;
      updates.push('assigned_to = ?');
      params.push(fallbackAssigned);
      updates.push('assignment_updated_by = ?');
      params.push(normalizeText(req.userId) || null);
      updates.push('assignment_updated_at = CURRENT_TIMESTAMP');
    }
    if (category) {
      updates.push('category = ?');
      params.push(category);
    }
    if (priority) {
      updates.push('priority = ?');
      params.push(priority);
    }
    if (responsibilityAuthorityProvided) {
      updates.push('responsibility_authority = ?');
      params.push(resolvedResponsibilityAuthority || null);
    }
    if (descriptionChanged) {
      updates.push('description = ?');
      params.push(normalizedAnonymizedDescription || null);
    }
    const locationDataChanged =
      address !== undefined ||
      postalCode !== undefined ||
      city !== undefined ||
      latitude !== undefined ||
      longitude !== undefined;
    if (address !== undefined) {
      updates.push('address = ?');
      params.push(address || null);
    }
    if (postalCode !== undefined) {
      updates.push('postal_code = ?');
      params.push(postalCode || null);
    }
    if (city !== undefined) {
      updates.push('city = ?');
      params.push(city || null);
    }
    if (latitude !== undefined) {
      updates.push('latitude = ?');
      params.push(latitude === null ? null : Number(latitude));
    }
    if (longitude !== undefined) {
      updates.push('longitude = ?');
      params.push(longitude === null ? null : Number(longitude));
    }
    if (locationDataChanged) {
      updates.push('nominatim_raw_json = NULL');
      updates.push('weather_report_json = NULL');
    }
    
    const hasCollaboratorMutationPayload = hasCollaboratorUserIds || hasCollaboratorOrgUnitIds;
    if (updates.length === 0 && !hasCollaboratorMutationPayload) {
      return res.status(400).json({ message: 'Keine Updates angegeben' });
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(ticketId);
      await db.run(
        `UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    } else if (hasCollaboratorMutationPayload) {
      await db.run(
        `UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [ticketId]
      );
    }

    if (hasCollaboratorUserIds || hasCollaboratorOrgUnitIds) {
      await db.run(`DELETE FROM ticket_collaborators WHERE ticket_id = ?`, [ticketId]);
      const collaborators = [
        ...(hasCollaboratorUserIds
          ? normalizedCollaboratorUserIds.map((userId) => ({ userId, orgUnitId: null as string | null }))
          : []),
        ...(hasCollaboratorOrgUnitIds
          ? normalizedCollaboratorOrgUnitIds.map((orgUnitId) => ({ userId: null as string | null, orgUnitId }))
          : []),
      ];
      for (const collaborator of collaborators) {
        await db.run(
          `INSERT INTO ticket_collaborators (id, ticket_id, tenant_id, user_id, org_unit_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            `tcoll_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            ticketId,
            nextTenantId,
            collaborator.userId,
            collaborator.orgUnitId,
            normalizeText(req.userId) || null,
          ]
        );
      }
    }

    if (ticketFieldChanges.length > 0) {
      const commentId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const content = [
        'Ticket manuell aktualisiert:',
        ...ticketFieldChanges.map((change) => `- ${change.label}: ${change.from} -> ${change.to}`),
      ].join('\n');
      await db.run(
        `INSERT INTO ticket_comments (
          id, ticket_id, author_type, author_id, author_name, visibility, comment_type, content, metadata_json
        ) VALUES (?, ?, 'staff', ?, ?, 'internal', 'note', ?, ?)`,
        [
          commentId,
          ticketId,
          normalizeText((req as any).userId) || null,
          normalizeText((req as any).username) || null,
          content,
          JSON.stringify({
            source: 'admin.ticket.patch',
            changeCount: ticketFieldChanges.length,
            changes: ticketFieldChanges,
          }),
        ]
      );
    }

    if (
      status &&
      existing.status &&
      status !== existing.status &&
      typeof existing.citizen_email === 'string' &&
      existing.citizen_email
    ) {
      await sendStatusChangeNotification(
        existing.citizen_email,
        existing.citizen_name || 'Buerger',
        ticketId,
        existing.status,
        status,
        undefined,
        existing.validation_token || undefined
      );
    }

    const assignmentNotificationRecipients: TicketAssignmentNotificationRecipient[] = [];
    if (nextPrimaryAssigneeUserId && nextPrimaryAssigneeUserId !== existingPrimaryAssigneeUserId) {
      assignmentNotificationRecipients.push({
        type: 'user',
        id: nextPrimaryAssigneeUserId,
        roleLabel: 'Primärzuweisung',
      });
    }
    if (nextPrimaryAssigneeOrgUnitId && nextPrimaryAssigneeOrgUnitId !== existingPrimaryAssigneeOrgUnitId) {
      assignmentNotificationRecipients.push({
        type: 'org_unit',
        id: nextPrimaryAssigneeOrgUnitId,
        roleLabel: 'Primärzuweisung',
      });
    }
    const existingCollaboratorUserIdSet = new Set(existingCollaboratorUserIds);
    const existingCollaboratorOrgUnitIdSet = new Set(existingCollaboratorOrgUnitIds);
    for (const userId of nextCollaboratorUserIds) {
      if (!userId || existingCollaboratorUserIdSet.has(userId)) continue;
      assignmentNotificationRecipients.push({
        type: 'user',
        id: userId,
        roleLabel: 'Mitwirkend',
      });
    }
    for (const orgUnitId of nextCollaboratorOrgUnitIds) {
      if (!orgUnitId || existingCollaboratorOrgUnitIdSet.has(orgUnitId)) continue;
      assignmentNotificationRecipients.push({
        type: 'org_unit',
        id: orgUnitId,
        roleLabel: 'Mitwirkend',
      });
    }
    if (assignmentNotificationRecipients.length > 0) {
      void sendTicketAssignmentEmailNotifications({
        ticketId,
        recipients: assignmentNotificationRecipients,
        actorUserId: normalizeText(req.userId) || null,
        context: 'ticket_assignment',
      }).catch((assignmentEmailError) => {
        console.warn('Ticket assignment email notifications failed:', assignmentEmailError);
      });
    }

    const submissionUpdates: string[] = [];
    const submissionParams: any[] = [];
    if (category) {
      submissionUpdates.push('category = ?');
      submissionParams.push(category);
    }
    if (priority) {
      submissionUpdates.push('priority = ?');
      submissionParams.push(priority);
    }
    if (descriptionChanged) {
      submissionUpdates.push('original_description = ?');
      submissionParams.push(normalizedOriginalDescription || null);
      submissionUpdates.push('anonymized_text = ?');
      submissionParams.push(normalizedAnonymizedDescription || null);
      submissionUpdates.push('translated_description_de = NULL');
    }
    if (address !== undefined) {
      submissionUpdates.push('address = ?');
      submissionParams.push(address || null);
    }
    if (postalCode !== undefined) {
      submissionUpdates.push('postal_code = ?');
      submissionParams.push(postalCode || null);
    }
    if (city !== undefined) {
      submissionUpdates.push('city = ?');
      submissionParams.push(city || null);
    }
    if (latitude !== undefined) {
      submissionUpdates.push('latitude = ?');
      submissionParams.push(latitude === null ? null : Number(latitude));
    }
    if (longitude !== undefined) {
      submissionUpdates.push('longitude = ?');
      submissionParams.push(longitude === null ? null : Number(longitude));
    }
    if (locationDataChanged) {
      submissionUpdates.push('nominatim_raw_json = NULL');
      submissionUpdates.push('weather_report_json = NULL');
    }

    if (submissionUpdates.length > 0) {
      submissionUpdates.push('updated_at = CURRENT_TIMESTAMP');
      submissionParams.push(ticketId);
      await db.run(
        `UPDATE submissions SET ${submissionUpdates.join(', ')}
         WHERE id = (SELECT submission_id FROM tickets WHERE id = ?)`,
        submissionParams
      );
    }

    if (
      descriptionChanged &&
      normalizedOriginalDescription &&
      existing?.submission_id &&
      !isGermanLanguageCode(existing.citizen_language)
    ) {
      void queueSubmissionDescriptionTranslation({
        submissionId: String(existing.submission_id),
        ticketId,
        sourceText: normalizedOriginalDescription,
        sourceLanguage: existing.citizen_language || '',
        sourceLanguageName: existing.citizen_language_name || '',
      }).catch((translationError) => {
        console.warn('Background translation enqueue failed after ticket description update:', translationError);
      });
    }
    
    publishTicketUpdate({
      reason: 'ticket.updated',
      ticketId,
    });

    res.json({ message: 'Ticket aktualisiert' });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Aktualisieren des Tickets' });
  }
});

/**
 * PATCH /api/tickets/bulk
 * Bulk update for tickets with mandatory reason
 */
router.patch('/bulk', async (req: Request, res: Response): Promise<any> => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((value: any) => String(value || '').trim()).filter(Boolean)
      : [];
    const patch = req.body?.patch && typeof req.body.patch === 'object' ? req.body.patch : {};
    const reason = normalizeText(req.body?.reason);

    if (!reason) {
      return res.status(400).json({ message: 'reason ist verpflichtend.' });
    }
    if (ids.length === 0) {
      return res.status(400).json({ message: 'ids darf nicht leer sein.' });
    }

    const db = getDatabase();
    const access = await getRequestAccessContext(req);
    const allowedStatuses = new Set([
      'pending_validation',
      'pending',
      'open',
      'assigned',
      'in-progress',
      'completed',
      'closed',
    ]);
    const allowedPriorities = new Set(['low', 'medium', 'high', 'critical']);
    const patchHasResponsibilityAuthority = Object.prototype.hasOwnProperty.call(
      patch || {},
      'responsibilityAuthority'
    );
    const allowedResponsibilityAuthorities = patchHasResponsibilityAuthority
      ? await loadAllowedResponsibilityAuthorities()
      : [];
    const resolvedBulkResponsibilityAuthority = patchHasResponsibilityAuthority
      ? resolveResponsibilityAuthority(patch.responsibilityAuthority, allowedResponsibilityAuthorities)
      : null;
    if (
      patchHasResponsibilityAuthority &&
      normalizeText(patch?.responsibilityAuthority).length > 0 &&
      !resolvedBulkResponsibilityAuthority
    ) {
      return res.status(400).json({
        message: `Ungueltige Zustaendigkeit. Erlaubt: ${allowedResponsibilityAuthorities.join(', ') || 'keine'}.`,
      });
    }

    const details: Array<{ id: string; success: boolean; message?: string }> = [];
    let updated = 0;

    for (const ticketId of ids) {
      try {
        const permission = await requireTicketAccess(
          normalizeText(req.userId),
          normalizeText(req.role),
          ticketId,
          true
        );
        if (!permission.allowed) {
          details.push({ id: ticketId, success: false, message: 'Keine Berechtigung' });
          continue;
        }
        const existing = await db.get(
          `SELECT t.status,
                  t.priority,
                  t.category,
                  t.assigned_to,
                  t.responsibility_authority,
                  t.validation_token,
                  t.submission_id,
                  c.email as citizen_email,
                  c.name as citizen_name
           FROM tickets t
           LEFT JOIN citizens c ON c.id = t.citizen_id
           WHERE t.id = ?`,
          [ticketId]
        );
        if (!existing) {
          details.push({ id: ticketId, success: false, message: 'Ticket nicht gefunden' });
          continue;
        }

        const updates: string[] = [];
        const values: any[] = [];
        const submissionUpdates: string[] = [];
        const submissionValues: any[] = [];

        if (patch.status !== undefined) {
          const status = normalizeText(patch.status);
          if (!allowedStatuses.has(status)) {
            details.push({ id: ticketId, success: false, message: 'Ungueltiger Status' });
            continue;
          }
          updates.push('status = ?');
          values.push(status);
        }
        if (patch.priority !== undefined) {
          const priority = normalizeText(patch.priority).toLowerCase();
          if (!allowedPriorities.has(priority)) {
            details.push({ id: ticketId, success: false, message: 'Ungueltige Prioritaet' });
            continue;
          }
          updates.push('priority = ?');
          values.push(priority);
          submissionUpdates.push('priority = ?');
          submissionValues.push(priority);
        }
        if (patch.assignedTo !== undefined) {
          updates.push('assigned_to = ?');
          values.push(normalizeText(patch.assignedTo) || null);
        }
        if (patch.category !== undefined) {
          const category = normalizeText(patch.category);
          updates.push('category = ?');
          values.push(category || null);
          submissionUpdates.push('category = ?');
          submissionValues.push(category || null);
        }
        if (patchHasResponsibilityAuthority) {
          updates.push('responsibility_authority = ?');
          values.push(resolvedBulkResponsibilityAuthority || null);
        }

        if (updates.length > 0) {
          updates.push('updated_at = CURRENT_TIMESTAMP');
          await db.run(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`, [...values, ticketId]);
        }
        if (submissionUpdates.length > 0) {
          submissionUpdates.push('updated_at = CURRENT_TIMESTAMP');
          await db.run(
            `UPDATE submissions SET ${submissionUpdates.join(', ')}
             WHERE id = (SELECT submission_id FROM tickets WHERE id = ?)`,
            [...submissionValues, ticketId]
          );
        }

        if (
          patch.status !== undefined &&
          existing.status &&
          patch.status !== existing.status &&
          typeof existing.citizen_email === 'string' &&
          existing.citizen_email
        ) {
          await sendStatusChangeNotification(
            existing.citizen_email,
            existing.citizen_name || 'Buerger',
            ticketId,
            existing.status,
            String(patch.status),
            'Automatische Bulk-Aenderung',
            existing.validation_token || undefined
          );
        }

        const startWorkflow =
          patch.startWorkflow === true ||
          patch.startWorkflow === 'true' ||
          patch.workflowAction === 'start';
        if (startWorkflow) {
          const templateId = normalizeText(patch.workflowTemplateId) || 'standard-redmine-ticket';
          await attachWorkflowToTicket(ticketId, templateId, { skipIfExisting: true });
        }

        const bulkChangeLines: string[] = [];
        if (patch.status !== undefined) {
          bulkChangeLines.push(`- Status: ${normalizeText(existing.status) || '—'} -> ${normalizeText(patch.status) || '—'}`);
        }
        if (patch.priority !== undefined) {
          bulkChangeLines.push(`- Priorität: ${normalizeText(existing.priority) || '—'} -> ${normalizeText(patch.priority) || '—'}`);
        }
        if (patch.category !== undefined) {
          bulkChangeLines.push(`- Kategorie: ${normalizeText(existing.category) || '—'} -> ${normalizeText(patch.category) || '—'}`);
        }
        if (patch.assignedTo !== undefined) {
          bulkChangeLines.push(`- Legacy-Zuweisung: ${normalizeText(existing.assigned_to) || '—'} -> ${normalizeText(patch.assignedTo) || '—'}`);
        }
        if (patchHasResponsibilityAuthority) {
          bulkChangeLines.push(
            `- Zuständigkeit: ${normalizeText(existing.responsibility_authority) || '—'} -> ${normalizeText(
              resolvedBulkResponsibilityAuthority
            ) || '—'}`
          );
        }
        if (startWorkflow) {
          bulkChangeLines.push(`- Workflow gestartet: ${normalizeText(patch.workflowTemplateId) || 'standard-redmine-ticket'}`);
        }
        if (bulkChangeLines.length > 0) {
          const commentId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          await db.run(
            `INSERT INTO ticket_comments (
              id, ticket_id, author_type, author_id, author_name, visibility, comment_type, content, metadata_json
            ) VALUES (?, ?, 'staff', ?, ?, 'internal', 'note', ?, ?)`,
            [
              commentId,
              ticketId,
              normalizeText((req as any).userId) || null,
              normalizeText((req as any).username) || null,
              [`Bulk-Änderung ausgeführt. Grund: ${reason}`, ...bulkChangeLines].join('\n'),
              JSON.stringify({
                source: 'admin.ticket.bulk_patch',
                reason,
                patch,
              }),
            ]
          );
        }

        publishTicketUpdate({
          reason: 'ticket.bulk.updated',
          ticketId,
        });
        updated += 1;
        details.push({ id: ticketId, success: true, message: 'Aktualisiert' });
      } catch (innerError: any) {
        details.push({
          id: ticketId,
          success: false,
          message: innerError?.message || 'Fehler beim Aktualisieren',
        });
      }
    }

    const failed = details.filter((item) => !item.success).length;
    return res.json({
      total: ids.length,
      updated,
      failed,
      details,
      reason,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Bulk-Update', error: error?.message });
  }
});

/**
 * POST /api/admin/tickets/:id/geocode
 * Geocode ticket address and persist coordinates
 */
router.post('/admin/:ticketId/geocode', async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
    const access = await ensureTicketScope(req, res, ticketId, true);
    if (!access) return;
    const db = getDatabase();
    const ticket = await db.get(
      `SELECT t.id, t.address, t.postal_code, t.city, t.submission_id, t.created_at,
              s.address as submission_address, s.postal_code as submission_postal_code, s.city as submission_city
       FROM tickets t
       LEFT JOIN submissions s ON s.id = t.submission_id
       WHERE t.id = ?`,
      [ticketId]
    );
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    const override = normalizeText(req.body?.addressOverride);
    const addressQuery =
      override ||
      [ticket.address || ticket.submission_address, ticket.postal_code || ticket.submission_postal_code, ticket.city || ticket.submission_city]
        .filter(Boolean)
        .join(', ');
    if (!addressQuery) {
      return res.status(400).json({ message: 'Keine Adresse für Geocoding verfügbar.' });
    }

    const geocoded = await geocodeAddressWithNominatim(addressQuery);
    if (!geocoded) {
      return res.status(404).json({ message: 'Adresse konnte nicht geocodiert werden.' });
    }

    const nextAddress = geocoded.address || addressQuery;
    const nextPostalCode = geocoded.postalCode || normalizeText(ticket.postal_code || ticket.submission_postal_code);
    const nextCity = geocoded.city || normalizeText(ticket.city || ticket.submission_city);
    const enrichment = await enrichGeoAndWeather({
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
      address: nextAddress,
      postalCode: nextPostalCode,
      city: nextCity,
      reportedAt: ticket.created_at || new Date().toISOString(),
    });

    const finalLatitude = enrichment.latitude !== null ? Number(enrichment.latitude) : geocoded.latitude;
    const finalLongitude = enrichment.longitude !== null ? Number(enrichment.longitude) : geocoded.longitude;
    const finalAddress = normalizeText(enrichment.address) || nextAddress;
    const finalPostalCode = normalizeText(enrichment.postalCode) || nextPostalCode || null;
    const finalCity = normalizeText(enrichment.city) || nextCity || null;
    const finalNominatimRaw = enrichment.nominatimRaw || geocoded.nominatimRaw || null;
    const finalNominatimRawJson = finalNominatimRaw ? JSON.stringify(finalNominatimRaw) : null;
    const weatherReportJson = enrichment.weatherReport ? JSON.stringify(enrichment.weatherReport) : null;

    await db.run(
      `UPDATE tickets
       SET latitude = ?, longitude = ?, address = ?, postal_code = ?, city = ?, nominatim_raw_json = ?, weather_report_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        finalLatitude,
        finalLongitude,
        finalAddress,
        finalPostalCode,
        finalCity,
        finalNominatimRawJson,
        weatherReportJson,
        ticketId,
      ]
    );

    if (ticket.submission_id) {
      await db.run(
        `UPDATE submissions
         SET latitude = ?, longitude = ?, address = ?, postal_code = ?, city = ?, nominatim_raw_json = ?, weather_report_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          finalLatitude,
          finalLongitude,
          finalAddress,
          finalPostalCode,
          finalCity,
          finalNominatimRawJson,
          weatherReportJson,
          ticket.submission_id,
        ]
      );
    }

    publishTicketUpdate({
      reason: 'ticket.geocoded',
      ticketId,
    });

    return res.json({
      latitude: finalLatitude,
      longitude: finalLongitude,
      address: finalAddress,
      postalCode: finalPostalCode,
      city: finalCity,
      source: geocoded.source,
      nominatimRaw: finalNominatimRaw,
      weatherReport: enrichment.weatherReport || null,
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Fehler beim Geocoding', error: error?.message });
  }
});

/**
 * DELETE /api/tickets/:ticketId
 * Ticket löschen (nur Admin)
 */
router.delete('/:ticketId', async (req: Request, res: Response) => {
  try {
    if (!isAdminRole(req.role)) {
      return res.status(403).json({ message: 'Admin-Rechte erforderlich' });
    }

    const { ticketId } = req.params;
    const access = await ensureTicketScope(req, res, ticketId, true);
    if (!access) return;
    const db = getDatabase();

    const ticket = await db.get(`SELECT submission_id FROM tickets WHERE id = ?`, [ticketId]);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    await db.run(`DELETE FROM tickets WHERE id = ?`, [ticketId]);

    if (ticket.submission_id) {
      await db.run(`DELETE FROM submissions WHERE id = ?`, [ticket.submission_id]);
    }

    publishTicketUpdate({
      reason: 'ticket.deleted',
      ticketId,
    });

    return res.json({ message: 'Ticket gelöscht' });
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Löschen des Tickets' });
  }
});

export default router;
