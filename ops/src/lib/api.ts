import axios from 'axios';
import type { AdminScopeSelection } from './scope';

export const api = axios.create({
  baseURL: '/api',
});

export function buildAuthHeaders(token: string, scope?: AdminScopeSelection): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (scope?.mode === 'tenant' && scope.tenantId) {
    headers['X-Admin-Context-Mode'] = 'tenant';
    headers['X-Admin-Context-Tenant-Id'] = scope.tenantId;
  } else if (scope?.mode === 'global') {
    headers['X-Admin-Context-Mode'] = 'global';
  }
  return headers;
}
