/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * General Configuration API
 */

import express, { Request, Response } from 'express';
import webpush from 'web-push';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import {
  loadGeneralSettings,
  setSetting,
  GeneralSettings,
  normalizeJurisdictionGeofence,
  normalizeResponsibilityAuthorities,
  normalizeRoutingSettings,
  validateRoutingSettings,
  DEFAULT_ROUTING_SETTINGS,
  normalizeGeneralWebPushSettings,
  normalizeGeneralXmppRtcSettings,
} from '../services/settings.js';
import { resetConfigCache } from '../config.js';
import { deriveDefaultCallbackUrl, derivePublicBaseUrlFromCallback } from '../services/callback-links.js';
import { findTenantSlugById } from '../services/routing-resolver.js';
import { resetAdminPushConfiguration } from '../services/admin-push.js';
import { resetCitizenPushConfiguration } from '../services/citizen-messages.js';

const router = express.Router();

router.use(authMiddleware, adminOnly);

const parseBooleanFlag = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const normalizePath = (value: unknown): string => {
  const raw = String(value || '').trim();
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const normalized = withLeadingSlash.replace(/\/+$/g, '') || '/';
  return normalized;
};

const validateCallbackPublicBasePath = (callbackUrl: string): string | null => {
  try {
    const baseUrl = derivePublicBaseUrlFromCallback(callbackUrl);
    const parsed = new URL(baseUrl);
    const basePath = normalizePath(parsed.pathname);
    if (basePath === '/admin' || basePath.startsWith('/admin/')) {
      return 'Die öffentliche Basis-URL darf nicht auf den Admin-Pfad zeigen.';
    }
    if (basePath === '/api' || basePath.startsWith('/api/')) {
      return 'Die öffentliche Basis-URL darf nicht auf den API-Pfad zeigen.';
    }
  } catch {
    // URL-Validation wird bereits an anderer Stelle durchgeführt.
  }
  return null;
};

const GEOCODE_USER_AGENT = 'behebes-ai/1.0 (Geofence Generator)';

interface GeofenceBoundaryResult {
  query: string;
  resolvedDisplayName: string;
  osmType: string;
  osmId: string;
  points: Array<{ lat: number; lon: number }>;
}

const normalizeBoundaryQueryPart = (value: unknown): string => String(value || '').trim();

const normalizeBoundaryQueryList = (input: unknown): string[] => {
  if (Array.isArray(input)) {
    return Array.from(
      new Set(
        input
          .map((entry) => normalizeBoundaryQueryPart(entry))
          .filter(Boolean)
      )
    ).slice(0, 20);
  }
  const single = normalizeBoundaryQueryPart(input);
  if (!single) return [];
  return [single];
};

const normalizeCoordinate = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeBoundaryRing = (input: unknown): Array<{ lat: number; lon: number }> => {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!Array.isArray(entry)) return null;
      const lon = normalizeCoordinate(entry[0]);
      const lat = normalizeCoordinate(entry[1]);
      if (lat === null || lon === null) return null;
      return { lat, lon };
    })
    .filter((entry): entry is { lat: number; lon: number } => entry !== null);
};

const approximateRingArea = (points: Array<{ lat: number; lon: number }>): number => {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.lon * next.lat - next.lon * current.lat;
  }
  return Math.abs(area / 2);
};

const pickLargestBoundaryRing = (geojson: any): Array<{ lat: number; lon: number }> => {
  if (!geojson || typeof geojson !== 'object') return [];
  const type = String(geojson.type || '').trim();

  const candidateRings: Array<Array<{ lat: number; lon: number }>> = [];
  if (type === 'Polygon' && Array.isArray(geojson.coordinates)) {
    for (const ring of geojson.coordinates) {
      const normalized = normalizeBoundaryRing(ring);
      if (normalized.length >= 3) {
        candidateRings.push(normalized);
      }
    }
  } else if (type === 'MultiPolygon' && Array.isArray(geojson.coordinates)) {
    for (const polygon of geojson.coordinates) {
      if (!Array.isArray(polygon)) continue;
      const outerRing = normalizeBoundaryRing(polygon[0]);
      if (outerRing.length >= 3) {
        candidateRings.push(outerRing);
      }
    }
  }

  if (candidateRings.length === 0) return [];
  return candidateRings.sort((a, b) => approximateRingArea(b) - approximateRingArea(a))[0];
};

