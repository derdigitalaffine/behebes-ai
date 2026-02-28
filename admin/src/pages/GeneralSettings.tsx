import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';
import SourceTag from '../components/SourceTag';
import { CITIZEN_STRINGS } from '../i18n/citizenStrings';

export type GeneralSettingsView =
  | 'all'
  | 'base'
  | 'citizen'
  | 'jurisdiction'
  | 'languages'
  | 'operations'
  | 'maintenance';

interface CitizenFrontendProfileConfig {
  id: string;
  name: string;
  token: string;
  tenantId: string;
  intakeWorkflowTemplateId: string;
  authenticatedIntakeWorkflowTemplateId: string;
  citizenAuthEnabled: boolean;
  enabled: boolean;
  headerTag: string;
  headerKicker: string;
  headerTitle: string;
  headerSubtitle: string;
  submissionKicker: string;
  submissionTitle: string;
  submissionSubtitle: string;
}

interface GeneralConfig {
  callbackMode: 'auto' | 'custom';
  callbackUrl: string;
  appName: string;
  webPush: {
    vapidPublicKey: string;
    vapidPrivateKey: string;
    vapidSubject: string;
  };
  xmppRtc: {
    stunUrls: string[];
    turnUrls: string[];
    turnUsername: string;
    turnCredential: string;
  };
  maintenanceMode: boolean;
  maintenanceMessage: string;
  restrictLocations: boolean;
  allowedLocations: string[];
  jurisdictionGeofence: JurisdictionGeofenceConfig;
  responsibilityAuthorities: string[];
  defaultLanguage: string;
  workflowAbortNotificationEnabled: boolean;
  workflowAbortRecipientEmail: string;
  workflowAbortRecipientName: string;
  citizenFrontend: {
    intakeWorkflowTemplateId: string;
    tenantId: string;
    emailDoubleOptInTimeoutHours: number;
    dataRequestTimeoutHours: number;
    enhancedCategorizationTimeoutHours: number;
    profiles: CitizenFrontendProfileConfig[];
    announcementEnabled: boolean;
    announcementMode: 'banner' | 'modal';
    announcementTitle: string;
    announcementMessage: string;
    announcementSourceHash: string;
    announcementTranslations: Record<
      string,
      {
        title: string;
        message: string;
        sourceHash?: string;
      }
    >;
  };
  languages: LanguageConfig[];
  routing: {
    rootMode: 'platform' | 'tenant';
    rootTenantId: string;
    platformPath: string;
    tenantBasePath: '/c';
  };
}

interface WorkflowTemplateOption {
  id: string;
  name: string;
  enabled?: boolean;
}

interface TenantOption {
  id: string;
  name: string;
  slug?: string;
  active: boolean;
}

interface JurisdictionGeofenceConfig {
  enabled: boolean;
  shape: 'circle' | 'polygon';
  centerLat?: number;
  centerLon?: number;
  radiusMeters?: number;
  points: Array<{ lat: number; lon: number }>;
}

interface LanguageConfig {
  code: string;
  label: string;
  aiName?: string;
  locale?: string;
  dir?: 'ltr' | 'rtl';
  flag?: string;
}

interface TranslationCoverageMetrics {
  total: number;
  translated: number;
  missing: number;
  percent: number;
}

interface TranslationCoverageMissingEmailTemplate {
  templateId: string;
  templateName: string;
  reason: 'missing' | 'empty' | 'outdated';
}

interface TranslationCoverageLanguageSummary {
  language: string;
  label: string;
  configured: boolean;
  ui: TranslationCoverageMetrics;
  email: TranslationCoverageMetrics;
  overall: TranslationCoverageMetrics;
  missingUiKeys: string[];
  missingEmailTemplates: TranslationCoverageMissingEmailTemplate[];
}

interface TranslationCoverageReport {
  generatedAt: string;
  source: {
    uiTotal: number;
    emailTemplateTotal: number;
  };
  languages: TranslationCoverageLanguageSummary[];
}

interface DatabaseStructureColumn {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKeyOrder: number;
}

interface DatabaseStructureForeignKey {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
  match: string;
}

interface DatabaseStructureTable {
  name: string;
  rowCount: number;
  createSql: string;
  columns: DatabaseStructureColumn[];
  foreignKeys: DatabaseStructureForeignKey[];
}

interface DatabaseStructureSummary {
  database: {
    pageCount: number;
    pageSize: number;
    sizeBytes: number;
    sizeMb: number;
  };
  tableCount: number;
  tables: DatabaseStructureTable[];
  generatedAt: string;
}

interface UpdateStatusSnapshot {
  currentVersion: string;
  latestTagVersion: string | null;
  build: {
    appVersion: string;
    envBuildId: string | null;
    envBuildTime: string | null;
    envCommitRef: string | null;
  };
  git: {
    available: boolean;
    branch: string | null;
    headCommit: string | null;
    describe: string | null;
    dirty: boolean;
  };
  runtimeType: 'docker-compose' | 'node';
  backup: {
    available: boolean;
    latestPath: string | null;
    latestAt: string | null;
    ageHours: number | null;
    artifactCount: number;
    requiredMaxAgeHours: number;
    isFresh: boolean;
  };
  migrations: {
    schemaMigrationsTable: boolean;
    appliedCount: number;
    migrationFilesCount: number;
    pendingCount: number;
    consistent: boolean;
  };
  checkedAt: string;
}

interface UpdatePreflightReport {
  kind?: 'status_check' | 'preflight';
  ok: boolean;
  blockedReasons: string[];
  checks: Record<string, { ok: boolean; detail: string }>;
  status: UpdateStatusSnapshot;
  durationMs: number;
  checkedAt: string;
}

interface UpdateRunbook {
  runtimeType: 'docker-compose' | 'node';
  targetTag: string | null;
  generatedAt: string;
  commands: string[];
  notes: string[];
}

interface UpdateHistoryItem {
  id: string;
  createdAt: string | null;
  username: string | null;
  adminUserId: string | null;
  report: UpdatePreflightReport;
}

const UPDATE_PREFLIGHT_CHECK_LABELS: Record<string, string> = {
  dbReachable: 'Datenbank erreichbar',
  composePresent: 'Compose-Dateien vorhanden',
  backupFresh: 'Backup aktuell',
  migrationsConsistent: 'Migrationen konsistent',
  gitAvailable: 'Git-Metadaten verfügbar',
};

const formatDateTimeSafe = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Date(parsed).toLocaleString('de-DE');
};

const resolveUpdateCheckLabel = (checkKey: string): string => {
  if (UPDATE_PREFLIGHT_CHECK_LABELS[checkKey]) return UPDATE_PREFLIGHT_CHECK_LABELS[checkKey];
  return checkKey.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
};

const resolveUpdateReportKindLabel = (kind: UpdatePreflightReport['kind']): string => {
  if (kind === 'status_check') return 'Status-Check';
  if (kind === 'preflight') return 'Preflight';
  return 'Prüfung';
};

const sanitizeAnnouncementText = (value: unknown, maxLength: number): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : '';
};

const parseBooleanFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return false;
};

const sanitizeCitizenFrontendProfileToken = (value: unknown): string => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 80);
};

const sanitizeCitizenFrontendProfileId = (value: unknown, fallback: string): string => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return normalized || fallback;
};

const sanitizeCitizenFrontendProfileName = (value: unknown, fallback: string): string => {
  const normalized = String(value || '').trim().slice(0, 120);
  return normalized || fallback;
};

const sanitizeCitizenFrontendProfileText = (value: unknown, maxLength: number): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : '';
};

const sanitizeCitizenFrontendTenantId = (value: unknown): string =>
  String(value || '').trim().slice(0, 120);

const sanitizeRoutingPlatformPath = (value: unknown): string => {
  const raw = String(value || '').trim();
  const normalized = `/${raw.replace(/^\/+|\/+$/g, '')}`;
  if (!normalized || normalized === '/') return '/plattform';
  return normalized.slice(0, 120);
};

const CALLBACK_ROUTE_PATHS = ['/verify', '/status', '/workflow/confirm', '/workflow/data-request'];
const RESERVED_PLATFORM_PATH_PREFIXES = [
  '/api',
  '/admin',
  '/verify',
  '/status',
  '/workflow',
  '/login',
  '/me',
  '/guide',
  '/privacy',
];

const normalizePublicPath = (value: unknown, fallback = '/'): string => {
  const raw = String(value || '').trim();
  const source = raw || fallback;
  const withLeadingSlash = source.startsWith('/') ? source : `/${source}`;
  const normalized = withLeadingSlash.replace(/\/+$/g, '') || '/';
  return normalized.length > 220 ? normalized.slice(0, 220) : normalized;
};

type CallbackProtocol = 'http' | 'https';

const detectCallbackProtocol = (value: unknown): CallbackProtocol => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.startsWith('http://') ? 'http' : 'https';
};

const normalizeCallbackUrlInput = (value: unknown, preferredProtocol: CallbackProtocol): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `${preferredProtocol}:${raw}`;
  return `${preferredProtocol}://${raw.replace(/^\/+/, '')}`;
};

const forceCallbackProtocol = (value: unknown, protocol: CallbackProtocol): string => {
  const normalized = normalizeCallbackUrlInput(value, protocol);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    parsed.protocol = `${protocol}:`;
    return parsed.toString();
  } catch {
    return normalized;
  }
};

const joinPublicPath = (basePath: string, targetPath: string): string => {
  const normalizedBase = normalizePublicPath(basePath, '/');
  const normalizedTarget = normalizePublicPath(targetPath, '/');
  if (normalizedBase === '/') return normalizedTarget;
  if (normalizedTarget === '/') return normalizedBase;
  return `${normalizedBase}${normalizedTarget}`.replace(/\/{2,}/g, '/');
};

const toScopePath = (basePath: string): string => {
  const normalizedBase = normalizePublicPath(basePath, '/');
  return normalizedBase === '/' ? '/' : `${normalizedBase}/`;
};

const sanitizeTenantSlug = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);

const validatePlatformPathConsistency = (platformPathInput: string, tenantBasePath = '/c'): string | null => {
  const platformPath = normalizePublicPath(platformPathInput, '/plattform');
  const normalizedTenantBase = normalizePublicPath(tenantBasePath, '/c');
  if (platformPath === '/') {
    return 'Der Plattform-Unterpfad darf nicht "/" sein.';
  }
  if (platformPath === normalizedTenantBase || platformPath.startsWith(`${normalizedTenantBase}/`)) {
    return `Der Plattform-Unterpfad darf nicht mit "${normalizedTenantBase}" kollidieren.`;
  }
  const reservedPrefix = RESERVED_PLATFORM_PATH_PREFIXES.find(
    (prefix) => platformPath === prefix || platformPath.startsWith(`${prefix}/`)
  );
  if (reservedPrefix) {
    return `Der Plattform-Unterpfad "${platformPath}" kollidiert mit der reservierten Route "${reservedPrefix}".`;
  }
  return null;
};

const normalizeCitizenFrontendProfiles = (
  input: unknown,
  fallbackIntakeWorkflowTemplateId: string,
  fallbackTenantId = ''
): CitizenFrontendProfileConfig[] => {
  if (!Array.isArray(input)) return [];
  const result: CitizenFrontendProfileConfig[] = [];
  const seenIds = new Set<string>();
  const seenTokens = new Set<string>();

  input.forEach((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return;
    const entry = rawEntry as Record<string, unknown>;
    const token = sanitizeCitizenFrontendProfileToken(entry.token);
    if (!token || seenTokens.has(token)) return;

    const fallbackId = `profile-${index + 1}`;
    const baseId = sanitizeCitizenFrontendProfileId(entry.id, fallbackId);
    let id = baseId;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const intakeWorkflowTemplateId =
      typeof entry.intakeWorkflowTemplateId === 'string' && entry.intakeWorkflowTemplateId.trim()
        ? entry.intakeWorkflowTemplateId.trim()
        : fallbackIntakeWorkflowTemplateId;
    const authenticatedIntakeWorkflowTemplateId =
      typeof entry.authenticatedIntakeWorkflowTemplateId === 'string' && entry.authenticatedIntakeWorkflowTemplateId.trim()
        ? entry.authenticatedIntakeWorkflowTemplateId.trim()
        : '';

    result.push({
      id,
      name: sanitizeCitizenFrontendProfileName(entry.name, `Profil ${index + 1}`),
      token,
      tenantId: sanitizeCitizenFrontendTenantId(entry.tenantId || entry.tenant_id || fallbackTenantId),
      intakeWorkflowTemplateId,
      authenticatedIntakeWorkflowTemplateId,
      citizenAuthEnabled: parseBooleanFlag(entry.citizenAuthEnabled),
      enabled: parseBooleanFlag(entry.enabled) || entry.enabled === undefined || entry.enabled === null,
      headerTag: sanitizeCitizenFrontendProfileText(entry.headerTag, 80),
      headerKicker: sanitizeCitizenFrontendProfileText(entry.headerKicker, 120),
      headerTitle: sanitizeCitizenFrontendProfileText(entry.headerTitle, 160),
      headerSubtitle: sanitizeCitizenFrontendProfileText(entry.headerSubtitle, 240),
      submissionKicker: sanitizeCitizenFrontendProfileText(entry.submissionKicker, 120),
      submissionTitle: sanitizeCitizenFrontendProfileText(entry.submissionTitle, 160),
      submissionSubtitle: sanitizeCitizenFrontendProfileText(entry.submissionSubtitle, 400),
    });
    seenIds.add(id);
    seenTokens.add(token);
  });

  return result.slice(0, 50);
};

const buildNextCitizenFrontendProfileId = (existingProfiles: CitizenFrontendProfileConfig[]): string => {
  const seen = new Set(
    existingProfiles
      .map((profile) => sanitizeCitizenFrontendProfileId(profile.id, ''))
      .filter(Boolean)
  );
  let index = Math.max(1, existingProfiles.length + 1);
  while (seen.has(`profile-${index}`)) {
    index += 1;
  }
  return `profile-${index}`;
};

const buildNextCitizenFrontendProfileToken = (existingProfiles: CitizenFrontendProfileConfig[]): string => {
  const seen = new Set(
    existingProfiles
      .map((profile) => sanitizeCitizenFrontendProfileToken(profile.token))
      .filter(Boolean)
  );
  let index = Math.max(1, existingProfiles.length + 1);
  while (seen.has(`frontend-${index}`)) {
    index += 1;
  }
  return `frontend-${index}`;
};

const normalizeAnnouncementTranslations = (
  input: unknown
): GeneralConfig['citizenFrontend']['announcementTranslations'] => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const result: GeneralConfig['citizenFrontend']['announcementTranslations'] = {};
  Object.entries(source).forEach(([rawCode, rawEntry]) => {
    const code = String(rawCode || '').trim().toLowerCase();
    if (!code) return;
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return;
    const entry = rawEntry as Record<string, unknown>;
    const title = sanitizeAnnouncementText(entry.title, 240);
    const message = sanitizeAnnouncementText(entry.message, 4000);
    const sourceHash =
      typeof entry.sourceHash === 'string' && entry.sourceHash.trim()
        ? entry.sourceHash.trim().slice(0, 128)
        : undefined;
    if (!title && !message) return;
    result[code] = sourceHash ? { title, message, sourceHash } : { title, message };
  });
  return result;
};

