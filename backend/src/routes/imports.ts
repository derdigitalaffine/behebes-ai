import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import bcryptjs from 'bcryptjs';
import { authMiddleware, staffOnly } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { buildAdminCapabilities, loadAdminAccessContext } from '../services/rbac.js';
import { issueUserInvite } from '../services/user-invites.js';

const router = express.Router();
router.use(authMiddleware, staffOnly);

const IMPORT_UPLOAD_ROOT = path.resolve(process.cwd(), 'data', 'import_uploads');
if (!fs.existsSync(IMPORT_UPLOAD_ROOT)) {
  fs.mkdirSync(IMPORT_UPLOAD_ROOT, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, IMPORT_UPLOAD_ROOT),
    filename: (_req, file, cb) => {
      const safeBase = String(file.originalname || 'import.csv')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 120);
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${safeBase || 'import.csv'}`);
    },
  }),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

type ImportKind = 'users' | 'org_units';
type ImportJobStatus = 'draft' | 'uploaded' | 'preview_ready' | 'running' | 'completed' | 'failed' | 'cancelled';

interface ParsedCsvResult {
  headers: string[];
  rows: Array<Record<string, string>>;
  delimiter: ';' | ',';
  encoding: 'utf-8' | 'windows-1252';
}

interface ImportJobRecord {
  id: string;
  tenant_id: string | null;
  kind: ImportKind;
  status: ImportJobStatus;
  created_by_admin_id: string | null;
  file_id: string | null;
  options_json: string | null;
  mapping_json: string | null;
  preview_json: string | null;
  report_json: string | null;
  processed_rows: number;
  total_rows: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ImportJobFileRecord {
  id: string;
  job_id: string;
  original_name: string;
  storage_path: string;
  mime_type: string | null;
  byte_size: number;
  encoding: string | null;
  delimiter: string | null;
  row_count: number;
  created_at: string;
  expires_at: string | null;
  deleted_at: string | null;
}

interface ImportAccessContext {
  userId: string;
  access: Awaited<ReturnType<typeof loadAdminAccessContext>>;
  capabilities: Set<string>;
}

interface ImportUserRow {
  externalId: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  workPhone: string;
  assignmentKeywords: string[];
  orgUnitExternalRefs: string[];
  profileData: Record<string, any>;
}

interface ImportOrgRow {
  externalRef: string;
  name: string;
  contactEmail: string;
  parentExternalRef: string;
  assignmentKeywords: string[];
  metadata: Record<string, any>;
}

const runningJobs = new Set<string>();

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeCsvHeader(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeKeyword(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, ' ').slice(0, 80);
}

function parseKeywords(raw: unknown): string[] {
  const text = normalizeText(raw);
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of text.split(/[\n,;|/]+/g)) {
    const keyword = normalizeKeyword(entry);
    if (!keyword) continue;
    const low = keyword.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(keyword);
    if (out.length >= 120) break;
  }
  return out;
}

function serializeKeywords(values: string[]): string | null {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values || []) {
    const keyword = normalizeKeyword(value);
    if (!keyword) continue;
    const low = keyword.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    normalized.push(keyword);
  }
  if (normalized.length === 0) return null;
  return JSON.stringify(normalized.slice(0, 200));
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseJsonObject(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, any>;
  } catch {
    return {};
  }
}

function parseCsvLine(line: string, delimiter: ';' | ','): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.map((entry) => entry.replace(/\r/g, '').trim());
}

function detectDelimiter(headerLine: string): ';' | ',' {
  const semicolons = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

function parseCsvBuffer(buffer: Buffer, forcedEncoding?: string): ParsedCsvResult {
  const encodingRaw = normalizeText(forcedEncoding).toLowerCase();
  const enc = encodingRaw === 'utf8' || encodingRaw === 'utf-8' ? 'utf-8' : 'windows-1252';
  const text = new TextDecoder(enc).decode(buffer);
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\n/g)
    .map((line) => line.replace(/\r$/, ''));
  const firstContentLine = lines.find((line) => normalizeText(line).length > 0) || '';
  const delimiter = detectDelimiter(firstContentLine);
  const nonEmptyLines = lines.filter((line) => normalizeText(line).length > 0);
  if (nonEmptyLines.length === 0) {
    return { headers: [], rows: [], delimiter, encoding: enc };
  }
  const headers = parseCsvLine(nonEmptyLines[0], delimiter);
  const rows: Array<Record<string, string>> = [];
  for (const line of nonEmptyLines.slice(1)) {
    const fields = parseCsvLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = normalizeText(fields[index] ?? '');
    });
    rows.push(row);
  }
  return { headers, rows, delimiter, encoding: enc };
}

function mapUserImportRow(row: Record<string, string>): ImportUserRow {
  const firstName = normalizeText(row['Vorname']);
  const lastName = normalizeText(row['Nachname']);
  const email =
    normalizeText(row['E-Mail Kontakt']) ||
    normalizeText(row['E-Mail Veröffentlichen']) ||
    normalizeText(row['E-Mail']) ||
    '';
  const usernameFallback = [firstName, lastName]
    .filter(Boolean)
    .join('.')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');
  const usernameFromEmail = email.split('@')[0]?.trim().toLowerCase() || '';
  const username = normalizeText(usernameFromEmail || usernameFallback || row['Id']).replace(/[^a-z0-9._-]+/gi, '_');
  const assignmentKeywords = [
    ...parseKeywords(row['Aufgaben']),
    ...parseKeywords(row['Funktion']),
    ...parseKeywords(row['Stelle']),
    ...parseKeywords(row['Sonstige Angaben']),
  ];
  const orgRefs = normalizeText(row['Organisationseinheiten-Nummer'])
    .split(/[,;|]+/g)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

  return {
    externalId: normalizeText(row['Id']),
    username: username || `user_${Math.random().toString(36).slice(2, 8)}`,
    email,
    firstName,
    lastName,
    jobTitle: normalizeText(row['Positionsbezeichnung'] || row['Funktion']),
    workPhone: normalizeText(row['Telefon Kontakt'] || row['Telefon Veröffentlichen']),
    assignmentKeywords,
    orgUnitExternalRefs: Array.from(new Set(orgRefs)),
    profileData: { ...row },
  };
}

function mapOrgImportRow(row: Record<string, string>): ImportOrgRow {
  const name = normalizeText(row['Bezeichnung']);
  const assignmentKeywords = [
    ...parseKeywords(name),
    ...parseKeywords(row['Sonstige Angaben']),
    ...parseKeywords(row['Anmerkung']),
  ];
  return {
    externalRef: normalizeText(row['Id']),
    name,
    contactEmail: normalizeText(row['E-Mail Kontakt'] || row['E-Mail Veröffentlichen']),
    parentExternalRef: normalizeText(row['Übergeordnete Organisationseinheit']),
    assignmentKeywords,
    metadata: { ...row },
  };
}

async function resolveAccess(req: Request): Promise<ImportAccessContext> {
  const userId = normalizeText(req.userId);
  const role = normalizeText(req.role);
  const access = await loadAdminAccessContext(userId, role);
  const capabilities = new Set(buildAdminCapabilities(access));
  return { userId, access, capabilities };
}

function hasAnyCapability(capabilities: Set<string>, required: string[]): boolean {
  return required.some((entry) => capabilities.has(entry));
}

function resolveTenantId(
  access: Awaited<ReturnType<typeof loadAdminAccessContext>>,
  requestedTenantIdRaw: unknown
): { tenantId: string | null; error?: string } {
  const requestedTenantId = normalizeText(requestedTenantIdRaw);
  if (access.isGlobalAdmin) {
    if (!requestedTenantId) {
      return { tenantId: null, error: 'Im globalen Kontext muss tenantId angegeben werden.' };
    }
    return { tenantId: requestedTenantId };
  }
  const allowedTenantIds = Array.from(new Set((access.tenantIds || []).map((entry) => normalizeText(entry)).filter(Boolean)));
  if (allowedTenantIds.length === 0) {
    return { tenantId: null, error: 'Keine Mandanten im Zugriffskontext vorhanden.' };
  }
  const tenantId = requestedTenantId || allowedTenantIds[0];
  if (!allowedTenantIds.includes(tenantId)) {
    return { tenantId: null, error: 'tenantId liegt außerhalb des erlaubten Scopes.' };
  }
  return { tenantId };
}

async function ensureImportCapability(
  req: Request,
  kind: ImportKind,
  tenantIdRaw: unknown
): Promise<{ userId: string; tenantId: string }> {
  const { userId, access, capabilities } = await resolveAccess(req);
  const scoped = resolveTenantId(access, tenantIdRaw || req.header('x-admin-context-tenant-id'));
  if (scoped.error || !scoped.tenantId) {
    throw new Error(scoped.error || 'tenantId fehlt');
  }
  if (kind === 'users') {
    if (!hasAnyCapability(capabilities, ['users.manage'])) {
      throw new Error('Keine Berechtigung für Benutzerimport.');
    }
  } else if (!hasAnyCapability(capabilities, ['settings.organization.global.manage', 'settings.organization.tenant.manage'])) {
    throw new Error('Keine Berechtigung für Organisationsimport.');
  }
  return { userId, tenantId: scoped.tenantId };
}

async function loadImportJobWithFile(jobId: string): Promise<{ job: ImportJobRecord | null; file: ImportJobFileRecord | null }> {
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT j.*,
            f.id AS f_id,
            f.job_id AS f_job_id,
            f.original_name AS f_original_name,
            f.storage_path AS f_storage_path,
            f.mime_type AS f_mime_type,
            f.byte_size AS f_byte_size,
            f.encoding AS f_encoding,
            f.delimiter AS f_delimiter,
            f.row_count AS f_row_count,
            f.created_at AS f_created_at,
            f.expires_at AS f_expires_at,
            f.deleted_at AS f_deleted_at
     FROM import_jobs j
     LEFT JOIN import_job_files f ON f.id = j.file_id
     WHERE j.id = ?
     LIMIT 1`,
    [jobId]
  );
  if (!row?.id) return { job: null, file: null };
  const job: ImportJobRecord = {
    id: normalizeText(row.id),
    tenant_id: normalizeText(row.tenant_id) || null,
    kind: normalizeText(row.kind) === 'org_units' ? 'org_units' : 'users',
    status: (normalizeText(row.status) || 'draft') as ImportJobStatus,
    created_by_admin_id: normalizeText(row.created_by_admin_id) || null,
    file_id: normalizeText(row.file_id) || null,
    options_json: row.options_json || null,
    mapping_json: row.mapping_json || null,
    preview_json: row.preview_json || null,
    report_json: row.report_json || null,
    processed_rows: Number(row.processed_rows || 0),
    total_rows: Number(row.total_rows || 0),
    error_message: row.error_message || null,
    started_at: row.started_at || null,
    finished_at: row.finished_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  const file: ImportJobFileRecord | null = row.f_id
    ? {
        id: normalizeText(row.f_id),
        job_id: normalizeText(row.f_job_id),
        original_name: normalizeText(row.f_original_name),
        storage_path: normalizeText(row.f_storage_path),
        mime_type: normalizeText(row.f_mime_type) || null,
        byte_size: Number(row.f_byte_size || 0),
        encoding: normalizeText(row.f_encoding) || null,
        delimiter: normalizeText(row.f_delimiter) || null,
        row_count: Number(row.f_row_count || 0),
        created_at: row.f_created_at,
        expires_at: row.f_expires_at || null,
        deleted_at: row.f_deleted_at || null,
      }
    : null;
  return { job, file };
}

