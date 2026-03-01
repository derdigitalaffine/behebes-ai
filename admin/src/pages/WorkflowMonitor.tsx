import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Drawer,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import { subscribeAdminRealtime } from '../lib/realtime';
import { useTableSelection } from '../lib/tableSelection';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';

interface WorkflowTask {
  id: string;
  workflowId: string;
  title: string;
  description: string;
  type:
    | 'REDMINE_TICKET'
    | 'EMAIL'
    | 'EMAIL_EXTERNAL'
    | 'CATEGORIZATION'
    | 'EMAIL_CONFIRMATION'
    | 'EMAIL_DOUBLE_OPT_IN'
    | 'MAYOR_INVOLVEMENT'
    | 'CITIZEN_NOTIFICATION'
    | 'REST_API_CALL'
    | 'INTERNAL_PROCESSING'
    | 'DATENNACHFORDERUNG'
    | 'ENHANCED_CATEGORIZATION'
    | 'FREE_AI_DATA_REQUEST'
    | 'IMAGE_TO_TEXT_ANALYSIS'
    | 'END'
    | 'JOIN'
    | 'SPLIT'
    | 'IF'
    | 'CUSTOM'
    | 'WAIT_STATUS_CHANGE'
    | 'CHANGE_WORKFLOW'
    | 'SUB_WORKFLOW'
    | 'RESPONSIBILITY_CHECK';
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  config: Record<string, any>;
  executionData?: Record<string, any>;
  order: number;
  auto?: boolean;
}

interface WorkflowHistoryEntry {
  id: string;
  at: string;
  type:
    | 'WORKFLOW_CREATED'
    | 'WORKFLOW_STATUS'
    | 'WORKFLOW_COMPLETED'
    | 'WORKFLOW_FAILED'
    | 'TASK_STATUS'
    | 'TASK_WAITING'
    | 'TASK_DECISION'
    | 'TASK_DATA'
    | 'INFO';
  message: string;
  taskId?: string;
  taskTitle?: string;
  taskType?: WorkflowTask['type'];
  fromStatus?: string;
  toStatus?: string;
  metadata?: Record<string, any>;
}

interface WorkflowExecution {
  id: string;
  submissionId: string;
  ticketId: string;
  templateId?: string;
  title: string;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  blockedReason?:
    | 'none'
    | 'waiting_external'
    | 'waiting_manual'
    | 'waiting_timer'
    | 'deadlock_or_orphan_path'
    | 'loop_guard'
    | 'error';
  health?: {
    slaState: 'ok' | 'risk' | 'overdue';
    transitionCount: number;
    loopGuardTrips: number;
    visitsByTask: Record<string, number>;
    slaTargetMinutes: number;
    slaRiskThresholdPercent: number;
  };
  executionMode: 'MANUAL' | 'AUTO' | 'HYBRID';
  tasks: WorkflowTask[];
  currentTaskIndex: number;
  activeTaskIds?: string[];
  category: string;
  address?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  history?: WorkflowHistoryEntry[];
}

const STATUS_LABELS: Record<WorkflowExecution['status'], string> = {
  RUNNING: 'Läuft',
  PAUSED: 'Pausiert',
  COMPLETED: 'Abgeschlossen',
  FAILED: 'Fehler',
};

const MODE_LABELS: Record<WorkflowExecution['executionMode'], string> = {
  MANUAL: 'Manuell',
  AUTO: 'Auto',
  HYBRID: 'Hybrid',
};

const BLOCKED_REASON_LABELS: Record<string, string> = {
  none: 'Kein Blocker',
  waiting_external: 'Externes Warten',
  waiting_manual: 'Manuelle Freigabe',
  waiting_timer: 'Timer',
  deadlock_or_orphan_path: 'Deadlock/Orphan',
  loop_guard: 'Loop-Guard',
  error: 'Fehler',
};

const SLA_LABELS: Record<'ok' | 'risk' | 'overdue', string> = {
  ok: 'im Ziel',
  risk: 'gefährdet',
  overdue: 'überfällig',
};

const statusChipColor = (status: WorkflowExecution['status']): 'info' | 'warning' | 'success' | 'error' => {
  if (status === 'RUNNING') return 'info';
  if (status === 'PAUSED') return 'warning';
  if (status === 'COMPLETED') return 'success';
  return 'error';
};

const modeChipColor = (mode: WorkflowExecution['executionMode']): 'info' | 'success' | 'warning' => {
  if (mode === 'MANUAL') return 'info';
  if (mode === 'AUTO') return 'success';
  return 'warning';
};

const slaChipColor = (state: 'ok' | 'risk' | 'overdue'): 'success' | 'warning' | 'error' => {
  if (state === 'risk') return 'warning';
  if (state === 'overdue') return 'error';
  return 'success';
};

const taskStatusChipColor = (status: WorkflowTask['status']): 'default' | 'info' | 'warning' | 'success' | 'error' => {
  if (status === 'RUNNING') return 'info';
  if (status === 'PENDING') return 'warning';
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED') return 'error';
  return 'default';
};

const codeSx = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '0.78rem',
  px: 0.6,
  py: 0.15,
  borderRadius: '6px',
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: 'background.paper',
};

