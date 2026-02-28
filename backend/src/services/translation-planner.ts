import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { getDatabase } from '../database.js';
import { testAIProvider } from './ai.js';
import { getSetting, getSystemPrompt, loadGeneralSettings, setSetting } from './settings.js';
import { listEmailTemplates } from './content-libraries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, '..');

const FRONTEND_STRINGS_PATH = path.resolve(WORKSPACE_ROOT, 'frontend', 'src', 'i18n', 'strings.ts');
const ADMIN_CITIZEN_STRINGS_PATH = path.resolve(WORKSPACE_ROOT, 'admin', 'src', 'i18n', 'citizenStrings.ts');

const TRANSLATION_PLANNER_KEY = 'translationPlanner';
const PLANNER_INTERVAL_MS = 45000;
const UI_TRANSLATION_BATCH_SIZE = 80;

type TranslationKind = 'ui' | 'email';

export interface PlannerRunSummary {
  languageCount: number;
  templateCount: number;
  uiCreated: number;
  uiUpdated: number;
  emailCreated: number;
  emailUpdated: number;
  durationMs: number;
}

interface PersistedPlannerConfig {
  enabled: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  lastSummary: PlannerRunSummary | null;
}

export interface TranslationPlannerStatus {
  enabled: boolean;
  inProgress: boolean;
  currentRunStartedAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  lastSummary: PlannerRunSummary | null;
}

export interface TranslationEntryListItem {
  id: string;
  kind: TranslationKind;
  language: string;
  title: string;
  subtitle: string;
  translationPreview: string;
  sourcePreview: string;
  updatedAt: string | null;
  key?: string;
  templateId?: string;
}

export interface TranslationEntryListResult {
  items: TranslationEntryListItem[];
  total: number;
  limit: number;
  offset: number;
  counts: {
    ui: number;
    email: number;
  };
  languages: string[];
}

export interface UiTranslationDetail {
  kind: 'ui';
  language: string;
  key: string;
  sourceValue: string;
  translatedValue: string;
  updatedAt: string | null;
}

export interface EmailTemplateTranslationDetail {
  kind: 'email';
  language: string;
  templateId: string;
  templateName: string;
  sourceSubject: string;
  sourceHtmlContent: string;
  sourceTextContent: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  translationNotice: string;
  sourceHash: string;
  updatedAt: string | null;
}

export type TranslationCoverageEmailMissingReason = 'missing' | 'empty' | 'outdated';

export interface TranslationCoverageMissingEmailTemplate {
  templateId: string;
  templateName: string;
  reason: TranslationCoverageEmailMissingReason;
}

export interface TranslationCoverageMetrics {
  total: number;
  translated: number;
  missing: number;
  percent: number;
}

export interface TranslationCoverageLanguageSummary {
  language: string;
  label: string;
  configured: boolean;
  ui: TranslationCoverageMetrics;
  email: TranslationCoverageMetrics;
  overall: TranslationCoverageMetrics;
  missingUiKeys: string[];
  missingEmailTemplates: TranslationCoverageMissingEmailTemplate[];
}

export interface TranslationCoverageReport {
  generatedAt: string;
  source: {
    uiTotal: number;
    emailTemplateTotal: number;
  };
  languages: TranslationCoverageLanguageSummary[];
}

export interface TranslationRetranslateResult {
  language: string;
  languageName: string;
  includeUi: boolean;
  includeEmail: boolean;
  selectedUiKeys: number;
  selectedEmailTemplates: number;
  ui: { created: number; updated: number };
  email: { created: number; updated: number };
}

interface EmailTemplateSource {
  templateId: string;
  templateName: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  sourceHash: string;
}

export interface PlannedEmailTemplateTranslation {
  subject: string;
  htmlContent: string;
  textContent: string;
  translationNotice: string;
}

let plannerTimer: NodeJS.Timeout | null = null;
let plannerInProgress = false;
let plannerRunStartedAt: string | null = null;
let plannerRequested = false;
let uiSourceCache: { loadedAt: number; values: Record<string, string> } | null = null;

function normalizeString(input: unknown): string {
  return typeof input === 'string' ? input : String(input || '');
}

function normalizeTrimmedString(input: unknown): string {
  return normalizeString(input).trim();
}

function toIsoOrNull(input: unknown): string | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function normalizeSummary(input: unknown): PlannerRunSummary | null {
  if (!input || typeof input !== 'object') return null;
  const source = input as Record<string, any>;
  const asNum = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    languageCount: Math.max(0, Math.floor(asNum(source.languageCount))),
    templateCount: Math.max(0, Math.floor(asNum(source.templateCount))),
    uiCreated: Math.max(0, Math.floor(asNum(source.uiCreated))),
    uiUpdated: Math.max(0, Math.floor(asNum(source.uiUpdated))),
    emailCreated: Math.max(0, Math.floor(asNum(source.emailCreated))),
    emailUpdated: Math.max(0, Math.floor(asNum(source.emailUpdated))),
    durationMs: Math.max(0, Math.floor(asNum(source.durationMs))),
  };
}

function normalizePlannerConfig(input: unknown): PersistedPlannerConfig {
  const source = input && typeof input === 'object' ? (input as Record<string, any>) : {};
  return {
    enabled: source.enabled === true,
    lastStartedAt: toIsoOrNull(source.lastStartedAt),
    lastCompletedAt: toIsoOrNull(source.lastCompletedAt),
    lastError: normalizeTrimmedString(source.lastError) || null,
    lastSummary: normalizeSummary(source.lastSummary),
  };
}

async function loadPlannerConfig(): Promise<PersistedPlannerConfig> {
  const stored = await getSetting<Partial<PersistedPlannerConfig>>(TRANSLATION_PLANNER_KEY);
  return normalizePlannerConfig(stored);
}

