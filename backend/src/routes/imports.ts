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
import { parseCsvImportBuffer, type ParsedCsvResult } from '../lib/csv-import.js';

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

type ImportKind = 'users' | 'org_units' | 'services';
type ImportJobStatus = 'draft' | 'uploaded' | 'preview_ready' | 'running' | 'completed' | 'failed' | 'cancelled';

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
  salutation: string;
  title: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  workPhone: string;
  building: string;
  floor: string;
  room: string;
  positionSlot: string;
  functionText: string;
  tasksText: string;
  notesText: string;
  phonePublic: string;
  phoneContact: string;
  faxPublic: string;
  faxContact: string;
  mobilePublic: string;
  mobileContact: string;
  emailPublic: string;
  emailContact: string;
  websitePublic: string;
  websiteContact: string;
  postalStreet: string;
  postalHouseNumber: string;
  postalPostalCode: string;
  postalCity: string;
  postalAddressSupplement: string;
  postalElevatorAvailable: boolean;
  postalWheelchairAccessible: boolean;
  postboxPostalCode: string;
  postboxCity: string;
  postboxNumber: string;
  postboxElevatorAvailable: boolean;
  postboxWheelchairAccessible: boolean;
  visitorStreet: string;
  visitorHouseNumber: string;
  visitorPostalCode: string;
  visitorCity: string;
  visitorAddressSupplement: string;
  visitorElevatorAvailable: boolean;
  visitorWheelchairAccessible: boolean;
  deliveryStreet: string;
  deliveryHouseNumber: string;
  deliveryPostalCode: string;
  deliveryCity: string;
  deliveryAddressSupplement: string;
  deliveryElevatorAvailable: boolean;
  deliveryWheelchairAccessible: boolean;
  orgUnitNamesText: string;
  assignmentKeywords: string[];
  orgUnitExternalRefs: string[];
  profileData: Record<string, any>;
}

interface ImportOrgRow {
  externalRef: string;
  name: string;
  typeKey: string;
  typeLabel: string;
  contactEmail: string;
  parentExternalRef: string;
  assignmentKeywords: string[];
  metadata: Record<string, any>;
}

interface ImportServiceRow {
  externalRef: string;
  name: string;
  descriptionHtml: string;
  publicationStatus: string;
  chatbotRelevant: boolean;
  appointmentAllowed: boolean;
  orgUnitRefs: string[];
  userRefs: string[];
  formRefs: string[];
  leikaKey: string;
  ozgServices: string[];
  ozgRelevant: boolean;
  assignmentKeywords: string[];
  metadata: Record<string, any>;
}

const USER_IMPORT_MATCH_FIELDS_DEFAULT = ['external_person_id', 'email', 'username'];
const USER_IMPORT_SELECTED_FIELDS_DEFAULT = [
  'email',
  'salutation',
  'title',
  'first_name',
  'last_name',
  'job_title',
  'work_phone',
  'building',
  'floor',
  'room',
  'position_slot',
  'function_text',
  'tasks_text',
  'notes_text',
  'phone_public',
  'phone_contact',
  'fax_public',
  'fax_contact',
  'mobile_public',
  'mobile_contact',
  'email_public',
  'email_contact',
  'website_public',
  'website_contact',
  'postal_street',
  'postal_house_number',
  'postal_postal_code',
  'postal_city',
  'postal_address_supplement',
  'postal_elevator_available',
  'postal_wheelchair_accessible',
  'postbox_postal_code',
  'postbox_city',
  'postbox_number',
  'postbox_elevator_available',
  'postbox_wheelchair_accessible',
  'visitor_street',
  'visitor_house_number',
  'visitor_postal_code',
  'visitor_city',
  'visitor_address_supplement',
  'visitor_elevator_available',
  'visitor_wheelchair_accessible',
  'delivery_street',
  'delivery_house_number',
  'delivery_postal_code',
  'delivery_city',
  'delivery_address_supplement',
  'delivery_elevator_available',
  'delivery_wheelchair_accessible',
  'org_unit_names_text',
  'assignment_keywords_json',
  'profile_data_json',
  'external_person_id',
];

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

function buildNormalizedRowLookup(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row || {})) {
    const normalizedHeader = normalizeCsvHeader(key);
    if (!normalizedHeader) continue;
    if (!Object.prototype.hasOwnProperty.call(out, normalizedHeader)) {
      out[normalizedHeader] = normalizeText(value);
      continue;
    }
    if (!normalizeText(out[normalizedHeader]) && normalizeText(value)) {
      out[normalizedHeader] = normalizeText(value);
    }
  }
  return out;
}

function pickCsvValue(row: Record<string, string>, aliases: string[]): string {
  if (!row || !aliases || aliases.length === 0) return '';
  const lookup = buildNormalizedRowLookup(row);
  for (const alias of aliases) {
    const direct = normalizeText(row[String(alias || '').trim()]);
    if (direct) return direct;
    const normalized = lookup[normalizeCsvHeader(alias)];
    if (normalizeText(normalized)) return normalizeText(normalized);
  }
  return '';
}

function mapUserImportRow(row: Record<string, string>): ImportUserRow {
  const firstName = pickCsvValue(row, ['Vorname', 'first_name', 'firstname']);
  const lastName = pickCsvValue(row, ['Nachname', 'last_name', 'lastname']);
  const emailContact = pickCsvValue(row, ['E-Mail Kontakt', 'email_kontakt', 'email_contact']);
  const emailPublic = pickCsvValue(row, ['E-Mail Veröffentlichen', 'email_veroeffentlichen', 'email_public']);
  const email = normalizeText(emailContact || emailPublic || pickCsvValue(row, ['E-Mail', 'email']));
  const usernameFallback = [firstName, lastName]
    .filter(Boolean)
    .join('.')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');
  const usernameFromEmail = email.split('@')[0]?.trim().toLowerCase() || '';
  const username = normalizeText(usernameFromEmail || usernameFallback || pickCsvValue(row, ['Id', 'id'])).replace(
    /[^a-z0-9._-]+/gi,
    '_'
  );
  const assignmentKeywords = [
    ...parseKeywords(pickCsvValue(row, ['Aufgaben', 'tasks', 'task_text'])),
    ...parseKeywords(pickCsvValue(row, ['Funktion', 'function', 'role_function'])),
    ...parseKeywords(pickCsvValue(row, ['Stelle', 'position_slot', 'position'])),
    ...parseKeywords(pickCsvValue(row, ['Sonstige Angaben', 'notes', 'bemerkung'])),
  ];
  const orgRefs = pickCsvValue(row, ['Organisationseinheiten-Nummer', 'organisationseinheiten_nummer', 'org_refs'])
    .split(/[,;|]+/g)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

  return {
    externalId: pickCsvValue(row, ['Id', 'id']),
    username: username || `user_${Math.random().toString(36).slice(2, 8)}`,
    email,
    salutation: pickCsvValue(row, ['Anrede', 'salutation']),
    title: pickCsvValue(row, ['Titel', 'title']),
    firstName,
    lastName,
    jobTitle: pickCsvValue(row, ['Positionsbezeichnung', 'position_description', 'Funktion', 'function']),
    workPhone: pickCsvValue(row, ['Telefon Kontakt', 'phone_contact', 'Telefon Veröffentlichen', 'phone_public']),
    building: pickCsvValue(row, ['Gebäude', 'gebaeude', 'building']),
    floor: pickCsvValue(row, ['Stockwerk', 'floor']),
    room: pickCsvValue(row, ['Raum', 'room', 'zimmer']),
    positionSlot: pickCsvValue(row, ['Stelle', 'position_slot']),
    functionText: pickCsvValue(row, ['Funktion', 'function', 'role_function']),
    tasksText: pickCsvValue(row, ['Aufgaben', 'tasks', 'task_text']),
    notesText: pickCsvValue(row, ['Sonstige Angaben', 'notes', 'bemerkung']),
    phonePublic: pickCsvValue(row, ['Telefon Veröffentlichen', 'telefon_veroeffentlichen', 'phone_public']),
    phoneContact: pickCsvValue(row, ['Telefon Kontakt', 'telefon_kontakt', 'phone_contact']),
    faxPublic: pickCsvValue(row, ['Fax Veröffentlichen', 'fax_veroeffentlichen', 'fax_public']),
    faxContact: pickCsvValue(row, ['Fax Kontakt', 'fax_kontakt', 'fax_contact']),
    mobilePublic: pickCsvValue(row, ['Mobil Veröffentlichen', 'mobil_veroeffentlichen', 'mobile_public']),
    mobileContact: pickCsvValue(row, ['Mobil Kontakt', 'mobil_kontakt', 'mobile_contact']),
    emailPublic,
    emailContact,
    websitePublic: pickCsvValue(row, ['Website Veröffentlichen', 'website_veroeffentlichen', 'website_public']),
    websiteContact: pickCsvValue(row, ['Website Kontakt', 'website_kontakt', 'website_contact']),
    postalStreet: pickCsvValue(row, ['Postadresse Straße', 'postadresse_strasse', 'postal_street']),
    postalHouseNumber: pickCsvValue(row, ['Postadresse Hausnummer', 'postadresse_hausnummer', 'postal_house_number']),
    postalPostalCode: pickCsvValue(row, ['Postadresse PLZ', 'postadresse_plz', 'postal_postal_code']),
    postalCity: pickCsvValue(row, ['Postadresse Ort', 'postadresse_ort', 'postal_city']),
    postalAddressSupplement: pickCsvValue(row, ['Postadresse Adresszusatz', 'postadresse_adresszusatz', 'postal_address_supplement']),
    postalElevatorAvailable: parseBooleanLike(
      pickCsvValue(row, ['Postadresse Aufzug vorhanden', 'postadresse_aufzug_vorhanden', 'postal_elevator_available'])
    ),
    postalWheelchairAccessible: parseBooleanLike(
      pickCsvValue(row, ['Postadresse Rollstuhlgeeignet', 'postadresse_rollstuhlgeeignet', 'postal_wheelchair_accessible'])
    ),
    postboxPostalCode: pickCsvValue(row, ['Postfach PLZ', 'postfach_plz', 'postbox_postal_code']),
    postboxCity: pickCsvValue(row, ['Postfach Ort', 'postfach_ort', 'postbox_city']),
    postboxNumber: pickCsvValue(row, ['Postfach Postfach', 'postfach_postfach', 'postbox_number']),
    postboxElevatorAvailable: parseBooleanLike(
      pickCsvValue(row, ['Postfach Aufzug vorhanden', 'postfach_aufzug_vorhanden', 'postbox_elevator_available'])
    ),
    postboxWheelchairAccessible: parseBooleanLike(
      pickCsvValue(row, ['Postfach Rollstuhlgeeignet', 'postfach_rollstuhlgeeignet', 'postbox_wheelchair_accessible'])
    ),
    visitorStreet: pickCsvValue(row, ['Besucheradresse Straße', 'besucheradresse_strasse', 'visitor_street']),
    visitorHouseNumber: pickCsvValue(row, ['Besucheradresse Hausnummer', 'besucheradresse_hausnummer', 'visitor_house_number']),
    visitorPostalCode: pickCsvValue(row, ['Besucheradresse PLZ', 'besucheradresse_plz', 'visitor_postal_code']),
    visitorCity: pickCsvValue(row, ['Besucheradresse Ort', 'besucheradresse_ort', 'visitor_city']),
    visitorAddressSupplement: pickCsvValue(
      row,
      ['Besucheradresse Adresszusatz', 'besucheradresse_adresszusatz', 'visitor_address_supplement']
    ),
    visitorElevatorAvailable: parseBooleanLike(
      pickCsvValue(row, ['Besucheradresse Aufzug vorhanden', 'besucheradresse_aufzug_vorhanden', 'visitor_elevator_available'])
    ),
    visitorWheelchairAccessible: parseBooleanLike(
      pickCsvValue(row, ['Besucheradresse Rollstuhlgeeignet', 'besucheradresse_rollstuhlgeeignet', 'visitor_wheelchair_accessible'])
    ),
    deliveryStreet: pickCsvValue(row, ['Lieferadresse Straße', 'lieferadresse_strasse', 'delivery_street']),
    deliveryHouseNumber: pickCsvValue(row, ['Lieferadresse Hausnummer', 'lieferadresse_hausnummer', 'delivery_house_number']),
    deliveryPostalCode: pickCsvValue(row, ['Lieferadresse PLZ', 'lieferadresse_plz', 'delivery_postal_code']),
    deliveryCity: pickCsvValue(row, ['Lieferadresse Ort', 'lieferadresse_ort', 'delivery_city']),
    deliveryAddressSupplement: pickCsvValue(row, ['Lieferadresse Adresszusatz', 'lieferadresse_adresszusatz', 'delivery_address_supplement']),
    deliveryElevatorAvailable: parseBooleanLike(
      pickCsvValue(row, ['Lieferadresse Aufzug vorhanden', 'lieferadresse_aufzug_vorhanden', 'delivery_elevator_available'])
    ),
    deliveryWheelchairAccessible: parseBooleanLike(
      pickCsvValue(row, ['Lieferadresse Rollstuhlgeeignet', 'lieferadresse_rollstuhlgeeignet', 'delivery_wheelchair_accessible'])
    ),
    orgUnitNamesText: pickCsvValue(row, ['Organisationseinheiten-Name', 'organisationseinheiten_name', 'org_names']),
    assignmentKeywords,
    orgUnitExternalRefs: Array.from(new Set(orgRefs)),
    profileData: { ...row },
  };
}

