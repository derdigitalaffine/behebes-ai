import { describe, expect, it } from 'vitest';
import {
  defaultScopeSelection, hasOpsCapability, normalizeScopeSelection,
  type AdminAccessContextPayload,
} from './scope';

const user: AdminAccessContextPayload = {
  role: 'TENANT_ADMIN', isGlobalAdmin: false,
  tenantIds: ['tenant-a', 'tenant-b'],
  capabilities: ['ops.ticket.read', 'ops.ticket.update'],
};
describe('OPS: scope/capability presentation (server authorization remains mandatory)', () => {
  it('does not select an unknown or foreign tenant', () => {
    expect(normalizeScopeSelection(user, { mode: 'tenant', tenantId: 'foreign' })).toEqual({
      mode: 'tenant', tenantId: 'tenant-a',
    });
  });
  it('does not accept global scope from a tenant administrator', () => {
    expect(normalizeScopeSelection(user, { mode: 'global', tenantId: '' })).toEqual({
      mode: 'tenant', tenantId: 'tenant-a',
    });
  });
  it('preserves an explicitly permitted tenant selection', () => {
    expect(normalizeScopeSelection(user, { mode: 'tenant', tenantId: 'tenant-b' })).toEqual({
      mode: 'tenant', tenantId: 'tenant-b',
    });
  });
  it('permits global scope only for an authorized platform administrator', () => {
    const admin: AdminAccessContextPayload = { isGlobalAdmin: true, tenantIds: ['tenant-a'] };
    expect(defaultScopeSelection(admin)).toEqual({ mode: 'global', tenantId: '' });
    expect(normalizeScopeSelection(admin, { mode: 'global', tenantId: 'tenant-a' })).toEqual({
      mode: 'global', tenantId: '',
    });
  });
  it('does not invent tenants when the user has none', () => {
    const noTenants: AdminAccessContextPayload = { isGlobalAdmin: false, tenantIds: [] };
    expect(normalizeScopeSelection(noTenants, { mode: 'tenant', tenantId: 'foreign' })).toEqual({
      mode: 'global', tenantId: '',
    });
  });
  it('requires explicit capability, and denies missing or blank', () => {
    expect(hasOpsCapability(user, 'ops.ticket.read')).toBe(true);
    expect(hasOpsCapability(user, 'ops.ticket.delete')).toBe(false);
    expect(hasOpsCapability(user, '')).toBe(false);
    expect(hasOpsCapability(undefined, 'ops.ticket.read')).toBe(false);
  });
});
