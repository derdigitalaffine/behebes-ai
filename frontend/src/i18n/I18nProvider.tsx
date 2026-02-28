import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LANGUAGE, getLanguageOption, LANGUAGES, LanguageOption } from './languages';
import { STRINGS } from './strings';
import { ensureServiceWorkerScope } from '../service-worker';

type Translations = Record<string, string>;

type CitizenAnnouncementTranslation = {
  title?: string;
  message?: string;
  sourceHash?: string;
};

type CitizenAnnouncementConfig = {
  enabled: boolean;
  mode: 'banner' | 'modal';
  title: string;
  message: string;
  sourceHash: string;
  translations: Record<string, CitizenAnnouncementTranslation>;
};

type CitizenAnnouncement = {
  enabled: boolean;
  mode: 'banner' | 'modal';
  title: string;
  message: string;
  sourceHash: string;
};

export type CitizenProfileTexts = {
  headerTag: string;
  headerKicker: string;
  headerTitle: string;
  headerSubtitle: string;
  submissionKicker: string;
  submissionTitle: string;
  submissionSubtitle: string;
};

export type JurisdictionGeofence =
  | {
      enabled: false;
      shape: 'circle' | 'polygon';
      centerLat?: number;
      centerLon?: number;
      radiusMeters?: number;
      points?: Array<{ lat: number; lon: number }>;
    }
  | {
      enabled: true;
      shape: 'circle' | 'polygon';
      centerLat?: number;
      centerLon?: number;
      radiusMeters?: number;
      points?: Array<{ lat: number; lon: number }>;
    };

export type PublicRoutingConfig = {
  rootMode: 'platform' | 'tenant';
  rootTenantId: string;
  platformPath: string;
  tenantBasePath: '/c';
  resolvedTenantSlug: string;
  canonicalBasePath: string;
  tenantMismatch: boolean;
};

function normalizeJurisdictionGeofence(input: unknown): JurisdictionGeofence {
  const source = input && typeof input === 'object' ? (input as Record<string, any>) : {};
  const points = Array.isArray(source.points)
    ? source.points
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const lat = Number((entry as any).lat ?? (entry as any).latitude);
          const lon = Number((entry as any).lon ?? (entry as any).lng ?? (entry as any).longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          return { lat, lon };
        })
        .filter((entry): entry is { lat: number; lon: number } => entry !== null)
    : [];
  return {
    enabled: source.enabled === true,
    shape: source.shape === 'polygon' ? 'polygon' : 'circle',
    centerLat: Number.isFinite(Number(source.centerLat)) ? Number(source.centerLat) : undefined,
    centerLon: Number.isFinite(Number(source.centerLon)) ? Number(source.centerLon) : undefined,
    radiusMeters: Number.isFinite(Number(source.radiusMeters)) ? Number(source.radiusMeters) : undefined,
    points,
  };
}

const sanitizeAnnouncementText = (value: unknown, maxLength: number): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : '';
};

const sanitizeProfileText = (value: unknown, maxLength: number): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : '';
};

const parseEnabledFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return false;
};

const buildAnnouncementSourceHash = (title: string, message: string): string => {
  const source = `${title}\n${message}`.trim();
  if (!source) return '';
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const normalizeAnnouncementTranslations = (
  input: unknown
): Record<string, CitizenAnnouncementTranslation> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const result: Record<string, CitizenAnnouncementTranslation> = {};
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

const normalizeCitizenAnnouncementConfig = (input: unknown): CitizenAnnouncementConfig => {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const title = sanitizeAnnouncementText(source.announcementTitle, 240);
  const message = sanitizeAnnouncementText(source.announcementMessage, 4000);
  const sourceHashRaw =
    typeof source.announcementSourceHash === 'string' && source.announcementSourceHash.trim()
      ? source.announcementSourceHash.trim().slice(0, 128)
      : '';
  const sourceHash = sourceHashRaw || buildAnnouncementSourceHash(title, message);
  const modeRaw = String(source.announcementMode || '').trim().toLowerCase();
  return {
    enabled: parseEnabledFlag(source.announcementEnabled),
    mode: modeRaw === 'modal' ? 'modal' : 'banner',
    title,
    message,
    sourceHash,
    translations: normalizeAnnouncementTranslations(source.announcementTranslations),
  };
};

const areAnnouncementTranslationsEqual = (
  left: Record<string, CitizenAnnouncementTranslation>,
  right: Record<string, CitizenAnnouncementTranslation>
): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    const leftEntry = left[key] || {};
    const rightEntry = right[key] || {};
    if (
      (leftEntry.title || '') !== (rightEntry.title || '') ||
      (leftEntry.message || '') !== (rightEntry.message || '') ||
      (leftEntry.sourceHash || '') !== (rightEntry.sourceHash || '')
    ) {
      return false;
    }
  }
  return true;
};

