/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Wissensdatenbank Management API
 */

import express, { Request, Response } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { testAIProvider } from '../services/ai.js';
import { loadAdminAccessContext } from '../services/rbac.js';
import { getSystemPrompt, loadRedmineSettings, loadSystemPrompts, setSetting } from '../services/settings.js';
import {
  deleteKnowledgeCategory,
  listKnowledgeCategories,
  loadKnowledgeBaseFromLibrary,
  upsertKnowledgeCategory,
} from '../services/content-libraries.js';

const router = express.Router();

function normalizeKnowledge(knowledge: any): { normalized: any; changed: boolean } {
  let changed = false;
  if (!Array.isArray(knowledge.categories)) {
    knowledge.categories = [];
    changed = true;
  }
  if (Array.isArray(knowledge.categories)) {
    knowledge.categories = knowledge.categories.map((category: any) => {
      if (!category || typeof category !== 'object') return category;
      const updated = { ...category };

      if ('redmineProject' in updated) {
        delete updated.redmineProject;
        changed = true;
      }
      if ('redmineTracker' in updated) {
        delete updated.redmineTracker;
        changed = true;
      }

      if (typeof updated.recipientEmail === 'string' && !updated.externalRecipientEmail) {
        updated.externalRecipientEmail = updated.recipientEmail;
        changed = true;
      }
      if (typeof updated.recipientName === 'string' && !updated.externalRecipientName) {
        updated.externalRecipientName = updated.recipientName;
        changed = true;
      }

      if ('recipientEmail' in updated) {
        delete updated.recipientEmail;
        changed = true;
      }
      if ('recipientName' in updated) {
        delete updated.recipientName;
        changed = true;
      }

      return updated;
    });
  }

  return { normalized: knowledge, changed };
}

function slugifyCategoryId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nextUniqueCategoryId(desiredId: string, existingIds: Set<string>): string {
  const base = slugifyCategoryId(desiredId) || `kategorie-${Date.now()}`;
  if (!existingIds.has(base)) return base;
  let counter = 2;
  let candidate = `${base}-${counter}`;
  while (existingIds.has(candidate)) {
    counter += 1;
    candidate = `${base}-${counter}`;
  }
  return candidate;
}

type CategoryProcessingMode = 'internal' | 'external';

function normalizeCategoryProcessingModeValue(value: unknown): CategoryProcessingMode | null | '__invalid__' {
  if (typeof value === 'undefined' || value === null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'internal' || raw === 'intern') return 'internal';
  if (raw === 'external' || raw === 'extern') return 'external';
  return '__invalid__';
}

function applyCategoryProcessingMode(target: Record<string, any>, source: Record<string, any>): string | null {
  if (!Object.prototype.hasOwnProperty.call(source, 'processingMode')) return null;
  const normalized = normalizeCategoryProcessingModeValue(source.processingMode);
  if (normalized === '__invalid__') {
    return 'processingMode muss "internal", "external" oder leer sein.';
  }
  if (!normalized) {
    delete target.processingMode;
    return null;
  }
  target.processingMode = normalized;
  return null;
}

function resolveLibraryScope(req: Request): { scope: 'platform' | 'tenant'; tenantId: string } {
  const contextMode = String(req.header('x-admin-context-mode') || '').trim().toLowerCase();
  const contextTenantId = String(req.header('x-admin-context-tenant-id') || '').trim();
  const rawScope = String(
    req.query?.scope ||
      req.body?.scope ||
      (contextMode === 'tenant' ? 'tenant' : contextMode === 'global' ? 'platform' : '')
  )
    .trim()
    .toLowerCase();
  const tenantId = String(
    req.query?.tenantId ||
      req.query?.tenant_id ||
      req.body?.tenantId ||
      req.body?.tenant_id ||
      contextTenantId
  ).trim();
  if (rawScope === 'tenant' && tenantId) {
    return { scope: 'tenant', tenantId };
  }
  return { scope: 'platform', tenantId: '' };
}