const buildAnnouncementSourceHash = (title: string, message: string): string => {
  const source = `${title}\n${message}`.trim();
  if (!source) return '';
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const COMMON_LANGUAGES: LanguageConfig[] = [
  { code: 'de', label: 'Deutsch', aiName: 'German', locale: 'de-DE', flag: '🇩🇪', dir: 'ltr' },
  { code: 'en', label: 'English', aiName: 'English', locale: 'en-GB', flag: '🇬🇧', dir: 'ltr' },
  { code: 'fr', label: 'Français', aiName: 'French', locale: 'fr-FR', flag: '🇫🇷', dir: 'ltr' },
  { code: 'es', label: 'Español', aiName: 'Spanish', locale: 'es-ES', flag: '🇪🇸', dir: 'ltr' },
  { code: 'it', label: 'Italiano', aiName: 'Italian', locale: 'it-IT', flag: '🇮🇹', dir: 'ltr' },
  { code: 'pt', label: 'Português', aiName: 'Portuguese', locale: 'pt-PT', flag: '🇵🇹', dir: 'ltr' },
  { code: 'nl', label: 'Nederlands', aiName: 'Dutch', locale: 'nl-NL', flag: '🇳🇱', dir: 'ltr' },
  { code: 'ru', label: 'Русский', aiName: 'Russian', locale: 'ru-RU', flag: '🇷🇺', dir: 'ltr' },
  { code: 'zh', label: '中文', aiName: 'Chinese (Simplified)', locale: 'zh-CN', flag: '🇨🇳', dir: 'ltr' },
  { code: 'ar', label: 'العربية', aiName: 'Arabic', locale: 'ar-SA', flag: '🇸🇦', dir: 'rtl' },
  { code: 'hi', label: 'हिन्दी', aiName: 'Hindi', locale: 'hi-IN', flag: '🇮🇳', dir: 'ltr' },
  { code: 'bn', label: 'বাংলা', aiName: 'Bengali', locale: 'bn-BD', flag: '🇧🇩', dir: 'ltr' },
  { code: 'ur', label: 'اردو', aiName: 'Urdu', locale: 'ur-PK', flag: '🇵🇰', dir: 'rtl' },
  { code: 'id', label: 'Bahasa Indonesia', aiName: 'Indonesian', locale: 'id-ID', flag: '🇮🇩', dir: 'ltr' },
  { code: 'ja', label: '日本語', aiName: 'Japanese', locale: 'ja-JP', flag: '🇯🇵', dir: 'ltr' },
  { code: 'ko', label: '한국어', aiName: 'Korean', locale: 'ko-KR', flag: '🇰🇷', dir: 'ltr' },
  { code: 'tr', label: 'Türkçe', aiName: 'Turkish', locale: 'tr-TR', flag: '🇹🇷', dir: 'ltr' },
  { code: 'vi', label: 'Tiếng Việt', aiName: 'Vietnamese', locale: 'vi-VN', flag: '🇻🇳', dir: 'ltr' },
  { code: 'pl', label: 'Polski', aiName: 'Polish', locale: 'pl-PL', flag: '🇵🇱', dir: 'ltr' },
  { code: 'sw', label: 'Kiswahili', aiName: 'Swahili', locale: 'sw-TZ', flag: '🇹🇿', dir: 'ltr' },
  { code: 'th', label: 'ไทย', aiName: 'Thai', locale: 'th-TH', flag: '🇹🇭', dir: 'ltr' },
  { code: 'uk', label: 'Українська', aiName: 'Ukrainian', locale: 'uk-UA', flag: '🇺🇦', dir: 'ltr' },
  { code: 'ro', label: 'Română', aiName: 'Romanian', locale: 'ro-RO', flag: '🇷🇴', dir: 'ltr' },
  { code: 'cs', label: 'Čeština', aiName: 'Czech', locale: 'cs-CZ', flag: '🇨🇿', dir: 'ltr' },
  { code: 'el', label: 'Ελληνικά', aiName: 'Greek', locale: 'el-GR', flag: '🇬🇷', dir: 'ltr' },
  { code: 'sv', label: 'Svenska', aiName: 'Swedish', locale: 'sv-SE', flag: '🇸🇪', dir: 'ltr' },
  { code: 'no', label: 'Norsk', aiName: 'Norwegian', locale: 'nb-NO', flag: '🇳🇴', dir: 'ltr' },
  { code: 'da', label: 'Dansk', aiName: 'Danish', locale: 'da-DK', flag: '🇩🇰', dir: 'ltr' },
  { code: 'fi', label: 'Suomi', aiName: 'Finnish', locale: 'fi-FI', flag: '🇫🇮', dir: 'ltr' },
  { code: 'hu', label: 'Magyar', aiName: 'Hungarian', locale: 'hu-HU', flag: '🇭🇺', dir: 'ltr' },
  { code: 'he', label: 'עברית', aiName: 'Hebrew', locale: 'he-IL', flag: '🇮🇱', dir: 'rtl' },
  { code: 'fa', label: 'فارسی', aiName: 'Persian', locale: 'fa-IR', flag: '🇮🇷', dir: 'rtl' },
  { code: 'ms', label: 'Bahasa Melayu', aiName: 'Malay', locale: 'ms-MY', flag: '🇲🇾', dir: 'ltr' },
  { code: 'tl', label: 'Tagalog', aiName: 'Tagalog', locale: 'fil-PH', flag: '🇵🇭', dir: 'ltr' },
  { code: 'ta', label: 'தமிழ்', aiName: 'Tamil', locale: 'ta-IN', flag: '🇮🇳', dir: 'ltr' },
  { code: 'te', label: 'తెలుగు', aiName: 'Telugu', locale: 'te-IN', flag: '🇮🇳', dir: 'ltr' },
  { code: 'mr', label: 'मराठी', aiName: 'Marathi', locale: 'mr-IN', flag: '🇮🇳', dir: 'ltr' },
  { code: 'gu', label: 'ગુજરાતી', aiName: 'Gujarati', locale: 'gu-IN', flag: '🇮🇳', dir: 'ltr' },
  { code: 'kn', label: 'ಕನ್ನಡ', aiName: 'Kannada', locale: 'kn-IN', flag: '🇮🇳', dir: 'ltr' },
  { code: 'ml', label: 'മലയാളം', aiName: 'Malayalam', locale: 'ml-IN', flag: '🇮🇳', dir: 'ltr' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ', aiName: 'Punjabi', locale: 'pa-IN', flag: '🇮🇳', dir: 'ltr' },
  { code: 'jv', label: 'Basa Jawa', aiName: 'Javanese', locale: 'jv-ID', flag: '🇮🇩', dir: 'ltr' },
  { code: 'my', label: 'မြန်မာ', aiName: 'Burmese', locale: 'my-MM', flag: '🇲🇲', dir: 'ltr' },
  { code: 'km', label: 'ខ្មែរ', aiName: 'Khmer', locale: 'km-KH', flag: '🇰🇭', dir: 'ltr' },
  { code: 'lo', label: 'ລາວ', aiName: 'Lao', locale: 'lo-LA', flag: '🇱🇦', dir: 'ltr' },
  { code: 'si', label: 'සිංහල', aiName: 'Sinhala', locale: 'si-LK', flag: '🇱🇰', dir: 'ltr' },
  { code: 'ne', label: 'नेपाली', aiName: 'Nepali', locale: 'ne-NP', flag: '🇳🇵', dir: 'ltr' },
  { code: 'zu', label: 'Zulu', aiName: 'Zulu', locale: 'zu-ZA', flag: '🇿🇦', dir: 'ltr' },
  { code: 'af', label: 'Afrikaans', aiName: 'Afrikaans', locale: 'af-ZA', flag: '🇿🇦', dir: 'ltr' },
  { code: 'sk', label: 'Slovenčina', aiName: 'Slovak', locale: 'sk-SK', flag: '🇸🇰', dir: 'ltr' },
];

const normalizeGeofence = (input: any): JurisdictionGeofenceConfig => {
  const source = input && typeof input === 'object' ? input : {};
  const points = Array.isArray(source.points)
    ? source.points
        .map((entry: any) => {
          const lat = Number(entry?.lat ?? entry?.latitude);
          const lon = Number(entry?.lon ?? entry?.lng ?? entry?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          return { lat, lon };
        })
        .filter((entry: { lat: number; lon: number } | null): entry is { lat: number; lon: number } => entry !== null)
    : [];

  return {
    enabled: source.enabled === true,
    shape: source.shape === 'polygon' ? 'polygon' : 'circle',
    centerLat: Number.isFinite(Number(source.centerLat)) ? Number(source.centerLat) : undefined,
    centerLon: Number.isFinite(Number(source.centerLon)) ? Number(source.centerLon) : undefined,
    radiusMeters: Number.isFinite(Number(source.radiusMeters)) ? Math.max(1, Number(source.radiusMeters)) : 5000,
    points,
  };
};

interface GeneralSettingsProps {
  view?: GeneralSettingsView;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ view = 'all' }) => {
  const deriveAutoCallbackUrl = () => {
    try {
      const url = new URL(window.location.origin);
      url.pathname = '/verify';
      return url.toString();
    } catch {
      return '/verify';
    }
  };

  const derivePublicFrontendBaseUrl = (callbackUrlInput?: string): string => {
    const fallbackBase = typeof window !== 'undefined' ? window.location.origin : '/';
    try {
      const url = new URL(String(callbackUrlInput || '').trim() || fallbackBase);
      const normalizedPath = (url.pathname || '/').replace(/\/+$/g, '') || '/';
      const matchedCallbackPath = CALLBACK_ROUTE_PATHS.find((path) => normalizedPath.toLowerCase().endsWith(path));
      let publicPath = normalizedPath;
      if (matchedCallbackPath) {
        publicPath = normalizedPath.slice(0, -matchedCallbackPath.length) || '/';
      } else if (/\/admin$/i.test(normalizedPath)) {
        publicPath = normalizedPath.replace(/\/admin$/i, '') || '/';
      }
      url.pathname = publicPath;
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return fallbackBase;
    }
  };

  const validateCallbackPublicBasePath = (callbackUrlInput?: string): string | null => {
    try {
      const publicBaseUrl = derivePublicFrontendBaseUrl(callbackUrlInput);
      const parsed = new URL(publicBaseUrl);
      const publicPath = normalizePublicPath(parsed.pathname, '/');
      if (publicPath === '/admin' || publicPath.startsWith('/admin/')) {
        return 'Die öffentliche Basis-URL darf nicht auf den Admin-Pfad zeigen.';
      }
      if (publicPath === '/api' || publicPath.startsWith('/api/')) {
        return 'Die öffentliche Basis-URL darf nicht auf den API-Pfad zeigen.';
      }
      return null;
    } catch {
      return 'Die öffentliche Basis-URL ist ungültig.';
    }
  };

const [config, setConfig] = useState<GeneralConfig>({
    callbackMode: 'auto',
    callbackUrl: '',
    appName: 'OI App',
    webPush: {
      vapidPublicKey: '',
      vapidPrivateKey: '',
      vapidSubject: 'mailto:noreply@example.com',
    },
    xmppRtc: {
      stunUrls: [],
      turnUrls: [],
      turnUsername: '',
      turnCredential: '',
    },
    maintenanceMode: false,
    maintenanceMessage: '',
    restrictLocations: false,
    allowedLocations: [],
    jurisdictionGeofence: normalizeGeofence(null),
    responsibilityAuthorities: [
      'Ortsgemeinde',
      'Verbandsgemeinde / verbandsfreie Gemeinde',
      'Landkreis / kreisfreie Stadt',
      'Landesbehoerde',
    ],
    defaultLanguage: 'de',
    workflowAbortNotificationEnabled: false,
    workflowAbortRecipientEmail: '',
    workflowAbortRecipientName: '',
    citizenFrontend: {
      intakeWorkflowTemplateId: '',
      tenantId: '',
      emailDoubleOptInTimeoutHours: 48,
      dataRequestTimeoutHours: 72,
      enhancedCategorizationTimeoutHours: 72,
      profiles: [],
      announcementEnabled: false,
      announcementMode: 'banner',
      announcementTitle: '',
      announcementMessage: '',
      announcementSourceHash: '',
      announcementTranslations: {},
    },
    languages: [],
    routing: {
      rootMode: 'platform',
      rootTenantId: '',
      platformPath: '/plattform',
      tenantBasePath: '/c',
    },
  });
  const [autoCallbackUrl, setAutoCallbackUrl] = useState<string>(deriveAutoCallbackUrl());
  const [lastCustomCallbackUrl, setLastCustomCallbackUrl] = useState<string>('');
  const [callbackProtocol, setCallbackProtocol] = useState<CallbackProtocol>('https');
  const [sources, setSources] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeMessage, setPurgeMessage] = useState('');
  const [purgeError, setPurgeError] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [backupError, setBackupError] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [importError, setImportError] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [cleanupDays, setCleanupDays] = useState(90);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState('');
  const [cleanupError, setCleanupError] = useState('');
  const [archiveDays, setArchiveDays] = useState(180);
  const [archiveClosedOnly, setArchiveClosedOnly] = useState(true);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const [translationCacheTtlDays, setTranslationCacheTtlDays] = useState(30);
  const [translationCachePruneNow, setTranslationCachePruneNow] = useState(false);
  const [translationCacheLoading, setTranslationCacheLoading] = useState(false);
  const [translationCacheMessage, setTranslationCacheMessage] = useState('');
  const [translationCacheError, setTranslationCacheError] = useState('');
  const [translationCoverageLoading, setTranslationCoverageLoading] = useState(false);
  const [translationCoverageError, setTranslationCoverageError] = useState('');
  const [translationCoverageMessage, setTranslationCoverageMessage] = useState('');
  const [translationCoverage, setTranslationCoverage] = useState<TranslationCoverageReport | null>(null);
  const [translationCoverageExpandedLanguage, setTranslationCoverageExpandedLanguage] = useState('');
  const [translationCoverageBusyByKey, setTranslationCoverageBusyByKey] = useState<Record<string, boolean>>({});
  const [quickLanguageCode, setQuickLanguageCode] = useState('');
  const [translationLanguages, setTranslationLanguages] = useState<string[]>([]);
  const [translationLoading, setTranslationLoading] = useState<string | null>(null);
  const [translationMessage, setTranslationMessage] = useState('');
  const [translationError, setTranslationError] = useState('');
  const [announcementTranslationLoading, setAnnouncementTranslationLoading] = useState(false);
  const [announcementTranslationStatus, setAnnouncementTranslationStatus] = useState('');
  const [announcementTranslationError, setAnnouncementTranslationError] = useState('');
  const announcementSyncRunRef = useRef(0);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateOption[]>([]);
  const [dbStructureLoading, setDbStructureLoading] = useState(false);
  const [dbStructureError, setDbStructureError] = useState('');
  const [dbStructure, setDbStructure] = useState<DatabaseStructureSummary | null>(null);
  const [updateStatusLoading, setUpdateStatusLoading] = useState(false);
  const [updateStatusError, setUpdateStatusError] = useState('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusSnapshot | null>(null);
  const [updatePreflightLoading, setUpdatePreflightLoading] = useState(false);
  const [updatePreflightError, setUpdatePreflightError] = useState('');
  const [updatePreflight, setUpdatePreflight] = useState<UpdatePreflightReport | null>(null);
  const [updateHistoryLoading, setUpdateHistoryLoading] = useState(false);
  const [updateHistoryError, setUpdateHistoryError] = useState('');
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryItem[]>([]);
  const [updateRunbookLoading, setUpdateRunbookLoading] = useState(false);
  const [updateRunbookError, setUpdateRunbookError] = useState('');
  const [updateRunbook, setUpdateRunbook] = useState<UpdateRunbook | null>(null);
  const [updateRunbookCopied, setUpdateRunbookCopied] = useState<'idle' | 'success' | 'error'>('idle');
  const [updateTargetTag, setUpdateTargetTag] = useState('');
  const [geofenceSourcePlaces, setGeofenceSourcePlaces] = useState('');
  const [geofenceGenerateLoading, setGeofenceGenerateLoading] = useState(false);
  const [geofenceGenerateMessage, setGeofenceGenerateMessage] = useState('');
  const [geofenceGenerateError, setGeofenceGenerateError] = useState('');
  const [vapidGenerating, setVapidGenerating] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const showBase = view === 'all' || view === 'base';
  const showCitizen = view === 'all' || view === 'citizen';
  const showJurisdiction = view === 'all' || view === 'jurisdiction';
  const showLanguages = view === 'all' || view === 'languages';
  const showOperations = view === 'all' || view === 'operations';
  const showMaintenance = view === 'all' || view === 'maintenance';
  const showTopSave = view !== 'maintenance';

  useEffect(() => {
    if (!showMaintenance) return;
    if (!updateStatus && !updateStatusLoading) {
      void fetchUpdateStatus();
    }
    if (updateHistory.length === 0 && !updateHistoryLoading) {
      void fetchUpdateHistory();
    }
  }, [
    showMaintenance,
    updateStatus,
    updateStatusLoading,
    updateHistory.length,
    updateHistoryLoading,
  ]);

  const viewTitle =
    view === 'all'
      ? 'Allgemeine Einstellungen'
      : view === 'base'
        ? 'Basis & Links'
        : view === 'citizen'
          ? 'Bürgerfrontend'
          : view === 'jurisdiction'
            ? 'Zuständigkeit & Geofence'
            : view === 'languages'
              ? 'Sprachen & Übersetzung'
              : view === 'operations'
                ? 'Betriebsalarme'
                : 'Daten & Wartung';
  const viewSubtitle =
    view === 'all'
      ? 'Kategorisiert nach System, Bürgerfrontend, Workflow-Betrieb, Sprachen und Wartung.'
      : 'Teilbereich der allgemeinen Konfiguration.';
  const updatePreflightCheckEntries = Object.entries(updatePreflight?.checks || {});
  const backupHealth = !updateStatus?.backup?.available
    ? 'missing'
    : updateStatus.backup.isFresh
      ? 'healthy'
      : 'stale';
  const migrationHealth = updateStatus?.migrations?.consistent ? 'healthy' : 'error';
  const gitHealth = !updateStatus?.git?.available ? 'error' : updateStatus.git.dirty ? 'warning' : 'healthy';
  const preflightHealth = !updatePreflight ? 'idle' : updatePreflight.ok ? 'healthy' : 'error';

  const normalizeConfiguredLanguages = (
    baseLanguages: LanguageConfig[]
  ): LanguageConfig[] => {
    const map = new Map<string, LanguageConfig>();
    baseLanguages.forEach((lang) => {
      if (!lang?.code) return;
      const normalizedCode = lang.code.toLowerCase();
      const common = COMMON_LANGUAGES.find((entry) => entry.code === normalizedCode);
      map.set(normalizedCode, {
        ...(common || {}),
        ...lang,
        code: normalizedCode,
      });
    });

    return Array.from(map.values());
  };

  const resolveSourceLanguageName = (code: string): string => {
    const normalized = code.toLowerCase();
    const fromConfig = config.languages.find((lang) => lang.code === normalized);
    const fromCommon = COMMON_LANGUAGES.find((lang) => lang.code === normalized);
    return fromConfig?.aiName || fromConfig?.label || fromCommon?.aiName || fromCommon?.label || 'German';
  };

  const buildAnnouncementTranslationPlan = (
    snapshot: GeneralConfig,
    forceAll: boolean
  ): {
    title: string;
    message: string;
    sourceHash: string;
    baseTranslations: GeneralConfig['citizenFrontend']['announcementTranslations'];
    targets: LanguageConfig[];
  } | null => {
    const title = sanitizeAnnouncementText(snapshot.citizenFrontend.announcementTitle, 240);
    const message = sanitizeAnnouncementText(snapshot.citizenFrontend.announcementMessage, 4000);
    const sourceHash = buildAnnouncementSourceHash(title, message);
    if (!snapshot.citizenFrontend.announcementEnabled || !sourceHash || (!title && !message)) return null;

    const defaultCode = (snapshot.defaultLanguage || 'de').toLowerCase();
    const normalizedExisting = normalizeAnnouncementTranslations(
      snapshot.citizenFrontend.announcementTranslations
    );
    const baseTranslations = Object.fromEntries(
      Object.entries(normalizedExisting).filter(([, value]) => {
        if (!value) return false;
        if (value.sourceHash && value.sourceHash !== sourceHash) return false;
        return !!value.title || !!value.message;
      })
    ) as GeneralConfig['citizenFrontend']['announcementTranslations'];
    baseTranslations[defaultCode] = { title, message, sourceHash };

    const languageMap = new Map<string, LanguageConfig>();
    (snapshot.languages || []).forEach((entry) => {
      const code = String(entry?.code || '').trim().toLowerCase();
      if (!code || code === defaultCode || languageMap.has(code)) return;
      languageMap.set(code, { ...entry, code });
    });

    const targets = Array.from(languageMap.values()).filter((entry) => {
      if (forceAll) return true;
      const existing = baseTranslations[entry.code];
      if (!existing) return true;
      if (!existing.title || !existing.message) return true;
      if (existing.sourceHash && existing.sourceHash !== sourceHash) return true;
      return false;
    });

    return { title, message, sourceHash, baseTranslations, targets };
  };

  const translateAnnouncementEntry = async (
    language: LanguageConfig,
    sourceTitle: string,
    sourceMessage: string,
    sourceHash: string,
    sourceLanguageCode: string
  ): Promise<{ code: string; title: string; message: string; sourceHash: string }> => {
    const languageCode = String(language.code || '').toLowerCase();
    if (!languageCode) {
      return { code: '', title: sourceTitle, message: sourceMessage, sourceHash };
    }
    if (languageCode === sourceLanguageCode) {
      return { code: languageCode, title: sourceTitle, message: sourceMessage, sourceHash };
    }

    const titleKey = `citizen_announcement_title_${sourceHash}`;
    const messageKey = `citizen_announcement_message_${sourceHash}`;

    const response = await axios.post('/api/translate', {
      targetLanguage: languageCode,
      targetLanguageName: language.aiName || language.label || languageCode,
      sourceLanguageName: resolveSourceLanguageName(sourceLanguageCode),
      strings: {
        [titleKey]: sourceTitle,
        [messageKey]: sourceMessage,
      },
    });
    const translated = response.data?.translations && typeof response.data.translations === 'object'
      ? (response.data.translations as Record<string, unknown>)
      : {};

    const titleValue = typeof translated[titleKey] === 'string' ? translated[titleKey] : sourceTitle;
    const messageValue = typeof translated[messageKey] === 'string' ? translated[messageKey] : sourceMessage;

    return {
      code: languageCode,
      title: sanitizeAnnouncementText(titleValue, 240),
      message: sanitizeAnnouncementText(messageValue, 4000),
      sourceHash,
    };
  };

  const syncAnnouncementTranslations = async (
    snapshot: GeneralConfig,
    options?: { forceAll?: boolean; interactive?: boolean }
  ) => {
    const currentRun = announcementSyncRunRef.current + 1;
    announcementSyncRunRef.current = currentRun;
    const forceAll = options?.forceAll === true;
    const interactive = options?.interactive === true;
    const plan = buildAnnouncementTranslationPlan(snapshot, forceAll);
    if (!plan) {
      if (interactive) {
        setAnnouncementTranslationStatus('Keine aktive Meldung zum Übersetzen vorhanden.');
        setAnnouncementTranslationError('');
      }
      return;
    }

    const baseTranslations = { ...plan.baseTranslations };
    const defaultCode = (snapshot.defaultLanguage || 'de').toLowerCase();
    if (interactive) {
      setAnnouncementTranslationLoading(true);
      setAnnouncementTranslationStatus(
        plan.targets.length > 0
          ? `Übersetzung für ${plan.targets.length} Sprache(n) wird vorbereitet...`
          : 'Alle vorhandenen Sprachen sind bereits für diese Meldung übersetzt.'
      );
      setAnnouncementTranslationError('');
    }

    try {
      const latestBeforeResponse = await axios.get('/api/admin/config/general', {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });
      const latestBeforeCitizen = latestBeforeResponse.data?.citizenFrontend || {};
      const latestBeforeEnabled = parseBooleanFlag(latestBeforeCitizen.announcementEnabled);
      const latestBeforeTitle = sanitizeAnnouncementText(latestBeforeCitizen.announcementTitle, 240);
      const latestBeforeMessage = sanitizeAnnouncementText(latestBeforeCitizen.announcementMessage, 4000);
      const latestBeforeHash =
        typeof latestBeforeCitizen.announcementSourceHash === 'string' && latestBeforeCitizen.announcementSourceHash.trim()
          ? latestBeforeCitizen.announcementSourceHash.trim().slice(0, 128)
          : buildAnnouncementSourceHash(latestBeforeTitle, latestBeforeMessage);
      if (!latestBeforeEnabled || latestBeforeHash !== plan.sourceHash) {
        if (interactive && announcementSyncRunRef.current === currentRun) {
          setAnnouncementTranslationStatus('Meldung wurde zwischenzeitlich geändert. Bitte erneut übersetzen.');
          setAnnouncementTranslationError('');
        }
        return;
      }

      if (plan.targets.length > 0) {
        const translatedEntries = await Promise.all(
          plan.targets.map((entry) =>
            translateAnnouncementEntry(entry, plan.title, plan.message, plan.sourceHash, defaultCode)
          )
        );
        translatedEntries.forEach((entry) => {
          if (!entry.code) return;
          baseTranslations[entry.code] = {
            title: entry.title,
            message: entry.message,
            sourceHash: entry.sourceHash,
          };
        });
      }

      const latestAfterResponse = await axios.get('/api/admin/config/general', {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });
      const latestAfterCitizen = latestAfterResponse.data?.citizenFrontend || {};
      const latestAfterEnabled = parseBooleanFlag(latestAfterCitizen.announcementEnabled);
      const latestAfterMode = latestAfterCitizen.announcementMode === 'modal' ? 'modal' : 'banner';
      const latestAfterTitle = sanitizeAnnouncementText(latestAfterCitizen.announcementTitle, 240);
      const latestAfterMessage = sanitizeAnnouncementText(latestAfterCitizen.announcementMessage, 4000);
      const latestAfterHash =
        typeof latestAfterCitizen.announcementSourceHash === 'string' && latestAfterCitizen.announcementSourceHash.trim()
          ? latestAfterCitizen.announcementSourceHash.trim().slice(0, 128)
          : buildAnnouncementSourceHash(latestAfterTitle, latestAfterMessage);
      if (!latestAfterEnabled || latestAfterHash !== plan.sourceHash) {
        if (interactive && announcementSyncRunRef.current === currentRun) {
          setAnnouncementTranslationStatus('Meldung wurde zwischenzeitlich geändert. Bitte erneut übersetzen.');
          setAnnouncementTranslationError('');
        }
        return;
      }

      const latestAfterTranslations = normalizeAnnouncementTranslations(latestAfterCitizen.announcementTranslations);
      const mergedTranslations: GeneralConfig['citizenFrontend']['announcementTranslations'] = {
        ...latestAfterTranslations,
        ...baseTranslations,
      };
      mergedTranslations[(latestAfterResponse.data?.defaultLanguage || defaultCode || 'de').toLowerCase()] = {
        title: latestAfterTitle,
        message: latestAfterMessage,
        sourceHash: latestAfterHash,
      };

      const patchPayload = {
        citizenFrontend: {
          announcementEnabled: latestAfterEnabled,
          announcementMode: latestAfterMode,
          announcementTitle: latestAfterTitle,
          announcementMessage: latestAfterMessage,
          announcementSourceHash: latestAfterHash,
          announcementTranslations: mergedTranslations,
        },
      };

      await axios.patch('/api/admin/config/general', patchPayload, {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });

      setConfig((prev) => ({
        ...prev,
        citizenFrontend: {
          ...prev.citizenFrontend,
          announcementEnabled:
            announcementSyncRunRef.current === currentRun ? latestAfterEnabled : prev.citizenFrontend.announcementEnabled,
          announcementMode:
            announcementSyncRunRef.current === currentRun ? latestAfterMode : prev.citizenFrontend.announcementMode,
          announcementTitle:
            announcementSyncRunRef.current === currentRun ? latestAfterTitle : prev.citizenFrontend.announcementTitle,
          announcementMessage:
            announcementSyncRunRef.current === currentRun ? latestAfterMessage : prev.citizenFrontend.announcementMessage,
          announcementSourceHash:
            announcementSyncRunRef.current === currentRun ? latestAfterHash : prev.citizenFrontend.announcementSourceHash,
          announcementTranslations:
            announcementSyncRunRef.current === currentRun ? mergedTranslations : prev.citizenFrontend.announcementTranslations,
        },
      }));

      if (interactive && announcementSyncRunRef.current === currentRun) {
        setAnnouncementTranslationStatus(
          plan.targets.length > 0
            ? `Meldung wurde für ${plan.targets.length} Sprache(n) vorbereitet.`
            : 'Meldung war bereits vollständig übersetzt.'
        );
        setAnnouncementTranslationError('');
      }
    } finally {
      if (interactive && announcementSyncRunRef.current === currentRun) {
        setAnnouncementTranslationLoading(false);
      }
    }
  };

  const refreshTranslationLanguageCodes = async (): Promise<string[]> => {
    try {
      const translationRes = await axios.get('/api/translate/languages');
      const codes = Array.isArray(translationRes.data?.languages)
        ? translationRes.data.languages.map((code: string) => String(code || '').toLowerCase()).filter(Boolean)
        : [];
      setTranslationLanguages(codes);
      return codes;
    } catch {
      setTranslationLanguages([]);
      return [];
    }
  };

  const fetchTranslationCoverage = async (silent = false) => {
    if (!silent) {
      setTranslationCoverageLoading(true);
    }
    setTranslationCoverageError('');
    try {
      const response = await axios.get('/api/admin/translation-planner/coverage', {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });
      const nextCoverage: TranslationCoverageReport = response.data;
      setTranslationCoverage(nextCoverage);
      const availableLanguages = Array.isArray(nextCoverage?.languages)
        ? nextCoverage.languages.map((entry) => entry.language)
        : [];
      if (
        translationCoverageExpandedLanguage &&
        availableLanguages.includes(translationCoverageExpandedLanguage)
      ) {
        // keep selection
      } else {
        setTranslationCoverageExpandedLanguage(availableLanguages[0] || '');
      }
    } catch (error: any) {
      setTranslationCoverageError(
        error?.response?.data?.message || 'Übersetzungsabdeckung konnte nicht geladen werden.'
      );
      setTranslationCoverage(null);
    } finally {
      if (!silent) {
        setTranslationCoverageLoading(false);
      }
    }
  };

  const fetchDatabaseStructure = async (silent = false) => {
    if (!silent) {
      setDbStructureLoading(true);
    }
    setDbStructureError('');
    try {
      const response = await axios.get('/api/admin/maintenance/database-structure', {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });
      setDbStructure(response.data as DatabaseStructureSummary);
    } catch (error: any) {
      setDbStructureError(error?.response?.data?.message || 'DB-Struktur konnte nicht geladen werden.');
      setDbStructure(null);
    } finally {
      if (!silent) {
        setDbStructureLoading(false);
      }
    }
  };

  const fetchUpdateStatus = async (
    options?: {
      silent?: boolean;
      record?: boolean;
    }
  ) => {
    const silent = options?.silent === true;
    const record = options?.record === true;
    if (!silent) {
      setUpdateStatusLoading(true);
    }
    setUpdateStatusError('');
    try {
      const response = await axios.get('/api/admin/system/update/status', {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        params: record ? { record: true } : undefined,
      });
      setUpdateStatus(response.data as UpdateStatusSnapshot);
      const suggestedTag = String(response.data?.latestTagVersion || '').trim();
      if (suggestedTag && !updateTargetTag.trim()) {
        setUpdateTargetTag(suggestedTag);
      }
      if (record) {
        await fetchUpdateHistory(true);
      }
    } catch (error: any) {
      setUpdateStatusError(error?.response?.data?.message || 'Update-Status konnte nicht geladen werden.');
      setUpdateStatus(null);
    } finally {
      if (!silent) {
        setUpdateStatusLoading(false);
      }
    }
  };

  const runUpdatePreflight = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setUpdatePreflightLoading(true);
    }
    setUpdatePreflightError('');
    try {
      const response = await axios.post(
        '/api/admin/system/update/preflight',
        {},
        {
          headers: { Authorization: `Bearer ${getAdminToken()}` },
        }
      );
      setUpdatePreflight(response.data as UpdatePreflightReport);
      await fetchUpdateStatus({ silent: true });
      await fetchUpdateHistory(true);
    } catch (error: any) {
      setUpdatePreflightError(error?.response?.data?.message || 'Preflight konnte nicht ausgeführt werden.');
    } finally {
      if (!silent) {
        setUpdatePreflightLoading(false);
      }
    }
  };

  const fetchUpdateRunbook = async () => {
    setUpdateRunbookLoading(true);
    setUpdateRunbookError('');
    setUpdateRunbookCopied('idle');
    try {
      const response = await axios.get('/api/admin/system/update/runbook', {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        params: {
          targetTag: updateTargetTag.trim() || undefined,
        },
      });
      setUpdateRunbook(response.data as UpdateRunbook);
    } catch (error: any) {
      setUpdateRunbookError(error?.response?.data?.message || 'Runbook konnte nicht geladen werden.');
      setUpdateRunbook(null);
    } finally {
      setUpdateRunbookLoading(false);
    }
  };

  const fetchUpdateHistory = async (silent = false) => {
    if (!silent) {
      setUpdateHistoryLoading(true);
    }
    setUpdateHistoryError('');
    try {
      const response = await axios.get('/api/admin/system/update/history', {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        params: { limit: 20 },
      });
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      setUpdateHistory(
        items.map((entry: any) => ({
          id: String(entry?.id || ''),
          createdAt: entry?.createdAt ? String(entry.createdAt) : null,
          username: entry?.username ? String(entry.username) : null,
          adminUserId: entry?.adminUserId ? String(entry.adminUserId) : null,
          report: (entry?.report || {}) as UpdatePreflightReport,
        }))
      );
    } catch (error: any) {
      setUpdateHistoryError(error?.response?.data?.message || 'Update-Historie konnte nicht geladen werden.');
      setUpdateHistory([]);
    } finally {
      if (!silent) {
        setUpdateHistoryLoading(false);
      }
    }
  };

  const copyUpdateRunbook = async () => {
    if (!updateRunbook?.commands?.length) return;
    try {
      await navigator.clipboard.writeText(updateRunbook.commands.join('\n'));
      setUpdateRunbookCopied('success');
      window.setTimeout(() => setUpdateRunbookCopied('idle'), 2200);
    } catch {
      setUpdateRunbookCopied('error');
      window.setTimeout(() => setUpdateRunbookCopied('idle'), 2200);
    }
  };

  const fetchConfig = async () => {
    try {
      const response = await axios.get('/api/admin/config/general', {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });
      const { sources: sourceInfo, ...rest } = response.data || {};
      const translationCodes = await refreshTranslationLanguageCodes();
      try {
        const policyRes = await axios.get('/api/admin/maintenance/translation-cache-policy', {
          headers: {
            Authorization: `Bearer ${getAdminToken()}`,
          },
        });
        const ttl = Number(policyRes.data?.ttlDays);
        setTranslationCacheTtlDays(Number.isFinite(ttl) ? Math.max(1, Math.min(3650, Math.floor(ttl))) : 30);
      } catch {
        setTranslationCacheTtlDays(30);
      }
      try {
        const templateRes = await axios.get('/api/admin/config/workflow/templates', {
          headers: {
            Authorization: `Bearer ${getAdminToken()}`,
          },
        });
        const templates = Array.isArray(templateRes.data)
          ? templateRes.data
              .map((entry: any) => ({
                id: String(entry?.id || '').trim(),
                name: String(entry?.name || entry?.id || '').trim(),
                enabled: entry?.enabled !== false,
              }))
              .filter((entry: WorkflowTemplateOption) => entry.id && entry.name)
          : [];
        setWorkflowTemplates(templates);
      } catch {
        setWorkflowTemplates([]);
      }
      try {
        const tenantRes = await axios.get('/api/admin/tenants', {
          headers: {
            Authorization: `Bearer ${getAdminToken()}`,
          },
        });
        const nextTenants: TenantOption[] = Array.isArray(tenantRes.data)
          ? tenantRes.data
              .map((entry: any) => ({
                id: String(entry?.id || '').trim(),
                name: String(entry?.name || '').trim(),
                slug: typeof entry?.slug === 'string' ? entry.slug.trim() : '',
                active: entry?.active !== false,
              }))
              .filter((entry: TenantOption) => !!entry.id && !!entry.name)
              .sort((a: TenantOption, b: TenantOption) =>
                a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })
              )
          : [];
        setTenantOptions(nextTenants);
      } catch {
        setTenantOptions([]);
      }

      const mergedLanguages = normalizeConfiguredLanguages(
        Array.isArray(rest.languages) ? rest.languages : []
      );

      let nextDefaultLanguage = (rest.defaultLanguage || 'de').toLowerCase();
      if (mergedLanguages.length > 0 && !mergedLanguages.some((lang) => lang.code === nextDefaultLanguage)) {
        nextDefaultLanguage = mergedLanguages[0].code;
      }

      const citizenFrontendIntakeWorkflowTemplateId = String(rest.citizenFrontend?.intakeWorkflowTemplateId || '').trim();
      const citizenFrontendTenantId = sanitizeCitizenFrontendTenantId(rest.citizenFrontend?.tenantId);
      const nextRoutingRootMode =
        String(rest.routing?.rootMode || '').trim().toLowerCase() === 'tenant' ? 'tenant' : 'platform';
      const nextRoutingRootTenantId = sanitizeCitizenFrontendTenantId(rest.routing?.rootTenantId);
      const nextRoutingPlatformPath = sanitizeRoutingPlatformPath(rest.routing?.platformPath);
      setConfig({
        callbackMode: rest.callbackMode === 'custom' ? 'custom' : 'auto',
        callbackUrl: rest.callbackUrl || '',
        appName: rest.appName || 'OI App',
        webPush: {
          vapidPublicKey: String(rest.webPush?.vapidPublicKey || '').trim(),
          vapidPrivateKey: String(rest.webPush?.vapidPrivateKey || '').trim(),
          vapidSubject: String(rest.webPush?.vapidSubject || 'mailto:noreply@example.com').trim(),
        },
        xmppRtc: {
          stunUrls: Array.isArray(rest.xmppRtc?.stunUrls)
            ? rest.xmppRtc.stunUrls.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
            : [],
          turnUrls: Array.isArray(rest.xmppRtc?.turnUrls)
            ? rest.xmppRtc.turnUrls.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
            : [],
          turnUsername: String(rest.xmppRtc?.turnUsername || '').trim(),
          turnCredential: String(rest.xmppRtc?.turnCredential || '').trim(),
        },
        maintenanceMode: !!rest.maintenanceMode,
        maintenanceMessage: rest.maintenanceMessage || '',
        restrictLocations: !!rest.restrictLocations,
        allowedLocations: Array.isArray(rest.allowedLocations) ? rest.allowedLocations : [],
        jurisdictionGeofence: normalizeGeofence(rest.jurisdictionGeofence),
        responsibilityAuthorities: Array.isArray(rest.responsibilityAuthorities)
          ? rest.responsibilityAuthorities
              .map((entry: unknown) => String(entry || '').trim())
              .filter(Boolean)
          : [
              'Ortsgemeinde',
              'Verbandsgemeinde / verbandsfreie Gemeinde',
              'Landkreis / kreisfreie Stadt',
              'Landesbehoerde',
            ],
        defaultLanguage: nextDefaultLanguage,
        workflowAbortNotificationEnabled: !!rest.workflowAbortNotificationEnabled,
        workflowAbortRecipientEmail: rest.workflowAbortRecipientEmail || '',
        workflowAbortRecipientName: rest.workflowAbortRecipientName || '',
        citizenFrontend: {
          intakeWorkflowTemplateId: citizenFrontendIntakeWorkflowTemplateId,
          tenantId: citizenFrontendTenantId,
          emailDoubleOptInTimeoutHours: Number(rest.citizenFrontend?.emailDoubleOptInTimeoutHours || 48),
          dataRequestTimeoutHours: Number(rest.citizenFrontend?.dataRequestTimeoutHours || 72),
          enhancedCategorizationTimeoutHours: Number(rest.citizenFrontend?.enhancedCategorizationTimeoutHours || 72),
          profiles: normalizeCitizenFrontendProfiles(
            rest.citizenFrontend?.profiles,
            citizenFrontendIntakeWorkflowTemplateId,
            citizenFrontendTenantId
          ),
          announcementEnabled: parseBooleanFlag(rest.citizenFrontend?.announcementEnabled),
          announcementMode: rest.citizenFrontend?.announcementMode === 'modal' ? 'modal' : 'banner',
          announcementTitle: sanitizeAnnouncementText(rest.citizenFrontend?.announcementTitle, 240),
          announcementMessage: sanitizeAnnouncementText(rest.citizenFrontend?.announcementMessage, 4000),
          announcementSourceHash:
            typeof rest.citizenFrontend?.announcementSourceHash === 'string'
              ? rest.citizenFrontend.announcementSourceHash.trim().slice(0, 128)
              : '',
          announcementTranslations: normalizeAnnouncementTranslations(rest.citizenFrontend?.announcementTranslations),
        },
        languages: mergedLanguages,
        routing: {
          rootMode: nextRoutingRootMode,
          rootTenantId: nextRoutingRootTenantId,
          platformPath: nextRoutingPlatformPath,
          tenantBasePath: '/c',
        },
      });
      if (!geofenceSourcePlaces.trim() && Array.isArray(rest.allowedLocations) && rest.allowedLocations.length > 0) {
        setGeofenceSourcePlaces(
          rest.allowedLocations
            .map((entry: unknown) => String(entry || '').trim())
            .filter(Boolean)
            .join('\n')
        );
      }
      if (rest.callbackMode === 'auto' && rest.callbackUrl) {
        setAutoCallbackUrl(rest.callbackUrl);
      }
      if (rest.callbackMode === 'custom' && rest.callbackUrl) {
        setLastCustomCallbackUrl(rest.callbackUrl);
      }
      const loadedCallbackCandidate =
        rest.callbackMode === 'custom'
          ? rest.callbackUrl || ''
          : rest.callbackUrl || deriveAutoCallbackUrl();
      setCallbackProtocol(detectCallbackProtocol(loadedCallbackCandidate));
      setSources(sourceInfo || {});
      setTranslationLanguages(translationCodes.map((code: string) => code.toLowerCase()));
      if (showLanguages) {
        void fetchTranslationCoverage();
      }
      if (showMaintenance) {
        void fetchDatabaseStructure();
        void fetchUpdateStatus({ silent: true });
        void fetchUpdateHistory(true);
      }
    } catch (error) {
      // If endpoint doesn't exist yet, use defaults
      console.log('General config endpoint not yet available');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    if (name === 'callbackUrl') {
      const normalized = normalizeCallbackUrlInput(value, callbackProtocol);
      setLastCustomCallbackUrl(normalized);
      setCallbackProtocol(detectCallbackProtocol(normalized || value));
      setConfig((prev) => ({
        ...prev,
        callbackUrl: normalized,
      }));
      return;
    }
    setConfig((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleGenerateVapidKeys = async () => {
    try {
      setVapidGenerating(true);
      setMessage('');
      const response = await axios.post(
        '/api/admin/config/general/web-push/vapid/generate',
        {
          persist: true,
          subject: config.webPush.vapidSubject || 'mailto:noreply@example.com',
        },
        {
          headers: {
            Authorization: `Bearer ${getAdminToken()}`,
          },
        }
      );
      const nextWebPush = response.data?.webPush || {};
      setConfig((prev) => ({
        ...prev,
        webPush: {
          vapidPublicKey: String(nextWebPush.vapidPublicKey || '').trim(),
          vapidPrivateKey: String(nextWebPush.vapidPrivateKey || '').trim(),
          vapidSubject: String(nextWebPush.vapidSubject || prev.webPush.vapidSubject || 'mailto:noreply@example.com').trim(),
        },
      }));
      setMessageType('success');
      setMessage(response.data?.message || 'VAPID-Schlüssel wurden generiert.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'VAPID-Schlüssel konnten nicht generiert werden.');
    } finally {
      setVapidGenerating(false);
    }
  };

  const effectiveCallbackUrl = config.callbackMode === 'custom'
    ? config.callbackUrl
    : (autoCallbackUrl || deriveAutoCallbackUrl());
  const callbackBaseCandidate = config.callbackMode === 'custom' ? config.callbackUrl : effectiveCallbackUrl;
  const effectivePublicFrontendBaseUrl = derivePublicFrontendBaseUrl(callbackBaseCandidate);
  let effectivePublicOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  let effectivePublicBasePath = '/';
  try {
    const parsed = new URL(effectivePublicFrontendBaseUrl);
    effectivePublicOrigin = parsed.origin;
    effectivePublicBasePath = normalizePublicPath(parsed.pathname, '/');
  } catch {
    effectivePublicBasePath = '/';
  }
  const normalizedPlatformPathPreview = sanitizeRoutingPlatformPath(config.routing.platformPath);
  const rootTenantOption = tenantOptions.find((entry) => entry.id === config.routing.rootTenantId);
  const rootTenantSlug = sanitizeTenantSlug(rootTenantOption?.slug || '');
  const defaultTenantOption = tenantOptions.find((entry) => entry.id === config.citizenFrontend.tenantId);
  const defaultTenantSlug = sanitizeTenantSlug(defaultTenantOption?.slug || '');
  const tenantBasePath = '/c';
  const resolveTenantSlugById = (tenantIdInput?: string): string => {
    const tenantId = sanitizeCitizenFrontendTenantId(tenantIdInput);
    if (!tenantId) return '';
    const tenant = tenantOptions.find((entry) => entry.id === tenantId);
    return sanitizeTenantSlug(tenant?.slug || '');
  };
  const buildTenantCanonicalBasePath = (tenantSlugInput?: string): string => {
    const tenantSlug = sanitizeTenantSlug(tenantSlugInput);
    if (!tenantSlug) {
      return config.routing.rootMode === 'tenant' ? '/' : `${tenantBasePath}/<tenant-slug>`;
    }
    if (config.routing.rootMode === 'tenant' && rootTenantSlug && tenantSlug === rootTenantSlug) {
      return '/';
    }
    return `${tenantBasePath}/${tenantSlug}`;
  };
  const tenantCanonicalPreview = `${tenantBasePath}/<tenant-slug>`;
  const tenantRootPreview = rootTenantSlug
    ? buildTenantCanonicalBasePath(rootTenantSlug)
    : config.routing.rootMode === 'tenant'
      ? '/'
      : tenantCanonicalPreview;
  const defaultTenantCanonicalBasePath = defaultTenantSlug
    ? buildTenantCanonicalBasePath(defaultTenantSlug)
    : (config.routing.rootMode === 'tenant' ? '/' : tenantCanonicalPreview);
  const platformRootPreview = config.routing.rootMode === 'platform' ? '/' : normalizedPlatformPathPreview;
  const platformAltPreview = config.routing.rootMode === 'platform' ? normalizedPlatformPathPreview : '/';
  const callbackPathValidationMessage = validateCallbackPublicBasePath(callbackBaseCandidate);
  const platformPathValidationMessage = validatePlatformPathConsistency(normalizedPlatformPathPreview, tenantBasePath);
  const rootTenantMissingSlug =
    config.routing.rootMode === 'tenant' && !!config.routing.rootTenantId && !rootTenantSlug;
  const callbackVerifyPreview = `${effectivePublicOrigin}${joinPublicPath(effectivePublicBasePath, '/verify')}`;
  const callbackStatusPreview = `${effectivePublicOrigin}${joinPublicPath(effectivePublicBasePath, '/status')}`;
  const callbackWorkflowPreview = `${effectivePublicOrigin}${joinPublicPath(effectivePublicBasePath, '/workflow/confirm')}`;
  const callbackDataRequestPreview =
    `${effectivePublicOrigin}${joinPublicPath(effectivePublicBasePath, '/workflow/data-request')}`;
  const callbackCanonicalVerifyPreview =
    `${effectivePublicOrigin}${joinPublicPath(defaultTenantCanonicalBasePath, '/verify')}`;
  const pwaRootScopePreview = toScopePath(tenantRootPreview);
  const pwaTenantScopePreview = toScopePath(tenantCanonicalPreview);

  const handleCallbackModeChange = (mode: 'auto' | 'custom') => {
    if (mode === 'auto') {
      if (config.callbackMode === 'custom' && config.callbackUrl.trim()) {
        setLastCustomCallbackUrl(config.callbackUrl.trim());
      }
      setConfig((prev) => ({ ...prev, callbackMode: 'auto' }));
      return;
    }

    const baseValue =
      normalizeCallbackUrlInput(lastCustomCallbackUrl || config.callbackUrl || '', callbackProtocol) ||
      forceCallbackProtocol(deriveAutoCallbackUrl(), callbackProtocol);
    setCallbackProtocol(detectCallbackProtocol(baseValue));
    setConfig((prev) => ({
      ...prev,
      callbackMode: 'custom',
      callbackUrl: baseValue || prev.callbackUrl || '',
    }));
  };

  const handleCallbackProtocolChange = (protocol: CallbackProtocol) => {
    setCallbackProtocol(protocol);
    if (config.callbackMode !== 'custom') return;
    const forcedUrl = forceCallbackProtocol(
      config.callbackUrl || lastCustomCallbackUrl || deriveAutoCallbackUrl(),
      protocol
    );
    setLastCustomCallbackUrl(forcedUrl);
    setConfig((prev) => ({
      ...prev,
      callbackUrl: forcedUrl,
    }));
  };

  const handleToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: checked,
    }));
  };

  const handleCitizenFrontendChange = <K extends keyof GeneralConfig['citizenFrontend']>(
    key: K,
    value: GeneralConfig['citizenFrontend'][K]
  ) => {
    setConfig((prev) => ({
      ...prev,
      citizenFrontend: {
        ...prev.citizenFrontend,
        [key]: value,
      },
    }));
  };

  const handleCitizenFrontendProfileChange = (
    index: number,
    patch: Partial<CitizenFrontendProfileConfig>
  ) => {
    setConfig((prev) => {
      const nextProfiles = [...prev.citizenFrontend.profiles];
      const current = nextProfiles[index];
      if (!current) return prev;

      const rawToken =
        patch.token !== undefined ? patch.token : current.token;
      const rawName =
        patch.name !== undefined ? patch.name : current.name;
      const rawTenantId =
        patch.tenantId !== undefined ? patch.tenantId : current.tenantId;
      const rawIntakeWorkflowTemplateId =
        patch.intakeWorkflowTemplateId !== undefined
          ? patch.intakeWorkflowTemplateId
          : current.intakeWorkflowTemplateId;
      const rawAuthenticatedIntakeWorkflowTemplateId =
        patch.authenticatedIntakeWorkflowTemplateId !== undefined
          ? patch.authenticatedIntakeWorkflowTemplateId
          : current.authenticatedIntakeWorkflowTemplateId;
      const rawCitizenAuthEnabled =
        patch.citizenAuthEnabled !== undefined
          ? patch.citizenAuthEnabled
          : current.citizenAuthEnabled;
      const rawEnabled =
        patch.enabled !== undefined ? patch.enabled : current.enabled;
      const rawHeaderTag =
        patch.headerTag !== undefined ? patch.headerTag : current.headerTag;
      const rawHeaderKicker =
        patch.headerKicker !== undefined ? patch.headerKicker : current.headerKicker;
      const rawHeaderTitle =
        patch.headerTitle !== undefined ? patch.headerTitle : current.headerTitle;
      const rawHeaderSubtitle =
        patch.headerSubtitle !== undefined ? patch.headerSubtitle : current.headerSubtitle;
      const rawSubmissionKicker =
        patch.submissionKicker !== undefined ? patch.submissionKicker : current.submissionKicker;
      const rawSubmissionTitle =
        patch.submissionTitle !== undefined ? patch.submissionTitle : current.submissionTitle;
      const rawSubmissionSubtitle =
        patch.submissionSubtitle !== undefined ? patch.submissionSubtitle : current.submissionSubtitle;

      nextProfiles[index] = {
        ...current,
        name: sanitizeCitizenFrontendProfileName(rawName, current.name || `Profil ${index + 1}`),
        token: sanitizeCitizenFrontendProfileToken(rawToken),
        tenantId: sanitizeCitizenFrontendTenantId(rawTenantId),
        intakeWorkflowTemplateId: String(rawIntakeWorkflowTemplateId || '').trim(),
        authenticatedIntakeWorkflowTemplateId: String(rawAuthenticatedIntakeWorkflowTemplateId || '').trim(),
        citizenAuthEnabled: !!rawCitizenAuthEnabled,
        enabled: !!rawEnabled,
        headerTag: sanitizeCitizenFrontendProfileText(rawHeaderTag, 80),
        headerKicker: sanitizeCitizenFrontendProfileText(rawHeaderKicker, 120),
        headerTitle: sanitizeCitizenFrontendProfileText(rawHeaderTitle, 160),
        headerSubtitle: sanitizeCitizenFrontendProfileText(rawHeaderSubtitle, 240),
        submissionKicker: sanitizeCitizenFrontendProfileText(rawSubmissionKicker, 120),
        submissionTitle: sanitizeCitizenFrontendProfileText(rawSubmissionTitle, 160),
        submissionSubtitle: sanitizeCitizenFrontendProfileText(rawSubmissionSubtitle, 400),
      };

      return {
        ...prev,
        citizenFrontend: {
          ...prev.citizenFrontend,
          profiles: nextProfiles,
        },
      };
    });
  };

  const addCitizenFrontendProfile = () => {
    setConfig((prev) => {
      const nextId = buildNextCitizenFrontendProfileId(prev.citizenFrontend.profiles);
      const nextToken = buildNextCitizenFrontendProfileToken(prev.citizenFrontend.profiles);
      return {
        ...prev,
        citizenFrontend: {
          ...prev.citizenFrontend,
          profiles: [
            ...prev.citizenFrontend.profiles,
            {
              id: nextId,
              name: `Profil ${prev.citizenFrontend.profiles.length + 1}`,
              token: nextToken,
              tenantId: prev.citizenFrontend.tenantId,
              intakeWorkflowTemplateId: prev.citizenFrontend.intakeWorkflowTemplateId,
              authenticatedIntakeWorkflowTemplateId: '',
              citizenAuthEnabled: false,
              enabled: true,
              headerTag: '',
              headerKicker: '',
              headerTitle: '',
              headerSubtitle: '',
              submissionKicker: '',
              submissionTitle: '',
              submissionSubtitle: '',
            },
          ],
        },
      };
    });
  };

  const removeCitizenFrontendProfile = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      citizenFrontend: {
        ...prev.citizenFrontend,
        profiles: prev.citizenFrontend.profiles.filter((_, profileIndex) => profileIndex !== index),
      },
    }));
  };

  const regenerateCitizenFrontendProfileToken = (index: number) => {
    setConfig((prev) => {
      const nextProfiles = [...prev.citizenFrontend.profiles];
      const current = nextProfiles[index];
      if (!current) return prev;
      const profilesWithoutCurrent = nextProfiles.filter((_, profileIndex) => profileIndex !== index);
      nextProfiles[index] = {
        ...current,
        token: buildNextCitizenFrontendProfileToken(profilesWithoutCurrent),
      };
      return {
        ...prev,
        citizenFrontend: {
          ...prev.citizenFrontend,
          profiles: nextProfiles,
        },
      };
    });
  };

  const buildCitizenFrontendProfileUrl = (token: string, tenantIdInput?: string): string => {
    const normalizedToken = sanitizeCitizenFrontendProfileToken(token);
    if (!normalizedToken) return '';
    try {
      const tenantSlug = resolveTenantSlugById(tenantIdInput || config.citizenFrontend.tenantId);
      const canonicalBasePath = buildTenantCanonicalBasePath(tenantSlug);
      const url = new URL(effectivePublicOrigin || window.location.origin);
      url.pathname = normalizePublicPath(canonicalBasePath, '/');
      url.search = '';
      url.hash = '';
      url.searchParams.set('frontendToken', normalizedToken);
      return url.toString();
    } catch {
      const tenantSlug = resolveTenantSlugById(tenantIdInput || config.citizenFrontend.tenantId);
      const canonicalBasePath = buildTenantCanonicalBasePath(tenantSlug);
      const fallbackPath = normalizePublicPath(canonicalBasePath, '/');
      return `${fallbackPath}?frontendToken=${encodeURIComponent(normalizedToken)}`;
    }
  };

  const handleAllowedLocationChange = (index: number, value: string) => {
    setConfig((prev) => {
      const next = [...prev.allowedLocations];
      next[index] = value;
      return { ...prev, allowedLocations: next };
    });
  };

  const addAllowedLocation = () => {
    setConfig((prev) => ({
      ...prev,
      allowedLocations: [...prev.allowedLocations, ''],
    }));
  };

  const handleResponsibilityAuthorityChange = (index: number, value: string) => {
    setConfig((prev) => {
      const next = [...(prev.responsibilityAuthorities || [])];
      next[index] = value;
      return { ...prev, responsibilityAuthorities: next };
    });
  };

  const addResponsibilityAuthority = () => {
    setConfig((prev) => ({
      ...prev,
      responsibilityAuthorities: [...(prev.responsibilityAuthorities || []), ''],
    }));
  };

  const removeResponsibilityAuthority = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      responsibilityAuthorities: (prev.responsibilityAuthorities || []).filter((_, i) => i !== index),
    }));
  };

  const removeAllowedLocation = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      allowedLocations: prev.allowedLocations.filter((_, i) => i !== index),
    }));
  };

  const updateGeofence = (patch: Partial<JurisdictionGeofenceConfig>) => {
    setConfig((prev) => ({
      ...prev,
      jurisdictionGeofence: {
        ...prev.jurisdictionGeofence,
        ...patch,
      },
    }));
  };

  const updateGeofencePoint = (index: number, field: 'lat' | 'lon', value: string) => {
    const parsed = Number(value);
    setConfig((prev) => {
      const points = [...(prev.jurisdictionGeofence.points || [])];
      const current = points[index] || { lat: 0, lon: 0 };
      points[index] = {
        ...current,
        [field]: Number.isFinite(parsed) ? parsed : current[field],
      };
      return {
        ...prev,
        jurisdictionGeofence: {
          ...prev.jurisdictionGeofence,
          points,
        },
      };
    });
  };

  const addGeofencePoint = () => {
    setConfig((prev) => ({
      ...prev,
      jurisdictionGeofence: {
        ...prev.jurisdictionGeofence,
        points: [...(prev.jurisdictionGeofence.points || []), { lat: 49.446, lon: 7.759 }],
      },
    }));
  };

  const removeGeofencePoint = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      jurisdictionGeofence: {
        ...prev.jurisdictionGeofence,
        points: (prev.jurisdictionGeofence.points || []).filter((_, i) => i !== index),
      },
    }));
  };

  const generateGeofenceFromPlaces = async () => {
    const places = geofenceSourcePlaces
      .split(/[\n,;]+/)
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
    if (places.length === 0) {
      setGeofenceGenerateError('Bitte mindestens einen Ort angeben.');
      setGeofenceGenerateMessage('');
      return;
    }

    setGeofenceGenerateLoading(true);
    setGeofenceGenerateError('');
    setGeofenceGenerateMessage('');
    try {
      const response = await axios.post(
        '/api/admin/config/general/jurisdiction-geofence/generate',
        {
          places,
          countryCode: 'de',
          stateHint: 'Rheinland-Pfalz',
          mergeMode: 'convex_hull',
        },
        {
          headers: {
            Authorization: `Bearer ${getAdminToken()}`,
          },
        }
      );
      const generatedGeofence = normalizeGeofence(response.data?.geofence);
      setConfig((prev) => ({
        ...prev,
        restrictLocations: true,
        jurisdictionGeofence: {
          ...generatedGeofence,
          enabled: true,
          shape: 'polygon',
          points: Array.isArray(generatedGeofence.points) ? generatedGeofence.points : [],
        },
        allowedLocations:
          prev.allowedLocations.length > 0
            ? prev.allowedLocations
            : places,
      }));
      setGeofenceGenerateMessage(
        response.data?.message || 'Geofence wurde aus den angegebenen Orten erzeugt.'
      );
    } catch (error: any) {
      setGeofenceGenerateError(
        error?.response?.data?.message || 'Geofence konnte nicht automatisch erzeugt werden.'
      );
    } finally {
      setGeofenceGenerateLoading(false);
    }
  };

  const handleLanguageChange = (index: number, field: keyof LanguageConfig, value: string) => {
    setConfig((prev) => {
      const next = [...prev.languages];
      const current = next[index] || { code: '', label: '', dir: 'ltr' };
      next[index] = { ...current, [field]: value };
      return { ...prev, languages: next };
    });
  };

  const addLanguage = () => {
    setConfig((prev) => ({
      ...prev,
      languages: [...prev.languages, { code: '', label: '', aiName: '', locale: '', dir: 'ltr', flag: '' }],
    }));
  };

  const removeLanguage = (index: number) => {
    setConfig((prev) => {
      const next = prev.languages.filter((_, i) => i !== index);
      return { ...prev, languages: next };
    });
  };

  const generateTranslationsForLanguage = async (language: LanguageConfig) => {
    if (!language?.code) return;
    const targetCode = language.code.toLowerCase();
    const targetName = language.aiName || language.label || language.code;
    setTranslationLoading(targetCode);
    setTranslationMessage('');
    setTranslationError('');
    try {
      await axios.post('/api/translate', {
        targetLanguage: targetCode,
        targetLanguageName: targetName,
        sourceLanguageName: resolveSourceLanguageName(config.defaultLanguage || 'de'),
        strings: CITIZEN_STRINGS,
      });
      setTranslationMessage(`Übersetzungen für ${language.label || targetCode} erzeugt`);
      await refreshTranslationLanguageCodes();
      if (showLanguages) {
        void fetchTranslationCoverage(true);
      }

      const announcementSnapshot: GeneralConfig = {
        ...config,
        languages: (() => {
          const current = config.languages || [];
          const normalizedTargetCode = targetCode.toLowerCase();
          if (current.some((entry) => entry.code === normalizedTargetCode)) return current;
          return [...current, { ...language, code: normalizedTargetCode }];
        })(),
      };
      if (announcementSnapshot.citizenFrontend.announcementEnabled) {
        void syncAnnouncementTranslations(announcementSnapshot, { forceAll: false, interactive: false }).catch(
          () => {
            // ignore background translation errors here
          }
        );
      }
    } catch (error: any) {
      setTranslationError(error.response?.data?.error || 'Fehler beim Erzeugen der Übersetzungen');
    } finally {
      setTranslationLoading(null);
    }
  };

  const handleQuickAddLanguage = () => {
    if (!quickLanguageCode) return;
    const selected = COMMON_LANGUAGES.find((lang) => lang.code === quickLanguageCode);
    if (!selected) return;

    setConfig((prev) => {
      const existsIndex = prev.languages.findIndex((lang) => lang.code === selected.code);
      if (existsIndex !== -1) {
        const next = [...prev.languages];
        next[existsIndex] = { ...selected, ...next[existsIndex] };
        return { ...prev, languages: next };
      }
      return { ...prev, languages: [...prev.languages, selected] };
    });

    setQuickLanguageCode('');
    generateTranslationsForLanguage(selected);
  };

  const handleSave = async () => {
    if (config.callbackMode === 'custom') {
      if (!config.callbackUrl.trim()) {
        setMessageType('error');
        setMessage('Callback-URL ist erforderlich, wenn "Benutzerdefiniert" gewählt ist');
        return;
      }

      try {
        new URL(config.callbackUrl);
      } catch {
        setMessageType('error');
        setMessage('Ungültiges URL-Format');
        return;
      }
    }

    if (config.workflowAbortNotificationEnabled) {
      const recipientEmail = config.workflowAbortRecipientEmail.trim();
      if (!recipientEmail) {
        setMessageType('error');
        setMessage('Bitte Empfänger-E-Mail für Workflow-Abbruch-Benachrichtigungen angeben');
        return;
      }
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(recipientEmail)) {
        setMessageType('error');
        setMessage('Empfänger-E-Mail ist ungültig');
        return;
      }
    }

    if (config.jurisdictionGeofence.enabled) {
      if (config.jurisdictionGeofence.shape === 'circle') {
        if (
          !Number.isFinite(config.jurisdictionGeofence.centerLat) ||
          !Number.isFinite(config.jurisdictionGeofence.centerLon)
        ) {
          setMessageType('error');
          setMessage('Für einen Kreis-Geofence müssen Mittelpunkt-Koordinaten gesetzt werden.');
          return;
        }
      } else {
        if ((config.jurisdictionGeofence.points || []).length < 3) {
          setMessageType('error');
          setMessage('Für einen Polygon-Geofence sind mindestens drei Punkte erforderlich.');
          return;
        }
      }
    }
    const normalizedResponsibilityAuthorities = (config.responsibilityAuthorities || [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
    if (normalizedResponsibilityAuthorities.length === 0) {
      setMessageType('error');
      setMessage('Bitte mindestens einen erlaubten Zuständigkeitswert hinterlegen.');
      return;
    }

    const ensureTimeoutHours = (value: number, label: string): string | null => {
      if (!Number.isFinite(value) || value <= 0) {
        return `${label} muss größer als 0 sein.`;
      }
      if (value > 24 * 30) {
        return `${label} darf maximal 720 Stunden sein.`;
      }
      return null;
    };
    const timeoutError =
      ensureTimeoutHours(config.citizenFrontend.emailDoubleOptInTimeoutHours, 'DOI-Timeout') ||
      ensureTimeoutHours(config.citizenFrontend.dataRequestTimeoutHours, 'Datennachforderung-Timeout') ||
      ensureTimeoutHours(
        config.citizenFrontend.enhancedCategorizationTimeoutHours,
        'KI-Basierte Datennachforderung Timeout'
      );
    if (timeoutError) {
      setMessageType('error');
      setMessage(timeoutError);
      return;
    }

    if (config.citizenFrontend.profiles.length > 50) {
      setMessageType('error');
      setMessage('Maximal 50 zusätzliche Bürgerfrontend-Profile sind erlaubt.');
      return;
    }

    const normalizedDefaultTenantId = sanitizeCitizenFrontendTenantId(config.citizenFrontend.tenantId);
    const knownTenantIds = new Set(tenantOptions.map((entry) => entry.id));
    if (normalizedDefaultTenantId && knownTenantIds.size > 0 && !knownTenantIds.has(normalizedDefaultTenantId)) {
      setMessageType('error');
      setMessage('Der gewählte Standard-Mandant ist nicht mehr verfügbar.');
      return;
    }

    const normalizedProfiles = normalizeCitizenFrontendProfiles(
      config.citizenFrontend.profiles,
      config.citizenFrontend.intakeWorkflowTemplateId,
      normalizedDefaultTenantId
    );
    if (normalizedProfiles.length !== config.citizenFrontend.profiles.length) {
      setMessageType('error');
      setMessage('Bitte prüfen Sie die Frontend-Profile: Token müssen eindeutig sein und dürfen nur a-z, 0-9, "_" oder "-" enthalten.');
      return;
    }
    const invalidProfileTenant = normalizedProfiles.find(
      (profile) => profile.tenantId && knownTenantIds.size > 0 && !knownTenantIds.has(profile.tenantId)
    );
    if (invalidProfileTenant) {
      setMessageType('error');
      setMessage(`Profil "${invalidProfileTenant.name}" referenziert einen nicht verfügbaren Mandanten.`);
      return;
    }

    const normalizedRoutingRootTenantId = sanitizeCitizenFrontendTenantId(config.routing.rootTenantId);
    const normalizedRoutingPlatformPath = sanitizeRoutingPlatformPath(config.routing.platformPath);
    if (
      config.routing.rootMode === 'tenant' &&
      !normalizedRoutingRootTenantId
    ) {
      setMessageType('error');
      setMessage('Bitte einen Root-Mandanten auswählen, wenn das Bürgerfrontend auf "/" laufen soll.');
      return;
    }
    if (
      normalizedRoutingRootTenantId &&
      knownTenantIds.size > 0 &&
      !knownTenantIds.has(normalizedRoutingRootTenantId)
    ) {
      setMessageType('error');
      setMessage('Der gewählte Root-Mandant ist nicht mehr verfügbar.');
      return;
    }
    const resolvedRootTenantSlug = resolveTenantSlugById(normalizedRoutingRootTenantId);
    if (config.routing.rootMode === 'tenant' && !resolvedRootTenantSlug) {
      setMessageType('error');
      setMessage('Der gewählte Root-Mandant hat keinen gültigen Slug für mandantenbasierte URLs.');
      return;
    }
    const platformPathError = validatePlatformPathConsistency(normalizedRoutingPlatformPath, '/c');
    if (platformPathError) {
      setMessageType('error');
      setMessage(platformPathError);
      return;
    }
    const callbackPathError = validateCallbackPublicBasePath(callbackBaseCandidate);
    if (callbackPathError) {
      setMessageType('error');
      setMessage(callbackPathError);
      return;
    }
    const vapidPublic = String(config.webPush.vapidPublicKey || '').trim();
    const vapidPrivate = String(config.webPush.vapidPrivateKey || '').trim();
    if ((vapidPublic && !vapidPrivate) || (!vapidPublic && vapidPrivate)) {
      setMessageType('error');
      setMessage('Bitte sowohl VAPID Public Key als auch Private Key setzen oder beide Felder leer lassen.');
      return;
    }
    const vapidSubject = String(config.webPush.vapidSubject || '').trim();
    if (!vapidSubject) {
      setMessageType('error');
      setMessage('Bitte einen VAPID Subject setzen (z. B. mailto:admin@example.com).');
      return;
    }

    setSaving(true);
    try {
      const announcementTitle = sanitizeAnnouncementText(config.citizenFrontend.announcementTitle, 240);
      const announcementMessage = sanitizeAnnouncementText(config.citizenFrontend.announcementMessage, 4000);
      const announcementSourceHash = buildAnnouncementSourceHash(announcementTitle, announcementMessage);
      const announcementTranslations = normalizeAnnouncementTranslations(
        config.citizenFrontend.announcementTranslations
      );
      const defaultCode = (config.defaultLanguage || 'de').toLowerCase();
      if (announcementSourceHash && (announcementTitle || announcementMessage)) {
        announcementTranslations[defaultCode] = {
          title: announcementTitle,
          message: announcementMessage,
          sourceHash: announcementSourceHash,
        };
      }

      const savePayload: GeneralConfig = {
        ...config,
        xmppRtc: {
          stunUrls: (config.xmppRtc?.stunUrls || []).map((entry) => String(entry || '').trim()).filter(Boolean),
          turnUrls: (config.xmppRtc?.turnUrls || []).map((entry) => String(entry || '').trim()).filter(Boolean),
          turnUsername: String(config.xmppRtc?.turnUsername || '').trim(),
          turnCredential: String(config.xmppRtc?.turnCredential || '').trim(),
        },
        routing: {
          rootMode: config.routing.rootMode === 'tenant' ? 'tenant' : 'platform',
          rootTenantId: normalizedRoutingRootTenantId,
          platformPath: normalizedRoutingPlatformPath,
          tenantBasePath: '/c',
        },
        responsibilityAuthorities: normalizedResponsibilityAuthorities,
        citizenFrontend: {
          ...config.citizenFrontend,
          tenantId: normalizedDefaultTenantId,
          profiles: normalizedProfiles.map((profile) => ({
            ...profile,
            tenantId: sanitizeCitizenFrontendTenantId(profile.tenantId || normalizedDefaultTenantId),
          })),
          announcementTitle,
          announcementMessage,
          announcementSourceHash,
          announcementTranslations,
        },
      };

      const response = await axios.patch('/api/admin/config/general', savePayload, {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });
      const payload = response.data || {};
      setConfig((prev) => ({
        ...prev,
        callbackMode: payload.callbackMode === 'custom' ? 'custom' : 'auto',
        callbackUrl: payload.callbackUrl || prev.callbackUrl,
        webPush: {
          vapidPublicKey:
            typeof payload.webPush?.vapidPublicKey === 'string'
              ? payload.webPush.vapidPublicKey.trim()
              : prev.webPush.vapidPublicKey,
          vapidPrivateKey:
            typeof payload.webPush?.vapidPrivateKey === 'string'
              ? payload.webPush.vapidPrivateKey.trim()
              : prev.webPush.vapidPrivateKey,
          vapidSubject:
            typeof payload.webPush?.vapidSubject === 'string'
              ? payload.webPush.vapidSubject.trim()
              : prev.webPush.vapidSubject,
        },
        xmppRtc: {
          stunUrls: Array.isArray(payload.xmppRtc?.stunUrls)
            ? payload.xmppRtc.stunUrls.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
            : prev.xmppRtc.stunUrls,
          turnUrls: Array.isArray(payload.xmppRtc?.turnUrls)
            ? payload.xmppRtc.turnUrls.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
            : prev.xmppRtc.turnUrls,
          turnUsername:
            typeof payload.xmppRtc?.turnUsername === 'string'
              ? payload.xmppRtc.turnUsername.trim()
              : prev.xmppRtc.turnUsername,
          turnCredential:
            typeof payload.xmppRtc?.turnCredential === 'string'
              ? payload.xmppRtc.turnCredential.trim()
              : prev.xmppRtc.turnCredential,
        },
        routing: {
          rootMode:
            String(payload.routing?.rootMode || '').trim().toLowerCase() === 'tenant'
              ? 'tenant'
              : prev.routing.rootMode,
          rootTenantId:
            typeof payload.routing?.rootTenantId === 'string'
              ? sanitizeCitizenFrontendTenantId(payload.routing.rootTenantId)
              : prev.routing.rootTenantId,
          platformPath:
            typeof payload.routing?.platformPath === 'string'
              ? sanitizeRoutingPlatformPath(payload.routing.platformPath)
              : prev.routing.platformPath,
          tenantBasePath: '/c',
        },
        jurisdictionGeofence: normalizeGeofence(payload.jurisdictionGeofence ?? prev.jurisdictionGeofence),
        responsibilityAuthorities: Array.isArray(payload.responsibilityAuthorities)
          ? payload.responsibilityAuthorities
              .map((entry: unknown) => String(entry || '').trim())
              .filter(Boolean)
          : prev.responsibilityAuthorities,
        citizenFrontend: {
          intakeWorkflowTemplateId: String(payload.citizenFrontend?.intakeWorkflowTemplateId || prev.citizenFrontend.intakeWorkflowTemplateId || '').trim(),
          tenantId:
            sanitizeCitizenFrontendTenantId(payload.citizenFrontend?.tenantId) ||
            prev.citizenFrontend.tenantId,
          emailDoubleOptInTimeoutHours: Number(payload.citizenFrontend?.emailDoubleOptInTimeoutHours || prev.citizenFrontend.emailDoubleOptInTimeoutHours || 48),
          dataRequestTimeoutHours: Number(payload.citizenFrontend?.dataRequestTimeoutHours || prev.citizenFrontend.dataRequestTimeoutHours || 72),
          enhancedCategorizationTimeoutHours: Number(payload.citizenFrontend?.enhancedCategorizationTimeoutHours || prev.citizenFrontend.enhancedCategorizationTimeoutHours || 72),
          profiles: normalizeCitizenFrontendProfiles(
            payload.citizenFrontend?.profiles,
            String(payload.citizenFrontend?.intakeWorkflowTemplateId || prev.citizenFrontend.intakeWorkflowTemplateId || '').trim(),
            sanitizeCitizenFrontendTenantId(payload.citizenFrontend?.tenantId) ||
              prev.citizenFrontend.tenantId
          ),
          announcementEnabled:
            payload.citizenFrontend && Object.prototype.hasOwnProperty.call(payload.citizenFrontend, 'announcementEnabled')
              ? parseBooleanFlag(payload.citizenFrontend.announcementEnabled)
              : prev.citizenFrontend.announcementEnabled,
          announcementMode:
            payload.citizenFrontend?.announcementMode === 'modal'
              ? 'modal'
              : payload.citizenFrontend?.announcementMode === 'banner'
                ? 'banner'
                : prev.citizenFrontend.announcementMode,
          announcementTitle:
            typeof payload.citizenFrontend?.announcementTitle === 'string'
              ? sanitizeAnnouncementText(payload.citizenFrontend.announcementTitle, 240)
              : prev.citizenFrontend.announcementTitle,
          announcementMessage:
            typeof payload.citizenFrontend?.announcementMessage === 'string'
              ? sanitizeAnnouncementText(payload.citizenFrontend.announcementMessage, 4000)
              : prev.citizenFrontend.announcementMessage,
          announcementSourceHash:
            typeof payload.citizenFrontend?.announcementSourceHash === 'string'
              ? payload.citizenFrontend.announcementSourceHash.trim().slice(0, 128)
              : prev.citizenFrontend.announcementSourceHash,
          announcementTranslations:
            payload.citizenFrontend?.announcementTranslations &&
            typeof payload.citizenFrontend.announcementTranslations === 'object'
              ? normalizeAnnouncementTranslations(payload.citizenFrontend.announcementTranslations)
              : prev.citizenFrontend.announcementTranslations,
        },
      }));
      if (payload.callbackMode === 'auto' && payload.callbackUrl) {
        setAutoCallbackUrl(payload.callbackUrl);
      }
      if (payload.callbackMode === 'custom' && payload.callbackUrl) {
        setLastCustomCallbackUrl(payload.callbackUrl);
      }
      setMessageType('success');
      setMessage('Allgemeine Einstellungen erfolgreich aktualisiert');
      setTimeout(() => setMessage(''), 3000);

      const shouldAutoTranslateAnnouncement =
        savePayload.citizenFrontend.announcementEnabled &&
        !!savePayload.citizenFrontend.announcementSourceHash &&
        (!!savePayload.citizenFrontend.announcementTitle || !!savePayload.citizenFrontend.announcementMessage);
      if (shouldAutoTranslateAnnouncement) {
        setAnnouncementTranslationStatus('Meldungsübersetzungen werden im Hintergrund vorbereitet...');
        setAnnouncementTranslationError('');
        void syncAnnouncementTranslations(savePayload, { interactive: false })
          .then(() => {
            setAnnouncementTranslationStatus('Meldungsübersetzungen wurden aktualisiert.');
            setAnnouncementTranslationError('');
          })
          .catch(() => {
            setAnnouncementTranslationError('Meldungsübersetzungen konnten nicht vollständig erzeugt werden.');
          })
          .finally(() => {
            setTimeout(() => {
              setAnnouncementTranslationStatus('');
            }, 3000);
          });
      } else {
        setAnnouncementTranslationStatus('');
        setAnnouncementTranslationError('');
      }
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Fehler beim Speichern der Einstellungen');
    } finally {
      setSaving(false);
    }
  };

  const handlePurge = async () => {
    if (!window.confirm('Alle Tickets und Workflow-Definitionen wirklich löschen? Dieser Schritt kann nicht rückgängig gemacht werden.')) {
      return;
    }

    setPurgeLoading(true);
    setPurgeMessage('');
    setPurgeError('');
    try {
      await axios.post(
        '/api/admin/maintenance/purge',
        { confirm: true },
        { headers: { Authorization: `Bearer ${getAdminToken()}` } }
      );
      setPurgeMessage('Tickets und Workflow-Definitionen wurden gelöscht.');
    } catch (error: any) {
      setPurgeError(error.response?.data?.message || 'Löschen fehlgeschlagen');
    } finally {
      setPurgeLoading(false);
    }
  };

  const handleBackup = async () => {
    setBackupLoading(true);
    setBackupMessage('');
    setBackupError('');
    try {
      const response = await axios.get('/api/admin/maintenance/backup', {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'application/sql' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `behebes-ai-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sql`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      const backupArtifactPath = String(response.headers?.['x-backup-artifact-path'] || '').trim();
      if (backupArtifactPath) {
        setBackupMessage(
          `SQL-Dump erfolgreich heruntergeladen. Server-Backup gespeichert unter "${backupArtifactPath}".`
        );
      } else {
        setBackupMessage('SQL-Dump erfolgreich heruntergeladen.');
      }
      await runUpdatePreflight({ silent: true });
    } catch (error: any) {
      setBackupError(error.response?.data?.message || 'Export fehlgeschlagen');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      setImportError('Bitte eine SQL-Dump-Datei auswählen.');
      return;
    }
    if (!window.confirm('SQL-Dump wirklich importieren? Bestehende Daten können überschrieben werden.')) {
      return;
    }
    setImportLoading(true);
    setImportMessage('');
    setImportError('');
    try {
      const sql = await importFile.text();
      await axios.post('/api/admin/maintenance/import', sql, {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
          'Content-Type': 'text/plain',
        },
      });
      setImportMessage('Import erfolgreich abgeschlossen.');
    } catch (error: any) {
      setImportError(error.response?.data?.message || 'Import fehlgeschlagen');
    } finally {
      setImportLoading(false);
    }
  };

  const handleCleanupOldData = async () => {
    const days = Math.max(1, Math.min(3650, Math.floor(Number(cleanupDays) || 0)));
    if (!window.confirm(`Alte Betriebsdaten wirklich bereinigen? (älter als ${days} Tage)`)) {
      return;
    }

    setCleanupLoading(true);
    setCleanupMessage('');
    setCleanupError('');
    try {
      const response = await axios.post(
        '/api/admin/maintenance/cleanup-old-data',
        { confirm: true, olderThanDays: days },
        { headers: { Authorization: `Bearer ${getAdminToken()}` } }
      );
      const totalDeleted = Number(response.data?.totalDeleted || 0);
      setCleanupMessage(
        totalDeleted > 0
          ? `Bereinigung abgeschlossen (${totalDeleted} Datensätze entfernt).`
          : 'Bereinigung abgeschlossen (keine alten Datensätze gefunden).'
      );
    } catch (error: any) {
      setCleanupError(error.response?.data?.message || 'Bereinigung fehlgeschlagen');
    } finally {
      setCleanupLoading(false);
    }
  };

  const handleArchiveOldTickets = async () => {
    const days = Math.max(1, Math.min(3650, Math.floor(Number(archiveDays) || 0)));
    if (
      !window.confirm(
        `Alte Tickets wirklich als JSON exportieren und danach löschen? (${days} Tage, ${
          archiveClosedOnly ? 'nur geschlossen/abgeschlossen' : 'alle Status'
        })`
      )
    ) {
      return;
    }

    setArchiveLoading(true);
    setArchiveMessage('');
    setArchiveError('');
    try {
      const response = await axios.post(
        '/api/admin/maintenance/archive-old-tickets',
        {
          confirm: true,
          olderThanDays: days,
          closedOnly: archiveClosedOnly,
        },
        {
          headers: { Authorization: `Bearer ${getAdminToken()}` },
          responseType: 'blob',
        }
      );

      const blob = new Blob([response.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const disposition = response.headers?.['content-disposition'] || '';
      const fileNameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
      link.download = fileNameMatch?.[1] || `ticket-archiv-${days}d.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      const archivedTickets = Number(response.headers?.['x-archived-tickets'] || 0);
      const archivedSubmissions = Number(response.headers?.['x-archived-submissions'] || 0);
      setArchiveMessage(
        `Archiv exportiert und bereinigt: ${archivedTickets} Ticket(s), ${archivedSubmissions} Submission(s).`
      );
    } catch (error: any) {
      if (error?.response?.data instanceof Blob) {
        try {
          const text = await error.response.data.text();
          const parsed = JSON.parse(text);
          setArchiveError(parsed?.message || 'Archivierung fehlgeschlagen');
        } catch {
          setArchiveError('Archivierung fehlgeschlagen');
        }
      } else {
        setArchiveError(error.response?.data?.message || 'Archivierung fehlgeschlagen');
      }
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleSaveTranslationCachePolicy = async () => {
    const ttlDays = Math.max(1, Math.min(3650, Math.floor(Number(translationCacheTtlDays) || 0)));
    setTranslationCacheLoading(true);
    setTranslationCacheMessage('');
    setTranslationCacheError('');
    try {
      const response = await axios.post(
        '/api/admin/maintenance/translation-cache-policy',
        {
          ttlDays,
          pruneNow: translationCachePruneNow,
        },
        { headers: { Authorization: `Bearer ${getAdminToken()}` } }
      );
      const nextTtl = Number(response.data?.ttlDays);
      setTranslationCacheTtlDays(
        Number.isFinite(nextTtl) ? Math.max(1, Math.min(3650, Math.floor(nextTtl))) : ttlDays
      );
      setTranslationCacheMessage(
        response.data?.message || 'Lebensdauer für Übersetzungen erfolgreich gespeichert.'
      );
      setTranslationCacheError('');
    } catch (error: any) {
      setTranslationCacheError(error.response?.data?.message || 'Speichern der Lebensdauer fehlgeschlagen');
    } finally {
      setTranslationCacheLoading(false);
    }
  };

  const runRetranslate = async (input: {
    language: string;
    includeUi?: boolean;
    includeEmail?: boolean;
    uiKeys?: string[];
    emailTemplateIds?: string[];
    successMessage?: string;
    busyKey?: string;
  }) => {
    const busyKey = input.busyKey || `lang:${input.language}`;
    setTranslationCoverageBusyByKey((prev) => ({ ...prev, [busyKey]: true }));
    setTranslationCoverageMessage('');
    setTranslationCoverageError('');
    try {
      const response = await axios.post(
        '/api/admin/translation-planner/retranslate',
        {
          language: input.language,
          includeUi: input.includeUi !== false,
          includeEmail: input.includeEmail !== false,
          uiKeys: input.uiKeys,
          emailTemplateIds: input.emailTemplateIds,
        },
        {
          headers: {
            Authorization: `Bearer ${getAdminToken()}`,
          },
        }
      );
      const payload = response.data || {};
      const msg =
        input.successMessage ||
        payload.message ||
        `Nachübersetzung für ${input.language} abgeschlossen.`;
      setTranslationCoverageMessage(msg);
      await refreshTranslationLanguageCodes();
      await fetchTranslationCoverage(true);
    } catch (error: any) {
      setTranslationCoverageError(error?.response?.data?.message || 'Nachübersetzung fehlgeschlagen.');
    } finally {
      setTranslationCoverageBusyByKey((prev) => ({ ...prev, [busyKey]: false }));
    }
  };

  const handleDeleteTranslationsForLanguage = async (languageCode: string) => {
    const normalized = String(languageCode || '').trim().toLowerCase();
    if (!normalized) return;
    if (
      !window.confirm(
        `Gespeicherte Übersetzungen für "${normalized}" wirklich löschen? (UI + E-Mail)`
      )
    ) {
      return;
    }
    const busyKey = `delete:${normalized}`;
    setTranslationCoverageBusyByKey((prev) => ({ ...prev, [busyKey]: true }));
    setTranslationCoverageMessage('');
    setTranslationCoverageError('');
    try {
      await axios.delete('/api/admin/translation-planner/entries', {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
        data: {
          kind: 'all',
          language: normalized,
          stopPlanner: false,
        },
      });
      setTranslationCoverageMessage(`Gespeicherte Übersetzungen für ${normalized} wurden gelöscht.`);
      await refreshTranslationLanguageCodes();
      await fetchTranslationCoverage(true);
    } catch (error: any) {
      setTranslationCoverageError(
        error?.response?.data?.message || 'Übersetzungen konnten nicht gelöscht werden.'
      );
    } finally {
      setTranslationCoverageBusyByKey((prev) => ({ ...prev, [busyKey]: false }));
    }
  };

  const formatMissingEmailReason = (reason: TranslationCoverageMissingEmailTemplate['reason']) => {
    if (reason === 'outdated') return 'veraltet';
    if (reason === 'empty') return 'leer';
    return 'fehlend';
  };

  const formatBytes = (value: number): string => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const renderBlockSaveButton = () => (
    <div className="pt-2 flex justify-end">
      <button
        onClick={handleSave}
        disabled={saving}
        className="btn btn-primary"
      >
        {saving ? (
          <span><i className="fa-solid fa-spinner fa-spin" /> Wird gespeichert...</span>
        ) : (
          <span><i className="fa-solid fa-floppy-disk" /> Block speichern</span>
        )}
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <i className="fa-solid fa-spinner fa-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{viewTitle}</h2>
          <p className="text-sm text-slate-500">{viewSubtitle}</p>
        </div>
        {showTopSave && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? (
              <span><i className="fa-solid fa-spinner fa-spin" /> Wird gespeichert...</span>
            ) : (
              <span><i className="fa-solid fa-floppy-disk" /> Speichern</span>
            )}
          </button>
        )}
      </div>

      {message && (
        <div
          className={`message-banner p-4 rounded-lg flex items-center gap-2 ${
            messageType === 'success'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {messageType === 'success' ? (
            <i className="fa-solid fa-circle-check" />
          ) : (
            <i className="fa-solid fa-circle-exclamation" />
          )}
          {message}
        </div>
      )}

      {showBase && (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-screwdriver-wrench text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-900">System & Links</h3>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-xl font-semibold">Systemidentität</h3>
          <div>
            <label className="block text-sm font-medium mb-1">
              Anwendungsname
              <SourceTag source={sources.appName} />
            </label>
            <input
              type="text"
              name="appName"
              value={config.appName}
              onChange={handleChange}
              placeholder="z.B. OI App"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Anzeigename im Bürgerfrontend und Admin-Portal. Absenderdaten werden in den SMTP-Einstellungen gepflegt.
            </p>
          </div>
          {renderBlockSaveButton()}
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-xl font-semibold">Validierung & Callback-Links</h3>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="callbackMode"
                value="auto"
                checked={config.callbackMode === 'auto'}
                onChange={() => handleCallbackModeChange('auto')}
              />
              <span>Automatisch aus Deployment ermitteln (empfohlen)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="callbackMode"
                value="custom"
                checked={config.callbackMode === 'custom'}
                onChange={() => handleCallbackModeChange('custom')}
              />
              <span>Benutzerdefinierte Callback-URL verwenden</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Öffentliche Basis-URL (PWA & Callback-Links)
              <SourceTag source={sources.callbackUrl} />
            </label>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Protokoll</span>
              <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleCallbackProtocolChange('https')}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    callbackProtocol === 'https'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                  disabled={config.callbackMode !== 'custom'}
                >
                  HTTPS
                </button>
                <button
                  type="button"
                  onClick={() => handleCallbackProtocolChange('http')}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors border-l border-slate-300 ${
                    callbackProtocol === 'http'
                      ? 'bg-amber-500 text-slate-900'
                      : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                  disabled={config.callbackMode !== 'custom'}
                >
                  HTTP
                </button>
              </div>
              <span className="text-xs text-slate-500">
                {config.callbackMode === 'custom'
                  ? 'Wird aus der Eingabe erkannt und kann manuell überschrieben werden.'
                  : 'Im Auto-Modus wird das Protokoll aus der Laufzeitumgebung übernommen.'}
              </span>
            </div>
            <input
              type="url"
              name="callbackUrl"
              value={config.callbackMode === 'custom' ? config.callbackUrl : effectiveCallbackUrl}
              onChange={handleChange}
              placeholder="z.B. https://example.com/verify"
              disabled={config.callbackMode !== 'custom'}
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                config.callbackMode !== 'custom' ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
              }`}
            />
            <p className="text-xs text-gray-500 mt-1">
              Wird für PWA-Einstieg, Validierungs-, Status-, Workflow-Bestätigungs-, Passwort-Reset- und Profil-Links genutzt.
              In den meisten Deployments ist kein manueller Wert erforderlich.
            </p>
            <p className="text-xs text-blue-700 mt-2 bg-blue-50 p-2 rounded flex items-center gap-2">
              <i className="fa-solid fa-thumbtack" />
              Aktuell wirksam: {effectiveCallbackUrl || 'wird automatisch ermittelt'}
            </p>
            <p className="text-xs text-slate-700 mt-2 bg-slate-50 p-2 rounded flex items-center gap-2">
              <i className="fa-solid fa-link" />
              Öffentliche Basis daraus: {effectivePublicFrontendBaseUrl || 'nicht verfügbar'}
            </p>
            {callbackPathValidationMessage && (
              <p className="text-xs text-red-700 mt-2 bg-red-50 border border-red-200 p-2 rounded flex items-center gap-2">
                <i className="fa-solid fa-triangle-exclamation" />
                {callbackPathValidationMessage}
              </p>
            )}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1 mt-2">
              <p className="font-semibold text-slate-900">Callback-Linkvorschau</p>
              <p>Verify: <code>{callbackVerifyPreview}?token=&lt;token&gt;&amp;cb=ticket_validation</code></p>
              <p>Status: <code>{callbackStatusPreview}?token=&lt;token&gt;</code></p>
              <p>Workflow: <code>{callbackWorkflowPreview}?token=&lt;token&gt;&amp;workflowId=&lt;id&gt;</code></p>
              <p>Datennachforderung: <code>{callbackDataRequestPreview}?token=&lt;token&gt;</code></p>
              <p>Mandantenkanonisch (Standard-Mandant): <code>{callbackCanonicalVerifyPreview}</code></p>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
            <h4 className="font-semibold text-amber-900 mb-2"><i className="fa-solid fa-circle-info" /> Hinweis</h4>
            <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
              <li>Auto-Modus nutzt die produktive Frontend-URL aus der Server-Konfiguration.</li>
              <li>Custom-Modus ist nur nötig bei Sonderfällen (z.B. externe öffentliche Domain).</li>
              <li>Alle E-Mail- und PWA-Deep-Links enthalten Tokens und müssen öffentlich erreichbar sein.</li>
            </ul>
          </div>
          {renderBlockSaveButton()}
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-xl font-semibold">Web Push (VAPID)</h3>
          <p className="text-xs text-gray-600">
            Diese Schlüssel werden für Push-Benachrichtigungen in Bürger- und Ops-PWA verwendet.
            Änderungen greifen sofort nach dem Speichern.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">
              VAPID Subject
              <SourceTag source={sources.webPush} />
            </label>
            <input
              type="text"
              value={config.webPush.vapidSubject}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  webPush: {
                    ...prev.webPush,
                    vapidSubject: event.target.value,
                  },
                }))
              }
              placeholder="mailto:noreply@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">VAPID Public Key</label>
            <textarea
              value={config.webPush.vapidPublicKey}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  webPush: {
                    ...prev.webPush,
                    vapidPublicKey: event.target.value,
                  },
                }))
              }
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">VAPID Private Key</label>
            <textarea
              value={config.webPush.vapidPrivateKey}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  webPush: {
                    ...prev.webPush,
                    vapidPrivateKey: event.target.value,
                  },
                }))
              }
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={vapidGenerating}
              onClick={handleGenerateVapidKeys}
            >
              {vapidGenerating ? (
                <span><i className="fa-solid fa-spinner fa-spin" /> Generiere…</span>
              ) : (
                <span><i className="fa-solid fa-key" /> VAPID-Schlüssel generieren</span>
              )}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void navigator.clipboard.writeText(config.webPush.vapidPublicKey || '')}
            >
              <i className="fa-solid fa-copy" /> Public Key kopieren
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void navigator.clipboard.writeText(config.webPush.vapidPrivateKey || '')}
            >
              <i className="fa-solid fa-copy" /> Private Key kopieren
            </button>
          </div>
          {renderBlockSaveButton()}
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-xl font-semibold">Messenger WebRTC (STUN/TURN)</h3>
          <p className="text-xs text-gray-600">
            Diese ICE-Server werden für Sprachanrufe im Admin- und Ops-Messenger genutzt.
            Eine URL pro Zeile oder kommasepariert eintragen.
            <SourceTag source={sources.xmppRtc} />
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">STUN URLs</label>
            <textarea
              rows={3}
              value={(config.xmppRtc.stunUrls || []).join('\n')}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  xmppRtc: {
                    ...prev.xmppRtc,
                    stunUrls: String(event.target.value || '')
                      .split(/[\n,]+/)
                      .map((entry) => entry.trim())
                      .filter(Boolean),
                  },
                }))
              }
              placeholder={'stun:stun.l.google.com:19302\nstun:stun.cloudflare.com:3478'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">TURN URLs</label>
            <textarea
              rows={3}
              value={(config.xmppRtc.turnUrls || []).join('\n')}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  xmppRtc: {
                    ...prev.xmppRtc,
                    turnUrls: String(event.target.value || '')
                      .split(/[\n,]+/)
                      .map((entry) => entry.trim())
                      .filter(Boolean),
                  },
                }))
              }
              placeholder={'turn:ks1.troester.nl:3478?transport=udp\nturn:ks1.troester.nl:3478?transport=tcp'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">TURN Benutzername</label>
              <input
                type="text"
                value={config.xmppRtc.turnUsername}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    xmppRtc: {
                      ...prev.xmppRtc,
                      turnUsername: event.target.value,
                    },
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">TURN Passwort</label>
              <input
                type="text"
                value={config.xmppRtc.turnCredential}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    xmppRtc: {
                      ...prev.xmppRtc,
                      turnCredential: event.target.value,
                    },
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">
            Für stabile Internet-Sprachanrufe werden TURN-Server und Relay-Ports benötigt.
          </p>
          {renderBlockSaveButton()}
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-4 xl:col-span-2">
          <h3 className="text-xl font-semibold">Plattform- & Mandantenrouting</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-900">Verhalten auf Root-Pfad `/`</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="routingRootMode"
                  checked={config.routing.rootMode === 'platform'}
                  onChange={() =>
                    setConfig((prev) => ({
                      ...prev,
                      routing: { ...prev.routing, rootMode: 'platform' },
                    }))
                  }
                />
                <span>Plattformbeschreibung auf `/`</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="routingRootMode"
                  checked={config.routing.rootMode === 'tenant'}
                  onChange={() =>
                    setConfig((prev) => ({
                      ...prev,
                      routing: { ...prev.routing, rootMode: 'tenant' },
                    }))
                  }
                />
                <span>Bürgerfrontend eines Mandanten auf `/`</span>
              </label>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">
                Root-Mandant (nur bei Bürgerfrontend auf `/`)
              </label>
              <select
                value={config.routing.rootTenantId}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    routing: {
                      ...prev.routing,
                      rootTenantId: sanitizeCitizenFrontendTenantId(event.target.value),
                    },
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={config.routing.rootMode !== 'tenant'}
              >
                <option value="">Bitte Mandant wählen</option>
                {tenantOptions.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">
                Plattform-Unterpfad (wenn Bürgerfrontend auf `/` läuft)
              </label>
              <input
                type="text"
                value={config.routing.platformPath}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    routing: {
                      ...prev.routing,
                      platformPath: sanitizeRoutingPlatformPath(event.target.value),
                    },
                  }))
                }
                placeholder="/plattform"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500">
                Mandantenbasis bleibt fest unter `/c/&lt;tenant-slug&gt;`. Reservierte Pfade wie `/verify`, `/status`, `/workflow`, `/login`, `/me`, `/guide`, `/privacy`, `/admin` und `/api` sind hier nicht erlaubt.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 space-y-1">
              <p className="font-semibold text-slate-900">Routing-, PWA- und Linkvorschau</p>
              <p>Plattform auf Root: <code>{platformRootPreview}</code></p>
              <p>Plattform (Alternative): <code>{platformAltPreview}</code></p>
              <p>Mandant (kanonisch): <code>{tenantCanonicalPreview}</code></p>
              <p>Root-Mandant (kanonisch): <code>{tenantRootPreview}</code></p>
              <p>Root-Mandant: <code>{rootTenantOption?.name || 'nicht gesetzt'}</code></p>
              <p>PWA `scope` Root-Mandant: <code>{pwaRootScopePreview}</code></p>
              <p>PWA `scope` andere Mandanten: <code>{pwaTenantScopePreview}</code></p>
              <p>PWA `start_url` Standard-Mandant: <code>{toScopePath(defaultTenantCanonicalBasePath)}</code></p>
              {platformPathValidationMessage && (
                <p className="text-xs text-red-700 mt-2 bg-red-50 border border-red-200 p-2 rounded flex items-center gap-2">
                  <i className="fa-solid fa-triangle-exclamation" />
                  {platformPathValidationMessage}
                </p>
              )}
              {rootTenantMissingSlug && (
                <p className="text-xs text-red-700 mt-2 bg-red-50 border border-red-200 p-2 rounded flex items-center gap-2">
                  <i className="fa-solid fa-triangle-exclamation" />
                  Der gewählte Root-Mandant hat keinen gültigen Slug. Callback- und PWA-Routen wären inkonsistent.
                </p>
              )}
            </div>
          </div>
          {renderBlockSaveButton()}
        </div>
        </div>
      </section>
      )}

      {(showOperations || showCitizen || showJurisdiction) && (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-users-viewfinder text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-900">
            {showOperations && (showCitizen || showJurisdiction)
              ? 'Bürgerfrontend & Workflow-Betrieb'
              : showOperations
                ? 'Workflow-Betrieb'
                : showCitizen
                  ? 'Bürgerfrontend'
                  : 'Zuständigkeit & Geofence'}
          </h3>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {showOperations && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-xl font-semibold">Workflow-Abbruch-Benachrichtigung</h3>
          <div className="flex items-center gap-3">
            <input
              id="workflowAbortNotificationEnabled"
              name="workflowAbortNotificationEnabled"
              type="checkbox"
              checked={config.workflowAbortNotificationEnabled}
              onChange={handleToggle}
            />
            <label htmlFor="workflowAbortNotificationEnabled" className="text-sm font-medium">
              E-Mail bei Workflow-Abbruch senden
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Empfänger-E-Mail
              <SourceTag source={sources.workflowAbortRecipientEmail} />
            </label>
            <input
              type="email"
              name="workflowAbortRecipientEmail"
              value={config.workflowAbortRecipientEmail}
              onChange={handleChange}
              placeholder="z.B. it-support@otterbach-otterberg.de"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Empfänger-Name (optional)
              <SourceTag source={sources.workflowAbortRecipientName} />
            </label>
            <input
              type="text"
              name="workflowAbortRecipientName"
              value={config.workflowAbortRecipientName}
              onChange={handleChange}
              placeholder="z.B. IT-Bereitschaft"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <p className="text-xs text-gray-500">
            Bei fehlgeschlagenen Workflow-Instanzen wird eine automatische Mail mit Ticket-, Workflow- und Fehlerdetails versendet.
          </p>
          {renderBlockSaveButton()}
        </div>
        )}

        {(showCitizen || showJurisdiction) && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4 xl:col-span-2">
          <h3 className="text-xl font-semibold">
            {showCitizen && showJurisdiction
              ? 'Bürgerfrontend, Orte & Geofence'
              : showCitizen
                ? 'Bürgerfrontend'
                : 'Orte & Geofence'}
          </h3>
          {showCitizen && (
          <>
          <div className="flex items-center gap-3">
            <input
              id="maintenanceMode"
              name="maintenanceMode"
              type="checkbox"
              checked={config.maintenanceMode}
              onChange={handleToggle}
            />
            <label htmlFor="maintenanceMode" className="text-sm font-medium">
              Wartungsmodus aktivieren
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Wartungshinweis</label>
            <textarea
              name="maintenanceMessage"
              value={config.maintenanceMessage}
              onChange={handleChange}
              placeholder="z.B. Das Meldungsformular ist aktuell wegen Wartung nicht verfügbar."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <h4 className="font-semibold text-slate-900">Bürgerfrontend · Intake & Timeouts</h4>
            <label className="block">
              <span className="block text-sm font-medium mb-1">Intake-Workflow (Double Opt-In über Engine)</span>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={config.citizenFrontend.intakeWorkflowTemplateId}
                onChange={(e) => handleCitizenFrontendChange('intakeWorkflowTemplateId', e.target.value)}
              >
                <option value="">Kein Intake-Workflow (Legacy-Fallback)</option>
                {workflowTemplates
                  .filter((template) => template.enabled !== false)
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Neue Tickets starten bei gesetzter Vorlage direkt diesen Workflow.
              </p>
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">Mandant (Standard-Bürgerfrontend)</span>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={config.citizenFrontend.tenantId}
                onChange={(e) =>
                  handleCitizenFrontendChange('tenantId', sanitizeCitizenFrontendTenantId(e.target.value))
                }
              >
                <option value="">tenant_default (Systemstandard)</option>
                {tenantOptions.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                    {tenant.slug ? ` (${tenant.slug})` : ''}
                    {!tenant.active ? ' (inaktiv)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Legt fest, welchem Mandanten neue Tickets ohne Token-Profilzuweisung zugeordnet werden.
              </p>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label>
                <span className="block text-sm font-medium mb-1">DOI Timeout (Stunden)</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={config.citizenFrontend.emailDoubleOptInTimeoutHours}
                  onChange={(e) =>
                    handleCitizenFrontendChange(
                      'emailDoubleOptInTimeoutHours',
                      Math.max(1, Number(e.target.value || 48))
                    )
                  }
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1">Datennachforderung Timeout (Stunden)</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={config.citizenFrontend.dataRequestTimeoutHours}
                  onChange={(e) =>
                    handleCitizenFrontendChange(
                      'dataRequestTimeoutHours',
                      Math.max(1, Number(e.target.value || 72))
                    )
                  }
                />
              </label>
              <label>
                <span className="block text-sm font-medium mb-1">KI-Basierte Datennachforderung Timeout (Stunden)</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={config.citizenFrontend.enhancedCategorizationTimeoutHours}
                  onChange={(e) =>
                    handleCitizenFrontendChange(
                      'enhancedCategorizationTimeoutHours',
                      Math.max(1, Number(e.target.value || 72))
                    )
                  }
                />
              </label>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="font-semibold text-slate-900">Bürgerfrontend · Zusätzliche Frontend-Profile (Token)</h4>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={addCitizenFrontendProfile}
                disabled={config.citizenFrontend.profiles.length >= 50}
              >
                <i className="fa-solid fa-plus" /> Profil hinzufügen
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Jedes Profil erzeugt einen eigenen Bürgerfrontend-Einstieg über `?frontendToken=...` und kann einen eigenen Intake-Workflow nutzen.
            </p>
            {config.citizenFrontend.profiles.length === 0 ? (
              <p className="text-xs text-gray-500">
                Noch keine zusätzlichen Profile angelegt. Das Standard-Frontend nutzt weiterhin den oben gesetzten Intake-Workflow.
              </p>
            ) : (
              <div className="space-y-3">
                {config.citizenFrontend.profiles.map((profile, index) => (
                  <div key={profile.id || `profile-${index}`} className="rounded-lg border border-slate-200 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={profile.enabled}
                          onChange={(e) =>
                            handleCitizenFrontendProfileChange(index, { enabled: e.target.checked })
                          }
                        />
                        Profil aktiv
                      </label>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => removeCitizenFrontendProfile(index)}
                      >
                        Entfernen
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="block text-sm font-medium mb-1">Profilname</span>
                        <input
                          type="text"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={profile.name}
                          maxLength={120}
                          onChange={(e) =>
                            handleCitizenFrontendProfileChange(index, { name: e.target.value })
                          }
                          placeholder={`Profil ${index + 1}`}
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium mb-1">Token</span>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            value={profile.token}
                            maxLength={80}
                            onChange={(e) =>
                              handleCitizenFrontendProfileChange(index, { token: e.target.value })
                            }
                            placeholder="z.B. stadtwerke"
                          />
                          <button
                            type="button"
                            className="btn btn-secondary whitespace-nowrap"
                            onClick={() => regenerateCitizenFrontendProfileToken(index)}
                            title="Neues eindeutiges Token erzeugen"
                          >
                            Neu
                          </button>
                        </div>
                        <span className="text-xs text-gray-500">Erlaubt: a-z, 0-9, Unterstrich und Bindestrich.</span>
                      </label>
                    </div>

                    <label className="block">
                      <span className="block text-sm font-medium mb-1">Mandant für dieses Profil</span>
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={profile.tenantId}
                        onChange={(e) =>
                          handleCitizenFrontendProfileChange(index, {
                            tenantId: sanitizeCitizenFrontendTenantId(e.target.value),
                          })
                        }
                      >
                        <option value="">Standard-Mandant aus Haupteinstellung</option>
                        {tenantOptions.map((tenant) => (
                          <option key={`${profile.id}-tenant-${tenant.id}`} value={tenant.id}>
                            {tenant.name}
                            {tenant.slug ? ` (${tenant.slug})` : ''}
                            {!tenant.active ? ' (inaktiv)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="block text-sm font-medium mb-1">Header-Tag (optional)</span>
                        <input
                          type="text"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={profile.headerTag}
                          maxLength={80}
                          onChange={(e) =>
                            handleCitizenFrontendProfileChange(index, { headerTag: e.target.value })
                          }
                          placeholder="z. B. Online-Service"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium mb-1">Header-Kicker (optional)</span>
                        <input
                          type="text"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={profile.headerKicker}
                          maxLength={120}
                          onChange={(e) =>
                            handleCitizenFrontendProfileChange(index, { headerKicker: e.target.value })
                          }
                          placeholder="z. B. Verbandsgemeinde"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium mb-1">Header-Titel (optional)</span>
                        <input
                          type="text"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={profile.headerTitle}
                          maxLength={160}
                          onChange={(e) =>
                            handleCitizenFrontendProfileChange(index, { headerTitle: e.target.value })
                          }
                          placeholder="z. B. Otterbach-Otterberg"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium mb-1">Header-Untertitel (optional)</span>
                        <input
                          type="text"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={profile.headerSubtitle}
                          maxLength={240}
                          onChange={(e) =>
                            handleCitizenFrontendProfileChange(index, { headerSubtitle: e.target.value })
                          }
                          placeholder="z. B. Bürgermeldung · behebes.AI"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="block text-sm font-medium mb-1">Formular-Kicker (optional)</span>
                        <input
                          type="text"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={profile.submissionKicker}
                          maxLength={120}
                          onChange={(e) =>
                            handleCitizenFrontendProfileChange(index, { submissionKicker: e.target.value })
                          }
                          placeholder="z. B. Online-Meldung"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium mb-1">Formular-Titel (optional)</span>
                        <input
                          type="text"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={profile.submissionTitle}
                          maxLength={160}
                          onChange={(e) =>
                            handleCitizenFrontendProfileChange(index, { submissionTitle: e.target.value })
                          }
                          placeholder="z. B. Anliegen melden"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="block text-sm font-medium mb-1">Formular-Untertitel (optional)</span>
                      <textarea
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg min-h-[88px]"
                        value={profile.submissionSubtitle}
                        maxLength={400}
                        onChange={(e) =>
                          handleCitizenFrontendProfileChange(index, { submissionSubtitle: e.target.value })
                        }
                        placeholder="Kurzer Hilfetext für dieses Token-Frontend"
                      />
                      <span className="text-xs text-gray-500">
                        Leere Felder nutzen automatisch die Standardtexte des Bürgerfrontends.
                      </span>
                    </label>

                    <label className="block">
                      <span className="block text-sm font-medium mb-1">Intake-Workflow für dieses Profil</span>
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={profile.intakeWorkflowTemplateId}
                        onChange={(e) =>
                          handleCitizenFrontendProfileChange(index, {
                            intakeWorkflowTemplateId: e.target.value,
                          })
                        }
                      >
                        <option value="">Standard-Intake aus Haupteinstellung</option>
                        {workflowTemplates
                          .filter((template) => template.enabled !== false)
                          .map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                        ))}
                      </select>
                    </label>

                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={profile.citizenAuthEnabled}
                        onChange={(e) =>
                          handleCitizenFrontendProfileChange(index, {
                            citizenAuthEnabled: e.target.checked,
                          })
                        }
                      />
                      Bürger-App Login (Magic Link) für dieses Profil aktivieren
                    </label>

                    <label className="block">
                      <span className="block text-sm font-medium mb-1">Intake-Workflow für angemeldete App</span>
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={profile.authenticatedIntakeWorkflowTemplateId}
                        onChange={(e) =>
                          handleCitizenFrontendProfileChange(index, {
                            authenticatedIntakeWorkflowTemplateId: e.target.value,
                          })
                        }
                      >
                        <option value="">Kein eigener Auth-Workflow (nutzt Profil-Intake)</option>
                        {workflowTemplates
                          .filter((template) => template.enabled !== false)
                          .map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                      </select>
                      <span className="text-xs text-gray-500">
                        Wird nur verwendet, wenn die Bürger-App für dieses Profil angemeldet ist.
                      </span>
                    </label>

                    <p className="text-xs text-slate-600 break-all">
                      Aufruf-Link:{' '}
                      <code className="px-1 py-0.5 bg-slate-100 rounded">
                        {profile.token ? buildCitizenFrontendProfileUrl(profile.token, profile.tenantId) : 'Token fehlt'}
                      </code>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <h4 className="font-semibold text-slate-900">Bürgerfrontend · Aktuelle Meldung</h4>
            <div className="flex items-center gap-3">
              <input
                id="announcementEnabled"
                type="checkbox"
                checked={config.citizenFrontend.announcementEnabled}
                onChange={(e) => handleCitizenFrontendChange('announcementEnabled', e.target.checked)}
              />
              <label htmlFor="announcementEnabled" className="text-sm font-medium">
                Aktuelle Meldung im Bürgerfrontend anzeigen
              </label>
            </div>

            <label className="block">
              <span className="block text-sm font-medium mb-1">Darstellung</span>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={config.citizenFrontend.announcementMode}
                onChange={(e) =>
                  handleCitizenFrontendChange(
                    'announcementMode',
                    e.target.value === 'modal' ? 'modal' : 'banner'
                  )
                }
              >
                <option value="banner">Banner</option>
                <option value="modal">Modal</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-sm font-medium mb-1">Titel</span>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={config.citizenFrontend.announcementTitle}
                onChange={(e) =>
                  handleCitizenFrontendChange(
                    'announcementTitle',
                    sanitizeAnnouncementText(e.target.value, 240)
                  )
                }
                placeholder="z.B. Wichtiger Hinweis"
                maxLength={240}
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium mb-1">Nachricht</span>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                value={config.citizenFrontend.announcementMessage}
                onChange={(e) =>
                  handleCitizenFrontendChange(
                    'announcementMessage',
                    sanitizeAnnouncementText(e.target.value, 4000)
                  )
                }
                placeholder="Freitext für Bürgerinnen und Bürger"
                rows={4}
                maxLength={4000}
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={
                  announcementTranslationLoading ||
                  !config.citizenFrontend.announcementEnabled ||
                  (!config.citizenFrontend.announcementTitle && !config.citizenFrontend.announcementMessage)
                }
                onClick={async () => {
                  try {
                    await syncAnnouncementTranslations(config, { forceAll: true, interactive: true });
                  } catch {
                    setAnnouncementTranslationError('Übersetzung der aktuellen Meldung fehlgeschlagen.');
                  }
                }}
              >
                {announcementTranslationLoading ? 'Übersetze...' : 'Für alle Sprachen übersetzen'}
              </button>
              <span className="text-xs text-slate-500">
                Beim Speichern wird die Übersetzung zusätzlich automatisch im Hintergrund gestartet.
              </span>
            </div>
            {announcementTranslationStatus && (
              <p className="text-sm text-green-700">
                <i className="fa-solid fa-circle-check" /> {announcementTranslationStatus}
              </p>
            )}
            {announcementTranslationError && (
              <p className="text-sm text-red-700">
                <i className="fa-solid fa-circle-exclamation" /> {announcementTranslationError}
              </p>
            )}
          </div>
          </>
          )}

          {showJurisdiction && (
          <>
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex items-center gap-3">
              <input
                id="restrictLocations"
                name="restrictLocations"
                type="checkbox"
                checked={config.restrictLocations}
                onChange={handleToggle}
              />
              <label htmlFor="restrictLocations" className="text-sm font-medium">
                Meldungen auf bestimmte Orte beschränken
              </label>
            </div>
            {config.restrictLocations && (
              <div className="space-y-3">
                <label className="block text-sm font-medium">Erlaubte Orte</label>
                {config.allowedLocations.length === 0 && (
                  <p className="text-xs text-gray-500">
                    Noch keine Orte hinterlegt. Ohne Ortseinträge wird nur der Geofence geprüft (falls aktiv).
                  </p>
                )}
                {config.allowedLocations.map((location, index) => (
                  <div key={`location-${index}`} className="flex flex-col md:flex-row gap-2">
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => handleAllowedLocationChange(index, e.target.value)}
                      placeholder="z.B. Otterbach"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                    />
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => removeAllowedLocation(index)}
                    >
                      Entfernen
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary" onClick={addAllowedLocation}>
                  <i className="fa-solid fa-plus" /> Ort hinzufügen
                </button>
                <p className="text-xs text-gray-500">
                  Die Eingaben werden gegen Adresse, PLZ und Ort im Meldungsformular geprüft.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <label className="block text-sm font-medium">Erlaubte Werte für Ticketfeld "Zuständig ist"</label>
            {(config.responsibilityAuthorities || []).length === 0 && (
              <p className="text-xs text-gray-500">
                Noch keine Werte hinterlegt.
              </p>
            )}
            {(config.responsibilityAuthorities || []).map((entry, index) => (
              <div key={`responsibility-authority-${index}`} className="flex flex-col md:flex-row gap-2">
                <input
                  type="text"
                  value={entry}
                  onChange={(e) => handleResponsibilityAuthorityChange(index, e.target.value)}
                  placeholder="z.B. Verbandsgemeinde / verbandsfreie Gemeinde"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                />
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => removeResponsibilityAuthority(index)}
                >
                  Entfernen
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={addResponsibilityAuthority}>
              <i className="fa-solid fa-plus" /> Wert hinzufügen
            </button>
            <p className="text-xs text-gray-500">
              Nur diese Werte sind bei KI-Zuständigkeitsvorschlag und manueller Bearbeitung im Ticket erlaubt.
            </p>
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex items-center gap-3">
              <input
                id="jurisdictionGeofenceEnabled"
                type="checkbox"
                checked={config.jurisdictionGeofence.enabled}
                onChange={(e) => updateGeofence({ enabled: e.target.checked })}
              />
              <label htmlFor="jurisdictionGeofenceEnabled" className="text-sm font-medium">
                Zuständigkeits-Geofence aktivieren (Koordinaten-basiert)
              </label>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <label className="block text-sm font-medium">
                Gemeindegrenzen automatisch aus Orten erzeugen
              </label>
              <textarea
                rows={4}
                value={geofenceSourcePlaces}
                onChange={(e) => setGeofenceSourcePlaces(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={'z.B.\nOtterbach\nOtterberg'}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void generateGeofenceFromPlaces()}
                  disabled={geofenceGenerateLoading}
                >
                  {geofenceGenerateLoading ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin" /> Grenzen werden geladen...
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-map-location-dot" /> Geofence aus Orten erzeugen
                    </>
                  )}
                </button>
                <span className="text-xs text-slate-500">
                  Mehrere Orte werden zu einer gemeinsamen Fläche zusammengeführt.
                </span>
              </div>
              {geofenceGenerateMessage && (
                <p className="text-xs text-green-700">
                  <i className="fa-solid fa-circle-check" /> {geofenceGenerateMessage}
                </p>
              )}
              {geofenceGenerateError && (
                <p className="text-xs text-red-700">
                  <i className="fa-solid fa-circle-exclamation" /> {geofenceGenerateError}
                </p>
              )}
            </div>

            {config.jurisdictionGeofence.enabled && (
              <div className="space-y-3">

                <label className="block text-sm font-medium">Geofence-Form</label>
                <select
                  value={config.jurisdictionGeofence.shape}
                  onChange={(e) =>
                    updateGeofence({
                      shape: e.target.value === 'polygon' ? 'polygon' : 'circle',
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="circle">Kreis</option>
                  <option value="polygon">Polygon</option>
                </select>

                {config.jurisdictionGeofence.shape === 'circle' ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Mittelpunkt Breite (Lat)</label>
                      <input
                        type="number"
                        step="0.000001"
                        value={config.jurisdictionGeofence.centerLat ?? ''}
                        onChange={(e) => updateGeofence({ centerLat: Number(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Mittelpunkt Länge (Lon)</label>
                      <input
                        type="number"
                        step="0.000001"
                        value={config.jurisdictionGeofence.centerLon ?? ''}
                        onChange={(e) => updateGeofence({ centerLon: Number(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Radius (Meter)</label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={config.jurisdictionGeofence.radiusMeters ?? 5000}
                        onChange={(e) => updateGeofence({ radiusMeters: Math.max(1, Number(e.target.value) || 5000) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(config.jurisdictionGeofence.points || []).map((point, index) => (
                      <div key={`geofence-point-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                        <div className="md:col-span-2">
                          <label className="block text-xs text-gray-600 mb-1">Punkt {index + 1} Lat</label>
                          <input
                            type="number"
                            step="0.000001"
                            value={point.lat}
                            onChange={(e) => updateGeofencePoint(index, 'lat', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs text-gray-600 mb-1">Punkt {index + 1} Lon</label>
                          <input
                            type="number"
                            step="0.000001"
                            value={point.lon}
                            onChange={(e) => updateGeofencePoint(index, 'lon', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          />
                        </div>
                        <button type="button" className="btn btn-danger" onClick={() => removeGeofencePoint(index)}>
                          Entfernen
                        </button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-secondary" onClick={addGeofencePoint}>
                      <i className="fa-solid fa-plus" /> Polygonpunkt hinzufügen
                    </button>
                    <p className="text-xs text-gray-500">
                      Der Geofence wird im Bürgerfrontend live geprüft. Bei aktiver Ortsbeschränkung hat Geofence Vorrang vor Text-Whitelist.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          </>
          )}
          {renderBlockSaveButton()}
        </div>
        )}
        </div>
      </section>
      )}

      {showLanguages && (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-language text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-900">Sprachen & Übersetzung</h3>
        </div>
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">Sprachkonfiguration</h3>
            <p className="text-sm text-slate-500">Legt die Standardsprache fest und erweitert das Sprachangebot.</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Standardsprache</label>
          <select
            name="defaultLanguage"
            value={config.defaultLanguage}
            onChange={handleChange}
            disabled={config.languages.length === 0}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {config.languages.length === 0 ? (
              <option value={config.defaultLanguage}>{config.defaultLanguage}</option>
            ) : (
              config.languages.map((lang, index) => (
                <option key={`${lang.code}-${index}`} value={lang.code}>
                  {lang.label} ({lang.code})
                </option>
              ))
            )}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Diese Sprache wird standardmäßig im Bürgerfrontend verwendet.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Verfügbare Sprachen</label>
          {config.languages.length === 0 && (
            <p className="text-xs text-gray-500 mb-3">
              Keine Sprachen konfiguriert. Das Bürgerfrontend verwendet die Standardliste.
            </p>
          )}
          <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
            <select
              value={quickLanguageCode}
              onChange={(e) => setQuickLanguageCode(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg w-full md:w-80"
            >
              <option value="">Schnellwahl (Top 50)</option>
              {COMMON_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.label} ({lang.code})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleQuickAddLanguage}
              disabled={!quickLanguageCode}
            >
              Hinzufügen
            </button>
          </div>
          {(translationMessage || translationError) && (
            <div className="mb-3 text-sm">
              {translationMessage && (
                <span className="text-green-700">
                  <i className="fa-solid fa-circle-check" /> {translationMessage}
                </span>
              )}
              {translationError && (
                <span className="text-red-700">
                  <i className="fa-solid fa-circle-exclamation" /> {translationError}
                </span>
              )}
            </div>
          )}
          <div className="space-y-3">
            {config.languages.map((lang, index) => {
              const langCode = (lang.code || '').toLowerCase();
              const hasTranslation = translationLanguages.includes(langCode);
              return (
              <div key={`language-${index}`} className="grid grid-cols-1 md:grid-cols-7 gap-2 items-center">
                <input
                  type="text"
                  value={lang.label}
                  onChange={(e) => handleLanguageChange(index, 'label', e.target.value)}
                  placeholder="Sprache (Label)"
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="text"
                  value={lang.code}
                  list="language-code-suggestions"
                  autoComplete="off"
                  onChange={(e) => handleLanguageChange(index, 'code', e.target.value.toLowerCase())}
                  placeholder="Code (z.B. de)"
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="text"
                  value={lang.flag || ''}
                  onChange={(e) => handleLanguageChange(index, 'flag', e.target.value)}
                  placeholder="Flagge"
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="text"
                  value={lang.aiName || ''}
                  onChange={(e) => handleLanguageChange(index, 'aiName', e.target.value)}
                  placeholder="KI-Name (optional)"
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="text"
                  value={lang.locale || ''}
                  onChange={(e) => handleLanguageChange(index, 'locale', e.target.value)}
                  placeholder="Locale (optional)"
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
                <select
                  value={lang.dir || 'ltr'}
                  onChange={(e) => handleLanguageChange(index, 'dir', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="ltr">LTR</option>
                  <option value="rtl">RTL</option>
                </select>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => generateTranslationsForLanguage(lang)}
                    disabled={translationLoading === langCode}
                  >
                    {translationLoading === langCode ? 'Übersetze...' : 'Übersetzung erzeugen'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => removeLanguage(index)}
                  >
                    Entfernen
                  </button>
                  <span className={`text-xs ${hasTranslation ? 'text-green-700' : 'text-slate-500'}`}>
                    {hasTranslation ? 'Übersetzt' : 'Nicht übersetzt'}
                  </span>
                </div>
              </div>
            );
            })}
          </div>
          <datalist id="language-code-suggestions">
            {COMMON_LANGUAGES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.label}
              </option>
            ))}
          </datalist>
          <button type="button" className="btn btn-secondary mt-3" onClick={addLanguage}>
            <i className="fa-solid fa-plus" /> Sprache hinzufügen
          </button>
          <p className="text-xs text-gray-500 mt-2">
            Freitext möglich. Die KI nutzt den angegebenen Namen zur Übersetzung.
          </p>
        </div>
        {renderBlockSaveButton()}
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-emerald-900 mb-1">
              <i className="fa-solid fa-language" /> Gespeicherte Übersetzungen
            </h3>
            <p className="text-sm text-emerald-800">
              Zentrale Verwaltung von Cache-Lebensdauer, Vollständigkeit und fehlenden Teilen.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void fetchTranslationCoverage()}
            disabled={translationCoverageLoading}
          >
            {translationCoverageLoading ? (
              <span><i className="fa-solid fa-spinner fa-spin" /> Lade...</span>
            ) : (
              <span><i className="fa-solid fa-rotate" /> Übersicht aktualisieren</span>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-emerald-900">
              TTL für Übersetzungs-Cache (Tage)
              <input
                type="number"
                min={1}
                max={3650}
                value={translationCacheTtlDays}
                onChange={(e) => setTranslationCacheTtlDays(Number(e.target.value || translationCacheTtlDays))}
                className="mt-1 w-full px-3 py-2 border border-emerald-300 rounded-lg"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-emerald-900">
              <input
                type="checkbox"
                checked={translationCachePruneNow}
                onChange={(e) => setTranslationCachePruneNow(e.target.checked)}
              />
              Beim Speichern sofort abgelaufene UI- und E-Mail-Übersetzungen löschen
            </label>
            <button
              type="button"
              onClick={handleSaveTranslationCachePolicy}
              disabled={translationCacheLoading}
              className="btn btn-secondary"
            >
              {translationCacheLoading ? (
                <span><i className="fa-solid fa-spinner fa-spin" /> Speichere...</span>
              ) : (
                <span><i className="fa-solid fa-floppy-disk" /> TTL speichern</span>
              )}
            </button>
            {translationCacheMessage && (
              <div className="text-sm text-green-700">
                <i className="fa-solid fa-circle-check" /> {translationCacheMessage}
              </div>
            )}
            {translationCacheError && (
              <div className="text-sm text-red-700">
                <i className="fa-solid fa-circle-xmark" /> {translationCacheError}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-emerald-300 bg-white p-4 text-sm text-slate-700">
            <div className="font-semibold text-slate-900 mb-2">Abdeckung</div>
            {translationCoverage ? (
              <div className="space-y-1">
                <div>UI-Quelltexte: {translationCoverage.source.uiTotal}</div>
                <div>E-Mail-Templates: {translationCoverage.source.emailTemplateTotal}</div>
                <div>Sprachen mit Cache-Einträgen: {translationCoverage.languages.length}</div>
                <div className="text-xs text-slate-500">
                  Stand: {translationCoverage.generatedAt ? new Date(translationCoverage.generatedAt).toLocaleString() : '—'}
                </div>
              </div>
            ) : (
              <div>Keine Daten geladen.</div>
            )}
          </div>
        </div>

        {(translationCoverageMessage || translationCoverageError) && (
          <div className="text-sm">
            {translationCoverageMessage && (
              <div className="text-green-700">
                <i className="fa-solid fa-circle-check" /> {translationCoverageMessage}
              </div>
            )}
            {translationCoverageError && (
              <div className="text-red-700">
                <i className="fa-solid fa-circle-xmark" /> {translationCoverageError}
              </div>
            )}
          </div>
        )}

        {translationCoverageLoading ? (
          <div className="text-sm text-slate-600">
            <i className="fa-solid fa-spinner fa-spin" /> Lade Übersetzungsübersicht...
          </div>
        ) : translationCoverage && translationCoverage.languages.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-emerald-300 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-emerald-100 text-emerald-900">
                <tr>
                  <th className="px-3 py-2 text-left">Sprache</th>
                  <th className="px-3 py-2 text-left">Gesamt</th>
                  <th className="px-3 py-2 text-left">UI</th>
                  <th className="px-3 py-2 text-left">E-Mail</th>
                  <th className="px-3 py-2 text-left">Fehlt</th>
                  <th className="px-3 py-2 text-left">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {translationCoverage.languages.map((entry) => {
                  const language = entry.language;
                  const langBusy = !!translationCoverageBusyByKey[`lang:${language}`];
                  const deleteBusy = !!translationCoverageBusyByKey[`delete:${language}`];
                  const expanded = translationCoverageExpandedLanguage === language;
                  return (
                    <React.Fragment key={`coverage-${language}`}>
                      <tr className="border-t border-emerald-100 align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">
                            {entry.label} ({language})
                          </div>
                          <div className="text-xs text-slate-500">
                            {entry.configured ? 'Konfiguriert' : 'Nur im Cache vorhanden'}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold">{entry.overall.percent.toFixed(1)}%</div>
                          <div className="text-xs text-slate-500">
                            {entry.overall.translated}/{entry.overall.total}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div>{entry.ui.percent.toFixed(1)}%</div>
                          <div className="text-xs text-slate-500">
                            {entry.ui.translated}/{entry.ui.total}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div>{entry.email.percent.toFixed(1)}%</div>
                          <div className="text-xs text-slate-500">
                            {entry.email.translated}/{entry.email.total}
                          </div>
                        </td>
                        <td className="px-3 py-2">{entry.overall.missing}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={langBusy || entry.overall.missing === 0}
                              onClick={() =>
                                void runRetranslate({
                                  language,
                                  includeUi: true,
                                  includeEmail: true,
                                  successMessage: `Fehlende Übersetzungen für ${language} wurden nachgezogen.`,
                                  busyKey: `lang:${language}`,
                                })
                              }
                            >
                              {langBusy ? 'Übersetze...' : 'Fehlendes nachübersetzen'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              disabled={deleteBusy}
                              onClick={() => void handleDeleteTranslationsForLanguage(language)}
                            >
                              {deleteBusy ? 'Lösche...' : 'Löschen'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() =>
                                setTranslationCoverageExpandedLanguage((prev) =>
                                  prev === language ? '' : language
                                )
                              }
                            >
                              {expanded ? 'Details ausblenden' : 'Details'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-t border-emerald-100 bg-emerald-50/30">
                          <td colSpan={6} className="px-3 py-3">
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                              <div className="rounded-lg border border-emerald-200 bg-white p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-medium text-slate-900">
                                    Fehlende UI-Keys ({entry.missingUiKeys.length})
                                  </div>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    disabled={langBusy || entry.missingUiKeys.length === 0}
                                    onClick={() =>
                                      void runRetranslate({
                                        language,
                                        includeUi: true,
                                        includeEmail: false,
                                        busyKey: `lang:${language}`,
                                        successMessage: `Fehlende UI-Übersetzungen für ${language} wurden nachgezogen.`,
                                      })
                                    }
                                  >
                                    UI nachübersetzen
                                  </button>
                                </div>
                                {entry.missingUiKeys.length === 0 ? (
                                  <div className="text-sm text-green-700">Keine fehlenden UI-Keys.</div>
                                ) : (
                                  <div className="max-h-52 overflow-auto space-y-2">
                                    {entry.missingUiKeys.map((key) => {
                                      const keyBusy = !!translationCoverageBusyByKey[`ui:${language}:${key}`];
                                      return (
                                        <div
                                          key={`missing-ui-${language}-${key}`}
                                          className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1 bg-slate-50"
                                        >
                                          <code className="text-xs">{key}</code>
                                          <button
                                            type="button"
                                            className="btn btn-secondary"
                                            disabled={keyBusy}
                                            onClick={() =>
                                              void runRetranslate({
                                                language,
                                                includeUi: true,
                                                includeEmail: false,
                                                uiKeys: [key],
                                                busyKey: `ui:${language}:${key}`,
                                                successMessage: `UI-Key "${key}" wurde nachübersetzt.`,
                                              })
                                            }
                                          >
                                            {keyBusy ? 'Läuft...' : 'Nachübersetzen'}
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              <div className="rounded-lg border border-emerald-200 bg-white p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-medium text-slate-900">
                                    Fehlende E-Mail-Teile ({entry.missingEmailTemplates.length})
                                  </div>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    disabled={langBusy || entry.missingEmailTemplates.length === 0}
                                    onClick={() =>
                                      void runRetranslate({
                                        language,
                                        includeUi: false,
                                        includeEmail: true,
                                        busyKey: `lang:${language}`,
                                        successMessage: `Fehlende E-Mail-Übersetzungen für ${language} wurden nachgezogen.`,
                                      })
                                    }
                                  >
                                    E-Mail nachübersetzen
                                  </button>
                                </div>
                                {entry.missingEmailTemplates.length === 0 ? (
                                  <div className="text-sm text-green-700">Keine fehlenden E-Mail-Übersetzungen.</div>
                                ) : (
                                  <div className="max-h-52 overflow-auto space-y-2">
                                    {entry.missingEmailTemplates.map((template) => {
                                      const tplBusy = !!translationCoverageBusyByKey[
                                        `email:${language}:${template.templateId}`
                                      ];
                                      return (
                                        <div
                                          key={`missing-email-${language}-${template.templateId}`}
                                          className="rounded border border-slate-200 px-2 py-2 bg-slate-50"
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <div>
                                              <div className="text-sm font-medium text-slate-900">
                                                {template.templateName}
                                              </div>
                                              <div className="text-xs text-slate-500">
                                                {template.templateId} · {formatMissingEmailReason(template.reason)}
                                              </div>
                                            </div>
                                            <button
                                              type="button"
                                              className="btn btn-secondary"
                                              disabled={tplBusy}
                                              onClick={() =>
                                                void runRetranslate({
                                                  language,
                                                  includeUi: false,
                                                  includeEmail: true,
                                                  emailTemplateIds: [template.templateId],
                                                  busyKey: `email:${language}:${template.templateId}`,
                                                  successMessage: `Template "${template.templateId}" wurde nachübersetzt.`,
                                                })
                                              }
                                            >
                                              {tplBusy ? 'Läuft...' : 'Nachübersetzen'}
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-slate-600">
            Keine gespeicherten Übersetzungen gefunden.
          </div>
        )}
      </div>
      </section>
      )}

      {showMaintenance && (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-database text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-900">Wartung & Daten</h3>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 xl:col-span-2 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-emerald-900 mb-1">
                <i className="fa-solid fa-arrows-rotate" /> System-Updates (geführt)
              </h3>
              <p className="text-sm text-emerald-800">
                Manuelles Update mit Preflight, Backup-Gate und Runbook. Es werden keine Server-Kommandos automatisch ausgeführt.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    preflightHealth === 'healthy'
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                      : preflightHealth === 'error'
                        ? 'border-red-300 bg-red-100 text-red-800'
                        : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  <i className={`fa-solid ${preflightHealth === 'healthy' ? 'fa-circle-check' : preflightHealth === 'error' ? 'fa-circle-xmark' : 'fa-circle-dot'}`} />
                  Preflight {preflightHealth === 'healthy' ? 'freigegeben' : preflightHealth === 'error' ? 'blockiert' : 'ausstehend'}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                  <i className="fa-solid fa-clock" />
                  Status geprüft: {formatDateTimeSafe(updateStatus?.checkedAt)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void fetchUpdateStatus({ record: true })}
                disabled={updateStatusLoading}
              >
                {updateStatusLoading ? <span><i className="fa-solid fa-spinner fa-spin" /> Lade...</span> : <span><i className="fa-solid fa-rotate" /> Status</span>}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void runUpdatePreflight()} disabled={updatePreflightLoading}>
                {updatePreflightLoading ? <span><i className="fa-solid fa-spinner fa-spin" /> Prüfe...</span> : <span><i className="fa-solid fa-shield-halved" /> Preflight</span>}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void fetchUpdateRunbook()} disabled={updateRunbookLoading}>
                {updateRunbookLoading ? <span><i className="fa-solid fa-spinner fa-spin" /> Lade...</span> : <span><i className="fa-solid fa-list-check" /> Runbook</span>}
              </button>
              {updateRunbook?.commands?.length ? (
                <button type="button" className="btn btn-secondary" onClick={() => void copyUpdateRunbook()}>
                  <i className="fa-solid fa-copy" /> {updateRunbookCopied === 'success' ? 'Kopiert' : updateRunbookCopied === 'error' ? 'Kopieren fehlgeschlagen' : 'Kopieren'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            <div className="rounded-lg border border-emerald-200 bg-white p-3">
              <div className="text-xs text-slate-500">Aktuelle Version</div>
              <div className="text-sm font-semibold text-slate-900">{updateStatus?.currentVersion || '—'}</div>
              <div className="mt-1 text-xs text-slate-500">Tag: {updateStatus?.latestTagVersion || '—'}</div>
              <div className="mt-1 text-xs text-slate-500">Build: {updateStatus?.build?.envBuildId || '—'}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-white p-3">
              <div className="text-xs text-slate-500">Git</div>
              <div className={`text-sm font-semibold ${gitHealth === 'healthy' ? 'text-emerald-700' : gitHealth === 'warning' ? 'text-amber-700' : 'text-red-700'}`}>
                {updateStatus?.git?.available ? `${updateStatus.git.branch || '—'}${updateStatus.git.dirty ? ' (dirty)' : ''}` : 'nicht verfügbar'}
              </div>
              <div className="mt-1 text-xs text-slate-500">{updateStatus?.git?.headCommit || '—'}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-white p-3">
              <div className="text-xs text-slate-500">Backup-Status</div>
              <div className={`text-sm font-semibold ${backupHealth === 'healthy' ? 'text-emerald-700' : backupHealth === 'stale' ? 'text-amber-700' : 'text-red-700'}`}>
                {updateStatus?.backup?.available
                  ? updateStatus.backup.isFresh
                    ? `OK (${updateStatus.backup.ageHours}h)`
                    : `zu alt (${updateStatus.backup.ageHours}h)`
                  : 'fehlt'}
              </div>
              <div className="mt-1 text-xs text-slate-500">{formatDateTimeSafe(updateStatus?.backup?.latestAt)}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-white p-3">
              <div className="text-xs text-slate-500">Migrationen</div>
              <div className={`text-sm font-semibold ${migrationHealth === 'healthy' ? 'text-emerald-700' : 'text-red-700'}`}>
                {updateStatus?.migrations?.appliedCount ?? 0} / {updateStatus?.migrations?.migrationFilesCount ?? 0}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Pending: {updateStatus?.migrations?.pendingCount ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-white p-3">
              <div className="text-xs text-slate-500">Preflight</div>
              <div className={`text-sm font-semibold ${preflightHealth === 'healthy' ? 'text-emerald-700' : preflightHealth === 'error' ? 'text-red-700' : 'text-slate-900'}`}>
                {preflightHealth === 'healthy' ? 'freigegeben' : preflightHealth === 'error' ? 'blockiert' : 'noch nicht gelaufen'}
              </div>
              <div className="mt-1 text-xs text-slate-500">{formatDateTimeSafe(updatePreflight?.checkedAt)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block text-sm font-medium text-emerald-900 md:col-span-1">
              Ziel-Tag/Branch
              <input
                type="text"
                value={updateTargetTag}
                onChange={(e) => setUpdateTargetTag(e.target.value)}
                placeholder={updateStatus?.latestTagVersion || 'z. B. v1.2.3'}
                className="mt-1 w-full px-3 py-2 border border-emerald-300 rounded-lg"
              />
            </label>
            <div className="md:col-span-2 text-xs text-emerald-900 bg-white border border-emerald-200 rounded-lg px-3 py-2 space-y-1">
              <div>
                Runtime: <strong>{updateStatus?.runtimeType || '—'}</strong> · Ziel: <strong>{updateTargetTag.trim() || updateStatus?.latestTagVersion || '—'}</strong>
              </div>
              <div>
                Backup-Pfad: <span className="font-mono">{updateStatus?.backup?.latestPath || '—'}</span>
              </div>
              <div>
                Commit: <span className="font-mono">{updateStatus?.build?.envCommitRef || updateStatus?.git?.headCommit || '—'}</span> · Build-Zeit:{' '}
                <strong>{formatDateTimeSafe(updateStatus?.build?.envBuildTime)}</strong>
              </div>
            </div>
          </div>

          {updateStatusError && (
            <div className="text-sm text-red-700">
              <i className="fa-solid fa-circle-xmark" /> {updateStatusError}
            </div>
          )}
          {updatePreflightError && (
            <div className="text-sm text-red-700">
              <i className="fa-solid fa-circle-xmark" /> {updatePreflightError}
            </div>
          )}
          {updateRunbookError && (
            <div className="text-sm text-red-700">
              <i className="fa-solid fa-circle-xmark" /> {updateRunbookError}
            </div>
          )}
          {updateHistoryError && (
            <div className="text-sm text-red-700">
              <i className="fa-solid fa-circle-xmark" /> {updateHistoryError}
            </div>
          )}

          {updatePreflight && (
            <div className={`rounded-lg border px-3 py-3 ${updatePreflight.ok ? 'border-emerald-300 bg-white' : 'border-red-300 bg-red-50'}`}>
              <div className="text-sm font-semibold mb-1">
                {resolveUpdateReportKindLabel(updatePreflight.kind)}: {updatePreflight.ok ? 'freigegeben' : 'blockiert'}
              </div>
              {updatePreflight.blockedReasons?.length > 0 && (
                <ul className="list-disc ml-5 text-sm text-red-700">
                  {updatePreflight.blockedReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              <div className="mt-2 text-xs text-slate-600">
                Dauer: {updatePreflight.durationMs} ms · geprüft: {updatePreflight.checkedAt ? new Date(updatePreflight.checkedAt).toLocaleString('de-DE') : '—'}
              </div>
              {updatePreflightCheckEntries.length > 0 ? (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {updatePreflightCheckEntries.map(([checkKey, checkValue]) => (
                    <div key={checkKey} className="rounded border border-slate-200 bg-white px-2 py-2">
                      <div className={`text-xs font-semibold ${checkValue?.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                        <i className={`fa-solid ${checkValue?.ok ? 'fa-circle-check' : 'fa-circle-xmark'}`} />{' '}
                        {resolveUpdateCheckLabel(checkKey)}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">{checkValue?.detail || '—'}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {updateRunbook?.commands?.length ? (
            <div className="rounded-lg border border-emerald-200 bg-white p-3">
              <div className="text-sm font-semibold text-slate-900 mb-2">
                Runbook-Kommandos ({updateRunbook.runtimeType}) · generiert: {formatDateTimeSafe(updateRunbook.generatedAt)}
              </div>
              <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-3 overflow-auto max-h-80">
{updateRunbook.commands.join('\n')}
              </pre>
              {Array.isArray(updateRunbook.notes) && updateRunbook.notes.length > 0 ? (
                <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {updateRunbook.notes.map((note, index) => (
                    <div key={`${note}-${index}`}>- {note}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-lg border border-emerald-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-sm font-semibold text-slate-900">Preflight-Historie</div>
              <button type="button" className="btn btn-secondary" onClick={() => void fetchUpdateHistory()} disabled={updateHistoryLoading}>
                {updateHistoryLoading ? <span><i className="fa-solid fa-spinner fa-spin" /> Lade...</span> : <span><i className="fa-solid fa-clock-rotate-left" /> Aktualisieren</span>}
              </button>
            </div>
            {updateHistory.length === 0 ? (
              <div className="text-sm text-slate-600">Noch keine Einträge.</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-auto">
                {updateHistory.map((entry) => (
                  <div key={entry.id} className="rounded border border-slate-200 px-2 py-2 text-xs">
                    <div className="font-semibold text-slate-800">
                      {entry.createdAt ? new Date(entry.createdAt).toLocaleString('de-DE') : '—'} · {resolveUpdateReportKindLabel(entry.report?.kind)} ·{' '}
                      {entry.report?.ok ? 'OK' : 'BLOCKIERT'}
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      Nutzer: {entry.username || '—'} · Admin-ID: {entry.adminUserId || '—'}
                    </div>
                    {Array.isArray(entry.report?.blockedReasons) && entry.report.blockedReasons.length > 0 ? (
                      <div className="text-red-700 mt-1">
                        {entry.report.blockedReasons.join(' | ')}
                      </div>
                    ) : (
                      <div className="text-emerald-700 mt-1">Keine Blocker</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
          <h3 className="font-semibold text-slate-900 mb-2">
            <i className="fa-solid fa-database" /> Datenbanksicherung
          </h3>
          <p className="text-sm text-slate-700 mb-4">
            Exportieren Sie einen SQL-Dump oder importieren Sie einen vorhandenen Dump.
          </p>
          {backupMessage && (
            <div className="text-sm text-green-700 mb-2">
              <i className="fa-solid fa-circle-check" /> {backupMessage}
            </div>
          )}
          {backupError && (
            <div className="text-sm text-red-700 mb-2">
              <i className="fa-solid fa-circle-xmark" /> {backupError}
            </div>
          )}
          <button
            onClick={handleBackup}
            disabled={backupLoading}
            className="btn btn-secondary mb-4"
          >
            {backupLoading ? (
              <span><i className="fa-solid fa-spinner fa-spin" /> Exportiere...</span>
            ) : (
              <span><i className="fa-solid fa-file-export" /> SQL-Dump exportieren</span>
            )}
          </button>

          <div className="border-t border-slate-200 pt-4 mt-4 space-y-3">
            <label className="block text-sm font-medium">SQL-Dump importieren</label>
            <input
              type="file"
              accept=".sql,text/plain"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
            {importMessage && (
              <div className="text-sm text-green-700">
                <i className="fa-solid fa-circle-check" /> {importMessage}
              </div>
            )}
            {importError && (
              <div className="text-sm text-red-700">
                <i className="fa-solid fa-circle-xmark" /> {importError}
              </div>
            )}
            <button
              onClick={handleImport}
              disabled={importLoading}
              className="btn btn-danger"
            >
              {importLoading ? (
                <span><i className="fa-solid fa-spinner fa-spin" /> Importiere...</span>
              ) : (
                <span><i className="fa-solid fa-file-import" /> SQL-Dump importieren</span>
              )}
            </button>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
          <h3 className="font-semibold text-amber-800 mb-2">
            <i className="fa-solid fa-broom" /> Alt-Daten bereinigen
          </h3>
          <p className="text-sm text-amber-700 mb-4">
            Entfernt alte Betriebsdaten (z. B. abgelaufene Übersetzungen, abgeschlossene Queue-Einträge, alte Journaleinträge).
          </p>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-amber-900">
              Älter als (Tage)
              <input
                type="number"
                min={1}
                max={3650}
                value={cleanupDays}
                onChange={(e) => setCleanupDays(Number(e.target.value || cleanupDays))}
                className="mt-1 w-full px-3 py-2 border border-amber-300 rounded-lg"
              />
            </label>
            {cleanupMessage && (
              <div className="text-sm text-green-700">
                <i className="fa-solid fa-circle-check" /> {cleanupMessage}
              </div>
            )}
            {cleanupError && (
              <div className="text-sm text-red-700">
                <i className="fa-solid fa-circle-xmark" /> {cleanupError}
              </div>
            )}
            <button onClick={handleCleanupOldData} disabled={cleanupLoading} className="btn btn-secondary">
              {cleanupLoading ? (
                <span><i className="fa-solid fa-spinner fa-spin" /> Bereinige...</span>
              ) : (
                <span><i className="fa-solid fa-broom" /> Alte Daten bereinigen</span>
              )}
            </button>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 mb-2">
            <i className="fa-solid fa-box-archive" /> Alte Tickets archivieren
          </h3>
          <p className="text-sm text-blue-800 mb-4">
            Exportiert Tickets als JSON und löscht sie anschließend aus der Datenbank.
          </p>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-blue-900">
              Älter als (Tage)
              <input
                type="number"
                min={1}
                max={3650}
                value={archiveDays}
                onChange={(e) => setArchiveDays(Number(e.target.value || archiveDays))}
                className="mt-1 w-full px-3 py-2 border border-blue-300 rounded-lg"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-blue-900">
              <input
                type="checkbox"
                checked={archiveClosedOnly}
                onChange={(e) => setArchiveClosedOnly(e.target.checked)}
              />
              Nur abgeschlossene/geschlossene Tickets
            </label>
            {archiveMessage && (
              <div className="text-sm text-green-700">
                <i className="fa-solid fa-circle-check" /> {archiveMessage}
              </div>
            )}
            {archiveError && (
              <div className="text-sm text-red-700">
                <i className="fa-solid fa-circle-xmark" /> {archiveError}
              </div>
            )}
            <button onClick={handleArchiveOldTickets} disabled={archiveLoading} className="btn btn-secondary">
              {archiveLoading ? (
                <span><i className="fa-solid fa-spinner fa-spin" /> Archiviere...</span>
              ) : (
                <span><i className="fa-solid fa-file-export" /> Exportieren und löschen</span>
              )}
            </button>
          </div>
        </div>

        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="font-semibold text-indigo-900 mb-1">
                <i className="fa-solid fa-database" /> Datenbank-Überblick
              </h3>
              <p className="text-sm text-indigo-800">
                Zeigt Dateigröße, Tabellen und Struktur (inkl. Spalten und Beziehungen).
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void fetchDatabaseStructure()}
              disabled={dbStructureLoading}
            >
              {dbStructureLoading ? (
                <span><i className="fa-solid fa-spinner fa-spin" /> Lade...</span>
              ) : (
                <span><i className="fa-solid fa-rotate" /> Aktualisieren</span>
              )}
            </button>
          </div>

          {dbStructureError && (
            <div className="text-sm text-red-700 mb-3">
              <i className="fa-solid fa-circle-xmark" /> {dbStructureError}
            </div>
          )}

          {dbStructure ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-indigo-200 bg-white p-3">
                  <div className="text-xs text-slate-500">DB-Größe</div>
                  <div className="font-semibold text-slate-900">
                    {formatBytes(dbStructure.database.sizeBytes)}
                  </div>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-white p-3">
                  <div className="text-xs text-slate-500">Tabellen</div>
                  <div className="font-semibold text-slate-900">{dbStructure.tableCount}</div>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-white p-3">
                  <div className="text-xs text-slate-500">Page Count</div>
                  <div className="font-semibold text-slate-900">{dbStructure.database.pageCount}</div>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-white p-3">
                  <div className="text-xs text-slate-500">Page Size</div>
                  <div className="font-semibold text-slate-900">{formatBytes(dbStructure.database.pageSize)}</div>
                </div>
              </div>

              <div className="space-y-2">
                {dbStructure.tables.map((table) => (
                  <details key={`db-table-${table.name}`} className="rounded-lg border border-indigo-200 bg-white p-3">
                    <summary className="cursor-pointer flex items-center justify-between gap-3">
                      <span className="font-semibold text-slate-900">{table.name}</span>
                      <span className="text-xs text-slate-500">
                        {table.rowCount} Zeilen · {table.columns.length} Spalten
                      </span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase mb-1">Spalten</div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-100">
                              <tr>
                                <th className="px-2 py-1 text-left">Name</th>
                                <th className="px-2 py-1 text-left">Typ</th>
                                <th className="px-2 py-1 text-left">Not Null</th>
                                <th className="px-2 py-1 text-left">PK</th>
                                <th className="px-2 py-1 text-left">Default</th>
                              </tr>
                            </thead>
                            <tbody>
                              {table.columns.map((column) => (
                                <tr key={`col-${table.name}-${column.name}`} className="border-t border-slate-200">
                                  <td className="px-2 py-1"><code>{column.name}</code></td>
                                  <td className="px-2 py-1">{column.type || '—'}</td>
                                  <td className="px-2 py-1">{column.notNull ? 'ja' : 'nein'}</td>
                                  <td className="px-2 py-1">{column.primaryKeyOrder > 0 ? column.primaryKeyOrder : '—'}</td>
                                  <td className="px-2 py-1">
                                    {column.defaultValue === null || column.defaultValue === undefined
                                      ? '—'
                                      : String(column.defaultValue)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase mb-1">
                          Fremdschlüssel ({table.foreignKeys.length})
                        </div>
                        {table.foreignKeys.length === 0 ? (
                          <div className="text-xs text-slate-500">Keine Fremdschlüssel.</div>
                        ) : (
                          <div className="space-y-1">
                            {table.foreignKeys.map((fk) => (
                              <div key={`fk-${table.name}-${fk.id}-${fk.seq}`} className="text-xs text-slate-700">
                                <code>{fk.from}</code> → <code>{fk.table}.{fk.to}</code> (onUpdate: {fk.onUpdate || '—'}, onDelete: {fk.onDelete || '—'})
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <details className="rounded border border-slate-200 bg-slate-50 p-2">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                          CREATE-SQL anzeigen
                        </summary>
                        <pre className="mt-2 text-xs whitespace-pre-wrap text-slate-700">
                          {table.createSql || '-- keine Definition verfügbar --'}
                        </pre>
                      </details>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-600">
              {dbStructureLoading
                ? 'DB-Struktur wird geladen...'
                : 'Noch keine DB-Strukturdaten geladen.'}
            </div>
          )}
        </div>

        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="font-semibold text-red-800 mb-2"><i className="fa-solid fa-triangle-exclamation" /> Gefahrenzone</h3>
          <p className="text-sm text-red-700 mb-4">
            Löscht alle Tickets, Workflow-Definitionen und zugehörige Daten aus der Datenbank. Dieser Vorgang ist irreversibel.
          </p>
          {purgeMessage && (
            <div className="text-sm text-green-700 mb-2">
              <i className="fa-solid fa-circle-check" /> {purgeMessage}
            </div>
          )}
          {purgeError && (
            <div className="text-sm text-red-700 mb-2">
              <i className="fa-solid fa-circle-xmark" /> {purgeError}
            </div>
          )}
          <button
            onClick={handlePurge}
            disabled={purgeLoading}
            className="btn btn-danger"
          >
              {purgeLoading ? (
                <span><i className="fa-solid fa-spinner fa-spin" /> Lösche...</span>
              ) : (
                <span><i className="fa-solid fa-trash" /> Alle Tickets & Workflow-Definitionen löschen</span>
              )}
            </button>
          </div>
      </div>
      </section>
      )}
    </div>
  );
};

export default GeneralSettings;
