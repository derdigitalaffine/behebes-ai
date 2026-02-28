import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from '../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const KNOWLEDGE_FILE = path.resolve(BACKEND_ROOT, 'knowledge', 'categories.json');
const WORKFLOWS_FILE = path.resolve(BACKEND_ROOT, 'knowledge', 'workflows.json');
const TEMPLATES_DIR = path.resolve(BACKEND_ROOT, 'templates');
const TEMPLATES_INDEX = path.join(TEMPLATES_DIR, 'index.json');

export type LibraryScope = 'platform' | 'tenant';

interface ScopeContext {
  scope: LibraryScope;
  tenantId: string;
}

interface CategoryLibraryRow {
  item_id: string;
  scope: string;
  tenant_id: string | null;
  origin_item_id: string | null;
  is_override: number;
  name: string | null;
  payload_json: string;
}

interface TemplateLibraryRow {
  item_id: string;
  scope: string;
  tenant_id: string | null;
  origin_item_id: string | null;
  is_override: number;
  name: string | null;
  subject: string | null;
  payload_json: string;
}

interface WorkflowLibraryRow {
  item_id: string;
  scope: string;
  tenant_id: string | null;
  origin_item_id: string | null;
  is_override: number;
  name: string | null;
  payload_json: string;
}

let migrationPromise: Promise<void> | null = null;

function asTrimmedString(value: unknown, max = 191): string {
  return String(value || '').trim().slice(0, max);
}

function slugify(value: unknown): string {
  return asTrimmedString(value, 240)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeJsonParse<T = any>(input: unknown, fallback: T): T {
  if (input && typeof input === 'object') return input as T;
  const raw = String(input || '').trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type CategoryProcessingMode = 'internal' | 'external';

function normalizeCategoryProcessingMode(value: unknown): CategoryProcessingMode | '' {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'internal' || raw === 'intern') return 'internal';
  if (raw === 'external' || raw === 'extern') return 'external';
  return '';
}

function normalizeScope(scopeInput: unknown, tenantIdInput: unknown): ScopeContext {
  const rawScope = asTrimmedString(scopeInput).toLowerCase();
  const tenantId = asTrimmedString(tenantIdInput, 120);
  if (rawScope === 'tenant' && tenantId) {
    return { scope: 'tenant', tenantId };
  }
  return { scope: 'platform', tenantId: '' };
}

async function readJsonFile<T = any>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function rowExists(
  table: string,
  itemId: string,
  scope: LibraryScope,
  tenantId: string
): Promise<boolean> {
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT item_id
     FROM ${table}
     WHERE item_id = ?
       AND scope = ?
       AND COALESCE(tenant_id, '') = COALESCE(?, '')
     LIMIT 1`,
    [itemId, scope, tenantId || null]
  );
  return !!row?.item_id;
}

async function ensureLegacyMigration(): Promise<void> {
  if (migrationPromise) {
    await migrationPromise;
    return;
  }
  migrationPromise = (async () => {
    const db = getDatabase();

    const categoriesCount = await db.get<any>(
      `SELECT COUNT(*) AS count FROM knowledge_category_library`
    );
    if (Number(categoriesCount?.count || 0) === 0) {
      const fileKnowledge = await readJsonFile<any>(KNOWLEDGE_FILE, { categories: [] });
      const categories = Array.isArray(fileKnowledge?.categories) ? fileKnowledge.categories : [];
      for (const rawEntry of categories) {
        const entry = rawEntry && typeof rawEntry === 'object' ? { ...rawEntry } : null;
        if (!entry) continue;
        const itemId = slugify((entry as any).id || (entry as any).name || '');
        const name = asTrimmedString((entry as any).name || itemId, 240);
        if (!itemId || !name) continue;
        (entry as any).id = itemId;
        await db.run(
          `INSERT INTO knowledge_category_library (
            id, item_id, scope, tenant_id, origin_item_id, is_override, name, payload_json
          ) VALUES (?, ?, 'platform', NULL, NULL, 0, ?, ?)`,
          [createId('kcl'), itemId, name, JSON.stringify(entry)]
        );
      }
    }

    const workflowCount = await db.get<any>(
      `SELECT COUNT(*) AS count FROM workflow_template_library`
    );
    if (Number(workflowCount?.count || 0) === 0) {
      let templates: any[] = [];
      const settingsRow = await db.get<any>(
        `SELECT \`value\`
         FROM system_settings
         WHERE \`key\` = ?
         LIMIT 1`,
        ['workflowConfig']
      );
      const settingsConfig = safeJsonParse<any>(settingsRow?.value, null);
      if (Array.isArray(settingsConfig?.templates)) {
        templates = settingsConfig.templates;
      } else {
        const fileConfig = await readJsonFile<any>(WORKFLOWS_FILE, null);
        if (Array.isArray(fileConfig?.templates)) {
          templates = fileConfig.templates;
        }
      }
      for (const rawTemplate of templates) {
        const template = rawTemplate && typeof rawTemplate === 'object' ? { ...rawTemplate } : null;
        if (!template) continue;
        const itemId = slugify((template as any).id || (template as any).name || '');
        const name = asTrimmedString((template as any).name || itemId, 240);
        if (!itemId || !name) continue;
        (template as any).id = itemId;
        await db.run(
          `INSERT INTO workflow_template_library (
            id, item_id, scope, tenant_id, origin_item_id, is_override, name, payload_json
          ) VALUES (?, ?, 'platform', NULL, NULL, 0, ?, ?)`,
          [createId('wtl'), itemId, name, JSON.stringify(template)]
        );
      }
    }

    const emailCount = await db.get<any>(
      `SELECT COUNT(*) AS count FROM email_template_library`
    );
    if (Number(emailCount?.count || 0) === 0) {
      const index = await readJsonFile<any>(TEMPLATES_INDEX, { templates: [] });
      const templates = Array.isArray(index?.templates) ? index.templates : [];
      for (const rawMeta of templates) {
        const meta = rawMeta && typeof rawMeta === 'object' ? { ...rawMeta } : null;
        if (!meta) continue;
        const itemId = slugify((meta as any).id || (meta as any).name || '');
        const name = asTrimmedString((meta as any).name || itemId, 240);
        if (!itemId || !name) continue;

        const filePayload = await readJsonFile<any>(
          path.join(TEMPLATES_DIR, `${itemId}.json`),
          {}
        );
        const subject = asTrimmedString(
          filePayload?.subject || (meta as any).subject || 'Benachrichtigung',
          400
        );
        const htmlContent =
          typeof filePayload?.htmlContent === 'string' ? filePayload.htmlContent : '';
        const textContent =
          typeof filePayload?.textContent === 'string' ? filePayload.textContent : '';
        const payload = {
          ...(meta as any),
          id: itemId,
          name,
          subject,
          htmlContent,
          textContent,
        };
        await db.run(
          `INSERT INTO email_template_library (
            id, item_id, scope, tenant_id, origin_item_id, is_override, name, subject, payload_json
          ) VALUES (?, ?, 'platform', NULL, NULL, 0, ?, ?, ?)`,
          [createId('etl'), itemId, name, subject, JSON.stringify(payload)]
        );
      }
    }
  })().catch((error) => {
    console.warn('Legacy library migration failed:', error);
  });
  await migrationPromise;
}

