/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Integration Configuration API - Redmine
 */

import express, { Request, Response } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { loadRedmineSettings, setSetting } from '../services/settings.js';

const router = express.Router();

router.use(authMiddleware, adminOnly);

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/g, '');
}

function mergeEnabledById<T extends { id: number; enabled?: boolean }>(
  fresh: T[],
  existing: T[] | undefined
): T[] {
  const enabledMap = new Map<number, boolean>();
  (existing || []).forEach((item) => {
    if (typeof item.id === 'number') enabledMap.set(item.id, !!item.enabled);
  });
  return fresh.map((item) => ({
    ...item,
    enabled: enabledMap.has(item.id) ? enabledMap.get(item.id) : !!item.enabled,
  }));
}

function mergeEnabledByIdentifier<T extends { id: number; identifier?: string; enabled?: boolean }>(
  fresh: T[],
  existing: T[] | undefined
): T[] {
  const enabledMap = new Map<string, boolean>();
  (existing || []).forEach((item) => {
    if (item.identifier) enabledMap.set(item.identifier, !!item.enabled);
  });
  return fresh.map((item) => ({
    ...item,
    enabled: item.identifier && enabledMap.has(item.identifier) ? enabledMap.get(item.identifier) : !!item.enabled,
  }));
}

function normalizeNumericIdArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
}

function mergeGroupsWithSelection(
  freshGroups: Array<{ id: number; name: string; enabled?: boolean }>,
  existingGroups: any[] | undefined,
  existingAssignableGroupIds: unknown
) {
  const explicitIds = normalizeNumericIdArray(existingAssignableGroupIds);
  const enabledIdsFromGroups = new Set<number>();
  (existingGroups || []).forEach((group: any) => {
    if (typeof group?.id === 'number' && group.enabled === true) {
      enabledIdsFromGroups.add(group.id);
    }
  });

  const selectedIds =
    explicitIds.length > 0 ? new Set(explicitIds) : enabledIdsFromGroups;

  const groups = freshGroups.map((group) => ({
    ...group,
    enabled: selectedIds.has(group.id),
  }));
  const assignableGroupIds = groups
    .filter((group) => group.enabled)
    .map((group) => group.id);

  return { groups, assignableGroupIds };
}