async function savePlannerConfig(config: PersistedPlannerConfig): Promise<void> {
  await setSetting(TRANSLATION_PLANNER_KEY, {
    enabled: config.enabled,
    lastStartedAt: config.lastStartedAt,
    lastCompletedAt: config.lastCompletedAt,
    lastError: config.lastError,
    lastSummary: config.lastSummary,
  });
}

function trimPreview(value: string, maxLength = 180): string {
  const source = normalizeTrimmedString(value).replace(/\s+/g, ' ');
  if (!source) return '';
  if (source.length <= maxLength) return source;
  return `${source.slice(0, maxLength - 3)}...`;
}

function parseJsonObject(raw: string): Record<string, any> | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    const markerMatch = raw.match(/BEGIN_JSON\s*([\s\S]*?)\s*END_JSON/i);
    if (markerMatch?.[1]) {
      try {
        return JSON.parse(markerMatch[1]);
      } catch {
        // ignore
      }
    }

    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (!braceMatch) return null;
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      return null;
    }
  }
}

function hashTemplateSource(subject: string, htmlContent: string, textContent: string): string {
  return createHash('sha256')
    .update(subject)
    .update('\n::subject::\n')
    .update(htmlContent)
    .update('\n::html::\n')
    .update(textContent)
    .digest('hex');
}

function chunkKeys(keys: string[], size: number): string[][] {
  if (size <= 0) return [keys];
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += size) {
    chunks.push(keys.slice(i, i + size));
  }
  return chunks;
}

function extractMapLiteral(source: string, exportName: string): Record<string, string> | null {
  const pattern = new RegExp(`export\\s+const\\s+${exportName}\\s*:[^=]*=\\s*(\\{[\\s\\S]*?\\});`);
  const match = source.match(pattern);
  if (!match?.[1]) return null;

  try {
    const parsed = vm.runInNewContext(`(${match[1]})`, Object.create(null)) as Record<string, unknown>;
    const result: Record<string, string> = {};
    Object.entries(parsed || {}).forEach(([key, value]) => {
      if (typeof key !== 'string' || typeof value !== 'string') return;
      result[key] = value;
    });
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

async function readStringMapFile(filePath: string, exportName: string): Promise<Record<string, string> | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return extractMapLiteral(content, exportName);
  } catch {
    return null;
  }
}

async function loadUiSourceStrings(): Promise<Record<string, string>> {
  const cacheAgeMs = 30000;
  if (uiSourceCache && Date.now() - uiSourceCache.loadedAt < cacheAgeMs) {
    return uiSourceCache.values;
  }

  const fromFrontend = await readStringMapFile(FRONTEND_STRINGS_PATH, 'STRINGS');
  if (fromFrontend && Object.keys(fromFrontend).length > 0) {
    uiSourceCache = { loadedAt: Date.now(), values: fromFrontend };
    return fromFrontend;
  }

  const fromAdmin = await readStringMapFile(ADMIN_CITIZEN_STRINGS_PATH, 'CITIZEN_STRINGS');
  if (fromAdmin && Object.keys(fromAdmin).length > 0) {
    uiSourceCache = { loadedAt: Date.now(), values: fromAdmin };
    return fromAdmin;
  }

  const db = getDatabase();
  const rows = await db.all(`SELECT \`key\`, \`value\` FROM translations WHERE language = 'de'`);
  const fallback: Record<string, string> = {};
  rows.forEach((row: any) => {
    const key = normalizeTrimmedString(row?.key);
    if (!key) return;
    const value = normalizeString(row?.value);
    fallback[key] = value;
  });
  uiSourceCache = { loadedAt: Date.now(), values: fallback };
  return fallback;
}

async function loadEmailTemplateSources(): Promise<EmailTemplateSource[]> {
  const templates = await listEmailTemplates({
    scope: 'platform',
    includeInherited: false,
  });

  const result: EmailTemplateSource[] = [];
  for (const template of templates) {
    const templateId = normalizeTrimmedString(template?.id);
    if (!templateId) continue;

    const templateName = normalizeTrimmedString(template?.name) || templateId;
    const subject = normalizeTrimmedString(template?.subject);
    const htmlContent = normalizeString(template?.htmlContent || '').trim();
    const textContent = normalizeString(template?.textContent || '').trim();

    if (!subject || !htmlContent) continue;

    result.push({
      templateId,
      templateName,
      subject,
      htmlContent,
      textContent,
      sourceHash: hashTemplateSource(subject, htmlContent, textContent),
    });
  }

  result.sort((a, b) => a.templateName.localeCompare(b.templateName, 'de', { sensitivity: 'base' }));
  return result;
}

function resolveSourceLanguageName(defaultLanguage: string, languages: any[]): string {
  const normalizedDefault = normalizeTrimmedString(defaultLanguage).toLowerCase() || 'de';
  const source = Array.isArray(languages)
    ? languages.find((entry) => normalizeTrimmedString(entry?.code).toLowerCase() === normalizedDefault)
    : null;
  return normalizeTrimmedString(source?.aiName) || normalizeTrimmedString(source?.label) || 'German';
}

function normalizeLanguageCatalog(languages: unknown): Array<{ code: string; label: string; aiName: string }> {
  if (!Array.isArray(languages)) return [];
  const seen = new Set<string>();
  const result: Array<{ code: string; label: string; aiName: string }> = [];

  for (const entry of languages) {
    if (!entry || typeof entry !== 'object') continue;
    const code = normalizeTrimmedString((entry as any).code).toLowerCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const label = normalizeTrimmedString((entry as any).label) || code;
    const aiName = normalizeTrimmedString((entry as any).aiName) || label;
    result.push({ code, label, aiName });
  }

  return result;
}