function parseCategoryRow(row: CategoryLibraryRow): any {
  const payload = safeJsonParse<any>(row?.payload_json, {});
  if (!payload || typeof payload !== 'object') return null;
  const itemId = asTrimmedString(row?.item_id, 240);
  if (!itemId) return null;
  payload.id = asTrimmedString(payload.id || itemId, 240) || itemId;
  payload.scope = row?.scope === 'tenant' ? 'tenant' : 'platform';
  payload.tenantId = asTrimmedString(row?.tenant_id, 120) || '';
  payload.originId = asTrimmedString(row?.origin_item_id, 240) || '';
  payload.isOverride = Number(row?.is_override || 0) === 1;
  const processingMode = normalizeCategoryProcessingMode(payload.processingMode);
  if (processingMode) {
    payload.processingMode = processingMode;
  } else {
    delete payload.processingMode;
  }
  return payload;
}

function parseTemplateRow(row: TemplateLibraryRow): any {
  const payload = safeJsonParse<any>(row?.payload_json, {});
  if (!payload || typeof payload !== 'object') return null;
  const itemId = asTrimmedString(row?.item_id, 240);
  if (!itemId) return null;
  payload.id = asTrimmedString(payload.id || itemId, 240) || itemId;
  payload.name = asTrimmedString(payload.name || row?.name || itemId, 240) || itemId;
  payload.subject = asTrimmedString(payload.subject || row?.subject || '', 400);
  payload.scope = row?.scope === 'tenant' ? 'tenant' : 'platform';
  payload.tenantId = asTrimmedString(row?.tenant_id, 120) || '';
  payload.originId = asTrimmedString(row?.origin_item_id, 240) || '';
  payload.isOverride = Number(row?.is_override || 0) === 1;
  return payload;
}

