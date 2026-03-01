import express, { Request, Response } from 'express';
import { authMiddleware, staffOnly } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { buildAdminCapabilities, loadAdminAccessContext } from '../services/rbac.js';

const router = express.Router();
router.use(authMiddleware, staffOnly);

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseKeywords(raw: unknown): string[] {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
    ? raw.split(/[\n,;|]+/g)
    : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of source) {
    const keyword = normalizeText(value).replace(/\s+/g, ' ').slice(0, 80);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
    if (out.length >= 200) break;
  }
  return out;
}

function serializeKeywords(raw: unknown): string | null {
  const normalized = parseKeywords(raw);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeText(entry)).filter(Boolean);
  }
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => normalizeText(entry)).filter(Boolean);
  } catch {
    return [];
  }
}

function parseJsonObject(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
  } catch {
    // ignore
  }
  return {};
}

async function resolveAccess(req: Request) {
  const userId = normalizeText(req.userId);
  const role = normalizeText(req.role);
  const access = await loadAdminAccessContext(userId, role);
  const capabilities = new Set(buildAdminCapabilities(access));
  return { userId, access, capabilities };
}

function resolveTenantId(
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

  const tenantIds = Array.from(new Set((access.tenantIds || []).map((entry) => normalizeText(entry)).filter(Boolean)));
  if (tenantIds.length === 0) {
    return { tenantId: null, error: 'Keine Mandanten im Zugriffskontext vorhanden.' };
  }
  const tenantId = requestedTenantId || tenantIds[0];
  if (!tenantIds.includes(tenantId)) {
    return { tenantId: null, error: 'tenantId liegt außerhalb des erlaubten Scopes.' };
  }
  return { tenantId };
}

function canManageServices(capabilities: Set<string>): boolean {
  return (
    capabilities.has('settings.organization.global.manage') ||
    capabilities.has('settings.organization.tenant.manage') ||
    capabilities.has('settings.categories.manage')
  );
}

function canReadServices(capabilities: Set<string>): boolean {
  return canManageServices(capabilities) || capabilities.has('tickets.read') || capabilities.has('workflows.read');
}

function mapServiceRow(row: any) {
  return {
    id: normalizeText(row?.id),
    tenantId: normalizeText(row?.tenant_id),
    externalRef: normalizeText(row?.external_ref) || null,
    name: normalizeText(row?.name),
    descriptionHtml: row?.description_html ? String(row.description_html) : '',
    publicationStatus: normalizeText(row?.publication_status) || null,
    chatbotRelevant: Number(row?.chatbot_relevant || 0) === 1,
    appointmentAllowed: Number(row?.appointment_allowed || 0) === 1,
    leikaKey: normalizeText(row?.leika_key) || null,
    ozgServices: parseJsonArray(row?.ozg_services_json),
    ozgRelevant: Number(row?.ozg_relevant || 0) === 1,
    assignmentKeywords: parseJsonArray(row?.assignment_keywords_json),
    metadata: parseJsonObject(row?.metadata_json),
    active: Number(row?.active ?? 1) === 1,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
  };
}

