/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Email Service
 * Handles SMTP-based email sending for confirmations, notifications, and escalations
 */

import nodemailer from 'nodemailer';
import { createHash } from 'crypto';
import { getDatabase } from '../database.js';
import {
  getSystemPrompt,
  loadEmailTemplateSettings,
  loadGeneralSettings,
  loadSmtpSettings,
  loadSmtpSettingsForTenant,
} from './settings.js';
import { buildCallbackLink, buildTicketStatusCallbackLink } from './callback-links.js';
import { testAIProvider } from './ai.js';
import { getPlannedEmailTemplateTranslation, renderTemplateWithData } from './translation-planner.js';
import { createAdminNotification } from './admin-notifications.js';
import { ensureUnifiedEmailTemplateHtml } from '../utils/email-design.js';
import { formatSqlDateTime } from '../utils/sql-date.js';
import { mirrorCitizenEmailToAppMessages } from './citizen-messages.js';
import { getEmailTemplate } from './content-libraries.js';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  ticketId?: string;
  tenantId?: string;
  translateForCitizen?: boolean;
  translationTemplateId?: string;
  translationTemplateData?: Record<string, string>;
}

interface TransporterConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

type EmailQueueStatus = 'pending' | 'retry' | 'processing' | 'sent' | 'failed' | 'cancelled';

interface EmailQueueRow {
  id: string;
  to_email: string;
  subject: string;
  html_content: string;
  text_content: string | null;
  ticket_id: string | null;
  tenant_id: string | null;
  provider_message_id: string | null;
  status: EmailQueueStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  scheduled_at: string;
  sent_at: string | null;
  updated_at: string;
}

export interface EmailQueueEntry {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string | null;
  ticketId: string | null;
  tenantId: string | null;
  providerMessageId: string | null;
  status: EmailQueueStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  scheduledAt: string;
  sentAt: string | null;
  updatedAt: string;
}

interface EmailQueueListResult {
  items: EmailQueueEntry[];
  total: number;
  limit: number;
  offset: number;
  statusCounts: Record<EmailQueueStatus, number>;
}

interface QueueEmailOptions extends EmailOptions {
  scheduleAt?: Date | string;
  maxAttempts?: number;
}

const QUEUE_RETRY_BASE_SECONDS = 30;
const QUEUE_RETRY_MAX_SECONDS = 30 * 60;
const QUEUE_DEFAULT_MAX_ATTEMPTS = 5;
const QUEUE_WORKER_INTERVAL_MS = 5000;
const QUEUE_WORKER_BATCH_SIZE = 5;
const GLOBAL_FOOTER_MARKER = '<!--GLOBAL_EMAIL_FOOTER-->';
const QUEUE_STATUSES: EmailQueueStatus[] = ['pending', 'retry', 'processing', 'sent', 'failed', 'cancelled'];
const EMAIL_TRANSLATION_NOTICE_SEED = 'email_translation_notice_v1';

type EmailTranslationPart = 'subject' | 'html' | 'text' | 'translationNotice';

interface EmailTranslationSourceParts {
  subject: string;
  html: string;
  text: string;
  translationNoticeSeed: string;
}

interface EmailTranslationParts {
  subject?: string;
  html?: string;
  text?: string;
  translationNotice?: string;
}

function scheduleEmailQueueBatch(limit?: number): void {
  void processEmailQueueBatch(limit).catch((error) => {
    console.error('Email queue batch processing failed:', error);
  });
}

const transporterCache = new Map<string, nodemailer.Transporter>();
let queueWorkerTimer: NodeJS.Timeout | null = null;
let queueWorkerRunning = false;
const TICKET_ID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function extractTicketIds(value: string): string[] {
  const source = String(value || '').toLowerCase();
  const seen = new Set<string>();
  const values: string[] = [];
  let match: RegExpExecArray | null = null;
  TICKET_ID_REGEX.lastIndex = 0;
  while ((match = TICKET_ID_REGEX.exec(source)) !== null) {
    const ticketId = String(match[0] || '').trim().toLowerCase();
    if (!ticketId || seen.has(ticketId)) continue;
    seen.add(ticketId);
    values.push(ticketId);
  }
  return values;
}

