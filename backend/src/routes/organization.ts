import express, { Request, Response } from 'express';
import { authMiddleware, staffOnly, adminOnly } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { loadAdminAccessContext, rebuildOrgUnitClosure } from '../services/rbac.js';

const router = express.Router();

router.use(authMiddleware, staffOnly);

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'ja', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'nein', 'off'].includes(raw)) return false;
  }
  return fallback;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseJsonOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function normalizeOptionalEmail(value: unknown): string | null {
  const email = normalizeText(value).toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('contactEmail ist keine gültige E-Mail-Adresse.');
  }
  return email;
}

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function normalizeRegistrationDomain(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/^@+/, '');
}

function normalizeRegistrationDomains(input: unknown): string[] {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
    ? input.split(/[\s,;\n\r]+/g)
    : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const domain = normalizeRegistrationDomain(raw);
    if (!domain) continue;
    if (!DOMAIN_PATTERN.test(domain)) {
      throw new Error(`Ungültige Registrierungs-Domain: ${domain}`);
    }
    if (seen.has(domain)) continue;
    seen.add(domain);
    result.push(domain);
    if (result.length >= 200) break;
  }
  return result;
}

function parseRegistrationDomainsFromDb(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    try {
      return normalizeRegistrationDomains(value);
    } catch {
      return [];
    }
  }
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeRegistrationDomains(parsed);
    } catch {
      return [];
    }
  }
  try {
    return normalizeRegistrationDomains(trimmed);
  } catch {
    return [];
  }
}

function serializeRegistrationDomains(domains: string[]): string {
  return JSON.stringify(domains || []);
}

function normalizeAssignmentKeyword(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeAssignmentKeywords(raw: unknown): string[] {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
    ? raw.split(/[\n,;|]+/g)
    : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of source) {
    const keyword = normalizeAssignmentKeyword(entry);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
    if (out.length >= 200) break;
  }
  return out;
}

function parseAssignmentKeywordsFromDb(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return normalizeAssignmentKeywords(raw);
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      return normalizeAssignmentKeywords(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return normalizeAssignmentKeywords(trimmed);
}

function serializeAssignmentKeywords(raw: unknown): string | null {
  const normalized = normalizeAssignmentKeywords(raw);
  if (normalized.length === 0) return null;
  return JSON.stringify(normalized);
}

async function ensureRegistrationDomainsUnique(domains: string[], currentTenantId?: string | null): Promise<void> {
  if (!Array.isArray(domains) || domains.length === 0) return;
  const db = getDatabase();
  const rows = await db.all<any>(
    `SELECT id, registration_email_domains_json
     FROM tenants`
  );
  const current = normalizeText(currentTenantId || '');
  for (const row of rows || []) {
    const tenantId = normalizeText(row?.id);
    if (!tenantId || (current && tenantId === current)) continue;
    const existingDomains = parseRegistrationDomainsFromDb(row?.registration_email_domains_json);
    if (existingDomains.length === 0) continue;
    const existingSet = new Set(existingDomains);
    const collisions = domains.filter((domain) => existingSet.has(domain));
    if (collisions.length > 0) {
      throw new Error(
        `Registrierungs-Domain bereits einem anderen Mandanten zugeordnet: ${Array.from(new Set(collisions)).join(', ')}`
      );
    }
  }
}

async function ensureTenantExists(tenantId: string): Promise<boolean> {
  const db = getDatabase();
  const row = await db.get(`SELECT id FROM tenants WHERE id = ?`, [tenantId]);
  return !!row?.id;
}

function normalizeNullableText(value: unknown, max = 400): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function normalizeOptionalEmailField(value: unknown, fieldLabel: string): string | null {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error(`${fieldLabel} ist keine gültige E-Mail-Adresse.`);
  }
  return normalized.slice(0, 191);
}

function normalizeOptionalHomepage(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const withScheme = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
  try {
    const url = new URL(withScheme);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Homepage muss mit http:// oder https:// erreichbar sein.');
    }
    return url.toString().slice(0, 500);
  } catch {
    throw new Error('Homepage ist keine gültige URL.');
  }
}

