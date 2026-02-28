/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * AI Service mit OpenAI GPT-4o oder AskCodi Function Calling
 */

import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { getDatabase, type AppDatabase } from '../database.js';
import { classifySubmission } from './classification.js';
import { resolveLlmRuntimeSelection } from './llm-hub.js';
import { publishAiQueueUpdate, publishTicketUpdate } from './realtime.js';
import { formatSqlDateTime } from '../utils/sql-date.js';

let aiClient: OpenAI | null = null;
let cachedConfigKey: string | null = null;
let aiQueueWorkerTimer: NodeJS.Timeout | null = null;
let aiQueueWorkerRunning = false;

interface ResolvedAiRuntimeConfig {
  aiProvider: string;
  aiModel: string;
  connectionId: string;
  connectionName: string;
  apiKey: string;
  baseUrl: string;
}

type AiQueueStatus = 'pending' | 'retry' | 'processing' | 'done' | 'failed' | 'cancelled';

interface AiQueueRow {
  id: string;
  purpose: string;
  prompt: string;
  status: AiQueueStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  result_text: string | null;
  provider: string | null;
  model: string | null;
  meta_json: string | null;
  created_at: string;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

export interface AiQueueEntry {
  id: string;
  purpose: string;
  prompt: string;
  status: AiQueueStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  resultText: string | null;
  provider: string | null;
  model: string | null;
  meta: Record<string, any> | null;
  createdAt: string;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

interface AiQueueListResult {
  items: AiQueueEntry[];
  total: number;
  limit: number;
  offset: number;
  statusCounts: Record<AiQueueStatus, number>;
}

interface QueueAiPromptOptions {
  prompt: string;
  purpose?: string;
  maxAttempts?: number;
  scheduleAt?: Date | string;
  meta?: Record<string, any>;
  connectionId?: string;
  modelId?: string;
  taskKey?: string;
}

interface TestAiProviderOptions {
  purpose?: string;
  maxAttempts?: number;
  waitTimeoutMs?: number;
  meta?: Record<string, any>;
  connectionId?: string;
  modelId?: string;
  taskKey?: string;
}

interface QueueSubmissionDescriptionTranslationInput {
  submissionId: string;
  ticketId?: string;
  sourceText: string;
  sourceLanguage?: string;
  sourceLanguageName?: string;
}

function parseNominatimRaw(value: unknown): Record<string, any> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseWeatherReportRaw(value: unknown): Record<string, any> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const AI_QUEUE_RETRY_BASE_SECONDS = 15;
const AI_QUEUE_RETRY_MAX_SECONDS = 15 * 60;
const AI_QUEUE_DEFAULT_MAX_ATTEMPTS = 2;
const AI_QUEUE_WORKER_INTERVAL_MS = 2500;
const AI_QUEUE_WAIT_POLL_MS = 250;
const AI_QUEUE_WAIT_TIMEOUT_MS = 3 * 60 * 1000;
const AI_QUEUE_BATCH_SIZE = 1;
const AI_QUEUE_STATUSES: AiQueueStatus[] = ['pending', 'retry', 'processing', 'done', 'failed', 'cancelled'];
const AI_QUEUE_PURPOSE_SUBMISSION_DESCRIPTION_TRANSLATION_DE = 'submission_description_translation_de';

function scheduleAiQueueBatch(limit?: number): void {
  void processAiQueueBatch(limit).catch((error) => {
    console.error('AI queue batch processing failed:', error);
  });
}

/**
 * Get or create AI client (lazy initialization)
 */
async function getAIClientWithConfig(input?: {
  purpose?: string;
  taskKey?: string;
  connectionId?: string;
  modelId?: string;
}): Promise<{ client: OpenAI; config: ResolvedAiRuntimeConfig }> {
  const runtime = await resolveLlmRuntimeSelection({
    purpose: input?.purpose,
    taskKey: input?.taskKey,
    connectionId: input?.connectionId,
    modelId: input?.modelId,
  });
  const config: ResolvedAiRuntimeConfig = {
    aiProvider: runtime.connectionName || runtime.connectionId || 'openai_compatible',
    aiModel: runtime.model,
    connectionId: runtime.connectionId,
    connectionName: runtime.connectionName,
    apiKey: runtime.apiKey,
    baseUrl: runtime.baseUrl,
  };
  const key = JSON.stringify({
    connectionId: config.connectionId,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  });

  if (!aiClient || cachedConfigKey !== key) {
    aiClient = new OpenAI({
      apiKey: config.apiKey || '',
      baseURL: config.baseUrl || undefined,
      defaultHeaders: {
        'User-Agent': 'behebes.AI/1.0.0 (LLM Hub)',
      },
    });
    cachedConfigKey = key;
  }
  return { client: aiClient, config };
}

/**
 * Hauptfunktion: Meldung mit KI verarbeiten
 * Gibt Ticket-ID zurück
 */
export async function processMeldingWithAI(
  db: AppDatabase,
  submissionId: string,
  citizenId: string,
  anonymizedText: string
): Promise<string> {
  try {
    const submission = await db.get(
      `SELECT * FROM submissions WHERE id = ?`,
      [submissionId]
    );

    if (!submission) {
      throw new Error('Submission nicht gefunden');
    }
    const citizen = await db.get(
      `SELECT preferred_language, preferred_language_name
       FROM citizens
       WHERE id = ?`,
      [citizenId]
    );

    const { result: classification, knowledge, raw, effectiveInput } = await classifySubmission({
      description: anonymizedText,
      latitude: submission.latitude ?? undefined,
      longitude: submission.longitude ?? undefined,
      address: submission.address ?? undefined,
      city: submission.city ?? undefined,
      postalCode: submission.postal_code ?? undefined,
      nominatimRaw: parseNominatimRaw(submission.nominatim_raw_json),
      weatherReport: parseWeatherReportRaw(submission.weather_report_json),
    });
    const effectiveLatitude =
      effectiveInput?.latitude !== undefined && effectiveInput?.latitude !== null
        ? Number(effectiveInput.latitude)
        : submission.latitude || null;
    const effectiveLongitude =
      effectiveInput?.longitude !== undefined && effectiveInput?.longitude !== null
        ? Number(effectiveInput.longitude)
        : submission.longitude || null;
    const effectiveAddress = String(effectiveInput?.address || submission.address || '').trim() || null;
    const effectivePostalCode = String(effectiveInput?.postalCode || submission.postal_code || '').trim() || null;
    const effectiveCity = String(effectiveInput?.city || submission.city || '').trim() || null;
    const effectiveNominatimRawJson = effectiveInput?.nominatimRaw
      ? JSON.stringify(effectiveInput.nominatimRaw)
      : submission.nominatim_raw_json || null;
    const effectiveWeatherReportJson = effectiveInput?.weatherReport
      ? JSON.stringify(effectiveInput.weatherReport)
      : submission.weather_report_json || null;

    const normalizedCategory = classification?.kategorie?.trim();
    const submissionCategory = submission.category?.trim();
    const categoryIsFallback =
      !normalizedCategory ||
      normalizedCategory.toLowerCase() === 'sonstiges';
    const finalCategory = categoryIsFallback && submissionCategory
      ? submissionCategory
      : normalizedCategory || 'Sonstiges';

    const priorityOptions = ['low', 'medium', 'high', 'critical'];
    const rawPriority = classification?.dringlichkeit || submission.priority || 'medium';
    const finalPriority = priorityOptions.includes(rawPriority) ? rawPriority : 'medium';

    const descriptionWithAnalysis = appendAiReasoningToDescription(
      anonymizedText || null,
      classification?.reasoning || null
    );

    const ticketId = uuidv4();
    await db.run(
      `INSERT INTO tickets (
        id, submission_id, citizen_id, citizen_language, citizen_language_name, category, priority, description, status,
        latitude, longitude, address, postal_code, city, nominatim_raw_json, weather_report_json,
        redmine_project, assigned_to
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ticketId,
        submissionId,
        citizenId,
        citizen?.preferred_language || null,
        citizen?.preferred_language_name || null,
        finalCategory,
        finalPriority,
        descriptionWithAnalysis || null,
        'open',
        effectiveLatitude,
        effectiveLongitude,
        effectiveAddress,
        effectivePostalCode,
        effectiveCity,
        effectiveNominatimRawJson,
        effectiveWeatherReportJson,
        classification?.redmineProject || null,
        classification?.abteilung || null,
      ]
    );

    await db.run(
      `UPDATE submissions
       SET category = ?,
           priority = ?,
           latitude = ?,
           longitude = ?,
           address = ?,
           postal_code = ?,
           city = ?,
           nominatim_raw_json = ?,
           weather_report_json = ?,
           status = 'completed',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        finalCategory,
        finalPriority,
        effectiveLatitude,
        effectiveLongitude,
        effectiveAddress,
        effectivePostalCode,
        effectiveCity,
        effectiveNominatimRawJson,
        effectiveWeatherReportJson,
        submissionId,
      ]
    );

    const aiLogId = uuidv4();
    await db.run(
      `INSERT INTO ai_logs (
        id, ticket_id, submission_id, knowledge_version,
        ai_decision, ai_reasoning, original_category,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        aiLogId,
        ticketId,
        submissionId,
        knowledge?.version || null,
        JSON.stringify(raw || classification),
        classification?.reasoning || null,
        finalCategory,
      ]
    );

    return ticketId;
  } catch (error) {
    console.error('AI processing error:', error);
    // Fallback: Create basic ticket
    return createFallbackTicket(db, submissionId, citizenId);
  }
}

/**
 * Apply AI classification to an existing ticket after validation
 */
export async function applyClassificationToExistingTicket(
  db: AppDatabase,
  submissionId: string,
  ticketId: string
): Promise<void> {
  const submission = await db.get(
    `SELECT * FROM submissions WHERE id = ?`,
    [submissionId]
  );

  if (!submission) {
    throw new Error('Submission nicht gefunden');
  }

  const ticket = await db.get(
    `SELECT id FROM tickets WHERE id = ?`,
    [ticketId]
  );

  if (!ticket) {
    throw new Error('Ticket nicht gefunden');
  }

  const anonymizedText = submission.anonymized_text || submission.original_description || '';

  const { result: classification, knowledge, raw, effectiveInput } = await classifySubmission({
    description: anonymizedText,
    latitude: submission.latitude ?? undefined,
    longitude: submission.longitude ?? undefined,
    address: submission.address ?? undefined,
    city: submission.city ?? undefined,
    postalCode: submission.postal_code ?? undefined,
    nominatimRaw: parseNominatimRaw(submission.nominatim_raw_json),
    weatherReport: parseWeatherReportRaw(submission.weather_report_json),
  });
  const effectiveLatitude =
    effectiveInput?.latitude !== undefined && effectiveInput?.latitude !== null
      ? Number(effectiveInput.latitude)
      : submission.latitude || null;
  const effectiveLongitude =
    effectiveInput?.longitude !== undefined && effectiveInput?.longitude !== null
      ? Number(effectiveInput.longitude)
      : submission.longitude || null;
  const effectiveAddress = String(effectiveInput?.address || submission.address || '').trim() || null;
  const effectivePostalCode = String(effectiveInput?.postalCode || submission.postal_code || '').trim() || null;
  const effectiveCity = String(effectiveInput?.city || submission.city || '').trim() || null;
  const effectiveNominatimRawJson = effectiveInput?.nominatimRaw
    ? JSON.stringify(effectiveInput.nominatimRaw)
    : submission.nominatim_raw_json || null;
  const effectiveWeatherReportJson = effectiveInput?.weatherReport
    ? JSON.stringify(effectiveInput.weatherReport)
    : submission.weather_report_json || null;

  const normalizedCategory = classification?.kategorie?.trim();
  const submissionCategory = submission.category?.trim();
  const categoryIsFallback =
    !normalizedCategory || normalizedCategory.toLowerCase() === 'sonstiges';
  const finalCategory = categoryIsFallback && submissionCategory
    ? submissionCategory
    : normalizedCategory || 'Sonstiges';

  const priorityOptions = ['low', 'medium', 'high', 'critical'];
  const rawPriority = classification?.dringlichkeit || submission.priority || 'medium';
  const finalPriority = priorityOptions.includes(rawPriority) ? rawPriority : 'medium';

  const descriptionWithAnalysis = appendAiReasoningToDescription(
    anonymizedText || null,
    classification?.reasoning || null
  );

  await db.run(
    `UPDATE tickets SET
      category = ?,
      priority = ?,
      description = ?,
      status = 'open',
      latitude = ?,
      longitude = ?,
      address = ?,
      postal_code = ?,
      city = ?,
      nominatim_raw_json = ?,
      weather_report_json = ?,
      redmine_project = ?,
      assigned_to = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      finalCategory,
      finalPriority,
      descriptionWithAnalysis || null,
      effectiveLatitude,
      effectiveLongitude,
      effectiveAddress,
      effectivePostalCode,
      effectiveCity,
      effectiveNominatimRawJson,
      effectiveWeatherReportJson,
      classification?.redmineProject || null,
      classification?.abteilung || null,
      ticketId,
    ]
  );