function inferTicketIdFromEmailOptions(options: EmailOptions): string {
  const explicit = String(options.ticketId || '').trim().toLowerCase();
  if (explicit) return explicit;
  const fromSubject = extractTicketIds(options.subject || '');
  if (fromSubject.length > 0) return fromSubject[0];

  const markerSources = [
    String(options.text || ''),
    String(options.html || '').replace(/<[^>]*>/g, ' '),
  ];
  for (const source of markerSources) {
    const markerMatch = source.match(/ticket[\s_-]?id[:#\s]+([0-9a-f-]{36})/i);
    if (markerMatch?.[1]) {
      const candidate = markerMatch[1].trim().toLowerCase();
      if (candidate) return candidate;
    }
    const uuidMatches = extractTicketIds(source);
    if (uuidMatches.length > 0) return uuidMatches[0];
  }
  return '';
}

function ensureTicketIdInSubject(subject: string, ticketId: string): string {
  const normalizedSubject = String(subject || '').trim();
  const normalizedTicket = String(ticketId || '').trim().toLowerCase();
  if (!normalizedTicket) return normalizedSubject;
  const existingIds = extractTicketIds(normalizedSubject);
  if (existingIds.includes(normalizedTicket)) return normalizedSubject;
  if (!normalizedSubject) return `[Ticket ${normalizedTicket}]`;
  return `[Ticket ${normalizedTicket}] ${normalizedSubject}`;
}

function normalizeTenantId(value: unknown): string {
  return String(value || '').trim();
}

async function resolveTenantIdForTicket(ticketId: string): Promise<string> {
  const normalizedTicketId = String(ticketId || '').trim();
  if (!normalizedTicketId) return '';
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT tenant_id
     FROM tickets
     WHERE id = ?
     LIMIT 1`,
    [normalizedTicketId]
  );
  return normalizeTenantId(row?.tenant_id);
}

function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return data[key] ?? '';
    }
    return match;
  });
}

async function loadTemplate(templateId: string): Promise<{ subject: string; htmlContent: string; textContent?: string } | null> {
  try {
    const parsed = await getEmailTemplate(templateId, {
      scope: 'platform',
      includeInherited: true,
    });
    if (!parsed?.subject || !parsed?.htmlContent) return null;
    const subject = String(parsed.subject);
    const normalizedHtml = ensureUnifiedEmailTemplateHtml(String(parsed.htmlContent), subject);
    return {
      subject,
      htmlContent: normalizedHtml,
      textContent:
        typeof parsed.textContent === 'string' && parsed.textContent.trim()
          ? String(parsed.textContent)
          : undefined,
    };
  } catch {
    return null;
  }
}

export async function renderStoredTemplate(
  templateId: string,
  data: Record<string, string>,
  fallback: { subject: string; htmlContent: string; textContent?: string }
): Promise<{ subject: string; html: string; text: string }> {
  const template = await loadTemplate(templateId);
  if (!template) {
    const fallbackSubject = renderTemplate(fallback.subject, data);
    const fallbackHtml = renderTemplate(
      ensureUnifiedEmailTemplateHtml(fallback.htmlContent, fallback.subject),
      data
    );
    const fallbackText = renderTemplate(
      fallback.textContent || normalizePlainText(fallbackHtml),
      data
    );
    return {
      subject: fallbackSubject,
      html: fallbackHtml,
      text: fallbackText,
    };
  }

  const renderedHtml = renderTemplate(template.htmlContent, data);
  return {
    subject: renderTemplate(template.subject, data),
    html: renderedHtml,
    text: renderTemplate(template.textContent || normalizePlainText(renderedHtml), data),
  };
}

function parseJsonObject(raw: string): Record<string, any> | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildEmailTranslationCacheKey(part: EmailTranslationPart, source: string): string {
  const hash = createHash('sha256')
    .update(`${part}\n${String(source || '')}`)
    .digest('hex')
    .slice(0, 40);
  return `email_translation_part:${part}:${hash}`;
}

function getEmailTranslationPartSource(input: EmailTranslationSourceParts, part: EmailTranslationPart): string {
  if (part === 'subject') return input.subject;
  if (part === 'html') return input.html;
  if (part === 'text') return input.text;
  return input.translationNoticeSeed;
}

async function loadCachedEmailTranslationParts(
  language: string,
  sourceParts: EmailTranslationSourceParts
): Promise<EmailTranslationParts> {
  const normalizedLanguage = String(language || '').trim().toLowerCase();
  if (!normalizedLanguage) return {};

  const partToKey: Record<EmailTranslationPart, string> = {
    subject: buildEmailTranslationCacheKey('subject', sourceParts.subject),
    html: buildEmailTranslationCacheKey('html', sourceParts.html),
    text: buildEmailTranslationCacheKey('text', sourceParts.text),
    translationNotice: buildEmailTranslationCacheKey('translationNotice', sourceParts.translationNoticeSeed),
  };
  const keys = Object.values(partToKey);
  if (keys.length === 0) return {};

  const db = getDatabase();
  const placeholders = keys.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT \`key\`, \`value\`
     FROM translations
     WHERE language = ? AND \`key\` IN (${placeholders})`,
    [normalizedLanguage, ...keys]
  );

  const keyToPart = new Map<string, EmailTranslationPart>(
    (Object.keys(partToKey) as EmailTranslationPart[]).map((part) => [partToKey[part], part])
  );
  const result: EmailTranslationParts = {};
  for (const row of rows || []) {
    const key = String((row as any)?.key || '');
    const value = normalizeNonEmptyString((row as any)?.value);
    const part = keyToPart.get(key);
    if (!part || !value) continue;
    result[part] = value;
  }
  return result;
}

async function storeCachedEmailTranslationParts(
  language: string,
  sourceParts: EmailTranslationSourceParts,
  translatedParts: EmailTranslationParts
): Promise<void> {
  const normalizedLanguage = String(language || '').trim().toLowerCase();
  if (!normalizedLanguage) return;

  const entries = (Object.keys(translatedParts) as EmailTranslationPart[])
    .map((part) => {
      const value = normalizeNonEmptyString(translatedParts[part]);
      if (!value) return null;
      const source = getEmailTranslationPartSource(sourceParts, part);
      if (!source) return null;
      return {
        key: buildEmailTranslationCacheKey(part, source),
        value,
      };
    })
    .filter((entry): entry is { key: string; value: string } => entry !== null);
  if (entries.length === 0) return;

  const db = getDatabase();
  for (const entry of entries) {
    await db.run(
      `INSERT INTO translations (language, \`key\`, \`value\`, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(language, \`key\`) DO UPDATE SET
         \`value\` = excluded.\`value\`,
         updated_at = CURRENT_TIMESTAMP`,
      [normalizedLanguage, entry.key, entry.value]
    );
  }
}

function normalizeTemplateData(data?: Record<string, string>): Record<string, string> {
  if (!data || typeof data !== 'object') return {};
  const result: Record<string, string> = {};
  Object.entries(data).forEach(([key, value]) => {
    if (!key) return;
    result[key] = String(value ?? '');
  });
  return result;
}

function getLanguageBaseCode(code: string): string {
  return String(code || '')
    .trim()
    .toLowerCase()
    .split('-')[0] || '';
}

function normalizeTemplateDataValueKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[.!?;:,]+$/g, '');
}

function buildEmailTemplateDataTranslationCacheKey(
  templateId: string,
  dataKey: string,
  sourceValue: string
): string {
  const hash = createHash('sha256')
    .update(`${templateId}\n${dataKey}\n${sourceValue}`)
    .digest('hex')
    .slice(0, 40);
  return `email_template_data:${templateId}:${dataKey}:${hash}`;
}

function resolveFastEmailTemplateDataTranslation(
  languageCode: string,
  templateId: string,
  dataKey: string,
  sourceValue: string
): string | null {
  const baseLanguage = getLanguageBaseCode(languageCode);
  const normalizedTemplateId = String(templateId || '').trim().toLowerCase();
  const normalizedDataKey = String(dataKey || '').trim();
  const normalizedValue = normalizeTemplateDataValueKey(sourceValue);

  if (baseLanguage === 'en' && normalizedTemplateId === 'submission-confirmation' && normalizedDataKey === 'priority') {
    const priorityMap: Record<string, string> = {
      niedrig: 'Low',
      low: 'Low',
      mittel: 'Medium',
      medium: 'Medium',
      hoch: 'High',
      high: 'High',
      kritisch: 'Critical',
      critical: 'Critical',
    };
    if (priorityMap[normalizedValue]) {
      return priorityMap[normalizedValue];
    }
  }

  if (baseLanguage !== 'en' || normalizedTemplateId !== 'status-change') {
    return null;
  }

  if (normalizedDataKey === 'oldStatus' || normalizedDataKey === 'newStatus') {
    const statusMap: Record<string, string> = {
      pending_validation: 'Pending validation',
      pending: 'Pending',
      offen: 'Open',
      open: 'Open',
      zugewiesen: 'Assigned',
      assigned: 'Assigned',
      'in bearbeitung': 'In progress',
      'in-progress': 'In progress',
      in_progress: 'In progress',
      inprogress: 'In progress',
      inarbeit: 'In progress',
      completed: 'Completed',
      abgeschlossen: 'Completed',
      closed: 'Closed',
      geschlossen: 'Closed',
    };
    if (statusMap[normalizedValue]) {
      return statusMap[normalizedValue];
    }
  }

  if (normalizedDataKey === 'statusMessage') {
    const messageMap: Record<string, string> = {
      'automatische statusaenderung durch workflow': 'Automatic status update by workflow',
      'automatische statusanderung durch workflow': 'Automatic status update by workflow',
    };
    if (messageMap[normalizedValue]) {
      return messageMap[normalizedValue];
    }
  }

  return null;
}