const normalizePointKey = (point: { lat: number; lon: number }): string =>
  `${point.lat.toFixed(6)}:${point.lon.toFixed(6)}`;

const uniqueBoundaryPoints = (
  points: Array<{ lat: number; lon: number }>
): Array<{ lat: number; lon: number }> => {
  const seen = new Set<string>();
  const result: Array<{ lat: number; lon: number }> = [];
  for (const point of points) {
    const key = normalizePointKey(point);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
};

const computeConvexHull = (
  points: Array<{ lat: number; lon: number }>
): Array<{ lat: number; lon: number }> => {
  const unique = uniqueBoundaryPoints(points)
    .map((point) => ({ x: point.lon, y: point.lat }))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  if (unique.length < 3) {
    return unique.map((entry) => ({ lat: entry.y, lon: entry.x }));
  }

  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Array<{ x: number; y: number }> = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Array<{ x: number; y: number }> = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  const hull = lower.slice(0, lower.length - 1).concat(upper.slice(0, upper.length - 1));
  return hull.map((entry) => ({ lat: entry.y, lon: entry.x }));
};

const shrinkBoundaryPointCount = (
  points: Array<{ lat: number; lon: number }>,
  maxPoints = 600
): Array<{ lat: number; lon: number }> => {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const reduced: Array<{ lat: number; lon: number }> = [];
  for (let index = 0; index < points.length; index += stride) {
    reduced.push(points[index]);
  }
  if (reduced.length < 3) return points.slice(0, maxPoints);
  return reduced;
};

const normalizeCountryCode = (value: unknown): string => {
  const raw = String(value || '').trim().toLowerCase();
  return raw || 'de';
};

const normalizeStateHint = (value: unknown): string => {
  const raw = String(value || '').trim();
  return raw || 'Rheinland-Pfalz';
};

async function fetchBoundaryForPlace(input: {
  query: string;
  countryCode: string;
  stateHint: string;
}): Promise<GeofenceBoundaryResult | null> {
  const rawQuery = normalizeBoundaryQueryPart(input.query);
  if (!rawQuery) return null;
  const searchQuery = [rawQuery, input.stateHint, 'Deutschland'].filter(Boolean).join(', ');
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&polygon_geojson=1&limit=8&q=${encodeURIComponent(
    searchQuery
  )}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': GEOCODE_USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Nominatim Fehler ${response.status} bei "${rawQuery}"`);
  }
  const payload = (await response.json()) as any[];
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const normalizedCountryCode = normalizeCountryCode(input.countryCode);
  const normalizedStateHint = normalizeStateHint(input.stateHint).toLowerCase();

  const scored = payload
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const points = pickLargestBoundaryRing((entry as any).geojson);
      if (points.length < 3) return null;
      const displayName = String((entry as any).display_name || '').trim();
      const address = (entry as any).address && typeof (entry as any).address === 'object'
        ? (entry as any).address
        : {};
      const entryCountryCode = String(address.country_code || '').trim().toLowerCase();
      const countryScore = entryCountryCode === normalizedCountryCode ? 100 : 0;
      const stateBlob = [
        String(address.state || ''),
        String(address.region || ''),
        String(address.county || ''),
        displayName,
      ]
        .join(' ')
        .toLowerCase();
      const stateScore = normalizedStateHint && stateBlob.includes(normalizedStateHint) ? 30 : 0;
      const boundaryType = String((entry as any).type || '').trim().toLowerCase();
      const className = String((entry as any).class || '').trim().toLowerCase();
      const adminBonus = className === 'boundary' || boundaryType === 'administrative' ? 15 : 0;
      const placeRank = Number((entry as any).place_rank);
      const rankScore = Number.isFinite(placeRank) ? Math.max(0, 20 - Math.abs(16 - placeRank)) : 0;
      return {
        score: countryScore + stateScore + adminBonus + rankScore,
        query: rawQuery,
        resolvedDisplayName: displayName || rawQuery,
        osmType: String((entry as any).osm_type || '').trim(),
        osmId: String((entry as any).osm_id || '').trim(),
        points,
      } as GeofenceBoundaryResult & { score: number };
    })
    .filter((entry): entry is GeofenceBoundaryResult & { score: number } => entry !== null)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const best = scored[0];
  return {
    query: best.query,
    resolvedDisplayName: best.resolvedDisplayName,
    osmType: best.osmType,
    osmId: best.osmId,
    points: best.points,
  };
}