function mapOrgImportRow(row: Record<string, string>): ImportOrgRow {
  const name = pickCsvValue(row, ['Bezeichnung', 'Name', 'Organisationseinheit', 'org_unit_name']);
  const typeLabel = pickCsvValue(row, [
    'Organisationseinheitstyp',
    'Organisationstyp',
    'Typ',
    'Bereichstyp',
    'Strukturtyp',
    'org_unit_type',
  ]);
  const typeKey = pickCsvValue(row, [
    'Organisationseinheitstyp-Key',
    'Organisationstyp-Key',
    'Typ-Key',
    'org_unit_type_key',
  ]);
  const assignmentKeywords = [
    ...parseKeywords(name),
    ...parseKeywords(pickCsvValue(row, ['Sonstige Angaben', 'Bemerkung', 'Notiz'])),
    ...parseKeywords(pickCsvValue(row, ['Anmerkung', 'Hinweis'])),
    ...parseKeywords(typeLabel),
  ];
  return {
    externalRef: pickCsvValue(row, ['Id', 'ID', 'external_ref', 'Externe Referenz']),
    name,
    typeKey,
    typeLabel,
    contactEmail: pickCsvValue(row, ['E-Mail Kontakt', 'E-Mail Veröffentlichen', 'Kontakt-E-Mail', 'contact_email']),
    parentExternalRef: pickCsvValue(row, [
      'Übergeordnete Organisationseinheit',
      'Uebergeordnete Organisationseinheit',
      'Parent',
      'Parent-Ref',
      'parent_external_ref',
    ]),
    assignmentKeywords,
    metadata: { ...row },
  };
}

function parseBooleanLike(value: unknown): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return false;
  return ['true', '1', 'ja', 'yes', 'y', 'x', 'wahr'].includes(normalized);
}

function parseRefList(raw: unknown): string[] {
  return normalizeText(raw)
    .split(/[\n,;|/]+/g)
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .slice(0, 200);
}

function mapServiceImportRow(row: Record<string, string>): ImportServiceRow {
  const name = pickCsvValue(row, ['Bezeichnung', 'Name', 'service_name']);
  const descriptionHtml = pickCsvValue(row, ['Beschreibung', 'description', 'description_html']);
  const publicationStatus = pickCsvValue(row, [
    'Veröffentlichungsstatus',
    'Veroffentlichungsstatus',
    'Veröffentlichungs Status',
    'Veroffentlichungs Status',
    'publication_status',
  ]);
  const chatbotRelevant = parseBooleanLike(pickCsvValue(row, ['Chatbot-relevant', 'Chatbot relevant', 'chatbot_relevant']));
  const appointmentAllowed = parseBooleanLike(
    pickCsvValue(row, [
      'zugelassen für Terminvereinbarungen',
      'zugelassen fuer Terminvereinbarungen',
      'Terminvereinbarung',
      'appointment_allowed',
    ])
  );
  const orgUnitRefs = parseRefList(pickCsvValue(row, ['Organisationseinheiten', 'Organisationseinheit', 'org_units']));
  const userRefs = parseRefList(pickCsvValue(row, ['Mitarbeiter', 'Mitarbeitende', 'users']));
  const formRefs = parseRefList(pickCsvValue(row, ['Formulare', 'Formular', 'forms']));
  const leikaKey = pickCsvValue(row, ['LeiKa-Schlüssel', 'LeiKa-Schluessel', 'LeiKa', 'leika_key']);
  const ozgServices = parseKeywords(pickCsvValue(row, ['OZG-Leistungen', 'OZG Leistungen', 'ozg_services']));
  const ozgRelevant = parseBooleanLike(pickCsvValue(row, ['OZG-Relevant', 'OZG Relevant', 'ozg_relevant']));
  const assignmentKeywords = [
    ...parseKeywords(name),
    ...parseKeywords(leikaKey),
    ...ozgServices,
  ];
  return {
    externalRef: pickCsvValue(row, ['Id', 'ID', 'external_ref', 'Externe Referenz']),
    name,
    descriptionHtml,
    publicationStatus,
    chatbotRelevant,
    appointmentAllowed,
    orgUnitRefs: Array.from(new Set(orgUnitRefs)),
    userRefs: Array.from(new Set(userRefs)),
    formRefs: Array.from(new Set(formRefs)),
    leikaKey,
    ozgServices,
    ozgRelevant,
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
  } else if (kind === 'org_units') {
    if (!hasAnyCapability(capabilities, ['settings.organization.global.manage', 'settings.organization.tenant.manage'])) {
      throw new Error('Keine Berechtigung für Organisationsimport.');
    }
  } else if (
    !hasAnyCapability(capabilities, [
      'settings.organization.global.manage',
      'settings.organization.tenant.manage',
      'settings.categories.manage',
    ])
  ) {
    throw new Error('Keine Berechtigung für Leistungsimport.');
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
    kind:
      normalizeText(row.kind) === 'org_units'
        ? 'org_units'
        : normalizeText(row.kind) === 'services'
        ? 'services'
        : 'users',
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
  } else if (job.kind === 'org_units') {
    if (!hasAnyCapability(capabilities, ['settings.organization.global.manage', 'settings.organization.tenant.manage'])) {
      throw new Error('Keine Berechtigung.');
    }
  } else if (
    !hasAnyCapability(capabilities, [
      'settings.organization.global.manage',
      'settings.organization.tenant.manage',
      'settings.categories.manage',
    ])
  ) {
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
    return [];
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

async function findServiceMatches(
  tenantId: string,
  service: ImportServiceRow,
  matchFields: string[]
): Promise<Array<{ id: string }>> {
  const db = getDatabase();
  const out: Array<{ id: string }> = [];
  const seen = new Set<string>();
  const normalized = new Set(matchFields.map((entry) => normalizeText(entry).toLowerCase()));

  if (normalized.has('external_ref') && service.externalRef) {
    const rows = await db.all<any>(
      `SELECT id
       FROM services_catalog
       WHERE tenant_id = ? AND external_ref = ?
       LIMIT 5`,
      [tenantId, service.externalRef]
    );
    for (const row of rows || []) {
      const id = normalizeText(row?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id });
    }
  }
  if (normalized.has('name') && service.name) {
    const rows = await db.all<any>(
      `SELECT id
       FROM services_catalog
       WHERE tenant_id = ? AND LOWER(name) = ?
       LIMIT 5`,
      [tenantId, service.name.toLowerCase()]
    );
    for (const row of rows || []) {
      const id = normalizeText(row?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id });
    }
  }
  if (normalized.has('leika_key') && service.leikaKey) {
    const rows = await db.all<any>(
      `SELECT id
       FROM services_catalog
       WHERE tenant_id = ? AND leika_key = ?
       LIMIT 5`,
      [tenantId, service.leikaKey]
    );
    for (const row of rows || []) {
      const id = normalizeText(row?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id });
    }
  }
  return out;
}