async function assertJobScope(req: Request, job: ImportJobRecord): Promise<void> {
  const { access, capabilities } = await resolveAccess(req);
  if (job.kind === 'users') {
    if (!hasAnyCapability(capabilities, ['users.manage'])) throw new Error('Keine Berechtigung.');
  } else if (!hasAnyCapability(capabilities, ['settings.organization.global.manage', 'settings.organization.tenant.manage'])) {
    throw new Error('Keine Berechtigung.');
  }
  const scoped = resolveTenantId(access, job.tenant_id || '');
  if (scoped.error) throw new Error(scoped.error);
  if (!scoped.tenantId || scoped.tenantId !== job.tenant_id) {
    throw new Error('Kein Zugriff auf diesen Mandanten.');
  }
}

async function logImportEvent(jobId: string, eventType: string, message: string, payload?: Record<string, any>, adminUserId?: string | null) {
  const db = getDatabase();
  await db.run(
    `INSERT INTO import_job_events (id, job_id, event_type, message, payload_json, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [createId('ijevt'), jobId, eventType, message, payload ? JSON.stringify(payload) : null, adminUserId || null]
  );
}

async function findUserMatches(
  tenantId: string,
  user: ImportUserRow,
  matchFields: string[]
): Promise<Array<{ id: string }>> {
  const db = getDatabase();
  const seen = new Set<string>();
  const matches: Array<{ id: string }> = [];
  const normalized = new Set(matchFields.map((entry) => normalizeText(entry).toLowerCase()));

  if (normalized.has('external_person_id') && user.externalId) {
    const rows = await db.all<any>(`SELECT id FROM admin_users WHERE external_person_id = ? LIMIT 5`, [user.externalId]);
    for (const row of rows || []) {
      const id = normalizeText(row?.id);
      if (id && !seen.has(id)) {
        seen.add(id);
        matches.push({ id });
      }
    }
  }
  if (normalized.has('email') && user.email) {
    const rows = await db.all<any>(`SELECT id FROM admin_users WHERE LOWER(COALESCE(email, '')) = ? LIMIT 5`, [
      user.email.toLowerCase(),
    ]);
    for (const row of rows || []) {
      const id = normalizeText(row?.id);
      if (id && !seen.has(id)) {
        seen.add(id);
        matches.push({ id });
      }
    }
  }
  if (normalized.has('username') && user.username) {
    const rows = await db.all<any>(`SELECT id FROM admin_users WHERE LOWER(username) = ? LIMIT 5`, [user.username.toLowerCase()]);
    for (const row of rows || []) {
      const id = normalizeText(row?.id);
      if (id && !seen.has(id)) {
        seen.add(id);
        matches.push({ id });
      }
    }
  }

  if (tenantId) {
    if (matches.length > 1) {
      const scopedIds = new Set<string>();
      for (const match of matches) {
        const tenantScope = await db.get<any>(
          `SELECT id
           FROM admin_user_tenant_scopes
           WHERE admin_user_id = ? AND tenant_id = ?
           LIMIT 1`,
          [match.id, tenantId]
        );
        const orgScope = await db.get<any>(
          `SELECT id
           FROM admin_user_org_scopes
           WHERE admin_user_id = ? AND tenant_id = ?
           LIMIT 1`,
          [match.id, tenantId]
        );
        if (tenantScope?.id || orgScope?.id) {
          scopedIds.add(match.id);
        }
      }
      if (scopedIds.size > 0) {
        return matches.filter((entry) => scopedIds.has(entry.id));
      }
    }
  }

  return matches;
}

async function findOrgMatches(tenantId: string, org: ImportOrgRow, matchFields: string[]): Promise<Array<{ id: string }>> {
  const db = getDatabase();
  const out: Array<{ id: string }> = [];
  const seen = new Set<string>();
  const normalized = new Set(matchFields.map((entry) => normalizeText(entry).toLowerCase()));

  if (normalized.has('external_ref') && org.externalRef) {
    const rows = await db.all<any>(
      `SELECT id
       FROM org_units
       WHERE tenant_id = ?
         AND external_ref = ?
       LIMIT 5`,
      [tenantId, org.externalRef]
    );
    for (const row of rows || []) {
      const id = normalizeText(row?.id);
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id });
      }
    }
  }
  if (normalized.has('name') && org.name) {
    const rows = await db.all<any>(
      `SELECT id
       FROM org_units
       WHERE tenant_id = ?
         AND LOWER(name) = ?
       LIMIT 5`,
      [tenantId, org.name.toLowerCase()]
    );
    for (const row of rows || []) {
      const id = normalizeText(row?.id);
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id });
      }
    }
  }
  return out;
}

function shouldApplyField(selectedFields: string[] | undefined, key: string): boolean {
  if (!selectedFields || selectedFields.length === 0) return true;
  return selectedFields.map((entry) => normalizeText(entry).toLowerCase()).includes(key.toLowerCase());
}

async function ensureUniqueUsername(base: string): Promise<string> {
  const db = getDatabase();
  let candidate = normalizeText(base).toLowerCase().replace(/[^a-z0-9._-]+/g, '_') || `user_${Math.random().toString(36).slice(2, 7)}`;
  let index = 0;
  while (index < 50) {
    const row = await db.get<any>(`SELECT id FROM admin_users WHERE LOWER(username) = ? LIMIT 1`, [candidate.toLowerCase()]);
    if (!row?.id) return candidate;
    index += 1;
    candidate = `${candidate}_${index}`;
  }
  return `${candidate}_${Date.now().toString(36)}`;
}

async function upsertUserFromImport(input: {
  tenantId: string;
  row: ImportUserRow;
  matchFields: string[];
  selectedFields?: string[];
  autoAssignOrgScopes?: boolean;
  sendInvite?: boolean;
  actorUserId: string;
}): Promise<'created' | 'updated' | 'skipped' | 'conflict'> {
  const db = getDatabase();
  const matches = await findUserMatches(input.tenantId, input.row, input.matchFields);
  if (matches.length > 1) return 'conflict';
  const selectedFields = input.selectedFields || [];
  const assignmentKeywordsJson = serializeKeywords(input.row.assignmentKeywords);
  const profileDataJson = JSON.stringify(input.row.profileData || {});
  const hasEmail = normalizeText(input.row.email).length > 0;
  const activeFlag = hasEmail ? 1 : 0;
  let userId = matches[0]?.id || '';

  if (!userId) {
    const password = `invite_${crypto.randomBytes(12).toString('hex')}`;
    const hash = await bcryptjs.hash(password, 10);
    const username = await ensureUniqueUsername(input.row.username);
    userId = createId('user');
    await db.run(
      `INSERT INTO admin_users (
         id, username, password_hash, role, active, email, first_name, last_name, job_title, work_phone,
         assignment_keywords_json, profile_data_json, external_person_id
       ) VALUES (?, ?, ?, 'SACHBEARBEITER', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        username,
        hash,
        activeFlag,
        hasEmail ? input.row.email : null,
        input.row.firstName || null,
        input.row.lastName || null,
        input.row.jobTitle || null,
        input.row.workPhone || null,
        assignmentKeywordsJson,
        profileDataJson,
        input.row.externalId || null,
      ]
    );
    await db.run(
      `INSERT INTO admin_user_tenant_scopes (id, admin_user_id, tenant_id, is_tenant_admin)
       VALUES (?, ?, ?, 0)`,
      [createId('auts'), userId, input.tenantId]
    );

    if (input.autoAssignOrgScopes && input.row.orgUnitExternalRefs.length > 0) {
      for (const externalRef of input.row.orgUnitExternalRefs) {
        const org = await db.get<any>(
          `SELECT id FROM org_units WHERE tenant_id = ? AND external_ref = ? LIMIT 1`,
          [input.tenantId, externalRef]
        );
        if (!org?.id) continue;
        const existing = await db.get<any>(
          `SELECT id FROM admin_user_org_scopes WHERE admin_user_id = ? AND tenant_id = ? AND org_unit_id = ? LIMIT 1`,
          [userId, input.tenantId, normalizeText(org.id)]
        );
        if (existing?.id) continue;
        await db.run(
          `INSERT INTO admin_user_org_scopes (id, admin_user_id, tenant_id, org_unit_id, can_write)
           VALUES (?, ?, ?, ?, 0)`,
          [createId('auos'), userId, input.tenantId, normalizeText(org.id)]
        );
      }
    }

    if (input.sendInvite && hasEmail) {
      await issueUserInvite({
        adminUserId: userId,
        sentByAdminId: input.actorUserId,
        metadata: {
          source: 'import.users',
        },
        sendEmailNow: true,
      });
    }

    return 'created';
  }

  const updates: string[] = [];
  const params: any[] = [];
  if (shouldApplyField(selectedFields, 'email')) {
    updates.push('email = ?');
    params.push(hasEmail ? input.row.email : null);
    updates.push('active = ?');
    params.push(activeFlag);
  }
  if (shouldApplyField(selectedFields, 'first_name')) {
    updates.push('first_name = ?');
    params.push(input.row.firstName || null);
  }
  if (shouldApplyField(selectedFields, 'last_name')) {
    updates.push('last_name = ?');
    params.push(input.row.lastName || null);
  }
  if (shouldApplyField(selectedFields, 'job_title')) {
    updates.push('job_title = ?');
    params.push(input.row.jobTitle || null);
  }
  if (shouldApplyField(selectedFields, 'work_phone')) {
    updates.push('work_phone = ?');
    params.push(input.row.workPhone || null);
  }
  if (shouldApplyField(selectedFields, 'assignment_keywords_json')) {
    updates.push('assignment_keywords_json = ?');
    params.push(assignmentKeywordsJson);
  }
  if (shouldApplyField(selectedFields, 'profile_data_json')) {
    updates.push('profile_data_json = ?');
    params.push(profileDataJson);
  }
  if (shouldApplyField(selectedFields, 'external_person_id')) {
    updates.push('external_person_id = ?');
    params.push(input.row.externalId || null);
  }

  if (updates.length === 0) return 'skipped';
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(userId);
  await db.run(`UPDATE admin_users SET ${updates.join(', ')} WHERE id = ?`, params);

  if (input.sendInvite && hasEmail) {
    await issueUserInvite({
      adminUserId: userId,
      sentByAdminId: input.actorUserId,
      metadata: {
        source: 'import.users',
        mode: 'update',
      },
      sendEmailNow: true,
    });
  }

  return 'updated';
}