type TenantProfilePayload = {
  tenantId: string;
  legalName: string;
  displayName: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  country: string;
  generalEmail: string;
  supportEmail: string;
  phone: string;
  homepage: string;
  responsiblePersonName: string;
  responsiblePersonRole: string;
  responsiblePersonEmail: string;
  responsiblePersonPhone: string;
  vatId: string;
  imprintText: string;
  privacyContact: string;
  createdAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

function mapTenantProfileRow(tenantId: string, row: any, tenantFallbackName = ''): TenantProfilePayload {
  const fallback = normalizeText(tenantFallbackName);
  return {
    tenantId,
    legalName: normalizeText(row?.legal_name) || fallback,
    displayName: normalizeText(row?.display_name) || fallback,
    street: normalizeText(row?.street),
    houseNumber: normalizeText(row?.house_number),
    postalCode: normalizeText(row?.postal_code),
    city: normalizeText(row?.city),
    country: normalizeText(row?.country),
    generalEmail: normalizeText(row?.general_email),
    supportEmail: normalizeText(row?.support_email),
    phone: normalizeText(row?.phone),
    homepage: normalizeText(row?.homepage),
    responsiblePersonName: normalizeText(row?.responsible_person_name),
    responsiblePersonRole: normalizeText(row?.responsible_person_role),
    responsiblePersonEmail: normalizeText(row?.responsible_person_email),
    responsiblePersonPhone: normalizeText(row?.responsible_person_phone),
    vatId: normalizeText(row?.vat_id),
    imprintText: normalizeText(row?.imprint_text),
    privacyContact: normalizeText(row?.privacy_contact),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    updatedBy: normalizeText(row?.updated_by) || null,
  };
}

async function ensureTenantReadAccess(req: Request, tenantId: string): Promise<void> {
  const access = await loadAdminAccessContext(String(req.userId || ''), String(req.role || ''));
  if (access.isGlobalAdmin) return;
  if (access.tenantIds.includes(tenantId)) return;
  const error = new Error('Kein Zugriff auf diesen Mandanten.');
  (error as any).status = 403;
  throw error;
}

async function ensureTenantAdminAccess(req: Request, tenantId: string): Promise<void> {
  const access = await loadAdminAccessContext(String(req.userId || ''), String(req.role || ''));
  if (access.isGlobalAdmin) return;
  if (access.tenantAdminTenantIds.includes(tenantId)) return;
  const error = new Error('Für diesen Mandanten sind Adminrechte erforderlich.');
  (error as any).status = 403;
  throw error;
}

async function ensurePlatformAdmin(req: Request): Promise<void> {
  const access = await loadAdminAccessContext(String(req.userId || ''), String(req.role || ''));
  if (access.isGlobalAdmin) return;
  const error = new Error('Nur Plattform-Admins dürfen Mandanten verwalten.');
  (error as any).status = 403;
  throw error;
}

// GET /api/admin/tenants
router.get('/tenants', async (req: Request, res: Response) => {
  try {
    const access = await loadAdminAccessContext(String(req.userId || ''), String(req.role || ''));
    const db = getDatabase();
    const rows = await db.all(
      `SELECT id, slug, name, tenant_type, registration_email_domains_json, assignment_keywords_json, active, created_at, updated_at
       FROM tenants
       ORDER BY name ASC, created_at ASC`
    );
    const visibleRows = access.isGlobalAdmin
      ? rows || []
      : (rows || []).filter((row: any) => access.tenantIds.includes(normalizeText(row?.id)));
    const tenants = visibleRows.map((row: any) => ({
      id: String(row?.id || ''),
      slug: String(row?.slug || ''),
      name: String(row?.name || ''),
      tenantType: String(row?.tenant_type || ''),
      registrationEmailDomains: parseRegistrationDomainsFromDb(row?.registration_email_domains_json),
      assignmentKeywords: parseAssignmentKeywordsFromDb(row?.assignment_keywords_json),
      active: Number(row?.active ?? 1) === 1,
      createdAt: row?.created_at || null,
      updatedAt: row?.updated_at || null,
    }));
    return res.json(tenants);
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Laden der Mandanten', error: error?.message });
  }
});

// POST /api/admin/tenants
router.post('/tenants', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    await ensurePlatformAdmin(req);

    const slug = normalizeText(req.body?.slug).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const name = normalizeText(req.body?.name);
    const tenantType = normalizeText(req.body?.tenantType || req.body?.tenant_type || 'verbandsgemeinde') || 'verbandsgemeinde';
    const registrationEmailDomains = normalizeRegistrationDomains(
      req.body?.registrationEmailDomains ?? req.body?.registration_email_domains
    );
    const assignmentKeywordsJson = serializeAssignmentKeywords(
      req.body?.assignmentKeywords ?? req.body?.assignment_keywords
    );
    const active = toBool(req.body?.active, true);

    if (!slug || !name) {
      return res.status(400).json({ message: 'slug und name sind erforderlich.' });
    }

    const db = getDatabase();
    const exists = await db.get(`SELECT id FROM tenants WHERE slug = ?`, [slug]);
    if (exists?.id) {
      return res.status(409).json({ message: 'Mandanten-Slug existiert bereits.' });
    }
    await ensureRegistrationDomainsUnique(registrationEmailDomains);

    const id = createId('tenant');
    await db.run(
      `INSERT INTO tenants (id, slug, name, tenant_type, registration_email_domains_json, assignment_keywords_json, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, slug, name, tenantType, serializeRegistrationDomains(registrationEmailDomains), assignmentKeywordsJson, active ? 1 : 0]
    );

    return res.status(201).json({
      id,
      slug,
      name,
      tenantType,
      registrationEmailDomains,
      assignmentKeywords: parseAssignmentKeywordsFromDb(assignmentKeywordsJson),
      active,
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('bereits einem anderen Mandanten zugeordnet')) {
      return res.status(409).json({ message });
    }
    if (message.startsWith('Ungültige Registrierungs-Domain')) {
      return res.status(400).json({ message });
    }
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Erstellen des Mandanten', error: error?.message });
  }
});

// PATCH /api/admin/tenants/:tenantId
router.patch('/tenants/:tenantId', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    await ensurePlatformAdmin(req);

    const tenantId = normalizeText(req.params.tenantId);
    if (!tenantId) return res.status(400).json({ message: 'tenantId fehlt.' });

    const updates: string[] = [];
    const params: any[] = [];

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'slug')) {
      const slug = normalizeText(req.body?.slug).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      if (!slug) return res.status(400).json({ message: 'slug darf nicht leer sein.' });
      updates.push('slug = ?');
      params.push(slug);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      const name = normalizeText(req.body?.name);
      if (!name) return res.status(400).json({ message: 'name darf nicht leer sein.' });
      updates.push('name = ?');
      params.push(name);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'tenantType')) {
      const tenantType = normalizeText(req.body?.tenantType || req.body?.tenant_type || 'verbandsgemeinde');
      updates.push('tenant_type = ?');
      params.push(tenantType);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'active')) {
      updates.push('active = ?');
      params.push(toBool(req.body?.active, true) ? 1 : 0);
    }
    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, 'registrationEmailDomains') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'registration_email_domains')
    ) {
      const registrationEmailDomains = normalizeRegistrationDomains(
        req.body?.registrationEmailDomains ?? req.body?.registration_email_domains
      );
      await ensureRegistrationDomainsUnique(registrationEmailDomains, tenantId);
      updates.push('registration_email_domains_json = ?');
      params.push(serializeRegistrationDomains(registrationEmailDomains));
    }
    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, 'assignmentKeywords') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'assignment_keywords')
    ) {
      updates.push('assignment_keywords_json = ?');
      params.push(serializeAssignmentKeywords(req.body?.assignmentKeywords ?? req.body?.assignment_keywords));
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'Keine Änderungen angegeben.' });
    }

    const db = getDatabase();
    const exists = await db.get(`SELECT id FROM tenants WHERE id = ?`, [tenantId]);
    if (!exists?.id) return res.status(404).json({ message: 'Mandant nicht gefunden.' });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    await db.run(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`, [...params, tenantId]);

    const updated = await db.get(
      `SELECT id, slug, name, tenant_type, registration_email_domains_json, assignment_keywords_json, active, created_at, updated_at
       FROM tenants
       WHERE id = ?`,
      [tenantId]
    );

    return res.json({
      id: String(updated?.id || ''),
      slug: String(updated?.slug || ''),
      name: String(updated?.name || ''),
      tenantType: String(updated?.tenant_type || ''),
      registrationEmailDomains: parseRegistrationDomainsFromDb(updated?.registration_email_domains_json),
      assignmentKeywords: parseAssignmentKeywordsFromDb(updated?.assignment_keywords_json),
      active: Number(updated?.active ?? 1) === 1,
      createdAt: updated?.created_at || null,
      updatedAt: updated?.updated_at || null,
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('bereits einem anderen Mandanten zugeordnet')) {
      return res.status(409).json({ message });
    }
    if (message.startsWith('Ungültige Registrierungs-Domain')) {
      return res.status(400).json({ message });
    }
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Aktualisieren des Mandanten', error: error?.message });
  }
});