async function ensureLibraryScopeAccess(
  req: Request,
  selection: { scope: 'platform' | 'tenant'; tenantId: string }
): Promise<void> {
  const userId = String((req as any).userId || '').trim();
  const role = String((req as any).role || '').trim();
  const access = await loadAdminAccessContext(userId, role);

  if (selection.scope === 'platform') {
    if (!access.isGlobalAdmin) {
      const error = new Error('Plattform-Kategorien können nur von Plattform-Admins bearbeitet werden.');
      (error as any).status = 403;
      throw error;
    }
    return;
  }

  if (!selection.tenantId) {
    const error = new Error('tenantId ist für tenant scope erforderlich.');
    (error as any).status = 400;
    throw error;
  }

  if (access.isGlobalAdmin) return;
  if (!access.tenantIds.includes(selection.tenantId)) {
    const error = new Error('Kein Zugriff auf die Kategorien dieses Mandanten.');
    (error as any).status = 403;
    throw error;
  }
}

function extractJsonObject(raw: string): any | null {
  const text = String(raw || '')
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    const candidate = text.slice(start, end + 1).trim();
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

/**
 * GET /api/knowledge/config/redmine
 * Public endpoint: Redmine-Konfiguration auslesen (für Frontend)
 */
router.get('/config/redmine', async (req: Request, res: Response): Promise<any> => {
  try {
    const { values } = await loadRedmineSettings();

    return res.json({
      baseUrl: values.baseUrl,
      projects: values.projects || [],
      assignableUsers: values.assignableUsers || [],
      assignableGroupIds: values.assignableGroupIds || [],
      trackers: values.trackers || [],
      roles: values.roles || [],
      groups: values.groups || [],
      lastSync: values.lastSync || null,
    });
  } catch (error) {
    console.error('Redmine config load error:', error);
    return res.status(500).json({ 
      message: 'Fehler beim Laden der Redmine-Konfiguration',
      baseUrl: null,
      projects: [],
      assignableUsers: [],
      assignableGroupIds: [],
      trackers: [],
      roles: [],
      groups: [],
      lastSync: null
    });
  }
});

// Auth middleware applies to all following routes
router.use(authMiddleware, adminOnly);

/**
 * GET /api/knowledge
 * Aktuelle Wissensdatenbank laden
 */
router.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const { scope, tenantId } = resolveLibraryScope(req);
    await ensureLibraryScopeAccess(req, { scope, tenantId });
    const includeInheritedRaw = String(req.query?.includeInherited || '1').trim().toLowerCase();
    const includeInherited = includeInheritedRaw !== '0' && includeInheritedRaw !== 'false';
    const knowledge = await loadKnowledgeBaseFromLibrary({
      scope,
      tenantId,
      includeInherited,
    });
    const prompts = await loadSystemPrompts();
    return res.json({
      ...knowledge,
      classifyPrompt: prompts.values.classifyPrompt,
    });
  } catch (error: any) {
    console.error('Knowledge load error:', error);
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Laden der Wissensdatenbank',
      details: String(error),
    });
  }
});

/**
 * PATCH /api/knowledge/classify-prompt
 * Classify Prompt aktualisieren
 */
router.patch('/classify-prompt', async (req: Request, res: Response): Promise<any> => {
  try {
    await ensureLibraryScopeAccess(req, { scope: 'platform', tenantId: '' });
    const { classifyPrompt } = req.body;
    
    if (!classifyPrompt || typeof classifyPrompt !== 'string') {
      return res.status(400).json({ message: 'classifyPrompt ist erforderlich' });
    }

    const { values } = await loadSystemPrompts();
    const next = { ...values, classifyPrompt };
    await setSetting('systemPrompts', next);

    // Update environment variable (fallback)
    process.env.CLASSIFY_PROMPT = classifyPrompt;

    return res.json({ message: 'Classify Prompt aktualisiert', classifyPrompt });
  } catch (error: any) {
    console.error('Error updating classify prompt:', error);
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Aktualisieren des Classify Prompts',
    });
  }
});

/**
 * POST /api/knowledge/categories/assistant
 * KI-Entwurf für neue Kategorie erzeugen
 */
