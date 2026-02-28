import { getDatabase } from '../database.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  type GeneralSettings,
  normalizeRoutingSettings,
  resolveCitizenFrontendProfile,
  type RoutingSettings,
} from './settings.js';

export interface ResolvedTenantRoutingContext {
  routing: RoutingSettings;
  resolvedTenantId: string;
  resolvedTenantSlug: string;
  rootTenantSlug: string;
  canonicalBasePath: string;
  platformPath: string;
  platformOnRoot: boolean;
  tenantOnRoot: boolean;
  tenantMismatch: boolean;
}

const DEFAULT_TENANT_ID = 'tenant_default';
const DEFAULT_TENANT_SLUG = 'default';

export function normalizeTenantSlug(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

export function buildTenantBasePath(tenantSlug: string, tenantBasePath = '/c'): string {
  const slug = normalizeTenantSlug(tenantSlug) || DEFAULT_TENANT_SLUG;
  const base = String(tenantBasePath || '/c').trim().replace(/\/+$/g, '') || '/c';
  return `${base}/${slug}`;
}

export function buildCanonicalPathFromBase(basePath: string, targetPath: string): string {
  const normalizedBase = String(basePath || '/').trim().replace(/\/+$/g, '') || '/';
  const normalizedTarget = `/${String(targetPath || '/').trim().replace(/^\/+/, '')}`;
  if (normalizedBase === '/' || normalizedBase === '') {
    return normalizedTarget === '//' ? '/' : normalizedTarget;
  }
  return `${normalizedBase}${normalizedTarget}`.replace(/\/{2,}/g, '/');
}

export function extractTenantSlugFromPathname(pathname: string, tenantBasePath = '/c'): string {
  const normalizedPath = `/${String(pathname || '/').replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  const prefix = `${String(tenantBasePath || '/c').replace(/\/+$/g, '')}/`;
  if (!normalizedPath.startsWith(prefix)) return '';
  const rest = normalizedPath.slice(prefix.length);
  const slug = rest.split('/')[0] || '';
  return normalizeTenantSlug(slug);
}

export async function findTenantSlugById(tenantId: string): Promise<string> {
  const normalizedId = String(tenantId || '').trim();
  if (!normalizedId) return '';
  const db = getDatabase();
  const row = await db.get(`SELECT slug FROM tenants WHERE id = ? LIMIT 1`, [normalizedId]);
  return normalizeTenantSlug(row?.slug);
}

export async function findTenantIdBySlug(tenantSlug: string): Promise<string> {
  const normalizedSlug = normalizeTenantSlug(tenantSlug);
  if (!normalizedSlug) return '';
  const db = getDatabase();
  const row = await db.get(`SELECT id FROM tenants WHERE slug = ? LIMIT 1`, [normalizedSlug]);
  return String(row?.id || '').trim();
}

async function resolveRootTenantSlug(routing: RoutingSettings): Promise<string> {
  if (routing.rootMode !== 'tenant') return '';

  const configuredRootTenantId = String(routing.rootTenantId || '').trim();
  if (configuredRootTenantId) {
    const configuredSlug = await findTenantSlugById(configuredRootTenantId);
    if (configuredSlug) return configuredSlug;
  }

  const defaultSlug = await findTenantSlugById(DEFAULT_TENANT_ID);
  return defaultSlug || DEFAULT_TENANT_SLUG;
}

async function resolveFallbackTenantSlug(): Promise<string> {
  const defaultSlug = await findTenantSlugById(DEFAULT_TENANT_ID);
  return defaultSlug || DEFAULT_TENANT_SLUG;
}

export async function resolveTenantRoutingContext(input: {
  settings: GeneralSettings;
  frontendToken?: string;
  requestedTenantSlug?: string;
}): Promise<ResolvedTenantRoutingContext> {
  const routing = normalizeRoutingSettings(input.settings?.routing, DEFAULT_ROUTING_SETTINGS);
  const requestedTenantSlug = normalizeTenantSlug(input.requestedTenantSlug);
  const requestedTenantId = requestedTenantSlug ? await findTenantIdBySlug(requestedTenantSlug) : '';

  const resolvedProfile = resolveCitizenFrontendProfile(input.settings, input.frontendToken || '');
  const profileTenantId = String(resolvedProfile?.tenantId || '').trim();
  const profileTenantSlug = profileTenantId ? await findTenantSlugById(profileTenantId) : '';

  const rootTenantSlug = await resolveRootTenantSlug(routing);

  const resolvedTenantSlug =
    requestedTenantSlug ||
    profileTenantSlug ||
    (routing.rootMode === 'tenant' ? rootTenantSlug : '') ||
    (await resolveFallbackTenantSlug());

  const resolvedTenantId =
    requestedTenantId ||
    profileTenantId ||
    (resolvedTenantSlug ? await findTenantIdBySlug(resolvedTenantSlug) : '') ||
    DEFAULT_TENANT_ID;

  const tenantOnRoot =
    routing.rootMode === 'tenant' &&
    !!resolvedTenantSlug &&
    !!rootTenantSlug &&
    resolvedTenantSlug === rootTenantSlug;
  const canonicalBasePath = tenantOnRoot ? '/' : buildTenantBasePath(resolvedTenantSlug, routing.tenantBasePath);

  return {
    routing,
    resolvedTenantId,
    resolvedTenantSlug,
    rootTenantSlug,
    canonicalBasePath,
    platformPath: routing.platformPath,
    platformOnRoot: routing.rootMode === 'platform',
    tenantOnRoot,
    tenantMismatch: !!requestedTenantSlug && !!resolvedTenantSlug && requestedTenantSlug !== resolvedTenantSlug,
  };
}

export async function resolveTenantSlugByPublicToken(tokenInput: unknown): Promise<string> {
  const token = String(tokenInput || '').trim();
  if (!token) return '';
  const db = getDatabase();

  const fromValidation = await db.get(
    `SELECT t.tenant_id
     FROM ticket_validations tv
     JOIN tickets t ON t.id = tv.ticket_id
     WHERE tv.validation_token = ?
     ORDER BY datetime(tv.created_at) DESC
     LIMIT 1`,
    [token]
  );
  if (fromValidation?.tenant_id) {
    return findTenantSlugById(String(fromValidation.tenant_id));
  }

  const fromTicket = await db.get(
    `SELECT tenant_id
     FROM tickets
     WHERE validation_token = ?
     ORDER BY datetime(updated_at) DESC
     LIMIT 1`,
    [token]
  );
  if (fromTicket?.tenant_id) {
    return findTenantSlugById(String(fromTicket.tenant_id));
  }

  const fromWorkflowValidation = await db.get(
    `SELECT t.tenant_id
     FROM workflow_validations wv
     JOIN tickets t ON t.id = wv.ticket_id
     WHERE wv.validation_token = ?
     ORDER BY datetime(wv.created_at) DESC
     LIMIT 1`,
    [token]
  );
  if (fromWorkflowValidation?.tenant_id) {
    return findTenantSlugById(String(fromWorkflowValidation.tenant_id));
  }

  const fromDataRequest = await db.get(
    `SELECT t.tenant_id
     FROM workflow_data_requests dr
     JOIN tickets t ON t.id = dr.ticket_id
     WHERE dr.token = ?
     ORDER BY datetime(dr.created_at) DESC
     LIMIT 1`,
    [token]
  );
  if (fromDataRequest?.tenant_id) {
    return findTenantSlugById(String(fromDataRequest.tenant_id));
  }

  return '';
}