/**
 * POST /api/admin/config/general/jurisdiction-geofence/generate
 * Erstellt automatisch einen Polygon-Geofence aus Gemeindegrenzen (Nominatim).
 */
router.post('/jurisdiction-geofence/generate', async (req: Request, res: Response): Promise<any> => {
  try {
    const places = normalizeBoundaryQueryList(req.body?.places);
    if (places.length === 0) {
      return res.status(400).json({ message: 'Mindestens ein Ort ist erforderlich.' });
    }

    const countryCode = normalizeCountryCode(req.body?.countryCode);
    const stateHint = normalizeStateHint(req.body?.stateHint);
    const mergeMode = String(req.body?.mergeMode || 'convex_hull').trim().toLowerCase();

    const resolvedBoundaries: GeofenceBoundaryResult[] = [];
    const unresolved: string[] = [];

    for (const place of places) {
      try {
        const boundary = await fetchBoundaryForPlace({
          query: place,
          countryCode,
          stateHint,
        });
        if (boundary) {
          resolvedBoundaries.push(boundary);
        } else {
          unresolved.push(place);
        }
      } catch (error) {
        unresolved.push(place);
      }
    }

    if (resolvedBoundaries.length === 0) {
      return res.status(404).json({
        message: 'Für die angegebenen Orte konnten keine administrativen Grenzen gefunden werden.',
      });
    }

    const allPoints = resolvedBoundaries.flatMap((entry) => entry.points);
    const mergedPoints =
      mergeMode === 'single' && resolvedBoundaries.length > 0
        ? resolvedBoundaries[0].points
        : computeConvexHull(allPoints);
    const normalizedPoints = shrinkBoundaryPointCount(uniqueBoundaryPoints(mergedPoints), 600);

    if (normalizedPoints.length < 3) {
      return res.status(422).json({
        message: 'Die generierten Geofence-Daten enthalten zu wenige Grenzpunkte.',
      });
    }

    return res.json({
      geofence: {
        enabled: true,
        shape: 'polygon',
        points: normalizedPoints,
      },
      generatedAt: new Date().toISOString(),
      mergeMode: mergeMode === 'single' ? 'single' : 'convex_hull',
      resolved: resolvedBoundaries.map((entry) => ({
        query: entry.query,
        resolvedDisplayName: entry.resolvedDisplayName,
        osmType: entry.osmType,
        osmId: entry.osmId,
        pointCount: entry.points.length,
      })),
      unresolved,
      message:
        unresolved.length > 0
          ? `Geofence wurde aus ${resolvedBoundaries.length} Ort(en) erstellt; ${unresolved.length} Ort(e) konnten nicht aufgeloest werden.`
          : `Geofence wurde aus ${resolvedBoundaries.length} Ort(en) erstellt.`,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'Geofence-Generierung fehlgeschlagen.',
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /api/admin/config/general/web-push/vapid/generate
 * Generiert ein neues VAPID-Keypair (optional direkt speichern).
 */
router.post('/web-push/vapid/generate', async (req: Request, res: Response): Promise<any> => {
  try {
    const persist = parseBooleanFlag(req.body?.persist, true);
    const generated = webpush.generateVAPIDKeys();
    const subjectInput = typeof req.body?.subject === 'string' ? req.body.subject : '';
    const subject = normalizeGeneralWebPushSettings({
      vapidPublicKey: generated.publicKey,
      vapidPrivateKey: generated.privateKey,
      vapidSubject: subjectInput || 'mailto:noreply@example.com',
    }).vapidSubject;

    const webPushSettings = normalizeGeneralWebPushSettings({
      vapidPublicKey: generated.publicKey,
      vapidPrivateKey: generated.privateKey,
      vapidSubject: subject,
    });

    if (persist) {
      const { values: existing } = await loadGeneralSettings();
      const config: GeneralSettings = {
        ...existing,
        webPush: webPushSettings,
      };
      await setSetting('general', config);
      process.env.WEB_PUSH_VAPID_PUBLIC_KEY = webPushSettings.vapidPublicKey;
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY = webPushSettings.vapidPrivateKey;
      process.env.WEB_PUSH_VAPID_SUBJECT = webPushSettings.vapidSubject;
      resetAdminPushConfiguration();
      resetCitizenPushConfiguration();
    }

    return res.status(201).json({
      message: persist
        ? 'VAPID-Schlüssel wurden generiert und gespeichert.'
        : 'VAPID-Schlüssel wurden generiert.',
      webPush: webPushSettings,
      persisted: persist,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: 'VAPID-Schlüssel konnten nicht generiert werden.',
      error: error?.message || String(error),
    });
  }
});

/**
 * GET /api/admin/config/general
 * Allgemeine Konfiguration auslesen
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { values, sources } = await loadGeneralSettings();
    res.json({ ...values, sources });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Laden der Konfiguration' });
  }
});

/**
 * PATCH /api/admin/config/general
 * Allgemeine Konfiguration aktualisieren (inkl. Custom Classify Prompt)
 */
router.patch('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      callbackMode,
      callbackUrl,
      appName,
      webPush,
      xmppRtc,
      maintenanceMode,
      maintenanceMessage,
      restrictLocations,
      allowedLocations,
      jurisdictionGeofence,
      responsibilityAuthorities,
      defaultLanguage,
      workflowAbortNotificationEnabled,
      workflowAbortRecipientEmail,
      workflowAbortRecipientName,
      citizenFrontend,
      languages,
      routing,
    } = req.body || {};

    const { values: existing } = await loadGeneralSettings();

    const resolvedCallbackMode =
      callbackMode === 'custom' || callbackMode === 'auto'
        ? callbackMode
        : (existing.callbackMode === 'custom' ? 'custom' : 'auto');

    let resolvedCallbackUrl = callbackUrl ?? existing.callbackUrl;
    if (resolvedCallbackMode === 'custom') {
      if (!resolvedCallbackUrl) {
        return res.status(400).json({ message: 'callbackUrl ist erforderlich, wenn der Modus "custom" aktiv ist' });
      }
      try {
        resolvedCallbackUrl = new URL(resolvedCallbackUrl).toString();
      } catch (error) {
        return res.status(400).json({ message: 'Ungültiges URL-Format' });
      }
    } else {
      resolvedCallbackUrl = deriveDefaultCallbackUrl(process.env.FRONTEND_URL);
    }
    const callbackPathValidationError = validateCallbackPublicBasePath(String(resolvedCallbackUrl || ''));
    if (callbackPathValidationError) {
      return res.status(400).json({ message: callbackPathValidationError });
    }

    const sanitizeLanguages = (
      input: any[]
    ): NonNullable<GeneralSettings['languages']> => {
      if (!Array.isArray(input)) return [];
      const seen = new Set<string>();
      const cleaned: NonNullable<GeneralSettings['languages']> = [];
      for (const entry of input) {
        if (!entry || typeof entry !== 'object') continue;
        const rawCode = String(entry.code || '').trim();
        const rawLabel = String(entry.label || '').trim();
        if (!rawCode || !rawLabel) continue;
        const code = rawCode.toLowerCase().replace(/\s+/g, '-');
        if (seen.has(code)) continue;
        seen.add(code);
        const aiName = typeof entry.aiName === 'string' && entry.aiName.trim() ? entry.aiName.trim() : undefined;
        const locale = typeof entry.locale === 'string' && entry.locale.trim() ? entry.locale.trim() : undefined;
        const flag = typeof entry.flag === 'string' && entry.flag.trim() ? entry.flag.trim() : undefined;
        const dirValue = entry.dir === 'rtl' ? 'rtl' : 'ltr';
        cleaned.push({
          code,
          label: rawLabel,
          aiName,
          locale,
          dir: dirValue,
          flag,
        });
      }
      return cleaned;
    };

    const sanitizeLocations = (input: any): string[] => {
      if (!Array.isArray(input)) return [];
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const entry of input) {
        if (entry === null || entry === undefined) continue;
        const value = String(entry).trim();
        if (!value) continue;
        const normalized = value.toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        cleaned.push(value);
      }
      return cleaned;
    };

    const sanitizeAnnouncementText = (value: any, maxLength: number): string => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      return trimmed ? trimmed.slice(0, maxLength) : '';
    };
    const sanitizeProfileText = (value: any, maxLength: number): string => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      return trimmed ? trimmed.slice(0, maxLength) : '';
    };

    const sanitizeAnnouncementTranslations = (
      input: any
    ): NonNullable<GeneralSettings['citizenFrontend']>['announcementTranslations'] => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
      const cleaned: NonNullable<GeneralSettings['citizenFrontend']>['announcementTranslations'] = {};
      for (const [rawCode, rawEntry] of Object.entries(input)) {
        const code = String(rawCode || '').trim().toLowerCase();
        if (!code) continue;
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
        const title = sanitizeAnnouncementText((rawEntry as any).title, 240);
        const message = sanitizeAnnouncementText((rawEntry as any).message, 4000);
        const sourceHash =
          typeof (rawEntry as any).sourceHash === 'string' && (rawEntry as any).sourceHash.trim()
            ? (rawEntry as any).sourceHash.trim().slice(0, 128)
            : undefined;
        if (!title && !message) continue;
        cleaned[code] = sourceHash ? { title, message, sourceHash } : { title, message };
      }
      return cleaned;
    };

    const normalizeFrontendProfileToken = (value: unknown): string =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 80);
    const normalizeTenantId = (value: unknown): string =>
      String(value || '').trim().slice(0, 120);

    const normalizeFrontendProfileId = (value: unknown, fallback: string): string => {
      const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
      return normalized || fallback;
    };

    const sanitizeCitizenFrontendProfiles = (
      input: any,
      defaultIntakeWorkflowTemplateId: string
    ): NonNullable<GeneralSettings['citizenFrontend']>['profiles'] => {
      if (!Array.isArray(input)) return [];
      const cleaned: NonNullable<GeneralSettings['citizenFrontend']>['profiles'] = [];
      const seenIds = new Set<string>();
      const seenTokens = new Set<string>();

      input.forEach((rawEntry, index) => {
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return;
        const entry = rawEntry as Record<string, any>;

        const token = normalizeFrontendProfileToken(entry.token);
        if (!token || seenTokens.has(token)) return;

        const fallbackId = `profile-${index + 1}`;
        const baseId = normalizeFrontendProfileId(entry.id, fallbackId);
        let id = baseId;
        let suffix = 2;
        while (seenIds.has(id)) {
          id = `${baseId}-${suffix}`;
          suffix += 1;
        }

        const name =
          typeof entry.name === 'string' && entry.name.trim()
            ? entry.name.trim().slice(0, 120)
            : `Profil ${index + 1}`;
        const intakeWorkflowTemplateId =
          typeof entry.intakeWorkflowTemplateId === 'string' && entry.intakeWorkflowTemplateId.trim()
            ? entry.intakeWorkflowTemplateId.trim()
            : defaultIntakeWorkflowTemplateId;
        const authenticatedIntakeWorkflowTemplateId =
          typeof entry.authenticatedIntakeWorkflowTemplateId === 'string' &&
          entry.authenticatedIntakeWorkflowTemplateId.trim()
            ? entry.authenticatedIntakeWorkflowTemplateId.trim()
            : '';
        const citizenAuthEnabled = parseBooleanFlag(entry.citizenAuthEnabled, false);
        const enabled = parseBooleanFlag(entry.enabled, true);

        seenIds.add(id);
        seenTokens.add(token);
        cleaned.push({
          id,
          name,
          token,
          tenantId: normalizeTenantId(entry.tenantId || entry.tenant_id),
          intakeWorkflowTemplateId,
          authenticatedIntakeWorkflowTemplateId,
          citizenAuthEnabled,
          enabled,
          headerTag: sanitizeProfileText(entry.headerTag, 80),
          headerKicker: sanitizeProfileText(entry.headerKicker, 120),
          headerTitle: sanitizeProfileText(entry.headerTitle, 160),
          headerSubtitle: sanitizeProfileText(entry.headerSubtitle, 240),
          submissionKicker: sanitizeProfileText(entry.submissionKicker, 120),
          submissionTitle: sanitizeProfileText(entry.submissionTitle, 160),
          submissionSubtitle: sanitizeProfileText(entry.submissionSubtitle, 400),
        });
      });

      return cleaned.slice(0, 50);
    };

    const nextLanguages = Array.isArray(languages)
      ? sanitizeLanguages(languages)
      : existing.languages || [];

    let nextDefaultLanguage =
      typeof defaultLanguage === 'string' && defaultLanguage.trim()
        ? defaultLanguage.trim().toLowerCase()
        : (existing.defaultLanguage || 'de');
    if (nextLanguages.length > 0 && !nextLanguages.some((lang) => lang.code === nextDefaultLanguage)) {
      nextDefaultLanguage = nextLanguages[0].code;
    }

    const nextCitizenFrontendIntakeWorkflowTemplateId =
      typeof citizenFrontend?.intakeWorkflowTemplateId === 'string'
        ? citizenFrontend.intakeWorkflowTemplateId.trim()
        : String(existing.citizenFrontend?.intakeWorkflowTemplateId || '').trim();
    const existingCitizenFrontendSource = (existing.citizenFrontend || {}) as Record<string, any>;
    const nextCitizenFrontendTenantId =
      Object.prototype.hasOwnProperty.call(citizenFrontend || {}, 'tenantId') ||
      Object.prototype.hasOwnProperty.call(citizenFrontend || {}, 'tenant_id')
        ? normalizeTenantId(citizenFrontend?.tenantId || citizenFrontend?.tenant_id)
        : normalizeTenantId(existingCitizenFrontendSource.tenantId || existingCitizenFrontendSource.tenant_id);
    const fallbackCitizenIntakeWorkflowTemplateId =
      nextCitizenFrontendIntakeWorkflowTemplateId || 'standard-intake-workflow';
    const nextCitizenFrontendProfilesSource = Array.isArray(citizenFrontend?.profiles)
      ? citizenFrontend.profiles
      : existing.citizenFrontend?.profiles || [];
    const nextCitizenFrontendProfiles = sanitizeCitizenFrontendProfiles(
      nextCitizenFrontendProfilesSource,
      fallbackCitizenIntakeWorkflowTemplateId
    ).map((profile) => ({
      ...profile,
      tenantId: normalizeTenantId(profile.tenantId || nextCitizenFrontendTenantId),
    }));

    const config: GeneralSettings = {
      callbackMode: resolvedCallbackMode,
      callbackUrl: resolvedCallbackUrl,
      appName: appName ?? existing.appName ?? 'OI App',
      webPush: normalizeGeneralWebPushSettings(
        webPush,
        normalizeGeneralWebPushSettings(existing.webPush)
      ),
      xmppRtc: normalizeGeneralXmppRtcSettings(
        xmppRtc,
        normalizeGeneralXmppRtcSettings(existing.xmppRtc)
      ),
      maintenanceMode: parseBooleanFlag(maintenanceMode, existing.maintenanceMode ?? false),
      maintenanceMessage:
        typeof maintenanceMessage === 'string' ? maintenanceMessage : (existing.maintenanceMessage || ''),
      restrictLocations:
        parseBooleanFlag(restrictLocations, existing.restrictLocations ?? false),
      allowedLocations: Array.isArray(allowedLocations)
        ? sanitizeLocations(allowedLocations)
        : (existing.allowedLocations || []),
      jurisdictionGeofence: normalizeJurisdictionGeofence(
        jurisdictionGeofence,
        normalizeJurisdictionGeofence(existing.jurisdictionGeofence)
      ),
      responsibilityAuthorities: Array.isArray(responsibilityAuthorities)
        ? normalizeResponsibilityAuthorities(
            responsibilityAuthorities,
            existing.responsibilityAuthorities
          )
        : normalizeResponsibilityAuthorities(existing.responsibilityAuthorities),
      defaultLanguage: nextDefaultLanguage,
      workflowAbortNotificationEnabled:
        parseBooleanFlag(workflowAbortNotificationEnabled, existing.workflowAbortNotificationEnabled ?? false),
      workflowAbortRecipientEmail:
        typeof workflowAbortRecipientEmail === 'string'
          ? workflowAbortRecipientEmail.trim()
          : (existing.workflowAbortRecipientEmail || ''),
      workflowAbortRecipientName:
        typeof workflowAbortRecipientName === 'string'
          ? workflowAbortRecipientName.trim()
          : (existing.workflowAbortRecipientName || ''),
      citizenFrontend: {
        intakeWorkflowTemplateId: nextCitizenFrontendIntakeWorkflowTemplateId,
        tenantId: nextCitizenFrontendTenantId,
        emailDoubleOptInTimeoutHours: Number.isFinite(Number(citizenFrontend?.emailDoubleOptInTimeoutHours))
          ? Math.max(1, Math.min(24 * 30, Math.floor(Number(citizenFrontend.emailDoubleOptInTimeoutHours))))
          : Number(existing.citizenFrontend?.emailDoubleOptInTimeoutHours || 48),
        dataRequestTimeoutHours: Number.isFinite(Number(citizenFrontend?.dataRequestTimeoutHours))
          ? Math.max(1, Math.min(24 * 30, Math.floor(Number(citizenFrontend.dataRequestTimeoutHours))))
          : Number(existing.citizenFrontend?.dataRequestTimeoutHours || 72),
        enhancedCategorizationTimeoutHours: Number.isFinite(Number(citizenFrontend?.enhancedCategorizationTimeoutHours))
          ? Math.max(1, Math.min(24 * 30, Math.floor(Number(citizenFrontend.enhancedCategorizationTimeoutHours))))
          : Number(existing.citizenFrontend?.enhancedCategorizationTimeoutHours || 72),
        profiles: nextCitizenFrontendProfiles,
        announcementEnabled:
          parseBooleanFlag(citizenFrontend?.announcementEnabled, existing.citizenFrontend?.announcementEnabled === true),
        announcementMode:
          citizenFrontend?.announcementMode === 'modal'
            ? 'modal'
            : citizenFrontend?.announcementMode === 'banner'
              ? 'banner'
            : existing.citizenFrontend?.announcementMode === 'modal'
              ? 'modal'
              : 'banner',
        announcementTitle:
          typeof citizenFrontend?.announcementTitle === 'string'
            ? sanitizeAnnouncementText(citizenFrontend.announcementTitle, 240)
            : sanitizeAnnouncementText(existing.citizenFrontend?.announcementTitle || '', 240),
        announcementMessage:
          typeof citizenFrontend?.announcementMessage === 'string'
            ? sanitizeAnnouncementText(citizenFrontend.announcementMessage, 4000)
            : sanitizeAnnouncementText(existing.citizenFrontend?.announcementMessage || '', 4000),
        announcementSourceHash:
          typeof citizenFrontend?.announcementSourceHash === 'string'
            ? citizenFrontend.announcementSourceHash.trim().slice(0, 128)
            : String(existing.citizenFrontend?.announcementSourceHash || '').trim().slice(0, 128),
        announcementTranslations:
          citizenFrontend?.announcementTranslations && typeof citizenFrontend.announcementTranslations === 'object'
            ? sanitizeAnnouncementTranslations(citizenFrontend.announcementTranslations)
            : sanitizeAnnouncementTranslations(existing.citizenFrontend?.announcementTranslations || {}),
      },
      languages: nextLanguages,
      routing: normalizeRoutingSettings(
        routing,
        normalizeRoutingSettings(existing.routing, DEFAULT_ROUTING_SETTINGS)
      ),
    };

    const normalizedRouting = normalizeRoutingSettings(config.routing, DEFAULT_ROUTING_SETTINGS);
    const routingValidationError = validateRoutingSettings(normalizedRouting);
    if (routingValidationError) {
      return res.status(400).json({ message: routingValidationError });
    }
    config.routing = normalizedRouting;
    if (normalizedRouting.rootMode === 'tenant') {
      const rootTenantId = String(normalizedRouting.rootTenantId || '').trim();
      if (!rootTenantId) {
        return res.status(400).json({
          message: 'Bitte einen Root-Mandanten auswählen, wenn das Bürgerfrontend auf "/" laufen soll.',
        });
      }
      const rootTenantSlug = await findTenantSlugById(rootTenantId);
      if (!rootTenantSlug) {
        return res.status(400).json({
          message: 'Der gewählte Root-Mandant ist nicht verfügbar oder hat keinen gültigen Slug.',
        });
      }
    }

    if (config.workflowAbortNotificationEnabled) {
      if (!config.workflowAbortRecipientEmail) {
        return res.status(400).json({
          message: 'Empfänger-E-Mail für Workflow-Abbruch-Benachrichtigungen ist erforderlich',
        });
      }
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(config.workflowAbortRecipientEmail)) {
        return res.status(400).json({ message: 'Ungültige Empfänger-E-Mail' });
      }
    }

    await setSetting('general', config);

    // Also update environment variables for runtime use (fallback)
    process.env.CALLBACK_URL = resolvedCallbackMode === 'custom' ? resolvedCallbackUrl : '';
    process.env.APP_NAME = config.appName;
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = String(config.webPush?.vapidPublicKey || '');
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = String(config.webPush?.vapidPrivateKey || '');
    process.env.WEB_PUSH_VAPID_SUBJECT = String(config.webPush?.vapidSubject || 'mailto:noreply@example.com');
    process.env.XMPP_RTC_STUN_URLS = Array.isArray(config.xmppRtc?.stunUrls)
      ? config.xmppRtc!.stunUrls.join(',')
      : '';
    process.env.XMPP_RTC_TURN_URLS = Array.isArray(config.xmppRtc?.turnUrls)
      ? config.xmppRtc!.turnUrls.join(',')
      : '';
    process.env.XMPP_RTC_TURN_USERNAME = String(config.xmppRtc?.turnUsername || '');
    process.env.XMPP_RTC_TURN_CREDENTIAL = String(config.xmppRtc?.turnCredential || '');
    process.env.WORKFLOW_ABORT_NOTIFICATION_ENABLED = config.workflowAbortNotificationEnabled ? 'true' : 'false';
    process.env.WORKFLOW_ABORT_RECIPIENT_EMAIL = config.workflowAbortRecipientEmail || '';
    process.env.WORKFLOW_ABORT_RECIPIENT_NAME = config.workflowAbortRecipientName || '';
    resetConfigCache();
    resetAdminPushConfiguration();
    resetCitizenPushConfiguration();

    const { values: normalized } = await loadGeneralSettings();
    return res.json(normalized);
  } catch (error) {
    console.error('Error updating general config:', error);
    return res.status(500).json({ message: 'Fehler beim Speichern der Konfiguration' });
  }
});

export default router;