async function fetchRedmineJson(baseUrl: string, apiKey: string, path: string) {
  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: { 'X-Redmine-API-Key': apiKey },
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let parsed: any = null;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const detail = parsed?.error || bodyText?.slice(0, 160) || 'Unbekannter Fehler';
      throw new Error(`${path} -> HTTP ${response.status}: ${detail}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`${path} -> Antwort ist kein JSON`);
    }

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRedminePagedCollection<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  collectionKey: string,
  mapper: (entry: any) => T,
  pageSize = 100
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;

  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const pagePath = `${path}${separator}limit=${pageSize}&offset=${offset}`;
    const data = await fetchRedmineJson(baseUrl, apiKey, pagePath);
    const rawEntries = Array.isArray(data?.[collectionKey]) ? data[collectionKey] : [];

    items.push(...rawEntries.map(mapper));

    const totalCount = Number(data?.total_count);
    const hasTotalCount = Number.isFinite(totalCount);

    if (hasTotalCount && items.length >= totalCount) break;
    if (rawEntries.length < pageSize) break;
    if (rawEntries.length === 0) break;

    offset += rawEntries.length;
  }

  return items;
}

type RedmineUserSyncItem = {
  id: number;
  login: string;
  firstname: string;
  lastname: string;
  mail: string;
  status?: number;
  enabled: boolean;
};

function mapRedmineUser(entry: any): RedmineUserSyncItem {
  const status = Number(entry?.status);
  return {
    id: Number(entry?.id),
    login: String(entry?.login || ''),
    firstname: String(entry?.firstname || ''),
    lastname: String(entry?.lastname || ''),
    mail: String(entry?.mail || ''),
    status: Number.isFinite(status) ? status : undefined,
    enabled: false,
  };
}

async function fetchAllRedmineUsers(
  baseUrl: string,
  apiKey: string,
  warnings: string[]
): Promise<RedmineUserSyncItem[]> {
  const usersById = new Map<number, RedmineUserSyncItem>();
  const states: Array<{ status: number; label: string }> = [
    { status: 1, label: 'aktiv' },
    { status: 2, label: 'registriert' },
    { status: 3, label: 'gesperrt' },
  ];

  for (const state of states) {
    try {
      const users = await fetchRedminePagedCollection(
        baseUrl,
        apiKey,
        `/users.json?status=${state.status}`,
        'users',
        mapRedmineUser
      );
      users.forEach((user) => {
        if (Number.isFinite(user.id)) usersById.set(user.id, user);
      });
    } catch (error) {
      warnings.push(
        `Benutzer (Status ${state.label}) konnten nicht geladen werden: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (usersById.size === 0) {
    const fallbackUsers = await fetchRedminePagedCollection(
      baseUrl,
      apiKey,
      '/users.json',
      'users',
      mapRedmineUser
    );
    fallbackUsers.forEach((user) => {
      if (Number.isFinite(user.id)) usersById.set(user.id, user);
    });
  }

  return Array.from(usersById.values()).sort((a, b) => {
    const aName = `${a.lastname} ${a.firstname}`.trim() || a.login;
    const bName = `${b.lastname} ${b.firstname}`.trim() || b.login;
    return aName.localeCompare(bName, 'de', { sensitivity: 'base' });
  });
}

// ============================================================================
// REDMINE CONFIGURATION
// ============================================================================

/**
 * GET /api/admin/config/redmine
 * Redmine-Konfiguration auslesen
 */
router.get('/redmine', async (req: Request, res: Response) => {
  try {
    const { values, sources } = await loadRedmineSettings();
    res.json({ ...values, sources });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Laden der Redmine-Konfiguration' });
  }
});

/**
 * POST /api/admin/config/redmine/sync
 * Mit Redmine synchronisieren - Projects, Tracker, User Roles und Groups
 */
router.post('/redmine/sync', async (req: Request, res: Response) => {
  try {
    const { baseUrl, apiKey } = req.body;

    if (!baseUrl || !apiKey) {
      return res.status(400).json({ message: 'baseUrl und apiKey erforderlich' });
    }

    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

    const { values: existingRedmine } = await loadRedmineSettings();

    // Fetch projects, trackers, users, roles, and groups from Redmine
    let projects: any[] = [];
    let users: any[] = [];
    let trackers: any[] = [];
    let roles: any[] = [];
    let groups: any[] = [];
    let issueStatuses: any[] = [];
    const warnings: string[] = [];

    try {
      // Mandatory: projects
      projects = await fetchRedminePagedCollection(
        normalizedBaseUrl,
        apiKey,
        '/projects.json',
        'projects',
        (p: any) => ({
          id: p.id,
          name: p.name,
          identifier: p.identifier,
          enabled: false,
        })
      );

      // Optional: users
      try {
        users = await fetchAllRedmineUsers(normalizedBaseUrl, apiKey, warnings);
      } catch (error) {
        warnings.push(`Benutzer konnten nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Optional: trackers
      try {
        const trackersData = await fetchRedmineJson(
          normalizedBaseUrl,
          apiKey,
          '/trackers.json'
        );
        trackers = (trackersData?.trackers || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          enabled: false,
        }));
      } catch (error) {
        warnings.push(`Tracker konnten nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`);
        // Fallback: common trackers
        trackers = [
          { id: 1, name: 'Bug', enabled: false },
          { id: 2, name: 'Feature', enabled: false },
          { id: 3, name: 'Support', enabled: false },
          { id: 4, name: 'Defect', enabled: false },
          { id: 5, name: 'Task', enabled: false },
        ];
      }

      // Optional: roles
      try {
        roles = await fetchRedminePagedCollection(
          normalizedBaseUrl,
          apiKey,
          '/roles.json',
          'roles',
          (r: any) => ({
            id: r.id,
            name: r.name,
            enabled: false,
          })
        );
      } catch (error) {
        warnings.push(`Rollen konnten nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Optional: groups
      try {
        groups = await fetchRedminePagedCollection(
          normalizedBaseUrl,
          apiKey,
          '/groups.json',
          'groups',
          (g: any) => ({
            id: g.id,
            name: g.name,
            enabled: false,
          })
        );
      } catch (error) {
        warnings.push(`Gruppen konnten nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Optional: issue statuses
      try {
        const statusesData = await fetchRedmineJson(
          normalizedBaseUrl,
          apiKey,
          '/issue_statuses.json'
        );
        issueStatuses = (statusesData?.issue_statuses || []).map((status: any) => ({
          id: status.id,
          name: status.name,
          enabled: false,
        }));
      } catch (error) {
        warnings.push(`Issue-Status konnten nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      console.error('Redmine API error:', error);
      return res.status(500).json({
        message: 'Fehler beim Abrufen von Redmine-Daten',
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Preserve enabled flags where possible
    const mergedProjects = mergeEnabledByIdentifier(projects, existingRedmine.projects);
    const mergedUsers = mergeEnabledById(users, existingRedmine.assignableUsers);
    const mergedTrackers = mergeEnabledById(trackers, existingRedmine.trackers);
    const mergedRoles = mergeEnabledById(roles, existingRedmine.roles);
    const mergedIssueStatuses = mergeEnabledById(issueStatuses, existingRedmine.issueStatuses);
    const mergedGroups = mergeGroupsWithSelection(
      groups,
      existingRedmine.groups,
      existingRedmine.assignableGroupIds
    );

    const nextRedmine = {
      enabled: true,
      baseUrl: normalizedBaseUrl,
      apiKey,
      projects: mergedProjects,
      assignableUsers: mergedUsers,
      assignableGroupIds: mergedGroups.assignableGroupIds,
      trackers: mergedTrackers,
      roles: mergedRoles,
      groups: mergedGroups.groups,
      issueStatuses: mergedIssueStatuses,
      lastSync: new Date().toISOString(),
    };
    await setSetting('redmine', nextRedmine);

    res.json({
      projects: mergedProjects,
      users: mergedUsers,
      trackers: mergedTrackers,
      roles: mergedRoles,
      groups: mergedGroups.groups,
      assignableGroupIds: mergedGroups.assignableGroupIds,
      issueStatuses: mergedIssueStatuses,
      warnings,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Synchronisierungsfehler',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * PATCH /api/admin/config/redmine
 * Redmine-Konfiguration speichern (Projects, Tracker, Roles, Groups, Users)
 */
router.patch('/redmine', async (req: Request, res: Response) => {
  try {
    const {
      baseUrl,
      apiKey,
      projects,
      users,
      trackers,
      roles,
      groups,
      assignableGroupIds,
      issueStatuses,
    } = req.body;
    const { values: existingRedmine } = await loadRedmineSettings();
    const normalizedBaseUrl = baseUrl ? normalizeBaseUrl(String(baseUrl)) : baseUrl;
    const normalizedGroups = Array.isArray(groups)
      ? groups
          .map((group: any) => ({
            id: Number(group?.id),
            name: String(group?.name || '').trim(),
            enabled: typeof group?.enabled === 'boolean' ? group.enabled : undefined,
          }))
          .filter((group: any) => Number.isFinite(group.id) && group.name)
      : [];
    const explicitAssignableGroupIds = normalizeNumericIdArray(assignableGroupIds);
    const selectedGroupIds =
      explicitAssignableGroupIds.length > 0
        ? explicitAssignableGroupIds
        : normalizedGroups
            .filter((group: any) => group.enabled === true)
            .map((group: any) => group.id);
    const selectedGroupSet = new Set(selectedGroupIds);
    const normalizedGroupsWithFlags = normalizedGroups.map((group: any) => ({
      ...group,
      enabled: selectedGroupSet.has(group.id),
    }));
    const persistedAssignableGroupIds = normalizedGroupsWithFlags
      .filter((group: any) => group.enabled)
      .map((group: any) => group.id);
    const nextConfig = {
      enabled: baseUrl && apiKey ? true : false,
      baseUrl: normalizedBaseUrl,
      apiKey,
      projects: projects || [],
      assignableUsers: users || [],
      assignableGroupIds: persistedAssignableGroupIds,
      trackers: trackers || [],
      roles: roles || [],
      groups: normalizedGroupsWithFlags,
      issueStatuses: Array.isArray(issueStatuses) ? issueStatuses : (existingRedmine.issueStatuses || []),
      lastSync: new Date().toISOString(),
    };

    await setSetting('redmine', nextConfig);
    res.json({ message: 'Redmine-Konfiguration gespeichert' });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Speichern der Konfiguration' });
  }
});

/**
 * GET /api/admin/config/redmine/trackers/:projectName
 * Verfügbare Tracker für ein Redmine-Projekt auslesen (via Projektname)
 */
router.get('/redmine/trackers/:projectName', async (req: Request, res: Response) => {
  try {
    const { projectName } = req.params;
    const { values: redmine } = await loadRedmineSettings();
    if (!redmine || !redmine.baseUrl || !redmine.apiKey) {
      return res.status(400).json({ message: 'Redmine nicht konfiguriert' });
    }

    // Find project by name
    const project = redmine.projects?.find((p: any) => p.name === projectName);
    if (!project) {
      return res.status(404).json({ message: 'Projekt nicht gefunden' });
    }

    // Fetch trackers from Redmine for this project using the project identifier
    try {
      const response = await fetch(`${redmine.baseUrl}/projects/${project.identifier}/trackers.json`, {
        headers: { 'X-Redmine-API-Key': redmine.apiKey },
      });

      if (!response.ok) {
        // Fallback: Return common trackers
        return res.json({
          trackers: [
            { id: 1, name: 'Bug' },
            { id: 2, name: 'Feature' },
            { id: 3, name: 'Support' },
            { id: 4, name: 'Defect' },
            { id: 5, name: 'Task' },
          ]
        });
      }

      const data = await response.json() as any;
      res.json({
        trackers: (data?.trackers || []).map((t: any) => ({
          id: t.id,
          name: t.name,
        }))
      });
    } catch (error) {
      console.error('Redmine tracker fetch error:', error);
      // Return default trackers on error
      res.json({
        trackers: [
          { id: 1, name: 'Bug' },
          { id: 2, name: 'Feature' },
          { id: 3, name: 'Support' },
          { id: 4, name: 'Defect' },
          { id: 5, name: 'Task' },
        ]
      });
    }
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Laden der Tracker' });
  }
});

export default router;