function parseWorkflowRow(row: WorkflowLibraryRow): any {
  const payload = safeJsonParse<any>(row?.payload_json, {});
  if (!payload || typeof payload !== 'object') return null;
  const itemId = asTrimmedString(row?.item_id, 240);
  if (!itemId) return null;
  payload.id = asTrimmedString(payload.id || itemId, 240) || itemId;
  payload.name = asTrimmedString(payload.name || row?.name || itemId, 240) || itemId;
  payload.scope = row?.scope === 'tenant' ? 'tenant' : 'platform';
  payload.tenantId = asTrimmedString(row?.tenant_id, 120) || '';
  payload.originId = asTrimmedString(row?.origin_item_id, 240) || '';
  payload.isOverride = Number(row?.is_override || 0) === 1;
  return payload;
}

export async function listKnowledgeCategories(options?: {
  scope?: LibraryScope;
  tenantId?: string;
  includeInherited?: boolean;
}): Promise<any[]> {
  await ensureLegacyMigration();
  const db = getDatabase();
  const { scope, tenantId } = normalizeScope(options?.scope, options?.tenantId);

  if (scope === 'platform') {
    const rows = await db.all<CategoryLibraryRow>(
      `SELECT item_id, scope, tenant_id, origin_item_id, is_override, name, payload_json
       FROM knowledge_category_library
       WHERE scope = 'platform'
       ORDER BY LOWER(COALESCE(name, item_id)) ASC, updated_at DESC`
    );
    return (rows || []).map(parseCategoryRow).filter(Boolean);
  }

  const tenantRows = await db.all<CategoryLibraryRow>(
    `SELECT item_id, scope, tenant_id, origin_item_id, is_override, name, payload_json
     FROM knowledge_category_library
     WHERE scope = 'tenant' AND tenant_id = ?
     ORDER BY LOWER(COALESCE(name, item_id)) ASC, updated_at DESC`,
    [tenantId]
  );
  const tenantEntries = (tenantRows || []).map(parseCategoryRow).filter(Boolean);
  if (!options?.includeInherited) return tenantEntries;

  const platformRows = await db.all<CategoryLibraryRow>(
    `SELECT item_id, scope, tenant_id, origin_item_id, is_override, name, payload_json
     FROM knowledge_category_library
     WHERE scope = 'platform'
     ORDER BY LOWER(COALESCE(name, item_id)) ASC, updated_at DESC`
  );
  const effective = new Map<string, any>();
  for (const row of platformRows || []) {
    const parsed = parseCategoryRow(row);
    if (!parsed?.id) continue;
    effective.set(parsed.id, parsed);
  }
  for (const row of tenantEntries) {
    if (!row?.id) continue;
    const originId = asTrimmedString(row.originId || row.id, 240) || row.id;
    if (row.isOverride && originId) {
      row.id = originId;
      effective.set(originId, row);
    } else {
      effective.set(row.id, row);
    }
  }
  return Array.from(effective.values()).sort((a, b) =>
    String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''), 'de', {
      sensitivity: 'base',
    })
  );
}

export async function loadKnowledgeBaseFromLibrary(options?: {
  tenantId?: string;
  scope?: LibraryScope;
  includeInherited?: boolean;
}): Promise<any> {
  const categories = await listKnowledgeCategories({
    scope: options?.scope || 'platform',
    tenantId: options?.tenantId || '',
    includeInherited: options?.includeInherited,
  });
  return {
    version: 'db.v1',
    categories,
    assignments: [],
    urgencies: [],
  };
}