// GET /api/admin/tenants/:tenantId/profile
router.get('/tenants/:tenantId/profile', async (req: Request, res: Response): Promise<any> => {
  try {
    const tenantId = normalizeText(req.params.tenantId);
    if (!tenantId) return res.status(400).json({ message: 'tenantId fehlt.' });
    if (!(await ensureTenantExists(tenantId))) {
      return res.status(404).json({ message: 'Mandant nicht gefunden.' });
    }
    await ensureTenantReadAccess(req, tenantId);

    const db = getDatabase();
    const [tenant, row] = await Promise.all([
      db.get<any>(`SELECT name FROM tenants WHERE id = ?`, [tenantId]),
      db.get<any>(
        `SELECT tenant_id, legal_name, display_name, street, house_number, postal_code, city, country,
                general_email, support_email, phone, homepage, responsible_person_name, responsible_person_role,
                responsible_person_email, responsible_person_phone, vat_id, imprint_text, privacy_contact,
                created_at, updated_at, updated_by
         FROM tenant_profiles
         WHERE tenant_id = ?
         LIMIT 1`,
        [tenantId]
      ),
    ]);

    return res.json(mapTenantProfileRow(tenantId, row, tenant?.name || ''));
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Laden des Tenant-Profils.',
      error: error?.message,
    });
  }
});

// PATCH /api/admin/tenants/:tenantId/profile
router.patch('/tenants/:tenantId/profile', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    await ensurePlatformAdmin(req);

    const tenantId = normalizeText(req.params.tenantId);
    if (!tenantId) return res.status(400).json({ message: 'tenantId fehlt.' });
    if (!(await ensureTenantExists(tenantId))) {
      return res.status(404).json({ message: 'Mandant nicht gefunden.' });
    }
    await ensureTenantAdminAccess(req, tenantId);

    const mutableFields = [
      'legalName',
      'displayName',
      'street',
      'houseNumber',
      'postalCode',
      'city',
      'country',
      'generalEmail',
      'supportEmail',
      'phone',
      'homepage',
      'responsiblePersonName',
      'responsiblePersonRole',
      'responsiblePersonEmail',
      'responsiblePersonPhone',
      'vatId',
      'imprintText',
      'privacyContact',
    ];
    const hasChanges = mutableFields.some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
    if (!hasChanges) {
      return res.status(400).json({ message: 'Keine Änderungen angegeben.' });
    }

    const db = getDatabase();
    const [tenant, existingRow] = await Promise.all([
      db.get<any>(`SELECT name FROM tenants WHERE id = ?`, [tenantId]),
      db.get<any>(`SELECT * FROM tenant_profiles WHERE tenant_id = ? LIMIT 1`, [tenantId]),
    ]);
    const existing = mapTenantProfileRow(tenantId, existingRow, tenant?.name || '');

    const next = {
      legalName:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'legalName')
          ? normalizeNullableText(req.body?.legalName, 400)
          : normalizeNullableText(existing.legalName, 400),
      displayName:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'displayName')
          ? normalizeNullableText(req.body?.displayName, 400)
          : normalizeNullableText(existing.displayName, 400),
      street:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'street')
          ? normalizeNullableText(req.body?.street, 400)
          : normalizeNullableText(existing.street, 400),
      houseNumber:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'houseNumber')
          ? normalizeNullableText(req.body?.houseNumber, 80)
          : normalizeNullableText(existing.houseNumber, 80),
      postalCode:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'postalCode')
          ? normalizeNullableText(req.body?.postalCode, 40)
          : normalizeNullableText(existing.postalCode, 40),
      city:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'city')
          ? normalizeNullableText(req.body?.city, 191)
          : normalizeNullableText(existing.city, 191),
      country:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'country')
          ? normalizeNullableText(req.body?.country, 191)
          : normalizeNullableText(existing.country, 191),
      generalEmail:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'generalEmail')
          ? normalizeOptionalEmailField(req.body?.generalEmail, 'generalEmail')
          : normalizeOptionalEmailField(existing.generalEmail, 'generalEmail'),
      supportEmail:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'supportEmail')
          ? normalizeOptionalEmailField(req.body?.supportEmail, 'supportEmail')
          : normalizeOptionalEmailField(existing.supportEmail, 'supportEmail'),
      phone:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'phone')
          ? normalizeNullableText(req.body?.phone, 120)
          : normalizeNullableText(existing.phone, 120),
      homepage:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'homepage')
          ? normalizeOptionalHomepage(req.body?.homepage)
          : normalizeOptionalHomepage(existing.homepage),
      responsiblePersonName:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'responsiblePersonName')
          ? normalizeNullableText(req.body?.responsiblePersonName, 191)
          : normalizeNullableText(existing.responsiblePersonName, 191),
      responsiblePersonRole:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'responsiblePersonRole')
          ? normalizeNullableText(req.body?.responsiblePersonRole, 191)
          : normalizeNullableText(existing.responsiblePersonRole, 191),
      responsiblePersonEmail:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'responsiblePersonEmail')
          ? normalizeOptionalEmailField(req.body?.responsiblePersonEmail, 'responsiblePersonEmail')
          : normalizeOptionalEmailField(existing.responsiblePersonEmail, 'responsiblePersonEmail'),
      responsiblePersonPhone:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'responsiblePersonPhone')
          ? normalizeNullableText(req.body?.responsiblePersonPhone, 120)
          : normalizeNullableText(existing.responsiblePersonPhone, 120),
      vatId:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'vatId')
          ? normalizeNullableText(req.body?.vatId, 191)
          : normalizeNullableText(existing.vatId, 191),
      imprintText:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'imprintText')
          ? normalizeNullableText(req.body?.imprintText, 8000)
          : normalizeNullableText(existing.imprintText, 8000),
      privacyContact:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'privacyContact')
          ? normalizeNullableText(req.body?.privacyContact, 2000)
          : normalizeNullableText(existing.privacyContact, 2000),
    };

    if (!next.legalName && tenant?.name) {
      next.legalName = normalizeText(tenant.name).slice(0, 400);
    }
    if (!next.displayName && tenant?.name) {
      next.displayName = normalizeText(tenant.name).slice(0, 400);
    }

    if (existingRow?.tenant_id) {
      await db.run(
        `UPDATE tenant_profiles
         SET legal_name = ?, display_name = ?, street = ?, house_number = ?, postal_code = ?, city = ?, country = ?,
             general_email = ?, support_email = ?, phone = ?, homepage = ?, responsible_person_name = ?, responsible_person_role = ?,
             responsible_person_email = ?, responsible_person_phone = ?, vat_id = ?, imprint_text = ?, privacy_contact = ?,
             updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?`,
        [
          next.legalName,
          next.displayName,
          next.street,
          next.houseNumber,
          next.postalCode,
          next.city,
          next.country,
          next.generalEmail,
          next.supportEmail,
          next.phone,
          next.homepage,
          next.responsiblePersonName,
          next.responsiblePersonRole,
          next.responsiblePersonEmail,
          next.responsiblePersonPhone,
          next.vatId,
          next.imprintText,
          next.privacyContact,
          normalizeText(req.userId) || null,
          tenantId,
        ]
      );
    } else {
      await db.run(
        `INSERT INTO tenant_profiles (
           id, tenant_id, legal_name, display_name, street, house_number, postal_code, city, country,
           general_email, support_email, phone, homepage, responsible_person_name, responsible_person_role,
           responsible_person_email, responsible_person_phone, vat_id, imprint_text, privacy_contact, updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createId('tpr'),
          tenantId,
          next.legalName,
          next.displayName,
          next.street,
          next.houseNumber,
          next.postalCode,
          next.city,
          next.country,
          next.generalEmail,
          next.supportEmail,
          next.phone,
          next.homepage,
          next.responsiblePersonName,
          next.responsiblePersonRole,
          next.responsiblePersonEmail,
          next.responsiblePersonPhone,
          next.vatId,
          next.imprintText,
          next.privacyContact,
          normalizeText(req.userId) || null,
        ]
      );
    }

    const updated = await db.get<any>(
      `SELECT tenant_id, legal_name, display_name, street, house_number, postal_code, city, country,
              general_email, support_email, phone, homepage, responsible_person_name, responsible_person_role,
              responsible_person_email, responsible_person_phone, vat_id, imprint_text, privacy_contact,
              created_at, updated_at, updated_by
       FROM tenant_profiles
       WHERE tenant_id = ?
       LIMIT 1`,
      [tenantId]
    );

    return res.json({
      message: 'Tenant-Profil gespeichert.',
      profile: mapTenantProfileRow(tenantId, updated, tenant?.name || ''),
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('keine gültige E-Mail-Adresse') || message.includes('keine gültige URL')) {
      return res.status(400).json({ message });
    }
    return res.status(Number(error?.status || 500)).json({
      message: message || 'Fehler beim Speichern des Tenant-Profils.',
      error: error?.message,
    });
  }
});

// DELETE /api/admin/tenants/:tenantId
router.delete('/tenants/:tenantId', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    await ensurePlatformAdmin(req);

    const tenantId = normalizeText(req.params.tenantId);
    if (!tenantId) return res.status(400).json({ message: 'tenantId fehlt.' });

    const db = getDatabase();
    if (tenantId === 'tenant_default') {
      return res.status(400).json({ message: 'Der Standard-Mandant kann nicht gelöscht werden.' });
    }

    const ticketCount = await db.get<any>(
      `SELECT COUNT(*) AS count
       FROM tickets
       WHERE tenant_id = ?`,
      [tenantId]
    );
    if (Number(ticketCount?.count || 0) > 0) {
      return res.status(409).json({ message: 'Mandant enthält noch Tickets und kann nicht gelöscht werden.' });
    }

    await db.run(`DELETE FROM tenants WHERE id = ?`, [tenantId]);
    return res.json({ message: 'Mandant gelöscht.' });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Löschen des Mandanten', error: error?.message });
  }
});

// GET /api/admin/tenants/:tenantId/org-unit-types
router.get('/tenants/:tenantId/org-unit-types', async (req: Request, res: Response): Promise<any> => {
  try {
    const tenantId = normalizeText(req.params.tenantId);
    if (!(await ensureTenantExists(tenantId))) {
      return res.status(404).json({ message: 'Mandant nicht gefunden.' });
    }
    await ensureTenantReadAccess(req, tenantId);

    const db = getDatabase();
    const rows = await db.all(
      `SELECT id, tenant_id, \`key\`, label, is_assignable, sort_order, active, rules_json, assignment_keywords_json, created_at, updated_at
       FROM org_unit_types
       WHERE tenant_id = ?
       ORDER BY sort_order ASC, label ASC`,
      [tenantId]
    );

    return res.json(
      (rows || []).map((row: any) => ({
        id: String(row?.id || ''),
        tenantId: String(row?.tenant_id || ''),
        key: String(row?.key || ''),
        label: String(row?.label || ''),
        isAssignable: Number(row?.is_assignable ?? 1) === 1,
        sortOrder: Number(row?.sort_order || 0),
        active: Number(row?.active ?? 1) === 1,
        rulesJson: row?.rules_json || null,
        assignmentKeywords: parseAssignmentKeywordsFromDb(row?.assignment_keywords_json),
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
      }))
    );
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Laden der Organisationstypen', error: error?.message });
  }
});