async function ensureOrgType(tenantId: string, key = 'fachbereich', label = 'Fachbereich'): Promise<string> {
  const db = getDatabase();
  const normalizedKey = normalizeText(key).toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'fachbereich';
  const existing = await db.get<any>(
    `SELECT id
     FROM org_unit_types
     WHERE tenant_id = ? AND \`key\` = ?
     LIMIT 1`,
    [tenantId, normalizedKey]
  );
  if (existing?.id) return normalizeText(existing.id);
  const id = createId('out');
  await db.run(
    `INSERT INTO org_unit_types (id, tenant_id, \`key\`, label, is_assignable, sort_order, active)
     VALUES (?, ?, ?, ?, 1, 0, 1)`,
    [id, tenantId, normalizedKey, normalizeText(label) || 'Fachbereich']
  );
  return id;
}

async function upsertOrgFromImport(input: {
  tenantId: string;
  row: ImportOrgRow;
  matchFields: string[];
  typeId: string;
  selectedFields?: string[];
}): Promise<{ result: 'created' | 'updated' | 'skipped' | 'conflict'; id?: string }> {
  const db = getDatabase();
  const matches = await findOrgMatches(input.tenantId, input.row, input.matchFields);
  if (matches.length > 1) return { result: 'conflict' };
  const selectedFields = input.selectedFields || [];
  const assignmentKeywordsJson = serializeKeywords(input.row.assignmentKeywords);
  const metadataJson = JSON.stringify(input.row.metadata || {});

  let orgId = matches[0]?.id || '';
  if (!orgId) {
    orgId = createId('ou');
    await db.run(
      `INSERT INTO org_units (
         id, tenant_id, type_id, parent_id, name, code, contact_email, active, metadata_json, assignment_keywords_json, external_ref
       ) VALUES (?, ?, ?, NULL, ?, NULL, ?, 1, ?, ?, ?)`,
      [
        orgId,
        input.tenantId,
        input.typeId,
        input.row.name || 'Organisationseinheit',
        input.row.contactEmail || null,
        metadataJson,
        assignmentKeywordsJson,
        input.row.externalRef || null,
      ]
    );
    return { result: 'created', id: orgId };
  }

  const updates: string[] = [];
  const params: any[] = [];
  if (shouldApplyField(selectedFields, 'name')) {
    updates.push('name = ?');
    params.push(input.row.name || null);
  }
  if (shouldApplyField(selectedFields, 'contact_email')) {
    updates.push('contact_email = ?');
    params.push(input.row.contactEmail || null);
  }
  if (shouldApplyField(selectedFields, 'metadata_json')) {
    updates.push('metadata_json = ?');
    params.push(metadataJson);
  }
  if (shouldApplyField(selectedFields, 'assignment_keywords_json')) {
    updates.push('assignment_keywords_json = ?');
    params.push(assignmentKeywordsJson);
  }
  if (shouldApplyField(selectedFields, 'external_ref')) {
    updates.push('external_ref = ?');
    params.push(input.row.externalRef || null);
  }
  if (updates.length === 0) return { result: 'skipped', id: orgId };
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(orgId);
  await db.run(`UPDATE org_units SET ${updates.join(', ')} WHERE id = ?`, params);
  return { result: 'updated', id: orgId };
}

