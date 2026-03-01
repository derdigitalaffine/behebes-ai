import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import PersonOffRoundedIcon from '@mui/icons-material/PersonOffRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';

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

const formatDate = (value?: string | null): string => {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE');
};

const safeText = (value: unknown): string => String(value || '').trim();

const Sessions: React.FC<SessionsProps> = ({ token }) => {
  const [items, setItems] = useState<SessionItem[]>([]);
  const [citizenAccounts, setCitizenAccounts] = useState<CitizenAccountItem[]>([]);
  const [status, setStatus] = useState<'active' | 'all' | 'inactive'>('active');
  const [citizenStatus, setCitizenStatus] = useState<'active' | 'all' | 'inactive'>('active');
  const [counts, setCounts] = useState<{ active: number; inactive: number }>({ active: 0, inactive: 0 });
  const [citizenCounts, setCitizenCounts] = useState<{ active: number; inactive: number }>({ active: 0, inactive: 0 });
  const [search, setSearch] = useState('');
  const [citizenSearch, setCitizenSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [citizenLoading, setCitizenLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [citizenActionLoading, setCitizenActionLoading] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState(false);

  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastActionUrl, setBroadcastActionUrl] = useState('');
  const [broadcastMode, setBroadcastMode] = useState<'all_active' | 'filtered_active'>('all_active');
  const [broadcastSendPush, setBroadcastSendPush] = useState(true);
  const [broadcastLoading, setBroadcastLoading] = useState(false);

  const fetchSessions = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const response = await axios.get('/api/admin/sessions', {
          headers: { Authorization: `Bearer ${token}` },
          params: { status, limit: 1200, offset: 0 },
        });

        const rows: SessionItem[] = Array.isArray(response.data?.items)
          ? response.data.items.map((entry: any) => ({
              id: safeText(entry?.id),
              adminUserId: safeText(entry?.adminUserId),
              username: safeText(entry?.username),
              role: safeText(entry?.role),
              ipAddress: safeText(entry?.ipAddress),
              userAgent: safeText(entry?.userAgent),
              rememberMe: entry?.rememberMe,
              issuedAt: safeText(entry?.issuedAt),
              lastSeenAt: safeText(entry?.lastSeenAt),
              expiresAt: safeText(entry?.expiresAt),
              loggedOutAt: safeText(entry?.loggedOutAt) || null,
              isActive: entry?.isActive,
              logoutReason: safeText(entry?.logoutReason) || null,
              sessionCookie: safeText(entry?.sessionCookie),
              isExpired: Boolean(entry?.isExpired),
            }))
          : [];

        setItems(rows.filter((entry) => entry.id.length > 0));
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
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [status, token]
  );

  const fetchCitizenAccounts = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (!silent) {
          setCitizenLoading(true);
        }

        const response = await axios.get('/api/admin/citizen-accounts', {
          headers: { Authorization: `Bearer ${token}` },
          params: { status: citizenStatus, limit: 1600, offset: 0 },
        });

        const rows: CitizenAccountItem[] = Array.isArray(response.data?.items)
          ? response.data.items.map((entry: any) => ({
              id: safeText(entry?.id),
              emailNormalized: safeText(entry?.emailNormalized),
              emailOriginal: safeText(entry?.emailOriginal),
              createdAt: safeText(entry?.createdAt) || null,
              verifiedAt: safeText(entry?.verifiedAt) || null,
              lastLoginAt: safeText(entry?.lastLoginAt) || null,
              lastSeenAt: safeText(entry?.lastSeenAt) || null,
              totalSessionCount: Number(entry?.totalSessionCount || 0),
              activeSessionCount: Number(entry?.activeSessionCount || 0),
              revokedSessionCount: Number(entry?.revokedSessionCount || 0),
            }))
          : [];

        setCitizenAccounts(rows.filter((entry) => entry.id.length > 0));
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
    },
    [citizenStatus, token]
  );

  useEffect(() => {
    void fetchSessions();
    void fetchCitizenAccounts();

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchSessions({ silent: true });
        void fetchCitizenAccounts({ silent: true });
      }
    }, 15000);

    return () => window.clearInterval(timer);
  }, [fetchCitizenAccounts, fetchSessions]);

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
        String(account.activeSessionCount || 0),
        String(account.totalSessionCount || 0),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [citizenAccounts, citizenSearch]);

  const selectedRows = useMemo(
    () => filteredItems.filter((entry) => selectedIds.includes(entry.id)),
    [filteredItems, selectedIds]
  );

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

  const runSessionAction = useCallback(
    async (sessionId: string, action: () => Promise<void>) => {
      setActionLoading((prev) => ({ ...prev, [sessionId]: true }));
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
        setActionLoading((prev) => ({ ...prev, [sessionId]: false }));
      }
    },
    [fetchSessions]
  );

  const handleRevokeSession = useCallback(
    async (session: SessionItem) => {
      const isActive = session.isActive === true || session.isActive === 1;
      if (!isActive) {
        setError('Session ist bereits beendet.');
        return;
      }
      await runSessionAction(session.id, async () => {
        await axios.post(
          `/api/admin/sessions/${session.id}/revoke`,
          { reason: 'revoked_by_admin' },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setSuccess(`Session von ${session.username} beendet.`);
      });
    },
    [runSessionAction, token]
  );

  const handleDeleteSession = useCallback(
    async (session: SessionItem) => {
      if (!window.confirm(`Session-Eintrag von ${session.username} wirklich löschen?`)) return;
      await runSessionAction(session.id, async () => {
        await axios.delete(`/api/admin/sessions/${session.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSuccess(`Session-Eintrag von ${session.username} gelöscht.`);
      });
    },
    [runSessionAction, token]
  );

  const runCitizenAction = useCallback(
    async (accountId: string, action: () => Promise<void>) => {
      setCitizenActionLoading((prev) => ({ ...prev, [accountId]: true }));
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
        setCitizenActionLoading((prev) => ({ ...prev, [accountId]: false }));
      }
    },
    [fetchCitizenAccounts]
  );

  const handleRevokeCitizenAccount = useCallback(
    async (account: CitizenAccountItem) => {
      if ((account.activeSessionCount || 0) <= 0) {
        setError('Dieses Bürgerkonto hat aktuell keine aktiven Sessions.');
        return;
      }
      await runCitizenAction(account.id, async () => {
        await axios.post(
          `/api/admin/citizen-accounts/${account.id}/revoke`,
          { reason: 'revoked_by_admin' },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setSuccess(`Alle aktiven Sessions für ${account.emailOriginal || account.emailNormalized} wurden beendet.`);
      });
    },
    [runCitizenAction, token]
  );

  const handleDeleteCitizenAccount = useCallback(
    async (account: CitizenAccountItem) => {
      const label = account.emailOriginal || account.emailNormalized || account.id;
      if (!window.confirm(`Bürgerkonto ${label} wirklich löschen? Alle Sessions werden entfernt.`)) return;
      await runCitizenAction(account.id, async () => {
        await axios.delete(`/api/admin/citizen-accounts/${account.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSuccess(`Bürgerkonto ${label} wurde gelöscht.`);
      });
    },
    [runCitizenAction, token]
  );

  const copySessionCookies = useCallback(async (sessions: SessionItem[], label: string) => {
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
      setError('Cookies konnten nicht in die Zwischenablage kopiert werden.');
    }
  }, []);

  const handleBulkRevoke = useCallback(async () => {
    const activeSessions = selectedRows.filter((session) => session.isActive === true || session.isActive === 1);
    if (activeSessions.length === 0) {
      setError('In der Auswahl sind keine aktiven Sessions.');
      return;
    }

    setBulkLoading(true);
    setError('');
    setSuccess('');
    try {
      await axios.post(
        '/api/admin/sessions/revoke-bulk',
        {
          sessionIds: activeSessions.map((session) => session.id),
          reason: 'revoked_by_admin',
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccess(`${activeSessions.length} Session(s) beendet.`);
      setSelectedIds([]);
      await fetchSessions({ silent: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Bulk-Aktion fehlgeschlagen');
      } else {
        setError('Bulk-Aktion fehlgeschlagen');
      }
    } finally {
      setBulkLoading(false);
    }
  }, [fetchSessions, selectedRows, token]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedRows.length === 0) return;
    if (!window.confirm(`${selectedRows.length} Session-Eintrag/Einträge wirklich löschen?`)) return;

    setBulkLoading(true);
    setError('');
    setSuccess('');
    try {
      await axios.delete('/api/admin/sessions', {
        headers: { Authorization: `Bearer ${token}` },
        data: { sessionIds: selectedRows.map((session) => session.id) },
      });
      setSuccess(`${selectedRows.length} Session-Eintrag/Einträge gelöscht.`);
      setSelectedIds([]);
      await fetchSessions({ silent: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Bulk-Aktion fehlgeschlagen');
      } else {
        setError('Bulk-Aktion fehlgeschlagen');
      }
    } finally {
      setBulkLoading(false);
    }
  }, [fetchSessions, selectedRows, token]);

  const handleBroadcastCitizenMessage = useCallback(async () => {
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
  }, [
    broadcastActionUrl,
    broadcastBody,
    broadcastMode,
    broadcastSendPush,
    broadcastTitle,
    fetchCitizenAccounts,
    filteredActiveCitizenAccountIds,
    token,
  ]);

  const sessionColumns = useMemo<SmartTableColumnDef<SessionItem>[]>(
    () => [
      {
        field: 'username',
        headerName: 'Benutzer',
        minWidth: 180,
        flex: 0.9,
        renderCell: (params) => (
          <Stack spacing={0.2} sx={{ py: 0.3 }}>
            <Typography variant="body2">{params.row.username || '–'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {params.row.role || '–'}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'sessionCookie',
        headerName: 'Session-Cookie',
        minWidth: 260,
        flex: 1.05,
        valueGetter: (_value, row) => {
          const cookie = row.sessionCookie || '';
          if (!cookie) return '–';
          return cookie.length > 28 ? `${cookie.slice(0, 28)}…` : cookie;
        },
      },
      {
        field: 'ipAddress',
        headerName: 'Client',
        minWidth: 250,
        flex: 1.15,
        renderCell: (params) => (
          <Stack spacing={0.2} sx={{ py: 0.3 }}>
            <Typography variant="body2">{params.row.ipAddress || '–'}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 320 }} noWrap>
              {params.row.userAgent || '–'}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'issuedAt',
        headerName: 'Ausgestellt',
        minWidth: 165,
        flex: 0.72,
        valueGetter: (_value, row) => formatDate(row.issuedAt),
      },
      {
        field: 'lastSeenAt',
        headerName: 'Zuletzt aktiv',
        minWidth: 165,
        flex: 0.72,
        valueGetter: (_value, row) => formatDate(row.lastSeenAt),
      },
      {
        field: 'expiresAt',
        headerName: 'Ablauf',
        minWidth: 165,
        flex: 0.72,
        valueGetter: (_value, row) => formatDate(row.expiresAt),
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 160,
        flex: 0.7,
        renderCell: (params) => {
          const isActive = params.row.isActive === true || params.row.isActive === 1;
          return (
            <Stack spacing={0.2} sx={{ py: 0.3 }}>
              <Chip
                size="small"
                color={isActive ? 'success' : 'default'}
                variant={isActive ? 'filled' : 'outlined'}
                label={isActive ? 'aktiv' : 'beendet'}
              />
              {!isActive && params.row.logoutReason ? (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {params.row.logoutReason}
                </Typography>
              ) : null}
            </Stack>
          );
        },
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 140,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params) => {
          const row = params.row;
          const isActive = row.isActive === true || row.isActive === 1;
          const rowBusy = Boolean(actionLoading[row.id]) || bulkLoading;
          return (
            <SmartTableRowActions>
              <SmartTableRowActionButton
                label="Cookie kopieren"
                icon={<ContentCopyRoundedIcon fontSize="small" />}
                tone="default"
                disabled={rowBusy}
                onClick={() => {
                  void copySessionCookies([row], 'Session-Cookie kopiert.');
                }}
              />
              <SmartTableRowActionButton
                label="Session beenden"
                icon={<PersonOffRoundedIcon fontSize="small" />}
                tone="warning"
                disabled={!isActive || rowBusy}
                loading={Boolean(actionLoading[row.id]) && isActive}
                onClick={() => {
                  void handleRevokeSession(row);
                }}
              />
              <SmartTableRowActionButton
                label="Eintrag löschen"
                icon={<DeleteOutlineRoundedIcon fontSize="small" />}
                tone="danger"
                disabled={rowBusy}
                loading={Boolean(actionLoading[row.id]) && !isActive}
                onClick={() => {
                  void handleDeleteSession(row);
                }}
              />
            </SmartTableRowActions>
          );
        },
      },
    ],
    [actionLoading, bulkLoading, copySessionCookies, handleDeleteSession, handleRevokeSession]
  );

  const citizenColumns = useMemo<SmartTableColumnDef<CitizenAccountItem>[]>(
    () => [
      {
        field: 'emailOriginal',
        headerName: 'E-Mail',
        minWidth: 260,
        flex: 1.2,
        renderCell: (params) => (
          <Stack spacing={0.2} sx={{ py: 0.3 }}>
            <Typography variant="body2">{params.row.emailOriginal || params.row.emailNormalized || '–'}</Typography>
            {params.row.emailNormalized && params.row.emailNormalized !== params.row.emailOriginal ? (
              <Typography variant="caption" color="text.secondary">
                {params.row.emailNormalized}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'sessions',
        headerName: 'Sessions',
        minWidth: 200,
        flex: 1,
        renderCell: (params) => {
          const active = Number(params.row.activeSessionCount || 0);
          return (
            <Stack spacing={0.2} sx={{ py: 0.3 }}>
              <Chip
                size="small"
                color={active > 0 ? 'success' : 'default'}
                variant={active > 0 ? 'filled' : 'outlined'}
                label={active > 0 ? `${active} aktiv` : 'keine aktive'}
              />
              <Typography variant="caption" color="text.secondary">
                Gesamt: {Number(params.row.totalSessionCount || 0)} · Beendet: {Number(params.row.revokedSessionCount || 0)}
              </Typography>
            </Stack>
          );
        },
      },
      {
        field: 'verifiedAt',
        headerName: 'Verifiziert',
        minWidth: 120,
        flex: 0.55,
        valueGetter: (_value, row) => (row.verifiedAt ? 'ja' : 'nein'),
      },
      {
        field: 'lastLoginAt',
        headerName: 'Letzter Login',
        minWidth: 170,
        flex: 0.7,
        valueGetter: (_value, row) => formatDate(row.lastLoginAt),
      },
      {
        field: 'lastSeenAt',
        headerName: 'Zuletzt aktiv',
        minWidth: 170,
        flex: 0.7,
        valueGetter: (_value, row) => formatDate(row.lastSeenAt),
      },
      {
        field: 'createdAt',
        headerName: 'Erstellt',
        minWidth: 160,
        flex: 0.68,
        valueGetter: (_value, row) => formatDate(row.createdAt),
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 120,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params) => {
          const row = params.row;
          const active = Number(row.activeSessionCount || 0);
          const rowBusy = Boolean(citizenActionLoading[row.id]);
          return (
            <SmartTableRowActions>
              <SmartTableRowActionButton
                label="Sessions beenden"
                icon={<PersonOffRoundedIcon fontSize="small" />}
                tone="warning"
                disabled={rowBusy || active <= 0}
                loading={rowBusy && active > 0}
                onClick={() => {
                  void handleRevokeCitizenAccount(row);
                }}
              />
              <SmartTableRowActionButton
                label="Konto löschen"
                icon={<DeleteOutlineRoundedIcon fontSize="small" />}
                tone="danger"
                disabled={rowBusy}
                loading={rowBusy && active <= 0}
                onClick={() => {
                  void handleDeleteCitizenAccount(row);
                }}
              />
            </SmartTableRowActions>
          );
        },
      },
    ],
    [citizenActionLoading, handleDeleteCitizenAccount, handleRevokeCitizenAccount]
  );

  const kpis = useMemo(
    () => [
      {
        id: 'admin-active',
        label: 'Admin aktiv',
        value: counts.active.toLocaleString('de-DE'),
        tone: 'success' as const,
      },
      {
        id: 'admin-inactive',
        label: 'Admin inaktiv',
        value: counts.inactive.toLocaleString('de-DE'),
      },
      {
        id: 'citizen-active',
        label: 'Bürger aktiv',
        value: citizenCounts.active.toLocaleString('de-DE'),
        tone: 'info' as const,
      },
      {
        id: 'citizen-inactive',
        label: 'Bürger inaktiv',
        value: citizenCounts.inactive.toLocaleString('de-DE'),
      },
      {
        id: 'selected',
        label: 'Ausgewählte Sessions',
        value: selectedRows.length.toLocaleString('de-DE'),
        tone: selectedRows.length > 0 ? ('warning' as const) : ('default' as const),
      },
      {
        id: 'sync',
        label: 'Sync',
        value: refreshing ? 'Aktualisiert' : 'Live',
        tone: refreshing ? ('info' as const) : ('success' as const),
      },
    ],
    [citizenCounts.active, citizenCounts.inactive, counts.active, counts.inactive, refreshing, selectedRows.length]
  );

  return (
    <Stack spacing={2.5} className="admin-page">
      <AdminPageHero
        title="Sessions & Anmeldungen"
        subtitle="Zentrale Steuerung für Admin-Sessions, Bürger-Logins und Broadcast-Kommunikation im SmartTable-Standard."
        actions={
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="stretch">
            <TextField
              select
              size="small"
              label="Admin-Status"
              value={status}
              onChange={(event) => setStatus(event.target.value as 'active' | 'all' | 'inactive')}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="active">Aktiv</MenuItem>
              <MenuItem value="inactive">Inaktiv</MenuItem>
              <MenuItem value="all">Alle</MenuItem>
            </TextField>
            <TextField
              size="small"
              label="Suche Admin"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Benutzer, IP, Cookie"
              sx={{ minWidth: 220 }}
            />
            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon fontSize="small" />}
              onClick={() => {
                void fetchSessions();
                void fetchCitizenAccounts();
              }}
              disabled={loading || citizenLoading || bulkLoading}
            >
              Aktualisieren
            </Button>
          </Stack>
        }
      />

      <AdminKpiStrip items={kpis} />

      {error ? <Alert severity="error">{error}</Alert> : null}
      {success ? <Alert severity="success">{success}</Alert> : null}

      <AdminSurfaceCard
        title="Admin-Sessions"
        subtitle="Selektion, Bulk-Revoke, Bulk-Delete und Cookie-Aktionen ohne Tabellenbruch."
        actions={
          selectedRows.length > 0 ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" color="warning" label={`${selectedRows.length} ausgewählt`} />
              <Button
                size="small"
                color="warning"
                variant="outlined"
                startIcon={<PersonOffRoundedIcon fontSize="small" />}
                onClick={() => {
                  void handleBulkRevoke();
                }}
                disabled={bulkLoading}
              >
                Sessions beenden
              </Button>
              <Button
                size="small"
                color="error"
                variant="outlined"
                startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                onClick={() => {
                  void handleBulkDelete();
                }}
                disabled={bulkLoading}
              >
                Einträge löschen
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ContentCopyRoundedIcon fontSize="small" />}
                onClick={() => {
                  void copySessionCookies(selectedRows, 'Ausgewählte Session-Cookies kopiert.');
                }}
                disabled={bulkLoading}
              >
                Cookies kopieren
              </Button>
              <Button size="small" variant="text" onClick={() => setSelectedIds([])} disabled={bulkLoading}>
                Auswahl aufheben
              </Button>
            </Stack>
          ) : null
        }
      >
        {loading ? (
          <Typography variant="body2" color="text.secondary">
            Lade Sessions...
          </Typography>
        ) : filteredItems.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Sessions gefunden.
          </Typography>
        ) : (
          <SmartTable<SessionItem>
            tableId="admin-sessions"
            userId={token}
            title="Admin-Sessions"
            rows={filteredItems}
            columns={sessionColumns}
            loading={loading}
            error={error}
            onRefresh={() => {
              void fetchSessions();
            }}
            checkboxSelection
            selectionModel={selectedIds}
            onSelectionModelChange={setSelectedIds}
            disableRowSelectionOnClick
          />
        )}
      </AdminSurfaceCard>

      <AdminSurfaceCard
        title="Bürger-App-Anmeldungen"
        subtitle="Statuskontrolle und Eingriffe auf Kontoebene inklusive Session-Revoke."
        actions={
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="stretch">
            <TextField
              select
              size="small"
              label="Bürger-Status"
              value={citizenStatus}
              onChange={(event) => setCitizenStatus(event.target.value as 'active' | 'all' | 'inactive')}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="active">Aktiv</MenuItem>
              <MenuItem value="inactive">Inaktiv</MenuItem>
              <MenuItem value="all">Alle</MenuItem>
            </TextField>
            <TextField
              size="small"
              label="Suche Bürger"
              value={citizenSearch}
              onChange={(event) => setCitizenSearch(event.target.value)}
              placeholder="E-Mail"
              sx={{ minWidth: 220 }}
            />
            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon fontSize="small" />}
              onClick={() => {
                void fetchCitizenAccounts();
              }}
              disabled={citizenLoading}
            >
              Aktualisieren
            </Button>
          </Stack>
        }
      >
        {citizenLoading ? (
          <Typography variant="body2" color="text.secondary">
            Lade Bürger-Logins...
          </Typography>
        ) : filteredCitizenAccounts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Bürger-Logins gefunden.
          </Typography>
        ) : (
          <SmartTable<CitizenAccountItem>
            tableId="admin-citizen-accounts"
            userId={token}
            title="Bürger-App-Anmeldungen"
            rows={filteredCitizenAccounts}
            columns={citizenColumns}
            loading={citizenLoading}
            error={error}
            onRefresh={() => {
              void fetchCitizenAccounts();
            }}
            disableRowSelectionOnClick
          />
        )}
      </AdminSurfaceCard>

      <AdminSurfaceCard
        title="Broadcast an Bürger-App"
        subtitle="Nachricht an alle aktiven Konten oder nur an das aktuell gefilterte Segment senden."
        actions={<Chip icon={<CampaignRoundedIcon fontSize="small" />} label={`${estimatedBroadcastTargets} Empfänger`} color="info" variant="outlined" />}
      >
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
            <TextField
              select
              size="small"
              label="Zielgruppe"
              value={broadcastMode}
              onChange={(event) => setBroadcastMode(event.target.value as 'all_active' | 'filtered_active')}
              disabled={broadcastLoading}
              sx={{ minWidth: 260 }}
            >
              <MenuItem value="all_active">Alle aktiven Bürgerkonten</MenuItem>
              <MenuItem value="filtered_active">Aktive Konten aus aktuellem Filter</MenuItem>
            </TextField>
            <TextField
              size="small"
              label="Titel"
              value={broadcastTitle}
              onChange={(event) => setBroadcastTitle(event.target.value)}
              disabled={broadcastLoading}
              sx={{ flex: 1 }}
            />
          </Stack>

          <TextField
            size="small"
            label="Optionaler Link"
            placeholder="/me oder https://..."
            value={broadcastActionUrl}
            onChange={(event) => setBroadcastActionUrl(event.target.value)}
            disabled={broadcastLoading}
          />

          <TextField
            multiline
            minRows={4}
            label="Nachricht"
            value={broadcastBody}
            onChange={(event) => setBroadcastBody(event.target.value)}
            disabled={broadcastLoading}
          />

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ xs: 'flex-start', md: 'center' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={broadcastSendPush}
                  onChange={(event) => setBroadcastSendPush(event.target.checked)}
                  disabled={broadcastLoading}
                />
              }
              label="Push auslösen"
            />
            <Button
              variant="contained"
              color="primary"
              startIcon={<SendRoundedIcon fontSize="small" />}
              onClick={() => {
                void handleBroadcastCitizenMessage();
              }}
              disabled={broadcastLoading}
            >
              {broadcastLoading ? 'Sende...' : 'App-Nachricht senden'}
            </Button>
          </Stack>
        </Stack>
      </AdminSurfaceCard>
    </Stack>
  );
};

export default Sessions;