// POST /api/admin/tenants/:tenantId/org-unit-types
router.post('/tenants/:tenantId/org-unit-types', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const tenantId = normalizeText(req.params.tenantId);
    if (!(await ensureTenantExists(tenantId))) {
      return res.status(404).json({ message: 'Mandant nicht gefunden.' });
    }
    await ensureTenantAdminAccess(req, tenantId);

    const key = normalizeText(req.body?.key).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    const label = normalizeText(req.body?.label || key);
    if (!key || !label) {
      return res.status(400).json({ message: 'key und label sind erforderlich.' });
    }

    const db = getDatabase();
    const duplicate = await db.get(
      `SELECT id
       FROM org_unit_types
       WHERE tenant_id = ?
         AND LOWER(TRIM(\`key\`)) = ?
       LIMIT 1`,
      [tenantId, key]
    );
    if (duplicate?.id) {
      return res.status(409).json({ message: 'Typ-Key existiert bereits im Mandanten.' });
    }

    const id = createId('out');
    const isAssignable = toBool(req.body?.isAssignable ?? req.body?.is_assignable, true);
    const sortOrder = Number.isFinite(Number(req.body?.sortOrder ?? req.body?.sort_order))
      ? Math.floor(Number(req.body?.sortOrder ?? req.body?.sort_order))
      : 0;
    const active = toBool(req.body?.active, true);
    const rulesJson = parseJsonOrNull(req.body?.rulesJson ?? req.body?.rules_json);
    const assignmentKeywordsJson = serializeAssignmentKeywords(
      req.body?.assignmentKeywords ?? req.body?.assignment_keywords
    );

    await db.run(
      `INSERT INTO org_unit_types (id, tenant_id, \`key\`, label, is_assignable, sort_order, active, rules_json, assignment_keywords_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId, key, label, isAssignable ? 1 : 0, sortOrder, active ? 1 : 0, rulesJson, assignmentKeywordsJson]
    );

    return res.status(201).json({
      id,
      tenantId,
      key,
      label,
      isAssignable,
      sortOrder,
      active,
      rulesJson,
      assignmentKeywords: parseAssignmentKeywordsFromDb(assignmentKeywordsJson),
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Erstellen des Organisationstyps', error: error?.message });
  }
});

// PATCH /api/admin/org-unit-types/:typeId
router.patch('/org-unit-types/:typeId', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const typeId = normalizeText(req.params.typeId);
    if (!typeId) return res.status(400).json({ message: 'typeId fehlt.' });

    const db = getDatabase();
    const current = await db.get<any>(`SELECT id, tenant_id FROM org_unit_types WHERE id = ?`, [typeId]);
    if (!current?.id) return res.status(404).json({ message: 'Organisationstyp nicht gefunden.' });
    await ensureTenantAdminAccess(req, normalizeText(current?.tenant_id));

    const updates: string[] = [];
    const params: any[] = [];

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'key')) {
      const key = normalizeText(req.body?.key).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      if (!key) return res.status(400).json({ message: 'key darf nicht leer sein.' });
      updates.push('\`key\` = ?');
      params.push(key);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'label')) {
      const label = normalizeText(req.body?.label);
      if (!label) return res.status(400).json({ message: 'label darf nicht leer sein.' });
      updates.push('label = ?');
      params.push(label);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isAssignable') || Object.prototype.hasOwnProperty.call(req.body || {}, 'is_assignable')) {
      updates.push('is_assignable = ?');
      params.push(toBool(req.body?.isAssignable ?? req.body?.is_assignable, true) ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'sortOrder') || Object.prototype.hasOwnProperty.call(req.body || {}, 'sort_order')) {
      updates.push('sort_order = ?');
      params.push(
        Number.isFinite(Number(req.body?.sortOrder ?? req.body?.sort_order))
          ? Math.floor(Number(req.body?.sortOrder ?? req.body?.sort_order))
          : 0
      );
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'active')) {
      updates.push('active = ?');
      params.push(toBool(req.body?.active, true) ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'rulesJson') || Object.prototype.hasOwnProperty.call(req.body || {}, 'rules_json')) {
      updates.push('rules_json = ?');
      params.push(parseJsonOrNull(req.body?.rulesJson ?? req.body?.rules_json));
    }
    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, 'assignmentKeywords') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'assignment_keywords')
    ) {
      updates.push('assignment_keywords_json = ?');
      params.push(serializeAssignmentKeywords(req.body?.assignmentKeywords ?? req.body?.assignment_keywords));
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'Keine Änderungen angegeben.' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    await db.run(`UPDATE org_unit_types SET ${updates.join(', ')} WHERE id = ?`, [...params, typeId]);

    const updated = await db.get<any>(
      `SELECT id, tenant_id, \`key\`, label, is_assignable, sort_order, active, rules_json, assignment_keywords_json, created_at, updated_at
       FROM org_unit_types
       WHERE id = ?`,
      [typeId]
    );

    return res.json({
      id: String(updated?.id || ''),
      tenantId: String(updated?.tenant_id || ''),
      key: String(updated?.key || ''),
      label: String(updated?.label || ''),
      isAssignable: Number(updated?.is_assignable ?? 1) === 1,
      sortOrder: Number(updated?.sort_order || 0),
      active: Number(updated?.active ?? 1) === 1,
      rulesJson: updated?.rules_json || null,
      assignmentKeywords: parseAssignmentKeywordsFromDb(updated?.assignment_keywords_json),
      createdAt: updated?.created_at || null,
      updatedAt: updated?.updated_at || null,
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Aktualisieren des Organisationstyps', error: error?.message });
  }
});

