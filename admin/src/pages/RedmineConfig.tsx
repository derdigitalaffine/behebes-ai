import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';
import SourceTag from '../components/SourceTag';

interface RedmineProject {
  id: number;
  name: string;
  identifier: string;
  enabled: boolean;
}

interface RedmineUser {
  id: number;
  login: string;
  firstname: string;
  lastname: string;
  mail?: string;
  status?: number;
  enabled: boolean;
}

interface RedmineTracker {
  id: number;
  name: string;
  enabled?: boolean;
}

interface RedmineRole {
  id: number;
  name: string;
  enabled?: boolean;
}

interface RedmineGroup {
  id: number;
  name: string;
  enabled?: boolean;
}

interface RedmineIssueStatus {
  id: number;
  name: string;
}

type UserStatusFilter = 'all' | 'active' | 'registered' | 'locked';

const normalizeNumericIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
};

const normalizeGroups = (rawGroups: unknown, assignableGroupIdsRaw: unknown): RedmineGroup[] => {
  const groups = Array.isArray(rawGroups)
    ? rawGroups
        .map((group: any) => ({
          id: Number(group?.id),
          name: String(group?.name || '').trim(),
          enabled: typeof group?.enabled === 'boolean' ? group.enabled : undefined,
        }))
        .filter((group: RedmineGroup) => Number.isFinite(group.id) && group.name)
    : [];
  const explicitGroupIdSet = new Set(normalizeNumericIds(assignableGroupIdsRaw));
  const hasExplicitSelection = explicitGroupIdSet.size > 0;
  return groups.map((group) => ({
    ...group,
    enabled: hasExplicitSelection ? explicitGroupIdSet.has(group.id) : !!group.enabled,
  }));
};