async function loadCachedEmailTemplateDataTranslations(
  languageCode: string,
  templateId: string,
  sourceByKey: Record<string, string>
): Promise<Record<string, string>> {
  const normalizedLanguage = String(languageCode || '').trim().toLowerCase();
  const baseLanguage = getLanguageBaseCode(normalizedLanguage);
  const normalizedTemplateId = String(templateId || '').trim().toLowerCase();
  const sourceEntries = Object.entries(sourceByKey).filter(([, value]) => normalizeNonEmptyString(value));
  if (!normalizedLanguage || !normalizedTemplateId || sourceEntries.length === 0) return {};

  const keyToCacheKey = new Map<string, string>();
  sourceEntries.forEach(([dataKey, sourceValue]) => {
    keyToCacheKey.set(
      dataKey,
      buildEmailTemplateDataTranslationCacheKey(normalizedTemplateId, dataKey, String(sourceValue))
    );
  });
  const cacheKeys = Array.from(keyToCacheKey.values());
  if (cacheKeys.length === 0) return {};

  const db = getDatabase();
  const placeholders = cacheKeys.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT \`key\`, \`value\`
     FROM translations
     WHERE language = ? AND \`key\` IN (${placeholders})`,
    [normalizedLanguage, ...cacheKeys]
  );

  const cacheKeyToDataKey = new Map<string, string>();
  keyToCacheKey.forEach((cacheKey, dataKey) => {
    cacheKeyToDataKey.set(cacheKey, dataKey);
  });
  const result: Record<string, string> = {};
  (rows || []).forEach((row: any) => {
    const cacheKey = String(row?.key || '');
    const dataKey = cacheKeyToDataKey.get(cacheKey);
    const value = normalizeNonEmptyString(row?.value);
    if (!dataKey || !value) return;
    // Guard against stale fallback values (source text persisted as "translation").
    if (baseLanguage !== 'de') {
      const sourceValue = normalizeNonEmptyString(sourceByKey[dataKey]);
      if (
        sourceValue &&
        normalizeTemplateDataValueKey(sourceValue) === normalizeTemplateDataValueKey(value)
      ) {
        return;
      }
    }
    result[dataKey] = value;
  });
  return result;
}

async function storeCachedEmailTemplateDataTranslations(
  languageCode: string,
  templateId: string,
  sourceByKey: Record<string, string>,
  translatedByKey: Record<string, string>
): Promise<void> {
  const normalizedLanguage = String(languageCode || '').trim().toLowerCase();
  const normalizedTemplateId = String(templateId || '').trim().toLowerCase();
  if (!normalizedLanguage || !normalizedTemplateId) return;

  const entries = Object.keys(translatedByKey)
    .map((dataKey) => {
      const sourceValue = normalizeNonEmptyString(sourceByKey[dataKey]);
      const translatedValue = normalizeNonEmptyString(translatedByKey[dataKey]);
      if (!sourceValue || !translatedValue) return null;
      return {
        cacheKey: buildEmailTemplateDataTranslationCacheKey(normalizedTemplateId, dataKey, sourceValue),
        translatedValue,
      };
    })
    .filter((entry): entry is { cacheKey: string; translatedValue: string } => entry !== null);
  if (entries.length === 0) return;

  const db = getDatabase();
  for (const entry of entries) {
    await db.run(
      `INSERT INTO translations (language, \`key\`, \`value\`, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(language, \`key\`) DO UPDATE SET
         \`value\` = excluded.\`value\`,
         updated_at = CURRENT_TIMESTAMP`,
      [normalizedLanguage, entry.cacheKey, entry.translatedValue]
    );
  }
}

async function translateEmailTemplateDataWithAi(
  language: { code: string; name: string },
  sourceByKey: Record<string, string>
): Promise<Record<string, string>> {
  const sourceEntries = Object.entries(sourceByKey).filter(([, value]) => normalizeNonEmptyString(value));
  if (sourceEntries.length === 0) return {};

  try {
    const systemPrompt = await getSystemPrompt('uiTranslationPrompt');
    const prompt = `${systemPrompt}

Quelle:
- Sprache: Deutsch

Ziel:
- Name: ${language.name || language.code}
- Code: ${language.code}

Uebersetze das Input-JSON in die Zielsprache.
Wichtig:
- Gib nur ein JSON-Objekt mit exakt den gleichen Schluesseln zurueck.
- Keine Erklaerungen, kein Markdown.

Input JSON:
${JSON.stringify(Object.fromEntries(sourceEntries), null, 2)}

Output JSON:`;

    const raw = await testAIProvider(prompt, {
      purpose: 'email_template_data_translation',
      waitTimeoutMs: 12000,
      meta: {
        source: 'services.email.template_data',
        targetLanguage: language.code,
        keys: sourceEntries.map(([key]) => key),
      },
    });
    const parsed = parseJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const root =
      parsed.translations && typeof parsed.translations === 'object' && !Array.isArray(parsed.translations)
        ? (parsed.translations as Record<string, any>)
        : (parsed as Record<string, any>);
    const result: Record<string, string> = {};
    sourceEntries.forEach(([key]) => {
      const translated = normalizeNonEmptyString(root[key]);
      if (translated) {
        result[key] = translated;
      }
    });
    return result;
  } catch (error) {
    console.warn('Failed to translate dynamic email template data:', error);
    return {};
  }
}

async function localizeEmailTemplateDataForCitizen(
  language: { code: string; name: string },
  templateId: string,
  templateData: Record<string, string>
): Promise<Record<string, string>> {
  const normalizedTemplateId = String(templateId || '').trim().toLowerCase();
  if (!normalizedTemplateId) return templateData;

  const translatableKeysByTemplate: Record<string, string[]> = {
    'status-change': ['oldStatus', 'newStatus', 'statusMessage'],
    'submission-confirmation': ['category', 'priority'],
  };
  const candidateKeys = translatableKeysByTemplate[normalizedTemplateId] || [];
  if (candidateKeys.length === 0) return templateData;

  const sourceByKey: Record<string, string> = {};
  candidateKeys.forEach((key) => {
    const value = normalizeNonEmptyString(templateData[key]);
    if (!value) return;
    // IDs, links and similar technical values must remain untouched.
    if (/^(https?:\/\/|mailto:)/i.test(value)) return;
    sourceByKey[key] = value;
  });
  if (Object.keys(sourceByKey).length === 0) return templateData;

  const localizedData = { ...templateData };
  const missingByKey: Record<string, string> = {};
  Object.entries(sourceByKey).forEach(([dataKey, sourceValue]) => {
    const fastValue = resolveFastEmailTemplateDataTranslation(language.code, normalizedTemplateId, dataKey, sourceValue);
    if (fastValue) {
      localizedData[dataKey] = fastValue;
    } else {
      missingByKey[dataKey] = sourceValue;
    }
  });
  if (Object.keys(missingByKey).length === 0) return localizedData;

  const cached = await loadCachedEmailTemplateDataTranslations(language.code, normalizedTemplateId, missingByKey);
  const stillMissingByKey: Record<string, string> = {};
  Object.entries(missingByKey).forEach(([dataKey, sourceValue]) => {
    const cachedValue = normalizeNonEmptyString(cached[dataKey]);
    if (cachedValue) {
      localizedData[dataKey] = cachedValue;
    } else {
      stillMissingByKey[dataKey] = sourceValue;
    }
  });
  if (Object.keys(stillMissingByKey).length === 0) return localizedData;

  const translated = await translateEmailTemplateDataWithAi(language, stillMissingByKey);
  if (Object.keys(translated).length > 0) {
    await storeCachedEmailTemplateDataTranslations(language.code, normalizedTemplateId, stillMissingByKey, translated);
  }
  Object.entries(stillMissingByKey).forEach(([dataKey, sourceValue]) => {
    localizedData[dataKey] = normalizeNonEmptyString(translated[dataKey]) || sourceValue;
  });
  return localizedData;
}

