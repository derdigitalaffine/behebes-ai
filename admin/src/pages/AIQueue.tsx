import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import { Button, MenuItem, Stack, TextField } from '@mui/material';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  useSmartTableLiveRefresh,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';
import { formatLlmTaskLabel } from '../lib/llmTaskLabels';
import './EmailQueue.css';
import './AIQueue.css';

type AiQueueStatus = 'pending' | 'retry' | 'processing' | 'done' | 'failed' | 'cancelled';
type QueueFilter = AiQueueStatus | 'all';

interface AiQueueItem {
  id: string;
  purpose: string;
  prompt: string;
  status: AiQueueStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  resultText: string | null;
  provider: string | null;
  model: string | null;
  meta: Record<string, any> | null;
  createdAt: string;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

interface AiQueueResponse {
  items: AiQueueItem[];
  total: number;
  limit: number;
  offset: number;
  statusCounts: Record<AiQueueStatus, number>;
}

interface LlmConnection {
  id: string;
  name: string;
  enabled: boolean;
}

interface LlmModel {
  id: string;
  label: string;
  vision: boolean;
}

interface LlmTaskMeta {
  taskKey: string;
  requiresVision: boolean;
}

interface LlmTaskRoutingResponse {
  routing: {
    defaultRoute: {
      connectionId: string;
      modelId: string;
    };
    routes: Record<string, { connectionId: string; modelId: string }>;
  };
  tasks: LlmTaskMeta[];
}

const STATUS_LABELS: Record<AiQueueStatus, string> = {
  pending: 'Wartet',
  retry: 'Retry',
  processing: 'Verarbeitung',
  done: 'Erfolgreich',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

const STATUS_OPTIONS: Array<{ value: QueueFilter; label: string }> = [
  { value: 'all', label: 'Alle Status' },
  { value: 'pending', label: STATUS_LABELS.pending },
  { value: 'retry', label: STATUS_LABELS.retry },
  { value: 'processing', label: STATUS_LABELS.processing },
  { value: 'done', label: STATUS_LABELS.done },
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

const formatPromptPreview = (value: string) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '–';
  return normalized;
};

const formatMultilineValue = (value?: string | null) => {
  const normalized = String(value || '').trim();
  return normalized || '–';
};

const AIQueue: React.FC<{ token: string }> = ({ token }) => {
  const [queue, setQueue] = useState<AiQueueResponse | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [detailItem, setDetailItem] = useState<AiQueueItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [connections, setConnections] = useState<LlmConnection[]>([]);
  const [taskRouting, setTaskRouting] = useState<LlmTaskRoutingResponse['routing'] | null>(null);
  const [taskMeta, setTaskMeta] = useState<LlmTaskMeta[]>([]);
  const [modelsByConnection, setModelsByConnection] = useState<Record<string, LlmModel[]>>({});

  const [testPrompt, setTestPrompt] = useState('');
  const [testPurpose, setTestPurpose] = useState('admin_ai_queue_test_run');
  const [testTaskKey, setTestTaskKey] = useState('default');
  const [testConnectionId, setTestConnectionId] = useState('');
  const [testModelId, setTestModelId] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    output: string;
    provider: string;
    connectionId: string;
    model: string;
    taskKey: string;
    timestamp: string;
  } | null>(null);

  const fetchQueue = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (!silent) {
          setLoading(true);
        }
        const response = await axios.get('/api/admin/ai-queue', {
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
        setError(err.response?.data?.message || 'Fehler beim Laden der KI-Queue');
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [filter, token]
  );

  const loadModels = useCallback(
    async (connectionId: string, refresh = false) => {
      const normalized = String(connectionId || '').trim();
      if (!normalized) return;
      try {
        const response = await axios.get(`/api/admin/llm/connections/${encodeURIComponent(normalized)}/models`, {
          headers: { Authorization: `Bearer ${token}` },
          params: refresh ? { refresh: 'true' } : undefined,
        });
        const models = Array.isArray(response.data?.items) ? response.data.items : [];
        setModelsByConnection((current) => ({ ...current, [normalized]: models }));
      } catch {
        setModelsByConnection((current) => ({ ...current, [normalized]: [] }));
      }
    },
    [token]
  );

  const loadLlmData = useCallback(async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [connectionsRes, routingRes] = await Promise.all([
        axios.get('/api/admin/llm/connections', { headers }),
        axios.get('/api/admin/llm/task-routing', { headers }),
      ]);
      const nextConnections = Array.isArray(connectionsRes.data?.items)
        ? (connectionsRes.data.items as LlmConnection[])
        : [];
      setConnections(nextConnections);
      const routingPayload = routingRes.data as LlmTaskRoutingResponse;
      setTaskRouting(routingPayload.routing || null);
      setTaskMeta(Array.isArray(routingPayload.tasks) ? routingPayload.tasks : []);

      const preloadConnectionIds = new Set<string>();
      if (routingPayload.routing?.defaultRoute?.connectionId) {
        preloadConnectionIds.add(routingPayload.routing.defaultRoute.connectionId);
      }
      Object.values(routingPayload.routing?.routes || {}).forEach((route) => {
        if (route?.connectionId) preloadConnectionIds.add(route.connectionId);
      });

      await Promise.all(
        Array.from(preloadConnectionIds)
          .filter(Boolean)
          .slice(0, 5)
          .map((connectionId) => loadModels(connectionId, false))
      );
    } catch {
      // optional for queue page
    }
  }, [loadModels, token]);