  await db.run(
    `UPDATE submissions
     SET category = ?,
         priority = ?,
         latitude = ?,
         longitude = ?,
         address = ?,
         postal_code = ?,
         city = ?,
         nominatim_raw_json = ?,
         weather_report_json = ?,
         status = 'completed',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      finalCategory,
      finalPriority,
      effectiveLatitude,
      effectiveLongitude,
      effectiveAddress,
      effectivePostalCode,
      effectiveCity,
      effectiveNominatimRawJson,
      effectiveWeatherReportJson,
      submissionId,
    ]
  );

  const aiLogId = uuidv4();
  await db.run(
    `INSERT INTO ai_logs (
      id, ticket_id, submission_id, knowledge_version,
      ai_decision, ai_reasoning, original_category,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      aiLogId,
      ticketId,
      submissionId,
      knowledge?.version || null,
      JSON.stringify(raw || classification),
      classification?.reasoning || null,
      finalCategory,
    ]
  );
}

export function appendAiReasoningToDescription(
  description: string | null,
  reasoning?: string | null
): string | null {
  if (!reasoning) return description;
  const trimmedReasoning = String(reasoning).trim();
  if (!trimmedReasoning) return description;

  const base = description ? String(description) : '';
  const marker = 'Ergebnis der KI-Analyse:';
  const suffix = `${marker}\n${trimmedReasoning}`;

  if (base.includes(marker) && base.includes(trimmedReasoning)) {
    return base;
  }

  if (!base.trim()) {
    return suffix;
  }

  return `${base}\n\n${suffix}`;
}

async function createFallbackTicket(db: AppDatabase, submissionId: string, citizenId: string): Promise<string> {
  const submission = await db.get(
    `SELECT * FROM submissions WHERE id = ?`,
    [submissionId]
  );
  const citizen = await db.get(
    `SELECT preferred_language, preferred_language_name
     FROM citizens
     WHERE id = ?`,
    [citizenId]
  );

  const ticketId = uuidv4();

  const fallbackCategory = submission?.category || 'Sonstiges';
  const fallbackPriority = submission?.priority || 'medium';

  await db.run(
    `INSERT INTO tickets (
      id, submission_id, citizen_id, citizen_language, citizen_language_name, category, priority, description, status,
      latitude, longitude, address, postal_code, city
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ticketId,
      submissionId,
      citizenId,
      citizen?.preferred_language || null,
      citizen?.preferred_language_name || null,
      fallbackCategory,
      fallbackPriority,
      submission?.anonymized_text || submission?.original_description || null,
      'open',
      submission?.latitude || null,
      submission?.longitude || null,
      submission?.address || null,
      submission?.postal_code || null,
      submission?.city || null,
    ]
  );

  if (submission) {
    await db.run(
      `UPDATE submissions SET category = ?, priority = ?, status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [fallbackCategory, fallbackPriority, submissionId]
    );
  }
  