router.post('/categories/assistant', async (req: Request, res: Response): Promise<any> => {
  try {
    const { scope, tenantId } = resolveLibraryScope(req);
    await ensureLibraryScopeAccess(req, { scope, tenantId });
    const userPrompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!userPrompt || userPrompt.length < 8) {
      return res.status(400).json({ message: 'Bitte eine aussagekräftige Anforderung angeben.' });
    }

    const workflowTemplates = Array.isArray(req.body?.workflowTemplates)
      ? req.body.workflowTemplates
          .map((entry: any) => ({
            id: typeof entry?.id === 'string' ? entry.id.trim() : '',
            name: typeof entry?.name === 'string' ? entry.name.trim() : '',
          }))
          .filter((entry: { id: string; name: string }) => entry.id && entry.name)
          .slice(0, 120)
      : [];

    const existingCategories = await listKnowledgeCategories({
      scope,
      tenantId,
      includeInherited: scope === 'tenant',
    });
    const existingList = existingCategories
      .map((entry: any) => String(entry?.name || '').trim())
      .filter(Boolean)
      .slice(0, 200);
    const existingNameSet = new Set(existingList.map((entry: string) => entry.toLowerCase()));
    const workflowIdSet = new Set(workflowTemplates.map((entry: { id: string }) => entry.id));

    const systemPrompt = await getSystemPrompt('categoryAssistantPrompt');
    const prompt = `${systemPrompt}

Bestehende Kategorien:
${existingList.length ? existingList.map((name: string) => `- ${name}`).join('\n') : '- (keine)'}

Verfuegbare Workflow-Templates:
${workflowTemplates.length ? workflowTemplates.map((entry: { id: string; name: string }) => `- ${entry.id}: ${entry.name}`).join('\n') : '- (keine)'}

Anforderung:
${userPrompt}

Wichtig:
- Wenn kein passendes Workflow-Template existiert, workflowTemplateId leer lassen.
- Wenn kein externer Empfaenger sinnvoll ist, externalRecipientName und externalRecipientEmail leer lassen.`;

    const aiRaw = await testAIProvider(prompt, {
      purpose: 'category_assistant',
      meta: {
        source: 'routes.knowledge.category_assistant',
      },
    });

    const parsedResult = extractJsonObject(aiRaw);
    if (!parsedResult || typeof parsedResult !== 'object') {
      return res.status(422).json({ message: 'KI-Antwort konnte nicht als JSON ausgewertet werden.' });
    }

    const keywordsRaw = Array.isArray(parsedResult.keywords) ? parsedResult.keywords : [];
    const keywordSet = new Set<string>();
    const keywords = keywordsRaw
      .map((entry: any) => String(entry || '').trim())
      .filter((entry: string) => entry.length > 0 && entry.length <= 60)
      .filter((entry: string) => {
        const key = entry.toLowerCase();
        if (keywordSet.has(key)) return false;
        keywordSet.add(key);
        return true;
      })
      .slice(0, 12);

    const recipientEmailRaw = String(parsedResult.externalRecipientEmail || '').trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const externalRecipientEmail = emailPattern.test(recipientEmailRaw) ? recipientEmailRaw : '';

    const workflowTemplateIdRaw = String(parsedResult.workflowTemplateId || '').trim();
    const workflowTemplateId = workflowIdSet.has(workflowTemplateIdRaw) ? workflowTemplateIdRaw : '';

    const draft = {
      name: String(parsedResult.name || '').trim(),
      description: String(parsedResult.description || '').trim(),
      keywords,
      externalRecipientName: String(parsedResult.externalRecipientName || '').trim(),
      externalRecipientEmail,
      workflowTemplateId,
      workflowTemplateReason: String(parsedResult.workflowTemplateReason || '').trim(),
    };

    if (!draft.name) {
      return res.status(422).json({ message: 'KI-Entwurf enthält keinen gültigen Kategorienamen.' });
    }

    const nameConflict = existingNameSet.has(draft.name.toLowerCase());

    return res.json({
      draft,
      nameConflict,
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Erzeugen des Kategorie-Entwurfs',
      error: error?.message || String(error),
    });
  }
});

/**
 * PATCH /api/knowledge/categories/:id
 * Kategorie aktualisieren
 */
