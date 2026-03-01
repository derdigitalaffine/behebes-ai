import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Alert, Button, Chip, Stack, Typography } from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';

interface LogsProps {
  token: string;
}

interface LogEntry {
  id: string;
  ticketId: string;
  aiDecision: string;
  adminFeedback: string;
  createdAt: string;
}

const formatDate = (value?: string): string => {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE');
};

const Logs: React.FC<LogsProps> = ({ token }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchLogs = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        const response = await axios.get('/api/admin/logs', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const rows: LogEntry[] = Array.isArray(response.data)
          ? response.data
              .map((entry: any, index: number) => ({
                id: String(entry?.id || `${entry?.ticketId || 'log'}-${entry?.createdAt || index}`),
                ticketId: String(entry?.ticketId || ''),
                aiDecision: String(entry?.aiDecision || ''),
                adminFeedback: String(entry?.adminFeedback || ''),
                createdAt: String(entry?.createdAt || ''),
              }))
              .filter((entry: LogEntry) => entry.id.length > 0)
          : [];
        setLogs(rows);
        setError('');
      } catch (err) {
        if (axios.isAxiosError(err)) {
          setError(err.response?.data?.message || 'Fehler beim Laden der Logs');
        } else {
          setError('Ein Fehler ist aufgetreten');
        }
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [token]
  );

  useEffect(() => {
    void fetchLogs();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchLogs({ silent: true });
      }
    }, 12000);
    return () => window.clearInterval(timer);
  }, [fetchLogs]);

  const selectedRows = useMemo(
    () => logs.filter((entry) => selectedIds.includes(entry.id)),
    [logs, selectedIds]
  );

  const handleDelete = useCallback(
    async (entry: LogEntry) => {
      if (!window.confirm('AI-Log wirklich löschen?')) return;
      setDeleteLoading((prev) => ({ ...prev, [entry.id]: true }));
      setError('');
      setSuccess('');
      try {
        await axios.delete(`/api/admin/logs/${entry.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLogs((prev) => prev.filter((item) => item.id !== entry.id));
        setSelectedIds((prev) => prev.filter((id) => id !== entry.id));
        setSuccess('AI-Log gelöscht.');
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
      setError('Keine AI-Logs ausgewählt.');
      return;
    }
    if (!window.confirm(`${selectedRows.length} AI-Log-Einträge wirklich löschen?`)) {
      return;
    }

    setBulkDeleting(true);
    setError('');
    setSuccess('');
    try {
      await axios.delete('/api/admin/logs', {
        headers: { Authorization: `Bearer ${token}` },
        data: { ids: selectedRows.map((entry) => entry.id) },
      });
      const selectedSet = new Set(selectedRows.map((entry) => entry.id));
      setLogs((prev) => prev.filter((entry) => !selectedSet.has(entry.id)));
      setSelectedIds([]);
      setSuccess(`${selectedRows.length} AI-Log-Eintrag/Einträge gelöscht.`);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Löschen der AI-Logs');
      } else {
        setError('Fehler beim Löschen der AI-Logs');
      }
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedRows, token]);

  const columns = useMemo<SmartTableColumnDef<LogEntry>[]>(
    () => [
      {
        field: 'ticketId',
        headerName: 'Ticket',
        minWidth: 180,
        flex: 0.7,
        valueGetter: (_value, row) => row.ticketId || '–',
      },
      {
        field: 'aiDecision',
        headerName: 'AI-Entscheidung',
        minWidth: 280,
        flex: 1.3,
        valueGetter: (_value, row) => row.aiDecision || '–',
      },
      {
        field: 'adminFeedback',
        headerName: 'Admin-Feedback',
        minWidth: 240,
        flex: 1.1,
        valueGetter: (_value, row) => row.adminFeedback || '–',
      },
      {
        field: 'createdAt',
        headerName: 'Erstellt',
        minWidth: 180,
        flex: 0.75,
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
        renderCell: (params) => (
          <SmartTableRowActions>
            <SmartTableRowActionButton
              label="Log löschen"
              icon={<DeleteOutlineRoundedIcon fontSize="small" />}
              tone="danger"
              loading={Boolean(deleteLoading[params.row.id]) || bulkDeleting}
              onClick={() => {
                void handleDelete(params.row);
              }}
            />
          </SmartTableRowActions>
        ),
      },
    ],
    [bulkDeleting, deleteLoading, handleDelete]
  );

  const kpis = useMemo(
    () => [
      {
        id: 'logs-total',
        label: 'Einträge',
        value: logs.length.toLocaleString('de-DE'),
      },
      {
        id: 'logs-selected',
        label: 'Ausgewählt',
        value: selectedRows.length.toLocaleString('de-DE'),
        tone: selectedRows.length > 0 ? ('warning' as const) : ('default' as const),
      },
      {
        id: 'logs-sync',
        label: 'Sync',
        value: refreshing ? 'Aktualisiert' : 'Live',
        tone: refreshing ? ('info' as const) : ('success' as const),
      },
    ],
    [logs.length, refreshing, selectedRows.length]
  );

  return (
    <Stack spacing={2.5} className="admin-page">
      <AdminPageHero
        title="AI-Decision-Logs"
        subtitle="Konsolidierte Audit-Ansicht mit SmartTable-Filterung, Selektionsaktionen und Live-Refresh."
        badges={[
          { label: `${logs.length.toLocaleString('de-DE')} Einträge`, tone: 'info' },
          { label: `${selectedRows.length.toLocaleString('de-DE')} ausgewählt`, tone: selectedRows.length > 0 ? 'warning' : 'default' },
        ]}
        actions={
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon fontSize="small" />}
            onClick={() => {
              void fetchLogs();
            }}
            disabled={loading || bulkDeleting}
          >
            Aktualisieren
          </Button>
        }
      />

      <AdminKpiStrip items={kpis} />

      {error ? <Alert severity="error">{error}</Alert> : null}
      {success ? <Alert severity="success">{success}</Alert> : null}

      <AdminSurfaceCard
        title="Log-Einträge"
        subtitle="Suche, Sortierung, Spaltenlayout und Massenaktionen konsistent im SmartTable-Standard."
        actions={
          selectedRows.length > 0 ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" color="warning" label={`${selectedRows.length} ausgewählt`} />
              <Button
                color="error"
                variant="outlined"
                startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                onClick={() => {
                  void handleBulkDelete();
                }}
                disabled={bulkDeleting}
              >
                Auswahl löschen
              </Button>
              <Button
                variant="text"
                onClick={() => setSelectedIds([])}
                disabled={bulkDeleting}
              >
                Auswahl aufheben
              </Button>
            </Stack>
          ) : null
        }
      >
        {loading ? (
          <Typography variant="body2" color="text.secondary">
            Lade Logs...
          </Typography>
        ) : logs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Logs vorhanden.
          </Typography>
        ) : (
          <SmartTable<LogEntry>
            tableId="admin-ai-logs"
            userId={token}
            title="AI Decision Logs"
            rows={logs}
            columns={columns}
            loading={loading}
            error={error}
            onRefresh={() => {
              void fetchLogs();
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

export default Logs;