async function resolveOrgUnitRefs(tenantId: string, refs: string[]): Promise<string[]> {
  const db = getDatabase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs || []) {
    const candidate = normalizeText(ref);
    if (!candidate) continue;
    const row = await db.get<any>(
      `SELECT id
       FROM org_units
       WHERE tenant_id = ?
         AND (
           external_ref = ?
           OR LOWER(name) = ?
           OR id = ?
         )
       LIMIT 1`,
      [tenantId, candidate, candidate.toLowerCase(), candidate]
    );
    const id = normalizeText(row?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function resolveAdminUserRefs(tenantId: string, refs: string[]): Promise<string[]> {
  const db = getDatabase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs || []) {
    const candidate = normalizeText(ref);
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    const row = await db.get<any>(
      `SELECT u.id
       FROM admin_users u
       WHERE (
         u.external_person_id = ?
         OR LOWER(u.username) = ?
         OR LOWER(COALESCE(u.email, '')) = ?
         OR LOWER(COALESCE(u.first_name, '')) = ?
         OR LOWER(COALESCE(u.last_name, '')) = ?
         OR u.id = ?
       )
       AND (
         EXISTS (
           SELECT 1 FROM admin_user_tenant_scopes ts
           WHERE ts.admin_user_id = u.id AND ts.tenant_id = ?
         )
         OR EXISTS (
           SELECT 1 FROM admin_user_org_scopes os
           WHERE os.admin_user_id = u.id AND os.tenant_id = ?
         )
       )
       LIMIT 1`,
      [candidate, lower, lower, lower, lower, candidate, tenantId, tenantId]
    );
    const id = normalizeText(row?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function shouldApplyField(selectedFields: string[] | undefined, key: string): boolean {
  if (!selectedFields) return true;
  if (selectedFields.length === 0) return false;
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
  const apply = (key: string) => shouldApplyField(selectedFields, key);
  const boolAsDb = (value: boolean, key: string) => (apply(key) ? (value ? 1 : 0) : null);
  const textOrNull = (value: unknown, key: string) => (apply(key) ? normalizeText(value) || null : null);
  const hasEmail = apply('email') && normalizeText(input.row.email).length > 0;
  const activeFlag = hasEmail ? 1 : 0;
  const emailValue = hasEmail ? input.row.email : null;
  let userId = matches[0]?.id || '';

  if (!userId) {
    const password = `invite_${crypto.randomBytes(12).toString('hex')}`;
    const hash = await bcryptjs.hash(password, 10);
    const username = await ensureUniqueUsername(input.row.username);
    userId = createId('user');
    await db.run(
      `INSERT INTO admin_users (
         id, username, password_hash, role, active, email, first_name, last_name, job_title, work_phone,
         assignment_keywords_json, profile_data_json, external_person_id,
         salutation, title, building, floor, room, position_slot, function_text, tasks_text, notes_text,
         phone_public, phone_contact, fax_public, fax_contact, mobile_public, mobile_contact,
         email_public, email_contact, website_public, website_contact,
         postal_street, postal_house_number, postal_postal_code, postal_city, postal_address_supplement,
         postal_elevator_available, postal_wheelchair_accessible,
         postbox_postal_code, postbox_city, postbox_number, postbox_elevator_available, postbox_wheelchair_accessible,
         visitor_street, visitor_house_number, visitor_postal_code, visitor_city, visitor_address_supplement,
         visitor_elevator_available, visitor_wheelchair_accessible,
         delivery_street, delivery_house_number, delivery_postal_code, delivery_city, delivery_address_supplement,
         delivery_elevator_available, delivery_wheelchair_accessible, org_unit_names_text
       ) VALUES (
         ?, ?, ?, 'SACHBEARBEITER', ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?
       )`,
      [
        userId,
        username,
        hash,
        activeFlag,
        emailValue,
        textOrNull(input.row.firstName, 'first_name'),
        textOrNull(input.row.lastName, 'last_name'),
        textOrNull(input.row.jobTitle, 'job_title'),
        textOrNull(input.row.workPhone, 'work_phone'),
        apply('assignment_keywords_json') ? assignmentKeywordsJson : null,
        apply('profile_data_json') ? profileDataJson : null,
        textOrNull(input.row.externalId, 'external_person_id'),
        textOrNull(input.row.salutation, 'salutation'),
        textOrNull(input.row.title, 'title'),
        textOrNull(input.row.building, 'building'),
        textOrNull(input.row.floor, 'floor'),
        textOrNull(input.row.room, 'room'),
        textOrNull(input.row.positionSlot, 'position_slot'),
        textOrNull(input.row.functionText, 'function_text'),
        textOrNull(input.row.tasksText, 'tasks_text'),
        textOrNull(input.row.notesText, 'notes_text'),
        textOrNull(input.row.phonePublic, 'phone_public'),
        textOrNull(input.row.phoneContact, 'phone_contact'),
        textOrNull(input.row.faxPublic, 'fax_public'),
        textOrNull(input.row.faxContact, 'fax_contact'),
        textOrNull(input.row.mobilePublic, 'mobile_public'),
        textOrNull(input.row.mobileContact, 'mobile_contact'),
        textOrNull(input.row.emailPublic, 'email_public'),
        textOrNull(input.row.emailContact, 'email_contact'),
        textOrNull(input.row.websitePublic, 'website_public'),
        textOrNull(input.row.websiteContact, 'website_contact'),
        textOrNull(input.row.postalStreet, 'postal_street'),
        textOrNull(input.row.postalHouseNumber, 'postal_house_number'),
        textOrNull(input.row.postalPostalCode, 'postal_postal_code'),
        textOrNull(input.row.postalCity, 'postal_city'),
        textOrNull(input.row.postalAddressSupplement, 'postal_address_supplement'),
        boolAsDb(input.row.postalElevatorAvailable, 'postal_elevator_available'),
        boolAsDb(input.row.postalWheelchairAccessible, 'postal_wheelchair_accessible'),
        textOrNull(input.row.postboxPostalCode, 'postbox_postal_code'),
        textOrNull(input.row.postboxCity, 'postbox_city'),
        textOrNull(input.row.postboxNumber, 'postbox_number'),
        boolAsDb(input.row.postboxElevatorAvailable, 'postbox_elevator_available'),
        boolAsDb(input.row.postboxWheelchairAccessible, 'postbox_wheelchair_accessible'),
        textOrNull(input.row.visitorStreet, 'visitor_street'),
        textOrNull(input.row.visitorHouseNumber, 'visitor_house_number'),
        textOrNull(input.row.visitorPostalCode, 'visitor_postal_code'),
        textOrNull(input.row.visitorCity, 'visitor_city'),
        textOrNull(input.row.visitorAddressSupplement, 'visitor_address_supplement'),
        boolAsDb(input.row.visitorElevatorAvailable, 'visitor_elevator_available'),
        boolAsDb(input.row.visitorWheelchairAccessible, 'visitor_wheelchair_accessible'),
        textOrNull(input.row.deliveryStreet, 'delivery_street'),
        textOrNull(input.row.deliveryHouseNumber, 'delivery_house_number'),
        textOrNull(input.row.deliveryPostalCode, 'delivery_postal_code'),
        textOrNull(input.row.deliveryCity, 'delivery_city'),
        textOrNull(input.row.deliveryAddressSupplement, 'delivery_address_supplement'),
        boolAsDb(input.row.deliveryElevatorAvailable, 'delivery_elevator_available'),
        boolAsDb(input.row.deliveryWheelchairAccessible, 'delivery_wheelchair_accessible'),
        textOrNull(input.row.orgUnitNamesText, 'org_unit_names_text'),
      ]
    );
    await db.run(
      `INSERT INTO admin_user_tenant_scopes (id, admin_user_id, tenant_id, is_tenant_admin)
       VALUES (?, ?, ?, 0)`,
      [createId('auts'), userId, input.tenantId]
    );

    if (input.autoAssignOrgScopes) {
      const orgScopeIds = await resolveOrgScopeIdsForUserImport(input.tenantId, input.row);
      for (const orgUnitId of orgScopeIds) {
        const existing = await db.get<any>(
          `SELECT id FROM admin_user_org_scopes WHERE admin_user_id = ? AND tenant_id = ? AND org_unit_id = ? LIMIT 1`,
          [userId, input.tenantId, orgUnitId]
        );
        if (existing?.id) continue;
        await db.run(
          `INSERT INTO admin_user_org_scopes (id, admin_user_id, tenant_id, org_unit_id, can_write)
           VALUES (?, ?, ?, ?, 0)`,
          [createId('auos'), userId, input.tenantId, orgUnitId]
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
  const pushUpdate = (fieldKey: string, column: string, value: any) => {
    if (!shouldApplyField(selectedFields, fieldKey)) return;
    updates.push(`${column} = ?`);
    params.push(value);
  };
  if (shouldApplyField(selectedFields, 'email')) {
    updates.push('email = ?');
    params.push(hasEmail ? input.row.email : null);
    updates.push('active = ?');
    params.push(activeFlag);
  }
  pushUpdate('first_name', 'first_name', input.row.firstName || null);
  pushUpdate('last_name', 'last_name', input.row.lastName || null);
  pushUpdate('job_title', 'job_title', input.row.jobTitle || null);
  pushUpdate('work_phone', 'work_phone', input.row.workPhone || null);
  pushUpdate('assignment_keywords_json', 'assignment_keywords_json', assignmentKeywordsJson);
  pushUpdate('profile_data_json', 'profile_data_json', profileDataJson);
  pushUpdate('external_person_id', 'external_person_id', input.row.externalId || null);
  pushUpdate('salutation', 'salutation', input.row.salutation || null);
  pushUpdate('title', 'title', input.row.title || null);
  pushUpdate('building', 'building', input.row.building || null);
  pushUpdate('floor', 'floor', input.row.floor || null);
  pushUpdate('room', 'room', input.row.room || null);
  pushUpdate('position_slot', 'position_slot', input.row.positionSlot || null);
  pushUpdate('function_text', 'function_text', input.row.functionText || null);
  pushUpdate('tasks_text', 'tasks_text', input.row.tasksText || null);
  pushUpdate('notes_text', 'notes_text', input.row.notesText || null);
  pushUpdate('phone_public', 'phone_public', input.row.phonePublic || null);
  pushUpdate('phone_contact', 'phone_contact', input.row.phoneContact || null);
  pushUpdate('fax_public', 'fax_public', input.row.faxPublic || null);
  pushUpdate('fax_contact', 'fax_contact', input.row.faxContact || null);
  pushUpdate('mobile_public', 'mobile_public', input.row.mobilePublic || null);
  pushUpdate('mobile_contact', 'mobile_contact', input.row.mobileContact || null);
  pushUpdate('email_public', 'email_public', input.row.emailPublic || null);
  pushUpdate('email_contact', 'email_contact', input.row.emailContact || null);
  pushUpdate('website_public', 'website_public', input.row.websitePublic || null);
  pushUpdate('website_contact', 'website_contact', input.row.websiteContact || null);
  pushUpdate('postal_street', 'postal_street', input.row.postalStreet || null);
  pushUpdate('postal_house_number', 'postal_house_number', input.row.postalHouseNumber || null);
  pushUpdate('postal_postal_code', 'postal_postal_code', input.row.postalPostalCode || null);
  pushUpdate('postal_city', 'postal_city', input.row.postalCity || null);
  pushUpdate('postal_address_supplement', 'postal_address_supplement', input.row.postalAddressSupplement || null);
  pushUpdate('postal_elevator_available', 'postal_elevator_available', input.row.postalElevatorAvailable ? 1 : 0);
  pushUpdate('postal_wheelchair_accessible', 'postal_wheelchair_accessible', input.row.postalWheelchairAccessible ? 1 : 0);
  pushUpdate('postbox_postal_code', 'postbox_postal_code', input.row.postboxPostalCode || null);
  pushUpdate('postbox_city', 'postbox_city', input.row.postboxCity || null);
  pushUpdate('postbox_number', 'postbox_number', input.row.postboxNumber || null);
  pushUpdate('postbox_elevator_available', 'postbox_elevator_available', input.row.postboxElevatorAvailable ? 1 : 0);
  pushUpdate(
    'postbox_wheelchair_accessible',
    'postbox_wheelchair_accessible',
    input.row.postboxWheelchairAccessible ? 1 : 0
  );
  pushUpdate('visitor_street', 'visitor_street', input.row.visitorStreet || null);
  pushUpdate('visitor_house_number', 'visitor_house_number', input.row.visitorHouseNumber || null);
  pushUpdate('visitor_postal_code', 'visitor_postal_code', input.row.visitorPostalCode || null);
  pushUpdate('visitor_city', 'visitor_city', input.row.visitorCity || null);
  pushUpdate('visitor_address_supplement', 'visitor_address_supplement', input.row.visitorAddressSupplement || null);
  pushUpdate('visitor_elevator_available', 'visitor_elevator_available', input.row.visitorElevatorAvailable ? 1 : 0);
  pushUpdate(
    'visitor_wheelchair_accessible',
    'visitor_wheelchair_accessible',
    input.row.visitorWheelchairAccessible ? 1 : 0
  );
  pushUpdate('delivery_street', 'delivery_street', input.row.deliveryStreet || null);
  pushUpdate('delivery_house_number', 'delivery_house_number', input.row.deliveryHouseNumber || null);
  pushUpdate('delivery_postal_code', 'delivery_postal_code', input.row.deliveryPostalCode || null);
  pushUpdate('delivery_city', 'delivery_city', input.row.deliveryCity || null);
  pushUpdate('delivery_address_supplement', 'delivery_address_supplement', input.row.deliveryAddressSupplement || null);
  pushUpdate('delivery_elevator_available', 'delivery_elevator_available', input.row.deliveryElevatorAvailable ? 1 : 0);
  pushUpdate(
    'delivery_wheelchair_accessible',
    'delivery_wheelchair_accessible',
    input.row.deliveryWheelchairAccessible ? 1 : 0
  );
  pushUpdate('org_unit_names_text', 'org_unit_names_text', input.row.orgUnitNamesText || null);

  if (updates.length === 0) return 'skipped';
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(userId);
  await db.run(`UPDATE admin_users SET ${updates.join(', ')} WHERE id = ?`, params);

  if (input.autoAssignOrgScopes) {
    const orgScopeIds = await resolveOrgScopeIdsForUserImport(input.tenantId, input.row);
    for (const orgUnitId of orgScopeIds) {
      const existing = await db.get<any>(
        `SELECT id FROM admin_user_org_scopes WHERE admin_user_id = ? AND tenant_id = ? AND org_unit_id = ? LIMIT 1`,
        [userId, input.tenantId, orgUnitId]
      );
      if (existing?.id) continue;
      await db.run(
        `INSERT INTO admin_user_org_scopes (id, admin_user_id, tenant_id, org_unit_id, can_write)
         VALUES (?, ?, ?, ?, 0)`,
        [createId('auos'), userId, input.tenantId, orgUnitId]
      );
    }
  }

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

function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith('[')) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeComparableValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return normalizeText(value);
}

function buildIncomingUserFieldMap(row: ImportUserRow): Record<string, any> {
  return {
    email: row.email || null,
    first_name: row.firstName || null,
    last_name: row.lastName || null,
    job_title: row.jobTitle || null,
    work_phone: row.workPhone || null,
    assignment_keywords_json: serializeKeywords(row.assignmentKeywords),
    profile_data_json: JSON.stringify(row.profileData || {}),
    external_person_id: row.externalId || null,
    salutation: row.salutation || null,
    title: row.title || null,
    building: row.building || null,
    floor: row.floor || null,
    room: row.room || null,
    position_slot: row.positionSlot || null,
    function_text: row.functionText || null,
    tasks_text: row.tasksText || null,
    notes_text: row.notesText || null,
    phone_public: row.phonePublic || null,
    phone_contact: row.phoneContact || null,
    fax_public: row.faxPublic || null,
    fax_contact: row.faxContact || null,
    mobile_public: row.mobilePublic || null,
    mobile_contact: row.mobileContact || null,
    email_public: row.emailPublic || null,
    email_contact: row.emailContact || null,
    website_public: row.websitePublic || null,
    website_contact: row.websiteContact || null,
    postal_street: row.postalStreet || null,
    postal_house_number: row.postalHouseNumber || null,
    postal_postal_code: row.postalPostalCode || null,
    postal_city: row.postalCity || null,
    postal_address_supplement: row.postalAddressSupplement || null,
    postal_elevator_available: row.postalElevatorAvailable ? 1 : 0,
    postal_wheelchair_accessible: row.postalWheelchairAccessible ? 1 : 0,
    postbox_postal_code: row.postboxPostalCode || null,
    postbox_city: row.postboxCity || null,
    postbox_number: row.postboxNumber || null,
    postbox_elevator_available: row.postboxElevatorAvailable ? 1 : 0,
    postbox_wheelchair_accessible: row.postboxWheelchairAccessible ? 1 : 0,
    visitor_street: row.visitorStreet || null,
    visitor_house_number: row.visitorHouseNumber || null,
    visitor_postal_code: row.visitorPostalCode || null,
    visitor_city: row.visitorCity || null,
    visitor_address_supplement: row.visitorAddressSupplement || null,
    visitor_elevator_available: row.visitorElevatorAvailable ? 1 : 0,
    visitor_wheelchair_accessible: row.visitorWheelchairAccessible ? 1 : 0,
    delivery_street: row.deliveryStreet || null,
    delivery_house_number: row.deliveryHouseNumber || null,
    delivery_postal_code: row.deliveryPostalCode || null,
    delivery_city: row.deliveryCity || null,
    delivery_address_supplement: row.deliveryAddressSupplement || null,
    delivery_elevator_available: row.deliveryElevatorAvailable ? 1 : 0,
    delivery_wheelchair_accessible: row.deliveryWheelchairAccessible ? 1 : 0,
    org_unit_names_text: row.orgUnitNamesText || null,
  };
}

function buildCurrentUserFieldMap(row: any): Record<string, any> {
  const currentAssignmentKeywords = serializeKeywords(parseJsonArray(row?.assignment_keywords_json));
  const currentProfileDataJson = JSON.stringify(parseJsonObject(row?.profile_data_json));
  return {
    email: normalizeText(row?.email) || null,
    first_name: normalizeText(row?.first_name) || null,
    last_name: normalizeText(row?.last_name) || null,
    job_title: normalizeText(row?.job_title) || null,
    work_phone: normalizeText(row?.work_phone) || null,
    assignment_keywords_json: currentAssignmentKeywords,
    profile_data_json: currentProfileDataJson,
    external_person_id: normalizeText(row?.external_person_id) || null,
    salutation: normalizeText(row?.salutation) || null,
    title: normalizeText(row?.title) || null,
    building: normalizeText(row?.building) || null,
    floor: normalizeText(row?.floor) || null,
    room: normalizeText(row?.room) || null,
    position_slot: normalizeText(row?.position_slot) || null,
    function_text: normalizeText(row?.function_text) || null,
    tasks_text: normalizeText(row?.tasks_text) || null,
    notes_text: normalizeText(row?.notes_text) || null,
    phone_public: normalizeText(row?.phone_public) || null,
    phone_contact: normalizeText(row?.phone_contact) || null,
    fax_public: normalizeText(row?.fax_public) || null,
    fax_contact: normalizeText(row?.fax_contact) || null,
    mobile_public: normalizeText(row?.mobile_public) || null,
    mobile_contact: normalizeText(row?.mobile_contact) || null,
    email_public: normalizeText(row?.email_public) || null,
    email_contact: normalizeText(row?.email_contact) || null,
    website_public: normalizeText(row?.website_public) || null,
    website_contact: normalizeText(row?.website_contact) || null,
    postal_street: normalizeText(row?.postal_street) || null,
    postal_house_number: normalizeText(row?.postal_house_number) || null,
    postal_postal_code: normalizeText(row?.postal_postal_code) || null,
    postal_city: normalizeText(row?.postal_city) || null,
    postal_address_supplement: normalizeText(row?.postal_address_supplement) || null,
    postal_elevator_available: Number(row?.postal_elevator_available || 0) === 1 ? 1 : 0,
    postal_wheelchair_accessible: Number(row?.postal_wheelchair_accessible || 0) === 1 ? 1 : 0,
    postbox_postal_code: normalizeText(row?.postbox_postal_code) || null,
    postbox_city: normalizeText(row?.postbox_city) || null,
    postbox_number: normalizeText(row?.postbox_number) || null,
    postbox_elevator_available: Number(row?.postbox_elevator_available || 0) === 1 ? 1 : 0,
    postbox_wheelchair_accessible: Number(row?.postbox_wheelchair_accessible || 0) === 1 ? 1 : 0,
    visitor_street: normalizeText(row?.visitor_street) || null,
    visitor_house_number: normalizeText(row?.visitor_house_number) || null,
    visitor_postal_code: normalizeText(row?.visitor_postal_code) || null,
    visitor_city: normalizeText(row?.visitor_city) || null,
    visitor_address_supplement: normalizeText(row?.visitor_address_supplement) || null,
    visitor_elevator_available: Number(row?.visitor_elevator_available || 0) === 1 ? 1 : 0,
    visitor_wheelchair_accessible: Number(row?.visitor_wheelchair_accessible || 0) === 1 ? 1 : 0,
    delivery_street: normalizeText(row?.delivery_street) || null,
    delivery_house_number: normalizeText(row?.delivery_house_number) || null,
    delivery_postal_code: normalizeText(row?.delivery_postal_code) || null,
    delivery_city: normalizeText(row?.delivery_city) || null,
    delivery_address_supplement: normalizeText(row?.delivery_address_supplement) || null,
    delivery_elevator_available: Number(row?.delivery_elevator_available || 0) === 1 ? 1 : 0,
    delivery_wheelchair_accessible: Number(row?.delivery_wheelchair_accessible || 0) === 1 ? 1 : 0,
    org_unit_names_text: normalizeText(row?.org_unit_names_text) || null,
  };
}

function buildUserImportDiff(input: {
  incoming: ImportUserRow;
  current: any;
  selectedFields?: string[];
}): Array<{ field: string; current: any; incoming: any; changed: boolean }> {
  const incomingMap = buildIncomingUserFieldMap(input.incoming);
  const currentMap = buildCurrentUserFieldMap(input.current || {});
  const keys = Array.from(new Set(Object.keys(incomingMap)));
  return keys
    .filter((field) => shouldApplyField(input.selectedFields, field))
    .map((field) => {
      const incomingValue = incomingMap[field];
      const currentValue = currentMap[field];
      const changed = normalizeComparableValue(incomingValue) !== normalizeComparableValue(currentValue);
      return {
        field,
        current: currentValue,
        incoming: incomingValue,
        changed,
      };
    });
}

type OrgTypeMatchMode = 'key' | 'label' | 'both';
type OrgTypeStrategy = 'single' | 'csv_column' | 'infer_from_name';

function normalizeOrgTypeLabel(value: unknown, stripNumbers = true): string {
  let label = normalizeText(value).replace(/\s+/g, ' ');
  if (!label) return '';
  if (stripNumbers) {
    label = label.replace(/\s+\d+\b/g, '').trim();
  }
  return label.slice(0, 80);
}

function normalizeOrgTypeKey(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function inferOrgTypeLabelFromName(name: string): string {
  const normalizedName = normalizeText(name).replace(/\s+/g, ' ');
  if (!normalizedName) return '';
  if (normalizedName.includes(' - ')) {
    return normalizedName.split(' - ')[0].trim();
  }
  if (normalizedName.includes(':')) {
    return normalizedName.split(':')[0].trim();
  }
  const firstTwo = normalizedName.split(' ').slice(0, 2).join(' ').trim();
  return firstTwo || normalizedName;
}

function applyOrgTypeRenameMap(label: string, renameMap: Record<string, string>): string {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel) return '';
  const direct = normalizeText(renameMap[normalizedLabel]);
  if (direct) return direct;
  const lower = normalizedLabel.toLowerCase();
  for (const [source, target] of Object.entries(renameMap || {})) {
    if (normalizeText(source).toLowerCase() === lower) {
      const normalizedTarget = normalizeText(target);
      if (normalizedTarget) return normalizedTarget;
    }
  }
  return normalizedLabel;
}

function buildOrgTypeDescriptorFromRow(
  row: ImportOrgRow,
  options: Record<string, any>
): { key: string; label: string } {
  const strategy = normalizeText(options.orgTypeStrategy || 'single').toLowerCase() as OrgTypeStrategy;
  const stripNumbers = options.orgTypeStripNumbers !== false;
  const renameMap = parseJsonObject(options.orgTypeRenameMap);

  let candidateLabel = '';
  let candidateKey = '';

  if (strategy === 'csv_column') {
    const csvLabel = normalizeOrgTypeLabel(row.typeLabel, stripNumbers);
    const csvKey = normalizeOrgTypeKey(row.typeKey);
    candidateLabel = csvLabel;
    candidateKey = csvKey;
  } else if (strategy === 'infer_from_name') {
    const base = row.typeLabel || inferOrgTypeLabelFromName(row.name);
    candidateLabel = normalizeOrgTypeLabel(base, stripNumbers);
    candidateKey = normalizeOrgTypeKey(row.typeKey || candidateLabel);
  } else {
    candidateLabel = normalizeOrgTypeLabel(options.orgTypeLabel || 'Fachbereich', stripNumbers);
    candidateKey = normalizeOrgTypeKey(options.orgTypeKey || candidateLabel || 'fachbereich');
  }

  const fallbackLabel = normalizeOrgTypeLabel(options.orgTypeLabel || 'Fachbereich', stripNumbers) || 'Fachbereich';
  const fallbackKey = normalizeOrgTypeKey(options.orgTypeKey || fallbackLabel || 'fachbereich') || 'fachbereich';

  const renamedLabel = applyOrgTypeRenameMap(candidateLabel || fallbackLabel, renameMap);
  const finalLabel = normalizeOrgTypeLabel(renamedLabel || fallbackLabel, stripNumbers) || fallbackLabel;
  const finalKey = normalizeOrgTypeKey(candidateKey || finalLabel || fallbackKey) || fallbackKey;
  return { key: finalKey, label: finalLabel };
}

async function ensureOrgType(
  tenantId: string,
  key = 'fachbereich',
  label = 'Fachbereich',
  matchModeRaw: unknown = 'both'
): Promise<string> {
  const db = getDatabase();
  const normalizedLabel = normalizeOrgTypeLabel(label, false) || 'Fachbereich';
  const normalizedKey = normalizeOrgTypeKey(key) || normalizeOrgTypeKey(normalizedLabel) || 'fachbereich';
  const matchMode = ((): OrgTypeMatchMode => {
    const normalized = normalizeText(matchModeRaw).toLowerCase();
    if (normalized === 'key' || normalized === 'label' || normalized === 'both') return normalized;
    return 'both';
  })();

  if (matchMode === 'key' || matchMode === 'both') {
    const byKey = await db.get<any>(
      `SELECT id
       FROM org_unit_types
       WHERE tenant_id = ? AND \`key\` = ?
       LIMIT 1`,
      [tenantId, normalizedKey]
    );
    if (byKey?.id) return normalizeText(byKey.id);
  }

  if (matchMode === 'label' || matchMode === 'both') {
    const byLabel = await db.get<any>(
      `SELECT id
       FROM org_unit_types
       WHERE tenant_id = ? AND LOWER(label) = ?
       LIMIT 1`,
      [tenantId, normalizedLabel.toLowerCase()]
    );
    if (byLabel?.id) return normalizeText(byLabel.id);
  }

  const id = createId('out');
  await db.run(
    `INSERT INTO org_unit_types (id, tenant_id, \`key\`, label, is_assignable, sort_order, active)
     VALUES (?, ?, ?, ?, 1, 0, 1)`,
    [id, tenantId, normalizedKey, normalizedLabel]
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
  if (shouldApplyField(selectedFields, 'type_id')) {
    updates.push('type_id = ?');
    params.push(input.typeId || null);
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

async function resolveOrgScopeIdsForUserImport(tenantId: string, row: ImportUserRow): Promise<string[]> {
  const db = getDatabase();
  const candidates = new Set<string>();
  for (const ref of row.orgUnitExternalRefs || []) {
    const value = normalizeText(ref);
    if (value) candidates.add(value);
  }
  for (const entry of parseRefList(row.orgUnitNamesText)) {
    const value = normalizeText(entry);
    if (value) candidates.add(value);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const org = await db.get<any>(
      `SELECT id
       FROM org_units
       WHERE tenant_id = ?
         AND (external_ref = ? OR LOWER(COALESCE(name, '')) = ?)
       ORDER BY CASE WHEN external_ref = ? THEN 0 ELSE 1 END
       LIMIT 1`,
      [tenantId, candidate, lower, candidate]
    );
    const orgId = normalizeText(org?.id);
    if (!orgId || seen.has(orgId)) continue;
    seen.add(orgId);
    out.push(orgId);
  }
  return out;
}

async function upsertServiceFromImport(input: {
  tenantId: string;
  row: ImportServiceRow;
  matchFields: string[];
  selectedFields?: string[];
}): Promise<{ result: 'created' | 'updated' | 'skipped' | 'conflict'; id?: string }> {
  const db = getDatabase();
  const matches = await findServiceMatches(input.tenantId, input.row, input.matchFields);
  if (matches.length > 1) return { result: 'conflict' };
  const selectedFields = input.selectedFields || [];

  const assignmentKeywordsJson = serializeKeywords(input.row.assignmentKeywords);
  const metadataJson = JSON.stringify(input.row.metadata || {});
  const ozgServicesJson = JSON.stringify(input.row.ozgServices || []);

  let serviceId = matches[0]?.id || '';
  if (!serviceId) {
    serviceId = createId('svc');
    await db.run(
      `INSERT INTO services_catalog (
        id, tenant_id, external_ref, name, description_html, publication_status,
        chatbot_relevant, appointment_allowed, leika_key, ozg_services_json, ozg_relevant,
        assignment_keywords_json, metadata_json, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        serviceId,
        input.tenantId,
        input.row.externalRef || null,
        input.row.name || 'Leistung',
        input.row.descriptionHtml || null,
        input.row.publicationStatus || null,
        input.row.chatbotRelevant ? 1 : 0,
        input.row.appointmentAllowed ? 1 : 0,
        input.row.leikaKey || null,
        ozgServicesJson,
        input.row.ozgRelevant ? 1 : 0,
        assignmentKeywordsJson,
        metadataJson,
      ]
    );
  } else {
    const updates: string[] = [];
    const params: any[] = [];
    if (shouldApplyField(selectedFields, 'external_ref')) {
      updates.push('external_ref = ?');
      params.push(input.row.externalRef || null);
    }
    if (shouldApplyField(selectedFields, 'name')) {
      updates.push('name = ?');
      params.push(input.row.name || null);
    }
    if (shouldApplyField(selectedFields, 'description_html')) {
      updates.push('description_html = ?');
      params.push(input.row.descriptionHtml || null);
    }
    if (shouldApplyField(selectedFields, 'publication_status')) {
      updates.push('publication_status = ?');
      params.push(input.row.publicationStatus || null);
    }
    if (shouldApplyField(selectedFields, 'chatbot_relevant')) {
      updates.push('chatbot_relevant = ?');
      params.push(input.row.chatbotRelevant ? 1 : 0);
    }
    if (shouldApplyField(selectedFields, 'appointment_allowed')) {
      updates.push('appointment_allowed = ?');
      params.push(input.row.appointmentAllowed ? 1 : 0);
    }
    if (shouldApplyField(selectedFields, 'leika_key')) {
      updates.push('leika_key = ?');
      params.push(input.row.leikaKey || null);
    }
    if (shouldApplyField(selectedFields, 'ozg_services_json')) {
      updates.push('ozg_services_json = ?');
      params.push(ozgServicesJson);
    }
    if (shouldApplyField(selectedFields, 'ozg_relevant')) {
      updates.push('ozg_relevant = ?');
      params.push(input.row.ozgRelevant ? 1 : 0);
    }
    if (shouldApplyField(selectedFields, 'assignment_keywords_json')) {
      updates.push('assignment_keywords_json = ?');
      params.push(assignmentKeywordsJson);
    }
    if (shouldApplyField(selectedFields, 'metadata_json')) {
      updates.push('metadata_json = ?');
      params.push(metadataJson);
    }
    if (updates.length === 0) return { result: 'skipped', id: serviceId };
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(serviceId);
    await db.run(`UPDATE services_catalog SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  const shouldApplyLinks =
    shouldApplyField(selectedFields, 'org_unit_links') ||
    shouldApplyField(selectedFields, 'admin_user_links') ||
    shouldApplyField(selectedFields, 'form_links');
  if (shouldApplyLinks) {
    const [orgUnitIds, adminUserIds] = await Promise.all([
      resolveOrgUnitRefs(input.tenantId, input.row.orgUnitRefs),
      resolveAdminUserRefs(input.tenantId, input.row.userRefs),
    ]);

    if (shouldApplyField(selectedFields, 'org_unit_links')) {
      await db.run(`DELETE FROM service_org_unit_links WHERE service_id = ?`, [serviceId]);
      for (const orgUnitId of orgUnitIds) {
        await db.run(
          `INSERT INTO service_org_unit_links (id, service_id, tenant_id, org_unit_id, source)
           VALUES (?, ?, ?, ?, 'import')`,
          [createId('sol'), serviceId, input.tenantId, orgUnitId]
        );
      }
    }

    if (shouldApplyField(selectedFields, 'admin_user_links')) {
      await db.run(`DELETE FROM service_admin_user_links WHERE service_id = ?`, [serviceId]);
      for (const adminUserId of adminUserIds) {
        await db.run(
          `INSERT INTO service_admin_user_links (id, service_id, tenant_id, admin_user_id, source)
           VALUES (?, ?, ?, ?, 'import')`,
          [createId('sul'), serviceId, input.tenantId, adminUserId]
        );
      }
    }

    if (shouldApplyField(selectedFields, 'form_links')) {
      await db.run(`DELETE FROM service_form_links WHERE service_id = ?`, [serviceId]);
      for (const formRef of input.row.formRefs) {
        const normalized = normalizeText(formRef);
        if (!normalized) continue;
        await db.run(
          `INSERT INTO service_form_links (id, service_id, tenant_id, form_ref, source)
           VALUES (?, ?, ?, ?, 'import')`,
          [createId('sfl'), serviceId, input.tenantId, normalized]
        );
      }
    }
  }

  return { result: matches.length > 0 ? 'updated' : 'created', id: serviceId };
}

async function buildPreview(job: ImportJobRecord, file: ImportJobFileRecord, actorUserId: string) {
  const db = getDatabase();
  const options = parseJsonObject(job.options_json);
  const mapping = parseJsonObject(job.mapping_json);
  const hasMatchFieldsOption = Array.isArray(options.matchFields);
  const matchFieldsRaw = hasMatchFieldsOption ? options.matchFields : [];
  const matchFields =
    hasMatchFieldsOption
      ? matchFieldsRaw.map((entry: any) => normalizeText(entry))
      : job.kind === 'users'
      ? USER_IMPORT_MATCH_FIELDS_DEFAULT
      : job.kind === 'services'
      ? ['external_ref', 'name', 'leika_key']
      : ['external_ref', 'name'];
  const hasSelectedFieldsOption = Array.isArray(options.selectedFields);
  const selectedFieldsRaw = hasSelectedFieldsOption ? options.selectedFields : [];
  const selectedFields =
    hasSelectedFieldsOption
      ? selectedFieldsRaw.map((entry: any) => normalizeText(entry))
      : job.kind === 'users'
      ? USER_IMPORT_SELECTED_FIELDS_DEFAULT
      : job.kind === 'services'
      ? [
          'external_ref',
          'name',
          'description_html',
          'publication_status',
          'chatbot_relevant',
          'appointment_allowed',
          'leika_key',
          'ozg_services_json',
          'ozg_relevant',
          'assignment_keywords_json',
          'metadata_json',
          'org_unit_links',
          'admin_user_links',
          'form_links',
        ]
      : ['name', 'type_id', 'contact_email', 'metadata_json', 'assignment_keywords_json', 'external_ref'];

  const forcedEncoding = normalizeText(options.encoding || file.encoding || '');
  const parsed = parseCsvImportBuffer(fs.readFileSync(file.storage_path), forcedEncoding);
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
    const userCache = new Map<string, any>();
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
      let diffRows: Array<{ field: string; current: any; incoming: any; changed: boolean }> = [];
      if (matches.length === 1) {
        const matchedId = matches[0].id;
        let existing = userCache.get(matchedId);
        if (!existing) {
          existing = await db.get<any>(
            `SELECT
               id, email, first_name, last_name, job_title, work_phone, assignment_keywords_json,
               profile_data_json, external_person_id, salutation, title, building, floor, room,
               position_slot, function_text, tasks_text, notes_text,
               phone_public, phone_contact, fax_public, fax_contact, mobile_public, mobile_contact,
               email_public, email_contact, website_public, website_contact,
               postal_street, postal_house_number, postal_postal_code, postal_city, postal_address_supplement,
               postal_elevator_available, postal_wheelchair_accessible,
               postbox_postal_code, postbox_city, postbox_number, postbox_elevator_available, postbox_wheelchair_accessible,
               visitor_street, visitor_house_number, visitor_postal_code, visitor_city, visitor_address_supplement,
               visitor_elevator_available, visitor_wheelchair_accessible,
               delivery_street, delivery_house_number, delivery_postal_code, delivery_city, delivery_address_supplement,
               delivery_elevator_available, delivery_wheelchair_accessible, org_unit_names_text
             FROM admin_users
             WHERE id = ?
             LIMIT 1`,
            [matchedId]
          );
          if (existing) userCache.set(matchedId, existing);
        }
        diffRows = buildUserImportDiff({
          incoming: mapped,
          current: existing || {},
          selectedFields,
        });
      }
      if (previewRows.length < 300) {
        previewRows.push({
          rowIndex: index + 2,
          action,
          matchedIds,
          changeCount: diffRows.filter((entry) => entry.changed).length,
          diffRows,
          mapped: {
            externalId: mapped.externalId,
            username: mapped.username,
            email: mapped.email,
            firstName: mapped.firstName,
            lastName: mapped.lastName,
            salutation: mapped.salutation,
            title: mapped.title,
            building: mapped.building,
            floor: mapped.floor,
            room: mapped.room,
            phoneContact: mapped.phoneContact,
            phonePublic: mapped.phonePublic,
            emailContact: mapped.emailContact,
            emailPublic: mapped.emailPublic,
            orgUnitExternalRefs: mapped.orgUnitExternalRefs,
            assignmentKeywords: mapped.assignmentKeywords.slice(0, 10),
          },
        });
      }
    }
  } else if (job.kind === 'org_units') {
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
        const resolvedType = buildOrgTypeDescriptorFromRow(mapped, options);
        previewRows.push({
          rowIndex: index + 2,
          action,
          matchedIds,
          mapped: {
            externalRef: mapped.externalRef,
            name: mapped.name,
            typeKey: resolvedType.key,
            typeLabel: resolvedType.label,
            sourceTypeKey: mapped.typeKey,
            sourceTypeLabel: mapped.typeLabel,
            parentExternalRef: mapped.parentExternalRef,
            contactEmail: mapped.contactEmail,
            assignmentKeywords: mapped.assignmentKeywords.slice(0, 10),
          },
        });
      }
    }
  } else {
    for (let index = 0; index < parsed.rows.length; index += 1) {
      const sourceRow = parsed.rows[index];
      const mapped = mapServiceImportRow(sourceRow);
      if (!mapped.name) {
        counters.invalid += 1;
        continue;
      }
      const matches = await findServiceMatches(job.tenant_id || '', mapped, matchFields);
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
          entityKind: 'service',
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
            publicationStatus: mapped.publicationStatus,
            chatbotRelevant: mapped.chatbotRelevant,
            appointmentAllowed: mapped.appointmentAllowed,
            leikaKey: mapped.leikaKey,
            orgUnitRefs: mapped.orgUnitRefs.slice(0, 8),
            userRefs: mapped.userRefs.slice(0, 8),
            formRefs: mapped.formRefs.slice(0, 8),
            assignmentKeywords: mapped.assignmentKeywords.slice(0, 12),
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
    selectedFields,
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
    const hasMatchFieldsOption = Array.isArray(options.matchFields);
    const matchFieldsRaw = hasMatchFieldsOption ? options.matchFields : [];
    const matchFields =
      hasMatchFieldsOption
        ? matchFieldsRaw.map((entry: any) => normalizeText(entry))
        : job.kind === 'users'
        ? USER_IMPORT_MATCH_FIELDS_DEFAULT
        : job.kind === 'services'
        ? ['external_ref', 'name', 'leika_key']
        : ['external_ref', 'name'];
    const hasSelectedFieldsOption = Array.isArray(options.selectedFields);
    const selectedFields = hasSelectedFieldsOption
      ? (options.selectedFields as any[]).map((entry: any) => normalizeText(entry))
      : job.kind === 'users'
      ? USER_IMPORT_SELECTED_FIELDS_DEFAULT
      : job.kind === 'services'
      ? [
          'external_ref',
          'name',
          'description_html',
          'publication_status',
          'chatbot_relevant',
          'appointment_allowed',
          'leika_key',
          'ozg_services_json',
          'ozg_relevant',
          'assignment_keywords_json',
          'metadata_json',
          'org_unit_links',
          'admin_user_links',
          'form_links',
        ]
      : ['name', 'type_id', 'contact_email', 'metadata_json', 'assignment_keywords_json', 'external_ref'];
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
    const parsed = parseCsvImportBuffer(fs.readFileSync(file.storage_path), forcedEncoding);
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
    const touchedServiceIds = new Set<string>();
    const orgParentRefs: Array<{ childId: string; parentExternalRef: string }> = [];
    const orgTypeIdCache = new Map<string, string>();

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
      } else if (job.kind === 'org_units') {
        const mapped = mapOrgImportRow(row);
        if (!mapped.name) {
          counters.invalid += 1;
          continue;
        }
        const resolvedType = buildOrgTypeDescriptorFromRow(mapped, options);
        const typeCacheKey = `${resolvedType.key}::${resolvedType.label}::${normalizeText(options.orgTypeMatchMode || 'both').toLowerCase()}`;
        let orgTypeId = orgTypeIdCache.get(typeCacheKey) || '';
        if (!orgTypeId) {
          orgTypeId = await ensureOrgType(
            job.tenant_id || 'tenant_default',
            resolvedType.key,
            resolvedType.label,
            options.orgTypeMatchMode
          );
          orgTypeIdCache.set(typeCacheKey, orgTypeId);
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
      } else {
        const mapped = mapServiceImportRow(row);
        if (!mapped.name) {
          counters.invalid += 1;
          continue;
        }
        const result = await upsertServiceFromImport({
          tenantId: job.tenant_id || 'tenant_default',
          row: mapped,
          matchFields,
          selectedFields,
        });
        if (result.result === 'created') counters.created += 1;
        else if (result.result === 'updated') counters.updated += 1;
        else if (result.result === 'conflict') counters.conflicts += 1;
        else counters.skipped += 1;
        if (result.id) {
          touchedServiceIds.add(result.id);
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
        const normalizedParentRef = normalizeText(ref.parentExternalRef);
        if (!normalizedParentRef) continue;
        const parent = await db.get<any>(
          `SELECT id
           FROM org_units
           WHERE tenant_id = ?
             AND (external_ref = ? OR LOWER(COALESCE(name, '')) = ?)
           ORDER BY CASE WHEN external_ref = ? THEN 0 ELSE 1 END
           LIMIT 1`,
          [
            job.tenant_id || 'tenant_default',
            normalizedParentRef,
            normalizedParentRef.toLowerCase(),
            normalizedParentRef,
          ]
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

    let followUpKeywordingJobId: string | null = null;
    if (job.kind === 'services' && options?.triggerKeywordingAfterImport === true) {
      followUpKeywordingJobId = createId('kijob');
      await db.run(
        `INSERT INTO keyword_inference_jobs (
          id, tenant_id, status, source_scope, target_scope,
          include_existing_keywords, apply_mode,
          min_suggest_confidence, min_auto_apply_confidence, max_keywords_per_target,
          options_json, created_by_admin_id
        ) VALUES (?, ?, 'draft', 'services_recent_import', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          followUpKeywordingJobId,
          job.tenant_id || 'tenant_default',
          normalizeText(options.keywordingTargetScope || 'both') || 'both',
          options.keywordingIncludeExistingKeywords === false ? 0 : 1,
          normalizeText(options.keywordingApplyMode || 'review') === 'auto_if_confident' ? 'auto_if_confident' : 'review',
          Number.isFinite(Number(options.keywordingMinSuggestConfidence))
            ? Math.max(0.05, Math.min(0.99, Number(options.keywordingMinSuggestConfidence)))
            : 0.55,
          Number.isFinite(Number(options.keywordingMinAutoApplyConfidence))
            ? Math.max(0.05, Math.min(0.99, Number(options.keywordingMinAutoApplyConfidence)))
            : 0.82,
          Number.isFinite(Number(options.keywordingMaxKeywordsPerTarget))
            ? Math.max(1, Math.min(40, Number(options.keywordingMaxKeywordsPerTarget)))
            : 15,
          JSON.stringify({ source: 'import.services', importJobId: job.id }),
          actorUserId || null,
        ]
      );
      await db.run(
        `INSERT INTO keyword_inference_events (id, job_id, event_type, message, payload_json, created_by_admin_id)
         VALUES (?, ?, 'created', 'Folgejob aus Leistungsimport erstellt', ?, ?)`,
        [
          createId('kiev'),
          followUpKeywordingJobId,
          JSON.stringify({
            source: 'import.services',
            importJobId: job.id,
            tenantId: job.tenant_id || 'tenant_default',
          }),
          actorUserId || null,
        ]
      );
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
      touchedServiceIds: Array.from(touchedServiceIds).slice(0, 5000),
      followUpKeywordingJobId,
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
    const kind: ImportKind = kindRaw === 'org_units' ? 'org_units' : kindRaw === 'services' ? 'services' : 'users';
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
  const kindRaw = normalizeText(req.params.kind).toLowerCase();
  const kind: ImportKind = kindRaw === 'org_units' ? 'org_units' : kindRaw === 'services' ? 'services' : 'users';
  if (kind === 'users') {
    return res.json({
      kind,
      template: {
        matchFields: USER_IMPORT_MATCH_FIELDS_DEFAULT,
        selectedFields: USER_IMPORT_SELECTED_FIELDS_DEFAULT,
      },
    });
  }
  if (kind === 'services') {
    return res.json({
      kind,
      template: {
        matchFields: ['external_ref', 'name', 'leika_key'],
        selectedFields: [
          'external_ref',
          'name',
          'description_html',
          'publication_status',
          'chatbot_relevant',
          'appointment_allowed',
          'leika_key',
          'ozg_services_json',
          'ozg_relevant',
          'assignment_keywords_json',
          'metadata_json',
          'org_unit_links',
          'admin_user_links',
          'form_links',
        ],
      },
    });
  }
  return res.json({
    kind,
    template: {
      matchFields: ['external_ref', 'name'],
      selectedFields: ['name', 'type_id', 'contact_email', 'metadata_json', 'assignment_keywords_json', 'external_ref'],
      orgTypeKey: 'fachbereich',
      orgTypeLabel: 'Fachbereich',
      orgTypeStrategy: 'csv_column',
      orgTypeMatchMode: 'both',
      orgTypeStripNumbers: true,
      orgTypeRenameMap: {},
    },
  });
});

router.post('/:id/assist/mapping', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const { job, file } = await loadImportJobWithFile(jobId);
    if (!job || !file) return res.status(404).json({ message: 'Importjob oder Datei nicht gefunden.' });
    await assertJobScope(req, job);
    const parsed = parseCsvImportBuffer(fs.readFileSync(file.storage_path), normalizeText(file.encoding || ''));
    const headerMap: Record<string, string> = {};
    for (const header of parsed.headers) {
      const normalized = normalizeCsvHeader(header);
      if (job.kind === 'users') {
        if (['id'].includes(normalized)) headerMap[header] = 'external_person_id';
        else if (['vorname', 'firstname', 'first_name'].includes(normalized)) headerMap[header] = 'first_name';
        else if (['nachname', 'lastname', 'last_name'].includes(normalized)) headerMap[header] = 'last_name';
        else if (['anrede', 'salutation'].includes(normalized)) headerMap[header] = 'salutation';
        else if (['titel', 'title'].includes(normalized)) headerMap[header] = 'title';
        else if (['positionsbezeichnung', 'job_title'].includes(normalized)) headerMap[header] = 'job_title';
        else if (['gebaude', 'gebaeude', 'building'].includes(normalized)) headerMap[header] = 'building';
        else if (['stockwerk', 'floor'].includes(normalized)) headerMap[header] = 'floor';
        else if (['raum', 'room', 'zimmer'].includes(normalized)) headerMap[header] = 'room';
        else if (['stelle', 'position_slot'].includes(normalized)) headerMap[header] = 'position_slot';
        else if (['funktion', 'function'].includes(normalized)) headerMap[header] = 'function_text';
        else if (['aufgaben', 'tasks'].includes(normalized)) headerMap[header] = 'tasks_text';
        else if (normalized === 'sonstige_angaben' || normalized === 'notes') headerMap[header] = 'notes_text';
        else if (normalized === 'telefon_veroffentlichen' || normalized === 'telefon_veroeffentlichen')
          headerMap[header] = 'phone_public';
        else if (normalized.includes('telefon')) headerMap[header] = 'work_phone';
        else if (normalized === 'telefon_kontakt') headerMap[header] = 'phone_contact';
        else if (normalized === 'fax_veroffentlichen' || normalized === 'fax_veroeffentlichen') headerMap[header] = 'fax_public';
        else if (normalized === 'fax_kontakt') headerMap[header] = 'fax_contact';
        else if (normalized === 'mobil_veroffentlichen' || normalized === 'mobil_veroeffentlichen')
          headerMap[header] = 'mobile_public';
        else if (normalized === 'mobil_kontakt') headerMap[header] = 'mobile_contact';
        else if (normalized === 'e_mail_veroffentlichen' || normalized === 'e_mail_veroeffentlichen')
          headerMap[header] = 'email_public';
        else if (normalized === 'e_mail_kontakt') headerMap[header] = 'email_contact';
        else if (normalized.startsWith('e_mail')) headerMap[header] = 'email';
        else if (normalized === 'website_veroffentlichen' || normalized === 'website_veroeffentlichen')
          headerMap[header] = 'website_public';
        else if (normalized === 'website_kontakt') headerMap[header] = 'website_contact';
        else if (normalized === 'postadresse_strasse') headerMap[header] = 'postal_street';
        else if (normalized === 'postadresse_hausnummer') headerMap[header] = 'postal_house_number';
        else if (normalized === 'postadresse_plz') headerMap[header] = 'postal_postal_code';
        else if (normalized === 'postadresse_ort') headerMap[header] = 'postal_city';
        else if (normalized === 'postadresse_adresszusatz') headerMap[header] = 'postal_address_supplement';
        else if (normalized === 'postadresse_aufzug_vorhanden') headerMap[header] = 'postal_elevator_available';
        else if (normalized === 'postadresse_rollstuhlgeeignet') headerMap[header] = 'postal_wheelchair_accessible';
        else if (normalized === 'postfach_plz') headerMap[header] = 'postbox_postal_code';
        else if (normalized === 'postfach_ort') headerMap[header] = 'postbox_city';
        else if (normalized === 'postfach_postfach') headerMap[header] = 'postbox_number';
        else if (normalized === 'postfach_aufzug_vorhanden') headerMap[header] = 'postbox_elevator_available';
        else if (normalized === 'postfach_rollstuhlgeeignet') headerMap[header] = 'postbox_wheelchair_accessible';
        else if (normalized === 'besucheradresse_strasse') headerMap[header] = 'visitor_street';
        else if (normalized === 'besucheradresse_hausnummer') headerMap[header] = 'visitor_house_number';
        else if (normalized === 'besucheradresse_plz') headerMap[header] = 'visitor_postal_code';
        else if (normalized === 'besucheradresse_ort') headerMap[header] = 'visitor_city';
        else if (normalized === 'besucheradresse_adresszusatz') headerMap[header] = 'visitor_address_supplement';
        else if (normalized === 'besucheradresse_aufzug_vorhanden') headerMap[header] = 'visitor_elevator_available';
        else if (normalized === 'besucheradresse_rollstuhlgeeignet') headerMap[header] = 'visitor_wheelchair_accessible';
        else if (normalized === 'lieferadresse_strasse') headerMap[header] = 'delivery_street';
        else if (normalized === 'lieferadresse_hausnummer') headerMap[header] = 'delivery_house_number';
        else if (normalized === 'lieferadresse_plz') headerMap[header] = 'delivery_postal_code';
        else if (normalized === 'lieferadresse_ort') headerMap[header] = 'delivery_city';
        else if (normalized === 'lieferadresse_adresszusatz') headerMap[header] = 'delivery_address_supplement';
        else if (normalized === 'lieferadresse_aufzug_vorhanden') headerMap[header] = 'delivery_elevator_available';
        else if (normalized === 'lieferadresse_rollstuhlgeeignet') headerMap[header] = 'delivery_wheelchair_accessible';
        else if (normalized === 'organisationseinheiten_name') headerMap[header] = 'org_unit_names_text';
      } else if (job.kind === 'org_units') {
        if (['id'].includes(normalized)) headerMap[header] = 'external_ref';
        else if (['bezeichnung', 'name'].includes(normalized)) headerMap[header] = 'name';
        else if (
          normalized.includes('organisationseinheitstyp') ||
          normalized.includes('organisationstyp') ||
          normalized === 'typ' ||
          normalized === 'bereichstyp' ||
          normalized === 'strukturtyp'
        ) {
          headerMap[header] = 'type_label';
        } else if (normalized.includes('typ_key') || normalized.includes('type_key')) {
          headerMap[header] = 'type_key';
        }
        else if (normalized.includes('ubergeordnete_organisationseinheit')) headerMap[header] = 'parent_external_ref';
        else if (normalized.includes('e_mail')) headerMap[header] = 'contact_email';
      } else {
        if (['id'].includes(normalized)) headerMap[header] = 'external_ref';
        else if (['bezeichnung', 'name'].includes(normalized)) headerMap[header] = 'name';
        else if (normalized.includes('beschreibung')) headerMap[header] = 'description_html';
        else if (normalized.includes('veroffentlichungsstatus')) headerMap[header] = 'publication_status';
        else if (normalized.includes('chatbot')) headerMap[header] = 'chatbot_relevant';
        else if (normalized.includes('terminvereinbar')) headerMap[header] = 'appointment_allowed';
        else if (normalized.includes('organisationseinheiten')) headerMap[header] = 'org_unit_links';
        else if (normalized.includes('mitarbeiter')) headerMap[header] = 'admin_user_links';
        else if (normalized.includes('formulare')) headerMap[header] = 'form_links';
        else if (normalized.includes('leika')) headerMap[header] = 'leika_key';
        else if (normalized.includes('ozg_leistungen')) headerMap[header] = 'ozg_services_json';
        else if (normalized.includes('ozg_relevant')) headerMap[header] = 'ozg_relevant';
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
    const parsed = parseCsvImportBuffer(fs.readFileSync(file.storage_path), normalizeText(file.encoding || ''));
    const samples = parsed.rows.slice(0, 50).map((row, index) => {
      const mapped =
        job.kind === 'users'
          ? mapUserImportRow(row)
          : job.kind === 'org_units'
          ? mapOrgImportRow(row)
          : mapServiceImportRow(row);
      return {
        rowIndex: index + 2,
        keywords:
          job.kind === 'users'
            ? (mapped as ImportUserRow).assignmentKeywords.slice(0, 20)
            : job.kind === 'org_units'
            ? (mapped as ImportOrgRow).assignmentKeywords.slice(0, 20)
            : (mapped as ImportServiceRow).assignmentKeywords.slice(0, 20),
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
    const parsed = parseCsvImportBuffer(fs.readFileSync(file.storage_path), normalizeText(file.encoding || ''));
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
