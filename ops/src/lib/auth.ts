export type AuthRole = 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'ORG_ADMIN' | 'SACHBEARBEITER' | 'ADMIN' | null;

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  role: AuthRole;
  remember: boolean;
  user: {
    id?: string;
    username?: string;
    role?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  } | null;
}

const KEY = 'ops.auth.v1';

function normalizeRole(role: unknown): AuthRole {
  const normalized = String(role || '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'PLATFORM_ADMIN' || normalized === 'TENANT_ADMIN' || normalized === 'ORG_ADMIN' || normalized === 'SACHBEARBEITER' || normalized === 'ADMIN') {
    return normalized as AuthRole;
  }
  return null;
}

export function defaultAuthState(): AuthState {
  return {
    isAuthenticated: false,
    token: null,
    role: null,
    remember: false,
    user: null,
  };
}

export function loadAuthState(): AuthState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultAuthState();
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    const token = String(parsed?.token || '').trim();
    if (!token) return defaultAuthState();
    return {
      isAuthenticated: true,
      token,
      role: normalizeRole(parsed?.role),
      remember: parsed?.remember === true,
      user: parsed?.user && typeof parsed.user === 'object' ? parsed.user : null,
    };
  } catch {
    return defaultAuthState();
  }
}

export function persistAuthState(state: AuthState): void {
  if (!state?.token) {
    clearAuthState();
    return;
  }
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function clearAuthState(): void {
  localStorage.removeItem(KEY);
}