const WorkflowMonitor: React.FC<{ token: string }> = ({ token }) => {
  const [workflows, setWorkflows] = useState<WorkflowExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'manual' | 'paused' | 'completed'>('all');
  const [approvalLoading, setApprovalLoading] = useState<Record<string, boolean>>({});
  const [recoveryLoading, setRecoveryLoading] = useState<Record<string, boolean>>({});
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | WorkflowExecution['status']>('all');
  const [modeFilter, setModeFilter] = useState<'all' | WorkflowExecution['executionMode']>('all');
  const [blockedFilter, setBlockedFilter] = useState<'all' | 'blocked' | 'none'>('all');
  const [slaFilter, setSlaFilter] = useState<'all' | 'ok' | 'risk' | 'overdue'>('all');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowExecution | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const fetchWorkflows = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) {
        setLoading(true);
      }
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.get('/api/admin/workflows', { headers });
      setWorkflows(Array.isArray(response.data) ? response.data : []);
      setError('');
    } catch (err: any) {
      setWorkflows([]);
      setError(err.response?.data?.message || 'Fehler beim Laden der Workflow-Instanzen');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [token]);

  const refreshSelectedWorkflow = useCallback(
    async (workflowId: string) => {
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const detailRes = await axios.get(`/api/admin/workflows/${workflowId}`, { headers });
        setSelectedWorkflow(detailRes.data || null);
      } catch {
        setSelectedWorkflow(null);
      }
    },
    [token]
  );

  useEffect(() => {
    void fetchWorkflows();

    let queuedRefresh = false;
    const requestSilentRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (queuedRefresh) return;
      queuedRefresh = true;
      window.setTimeout(() => {
        queuedRefresh = false;
        void fetchWorkflows({ silent: true });
        if (selectedWorkflowId) {
          void refreshSelectedWorkflow(selectedWorkflowId);
        }
      }, 180);
    };

    const unsubscribe = subscribeAdminRealtime({
      token,
      topics: ['workflows', 'tickets'],
      onUpdate: requestSilentRefresh,
      onError: () => {
        // Fallback polling continues below.
      },
    });

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchWorkflows({ silent: true });
        if (selectedWorkflowId) {
          void refreshSelectedWorkflow(selectedWorkflowId);
        }
      }
    }, 30000);

    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [fetchWorkflows, refreshSelectedWorkflow, selectedWorkflowId, token]);

  const handleApproveTask = async (workflowId: string, taskId: string) => {
    setApprovalLoading((prev) => ({ ...prev, [taskId]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.post(`/api/admin/workflows/${workflowId}/tasks/${taskId}/approve`, {}, { headers });
      setSuccessMessage('Task freigegeben');
      setTimeout(() => setSuccessMessage(''), 3000);
      await fetchWorkflows();
      if (selectedWorkflowId === workflowId) {
        await refreshSelectedWorkflow(workflowId);
      }
    } catch {
      setError('Fehler beim Freigeben der Task');
    } finally {
      setApprovalLoading((prev) => ({ ...prev, [taskId]: false }));
    }
  };

  const handleRejectTask = async (workflowId: string, taskId: string) => {
    if (!window.confirm('Task wirklich ablehnen?')) return;
    setApprovalLoading((prev) => ({ ...prev, [taskId]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.post(`/api/admin/workflows/${workflowId}/tasks/${taskId}/reject`, {}, { headers });
      setSuccessMessage('Task abgelehnt');
      setTimeout(() => setSuccessMessage(''), 3000);
      await fetchWorkflows();
      if (selectedWorkflowId === workflowId) {
        await refreshSelectedWorkflow(workflowId);
      }
    } catch {
      setError('Fehler beim Ablehnen der Task');
    } finally {
      setApprovalLoading((prev) => ({ ...prev, [taskId]: false }));
    }
  };

  const handleRecoveryAction = async (
    workflowId: string,
    taskId: string,
    action: 'retry' | 'skip' | 'resume'
  ) => {
    let reason = '';
    if (action === 'skip' || action === 'resume') {
      reason = window.prompt(
        action === 'skip'
          ? 'Grund für das Überspringen eingeben:'
          : 'Grund für manuelles Fortsetzen eingeben:'
      )?.trim() || '';
      if (!reason) return;
    } else {
      reason = window.prompt('Optionaler Grund für Retry:')?.trim() || '';
    }

    const loadingKey = `${workflowId}:${taskId}:${action}`;
    setRecoveryLoading((prev) => ({ ...prev, [loadingKey]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.post(
        `/api/admin/workflows/${workflowId}/tasks/${taskId}/${action}`,
        reason ? { reason } : {},
        { headers }
      );
      setSuccessMessage(
        action === 'retry'
          ? 'Retry gestartet'
          : action === 'skip'
          ? 'Schritt übersprungen'
          : 'Schritt manuell fortgesetzt'
      );
      setTimeout(() => setSuccessMessage(''), 3000);
      await fetchWorkflows({ silent: true });
      if (selectedWorkflowId === workflowId) {
        await refreshSelectedWorkflow(workflowId);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Recovery-Aktion fehlgeschlagen');
    } finally {
      setRecoveryLoading((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handleDeleteWorkflow = async (workflowId: string) => {
    if (!window.confirm('Workflow-Instanz wirklich löschen?')) return;
    setDeleteLoading((prev) => ({ ...prev, [workflowId]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.delete(`/api/admin/workflows/${workflowId}`, { headers });
      setSuccessMessage('Workflow-Instanz gelöscht');
      setTimeout(() => setSuccessMessage(''), 3000);
      setWorkflows((prev) => prev.filter((workflow) => workflow.id !== workflowId));
      if (selectedWorkflowId === workflowId) {
        setSelectedWorkflowId(null);
        setSelectedWorkflow(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Fehler beim Löschen der Workflow-Instanz');
    } finally {
      setDeleteLoading((prev) => ({ ...prev, [workflowId]: false }));
    }
  };

  const handleOpenWorkflowDetails = async (workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    setDetailsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.get(`/api/admin/workflows/${workflowId}`, { headers });
      setSelectedWorkflow(response.data || null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Fehler beim Laden der Workflow-Details');
      setSelectedWorkflow(null);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleCloseWorkflowDetails = () => {
    setSelectedWorkflowId(null);
    setSelectedWorkflow(null);
    setDetailsLoading(false);
  };

  const getActiveTasks = (workflow: WorkflowExecution): WorkflowTask[] => {
    const activeIds = new Set(Array.isArray(workflow.activeTaskIds) ? workflow.activeTaskIds : []);
    if (activeIds.size === 0) {
      const fallback = workflow.tasks[workflow.currentTaskIndex];
      return fallback ? [fallback] : [];
    }
    return workflow.tasks
      .filter((task) => activeIds.has(task.id))
      .sort((a, b) => a.order - b.order);
  };

  const getPendingTasks = (workflow: WorkflowExecution) =>
    getActiveTasks(workflow).filter((task) => task.status === 'PENDING' && !task.auto);

  const getFailedTasks = (workflow: WorkflowExecution) =>
    workflow.tasks.filter((task) => task.status === 'FAILED');

  const getWorkflowSlaState = (workflow: WorkflowExecution): 'ok' | 'risk' | 'overdue' =>
    workflow.health?.slaState || 'ok';

  const currentTask = (workflow: WorkflowExecution) =>
    getActiveTasks(workflow).find((task) => task.status === 'RUNNING' || task.status === 'PENDING') ||
    workflow.tasks.find((task) => task.status === 'RUNNING' || task.status === 'PENDING') ||
    workflow.tasks[0];

  const formatDate = (dateString?: string) => {
    if (!dateString) return '–';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '–';
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((workflow) => {
      if (activeFilter === 'manual' && getPendingTasks(workflow).length === 0) return false;
      if (activeFilter === 'paused' && workflow.status !== 'PAUSED') return false;
      if (activeFilter === 'completed' && workflow.status !== 'COMPLETED') return false;
      if (statusFilter !== 'all' && workflow.status !== statusFilter) return false;
      if (modeFilter !== 'all' && workflow.executionMode !== modeFilter) return false;
      if (blockedFilter === 'blocked' && (workflow.blockedReason || 'none') === 'none') return false;
      if (blockedFilter === 'none' && (workflow.blockedReason || 'none') !== 'none') return false;
      const slaState = getWorkflowSlaState(workflow);
      if (slaFilter !== 'all' && slaState !== slaFilter) return false;
      return true;
    });
  }, [workflows, activeFilter, statusFilter, modeFilter, blockedFilter, slaFilter]);

  const sortedWorkflows = useMemo(() => {
    const severityScore = (workflow: WorkflowExecution) => {
      const slaState = getWorkflowSlaState(workflow);
      const slaScore = slaState === 'overdue' ? 3 : slaState === 'risk' ? 2 : 1;
      const blockedScore = (workflow.blockedReason || 'none') !== 'none' ? 1 : 0;
      return slaScore + blockedScore;
    };

    return [...filteredWorkflows].sort((a, b) => {
      if (severityScore(a) !== severityScore(b)) {
        return severityScore(b) - severityScore(a);
      }
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });
  }, [filteredWorkflows]);

  const totalWorkflows = workflows.length;
  const selection = useTableSelection(sortedWorkflows);
  const manualPending = workflows.filter(
    (w) => w.status === 'PAUSED' && getPendingTasks(w).length > 0
  ).length;
  const completed = workflows.filter((w) => w.status === 'COMPLETED').length;
  const failed = workflows.filter((w) => w.status === 'FAILED').length;
  const blockedCount = workflows.filter((w) => (w.blockedReason || 'none') !== 'none').length;
  const overdueCount = workflows.filter((w) => getWorkflowSlaState(w) === 'overdue').length;
  const manualControlQueue = useMemo(
    () =>
      [...workflows]
        .filter((workflow) => workflow.status === 'PAUSED' && getPendingTasks(workflow).length > 0)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [workflows]
  );

  const taskTypeLabel = (type: WorkflowTask['type']) => {
    switch (type) {
      case 'REDMINE_TICKET':
        return 'Redmine-Ticket';
      case 'EMAIL':
      case 'EMAIL_EXTERNAL':
        return 'E-Mail';
      case 'EMAIL_CONFIRMATION':
        return 'E-Mail-Freigabe';
      case 'CATEGORIZATION':
        return 'Kategorisierung';
      case 'EMAIL_DOUBLE_OPT_IN':
        return 'E-Mail Double Opt-In';
      case 'MAYOR_INVOLVEMENT':
        return 'Ortsbürgermeister involvieren';
      case 'CITIZEN_NOTIFICATION':
        return 'Bürgerbenachrichtigung';
      case 'REST_API_CALL':
        return 'RESTful API Call';
      case 'INTERNAL_PROCESSING':
        return 'Interne Bearbeitung';
      case 'DATENNACHFORDERUNG':
        return 'Datennachforderung';
      case 'ENHANCED_CATEGORIZATION':
        return 'KI-Basierte Datennachforderung';
      case 'FREE_AI_DATA_REQUEST':
        return 'Freie KI-Datennachforderung';
      case 'IMAGE_TO_TEXT_ANALYSIS':
        return 'Bilder zu Text auswerten';
      case 'END':
        return 'Workflow-/Teilworkflow-Ende';
      case 'JOIN':
        return 'Join-Knoten';
      case 'SPLIT':
        return 'Split-Knoten';
      case 'IF':
        return 'IF-Bedingung';
      case 'WAIT_STATUS_CHANGE':
        return 'Warte/Statuswechsel';
      case 'CHANGE_WORKFLOW':
        return 'Workflow-Wechsel';
      case 'SUB_WORKFLOW':
        return 'Teilworkflow starten';
      case 'RESPONSIBILITY_CHECK':
        return 'Verwaltungs-Zuständigkeitsprüfung';
      default:
        return type;
    }
  };

  const getApprovableTask = (workflow: WorkflowExecution): WorkflowTask | null => {
    if (workflow.status !== 'PAUSED') return null;
    const pendingTasks = getPendingTasks(workflow);
    if (pendingTasks.length === 0) return null;
    return pendingTasks[0];
  };

  const workflowColumns = useMemo<SmartTableColumnDef<WorkflowExecution>[]>(
    () => [
      {
        field: 'title',
        headerName: 'Workflow',
        minWidth: 240,
        flex: 1,
        renderCell: (params) => (
          <Stack spacing={0.3}>
            <Typography variant="body2" fontWeight={700}>{params.row.title || 'Workflow'}</Typography>
            <Typography component="code" sx={codeSx}>ID {params.row.id.slice(0, 8)}</Typography>
          </Stack>
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 140,
        renderCell: (params) => (
          <Chip
            size="small"
            color={statusChipColor(params.row.status)}
            label={STATUS_LABELS[params.row.status]}
          />
        ),
      },
      {
        field: 'slaState',
        headerName: 'SLA',
        minWidth: 130,
        valueGetter: (_value, row) => getWorkflowSlaState(row),
        renderCell: (params) => {
          const slaState = getWorkflowSlaState(params.row);
          return <Chip size="small" color={slaChipColor(slaState)} label={SLA_LABELS[slaState]} />;
        },
      },
      {
        field: 'blockedReason',
        headerName: 'Blocker',
        minWidth: 190,
        renderCell: (params) => (
          <Chip
            size="small"
            variant="outlined"
            label={BLOCKED_REASON_LABELS[params.row.blockedReason || 'none'] || params.row.blockedReason || 'Kein Blocker'}
          />
        ),
      },
      {
        field: 'executionMode',
        headerName: 'Modus',
        minWidth: 130,
        renderCell: (params) => (
          <Chip
            size="small"
            color={modeChipColor(params.row.executionMode)}
            variant="outlined"
            label={MODE_LABELS[params.row.executionMode]}
          />
        ),
      },
      {
        field: 'category',
        headerName: 'Kategorie',
        minWidth: 190,
        flex: 1,
        valueGetter: (_value, row) => row.category || '–',
      },
      {
        field: 'currentTask',
        headerName: 'Aktuelle Task',
        minWidth: 220,
        flex: 1,
        valueGetter: (_value, row) => currentTask(row)?.title || '–',
      },
      {
        field: 'pendingManualCount',
        headerName: 'Freigaben',
        minWidth: 120,
        valueGetter: (_value, row) => getPendingTasks(row).length,
      },
      {
        field: 'startedAt',
        headerName: 'Start',
        minWidth: 140,
        valueFormatter: (value) => formatDate(String(value || '')),
      },
      {
        field: 'ticketId',
        headerName: 'Ticket',
        minWidth: 140,
        renderCell: (params) =>
          params.row.ticketId ? (
            <Typography component={Link} to={`/tickets/${params.row.ticketId}`} sx={{ ...codeSx, textDecoration: 'none' }}>
              {params.row.ticketId.slice(0, 8)}
            </Typography>
          ) : (
            '–'
          ),
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 170,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        hideable: false,
        renderCell: (params) => {
          const workflow = params.row;
          const approvableTask = getApprovableTask(workflow);
          const failedTask = getFailedTasks(workflow)[0] || null;
          return (
            <SmartTableRowActions>
              <SmartTableRowActionButton
                label="Details"
                icon={<OpenInNewRoundedIcon fontSize="inherit" />}
                tone="primary"
                onClick={() => {
                  void handleOpenWorkflowDetails(workflow.id);
                }}
              />
              {approvableTask ? (
                <>
                  <SmartTableRowActionButton
                    label="Freigeben"
                    icon={<CheckRoundedIcon fontSize="inherit" />}
                    tone="success"
                    loading={approvalLoading[approvableTask.id] || bulkLoading}
                    onClick={() => {
                      void handleApproveTask(workflow.id, approvableTask.id);
                    }}
                  />
                  <SmartTableRowActionButton
                    label="Ablehnen"
                    icon={<CloseRoundedIcon fontSize="inherit" />}
                    tone="danger"
                    loading={approvalLoading[approvableTask.id] || bulkLoading}
                    onClick={() => {
                      void handleRejectTask(workflow.id, approvableTask.id);
                    }}
                  />
                </>
              ) : null}
              {failedTask ? (
                <>
                  <SmartTableRowActionButton
                    label="Retry"
                    icon={<ReplayRoundedIcon fontSize="inherit" />}
                    tone="warning"
                    loading={recoveryLoading[`${workflow.id}:${failedTask.id}:retry`] || bulkLoading}
                    onClick={() => {
                      void handleRecoveryAction(workflow.id, failedTask.id, 'retry');
                    }}
                  />
                  <SmartTableRowActionButton
                    label="Skip"
                    icon={<SkipNextRoundedIcon fontSize="inherit" />}
                    tone="warning"
                    loading={recoveryLoading[`${workflow.id}:${failedTask.id}:skip`] || bulkLoading}
                    onClick={() => {
                      void handleRecoveryAction(workflow.id, failedTask.id, 'skip');
                    }}
                  />
                  <SmartTableRowActionButton
                    label="Fortsetzen"
                    icon={<PlayArrowRoundedIcon fontSize="inherit" />}
                    tone="default"
                    loading={recoveryLoading[`${workflow.id}:${failedTask.id}:resume`] || bulkLoading}
                    onClick={() => {
                      void handleRecoveryAction(workflow.id, failedTask.id, 'resume');
                    }}
                  />
                </>
              ) : null}
              <SmartTableRowActionButton
                label="Löschen"
                icon={<DeleteOutlineRoundedIcon fontSize="inherit" />}
                tone="danger"
                loading={deleteLoading[workflow.id] || bulkLoading}
                onClick={() => {
                  void handleDeleteWorkflow(workflow.id);
                }}
              />
            </SmartTableRowActions>
          );
        },
      },
    ],
    [approvalLoading, bulkLoading, deleteLoading, recoveryLoading]
  );

  const handleBulkDeleteWorkflows = async () => {
    if (selection.selectedRows.length === 0) {
      setError('Keine Workflow-Instanzen ausgewählt.');
      return;
    }
    if (!window.confirm(`${selection.selectedRows.length} Workflow-Instanz(en) wirklich löschen?`)) {
      return;
    }
    setBulkLoading(true);
    setError('');
    setSuccessMessage('');
    const ids = selection.selectedRows.map((workflow) => workflow.id);
    setDeleteLoading((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = true;
      });
      return next;
    });
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const results = await Promise.allSettled(
        ids.map((id) => axios.delete(`/api/admin/workflows/${id}`, { headers }).then(() => id))
      );
      const deletedIds = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map((result) => result.value);
      const failedCount = results.length - deletedIds.length;
      if (deletedIds.length > 0) {
        setWorkflows((prev) => prev.filter((workflow) => !deletedIds.includes(workflow.id)));
      }
      if (selectedWorkflowId && deletedIds.includes(selectedWorkflowId)) {
        setSelectedWorkflowId(null);
        setSelectedWorkflow(null);
      }
      if (failedCount > 0) {
        setError(`${deletedIds.length} gelöscht, ${failedCount} fehlgeschlagen.`);
      } else {
        setSuccessMessage(`${deletedIds.length} Workflow-Instanz(en) gelöscht.`);
      }
      selection.clearSelection();
    } catch {
      setError('Fehler beim Löschen der ausgewählten Workflow-Instanzen');
    } finally {
      setDeleteLoading((prev) => {
        const next = { ...prev };
        ids.forEach((id) => {
          next[id] = false;
        });
        return next;
      });
      setBulkLoading(false);
    }
  };

  const handleBulkApproveTasks = async () => {
    const candidates = selection.selectedRows
      .map((workflow) => {
        const task = getApprovableTask(workflow);
        if (!task) return null;
        return { workflowId: workflow.id, taskId: task.id };
      })
      .filter((value): value is { workflowId: string; taskId: string } => value !== null);

    if (candidates.length === 0) {
      setError('Keine freigabefähigen Tasks in der Auswahl.');
      return;
    }

    setBulkLoading(true);
    setError('');
    setSuccessMessage('');
    setApprovalLoading((prev) => {
      const next = { ...prev };
      candidates.forEach((candidate) => {
        next[candidate.taskId] = true;
      });
      return next;
    });
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const results = await Promise.allSettled(
        candidates.map((candidate) =>
          axios.post(`/api/admin/workflows/${candidate.workflowId}/tasks/${candidate.taskId}/approve`, {}, { headers })
        )
      );
      const failedCount = results.filter((result) => result.status === 'rejected').length;
      const okCount = results.length - failedCount;
      if (failedCount > 0) {
        setError(`${okCount} Task(s) freigegeben, ${failedCount} fehlgeschlagen.`);
      } else {
        setSuccessMessage(`${okCount} Task(s) freigegeben.`);
      }
      await fetchWorkflows();
      selection.clearSelection();
    } catch {
      setError('Fehler beim Freigeben der ausgewählten Tasks');
    } finally {
      setApprovalLoading((prev) => {
        const next = { ...prev };
        candidates.forEach((candidate) => {
          next[candidate.taskId] = false;
        });
        return next;
      });
      setBulkLoading(false);
    }
  };

  const summaryKpis = useMemo(
    () => [
      { id: 'total', label: 'Instanzen gesamt', value: totalWorkflows, tone: 'info' as const },
      { id: 'manual', label: 'Warten auf Freigabe', value: manualPending, tone: 'warning' as const },
      { id: 'completed', label: 'Abgeschlossen', value: completed, tone: 'success' as const },
      { id: 'failed', label: 'Fehler', value: failed, tone: 'danger' as const },
      { id: 'blocked', label: 'Mit Blocker', value: blockedCount, tone: 'warning' as const },
      { id: 'overdue', label: 'SLA überfällig', value: overdueCount, tone: 'danger' as const },
    ],
    [totalWorkflows, manualPending, completed, failed, blockedCount, overdueCount]
  );

  const filterTabValue = activeFilter;

  if (loading) {
    return (
      <Box sx={{ py: 7, textAlign: 'center' }}>
        <Typography color="text.secondary">Workflow-Instanzen werden geladen...</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      <AdminPageHero
        title="Workflow-Instanzen"
        subtitle="Laufende Prozesse pro Ticket überwachen, manuelle Freigaben ausführen und Recovery-Aktionen steuern."
        icon={<AccountTreeRoundedIcon />}
        badges={[
          {
            id: 'total',
            label: `Instanzen: ${totalWorkflows}`,
            tone: 'info',
          },
          {
            id: 'manual',
            label: `Freigaben offen: ${manualPending}`,
            tone: manualPending > 0 ? 'warning' : 'success',
          },
        ]}
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              component={Link}
              to="/admin-settings/workflow"
              variant="outlined"
              startIcon={<SettingsSuggestRoundedIcon />}
            >
              Workflow-Definitionen
            </Button>
            <Button
              variant="contained"
              startIcon={<RefreshRoundedIcon />}
              onClick={() => {
                void fetchWorkflows();
              }}
            >
              Aktualisieren
            </Button>
          </Stack>
        }
      />

      {error ? <Alert severity="error" onClose={() => setError('')}>{error}</Alert> : null}
      {successMessage ? (
        <Alert severity="success" onClose={() => setSuccessMessage('')}>
          {successMessage}
        </Alert>
      ) : null}

      <AdminKpiStrip items={summaryKpis} />

      <AdminSurfaceCard
        title="Ansicht und Filter"
        subtitle="Schnelle Segmentierung nach Zustand, Modus, SLA und Blockerstatus."
      >
        <Stack spacing={1.1}>
          <Tabs
            value={filterTabValue}
            onChange={(_event, value) => setActiveFilter(value)}
            variant="scrollable"
            allowScrollButtonsMobile
          >
            <Tab value="all" label={`Alle (${totalWorkflows})`} />
            <Tab value="manual" label={`Warten auf Freigabe (${manualPending})`} />
            <Tab value="paused" label="Pausiert" />
            <Tab value="completed" label={`Abgeschlossen (${completed})`} />
          </Tabs>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
            <TextField
              select
              size="small"
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="all">Alle</MenuItem>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <MenuItem key={key} value={key}>{label}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Modus"
              value={modeFilter}
              onChange={(event) => setModeFilter(event.target.value as typeof modeFilter)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="all">Alle</MenuItem>
              {Object.entries(MODE_LABELS).map(([key, label]) => (
                <MenuItem key={key} value={key}>{label}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="SLA"
              value={slaFilter}
              onChange={(event) => setSlaFilter(event.target.value as typeof slaFilter)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="all">Alle</MenuItem>
              <MenuItem value="ok">{SLA_LABELS.ok}</MenuItem>
              <MenuItem value="risk">{SLA_LABELS.risk}</MenuItem>
              <MenuItem value="overdue">{SLA_LABELS.overdue}</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Blocker"
              value={blockedFilter}
              onChange={(event) => setBlockedFilter(event.target.value as typeof blockedFilter)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="all">Alle</MenuItem>
              <MenuItem value="blocked">Nur mit Blocker</MenuItem>
              <MenuItem value="none">Nur ohne Blocker</MenuItem>
            </TextField>
          </Stack>
        </Stack>
      </AdminSurfaceCard>

      <AdminSurfaceCard
        title="Manuelle Workflow-Steuerung"
        subtitle="Pausierte Instanzen mit offenen manuellen Freigaben."
        actions={
          <Chip
            size="small"
            color={manualControlQueue.length > 0 ? 'warning' : 'success'}
            label={`${manualControlQueue.length} Instanzen`}
          />
        }
      >
        {manualControlQueue.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Derzeit gibt es keine pausierten Workflows mit offenen manuellen Tasks.
          </Typography>
        ) : (
          <Stack spacing={0.9}>
            {manualControlQueue.map((workflow) => {
              const pendingTasks = getPendingTasks(workflow);
              const nextManualTask = pendingTasks[0];
              if (!nextManualTask) return null;
              const isTaskLoading = !!approvalLoading[nextManualTask.id] || bulkLoading;
              return (
                <Card key={workflow.id} variant="outlined">
                  <CardContent sx={{ '&:last-child': { pb: 1.5 } }}>
                    <Stack spacing={0.9}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                        <Box>
                          <Typography variant="body2" fontWeight={700}>{workflow.title}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Nächste manuelle Task: <strong>{nextManualTask.title}</strong> ({taskTypeLabel(nextManualTask.type)})
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                          <Chip size="small" color={statusChipColor(workflow.status)} label={STATUS_LABELS[workflow.status]} />
                          <Chip size="small" variant="outlined" label={`${pendingTasks.length} offen`} />
                          <Chip size="small" variant="outlined" label={`Ticket ${workflow.ticketId.slice(0, 8)}`} />
                        </Stack>
                      </Stack>

                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<OpenInNewRoundedIcon />}
                          onClick={() => {
                            void handleOpenWorkflowDetails(workflow.id);
                          }}
                        >
                          Details
                        </Button>
                        <Button
                          size="small"
                          color="success"
                          variant="contained"
                          startIcon={<CheckRoundedIcon />}
                          onClick={() => {
                            void handleApproveTask(workflow.id, nextManualTask.id);
                          }}
                          disabled={isTaskLoading}
                        >
                          Freigeben
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          startIcon={<CloseRoundedIcon />}
                          onClick={() => {
                            void handleRejectTask(workflow.id, nextManualTask.id);
                          }}
                          disabled={isTaskLoading}
                        >
                          Ablehnen
                        </Button>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}
      </AdminSurfaceCard>

      <AdminSurfaceCard
        title="Workflow-Instanzen"
        subtitle="SmartTable-Ansicht mit persistenter Spaltenkonfiguration, Suche und A4-Export."
      >
        {selection.selectedCount > 0 ? (
          <Alert
            severity="warning"
            sx={{ mb: 1 }}
            action={
              <Stack direction="row" spacing={0.8}>
                <Button size="small" color="success" onClick={() => void handleBulkApproveTasks()} disabled={bulkLoading}>
                  Freigaben
                </Button>
                <Button size="small" color="error" onClick={() => void handleBulkDeleteWorkflows()} disabled={bulkLoading}>
                  Löschen
                </Button>
                <Button size="small" onClick={() => selection.clearSelection()} disabled={bulkLoading}>
                  Aufheben
                </Button>
              </Stack>
            }
          >
            {selection.selectedCount} Workflow-Instanz(en) ausgewählt
          </Alert>
        ) : null}

        {sortedWorkflows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Workflow-Instanzen gefunden.
          </Typography>
        ) : (
          <SmartTable<WorkflowExecution>
            tableId="workflow-monitor-instances"
            userId={token}
            title="Workflow-Instanzen"
            rows={sortedWorkflows}
            columns={workflowColumns}
            loading={loading}
            checkboxSelection
            selectionModel={selection.selectedIds}
            onSelectionModelChange={(ids) => selection.setSelectedIds(ids)}
            onRowClick={(row) => {
              void handleOpenWorkflowDetails(row.id);
            }}
            onRefresh={() => {
              void fetchWorkflows();
            }}
            liveState="live"
            defaultPageSize={25}
            pageSizeOptions={[10, 25, 50, 100]}
            disableRowSelectionOnClick
          />
        )}
      </AdminSurfaceCard>

      <Drawer
        anchor="right"
        open={Boolean(selectedWorkflowId)}
        onClose={handleCloseWorkflowDetails}
        PaperProps={{
          sx: {
            width: { xs: '100%', md: 760 },
            maxWidth: '100%',
          },
        }}
      >
        <Box sx={{ p: 2, height: '100%', overflowY: 'auto' }}>
          <Stack spacing={1.3}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">Workflow-Instanz Details</Typography>
              <IconButton size="small" onClick={handleCloseWorkflowDetails}>
                <CloseRoundedIcon />
              </IconButton>
            </Stack>

            {detailsLoading ? (
              <Typography color="text.secondary">Details werden geladen…</Typography>
            ) : !selectedWorkflow ? (
              <Typography color="text.secondary">Keine Daten verfügbar.</Typography>
            ) : (
              <>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 0.9,
                  }}
                >
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Workflow-ID</Typography><Typography component="code" sx={codeSx}>{selectedWorkflow.id}</Typography></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Workflow-Definition</Typography><Typography variant="body2">{selectedWorkflow.templateId || '–'}</Typography></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Status</Typography><Box sx={{ mt: 0.5 }}><Chip size="small" color={statusChipColor(selectedWorkflow.status)} label={STATUS_LABELS[selectedWorkflow.status]} /></Box></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">SLA</Typography><Box sx={{ mt: 0.5 }}><Chip size="small" color={slaChipColor(getWorkflowSlaState(selectedWorkflow))} label={SLA_LABELS[getWorkflowSlaState(selectedWorkflow)]} /></Box></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Blocker</Typography><Typography variant="body2">{BLOCKED_REASON_LABELS[selectedWorkflow.blockedReason || 'none'] || selectedWorkflow.blockedReason || 'Kein Blocker'}</Typography></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Modus</Typography><Box sx={{ mt: 0.5 }}><Chip size="small" color={modeChipColor(selectedWorkflow.executionMode)} variant="outlined" label={MODE_LABELS[selectedWorkflow.executionMode]} /></Box></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Ticket</Typography><Typography variant="body2">{selectedWorkflow.ticketId || '–'}</Typography></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Meldung</Typography><Typography variant="body2">{selectedWorkflow.submissionId || '–'}</Typography></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Kategorie</Typography><Typography variant="body2">{selectedWorkflow.category || '–'}</Typography></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Aktueller Schritt</Typography><Typography variant="body2">{selectedWorkflow.tasks.length > 0 ? `${Math.min(selectedWorkflow.currentTaskIndex + 1, selectedWorkflow.tasks.length)}/${selectedWorkflow.tasks.length}` : '–'}</Typography></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Gestartet</Typography><Typography variant="body2">{formatDate(selectedWorkflow.startedAt)}</Typography></CardContent></Card>
                  <Card variant="outlined"><CardContent><Typography variant="caption" color="text.secondary">Beendet</Typography><Typography variant="body2">{formatDate(selectedWorkflow.completedAt)}</Typography></CardContent></Card>
                </Box>

                {selectedWorkflow.error ? <Alert severity="error">{selectedWorkflow.error}</Alert> : null}

                <Divider />
                <Typography variant="subtitle1">Workflow-Historie</Typography>
                {selectedWorkflow.history && selectedWorkflow.history.length > 0 ? (
                  <Stack spacing={0.8}>
                    {[...selectedWorkflow.history]
                      .sort(
                        (a, b) =>
                          new Date(a.at).getTime() -
                          new Date(b.at).getTime()
                      )
                      .map((entry) => (
                        <Card key={entry.id} variant="outlined">
                          <CardContent sx={{ '&:last-child': { pb: 1.3 } }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                              <Typography variant="body2" fontWeight={700}>{entry.message || entry.type}</Typography>
                              <Typography variant="caption" color="text.secondary">{formatDate(entry.at)}</Typography>
                            </Stack>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.4, display: 'block' }}>
                              {entry.taskTitle ? `Task: ${entry.taskTitle}` : ''}
                              {entry.taskType ? ` (${taskTypeLabel(entry.taskType)})` : ''}
                              {entry.fromStatus || entry.toStatus
                                ? ` · ${entry.fromStatus || '–'} → ${entry.toStatus || '–'}`
                                : ''}
                            </Typography>
                            {entry.metadata ? (
                              <details style={{ marginTop: 8 }}>
                                <summary>Metadaten</summary>
                                <pre>{JSON.stringify(entry.metadata, null, 2)}</pre>
                              </details>
                            ) : null}
                          </CardContent>
                        </Card>
                      ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">Keine Historie vorhanden.</Typography>
                )}

                <Divider />
                <Typography variant="subtitle1">Schritte</Typography>
                <Stack spacing={0.9}>
                  {selectedWorkflow.tasks.map((task, index) => (
                    <Card key={`${task.id}-${index}`} variant="outlined">
                      <CardContent>
                        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                          <Typography variant="body2" fontWeight={700}>
                            {index + 1}. {task.title || `Schritt ${index + 1}`}
                          </Typography>
                          <Chip size="small" color={taskStatusChipColor(task.status)} label={task.status} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.4, display: 'block' }}>
                          {taskTypeLabel(task.type)} · {task.auto ? 'Automatisch' : 'Manuelle Freigabe'}
                        </Typography>

                        {!task.auto && task.status === 'PENDING' && selectedWorkflow.status === 'PAUSED' ? (
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7} sx={{ mt: 1 }}>
                            <Button
                              size="small"
                              color="success"
                              variant="contained"
                              startIcon={<CheckRoundedIcon />}
                              onClick={() => {
                                void handleApproveTask(selectedWorkflow.id, task.id);
                              }}
                              disabled={approvalLoading[task.id] || bulkLoading}
                            >
                              Freigeben
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              startIcon={<CloseRoundedIcon />}
                              onClick={() => {
                                void handleRejectTask(selectedWorkflow.id, task.id);
                              }}
                              disabled={approvalLoading[task.id] || bulkLoading}
                            >
                              Ablehnen
                            </Button>
                          </Stack>
                        ) : null}

                        {task.status === 'FAILED' ? (
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7} sx={{ mt: 1 }}>
                            <Button
                              size="small"
                              color="warning"
                              variant="contained"
                              startIcon={<ReplayRoundedIcon />}
                              onClick={() => {
                                void handleRecoveryAction(selectedWorkflow.id, task.id, 'retry');
                              }}
                              disabled={recoveryLoading[`${selectedWorkflow.id}:${task.id}:retry`] || bulkLoading}
                            >
                              Retry
                            </Button>
                            <Button
                              size="small"
                              color="warning"
                              variant="outlined"
                              startIcon={<SkipNextRoundedIcon />}
                              onClick={() => {
                                void handleRecoveryAction(selectedWorkflow.id, task.id, 'skip');
                              }}
                              disabled={recoveryLoading[`${selectedWorkflow.id}:${task.id}:skip`] || bulkLoading}
                            >
                              Skip
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<PlayArrowRoundedIcon />}
                              onClick={() => {
                                void handleRecoveryAction(selectedWorkflow.id, task.id, 'resume');
                              }}
                              disabled={recoveryLoading[`${selectedWorkflow.id}:${task.id}:resume`] || bulkLoading}
                            >
                              Fortsetzen
                            </Button>
                          </Stack>
                        ) : null}

                        {task.description ? (
                          <Typography variant="body2" sx={{ mt: 1 }}>{task.description}</Typography>
                        ) : null}

                        <details style={{ marginTop: 8 }}>
                          <summary>Konfiguration</summary>
                          <pre>{JSON.stringify(task.config || {}, null, 2)}</pre>
                        </details>
                        {task.executionData ? (
                          <details style={{ marginTop: 8 }}>
                            <summary>Ausführungsdaten</summary>
                            <pre>{JSON.stringify(task.executionData || {}, null, 2)}</pre>
                          </details>
                        ) : null}
                        {task.executionData?.apiRequestPreview ? (
                          <details style={{ marginTop: 8 }}>
                            <summary>Redmine API-Übergabe</summary>
                            <pre>{JSON.stringify(task.executionData.apiRequestPreview, null, 2)}</pre>
                          </details>
                        ) : null}
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              </>
            )}
          </Stack>
        </Box>
      </Drawer>
    </Stack>
  );
};

export default WorkflowMonitor;
