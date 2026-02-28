import axios from 'axios';

export interface AssignmentTenantOption {
  id: string;
  name: string;
  active: boolean;
}

export interface AssignmentOrgUnitOption {
  id: string;
  tenantId: string;
  parentId?: string | null;
  name: string;
  label: string;
  contactEmail?: string | null;
  active: boolean;
}

export interface AssignmentUserTenantScope {
  tenantId: string;
  isTenantAdmin: boolean;
}

export interface AssignmentUserOrgScope {
  tenantId: string;
  orgUnitId: string;
  canWrite: boolean;
}

export interface AssignmentAdminUserOption {
  id: string;
  username: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  active: boolean;
  isGlobalAdmin: boolean;
  tenantScopes: AssignmentUserTenantScope[];
  orgScopes: AssignmentUserOrgScope[];
}

export interface AssignmentDirectoryData {
  tenants: AssignmentTenantOption[];
  orgUnits: AssignmentOrgUnitOption[];
  users: AssignmentAdminUserOption[];
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : fallback;
  const raw = normalizeText(value).toLowerCase();
  if (['1', 'true', 'yes', 'ja', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'nein', 'off'].includes(raw)) return false;
  return fallback;
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  rows.forEach((entry) => {
    const id = normalizeText(entry.id);
    if (!id) return;
    map.set(id, { ...entry, id });
  });
  return Array.from(map.values());
}

function normalizeTenantScopes(raw: unknown): AssignmentUserTenantScope[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const scopes: AssignmentUserTenantScope[] = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const source = entry as Record<string, unknown>;
    const tenantId = normalizeText(source.tenantId || source.tenant_id || source.id);
    if (!tenantId) return;
    const isTenantAdmin = normalizeBool(
      source.isTenantAdmin ?? source.is_tenant_admin ?? source.tenantAdmin,
      false
    );
    const key = `${tenantId}::${isTenantAdmin ? '1' : '0'}`;
    if (seen.has(key)) return;
    seen.add(key);
    scopes.push({ tenantId, isTenantAdmin });
  });
  return scopes;
}

function normalizeOrgScopes(raw: unknown): AssignmentUserOrgScope[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const scopes: AssignmentUserOrgScope[] = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const source = entry as Record<string, unknown>;
    const tenantId = normalizeText(source.tenantId || source.tenant_id);
    const orgUnitId = normalizeText(source.orgUnitId || source.org_unit_id || source.id);
    if (!tenantId || !orgUnitId) return;
    const canWrite = normalizeBool(source.canWrite ?? source.can_write ?? source.write, false);
    const key = `${tenantId}::${orgUnitId}::${canWrite ? '1' : '0'}`;
    if (seen.has(key)) return;
    seen.add(key);
    scopes.push({ tenantId, orgUnitId, canWrite });
  });
  return scopes;
}

export function buildOrgUnitPathMap(rows: Array<Record<string, unknown>>): Record<string, string> {
  const byId = new Map<string, Record<string, unknown>>();
  rows.forEach((row) => {
    const id = normalizeText(row?.id);
    if (!id) return;
    byId.set(id, row);
  });

  const cache = new Map<string, string>();
  const resolveLabel = (id: string): string => {
    if (!id) return '';
    const cached = cache.get(id);
    if (cached) return cached;

    const row = byId.get(id);
    if (!row) {
      cache.set(id, id);
      return id;
    }

    const ownName = normalizeText(row.name) || id;
    const parentId = normalizeText(row.parentId || row.parent_id);
    if (!parentId || !byId.has(parentId)) {
      cache.set(id, ownName);
      return ownName;
    }

    const chainGuard = new Set<string>([id]);
    const segments = [ownName];
    let currentParent = parentId;
    while (currentParent && byId.has(currentParent) && !chainGuard.has(currentParent)) {
      chainGuard.add(currentParent);
      const parentRow = byId.get(currentParent) as Record<string, unknown>;
      const parentName = normalizeText(parentRow?.name) || currentParent;
      segments.unshift(parentName);
      currentParent = normalizeText(parentRow?.parentId || parentRow?.parent_id);
    }

    const path = segments.join(' / ');
    cache.set(id, path);
    return path;
  };

  const out: Record<string, string> = {};
  byId.forEach((_row, id) => {
    out[id] = resolveLabel(id);
  });
  return out;
}