  useEffect(() => {
    void fetchQueue();
    void loadLlmData();
  }, [fetchQueue, loadLlmData]);

  useEffect(() => {
    if (!detailItem) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailItem(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [detailItem]);

  const liveRefresh = useSmartTableLiveRefresh({
    token,
    config: {
      enabled: true,
      mode: 'hybrid',
      topics: ['ai_queue'],
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
    setError('');
    setSuccess('');
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
      await axios.post(`/api/admin/ai-queue/${id}/retry`, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccess('KI-Anfrage erneut eingeplant.');
    });
  };

  const handleCancel = async (id: string) => {
    await withActionLoading(id, async () => {
      await axios.post(`/api/admin/ai-queue/${id}/cancel`, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccess('KI-Anfrage abgebrochen.');
    });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Queue-Eintrag wirklich löschen?')) return;
    await withActionLoading(id, async () => {
      await axios.delete(`/api/admin/ai-queue/${id}`, {
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
      await axios.post(`/api/admin/ai-queue/${id}/retry`, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      });
    });

  const handleBulkCancel = async () =>
    withBulkAction('Abbrechen', async (id) => {
      await axios.post(`/api/admin/ai-queue/${id}/cancel`, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      });
    });

  const handleBulkDelete = async () =>
    withBulkAction(
      'Löschen',
      async (id) => {
        await axios.delete(`/api/admin/ai-queue/${id}`, {
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
      { key: 'done', label: STATUS_LABELS.done, count: counts?.done || 0 },
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
        hint: item.key === 'failed' ? 'Prüfbedarf' : item.key === 'done' ? 'Erledigt' : 'Queue',
        tone:
          item.key === 'failed'
            ? ('danger' as const)
            : item.key === 'processing' || item.key === 'retry'
            ? ('info' as const)
            : item.key === 'done'
            ? ('success' as const)
            : ('default' as const),
      })),
    [summary]
  );

  const resolvedTaskMeta = useMemo(() => {
    const map = new Map<string, LlmTaskMeta>();
    taskMeta.forEach((entry) => {
      if (!entry?.taskKey) return;
      map.set(entry.taskKey, entry);
    });
    return map;
  }, [taskMeta]);

  const routeForTask = useMemo(() => {
    if (!taskRouting) return null;
    return taskRouting.routes?.[testTaskKey] || taskRouting.defaultRoute || null;
  }, [taskRouting, testTaskKey]);

  const effectiveConnectionId = String(testConnectionId || routeForTask?.connectionId || '').trim();
  const selectedTaskRequiresVision = resolvedTaskMeta.get(testTaskKey)?.requiresVision === true;

  useEffect(() => {
    if (!effectiveConnectionId) return;
    if (modelsByConnection[effectiveConnectionId]) return;
    void loadModels(effectiveConnectionId, false);
  }, [effectiveConnectionId, loadModels, modelsByConnection]);

  const availableTestModels = useMemo(() => {
    const models = modelsByConnection[effectiveConnectionId] || [];
    if (selectedTaskRequiresVision) {
      return models.filter((model) => model.vision);
    }
    return models;
  }, [effectiveConnectionId, modelsByConnection, selectedTaskRequiresVision]);

  useEffect(() => {
    if (!testModelId) return;
    if (availableTestModels.some((model) => model.id === testModelId)) return;
    setTestModelId('');
  }, [availableTestModels, testModelId]);

  const runQueueTest = async () => {
    const prompt = testPrompt.trim();
    if (!prompt) {
      setError('Bitte Prompt für den Probelauf eingeben.');
      return;
    }
    setTestLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await axios.post(
        '/api/admin/ai-queue/test-run',
        {
          prompt,
          purpose: testPurpose.trim() || 'admin_ai_queue_test_run',
          taskKey: testTaskKey || undefined,
          connectionId: testConnectionId || undefined,
          modelId: testModelId || undefined,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const payload = response.data;
      setTestResult({
        output: String(payload?.output || ''),
        provider: String(payload?.provider || ''),
        connectionId: String(payload?.connectionId || ''),
        model: String(payload?.model || ''),
        taskKey: String(payload?.taskKey || ''),
        timestamp: String(payload?.timestamp || new Date().toISOString()),
      });
      setSuccess('Probelauf erfolgreich abgeschlossen.');
      await fetchQueue({ silent: true });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Probelauf fehlgeschlagen.');
    } finally {
      setTestLoading(false);
    }
  };

  const columns = useMemo<SmartTableColumnDef<AiQueueItem>[]>(
    () => [
      {
        field: 'purpose',
        headerName: 'Zweck',
        minWidth: 180,
        flex: 0.9,
      },
      {
        field: 'prompt',
        headerName: 'Prompt',
        minWidth: 320,
        flex: 1.8,
        renderCell: (params) => (
          <span className="smart-table-multiline-text" title={String(params.row.prompt || '')}>
            {formatPromptPreview(String(params.row.prompt || ''))}
          </span>
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 140,
        renderCell: (params) => (
          <span className={`status-pill status-${params.row.status}`}>{STATUS_LABELS[params.row.status]}</span>
        ),
      },
      {
        field: 'attempts',
        headerName: 'Versuche',
        width: 120,
        renderCell: (params) => (
          <span>
            {params.row.attempts} / {params.row.maxAttempts}
          </span>
        ),
      },
      {
        field: 'providerModel',
        headerName: 'Provider / Modell',
        minWidth: 220,
        flex: 1,
        sortable: false,
        valueGetter: (_value, row) => [row.provider, row.model].filter(Boolean).join(' / ') || '–',
      },
      {
        field: 'createdAt',
        headerName: 'Erstellt',
        minWidth: 165,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'startedAt',
        headerName: 'Gestartet',
        minWidth: 165,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'finishedAt',
        headerName: 'Beendet',
        minWidth: 165,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'lastError',
        headerName: 'Fehler',
        minWidth: 260,
        flex: 1,
        valueGetter: (_value, row) => row.lastError || '–',
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 190,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (params) => {
          const item = params.row;
          const loadingThisRow = !!actionLoading[item.id] || bulkLoading;
          const canCancel = item.status === 'pending' || item.status === 'retry';

          return (
            <SmartTableRowActions>
              <SmartTableRowActionButton
                label="Details anzeigen"
                icon={<InfoOutlinedIcon fontSize="inherit" />}
                onClick={() => {
                  setDetailItem(item);
                }}
                disabled={loadingThisRow}
              />
              <SmartTableRowActionButton
                label="Erneut ausführen"
                icon={<ReplayRoundedIcon fontSize="inherit" />}
                tone="warning"
                onClick={() => {
                  void handleRetry(item.id);
                }}
                disabled={loadingThisRow}
                loading={loadingThisRow}
              />
              <SmartTableRowActionButton
                label="Abbrechen"
                icon={<CancelOutlinedIcon fontSize="inherit" />}
                tone="primary"
                onClick={() => {
                  void handleCancel(item.id);
                }}
                disabled={loadingThisRow || !canCancel}
                loading={loadingThisRow}
              />
              <SmartTableRowActionButton
                label="Eintrag löschen"
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
    <div className="ai-queue-page">
      <AdminPageHero
        title="KI Queue"
        subtitle="Alle KI-Anfragen laufen zentral über die Queue. Status überwachen, eingreifen und Probeläufe starten."
        icon={<i className="fa-solid fa-microchip" />}
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

      <AdminKpiStrip items={summaryKpis} className="ai-queue-summary" />

      <AdminSurfaceCard
        className="ai-queue-test-run"
        title="Probelauf über KI-Queue"
        subtitle="Testet denselben Laufzeitpfad wie Produktion. Optional können Verbindung und Modell pro Lauf überschrieben werden."
      >
        <Stack spacing={1.2}>
          <TextField
            multiline
            minRows={3}
            label="Prompt"
            value={testPrompt}
            onChange={(event) => setTestPrompt(event.target.value)}
            placeholder="Testeingabe für die KI-Queue"
          />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
            <TextField
              select
              label="Aufgabe"
              value={testTaskKey}
              onChange={(event) => setTestTaskKey(event.target.value)}
              sx={{ minWidth: 180 }}
            >
              {(taskMeta.length > 0 ? [...taskMeta] : [{ taskKey: 'default', requiresVision: false }]).map((task) => (
                <MenuItem key={task.taskKey} value={task.taskKey}>
                  {formatLlmTaskLabel(task.taskKey)}
                  {task.requiresVision ? ' (Vision)' : ''}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Purpose"
              value={testPurpose}
              onChange={(event) => setTestPurpose(event.target.value)}
              sx={{ minWidth: 220 }}
            />
            <TextField
              select
              label="Override Verbindung"
              value={testConnectionId}
              onChange={(event) => {
                const next = event.target.value;
                setTestConnectionId(next);
                setTestModelId('');
                if (next) {
                  void loadModels(next, false);
                }
              }}
              sx={{ minWidth: 260 }}
            >
              <MenuItem value="">Route verwenden</MenuItem>
              {connections
                .filter((connection) => connection.enabled !== false)
                .map((connection) => (
                  <MenuItem key={connection.id} value={connection.id}>
                    {connection.name}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              select
              label="Override Modell"
              value={testModelId}
              onChange={(event) => setTestModelId(event.target.value)}
              sx={{ minWidth: 260 }}
              helperText={
                selectedTaskRequiresVision
                  ? 'Nur Vision-Modelle für diese Aufgabe.'
                  : undefined
              }
            >
              <MenuItem value="">Route/Default verwenden</MenuItem>
              {availableTestModels.map((model) => (
                <MenuItem key={model.id} value={model.id}>
                  {model.label || model.id}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="contained" onClick={runQueueTest} disabled={testLoading}>
              {testLoading ? 'Läuft...' : 'Probelauf starten'}
            </Button>
          </Stack>

          {testResult && (
            <div className="queue-detail-block ai-queue-test-result">
              <h4>Ergebnis</h4>
              <div className="queue-detail-meta-grid">
                <div>
                  <span className="label">Provider</span>
                  <span className="value">{testResult.provider || '–'}</span>
                </div>
                <div>
                  <span className="label">Connection</span>
                  <span className="value mono">{testResult.connectionId || '–'}</span>
                </div>
                <div>
                  <span className="label">Modell</span>
                  <span className="value mono">{testResult.model || '–'}</span>
                </div>
                <div>
                  <span className="label">Task</span>
                  <span className="value">{formatLlmTaskLabel(testResult.taskKey || '')}</span>
                </div>
              </div>
              <pre>{formatMultilineValue(testResult.output)}</pre>
            </div>
          )}
        </Stack>
      </AdminSurfaceCard>

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
            <button className="bulk-btn info" type="button" onClick={handleBulkCancel} disabled={bulkLoading}>
              <i className="fa-solid fa-circle-stop" /> Abbrechen
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

      <SmartTable<AiQueueItem>
        tableId="ai-queue"
        userId={token}
        title="Queue-Einträge"
        rows={queueItems}
        columns={columns}
        loading={loading}
        error=""
        checkboxSelection
        selectionModel={selectedIds}
        onSelectionModelChange={(ids) => setSelectedIds(ids)}
        onRowClick={(row) => setDetailItem(row)}
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
            sx={{ minWidth: 170 }}
          >
            {STATUS_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        }
      />

      <p className="ai-queue-total">Gesamt: {queue?.total || 0}</p>

      {detailItem && (
        <div
          className="queue-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Queue-Details"
          onClick={() => setDetailItem(null)}
        >
          <div className="queue-detail-card" onClick={(event) => event.stopPropagation()}>
            <div className="queue-detail-header">
              <h3>KI-Queue Detail</h3>
              <button
                type="button"
                className="queue-detail-close"
                onClick={() => setDetailItem(null)}
                aria-label="Details schließen"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>

            <div className="queue-detail-meta-grid">
              <div>
                <span className="label">ID</span>
                <span className="value mono">{detailItem.id}</span>
              </div>
              <div>
                <span className="label">Status</span>
                <span className={`status-pill status-${detailItem.status}`}>{STATUS_LABELS[detailItem.status]}</span>
              </div>
              <div>
                <span className="label">Zweck</span>
                <span className="value">{detailItem.purpose || 'generic'}</span>
              </div>
              <div>
                <span className="label">Versuche</span>
                <span className="value">
                  {detailItem.attempts} / {detailItem.maxAttempts}
                </span>
              </div>
              <div>
                <span className="label">Provider / Modell</span>
                <span className="value">{[detailItem.provider, detailItem.model].filter(Boolean).join(' / ') || '–'}</span>
              </div>
              <div>
                <span className="label">Erstellt</span>
                <span className="value">{formatDateTime(detailItem.createdAt)}</span>
              </div>
              <div>
                <span className="label">Geplant</span>
                <span className="value">{formatDateTime(detailItem.scheduledAt)}</span>
              </div>
              <div>
                <span className="label">Gestartet</span>
                <span className="value">{formatDateTime(detailItem.startedAt)}</span>
              </div>
              <div>
                <span className="label">Beendet</span>
                <span className="value">{formatDateTime(detailItem.finishedAt)}</span>
              </div>
              <div>
                <span className="label">Aktualisiert</span>
                <span className="value">{formatDateTime(detailItem.updatedAt)}</span>
              </div>
            </div>

            <div className="queue-detail-block">
              <h4>Prompt</h4>
              <pre>{formatMultilineValue(detailItem.prompt)}</pre>
            </div>

            <div className="queue-detail-block">
              <h4>Ergebnis</h4>
              <pre>{formatMultilineValue(detailItem.resultText)}</pre>
            </div>

            <div className="queue-detail-block">
              <h4>Letzter Fehler</h4>
              <pre>{formatMultilineValue(detailItem.lastError)}</pre>
            </div>

            <div className="queue-detail-block">
              <h4>Meta (JSON)</h4>
              <pre>{detailItem.meta ? JSON.stringify(detailItem.meta, null, 2) : '–'}</pre>
            </div>

            <div className="queue-detail-actions">
              <button type="button" className="btn-small btn-secondary" onClick={() => setDetailItem(null)}>
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIQueue;