const RedmineConfig: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [projects, setProjects] = useState<RedmineProject[]>([]);
  const [users, setUsers] = useState<RedmineUser[]>([]);
  const [trackers, setTrackers] = useState<RedmineTracker[]>([]);
  const [roles, setRoles] = useState<RedmineRole[]>([]);
  const [groups, setGroups] = useState<RedmineGroup[]>([]);
  const [issueStatuses, setIssueStatuses] = useState<RedmineIssueStatus[]>([]);
  const [sources, setSources] = useState<Record<string, string>>({});

  const [userSearch, setUserSearch] = useState('');
  const [showOnlyEnabledUsers, setShowOnlyEnabledUsers] = useState(false);
  const [userStatusFilter, setUserStatusFilter] = useState<UserStatusFilter>('all');

  useEffect(() => {
    void fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const token = getAdminToken();
      const response = await axios.get('/api/admin/config/redmine', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setConfig(response.data);
      setBaseUrl(response.data?.baseUrl || '');
      setApiKey(response.data?.apiKey || '');
      setProjects(Array.isArray(response.data?.projects) ? response.data.projects : []);
      setUsers(Array.isArray(response.data?.assignableUsers) ? response.data.assignableUsers : []);
      setTrackers(Array.isArray(response.data?.trackers) ? response.data.trackers : []);
      setRoles(Array.isArray(response.data?.roles) ? response.data.roles : []);
      setGroups(normalizeGroups(response.data?.groups, response.data?.assignableGroupIds));
      setIssueStatuses(Array.isArray(response.data?.issueStatuses) ? response.data.issueStatuses : []);
      setSources(response.data?.sources || {});
    } catch (error: any) {
      setMessageType('error');
      setMessage(error.response?.data?.message || 'Fehler beim Laden der Redmine-Konfiguration');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncRedmine = async () => {
    setSyncing(true);
    setSyncWarnings([]);
    setMessage('');
    try {
      const token = getAdminToken();
      const response = await axios.post(
        '/api/admin/config/redmine/sync',
        { baseUrl, apiKey },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setProjects(Array.isArray(response.data?.projects) ? response.data.projects : []);
      setUsers(Array.isArray(response.data?.users) ? response.data.users : []);
      setTrackers(Array.isArray(response.data?.trackers) ? response.data.trackers : []);
      setRoles(Array.isArray(response.data?.roles) ? response.data.roles : []);
      setGroups(normalizeGroups(response.data?.groups, response.data?.assignableGroupIds));
      setIssueStatuses(Array.isArray(response.data?.issueStatuses) ? response.data.issueStatuses : []);
      setSyncWarnings(Array.isArray(response.data?.warnings) ? response.data.warnings : []);
      setConfig((prev: any) => ({
        ...(prev || {}),
        lastSync: new Date().toISOString(),
        baseUrl,
        apiKey,
      }));
      setMessageType('success');
      setMessage('Redmine-Daten synchronisiert.');
    } catch (error: any) {
      setMessageType('error');
      const apiMessage = error.response?.data?.message || 'Fehler beim Synchronisieren';
      const apiDetails = error.response?.data?.details;
      setMessage(apiDetails ? `${apiMessage}: ${apiDetails}` : apiMessage);
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    setMessage('');
    try {
      const token = getAdminToken();
      await axios.patch(
        '/api/admin/config/redmine',
        {
          baseUrl,
          apiKey,
          projects,
          users,
          trackers,
          roles,
          groups,
          assignableGroupIds: groups.filter((group) => group.enabled).map((group) => group.id),
          issueStatuses,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setConfig((prev: any) => ({
        ...(prev || {}),
        baseUrl,
        apiKey,
      }));
      setMessageType('success');
      setMessage('Redmine-Konfiguration gespeichert.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error.response?.data?.message || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const toggleProject = (projectId: number) => {
    setProjects((prev) => prev.map((project) => (project.id === projectId ? { ...project, enabled: !project.enabled } : project)));
  };

  const toggleUser = (userId: number) => {
    setUsers((prev) => prev.map((user) => (user.id === userId ? { ...user, enabled: !user.enabled } : user)));
  };

  const toggleTracker = (trackerId: number) => {
    setTrackers((prev) => prev.map((tracker) => (tracker.id === trackerId ? { ...tracker, enabled: !tracker.enabled } : tracker)));
  };

  const toggleRole = (roleId: number) => {
    setRoles((prev) => prev.map((role) => (role.id === roleId ? { ...role, enabled: !role.enabled } : role)));
  };

  const toggleGroup = (groupId: number) => {
    setGroups((prev) => prev.map((group) => (group.id === groupId ? { ...group, enabled: !group.enabled } : group)));
  };

  const enabledProjectCount = useMemo(() => projects.filter((project) => project.enabled).length, [projects]);
  const enabledUserCount = useMemo(() => users.filter((user) => user.enabled).length, [users]);
  const enabledTrackerCount = useMemo(() => trackers.filter((tracker) => !!tracker.enabled).length, [trackers]);
  const enabledRoleCount = useMemo(() => roles.filter((role) => !!role.enabled).length, [roles]);
  const enabledGroupCount = useMemo(() => groups.filter((group) => !!group.enabled).length, [groups]);

  const userStatusCounts = useMemo(
    () => ({
      active: users.filter((user) => Number(user.status) === 1).length,
      registered: users.filter((user) => Number(user.status) === 2).length,
      locked: users.filter((user) => Number(user.status) === 3).length,
      unknown: users.filter((user) => ![1, 2, 3].includes(Number(user.status))).length,
    }),
    [users]
  );

  const userSearchNormalized = userSearch.trim().toLowerCase();
  const matchesUserSearch = (user: RedmineUser): boolean => {
    if (!userSearchNormalized) return true;
    const fullName = `${user.firstname || ''} ${user.lastname || ''}`.toLowerCase();
    return (
      fullName.includes(userSearchNormalized) ||
      String(user.login || '').toLowerCase().includes(userSearchNormalized) ||
      String(user.mail || '').toLowerCase().includes(userSearchNormalized)
    );
  };

  const matchesUserStatus = (user: RedmineUser): boolean => {
    if (userStatusFilter === 'all') return true;
    if (userStatusFilter === 'active') return Number(user.status) === 1;
    if (userStatusFilter === 'registered') return Number(user.status) === 2;
    return Number(user.status) === 3;
  };

  const visibleUsers = useMemo(() => {
    const filtered = users.filter((user) => {
      if (!matchesUserSearch(user)) return false;
      if (!matchesUserStatus(user)) return false;
      if (showOnlyEnabledUsers && !user.enabled) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const aName = `${a.lastname || ''} ${a.firstname || ''}`.trim() || a.login || '';
      const bName = `${b.lastname || ''} ${b.firstname || ''}`.trim() || b.login || '';
      return aName.localeCompare(bName, 'de', { sensitivity: 'base' });
    });
  }, [users, showOnlyEnabledUsers, userSearchNormalized, userStatusFilter]);

  const userStatusLabel = (status?: number): string => {
    if (status === 1) return 'Aktiv';
    if (status === 2) return 'Registriert';
    if (status === 3) return 'Gesperrt';
    return 'Unbekannt';
  };

  const userStatusClasses = (status?: number): string => {
    if (status === 1) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 2) return 'bg-amber-50 text-amber-700 border-amber-200';
    if (status === 3) return 'bg-rose-50 text-rose-700 border-rose-200';
    return 'bg-slate-100 text-slate-600 border-slate-200';
  };

  const setAllProjectsEnabled = (enabled: boolean) => {
    setProjects((prev) => prev.map((project) => ({ ...project, enabled })));
  };

  const setAllTrackersEnabled = (enabled: boolean) => {
    setTrackers((prev) => prev.map((tracker) => ({ ...tracker, enabled })));
  };

  const setAllRolesEnabled = (enabled: boolean) => {
    setRoles((prev) => prev.map((role) => ({ ...role, enabled })));
  };

  const setAllGroupsEnabled = (enabled: boolean) => {
    setGroups((prev) => prev.map((group) => ({ ...group, enabled })));
  };

  const setVisibleUsersEnabled = (enabled: boolean) => {
    const visibleIdSet = new Set(visibleUsers.map((user) => user.id));
    setUsers((prev) =>
      prev.map((user) => (visibleIdSet.has(user.id) ? { ...user, enabled } : user))
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <i className="fa-solid fa-spinner fa-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {message && (
        <div
          className={`message-banner p-4 rounded-lg flex items-center gap-2 ${
            messageType === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
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

      {syncWarnings.length > 0 && (
        <div className="message-banner p-4 rounded-lg bg-amber-100 text-amber-900">
          <div className="font-semibold mb-2">
            <i className="fa-solid fa-triangle-exclamation" /> Synchronisierung mit Hinweisen
          </div>
          <ul className="list-disc list-inside space-y-1 text-sm">
            {syncWarnings.map((warning, idx) => (
              <li key={`${warning}-${idx}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-semibold">Redmine Verbindung & Synchronisierung</h2>
            <p className="text-sm text-slate-600 mt-1">
              Erst synchronisieren, dann gezielt Projekte, Benutzer, Rollen und Gruppen aktivieren.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            Letzte Synchronisierung:{' '}
            {config?.lastSync ? new Date(config.lastSync).toLocaleString('de-DE') : 'noch nie'}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-2">
              Redmine Base URL
              <SourceTag source={sources.baseUrl} />
            </label>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://redmine.example.com"
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">
              API-Key
              <SourceTag source={sources.apiKey} />
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Redmine API-Schlüssel"
              className="input w-full"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={handleSyncRedmine}
            disabled={syncing || !baseUrl || !apiKey}
            className="btn btn-primary"
          >
            {syncing ? (
              <>
                <i className="fa-solid fa-spinner fa-spin" /> Synchronisiere...
              </>
            ) : (
              <>
                <i className="fa-solid fa-rotate" /> Mit Redmine synchronisieren
              </>
            )}
          </button>
          <button onClick={handleSaveConfig} disabled={saving} className="btn btn-secondary">
            {saving ? (
              <>
                <i className="fa-solid fa-spinner fa-spin" /> Speichern...
              </>
            ) : (
              <>
                <i className="fa-solid fa-floppy-disk" /> Konfiguration speichern
              </>
            )}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Synchronisierungsstand</h3>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Projekte</div>
            <div className="text-base font-semibold">{enabledProjectCount} / {projects.length}</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Benutzer</div>
            <div className="text-base font-semibold">{enabledUserCount} / {users.length}</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Tracker</div>
            <div className="text-base font-semibold">{enabledTrackerCount} / {trackers.length}</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Rollen</div>
            <div className="text-base font-semibold">{enabledRoleCount} / {roles.length}</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Gruppen</div>
            <div className="text-base font-semibold">{enabledGroupCount} / {groups.length}</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Issue-Status</div>
            <div className="text-base font-semibold">{issueStatuses.length}</div>
          </div>
        </div>
      </div>

      {projects.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-lg font-semibold">Verfügbare Projekte</h3>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setAllProjectsEnabled(true)}>
                Alle aktivieren
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setAllProjectsEnabled(false)}>
                Alle deaktivieren
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {projects.map((project) => (
              <label key={project.id} className="flex items-center p-2 bg-slate-50 rounded border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={project.enabled}
                  onChange={() => toggleProject(project.id)}
                  className="mr-3"
                />
                <div>
                  <div className="font-medium">{project.name}</div>
                  <div className="text-sm text-slate-600">{project.identifier}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {users.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-lg font-semibold">Verfügbare Benutzer</h3>
            <div className="text-sm text-slate-600">
              Sichtbar: {visibleUsers.length} / {users.length}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto_auto] gap-2 mb-3">
            <input
              type="search"
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder="Benutzer suchen (Name, Login, E-Mail)"
              className="input w-full"
            />
            <select
              value={userStatusFilter}
              onChange={(event) => setUserStatusFilter(event.target.value as UserStatusFilter)}
              className="input min-w-[13rem]"
            >
              <option value="all">Alle Status</option>
              <option value="active">Nur aktiv</option>
              <option value="registered">Nur registriert</option>
              <option value="locked">Nur gesperrt</option>
            </select>
            <label className="inline-flex items-center gap-2 text-sm rounded border border-slate-200 px-3 py-2 bg-slate-50">
              <input
                type="checkbox"
                checked={showOnlyEnabledUsers}
                onChange={(event) => setShowOnlyEnabledUsers(event.target.checked)}
              />
              Nur aktive Auswahl
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => setVisibleUsersEnabled(true)}>
              Sichtbare aktivieren
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setVisibleUsersEnabled(false)}>
              Sichtbare deaktivieren
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
              Aktiv: {userStatusCounts.active}
            </span>
            <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
              Registriert: {userStatusCounts.registered}
            </span>
            <span className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
              Gesperrt: {userStatusCounts.locked}
            </span>
            {userStatusCounts.unknown > 0 ? (
              <span className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-slate-600">
                Unbekannt: {userStatusCounts.unknown}
              </span>
            ) : null}
          </div>

          <div className="space-y-2 max-h-[34rem] overflow-y-auto pr-1">
            {visibleUsers.length === 0 ? (
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                Keine Benutzer für den aktuellen Filter gefunden.
              </div>
            ) : (
              visibleUsers.map((user) => (
                <label key={user.id} className="flex items-center p-2 bg-slate-50 rounded border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={user.enabled}
                    onChange={() => toggleUser(user.id)}
                    className="mr-3"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-medium">
                        {user.firstname} {user.lastname}
                      </div>
                      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${userStatusClasses(user.status)}`}>
                        {userStatusLabel(user.status)}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600">@{user.login}</div>
                    {user.mail ? <div className="text-xs text-slate-500">{user.mail}</div> : null}
                  </div>
                </label>
              ))
            )}
          </div>
        </div>
      )}

      {trackers.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-lg font-semibold">
              <i className="fa-solid fa-tags" /> Verfügbare Tracker
            </h3>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setAllTrackersEnabled(true)}>
                Alle aktivieren
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setAllTrackersEnabled(false)}>
                Alle deaktivieren
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {trackers.map((tracker) => (
              <label key={tracker.id} className="flex items-center gap-3 p-2 bg-blue-50 rounded border border-blue-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!tracker.enabled}
                  onChange={() => toggleTracker(tracker.id)}
                />
                <div className="font-medium text-slate-900">{tracker.name}</div>
              </label>
            ))}
          </div>
        </div>
      )}

      {roles.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-lg font-semibold">
              <i className="fa-solid fa-user-shield" /> Verfügbare Rollen
            </h3>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setAllRolesEnabled(true)}>
                Alle aktivieren
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setAllRolesEnabled(false)}>
                Alle deaktivieren
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {roles.map((role) => (
              <label key={role.id} className="flex items-center gap-3 p-2 bg-green-50 rounded border border-green-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!role.enabled}
                  onChange={() => toggleRole(role.id)}
                />
                <div className="font-medium text-slate-900">{role.name}</div>
              </label>
            ))}
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-lg font-semibold">
              <i className="fa-solid fa-users" /> Verfügbare Gruppen
            </h3>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setAllGroupsEnabled(true)}>
                Alle aktivieren
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setAllGroupsEnabled(false)}>
                Alle deaktivieren
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-600 mb-3">
            Nur aktivierte Gruppen stehen in Workflow-Schritten als Assignee zur Verfügung.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groups.map((group) => (
              <label key={group.id} className="flex items-center gap-3 p-2 bg-purple-50 rounded border border-purple-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!group.enabled}
                  onChange={() => toggleGroup(group.id)}
                />
                <div className="font-medium text-slate-900">{group.name}</div>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="text-lg font-semibold mb-3">
          <i className="fa-solid fa-hourglass-half" /> Verfügbare Issue-Status
        </h3>
        <p className="text-sm text-slate-600 mb-3">
          Die Warte-Logik wird pro Redmine-Prozessschritt in den Workflow-Definitionen eingestellt.
        </p>
        {issueStatuses.length === 0 ? (
          <p className="text-sm text-slate-600">
            Keine Redmine-Status verfügbar. Bitte zuerst synchronisieren.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {issueStatuses.map((status) => (
              <div key={status.id} className="p-2 bg-slate-50 rounded border border-slate-200">
                <div className="font-medium text-slate-900">{status.name}</div>
                <div className="text-xs text-slate-500">ID: {status.id}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={handleSaveConfig} disabled={saving} className="btn btn-primary">
          {saving ? (
            <>
              <i className="fa-solid fa-spinner fa-spin" /> Speichern...
            </>
          ) : (
            <>
              <i className="fa-solid fa-floppy-disk" /> Konfiguration speichern
            </>
          )}
        </button>
        <button
          onClick={handleSyncRedmine}
          disabled={syncing || !baseUrl || !apiKey}
          className="btn btn-secondary"
        >
          {syncing ? (
            <>
              <i className="fa-solid fa-spinner fa-spin" /> Synchronisiere...
            </>
          ) : (
            <>
              <i className="fa-solid fa-rotate" /> Erneut synchronisieren
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default RedmineConfig;
