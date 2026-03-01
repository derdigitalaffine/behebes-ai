import { Router, Request, Response } from 'express';
import { readFileSync, renameSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import vm from 'vm';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, staffOnly } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { appendAiReasoningToDescription, testAIProvider } from '../services/ai.js';
import { sendEmail, sendStatusChangeNotification, sendSubmissionConfirmation } from '../services/email.js';
import { classifySubmission } from '../services/classification.js';
import { enrichGeoAndWeather } from '../services/geo-enrichment.js';
import {
  analyzeImageToText,
  buildImageAiPseudonymizedTicketContext,
  computeImageContentHash,
} from '../services/image-ai.js';
import { publishTicketUpdate, publishWorkflowUpdate } from '../services/realtime.js';
import { createAdminNotification } from '../services/admin-notifications.js';
import {
  getSystemPrompt,
  loadGeneralSettings,
  loadRedmineSettings,
  getSetting,
  setSetting,
} from '../services/settings.js';
import {
  buildCallbackLink,
  buildWorkflowConfirmationCallbackLink,
  buildTicketStatusCallbackLink,
  wrapLinkForPwaOpenGate,
} from '../services/callback-links.js';
import {
  getEmailTemplate,
  listWorkflowTemplates,
  replaceWorkflowTemplates,
  upsertWorkflowTemplate,
  deleteWorkflowTemplate,
} from '../services/content-libraries.js';
import {
  loadMunicipalContactsSettings,
  resolveMunicipalContactForTicket,
} from '../services/municipal-contacts.js';
import { buildUnifiedEmailLayout, ensureUnifiedEmailTemplateHtml } from '../utils/email-design.js';
import { formatSqlDateTime } from '../utils/sql-date.js';
import { buildTicketVisibilitySql, loadAdminAccessContext, requireTicketAccess } from '../services/rbac.js';
import { sendTicketAssignmentEmailNotifications } from '../services/ticket-notifications.js';
import { queryResponsibilityCandidates } from '../services/responsibility.js';

type WorkflowStepType =
  | 'REDMINE_TICKET'
  | 'EMAIL'
  | 'EMAIL_EXTERNAL'
  | 'CATEGORIZATION'
  | 'RESPONSIBILITY_CHECK'
  | 'EMAIL_DOUBLE_OPT_IN'
  | 'EMAIL_CONFIRMATION'
  | 'MAYOR_INVOLVEMENT'
  | 'DATENNACHFORDERUNG'
  | 'ENHANCED_CATEGORIZATION'
  | 'FREE_AI_DATA_REQUEST'
  | 'IMAGE_TO_TEXT_ANALYSIS'
  | 'CITIZEN_NOTIFICATION'
  | 'REST_API_CALL'
  | 'INTERNAL_PROCESSING'
  | 'END'
  | 'JOIN'
  | 'SPLIT'
  | 'IF'
  | 'CUSTOM'
  | 'WAIT_STATUS_CHANGE'
  | 'CHANGE_WORKFLOW'
  | 'SUB_WORKFLOW';

type WorkflowExecutionMode = 'MANUAL' | 'AUTO' | 'HYBRID';
type RedmineFieldMode = 'ai' | 'fixed';
type RedmineAssigneeMode = RedmineFieldMode | 'none';
type WorkflowBlockedReason =
  | 'none'
  | 'waiting_external'
  | 'waiting_manual'
  | 'waiting_timer'
  | 'deadlock_or_orphan_path'
  | 'loop_guard'
  | 'error';
type WorkflowSlaState = 'ok' | 'risk' | 'overdue';

interface WorkflowRetryPolicy {
  maxRetries: number;
  backoffSeconds: number;
}

interface WorkflowSlaConfig {
  targetMinutes: number;
  riskThresholdPercent: number;
}

interface WorkflowRuntimeConfig {
  maxTransitionsPerExecution: number;
  maxVisitsPerTask: number;
  defaultStepTimeoutSeconds: number;
  retryPolicy: WorkflowRetryPolicy;
  sla: WorkflowSlaConfig;
}

interface WorkflowExecutionHealth {
  slaState: WorkflowSlaState;
  slaLastNotifiedState: WorkflowSlaState | null;
  transitionCount: number;
  loopGuardTrips: number;
  visitsByTask: Record<string, number>;
  slaTargetMinutes: number;
  slaRiskThresholdPercent: number;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: Array<{
    title: string;
    type: WorkflowStepType;
    config: Record<string, any>;
    auto?: boolean;
  }>;
  executionMode: WorkflowExecutionMode;
  autoTriggerOnEmailVerified?: boolean;
  enabled: boolean;
  runtime?: Partial<WorkflowRuntimeConfig>;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowConfig {
  enabled: boolean;
  templates: WorkflowTemplate[];
  defaultExecutionMode: WorkflowExecutionMode;
  autoTriggerOnEmailVerified: boolean;
  maxStepsPerWorkflow: number;
  standardRedmineWorkflow?: boolean;
  runtimeDefaults?: WorkflowRuntimeConfig;
}

interface WorkflowTask {
  id: string;
  title: string;
  description: string;
  type: WorkflowStepType;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  config: Record<string, any>;
  executionData?: Record<string, any>;
  order: number;
  auto?: boolean;
  pathGroup?: string | null;
}

interface WorkflowHistoryEntry {
  id: string;
  at: string;
  type:
    | 'WORKFLOW_CREATED'
    | 'WORKFLOW_STATUS'
    | 'WORKFLOW_COMPLETED'
    | 'WORKFLOW_FAILED'
    | 'TASK_STATUS'
    | 'TASK_WAITING'
    | 'TASK_DECISION'
    | 'TASK_DATA'
    | 'INFO';
  message: string;
  taskId?: string;
  taskTitle?: string;
  taskType?: WorkflowStepType;
  fromStatus?: string;
  toStatus?: string;
  metadata?: Record<string, any>;
}

interface WorkflowExecution {
  id: string;
  submissionId: string;
  ticketId: string;
  templateId?: string;
  title: string;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  executionMode: WorkflowExecutionMode;
  tasks: WorkflowTask[];
  currentTaskIndex: number;
  activeTaskIds?: string[];
  category: string;
  address?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  blockedReason?: WorkflowBlockedReason;
  health?: WorkflowExecutionHealth;
  history?: WorkflowHistoryEntry[];
  processVariables?: Record<string, any>;
  processVariableMeta?: Record<
    string,
    {
      sourceStepId: string;
      sourceType: string;
      updatedAt: string;
      note?: string;
    }
  >;
  abortNotificationSent?: boolean;
  abortAdminNotificationSent?: boolean;
  parentExecutionId?: string;
  parentTaskId?: string;
  parentTaskType?: WorkflowStepType;
}

interface WorkflowExecutionData {
  awaitingConfirmation?: boolean;
  dataRequestId?: string;
  dataRequestToken?: string;
  dataRequestMode?: 'static' | 'ai';
  dataRequestParallel?: boolean;
  dataRequestTemplateId?: string;
  dataRequestNeedCheck?: {
    requiresAdditionalData: boolean;
    confidence?: number | null;
    categoryConfidence?: number | null;
    priorityConfidence?: number | null;
  };
  awaitingUntil?: string;
  awaitingRedmineIssue?: {
    issueId: number;
    targetStatusIds: number[];
    checkIntervalSeconds?: number;
    startedAt?: string;
    waitMaxSeconds?: number;
  };
  changeWorkflow?: {
    templateId: string;
    execution: WorkflowExecution;
    selectionMode?: 'manual' | 'ai';
    reasoning?: string;
  };
  subWorkflow?: {
    executionId: string;
    templateId: string;
    selectionMode?: 'manual' | 'ai';
    reasoning?: string;
    confidence?: number | null;
    fallbackUsed?: boolean;
    startedAt?: string;
    completedAt?: string;
    status?: 'running' | 'completed' | 'failed';
    failOnChildFailure?: boolean;
  };
  awaitingSubWorkflow?: {
    executionId: string;
    templateId: string;
    failOnChildFailure?: boolean;
  };
  subWorkflowStartExecution?: WorkflowExecution;
  skipped?: boolean;
  reason?: string;
  endScope?: 'branch' | 'workflow';
  nextTaskIds?: string[];
  pathGroup?: string | null;
  pathGroupsByTaskId?: Record<string, string>;
  joinState?: {
    requiredArrivals: number;
    arrivedTaskIds: string[];
    arrivedPathGroups: string[];
  };
  conditionResult?: boolean;
  conditionSummary?: Record<string, any>;
  attempt?: number;
  retryScheduledAt?: string;
  retryBackoffSeconds?: number;
  idempotencyKey?: string;
  aiDecision?: {
    decision: string;
    confidence: number;
    reason: string;
    fallbackUsed: boolean;
  };
  internalTaskId?: string;
  internalTaskMode?: 'blocking' | 'parallel';
  internalTaskStatus?: string;
  internalTaskAssigneeUserId?: string;
  internalTaskAssigneeOrgUnitId?: string;
  internalTaskCompletedAt?: string;
  internalTaskCompletedBy?: string;
  internalTaskResponse?: Record<string, any> | null;
  [key: string]: any;
}

type InternalProcessingMode = 'blocking' | 'parallel';
type InternalProcessingAssigneeStrategy =
  | 'ticket_primary'
  | 'fixed_user'
  | 'fixed_org'
  | 'process_variable';
type InternalTaskAssignmentUpdateMode = 'none' | 'primary_only' | 'primary_plus_participants';
type InternalTaskAssignmentSource = 'static' | 'ai_suggested' | 'mixed';
type InternalTaskDecision = 'completed' | 'rejected';
type InternalTaskStatus = 'pending' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';

interface InternalProcessingFormField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'boolean' | 'select' | 'date' | 'number';
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  helpText?: string;
}

const WORKFLOW_TASK_STATUSES = new Set<WorkflowTask['status']>([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
]);

const WORKFLOW_EXECUTION_STATUSES = new Set<WorkflowExecution['status']>([
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
]);

const WORKFLOW_BLOCKED_REASONS = new Set<WorkflowBlockedReason>([
  'none',
  'waiting_external',
  'waiting_manual',
  'waiting_timer',
  'deadlock_or_orphan_path',
  'loop_guard',
  'error',
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KNOWLEDGE_DIR = resolve(__dirname, '..', '..', 'knowledge');

const router = Router();
const EXECUTIONS_FILE = join(KNOWLEDGE_DIR, 'executions.json');
const EXECUTIONS_FILE_TMP = join(KNOWLEDGE_DIR, 'executions.json.tmp');
const EXECUTIONS_FILE_BAK = join(KNOWLEDGE_DIR, 'executions.json.bak');

const toSqlDateTime = (value?: Date | string): string => formatSqlDateTime(value);
const WORKFLOW_VALIDATION_EXPIRY_HOURS = 48;
const DEFAULT_EMAIL_APPROVAL_TIMEOUT_HOURS = 48;
const DEFAULT_DATA_REQUEST_TIMEOUT_HOURS = 72;
const DEFAULT_MAYOR_APPROVAL_QUESTION =
  'Möchten Sie dieses Anliegen weiter bearbeiten lassen (von behebes) oder den Workflow hier abbrechen und die Bearbeitung ablehnen?';
const WORKFLOW_EXECUTION_HISTORY_LIMIT = 500;
const WORKFLOW_STORAGE_MAX_STRING_LENGTH = 4000;
const WORKFLOW_STORAGE_MAX_ARRAY_LENGTH = 80;
const WORKFLOW_STORAGE_MAX_OBJECT_KEYS = 120;
const WORKFLOW_STORAGE_MAX_DEPTH = 8;
const WORKFLOW_RETAIN_FINISHED_MAX = 1000;
const WORKFLOW_RETAIN_FINISHED_DAYS = 60;
const TICKET_STATUS_OPTIONS = new Set([
  'pending_validation',
  'pending',
  'open',
  'assigned',
  'in-progress',
  'completed',
  'closed',
]);

const WORKFLOW_STEP_TYPES = new Set<WorkflowStepType>([
  'REDMINE_TICKET',
  'EMAIL',
  'EMAIL_EXTERNAL',
  'CATEGORIZATION',
  'RESPONSIBILITY_CHECK',
  'EMAIL_DOUBLE_OPT_IN',
  'EMAIL_CONFIRMATION',
  'MAYOR_INVOLVEMENT',
  'DATENNACHFORDERUNG',
  'ENHANCED_CATEGORIZATION',
  'FREE_AI_DATA_REQUEST',
  'IMAGE_TO_TEXT_ANALYSIS',
  'CITIZEN_NOTIFICATION',
  'REST_API_CALL',
  'INTERNAL_PROCESSING',
  'END',
  'JOIN',
  'SPLIT',
  'IF',
  'CUSTOM',
  'WAIT_STATUS_CHANGE',
  'CHANGE_WORKFLOW',
  'SUB_WORKFLOW',
]);

const DTPN_NOTATION_META = Object.freeze({
  notation: 'DTPN',
  fullName: 'Do Troe Process Notation',
  version: 1,
});

const DEFAULT_WORKFLOW_RUNTIME: WorkflowRuntimeConfig = Object.freeze({
  maxTransitionsPerExecution: 500,
  maxVisitsPerTask: 20,
  defaultStepTimeoutSeconds: 60,
  retryPolicy: {
    maxRetries: 0,
    backoffSeconds: 0,
  },
  sla: {
    targetMinutes: 1440,
    riskThresholdPercent: 80,
  },
});

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;

type ReporterPseudonymPoolType = 'name' | 'email';

interface WorkflowAiPseudonymContext {
  enabled: boolean;
  pseudoName: string;
  pseudoEmail: string;
  forwardReplacements: Array<{ from: string; to: string }>;
  backwardReplacements: Array<{ from: string; to: string }>;
}

function normalizeWorkflowReporterText(value: unknown): string {
  return String(value || '').trim();
}

function sanitizeWorkflowReporterPseudoName(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function hashNormalizedWorkflowReporterValue(value: string): string {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function normalizeWorkflowReporterPoolEntries(raw: unknown, poolType: ReporterPseudonymPoolType): string[] {
  const parsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return [];
          }
        })()
      : raw && typeof raw === 'object' && Array.isArray((raw as any).entries)
      ? (raw as any).entries
      : Array.isArray(raw)
      ? raw
      : [];

  const values = Array.isArray(parsed) ? parsed : [];
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const candidateRaw of values) {
    const normalized =
      poolType === 'name'
        ? sanitizeWorkflowReporterPseudoName(candidateRaw)
        : String(candidateRaw || '')
            .trim()
            .toLowerCase();
    if (!normalized) continue;
    if (poolType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push(normalized);
    if (entries.length >= 10000) break;
  }
  return entries;
}

async function loadWorkflowReporterPseudonymPool(poolType: ReporterPseudonymPoolType): Promise<string[]> {
  const db = getDatabase();
  const row = await db.get(
    `SELECT entries_json
     FROM llm_pseudonym_pools
     WHERE pool_type = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [poolType]
  );
  return normalizeWorkflowReporterPoolEntries(row?.entries_json, poolType);
}

const WORKFLOW_PSEUDO_EMAIL_DOMAIN_STEMS = [
  'buerger',
  'hinweis',
  'service',
  'meldung',
  'ticket',
  'kommunal',
  'info',
];
const WORKFLOW_PSEUDO_EMAIL_TLDS = ['de', 'com', 'net', 'org', 'eu', 'info'];

function fallbackWorkflowPseudoName(index: number): string {
  return `Reporter-${String(Math.max(0, Math.floor(index)) + 1).padStart(4, '0')}`;
}

function fallbackWorkflowPseudoEmail(index: number): string {
  const normalizedIndex = Math.max(0, Math.floor(index));
  const firstStem = WORKFLOW_PSEUDO_EMAIL_DOMAIN_STEMS[normalizedIndex % WORKFLOW_PSEUDO_EMAIL_DOMAIN_STEMS.length];
  const secondStem =
    WORKFLOW_PSEUDO_EMAIL_DOMAIN_STEMS[
      Math.floor(normalizedIndex / WORKFLOW_PSEUDO_EMAIL_DOMAIN_STEMS.length) % WORKFLOW_PSEUDO_EMAIL_DOMAIN_STEMS.length
    ];
  const stem = firstStem === secondStem ? firstStem : `${firstStem}${secondStem}`;
  const tld = WORKFLOW_PSEUDO_EMAIL_TLDS[normalizedIndex % WORKFLOW_PSEUDO_EMAIL_TLDS.length];
  return `reporter-${String(normalizedIndex + 1).padStart(4, '0')}@${stem}.${tld}`;
}

async function ensureWorkflowReporterPseudonymValue(input: {
  scopeKey: string;
  entityType: ReporterPseudonymPoolType;
  realValue: string;
  pool: string[];
  fallback: (index: number) => string;
  ttlDays?: number;
}): Promise<string> {
  const db = getDatabase();
  const normalized = normalizeWorkflowReporterText(input.realValue);
  if (!normalized) return '';
  const ttlDays = Number.isFinite(Number(input.ttlDays)) ? Math.max(1, Number(input.ttlDays)) : 90;
  const hash = hashNormalizedWorkflowReporterValue(normalized);
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
  const fromPool = input.pool.find((entry) => !used.has(entry));
  const pseudo = fromPool || input.fallback(used.size);
  const expiresAt = toSqlDateTime(new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000));

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

function splitWorkflowPseudoName(value: string): { firstName: string; lastName: string } {
  const normalized = normalizeWorkflowReporterText(value);
  if (!normalized) return { firstName: '', lastName: '' };
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

async function upsertWorkflowTicketReporterPseudonym(input: {
  ticketId: string;
  scopeKey: string;
  pseudoName: string;
  pseudoEmail: string;
}): Promise<void> {
  const ticketId = normalizeWorkflowReporterText(input.ticketId);
  if (!ticketId) return;
  const pseudoName = sanitizeWorkflowReporterPseudoName(input.pseudoName);
  const pseudoEmail = normalizeWorkflowReporterText(input.pseudoEmail).toLowerCase();
  const split = splitWorkflowPseudoName(pseudoName);
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

function dedupeReplacementPairs(input: Array<{ from: string; to: string }>): Array<{ from: string; to: string }> {
  const seen = new Set<string>();
  const pairs: Array<{ from: string; to: string }> = [];
  for (const entry of input) {
    const from = normalizeWorkflowReporterText(entry.from);
    const to = normalizeWorkflowReporterText(entry.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ from, to });
  }
  return pairs.sort((a, b) => b.from.length - a.from.length);
}

function applyLiteralReplacements(text: string, replacements: Array<{ from: string; to: string }>): string {
  let result = String(text || '');
  for (const replacement of replacements) {
    if (!replacement.from) continue;
    result = result.split(replacement.from).join(replacement.to);
  }
  return result;
}

async function buildWorkflowAiPseudonymContext(ticket: any): Promise<WorkflowAiPseudonymContext> {
  const ticketId = normalizeWorkflowReporterText(ticket?.id);
  if (!ticketId) {
    return {
      enabled: false,
      pseudoName: '',
      pseudoEmail: '',
      forwardReplacements: [],
      backwardReplacements: [],
    };
  }

  const scopeKey = 'ticket-reporter-stable';
  const realName = normalizeWorkflowReporterText(ticket?.citizen_name);
  const realEmailRaw = normalizeWorkflowReporterText(ticket?.citizen_email);
  const realEmailLower = realEmailRaw.toLowerCase();

  const [namePool, emailPool] = await Promise.all([
    loadWorkflowReporterPseudonymPool('name'),
    loadWorkflowReporterPseudonymPool('email'),
  ]);

  const pseudoName = await ensureWorkflowReporterPseudonymValue({
    scopeKey,
    entityType: 'name',
    realValue: realName || realEmailLower || `ticket:${ticketId}`,
    pool: namePool,
    fallback: fallbackWorkflowPseudoName,
    ttlDays: 90,
  });
  const pseudoEmail = await ensureWorkflowReporterPseudonymValue({
    scopeKey,
    entityType: 'email',
    realValue: realEmailLower || realName || `ticket:${ticketId}`,
    pool: emailPool,
    fallback: fallbackWorkflowPseudoEmail,
    ttlDays: 90,
  });

  await upsertWorkflowTicketReporterPseudonym({
    ticketId,
    scopeKey,
    pseudoName,
    pseudoEmail,
  });

  const forwardReplacements = dedupeReplacementPairs([
    { from: realName, to: pseudoName },
    { from: realEmailRaw, to: pseudoEmail },
    { from: realEmailLower, to: pseudoEmail },
  ]);
  const backwardReplacements = dedupeReplacementPairs([
    { from: pseudoName, to: realName },
    { from: pseudoEmail, to: realEmailRaw || realEmailLower },
  ]);

  return {
    enabled: forwardReplacements.length > 0 && backwardReplacements.length > 0,
    pseudoName,
    pseudoEmail,
    forwardReplacements,
    backwardReplacements,
  };
}

async function testAIProviderForTicketPrompt(input: {
  prompt: string;
  purpose: string;
  meta: Record<string, any>;
  ticket?: any;
}): Promise<string> {
  let pseudonymContext: WorkflowAiPseudonymContext = {
    enabled: false,
    pseudoName: '',
    pseudoEmail: '',
    forwardReplacements: [],
    backwardReplacements: [],
  };
  if (input.ticket) {
    try {
      pseudonymContext = await buildWorkflowAiPseudonymContext(input.ticket);
    } catch (error) {
      console.warn('Workflow AI prompt pseudonymization context failed:', error);
    }
  }

  const promptForAi = pseudonymContext.enabled
    ? applyLiteralReplacements(input.prompt, pseudonymContext.forwardReplacements)
    : input.prompt;
  const raw = await testAIProvider(promptForAi, {
    purpose: input.purpose,
    meta: {
      ...(input.meta || {}),
      reporterPseudonymized: pseudonymContext.enabled,
    },
  });
  if (!pseudonymContext.enabled) {
    return raw;
  }
  return applyLiteralReplacements(raw, pseudonymContext.backwardReplacements);
}

function normalizeRetryPolicy(value: unknown, fallback: WorkflowRetryPolicy): WorkflowRetryPolicy {
  const source = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const maxRetriesRaw = Number(source.maxRetries);
  const backoffRaw = Number(source.backoffSeconds);
  return {
    maxRetries: Number.isFinite(maxRetriesRaw) ? Math.max(0, Math.floor(maxRetriesRaw)) : fallback.maxRetries,
    backoffSeconds: Number.isFinite(backoffRaw) ? Math.max(0, Math.floor(backoffRaw)) : fallback.backoffSeconds,
  };
}

function normalizeSlaConfig(value: unknown, fallback: WorkflowSlaConfig): WorkflowSlaConfig {
  const source = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const targetRaw = Number(source.targetMinutes);
  const riskRaw = Number(source.riskThresholdPercent);
  return {
    targetMinutes: Number.isFinite(targetRaw) ? Math.max(1, Math.floor(targetRaw)) : fallback.targetMinutes,
    riskThresholdPercent: Number.isFinite(riskRaw)
      ? Math.min(99, Math.max(1, Math.floor(riskRaw)))
      : fallback.riskThresholdPercent,
  };
}

function normalizeRuntimeConfig(
  value: unknown,
  fallback: WorkflowRuntimeConfig = DEFAULT_WORKFLOW_RUNTIME
): WorkflowRuntimeConfig {
  const source = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const maxTransitionsRaw = Number(source.maxTransitionsPerExecution);
  const maxVisitsRaw = Number(source.maxVisitsPerTask);
  const timeoutRaw = Number(source.defaultStepTimeoutSeconds);
  return {
    maxTransitionsPerExecution: Number.isFinite(maxTransitionsRaw)
      ? Math.max(20, Math.floor(maxTransitionsRaw))
      : fallback.maxTransitionsPerExecution,
    maxVisitsPerTask: Number.isFinite(maxVisitsRaw)
      ? Math.max(1, Math.floor(maxVisitsRaw))
      : fallback.maxVisitsPerTask,
    defaultStepTimeoutSeconds: Number.isFinite(timeoutRaw)
      ? Math.max(5, Math.floor(timeoutRaw))
      : fallback.defaultStepTimeoutSeconds,
    retryPolicy: normalizeRetryPolicy(source.retryPolicy, fallback.retryPolicy),
    sla: normalizeSlaConfig(source.sla, fallback.sla),
  };
}

function getTemplateRuntime(template: WorkflowTemplate | null | undefined, config: WorkflowConfig): WorkflowRuntimeConfig {
  const globalRuntime = normalizeRuntimeConfig(config.runtimeDefaults || DEFAULT_WORKFLOW_RUNTIME);
  if (!template?.runtime) return globalRuntime;
  return normalizeRuntimeConfig(template.runtime, globalRuntime);
}

function getExecutionRuntime(execution: WorkflowExecution, config: WorkflowConfig): WorkflowRuntimeConfig {
  const template =
    (config.templates || []).find((entry) => entry.id === execution.templateId) || null;
  return getTemplateRuntime(template, config);
}

function setBlockedReason(execution: WorkflowExecution, reason: WorkflowBlockedReason) {
  execution.blockedReason = reason;
}

function calculateExecutionSlaState(
  execution: WorkflowExecution,
  runtime: WorkflowRuntimeConfig
): WorkflowSlaState {
  const targetMinutes = Math.max(1, runtime.sla.targetMinutes);
  const riskThresholdPercent = Math.min(99, Math.max(1, runtime.sla.riskThresholdPercent));
  const startedAtMs = Date.parse(execution.startedAt || '');
  if (!Number.isFinite(startedAtMs)) return 'ok';
  const nowMs = Date.now();
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const targetMs = targetMinutes * MS_PER_MINUTE;
  const percent = (elapsedMs / targetMs) * 100;
  if (percent >= 100) return 'overdue';
  if (percent >= riskThresholdPercent) return 'risk';
  return 'ok';
}

function ensureExecutionHealth(execution: WorkflowExecution, runtime: WorkflowRuntimeConfig): WorkflowExecutionHealth {
  const previous = execution.health;
  const health: WorkflowExecutionHealth = {
    slaState: calculateExecutionSlaState(execution, runtime),
    slaLastNotifiedState:
      previous?.slaLastNotifiedState === 'ok' ||
      previous?.slaLastNotifiedState === 'risk' ||
      previous?.slaLastNotifiedState === 'overdue'
        ? previous.slaLastNotifiedState
        : null,
    transitionCount: Number.isFinite(Number(previous?.transitionCount))
      ? Math.max(0, Math.floor(Number(previous?.transitionCount)))
      : 0,
    loopGuardTrips: Number.isFinite(Number(previous?.loopGuardTrips))
      ? Math.max(0, Math.floor(Number(previous?.loopGuardTrips)))
      : 0,
    visitsByTask:
      previous?.visitsByTask && typeof previous.visitsByTask === 'object'
        ? Object.fromEntries(
            Object.entries(previous.visitsByTask)
              .map(([taskId, count]) => [taskId, Math.max(0, Math.floor(Number(count) || 0))])
              .filter(([taskId]) => String(taskId || '').trim().length > 0)
          )
        : {},
    slaTargetMinutes: runtime.sla.targetMinutes,
    slaRiskThresholdPercent: runtime.sla.riskThresholdPercent,
  };
  execution.health = health;
  return health;
}

function refreshExecutionHealth(execution: WorkflowExecution, runtime: WorkflowRuntimeConfig) {
  const health = ensureExecutionHealth(execution, runtime);
  const previousSlaState = health.slaState;
  health.slaState = calculateExecutionSlaState(execution, runtime);
  health.slaTargetMinutes = runtime.sla.targetMinutes;
  health.slaRiskThresholdPercent = runtime.sla.riskThresholdPercent;
  if (health.slaState === 'ok') {
    health.slaLastNotifiedState = null;
    return;
  }
  if (health.slaState === previousSlaState || health.slaLastNotifiedState === health.slaState) {
    return;
  }
  health.slaLastNotifiedState = health.slaState;
  const targetMinutes = Math.max(1, Number(health.slaTargetMinutes || runtime.sla.targetMinutes || 60));
  const severity = health.slaState === 'overdue' ? 'error' : 'warning';
  const title =
    health.slaState === 'overdue'
      ? `Workflow-SLA überschritten · Ticket ${execution.ticketId}`
      : `Workflow-SLA im Risiko · Ticket ${execution.ticketId}`;
  const message =
    health.slaState === 'overdue'
      ? `Workflow ${execution.id} hat das SLA-Ziel von ${targetMinutes} Minuten überschritten.`
      : `Workflow ${execution.id} nähert sich dem SLA-Limit (${targetMinutes} Minuten).`;
  void createAdminNotification({
    eventType: 'push_workflow_sla_overdue',
    severity,
    title,
    message,
    roleScope: 'staff',
    relatedTicketId: execution.ticketId,
    relatedExecutionId: execution.id,
    context: {
      workflowId: execution.id,
      workflowTitle: execution.title || '',
      templateId: execution.templateId || null,
      slaState: health.slaState,
      targetMinutes,
    },
  }).catch((error) => {
    console.warn('Workflow SLA notification failed:', error);
  });
}

function buildHistoryEntry(
  type: WorkflowHistoryEntry['type'],
  message: string,
  options: Partial<Omit<WorkflowHistoryEntry, 'id' | 'at' | 'type' | 'message'>> = {}
): WorkflowHistoryEntry {
  return {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    type,
    message,
    ...options,
  };
}

function appendWorkflowHistory(
  execution: WorkflowExecution,
  type: WorkflowHistoryEntry['type'],
  message: string,
  options: Partial<Omit<WorkflowHistoryEntry, 'id' | 'at' | 'type' | 'message'>> = {}
) {
  if (!Array.isArray(execution.history)) {
    execution.history = [];
  }
  execution.history.push(buildHistoryEntry(type, message, options));
  if (execution.history.length > WORKFLOW_EXECUTION_HISTORY_LIMIT) {
    execution.history = execution.history.slice(-WORKFLOW_EXECUTION_HISTORY_LIMIT);
  }
}

async function appendTicketComment(input: {
  ticketId: string;
  executionId?: string | null;
  taskId?: string | null;
  authorType?: 'staff' | 'ai' | 'system' | 'citizen';
  authorId?: string | null;
  authorName?: string | null;
  visibility?: 'internal' | 'public';
  commentType?:
    | 'note'
    | 'decision'
    | 'classification'
    | 'timeout'
    | 'data_request'
    | 'data_response'
    | 'situation_label';
  content: string;
  metadata?: Record<string, any> | null;
}) {
  const content = String(input.content || '').trim();
  if (!content) return;
  const db = getDatabase();
  const id = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await db.run(
    `INSERT INTO ticket_comments (
      id, ticket_id, execution_id, task_id, author_type, author_id, author_name,
      visibility, comment_type, content, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.ticketId,
      input.executionId || null,
      input.taskId || null,
      input.authorType || 'system',
      input.authorId || null,
      input.authorName || null,
      input.visibility || 'internal',
      input.commentType || 'note',
      content,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );
}

function setWorkflowStatus(
  execution: WorkflowExecution,
  status: WorkflowExecution['status'],
  message: string,
  options: Partial<Omit<WorkflowHistoryEntry, 'id' | 'at' | 'type' | 'message'>> = {}
) {
  if (execution.status === status) return;
  appendWorkflowHistory(execution, status === 'FAILED' ? 'WORKFLOW_FAILED' : 'WORKFLOW_STATUS', message, {
    fromStatus: execution.status,
    toStatus: status,
    ...options,
  });
  execution.status = status;
  if (status === 'RUNNING' || status === 'COMPLETED') {
    setBlockedReason(execution, 'none');
  } else if (status === 'FAILED') {
    setBlockedReason(execution, 'error');
  }
}

function setTaskStatus(
  execution: WorkflowExecution,
  task: WorkflowTask,
  status: WorkflowTask['status'],
  message: string,
  options: Partial<Omit<WorkflowHistoryEntry, 'id' | 'at' | 'type' | 'message'>> = {}
) {
  if (task.status === status) return;
  appendWorkflowHistory(execution, 'TASK_STATUS', message, {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    fromStatus: task.status,
    toStatus: status,
    ...options,
  });
  task.status = status;
}

async function notifyWorkflowAbortIfConfigured(
  execution: WorkflowExecution,
  context?: {
    task?: WorkflowTask;
    reason?: string;
  }
) {
  try {
    if (!execution.abortAdminNotificationSent) {
      const task = context?.task;
      const reason = context?.reason || execution.error || 'Workflow wurde abgebrochen';
      await createAdminNotification({
        eventType: 'workflow_aborted',
        severity: 'error',
        title: `Workflow-Abbruch bei Ticket ${execution.ticketId}`,
        message: reason,
        roleScope: 'staff',
        relatedTicketId: execution.ticketId,
        relatedExecutionId: execution.id,
        context: {
          workflowId: execution.id,
          workflowTitle: execution.title || '',
          templateId: execution.templateId || '',
          taskId: task?.id || null,
          taskTitle: task?.title || null,
          taskType: task?.type || null,
          status: execution.status,
        },
      });
      execution.abortAdminNotificationSent = true;
    }

    if (execution.abortNotificationSent) return;

    const { values: general } = await loadGeneralSettings();
    const isEnabled = !!general.workflowAbortNotificationEnabled;
    const recipientEmail = String(general.workflowAbortRecipientEmail || '').trim();
    if (!isEnabled || !recipientEmail) return;

    const recipientName = String(general.workflowAbortRecipientName || '').trim() || 'Admin';
    const task = context?.task;
    const reason = context?.reason || execution.error || 'Workflow wurde abgebrochen';

    const subject = `Workflow-Abbruch: Ticket ${execution.ticketId}`;
    const html = `
      <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto;">
        <h2 style="margin-bottom: 8px;">Workflow wurde abgebrochen</h2>
        <p>Hallo ${recipientName},</p>
        <p>eine Workflow-Instanz wurde mit Fehler beendet.</p>
        <div style="background:#f1f6fb;border:1px solid #c8d7e5;border-radius:8px;padding:12px 14px;margin:16px 0;">
          <p><strong>Workflow-ID:</strong> ${execution.id}</p>
          <p><strong>Workflow:</strong> ${execution.title || '–'}</p>
          <p><strong>Ticket-ID:</strong> ${execution.ticketId}</p>
          <p><strong>Kategorie:</strong> ${execution.category || '–'}</p>
          <p><strong>Status:</strong> ${execution.status}</p>
          <p><strong>Start:</strong> ${execution.startedAt || '–'}</p>
          <p><strong>Abbruch:</strong> ${execution.completedAt || new Date().toISOString()}</p>
          <p><strong>Fehler:</strong> ${reason}</p>
          ${task ? `<p><strong>Schritt:</strong> ${task.title} (${task.type})</p>` : ''}
        </div>
        <p>Diese Nachricht wurde automatisch durch behebes.AI erzeugt.</p>
      </div>
    `;

    const sent = await sendEmail({
      to: recipientEmail,
      subject,
      html,
    });

    if (sent) {
      execution.abortNotificationSent = true;
    }
  } catch (error) {
    console.warn('Workflow abort notification failed:', error);
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/g, '');
}

type WorkflowTemplateLibraryScope = 'platform' | 'tenant';

interface WorkflowTemplateLibrarySelection {
  scope: WorkflowTemplateLibraryScope;
  tenantId: string;
  includeInherited: boolean;
}

function parseWorkflowTemplateLibrarySelection(req: Request): WorkflowTemplateLibrarySelection {
  const contextMode = asTrimmedString(req.header('x-admin-context-mode')).toLowerCase();
  const contextTenantId = asTrimmedString(req.header('x-admin-context-tenant-id'));
  const rawScope = asTrimmedString(
    req.query?.scope ||
      req.body?.scope ||
      (contextMode === 'tenant' ? 'tenant' : contextMode === 'global' ? 'platform' : '')
  ).toLowerCase();
  const tenantId = asTrimmedString(
    req.query?.tenantId ||
      req.query?.tenant_id ||
      req.body?.tenantId ||
      req.body?.tenant_id ||
      contextTenantId
  );
  const includeInheritedRaw = asTrimmedString(req.query?.includeInherited || req.body?.includeInherited).toLowerCase();
  const includeInherited =
    includeInheritedRaw.length === 0 || !['0', 'false', 'off', 'no', 'nein'].includes(includeInheritedRaw);

  if (rawScope === 'tenant' && tenantId) {
    return { scope: 'tenant', tenantId, includeInherited };
  }
  return { scope: 'platform', tenantId: '', includeInherited: true };
}

async function ensureWorkflowTemplateLibraryAccess(
  req: Request,
  selection: WorkflowTemplateLibrarySelection
): Promise<void> {
  const userId = asTrimmedString((req as any).userId);
  const role = asTrimmedString((req as any).role);
  const access = await loadAdminAccessContext(userId, role);

  if (selection.scope === 'platform') {
    if (!access.isGlobalAdmin) {
      const error = new Error('Plattform-Workflowbibliothek darf nur von Plattform-Admins bearbeitet werden.');
      (error as any).status = 403;
      throw error;
    }
    return;
  }

  if (!selection.tenantId) {
    const error = new Error('tenantId ist für tenant scope erforderlich.');
    (error as any).status = 400;
    throw error;
  }

  if (access.isGlobalAdmin) return;
  if (!access.tenantIds.includes(selection.tenantId)) {
    const error = new Error('Kein Zugriff auf die Workflowbibliothek dieses Mandanten.');
    (error as any).status = 403;
    throw error;
  }
}

async function ensureWorkflowGlobalConfigAccess(req: Request): Promise<void> {
  const userId = asTrimmedString((req as any).userId);
  const role = asTrimmedString((req as any).role);
  const access = await loadAdminAccessContext(userId, role);
  if (!access.isGlobalAdmin) {
    const error = new Error('Globale Workflow-Konfiguration darf nur von Plattform-Admins bearbeitet werden.');
    (error as any).status = 403;
    throw error;
  }
}

async function loadKnowledge(): Promise<any> {
  let knowledge: any = {};
  try {
    const { loadKnowledgeBaseFromLibrary } = await import('../services/content-libraries.js');
    knowledge = await loadKnowledgeBaseFromLibrary({
      scope: 'platform',
      includeInherited: true,
    });
  } catch {
    knowledge = {};
  }

  try {
    const { values: redmine } = await loadRedmineSettings();
    knowledge.redmine = redmine;
  } catch {
    // Ignore settings merge errors; fallback to file
  }

  return knowledge;
}

function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return data[key] ?? '';
    }
    return match;
  });
}

async function loadTemplateFile(
  templateId: string,
  tenantId?: string
): Promise<{ subject: string; htmlContent: string; textContent?: string } | null> {
  try {
    const scope = tenantId ? 'tenant' : 'platform';
    const parsed = await getEmailTemplate(templateId, {
      scope,
      tenantId: tenantId || '',
      includeInherited: true,
    });
    if (!parsed?.subject || !parsed?.htmlContent) return null;
    const subject = String(parsed.subject);
    const htmlContent = ensureUnifiedEmailTemplateHtml(String(parsed.htmlContent), subject);
    return {
      subject,
      htmlContent,
      textContent:
        typeof parsed.textContent === 'string' && parsed.textContent.trim()
          ? String(parsed.textContent)
          : undefined,
    };
  } catch {
    return null;
  }
}

function htmlToPlainText(html: string): string {
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

function escapeWorkflowHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildWorkflowEmailShell(input: {
  title: string;
  lead: string;
  bodyHtml: string;
  actionHtml?: string;
  noteHtml?: string;
}): string {
  const actionHtml = input.actionHtml ? `<div style="margin:18px 0 16px 0;">${input.actionHtml}</div>` : '';
  const noteHtml = input.noteHtml
    ? `<div style="margin-top:16px;padding:10px 12px;border-radius:10px;background:#f1f6fb;border:1px solid #dbe3f0;color:#35556f;font-size:13px;line-height:1.5;">${input.noteHtml}</div>`
    : '';
  const body = `
<p style="margin:0 0 10px 0;font-size:14px;color:#1c1c1c;line-height:1.75;font-family:'Segoe UI',Arial,sans-serif;">${escapeWorkflowHtml(input.lead)}</p>
<div style="font-size:14px;color:#1c1c1c;line-height:1.75;font-family:'Segoe UI',Arial,sans-serif;">
${input.bodyHtml}
</div>
${actionHtml}
${noteHtml}
`;
  return buildUnifiedEmailLayout(String(input.title || '').trim(), body);
}

function buildDefaultExternalHtml(data: Record<string, string>): { subject: string; html: string; text: string } {
  const subject = `Neue Meldung: ${data.category || 'Buergerhinweis'}`;
  const html = buildWorkflowEmailShell({
    title: 'Neue Bürgermeldung zur Bearbeitung',
    lead: `Guten Tag ${data.recipientName || 'Team'},`,
    bodyHtml: `
      <p>über behebes.AI wurde eine neue Meldung für Ihre Zuständigkeit erfasst.</p>
      <div style="background:#f1f6fb; border:1px solid #dbe3f0; padding:14px; border-radius:10px; margin:16px 0;">
        <p><strong>Ticket-ID:</strong> ${data.ticketId}</p>
        <p><strong>Kategorie:</strong> ${data.category}</p>
        <p><strong>Ort:</strong> ${data.location}</p>
        <p><strong>Meldende Person:</strong> ${data.citizenName} (${data.citizenEmail})</p>
      </div>
      <p><strong>Beschreibung:</strong></p>
      <p>${data.description}</p>
    `,
  });
  const text = `Hallo ${data.recipientName || 'Team'},

eine neue Meldung ist eingegangen.
Ticket-ID: ${data.ticketId}
Kategorie: ${data.category}
Ort: ${data.location}
Meldende Person: ${data.citizenName} (${data.citizenEmail})

Beschreibung:
${data.description}
`;
  return { subject, html, text };
}

function buildDefaultConfirmationHtml(data: Record<string, string>): { subject: string; html: string; text: string } {
  const subject = 'Bitte bestaetigen Sie den Workflow-Schritt';
  const instructionHtml = data.approvalInstruction
    ? `<div style="background:#fff7e6;border:1px solid #f5d081;border-radius:10px;padding:12px 14px;margin:14px 0;">
        <p style="margin:0 0 6px 0;"><strong>Anweisung für diesen Schritt:</strong></p>
        <p style="margin:0;white-space:pre-wrap;">${data.approvalInstruction}</p>
      </div>`
    : '';
  const html = buildWorkflowEmailShell({
    title: 'Workflow-Freigabe erforderlich',
    lead: `Guten Tag ${data.recipientName || 'Team'},`,
    bodyHtml: `
      <p>bitte bestätigen Sie den folgenden Workflow-Schritt:</p>
      <div style="background:#f1f6fb; border:1px solid #dbe3f0; padding:14px; border-radius:10px; margin:16px 0;">
        <p><strong>Ticket-ID:</strong> ${data.ticketId}</p>
        <p><strong>Kategorie:</strong> ${data.category}</p>
        <p><strong>Ort:</strong> ${data.location}</p>
        <p><strong>Meldende Person:</strong> ${data.citizenName || '–'}${data.citizenEmail ? ` (${data.citizenEmail})` : ''}</p>
        ${data.workflowTitle ? `<p><strong>Workflow:</strong> ${data.workflowTitle}</p>` : ''}
        ${data.workflowStepTitle ? `<p><strong>Schritt:</strong> ${data.workflowStepTitle}</p>` : ''}
      </div>
      ${instructionHtml}
      <p>Dieser Link ist ${WORKFLOW_VALIDATION_EXPIRY_HOURS} Stunden gueltig.</p>
    `,
    actionHtml: `
      <a href="${data.decisionPageLink || data.approveLink}" style="display:inline-block;background:#003762;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px;font-weight:700;margin-right:8px;">Entscheidungsseite öffnen</a>
      <a href="${data.approveLink}" style="display:inline-block;background:#31932e;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px;font-weight:700;margin-right:8px;">Zustimmen</a>
      <a href="${data.rejectLink}" style="display:inline-block;background:#ec5840;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px;font-weight:700;">Ablehnen</a>
    `,
    noteHtml: `Direktlinks:<br/>Entscheidungsseite: <span style="word-break:break-all;">${data.decisionPageLink || data.approveLink}</span><br/>Zustimmen: <span style="word-break:break-all;">${data.approveLink}</span><br/>Ablehnen: <span style="word-break:break-all;">${data.rejectLink}</span>${data.statusLink ? `<br/>Ticketstatus: <span style="word-break:break-all;">${data.statusLink}</span>` : ''}`,
  });
  const text = `Hallo ${data.recipientName || 'Team'},

bitte bestaetigen Sie den folgenden Workflow-Schritt:
Ticket-ID: ${data.ticketId}
Kategorie: ${data.category}
Ort: ${data.location}
Meldende Person: ${data.citizenName || '–'}${data.citizenEmail ? ` (${data.citizenEmail})` : ''}
${data.workflowTitle ? `Workflow: ${data.workflowTitle}\n` : ''}${data.workflowStepTitle ? `Schritt: ${data.workflowStepTitle}\n` : ''}${data.approvalInstruction ? `\nAnweisung:\n${data.approvalInstruction}\n` : ''}

Entscheidungsseite: ${data.decisionPageLink || data.approveLink}
Zustimmen: ${data.approveLink}
Ablehnen: ${data.rejectLink}
${data.statusLink ? `Ticketstatus: ${data.statusLink}\n` : ''}Gueltig fuer ${WORKFLOW_VALIDATION_EXPIRY_HOURS} Stunden.`;
  return { subject, html, text };
}

function buildDefaultCitizenNotificationHtml(data: Record<string, string>): { subject: string; html: string; text: string } {
  const subject = `Information zu Ihrer Meldung (${data.ticketId})`;
  const html = buildWorkflowEmailShell({
    title: 'Information zu Ihrer Meldung',
    lead: `Guten Tag ${data.citizenName || 'Buergerin/Buerger'},`,
    bodyHtml: `
      <p>zu Ihrer Meldung <strong>${data.ticketId}</strong> liegt ein neues Update vor.</p>
      <div style="background:#f1f6fb; border:1px solid #dbe3f0; padding:14px; border-radius:10px; margin:16px 0;">
        <p><strong>Kategorie:</strong> ${data.category}</p>
        <p><strong>Ort:</strong> ${data.location}</p>
      </div>
      <p>${data.customMessage}</p>
    `,
    actionHtml: `
      <a href="${data.validationLink}" style="display:inline-block;background:#31932e;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;margin-right:8px;">Meldung bestaetigen</a>
      <a href="${data.statusLink}" style="display:inline-block;background:#003762;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Status ansehen</a>
    `,
    noteHtml: 'Sollte ein Link nicht funktionieren, koennen Sie die URL direkt im Browser oeffnen.',
  });
  const text = `Hallo ${data.citizenName || 'Buergerin/Buerger'},

zu Ihrer Meldung ${data.ticketId} liegt ein neues Update vor.
Kategorie: ${data.category}
Ort: ${data.location}

${data.customMessage}

Meldung bestaetigen: ${data.validationLink}
Status ansehen: ${data.statusLink}
`;
  return { subject, html, text };
}

function buildDefaultMayorNotifyHtml(data: Record<string, string>): { subject: string; html: string; text: string } {
  const subject = `Information zum Anliegen ${data.ticketId}`;
  const html = buildWorkflowEmailShell({
    title: 'Ortsbuergermeister informiert',
    lead: `Guten Tag ${data.recipientName || 'Ortsbuergermeister'},`,
    bodyHtml: `
      <p>Sie werden ueber ein neues Anliegen im Zustaendigkeitsbereich informiert.</p>
      <div style="background:#f1f6fb; border:1px solid #dbe3f0; padding:14px; border-radius:10px; margin:16px 0;">
        <p><strong>Ticket-ID:</strong> ${data.ticketId}</p>
        <p><strong>Kategorie:</strong> ${data.category}</p>
        <p><strong>Ort:</strong> ${data.location}</p>
        ${data.workflowTitle ? `<p><strong>Workflow:</strong> ${data.workflowTitle}</p>` : ''}
        ${data.workflowStepTitle ? `<p><strong>Schritt:</strong> ${data.workflowStepTitle}</p>` : ''}
        <p><strong>Meldende Person:</strong> ${data.citizenName || '–'}${data.citizenEmail ? ` (${data.citizenEmail})` : ''}</p>
      </div>
      ${data.approvalInstruction ? `<p style="white-space:pre-wrap;"><strong>Hinweis:</strong> ${data.approvalInstruction}</p>` : ''}
      <p><strong>Beschreibung:</strong><br/>${data.description}</p>
    `,
    actionHtml: data.statusLink
      ? `<a href="${data.statusLink}" style="display:inline-block;background:#003762;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Ticketstatus ansehen</a>`
      : '',
  });
  const text = `Guten Tag ${data.recipientName || 'Ortsbuergermeister'},

Sie werden ueber ein neues Anliegen informiert.
Ticket-ID: ${data.ticketId}
Kategorie: ${data.category}
Ort: ${data.location}
${data.workflowTitle ? `Workflow: ${data.workflowTitle}\n` : ''}${data.workflowStepTitle ? `Schritt: ${data.workflowStepTitle}\n` : ''}Meldende Person: ${data.citizenName || '–'}${data.citizenEmail ? ` (${data.citizenEmail})` : ''}
${data.approvalInstruction ? `\nHinweis:\n${data.approvalInstruction}\n` : ''}

Beschreibung:
${data.description}
${data.statusLink ? `\nTicketstatus: ${data.statusLink}` : ''}`;
  return { subject, html, text };
}

function buildDefaultMayorApprovalHtml(data: Record<string, string>): { subject: string; html: string; text: string } {
  const subject = `Bitte um Entscheidung zum Anliegen ${data.ticketId}`;
  const html = buildWorkflowEmailShell({
    title: 'Rueckmeldung Ortsbuergermeister erforderlich',
    lead: `Guten Tag ${data.recipientName || 'Ortsbuergermeister'},`,
    bodyHtml: `
      <p>fuer dieses Anliegen wird Ihre Entscheidung benoetigt.</p>
      <div style="background:#f1f6fb; border:1px solid #dbe3f0; padding:14px; border-radius:10px; margin:16px 0;">
        <p><strong>Ticket-ID:</strong> ${data.ticketId}</p>
        <p><strong>Kategorie:</strong> ${data.category}</p>
        <p><strong>Ort:</strong> ${data.location}</p>
        ${data.workflowTitle ? `<p><strong>Workflow:</strong> ${data.workflowTitle}</p>` : ''}
        ${data.workflowStepTitle ? `<p><strong>Schritt:</strong> ${data.workflowStepTitle}</p>` : ''}
        <p><strong>Meldende Person:</strong> ${data.citizenName || '–'}${data.citizenEmail ? ` (${data.citizenEmail})` : ''}</p>
      </div>
      ${data.approvalInstruction ? `<p style="white-space:pre-wrap;"><strong>Entscheidungsfrage:</strong> ${data.approvalInstruction}</p>` : ''}
      <p><strong>Beschreibung:</strong><br/>${data.description}</p>
    `,
    actionHtml: `
      <a href="${data.decisionPageLink || data.approveLink}" style="display:inline-block;background:#003762;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px;font-weight:700;margin-right:8px;">Entscheidungsseite</a>
      <a href="${data.approveLink}" style="display:inline-block;background:#31932e;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px;font-weight:700;margin-right:8px;">Weiterbearbeitung zulassen</a>
      <a href="${data.rejectLink}" style="display:inline-block;background:#ec5840;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px;font-weight:700;">Bearbeitung ablehnen</a>
      ${data.statusLink ? `<a href="${data.statusLink}" style="display:inline-block;background:#1f4f7f;color:#fff;padding:10px 16px;text-decoration:none;border-radius:8px;font-weight:700;margin-left:8px;">Ticketstatus</a>` : ''}
    `,
    noteHtml: `Direktlinks:<br/>Entscheidungsseite: <span style="word-break:break-all;">${data.decisionPageLink || data.approveLink}</span><br/>Zustimmen: <span style="word-break:break-all;">${data.approveLink}</span><br/>Ablehnen: <span style="word-break:break-all;">${data.rejectLink}</span>${data.statusLink ? `<br/>Ticketstatus: <span style="word-break:break-all;">${data.statusLink}</span>` : ''}`,
  });
  const text = `Guten Tag ${data.recipientName || 'Ortsbuergermeister'},

fuer dieses Anliegen wird Ihre Entscheidung benoetigt.
Ticket-ID: ${data.ticketId}
Kategorie: ${data.category}
Ort: ${data.location}
${data.workflowTitle ? `Workflow: ${data.workflowTitle}\n` : ''}${data.workflowStepTitle ? `Schritt: ${data.workflowStepTitle}\n` : ''}Meldende Person: ${data.citizenName || '–'}${data.citizenEmail ? ` (${data.citizenEmail})` : ''}
${data.approvalInstruction ? `\nEntscheidungsfrage:\n${data.approvalInstruction}\n` : ''}

Beschreibung:
${data.description}

Entscheidungsseite: ${data.decisionPageLink || data.approveLink}
Weiterbearbeitung zulassen: ${data.approveLink}
Bearbeitung ablehnen: ${data.rejectLink}
${data.statusLink ? `Ticketstatus: ${data.statusLink}\n` : ''}`;
  return { subject, html, text };
}

function buildDefaultDataRequestHtml(data: Record<string, string>): { subject: string; html: string; text: string } {
  const subject = `Bitte ergänzen Sie Angaben zu Ihrer Meldung (${data.ticketId})`;
  const html = buildWorkflowEmailShell({
    title: 'Rueckfragen zu Ihrer Meldung',
    lead: `Guten Tag ${data.citizenName || data.recipientName || 'Buergerin/Buerger'},`,
    bodyHtml: `
      <p>${data.introText || 'Fuer die weitere Bearbeitung benoetigen wir zusaetzliche Angaben zu Ihrer Meldung.'}</p>
      <div style="background:#f1f6fb; border:1px solid #dbe3f0; padding:14px; border-radius:10px; margin:16px 0;">
        <p><strong>Ticket-ID:</strong> ${data.ticketId}</p>
        <p><strong>Kategorie:</strong> ${data.category}</p>
        <p><strong>Ort:</strong> ${data.location}</p>
      </div>
      <p><strong>Benoetigte Angaben:</strong></p>
      <p style="white-space:pre-wrap;margin:0;">${data.requestFieldsSummary || 'Siehe Formular-Link'}</p>
    `,
    actionHtml: `
      <a href="${data.formLink}" style="display:inline-block;background:#003762;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;margin-right:8px;">Fragen beantworten</a>
      <a href="${data.statusLink}" style="display:inline-block;background:#31932e;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Ticketstatus oeffnen</a>
    `,
    noteHtml: data.expiresAt
      ? `Bitte beantworten Sie die Fragen bis spaetestens <strong>${data.expiresAt}</strong>.`
      : 'Bitte beantworten Sie die Fragen zeitnah.',
  });
  const text = `Hallo ${data.citizenName || data.recipientName || 'Buergerin/Buerger'},

${data.introText || 'Fuer die weitere Bearbeitung benoetigen wir zusaetzliche Angaben zu Ihrer Meldung.'}

Ticket-ID: ${data.ticketId}
Kategorie: ${data.category}
Ort: ${data.location}

Benoetigte Angaben:
${data.requestFieldsSummary || 'Siehe Formular-Link'}

Fragen beantworten: ${data.formLink}
Ticketstatus: ${data.statusLink}
${data.expiresAt ? `\nBitte beantworten Sie die Fragen bis spaetestens ${data.expiresAt}.` : ''}
`;
  return { subject, html, text };
}

function buildWorkflowEmailTemplateData(input: {
  ticket: any;
  description: string;
  address: string;
  locationText: string;
  coordinates: string;
  recipientName?: string;
  recipientEmail?: string;
  validationLink?: string;
  statusLink?: string;
  approveLink?: string;
  rejectLink?: string;
  decisionPageLink?: string;
  formLink?: string;
  requestFieldsSummary?: string;
  expiresAt?: string;
  introText?: string;
  customMessage?: string;
  approvalInstruction?: string;
  workflowTitle?: string;
  workflowStepTitle?: string;
}): Record<string, string> {
  const ticket = input.ticket || {};
  const now = new Date();
  const latitudeRaw =
    ticket.latitude !== null && ticket.latitude !== undefined && ticket.latitude !== ''
      ? Number(ticket.latitude)
      : null;
  const longitudeRaw =
    ticket.longitude !== null && ticket.longitude !== undefined && ticket.longitude !== ''
      ? Number(ticket.longitude)
      : null;
  const latitude = latitudeRaw !== null && Number.isFinite(latitudeRaw) ? latitudeRaw.toFixed(6) : '';
  const longitude = longitudeRaw !== null && Number.isFinite(longitudeRaw) ? longitudeRaw.toFixed(6) : '';
  const coordinates = input.coordinates || (latitude && longitude ? `${latitude}, ${longitude}` : '');

  return {
    ticketId: String(ticket.id || ''),
    submissionId: String(ticket.submission_id || ''),
    category: String(ticket.category || ''),
    description: String(input.description || ''),
    location: String(input.locationText || input.address || '–'),
    address: String(input.address || ''),
    postalCode: String(ticket.postal_code || ticket.submission_postal_code || ''),
    city: String(ticket.city || ticket.submission_city || ''),
    latitude,
    longitude,
    coordinates,
    priority: String(ticket.priority || ''),
    status: String(ticket.status || ''),
    citizenName: String(ticket.citizen_name || ''),
    citizenEmail: String(ticket.citizen_email || ''),
    recipientName: String(input.recipientName || input.recipientEmail || ''),
    assignedTo: String(ticket.assigned_to || ''),
    redmineIssueId: String(ticket.redmine_issue_id || ''),
    redmineProject: String(ticket.redmine_project || ''),
    validationLink: String(input.validationLink || ''),
    statusLink: String(input.statusLink || ''),
    approveLink: String(input.approveLink || ''),
    rejectLink: String(input.rejectLink || ''),
    decisionPageLink: String(input.decisionPageLink || ''),
    formLink: String(input.formLink || ''),
    requestFieldsSummary: String(input.requestFieldsSummary || ''),
    expiresAt: String(input.expiresAt || ''),
    introText: String(input.introText || ''),
    customMessage: String(input.customMessage || ''),
    approvalInstruction: String(input.approvalInstruction || ''),
    workflowTitle: String(input.workflowTitle || ''),
    workflowStepTitle: String(input.workflowStepTitle || ''),
    currentDate: now.toLocaleDateString('de-DE'),
    currentTime: now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
  };
}

function formatReporterDisplayName(citizenName?: string, citizenEmail?: string): string {
  const name = String(citizenName || '').trim();
  const email = String(citizenEmail || '').trim();
  if (name && email) return `${name} (${email})`;
  if (name) return name;
  if (email) return email;
  return '';
}

function appendReporterContextToEmailHtml(
  html: string,
  input: { citizenName?: string; citizenEmail?: string }
): string {
  const reporter = formatReporterDisplayName(input.citizenName, input.citizenEmail);
  if (!reporter) return html;

  const lower = html.toLowerCase();
  if (lower.includes('meldende person') || lower.includes('buerger:') || lower.includes('bürger:')) {
    return html;
  }

  return `${html}
<div style="margin-top:16px;padding:10px;border:1px solid #c8d7e5;border-radius:8px;background:#f1f6fb;">
  <p style="margin:0;"><strong>Meldende Person:</strong> ${reporter}</p>
</div>`;
}

function appendReporterContextToPlainText(
  text: string,
  input: { citizenName?: string; citizenEmail?: string }
): string {
  const reporter = formatReporterDisplayName(input.citizenName, input.citizenEmail);
  if (!reporter) return String(text || '');
  const normalized = String(text || '').trim();
  if (normalized.toLowerCase().includes('meldende person')) return normalized;
  if (!normalized) return `Meldende Person: ${reporter}`;
  return `${normalized}\n\nMeldende Person: ${reporter}`;
}

function appendReporterContextToRedmineDescription(
  description: string,
  input: { citizenName?: string; citizenEmail?: string }
): string {
  const reporter = formatReporterDisplayName(input.citizenName, input.citizenEmail);
  if (!reporter) return description;

  const normalized = String(description || '').trim();
  const lower = normalized.toLowerCase();
  if (lower.includes('meldende person')) return normalized;

  if (!normalized) {
    return `Meldende Person: ${reporter}`;
  }

  return `${normalized}\n\nMeldende Person: ${reporter}`;
}

function normalizeJsonString(jsonLike: string): string {
  let input = jsonLike
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, '\'')
    .replace(/,\s*([}\]])/g, '$1');

  let output = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (ch === '\r') {
        continue;
      }
      if (ch === '\n') {
        output += '\\n';
        continue;
      }
      if (ch === '"' && !escaped) {
        inString = false;
        output += ch;
        continue;
      }
      if (ch === '\\' && !escaped) {
        escaped = true;
        output += ch;
        continue;
      }
      escaped = false;
      output += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
    }
    output += ch;
  }

  return output;
}

function extractJsonPayload(raw: string): any {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const markerMatch = trimmed.match(/BEGIN_JSON\s*([\s\S]*?)\s*END_JSON/i);
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = markerMatch
    ? markerMatch[1].trim()
    : fencedMatch
    ? fencedMatch[1].trim()
    : trimmed;

  try {
    return JSON.parse(normalizeJsonString(candidate));
  } catch {
    // continue with object/array extraction
  }

  const braceMatch = candidate.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    return JSON.parse(normalizeJsonString(braceMatch[0]));
  }

  const arrayMatch = candidate.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return JSON.parse(normalizeJsonString(arrayMatch[0]));
  }

  throw new Error('Kein JSON-Objekt gefunden');
}

function parseJsonValue<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof raw === 'object') {
    return raw as T;
  }
  return fallback;
}

function truncateWorkflowStorageString(value: string, maxLength = WORKFLOW_STORAGE_MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) return value;
  const omitted = value.length - maxLength;
  return `${value.slice(0, maxLength)}...[truncated ${omitted} chars]`;
}

function sanitizeWorkflowStorageValue(value: unknown, depth = 0, seen?: WeakSet<object>): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateWorkflowStorageString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);

  if (depth >= WORKFLOW_STORAGE_MAX_DEPTH) {
    return '[truncated: max depth reached]';
  }

  if (Buffer.isBuffer(value)) {
    return `[binary:${value.length} bytes]`;
  }
  if (value instanceof Uint8Array) {
    return `[binary:${value.byteLength} bytes]`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    const limited = value
      .slice(0, WORKFLOW_STORAGE_MAX_ARRAY_LENGTH)
      .map((entry) => sanitizeWorkflowStorageValue(entry, depth + 1, seen));
    if (value.length > WORKFLOW_STORAGE_MAX_ARRAY_LENGTH) {
      limited.push(`[...+${value.length - WORKFLOW_STORAGE_MAX_ARRAY_LENGTH} items truncated]`);
    }
    return limited;
  }

  if (typeof value === 'object') {
    const objectRef = value as object;
    const tracker = seen || new WeakSet<object>();
    if (tracker.has(objectRef)) {
      return '[circular]';
    }
    tracker.add(objectRef);

    const source = value as Record<string, unknown>;
    const entries = Object.entries(source);
    const target: Record<string, unknown> = {};
    for (const [key, entryValue] of entries.slice(0, WORKFLOW_STORAGE_MAX_OBJECT_KEYS)) {
      target[key] = sanitizeWorkflowStorageValue(entryValue, depth + 1, tracker);
    }
    if (entries.length > WORKFLOW_STORAGE_MAX_OBJECT_KEYS) {
      target.__truncatedKeys = entries.length - WORKFLOW_STORAGE_MAX_OBJECT_KEYS;
    }
    return target;
  }

  return truncateWorkflowStorageString(String(value));
}

function sanitizeWorkflowExecutionForStorage(execution: WorkflowExecution): WorkflowExecution {
  if (!Array.isArray(execution.tasks)) {
    execution.tasks = [];
  }

  for (const task of execution.tasks) {
    if (!task || typeof task !== 'object') continue;
    if (task.executionData && typeof task.executionData === 'object' && !Array.isArray(task.executionData)) {
      task.executionData = sanitizeWorkflowStorageValue(task.executionData) as Record<string, any>;
    }
  }

  if (Array.isArray(execution.history)) {
    execution.history = execution.history
      .slice(-WORKFLOW_EXECUTION_HISTORY_LIMIT)
      .map((entry) => ({
        ...entry,
        message: truncateWorkflowStorageString(String(entry?.message || ''), 1200),
        metadata:
          entry?.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
            ? (sanitizeWorkflowStorageValue(entry.metadata) as Record<string, any>)
            : entry?.metadata,
      }));
  } else {
    execution.history = [];
  }

  ensureProcessVariableState(execution);
  execution.processVariables = sanitizeWorkflowStorageValue(execution.processVariables || {}) as Record<string, any>;
  execution.processVariableMeta = sanitizeWorkflowStorageValue(
    execution.processVariableMeta || {}
  ) as Record<string, any>;

  return execution;
}

function compactExecutionsForPersistence(executions: WorkflowExecution[]): WorkflowExecution[] {
  const cutoffMs = Date.now() - WORKFLOW_RETAIN_FINISHED_DAYS * 24 * 60 * 60 * 1000;
  const active: WorkflowExecution[] = [];
  const finished: Array<{ execution: WorkflowExecution; timestamp: number }> = [];

  for (const execution of executions || []) {
    if (!execution || typeof execution !== 'object') continue;
    const sanitized = sanitizeWorkflowExecutionForStorage(execution);
    const isFinished = sanitized.status === 'COMPLETED' || sanitized.status === 'FAILED';
    if (!isFinished) {
      active.push(sanitized);
      continue;
    }

    const completedMs = Date.parse(String(sanitized.completedAt || sanitized.startedAt || ''));
    if (Number.isFinite(completedMs) && completedMs < cutoffMs) {
      continue;
    }

    finished.push({
      execution: sanitized,
      timestamp: Number.isFinite(completedMs) ? completedMs : Date.now(),
    });
  }

  finished.sort((a, b) => b.timestamp - a.timestamp);
  return [...active, ...finished.slice(0, WORKFLOW_RETAIN_FINISHED_MAX).map((entry) => entry.execution)];
}

const scheduledTimerTasks = new Map<string, NodeJS.Timeout>();
const scheduledRedmineIssueTasks = new Map<string, NodeJS.Timeout>();
const workflowAutoRunState = new Map<string, { running: boolean; queued: boolean }>();

function resolveExecutionMode(template: WorkflowTemplate, config: WorkflowConfig): WorkflowExecutionMode {
  if (template.executionMode) return template.executionMode;
  return config.defaultExecutionMode || 'MANUAL';
}

function resolveStepAuto(
  template: WorkflowTemplate,
  step: WorkflowTemplate['steps'][number],
  config: WorkflowConfig
): boolean {
  if (step.type === 'JOIN') return true;
  if (typeof step.auto === 'boolean') return step.auto;
  const mode = resolveExecutionMode(template, config);
  if (mode === 'AUTO') return true;
  if (mode === 'HYBRID') return false;
  return false;
}

// Helper: Load workflows config
async function loadWorkflowConfig(): Promise<WorkflowConfig> {
  let config: WorkflowConfig | null = await getSetting<WorkflowConfig>('workflowConfig');
  let changed = false;
  let templatesDirty = false;

  if (!config) {
    config = {
      enabled: true,
      templates: [
        {
          id: 'standard-redmine-ticket',
          name: '🎫 Standard: Redmine Ticket',
          description: 'Erstellt automatisch ein Redmine-Ticket mit Kategorie-Vorgaben',
          steps: [
            {
              title: 'Redmine Ticket erstellen',
              type: 'REDMINE_TICKET',
              config: {
                projectMode: 'ai',
                trackerMode: 'ai',
                assigneeMode: 'ai',
                waitForTargetStatus: false,
                targetStatusIds: [],
                targetStatusCheckIntervalSeconds: 60,
                waitMaxSeconds: 0,
                aiPromptTemplate: '',
                aiPromptExtension: '',
                projectId: 'auto',
                tracker: 'auto',
                assigneeId: '',
                noAssignee: false,
                titleTemplate: '{category}: {address}',
                descriptionTemplate:
                  'Kategorie: {category}\nAdresse: {address}\nMeldende Person: {citizenName}\nMeldung: {submissionId}',
              },
              auto: false,
            },
          ],
          executionMode: 'MANUAL',
          autoTriggerOnEmailVerified: false,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'standard-intake-workflow',
          name: '📥 Standard: Intake + DOI',
          description:
            'Engine-first Intake mit E-Mail Double Opt-In und Kategorisierungsschritt',
          steps: [
            {
              title: 'E-Mail Double Opt-In',
              type: 'EMAIL_DOUBLE_OPT_IN',
              config: {
                recipientType: 'citizen',
                templateId: 'workflow-confirmation',
                sendLegacySubmissionConfirmation: true,
                timeoutHours: 48,
                nextTaskId: 'task-1',
                nextTaskIds: ['task-1'],
                rejectNextTaskId: 'task-2',
                rejectNextTaskIds: ['task-2'],
              },
              auto: true,
            },
            {
              title: 'Kategorisieren und Kategorie-Workflow starten',
              type: 'CATEGORIZATION',
              config: {
                startCategoryWorkflow: true,
                endCurrentWorkflow: true,
                fallbackTemplateId: 'standard-redmine-ticket',
                addAiComment: true,
                aiCommentVisibility: 'internal',
              },
              auto: true,
            },
            {
              title: 'Intake abgelehnt oder Timeout',
              type: 'END',
              config: {
                scope: 'workflow',
              },
              auto: true,
            },
          ],
          executionMode: 'AUTO',
          autoTriggerOnEmailVerified: false,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      defaultExecutionMode: 'MANUAL',
      autoTriggerOnEmailVerified: false,
      maxStepsPerWorkflow: 10,
      standardRedmineWorkflow: true,
      runtimeDefaults: { ...DEFAULT_WORKFLOW_RUNTIME },
    };
    changed = true;
    templatesDirty = true;
  }

  if (!Array.isArray(config.templates)) {
    config.templates = [];
    changed = true;
  }

  try {
    const dbTemplates = await listWorkflowTemplates({
      scope: 'platform',
      includeInherited: true,
    });
    if (Array.isArray(dbTemplates) && dbTemplates.length > 0) {
      config.templates = dbTemplates;
    } else if (config.templates.length > 0) {
      templatesDirty = true;
    }
  } catch (error) {
    console.warn('Could not load workflow templates from library table:', error);
  }

  if (!config.defaultExecutionMode) {
    config.defaultExecutionMode = 'MANUAL';
    changed = true;
  }
  if (typeof config.autoTriggerOnEmailVerified !== 'boolean') {
    config.autoTriggerOnEmailVerified = false;
    changed = true;
  }
  const normalizedRuntimeDefaults = normalizeRuntimeConfig(config.runtimeDefaults || DEFAULT_WORKFLOW_RUNTIME);
  if (
    JSON.stringify(normalizedRuntimeDefaults) !== JSON.stringify(config.runtimeDefaults || {})
  ) {
    config.runtimeDefaults = normalizedRuntimeDefaults;
    changed = true;
  }
  config.templates = (config.templates || []).map((template) => {
    let templateChanged = false;
    const executionMode = resolveExecutionMode(template, config);
    const autoTriggerOnEmailVerified = typeof template.autoTriggerOnEmailVerified === 'boolean'
      ? template.autoTriggerOnEmailVerified
      : false;
    const enabled = template.enabled !== false;
    const templateRuntime = normalizeRuntimeConfig(template.runtime || normalizedRuntimeDefaults, normalizedRuntimeDefaults);

    const steps = (template.steps || []).map((step) => {
      const resolvedAuto = resolveStepAuto(template, step, config);
      if (resolvedAuto !== step.auto) templateChanged = true;

      if (step.type === 'REDMINE_TICKET') {
        const existingConfig = step.config || {};
        const normalizedModes = normalizeRedmineModes(existingConfig);
        const defaultDescriptionTemplate =
          'Kategorie: {category}\nAdresse: {address}\nMeldende Person: {citizenName}\nMeldung: {submissionId}';
        const legacyDescriptionTemplate =
          'Kategorie: {category}\nAdresse: {address}\nMeldung: {submissionId}';
        const rawDescriptionTemplate =
          typeof existingConfig.descriptionTemplate === 'string'
            ? existingConfig.descriptionTemplate.trim()
            : '';
        const normalizedDescriptionTemplate =
          !rawDescriptionTemplate
            ? defaultDescriptionTemplate
            : rawDescriptionTemplate.includes('{citizenName}')
            ? rawDescriptionTemplate
            : rawDescriptionTemplate === legacyDescriptionTemplate
            ? defaultDescriptionTemplate
            : `${rawDescriptionTemplate}\nMeldende Person: {citizenName}`;
        const mergedConfig = {
          ...existingConfig,
          projectMode: normalizedModes.projectMode,
          trackerMode: normalizedModes.trackerMode,
          assigneeMode: normalizedModes.assigneeMode,
          noAssignee: normalizedModes.assigneeMode === 'none',
          titleTemplate:
            typeof existingConfig.titleTemplate === 'string' && existingConfig.titleTemplate.trim()
              ? existingConfig.titleTemplate
              : '{category}: {address}',
          descriptionTemplate: normalizedDescriptionTemplate,
          waitForTargetStatus: existingConfig.waitForTargetStatus === true,
          targetStatusIds: Array.isArray(existingConfig.targetStatusIds)
            ? existingConfig.targetStatusIds
                .map((value: any) => Number(value))
                .filter((value: number) => Number.isFinite(value))
            : [],
          targetStatusCheckIntervalSeconds:
            Number.isFinite(Number(existingConfig.targetStatusCheckIntervalSeconds))
              ? Math.max(15, Number(existingConfig.targetStatusCheckIntervalSeconds))
              : 60,
          waitMaxSeconds:
            Number.isFinite(Number(existingConfig.waitMaxSeconds))
              ? Math.max(0, Math.floor(Number(existingConfig.waitMaxSeconds)))
              : 0,
        };
        if (
          mergedConfig.projectMode !== existingConfig.projectMode ||
          mergedConfig.trackerMode !== existingConfig.trackerMode ||
          mergedConfig.assigneeMode !== existingConfig.assigneeMode ||
          mergedConfig.noAssignee !== existingConfig.noAssignee ||
          mergedConfig.titleTemplate !== existingConfig.titleTemplate ||
          mergedConfig.descriptionTemplate !== existingConfig.descriptionTemplate ||
          mergedConfig.waitForTargetStatus !== existingConfig.waitForTargetStatus ||
          JSON.stringify(mergedConfig.targetStatusIds) !== JSON.stringify(existingConfig.targetStatusIds) ||
          mergedConfig.targetStatusCheckIntervalSeconds !== existingConfig.targetStatusCheckIntervalSeconds ||
          mergedConfig.waitMaxSeconds !== existingConfig.waitMaxSeconds
        ) {
          templateChanged = true;
        }
        return {
          ...step,
          config: mergedConfig,
          auto: resolvedAuto,
        };
      }

      if (
        step.type === 'EMAIL_EXTERNAL' &&
        (!step.config || !step.config.templateId || step.config.templateId === 'external-notification')
      ) {
        templateChanged = true;
        return {
          ...step,
          config: {
            ...step.config,
            templateId: 'auto',
          },
          auto: resolvedAuto,
        };
      }
      return { ...step, auto: resolvedAuto };
    });

    if (template.executionMode !== executionMode) templateChanged = true;
    if (template.autoTriggerOnEmailVerified !== autoTriggerOnEmailVerified) templateChanged = true;
    if (template.enabled !== enabled) templateChanged = true;
    if (JSON.stringify(template.runtime || {}) !== JSON.stringify(templateRuntime)) templateChanged = true;

    if (templateChanged) {
      changed = true;
      templatesDirty = true;
    }
    return {
      ...template,
      steps,
      executionMode,
      autoTriggerOnEmailVerified,
      enabled,
      runtime: templateRuntime,
    };
  });

  const hasStandardTemplate = config.templates.some((template) => template.id === 'standard-redmine-ticket');
  if (!hasStandardTemplate && config.standardRedmineWorkflow !== false) {
    config.templates.push({
      id: 'standard-redmine-ticket',
      name: '🎫 Standard: Redmine Ticket',
      description: 'Erstellt automatisch ein Redmine-Ticket mit Kategorie-Vorgaben',
      steps: [
        {
          title: 'Redmine Ticket erstellen',
          type: 'REDMINE_TICKET',
          config: {
            projectMode: 'ai',
            trackerMode: 'ai',
            assigneeMode: 'ai',
            waitForTargetStatus: false,
            targetStatusIds: [],
            targetStatusCheckIntervalSeconds: 60,
            waitMaxSeconds: 0,
            aiPromptTemplate: '',
            aiPromptExtension: '',
            projectId: 'auto',
            tracker: 'auto',
            assigneeId: '',
            noAssignee: false,
            titleTemplate: '{category}: {address}',
            descriptionTemplate:
              'Kategorie: {category}\nAdresse: {address}\nMeldende Person: {citizenName}\nMeldung: {submissionId}',
          },
          auto: false,
        },
      ],
      executionMode: config.defaultExecutionMode || 'MANUAL',
      autoTriggerOnEmailVerified: false,
      enabled: true,
      runtime: normalizeRuntimeConfig(undefined, normalizedRuntimeDefaults),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    changed = true;
    templatesDirty = true;
  }

  const standardIntakeIndex = config.templates.findIndex(
    (template) => template.id === 'standard-intake-workflow'
  );
  if (standardIntakeIndex >= 0) {
    const current = config.templates[standardIntakeIndex];
    const hasCategorizationStep = Array.isArray(current.steps)
      ? current.steps.some((step) => step.type === 'CATEGORIZATION')
      : false;
    if (!hasCategorizationStep) {
      config.templates[standardIntakeIndex] = {
        ...current,
        description:
          'Engine-first Intake mit E-Mail Double Opt-In und Kategorisierungsschritt',
        steps: [
          {
            title: 'E-Mail Double Opt-In',
            type: 'EMAIL_DOUBLE_OPT_IN',
            config: {
              recipientType: 'citizen',
              templateId: 'workflow-confirmation',
              sendLegacySubmissionConfirmation: true,
              timeoutHours: 48,
              nextTaskId: 'task-1',
              nextTaskIds: ['task-1'],
              rejectNextTaskId: 'task-2',
              rejectNextTaskIds: ['task-2'],
            },
            auto: true,
          },
          {
            title: 'Kategorisieren und Kategorie-Workflow starten',
            type: 'CATEGORIZATION',
            config: {
              startCategoryWorkflow: true,
              endCurrentWorkflow: true,
              fallbackTemplateId: 'standard-redmine-ticket',
              addAiComment: true,
              aiCommentVisibility: 'internal',
            },
            auto: true,
          },
          {
            title: 'Intake abgelehnt oder Timeout',
            type: 'END',
            config: {
              scope: 'workflow',
            },
            auto: true,
          },
        ],
        executionMode: 'AUTO',
        updatedAt: new Date().toISOString(),
      };
      changed = true;
      templatesDirty = true;
    }
  }

  const hasStandardIntakeTemplate = config.templates.some(
    (template) => template.id === 'standard-intake-workflow'
  );
  if (!hasStandardIntakeTemplate) {
    config.templates.push({
      id: 'standard-intake-workflow',
      name: '📥 Standard: Intake + DOI',
      description:
        'Engine-first Intake mit E-Mail Double Opt-In und Kategorisierungsschritt',
      steps: [
        {
          title: 'E-Mail Double Opt-In',
          type: 'EMAIL_DOUBLE_OPT_IN',
          config: {
            recipientType: 'citizen',
            templateId: 'workflow-confirmation',
            sendLegacySubmissionConfirmation: true,
            timeoutHours: 48,
            nextTaskId: 'task-1',
            nextTaskIds: ['task-1'],
            rejectNextTaskId: 'task-2',
            rejectNextTaskIds: ['task-2'],
          },
          auto: true,
        },
        {
          title: 'Kategorisieren und Kategorie-Workflow starten',
          type: 'CATEGORIZATION',
          config: {
            startCategoryWorkflow: true,
            endCurrentWorkflow: true,
            fallbackTemplateId: 'standard-redmine-ticket',
            addAiComment: true,
            aiCommentVisibility: 'internal',
          },
          auto: true,
        },
        {
          title: 'Intake abgelehnt oder Timeout',
          type: 'END',
          config: {
            scope: 'workflow',
          },
          auto: true,
        },
      ],
      executionMode: 'AUTO',
      autoTriggerOnEmailVerified: false,
      enabled: true,
      runtime: normalizeRuntimeConfig(undefined, normalizedRuntimeDefaults),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    changed = true;
    templatesDirty = true;
  }

  if (templatesDirty) {
    try {
      const persistedTemplates = await replaceWorkflowTemplates(config.templates, {
        scope: 'platform',
      });
      if (Array.isArray(persistedTemplates) && persistedTemplates.length > 0) {
        config.templates = persistedTemplates;
      }
    } catch (error) {
      console.warn('Could not persist workflow templates to library table:', error);
    }
  }

  if (changed || templatesDirty) {
    await setSetting('workflowConfig', config);
  }

  return config;
}

// Helper: Load executions
function loadExecutions(): WorkflowExecution[] {
  try {
    const content = readFileSync(EXECUTIONS_FILE, 'utf-8');
    const executions = JSON.parse(content) as any[];
    return executions.map((execution): WorkflowExecution => {
      const rawTasks = Array.isArray(execution?.tasks) ? execution.tasks : [];
      const normalizedTasks: WorkflowTask[] = rawTasks.map((task: any) => {
        const status: WorkflowTask['status'] = WORKFLOW_TASK_STATUSES.has(task?.status)
          ? task.status
          : 'PENDING';
        const pathGroup = normalizePathGroup(task?.pathGroup);
        if (
          task.status === 'RUNNING' &&
          !task.executionData?.awaitingConfirmation &&
          !task.executionData?.awaitingUntil &&
          !task.executionData?.awaitingRedmineIssue &&
          !task.executionData?.awaitingSubWorkflow
        ) {
          return { ...task, status: 'PENDING', pathGroup } as WorkflowTask;
        }
        return { ...task, status, pathGroup } as WorkflowTask;
      });
      normalizedTasks.forEach((task) => {
        if (task.status === 'RUNNING' && task.executionData?.awaitingUntil) {
          scheduleTimerTask(execution.id, task.id, task.executionData.awaitingUntil);
        }
        if (task.status === 'RUNNING' && task.executionData?.awaitingRedmineIssue) {
          scheduleRedmineIssueTask(execution.id, task.id, task.executionData.awaitingRedmineIssue);
        }
      });
      const hasPending = normalizedTasks.some((t) => t.status === 'PENDING');
      const hasRunning = normalizedTasks.some((t) => t.status === 'RUNNING');
      const waiting = normalizedTasks.some(
        (t) =>
          t.status === 'RUNNING' &&
          (t.executionData?.awaitingConfirmation ||
            t.executionData?.awaitingUntil ||
            t.executionData?.awaitingRedmineIssue ||
            t.executionData?.awaitingSubWorkflow)
      );
      let status: WorkflowExecution['status'] = WORKFLOW_EXECUTION_STATUSES.has(execution?.status)
        ? execution.status
        : 'PAUSED';
      if (status !== 'COMPLETED' && status !== 'FAILED') {
        if (waiting) status = 'PAUSED';
        else if (hasPending) status = 'PAUSED';
        else if (hasRunning) status = 'RUNNING';
      }
      const persistedBlockedReason: WorkflowBlockedReason | null = WORKFLOW_BLOCKED_REASONS.has(
        execution?.blockedReason as WorkflowBlockedReason
      )
        ? (execution.blockedReason as WorkflowBlockedReason)
        : null;
      let blockedReason: WorkflowBlockedReason = 'none';
      if (status === 'FAILED') {
        blockedReason = 'error';
      } else if (status === 'PAUSED') {
        if (
          persistedBlockedReason === 'loop_guard' ||
          persistedBlockedReason === 'deadlock_or_orphan_path'
        ) {
          blockedReason = persistedBlockedReason;
        } else if (
          normalizedTasks.some(
            (task) => task.status === 'RUNNING' && !!task.executionData?.awaitingUntil
          )
        ) {
          blockedReason = 'waiting_timer';
        } else if (
          normalizedTasks.some(
            (task) => task.status === 'RUNNING' && !!task.executionData?.awaitingSubWorkflow
          )
        ) {
          blockedReason = 'waiting_external';
        } else if (
          normalizedTasks.some(
            (task) =>
              task.status === 'PENDING' &&
              !(
                task.auto === true ||
                (task.auto === undefined && String(execution?.executionMode || '').toUpperCase() === 'AUTO')
              )
          )
        ) {
          blockedReason = 'waiting_manual';
        } else if (waiting) {
          blockedReason = 'waiting_external';
        }
      }
      const history = Array.isArray(execution?.history)
        ? execution.history
            .filter((entry: any) => entry && typeof entry === 'object')
            .map((entry: any) => ({
              id:
                typeof entry.id === 'string' && entry.id.trim()
                  ? entry.id
                  : `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              at: entry.at || entry.timestamp || execution.startedAt || new Date().toISOString(),
              type: entry.type || 'INFO',
              message: entry.message || '',
              taskId: entry.taskId,
              taskTitle: entry.taskTitle,
              taskType: entry.taskType,
              fromStatus: entry.fromStatus,
              toStatus: entry.toStatus,
              metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : undefined,
            }))
        : [];
      const hydrated = {
        ...execution,
        tasks: normalizedTasks,
        status,
        currentTaskIndex: Number.isFinite(Number(execution?.currentTaskIndex))
          ? Number(execution.currentTaskIndex)
          : 0,
        activeTaskIds: [],
        blockedReason,
        health: execution?.health && typeof execution.health === 'object' ? execution.health : undefined,
        history,
        processVariables:
          execution?.processVariables &&
          typeof execution.processVariables === 'object' &&
          !Array.isArray(execution.processVariables)
            ? { ...execution.processVariables }
            : {},
        processVariableMeta:
          execution?.processVariableMeta &&
          typeof execution.processVariableMeta === 'object' &&
          !Array.isArray(execution.processVariableMeta)
            ? { ...execution.processVariableMeta }
            : {},
      } as WorkflowExecution;
      ensureProcessVariableState(hydrated);
      refreshExecutionHealth(hydrated, DEFAULT_WORKFLOW_RUNTIME);

      const fromFileActive = Array.isArray(execution?.activeTaskIds)
        ? execution.activeTaskIds
        : [];
      hydrated.activeTaskIds = normalizeTaskIdList(hydrated, fromFileActive);

      if (hydrated.status === 'COMPLETED' || hydrated.status === 'FAILED') {
        hydrated.activeTaskIds = [];
        syncCurrentTaskIndex(hydrated);
        if (hydrated.status === 'COMPLETED') {
          setBlockedReason(hydrated, 'none');
        } else if (hydrated.status === 'FAILED') {
          setBlockedReason(hydrated, 'error');
        }
        refreshExecutionHealth(hydrated, DEFAULT_WORKFLOW_RUNTIME);
        return hydrated;
      }

      if (hydrated.activeTaskIds.length === 0) {
        const runningIds = normalizedTasks
          .filter((task) => task.status === 'RUNNING')
          .map((task) => task.id);
        if (runningIds.length > 0) {
          hydrated.activeTaskIds = runningIds;
        } else {
          const pendingByIndex = normalizedTasks.find(
            (task) =>
              task.status === 'PENDING' &&
              task.order === Number(hydrated.currentTaskIndex || 0)
          );
          if (pendingByIndex) {
            hydrated.activeTaskIds = [pendingByIndex.id];
          }
        }
      }

      ensureInitialActiveTask(hydrated);
      refreshExecutionHealth(hydrated, DEFAULT_WORKFLOW_RUNTIME);
      return hydrated;
    });
  } catch {
    return [];
  }
}

// Helper: Save executions
function saveExecutions(executions: WorkflowExecution[]) {
  const compacted = compactExecutionsForPersistence(executions);
  if (Array.isArray(executions)) {
    executions.splice(0, executions.length, ...compacted);
  }

  const payload = JSON.stringify(compacted, null, 2);
  try {
    writeFileSync(EXECUTIONS_FILE_TMP, payload);
    renameSync(EXECUTIONS_FILE_TMP, EXECUTIONS_FILE);
    // Best-effort Backup, falls ein vorheriger Write unterbrochen wurde.
    writeFileSync(EXECUTIONS_FILE_BAK, payload);
    publishWorkflowUpdate({ reason: 'workflow.executions.updated' });
  } catch (error) {
    console.error('Failed to persist workflow executions:', error);
    try {
      writeFileSync(EXECUTIONS_FILE, payload);
      publishWorkflowUpdate({ reason: 'workflow.executions.updated' });
    } catch (fallbackError) {
      console.error('Fallback persistence for workflow executions failed:', fallbackError);
    }
  }
}

function hydrateExecutionRuntimeMetadata(execution: WorkflowExecution, config: WorkflowConfig) {
  const runtime = getExecutionRuntime(execution, config);
  refreshExecutionHealth(execution, runtime);
  if (execution.status === 'FAILED') {
    setBlockedReason(execution, 'error');
  } else if (execution.status === 'COMPLETED') {
    setBlockedReason(execution, 'none');
  } else if (!WORKFLOW_BLOCKED_REASONS.has(execution.blockedReason as WorkflowBlockedReason)) {
    setBlockedReason(execution, 'none');
  }
}

function isAutoTask(task: WorkflowTask, execution: WorkflowExecution): boolean {
  if (typeof task.auto === 'boolean') return task.auto;
  if (execution.executionMode === 'AUTO') return true;
  if (execution.executionMode === 'HYBRID') return false;
  return false;
}

function isAwaiting(task: WorkflowTask): boolean {
  return !!(
    task.executionData?.awaitingConfirmation ||
    task.executionData?.awaitingUntil ||
    task.executionData?.awaitingRedmineIssue ||
    task.executionData?.awaitingSubWorkflow
  );
}

function normalizeTaskIdList(execution: WorkflowExecution, input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const existingIds = new Set((execution.tasks || []).map((task) => task.id));
  const unique = new Set<string>();
  for (const value of input) {
    const id = String(value || '').trim();
    if (!id || !existingIds.has(id)) continue;
    unique.add(id);
  }
  return Array.from(unique);
}

function normalizeSingleTaskId(execution: WorkflowExecution, input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const id = input.trim();
  if (!id) return null;
  return execution.tasks.some((task) => task.id === id) ? id : null;
}

function cleanupActiveTaskIds(execution: WorkflowExecution): string[] {
  const active = normalizeTaskIdList(execution, execution.activeTaskIds || []);
  const filtered = active.filter((taskId) => {
    const task = execution.tasks.find((entry) => entry.id === taskId);
    if (!task) return false;
    if (task.status === 'PENDING') return true;
    if (task.status === 'RUNNING') return true;
    return false;
  });
  execution.activeTaskIds = filtered;
  return filtered;
}

function syncCurrentTaskIndex(execution: WorkflowExecution) {
  const active = cleanupActiveTaskIds(execution);
  if (active.length === 0) {
    execution.currentTaskIndex = execution.tasks.length;
    return;
  }
  const activeOrders = active
    .map((taskId) => execution.tasks.find((task) => task.id === taskId)?.order)
    .filter((order): order is number => typeof order === 'number');
  if (activeOrders.length === 0) {
    execution.currentTaskIndex = execution.tasks.length;
    return;
  }
  const minOrder = Math.min(...activeOrders);
  execution.currentTaskIndex = Math.max(0, minOrder);
}

function ensureInitialActiveTask(execution: WorkflowExecution) {
  const active = cleanupActiveTaskIds(execution);
  if (active.length > 0) {
    syncCurrentTaskIndex(execution);
    return;
  }
  const firstPending = [...execution.tasks]
    .filter((task) => task.status === 'PENDING')
    .sort((a, b) => a.order - b.order)[0];
  if (firstPending) {
    execution.activeTaskIds = [firstPending.id];
  } else {
    execution.activeTaskIds = [];
  }
  syncCurrentTaskIndex(execution);
}

function getActiveTasks(execution: WorkflowExecution): WorkflowTask[] {
  const active = cleanupActiveTaskIds(execution);
  return active
    .map((taskId) => execution.tasks.find((task) => task.id === taskId))
    .filter((task): task is WorkflowTask => !!task)
    .sort((a, b) => a.order - b.order);
}

function normalizePathGroup(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function ensureProcessVariableState(execution: WorkflowExecution) {
  if (!execution.processVariables || typeof execution.processVariables !== 'object' || Array.isArray(execution.processVariables)) {
    execution.processVariables = {};
  }
  if (
    !execution.processVariableMeta ||
    typeof execution.processVariableMeta !== 'object' ||
    Array.isArray(execution.processVariableMeta)
  ) {
    execution.processVariableMeta = {};
  }
}

function getProcessVariable(execution: WorkflowExecution, keyRaw: unknown): any {
  ensureProcessVariableState(execution);
  const key = String(keyRaw || '').trim();
  if (!key) return undefined;
  return execution.processVariables![key];
}

function setProcessVariable(
  execution: WorkflowExecution,
  options: {
    key: string;
    value: any;
    sourceStepId: string;
    sourceType: string;
    note?: string;
    setAlias?: string | null;
  }
): { key: string; alias?: string; aliasConflict?: boolean } {
  ensureProcessVariableState(execution);
  const key = String(options.key || '').trim();
  if (!key) {
    return { key: '' };
  }
  const nowIso = new Date().toISOString();
  const sanitizedValue = sanitizeWorkflowStorageValue(options.value);
  execution.processVariables![key] = sanitizedValue;
  execution.processVariableMeta![key] = {
    sourceStepId: options.sourceStepId,
    sourceType: options.sourceType,
    updatedAt: nowIso,
    note: options.note,
  };

  const aliasRaw = typeof options.setAlias === 'string' ? options.setAlias.trim() : '';
  if (!aliasRaw) return { key };
  if (Object.prototype.hasOwnProperty.call(execution.processVariables!, aliasRaw)) {
    return { key, alias: aliasRaw, aliasConflict: true };
  }
  execution.processVariables![aliasRaw] = sanitizedValue;
  execution.processVariableMeta![aliasRaw] = {
    sourceStepId: options.sourceStepId,
    sourceType: options.sourceType,
    updatedAt: nowIso,
    note: options.note ? `${options.note} (alias)` : 'alias',
  };
  return { key, alias: aliasRaw, aliasConflict: false };
}

function buildExecutionProcessVariablePromptBlock(execution: WorkflowExecution): string {
  ensureProcessVariableState(execution);
  const entries = Object.entries(execution.processVariables || {});
  if (entries.length === 0) {
    return 'Keine Prozessvariablen gesetzt.';
  }
  const compact: Record<string, any> = {};
  for (const [key, value] of entries) {
    compact[key] = value;
  }
  try {
    return JSON.stringify(compact, null, 2);
  } catch {
    return JSON.stringify(compact);
  }
}

function buildExecutionProcessVariableSummary(execution: WorkflowExecution): string {
  ensureProcessVariableState(execution);
  const entries = Object.entries(execution.processVariables || {});
  if (entries.length === 0) return 'Keine Prozessvariablen gesetzt.';
  const lines = entries
    .slice(0, 20)
    .map(([key, value]) => `- ${key}: ${asComparableString(value).slice(0, 180)}`);
  if (entries.length > lines.length) {
    lines.push(`- ... ${entries.length - lines.length} weitere Variablen`);
  }
  return lines.join('\n');
}

function getTaskPathGroup(task: WorkflowTask, executionData?: WorkflowExecutionData | null): string | null {
  return normalizePathGroup(executionData?.pathGroup ?? task.pathGroup);
}

function getDefaultNextTaskIds(
  execution: WorkflowExecution,
  task: WorkflowTask,
  pathGroup: string | null = null
): string[] {
  const sorted = [...execution.tasks].sort((a, b) => a.order - b.order);
  for (const candidate of sorted) {
    if (candidate.order <= task.order) continue;
    if (candidate.status !== 'PENDING') continue;

    if (candidate.type === 'JOIN') {
      return [candidate.id];
    }

    const candidateGroup = normalizePathGroup(candidate.pathGroup);
    if (pathGroup) {
      if (candidateGroup && candidateGroup !== pathGroup) continue;
      return [candidate.id];
    }

    if (candidateGroup) continue;
    return [candidate.id];
  }
  return [];
}

function getDefaultSplitNextTaskIds(execution: WorkflowExecution, task: WorkflowTask): string[] {
  return execution.tasks
    .filter((entry) => entry.order > task.order && entry.status === 'PENDING')
    .sort((a, b) => a.order - b.order)
    .slice(0, 2)
    .map((entry) => entry.id);
}

function getJoinRequiredArrivals(task: WorkflowTask): number {
  const direct = Number(task.config?.requiredArrivals ?? task.config?.expectedBranches ?? task.config?.joinCount);
  if (Number.isFinite(direct) && direct >= 1) {
    return Math.max(1, Math.floor(direct));
  }
  return 2;
}

function registerJoinArrival(
  joinTask: WorkflowTask,
  sourceTask: WorkflowTask,
  pathGroup: string | null
): { ready: boolean; joinState: NonNullable<WorkflowExecutionData['joinState']> } {
  const current = (joinTask.executionData?.joinState || {}) as Partial<NonNullable<WorkflowExecutionData['joinState']>>;
  const requiredArrivals = Number.isFinite(Number(current.requiredArrivals))
    ? Math.max(1, Math.floor(Number(current.requiredArrivals)))
    : getJoinRequiredArrivals(joinTask);
  const arrivedTaskIds = Array.isArray(current.arrivedTaskIds)
    ? current.arrivedTaskIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const arrivedPathGroups = Array.isArray(current.arrivedPathGroups)
    ? current.arrivedPathGroups.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  if (!arrivedTaskIds.includes(sourceTask.id)) {
    arrivedTaskIds.push(sourceTask.id);
  }

  const arrivalKey = pathGroup || `task:${sourceTask.id}`;
  if (!arrivedPathGroups.includes(arrivalKey)) {
    arrivedPathGroups.push(arrivalKey);
  }

  const joinState: NonNullable<WorkflowExecutionData['joinState']> = {
    requiredArrivals,
    arrivedTaskIds,
    arrivedPathGroups,
  };
  joinTask.executionData = {
    ...(joinTask.executionData || {}),
    joinState,
  };

  return {
    ready: arrivedPathGroups.length >= requiredArrivals,
    joinState,
  };
}

function resolveNextTaskIds(
  execution: WorkflowExecution,
  task: WorkflowTask,
  executionData?: WorkflowExecutionData | null,
  sourcePathGroup: string | null = null
): string[] {
  const fromExecutionData = normalizeTaskIdList(execution, executionData?.nextTaskIds);
  if (fromExecutionData.length > 0) return fromExecutionData;

  const fromConfigList = normalizeTaskIdList(execution, task.config?.nextTaskIds);
  if (fromConfigList.length > 0) return fromConfigList;

  const fromConfigSingle = normalizeSingleTaskId(execution, task.config?.nextTaskId);
  if (fromConfigSingle) return [fromConfigSingle];

  return getDefaultNextTaskIds(execution, task, sourcePathGroup);
}

function activateNextTasks(
  execution: WorkflowExecution,
  task: WorkflowTask,
  executionData?: WorkflowExecutionData | null
) {
  const active = new Set(cleanupActiveTaskIds(execution));
  active.delete(task.id);

  const sourcePathGroup = getTaskPathGroup(task, executionData);
  const pathGroupsByTaskId =
    executionData?.pathGroupsByTaskId && typeof executionData.pathGroupsByTaskId === 'object'
      ? executionData.pathGroupsByTaskId
      : {};
  const nextTaskIds = resolveNextTaskIds(execution, task, executionData, sourcePathGroup);
  for (const taskId of nextTaskIds) {
    const nextTask = execution.tasks.find((entry) => entry.id === taskId);
    if (!nextTask) continue;
    if (nextTask.status !== 'PENDING') continue;

    const mappedPathGroup = normalizePathGroup(pathGroupsByTaskId[taskId]);
    const nextPathGroup = mappedPathGroup || sourcePathGroup;

    if (nextTask.type === 'JOIN') {
      const { ready } = registerJoinArrival(nextTask, task, nextPathGroup);
      nextTask.pathGroup = null;
      if (!ready) continue;
      active.add(taskId);
      continue;
    }

    const existingPathGroup = normalizePathGroup(nextTask.pathGroup);
    if (nextPathGroup && existingPathGroup && existingPathGroup !== nextPathGroup) {
      appendWorkflowHistory(
        execution,
        'INFO',
        'Pfad-Konflikt erkannt: Zielknoten akzeptiert nur einen Pfad. Bitte Join-Knoten oder explizite Pfadverbindungen nutzen.',
        {
          taskId: nextTask.id,
          taskTitle: nextTask.title,
          taskType: nextTask.type,
          metadata: {
            sourceTaskId: task.id,
            sourceTaskTitle: task.title,
            existingPathGroup,
            incomingPathGroup: nextPathGroup,
          },
        }
      );
      continue;
    }
    if (!nextPathGroup && existingPathGroup) {
      continue;
    }
    if (nextPathGroup && !existingPathGroup) {
      nextTask.pathGroup = nextPathGroup;
    }

    active.add(taskId);
  }

  execution.activeTaskIds = Array.from(active);
  syncCurrentTaskIndex(execution);
}

function finalizeExecutionIfDone(
  execution: WorkflowExecution,
  options?: { allowOrphanSkip?: boolean }
): boolean {
  const allowOrphanSkip = options?.allowOrphanSkip !== false;
  const activeTasks = getActiveTasks(execution);
  const hasPendingOrRunning = activeTasks.some(
    (task) => task.status === 'PENDING' || task.status === 'RUNNING'
  );

  if (hasPendingOrRunning) return false;

  const hasRemainingPendingOrRunning = execution.tasks.some(
    (task) => task.status === 'PENDING' || task.status === 'RUNNING'
  );
  if (hasRemainingPendingOrRunning && !allowOrphanSkip) {
    return false;
  }

  if (allowOrphanSkip) {
    // Mark non-reachable pending tasks explicitly as skipped for transparent history.
    for (const task of execution.tasks) {
      if (task.status === 'PENDING') {
        setTaskStatus(
          execution,
          task,
          'SKIPPED',
          'Task wurde nicht erreicht und daher übersprungen.'
        );
      }
    }
  }

  setWorkflowStatus(execution, 'COMPLETED', 'Workflow abgeschlossen (alle aktiven Pfade beendet).');
  execution.completedAt = new Date().toISOString();
  appendWorkflowHistory(execution, 'WORKFLOW_COMPLETED', 'Workflow erfolgreich beendet.');
  execution.activeTaskIds = [];
  syncCurrentTaskIndex(execution);
  return true;
}

function completeWorkflowViaEndNode(execution: WorkflowExecution, task: WorkflowTask) {
  for (const candidate of execution.tasks) {
    if (candidate.id === task.id) continue;
    if (candidate.status === 'PENDING' || candidate.status === 'RUNNING') {
      clearScheduledTask(execution.id, candidate.id);
      setTaskStatus(
        execution,
        candidate,
        'SKIPPED',
        'Task wurde durch Workflow-Endknoten beendet.'
      );
    }
  }

  execution.activeTaskIds = [];
  syncCurrentTaskIndex(execution);
  setWorkflowStatus(execution, 'COMPLETED', 'Workflow wurde durch Endknoten beendet.');
  execution.completedAt = new Date().toISOString();
  appendWorkflowHistory(execution, 'WORKFLOW_COMPLETED', 'Workflow erfolgreich ueber Endknoten beendet.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: { endScope: 'workflow' },
  });
}

function clearScheduledTask(executionId: string, taskId: string) {
  const key = `${executionId}:${taskId}`;
  const timer = scheduledTimerTasks.get(key);
  if (timer) {
    clearTimeout(timer);
    scheduledTimerTasks.delete(key);
  }
  const redmineTimer = scheduledRedmineIssueTasks.get(key);
  if (redmineTimer) {
    clearInterval(redmineTimer);
    scheduledRedmineIssueTasks.delete(key);
  }
}

function scheduleTimerTask(executionId: string, taskId: string, awaitingUntil: string) {
  const key = `${executionId}:${taskId}`;
  if (scheduledTimerTasks.has(key)) return;
  const target = new Date(awaitingUntil).getTime();
  const delay = Math.max(target - Date.now(), 0);
  const handle = setTimeout(() => {
    scheduledTimerTasks.delete(key);
    void completeTimerTask(executionId, taskId).catch((error) => {
      console.error('Timer task completion failed:', error);
    });
  }, delay);
  scheduledTimerTasks.set(key, handle);
}

function scheduleRedmineIssueTask(
  executionId: string,
  taskId: string,
  awaitingRedmineIssue: {
    issueId: number;
    targetStatusIds: number[];
    checkIntervalSeconds?: number;
    startedAt?: string;
    waitMaxSeconds?: number;
  }
) {
  const key = `${executionId}:${taskId}`;
  if (scheduledRedmineIssueTasks.has(key)) return;
  const intervalSeconds = Math.max(
    Number(awaitingRedmineIssue?.checkIntervalSeconds || 60),
    15
  );

  const handle = setInterval(() => {
    void checkRedmineIssueTask(executionId, taskId).catch((error) => {
      console.error('Redmine wait task check failed:', error);
    });
  }, intervalSeconds * 1000);
  scheduledRedmineIssueTasks.set(key, handle);

  // Initial quick check, damit bereits erreichte Status direkt fortgesetzt werden.
  void checkRedmineIssueTask(executionId, taskId).catch((error) => {
    console.error('Initial Redmine wait task check failed:', error);
  });
}

async function checkRedmineIssueTask(executionId: string, taskId: string) {
  const executions = loadExecutions();
  const execution = executions.find((entry) => entry.id === executionId);
  if (!execution) {
    clearScheduledTask(executionId, taskId);
    return;
  }

  const task = execution.tasks.find((entry) => entry.id === taskId);
  if (!task || task.status !== 'RUNNING') {
    clearScheduledTask(executionId, taskId);
    return;
  }

  const awaitingIssue = task.executionData?.awaitingRedmineIssue;
  if (!awaitingIssue) {
    clearScheduledTask(executionId, taskId);
    return;
  }

  const issueId = Number(awaitingIssue.issueId);
  const targetStatusIds = Array.isArray(awaitingIssue.targetStatusIds)
    ? awaitingIssue.targetStatusIds.map((value) => Number(value)).filter(Number.isFinite)
    : [];
  if (!Number.isFinite(issueId) || targetStatusIds.length === 0) {
    return;
  }
  const waitMaxSeconds = Number(awaitingIssue.waitMaxSeconds || 0);
  const startedAtMs = Date.parse(String(awaitingIssue.startedAt || ''));
  if (
    Number.isFinite(waitMaxSeconds) &&
    waitMaxSeconds > 0 &&
    Number.isFinite(startedAtMs) &&
    Date.now() - startedAtMs > waitMaxSeconds * MS_PER_SECOND
  ) {
    clearScheduledTask(executionId, taskId);
    if (task.executionData) {
      delete task.executionData.awaitingRedmineIssue;
      task.executionData.redmineWaitTimeoutAt = new Date().toISOString();
      task.executionData.redmineWaitMaxSeconds = waitMaxSeconds;
    }
    const timeoutMessage = `Redmine-Zielstatus wurde nicht innerhalb von ${waitMaxSeconds}s erreicht.`;
    setTaskStatus(execution, task, 'FAILED', timeoutMessage);
    execution.error = timeoutMessage;
    appendWorkflowHistory(execution, 'TASK_WAITING', 'Redmine-Wartezeit überschritten.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: {
        issueId,
        waitMaxSeconds,
      },
    });
    saveExecutions(executions);
    await runAutoTasks(executions, execution);
    return;
  }

  const knowledge = await loadKnowledge();
  const baseUrl = normalizeBaseUrl(knowledge?.redmine?.baseUrl || '');
  const apiKey = knowledge?.redmine?.apiKey;
  if (!baseUrl || !apiKey) {
    return;
  }

  let currentStatusId: number | null = null;
  try {
    const response = await fetch(`${baseUrl}/issues/${issueId}.json`, {
      headers: { 'X-Redmine-API-Key': apiKey },
    });
    if (!response.ok) return;
    const payload = (await response.json()) as any;
    const statusId = payload?.issue?.status?.id;
    currentStatusId = Number.isFinite(statusId) ? Number(statusId) : null;
  } catch {
    return;
  }

  if (!currentStatusId || !targetStatusIds.includes(currentStatusId)) {
    return;
  }

  clearScheduledTask(executionId, taskId);
  if (task.executionData) {
    delete task.executionData.awaitingRedmineIssue;
  }
  appendWorkflowHistory(execution, 'TASK_WAITING', 'Redmine-Zielstatus erreicht. Workflow wird fortgesetzt.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: {
      issueId,
      targetStatusIds,
      reachedStatusId: currentStatusId,
    },
  });
  setTaskStatus(execution, task, 'COMPLETED', 'Task automatisch fortgesetzt (Redmine-Status erreicht).');
  activateNextTasks(execution, task, task.executionData || {});
  if (finalizeExecutionIfDone(execution)) {
    saveExecutions(executions);
    return;
  }
  setWorkflowStatus(execution, 'RUNNING', 'Workflow wird nach Redmine-Wartezustand fortgesetzt.');
  saveExecutions(executions);
  await runAutoTasks(executions, execution);
}

function resolveTimeoutRejectTaskIds(execution: WorkflowExecution, task: WorkflowTask): string[] {
  if (task.type === 'DATENNACHFORDERUNG' || isAiDataRequestTaskType(task.type)) {
    return resolveDataRequestRejectTaskIds(execution, task);
  }
  return resolveConfirmationRejectTaskIds(execution, task);
}

async function handleExternalWaitTimeout(
  executions: WorkflowExecution[],
  execution: WorkflowExecution,
  task: WorkflowTask
) {
  const nowIso = new Date().toISOString();
  const rejectNextTaskIds = resolveTimeoutRejectTaskIds(execution, task);
  const timeoutMessage = 'Wartezeit überschritten, Standardpfad Ablehnung aktiviert.';

  task.executionData = {
    ...(task.executionData || {}),
    awaitingConfirmation: false,
    callbackDecision: 'timeout_reject',
    callbackAt: nowIso,
    approvalResult: 'timeout_reject',
    approvalLabel: 'Zeitüberschreitung (Ablehnungspfad)',
    timeoutAt: nowIso,
    rejectNextTaskIds,
    ...(rejectNextTaskIds.length > 0 ? { nextTaskIds: rejectNextTaskIds } : {}),
  };

  appendWorkflowHistory(execution, 'TASK_DECISION', timeoutMessage, {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: {
      source: 'timeout',
      rejectNextTaskIds,
      timeoutAt: nowIso,
    },
  });

  await appendTicketComment({
    ticketId: execution.ticketId,
    executionId: execution.id,
    taskId: task.id,
    authorType: 'system',
    visibility: 'internal',
    commentType: 'timeout',
    content: `${task.title}: ${timeoutMessage}`,
    metadata: {
      taskType: task.type,
      rejectNextTaskIds,
      timeoutAt: nowIso,
    },
  });

  if (task.type === 'DATENNACHFORDERUNG' || isAiDataRequestTaskType(task.type)) {
    const requestId = String(task.executionData?.dataRequestId || '').trim();
    if (requestId) {
      try {
        const db = getDatabase();
        await db.run(
          `UPDATE workflow_data_requests
           SET status = 'timeout', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'pending'`,
          [requestId]
        );
      } catch (error) {
        console.warn('Failed to mark data request as timeout:', error);
      }
    }
  }

  setTaskStatus(execution, task, 'COMPLETED', 'Task automatisch abgelehnt (Timeout).');
  activateNextTasks(execution, task, task.executionData || {});
  if (finalizeExecutionIfDone(execution)) {
    saveExecutions(executions);
    return;
  }
  setWorkflowStatus(execution, 'RUNNING', 'Workflow nach Timeout-Entscheidung fortgesetzt.');
  saveExecutions(executions);
  await runAutoTasks(executions, execution);
}

async function completeTimerTask(executionId: string, taskId: string) {
  const executions = loadExecutions();
  const execution = executions.find((e) => e.id === executionId);
  if (!execution) return;
  const task = execution.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== 'RUNNING') return;
  clearScheduledTask(executionId, taskId);
  if (task.executionData?.awaitingUntil) {
    delete task.executionData.awaitingUntil;
  }
  if (task.executionData?.retryPending === true) {
    task.executionData = {
      ...(task.executionData || {}),
      retryPending: false,
    };
    if (task.executionData) {
      delete task.executionData.retryScheduledAt;
      delete task.executionData.retryBackoffSeconds;
    }
    setTaskStatus(execution, task, 'PENDING', 'Retry-Timer abgelaufen. Task wird erneut ausgeführt.');
    appendWorkflowHistory(execution, 'TASK_WAITING', 'Retry-Timer beendet, Task zurück auf PENDING.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: {
        attempt: task.executionData?.attempt,
      },
    });
    setWorkflowStatus(execution, 'RUNNING', 'Workflow wird nach Retry-Timer fortgesetzt.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
    });
    setBlockedReason(execution, 'none');
    saveExecutions(executions);
    await runAutoTasks(executions, execution);
    return;
  }
  if (
    task.type === 'EMAIL_CONFIRMATION' ||
    task.type === 'EMAIL_DOUBLE_OPT_IN' ||
    task.type === 'MAYOR_INVOLVEMENT' ||
    task.type === 'DATENNACHFORDERUNG' ||
    isAiDataRequestTaskType(task.type)
  ) {
    await handleExternalWaitTimeout(executions, execution, task);
    return;
  }
  try {
    const db = getDatabase();
    const current = await db.get(
      `SELECT t.status, t.validation_token, c.email as citizen_email, c.name as citizen_name
       FROM tickets t
       LEFT JOIN citizens c ON c.id = t.citizen_id
       WHERE t.id = ?`,
      [execution.ticketId]
    );
    const patchFromExecutionData =
      task.executionData?.ticketPatch &&
      typeof task.executionData.ticketPatch === 'object' &&
      !Array.isArray(task.executionData.ticketPatch)
        ? task.executionData.ticketPatch
        : null;
    const patchFromConfig = buildWaitTicketPatchFromConfig(task.config || {});
    const effectivePatch = patchFromExecutionData || patchFromConfig;
    if (effectivePatch) {
      const appliedPatch = await applyWorkflowTicketPatch(execution, effectivePatch);
      if (appliedPatch) {
        task.executionData = {
          ...(task.executionData || {}),
          ticketPatch: appliedPatch,
          statusAfter: typeof appliedPatch.status === 'string' ? appliedPatch.status : task.executionData?.statusAfter,
          timerCompletedAt: new Date().toISOString(),
        };
        appendWorkflowHistory(execution, 'TASK_DATA', 'Timer-Task hat Ticket-Felder aktualisiert.', {
          taskId: task.id,
          taskTitle: task.title,
          taskType: task.type,
          metadata: { ticketPatch: appliedPatch },
        });
      }

      const targetStatus =
        typeof appliedPatch?.status === 'string'
          ? appliedPatch.status
          : typeof effectivePatch.status === 'string'
          ? effectivePatch.status
          : '';
      const oldStatus = current?.status;
      if (
        oldStatus &&
        targetStatus &&
        oldStatus !== targetStatus &&
        typeof current?.citizen_email === 'string' &&
        current.citizen_email
      ) {
        await sendStatusChangeNotification(
          current.citizen_email,
          current.citizen_name || 'Buerger',
          execution.ticketId,
          oldStatus,
          targetStatus,
          'Automatische Statusaenderung durch Workflow',
          current.validation_token || undefined
        );
      }
    }

    setTaskStatus(execution, task, 'COMPLETED', 'Wartezeit beendet, Task automatisch abgeschlossen.');
    activateNextTasks(execution, task, task.executionData || {});
    if (finalizeExecutionIfDone(execution)) {
      saveExecutions(executions);
      return;
    }

    setWorkflowStatus(execution, 'RUNNING', 'Workflow wird nach Wartezeit fortgesetzt.');
    saveExecutions(executions);
    await runAutoTasks(executions, execution);
  } catch (error: any) {
    const message = error?.message || 'Timer-Task fehlgeschlagen.';
    task.executionData = {
      ...(task.executionData || {}),
      timerError: message,
    };
    setTaskStatus(execution, task, 'FAILED', 'Timer-Task ist fehlgeschlagen.');
    execution.error = message;
    saveExecutions(executions);
    await runAutoTasks(executions, execution);
  }
}

function resolveTaskRetryPolicy(task: WorkflowTask, runtime: WorkflowRuntimeConfig): WorkflowRetryPolicy {
  const fromConfig = task.config?.retryPolicy;
  const normalizedFromConfig = normalizeRetryPolicy(fromConfig, runtime.retryPolicy);
  const maxRetriesDirect = Number(task.config?.maxRetries);
  const backoffDirect = Number(task.config?.backoffSeconds);
  return {
    maxRetries: Number.isFinite(maxRetriesDirect)
      ? Math.max(0, Math.floor(maxRetriesDirect))
      : normalizedFromConfig.maxRetries,
    backoffSeconds: Number.isFinite(backoffDirect)
      ? Math.max(0, Math.floor(backoffDirect))
      : normalizedFromConfig.backoffSeconds,
  };
}

function resolveTaskTimeoutMs(task: WorkflowTask, runtime: WorkflowRuntimeConfig): number {
  const timeoutSeconds = Number(task.config?.timeoutSeconds);
  if (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0) {
    return Math.max(1, Math.floor(timeoutSeconds)) * MS_PER_SECOND;
  }
  const timeoutMsDirect = Number(task.config?.timeoutMs);
  if (Number.isFinite(timeoutMsDirect) && timeoutMsDirect > 0) {
    return Math.max(500, Math.floor(timeoutMsDirect));
  }
  return Math.max(5, runtime.defaultStepTimeoutSeconds) * MS_PER_SECOND;
}

function getTaskAttempt(task: WorkflowTask): number {
  const raw = Number(task.executionData?.attempt);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.max(1, Math.floor(raw));
  }
  return 1;
}

function isSideEffectTaskType(type: WorkflowStepType): boolean {
  return (
    type === 'REDMINE_TICKET' ||
    type === 'EMAIL' ||
    type === 'EMAIL_EXTERNAL' ||
    type === 'CATEGORIZATION' ||
    type === 'RESPONSIBILITY_CHECK' ||
    type === 'EMAIL_CONFIRMATION' ||
    type === 'EMAIL_DOUBLE_OPT_IN' ||
    type === 'MAYOR_INVOLVEMENT' ||
    type === 'DATENNACHFORDERUNG' ||
    isAiDataRequestTaskType(type) ||
    type === 'IMAGE_TO_TEXT_ANALYSIS' ||
    type === 'CITIZEN_NOTIFICATION' ||
    type === 'REST_API_CALL' ||
    type === 'SUB_WORKFLOW'
  );
}

function buildTaskIdempotencyKey(execution: WorkflowExecution, task: WorkflowTask, attempt: number): string {
  return `${execution.id}:${task.id}:${attempt}`;
}

function getCachedTaskExecutionData(
  task: WorkflowTask,
  idempotencyKey: string
): WorkflowExecutionData | null {
  const executionData = task.executionData || {};
  if (!executionData.idempotencyCompleted) return null;
  if (executionData.idempotencyKey !== idempotencyKey) return null;
  if (!executionData.idempotencyResult || typeof executionData.idempotencyResult !== 'object') return null;
  return executionData.idempotencyResult as WorkflowExecutionData;
}

async function withTaskTimeout<T>(
  promiseFactory: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  const safeTimeoutMs = Math.max(500, Math.floor(timeoutMs));
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, safeTimeoutMs);
  });
  try {
    return await Promise.race([promiseFactory(), timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function collectOrphanedTasks(execution: WorkflowExecution): WorkflowTask[] {
  const activeIds = new Set(cleanupActiveTaskIds(execution));
  return (execution.tasks || []).filter(
    (task) =>
      (task.status === 'PENDING' || task.status === 'RUNNING') && !activeIds.has(task.id)
  );
}

function scheduleTaskRetry(
  execution: WorkflowExecution,
  task: WorkflowTask,
  runtime: WorkflowRuntimeConfig,
  reason: string
): boolean {
  const retryPolicy = resolveTaskRetryPolicy(task, runtime);
  const currentAttempt = getTaskAttempt(task);
  if (retryPolicy.maxRetries <= 0 || currentAttempt > retryPolicy.maxRetries) {
    return false;
  }

  const retryAttempt = currentAttempt + 1;
  const backoffSeconds = Math.max(0, retryPolicy.backoffSeconds);
  const retryAt = new Date(Date.now() + backoffSeconds * MS_PER_SECOND).toISOString();
  task.executionData = {
    ...(task.executionData || {}),
    attempt: retryAttempt,
    retryPending: true,
    retryScheduledAt: retryAt,
    retryBackoffSeconds: backoffSeconds,
    awaitingUntil: retryAt,
    lastError: reason,
    idempotencyCompleted: false,
  };

  clearScheduledTask(execution.id, task.id);
  setTaskStatus(
    execution,
    task,
    'RUNNING',
    `Task fehlgeschlagen. Retry ${retryAttempt}/${retryPolicy.maxRetries + 1} geplant.`
  );
  appendWorkflowHistory(execution, 'TASK_WAITING', 'Task-Fehler: Retry wurde geplant.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: {
      reason,
      retryAttempt,
      maxRetries: retryPolicy.maxRetries,
      backoffSeconds,
      retryScheduledAt: retryAt,
    },
  });
  setWorkflowStatus(execution, 'PAUSED', 'Workflow pausiert und wartet auf Retry-Timer.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
  });
  setBlockedReason(execution, 'waiting_timer');
  scheduleTimerTask(execution.id, task.id, retryAt);
  return true;
}

async function failWorkflowByTask(
  executions: WorkflowExecution[],
  execution: WorkflowExecution,
  task: WorkflowTask,
  message: string
) {
  await createAdminNotification({
    eventType: 'workflow_task_failed',
    severity: 'error',
    title: `Workflow-Schrittfehler bei Ticket ${execution.ticketId}`,
    message: message || 'Task-Ausfuehrung fehlgeschlagen',
    roleScope: 'admin',
    relatedTicketId: execution.ticketId,
    relatedExecutionId: execution.id,
    context: {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      workflowId: execution.id,
      workflowTemplateId: execution.templateId || null,
    },
  });
  setTaskStatus(execution, task, 'FAILED', 'Task mit Fehler beendet.');
  setWorkflowStatus(execution, 'FAILED', 'Workflow wegen Task-Fehler beendet.');
  setBlockedReason(execution, 'error');
  execution.error = message || 'Task-Ausführung fehlgeschlagen';
  execution.completedAt = new Date().toISOString();
  appendWorkflowHistory(execution, 'WORKFLOW_FAILED', execution.error, {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
  });
  await notifyWorkflowAbortIfConfigured(execution, {
    task,
    reason: execution.error,
  });
  execution.activeTaskIds = [];
  syncCurrentTaskIndex(execution);
  saveExecutions(executions);
}

function isExecutionTerminal(execution: WorkflowExecution | null | undefined): boolean {
  return !!execution && (execution.status === 'COMPLETED' || execution.status === 'FAILED');
}

function getAwaitingSubWorkflowConfig(
  task: WorkflowTask
): { executionId: string; templateId: string; failOnChildFailure: boolean } | null {
  const executionData = task.executionData || {};
  const executionId = asTrimmedString(
    executionData?.awaitingSubWorkflow?.executionId || executionData?.subWorkflow?.executionId
  );
  if (!executionId) return null;
  const templateId = asTrimmedString(
    executionData?.awaitingSubWorkflow?.templateId || executionData?.subWorkflow?.templateId
  );
  const failOnChildFailure =
    executionData?.awaitingSubWorkflow?.failOnChildFailure !== false &&
    executionData?.subWorkflow?.failOnChildFailure !== false;
  return {
    executionId,
    templateId: templateId || '',
    failOnChildFailure,
  };
}

async function resolveCompletedSubWorkflowsForExecution(
  executions: WorkflowExecution[],
  execution: WorkflowExecution
): Promise<{ changed: boolean; changedTask: WorkflowTask | null; failed: boolean }> {
  let changed = false;
  let changedTask: WorkflowTask | null = null;

  for (const task of execution.tasks || []) {
    if (task.status !== 'RUNNING') continue;
    const waiting = getAwaitingSubWorkflowConfig(task);
    if (!waiting) continue;

    const childExecution = executions.find((entry) => entry.id === waiting.executionId);
    if (!childExecution) {
      const failureMessage = `Teilworkflow ${waiting.executionId} wurde nicht gefunden.`;
      await failWorkflowByTask(executions, execution, task, failureMessage);
      return { changed: true, changedTask: task, failed: true };
    }
    if (!isExecutionTerminal(childExecution)) {
      continue;
    }

    if (childExecution.status === 'FAILED' && waiting.failOnChildFailure) {
      const failureMessage = `Teilworkflow "${childExecution.title || childExecution.templateId || childExecution.id}" ist fehlgeschlagen.`;
      task.executionData = {
        ...(task.executionData || {}),
        subWorkflow: {
          ...(task.executionData?.subWorkflow || {}),
          status: 'failed',
          completedAt: childExecution.completedAt || new Date().toISOString(),
          executionId: childExecution.id,
          templateId: waiting.templateId || task.executionData?.subWorkflow?.templateId || '',
        },
      };
      await failWorkflowByTask(executions, execution, task, failureMessage);
      return { changed: true, changedTask: task, failed: true };
    }

    const completionMessage =
      childExecution.status === 'FAILED'
        ? 'Teilworkflow fehlgeschlagen, aber als erledigt markiert (failOnChildFailure=false).'
        : 'Teilworkflow abgeschlossen, Workflow wird fortgesetzt.';

    const existingExecutionData = task.executionData || {};
    const nextExecutionData: WorkflowExecutionData = {
      ...existingExecutionData,
      awaitingConfirmation: false,
      awaitingUntil: undefined,
      awaitingRedmineIssue: undefined,
      awaitingSubWorkflow: undefined,
      subWorkflow: {
        ...(existingExecutionData.subWorkflow || {}),
        executionId: childExecution.id,
        templateId:
          waiting.templateId ||
          asTrimmedString(childExecution.templateId) ||
          asTrimmedString(existingExecutionData.subWorkflow?.templateId),
        status: childExecution.status === 'FAILED' ? 'failed' : 'completed',
        completedAt: childExecution.completedAt || new Date().toISOString(),
        failOnChildFailure: waiting.failOnChildFailure,
      },
      subWorkflowStartExecution: undefined,
    };
    delete (nextExecutionData as any).awaitingSubWorkflow;
    delete (nextExecutionData as any).subWorkflowStartExecution;
    task.executionData = nextExecutionData;

    clearScheduledTask(execution.id, task.id);
    setTaskStatus(execution, task, 'COMPLETED', completionMessage);
    appendWorkflowHistory(execution, 'TASK_DECISION', 'Teilworkflow abgeschlossen und in Elternworkflow übernommen.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: {
        subWorkflowExecutionId: childExecution.id,
        subWorkflowTemplateId: childExecution.templateId || waiting.templateId || null,
        subWorkflowStatus: childExecution.status,
        failOnChildFailure: waiting.failOnChildFailure,
      },
    });
    activateNextTasks(execution, task, task.executionData || {});
    changed = true;
    changedTask = task;
  }

  return { changed, changedTask, failed: false };
}

async function triggerParentSubWorkflowResumes(
  executions: WorkflowExecution[],
  childExecutionId: string
): Promise<void> {
  const normalizedChildExecutionId = asTrimmedString(childExecutionId);
  if (!normalizedChildExecutionId) return;

  const parentCandidates = executions.filter((entry) => {
    if (!entry || entry.status === 'COMPLETED' || entry.status === 'FAILED') return false;
    return (entry.tasks || []).some((task) => {
      if (task.status !== 'RUNNING') return false;
      const waiting = getAwaitingSubWorkflowConfig(task);
      return waiting?.executionId === normalizedChildExecutionId;
    });
  });

  for (const parentExecution of parentCandidates) {
    await runAutoTasks(executions, parentExecution);
  }
}

async function runAutoTasks(executions: WorkflowExecution[], execution: WorkflowExecution): Promise<void> {
  if (!execution?.id) {
    return;
  }

  const running = workflowAutoRunState.get(execution.id);
  if (running?.running) {
    running.queued = true;
    workflowAutoRunState.set(execution.id, running);
    return;
  }

  workflowAutoRunState.set(execution.id, { running: true, queued: false });
  let currentExecutions = executions;
  let currentExecution = execution;

  try {
    while (true) {
      try {
        await runAutoTasksInternal(currentExecutions, currentExecution);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Workflow auto-run crashed unexpectedly:', {
          executionId: currentExecution.id,
          ticketId: currentExecution.ticketId,
          error: message,
        });
        try {
          setWorkflowStatus(
            currentExecution,
            'PAUSED',
            'Workflow wurde wegen internem Laufzeitfehler pausiert. Manuelle Prüfung erforderlich.'
          );
          setBlockedReason(currentExecution, 'error');
          currentExecution.error = truncateWorkflowStorageString(
            `Interner Workflow-Fehler: ${message}`,
            1200
          );
          appendWorkflowHistory(
            currentExecution,
            'WORKFLOW_FAILED',
            'Workflow-Laufzeitfehler abgefangen und Ausführung pausiert.',
            {
              metadata: {
                error: truncateWorkflowStorageString(message, 1200),
              },
            }
          );
          saveExecutions(currentExecutions);
        } catch (persistError) {
          console.error('Failed to persist workflow after auto-run crash:', persistError);
        }
      }

      const state = workflowAutoRunState.get(currentExecution.id);
      if (!state?.queued) {
        break;
      }

      state.queued = false;
      workflowAutoRunState.set(currentExecution.id, state);

      currentExecutions = loadExecutions();
      const refreshed = currentExecutions.find((entry) => entry.id === currentExecution.id);
      if (!refreshed || refreshed.status === 'COMPLETED' || refreshed.status === 'FAILED') {
        break;
      }
      currentExecution = refreshed;
    }

    const latestExecutions = loadExecutions();
    const latestExecution = latestExecutions.find((entry) => entry.id === execution.id) || null;
    if (isExecutionTerminal(latestExecution)) {
      await triggerParentSubWorkflowResumes(latestExecutions, execution.id);
    }
  } finally {
    workflowAutoRunState.delete(execution.id);
  }
}

async function runAutoTasksInternal(executions: WorkflowExecution[], execution: WorkflowExecution): Promise<void> {
  ensureInitialActiveTask(execution);
  const workflowConfig = await loadWorkflowConfig();
  const runtime = getExecutionRuntime(execution, workflowConfig);
  refreshExecutionHealth(execution, runtime);
  const maxAutoIterations = Math.max(
    80,
    execution.tasks.length * 25,
    runtime.maxTransitionsPerExecution + 5
  );
  let iteration = 0;

  while (iteration < maxAutoIterations) {
    iteration += 1;
    refreshExecutionHealth(execution, runtime);
    const activeTasks = getActiveTasks(execution);
    const failedTask = activeTasks.find((task) => task.status === 'FAILED');
    if (failedTask) {
      const failureMessage = execution.error || `Task fehlgeschlagen: ${failedTask.title}`;
      if (scheduleTaskRetry(execution, failedTask, runtime, failureMessage)) {
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        return;
      }
      await failWorkflowByTask(executions, execution, failedTask, failureMessage);
      return;
    }

    const subWorkflowResolution = await resolveCompletedSubWorkflowsForExecution(executions, execution);
    if (subWorkflowResolution.failed) {
      return;
    }
    if (subWorkflowResolution.changed) {
      if (finalizeExecutionIfDone(execution)) {
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        return;
      }
      setWorkflowStatus(execution, 'RUNNING', 'Workflow nach Teilworkflow fortgesetzt.', {
        taskId: subWorkflowResolution.changedTask?.id,
        taskTitle: subWorkflowResolution.changedTask?.title,
        taskType: subWorkflowResolution.changedTask?.type,
      });
      setBlockedReason(execution, 'none');
      refreshExecutionHealth(execution, runtime);
      saveExecutions(executions);
      continue;
    }

    const pendingTasks = activeTasks.filter((task) => task.status === 'PENDING');
    const pendingAutoTasks = pendingTasks.filter((task) => isAutoTask(task, execution));

    if (pendingAutoTasks.length === 0) {
      const waitingTasks = activeTasks.filter((task) => task.status === 'RUNNING' && isAwaiting(task));
      const pendingManualTasks = pendingTasks.filter((task) => !isAutoTask(task, execution));

      if (waitingTasks.length > 0) {
        for (const waitingTask of waitingTasks) {
          if (waitingTask.executionData?.awaitingUntil) {
            scheduleTimerTask(execution.id, waitingTask.id, waitingTask.executionData.awaitingUntil);
          }
          if (waitingTask.executionData?.awaitingRedmineIssue) {
            scheduleRedmineIssueTask(
              execution.id,
              waitingTask.id,
              waitingTask.executionData.awaitingRedmineIssue
            );
          }
        }

        const primaryWaitingTask = waitingTasks[0];
        setWorkflowStatus(
          execution,
          'PAUSED',
          pendingManualTasks.length > 0
            ? 'Workflow pausiert: wartende Ereignisse und manuelle Freigaben.'
            : 'Workflow pausiert und wartet auf externes Ereignis.',
          {
            taskId: primaryWaitingTask.id,
            taskTitle: primaryWaitingTask.title,
            taskType: primaryWaitingTask.type,
            metadata: {
              waitingTaskCount: waitingTasks.length,
              pendingManualTaskCount: pendingManualTasks.length,
            },
          }
        );
        const hasTimerWait = waitingTasks.some((task) => !!task.executionData?.awaitingUntil);
        const blockedReason: WorkflowBlockedReason = hasTimerWait
          ? 'waiting_timer'
          : pendingManualTasks.length > 0
          ? 'waiting_manual'
          : 'waiting_external';
        setBlockedReason(execution, blockedReason);
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        return;
      }

      const nextManualTask = pendingManualTasks[0] || null;
      if (nextManualTask) {
        setWorkflowStatus(execution, 'PAUSED', 'Workflow wartet auf manuelle Freigabe.', {
          taskId: nextManualTask.id,
          taskTitle: nextManualTask.title,
          taskType: nextManualTask.type,
        });
        setBlockedReason(execution, 'waiting_manual');
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        return;
      }

      if (finalizeExecutionIfDone(execution, { allowOrphanSkip: false })) {
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        return;
      }

      const orphanedTasks = collectOrphanedTasks(execution);
      if (orphanedTasks.length > 0) {
        const orphanTaskIds = orphanedTasks.map((task) => task.id);
        const deadlockMessage =
          'Workflow pausiert: Deadlock oder verwaiste Pfade erkannt.';
        setWorkflowStatus(execution, 'PAUSED', deadlockMessage, {
          metadata: {
            orphanTaskIds,
            orphanTaskTitles: orphanedTasks.map((task) => task.title),
          },
        });
        setBlockedReason(execution, 'deadlock_or_orphan_path');
        execution.error = deadlockMessage;
        appendWorkflowHistory(
          execution,
          'INFO',
          'Deadlock-Erkennung hat den Workflow pausiert.',
          {
            metadata: {
              orphanTaskIds,
              orphanTaskTitles: orphanedTasks.map((task) => task.title),
            },
          }
        );
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        return;
      }

      if (finalizeExecutionIfDone(execution)) {
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        return;
      }
      refreshExecutionHealth(execution, runtime);
      saveExecutions(executions);
      return;
    }

    const nextTask = pendingAutoTasks[0];
    const health = ensureExecutionHealth(execution, runtime);
    health.transitionCount += 1;
    health.visitsByTask[nextTask.id] = (health.visitsByTask[nextTask.id] || 0) + 1;
    const visitCount = health.visitsByTask[nextTask.id];

    if (
      health.transitionCount > runtime.maxTransitionsPerExecution ||
      visitCount > runtime.maxVisitsPerTask
    ) {
      health.loopGuardTrips += 1;
      const guardMessage =
        health.transitionCount > runtime.maxTransitionsPerExecution
          ? `Loop-Guard: maximale Transitionen (${runtime.maxTransitionsPerExecution}) überschritten.`
          : `Loop-Guard: Task "${nextTask.title}" wurde zu oft besucht (${visitCount}/${runtime.maxVisitsPerTask}).`;
      setWorkflowStatus(execution, 'PAUSED', guardMessage, {
        taskId: nextTask.id,
        taskTitle: nextTask.title,
        taskType: nextTask.type,
        metadata: {
          transitionCount: health.transitionCount,
          maxTransitionsPerExecution: runtime.maxTransitionsPerExecution,
          visitsForTask: visitCount,
          maxVisitsPerTask: runtime.maxVisitsPerTask,
        },
      });
      setBlockedReason(execution, 'loop_guard');
      execution.error = guardMessage;
      appendWorkflowHistory(execution, 'INFO', 'Loop-Guard hat den Workflow pausiert.', {
        taskId: nextTask.id,
        taskTitle: nextTask.title,
        taskType: nextTask.type,
        metadata: {
          transitionCount: health.transitionCount,
          visitsForTask: visitCount,
        },
      });
      refreshExecutionHealth(execution, runtime);
      saveExecutions(executions);
      return;
    }

    const attempt = getTaskAttempt(nextTask);
    const idempotencyKey = buildTaskIdempotencyKey(execution, nextTask, attempt);
    const isSideEffectTask = isSideEffectTaskType(nextTask.type);
    const cachedExecutionData = isSideEffectTask
      ? getCachedTaskExecutionData(nextTask, idempotencyKey)
      : null;
    const timeoutMs = resolveTaskTimeoutMs(nextTask, runtime);
    nextTask.executionData = {
      ...(nextTask.executionData || {}),
      attempt,
      idempotencyKey,
      retryPending: false,
    };
    if (nextTask.executionData) {
      delete nextTask.executionData.retryScheduledAt;
      delete nextTask.executionData.retryBackoffSeconds;
    }

    setTaskStatus(execution, nextTask, 'RUNNING', 'Task wurde automatisch gestartet.');
    setWorkflowStatus(execution, 'RUNNING', 'Workflow wird automatisch ausgeführt.', {
      taskId: nextTask.id,
      taskTitle: nextTask.title,
      taskType: nextTask.type,
    });
    setBlockedReason(execution, 'none');
    refreshExecutionHealth(execution, runtime);
    saveExecutions(executions);

    try {
      const executionData =
        cachedExecutionData ||
        (await withTaskTimeout(
          () => executeWorkflowTask(execution, nextTask),
          timeoutMs,
          `Task-Timeout: ${nextTask.title} hat das Zeitlimit (${Math.round(timeoutMs / 1000)}s) überschritten.`
        ));
      let subWorkflowStartExecution: WorkflowExecution | null = null;
      if (executionData) {
        const rawExecutionData =
          executionData && typeof executionData === 'object' ? { ...(executionData as WorkflowExecutionData) } : {};
        if (
          rawExecutionData.subWorkflowStartExecution &&
          typeof rawExecutionData.subWorkflowStartExecution === 'object'
        ) {
          subWorkflowStartExecution = rawExecutionData.subWorkflowStartExecution as WorkflowExecution;
          delete (rawExecutionData as any).subWorkflowStartExecution;
        }
        const sanitizedExecutionData = sanitizeWorkflowStorageValue(rawExecutionData) as WorkflowExecutionData;
        nextTask.executionData = {
          ...(nextTask.executionData || {}),
          ...sanitizedExecutionData,
          attempt,
          idempotencyKey,
          ...(isSideEffectTask
            ? {
                idempotencyCompleted: true,
                idempotencyResult: sanitizedExecutionData,
              }
            : {}),
        };
        appendWorkflowHistory(execution, 'TASK_DATA', 'Task-Ausführungsdaten aktualisiert.', {
          taskId: nextTask.id,
          taskTitle: nextTask.title,
          taskType: nextTask.type,
          metadata: sanitizedExecutionData,
        });
      }
      if (cachedExecutionData) {
        appendWorkflowHistory(
          execution,
          'INFO',
          'Task-Ergebnis aus Idempotenz-Cache wiederverwendet.',
          {
            taskId: nextTask.id,
            taskTitle: nextTask.title,
            taskType: nextTask.type,
            metadata: { idempotencyKey },
          }
        );
      }

      if (executionData?.changeWorkflow?.execution) {
        setTaskStatus(execution, nextTask, 'COMPLETED', 'Task abgeschlossen und Folge-Workflow gestartet.');
        setWorkflowStatus(execution, 'COMPLETED', 'Workflow endet mit Übergang auf neuen Workflow.');
        execution.completedAt = new Date().toISOString();
        execution.activeTaskIds = [];
        syncCurrentTaskIndex(execution);
        appendWorkflowHistory(execution, 'WORKFLOW_COMPLETED', 'Workflow erfolgreich abgeschlossen (Change-Workflow).', {
          metadata: {
            nextTemplateId: executionData.changeWorkflow.templateId,
            selectionMode: executionData.changeWorkflow.selectionMode,
            reasoning: executionData.changeWorkflow.reasoning,
          },
        });
        executions.push(executionData.changeWorkflow.execution);
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        await runAutoTasks(executions, executionData.changeWorkflow.execution);
        return;
      }

      if (executionData?.endScope === 'workflow') {
        clearScheduledTask(execution.id, nextTask.id);
        setTaskStatus(execution, nextTask, 'COMPLETED', 'Workflow-Endknoten ausgefuehrt.');
        completeWorkflowViaEndNode(execution, nextTask);
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        return;
      }

      if (
        executionData?.awaitingConfirmation ||
        executionData?.awaitingUntil ||
        executionData?.awaitingRedmineIssue ||
        executionData?.awaitingSubWorkflow
      ) {
        appendWorkflowHistory(execution, 'TASK_WAITING', 'Task wartet auf externes Ereignis.', {
          taskId: nextTask.id,
          taskTitle: nextTask.title,
          taskType: nextTask.type,
          metadata: executionData,
        });
        if (executionData.awaitingUntil) {
          scheduleTimerTask(execution.id, nextTask.id, executionData.awaitingUntil);
        }
        if (executionData.awaitingRedmineIssue) {
          scheduleRedmineIssueTask(execution.id, nextTask.id, executionData.awaitingRedmineIssue);
        }
        if (subWorkflowStartExecution) {
          if (!executions.some((entry) => entry.id === subWorkflowStartExecution?.id)) {
            executions.push(subWorkflowStartExecution);
          }
          refreshExecutionHealth(execution, runtime);
          saveExecutions(executions);
          await runAutoTasks(executions, subWorkflowStartExecution);
        }
        setBlockedReason(
          execution,
          executionData.awaitingUntil ? 'waiting_timer' : 'waiting_external'
        );
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        continue;
      }

      clearScheduledTask(execution.id, nextTask.id);
      setTaskStatus(
        execution,
        nextTask,
        'COMPLETED',
        executionData?.endScope === 'branch'
          ? 'Teilworkflow-Endknoten ausgefuehrt, aktiver Pfad beendet.'
          : 'Task erfolgreich abgeschlossen.'
      );
      if (nextTask.executionData) {
        delete nextTask.executionData.lastError;
        delete nextTask.executionData.retryScheduledAt;
        delete nextTask.executionData.retryBackoffSeconds;
      }
      activateNextTasks(execution, nextTask, executionData || {});
    } catch (taskError: any) {
      clearScheduledTask(execution.id, nextTask.id);
      if (taskError?.executionData && typeof taskError.executionData === 'object') {
        const sanitizedExecutionData = sanitizeWorkflowStorageValue(
          taskError.executionData
        ) as WorkflowExecutionData;
        nextTask.executionData = { ...(nextTask.executionData || {}), ...sanitizedExecutionData };
        appendWorkflowHistory(execution, 'TASK_DATA', 'Task-Ausführungsdaten bei Fehler gespeichert.', {
          taskId: nextTask.id,
          taskTitle: nextTask.title,
          taskType: nextTask.type,
          metadata: sanitizedExecutionData,
        });
      }
      const failureMessage = taskError?.message || 'Task-Ausführung fehlgeschlagen';
      execution.error = failureMessage;
      setTaskStatus(execution, nextTask, 'FAILED', 'Task mit Fehler beendet.');
      if (scheduleTaskRetry(execution, nextTask, runtime, failureMessage)) {
        refreshExecutionHealth(execution, runtime);
        saveExecutions(executions);
        return;
      }
      await failWorkflowByTask(executions, execution, nextTask, failureMessage);
      return;
    }
  }

  const health = ensureExecutionHealth(execution, runtime);
  health.loopGuardTrips += 1;
  const loopMessage = `Loop-Guard hat den Workflow pausiert (${maxAutoIterations} Iterationen ohne stabilen Zustand).`;
  setWorkflowStatus(execution, 'PAUSED', loopMessage, {
    metadata: {
      maxAutoIterations,
      transitionCount: health.transitionCount,
    },
  });
  setBlockedReason(execution, 'loop_guard');
  execution.error = loopMessage;
  appendWorkflowHistory(execution, 'INFO', loopMessage);
  refreshExecutionHealth(execution, runtime);
  saveExecutions(executions);
}

async function buildExecutionFromTemplate(
  ticketId: string,
  template: WorkflowTemplate,
  options?: { parentExecutionId?: string; parentTaskId?: string; parentTaskType?: WorkflowStepType }
): Promise<WorkflowExecution> {
  const db = getDatabase();
  const ticket = await db.get(
    `SELECT t.*, s.id as submission_id, s.address as submission_address, s.postal_code as submission_postal_code, s.city as submission_city
     FROM tickets t
     LEFT JOIN submissions s ON s.id = t.submission_id
     WHERE t.id = ?`,
    [ticketId]
  );

  if (!ticket) {
    throw new Error('Ticket nicht gefunden');
  }

  const addressText = ticket.address || ticket.submission_address || '';
  const locationText = [addressText, ticket.postal_code || ticket.submission_postal_code, ticket.city || ticket.submission_city]
    .filter(Boolean)
    .join(', ');
  const runtime = normalizeRuntimeConfig(template.runtime || DEFAULT_WORKFLOW_RUNTIME);

  const execution: WorkflowExecution = {
    id: `wf-${ticketId}-${Date.now()}`,
    submissionId: ticket.submission_id || '',
    ticketId,
    templateId: template.id,
    title: template.name,
    status: 'PAUSED',
    executionMode: template.executionMode || 'MANUAL',
    category: ticket.category || '',
    address: locationText || undefined,
    tasks: (template.steps || []).map((step, idx) => ({
      id: `task-${idx}`,
      title: step.title,
      description: step.title,
      type: step.type,
      status: 'PENDING',
      config: step.config || {},
      order: idx,
      auto:
        step.type === 'JOIN'
          ? true
          : typeof step.auto === 'boolean'
          ? step.auto
          : template.executionMode === 'AUTO',
      pathGroup: null,
    })),
    currentTaskIndex: 0,
    activeTaskIds: [],
    startedAt: new Date().toISOString(),
    blockedReason: 'none',
    health: {
      slaState: 'ok',
      slaLastNotifiedState: null,
      transitionCount: 0,
      loopGuardTrips: 0,
      visitsByTask: {},
      slaTargetMinutes: runtime.sla.targetMinutes,
      slaRiskThresholdPercent: runtime.sla.riskThresholdPercent,
    },
    processVariables: {},
    processVariableMeta: {},
    parentExecutionId: asTrimmedString(options?.parentExecutionId) || undefined,
    parentTaskId: asTrimmedString(options?.parentTaskId) || undefined,
    parentTaskType: options?.parentTaskType || undefined,
  };
  ensureInitialActiveTask(execution);
  refreshExecutionHealth(execution, runtime);
  appendWorkflowHistory(execution, 'WORKFLOW_CREATED', 'Workflow-Instanz erstellt.', {
    metadata: {
      templateId: template.id,
      templateName: template.name,
      executionMode: execution.executionMode,
      steps: execution.tasks.length,
      parentExecutionId: execution.parentExecutionId || null,
      parentTaskId: execution.parentTaskId || null,
      parentTaskType: execution.parentTaskType || null,
    },
  });
  return execution;
}

export async function attachWorkflowToTicket(
  ticketId: string,
  templateId: string,
  options: { skipIfExisting?: boolean } = {}
): Promise<WorkflowExecution | null> {
  const config = await loadWorkflowConfig();
  const normalizedTemplateId = String(templateId || '').trim();
  const normalizedLower = normalizedTemplateId.toLowerCase();
  const legacyRedmineIds = new Set(['redmine-ticket', 'redmine_ticket', 'redmine ticket']);
  const template =
    config.templates.find((t) => t.id === normalizedTemplateId) ||
    config.templates.find((t) => (t.name || '').toLowerCase() === normalizedLower) ||
    (legacyRedmineIds.has(normalizedLower)
      ? config.templates.find((t) => t.id === 'standard-redmine-ticket')
      : undefined);
  if (!template) {
    throw new Error('Workflow nicht gefunden');
  }

  const executions = loadExecutions();
  if (options.skipIfExisting) {
    const hasActive = executions.some(
      (e) => e.ticketId === ticketId && e.status !== 'COMPLETED' && e.status !== 'FAILED'
    );
    if (hasActive) {
      return null;
    }
  }

  const execution = await buildExecutionFromTemplate(ticketId, template);
  executions.push(execution);
  saveExecutions(executions);
  await runAutoTasks(executions, execution);
  return execution;
}

function findCategoryConfig(knowledge: any, categoryName?: string) {
  if (!knowledge?.categories || !categoryName) return null;
  const needle = categoryName.toLowerCase();
  return (
    knowledge.categories.find(
      (c: any) =>
        (c.name && c.name.toLowerCase() === needle) ||
        (c.id && c.id.toLowerCase() === needle)
    ) || null
  );
}

function listKnownCategoryNames(knowledge: any): string[] {
  if (!Array.isArray(knowledge?.categories)) return [];
  const values = knowledge.categories
    .map((entry: any) => String(entry?.name || '').trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function buildKnownCategoryPromptList(knowledge: any): string {
  if (!Array.isArray(knowledge?.categories) || knowledge.categories.length === 0) {
    return '- Keine Kategorien verfuegbar';
  }
  return knowledge.categories
    .map((entry: any) => {
      const id = String(entry?.id || '').trim();
      const name = String(entry?.name || '').trim();
      const description = String(entry?.description || '').trim();
      if (name && id && description) return `- ${name} (id: ${id}) - ${description}`;
      if (name && id) return `- ${name} (id: ${id})`;
      if (name) return `- ${name}`;
      if (id) return `- ${id}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function resolveKnownCategoryName(knowledge: any, candidate: unknown, fallback?: unknown): string {
  const candidateRaw = String(candidate || '').trim();
  const fallbackRaw = String(fallback || '').trim();

  const direct = findCategoryConfig(knowledge, candidateRaw);
  if (direct?.name) return String(direct.name).trim();

  const fallbackMatch = findCategoryConfig(knowledge, fallbackRaw);
  if (fallbackMatch?.name) return String(fallbackMatch.name).trim();

  const sonstiges =
    findCategoryConfig(knowledge, 'Sonstiges') ||
    findCategoryConfig(knowledge, 'sonstiges');
  if (sonstiges?.name) return String(sonstiges.name).trim();

  const known = listKnownCategoryNames(knowledge);
  if (known.length > 0) return known[0];
  return 'Sonstiges';
}

const LEGACY_REDMINE_CATEGORY_MAP: Record<string, { projectId: number; name: string }> = {
  '1': { projectId: 187, name: 'Sturmschäden im öffentlichen Bereich' },
  '2': { projectId: 187, name: 'Bürgersteig' },
  '3': { projectId: 187, name: 'Müll auf öff. Bereich' },
  '4': { projectId: 187, name: 'Müll auf priv. Bereich' },
  '5': { projectId: 187, name: 'Spielplatz' },
  '6': { projectId: 187, name: 'Friedhof' },
  '7': { projectId: 187, name: 'Straße-Ort / Wirtschaftsweg' },
  '8': { projectId: 192, name: 'Straße Kxx (Kreis-Str)' },
  '9': { projectId: 192, name: 'Straße Lxx (Landes-Str)' },
  '10': { projectId: 192, name: 'Straße Bxx (B270)' },
  '11': { projectId: 192, name: 'Straßenlaternen' },
  '12': { projectId: 187, name: 'Vandalismus' },
  '13': { projectId: 53, name: 'Wildwuchs / Unkraut / Reinigung öf.f Gelände' },
  '14': { projectId: 187, name: 'Wildwuchs / Unkraut / Reinigung priv. Gelände' },
  '15': { projectId: 187, name: 'Konflikte mit Nachbarn' },
  '16': { projectId: 81, name: 'Konflikte mit Verwaltung' },
  '17': { projectId: 192, name: 'Konflikt Lärmbelästigung' },
  '18': { projectId: 192, name: 'Verkehrsschilder/Ampel' },
  '19': { projectId: 192, name: 'Baustelle' },
  '20': { projectId: 192, name: 'Parken' },
  '21': { projectId: 53, name: 'Fernwärme' },
  '22': { projectId: 53, name: 'Gas' },
  '23': { projectId: 53, name: 'Kanal' },
  '24': { projectId: 53, name: 'Müllabfuhr' },
  '25': { projectId: 53, name: 'Strom' },
  '26': { projectId: 53, name: 'Wasserleitung' },
  '27': { projectId: 53, name: 'Amtsblatt nicht erhalten' },
  '28': { projectId: 53, name: 'Abflusshinderniss in Bachlauf' },
  '29': { projectId: 53, name: 'Ratten' },
  '30': { projectId: 192, name: 'Eichenprozessionsspinner (nur saisonal)' },
  '31': { projectId: 53, name: 'illegales Bauen' },
  '32': { projectId: 187, name: 'Sonstiges' },
};

const LEGACY_REDMINE_CATEGORY_NAMES = new Map<string, string>(
  Object.values(LEGACY_REDMINE_CATEGORY_MAP).map((entry) => [entry.name.toLowerCase(), entry.name])
);

function asTrimmedString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asCoordinateString(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  const raw = String(value).trim();
  return raw || String(numeric);
}

function splitStreetAndHouseNumber(address: string): { street: string; houseNumber: string } {
  const normalized = asTrimmedString(address);
  if (!normalized) return { street: '', houseNumber: '' };

  const commaMatch = normalized.match(/^(.+?),\s*(\d+[a-zA-Z0-9\-\/]*)$/);
  if (commaMatch) {
    return {
      street: asTrimmedString(commaMatch[1]),
      houseNumber: asTrimmedString(commaMatch[2]),
    };
  }

  const spaceMatch = normalized.match(/^(.+?)\s+(\d+[a-zA-Z0-9\-\/]*)$/);
  if (spaceMatch) {
    return {
      street: asTrimmedString(spaceMatch[1]),
      houseNumber: asTrimmedString(spaceMatch[2]),
    };
  }

  return { street: normalized, houseNumber: '' };
}

function splitCitizenName(input: string): { firstName: string; lastName: string } {
  const normalized = asTrimmedString(input);
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  if (normalized.includes(',')) {
    const [lastNameRaw, firstNameRaw] = normalized.split(',', 2);
    return {
      firstName: asTrimmedString(firstNameRaw),
      lastName: asTrimmedString(lastNameRaw),
    };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: '', lastName: parts[0] };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function resolveLegacyMappedCategoryName(categoryValue: unknown, knowledge: any): string {
  const raw = asTrimmedString(categoryValue);
  if (!raw) return '';

  const mappedById = LEGACY_REDMINE_CATEGORY_MAP[raw];
  if (mappedById) return mappedById.name;

  const direct = LEGACY_REDMINE_CATEGORY_NAMES.get(raw.toLowerCase());
  if (direct) return direct;

  if (Array.isArray(knowledge?.categories)) {
    const needle = raw.toLowerCase();
    const category = knowledge.categories.find(
      (entry: any) =>
        asTrimmedString(entry?.id).toLowerCase() === needle ||
        asTrimmedString(entry?.name).toLowerCase() === needle
    );
    if (category) {
      const mappedByCategoryId = LEGACY_REDMINE_CATEGORY_MAP[asTrimmedString(category.id)];
      if (mappedByCategoryId) return mappedByCategoryId.name;
      const categoryName = asTrimmedString(category.name);
      if (categoryName) return categoryName;
    }
  }

  return raw;
}

function buildLegacyRedmineDescriptionBlock(input: {
  mappedCategoryName: string;
  originalDescription: string;
  city: string;
  street: string;
  houseNumber: string;
  latitude: string;
  longitude: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}): string {
  const streetLabel =
    input.street && input.houseNumber
      ? `${input.street} ${input.houseNumber}`
      : input.street || 'Nicht angegeben';
  const gpsLabel =
    input.latitude && input.longitude
      ? `https://www.google.com/maps?q=${input.latitude},${input.longitude}`
      : 'Nicht angegeben';
  const contactName = asTrimmedString(`${input.firstName} ${input.lastName}`) || input.lastName || 'Nicht angegeben';

  return [
    'Buergermeldung',
    '',
    `Kategorie: ${input.mappedCategoryName || 'Nicht angegeben'}`,
    `Beschreibung: ${input.originalDescription || 'Nicht angegeben'}`,
    '',
    `Ort: ${input.city || 'Nicht angegeben'}`,
    `Straße: ${streetLabel || 'Nicht angegeben'}`,
    `GPS: ${gpsLabel}`,
    '',
    'Kontakt:',
    `Name: ${contactName}`,
    `Email: ${input.email || 'Nicht angegeben'}`,
    `Telefon: ${input.phone || 'Nicht angegeben'}`,
  ].join('\n');
}

function appendLegacyRedmineDescriptionBlock(description: string, block: string): string {
  const normalizedDescription = asTrimmedString(description);
  const normalizedBlock = asTrimmedString(block);
  if (!normalizedBlock) return normalizedDescription;
  if (!normalizedDescription) return normalizedBlock;

  const lower = normalizedDescription.toLowerCase();
  if (lower.includes('kontakt:') && lower.includes('gps:') && lower.includes('kategorie:')) {
    return normalizedDescription;
  }

  return `${normalizedDescription}\n\n${normalizedBlock}`;
}

function buildLegacyRedmineCustomFields(input: {
  city: string;
  latitude: string;
  longitude: string;
  email: string;
  phone: string;
  street: string;
  houseNumber: string;
  firstName: string;
  lastName: string;
  mappedCategoryName: string;
}): Array<{ id: number; value: string }> {
  return [
    { id: 37, value: input.city },
    { id: 38, value: input.latitude },
    { id: 39, value: input.longitude },
    { id: 40, value: '' },
    { id: 41, value: input.email },
    { id: 42, value: input.phone },
    { id: 43, value: input.street },
    { id: 44, value: input.houseNumber },
    { id: 45, value: input.firstName },
    { id: 46, value: input.lastName },
    { id: 47, value: '' },
    { id: 48, value: input.mappedCategoryName },
  ];
}

function normalizeRedmineModes(config: Record<string, any>) {
  const selectionMode = config?.selectionMode === 'manual' ? 'manual' : 'ai';
  const aiProjectTrackerEnabled = !!(config?.aiProjectTrackerEnabled ?? config?.aiProjectTracker);
  const projectModeRaw = String(config?.projectMode || '').toLowerCase();
  const trackerModeRaw = String(config?.trackerMode || '').toLowerCase();
  const assigneeModeRaw = String(config?.assigneeMode || '').toLowerCase();

  const projectMode: RedmineFieldMode =
    projectModeRaw === 'ai' || projectModeRaw === 'fixed'
      ? (projectModeRaw as RedmineFieldMode)
      : selectionMode === 'manual' && !aiProjectTrackerEnabled
      ? 'fixed'
      : 'ai';

  const trackerMode: RedmineFieldMode =
    trackerModeRaw === 'ai' || trackerModeRaw === 'fixed'
      ? (trackerModeRaw as RedmineFieldMode)
      : selectionMode === 'manual' && !aiProjectTrackerEnabled
      ? 'fixed'
      : 'ai';

  let assigneeMode: RedmineAssigneeMode;
  if (assigneeModeRaw === 'ai' || assigneeModeRaw === 'fixed' || assigneeModeRaw === 'none') {
    assigneeMode = assigneeModeRaw as RedmineAssigneeMode;
  } else if (config?.noAssignee) {
    assigneeMode = 'none';
  } else if (selectionMode === 'manual') {
    assigneeMode = 'fixed';
  } else {
    assigneeMode = 'ai';
  }

  return {
    selectionMode,
    aiProjectTrackerEnabled,
    projectMode,
    trackerMode,
    assigneeMode,
  };
}

function normalizeFixedValue(value: any): string | null {
  if (typeof value === 'string' && value.trim() && value !== 'auto') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function resolveProject(
  redmine: any,
  projectName?: string | null,
  projectHint?: string | null,
  options?: { allowFallback?: boolean }
) {
  const projects = Array.isArray(redmine?.projects) ? redmine.projects : [];
  const hasEnabled = projects.some((p: any) => p.enabled === true);
  const projectPool = hasEnabled ? projects.filter((p: any) => p.enabled === true) : projects;

  const matchById = (id: number) => projectPool.find((p: any) => p.id === id);
  const matchByNameOrIdentifier = (value: string) =>
    projectPool.find(
      (p: any) =>
        (p.name && p.name.toLowerCase() === value.toLowerCase()) ||
        (p.identifier && p.identifier.toLowerCase() === value.toLowerCase())
    );

  const candidates: Array<string | number | undefined | null> = [projectName, projectHint];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'number') {
      const match = matchById(candidate);
      if (match) return match;
    }
    if (typeof candidate === 'string') {
      const numeric = Number(candidate);
      if (!Number.isNaN(numeric)) {
        const match = matchById(numeric);
        if (match) return match;
      }
      const match = matchByNameOrIdentifier(candidate);
      if (match) return match;
      const cleaned = candidate.replace(/\s*\(.*\)\s*$/, '').trim();
      if (cleaned && cleaned !== candidate) {
        const cleanedMatch = matchByNameOrIdentifier(cleaned);
        if (cleanedMatch) return cleanedMatch;
      }
      const identifierMatch = candidate.match(/\(([^)]+)\)/);
      if (identifierMatch?.[1]) {
        const idMatch = matchByNameOrIdentifier(identifierMatch[1].trim());
        if (idMatch) return idMatch;
      }
    }
  }

  if (options?.allowFallback === false) return null;
  return projectPool[0] || projects[0] || null;
}

function resolveTracker(
  redmine: any,
  trackerName?: string | null,
  trackerHint?: string | null,
  options?: { allowFallback?: boolean }
) {
  const trackers = Array.isArray(redmine?.trackers) ? redmine.trackers : [];
  const hasEnabled = trackers.some((t: any) => t.enabled === true);
  const trackerPool = hasEnabled ? trackers.filter((t: any) => t.enabled === true) : trackers;

  const matchById = (id: number) => trackerPool.find((t: any) => t.id === id);
  const matchByName = (value: string) =>
    trackerPool.find((t: any) => t.name && t.name.toLowerCase() === value.toLowerCase());

  const candidates: Array<string | number | undefined | null> = [trackerName, trackerHint];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'number') {
      const match = matchById(candidate);
      if (match) return match;
    }
    if (typeof candidate === 'string') {
      const numeric = Number(candidate);
      if (!Number.isNaN(numeric)) {
        const match = matchById(numeric);
        if (match) return match;
      }
      const match = matchByName(candidate);
      if (match) return match;
    }
  }

  if (options?.allowFallback === false) return null;
  return trackerPool[0] || trackers[0] || null;
}

function normalizeAssigneeSearchValue(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenizeAssigneeSearchValue(value: unknown): string[] {
  return normalizeAssigneeSearchValue(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function resolveAssignee(
  redmine: any,
  assigneeName?: string | number | null,
  assigneeHint?: string | number | null
) {
  const users = Array.isArray(redmine?.assignableUsers) ? redmine.assignableUsers : [];
  const enabledUsers = users.filter((u: any) => u.enabled === true);
  const finalUsers = enabledUsers.length > 0 ? enabledUsers : users;
  const groups = (() => {
    const availableGroups = Array.isArray(redmine?.groups) ? redmine.groups : [];
    const explicitIds = Array.isArray(redmine?.assignableGroupIds)
      ? redmine.assignableGroupIds
          .map((id: any) => Number(id))
          .filter((id: number) => Number.isFinite(id))
      : [];
    if (explicitIds.length > 0) {
      const idSet = new Set(explicitIds);
      return availableGroups.filter((group: any) => idSet.has(Number(group?.id)));
    }
    const hasEnabledFlags = availableGroups.some((group: any) => typeof group?.enabled === 'boolean');
    if (hasEnabledFlags) {
      return availableGroups.filter((group: any) => group?.enabled === true);
    }
    return availableGroups;
  })();
  const candidates = [
    ...finalUsers.map((u: any) => ({
      id: u.id,
      name: `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.login || u.mail || `User ${u.id}`,
      login: u.login || '',
      email: u.mail || '',
      type: 'user',
      normalizedName: normalizeAssigneeSearchValue(
        `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.login || u.mail || `User ${u.id}`
      ),
      normalizedLogin: normalizeAssigneeSearchValue(u.login || ''),
      normalizedEmail: normalizeAssigneeSearchValue(u.mail || ''),
    })),
    ...groups.map((g: any) => ({
      id: g.id,
      name: g.name,
      login: '',
      email: '',
      type: 'group',
      normalizedName: normalizeAssigneeSearchValue(g.name),
      normalizedLogin: '',
      normalizedEmail: '',
    })),
  ];

  const matchById = (id: number, type?: 'user' | 'group') =>
    candidates.find((c) => c.id === id && (!type || c.type === type));
  const matchByName = (value: string) => {
    const lowered = normalizeAssigneeSearchValue(value);
    if (!lowered) return null;
    return candidates.find(
      (c) =>
        c.normalizedName === lowered ||
        c.normalizedLogin === lowered ||
        c.normalizedEmail === lowered
    );
  };

  const candidatesValues: Array<string | number | undefined | null> = [assigneeName, assigneeHint];
  for (const candidate of candidatesValues) {
    if (!candidate) continue;
    if (typeof candidate === 'number') {
      const match = matchById(candidate);
      if (match) return match;
    }
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      const scoped = parseScopedAssigneeCandidate(trimmed);
      if (scoped) {
        const scopedMatch = matchById(scoped.id, scoped.type);
        if (scopedMatch) return scopedMatch;
        continue;
      }
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) {
        const match = matchById(numeric);
        if (match) return match;
      }
      const exact = matchByName(trimmed);
      if (exact) return exact;
      const lowered = normalizeAssigneeSearchValue(trimmed);
      const tokens = tokenizeAssigneeSearchValue(trimmed);
      if (tokens.length > 0) {
        const tokenMatch = candidates.find((candidateOption) =>
          tokens.every(
            (token) =>
              candidateOption.normalizedName.includes(token) ||
              candidateOption.normalizedLogin.includes(token) ||
              candidateOption.normalizedEmail.includes(token)
          )
        );
        if (tokenMatch) return tokenMatch;
      }
      const partial = candidates.find(
        (c) =>
          c.normalizedName.includes(lowered) ||
          (c.normalizedLogin && c.normalizedLogin.includes(lowered)) ||
          (c.normalizedEmail && c.normalizedEmail.includes(lowered))
      );
      if (partial) return partial;
    }
  }

  return null;
}

function parseScopedAssigneeCandidate(value: unknown): { type: 'user' | 'group'; id: number } | null {
  if (typeof value !== 'string') return null;
  const scopedMatch = value.trim().match(/^(user|group)\s*[-_: ]\s*(\d+)$/i);
  if (!scopedMatch) return null;
  const type = scopedMatch[1].toLowerCase() === 'group' ? 'group' : 'user';
  const id = Number(scopedMatch[2]);
  if (!Number.isFinite(id)) return null;
  return { type, id };
}

function normalizeAiAssigneeReference(
  assigneeRefRaw: unknown,
  assigneeTypeRaw?: unknown,
  assigneeIdRaw?: unknown
): string {
  if (typeof assigneeRefRaw === 'string') {
    const scoped = parseScopedAssigneeCandidate(assigneeRefRaw);
    if (scoped) return `${scoped.type}:${scoped.id}`;
  }

  const assigneeType =
    String(assigneeTypeRaw || '')
      .trim()
      .toLowerCase() === 'group'
      ? 'group'
      : String(assigneeTypeRaw || '')
          .trim()
          .toLowerCase() === 'user'
      ? 'user'
      : '';

  const numericAssigneeId =
    typeof assigneeIdRaw === 'number'
      ? assigneeIdRaw
      : typeof assigneeIdRaw === 'string' && assigneeIdRaw.trim() !== ''
      ? Number(assigneeIdRaw)
      : null;

  if (!assigneeType || !Number.isFinite(numericAssigneeId)) return '';
  return `${assigneeType}:${Number(numericAssigneeId)}`;
}

async function fetchRedminePagedCollectionByKey(
  baseUrl: string,
  apiKey: string,
  path: string,
  collectionKey: string,
  pageSize = 100,
  maxItems = 1200
): Promise<any[]> {
  const items: any[] = [];
  let offset = 0;

  while (items.length < maxItems) {
    const separator = path.includes('?') ? '&' : '?';
    const pagePath = `${path}${separator}limit=${pageSize}&offset=${offset}`;
    const response = await fetch(`${baseUrl}${pagePath}`, {
      headers: { 'X-Redmine-API-Key': apiKey },
    });
    if (!response.ok) break;

    const payload = (await response.json()) as any;
    const batch = Array.isArray(payload?.[collectionKey]) ? payload[collectionKey] : [];
    if (batch.length === 0) break;

    items.push(...batch);

    const totalCount = Number(payload?.total_count);
    if (Number.isFinite(totalCount) && items.length >= totalCount) break;
    if (batch.length < pageSize) break;

    offset += batch.length;
  }

  return items.length > maxItems ? items.slice(0, maxItems) : items;
}

async function fetchRedmineAssigneeById(
  redmine: any,
  type: 'user' | 'group',
  id: number
): Promise<{ id: number; name: string; login: string; email: string; type: 'user' | 'group' } | null> {
  const baseUrl = normalizeBaseUrl(redmine?.baseUrl || '');
  const apiKey = redmine?.apiKey;
  if (!baseUrl || !apiKey || !Number.isFinite(id)) return null;

  const endpoint = type === 'group' ? `/groups/${id}.json` : `/users/${id}.json`;
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: { 'X-Redmine-API-Key': apiKey },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as any;
    if (type === 'group') {
      const group = payload?.group;
      const groupId = Number(group?.id);
      if (!Number.isFinite(groupId)) return null;
      return {
        id: groupId,
        name: String(group?.name || `Group ${groupId}`),
        login: '',
        email: '',
        type: 'group',
      };
    }
    const user = payload?.user;
    const userId = Number(user?.id);
    if (!Number.isFinite(userId)) return null;
    return {
      id: userId,
      name:
        `${String(user?.firstname || '').trim()} ${String(user?.lastname || '').trim()}`.trim() ||
        String(user?.login || user?.mail || `User ${userId}`),
      login: String(user?.login || ''),
      email: String(user?.mail || ''),
      type: 'user',
    };
  } catch {
    return null;
  }
}

async function resolveAssigneeViaRedmineApi(
  redmine: any,
  candidateRaw: unknown
): Promise<{ id: number; name: string; login: string; email: string; type: 'user' | 'group' } | null> {
  if (candidateRaw === null || candidateRaw === undefined) return null;
  const rawCandidate = String(candidateRaw).trim();
  const raw = rawCandidate.replace(/\s*\(.*\)\s*$/, '').trim() || rawCandidate;
  if (!raw) return null;

  const scoped = parseScopedAssigneeCandidate(raw);
  if (scoped) {
    return fetchRedmineAssigneeById(redmine, scoped.type, scoped.id);
  }

  const numericId = Number(raw);
  if (Number.isFinite(numericId)) {
    const user = await fetchRedmineAssigneeById(redmine, 'user', numericId);
    if (user) return user;
    const group = await fetchRedmineAssigneeById(redmine, 'group', numericId);
    if (group) return group;
    return null;
  }

  const baseUrl = normalizeBaseUrl(redmine?.baseUrl || '');
  const apiKey = redmine?.apiKey;
  if (!baseUrl || !apiKey) return null;

  const normalizedRaw = normalizeAssigneeSearchValue(raw);
  const rawTokens = tokenizeAssigneeSearchValue(raw);
  const scoreAssigneeValue = (value: string): number => {
    const normalizedValue = normalizeAssigneeSearchValue(value);
    if (!normalizedValue || !normalizedRaw) return 0;
    let score = 0;
    if (normalizedValue === normalizedRaw) score += 120;
    if (normalizedValue.startsWith(normalizedRaw)) score += 65;
    if (normalizedValue.includes(normalizedRaw)) score += 40;
    rawTokens.forEach((token) => {
      if (normalizedValue.includes(token)) score += 14;
    });
    return score;
  };

  const searchTerms = Array.from(
    new Set(
      [
        raw,
        ...rawTokens.filter((token) => token.length >= 2),
        rawTokens.length > 0 ? rawTokens[0] : '',
        rawTokens.length > 1 ? rawTokens[rawTokens.length - 1] : '',
      ]
        .map((term) => String(term || '').trim())
        .filter((term) => term.length >= 2)
    )
  ).slice(0, 4);

  const userMap = new Map<number, any>();
  try {
    const statusValues = [1, 2, 3];
    for (const term of searchTerms) {
      for (const statusValue of statusValues) {
        const users = await fetchRedminePagedCollectionByKey(
          baseUrl,
          apiKey,
          `/users.json?name=${encodeURIComponent(term)}&status=${statusValue}`,
          'users',
          100,
          600
        );
        users.forEach((user: any) => {
          const userId = Number(user?.id);
          if (Number.isFinite(userId) && !userMap.has(userId)) {
            userMap.set(userId, user);
          }
        });
        if (userMap.size >= 450) break;
      }
      if (userMap.size >= 450) break;
    }
  } catch {
    // ignore
  }

  let bestUser:
    | {
        score: number;
        value: { id: number; name: string; login: string; email: string; type: 'user' };
      }
    | null = null;
  userMap.forEach((user) => {
    const userId = Number(user?.id);
    if (!Number.isFinite(userId)) return;
    const displayName =
      `${String(user?.firstname || '').trim()} ${String(user?.lastname || '').trim()}`.trim() ||
      String(user?.login || user?.mail || `User ${userId}`);
    const login = String(user?.login || '');
    const email = String(user?.mail || '');
    const score =
      Math.max(scoreAssigneeValue(displayName), scoreAssigneeValue(login), scoreAssigneeValue(email)) +
      (Number(user?.status) === 1 ? 8 : 0);

    if (!bestUser || score > bestUser.score) {
      bestUser = {
        score,
        value: {
          id: userId,
          name: displayName,
          login,
          email,
          type: 'user',
        },
      };
    }
  });

  if (bestUser && bestUser.score >= 120) return bestUser.value;

  let bestGroup:
    | {
        score: number;
        value: { id: number; name: string; login: string; email: string; type: 'group' };
      }
    | null = null;
  try {
    const groups = await fetchRedminePagedCollectionByKey(
      baseUrl,
      apiKey,
      '/groups.json',
      'groups',
      100,
      600
    );
    groups.forEach((group: any) => {
      const groupId = Number(group?.id);
      if (!Number.isFinite(groupId)) return;
      const groupName = String(group?.name || `Group ${groupId}`);
      const score = scoreAssigneeValue(groupName);
      if (!bestGroup || score > bestGroup.score) {
        bestGroup = {
          score,
          value: {
            id: groupId,
            name: groupName,
            login: '',
            email: '',
            type: 'group',
          },
        };
      }
    });
  } catch {
    // ignore
  }

  if (bestUser && bestUser.score > 0 && (!bestGroup || bestUser.score >= bestGroup.score)) {
    return bestUser.value;
  }
  if (bestGroup && bestGroup.score > 0) {
    return bestGroup.value;
  }

  try {
    const fallbackUsers = await fetchRedminePagedCollectionByKey(
      baseUrl,
      apiKey,
      `/users.json?name=${encodeURIComponent(raw)}`,
      'users',
      100,
      300
    );
    const direct = fallbackUsers.find((entry: any) => {
      const displayName =
        `${String(entry?.firstname || '').trim()} ${String(entry?.lastname || '').trim()}`.trim();
      return (
        normalizeAssigneeSearchValue(displayName) === normalizedRaw ||
        normalizeAssigneeSearchValue(entry?.login || '') === normalizedRaw ||
        normalizeAssigneeSearchValue(entry?.mail || '') === normalizedRaw
      );
    });
    if (!direct) return null;
    const userId = Number(direct?.id);
    if (!Number.isFinite(userId)) return null;
    return {
      id: userId,
      name:
        `${String(direct?.firstname || '').trim()} ${String(direct?.lastname || '').trim()}`.trim() ||
        String(direct?.login || direct?.mail || `User ${userId}`),
      login: String(direct?.login || ''),
      email: String(direct?.mail || ''),
      type: 'user',
    };
  } catch {
    return null;
  }
}

function parseExpiry(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  return null;
}

function isExpired(value: unknown, graceMs = 5 * 60 * 1000): boolean {
  const expiryMs = parseExpiry(value);
  if (!expiryMs) return false;
  return expiryMs + graceMs < Date.now();
}

async function generateRedmineIssueViaAI(input: {
  category: string;
  description: string;
  address: string;
  coordinates?: string;
  imageContext?: string;
  ticketId?: string;
  ticket?: any;
  projectOptions: Array<{ name: string; identifier?: string }>;
  trackerOptions: Array<{ name: string }>;
  roleOptions?: Array<{ name: string }>;
  assigneeOptions: Array<{ name: string; id?: number; type?: 'user' | 'group' }>;
  recommendedProject?: string | null;
  recommendedTracker?: string | null;
  recommendedAssignee?: string | null;
  promptTemplate?: string;
  promptExtension?: string;
}) {
const defaultPromptTemplate = `Daten zur Buergermeldung:
- Kategorie: {category}
- Beschreibung: {description}
- Adresse / Ort: {address}
- Koordinaten: {coordinates}
- KI-Bildbeschreibungen:
{imageContext}

Empfohlenes Projekt: {recommendedProject}
Empfohlener Tracker: {recommendedTracker}
Empfohlene Zuweisung (Benutzer/Gruppe): {recommendedAssignee}

Projektliste: {projectList}
Trackerliste: {trackerList}
Rollenliste: {roleList}

Assignee-Verzeichnis (Format: user:<id> oder group:<id> = Name):
{assigneeList}
{assigneeListHint}

Ausgabe-Regeln:
- Antworte nur zwischen BEGIN_JSON und END_JSON.
- JSON-Felder: subject, description, projectName, trackerName, assigneeRef, assigneeName, assigneeId
- projectName nur exakt aus Projektliste, sonst leerer String.
- trackerName nur exakt aus Trackerliste, sonst leerer String.
- assigneeRef nur als user:<id> oder group:<id> aus Assignee-Verzeichnis; sonst leerer String.
- assigneeName nur passend zur assigneeRef; sonst leerer String.
- assigneeId nur als Zahl passend zur assigneeRef; sonst null.
- Betreff kurz und klar (6-90 Zeichen).
- Beschreibung strukturiert, sachlich, ohne Halluzinationen.
- Keine Markdown-Codefences, keine Erlaeuterungen ausserhalb von BEGIN_JSON/END_JSON.

Bitte formuliere Betreff und Beschreibung in Deutsch.`;

  const projectList = input.projectOptions
    .map((p) => (p.identifier ? `${p.name} (${p.identifier})` : p.name))
    .join(', ');
  const trackerList = input.trackerOptions.map((t) => t.name).join(', ');
  const roleList = (input.roleOptions || []).map((r) => r.name).join(', ');
  const maxAssigneePromptItems = 350;
  const assigneeOptionsForPrompt = input.assigneeOptions.slice(0, maxAssigneePromptItems);
  const assigneeList = assigneeOptionsForPrompt
    .map((assignee) => {
      const numericId = Number(assignee.id);
      const scopedRef = Number.isFinite(numericId)
        ? `${assignee.type === 'group' ? 'group' : 'user'}:${numericId}`
        : '';
      return scopedRef ? `${scopedRef} = ${assignee.name}` : assignee.name;
    })
    .join('\n');
  const assigneeListHint =
    input.assigneeOptions.length > maxAssigneePromptItems
      ? `Hinweis: Aus Performancegruenden werden ${maxAssigneePromptItems} von ${input.assigneeOptions.length} Assignees gezeigt.`
      : '';

  const systemPrompt = await getSystemPrompt('redmineTicketPrompt');

  const resolvedPromptTemplate =
    typeof input.promptTemplate === 'string' && input.promptTemplate.trim()
      ? input.promptTemplate
      : defaultPromptTemplate;

  let userPrompt = renderTemplate(resolvedPromptTemplate, {
    category: input.category || '–',
    description: input.description || '–',
    address: input.address || '–',
    coordinates: input.coordinates || '–',
    imageContext: input.imageContext || 'Keine KI-Bildbeschreibungen vorhanden.',
    projectList: projectList || '–',
    trackerList: trackerList || '–',
    roleList: roleList || '–',
    assigneeList: assigneeList || '–',
    assigneeListHint: assigneeListHint || '',
    recommendedProject: input.recommendedProject || '–',
    recommendedTracker: input.recommendedTracker || '–',
    recommendedAssignee: input.recommendedAssignee || '–',
  });

  const promptExtension =
    typeof input.promptExtension === 'string' ? input.promptExtension.trim() : '';
  if (promptExtension) {
    userPrompt += `\n\nZusätzliche Anweisung:\n${promptExtension}`;
  }

  const response = await testAIProviderForTicketPrompt({
    prompt: `${systemPrompt}\n\n${userPrompt}`,
    purpose: 'workflow_redmine_ai',
    meta: {
      source: 'routes.workflows.redmine',
      ticketId: input.ticketId,
    },
    ticket: input.ticket,
  });
  const data = extractJsonPayload(response);
  const projectNameRaw =
    (typeof data.projectName === 'string' && data.projectName) ||
    (typeof data.project === 'string' && data.project) ||
    '';
  const trackerNameRaw =
    (typeof data.trackerName === 'string' && data.trackerName) ||
    (typeof data.tracker === 'string' && data.tracker) ||
    '';
  const assigneeNameRaw =
    (typeof data.assigneeName === 'string' && data.assigneeName) ||
    (typeof data.assignee === 'string' && data.assignee) ||
    (typeof data.assignedTo === 'string' && data.assignedTo) ||
    '';
  const assigneeRefRaw =
    (typeof data.assigneeRef === 'string' && data.assigneeRef) ||
    (typeof data.assigneeScoped === 'string' && data.assigneeScoped) ||
    (typeof data.assigneeKey === 'string' && data.assigneeKey) ||
    '';
  const assigneeIdRaw =
    data.assigneeId ?? data.assignedToId ?? data.assignee_id ?? data.assigned_to_id ?? null;
  const assigneeTypeRaw =
    (typeof data.assigneeType === 'string' && data.assigneeType) ||
    (typeof data.assignedToType === 'string' && data.assignedToType) ||
    '';
  const assigneeId =
    typeof assigneeIdRaw === 'number'
      ? assigneeIdRaw
      : typeof assigneeIdRaw === 'string' && assigneeIdRaw.trim() !== ''
      ? Number(assigneeIdRaw)
      : null;
  const assigneeRef = normalizeAiAssigneeReference(assigneeRefRaw, assigneeTypeRaw, assigneeIdRaw);
  return {
    subject: typeof data.subject === 'string' ? data.subject.trim() : '',
    description: typeof data.description === 'string' ? data.description.trim() : '',
    projectName: projectNameRaw.trim(),
    trackerName: trackerNameRaw.trim(),
    assigneeRef,
    assigneeName: assigneeNameRaw.trim(),
    assigneeId: Number.isFinite(assigneeId) ? assigneeId : null,
  };
}

async function createRedmineIssue(input: {
  redmine: any;
  project: any;
  tracker: any | null;
  assignee?: { id: number } | null;
  subject: string;
  description: string;
  statusId?: number | null;
  customFields?: Array<{ id: number; value: string }>;
  uploads?: Array<{ token: string; filename: string; description?: string }>;
}) {
  const baseUrl = normalizeBaseUrl(input.redmine?.baseUrl || '');
  const apiKey = input.redmine?.apiKey;
  if (!baseUrl || !apiKey) {
    throw new Error('Redmine ist nicht konfiguriert');
  }

  const projectIdentifier = input.project?.identifier || input.project?.id || input.project?.name;
  if (!projectIdentifier) {
    throw new Error('Kein gültiges Redmine-Projekt gefunden');
  }

  const payload: any = {
    issue: {
      project_id: projectIdentifier,
      subject: input.subject,
      description: input.description,
    },
  };

  if (input.tracker?.id) {
    payload.issue.tracker_id = input.tracker.id;
  }
  if (typeof input.statusId === 'number' && Number.isFinite(input.statusId)) {
    payload.issue.status_id = input.statusId;
  }
  if (input.assignee?.id) {
    payload.issue.assigned_to_id = input.assignee.id;
  }
  if (Array.isArray(input.customFields) && input.customFields.length > 0) {
    payload.issue.custom_fields = input.customFields;
  }
  if (input.uploads && input.uploads.length > 0) {
    payload.issue.uploads = input.uploads;
  }

  const response = await fetch(`${baseUrl}/issues.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Redmine-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Redmine-API Fehler: ${response.status} ${text}`);
  }

  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  const issueId = data?.issue?.id || data?.id;
  return { issueId, raw: data };
}

async function uploadRedmineAttachment(
  redmine: any,
  fileName: string,
  data: Buffer
): Promise<string | null> {
  const baseUrl = normalizeBaseUrl(redmine?.baseUrl || '');
  const apiKey = redmine?.apiKey;
  if (!baseUrl || !apiKey) return null;

  const response = await fetch(`${baseUrl}/uploads.json?filename=${encodeURIComponent(fileName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Redmine-API-Key': apiKey,
    },
    body: data,
  });

  const text = await response.text();
  if (!response.ok) {
    console.warn(`Redmine upload failed: ${response.status} ${text}`);
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return parsed?.upload?.token || null;
  } catch {
    return null;
  }
}

function normalizeImageBuffer(value: any): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    const base64 = value.includes('base64,') ? value.split('base64,')[1] : value;
    try {
      return Buffer.from(base64, 'base64');
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

async function executeRedmineTask(execution: WorkflowExecution, task: WorkflowTask) {
  const knowledge = await loadKnowledge();
  const redmine = knowledge.redmine;
  if (!redmine?.baseUrl || !redmine?.apiKey) {
    throw new Error('Redmine ist nicht konfiguriert');
  }

  const db = getDatabase();
  const ticket = await db.get(
    `SELECT t.*, 
            s.id as submission_id,
            s.original_description as submission_original_description,
            s.anonymized_text as submission_anonymized_text,
            s.address as submission_address,
            s.postal_code as submission_postal_code,
            s.city as submission_city,
            c.name as citizen_name,
            c.email as citizen_email,
            COALESCE(t.citizen_language, c.preferred_language) as citizen_preferred_language,
            COALESCE(t.citizen_language_name, c.preferred_language_name) as citizen_preferred_language_name
     FROM tickets t
     LEFT JOIN submissions s ON s.id = t.submission_id
     LEFT JOIN citizens c ON c.id = t.citizen_id
     WHERE t.id = ?`,
    [execution.ticketId]
  );

  if (!ticket) {
    throw new Error('Ticket nicht gefunden');
  }

  const categoryProject = ticket.redmine_project || null;
  const categoryTracker = null;

  const description =
    ticket.submission_original_description ||
    ticket.description ||
    ticket.submission_anonymized_text ||
    '';
  const redmineUnknownLocation = 'ubekannt';
  const address = ticket.address || ticket.submission_address || '';
  const locationTextRaw = [address, ticket.postal_code, ticket.city, ticket.submission_postal_code, ticket.submission_city]
    .filter(Boolean)
    .join(', ');
  const locationText = asTrimmedString(locationTextRaw) || redmineUnknownLocation;
  const coordinates =
    ticket.latitude && ticket.longitude
      ? `${Number(ticket.latitude).toFixed(6)}, ${Number(ticket.longitude).toFixed(6)}`
      : '';
  const imageDescriptionRows = ticket.submission_id
    ? await db.all(
        `SELECT id, file_name, ai_description_text, ai_description_confidence, ai_description_model
         FROM submission_images
         WHERE submission_id = ?
           AND ai_description_text IS NOT NULL
           AND TRIM(ai_description_text) <> ''
         ORDER BY created_at ASC`,
        [ticket.submission_id]
      )
    : [];
  const imageContext = buildWorkflowImagePromptContext(
    (imageDescriptionRows || []).map((row: any) => ({
      id: String(row?.id || ''),
      fileName: String(row?.file_name || 'bild'),
      description: String(row?.ai_description_text || '').trim(),
      confidence: Number.isFinite(Number(row?.ai_description_confidence))
        ? Math.max(0, Math.min(1, Number(row.ai_description_confidence)))
        : null,
      model:
        typeof row?.ai_description_model === 'string' && row.ai_description_model.trim()
          ? row.ai_description_model.trim()
          : null,
      status: 'done',
      updatedAt: null,
    }))
  );
  const cityValue =
    asTrimmedString(ticket.city || ticket.submission_city || '') ||
    locationText ||
    redmineUnknownLocation;
  const latitudeValue = asCoordinateString(ticket.latitude);
  const longitudeValue = asCoordinateString(ticket.longitude);
  const normalizedAddressForRedmine =
    asTrimmedString(address) || locationText || redmineUnknownLocation;
  const { street, houseNumber } = splitStreetAndHouseNumber(normalizedAddressForRedmine);
  const { firstName, lastName } = splitCitizenName(ticket.citizen_name || '');
  const citizenEmail = asTrimmedString(ticket.citizen_email || '');
  const citizenPhone = '';
  const mappedCategoryName = resolveLegacyMappedCategoryName(ticket.category, knowledge);
  const legacyDescriptionBlock = buildLegacyRedmineDescriptionBlock({
    mappedCategoryName,
    originalDescription: asTrimmedString(description),
    city: cityValue,
    street,
    houseNumber,
    latitude: latitudeValue,
    longitude: longitudeValue,
    firstName,
    lastName,
    email: citizenEmail,
    phone: citizenPhone,
  });
  const redmineCustomFields = buildLegacyRedmineCustomFields({
    city: cityValue,
    latitude: latitudeValue,
    longitude: longitudeValue,
    email: citizenEmail,
    phone: citizenPhone,
    street,
    houseNumber,
    firstName,
    lastName,
    mappedCategoryName,
  });

  const projectOptions = (redmine.projects || []).map((p: any) => ({
    name: p.name,
    identifier: p.identifier,
    enabled: p.enabled,
  }));
  const hasEnabledProjects = projectOptions.some((p: any) => p.enabled === true);
  const projectChoices = (hasEnabledProjects
    ? projectOptions.filter((p: any) => p.enabled === true)
    : projectOptions).slice(0, 30);

  const trackerOptions = (redmine.trackers || []).map((t: any) => ({
    name: t.name,
    id: t.id,
    enabled: t.enabled,
  }));
  const hasEnabledTrackers = trackerOptions.some((t: any) => t.enabled === true);
  const trackerChoices = (hasEnabledTrackers
    ? trackerOptions.filter((t: any) => t.enabled === true)
    : trackerOptions).slice(0, 30);

  const roleOptions = (redmine.roles || []).map((r: any) => ({
    name: r.name,
    id: r.id,
    enabled: r.enabled,
  }));
  const hasEnabledRoles = roleOptions.some((r: any) => r.enabled === true);
  const roleChoices = (hasEnabledRoles
    ? roleOptions.filter((r: any) => r.enabled === true)
    : roleOptions).slice(0, 30);
  const userPool = redmine.assignableUsers || [];
  const enabledUsers = userPool.filter((u: any) => u.enabled);
  const userChoices = enabledUsers.length > 0 ? enabledUsers : userPool;
  const groupChoices = (() => {
    const groups = Array.isArray(redmine.groups) ? redmine.groups : [];
    const explicitIds = Array.isArray(redmine.assignableGroupIds)
      ? redmine.assignableGroupIds
          .map((id: any) => Number(id))
          .filter((id: number) => Number.isFinite(id))
      : [];
    if (explicitIds.length > 0) {
      const idSet = new Set(explicitIds);
      return groups.filter((group: any) => idSet.has(Number(group?.id)));
    }
    const hasEnabledFlags = groups.some((group: any) => typeof group?.enabled === 'boolean');
    if (hasEnabledFlags) {
      return groups.filter((group: any) => group?.enabled === true);
    }
    return groups;
  })();
  const assigneeOptions = [
    ...userChoices.map((u: any) => ({
      name: `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.login || u.mail || `User ${u.id}`,
      id: u.id,
      type: 'user' as const,
    })),
    ...groupChoices.map((g: any) => ({ name: g.name, id: g.id, type: 'group' as const })),
  ];

  const normalizedModes = normalizeRedmineModes(task.config || {});
  const selectionMode = normalizedModes.selectionMode;
  const aiProjectTrackerEnabled = normalizedModes.aiProjectTrackerEnabled;
  const projectMode = normalizedModes.projectMode;
  const trackerMode = normalizedModes.trackerMode;
  const assigneeMode = normalizedModes.assigneeMode;
  const aiPromptTemplate =
    typeof task.config?.aiPromptTemplate === 'string' ? task.config.aiPromptTemplate : '';
  const aiPromptExtension =
    typeof task.config?.aiPromptExtension === 'string' ? task.config.aiPromptExtension : '';

  const requiresAi =
    projectMode === 'ai' ||
    trackerMode === 'ai' ||
    assigneeMode === 'ai' ||
    selectionMode !== 'manual' ||
    aiProjectTrackerEnabled;

  let aiData = {
    subject: '',
    description: '',
    projectName: '',
    trackerName: '',
    assigneeRef: '',
    assigneeName: '',
    assigneeId: null as number | null,
  };
  let aiFallbackUsed = false;
  let aiDecisionReason = '';

  if (requiresAi) {
    try {
      aiData = await generateRedmineIssueViaAI({
        category: ticket.category,
        description,
        address: locationText || address || '–',
        coordinates,
        imageContext,
        ticketId: ticket.id,
        ticket,
        projectOptions: projectChoices,
        trackerOptions: trackerChoices,
        roleOptions: roleChoices,
        assigneeOptions,
        recommendedProject: categoryProject,
        recommendedTracker: categoryTracker,
        recommendedAssignee: null,
        promptTemplate: aiPromptTemplate || undefined,
        promptExtension: aiPromptExtension || undefined,
      });
      aiDecisionReason = 'KI-Auswahl für Redmine-Felder erfolgreich.';
    } catch (error) {
      console.warn('AI Redmine generation failed, using fallback:', error);
      aiFallbackUsed = true;
      aiDecisionReason = `KI-Auswahl fehlgeschlagen: ${
        error instanceof Error ? error.message : String(error || 'unbekannt')
      }`;
    }
  }

  const templateData = {
    category: ticket.category || '',
    address: locationText || address || '',
    coordinates,
    description,
    ticketId: ticket.id || '',
    submissionId: ticket.submission_id || '',
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  };

  const fallbackSubject = task.config?.titleTemplate
    ? renderTemplate(task.config.titleTemplate, templateData)
    : `${ticket.category || 'Bürgermeldung'}: ${templateData.address || '–'}`;

  const fallbackDescription = task.config?.descriptionTemplate
    ? renderTemplate(task.config.descriptionTemplate, templateData)
    : `Kategorie: ${ticket.category || '–'}\nOrt: ${templateData.address || '–'}\n\n${description}`;

  const forcedProject = normalizeFixedValue(task.config?.projectId);
  const forcedTracker = normalizeFixedValue(task.config?.tracker);
  const forcedAssignee = normalizeFixedValue(task.config?.assigneeId);
  const fixedProjectCandidate = forcedProject || categoryProject;
  const fixedTrackerCandidate = forcedTracker || categoryTracker;

  if (projectMode === 'fixed' && !fixedProjectCandidate) {
    throw new Error('REDMINE-Schritt: Projektmodus "Fest" benötigt ein gültiges Projekt.');
  }
  if (trackerMode === 'fixed' && !fixedTrackerCandidate) {
    throw new Error('REDMINE-Schritt: Trackermodus "Fest" benötigt einen gültigen Tracker.');
  }

  const normalizedAssigneeMode: RedmineAssigneeMode =
    assigneeMode === 'fixed' && !forcedAssignee ? 'none' : assigneeMode;
  const noAssignee = normalizedAssigneeMode === 'none';
  const aiAssigneeHint = aiData.assigneeRef || (aiData.assigneeId ?? aiData.assigneeName) || null;

  const strictProject =
    projectMode === 'fixed'
      ? resolveProject(redmine, fixedProjectCandidate, null, { allowFallback: false })
      : null;
  const strictTracker =
    trackerMode === 'fixed'
      ? resolveTracker(redmine, fixedTrackerCandidate, null, { allowFallback: false })
      : null;

  const resolvedProject = resolveProject(
    redmine,
    projectMode === 'ai' ? aiData.projectName : null,
    projectMode === 'fixed' ? fixedProjectCandidate : categoryProject
  );
  const resolvedTracker = resolveTracker(
    redmine,
    trackerMode === 'ai' ? aiData.trackerName : null,
    trackerMode === 'fixed' ? fixedTrackerCandidate : categoryTracker
  );
  const assigneeInput =
    normalizedAssigneeMode === 'fixed'
      ? forcedAssignee
      : aiData.assigneeRef || (aiData.assigneeId ?? aiData.assigneeName ?? aiAssigneeHint);
  let resolvedAssignee =
    normalizedAssigneeMode === 'none'
      ? null
      : resolveAssignee(
          redmine,
          normalizedAssigneeMode === 'ai' ? aiData.assigneeRef || aiData.assigneeName : null,
          normalizedAssigneeMode === 'fixed' ? forcedAssignee : aiAssigneeHint
        );
  if (!resolvedAssignee && normalizedAssigneeMode !== 'none' && assigneeInput !== null && assigneeInput !== undefined) {
    resolvedAssignee = await resolveAssigneeViaRedmineApi(redmine, assigneeInput);
  }

  if (projectMode === 'fixed' && !strictProject) {
    throw new Error(`REDMINE-Schritt: Festes Projekt "${fixedProjectCandidate}" konnte nicht aufgelöst werden.`);
  }
  if (trackerMode === 'fixed' && !strictTracker) {
    throw new Error(`REDMINE-Schritt: Fester Tracker "${fixedTrackerCandidate}" konnte nicht aufgelöst werden.`);
  }
  if (normalizedAssigneeMode === 'fixed' && forcedAssignee && !resolvedAssignee) {
    throw new Error(`REDMINE-Schritt: Feste Zuweisung "${forcedAssignee}" konnte nicht aufgelöst werden.`);
  }
  const aiDecisionTrace =
    requiresAi
      ? {
          decision: JSON.stringify({
            project: resolvedProject?.name || resolvedProject?.identifier || null,
            tracker: resolvedTracker?.name || null,
            assignee: resolvedAssignee?.name || null,
          }),
          confidence: aiFallbackUsed ? 0 : 0.72,
          reason:
            aiDecisionReason ||
            'KI-Auswahl wurde ausgewertet und auf verfügbare Redmine-Optionen gemappt.',
          fallbackUsed: aiFallbackUsed,
        }
      : undefined;

  const useAiText =
    typeof task.config?.textMode === 'string'
      ? task.config.textMode === 'ai'
      : requiresAi;
  const subject = useAiText && aiData.subject ? aiData.subject : fallbackSubject;
  const finalDescription = useAiText && aiData.description ? aiData.description : fallbackDescription;
  const finalDescriptionWithLegacyContext = appendLegacyRedmineDescriptionBlock(
    finalDescription,
    legacyDescriptionBlock
  );
  const finalDescriptionWithReporter = appendReporterContextToRedmineDescription(finalDescriptionWithLegacyContext, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });

  const uploads: Array<{ token: string; filename: string; description?: string }> = [];
  let totalImageCount = 0;
  let uploadedImageCount = 0;
  if (ticket.submission_id) {
    const images = await db.all(
      `SELECT file_name, image_data FROM submission_images WHERE submission_id = ?`,
      [ticket.submission_id]
    );
    totalImageCount = Array.isArray(images) ? images.length : 0;
    let counter = 1;
    for (const image of images || []) {
      const buffer = normalizeImageBuffer(image?.image_data);
      if (!buffer) continue;
      const fileName = image?.file_name || `meldung-${ticket.id}-bild-${counter}.jpg`;
      const token = await uploadRedmineAttachment(redmine, fileName, buffer);
      if (token) {
        uploads.push({ token, filename: fileName, description: 'Buergerfoto' });
        uploadedImageCount += 1;
      }
      counter += 1;
    }
  }

  const apiIssuePayload: Record<string, any> = {
    project_id: resolvedProject?.identifier || resolvedProject?.id || resolvedProject?.name || null,
    status_id: 1,
    subject,
    description: finalDescriptionWithReporter,
  };
  if (resolvedTracker?.id) {
    apiIssuePayload.tracker_id = resolvedTracker.id;
  }
  if (resolvedAssignee?.id) {
    apiIssuePayload.assigned_to_id = resolvedAssignee.id;
  }
  if (redmineCustomFields.length > 0) {
    apiIssuePayload.custom_fields = redmineCustomFields;
  }
  if (uploads.length > 0) {
    apiIssuePayload.uploads = uploads;
  }

  const apiRequestPreview = {
    endpoint: `${normalizeBaseUrl(redmine?.baseUrl || '')}/issues.json`,
    method: 'POST' as const,
    payload: {
      issue: apiIssuePayload,
    },
  };

  let issueId: number | null = null;
  try {
    const result = await createRedmineIssue({
      redmine,
      project: resolvedProject,
      tracker: resolvedTracker,
      assignee: resolvedAssignee,
      subject,
      description: finalDescriptionWithReporter,
      statusId: 1,
      customFields: redmineCustomFields,
      uploads,
    });
    issueId = result?.issueId ? Number(result.issueId) : null;
  } catch (createError: any) {
    const enhancedError = new Error(createError?.message || 'Redmine-Ticket konnte nicht erstellt werden');
    (enhancedError as any).executionData = {
      project: resolvedProject?.name || resolvedProject?.identifier || null,
      tracker: resolvedTracker?.name || null,
      assignee: resolvedAssignee?.name || null,
      assigneeId: resolvedAssignee?.id || null,
      assigneeType: resolvedAssignee?.type || null,
      assigneeInput: assigneeInput ?? null,
      noAssignee,
      subject,
      description: finalDescriptionWithReporter,
      statusId: 1,
      customFields: redmineCustomFields,
      selectionMode,
      aiProjectTrackerEnabled,
      projectMode,
      trackerMode,
      assigneeMode: normalizedAssigneeMode,
      waitForTargetStatus: task.config?.waitForTargetStatus === true,
      targetStatusIds: Array.isArray(task.config?.targetStatusIds) ? task.config.targetStatusIds : [],
      targetStatusCheckIntervalSeconds: task.config?.targetStatusCheckIntervalSeconds || 60,
      waitMaxSeconds: Number(task.config?.waitMaxSeconds || 0) || 0,
      aiDecision: aiDecisionTrace,
      textMode: useAiText ? 'ai' : 'fixed',
      aiPromptTemplate: aiPromptTemplate || undefined,
      aiPromptExtension: aiPromptExtension || undefined,
      totalImageCount,
      uploadedImageCount,
      uploadedAttachmentCount: uploads.length,
      apiRequestPreview,
      redmineError: createError?.message || null,
    };
    throw enhancedError;
  }

  await db.run(
    `UPDATE tickets SET redmine_issue_id = ?, redmine_project = ?, assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [
      issueId || null,
      resolvedProject?.name || resolvedProject?.identifier || null,
      resolvedAssignee?.name || null,
      ticket.id,
    ]
  );
  publishTicketUpdate({
    reason: 'ticket.redmine.synced',
    ticketId: String(ticket.id || ''),
  });

  const selectedStatusIds = Array.isArray(task.config?.targetStatusIds)
    ? task.config.targetStatusIds
        .map((status: any) => Number(status))
        .filter((statusId: number) => Number.isFinite(statusId))
    : [];
  const waitForTargetStatus = task.config?.waitForTargetStatus === true;
  const targetStatusCheckIntervalSeconds = Number.isFinite(Number(task.config?.targetStatusCheckIntervalSeconds))
    ? Math.max(15, Number(task.config?.targetStatusCheckIntervalSeconds))
    : 60;
  const waitMaxSeconds = Number.isFinite(Number(task.config?.waitMaxSeconds))
    ? Math.max(0, Math.floor(Number(task.config?.waitMaxSeconds)))
    : 0;
  const numericIssueId = issueId && Number.isFinite(Number(issueId)) ? Number(issueId) : null;
  const awaitRedmineStatus =
    waitForTargetStatus && numericIssueId && selectedStatusIds.length > 0
      ? {
          issueId: numericIssueId,
          targetStatusIds: selectedStatusIds,
          checkIntervalSeconds: targetStatusCheckIntervalSeconds,
          startedAt: new Date().toISOString(),
          ...(waitMaxSeconds > 0 ? { waitMaxSeconds } : {}),
        }
      : null;

  return {
    issueId: issueId || null,
    project: resolvedProject?.name || resolvedProject?.identifier || null,
    tracker: resolvedTracker?.name || null,
    assignee: resolvedAssignee?.name || null,
    assigneeId: resolvedAssignee?.id || null,
    assigneeType: resolvedAssignee?.type || null,
    noAssignee,
    subject,
    description: finalDescriptionWithReporter,
    statusId: 1,
    customFields: redmineCustomFields,
    selectionMode,
    aiProjectTrackerEnabled,
    projectMode,
    trackerMode,
    assigneeMode: normalizedAssigneeMode,
    waitForTargetStatus,
    targetStatusIds: selectedStatusIds,
    targetStatusCheckIntervalSeconds,
    waitMaxSeconds,
    aiDecision: aiDecisionTrace,
    textMode: useAiText ? 'ai' : 'fixed',
    aiPromptTemplate: aiPromptTemplate || undefined,
    aiPromptExtension: aiPromptExtension || undefined,
    totalImageCount,
    uploadedImageCount,
    uploadedAttachmentCount: uploads.length,
    apiRequestPreview,
    ...(awaitRedmineStatus ? { awaitingRedmineIssue: awaitRedmineStatus } : {}),
  };
}

interface WorkflowTicketImageAnalysis {
  id: string;
  fileName: string;
  description: string;
  confidence: number | null;
  model: string | null;
  status: string;
  updatedAt: string | null;
}

function buildWorkflowImagePromptContext(imageAnalyses: WorkflowTicketImageAnalysis[]): string {
  if (!Array.isArray(imageAnalyses) || imageAnalyses.length === 0) {
    return 'Keine KI-Bildbeschreibungen vorhanden.';
  }
  const lines = imageAnalyses.map((entry, index) => {
    const confidenceLabel =
      typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
        ? ` (confidence=${entry.confidence.toFixed(2)})`
        : '';
    const modelLabel = entry.model ? ` [${entry.model}]` : '';
    return `${index + 1}. ${entry.fileName}${modelLabel}${confidenceLabel}: ${entry.description}`;
  });
  return lines.join('\n');
}

function readProcessVariableConfidence(execution: WorkflowExecution, key: string): number | null {
  const value = getProcessVariable(execution, key);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function resolveWorkflowTextConfidence(execution: WorkflowExecution, task: WorkflowTask): number | null {
  const configuredKey = String(task.config?.confidenceVariableKey || '').trim();
  if (configuredKey) {
    const configured = readProcessVariableConfidence(execution, configuredKey);
    if (configured !== null) return configured;
  }
  const fallbackKeys = [
    'classification.overallConfidence',
    'classification.confidence',
    'enhanced.needCheck.overallConfidence',
    'enhanced.needCheck.confidence',
    'data_request.needCheck.overallConfidence',
    'data_request.needCheck.confidence',
    'var.overall_confidence',
    'var.confidence',
    'confidence',
  ];
  for (const key of fallbackKeys) {
    const value = readProcessVariableConfidence(execution, key);
    if (value !== null) return value;
  }
  return null;
}

async function loadTicketContext(execution: WorkflowExecution) {
  const db = getDatabase();
  const ticket = await db.get(
    `SELECT t.*, 
            s.id as submission_id,
            s.original_description as submission_original_description,
            s.anonymized_text as submission_anonymized_text,
            s.address as submission_address,
            s.postal_code as submission_postal_code,
            s.city as submission_city,
            s.nominatim_raw_json as submission_nominatim_raw_json,
            s.weather_report_json as submission_weather_report_json,
            c.name as citizen_name,
            c.email as citizen_email,
            tp.pseudo_name as reporter_pseudo_name,
            tp.pseudo_email as reporter_pseudo_email,
            COALESCE(t.citizen_language, c.preferred_language) as citizen_preferred_language,
            COALESCE(t.citizen_language_name, c.preferred_language_name) as citizen_preferred_language_name
     FROM tickets t
     LEFT JOIN submissions s ON s.id = t.submission_id
     LEFT JOIN citizens c ON c.id = t.citizen_id
     LEFT JOIN ticket_reporter_pseudonyms tp ON tp.ticket_id = t.id
     WHERE t.id = ?`,
    [execution.ticketId]
  );

  if (!ticket) {
    throw new Error('Ticket nicht gefunden');
  }

  const description =
    ticket.submission_original_description ||
    ticket.description ||
    ticket.submission_anonymized_text ||
    '';
  const address = ticket.address || ticket.submission_address || '';
  const locationText = [
    address,
    ticket.postal_code,
    ticket.city,
    ticket.submission_postal_code,
    ticket.submission_city,
  ]
    .filter(Boolean)
    .join(', ');
  const coordinates =
    ticket.latitude && ticket.longitude
      ? `${Number(ticket.latitude).toFixed(6)}, ${Number(ticket.longitude).toFixed(6)}`
      : '';
  const ticketNominatimRaw = parseJsonValue<Record<string, any> | null>(ticket.nominatim_raw_json, null);
  const submissionNominatimRaw = parseJsonValue<Record<string, any> | null>(ticket.submission_nominatim_raw_json, null);
  const ticketWeatherReport = parseJsonValue<Record<string, any> | null>(ticket.weather_report_json, null);
  const submissionWeatherReport = parseJsonValue<Record<string, any> | null>(ticket.submission_weather_report_json, null);
  const nominatimRaw = ticketNominatimRaw || submissionNominatimRaw;
  const weatherReport = ticketWeatherReport || submissionWeatherReport;
  const imageAnalysisRows = ticket.submission_id
    ? await db.all(
        `SELECT id,
                file_name,
                ai_description_text,
                ai_description_confidence,
                ai_description_model,
                ai_description_status,
                ai_description_updated_at
         FROM submission_images
         WHERE submission_id = ?
           AND ai_description_text IS NOT NULL
           AND TRIM(ai_description_text) <> ''
         ORDER BY created_at ASC`,
        [ticket.submission_id]
      )
    : [];
  const imageAnalyses: WorkflowTicketImageAnalysis[] = (imageAnalysisRows || []).map((row: any) => {
    const confidenceRaw = Number(row?.ai_description_confidence);
    return {
      id: String(row?.id || ''),
      fileName: String(row?.file_name || 'bild'),
      description: String(row?.ai_description_text || '').trim(),
      confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : null,
      model: typeof row?.ai_description_model === 'string' && row.ai_description_model.trim()
        ? row.ai_description_model.trim()
        : null,
      status: String(row?.ai_description_status || '').trim().toLowerCase() || 'done',
      updatedAt:
        typeof row?.ai_description_updated_at === 'string' && row.ai_description_updated_at.trim()
          ? row.ai_description_updated_at
          : null,
    };
  });
  const imageContext = buildWorkflowImagePromptContext(imageAnalyses);

  return {
    ticket,
    description,
    address,
    locationText,
    coordinates,
    nominatimRaw,
    weatherReport,
    imageAnalyses,
    imageContext,
  };
}

const WORKFLOW_PRIORITY_OPTIONS = new Set(['low', 'medium', 'high', 'critical']);
const RESPONSIBILITY_AUTHORITY_SYNONYMS: Record<string, string> = {
  ortsgemeinde: 'Ortsgemeinde',
  gemeinde: 'Ortsgemeinde',
  ortsverwaltung: 'Ortsgemeinde',
  verbandsgemeinde: 'Verbandsgemeinde',
  verbandsfreiegemeinde: 'Verbandsgemeinde',
  verbandsfreie_gemeinde: 'Verbandsgemeinde',
  vg: 'Verbandsgemeinde',
  kreisverwaltung: 'Landkreis',
  landkreis: 'Landkreis',
  kreisfreiestadt: 'Landkreis',
  kreisfreie_stadt: 'Landkreis',
  kreis: 'Landkreis',
  landesbehorde: 'Landesbehoerde',
  landesbehoerde: 'Landesbehoerde',
  landesbetrieb: 'Landesbehoerde',
};

function normalizeWorkflowPriority(value: unknown, fallback = 'medium'): string {
  const normalized = String(value || '').trim().toLowerCase();
  return WORKFLOW_PRIORITY_OPTIONS.has(normalized) ? normalized : fallback;
}

function normalizeResponsibilityAuthorityKey(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildResponsibilityAuthorityLookup(allowedAuthorities: string[]): Map<string, string> {
  const lookup = new Map<string, string>();
  const addLookupEntry = (keySource: unknown, value: string) => {
    const normalized = normalizeResponsibilityAuthorityKey(keySource);
    if (!normalized || lookup.has(normalized)) return;
    lookup.set(normalized, value);
  };

  for (const entry of allowedAuthorities) {
    const value = String(entry || '').trim();
    if (!value) continue;
    addLookupEntry(value, value);
    value
      .split(/[,;/|]+|\bund\b/gi)
      .map((segment) => String(segment || '').trim())
      .filter(Boolean)
      .forEach((segment) => addLookupEntry(segment, value));
  }
  for (const [key, value] of Object.entries(RESPONSIBILITY_AUTHORITY_SYNONYMS)) {
    const normalizedKey = normalizeResponsibilityAuthorityKey(key);
    const normalizedValue = normalizeResponsibilityAuthorityKey(value);
    if (!lookup.has(normalizedKey) && lookup.has(normalizedValue)) {
      lookup.set(normalizedKey, lookup.get(normalizedValue) || value);
    }
  }
  return lookup;
}

async function loadAllowedResponsibilityAuthorities(): Promise<string[]> {
  const { values } = await loadGeneralSettings();
  const entries = Array.isArray(values?.responsibilityAuthorities)
    ? values.responsibilityAuthorities
    : [];
  const lookup = buildResponsibilityAuthorityLookup(entries);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeResponsibilityAuthorityKey(entry);
    const resolved = lookup.get(normalized) || String(entry || '').trim();
    if (!resolved) continue;
    const key = normalizeResponsibilityAuthorityKey(resolved);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(resolved);
    if (ordered.length >= 30) break;
  }
  return ordered;
}

function resolveResponsibilityAuthorityFromAllowed(
  candidate: unknown,
  allowedAuthorities: string[],
  fallback?: unknown
): string | null {
  const lookup = buildResponsibilityAuthorityLookup(allowedAuthorities);
  const candidateKey = normalizeResponsibilityAuthorityKey(candidate);
  if (candidateKey && lookup.has(candidateKey)) {
    return lookup.get(candidateKey) || null;
  }
  const fallbackKey = normalizeResponsibilityAuthorityKey(fallback);
  if (fallbackKey && lookup.has(fallbackKey)) {
    return lookup.get(fallbackKey) || null;
  }
  return null;
}

function normalizeCategoryWorkflowTemplateId(input: unknown): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase();
  if (
    normalized === 'redmine-ticket' ||
    normalized === 'redmine_ticket' ||
    normalized === 'redmine ticket'
  ) {
    return 'standard-redmine-ticket';
  }
  return raw;
}

function resolveCategoryWorkflowTemplateId(
  knowledge: any,
  categoryNameOrId: unknown,
  fallbackTemplateId?: unknown
): string {
  const categoryNeedle = String(categoryNameOrId || '').trim();
  const categoryConfig = findCategoryConfig(knowledge, categoryNeedle);
  const mappedTemplateId = normalizeCategoryWorkflowTemplateId(
    categoryConfig?.workflowTemplateId || categoryConfig?.workflowId || ''
  );
  if (mappedTemplateId) return mappedTemplateId;
  const fallback = normalizeCategoryWorkflowTemplateId(fallbackTemplateId);
  return fallback || 'standard-redmine-ticket';
}

function toNullableCoordinate(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

async function persistAutoFetchedTicketNominatim(input: {
  ticketId: string;
  submissionId?: string | null;
  latitude: unknown;
  longitude: unknown;
  address: unknown;
  postalCode: unknown;
  city: unknown;
  nominatimRaw: Record<string, any> | null | undefined;
  ticketNominatimRaw: Record<string, any> | null;
  submissionNominatimRaw: Record<string, any> | null;
}): Promise<boolean> {
  if (!input.nominatimRaw || typeof input.nominatimRaw !== 'object') return false;
  const shouldUpdateTicket = !input.ticketNominatimRaw;
  const shouldUpdateSubmission = !!input.submissionId && !input.submissionNominatimRaw;
  if (!shouldUpdateTicket && !shouldUpdateSubmission) return false;

  const db = getDatabase();
  const latitude = toNullableCoordinate(input.latitude);
  const longitude = toNullableCoordinate(input.longitude);
  const address = asTrimmedString(input.address) || null;
  const postalCode = asTrimmedString(input.postalCode) || null;
  const city = asTrimmedString(input.city) || null;
  const nominatimRawJson = JSON.stringify(input.nominatimRaw);

  if (shouldUpdateTicket) {
    await db.run(
      `UPDATE tickets
       SET latitude = ?, longitude = ?, address = ?, postal_code = ?, city = ?, nominatim_raw_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [latitude, longitude, address, postalCode, city, nominatimRawJson, input.ticketId]
    );
  }

  if (shouldUpdateSubmission && input.submissionId) {
    await db.run(
      `UPDATE submissions
       SET latitude = ?, longitude = ?, address = ?, postal_code = ?, city = ?, nominatim_raw_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [latitude, longitude, address, postalCode, city, nominatimRawJson, input.submissionId]
    );
  }

  return shouldUpdateTicket;
}

async function buildCategorizationSuggestionForTicket(ticketId: string): Promise<{
  ticket: any;
  suggestion: {
    category: string;
    priority: string;
    reasoning: string;
    categoryId: string;
  };
  rawDecision: any;
  knowledgeVersion: string | null;
  knowledge: any;
}> {
  const db = getDatabase();
  const record = await db.get(
    `SELECT t.id as ticket_id,
            t.submission_id,
            t.category as ticket_category,
            t.priority as ticket_priority,
            t.status as ticket_status,
            t.description as ticket_description,
            t.latitude as ticket_latitude,
            t.longitude as ticket_longitude,
            t.address as ticket_address,
            t.postal_code as ticket_postal_code,
            t.city as ticket_city,
            t.nominatim_raw_json as ticket_nominatim_raw_json,
            t.weather_report_json as ticket_weather_report_json,
            s.anonymized_text as submission_anonymized_text,
            s.original_description as submission_original_description,
            s.address as submission_address,
            s.postal_code as submission_postal_code,
            s.city as submission_city,
            s.nominatim_raw_json as submission_nominatim_raw_json,
            s.weather_report_json as submission_weather_report_json
     FROM tickets t
     LEFT JOIN submissions s ON s.id = t.submission_id
     WHERE t.id = ?
     LIMIT 1`,
    [ticketId]
  );
  if (!record) {
    throw Object.assign(new Error('Ticket nicht gefunden'), { status: 404 });
  }

  const description =
    String(record.submission_anonymized_text || '').trim() ||
    String(record.submission_original_description || '').trim() ||
    String(record.ticket_description || '').trim();
  if (!description) {
    throw Object.assign(new Error('Keine Ticketbeschreibung vorhanden.'), { status: 400 });
  }

  const imageContextRows = record.submission_id
    ? await db.all(
        `SELECT file_name, ai_description_text, ai_description_confidence
         FROM submission_images
         WHERE submission_id = ?
           AND ai_description_text IS NOT NULL
           AND TRIM(ai_description_text) <> ''
         ORDER BY created_at ASC`,
        [record.submission_id]
      )
    : [];
  const imageContext =
    Array.isArray(imageContextRows) && imageContextRows.length > 0
      ? imageContextRows
          .map((row: any, index: number) => {
            const confidenceRaw = Number(row?.ai_description_confidence);
            const confidence = Number.isFinite(confidenceRaw)
              ? ` (confidence=${Math.max(0, Math.min(1, confidenceRaw)).toFixed(2)})`
              : '';
            return `${index + 1}. ${String(row?.file_name || 'bild')}${confidence}: ${String(
              row?.ai_description_text || ''
            ).trim()}`;
          })
          .join('\n')
      : '';

  const ticketNominatimRaw = parseJsonValue<Record<string, any> | null>(record.ticket_nominatim_raw_json, null);
  const submissionNominatimRaw = parseJsonValue<Record<string, any> | null>(record.submission_nominatim_raw_json, null);
  const ticketWeatherReport = parseJsonValue<Record<string, any> | null>(record.ticket_weather_report_json, null);
  const submissionWeatherReport = parseJsonValue<Record<string, any> | null>(record.submission_weather_report_json, null);

  const { result, knowledge, raw, effectiveInput } = await classifySubmission({
    description,
    imageContext: imageContext || undefined,
    latitude:
      record.ticket_latitude !== null && record.ticket_latitude !== undefined
        ? Number(record.ticket_latitude)
        : undefined,
    longitude:
      record.ticket_longitude !== null && record.ticket_longitude !== undefined
        ? Number(record.ticket_longitude)
        : undefined,
    address: record.ticket_address || record.submission_address || undefined,
    city: record.ticket_city || record.submission_city || undefined,
    postalCode: record.ticket_postal_code || record.submission_postal_code || undefined,
    nominatimRaw: ticketNominatimRaw || submissionNominatimRaw,
    weatherReport: ticketWeatherReport || submissionWeatherReport,
  });

  const persistedTicketNominatim = await persistAutoFetchedTicketNominatim({
    ticketId: String(record.ticket_id || ticketId),
    submissionId: record.submission_id ? String(record.submission_id) : null,
    latitude: effectiveInput?.latitude ?? record.ticket_latitude,
    longitude: effectiveInput?.longitude ?? record.ticket_longitude,
    address: effectiveInput?.address || record.ticket_address || record.submission_address,
    postalCode: effectiveInput?.postalCode || record.ticket_postal_code || record.submission_postal_code,
    city: effectiveInput?.city || record.ticket_city || record.submission_city,
    nominatimRaw: effectiveInput?.nominatimRaw || null,
    ticketNominatimRaw,
    submissionNominatimRaw,
  });
  if (persistedTicketNominatim) {
    publishTicketUpdate({
      reason: 'ticket.geocoded',
      ticketId: String(record.ticket_id || ticketId),
    });
  }

  const normalizedCategory = String(result?.kategorie || '').trim();
  const currentCategory = String(record.ticket_category || '').trim();
  const categoryIsFallback =
    !normalizedCategory || normalizedCategory.toLowerCase() === 'sonstiges';
  const candidateCategory =
    (categoryIsFallback && currentCategory ? currentCategory : normalizedCategory) ||
    currentCategory ||
    'Sonstiges';
  const finalCategory = resolveKnownCategoryName(knowledge, candidateCategory, currentCategory || 'Sonstiges');
  const finalPriority = normalizeWorkflowPriority(
    result?.dringlichkeit,
    normalizeWorkflowPriority(record.ticket_priority, 'medium')
  );
  const finalReasoning = String(result?.reasoning || '').trim() || 'Keine Begründung verfügbar';
  const finalCategoryId = String(result?.categoryId || '').trim() || 'sonstiges';

  return {
    ticket: record,
    suggestion: {
      category: finalCategory,
      priority: finalPriority,
      reasoning: finalReasoning,
      categoryId: finalCategoryId,
    },
    rawDecision: raw || result,
    knowledgeVersion: knowledge?.version ? String(knowledge.version) : null,
    knowledge,
  };
}

function normalizeShortStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((entry) => entry.slice(0, maxLength));
}

function extractRoadResponsibilityHint(input: {
  description: string;
  address: string;
  nominatimRaw: Record<string, any> | null;
}): {
  roadClass: 'bundesstrasse' | 'landesstrasse' | 'kreisstrasse' | 'sonstige' | 'unbekannt';
  roadRef: string;
  settlementHint: 'innerorts_hinweis' | 'ausserorts_hinweis' | 'unbekannt';
} {
  const nominatimAddress =
    input.nominatimRaw && typeof input.nominatimRaw.address === 'object' && !Array.isArray(input.nominatimRaw.address)
      ? (input.nominatimRaw.address as Record<string, any>)
      : {};
  const roadField = String(nominatimAddress.road || '').trim();
  const displayName = String(input.nominatimRaw?.display_name || '').trim();
  const extratags =
    input.nominatimRaw && typeof input.nominatimRaw.extratags === 'object' && !Array.isArray(input.nominatimRaw.extratags)
      ? (input.nominatimRaw.extratags as Record<string, any>)
      : {};
  const refs = [
    String(extratags.ref || ''),
    String(extratags.official_ref || ''),
    String(input.nominatimRaw?.ref || ''),
    roadField,
    displayName,
    input.address,
    input.description,
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(' | ');

  const matchBund = refs.match(/\bB[\s-]?\d{1,4}\b/i);
  const matchLand = refs.match(/\bL[\s-]?\d{1,4}\b/i);
  const matchKreis = refs.match(/\bK[\s-]?\d{1,4}\b/i);
  const roadRef = (matchBund || matchLand || matchKreis || [])[0] || '';
  const roadClass = matchBund
    ? 'bundesstrasse'
    : matchLand
    ? 'landesstrasse'
    : matchKreis
    ? 'kreisstrasse'
    : refs
    ? 'sonstige'
    : 'unbekannt';

  const hasHouseNumber = !!String(nominatimAddress.house_number || '').trim();
  const hasSettlement =
    !!String(nominatimAddress.city || '').trim() ||
    !!String(nominatimAddress.town || '').trim() ||
    !!String(nominatimAddress.village || '').trim() ||
    !!String(nominatimAddress.municipality || '').trim() ||
    !!String(nominatimAddress.suburb || '').trim();
  const settlementHint = hasSettlement || hasHouseNumber ? 'innerorts_hinweis' : 'ausserorts_hinweis';

  return {
    roadClass,
    roadRef: roadRef || '',
    settlementHint: refs ? settlementHint : 'unbekannt',
  };
}

function buildNominatimCompactSummary(raw: Record<string, any> | null): string {
  if (!raw || typeof raw !== 'object') return 'Keine OSM-/Nominatim-Daten vorhanden.';
  const address =
    raw.address && typeof raw.address === 'object' && !Array.isArray(raw.address)
      ? (raw.address as Record<string, any>)
      : {};
  const summary = {
    displayName: String(raw.display_name || '').trim() || null,
    class: String(raw.class || '').trim() || null,
    type: String(raw.type || '').trim() || null,
    osmType: String(raw.osm_type || '').trim() || null,
    road: String(address.road || '').trim() || null,
    houseNumber: String(address.house_number || '').trim() || null,
    city:
      String(address.city || address.town || address.village || address.municipality || '').trim() || null,
    postcode: String(address.postcode || '').trim() || null,
  };
  return JSON.stringify(summary, null, 2);
}

async function buildResponsibilitySuggestionForTicket(ticketId: string): Promise<{
  ticket: any;
  suggestion: {
    responsibilityAuthority: string;
    reasoning: string;
    confidence: number | null;
    legalBasis: string[];
    notes: string[];
  };
  rawDecision: any;
  allowedAuthorities: string[];
}> {
  const db = getDatabase();
  const record = await db.get(
    `SELECT t.id as ticket_id,
            t.submission_id,
            t.category as ticket_category,
            t.priority as ticket_priority,
            t.status as ticket_status,
            t.responsibility_authority as ticket_responsibility_authority,
            t.description as ticket_description,
            t.latitude as ticket_latitude,
            t.longitude as ticket_longitude,
            t.address as ticket_address,
            t.postal_code as ticket_postal_code,
            t.city as ticket_city,
            t.nominatim_raw_json as ticket_nominatim_raw_json,
            s.anonymized_text as submission_anonymized_text,
            s.original_description as submission_original_description,
            s.address as submission_address,
            s.postal_code as submission_postal_code,
            s.city as submission_city,
            s.nominatim_raw_json as submission_nominatim_raw_json
     FROM tickets t
     LEFT JOIN submissions s ON s.id = t.submission_id
     WHERE t.id = ?
     LIMIT 1`,
    [ticketId]
  );
  if (!record) {
    throw Object.assign(new Error('Ticket nicht gefunden'), { status: 404 });
  }

  const allowedAuthorities = await loadAllowedResponsibilityAuthorities();
  if (allowedAuthorities.length === 0) {
    throw Object.assign(
      new Error('Keine erlaubten Zustaendigkeiten konfiguriert. Bitte Einstellungen pruefen.'),
      { status: 400 }
    );
  }

  const description =
    String(record.submission_anonymized_text || '').trim() ||
    String(record.submission_original_description || '').trim() ||
    String(record.ticket_description || '').trim();
  if (!description) {
    throw Object.assign(new Error('Keine Ticketbeschreibung vorhanden.'), { status: 400 });
  }

  const imageContextRows = record.submission_id
    ? await db.all(
        `SELECT file_name, ai_description_text, ai_description_confidence
         FROM submission_images
         WHERE submission_id = ?
           AND ai_description_text IS NOT NULL
           AND TRIM(ai_description_text) <> ''
         ORDER BY created_at ASC`,
        [record.submission_id]
      )
    : [];
  const imageContext =
    Array.isArray(imageContextRows) && imageContextRows.length > 0
      ? imageContextRows
          .map((row: any, index: number) => {
            const confidenceRaw = Number(row?.ai_description_confidence);
            const confidence = Number.isFinite(confidenceRaw)
              ? ` (confidence=${Math.max(0, Math.min(1, confidenceRaw)).toFixed(2)})`
              : '';
            return `${index + 1}. ${String(row?.file_name || 'bild')}${confidence}: ${String(
              row?.ai_description_text || ''
            ).trim()}`;
          })
          .join('\n')
      : 'Keine KI-Bildbeschreibungen vorhanden.';

  const ticketNominatimRaw = parseJsonValue<Record<string, any> | null>(
    record.ticket_nominatim_raw_json,
    null
  );
  const submissionNominatimRaw = parseJsonValue<Record<string, any> | null>(
    record.submission_nominatim_raw_json,
    null
  );
  const nominatimRaw = ticketNominatimRaw || submissionNominatimRaw;
  const locationText = [
    record.ticket_address || record.submission_address,
    record.ticket_postal_code || record.submission_postal_code,
    record.ticket_city || record.submission_city,
  ]
    .filter(Boolean)
    .join(', ');
  const roadHint = extractRoadResponsibilityHint({
    description,
    address: locationText,
    nominatimRaw,
  });

  const knowledge = await loadKnowledge();
  const categoryConfig = findCategoryConfig(knowledge, record.ticket_category);
  const categoryDescription = String(categoryConfig?.description || '').trim();
  const promptBase = await getSystemPrompt('workflowResponsibilityCheckPrompt');

  const prompt = `${promptBase}

ERLAUBTE ZUSTAENDIGKEITEN (verbindlich):
${allowedAuthorities.map((entry) => `- ${entry}`).join('\n')}

Ticket:
- ID: ${String(record.ticket_id || ticketId)}
- Kategorie: ${String(record.ticket_category || '')}
- Kategorie-Beschreibung: ${categoryDescription || 'n/a'}
- Prioritaet: ${String(record.ticket_priority || '')}
- Status: ${String(record.ticket_status || '')}
- Ort: ${locationText || 'n/a'}
- Beschreibung: ${description.slice(0, 2500)}
- KI-Bildbeschreibungen:
${imageContext}

Strassen-/OSM-Hinweise:
- roadClass: ${roadHint.roadClass}
- roadRef: ${roadHint.roadRef || 'n/a'}
- settlementHint: ${roadHint.settlementHint}
- nominatimCompact:
${buildNominatimCompactSummary(nominatimRaw)}

Regelhinweise Rheinland-Pfalz:
- Ortsgemeinde: primaer lokale Selbstverwaltungsaufgaben vor Ort.
- Verbandsgemeinde: fuehrt Verwaltungsgeschaefte fuer Ortsgemeinden und zustaendige ueberortliche Verwaltungsaufgaben.
- Landkreis: Kreisaufgaben sowie bestimmte Strassen-/Ordnungs-/Sonderzustaendigkeiten.
- Landesbehoerde: Fachbehoerden auf Landesebene (z. B. bei klassifizierten Strassen oder spezialgesetzlicher Zustaendigkeit).

Antworte ausschliesslich als JSON gemaess Schema.`.trim();

  const raw = await testAIProviderForTicketPrompt({
    prompt,
    purpose: 'workflow_responsibility_check',
    meta: {
      source: 'routes.workflows.responsibility_check',
      ticketId: record.ticket_id || ticketId,
    },
    ticket: record,
  });
  const parsed = extractJsonPayload(raw);
  const candidateAuthority =
    String(
      parsed?.responsibilityAuthority ||
        parsed?.authority ||
        parsed?.zustaendigkeit ||
        parsed?.responsibility ||
        ''
    ).trim();

  const categoryLower = normalizeResponsibilityAuthorityKey(record.ticket_category || '');
  const heuristicAuthorityRaw =
    roadHint.roadClass === 'bundesstrasse' || roadHint.roadClass === 'landesstrasse'
      ? 'Landesbehoerde'
    : roadHint.roadClass === 'kreisstrasse' && roadHint.settlementHint !== 'innerorts_hinweis'
      ? 'Landkreis'
    : categoryLower.includes('bundesstrass') || categoryLower.includes('bundesstraß')
      ? 'Landesbehoerde'
    : categoryLower.includes('landesstrass') || categoryLower.includes('landesstraß')
      ? 'Landesbehoerde'
    : categoryLower.includes('kreisstrass') || categoryLower.includes('kreisstraß')
      ? 'Landkreis'
    : categoryLower.includes('ortsgemeinde')
      ? 'Ortsgemeinde'
    : categoryLower.includes('verbandsgemeinde')
      ? 'Verbandsgemeinde'
      : categoryLower.includes('kreis')
      ? 'Landkreis'
      : '';

  const resolvedAuthority =
    resolveResponsibilityAuthorityFromAllowed(
      candidateAuthority,
      allowedAuthorities,
      record.ticket_responsibility_authority
    ) ||
    resolveResponsibilityAuthorityFromAllowed(heuristicAuthorityRaw, allowedAuthorities) ||
    resolveResponsibilityAuthorityFromAllowed(record.ticket_responsibility_authority, allowedAuthorities) ||
    allowedAuthorities[0];

  const confidenceRaw = Number(parsed?.confidence ?? parsed?.score ?? NaN);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : candidateAuthority
    ? 0.55
    : 0.35;
  const legalBasis = normalizeShortStringArray(parsed?.legalBasis, 5, 140);
  const notes = normalizeShortStringArray(parsed?.notes, 5, 180);
  const reasoning =
    String(parsed?.reasoning || '').trim() ||
    (candidateAuthority
      ? `Zustaendigkeit aus KI-Vorschlag uebernommen (${candidateAuthority}).`
      : 'Zustaendigkeit per Regel-Fallback aus Kategorie/Strassenhinweis abgeleitet.');

  return {
    ticket: record,
    suggestion: {
      responsibilityAuthority: resolvedAuthority,
      reasoning,
      confidence,
      legalBasis,
      notes,
    },
    rawDecision: parsed,
    allowedAuthorities,
  };
}

async function applyResponsibilitySuggestionToTicket(input: {
  ticketId: string;
  suggestion: {
    responsibilityAuthority: string;
    reasoning?: string;
    confidence?: number | null;
    legalBasis?: string[];
    notes?: string[];
  };
  source: string;
  executionId?: string | null;
  taskId?: string | null;
  commentVisibility?: 'internal' | 'public';
  addComment?: boolean;
}) {
  const db = getDatabase();
  const record = await db.get(
    `SELECT id, responsibility_authority
     FROM tickets
     WHERE id = ?
     LIMIT 1`,
    [input.ticketId]
  );
  if (!record) {
    throw Object.assign(new Error('Ticket nicht gefunden'), { status: 404 });
  }

  const allowedAuthorities = await loadAllowedResponsibilityAuthorities();
  const resolvedAuthority = resolveResponsibilityAuthorityFromAllowed(
    input.suggestion.responsibilityAuthority,
    allowedAuthorities,
    record.responsibility_authority
  );
  if (!resolvedAuthority) {
    throw Object.assign(
      new Error(
        `Ungueltige Zustaendigkeit. Erlaubt: ${allowedAuthorities.join(', ') || 'keine'}.`
      ),
      { status: 400 }
    );
  }

  await db.run(
    `UPDATE tickets
     SET responsibility_authority = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [resolvedAuthority, input.ticketId]
  );

  if (input.addComment !== false) {
    await appendTicketComment({
      ticketId: input.ticketId,
      executionId: input.executionId || null,
      taskId: input.taskId || null,
      authorType: 'ai',
      visibility: input.commentVisibility || 'internal',
      commentType: 'decision',
      content: `Zustaendigkeit gesetzt: "${resolvedAuthority}".`,
      metadata: {
        source: input.source,
        previousAuthority: record.responsibility_authority || null,
        authority: resolvedAuthority,
        confidence:
          Number.isFinite(Number(input.suggestion.confidence))
            ? Math.max(0, Math.min(1, Number(input.suggestion.confidence)))
            : null,
        reasoning: String(input.suggestion.reasoning || '').trim() || null,
        legalBasis: Array.isArray(input.suggestion.legalBasis)
          ? input.suggestion.legalBasis.slice(0, 5)
          : [],
        notes: Array.isArray(input.suggestion.notes) ? input.suggestion.notes.slice(0, 5) : [],
      },
    });
  }

  publishTicketUpdate({
    reason: 'ticket.responsibility.updated',
    ticketId: input.ticketId,
  });

  return {
    ticketId: input.ticketId,
    previousAuthority: record.responsibility_authority || null,
    responsibilityAuthority: resolvedAuthority,
    changed: String(record.responsibility_authority || '') !== resolvedAuthority,
  };
}

async function applyCategorizationSuggestionToTicket(input: {
  ticketId: string;
  suggestion: {
    category: string;
    priority: string;
    reasoning?: string;
    categoryId?: string;
  };
  rawDecision?: any;
  knowledgeVersion?: string | null;
  source: string;
  executionId?: string;
  taskId?: string;
  commentVisibility?: 'internal' | 'public';
}) {
  const db = getDatabase();
  const record = await db.get(
    `SELECT t.id as ticket_id,
            t.submission_id,
            t.category as ticket_category,
            t.status as ticket_status,
            t.description as ticket_description,
            t.latitude as ticket_latitude,
            t.longitude as ticket_longitude,
            t.address as ticket_address,
            t.postal_code as ticket_postal_code,
            t.city as ticket_city,
            s.anonymized_text as submission_anonymized_text,
            s.original_description as submission_original_description
     FROM tickets t
     LEFT JOIN submissions s ON s.id = t.submission_id
     WHERE t.id = ?
     LIMIT 1`,
    [input.ticketId]
  );
  if (!record) {
    throw Object.assign(new Error('Ticket nicht gefunden'), { status: 404 });
  }

  const knowledge = await loadKnowledge();
  const category = resolveKnownCategoryName(
    knowledge,
    input.suggestion?.category,
    String(record.ticket_category || '').trim() || 'Sonstiges'
  );
  const priority = normalizeWorkflowPriority(input.suggestion?.priority, 'medium');
  const reasoning = String(input.suggestion?.reasoning || '').trim();
  const currentStatus = String(record.ticket_status || '').trim().toLowerCase();
  const nextStatus =
    currentStatus === 'pending_validation' || currentStatus === 'pending'
      ? 'open'
      : currentStatus || 'open';
  const sourceDescription =
    String(record.submission_anonymized_text || '').trim() ||
    String(record.submission_original_description || '').trim() ||
    String(record.ticket_description || '').trim();
  const descriptionWithAnalysis = appendAiReasoningToDescription(
    sourceDescription || null,
    reasoning || null
  );

  await db.run(
    `UPDATE tickets SET
      category = ?,
      priority = ?,
      description = ?,
      status = ?,
      latitude = ?,
      longitude = ?,
      address = ?,
      postal_code = ?,
      city = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      category,
      priority,
      descriptionWithAnalysis || null,
      nextStatus,
      record.ticket_latitude ?? null,
      record.ticket_longitude ?? null,
      record.ticket_address || null,
      record.ticket_postal_code || null,
      record.ticket_city || null,
      input.ticketId,
    ]
  );

  if (record.submission_id) {
    await db.run(
      `UPDATE submissions
       SET category = ?, priority = ?, status = 'completed', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [category, priority, record.submission_id]
    );
  }

  await db.run(
    `INSERT INTO ai_logs (
      id, ticket_id, submission_id, knowledge_version,
      ai_decision, ai_reasoning, original_category,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      uuidv4(),
      input.ticketId,
      record.submission_id || '',
      input.knowledgeVersion || null,
      JSON.stringify(input.rawDecision || input.suggestion || {}),
      reasoning || null,
      category,
    ]
  );

  await appendTicketComment({
    ticketId: input.ticketId,
    executionId: input.executionId || null,
    taskId: input.taskId || null,
    authorType: 'ai',
    visibility: input.commentVisibility || 'internal',
    commentType: 'classification',
    content: `Ticket klassifiziert: Kategorie "${category}", Priorität "${priority}".`,
    metadata: {
      source: input.source,
      reasoning: reasoning || null,
      categoryId: input.suggestion?.categoryId || null,
      statusAfter: nextStatus,
    },
  });

  publishTicketUpdate({
    reason: 'ticket.categorized',
    ticketId: input.ticketId,
  });

  return {
    ticketId: input.ticketId,
    category,
    priority,
    status: nextStatus,
    reasoning,
  };
}

function completeActiveWorkflowsForTicket(input: {
  ticketId: string;
  reason: string;
  excludeExecutionId?: string | null;
}): number {
  const executions = loadExecutions();
  const nowIso = new Date().toISOString();
  let changed = false;
  let closed = 0;

  executions.forEach((execution) => {
    if (execution.ticketId !== input.ticketId) return;
    if (execution.status === 'COMPLETED' || execution.status === 'FAILED') return;
    if (input.excludeExecutionId && execution.id === input.excludeExecutionId) return;

    execution.tasks.forEach((task) => {
      clearScheduledTask(execution.id, task.id);
      if (task.status === 'RUNNING' || task.status === 'PENDING') {
        setTaskStatus(execution, task, 'SKIPPED', 'Workflow wurde wegen Kategorisierungsübergang beendet.');
      }
    });

    execution.activeTaskIds = [];
    syncCurrentTaskIndex(execution);
    execution.completedAt = nowIso;
    delete execution.error;
    setWorkflowStatus(execution, 'COMPLETED', input.reason, {
      metadata: {
        source: 'categorization_transition',
      },
    });
    appendWorkflowHistory(execution, 'WORKFLOW_COMPLETED', input.reason, {
      metadata: {
        source: 'categorization_transition',
      },
    });
    closed += 1;
    changed = true;
  });

  if (changed) {
    saveExecutions(executions);
  }
  return closed;
}

type WorkflowEmailRecipientSource =
  | 'manual'
  | 'org_unit'
  | 'ticket_primary_assignee'
  | 'ticket_collaborators';

function normalizeWorkflowRecipientEmailSource(value: unknown): WorkflowEmailRecipientSource {
  const normalized = asTrimmedString(value).toLowerCase();
  if (normalized === 'org_unit') return 'org_unit';
  if (normalized === 'ticket_primary_assignee') return 'ticket_primary_assignee';
  if (normalized === 'ticket_collaborators') return 'ticket_collaborators';
  return 'manual';
}

function normalizeWorkflowEmailAddress(value: unknown): string {
  const email = asTrimmedString(value).toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

async function resolveTicketPrimaryAssigneeRecipient(input: {
  ticketId: string;
}): Promise<{ recipientEmails: string[]; recipientName: string }> {
  const ticketId = asTrimmedString(input.ticketId);
  if (!ticketId) return { recipientEmails: [], recipientName: '' };
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT t.primary_assignee_user_id,
            t.primary_assignee_org_unit_id,
            COALESCE(au.active, 1) AS user_active,
            au.email AS user_email,
            au.first_name AS user_first_name,
            au.last_name AS user_last_name,
            au.username AS user_username,
            ou.contact_email AS org_email,
            ou.name AS org_name
     FROM tickets t
     LEFT JOIN admin_users au ON au.id = t.primary_assignee_user_id
     LEFT JOIN org_units ou ON ou.id = t.primary_assignee_org_unit_id
     WHERE t.id = ?
     LIMIT 1`,
    [ticketId]
  );
  if (!row) return { recipientEmails: [], recipientName: '' };

  const userActive = Number(row.user_active ?? 1) === 1;
  const userEmail = userActive ? normalizeWorkflowEmailAddress(row.user_email) : '';
  if (userEmail) {
    const userName =
      [asTrimmedString(row.user_first_name), asTrimmedString(row.user_last_name)].filter(Boolean).join(' ') ||
      asTrimmedString(row.user_username) ||
      'Primär zugewiesen';
    return {
      recipientEmails: [userEmail],
      recipientName: userName,
    };
  }

  const orgEmail = normalizeWorkflowEmailAddress(row.org_email);
  if (orgEmail) {
    return {
      recipientEmails: [orgEmail],
      recipientName: asTrimmedString(row.org_name) || 'Primär zugewiesene Organisationseinheit',
    };
  }

  return { recipientEmails: [], recipientName: '' };
}

async function resolveTicketCollaboratorRecipients(input: {
  ticketId: string;
  tenantId?: string | null;
}): Promise<{ recipientEmails: string[]; recipientName: string }> {
  const ticketId = asTrimmedString(input.ticketId);
  if (!ticketId) return { recipientEmails: [], recipientName: '' };
  const db = getDatabase();
  const tenantId = asTrimmedString(input.tenantId);
  const rows = await db.all<any>(
    `SELECT tc.user_id,
            tc.org_unit_id,
            COALESCE(au.active, 1) AS user_active,
            au.email AS user_email,
            ou.contact_email AS org_email
     FROM ticket_collaborators tc
     LEFT JOIN admin_users au ON au.id = tc.user_id
     LEFT JOIN org_units ou ON ou.id = tc.org_unit_id
     WHERE tc.ticket_id = ?
       ${tenantId ? 'AND tc.tenant_id = ?' : ''}
     ORDER BY tc.created_at ASC`,
    tenantId ? [ticketId, tenantId] : [ticketId]
  );

  const emailSet = new Set<string>();
  for (const row of rows || []) {
    const userActive = Number(row?.user_active ?? 1) === 1;
    if (userActive) {
      const userEmail = normalizeWorkflowEmailAddress(row?.user_email);
      if (userEmail) emailSet.add(userEmail);
    }
    const orgEmail = normalizeWorkflowEmailAddress(row?.org_email);
    if (orgEmail) emailSet.add(orgEmail);
  }

  return {
    recipientEmails: Array.from(emailSet),
    recipientName: 'Beteiligte am Ticket',
  };
}

async function resolveConfiguredOrgUnitRecipient(
  config: Record<string, any>,
  options?: { tenantId?: string | null; ticketId?: string | null }
): Promise<{
  recipientEmail: string;
  recipientEmails: string[];
  recipientName: string;
  recipientSource: WorkflowEmailRecipientSource;
  recipientOrgUnitId: string | null;
}> {
  const manualEmail = normalizeWorkflowEmailAddress(config?.recipientEmail);
  const manualName = asTrimmedString(config?.recipientName);
  const requestedSource = normalizeWorkflowRecipientEmailSource(config?.recipientEmailSource);
  const requestedOrgUnitId = asTrimmedString(config?.recipientOrgUnitId);
  const ticketId = asTrimmedString(options?.ticketId);
  const tenantId = asTrimmedString(options?.tenantId);

  if (requestedSource === 'ticket_primary_assignee') {
    const resolved = ticketId
      ? await resolveTicketPrimaryAssigneeRecipient({ ticketId })
      : { recipientEmails: [], recipientName: '' };
    return {
      recipientEmail: resolved.recipientEmails[0] || '',
      recipientEmails: resolved.recipientEmails,
      recipientName: resolved.recipientName || manualName,
      recipientSource: 'ticket_primary_assignee',
      recipientOrgUnitId: null,
    };
  }

  if (requestedSource === 'ticket_collaborators') {
    const resolved = ticketId
      ? await resolveTicketCollaboratorRecipients({ ticketId, tenantId })
      : { recipientEmails: [], recipientName: '' };
    return {
      recipientEmail: resolved.recipientEmails[0] || '',
      recipientEmails: resolved.recipientEmails,
      recipientName: resolved.recipientName || manualName,
      recipientSource: 'ticket_collaborators',
      recipientOrgUnitId: null,
    };
  }

  if (requestedSource === 'org_unit') {
    if (!requestedOrgUnitId) {
      return {
        recipientEmail: '',
        recipientEmails: [],
        recipientName: '',
        recipientSource: 'org_unit',
        recipientOrgUnitId: null,
      };
    }
    const db = getDatabase();
    const orgRow = await db.get<any>(
      `SELECT id, tenant_id, name, contact_email
       FROM org_units
       WHERE id = ?
         ${tenantId ? 'AND tenant_id = ?' : ''}
       LIMIT 1`,
      tenantId ? [requestedOrgUnitId, tenantId] : [requestedOrgUnitId]
    );

    if (!orgRow?.id) {
      return {
        recipientEmail: '',
        recipientEmails: [],
        recipientName: '',
        recipientSource: 'org_unit',
        recipientOrgUnitId: requestedOrgUnitId,
      };
    }

    const orgEmail = normalizeWorkflowEmailAddress(orgRow?.contact_email);
    const orgName = asTrimmedString(orgRow?.name);
    return {
      recipientEmail: orgEmail,
      recipientEmails: orgEmail ? [orgEmail] : [],
      recipientName: manualName || orgName,
      recipientSource: 'org_unit',
      recipientOrgUnitId: requestedOrgUnitId,
    };
  }

  return {
    recipientEmail: manualEmail,
    recipientEmails: manualEmail ? [manualEmail] : [],
    recipientName: manualName,
    recipientSource: 'manual',
    recipientOrgUnitId: null,
  };
}

async function executeExternalEmailTask(execution: WorkflowExecution, task: WorkflowTask) {
  const knowledge = await loadKnowledge();
  const { ticket, description, address, locationText, coordinates } = await loadTicketContext(execution);
  const categoryConfig = findCategoryConfig(knowledge, ticket.category);

  const configuredRecipient = await resolveConfiguredOrgUnitRecipient(task.config || {}, {
    tenantId: ticket?.tenant_id || null,
    ticketId: ticket?.id || execution.ticketId,
  });
  let recipientEmails = Array.isArray(configuredRecipient.recipientEmails)
    ? configuredRecipient.recipientEmails.filter(Boolean)
    : [];
  let recipientEmail = recipientEmails[0] || configuredRecipient.recipientEmail || '';
  let recipientName = configuredRecipient.recipientName || '';

  if (!recipientEmail && configuredRecipient.recipientSource === 'manual' && categoryConfig) {
    const categoryEmail =
      categoryConfig.externalRecipientEmail || categoryConfig.recipientEmail || '';
    if (categoryEmail) {
      recipientEmail = categoryEmail;
      recipientEmails = [categoryEmail];
      recipientName =
        categoryConfig.externalRecipientName ||
        categoryConfig.recipientName ||
        recipientName;
    }
  }

  if (!recipientEmails.length && recipientEmail) {
    recipientEmails = [recipientEmail];
  }
  const recipientEmailList = recipientEmails.join(', ');
  if (recipientEmailList) {
    recipientEmail = recipientEmailList;
  }

  if (!recipientEmail && configuredRecipient.recipientSource === 'org_unit') {
    throw new Error('Die gewählte Organisationseinheit hat keine Kontakt-E-Mail.');
  }
  if (!recipientEmail && configuredRecipient.recipientSource === 'ticket_primary_assignee') {
    throw new Error('Für die Primär-Zuweisung ist keine Empfänger-E-Mail vorhanden.');
  }
  if (!recipientEmail && configuredRecipient.recipientSource === 'ticket_collaborators') {
    throw new Error('Für die Beteiligten sind keine Empfänger-E-Mails vorhanden.');
  }

  if (!recipientEmail) {
    throw new Error('Kein Empfaenger fuer E-Mail-Weiterleitung konfiguriert');
  }

  const templateData = buildWorkflowEmailTemplateData({
    ticket,
    description,
    address,
    locationText,
    coordinates,
    recipientName,
    recipientEmail,
  });

  const categoryTemplateId = categoryConfig?.id ? `template-${categoryConfig.id}` : '';
  const templateId =
    !task.config?.templateId || task.config.templateId === 'auto'
      ? categoryTemplateId || 'external-notification'
      : task.config.templateId;
  const template = await loadTemplateFile(templateId, asTrimmedString(ticket?.tenant_id));
  const fallback = buildDefaultExternalHtml(templateData);

  const subject = template ? renderTemplate(template.subject, templateData) : fallback.subject;
  const html = template
    ? renderTemplate(template.htmlContent, templateData)
    : fallback.html;
  const text = template
    ? renderTemplate(template.textContent || htmlToPlainText(html), templateData)
    : fallback.text;
  const htmlWithReporter = appendReporterContextToEmailHtml(html, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });
  const textWithReporter = appendReporterContextToPlainText(text, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });

  const sent = await sendEmail({
    to: recipientEmail,
    subject,
    html: htmlWithReporter,
    text: textWithReporter,
    translateForCitizen: false,
  });

  if (!sent) {
    throw new Error('E-Mail konnte nicht versendet werden');
  }

  return {
    recipientEmail,
    recipientEmails,
    recipientName,
    templateId,
  };
}

function resolveConfirmationRejectTaskIds(execution: WorkflowExecution, task: WorkflowTask): string[] {
  return resolveConfiguredTaskIdsFromConfig(
    execution,
    task.config?.rejectNextTaskIds ?? task.config?.rejectNextTaskId
  );
}

function resolveMayorInvolvementMode(task: WorkflowTask): 'notify' | 'approval' {
  const raw = String(task.config?.mode || task.config?.operationMode || '').trim().toLowerCase();
  if (raw === 'approval' || raw === 'consent' || raw === 'ask' || raw === 'request_approval') {
    return 'approval';
  }
  return 'notify';
}

async function generateConfirmationInstructionText(input: {
  ticket: any;
  description: string;
  locationText: string;
  imageContext?: string;
  workflowTitle?: string;
  stepTitle?: string;
  instructionPrompt: string;
}): Promise<string> {
  const promptBase = await getSystemPrompt('workflowConfirmationInstructionPrompt');
  const prompt = `${promptBase}

Workflow:
- Titel: ${input.workflowTitle || 'Unbekannt'}
- Schritt: ${input.stepTitle || 'Unbekannt'}

Ticket:
- ID: ${String(input.ticket?.id || '')}
- Kategorie: ${String(input.ticket?.category || '')}
- Status: ${String(input.ticket?.status || '')}
- Ort: ${String(input.locationText || '')}
- Meldende Person: ${String(input.ticket?.citizen_name || '')} (${String(input.ticket?.citizen_email || '')})

Beschreibung:
${String(input.description || '').trim() || 'Keine Beschreibung vorhanden.'}

KI-Bildbeschreibungen:
${String(input.imageContext || 'Keine KI-Bildbeschreibungen vorhanden.')}

Anforderung für die Anweisung:
${input.instructionPrompt}

Antwort:`;

  const response = await testAIProviderForTicketPrompt({
    prompt,
    purpose: 'workflow_confirmation_instruction',
    meta: {
      source: 'routes.workflows.confirmation_instruction',
      ticketId: input.ticket?.id || null,
    },
    ticket: input.ticket,
  });

  return String(response || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
}

async function executeConfirmationEmailTask(execution: WorkflowExecution, task: WorkflowTask) {
  const { ticket, description, address, locationText, coordinates, imageContext } = await loadTicketContext(execution);

  const recipientType = task.config?.recipientType || 'citizen';
  let recipientEmails: string[] = [];
  let recipientEmail = '';
  let recipientName = '';

  if (recipientType === 'custom') {
    const configuredRecipient = await resolveConfiguredOrgUnitRecipient(task.config || {}, {
      tenantId: ticket?.tenant_id || null,
      ticketId: ticket?.id || execution.ticketId,
    });
    recipientEmails = Array.isArray(configuredRecipient.recipientEmails)
      ? configuredRecipient.recipientEmails.filter(Boolean)
      : [];
    recipientEmail = recipientEmails[0] || configuredRecipient.recipientEmail || '';
    recipientName = configuredRecipient.recipientName || '';
    if (!recipientEmail && configuredRecipient.recipientSource === 'org_unit') {
      throw new Error('Die gewählte Organisationseinheit hat keine Kontakt-E-Mail.');
    }
    if (!recipientEmail && configuredRecipient.recipientSource === 'ticket_primary_assignee') {
      throw new Error('Für die Primär-Zuweisung ist keine Empfänger-E-Mail vorhanden.');
    }
    if (!recipientEmail && configuredRecipient.recipientSource === 'ticket_collaborators') {
      throw new Error('Für die Beteiligten sind keine Empfänger-E-Mails vorhanden.');
    }
  } else {
    recipientEmail = ticket.citizen_email || '';
    recipientName = ticket.citizen_name || '';
    recipientEmails = recipientEmail ? [recipientEmail] : [];
  }

  if (!recipientEmails.length && recipientEmail) {
    recipientEmails = [recipientEmail];
  }
  if (recipientEmails.length > 1) {
    recipientEmail = recipientEmails.join(', ');
  }

  if (!recipientEmail) {
    throw new Error('Kein Empfaenger fuer die Bestaetigung konfiguriert');
  }

  const validationToken = crypto.randomBytes(32).toString('hex');
  const { values: generalSettings } = await loadGeneralSettings();
  const fallbackHours =
    Number(generalSettings.citizenFrontend?.emailDoubleOptInTimeoutHours) > 0
      ? Number(generalSettings.citizenFrontend?.emailDoubleOptInTimeoutHours)
      : DEFAULT_EMAIL_APPROVAL_TIMEOUT_HOURS;
  const timeoutMs = resolveStepTimeoutMs(task.config || {}, fallbackHours || WORKFLOW_VALIDATION_EXPIRY_HOURS);
  const expiresAt = new Date(Date.now() + timeoutMs);

  const db = getDatabase();
  await db.run(
    `INSERT INTO workflow_validations (id, execution_id, task_id, ticket_id, recipient_email, validation_token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      `wv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      execution.id,
      task.id,
      ticket.id,
      recipientEmail,
      validationToken,
      toSqlDateTime(expiresAt),
    ]
  );

  const statusToken = await ensureTicketStatusToken(db, ticket);
  const statusLink = buildTicketStatusCallbackLink(generalSettings.callbackUrl, {
    token: statusToken,
  });
  const isDoubleOptIn = task.type === 'EMAIL_DOUBLE_OPT_IN';
  let decisionPageLink = '';
  let approveLink = '';
  let rejectLink = '';
  if (isDoubleOptIn) {
    // DOI should use legacy-style callback page (/verify) and auto-apply the workflow decision.
    const doiCallbackBaseParams = {
      token: validationToken,
      cb: 'workflow_confirmation',
      mode: 'doi',
      statusToken,
    };
    decisionPageLink = buildCallbackLink(generalSettings.callbackUrl, {
      ...doiCallbackBaseParams,
      decision: 'approve',
    });
    approveLink = buildCallbackLink(generalSettings.callbackUrl, {
      ...doiCallbackBaseParams,
      decision: 'approve',
    });
    rejectLink = buildCallbackLink(generalSettings.callbackUrl, {
      ...doiCallbackBaseParams,
      decision: 'reject',
    });
  } else {
    decisionPageLink = buildWorkflowConfirmationCallbackLink(generalSettings.callbackUrl, {
      token: validationToken,
    });
    approveLink = buildWorkflowConfirmationCallbackLink(generalSettings.callbackUrl, {
      token: validationToken,
      decision: 'approve',
    });
    rejectLink = buildWorkflowConfirmationCallbackLink(generalSettings.callbackUrl, {
      token: validationToken,
      decision: 'reject',
    });
  }

  const configuredInstructionText =
    typeof task.config?.instructionText === 'string' ? task.config.instructionText.trim() : '';
  const configuredInstructionAiPrompt =
    typeof task.config?.instructionAiPrompt === 'string' ? task.config.instructionAiPrompt.trim() : '';

  let approvalInstruction = configuredInstructionText;
  if (configuredInstructionAiPrompt) {
    try {
      const generatedInstruction = await generateConfirmationInstructionText({
        ticket,
        description,
        locationText,
        imageContext,
        workflowTitle: execution.title,
        stepTitle: task.title,
        instructionPrompt: configuredInstructionAiPrompt,
      });
      if (generatedInstruction) {
        approvalInstruction = generatedInstruction;
      }
    } catch (error) {
      console.warn('Workflow confirmation instruction generation failed:', error);
    }
  }

  const rejectNextTaskIds = resolveConfirmationRejectTaskIds(execution, task);
  const templateData = buildWorkflowEmailTemplateData({
    ticket,
    description,
    address,
    locationText,
    coordinates,
    recipientName,
    recipientEmail,
    validationLink: approveLink,
    statusLink,
    approveLink,
    rejectLink,
    decisionPageLink,
    approvalInstruction,
    workflowTitle: execution.title,
    workflowStepTitle: task.title,
  });

  const templateId = task.config?.templateId || 'workflow-confirmation';
  const template = await loadTemplateFile(templateId, asTrimmedString(ticket?.tenant_id));
  const fallback = buildDefaultConfirmationHtml(templateData);
  const subject = template ? renderTemplate(template.subject, templateData) : fallback.subject;
  const html = template ? renderTemplate(template.htmlContent, templateData) : fallback.html;
  const text = template
    ? renderTemplate(template.textContent || htmlToPlainText(html), templateData)
    : fallback.text;
  const htmlWithReporter = appendReporterContextToEmailHtml(html, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });
  const textWithReporter = appendReporterContextToPlainText(text, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });

  const sent = await sendEmail({
    to: recipientEmail,
    subject,
    html: htmlWithReporter,
    text: textWithReporter,
    translateForCitizen: recipientType !== 'custom',
  });

  if (!sent) {
    throw new Error('Bestaetigungs-E-Mail konnte nicht versendet werden');
  }

  await appendTicketComment({
    ticketId: execution.ticketId,
    executionId: execution.id,
    taskId: task.id,
    authorType: 'system',
    visibility: 'internal',
    commentType: 'decision',
    content:
      isDoubleOptIn
        ? `E-Mail Double Opt-In an ${recipientEmail} versendet.`
        : `Freigabe-E-Mail an ${recipientEmail} versendet.`,
    metadata: {
      decisionPageLink,
      expiresAt: expiresAt.toISOString(),
      taskType: task.type,
    },
  });

  return {
    awaitingConfirmation: true,
    awaitingUntil: expiresAt.toISOString(),
    validationToken,
    recipientEmail,
    recipientEmails,
    recipientName,
    templateId,
    statusToken,
    statusLink,
    decisionPageLink,
    approvalInstruction,
    rejectNextTaskIds,
    timeoutBehavior: 'reject',
  };
}

async function executeMayorInvolvementTask(execution: WorkflowExecution, task: WorkflowTask) {
  const { ticket, description, address, locationText, coordinates } = await loadTicketContext(execution);
  const mode = resolveMayorInvolvementMode(task);
  const settings = await loadMunicipalContactsSettings();
  const contactResolution = resolveMunicipalContactForTicket({
    ticket: {
      postalCode: ticket.postal_code,
      city: ticket.city,
      submissionPostalCode: ticket.submission_postal_code,
      submissionCity: ticket.submission_city,
    },
    settings,
  });

  const recipientEmail = String(contactResolution.recipientEmail || '').trim();
  if (!recipientEmail) {
    throw new Error(
      'Kein kommunaler Ansprechpartner mit gueltiger E-Mail-Adresse gefunden. Bitte in den Einstellungen "Kommunale Ansprechpartner" pflegen.'
    );
  }

  const recipientName =
    String(contactResolution.recipientName || '').trim() || 'Ortsbuergermeister';
  const db = getDatabase();
  const statusToken = await ensureTicketStatusToken(db, ticket);
  const { values: generalSettings } = await loadGeneralSettings();
  const statusLink = buildTicketStatusCallbackLink(generalSettings.callbackUrl, {
    token: statusToken,
  });

  const configuredQuestion =
    typeof task.config?.approvalQuestion === 'string' ? task.config.approvalQuestion.trim() : '';
  const approvalInstruction = configuredQuestion || DEFAULT_MAYOR_APPROVAL_QUESTION;
  const defaultTemplateId =
    mode === 'approval'
      ? 'workflow-mayor-involvement-approval'
      : 'workflow-mayor-involvement-notify';
  const templateId =
    typeof task.config?.templateId === 'string' && task.config.templateId.trim()
      ? task.config.templateId.trim()
      : defaultTemplateId;
  const mayorLocationValue =
    contactResolution.matchedEntry?.locationValue ||
    String(
      ticket.postal_code ||
        ticket.submission_postal_code ||
        ticket.city ||
        ticket.submission_city ||
        ''
    );
  const mayorLocationType =
    contactResolution.source === 'postal_code'
      ? 'PLZ'
      : contactResolution.source === 'city'
      ? 'Ort'
      : 'Fallback';

  if (mode === 'notify') {
    const templateData = {
      ...buildWorkflowEmailTemplateData({
        ticket,
        description,
        address,
        locationText,
        coordinates,
        recipientName,
        recipientEmail,
        statusLink,
        approvalInstruction,
        workflowTitle: execution.title,
        workflowStepTitle: task.title,
      }),
      mayorName: recipientName,
      mayorEmail: recipientEmail,
      mayorContactSource: contactResolution.source,
      mayorLocationType,
      mayorLocationValue: String(mayorLocationValue || ''),
    };
    const template = await loadTemplateFile(templateId, asTrimmedString(ticket?.tenant_id));
    const fallback = buildDefaultMayorNotifyHtml(templateData);
    const subject = template ? renderTemplate(template.subject, templateData) : fallback.subject;
    const html = template ? renderTemplate(template.htmlContent, templateData) : fallback.html;
    const text = template
      ? renderTemplate(template.textContent || htmlToPlainText(html), templateData)
      : fallback.text;
    const htmlWithReporter = appendReporterContextToEmailHtml(html, {
      citizenName: ticket.citizen_name || '',
      citizenEmail: ticket.citizen_email || '',
    });
    const textWithReporter = appendReporterContextToPlainText(text, {
      citizenName: ticket.citizen_name || '',
      citizenEmail: ticket.citizen_email || '',
    });

    const sent = await sendEmail({
      to: recipientEmail,
      subject,
      html: htmlWithReporter,
      text: textWithReporter,
      translateForCitizen: false,
    });
    if (!sent) {
      throw new Error('E-Mail an Ortsbuergermeister konnte nicht versendet werden');
    }

    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'system',
      visibility: 'internal',
      commentType: 'note',
      content: `Ortsbuergermeister wurde informiert (${recipientEmail}).`,
      metadata: {
        mode,
        templateId,
        recipientEmail,
        mayorContactSource: contactResolution.source,
        mayorLocationType,
        mayorLocationValue,
      },
    });

    return {
      mode,
      recipientEmail,
      recipientName,
      templateId,
      statusToken,
      statusLink,
      mayorContactSource: contactResolution.source,
      mayorLocationType,
      mayorLocationValue: String(mayorLocationValue || ''),
      usedDeputy: contactResolution.usedDeputy,
      approvalInstruction,
    };
  }

  const validationToken = crypto.randomBytes(32).toString('hex');
  const timeoutMs = resolveStepTimeoutMs(task.config || {}, DEFAULT_EMAIL_APPROVAL_TIMEOUT_HOURS);
  const expiresAt = new Date(Date.now() + timeoutMs);
  await db.run(
    `INSERT INTO workflow_validations (id, execution_id, task_id, ticket_id, recipient_email, validation_token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      `wv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      execution.id,
      task.id,
      ticket.id,
      recipientEmail,
      validationToken,
      toSqlDateTime(expiresAt),
    ]
  );

  const decisionPageLink = buildWorkflowConfirmationCallbackLink(generalSettings.callbackUrl, {
    token: validationToken,
  });
  const approveLink = buildWorkflowConfirmationCallbackLink(generalSettings.callbackUrl, {
    token: validationToken,
    decision: 'approve',
  });
  const rejectLink = buildWorkflowConfirmationCallbackLink(generalSettings.callbackUrl, {
    token: validationToken,
    decision: 'reject',
  });

  const rejectNextTaskIds = resolveConfirmationRejectTaskIds(execution, task);
  const templateData = {
    ...buildWorkflowEmailTemplateData({
      ticket,
      description,
      address,
      locationText,
      coordinates,
      recipientName,
      recipientEmail,
      validationLink: approveLink,
      statusLink,
      approveLink,
      rejectLink,
      decisionPageLink,
      approvalInstruction,
      workflowTitle: execution.title,
      workflowStepTitle: task.title,
    }),
    mayorName: recipientName,
    mayorEmail: recipientEmail,
    mayorContactSource: contactResolution.source,
    mayorLocationType,
    mayorLocationValue: String(mayorLocationValue || ''),
  };
  const template = await loadTemplateFile(templateId, asTrimmedString(ticket?.tenant_id));
  const fallback = buildDefaultMayorApprovalHtml(templateData);
  const subject = template ? renderTemplate(template.subject, templateData) : fallback.subject;
  const html = template ? renderTemplate(template.htmlContent, templateData) : fallback.html;
  const text = template
    ? renderTemplate(template.textContent || htmlToPlainText(html), templateData)
    : fallback.text;
  const htmlWithReporter = appendReporterContextToEmailHtml(html, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });
  const textWithReporter = appendReporterContextToPlainText(text, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });

  const sent = await sendEmail({
    to: recipientEmail,
    subject,
    html: htmlWithReporter,
    text: textWithReporter,
    translateForCitizen: false,
  });
  if (!sent) {
    throw new Error('Rueckfrage-E-Mail an Ortsbuergermeister konnte nicht versendet werden');
  }

  await appendTicketComment({
    ticketId: execution.ticketId,
    executionId: execution.id,
    taskId: task.id,
    authorType: 'system',
    visibility: 'internal',
    commentType: 'decision',
    content: `Rueckfrage an Ortsbuergermeister versendet (${recipientEmail}).`,
    metadata: {
      mode,
      templateId,
      decisionPageLink,
      approveLink,
      rejectLink,
      expiresAt: expiresAt.toISOString(),
      mayorContactSource: contactResolution.source,
      mayorLocationType,
      mayorLocationValue,
    },
  });

  return {
    awaitingConfirmation: true,
    awaitingUntil: expiresAt.toISOString(),
    validationToken,
    recipientEmail,
    recipientName,
    templateId,
    statusToken,
    statusLink,
    decisionPageLink,
    approveLink,
    rejectLink,
    approvalInstruction,
    rejectNextTaskIds,
    timeoutBehavior: 'reject',
    mode,
    mayorContactSource: contactResolution.source,
    mayorLocationType,
    mayorLocationValue: String(mayorLocationValue || ''),
    usedDeputy: contactResolution.usedDeputy,
  };
}

async function ensureTicketStatusToken(db: any, ticket: any): Promise<string> {
  if (ticket?.validation_token) {
    return String(ticket.validation_token);
  }

  const existing = await db.get(
    `SELECT validation_token FROM ticket_validations WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1`,
    [ticket.id]
  );

  if (existing?.validation_token) {
    await db.run(
      `UPDATE tickets SET validation_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [existing.validation_token, ticket.id]
    );
    return String(existing.validation_token);
  }

  const validationToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const validatedAt = ticket.status === 'pending_validation' ? null : toSqlDateTime(new Date());

  await db.run(
    `INSERT INTO ticket_validations (id, ticket_id, submission_id, citizen_email, validation_token, validated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      `val_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      ticket.id,
      ticket.submission_id || null,
      ticket.citizen_email || null,
      validationToken,
      validatedAt,
      toSqlDateTime(expiresAt),
    ]
  );
  await db.run(
    `UPDATE tickets SET validation_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [validationToken, ticket.id]
  );

  return validationToken;
}

async function applyLegacyDoubleOptInEffects(input: {
  db: any;
  execution: WorkflowExecution;
  task: WorkflowTask;
  ticket: any;
}): Promise<{
  statusToken: string;
  statusChanged: boolean;
  submissionConfirmationSent: boolean;
}> {
  const { db, execution, task, ticket } = input;
  const statusToken = await ensureTicketStatusToken(db, ticket);
  await db.run(
    `UPDATE ticket_validations
     SET validated_at = CURRENT_TIMESTAMP
     WHERE ticket_id = ? AND validated_at IS NULL`,
    [ticket.id]
  );

  const statusBefore = String(ticket?.status || '').trim().toLowerCase();
  let statusChanged = false;
  if (statusBefore === 'pending_validation') {
    const updateResult = await db.run(
      `UPDATE tickets
       SET status = 'pending',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending_validation'`,
      [ticket.id]
    );
    statusChanged = Number(updateResult?.changes || 0) > 0;
    if (ticket?.submission_id) {
      await db.run(
        `UPDATE submissions
         SET status = 'pending',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending_validation'`,
        [ticket.submission_id]
      );
    }
  }

  let submissionConfirmationSent = false;
  const sendLegacySubmissionConfirmation = task.config?.sendLegacySubmissionConfirmation !== false;
  if (sendLegacySubmissionConfirmation && ticket?.citizen_email) {
    submissionConfirmationSent = await sendSubmissionConfirmation(
      String(ticket.citizen_email),
      String(ticket.citizen_name || 'Bürger'),
      String(ticket.id),
      String(ticket.category || 'Sonstiges'),
      String(ticket.priority || 'medium'),
      statusToken
    );
  }

  const commentSegments = ['DOI-Freigabe bestätigt und als Ticket-Validierung übernommen.'];
  if (statusChanged) {
    commentSegments.push('Ticketstatus wurde von pending_validation auf pending gesetzt.');
  }
  if (sendLegacySubmissionConfirmation) {
    commentSegments.push(
      submissionConfirmationSent
        ? 'Bürger-Bestätigung (legacy Submission-Confirmation) wurde versendet.'
        : 'Bürger-Bestätigung (legacy Submission-Confirmation) konnte nicht versendet werden.'
    );
  }
  await appendTicketComment({
    ticketId: execution.ticketId,
    executionId: execution.id,
    taskId: task.id,
    authorType: 'system',
    visibility: 'internal',
    commentType: 'decision',
    content: commentSegments.join(' '),
    metadata: {
      source: 'workflow_doi_legacy_parity',
      statusBefore,
      statusAfter: statusChanged ? 'pending' : statusBefore,
      sendLegacySubmissionConfirmation,
      submissionConfirmationSent,
    },
  });

  appendWorkflowHistory(execution, 'TASK_DATA', 'DOI-Freigabe auf Legacy-Validierungsstatus abgebildet.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: {
      statusChanged,
      submissionConfirmationSent,
      sendLegacySubmissionConfirmation,
    },
  });

  publishTicketUpdate({
    reason: 'ticket.workflow.doi_approved',
    ticketId: execution.ticketId,
  });

  return {
    statusToken,
    statusChanged,
    submissionConfirmationSent,
  };
}

async function executeCitizenNotificationTask(execution: WorkflowExecution, task: WorkflowTask) {
  const { ticket, description, address, locationText, coordinates } = await loadTicketContext(execution);

  const recipientEmail = ticket.citizen_email || '';
  if (!recipientEmail) {
    throw new Error('Kein Bürger-Empfänger für Benachrichtigung verfügbar');
  }

  const recipientName = ticket.citizen_name || '';
  const db = getDatabase();
  const statusToken = await ensureTicketStatusToken(db, ticket);
  const { values: generalSettings } = await loadGeneralSettings();

  const validationLink = buildCallbackLink(generalSettings.callbackUrl, {
    token: statusToken,
    cb: 'ticket_validation',
  });
  const statusLink = buildTicketStatusCallbackLink(generalSettings.callbackUrl, {
    token: statusToken,
  });

  const customMessage =
    (typeof task.config?.customMessage === 'string' && task.config.customMessage.trim()) ||
    'Bitte bestätigen Sie Ihre Meldung und nutzen Sie den Status-Link für den weiteren Verlauf.';

  const templateData = buildWorkflowEmailTemplateData({
    ticket,
    description,
    address,
    locationText,
    coordinates,
    recipientName,
    recipientEmail,
    validationLink,
    statusLink,
    customMessage,
  });

  const templateId = task.config?.templateId || 'citizen-workflow-notification';
  const template = await loadTemplateFile(templateId, asTrimmedString(ticket?.tenant_id));
  const fallback = buildDefaultCitizenNotificationHtml(templateData);
  const subject = template ? renderTemplate(template.subject, templateData) : fallback.subject;
  const html = template ? renderTemplate(template.htmlContent, templateData) : fallback.html;
  const text = template
    ? renderTemplate(template.textContent || htmlToPlainText(html), templateData)
    : fallback.text;
  const htmlWithReporter = appendReporterContextToEmailHtml(html, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });
  const textWithReporter = appendReporterContextToPlainText(text, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });

  const sent = await sendEmail({
    to: recipientEmail,
    subject,
    html: htmlWithReporter,
    text: textWithReporter,
    translateForCitizen: true,
  });

  if (!sent) {
    throw new Error('Bürger-Benachrichtigung konnte nicht versendet werden');
  }

  return {
    recipientEmail,
    recipientName,
    templateId,
    validationLink,
    statusLink,
    customMessage,
  };
}

type DataRequestFieldType = 'yes_no' | 'single_choice' | 'number' | 'quantity' | 'short_text';

interface DataRequestFieldOption {
  value: string;
  label: string;
}

interface DataRequestField {
  key: string;
  label: string;
  type: DataRequestFieldType;
  required: boolean;
  options?: DataRequestFieldOption[];
}

interface CitizenTargetLanguage {
  code: string;
  name: string;
}

interface GeneratedDataRequestContent {
  fields: DataRequestField[];
  subject?: string;
  introText?: string;
}

interface StoredDataRequestPayload {
  fields: DataRequestField[];
  meta?: Record<string, any>;
}

interface DataRequestUiLocale {
  tokenMissing: string;
  loading: string;
  loadFailed: string;
  alreadySubmitted: string;
  requiredPrefix: string;
  submitSuccess: string;
  submitError: string;
  kicker: string;
  title: string;
  subtitle: string;
  ticket: string;
  category: string;
  priority: string;
  mode: string;
  cycle: string;
  modeParallel: string;
  modeBlocking: string;
  subjectFallback: string;
  selectPlaceholder: string;
  yes: string;
  no: string;
  send: string;
  sending: string;
  complete: string;
  back: string;
  typeYesNo: string;
  typeChoice: string;
  typeNumber: string;
  typeQuantity: string;
  typeText: string;
  requiredHint: string;
  answerPlaceholder: string;
}

const DATA_REQUEST_UI_LOCALE_DE: DataRequestUiLocale = {
  tokenMissing: 'Kein Token gefunden.',
  loading: 'Datennachforderung wird geladen...',
  loadFailed: 'Datennachforderung konnte nicht geladen werden.',
  alreadySubmitted: 'Die Antworten wurden bereits übermittelt.',
  requiredPrefix: 'Bitte Pflichtfelder ausfüllen:',
  submitSuccess: 'Vielen Dank. Die Angaben wurden gespeichert.',
  submitError: 'Antworten konnten nicht gespeichert werden.',
  kicker: 'Workflow',
  title: 'Datennachforderung',
  subtitle: 'Bitte ergänzen Sie die fehlenden Angaben zu Ihrer Meldung.',
  ticket: 'Ticket',
  category: 'Kategorie',
  priority: 'Priorität',
  mode: 'Modus',
  cycle: 'Zyklus',
  modeParallel: 'Parallel (Workflow läuft weiter)',
  modeBlocking: 'Blockierend',
  subjectFallback: 'Rückfragen zur Meldung',
  selectPlaceholder: 'Bitte wählen',
  yes: 'Ja',
  no: 'Nein',
  send: 'Antworten senden',
  sending: 'Wird übermittelt...',
  complete: 'Datennachforderung abgeschlossen.',
  back: 'Zurück zum Formular',
  typeYesNo: 'Ja/Nein',
  typeChoice: 'Auswahl',
  typeNumber: 'Zahl',
  typeQuantity: 'Menge',
  typeText: 'Freitext',
  requiredHint: 'Pflichtfeld',
  answerPlaceholder: 'Ihre Antwort',
};

const DATA_REQUEST_UI_LOCALE_EN: DataRequestUiLocale = {
  tokenMissing: 'No token found.',
  loading: 'Loading data request...',
  loadFailed: 'Could not load data request.',
  alreadySubmitted: 'Answers have already been submitted.',
  requiredPrefix: 'Please complete required fields:',
  submitSuccess: 'Thank you. Your answers were saved.',
  submitError: 'Could not save answers.',
  kicker: 'Workflow',
  title: 'Data Request',
  subtitle: 'Please provide the missing details for your report.',
  ticket: 'Ticket',
  category: 'Category',
  priority: 'Priority',
  mode: 'Mode',
  cycle: 'Cycle',
  modeParallel: 'Parallel (workflow continues)',
  modeBlocking: 'Blocking',
  subjectFallback: 'Follow-up questions for your report',
  selectPlaceholder: 'Please select',
  yes: 'Yes',
  no: 'No',
  send: 'Send answers',
  sending: 'Submitting...',
  complete: 'Data request completed.',
  back: 'Back to form',
  typeYesNo: 'Yes/No',
  typeChoice: 'Choice',
  typeNumber: 'Number',
  typeQuantity: 'Quantity',
  typeText: 'Text',
  requiredHint: 'Required',
  answerPlaceholder: 'Your answer',
};

const DATA_REQUEST_UI_LOCALE_KEYS = Object.keys(DATA_REQUEST_UI_LOCALE_DE) as Array<keyof DataRequestUiLocale>;
const DATA_REQUEST_UI_LOCALE_DE_MAP: Record<string, string> = {
  ...DATA_REQUEST_UI_LOCALE_DE,
};

function resolveCitizenTargetLanguage(ticket: any): CitizenTargetLanguage {
  const codeRaw = String(ticket?.citizen_preferred_language || '').trim().toLowerCase();
  const nameRaw = String(ticket?.citizen_preferred_language_name || '').trim();
  if (!codeRaw || codeRaw === 'de' || codeRaw.startsWith('de-')) {
    return { code: 'de', name: 'Deutsch' };
  }
  return {
    code: codeRaw,
    name: nameRaw || codeRaw,
  };
}

type DataRequestAiKind = 'enhanced' | 'free';

function isAiDataRequestTaskType(type: WorkflowStepType): boolean {
  return type === 'ENHANCED_CATEGORIZATION' || type === 'FREE_AI_DATA_REQUEST';
}

function resolveDataRequestAiKind(task: WorkflowTask | null | undefined): DataRequestAiKind | null {
  if (!task) return null;
  if (task.type === 'ENHANCED_CATEGORIZATION') return 'enhanced';
  if (task.type === 'FREE_AI_DATA_REQUEST') return 'free';
  return null;
}

function resolveAiDataRequestMaxQuestions(task: WorkflowTask): number {
  const raw = Number(task.config?.maxQuestionsPerCycle ?? task.config?.maxQuestionCount);
  if (!Number.isFinite(raw)) return 5;
  return Math.max(1, Math.min(25, Math.floor(raw)));
}

function resolveAiDataRequestMaxCycles(task: WorkflowTask): number {
  if (!isAiDataRequestTaskType(task.type)) return 1;
  if (task.config?.allowFollowUpCycles !== true) return 1;
  const raw = Number(task.config?.maxFollowUpCycles ?? task.config?.maxQuestionCycles);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(1, Math.min(8, Math.floor(raw)));
}

function resolveFreeDataRequestNeedCheckConfidenceThreshold(task: WorkflowTask): number {
  const raw = Number(task.config?.needCheckConfidenceThreshold ?? task.config?.confidenceThreshold);
  if (!Number.isFinite(raw)) return 0.82;
  return Math.max(0, Math.min(1, raw));
}

function resolveEnhancedDataRequestMaxQuestions(task: WorkflowTask): number {
  return resolveAiDataRequestMaxQuestions(task);
}

function resolveEnhancedDataRequestMaxCycles(task: WorkflowTask): number {
  return resolveAiDataRequestMaxCycles(task);
}

function isGermanLanguageCode(code: unknown): boolean {
  const normalized = String(code || '')
    .trim()
    .toLowerCase();
  return !normalized || normalized === 'de' || normalized.startsWith('de-');
}

function isEnglishLanguageCode(code: unknown): boolean {
  const normalized = String(code || '')
    .trim()
    .toLowerCase();
  return normalized === 'en' || normalized.startsWith('en-');
}

function normalizeDataRequestLanguageCode(code: unknown): string {
  return String(code || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
}

function normalizeDataRequestLanguageName(name: unknown): string {
  return String(name || '').trim();
}

function getLanguageBaseCode(code: unknown): string {
  return normalizeDataRequestLanguageCode(code).split('-')[0] || '';
}

function areLanguageCodesCompatible(left: unknown, right: unknown): boolean {
  const leftBase = getLanguageBaseCode(left);
  const rightBase = getLanguageBaseCode(right);
  if (!leftBase || !rightBase) return false;
  return leftBase === rightBase;
}

function isCustomDataRequestRecipientContext(context: WorkflowDataRequestContext): boolean {
  const recipientType = String(context.task?.config?.recipientType || '')
    .trim()
    .toLowerCase();
  return recipientType === 'custom';
}

function normalizeDataRequestUiLocale(input: unknown): Partial<DataRequestUiLocale> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const source = input as Record<string, any>;
  const normalized: Partial<DataRequestUiLocale> = {};
  for (const key of DATA_REQUEST_UI_LOCALE_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      normalized[key] = value.trim();
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

async function translateUiStringsWithCache(input: {
  targetLanguage: CitizenTargetLanguage;
  sourceLanguageName: string;
  strings: Record<string, string>;
  purpose: string;
  metaSource: string;
}): Promise<Record<string, string>> {
  const code = String(input.targetLanguage.code || '')
    .trim()
    .toLowerCase();
  const entries = Object.entries(input.strings).filter(([key, value]) => key && typeof value === 'string');
  if (entries.length === 0) return {};
  if (isGermanLanguageCode(code)) {
    return Object.fromEntries(entries);
  }

  const db = getDatabase();
  const keys = entries.map(([key]) => key);
  const placeholders = keys.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT \`key\`, \`value\`
     FROM translations
     WHERE language = ? AND \`key\` IN (${placeholders})`,
    [code, ...keys]
  );
  const cached: Record<string, string> = {};
  for (const row of rows || []) {
    const key = typeof (row as any)?.key === 'string' ? (row as any).key : '';
    const value = typeof (row as any)?.value === 'string' ? (row as any).value : '';
    if (key && value) cached[key] = value;
  }

  const missingKeys = keys.filter((key) => !cached[key]);
  if (missingKeys.length === 0) {
    return keys.reduce<Record<string, string>>((acc, key) => {
      acc[key] = cached[key] || input.strings[key] || '';
      return acc;
    }, {});
  }

  const missingInput: Record<string, string> = {};
  for (const key of missingKeys) {
    missingInput[key] = input.strings[key];
  }

  try {
    const systemPrompt = await getSystemPrompt('uiTranslationPrompt');
    const prompt = `${systemPrompt}

Sprache:
- Quelle: ${input.sourceLanguageName}
- Ziel: ${input.targetLanguage.name} (${code})

Input JSON:
${JSON.stringify(missingInput, null, 2)}

Output JSON:`.trim();
    const raw = await testAIProvider(prompt, {
      purpose: input.purpose,
      meta: {
        source: input.metaSource,
        targetLanguage: code,
      },
    });
    const parsed = extractJsonPayload(raw);
    const root =
      parsed && typeof parsed === 'object' && parsed.translations && typeof parsed.translations === 'object'
        ? (parsed.translations as Record<string, any>)
        : parsed && typeof parsed === 'object'
        ? (parsed as Record<string, any>)
        : {};

    for (const key of missingKeys) {
      const candidate = root[key];
      const value =
        typeof candidate === 'string' && candidate.trim()
          ? candidate.trim()
          : (input.strings[key] || '').trim();
      cached[key] = value;
      if (!value) continue;
      await db.run(
        `INSERT INTO translations (language, \`key\`, \`value\`, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(language, \`key\`) DO UPDATE SET
           \`value\` = excluded.\`value\`,
           updated_at = CURRENT_TIMESTAMP`,
        [code, key, value]
      );
    }
  } catch (error) {
    console.warn('Failed to prefill cached UI translations for workflow data request:', error);
  }

  return keys.reduce<Record<string, string>>((acc, key) => {
    acc[key] = cached[key] || input.strings[key] || '';
    return acc;
  }, {});
}

async function buildCitizenDataRequestUiLocale(
  targetLanguage: CitizenTargetLanguage
): Promise<Partial<DataRequestUiLocale>> {
  if (isGermanLanguageCode(targetLanguage.code)) {
    return { ...DATA_REQUEST_UI_LOCALE_DE };
  }
  if (isEnglishLanguageCode(targetLanguage.code)) {
    return { ...DATA_REQUEST_UI_LOCALE_EN };
  }
  try {
    const translated = await translateUiStringsWithCache({
      targetLanguage,
      sourceLanguageName: 'Deutsch',
      strings: DATA_REQUEST_UI_LOCALE_DE_MAP,
      purpose: 'workflow_data_request_ui_locale_prefill',
      metaSource: 'routes.workflows.data_request_ui_locale_prefill',
    });
    return {
      ...DATA_REQUEST_UI_LOCALE_EN,
      ...translated,
    };
  } catch (error) {
    console.warn('Failed to build citizen data-request UI locale:', error);
    return { ...DATA_REQUEST_UI_LOCALE_EN };
  }
}

function forceDataRequestFieldsOptional(fields: DataRequestField[]): DataRequestField[] {
  return normalizeDataRequestFields(fields).map((field) => ({
    ...field,
    required: false,
  }));
}

function limitDataRequestFields(fields: DataRequestField[], maxQuestions: number): DataRequestField[] {
  if (!Array.isArray(fields) || fields.length === 0) return [];
  const safeMax = Number.isFinite(maxQuestions) ? Math.max(1, Math.min(25, Math.floor(maxQuestions))) : 5;
  return fields.slice(0, safeMax);
}

function parseStoredDataRequestPayload(raw: unknown): StoredDataRequestPayload {
  const parsed = parseJsonValue<any>(raw, null);
  if (Array.isArray(parsed)) {
    return {
      fields: normalizeDataRequestFields(parsed),
      meta: {},
    };
  }
  if (parsed && typeof parsed === 'object') {
    const source = parsed as Record<string, any>;
    const fields = normalizeDataRequestFields(source.fields);
    const metaSource = source.meta && typeof source.meta === 'object' && !Array.isArray(source.meta)
      ? source.meta
      : {};
    const meta: Record<string, any> = {
      ...metaSource,
    };
    if (Array.isArray(meta.adminFieldsDe)) {
      meta.adminFieldsDe = forceDataRequestFieldsOptional(meta.adminFieldsDe);
    } else if (Array.isArray(source.adminFieldsDe)) {
      meta.adminFieldsDe = forceDataRequestFieldsOptional(source.adminFieldsDe);
    }
    if (typeof meta.adminSubjectDe !== 'string' && typeof source.adminSubjectDe === 'string') {
      meta.adminSubjectDe = source.adminSubjectDe;
    }
    if (typeof meta.adminIntroTextDe !== 'string' && typeof source.adminIntroTextDe === 'string') {
      meta.adminIntroTextDe = source.adminIntroTextDe;
    }
    if (typeof source.subject === 'string') {
      meta.subject = source.subject;
    }
    if (typeof source.introText === 'string') {
      meta.introText = source.introText;
    }
    if (typeof source.languageCode === 'string') {
      meta.languageCode = source.languageCode;
    }
    if (typeof source.languageName === 'string') {
      meta.languageName = source.languageName;
    }
    if (Number.isFinite(Number(source.cycle))) {
      meta.cycle = Math.max(1, Math.floor(Number(source.cycle)));
    }
    if (Number.isFinite(Number(source.maxCycles))) {
      meta.maxCycles = Math.max(1, Math.floor(Number(source.maxCycles)));
    }
    const uiLocale =
      normalizeDataRequestUiLocale(meta.uiLocale) ||
      normalizeDataRequestUiLocale(source.uiLocale);
    if (uiLocale) {
      meta.uiLocale = uiLocale;
    }
    return {
      fields,
      meta,
    };
  }
  return {
    fields: [],
    meta: {},
  };
}

function serializeStoredDataRequestPayload(input: {
  fields: DataRequestField[];
  subject?: string;
  introText?: string;
  languageCode?: string;
  languageName?: string;
  cycle?: number;
  maxCycles?: number;
  adminFieldsDe?: DataRequestField[];
  adminSubjectDe?: string;
  adminIntroTextDe?: string;
  uiLocale?: Partial<DataRequestUiLocale>;
}): string {
  const payload: Record<string, any> = {
    fields: normalizeDataRequestFields(input.fields),
    meta: {},
  };
  if (typeof input.subject === 'string' && input.subject.trim()) {
    payload.subject = input.subject.trim();
    payload.meta.subject = input.subject.trim();
  }
  if (typeof input.introText === 'string' && input.introText.trim()) {
    payload.introText = input.introText.trim();
    payload.meta.introText = input.introText.trim();
  }
  if (typeof input.languageCode === 'string' && input.languageCode.trim()) {
    payload.languageCode = input.languageCode.trim().toLowerCase();
    payload.meta.languageCode = payload.languageCode;
  }
  if (typeof input.languageName === 'string' && input.languageName.trim()) {
    payload.languageName = input.languageName.trim();
    payload.meta.languageName = payload.languageName;
  }
  if (Number.isFinite(Number(input.cycle))) {
    payload.cycle = Math.max(1, Math.floor(Number(input.cycle)));
    payload.meta.cycle = payload.cycle;
  }
  if (Number.isFinite(Number(input.maxCycles))) {
    payload.maxCycles = Math.max(1, Math.floor(Number(input.maxCycles)));
    payload.meta.maxCycles = payload.maxCycles;
  }
  if (Array.isArray(input.adminFieldsDe) && input.adminFieldsDe.length > 0) {
    payload.adminFieldsDe = forceDataRequestFieldsOptional(input.adminFieldsDe);
    payload.meta.adminFieldsDe = payload.adminFieldsDe;
  }
  if (typeof input.adminSubjectDe === 'string' && input.adminSubjectDe.trim()) {
    payload.adminSubjectDe = input.adminSubjectDe.trim();
    payload.meta.adminSubjectDe = payload.adminSubjectDe;
  }
  if (typeof input.adminIntroTextDe === 'string' && input.adminIntroTextDe.trim()) {
    payload.adminIntroTextDe = input.adminIntroTextDe.trim();
    payload.meta.adminIntroTextDe = payload.adminIntroTextDe;
  }
  const uiLocale = normalizeDataRequestUiLocale(input.uiLocale);
  if (uiLocale) {
    payload.uiLocale = uiLocale;
    payload.meta.uiLocale = uiLocale;
  }
  return JSON.stringify(payload);
}

function sanitizeDataRequestFieldKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cleanDataRequestInlineText(value: unknown): string {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^[-*]\s+/, '')
    .trim();
}

function normalizeDataRequestFieldOptions(input: unknown): DataRequestFieldOption[] {
  const entries = Array.isArray(input)
    ? input
    : typeof input === 'string'
    ? input
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  return entries
    .map((entry: any) => {
      if (entry === null || entry === undefined) return null;
      if (typeof entry === 'string') {
        const value = cleanDataRequestInlineText(entry);
        if (!value) return null;
        return { value, label: value };
      }
      if (typeof entry === 'object') {
        const value = cleanDataRequestInlineText(entry.value || entry.id || entry.key || entry.name || '');
        const label = cleanDataRequestInlineText(entry.label || entry.title || entry.name || value);
        if (!value) return null;
        return { value, label: label || value };
      }
      return null;
    })
    .filter((entry: DataRequestFieldOption | null): entry is DataRequestFieldOption => entry !== null)
    .slice(0, 20);
}

function normalizeDataRequestFieldType(
  typeLike: unknown,
  optionCount: number
): DataRequestFieldType {
  const allowed = new Set<DataRequestFieldType>(['yes_no', 'single_choice', 'number', 'quantity', 'short_text']);
  const raw = String(typeLike || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const aliasMap: Record<string, DataRequestFieldType> = {
    boolean: 'yes_no',
    bool: 'yes_no',
    yesno: 'yes_no',
    yes_no: 'yes_no',
    choice: 'single_choice',
    select: 'single_choice',
    radio: 'single_choice',
    single: 'single_choice',
    enum: 'single_choice',
    integer: 'number',
    int: 'number',
    float: 'number',
    decimal: 'number',
    text: 'short_text',
    string: 'short_text',
    textarea: 'short_text',
  };
  if (allowed.has(raw as DataRequestFieldType)) return raw as DataRequestFieldType;
  if (aliasMap[raw]) return aliasMap[raw];
  if (optionCount > 0) return 'single_choice';
  return 'short_text';
}

function normalizeDataRequestFields(input: unknown): DataRequestField[] {
  if (!Array.isArray(input)) return [];
  const keys = new Set<string>();
  const fields: DataRequestField[] = [];
  for (const [index, raw] of input.entries()) {
    if (typeof raw === 'string') {
      const label = cleanDataRequestInlineText(raw);
      if (!label) continue;
      const key = sanitizeDataRequestFieldKey(label) || `field_${index + 1}`;
      if (keys.has(key)) continue;
      keys.add(key);
      fields.push({
        key,
        label,
        type: 'short_text',
        required: false,
      });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const source = raw as Record<string, any>;
    const key = sanitizeDataRequestFieldKey(
      source.key ||
        source.id ||
        source.name ||
        source.variable ||
        source.variableKey ||
        source.processVariable ||
        source.fieldKey ||
        source.field ||
        source.var
    );
    if (!key || keys.has(key)) continue;
    keys.add(key);
    const label = cleanDataRequestInlineText(
      source.label || source.title || source.question || source.prompt || source.text || key
    ) || key;
    const options = normalizeDataRequestFieldOptions(
      source.options ||
        source.choices ||
        source.values ||
        source.answerOptions ||
        source.optionValues ||
        source.selectOptions
    );
    const type = normalizeDataRequestFieldType(
      source.type || source.fieldType || source.answerType || source.inputType,
      options.length
    );
    const required = source.required === true;

    fields.push({
      key,
      label,
      type,
      required,
      ...(type === 'single_choice' && options.length > 0 ? { options } : {}),
    });
  }
  return fields.slice(0, 25);
}

function inferFreeDataRequestFieldType(label: string, options: DataRequestFieldOption[]): DataRequestFieldType {
  if (options.length > 1) {
    const yesNoValues = new Set(['ja', 'nein', 'yes', 'no', 'true', 'false', '0', '1']);
    const values = options.map((entry) => String(entry.value || '').trim().toLowerCase()).filter(Boolean);
    if (values.length === 2 && values.every((value) => yesNoValues.has(value))) {
      return 'yes_no';
    }
    return 'single_choice';
  }
  const normalized = label.toLowerCase();
  if (/(wie\s+gro|groe|größe|groesse|m²|qm|\banzahl\b|\bmenge\b|\bprozent\b|\bmeter\b|\bhoehe\b|\bhöhe\b|\bflaeche\b|\bfläche\b)/i.test(normalized)) {
    return 'quantity';
  }
  if (/(zahl|nummer|count|score|index)/i.test(normalized)) {
    return 'number';
  }
  if (/(ja\/nein|yes\/no)/i.test(normalized)) {
    return 'yes_no';
  }
  return 'short_text';
}

function extractGeneratedDataRequestFieldsFromParsedPayload(parsed: any): DataRequestField[] {
  if (Array.isArray(parsed)) {
    return normalizeDataRequestFields(parsed);
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const source = parsed as Record<string, any>;
  const candidates: unknown[] = [
    source.fields,
    source.questions,
    source.items,
    source.followUpQuestions,
    source.requestedFields,
    source.formFields,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDataRequestFields(candidate);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return [];
}

function extractDataRequestSubjectIntroFromText(raw: string): { subject: string; introText: string } {
  const text = String(raw || '').replace(/\r/g, '');
  const normalized = text
    .replace(/\*\*(betreff|subject)\*\*\s*:/gi, '$1:')
    .replace(/\*\*(einleitung(?:stext)?|intro(?:duction|text)?)\*\*\s*:/gi, '$1:');
  const subjectMatch = normalized.match(/(?:^|\n)\s*(?:\*{1,2}\s*)?(?:betreff|subject)\s*:\s*(.+)$/im);
  const introMatch = normalized.match(
    /(?:^|\n)\s*(?:\*{1,2}\s*)?(?:einleitung(?:stext)?|intro(?:duction|text)?)\s*:\s*(.+)$/im
  );
  const subject = cleanDataRequestInlineText(subjectMatch?.[1] || '');
  let introText = cleanDataRequestInlineText(introMatch?.[1] || '');
  if (!introText) {
    const firstParagraph = normalized
      .split(/\n{2,}/)
      .map((entry) => cleanDataRequestInlineText(entry))
      .find(
        (entry) =>
          !!entry &&
          !/^(betreff|subject|einleitung(?:stext)?|intro(?:duction|text)?):/i.test(entry) &&
          !/^\d+[\).]/.test(entry)
      );
    introText = firstParagraph || '';
  }
  return { subject, introText };
}

function extractFreeAiDataRequestFieldsFromNumberedQuestions(
  raw: string,
  maxQuestions: number
): DataRequestField[] {
  const text = String(raw || '').replace(/\r/g, '');
  if (!text.trim()) return [];
  const safeMax = Math.max(1, Math.min(25, Math.floor(maxQuestions)));
  const fields: DataRequestField[] = [];
  const usedKeys = new Set<string>();
  const headingPattern = /(?:^|\n)\s*(\d+)[\).]\s+([^\n]+)/g;
  for (const match of text.matchAll(headingPattern)) {
    const heading = cleanDataRequestInlineText(match[2] || '');
    if (!heading) continue;
    const keyBase = sanitizeDataRequestFieldKey(heading);
    const key = keyBase && !usedKeys.has(keyBase) ? keyBase : `question_${fields.length + 1}`;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    fields.push({
      key,
      label: heading,
      type: inferFreeDataRequestFieldType(heading, []),
      required: false,
    });
    if (fields.length >= safeMax) break;
  }
  return normalizeDataRequestFields(fields).slice(0, safeMax);
}

function extractFreeAiDataRequestFieldsFromPlainText(raw: string, maxQuestions: number): DataRequestField[] {
  const text = String(raw || '').replace(/\r/g, '');
  if (!text.trim()) return [];
  const fields: DataRequestField[] = [];
  const blocks = Array.from(
    text.matchAll(/(?:^|\n)\s*\d+[\).]\s+([\s\S]*?)(?=(?:\n\s*\d+[\).]\s+)|$)/g)
  );
  for (const [index, match] of blocks.entries()) {
    const block = String(match[1] || '').trim();
    if (!block) continue;
    const lines = block
      .split('\n')
      .map((entry) => cleanDataRequestInlineText(entry))
      .filter(Boolean);
    if (lines.length === 0) continue;

    const variableMatch = block.match(
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{0,2}\s*)?(?:variable|key|field|feld)\s*:\s*(?:`([^`]+)`|([^\n]+))/i
    );
    const labelMatch = block.match(
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{0,2}\s*)?(?:label|frage|question)\s*:\s*([^\n]+)/i
    );
    const optionsMatch = block.match(
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*{0,2}\s*)?(?:optionen?|options?|auswahl)\s*:\s*([^\n]+)/i
    );

    const fallbackLabel = lines.find((line) => line.endsWith('?')) || lines[0];
    const label = cleanDataRequestInlineText(labelMatch?.[1] || fallbackLabel || '');
    const key =
      sanitizeDataRequestFieldKey(variableMatch?.[1] || variableMatch?.[2] || label) || `field_${index + 1}`;
    if (!key || !label || fields.some((entry) => entry.key === key)) continue;

    const options = normalizeDataRequestFieldOptions(optionsMatch?.[1] || '');
    const type = inferFreeDataRequestFieldType(label, options);
    fields.push({
      key,
      label,
      type,
      required: false,
      ...(type === 'single_choice' && options.length > 0 ? { options } : {}),
    });
    if (fields.length >= Math.max(1, Math.min(25, Math.floor(maxQuestions)))) {
      break;
    }
  }
  const normalized = normalizeDataRequestFields(fields);
  if (normalized.length > 0) {
    return normalized;
  }

  // Fallback parser for loosely structured plain-text answers where regex block matching fails.
  const safeMax = Math.max(1, Math.min(25, Math.floor(maxQuestions)));
  const lineFields: DataRequestField[] = [];
  const usedKeys = new Set<string>();
  let pendingHeading = '';
  let current: {
    key?: string;
    label?: string;
    options?: DataRequestFieldOption[];
  } | null = null;

  const flushCurrent = () => {
    if (!current) return;
    const label = cleanDataRequestInlineText(current.label || pendingHeading || '');
    const key = sanitizeDataRequestFieldKey(current.key || label);
    if (!label || !key || usedKeys.has(key)) {
      current = null;
      return;
    }
    const options = Array.isArray(current.options) ? normalizeDataRequestFieldOptions(current.options) : [];
    const type = inferFreeDataRequestFieldType(label, options);
    lineFields.push({
      key,
      label,
      type,
      required: false,
      ...(type === 'single_choice' && options.length > 0 ? { options } : {}),
    });
    usedKeys.add(key);
    current = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = cleanDataRequestInlineText(rawLine);
    if (!line) continue;

    const headingMatch = line.match(/^\d+[\).]\s+(.+)$/);
    if (headingMatch) {
      pendingHeading = cleanDataRequestInlineText(headingMatch[1]);
      continue;
    }

    const variableMatch = line.match(/^(?:variable|key|field|feld)\s*:\s*(.+)$/i);
    if (variableMatch) {
      flushCurrent();
      current = {
        key: cleanDataRequestInlineText(variableMatch[1]),
        label: pendingHeading,
        options: [],
      };
      continue;
    }

    const labelMatch = line.match(/^(?:label|frage|question)\s*:\s*(.+)$/i);
    if (labelMatch) {
      if (!current) {
        current = { key: '', label: pendingHeading, options: [] };
      }
      current.label = cleanDataRequestInlineText(labelMatch[1]);
      continue;
    }

    const optionsMatch = line.match(/^(?:optionen?|options?|auswahl)\s*:\s*(.+)$/i);
    if (optionsMatch) {
      if (!current) {
        current = { key: '', label: pendingHeading, options: [] };
      }
      current.options = normalizeDataRequestFieldOptions(optionsMatch[1]);
      continue;
    }

    if (line.endsWith('?')) {
      if (!current) {
        current = { key: '', label: line, options: [] };
      } else if (!current.label) {
        current.label = line;
      }
    }
  }
  flushCurrent();
  const normalizedLineFields = normalizeDataRequestFields(lineFields).slice(0, safeMax);
  if (normalizedLineFields.length > 0) {
    return normalizedLineFields;
  }
  return extractFreeAiDataRequestFieldsFromNumberedQuestions(text, safeMax);
}

function buildFreeAiDataRequestFieldsFromNeedSignals(input: {
  missingSignals: string[];
  maxQuestions: number;
}): DataRequestField[] {
  const safeMax = Math.max(1, Math.min(25, Math.floor(input.maxQuestions)));
  const fields: DataRequestField[] = [];
  const usedKeys = new Set<string>();
  const sanitizeNeedSignalKey = (value: string): string =>
    sanitizeDataRequestFieldKey(
      String(value || '')
        .replace(/ä/gi, 'ae')
        .replace(/ö/gi, 'oe')
        .replace(/ü/gi, 'ue')
        .replace(/ß/gi, 'ss')
    );

  for (const signalRaw of input.missingSignals || []) {
    const signal = cleanDataRequestInlineText(signalRaw).replace(/\.+$/g, '').trim();
    if (!signal) continue;

    const examplesMatch = signal.match(/\((?:z\.\s*b\.?|beispiel(?:e)?)\s*[:\-]?\s*([^)]+)\)/i);
    const parsedOptions = normalizeDataRequestFieldOptions(
      String(examplesMatch?.[1] || '')
        .replace(/\boder\b/gi, ',')
        .trim()
    );
    const signalWithoutExamples = cleanDataRequestInlineText(
      signal.replace(/\((?:z\.\s*b\.?|beispiel(?:e)?)[^)]+\)/i, '')
    );
    const canUseOptions = /\b(art|typ|kategorie|status|material|oberflaeche|oberfläche)\b/i.test(
      signalWithoutExamples || signal
    );
    const options = canUseOptions ? parsedOptions : [];
    const label =
      signal.includes('?') || signal.toLowerCase().startsWith('wie ') || signal.toLowerCase().startsWith('wann ')
        ? signal
        : `Bitte angeben: ${signal}`;
    const key =
      sanitizeNeedSignalKey(signalWithoutExamples || signal) || `signal_${fields.length + 1}`;
    if (!key || usedKeys.has(key)) continue;
    usedKeys.add(key);
    const type = inferFreeDataRequestFieldType(label, options);
    fields.push({
      key,
      label,
      type,
      required: false,
      ...(type === 'single_choice' && options.length > 0 ? { options } : {}),
    });
    if (fields.length >= safeMax) break;
  }

  return normalizeDataRequestFields(fields).slice(0, safeMax);
}

async function buildCitizenTargetDataRequestContent(input: {
  fields: DataRequestField[];
  subject: string;
  introText: string;
  targetLanguage: CitizenTargetLanguage;
}): Promise<{
  fields: DataRequestField[];
  subject: string;
  introText: string;
}> {
  const baseFields = normalizeDataRequestFields(input.fields);
  const baseSubject = String(input.subject || '').trim();
  const baseIntroText = String(input.introText || '').trim();
  if (baseFields.length === 0 || isGermanLanguageCode(input.targetLanguage.code)) {
    return {
      fields: baseFields,
      subject: baseSubject,
      introText: baseIntroText,
    };
  }

  try {
    const systemPrompt = await getSystemPrompt('uiTranslationPrompt');
    const payload = `${systemPrompt}

Aufgabe:
- Uebersetze die folgenden Datennachforderungs-Inhalte in die Zielsprache fuer das Buerger-Callback-Formular.
- Key, Typ, required und Optionswerte muessen unveraendert bleiben.
- Nur Labels, subject, introText und option labels uebersetzen.

OUTPUT (nur JSON):
{
  "subject": "string",
  "introText": "string",
  "fields": [
    {
      "key": "string",
      "label": "string",
      "type": "yes_no|single_choice|number|quantity|short_text",
      "required": true,
      "options": [{ "value": "string", "label": "string" }]
    }
  ]
}

Zielsprache:
- Code: ${input.targetLanguage.code}
- Name: ${input.targetLanguage.name}

Input JSON:
${JSON.stringify(
  {
    subject: baseSubject,
    introText: baseIntroText,
    fields: baseFields,
  },
  null,
  2
)}`.trim();
    const raw = await testAIProvider(payload, {
      purpose: 'workflow_data_request_citizen_target',
      meta: {
        source: 'routes.workflows.data_request_citizen_target',
        language: input.targetLanguage.code,
      },
    });
    const parsed = extractJsonPayload(raw);
    const translatedFields = normalizeDataRequestFields(parsed?.fields);
    const translatedFieldMap = new Map(translatedFields.map((field) => [field.key, field]));
    const fields = baseFields.map((field) => {
      const translated = translatedFieldMap.get(field.key);
      const translatedOptionsMap = new Map(
        Array.isArray(translated?.options)
          ? translated.options.map((option) => [option.value, String(option.label || option.value).trim() || option.value])
          : []
      );
      const options = Array.isArray(field.options)
        ? field.options.map((option) => ({
            value: option.value,
            label: translatedOptionsMap.get(option.value) || option.label,
          }))
        : undefined;
      return {
        ...field,
        label: String(translated?.label || field.label).trim() || field.label,
        required: field.required === true,
        ...(Array.isArray(options) && options.length > 0 ? { options } : {}),
      };
    });
    return {
      fields,
      subject: String(parsed?.subject || baseSubject).trim() || baseSubject,
      introText: String(parsed?.introText || baseIntroText).trim() || baseIntroText,
    };
  } catch (error) {
    console.warn('Failed to build citizen data-request content in target language:', error);
    return {
      fields: baseFields,
      subject: baseSubject,
      introText: baseIntroText,
    };
  }
}

async function buildAdminGermanDataRequestContent(input: {
  fields: DataRequestField[];
  subject: string;
  introText: string;
  sourceLanguage: CitizenTargetLanguage;
}): Promise<{
  fields: DataRequestField[];
  subject: string;
  introText: string;
}> {
  const baseFields = forceDataRequestFieldsOptional(input.fields);
  const baseSubject = String(input.subject || '').trim();
  const baseIntroText = String(input.introText || '').trim();
  if (baseFields.length === 0 || isGermanLanguageCode(input.sourceLanguage.code)) {
    return {
      fields: baseFields,
      subject: baseSubject,
      introText: baseIntroText,
    };
  }

  try {
    const systemPrompt = await getSystemPrompt('uiTranslationPrompt');
    const payload = `${systemPrompt}

Aufgabe:
- Uebersetze die folgenden Datennachforderungs-Inhalte ins Deutsche fuer das Admin-Frontend.
- Key, Typ und Optionswerte muessen unveraendert bleiben.
- Nur Labels, subject und introText ins Deutsche uebersetzen.
- required fuer alle Felder bleibt false.

OUTPUT (nur JSON):
{
  "subject": "string",
  "introText": "string",
  "fields": [
    {
      "key": "string",
      "label": "string",
      "type": "yes_no|single_choice|number|quantity|short_text",
      "required": false,
      "options": [{ "value": "string", "label": "string" }]
    }
  ]
}

Quellsprache:
- Code: ${input.sourceLanguage.code}
- Name: ${input.sourceLanguage.name}

Input JSON:
${JSON.stringify(
  {
    subject: baseSubject,
    introText: baseIntroText,
    fields: baseFields,
  },
  null,
  2
)}`.trim();
    const raw = await testAIProvider(payload, {
      purpose: 'workflow_data_request_admin_german',
      meta: {
        source: 'routes.workflows.data_request_admin_german',
        language: input.sourceLanguage.code,
      },
    });
    const parsed = extractJsonPayload(raw);
    const translatedFields = forceDataRequestFieldsOptional(normalizeDataRequestFields(parsed?.fields));
    const translatedFieldMap = new Map(translatedFields.map((field) => [field.key, field]));
    const fields = baseFields.map((field) => {
      const translated = translatedFieldMap.get(field.key);
      const translatedOptionsMap = new Map(
        Array.isArray(translated?.options)
          ? translated.options.map((option) => [option.value, String(option.label || option.value).trim() || option.value])
          : []
      );
      const options = Array.isArray(field.options)
        ? field.options.map((option) => ({
            value: option.value,
            label: translatedOptionsMap.get(option.value) || option.label,
          }))
        : undefined;
      return {
        ...field,
        label: String(translated?.label || field.label).trim() || field.label,
        required: false,
        ...(Array.isArray(options) && options.length > 0 ? { options } : {}),
      };
    });
    return {
      fields,
      subject: String(parsed?.subject || baseSubject).trim() || baseSubject,
      introText: String(parsed?.introText || baseIntroText).trim() || baseIntroText,
    };
  } catch (error) {
    console.warn('Failed to build German admin data-request content:', error);
    return {
      fields: baseFields,
      subject: baseSubject,
      introText: baseIntroText,
    };
  }
}

async function translateDataRequestAnswersToGerman(input: {
  fields: DataRequestField[];
  answers: Record<string, any>;
  sourceLanguage: CitizenTargetLanguage;
}): Promise<Record<string, any>> {
  const normalizedAnswers =
    input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers)
      ? { ...input.answers }
      : {};
  if (Object.keys(normalizedAnswers).length === 0 || isGermanLanguageCode(input.sourceLanguage.code)) {
    return normalizedAnswers;
  }

  const fieldsByKey = new Map((input.fields || []).map((field) => [field.key, field]));
  const translatableEntries = Object.entries(normalizedAnswers).filter(([fieldKey, value]) => {
    if (typeof value !== 'string' || !value.trim()) return false;
    const fieldType = fieldsByKey.get(fieldKey)?.type || 'short_text';
    return fieldType === 'short_text';
  });
  if (translatableEntries.length === 0) {
    return normalizedAnswers;
  }

  try {
    const systemPrompt = await getSystemPrompt('uiTranslationPrompt');
    const payload = `${systemPrompt}

Aufgabe:
- Uebersetze nur die Antworttexte in "answers" ins Deutsche.
- Keys und JSON-Struktur muessen unveraendert bleiben.
- Zahlen, Booleans und nicht genannte Felder nicht veraendern.
- Wenn eine Antwort bereits Deutsch ist, unveraendert lassen.

OUTPUT (nur JSON):
{
  "answers": {
    "field_key": "deutscher Text"
  }
}

Quellsprache:
- Code: ${input.sourceLanguage.code}
- Name: ${input.sourceLanguage.name}

Zu uebersetzende Schluessel:
${JSON.stringify(translatableEntries.map(([fieldKey]) => fieldKey), null, 2)}

Antworten:
${JSON.stringify(Object.fromEntries(translatableEntries), null, 2)}`.trim();
    const raw = await testAIProvider(payload, {
      purpose: 'workflow_data_request_answers_to_german',
      meta: {
        source: 'routes.workflows.data_request_answers_to_german',
        language: input.sourceLanguage.code,
      },
    });
    const parsed = extractJsonPayload(raw);
    const translatedRoot =
      parsed?.answers && typeof parsed.answers === 'object' && !Array.isArray(parsed.answers)
        ? (parsed.answers as Record<string, any>)
        : {};
    for (const [fieldKey] of translatableEntries) {
      const translated = translatedRoot[fieldKey];
      if (typeof translated === 'string' && translated.trim()) {
        normalizedAnswers[fieldKey] = translated.trim();
      }
    }
  } catch (error) {
    console.warn('Failed to translate data-request answers to German:', error);
  }

  return normalizedAnswers;
}

function resolveStepTimeoutMs(config: Record<string, any>, fallbackHours: number): number {
  const hoursRaw = Number(config?.timeoutHours);
  const minutesRaw = Number(config?.timeoutMinutes);
  const secondsRaw = Number(config?.timeoutSeconds);
  const hours = Number.isFinite(hoursRaw) ? Math.max(0, Math.floor(hoursRaw)) : 0;
  const minutes = Number.isFinite(minutesRaw) ? Math.max(0, Math.floor(minutesRaw)) : 0;
  const seconds = Number.isFinite(secondsRaw) ? Math.max(0, Math.floor(secondsRaw)) : 0;
  const configuredSeconds = hours * 3600 + minutes * 60 + seconds;
  const fallbackSeconds = Math.max(1, Math.floor(fallbackHours)) * 3600;
  return (configuredSeconds > 0 ? configuredSeconds : fallbackSeconds) * 1000;
}

function resolveDataRequestRejectTaskIds(execution: WorkflowExecution, task: WorkflowTask): string[] {
  return resolveConfiguredTaskIdsFromConfig(
    execution,
    task.config?.rejectNextTaskIds ?? task.config?.rejectNextTaskId
  );
}

function validateAndNormalizeDataRequestAnswers(
  fields: DataRequestField[],
  answersRaw: unknown
): { valid: boolean; errors: string[]; normalized: Record<string, any> } {
  const errors: string[] = [];
  const normalized: Record<string, any> = {};
  const answers = answersRaw && typeof answersRaw === 'object' && !Array.isArray(answersRaw)
    ? (answersRaw as Record<string, any>)
    : {};

  for (const field of fields) {
    const rawValue = answers[field.key];
    if ((rawValue === null || rawValue === undefined || rawValue === '') && field.required) {
      errors.push(`Feld "${field.label}" ist erforderlich.`);
      continue;
    }
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      continue;
    }

    if (field.type === 'yes_no') {
      if (typeof rawValue === 'boolean') {
        normalized[field.key] = rawValue;
      } else {
        const value = String(rawValue).trim().toLowerCase();
        if (['yes', 'ja', 'true', '1'].includes(value)) normalized[field.key] = true;
        else if (['no', 'nein', 'false', '0'].includes(value)) normalized[field.key] = false;
        else errors.push(`Feld "${field.label}" erwartet ja/nein.`);
      }
      continue;
    }

    if (field.type === 'single_choice') {
      const value = String(rawValue).trim();
      const allowed = new Set((field.options || []).map((entry) => entry.value));
      if (allowed.size > 0 && !allowed.has(value)) {
        errors.push(`Feld "${field.label}" enthält eine ungültige Auswahl.`);
      } else {
        normalized[field.key] = value;
      }
      continue;
    }

    if (field.type === 'number' || field.type === 'quantity') {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) {
        errors.push(`Feld "${field.label}" erwartet eine Zahl.`);
      } else {
        normalized[field.key] = numeric;
      }
      continue;
    }

    normalized[field.key] = String(rawValue).trim();
  }

  return { valid: errors.length === 0, errors, normalized };
}

function buildDataRequestLink(callbackUrl: string | undefined, token: string): string {
  const verificationLink = buildCallbackLink(callbackUrl, { token, cb: 'workflow_data_request' }, { wrap: false });
  try {
    const parsed = new URL(verificationLink);
    const normalizedPath = (parsed.pathname || '/').replace(/\/+$/g, '');
    if (!normalizedPath || normalizedPath === '/') {
      parsed.pathname = '/workflow/data-request';
    } else if (/\/verify$/i.test(normalizedPath)) {
      parsed.pathname = normalizedPath.replace(/\/verify$/i, '/workflow/data-request');
    } else if (!/\/workflow\/data-request\/?$/i.test(normalizedPath)) {
      parsed.pathname = `${normalizedPath}/workflow/data-request`;
    }
    parsed.searchParams.delete('cb');
    return wrapLinkForPwaOpenGate(parsed.toString());
  } catch {
    return wrapLinkForPwaOpenGate(verificationLink);
  }
}

interface DataRequestNeedCheckResult {
  requiresAdditionalData: boolean;
  reasoning: string;
  confidence: number | null;
  categoryConfidence: number | null;
  priorityConfidence: number | null;
  missingSignals: string[];
}

interface GenerateAiDataRequestFieldsInput {
  execution: WorkflowExecution;
  task: WorkflowTask;
  ticket: any;
  description: string;
  locationText: string;
  imageContext?: string;
  targetLanguage: CitizenTargetLanguage;
  maxQuestionsPerCycle: number;
  cycleIndex: number;
  maxCycles: number;
  previousAnswers?: Record<string, any> | null;
  needCheck?: {
    confidence: number | null;
    categoryConfidence: number | null;
    priorityConfidence: number | null;
    missingSignals: string[];
  } | null;
}

function resolveFreeDataRequestCollectionObjective(task: WorkflowTask): string {
  const explicitObjective = String(
    task.config?.collectionObjective ||
      task.config?.requestedInformation ||
      task.config?.requestedInfo ||
      task.config?.requested_information ||
      task.config?.informationGoal ||
      task.config?.objective ||
      task.config?.collectionGoal ||
      ''
  ).trim();
  if (explicitObjective) return explicitObjective;
  return String(task.config?.questionPrompt || '').trim();
}

function resolveFreeDataRequestFocusHint(task: WorkflowTask): string {
  return String(task.config?.questionPrompt || '').trim();
}

function resolveFreeDataRequestQuestionPromptMode(task: WorkflowTask): 'append' | 'override' {
  const raw = String(task.config?.questionPromptMode || '')
    .trim()
    .toLowerCase();
  return raw === 'override' ? 'override' : 'append';
}

async function evaluateEnhancedCategorizationNeed(input: {
  execution: WorkflowExecution;
  task: WorkflowTask;
  ticket: any;
  description: string;
  locationText: string;
  imageContext?: string;
}): Promise<DataRequestNeedCheckResult> {
  const knowledge = await loadKnowledge();
  const categoriesForPrompt = buildKnownCategoryPromptList(knowledge);
  const fallbackPrompt =
    typeof input.task.config?.needCheckPrompt === 'string' ? input.task.config.needCheckPrompt.trim() : '';
  const promptBase = fallbackPrompt || (await getSystemPrompt('workflowDataRequestNeedCheckPrompt'));
  const payload = `${promptBase}

Ticket:
- ID: ${String(input.ticket?.id || input.execution.ticketId)}
- Kategorie: ${String(input.ticket?.category || '')}
- Prioritaet: ${String(input.ticket?.priority || '')}
- Ort: ${String(input.locationText || '')}
- Beschreibung: ${String(input.description || '').slice(0, 1800)}
- KI-Bildbeschreibungen:
${String(input.imageContext || 'Keine KI-Bildbeschreibungen vorhanden.')}

Verfuegbare Kategorien (verbindlich):
${categoriesForPrompt}

Prozessvariablen (JSON):
${buildExecutionProcessVariablePromptBlock(input.execution)}

Prozessvariablen (Summary):
${buildExecutionProcessVariableSummary(input.execution)}
`;

  try {
    const raw = await testAIProviderForTicketPrompt({
      prompt: payload,
      purpose: 'workflow_enhanced_categorization_need_check',
      meta: {
        source: 'routes.workflows.enhanced_categorization_need_check',
        ticketId: input.ticket?.id || null,
        taskId: input.task.id,
      },
      ticket: input.ticket,
    });
    const parsed = extractJsonPayload(raw);
    const categoryConfidenceRaw = Number(parsed?.categoryConfidence);
    const priorityConfidenceRaw = Number(parsed?.priorityConfidence);
    const overallConfidenceRaw = Number(parsed?.overallConfidence ?? parsed?.confidence);
    const categoryConfidence = Number.isFinite(categoryConfidenceRaw)
      ? Math.max(0, Math.min(1, categoryConfidenceRaw))
      : null;
    const priorityConfidence = Number.isFinite(priorityConfidenceRaw)
      ? Math.max(0, Math.min(1, priorityConfidenceRaw))
      : null;
    const confidence = Number.isFinite(overallConfidenceRaw)
      ? Math.max(0, Math.min(1, overallConfidenceRaw))
      : null;
    const missingSignals = Array.isArray(parsed?.missingSignals)
      ? parsed.missingSignals
          .map((entry: any) => String(entry || '').trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    const requiresAdditionalDataFromModel = parsed?.requiresAdditionalData !== false;
    const requiresAdditionalDataByConfidence =
      (categoryConfidence !== null && categoryConfidence < 0.8) ||
      (priorityConfidence !== null && priorityConfidence < 0.75) ||
      missingSignals.length > 0;
    const requiresAdditionalData =
      requiresAdditionalDataFromModel || requiresAdditionalDataByConfidence;
    const reasoning = String(parsed?.reasoning || '').trim();
    return {
      requiresAdditionalData,
      reasoning,
      confidence,
      categoryConfidence,
      priorityConfidence,
      missingSignals,
    };
  } catch (error) {
    console.warn('Enhanced categorization need-check failed:', error);
    return {
      requiresAdditionalData: true,
      reasoning: '',
      confidence: null,
      categoryConfidence: null,
      priorityConfidence: null,
      missingSignals: [],
    };
  }
}

async function evaluateFreeDataRequestNeed(input: {
  execution: WorkflowExecution;
  task: WorkflowTask;
  ticket: any;
  description: string;
  locationText: string;
  imageContext?: string;
}): Promise<DataRequestNeedCheckResult> {
  const objective =
    resolveFreeDataRequestCollectionObjective(input.task) ||
    'Ermittle gezielt fehlende Sachinformationen fuer den konfigurierten Fachzweck.';
  const focusHint = resolveFreeDataRequestFocusHint(input.task);
  const confidenceThreshold = resolveFreeDataRequestNeedCheckConfidenceThreshold(input.task);
  const fallbackPrompt =
    typeof input.task.config?.needCheckPrompt === 'string' ? input.task.config.needCheckPrompt.trim() : '';
  const promptBase = fallbackPrompt || (await getSystemPrompt('workflowFreeDataRequestNeedCheckPrompt'));
  const payload = `${promptBase}

Auftrag / Zieldefinition:
${objective}

Ticket:
- ID: ${String(input.ticket?.id || input.execution.ticketId)}
- Kategorie: ${String(input.ticket?.category || '')}
- Prioritaet: ${String(input.ticket?.priority || '')}
- Ort: ${String(input.locationText || '')}
- Beschreibung: ${String(input.description || '').slice(0, 1800)}
- KI-Bildbeschreibungen:
${String(input.imageContext || 'Keine KI-Bildbeschreibungen vorhanden.')}

Prozessvariablen (JSON):
${buildExecutionProcessVariablePromptBlock(input.execution)}

Prozessvariablen (Summary):
${buildExecutionProcessVariableSummary(input.execution)}

Zusatzfokus (Klartext aus Workflowschritt):
${focusHint || 'Kein Zusatzfokus definiert.'}

Need-Check Schwellwert:
- confidenceThreshold: ${confidenceThreshold}
- requiresAdditionalData muss true sein, wenn overallConfidence unter confidenceThreshold liegt.
`;

  try {
    const raw = await testAIProviderForTicketPrompt({
      prompt: payload,
      purpose: 'workflow_free_data_request_need_check',
      meta: {
        source: 'routes.workflows.free_data_request_need_check',
        ticketId: input.ticket?.id || null,
        taskId: input.task.id,
      },
      ticket: input.ticket,
    });
    let parsed: any = null;
    try {
      parsed = extractJsonPayload(raw);
    } catch {
      parsed = null;
    }
    const overallConfidenceRaw = Number(parsed?.overallConfidence ?? parsed?.confidence);
    const confidence = Number.isFinite(overallConfidenceRaw)
      ? Math.max(0, Math.min(1, overallConfidenceRaw))
      : null;
    const missingSignals = Array.isArray(parsed?.missingSignals)
      ? parsed.missingSignals
          .map((entry: any) => String(entry || '').trim())
          .filter(Boolean)
          .slice(0, 10)
      : typeof parsed?.missingSignals === 'string'
      ? String(parsed.missingSignals)
          .split(/[\n,;]+/)
          .map((entry) => entry.trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];
    const modelDecision =
      typeof parsed?.requiresAdditionalData === 'boolean' ? parsed.requiresAdditionalData : null;
    const requiresAdditionalData =
      missingSignals.length > 0
        ? true
        : confidence !== null
        ? confidence < confidenceThreshold
        : modelDecision !== null
        ? modelDecision
        : true;
    const reasoning = String(parsed?.reasoning || '').trim();
    return {
      requiresAdditionalData,
      reasoning,
      confidence,
      categoryConfidence: null,
      priorityConfidence: null,
      missingSignals,
    };
  } catch (error) {
    console.warn('Free AI data request need-check failed:', error);
    return {
      requiresAdditionalData: true,
      reasoning: '',
      confidence: null,
      categoryConfidence: null,
      priorityConfidence: null,
      missingSignals: [],
    };
  }
}

async function generateEnhancedCategorizationFields(
  input: GenerateAiDataRequestFieldsInput
): Promise<GeneratedDataRequestContent> {
  const configured = normalizeDataRequestFields(input.task.config?.fields);
  if (configured.length > 0) {
    return {
      fields: forceDataRequestFieldsOptional(limitDataRequestFields(configured, input.maxQuestionsPerCycle)),
      subject: typeof input.task.config?.subject === 'string' ? input.task.config.subject : '',
      introText: typeof input.task.config?.introText === 'string' ? input.task.config.introText : '',
    };
  }

  const knowledge = await loadKnowledge();
  const categoriesForPrompt = buildKnownCategoryPromptList(knowledge);
  const fallbackPrompt =
    typeof input.task.config?.questionPrompt === 'string' ? input.task.config.questionPrompt.trim() : '';
  const promptBase = fallbackPrompt || (await getSystemPrompt('workflowDataRequestPrompt'));
  const languageHint =
    input.targetLanguage.code === 'de'
      ? 'Deutsch (de)'
      : `${input.targetLanguage.name} (${input.targetLanguage.code})`;
  const payload = `${promptBase}

Ticket:
- Kategorie: ${String(input.ticket?.category || '')}
- Prioritaet: ${String(input.ticket?.priority || '')}
- Ort: ${String(input.locationText || '')}
- Beschreibung: ${String(input.description || '').slice(0, 1500)}
- KI-Bildbeschreibungen:
${String(input.imageContext || 'Keine KI-Bildbeschreibungen vorhanden.')}

Verfuegbare Kategorien (verbindlich):
${categoriesForPrompt}

Vorpruefung:
- overallConfidence: ${
    input.needCheck?.confidence !== null && input.needCheck?.confidence !== undefined
      ? input.needCheck.confidence
      : 'n/a'
  }
- categoryConfidence: ${
    input.needCheck?.categoryConfidence !== null && input.needCheck?.categoryConfidence !== undefined
      ? input.needCheck.categoryConfidence
      : 'n/a'
  }
- priorityConfidence: ${
    input.needCheck?.priorityConfidence !== null && input.needCheck?.priorityConfidence !== undefined
      ? input.needCheck.priorityConfidence
      : 'n/a'
  }
- missingSignals: ${(input.needCheck?.missingSignals || []).join(', ') || 'keine'}

Prozessvariablen (JSON):
${buildExecutionProcessVariablePromptBlock(input.execution)}

Zusatzregel:
- Stelle nur Fragen, die gezielt Unsicherheit in Kategorie ODER Prioritaet reduzieren.
- Maximale Anzahl Fragen in diesem Zyklus: ${input.maxQuestionsPerCycle}
- Fragezyklus: ${input.cycleIndex} von maximal ${input.maxCycles}
- Formuliere subject, introText, labels und option labels in der Zielsprache "${languageHint}".
- Verwende fuer Buerger verstaendliche Formulierungen.
- Frage keine Daten ab, die bereits sicher vorliegen.

Bereits eingegangene Antworten aus vorigen Zyklen:
${JSON.stringify(input.previousAnswers || {}, null, 2)}
`;
  try {
    const raw = await testAIProviderForTicketPrompt({
      prompt: payload,
      purpose: 'workflow_enhanced_categorization',
      meta: {
        source: 'routes.workflows.enhanced_categorization',
        ticketId: input.ticket?.id || null,
      },
      ticket: input.ticket,
    });
    const parsed = extractJsonPayload(raw);
    const fields = forceDataRequestFieldsOptional(
      limitDataRequestFields(extractGeneratedDataRequestFieldsFromParsedPayload(parsed), input.maxQuestionsPerCycle)
    );
    const subject = typeof parsed?.subject === 'string' ? parsed.subject.trim() : '';
    const introText = typeof parsed?.introText === 'string' ? parsed.introText.trim() : '';
    if (fields.length > 0) {
      return {
        fields,
        ...(subject ? { subject } : {}),
        ...(introText ? { introText } : {}),
      };
    }
  } catch (error) {
    console.warn('Enhanced categorization field generation failed:', error);
  }
  const fallbackFields =
    input.targetLanguage.code === 'de'
      ? [
          { key: 'is_immediate_risk', label: 'Besteht ein unmittelbares Risiko?', type: 'yes_no', required: false },
          { key: 'affected_quantity', label: 'Wie groß ist das Ausmaß (Menge/Anzahl)?', type: 'quantity', required: false },
          { key: 'additional_details', label: 'Weitere wichtige Details', type: 'short_text', required: false },
        ]
      : [
          { key: 'is_immediate_risk', label: 'Is there an immediate risk?', type: 'yes_no', required: false },
          { key: 'affected_quantity', label: 'How large is the impact (amount/quantity)?', type: 'quantity', required: false },
          { key: 'additional_details', label: 'Additional relevant details', type: 'short_text', required: false },
        ];
  return {
    fields: forceDataRequestFieldsOptional(
      limitDataRequestFields(normalizeDataRequestFields(fallbackFields), input.maxQuestionsPerCycle)
    ),
  };
}

async function generateFreeAiDataRequestFields(
  input: GenerateAiDataRequestFieldsInput
): Promise<GeneratedDataRequestContent> {
  const configured = normalizeDataRequestFields(input.task.config?.fields);
  if (configured.length > 0) {
    return {
      fields: forceDataRequestFieldsOptional(limitDataRequestFields(configured, input.maxQuestionsPerCycle)),
      subject: typeof input.task.config?.subject === 'string' ? input.task.config.subject : '',
      introText: typeof input.task.config?.introText === 'string' ? input.task.config.introText : '',
    };
  }

  const systemPrompt = await getSystemPrompt('workflowFreeDataRequestPrompt');
  const focusHint = resolveFreeDataRequestFocusHint(input.task);
  const questionPromptMode = resolveFreeDataRequestQuestionPromptMode(input.task);
  const promptBase = systemPrompt;
  const languageHint =
    input.targetLanguage.code === 'de'
      ? 'Deutsch (de)'
      : `${input.targetLanguage.name} (${input.targetLanguage.code})`;
  const objectiveBase =
    resolveFreeDataRequestCollectionObjective(input.task) ||
    'Erfrage fehlende Angaben fuer den fachlichen Zweck des Workflows.';
  const objective =
    questionPromptMode === 'override' && focusHint
      ? focusHint
      : objectiveBase;
  const focusHintForPrompt =
    focusHint &&
    objective &&
    focusHint.toLowerCase() === objective.toLowerCase()
      ? ''
      : focusHint;
  const payload = `${promptBase}

Auftrag / Zieldefinition:
${objective}

Ticket:
- Kategorie: ${String(input.ticket?.category || '')}
- Prioritaet: ${String(input.ticket?.priority || '')}
- Ort: ${String(input.locationText || '')}
- Beschreibung: ${String(input.description || '').slice(0, 1600)}
- KI-Bildbeschreibungen:
${String(input.imageContext || 'Keine KI-Bildbeschreibungen vorhanden.')}

Need-Check:
- overallConfidence: ${
    input.needCheck?.confidence !== null && input.needCheck?.confidence !== undefined
      ? input.needCheck.confidence
      : 'n/a'
  }
- missingSignals: ${(input.needCheck?.missingSignals || []).join(', ') || 'keine'}

Prozessvariablen (JSON):
${buildExecutionProcessVariablePromptBlock(input.execution)}

Prozessvariablen (Summary):
${buildExecutionProcessVariableSummary(input.execution)}

Zusatzfokus (Klartext aus Workflowschritt):
${questionPromptMode === 'append'
    ? focusHintForPrompt || 'Kein zusätzlicher Fokus-Hinweis gesetzt.'
    : `Frageprompt-Modus: override (Fokus ist bereits als primäre Zieldefinition gesetzt)\n${focusHintForPrompt || 'Kein zusätzlicher Fokus-Hinweis gesetzt.'}`}

Zusatzregeln:
- Stelle nur Fragen, die nachweislich zur Zieldefinition beitragen.
- Frage keine Information doppelt, wenn sie bereits im Ticket, in Bildern oder Prozessvariablen enthalten ist.
- Maximale Anzahl Fragen in diesem Zyklus: ${input.maxQuestionsPerCycle}
- Fragezyklus: ${input.cycleIndex} von maximal ${input.maxCycles}
- Formuliere subject, introText, labels und option labels in der Zielsprache "${languageHint}".
- Felder muessen direkt als Prozessvariablen nutzbar sein (stabile snake_case keys).

Bereits eingegangene Antworten aus vorigen Zyklen:
${JSON.stringify(input.previousAnswers || {}, null, 2)}
`;
  try {
    const raw = await testAIProviderForTicketPrompt({
      prompt: payload,
      purpose: 'workflow_free_data_request',
      meta: {
        source: 'routes.workflows.free_data_request',
        ticketId: input.ticket?.id || null,
      },
      ticket: input.ticket,
    });
    let parsed: any = null;
    try {
      parsed = extractJsonPayload(raw);
    } catch {
      parsed = null;
    }
    const plainTextSubjectIntro = extractDataRequestSubjectIntroFromText(raw);
    const parsedFields = extractGeneratedDataRequestFieldsFromParsedPayload(parsed);
    const needSignalFallbackFields = buildFreeAiDataRequestFieldsFromNeedSignals({
      missingSignals: input.needCheck?.missingSignals || [],
      maxQuestions: input.maxQuestionsPerCycle,
    });
    const generatedFields =
      parsedFields.length > 0
        ? parsedFields
        : (() => {
            const fromPlainText = extractFreeAiDataRequestFieldsFromPlainText(raw, input.maxQuestionsPerCycle);
            if (fromPlainText.length > 0) return fromPlainText;
            return needSignalFallbackFields;
          })();
    const fields = forceDataRequestFieldsOptional(
      limitDataRequestFields(generatedFields, input.maxQuestionsPerCycle)
    );
    const subject =
      typeof parsed?.subject === 'string' && parsed.subject.trim()
        ? parsed.subject.trim()
        : plainTextSubjectIntro.subject;
    const introText =
      typeof parsed?.introText === 'string' && parsed.introText.trim()
        ? parsed.introText.trim()
        : plainTextSubjectIntro.introText;
    if (fields.length > 0) {
      return {
        fields,
        ...(subject ? { subject } : {}),
        ...(introText ? { introText } : {}),
      };
    }
  } catch (error) {
    console.warn('Free AI data request field generation failed:', error);
  }

  const fallbackFields =
    input.targetLanguage.code === 'de'
      ? [
          {
            key: 'facts_core',
            label: 'Welche konkreten Fakten fehlen noch aus Ihrer Sicht?',
            type: 'short_text',
            required: false,
          },
          {
            key: 'facts_timeframe',
            label: 'Auf welchen Zeitraum oder Zeitpunkt beziehen sich diese Angaben?',
            type: 'short_text',
            required: false,
          },
          {
            key: 'facts_additional_sources',
            label: 'Gibt es weitere Quellen, Beteiligte oder Nachweise?',
            type: 'short_text',
            required: false,
          },
        ]
      : [
          {
            key: 'facts_core',
            label: 'Which concrete facts are still missing?',
            type: 'short_text',
            required: false,
          },
          {
            key: 'facts_timeframe',
            label: 'Which time frame or timestamp do these details refer to?',
            type: 'short_text',
            required: false,
          },
          {
            key: 'facts_additional_sources',
            label: 'Are there additional sources, involved persons or evidence?',
            type: 'short_text',
            required: false,
          },
        ];
  return {
    fields: forceDataRequestFieldsOptional(
      limitDataRequestFields(normalizeDataRequestFields(fallbackFields), input.maxQuestionsPerCycle)
    ),
  };
}

async function executeDataRequestTask(
  execution: WorkflowExecution,
  task: WorkflowTask,
  mode: 'static' | 'enhanced_ai' | 'free_ai'
) {
  const { ticket, description, address, locationText, imageContext } = await loadTicketContext(execution);
  const aiKind: DataRequestAiKind | null =
    mode === 'enhanced_ai' ? 'enhanced' : mode === 'free_ai' ? 'free' : null;
  const isAiMode = aiKind !== null;
  const recipientType = task.config?.recipientType === 'custom' ? 'custom' : 'citizen';
  const configuredRecipient =
    recipientType === 'custom'
      ? await resolveConfiguredOrgUnitRecipient(task.config || {}, {
          tenantId: ticket?.tenant_id || null,
          ticketId: ticket?.id || execution.ticketId,
        })
      : null;
  const recipientEmails =
    recipientType === 'custom'
      ? Array.isArray(configuredRecipient?.recipientEmails)
        ? configuredRecipient.recipientEmails.filter(Boolean)
        : []
      : String(ticket.citizen_email || '').trim()
      ? [String(ticket.citizen_email || '').trim()]
      : [];
  const recipientEmail =
    recipientEmails.length > 0
      ? recipientEmails.join(', ')
      : recipientType === 'custom'
      ? String(configuredRecipient?.recipientEmail || '').trim()
      : String(ticket.citizen_email || '').trim();
  const recipientName =
    recipientType === 'custom'
      ? String(configuredRecipient?.recipientName || '').trim()
      : String(ticket.citizen_name || '').trim();

  if (
    recipientType === 'custom' &&
    configuredRecipient?.recipientSource === 'org_unit' &&
    !recipientEmail
  ) {
    throw new Error('Die gewählte Organisationseinheit hat keine Kontakt-E-Mail.');
  }
  if (
    recipientType === 'custom' &&
    configuredRecipient?.recipientSource === 'ticket_primary_assignee' &&
    !recipientEmail
  ) {
    throw new Error('Für die Primär-Zuweisung ist keine Empfänger-E-Mail vorhanden.');
  }
  if (
    recipientType === 'custom' &&
    configuredRecipient?.recipientSource === 'ticket_collaborators' &&
    !recipientEmail
  ) {
    throw new Error('Für die Beteiligten sind keine Empfänger-E-Mails vorhanden.');
  }

  if (!recipientEmail) {
    throw new Error('Kein Empfänger für Datennachforderung konfiguriert.');
  }

  const targetLanguage = resolveCitizenTargetLanguage(ticket);
  const maxQuestionsPerCycle =
    isAiMode ? resolveAiDataRequestMaxQuestions(task) : 25;
  const maxCycles = isAiMode ? resolveAiDataRequestMaxCycles(task) : 1;
  const cycleIndex = 1;

  let needCheckResult: {
    confidence: number | null;
    categoryConfidence: number | null;
    priorityConfidence: number | null;
    missingSignals: string[];
  } | null = null;

  if (isAiMode && task.config?.enableNeedCheck === true) {
    const needCheck =
      aiKind === 'enhanced'
        ? await evaluateEnhancedCategorizationNeed({
            execution,
            task,
            ticket,
            description,
            locationText,
            imageContext,
          })
        : await evaluateFreeDataRequestNeed({
            execution,
            task,
            ticket,
            description,
            locationText,
            imageContext,
          });
    const aiStepLabel =
      aiKind === 'enhanced' ? 'KI-basierte Datennachforderung' : 'Freie KI-Datennachforderung';
    const needCheckSource = aiKind === 'enhanced' ? 'enhanced_need_check' : 'free_need_check';
    needCheckResult = {
      confidence: needCheck.confidence,
      categoryConfidence: needCheck.categoryConfidence,
      priorityConfidence: needCheck.priorityConfidence,
      missingSignals: needCheck.missingSignals,
    };
    if (!needCheck.requiresAdditionalData) {
      const reasonText = needCheck.reasoning || 'KI-Pruefung: keine zusaetzlichen Angaben erforderlich.';
      await appendTicketComment({
        ticketId: execution.ticketId,
        executionId: execution.id,
        taskId: task.id,
        authorType: 'ai',
        visibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
        commentType: 'classification',
        content: `${aiStepLabel} uebersprungen. ${reasonText}`,
        metadata: {
          source: needCheckSource,
          requiresAdditionalData: false,
          confidence: needCheck.confidence,
          categoryConfidence: needCheck.categoryConfidence,
          priorityConfidence: needCheck.priorityConfidence,
          missingSignals: needCheck.missingSignals,
        },
      });
      appendWorkflowHistory(
        execution,
        'TASK_DATA',
        `${aiStepLabel} wurde nach Vorpruefung uebersprungen.`,
        {
          taskId: task.id,
          taskTitle: task.title,
          taskType: task.type,
          metadata: {
            requiresAdditionalData: false,
            confidence: needCheck.confidence,
            categoryConfidence: needCheck.categoryConfidence,
            priorityConfidence: needCheck.priorityConfidence,
            missingSignals: needCheck.missingSignals,
            reasoning: needCheck.reasoning,
          },
        }
      );
      return {
        skipped: true,
        reason: reasonText,
        dataRequestNeedCheck: {
          requiresAdditionalData: false,
          confidence: needCheck.confidence,
          categoryConfidence: needCheck.categoryConfidence,
          priorityConfidence: needCheck.priorityConfidence,
        },
      };
    }
  }

  const generated =
    aiKind === 'enhanced'
      ? await generateEnhancedCategorizationFields({
          execution,
          task,
          ticket,
          description,
          locationText,
          imageContext,
          targetLanguage,
          maxQuestionsPerCycle,
          cycleIndex,
          maxCycles,
          previousAnswers: {},
          needCheck: needCheckResult,
        })
      : aiKind === 'free'
      ? await generateFreeAiDataRequestFields({
          execution,
          task,
          ticket,
          description,
          locationText,
          imageContext,
          targetLanguage,
          maxQuestionsPerCycle,
          cycleIndex,
          maxCycles,
          previousAnswers: {},
          needCheck: needCheckResult,
        })
      : {
          fields: normalizeDataRequestFields(task.config?.fields),
        };
  const rawFields = limitDataRequestFields(
    generated.fields || [],
    isAiMode ? maxQuestionsPerCycle : Math.max(1, (generated.fields || []).length)
  );
  const fields = isAiMode ? forceDataRequestFieldsOptional(rawFields) : rawFields;
  if (fields.length === 0) {
    throw new Error('Datennachforderung benötigt mindestens ein Feld.');
  }

  const { values: generalSettings } = await loadGeneralSettings();
  const defaultTimeoutHours =
    isAiMode
      ? Number(generalSettings.citizenFrontend?.enhancedCategorizationTimeoutHours || DEFAULT_DATA_REQUEST_TIMEOUT_HOURS)
      : Number(generalSettings.citizenFrontend?.dataRequestTimeoutHours || DEFAULT_DATA_REQUEST_TIMEOUT_HOURS);
  const timeoutMs = resolveStepTimeoutMs(task.config || {}, defaultTimeoutHours || DEFAULT_DATA_REQUEST_TIMEOUT_HOURS);
  const expiresAtDate = new Date(Date.now() + timeoutMs);
  const expiresAt = expiresAtDate.toISOString();
  const expiresAtSql = toSqlDateTime(expiresAtDate);
  const token = crypto.randomBytes(32).toString('hex');
  const requestId = `wdr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const parallelMode = task.config?.parallelMode !== false;
  const configuredTemplateId =
    typeof task.config?.templateId === 'string' && task.config.templateId.trim()
      ? task.config.templateId.trim()
      : 'workflow-data-request';
  const baseSubjectForForm = String(
    generated.subject || task.config?.subject || 'Rueckfragen zu Ihrer Meldung'
  ).trim();
  const baseIntro = String(
    generated.introText ||
      task.config?.introText ||
      'Für die weitere Bearbeitung benötigen wir zusätzliche Angaben zu Ihrer Meldung.'
  ).trim();
  const citizenContent =
    recipientType === 'custom'
      ? {
          fields,
          subject: baseSubjectForForm,
          introText: baseIntro,
        }
      : await buildCitizenTargetDataRequestContent({
          fields,
          subject: baseSubjectForForm,
          introText: baseIntro,
          targetLanguage,
        });
  const localizedFields = normalizeDataRequestFields(citizenContent.fields);
  const subjectForForm = String(citizenContent.subject || baseSubjectForForm).trim() || baseSubjectForForm;
  const intro = String(citizenContent.introText || baseIntro).trim() || baseIntro;
  const uiLocale =
    recipientType === 'custom'
      ? { ...DATA_REQUEST_UI_LOCALE_DE }
      : await buildCitizenDataRequestUiLocale(targetLanguage);
  const adminGermanContent = await buildAdminGermanDataRequestContent({
    fields,
    subject: baseSubjectForForm,
    introText: baseIntro,
    sourceLanguage: targetLanguage,
  });

  const db = getDatabase();
  await db.run(
    `INSERT INTO workflow_data_requests (
      id, execution_id, task_id, ticket_id, token, status, parallel_mode, requested_questions_json, expires_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      requestId,
      execution.id,
      task.id,
      execution.ticketId,
      token,
      parallelMode ? 1 : 0,
      serializeStoredDataRequestPayload({
        fields: localizedFields,
        subject: subjectForForm,
        introText: intro,
        languageCode: targetLanguage.code,
        languageName: targetLanguage.name,
        cycle: cycleIndex,
        maxCycles,
        adminFieldsDe: adminGermanContent.fields,
        adminSubjectDe: adminGermanContent.subject,
        adminIntroTextDe: adminGermanContent.introText,
        uiLocale,
      }),
      expiresAtSql,
    ]
  );

  const formLink = buildDataRequestLink(generalSettings.callbackUrl, token);
  const statusToken = await ensureTicketStatusToken(db, ticket);
  const statusLink = buildTicketStatusCallbackLink(generalSettings.callbackUrl, {
    token: statusToken,
  });

  const requestFieldsSummary = localizedFields
    .map((field, index) => `${index + 1}. ${field.label}${field.required ? ' (Pflicht)' : ''}`)
    .join('\n');
  const expiresAtLabel = expiresAtDate.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const templateData = buildWorkflowEmailTemplateData({
    ticket,
    description,
    address,
    locationText,
    coordinates: '',
    recipientName,
    recipientEmail,
    statusLink,
    formLink,
    requestFieldsSummary,
    expiresAt: expiresAtLabel,
    introText: intro,
    customMessage: intro,
  });
  const template = await loadTemplateFile(configuredTemplateId, asTrimmedString(ticket?.tenant_id));
  const fallback = buildDefaultDataRequestHtml(templateData);
  const subject = template ? renderTemplate(template.subject, templateData) : fallback.subject;
  const html = template ? renderTemplate(template.htmlContent, templateData) : fallback.html;
  const text = template
    ? renderTemplate(template.textContent || htmlToPlainText(html), templateData)
    : fallback.text;
  const htmlWithReporter = appendReporterContextToEmailHtml(html, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });
  const textWithReporter = appendReporterContextToPlainText(text, {
    citizenName: ticket.citizen_name || '',
    citizenEmail: ticket.citizen_email || '',
  });
  const sent = await sendEmail({
    to: recipientEmail,
    subject,
    html: htmlWithReporter,
    text: textWithReporter,
    translateForCitizen: recipientType !== 'custom',
    translationTemplateId: configuredTemplateId,
    translationTemplateData: templateData,
  });
  if (!sent) {
    throw new Error('Datennachforderungs-E-Mail konnte nicht versendet werden.');
  }

  await appendTicketComment({
    ticketId: execution.ticketId,
    executionId: execution.id,
    taskId: task.id,
    authorType: 'system',
    visibility: 'internal',
    commentType: 'data_request',
    content: `${isAiMode ? 'KI-' : ''}Datennachforderung (Zyklus ${cycleIndex}/${maxCycles}) an ${recipientEmail} versendet.`,
    metadata: {
      requestId,
      cycle: cycleIndex,
      maxCycles,
      targetLanguage,
      recipientEmail,
      templateId: configuredTemplateId,
      fields: localizedFields.map((entry) => ({ key: entry.key, type: entry.type, required: entry.required })),
      parallelMode,
      expiresAt,
      maxQuestionsPerCycle: isAiMode ? maxQuestionsPerCycle : undefined,
    },
  });

  const executionData: WorkflowExecutionData = {
    dataRequestId: requestId,
    dataRequestToken: token,
    dataRequestMode: isAiMode ? 'ai' : 'static',
    dataRequestParallel: parallelMode,
    dataRequestFields: localizedFields,
    dataRequestLink: formLink,
    dataRequestCycle: cycleIndex,
    dataRequestMaxCycles: maxCycles,
    dataRequestMaxQuestionsPerCycle: isAiMode ? maxQuestionsPerCycle : undefined,
    dataRequestSubject: subjectForForm,
    dataRequestIntroText: intro,
    dataRequestTargetLanguage: targetLanguage.code,
    dataRequestTargetLanguageName: targetLanguage.name,
    recipientEmail,
    recipientEmails,
    dataRequestTemplateId: configuredTemplateId,
    expiresAt,
  };
  if (needCheckResult) {
    executionData.dataRequestNeedCheck = {
      requiresAdditionalData: true,
      confidence: needCheckResult.confidence,
      categoryConfidence: needCheckResult.categoryConfidence,
      priorityConfidence: needCheckResult.priorityConfidence,
    };
  }
  if (!parallelMode) {
    executionData.awaitingUntil = expiresAt;
    executionData.awaitingConfirmation = true;
  }
  return executionData;
}

async function executeEnhancedCategorizationTask(execution: WorkflowExecution, task: WorkflowTask) {
  return executeDataRequestTask(execution, task, 'enhanced_ai');
}

async function executeFreeAiDataRequestTask(execution: WorkflowExecution, task: WorkflowTask) {
  return executeDataRequestTask(execution, task, 'free_ai');
}

interface CategorizationOrgAssignmentTrace {
  enabled: boolean;
  tenantId: string;
  selectedOrgUnitId: string | null;
  selectedOrgUnitLabel: string | null;
  selectionMode: 'disabled' | 'ai' | 'fallback' | 'none';
  confidence: number | null;
  reasoning: string;
  fallbackOrgUnitId: string | null;
  candidateCount: number;
  appliedPatch: Record<string, any> | null;
  error?: string;
}

function buildOrgUnitPathLabelsForWorkflow(
  rows: Array<{ id: string; parentId: string | null; name: string }>
): Map<string, string> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const cache = new Map<string, string>();

  const resolvePath = (id: string): string => {
    if (!id) return '';
    if (cache.has(id)) return cache.get(id) || '';
    const row = byId.get(id);
    if (!row) {
      cache.set(id, id);
      return id;
    }

    const segments = [row.name || id];
    const guard = new Set<string>([id]);
    let currentParentId = row.parentId || null;
    while (currentParentId && byId.has(currentParentId) && !guard.has(currentParentId)) {
      guard.add(currentParentId);
      const parent = byId.get(currentParentId) as { id: string; parentId: string | null; name: string };
      segments.unshift(parent.name || parent.id);
      currentParentId = parent.parentId || null;
    }

    const path = segments.join(' / ');
    cache.set(id, path);
    return path;
  };

  rows.forEach((row) => {
    resolvePath(row.id);
  });
  return cache;
}

async function resolveCategorizationOrgAssignment(
  execution: WorkflowExecution,
  task: WorkflowTask,
  input: {
    category: string;
    priority: string;
    categorizationReasoning: string;
  }
): Promise<CategorizationOrgAssignmentTrace> {
  if (task.config?.enableOrgUnitAssignment !== true) {
    return {
      enabled: false,
      tenantId: '',
      selectedOrgUnitId: null,
      selectedOrgUnitLabel: null,
      selectionMode: 'disabled',
      confidence: null,
      reasoning: '',
      fallbackOrgUnitId: null,
      candidateCount: 0,
      appliedPatch: null,
    };
  }

  const { ticket, description, locationText, imageContext } = await loadTicketContext(execution);
  const tenantId = asTrimmedString(ticket?.tenant_id);
  if (!tenantId) {
    return {
      enabled: true,
      tenantId: '',
      selectedOrgUnitId: null,
      selectedOrgUnitLabel: null,
      selectionMode: 'none',
      confidence: null,
      reasoning: 'Keine tenant_id im Ticket gefunden.',
      fallbackOrgUnitId: null,
      candidateCount: 0,
      appliedPatch: null,
      error: 'missing_tenant_context',
    };
  }

  const db = getDatabase();
  const orgRowsRaw = await db.all(
    `SELECT id, parent_id, name, contact_email
     FROM org_units
     WHERE tenant_id = ?
       AND COALESCE(active, 1) = 1
     ORDER BY LOWER(COALESCE(name, '')), id`,
    [tenantId]
  );
  const orgRows = (orgRowsRaw || [])
    .map((row: any) => ({
      id: asTrimmedString(row?.id),
      parentId: asTrimmedString(row?.parent_id) || null,
      name: asTrimmedString(row?.name),
      contactEmail: asTrimmedString(row?.contact_email),
    }))
    .filter((row: { id: string; parentId: string | null; name: string; contactEmail: string }) => !!row.id && !!row.name);
  const labelsById = buildOrgUnitPathLabelsForWorkflow(
    orgRows.map((row: { id: string; parentId: string | null; name: string }) => ({
      id: row.id,
      parentId: row.parentId,
      name: row.name,
    }))
  );
  const candidates = orgRows
    .map((row: { id: string; parentId: string | null; name: string; contactEmail: string }) => ({
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      label: labelsById.get(row.id) || row.name || row.id,
      contactEmail: row.contactEmail || null,
    }))
    .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'de'));
  const fallbackOrgUnitId = asTrimmedString(
    task.config?.orgAssignmentFallbackOrgUnitId || task.config?.fallbackOrgUnitId
  );
  const fallbackCandidate = fallbackOrgUnitId
    ? candidates.find((candidate) => candidate.id === fallbackOrgUnitId) || null
    : null;

  if (candidates.length === 0) {
    return {
      enabled: true,
      tenantId,
      selectedOrgUnitId: null,
      selectedOrgUnitLabel: null,
      selectionMode: 'none',
      confidence: null,
      reasoning: 'Keine aktiven Organisationseinheiten im Ticket-Mandanten vorhanden.',
      fallbackOrgUnitId: fallbackOrgUnitId || null,
      candidateCount: 0,
      appliedPatch: null,
    };
  }

  let aiCandidateId = '';
  let confidence: number | null = null;
  let reasoning = '';
  let aiError = '';
  try {
    const promptBase = await getSystemPrompt('workflowCategorizationOrgAssignmentPrompt');
    const maxPromptCandidates = 200;
    const promptCandidates = candidates.slice(0, maxPromptCandidates);
    const candidateLines = promptCandidates
      .map((entry, index) => {
        const emailLabel = entry.contactEmail ? ` | email=${entry.contactEmail}` : '';
        return `${index + 1}. id=${entry.id} | pfad=${entry.label}${emailLabel}`;
      })
      .join('\n');
    const prompt = `${promptBase}

Mandant:
- tenantId: ${tenantId}
- Kandidaten gesamt: ${candidates.length}

Ticket:
- ID: ${asTrimmedString(ticket?.id || execution.ticketId)}
- Kategorie: ${asTrimmedString(input.category)}
- Prioritaet: ${asTrimmedString(input.priority)}
- Status: ${asTrimmedString(ticket?.status)}
- Ort: ${asTrimmedString(locationText)}
- Beschreibung: ${String(description || '').slice(0, 2400)}
- Kategorisierungsbegruendung: ${asTrimmedString(input.categorizationReasoning)}
- KI-Bildbeschreibungen:
${String(imageContext || 'Keine KI-Bildbeschreibungen vorhanden.').slice(0, 2400)}

Kandidaten (verbindliche IDs):
${candidateLines}

Prozessvariablen (Summary):
${buildExecutionProcessVariableSummary(execution)}
`.trim();

    const raw = await testAIProviderForTicketPrompt({
      prompt,
      purpose: 'workflow_categorization_org_assignment',
      meta: {
        source: 'routes.workflows.categorization.org_assignment',
        ticketId: execution.ticketId,
        taskId: task.id,
        tenantId,
      },
      ticket,
    });
    const parsed = extractJsonPayload(raw);
    const candidateIdRaw = asTrimmedString(
      parsed?.orgUnitId ??
        parsed?.primaryAssigneeOrgUnitId ??
        parsed?.assignment?.orgUnitId ??
        parsed?.id ??
        ''
    );
    aiCandidateId = /^(none|null|keine|leer)$/i.test(candidateIdRaw) ? '' : candidateIdRaw;
    reasoning = asTrimmedString(parsed?.reasoning || parsed?.explanation || parsed?.why);
    const confidenceRaw = Number(parsed?.confidence ?? parsed?.score ?? NaN);
    confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : null;
  } catch (error) {
    aiError = error instanceof Error ? error.message : String(error || 'unbekannt');
  }

  let selectedCandidate = aiCandidateId
    ? candidates.find((candidate) => candidate.id === aiCandidateId) || null
    : null;
  if (!selectedCandidate && aiCandidateId) {
    const normalized = aiCandidateId.toLowerCase();
    selectedCandidate =
      candidates.find((candidate) => candidate.name.toLowerCase() === normalized) ||
      candidates.find((candidate) => candidate.label.toLowerCase() === normalized) ||
      null;
  }

  let selectionMode: CategorizationOrgAssignmentTrace['selectionMode'] = 'none';
  if (selectedCandidate) {
    selectionMode = 'ai';
  } else if (fallbackCandidate) {
    selectedCandidate = fallbackCandidate;
    selectionMode = 'fallback';
  }

  if (!selectedCandidate) {
    return {
      enabled: true,
      tenantId,
      selectedOrgUnitId: null,
      selectedOrgUnitLabel: null,
      selectionMode: 'none',
      confidence,
      reasoning:
        reasoning ||
        (aiError
          ? `KI-Auswahl fehlgeschlagen (${aiError}).`
          : 'Keine belastbare Organisationseinheit bestimmt.'),
      fallbackOrgUnitId: fallbackOrgUnitId || null,
      candidateCount: candidates.length,
      appliedPatch: null,
      ...(aiError ? { error: aiError } : {}),
    };
  }

  let appliedPatch: Record<string, any> | null = null;
  const currentPrimaryUserId = asTrimmedString(ticket?.primary_assignee_user_id);
  const currentPrimaryOrgUnitId = asTrimmedString(ticket?.primary_assignee_org_unit_id);
  const assignmentAlreadyMatches = !currentPrimaryUserId && currentPrimaryOrgUnitId === selectedCandidate.id;
  if (!assignmentAlreadyMatches) {
    appliedPatch = await applyWorkflowTicketPatch(execution, {
      primaryAssigneeUserId: '',
      primaryAssigneeOrgUnitId: selectedCandidate.id,
    });
  }

  return {
    enabled: true,
    tenantId,
    selectedOrgUnitId: selectedCandidate.id,
    selectedOrgUnitLabel: selectedCandidate.label,
    selectionMode,
    confidence,
    reasoning:
      reasoning ||
      (selectionMode === 'fallback'
        ? 'Fallback-Organisationseinheit verwendet.'
        : 'Organisationseinheit ueber KI-Auswahl bestimmt.'),
    fallbackOrgUnitId: fallbackOrgUnitId || null,
    candidateCount: candidates.length,
    appliedPatch,
    ...(aiError ? { error: aiError } : {}),
  };
}

async function executeCategorizationTask(
  execution: WorkflowExecution,
  task: WorkflowTask
): Promise<WorkflowExecutionData> {
  const suggestionPayload = await buildCategorizationSuggestionForTicket(execution.ticketId);
  const applied = await applyCategorizationSuggestionToTicket({
    ticketId: execution.ticketId,
    suggestion: suggestionPayload.suggestion,
    rawDecision: suggestionPayload.rawDecision,
    knowledgeVersion: suggestionPayload.knowledgeVersion,
    source: 'workflow_step_categorization',
    executionId: execution.id,
    taskId: task.id,
    commentVisibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
  });

  const startCategoryWorkflow = task.config?.startCategoryWorkflow !== false;
  const endCurrentWorkflow = task.config?.endCurrentWorkflow !== false;
  const fallbackTemplateId = String(task.config?.fallbackTemplateId || 'standard-redmine-ticket').trim();
  const targetTemplateId = resolveCategoryWorkflowTemplateId(
    suggestionPayload.knowledge,
    applied.category,
    fallbackTemplateId
  );
  let orgAssignment: CategorizationOrgAssignmentTrace;
  try {
    orgAssignment = await resolveCategorizationOrgAssignment(execution, task, {
      category: applied.category,
      priority: applied.priority,
      categorizationReasoning: applied.reasoning || '',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unbekannt');
    orgAssignment = {
      enabled: task.config?.enableOrgUnitAssignment === true,
      tenantId: '',
      selectedOrgUnitId: null,
      selectedOrgUnitLabel: null,
      selectionMode: 'none',
      confidence: null,
      reasoning: `Org-Zuweisung fehlgeschlagen: ${message}`,
      fallbackOrgUnitId: asTrimmedString(
        task.config?.orgAssignmentFallbackOrgUnitId || task.config?.fallbackOrgUnitId
      ) || null,
      candidateCount: 0,
      appliedPatch: null,
      error: message,
    };
  }

  if (orgAssignment.enabled && task.config?.addAiComment !== false && orgAssignment.selectedOrgUnitId) {
    const isFallbackAssignment = orgAssignment.selectionMode === 'fallback';
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: isFallbackAssignment ? 'system' : 'ai',
      visibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
      commentType: 'decision',
      content: isFallbackAssignment
        ? `Organisationseinheit gesetzt (Fallback): "${orgAssignment.selectedOrgUnitLabel || orgAssignment.selectedOrgUnitId}".`
        : `Organisationseinheit gesetzt: "${orgAssignment.selectedOrgUnitLabel || orgAssignment.selectedOrgUnitId}".`,
      metadata: {
        source: 'workflow_step_categorization_org_assignment',
        orgUnitId: orgAssignment.selectedOrgUnitId,
        orgUnitLabel: orgAssignment.selectedOrgUnitLabel,
        selectionMode: orgAssignment.selectionMode,
        confidence: orgAssignment.confidence,
        reasoning: orgAssignment.reasoning || null,
        fallbackOrgUnitId: orgAssignment.fallbackOrgUnitId,
        candidateCount: orgAssignment.candidateCount,
        appliedPatch: orgAssignment.appliedPatch,
      },
    });
  } else if (orgAssignment.enabled && orgAssignment.error) {
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'system',
      visibility: 'internal',
      commentType: 'note',
      content: 'Optionale Org-Zuweisung im Kategorisierungsschritt konnte nicht per KI bestimmt werden.',
      metadata: {
        source: 'workflow_step_categorization_org_assignment',
        error: orgAssignment.error,
        fallbackOrgUnitId: orgAssignment.fallbackOrgUnitId,
      },
    });
  }

  appendWorkflowHistory(execution, 'TASK_DATA', 'Kategorisierungsschritt hat Ticket neu klassifiziert.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: {
      category: applied.category,
      priority: applied.priority,
      targetTemplateId,
      startCategoryWorkflow,
      endCurrentWorkflow,
      orgAssignment: {
        enabled: orgAssignment.enabled,
        tenantId: orgAssignment.tenantId,
        selectedOrgUnitId: orgAssignment.selectedOrgUnitId,
        selectedOrgUnitLabel: orgAssignment.selectedOrgUnitLabel,
        selectionMode: orgAssignment.selectionMode,
        confidence: orgAssignment.confidence,
        reasoning: orgAssignment.reasoning || null,
        fallbackOrgUnitId: orgAssignment.fallbackOrgUnitId,
        candidateCount: orgAssignment.candidateCount,
        appliedPatch: orgAssignment.appliedPatch,
        error: orgAssignment.error || null,
      },
    },
  });

  if (!startCategoryWorkflow) {
    return {
      aiDecision: {
        decision: applied.category,
        confidence: 1,
        reason: applied.reasoning || 'Ticket klassifiziert.',
        fallbackUsed: false,
      },
      ...(endCurrentWorkflow ? { endScope: 'workflow' as const } : {}),
    };
  }

  const config = await loadWorkflowConfig();
  const templates = (config.templates || []).filter((template) => template.enabled !== false);
  const selectedTemplate =
    templates.find((template) => template.id === targetTemplateId) ||
    templates.find((template) => template.id === 'standard-redmine-ticket') ||
    templates[0];

  if (!selectedTemplate) {
    return {
      aiDecision: {
        decision: applied.category,
        confidence: 0,
        reason: 'Keine Workflow-Vorlage verfügbar.',
        fallbackUsed: true,
      },
      ...(endCurrentWorkflow ? { endScope: 'workflow' as const } : {}),
    };
  }

  const sameTemplate = selectedTemplate.id === execution.templateId;
  if (sameTemplate && task.config?.allowSameTemplateSwitch !== true) {
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'system',
      visibility: 'internal',
      commentType: 'decision',
      content:
        'Kategorisierung hat dieselbe Workflowvorlage ermittelt wie aktuell aktiv. Kein Wechsel ausgelöst.',
      metadata: {
        templateId: selectedTemplate.id,
        category: applied.category,
      },
    });
    return {
      aiDecision: {
        decision: applied.category,
        confidence: 1,
        reason: `Template ${selectedTemplate.id} ist bereits aktiv.`,
        fallbackUsed: false,
      },
      ...(endCurrentWorkflow ? { endScope: 'workflow' as const } : {}),
    };
  }

  const nextExecution = await buildExecutionFromTemplate(execution.ticketId, selectedTemplate);
  if (task.config?.addAiComment !== false) {
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'ai',
      visibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
      commentType: 'decision',
      content: `Kategorieworkflow "${selectedTemplate.name}" wird gestartet und aktueller Workflow beendet.`,
      metadata: {
        templateId: selectedTemplate.id,
        category: applied.category,
        priority: applied.priority,
      },
    });
  }

  return {
    aiDecision: {
      decision: applied.category,
      confidence: 1,
      reason: applied.reasoning || 'Ticket klassifiziert.',
      fallbackUsed: selectedTemplate.id !== targetTemplateId,
    },
    changeWorkflow: {
      templateId: selectedTemplate.id,
      execution: nextExecution,
      selectionMode: 'manual',
      reasoning: `Kategorie ${applied.category} -> Workflow ${selectedTemplate.id}`,
    },
    ...(endCurrentWorkflow ? { endScope: 'workflow' as const } : {}),
  };
}

async function executeResponsibilityCheckTask(
  execution: WorkflowExecution,
  task: WorkflowTask
): Promise<WorkflowExecutionData> {
  const suggestionPayload = await buildResponsibilitySuggestionForTicket(execution.ticketId);
  const suggestion = suggestionPayload.suggestion;
  const applyToTicket = task.config?.applyToTicket !== false;
  const addAiComment = task.config?.addAiComment !== false;
  let applied: Awaited<ReturnType<typeof applyResponsibilitySuggestionToTicket>> | null = null;

  if (applyToTicket) {
    applied = await applyResponsibilitySuggestionToTicket({
      ticketId: execution.ticketId,
      suggestion,
      source: 'workflow_step_responsibility_check',
      executionId: execution.id,
      taskId: task.id,
      commentVisibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
      addComment: addAiComment,
    });
  } else if (addAiComment) {
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'ai',
      visibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
      commentType: 'decision',
      content: `KI-Zustaendigkeitsvorschlag: "${suggestion.responsibilityAuthority}".`,
      metadata: {
        source: 'workflow_step_responsibility_check_preview',
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
        legalBasis: suggestion.legalBasis,
        notes: suggestion.notes,
      },
    });
  }

  appendWorkflowHistory(execution, 'TASK_DATA', 'Zustaendigkeit geprueft.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: {
      responsibilityAuthority: suggestion.responsibilityAuthority,
      confidence: suggestion.confidence,
      applied: applyToTicket,
      changed: applied?.changed ?? null,
    },
  });

  return {
    aiDecision: {
      decision: suggestion.responsibilityAuthority,
      confidence:
        Number.isFinite(Number(suggestion.confidence))
          ? Math.max(0, Math.min(1, Number(suggestion.confidence)))
          : 0.5,
      reason: suggestion.reasoning || 'Zustaendigkeit geprueft.',
      fallbackUsed: false,
    },
    responsibilitySuggestion: {
      authority: suggestion.responsibilityAuthority,
      confidence: suggestion.confidence,
      reasoning: suggestion.reasoning,
      legalBasis: suggestion.legalBasis,
      notes: suggestion.notes,
      allowedAuthorities: suggestionPayload.allowedAuthorities,
      applied: applyToTicket,
      changed: applied?.changed ?? null,
    },
  };
}

function parseWaitDuration(config: Record<string, any>): { waitMs: number; waitMinutes: number } {
  const waitSeconds =
    Number(config?.waitSeconds ?? config?.delaySeconds ?? config?.seconds ?? 0) || 0;
  const waitMinutes =
    Number(config?.waitMinutes ?? config?.delayMinutes ?? config?.minutes ?? 0) || 0;
  const waitHours =
    Number(config?.waitHours ?? config?.delayHours ?? config?.hours ?? 0) || 0;

  const totalSeconds = waitSeconds + waitMinutes * 60 + waitHours * 3600;
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    throw new Error('Wartezeit muss groesser als 0 sein');
  }
  return { waitMs: totalSeconds * 1000, waitMinutes: totalSeconds / 60 };
}

function normalizeWaitFieldMode(value: unknown): 'keep' | 'set' {
  return String(value || '').trim().toLowerCase() === 'set' ? 'set' : 'keep';
}

function parseWaitAssignmentTarget(value: unknown): {
  assigneeUserId: string;
  assigneeOrgUnitId: string;
  legacyAssignedTo: string;
} {
  const raw = asTrimmedString(value);
  if (!raw) {
    return { assigneeUserId: '', assigneeOrgUnitId: '', legacyAssignedTo: '' };
  }
  const lowered = raw.toLowerCase();
  if (lowered.startsWith('user:')) {
    return {
      assigneeUserId: asTrimmedString(raw.slice(5)),
      assigneeOrgUnitId: '',
      legacyAssignedTo: '',
    };
  }
  if (lowered.startsWith('org:') || lowered.startsWith('unit:')) {
    const valuePart = raw.includes(':') ? raw.split(':').slice(1).join(':') : '';
    return {
      assigneeUserId: '',
      assigneeOrgUnitId: asTrimmedString(valuePart),
      legacyAssignedTo: '',
    };
  }
  if (lowered.startsWith('assigned:')) {
    return {
      assigneeUserId: '',
      assigneeOrgUnitId: '',
      legacyAssignedTo: asTrimmedString(raw.slice(9)),
    };
  }
  return {
    assigneeUserId: '',
    assigneeOrgUnitId: '',
    legacyAssignedTo: raw,
  };
}

function buildWaitTicketPatchFromConfig(configRaw: unknown): Record<string, any> | null {
  if (!configRaw || typeof configRaw !== 'object' || Array.isArray(configRaw)) return null;
  const config = configRaw as Record<string, any>;
  const patch: Record<string, any> = {};

  const hasStatusMode = Object.prototype.hasOwnProperty.call(config, 'statusMode');
  const fallbackStatus = String(config?.statusAfter ?? config?.targetStatus ?? '').trim();
  const statusMode = hasStatusMode
    ? normalizeWaitFieldMode(config?.statusMode)
    : fallbackStatus
    ? 'set'
    : 'keep';
  if (statusMode === 'set') {
    const status = String(config?.statusAfter ?? config?.targetStatus ?? '').trim();
    if (!status || !TICKET_STATUS_OPTIONS.has(status)) {
      throw new Error('Warte/Statuswechsel: Ungueltiger Zielstatus.');
    }
    patch.status = status;
  }

  if (normalizeWaitFieldMode(config?.priorityMode) === 'set') {
    const priority = String(config?.priorityAfter || '').trim().toLowerCase();
    if (!['low', 'medium', 'high', 'critical'].includes(priority)) {
      throw new Error('Warte/Statuswechsel: Ungueltiger Zielwert fuer Prioritaet.');
    }
    patch.priority = priority;
  }

  const assignStringPatch = (modeKey: string, valueKey: string, patchKey: string) => {
    if (normalizeWaitFieldMode(config?.[modeKey]) !== 'set') return;
    const value =
      config?.[valueKey] === null || config?.[valueKey] === undefined
        ? ''
        : String(config[valueKey]).trim();
    patch[patchKey] = value;
  };

  const assignNumericPatch = (modeKey: string, valueKey: string, patchKey: string) => {
    if (normalizeWaitFieldMode(config?.[modeKey]) !== 'set') return;
    patch[patchKey] = config?.[valueKey];
  };

  if (normalizeWaitFieldMode(config?.assigneeMode) === 'set') {
    const configuredUserId = asTrimmedString(
      config?.assigneeUserIdAfter ||
        config?.primaryAssigneeUserIdAfter ||
        config?.primaryAssigneeUserId ||
        config?.primary_assignee_user_id
    );
    const configuredOrgUnitId = asTrimmedString(
      config?.assigneeOrgUnitIdAfter ||
        config?.primaryAssigneeOrgUnitIdAfter ||
        config?.primaryAssigneeOrgUnitId ||
        config?.primary_assignee_org_unit_id
    );
    const parsedTarget = parseWaitAssignmentTarget(config?.assigneeAfter);
    const assigneeUserId = configuredUserId || parsedTarget.assigneeUserId;
    const assigneeOrgUnitId = assigneeUserId ? '' : configuredOrgUnitId || parsedTarget.assigneeOrgUnitId;
    if (assigneeUserId && assigneeOrgUnitId) {
      throw new Error('Warte/Statuswechsel: Nur Benutzer ODER Organisationseinheit als Primärzuweisung zulässig.');
    }
    const legacyAssignedTo =
      parsedTarget.legacyAssignedTo ||
      asTrimmedString(config?.legacyAssignedToAfter) ||
      assigneeUserId ||
      assigneeOrgUnitId ||
      '';
    patch.primaryAssigneeUserId = assigneeUserId;
    patch.primaryAssigneeOrgUnitId = assigneeOrgUnitId;
    patch.assignedTo = legacyAssignedTo;
  }
  assignStringPatch('categoryMode', 'categoryAfter', 'category');
  assignStringPatch('descriptionMode', 'descriptionAfter', 'description');
  assignStringPatch('addressMode', 'addressAfter', 'address');
  assignStringPatch('postalCodeMode', 'postalCodeAfter', 'postalCode');
  assignStringPatch('cityMode', 'cityAfter', 'city');
  assignStringPatch('responsibilityMode', 'responsibilityAfter', 'responsibilityAuthority');

  assignNumericPatch('latitudeMode', 'latitudeAfter', 'latitude');
  assignNumericPatch('longitudeMode', 'longitudeAfter', 'longitude');

  return Object.keys(patch).length > 0 ? patch : null;
}

async function executeWaitStatusChangeTask(_execution: WorkflowExecution, task: WorkflowTask) {
  const { waitMs, waitMinutes } = parseWaitDuration(task.config || {});
  const ticketPatch = buildWaitTicketPatchFromConfig(task.config || {});

  const awaitingUntil = new Date(Date.now() + waitMs).toISOString();
  const executionData: WorkflowExecutionData = {
    awaitingUntil,
    waitMinutes,
  };
  if (ticketPatch) {
    executionData.ticketPatch = ticketPatch;
    if (typeof ticketPatch.status === 'string') {
      executionData.statusAfter = ticketPatch.status;
    }
  }
  return executionData;
}

function normalizeInternalProcessingMode(value: unknown): InternalProcessingMode {
  return String(value || '').trim().toLowerCase() === 'parallel' ? 'parallel' : 'blocking';
}

function normalizeInternalTaskStatus(value: unknown): InternalTaskStatus {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'in_progress' || raw === 'in-progress') return 'in_progress';
  if (raw === 'completed') return 'completed';
  if (raw === 'rejected') return 'rejected';
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled';
  return 'pending';
}

function normalizeInternalProcessingAssigneeStrategy(
  value: unknown
): InternalProcessingAssigneeStrategy {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'fixed_user') return 'fixed_user';
  if (raw === 'fixed_org') return 'fixed_org';
  if (raw === 'process_variable') return 'process_variable';
  return 'ticket_primary';
}

function normalizeInternalTaskAssignmentUpdateMode(value: unknown): InternalTaskAssignmentUpdateMode {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'primary_only') return 'primary_only';
  if (raw === 'primary_plus_participants') return 'primary_plus_participants';
  return 'none';
}

function normalizeInternalTaskAssignmentSource(value: unknown): InternalTaskAssignmentSource {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'ai_suggested') return 'ai_suggested';
  if (raw === 'mixed') return 'mixed';
  return 'static';
}

function normalizeInternalTaskRejectAllowed(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'ja'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'nein'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeInternalFormFieldType(
  value: unknown
): InternalProcessingFormField['type'] {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'textarea') return 'textarea';
  if (raw === 'boolean') return 'boolean';
  if (raw === 'select') return 'select';
  if (raw === 'date') return 'date';
  if (raw === 'number') return 'number';
  return 'text';
}

function normalizeInternalFormFieldKey(value: unknown, fallback: string): string {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return raw || fallback;
}

function normalizeInternalTaskFormSchema(input: unknown): InternalProcessingFormField[] {
  const source =
    Array.isArray(input)
      ? input
      : input && typeof input === 'object' && Array.isArray((input as any).fields)
      ? (input as any).fields
      : [];
  const fields: InternalProcessingFormField[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index];
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, any>;
    const key = normalizeInternalFormFieldKey(row.key, `field_${index + 1}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const type = normalizeInternalFormFieldType(row.type);
    const label = asTrimmedString(row.label) || key;
    const required = row.required === true;
    const field: InternalProcessingFormField = {
      key,
      label,
      type,
      required,
    };
    const placeholder = asTrimmedString(row.placeholder);
    const helpText = asTrimmedString(row.helpText || row.help_text);
    if (placeholder) field.placeholder = placeholder;
    if (helpText) field.helpText = helpText;
    if (type === 'select') {
      const optionsRaw = Array.isArray(row.options) ? row.options : [];
      const options = optionsRaw
        .map((optionRaw: any) => {
          if (!optionRaw || typeof optionRaw !== 'object') return null;
          const value = asTrimmedString(optionRaw.value);
          const optionLabel = asTrimmedString(optionRaw.label || optionRaw.value);
          if (!value || !optionLabel) return null;
          return { value, label: optionLabel };
        })
        .filter((option: { value: string; label: string } | null): option is {
          value: string;
          label: string;
        } => option !== null);
      if (options.length > 0) {
        field.options = options;
      }
    }
    fields.push(field);
    if (fields.length >= 40) break;
  }

  if (fields.length > 0) return fields;
  return [
    {
      key: 'bearbeitungsnotiz',
      label: 'Bearbeitungsnotiz',
      type: 'textarea',
      required: true,
    },
    {
      key: 'weiterbearbeitung_empfohlen',
      label: 'Weiterbearbeitung empfohlen',
      type: 'boolean',
      required: true,
    },
  ];
}

function normalizeInternalProcessVarMappings(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, any>)) {
    const sourceKey = normalizeInternalFormFieldKey(rawKey, '');
    const targetKey = asTrimmedString(rawValue);
    if (!sourceKey || !targetKey) continue;
    result[sourceKey] = targetKey;
  }
  return result;
}

function parseInternalTaskAssigneeFromVariable(rawValue: unknown): {
  userId: string | null;
  orgUnitId: string | null;
} {
  if (!rawValue) return { userId: null, orgUnitId: null };
  if (typeof rawValue === 'string') {
    const raw = rawValue.trim();
    if (!raw) return { userId: null, orgUnitId: null };
    if (raw.toLowerCase().startsWith('user:')) {
      const userId = asTrimmedString(raw.slice(5));
      return { userId: userId || null, orgUnitId: null };
    }
    if (raw.toLowerCase().startsWith('org:') || raw.toLowerCase().startsWith('unit:')) {
      const orgUnitId = asTrimmedString(raw.split(':').slice(1).join(':'));
      return { userId: null, orgUnitId: orgUnitId || null };
    }
    return { userId: raw || null, orgUnitId: null };
  }
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    const source = rawValue as Record<string, any>;
    const userId = asTrimmedString(source.userId || source.assigneeUserId || source.user_id) || null;
    const orgUnitId =
      asTrimmedString(source.orgUnitId || source.assigneeOrgUnitId || source.org_unit_id) || null;
    if (userId) return { userId, orgUnitId: null };
    return { userId: null, orgUnitId };
  }
  return { userId: null, orgUnitId: null };
}

function resolveInternalTaskDueAtIso(config: Record<string, any>): string | null {
  const dueMinutesRaw = Number(config?.dueMinutes ?? config?.due_minutes ?? 0);
  const dueHoursRaw = Number(config?.dueHours ?? config?.due_hours ?? 0);
  const dueDaysRaw = Number(config?.dueDays ?? config?.due_days ?? 0);
  const dueMinutes = Number.isFinite(dueMinutesRaw) ? Math.max(0, Math.floor(dueMinutesRaw)) : 0;
  const dueHours = Number.isFinite(dueHoursRaw) ? Math.max(0, Math.floor(dueHoursRaw)) : 0;
  const dueDays = Number.isFinite(dueDaysRaw) ? Math.max(0, Math.floor(dueDaysRaw)) : 0;
  const totalMs =
    dueMinutes * MS_PER_MINUTE + dueHours * 60 * MS_PER_MINUTE + dueDays * 24 * 60 * MS_PER_MINUTE;
  if (totalMs <= 0) return null;
  return new Date(Date.now() + totalMs).toISOString();
}

async function insertInternalTaskEvent(
  db: any,
  options: {
    taskId: string;
    eventType: string;
    actorUserId?: string | null;
    payload?: Record<string, any> | null;
  }
) {
  const taskId = asTrimmedString(options.taskId);
  if (!taskId) return;
  await db.run(
    `INSERT INTO workflow_internal_task_events (id, task_id, event_type, actor_user_id, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      `wite_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskId,
      asTrimmedString(options.eventType) || 'update',
      asTrimmedString(options.actorUserId) || null,
      options.payload ? JSON.stringify(sanitizeWorkflowStorageValue(options.payload)) : null,
    ]
  );
}

function mapInternalTaskRow(row: any): Record<string, any> {
  if (!row) return {};
  const mode = normalizeInternalProcessingMode(row.mode);
  const status = normalizeInternalTaskStatus(row.status);
  const formSchema = parseJsonValue(row.form_schema_json, null);
  const responsePayload = parseJsonValue(row.response_json, null);
  const aiMeta = parseJsonValue(row.ai_meta_json, null);
  const allowRejectRaw =
    row.allow_reject !== undefined && row.allow_reject !== null
      ? row.allow_reject
      : (aiMeta as any)?.allowReject;
  const maxCyclesRaw =
    row.max_cycles !== undefined && row.max_cycles !== null ? row.max_cycles : (aiMeta as any)?.maxCycles;
  const cycleIndexRaw =
    row.cycle_index !== undefined && row.cycle_index !== null ? row.cycle_index : (aiMeta as any)?.cycleIndex;
  const assignmentUpdateModeRaw =
    asTrimmedString(row.assignment_update_mode) ||
    asTrimmedString((aiMeta as any)?.assignmentUpdateMode) ||
    'none';
  const assignmentSourceRaw =
    asTrimmedString(row.assignment_source) || asTrimmedString((aiMeta as any)?.assignmentSource) || 'static';
  return {
    id: asTrimmedString(row.id),
    tenantId: asTrimmedString(row.tenant_id),
    workflowExecutionId: asTrimmedString(row.workflow_execution_id),
    workflowId: asTrimmedString(row.workflow_id),
    stepId: asTrimmedString(row.step_id),
    ticketId: asTrimmedString(row.ticket_id),
    mode,
    status,
    assigneeUserId: asTrimmedString(row.assignee_user_id) || null,
    assigneeOrgUnitId: asTrimmedString(row.assignee_org_unit_id) || null,
    title: asTrimmedString(row.title),
    description: asTrimmedString(row.description),
    instructions: asTrimmedString(row.instructions),
    formSchema,
    response: responsePayload,
    aiMeta,
    allowReject: normalizeInternalTaskRejectAllowed(allowRejectRaw, true),
    maxCycles: Number.isFinite(Number(maxCyclesRaw)) ? Math.max(1, Math.floor(Number(maxCyclesRaw))) : 1,
    cycleIndex: Number.isFinite(Number(cycleIndexRaw)) ? Math.max(1, Math.floor(Number(cycleIndexRaw))) : 1,
    assignmentUpdateMode: normalizeInternalTaskAssignmentUpdateMode(assignmentUpdateModeRaw),
    assignmentSource: normalizeInternalTaskAssignmentSource(assignmentSourceRaw),
    dueAt: asTrimmedString(row.due_at) || null,
    createdAt: asTrimmedString(row.created_at) || null,
    completedAt: asTrimmedString(row.completed_at) || null,
    completedBy: asTrimmedString(row.completed_by) || null,
    ticketStatus: asTrimmedString(row.ticket_status) || null,
    ticketCategory: asTrimmedString(row.ticket_category) || null,
    ticketPriority: asTrimmedString(row.ticket_priority) || null,
  };
}

async function buildInternalTaskAiDraft(
  execution: WorkflowExecution,
  task: WorkflowTask
): Promise<{
  title?: string;
  description?: string;
  instructions?: string;
  fields?: InternalProcessingFormField[];
  raw?: string;
} | null> {
  const systemPrompt = await getSystemPrompt('workflowInternalTaskGeneratorPrompt');
  const { ticket, description, locationText, imageContext } = await loadTicketContext(execution);
  const adminInstruction = asTrimmedString(task.config?.instructions || task.config?.aiInstruction);
  const prompt = `${systemPrompt}

Kontext:
- Ticket-ID: ${asTrimmedString(ticket?.id || execution.ticketId)}
- Kategorie: ${asTrimmedString(ticket?.category)}
- Prioritaet: ${asTrimmedString(ticket?.priority)}
- Status: ${asTrimmedString(ticket?.status)}
- Ort: ${asTrimmedString(locationText)}
- Beschreibung: ${asTrimmedString(description).slice(0, 1800)}
- KI-Bildbeschreibungen:
${String(imageContext || 'Keine KI-Bildbeschreibungen vorhanden.').slice(0, 2500)}

Prozessvariablen (Summary):
${buildExecutionProcessVariableSummary(execution)}

Admin-Anweisung:
${adminInstruction || 'Keine zusaetzliche Anweisung'}
`.trim();

  const raw = await testAIProviderForTicketPrompt({
    prompt,
    purpose: 'workflow_internal_processing_generate',
    meta: {
      source: 'routes.workflows.internal_processing',
      ticketId: execution.ticketId,
      taskId: task.id,
    },
    ticket,
  });
  const parsed = extractJsonPayload(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { raw };
  }
  const fields = normalizeInternalTaskFormSchema((parsed as any).fields);
  return {
    title: asTrimmedString((parsed as any).title),
    description: asTrimmedString((parsed as any).description),
    instructions: asTrimmedString((parsed as any).instructions),
    fields,
    raw,
  };
}

async function resolveInternalProcessingAssignee(
  db: any,
  execution: WorkflowExecution,
  task: WorkflowTask,
  ticket: any,
  tenantId: string
): Promise<{
  strategy: InternalProcessingAssigneeStrategy;
  assigneeUserId: string | null;
  assigneeOrgUnitId: string | null;
  source: string;
}> {
  const strategy = normalizeInternalProcessingAssigneeStrategy(
    task.config?.assigneeStrategy || task.config?.assignmentStrategy
  );
  let assigneeUserId: string | null = null;
  let assigneeOrgUnitId: string | null = null;
  let source: string = strategy;

  if (strategy === 'ticket_primary') {
    assigneeUserId = asTrimmedString(ticket?.primary_assignee_user_id) || null;
    assigneeOrgUnitId = assigneeUserId
      ? null
      : asTrimmedString(ticket?.primary_assignee_org_unit_id || ticket?.owning_org_unit_id) || null;
  } else if (strategy === 'fixed_user') {
    assigneeUserId = asTrimmedString(task.config?.assigneeUserId || task.config?.fixedUserId) || null;
    assigneeOrgUnitId = null;
  } else if (strategy === 'fixed_org') {
    assigneeUserId = null;
    assigneeOrgUnitId = asTrimmedString(task.config?.assigneeOrgUnitId || task.config?.fixedOrgUnitId) || null;
  } else if (strategy === 'process_variable') {
    const key = asTrimmedString(task.config?.assigneeProcessVariableKey || task.config?.processVariableKey);
    const raw = key ? getProcessVariable(execution, key) : undefined;
    const parsed = parseInternalTaskAssigneeFromVariable(raw);
    assigneeUserId = parsed.userId;
    assigneeOrgUnitId = parsed.orgUnitId;
    source = key ? `process_variable:${key}` : 'process_variable';
  }

  if (assigneeUserId) {
    const userRow = await db.get(`SELECT id FROM admin_users WHERE id = ? LIMIT 1`, [assigneeUserId]);
    if (!userRow?.id) {
      assigneeUserId = null;
    }
  }
  if (assigneeOrgUnitId) {
    const orgRow = await db.get(
      `SELECT id
       FROM org_units
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [assigneeOrgUnitId, tenantId]
    );
    if (!orgRow?.id) {
      assigneeOrgUnitId = null;
    }
  }
  if (assigneeUserId) {
    assigneeOrgUnitId = null;
  }

  return {
    strategy,
    assigneeUserId,
    assigneeOrgUnitId,
    source,
  };
}

async function executeInternalProcessingTask(
  execution: WorkflowExecution,
  task: WorkflowTask
): Promise<WorkflowExecutionData> {
  const db = getDatabase();
  const ticket = await db.get(
    `SELECT id, tenant_id, primary_assignee_user_id, primary_assignee_org_unit_id, owning_org_unit_id, status, category, priority
     FROM tickets
     WHERE id = ?
     LIMIT 1`,
    [execution.ticketId]
  );
  if (!ticket?.id) {
    throw new Error('Interne Bearbeitung: Ticket nicht gefunden.');
  }
  const tenantId = asTrimmedString(ticket.tenant_id) || 'tenant_default';
  const mode = normalizeInternalProcessingMode(task.config?.mode || task.config?.executionMode);
  const taskSource =
    String(task.config?.taskSource || task.config?.source || 'static').trim().toLowerCase() === 'ai_generated'
      ? 'ai_generated'
      : 'static';
  const dueAtIso = resolveInternalTaskDueAtIso(task.config || {});
  const allowReject = normalizeInternalTaskRejectAllowed(task.config?.allowReject, true);
  const maxCycles = Number.isFinite(Number(task.config?.maxCycles))
    ? Math.max(1, Math.min(12, Math.floor(Number(task.config?.maxCycles))))
    : 1;
  const cycleIndexRaw = Number(task.executionData?.internalTaskCycleIndex || task.executionData?.cycleIndex || 1);
  const cycleIndex = Number.isFinite(cycleIndexRaw) ? Math.max(1, Math.floor(cycleIndexRaw)) : 1;
  const assignmentUpdateMode = normalizeInternalTaskAssignmentUpdateMode(
    task.config?.assignmentUpdateMode || task.config?.assignmentMode
  );
  const assignmentSource = normalizeInternalTaskAssignmentSource(task.config?.assignmentSource);
  const existingTaskId = asTrimmedString(task.executionData?.internalTaskId);

  if (existingTaskId) {
    const existing = await db.get(
      `SELECT *
       FROM workflow_internal_tasks
       WHERE id = ?
       LIMIT 1`,
      [existingTaskId]
    );
    if (existing?.id) {
      const existingStatus = normalizeInternalTaskStatus(existing.status);
      return {
        internalTaskId: asTrimmedString(existing.id),
        internalTaskMode: normalizeInternalProcessingMode(existing.mode),
        internalTaskStatus: existingStatus,
        internalTaskAssigneeUserId: asTrimmedString(existing.assignee_user_id) || undefined,
        internalTaskAssigneeOrgUnitId: asTrimmedString(existing.assignee_org_unit_id) || undefined,
        internalTaskAllowReject:
          existing.allow_reject !== undefined
            ? normalizeInternalTaskRejectAllowed(existing.allow_reject, true)
            : allowReject,
        internalTaskAssignmentUpdateMode:
          asTrimmedString(existing.assignment_update_mode) || assignmentUpdateMode,
        internalTaskAssignmentSource: asTrimmedString(existing.assignment_source) || assignmentSource,
        internalTaskCycleIndex: Number(existing.cycle_index || cycleIndex) || cycleIndex,
        internalTaskMaxCycles: Number(existing.max_cycles || maxCycles) || maxCycles,
        awaitingConfirmation: mode === 'blocking' && (existingStatus === 'pending' || existingStatus === 'in_progress'),
      };
    }
  }

  const openByStep = await db.get(
    `SELECT *
     FROM workflow_internal_tasks
     WHERE workflow_execution_id = ?
       AND step_id = ?
       AND status IN ('pending', 'in_progress')
     ORDER BY created_at DESC
     LIMIT 1`,
    [execution.id, task.id]
  );
  if (openByStep?.id) {
    const currentStatus = normalizeInternalTaskStatus(openByStep.status);
    return {
      internalTaskId: asTrimmedString(openByStep.id),
      internalTaskMode: normalizeInternalProcessingMode(openByStep.mode),
      internalTaskStatus: currentStatus,
      internalTaskAssigneeUserId: asTrimmedString(openByStep.assignee_user_id) || undefined,
      internalTaskAssigneeOrgUnitId: asTrimmedString(openByStep.assignee_org_unit_id) || undefined,
      internalTaskAllowReject:
        openByStep.allow_reject !== undefined
          ? normalizeInternalTaskRejectAllowed(openByStep.allow_reject, true)
          : allowReject,
      internalTaskAssignmentUpdateMode:
        asTrimmedString(openByStep.assignment_update_mode) || assignmentUpdateMode,
      internalTaskAssignmentSource: asTrimmedString(openByStep.assignment_source) || assignmentSource,
      internalTaskCycleIndex: Number(openByStep.cycle_index || cycleIndex) || cycleIndex,
      internalTaskMaxCycles: Number(openByStep.max_cycles || maxCycles) || maxCycles,
      awaitingConfirmation: mode === 'blocking',
    };
  }

  const aiDraft =
    taskSource === 'ai_generated' ? await buildInternalTaskAiDraft(execution, task).catch(() => null) : null;
  const baseTitle = asTrimmedString(task.config?.taskTitle || task.title || task.config?.title);
  const baseDescription = asTrimmedString(task.config?.taskDescription || task.description);
  const baseInstructions = asTrimmedString(task.config?.instructions);
  const title = asTrimmedString(aiDraft?.title) || baseTitle || 'Interne Bearbeitung';
  const description = asTrimmedString(aiDraft?.description) || baseDescription || '';
  const instructions = asTrimmedString(aiDraft?.instructions) || baseInstructions || '';
  const configuredSchema =
    aiDraft?.fields && aiDraft.fields.length > 0
      ? aiDraft.fields
      : normalizeInternalTaskFormSchema(task.config?.formSchema);

  const assignee = await resolveInternalProcessingAssignee(db, execution, task, ticket, tenantId);
  const internalTaskId = `wit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.run(
    `INSERT INTO workflow_internal_tasks (
      id, tenant_id, workflow_execution_id, workflow_id, step_id, ticket_id, mode, status,
      assignee_user_id, assignee_org_unit_id, title, description, instructions,
      form_schema_json, ai_meta_json, due_at,
      allow_reject, cycle_index, max_cycles, assignment_update_mode, assignment_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      internalTaskId,
      tenantId,
      execution.id,
      asTrimmedString(execution.templateId) || null,
      task.id,
      execution.ticketId,
      mode,
      assignee.assigneeUserId,
      assignee.assigneeOrgUnitId,
      title,
      description || null,
      instructions || null,
      JSON.stringify({ fields: configuredSchema }),
      JSON.stringify(
        sanitizeWorkflowStorageValue({
          source: taskSource,
          sourceDetail: assignee.source,
          allowReject,
          cycleIndex,
          maxCycles,
          assignmentUpdateMode,
          assignmentSource,
          aiRaw: aiDraft?.raw ? aiDraft.raw.slice(0, 6000) : undefined,
        })
      ),
      dueAtIso ? toSqlDateTime(dueAtIso) : null,
      allowReject ? 1 : 0,
      cycleIndex,
      maxCycles,
      assignmentUpdateMode,
      assignmentSource,
    ]
  );

  await insertInternalTaskEvent(db, {
    taskId: internalTaskId,
    eventType: 'created',
    payload: {
      mode,
      source: taskSource,
      assigneeUserId: assignee.assigneeUserId,
      assigneeOrgUnitId: assignee.assigneeOrgUnitId,
      dueAt: dueAtIso,
      allowReject,
      cycleIndex,
      maxCycles,
      assignmentUpdateMode,
      assignmentSource,
    },
  });

  await appendTicketComment({
    ticketId: execution.ticketId,
    executionId: execution.id,
    taskId: task.id,
    authorType: 'system',
    visibility: 'internal',
    commentType: 'note',
    content: `Interne Bearbeitung erstellt: ${title}`,
    metadata: {
      internalTaskId,
      mode,
      assigneeStrategy: assignee.strategy,
      assigneeUserId: assignee.assigneeUserId,
      assigneeOrgUnitId: assignee.assigneeOrgUnitId,
      dueAt: dueAtIso,
      taskSource,
      allowReject,
      cycleIndex,
      maxCycles,
      assignmentUpdateMode,
      assignmentSource,
    },
  });

  appendWorkflowHistory(execution, 'TASK_DATA', 'Interne Bearbeitung erstellt.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: {
      internalTaskId,
      mode,
      assigneeStrategy: assignee.strategy,
      assigneeUserId: assignee.assigneeUserId,
      assigneeOrgUnitId: assignee.assigneeOrgUnitId,
      dueAt: dueAtIso,
      taskSource,
      allowReject,
      cycleIndex,
      maxCycles,
      assignmentUpdateMode,
      assignmentSource,
    },
  });

  const assignmentRecipients = [
    ...(assignee.assigneeUserId
      ? [
          {
            type: 'user' as const,
            id: assignee.assigneeUserId,
            roleLabel: 'Interne Aufgabe',
          },
        ]
      : []),
    ...(assignee.assigneeOrgUnitId
      ? [
          {
            type: 'org_unit' as const,
            id: assignee.assigneeOrgUnitId,
            roleLabel: 'Interne Aufgabe',
          },
        ]
      : []),
  ];
  if (assignmentRecipients.length > 0) {
    void sendTicketAssignmentEmailNotifications({
      ticketId: execution.ticketId,
      recipients: assignmentRecipients,
      context: 'internal_task_assignment',
      taskTitle: title,
      internalTaskId,
    }).catch((assignmentError) => {
      console.warn('Internal task assignment email notifications failed:', assignmentError);
    });
  }

  return {
    internalTaskId,
    internalTaskMode: mode,
    internalTaskStatus: 'pending',
    internalTaskAssigneeUserId: assignee.assigneeUserId || undefined,
    internalTaskAssigneeOrgUnitId: assignee.assigneeOrgUnitId || undefined,
    internalTaskAllowReject: allowReject,
    internalTaskAssignmentUpdateMode: assignmentUpdateMode,
    internalTaskAssignmentSource: assignmentSource,
    internalTaskCycleIndex: cycleIndex,
    internalTaskMaxCycles: maxCycles,
    awaitingConfirmation: mode === 'blocking',
  };
}

type WorkflowConditionRule =
  | {
      kind?: 'field';
      type?: 'field';
      field: string;
      operator?: string;
      value?: any;
    }
  | {
      kind?: 'process_variable';
      type?: 'process_variable';
      key?: string;
      variableKey?: string;
      field?: string;
      operator?: string;
      value?: any;
    }
  | {
      kind?: 'geofence';
      type?: 'geofence';
      operator?: 'inside' | 'outside' | string;
      shape?: 'circle' | 'polygon' | string;
      centerLat?: number | string;
      centerLon?: number | string;
      radiusMeters?: number | string;
      points?: Array<{
        lat?: number | string;
        lon?: number | string;
        lng?: number | string;
        latitude?: number | string;
        longitude?: number | string;
      }>;
      latitudeField?: string;
      longitudeField?: string;
    };

function resolveTicketFieldValue(ticket: Record<string, any>, rawField: string): any {
  const field = String(rawField || '').trim();
  if (!field) return undefined;
  const normalized = field.toLowerCase();

  const aliases: Record<string, string[]> = {
    ticketid: ['id'],
    category: ['category'],
    priority: ['priority'],
    status: ['status'],
    assignedto: ['assigned_to'],
    assigned_to: ['assigned_to'],
    description: ['description', 'submission_original_description', 'submission_anonymized_text'],
    address: ['address', 'submission_address'],
    postalcode: ['postal_code', 'submission_postal_code'],
    city: ['city', 'submission_city'],
    latitude: ['latitude'],
    longitude: ['longitude'],
    responsibilityauthority: ['responsibility_authority'],
    responsibility_authority: ['responsibility_authority'],
    responsibility: ['responsibility_authority'],
    zustaendigkeit: ['responsibility_authority'],
    zustandigkeit: ['responsibility_authority'],
    citizenemail: ['citizen_email'],
    citizenname: ['citizen_name'],
    redmineissueid: ['redmine_issue_id'],
  };

  const direct = ticket[field];
  if (direct !== undefined) return direct;

  const aliasKeys = aliases[normalized] || [];
  for (const key of aliasKeys) {
    if (ticket[key] !== undefined) return ticket[key];
  }

  return undefined;
}

function isResponsibilityIfFieldName(rawField: unknown): boolean {
  const normalized = String(rawField || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  return (
    normalized === 'responsibilityauthority' ||
    normalized === 'responsibility' ||
    normalized === 'zustaendigkeit' ||
    normalized === 'zustandigkeit'
  );
}

function isEmptyValue(value: any): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

function asComparableString(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asComparableNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePriorityKey(value: any): 'low' | 'medium' | 'high' | 'critical' | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === 'low' || raw === 'niedrig') return 'low';
  if (raw === 'medium' || raw === 'mittel' || raw === 'normal') return 'medium';
  if (raw === 'high' || raw === 'hoch') return 'high';
  if (raw === 'critical' || raw === 'kritisch') return 'critical';
  return null;
}

function asPriorityRank(value: any): number | null {
  const normalized = normalizePriorityKey(value);
  if (!normalized) return null;
  const rankByPriority: Record<'low' | 'medium' | 'high' | 'critical', number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return rankByPriority[normalized];
}

function evaluateValueCondition(
  fieldValue: any,
  operatorInput: unknown,
  rightValue: any,
  options: { isPriorityField?: boolean } = {}
): boolean {
  const isPriorityField = options.isPriorityField === true;
  const operatorRaw = String(operatorInput || 'equals')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const operatorMap: Record<string, string> = {
    '==': 'equals',
    '=': 'equals',
    eq: 'equals',
    is: 'equals',
    ist: 'equals',
    '!=': 'not_equals',
    neq: 'not_equals',
    is_not: 'not_equals',
    isnot: 'not_equals',
    ist_nicht: 'not_equals',
    isnt: 'not_equals',
    '>': 'gt',
    gte: 'gte',
    '>=': 'gte',
    '<': 'lt',
    lte: 'lte',
    '<=': 'lte',
    isempty: 'is_empty',
    isnotempty: 'is_not_empty',
  };
  const operator = operatorMap[operatorRaw] || operatorRaw;
  if (operator === 'is_empty') return isEmptyValue(fieldValue);
  if (operator === 'is_not_empty') return !isEmptyValue(fieldValue);

  if (fieldValue === null || fieldValue === undefined) {
    return false;
  }

  const leftNumber = asComparableNumber(fieldValue);
  const rightNumber = asComparableNumber(rightValue);
  const leftPriorityRank = asPriorityRank(fieldValue);
  const rightPriorityRank = asPriorityRank(rightValue);

  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    if (isPriorityField) {
      if (leftPriorityRank === null || rightPriorityRank === null) return false;
      if (operator === 'gt') return leftPriorityRank > rightPriorityRank;
      if (operator === 'gte') return leftPriorityRank >= rightPriorityRank;
      if (operator === 'lt') return leftPriorityRank < rightPriorityRank;
      if (operator === 'lte') return leftPriorityRank <= rightPriorityRank;
      return false;
    }
    if (leftNumber === null || rightNumber === null) return false;
    if (operator === 'gt') return leftNumber > rightNumber;
    if (operator === 'gte') return leftNumber >= rightNumber;
    if (operator === 'lt') return leftNumber < rightNumber;
    if (operator === 'lte') return leftNumber <= rightNumber;
    return false;
  }

  if (
    isPriorityField &&
    leftPriorityRank !== null &&
    rightPriorityRank !== null &&
    (operator === 'equals' || operator === 'not_equals')
  ) {
    if (operator === 'equals') return leftPriorityRank === rightPriorityRank;
    if (operator === 'not_equals') return leftPriorityRank !== rightPriorityRank;
  }

  const left = asComparableString(fieldValue).toLowerCase();
  const right = asComparableString(rightValue).toLowerCase();

  switch (operator) {
    case 'equals':
      return left === right;
    case 'not_equals':
      return left !== right;
    case 'contains':
      return left.includes(right);
    case 'not_contains':
      return !left.includes(right);
    case 'starts_with':
      return left.startsWith(right);
    case 'ends_with':
      return left.endsWith(right);
    default:
      return false;
  }
}

function evaluateFieldCondition(
  ticket: Record<string, any>,
  condition: Extract<WorkflowConditionRule, { field: string }>
): boolean {
  const operatorRaw = String(condition.operator || 'equals')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const fieldValue = resolveTicketFieldValue(ticket, condition.field);
  const normalizedField = String(condition.field || '')
    .trim()
    .toLowerCase();
  const isPriorityField = normalizedField === 'priority' || normalizedField === 'priorität' || normalizedField === 'prioritaet';
  const isResponsibilityField = isResponsibilityIfFieldName(condition.field);
  if (isResponsibilityField) {
    const operatorAlias: Record<string, string> = {
      '=': 'equals',
      '==': 'equals',
      eq: 'equals',
      is: 'equals',
      ist: 'equals',
      '!=': 'not_equals',
      neq: 'not_equals',
      is_not: 'not_equals',
      isnot: 'not_equals',
      ist_nicht: 'not_equals',
      isempty: 'is_empty',
      isnotempty: 'is_not_empty',
    };
    const resolvedOperator = operatorAlias[operatorRaw] || operatorRaw;
    if (!['equals', 'not_equals', 'is_empty', 'is_not_empty'].includes(resolvedOperator)) {
      return false;
    }
  }
  return evaluateValueCondition(fieldValue, operatorRaw, condition.value, { isPriorityField });
}

function evaluateProcessVariableCondition(
  execution: WorkflowExecution,
  condition: Extract<WorkflowConditionRule, { kind?: 'process_variable' } | { type?: 'process_variable' }>
): { passed: boolean; key: string; value: any } {
  const key = String(condition.key || condition.variableKey || condition.field || '').trim();
  const value = key ? getProcessVariable(execution, key) : undefined;
  const passed = key
    ? evaluateValueCondition(value, condition.operator, condition.value, {
        isPriorityField: key.toLowerCase().endsWith('priority'),
      })
    : false;
  return { passed, key, value };
}

function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function normalizeGeofencePoints(points: unknown): Array<{ lat: number; lon: number }> {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      if (!point || typeof point !== 'object') return null;
      const source = point as Record<string, any>;
      const lat = asComparableNumber(source.lat ?? source.latitude);
      const lon = asComparableNumber(source.lon ?? source.lng ?? source.longitude);
      if (lat === null || lon === null) return null;
      return { lat, lon };
    })
    .filter((point): point is { lat: number; lon: number } => point !== null);
}

function isPointInsidePolygon(
  lat: number,
  lon: number,
  polygonPoints: Array<{ lat: number; lon: number }>
): boolean {
  let inside = false;
  for (let index = 0, previous = polygonPoints.length - 1; index < polygonPoints.length; previous = index, index += 1) {
    const yi = polygonPoints[index].lat;
    const xi = polygonPoints[index].lon;
    const yj = polygonPoints[previous].lat;
    const xj = polygonPoints[previous].lon;
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function evaluateGeofenceCondition(
  ticket: Record<string, any>,
  condition: Extract<WorkflowConditionRule, { kind?: 'geofence' } | { type?: 'geofence' }>
): boolean {
  const latField = String(condition.latitudeField || 'latitude').trim();
  const lonField = String(condition.longitudeField || 'longitude').trim();
  const ticketLat = asComparableNumber(resolveTicketFieldValue(ticket, latField));
  const ticketLon = asComparableNumber(resolveTicketFieldValue(ticket, lonField));
  const shape = String(condition.shape || '').toLowerCase();
  const polygonPoints = normalizeGeofencePoints((condition as any).points ?? (condition as any).polygonPoints);
  const usePolygon = shape === 'polygon' || polygonPoints.length >= 3;
  let isInside = false;

  if (ticketLat === null || ticketLon === null) {
    return false;
  }

  if (usePolygon) {
    if (polygonPoints.length < 3) return false;
    isInside = isPointInsidePolygon(ticketLat, ticketLon, polygonPoints);
  } else {
    const centerLat = asComparableNumber(condition.centerLat);
    const centerLon = asComparableNumber(condition.centerLon);
    const radiusMeters = asComparableNumber(condition.radiusMeters);

    if (
      centerLat === null ||
      centerLon === null ||
      radiusMeters === null ||
      radiusMeters <= 0
    ) {
      return false;
    }

    const distance = haversineDistanceMeters(ticketLat, ticketLon, centerLat, centerLon);
    isInside = distance <= radiusMeters;
  }

  const mode = String(condition.operator || 'inside').toLowerCase();
  if (mode === 'outside') return !isInside;
  return isInside;
}

function evaluateIfConditions(
  execution: WorkflowExecution,
  ticket: Record<string, any>,
  config: Record<string, any>
): { result: boolean; summary: Record<string, any> } {
  const rawConditions = Array.isArray(config.conditions) ? config.conditions : [];
  const evaluated: Array<Record<string, any>> = [];

  for (const rawCondition of rawConditions) {
    if (!rawCondition || typeof rawCondition !== 'object') continue;
    const condition = rawCondition as WorkflowConditionRule;
    const kind = String((condition as any).kind || (condition as any).type || 'field').toLowerCase();

    let passed = false;
    if (kind === 'geofence') {
      passed = evaluateGeofenceCondition(ticket, condition as any);
    } else if (kind === 'process_variable') {
      const pvEvaluation = evaluateProcessVariableCondition(execution, condition as any);
      passed = pvEvaluation.passed;
      evaluated.push({
        ...rawCondition,
        key: pvEvaluation.key,
        resolvedValue: pvEvaluation.value,
        passed,
      });
      continue;
    } else {
      const hasField = typeof (condition as any).field === 'string' && (condition as any).field.trim() !== '';
      if (!hasField) {
        passed = false;
      } else {
        passed = evaluateFieldCondition(ticket, condition as any);
      }
    }

    evaluated.push({
      ...rawCondition,
      passed,
    });
  }

  const logic = String(config.logic || config.logicalOperator || 'AND').toUpperCase() === 'OR'
    ? 'OR'
    : 'AND';

  if (evaluated.length === 0) {
    return {
      result: false,
      summary: {
        logic,
        evaluated,
        reason: 'Keine Bedingungen konfiguriert',
      },
    };
  }

  const result =
    logic === 'OR'
      ? evaluated.some((entry) => entry.passed === true)
      : evaluated.every((entry) => entry.passed === true);

  return {
    result,
    summary: {
      logic,
      evaluated,
    },
  };
}

function resolveConfiguredTaskIdsFromConfig(execution: WorkflowExecution, value: unknown): string[] {
  if (Array.isArray(value)) return normalizeTaskIdList(execution, value);
  if (typeof value === 'string') {
    const single = normalizeSingleTaskId(execution, value);
    return single ? [single] : [];
  }
  return [];
}

async function executeEndTask(_execution: WorkflowExecution, task: WorkflowTask) {
  const rawScope = String(task.config?.scope || task.config?.endScope || 'branch').toLowerCase();
  const endScope: 'branch' | 'workflow' = rawScope === 'workflow' ? 'workflow' : 'branch';
  return {
    endScope,
    nextTaskIds: [],
  };
}

async function executeJoinTask(_execution: WorkflowExecution, task: WorkflowTask) {
  const requiredArrivals = getJoinRequiredArrivals(task);
  const joinState = (task.executionData?.joinState || {}) as Partial<NonNullable<WorkflowExecutionData['joinState']>>;
  const arrivedPathGroups = Array.isArray(joinState.arrivedPathGroups)
    ? joinState.arrivedPathGroups.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const arrivedTaskIds = Array.isArray(joinState.arrivedTaskIds)
    ? joinState.arrivedTaskIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  return {
    nextTaskIds: [],
    joinState: {
      requiredArrivals,
      arrivedTaskIds,
      arrivedPathGroups,
    },
    pathGroup: null,
  };
}

async function executeSplitTask(execution: WorkflowExecution, task: WorkflowTask) {
  const branchIdsFromPair = resolveConfiguredTaskIdsFromConfig(execution, [
    task.config?.leftNextTaskId,
    task.config?.rightNextTaskId,
  ]);
  const branchIdsFromConfig = resolveConfiguredTaskIdsFromConfig(execution, task.config?.nextTaskIds);
  const branchIdsFromBranches = Array.isArray(task.config?.branches)
    ? resolveConfiguredTaskIdsFromConfig(
        execution,
        task.config.branches.map((branch: any) => branch?.taskId || branch?.nextTaskId || branch?.id)
      )
    : [];

  const combined = Array.from(
    new Set([...branchIdsFromPair, ...branchIdsFromConfig, ...branchIdsFromBranches])
  );
  const nextTaskIds =
    combined.length > 0 ? combined : getDefaultSplitNextTaskIds(execution, task);
  const pathGroupsByTaskId = nextTaskIds.reduce<Record<string, string>>((acc, taskId, index) => {
    if (!taskId) return acc;
    const suffix = index === 0 ? 'A' : index === 1 ? 'B' : `P${index + 1}`;
    acc[taskId] = `${task.id}:${suffix}`;
    return acc;
  }, {});

  return {
    nextTaskIds,
    splitCount: nextTaskIds.length,
    pathGroupsByTaskId,
  };
}

async function executeIfTask(execution: WorkflowExecution, task: WorkflowTask) {
  const { ticket } = await loadTicketContext(execution);
  const { result, summary } = evaluateIfConditions(execution, ticket, task.config || {});

  const trueTaskIds = resolveConfiguredTaskIdsFromConfig(
    execution,
    task.config?.trueNextTaskIds ?? task.config?.trueNextTaskId
  );
  const falseTaskIds = resolveConfiguredTaskIdsFromConfig(
    execution,
    task.config?.falseNextTaskIds ?? task.config?.falseNextTaskId
  );
  const fallbackTaskIds = getDefaultNextTaskIds(execution, task, getTaskPathGroup(task));

  const nextTaskIds =
    result
      ? trueTaskIds.length > 0
        ? trueTaskIds
        : fallbackTaskIds
      : falseTaskIds.length > 0
      ? falseTaskIds
      : fallbackTaskIds;

  return {
    conditionResult: result,
    conditionSummary: summary,
    nextTaskIds,
  };
}

async function generateWorkflowSelectionViaAI(input: {
  execution: WorkflowExecution;
  ticket: any;
  description: string;
  location: string;
  imageContext?: string;
  templates: WorkflowTemplate[];
}) {
  const templateList = input.templates
    .map((t) => `- ${t.id}: ${t.name}${t.description ? ` — ${t.description}` : ''}`)
    .join('\n');

  const promptBase = await getSystemPrompt('workflowTemplateSelectionPrompt');
  const prompt = `${promptBase}

Daten:
- Kategorie: ${input.ticket?.category || '–'}
- Beschreibung: ${input.description || '–'}
- Adresse/Ort: ${input.location || '–'}
- KI-Bildbeschreibungen:
${input.imageContext || 'Keine KI-Bildbeschreibungen vorhanden.'}

Prozessvariablen (JSON):
${buildExecutionProcessVariablePromptBlock(input.execution)}

Prozessvariablen (Summary):
${buildExecutionProcessVariableSummary(input.execution)}

Verfuegbare Workflows:
${templateList || '–'}

Antworte als JSON zwischen BEGIN_JSON und END_JSON.
Format: {"templateId":"...","reasoning":"...","confidence":0.0}`.trim();

  const response = await testAIProviderForTicketPrompt({
    prompt,
    purpose: 'workflow_template_select',
    meta: {
      source: 'routes.workflows.selection',
      ticketId: input.ticket?.id || null,
    },
    ticket: input.ticket,
  });
  const data = extractJsonPayload(response);

  const templateId =
    (typeof data.templateId === 'string' && data.templateId.trim()) ||
    (typeof data.workflowId === 'string' && data.workflowId.trim()) ||
    (typeof data.id === 'string' && data.id.trim()) ||
    '';
  const confidenceRaw = Number(data.confidence ?? data.score ?? NaN);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0.5;

  return {
    templateId,
    reasoning: typeof data.reasoning === 'string' ? data.reasoning.trim() : '',
    confidence,
  };
}

async function executeSubWorkflowTask(
  execution: WorkflowExecution,
  task: WorkflowTask
): Promise<WorkflowExecutionData> {
  const workflowConfig = await loadWorkflowConfig();
  const templates = (workflowConfig.templates || []).filter((template) => template.enabled !== false);
  if (templates.length === 0) {
    throw new Error('Keine Workflows verfuegbar');
  }

  const selectionMode =
    task.config?.selectionMode ||
    (task.config?.templateId || task.config?.workflowTemplateId ? 'manual' : 'ai');
  const fallbackTemplateId = String(
    task.config?.fallbackTemplateId ||
      task.config?.templateId ||
      task.config?.workflowTemplateId ||
      ''
  ).trim();
  const allowSameTemplate = task.config?.allowSameTemplate === true;
  const reuseActiveChild = task.config?.reuseActiveChild !== false;
  const failOnChildFailure = task.config?.failOnChildFailure !== false;

  const existingSubWorkflowExecutionId = asTrimmedString(
    task.executionData?.awaitingSubWorkflow?.executionId || task.executionData?.subWorkflow?.executionId
  );
  const executions = loadExecutions();
  if (existingSubWorkflowExecutionId && reuseActiveChild) {
    const existingChild = executions.find((entry) => entry.id === existingSubWorkflowExecutionId) || null;
    if (existingChild) {
      const statusLower = String(existingChild.status || '').trim().toLowerCase();
      const existingChildStatus: 'running' | 'completed' | 'failed' =
        statusLower === 'failed' ? 'failed' : statusLower === 'completed' ? 'completed' : 'running';
      if (existingChildStatus === 'running') {
        return {
          awaitingSubWorkflow: {
            executionId: existingChild.id,
            templateId: asTrimmedString(existingChild.templateId),
            failOnChildFailure,
          },
          subWorkflow: {
            executionId: existingChild.id,
            templateId: asTrimmedString(existingChild.templateId),
            status: existingChildStatus,
            failOnChildFailure,
            startedAt: existingChild.startedAt,
          },
        };
      }
      if (existingChildStatus === 'failed' && failOnChildFailure) {
        throw new Error(
          `Teilworkflow "${existingChild.title || existingChild.templateId || existingChild.id}" ist fehlgeschlagen.`
        );
      }
      if (existingChildStatus === 'completed' || existingChildStatus === 'failed') {
        return {
          subWorkflow: {
            executionId: existingChild.id,
            templateId: asTrimmedString(existingChild.templateId),
            status: existingChildStatus,
            failOnChildFailure,
            startedAt: existingChild.startedAt,
            completedAt: existingChild.completedAt || new Date().toISOString(),
          },
        };
      }
    }
  }

  let chosen: WorkflowTemplate | null = null;
  let reasoning = '';
  let confidence = 1;
  let fallbackUsed = false;

  if (selectionMode === 'manual') {
    const templateId = task.config?.templateId || task.config?.workflowTemplateId || '';
    chosen = templates.find((template) => template.id === templateId) || null;
    reasoning = chosen ? 'Manuell ausgewählte Teilworkflow-Vorlage.' : 'Manuelle Teilworkflow-Auswahl nicht gefunden.';
  } else {
    const { ticket, description, locationText, imageContext } = await loadTicketContext(execution);
    try {
      const aiSelection = await generateWorkflowSelectionViaAI({
        execution,
        ticket,
        description,
        location: locationText || '',
        imageContext,
        templates,
      });
      reasoning = aiSelection.reasoning;
      confidence = aiSelection.confidence;
      chosen =
        templates.find((template) => template.id === aiSelection.templateId) ||
        templates.find((template) => template.name === aiSelection.templateId) ||
        null;
      if (!chosen) {
        fallbackUsed = true;
      }
    } catch (error) {
      console.warn('Sub-workflow selection via AI failed, fallback to configured/default template:', error);
      fallbackUsed = true;
      confidence = 0;
      reasoning = `KI-Auswahl fehlgeschlagen: ${
        error instanceof Error ? error.message : String(error || 'unbekannt')
      }`;
    }
  }

  if (!chosen) {
    const fallback =
      (fallbackTemplateId && templates.find((template) => template.id === fallbackTemplateId)) ||
      templates[0] ||
      null;
    if (fallback) {
      chosen = fallback;
      fallbackUsed = true;
      reasoning =
        reasoning ||
        'Deterministischer Fallback wurde verwendet, weil keine gültige Auswahl vorlag.';
    }
  }

  if (!chosen) {
    return {
      skipped: true,
      reason: 'Kein Teilworkflow ausgewaehlt',
      aiDecision: {
        decision: 'none',
        confidence: Math.max(0, Math.min(1, confidence || 0)),
        reason: reasoning || 'Keine Vorlage verfügbar.',
        fallbackUsed: true,
      },
    };
  }

  if (!allowSameTemplate && chosen.id === execution.templateId) {
    return {
      skipped: true,
      reason: 'Teilworkflow entspricht dem aktiven Workflow (allowSameTemplate=false).',
      aiDecision: {
        decision: chosen.id,
        confidence: Math.max(0, Math.min(1, confidence || 0)),
        reason: reasoning || 'Ausgewählte Vorlage entspricht dem aktiven Workflow.',
        fallbackUsed,
      },
    };
  }

  const childExecution = await buildExecutionFromTemplate(execution.ticketId, chosen, {
    parentExecutionId: execution.id,
    parentTaskId: task.id,
    parentTaskType: task.type,
  });
  appendWorkflowHistory(childExecution, 'INFO', 'Teilworkflow aus Elternworkflow gestartet.', {
    metadata: {
      parentExecutionId: execution.id,
      parentTaskId: task.id,
      parentTaskTitle: task.title,
      parentTaskType: task.type,
      selectionMode,
      reasoning: reasoning || undefined,
      confidence,
      fallbackUsed,
    },
  });

  return {
    aiDecision: {
      decision: chosen.id,
      confidence: Math.max(0, Math.min(1, confidence || 0)),
      reason: reasoning || 'Teilworkflow-Auswahl abgeschlossen.',
      fallbackUsed,
    },
    subWorkflowStartExecution: childExecution,
    subWorkflow: {
      executionId: childExecution.id,
      templateId: chosen.id,
      selectionMode,
      reasoning: reasoning || undefined,
      confidence: Math.max(0, Math.min(1, confidence || 0)),
      fallbackUsed,
      startedAt: childExecution.startedAt,
      status: 'running' as const,
      failOnChildFailure,
    },
    awaitingSubWorkflow: {
      executionId: childExecution.id,
      templateId: chosen.id,
      failOnChildFailure,
    },
    awaitingConfirmation: false,
    awaitingUntil: undefined,
    awaitingRedmineIssue: undefined,
  };
}

async function runChangeWorkflowRecategorization(
  execution: WorkflowExecution,
  task: WorkflowTask
): Promise<{
  appliedPatch: Record<string, any> | null;
  reasoning: string;
  confidence: number | null;
}> {
  const enabled = task.config?.enableAiRecategorization === true;
  if (!enabled) {
    return { appliedPatch: null, reasoning: '', confidence: null };
  }
  const knowledge = await loadKnowledge();
  const categoriesForPrompt = buildKnownCategoryPromptList(knowledge);
  const { ticket, description, locationText, imageContext } = await loadTicketContext(execution);
  const promptBase = await getSystemPrompt('workflowRecategorizationPrompt');
  const prompt = `${promptBase}

Ticket:
- ID: ${String(ticket?.id || execution.ticketId)}
- Kategorie: ${String(ticket?.category || '')}
- Prioritaet: ${String(ticket?.priority || '')}
- Status: ${String(ticket?.status || '')}
- Ort: ${String(locationText || '')}
- Beschreibung: ${String(description || '').slice(0, 1800)}
- KI-Bildbeschreibungen:
${String(imageContext || 'Keine KI-Bildbeschreibungen vorhanden.')}

Verfuegbare Kategorien (verbindlich):
${categoriesForPrompt}

Prozessvariablen (JSON):
${buildExecutionProcessVariablePromptBlock(execution)}

Prozessvariablen (Summary):
${buildExecutionProcessVariableSummary(execution)}
`.trim();

  const raw = await testAIProviderForTicketPrompt({
    prompt,
    purpose: 'workflow_change_workflow_recategorization',
    meta: {
      source: 'routes.workflows.change_workflow.recategorization',
      ticketId: execution.ticketId,
      taskId: task.id,
    },
    ticket,
  });
  const parsed = extractJsonPayload(raw);
  const nextCategory = typeof parsed?.category === 'string' ? parsed.category.trim() : '';
  const nextPriority = typeof parsed?.priority === 'string' ? parsed.priority.trim().toLowerCase() : '';
  const reasoning = typeof parsed?.reasoning === 'string' ? parsed.reasoning.trim() : '';
  const confidenceRaw = Number(parsed?.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : null;

  const patch: Record<string, any> = {};
  if (nextCategory) {
    const resolvedCategory = resolveKnownCategoryName(knowledge, nextCategory, ticket?.category || '');
    if (resolvedCategory && resolvedCategory !== String(ticket?.category || '').trim()) {
      patch.category = resolvedCategory;
    }
  }
  if (['low', 'medium', 'high', 'critical'].includes(nextPriority)) {
    patch.priority = nextPriority;
  }

  const appliedPatch = await applyWorkflowTicketPatch(execution, patch);
  if (task.config?.addAiComment !== false) {
    const content = reasoning
      ? `KI-Rekategorisierung vor Workflowwechsel: ${reasoning}`
      : 'KI-Rekategorisierung vor Workflowwechsel wurde ausgeführt.';
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'ai',
      visibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
      commentType: 'classification',
      content,
      metadata: {
        appliedPatch,
        confidence,
      },
    });
  }

  appendWorkflowHistory(execution, 'TASK_DATA', 'KI-Rekategorisierung vor Workflowwechsel ausgeführt.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: {
      appliedPatch,
      confidence,
      reasoning: reasoning || undefined,
    },
  });

  return { appliedPatch, reasoning, confidence };
}

async function executeChangeWorkflowTask(execution: WorkflowExecution, task: WorkflowTask) {
  const config = await loadWorkflowConfig();
  const templates = (config.templates || []).filter((t) => t.enabled !== false);

  if (templates.length === 0) {
    throw new Error('Keine Workflows verfuegbar');
  }

  const selectionMode =
    task.config?.selectionMode ||
    (task.config?.templateId || task.config?.workflowTemplateId ? 'manual' : 'ai');
  const fallbackTemplateId = String(
    task.config?.fallbackTemplateId ||
      task.config?.templateId ||
      task.config?.workflowTemplateId ||
      ''
  ).trim();

  let chosen: WorkflowTemplate | null = null;
  let reasoning = '';
  let confidence = 1;
  let fallbackUsed = false;
  let recategorizationReasoning = '';

  try {
    const recategorization = await runChangeWorkflowRecategorization(execution, task);
    if (recategorization.reasoning) recategorizationReasoning = recategorization.reasoning;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || 'unbekannt');
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'system',
      visibility: 'internal',
      commentType: 'note',
      content: 'KI-Rekategorisierung vor Workflowwechsel ist fehlgeschlagen.',
      metadata: { error: errorMessage },
    });
    appendWorkflowHistory(execution, 'INFO', 'KI-Rekategorisierung vor Workflowwechsel fehlgeschlagen.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: { error: errorMessage },
    });
  }

  if (selectionMode === 'manual') {
    const templateId = task.config?.templateId || task.config?.workflowTemplateId || '';
    chosen = templates.find((t) => t.id === templateId) || null;
    reasoning = chosen ? 'Manuell ausgewählte Workflow-Vorlage.' : 'Manuelle Auswahl nicht gefunden.';
  } else {
    const { ticket, description, locationText, imageContext } = await loadTicketContext(execution);
    try {
      const aiSelection = await generateWorkflowSelectionViaAI({
        execution,
        ticket,
        description,
        location: locationText || '',
        imageContext,
        templates,
      });
      reasoning = aiSelection.reasoning;
      confidence = aiSelection.confidence;
      chosen =
        templates.find((t) => t.id === aiSelection.templateId) ||
        templates.find((t) => t.name === aiSelection.templateId) ||
        null;
      if (!chosen) {
        fallbackUsed = true;
      }
    } catch (error) {
      console.warn('Workflow-Select AI failed, fallback to manual:', error);
      fallbackUsed = true;
      confidence = 0;
      reasoning = `KI-Auswahl fehlgeschlagen: ${
        error instanceof Error ? error.message : String(error || 'unbekannt')
      }`;
    }
  }

  if (!chosen) {
    const fallback =
      (fallbackTemplateId && templates.find((template) => template.id === fallbackTemplateId)) ||
      templates[0] ||
      null;
    if (fallback) {
      chosen = fallback;
      fallbackUsed = true;
      reasoning =
        reasoning ||
        'Deterministischer Fallback wurde verwendet, weil keine gültige KI-/Manuell-Auswahl vorlag.';
    }
  }

  if (!chosen) {
    return {
      skipped: true,
      reason: 'Kein Workflow ausgewaehlt',
      aiDecision: {
        decision: 'none',
        confidence: Math.max(0, Math.min(1, confidence || 0)),
        reason: reasoning || 'Keine Vorlage verfügbar.',
        fallbackUsed: true,
      },
    };
  }

  if (chosen.id === execution.templateId) {
    return {
      skipped: true,
      reason: 'Workflow ist bereits aktiv',
      aiDecision: {
        decision: chosen.id,
        confidence: Math.max(0, Math.min(1, confidence || 0)),
        reason: reasoning || 'Ausgewählte Vorlage ist bereits aktiv.',
        fallbackUsed,
      },
    };
  }

  if (task.config?.addAiComment !== false) {
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: selectionMode === 'ai' ? 'ai' : 'system',
      visibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
      commentType: 'decision',
      content:
        selectionMode === 'ai'
          ? `Workflowwechsel-Auswahl: ${reasoning || 'KI hat eine Zielvorlage bestimmt.'}`
          : 'Workflowwechsel mit fest konfigurierter Zielvorlage.',
      metadata: {
        selectedTemplateId: chosen.id,
        selectionMode,
        confidence,
        fallbackUsed,
      },
    });
  }

  const nextExecution = await buildExecutionFromTemplate(execution.ticketId, chosen);
  return {
    aiDecision: {
      decision: chosen.id,
      confidence: Math.max(0, Math.min(1, confidence || 0)),
      reason: reasoning || 'Workflow-Auswahl abgeschlossen.',
      fallbackUsed,
    },
    changeWorkflow: {
      templateId: chosen.id,
      execution: nextExecution,
      selectionMode,
      reasoning:
        [reasoning, recategorizationReasoning]
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
          .join(' | ') || undefined,
    },
  };
}

async function applyWorkflowTicketPatch(
  execution: WorkflowExecution,
  patchRaw: unknown
): Promise<Record<string, any> | null> {
  if (!patchRaw || typeof patchRaw !== 'object' || Array.isArray(patchRaw)) return null;
  const patch = patchRaw as Record<string, any>;
  const db = getDatabase();

  const readFirstDefined = (keys: string[]): { present: boolean; value: any } => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        return { present: true, value: patch[key] };
      }
    }
    return { present: false, value: undefined };
  };

  const parseIdList = (input: unknown): string[] => {
    const rawValues = Array.isArray(input)
      ? input
      : typeof input === 'string'
      ? input
          .split(/[\n,;]+/g)
          .map((entry) => entry.trim())
          .filter(Boolean)
      : input === null || input === undefined || input === ''
      ? []
      : [input];
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const entry of rawValues) {
      const value = asTrimmedString(entry);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      normalized.push(value);
    }
    return normalized;
  };

  const updates: string[] = [];
  const values: any[] = [];
  const applied: Record<string, any> = {};

  const assignStringField = (
    keys: string[],
    column: string,
    targetKey: string
  ) => {
    const entry = readFirstDefined(keys);
    if (!entry.present) return;
    const value = entry.value === null || entry.value === undefined ? '' : String(entry.value).trim();
    updates.push(`${column} = ?`);
    values.push(value);
    applied[targetKey] = value;
  };

  assignStringField(['category'], 'category', 'category');
  assignStringField(['description'], 'description', 'description');
  assignStringField(['address'], 'address', 'address');
  assignStringField(['postalCode', 'postal_code'], 'postal_code', 'postalCode');
  assignStringField(['city'], 'city', 'city');
  assignStringField(['redmineProject', 'redmine_project'], 'redmine_project', 'redmineProject');
  const legacyAssignedToEntry = readFirstDefined(['assignedTo', 'assigned_to']);
  if (legacyAssignedToEntry.present) {
    const legacyAssignedToValue =
      legacyAssignedToEntry.value === null || legacyAssignedToEntry.value === undefined
        ? ''
        : String(legacyAssignedToEntry.value).trim();
    updates.push('assigned_to = ?');
    values.push(legacyAssignedToValue);
    applied.assignedTo = legacyAssignedToValue;
  }

  const responsibilityEntry = readFirstDefined(['responsibilityAuthority', 'responsibility_authority']);
  if (responsibilityEntry.present) {
    const rawResponsibility =
      responsibilityEntry.value === null || responsibilityEntry.value === undefined
        ? ''
        : String(responsibilityEntry.value).trim();
    let resolvedResponsibility = '';
    if (rawResponsibility) {
      const allowedAuthorities = await loadAllowedResponsibilityAuthorities();
      const match = resolveResponsibilityAuthorityFromAllowed(
        rawResponsibility,
        allowedAuthorities,
        rawResponsibility
      );
      if (!match) {
        throw new Error(
          `Ungueltige Zustaendigkeit. Erlaubt: ${allowedAuthorities.join(', ') || 'keine'}.`
        );
      }
      resolvedResponsibility = match;
    }
    updates.push('responsibility_authority = ?');
    values.push(resolvedResponsibility);
    applied.responsibilityAuthority = resolvedResponsibility;
  }

  const priorityEntry = readFirstDefined(['priority']);
  if (priorityEntry.present) {
    const priority = String(priorityEntry.value || '').trim().toLowerCase();
    if (!['low', 'medium', 'high', 'critical'].includes(priority)) {
      throw new Error('RESTful API Call: Ungueltiger Ticket-Priority-Wert in patchTicket.');
    }
    updates.push('priority = ?');
    values.push(priority);
    applied.priority = priority;
  }

  const statusEntry = readFirstDefined(['status']);
  if (statusEntry.present) {
    const status = String(statusEntry.value || '').trim();
    if (!TICKET_STATUS_OPTIONS.has(status)) {
      throw new Error('RESTful API Call: Ungueltiger Ticket-Status in patchTicket.');
    }
    updates.push('status = ?');
    values.push(status);
    applied.status = status;
  }

  const setOptionalNumericField = (
    keys: string[],
    column: string,
    targetKey: string
  ) => {
    const entry = readFirstDefined(keys);
    if (!entry.present) return;
    if (entry.value === null || entry.value === undefined || String(entry.value).trim() === '') {
      updates.push(`${column} = NULL`);
      applied[targetKey] = null;
      return;
    }
    const numeric = Number(entry.value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`RESTful API Call: Ungueltiger numerischer Wert fuer ${targetKey}.`);
    }
    updates.push(`${column} = ?`);
    values.push(numeric);
    applied[targetKey] = numeric;
  };

  setOptionalNumericField(['latitude', 'lat'], 'latitude', 'latitude');
  setOptionalNumericField(['longitude', 'lon', 'lng'], 'longitude', 'longitude');
  setOptionalNumericField(['redmineIssueId', 'redmine_issue_id'], 'redmine_issue_id', 'redmineIssueId');

  const primaryAssigneeUserEntry = readFirstDefined(['primaryAssigneeUserId', 'primary_assignee_user_id']);
  const primaryAssigneeOrgEntry = readFirstDefined(['primaryAssigneeOrgUnitId', 'primary_assignee_org_unit_id']);
  const collaboratorUserEntry = readFirstDefined(['collaboratorUserIds', 'collaborator_user_ids']);
  const collaboratorOrgEntry = readFirstDefined(['collaboratorOrgUnitIds', 'collaborator_org_unit_ids']);

  const hasPrimaryAssigneeMutation = primaryAssigneeUserEntry.present || primaryAssigneeOrgEntry.present;
  const hasCollaboratorMutation = collaboratorUserEntry.present || collaboratorOrgEntry.present;
  const hasAssignmentMutation = hasPrimaryAssigneeMutation || hasCollaboratorMutation;

  let existingTenantId = '';
  let existingPrimaryAssigneeUserId = '';
  let existingPrimaryAssigneeOrgUnitId = '';
  let existingCollaboratorUserIds: string[] = [];
  let existingCollaboratorOrgUnitIds: string[] = [];
  let nextPrimaryAssigneeUserId = '';
  let nextPrimaryAssigneeOrgUnitId = '';
  let nextCollaboratorUserIds: string[] = [];
  let nextCollaboratorOrgUnitIds: string[] = [];

  if (hasAssignmentMutation) {
    const assignmentContext = await db.get(
      `SELECT tenant_id, primary_assignee_user_id, primary_assignee_org_unit_id
       FROM tickets
       WHERE id = ?
       LIMIT 1`,
      [execution.ticketId]
    );
    if (!assignmentContext?.tenant_id) {
      throw new Error('Ticket für Zuweisungs-Update nicht gefunden.');
    }
    existingTenantId = asTrimmedString(assignmentContext.tenant_id) || 'tenant_default';
    existingPrimaryAssigneeUserId = asTrimmedString(assignmentContext.primary_assignee_user_id);
    existingPrimaryAssigneeOrgUnitId = asTrimmedString(assignmentContext.primary_assignee_org_unit_id);

    if (hasCollaboratorMutation) {
      const existingCollaboratorRows = await db.all(
        `SELECT user_id, org_unit_id
         FROM ticket_collaborators
         WHERE ticket_id = ?`,
        [execution.ticketId]
      );
      existingCollaboratorUserIds = Array.from(
        new Set(
          (existingCollaboratorRows || [])
            .map((row: any) => asTrimmedString(row?.user_id))
            .filter(Boolean)
        )
      );
      existingCollaboratorOrgUnitIds = Array.from(
        new Set(
          (existingCollaboratorRows || [])
            .map((row: any) => asTrimmedString(row?.org_unit_id))
            .filter(Boolean)
        )
      );
    }

    nextPrimaryAssigneeUserId = primaryAssigneeUserEntry.present
      ? asTrimmedString(primaryAssigneeUserEntry.value)
      : existingPrimaryAssigneeUserId;
    nextPrimaryAssigneeOrgUnitId = primaryAssigneeOrgEntry.present
      ? asTrimmedString(primaryAssigneeOrgEntry.value)
      : existingPrimaryAssigneeOrgUnitId;
    if (nextPrimaryAssigneeUserId && nextPrimaryAssigneeOrgUnitId) {
      throw new Error('Workflow-Patch: Nur Benutzer ODER Organisationseinheit als Primärzuweisung zulässig.');
    }

    if (primaryAssigneeUserEntry.present && nextPrimaryAssigneeUserId) {
      const userRow = await db.get(`SELECT id FROM admin_users WHERE id = ? LIMIT 1`, [nextPrimaryAssigneeUserId]);
      if (!userRow?.id) {
        throw new Error(`Workflow-Patch: primaryAssigneeUserId "${nextPrimaryAssigneeUserId}" ist unbekannt.`);
      }
    }
    if (primaryAssigneeOrgEntry.present && nextPrimaryAssigneeOrgUnitId) {
      const orgRow = await db.get(
        `SELECT id
         FROM org_units
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1`,
        [nextPrimaryAssigneeOrgUnitId, existingTenantId]
      );
      if (!orgRow?.id) {
        throw new Error(
          `Workflow-Patch: primaryAssigneeOrgUnitId "${nextPrimaryAssigneeOrgUnitId}" ist im Mandanten nicht vorhanden.`
        );
      }
    }

    nextCollaboratorUserIds = collaboratorUserEntry.present
      ? parseIdList(collaboratorUserEntry.value)
      : existingCollaboratorUserIds;
    nextCollaboratorOrgUnitIds = collaboratorOrgEntry.present
      ? parseIdList(collaboratorOrgEntry.value)
      : existingCollaboratorOrgUnitIds;

    if (collaboratorUserEntry.present && nextCollaboratorUserIds.length > 0) {
      const placeholders = nextCollaboratorUserIds.map(() => '?').join(', ');
      const knownRows = await db.all(
        `SELECT id
         FROM admin_users
         WHERE id IN (${placeholders})`,
        nextCollaboratorUserIds
      );
      const known = new Set((knownRows || []).map((row: any) => asTrimmedString(row?.id)).filter(Boolean));
      const missing = nextCollaboratorUserIds.filter((id) => !known.has(id));
      if (missing.length > 0) {
        throw new Error(`Workflow-Patch: Unbekannte collaboratorUserIds: ${missing.join(', ')}`);
      }
    }
    if (collaboratorOrgEntry.present && nextCollaboratorOrgUnitIds.length > 0) {
      const placeholders = nextCollaboratorOrgUnitIds.map(() => '?').join(', ');
      const knownRows = await db.all(
        `SELECT id
         FROM org_units
         WHERE tenant_id = ?
           AND id IN (${placeholders})`,
        [existingTenantId, ...nextCollaboratorOrgUnitIds]
      );
      const known = new Set((knownRows || []).map((row: any) => asTrimmedString(row?.id)).filter(Boolean));
      const missing = nextCollaboratorOrgUnitIds.filter((id) => !known.has(id));
      if (missing.length > 0) {
        throw new Error(`Workflow-Patch: Unbekannte collaboratorOrgUnitIds: ${missing.join(', ')}`);
      }
    }

    if (primaryAssigneeUserEntry.present) {
      updates.push('primary_assignee_user_id = ?');
      values.push(nextPrimaryAssigneeUserId || null);
      applied.primaryAssigneeUserId = nextPrimaryAssigneeUserId;
    }
    if (primaryAssigneeOrgEntry.present) {
      updates.push('primary_assignee_org_unit_id = ?');
      values.push(nextPrimaryAssigneeOrgUnitId || null);
      applied.primaryAssigneeOrgUnitId = nextPrimaryAssigneeOrgUnitId;
    }
    if (hasPrimaryAssigneeMutation && !legacyAssignedToEntry.present) {
      const fallbackLegacyAssignedTo = nextPrimaryAssigneeUserId || nextPrimaryAssigneeOrgUnitId || '';
      updates.push('assigned_to = ?');
      values.push(fallbackLegacyAssignedTo);
      applied.assignedTo = fallbackLegacyAssignedTo;
    }
    if (hasAssignmentMutation) {
      updates.push('assignment_updated_by = ?');
      values.push('workflow');
      updates.push('assignment_updated_at = CURRENT_TIMESTAMP');
    }
    if (collaboratorUserEntry.present) {
      applied.collaboratorUserIds = nextCollaboratorUserIds;
    }
    if (collaboratorOrgEntry.present) {
      applied.collaboratorOrgUnitIds = nextCollaboratorOrgUnitIds;
    }
  }

  if (updates.length === 0 && !hasCollaboratorMutation) {
    return null;
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  if (updates.length > 1 || hasAssignmentMutation || Object.keys(applied).length > 0) {
    await db.run(
      `UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`,
      [...values, execution.ticketId]
    );
  }

  if (hasCollaboratorMutation) {
    await db.run(`DELETE FROM ticket_collaborators WHERE ticket_id = ?`, [execution.ticketId]);
    const rowsToInsert = [
      ...nextCollaboratorUserIds.map((userId) => ({ userId, orgUnitId: null as string | null })),
      ...nextCollaboratorOrgUnitIds.map((orgUnitId) => ({ userId: null as string | null, orgUnitId })),
    ];
    for (const row of rowsToInsert) {
      await db.run(
        `INSERT INTO ticket_collaborators (id, ticket_id, tenant_id, user_id, org_unit_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          `tcoll_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          execution.ticketId,
          existingTenantId || 'tenant_default',
          row.userId,
          row.orgUnitId,
          'workflow',
        ]
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(applied, 'category') || Object.prototype.hasOwnProperty.call(applied, 'priority')) {
    const ticketRow = await db.get(
      `SELECT submission_id, category, priority
       FROM tickets
       WHERE id = ?
       LIMIT 1`,
      [execution.ticketId]
    );
    const submissionId = String(ticketRow?.submission_id || '').trim();
    if (submissionId) {
      const nextCategory =
        typeof applied.category === 'string' && applied.category.trim()
          ? applied.category.trim()
          : String(ticketRow?.category || '').trim();
      const nextPriority =
        typeof applied.priority === 'string' && applied.priority.trim()
          ? applied.priority.trim()
          : String(ticketRow?.priority || '').trim();
      await db.run(
        `UPDATE submissions
         SET category = ?, priority = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextCategory || null, nextPriority || null, submissionId]
      );
    }
  }

  if (hasAssignmentMutation) {
    const assignmentRecipients: Array<{ type: 'user' | 'org_unit'; id: string; roleLabel: string }> = [];
    if (nextPrimaryAssigneeUserId && nextPrimaryAssigneeUserId !== existingPrimaryAssigneeUserId) {
      assignmentRecipients.push({
        type: 'user',
        id: nextPrimaryAssigneeUserId,
        roleLabel: 'Primärzuweisung',
      });
    }
    if (nextPrimaryAssigneeOrgUnitId && nextPrimaryAssigneeOrgUnitId !== existingPrimaryAssigneeOrgUnitId) {
      assignmentRecipients.push({
        type: 'org_unit',
        id: nextPrimaryAssigneeOrgUnitId,
        roleLabel: 'Primärzuweisung',
      });
    }
    const existingCollaboratorUserIdSet = new Set(existingCollaboratorUserIds);
    const existingCollaboratorOrgUnitIdSet = new Set(existingCollaboratorOrgUnitIds);
    for (const userId of nextCollaboratorUserIds) {
      if (!userId || existingCollaboratorUserIdSet.has(userId)) continue;
      assignmentRecipients.push({
        type: 'user',
        id: userId,
        roleLabel: 'Mitwirkend',
      });
    }
    for (const orgUnitId of nextCollaboratorOrgUnitIds) {
      if (!orgUnitId || existingCollaboratorOrgUnitIdSet.has(orgUnitId)) continue;
      assignmentRecipients.push({
        type: 'org_unit',
        id: orgUnitId,
        roleLabel: 'Mitwirkend',
      });
    }
    if (assignmentRecipients.length > 0) {
      void sendTicketAssignmentEmailNotifications({
        ticketId: execution.ticketId,
        recipients: assignmentRecipients,
        context: 'ticket_assignment',
      }).catch((assignmentError) => {
        console.warn('Workflow ticket patch assignment email notifications failed:', assignmentError);
      });
    }
  }

  publishTicketUpdate({
    reason: 'ticket.workflow.patch',
    ticketId: execution.ticketId,
  });
  return applied;
}

function normalizeRestAwaitingUntil(rawOutput: Record<string, any>): string | null {
  const awaitingUntilRaw = rawOutput.awaitingUntil ?? rawOutput.resumeAt ?? null;
  if (typeof awaitingUntilRaw === 'string' && awaitingUntilRaw.trim()) {
    const parsed = new Date(awaitingUntilRaw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const awaitingMs = Number(rawOutput.awaitingMs ?? rawOutput.waitMs ?? 0);
  if (Number.isFinite(awaitingMs) && awaitingMs > 0) {
    return new Date(Date.now() + awaitingMs).toISOString();
  }

  return null;
}

async function executeRestApiProbe(input: {
  sourceCode: string;
  baseUrl?: string;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  scriptInput?: any;
  persistedState?: Record<string, any>;
}) {
  const sourceCode = String(input.sourceCode || '').trim();
  if (!sourceCode) {
    throw new Error('RESTful API Probe: Kein JavaScript-Quelltext konfiguriert.');
  }

  const maxExecutionMs = Number.isFinite(Number(input.timeoutMs))
    ? Math.max(1000, Math.min(120000, Number(input.timeoutMs)))
    : 20000;
  const defaultRequestTimeoutMs = Number.isFinite(Number(input.requestTimeoutMs))
    ? Math.max(500, Math.min(120000, Number(input.requestTimeoutMs)))
    : 15000;
  const configuredBaseUrl = normalizeBaseUrl(String(input.baseUrl || ''));

  const incomingScriptInput =
    input.scriptInput && typeof input.scriptInput === 'object' && !Array.isArray(input.scriptInput)
      ? input.scriptInput
      : {};
  const ticketInput =
    incomingScriptInput.ticket && typeof incomingScriptInput.ticket === 'object'
      ? incomingScriptInput.ticket
      : incomingScriptInput;
  const workflowInput =
    incomingScriptInput.workflow && typeof incomingScriptInput.workflow === 'object'
      ? incomingScriptInput.workflow
      : {};
  const taskInput =
    incomingScriptInput.task && typeof incomingScriptInput.task === 'object'
      ? incomingScriptInput.task
      : {};

  const ticketContext = {
    id: String(ticketInput.id || ticketInput.ticketId || 'probe-ticket'),
    submission_id: String(ticketInput.submission_id || ticketInput.submissionId || 'probe-submission'),
    category: String(ticketInput.category || ''),
    priority: String(ticketInput.priority || 'medium'),
    status: String(ticketInput.status || 'open'),
    description: String(ticketInput.description || ''),
    address: String(ticketInput.address || ''),
    location: String(ticketInput.location || ticketInput.address || ''),
    city: String(ticketInput.city || ''),
    postal_code: String(ticketInput.postal_code || ticketInput.postalCode || ''),
    latitude:
      ticketInput.latitude !== null && ticketInput.latitude !== undefined
        ? Number(ticketInput.latitude)
        : null,
    longitude:
      ticketInput.longitude !== null && ticketInput.longitude !== undefined
        ? Number(ticketInput.longitude)
        : null,
    citizen_name: String(ticketInput.citizen_name || ticketInput.citizenName || ''),
    citizen_email: String(ticketInput.citizen_email || ticketInput.citizenEmail || ''),
    coordinates: String(ticketInput.coordinates || ''),
  };

  const scriptInput = {
    ticket: {
      ...ticketContext,
      citizenName: ticketContext.citizen_name,
      citizenEmail: ticketContext.citizen_email,
    },
    workflow: {
      id: String(workflowInput.id || 'probe-workflow'),
      templateId: String(workflowInput.templateId || ''),
      title: String(workflowInput.title || 'Probe-Workflow'),
      status: String(workflowInput.status || 'running'),
      executionMode: String(workflowInput.executionMode || 'MANUAL'),
    },
    task: {
      id: String(taskInput.id || 'probe-task'),
      title: String(taskInput.title || 'RESTful API Call (Probe)'),
      type: String(taskInput.type || 'REST_API_CALL'),
      config: taskInput.config && typeof taskInput.config === 'object' ? taskInput.config : {},
    },
    previousExecutionData:
      incomingScriptInput.previousExecutionData &&
      typeof incomingScriptInput.previousExecutionData === 'object' &&
      !Array.isArray(incomingScriptInput.previousExecutionData)
        ? incomingScriptInput.previousExecutionData
        : {},
  };

  const templateValues: Record<string, string> = {
    ticketId: ticketContext.id,
    submissionId: ticketContext.submission_id,
    category: ticketContext.category,
    priority: ticketContext.priority,
    status: ticketContext.status,
    address: ticketContext.address,
    location: ticketContext.location,
    city: ticketContext.city,
    postalCode: ticketContext.postal_code,
    description: ticketContext.description,
    coordinates: ticketContext.coordinates,
    latitude:
      ticketContext.latitude !== null && Number.isFinite(ticketContext.latitude)
        ? String(ticketContext.latitude)
        : '',
    longitude:
      ticketContext.longitude !== null && Number.isFinite(ticketContext.longitude)
        ? String(ticketContext.longitude)
        : '',
    citizenName: ticketContext.citizen_name,
    citizenEmail: ticketContext.citizen_email,
  };

  const interpolateString = (value: string): string =>
    String(value || '').replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (match, tokenA, tokenB) => {
      const token = String(tokenA || tokenB || '');
      return Object.prototype.hasOwnProperty.call(templateValues, token)
        ? templateValues[token] ?? ''
        : match;
    });

  const interpolateAny = (value: any, depth = 0): any => {
    if (depth > 6) return value;
    if (typeof value === 'string') return interpolateString(value);
    if (Array.isArray(value)) return value.map((item) => interpolateAny(item, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, interpolateAny(val, depth + 1)])
      );
    }
    return value;
  };

  const requestHistory: Array<Record<string, any>> = [];
  const logLines: string[] = [];
  const pushLog = (level: 'log' | 'warn' | 'error', args: any[]) => {
    const rendered = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
    const limited = truncateWorkflowStorageString(rendered, 1400);
    logLines.push(`[${level}] ${limited}`);
    if (logLines.length > 120) {
      logLines.shift();
    }
  };

  const httpRequest = async (requestInput: any): Promise<Record<string, any>> => {
    const requestConfig =
      typeof requestInput === 'string'
        ? { url: requestInput }
        : requestInput && typeof requestInput === 'object'
        ? requestInput
        : {};

    const method = String(requestConfig.method || requestConfig.httpMethod || 'GET')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]+$/.test(method)) {
      throw new Error('RESTful API Probe: Ungueltige HTTP-Methode.');
    }

    const providedUrl = interpolateString(
      String(requestConfig.url || requestConfig.endpoint || requestConfig.uri || '').trim()
    );
    if (!providedUrl) {
      throw new Error('RESTful API Probe: URL fuer request() fehlt.');
    }

    let url: URL;
    try {
      url = new URL(providedUrl);
    } catch {
      if (!configuredBaseUrl) {
        throw new Error(
          `RESTful API Probe: URL "${providedUrl}" ist relativ, aber kein baseUrl ist konfiguriert.`
        );
      }
      url = new URL(providedUrl, `${configuredBaseUrl}/`);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`RESTful API Probe: Protokoll "${url.protocol}" ist nicht erlaubt.`);
    }

    if (requestConfig.query && typeof requestConfig.query === 'object') {
      for (const [key, value] of Object.entries(requestConfig.query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {};
    if (requestConfig.headers && typeof requestConfig.headers === 'object') {
      for (const [key, value] of Object.entries(requestConfig.headers)) {
        if (!key) continue;
        if (value === null || value === undefined) continue;
        headers[String(key)] = String(value);
      }
    }

    let body: any;
    let requestBodyPreview = '';
    if (Object.prototype.hasOwnProperty.call(requestConfig, 'json')) {
      const payload = interpolateAny(requestConfig.json);
      body = JSON.stringify(payload);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      requestBodyPreview = String(body).slice(0, 1400);
    } else if (Object.prototype.hasOwnProperty.call(requestConfig, 'body')) {
      const payload = interpolateAny(requestConfig.body);
      if (payload === null || payload === undefined) {
        body = undefined;
      } else if (typeof payload === 'string') {
        body = payload;
        requestBodyPreview = payload.slice(0, 1400);
      } else if (payload instanceof URLSearchParams) {
        body = payload;
        requestBodyPreview = payload.toString().slice(0, 1400);
      } else if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
        body = payload as any;
        requestBodyPreview = '[binary]';
      } else {
        body = JSON.stringify(payload);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
        requestBodyPreview = String(body).slice(0, 1400);
      }
    }

    const timeoutMs = Number.isFinite(Number(requestConfig.timeoutMs))
      ? Math.max(500, Math.min(120000, Number(requestConfig.timeoutMs)))
      : defaultRequestTimeoutMs;

    const parseAs = String(requestConfig.parseAs || requestConfig.responseType || '').toLowerCase();
    const throwOnHttpError = requestConfig.throwOnHttpError === true;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const responseText = await response.text();
      const responseHeaders = Object.fromEntries(response.headers.entries());
      let jsonPayload: any = null;
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();

      if (responseText && (parseAs === 'json' || contentType.includes('application/json'))) {
        try {
          jsonPayload = JSON.parse(responseText);
        } catch {
          jsonPayload = null;
        }
      }

      let data: any = responseText;
      if (parseAs === 'json') {
        data = jsonPayload;
      } else if (parseAs === 'text') {
        data = responseText;
      } else if (jsonPayload !== null) {
        data = jsonPayload;
      }

      const responseData = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers: responseHeaders,
        data,
        text: responseText,
        json: jsonPayload,
      };

      requestHistory.push({
        method,
        url: url.toString(),
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
        requestHeaders: headers,
        requestBodyPreview,
      });
      if (requestHistory.length > 24) {
        requestHistory.shift();
      }

      if (!response.ok && throwOnHttpError) {
        const httpError = new Error(
          `RESTful API Probe: HTTP ${response.status} ${response.statusText || ''}`.trim()
        );
        (httpError as any).response = responseData;
        throw httpError;
      }

      return responseData;
    } finally {
      clearTimeout(timeoutHandle);
    }
  };

  const persistedState =
    input.persistedState && typeof input.persistedState === 'object' && !Array.isArray(input.persistedState)
      ? input.persistedState
      : {};
  const sandbox: Record<string, any> = {
    input: scriptInput,
    context: scriptInput,
    state: { ...persistedState },
    result: undefined,
    request: httpRequest,
    fetch: httpRequest,
    interpolate: interpolateString,
    sleep: async (ms: number) => {
      const delayMs = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    },
    setResult: (value: any) => {
      sandbox.result = value;
    },
    console: {
      log: (...args: any[]) => pushLog('log', args),
      warn: (...args: any[]) => pushLog('warn', args),
      error: (...args: any[]) => pushLog('error', args),
    },
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    URL,
    URLSearchParams,
  };

  const startedAt = Date.now();
  try {
    const context = vm.createContext(sandbox, {
      name: `workflow-rest-probe-${Date.now()}`,
      codeGeneration: {
        strings: false,
        wasm: false,
      },
    });
    const wrappedSource = `(async () => {\n${sourceCode}\n})()`;
    const compiled = new vm.Script(wrappedSource, {
      filename: 'workflow-rest-probe.js',
    });

    const runPromise = Promise.resolve(
      compiled.runInContext(context, {
        timeout: maxExecutionMs,
      })
    );
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `RESTful API Probe: Ausfuehrungszeitlimit von ${maxExecutionMs}ms ueberschritten.`
          )
        );
      }, maxExecutionMs);
    });
    let scriptReturn: any;
    try {
      scriptReturn = await Promise.race([runPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    const rawOutput =
      scriptReturn !== undefined
        ? scriptReturn
        : Object.prototype.hasOwnProperty.call(sandbox, 'result')
        ? sandbox.result
        : undefined;
    const outputObject =
      rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput)
        ? (rawOutput as Record<string, any>)
        : { result: rawOutput };

    return {
      runtimeMs: Date.now() - startedAt,
      requests: sanitizeWorkflowStorageValue(requestHistory),
      logs: sanitizeWorkflowStorageValue(logLines),
      output: sanitizeWorkflowStorageValue(rawOutput ?? null),
      outputObject: sanitizeWorkflowStorageValue(outputObject),
      awaitingUntil: normalizeRestAwaitingUntil(outputObject),
      state: sanitizeWorkflowStorageValue(
        sandbox.state && typeof sandbox.state === 'object' ? sandbox.state : {}
      ),
      interpolatedPreview: {
        ticketId: templateValues.ticketId,
        category: templateValues.category,
        location: templateValues.location,
      },
    };
  } catch (error: any) {
    const probeError = new Error(
      error?.message || 'RESTful API Probe: Ausfuehrung fehlgeschlagen.'
    );
    (probeError as any).probeData = {
      runtimeMs: Date.now() - startedAt,
      requests: sanitizeWorkflowStorageValue(requestHistory),
      logs: sanitizeWorkflowStorageValue(logLines),
      error: truncateWorkflowStorageString(String(error?.message || 'Probe fehlgeschlagen'), 1200),
    };
    throw probeError;
  }
}

async function executeRestApiCallTask(execution: WorkflowExecution, task: WorkflowTask) {
  const { ticket, description, address, locationText, coordinates } = await loadTicketContext(execution);
  const sourceCode = typeof task.config?.sourceCode === 'string' ? task.config.sourceCode : '';
  if (!sourceCode.trim()) {
    throw new Error('RESTful API Call: Kein JavaScript-Quelltext konfiguriert.');
  }

  const maxExecutionMs = Number.isFinite(Number(task.config?.timeoutMs))
    ? Math.max(1000, Math.min(120000, Number(task.config.timeoutMs)))
    : 20000;
  const defaultRequestTimeoutMs = Number.isFinite(Number(task.config?.requestTimeoutMs))
    ? Math.max(500, Math.min(120000, Number(task.config.requestTimeoutMs)))
    : 15000;
  const continueOnError = task.config?.continueOnError === true;
  const configuredBaseUrl = normalizeBaseUrl(String(task.config?.baseUrl || ''));

  const templateValues: Record<string, string> = {
    ticketId: String(ticket.id || ''),
    submissionId: String(ticket.submission_id || ''),
    category: String(ticket.category || ''),
    priority: String(ticket.priority || ''),
    status: String(ticket.status || ''),
    address: String(address || ''),
    location: String(locationText || address || ''),
    city: String(ticket.city || ticket.submission_city || ''),
    postalCode: String(ticket.postal_code || ticket.submission_postal_code || ''),
    description: String(description || ''),
    coordinates: String(coordinates || ''),
    latitude:
      ticket.latitude !== null && ticket.latitude !== undefined ? String(ticket.latitude) : '',
    longitude:
      ticket.longitude !== null && ticket.longitude !== undefined ? String(ticket.longitude) : '',
    citizenName: String(ticket.citizen_name || ''),
    citizenEmail: String(ticket.citizen_email || ''),
  };

  const interpolateString = (value: string): string =>
    String(value || '').replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_match, tokenA, tokenB) => {
      const token = String(tokenA || tokenB || '');
      return Object.prototype.hasOwnProperty.call(templateValues, token)
        ? templateValues[token] ?? ''
        : _match;
    });

  const interpolateAny = (value: any, depth = 0): any => {
    if (depth > 6) return value;
    if (typeof value === 'string') return interpolateString(value);
    if (Array.isArray(value)) return value.map((item) => interpolateAny(item, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, interpolateAny(val, depth + 1)])
      );
    }
    return value;
  };

  const requestHistory: Array<Record<string, any>> = [];
  const logLines: string[] = [];
  const pushLog = (level: 'log' | 'warn' | 'error', args: any[]) => {
    const rendered = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
    const limited = truncateWorkflowStorageString(rendered, 1400);
    logLines.push(`[${level}] ${limited}`);
    if (logLines.length > 120) {
      logLines.shift();
    }
  };

  const httpRequest = async (requestInput: any): Promise<Record<string, any>> => {
    const requestConfig =
      typeof requestInput === 'string'
        ? { url: requestInput }
        : requestInput && typeof requestInput === 'object'
        ? requestInput
        : {};

    const method = String(requestConfig.method || requestConfig.httpMethod || 'GET')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]+$/.test(method)) {
      throw new Error('RESTful API Call: Ungueltige HTTP-Methode.');
    }

    const providedUrl = interpolateString(
      String(requestConfig.url || requestConfig.endpoint || requestConfig.uri || '').trim()
    );
    if (!providedUrl) {
      throw new Error('RESTful API Call: URL fuer request() fehlt.');
    }

    let url: URL;
    try {
      url = new URL(providedUrl);
    } catch {
      if (!configuredBaseUrl) {
        throw new Error(
          `RESTful API Call: URL "${providedUrl}" ist relativ, aber kein baseUrl ist konfiguriert.`
        );
      }
      url = new URL(providedUrl, `${configuredBaseUrl}/`);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`RESTful API Call: Protokoll "${url.protocol}" ist nicht erlaubt.`);
    }

    if (requestConfig.query && typeof requestConfig.query === 'object') {
      for (const [key, value] of Object.entries(requestConfig.query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {};
    if (requestConfig.headers && typeof requestConfig.headers === 'object') {
      for (const [key, value] of Object.entries(requestConfig.headers)) {
        if (!key) continue;
        if (value === null || value === undefined) continue;
        headers[String(key)] = String(value);
      }
    }

    let body: any;
    let requestBodyPreview = '';
    if (Object.prototype.hasOwnProperty.call(requestConfig, 'json')) {
      const payload = interpolateAny(requestConfig.json);
      body = JSON.stringify(payload);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      requestBodyPreview = String(body).slice(0, 1400);
    } else if (Object.prototype.hasOwnProperty.call(requestConfig, 'body')) {
      const payload = interpolateAny(requestConfig.body);
      if (payload === null || payload === undefined) {
        body = undefined;
      } else if (typeof payload === 'string') {
        body = payload;
        requestBodyPreview = payload.slice(0, 1400);
      } else if (payload instanceof URLSearchParams) {
        body = payload;
        requestBodyPreview = payload.toString().slice(0, 1400);
      } else if (
        payload instanceof Uint8Array ||
        payload instanceof ArrayBuffer
      ) {
        body = payload as any;
        requestBodyPreview = '[binary]';
      } else {
        body = JSON.stringify(payload);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
        requestBodyPreview = String(body).slice(0, 1400);
      }
    }

    const timeoutMs = Number.isFinite(Number(requestConfig.timeoutMs))
      ? Math.max(500, Math.min(120000, Number(requestConfig.timeoutMs)))
      : defaultRequestTimeoutMs;

    const parseAs = String(requestConfig.parseAs || requestConfig.responseType || '').toLowerCase();
    const throwOnHttpError = requestConfig.throwOnHttpError === true;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const responseText = await response.text();
      const responseHeaders = Object.fromEntries(response.headers.entries());
      let jsonPayload: any = null;
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();

      if (responseText && (parseAs === 'json' || contentType.includes('application/json'))) {
        try {
          jsonPayload = JSON.parse(responseText);
        } catch {
          jsonPayload = null;
        }
      }

      let data: any = responseText;
      if (parseAs === 'json') {
        data = jsonPayload;
      } else if (parseAs === 'text') {
        data = responseText;
      } else if (jsonPayload !== null) {
        data = jsonPayload;
      }

      const responseData = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers: responseHeaders,
        data,
        text: responseText,
        json: jsonPayload,
      };

      requestHistory.push({
        method,
        url: url.toString(),
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
        requestHeaders: headers,
        requestBodyPreview,
      });
      if (requestHistory.length > 24) {
        requestHistory.shift();
      }

      if (!response.ok && throwOnHttpError) {
        const httpError = new Error(
          `RESTful API Call: HTTP ${response.status} ${response.statusText || ''}`.trim()
        );
        (httpError as any).response = responseData;
        throw httpError;
      }

      return responseData;
    } finally {
      clearTimeout(timeoutHandle);
    }
  };

  const scriptInput = {
    ticket: {
      ...ticket,
      description,
      location: locationText || address || '',
      coordinates,
      citizenName: ticket.citizen_name || '',
      citizenEmail: ticket.citizen_email || '',
    },
    workflow: {
      id: execution.id,
      templateId: execution.templateId || '',
      title: execution.title,
      status: execution.status,
      executionMode: execution.executionMode,
    },
    task: {
      id: task.id,
      title: task.title,
      type: task.type,
      config: task.config || {},
    },
    previousExecutionData: task.executionData || {},
  };

  const persistedState =
    task.executionData?.restState &&
    typeof task.executionData.restState === 'object' &&
    !Array.isArray(task.executionData.restState)
      ? task.executionData.restState
      : {};
  const sandbox: Record<string, any> = {
    input: scriptInput,
    context: scriptInput,
    state: { ...persistedState },
    result: undefined,
    request: httpRequest,
    fetch: httpRequest,
    interpolate: interpolateString,
    sleep: async (ms: number) => {
      const delayMs = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    },
    setResult: (value: any) => {
      sandbox.result = value;
    },
    console: {
      log: (...args: any[]) => pushLog('log', args),
      warn: (...args: any[]) => pushLog('warn', args),
      error: (...args: any[]) => pushLog('error', args),
    },
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    URL,
    URLSearchParams,
  };

  const startedAt = Date.now();
  try {
    const context = vm.createContext(sandbox, {
      name: `workflow-rest-${execution.id}-${task.id}`,
      codeGeneration: {
        strings: false,
        wasm: false,
      },
    });
    const wrappedSource = `(async () => {\n${sourceCode}\n})()`;
    const compiled = new vm.Script(wrappedSource, {
      filename: `workflow-rest-${task.id}.js`,
    });

    const runPromise = Promise.resolve(
      compiled.runInContext(context, {
        timeout: maxExecutionMs,
      })
    );
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `RESTful API Call: Ausführungszeitlimit von ${maxExecutionMs}ms überschritten.`
          )
        );
      }, maxExecutionMs);
    });
    let scriptReturn: any;
    try {
      scriptReturn = await Promise.race([runPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    const rawOutput =
      scriptReturn !== undefined ? scriptReturn : Object.prototype.hasOwnProperty.call(sandbox, 'result') ? sandbox.result : undefined;
    const outputObject =
      rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput)
        ? (rawOutput as Record<string, any>)
        : { result: rawOutput };

    const nextTaskIds = resolveConfiguredTaskIdsFromConfig(
      execution,
      outputObject.nextTaskIds ?? outputObject.nextTaskId
    );
    const pathGroupsByTaskId =
      outputObject.pathGroupsByTaskId && typeof outputObject.pathGroupsByTaskId === 'object'
        ? Object.entries(outputObject.pathGroupsByTaskId as Record<string, any>).reduce<Record<string, string>>(
            (acc, [taskId, groupValue]) => {
              const normalizedTaskId = normalizeSingleTaskId(execution, taskId);
              const normalizedGroup = normalizePathGroup(groupValue);
              if (normalizedTaskId && normalizedGroup) {
                acc[normalizedTaskId] = normalizedGroup;
              }
              return acc;
            },
            {}
          )
        : {};
    const endScopeRaw = String(outputObject.endScope || '').toLowerCase();
    const endScope: 'branch' | 'workflow' | undefined =
      endScopeRaw === 'workflow' || endScopeRaw === 'branch'
        ? (endScopeRaw as 'branch' | 'workflow')
        : undefined;
    const awaitingUntil = normalizeRestAwaitingUntil(outputObject);
    const ticketPatchResult = await applyWorkflowTicketPatch(
      execution,
      outputObject.patchTicket ?? outputObject.ticketPatch
    );
    const nextState =
      outputObject.state &&
      typeof outputObject.state === 'object' &&
      !Array.isArray(outputObject.state)
        ? outputObject.state
        : sandbox.state && typeof sandbox.state === 'object'
        ? sandbox.state
        : undefined;

    const executionData: WorkflowExecutionData = {
      restApiCall: {
        runtimeMs: Date.now() - startedAt,
        requests: sanitizeWorkflowStorageValue(requestHistory),
        logs: sanitizeWorkflowStorageValue(logLines),
        result:
          sanitizeWorkflowStorageValue(
            Object.prototype.hasOwnProperty.call(outputObject, 'result')
              ? outputObject.result
              : rawOutput ?? null
          ),
      },
    };
    if (nextTaskIds.length > 0) {
      executionData.nextTaskIds = nextTaskIds;
    }
    if (Object.keys(pathGroupsByTaskId).length > 0) {
      executionData.pathGroupsByTaskId = pathGroupsByTaskId;
    }
    if (endScope) {
      executionData.endScope = endScope;
    }
    if (awaitingUntil) {
      executionData.awaitingUntil = awaitingUntil;
    }
    if (ticketPatchResult) {
      executionData.ticketPatch = ticketPatchResult;
    }
    if (nextState) {
      executionData.restState = nextState;
    }
    return executionData;
  } catch (error: any) {
    const errorMessage =
      error?.message || 'RESTful API Call: Ausfuehrung fehlgeschlagen.';
    const executionData: WorkflowExecutionData = {
      restApiCall: {
        runtimeMs: Date.now() - startedAt,
        requests: sanitizeWorkflowStorageValue(requestHistory),
        logs: sanitizeWorkflowStorageValue(logLines),
        error: truncateWorkflowStorageString(errorMessage, 1200),
      },
    };

    if (continueOnError) {
      return {
        ...executionData,
        skipped: true,
        reason: errorMessage,
      };
    }

    const enrichedError = new Error(errorMessage);
    (enrichedError as any).executionData = executionData;
    throw enrichedError;
  }
}

async function executeImageToTextAnalysisTask(execution: WorkflowExecution, task: WorkflowTask) {
  const { ticket, address, locationText, nominatimRaw, weatherReport } = await loadTicketContext(execution);
  const submissionId = String(ticket?.submission_id || '').trim();
  if (!submissionId) {
    return { skipped: true, reason: 'Keine Submission fuer Bildanalyse vorhanden.' };
  }

  const includeDescription = task.config?.includeDescription !== false;
  const includeOsmData = task.config?.includeOsmData === true;
  const includeWeatherData = task.config?.includeWeatherData === true;
  const modelId = typeof task.config?.modelId === 'string' ? String(task.config.modelId).trim() : '';
  const connectionId = typeof task.config?.connectionId === 'string' ? String(task.config.connectionId).trim() : '';

  const ticketContext = buildImageAiPseudonymizedTicketContext({
    ticketId: ticket?.id,
    category: ticket?.category,
    priority: ticket?.priority,
    status: ticket?.status,
    description: ticket?.submission_anonymized_text || '',
    address: address || ticket?.submission_address || '',
    postalCode: ticket?.postal_code || ticket?.submission_postal_code || '',
    city: ticket?.city || ticket?.submission_city || '',
    locationText,
    nominatimRaw,
    weatherReport,
    citizenName: ticket?.citizen_name,
    citizenEmail: ticket?.citizen_email,
    pseudoName: ticket?.reporter_pseudo_name,
    pseudoEmail: ticket?.reporter_pseudo_email,
    contextOptions: {
      includeDescription,
      includeOsmData,
      includeWeatherData,
    },
  });

  const modeRaw = String(task.config?.mode || task.config?.runMode || 'always').trim().toLowerCase();
  const mode = modeRaw === 'below_confidence' ? 'below_confidence' : 'always';
  const thresholdRaw = Number(task.config?.confidenceThreshold);
  const confidenceThreshold = Number.isFinite(thresholdRaw)
    ? Math.max(0, Math.min(1, thresholdRaw))
    : 0.75;
  const onlyMissing = task.config?.onlyMissing !== false;
  const overwriteExisting = task.config?.overwriteExisting === true;
  const failOnError = task.config?.failOnError === true;
  const effectiveOnlyMissing = overwriteExisting ? false : onlyMissing;
  const textConfidence = resolveWorkflowTextConfidence(execution, task);

  if (mode === 'below_confidence' && textConfidence !== null && textConfidence >= confidenceThreshold) {
    const reason = `Text-Konfidenz ${textConfidence.toFixed(2)} liegt ueber Schwellwert ${confidenceThreshold.toFixed(2)}.`;
    appendWorkflowHistory(execution, 'TASK_DATA', 'Bild-zu-Text-Auswertung uebersprungen.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: {
        mode,
        confidenceThreshold,
        textConfidence,
        includeDescription,
        includeOsmData,
        includeWeatherData,
        modelId: modelId || null,
        connectionId: connectionId || null,
      },
    });
    return {
      skipped: true,
      reason,
      imageToTextAnalysis: {
        mode,
        confidenceThreshold,
        textConfidence,
        includeDescription,
        includeOsmData,
        includeWeatherData,
        modelId: modelId || null,
        connectionId: connectionId || null,
      },
    };
  }

  const db = getDatabase();
  const imageRows = await db.all(
    `SELECT id, file_name, image_data,
            ai_description_text, ai_description_confidence, ai_description_model,
            ai_description_status, ai_description_error, ai_description_hash, ai_description_updated_at
     FROM submission_images
     WHERE submission_id = ?
     ORDER BY created_at ASC`,
    [submissionId]
  );
  if (!Array.isArray(imageRows) || imageRows.length === 0) {
    return { skipped: true, reason: 'Keine Bilder fuer Ticket vorhanden.' };
  }

  const candidates = imageRows.filter((row: any) => {
    if (!effectiveOnlyMissing) return true;
    const hasDescription =
      typeof row?.ai_description_text === 'string' && row.ai_description_text.trim().length > 0;
    return !hasDescription;
  });

  if (candidates.length === 0) {
    return {
      skipped: true,
      reason: 'Alle Bilder sind bereits mit Beschreibung vorhanden.',
      imageToTextAnalysis: {
        mode,
        confidenceThreshold,
        textConfidence,
        includeDescription,
        includeOsmData,
        includeWeatherData,
        modelId: modelId || null,
        connectionId: connectionId || null,
        totalImages: imageRows.length,
        candidateImages: 0,
      },
    };
  }

  let analyzedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;
  const imageResults: Array<Record<string, any>> = [];

  for (const row of candidates) {
    const imageId = String(row?.id || '');
    if (!imageId) continue;
    const buffer = normalizeImageBuffer(row?.image_data);
    if (!buffer) {
      failedCount += 1;
      imageResults.push({
        imageId,
        status: 'failed',
        reason: 'Bilddaten konnten nicht gelesen werden',
      });
      if (failOnError) {
        throw new Error(`Bilddaten fuer ${imageId} konnten nicht gelesen werden.`);
      }
      continue;
    }

    const imageHash = computeImageContentHash(buffer);
    const existingDescription =
      typeof row?.ai_description_text === 'string' && row.ai_description_text.trim()
        ? row.ai_description_text.trim()
        : '';
    const existingHash = typeof row?.ai_description_hash === 'string' ? row.ai_description_hash.trim() : '';
    const existingStatus = String(row?.ai_description_status || '').trim().toLowerCase();
    if (effectiveOnlyMissing && existingDescription && existingHash && existingHash === imageHash && existingStatus === 'done') {
      reusedCount += 1;
      imageResults.push({
        imageId,
        status: 'reused',
      });
      continue;
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
      const mimeType = guessImageMimeType(row?.file_name, buffer);
      const analysis = await analyzeImageToText({
        imageBuffer: buffer,
        mimeType,
        fileName: row?.file_name || null,
        languageCode: ticket?.citizen_preferred_language || null,
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
      analyzedCount += 1;
      imageResults.push({
        imageId,
        status: 'done',
        confidence: analysis.confidence,
      });
    } catch (imageError: any) {
      failedCount += 1;
      const errorMessage = imageError?.message || 'Bildanalyse fehlgeschlagen';
      await db.run(
        `UPDATE submission_images
         SET ai_description_status = 'failed',
             ai_description_error = ?,
             ai_description_hash = ?,
             ai_description_updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [errorMessage, imageHash, imageId]
      );
      imageResults.push({
        imageId,
        status: 'failed',
        reason: errorMessage,
      });
      if (failOnError) {
        throw new Error(`Bildanalyse fuer ${imageId} fehlgeschlagen: ${errorMessage}`);
      }
    }
  }

  const metadata = {
    mode,
    confidenceThreshold,
    textConfidence,
    includeDescription,
    includeOsmData,
    includeWeatherData,
    modelId: modelId || null,
    connectionId: connectionId || null,
    totalImages: imageRows.length,
    candidateImages: candidates.length,
    analyzedCount,
    reusedCount,
    failedCount,
    results: imageResults,
  };

  if (task.config?.addAiComment !== false) {
    const commentContent =
      analyzedCount > 0
        ? `Bild-zu-Text-Auswertung abgeschlossen: ${analyzedCount} Bild(er) neu analysiert, ${failedCount} Fehler.`
        : failedCount > 0
        ? `Bild-zu-Text-Auswertung fehlgeschlagen (${failedCount} Fehler).`
        : 'Bild-zu-Text-Auswertung: keine neuen Analysen erforderlich.';
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'ai',
      visibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
      commentType: 'classification',
      content: commentContent,
      metadata,
    });
  }

  appendWorkflowHistory(execution, 'TASK_DATA', 'Bild-zu-Text-Auswertung ausgefuehrt.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata,
  });

  if (analyzedCount > 0 || failedCount > 0) {
    publishTicketUpdate({
      reason: 'ticket.image.analysis.workflow',
      ticketId: execution.ticketId,
    });
  }

  return {
    imageToTextAnalysis: metadata,
    ...(failedCount > 0 && analyzedCount === 0 && failOnError
      ? { skipped: true, reason: 'Alle Bildanalysen fehlgeschlagen.' }
      : {}),
  };
}

async function executeWorkflowTask(
  execution: WorkflowExecution,
  task: WorkflowTask
): Promise<WorkflowExecutionData | null> {
  switch (task.type) {
    case 'REDMINE_TICKET':
      return executeRedmineTask(execution, task);
    case 'EMAIL_EXTERNAL':
      return executeExternalEmailTask(execution, task);
    case 'CATEGORIZATION':
      return executeCategorizationTask(execution, task);
    case 'RESPONSIBILITY_CHECK':
      return executeResponsibilityCheckTask(execution, task);
    case 'EMAIL_CONFIRMATION':
      return executeConfirmationEmailTask(execution, task);
    case 'EMAIL_DOUBLE_OPT_IN':
      return executeConfirmationEmailTask(execution, task);
    case 'MAYOR_INVOLVEMENT':
      return executeMayorInvolvementTask(execution, task);
    case 'DATENNACHFORDERUNG':
      return executeDataRequestTask(execution, task, 'static');
    case 'ENHANCED_CATEGORIZATION':
      return executeEnhancedCategorizationTask(execution, task);
    case 'FREE_AI_DATA_REQUEST':
      return executeFreeAiDataRequestTask(execution, task);
    case 'IMAGE_TO_TEXT_ANALYSIS':
      return executeImageToTextAnalysisTask(execution, task);
    case 'CITIZEN_NOTIFICATION':
      return executeCitizenNotificationTask(execution, task);
    case 'REST_API_CALL':
      return executeRestApiCallTask(execution, task);
    case 'EMAIL':
      return executeExternalEmailTask(execution, task);
    case 'WAIT_STATUS_CHANGE':
      return executeWaitStatusChangeTask(execution, task);
    case 'INTERNAL_PROCESSING':
      return executeInternalProcessingTask(execution, task);
    case 'END':
      return executeEndTask(execution, task);
    case 'JOIN':
      return executeJoinTask(execution, task);
    case 'SPLIT':
      return executeSplitTask(execution, task);
    case 'IF':
      return executeIfTask(execution, task);
    case 'CHANGE_WORKFLOW':
      return executeChangeWorkflowTask(execution, task);
    case 'SUB_WORKFLOW':
      return executeSubWorkflowTask(execution, task);
    case 'CUSTOM':
    default:
      return { skipped: true, reason: 'Custom-Task ohne Ausführung' };
  }
}

function normalizeInternalTaskResponsePayload(input: unknown): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return sanitizeWorkflowStorageValue(input) as Record<string, any>;
}

async function applyInternalTaskDecisionToWorkflow(
  options: {
    internalTaskRow: any;
    decision: InternalTaskDecision;
    actorUserId: string;
    note?: string;
    responsePayload?: Record<string, any>;
  }
): Promise<{ resumedWorkflow: boolean; executionId: string; stepId: string }> {
  const internalTaskRow = options.internalTaskRow || {};
  const executionId = asTrimmedString(internalTaskRow.workflow_execution_id);
  const stepId = asTrimmedString(internalTaskRow.step_id);
  const responsePayload = options.responsePayload || {};
  if (!executionId || !stepId) {
    return { resumedWorkflow: false, executionId, stepId };
  }

  const executions = loadExecutions();
  const execution = executions.find((entry) => entry.id === executionId);
  if (!execution) {
    return { resumedWorkflow: false, executionId, stepId };
  }
  const task = execution.tasks.find((entry) => entry.id === stepId);
  if (!task) {
    return { resumedWorkflow: false, executionId, stepId };
  }

  const nowIso = new Date().toISOString();
  const decision = options.decision;
  const decisionStatus = decision === 'completed' ? 'completed' : 'rejected';
  const mode = normalizeInternalProcessingMode(internalTaskRow.mode || task.executionData?.internalTaskMode);
  const actorUserId = asTrimmedString(options.actorUserId);
  const decisionConfigRaw = decision === 'completed' ? task.config?.onComplete : task.config?.onReject;
  const decisionConfig =
    decisionConfigRaw && typeof decisionConfigRaw === 'object' && !Array.isArray(decisionConfigRaw)
      ? (decisionConfigRaw as Record<string, any>)
      : {};

  const variablePrefix = `internal.${task.id}`;
  const setDecisionVariable = (key: string, value: any, note: string) =>
    setProcessVariable(execution, {
      key,
      value,
      sourceStepId: task.id,
      sourceType: task.type,
      note,
    });

  setDecisionVariable(`${variablePrefix}.status`, decisionStatus, 'Interne Bearbeitung: Status');
  setDecisionVariable(`${variablePrefix}.completedBy`, actorUserId || null, 'Interne Bearbeitung: Bearbeiter');
  setDecisionVariable(`${variablePrefix}.completedAt`, nowIso, 'Interne Bearbeitung: Abschlusszeit');

  const normalizedResponseEntries = Object.entries(responsePayload);
  for (const [rawFieldKey, value] of normalizedResponseEntries) {
    const fieldKey = normalizeInternalFormFieldKey(rawFieldKey, '');
    if (!fieldKey) continue;
    setDecisionVariable(
      `${variablePrefix}.responses.${fieldKey}`,
      value,
      'Interne Bearbeitung: Antwortfeld'
    );
  }

  const mappings = normalizeInternalProcessVarMappings(task.config?.processVarMappings);
  for (const [sourceFieldKey, targetVariableKey] of Object.entries(mappings)) {
    if (!Object.prototype.hasOwnProperty.call(responsePayload, sourceFieldKey)) continue;
    setDecisionVariable(
      targetVariableKey,
      (responsePayload as Record<string, any>)[sourceFieldKey],
      'Interne Bearbeitung: Mapping'
    );
  }

  if (decisionConfig.setVariables && typeof decisionConfig.setVariables === 'object') {
    for (const [targetKey, targetValue] of Object.entries(decisionConfig.setVariables as Record<string, any>)) {
      if (!asTrimmedString(targetKey)) continue;
      setDecisionVariable(targetKey, targetValue, 'Interne Bearbeitung: onComplete/onReject setVariables');
    }
  }

  let patchCandidate: Record<string, any> | null = null;
  if (decisionConfig.ticketPatch && typeof decisionConfig.ticketPatch === 'object') {
    patchCandidate = decisionConfig.ticketPatch as Record<string, any>;
  } else if (decisionConfig.patchTicket && typeof decisionConfig.patchTicket === 'object') {
    patchCandidate = decisionConfig.patchTicket as Record<string, any>;
  } else {
    const statusAfter = asTrimmedString(decisionConfig.statusAfter || decisionConfig.status);
    if (statusAfter) {
      patchCandidate = { status: statusAfter };
    }
  }

  let assignmentPatch: Record<string, any> | null = null;
  if (decision === 'completed') {
    const assignmentUpdateMode = normalizeInternalTaskAssignmentUpdateMode(
      internalTaskRow.assignment_update_mode || task.config?.assignmentUpdateMode || task.config?.assignmentMode
    );
    const assignmentSource = normalizeInternalTaskAssignmentSource(
      internalTaskRow.assignment_source || task.config?.assignmentSource
    );
    if (assignmentUpdateMode !== 'none') {
      const asId = (value: unknown): string => asTrimmedString(value);
      const parseIdArray = (value: unknown): string[] => {
        const source = Array.isArray(value)
          ? value
          : typeof value === 'string'
          ? value.split(/[\n,;|]+/g)
          : [];
        const seen = new Set<string>();
        const out: string[] = [];
        for (const entry of source) {
          const id = asId(entry);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
        return out;
      };

      const staticUserId = asId(
        responsePayload.assigneeUserId ||
          responsePayload.assignedUserId ||
          responsePayload.primaryAssigneeUserId ||
          responsePayload.userId
      );
      const staticOrgId = asId(
        responsePayload.assigneeOrgUnitId ||
          responsePayload.assignedOrgUnitId ||
          responsePayload.primaryAssigneeOrgUnitId ||
          responsePayload.orgUnitId
      );

      const staticPatch: Record<string, any> = {};
      if (staticUserId && !staticOrgId) {
        staticPatch.primaryAssigneeUserId = staticUserId;
        staticPatch.primaryAssigneeOrgUnitId = '';
      } else if (!staticUserId && staticOrgId) {
        staticPatch.primaryAssigneeUserId = '';
        staticPatch.primaryAssigneeOrgUnitId = staticOrgId;
      }
      if (assignmentUpdateMode === 'primary_plus_participants') {
        const collaboratorUserIds = parseIdArray(
          responsePayload.collaboratorUserIds || responsePayload.participantUserIds
        );
        const collaboratorOrgUnitIds = parseIdArray(
          responsePayload.collaboratorOrgUnitIds || responsePayload.participantOrgUnitIds
        );
        if (collaboratorUserIds.length > 0) staticPatch.collaboratorUserIds = collaboratorUserIds;
        if (collaboratorOrgUnitIds.length > 0) staticPatch.collaboratorOrgUnitIds = collaboratorOrgUnitIds;
      }

      const useAi = assignmentSource === 'ai_suggested' || assignmentSource === 'mixed';
      if (useAi) {
        try {
          const queryText = [
            asTrimmedString(options.note),
            asTrimmedString(task.title),
            asTrimmedString(task.description),
            Object.entries(responsePayload || {})
              .slice(0, 12)
              .map(([key, value]) => `${key}: ${String(value ?? '')}`)
              .join('\n'),
          ]
            .filter(Boolean)
            .join('\n')
            .slice(0, 4000);
          if (queryText) {
            const aiCandidates = await queryResponsibilityCandidates(getDatabase(), {
              query: queryText,
              tenantId: asTrimmedString(internalTaskRow.tenant_id),
              includeUsers: true,
              limit: assignmentUpdateMode === 'primary_plus_participants' ? 6 : 1,
            });
            const top = aiCandidates[0];
            if (top && Number(top.confidence || 0) >= 0.75) {
              if (top.type === 'user') {
                staticPatch.primaryAssigneeUserId = top.id;
                staticPatch.primaryAssigneeOrgUnitId = '';
              } else {
                staticPatch.primaryAssigneeUserId = '';
                staticPatch.primaryAssigneeOrgUnitId = top.id;
              }
              setDecisionVariable(
                `${variablePrefix}.assignment.aiTopCandidate`,
                {
                  type: top.type,
                  id: top.id,
                  confidence: top.confidence,
                  name: top.name,
                  reasoning: top.reasoning,
                },
                'Interne Bearbeitung: KI-Zuweisungsvorschlag'
              );
              if (assignmentUpdateMode === 'primary_plus_participants' && aiCandidates.length > 1) {
                const collaboratorUserIds = new Set<string>(parseIdArray(staticPatch.collaboratorUserIds));
                const collaboratorOrgIds = new Set<string>(parseIdArray(staticPatch.collaboratorOrgUnitIds));
                for (const candidate of aiCandidates.slice(1)) {
                  if (Number(candidate.confidence || 0) < 0.62) continue;
                  if (candidate.type === 'user') collaboratorUserIds.add(candidate.id);
                  else collaboratorOrgIds.add(candidate.id);
                }
                staticPatch.collaboratorUserIds = Array.from(collaboratorUserIds);
                staticPatch.collaboratorOrgUnitIds = Array.from(collaboratorOrgIds);
              }
            }
          }
        } catch (aiAssignmentError) {
          appendWorkflowHistory(execution, 'INFO', 'Interne Bearbeitung: KI-Zuweisung nicht verfügbar.', {
            taskId: task.id,
            taskTitle: task.title,
            taskType: task.type,
            metadata: {
              error:
                aiAssignmentError instanceof Error
                  ? aiAssignmentError.message
                  : String(aiAssignmentError || 'unknown'),
            },
          });
        }
      }

      if (Object.keys(staticPatch).length > 0) {
        assignmentPatch = staticPatch;
      }
    }
  }

  if (assignmentPatch) {
    patchCandidate = {
      ...assignmentPatch,
      ...(patchCandidate || {}),
    };
  }

  let patchApplied: Record<string, any> | null = null;
  if (patchCandidate) {
    try {
      patchApplied = await applyWorkflowTicketPatch(execution, patchCandidate);
    } catch (error) {
      appendWorkflowHistory(execution, 'INFO', 'Interne Bearbeitung: Ticket-Patch fehlgeschlagen.', {
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.type,
        metadata: {
          error: error instanceof Error ? error.message : String(error || 'unbekannt'),
          decision,
        },
      });
    }
  }

  task.executionData = {
    ...(task.executionData || {}),
    internalTaskId: asTrimmedString(internalTaskRow.id),
    internalTaskMode: mode,
    internalTaskStatus: decisionStatus,
    internalTaskCompletedAt: nowIso,
    internalTaskCompletedBy: actorUserId || undefined,
    internalTaskResponse: responsePayload,
    awaitingConfirmation: false,
    awaitingUntil: undefined,
    internalTaskDecisionNote: asTrimmedString(options.note) || undefined,
    ...(patchApplied ? { ticketPatch: patchApplied } : {}),
  };

  const canResumeBlocking =
    mode === 'blocking' && (task.status === 'RUNNING' || task.status === 'PENDING');
  if (!canResumeBlocking) {
    appendWorkflowHistory(execution, 'TASK_DATA', 'Interne Bearbeitung abgeschlossen (kein blockierender Resume-Pfad).', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: {
        decision,
        internalTaskId: asTrimmedString(internalTaskRow.id),
      },
    });
    saveExecutions(executions);
    return {
      resumedWorkflow: false,
      executionId,
      stepId,
    };
  }

  if (decision === 'rejected') {
    const decisionNextTaskIdsRaw =
      decisionConfig.nextTaskIds || decisionConfig.rejectNextTaskIds || task.config?.rejectNextTaskIds;
    const decisionNextTaskIds = normalizeTaskIdList(execution, decisionNextTaskIdsRaw);
    if (decisionNextTaskIds.length > 0) {
      task.executionData.nextTaskIds = decisionNextTaskIds;
      task.executionData.rejectNextTaskIds = decisionNextTaskIds;
    }
  }

  clearScheduledTask(execution.id, task.id);
  setTaskStatus(
    execution,
    task,
    'COMPLETED',
    decision === 'completed'
      ? 'Interne Bearbeitung abgeschlossen.'
      : 'Interne Bearbeitung abgelehnt.'
  );
  appendWorkflowHistory(execution, 'TASK_DECISION', 'Interne Bearbeitung entschieden.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: {
      decision,
      internalTaskId: asTrimmedString(internalTaskRow.id),
      actorUserId: actorUserId || null,
      note: asTrimmedString(options.note) || null,
      patchApplied,
    },
  });

  activateNextTasks(execution, task, task.executionData || {});
  if (finalizeExecutionIfDone(execution)) {
    saveExecutions(executions);
    return { resumedWorkflow: false, executionId, stepId };
  }

  execution.completedAt = undefined;
  delete execution.error;
  setWorkflowStatus(execution, 'RUNNING', 'Workflow nach interner Bearbeitung fortgesetzt.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
  });
  setBlockedReason(execution, 'none');
  saveExecutions(executions);
  await runAutoTasks(executions, execution);
  return { resumedWorkflow: true, executionId, stepId };
}

function guessImageMimeType(fileName?: string, buffer?: Buffer | null): string {
  const lowered = String(fileName || '').toLowerCase();
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

function summarizeExecutionForPublic(execution: WorkflowExecution | null, taskId?: string) {
  if (!execution) return null;
  const sortedTasks = [...(execution.tasks || [])].sort((a, b) => a.order - b.order);
  const currentTask = taskId ? sortedTasks.find((task) => task.id === taskId) : null;
  const completedCount = sortedTasks.filter((task) => task.status === 'COMPLETED').length;
  const runningCount = sortedTasks.filter((task) => task.status === 'RUNNING').length;
  const pendingCount = sortedTasks.filter((task) => task.status === 'PENDING').length;

  return {
    id: execution.id,
    title: execution.title,
    status: execution.status,
    startedAt: execution.startedAt || null,
    completedAt: execution.completedAt || null,
    currentTaskId: currentTask?.id || null,
    currentTaskTitle: currentTask?.title || null,
    totalSteps: sortedTasks.length,
    completedSteps: completedCount,
    runningSteps: runningCount,
    pendingSteps: pendingCount,
    steps: sortedTasks.map((task) => ({
      id: task.id,
      title: task.title,
      type: task.type,
      status: task.status,
      order: task.order,
    })),
  };
}

async function loadWorkflowConfirmationContext(
  token: string,
  options: { includeImages?: boolean; includeExecution?: boolean } = {}
) {
  const includeImages = options.includeImages === true;
  const includeExecution = options.includeExecution !== false;
  const db = getDatabase();
  const validation = await db.get(
    `SELECT * FROM workflow_validations WHERE validation_token = ?`,
    [token]
  );
  if (!validation) return null;

  const ticket = await db.get(
    `SELECT t.*,
            s.original_description as submission_original_description,
            s.anonymized_text as submission_anonymized_text,
            s.address as submission_address,
            s.postal_code as submission_postal_code,
            s.city as submission_city,
            c.name as citizen_name,
            c.email as citizen_email,
            COALESCE(t.citizen_language, c.preferred_language) as citizen_preferred_language,
            COALESCE(t.citizen_language_name, c.preferred_language_name) as citizen_preferred_language_name
     FROM tickets t
     LEFT JOIN submissions s ON s.id = t.submission_id
     LEFT JOIN citizens c ON c.id = t.citizen_id
     WHERE t.id = ?`,
    [validation.ticket_id]
  );

  if (!ticket) {
    return {
      validation,
      ticket: null,
      execution: null,
      task: null,
      images: [] as Array<Record<string, any>>,
    };
  }

  let images: Array<Record<string, any>> = [];
  if (includeImages) {
    const imageRows = await db.all(
      `SELECT id, file_name, created_at, length(image_data) as byte_size
       FROM submission_images
       WHERE submission_id = ?
       ORDER BY created_at ASC`,
      [ticket.submission_id]
    );
    images = (imageRows || []).map((row: any) => {
      const imageId = String(row?.id || '');
      return {
        id: imageId,
        fileName: row?.file_name || 'bild',
        createdAt: row?.created_at || null,
        byteSize: Number(row?.byte_size || 0),
        url: `/api/workflows/confirm/${encodeURIComponent(token)}/images/${encodeURIComponent(imageId)}`,
      };
    });
  }

  const executions = includeExecution ? loadExecutions() : [];
  const execution = includeExecution
    ? executions.find((entry) => entry.id === validation.execution_id) || null
    : null;
  const task = execution?.tasks.find((entry) => entry.id === validation.task_id) || null;

  return {
    validation,
    ticket,
    execution,
    task,
    images,
    executions,
  };
}

function resolveWorkflowConfirmationLanguageCode(context: { ticket?: any } | null | undefined): string {
  const code = normalizeDataRequestLanguageCode(resolveCitizenTargetLanguage(context?.ticket || {}).code);
  return code || 'de';
}

function resolveWorkflowConfirmationMessage(
  context: { ticket?: any } | null | undefined,
  deMessage: string,
  enMessage: string
): string {
  return isGermanLanguageCode(resolveWorkflowConfirmationLanguageCode(context)) ? deMessage : enMessage;
}

async function applyWorkflowConfirmationDecision(
  token: string,
  decision: 'approve' | 'reject'
): Promise<{ message: string; alreadyProcessed?: boolean; ticketId?: string }> {
  const db = getDatabase();
  const context = await loadWorkflowConfirmationContext(token);
  if (!context?.validation) {
    throw Object.assign(new Error('Bestaetigungs-Link ungueltig oder abgelaufen.'), { status: 404 });
  }
  if (isExpired(context.validation.expires_at)) {
    throw Object.assign(
      new Error(
        resolveWorkflowConfirmationMessage(
          context,
          'Bestaetigungs-Link ist abgelaufen.',
          'The confirmation link has expired.'
        )
      ),
      { status: 410 }
    );
  }
  if (!context.execution || !context.task) {
    throw Object.assign(
      new Error(
        resolveWorkflowConfirmationMessage(
          context,
          'Workflow oder Schritt zu diesem Link wurde nicht gefunden.',
          'Workflow or step for this link could not be found.'
        )
      ),
      { status: 404 }
    );
  }

  if (context.validation.validated_at || context.task.executionData?.callbackDecision) {
    return {
      message: resolveWorkflowConfirmationMessage(
        context,
        'Diese Genehmigungsanfrage wurde bereits verarbeitet.',
        'This approval request has already been processed.'
      ),
      alreadyProcessed: true,
      ticketId: context.ticket?.id ? String(context.ticket.id) : undefined,
    };
  }

  const markResult = await db.run(
    `UPDATE workflow_validations
     SET validated_at = CURRENT_TIMESTAMP
     WHERE validation_token = ? AND validated_at IS NULL`,
    [token]
  );
  if (!markResult?.changes) {
    return {
      message: resolveWorkflowConfirmationMessage(
        context,
        'Diese Genehmigungsanfrage wurde bereits verarbeitet.',
        'This approval request has already been processed.'
      ),
      alreadyProcessed: true,
      ticketId: context.ticket?.id ? String(context.ticket.id) : undefined,
    };
  }

  const executions = context.executions || loadExecutions();
  const execution = executions.find((entry) => entry.id === context.execution!.id) || context.execution;
  const task = execution.tasks.find((entry) => entry.id === context.task!.id) || context.task;
  const nowIso = new Date().toISOString();

  const baseExecutionData: WorkflowExecutionData = {
    ...(task.executionData || {}),
    awaitingConfirmation: false,
    awaitingUntil: undefined,
    callbackDecision: decision,
    callbackAt: nowIso,
  };
  clearScheduledTask(execution.id, task.id);

  if (decision === 'reject') {
    const normalizedRejectNextTaskIds = normalizeTaskIdList(execution, baseExecutionData.rejectNextTaskIds);
    const rejectNextTaskIds =
      normalizedRejectNextTaskIds.length > 0
        ? normalizedRejectNextTaskIds
        : resolveConfirmationRejectTaskIds(execution, task);
    task.executionData = {
      ...baseExecutionData,
      approvalResult: 'denied',
      approvalLabel: 'Genehmigung verweigert',
      rejectNextTaskIds,
      ...(rejectNextTaskIds.length > 0 ? { nextTaskIds: rejectNextTaskIds } : {}),
    };
    setTaskStatus(execution, task, 'COMPLETED', 'Task wurde per E-Mail abgelehnt.');
    appendWorkflowHistory(execution, 'TASK_DECISION', 'Task per E-Mail abgelehnt.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: { decision, source: 'email_callback' },
    });

    if (rejectNextTaskIds.length > 0) {
      activateNextTasks(execution, task, task.executionData);
      if (finalizeExecutionIfDone(execution)) {
        saveExecutions(executions);
      } else {
        setWorkflowStatus(execution, 'RUNNING', 'Workflow nach Ablehnung fortgesetzt.');
        saveExecutions(executions);
        await runAutoTasks(executions, execution);
      }
          return {
        message: resolveWorkflowConfirmationMessage(
          context,
          'Ablehnung erfasst. Der Workflow wurde auf den Ablehnungs-Pfad geleitet.',
          'Rejection recorded. The workflow was routed to the rejection path.'
        ),
        ticketId: context.ticket?.id ? String(context.ticket.id) : undefined,
      };
    }

    setWorkflowStatus(execution, 'COMPLETED', 'Workflow beendet: Genehmigung verweigert.');
    delete execution.error;
    execution.completedAt = nowIso;
    appendWorkflowHistory(execution, 'WORKFLOW_COMPLETED', 'Workflow beendet: Genehmigung verweigert.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: { decision, source: 'email_callback' },
    });
    clearScheduledTask(execution.id, task.id);
    execution.activeTaskIds = [];
    syncCurrentTaskIndex(execution);
    saveExecutions(executions);
    return {
      message: resolveWorkflowConfirmationMessage(
        context,
        'Ablehnung erfasst. Der Workflow wurde beendet.',
        'Rejection recorded. The workflow was completed.'
      ),
      ticketId: context.ticket?.id ? String(context.ticket.id) : undefined,
    };
  }

  task.executionData = {
    ...baseExecutionData,
    approvalResult: 'approved',
    approvalLabel: 'Genehmigung erteilt',
  };
  setTaskStatus(execution, task, 'COMPLETED', 'Task wurde per E-Mail freigegeben.');
  appendWorkflowHistory(execution, 'TASK_DECISION', 'Task per E-Mail freigegeben.', {
    taskId: task.id,
    taskTitle: task.title,
    taskType: task.type,
    metadata: { decision, source: 'email_callback' },
  });
  if (task.type === 'EMAIL_DOUBLE_OPT_IN' && context.ticket) {
    try {
      await applyLegacyDoubleOptInEffects({
        db,
        execution,
        task,
        ticket: context.ticket,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unbekannt');
      await appendTicketComment({
        ticketId: execution.ticketId,
        executionId: execution.id,
        taskId: task.id,
        authorType: 'system',
        visibility: 'internal',
        commentType: 'note',
        content: 'DOI-Legacy-Abgleich konnte nicht vollständig abgeschlossen werden.',
        metadata: {
          source: 'workflow_doi_legacy_parity',
          error: message,
        },
      });
      appendWorkflowHistory(execution, 'INFO', 'DOI-Legacy-Abgleich fehlgeschlagen.', {
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.type,
        metadata: { error: message },
      });
    }
  }
  activateNextTasks(execution, task, task.executionData || {});
  if (finalizeExecutionIfDone(execution)) {
    saveExecutions(executions);
  } else {
    setWorkflowStatus(execution, 'RUNNING', 'Workflow nach E-Mail-Freigabe fortgesetzt.');
    saveExecutions(executions);
    await runAutoTasks(executions, execution);
  }
  return {
    message:
      task.type === 'EMAIL_DOUBLE_OPT_IN'
        ? resolveWorkflowConfirmationMessage(
            context,
            'E-Mail-Adresse erfolgreich bestätigt.',
            'Email address successfully confirmed.'
          )
        : resolveWorkflowConfirmationMessage(
            context,
            'Vielen Dank. Die Zustimmung wurde erfolgreich erfasst.',
            'Thank you. Your confirmation was recorded successfully.'
          ),
    ticketId: context.ticket?.id ? String(context.ticket.id) : undefined,
  };
}

interface WorkflowDataRequestContext {
  request: any;
  ticket: any;
  fields: DataRequestField[];
  images: Array<Record<string, any>>;
  requestMeta?: Record<string, any>;
  execution: WorkflowExecution | null;
  task: WorkflowTask | null;
  executions: WorkflowExecution[];
}

async function loadWorkflowDataRequestContext(
  token: string,
  options: { includeExecution?: boolean; includeImages?: boolean } = {}
): Promise<WorkflowDataRequestContext | null> {
  const includeExecution = options.includeExecution !== false;
  const includeImages = options.includeImages === true;
  const db = getDatabase();
  const request = await db.get(
    `SELECT dr.*,
            t.id as ticket_id_value,
            t.submission_id as ticket_submission_id,
            t.category as ticket_category,
            t.priority as ticket_priority,
            t.status as ticket_status,
            t.description as ticket_description,
            t.address as ticket_address,
            t.postal_code as ticket_postal_code,
            t.city as ticket_city,
            t.latitude as ticket_latitude,
            t.longitude as ticket_longitude,
            t.created_at as ticket_created_at,
            t.updated_at as ticket_updated_at,
            s.original_description as submission_original_description,
            s.anonymized_text as submission_anonymized_text,
            s.address as submission_address,
            s.postal_code as submission_postal_code,
            s.city as submission_city,
            c.name as citizen_name,
            c.email as citizen_email,
            COALESCE(t.citizen_language, c.preferred_language) as citizen_preferred_language,
            COALESCE(t.citizen_language_name, c.preferred_language_name) as citizen_preferred_language_name
     FROM workflow_data_requests dr
     LEFT JOIN tickets t ON t.id = dr.ticket_id
     LEFT JOIN submissions s ON s.id = t.submission_id
     LEFT JOIN citizens c ON c.id = t.citizen_id
     WHERE dr.token = ?
     LIMIT 1`,
    [token]
  );
  if (!request) return null;

  const storedPayload = parseStoredDataRequestPayload(request.requested_questions_json);
  const parsedFields = storedPayload.fields;
  const executions = includeExecution ? loadExecutions() : [];
  const execution = includeExecution
    ? executions.find((entry) => entry.id === request.execution_id) || null
    : null;
  const task = execution
    ? execution.tasks.find((entry) => entry.id === request.task_id) || null
    : null;
  const effectiveFields =
    task && isAiDataRequestTaskType(task.type) ? forceDataRequestFieldsOptional(parsedFields) : parsedFields;
  const submissionId = String(request.ticket_submission_id || '').trim();
  let images: Array<Record<string, any>> = [];
  if (includeImages && submissionId) {
    const imageRows = await db.all(
      `SELECT id, file_name, created_at, length(image_data) as byte_size
       FROM submission_images
       WHERE submission_id = ?
       ORDER BY created_at ASC`,
      [submissionId]
    );
    images = (imageRows || []).map((row: any) => {
      const imageId = String(row?.id || '');
      return {
        id: imageId,
        fileName: row?.file_name || 'bild',
        createdAt: row?.created_at || null,
        byteSize: Number(row?.byte_size || 0),
        url: `/api/workflows/data-request/${encodeURIComponent(token)}/images/${encodeURIComponent(imageId)}`,
      };
    });
  }

  return {
    request,
    ticket: {
      id: request.ticket_id_value || request.ticket_id,
      submissionId: submissionId || null,
      category: request.ticket_category || '',
      priority: request.ticket_priority || '',
      status: request.ticket_status || '',
      description:
        request.submission_original_description ||
        request.ticket_description ||
        request.submission_anonymized_text ||
        '',
      address: request.ticket_address || request.submission_address || '',
      postalCode: request.ticket_postal_code || request.submission_postal_code || '',
      city: request.ticket_city || request.submission_city || '',
      latitude:
        request.ticket_latitude !== null && request.ticket_latitude !== undefined
          ? Number(request.ticket_latitude)
          : null,
      longitude:
        request.ticket_longitude !== null && request.ticket_longitude !== undefined
          ? Number(request.ticket_longitude)
          : null,
      createdAt: request.ticket_created_at || null,
      updatedAt: request.ticket_updated_at || null,
      citizenName: request.citizen_name || '',
      citizenEmail: request.citizen_email || '',
      citizenPreferredLanguage: request.citizen_preferred_language || '',
      citizenPreferredLanguageName: request.citizen_preferred_language_name || '',
    },
    fields: effectiveFields,
    images,
    requestMeta: storedPayload.meta || {},
    execution,
    task,
    executions,
  };
}

function resolveDataRequestLanguageForContext(context: WorkflowDataRequestContext): string {
  const storedLanguageCode = normalizeDataRequestLanguageCode(
    context.requestMeta?.languageCode || context.request?.language_code || ''
  );
  const citizenLanguageCode = normalizeDataRequestLanguageCode(context.ticket?.citizenPreferredLanguage || '');
  if (
    !isCustomDataRequestRecipientContext(context) &&
    citizenLanguageCode &&
    !isGermanLanguageCode(citizenLanguageCode) &&
    (!storedLanguageCode || isGermanLanguageCode(storedLanguageCode))
  ) {
    return citizenLanguageCode;
  }
  return storedLanguageCode || citizenLanguageCode || 'de';
}

function resolveDataRequestLanguageNameForContext(context: WorkflowDataRequestContext, languageCode?: string): string {
  const effectiveCode = normalizeDataRequestLanguageCode(languageCode || resolveDataRequestLanguageForContext(context));
  const storedLanguageCode = normalizeDataRequestLanguageCode(
    context.requestMeta?.languageCode || context.request?.language_code || ''
  );
  const storedLanguageName = normalizeDataRequestLanguageName(context.requestMeta?.languageName);
  const citizenLanguageCode = normalizeDataRequestLanguageCode(context.ticket?.citizenPreferredLanguage || '');
  const citizenLanguageName = normalizeDataRequestLanguageName(context.ticket?.citizenPreferredLanguageName);
  if (storedLanguageName && areLanguageCodesCompatible(storedLanguageCode, effectiveCode)) {
    return storedLanguageName;
  }
  if (citizenLanguageName && areLanguageCodesCompatible(citizenLanguageCode, effectiveCode)) {
    return citizenLanguageName;
  }
  if (isGermanLanguageCode(effectiveCode)) return 'Deutsch';
  if (isEnglishLanguageCode(effectiveCode)) return 'English';
  return storedLanguageName || citizenLanguageName || effectiveCode || 'Deutsch';
}

function resolveDataRequestUiLocaleForContext(context: WorkflowDataRequestContext): DataRequestUiLocale {
  const languageCode = resolveDataRequestLanguageForContext(context);
  const storedLanguageCode = normalizeDataRequestLanguageCode(
    context.requestMeta?.languageCode || context.request?.language_code || ''
  );
  const baseLocale = isGermanLanguageCode(languageCode)
    ? DATA_REQUEST_UI_LOCALE_DE
    : isEnglishLanguageCode(languageCode)
    ? DATA_REQUEST_UI_LOCALE_EN
    : DATA_REQUEST_UI_LOCALE_EN;
  const storedLocale =
    storedLanguageCode && areLanguageCodesCompatible(storedLanguageCode, languageCode)
      ? normalizeDataRequestUiLocale(context.requestMeta?.uiLocale)
      : undefined;
  return {
    ...baseLocale,
    ...(storedLocale || {}),
  };
}

function resolveDataRequestSubmitSuccessMessage(context: WorkflowDataRequestContext): string {
  return resolveDataRequestUiLocaleForContext(context).submitSuccess;
}

function resolveDataRequestAlreadySubmittedMessage(context: WorkflowDataRequestContext): string {
  return resolveDataRequestUiLocaleForContext(context).alreadySubmitted;
}

function resolveDataRequestExpiredMessage(context: WorkflowDataRequestContext): string {
  const languageCode = resolveDataRequestLanguageForContext(context);
  if (isGermanLanguageCode(languageCode)) {
    return 'Datennachforderungs-Link ist abgelaufen.';
  }
  return 'The data request link has expired.';
}

function resolveDataRequestInactiveMessage(context: WorkflowDataRequestContext): string {
  const languageCode = resolveDataRequestLanguageForContext(context);
  if (isGermanLanguageCode(languageCode)) {
    return 'Datennachforderungs-Link ist nicht mehr aktiv (Timeout).';
  }
  return 'The data request link is no longer active.';
}

function resolveDataRequestAliasKey(task: WorkflowTask, fieldKey: string): string | null {
  const createAlias = task.config?.createAlias !== false;
  if (!createAlias) return null;
  const prefixRaw = String(task.config?.aliasPrefix || 'var').trim().replace(/\.+$/g, '');
  if (!prefixRaw) return null;
  return `${prefixRaw}.${fieldKey}`.replace(/\.\.+/g, '.');
}

function resolveDataRequestProcessVariableKey(task: WorkflowTask, fieldKey: string): string {
  const configuredPrefixRaw = String(task.config?.variablePrefix || '').trim();
  const configuredPrefix = configuredPrefixRaw.replace(/\.+$/g, '');
  if (configuredPrefix) {
    return `${configuredPrefix}.${fieldKey}`.replace(/\.\.+/g, '.');
  }
  return `data_request.${task.id}.${fieldKey}`;
}

async function runDataRequestLatePatchAgent(input: {
  context: WorkflowDataRequestContext;
  answers: Record<string, any>;
}) {
  const { context, answers } = input;
  const execution = context.execution;
  const task = context.task;
  if (!execution || !task) return;
  if (task.config?.parallelMode === false) return;
  const recategorizationEnabled =
    task.type === 'ENHANCED_CATEGORIZATION'
      ? task.config?.enableRecategorization !== false
      : task.type === 'FREE_AI_DATA_REQUEST'
      ? false
      : true;

  if (task.type === 'FREE_AI_DATA_REQUEST') {
    const { ticket, description, locationText, imageContext } = await loadTicketContext(execution);
    const objective =
      resolveFreeDataRequestCollectionObjective(task) ||
      'Leite aus den Antworten strukturierte Variablen fuer den Workflow-Fachzweck ab.';
    const fallbackPrompt =
      typeof task.config?.answerEvaluationPrompt === 'string'
        ? task.config.answerEvaluationPrompt.trim()
        : '';
    const promptBase =
      fallbackPrompt || (await getSystemPrompt('workflowFreeDataRequestAnswerEvaluationPrompt'));
    const prompt = `${promptBase}

Auftrag / Zieldefinition:
${objective}

Ticket:
- ID: ${String(ticket?.id || execution.ticketId)}
- Kategorie: ${String(ticket?.category || '')}
- Prioritaet: ${String(ticket?.priority || '')}
- Status: ${String(ticket?.status || '')}
- Ort: ${String(locationText || '')}
- Beschreibung: ${String(description || '').slice(0, 1600)}
- KI-Bildbeschreibungen:
${String(imageContext || 'Keine KI-Bildbeschreibungen vorhanden.')}

Neue Antworten:
${JSON.stringify(answers, null, 2)}

Prozessvariablen (JSON):
${buildExecutionProcessVariablePromptBlock(execution)}

Prozessvariablen (Summary):
${buildExecutionProcessVariableSummary(execution)}

Hinweis:
- Antworte ausschliesslich als JSON.
- Rueckgabe-Schema:
  {
    "derivedVariables": { "key":"value" },
    "comment":"kurze Begruendung",
    "confidence":0.0
  }`.trim();

    try {
      const raw = await testAIProviderForTicketPrompt({
        prompt,
        purpose: 'workflow_free_data_request_apply',
        meta: {
          source: 'routes.workflows.free_data_request_late_patch',
          ticketId: execution.ticketId,
          taskId: task.id,
        },
        ticket,
      });
      const parsed = extractJsonPayload(raw);
      const derivedVariablesRaw =
        parsed?.derivedVariables &&
        typeof parsed.derivedVariables === 'object' &&
        !Array.isArray(parsed.derivedVariables)
          ? (parsed.derivedVariables as Record<string, any>)
          : {};
      const derivedAssignments: Array<{
        inputKey: string;
        assignedKey: string;
        alias?: string | null;
      }> = [];

      for (const [rawKey, value] of Object.entries(derivedVariablesRaw)) {
        const key = String(rawKey || '').trim();
        if (!key) continue;
        const processKey = key.includes('.') ? key : resolveDataRequestProcessVariableKey(task, key);
        const aliasKey = key.includes('.') ? null : resolveDataRequestAliasKey(task, key);
        const result = setProcessVariable(execution, {
          key: processKey,
          value,
          sourceStepId: task.id,
          sourceType: task.type,
          note: `KI-Auswertung nach Datennachforderung (${context.request.id})`,
          setAlias: aliasKey || undefined,
        });
        if (!result.key) continue;
        derivedAssignments.push({
          inputKey: key,
          assignedKey: result.key,
          alias: result.alias || null,
        });
      }

      const aiComment = String(parsed?.comment || '').trim();
      const confidence = Number(parsed?.confidence);
      const commentContent =
        aiComment ||
        (derivedAssignments.length > 0
          ? 'KI-Nachbearbeitung hat zusätzliche strukturierte Variablen erzeugt.'
          : 'KI-Nachbearbeitung hat keine zusätzlichen Variablen abgeleitet.');

      await appendTicketComment({
        ticketId: execution.ticketId,
        executionId: execution.id,
        taskId: task.id,
        authorType: 'ai',
        visibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
        commentType: 'classification',
        content: commentContent,
        metadata: {
          derivedAssignments,
          confidence: Number.isFinite(confidence) ? confidence : null,
          answers,
          source: 'late_data_request_agent_free',
        },
      });

      appendWorkflowHistory(execution, 'TASK_DATA', 'KI-Nachbearbeitung (freie Datennachforderung) ausgeführt.', {
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.type,
        metadata: {
          derivedAssignments,
          confidence: Number.isFinite(confidence) ? confidence : null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unbekannt');
      await appendTicketComment({
        ticketId: execution.ticketId,
        executionId: execution.id,
        taskId: task.id,
        authorType: 'system',
        visibility: 'internal',
        commentType: 'note',
        content: 'KI-Nachbearbeitung (freie Datennachforderung) ist fehlgeschlagen.',
        metadata: { error: message },
      });
      appendWorkflowHistory(execution, 'INFO', 'KI-Nachbearbeitung (freie Datennachforderung) fehlgeschlagen.', {
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.type,
        metadata: { error: message },
      });
    }
    return;
  }

  const knowledge = await loadKnowledge();
  const categoriesForPrompt = buildKnownCategoryPromptList(knowledge);
  const { ticket, description, locationText, imageContext } = await loadTicketContext(execution);
  const fallbackPrompt =
    typeof task.config?.answerEvaluationPrompt === 'string'
      ? task.config.answerEvaluationPrompt.trim()
      : '';
  const promptBase = fallbackPrompt || (await getSystemPrompt('workflowDataRequestAnswerEvaluationPrompt'));
  const prompt = `${promptBase}

Ticket:
- ID: ${String(ticket?.id || execution.ticketId)}
- Kategorie: ${String(ticket?.category || '')}
- Prioritaet: ${String(ticket?.priority || '')}
- Status: ${String(ticket?.status || '')}
- Ort: ${String(locationText || '')}
- Beschreibung: ${String(description || '').slice(0, 1600)}
- KI-Bildbeschreibungen:
${String(imageContext || 'Keine KI-Bildbeschreibungen vorhanden.')}

Verfuegbare Kategorien (verbindlich):
${categoriesForPrompt}

Neue Antworten:
${JSON.stringify(answers, null, 2)}

Prozessvariablen (JSON):
${buildExecutionProcessVariablePromptBlock(execution)}

Prozessvariablen (Summary):
${buildExecutionProcessVariableSummary(execution)}

Hinweis:
- Rekategorisierung / Ticket-Patch erlaubt: ${recategorizationEnabled ? 'ja' : 'nein'}
- Antworte ausschliesslich als JSON.
- Verwende fuer patchTicket.category nur Kategorien aus "Verfuegbare Kategorien".
- Verwende fuer patchTicket.priority nur: low, medium, high, critical.
- Wenn keine Anpassung noetig ist: patchTicket als leeres Objekt zurueckgeben.
- JSON-Schema:
  {
    "patchTicket": { "category": "...", "priority": "...", "description": "..." },
    "comment": "kurze Begruendung fuer Timeline",
    "confidence": 0.0
  }
`.trim();

  try {
    const raw = await testAIProviderForTicketPrompt({
      prompt,
      purpose: task.type === 'ENHANCED_CATEGORIZATION' ? 'workflow_enhanced_categorization_apply' : 'workflow_data_request_apply',
      meta: {
        source: 'routes.workflows.data_request_late_patch',
        ticketId: execution.ticketId,
        taskId: task.id,
      },
      ticket,
    });
    const parsed = extractJsonPayload(raw);
    const patch =
      parsed?.patchTicket && typeof parsed.patchTicket === 'object' && !Array.isArray(parsed.patchTicket)
        ? { ...parsed.patchTicket }
        : null;
    let categoryAdjusted = false;
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'category')) {
      const requestedCategory = String(patch.category || '').trim();
      if (!requestedCategory) {
        delete patch.category;
      } else {
        const resolvedCategory = resolveKnownCategoryName(knowledge, requestedCategory, ticket?.category || '');
        categoryAdjusted = resolvedCategory.toLowerCase() !== requestedCategory.toLowerCase();
        if (!resolvedCategory || resolvedCategory === String(ticket?.category || '').trim()) {
          delete patch.category;
        } else {
          patch.category = resolvedCategory;
        }
      }
    }
    const aiComment = String(parsed?.comment || '').trim();
    const confidence = Number(parsed?.confidence);
    const appliedPatch = recategorizationEnabled
      ? await applyWorkflowTicketPatch(execution, patch)
      : null;
    const patchIgnored = !recategorizationEnabled && !!patch;

    const commentContent =
      aiComment ||
      (appliedPatch
        ? 'KI-Nachbearbeitung hat Ticketdetails nach eingetroffenen Antworten aktualisiert.'
        : recategorizationEnabled
        ? 'KI-Nachbearbeitung hat keine Ticketaenderung vorgenommen.'
        : 'KI-Nachbearbeitung dokumentiert Antworten, Ticket-Rekategorisierung ist deaktiviert.');

    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'ai',
      visibility: task.config?.aiCommentVisibility === 'public' ? 'public' : 'internal',
      commentType: 'classification',
      content: commentContent,
      metadata: {
        appliedPatch,
        patchIgnored,
        recategorizationEnabled,
        confidence: Number.isFinite(confidence) ? confidence : null,
        categoryAdjusted,
        answers,
        source: 'late_data_request_agent',
      },
    });

    appendWorkflowHistory(execution, 'TASK_DATA', 'KI-Nachbearbeitung nach Datennachforderung ausgeführt.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: {
        appliedPatch,
        patchIgnored,
        recategorizationEnabled,
        confidence: Number.isFinite(confidence) ? confidence : null,
        categoryAdjusted,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unbekannt');
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'system',
      visibility: 'internal',
      commentType: 'note',
      content: 'KI-Nachbearbeitung nach Datennachforderung ist fehlgeschlagen.',
      metadata: { error: message },
    });
    appendWorkflowHistory(execution, 'INFO', 'KI-Nachbearbeitung nach Datennachforderung fehlgeschlagen.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: { error: message },
    });
  }
}

async function applyWorkflowDataRequestAnswers(
  token: string,
  answersRaw: unknown,
  options: { deferPostProcessing?: boolean } = {}
): Promise<{
  message: string;
  requestStatus: string;
  normalizedAnswers: Record<string, any>;
  resumedWorkflow: boolean;
}> {
  const context = await loadWorkflowDataRequestContext(token);
  if (!context) {
    throw Object.assign(new Error('Datennachforderungs-Link ungueltig oder abgelaufen.'), { status: 404 });
  }
  if (context.request.status === 'answered') {
    const db = getDatabase();
    const latestAnswer = await db.get(
      `SELECT answers_json
       FROM workflow_data_request_answers
       WHERE data_request_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [context.request.id]
    );
    return {
      message: resolveDataRequestAlreadySubmittedMessage(context),
      requestStatus: 'answered',
      normalizedAnswers: parseJsonValue(latestAnswer?.answers_json, {}),
      resumedWorkflow: false,
    };
  }
  if (context.request.status === 'timeout') {
    throw Object.assign(new Error(resolveDataRequestInactiveMessage(context)), { status: 410 });
  }
  if (isExpired(context.request.expires_at)) {
    throw Object.assign(new Error(resolveDataRequestExpiredMessage(context)), { status: 410 });
  }

  const validation = validateAndNormalizeDataRequestAnswers(context.fields, answersRaw);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.errors.join(' ')), {
      status: 400,
      code: 'INVALID_ANSWERS',
      details: validation.errors,
    });
  }

  const ticketLanguage = resolveCitizenTargetLanguage({
    citizen_preferred_language: context.ticket?.citizenPreferredLanguage,
    citizen_preferred_language_name: context.ticket?.citizenPreferredLanguageName,
  });
  const answerStoragePayload = {
    rawAnswers: answersRaw ?? null,
    normalizedAnswers: validation.normalized,
    translatedAnswersDe: validation.normalized,
    sourceLanguage: ticketLanguage.code,
    translatedAt: null,
    translationPending: !isGermanLanguageCode(ticketLanguage.code),
  };

  const db = getDatabase();
  const answerId = `wdra_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await db.run(
    `INSERT INTO workflow_data_request_answers (id, data_request_id, answers_json, raw_payload_json)
     VALUES (?, ?, ?, ?)`,
    [answerId, context.request.id, JSON.stringify(validation.normalized), JSON.stringify(answerStoragePayload)]
  );
  await db.run(
    `UPDATE workflow_data_requests
     SET status = 'answered',
         answered_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [context.request.id]
  );

  const processSubmissionInBackground = async (): Promise<{
    message: string;
    requestStatus: string;
    normalizedAnswers: Record<string, any>;
    resumedWorkflow: boolean;
  }> => {
    const translatedAnswersDe = await translateDataRequestAnswersToGerman({
      fields: context.fields,
      answers: validation.normalized,
      sourceLanguage: ticketLanguage,
    });
    const finalizedStoragePayload = {
      rawAnswers: answersRaw ?? null,
      normalizedAnswers: validation.normalized,
      translatedAnswersDe,
      sourceLanguage: ticketLanguage.code,
      translatedAt: new Date().toISOString(),
      translationPending: false,
    };
    await db.run(
      `UPDATE workflow_data_request_answers
       SET raw_payload_json = ?
       WHERE id = ?`,
      [JSON.stringify(finalizedStoragePayload), answerId]
    );

  let resumedWorkflow = false;
  const execution = context.execution;
  const task = context.task;
  if (execution && task) {
    const aliasConflicts: string[] = [];
    const assignedKeys: string[] = [];
    const assignedAliases: string[] = [];
    for (const [fieldKey, value] of Object.entries(validation.normalized)) {
      const processKey = resolveDataRequestProcessVariableKey(task, fieldKey);
      const aliasKey = resolveDataRequestAliasKey(task, fieldKey);
      const result = setProcessVariable(execution, {
        key: processKey,
        value,
        sourceStepId: task.id,
        sourceType: task.type,
        note: `Antwort aus Datennachforderung (${context.request.id})`,
        setAlias: aliasKey,
      });
      if (result.key) assignedKeys.push(result.key);
      if (result.alias) {
        if (result.aliasConflict) {
          aliasConflicts.push(result.alias);
        } else {
          assignedAliases.push(result.alias);
        }
      }
    }

    appendWorkflowHistory(execution, 'TASK_DATA', 'Antworten zur Datennachforderung wurden verarbeitet.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: {
        requestId: context.request.id,
        assignedKeys,
        assignedAliases,
        aliasConflicts,
      },
    });
    const existingAggregatedAnswers =
      task.executionData?.dataRequestAnswersAll &&
      typeof task.executionData.dataRequestAnswersAll === 'object' &&
      !Array.isArray(task.executionData.dataRequestAnswersAll)
        ? (task.executionData.dataRequestAnswersAll as Record<string, any>)
        : {};
    const aggregatedAnswers = {
      ...existingAggregatedAnswers,
      ...validation.normalized,
    };
    task.executionData = {
      ...(task.executionData || {}),
      dataRequestAnsweredAt: new Date().toISOString(),
      dataRequestAnswers: validation.normalized,
      dataRequestAnswersAll: aggregatedAnswers,
    };

    const commentParts: string[] = [];
    commentParts.push('Antworten zur Datennachforderung eingegangen und als Prozessvariablen gespeichert.');
    if (assignedAliases.length > 0) {
      commentParts.push(`Alias-Keys gesetzt: ${assignedAliases.join(', ')}.`);
    }
    if (aliasConflicts.length > 0) {
      commentParts.push(`Alias-Konflikte (nicht ueberschrieben): ${aliasConflicts.join(', ')}.`);
    }
    await appendTicketComment({
      ticketId: execution.ticketId,
      executionId: execution.id,
      taskId: task.id,
      authorType: 'system',
      visibility: task.config?.responseCommentVisibility === 'public' ? 'public' : 'internal',
      commentType: 'data_response',
      content: commentParts.join(' '),
      metadata: {
        requestId: context.request.id,
        answers: validation.normalized,
        assignedKeys,
        assignedAliases,
        aliasConflicts,
      },
    });

    const aiKind = resolveDataRequestAiKind(task);
    const canRunFollowUpCycle = aiKind !== null && task.config?.allowFollowUpCycles === true;
    const currentCycleFromRequest = Number(context.requestMeta?.cycle);
    const currentCycleFromTask = Number(task.executionData?.dataRequestCycle);
    const currentCycle = Number.isFinite(currentCycleFromRequest)
      ? Math.max(1, Math.floor(currentCycleFromRequest))
      : Number.isFinite(currentCycleFromTask)
      ? Math.max(1, Math.floor(currentCycleFromTask))
      : 1;
    const maxCycles = aiKind ? resolveAiDataRequestMaxCycles(task) : 1;
    const nextCycle = currentCycle + 1;
    let followUpCreated = false;
    let followUpMessage = '';

    if (canRunFollowUpCycle && nextCycle <= maxCycles) {
      const { ticket, description, address, locationText, imageContext } = await loadTicketContext(execution);
      const targetLanguage = resolveCitizenTargetLanguage(ticket);
      let needCheckResult: DataRequestNeedCheckResult = {
        requiresAdditionalData: true,
        reasoning: '',
        confidence: null,
        categoryConfidence: null,
        priorityConfidence: null,
        missingSignals: [],
      };
      if (task.config?.enableNeedCheck === true) {
        needCheckResult =
          aiKind === 'enhanced'
            ? await evaluateEnhancedCategorizationNeed({
                execution,
                task,
                ticket,
                description,
                locationText,
                imageContext,
              })
            : await evaluateFreeDataRequestNeed({
                execution,
                task,
                ticket,
                description,
                locationText,
                imageContext,
              });
      }

      if (needCheckResult.requiresAdditionalData) {
        const maxQuestionsPerCycle = resolveAiDataRequestMaxQuestions(task);
        const generated =
          aiKind === 'enhanced'
            ? await generateEnhancedCategorizationFields({
                execution,
                task,
                ticket,
                description,
                locationText,
                imageContext,
                targetLanguage,
                maxQuestionsPerCycle,
                cycleIndex: nextCycle,
                maxCycles,
                previousAnswers: aggregatedAnswers,
                needCheck: {
                  confidence: needCheckResult.confidence,
                  categoryConfidence: needCheckResult.categoryConfidence,
                  priorityConfidence: needCheckResult.priorityConfidence,
                  missingSignals: needCheckResult.missingSignals,
                },
              })
            : await generateFreeAiDataRequestFields({
                execution,
                task,
                ticket,
                description,
                locationText,
                imageContext,
                targetLanguage,
                maxQuestionsPerCycle,
                cycleIndex: nextCycle,
                maxCycles,
                previousAnswers: aggregatedAnswers,
                needCheck: {
                  confidence: needCheckResult.confidence,
                  categoryConfidence: needCheckResult.categoryConfidence,
                  priorityConfidence: needCheckResult.priorityConfidence,
                  missingSignals: needCheckResult.missingSignals,
                },
              });
        const followUpFields = forceDataRequestFieldsOptional(
          limitDataRequestFields(generated.fields || [], maxQuestionsPerCycle)
        );
        if (followUpFields.length > 0) {
          const recipientType = task.config?.recipientType === 'custom' ? 'custom' : 'citizen';
          const configuredRecipient =
            recipientType === 'custom'
              ? await resolveConfiguredOrgUnitRecipient(task.config || {}, {
                  tenantId: ticket?.tenant_id || null,
                  ticketId: ticket?.id || execution.ticketId,
                })
              : null;
          const recipientEmails =
            recipientType === 'custom'
              ? Array.isArray(configuredRecipient?.recipientEmails)
                ? configuredRecipient.recipientEmails.filter(Boolean)
                : []
              : String(ticket.citizen_email || '').trim()
              ? [String(ticket.citizen_email || '').trim()]
              : [];
          const recipientEmail =
            recipientEmails.length > 0
              ? recipientEmails.join(', ')
              : recipientType === 'custom'
              ? String(configuredRecipient?.recipientEmail || '').trim()
              : String(ticket.citizen_email || '').trim();
          const recipientName =
            recipientType === 'custom'
              ? String(configuredRecipient?.recipientName || '').trim()
              : String(ticket.citizen_name || '').trim();
          if (
            recipientType === 'custom' &&
            configuredRecipient?.recipientSource === 'org_unit' &&
            !recipientEmail
          ) {
            throw new Error('Die gewählte Organisationseinheit hat keine Kontakt-E-Mail.');
          }
          if (
            recipientType === 'custom' &&
            configuredRecipient?.recipientSource === 'ticket_primary_assignee' &&
            !recipientEmail
          ) {
            throw new Error('Für die Primär-Zuweisung ist keine Empfänger-E-Mail vorhanden.');
          }
          if (
            recipientType === 'custom' &&
            configuredRecipient?.recipientSource === 'ticket_collaborators' &&
            !recipientEmail
          ) {
            throw new Error('Für die Beteiligten sind keine Empfänger-E-Mails vorhanden.');
          }
          if (!recipientEmail) {
            throw new Error('Kein Empfänger für Datennachforderung konfiguriert.');
          }

          const { values: generalSettings } = await loadGeneralSettings();
          const defaultTimeoutHours = Number(
            generalSettings.citizenFrontend?.enhancedCategorizationTimeoutHours || DEFAULT_DATA_REQUEST_TIMEOUT_HOURS
          );
          const timeoutMs = resolveStepTimeoutMs(task.config || {}, defaultTimeoutHours || DEFAULT_DATA_REQUEST_TIMEOUT_HOURS);
          const expiresAtDate = new Date(Date.now() + timeoutMs);
          const expiresAt = expiresAtDate.toISOString();
          const expiresAtSql = toSqlDateTime(expiresAtDate);
          const requestToken = crypto.randomBytes(32).toString('hex');
          const requestId = `wdr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const parallelMode = task.config?.parallelMode !== false;
          const baseSubjectForForm = String(
            generated.subject || task.config?.subject || 'Rueckfragen zu Ihrer Meldung'
          ).trim();
          const baseIntro = String(
            generated.introText ||
              task.config?.introText ||
              'Für die weitere Bearbeitung benötigen wir zusätzliche Angaben zu Ihrer Meldung.'
          ).trim();
          const citizenContent =
            recipientType === 'custom'
              ? {
                  fields: followUpFields,
                  subject: baseSubjectForForm,
                  introText: baseIntro,
                }
              : await buildCitizenTargetDataRequestContent({
                  fields: followUpFields,
                  subject: baseSubjectForForm,
                  introText: baseIntro,
                  targetLanguage,
                });
          const localizedFollowUpFields = normalizeDataRequestFields(citizenContent.fields);
          const effectiveFollowUpFields =
            localizedFollowUpFields.length > 0 ? localizedFollowUpFields : followUpFields;
          const subjectForForm = String(citizenContent.subject || baseSubjectForForm).trim() || baseSubjectForForm;
          const intro = String(citizenContent.introText || baseIntro).trim() || baseIntro;
          const uiLocale =
            recipientType === 'custom'
              ? { ...DATA_REQUEST_UI_LOCALE_DE }
              : await buildCitizenDataRequestUiLocale(targetLanguage);
          const adminGermanContent = await buildAdminGermanDataRequestContent({
            fields: followUpFields,
            subject: baseSubjectForForm,
            introText: baseIntro,
            sourceLanguage: targetLanguage,
          });
          const configuredTemplateId =
            typeof task.config?.templateId === 'string' && task.config.templateId.trim()
              ? task.config.templateId.trim()
              : 'workflow-data-request';

          await db.run(
            `INSERT INTO workflow_data_requests (
              id, execution_id, task_id, ticket_id, token, status, parallel_mode, requested_questions_json, expires_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
            [
              requestId,
              execution.id,
              task.id,
              execution.ticketId,
              requestToken,
              parallelMode ? 1 : 0,
              serializeStoredDataRequestPayload({
                fields: effectiveFollowUpFields,
                subject: subjectForForm,
                introText: intro,
                languageCode: targetLanguage.code,
                languageName: targetLanguage.name,
                cycle: nextCycle,
                maxCycles,
                adminFieldsDe: adminGermanContent.fields,
                adminSubjectDe: adminGermanContent.subject,
                adminIntroTextDe: adminGermanContent.introText,
                uiLocale,
              }),
              expiresAtSql,
            ]
          );

          const formLink = buildDataRequestLink(generalSettings.callbackUrl, requestToken);
          const statusToken = await ensureTicketStatusToken(db, ticket);
          const statusLink = buildTicketStatusCallbackLink(generalSettings.callbackUrl, {
            token: statusToken,
          });
          const requestFieldsSummary = effectiveFollowUpFields
            .map((field, index) => `${index + 1}. ${field.label}${field.required ? ' (Pflicht)' : ''}`)
            .join('\n');
          const expiresAtLabel = expiresAtDate.toLocaleString('de-DE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
          const templateData = buildWorkflowEmailTemplateData({
            ticket,
            description,
            address,
            locationText,
            coordinates: '',
            recipientName,
            recipientEmail,
            statusLink,
            formLink,
            requestFieldsSummary,
            expiresAt: expiresAtLabel,
            introText: intro,
            customMessage: intro,
          });
          const template = await loadTemplateFile(configuredTemplateId, asTrimmedString(ticket?.tenant_id));
          const fallback = buildDefaultDataRequestHtml(templateData);
          const subject = template ? renderTemplate(template.subject, templateData) : fallback.subject;
          const html = template ? renderTemplate(template.htmlContent, templateData) : fallback.html;
          const text = template
            ? renderTemplate(template.textContent || htmlToPlainText(html), templateData)
            : fallback.text;
          const htmlWithReporter = appendReporterContextToEmailHtml(html, {
            citizenName: ticket.citizen_name || '',
            citizenEmail: ticket.citizen_email || '',
          });
          const textWithReporter = appendReporterContextToPlainText(text, {
            citizenName: ticket.citizen_name || '',
            citizenEmail: ticket.citizen_email || '',
          });
          const sent = await sendEmail({
            to: recipientEmail,
            subject,
            html: htmlWithReporter,
            text: textWithReporter,
            translateForCitizen: recipientType !== 'custom',
            translationTemplateId: configuredTemplateId,
            translationTemplateData: templateData,
          });
          if (!sent) {
            throw new Error('Folge-Datennachforderungs-E-Mail konnte nicht versendet werden.');
          }

          task.executionData = {
            ...(task.executionData || {}),
            dataRequestId: requestId,
            dataRequestToken: requestToken,
            dataRequestMode: 'ai',
            dataRequestParallel: parallelMode,
            dataRequestFields: effectiveFollowUpFields,
            dataRequestLink: formLink,
            dataRequestCycle: nextCycle,
            dataRequestMaxCycles: maxCycles,
            dataRequestMaxQuestionsPerCycle: maxQuestionsPerCycle,
            dataRequestSubject: subjectForForm,
            dataRequestIntroText: intro,
            dataRequestTargetLanguage: targetLanguage.code,
            dataRequestTargetLanguageName: targetLanguage.name,
            dataRequestNeedCheck: {
              requiresAdditionalData: true,
              confidence: needCheckResult.confidence,
              categoryConfidence: needCheckResult.categoryConfidence,
              priorityConfidence: needCheckResult.priorityConfidence,
            },
            awaitingUntil: parallelMode ? undefined : expiresAt,
            awaitingConfirmation: parallelMode ? false : true,
            dataRequestAnsweredAt: new Date().toISOString(),
            dataRequestAnswers: validation.normalized,
            dataRequestAnswersAll: aggregatedAnswers,
          };
          if (!parallelMode && task.status === 'RUNNING') {
            clearScheduledTask(execution.id, task.id);
            scheduleTimerTask(execution.id, task.id, expiresAt);
          }

          await appendTicketComment({
            ticketId: execution.ticketId,
            executionId: execution.id,
            taskId: task.id,
            authorType: 'system',
            visibility: 'internal',
            commentType: 'data_request',
            content: `Weitere KI-Datennachforderung (Zyklus ${nextCycle}/${maxCycles}) wurde versendet.`,
            metadata: {
              requestId,
              cycle: nextCycle,
              maxCycles,
              recipientEmail,
              targetLanguage,
              fields: effectiveFollowUpFields.map((entry) => ({
                key: entry.key,
                type: entry.type,
                required: entry.required,
              })),
              confidence: needCheckResult.confidence,
              categoryConfidence: needCheckResult.categoryConfidence,
              priorityConfidence: needCheckResult.priorityConfidence,
              missingSignals: needCheckResult.missingSignals,
              recipientEmails,
            },
          });

          appendWorkflowHistory(
            execution,
            'TASK_DATA',
            'Folgezyklus der KI-Datennachforderung gestartet.',
            {
              taskId: task.id,
              taskTitle: task.title,
              taskType: task.type,
              metadata: {
                cycle: nextCycle,
                maxCycles,
                requestId,
                maxQuestionsPerCycle,
                targetLanguage,
              },
            }
          );

          followUpCreated = true;
          followUpMessage = resolveDataRequestSubmitSuccessMessage(context);
        }
      }
    }

    if (followUpCreated) {
      if (
        !(task.status === 'RUNNING' && (task.executionData?.awaitingConfirmation === true || !!task.executionData?.awaitingUntil))
      ) {
        await runDataRequestLatePatchAgent({
          context,
          answers: validation.normalized,
        });
      }
    } else if (
      task.status === 'RUNNING' &&
      (task.executionData?.awaitingConfirmation === true || !!task.executionData?.awaitingUntil)
    ) {
      task.executionData = {
        ...(task.executionData || {}),
        awaitingConfirmation: false,
        awaitingUntil: undefined,
        dataRequestAnsweredAt: new Date().toISOString(),
      };
      clearScheduledTask(execution.id, task.id);
      setTaskStatus(execution, task, 'COMPLETED', 'Datennachforderung beantwortet.');
      activateNextTasks(execution, task, task.executionData || {});
      resumedWorkflow = true;
    } else {
      await runDataRequestLatePatchAgent({
        context,
        answers: validation.normalized,
      });
    }

    saveExecutions(context.executions);
    if (resumedWorkflow) {
      await runAutoTasks(context.executions, execution);
    }
    if (followUpCreated) {
      return {
        message: followUpMessage,
        requestStatus: 'answered',
        normalizedAnswers: validation.normalized,
        resumedWorkflow: false,
      };
    }
  }

  return {
    message: resolveDataRequestSubmitSuccessMessage(context),
    requestStatus: 'answered',
    normalizedAnswers: validation.normalized,
    resumedWorkflow,
  };
  };

  if (options.deferPostProcessing === true) {
    void processSubmissionInBackground().catch((error) => {
      console.error('Asynchronous workflow data-request post-processing failed:', error);
    });
    return {
      message: resolveDataRequestSubmitSuccessMessage(context),
      requestStatus: 'answered',
      normalizedAnswers: validation.normalized,
      resumedWorkflow: false,
    };
  }

  return processSubmissionInBackground();
}

// GET /api/workflows/confirm/:token/images/:imageId - Public image endpoint for workflow confirmation
router.get(
  '/api/workflows/confirm/:token/images/:imageId',
  async (req: Request, res: Response): Promise<any> => {
    try {
      const token = String(req.params.token || '');
      const imageId = String(req.params.imageId || '');
      if (!token || !imageId) {
        return res.status(400).json({ message: 'Token oder Bild-ID fehlt.' });
      }

      const context = await loadWorkflowConfirmationContext(token, { includeExecution: false });
      if (!context?.validation) {
        return res.status(404).json({ message: 'Bestaetigungs-Link ungueltig oder abgelaufen.' });
      }
      if (isExpired(context.validation.expires_at)) {
        return res.status(410).json({ message: 'Bestaetigungs-Link ist abgelaufen.' });
      }
      if (!context.ticket?.submission_id) {
        return res.status(404).json({ message: 'Ticket nicht gefunden.' });
      }

      const db = getDatabase();
      const row = await db.get(
        `SELECT file_name, image_data
         FROM submission_images
         WHERE id = ? AND submission_id = ?
         LIMIT 1`,
        [imageId, context.ticket.submission_id]
      );
      if (!row) {
        return res.status(404).json({ message: 'Bild nicht gefunden.' });
      }

      const buffer = normalizeImageBuffer((row as any)?.image_data);
      if (!buffer) {
        return res.status(404).json({ message: 'Bilddaten nicht verfuegbar.' });
      }

      const mimeType = guessImageMimeType((row as any)?.file_name, buffer);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(buffer);
    } catch (error) {
      console.error('Workflow confirmation image error:', error);
      return res.status(500).json({ message: 'Fehler beim Laden des Bildes.' });
    }
  }
);

// GET /api/workflows/confirm/:token - Public details page for workflow confirmation
router.get('/api/workflows/confirm/:token', async (req: Request, res: Response): Promise<any> => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ message: 'Token fehlt' });
    }

    const context = await loadWorkflowConfirmationContext(token, { includeImages: true });
    if (!context?.validation) {
      return res.status(404).json({ message: 'Bestaetigungs-Link ungueltig oder abgelaufen.' });
    }

    const expired = isExpired(context.validation.expires_at);
    const decision = context.task?.executionData?.callbackDecision || null;
    const alreadyProcessed = !!context.validation.validated_at || !!decision;
    const ticket = context.ticket;

    const { values: generalSettings } = await loadGeneralSettings();
    const decisionPageLink = buildWorkflowConfirmationCallbackLink(generalSettings.callbackUrl, {
      token,
    });
    const approveLink = buildWorkflowConfirmationCallbackLink(generalSettings.callbackUrl, {
      token,
      decision: 'approve',
    });
    const rejectLink = buildWorkflowConfirmationCallbackLink(generalSettings.callbackUrl, {
      token,
      decision: 'reject',
    });
    const statusToken = ticket ? await ensureTicketStatusToken(getDatabase(), ticket) : '';
    const statusLink = statusToken
      ? buildTicketStatusCallbackLink(generalSettings.callbackUrl, {
          token: statusToken,
        })
      : '';

    const summary = summarizeExecutionForPublic(context.execution || null, context.validation.task_id);
    const description =
      ticket?.submission_original_description ||
      ticket?.description ||
      ticket?.submission_anonymized_text ||
      '';
    const location = [
      ticket?.address || ticket?.submission_address || '',
      ticket?.postal_code || ticket?.submission_postal_code || '',
      ticket?.city || ticket?.submission_city || '',
    ]
      .filter(Boolean)
      .join(', ');

    const payload = {
      token,
      expired,
      alreadyProcessed,
      decision,
      validation: {
        expiresAt: context.validation.expires_at || null,
        validatedAt: context.validation.validated_at || null,
      },
      quickLinks: {
        decisionPageLink,
        approveLink,
        rejectLink,
        statusLink,
      },
      ticket: ticket
        ? {
            id: ticket.id,
            status: ticket.status,
            category: ticket.category,
            priority: ticket.priority,
            description,
            location,
            address: ticket.address || ticket.submission_address || '',
            postalCode: ticket.postal_code || ticket.submission_postal_code || '',
            city: ticket.city || ticket.submission_city || '',
            latitude:
              ticket.latitude !== null && ticket.latitude !== undefined ? Number(ticket.latitude) : null,
            longitude:
              ticket.longitude !== null && ticket.longitude !== undefined ? Number(ticket.longitude) : null,
            createdAt: ticket.created_at || null,
            updatedAt: ticket.updated_at || null,
            citizenName: ticket.citizen_name || '',
            citizenEmail: ticket.citizen_email || '',
            statusToken,
          }
        : null,
      images: context.images || [],
      workflow: summary,
      confirmationTask: context.task
        ? {
            id: context.task.id,
            title: context.task.title,
            type: context.task.type,
            status: context.task.status,
            instruction:
              String(context.task.executionData?.approvalInstruction || context.task.config?.instructionText || ''),
          }
        : null,
      workflowInfo: {
        overview: summary
          ? `Workflow "${summary.title}" mit ${summary.totalSteps} Schritt(en), davon ${summary.completedSteps} abgeschlossen.`
          : 'Für dieses Ticket ist kein Workflow verfügbar.',
      },
    };

    if (expired) {
      return res.status(410).json({
        ...payload,
        message: 'Bestaetigungs-Link ist abgelaufen.',
      });
    }

    return res.json(payload);
  } catch (error) {
    console.error('Workflow confirmation details error:', error);
    return res.status(500).json({ message: 'Fehler beim Laden der Bestaetigungsseite.' });
  }
});

// POST /api/workflows/confirm/:token/decision - Apply approval/rejection
router.post('/api/workflows/confirm/:token/decision', async (req: Request, res: Response): Promise<any> => {
  try {
    const { token } = req.params;
    const decisionRaw = String(req.body?.decision || '').toLowerCase();
    const decision: 'approve' | 'reject' = decisionRaw === 'reject' ? 'reject' : 'approve';
    const deferRaw = String(req.query?.defer ?? req.body?.defer ?? '').trim().toLowerCase();
    const deferPostProcessing = ['1', 'true', 'yes', 'on'].includes(deferRaw);
    if (!token) {
      return res.status(400).json({ message: 'Token fehlt' });
    }

    if (deferPostProcessing) {
      const context = await loadWorkflowConfirmationContext(token, { includeExecution: false });
      if (!context?.validation) {
        return res.status(404).json({ message: 'Bestaetigungs-Link ungueltig oder abgelaufen.' });
      }
      if (isExpired(context.validation.expires_at)) {
        return res.status(410).json({ message: 'Bestaetigungs-Link ist abgelaufen.' });
      }

      const alreadyProcessed = !!context.validation.validated_at;
      if (!alreadyProcessed) {
        void applyWorkflowConfirmationDecision(token, decision).catch((error) => {
          console.error('Deferred workflow confirmation decision failed:', error);
        });
      }

      const successMessage =
        decision === 'reject'
          ? resolveWorkflowConfirmationMessage(
              context,
              'Ablehnung erfasst.',
              'Rejection recorded.'
            )
          : resolveWorkflowConfirmationMessage(
              context,
              'E-Mail-Adresse erfolgreich bestaetigt.',
              'Email address successfully confirmed.'
            );

      return res.json({
        decision,
        message: successMessage,
        ticketId: context.ticket?.id ? String(context.ticket.id) : undefined,
        alreadyProcessed,
        deferred: true,
      });
    }

    const result = await applyWorkflowConfirmationDecision(token, decision);
    return res.json({
      decision,
      ...result,
    });
  } catch (error: any) {
    console.error('Workflow confirmation decision error:', error);
    const status = Number(error?.status || 500);
    return res.status(status).json({ message: error?.message || 'Fehler bei der Bestaetigung.' });
  }
});

// GET /api/workflows/data-request/:token - Public data request form payload
router.get(
  '/api/workflows/data-request/:token/images/:imageId',
  async (req: Request, res: Response): Promise<any> => {
    try {
      const token = String(req.params.token || '').trim();
      const imageId = String(req.params.imageId || '').trim();
      if (!token || !imageId) {
        return res.status(400).json({ message: 'Token oder Bild-ID fehlt.' });
      }

      const context = await loadWorkflowDataRequestContext(token, { includeExecution: false });
      if (!context) {
        return res.status(404).json({ message: 'Datennachforderungs-Link ungueltig oder abgelaufen.' });
      }
      if (isExpired(context.request.expires_at)) {
        return res.status(410).json({ message: resolveDataRequestExpiredMessage(context) });
      }
      if (!context.ticket?.submissionId) {
        return res.status(404).json({ message: 'Ticket nicht gefunden.' });
      }

      const db = getDatabase();
      const row = await db.get(
        `SELECT file_name, image_data
         FROM submission_images
         WHERE id = ? AND submission_id = ?
         LIMIT 1`,
        [imageId, context.ticket.submissionId]
      );
      if (!row) {
        return res.status(404).json({ message: 'Bild nicht gefunden.' });
      }

      const buffer = normalizeImageBuffer((row as any)?.image_data);
      if (!buffer) {
        return res.status(404).json({ message: 'Bilddaten nicht verfuegbar.' });
      }

      const mimeType = guessImageMimeType((row as any)?.file_name, buffer);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(buffer);
    } catch (error) {
      console.error('Workflow data request image error:', error);
      return res.status(500).json({ message: 'Fehler beim Laden des Bildes.' });
    }
  }
);

router.get('/api/workflows/data-request/:token', async (req: Request, res: Response): Promise<any> => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ message: 'Token fehlt.' });
    }
    const context = await loadWorkflowDataRequestContext(token, { includeExecution: true, includeImages: true });
    if (!context) {
      return res.status(404).json({ message: 'Datennachforderungs-Link ungueltig oder abgelaufen.' });
    }

    const expired = isExpired(context.request.expires_at);
    const cycle = Number.isFinite(Number(context.requestMeta?.cycle))
      ? Math.max(1, Math.floor(Number(context.requestMeta?.cycle)))
      : Number.isFinite(Number(context.task?.executionData?.dataRequestCycle))
      ? Math.max(1, Math.floor(Number(context.task?.executionData?.dataRequestCycle)))
      : 1;
    const maxCycles = Number.isFinite(Number(context.requestMeta?.maxCycles))
      ? Math.max(1, Math.floor(Number(context.requestMeta?.maxCycles)))
      : Number.isFinite(Number(context.task?.executionData?.dataRequestMaxCycles))
      ? Math.max(1, Math.floor(Number(context.task?.executionData?.dataRequestMaxCycles)))
      : 1;
    let languageCode = resolveDataRequestLanguageForContext(context) || 'de';
    let languageName = resolveDataRequestLanguageNameForContext(context, languageCode);
    let uiLocale: Partial<DataRequestUiLocale> | undefined = resolveDataRequestUiLocaleForContext(context);
    let fields = context.fields;
    let subject =
      context.requestMeta?.subject ||
      context.task?.executionData?.dataRequestSubject ||
      context.task?.config?.subject ||
      null;
    let introText =
      context.requestMeta?.introText ||
      context.task?.executionData?.dataRequestIntroText ||
      context.task?.config?.introText ||
      null;
    const storedLanguageCode = normalizeDataRequestLanguageCode(
      context.requestMeta?.languageCode || context.request?.language_code || ''
    );
    const shouldRetargetToCitizenLanguage =
      !isCustomDataRequestRecipientContext(context) &&
      !isGermanLanguageCode(languageCode) &&
      (!storedLanguageCode || !areLanguageCodesCompatible(storedLanguageCode, languageCode));
    if (shouldRetargetToCitizenLanguage) {
      const sourceFieldsDe = Array.isArray(context.requestMeta?.adminFieldsDe)
        ? normalizeDataRequestFields(context.requestMeta?.adminFieldsDe)
        : context.fields;
      const sourceSubjectDe =
        String(context.requestMeta?.adminSubjectDe || subject || '').trim() ||
        String(subject || '').trim();
      const sourceIntroTextDe =
        String(context.requestMeta?.adminIntroTextDe || introText || '').trim() ||
        String(introText || '').trim();
      try {
        const targetLanguage: CitizenTargetLanguage = {
          code: languageCode,
          name: languageName,
        };
        const translatedContent = await buildCitizenTargetDataRequestContent({
          fields: sourceFieldsDe,
          subject: sourceSubjectDe,
          introText: sourceIntroTextDe,
          targetLanguage,
        });
        const translatedFields = normalizeDataRequestFields(translatedContent.fields);
        if (translatedFields.length > 0) {
          fields = translatedFields;
        }
        subject = String(translatedContent.subject || sourceSubjectDe || '').trim() || subject;
        introText = String(translatedContent.introText || sourceIntroTextDe || '').trim() || introText;
        uiLocale = await buildCitizenDataRequestUiLocale(targetLanguage);
        languageCode = normalizeDataRequestLanguageCode(targetLanguage.code) || languageCode;
        languageName = normalizeDataRequestLanguageName(targetLanguage.name) || languageName;
        const nextRequestedPayload = serializeStoredDataRequestPayload({
          fields,
          subject: typeof subject === 'string' ? subject : undefined,
          introText: typeof introText === 'string' ? introText : undefined,
          languageCode,
          languageName,
          cycle,
          maxCycles,
          adminFieldsDe: sourceFieldsDe,
          adminSubjectDe: sourceSubjectDe || undefined,
          adminIntroTextDe: sourceIntroTextDe || undefined,
          uiLocale,
        });
        const db = getDatabase();
        await db.run(
          `UPDATE workflow_data_requests
           SET requested_questions_json = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [nextRequestedPayload, context.request.id]
        );
      } catch (error) {
        console.warn('Failed to retarget workflow data request callback language:', error);
      }
    }
    const payload = {
      requestId: context.request.id,
      status: context.request.status || 'pending',
      mode: context.request.parallel_mode ? 'parallel' : 'blocking',
      expiresAt: context.request.expires_at || null,
      answeredAt: context.request.answered_at || null,
      subject,
      introText,
      cycle,
      maxCycles,
      languageCode,
      languageName,
      uiLocale,
      ticket: context.ticket,
      images: context.images || [],
      fields,
    };
    if (expired) {
      return res.status(410).json({
        ...payload,
        message: resolveDataRequestExpiredMessage(context),
      });
    }
    return res.json(payload);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden der Datennachforderung.',
      error: error?.message || String(error),
    });
  }
});

// POST /api/workflows/data-request/:token - Submit answers for data request
router.post('/api/workflows/data-request/:token', async (req: Request, res: Response): Promise<any> => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ message: 'Token fehlt.' });
    }
    const answersInput =
      req.body?.answers && typeof req.body.answers === 'object'
        ? req.body.answers
        : req.body;
    const result = await applyWorkflowDataRequestAnswers(token, answersInput, {
      deferPostProcessing: true,
    });
    return res.json(result);
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: error?.message || 'Fehler beim Speichern der Antworten.',
      details: error?.details || undefined,
      code: error?.code || undefined,
    });
  }
});

// GET /api/admin/config/workflow - Get workflow configuration
router.get('/api/admin/config/workflow', authMiddleware, staffOnly, async (req: Request, res: Response) => {
  try {
    await ensureWorkflowGlobalConfigAccess(req);
    const config = await loadWorkflowConfig();
    res.json(config);
  } catch (err: any) {
    res.status(Number(err?.status || 500)).json({
      message: err?.message || 'Fehler beim Laden der Workflow-Konfiguration',
      error: err?.message || String(err),
    });
  }
});

// PATCH /api/admin/config/workflow - Update workflow configuration
router.patch('/api/admin/config/workflow', authMiddleware, staffOnly, async (req: Request, res: Response) => {
  try {
    await ensureWorkflowGlobalConfigAccess(req);
    const config = await loadWorkflowConfig();
    const updates = req.body;

    // Update basic settings
    if (updates.enabled !== undefined) config.enabled = updates.enabled;
    if (updates.defaultExecutionMode) config.defaultExecutionMode = updates.defaultExecutionMode;
    if (updates.autoTriggerOnEmailVerified !== undefined) {
      config.autoTriggerOnEmailVerified = !!updates.autoTriggerOnEmailVerified;
    }
    if (updates.maxStepsPerWorkflow) config.maxStepsPerWorkflow = updates.maxStepsPerWorkflow;
    if (updates.runtimeDefaults && typeof updates.runtimeDefaults === 'object') {
      config.runtimeDefaults = normalizeRuntimeConfig(
        updates.runtimeDefaults,
        normalizeRuntimeConfig(config.runtimeDefaults || DEFAULT_WORKFLOW_RUNTIME)
      );
    }

    await setSetting('workflowConfig', config);
    res.json(config);
  } catch (err: any) {
    res.status(Number(err?.status || 500)).json({
      message: err?.message || 'Fehler beim Speichern der Workflow-Konfiguration',
      error: err?.message || String(err),
    });
  }
});

// POST /api/admin/config/workflow/confirmation-instruction/generate
router.post(
  '/api/admin/config/workflow/confirmation-instruction/generate',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const instructionPrompt =
        typeof req.body?.instructionPrompt === 'string' ? req.body.instructionPrompt.trim() : '';
      if (!instructionPrompt || instructionPrompt.length < 6) {
        return res.status(400).json({ message: 'Bitte eine ausreichend lange Anforderung angeben.' });
      }

      const workflowTitle =
        typeof req.body?.workflowTitle === 'string' ? req.body.workflowTitle.trim() : '';
      const stepTitle = typeof req.body?.stepTitle === 'string' ? req.body.stepTitle.trim() : '';

      const promptBase = await getSystemPrompt('workflowConfirmationInstructionPrompt');
      const prompt = `${promptBase}

Workflow-Kontext:
- Workflow: ${workflowTitle || 'Unbekannt'}
- Schritt: ${stepTitle || 'Unbekannt'}

Anforderung:
${instructionPrompt}

Antwort:`;

      const responseText = await testAIProvider(prompt, {
        purpose: 'workflow_confirmation_instruction_template',
        meta: {
          source: 'routes.workflows.confirmation_instruction.generate',
          workflowTitle: workflowTitle || null,
          stepTitle: stepTitle || null,
        },
      });

      const instruction = String(responseText || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^["'\s]+|["'\s]+$/g, '')
        .trim();

      if (!instruction) {
        return res.status(422).json({ message: 'Die KI konnte keine Anweisung erzeugen.' });
      }

      return res.json({ instruction });
    } catch (error: any) {
      return res.status(500).json({
        message: 'Fehler beim Generieren der Anweisung',
        error: error?.message || String(error),
      });
    }
  }
);

// POST /api/admin/config/workflow/rest/probe - Execute REST_API_CALL script against probe input
router.post(
  '/api/admin/config/workflow/rest/probe',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const sourceCode = typeof req.body?.sourceCode === 'string' ? req.body.sourceCode : '';
      if (!sourceCode.trim()) {
        return res.status(400).json({ message: 'sourceCode ist erforderlich.' });
      }

      const scriptInputRaw = req.body?.input;
      let scriptInput: any = {};
      if (typeof scriptInputRaw === 'string' && scriptInputRaw.trim()) {
        try {
          scriptInput = extractJsonPayload(scriptInputRaw);
        } catch {
          return res.status(400).json({ message: 'input konnte nicht als JSON geparst werden.' });
        }
      } else if (
        scriptInputRaw &&
        typeof scriptInputRaw === 'object' &&
        !Array.isArray(scriptInputRaw)
      ) {
        scriptInput = scriptInputRaw;
      }

      const persistedState =
        req.body?.state && typeof req.body.state === 'object' && !Array.isArray(req.body.state)
          ? req.body.state
          : {};

      const probe = await executeRestApiProbe({
        sourceCode,
        baseUrl: typeof req.body?.baseUrl === 'string' ? req.body.baseUrl : '',
        timeoutMs: Number(req.body?.timeoutMs),
        requestTimeoutMs: Number(req.body?.requestTimeoutMs),
        scriptInput,
        persistedState,
      });

      const analyzeWithAi = req.body?.analyzeWithAi !== false;
      let aiAnalysisRaw = '';
      let aiAnalysis: any = null;
      let aiAnalysisError = '';

      if (analyzeWithAi) {
        try {
          const promptBase = await getSystemPrompt('workflowApiProbeAnalysisPrompt');
          const prompt = `${promptBase}

PROBE-CONTEXT:
- baseUrl: ${String(req.body?.baseUrl || '').trim() || 'n/a'}
- timeoutMs: ${Number.isFinite(Number(req.body?.timeoutMs)) ? Number(req.body?.timeoutMs) : 20000}
- requestTimeoutMs: ${Number.isFinite(Number(req.body?.requestTimeoutMs)) ? Number(req.body?.requestTimeoutMs) : 15000}

Script:
\`\`\`javascript
${sourceCode}
\`\`\`

Input:
\`\`\`json
${JSON.stringify(scriptInput || {}, null, 2)}
\`\`\`

Requests:
\`\`\`json
${JSON.stringify(probe.requests || [], null, 2)}
\`\`\`

Logs:
\`\`\`json
${JSON.stringify(probe.logs || [], null, 2)}
\`\`\`

Output:
\`\`\`json
${JSON.stringify(probe.outputObject || probe.output || null, null, 2)}
\`\`\`
`;

          aiAnalysisRaw = await testAIProvider(prompt, {
            purpose: 'workflow_rest_api_probe_analysis',
            meta: {
              source: 'routes.workflows.rest_probe',
            },
          });
          try {
            aiAnalysis = extractJsonPayload(aiAnalysisRaw);
          } catch {
            aiAnalysis = null;
          }
        } catch (error: any) {
          aiAnalysisError = error?.message || 'KI-Auswertung fehlgeschlagen.';
        }
      }

      return res.json({
        ...probe,
        aiAnalysis,
        aiAnalysisRaw: aiAnalysisRaw || undefined,
        aiAnalysisError: aiAnalysisError || undefined,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: error?.message || 'REST-Probe fehlgeschlagen.',
        probeData:
          error?.probeData && typeof error.probeData === 'object' ? error.probeData : undefined,
      });
    }
  }
);

function normalizeWorkflowStepType(input: unknown): WorkflowStepType {
  const raw = String(input || '').trim().toUpperCase();
  return WORKFLOW_STEP_TYPES.has(raw as WorkflowStepType)
    ? (raw as WorkflowStepType)
    : 'CUSTOM';
}

function normalizeWorkflowExecutionMode(input: unknown): WorkflowExecutionMode {
  const raw = String(input || '').trim().toUpperCase();
  if (raw === 'AUTO' || raw === 'HYBRID' || raw === 'MANUAL') {
    return raw as WorkflowExecutionMode;
  }
  return 'MANUAL';
}

function extractImportedWorkflowTemplates(input: any): any[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.templates)) return input.templates;
  if (input.template && typeof input.template === 'object') return [input.template];
  if (input.workflow && typeof input.workflow === 'object') return [input.workflow];
  if (input.definition && typeof input.definition === 'object') return [input.definition];
  return [];
}

function normalizeImportedWorkflowTemplate(
  rawTemplate: any,
  fallbackId: string,
  fallbackMode: WorkflowExecutionMode
): WorkflowTemplate | null {
  if (!rawTemplate || typeof rawTemplate !== 'object') return null;
  const now = new Date().toISOString();
  const sanitizedId = String(rawTemplate.id || fallbackId)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 120);

  const rawSteps = Array.isArray(rawTemplate.steps) ? rawTemplate.steps : [];
  const steps = rawSteps.map((rawStep: any, index: number) => {
    const type = normalizeWorkflowStepType(rawStep?.type);
    const config =
      rawStep?.config && typeof rawStep.config === 'object' && !Array.isArray(rawStep.config)
        ? rawStep.config
        : {};
    const titleFallback = type === 'REST_API_CALL' ? 'RESTful API Call' : `Schritt ${index + 1}`;
    return {
      title: String(rawStep?.title || titleFallback).trim() || titleFallback,
      type,
      config,
      auto: type === 'JOIN' ? true : !!rawStep?.auto,
    };
  });

  if (steps.length === 0) return null;

  return {
    id: sanitizedId || fallbackId,
    name: String(rawTemplate.name || 'Importierter Workflow').trim() || 'Importierter Workflow',
    description: String(rawTemplate.description || '').trim(),
    steps,
    executionMode: normalizeWorkflowExecutionMode(rawTemplate.executionMode || fallbackMode),
    autoTriggerOnEmailVerified: !!rawTemplate.autoTriggerOnEmailVerified,
    enabled: rawTemplate.enabled !== false,
    runtime: normalizeRuntimeConfig(
      rawTemplate.runtime || rawTemplate.runtimeDefaults || rawTemplate.workflowRuntime,
      DEFAULT_WORKFLOW_RUNTIME
    ),
    createdAt:
      typeof rawTemplate.createdAt === 'string' && rawTemplate.createdAt.trim()
        ? rawTemplate.createdAt
        : now,
    updatedAt: now,
  };
}

function normalizeWorkflowBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'ja') return true;
    if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'nein') return false;
  }
  return fallback;
}

function resolveTaskReferenceIndex(
  value: unknown,
  stepCount: number,
  titleToIndex: Map<string, number>
): number | null {
  if (stepCount <= 0) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const numeric = Math.floor(value);
    if (numeric >= 0 && numeric < stepCount) return numeric;
    if (numeric >= 1 && numeric <= stepCount) return numeric - 1;
    return null;
  }

  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (titleToIndex.has(lower)) return titleToIndex.get(lower) ?? null;

  const taskMatch = lower.match(/^task[-_\s:]*(\d+)$/);
  if (taskMatch) {
    const index = Number(taskMatch[1]);
    if (Number.isInteger(index) && index >= 0 && index < stepCount) return index;
    return null;
  }

  const nodeMatch = lower.match(/^(?:step|node|knoten)[-_\s:]*(\d+)$/);
  if (nodeMatch) {
    const index = Number(nodeMatch[1]) - 1;
    if (Number.isInteger(index) && index >= 0 && index < stepCount) return index;
    return null;
  }

  const numericMatch = lower.match(/^(\d+)$/);
  if (numericMatch) {
    const numeric = Number(numericMatch[1]);
    if (Number.isInteger(numeric)) {
      if (numeric >= 0 && numeric < stepCount) return numeric;
      if (numeric >= 1 && numeric <= stepCount) return numeric - 1;
    }
    return null;
  }

  return null;
}

function normalizeTaskReferenceIds(
  value: unknown,
  stepCount: number,
  titleToIndex: Map<string, number>
): string[] {
  const source = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
  const unique = new Set<string>();

  for (const candidate of source) {
    const index = resolveTaskReferenceIndex(candidate, stepCount, titleToIndex);
    if (index === null) continue;
    unique.add(`task-${index}`);
  }

  return Array.from(unique);
}

function normalizeGeneratedWorkflowTemplate(
  rawTemplate: any,
  fallbackId: string,
  fallbackMode: WorkflowExecutionMode,
  options: {
    nameHint?: string;
    descriptionHint?: string;
    executionMode?: WorkflowExecutionMode;
    autoTriggerOnEmailVerified?: boolean;
    enabled?: boolean;
    maxSteps?: number;
  } = {}
): WorkflowTemplate | null {
  if (!rawTemplate || typeof rawTemplate !== 'object') return null;

  const preparedTemplate = { ...rawTemplate };
  if ((!preparedTemplate.name || !String(preparedTemplate.name).trim()) && options.nameHint) {
    preparedTemplate.name = options.nameHint;
  }
  if (
    (!preparedTemplate.description || !String(preparedTemplate.description).trim()) &&
    options.descriptionHint
  ) {
    preparedTemplate.description = options.descriptionHint;
  }
  if (!preparedTemplate.executionMode && options.executionMode) {
    preparedTemplate.executionMode = options.executionMode;
  }
  if (preparedTemplate.autoTriggerOnEmailVerified === undefined && options.autoTriggerOnEmailVerified !== undefined) {
    preparedTemplate.autoTriggerOnEmailVerified = options.autoTriggerOnEmailVerified;
  }
  if (preparedTemplate.enabled === undefined && options.enabled !== undefined) {
    preparedTemplate.enabled = options.enabled;
  }

  const normalized = normalizeImportedWorkflowTemplate(preparedTemplate, fallbackId, fallbackMode);
  if (!normalized) return null;

  const maxStepsRaw = Number(options.maxSteps);
  const maxSteps = Number.isFinite(maxStepsRaw) ? Math.max(1, Math.floor(maxStepsRaw)) : normalized.steps.length;
  if (normalized.steps.length > maxSteps) {
    normalized.steps = normalized.steps.slice(0, maxSteps);
  }
  if (normalized.steps.length === 0) return null;

  const stepCount = normalized.steps.length;
  const titleToIndex = new Map<string, number>();
  normalized.steps.forEach((step, index) => {
    const key = String(step.title || '').trim().toLowerCase();
    if (!key || titleToIndex.has(key)) return;
    titleToIndex.set(key, index);
  });

  const normalizeIfConditions = (conditionsRaw: unknown): any[] => {
    const conditions = Array.isArray(conditionsRaw) ? conditionsRaw : [];
    const normalizedConditions = conditions
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const source = entry as Record<string, any>;
        const rawKind = String(source.kind || source.type || 'field').trim().toLowerCase();
        const kind =
          rawKind === 'geofence'
            ? 'geofence'
            : rawKind === 'process_variable'
            ? 'process_variable'
            : 'field';

        if (kind === 'geofence') {
          const shapeRaw = String(source.shape || '').trim().toLowerCase();
          const shape = shapeRaw === 'polygon' ? 'polygon' : 'circle';
          const operatorRaw = String(source.operator || '').trim().toLowerCase();
          const operator = operatorRaw === 'outside' ? 'outside' : 'inside';
          const points = Array.isArray(source.points)
            ? source.points
                .map((point: any) => {
                  if (!point || typeof point !== 'object') return null;
                  const lat = Number(point.lat ?? point.latitude);
                  const lon = Number(point.lon ?? point.lng ?? point.longitude);
                  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
                  return {
                    lat: Number(lat.toFixed(6)),
                    lon: Number(lon.toFixed(6)),
                  };
                })
                .filter((point: { lat: number; lon: number } | null): point is { lat: number; lon: number } => point !== null)
            : [];

          const centerLat = Number(source.centerLat);
          const centerLon = Number(source.centerLon);
          const radiusMeters = Number(source.radiusMeters);
          const latitudeField =
            typeof source.latitudeField === 'string' && source.latitudeField.trim()
              ? source.latitudeField.trim()
              : 'latitude';
          const longitudeField =
            typeof source.longitudeField === 'string' && source.longitudeField.trim()
              ? source.longitudeField.trim()
              : 'longitude';

          return {
            kind: 'geofence',
            operator,
            shape: shape === 'polygon' || points.length >= 3 ? 'polygon' : 'circle',
            centerLat: Number.isFinite(centerLat) ? centerLat : undefined,
            centerLon: Number.isFinite(centerLon) ? centerLon : undefined,
            radiusMeters: Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : undefined,
            points: points.length > 0 ? points : undefined,
            latitudeField,
            longitudeField,
          };
        }

        if (kind === 'process_variable') {
          const key = typeof source.key === 'string' && source.key.trim()
            ? source.key.trim()
            : typeof source.variableKey === 'string' && source.variableKey.trim()
            ? source.variableKey.trim()
            : typeof source.field === 'string' && source.field.trim()
            ? source.field.trim()
            : 'var.input';
          const operator =
            typeof source.operator === 'string' && source.operator.trim()
              ? source.operator.trim()
              : 'equals';
          return {
            kind: 'process_variable',
            key,
            operator,
            value: source.value,
          };
        }

        const rawField = typeof source.field === 'string' && source.field.trim() ? source.field.trim() : 'category';
        const normalizedFieldKey = rawField
          .toLowerCase()
          .replace(/[\s_-]+/g, '');
        let field = rawField;
        if (
          normalizedFieldKey === 'responsibilityauthority' ||
          normalizedFieldKey === 'responsibility' ||
          normalizedFieldKey === 'zustaendigkeit' ||
          normalizedFieldKey === 'zustandigkeit'
        ) {
          field = 'responsibilityAuthority';
        } else if (normalizedFieldKey === 'assignedto') {
          field = 'assignedTo';
        } else if (normalizedFieldKey === 'postalcode') {
          field = 'postalCode';
        } else if (normalizedFieldKey === 'citizenemail') {
          field = 'citizenEmail';
        } else if (normalizedFieldKey === 'citizenname') {
          field = 'citizenName';
        } else if (normalizedFieldKey === 'redmineissueid') {
          field = 'redmineIssueId';
        }
        const operatorRaw =
          typeof source.operator === 'string' && source.operator.trim()
            ? source.operator.trim().toLowerCase().replace(/[\s-]+/g, '_')
            : 'equals';
        const operatorAliases: Record<string, string> = {
          '=': 'equals',
          '==': 'equals',
          eq: 'equals',
          is: 'equals',
          ist: 'equals',
          '!=': 'not_equals',
          neq: 'not_equals',
          is_not: 'not_equals',
          isnot: 'not_equals',
          ist_nicht: 'not_equals',
        };
        const normalizedField = field.toLowerCase();
        let operator = operatorAliases[operatorRaw] || operatorRaw;
        if (normalizedField === 'responsibilityauthority') {
          if (!['equals', 'not_equals', 'is_empty', 'is_not_empty'].includes(operator)) {
            operator = 'equals';
          }
        }
        const value = source.value;

        if (normalizedField === 'priority') {
          const priorityRaw = String(value ?? '')
            .trim()
            .toLowerCase();
          const priorityMap: Record<string, string> = {
            niedrig: 'low',
            low: 'low',
            mittel: 'medium',
            normal: 'medium',
            medium: 'medium',
            hoch: 'high',
            high: 'high',
            kritisch: 'critical',
            critical: 'critical',
          };
          return {
            kind: 'field',
            field,
            operator,
            value: priorityMap[priorityRaw] || value,
          };
        }

        const normalizedStatus = String(value ?? '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace('in_progress', 'in-progress')
          .replace('pending_validation', 'pending_validation');
        if (normalizedField === 'status' && TICKET_STATUS_OPTIONS.has(normalizedStatus)) {
          return {
            kind: 'field',
            field,
            operator,
            value: normalizedStatus,
          };
        }

        if (normalizedField === 'responsibilityauthority') {
          return {
            kind: 'field',
            field,
            operator,
            value: value === null || value === undefined ? '' : String(value).trim(),
          };
        }

        return {
          kind: 'field',
          field,
          operator,
          value,
        };
      })
      .filter((entry) => entry !== null) as Array<Record<string, any>>;

    if (normalizedConditions.length > 0) return normalizedConditions;
    return [
      {
        kind: 'field',
        field: 'category',
        operator: 'equals',
        value: '',
      },
    ];
  };

  normalized.steps = normalized.steps.map((step, index) => {
    const type = normalizeWorkflowStepType(step.type);
    const sourceConfig =
      step?.config && typeof step.config === 'object' && !Array.isArray(step.config)
        ? { ...step.config }
        : {};

    const fallbackTitle = `Knoten ${index + 1}`;
    const nextTaskIds = normalizeTaskReferenceIds(
      sourceConfig.nextTaskIds ?? sourceConfig.nextTaskId ?? sourceConfig.next ?? sourceConfig.to,
      stepCount,
      titleToIndex
    );

    const config: Record<string, any> = { ...sourceConfig, nextTaskIds };

    if (type === 'SPLIT') {
      const leftCandidate = normalizeTaskReferenceIds(
        sourceConfig.leftNextTaskId ?? sourceConfig.left ?? sourceConfig.branchA ?? sourceConfig.onLeft,
        stepCount,
        titleToIndex
      )[0];
      const rightCandidate = normalizeTaskReferenceIds(
        sourceConfig.rightNextTaskId ?? sourceConfig.right ?? sourceConfig.branchB ?? sourceConfig.onRight,
        stepCount,
        titleToIndex
      )[0];
      const splitTargets = normalizeTaskReferenceIds(
        sourceConfig.nextTaskIds ?? sourceConfig.branches ?? [sourceConfig.leftNextTaskId, sourceConfig.rightNextTaskId],
        stepCount,
        titleToIndex
      );
      const left = leftCandidate || splitTargets[0] || '';
      const right = rightCandidate || splitTargets.find((taskId) => taskId !== left) || '';
      config.leftNextTaskId = left;
      config.rightNextTaskId = right;
      config.nextTaskIds = [left, right].filter(Boolean);
    } else if (type === 'IF') {
      const trueNextTaskIds = normalizeTaskReferenceIds(
        sourceConfig.trueNextTaskIds ?? sourceConfig.trueNextTaskId ?? sourceConfig.onTrue ?? sourceConfig.yes ?? sourceConfig.then,
        stepCount,
        titleToIndex
      );
      const falseNextTaskIds = normalizeTaskReferenceIds(
        sourceConfig.falseNextTaskIds ?? sourceConfig.falseNextTaskId ?? sourceConfig.onFalse ?? sourceConfig.no ?? sourceConfig.else,
        stepCount,
        titleToIndex
      );
      config.logic =
        String(sourceConfig.logic || sourceConfig.logicalOperator || 'AND').trim().toUpperCase() === 'OR'
          ? 'OR'
          : 'AND';
      config.conditions = normalizeIfConditions(sourceConfig.conditions);
      config.trueNextTaskIds = trueNextTaskIds;
      config.falseNextTaskIds = falseNextTaskIds;
      config.trueNextTaskId = trueNextTaskIds[0] || '';
      config.falseNextTaskId = falseNextTaskIds[0] || '';
      config.nextTaskIds = [];
    } else if (type === 'END') {
      const scope = String(sourceConfig.scope || sourceConfig.endScope || 'branch').trim().toLowerCase() === 'workflow'
        ? 'workflow'
        : 'branch';
      config.scope = scope;
      config.endScope = scope;
      config.nextTaskIds = [];
    } else if (type === 'WAIT_STATUS_CHANGE') {
      const normalizeMode = (value: unknown): 'keep' | 'set' =>
        String(value || '').trim().toLowerCase() === 'set' ? 'set' : 'keep';
      const normalizeStatus = (value: unknown): string => {
        const normalizedStatus = String(value ?? '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace('in_progress', 'in-progress');
        return TICKET_STATUS_OPTIONS.has(normalizedStatus) ? normalizedStatus : 'completed';
      };
      const waitHours = Number(sourceConfig.waitHours);
      const waitMinutes = Number(sourceConfig.waitMinutes);
      const waitSeconds = Number(sourceConfig.waitSeconds);
      const normalizedPriority = String(sourceConfig.priorityAfter ?? '')
        .trim()
        .toLowerCase();
      const priorityMap: Record<string, string> = {
        niedrig: 'low',
        low: 'low',
        mittel: 'medium',
        normal: 'medium',
        medium: 'medium',
        hoch: 'high',
        high: 'high',
        kritisch: 'critical',
        critical: 'critical',
      };

      config.waitHours = Number.isFinite(waitHours) ? Math.max(0, Math.floor(waitHours)) : 0;
      config.waitMinutes = Number.isFinite(waitMinutes) ? Math.max(0, Math.floor(waitMinutes)) : 0;
      config.waitSeconds = Number.isFinite(waitSeconds) ? Math.max(0, Math.floor(waitSeconds)) : 0;
      config.statusMode = normalizeMode(sourceConfig.statusMode);
      config.statusAfter = normalizeStatus(sourceConfig.statusAfter ?? sourceConfig.targetStatus);
      config.priorityMode = normalizeMode(sourceConfig.priorityMode);
      config.priorityAfter = priorityMap[normalizedPriority] || 'medium';
      config.assigneeMode = normalizeMode(sourceConfig.assigneeMode);
      const explicitAssigneeAfter = asTrimmedString(sourceConfig.assigneeAfter);
      const explicitPrimaryUser = asTrimmedString(
        sourceConfig.assigneeUserIdAfter ||
          sourceConfig.primaryAssigneeUserIdAfter ||
          sourceConfig.primaryAssigneeUserId ||
          sourceConfig.primary_assignee_user_id
      );
      const explicitPrimaryOrg = asTrimmedString(
        sourceConfig.assigneeOrgUnitIdAfter ||
          sourceConfig.primaryAssigneeOrgUnitIdAfter ||
          sourceConfig.primaryAssigneeOrgUnitId ||
          sourceConfig.primary_assignee_org_unit_id
      );
      if (explicitAssigneeAfter) {
        config.assigneeAfter = explicitAssigneeAfter;
      } else if (explicitPrimaryUser) {
        config.assigneeAfter = `user:${explicitPrimaryUser}`;
      } else if (explicitPrimaryOrg) {
        config.assigneeAfter = `org:${explicitPrimaryOrg}`;
      } else {
        config.assigneeAfter = '';
      }
      config.categoryMode = normalizeMode(sourceConfig.categoryMode);
      config.categoryAfter = sourceConfig.categoryAfter ? String(sourceConfig.categoryAfter) : '';
      config.descriptionMode = normalizeMode(sourceConfig.descriptionMode);
      config.descriptionAfter = sourceConfig.descriptionAfter ? String(sourceConfig.descriptionAfter) : '';
      config.addressMode = normalizeMode(sourceConfig.addressMode);
      config.addressAfter = sourceConfig.addressAfter ? String(sourceConfig.addressAfter) : '';
      config.postalCodeMode = normalizeMode(sourceConfig.postalCodeMode);
      config.postalCodeAfter = sourceConfig.postalCodeAfter ? String(sourceConfig.postalCodeAfter) : '';
      config.cityMode = normalizeMode(sourceConfig.cityMode);
      config.cityAfter = sourceConfig.cityAfter ? String(sourceConfig.cityAfter) : '';
      config.responsibilityMode = normalizeMode(sourceConfig.responsibilityMode);
      config.responsibilityAfter = sourceConfig.responsibilityAfter
        ? String(sourceConfig.responsibilityAfter).trim()
        : '';
      config.latitudeMode = normalizeMode(sourceConfig.latitudeMode);
      config.latitudeAfter = sourceConfig.latitudeAfter ?? '';
      config.longitudeMode = normalizeMode(sourceConfig.longitudeMode);
      config.longitudeAfter = sourceConfig.longitudeAfter ?? '';
    } else if (type === 'INTERNAL_PROCESSING') {
      config.mode = normalizeInternalProcessingMode(sourceConfig.mode || sourceConfig.executionMode);
      config.assigneeStrategy = normalizeInternalProcessingAssigneeStrategy(
        sourceConfig.assigneeStrategy || sourceConfig.assignmentStrategy
      );
      config.assigneeUserId = sourceConfig.assigneeUserId ? String(sourceConfig.assigneeUserId) : '';
      config.assigneeOrgUnitId = sourceConfig.assigneeOrgUnitId ? String(sourceConfig.assigneeOrgUnitId) : '';
      config.assigneeProcessVariableKey = sourceConfig.assigneeProcessVariableKey
        ? String(sourceConfig.assigneeProcessVariableKey)
        : sourceConfig.processVariableKey
        ? String(sourceConfig.processVariableKey)
        : '';
      config.taskSource =
        String(sourceConfig.taskSource || sourceConfig.source || '').trim().toLowerCase() === 'ai_generated'
          ? 'ai_generated'
          : 'static';
      config.taskTitle = sourceConfig.taskTitle ? String(sourceConfig.taskTitle) : '';
      config.taskDescription = sourceConfig.taskDescription ? String(sourceConfig.taskDescription) : '';
      config.instructions = sourceConfig.instructions ? String(sourceConfig.instructions) : '';
      config.dueMinutes = Number.isFinite(Number(sourceConfig.dueMinutes))
        ? Math.max(0, Math.floor(Number(sourceConfig.dueMinutes)))
        : 0;
      config.dueHours = Number.isFinite(Number(sourceConfig.dueHours))
        ? Math.max(0, Math.floor(Number(sourceConfig.dueHours)))
        : 0;
      config.dueDays = Number.isFinite(Number(sourceConfig.dueDays))
        ? Math.max(0, Math.floor(Number(sourceConfig.dueDays)))
        : 0;
      config.formSchema = { fields: normalizeInternalTaskFormSchema(sourceConfig.formSchema) };
      config.processVarMappings = normalizeInternalProcessVarMappings(sourceConfig.processVarMappings);
      config.allowReject = normalizeInternalTaskRejectAllowed(sourceConfig.allowReject, true);
      config.maxCycles = Number.isFinite(Number(sourceConfig.maxCycles))
        ? Math.max(1, Math.min(12, Math.floor(Number(sourceConfig.maxCycles))))
        : 1;
      config.assignmentUpdateMode = normalizeInternalTaskAssignmentUpdateMode(
        sourceConfig.assignmentUpdateMode || sourceConfig.assignmentMode
      );
      config.assignmentSource = normalizeInternalTaskAssignmentSource(sourceConfig.assignmentSource);
      config.onComplete =
        sourceConfig.onComplete && typeof sourceConfig.onComplete === 'object' && !Array.isArray(sourceConfig.onComplete)
          ? sourceConfig.onComplete
          : {};
      config.onReject =
        sourceConfig.onReject && typeof sourceConfig.onReject === 'object' && !Array.isArray(sourceConfig.onReject)
          ? sourceConfig.onReject
          : {};
      config.nextTaskIds = nextTaskIds;
    } else if (type === 'REDMINE_TICKET') {
      const assigneeModeRaw = String(sourceConfig.assigneeMode || '').trim().toLowerCase();
      const assigneeMode: RedmineAssigneeMode =
        assigneeModeRaw === 'fixed' || assigneeModeRaw === 'none' ? assigneeModeRaw : 'ai';
      config.projectMode = String(sourceConfig.projectMode || '').trim().toLowerCase() === 'fixed' ? 'fixed' : 'ai';
      config.trackerMode = String(sourceConfig.trackerMode || '').trim().toLowerCase() === 'fixed' ? 'fixed' : 'ai';
      config.assigneeMode = assigneeMode;
      config.textMode = String(sourceConfig.textMode || '').trim().toLowerCase() === 'fixed' ? 'fixed' : 'ai';
      config.projectId = sourceConfig.projectId || 'auto';
      config.tracker = sourceConfig.tracker || 'auto';
      config.assigneeId = sourceConfig.assigneeId ? String(sourceConfig.assigneeId) : '';
      config.noAssignee = assigneeMode === 'none';
      const targetStatusIds = Array.isArray(sourceConfig.targetStatusIds)
        ? sourceConfig.targetStatusIds
            .map((value: any) => Number(value))
            .filter((value: number) => Number.isFinite(value))
        : [];
      config.targetStatusIds = targetStatusIds;
      config.waitForTargetStatus = sourceConfig.waitForTargetStatus === true;
      const interval = Number(sourceConfig.targetStatusCheckIntervalSeconds);
      config.targetStatusCheckIntervalSeconds = Number.isFinite(interval) ? Math.max(15, interval) : 60;
      const waitMaxSecondsRaw = Number(sourceConfig.waitMaxSeconds);
      config.waitMaxSeconds = Number.isFinite(waitMaxSecondsRaw)
        ? Math.max(0, Math.floor(waitMaxSecondsRaw))
        : 0;
      config.titleTemplate = String(sourceConfig.titleTemplate || '{category}: {address}');
      config.descriptionTemplate = String(
        sourceConfig.descriptionTemplate ||
          'Ticket-ID: {ticketId}\nKategorie: {category}\nAdresse: {address}\nKoordinaten: {coordinates}\nMeldende Person: {citizenName} ({citizenEmail})\n\nBeschreibung:\n{description}'
      );
      config.aiPromptTemplate = String(sourceConfig.aiPromptTemplate || '');
      config.aiPromptExtension = String(sourceConfig.aiPromptExtension || '');
    } else if (type === 'EMAIL_CONFIRMATION' || type === 'EMAIL_DOUBLE_OPT_IN') {
      config.recipientType = String(sourceConfig.recipientType || '').trim().toLowerCase() === 'custom' ? 'custom' : 'citizen';
      config.templateId = String(sourceConfig.templateId || 'workflow-confirmation');
      config.recipientEmail = sourceConfig.recipientEmail ? String(sourceConfig.recipientEmail) : '';
      config.recipientName = sourceConfig.recipientName ? String(sourceConfig.recipientName) : '';
      config.recipientEmailSource = normalizeWorkflowRecipientEmailSource(sourceConfig.recipientEmailSource);
      config.recipientOrgUnitId = sourceConfig.recipientOrgUnitId ? String(sourceConfig.recipientOrgUnitId) : '';
      config.instructionText = sourceConfig.instructionText ? String(sourceConfig.instructionText) : '';
      config.instructionAiPrompt = sourceConfig.instructionAiPrompt ? String(sourceConfig.instructionAiPrompt) : '';
      config.timeoutHours = Number.isFinite(Number(sourceConfig.timeoutHours))
        ? Math.max(0, Math.floor(Number(sourceConfig.timeoutHours)))
        : 0;
      config.timeoutMinutes = Number.isFinite(Number(sourceConfig.timeoutMinutes))
        ? Math.max(0, Math.floor(Number(sourceConfig.timeoutMinutes)))
        : 0;
      const rejectNextTaskIds = normalizeTaskReferenceIds(
        sourceConfig.rejectNextTaskIds ?? sourceConfig.rejectNextTaskId ?? sourceConfig.onReject,
        stepCount,
        titleToIndex
      );
      config.rejectNextTaskIds = rejectNextTaskIds;
      if (rejectNextTaskIds.length > 0) {
        config.rejectNextTaskId = rejectNextTaskIds[0];
      }
      if (type === 'EMAIL_DOUBLE_OPT_IN') {
        config.sendLegacySubmissionConfirmation = sourceConfig.sendLegacySubmissionConfirmation !== false;
      }
    } else if (type === 'MAYOR_INVOLVEMENT') {
      const modeRaw = String(sourceConfig.mode || sourceConfig.operationMode || '').trim().toLowerCase();
      const mode =
        modeRaw === 'approval' || modeRaw === 'consent' || modeRaw === 'ask' || modeRaw === 'request_approval'
          ? 'approval'
          : 'notify';
      config.mode = mode;
      config.operationMode = mode;
      config.templateId = String(
        sourceConfig.templateId ||
          (mode === 'approval' ? 'workflow-mayor-involvement-approval' : 'workflow-mayor-involvement-notify')
      );
      config.approvalQuestion =
        sourceConfig.approvalQuestion && String(sourceConfig.approvalQuestion).trim()
          ? String(sourceConfig.approvalQuestion)
          : DEFAULT_MAYOR_APPROVAL_QUESTION;
      config.timeoutHours = Number.isFinite(Number(sourceConfig.timeoutHours))
        ? Math.max(0, Math.floor(Number(sourceConfig.timeoutHours)))
        : 0;
      config.timeoutMinutes = Number.isFinite(Number(sourceConfig.timeoutMinutes))
        ? Math.max(0, Math.floor(Number(sourceConfig.timeoutMinutes)))
        : 0;
      const rejectNextTaskIds = normalizeTaskReferenceIds(
        sourceConfig.rejectNextTaskIds ?? sourceConfig.rejectNextTaskId ?? sourceConfig.onReject,
        stepCount,
        titleToIndex
      );
      config.rejectNextTaskIds = rejectNextTaskIds;
      if (rejectNextTaskIds.length > 0) {
        config.rejectNextTaskId = rejectNextTaskIds[0];
      }
    } else if (
      type === 'DATENNACHFORDERUNG' ||
      type === 'ENHANCED_CATEGORIZATION' ||
      type === 'FREE_AI_DATA_REQUEST'
    ) {
      config.recipientType = String(sourceConfig.recipientType || '').trim().toLowerCase() === 'custom' ? 'custom' : 'citizen';
      config.recipientEmail = sourceConfig.recipientEmail ? String(sourceConfig.recipientEmail) : '';
      config.recipientName = sourceConfig.recipientName ? String(sourceConfig.recipientName) : '';
      config.recipientEmailSource = normalizeWorkflowRecipientEmailSource(sourceConfig.recipientEmailSource);
      config.recipientOrgUnitId = sourceConfig.recipientOrgUnitId ? String(sourceConfig.recipientOrgUnitId) : '';
      config.templateId = sourceConfig.templateId ? String(sourceConfig.templateId) : 'workflow-data-request';
      config.subject = sourceConfig.subject ? String(sourceConfig.subject) : '';
      config.introText = sourceConfig.introText ? String(sourceConfig.introText) : '';
      config.parallelMode = sourceConfig.parallelMode !== false;
      config.timeoutHours = Number.isFinite(Number(sourceConfig.timeoutHours))
        ? Math.max(0, Math.floor(Number(sourceConfig.timeoutHours)))
        : 0;
      config.timeoutMinutes = Number.isFinite(Number(sourceConfig.timeoutMinutes))
        ? Math.max(0, Math.floor(Number(sourceConfig.timeoutMinutes)))
        : 0;
      config.timeoutSeconds = Number.isFinite(Number(sourceConfig.timeoutSeconds))
        ? Math.max(0, Math.floor(Number(sourceConfig.timeoutSeconds)))
        : 0;
      config.variablePrefix = sourceConfig.variablePrefix ? String(sourceConfig.variablePrefix) : '';
      config.aliasPrefix = sourceConfig.aliasPrefix ? String(sourceConfig.aliasPrefix) : 'var';
      config.createAlias = sourceConfig.createAlias !== false;
      config.aiCommentVisibility = sourceConfig.aiCommentVisibility === 'public' ? 'public' : 'internal';
      config.responseCommentVisibility = sourceConfig.responseCommentVisibility === 'public' ? 'public' : 'internal';
      config.questionPrompt = sourceConfig.questionPrompt ? String(sourceConfig.questionPrompt) : '';
      config.questionPromptMode = sourceConfig.questionPromptMode === 'override' ? 'override' : 'append';
      config.collectionObjective = sourceConfig.collectionObjective
        ? String(sourceConfig.collectionObjective)
        : sourceConfig.requestedInformation
        ? String(sourceConfig.requestedInformation)
        : sourceConfig.requestedInfo
        ? String(sourceConfig.requestedInfo)
        : sourceConfig.requested_information
        ? String(sourceConfig.requested_information)
        : sourceConfig.informationGoal
        ? String(sourceConfig.informationGoal)
        : '';
      config.enableNeedCheck =
        typeof sourceConfig.enableNeedCheck === 'boolean'
          ? sourceConfig.enableNeedCheck
          : type === 'FREE_AI_DATA_REQUEST';
      config.needCheckPrompt = sourceConfig.needCheckPrompt ? String(sourceConfig.needCheckPrompt) : '';
      if (type === 'FREE_AI_DATA_REQUEST') {
        config.needCheckConfidenceThreshold = Number.isFinite(Number(sourceConfig.needCheckConfidenceThreshold))
          ? Math.max(0, Math.min(1, Number(sourceConfig.needCheckConfidenceThreshold)))
          : Number.isFinite(Number(sourceConfig.confidenceThreshold))
          ? Math.max(0, Math.min(1, Number(sourceConfig.confidenceThreshold)))
          : 0.82;
      }
      config.answerEvaluationPrompt = sourceConfig.answerEvaluationPrompt
        ? String(sourceConfig.answerEvaluationPrompt)
        : '';
      config.enableRecategorization =
        type === 'ENHANCED_CATEGORIZATION'
          ? sourceConfig.enableRecategorization !== false
          : sourceConfig.enableRecategorization === true;
      config.maxQuestionsPerCycle = Number.isFinite(Number(sourceConfig.maxQuestionsPerCycle))
        ? Math.max(1, Math.min(25, Math.floor(Number(sourceConfig.maxQuestionsPerCycle))))
        : 5;
      config.allowFollowUpCycles = sourceConfig.allowFollowUpCycles === true;
      config.maxFollowUpCycles = Number.isFinite(Number(sourceConfig.maxFollowUpCycles))
        ? Math.max(1, Math.min(8, Math.floor(Number(sourceConfig.maxFollowUpCycles))))
        : 2;
      config.fields = normalizeDataRequestFields(sourceConfig.fields);
      const rejectNextTaskIds = normalizeTaskReferenceIds(
        sourceConfig.rejectNextTaskIds ?? sourceConfig.rejectNextTaskId ?? sourceConfig.onReject,
        stepCount,
        titleToIndex
      );
      config.rejectNextTaskIds = rejectNextTaskIds;
      if (rejectNextTaskIds.length > 0) {
        config.rejectNextTaskId = rejectNextTaskIds[0];
      }
      config.nextTaskIds = nextTaskIds;
    } else if (type === 'IMAGE_TO_TEXT_ANALYSIS') {
      const modeRaw = String(sourceConfig.mode || sourceConfig.runMode || '').trim().toLowerCase();
      const confidenceThreshold = Number(sourceConfig.confidenceThreshold);
      config.mode = modeRaw === 'below_confidence' ? 'below_confidence' : 'always';
      config.runMode = config.mode;
      config.confidenceThreshold = Number.isFinite(confidenceThreshold)
        ? Math.max(0, Math.min(1, confidenceThreshold))
        : 0.75;
      config.confidenceVariableKey = sourceConfig.confidenceVariableKey
        ? String(sourceConfig.confidenceVariableKey).trim()
        : 'classification.overallConfidence';
      config.onlyMissing = sourceConfig.onlyMissing !== false;
      config.overwriteExisting = sourceConfig.overwriteExisting === true;
      config.failOnError = sourceConfig.failOnError === true;
      config.addAiComment = sourceConfig.addAiComment !== false;
      config.aiCommentVisibility = sourceConfig.aiCommentVisibility === 'public' ? 'public' : 'internal';
      config.includeDescription = sourceConfig.includeDescription !== false;
      config.includeOsmData = sourceConfig.includeOsmData === true;
      config.includeWeatherData = sourceConfig.includeWeatherData === true;
      config.modelId = sourceConfig.modelId ? String(sourceConfig.modelId).trim() : '';
      config.connectionId = sourceConfig.connectionId ? String(sourceConfig.connectionId).trim() : '';
      config.nextTaskIds = nextTaskIds;
    } else if (type === 'RESPONSIBILITY_CHECK') {
      config.applyToTicket = sourceConfig.applyToTicket !== false;
      config.addAiComment = sourceConfig.addAiComment !== false;
      config.aiCommentVisibility = sourceConfig.aiCommentVisibility === 'public' ? 'public' : 'internal';
      config.nextTaskIds = nextTaskIds;
    } else if (type === 'CATEGORIZATION') {
      config.startCategoryWorkflow = sourceConfig.startCategoryWorkflow !== false;
      config.endCurrentWorkflow = sourceConfig.endCurrentWorkflow !== false;
      config.addAiComment = sourceConfig.addAiComment !== false;
      config.aiCommentVisibility = sourceConfig.aiCommentVisibility === 'public' ? 'public' : 'internal';
      config.allowSameTemplateSwitch = sourceConfig.allowSameTemplateSwitch === true;
      config.enableOrgUnitAssignment = sourceConfig.enableOrgUnitAssignment === true;
      config.orgAssignmentFallbackOrgUnitId = sourceConfig.orgAssignmentFallbackOrgUnitId
        ? String(sourceConfig.orgAssignmentFallbackOrgUnitId)
        : sourceConfig.fallbackOrgUnitId
        ? String(sourceConfig.fallbackOrgUnitId)
        : '';
      config.fallbackTemplateId = sourceConfig.fallbackTemplateId
        ? String(sourceConfig.fallbackTemplateId)
        : 'standard-redmine-ticket';
      config.nextTaskIds = nextTaskIds;
    } else if (type === 'EMAIL' || type === 'EMAIL_EXTERNAL') {
      config.templateId = String(sourceConfig.templateId || 'external-notification');
      config.recipientEmail = sourceConfig.recipientEmail ? String(sourceConfig.recipientEmail) : '';
      config.recipientName = sourceConfig.recipientName ? String(sourceConfig.recipientName) : '';
      config.recipientEmailSource = normalizeWorkflowRecipientEmailSource(sourceConfig.recipientEmailSource);
      config.recipientOrgUnitId = sourceConfig.recipientOrgUnitId ? String(sourceConfig.recipientOrgUnitId) : '';
    } else if (type === 'CITIZEN_NOTIFICATION') {
      config.templateId = String(sourceConfig.templateId || 'citizen-workflow-notification');
      config.customMessage = sourceConfig.customMessage ? String(sourceConfig.customMessage) : '';
    } else if (type === 'JOIN') {
      const requiredArrivals = Number(sourceConfig.requiredArrivals);
      config.requiredArrivals = Number.isFinite(requiredArrivals) && requiredArrivals > 0 ? Math.floor(requiredArrivals) : 2;
      config.nextTaskIds = nextTaskIds;
    } else if (type === 'CHANGE_WORKFLOW') {
      config.selectionMode = String(sourceConfig.selectionMode || '').trim().toLowerCase() === 'manual' ? 'manual' : 'ai';
      config.templateId = sourceConfig.templateId ? String(sourceConfig.templateId) : '';
      config.nextTaskIds = nextTaskIds;
    } else if (type === 'SUB_WORKFLOW') {
      config.selectionMode = String(sourceConfig.selectionMode || '').trim().toLowerCase() === 'manual' ? 'manual' : 'ai';
      config.templateId = sourceConfig.templateId ? String(sourceConfig.templateId) : '';
      config.fallbackTemplateId = sourceConfig.fallbackTemplateId ? String(sourceConfig.fallbackTemplateId) : '';
      config.allowSameTemplate = sourceConfig.allowSameTemplate === true;
      config.reuseActiveChild = sourceConfig.reuseActiveChild !== false;
      config.failOnChildFailure = sourceConfig.failOnChildFailure !== false;
      config.nextTaskIds = nextTaskIds;
    } else if (type === 'REST_API_CALL') {
      const timeoutMs = Number(sourceConfig.timeoutMs);
      const requestTimeoutMs = Number(sourceConfig.requestTimeoutMs);
      config.timeoutMs = Number.isFinite(timeoutMs) ? Math.max(1000, timeoutMs) : 20000;
      config.requestTimeoutMs = Number.isFinite(requestTimeoutMs) ? Math.max(500, requestTimeoutMs) : 15000;
      config.continueOnError = normalizeWorkflowBoolean(sourceConfig.continueOnError, false);
      config.baseUrl = sourceConfig.baseUrl ? String(sourceConfig.baseUrl) : '';
      config.sourceCode = sourceConfig.sourceCode ? String(sourceConfig.sourceCode) : '';
      config.nextTaskIds = nextTaskIds;
    } else {
      config.nextTaskIds = nextTaskIds;
    }

    return {
      title: String(step.title || fallbackTitle).trim() || fallbackTitle,
      type,
      config,
      auto: type === 'JOIN' ? true : normalizeWorkflowBoolean(step.auto, true),
    };
  });

  normalized.executionMode = normalizeWorkflowExecutionMode(options.executionMode || normalized.executionMode || fallbackMode);
  normalized.autoTriggerOnEmailVerified = normalizeWorkflowBoolean(
    options.autoTriggerOnEmailVerified,
    normalized.autoTriggerOnEmailVerified === true
  );
  normalized.enabled = normalizeWorkflowBoolean(options.enabled, normalized.enabled !== false);
  normalized.runtime = normalizeRuntimeConfig(
    (rawTemplate as any)?.runtime || normalized.runtime || (options as any).runtime,
    DEFAULT_WORKFLOW_RUNTIME
  );
  normalized.name = String(normalized.name || options.nameHint || 'Neuer KI-Workflow').trim() || 'Neuer KI-Workflow';
  normalized.description = String(normalized.description || options.descriptionHint || '').trim();
  normalized.updatedAt = new Date().toISOString();

  return normalized;
}

function extractGeneratedWorkflowTemplateCandidate(input: any): any | null {
  const candidates = extractImportedWorkflowTemplates(input);
  if (candidates.length > 0) return candidates[0];
  if (!input || typeof input !== 'object') return null;
  if (input.workflowTemplate && typeof input.workflowTemplate === 'object') return input.workflowTemplate;
  if (input.generatedTemplate && typeof input.generatedTemplate === 'object') return input.generatedTemplate;
  if (Array.isArray(input.steps)) return input;
  return null;
}

function buildWorkflowTemplateGenerationPrompt(input: {
  userPrompt: string;
  nameHint?: string;
  descriptionHint?: string;
  executionMode: WorkflowExecutionMode;
  autoTriggerOnEmailVerified: boolean;
  enabled: boolean;
  maxSteps: number;
}): string {
  const hintName = input.nameHint?.trim() || 'KI-Workflow';
  const hintDescription = input.descriptionHint?.trim() || '–';
  const stepTypes = Array.from(WORKFLOW_STEP_TYPES).join(', ');
  const statusOptions = Array.from(TICKET_STATUS_OPTIONS).join(', ');
  return `WORKFLOW-GENERIERUNGSKONTEXT

Nutzerwunsch:
${input.userPrompt}

Rahmendaten:
- nameHint: ${hintName}
- descriptionHint: ${hintDescription}
- executionMode: ${input.executionMode}
- autoTriggerOnEmailVerified: ${input.autoTriggerOnEmailVerified}
- enabled: ${input.enabled}
- maxSteps: ${input.maxSteps}

MUSS-OUTPUT:
- Gib AUSSCHLIESSLICH JSON zwischen BEGIN_JSON und END_JSON aus.
- Oberstes JSON-Objekt: {"template":{...}}
- Kein Markdown, kein Text ausserhalb von BEGIN_JSON/END_JSON.

Schema:
{
  "template": {
    "id": "template-ai-...",
    "name": "string",
    "description": "string",
    "executionMode": "MANUAL|AUTO|HYBRID",
    "autoTriggerOnEmailVerified": true|false,
    "enabled": true|false,
    "steps": [
      {
        "title": "string",
        "type": "SCHRITT_TYP",
        "auto": true|false,
        "config": { ... }
      }
    ]
  }
}

Regel-Referenz:
- Erlaubte Schritttypen: ${stepTypes}
- Ticketstatuswerte: ${statusOptions}
- Task-Referenzen nur als task-<index>, z. B. task-0.
- Nur auf existierende Task-Indizes verweisen.
- Keine Endlosschleifen ohne explizite Warte-/Freigabebedingung.
- END beendet je nach config.scope entweder branch oder workflow.

Spezialregeln je Typ:
- EMAIL_CONFIRMATION:
  config.recipientType ("citizen"|"custom"), bei custom zusaetzlich recipientEmailSource
  ("manual"|"org_unit"|"ticket_primary_assignee"|"ticket_collaborators"),
  templateId, instructionText oder instructionAiPrompt,
  nextTaskIds fuer Zustimmung, rejectNextTaskIds (oder rejectNextTaskId) fuer Ablehnung.
- EMAIL_DOUBLE_OPT_IN:
  wie EMAIL_CONFIRMATION, aber fuer Intake-Freigabe nutzbar; Timeout standardmaessig Ablehnungspfad.
- MAYOR_INVOLVEMENT:
  bindet den zustaendigen Ortsbuergermeister ein.
  config.mode ("notify"|"approval"), templateId, approvalQuestion.
  Bei mode=approval gilt: nextTaskIds fuer Zustimmung und rejectNextTaskIds fuer Ablehnung/Abbruch.
- DATENNACHFORDERUNG:
  config.templateId (z. B. workflow-data-request),
  recipientType ("citizen"|"custom"), bei custom optional recipientEmailSource
  ("manual"|"org_unit"|"ticket_primary_assignee"|"ticket_collaborators"),
  config.fields[] (key,label,type,required,options), parallelMode true|false, timeoutHours oder timeoutMinutes,
  rejectNextTaskIds fuer Timeout/Ablehnungspfad.
- ENHANCED_CATEGORIZATION:
  KI-basierte Datennachforderung, nutzt dasselbe Variablenmodell wie DATENNACHFORDERUNG.
  Optional: enableNeedCheck/needCheckPrompt fuer Vorpruefung, enableRecategorization fuer spaete Ticket-Patches,
  maxQuestionsPerCycle (1..25), allowFollowUpCycles (true|false), maxFollowUpCycles (>=1).
- FREE_AI_DATA_REQUEST:
  Freie KI-Datennachforderung fuer universelle Datenerhebung.
  Nutzt das gleiche Variablenmodell wie DATENNACHFORDERUNG, plus collectionObjective
  (fachliches Ziel, z. B. OWiG-Taeterdaten), questionPrompt/needCheckPrompt/answerEvaluationPrompt optional,
  maxQuestionsPerCycle (1..25), allowFollowUpCycles (true|false), maxFollowUpCycles (>=1),
  sowie needCheckConfidenceThreshold (0..1) fuer den Vorpruefungs-Schwellwert.
- IMAGE_TO_TEXT_ANALYSIS:
  Analysiert Ticket-Bilder zu Text. Modus ueber mode ("always"|"below_confidence"),
  bei below_confidence mit confidenceThreshold (0..1) und optional confidenceVariableKey.
  onlyMissing true|false steuert Wiederverwendung vorhandener Beschreibungen.
  includeDescription/includeOsmData/includeWeatherData steuern optionale Prompt-Kontextmodule.
- RESPONSIBILITY_CHECK:
  prueft die zustaendige Verwaltungsebene (z. B. Ortsgemeinde/Verbandsgemeinde/Landkreis/Landesbehoerde)
  auf Basis von Ticket-, Kategorie- und OSM-Kontext.
  config.applyToTicket true|false, addAiComment true|false, aiCommentVisibility.
- CATEGORIZATION:
  Normale KI-Klassifizierung fuer Kategorie/Prioritaet; startet danach den zur Kategorie zugeordneten Workflow
  und beendet den aktuellen Intake-Workflow (endScope=workflow).
  Optional: enableOrgUnitAssignment=true fuer Primaerzuweisung auf Org-Einheit im Ticket-Mandanten,
  orgAssignmentFallbackOrgUnitId fuer deterministischen Fallback.
- IF:
  config.conditions (Array), trueNextTaskIds und falseNextTaskIds nutzen.
  Bedingungen koennen kind "field", "geofence" oder "process_variable" sein.
  Fuer field "responsibilityAuthority" nur equals/not_equals/is_empty/is_not_empty verwenden.
- SPLIT:
  Parallele Verzweigung ueber leftNextTaskId/rightNextTaskId oder nextTaskIds.
- JOIN:
  config.requiredArrivals > 0.
- REDMINE_TICKET:
  assigneeMode nur "ai"|"fixed"|"none"; noAssignee bei "none" sinnvoll setzen.
- INTERNAL_PROCESSING:
  Interne Aufgaben fuer Sachbearbeitung.
  mode: "blocking" (wartet auf Abschluss) oder "parallel" (Workflow laeuft weiter),
  assigneeStrategy: "ticket_primary"|"fixed_user"|"fixed_org"|"process_variable",
  optional assigneeUserId/assigneeOrgUnitId/assigneeProcessVariableKey,
  formSchema.fields[] mit Feldtypen text|textarea|boolean|select|date|number,
  processVarMappings fuer Rueckgabe in Prozessvariablen, optional onComplete/onReject.

Qualitaet:
- Moeglichst konkrete Titel je Schritt.
- Kleine, klare, wartbare Schrittfolgen.
- Maximal ${input.maxSteps} Schritte verwenden.`;
}

async function buildWorkflowJsonRepairPrompt(raw: string): Promise<string> {
  const promptBase = await getSystemPrompt('workflowJsonRepairPrompt');
  return `${promptBase}

Reparaturauftrag:
- Stelle valides JSON zwischen BEGIN_JSON und END_JSON her.
- Oberstes Objekt bleibt {"template":{...}}.
- Entferne Kommentare/Markdown, normalisiere task-Referenzen.
- Erfinde keine fachlichen Inhalte, nur strukturell reparieren.

Defekte Eingabe:
${raw}`;
}

// GET /api/admin/config/workflow/templates/export - Export templates as JSON
router.get(
  '/api/admin/config/workflow/templates/export',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response) => {
    try {
      const selection = parseWorkflowTemplateLibrarySelection(req);
      await ensureWorkflowTemplateLibraryAccess(req, selection);
      const config = await loadWorkflowConfig();
      const templates = await listWorkflowTemplates({
        scope: selection.scope,
        tenantId: selection.tenantId,
        includeInherited: selection.scope === 'tenant' ? selection.includeInherited : true,
      });
      return res.json({
        version: 1,
        dtpn: DTPN_NOTATION_META,
        exportedAt: new Date().toISOString(),
        scope: selection.scope,
        tenantId: selection.tenantId,
        workflowConfig: {
          defaultExecutionMode: config.defaultExecutionMode,
          autoTriggerOnEmailVerified: config.autoTriggerOnEmailVerified,
          maxStepsPerWorkflow: config.maxStepsPerWorkflow,
          enabled: config.enabled,
          runtimeDefaults: normalizeRuntimeConfig(config.runtimeDefaults || DEFAULT_WORKFLOW_RUNTIME),
        },
        templates,
      });
    } catch (err: any) {
      return res.status(Number(err?.status || 500)).json({
        message: err?.message || 'Fehler beim Export der Workflows',
        error: err?.message || String(err),
      });
    }
  }
);

// POST /api/admin/config/workflow/templates/import - Import templates from JSON
router.post(
  '/api/admin/config/workflow/templates/import',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const selection = parseWorkflowTemplateLibrarySelection(req);
      await ensureWorkflowTemplateLibraryAccess(req, selection);
      const config = await loadWorkflowConfig();
      const mode = String(req.body?.mode || 'merge').toLowerCase() === 'replace' ? 'replace' : 'merge';
      const importedRuntimeDefaults =
        req.body?.workflowConfig?.runtimeDefaults || req.body?.runtimeDefaults || null;
      if (selection.scope === 'platform' && importedRuntimeDefaults && typeof importedRuntimeDefaults === 'object') {
        config.runtimeDefaults = normalizeRuntimeConfig(
          importedRuntimeDefaults,
          normalizeRuntimeConfig(config.runtimeDefaults || DEFAULT_WORKFLOW_RUNTIME)
        );
      }
      const rawTemplates = extractImportedWorkflowTemplates(req.body);
      if (rawTemplates.length === 0) {
        return res.status(400).json({ message: 'Import enthält keine Workflow-Vorlagen.' });
      }

      const importedMap = new Map<string, WorkflowTemplate>();
      rawTemplates.forEach((rawTemplate: any, index: number) => {
        const fallbackId = `template-import-${Date.now()}-${index + 1}`;
        const normalized = normalizeImportedWorkflowTemplate(
          rawTemplate,
          fallbackId,
          config.defaultExecutionMode || 'MANUAL'
        );
        if (!normalized) return;
        normalized.runtime = normalizeRuntimeConfig(
          normalized.runtime,
          normalizeRuntimeConfig(config.runtimeDefaults || DEFAULT_WORKFLOW_RUNTIME)
        );
        let candidateId = normalized.id || fallbackId;
        let suffix = 2;
        while (importedMap.has(candidateId)) {
          candidateId = `${normalized.id}-${suffix}`;
          suffix += 1;
        }
        normalized.id = candidateId;
        importedMap.set(candidateId, normalized);
      });

      const importedTemplates = Array.from(importedMap.values());
      if (importedTemplates.length === 0) {
        return res.status(400).json({ message: 'Keine gültigen Workflow-Vorlagen im Import gefunden.' });
      }

      let created = 0;
      let updated = 0;
      const now = new Date().toISOString();
      if (mode === 'replace') {
        await replaceWorkflowTemplates(
          importedTemplates.map((template) => ({
            ...template,
            createdAt: template.createdAt || now,
            updatedAt: now,
          })),
          selection.scope === 'tenant'
            ? { scope: 'tenant', tenantId: selection.tenantId }
            : { scope: 'platform' }
        );
        created = importedTemplates.length;
      } else {
        const existingTemplates = await listWorkflowTemplates({
          scope: selection.scope,
          tenantId: selection.tenantId,
          includeInherited: selection.scope === 'tenant' ? selection.includeInherited : true,
        });
        const existingById = new Map(
          (existingTemplates || []).map((template: any) => [String(template?.id || ''), template])
        );
        for (const template of importedTemplates) {
          const existing = existingById.get(String(template.id));
          const savedTemplate = {
            ...template,
            id: existing?.id || template.id,
            createdAt: existing?.createdAt || template.createdAt || now,
            updatedAt: now,
          };
          await upsertWorkflowTemplate(
            savedTemplate,
            selection.scope === 'tenant'
              ? { scope: 'tenant', tenantId: selection.tenantId }
              : { scope: 'platform' }
          );
          if (existing) updated += 1;
          else created += 1;
        }
      }

      const refreshedTemplates = await listWorkflowTemplates({
        scope: selection.scope,
        tenantId: selection.tenantId,
        includeInherited: selection.scope === 'tenant' ? selection.includeInherited : true,
      });
      if (selection.scope === 'platform') {
        config.templates = refreshedTemplates;
        await setSetting('workflowConfig', config);
      }

      return res.json({
        message: `Import abgeschlossen (${mode}).`,
        mode,
        scope: selection.scope,
        tenantId: selection.tenantId,
        imported: importedTemplates.length,
        created,
        updated,
        merged: updated,
        totalTemplates: refreshedTemplates.length,
      });
    } catch (err: any) {
      return res.status(Number(err?.status || 500)).json({
        message: err?.message || 'Fehler beim Import der Workflows',
        error: err?.message || String(err),
      });
    }
  }
);

// POST /api/admin/config/workflow/templates/generate - Generate workflow template draft via AI
router.post(
  '/api/admin/config/workflow/templates/generate',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt || prompt.length < 8) {
        return res.status(400).json({ message: 'Bitte einen aussagekräftigen Prompt angeben.' });
      }

      const config = await loadWorkflowConfig();
      const nameHint = typeof req.body?.nameHint === 'string' ? req.body.nameHint.trim() : '';
      const descriptionHint =
        typeof req.body?.descriptionHint === 'string' ? req.body.descriptionHint.trim() : '';
      const executionMode = normalizeWorkflowExecutionMode(
        req.body?.executionMode || config.defaultExecutionMode || 'MANUAL'
      );
      const autoTriggerOnEmailVerified = req.body?.autoTriggerOnEmailVerified === true;
      const enabled = req.body?.enabled !== false;
      const maxStepsRaw = Number(req.body?.maxSteps ?? config.maxStepsPerWorkflow);
      const maxSteps = Number.isFinite(maxStepsRaw) ? Math.max(3, Math.floor(maxStepsRaw)) : 30;

      const generationPromptContext = buildWorkflowTemplateGenerationPrompt({
        userPrompt: prompt,
        nameHint,
        descriptionHint,
        executionMode,
        autoTriggerOnEmailVerified,
        enabled,
        maxSteps,
      });
      const generationPromptBase = await getSystemPrompt('workflowTemplateGenerationPrompt');
      const generationPrompt = `${generationPromptBase}\n\n${generationPromptContext}`;

      let aiResponse = '';
      let parsedPayload: any = null;
      try {
        aiResponse = await testAIProvider(generationPrompt, {
          purpose: 'workflow_template_generate',
          taskKey: 'workflow_template_generation',
          meta: {
            source: 'routes.workflows.generate',
            stage: 'initial',
          },
        });
        parsedPayload = extractJsonPayload(aiResponse);
      } catch (parseError) {
        if (!aiResponse) throw parseError;
        try {
          const repairPrompt = await buildWorkflowJsonRepairPrompt(aiResponse);
          const repaired = await testAIProvider(repairPrompt, {
            purpose: 'workflow_template_generate',
            taskKey: 'workflow_json_repair',
            meta: {
              source: 'routes.workflows.generate',
              stage: 'repair_json',
            },
          });
          parsedPayload = extractJsonPayload(repaired);
        } catch (repairError: any) {
          return res.status(422).json({
            message: 'KI-Antwort konnte nicht in gültiges Workflow-JSON umgewandelt werden.',
            error: repairError?.message || 'Ungültige KI-Antwort',
          });
        }
      }

      const rawTemplate = extractGeneratedWorkflowTemplateCandidate(parsedPayload);
      if (!rawTemplate) {
        return res.status(422).json({
          message: 'KI-Antwort enthält keine gültige Workflow-Vorlage.',
        });
      }

      const generated = normalizeGeneratedWorkflowTemplate(
        rawTemplate,
        `template-ai-${Date.now()}`,
        executionMode,
        {
          nameHint,
          descriptionHint,
          executionMode,
          autoTriggerOnEmailVerified,
          enabled,
          maxSteps,
        }
      );

      if (!generated) {
        return res.status(422).json({
          message: 'KI-Workflow konnte nicht normalisiert werden. Bitte Prompt präzisieren.',
        });
      }

      return res.json({
        version: 1,
        dtpn: DTPN_NOTATION_META,
        template: generated,
      });
    } catch (err: any) {
      return res.status(500).json({
        message: 'Fehler beim KI-basierten Generieren des Workflows',
        error: err?.message || String(err),
      });
    }
  }
);

// GET /api/admin/config/workflow/templates - List templates
router.get('/api/admin/config/workflow/templates', authMiddleware, staffOnly, async (req: Request, res: Response) => {
  try {
    const selection = parseWorkflowTemplateLibrarySelection(req);
    await ensureWorkflowTemplateLibraryAccess(req, selection);
    const templates = await listWorkflowTemplates({
      scope: selection.scope,
      tenantId: selection.tenantId,
      includeInherited: selection.scope === 'tenant' ? selection.includeInherited : true,
    });
    res.json(templates);
  } catch (err: any) {
    res.status(Number(err?.status || 500)).json({
      message: err?.message || 'Fehler beim Laden der Workflows',
      error: err?.message || String(err),
    });
  }
});

// POST /api/admin/config/workflow/templates - Create template
router.post('/api/admin/config/workflow/templates', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const selection = parseWorkflowTemplateLibrarySelection(req);
    await ensureWorkflowTemplateLibraryAccess(req, selection);
    const config = await loadWorkflowConfig();
    const runtimeFallback = normalizeRuntimeConfig(config.runtimeDefaults || DEFAULT_WORKFLOW_RUNTIME);
    const template: WorkflowTemplate = {
      id: `template-${Date.now()}`,
      name: req.body.name || 'Neuer Workflow',
      description: req.body.description || '',
      steps: req.body.steps || [],
      executionMode: req.body.executionMode || config.defaultExecutionMode || 'MANUAL',
      autoTriggerOnEmailVerified: !!req.body.autoTriggerOnEmailVerified,
      enabled: req.body.enabled !== false,
      runtime: normalizeRuntimeConfig(req.body?.runtime, runtimeFallback),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await upsertWorkflowTemplate(
      template,
      selection.scope === 'tenant'
        ? { scope: 'tenant', tenantId: selection.tenantId }
        : { scope: 'platform' }
    );
    if (selection.scope === 'platform') {
      config.templates = await listWorkflowTemplates({ scope: 'platform', includeInherited: true });
      await setSetting('workflowConfig', config);
    }
    res.status(201).json(template);
  } catch (err: any) {
    res.status(Number(err?.status || 500)).json({
      message: err?.message || 'Fehler beim Erstellen des Workflows',
      error: err?.message || String(err),
    });
  }
});

// PUT /api/admin/config/workflow/templates/:id - Update template
router.put('/api/admin/config/workflow/templates/:id', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const selection = parseWorkflowTemplateLibrarySelection(req);
    await ensureWorkflowTemplateLibraryAccess(req, selection);
    const config = await loadWorkflowConfig();
    const { id } = req.params;
    const scopedTemplates = await listWorkflowTemplates({
      scope: selection.scope,
      tenantId: selection.tenantId,
      includeInherited: false,
    });
    const templateIndex = scopedTemplates.findIndex((t: any) => t.id === id);

    if (templateIndex === -1) {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }

    const template = scopedTemplates[templateIndex] as WorkflowTemplate;
    const runtimeFallback = normalizeRuntimeConfig(config.runtimeDefaults || DEFAULT_WORKFLOW_RUNTIME);
    template.name = req.body.name || template.name;
    template.description = req.body.description || template.description;
    template.steps = req.body.steps || template.steps;
    if (req.body.executionMode) {
      template.executionMode = req.body.executionMode;
    }
    if (req.body.autoTriggerOnEmailVerified !== undefined) {
      template.autoTriggerOnEmailVerified = !!req.body.autoTriggerOnEmailVerified;
    }
    template.enabled = req.body.enabled !== false;
    if (req.body.runtime !== undefined) {
      template.runtime = normalizeRuntimeConfig(req.body.runtime, runtimeFallback);
    } else if (!template.runtime) {
      template.runtime = normalizeRuntimeConfig(undefined, runtimeFallback);
    }
    template.updatedAt = new Date().toISOString();

    await upsertWorkflowTemplate(
      template,
      selection.scope === 'tenant'
        ? { scope: 'tenant', tenantId: selection.tenantId }
        : { scope: 'platform' }
    );
    if (selection.scope === 'platform') {
      config.templates = await listWorkflowTemplates({ scope: 'platform', includeInherited: true });
      await setSetting('workflowConfig', config);
    }
    res.json(template);
  } catch (err: any) {
    res.status(Number(err?.status || 500)).json({
      message: err?.message || 'Fehler beim Aktualisieren des Workflows',
      error: err?.message || String(err),
    });
  }
});

// DELETE /api/admin/config/workflow/templates/:id - Delete template
router.delete('/api/admin/config/workflow/templates/:id', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const selection = parseWorkflowTemplateLibrarySelection(req);
    await ensureWorkflowTemplateLibraryAccess(req, selection);
    const config = await loadWorkflowConfig();
    const { id } = req.params;

    // Prevent deletion of standard template
    if (id === 'standard-redmine-ticket' || id === 'standard-intake-workflow') {
      return res.status(400).json({ message: 'Standard-Workflow kann nicht gelöscht werden' });
    }

    await deleteWorkflowTemplate(
      id,
      selection.scope === 'tenant'
        ? { scope: 'tenant', tenantId: selection.tenantId }
        : { scope: 'platform' }
    );
    if (selection.scope === 'platform') {
      config.templates = await listWorkflowTemplates({ scope: 'platform', includeInherited: true });
      await setSetting('workflowConfig', config);
    }
    res.json({ message: 'Workflow gelöscht' });
  } catch (err: any) {
    res.status(Number(err?.status || 500)).json({
      message: err?.message || 'Fehler beim Löschen des Workflows',
      error: err?.message || String(err),
    });
  }
});

// GET /api/admin/internal-tasks - List internal processing tasks
router.get('/api/admin/internal-tasks', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const db = getDatabase();
    const userId = asTrimmedString((req as any).userId);
    const role = asTrimmedString((req as any).role);
    const access = await loadAdminAccessContext(userId, role);
    const visibility = buildTicketVisibilitySql(access, { tableAlias: 't', requireWrite: false });
    const statusFilterRaw = asTrimmedString(req.query?.status).toLowerCase();
    const statusFilterValues = statusFilterRaw
      ? statusFilterRaw
          .split(',')
          .map((value) => normalizeInternalTaskStatus(value))
          .filter((value, index, self) => self.indexOf(value) === index)
      : [];
    const tenantIdFilter = asTrimmedString(req.query?.tenantId || req.query?.tenant_id);
    const assignmentFilter = asTrimmedString(req.query?.assignment).toLowerCase();
    const limitRaw = Number(req.query?.limit);
    const offsetRaw = Number(req.query?.offset);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    let sql = `
      SELECT it.*,
             t.status AS ticket_status,
             t.category AS ticket_category,
             t.priority AS ticket_priority
      FROM workflow_internal_tasks it
      JOIN tickets t ON t.id = it.ticket_id
      WHERE (${visibility.sql})
    `;
    const params: any[] = [...visibility.params];

    if (statusFilterValues.length > 0) {
      sql += ` AND it.status IN (${statusFilterValues.map(() => '?').join(', ')})`;
      params.push(...statusFilterValues);
    }
    if (tenantIdFilter) {
      sql += ` AND it.tenant_id = ?`;
      params.push(tenantIdFilter);
    }
    if (assignmentFilter === 'me') {
      const orgIds = access.readableOrgUnitIds || [];
      if (orgIds.length > 0) {
        sql += ` AND (
          it.assignee_user_id = ?
          OR it.assignee_org_unit_id IN (${orgIds.map(() => '?').join(', ')})
        )`;
        params.push(userId, ...orgIds);
      } else {
        sql += ` AND it.assignee_user_id = ?`;
        params.push(userId);
      }
    } else if (assignmentFilter === 'my_units') {
      const orgIds = access.readableOrgUnitIds || [];
      if (orgIds.length === 0) {
        sql += ` AND 1 = 0`;
      } else {
        sql += ` AND it.assignee_org_unit_id IN (${orgIds.map(() => '?').join(', ')})`;
        params.push(...orgIds);
      }
    } else if (assignmentFilter === 'unassigned') {
      sql += ` AND it.assignee_user_id IS NULL AND it.assignee_org_unit_id IS NULL`;
    } else if (assignmentFilter.startsWith('user:')) {
      const assigneeUserId = asTrimmedString(assignmentFilter.slice('user:'.length));
      if (assigneeUserId) {
        sql += ` AND it.assignee_user_id = ?`;
        params.push(assigneeUserId);
      }
    } else if (assignmentFilter.startsWith('org:')) {
      const assigneeOrgId = asTrimmedString(assignmentFilter.slice('org:'.length));
      if (assigneeOrgId) {
        sql += ` AND it.assignee_org_unit_id = ?`;
        params.push(assigneeOrgId);
      }
    }

    const countRow = await db.get(
      `SELECT COUNT(*) AS total
       FROM (${sql}) base`,
      params
    );
    const total = Number(countRow?.total || 0);
    sql += ` ORDER BY
      CASE it.status
        WHEN 'pending' THEN 1
        WHEN 'in_progress' THEN 2
        WHEN 'rejected' THEN 3
        WHEN 'completed' THEN 4
        ELSE 5
      END,
      CASE WHEN it.due_at IS NULL THEN 1 ELSE 0 END,
      it.due_at ASC,
      it.created_at DESC
      LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.all(sql, params);
    return res.json({
      total,
      limit,
      offset,
      items: (rows || []).map((row: any) => mapInternalTaskRow(row)),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Fehler beim Laden interner Aufgaben.',
      error: error?.message || String(error),
    });
  }
});

// GET /api/admin/internal-tasks/:taskId - Detail including events
router.get(
  '/api/admin/internal-tasks/:taskId',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const taskId = asTrimmedString(req.params.taskId);
      if (!taskId) return res.status(400).json({ message: 'taskId fehlt.' });
      const db = getDatabase();
      const row = await db.get(
        `SELECT it.*,
                t.status AS ticket_status,
                t.category AS ticket_category,
                t.priority AS ticket_priority
         FROM workflow_internal_tasks it
         JOIN tickets t ON t.id = it.ticket_id
         WHERE it.id = ?
         LIMIT 1`,
        [taskId]
      );
      if (!row?.id) {
        return res.status(404).json({ message: 'Interne Aufgabe nicht gefunden.' });
      }

      const accessResult = await requireTicketAccess(
        asTrimmedString((req as any).userId),
        asTrimmedString((req as any).role),
        asTrimmedString(row.ticket_id),
        false
      );
      if (!accessResult.allowed) {
        return res.status(403).json({ message: 'Keine Berechtigung für diese interne Aufgabe.' });
      }

      const eventRows = await db.all(
        `SELECT id, task_id, event_type, actor_user_id, payload_json, created_at
         FROM workflow_internal_task_events
         WHERE task_id = ?
         ORDER BY created_at ASC`,
        [taskId]
      );
      const events = (eventRows || []).map((eventRow: any) => ({
        id: asTrimmedString(eventRow.id),
        taskId: asTrimmedString(eventRow.task_id),
        eventType: asTrimmedString(eventRow.event_type),
        actorUserId: asTrimmedString(eventRow.actor_user_id) || null,
        payload: parseJsonValue(eventRow.payload_json, null),
        createdAt: asTrimmedString(eventRow.created_at) || null,
      }));

      return res.json({
        task: mapInternalTaskRow(row),
        events,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: 'Fehler beim Laden der internen Aufgabe.',
        error: error?.message || String(error),
      });
    }
  }
);

// POST /api/admin/internal-tasks/:taskId/start - Set task to in_progress (optional self-claim)
router.post(
  '/api/admin/internal-tasks/:taskId/start',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const taskId = asTrimmedString(req.params.taskId);
      if (!taskId) return res.status(400).json({ message: 'taskId fehlt.' });
      const db = getDatabase();
      const row = await db.get(
        `SELECT *
         FROM workflow_internal_tasks
         WHERE id = ?
         LIMIT 1`,
        [taskId]
      );
      if (!row?.id) {
        return res.status(404).json({ message: 'Interne Aufgabe nicht gefunden.' });
      }

      const accessResult = await requireTicketAccess(
        asTrimmedString((req as any).userId),
        asTrimmedString((req as any).role),
        asTrimmedString(row.ticket_id),
        true
      );
      if (!accessResult.allowed) {
        return res.status(403).json({ message: 'Keine Berechtigung zum Starten.' });
      }

      const currentStatus = normalizeInternalTaskStatus(row.status);
      if (currentStatus === 'completed' || currentStatus === 'rejected' || currentStatus === 'cancelled') {
        return res.status(409).json({ message: 'Interne Aufgabe ist bereits abgeschlossen.' });
      }
      const actorUserId = asTrimmedString((req as any).userId);
      const claimSelfRaw = (req.body as any)?.claimSelf;
      const claimSelf =
        claimSelfRaw === true ||
        claimSelfRaw === 1 ||
        (typeof claimSelfRaw === 'string' &&
          ['1', 'true', 'yes', 'on'].includes(claimSelfRaw.trim().toLowerCase()));

      const previousAssigneeUserId = asTrimmedString(row.assignee_user_id) || null;
      const previousAssigneeOrgUnitId = asTrimmedString(row.assignee_org_unit_id) || null;
      const nextAssigneeUserId = claimSelf && actorUserId ? actorUserId : previousAssigneeUserId;
      const nextAssigneeOrgUnitId = claimSelf && actorUserId ? null : previousAssigneeOrgUnitId;
      const shouldUpdateStatus = currentStatus !== 'in_progress';
      const shouldUpdateAssignee =
        previousAssigneeUserId !== nextAssigneeUserId || previousAssigneeOrgUnitId !== nextAssigneeOrgUnitId;

      if (shouldUpdateStatus || shouldUpdateAssignee) {
        const updateResult = await db.run(
          `UPDATE workflow_internal_tasks
           SET status = 'in_progress',
               assignee_user_id = ?,
               assignee_org_unit_id = ?
           WHERE id = ?
             AND status IN ('pending', 'in_progress')`,
          [nextAssigneeUserId, nextAssigneeOrgUnitId, taskId]
        );
        if (!updateResult?.changes) {
          return res.status(409).json({ message: 'Interne Aufgabe wurde parallel verändert.' });
        }

        await insertInternalTaskEvent(db, {
          taskId,
          eventType: claimSelf && actorUserId ? 'claimed' : 'started',
          actorUserId,
          payload: {
            previousStatus: currentStatus,
            status: 'in_progress',
            previousAssigneeUserId,
            previousAssigneeOrgUnitId,
            assigneeUserId: nextAssigneeUserId,
            assigneeOrgUnitId: nextAssigneeOrgUnitId,
            claimSelf: claimSelf && !!actorUserId,
          },
        });

        await appendTicketComment({
          ticketId: asTrimmedString(row.ticket_id),
          executionId: asTrimmedString(row.workflow_execution_id) || null,
          taskId: asTrimmedString(row.step_id) || null,
          authorType: 'staff',
          authorId: actorUserId || null,
          visibility: 'internal',
          commentType: 'note',
          content: `${
            claimSelf && actorUserId
              ? 'Interne Aufgabe übernommen und gestartet'
              : 'Interne Aufgabe in Bearbeitung gesetzt'
          }: ${asTrimmedString(row.title) || asTrimmedString(row.id)}`,
          metadata: {
            source: 'admin.internal_task.start',
            internalTaskId: taskId,
            previousStatus: currentStatus,
            status: 'in_progress',
            previousAssigneeUserId,
            previousAssigneeOrgUnitId,
            assigneeUserId: nextAssigneeUserId,
            assigneeOrgUnitId: nextAssigneeOrgUnitId,
            claimSelf: claimSelf && !!actorUserId,
          },
        });

        const executions = loadExecutions();
        const execution = executions.find((entry) => entry.id === asTrimmedString(row.workflow_execution_id));
        const workflowTask = execution?.tasks.find((entry) => entry.id === asTrimmedString(row.step_id));
        if (execution && workflowTask) {
          workflowTask.executionData = {
            ...(workflowTask.executionData || {}),
            internalTaskStatus: 'in_progress',
            internalTaskAssigneeUserId: nextAssigneeUserId || undefined,
            internalTaskAssigneeOrgUnitId: nextAssigneeOrgUnitId || undefined,
          };
          saveExecutions(executions);
        }
      }

      const updatedRow = await db.get(
        `SELECT it.*,
                t.status AS ticket_status,
                t.category AS ticket_category,
                t.priority AS ticket_priority
         FROM workflow_internal_tasks it
         JOIN tickets t ON t.id = it.ticket_id
         WHERE it.id = ?
         LIMIT 1`,
        [taskId]
      );
      return res.json({
        task: mapInternalTaskRow(updatedRow),
        claimed: claimSelf && !!actorUserId,
        changed: shouldUpdateStatus || shouldUpdateAssignee,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: 'Fehler beim Starten der internen Aufgabe.',
        error: error?.message || String(error),
      });
    }
  }
);

// POST /api/admin/internal-tasks/:taskId/complete - Complete internal task and resume workflow if blocking
router.post(
  '/api/admin/internal-tasks/:taskId/complete',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const taskId = asTrimmedString(req.params.taskId);
      if (!taskId) return res.status(400).json({ message: 'taskId fehlt.' });
      const db = getDatabase();
      const row = await db.get(
        `SELECT *
         FROM workflow_internal_tasks
         WHERE id = ?
         LIMIT 1`,
        [taskId]
      );
      if (!row?.id) {
        return res.status(404).json({ message: 'Interne Aufgabe nicht gefunden.' });
      }

      const accessResult = await requireTicketAccess(
        asTrimmedString((req as any).userId),
        asTrimmedString((req as any).role),
        asTrimmedString(row.ticket_id),
        true
      );
      if (!accessResult.allowed) {
        return res.status(403).json({ message: 'Keine Berechtigung zum Abschließen.' });
      }
      const currentStatus = normalizeInternalTaskStatus(row.status);
      if (currentStatus === 'completed' || currentStatus === 'rejected' || currentStatus === 'cancelled') {
        return res.status(409).json({ message: 'Interne Aufgabe ist bereits abgeschlossen.' });
      }
      const allowReject = normalizeInternalTaskRejectAllowed(row.allow_reject, true);
      if (!allowReject) {
        return res.status(409).json({ message: 'Ablehnung ist für diese interne Aufgabe deaktiviert.' });
      }

      const actorUserId = asTrimmedString((req as any).userId);
      const note = asTrimmedString(req.body?.note || req.body?.comment);
      const responsePayload = normalizeInternalTaskResponsePayload(req.body?.response || req.body?.payload);
      const nowIso = new Date().toISOString();
      const updateResult = await db.run(
        `UPDATE workflow_internal_tasks
         SET status = 'completed',
             response_json = ?,
             completed_at = ?,
             completed_by = ?
         WHERE id = ?
           AND status IN ('pending', 'in_progress')`,
        [JSON.stringify(responsePayload), toSqlDateTime(nowIso), actorUserId || null, taskId]
      );
      if (!updateResult?.changes) {
        return res.status(409).json({ message: 'Interne Aufgabe wurde parallel verändert.' });
      }
      await insertInternalTaskEvent(db, {
        taskId,
        eventType: 'completed',
        actorUserId,
        payload: {
          note: note || null,
          response: responsePayload,
        },
      });

      const workflowResult = await applyInternalTaskDecisionToWorkflow({
        internalTaskRow: row,
        decision: 'completed',
        actorUserId,
        note,
        responsePayload,
      });

      const updatedRow = await db.get(
        `SELECT it.*,
                t.status AS ticket_status,
                t.category AS ticket_category,
                t.priority AS ticket_priority
         FROM workflow_internal_tasks it
         JOIN tickets t ON t.id = it.ticket_id
         WHERE it.id = ?
         LIMIT 1`,
        [taskId]
      );

      return res.json({
        task: mapInternalTaskRow(updatedRow),
        resumedWorkflow: workflowResult.resumedWorkflow,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: 'Fehler beim Abschließen der internen Aufgabe.',
        error: error?.message || String(error),
      });
    }
  }
);

// POST /api/admin/internal-tasks/:taskId/reject - Reject internal task and resume workflow if blocking
router.post(
  '/api/admin/internal-tasks/:taskId/reject',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const taskId = asTrimmedString(req.params.taskId);
      if (!taskId) return res.status(400).json({ message: 'taskId fehlt.' });
      const db = getDatabase();
      const row = await db.get(
        `SELECT *
         FROM workflow_internal_tasks
         WHERE id = ?
         LIMIT 1`,
        [taskId]
      );
      if (!row?.id) {
        return res.status(404).json({ message: 'Interne Aufgabe nicht gefunden.' });
      }

      const accessResult = await requireTicketAccess(
        asTrimmedString((req as any).userId),
        asTrimmedString((req as any).role),
        asTrimmedString(row.ticket_id),
        true
      );
      if (!accessResult.allowed) {
        return res.status(403).json({ message: 'Keine Berechtigung zum Ablehnen.' });
      }
      const currentStatus = normalizeInternalTaskStatus(row.status);
      if (currentStatus === 'completed' || currentStatus === 'rejected' || currentStatus === 'cancelled') {
        return res.status(409).json({ message: 'Interne Aufgabe ist bereits abgeschlossen.' });
      }
      const allowReject = normalizeInternalTaskRejectAllowed(row.allow_reject, true);
      if (!allowReject) {
        return res.status(409).json({ message: 'Ablehnung ist für diese interne Aufgabe deaktiviert.' });
      }

      const actorUserId = asTrimmedString((req as any).userId);
      const note = asTrimmedString(req.body?.note || req.body?.comment || req.body?.reason);
      const responsePayload = normalizeInternalTaskResponsePayload(req.body?.response || req.body?.payload);
      const nowIso = new Date().toISOString();
      const updateResult = await db.run(
        `UPDATE workflow_internal_tasks
         SET status = 'rejected',
             response_json = ?,
             completed_at = ?,
             completed_by = ?
         WHERE id = ?
           AND status IN ('pending', 'in_progress')`,
        [JSON.stringify(responsePayload), toSqlDateTime(nowIso), actorUserId || null, taskId]
      );
      if (!updateResult?.changes) {
        return res.status(409).json({ message: 'Interne Aufgabe wurde parallel verändert.' });
      }
      await insertInternalTaskEvent(db, {
        taskId,
        eventType: 'rejected',
        actorUserId,
        payload: {
          note: note || null,
          response: responsePayload,
        },
      });

      const workflowResult = await applyInternalTaskDecisionToWorkflow({
        internalTaskRow: row,
        decision: 'rejected',
        actorUserId,
        note,
        responsePayload,
      });
      const updatedRow = await db.get(
        `SELECT it.*,
                t.status AS ticket_status,
                t.category AS ticket_category,
                t.priority AS ticket_priority
         FROM workflow_internal_tasks it
         JOIN tickets t ON t.id = it.ticket_id
         WHERE it.id = ?
         LIMIT 1`,
        [taskId]
      );
      return res.json({
        task: mapInternalTaskRow(updatedRow),
        resumedWorkflow: workflowResult.resumedWorkflow,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: 'Fehler beim Ablehnen der internen Aufgabe.',
        error: error?.message || String(error),
      });
    }
  }
);

// POST /api/admin/internal-tasks/:taskId/reassign - Reassign internal task
router.post(
  '/api/admin/internal-tasks/:taskId/reassign',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const taskId = asTrimmedString(req.params.taskId);
      if (!taskId) return res.status(400).json({ message: 'taskId fehlt.' });
      const db = getDatabase();
      const row = await db.get(
        `SELECT *
         FROM workflow_internal_tasks
         WHERE id = ?
         LIMIT 1`,
        [taskId]
      );
      if (!row?.id) {
        return res.status(404).json({ message: 'Interne Aufgabe nicht gefunden.' });
      }
      const accessResult = await requireTicketAccess(
        asTrimmedString((req as any).userId),
        asTrimmedString((req as any).role),
        asTrimmedString(row.ticket_id),
        true
      );
      if (!accessResult.allowed) {
        return res.status(403).json({ message: 'Keine Berechtigung für Zuweisung.' });
      }
      const previousAssigneeUserId = asTrimmedString(row.assignee_user_id) || null;
      const previousAssigneeOrgUnitId = asTrimmedString(row.assignee_org_unit_id) || null;

      let assigneeUserId = asTrimmedString(req.body?.assigneeUserId || req.body?.assignee_user_id) || null;
      let assigneeOrgUnitId =
        asTrimmedString(req.body?.assigneeOrgUnitId || req.body?.assignee_org_unit_id) || null;
      if (assigneeUserId && assigneeOrgUnitId) {
        return res.status(400).json({ message: 'Nur assigneeUserId oder assigneeOrgUnitId zulässig.' });
      }
      if (assigneeUserId) {
        const userRow = await db.get(`SELECT id FROM admin_users WHERE id = ? LIMIT 1`, [assigneeUserId]);
        if (!userRow?.id) {
          return res.status(400).json({ message: 'assigneeUserId ist unbekannt.' });
        }
        assigneeOrgUnitId = null;
      }
      if (assigneeOrgUnitId) {
        const orgRow = await db.get(
          `SELECT id
           FROM org_units
           WHERE id = ? AND tenant_id = ?
           LIMIT 1`,
          [assigneeOrgUnitId, asTrimmedString(row.tenant_id) || 'tenant_default']
        );
        if (!orgRow?.id) {
          return res.status(400).json({ message: 'assigneeOrgUnitId ist im Mandanten nicht vorhanden.' });
        }
        assigneeUserId = null;
      }

      await db.run(
        `UPDATE workflow_internal_tasks
         SET assignee_user_id = ?,
             assignee_org_unit_id = ?
         WHERE id = ?`,
        [assigneeUserId, assigneeOrgUnitId, taskId]
      );
      await insertInternalTaskEvent(db, {
        taskId,
        eventType: 'reassigned',
        actorUserId: asTrimmedString((req as any).userId) || null,
        payload: {
          assigneeUserId,
          assigneeOrgUnitId,
        },
      });

      const executions = loadExecutions();
      const execution = executions.find((entry) => entry.id === asTrimmedString(row.workflow_execution_id));
      const workflowTask = execution?.tasks.find((entry) => entry.id === asTrimmedString(row.step_id));
      if (execution && workflowTask) {
        workflowTask.executionData = {
          ...(workflowTask.executionData || {}),
          internalTaskAssigneeUserId: assigneeUserId || undefined,
          internalTaskAssigneeOrgUnitId: assigneeOrgUnitId || undefined,
        };
        saveExecutions(executions);
      }

      const assignmentChanged =
        previousAssigneeUserId !== assigneeUserId || previousAssigneeOrgUnitId !== assigneeOrgUnitId;
      if (assignmentChanged && (assigneeUserId || assigneeOrgUnitId)) {
        void sendTicketAssignmentEmailNotifications({
          ticketId: asTrimmedString(row.ticket_id),
          actorUserId: asTrimmedString((req as any).userId) || null,
          context: 'internal_task_assignment',
          taskTitle: asTrimmedString(row.title) || asTrimmedString(row.id),
          internalTaskId: taskId,
          recipients: [
            ...(assigneeUserId
              ? [{ type: 'user' as const, id: assigneeUserId, roleLabel: 'Interne Aufgabe (neu zugewiesen)' }]
              : []),
            ...(assigneeOrgUnitId
              ? [
                  {
                    type: 'org_unit' as const,
                    id: assigneeOrgUnitId,
                    roleLabel: 'Interne Aufgabe (neu zugewiesen)',
                  },
                ]
              : []),
          ],
        }).catch((assignmentError) => {
          console.warn('Internal task reassignment email notifications failed:', assignmentError);
        });
      }

      const updatedRow = await db.get(
        `SELECT it.*,
                t.status AS ticket_status,
                t.category AS ticket_category,
                t.priority AS ticket_priority
         FROM workflow_internal_tasks it
         JOIN tickets t ON t.id = it.ticket_id
         WHERE it.id = ?
         LIMIT 1`,
        [taskId]
      );
      return res.json({
        task: mapInternalTaskRow(updatedRow),
      });
    } catch (error: any) {
      return res.status(500).json({
        message: 'Fehler beim Neuzuordnen der internen Aufgabe.',
        error: error?.message || String(error),
      });
    }
  }
);

// GET /api/admin/workflows - Get running workflows
router.get('/api/admin/workflows', authMiddleware, staffOnly, async (_req: Request, res: Response) => {
  try {
    const executions = loadExecutions();
    const config = await loadWorkflowConfig();
    executions.forEach((execution) => hydrateExecutionRuntimeMetadata(execution, config));
    res.json(executions);
  } catch (err: any) {
    res.status(500).json({ message: 'Fehler beim Laden der Workflows', error: err.message });
  }
});

// GET /api/admin/workflows/:id - Get workflow execution
router.get('/api/admin/workflows/:id', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const executions = loadExecutions();
    const execution = executions.find(e => e.id === req.params.id);

    if (!execution) {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }

    const config = await loadWorkflowConfig();
    hydrateExecutionRuntimeMetadata(execution, config);
    return res.json(execution);
  } catch (err: any) {
    return res.status(500).json({ message: 'Fehler beim Laden des Workflows', error: err.message });
  }
});

// POST /api/admin/workflows/:id/end - End workflow execution manually
router.post('/api/admin/workflows/:id/end', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const executions = loadExecutions();
    const execution = executions.find((entry) => entry.id === req.params.id);

    if (!execution) {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }

    if (execution.status === 'COMPLETED' || execution.status === 'FAILED') {
      return res.json(execution);
    }

    const reason = String(req.body?.reason || '').trim();
    const nowIso = new Date().toISOString();
    const skipReason = reason || 'Workflow wurde manuell beendet.';
    let skippedTasks = 0;

    for (const task of execution.tasks || []) {
      clearScheduledTask(execution.id, task.id);
      if (task.status === 'RUNNING' || task.status === 'PENDING') {
        task.executionData = {
          ...(task.executionData || {}),
          skippedByOperator: true,
          skipReason,
          skippedAt: nowIso,
          endedByOperator: true,
        };
        setTaskStatus(execution, task, 'SKIPPED', 'Task wegen manuellem Workflow-Ende übersprungen.');
        skippedTasks += 1;
      }
    }

    execution.activeTaskIds = [];
    syncCurrentTaskIndex(execution);
    execution.completedAt = nowIso;
    delete execution.error;
    setWorkflowStatus(execution, 'COMPLETED', 'Workflow wurde manuell beendet.');
    setBlockedReason(execution, 'none');
    appendWorkflowHistory(execution, 'WORKFLOW_COMPLETED', 'Workflow manuell durch Operator beendet.', {
      metadata: {
        reason: reason || null,
        skippedTasks,
        action: 'manual_end',
      },
    });

    try {
      const db = getDatabase();
      const openInternalTasks = await db.all(
        `SELECT id
         FROM workflow_internal_tasks
         WHERE workflow_execution_id = ?
           AND status IN ('pending', 'in_progress')`,
        [execution.id]
      );
      const actorUserId = asTrimmedString((req as any).userId);
      for (const row of openInternalTasks || []) {
        const internalTaskId = asTrimmedString((row as any)?.id);
        if (!internalTaskId) continue;
        await db.run(
          `UPDATE workflow_internal_tasks
           SET status = 'cancelled'
           WHERE id = ?`,
          [internalTaskId]
        );
        await insertInternalTaskEvent(db, {
          taskId: internalTaskId,
          eventType: 'cancelled',
          actorUserId: actorUserId || null,
          payload: {
            reason: skipReason,
            source: 'workflow_manual_end',
          },
        });
      }
    } catch {
      // internal task cleanup is best-effort
    }

    saveExecutions(executions);
    await triggerParentSubWorkflowResumes(executions, execution.id);
    return res.json(execution);
  } catch (err: any) {
    return res.status(500).json({ message: 'Fehler beim manuellen Beenden des Workflows', error: err.message });
  }
});

// DELETE /api/admin/workflows/:id - Delete workflow execution
router.delete('/api/admin/workflows/:id', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const executions = loadExecutions();
    const index = executions.findIndex(e => e.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }

    const execution = executions[index];
    for (const task of execution.tasks || []) {
      clearScheduledTask(execution.id, task.id);
    }

    executions.splice(index, 1);
    saveExecutions(executions);
    await triggerParentSubWorkflowResumes(executions, req.params.id);

    try {
      const db = getDatabase();
      await db.run('DELETE FROM workflow_validations WHERE execution_id = ?', [req.params.id]);
      const openInternalTasks = await db.all(
        `SELECT id
         FROM workflow_internal_tasks
         WHERE workflow_execution_id = ?
           AND status IN ('pending', 'in_progress')`,
        [req.params.id]
      );
      const actorUserId = asTrimmedString((req as any).userId);
      for (const row of openInternalTasks || []) {
        const internalTaskId = asTrimmedString((row as any)?.id);
        if (!internalTaskId) continue;
        await db.run(
          `UPDATE workflow_internal_tasks
           SET status = 'cancelled'
           WHERE id = ?`,
          [internalTaskId]
        );
        await insertInternalTaskEvent(db, {
          taskId: internalTaskId,
          eventType: 'cancelled',
          actorUserId: actorUserId || null,
          payload: {
            reason: 'workflow_deleted',
            source: 'workflow_delete',
          },
        });
      }
    } catch {
      // ignore cleanup errors
    }

    return res.json({ message: 'Workflow gelöscht' });
  } catch (err: any) {
    return res.status(500).json({ message: 'Fehler beim Löschen des Workflows', error: err.message });
  }
});

// POST /api/admin/workflows/:id/tasks/:taskId/approve - Approve task
router.post('/api/admin/workflows/:id/tasks/:taskId/approve', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const executions = loadExecutions();
    const execution = executions.find(e => e.id === req.params.id);

    if (!execution) {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }

    const task = execution.tasks.find(t => t.id === req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task nicht gefunden' });
    }

    ensureInitialActiveTask(execution);
    const activeTaskIds = new Set(cleanupActiveTaskIds(execution));
    if (!activeTaskIds.has(task.id)) {
      return res.status(400).json({ message: 'Task ist aktuell nicht aktiv' });
    }
    if (task.status !== 'PENDING') {
      return res.status(400).json({ message: 'Task kann in diesem Status nicht freigegeben werden' });
    }
    if (task.auto) {
      return res.status(400).json({ message: 'Auto-Task benötigt keine manuelle Freigabe' });
    }

    // Execute the task on approval (manual mode)
    setTaskStatus(execution, task, 'RUNNING', 'Task manuell freigegeben und gestartet.');
    setWorkflowStatus(execution, 'RUNNING', 'Workflow nach manueller Freigabe fortgesetzt.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
    });
    appendWorkflowHistory(execution, 'TASK_DECISION', 'Task durch Admin freigegeben.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: { source: 'admin' },
    });
    saveExecutions(executions);

    try {
      const executionData = await executeWorkflowTask(execution, task);
      let subWorkflowStartExecution: WorkflowExecution | null = null;
      if (executionData) {
        const rawExecutionData =
          executionData && typeof executionData === 'object' ? { ...(executionData as WorkflowExecutionData) } : {};
        if (
          rawExecutionData.subWorkflowStartExecution &&
          typeof rawExecutionData.subWorkflowStartExecution === 'object'
        ) {
          subWorkflowStartExecution = rawExecutionData.subWorkflowStartExecution as WorkflowExecution;
          delete (rawExecutionData as any).subWorkflowStartExecution;
        }
        const sanitizedExecutionData = sanitizeWorkflowStorageValue(rawExecutionData) as WorkflowExecutionData;
        task.executionData = { ...(task.executionData || {}), ...sanitizedExecutionData };
      }
      if (executionData) {
        const sanitizedExecutionData = sanitizeWorkflowStorageValue(
          executionData && typeof executionData === 'object'
            ? (() => {
                const clone = { ...(executionData as WorkflowExecutionData) };
                delete (clone as any).subWorkflowStartExecution;
                return clone;
              })()
            : {}
        ) as WorkflowExecutionData;
        appendWorkflowHistory(execution, 'TASK_DATA', 'Task-Ausführungsdaten aktualisiert.', {
          taskId: task.id,
          taskTitle: task.title,
          taskType: task.type,
          metadata: sanitizedExecutionData,
        });
      }

      if (executionData?.changeWorkflow?.execution) {
        setTaskStatus(execution, task, 'COMPLETED', 'Task abgeschlossen und Folge-Workflow gestartet.');
        setWorkflowStatus(execution, 'COMPLETED', 'Workflow endet mit Übergang auf neuen Workflow.');
        execution.completedAt = new Date().toISOString();
        execution.activeTaskIds = [];
        syncCurrentTaskIndex(execution);
        appendWorkflowHistory(execution, 'WORKFLOW_COMPLETED', 'Workflow erfolgreich abgeschlossen (Change-Workflow).', {
          metadata: {
            nextTemplateId: executionData.changeWorkflow.templateId,
            selectionMode: executionData.changeWorkflow.selectionMode,
            reasoning: executionData.changeWorkflow.reasoning,
          },
        });
        executions.push(executionData.changeWorkflow.execution);
        saveExecutions(executions);
        await runAutoTasks(executions, executionData.changeWorkflow.execution);
        return res.json(execution);
      }

      if (executionData?.endScope === 'workflow') {
        clearScheduledTask(execution.id, task.id);
        setTaskStatus(execution, task, 'COMPLETED', 'Workflow-Endknoten manuell ausgefuehrt.');
        completeWorkflowViaEndNode(execution, task);
        saveExecutions(executions);
        return res.json(execution);
      }

      if (
        executionData?.awaitingConfirmation ||
        executionData?.awaitingUntil ||
        executionData?.awaitingRedmineIssue ||
        executionData?.awaitingSubWorkflow
      ) {
        setTaskStatus(execution, task, 'RUNNING', 'Task wartet nach manueller Freigabe auf externes Ereignis.');
        setWorkflowStatus(execution, 'PAUSED', 'Workflow pausiert nach manueller Freigabe.', {
          taskId: task.id,
          taskTitle: task.title,
          taskType: task.type,
        });
        appendWorkflowHistory(execution, 'TASK_WAITING', 'Task wartet auf externes Ereignis.', {
          taskId: task.id,
          taskTitle: task.title,
          taskType: task.type,
          metadata: executionData,
        });
        if (executionData?.awaitingUntil) {
          scheduleTimerTask(execution.id, task.id, executionData.awaitingUntil);
        }
        if (executionData?.awaitingRedmineIssue) {
          scheduleRedmineIssueTask(execution.id, task.id, executionData.awaitingRedmineIssue);
        }
        execution.activeTaskIds = Array.from(new Set([...(execution.activeTaskIds || []), task.id]));
        syncCurrentTaskIndex(execution);
        setBlockedReason(execution, executionData?.awaitingUntil ? 'waiting_timer' : 'waiting_external');
        if (subWorkflowStartExecution) {
          if (!executions.some((entry) => entry.id === subWorkflowStartExecution?.id)) {
            executions.push(subWorkflowStartExecution);
          }
          saveExecutions(executions);
          await runAutoTasks(executions, subWorkflowStartExecution);
          return res.json(execution);
        }
        saveExecutions(executions);
        return res.json(execution);
      }
      clearScheduledTask(execution.id, task.id);
      setTaskStatus(
        execution,
        task,
        'COMPLETED',
        executionData?.endScope === 'branch'
          ? 'Teilworkflow-Endknoten ausgefuehrt, aktiver Pfad beendet.'
          : 'Task erfolgreich abgeschlossen.'
      );
      activateNextTasks(execution, task, executionData || {});
    } catch (taskError: any) {
      clearScheduledTask(execution.id, task.id);
      if (taskError?.executionData && typeof taskError.executionData === 'object') {
        const sanitizedExecutionData = sanitizeWorkflowStorageValue(
          taskError.executionData
        ) as WorkflowExecutionData;
        task.executionData = { ...(task.executionData || {}), ...sanitizedExecutionData };
        appendWorkflowHistory(execution, 'TASK_DATA', 'Task-Ausführungsdaten bei Fehler gespeichert.', {
          taskId: task.id,
          taskTitle: task.title,
          taskType: task.type,
          metadata: sanitizedExecutionData,
        });
      }
      setTaskStatus(execution, task, 'FAILED', 'Task mit Fehler beendet.');
      setWorkflowStatus(execution, 'FAILED', 'Workflow wegen Task-Fehler beendet.');
      execution.error = taskError?.message || 'Task-Ausführung fehlgeschlagen';
      execution.completedAt = new Date().toISOString();
      appendWorkflowHistory(execution, 'WORKFLOW_FAILED', execution.error, {
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.type,
      });
      await notifyWorkflowAbortIfConfigured(execution, {
        task,
        reason: execution.error,
      });
      execution.activeTaskIds = [];
      syncCurrentTaskIndex(execution);
      saveExecutions(executions);
      return res.status(500).json({ message: execution.error, execution });
    }

    if (finalizeExecutionIfDone(execution)) {
      saveExecutions(executions);
      return res.json(execution);
    }

    setWorkflowStatus(execution, 'RUNNING', 'Workflow wird mit nächstem Schritt fortgesetzt.');
    saveExecutions(executions);
    await runAutoTasks(executions, execution);
    res.json(execution);
  } catch (err: any) {
    res.status(500).json({ message: 'Fehler beim Freigeben der Task', error: err.message });
  }
});

// POST /api/admin/workflows/:id/tasks/:taskId/reject - Reject task
router.post('/api/admin/workflows/:id/tasks/:taskId/reject', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const executions = loadExecutions();
    const execution = executions.find(e => e.id === req.params.id);

    if (!execution) {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }

    const task = execution.tasks.find(t => t.id === req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task nicht gefunden' });
    }

    ensureInitialActiveTask(execution);
    const activeTaskIds = new Set(cleanupActiveTaskIds(execution));
    if (!activeTaskIds.has(task.id)) {
      return res.status(400).json({ message: 'Task ist aktuell nicht aktiv' });
    }
    if (task.status !== 'PENDING') {
      return res.status(400).json({ message: 'Task kann in diesem Status nicht abgelehnt werden' });
    }
    if (task.auto) {
      return res.status(400).json({ message: 'Auto-Task benötigt keine manuelle Ablehnung' });
    }

    // Reject without technical failure: complete workflow as "approval denied"
    task.executionData = {
      ...(task.executionData || {}),
      callbackDecision: 'reject',
      callbackAt: new Date().toISOString(),
      approvalResult: 'denied',
      approvalLabel: 'Genehmigung verweigert',
    };
    setTaskStatus(execution, task, 'COMPLETED', 'Genehmigung verweigert.');
    setWorkflowStatus(execution, 'COMPLETED', 'Workflow beendet: Genehmigung verweigert.');
    delete execution.error;
    execution.completedAt = new Date().toISOString();
    appendWorkflowHistory(execution, 'TASK_DECISION', 'Genehmigung durch Admin verweigert.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: { source: 'admin' },
    });
    appendWorkflowHistory(execution, 'WORKFLOW_COMPLETED', 'Workflow beendet: Genehmigung verweigert.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: { source: 'admin' },
    });
    clearScheduledTask(execution.id, task.id);
    execution.activeTaskIds = [];
    syncCurrentTaskIndex(execution);

    saveExecutions(executions);
    await triggerParentSubWorkflowResumes(executions, execution.id);
    return res.json(execution);
  } catch (err: any) {
    return res.status(500).json({ message: 'Fehler beim Ablehnen der Task', error: err.message });
  }
});

// POST /api/admin/workflows/:id/tasks/:taskId/retry - Retry failed/pending task
router.post('/api/admin/workflows/:id/tasks/:taskId/retry', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const executions = loadExecutions();
    const execution = executions.find((entry) => entry.id === req.params.id);
    if (!execution) {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }
    const task = execution.tasks.find((entry) => entry.id === req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task nicht gefunden' });
    }
    const reason = String(req.body?.reason || '').trim();
    clearScheduledTask(execution.id, task.id);
    task.executionData = {
      ...(task.executionData || {}),
      retryPending: false,
      retryScheduledAt: undefined,
      retryBackoffSeconds: undefined,
      awaitingUntil: undefined,
      attempt: getTaskAttempt(task) + 1,
      manualRetryReason: reason || undefined,
    };
    setTaskStatus(execution, task, 'PENDING', 'Task wurde manuell für Retry freigegeben.');
    appendWorkflowHistory(execution, 'TASK_DECISION', 'Task manuell auf Retry gesetzt.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: {
        action: 'retry',
        reason: reason || undefined,
      },
    });
    execution.activeTaskIds = Array.from(new Set([...(execution.activeTaskIds || []), task.id]));
    execution.completedAt = undefined;
    delete execution.error;
    setWorkflowStatus(execution, 'RUNNING', 'Workflow wurde manuell fortgesetzt (Retry).', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
    });
    setBlockedReason(execution, 'none');
    saveExecutions(executions);
    await runAutoTasks(executions, execution);
    return res.json(execution);
  } catch (err: any) {
    return res.status(500).json({ message: 'Fehler beim Retry der Task', error: err.message });
  }
});

// POST /api/admin/workflows/:id/tasks/:taskId/skip - Skip task and continue
router.post('/api/admin/workflows/:id/tasks/:taskId/skip', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const executions = loadExecutions();
    const execution = executions.find((entry) => entry.id === req.params.id);
    if (!execution) {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }
    const task = execution.tasks.find((entry) => entry.id === req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task nicht gefunden' });
    }
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ message: 'reason ist für Skip verpflichtend.' });
    }

    clearScheduledTask(execution.id, task.id);
    task.executionData = {
      ...(task.executionData || {}),
      skippedByOperator: true,
      skipReason: reason,
      skippedAt: new Date().toISOString(),
    };
    setTaskStatus(execution, task, 'SKIPPED', 'Task wurde manuell übersprungen.');
    appendWorkflowHistory(execution, 'TASK_DECISION', 'Task manuell übersprungen.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: {
        action: 'skip',
        reason,
      },
    });
    activateNextTasks(execution, task, task.executionData || {});
    if (finalizeExecutionIfDone(execution)) {
      saveExecutions(executions);
      return res.json(execution);
    }
    execution.completedAt = undefined;
    delete execution.error;
    setWorkflowStatus(execution, 'RUNNING', 'Workflow nach Skip fortgesetzt.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
    });
    setBlockedReason(execution, 'none');
    saveExecutions(executions);
    await runAutoTasks(executions, execution);
    return res.json(execution);
  } catch (err: any) {
    return res.status(500).json({ message: 'Fehler beim Skip der Task', error: err.message });
  }
});

// POST /api/admin/workflows/:id/tasks/:taskId/resume - Resume task manually as completed
router.post('/api/admin/workflows/:id/tasks/:taskId/resume', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const executions = loadExecutions();
    const execution = executions.find((entry) => entry.id === req.params.id);
    if (!execution) {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }
    const task = execution.tasks.find((entry) => entry.id === req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task nicht gefunden' });
    }
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ message: 'reason ist für Manuell fortsetzen verpflichtend.' });
    }

    clearScheduledTask(execution.id, task.id);
    task.executionData = {
      ...(task.executionData || {}),
      resumedByOperator: true,
      resumeReason: reason,
      resumedAt: new Date().toISOString(),
      awaitingUntil: undefined,
      awaitingRedmineIssue: undefined,
      awaitingConfirmation: false,
    };
    setTaskStatus(execution, task, 'COMPLETED', 'Task wurde manuell als erledigt fortgesetzt.');
    appendWorkflowHistory(execution, 'TASK_DECISION', 'Task manuell fortgesetzt (completed by operator).', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
      metadata: {
        action: 'resume',
        reason,
      },
    });
    activateNextTasks(execution, task, task.executionData || {});
    if (finalizeExecutionIfDone(execution)) {
      saveExecutions(executions);
      return res.json(execution);
    }
    execution.completedAt = undefined;
    delete execution.error;
    setWorkflowStatus(execution, 'RUNNING', 'Workflow manuell fortgesetzt.', {
      taskId: task.id,
      taskTitle: task.title,
      taskType: task.type,
    });
    setBlockedReason(execution, 'none');
    saveExecutions(executions);
    await runAutoTasks(executions, execution);
    return res.json(execution);
  } catch (err: any) {
    return res.status(500).json({ message: 'Fehler beim manuellen Fortsetzen der Task', error: err.message });
  }
});

// POST /api/admin/tickets/:ticketId/geo-weather/refresh - Refresh Nominatim + weather payload for ticket
router.post('/api/admin/tickets/:ticketId/geo-weather/refresh', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
    const db = getDatabase();
    const ticket = await db.get(
      `SELECT t.id,
              t.submission_id,
              t.created_at as ticket_created_at,
              t.latitude as ticket_latitude,
              t.longitude as ticket_longitude,
              t.address as ticket_address,
              t.postal_code as ticket_postal_code,
              t.city as ticket_city,
              t.nominatim_raw_json as ticket_nominatim_raw_json,
              t.weather_report_json as ticket_weather_report_json,
              s.created_at as submission_created_at,
              s.latitude as submission_latitude,
              s.longitude as submission_longitude,
              s.address as submission_address,
              s.postal_code as submission_postal_code,
              s.city as submission_city,
              s.nominatim_raw_json as submission_nominatim_raw_json,
              s.weather_report_json as submission_weather_report_json
       FROM tickets t
       LEFT JOIN submissions s ON s.id = t.submission_id
       WHERE t.id = ?`,
      [ticketId]
    );
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    const latitude = Number.isFinite(Number(ticket.ticket_latitude))
      ? Number(ticket.ticket_latitude)
      : Number.isFinite(Number(ticket.submission_latitude))
      ? Number(ticket.submission_latitude)
      : null;
    const longitude = Number.isFinite(Number(ticket.ticket_longitude))
      ? Number(ticket.ticket_longitude)
      : Number.isFinite(Number(ticket.submission_longitude))
      ? Number(ticket.submission_longitude)
      : null;
    const address = asTrimmedString(ticket.ticket_address || ticket.submission_address);
    const postalCode = asTrimmedString(ticket.ticket_postal_code || ticket.submission_postal_code);
    const city = asTrimmedString(ticket.ticket_city || ticket.submission_city);
    const reportedAt = asTrimmedString(ticket.ticket_created_at || ticket.submission_created_at) || new Date().toISOString();

    if ((latitude === null || longitude === null) && !address && !postalCode && !city) {
      return res.status(400).json({
        message: 'Keine Standortdaten vorhanden. Für Refresh werden Koordinaten oder Adresse benötigt.',
      });
    }

    const enrichment = await enrichGeoAndWeather({
      latitude,
      longitude,
      address,
      postalCode,
      city,
      reportedAt,
    });

    const fallbackTicketNominatim = parseJsonValue<Record<string, any> | null>(ticket.ticket_nominatim_raw_json, null);
    const fallbackSubmissionNominatim = parseJsonValue<Record<string, any> | null>(ticket.submission_nominatim_raw_json, null);
    const fallbackTicketWeather = parseJsonValue<Record<string, any> | null>(ticket.ticket_weather_report_json, null);
    const fallbackSubmissionWeather = parseJsonValue<Record<string, any> | null>(ticket.submission_weather_report_json, null);

    const finalLatitude =
      enrichment.latitude !== null
        ? Number(enrichment.latitude)
        : latitude;
    const finalLongitude =
      enrichment.longitude !== null
        ? Number(enrichment.longitude)
        : longitude;
    const finalAddress = asTrimmedString(enrichment.address) || address || null;
    const finalPostalCode = asTrimmedString(enrichment.postalCode) || postalCode || null;
    const finalCity = asTrimmedString(enrichment.city) || city || null;
    const finalNominatimRaw = enrichment.nominatimRaw || fallbackTicketNominatim || fallbackSubmissionNominatim || null;
    const finalWeatherReport = enrichment.weatherReport || fallbackTicketWeather || fallbackSubmissionWeather || null;
    const finalNominatimRawJson = finalNominatimRaw ? JSON.stringify(finalNominatimRaw) : null;
    const finalWeatherReportJson = finalWeatherReport ? JSON.stringify(finalWeatherReport) : null;

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
        finalWeatherReportJson,
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
          finalWeatherReportJson,
          ticket.submission_id,
        ]
      );
    }

    publishTicketUpdate({
      reason: 'ticket.geo_enriched',
      ticketId,
    });

    return res.json({
      message: 'Nominatim- und Wetterdaten wurden aktualisiert.',
      latitude: finalLatitude,
      longitude: finalLongitude,
      address: finalAddress,
      postalCode: finalPostalCode,
      city: finalCity,
      nominatimSource: enrichment.nominatimSource,
      weatherSource: enrichment.weatherSource,
      nominatimRaw: finalNominatimRaw,
      weatherReport: finalWeatherReport,
    });
  } catch (err: any) {
    return res.status(500).json({ message: 'Fehler beim Aktualisieren von Nominatim/Wetter', error: err?.message });
  }
});

// POST /api/admin/tickets/:ticketId/geocode - Geocode ticket coordinates server-side
router.post('/api/admin/tickets/:ticketId/geocode', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
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

    const addressOverride = asTrimmedString(req.body?.addressOverride);
    const addressQuery =
      addressOverride ||
      [
        ticket.address || ticket.submission_address,
        ticket.postal_code || ticket.submission_postal_code,
        ticket.city || ticket.submission_city,
      ]
        .filter(Boolean)
        .join(', ');
    if (!addressQuery) {
      return res.status(400).json({ message: 'Keine Adresse für Geocoding verfügbar.' });
    }

    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(
      addressQuery
    )}`;
    const geocodeResponse = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'behebes-ai/1.0 (Verbandsgemeinde Otterbach Otterberg)',
        Accept: 'application/json',
      },
    });
    if (!geocodeResponse.ok) {
      return res.status(502).json({
        message: `Geocoding-Provider Fehler (${geocodeResponse.status}).`,
      });
    }
    const payload = (await geocodeResponse.json()) as any[];
    const match = Array.isArray(payload) ? payload[0] : null;
    if (!match) {
      return res.status(404).json({ message: 'Adresse konnte nicht geocodiert werden.' });
    }

    const latitude = Number(match.lat);
    const longitude = Number(match.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(422).json({ message: 'Geocoding-Antwort ohne gültige Koordinaten.' });
    }

    const details = match.address && typeof match.address === 'object' ? match.address : {};
    const postalCode = asTrimmedString(details.postcode) || asTrimmedString(ticket.postal_code || ticket.submission_postal_code);
    const city =
      asTrimmedString(details.city) ||
      asTrimmedString(details.town) ||
      asTrimmedString(details.village) ||
      asTrimmedString(details.municipality) ||
      asTrimmedString(ticket.city || ticket.submission_city);
    const formattedAddress = asTrimmedString(match.display_name) || addressQuery;
    const enrichment = await enrichGeoAndWeather({
      latitude,
      longitude,
      address: formattedAddress,
      postalCode,
      city,
      reportedAt: ticket.created_at || new Date().toISOString(),
    });

    const finalLatitude = Number.isFinite(Number(enrichment.latitude)) ? Number(enrichment.latitude) : latitude;
    const finalLongitude = Number.isFinite(Number(enrichment.longitude)) ? Number(enrichment.longitude) : longitude;
    const finalAddress = asTrimmedString(enrichment.address) || formattedAddress;
    const finalPostalCode = asTrimmedString(enrichment.postalCode) || postalCode || null;
    const finalCity = asTrimmedString(enrichment.city) || city || null;
    const finalNominatimRaw = enrichment.nominatimRaw || (match && typeof match === 'object' ? match : null);
    const finalNominatimRawJson = finalNominatimRaw ? JSON.stringify(finalNominatimRaw) : null;
    const weatherReportJson = enrichment.weatherReport ? JSON.stringify(enrichment.weatherReport) : null;

    await db.run(
      `UPDATE tickets
       SET latitude = ?, longitude = ?, address = ?, postal_code = ?, city = ?, nominatim_raw_json = ?, weather_report_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [finalLatitude, finalLongitude, finalAddress, finalPostalCode, finalCity, finalNominatimRawJson, weatherReportJson, ticketId]
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
      source: 'nominatim',
      nominatimRaw: finalNominatimRaw,
      weatherReport: enrichment.weatherReport || null,
    });
  } catch (err: any) {
    return res.status(500).json({ message: 'Fehler beim Geocoding', error: err.message });
  }
});

// POST /api/admin/workflows/ticket/:ticketId/categorization/preview - Build AI categorization suggestion
router.post(
  '/api/admin/workflows/ticket/:ticketId/categorization/preview',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const ticketId = String(req.params.ticketId || '').trim();
      if (!ticketId) {
        return res.status(400).json({ message: 'ticketId fehlt.' });
      }

      const payload = await buildCategorizationSuggestionForTicket(ticketId);
      const workflowTemplateId = resolveCategoryWorkflowTemplateId(
        payload.knowledge,
        payload.suggestion.category,
        'standard-redmine-ticket'
      );

      return res.json({
        ticketId,
        suggestion: payload.suggestion,
        rawDecision: payload.rawDecision,
        knowledgeVersion: payload.knowledgeVersion,
        categoryWorkflowTemplateId: workflowTemplateId,
      });
    } catch (error: any) {
      return res
        .status(Number(error?.status || 500))
        .json({ message: error?.message || 'Kategorisierungsvorschlag konnte nicht erstellt werden.' });
    }
  }
);

// POST /api/admin/workflows/ticket/:ticketId/categorization/commit - Apply suggestion and start category workflow
router.post(
  '/api/admin/workflows/ticket/:ticketId/categorization/commit',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const ticketId = String(req.params.ticketId || '').trim();
      if (!ticketId) {
        return res.status(400).json({ message: 'ticketId fehlt.' });
      }

      const previewPayload =
        req.body?.suggestion && typeof req.body.suggestion === 'object'
          ? {
              suggestion: {
                category: String(req.body.suggestion.category || req.body.suggestion.kategorie || '').trim(),
                priority: normalizeWorkflowPriority(
                  req.body.suggestion.priority || req.body.suggestion.dringlichkeit || 'medium',
                  'medium'
                ),
                reasoning: String(req.body.suggestion.reasoning || '').trim(),
                categoryId: String(req.body.suggestion.categoryId || '').trim() || 'sonstiges',
              },
              rawDecision: req.body?.rawDecision || req.body?.suggestion || null,
              knowledgeVersion: req.body?.knowledgeVersion || null,
            }
          : await buildCategorizationSuggestionForTicket(ticketId);

      if (!previewPayload?.suggestion?.category) {
        return res.status(400).json({ message: 'Ungültiger Kategorisierungsvorschlag.' });
      }

      const applied = await applyCategorizationSuggestionToTicket({
        ticketId,
        suggestion: previewPayload.suggestion,
        rawDecision: previewPayload.rawDecision,
        knowledgeVersion: previewPayload.knowledgeVersion || null,
        source: 'admin_ticket_manual_categorization',
        commentVisibility: req.body?.commentVisibility === 'public' ? 'public' : 'internal',
      });

      const startCategoryWorkflow = req.body?.startCategoryWorkflow !== false;
      const replaceActiveWorkflows = req.body?.replaceActiveWorkflows !== false;
      const fallbackTemplateId = String(req.body?.fallbackTemplateId || 'standard-redmine-ticket').trim();
      const knowledge = await loadKnowledge();
      const workflowTemplateId = resolveCategoryWorkflowTemplateId(
        knowledge,
        applied.category,
        fallbackTemplateId
      );

      let closedExecutions = 0;
      let execution: WorkflowExecution | null = null;
      if (startCategoryWorkflow) {
        if (replaceActiveWorkflows) {
          closedExecutions = completeActiveWorkflowsForTicket({
            ticketId,
            reason: 'Workflow beendet: Ticket wurde manuell neu kategorisiert.',
          });
        }
        execution = await attachWorkflowToTicket(ticketId, workflowTemplateId, { skipIfExisting: false });
      }

      return res.json({
        ticketId,
        message: startCategoryWorkflow
          ? 'Klassifizierung übernommen und Kategorieworkflow gestartet.'
          : 'Klassifizierung übernommen.',
        applied,
        workflow: {
          started: startCategoryWorkflow,
          templateId: startCategoryWorkflow ? workflowTemplateId : null,
          executionId: execution?.id || null,
          replacedExecutions: closedExecutions,
        },
      });
    } catch (error: any) {
      return res
        .status(Number(error?.status || 500))
        .json({ message: error?.message || 'Kategorisierung konnte nicht übernommen werden.' });
    }
  }
);

// POST /api/admin/workflows/ticket/:ticketId/responsibility/preview - Build AI responsibility suggestion
router.post(
  '/api/admin/workflows/ticket/:ticketId/responsibility/preview',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const ticketId = String(req.params.ticketId || '').trim();
      if (!ticketId) {
        return res.status(400).json({ message: 'ticketId fehlt.' });
      }

      const payload = await buildResponsibilitySuggestionForTicket(ticketId);
      return res.json({
        ticketId,
        suggestion: payload.suggestion,
        rawDecision: payload.rawDecision,
        allowedAuthorities: payload.allowedAuthorities,
      });
    } catch (error: any) {
      return res.status(Number(error?.status || 500)).json({
        message: error?.message || 'Zustaendigkeitsvorschlag konnte nicht erstellt werden.',
      });
    }
  }
);

// POST /api/admin/workflows/ticket/:ticketId/responsibility/commit - Apply responsibility suggestion
router.post(
  '/api/admin/workflows/ticket/:ticketId/responsibility/commit',
  authMiddleware,
  staffOnly,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const ticketId = String(req.params.ticketId || '').trim();
      if (!ticketId) {
        return res.status(400).json({ message: 'ticketId fehlt.' });
      }

      const bodySuggestion =
        req.body?.suggestion && typeof req.body.suggestion === 'object'
          ? {
              responsibilityAuthority: String(
                req.body.suggestion.responsibilityAuthority ||
                  req.body.suggestion.authority ||
                  req.body.suggestion.zustaendigkeit ||
                  ''
              ).trim(),
              reasoning: String(req.body.suggestion.reasoning || '').trim(),
              confidence: Number(req.body.suggestion.confidence),
              legalBasis: normalizeShortStringArray(req.body.suggestion.legalBasis, 5, 140),
              notes: normalizeShortStringArray(req.body.suggestion.notes, 5, 180),
            }
          : null;

      const previewPayload =
        bodySuggestion && bodySuggestion.responsibilityAuthority
          ? (() => {
              const allowedAuthorities = req.body?.allowedAuthorities;
              const allowed = Array.isArray(allowedAuthorities)
                ? allowedAuthorities.map((entry: any) => String(entry || '').trim()).filter(Boolean)
                : [];
              const resolvedAuthority =
                resolveResponsibilityAuthorityFromAllowed(
                  bodySuggestion.responsibilityAuthority,
                  allowed
                ) || bodySuggestion.responsibilityAuthority;
              return {
                suggestion: {
                  ...bodySuggestion,
                  responsibilityAuthority: resolvedAuthority,
                },
              };
            })()
          : await buildResponsibilitySuggestionForTicket(ticketId);

      if (!previewPayload?.suggestion?.responsibilityAuthority) {
        return res.status(400).json({ message: 'Ungueltiger Zustaendigkeitsvorschlag.' });
      }

      const applied = await applyResponsibilitySuggestionToTicket({
        ticketId,
        suggestion: previewPayload.suggestion,
        source: 'admin_ticket_manual_responsibility_check',
        commentVisibility: req.body?.commentVisibility === 'public' ? 'public' : 'internal',
        addComment: req.body?.addAiComment !== false,
      });

      return res.json({
        ticketId,
        message: 'Zustaendigkeit uebernommen.',
        applied,
      });
    } catch (error: any) {
      return res.status(Number(error?.status || 500)).json({
        message: error?.message || 'Zustaendigkeit konnte nicht uebernommen werden.',
      });
    }
  }
);

// POST /api/admin/workflows/ticket/:ticketId - Attach workflow to ticket
router.post('/api/admin/workflows/ticket/:ticketId', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
    let templateId = typeof req.body?.templateId === 'string' ? req.body.templateId.trim() : '';

    if (!templateId) {
      const db = getDatabase();
      const ticket = await db.get(`SELECT category FROM tickets WHERE id = ?`, [ticketId]);
      if (!ticket) {
        return res.status(404).json({ message: 'Ticket nicht gefunden' });
      }

      const knowledge = await loadKnowledge();
      const category = findCategoryConfig(knowledge, ticket.category);
      const fromCategory = typeof category?.workflowTemplateId === 'string' ? category.workflowTemplateId.trim() : '';
      templateId = fromCategory || 'standard-redmine-ticket';
      const normalized = templateId.toLowerCase();
      if (normalized === 'redmine-ticket' || normalized === 'redmine_ticket' || normalized === 'redmine ticket') {
        templateId = 'standard-redmine-ticket';
      }
    }

    const execution = await attachWorkflowToTicket(ticketId, templateId, { skipIfExisting: true });
    if (!execution) {
      return res.status(200).json({ message: 'Workflow-Instanz ist bereits aktiv' });
    }
    return res.status(201).json(execution);
  } catch (err: any) {
    return res.status(500).json({ message: 'Fehler beim Erstellen des Workflows', error: err.message });
  }
});

export default router;
