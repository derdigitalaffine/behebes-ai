/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * User Management API
 */

import express, { Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { loadAdminAccessContext } from '../services/rbac.js';
import { normalizeRole } from '../utils/roles.js';
import { getDatabase } from '../database.js';
import { disableAdminTotpFactor } from '../services/admin-security.js';
import { issueUserInvite } from '../services/user-invites.js';

const router = express.Router();

// All routes require authentication and admin role
router.use(authMiddleware, adminOnly);

interface NormalizedTenantScopeInput {
  tenantId: string;
  isTenantAdmin: boolean;
}

interface NormalizedOrgScopeInput {
  tenantId: string;
  orgUnitId: string;
  canWrite: boolean;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
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

function sanitizeProfileData(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw as Record<string, any>)) {
    const normalizedKey = normalizeText(key).slice(0, 120);
    if (!normalizedKey) continue;
    if (value === undefined) continue;
    if (typeof value === 'string') {
      out[normalizedKey] = value.slice(0, 2000);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[normalizedKey] = value;
    } else {
      out[normalizedKey] = String(value).slice(0, 2000);
    }
  }
  return out;
}

function parseProfileDataFromDb(raw: unknown): Record<string, any> {
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

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTenantScopes(raw: unknown): NormalizedTenantScopeInput[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const scopes: NormalizedTenantScopeInput[] = [];

  for (const entry of raw) {
    const source =
      typeof entry === 'string'
        ? { tenantId: entry, isTenantAdmin: false }
        : entry && typeof entry === 'object'
        ? (entry as Record<string, any>)
        : null;
    if (!source) continue;

    const tenantId = normalizeText(source.tenantId || source.tenant_id || source.id);
    if (!tenantId) continue;

    const isTenantAdmin =
      source.isTenantAdmin === true || source.is_tenant_admin === true || source.tenantAdmin === true;

    const key = `${tenantId}::${isTenantAdmin ? '1' : '0'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({ tenantId, isTenantAdmin });
  }

  return scopes;
}

function normalizeOrgScopes(raw: unknown): NormalizedOrgScopeInput[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const scopes: NormalizedOrgScopeInput[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, any>;

    const tenantId = normalizeText(source.tenantId || source.tenant_id);
    const orgUnitId = normalizeText(source.orgUnitId || source.org_unit_id || source.id);
    if (!tenantId || !orgUnitId) continue;

    const canWrite = source.canWrite === true || source.can_write === true || source.write === true;
    const key = `${tenantId}::${orgUnitId}::${canWrite ? '1' : '0'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({ tenantId, orgUnitId, canWrite });
  }

  return scopes;
}

function createHttpError(status: number, message: string): Error {
  const error = new Error(message);
  (error as any).status = status;
  return error;
}

async function loadRequesterAccess(req: Request) {
  return loadAdminAccessContext(normalizeText(req.userId), normalizeText(req.role));
}

function assertUserManagementAllowed(access: { isGlobalAdmin: boolean; tenantAdminTenantIds: string[] }): void {
  if (access.isGlobalAdmin) return;
  if (Array.isArray(access.tenantAdminTenantIds) && access.tenantAdminTenantIds.length > 0) return;
  throw createHttpError(403, 'Keine Berechtigung zur Benutzerverwaltung.');
}

function isUserInManagedTenants(
  user: any,
  managedTenantIdSet: Set<string>,
  requesterUserId: string
): boolean {
  const userId = normalizeText(user?.id);
  if (userId && userId === requesterUserId) return true;
  if (Number(user?.isGlobalAdmin ?? user?.is_global_admin ?? 0) === 1) return false;

  const tenantScopes = Array.isArray(user?.tenantScopes) ? user.tenantScopes : [];
  for (const scope of tenantScopes) {
    const tenantId = normalizeText(scope?.tenantId || scope?.tenant_id);
    if (tenantId && managedTenantIdSet.has(tenantId)) return true;
  }

  const orgScopes = Array.isArray(user?.orgScopes) ? user.orgScopes : [];
  for (const scope of orgScopes) {
    const tenantId = normalizeText(scope?.tenantId || scope?.tenant_id);
    if (tenantId && managedTenantIdSet.has(tenantId)) return true;
  }

  return false;
}

function assertAssignableScopes(
  access: { isGlobalAdmin: boolean; tenantAdminTenantIds: string[] },
  role: string,
  isGlobalAdmin: boolean,
  tenantScopes: NormalizedTenantScopeInput[],
  orgScopes: NormalizedOrgScopeInput[]
): void {
  if (access.isGlobalAdmin) return;

  if (isGlobalAdmin) {
    throw createHttpError(403, 'Nur Plattform-Admins dürfen globale Adminrechte vergeben.');
  }

  if (tenantScopes.some((scope) => scope.isTenantAdmin)) {
    throw createHttpError(403, 'Nur Plattform-Admins dürfen Tenant-Admins anlegen.');
  }

  const managedTenantIdSet = new Set((access.tenantAdminTenantIds || []).map((entry) => normalizeText(entry)));
  for (const scope of tenantScopes) {
    if (!managedTenantIdSet.has(scope.tenantId)) {
      throw createHttpError(403, `Tenant-Scope außerhalb des eigenen Mandantenbereichs: ${scope.tenantId}`);
    }
  }

  for (const scope of orgScopes) {
    if (!managedTenantIdSet.has(scope.tenantId)) {
      throw createHttpError(403, `Org-Scope außerhalb des eigenen Mandantenbereichs: ${scope.tenantId}`);
    }
  }

  if (role === 'ADMIN' && orgScopes.every((scope) => scope.canWrite !== true)) {
    throw createHttpError(
      400,
      'Tenant-Admins dürfen nur Orga-Admins mit mindestens einem Schreibrecht auf eine Organisationseinheit anlegen.'
    );
  }
}

async function loadScopeMaps(userIds: string[]): Promise<{
  tenantByUser: Map<string, Array<{ tenantId: string; isTenantAdmin: boolean }>>;
  orgByUser: Map<string, Array<{ tenantId: string; orgUnitId: string; canWrite: boolean }>>;
}> {
  const db = getDatabase();
  const cleanedUserIds = Array.from(new Set((userIds || []).map((entry) => normalizeText(entry)).filter(Boolean)));

  const tenantByUser = new Map<string, Array<{ tenantId: string; isTenantAdmin: boolean }>>();
  const orgByUser = new Map<string, Array<{ tenantId: string; orgUnitId: string; canWrite: boolean }>>();

  if (cleanedUserIds.length === 0) {
    return { tenantByUser, orgByUser };
  }

  const placeholders = cleanedUserIds.map(() => '?').join(', ');

  const tenantScopes = await db.all<any>(
    `SELECT admin_user_id, tenant_id, COALESCE(is_tenant_admin, 0) AS is_tenant_admin
     FROM admin_user_tenant_scopes
     WHERE admin_user_id IN (${placeholders})`,
    cleanedUserIds
  );
  for (const row of tenantScopes || []) {
    const userId = normalizeText(row?.admin_user_id);
    if (!userId) continue;
    const bucket = tenantByUser.get(userId) || [];
    bucket.push({
      tenantId: normalizeText(row?.tenant_id),
      isTenantAdmin: Number(row?.is_tenant_admin || 0) === 1,
    });
    tenantByUser.set(userId, bucket);
  }

  const orgScopes = await db.all<any>(
    `SELECT admin_user_id, tenant_id, org_unit_id, COALESCE(can_write, 0) AS can_write
     FROM admin_user_org_scopes
     WHERE admin_user_id IN (${placeholders})`,
    cleanedUserIds
  );
  for (const row of orgScopes || []) {
    const userId = normalizeText(row?.admin_user_id);
    if (!userId) continue;
    const bucket = orgByUser.get(userId) || [];
    bucket.push({
      tenantId: normalizeText(row?.tenant_id),
      orgUnitId: normalizeText(row?.org_unit_id),
      canWrite: Number(row?.can_write || 0) === 1,
    });
    orgByUser.set(userId, bucket);
  }

  return { tenantByUser, orgByUser };
}

async function replaceScopes(
  userId: string,
  tenantScopes: NormalizedTenantScopeInput[] | undefined,
  orgScopes: NormalizedOrgScopeInput[] | undefined
): Promise<void> {
  const db = getDatabase();

  if (!tenantScopes && !orgScopes) return;

  if (tenantScopes) {
    const tenantIds = Array.from(new Set(tenantScopes.map((scope) => scope.tenantId)));
    if (tenantIds.length > 0) {
      const placeholders = tenantIds.map(() => '?').join(', ');
      const known = await db.all<any>(
        `SELECT id
         FROM tenants
         WHERE id IN (${placeholders})`,
        tenantIds
      );
      const knownSet = new Set((known || []).map((row: any) => normalizeText(row?.id)));
      const missing = tenantIds.filter((tenantId) => !knownSet.has(tenantId));
      if (missing.length > 0) {
        throw new Error(`Unbekannte tenantIds: ${missing.join(', ')}`);
      }
    }

    await db.run(`DELETE FROM admin_user_tenant_scopes WHERE admin_user_id = ?`, [userId]);
    for (const scope of tenantScopes) {
      await db.run(
        `INSERT INTO admin_user_tenant_scopes (id, admin_user_id, tenant_id, is_tenant_admin)
         VALUES (?, ?, ?, ?)`,
        [createId('auts'), userId, scope.tenantId, scope.isTenantAdmin ? 1 : 0]
      );
    }
  }

  if (orgScopes) {
    const byOrgId = Array.from(new Set(orgScopes.map((scope) => scope.orgUnitId)));
    if (byOrgId.length > 0) {
      const placeholders = byOrgId.map(() => '?').join(', ');
      const rows = await db.all<any>(
        `SELECT id, tenant_id
         FROM org_units
         WHERE id IN (${placeholders})`,
        byOrgId
      );
      const tenantByOrg = new Map<string, string>();
      for (const row of rows || []) {
        tenantByOrg.set(normalizeText(row?.id), normalizeText(row?.tenant_id));
      }

      const invalid: string[] = [];
      for (const scope of orgScopes) {
        const orgTenant = tenantByOrg.get(scope.orgUnitId);
        if (!orgTenant || orgTenant !== scope.tenantId) {
          invalid.push(scope.orgUnitId);
        }
      }
      if (invalid.length > 0) {
        throw new Error(`Ungültige orgUnitIds oder Tenant-Mismatch: ${Array.from(new Set(invalid)).join(', ')}`);
      }
    }

    await db.run(`DELETE FROM admin_user_org_scopes WHERE admin_user_id = ?`, [userId]);
    for (const scope of orgScopes) {
      await db.run(
        `INSERT INTO admin_user_org_scopes (id, admin_user_id, tenant_id, org_unit_id, can_write)
         VALUES (?, ?, ?, ?, ?)`,
        [createId('auos'), userId, scope.tenantId, scope.orgUnitId, scope.canWrite ? 1 : 0]
      );
    }
  }
}

function enrichUser(
  user: any,
  tenantByUser: Map<string, Array<{ tenantId: string; isTenantAdmin: boolean }>>,
  orgByUser: Map<string, Array<{ tenantId: string; orgUnitId: string; canWrite: boolean }>>
) {
  const userId = normalizeText(user?.id);
  return {
    ...user,
    role: normalizeRole(user?.role) || 'SACHBEARBEITER',
    active: !!user?.active,
    isGlobalAdmin: Number(user?.is_global_admin || user?.isGlobalAdmin || 0) === 1,
    firstName: normalizeText(user?.first_name || user?.firstName) || null,
    lastName: normalizeText(user?.last_name || user?.lastName) || null,
    jobTitle: normalizeText(user?.job_title || user?.jobTitle) || null,
    workPhone: normalizeText(user?.work_phone || user?.workPhone) || null,
    externalPersonId: normalizeText(user?.external_person_id || user?.externalPersonId) || null,
    profileData: parseProfileDataFromDb(user?.profile_data_json),
    assignmentKeywords: parseAssignmentKeywordsFromDb(user?.assignment_keywords_json),
    tenantScopes: tenantByUser.get(userId) || [],
    orgScopes: orgByUser.get(userId) || [],
  };
}

async function loadActiveAdminCounts(): Promise<{ activeAdmins: number; activeGlobalAdmins: number }> {
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT
       SUM(CASE WHEN active = 1 AND UPPER(TRIM(COALESCE(role, ''))) IN ('ADMIN', 'SUPERADMIN') THEN 1 ELSE 0 END) AS active_admins,
       SUM(CASE WHEN active = 1 AND COALESCE(is_global_admin, 0) = 1 THEN 1 ELSE 0 END) AS active_global_admins
     FROM admin_users`
  );
  return {
    activeAdmins: Number(row?.active_admins || 0),
    activeGlobalAdmins: Number(row?.active_global_admins || 0),
  };
}

/**
 * GET /api/admin/users
 * Liste aller Admin-Benutzer
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const access = await loadRequesterAccess(req);
    assertUserManagementAllowed(access);

    const db = getDatabase();

    const users = await db.all(
      `SELECT
        id,
        username,
        email,
        first_name,
        last_name,
        job_title,
        work_phone,
        external_person_id,
        profile_data_json,
        role,
        active,
        assignment_keywords_json,
        COALESCE(is_global_admin, 0) AS is_global_admin,
        created_at,
        updated_at
      FROM admin_users
      ORDER BY created_at DESC`
    );

    const ids = (users || []).map((user: any) => normalizeText(user?.id)).filter(Boolean);
    const { tenantByUser, orgByUser } = await loadScopeMaps(ids);

    const requesterUserId = normalizeText(req.userId);
    const managedTenantIdSet = new Set((access.tenantAdminTenantIds || []).map((entry) => normalizeText(entry)));
    const normalizedUsers = (users || [])
      .map((user: any) => enrichUser(user, tenantByUser, orgByUser))
      .filter((user: any) => {
        if (access.isGlobalAdmin) return true;
        return isUserInManagedTenants(user, managedTenantIdSet, requesterUserId);
      });

    res.json(normalizedUsers);
  } catch (error: any) {
    console.error('Error fetching users:', error);
    res.status(Number(error?.status || 500)).json({ message: error?.message || 'Fehler beim Laden der Benutzer' });
  }
});

/**
 * GET /api/admin/users/:userId
 * Einzelnen Benutzer abrufen
 */
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const access = await loadRequesterAccess(req);
    assertUserManagementAllowed(access);

    const { userId } = req.params;
    const db = getDatabase();

    const user = await db.get(
      `SELECT
        id,
        username,
        email,
        first_name,
        last_name,
        job_title,
        work_phone,
        external_person_id,
        profile_data_json,
        role,
        active,
        assignment_keywords_json,
        COALESCE(is_global_admin, 0) AS is_global_admin,
        created_at,
        updated_at
      FROM admin_users
      WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden' });
    }

    const { tenantByUser, orgByUser } = await loadScopeMaps([normalizeText(userId)]);
    const enriched = enrichUser(user, tenantByUser, orgByUser);
    if (!access.isGlobalAdmin) {
      const managedTenantIdSet = new Set((access.tenantAdminTenantIds || []).map((entry) => normalizeText(entry)));
      const requesterUserId = normalizeText(req.userId);
      if (!isUserInManagedTenants(enriched, managedTenantIdSet, requesterUserId)) {
        return res.status(403).json({ message: 'Kein Zugriff auf diesen Benutzer' });
      }
    }

    res.json(enriched);
  } catch (error: any) {
    console.error('Error fetching user:', error);
    res.status(Number(error?.status || 500)).json({ message: error?.message || 'Fehler beim Laden des Benutzers' });
  }
});