async function findCitizenLanguageByEmail(email: string): Promise<{ code: string; name: string } | null> {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    const db = getDatabase();
    const row = await db.get(
      `SELECT preferred_language AS code, preferred_language_name AS name
       FROM citizens
       WHERE lower(email) = ?
       LIMIT 1`,
      [normalizedEmail]
    );
    const code = String(row?.code || '').trim().toLowerCase();
    if (!code || code === 'de' || code.startsWith('de-')) return null;
    const name = String(row?.name || '').trim() || code;
    return { code, name };
  } catch (error) {
    console.warn('Failed to resolve citizen language preference:', error);
    return null;
  }
}

async function maybeTranslateEmailForCitizen(options: EmailOptions): Promise<EmailOptions> {
  if (options.translateForCitizen !== true) return options;
  const citizenLanguage = await findCitizenLanguageByEmail(options.to);
  if (!citizenLanguage) return options;

  let plannedParts: EmailTranslationParts = {};
  const plannedTemplateId = String(options.translationTemplateId || '').trim();
  if (plannedTemplateId) {
    try {
      const planned = await getPlannedEmailTemplateTranslation(citizenLanguage.code, plannedTemplateId);
      if (planned) {
        const templateData = normalizeTemplateData(options.translationTemplateData);
        const localizedTemplateData = await localizeEmailTemplateDataForCitizen(
          citizenLanguage,
          plannedTemplateId,
          templateData
        );
        const renderedSubject = renderTemplateWithData(planned.subject, localizedTemplateData).trim();
        const renderedHtmlBase = renderTemplateWithData(planned.htmlContent, localizedTemplateData).trim();
        const textTemplateBase = planned.textContent || normalizePlainText(planned.htmlContent);
        const renderedTextBase = renderTemplateWithData(textTemplateBase, localizedTemplateData).trim();
        const translationNotice = String(planned.translationNotice || '').trim();

        if (renderedSubject && renderedHtmlBase) {
          plannedParts = {
            subject: renderedSubject,
            html: renderedHtmlBase,
            ...(renderedTextBase ? { text: renderedTextBase } : {}),
            ...(translationNotice ? { translationNotice } : {}),
          };
        }
      }
    } catch {
      // Fallback to on-demand AI translation below.
    }
  }

  const baseText = normalizePlainText(options.html, options.text);
  const sourceParts: EmailTranslationSourceParts = {
    subject: String(options.subject || '').trim(),
    html: String(options.html || '').trim(),
    text: baseText,
    translationNoticeSeed: EMAIL_TRANSLATION_NOTICE_SEED,
  };
  const cachedParts = await loadCachedEmailTranslationParts(citizenLanguage.code, sourceParts);
  const resolveExistingPart = (part: EmailTranslationPart): string =>
    normalizeNonEmptyString(plannedParts[part]) || normalizeNonEmptyString(cachedParts[part]);
  const requiredParts: EmailTranslationPart[] = ['subject', 'html'];
  const optionalParts: EmailTranslationPart[] = ['text', 'translationNotice'];
  const requestedParts = [...requiredParts, ...optionalParts].filter(
    (part) => !resolveExistingPart(part)
  );
  const missingRequiredParts = requiredParts.filter((part) => requestedParts.includes(part));

  let freshParts: EmailTranslationParts = {};
  if (requestedParts.length > 0) {
    const systemPrompt = await getSystemPrompt('emailTranslationPrompt');
    const prompt = `${systemPrompt}

Zielsprache:
- Name: ${citizenLanguage.name}
- Code: ${citizenLanguage.code}

Zu uebersetzende Teile (nur diese liefern):
${JSON.stringify(requestedParts)}

translationNotice:
- Sehr kurz (ein Satz)
- In der Zielsprache
- Muss aussagen, dass die Uebersetzung mit KI erzeugt wurde

Input JSON:
${JSON.stringify(
  {
    subject: options.subject,
    html: options.html,
    text: baseText,
  },
  null,
  2
)}`;

    try {
      const raw = await testAIProvider(prompt, {
        purpose: 'email_translation',
        meta: {
          source: 'services.email',
          to: options.to,
          requestedParts,
        },
      });
      const parsed = parseJsonObject(raw);
      if (parsed) {
        for (const part of requestedParts) {
          const candidate = normalizeNonEmptyString(parsed[part]);
          if (candidate) {
            freshParts[part] = candidate;
          }
        }
        if (Object.keys(freshParts).length > 0) {
          await storeCachedEmailTranslationParts(citizenLanguage.code, sourceParts, freshParts);
        }
      }
    } catch (error) {
      console.warn(`Email translation failed for ${options.to}:`, error);
    }
  }

  const resolvedSubject = normalizeNonEmptyString(
    freshParts.subject || plannedParts.subject || cachedParts.subject
  );
  const resolvedHtml = normalizeNonEmptyString(
    freshParts.html || plannedParts.html || cachedParts.html
  );
  if (!resolvedSubject || !resolvedHtml) {
    return options;
  }
  const resolvedText = normalizeNonEmptyString(
    freshParts.text || plannedParts.text || cachedParts.text
  );
  const resolvedTranslationNotice = normalizeNonEmptyString(
    freshParts.translationNotice || plannedParts.translationNotice || cachedParts.translationNotice
  );

  const noticeHtml = resolvedTranslationNotice
    ? `<p style="margin-top:18px;font-size:12px;color:#4f667f;">${escapeHtml(resolvedTranslationNotice)}</p>`
    : '';
  const withNoticeHtml = noticeHtml ? `${resolvedHtml}\n${noticeHtml}` : resolvedHtml;
  const withNoticeText = resolvedTranslationNotice
    ? `${resolvedText || normalizePlainText(withNoticeHtml)}\n\n${resolvedTranslationNotice}`
    : (resolvedText || normalizePlainText(withNoticeHtml));

  return {
    ...options,
    subject: resolvedSubject,
    html: withNoticeHtml,
    text: withNoticeText,
    translateForCitizen: true,
  };
}

/**
 * Initialize email transporter from environment variables
 */