const areCitizenAnnouncementConfigsEqual = (
  left: CitizenAnnouncementConfig,
  right: CitizenAnnouncementConfig
): boolean => {
  return (
    left.enabled === right.enabled &&
    left.mode === right.mode &&
    left.title === right.title &&
    left.message === right.message &&
    left.sourceHash === right.sourceHash &&
    areAnnouncementTranslationsEqual(left.translations, right.translations)
  );
};

const resolveCitizenAnnouncement = (
  config: CitizenAnnouncementConfig,
  languageCode: string,
  defaultLanguageCode: string
): CitizenAnnouncement => {
  const normalizedLanguageCode = String(languageCode || '').toLowerCase();
  const normalizedDefaultCode = String(defaultLanguageCode || 'de').toLowerCase();
  const isGermanLanguage = normalizedLanguageCode === 'de' || normalizedLanguageCode.startsWith('de-');
  const isSourceLanguage = normalizedLanguageCode === normalizedDefaultCode || isGermanLanguage;
  const defaultTranslation = config.translations[normalizedDefaultCode];
  const targetTranslation = config.translations[normalizedLanguageCode];
  const matchingTarget =
    targetTranslation &&
    (!targetTranslation.sourceHash || !config.sourceHash || targetTranslation.sourceHash === config.sourceHash)
      ? targetTranslation
      : undefined;
  const matchingDefault =
    defaultTranslation &&
    (!defaultTranslation.sourceHash || !config.sourceHash || defaultTranslation.sourceHash === config.sourceHash)
      ? defaultTranslation
      : undefined;

  const resolvedTitle =
    isSourceLanguage
      ? matchingDefault?.title || config.title
      : matchingTarget?.title || '';
  const resolvedMessage =
    isSourceLanguage
      ? matchingDefault?.message || config.message
      : matchingTarget?.message || '';

  const hasVisibleContent =
    !!sanitizeAnnouncementText(resolvedTitle, 240) || !!sanitizeAnnouncementText(resolvedMessage, 4000);
  const translationReady = isSourceLanguage || !!matchingTarget;

  return {
    enabled: config.enabled && hasVisibleContent && translationReady,
    mode: config.mode,
    title: resolvedTitle,
    message: resolvedMessage,
    sourceHash: config.sourceHash,
  };
};

const normalizeCitizenProfileTexts = (input: unknown): CitizenProfileTexts => {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    headerTag: sanitizeProfileText(source.headerTag, 80),
    headerKicker: sanitizeProfileText(source.headerKicker, 120),
    headerTitle: sanitizeProfileText(source.headerTitle, 160),
    headerSubtitle: sanitizeProfileText(source.headerSubtitle, 240),
    submissionKicker: sanitizeProfileText(source.submissionKicker, 120),
    submissionTitle: sanitizeProfileText(source.submissionTitle, 160),
    submissionSubtitle: sanitizeProfileText(source.submissionSubtitle, 400),
  };
};

const normalizePublicPath = (input: unknown, fallback = '/'): string => {
  const rawInput = String(input || '').trim() || String(fallback || '/').trim() || '/';
  let raw = rawInput;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawInput)) {
    try {
      const parsed = new URL(rawInput);
      raw = parsed.pathname || '/';
    } catch {
      raw = rawInput;
    }
  }
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/g, '');
  const normalized = withoutTrailingSlash || '/';
  return normalized.length > 1 ? normalized.slice(0, 220) : normalized;
};

const normalizeTenantSlug = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);

const resolveTenantSlugFromPathname = (pathname: string, tenantBasePath = '/c'): string => {
  const base = normalizePublicPath(tenantBasePath, '/c');
  const normalizedPathname = normalizePublicPath(pathname, '/');
  const prefix = `${base}/`;
  if (!normalizedPathname.startsWith(prefix)) return '';
  const rest = normalizedPathname.slice(prefix.length);
  const slug = rest.split('/')[0] || '';
  return normalizeTenantSlug(slug);
};