  return ticketId;
}
function buildAiQueueId(): string {
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseAiQueueMeta(value: string | null): Record<string, any> | null {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeLanguageCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isGermanLanguageCode(value: unknown): boolean {
  const normalized = normalizeLanguageCode(value);
  return normalized === 'de' || normalized.startsWith('de-');
}

function buildSubmissionDescriptionTranslationPrompt(input: {
  sourceText: string;
  sourceLanguageName?: string;
  sourceLanguageCode?: string;
}): string {
  const sourceText = String(input.sourceText || '').trim();
  const sourceLanguageName =
    String(input.sourceLanguageName || '').trim() ||
    String(input.sourceLanguageCode || '').trim() ||
    'unbekannt';
  return [
    'Uebersetze den folgenden Buergertext praezise ins Deutsche.',
    'Regeln:',
    '- Gib nur die deutsche Uebersetzung zurueck.',
    '- Keine Erlaeuterungen, keine Einleitungen, keine Markdown-Formatierung.',
    '- Zahlen, Orte, Eigennamen und Details muessen erhalten bleiben.',
    `Quellsprache: ${sourceLanguageName}`,
    'Text:',
    '"""',
    sourceText,
    '"""',
  ].join('\n');
}

function extractQueueTranslationText(raw: string): string {
  const trim = (value: unknown): string => String(value || '').trim();
  const stripped = trim(raw)
    .replace(/^```(?:json|text|plaintext)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const candidates = [stripped, trim(raw)];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'string' && parsed.trim()) {
        return parsed.trim();
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const root = parsed as Record<string, any>;
        const value =
          root.translation ||
          root.translatedText ||
          root.translated_text ||
          root.text ||
          root.result ||
          root.output;
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }
    } catch {
      // not JSON, treat as plain text below
    }
  }

  const quoted = stripped.match(/^["']([\s\S]*)["']$/);
  return (quoted ? quoted[1] : stripped).trim();
}

async function applySubmissionDescriptionTranslationResult(meta: Record<string, any> | null, resultText: string): Promise<void> {
  const submissionId = String(meta?.submissionId || '').trim();
  if (!submissionId) {
    throw new Error('AI queue meta missing submissionId.');
  }

  const translated = extractQueueTranslationText(resultText);
  if (!translated) {
    throw new Error('AI queue returned empty translation.');
  }

  const db = getDatabase();
  const updateResult = await db.run(
    `UPDATE submissions
     SET translated_description_de = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND (translated_description_de IS NULL OR TRIM(translated_description_de) = '')`,
    [translated, submissionId]
  );
  if (!updateResult?.changes) {
    const existing = await db.get(`SELECT id FROM submissions WHERE id = ? LIMIT 1`, [submissionId]);
    if (!existing?.id) {
      throw new Error(`Submission ${submissionId} not found.`);
    }
  }

  let ticketId = String(meta?.ticketId || '').trim();
  if (!ticketId) {
    const ticket = await db.get(`SELECT id FROM tickets WHERE submission_id = ? LIMIT 1`, [submissionId]);
    ticketId = String(ticket?.id || '').trim();
  }
  if (ticketId) {
    publishTicketUpdate({
      reason: 'ticket.translation.updated',
      ticketId,
    });
  }
}

async function runAiQueuePostProcessing(row: AiQueueRow, resultText: string): Promise<void> {
  const purpose = String(row.purpose || '').trim();
  const meta = parseAiQueueMeta(row.meta_json || null);
  if (purpose === AI_QUEUE_PURPOSE_SUBMISSION_DESCRIPTION_TRANSLATION_DE) {
    await applySubmissionDescriptionTranslationResult(meta, resultText);
  }
}

function normalizeAiQueueEntry(row: AiQueueRow): AiQueueEntry {
  return {
    id: row.id,
    purpose: row.purpose || 'generic',
    prompt: row.prompt,
    status: row.status,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || AI_QUEUE_DEFAULT_MAX_ATTEMPTS),
    lastError: row.last_error || null,
    resultText: row.result_text || null,
    provider: row.provider || null,
    model: row.model || null,
    meta: parseAiQueueMeta(row.meta_json || null),
    createdAt: row.created_at,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    updatedAt: row.updated_at,
  };
}

function sanitizeAiQueueMaxAttempts(value?: number): number {
  if (!Number.isFinite(value as number)) return AI_QUEUE_DEFAULT_MAX_ATTEMPTS;
  const parsed = Math.floor(Number(value));
  if (parsed < 1) return 1;
  if (parsed > 8) return 8;
  return parsed;
}

const toSqlDateTime = (value?: Date | string): string => formatSqlDateTime(value);

function computeAiQueueRetryDelaySeconds(attempt: number): number {
  const exp = Math.max(0, Math.min(6, attempt - 1));
  const backoff = AI_QUEUE_RETRY_BASE_SECONDS * 2 ** exp;
  return Math.min(AI_QUEUE_RETRY_MAX_SECONDS, backoff);
}

async function enqueueAiPrompt(options: QueueAiPromptOptions): Promise<AiQueueEntry | null> {
  const prompt = String(options.prompt || '').trim();
  if (!prompt) return null;

  try {
    const db = getDatabase();
    const id = buildAiQueueId();
    const scheduledAt = toSqlDateTime(options.scheduleAt);
    const maxAttempts = sanitizeAiQueueMaxAttempts(options.maxAttempts);
    const purpose = String(options.purpose || 'generic').trim() || 'generic';
    const mergedMeta = {
      ...(options.meta || {}),
      routing: {
        connectionId: String(options.connectionId || '').trim() || undefined,
        modelId: String(options.modelId || '').trim() || undefined,
        taskKey: String(options.taskKey || '').trim() || undefined,
      },
    };
    const metaJson = JSON.stringify(mergedMeta);
    const { config } = await getAIClientWithConfig({
      purpose,
      taskKey: options.taskKey,
      connectionId: options.connectionId,
      modelId: options.modelId,
    });

    await db.run(
      `INSERT INTO ai_queue (
        id, purpose, prompt, status, attempts, max_attempts,
        last_error, result_text, provider, model, meta_json,
        created_at, scheduled_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)`,
      [id, purpose, prompt, maxAttempts, config.connectionName || config.connectionId, config.aiModel, metaJson, scheduledAt]
    );
    publishAiQueueUpdate({
      reason: 'ai_queue.pending',
      aiQueueId: id,
    });

    const row = await db.get(`SELECT * FROM ai_queue WHERE id = ? LIMIT 1`, [id]);
    if (!row) return null;
    return normalizeAiQueueEntry(row as AiQueueRow);
  } catch (error) {
    console.error('Failed to enqueue AI request:', error);
    return null;
  }
}

async function getAiQueueRowById(id: string): Promise<AiQueueRow | null> {
  const db = getDatabase();
  const row = await db.get(`SELECT * FROM ai_queue WHERE id = ? LIMIT 1`, [id]);
  if (!row) return null;
  return row as AiQueueRow;
}

async function waitForAiQueueResult(queueId: string, timeoutMs: number): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = await getAiQueueRowById(queueId);
    if (!row) {
      throw new Error('KI-Queue-Eintrag wurde nicht gefunden');
    }

    if (row.status === 'done') {
      if (typeof row.result_text === 'string') return row.result_text;
      return '';
    }
    if (row.status === 'failed') {
      throw new Error(row.last_error || 'KI-Queue Verarbeitung fehlgeschlagen');
    }
    if (row.status === 'cancelled') {
      throw new Error('KI-Queue Anfrage wurde abgebrochen');
    }

    await new Promise((resolve) => setTimeout(resolve, AI_QUEUE_WAIT_POLL_MS));
  }

  throw new Error('Zeitüberschreitung beim Warten auf KI-Queue-Ergebnis');
}

async function runAIProviderPromptDirect(
  prompt: string,
  input?: {
    purpose?: string;
    taskKey?: string;
    connectionId?: string;
    modelId?: string;
  }
): Promise<string> {
  try {
    const { client, config } = await getAIClientWithConfig(input);
    const runViaSdk = async (): Promise<string> => {
      const response = await client.chat.completions.create({
        model: config.aiModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
      });

      if (response.choices && response.choices.length > 0) {
        const first = response.choices[0];
        if (first.message && typeof first.message.content === 'string') return first.message.content;
        if ((first as any).text && typeof (first as any).text === 'string') return (first as any).text;
      }

      if ((response as any).content && Array.isArray((response as any).content)) {
        const textBlock = (response as any).content.find((b: any) => b.type === 'text');
        if (textBlock && 'text' in textBlock) return textBlock.text;
      }

      return JSON.stringify(response);
    };

    const isAskCodiConnection =
      /askcodi/i.test(config.connectionName || '') || /askcodi/i.test(config.baseUrl || '');
    if (isAskCodiConnection && config.baseUrl && config.apiKey) {
      try {
        let base = config.baseUrl || '';
        base = base.replace(/\/+$/g, '');
        base = base.replace(/\/v1$/g, '');
        const url = `${base}/v1/chat/completions`;

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
            'User-Agent': 'behebes.AI/1.0.0 (AskCodi Queue Worker)',
          },
          body: JSON.stringify({
            model: config.aiModel,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1024,
          }),
        });

        const text = await res.text();
        if (!res.ok) {
          const detail = text || res.statusText || 'no body';
          throw new Error(`ASKCODI_HTTP_${res.status}: ${detail}`);
        }
        if (!text) {
          throw new Error('Leere Antwort vom Gateway');
        }

        const responseObj = JSON.parse(text);
        if (responseObj.choices && responseObj.choices.length > 0) {
          const first = responseObj.choices[0];
          if (first.message && typeof first.message.content === 'string') return first.message.content;
          if (first.text && typeof first.text === 'string') return first.text;
        }
        if (responseObj.content && Array.isArray(responseObj.content)) {
          const textBlock = responseObj.content.find((b: any) => b.type === 'text');
          if (textBlock && 'text' in textBlock) return textBlock.text;
        }

        return JSON.stringify(responseObj);
      } catch (error) {
        const rawMessage = String(error instanceof Error ? error.message : error || '').trim();
        if (rawMessage.startsWith('ASKCODI_HTTP_')) {
          const statusMatch = rawMessage.match(/^ASKCODI_HTTP_(\d{3}):\s*(.*)$/i);
          if (statusMatch) {
            const status = statusMatch[1];
            const detail = statusMatch[2] || 'no body';
            throw new Error(`${status} status code (${detail})`);
          }
          throw new Error(rawMessage.replace(/^ASKCODI_HTTP_/, '').trim());
        }
        return await runViaSdk();
      }
    }

    return await runViaSdk();
  } catch (error) {
    throw new Error(
      `KI-Provider Aufruf fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function processNextAiQueueItem(): Promise<boolean> {
  const db = getDatabase();
  let row: AiQueueRow | null = null;

  try {
    const next = await db.get(
      `SELECT * FROM ai_queue
       WHERE status IN ('pending', 'retry')
         AND datetime(COALESCE(scheduled_at, created_at)) <= datetime('now')
       ORDER BY datetime(COALESCE(scheduled_at, created_at)) ASC, datetime(created_at) ASC
       LIMIT 1`
    );

    if (!next) {
      return false;
    }

    row = next as AiQueueRow;
    const claimed = await db.run(
      `UPDATE ai_queue
       SET status = 'processing',
           started_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('pending', 'retry')`,
      [row.id]
    );

    if (!claimed?.changes) {
      return true;
    }
    publishAiQueueUpdate({
      reason: 'ai_queue.processing',
      aiQueueId: row.id,
    });
  } catch (error) {
    console.error('Failed to claim AI queue item:', error);
    return false;
  }

  if (!row) return false;

  const nextAttempts = Number(row.attempts || 0) + 1;
  const maxAttempts = sanitizeAiQueueMaxAttempts(Number(row.max_attempts || AI_QUEUE_DEFAULT_MAX_ATTEMPTS));
  const meta = parseAiQueueMeta(row.meta_json || null);
  const routingMeta = meta && typeof meta.routing === 'object' && meta.routing !== null
    ? (meta.routing as Record<string, any>)
    : {};

  try {
    const result = await runAIProviderPromptDirect(String(row.prompt || ''), {
      purpose: row.purpose || 'generic',
      taskKey: String(routingMeta.taskKey || '').trim() || undefined,
      connectionId: String(routingMeta.connectionId || '').trim() || undefined,
      modelId: String(routingMeta.modelId || '').trim() || undefined,
    });
    await runAiQueuePostProcessing(row, result);
    await db.run(
      `UPDATE ai_queue
       SET status = 'done',
           attempts = ?,
           result_text = ?,
           last_error = NULL,
           finished_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextAttempts, result, row.id]
    );
    publishAiQueueUpdate({
      reason: 'ai_queue.done',
      aiQueueId: row.id,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (nextAttempts < maxAttempts) {
      const waitSeconds = computeAiQueueRetryDelaySeconds(nextAttempts);
      await db.run(
        `UPDATE ai_queue
         SET status = 'retry',
             attempts = ?,
             last_error = ?,
             scheduled_at = datetime('now', '+' || ? || ' seconds'),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextAttempts, message, waitSeconds, row.id]
      );
      publishAiQueueUpdate({
        reason: 'ai_queue.retry',
        aiQueueId: row.id,
      });
    } else {
      await db.run(
        `UPDATE ai_queue
         SET status = 'failed',
             attempts = ?,
             last_error = ?,
             finished_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextAttempts, message, row.id]
      );
      publishAiQueueUpdate({
        reason: 'ai_queue.failed',
        aiQueueId: row.id,
      });
    }
    return true;
  }
}

export async function processAiQueueBatch(limit = AI_QUEUE_BATCH_SIZE): Promise<number> {
  if (aiQueueWorkerRunning) return 0;
  aiQueueWorkerRunning = true;
  let processed = 0;

  try {
    for (let i = 0; i < limit; i += 1) {
      const handled = await processNextAiQueueItem();
      if (!handled) break;
      processed += 1;
    }
  } finally {
    aiQueueWorkerRunning = false;
  }

  return processed;
}

export function startAiQueueWorker(): void {
  if (aiQueueWorkerTimer) return;

  aiQueueWorkerTimer = setInterval(() => {
    scheduleAiQueueBatch();
  }, AI_QUEUE_WORKER_INTERVAL_MS);

  scheduleAiQueueBatch();
  console.log(`AI queue worker started (interval: ${AI_QUEUE_WORKER_INTERVAL_MS}ms)`);
}

export async function listAiQueue(input?: {
  status?: AiQueueStatus | 'all';
  limit?: number;
  offset?: number;
}): Promise<AiQueueListResult> {
  const statusFilter = input?.status && input.status !== 'all' ? input.status : null;
  const limit = Math.min(200, Math.max(1, Number(input?.limit || 50)));
  const offset = Math.max(0, Number(input?.offset || 0));
  const db = getDatabase();

  const whereSql = statusFilter ? 'WHERE status = ?' : '';
  const params = statusFilter ? [statusFilter, limit, offset] : [limit, offset];
  const rows = await db.all(
    `SELECT * FROM ai_queue ${whereSql}
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`,
    params
  );

  const countRow = statusFilter
    ? await db.get(`SELECT COUNT(*) as total FROM ai_queue WHERE status = ?`, [statusFilter])
    : await db.get(`SELECT COUNT(*) as total FROM ai_queue`);
  const grouped = await db.all(`SELECT status, COUNT(*) as count FROM ai_queue GROUP BY status`);

  const statusCounts: Record<AiQueueStatus, number> = {
    pending: 0,
    retry: 0,
    processing: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of grouped || []) {
    const status = String((row as any).status || '') as AiQueueStatus;
    if (AI_QUEUE_STATUSES.includes(status)) {
      statusCounts[status] = Number((row as any).count || 0);
    }
  }

  return {
    items: (rows || []).map((row: any) => normalizeAiQueueEntry(row as AiQueueRow)),
    total: Number((countRow as any)?.total || 0),
    limit,
    offset,
    statusCounts,
  };
}

export async function retryAiQueueItem(id: string): Promise<AiQueueEntry | null> {
  const db = getDatabase();
  const result = await db.run(
    `UPDATE ai_queue
     SET status = 'pending',
         attempts = 0,
         last_error = NULL,
         result_text = NULL,
         started_at = NULL,
         finished_at = NULL,
         scheduled_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [id]
  );
  if (!result?.changes) return null;
  publishAiQueueUpdate({
    reason: 'ai_queue.pending',
    aiQueueId: id,
  });
  const row = await getAiQueueRowById(id);
  if (!row) return null;
  scheduleAiQueueBatch(1);
  return normalizeAiQueueEntry(row);
}

export async function cancelAiQueueItem(id: string): Promise<AiQueueEntry | null> {
  const db = getDatabase();
  const result = await db.run(
    `UPDATE ai_queue
     SET status = 'cancelled',
         finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('pending', 'retry')`,
    [id]
  );
  if (!result?.changes) return null;
  publishAiQueueUpdate({
    reason: 'ai_queue.cancelled',
    aiQueueId: id,
  });
  const row = await getAiQueueRowById(id);
  if (!row) return null;
  return normalizeAiQueueEntry(row);
}

export async function deleteAiQueueItem(id: string): Promise<boolean> {
  const db = getDatabase();
  const result = await db.run(`DELETE FROM ai_queue WHERE id = ?`, [id]);
  if (result?.changes) {
    publishAiQueueUpdate({
      reason: 'ai_queue.deleted',
      aiQueueId: id,
    });
  }
  return !!result?.changes;
}

export async function queueSubmissionDescriptionTranslation(
  input: QueueSubmissionDescriptionTranslationInput
): Promise<AiQueueEntry | null> {
  const submissionId = String(input.submissionId || '').trim();
  const sourceText = String(input.sourceText || '').trim();
  const sourceLanguageCode = normalizeLanguageCode(input.sourceLanguage);
  const sourceLanguageName = String(input.sourceLanguageName || '').trim();
  const ticketId = String(input.ticketId || '').trim();

  if (!submissionId || !sourceText) return null;
  if (isGermanLanguageCode(sourceLanguageCode)) return null;

  const db = getDatabase();
  const submission = await db.get(
    `SELECT id, translated_description_de
     FROM submissions
     WHERE id = ?
     LIMIT 1`,
    [submissionId]
  );
  if (!submission?.id) return null;
  if (typeof submission.translated_description_de === 'string' && submission.translated_description_de.trim()) {
    return null;
  }

  // Reuse an existing German translation for the same source text/language if available.
  const reusableTranslation = await db.get(
    `SELECT s.translated_description_de AS translated_description_de
     FROM submissions s
     JOIN tickets t ON t.submission_id = s.id
     WHERE s.id <> ?
       AND COALESCE(TRIM(s.original_description), '') = ?
       AND COALESCE(TRIM(s.translated_description_de), '') <> ''
       AND (
         ? = ''
         OR lower(COALESCE(TRIM(t.citizen_language), '')) = ?
       )
     ORDER BY datetime(s.updated_at) DESC
     LIMIT 1`,
    [submissionId, sourceText, sourceLanguageCode, sourceLanguageCode]
  );
  const reusableText = String(reusableTranslation?.translated_description_de || '').trim();
  if (reusableText) {
    await db.run(
      `UPDATE submissions
       SET translated_description_de = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND (translated_description_de IS NULL OR TRIM(translated_description_de) = '')`,
      [reusableText, submissionId]
    );
    if (ticketId) {
      publishTicketUpdate({
        reason: 'ticket.translation.updated',
        ticketId,
      });
    }
    return null;
  }

  const likeNeedle = `%"submissionId":"${submissionId}"%`;
  const existingQueued = await db.get(
    `SELECT *
     FROM ai_queue
     WHERE purpose = ?
       AND status IN ('pending', 'retry', 'processing')
       AND meta_json LIKE ?
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [AI_QUEUE_PURPOSE_SUBMISSION_DESCRIPTION_TRANSLATION_DE, likeNeedle]
  );
  if (existingQueued) {
    return normalizeAiQueueEntry(existingQueued as AiQueueRow);
  }

  const prompt = buildSubmissionDescriptionTranslationPrompt({
    sourceText,
    sourceLanguageName,
    sourceLanguageCode,
  });
  const queued = await enqueueAiPrompt({
    prompt,
    purpose: AI_QUEUE_PURPOSE_SUBMISSION_DESCRIPTION_TRANSLATION_DE,
    maxAttempts: 2,
    meta: {
      source: 'submission.description.translation',
      submissionId,
      ticketId: ticketId || undefined,
      sourceLanguage: sourceLanguageCode || undefined,
      sourceLanguageName: sourceLanguageName || undefined,
    },
  });
  if (!queued) return null;
  scheduleAiQueueBatch(1);
  return queued;
}

/**
 * Test the current AI provider with a simple prompt.
 * Requests are persisted and processed serially via AI queue.
 */
export async function testAIProvider(prompt: string, options?: TestAiProviderOptions): Promise<string> {
  const queued = await enqueueAiPrompt({
    prompt,
    purpose: options?.purpose || 'generic',
    maxAttempts: options?.maxAttempts,
    meta: options?.meta,
    connectionId: options?.connectionId,
    modelId: options?.modelId,
    taskKey: options?.taskKey,
  });

  if (!queued) {
    throw new Error('KI-Queue konnte nicht erstellt werden');
  }

  scheduleAiQueueBatch(1);
  return waitForAiQueueResult(queued.id, Number(options?.waitTimeoutMs || AI_QUEUE_WAIT_TIMEOUT_MS));
}