async function getTransporter(tenantId?: string): Promise<{
  transporter: nodemailer.Transporter | null;
  fromName: string;
  fromEmail: string;
}> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const smtpConfig = normalizedTenantId
    ? await loadSmtpSettingsForTenant(normalizedTenantId, false)
    : await loadSmtpSettings(false);
  const smtp = smtpConfig.values;

  if (!smtp.smtpHost || !smtp.smtpUser || !smtp.smtpPassword) {
    console.warn(
      normalizedTenantId
        ? `SMTP not configured for tenant ${normalizedTenantId}. Email sending disabled.`
        : 'SMTP not configured. Email sending disabled.'
    );
    return { transporter: null, fromName: smtp.smtpFromName || 'OI App', fromEmail: smtp.smtpFromEmail || 'noreply@example.com' };
  }

  const smtpPort = parseInt(smtp.smtpPort || '587', 10);
  const config: TransporterConfig = {
    host: smtp.smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtp.smtpUser,
      pass: smtp.smtpPassword,
    },
  };

  const key = JSON.stringify({
    host: config.host,
    port: config.port,
    user: config.auth.user,
    pass: config.auth.pass,
  });

  let transporter = transporterCache.get(key) || null;
  if (!transporter) {
    try {
      transporter = nodemailer.createTransport(config);
      transporterCache.set(key, transporter);
    } catch (error) {
      console.error('Failed to create email transporter:', error);
      transporter = null;
    }
  }

  return {
    transporter,
    fromName: smtp.smtpFromName || 'OI App',
    fromEmail: smtp.smtpFromEmail || 'noreply@example.com',
  };
}