async function ensureUiTranslationsForLanguage(input: {
  languageCode: string;
  languageName: string;
  sourceLanguageName: string;
  sourceStrings: Record<string, string>;
}): Promise<{ created: number; updated: number }> {
  const db = getDatabase();
  const existingRows = await db.all(
    `SELECT \`key\`, \`value\` FROM translations WHERE language = ?`,
    [input.languageCode]
  );

  const existing = new Map<string, string>();
  existingRows.forEach((row: any) => {
    const key = normalizeTrimmedString(row?.key);
    if (!key) return;
    existing.set(key, normalizeString(row?.value));
  });

  const sourceKeys = Object.keys(input.sourceStrings);
  const missingKeys = sourceKeys.filter((key) => {
    if (!existing.has(key)) return true;
    return !normalizeTrimmedString(existing.get(key));
  });

  if (missingKeys.length === 0) {
    return { created: 0, updated: 0 };
  }

  const systemPrompt = await getSystemPrompt('uiTranslationPrompt');
  let created = 0;
  let updated = 0;

  const batches = chunkKeys(missingKeys, UI_TRANSLATION_BATCH_SIZE);
  for (const batch of batches) {
    const sourceBatch: Record<string, string> = {};
    batch.forEach((key) => {
      sourceBatch[key] = input.sourceStrings[key];
    });

    let translatedBatch: Record<string, string> = {};
    try {
      const prompt = `${systemPrompt}

Sprache:
- Quelle: ${input.sourceLanguageName || 'German'}
- Ziel: ${input.languageName || input.languageCode}

Input JSON:
${JSON.stringify(sourceBatch, null, 2)}

Output JSON:`;

      const raw = await testAIProvider(prompt, {
        purpose: 'ui_translation_prefill',
        meta: {
          source: 'services.translation-planner',
          targetLanguage: input.languageCode,
          size: batch.length,
        },
      });
      const parsed = parseJsonObject(raw);
      const root =
        parsed && typeof parsed === 'object' && parsed.translations && typeof parsed.translations === 'object'
          ? parsed.translations
          : parsed;

      batch.forEach((key) => {
        const candidate = root?.[key];
        translatedBatch[key] = typeof candidate === 'string' && candidate.trim()
          ? candidate
          : sourceBatch[key];
      });
    } catch {
      batch.forEach((key) => {
        translatedBatch[key] = sourceBatch[key];
      });
    }

    for (const key of batch) {
      const value = normalizeString(translatedBatch[key] ?? sourceBatch[key]);
      const hadExistingValue = existing.has(key) && !!normalizeTrimmedString(existing.get(key));
      await db.run(
        `INSERT INTO translations (language, \`key\`, \`value\`, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(language, \`key\`)
         DO UPDATE SET \`value\` = excluded.\`value\`, updated_at = CURRENT_TIMESTAMP`,
        [input.languageCode, key, value]
      );
      existing.set(key, value);
      if (hadExistingValue) {
        updated += 1;
      } else {
        created += 1;
      }
    }
  }

  return { created, updated };
}

async function translateEmailTemplate(input: {
  languageCode: string;
  languageName: string;
  source: EmailTemplateSource;
}): Promise<{
  subject: string;
  htmlContent: string;
  textContent: string;
  translationNotice: string;
}> {
  const systemPrompt = await getSystemPrompt('emailTranslationPrompt');

  const prompt = `${systemPrompt}

Zielsprache:
- Name: ${input.languageName || input.languageCode}
- Code: ${input.languageCode}

translationNotice:
- Sehr kurz (ein Satz)
- In der Zielsprache
- Muss aussagen, dass die Uebersetzung mit KI erzeugt wurde

Input JSON:
${JSON.stringify(
    {
      subject: input.source.subject,
      html: input.source.htmlContent,
      text: input.source.textContent,
    },
    null,
    2
  )}`;

  try {
    const raw = await testAIProvider(prompt, {
      purpose: 'email_translation_prefill',
      meta: {
        source: 'services.translation-planner',
        targetLanguage: input.languageCode,
        templateId: input.source.templateId,
      },
    });
    const parsed = parseJsonObject(raw);
    const subject = normalizeTrimmedString(parsed?.subject) || input.source.subject;
    const htmlContent = normalizeTrimmedString(parsed?.html) || input.source.htmlContent;
    const textContent = normalizeTrimmedString(parsed?.text) || input.source.textContent;
    const translationNotice = normalizeTrimmedString(parsed?.translationNotice) || '';

    return {
      subject,
      htmlContent,
      textContent,
      translationNotice,
    };
  } catch {
    return {
      subject: input.source.subject,
      htmlContent: input.source.htmlContent,
      textContent: input.source.textContent,
      translationNotice: '',
    };
  }
}