// DELETE /api/admin/org-unit-types/:typeId
router.delete('/org-unit-types/:typeId', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const typeId = normalizeText(req.params.typeId);
    if (!typeId) return res.status(400).json({ message: 'typeId fehlt.' });

    const db = getDatabase();
    const current = await db.get<any>(`SELECT id, tenant_id FROM org_unit_types WHERE id = ?`, [typeId]);
    if (!current?.id) return res.status(404).json({ message: 'Organisationstyp nicht gefunden.' });
    await ensureTenantAdminAccess(req, normalizeText(current?.tenant_id));

    const usage = await db.get<any>(
      `SELECT COUNT(*) AS count
       FROM org_units
       WHERE type_id = ?`,
      [typeId]
    );
    if (Number(usage?.count || 0) > 0) {
      return res.status(409).json({ message: 'Typ wird noch von Organisationseinheiten verwendet.' });
    }

    await db.run(`DELETE FROM org_unit_types WHERE id = ?`, [typeId]);
    return res.json({ message: 'Organisationstyp gelöscht.' });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Löschen des Organisationstyps', error: error?.message });
  }
});

// GET /api/admin/tenants/:tenantId/org-units
router.get('/tenants/:tenantId/org-units', async (req: Request, res: Response): Promise<any> => {
  try {
    const tenantId = normalizeText(req.params.tenantId);
    if (!(await ensureTenantExists(tenantId))) {
      return res.status(404).json({ message: 'Mandant nicht gefunden.' });
    }
    await ensureTenantReadAccess(req, tenantId);

    const includeInactive = toBool(req.query?.includeInactive, false);
    const db = getDatabase();
    const rows = await db.all(
      `SELECT id, tenant_id, type_id, parent_id, name, code, contact_email, active, metadata_json, assignment_keywords_json, created_at, updated_at
       FROM org_units
       WHERE tenant_id = ?
         ${includeInactive ? '' : 'AND active = 1'}
       ORDER BY name ASC, created_at ASC`,
      [tenantId]
    );

    return res.json(
      (rows || []).map((row: any) => ({
        id: String(row?.id || ''),
        tenantId: String(row?.tenant_id || ''),
        typeId: row?.type_id ? String(row.type_id) : null,
        parentId: row?.parent_id ? String(row.parent_id) : null,
        name: String(row?.name || ''),
        code: row?.code ? String(row.code) : null,
        contactEmail: row?.contact_email ? String(row.contact_email) : null,
        active: Number(row?.active ?? 1) === 1,
        metadataJson: row?.metadata_json || null,
        assignmentKeywords: parseAssignmentKeywordsFromDb(row?.assignment_keywords_json),
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
      }))
    );
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Laden der Organisationseinheiten', error: error?.message });
  }
});