function normalizePlainText(html: string, text?: string): string {
  if (text && typeof text === 'string' && text.trim()) return text.trim();
  const source = String(html || '');
  if (!source.trim()) return '';
  return source
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTemplateLocalSignatureHtml(html: string): string {
  const source = String(html || '').trim();
  if (!source) return '';
  return source
    .replace(
      /(?:\s*<p\b[^>]*>\s*(?:Mit freundlichen Gr(?:ü|ue)(?:ß|ss)en|Freundliche Gr(?:ü|ue)(?:ß|ss)e|Best regards|Kind regards|Regards)[\s\S]*?<\/p>\s*)$/i,
      ''
    )
    .replace(
      /(?:\s*<p\b[^>]*>\s*(?:Mit freundlichen Gr(?:ü|ue)(?:ß|ss)en|Freundliche Gr(?:ü|ue)(?:ß|ss)e|Best regards|Kind regards|Regards)[\s\S]*?<\/p>\s*)(\s*(?:<\/(?:div|section|article|table|tbody|tr|td|body|html)>\s*)+)$/i,
      '$1'
    )
    .trim();
}

function stripTemplateLocalSignatureText(text: string): string {
  const source = String(text || '').trim();
  if (!source) return '';
  return source
    .replace(
      /(?:\r?\n){1,3}(?:Mit freundlichen Gr(?:ü|ue)(?:ß|ss)en|Freundliche Gr(?:ü|ue)(?:ß|ss)e|Best regards|Kind regards|Regards)[\s\S]*$/i,
      ''
    )
    .trim();
}

function hardenEmailHtmlForClients(html: string): string {
  let normalized = String(html || '').trim();
  if (!normalized) return '';

  normalized = normalized.replace(
    /background:\s*linear-gradient\(([^)]+)\);/gi,
    (_match, gradientArgs) =>
      `background-color:#003762;background:#003762;background-image:linear-gradient(${gradientArgs});`
  );
  normalized = normalized
    .replace(/color:\s*#fff\b/gi, 'color:#ffffff')
    .replace(/color:\s*white\b/gi, 'color:#ffffff');

  normalized = normalized.replace(
    /<(div|table|td)([^>]*?)style="([^"]*)"([^>]*)>/gi,
    (_match, tagName, before, styleRaw, after) => {
      if (/\bbgcolor\s*=/.test(`${before}${after}`)) {
        return `<${tagName}${before}style="${styleRaw}"${after}>`;
      }
      const style = String(styleRaw || '');
      const bgColorMatch =
        style.match(/(?:^|;)\s*background-color\s*:\s*(#[0-9a-f]{3,8})\b/i) ||
        style.match(/(?:^|;)\s*background\s*:\s*(#[0-9a-f]{3,8})\b/i);
      const bgColor = bgColorMatch?.[1];
      if (!bgColor) {
        return `<${tagName}${before}style="${styleRaw}"${after}>`;
      }
      return `<${tagName}${before}style="${styleRaw}" bgcolor="${bgColor}"${after}>`;
    }
  );

  normalized = normalized.replace(
    /<a([^>]*?)style="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi,
    (_match, before, styleRaw, after, inner) => {
      let style = String(styleRaw || '').trim();
      const hasBackgroundStyle = /(?:^|;)\s*background(?:-color)?\s*:/i.test(style);
      if (hasBackgroundStyle) {
        if (/(?:^|;)\s*color\s*:/i.test(style)) {
          style = style.replace(/(?:^|;)\s*color\s*:\s*[^;]+;?/i, ';color:#ffffff !important;');
        } else {
          style += ';color:#ffffff !important;';
        }
        if (!/(?:^|;)\s*text-decoration\s*:/i.test(style)) {
          style += ';text-decoration:none;';
        }
        if (!/(?:^|;)\s*display\s*:\s*inline-block/i.test(style)) {
          style += ';display:inline-block;';
        }
      }

      const trimmedInner = String(inner || '').trim();
      const hasInnerColor = /<span\b[^>]*color\s*:/i.test(trimmedInner);
      const nextInner = hasBackgroundStyle && trimmedInner && !hasInnerColor
        ? `<span style="color:#ffffff !important;">${trimmedInner}</span>`
        : inner;
      return `<a${before}style="${style}"${after}>${nextInner}</a>`;
    }
  );

  return normalized;
}

function normalizeFooterText(footerHtml: string, footerText: string): string {
  const normalizedText = (footerText || '').trim();
  if (normalizedText) return normalizedText;
  return footerHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function applyGlobalEmailFooter(html: string, text?: string): Promise<{ html: string; text: string }> {
  const body = String(html || '').trim();
  if (!body) return { html: '', text: normalizePlainText('', text) };
  if (body.includes(GLOBAL_FOOTER_MARKER)) {
    return { html: body, text: normalizePlainText(body, text) };
  }

  const { values } = await loadEmailTemplateSettings();
  if (!values.footerEnabled) {
    return { html: body, text: normalizePlainText(body, text) };
  }

  const footerHtml = String(values.footerHtml || '').trim();
  if (!footerHtml) {
    return { html: body, text: normalizePlainText(body, text) };
  }

  const withFooter = `${body}
${GLOBAL_FOOTER_MARKER}
<div style="margin-top:24px;padding-top:12px;border-top:1px solid #c8d7e5;color:#42576d;font-size:12px;line-height:1.5;">
${footerHtml}
</div>`;
  const footerText = normalizeFooterText(footerHtml, values.footerText || '');
  const normalizedBodyText = normalizePlainText(body, text);
  const normalizedText = footerText
    ? `${normalizedBodyText}\n\n---\n${footerText}`
    : normalizedBodyText;

  return { html: withFooter, text: normalizedText };
}

function normalizeQueueEntry(row: EmailQueueRow): EmailQueueEntry {
  return {
    id: row.id,
    to: row.to_email,
    subject: row.subject,
    html: row.html_content,
    text: row.text_content,
    ticketId: row.ticket_id || null,
    tenantId: normalizeTenantId(row.tenant_id) || null,
    providerMessageId: row.provider_message_id || null,
    status: row.status,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || QUEUE_DEFAULT_MAX_ATTEMPTS),
    lastError: row.last_error || null,
    createdAt: row.created_at,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at || null,
    updatedAt: row.updated_at,
  };
}

function sanitizeMaxAttempts(value?: number): number {
  if (!value || !Number.isFinite(value)) return QUEUE_DEFAULT_MAX_ATTEMPTS;
  const parsed = Math.floor(value);
  if (parsed < 1) return 1;
  if (parsed > 20) return 20;
  return parsed;
}

const toSqlDateTime = (value?: Date | string): string => formatSqlDateTime(value);

function computeRetryDelaySeconds(attempt: number): number {
  const exp = Math.max(0, Math.min(6, attempt - 1));
  const backoff = QUEUE_RETRY_BASE_SECONDS * 2 ** exp;
  return Math.min(QUEUE_RETRY_MAX_SECONDS, backoff);
}

function buildEmailQueueId(): string {
  return `mail_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function sendEmailDirect(options: EmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const { transporter: mailer, fromName, fromEmail } = await getTransporter(options.tenantId);

    if (!mailer) {
      return { success: false, error: 'Email transporter not configured' };
    }

    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: normalizePlainText(options.html, options.text),
    };

    const info = await mailer.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function queueEmail(options: QueueEmailOptions): Promise<EmailQueueEntry | null> {
  try {
    const db = getDatabase();
    const id = buildEmailQueueId();
    const scheduledAt = toSqlDateTime(options.scheduleAt);
    const maxAttempts = sanitizeMaxAttempts(options.maxAttempts);
    const inferredTicketId = inferTicketIdFromEmailOptions(options);
    const explicitTenantId = normalizeTenantId(options.tenantId);
    const tenantId = explicitTenantId || (await resolveTenantIdForTicket(inferredTicketId));
    const withoutTemplateSignature: QueueEmailOptions = {
      ...options,
      html: stripTemplateLocalSignatureHtml(options.html),
      text: stripTemplateLocalSignatureText(options.text || ''),
    };
    const translated = await maybeTranslateEmailForCitizen(withoutTemplateSignature);
    const subjectWithTicket = ensureTicketIdInSubject(translated.subject, inferredTicketId);
    const normalizedWithFooter = await applyGlobalEmailFooter(translated.html, translated.text);
    const hardenedHtml = hardenEmailHtmlForClients(normalizedWithFooter.html);
    const plainText = normalizePlainText(hardenedHtml, normalizedWithFooter.text);

    await db.run(
      `INSERT INTO email_queue (
        id,
        to_email,
        subject,
        html_content,
        text_content,
        ticket_id,
        tenant_id,
        status,
        attempts,
        max_attempts,
        created_at,
        scheduled_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)`,
      [
        id,
        translated.to,
        subjectWithTicket,
        hardenedHtml,
        plainText,
        inferredTicketId || null,
        tenantId || null,
        maxAttempts,
        scheduledAt,
      ]
    );

    try {
      await mirrorCitizenEmailToAppMessages({
        to: translated.to,
        subject: subjectWithTicket,
        html: hardenedHtml,
        text: plainText,
        sourceRef: translated.translationTemplateId || null,
        metadata: {
          translationTemplateId: translated.translationTemplateId || null,
          queueId: id,
          ticketId: inferredTicketId || null,
        },
      });
    } catch (mirrorError) {
      console.warn('Failed to mirror outgoing email to citizen app message:', mirrorError);
    }

    const row = await db.get(`SELECT * FROM email_queue WHERE id = ? LIMIT 1`, [id]);
    if (!row) return null;
    return normalizeQueueEntry(row as EmailQueueRow);
  } catch (error) {
    console.error('Failed to enqueue email:', error);
    return null;
  }
}

async function processNextEmailQueueItem(): Promise<boolean> {
  const db = getDatabase();
  let row: EmailQueueRow | null = null;

  try {
    const next = await db.get(
      `SELECT * FROM email_queue
       WHERE status IN ('pending', 'retry')
         AND datetime(COALESCE(scheduled_at, created_at)) <= datetime('now')
       ORDER BY datetime(COALESCE(scheduled_at, created_at)) ASC, datetime(created_at) ASC
       LIMIT 1`
    );

    if (!next) {
      return false;
    }

    row = next as EmailQueueRow;
    const claimed = await db.run(
      `UPDATE email_queue
       SET status = 'processing', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('pending', 'retry')`,
      [row.id]
    );

    if (!claimed?.changes) {
      return true;
    }
  } catch (error) {
    console.error('Failed to claim queued email:', error);
    return false;
  }

  if (!row) return false;

  const resolvedTenantId =
    normalizeTenantId(row.tenant_id) || (await resolveTenantIdForTicket(String(row.ticket_id || '').trim()));
  const sendResult = await sendEmailDirect({
    to: row.to_email,
    subject: row.subject,
    html: row.html_content,
    text: row.text_content || undefined,
    tenantId: resolvedTenantId || undefined,
  });

  const nextAttempts = Number(row.attempts || 0) + 1;
  const maxAttempts = sanitizeMaxAttempts(Number(row.max_attempts || QUEUE_DEFAULT_MAX_ATTEMPTS));

  if (sendResult.success) {
    await db.run(
      `UPDATE email_queue
       SET status = 'sent',
           attempts = ?,
           sent_at = CURRENT_TIMESTAMP,
           provider_message_id = ?,
           last_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextAttempts, sendResult.messageId || null, row.id]
    );
    console.log(`Email sent from queue (${row.id})`, sendResult.messageId || '');
    return true;
  }

  const retriesLeft = nextAttempts < maxAttempts;
  if (retriesLeft) {
    const waitSeconds = computeRetryDelaySeconds(nextAttempts);
    await db.run(
      `UPDATE email_queue
       SET status = 'retry',
           attempts = ?,
           last_error = ?,
           scheduled_at = datetime('now', '+' || ? || ' seconds'),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextAttempts, sendResult.error || 'Unbekannter Fehler', waitSeconds, row.id]
    );
  } else {
    await db.run(
      `UPDATE email_queue
       SET status = 'failed',
           attempts = ?,
           last_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextAttempts, sendResult.error || 'Unbekannter Fehler', row.id]
    );
    await createAdminNotification({
      eventType: 'email_send_failed',
      severity: 'error',
      title: 'E-Mail-Versand dauerhaft fehlgeschlagen',
      message: `Queue-ID ${row.id} konnte nicht zugestellt werden.`,
      roleScope: 'staff',
      context: {
        queueId: row.id,
        to: row.to_email,
        subject: row.subject,
        attempts: nextAttempts,
        maxAttempts,
        error: sendResult.error || 'Unbekannter Fehler',
      },
    });
  }

  console.error(`Email queue send failed (${row.id}):`, sendResult.error);
  return true;
}