async function ensureEmailTemplateTranslationsForLanguage(input: {
  languageCode: string;
  languageName: string;
  templateSources: EmailTemplateSource[];
}): Promise<{ created: number; updated: number }> {
  const db = getDatabase();
  const existingRows = await db.all(
    `SELECT template_id, source_hash, subject, html_content
     FROM email_template_translations
     WHERE language = ?`,
    [input.languageCode]
  );

  const existingByTemplate = new Map<
    string,
    { sourceHash: string; subject: string; htmlContent: string }
  >();

  existingRows.forEach((row: any) => {
    const templateId = normalizeTrimmedString(row?.template_id);
    if (!templateId) return;
    existingByTemplate.set(templateId, {
      sourceHash: normalizeTrimmedString(row?.source_hash),
      subject: normalizeTrimmedString(row?.subject),
      htmlContent: normalizeTrimmedString(row?.html_content),
    });
  });

  let created = 0;
  let updated = 0;

  for (const template of input.templateSources) {
    const existing = existingByTemplate.get(template.templateId);
    const unchanged =
      existing &&
      existing.sourceHash === template.sourceHash &&
      !!existing.subject &&
      !!existing.htmlContent;

    if (unchanged) continue;

    const translated = await translateEmailTemplate({
      languageCode: input.languageCode,
      languageName: input.languageName,
      source: template,
    });

    await db.run(
      `INSERT INTO email_template_translations (
        language,
        template_id,
        template_name,
        subject,
        html_content,
        text_content,
        translation_notice,
        source_subject,
        source_html_content,
        source_text_content,
        source_hash,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(language, template_id)
      DO UPDATE SET
        template_name = excluded.template_name,
        subject = excluded.subject,
        html_content = excluded.html_content,
        text_content = excluded.text_content,
        translation_notice = excluded.translation_notice,
        source_subject = excluded.source_subject,
        source_html_content = excluded.source_html_content,
        source_text_content = excluded.source_text_content,
        source_hash = excluded.source_hash,
        updated_at = CURRENT_TIMESTAMP`,
      [
        input.languageCode,
        template.templateId,
        template.templateName,
        translated.subject,
        translated.htmlContent,
        translated.textContent,
        translated.translationNotice,
        template.subject,
        template.htmlContent,
        template.textContent,
        template.sourceHash,
      ]
    );

    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  return { created, updated };
}

async function executePlannerRun(): Promise<PlannerRunSummary> {
  const startedMs = Date.now();
  const { values: general } = await loadGeneralSettings();
  const languageCatalog = normalizeLanguageCatalog(general.languages);
  const defaultLanguage = normalizeTrimmedString(general.defaultLanguage || 'de').toLowerCase() || 'de';
  const targetLanguages = languageCatalog.filter((entry) => entry.code !== defaultLanguage);

  if (targetLanguages.length === 0) {
    return {
      languageCount: 0,
      templateCount: 0,
      uiCreated: 0,
      uiUpdated: 0,
      emailCreated: 0,
      emailUpdated: 0,
      durationMs: Date.now() - startedMs,
    };
  }

  const sourceStrings = await loadUiSourceStrings();
  const sourceLanguageName = resolveSourceLanguageName(defaultLanguage, general.languages || []);
  const templateSources = await loadEmailTemplateSources();

  let uiCreated = 0;
  let uiUpdated = 0;
  let emailCreated = 0;
  let emailUpdated = 0;

  for (const language of targetLanguages) {
    const uiResult = await ensureUiTranslationsForLanguage({
      languageCode: language.code,
      languageName: language.aiName || language.label || language.code,
      sourceLanguageName,
      sourceStrings,
    });
    uiCreated += uiResult.created;
    uiUpdated += uiResult.updated;

    const emailResult = await ensureEmailTemplateTranslationsForLanguage({
      languageCode: language.code,
      languageName: language.aiName || language.label || language.code,
      templateSources,
    });
    emailCreated += emailResult.created;
    emailUpdated += emailResult.updated;
  }

  return {
    languageCount: targetLanguages.length,
    templateCount: templateSources.length,
    uiCreated,
    uiUpdated,
    emailCreated,
    emailUpdated,
    durationMs: Date.now() - startedMs,
  };
}

async function runPlannerCycle(trigger: 'startup' | 'timer' | 'manual_force'): Promise<void> {
  if (plannerInProgress) {
    if (trigger === 'manual_force') {
      plannerRequested = true;
    }
    return;
  }

  const initialConfig = await loadPlannerConfig();
  if (!initialConfig.enabled && trigger !== 'manual_force') {
    return;
  }

  plannerInProgress = true;
  plannerRunStartedAt = new Date().toISOString();

  await savePlannerConfig({
    ...initialConfig,
    lastStartedAt: plannerRunStartedAt,
    lastError: null,
  });

  try {
    const summary = await executePlannerRun();
    const currentConfig = await loadPlannerConfig();
    const noFurtherChangesRequired =
      summary.uiCreated === 0 &&
      summary.uiUpdated === 0 &&
      summary.emailCreated === 0 &&
      summary.emailUpdated === 0;
    const keepEnabled = currentConfig.enabled === true && !noFurtherChangesRequired;
    await savePlannerConfig({
      ...currentConfig,
      enabled: keepEnabled,
      lastStartedAt: plannerRunStartedAt,
      lastCompletedAt: new Date().toISOString(),
      lastError: null,
      lastSummary: summary,
    });
  } catch (error: any) {
    const currentConfig = await loadPlannerConfig();
    await savePlannerConfig({
      ...currentConfig,
      lastStartedAt: plannerRunStartedAt,
      lastCompletedAt: new Date().toISOString(),
      lastError: normalizeTrimmedString(error?.message || error) || 'Unbekannter Fehler',
      lastSummary: currentConfig.lastSummary,
    });
  } finally {
    plannerInProgress = false;
    plannerRunStartedAt = null;
    if (plannerRequested) {
      plannerRequested = false;
      setTimeout(() => {
        void runPlannerCycle('manual_force');
      }, 50);
    }
  }
}

export function startTranslationPlannerWorker(): void {
  if (plannerTimer) return;
  plannerTimer = setInterval(() => {
    void runPlannerCycle('timer');
  }, PLANNER_INTERVAL_MS);
  void runPlannerCycle('startup');
}

export async function getTranslationPlannerStatus(): Promise<TranslationPlannerStatus> {
  const config = await loadPlannerConfig();
  return {
    enabled: config.enabled,
    inProgress: plannerInProgress,
    currentRunStartedAt: plannerRunStartedAt,
    lastStartedAt: config.lastStartedAt,
    lastCompletedAt: config.lastCompletedAt,
    lastError: config.lastError,
    lastSummary: config.lastSummary,
  };
}

export async function setTranslationPlannerEnabled(enabled: boolean): Promise<TranslationPlannerStatus> {
  const current = await loadPlannerConfig();
  await savePlannerConfig({
    ...current,
    enabled,
    lastError: enabled ? null : current.lastError,
  });

  if (enabled) {
    void runPlannerCycle('manual_force');
  }

  return getTranslationPlannerStatus();
}

export async function triggerTranslationPlannerRunNow(): Promise<TranslationPlannerStatus> {
  void runPlannerCycle('manual_force');
  return getTranslationPlannerStatus();
}

export async function listTranslationEntries(input: {
  kind?: 'all' | TranslationKind;
  language?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<TranslationEntryListResult> {
  const db = getDatabase();
  const kind = input.kind === 'ui' || input.kind === 'email' ? input.kind : 'all';
  const language = normalizeTrimmedString(input.language).toLowerCase();
  const search = normalizeTrimmedString(input.search).toLowerCase();
  const limit = Math.min(500, Math.max(1, Number(input.limit) || 80));
  const offset = Math.max(0, Number(input.offset) || 0);

  const sqlLike = `%${search}%`;

  const uiRows =
    kind === 'email'
      ? []
      : await db.all(
          `SELECT language, \`key\`, \`value\`, updated_at
           FROM translations
           WHERE (? = '' OR language = ?)
             AND (? = '' OR lower(\`key\`) LIKE ? OR lower(\`value\`) LIKE ?)
           ORDER BY updated_at DESC`,
          [language, language, search, sqlLike, sqlLike]
        );

  const emailRows =
    kind === 'ui'
      ? []
      : await db.all(
          `SELECT language, template_id, template_name, subject, source_subject, updated_at
           FROM email_template_translations
           WHERE (? = '' OR language = ?)
             AND (
               ? = ''
               OR lower(template_id) LIKE ?
               OR lower(template_name) LIKE ?
               OR lower(subject) LIKE ?
               OR lower(source_subject) LIKE ?
             )
           ORDER BY updated_at DESC`,
          [language, language, search, sqlLike, sqlLike, sqlLike, sqlLike]
        );

  const uiSourceStrings = uiRows.length > 0 ? await loadUiSourceStrings() : {};

  const uiItems: TranslationEntryListItem[] = uiRows.map((row: any) => {
    const lang = normalizeTrimmedString(row?.language).toLowerCase();
    const key = normalizeTrimmedString(row?.key);
    const translatedValue = normalizeString(row?.value);
    const sourceValue = normalizeString(uiSourceStrings[key] || '');
    return {
      id: `ui:${lang}:${encodeURIComponent(key)}`,
      kind: 'ui',
      language: lang,
      title: key,
      subtitle: 'Frontend-Schluessel',
      sourcePreview: trimPreview(sourceValue),
      translationPreview: trimPreview(translatedValue),
      updatedAt: toIsoOrNull(row?.updated_at),
      key,
    };
  });

  const emailItems: TranslationEntryListItem[] = emailRows.map((row: any) => {
    const lang = normalizeTrimmedString(row?.language).toLowerCase();
    const templateId = normalizeTrimmedString(row?.template_id);
    const templateName = normalizeTrimmedString(row?.template_name) || templateId;
    const subject = normalizeString(row?.subject);
    const sourceSubject = normalizeString(row?.source_subject);
    return {
      id: `email:${lang}:${templateId}`,
      kind: 'email',
      language: lang,
      title: templateName,
      subtitle: templateId,
      sourcePreview: trimPreview(sourceSubject),
      translationPreview: trimPreview(subject),
      updatedAt: toIsoOrNull(row?.updated_at),
      templateId,
    };
  });

  const combined = [...uiItems, ...emailItems].sort((a, b) => {
    const aTs = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTs = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (aTs !== bTs) return bTs - aTs;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.title.localeCompare(b.title, 'de', { sensitivity: 'base' });
  });

  const total = combined.length;
  const paged = combined.slice(offset, offset + limit);
  const languages = Array.from(new Set(combined.map((item) => item.language))).sort((a, b) =>
    a.localeCompare(b, 'de', { sensitivity: 'base' })
  );

  return {
    items: paged,
    total,
    limit,
    offset,
    counts: {
      ui: uiItems.length,
      email: emailItems.length,
    },
    languages,
  };
}

function toCoveragePercent(translated: number, total: number): number {
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((translated / total) * 1000) / 10));
}

export async function getTranslationCoverageReport(input?: {
  language?: string;
  includeMissing?: boolean;
}): Promise<TranslationCoverageReport> {
  const includeMissing = input?.includeMissing !== false;
  const requestedLanguage = normalizeTrimmedString(input?.language).toLowerCase();
  const db = getDatabase();

  const { values: general } = await loadGeneralSettings();
  const languageCatalog = normalizeLanguageCatalog(general.languages || []);
  const defaultLanguage = normalizeTrimmedString(general.defaultLanguage || 'de').toLowerCase() || 'de';
  const catalogByCode = new Map(languageCatalog.map((entry) => [entry.code, entry]));

  const uiSourceStrings = await loadUiSourceStrings();
  const uiSourceKeys = Object.keys(uiSourceStrings).sort((left, right) =>
    left.localeCompare(right, 'de', { sensitivity: 'base' })
  );
  const emailTemplateSources = await loadEmailTemplateSources();

  const uiRows = await db.all(
    `SELECT language, \`key\`, \`value\`
     FROM translations`
  );
  const emailRows = await db.all(
    `SELECT language, template_id, subject, html_content, source_hash
     FROM email_template_translations`
  );

  const uiByLanguage = new Map<string, Map<string, string>>();
  for (const row of uiRows || []) {
    const language = normalizeTrimmedString((row as any)?.language).toLowerCase();
    const key = normalizeTrimmedString((row as any)?.key);
    if (!language || !key) continue;
    if (!uiByLanguage.has(language)) {
      uiByLanguage.set(language, new Map<string, string>());
    }
    uiByLanguage.get(language)!.set(key, normalizeString((row as any)?.value));
  }

  const emailByLanguage = new Map<
    string,
    Map<string, { subject: string; htmlContent: string; sourceHash: string }>
  >();
  for (const row of emailRows || []) {
    const language = normalizeTrimmedString((row as any)?.language).toLowerCase();
    const templateId = normalizeTrimmedString((row as any)?.template_id);
    if (!language || !templateId) continue;
    if (!emailByLanguage.has(language)) {
      emailByLanguage.set(language, new Map<string, { subject: string; htmlContent: string; sourceHash: string }>());
    }
    emailByLanguage.get(language)!.set(templateId, {
      subject: normalizeString((row as any)?.subject),
      htmlContent: normalizeString((row as any)?.html_content),
      sourceHash: normalizeTrimmedString((row as any)?.source_hash),
    });
  }

  const languageSet = new Set<string>();
  for (const entry of languageCatalog) {
    if (entry.code && entry.code !== defaultLanguage) {
      languageSet.add(entry.code);
    }
  }
  for (const code of uiByLanguage.keys()) {
    if (code && code !== defaultLanguage) {
      languageSet.add(code);
    }
  }
  for (const code of emailByLanguage.keys()) {
    if (code && code !== defaultLanguage) {
      languageSet.add(code);
    }
  }

  const reportLanguages: TranslationCoverageLanguageSummary[] = [];
  for (const language of Array.from(languageSet.values())) {
    if (requestedLanguage && language !== requestedLanguage) continue;
    const uiEntries = uiByLanguage.get(language) || new Map<string, string>();
    const emailEntries =
      emailByLanguage.get(language) ||
      new Map<string, { subject: string; htmlContent: string; sourceHash: string }>();

    const missingUiKeys: string[] = [];
    let uiTranslated = 0;
    for (const key of uiSourceKeys) {
      const value = normalizeTrimmedString(uiEntries.get(key));
      if (value) {
        uiTranslated += 1;
      } else if (includeMissing) {
        missingUiKeys.push(key);
      }
    }

    const missingEmailTemplates: TranslationCoverageMissingEmailTemplate[] = [];
    let emailTranslated = 0;
    for (const template of emailTemplateSources) {
      const translated = emailEntries.get(template.templateId);
      if (!translated) {
        if (includeMissing) {
          missingEmailTemplates.push({
            templateId: template.templateId,
            templateName: template.templateName,
            reason: 'missing',
          });
        }
        continue;
      }
      if (!normalizeTrimmedString(translated.subject) || !normalizeTrimmedString(translated.htmlContent)) {
        if (includeMissing) {
          missingEmailTemplates.push({
            templateId: template.templateId,
            templateName: template.templateName,
            reason: 'empty',
          });
        }
        continue;
      }
      if (normalizeTrimmedString(translated.sourceHash) !== template.sourceHash) {
        if (includeMissing) {
          missingEmailTemplates.push({
            templateId: template.templateId,
            templateName: template.templateName,
            reason: 'outdated',
          });
        }
        continue;
      }
      emailTranslated += 1;
    }

    const uiTotal = uiSourceKeys.length;
    const emailTotal = emailTemplateSources.length;
    const uiMissing = uiTotal - uiTranslated;
    const emailMissing = emailTotal - emailTranslated;
    const overallTotal = uiTotal + emailTotal;
    const overallTranslated = uiTranslated + emailTranslated;
    const overallMissing = overallTotal - overallTranslated;
    const catalogEntry = catalogByCode.get(language);

    reportLanguages.push({
      language,
      label:
        normalizeTrimmedString(catalogEntry?.label) ||
        normalizeTrimmedString(catalogEntry?.aiName) ||
        language,
      configured: catalogByCode.has(language),
      ui: {
        total: uiTotal,
        translated: uiTranslated,
        missing: uiMissing,
        percent: toCoveragePercent(uiTranslated, uiTotal),
      },
      email: {
        total: emailTotal,
        translated: emailTranslated,
        missing: emailMissing,
        percent: toCoveragePercent(emailTranslated, emailTotal),
      },
      overall: {
        total: overallTotal,
        translated: overallTranslated,
        missing: overallMissing,
        percent: toCoveragePercent(overallTranslated, overallTotal),
      },
      missingUiKeys,
      missingEmailTemplates,
    });
  }

  reportLanguages.sort((left, right) => {
    if (left.configured !== right.configured) return left.configured ? -1 : 1;
    return left.label.localeCompare(right.label, 'de', { sensitivity: 'base' });
  });

  return {
    generatedAt: new Date().toISOString(),
    source: {
      uiTotal: uiSourceKeys.length,
      emailTemplateTotal: emailTemplateSources.length,
    },
    languages: reportLanguages,
  };
}

export async function retranslateLanguageParts(input: {
  language: string;
  includeUi?: boolean;
  includeEmail?: boolean;
  uiKeys?: string[];
  emailTemplateIds?: string[];
}): Promise<TranslationRetranslateResult> {
  const language = normalizeTrimmedString(input.language).toLowerCase();
  if (!language) {
    throw new Error('language ist erforderlich');
  }

  const includeUi = input.includeUi !== false;
  const includeEmail = input.includeEmail !== false;
  if (!includeUi && !includeEmail) {
    throw new Error('Mindestens includeUi oder includeEmail muss aktiv sein');
  }

  const { values: general } = await loadGeneralSettings();
  const defaultLanguage = normalizeTrimmedString(general.defaultLanguage || 'de').toLowerCase() || 'de';
  if (language === defaultLanguage) {
    throw new Error('Die Standardsprache kann nicht als Ziel übersetzt werden');
  }

  const languageCatalog = normalizeLanguageCatalog(general.languages || []);
  const languageEntry = languageCatalog.find((entry) => entry.code === language);
  const languageName =
    normalizeTrimmedString(languageEntry?.aiName) ||
    normalizeTrimmedString(languageEntry?.label) ||
    language;
  const sourceLanguageName = resolveSourceLanguageName(defaultLanguage, general.languages || []);

  let selectedUiKeys = 0;
  let selectedEmailTemplates = 0;
  let uiResult = { created: 0, updated: 0 };
  let emailResult = { created: 0, updated: 0 };

  if (includeUi) {
    const sourceUi = await loadUiSourceStrings();
    let selectedSourceUi: Record<string, string> = sourceUi;
    if (Array.isArray(input.uiKeys) && input.uiKeys.length > 0) {
      const allowedKeys = new Set(
        input.uiKeys
          .map((entry) => normalizeTrimmedString(entry))
          .filter((entry) => !!entry)
      );
      selectedSourceUi = {};
      Object.keys(sourceUi).forEach((key) => {
        if (allowedKeys.has(key)) {
          selectedSourceUi[key] = sourceUi[key];
        }
      });
    }

    selectedUiKeys = Object.keys(selectedSourceUi).length;
    if (selectedUiKeys > 0) {
      uiResult = await ensureUiTranslationsForLanguage({
        languageCode: language,
        languageName,
        sourceLanguageName,
        sourceStrings: selectedSourceUi,
      });
    }
  }

  if (includeEmail) {
    const templateSources = await loadEmailTemplateSources();
    let selectedTemplateSources = templateSources;
    if (Array.isArray(input.emailTemplateIds) && input.emailTemplateIds.length > 0) {
      const allowedTemplateIds = new Set(
        input.emailTemplateIds
          .map((entry) => normalizeTrimmedString(entry))
          .filter((entry) => !!entry)
      );
      selectedTemplateSources = templateSources.filter((entry) => allowedTemplateIds.has(entry.templateId));
    }

    selectedEmailTemplates = selectedTemplateSources.length;
    if (selectedEmailTemplates > 0) {
      emailResult = await ensureEmailTemplateTranslationsForLanguage({
        languageCode: language,
        languageName,
        templateSources: selectedTemplateSources,
      });
    }
  }

  return {
    language,
    languageName,
    includeUi,
    includeEmail,
    selectedUiKeys,
    selectedEmailTemplates,
    ui: uiResult,
    email: emailResult,
  };
}

export async function getUiTranslationDetail(language: string, key: string): Promise<UiTranslationDetail | null> {
  const normalizedLanguage = normalizeTrimmedString(language).toLowerCase();
  const normalizedKey = normalizeTrimmedString(key);
  if (!normalizedLanguage || !normalizedKey) return null;

  const db = getDatabase();
  const row = await db.get(
    `SELECT language, \`key\`, \`value\`, updated_at
     FROM translations
     WHERE language = ? AND \`key\` = ?
     LIMIT 1`,
    [normalizedLanguage, normalizedKey]
  );
  if (!row) return null;

  const sourceStrings = await loadUiSourceStrings();

  return {
    kind: 'ui',
    language: normalizeTrimmedString(row.language).toLowerCase(),
    key: normalizeTrimmedString(row.key),
    sourceValue: normalizeString(sourceStrings[normalizedKey] || ''),
    translatedValue: normalizeString(row.value),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

export async function getEmailTemplateTranslationDetail(
  language: string,
  templateId: string
): Promise<EmailTemplateTranslationDetail | null> {
  const normalizedLanguage = normalizeTrimmedString(language).toLowerCase();
  const normalizedTemplateId = normalizeTrimmedString(templateId);
  if (!normalizedLanguage || !normalizedTemplateId) return null;

  const db = getDatabase();
  const row = await db.get(
    `SELECT
      language,
      template_id,
      template_name,
      source_subject,
      source_html_content,
      source_text_content,
      subject,
      html_content,
      text_content,
      translation_notice,
      source_hash,
      updated_at
     FROM email_template_translations
     WHERE language = ? AND template_id = ?
     LIMIT 1`,
    [normalizedLanguage, normalizedTemplateId]
  );
  if (!row) return null;

  return {
    kind: 'email',
    language: normalizeTrimmedString(row.language).toLowerCase(),
    templateId: normalizeTrimmedString(row.template_id),
    templateName: normalizeTrimmedString(row.template_name) || normalizeTrimmedString(row.template_id),
    sourceSubject: normalizeString(row.source_subject),
    sourceHtmlContent: normalizeString(row.source_html_content),
    sourceTextContent: normalizeString(row.source_text_content),
    subject: normalizeString(row.subject),
    htmlContent: normalizeString(row.html_content),
    textContent: normalizeString(row.text_content),
    translationNotice: normalizeString(row.translation_notice),
    sourceHash: normalizeString(row.source_hash),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

export async function upsertUiTranslation(input: {
  language: string;
  key: string;
  value: string;
}): Promise<UiTranslationDetail | null> {
  const language = normalizeTrimmedString(input.language).toLowerCase();
  const key = normalizeTrimmedString(input.key);
  if (!language || !key) return null;

  const db = getDatabase();
  await db.run(
    `INSERT INTO translations (language, \`key\`, \`value\`, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(language, \`key\`)
     DO UPDATE SET \`value\` = excluded.\`value\`, updated_at = CURRENT_TIMESTAMP`,
    [language, key, normalizeString(input.value)]
  );

  return getUiTranslationDetail(language, key);
}

export async function deleteUiTranslation(language: string, key: string): Promise<boolean> {
  const normalizedLanguage = normalizeTrimmedString(language).toLowerCase();
  const normalizedKey = normalizeTrimmedString(key);
  if (!normalizedLanguage || !normalizedKey) return false;

  const db = getDatabase();
  const result: any = await db.run(
    `DELETE FROM translations WHERE language = ? AND \`key\` = ?`,
    [normalizedLanguage, normalizedKey]
  );
  return Number(result?.changes || 0) > 0;
}

export async function upsertEmailTemplateTranslation(input: {
  language: string;
  templateId: string;
  templateName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  translationNotice?: string;
}): Promise<EmailTemplateTranslationDetail | null> {
  const language = normalizeTrimmedString(input.language).toLowerCase();
  const templateId = normalizeTrimmedString(input.templateId);
  if (!language || !templateId) return null;

  const subject = normalizeTrimmedString(input.subject);
  const htmlContent = normalizeTrimmedString(input.htmlContent);
  if (!subject || !htmlContent) return null;

  const db = getDatabase();
  const existing = await db.get(
    `SELECT
      template_name,
      source_subject,
      source_html_content,
      source_text_content,
      source_hash
     FROM email_template_translations
     WHERE language = ? AND template_id = ?
     LIMIT 1`,
    [language, templateId]
  );

  await db.run(
    `INSERT INTO email_template_translations (
      language,
      template_id,
      template_name,
      subject,
      html_content,
      text_content,
      translation_notice,
      source_subject,
      source_html_content,
      source_text_content,
      source_hash,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(language, template_id)
    DO UPDATE SET
      template_name = excluded.template_name,
      subject = excluded.subject,
      html_content = excluded.html_content,
      text_content = excluded.text_content,
      translation_notice = excluded.translation_notice,
      source_subject = excluded.source_subject,
      source_html_content = excluded.source_html_content,
      source_text_content = excluded.source_text_content,
      source_hash = excluded.source_hash,
      updated_at = CURRENT_TIMESTAMP`,
    [
      language,
      templateId,
      normalizeTrimmedString(input.templateName) || normalizeTrimmedString(existing?.template_name) || templateId,
      subject,
      htmlContent,
      normalizeString(input.textContent || ''),
      normalizeString(input.translationNotice || ''),
      normalizeString(existing?.source_subject || ''),
      normalizeString(existing?.source_html_content || ''),
      normalizeString(existing?.source_text_content || ''),
      normalizeString(existing?.source_hash || ''),
    ]
  );

  return getEmailTemplateTranslationDetail(language, templateId);
}

export async function deleteEmailTemplateTranslation(language: string, templateId: string): Promise<boolean> {
  const normalizedLanguage = normalizeTrimmedString(language).toLowerCase();
  const normalizedTemplateId = normalizeTrimmedString(templateId);
  if (!normalizedLanguage || !normalizedTemplateId) return false;

  const db = getDatabase();
  const result: any = await db.run(
    `DELETE FROM email_template_translations WHERE language = ? AND template_id = ?`,
    [normalizedLanguage, normalizedTemplateId]
  );
  return Number(result?.changes || 0) > 0;
}

export async function deleteAllPlannedTranslations(input: {
  kind?: 'all' | 'ui' | 'email';
  language?: string;
  stopPlanner?: boolean;
}): Promise<{
  uiDeleted: number;
  emailDeleted: number;
  deleted: number;
  status: TranslationPlannerStatus;
}> {
  const db = getDatabase();
  const kind = input.kind === 'ui' || input.kind === 'email' ? input.kind : 'all';
  const language = normalizeTrimmedString(input.language).toLowerCase();
  const stopPlanner = input.stopPlanner !== false;

  if (stopPlanner) {
    const current = await loadPlannerConfig();
    await savePlannerConfig({
      ...current,
      enabled: false,
      lastError: null,
    });
  }

  let uiDeleted = 0;
  let emailDeleted = 0;

  if (kind === 'all' || kind === 'ui') {
    const uiResult: any = language
      ? await db.run(`DELETE FROM translations WHERE language = ?`, [language])
      : await db.run(`DELETE FROM translations`);
    uiDeleted = Number(uiResult?.changes || 0);
  }

  if (kind === 'all' || kind === 'email') {
    const emailResult: any = language
      ? await db.run(`DELETE FROM email_template_translations WHERE language = ?`, [language])
      : await db.run(`DELETE FROM email_template_translations`);
    emailDeleted = Number(emailResult?.changes || 0);
  }

  uiSourceCache = null;
  const status = await getTranslationPlannerStatus();
  return {
    uiDeleted,
    emailDeleted,
    deleted: uiDeleted + emailDeleted,
    status,
  };
}

export async function getPlannedEmailTemplateTranslation(
  language: string,
  templateId: string
): Promise<PlannedEmailTemplateTranslation | null> {
  const normalizedLanguage = normalizeTrimmedString(language).toLowerCase();
  const normalizedTemplateId = normalizeTrimmedString(templateId);
  if (!normalizedLanguage || !normalizedTemplateId) return null;

  const db = getDatabase();
  const row = await db.get(
    `SELECT subject, html_content, text_content, translation_notice
     FROM email_template_translations
     WHERE language = ? AND template_id = ?
     LIMIT 1`,
    [normalizedLanguage, normalizedTemplateId]
  );

  if (!row?.subject || !row?.html_content) return null;

  return {
    subject: normalizeString(row.subject),
    htmlContent: normalizeString(row.html_content),
    textContent: normalizeString(row.text_content),
    translationNotice: normalizeString(row.translation_notice),
  };
}

export function renderTemplateWithData(template: string, data: Record<string, string>): string {
  const input = data || {};
  return normalizeString(template).replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      return normalizeString(input[key]);
    }
    return match;
  });
}