/**
 * POST /api/admin/users
 * Neuen Admin-Benutzer erstellen
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const access = await loadRequesterAccess(req);
    assertUserManagementAllowed(access);

    const {
      username,
      password,
      role = 'SACHBEARBEITER',
      email,
      firstName,
      lastName,
      jobTitle,
      workPhone,
      profileData,
      externalPersonId,
      assignmentKeywords: assignmentKeywordsRaw,
      isGlobalAdmin,
      tenantScopes: tenantScopesRaw,
      orgScopes: orgScopesRaw,
    } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: 'Benutzername und Passwort sind erforderlich',
      });
    }

    const normalizedRole = normalizeRole(role) || 'SACHBEARBEITER';
    if (!['ADMIN', 'SACHBEARBEITER'].includes(normalizedRole)) {
      return res.status(400).json({
        message: 'Ungültige Rolle',
      });
    }

    const normalizedTenantScopes = normalizeTenantScopes(tenantScopesRaw);
    const normalizedOrgScopes = normalizeOrgScopes(orgScopesRaw);
    const nextIsGlobalAdmin = normalizedRole === 'ADMIN' && isGlobalAdmin === true;
    const assignmentKeywordsJson = serializeAssignmentKeywords(
      assignmentKeywordsRaw ?? req.body?.assignment_keywords
    );
    assertAssignableScopes(access, normalizedRole, nextIsGlobalAdmin, normalizedTenantScopes, normalizedOrgScopes);

    const db = getDatabase();

    // Check if username already exists
    const existingUser = await db.get('SELECT id FROM admin_users WHERE username = ?', [username]);

    if (existingUser) {
      return res.status(409).json({
        message: 'Benutzer mit diesem Namen existiert bereits',
      });
    }

    const userId = createId('user');
    const passwordHash = await bcryptjs.hash(password, 10);

    const hasEmail = normalizeText(email).length > 0;
    const active = hasEmail ? 1 : 0;
    await db.run(
      `INSERT INTO admin_users (
         id, username, password_hash, role, active, email, first_name, last_name, job_title, work_phone,
         assignment_keywords_json, is_global_admin, profile_data_json, external_person_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        username,
        passwordHash,
        normalizedRole,
        active,
        hasEmail ? email : null,
        normalizeText(firstName) || null,
        normalizeText(lastName) || null,
        normalizeText(jobTitle) || null,
        normalizeText(workPhone) || null,
        assignmentKeywordsJson,
        nextIsGlobalAdmin ? 1 : 0,
        JSON.stringify(sanitizeProfileData(profileData)),
        normalizeText(externalPersonId) || null,
      ]
    );

    await replaceScopes(userId, normalizedTenantScopes, normalizedOrgScopes);

    const { tenantByUser, orgByUser } = await loadScopeMaps([userId]);
    const createdUser = await db.get(
      `SELECT
        id,
        username,
        email,
        first_name,
        last_name,
        job_title,
        work_phone,
        external_person_id,
        profile_data_json,
        role,
        active,
        assignment_keywords_json,
        COALESCE(is_global_admin, 0) AS is_global_admin,
        created_at,
        updated_at
      FROM admin_users
      WHERE id = ?`,
      [userId]
    );

    res.status(201).json(enrichUser(createdUser, tenantByUser, orgByUser));
  } catch (error: any) {
    console.error('Error creating user:', error);
    res.status(Number(error?.status || 500)).json({ message: error?.message || 'Fehler beim Erstellen des Benutzers' });
  }
});

/**
 * PATCH /api/admin/users/:userId
 * Benutzer aktualisieren (Role, Status)
 */
