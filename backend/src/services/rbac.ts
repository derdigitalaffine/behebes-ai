import { getDatabase } from '../database.js';
import { isAdminRole } from '../utils/roles.js';

export interface AdminOrgScope {
  tenantId: string;
  orgUnitId: string;
  canWrite: boolean;
}

export interface AdminAccessContext {
  userId: string;
  role: string;
  isGlobalAdmin: boolean;
  tenantAdminTenantIds: string[];
  tenantIds: string[];
  orgScopes: AdminOrgScope[];
  readableOrgUnitIds: string[];
  writableOrgUnitIds: string[];
}

export type AdminEffectiveRole = 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'ORG_ADMIN' | 'SACHBEARBEITER';

const BASE_STAFF_CAPABILITIES = [
  'dashboard.read',
  'analytics.read',
  'tickets.read',
  'tickets.write',
  'map.read',
  'workflows.read',
  'workflows.write',
  'internal_tasks.read',
  'internal_tasks.write',
  'mail_queue.read',
  'mail_queue.write',
  'mailbox.read',
  'mailbox.write',
  'ai_queue.read',
  'ai_queue.write',
  'notifications.read',
  'profile.manage',
  'logs.read',
] as const;

const ORG_ADMIN_CAPABILITIES = [
  'settings.categories.manage',
  'settings.templates.manage',
  'settings.workflows.manage',
  'settings.ai_situation.read',
] as const;

const TENANT_ADMIN_CAPABILITIES = [
  'settings.organization.tenant.manage',
  'settings.email.tenant.manage',
  'settings.ai_situation.manage',
  'users.manage',
  'api_tokens.manage',
  'journal.read',
] as const;

const PLATFORM_ADMIN_CAPABILITIES = [
  'settings.global.manage',
  'settings.system.manage',
  'settings.weather.manage',
  'settings.redmine.manage',
  'settings.organization.global.manage',
  'settings.email.global.manage',
  'settings.ai.global.manage',
  'settings.ai_pseudonyms.manage',
  'settings.platform_blog.manage',
  'users.manage',
  'registrations.manage',
  'sessions.manage',
  'logs.admin',
  'maintenance.manage',
  'context.global.switch',
  'context.tenant.switch',
] as const;

interface TicketVisibilityOptions {
  tableAlias?: string;
  requireWrite?: boolean;
}