const normalizePublicRoutingConfig = (input: unknown): PublicRoutingConfig => {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const rootMode = String(source.rootMode || '').trim().toLowerCase() === 'tenant' ? 'tenant' : 'platform';
  const rootTenantId = String(source.rootTenantId || '').trim().slice(0, 120);
  const platformPath = normalizePublicPath(source.platformPath, '/plattform');
  const tenantBasePath: '/c' = '/c';
  const resolvedTenantSlug = normalizeTenantSlug(source.resolvedTenantSlug);
  const canonicalBasePath = normalizePublicPath(source.canonicalBasePath, '/');
  const tenantMismatch = source.tenantMismatch === true;
  return {
    rootMode,
    rootTenantId,
    platformPath,
    tenantBasePath,
    resolvedTenantSlug,
    canonicalBasePath,
    tenantMismatch,
  };
};

const buildScopedPublicPath = (basePath: string, targetPath: string): string => {
  const normalizedBase = normalizePublicPath(basePath, '/');
  const normalizedTarget = normalizePublicPath(targetPath, '/');
  if (normalizedBase === '/') return normalizedTarget;
  if (normalizedTarget === '/') return normalizedBase;
  return `${normalizedBase}${normalizedTarget}`.replace(/\/{2,}/g, '/');
};

const toAbsoluteManifestUrl = (input: unknown, fallbackPath = '/'): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const raw = String(input || '').trim();
  if (!raw) {
    return origin ? new URL(normalizePublicPath(fallbackPath, '/'), origin).toString() : fallbackPath;
  }
  if (/^(data:|blob:|about:)/i.test(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      return new URL(raw).toString();
    } catch {
      return raw;
    }
  }
  const normalizedPath = normalizePublicPath(raw, fallbackPath);
  if (!origin) return normalizedPath;
  return new URL(normalizedPath, origin).toString();
};

type I18nContextValue = {
  language: string;
  locale: string;
  dir: 'ltr' | 'rtl';
  frontendToken: string;
  languages: LanguageOption[];
  isTranslating: boolean;
  setLanguage: (code: string) => void;
  addCustomLanguage: (language: LanguageOption) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  restrictLocations: boolean;
  allowedLocations: string[];
  jurisdictionGeofence: JurisdictionGeofence;
  defaultLanguage: string;
  sourceLanguageName: string;
  translationNotice: string;
  citizenAnnouncement: CitizenAnnouncement;
  citizenAuthEnabled: boolean;
  authenticatedIntakeWorkflowTemplateId: string;
  citizenProfileTexts: CitizenProfileTexts;
  routing: PublicRoutingConfig;
  canonicalBasePath: string;
  tenantMismatch: boolean;
  publicConfigLoaded: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_LANGUAGE_KEY = 'citizenLanguage';
const STORAGE_TRANSLATIONS_PREFIX = 'citizenTranslations_';
const STORAGE_CUSTOM_LANGUAGES = 'citizenCustomLanguages';
const STORAGE_FRONTEND_TOKEN_KEY = 'citizenFrontendToken';

const normalizeFrontendToken = (value: unknown): string => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 80);
};

const readStoredFrontendToken = (): string => {
  try {
    return normalizeFrontendToken(localStorage.getItem(STORAGE_FRONTEND_TOKEN_KEY));
  } catch {
    return '';
  }
};

const writeStoredFrontendToken = (token: string) => {
  const normalized = normalizeFrontendToken(token);
  try {
    if (normalized) {
      localStorage.setItem(STORAGE_FRONTEND_TOKEN_KEY, normalized);
    } else {
      localStorage.removeItem(STORAGE_FRONTEND_TOKEN_KEY);
    }
  } catch {
    // ignore
  }
};

const readFrontendTokenFromQuery = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search || '');
    const frontendToken = normalizeFrontendToken(params.get('frontendToken'));
    if (frontendToken) return frontendToken;
    const profileToken = normalizeFrontendToken(params.get('profileToken'));
    return profileToken;
  } catch {
    return '';
  }
};

const readPublicTokenFromQuery = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search || '');
    const token = String(params.get('token') || '').trim();
    return token ? token.slice(0, 240) : '';
  } catch {
    return '';
  }
};

const resolveCitizenFrontendToken = (): string => {
  const fromQuery = readFrontendTokenFromQuery();
  if (fromQuery) {
    writeStoredFrontendToken(fromQuery);
    return fromQuery;
  }
  return readStoredFrontendToken();
};