async function buildPreview(job: ImportJobRecord, file: ImportJobFileRecord, actorUserId: string) {
  const db = getDatabase();
  const options = parseJsonObject(job.options_json);
  const mapping = parseJsonObject(job.mapping_json);
  const matchFieldsRaw = Array.isArray(options.matchFields) ? options.matchFields : [];
  const matchFields =
    matchFieldsRaw.length > 0
      ? matchFieldsRaw.map((entry: any) => normalizeText(entry))
      : job.kind === 'users'
      ? ['external_person_id', 'email', 'username']
      : ['external_ref', 'name'];

  const forcedEncoding = normalizeText(options.encoding || file.encoding || '');
  const parsed = parseCsvBuffer(fs.readFileSync(file.storage_path), forcedEncoding);
  const previewRows: Array<Record<string, any>> = [];
  const conflicts: Array<Record<string, any>> = [];
  const counters = {
    create: 0,
    update: 0,
    skip: 0,
    conflict: 0,
    invalid: 0,
  };

  if (job.kind === 'users') {
    for (let index = 0; index < parsed.rows.length; index += 1) {
      const sourceRow = parsed.rows[index];
      const mapped = mapUserImportRow(sourceRow);
      if (!mapped.username) {
        counters.invalid += 1;
        continue;
      }
      const matches = await findUserMatches(job.tenant_id || '', mapped, matchFields);
      let action: 'create' | 'update' | 'skip' | 'conflict' = 'create';
      let matchedIds: string[] = [];
      if (matches.length === 1) {
        action = 'update';
        counters.update += 1;
        matchedIds = [matches[0].id];
      } else if (matches.length > 1) {
        action = 'conflict';
        counters.conflict += 1;
        matchedIds = matches.map((entry) => entry.id);
        conflicts.push({
          rowIndex: index + 2,
          entityKind: 'user',
          externalKey: mapped.externalId || mapped.email || mapped.username,
          reason: 'multiple_matches',
          payload: { matchedIds, mapped },
        });
      } else {
        counters.create += 1;
      }
      if (previewRows.length < 300) {
        previewRows.push({
          rowIndex: index + 2,
          action,
          matchedIds,
          mapped: {
            externalId: mapped.externalId,
            username: mapped.username,
            email: mapped.email,
            firstName: mapped.firstName,
            lastName: mapped.lastName,
            orgUnitExternalRefs: mapped.orgUnitExternalRefs,
            assignmentKeywords: mapped.assignmentKeywords.slice(0, 10),
          },
        });
      }
    }
  } else {
    for (let index = 0; index < parsed.rows.length; index += 1) {
      const sourceRow = parsed.rows[index];
      const mapped = mapOrgImportRow(sourceRow);
      if (!mapped.name) {
        counters.invalid += 1;
        continue;
      }
      const matches = await findOrgMatches(job.tenant_id || '', mapped, matchFields);
      let action: 'create' | 'update' | 'skip' | 'conflict' = 'create';
      let matchedIds: string[] = [];
      if (matches.length === 1) {
        action = 'update';
        counters.update += 1;
        matchedIds = [matches[0].id];
      } else if (matches.length > 1) {
        action = 'conflict';
        counters.conflict += 1;
        matchedIds = matches.map((entry) => entry.id);
        conflicts.push({
          rowIndex: index + 2,
          entityKind: 'org_unit',
          externalKey: mapped.externalRef || mapped.name,
          reason: 'multiple_matches',
          payload: { matchedIds, mapped },
        });
      } else {
        counters.create += 1;
      }
      if (previewRows.length < 300) {
        previewRows.push({
          rowIndex: index + 2,
          action,
          matchedIds,
          mapped: {
            externalRef: mapped.externalRef,
            name: mapped.name,
            parentExternalRef: mapped.parentExternalRef,
            contactEmail: mapped.contactEmail,
            assignmentKeywords: mapped.assignmentKeywords.slice(0, 10),
          },
        });
      }
    }
  }

  await db.run(`DELETE FROM import_job_conflicts WHERE job_id = ?`, [job.id]);
  for (const conflict of conflicts) {
    await db.run(
      `INSERT INTO import_job_conflicts (
         id, job_id, row_index, entity_kind, external_key, reason, payload_json, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
      [
        createId('ijc'),
        job.id,
        Number(conflict.rowIndex || 0),
        conflict.entityKind,
        conflict.externalKey || null,
        conflict.reason,
        JSON.stringify(conflict.payload || {}),
      ]
    );
  }

  const previewPayload = {
    generatedAt: new Date().toISOString(),
    headers: parsed.headers,
    delimiter: parsed.delimiter,
    encoding: parsed.encoding,
    counters,
    sampleRows: previewRows,
    conflictCount: conflicts.length,
    matchFields,
    mapping,
  };

  await db.run(
    `UPDATE import_jobs
     SET status = 'preview_ready',
         preview_json = ?,
         total_rows = ?,
         processed_rows = 0,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(previewPayload), parsed.rows.length, job.id]
  );
  await db.run(
    `UPDATE import_job_files
     SET row_count = ?, encoding = ?, delimiter = ?
     WHERE id = ?`,
    [parsed.rows.length, parsed.encoding, parsed.delimiter, file.id]
  );

  await logImportEvent(job.id, 'preview_ready', 'Import-Vorschau erstellt', {
    rows: parsed.rows.length,
    counters,
    conflictCount: conflicts.length,
  }, actorUserId);

  return previewPayload;
}