interface SqlClause {
  sql: string;
  params: any[];
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inClause(values: string[]): SqlClause {
  if (!Array.isArray(values) || values.length === 0) {
    return { sql: '(NULL)', params: [] };
  }
  return {
    sql: `(${values.map(() => '?').join(', ')})`,
    params: values,
  };
}

async function loadDescendantOrgUnitIds(tenantId: string, ancestorIds: string[]): Promise<string[]> {
  const normalizedTenantId = normalizeText(tenantId);
  const normalizedAncestors = unique((ancestorIds || []).map((entry) => normalizeText(entry)));
  if (!normalizedTenantId || normalizedAncestors.length === 0) return [];

  const db = getDatabase();
  const clause = inClause(normalizedAncestors);
  const rows = await db.all<any>(
    `SELECT DISTINCT descendant_id
     FROM org_unit_closure
     WHERE tenant_id = ?
       AND ancestor_id IN ${clause.sql}`,
    [normalizedTenantId, ...clause.params]
  );
  return unique((rows || []).map((row: any) => normalizeText(row?.descendant_id)));
}

export async function rebuildOrgUnitClosure(tenantId: string): Promise<void> {
  const normalizedTenantId = normalizeText(tenantId);
  if (!normalizedTenantId) return;
  const db = getDatabase();

  const units = await db.all<any>(
    `SELECT id, parent_id
     FROM org_units
     WHERE tenant_id = ?`,
    [normalizedTenantId]
  );

  const parentById = new Map<string, string | null>();
  for (const row of units || []) {
    const id = normalizeText(row?.id);
    if (!id) continue;
    const parentId = normalizeText(row?.parent_id) || null;
    parentById.set(id, parentId);
  }

  await db.run(`DELETE FROM org_unit_closure WHERE tenant_id = ?`, [normalizedTenantId]);

  for (const nodeId of parentById.keys()) {
    const seen = new Set<string>();
    let depth = 0;
    let current: string | null = nodeId;
    while (current) {
      if (seen.has(current)) break;
      seen.add(current);
      await db.run(
        `INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tenant_id, ancestor_id, descendant_id)
         DO UPDATE SET depth = excluded.depth`,
        [normalizedTenantId, current, nodeId, depth]
      );
      const parent = parentById.get(current) || null;
      current = parent;
      depth += 1;
      if (depth > 100) break;
    }
  }
}

export async function loadAdminAccessContext(userId: string, role: string): Promise<AdminAccessContext> {
  const normalizedUserId = normalizeText(userId);
  const normalizedRole = normalizeText(role) || 'SACHBEARBEITER';

  const empty: AdminAccessContext = {
    userId: normalizedUserId,
    role: normalizedRole,
    isGlobalAdmin: false,
    tenantAdminTenantIds: [],
    tenantIds: [],
    orgScopes: [],
    readableOrgUnitIds: [],
    writableOrgUnitIds: [],
  };

  if (!normalizedUserId) return empty;

  const db = getDatabase();
  const userRow = await db.get<any>(
    `SELECT id, role, COALESCE(is_global_admin, 0) AS is_global_admin
     FROM admin_users
     WHERE id = ?`,
    [normalizedUserId]
  );

  if (!userRow?.id) return empty;

  const isGlobalAdmin = Number(userRow?.is_global_admin || 0) === 1;
  const tenantScopes = await db.all<any>(
    `SELECT tenant_id, COALESCE(is_tenant_admin, 0) AS is_tenant_admin
     FROM admin_user_tenant_scopes
     WHERE admin_user_id = ?`,
    [normalizedUserId]
  );
  const orgScopesRaw = await db.all<any>(
    `SELECT tenant_id, org_unit_id, COALESCE(can_write, 0) AS can_write
     FROM admin_user_org_scopes
     WHERE admin_user_id = ?`,
    [normalizedUserId]
  );

  const tenantAdminTenantIds = unique(
    (tenantScopes || [])
      .filter((row: any) => Number(row?.is_tenant_admin || 0) === 1)
      .map((row: any) => normalizeText(row?.tenant_id))
  );

  const orgScopes: AdminOrgScope[] = (orgScopesRaw || [])
    .map((row: any) => ({
      tenantId: normalizeText(row?.tenant_id),
      orgUnitId: normalizeText(row?.org_unit_id),
      canWrite: Number(row?.can_write || 0) === 1,
    }))
    .filter((scope) => !!scope.tenantId && !!scope.orgUnitId);

  const tenantIds = unique([
    ...tenantAdminTenantIds,
    ...(tenantScopes || []).map((row: any) => normalizeText(row?.tenant_id)),
    ...orgScopes.map((scope) => scope.tenantId),
  ]);

  let readOrgUnitIds: string[] = [];
  let writeOrgUnitIds: string[] = [];

  const orgScopesByTenant = new Map<string, { read: string[]; write: string[] }>();
  for (const scope of orgScopes) {
    const bucket = orgScopesByTenant.get(scope.tenantId) || { read: [], write: [] };
    bucket.read.push(scope.orgUnitId);
    if (scope.canWrite) {
      bucket.write.push(scope.orgUnitId);
    }
    orgScopesByTenant.set(scope.tenantId, bucket);
  }

  for (const [tenantId, bucket] of orgScopesByTenant.entries()) {
    const tenantRead = await loadDescendantOrgUnitIds(tenantId, bucket.read);
    readOrgUnitIds.push(...tenantRead);
    const tenantWrite = await loadDescendantOrgUnitIds(tenantId, bucket.write);
    writeOrgUnitIds.push(...tenantWrite);
  }

  readOrgUnitIds = unique(readOrgUnitIds);
  writeOrgUnitIds = unique(writeOrgUnitIds);

  // Backward-safe fallback: if ADMIN has no explicit scopes, grant tenant-wide access to all tenants.
  if (isAdminRole(normalizedRole) && !isGlobalAdmin && tenantIds.length === 0) {
    const allTenants = await db.all<any>(`SELECT id FROM tenants WHERE active = 1 OR active IS NULL`);
    const allTenantIds = unique((allTenants || []).map((row: any) => normalizeText(row?.id)));
    return {
      userId: normalizedUserId,
      role: normalizedRole,
      isGlobalAdmin,
      tenantAdminTenantIds: allTenantIds,
      tenantIds: allTenantIds,
      orgScopes,
      readableOrgUnitIds: readOrgUnitIds,
      writableOrgUnitIds: writeOrgUnitIds,
    };
  }

  return {
    userId: normalizedUserId,
    role: normalizedRole,
    isGlobalAdmin,
    tenantAdminTenantIds,
    tenantIds,
    orgScopes,
    readableOrgUnitIds: readOrgUnitIds,
    writableOrgUnitIds: writeOrgUnitIds,
  };
}

export function resolveAdminEffectiveRole(access: AdminAccessContext): AdminEffectiveRole {
  if (access.isGlobalAdmin) return 'PLATFORM_ADMIN';
  if (Array.isArray(access.tenantAdminTenantIds) && access.tenantAdminTenantIds.length > 0) {
    return 'TENANT_ADMIN';
  }
  if (Array.isArray(access.orgScopes) && access.orgScopes.some((scope) => scope.canWrite)) {
    return 'ORG_ADMIN';
  }
  return 'SACHBEARBEITER';
}

export function buildAdminCapabilities(access: AdminAccessContext): string[] {
  const effectiveRole = resolveAdminEffectiveRole(access);
  const capabilities = new Set<string>(BASE_STAFF_CAPABILITIES);

  if (access.isGlobalAdmin) {
    capabilities.add('scope.platform');
    capabilities.add('scope.tenant');
  } else if (Array.isArray(access.tenantIds) && access.tenantIds.length > 0) {
    capabilities.add('scope.tenant');
  }

  if (effectiveRole === 'ORG_ADMIN' || effectiveRole === 'TENANT_ADMIN' || effectiveRole === 'PLATFORM_ADMIN') {
    for (const capability of ORG_ADMIN_CAPABILITIES) {
      capabilities.add(capability);
    }
  }

  if (effectiveRole === 'TENANT_ADMIN' || effectiveRole === 'PLATFORM_ADMIN') {
    for (const capability of TENANT_ADMIN_CAPABILITIES) {
      capabilities.add(capability);
    }
  }

  if (effectiveRole === 'PLATFORM_ADMIN') {
    for (const capability of PLATFORM_ADMIN_CAPABILITIES) {
      capabilities.add(capability);
    }
  }

  return Array.from(capabilities.values()).sort();
}

export function buildTicketVisibilitySql(
  access: AdminAccessContext,
  options: TicketVisibilityOptions = {}
): SqlClause {
  const alias = normalizeText(options.tableAlias) || 't';
  const requireWrite = options.requireWrite === true;

  if (access.isGlobalAdmin) {
    return { sql: '1=1', params: [] };
  }

  const tenantClause = inClause(access.tenantIds);
  if (tenantClause.params.length === 0) {
    return { sql: '1=0', params: [] };
  }

  const params: any[] = [];
  const clauses: string[] = [];

  const tenantAdminClause = inClause(access.tenantAdminTenantIds);
  if (tenantAdminClause.params.length > 0) {
    clauses.push(`${alias}.tenant_id IN ${tenantAdminClause.sql}`);
    params.push(...tenantAdminClause.params);
  }

  const userScopedClauses: string[] = [];
  userScopedClauses.push(`${alias}.primary_assignee_user_id = ?`);
  params.push(access.userId);

  userScopedClauses.push(
    `${alias}.id IN (
      SELECT tc.ticket_id
      FROM ticket_collaborators tc
      WHERE tc.user_id = ?
    )`
  );
  params.push(access.userId);

  const orgIds = requireWrite ? access.writableOrgUnitIds : access.readableOrgUnitIds;
  if (orgIds.length > 0) {
    const orgClause = inClause(orgIds);
    userScopedClauses.push(`${alias}.owning_org_unit_id IN ${orgClause.sql}`);
    params.push(...orgClause.params);

    const assigneeOrgClause = inClause(orgIds);
    userScopedClauses.push(`${alias}.primary_assignee_org_unit_id IN ${assigneeOrgClause.sql}`);
    params.push(...assigneeOrgClause.params);

    const collabOrgClause = inClause(orgIds);
    userScopedClauses.push(
      `${alias}.id IN (
        SELECT tc.ticket_id
        FROM ticket_collaborators tc
        WHERE tc.org_unit_id IN ${collabOrgClause.sql}
      )`
    );
    params.push(...collabOrgClause.params);
  }

  if (userScopedClauses.length > 0) {
    clauses.push(`(${userScopedClauses.join(' OR ')})`);
  }

  const finalParams = [...tenantClause.params, ...params];
  return {
    sql: `${alias}.tenant_id IN ${tenantClause.sql} AND (${clauses.join(' OR ') || '1=0'})`,
    params: finalParams,
  };
}

export async function canAccessTicket(
  access: AdminAccessContext,
  ticketId: string,
  requireWrite = false
): Promise<boolean> {
  const normalizedTicketId = normalizeText(ticketId);
  if (!normalizedTicketId) return false;
  const db = getDatabase();
  const visibility = buildTicketVisibilitySql(access, { tableAlias: 't', requireWrite });
  const row = await db.get<any>(
    `SELECT t.id
     FROM tickets t
     WHERE t.id = ?
       AND (${visibility.sql})
     LIMIT 1`,
    [normalizedTicketId, ...visibility.params]
  );
  return !!row?.id;
}

export async function requireTicketAccess(
  userId: string,
  role: string,
  ticketId: string,
  requireWrite = false
): Promise<{ allowed: boolean; access: AdminAccessContext }> {
  const access = await loadAdminAccessContext(userId, role);
  const allowed = await canAccessTicket(access, ticketId, requireWrite);
  return { allowed, access };
}
