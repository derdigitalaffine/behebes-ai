/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * Role normalization helpers
 */

export type NormalizedRole = 'ADMIN' | 'SACHBEARBEITER';

export function normalizeRole(role?: string | null): NormalizedRole | null {
  if (!role) return null;
  switch (role.toUpperCase()) {
    case 'ADMIN':
    case 'SUPERADMIN':
      return 'ADMIN';
    case 'SACHBEARBEITER':
    case 'MODERATOR':
    case 'VIEWER':
      return 'SACHBEARBEITER';
    default:
      return null;
  }
}

export function isAdminRole(role?: string | null): boolean {
  return normalizeRole(role) === 'ADMIN';
}

export function isStaffRole(role?: string | null): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'ADMIN' || normalized === 'SACHBEARBEITER';
}
