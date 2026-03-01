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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';

interface JournalEvent {
  id: string;
  eventType: string;
  severity?: 'info' | 'warning' | 'error';
  username?: string;
  role?: string;
  method?: string;
  path?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: unknown;
  createdAt?: string;
}

interface JournalProps {
  token: string;
}

const severityColor = (value?: JournalEvent['severity']): 'success' | 'warning' | 'error' | 'default' => {
  if (value === 'error') return 'error';
  if (value === 'warning') return 'warning';
  if (value === 'info') return 'success';
  return 'default';
};

const formatDate = (value?: string): string => {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE');
};

const detailsAsText = (details: unknown): string => {
  if (!details) return '–';
  try {
    const raw = typeof details === 'string' ? details : JSON.stringify(details);
    const normalized = raw.trim();
    if (!normalized) return '–';
    return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
  } catch {
    return '–';
  }
};

const Journal: React.FC<JournalProps> = ({ token }) => {
  const [items, setItems] = useState<JournalEvent[]>([]);
  const [eventType, setEventType] = useState('');
  const [eventOptions, setEventOptions] = useState<Array<{ eventType: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchJournal = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        const response = await axios.get('/api/admin/journal', {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            limit: 1000,
            offset: 0,
            ...(eventType ? { eventType } : {}),
          },
        });

        const rows: JournalEvent[] = Array.isArray(response.data?.items)
          ? response.data.items
              .map((entry: any, index: number) => ({
                id: String(entry?.id || `journal-${entry?.createdAt || index}`),
                eventType: String(entry?.eventType || 'unknown'),
                severity:
                  entry?.severity === 'warning' || entry?.severity === 'error' || entry?.severity === 'info'
                    ? entry.severity
                    : undefined,
                username: String(entry?.username || ''),
                role: String(entry?.role || ''),
                method: String(entry?.method || ''),
                path: String(entry?.path || ''),
                ipAddress: String(entry?.ipAddress || ''),
                userAgent: String(entry?.userAgent || ''),
                details: entry?.details,
                createdAt: String(entry?.createdAt || ''),
              }))
              .filter((entry: JournalEvent) => entry.id.length > 0)
          : [];

        setItems(rows);
        setEventOptions(
          Array.isArray(response.data?.availableEventTypes) ? response.data.availableEventTypes : []
        );
        setError('');
      } catch (err) {
        if (axios.isAxiosError(err)) {
          setError(err.response?.data?.message || 'Fehler beim Laden des Journals');
        } else {
          setError('Fehler beim Laden des Journals');
        }
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [eventType, token]
  );

  useEffect(() => {
    void fetchJournal();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchJournal({ silent: true });
      }
    }, 12000);
    return () => window.clearInterval(timer);
  }, [fetchJournal]);

  const selectedRows = useMemo(
    () => items.filter((entry) => selectedIds.includes(entry.id)),
    [items, selectedIds]
  );

  const handleDelete = useCallback(
    async (entry: JournalEvent) => {
      if (!window.confirm('Journal-Eintrag wirklich löschen?')) return;
      setDeleteLoading((prev) => ({ ...prev, [entry.id]: true }));
      setError('');
      setSuccess('');
      try {
        await axios.delete(`/api/admin/journal/${entry.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setItems((prev) => prev.filter((item) => item.id !== entry.id));
        setSelectedIds((prev) => prev.filter((id) => id !== entry.id));
        setSuccess('Journal-Eintrag gelöscht.');
      } catch (err) {
        if (axios.isAxiosError(err)) {
          setError(err.response?.data?.message || 'Löschen fehlgeschlagen');
        } else {
          setError('Löschen fehlgeschlagen');
        }
      } finally {
        setDeleteLoading((prev) => ({ ...prev, [entry.id]: false }));
      }
    },
    [token]
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectedRows.length === 0) {
      setError('Keine Journal-Einträge ausgewählt.');
      return;
    }
    if (!window.confirm(`${selectedRows.length} Journal-Einträge wirklich löschen?`)) {
      return;
    }

    setBulkLoading(true);
    setError('');
    setSuccess('');
    try {
      await axios.delete('/api/admin/journal', {
        headers: { Authorization: `Bearer ${token}` },
        data: { ids: selectedRows.map((entry) => entry.id) },
      });

      const selectedSet = new Set(selectedRows.map((entry) => entry.id));
      setItems((prev) => prev.filter((entry) => !selectedSet.has(entry.id)));
      setSelectedIds([]);
      setSuccess(`${selectedRows.length} Journal-Eintrag/Einträge gelöscht.`);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Löschen der Journal-Einträge');
      } else {
        setError('Fehler beim Löschen der Journal-Einträge');
      }
    } finally {
      setBulkLoading(false);
    }
  }, [selectedRows, token]);

  const handleExportSelection = useCallback(() => {
    if (selectedRows.length === 0) return;
    try {
      const blob = new Blob([JSON.stringify(selectedRows, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      anchor.href = url;
      anchor.download = `journal-auswahl-${stamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccess('Auswahl wurde als JSON exportiert.');
      setError('');
    } catch {
      setError('Auswahl konnte nicht exportiert werden.');
    }
  }, [selectedRows]);

  const columns = useMemo<SmartTableColumnDef<JournalEvent>[]>(
    () => [
      {
        field: 'createdAt',
        headerName: 'Zeit',
        minWidth: 170,
        flex: 0.75,
        valueGetter: (_value, row) => formatDate(row.createdAt),
      },
      {
        field: 'eventType',
        headerName: 'Ereignis',
        minWidth: 220,
        flex: 1,
        renderCell: (params) => (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
            <Chip
              size="small"
              color={severityColor(params.row.severity)}
              label={params.row.severity || 'info'}
              variant="outlined"
            />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {params.row.eventType || '–'}
            </Typography>
          </Stack>
        ),
      },
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
        field: 'request',
        headerName: 'Anfrage',
        minWidth: 210,
        flex: 1,
        valueGetter: (_value, row) => `${row.method || '–'} ${row.path || '–'}`,
      },
      {
        field: 'client',
        headerName: 'Client',
        minWidth: 230,
        flex: 1.2,
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
        field: 'details',
        headerName: 'Details',
        minWidth: 260,
        flex: 1.2,
        valueGetter: (_value, row) => detailsAsText(row.details),
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 100,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params) => (
          <SmartTableRowActions>
            <SmartTableRowActionButton
              label="Eintrag löschen"
              icon={<DeleteOutlineRoundedIcon fontSize="small" />}
              tone="danger"
              loading={Boolean(deleteLoading[params.row.id]) || bulkLoading}
              onClick={() => {
                void handleDelete(params.row);
              }}
            />
          </SmartTableRowActions>
        ),
      },
    ],
    [bulkLoading, deleteLoading, handleDelete]
  );

  const kpis = useMemo(
    () => [
      {
        id: 'journal-total',
        label: 'Einträge',
        value: items.length.toLocaleString('de-DE'),
      },
      {
        id: 'journal-selected',
        label: 'Ausgewählt',
        value: selectedRows.length.toLocaleString('de-DE'),
        tone: selectedRows.length > 0 ? ('warning' as const) : ('default' as const),
      },
      {
        id: 'journal-sync',
        label: 'Sync',
        value: refreshing ? 'Aktualisiert' : 'Live',
        tone: refreshing ? ('info' as const) : ('success' as const),
      },
    ],
    [items.length, refreshing, selectedRows.length]
  );

  return (
    <Stack spacing={2.5} className="admin-page">
      <AdminPageHero
        title="Journal"
        subtitle="Revisionsfähige Ereignisübersicht mit konsistenten SmartTable-Aktionen und Event-Filterung."
        actions={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="stretch">
            <TextField
              select
              size="small"
              label="Ereignis"
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="">Alle</MenuItem>
              {eventOptions.map((option) => (
                <MenuItem key={option.eventType} value={option.eventType}>
                  {option.eventType} ({option.count})
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon fontSize="small" />}
              onClick={() => {
                void fetchJournal();
              }}
              disabled={loading || bulkLoading}
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
        title="Journal-Einträge"
        subtitle="Selektion, Export und Bereinigung ohne Medienbruch zum restlichen Admin-UI."
        actions={
          selectedRows.length > 0 ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" color="warning" label={`${selectedRows.length} ausgewählt`} />
              <Button
                size="small"
                variant="outlined"
                startIcon={<UploadFileRoundedIcon fontSize="small" />}
                onClick={handleExportSelection}
                disabled={bulkLoading}
              >
                Export
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
                Löschen
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
            Lade Journal...
          </Typography>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Journal-Einträge gefunden.
          </Typography>
        ) : (
          <SmartTable<JournalEvent>
            tableId="admin-journal"
            userId={token}
            title="Journal"
            rows={items}
            columns={columns}
            loading={loading}
            error={error}
            onRefresh={() => {
              void fetchJournal();
            }}
            checkboxSelection
            selectionModel={selectedIds}
            onSelectionModelChange={setSelectedIds}
            disableRowSelectionOnClick
          />
        )}
      </AdminSurfaceCard>
    </Stack>
  );
};

export default Journal;
