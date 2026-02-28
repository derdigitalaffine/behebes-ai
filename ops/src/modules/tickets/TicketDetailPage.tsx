import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import SaveIcon from '@mui/icons-material/Save';
import SyncIcon from '@mui/icons-material/Sync';
import ExploreIcon from '@mui/icons-material/Explore';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import { Link, useParams } from 'react-router-dom';
import { api, buildAuthHeaders } from '../../lib/api';
import type { AdminScopeSelection } from '../../lib/scope';
import LeafletTicketMap from '../../components/LeafletTicketMap';
import {
  clearOfflineMutation,
  enqueueOfflineMutation,
  listOfflineMutations,
  replayOfflineMutations,
} from '../offline/offlineQueue';

interface TicketDetailPageProps {
  token: string;
  scope: AdminScopeSelection;
}

function looksOfflineError(error: any): boolean {
  if (!navigator.onLine) return true;
  return !error?.response;
}

export default function TicketDetailPage({ token, scope }: TicketDetailPageProps) {
  const { ticketId = '' } = useParams();
  const headers = useMemo(() => buildAuthHeaders(token, scope), [scope, token]);
  const [statusValue, setStatusValue] = useState('');
  const [commentText, setCommentText] = useState('');
  const [taskReason, setTaskReason] = useState('');
  const [queueCount, setQueueCount] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadQueueCount = useCallback(async () => {
    const items = await listOfflineMutations();
    setQueueCount(items.length);
  }, []);

  useEffect(() => {
    void loadQueueCount();
  }, [loadQueueCount]);

  useEffect(() => {
    const onOnline = () => {
      void replayOfflineMutations(token, scope).then(() => loadQueueCount());
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [loadQueueCount, scope, token]);

  const ticketQuery = useQuery({
    queryKey: ['ops-ticket', ticketId, scope.mode, scope.tenantId],
    queryFn: async () => {
      const response = await api.get(`/tickets/${encodeURIComponent(ticketId)}`, { headers });
      return response.data;
    },
    enabled: !!ticketId,
    staleTime: 10_000,
  });

  const commentsQuery = useQuery({
    queryKey: ['ops-ticket-comments', ticketId, scope.mode, scope.tenantId],
    queryFn: async () => {
      const response = await api.get(`/tickets/${encodeURIComponent(ticketId)}/comments`, { headers });
      return Array.isArray(response.data?.comments) ? response.data.comments : [];
    },
    enabled: !!ticketId,
    staleTime: 10_000,
  });

  const workflowsQuery = useQuery({
    queryKey: ['ops-workflows-ticket', ticketId],
    queryFn: async () => {
      const response = await api.get('/admin/workflows', { headers });
      const executions = Array.isArray(response.data) ? response.data : [];
      return executions.filter((entry: any) => String(entry?.ticketId || '') === ticketId);
    },
    enabled: !!ticketId,
    staleTime: 20_000,
  });

  const internalTasksQuery = useQuery({
    queryKey: ['ops-internal-tasks-ticket', ticketId, scope.mode, scope.tenantId],
    queryFn: async () => {
      const response = await api.get('/admin/internal-tasks', {
        headers,
        params: { limit: 300, offset: 0 },
      });
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      return items.filter((entry: any) => String(entry?.ticketId || entry?.ticket_id || '') === ticketId);
    },
    enabled: !!ticketId,
    staleTime: 15_000,
  });

  useEffect(() => {
    const current = String(ticketQuery.data?.status || '').trim();
    setStatusValue(current || 'open');
  }, [ticketQuery.data?.status]);

  const workflows = Array.isArray(workflowsQuery.data) ? workflowsQuery.data : [];
  const internalTasks = Array.isArray(internalTasksQuery.data) ? internalTasksQuery.data : [];
  const currentWorkflow = workflows[0] || null;
  const workflowTasks = Array.isArray(currentWorkflow?.tasks) ? currentWorkflow.tasks : [];
  const actionableTasks = workflowTasks.filter((task: any) => {
    const status = String(task?.status || '').toUpperCase();
    return status === 'PENDING' || status === 'RUNNING' || status === 'BLOCKED';
  });

  const runWithOfflineQueue = useCallback(
    async (input: {
      method: 'PATCH' | 'POST' | 'PUT' | 'DELETE';
      url: string;
      body?: Record<string, any>;
      successMessage: string;
      onSuccess?: () => Promise<void> | void;
    }) => {
      setBusy(true);
      setMessage('');
      setError('');
      try {
        await api.request({
          method: input.method,
          url: input.url,
          data: input.body || undefined,
          headers,
        });
        if (input.onSuccess) await input.onSuccess();
        setMessage(input.successMessage);
      } catch (err: any) {
        if (looksOfflineError(err)) {
          await enqueueOfflineMutation({
            method: input.method,
            url: `/api${input.url}`,
            body: input.body || null,
          });
          await loadQueueCount();
          setMessage('Aktion offline vorgemerkt und wird bei Verbindung synchronisiert.');
        } else {
          setError(String(err?.response?.data?.message || err?.message || 'Aktion fehlgeschlagen'));
        }
      } finally {
        setBusy(false);
      }
    },
    [headers, loadQueueCount]
  );

  const handleStatusSave = async () => {
    await runWithOfflineQueue({
      method: 'PATCH',
      url: `/tickets/${encodeURIComponent(ticketId)}`,
      body: { status: statusValue },
      successMessage: 'Status aktualisiert.',
      onSuccess: async () => {
        await ticketQuery.refetch();
      },
    });
  };

  const handleAddComment = async () => {
    const body = commentText.trim();
    if (!body) return;
    await runWithOfflineQueue({
      method: 'POST',
      url: `/tickets/${encodeURIComponent(ticketId)}/comments`,
      body: { comment: body },
      successMessage: 'Kommentar gespeichert.',
      onSuccess: async () => {
        setCommentText('');
        await commentsQuery.refetch();
      },
    });
  };

  const handleWorkflowTaskAction = async (taskId: string, action: 'approve' | 'reject' | 'retry' | 'skip' | 'resume') => {
    if (!currentWorkflow?.id) return;
    await runWithOfflineQueue({
      method: 'POST',
      url: `/admin/workflows/${encodeURIComponent(currentWorkflow.id)}/tasks/${encodeURIComponent(taskId)}/${action}`,
      body: taskReason.trim() ? { reason: taskReason.trim() } : {},
      successMessage: `Workflow-Task ${action} ausgeführt.`,
      onSuccess: async () => {
        await workflowsQuery.refetch();
      },
    });
  };

  const handleInternalTaskAction = async (taskId: string, action: 'start' | 'complete' | 'reject') => {
    await runWithOfflineQueue({
      method: 'POST',
      url: `/admin/internal-tasks/${encodeURIComponent(taskId)}/${action}`,
      body: taskReason.trim() ? { note: taskReason.trim() } : {},
      successMessage: `Interne Aufgabe ${action} ausgeführt.`,
      onSuccess: async () => {
        await internalTasksQuery.refetch();
      },
    });
  };

  const handleQuickGeoRefresh = async () => {
    await runWithOfflineQueue({
      method: 'POST',
      url: `/admin/tickets/${encodeURIComponent(ticketId)}/geo-weather/refresh`,
      successMessage: 'Geo/Wetter-Refresh gestartet.',
    });
  };

  const handleQuickGeocode = async () => {
    await runWithOfflineQueue({
      method: 'POST',
      url: `/admin/tickets/${encodeURIComponent(ticketId)}/geocode`,
      successMessage: 'Geocoding aktualisiert.',
    });
  };

  const handleReplayQueue = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await replayOfflineMutations(token, scope);
      await loadQueueCount();
      await Promise.all([
        ticketQuery.refetch(),
        commentsQuery.refetch(),
        workflowsQuery.refetch(),
        internalTasksQuery.refetch(),
      ]);
      setMessage(`Offline-Queue verarbeitet: ${result.replayed} erfolgreich, ${result.failed} fehlgeschlagen.`);
    } catch (err: any) {
      setError(String(err?.message || 'Queue-Replay fehlgeschlagen'));
    } finally {
      setBusy(false);
    }
  };

  const handleClearFailedQueueItems = async () => {
    const items = await listOfflineMutations();
    for (const item of items) {
      if (item.status === 'failed' && item.id) {
        await clearOfflineMutation(item.id);
      }
    }
    await loadQueueCount();
  };

  if (ticketQuery.isLoading) {
    return (
      <Box sx={{ p: 3, display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (ticketQuery.isError || !ticketQuery.data) {
    return <Alert severity="error">Ticket konnte nicht geladen werden.</Alert>;
  }

  const surfaceSx = {
    borderRadius: 4,
  } as const;

  const ticket = ticketQuery.data;
  const latitude = Number(
    ticket?.latitude ??
      ticket?.lat ??
      ticket?.submissionLatitude ??
      ticket?.submission_latitude ??
      Number.NaN
  );
  const longitude = Number(
    ticket?.longitude ??
      ticket?.lng ??
      ticket?.lon ??
      ticket?.submissionLongitude ??
      ticket?.submission_longitude ??
      Number.NaN
  );
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  const ticketTenantId = String(ticket?.tenantId || ticket?.tenant_id || '').trim();
  if (scope.mode === 'tenant' && scope.tenantId && ticketTenantId && ticketTenantId !== scope.tenantId) {
    return (
      <Alert severity="warning">
        Dieses Ticket gehört zu einem anderen Mandanten ({ticketTenantId}) und ist im aktuellen Kontext nicht verfügbar.
      </Alert>
    );
  }

  return (
    <Stack spacing={2.2} className="ops-page-shell">
      <Card sx={surfaceSx}>
        <CardContent sx={{ p: { xs: 1.8, md: 2.2 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1.2}>
            <Box>
              <Typography variant="h5">Ticket {ticket.id}</Typography>
              <Typography variant="body2" color="text.secondary">
                Detailansicht mit Status, Workflow-Aktionen und Kartenbezug.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button size="small" component={Link} to="/tickets" variant="outlined" startIcon={<ArrowBackIcon />}>
                Zur Liste
              </Button>
              <Chip size="small" label={`Queue: ${queueCount}`} color={queueCount > 0 ? 'warning' : 'default'} />
              <Button size="small" variant="contained" startIcon={<SyncIcon />} onClick={handleReplayQueue} disabled={busy}>
                Sync
              </Button>
              <Button
                size="small"
                variant="outlined"
                component={Link}
                to="/scan"
                startIcon={<QrCodeScannerIcon />}
              >
                QR scannen
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" spacing={1}>
          <Chip size="small" color={statusValue === 'resolved' || statusValue === 'closed' ? 'success' : 'info'} label={statusValue || 'open'} />
          <Chip size="small" label={ticket.priority || 'medium'} />
          <Chip size="small" label={ticket.category || 'Unkategorisiert'} variant="outlined" />
        </Stack>
      </Stack>

      {message ? <Alert severity="success">{message}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Card sx={surfaceSx}>
        <CardContent>
          <Stack spacing={1.2}>
            <Typography variant="body2" color="text.secondary">
              {ticket.category || 'Unkategorisiert'} · {ticket.priority || 'medium'}
            </Typography>
            <Typography variant="body1">{ticket.description || 'Keine Beschreibung vorhanden.'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {ticket.address || 'Ohne Adresse'} {ticket.city ? `· ${ticket.city}` : ''}
            </Typography>
            {hasCoordinates ? (
              <Typography variant="body2" color="text.secondary">
                Koordinaten: {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </Typography>
            ) : null}

            <Divider />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2} alignItems={{ sm: 'center' }}>
              <TextField
                select
                label="Status"
                value={statusValue}
                onChange={(event) => setStatusValue(event.target.value)}
                size="small"
                sx={{ minWidth: 220 }}
              >
                {['open', 'in_progress', 'waiting', 'resolved', 'closed', 'cancelled'].map((status) => (
                  <MenuItem key={status} value={status}>{status}</MenuItem>
                ))}
              </TextField>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={handleStatusSave} disabled={busy}>
                Status speichern
              </Button>
              <Button variant="outlined" startIcon={<ExploreIcon />} onClick={handleQuickGeocode} disabled={busy}>
                Geocode
              </Button>
              <Button variant="outlined" startIcon={<CloudSyncIcon />} onClick={handleQuickGeoRefresh} disabled={busy}>
                Geo/Wetter
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {hasCoordinates ? (
        <Card sx={surfaceSx}>
          <CardContent>
            <Stack spacing={1.2}>
              <Typography variant="h6" fontWeight={700}>Karte</Typography>
              <LeafletTicketMap
                latitude={latitude}
                longitude={longitude}
                title={`Ticket ${ticket.id}`}
              />
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <Card sx={surfaceSx}>
        <CardContent>
          <Stack spacing={1.2}>
            <Typography variant="h6" fontWeight={700}>Kommentare</Typography>
            <TextField
              multiline
              minRows={2}
              placeholder="Kommentar eingeben"
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
            />
            <Button variant="contained" color="secondary" onClick={handleAddComment} disabled={busy}>
              Kommentar senden
            </Button>
            <Divider />
            <Stack spacing={1}>
              {(commentsQuery.data || []).map((comment: any) => (
                <Card key={comment.id} variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ py: 1.1 }}>
                    <Typography variant="body2">{comment.comment || comment.text || ''}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {comment.createdAt || comment.created_at || '–'}
                    </Typography>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card sx={surfaceSx}>
        <CardContent>
          <Stack spacing={1.2}>
            <Typography variant="h6" fontWeight={700}>Workflow Tasks</Typography>
            <TextField
              label="Begründung (optional)"
              value={taskReason}
              onChange={(event) => setTaskReason(event.target.value)}
              size="small"
            />
            {actionableTasks.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Keine aktiven Tasks gefunden.</Typography>
            ) : (
              actionableTasks.map((task: any) => (
                <Card key={task.id} variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent>
                    <Stack spacing={1}>
                      <Typography fontWeight={700}>{task.title || task.id}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {task.type || 'task'} · {task.status || 'PENDING'}
                      </Typography>
                      <Stack direction="row" spacing={0.8} flexWrap="wrap">
                        <Button size="small" variant="contained" color="secondary" onClick={() => void handleWorkflowTaskAction(task.id, 'approve')} disabled={busy}>Approve</Button>
                        <Button size="small" variant="outlined" onClick={() => void handleWorkflowTaskAction(task.id, 'reject')} disabled={busy}>Reject</Button>
                        <Button size="small" variant="outlined" onClick={() => void handleWorkflowTaskAction(task.id, 'retry')} disabled={busy}>Retry</Button>
                        <Button size="small" variant="outlined" onClick={() => void handleWorkflowTaskAction(task.id, 'skip')} disabled={busy}>Skip</Button>
                        <Button size="small" variant="outlined" onClick={() => void handleWorkflowTaskAction(task.id, 'resume')} disabled={busy}>Resume</Button>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card sx={surfaceSx}>
        <CardContent>
          <Stack spacing={1.2}>
            <Typography variant="h6" fontWeight={700}>Interne Aufgaben</Typography>
            {internalTasksQuery.isLoading ? (
              <Typography variant="body2" color="text.secondary">Lade interne Aufgaben...</Typography>
            ) : internalTasks.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Keine internen Aufgaben für dieses Ticket vorhanden.
              </Typography>
            ) : (
              internalTasks.map((task: any, index: number) => {
                const status = String(task?.status || '').toLowerCase();
                const canStart = status === 'pending';
                const canComplete = status === 'in_progress';
                const canReject = status === 'pending' || status === 'in_progress';
                const taskIdValue = String(task?.id || '').trim();
                return (
                  <Card key={taskIdValue || `task-${index}`} variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Stack spacing={1}>
                        <Typography fontWeight={700}>{task?.title || taskIdValue || 'Interne Aufgabe'}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {task?.taskType || task?.type || 'internal_task'} · {status || 'unbekannt'}
                          {task?.dueAt || task?.due_at ? ` · Fällig: ${task?.dueAt || task?.due_at}` : ''}
                        </Typography>
                        {task?.description ? (
                          <Typography variant="body2">{String(task.description)}</Typography>
                        ) : null}
                        <Stack direction="row" spacing={0.8} flexWrap="wrap">
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => void handleInternalTaskAction(taskIdValue, 'start')}
                            disabled={busy || !canStart || !taskIdValue}
                          >
                            Start
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            onClick={() => void handleInternalTaskAction(taskIdValue, 'complete')}
                            disabled={busy || !canComplete || !taskIdValue}
                          >
                            Abschließen
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            onClick={() => void handleInternalTaskAction(taskIdValue, 'reject')}
                            disabled={busy || !canReject || !taskIdValue}
                          >
                            Zurückweisen
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </Stack>
        </CardContent>
      </Card>

      <Stack direction="row" justifyContent="flex-end">
        <Button size="small" onClick={handleClearFailedQueueItems} disabled={busy || queueCount === 0}>
          Fehlgeschlagene Queue-Jobs entfernen
        </Button>
      </Stack>
    </Stack>
  );
}