router.get('/services', async (req: Request, res: Response) => {
  try {
    const { access, capabilities } = await resolveAccess(req);
    if (!canReadServices(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung für Leistungen.' });
    }

    const scoped = resolveTenantId(access, req.query?.tenantId || req.header('x-admin-context-tenant-id'));
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }

    const q = normalizeText(req.query?.q || req.query?.search).toLowerCase();
    const activeOnly = String(req.query?.activeOnly || '1').trim() !== '0';
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 120)));
    const offset = Math.max(0, Number(req.query?.offset || 0));

    const params: any[] = [scoped.tenantId];
    const where: string[] = ['tenant_id = ?'];
    if (activeOnly) where.push('COALESCE(active, 1) = 1');
    if (q) {
      where.push(`(
        LOWER(COALESCE(name, '')) LIKE ?
        OR LOWER(COALESCE(external_ref, '')) LIKE ?
        OR LOWER(COALESCE(leika_key, '')) LIKE ?
      )`);
      const needle = `%${q}%`;
      params.push(needle, needle, needle);
    }

    const db = getDatabase();
    const rows = await db.all<any>(
      `SELECT *
       FROM services_catalog
       WHERE ${where.join(' AND ')}
       ORDER BY LOWER(COALESCE(name, '')) ASC, created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalRow = await db.get<any>(
      `SELECT COUNT(*) AS count
       FROM services_catalog
       WHERE ${where.join(' AND ')}`,
      params
    );

    return res.json({
      items: (rows || []).map((row) => mapServiceRow(row)),
      total: Number(totalRow?.count || 0),
      limit,
      offset,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Leistungen konnten nicht geladen werden.' });
  }
});

router.post('/services', async (req: Request, res: Response) => {
  try {
    const { access, capabilities } = await resolveAccess(req);
    if (!canManageServices(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung zum Verwalten von Leistungen.' });
    }

    const scoped = resolveTenantId(access, req.body?.tenantId || req.header('x-admin-context-tenant-id'));
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }

    const name = normalizeText(req.body?.name);
    if (!name) {
      return res.status(400).json({ message: 'name ist erforderlich.' });
    }

    const id = createId('svc');
    const db = getDatabase();
    await db.run(
      `INSERT INTO services_catalog (
        id, tenant_id, external_ref, name, description_html, publication_status,
        chatbot_relevant, appointment_allowed, leika_key, ozg_services_json, ozg_relevant,
        assignment_keywords_json, metadata_json, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        scoped.tenantId,
        normalizeText(req.body?.externalRef) || null,
        name,
        req.body?.descriptionHtml ? String(req.body.descriptionHtml) : null,
        normalizeText(req.body?.publicationStatus) || null,
        req.body?.chatbotRelevant === true ? 1 : 0,
        req.body?.appointmentAllowed === true ? 1 : 0,
        normalizeText(req.body?.leikaKey) || null,
        JSON.stringify(parseJsonArray(req.body?.ozgServices)),
        req.body?.ozgRelevant === true ? 1 : 0,
        serializeKeywords(req.body?.assignmentKeywords),
        JSON.stringify(parseJsonObject(req.body?.metadata)),
        req.body?.active === false ? 0 : 1,
      ]
    );

    const created = await db.get<any>(`SELECT * FROM services_catalog WHERE id = ? LIMIT 1`, [id]);
    return res.status(201).json({ service: mapServiceRow(created) });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Leistung konnte nicht erstellt werden.' });
  }
});

