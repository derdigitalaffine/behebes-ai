import { getSetting, setSetting } from './settings.js';

export const MUNICIPAL_CONTACTS_SETTING_KEY = 'municipalContacts';
const MUNICIPAL_CONTACTS_VERSION = 1;

export type MunicipalContactLocationType = 'city' | 'postal_code';

export interface MunicipalContactPerson {
  name: string;
  email: string;
  deputyName: string;
  deputyEmail: string;
}

export interface MunicipalContactEntry extends MunicipalContactPerson {
  id: string;
  label: string;
  locationType: MunicipalContactLocationType;
  locationValue: string;
  notes: string;
  active: boolean;
}

export interface MunicipalContactsSettings {
  version: number;
  updatedAt: string;
  fallback: MunicipalContactPerson;
  entries: MunicipalContactEntry[];
}

export interface MunicipalContactLookupInput {
  postalCode?: unknown;
  city?: unknown;
  submissionPostalCode?: unknown;
  submissionCity?: unknown;
}

export interface MunicipalContactResolution {
  recipientName: string;
  recipientEmail: string;
  source: 'postal_code' | 'city' | 'fallback' | 'none';
  matchedEntry: MunicipalContactEntry | null;
  usedDeputy: boolean;
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizePostalCode(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/[^0-9a-zA-Z-]/g, '')
    .toLowerCase();
}

function normalizeCityKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, '');
}

function normalizeLocationType(value: unknown): MunicipalContactLocationType {
  return String(value || '').trim().toLowerCase() === 'postal_code' ? 'postal_code' : 'city';
}

function createEntryId(): string {
  return `municipal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePerson(value: unknown): MunicipalContactPerson {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
  return {
    name: normalizeText(source.name),
    email: normalizeEmail(source.email),
    deputyName: normalizeText(source.deputyName),
    deputyEmail: normalizeEmail(source.deputyEmail),
  };
}

function normalizeEntry(value: unknown, index: number): MunicipalContactEntry | null {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
  if (!source) return null;

  const locationType = normalizeLocationType(source.locationType);
  const locationValue =
    locationType === 'postal_code'
      ? normalizePostalCode(source.locationValue)
      : normalizeText(source.locationValue);
  if (!locationValue) return null;

  const person = normalizePerson(source);
  const id = normalizeText(source.id) || `${createEntryId()}-${index + 1}`;
  const label = normalizeText(source.label) || locationValue;

  return {
    id,
    label,
    locationType,
    locationValue,
    notes: normalizeText(source.notes),
    active: source.active !== false,
    ...person,
  };
}

function ensureUniqueEntryIds(entries: MunicipalContactEntry[]): MunicipalContactEntry[] {
  const used = new Set<string>();
  return entries.map((entry, index) => {
    let candidate = normalizeText(entry.id) || `${createEntryId()}-${index + 1}`;
    while (used.has(candidate)) {
      candidate = `${candidate}-${Math.random().toString(36).slice(2, 5)}`;
    }
    used.add(candidate);
    return { ...entry, id: candidate };
  });
}

export function normalizeMunicipalContactsSettings(input: unknown): MunicipalContactsSettings {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, any>) : {};
  const rawFallback =
    source.fallback && typeof source.fallback === 'object' && !Array.isArray(source.fallback)
      ? source.fallback
      : {
          name: source.fallbackName,
          email: source.fallbackEmail,
          deputyName: source.fallbackDeputyName,
          deputyEmail: source.fallbackDeputyEmail,
        };

  const entries = Array.isArray(source.entries)
    ? source.entries
        .map((entry, index) => normalizeEntry(entry, index))
        .filter((entry): entry is MunicipalContactEntry => entry !== null)
    : [];

  return {
    version: MUNICIPAL_CONTACTS_VERSION,
    updatedAt: new Date().toISOString(),
    fallback: normalizePerson(rawFallback),
    entries: ensureUniqueEntryIds(entries),
  };
}

export async function loadMunicipalContactsSettings(): Promise<MunicipalContactsSettings> {
  const stored = await getSetting<unknown>(MUNICIPAL_CONTACTS_SETTING_KEY);
  return normalizeMunicipalContactsSettings(stored);
}

export async function saveMunicipalContactsSettings(input: unknown): Promise<MunicipalContactsSettings> {
  const normalized = normalizeMunicipalContactsSettings(input);
  await setSetting(MUNICIPAL_CONTACTS_SETTING_KEY, normalized);
  return normalized;
}

function resolveRecipientFromPerson(
  person: MunicipalContactPerson,
  fallbackName: string
): { recipientName: string; recipientEmail: string; usedDeputy: boolean } | null {
  const primaryEmail = normalizeEmail(person.email);
  if (primaryEmail) {
    return {
      recipientName: normalizeText(person.name) || fallbackName,
      recipientEmail: primaryEmail,
      usedDeputy: false,
    };
  }
  const deputyEmail = normalizeEmail(person.deputyEmail);
  if (deputyEmail) {
    return {
      recipientName: normalizeText(person.deputyName) || normalizeText(person.name) || `${fallbackName} (Vertretung)`,
      recipientEmail: deputyEmail,
      usedDeputy: true,
    };
  }
  return null;
}

export function resolveMunicipalContactForTicket(input: {
  ticket: MunicipalContactLookupInput;
  settings: MunicipalContactsSettings;
}): MunicipalContactResolution {
  const ticket = input.ticket || {};
  const settings = normalizeMunicipalContactsSettings(input.settings);

  const postalCandidates = [
    normalizePostalCode(ticket.postalCode),
    normalizePostalCode(ticket.submissionPostalCode),
  ].filter(Boolean);
  const cityCandidates = [
    normalizeCityKey(ticket.city),
    normalizeCityKey(ticket.submissionCity),
  ].filter(Boolean);

  const activeEntries = settings.entries.filter((entry) => entry.active !== false);
  const postalMatch = activeEntries.find(
    (entry) =>
      entry.locationType === 'postal_code' &&
      postalCandidates.includes(normalizePostalCode(entry.locationValue))
  );
  const cityMatch = activeEntries.find(
    (entry) =>
      entry.locationType === 'city' && cityCandidates.includes(normalizeCityKey(entry.locationValue))
  );
  const matchedEntry = postalMatch || cityMatch || null;

  if (matchedEntry) {
    const recipient = resolveRecipientFromPerson(matchedEntry, 'Ortsbuergermeister');
    if (recipient) {
      return {
        ...recipient,
        source: matchedEntry.locationType,
        matchedEntry,
      };
    }
  }

  const fallbackRecipient = resolveRecipientFromPerson(settings.fallback, 'Ortsbuergermeister');
  if (fallbackRecipient) {
    return {
      ...fallbackRecipient,
      source: 'fallback',
      matchedEntry: null,
    };
  }

  return {
    recipientName: '',
    recipientEmail: '',
    source: 'none',
    matchedEntry,
    usedDeputy: false,
  };
}