export function buildAssignmentUserLabel(user: AssignmentAdminUserOption): string {
  const firstName = normalizeText(user.firstName);
  const lastName = normalizeText(user.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (fullName) {
    return user.username ? `${fullName} (@${user.username})` : fullName;
  }
  return normalizeText(user.username) || normalizeText(user.id);
}

export function userCanBeAssignedToTenant(
  user: AssignmentAdminUserOption,
  tenantId: string | null | undefined
): boolean {
  const normalizedTenantId = normalizeText(tenantId);
  if (!normalizedTenantId) return true;
  if (user.isGlobalAdmin) return true;
  if (user.tenantScopes.some((scope) => scope.tenantId === normalizedTenantId)) return true;
  if (user.orgScopes.some((scope) => scope.tenantId === normalizedTenantId)) return true;
  return false;
}

export async function loadAssignmentDirectory(
  headers: Record<string, string>,
  options?: { includeInactiveOrgUnits?: boolean }
): Promise<AssignmentDirectoryData> {
  const includeInactiveOrgUnits = options?.includeInactiveOrgUnits !== false;
  const [tenantsRes, usersRes] = await Promise.all([
    axios.get('/api/admin/tenants', { headers }),
    axios.get('/api/admin/users', { headers }),
  ]);

  const tenants = dedupeById(
    (Array.isArray(tenantsRes.data) ? tenantsRes.data : [])
      .map((entry: unknown) => {
        const source = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
        if (!source) return null;
        const id = normalizeText(source.id);
        if (!id) return null;
        return {
          id,
          name: normalizeText(source.name) || id,
          active: normalizeBool(source.active, true),
        } satisfies AssignmentTenantOption;
      })
      .filter((entry): entry is AssignmentTenantOption => entry !== null)
  ).sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));

  const users = dedupeById(
    (Array.isArray(usersRes.data) ? usersRes.data : [])
      .map((entry: unknown) => {
        const source = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
        if (!source) return null;
        const id = normalizeText(source.id);
        if (!id) return null;
        return {
          id,
          username: normalizeText(source.username),
          email: normalizeText(source.email) || null,
          firstName: normalizeText(source.firstName || source.first_name) || null,
          lastName: normalizeText(source.lastName || source.last_name) || null,
          role: normalizeText(source.role) || null,
          active: normalizeBool(source.active, true),
          isGlobalAdmin: normalizeBool(source.isGlobalAdmin ?? source.is_global_admin, false),
          tenantScopes: normalizeTenantScopes(source.tenantScopes || source.tenant_scopes),
          orgScopes: normalizeOrgScopes(source.orgScopes || source.org_scopes),
        } satisfies AssignmentAdminUserOption;
      })
      .filter((entry): entry is AssignmentAdminUserOption => entry !== null)
  ).sort((a, b) =>
    buildAssignmentUserLabel(a).localeCompare(buildAssignmentUserLabel(b), 'de', { sensitivity: 'base' })
  );

  const unitResponses = await Promise.all(
    tenants.map(async (tenant) => {
      try {
        const response = await axios.get(`/api/admin/tenants/${tenant.id}/org-units`, {
          headers,
          params: { includeInactive: includeInactiveOrgUnits ? 1 : 0 },
        });
        return { tenant, rows: Array.isArray(response.data) ? response.data : [] };
      } catch {
        return { tenant, rows: [] as unknown[] };
      }
    })
  );

  const orgUnits = dedupeById(
    unitResponses.flatMap((entry) => {
      const rows = entry.rows
        .map((row) =>
          row && typeof row === 'object' ? (row as Record<string, unknown>) : null
        )
        .filter((row): row is Record<string, unknown> => row !== null);
      const labelsById = buildOrgUnitPathMap(rows);
      return rows
        .map((row) => {
          const id = normalizeText(row.id);
          if (!id) return null;
          const baseLabel = labelsById[id] || normalizeText(row.name) || id;
          const tenantPrefix = normalizeText(entry.tenant.name);
          return {
            id,
            tenantId: normalizeText(row.tenantId || row.tenant_id || entry.tenant.id),
            parentId: normalizeText(row.parentId || row.parent_id) || null,
            name: normalizeText(row.name),
            label: tenantPrefix ? `${tenantPrefix} / ${baseLabel}` : baseLabel,
            contactEmail: normalizeText(row.contactEmail || row.contact_email) || null,
            active: normalizeBool(row.active, true),
          } satisfies AssignmentOrgUnitOption;
        })
        .filter((row): row is AssignmentOrgUnitOption => row !== null);
    })
  ).sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));

  return { tenants, orgUnits, users };
}
