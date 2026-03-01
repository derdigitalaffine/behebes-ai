import express, { Request, Response } from 'express';
import { authMiddleware, staffOnly } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { buildAdminCapabilities, loadAdminAccessContext } from '../services/rbac.js';
import { getSetting, setSetting } from '../services/settings.js';
import { queryResponsibilityCandidates } from '../services/responsibility.js';

const router = express.Router();

router.use(authMiddleware, staffOnly);

interface ResponsibilityConfig {
  suggestThreshold: number;
  strongThreshold: number;
  includeUsersByDefault: boolean;
  maxCandidates: number;
}

const DEFAULT_CONFIG: ResponsibilityConfig = {
  suggestThreshold: 0.55,
  strongThreshold: 0.75,
  includeUsersByDefault: true,
  maxCandidates: 8,
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'ja'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'nein'].includes(normalized)) return false;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function loadConfig(): Promise<ResponsibilityConfig> {
  const stored = await getSetting<Partial<ResponsibilityConfig>>('responsibilityRoutingConfig');
  const value = stored && typeof stored === 'object' ? stored : {};
  return {
    suggestThreshold: clamp(Number(value?.suggestThreshold ?? DEFAULT_CONFIG.suggestThreshold), 0.05, 0.98),
    strongThreshold: clamp(Number(value?.strongThreshold ?? DEFAULT_CONFIG.strongThreshold), 0.1, 0.99),
    includeUsersByDefault: normalizeBoolean(value?.includeUsersByDefault, DEFAULT_CONFIG.includeUsersByDefault),
    maxCandidates: Math.max(1, Math.min(30, Number(value?.maxCandidates ?? DEFAULT_CONFIG.maxCandidates))),
  };
}

async function resolveAccess(req: Request) {
  const userId = normalizeText(req.userId);
  const role = normalizeText(req.role);
  const access = await loadAdminAccessContext(userId, role);
  const capabilities = new Set(buildAdminCapabilities(access));
  return { access, capabilities, userId };
}

function resolveTenantScope(
  access: Awaited<ReturnType<typeof loadAdminAccessContext>>,
  requestedTenantIdRaw: unknown
): { tenantId: string | null; error?: string } {
  const requestedTenantId = normalizeText(requestedTenantIdRaw);
  if (access.isGlobalAdmin) {
    if (!requestedTenantId) {
      return { tenantId: null, error: 'Im globalen Kontext muss tenantId angegeben werden.' };
    }
    return { tenantId: requestedTenantId };
  }

  const allowedTenants = Array.from(new Set((access.tenantIds || []).map((entry) => normalizeText(entry)).filter(Boolean)));
  if (allowedTenants.length === 0) {
    return { tenantId: null, error: 'Keine verfügbaren Mandanten im Zugriffskontext.' };
  }

  const tenantId = requestedTenantId || allowedTenants[0];
  if (!allowedTenants.includes(tenantId)) {
    return { tenantId: null, error: 'tenantId liegt außerhalb des erlaubten Scopes.' };
  }
  return { tenantId };
}

router.get('/config', async (req: Request, res: Response) => {
  try {
    const { capabilities } = await resolveAccess(req);
    if (!capabilities.has('settings.global.manage') && !capabilities.has('settings.workflows.manage')) {
      return res.status(403).json({ message: 'Keine Berechtigung für Konfiguration.' });
    }
    const config = await loadConfig();
    return res.json({ config });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Fehler beim Laden der Konfiguration.' });
  }
});

router.patch('/config', async (req: Request, res: Response) => {
  try {
    const { capabilities, userId } = await resolveAccess(req);
    if (!capabilities.has('settings.global.manage') && !capabilities.has('settings.workflows.manage')) {
      return res.status(403).json({ message: 'Keine Berechtigung für Konfiguration.' });
    }
    const current = await loadConfig();
    const next: ResponsibilityConfig = {
      suggestThreshold: clamp(
        Number(req.body?.suggestThreshold ?? current.suggestThreshold),
        0.05,
        0.98
      ),
      strongThreshold: clamp(Number(req.body?.strongThreshold ?? current.strongThreshold), 0.1, 0.99),
      includeUsersByDefault: normalizeBoolean(
        req.body?.includeUsersByDefault,
        current.includeUsersByDefault
      ),
      maxCandidates: Math.max(1, Math.min(30, Number(req.body?.maxCandidates ?? current.maxCandidates))),
    };
    if (next.strongThreshold < next.suggestThreshold) {
      next.strongThreshold = next.suggestThreshold;
    }
    await setSetting('responsibilityRoutingConfig', {
      ...next,
      updatedBy: userId || null,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ config: next });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Fehler beim Speichern der Konfiguration.' });
  }
});

async function runQuery(req: Request, res: Response, mode: 'query' | 'simulate') {
  try {
    const { access, capabilities, userId } = await resolveAccess(req);
    if (!capabilities.has('tickets.read') && !capabilities.has('workflows.read')) {
      return res.status(403).json({ message: 'Keine Berechtigung für Zuständigkeitsabfragen.' });
    }

    const query = normalizeText(req.body?.query || req.body?.text || req.body?.question);
    if (!query) {
      return res.status(400).json({ message: 'query ist erforderlich.' });
    }

    const tenantFromHeader = normalizeText(req.header('x-admin-context-tenant-id'));
    const scopedTenant = resolveTenantScope(access, req.body?.tenantId || req.query?.tenantId || tenantFromHeader);
    if (scopedTenant.error) {
      return res.status(400).json({ message: scopedTenant.error });
    }

    const config = await loadConfig();
    const includeUsers = normalizeBoolean(req.body?.includeUsers, config.includeUsersByDefault);
    const limit = Math.max(1, Math.min(30, Number(req.body?.limit || config.maxCandidates || 8)));
    const candidates = await queryResponsibilityCandidates(getDatabase(), {
      query,
      tenantId: scopedTenant.tenantId || undefined,
      includeUsers,
      limit,
    });

    const db = getDatabase();
    if (mode === 'query') {
      const id = `respq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
      await db.run(
        `INSERT INTO responsibility_queries (
           id, tenant_id, created_by_admin_id, mode, query_text, context_json, result_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          scopedTenant.tenantId || null,
          userId || null,
          mode,
          query,
          JSON.stringify({
            includeUsers,
            limit,
            scope: access,
          }),
          JSON.stringify({
            candidates,
            thresholds: config,
          }),
        ]
      );
    }

    return res.json({
      mode,
      tenantId: scopedTenant.tenantId,
      thresholds: config,
      candidates,
      topCandidate: candidates[0] || null,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Fehler bei Zuständigkeitsabfrage.' });
  }
}

router.post('/query', async (req: Request, res: Response) => runQuery(req, res, 'query'));
router.post('/simulate', async (req: Request, res: Response) => runQuery(req, res, 'simulate'));

export default router;