router.post('/services/purge-all', async (req: Request, res: Response) => {
  try {
    const { access, capabilities } = await resolveAccess(req);
    if (!canManageServices(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung zum Verwalten von Leistungen.' });
    }

    const scoped = resolveTenantId(access, req.body?.tenantId || req.header('x-admin-context-tenant-id'));
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }

    const tenantId = scoped.tenantId;
    const confirmTenantId = normalizeText(req.body?.confirmTenantId);
    if (!confirmTenantId || confirmTenantId !== tenantId) {
      return res.status(400).json({
        message: 'Sicherheitsprüfung fehlgeschlagen: confirmTenantId muss exakt tenantId entsprechen.',
      });
    }

    const db = getDatabase();
    const serviceCountRow = await db.get<any>(
      `SELECT COUNT(*) AS count FROM services_catalog WHERE tenant_id = ?`,
      [tenantId]
    );
    const serviceCount = Number(serviceCountRow?.count || 0);
    const expectedServiceCount = Number(req.body?.expectedServiceCount);
    if (!Number.isFinite(expectedServiceCount) || expectedServiceCount < 0) {
      return res.status(400).json({ message: 'expectedServiceCount ist ungültig.' });
    }
    if (expectedServiceCount !== serviceCount) {
      return res.status(409).json({
        message: 'Sicherheitsprüfung fehlgeschlagen: Anzahl der Leistungen hat sich geändert. Bitte erneut bestätigen.',
        actualServiceCount: serviceCount,
        expectedServiceCount,
        expectedConfirmationPhrase: `LOESCHE-ALLE-LEISTUNGEN:${tenantId}:${serviceCount}`,
      });
    }

    const expectedConfirmationPhrase = `LOESCHE-ALLE-LEISTUNGEN:${tenantId}:${serviceCount}`;
    const confirmPhrase = normalizeText(req.body?.confirmPhrase);
    if (!confirmPhrase || confirmPhrase !== expectedConfirmationPhrase) {
      return res.status(400).json({
        message: 'Sicherheitsprüfung fehlgeschlagen: Bestätigungscode ist ungültig.',
        expectedConfirmationPhrase,
      });
    }

    const orgLinkCountRow = await db.get<any>(
      `SELECT COUNT(*) AS count FROM service_org_unit_links WHERE tenant_id = ?`,
      [tenantId]
    );
    const userLinkCountRow = await db.get<any>(
      `SELECT COUNT(*) AS count FROM service_admin_user_links WHERE tenant_id = ?`,
      [tenantId]
    );
    const formLinkCountRow = await db.get<any>(
      `SELECT COUNT(*) AS count FROM service_form_links WHERE tenant_id = ?`,
      [tenantId]
    );

    await db.run('BEGIN');
    try {
      await db.run(`DELETE FROM service_org_unit_links WHERE tenant_id = ?`, [tenantId]);
      await db.run(`DELETE FROM service_admin_user_links WHERE tenant_id = ?`, [tenantId]);
      await db.run(`DELETE FROM service_form_links WHERE tenant_id = ?`, [tenantId]);
      await db.run(`DELETE FROM services_catalog WHERE tenant_id = ?`, [tenantId]);
      await db.run('COMMIT');
    } catch (innerError) {
      await db.run('ROLLBACK');
      throw innerError;
    }

    return res.json({
      message: 'Alle Leistungen des Mandanten wurden dauerhaft gelöscht.',
      tenantId,
      deleted: {
        services: serviceCount,
        orgUnitLinks: Number(orgLinkCountRow?.count || 0),
        adminUserLinks: Number(userLinkCountRow?.count || 0),
        formLinks: Number(formLinkCountRow?.count || 0),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Leistungen konnten nicht vollständig gelöscht werden.' });
  }
});

router.patch('/services/:serviceId', async (req: Request, res: Response) => {
  try {
    const { access, capabilities } = await resolveAccess(req);
    if (!canManageServices(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung zum Verwalten von Leistungen.' });
    }

    const serviceId = normalizeText(req.params.serviceId);
    if (!serviceId) return res.status(400).json({ message: 'serviceId fehlt.' });

    const db = getDatabase();
    const current = await db.get<any>(`SELECT * FROM services_catalog WHERE id = ? LIMIT 1`, [serviceId]);
    if (!current?.id) return res.status(404).json({ message: 'Leistung nicht gefunden.' });

    const scoped = resolveTenantId(access, req.body?.tenantId || current.tenant_id || req.header('x-admin-context-tenant-id'));
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }
    if (normalizeText(current.tenant_id) !== scoped.tenantId) {
      return res.status(403).json({ message: 'Kein Zugriff auf den Mandanten dieser Leistung.' });
    }

    const updates: string[] = [];
    const params: any[] = [];
    const setText = (field: string, value: unknown, max = 5000) => {
      updates.push(`${field} = ?`);
      const text = normalizeText(value);
      params.push(text ? text.slice(0, max) : null);
    };

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'externalRef')) setText('external_ref', req.body?.externalRef, 191);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) setText('name', req.body?.name, 400);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'descriptionHtml')) {
      updates.push('description_html = ?');
      params.push(req.body?.descriptionHtml ? String(req.body.descriptionHtml) : null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'publicationStatus')) setText('publication_status', req.body?.publicationStatus, 80);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'chatbotRelevant')) {
      updates.push('chatbot_relevant = ?');
      params.push(req.body?.chatbotRelevant === true ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'appointmentAllowed')) {
      updates.push('appointment_allowed = ?');
      params.push(req.body?.appointmentAllowed === true ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'leikaKey')) setText('leika_key', req.body?.leikaKey, 120);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'ozgServices')) {
      updates.push('ozg_services_json = ?');
      params.push(JSON.stringify(parseJsonArray(req.body?.ozgServices)));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'ozgRelevant')) {
      updates.push('ozg_relevant = ?');
      params.push(req.body?.ozgRelevant === true ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'assignmentKeywords')) {
      updates.push('assignment_keywords_json = ?');
      params.push(serializeKeywords(req.body?.assignmentKeywords));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'metadata')) {
      updates.push('metadata_json = ?');
      params.push(JSON.stringify(parseJsonObject(req.body?.metadata)));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'active')) {
      updates.push('active = ?');
      params.push(req.body?.active === false ? 0 : 1);
    }

    if (updates.length === 0) {
      return res.json({ service: mapServiceRow(current) });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(serviceId);
    await db.run(`UPDATE services_catalog SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = await db.get<any>(`SELECT * FROM services_catalog WHERE id = ? LIMIT 1`, [serviceId]);
    return res.json({ service: mapServiceRow(updated) });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Leistung konnte nicht aktualisiert werden.' });
  }
});

router.delete('/services/:serviceId', async (req: Request, res: Response) => {
  try {
    const { access, capabilities } = await resolveAccess(req);
    if (!canManageServices(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung zum Verwalten von Leistungen.' });
    }

    const serviceId = normalizeText(req.params.serviceId);
    const db = getDatabase();
    const current = await db.get<any>(`SELECT id, tenant_id FROM services_catalog WHERE id = ? LIMIT 1`, [serviceId]);
    if (!current?.id) return res.status(404).json({ message: 'Leistung nicht gefunden.' });

    const scoped = resolveTenantId(access, req.query?.tenantId || req.header('x-admin-context-tenant-id') || current.tenant_id);
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }
    if (normalizeText(current.tenant_id) !== scoped.tenantId) {
      return res.status(403).json({ message: 'Kein Zugriff auf den Mandanten dieser Leistung.' });
    }

    await db.run(`UPDATE services_catalog SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [serviceId]);
    return res.json({ message: 'Leistung deaktiviert.' });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Leistung konnte nicht deaktiviert werden.' });
  }
});

