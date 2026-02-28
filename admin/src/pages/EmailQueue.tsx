import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import { MenuItem, TextField } from '@mui/material';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  useSmartTableLiveRefresh,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { AdminKpiStrip, AdminPageHero } from '../components/admin-ui';
import './EmailQueue.css';

type EmailQueueStatus = 'pending' | 'retry' | 'processing' | 'sent' | 'failed' | 'cancelled';
type QueueFilter = EmailQueueStatus | 'all';

interface EmailQueueItem {
  id: string;
  to: string;
  subject: string;
  status: EmailQueueStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  scheduledAt: string;
  sentAt: string | null;
}

interface EmailQueueResponse {
  items: EmailQueueItem[];
  total: number;
  limit: number;
  offset: number;
  statusCounts: Record<EmailQueueStatus, number>;
}

const STATUS_LABELS: Record<EmailQueueStatus, string> = {
  pending: 'Wartet',
  retry: 'Erneuter Versuch',
  processing: 'Wird gesendet',
  sent: 'Gesendet',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

const STATUS_OPTIONS: Array<{ value: QueueFilter; label: string }> = [
  { value: 'all', label: 'Alle Status' },
  { value: 'pending', label: STATUS_LABELS.pending },
  { value: 'retry', label: STATUS_LABELS.retry },
  { value: 'processing', label: STATUS_LABELS.processing },
  { value: 'sent', label: STATUS_LABELS.sent },
  { value: 'failed', label: STATUS_LABELS.failed },
  { value: 'cancelled', label: STATUS_LABELS.cancelled },
];

const formatDateTime = (value?: string | null) => {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const EmailQueue: React.FC<{ token: string }> = ({ token }) => {
  const [queue, setQueue] = useState<EmailQueueResponse | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const fetchQueue = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (!silent) {
          setLoading(true);
        }
        const response = await axios.get('/api/admin/email-queue', {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            status: filter,
            limit: 200,
            offset: 0,
          },
        });
        setQueue(response.data);
        setError('');
      } catch (err: any) {
        setError(err.response?.data?.message || 'Fehler beim Laden der Mail-Queue');
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [filter, token]
  );

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  const liveRefresh = useSmartTableLiveRefresh({
    token,
    config: {
      enabled: true,
      mode: 'hybrid',
      topics: ['email_queue'],
      pollIntervalMsVisible: 30000,
      pollIntervalMsHidden: 120000,
      debounceMs: 150,
      refetchOnFocus: true,
      staleAfterMs: 180000,
    },
    refresh: (options) => fetchQueue(options),
  });

  const queueItems = queue?.items || [];

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => queueItems.some((item) => item.id === id)));
  }, [queueItems]);

  const selectedRows = useMemo(
    () => queueItems.filter((item) => selectedIds.includes(item.id)),
    [queueItems, selectedIds]
  );

  const withActionLoading = async (id: string, action: () => Promise<void>) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    setSuccess('');
    setError('');
    try {
      await action();
      await fetchQueue({ silent: true });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Aktion fehlgeschlagen');
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleRetry = async (id: string) => {
    await withActionLoading(id, async () => {
      await axios.post(`/api/admin/email-queue/${id}/retry`, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccess('Eintrag wird erneut zugestellt.');
    });
  };

  const handleResend = async (id: string) => {
    await withActionLoading(id, async () => {
      await axios.post(`/api/admin/email-queue/${id}/resend`, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccess('Neuversand wurde eingeplant.');
    });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Queue-Eintrag wirklich löschen?')) return;

    await withActionLoading(id, async () => {
      await axios.delete(`/api/admin/email-queue/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccess('Queue-Eintrag gelöscht.');
    });
  };

  const withBulkAction = async (
    actionName: string,
    handler: (id: string) => Promise<void>,
    options?: { confirmText?: string }
  ) => {
    if (selectedRows.length === 0) {
      setError('Keine Einträge ausgewählt.');
      return;
    }
    if (options?.confirmText && !window.confirm(options.confirmText)) {
      return;
    }

    setBulkLoading(true);
    setError('');
    setSuccess('');
    setActionLoading((prev) => {
      const next = { ...prev };
      selectedRows.forEach((item) => {
        next[item.id] = true;
      });
      return next;
    });

    try {
      const results = await Promise.allSettled(selectedRows.map((item) => handler(item.id)));
      const failed = results.filter((result) => result.status === 'rejected').length;
      const ok = results.length - failed;

      if (failed > 0) {
        setError(`${actionName}: ${ok} erfolgreich, ${failed} fehlgeschlagen.`);
      } else {
        setSuccess(`${actionName}: ${ok} Eintrag/Einträge verarbeitet.`);
      }

      await fetchQueue({ silent: true });
      setSelectedIds([]);
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        selectedRows.forEach((item) => {
          next[item.id] = false;
        });
        return next;
      });
      setBulkLoading(false);
    }
  };

  const handleBulkRetry = async () =>
    withBulkAction('Retry', async (id) => {
      await axios.post(`/api/admin/email-queue/${id}/retry`, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      });
    });

  const handleBulkResend = async () =>
    withBulkAction('Neuversand', async (id) => {
      await axios.post(`/api/admin/email-queue/${id}/resend`, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      });
    });

  const handleBulkDelete = async () =>
    withBulkAction(
      'Löschen',
      async (id) => {
        await axios.delete(`/api/admin/email-queue/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      },
      { confirmText: `${selectedRows.length} Queue-Eintrag/Einträge wirklich löschen?` }
    );

  const summary = useMemo(() => {
    const counts = queue?.statusCounts;
    return [
      { key: 'pending', label: STATUS_LABELS.pending, count: counts?.pending || 0 },
      { key: 'retry', label: STATUS_LABELS.retry, count: counts?.retry || 0 },
      { key: 'processing', label: STATUS_LABELS.processing, count: counts?.processing || 0 },
      { key: 'sent', label: STATUS_LABELS.sent, count: counts?.sent || 0 },
      { key: 'failed', label: STATUS_LABELS.failed, count: counts?.failed || 0 },
      { key: 'cancelled', label: STATUS_LABELS.cancelled, count: counts?.cancelled || 0 },
    ];
  }, [queue]);

  const summaryKpis = useMemo(
    () =>
      summary.map((item) => ({
        id: item.key,
        label: item.label,
        value: item.count,
        hint: item.key === 'failed' ? 'Prüfen' : item.key === 'sent' ? 'Erfolgreich' : 'Queue',
        tone:
          item.key === 'failed'
            ? ('danger' as const)
            : item.key === 'sent'
            ? ('success' as const)
            : item.key === 'processing' || item.key === 'retry'
            ? ('info' as const)
            : ('default' as const),
      })),
    [summary]
  );

  const columns = useMemo<SmartTableColumnDef<EmailQueueItem>[]>(
    () => [
      {
        field: 'to',
        headerName: 'Empfänger',
        minWidth: 220,
        flex: 1,
      },
      {
        field: 'subject',
        headerName: 'Betreff',
        minWidth: 280,
        flex: 1.6,
        renderCell: (params) => (
          <span className="smart-table-multiline-text" title={String(params.row.subject || '')}>
            {String(params.row.subject || '').trim() || '–'}
          </span>
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 150,
        renderCell: (params) => (
          <span className={`status-pill status-${params.row.status}`}>{STATUS_LABELS[params.row.status]}</span>
        ),
      },
      {
        field: 'attempts',
        headerName: 'Versuche',
        width: 130,
        valueGetter: (_value, row) => `${row.attempts} / ${row.maxAttempts}`,
      },
      {
        field: 'scheduledAt',
        headerName: 'Geplant',
        minWidth: 165,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'sentAt',
        headerName: 'Gesendet',
        minWidth: 165,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'createdAt',
        headerName: 'Erstellt',
        minWidth: 165,
        defaultVisible: false,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'lastError',
        headerName: 'Fehler',
        minWidth: 260,
        flex: 1.2,
        renderCell: (params) => (
          <span className="smart-table-multiline-text" title={String(params.row.lastError || '')}>
            {String(params.row.lastError || '').trim() || '–'}
          </span>
        ),
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 150,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (params) => {
          const item = params.row;
          const loadingThisRow = !!actionLoading[item.id] || bulkLoading;
          return (
            <SmartTableRowActions>
              <SmartTableRowActionButton
                label="Versand erneut versuchen"
                icon={<ReplayRoundedIcon fontSize="inherit" />}
                tone="warning"
                onClick={() => {
                  void handleRetry(item.id);
                }}
                disabled={loadingThisRow}
                loading={loadingThisRow}
              />
              <SmartTableRowActionButton
                label="E-Mail neu senden"
                icon={<SendRoundedIcon fontSize="inherit" />}
                tone="primary"
                onClick={() => {
                  void handleResend(item.id);
                }}
                disabled={loadingThisRow}
                loading={loadingThisRow}
              />
              <SmartTableRowActionButton
                label="Queue-Eintrag löschen"
                icon={<DeleteOutlineRoundedIcon fontSize="inherit" />}
                tone="danger"
                onClick={() => {
                  void handleDelete(item.id);
                }}
                disabled={loadingThisRow}
                loading={loadingThisRow}
              />
            </SmartTableRowActions>
          );
        },
      },
    ],
    [actionLoading, bulkLoading]
  );

  return (
    <div className="mail-queue-page">
      <AdminPageHero
        title="Mail Queue"
        subtitle="Versandstatus überwachen, Retrys starten und Mails gezielt erneut senden."
        icon={<i className="fa-solid fa-envelope-circle-check" />}
        badges={[
          {
            id: 'live',
            label:
              liveRefresh.liveState === 'live'
                ? 'Live verbunden'
                : liveRefresh.liveState === 'reconnecting'
                ? 'Verbindung wird hergestellt'
                : 'Polling aktiv',
            tone:
              liveRefresh.liveState === 'live'
                ? 'success'
                : liveRefresh.liveState === 'reconnecting'
                ? 'warning'
                : 'info',
          },
          { id: 'total', label: `Gesamt: ${queue?.total || 0}`, tone: 'info' },
        ]}
      />

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <AdminKpiStrip items={summaryKpis} className="mail-queue-summary" />

      {selectedIds.length > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-actions-meta">
            <span className="count">{selectedIds.length}</span>
            <span>ausgewählt</span>
          </div>
          <div className="bulk-actions-buttons">
            <button className="bulk-btn warning" type="button" onClick={handleBulkRetry} disabled={bulkLoading}>
              <i className="fa-solid fa-rotate-right" /> Retry
            </button>
            <button className="bulk-btn info" type="button" onClick={handleBulkResend} disabled={bulkLoading}>
              <i className="fa-solid fa-paper-plane" /> Neu senden
            </button>
            <button className="bulk-btn danger" type="button" onClick={handleBulkDelete} disabled={bulkLoading}>
              <i className="fa-solid fa-trash" /> Löschen
            </button>
            <button className="bulk-btn" type="button" onClick={() => setSelectedIds([])} disabled={bulkLoading}>
              Auswahl aufheben
            </button>
          </div>
        </div>
      )}

      <SmartTable<EmailQueueItem>
        tableId="email-queue"
        userId={token}
        title="Queue-Einträge"
        rows={queueItems}
        columns={columns}
        loading={loading}
        error=""
        checkboxSelection
        selectionModel={selectedIds}
        onSelectionModelChange={(ids) => setSelectedIds(ids)}
        onRefresh={liveRefresh.refreshNow}
        liveState={liveRefresh.liveState}
        lastEventAt={liveRefresh.lastEventAt}
        lastSyncAt={liveRefresh.lastSyncAt}
        isRefreshing={liveRefresh.isRefreshing}
        defaultPageSize={25}
        pageSizeOptions={[10, 25, 50, 100]}
        toolbarStartActions={
          <TextField
            select
            size="small"
            value={filter}
            label="Status"
            onChange={(event) => setFilter(event.target.value as QueueFilter)}
            sx={{ minWidth: 180 }}
          >
            {STATUS_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        }
      />

      <p className="mail-queue-total">Gesamt: {queue?.total || 0}</p>
    </div>
  );
};

export default EmailQueue;
