import {
  SMART_TABLE_STORAGE_VERSION,
  type SmartTablePersistedState,
} from '../types';

const STORAGE_PREFIX = 'smartTable.v1';

function normalizeTableId(tableId: string): string {
  return String(tableId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

function normalizeUserId(userId?: string): string {
  const normalized = String(userId || '').trim();
  return normalized || 'anonymous';
}

export function createSmartTableStorageKey(tableId: string, userId?: string): string {
  const id = normalizeTableId(tableId) || 'default';
  const user = normalizeUserId(userId);
  return `${STORAGE_PREFIX}:${id}:${user}`;
}

export function loadSmartTableState(tableId: string, userId?: string): SmartTablePersistedState | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const key = createSmartTableStorageKey(tableId, userId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SmartTablePersistedState;
    if (!parsed || typeof parsed !== 'object') return null;
    if (Number(parsed.version) !== SMART_TABLE_STORAGE_VERSION) return null;
    if (!parsed.viewState || typeof parsed.viewState !== 'object') return null;
    if (!Array.isArray(parsed.savedViews)) {
      return {
        version: SMART_TABLE_STORAGE_VERSION,
        viewState: parsed.viewState,
        savedViews: [],
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSmartTableState(
  tableId: string,
  userId: string | undefined,
  state: SmartTablePersistedState
): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const key = createSmartTableStorageKey(tableId, userId);
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: SMART_TABLE_STORAGE_VERSION,
        viewState: state.viewState,
        savedViews: state.savedViews,
      })
    );
  } catch {
    // ignore storage failures
  }
}
