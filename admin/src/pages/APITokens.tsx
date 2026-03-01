import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';

interface ApiTokenItem {
  id: string;
  label?: string;
  tokenPrefix: string;
  createdAt?: string | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  isExpired?: boolean;
  isActive?: boolean;
}

interface ApiTokensProps {
  token: string;
}

type TokenStatusFilter = 'active' | 'all' | 'revoked';

function toLocalDateTimeInput(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

const formatDate = (value?: string | null): string => {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE');
};

const APITokens: React.FC<ApiTokensProps> = ({ token }) => {
  const [items, setItems] = useState<ApiTokenItem[]>([]);
  const [status, setStatus] = useState<TokenStatusFilter>('active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<{ active: number; revoked: number; expired: number }>({
    active: 0,
    revoked: 0,
    expired: 0,
  });
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState(toLocalDateTimeInput(90));
  const [createdToken, setCreatedToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchTokens = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        const response = await axios.get('/api/admin/api-tokens', {
          headers: { Authorization: `Bearer ${token}` },
          params: { status },
        });

        const rows: ApiTokenItem[] = Array.isArray(response.data?.items)
          ? response.data.items.map((entry: any) => ({
              id: String(entry?.id || ''),
              label: String(entry?.label || ''),
              tokenPrefix: String(entry?.tokenPrefix || ''),
              createdAt: entry?.createdAt || null,
              expiresAt: entry?.expiresAt || null,
              lastUsedAt: entry?.lastUsedAt || null,
              revokedAt: entry?.revokedAt || null,
              revokeReason: entry?.revokeReason || null,
              isExpired: Boolean(entry?.isExpired),
              isActive: Boolean(entry?.isActive),
            }))
          : [];

        setItems(rows.filter((row) => row.id.length > 0));
        setCounts({
          active: Number(response.data?.counts?.active || 0),
          revoked: Number(response.data?.counts?.revoked || 0),
          expired: Number(response.data?.counts?.expired || 0),
        });
        setError('');
      } catch (err) {
        if (axios.isAxiosError(err)) {
          setError(err.response?.data?.message || 'API-Tokens konnten nicht geladen werden.');
        } else {
          setError('API-Tokens konnten nicht geladen werden.');
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

  useEffect(() => {
    void fetchTokens();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchTokens({ silent: true });
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [fetchTokens]);

  const copyText = useCallback(async (value: string, successText: string) => {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.focus();
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setMessage(successText);
      setError('');
    } catch {
      setError('Kopieren in die Zwischenablage fehlgeschlagen.');
    }
  }, []);

  const handleCreateToken = useCallback(async () => {
    setCreateLoading(true);
    setError('');
    setMessage('');
    setCreatedToken('');

    try {
      const response = await axios.post(
        '/api/admin/api-tokens',
        {
          label: label.trim(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const tokenValue = String(response.data?.token || '').trim();
      if (tokenValue) {
        setCreatedToken(tokenValue);
      }
      setLabel('');
      setExpiresAt(toLocalDateTimeInput(90));
      setMessage('API-Token erzeugt. Klartext wird nur einmal angezeigt.');
      await fetchTokens({ silent: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'API-Token konnte nicht erzeugt werden.');
      } else {
        setError('API-Token konnte nicht erzeugt werden.');
      }
    } finally {
      setCreateLoading(false);
    }
  }, [expiresAt, fetchTokens, label, token]);

  const handleRevoke = useCallback(
    async (item: ApiTokenItem) => {
      if (!item.id) return;
      if (!window.confirm('API-Token wirklich widerrufen?')) return;

      setRevokeLoading((prev) => ({ ...prev, [item.id]: true }));
      setError('');
      setMessage('');

      try {
        await axios.post(
          `/api/admin/api-tokens/${item.id}/revoke`,
          { reason: 'revoked_by_user' },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setMessage('API-Token widerrufen.');
        await fetchTokens({ silent: true });
      } catch (err) {
        if (axios.isAxiosError(err)) {
          setError(err.response?.data?.message || 'API-Token konnte nicht widerrufen werden.');
        } else {
          setError('API-Token konnte nicht widerrufen werden.');
        }
      } finally {
        setRevokeLoading((prev) => ({ ...prev, [item.id]: false }));
      }
    },
    [fetchTokens, token]
  );

  const columns = useMemo<SmartTableColumnDef<ApiTokenItem>[]>(
    () => [
      {
        field: 'label',
        headerName: 'Bezeichnung',
        minWidth: 230,
        flex: 1.1,
        renderCell: (params) => (
          <Stack spacing={0.2} sx={{ py: 0.3 }}>
            <Typography variant="body2">{params.row.label || '–'}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {params.row.id}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'tokenPrefix',
        headerName: 'Präfix',
        minWidth: 170,
        flex: 0.8,
        valueGetter: (_value, row) => `${row.tokenPrefix || '–'}…`,
      },
      {
        field: 'createdAt',
        headerName: 'Erstellt',
        minWidth: 170,
        flex: 0.75,
        valueGetter: (_value, row) => formatDate(row.createdAt),
      },
      {
        field: 'expiresAt',
        headerName: 'Gültig bis',
        minWidth: 170,
        flex: 0.75,
        valueGetter: (_value, row) => formatDate(row.expiresAt),
      },
      {
        field: 'lastUsedAt',
        headerName: 'Zuletzt genutzt',
        minWidth: 170,
        flex: 0.75,
        valueGetter: (_value, row) => formatDate(row.lastUsedAt),
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 160,
        flex: 0.7,
        renderCell: (params) => {
          const item = params.row;
          const isRevoked = Boolean(item.revokedAt);
          const isExpired = Boolean(item.isExpired) && !isRevoked;
          const isActive = Boolean(item.isActive);
          return (
            <Stack spacing={0.2} sx={{ py: 0.3 }}>
              {isActive ? <Chip size="small" color="success" label="aktiv" /> : null}
              {isExpired ? <Chip size="small" color="warning" variant="outlined" label="abgelaufen" /> : null}
              {isRevoked ? <Chip size="small" color="error" variant="outlined" label="widerrufen" /> : null}
              {item.revokeReason ? (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {item.revokeReason}
                </Typography>
              ) : null}
            </Stack>
          );
        },
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 110,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params) => {
          const item = params.row;
          return (
            <SmartTableRowActions>
              <SmartTableRowActionButton
                label="Präfix kopieren"
                icon={<ContentCopyRoundedIcon fontSize="small" />}
                tone="default"
                onClick={() => {
                  void copyText(`${item.tokenPrefix}…`, 'Token-Präfix in die Zwischenablage kopiert.');
                }}
              />
              <SmartTableRowActionButton
                label="Token widerrufen"
                icon={<BlockRoundedIcon fontSize="small" />}
                tone="warning"
                disabled={!item.isActive}
                loading={Boolean(revokeLoading[item.id])}
                onClick={() => {
                  void handleRevoke(item);
                }}
              />
            </SmartTableRowActions>
          );
        },
      },
    ],
    [copyText, handleRevoke, revokeLoading]
  );

  const kpis = useMemo(
    () => [
      {
        id: 'tokens-active',
        label: 'Aktiv',
        value: counts.active.toLocaleString('de-DE'),
        tone: 'success' as const,
      },
      {
        id: 'tokens-revoked',
        label: 'Widerrufen',
        value: counts.revoked.toLocaleString('de-DE'),
      },
      {
        id: 'tokens-expired',
        label: 'Abgelaufen',
        value: counts.expired.toLocaleString('de-DE'),
        tone: 'warning' as const,
      },
      {
        id: 'tokens-sync',
        label: 'Sync',
        value: refreshing ? 'Aktualisiert' : 'Live',
        tone: refreshing ? ('info' as const) : ('success' as const),
      },
    ],
    [counts.active, counts.expired, counts.revoked, refreshing]
  );

  return (
    <Stack spacing={2.5} className="admin-page">
      <AdminPageHero
        title="API-Tokens"
        subtitle="Verwaltung automatisierter Zugriffe mit einheitlichem MUI-/SmartTable-Bedienkonzept."
        actions={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="stretch">
            <TextField
              select
              size="small"
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value as TokenStatusFilter)}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="active">Aktiv</MenuItem>
              <MenuItem value="revoked">Widerrufen</MenuItem>
              <MenuItem value="all">Alle</MenuItem>
            </TextField>
            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon fontSize="small" />}
              onClick={() => {
                void fetchTokens();
              }}
              disabled={loading}
            >
              Aktualisieren
            </Button>
          </Stack>
        }
      />

      <AdminKpiStrip items={kpis} />

      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <AdminSurfaceCard
        title="Neuen API-Token erzeugen"
        subtitle="Token-Klartext wird nach der Erzeugung genau einmal angezeigt."
      >
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1}>
            <TextField
              size="small"
              label="Bezeichnung"
              placeholder="z. B. n8n Produktion"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={createLoading}
              inputProps={{ maxLength: 120 }}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Gültig bis"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              disabled={createLoading}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 240 }}
            />
            <Button
              variant="contained"
              color="primary"
              startIcon={<KeyRoundedIcon fontSize="small" />}
              disabled={createLoading || !expiresAt}
              onClick={() => {
                void handleCreateToken();
              }}
            >
              {createLoading ? 'Erzeuge...' : 'Token erzeugen'}
            </Button>
          </Stack>

          {createdToken ? (
            <Alert
              severity="warning"
              icon={<WarningAmberRoundedIcon fontSize="small" />}
              action={
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ContentCopyRoundedIcon fontSize="small" />}
                  onClick={() => {
                    void copyText(createdToken, 'API-Token in die Zwischenablage kopiert.');
                  }}
                >
                  Kopieren
                </Button>
              }
            >
              <Stack spacing={0.6}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Nur einmal sichtbar
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                  {createdToken}
                </Typography>
              </Stack>
            </Alert>
          ) : null}
        </Stack>
      </AdminSurfaceCard>

      <AdminSurfaceCard
        title="Token-Liste"
        subtitle="Aktive und widerrufene Token mit Live-Refresh und konsistenten Row-Actions."
      >
        {loading ? (
          <Typography variant="body2" color="text.secondary">
            Lade API-Tokens...
          </Typography>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine API-Tokens vorhanden.
          </Typography>
        ) : (
          <SmartTable<ApiTokenItem>
            tableId="admin-api-tokens"
            userId={token}
            title="API-Tokens"
            rows={items}
            columns={columns}
            loading={loading}
            error={error}
            onRefresh={() => {
              void fetchTokens();
            }}
            disableRowSelectionOnClick
          />
        )}
      </AdminSurfaceCard>
    </Stack>
  );
};

export default APITokens;
