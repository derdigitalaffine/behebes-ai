/**
 * Public configuration for citizen frontend
 */

import express, { Request, Response } from 'express';
import { loadGeneralSettings, resolveCitizenFrontendProfile } from '../services/settings.js';
import {
  buildCanonicalPathFromBase,
  normalizeTenantSlug,
  resolveTenantRoutingContext,
  resolveTenantSlugByPublicToken,
} from '../services/routing-resolver.js';

const router = express.Router();

const asEnabledFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return false;
};

// GET /api/config/public
router.get('/public', async (req: Request, res: Response) => {
  try {
    const { values } = await loadGeneralSettings();
    const frontendToken =
      typeof req.query.frontendToken === 'string'
        ? req.query.frontendToken
        : typeof req.query.profileToken === 'string'
          ? req.query.profileToken
          : '';
    const tenantSlug = normalizeTenantSlug(req.query.tenantSlug);
    const tokenForTenantResolution = String(req.query.token || '').trim();
    const tokenTenantSlug = tokenForTenantResolution
      ? await resolveTenantSlugByPublicToken(tokenForTenantResolution)
      : '';
    const routing = await resolveTenantRoutingContext({
      settings: values,
      frontendToken,
      requestedTenantSlug: tenantSlug || tokenTenantSlug,
    });
    const resolvedFrontendProfile = resolveCitizenFrontendProfile(values, frontendToken);
    res.json({
      maintenanceMode: !!values.maintenanceMode,
      maintenanceMessage: values.maintenanceMessage || '',
      defaultLanguage: values.defaultLanguage || 'de',
      languages: Array.isArray(values.languages) ? values.languages : [],
      restrictLocations: !!values.restrictLocations,
      allowedLocations: Array.isArray(values.allowedLocations)
        ? values.allowedLocations.filter((entry) => typeof entry === 'string')
        : [],
      jurisdictionGeofence:
        values.jurisdictionGeofence && typeof values.jurisdictionGeofence === 'object'
          ? values.jurisdictionGeofence
          : undefined,
      citizenFrontend:
        values.citizenFrontend && typeof values.citizenFrontend === 'object'
          ? {
              intakeWorkflowTemplateId: resolvedFrontendProfile.intakeWorkflowTemplateId,
              emailDoubleOptInTimeoutHours: Number(values.citizenFrontend.emailDoubleOptInTimeoutHours || 48),
              dataRequestTimeoutHours: Number(values.citizenFrontend.dataRequestTimeoutHours || 72),
              enhancedCategorizationTimeoutHours: Number(values.citizenFrontend.enhancedCategorizationTimeoutHours || 72),
              citizenAuthEnabled: resolvedFrontendProfile.citizenAuthEnabled === true,
              authenticatedIntakeWorkflowTemplateId:
                resolvedFrontendProfile.authenticatedIntakeWorkflowTemplateId || null,
              profile: {
                id: resolvedFrontendProfile.profileId,
                name: resolvedFrontendProfile.profileName,
                tokenMatched: resolvedFrontendProfile.tokenMatched,
                tenantId: resolvedFrontendProfile.tenantId || '',
                tenantSlug: routing.resolvedTenantSlug,
              },
              canonicalBasePath: routing.canonicalBasePath,
              profileTexts: {
                headerTag: resolvedFrontendProfile.headerTag || '',
                headerKicker: resolvedFrontendProfile.headerKicker || '',
                headerTitle: resolvedFrontendProfile.headerTitle || '',
                headerSubtitle: resolvedFrontendProfile.headerSubtitle || '',
                submissionKicker: resolvedFrontendProfile.submissionKicker || '',
                submissionTitle: resolvedFrontendProfile.submissionTitle || '',
                submissionSubtitle: resolvedFrontendProfile.submissionSubtitle || '',
              },
              announcementEnabled: asEnabledFlag(values.citizenFrontend.announcementEnabled),
              announcementMode: values.citizenFrontend.announcementMode === 'modal' ? 'modal' : 'banner',
              announcementTitle:
                typeof values.citizenFrontend.announcementTitle === 'string'
                  ? values.citizenFrontend.announcementTitle
                  : '',
              announcementMessage:
                typeof values.citizenFrontend.announcementMessage === 'string'
                  ? values.citizenFrontend.announcementMessage
                  : '',
              announcementSourceHash:
                typeof values.citizenFrontend.announcementSourceHash === 'string'
                  ? values.citizenFrontend.announcementSourceHash
                  : '',
              announcementTranslations:
                values.citizenFrontend.announcementTranslations &&
                typeof values.citizenFrontend.announcementTranslations === 'object' &&
                !Array.isArray(values.citizenFrontend.announcementTranslations)
                  ? values.citizenFrontend.announcementTranslations
                  : {},
            }
          : undefined,
      routing: {
        rootMode: routing.routing.rootMode,
        rootTenantId: routing.routing.rootTenantId || '',
        platformPath: routing.routing.platformPath,
        tenantBasePath: routing.routing.tenantBasePath,
        resolvedTenantSlug: routing.resolvedTenantSlug,
        canonicalBasePath: routing.canonicalBasePath,
        tenantMismatch: routing.tenantMismatch,
      },
      appName: values.appName || 'OI App',
    });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Laden der Konfiguration' });
  }
});

// GET /api/config/public/legacy-redirect
router.get('/public/legacy-redirect', async (req: Request, res: Response) => {
  try {
    const { values } = await loadGeneralSettings();
    const legacyPathRaw = String(req.query.legacyPath || req.query.path || '/').trim() || '/';
    const legacyPath = legacyPathRaw.startsWith('/') ? legacyPathRaw : `/${legacyPathRaw}`;

    const frontendToken =
      typeof req.query.frontendToken === 'string'
        ? req.query.frontendToken
        : typeof req.query.profileToken === 'string'
          ? req.query.profileToken
          : '';
    const directTenantSlug = normalizeTenantSlug(req.query.tenantSlug);
    const tokenForTenantResolution = String(req.query.token || '').trim();
    const tokenTenantSlug = tokenForTenantResolution
      ? await resolveTenantSlugByPublicToken(tokenForTenantResolution)
      : '';
    const routing = await resolveTenantRoutingContext({
      settings: values,
      frontendToken,
      requestedTenantSlug: directTenantSlug || tokenTenantSlug,
    });

    const query = new URLSearchParams();
    Object.entries(req.query || {}).forEach(([key, value]) => {
      if (key === 'legacyPath' || key === 'path') return;
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (entry !== undefined && entry !== null) {
            query.append(key, String(entry));
          }
        });
        return;
      }
      if (value !== undefined && value !== null) {
        query.set(key, String(value));
      }
    });

    const targetPath = buildCanonicalPathFromBase(routing.canonicalBasePath, legacyPath);
    const redirectTo = query.toString() ? `${targetPath}?${query.toString()}` : targetPath;
    return res.redirect(301, redirectTo);
  } catch {
    const fallback = String(req.query.legacyPath || '/').trim() || '/';
    return res.redirect(301, fallback.startsWith('/') ? fallback : `/${fallback}`);
  }
});

export default router;