const TRANSLATION_NOTICE_FALLBACK: Record<string, string> = {
  de: 'Die KI übersetzt gerade. Das kann einen Moment dauern.',
  en: 'AI is translating. This can take a moment.',
  fr: 'La traduction par IA est en cours. Cela peut prendre un moment.',
  es: 'La IA está traduciendo. Esto puede tardar un momento.',
  it: 'L’IA sta traducendo. Potrebbe volerci un momento.',
  pt: 'A IA está traduzindo. Isso pode levar um momento.',
  nl: 'De AI is aan het vertalen. Dit kan even duren.',
  ru: 'ИИ переводит. Это может занять некоторое время.',
  zh: 'AI 正在翻译，可能需要一点时间。',
  ar: 'الذكاء الاصطناعي يترجم الآن. قد يستغرق الأمر لحظة.',
  hi: 'एआई अनुवाद कर रहा है। इसमें थोड़ा समय लग सकता है।',
  bn: 'এআই অনুবাদ করছে। এতে একটু সময় লাগতে পারে।',
  ur: 'اے آئی ترجمہ کر رہا ہے۔ اس میں تھوڑا وقت لگ سکتا ہے۔',
  id: 'AI sedang menerjemahkan. Ini mungkin memerlukan beberapa saat.',
  ja: 'AI が翻訳中です。少し時間がかかる場合があります。',
  ko: 'AI가 번역 중입니다. 잠시 시간이 걸릴 수 있습니다.',
  tr: 'Yapay zekâ çeviri yapıyor. Bu biraz zaman alabilir.',
  vi: 'AI đang dịch. Việc này có thể mất một chút thời gian.',
  pl: 'SI tłumaczy. To może chwilę potrwać.',
  sw: 'AI inatafsiri. Hii inaweza kuchukua muda kidogo.',
  th: 'AI กำลังแปล อาจใช้เวลาสักครู่',
};