async function runImportExecution(jobId: string, actorUserId: string): Promise<void> {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  try {
    const db = getDatabase();
    const { job, file } = await loadImportJobWithFile(jobId);
    if (!job || !file) throw new Error('Importjob oder Datei nicht gefunden');
    const options = parseJsonObject(job.options_json);
    const matchFieldsRaw = Array.isArray(options.matchFields) ? options.matchFields : [];
    const matchFields =
      matchFieldsRaw.length > 0
        ? matchFieldsRaw.map((entry: any) => normalizeText(entry))
        : job.kind === 'users'
        ? ['external_person_id', 'email', 'username']
        : ['external_ref', 'name'];
    const selectedFields = Array.isArray(options.selectedFields)
      ? options.selectedFields.map((entry: any) => normalizeText(entry))
      : [];
    const autoAssignOrgScopes = options.autoAssignOrgScopes === true;
    const sendInvites = options.sendInvites === true;

    await db.run(
      `UPDATE import_jobs
       SET status = 'running',
           started_at = CURRENT_TIMESTAMP,
           finished_at = NULL,
           error_message = NULL,
           processed_rows = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [job.id]
    );
    await logImportEvent(job.id, 'run_start', 'Import-Ausführung gestartet', {
      kind: job.kind,
      tenantId: job.tenant_id,
    }, actorUserId);

    const forcedEncoding = normalizeText(options.encoding || file.encoding || '');
    const parsed = parseCsvBuffer(fs.readFileSync(file.storage_path), forcedEncoding);
    const conflictRows = await db.all<any>(`SELECT row_index FROM import_job_conflicts WHERE job_id = ? AND status = 'open'`, [job.id]);
    const conflictSet = new Set((conflictRows || []).map((row: any) => Number(row?.row_index || 0)));
    const counters = {
      created: 0,
      updated: 0,
      skipped: 0,
      conflicts: 0,
      invalid: 0,
      invitesSent: 0,
    };
    const orgParentRefs: Array<{ childId: string; parentExternalRef: string }> = [];
    const orgTypeId = job.kind === 'org_units'
      ? await ensureOrgType(
          job.tenant_id || 'tenant_default',
          normalizeText(options.orgTypeKey || 'fachbereich'),
          normalizeText(options.orgTypeLabel || 'Fachbereich')
        )
      : '';

    for (let index = 0; index < parsed.rows.length; index += 1) {
      const rowIndex = index + 2;
      if (conflictSet.has(rowIndex)) {
        counters.conflicts += 1;
        continue;
      }
      const row = parsed.rows[index];
      if (job.kind === 'users') {
        const mapped = mapUserImportRow(row);
        if (!mapped.username) {
          counters.invalid += 1;
          continue;
        }
        const result = await upsertUserFromImport({
          tenantId: job.tenant_id || 'tenant_default',
          row: mapped,
          matchFields,
          selectedFields,
          autoAssignOrgScopes,
          sendInvite: sendInvites,
          actorUserId,
        });
        if (result === 'created') counters.created += 1;
        else if (result === 'updated') counters.updated += 1;
        else if (result === 'conflict') counters.conflicts += 1;
        else counters.skipped += 1;
      } else {
        const mapped = mapOrgImportRow(row);
        if (!mapped.name) {
          counters.invalid += 1;
          continue;
        }
        const result = await upsertOrgFromImport({
          tenantId: job.tenant_id || 'tenant_default',
          row: mapped,
          matchFields,
          typeId: orgTypeId,
          selectedFields,
        });
        if (result.result === 'created') counters.created += 1;
        else if (result.result === 'updated') counters.updated += 1;
        else if (result.result === 'conflict') counters.conflicts += 1;
        else counters.skipped += 1;
        if (result.id && mapped.parentExternalRef) {
          orgParentRefs.push({ childId: result.id, parentExternalRef: mapped.parentExternalRef });
        }
      }

      if (index % 20 === 0 || index === parsed.rows.length - 1) {
        await db.run(
          `UPDATE import_jobs
           SET processed_rows = ?,
               total_rows = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [index + 1, parsed.rows.length, job.id]
        );
      }
    }

    if (job.kind === 'org_units' && orgParentRefs.length > 0) {
      for (const ref of orgParentRefs) {
        const parent = await db.get<any>(
          `SELECT id
           FROM org_units
           WHERE tenant_id = ? AND external_ref = ?
           LIMIT 1`,
          [job.tenant_id || 'tenant_default', ref.parentExternalRef]
        );
        const parentId = normalizeText(parent?.id);
        if (!parentId) continue;
        await db.run(
          `UPDATE org_units
           SET parent_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [parentId, ref.childId]
        );
      }
    }

    const report = {
      finishedAt: new Date().toISOString(),
      counters,
      rows: parsed.rows.length,
      matchFields,
      selectedFields,
      options: {
        autoAssignOrgScopes,
        sendInvites,
      },
    };
    await db.run(
      `UPDATE import_jobs
       SET status = 'completed',
           report_json = ?,
           finished_at = CURRENT_TIMESTAMP,
           processed_rows = ?,
           total_rows = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(report), parsed.rows.length, parsed.rows.length, job.id]
    );
    await logImportEvent(job.id, 'run_completed', 'Import erfolgreich abgeschlossen', report, actorUserId);
  } catch (error: any) {
    const db = getDatabase();
    const message = error?.message || String(error || 'Import fehlgeschlagen');
    await db.run(
      `UPDATE import_jobs
       SET status = 'failed',
           error_message = ?,
           finished_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [message, jobId]
    );
    await logImportEvent(jobId, 'run_failed', 'Import fehlgeschlagen', { error: message }, actorUserId);
  } finally {
    runningJobs.delete(jobId);
  }
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const kindRaw = normalizeText(req.body?.kind).toLowerCase();
    const kind: ImportKind = kindRaw === 'org_units' ? 'org_units' : 'users';
    const { userId, tenantId } = await ensureImportCapability(req, kind, req.body?.tenantId);
    const db = getDatabase();
    const id = createId('ijob');
    const options = parseJsonObject(req.body?.options);
    const mapping = parseJsonObject(req.body?.mapping);
    await db.run(
      `INSERT INTO import_jobs (
         id, tenant_id, kind, status, created_by_admin_id, options_json, mapping_json
       ) VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
      [id, tenantId, kind, userId || null, JSON.stringify(options), JSON.stringify(mapping)]
    );
    await logImportEvent(id, 'created', 'Importjob erstellt', { kind, tenantId }, userId);
    return res.status(201).json({ id, kind, tenantId, status: 'draft' });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Importjob konnte nicht erstellt werden.' });
  }
});