export async function processEmailQueueBatch(limit = QUEUE_WORKER_BATCH_SIZE): Promise<number> {
  if (queueWorkerRunning) return 0;
  queueWorkerRunning = true;
  let processed = 0;

  try {
    for (let i = 0; i < limit; i += 1) {
      const handled = await processNextEmailQueueItem();
      if (!handled) break;
      processed += 1;
    }
  } finally {
    queueWorkerRunning = false;
  }

  return processed;
}

export function startEmailQueueWorker(): void {
  if (queueWorkerTimer) return;

  queueWorkerTimer = setInterval(() => {
    scheduleEmailQueueBatch();
  }, QUEUE_WORKER_INTERVAL_MS);

  scheduleEmailQueueBatch();
  console.log(`Email queue worker started (interval: ${QUEUE_WORKER_INTERVAL_MS}ms)`);
}

export async function listEmailQueue(input?: {
  status?: EmailQueueStatus | 'all';
  limit?: number;
  offset?: number;
}): Promise<EmailQueueListResult> {
  const statusFilter = input?.status && input.status !== 'all' ? input.status : null;
  const limit = Math.min(200, Math.max(1, Number(input?.limit || 50)));
  const offset = Math.max(0, Number(input?.offset || 0));
  const db = getDatabase();

  const whereSql = statusFilter ? 'WHERE status = ?' : '';
  const params = statusFilter ? [statusFilter, limit, offset] : [limit, offset];
  const rows = await db.all(
    `SELECT * FROM email_queue ${whereSql}
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`,
    params
  );
  const countRow = statusFilter
    ? await db.get(`SELECT COUNT(*) as total FROM email_queue WHERE status = ?`, [statusFilter])
    : await db.get(`SELECT COUNT(*) as total FROM email_queue`);
  const grouped = await db.all(`SELECT status, COUNT(*) as count FROM email_queue GROUP BY status`);

  const statusCounts: Record<EmailQueueStatus, number> = {
    pending: 0,
    retry: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of grouped || []) {
    const status = String((row as any).status || '') as EmailQueueStatus;
    if (QUEUE_STATUSES.includes(status)) {
      statusCounts[status] = Number((row as any).count || 0);
    }
  }

  return {
    items: (rows || []).map((row: any) => normalizeQueueEntry(row as EmailQueueRow)),
    total: Number((countRow as any)?.total || 0),
    limit,
    offset,
    statusCounts,
  };
}

async function getEmailQueueItemById(id: string): Promise<EmailQueueEntry | null> {
  const db = getDatabase();
  const row = await db.get(`SELECT * FROM email_queue WHERE id = ? LIMIT 1`, [id]);
  if (!row) return null;
  return normalizeQueueEntry(row as EmailQueueRow);
}