router.patch('/categories/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const updates = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    const { scope, tenantId } = resolveLibraryScope(req);
    await ensureLibraryScopeAccess(req, { scope, tenantId });
    const categories = await listKnowledgeCategories({
      scope,
      tenantId,
      includeInherited: false,
    });
    const existingCategory = categories.find((entry: any) => String(entry?.id || '') === String(id || '').trim());
    if (!existingCategory) {
      return res.status(404).json({ message: 'Kategorie nicht gefunden' });
    }

    // Prevent locked categories from being modified
    if (existingCategory.locked) {
      return res.status(403).json({ message: 'Diese Kategorie ist geschützt und kann nicht verändert werden' });
    }

    // Update category
    const nextCategory = {
      ...existingCategory,
      ...updates,
      id,
      locked: existingCategory.locked,
    };
    const processingModeError = applyCategoryProcessingMode(nextCategory, updates);
    if (processingModeError) {
      return res.status(400).json({ message: processingModeError });
    }
    const saved = await upsertKnowledgeCategory(nextCategory, { scope, tenantId });
    return res.json(saved);
  } catch (error: any) {
    console.error('Error updating category:', error);
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Aktualisieren der Kategorie',
    });
  }
});

/**
 * DELETE /api/knowledge/categories/:id
 * Kategorie löschen (mit Schutz vor gelockten Kategorien)
 */
router.delete('/categories/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { scope, tenantId } = resolveLibraryScope(req);
    await ensureLibraryScopeAccess(req, { scope, tenantId });
    const categories = await listKnowledgeCategories({
      scope,
      tenantId,
      includeInherited: false,
    });
    const categoryIndex = categories.findIndex((entry: any) => String(entry?.id || '') === String(id || '').trim());

    if (categoryIndex !== -1 && categories[categoryIndex].locked) {
      return res.status(403).json({ message: 'Diese Kategorie ist geschützt und kann nicht gelöscht werden' });
    }

    if (categoryIndex === -1) {
      return res.status(404).json({ message: 'Kategorie nicht gefunden' });
    }

    await deleteKnowledgeCategory(id, { scope, tenantId });
    return res.json({ message: 'Kategorie gelöscht' });
  } catch (error: any) {
    console.error('Error deleting category:', error);
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Löschen der Kategorie',
    });
  }
});

/**
 * POST /api/knowledge/categories
 * Neue Kategorie erstellen
 */
router.post('/categories', async (req: Request, res: Response): Promise<any> => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { id, name, description, ...rest } = body;
    const { scope, tenantId } = resolveLibraryScope(req);
    await ensureLibraryScopeAccess(req, { scope, tenantId });
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    
    if (!normalizedName) {
      return res.status(400).json({ message: 'name ist erforderlich' });
    }

    const existingCategories = await listKnowledgeCategories({
      scope,
      tenantId,
      includeInherited: false,
    });
    const existingIds = new Set<string>(existingCategories.map((c: any) => String(c.id)));
    const desiredId = typeof id === 'string' && id.trim() ? id.trim() : normalizedName;
    const normalizedId = nextUniqueCategoryId(desiredId, existingIds);

    const newCategory = {
      id: normalizedId,
      name: normalizedName,
      description: description || '',
      ...rest
    };
    const processingModeError = applyCategoryProcessingMode(newCategory, body);
    if (processingModeError) {
      return res.status(400).json({ message: processingModeError });
    }

    const saved = await upsertKnowledgeCategory(newCategory, { scope, tenantId });
    return res.status(201).json(saved);
  } catch (error: any) {
    console.error('Error creating category:', error);
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Erstellen der Kategorie',
    });
  }
});

/**
 * GET /api/knowledge/history
 * Git-Historie der Wissensdatenbank
 */
router.get('/history', async (req: Request, res: Response): Promise<any> => {
  try {
    // TODO: Parse git log for knowledge directory
    return res.json([
      { commit: 'abc123', message: 'Knowledge v1.0.0 initial', timestamp: '2026-02-10' }
    ]);
  } catch (error) {
    return res.status(500).json({ message: 'Fehler beim Abrufen der Historie' });
  }
});

export default router;