router.post('/:id/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    if (!jobId) return res.status(400).json({ message: 'jobId fehlt.' });
    const { job } = await loadImportJobWithFile(jobId);
    if (!job) return res.status(404).json({ message: 'Importjob nicht gefunden.' });
    await assertJobScope(req, job);

    const file = (req as any).file as { path: string; originalname: string; mimetype: string; size: number } | undefined;
    if (!file?.path) {
      return res.status(400).json({ message: 'Datei fehlt.' });
    }

    const db = getDatabase();
    const fileId = createId('ifile');
    await db.run(
      `INSERT INTO import_job_files (
         id, job_id, original_name, storage_path, mime_type, byte_size
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [fileId, jobId, normalizeText(file.originalname) || 'import.csv', file.path, normalizeText(file.mimetype) || null, Number(file.size || 0)]
    );
    await db.run(
      `UPDATE import_jobs
       SET file_id = ?, status = 'uploaded', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [fileId, jobId]
    );
    await logImportEvent(jobId, 'uploaded', 'Datei hochgeladen', {
      originalName: normalizeText(file.originalname) || 'import.csv',
      size: Number(file.size || 0),
    }, normalizeText(req.userId));

    return res.json({ id: fileId, status: 'uploaded' });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Upload fehlgeschlagen.' });
  }
});