router.get('/services/:serviceId/links', async (req: Request, res: Response) => {
  try {
    const { access, capabilities } = await resolveAccess(req);
    if (!canReadServices(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung für Leistungen.' });
    }

    const serviceId = normalizeText(req.params.serviceId);
    const db = getDatabase();
    const current = await db.get<any>(`SELECT id, tenant_id FROM services_catalog WHERE id = ? LIMIT 1`, [serviceId]);
    if (!current?.id) return res.status(404).json({ message: 'Leistung nicht gefunden.' });

    const scoped = resolveTenantId(access, req.query?.tenantId || req.header('x-admin-context-tenant-id') || current.tenant_id);
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }
    if (normalizeText(current.tenant_id) !== scoped.tenantId) {
      return res.status(403).json({ message: 'Kein Zugriff auf den Mandanten dieser Leistung.' });
    }

    const [orgRows, userRows, formRows] = await Promise.all([
      db.all<any>(`SELECT org_unit_id FROM service_org_unit_links WHERE service_id = ? ORDER BY created_at ASC`, [serviceId]),
      db.all<any>(`SELECT admin_user_id FROM service_admin_user_links WHERE service_id = ? ORDER BY created_at ASC`, [serviceId]),
      db.all<any>(`SELECT form_ref FROM service_form_links WHERE service_id = ? ORDER BY created_at ASC`, [serviceId]),
    ]);

    return res.json({
      orgUnitIds: (orgRows || []).map((row: any) => normalizeText(row?.org_unit_id)).filter(Boolean),
      adminUserIds: (userRows || []).map((row: any) => normalizeText(row?.admin_user_id)).filter(Boolean),
      formRefs: (formRows || []).map((row: any) => normalizeText(row?.form_ref)).filter(Boolean),
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Leistungsverknüpfungen konnten nicht geladen werden.' });
  }
});

router.put('/services/:serviceId/links', async (req: Request, res: Response) => {
  try {
    const { access, capabilities } = await resolveAccess(req);
    if (!canManageServices(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung zum Verwalten von Leistungen.' });
    }

    const serviceId = normalizeText(req.params.serviceId);
    const db = getDatabase();
    const current = await db.get<any>(`SELECT id, tenant_id FROM services_catalog WHERE id = ? LIMIT 1`, [serviceId]);
    if (!current?.id) return res.status(404).json({ message: 'Leistung nicht gefunden.' });

    const scoped = resolveTenantId(access, req.body?.tenantId || req.header('x-admin-context-tenant-id') || current.tenant_id);
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }
    if (normalizeText(current.tenant_id) !== scoped.tenantId) {
      return res.status(403).json({ message: 'Kein Zugriff auf den Mandanten dieser Leistung.' });
    }

    const orgUnitIds = Array.from(new Set(parseJsonArray(req.body?.orgUnitIds)));
    const adminUserIds = Array.from(new Set(parseJsonArray(req.body?.adminUserIds)));
    const formRefs = Array.from(new Set(parseJsonArray(req.body?.formRefs)));

    await db.run(`DELETE FROM service_org_unit_links WHERE service_id = ?`, [serviceId]);
    await db.run(`DELETE FROM service_admin_user_links WHERE service_id = ?`, [serviceId]);
    await db.run(`DELETE FROM service_form_links WHERE service_id = ?`, [serviceId]);

    for (const orgUnitId of orgUnitIds) {
      await db.run(
        `INSERT INTO service_org_unit_links (id, service_id, tenant_id, org_unit_id, source)
         VALUES (?, ?, ?, ?, 'manual')`,
        [createId('sol'), serviceId, scoped.tenantId, orgUnitId]
      );
    }
    for (const adminUserId of adminUserIds) {
      await db.run(
        `INSERT INTO service_admin_user_links (id, service_id, tenant_id, admin_user_id, source)
         VALUES (?, ?, ?, ?, 'manual')`,
        [createId('sul'), serviceId, scoped.tenantId, adminUserId]
      );
    }
    for (const formRef of formRefs) {
      await db.run(
        `INSERT INTO service_form_links (id, service_id, tenant_id, form_ref, source)
         VALUES (?, ?, ?, ?, 'manual')`,
        [createId('sfl'), serviceId, scoped.tenantId, formRef]
      );
    }

    return res.json({
      orgUnitIds,
      adminUserIds,
      formRefs,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Leistungsverknüpfungen konnten nicht gespeichert werden.' });
  }
});

export default router;