// POST /api/admin/tenants/:tenantId/org-units
router.post('/tenants/:tenantId/org-units', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const tenantId = normalizeText(req.params.tenantId);
    if (!(await ensureTenantExists(tenantId))) {
      return res.status(404).json({ message: 'Mandant nicht gefunden.' });
    }
    await ensureTenantAdminAccess(req, tenantId);

    const name = normalizeText(req.body?.name);
    if (!name) return res.status(400).json({ message: 'name ist erforderlich.' });

    const parentId = normalizeText(req.body?.parentId || req.body?.parent_id) || null;
    const typeId = normalizeText(req.body?.typeId || req.body?.type_id) || null;
    const code = normalizeText(req.body?.code) || null;
    let contactEmail: string | null = null;
    try {
      contactEmail = normalizeOptionalEmail(req.body?.contactEmail ?? req.body?.contact_email);
    } catch (error: any) {
      return res.status(400).json({ message: error?.message || 'Ungültige contactEmail.' });
    }
    const active = toBool(req.body?.active, true);
    const metadataJson = parseJsonOrNull(req.body?.metadataJson ?? req.body?.metadata_json);
    const assignmentKeywordsJson = serializeAssignmentKeywords(
      req.body?.assignmentKeywords ?? req.body?.assignment_keywords
    );

    const db = getDatabase();
    if (parentId) {
      const parent = await db.get<any>(
        `SELECT id
         FROM org_units
         WHERE id = ?
           AND tenant_id = ?`,
        [parentId, tenantId]
      );
      if (!parent?.id) {
        return res.status(400).json({ message: 'parentId gehört nicht zum Mandanten.' });
      }
    }
    if (typeId) {
      const type = await db.get<any>(
        `SELECT id
         FROM org_unit_types
         WHERE id = ?
           AND tenant_id = ?`,
        [typeId, tenantId]
      );
      if (!type?.id) {
        return res.status(400).json({ message: 'typeId gehört nicht zum Mandanten.' });
      }
    }

    const id = createId('ou');
    await db.run(
      `INSERT INTO org_units (id, tenant_id, type_id, parent_id, name, code, contact_email, active, metadata_json, assignment_keywords_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId, typeId, parentId, name, code, contactEmail, active ? 1 : 0, metadataJson, assignmentKeywordsJson]
    );

    await rebuildOrgUnitClosure(tenantId);

    return res.status(201).json({
      id,
      tenantId,
      typeId,
      parentId,
      name,
      code,
      contactEmail,
      active,
      metadataJson,
      assignmentKeywords: parseAssignmentKeywordsFromDb(assignmentKeywordsJson),
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Erstellen der Organisationseinheit', error: error?.message });
  }
});

// PATCH /api/admin/org-units/:unitId
router.patch('/org-units/:unitId', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const unitId = normalizeText(req.params.unitId);
    if (!unitId) return res.status(400).json({ message: 'unitId fehlt.' });

    const db = getDatabase();
    const current = await db.get<any>(
      `SELECT id, tenant_id
       FROM org_units
       WHERE id = ?`,
      [unitId]
    );
    if (!current?.id) {
      return res.status(404).json({ message: 'Organisationseinheit nicht gefunden.' });
    }
    const tenantId = String(current.tenant_id);
    await ensureTenantAdminAccess(req, tenantId);

    const updates: string[] = [];
    const params: any[] = [];

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      const name = normalizeText(req.body?.name);
      if (!name) return res.status(400).json({ message: 'name darf nicht leer sein.' });
      updates.push('name = ?');
      params.push(name);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'code')) {
      updates.push('code = ?');
      params.push(normalizeText(req.body?.code) || null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'contactEmail') || Object.prototype.hasOwnProperty.call(req.body || {}, 'contact_email')) {
      let contactEmail: string | null = null;
      try {
        contactEmail = normalizeOptionalEmail(req.body?.contactEmail ?? req.body?.contact_email);
      } catch (error: any) {
        return res.status(400).json({ message: error?.message || 'Ungültige contactEmail.' });
      }
      updates.push('contact_email = ?');
      params.push(contactEmail);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'active')) {
      updates.push('active = ?');
      params.push(toBool(req.body?.active, true) ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'parentId') || Object.prototype.hasOwnProperty.call(req.body || {}, 'parent_id')) {
      const parentId = normalizeText(req.body?.parentId || req.body?.parent_id) || null;
      if (parentId === unitId) {
        return res.status(400).json({ message: 'Eine Einheit kann nicht ihr eigener Parent sein.' });
      }
      if (parentId) {
        const parent = await db.get<any>(
          `SELECT id
           FROM org_units
           WHERE id = ?
             AND tenant_id = ?`,
          [parentId, tenantId]
        );
        if (!parent?.id) {
          return res.status(400).json({ message: 'parentId gehört nicht zum Mandanten.' });
        }
      }
      updates.push('parent_id = ?');
      params.push(parentId);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'typeId') || Object.prototype.hasOwnProperty.call(req.body || {}, 'type_id')) {
      const typeId = normalizeText(req.body?.typeId || req.body?.type_id) || null;
      if (typeId) {
        const type = await db.get<any>(
          `SELECT id
           FROM org_unit_types
           WHERE id = ?
             AND tenant_id = ?`,
          [typeId, tenantId]
        );
        if (!type?.id) {
          return res.status(400).json({ message: 'typeId gehört nicht zum Mandanten.' });
        }
      }
      updates.push('type_id = ?');
      params.push(typeId);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'metadataJson') || Object.prototype.hasOwnProperty.call(req.body || {}, 'metadata_json')) {
      updates.push('metadata_json = ?');
      params.push(parseJsonOrNull(req.body?.metadataJson ?? req.body?.metadata_json));
    }
    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, 'assignmentKeywords') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'assignment_keywords')
    ) {
      updates.push('assignment_keywords_json = ?');
      params.push(serializeAssignmentKeywords(req.body?.assignmentKeywords ?? req.body?.assignment_keywords));
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'Keine Änderungen angegeben.' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    await db.run(`UPDATE org_units SET ${updates.join(', ')} WHERE id = ?`, [...params, unitId]);
    await rebuildOrgUnitClosure(tenantId);

    const updated = await db.get<any>(
      `SELECT id, tenant_id, type_id, parent_id, name, code, contact_email, active, metadata_json, assignment_keywords_json, created_at, updated_at
       FROM org_units
       WHERE id = ?`,
      [unitId]
    );

    return res.json({
      id: String(updated?.id || ''),
      tenantId: String(updated?.tenant_id || ''),
      typeId: updated?.type_id ? String(updated.type_id) : null,
      parentId: updated?.parent_id ? String(updated.parent_id) : null,
      name: String(updated?.name || ''),
      code: updated?.code ? String(updated.code) : null,
      contactEmail: updated?.contact_email ? String(updated.contact_email) : null,
      active: Number(updated?.active ?? 1) === 1,
      metadataJson: updated?.metadata_json || null,
      assignmentKeywords: parseAssignmentKeywordsFromDb(updated?.assignment_keywords_json),
      createdAt: updated?.created_at || null,
      updatedAt: updated?.updated_at || null,
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Aktualisieren der Organisationseinheit', error: error?.message });
  }
});

// DELETE /api/admin/org-units/:unitId
router.delete('/org-units/:unitId', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const unitId = normalizeText(req.params.unitId);
    if (!unitId) return res.status(400).json({ message: 'unitId fehlt.' });

    const db = getDatabase();
    const unit = await db.get<any>(
      `SELECT id, tenant_id
       FROM org_units
       WHERE id = ?`,
      [unitId]
    );
    if (!unit?.id) return res.status(404).json({ message: 'Organisationseinheit nicht gefunden.' });
    await ensureTenantAdminAccess(req, normalizeText(unit?.tenant_id));

    const child = await db.get<any>(
      `SELECT id
       FROM org_units
       WHERE parent_id = ?
       LIMIT 1`,
      [unitId]
    );
    if (child?.id) {
      return res.status(409).json({ message: 'Einheit hat noch Untereinheiten und kann nicht gelöscht werden.' });
    }

    const assignmentUse = await db.get<any>(
      `SELECT COUNT(*) AS count
       FROM tickets
       WHERE owning_org_unit_id = ?
          OR primary_assignee_org_unit_id = ?`,
      [unitId, unitId]
    );
    if (Number(assignmentUse?.count || 0) > 0) {
      return res.status(409).json({ message: 'Einheit wird noch in Tickets verwendet.' });
    }

    await db.run(`DELETE FROM admin_user_org_scopes WHERE org_unit_id = ?`, [unitId]);
    await db.run(`DELETE FROM ticket_collaborators WHERE org_unit_id = ?`, [unitId]);
    await db.run(`DELETE FROM workflow_internal_tasks WHERE assignee_org_unit_id = ?`, [unitId]);
    await db.run(`DELETE FROM org_units WHERE id = ?`, [unitId]);

    await rebuildOrgUnitClosure(String(unit.tenant_id));

    return res.json({ message: 'Organisationseinheit gelöscht.' });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Löschen der Organisationseinheit', error: error?.message });
  }
});

// GET /api/admin/org-units/:unitId/members
router.get('/org-units/:unitId/members', async (req: Request, res: Response): Promise<any> => {
  try {
    const unitId = normalizeText(req.params.unitId);
    if (!unitId) return res.status(400).json({ message: 'unitId fehlt.' });

    const db = getDatabase();
    const unit = await db.get<any>(
      `SELECT id, tenant_id, name
       FROM org_units
       WHERE id = ?`,
      [unitId]
    );
    if (!unit?.id) {
      return res.status(404).json({ message: 'Organisationseinheit nicht gefunden.' });
    }
    await ensureTenantReadAccess(req, normalizeText(unit?.tenant_id));

    const rows = await db.all<any>(
      `SELECT s.admin_user_id,
              COALESCE(s.can_write, 0) AS can_write,
              u.username,
              u.email,
              u.first_name,
              u.last_name,
              u.role,
              COALESCE(u.active, 1) AS active
       FROM admin_user_org_scopes s
       JOIN admin_users u ON u.id = s.admin_user_id
       WHERE s.org_unit_id = ?
       ORDER BY COALESCE(u.active, 1) DESC, LOWER(COALESCE(u.last_name, '')), LOWER(COALESCE(u.first_name, '')), LOWER(COALESCE(u.username, ''))`,
      [unitId]
    );

    return res.json({
      unitId,
      tenantId: String(unit.tenant_id),
      unitName: String(unit.name || ''),
      members: (rows || []).map((row: any) => ({
        userId: String(row?.admin_user_id || ''),
        username: String(row?.username || ''),
        email: row?.email ? String(row.email) : null,
        firstName: row?.first_name ? String(row.first_name) : null,
        lastName: row?.last_name ? String(row.last_name) : null,
        role: row?.role ? String(row.role) : null,
        active: Number(row?.active ?? 1) === 1,
        canWrite: Number(row?.can_write || 0) === 1,
      })),
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Laden der Gruppenmitglieder', error: error?.message });
  }
});

// PUT /api/admin/org-units/:unitId/members
router.put('/org-units/:unitId/members', adminOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const unitId = normalizeText(req.params.unitId);
    if (!unitId) return res.status(400).json({ message: 'unitId fehlt.' });

    const db = getDatabase();
    const unit = await db.get<any>(
      `SELECT id, tenant_id, name
       FROM org_units
       WHERE id = ?`,
      [unitId]
    );
    if (!unit?.id) {
      return res.status(404).json({ message: 'Organisationseinheit nicht gefunden.' });
    }
    await ensureTenantAdminAccess(req, normalizeText(unit?.tenant_id));
    const access = await loadAdminAccessContext(String(req.userId || ''), String(req.role || ''));
    const actorUserId = normalizeText(req.userId);

    type MemberInput = { userId: string; canWrite: boolean };
    const parsedMembers: MemberInput[] = [];
    const seen = new Set<string>();
    const rawMembers = Array.isArray(req.body?.members) ? req.body.members : [];
    if (rawMembers.length > 0) {
      for (const entry of rawMembers) {
        if (!entry || typeof entry !== 'object') continue;
        const source = entry as Record<string, unknown>;
        const userId = normalizeText(source.userId || source.adminUserId || source.id);
        if (!userId || seen.has(userId)) continue;
        seen.add(userId);
        parsedMembers.push({
          userId,
          canWrite: toBool(source.canWrite, true),
        });
      }
    } else {
      const userIds = Array.isArray(req.body?.userIds)
        ? req.body.userIds.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
        : [];
      const defaultCanWrite = toBool(req.body?.canWrite, true);
      for (const userId of userIds) {
        if (!userId || seen.has(userId)) continue;
        seen.add(userId);
        parsedMembers.push({ userId, canWrite: defaultCanWrite });
      }
    }

    if (parsedMembers.length > 0) {
      const placeholders = parsedMembers.map(() => '?').join(', ');
      const knownRows = await db.all<any>(
        `SELECT id
         FROM admin_users
         WHERE id IN (${placeholders})`,
        parsedMembers.map((entry) => entry.userId)
      );
      const knownSet = new Set((knownRows || []).map((row: any) => normalizeText(row?.id)));
      const missing = parsedMembers.map((entry) => entry.userId).filter((entry) => !knownSet.has(entry));
      if (missing.length > 0) {
        return res.status(400).json({ message: `Unbekannte Benutzer: ${Array.from(new Set(missing)).join(', ')}` });
      }

      if (!access.isGlobalAdmin) {
        const restrictedRows = await db.all<any>(
          `SELECT u.id,
                  COALESCE(u.is_global_admin, 0) AS is_global_admin,
                  COALESCE(MAX(CASE WHEN ts.tenant_id = ? AND COALESCE(ts.is_tenant_admin, 0) = 1 THEN 1 ELSE 0 END), 0) AS is_tenant_admin_for_tenant,
                  COALESCE(MAX(CASE WHEN ts.tenant_id = ? THEN 1 ELSE 0 END), 0) AS has_tenant_scope_for_tenant,
                  COALESCE(MAX(CASE WHEN os.tenant_id = ? THEN 1 ELSE 0 END), 0) AS has_org_scope_for_tenant
           FROM admin_users u
           LEFT JOIN admin_user_tenant_scopes ts ON ts.admin_user_id = u.id
           LEFT JOIN admin_user_org_scopes os ON os.admin_user_id = u.id
           WHERE u.id IN (${placeholders})
           GROUP BY u.id`,
          [String(unit.tenant_id), String(unit.tenant_id), String(unit.tenant_id), ...parsedMembers.map((entry) => entry.userId)]
        );
        const byId = new Map<string, any>(
          (restrictedRows || []).map((row: any) => [normalizeText(row?.id), row])
        );
        for (const member of parsedMembers) {
          const row = byId.get(member.userId);
          if (!row) {
            return res.status(400).json({ message: `Unbekannter Benutzer: ${member.userId}` });
          }
          const isGlobalAdmin = Number(row?.is_global_admin || 0) === 1;
          const isTenantAdminForTenant = Number(row?.is_tenant_admin_for_tenant || 0) === 1;
          const hasTenantScopeForTenant = Number(row?.has_tenant_scope_for_tenant || 0) === 1;
          const hasOrgScopeForTenant = Number(row?.has_org_scope_for_tenant || 0) === 1;

          if (isGlobalAdmin) {
            return res.status(403).json({
              message: 'Plattform-Admin-Konten können nur von Plattform-Admins in Orga-Gruppen verwaltet werden.',
            });
          }
          if (isTenantAdminForTenant && member.userId !== actorUserId) {
            return res.status(403).json({
              message: 'Tenant-Admin-Konten können nur von Plattform-Admins in Orga-Gruppen verwaltet werden.',
            });
          }
          if (!hasTenantScopeForTenant && !hasOrgScopeForTenant) {
            return res.status(403).json({
              message:
                'Benutzer ohne Mandantenzuordnung dürfen nicht über diese API einer Organisationseinheit zugewiesen werden.',
            });
          }
        }
      }
    }

    const requestedUserIdSet = new Set(parsedMembers.map((entry) => entry.userId));
    if (requestedUserIdSet.size === 0) {
      await db.run(`DELETE FROM admin_user_org_scopes WHERE org_unit_id = ?`, [unitId]);
    } else {
      const requestedIds = Array.from(requestedUserIdSet);
      const placeholders = requestedIds.map(() => '?').join(', ');
      await db.run(
        `DELETE FROM admin_user_org_scopes
         WHERE org_unit_id = ?
           AND admin_user_id NOT IN (${placeholders})`,
        [unitId, ...requestedIds]
      );
    }

    const memberMap = new Map(parsedMembers.map((entry) => [entry.userId, entry.canWrite]));
    for (const [userId, canWrite] of memberMap.entries()) {
      const existing = await db.get<any>(
        `SELECT id
         FROM admin_user_org_scopes
         WHERE admin_user_id = ?
           AND org_unit_id = ?
         LIMIT 1`,
        [userId, unitId]
      );
      if (existing?.id) {
        await db.run(
          `UPDATE admin_user_org_scopes
           SET can_write = ?
           WHERE id = ?`,
          [canWrite ? 1 : 0, String(existing.id)]
        );
      } else {
        await db.run(
          `INSERT INTO admin_user_org_scopes (id, admin_user_id, tenant_id, org_unit_id, can_write)
           VALUES (?, ?, ?, ?, ?)`,
          [createId('auos'), userId, String(unit.tenant_id), unitId, canWrite ? 1 : 0]
        );
      }
    }

    const rows = await db.all<any>(
      `SELECT s.admin_user_id,
              COALESCE(s.can_write, 0) AS can_write,
              u.username,
              u.email,
              u.first_name,
              u.last_name,
              u.role,
              COALESCE(u.active, 1) AS active
       FROM admin_user_org_scopes s
       JOIN admin_users u ON u.id = s.admin_user_id
       WHERE s.org_unit_id = ?
       ORDER BY COALESCE(u.active, 1) DESC, LOWER(COALESCE(u.last_name, '')), LOWER(COALESCE(u.first_name, '')), LOWER(COALESCE(u.username, ''))`,
      [unitId]
    );

    return res.json({
      message: 'Gruppenmitglieder aktualisiert.',
      unitId,
      tenantId: String(unit.tenant_id),
      unitName: String(unit.name || ''),
      members: (rows || []).map((row: any) => ({
        userId: String(row?.admin_user_id || ''),
        username: String(row?.username || ''),
        email: row?.email ? String(row.email) : null,
        firstName: row?.first_name ? String(row.first_name) : null,
        lastName: row?.last_name ? String(row.last_name) : null,
        role: row?.role ? String(row.role) : null,
        active: Number(row?.active ?? 1) === 1,
        canWrite: Number(row?.can_write || 0) === 1,
      })),
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Aktualisieren der Gruppenmitglieder', error: error?.message });
  }
});

// GET /api/admin/tenants/:tenantId/org-tree
router.get('/tenants/:tenantId/org-tree', async (req: Request, res: Response): Promise<any> => {
  try {
    const tenantId = normalizeText(req.params.tenantId);
    if (!(await ensureTenantExists(tenantId))) {
      return res.status(404).json({ message: 'Mandant nicht gefunden.' });
    }
    await ensureTenantReadAccess(req, tenantId);

    const includeInactive = toBool(req.query?.includeInactive, false);
    const db = getDatabase();

    const [types, units] = await Promise.all([
      db.all<any>(
        `SELECT id, tenant_id, \`key\`, label, is_assignable, sort_order, active, rules_json, assignment_keywords_json
         FROM org_unit_types
         WHERE tenant_id = ?
         ORDER BY sort_order ASC, label ASC`,
        [tenantId]
      ),
      db.all<any>(
        `SELECT id, tenant_id, type_id, parent_id, name, code, contact_email, active, metadata_json, assignment_keywords_json
         FROM org_units
         WHERE tenant_id = ?
           ${includeInactive ? '' : 'AND active = 1'}
         ORDER BY name ASC`,
        [tenantId]
      ),
    ]);

    const byParent = new Map<string, any[]>();
    const rootNodes: any[] = [];
    for (const unit of units || []) {
      const parentId = normalizeText(unit?.parent_id);
      if (!parentId) {
        rootNodes.push(unit);
        continue;
      }
      const bucket = byParent.get(parentId) || [];
      bucket.push(unit);
      byParent.set(parentId, bucket);
    }

    const buildNode = (row: any): any => {
      const id = normalizeText(row?.id);
      const childrenRows = byParent.get(id) || [];
      const children = childrenRows.map((child) => buildNode(child));
      return {
        id,
        tenantId: normalizeText(row?.tenant_id),
        typeId: normalizeText(row?.type_id) || null,
        parentId: normalizeText(row?.parent_id) || null,
        name: normalizeText(row?.name),
        code: normalizeText(row?.code) || null,
        contactEmail: normalizeText(row?.contact_email) || null,
        active: Number(row?.active ?? 1) === 1,
        metadataJson: row?.metadata_json || null,
        assignmentKeywords: parseAssignmentKeywordsFromDb(row?.assignment_keywords_json),
        children,
      };
    };

    return res.json({
      tenantId,
      unitTypes: (types || []).map((row: any) => ({
        id: normalizeText(row?.id),
        tenantId: normalizeText(row?.tenant_id),
        key: normalizeText(row?.key),
        label: normalizeText(row?.label),
        isAssignable: Number(row?.is_assignable ?? 1) === 1,
        sortOrder: Number(row?.sort_order || 0),
        active: Number(row?.active ?? 1) === 1,
        rulesJson: row?.rules_json || null,
        assignmentKeywords: parseAssignmentKeywordsFromDb(row?.assignment_keywords_json),
      })),
      roots: rootNodes.map((row) => buildNode(row)),
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: 'Fehler beim Laden des Organisationsbaums', error: error?.message });
  }
});

export default router;
