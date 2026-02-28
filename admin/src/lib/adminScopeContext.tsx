import React, { createContext, useContext } from 'react';

export type AdminLibraryScope = 'platform' | 'tenant';
export type AdminEffectiveRole = 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'ORG_ADMIN' | 'SACHBEARBEITER' | null;

export interface AdminScopeSelection {
  scope: AdminLibraryScope;
  tenantId: string;
}

export interface AdminScopeTenantOption {
  id: string;
  name: string;
  active: boolean;
}

export interface AdminScopeContextValue {
  selection: AdminScopeSelection;
  setSelection: (next: AdminScopeSelection) => void;
  isGlobalAdmin: boolean;
  tenants: AdminScopeTenantOption[];
  effectiveRole: AdminEffectiveRole;
  capabilities: string[];
  hasCapability: (capability: string) => boolean;
}

const defaultValue: AdminScopeContextValue = {
  selection: {
    scope: 'platform',
    tenantId: '',
  },
  setSelection: () => {},
  isGlobalAdmin: false,
  tenants: [],
  effectiveRole: null,
  capabilities: [],
  hasCapability: () => false,
};

const AdminScopeContext = createContext<AdminScopeContextValue>(defaultValue);

export function useAdminScopeContext(): AdminScopeContextValue {
  return useContext(AdminScopeContext);
}

export default AdminScopeContext;