router.post('/:id/preview', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const { job, file } = await loadImportJobWithFile(jobId);
    if (!job) return res.status(404).json({ message: 'Importjob nicht gefunden.' });
    if (!file) return res.status(400).json({ message: 'Keine Importdatei vorhanden.' });
    await assertJobScope(req, job);
    const db = getDatabase();
    if (req.body?.options && typeof req.body.options === 'object') {
      const next = {
        ...parseJsonObject(job.options_json),
        ...parseJsonObject(req.body.options),
      };
      await db.run(`UPDATE import_jobs SET options_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
        JSON.stringify(next),
        job.id,
      ]);
      job.options_json = JSON.stringify(next);
    }
    if (req.body?.mapping && typeof req.body.mapping === 'object') {
      const nextMapping = parseJsonObject(req.body.mapping);
      await db.run(`UPDATE import_jobs SET mapping_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
        JSON.stringify(nextMapping),
        job.id,
      ]);
      job.mapping_json = JSON.stringify(nextMapping);
    }
    const preview = await buildPreview(job, file, normalizeText(req.userId));
    return res.json({ preview });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Vorschau konnte nicht erstellt werden.' });
  }
});

router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const { job, file } = await loadImportJobWithFile(jobId);
    if (!job) return res.status(404).json({ message: 'Importjob nicht gefunden.' });
    if (!file) return res.status(400).json({ message: 'Keine Importdatei vorhanden.' });
    await assertJobScope(req, job);
    if (runningJobs.has(jobId)) {
      return res.status(409).json({ message: 'Import läuft bereits.' });
    }

    const db = getDatabase();
    if (req.body?.options && typeof req.body.options === 'object') {
      const next = {
        ...parseJsonObject(job.options_json),
        ...parseJsonObject(req.body.options),
      };
      await db.run(`UPDATE import_jobs SET options_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
        JSON.stringify(next),
        job.id,
      ]);
    }
    void runImportExecution(jobId, normalizeText(req.userId));
    return res.status(202).json({ id: jobId, status: 'running' });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Import konnte nicht gestartet werden.' });
  }
});

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const { job } = await loadImportJobWithFile(jobId);
    if (!job) return res.status(404).json({ message: 'Importjob nicht gefunden.' });
    await assertJobScope(req, job);
    if (runningJobs.has(jobId)) {
      return res.status(409).json({ message: 'Laufende Jobs können derzeit nicht hart abgebrochen werden.' });
    }
    await getDatabase().run(
      `UPDATE import_jobs
       SET status = 'cancelled',
           finished_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [jobId]
    );
    await logImportEvent(jobId, 'cancelled', 'Importjob abgebrochen', {}, normalizeText(req.userId));
    return res.json({ id: jobId, status: 'cancelled' });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Job konnte nicht abgebrochen werden.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const { job, file } = await loadImportJobWithFile(jobId);
    if (!job) return res.status(404).json({ message: 'Importjob nicht gefunden.' });
    await assertJobScope(req, job);
    const events = await getDatabase().all<any>(
      `SELECT id, event_type, message, payload_json, created_by_admin_id, created_at
       FROM import_job_events
       WHERE job_id = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [jobId]
    );
    return res.json({
      job,
      file,
      events: (events || []).map((entry: any) => ({
        id: normalizeText(entry?.id),
        eventType: normalizeText(entry?.event_type),
        message: normalizeText(entry?.message),
        payload: parseJsonObject(entry?.payload_json),
        createdByAdminId: normalizeText(entry?.created_by_admin_id) || null,
        createdAt: entry?.created_at || null,
      })),
      running: runningJobs.has(jobId),
      preview: parseJsonObject(job.preview_json),
      report: parseJsonObject(job.report_json),
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Job konnte nicht geladen werden.' });
  }
});

router.get('/:id/report', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const { job } = await loadImportJobWithFile(jobId);
    if (!job) return res.status(404).json({ message: 'Importjob nicht gefunden.' });
    await assertJobScope(req, job);
    const conflicts = await getDatabase().all<any>(
      `SELECT id, row_index, entity_kind, external_key, reason, payload_json, status, created_at
       FROM import_job_conflicts
       WHERE job_id = ?
       ORDER BY row_index ASC
       LIMIT 1000`,
      [jobId]
    );
    return res.json({
      jobId,
      status: job.status,
      preview: parseJsonObject(job.preview_json),
      report: parseJsonObject(job.report_json),
      conflicts: (conflicts || []).map((entry: any) => ({
        id: normalizeText(entry?.id),
        rowIndex: Number(entry?.row_index || 0),
        entityKind: normalizeText(entry?.entity_kind),
        externalKey: normalizeText(entry?.external_key) || null,
        reason: normalizeText(entry?.reason),
        payload: parseJsonObject(entry?.payload_json),
        status: normalizeText(entry?.status),
        createdAt: entry?.created_at || null,
      })),
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Report konnte nicht geladen werden.' });
  }
});

router.get('/templates/:kind', async (req: Request, res: Response) => {
  const kind = normalizeText(req.params.kind).toLowerCase() === 'org_units' ? 'org_units' : 'users';
  if (kind === 'users') {
    return res.json({
      kind,
      template: {
        matchFields: ['external_person_id', 'email', 'username'],
        selectedFields: [
          'email',
          'first_name',
          'last_name',
          'job_title',
          'work_phone',
          'assignment_keywords_json',
          'profile_data_json',
          'external_person_id',
        ],
      },
    });
  }
  return res.json({
    kind,
    template: {
      matchFields: ['external_ref', 'name'],
      selectedFields: ['name', 'contact_email', 'metadata_json', 'assignment_keywords_json', 'external_ref'],
      orgTypeKey: 'fachbereich',
      orgTypeLabel: 'Fachbereich',
    },
  });
});

router.post('/:id/assist/mapping', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const { job, file } = await loadImportJobWithFile(jobId);
    if (!job || !file) return res.status(404).json({ message: 'Importjob oder Datei nicht gefunden.' });
    await assertJobScope(req, job);
    const parsed = parseCsvBuffer(fs.readFileSync(file.storage_path), normalizeText(file.encoding || ''));
    const headerMap: Record<string, string> = {};
    for (const header of parsed.headers) {
      const normalized = normalizeCsvHeader(header);
      if (job.kind === 'users') {
        if (['id'].includes(normalized)) headerMap[header] = 'external_person_id';
        else if (['vorname', 'firstname', 'first_name'].includes(normalized)) headerMap[header] = 'first_name';
        else if (['nachname', 'lastname', 'last_name'].includes(normalized)) headerMap[header] = 'last_name';
        else if (normalized.startsWith('e_mail')) headerMap[header] = 'email';
        else if (normalized.includes('telefon')) headerMap[header] = 'work_phone';
        else if (normalized.includes('position') || normalized.includes('funktion')) headerMap[header] = 'job_title';
      } else {
        if (['id'].includes(normalized)) headerMap[header] = 'external_ref';
        else if (['bezeichnung', 'name'].includes(normalized)) headerMap[header] = 'name';
        else if (normalized.includes('ubergeordnete_organisationseinheit')) headerMap[header] = 'parent_external_ref';
        else if (normalized.includes('e_mail')) headerMap[header] = 'contact_email';
      }
    }
    return res.json({
      assistant: 'rules',
      kind: job.kind,
      mappingSuggestion: {
        headerMap,
      },
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Mapping-Assist fehlgeschlagen.' });
  }
});

router.post('/:id/assist/keywords', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const { job, file } = await loadImportJobWithFile(jobId);
    if (!job || !file) return res.status(404).json({ message: 'Importjob oder Datei nicht gefunden.' });
    await assertJobScope(req, job);
    const parsed = parseCsvBuffer(fs.readFileSync(file.storage_path), normalizeText(file.encoding || ''));
    const samples = parsed.rows.slice(0, 50).map((row, index) => {
      const mapped = job.kind === 'users' ? mapUserImportRow(row) : mapOrgImportRow(row);
      return {
        rowIndex: index + 2,
        keywords:
          job.kind === 'users'
            ? (mapped as ImportUserRow).assignmentKeywords.slice(0, 20)
            : (mapped as ImportOrgRow).assignmentKeywords.slice(0, 20),
      };
    });
    return res.json({
      assistant: 'rules',
      samples,
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Keyword-Assist fehlgeschlagen.' });
  }
});

router.post('/:id/assist/scope-assignment', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const { job, file } = await loadImportJobWithFile(jobId);
    if (!job || !file) return res.status(404).json({ message: 'Importjob oder Datei nicht gefunden.' });
    await assertJobScope(req, job);
    if (job.kind !== 'users') {
      return res.status(400).json({ message: 'Scope-Assist ist nur für Benutzerimport verfügbar.' });
    }
    const parsed = parseCsvBuffer(fs.readFileSync(file.storage_path), normalizeText(file.encoding || ''));
    const db = getDatabase();
    const orgRows = await db.all<any>(
      `SELECT id, name, external_ref, assignment_keywords_json
       FROM org_units
       WHERE tenant_id = ?
         AND (active = 1 OR active IS NULL)`,
      [job.tenant_id || 'tenant_default']
    );
    const suggestions = parsed.rows.slice(0, 80).map((row, index) => {
      const mapped = mapUserImportRow(row);
      const keywordSet = new Set(mapped.assignmentKeywords.map((entry) => entry.toLowerCase()));
      const best = (orgRows || [])
        .map((org: any) => {
          const orgKeywords = parseKeywords(org?.assignment_keywords_json);
          let score = 0;
          for (const keyword of orgKeywords) {
            if (keywordSet.has(keyword.toLowerCase())) score += 1;
          }
          if (mapped.orgUnitExternalRefs.includes(normalizeText(org?.external_ref))) score += 2;
          return {
            orgUnitId: normalizeText(org?.id),
            orgUnitName: normalizeText(org?.name),
            score,
          };
        })
        .sort((a, b) => b.score - a.score)[0];
      return {
        rowIndex: index + 2,
        username: mapped.username,
        bestMatch: best && best.score > 0 ? best : null,
      };
    });

    return res.json({
      assistant: 'rules',
      suggestions,
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Scope-Assist fehlgeschlagen.' });
  }
});

export default router;
