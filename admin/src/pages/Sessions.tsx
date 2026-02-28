import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTableSelection } from '../lib/tableSelection';
import './Audit.css';

interface SessionItem {
  id: string;
  adminUserId: string;
  username: string;
  role: string;
  ipAddress?: string;
  userAgent?: string;
  rememberMe?: number | boolean;
  issuedAt?: string;
  lastSeenAt?: string;
  expiresAt?: string;
  loggedOutAt?: string | null;
  isActive?: number | boolean;
  logoutReason?: string | null;
  sessionCookie: string;
  isExpired?: boolean;
}

interface CitizenAccountItem {
  id: string;
  emailNormalized: string;
  emailOriginal: string;
  createdAt?: string | null;
  verifiedAt?: string | null;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
  totalSessionCount?: number;
  activeSessionCount?: number;
  revokedSessionCount?: number;
}

interface SessionsProps {
  token: string;
}

type SortKey = 'username' | 'issuedAt' | 'lastSeenAt' | 'expiresAt' | 'status';
type SortDirection = 'asc' | 'desc';
type PageSize = 10 | 25 | 50 | 100;

const Sessions: React.FC<SessionsProps> = ({ token }) => {
  const [items, setItems] = useState<SessionItem[]>([]);
  const [citizenAccounts, setCitizenAccounts] = useState<CitizenAccountItem[]>([]);
  const [status, setStatus] = useState<'active' | 'all' | 'inactive'>('active');
  const [citizenStatus, setCitizenStatus] = useState<'active' | 'all' | 'inactive'>('active');
  const [counts, setCounts] = useState<{ active: number; inactive: number }>({ active: 0, inactive: 0 });
  const [citizenCounts, setCitizenCounts] = useState<{ active: number; inactive: number }>({ active: 0, inactive: 0 });
  const [search, setSearch] = useState('');
  const [citizenSearch, setCitizenSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('lastSeenAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [citizenLoading, setCitizenLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [citizenActionLoading, setCitizenActionLoading] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastActionUrl, setBroadcastActionUrl] = useState('');
  const [broadcastMode, setBroadcastMode] = useState<'all_active' | 'filtered_active'>('all_active');
  const [broadcastSendPush, setBroadcastSendPush] = useState(true);
  const [broadcastLoading, setBroadcastLoading] = useState(false);

  const fetchSessions = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) {
        setIsLoading(true);
      }
      const response = await axios.get('/api/admin/sessions', {
        headers: { Authorization: `Bearer ${token}` },
        params: { status, limit: 600, offset: 0 },
      });
      setItems(Array.isArray(response.data?.items) ? response.data.items : []);
      setCounts({
        active: Number(response.data?.counts?.active || 0),
        inactive: Number(response.data?.counts?.inactive || 0),
      });
      setError('');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Laden der Sessions');
      } else {
        setError('Fehler beim Laden der Sessions');
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  const fetchCitizenAccounts = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) {
        setCitizenLoading(true);
      }
      const response = await axios.get('/api/admin/citizen-accounts', {
        headers: { Authorization: `Bearer ${token}` },
        params: { status: citizenStatus, limit: 800, offset: 0 },
      });
      setCitizenAccounts(Array.isArray(response.data?.items) ? response.data.items : []);
      setCitizenCounts({
        active: Number(response.data?.counts?.active || 0),
        inactive: Number(response.data?.counts?.inactive || 0),
      });
      setError('');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Laden der Bürger-Logins');
      } else {
        setError('Fehler beim Laden der Bürger-Logins');
      }
    } finally {
      if (!silent) {
        setCitizenLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchSessions();
    fetchCitizenAccounts();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchSessions({ silent: true });
        void fetchCitizenAccounts({ silent: true });
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [token, status, citizenStatus]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, status]);

  const formatDate = (value?: string | null) => {
    if (!value) return '–';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '–';
    return date.toLocaleString('de-DE');
  };

  const parseDate = (value?: string | null) => {
    if (!value) return 0;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  };

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((session) => {
      const haystack = [
        session.username,
        session.role,
        session.ipAddress,
        session.userAgent,
        session.sessionCookie,
        session.logoutReason,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [items, search]);

  const filteredCitizenAccounts = useMemo(() => {
    const term = citizenSearch.trim().toLowerCase();
    if (!term) return citizenAccounts;
    return citizenAccounts.filter((account) => {
      const haystack = [
        account.emailOriginal,
        account.emailNormalized,
        String(account.activeSessionCount ?? ''),
        String(account.totalSessionCount ?? ''),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [citizenAccounts, citizenSearch]);

  const filteredActiveCitizenAccountIds = useMemo(
    () =>
      filteredCitizenAccounts
        .filter((account) => Number(account.activeSessionCount || 0) > 0)
        .map((account) => account.id)
        .filter(Boolean),
    [filteredCitizenAccounts]
  );

  const estimatedBroadcastTargets =
    broadcastMode === 'all_active' ? Number(citizenCounts.active || 0) : filteredActiveCitizenAccountIds.length;

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const aActive = a.isActive === true || a.isActive === 1;
      const bActive = b.isActive === true || b.isActive === 1;
      let comparison = 0;

      switch (sortKey) {
        case 'username':
          comparison = (a.username || '').localeCompare(b.username || '', 'de', { sensitivity: 'base' });
          break;
        case 'issuedAt':
          comparison = parseDate(a.issuedAt) - parseDate(b.issuedAt);
          break;
        case 'expiresAt':
          comparison = parseDate(a.expiresAt) - parseDate(b.expiresAt);
          break;
        case 'status':
          comparison = Number(aActive) - Number(bActive);
          break;
        case 'lastSeenAt':
        default:
          comparison = parseDate(a.lastSeenAt) - parseDate(b.lastSeenAt);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredItems, sortDirection, sortKey]);

  const selection = useTableSelection(sortedItems);

  const total = sortedItems.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pageItems = sortedItems.slice(start, start + pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection('asc');
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return '↕';
    return sortDirection === 'asc' ? '▲' : '▼';
  };

  const runRowAction = async (id: string, action: () => Promise<void>) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    setError('');
    setSuccess('');
    try {
      await action();
      await fetchSessions({ silent: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Aktion fehlgeschlagen');
      } else {
        setError('Aktion fehlgeschlagen');
      }
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleRevokeSession = async (session: SessionItem) => {
    if (!(session.isActive === true || session.isActive === 1)) {
      setError('Session ist bereits beendet.');
      return;
    }
    await runRowAction(session.id, async () => {
      await axios.post(
        `/api/admin/sessions/${session.id}/revoke`,
        { reason: 'revoked_by_admin' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccess(`Session von ${session.username} beendet.`);
    });
  };

  const handleDeleteSession = async (session: SessionItem) => {
    if (!window.confirm(`Session-Eintrag von ${session.username} wirklich löschen?`)) {
      return;
    }
    await runRowAction(session.id, async () => {
      await axios.delete(`/api/admin/sessions/${session.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccess(`Session-Eintrag von ${session.username} gelöscht.`);
    });
  };

  const runCitizenAccountAction = async (id: string, action: () => Promise<void>) => {
    setCitizenActionLoading((prev) => ({ ...prev, [id]: true }));
    setError('');
    setSuccess('');
    try {
      await action();
      await fetchCitizenAccounts({ silent: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Aktion für Bürgerkonto fehlgeschlagen');
      } else {
        setError('Aktion für Bürgerkonto fehlgeschlagen');
      }
    } finally {
      setCitizenActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleRevokeCitizenAccount = async (account: CitizenAccountItem) => {
    if ((account.activeSessionCount || 0) <= 0) {
      setError('Dieses Bürgerkonto hat aktuell keine aktiven Sessions.');
      return;
    }
    await runCitizenAccountAction(account.id, async () => {
      await axios.post(
        `/api/admin/citizen-accounts/${account.id}/revoke`,
        { reason: 'revoked_by_admin' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccess(`Alle aktiven Sessions für ${account.emailOriginal || account.emailNormalized} wurden beendet.`);
    });
  };

  const handleDeleteCitizenAccount = async (account: CitizenAccountItem) => {
    const label = account.emailOriginal || account.emailNormalized || account.id;
    if (!window.confirm(`Bürgerkonto ${label} wirklich löschen? Alle zugehörigen Sessions werden entfernt.`)) {
      return;
    }
    await runCitizenAccountAction(account.id, async () => {
      await axios.delete(`/api/admin/citizen-accounts/${account.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccess(`Bürgerkonto ${label} wurde gelöscht.`);
    });
  };

  const copySessionCookies = async (sessions: SessionItem[], label: string) => {
    if (sessions.length === 0) return;
    const payload = sessions.map((session) => session.sessionCookie).join('\n');
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(payload);
      } else {
        const area = document.createElement('textarea');
        area.value = payload;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.focus();
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setSuccess(label);
      setError('');
    } catch {
      setError('Cookies konnten nicht in die Zwischenablage kopiert werden');
    }
  };

  const runBulkAction = async (action: () => Promise<void>) => {
    setBulkLoading(true);
    setError('');
    setSuccess('');
    try {
      await action();
      await fetchSessions({ silent: true });
      selection.clearSelection();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Bulk-Aktion fehlgeschlagen');
      } else {
        setError('Bulk-Aktion fehlgeschlagen');
      }
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkRevoke = async () => {
    const activeSessions = selection.selectedRows.filter((session) => session.isActive === true || session.isActive === 1);
    if (activeSessions.length === 0) {
      setError('In der Auswahl sind keine aktiven Sessions.');
      return;
    }
    await runBulkAction(async () => {
      await axios.post(
        '/api/admin/sessions/revoke-bulk',
        { sessionIds: activeSessions.map((session) => session.id), reason: 'revoked_by_admin' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccess(`${activeSessions.length} Session(s) beendet.`);
    });
  };

  const handleBulkDelete = async () => {
    if (selection.selectedRows.length === 0) return;
    if (!window.confirm(`${selection.selectedRows.length} Session-Eintrag/Einträge wirklich löschen?`)) {
      return;
    }
    await runBulkAction(async () => {
      await axios.delete('/api/admin/sessions', {
        headers: { Authorization: `Bearer ${token}` },
        data: { sessionIds: selection.selectedRows.map((session) => session.id) },
      });
      setSuccess(`${selection.selectedRows.length} Session-Eintrag/Einträge gelöscht.`);
    });
  };

  const handleBroadcastCitizenMessage = async () => {
    const title = broadcastTitle.trim();
    const body = broadcastBody.trim();
    const actionUrl = broadcastActionUrl.trim();

    if (!title || !body) {
      setError('Titel und Nachrichtentext sind erforderlich.');
      setSuccess('');
      return;
    }
    if (broadcastMode === 'filtered_active' && filteredActiveCitizenAccountIds.length === 0) {
      setError('Im aktuellen Filter sind keine aktiven Bürgerkonten vorhanden.');
      setSuccess('');
      return;
    }

    setBroadcastLoading(true);
    setError('');
    setSuccess('');
    try {
      const payload =
        broadcastMode === 'all_active'
          ? {
              mode: 'all_active',
              title,
              body,
              actionUrl,
              sendPush: broadcastSendPush,
            }
          : {
              mode: 'account_ids',
              accountIds: filteredActiveCitizenAccountIds,
              title,
              body,
              actionUrl,
              sendPush: broadcastSendPush,
            };
      const response = await axios.post('/api/admin/citizen-messages/broadcast', payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const createdMessages = Number(response.data?.createdMessages || 0);
      const pushedMessages = Number(response.data?.pushedMessages || 0);
      const failedPushMessages = Number(response.data?.failedPushMessages || 0);
      setSuccess(
        `${createdMessages} App-Nachricht(en) erstellt · Push erfolgreich: ${pushedMessages} · Push fehlgeschlagen: ${failedPushMessages}`
      );
      setBroadcastBody('');
      await fetchCitizenAccounts({ silent: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Bürgernachricht konnte nicht gesendet werden.');
      } else {
        setError('Bürgernachricht konnte nicht gesendet werden.');
      }
    } finally {
      setBroadcastLoading(false);
    }
  };

  return (
    <div className="audit-page">
      <h2>Aktive Nutzer & Session Cookies</h2>
      <div className="audit-toolbar">
        <div className="left">
          <label htmlFor="session-status">Status</label>
          <select
            id="session-status"
            className="audit-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'active' | 'all' | 'inactive')}
          >
            <option value="active">Aktiv</option>
            <option value="inactive">Inaktiv</option>
            <option value="all">Alle</option>
          </select>
          <input
            className="audit-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche Benutzer, IP, Cookie..."
          />
          <select
            className="audit-select"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <button className="bulk-btn info" type="button" onClick={() => fetchSessions()} disabled={isLoading || bulkLoading}>
            <i className="fa-solid fa-rotate" /> Aktualisieren
          </button>
        </div>
        <div className="right">
          <span className="audit-pill">Aktiv: {counts.active}</span>
          <span className="audit-pill">Inaktiv: {counts.inactive}</span>
        </div>
      </div>

      {selection.selectedCount > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-actions-meta">
            <span className="count">{selection.selectedCount}</span>
            <span>ausgewählt</span>
          </div>
          <div className="bulk-actions-buttons">
            <button className="bulk-btn warning" type="button" onClick={handleBulkRevoke} disabled={bulkLoading}>
              <i className="fa-solid fa-user-slash" /> Sessions beenden
            </button>
            <button className="bulk-btn danger" type="button" onClick={handleBulkDelete} disabled={bulkLoading}>
              <i className="fa-solid fa-trash" /> Einträge löschen
            </button>
            <button
              className="bulk-btn info"
              type="button"
              onClick={() => copySessionCookies(selection.selectedRows, 'Ausgewählte Session-Cookies kopiert.')}
              disabled={bulkLoading}
            >
              <i className="fa-solid fa-copy" /> Cookies kopieren
            </button>
            <button className="bulk-btn" type="button" onClick={selection.clearSelection} disabled={bulkLoading}>
              Auswahl aufheben
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      {isLoading ? (
        <div className="loading">Lade Sessions...</div>
      ) : pageItems.length === 0 ? (
        <p>Keine Sessions gefunden.</p>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th className="table-select-col">
                  <input
                    type="checkbox"
                    className="table-select-checkbox"
                    checked={selection.areAllSelected(pageItems)}
                    onChange={() => selection.toggleAll(pageItems)}
                    aria-label="Alle Sessions auf der Seite auswählen"
                  />
                </th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => handleSort('username')}>
                    Benutzer {sortIcon('username')}
                  </button>
                </th>
                <th>Session Cookie</th>
                <th>IP</th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => handleSort('issuedAt')}>
                    Ausgestellt {sortIcon('issuedAt')}
                  </button>
                </th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => handleSort('lastSeenAt')}>
                    Zuletzt aktiv {sortIcon('lastSeenAt')}
                  </button>
                </th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => handleSort('expiresAt')}>
                    Ablauf {sortIcon('expiresAt')}
                  </button>
                </th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => handleSort('status')}>
                    Status {sortIcon('status')}
                  </button>
                </th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((session) => {
                const isActive = session.isActive === true || session.isActive === 1;
                const rowLoading = !!actionLoading[session.id] || bulkLoading;
                return (
                  <tr key={session.id}>
                    <td className="table-select-cell">
                      <input
                        type="checkbox"
                        className="table-select-checkbox"
                        checked={selection.isSelected(session.id)}
                        onChange={() => selection.toggleRow(session.id)}
                        aria-label={`Session ${session.username} auswählen`}
                      />
                    </td>
                    <td>
                      <div>{session.username}</div>
                      <div className="audit-meta">{session.role}</div>
                    </td>
                    <td>
                      <span className="audit-code">{session.sessionCookie}</span>
                      <div className="audit-meta">
                        <button
                          type="button"
                          className="bulk-btn info"
                          onClick={() => copySessionCookies([session], 'Session-Cookie kopiert.')}
                          disabled={rowLoading}
                        >
                          <i className="fa-solid fa-copy" /> Kopieren
                        </button>
                      </div>
                    </td>
                    <td>
                      <div>{session.ipAddress || '–'}</div>
                      <div className="audit-meta">{session.userAgent || '–'}</div>
                    </td>
                    <td>{formatDate(session.issuedAt)}</td>
                    <td>{formatDate(session.lastSeenAt)}</td>
                    <td>{formatDate(session.expiresAt)}</td>
                    <td>
                      <div className={`audit-event ${isActive ? 'info' : 'warning'}`}>
                        {isActive ? 'aktiv' : 'beendet'}
                      </div>
                      {!isActive && session.logoutReason && (
                        <div className="audit-meta">{session.logoutReason}</div>
                      )}
                      {session.isExpired && <div className="audit-meta">abgelaufen</div>}
                    </td>
                    <td>
                      <div className="audit-row-actions">
                        <button
                          type="button"
                          className="bulk-btn warning"
                          onClick={() => handleRevokeSession(session)}
                          disabled={rowLoading || !isActive}
                        >
                          <i className="fa-solid fa-user-slash" /> Beenden
                        </button>
                        <button
                          type="button"
                          className="bulk-btn danger"
                          onClick={() => handleDeleteSession(session)}
                          disabled={rowLoading}
                        >
                          <i className="fa-solid fa-trash" /> Löschen
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="audit-pagination">
            <span>
              Zeige {total === 0 ? 0 : start + 1}-{Math.min(start + pageSize, total)} von {total}
            </span>
            <div className="audit-pagination-actions">
              <button type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1}>
                Zurück
              </button>
              <span>Seite {page} / {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
              >
                Weiter
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="audit-section-separator" />

      <h2>Bürger-App Anmeldungen</h2>
      <div className="audit-toolbar">
        <div className="left">
          <label htmlFor="citizen-session-status">Status</label>
          <select
            id="citizen-session-status"
            className="audit-select"
            value={citizenStatus}
            onChange={(e) => setCitizenStatus(e.target.value as 'active' | 'all' | 'inactive')}
          >
            <option value="active">Aktiv</option>
            <option value="inactive">Inaktiv</option>
            <option value="all">Alle</option>
          </select>
          <input
            className="audit-input"
            type="text"
            value={citizenSearch}
            onChange={(e) => setCitizenSearch(e.target.value)}
            placeholder="Suche E-Mail..."
          />
          <button
            className="bulk-btn info"
            type="button"
            onClick={() => fetchCitizenAccounts()}
            disabled={citizenLoading}
          >
            <i className="fa-solid fa-rotate" /> Aktualisieren
          </button>
        </div>
        <div className="right">
          <span className="audit-pill">Aktiv: {citizenCounts.active}</span>
          <span className="audit-pill">Inaktiv: {citizenCounts.inactive}</span>
        </div>
      </div>

      <div className="bulk-actions-bar">
        <div className="bulk-actions-meta">
          <span className="count">{estimatedBroadcastTargets}</span>
          <span>voraussichtliche Empfänger</span>
        </div>
        <div className="bulk-actions-buttons" style={{ width: '100%' }}>
          <select
            className="audit-select"
            value={broadcastMode}
            onChange={(event) => setBroadcastMode(event.target.value as 'all_active' | 'filtered_active')}
            disabled={broadcastLoading}
          >
            <option value="all_active">Alle aktiven Bürgerkonten</option>
            <option value="filtered_active">Aktive Konten aus aktuellem Filter</option>
          </select>
          <input
            className="audit-input"
            type="text"
            value={broadcastTitle}
            onChange={(event) => setBroadcastTitle(event.target.value)}
            placeholder="Titel der Nachricht"
            disabled={broadcastLoading}
          />
          <input
            className="audit-input"
            type="text"
            value={broadcastActionUrl}
            onChange={(event) => setBroadcastActionUrl(event.target.value)}
            placeholder="Optionaler Link (z. B. /me oder https://...)"
            disabled={broadcastLoading}
          />
          <label className="audit-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <input
              type="checkbox"
              checked={broadcastSendPush}
              onChange={(event) => setBroadcastSendPush(event.target.checked)}
              disabled={broadcastLoading}
            />
            Push auslösen
          </label>
        </div>
        <textarea
          className="audit-input"
          value={broadcastBody}
          onChange={(event) => setBroadcastBody(event.target.value)}
          placeholder="Nachrichtentext für die Bürger-App"
          rows={4}
          disabled={broadcastLoading}
          style={{ width: '100%', minWidth: '100%' }}
        />
        <div className="bulk-actions-buttons">
          <button
            type="button"
            className="bulk-btn success"
            onClick={() => void handleBroadcastCitizenMessage()}
            disabled={broadcastLoading}
          >
            <i className="fa-solid fa-paper-plane" /> {broadcastLoading ? 'Sende...' : 'App-Nachricht senden'}
          </button>
        </div>
      </div>

      {citizenLoading ? (
        <div className="loading">Lade Bürger-Logins...</div>
      ) : filteredCitizenAccounts.length === 0 ? (
        <p>Keine Bürger-Logins gefunden.</p>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>E-Mail</th>
                <th>Sessions</th>
                <th>Verifiziert</th>
                <th>Letzter Login</th>
                <th>Zuletzt aktiv</th>
                <th>Konto erstellt</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filteredCitizenAccounts.map((account) => {
                const activeSessions = Number(account.activeSessionCount || 0);
                const rowLoading = !!citizenActionLoading[account.id];
                return (
                  <tr key={account.id}>
                    <td>
                      <div>{account.emailOriginal || account.emailNormalized || '–'}</div>
                      {account.emailNormalized &&
                        account.emailOriginal &&
                        account.emailOriginal !== account.emailNormalized && (
                          <div className="audit-meta">{account.emailNormalized}</div>
                        )}
                    </td>
                    <td>
                      <div className={`audit-event ${activeSessions > 0 ? 'info' : 'warning'}`}>
                        {activeSessions > 0 ? `${activeSessions} aktiv` : 'keine aktive'}
                      </div>
                      <div className="audit-meta">
                        Gesamt: {Number(account.totalSessionCount || 0)} · Beendet:{' '}
                        {Number(account.revokedSessionCount || 0)}
                      </div>
                    </td>
                    <td>{account.verifiedAt ? 'ja' : 'nein'}</td>
                    <td>{formatDate(account.lastLoginAt)}</td>
                    <td>{formatDate(account.lastSeenAt)}</td>
                    <td>{formatDate(account.createdAt)}</td>
                    <td>
                      <div className="audit-row-actions">
                        <button
                          type="button"
                          className="bulk-btn warning"
                          onClick={() => handleRevokeCitizenAccount(account)}
                          disabled={rowLoading || activeSessions <= 0}
                        >
                          <i className="fa-solid fa-user-slash" /> Sessions beenden
                        </button>
                        <button
                          type="button"
                          className="bulk-btn danger"
                          onClick={() => handleDeleteCitizenAccount(account)}
                          disabled={rowLoading}
                        >
                          <i className="fa-solid fa-trash" /> Konto löschen
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Sessions;
