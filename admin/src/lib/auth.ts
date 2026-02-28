export type AuthRole =
  | 'ADMIN'
  | 'SACHBEARBEITER'
  | 'SUPERADMIN'
  | 'MODERATOR'
  | 'VIEWER'
  | null;

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  role: AuthRole;
  userId?: string | null;
  username?: string | null;
  remember?: boolean;
}

const AUTH_KEY = 'auth';
const TOKEN_KEY = 'adminToken';

const normalizeAuthRole = (role: unknown): AuthRole => {
  if (typeof role !== 'string') return null;
  const normalized = role.trim().toUpperCase();
  if (normalized === 'SUPERADMIN') return 'ADMIN';
  if (
    normalized === 'ADMIN' ||
    normalized === 'SACHBEARBEITER' ||
    normalized === 'MODERATOR' ||
    normalized === 'VIEWER'
  ) {
    return normalized as AuthRole;
  }
  return null;
};

const readAuth = (storage: Storage): AuthState | null => {
  const raw = storage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
};

export const loadAuthState = (): AuthState => {
  const hydrateFromToken = (state: AuthState, remember: boolean): AuthState => {
    if (!state.token) return { ...state, remember };
    try {
      const payloadRaw = state.token.split('.')[1];
      if (!payloadRaw) return { ...state, remember };
      const base64 = payloadRaw.replace(/-/g, '+').replace(/_/g, '/');
      const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
      const payload = JSON.parse(atob(padded)) as {
        userId?: string;
        username?: string;
        role?: string;
      };
      return {
        ...state,
        userId: state.userId || payload.userId || null,
        username: state.username || payload.username || null,
        role: normalizeAuthRole(state.role || payload.role) || null,
        remember,
      };
    } catch {
      return { ...state, remember };
    }
  };

  const sessionAuth = readAuth(sessionStorage);
  if (sessionAuth?.isAuthenticated) return hydrateFromToken(sessionAuth, false);
  const localAuth = readAuth(localStorage);
  if (localAuth?.isAuthenticated) return hydrateFromToken(localAuth, true);
  return { isAuthenticated: false, token: null, role: null, remember: false };
};

export const persistAuthState = (auth: AuthState, remember: boolean) => {
  const target = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;

  if (auth.isAuthenticated) {
    const payload = { ...auth, remember };
    target.setItem(AUTH_KEY, JSON.stringify(payload));
    if (auth.token) target.setItem(TOKEN_KEY, auth.token);
    other.removeItem(AUTH_KEY);
    other.removeItem(TOKEN_KEY);
  } else {
    target.removeItem(AUTH_KEY);
    target.removeItem(TOKEN_KEY);
    other.removeItem(AUTH_KEY);
    other.removeItem(TOKEN_KEY);
  }
};

export const clearAuthState = () => {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
};

export const getAdminToken = (): string | null => {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
};

export const normalizeRoleLabel = (role: AuthRole): string => {
  const normalized = normalizeAuthRole(role);
  if (!normalized) return 'Unbekannt';
  if (normalized === 'ADMIN') return 'Admin';
  return 'Sachbearbeiter';
};

export const isAdminRole = (role: AuthRole | string | null | undefined): boolean => {
  return normalizeAuthRole(role) === 'ADMIN';
};
