export type AdminScopeMode = 'global' | 'tenant';

export interface AdminScopeSelection {
  mode: AdminScopeMode;
  tenantId: string;
}

export interface AdminAccessContextPayload {
  userId?: string;
  role?: string;
  effectiveRole?: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'ORG_ADMIN' | 'SACHBEARBEITER' | null;
  capabilities?: string[];
  isGlobalAdmin?: boolean;
  tenantIds?: string[];
  tenantAdminTenantIds?: string[];
  orgScopes?: Array<{ tenantId?: string; orgUnitId?: string; canWrite?: boolean }>;
  context?: {
    availableModes?: Array<'global' | 'tenant'>;
    defaultMode?: 'global' | 'tenant';
  };
}

export interface OpsCapabilityGate {
  capability: string;
  fallback?: 'hidden' | 'disabled';
}

export function hasOpsCapability(
  payload: AdminAccessContextPayload | null | undefined,
  capability: string
): boolean {
  const required = String(capability || '').trim();
  if (!required) return false;
  const caps = Array.isArray(payload?.capabilities) ? payload!.capabilities : [];
  return caps.includes(required);
}

export function defaultScopeSelection(payload: AdminAccessContextPayload): AdminScopeSelection {
  const isGlobal = payload?.isGlobalAdmin === true;
  const tenantIds = Array.isArray(payload?.tenantIds) ? payload.tenantIds.filter(Boolean) : [];
  if (isGlobal) return { mode: 'global', tenantId: '' };
  if (tenantIds.length > 0) return { mode: 'tenant', tenantId: tenantIds[0] };
  return { mode: 'global', tenantId: '' };
}

export function normalizeScopeSelection(
  payload: AdminAccessContextPayload,
  selection: Partial<AdminScopeSelection> | null | undefined
): AdminScopeSelection {
  const fallback = defaultScopeSelection(payload);
  const mode = selection?.mode === 'tenant' || selection?.mode === 'global' ? selection.mode : fallback.mode;
  const tenantId = String(selection?.tenantId || fallback.tenantId || '').trim();
  if (mode === 'tenant') {
    const tenantIds = Array.isArray(payload?.tenantIds) ? payload.tenantIds.filter(Boolean) : [];
    if (!tenantIds.includes(tenantId)) {
      return tenantIds.length > 0 ? { mode: 'tenant', tenantId: tenantIds[0] } : fallback;
    }
    return { mode, tenantId };
  }
  if (payload?.isGlobalAdmin === true) {
    return { mode: 'global', tenantId: '' };
  }
  const tenantIds = Array.isArray(payload?.tenantIds) ? payload.tenantIds.filter(Boolean) : [];
  return tenantIds.length > 0 ? { mode: 'tenant', tenantId: tenantIds[0] } : fallback;
}