export async function retryEmailQueueItem(id: string): Promise<EmailQueueEntry | null> {
  const db = getDatabase();
  const result = await db.run(
    `UPDATE email_queue
     SET status = 'pending',
         attempts = 0,
         last_error = NULL,
         scheduled_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [id]
  );
  if (!result?.changes) return null;
  const item = await getEmailQueueItemById(id);
  scheduleEmailQueueBatch();
  return item;
}

export async function resendEmailQueueItem(id: string): Promise<EmailQueueEntry | null> {
  const db = getDatabase();
  const source = await db.get(`SELECT * FROM email_queue WHERE id = ? LIMIT 1`, [id]);
  if (!source) return null;

  const sourceRow = source as EmailQueueRow;
  const queued = await queueEmail({
    to: sourceRow.to_email,
    subject: sourceRow.subject,
    html: sourceRow.html_content,
    text: sourceRow.text_content || undefined,
    ticketId: sourceRow.ticket_id || undefined,
    tenantId: normalizeTenantId(sourceRow.tenant_id) || undefined,
    maxAttempts: sourceRow.max_attempts,
  });
  if (!queued) return null;
  scheduleEmailQueueBatch();
  return queued;
}

export async function deleteEmailQueueItem(id: string): Promise<boolean> {
  const db = getDatabase();
  const result = await db.run(`DELETE FROM email_queue WHERE id = ?`, [id]);
  return !!result?.changes;
}

/**
 * Queue email for async delivery.
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const queued = await queueEmail(options);
  if (!queued) return false;
  scheduleEmailQueueBatch(1);
  return true;
}

/**
 * Send submission confirmation email to citizen
 */
export async function sendSubmissionConfirmation(
  citizenEmail: string,
  citizenName: string,
  ticketId: string,
  category: string,
  priority: string,
  validationToken?: string
): Promise<boolean> {
  let statusLink = '';
  let unsubscribeLink = '';
  if (validationToken) {
    try {
      const { values: general } = await loadGeneralSettings();
      statusLink = buildTicketStatusCallbackLink(general.callbackUrl, {
        token: validationToken,
      });
      unsubscribeLink = buildCallbackLink(general.callbackUrl, {
        token: validationToken,
        cb: 'ticket_unsubscribe',
      });
    } catch {
      statusLink = '';
      unsubscribeLink = '';
    }
  }

  const templateData = {
    citizenName,
    ticketId,
    category,
    priority: translatePriority(priority),
    statusLink,
    unsubscribeLink,
  };
  const template = await loadTemplate('submission-confirmation');
  const subject = template
    ? renderTemplate(template.subject, templateData)
    : 'E-Mail-Adresse erfolgreich bestätigt';
  const htmlRaw = template
    ? renderTemplate(template.htmlContent, templateData)
    : `
    <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; color:#001c31;">
      <div style="background:#003762;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:20px;">Ihre Meldung ist bestätigt</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:20px;">
        <p>Hallo ${citizenName},</p>
        <p>Ihre E-Mail-Adresse wurde erfolgreich bestätigt.</p>
        <p>Ihre Meldung ist nun bei uns eingegangen und befindet sich in Bearbeitung.</p>
        <div style="background:#f1f6fb; border:1px solid #c8d7e5; padding:14px; border-radius:8px; margin:18px 0;">
          <p style="margin:0 0 8px 0;"><strong>Ticket-ID:</strong> ${ticketId}</p>
          <p style="margin:0;"><strong>Priorität:</strong> ${translatePriority(priority)}</p>
        </div>
        ${
          statusLink
            ? `<p style="margin-top:0;">Den aktuellen Bearbeitungsstatus können Sie jederzeit unter folgendem Link einsehen:</p>
               <p style="margin:12px 0 0 0;">
                 <a href="${statusLink}" style="display:inline-block;background:#00457c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">
                   Bearbeitungsstatus
                 </a>
               </p>`
            : ''
        }
        <p style="margin-top:16px;">Sie erhalten automatische Benachrichtigungen, sobald sich der Status Ihrer Meldung ändert.</p>
        ${
          unsubscribeLink
            ? `<p style="margin-top:0;">Wenn Sie keine weiteren automatischen E-Mails wünschen, können Sie diese hier abbestellen:</p>
               <p style="margin:12px 0 0 0;">
                 <a href="${unsubscribeLink}" style="display:inline-block;background:#6b7280;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">
                   Automatische Benachrichtigungen abbestellen
                 </a>
               </p>`
            : ''
        }
      </div>
    </div>
  `;
  const html = ensureUnifiedEmailTemplateHtml(htmlRaw, subject);
  const text = template
    ? renderTemplate(template.textContent || normalizePlainText(html), templateData)
    : normalizePlainText(html);

  return sendEmail({
    to: citizenEmail,
    subject,
    html,
    text,
    ticketId,
    translateForCitizen: true,
    translationTemplateId: 'submission-confirmation',
    translationTemplateData: templateData,
  });
}

/**
 * Send status change notification
 */
export async function sendStatusChangeNotification(
  citizenEmail: string,
  citizenName: string,
  ticketId: string,
  oldStatus: string,
  newStatus: string,
  message?: string,
  validationToken?: string
): Promise<boolean> {
  try {
    const db = getDatabase();
    const pref = await db.get(
      `SELECT status_notifications_enabled FROM tickets WHERE id = ? LIMIT 1`,
      [ticketId]
    );
    if (Number(pref?.status_notifications_enabled ?? 1) === 0) {
      return true;
    }
  } catch (error) {
    console.warn('Could not resolve status notification preference:', error);
  }

  let statusLink = '';
  let unsubscribeLink = '';
  if (validationToken) {
    try {
      const { values: general } = await loadGeneralSettings();
      statusLink = buildTicketStatusCallbackLink(general.callbackUrl, {
        token: validationToken,
      });
      unsubscribeLink = buildCallbackLink(general.callbackUrl, {
        token: validationToken,
        cb: 'ticket_unsubscribe',
      });
    } catch {
      statusLink = '';
      unsubscribeLink = '';
    }
  }

  const templateData = {
    citizenName,
    ticketId,
    oldStatus: translateStatus(oldStatus),
    newStatus: translateStatus(newStatus),
    statusMessage: message || '',
    statusLink,
    unsubscribeLink,
  };
  const template = await loadTemplate('status-change');
  const subject = template
    ? renderTemplate(template.subject, templateData)
    : 'Status-Update zu Ihrer Meldung';
  const htmlRaw = template
    ? renderTemplate(template.htmlContent, templateData)
    : `
    <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; color:#001c31;">
      <div style="background:#003762;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:20px;">Status-Update zu Ihrer Meldung</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:20px;">
        <p>Hallo ${citizenName},</p>
        <p>der Bearbeitungsstatus Ihrer Meldung <strong>${ticketId}</strong> wurde aktualisiert.</p>
        <div style="background:#f1f6fb; border:1px solid #c8d7e5; padding:14px; border-radius:8px; margin:18px 0;">
          <p style="margin:0 0 8px 0;"><strong>Vorher:</strong> ${translateStatus(oldStatus)}</p>
          <p style="margin:0;"><strong>Aktuell:</strong> ${translateStatus(newStatus)}</p>
          ${message ? `<p style="margin:10px 0 0 0;"><strong>Hinweis:</strong> ${message}</p>` : ''}
        </div>
        ${
          statusLink
            ? `<p style="margin-top:18px;">
                 <a href="${statusLink}" style="display:inline-block;background:#00457c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">
                   Bearbeitungsstand ansehen
                 </a>
               </p>`
            : ''
        }
        ${
          unsubscribeLink
            ? `<p style="margin-top:14px;">
                 <a href="${unsubscribeLink}" style="display:inline-block;background:#6b7280;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">
                   Automatische Benachrichtigungen abbestellen
                 </a>
               </p>`
            : ''
        }
      </div>
    </div>
  `;
  const html = ensureUnifiedEmailTemplateHtml(htmlRaw, subject);
  const text = template
    ? renderTemplate(template.textContent || normalizePlainText(html), templateData)
    : normalizePlainText(html);

  return sendEmail({
    to: citizenEmail,
    subject,
    html,
    text,
    ticketId,
    translateForCitizen: true,
    translationTemplateId: 'status-change',
    translationTemplateData: templateData,
  });
}

/**
 * Send escalation notification to management
 */
export async function sendEscalationNotification(
  escalateTo: string,
  ticketId: string,
  category: string,
  priority: string,
  description: string,
  reason: string
): Promise<boolean> {
  const subject = `🚨 Ticket-Eskalation: ${category}`;
  
  const html = `
    <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Ticket-Eskalation</h2>
      <p>Ein Ticket wurde zu Ihnen eskaliert:</p>
      
      <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
        <p><strong>Ticket-ID:</strong> ${ticketId}</p>
        <p><strong>Kategorie:</strong> ${category}</p>
        <p><strong>Priorität:</strong> ${translatePriority(priority)}</p>
        <p><strong>Grund:</strong> ${reason}</p>
      </div>
      
      <p><strong>Beschreibung:</strong></p>
      <p>${description}</p>
    </div>
  `;

  return sendEmail({
    to: escalateTo,
    subject,
    html,
    ticketId,
  });
}

/**
 * Send external recipient notification
 */
export async function sendExternalRecipientNotification(
  recipientEmail: string,
  recipientName: string,
  ticketId: string,
  category: string,
  description: string,
  location: string
): Promise<boolean> {
  const subject = `Neue Meldung: ${category}`;
  
  const html = `
    <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Neue Bürgermeldung für ${recipientName}</h2>
      <p>Folgende Meldung erfordert Ihre Aufmerksamkeit:</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Ticket-ID:</strong> ${ticketId}</p>
        <p><strong>Kategorie:</strong> ${category}</p>
        <p><strong>Ort:</strong> ${location}</p>
      </div>
      
      <p><strong>Beschreibung:</strong></p>
      <p>${description}</p>
    </div>
  `;

  return sendEmail({
    to: recipientEmail,
    subject,
    html,
    ticketId,
  });
}

/**
 * Helper: Translate priority to German
 */
function translatePriority(priority: string): string {
  const translations: Record<string, string> = {
    low: 'Niedrig',
    medium: 'Mittel',
    high: 'Hoch',
    critical: 'Kritisch',
  };
  return translations[priority] || priority;
}

/**
 * Helper: Translate status to German
 */
function translateStatus(status: string): string {
  const translations: Record<string, string> = {
    open: 'Offen',
    assigned: 'Zugewiesen',
    'in-progress': 'In Bearbeitung',
    completed: 'Abgeschlossen',
    closed: 'Geschlossen',
  };
  return translations[status] || status;
}

/**
 * Test SMTP connection
 */
export async function testSMTPConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const { transporter: mailer } = await getTransporter();
    if (!mailer) {
      return {
        success: false,
        message: 'SMTP nicht konfiguriert',
      };
    }

    await mailer.verify();
    return {
      success: true,
      message: 'SMTP-Verbindung erfolgreich',
    };
  } catch (error) {
    return {
      success: false,
      message: `SMTP-Fehler: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`,
    };
  }
}