export async function upsertKnowledgeCategory(
  payloadInput: any,
  options?: {
    scope?: LibraryScope;
    tenantId?: string;
    originId?: string;
    isOverride?: boolean;
  }
): Promise<any> {
  await ensureLegacyMigration();
  const db = getDatabase();
  const payload = payloadInput && typeof payloadInput === 'object' ? { ...payloadInput } : {};
  const { scope, tenantId } = normalizeScope(options?.scope, options?.tenantId);
  const itemId = slugify(payload.id || payload.name || '');
  if (!itemId) {
    throw new Error('Kategorie-ID ungültig.');
  }

  payload.id = itemId;
  payload.name = asTrimmedString(payload.name || itemId, 240) || itemId;
  payload.scope = scope;
  payload.tenantId = scope === 'tenant' ? tenantId : '';
  payload.originId = asTrimmedString(options?.originId, 240) || '';
  payload.isOverride = scope === 'tenant' ? options?.isOverride === true : false;
  const processingMode = normalizeCategoryProcessingMode(payload.processingMode);
  if (processingMode) {
    payload.processingMode = processingMode;
  } else {
    delete payload.processingMode;
  }

  const originItemId =
    payload.isOverride && payload.originId ? asTrimmedString(payload.originId, 240) : null;
  const exists = await rowExists('knowledge_category_library', itemId, scope, tenantId);
  if (exists) {
    await db.run(
      `UPDATE knowledge_category_library
       SET origin_item_id = ?,
           is_override = ?,
           name = ?,
           payload_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE item_id = ?
         AND scope = ?
         AND COALESCE(tenant_id, '') = COALESCE(?, '')`,
      [
        originItemId,
        payload.isOverride ? 1 : 0,
        payload.name,
        JSON.stringify(payload),
        itemId,
        scope,
        tenantId || null,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO knowledge_category_library (
        id, item_id, scope, tenant_id, origin_item_id, is_override, name, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createId('kcl'),
        itemId,
        scope,
        scope === 'tenant' ? tenantId : null,
        originItemId,
        payload.isOverride ? 1 : 0,
        payload.name,
        JSON.stringify(payload),
      ]
    );
  }
  return payload;
}

export async function deleteKnowledgeCategory(
  itemIdInput: unknown,
  options?: { scope?: LibraryScope; tenantId?: string }
): Promise<boolean> {
  await ensureLegacyMigration();
  const db = getDatabase();
  const itemId = slugify(itemIdInput);
  if (!itemId) return false;
  const { scope, tenantId } = normalizeScope(options?.scope, options?.tenantId);
  const result = await db.run(
    `DELETE FROM knowledge_category_library
     WHERE item_id = ?
       AND scope = ?
       AND COALESCE(tenant_id, '') = COALESCE(?, '')`,
    [itemId, scope, tenantId || null]
  );
  return Number(result?.changes || 0) > 0;
}

export async function listEmailTemplates(options?: {
  scope?: LibraryScope;
  tenantId?: string;
  includeInherited?: boolean;
}): Promise<any[]> {
  await ensureLegacyMigration();
  const db = getDatabase();
  const { scope, tenantId } = normalizeScope(options?.scope, options?.tenantId);

  const parseRows = (rows: TemplateLibraryRow[]) =>
    (rows || []).map(parseTemplateRow).filter(Boolean);

  if (scope === 'platform') {
    const rows = await db.all<TemplateLibraryRow>(
      `SELECT item_id, scope, tenant_id, origin_item_id, is_override, name, subject, payload_json
       FROM email_template_library
       WHERE scope = 'platform'
       ORDER BY LOWER(COALESCE(name, item_id)) ASC, updated_at DESC`
    );
    return parseRows(rows);
  }

  const tenantRows = await db.all<TemplateLibraryRow>(
    `SELECT item_id, scope, tenant_id, origin_item_id, is_override, name, subject, payload_json
     FROM email_template_library
     WHERE scope = 'tenant' AND tenant_id = ?
     ORDER BY LOWER(COALESCE(name, item_id)) ASC, updated_at DESC`,
    [tenantId]
  );
  const tenantTemplates = parseRows(tenantRows);
  if (!options?.includeInherited) return tenantTemplates;

  const platformRows = await db.all<TemplateLibraryRow>(
    `SELECT item_id, scope, tenant_id, origin_item_id, is_override, name, subject, payload_json
     FROM email_template_library
     WHERE scope = 'platform'
     ORDER BY LOWER(COALESCE(name, item_id)) ASC, updated_at DESC`
  );
  const merged = new Map<string, any>();
  for (const row of parseRows(platformRows)) {
    merged.set(String(row.id), row);
  }
  for (const row of tenantTemplates) {
    const key = row.isOverride ? asTrimmedString(row.originId || row.id, 240) : asTrimmedString(row.id, 240);
    if (!key) continue;
    if (row.isOverride) row.id = key;
    merged.set(key, row);
  }
  return Array.from(merged.values());
}

export async function getEmailTemplate(
  templateIdInput: unknown,
  options?: { scope?: LibraryScope; tenantId?: string; includeInherited?: boolean }
): Promise<any | null> {
  const templateId = slugify(templateIdInput);
  if (!templateId) return null;
  const list = await listEmailTemplates({
    scope: options?.scope || 'platform',
    tenantId: options?.tenantId || '',
    includeInherited: options?.includeInherited !== false,
  });
  return list.find((entry: any) => asTrimmedString(entry?.id, 240) === templateId) || null;
}

export async function upsertEmailTemplate(
  payloadInput: any,
  options?: {
    scope?: LibraryScope;
    tenantId?: string;
    originId?: string;
    isOverride?: boolean;
  }
): Promise<any> {
  await ensureLegacyMigration();
  const db = getDatabase();
  const payload = payloadInput && typeof payloadInput === 'object' ? { ...payloadInput } : {};
  const { scope, tenantId } = normalizeScope(options?.scope, options?.tenantId);
  const itemId = slugify(payload.id || payload.name || '');
  if (!itemId) {
    throw new Error('Template-ID ungültig.');
  }
  const name = asTrimmedString(payload.name || itemId, 240) || itemId;
  const subject = asTrimmedString(payload.subject || '', 400);
  payload.id = itemId;
  payload.name = name;
  payload.subject = subject;
  payload.scope = scope;
  payload.tenantId = scope === 'tenant' ? tenantId : '';
  payload.originId = asTrimmedString(options?.originId, 240) || '';
  payload.isOverride = scope === 'tenant' ? options?.isOverride === true : false;

  const originItemId =
    payload.isOverride && payload.originId ? asTrimmedString(payload.originId, 240) : null;
  const exists = await rowExists('email_template_library', itemId, scope, tenantId);
  if (exists) {
    await db.run(
      `UPDATE email_template_library
       SET origin_item_id = ?,
           is_override = ?,
           name = ?,
           subject = ?,
           payload_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE item_id = ?
         AND scope = ?
         AND COALESCE(tenant_id, '') = COALESCE(?, '')`,
      [
        originItemId,
        payload.isOverride ? 1 : 0,
        name,
        subject,
        JSON.stringify(payload),
        itemId,
        scope,
        tenantId || null,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO email_template_library (
        id, item_id, scope, tenant_id, origin_item_id, is_override, name, subject, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createId('etl'),
        itemId,
        scope,
        scope === 'tenant' ? tenantId : null,
        originItemId,
        payload.isOverride ? 1 : 0,
        name,
        subject,
        JSON.stringify(payload),
      ]
    );
  }
  return payload;
}

export async function deleteEmailTemplate(
  itemIdInput: unknown,
  options?: { scope?: LibraryScope; tenantId?: string }
): Promise<boolean> {
  await ensureLegacyMigration();
  const db = getDatabase();
  const itemId = slugify(itemIdInput);
  if (!itemId) return false;
  const { scope, tenantId } = normalizeScope(options?.scope, options?.tenantId);
  const result = await db.run(
    `DELETE FROM email_template_library
     WHERE item_id = ?
       AND scope = ?
       AND COALESCE(tenant_id, '') = COALESCE(?, '')`,
    [itemId, scope, tenantId || null]
  );
  return Number(result?.changes || 0) > 0;
}

export async function listWorkflowTemplates(options?: {
  scope?: LibraryScope;
  tenantId?: string;
  includeInherited?: boolean;
}): Promise<any[]> {
  await ensureLegacyMigration();
  const db = getDatabase();
  const { scope, tenantId } = normalizeScope(options?.scope, options?.tenantId);
  const parseRows = (rows: WorkflowLibraryRow[]) =>
    (rows || []).map(parseWorkflowRow).filter(Boolean);

  if (scope === 'platform') {
    const rows = await db.all<WorkflowLibraryRow>(
      `SELECT item_id, scope, tenant_id, origin_item_id, is_override, name, payload_json
       FROM workflow_template_library
       WHERE scope = 'platform'
       ORDER BY LOWER(COALESCE(name, item_id)) ASC, updated_at DESC`
    );
    return parseRows(rows);
  }

  const tenantRows = await db.all<WorkflowLibraryRow>(
    `SELECT item_id, scope, tenant_id, origin_item_id, is_override, name, payload_json
     FROM workflow_template_library
     WHERE scope = 'tenant' AND tenant_id = ?
     ORDER BY LOWER(COALESCE(name, item_id)) ASC, updated_at DESC`,
    [tenantId]
  );
  const tenantTemplates = parseRows(tenantRows);
  if (!options?.includeInherited) return tenantTemplates;

  const platformRows = await db.all<WorkflowLibraryRow>(
    `SELECT item_id, scope, tenant_id, origin_item_id, is_override, name, payload_json
     FROM workflow_template_library
     WHERE scope = 'platform'
     ORDER BY LOWER(COALESCE(name, item_id)) ASC, updated_at DESC`
  );
  const merged = new Map<string, any>();
  for (const row of parseRows(platformRows)) {
    merged.set(String(row.id), row);
  }
  for (const row of tenantTemplates) {
    const key = row.isOverride ? asTrimmedString(row.originId || row.id, 240) : asTrimmedString(row.id, 240);
    if (!key) continue;
    if (row.isOverride) row.id = key;
    merged.set(key, row);
  }
  return Array.from(merged.values());
}

export async function upsertWorkflowTemplate(
  payloadInput: any,
  options?: {
    scope?: LibraryScope;
    tenantId?: string;
    originId?: string;
    isOverride?: boolean;
  }
): Promise<any> {
  await ensureLegacyMigration();
  const db = getDatabase();
  const payload = payloadInput && typeof payloadInput === 'object' ? { ...payloadInput } : {};
  const { scope, tenantId } = normalizeScope(options?.scope, options?.tenantId);
  const itemId = slugify(payload.id || payload.name || '');
  if (!itemId) {
    throw new Error('Workflow-ID ungültig.');
  }
  const name = asTrimmedString(payload.name || itemId, 240) || itemId;
  payload.id = itemId;
  payload.name = name;
  payload.scope = scope;
  payload.tenantId = scope === 'tenant' ? tenantId : '';
  payload.originId = asTrimmedString(options?.originId, 240) || '';
  payload.isOverride = scope === 'tenant' ? options?.isOverride === true : false;

  const originItemId =
    payload.isOverride && payload.originId ? asTrimmedString(payload.originId, 240) : null;
  const exists = await rowExists('workflow_template_library', itemId, scope, tenantId);
  if (exists) {
    await db.run(
      `UPDATE workflow_template_library
       SET origin_item_id = ?,
           is_override = ?,
           name = ?,
           payload_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE item_id = ?
         AND scope = ?
         AND COALESCE(tenant_id, '') = COALESCE(?, '')`,
      [
        originItemId,
        payload.isOverride ? 1 : 0,
        name,
        JSON.stringify(payload),
        itemId,
        scope,
        tenantId || null,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO workflow_template_library (
        id, item_id, scope, tenant_id, origin_item_id, is_override, name, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createId('wtl'),
        itemId,
        scope,
        scope === 'tenant' ? tenantId : null,
        originItemId,
        payload.isOverride ? 1 : 0,
        name,
        JSON.stringify(payload),
      ]
    );
  }
  return payload;
}

export async function deleteWorkflowTemplate(
  itemIdInput: unknown,
  options?: { scope?: LibraryScope; tenantId?: string }
): Promise<boolean> {
  await ensureLegacyMigration();
  const db = getDatabase();
  const itemId = slugify(itemIdInput);
  if (!itemId) return false;
  const { scope, tenantId } = normalizeScope(options?.scope, options?.tenantId);
  const result = await db.run(
    `DELETE FROM workflow_template_library
     WHERE item_id = ?
       AND scope = ?
       AND COALESCE(tenant_id, '') = COALESCE(?, '')`,
    [itemId, scope, tenantId || null]
  );
  return Number(result?.changes || 0) > 0;
}

export async function replaceWorkflowTemplates(
  templates: any[],
  options?: { scope?: LibraryScope; tenantId?: string }
): Promise<any[]> {
  await ensureLegacyMigration();
  const db = getDatabase();
  const { scope, tenantId } = normalizeScope(options?.scope, options?.tenantId);
  await db.run(
    `DELETE FROM workflow_template_library
     WHERE scope = ?
       AND COALESCE(tenant_id, '') = COALESCE(?, '')`,
    [scope, tenantId || null]
  );
  const result: any[] = [];
  for (const raw of templates || []) {
    const saved = await upsertWorkflowTemplate(raw, { scope, tenantId });
    result.push(saved);
  }
  return result;
}