const readCustomLanguages = (): LanguageOption[] => {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM_LANGUAGES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeCustomLanguages = (languages: LanguageOption[]) => {
  try {
    localStorage.setItem(STORAGE_CUSTOM_LANGUAGES, JSON.stringify(languages));
  } catch {
    // ignore
  }
};

const mergeLanguageLists = (...lists: LanguageOption[][]) => {
  const map = new Map<string, LanguageOption>();
  lists.forEach((list) => {
    list.forEach((lang) => {
      if (!lang?.code) return;
      const prev = map.get(lang.code) || {};
      map.set(lang.code, { ...prev, ...lang });
    });
  });
  return Array.from(map.values());
};

const interpolate = (template: string, vars?: Record<string, string | number>) => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [availableLanguages, setAvailableLanguages] = useState<LanguageOption[]>(LANGUAGES);
  const [defaultLanguage, setDefaultLanguage] = useState<string>(DEFAULT_LANGUAGE);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [restrictLocations, setRestrictLocations] = useState(false);
  const [allowedLocations, setAllowedLocations] = useState<string[]>([]);
  const [jurisdictionGeofence, setJurisdictionGeofence] = useState<JurisdictionGeofence>({
    enabled: false,
    shape: 'circle',
  });
  const [citizenAnnouncementConfig, setCitizenAnnouncementConfig] = useState<CitizenAnnouncementConfig>(
    normalizeCitizenAnnouncementConfig(null)
  );
  const [sourceLanguageName, setSourceLanguageName] = useState('German');
  const [translationNotice, setTranslationNotice] = useState(
    STRINGS.language_translating_hint || STRINGS.language_translating
  );
  const [citizenAuthEnabled, setCitizenAuthEnabled] = useState(true);
  const [authenticatedIntakeWorkflowTemplateId, setAuthenticatedIntakeWorkflowTemplateId] = useState('');
  const [citizenProfileTexts, setCitizenProfileTexts] = useState<CitizenProfileTexts>(
    normalizeCitizenProfileTexts(null)
  );
  const [routing, setRouting] = useState<PublicRoutingConfig>(() =>
    normalizePublicRoutingConfig(null)
  );
  const [canonicalBasePath, setCanonicalBasePath] = useState('/');
  const [tenantMismatch, setTenantMismatch] = useState(false);
  const [publicConfigLoaded, setPublicConfigLoaded] = useState(false);
  const [frontendToken, setFrontendToken] = useState<string>(() => resolveCitizenFrontendToken());
  const [language, setLanguageState] = useState<string>(() => {
    const stored = localStorage.getItem(STORAGE_LANGUAGE_KEY);
    if (stored) return stored;
    return DEFAULT_LANGUAGE;
  });
  const [translations, setTranslations] = useState<Translations>({});
  const [isTranslating, setIsTranslating] = useState(false);
  const translationRequestRef = useRef(0);
  const announcementTranslationRequestRef = useRef<Set<string>>(new Set());
  const manifestObjectUrlRef = useRef<string | null>(null);

  const languageOption = useMemo(
    () => getLanguageOption(language, availableLanguages),
    [language, availableLanguages]
  );

  const setLanguage = useCallback(
    (code: string) => {
      const normalized = availableLanguages.some((lang) => lang.code === code)
        ? code
        : defaultLanguage;
      setLanguageState(normalized);
      localStorage.setItem(STORAGE_LANGUAGE_KEY, normalized);
    },
    [availableLanguages, defaultLanguage]
  );

  const loadPublicConfig = useCallback(async () => {
    try {
      const nextFrontendToken = resolveCitizenFrontendToken();
      setFrontendToken((current) => (current === nextFrontendToken ? current : nextFrontendToken));
      const params = new URLSearchParams();
      if (nextFrontendToken) {
        params.set('frontendToken', nextFrontendToken);
      }
      const publicToken = readPublicTokenFromQuery();
      if (publicToken) {
        params.set('token', publicToken);
      }
      if (typeof window !== 'undefined') {
        const tenantSlug = resolveTenantSlugFromPathname(window.location.pathname, '/c');
        if (tenantSlug) {
          params.set('tenantSlug', tenantSlug);
        }
      }
      const publicConfigUrl = params.toString() ? `/api/config/public?${params.toString()}` : '/api/config/public';
      const response = await fetch(publicConfigUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      if (!response.ok) return;
      const data = await response.json();
      const nextRouting = normalizePublicRoutingConfig(data?.routing);
      setRouting(nextRouting);
      setCanonicalBasePath(nextRouting.canonicalBasePath || '/');
      setTenantMismatch(nextRouting.tenantMismatch === true);
      const incomingLanguages: LanguageOption[] = Array.isArray(data?.languages) ? data.languages : [];
      const configuredCodes = new Set(
        incomingLanguages
          .map((lang) => String(lang?.code || '').toLowerCase())
          .filter(Boolean)
      );
      const retainedCustomLanguages = readCustomLanguages().filter((lang) =>
        configuredCodes.has(String(lang?.code || '').toLowerCase())
      );
      writeCustomLanguages(retainedCustomLanguages);

      const normalizedIncoming = incomingLanguages.map((lang) => ({
        ...getLanguageOption(lang.code, LANGUAGES),
        ...lang,
        code: String(lang.code || '').toLowerCase(),
      }));
      const normalizedCustom = retainedCustomLanguages.map((lang) => ({
        ...getLanguageOption(lang.code, LANGUAGES),
        ...lang,
        code: String(lang.code || '').toLowerCase(),
      }));
      let mergedLanguages = mergeLanguageLists(normalizedIncoming, normalizedCustom).filter(
        (lang) => !!lang.code
      );
      if (mergedLanguages.length === 0) {
        mergedLanguages = [getLanguageOption(DEFAULT_LANGUAGE, LANGUAGES)];
      }
      setAvailableLanguages(mergedLanguages);

      let nextDefault = typeof data?.defaultLanguage === 'string' ? data.defaultLanguage : DEFAULT_LANGUAGE;
      if (!mergedLanguages.some((lang) => lang.code === nextDefault)) {
        nextDefault = mergedLanguages[0]?.code || DEFAULT_LANGUAGE;
      }
      setDefaultLanguage(nextDefault);

      const defaultLangOption = getLanguageOption(nextDefault, mergedLanguages);
      const nextSourceName = defaultLangOption.aiName || defaultLangOption.label || 'German';
      setSourceLanguageName(nextSourceName);

      setMaintenanceMode(!!data?.maintenanceMode);
      setMaintenanceMessage(typeof data?.maintenanceMessage === 'string' ? data.maintenanceMessage : '');
      setRestrictLocations(!!data?.restrictLocations);
      setAllowedLocations(
        Array.isArray(data?.allowedLocations)
          ? data.allowedLocations.filter((entry: unknown): entry is string => typeof entry === 'string')
          : []
      );
      setJurisdictionGeofence(normalizeJurisdictionGeofence(data?.jurisdictionGeofence));
      if (data?.citizenFrontend && typeof data.citizenFrontend === 'object') {
        const incomingAnnouncement = normalizeCitizenAnnouncementConfig(data.citizenFrontend);
        setCitizenAnnouncementConfig((previous) => {
          let next = incomingAnnouncement;
          if (
            previous.sourceHash &&
            incomingAnnouncement.sourceHash &&
            previous.sourceHash === incomingAnnouncement.sourceHash
          ) {
            next = {
              ...incomingAnnouncement,
              translations: {
                ...previous.translations,
                ...incomingAnnouncement.translations,
              },
            };
          }
          return areCitizenAnnouncementConfigsEqual(previous, next) ? previous : next;
        });
        setCitizenAuthEnabled(parseEnabledFlag((data.citizenFrontend as any).citizenAuthEnabled));
        setAuthenticatedIntakeWorkflowTemplateId(
          typeof (data.citizenFrontend as any).authenticatedIntakeWorkflowTemplateId === 'string'
            ? String((data.citizenFrontend as any).authenticatedIntakeWorkflowTemplateId).trim()
            : ''
        );
        setCitizenProfileTexts(normalizeCitizenProfileTexts((data.citizenFrontend as any).profileTexts));
      } else {
        setCitizenAuthEnabled(true);
        setAuthenticatedIntakeWorkflowTemplateId('');
        setCitizenProfileTexts(normalizeCitizenProfileTexts(null));
      }

      setLanguageState((current) => {
        const stored = localStorage.getItem(STORAGE_LANGUAGE_KEY);
        if (stored && mergedLanguages.some((lang) => lang.code === stored)) {
          return stored;
        }
        if (!mergedLanguages.some((lang) => lang.code === current)) {
          localStorage.setItem(STORAGE_LANGUAGE_KEY, nextDefault);
          return nextDefault;
        }
        return current;
      });
    } catch {
      // ignore and keep current values
    } finally {
      setPublicConfigLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadPublicConfig();

    const intervalId = window.setInterval(() => {
      void loadPublicConfig();
    }, 30000);

    const onFocus = () => {
      void loadPublicConfig();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadPublicConfig();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadPublicConfig]);

  useEffect(() => {
    if (!publicConfigLoaded) return;
    const scopePath = normalizePublicPath(canonicalBasePath, '/');
    ensureServiceWorkerScope(scopePath);

    let cancelled = false;
    const applyScopedManifest = async () => {
      try {
        const response = await fetch('/manifest.json', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!response.ok) return;
        const manifest = await response.json();
        const startUrl = scopePath === '/' ? '/' : `${scopePath}/`;
        const absoluteStartUrl = toAbsoluteManifestUrl(startUrl, '/');
        const normalizedShortcuts = Array.isArray(manifest?.shortcuts)
          ? manifest.shortcuts.map((entry: any) => {
              const rawUrl = String(entry?.url || '/').trim();
              const shortcutTarget = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)
                ? rawUrl
                : buildScopedPublicPath(scopePath, rawUrl);
              const shortcutIcons = Array.isArray(entry?.icons)
                ? entry.icons.map((iconEntry: any) => ({
                    ...iconEntry,
                    src: toAbsoluteManifestUrl(iconEntry?.src, '/pwa-96.png'),
                  }))
                : [];
              return {
                ...entry,
                url: toAbsoluteManifestUrl(shortcutTarget, startUrl),
                icons: shortcutIcons,
              };
            })
          : [];
        const normalizedIcons = Array.isArray(manifest?.icons)
          ? manifest.icons.map((iconEntry: any) => ({
              ...iconEntry,
              src: toAbsoluteManifestUrl(iconEntry?.src, '/pwa-192.png'),
            }))
          : [];
        const normalizedScreenshots = Array.isArray(manifest?.screenshots)
          ? manifest.screenshots.map((shot: any) => ({
              ...shot,
              src: toAbsoluteManifestUrl(shot?.src, '/pwa-512.png'),
            }))
          : [];
        const scopedManifest = {
          ...manifest,
          id: absoluteStartUrl,
          start_url: absoluteStartUrl,
          scope: absoluteStartUrl,
          icons: normalizedIcons,
          screenshots: normalizedScreenshots,
          shortcuts: normalizedShortcuts,
        };

        const blob = new Blob([JSON.stringify(scopedManifest)], {
          type: 'application/manifest+json',
        });
        const objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        if (manifestObjectUrlRef.current) {
          URL.revokeObjectURL(manifestObjectUrlRef.current);
        }
        manifestObjectUrlRef.current = objectUrl;

        let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
        if (!link) {
          link = document.createElement('link');
          link.rel = 'manifest';
          document.head.appendChild(link);
        }
        link.href = objectUrl;
      } catch {
        // keep static manifest fallback
      }
    };

    void applyScopedManifest();
    return () => {
      cancelled = true;
    };
  }, [canonicalBasePath, publicConfigLoaded]);

  useEffect(() => {
    return () => {
      if (manifestObjectUrlRef.current) {
        URL.revokeObjectURL(manifestObjectUrlRef.current);
        manifestObjectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = languageOption.code;
    document.documentElement.dir = languageOption.dir || 'ltr';
  }, [languageOption]);

  useEffect(() => {
    const loadTranslations = async () => {
      const requestId = translationRequestRef.current + 1;
      translationRequestRef.current = requestId;

      if (languageOption.code === defaultLanguage) {
        setTranslations({});
        setTranslationNotice(STRINGS.language_translating_hint || STRINGS.language_translating);
        setIsTranslating(false);
        return;
      }

      const cacheKey = `${STORAGE_TRANSLATIONS_PREFIX}${languageOption.code}`;
      let cached: Translations = {};
      try {
        const cachedRaw = localStorage.getItem(cacheKey);
        if (cachedRaw) {
          cached = JSON.parse(cachedRaw) as Translations;
        }
      } catch {
        cached = {};
      }

      const cachedNotice =
        cached.language_translating_hint ||
        cached.language_translating ||
        TRANSLATION_NOTICE_FALLBACK[languageOption.code];
      setTranslationNotice(
        cachedNotice || STRINGS.language_translating_hint || STRINGS.language_translating
      );

      if (!cached.language_translating_hint) {
        fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetLanguage: languageOption.code,
            targetLanguageName: languageOption.aiName || languageOption.label || languageOption.code,
            sourceLanguageName: sourceLanguageName || 'German',
            strings: { language_translating_hint: STRINGS.language_translating_hint },
          }),
        })
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => {
            const translated = data?.translations?.language_translating_hint;
            if (typeof translated === 'string') {
              setTranslationNotice(translated);
            }
          })
          .catch(() => {
            // ignore
          });
      }

      const missingKeys = Object.keys(STRINGS).filter((key) => !cached[key]);
      if (translationRequestRef.current !== requestId) return;
      setTranslations(cached);
      if (missingKeys.length === 0) {
        setIsTranslating(false);
        return;
      }

      const payload: Record<string, string> = {};
      for (const key of missingKeys) {
        payload[key] = STRINGS[key];
      }

      // While queued translation is running, keep UI fully usable and
      // display the source language consistently.
      if (translationRequestRef.current !== requestId) return;
      setIsTranslating(true);
      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetLanguage: languageOption.code,
            targetLanguageName: languageOption.aiName || languageOption.label || languageOption.code,
            sourceLanguageName: sourceLanguageName || 'German',
            strings: payload,
          }),
        });

        if (!response.ok) {
          throw new Error(`Translation failed (${response.status})`);
        }

        const data = await response.json();
        const incoming = (data?.translations || {}) as Translations;
        const merged = { ...cached, ...incoming };
        if (translationRequestRef.current !== requestId) return;
        setTranslations(merged);
        localStorage.setItem(cacheKey, JSON.stringify(merged));
        if (merged.language_translating_hint) {
          setTranslationNotice(merged.language_translating_hint);
        }
      } catch (error) {
        if (translationRequestRef.current !== requestId) return;
        console.error('Translation error:', error);
        setTranslations(cached);
      } finally {
        if (translationRequestRef.current !== requestId) return;
        setIsTranslating(false);
      }
    };

    loadTranslations();
  }, [languageOption, defaultLanguage, sourceLanguageName]);

  useEffect(() => {
    const languageCode = String(languageOption.code || '').toLowerCase();
    const defaultCode = String(defaultLanguage || 'de').toLowerCase();
    const isGermanLanguage = languageCode === 'de' || languageCode.startsWith('de-');
    const isSourceLanguage = languageCode === defaultCode || isGermanLanguage;
    if (!citizenAnnouncementConfig.enabled || isSourceLanguage) return;

    const sourceHash = String(citizenAnnouncementConfig.sourceHash || '').trim();
    if (!sourceHash) return;

    const existingTarget = citizenAnnouncementConfig.translations[languageCode];
    const hasMatchingTarget =
      !!existingTarget &&
      (!existingTarget.sourceHash || existingTarget.sourceHash === sourceHash) &&
      (!!sanitizeAnnouncementText(existingTarget.title, 240) ||
        !!sanitizeAnnouncementText(existingTarget.message, 4000));
    if (hasMatchingTarget) return;

    const defaultEntry = citizenAnnouncementConfig.translations[defaultCode];
    const sourceTitle = sanitizeAnnouncementText(defaultEntry?.title || citizenAnnouncementConfig.title, 240);
    const sourceMessage = sanitizeAnnouncementText(defaultEntry?.message || citizenAnnouncementConfig.message, 4000);
    if (!sourceTitle && !sourceMessage) return;

    const requestToken = `${languageCode}:${sourceHash}`;
    if (announcementTranslationRequestRef.current.has(requestToken)) return;
    announcementTranslationRequestRef.current.add(requestToken);

    const titleKey = `citizen_announcement_title_${sourceHash}`;
    const messageKey = `citizen_announcement_message_${sourceHash}`;
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetLanguage: languageCode,
        targetLanguageName: languageOption.aiName || languageOption.label || languageCode,
        sourceLanguageName: sourceLanguageName || 'German',
        strings: {
          [titleKey]: sourceTitle,
          [messageKey]: sourceMessage,
        },
      }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const translatedTitle =
          typeof data?.translations?.[titleKey] === 'string' ? data.translations[titleKey] : sourceTitle;
        const translatedMessage =
          typeof data?.translations?.[messageKey] === 'string' ? data.translations[messageKey] : sourceMessage;
        const normalizedTitle = sanitizeAnnouncementText(translatedTitle, 240);
        const normalizedMessage = sanitizeAnnouncementText(translatedMessage, 4000);
        if (!normalizedTitle && !normalizedMessage) return;
        setCitizenAnnouncementConfig((prev) => {
          if (prev.sourceHash !== sourceHash) return prev;
          const nextTranslations = {
            ...prev.translations,
            [languageCode]: {
              title: normalizedTitle,
              message: normalizedMessage,
              sourceHash,
            },
          };
          return { ...prev, translations: nextTranslations };
        });
      })
      .catch(() => {
        // ignore; announcement stays hidden in this language until translation exists
      })
      .finally(() => {
        announcementTranslationRequestRef.current.delete(requestToken);
      });
  }, [citizenAnnouncementConfig, defaultLanguage, languageOption, sourceLanguageName]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const base = STRINGS[key] || key;
      if (languageOption.code === defaultLanguage) {
        return interpolate(base, vars);
      }
      const translated = translations[key] || base;
      return interpolate(translated, vars);
    },
    [languageOption.code, defaultLanguage, translations]
  );

  const addCustomLanguage = useCallback((language: LanguageOption) => {
    if (!language?.code || !language?.label) return;
    setAvailableLanguages((prev) => {
      const exists = prev.some((lang) => lang.code === language.code);
      if (exists) return prev;
      return [...prev, language];
    });
    const existingCustom = readCustomLanguages();
    if (!existingCustom.some((lang) => lang.code === language.code)) {
      const updated = [...existingCustom, language];
      writeCustomLanguages(updated);
    }
    setLanguage(language.code);
  }, [setLanguage]);

  const citizenAnnouncement = useMemo(
    () => resolveCitizenAnnouncement(citizenAnnouncementConfig, languageOption.code, defaultLanguage),
    [citizenAnnouncementConfig, languageOption.code, defaultLanguage]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language: languageOption.code,
      locale: languageOption.locale || languageOption.code,
      dir: languageOption.dir || 'ltr',
      frontendToken,
      languages: availableLanguages,
      isTranslating,
      setLanguage,
      addCustomLanguage,
      t,
      maintenanceMode,
      maintenanceMessage,
      restrictLocations,
      allowedLocations,
      jurisdictionGeofence,
      defaultLanguage,
      sourceLanguageName,
      translationNotice,
      citizenAnnouncement,
      citizenAuthEnabled,
      authenticatedIntakeWorkflowTemplateId,
      citizenProfileTexts,
      routing,
      canonicalBasePath,
      tenantMismatch,
      publicConfigLoaded,
    }),
    [
      languageOption.code,
      languageOption.locale,
      languageOption.dir,
      frontendToken,
      availableLanguages,
      isTranslating,
      setLanguage,
      addCustomLanguage,
      t,
      maintenanceMode,
      maintenanceMessage,
      restrictLocations,
      allowedLocations,
      jurisdictionGeofence,
      defaultLanguage,
      sourceLanguageName,
      translationNotice,
      citizenAnnouncement,
      citizenAuthEnabled,
      authenticatedIntakeWorkflowTemplateId,
      citizenProfileTexts,
      routing,
      canonicalBasePath,
      tenantMismatch,
      publicConfigLoaded,
    ]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
};