router.patch('/:userId', async (req: Request, res: Response) => {
  try {
    const access = await loadRequesterAccess(req);
    assertUserManagementAllowed(access);

    const { userId } = req.params;
    const {
      role,
      active,
      email,
      firstName,
      lastName,
      jobTitle,
      workPhone,
      profileData,
      externalPersonId,
      assignmentKeywords: assignmentKeywordsRaw,
      isGlobalAdmin,
      tenantScopes: tenantScopesRaw,
      orgScopes: orgScopesRaw,
    } = req.body;
    const db = getDatabase();

    // Get user first
    const user = await db.get(
      `SELECT id, role, COALESCE(is_global_admin, 0) AS is_global_admin
       FROM admin_users
       WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden' });
    }

    const normalizedUserId = normalizeText(userId);
    const { tenantByUser: currentTenantByUser, orgByUser: currentOrgByUser } = await loadScopeMaps([normalizedUserId]);
    const currentEnriched = enrichUser(user, currentTenantByUser, currentOrgByUser);
    if (!access.isGlobalAdmin) {
      const managedTenantIdSet = new Set((access.tenantAdminTenantIds || []).map((entry) => normalizeText(entry)));
      const requesterUserId = normalizeText(req.userId);
      if (!isUserInManagedTenants(currentEnriched, managedTenantIdSet, requesterUserId)) {
        return res.status(403).json({ message: 'Kein Zugriff auf diesen Benutzer' });
      }
      if ((currentEnriched.tenantScopes || []).some((scope: any) => scope?.isTenantAdmin === true)) {
        return res.status(403).json({ message: 'Tenant-Admin-Konten dürfen nur von Plattform-Admins geändert werden.' });
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const params: any[] = [];

    let nextRole = normalizeRole(user.role) || 'SACHBEARBEITER';
    if (role !== undefined) {
      const normalizedRole = normalizeRole(role);
      if (!normalizedRole || !['ADMIN', 'SACHBEARBEITER'].includes(normalizedRole)) {
        return res.status(400).json({ message: 'Ungültige Rolle' });
      }
      nextRole = normalizedRole;
      updates.push('role = ?');
      params.push(normalizedRole);
    }

    const hasTenantScopes = Object.prototype.hasOwnProperty.call(req.body || {}, 'tenantScopes');
    const hasOrgScopes = Object.prototype.hasOwnProperty.call(req.body || {}, 'orgScopes');
    const nextTenantScopes = hasTenantScopes
      ? normalizeTenantScopes(tenantScopesRaw)
      : (currentTenantByUser.get(normalizedUserId) || []);
    const nextOrgScopes = hasOrgScopes
      ? normalizeOrgScopes(orgScopesRaw)
      : (currentOrgByUser.get(normalizedUserId) || []);
    const nextIsGlobalAdmin =
      isGlobalAdmin !== undefined ? nextRole === 'ADMIN' && isGlobalAdmin === true : Number(user?.is_global_admin || 0) === 1;

    assertAssignableScopes(access, nextRole, nextIsGlobalAdmin, nextTenantScopes, nextOrgScopes);

    if (active !== undefined) {
      updates.push('active = ?');
      params.push(active ? 1 : 0);
    }

    if (email !== undefined) {
      updates.push('email = ?');
      const normalizedEmail = normalizeText(email);
      params.push(normalizedEmail || null);
      updates.push('active = ?');
      params.push(normalizedEmail ? 1 : 0);
    }

    if (firstName !== undefined) {
      updates.push('first_name = ?');
      params.push(normalizeText(firstName) || null);
    }

    if (lastName !== undefined) {
      updates.push('last_name = ?');
      params.push(normalizeText(lastName) || null);
    }

    if (jobTitle !== undefined) {
      updates.push('job_title = ?');
      params.push(normalizeText(jobTitle) || null);
    }

    if (workPhone !== undefined) {
      updates.push('work_phone = ?');
      params.push(normalizeText(workPhone) || null);
    }

    if (externalPersonId !== undefined) {
      updates.push('external_person_id = ?');
      params.push(normalizeText(externalPersonId) || null);
    }

    if (profileData !== undefined) {
      updates.push('profile_data_json = ?');
      params.push(JSON.stringify(sanitizeProfileData(profileData)));
    }

    const hasAssignmentKeywords =
      Object.prototype.hasOwnProperty.call(req.body || {}, 'assignmentKeywords') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'assignment_keywords');
    if (hasAssignmentKeywords) {
      updates.push('assignment_keywords_json = ?');
      params.push(serializeAssignmentKeywords(assignmentKeywordsRaw ?? req.body?.assignment_keywords));
    }

    if (isGlobalAdmin !== undefined) {
      updates.push('is_global_admin = ?');
      params.push(nextIsGlobalAdmin ? 1 : 0);
    }

    const nextActive = active !== undefined ? !!active : !!currentEnriched.active;
    const currentIsAdminRole = ['ADMIN', 'SUPERADMIN'].includes(String(currentEnriched.role || '').toUpperCase());
    const nextIsAdminRole = nextRole === 'ADMIN';
    const currentIsGlobalAdmin = !!currentEnriched.isGlobalAdmin;
    const nextIsGlobalAdminFlag = nextIsGlobalAdmin === true;
    if (
      currentIsAdminRole &&
      (!nextIsAdminRole || !nextActive) ||
      currentIsGlobalAdmin &&
      (!nextIsGlobalAdminFlag || !nextActive)
    ) {
      const counts = await loadActiveAdminCounts();
      if (currentIsAdminRole && counts.activeAdmins <= 1 && (!nextIsAdminRole || !nextActive)) {
        return res.status(409).json({
          message: 'Der letzte aktive Admin darf nicht deaktiviert oder herabgestuft werden.',
        });
      }
      if (currentIsGlobalAdmin && counts.activeGlobalAdmins <= 1 && (!nextIsGlobalAdminFlag || !nextActive)) {
        return res.status(409).json({
          message: 'Der letzte aktive Plattform-Admin darf nicht deaktiviert oder entzogen werden.',
        });
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(userId);

      await db.run(
        `UPDATE admin_users
         SET ${updates.join(', ')}
         WHERE id = ?`,
        params
      );
    }

    if (hasTenantScopes || hasOrgScopes) {
      await replaceScopes(
        userId,
        hasTenantScopes ? nextTenantScopes : undefined,
        hasOrgScopes ? nextOrgScopes : undefined
      );
    }

    // Fetch updated user
    const updatedUser = await db.get(
      `SELECT
        id,
        username,
        email,
        first_name,
        last_name,
        job_title,
        work_phone,
        external_person_id,
        profile_data_json,
        role,
        active,
        assignment_keywords_json,
        COALESCE(is_global_admin, 0) AS is_global_admin,
        created_at,
        updated_at
      FROM admin_users
      WHERE id = ?`,
      [userId]
    );

    const { tenantByUser, orgByUser } = await loadScopeMaps([normalizeText(userId)]);
    res.json(enrichUser(updatedUser, tenantByUser, orgByUser));
  } catch (error: any) {
    console.error('Error updating user:', error);
    res.status(Number(error?.status || 500)).json({ message: error?.message || 'Fehler beim Aktualisieren des Benutzers' });
  }
});

/**
 * DELETE /api/admin/users/:userId
 * Benutzer löschen
 */
router.delete('/:userId', async (req: Request, res: Response) => {
  try {
    const access = await loadRequesterAccess(req);
    assertUserManagementAllowed(access);

    const { userId } = req.params;
    const db = getDatabase();

    const userToDelete = await db.get(
      `SELECT id, role, COALESCE(is_global_admin, 0) AS is_global_admin
       FROM admin_users
       WHERE id = ?`,
      [userId]
    );
    if (!userToDelete?.id) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden' });
    }

    if (!access.isGlobalAdmin) {
      const normalizedUserId = normalizeText(userId);
      const { tenantByUser, orgByUser } = await loadScopeMaps([normalizedUserId]);
      const enriched = enrichUser(userToDelete, tenantByUser, orgByUser);
      const managedTenantIdSet = new Set((access.tenantAdminTenantIds || []).map((entry) => normalizeText(entry)));
      const requesterUserId = normalizeText(req.userId);
      if (!isUserInManagedTenants(enriched, managedTenantIdSet, requesterUserId)) {
        return res.status(403).json({ message: 'Kein Zugriff auf diesen Benutzer' });
      }
      if ((enriched.tenantScopes || []).some((scope: any) => scope?.isTenantAdmin === true)) {
        return res.status(403).json({ message: 'Tenant-Admin-Konten dürfen nur von Plattform-Admins gelöscht werden.' });
      }
    }

    const counts = await loadActiveAdminCounts();
    if (['ADMIN', 'SUPERADMIN'].includes(String(userToDelete?.role || '').toUpperCase()) && counts.activeAdmins <= 1) {
      return res.status(403).json({
        message: 'Sie können den letzten Admin nicht löschen',
      });
    }
    if (Number(userToDelete?.is_global_admin || 0) === 1 && counts.activeGlobalAdmins <= 1) {
      return res.status(403).json({
        message: 'Sie können den letzten Plattform-Admin nicht löschen',
      });
    }

    await db.run('DELETE FROM admin_user_org_scopes WHERE admin_user_id = ?', [userId]);
    await db.run('DELETE FROM admin_user_tenant_scopes WHERE admin_user_id = ?', [userId]);
    await db.run('DELETE FROM admin_users WHERE id = ?', [userId]);

    res.json({ message: 'Benutzer gelöscht' });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    res.status(Number(error?.status || 500)).json({ message: error?.message || 'Fehler beim Löschen des Benutzers' });
  }
});

/**
 * PATCH /api/admin/users/:userId/password
 * Passwort eines Benutzers ändern (nur als Admin)
 */
router.patch('/:userId/password', async (req: Request, res: Response) => {
  try {
    const access = await loadRequesterAccess(req);
    assertUserManagementAllowed(access);

    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        message: 'Passwort muss mindestens 8 Zeichen lang sein',
      });
    }

    const db = getDatabase();

    const user = await db.get(
      `SELECT id, COALESCE(is_global_admin, 0) AS is_global_admin
       FROM admin_users
       WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden' });
    }

    if (!access.isGlobalAdmin) {
      const normalizedUserId = normalizeText(userId);
      const { tenantByUser, orgByUser } = await loadScopeMaps([normalizedUserId]);
      const enriched = enrichUser(user, tenantByUser, orgByUser);
      const managedTenantIdSet = new Set((access.tenantAdminTenantIds || []).map((entry) => normalizeText(entry)));
      const requesterUserId = normalizeText(req.userId);
      if (!isUserInManagedTenants(enriched, managedTenantIdSet, requesterUserId)) {
        return res.status(403).json({ message: 'Kein Zugriff auf diesen Benutzer' });
      }
      if ((enriched.tenantScopes || []).some((scope: any) => scope?.isTenantAdmin === true)) {
        return res.status(403).json({ message: 'Tenant-Admin-Passwörter dürfen nur von Plattform-Admins geändert werden.' });
      }
    }

    const passwordHash = await bcryptjs.hash(newPassword, 10);

    await db.run(
      `UPDATE admin_users
       SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [passwordHash, userId]
    );

    res.json({ message: 'Passwort aktualisiert' });
  } catch (error: any) {
    console.error('Error changing password:', error);
    res.status(Number(error?.status || 500)).json({ message: error?.message || 'Fehler beim Aktualisieren des Passworts' });
  }
});

/**
 * POST /api/admin/users/:userId/invite
 * Erstellt Einladungslink + optional Mailversand zum Passwort-Setzen
 */
router.post('/:userId/invite', async (req: Request, res: Response) => {
  try {
    const access = await loadRequesterAccess(req);
    assertUserManagementAllowed(access);
    const userId = normalizeText(req.params.userId);
    if (!userId) {
      return res.status(400).json({ message: 'userId fehlt' });
    }
    const db = getDatabase();
    const user = await db.get<any>(
      `SELECT id, COALESCE(is_global_admin, 0) AS is_global_admin
       FROM admin_users
       WHERE id = ?`,
      [userId]
    );
    if (!user?.id) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden' });
    }

    if (!access.isGlobalAdmin) {
      const { tenantByUser, orgByUser } = await loadScopeMaps([userId]);
      const enriched = enrichUser(user, tenantByUser, orgByUser);
      const managedTenantIdSet = new Set((access.tenantAdminTenantIds || []).map((entry) => normalizeText(entry)));
      const requesterUserId = normalizeText(req.userId);
      if (!isUserInManagedTenants(enriched, managedTenantIdSet, requesterUserId)) {
        return res.status(403).json({ message: 'Kein Zugriff auf diesen Benutzer' });
      }
    }

    const sendEmailNow = req.body?.sendEmail !== false;
    const invite = await issueUserInvite({
      adminUserId: userId,
      sentByAdminId: normalizeText(req.userId) || null,
      metadata: {
        source: 'users.invite.single',
      },
      sendEmailNow,
    });
    return res.json({
      message: sendEmailNow ? 'Einladung wurde versendet.' : 'Einladungslink erstellt.',
      invite,
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: error?.message || 'Einladung fehlgeschlagen.' });
  }
});

/**
 * POST /api/admin/users/invite/batch
 * Batch-Einladungen per User-ID-Liste
 */
router.post('/invite/batch', async (req: Request, res: Response) => {
  try {
    const access = await loadRequesterAccess(req);
    assertUserManagementAllowed(access);
    const userIds = Array.isArray(req.body?.userIds)
      ? req.body.userIds.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [];
    if (userIds.length === 0) {
      return res.status(400).json({ message: 'userIds fehlt oder leer.' });
    }
    const sendEmailNow = req.body?.sendEmail !== false;
    const managedTenantIdSet = new Set((access.tenantAdminTenantIds || []).map((entry) => normalizeText(entry)));
    const requesterUserId = normalizeText(req.userId);
    const results: Array<{ userId: string; ok: boolean; message: string; invite?: any }> = [];

    for (const userId of userIds.slice(0, 300)) {
      try {
        if (!access.isGlobalAdmin) {
          const db = getDatabase();
          const row = await db.get<any>(
            `SELECT id, COALESCE(is_global_admin, 0) AS is_global_admin
             FROM admin_users
             WHERE id = ?`,
            [userId]
          );
          if (!row?.id) {
            results.push({ userId, ok: false, message: 'Benutzer nicht gefunden' });
            continue;
          }
          const { tenantByUser, orgByUser } = await loadScopeMaps([userId]);
          const enriched = enrichUser(row, tenantByUser, orgByUser);
          if (!isUserInManagedTenants(enriched, managedTenantIdSet, requesterUserId)) {
            results.push({ userId, ok: false, message: 'Kein Zugriff auf Benutzer' });
            continue;
          }
        }

        const invite = await issueUserInvite({
          adminUserId: userId,
          sentByAdminId: normalizeText(req.userId) || null,
          metadata: { source: 'users.invite.batch' },
          sendEmailNow,
        });
        results.push({ userId, ok: true, message: 'OK', invite });
      } catch (error: any) {
        results.push({ userId, ok: false, message: error?.message || 'Einladung fehlgeschlagen' });
      }
    }

    const successCount = results.filter((entry) => entry.ok).length;
    return res.json({
      message: `${successCount}/${results.length} Einladungen erfolgreich.`,
      successCount,
      total: results.length,
      results,
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({ message: error?.message || 'Batch-Einladung fehlgeschlagen.' });
  }
});

/**
 * POST /api/admin/users/:userId/security/tfa/disable
 * Deaktiviert TOTP und widerruft alle Passkeys eines Benutzers
 */
router.post('/:userId/security/tfa/disable', async (req: Request, res: Response) => {
  try {
    const access = await loadRequesterAccess(req);
    assertUserManagementAllowed(access);

    const { userId } = req.params;
    const targetUserId = normalizeText(userId);
    if (!targetUserId) {
      return res.status(400).json({ message: 'Benutzer-ID fehlt' });
    }

    const db = getDatabase();
    const user = await db.get(
      `SELECT id, COALESCE(is_global_admin, 0) AS is_global_admin
       FROM admin_users
       WHERE id = ?`,
      [targetUserId]
    );
    if (!user?.id) {
      return res.status(404).json({ message: 'Benutzer nicht gefunden' });
    }

    if (!access.isGlobalAdmin) {
      const { tenantByUser, orgByUser } = await loadScopeMaps([targetUserId]);
      const enriched = enrichUser(user, tenantByUser, orgByUser);
      const managedTenantIdSet = new Set((access.tenantAdminTenantIds || []).map((entry) => normalizeText(entry)));
      const requesterUserId = normalizeText(req.userId);
      if (!isUserInManagedTenants(enriched, managedTenantIdSet, requesterUserId)) {
        return res.status(403).json({ message: 'Kein Zugriff auf diesen Benutzer' });
      }
      if ((enriched.tenantScopes || []).some((scope: any) => scope?.isTenantAdmin === true)) {
        return res
          .status(403)
          .json({ message: 'TFA von Tenant-Admin-Konten darf nur von Plattform-Admins deaktiviert werden.' });
      }
    }

    const [totpDisabled, passkeyResult] = await Promise.all([
      disableAdminTotpFactor(db, {
        adminUserId: targetUserId,
        updatedByAdminId: normalizeText(req.userId) || null,
      }),
      db.run(
        `UPDATE admin_passkeys
         SET revoked_at = CURRENT_TIMESTAMP,
             revoked_by_admin_id = ?
         WHERE admin_user_id = ?
           AND revoked_at IS NULL`,
        [normalizeText(req.userId) || null, targetUserId]
      ),
    ]);

    // Offene Login-Challenges unmittelbar ungültig machen.
    await db.run(
      `DELETE FROM admin_auth_challenges
       WHERE admin_user_id = ?
         AND purpose IN ('totp_login', 'totp_setup', 'passkey_authentication', 'passkey_registration')`,
      [targetUserId]
    );

    const revokedPasskeys = Number((passkeyResult as any)?.changes || 0);
    return res.json({
      message: 'TFA wurde für den Benutzer deaktiviert',
      totpDisabled,
      revokedPasskeys,
    });
  } catch (error: any) {
    console.error('Error disabling user TFA:', error);
    return res
      .status(Number(error?.status || 500))
      .json({ message: error?.message || 'TFA konnte nicht deaktiviert werden' });
  }
});

export default router;
