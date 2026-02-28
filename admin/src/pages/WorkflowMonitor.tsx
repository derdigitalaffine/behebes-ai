import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { subscribeAdminRealtime } from '../lib/realtime';
import { useTableSelection } from '../lib/tableSelection';
import './WorkflowMonitor.css';

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

const STATUS_ICON_CLASSES: Record<WorkflowExecution['status'], string> = {
  RUNNING: 'fa-solid fa-play',
  PAUSED: 'fa-solid fa-pause',
  COMPLETED: 'fa-solid fa-check',
  FAILED: 'fa-solid fa-xmark',
};

const MODE_LABELS: Record<WorkflowExecution['executionMode'], string> = {
  MANUAL: 'Manuell',
  AUTO: 'Auto',
  HYBRID: 'Hybrid',
};

const STATUS_ORDER: WorkflowExecution['status'][] = ['RUNNING', 'PAUSED', 'COMPLETED', 'FAILED'];
const MODE_ORDER: WorkflowExecution['executionMode'][] = ['AUTO', 'HYBRID', 'MANUAL'];
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

type PageSize = 10 | 25 | 50 | 'all';
type SortKey =
  | 'title'
  | 'category'
  | 'status'
  | 'mode'
  | 'startedAt'
  | 'currentTask'
  | 'pending'
  | 'ticketId';
type SortDirection = 'asc' | 'desc';

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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WorkflowExecution['status']>('all');
  const [modeFilter, setModeFilter] = useState<'all' | WorkflowExecution['executionMode']>('all');
  const [blockedFilter, setBlockedFilter] = useState<'all' | 'blocked' | 'none'>('all');
  const [slaFilter, setSlaFilter] = useState<'all' | 'ok' | 'risk' | 'overdue'>('all');
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('startedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
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
      console.error('Error fetching workflows:', err);
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
    const traceId = `wf-approve-${workflowId.slice(0, 8)}-${taskId.slice(0, 8)}-${Date.now()}`;
    const startedAt = performance.now();
    console.groupCollapsed(`[Workflow/Redmine] Approve ${traceId}`);
    console.info('Approve request', {
      method: 'POST',
      url: `/api/admin/workflows/${workflowId}/tasks/${taskId}/approve`,
      workflowId,
      taskId,
    });
    setApprovalLoading((prev) => ({ ...prev, [taskId]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(`/api/admin/workflows/${workflowId}/tasks/${taskId}/approve`, {}, { headers });
      const execution = response.data;
      console.info('Approve response', {
        status: response.status,
        executionId: execution?.id || null,
        workflowStatus: execution?.status || null,
        currentTaskIndex: execution?.currentTaskIndex,
      });
      if (Array.isArray(execution?.tasks)) {
        const redmineTasks = execution.tasks
          .filter((task: any) => task?.type === 'REDMINE_TICKET')
          .map((task: any) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            auto: !!task.auto,
            executionData: task.executionData,
            config: task.config,
          }));
        console.debug('Redmine task snapshot', redmineTasks);
      }
      if (Array.isArray(execution?.history)) {
        console.debug('Workflow history tail', execution.history.slice(-10));
      }
      setSuccessMessage('Task freigegeben');
      setTimeout(() => setSuccessMessage(''), 3000);
      await fetchWorkflows();
      if (selectedWorkflowId === workflowId) {
        try {
          const detailRes = await axios.get(`/api/admin/workflows/${workflowId}`, { headers });
          setSelectedWorkflow(detailRes.data || null);
        } catch {
          setSelectedWorkflow(null);
        }
      }
    } catch (err: any) {
      console.error('Approve failed', {
        workflowId,
        taskId,
        status: err?.response?.status || null,
        message: err?.response?.data?.message || err?.message || 'unbekannt',
        data: err?.response?.data,
      });
      setError('Fehler beim Freigeben der Task');
    } finally {
      console.info('Done', {
        durationMs: Math.round(performance.now() - startedAt),
      });
      console.groupEnd();
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
        try {
          const detailRes = await axios.get(`/api/admin/workflows/${workflowId}`, { headers });
          setSelectedWorkflow(detailRes.data || null);
        } catch {
          setSelectedWorkflow(null);
        }
      }
    } catch (err: any) {
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

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, modeFilter, blockedFilter, slaFilter, activeFilter, pageSize]);

  const filteredWorkflows = useMemo(() => {
    const term = search.trim().toLowerCase();
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
      if (!term) return true;
      const haystack = [
        workflow.title,
        workflow.category,
        workflow.ticketId,
        workflow.submissionId,
        workflow.address,
        workflow.blockedReason || '',
        SLA_LABELS[getWorkflowSlaState(workflow)],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [workflows, activeFilter, statusFilter, modeFilter, blockedFilter, slaFilter, search]);

  const sortedWorkflows = useMemo(() => {
    const parseDate = (value?: string) => {
      if (!value) return 0;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    };
    const statusIndex = (status: WorkflowExecution['status']) => {
      const idx = STATUS_ORDER.indexOf(status);
      return idx === -1 ? STATUS_ORDER.length : idx;
    };
    const modeIndex = (mode: WorkflowExecution['executionMode']) => {
      const idx = MODE_ORDER.indexOf(mode);
      return idx === -1 ? MODE_ORDER.length : idx;
    };
    const severityScore = (workflow: WorkflowExecution) => {
      const slaState = getWorkflowSlaState(workflow);
      const slaScore = slaState === 'overdue' ? 3 : slaState === 'risk' ? 2 : 1;
      const blockedScore = (workflow.blockedReason || 'none') !== 'none' ? 1 : 0;
      return slaScore + blockedScore;
    };

    return [...filteredWorkflows].sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      switch (sortKey) {
        case 'title':
          aVal = a.title || '';
          bVal = b.title || '';
          break;
        case 'category':
          aVal = a.category || '';
          bVal = b.category || '';
          break;
        case 'status':
          aVal = statusIndex(a.status);
          bVal = statusIndex(b.status);
          break;
        case 'mode':
          aVal = modeIndex(a.executionMode);
          bVal = modeIndex(b.executionMode);
          break;
        case 'currentTask':
          aVal = currentTask(a)?.title || '';
          bVal = currentTask(b)?.title || '';
          break;
        case 'pending':
          aVal = getPendingTasks(a).length;
          bVal = getPendingTasks(b).length;
          break;
        case 'ticketId':
          aVal = a.ticketId || '';
          bVal = b.ticketId || '';
          break;
        case 'startedAt':
        default:
          if (severityScore(a) !== severityScore(b)) {
            return severityScore(b) - severityScore(a);
          }
          aVal = parseDate(a.startedAt);
          bVal = parseDate(b.startedAt);
      }

      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal, 'de', { sensitivity: 'base' });
      } else {
        comparison = Number(aVal) - Number(bVal);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredWorkflows, sortKey, sortDirection]);

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

  const totalFiltered = sortedWorkflows.length;
  const effectivePageSize = pageSize === 'all' ? totalFiltered || 1 : pageSize;
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalFiltered / effectivePageSize));
  const pageStart = pageSize === 'all' ? 0 : (currentPage - 1) * effectivePageSize;
  const paginatedWorkflows =
    pageSize === 'all'
      ? sortedWorkflows
      : sortedWorkflows.slice(pageStart, pageStart + effectivePageSize);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '↕';
    return sortDirection === 'asc' ? '▲' : '▼';
  };

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
      const failed = results.length - deletedIds.length;
      if (deletedIds.length > 0) {
        setWorkflows((prev) => prev.filter((workflow) => !deletedIds.includes(workflow.id)));
      }
      if (selectedWorkflowId && deletedIds.includes(selectedWorkflowId)) {
        setSelectedWorkflowId(null);
        setSelectedWorkflow(null);
      }
      if (failed > 0) {
        setError(`${deletedIds.length} gelöscht, ${failed} fehlgeschlagen.`);
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
    const batchId = `wf-approve-bulk-${Date.now()}`;
    const startedAt = performance.now();
    console.groupCollapsed(`[Workflow/Redmine] Bulk approve ${batchId}`);
    console.info('Candidates', candidates);
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
          axios
            .post(`/api/admin/workflows/${candidate.workflowId}/tasks/${candidate.taskId}/approve`, {}, { headers })
            .then((response) => ({
              workflowId: candidate.workflowId,
              taskId: candidate.taskId,
              execution: response.data,
              status: response.status,
            }))
        )
      );
      const failed = results.filter((result) => result.status === 'rejected').length;
      const ok = results.length - failed;
      const failedDetails = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => {
          const reason = result.reason as any;
          return {
            status: reason?.response?.status || null,
            message: reason?.response?.data?.message || reason?.message || 'unbekannt',
            data: reason?.response?.data,
          };
        });
      console.info('Bulk approve summary', {
        total: results.length,
        successful: ok,
        failed,
        failedDetails,
      });
      results
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{
            workflowId: string;
            taskId: string;
            execution: any;
            status: number;
          }> => result.status === 'fulfilled'
        )
        .forEach(({ value }) => {
          const redmineTask = Array.isArray(value.execution?.tasks)
            ? value.execution.tasks.find((task: any) => task?.type === 'REDMINE_TICKET')
            : null;
          console.debug('Approved workflow', {
            workflowId: value.workflowId,
            taskId: value.taskId,
            responseStatus: value.status,
            executionId: value.execution?.id,
            workflowStatus: value.execution?.status,
            redmineTask,
          });
        });
      if (failed > 0) {
        setError(`${ok} Task(s) freigegeben, ${failed} fehlgeschlagen.`);
      } else {
        setSuccessMessage(`${ok} Task(s) freigegeben.`);
      }
      await fetchWorkflows();
      selection.clearSelection();
    } catch {
      setError('Fehler beim Freigeben der ausgewählten Tasks');
    } finally {
      console.info('Done', {
        durationMs: Math.round(performance.now() - startedAt),
      });
      console.groupEnd();
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

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Wird geladen...</div>;
  }

  return (
    <div className="workflow-monitor">
      <h1 className="monitor-title">
        <i className="fa-solid fa-diagram-project" /> Workflow-Instanzen
      </h1>
      <p className="monitor-subtitle">
        Workflows definieren den Prozess. Hier sehen Sie die laufenden Workflow-Instanzen pro Ticket.
      </p>
      <div className="monitor-toolbar">
        <div className="monitor-toolbar-note">
          <i className="fa-solid fa-info-circle" /> Workflow-Definitionen bearbeiten Sie in den Einstellungen.
        </div>
        <div className="monitor-toolbar-actions">
          <Link to="/admin-settings/workflow" className="toolbar-link-btn">
            <i className="fa-solid fa-gears" /> Zu den Workflow-Definitionen
          </Link>
          <button type="button" className="toolbar-refresh-btn" onClick={fetchWorkflows}>
            <i className="fa-solid fa-rotate" /> Aktualisieren
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="monitor-stats">
        <div className="stat-card">
          <div className="stat-number">{totalWorkflows}</div>
          <div className="stat-label">Instanzen gesamt</div>
        </div>
        <div className="stat-card pending">
          <div className="stat-number">{manualPending}</div>
          <div className="stat-label">Warten auf Freigabe</div>
        </div>
        <div className="stat-card completed">
          <div className="stat-number">{completed}</div>
          <div className="stat-label">Abgeschlossen</div>
        </div>
        <div className="stat-card failed">
          <div className="stat-number">{failed}</div>
          <div className="stat-label">Fehler</div>
        </div>
        <div className="stat-card pending">
          <div className="stat-number">{blockedCount}</div>
          <div className="stat-label">Mit Blocker</div>
        </div>
        <div className="stat-card failed">
          <div className="stat-number">{overdueCount}</div>
          <div className="stat-label">SLA überfällig</div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="alert error message-banner">
          <span>{error}</span>
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {successMessage && (
        <div className="alert success message-banner">
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage('')}>×</button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="monitor-tabs">
        <button
          className={`tab-btn ${activeFilter === 'all' ? 'active' : ''}`}
          onClick={() => setActiveFilter('all')}
        >
          Alle Instanzen ({totalWorkflows})
        </button>
        <button
          className={`tab-btn ${activeFilter === 'manual' ? 'active' : ''}`}
          onClick={() => setActiveFilter('manual')}
        >
          <i className="fa-solid fa-hourglass-half" /> Warten auf Freigabe ({manualPending})
        </button>
        <button
          className={`tab-btn ${activeFilter === 'paused' ? 'active' : ''}`}
          onClick={() => setActiveFilter('paused')}
        >
          <i className="fa-solid fa-pause" /> Pausiert
        </button>
        <button
          className={`tab-btn ${activeFilter === 'completed' ? 'active' : ''}`}
          onClick={() => setActiveFilter('completed')}
        >
          <i className="fa-solid fa-check" /> Abgeschlossen ({completed})
        </button>
      </div>

      <section className="manual-control-panel">
        <div className="manual-control-head">
          <h2>
            <i className="fa-solid fa-user-check" /> Manuelle Workflow-Steuerung
          </h2>
          <span className={`manual-control-count ${manualControlQueue.length > 0 ? 'open' : ''}`}>
            {manualControlQueue.length} Instanzen mit Freigaben
          </span>
        </div>
        {manualControlQueue.length === 0 ? (
          <p className="manual-control-empty">Derzeit gibt es keine pausierten Workflows mit offenen manuellen Tasks.</p>
        ) : (
          <div className="manual-control-list">
            {manualControlQueue.map((workflow) => {
              const pendingTasks = getPendingTasks(workflow);
              const nextManualTask = pendingTasks[0];
              if (!nextManualTask) return null;
              const isTaskLoading = !!approvalLoading[nextManualTask.id] || bulkLoading;
              return (
                <div key={workflow.id} className="manual-control-item">
                  <div className="manual-control-item-main">
                    <div className="manual-control-item-title">{workflow.title}</div>
                    <div className="manual-control-item-meta">
                      <span className={`badge status-${workflow.status.toLowerCase()}`}>
                        <i className={STATUS_ICON_CLASSES[workflow.status]} /> {STATUS_LABELS[workflow.status]}
                      </span>
                      <span className="manual-control-chip">
                        <i className="fa-solid fa-hourglass-half" /> {pendingTasks.length} offen
                      </span>
                      <span className="manual-control-chip">
                        <i className="fa-solid fa-ticket" />{' '}
                        {workflow.ticketId ? (
                          <Link to={`/tickets/${workflow.ticketId}`} className="workflow-link">
                            {workflow.ticketId.slice(0, 8)}
                          </Link>
                        ) : (
                          '–'
                        )}
                      </span>
                    </div>
                    <div className="manual-control-item-task">
                      Nächste manuelle Task: <strong>{nextManualTask.title}</strong> ({taskTypeLabel(nextManualTask.type)})
                    </div>
                  </div>
                  <div className="manual-control-item-actions">
                    <button
                      className="workflow-action details"
                      type="button"
                      onClick={() => handleOpenWorkflowDetails(workflow.id)}
                    >
                      <i className="fa-solid fa-circle-info" /> Details
                    </button>
                    <button
                      className="workflow-action approve"
                      type="button"
                      onClick={() => handleApproveTask(workflow.id, nextManualTask.id)}
                      disabled={isTaskLoading}
                    >
                      {isTaskLoading ? (
                        <i className="fa-solid fa-spinner fa-spin" />
                      ) : (
                        <i className="fa-solid fa-check" />
                      )}
                      Freigeben
                    </button>
                    <button
                      className="workflow-action reject"
                      type="button"
                      onClick={() => handleRejectTask(workflow.id, nextManualTask.id)}
                      disabled={isTaskLoading}
                    >
                      <i className="fa-solid fa-xmark" /> Ablehnen
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="workflow-controls">
        <div className="filter-group grow">
          <label>Suche</label>
          <input
            type="text"
            placeholder="Workflow-Instanz, Kategorie, Ticket..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <label>Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="all">Alle</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Modus</label>
          <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value as typeof modeFilter)}>
            <option value="all">Alle</option>
            {Object.entries(MODE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>SLA</label>
          <select value={slaFilter} onChange={(e) => setSlaFilter(e.target.value as typeof slaFilter)}>
            <option value="all">Alle</option>
            <option value="ok">{SLA_LABELS.ok}</option>
            <option value="risk">{SLA_LABELS.risk}</option>
            <option value="overdue">{SLA_LABELS.overdue}</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Blocker</label>
          <select value={blockedFilter} onChange={(e) => setBlockedFilter(e.target.value as typeof blockedFilter)}>
            <option value="all">Alle</option>
            <option value="blocked">Nur mit Blocker</option>
            <option value="none">Nur ohne Blocker</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Seiten</label>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value) as PageSize)}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value="all">Alle</option>
          </select>
        </div>
      </div>

      {selection.selectedCount > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-actions-meta">
            <span className="count">{selection.selectedCount}</span>
            <span>ausgewählt</span>
          </div>
          <div className="bulk-actions-buttons">
            <button className="bulk-btn success" type="button" onClick={handleBulkApproveTasks} disabled={bulkLoading}>
              <i className="fa-solid fa-check" /> Freigaben ausführen
            </button>
            <button className="bulk-btn danger" type="button" onClick={handleBulkDeleteWorkflows} disabled={bulkLoading}>
              <i className="fa-solid fa-trash" /> Workflow-Instanzen löschen
            </button>
            <button className="bulk-btn" type="button" onClick={selection.clearSelection} disabled={bulkLoading}>
              Auswahl aufheben
            </button>
          </div>
        </div>
      )}

      <div className="workflows-container">
        {paginatedWorkflows.length === 0 ? (
          <div className="empty-state">
            <p>Keine Workflow-Instanzen gefunden</p>
            <small>Alle Instanzen laufen automatisch oder sind bereits abgeschlossen</small>
          </div>
        ) : (
          <>
            <div className="workflow-table-wrapper">
              <table className="workflow-table">
                <thead>
                  <tr>
                    <th className="table-select-col">
                      <input
                        type="checkbox"
                        className="table-select-checkbox"
                        checked={selection.areAllSelected(paginatedWorkflows)}
                        onChange={() => selection.toggleAll(paginatedWorkflows)}
                        aria-label="Alle Workflow-Instanzen auf der Seite auswählen"
                      />
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => handleSort('title')}>
                        Workflow (Prozess) <span className="sort-indicator">{sortIndicator('title')}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => handleSort('status')}>
                        Status <span className="sort-indicator">{sortIndicator('status')}</span>
                      </button>
                    </th>
                    <th>SLA</th>
                    <th>Blocker</th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => handleSort('mode')}>
                        Modus <span className="sort-indicator">{sortIndicator('mode')}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => handleSort('category')}>
                        Kategorie <span className="sort-indicator">{sortIndicator('category')}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => handleSort('currentTask')}>
                        Aktuelle Task <span className="sort-indicator">{sortIndicator('currentTask')}</span>
                      </button>
                    </th>
                    <th>Schritt</th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => handleSort('pending')}>
                        Freigaben <span className="sort-indicator">{sortIndicator('pending')}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => handleSort('startedAt')}>
                        Start <span className="sort-indicator">{sortIndicator('startedAt')}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort" onClick={() => handleSort('ticketId')}>
                        Ticket <span className="sort-indicator">{sortIndicator('ticketId')}</span>
                      </button>
                    </th>
                    <th>Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedWorkflows.map((workflow) => {
                    const pendingManualCount = getPendingTasks(workflow).length;
                    const failedTasks = getFailedTasks(workflow);
                    const failedTask = failedTasks[0] || null;
                    const displayTask = currentTask(workflow);
                    const approvableTask = getApprovableTask(workflow);
                    const canApprove = !!approvableTask;
                    const slaState = getWorkflowSlaState(workflow);
                    return (
                      <tr key={workflow.id}>
                        <td className="table-select-cell">
                          <input
                            type="checkbox"
                            className="table-select-checkbox"
                            checked={selection.isSelected(workflow.id)}
                            onChange={() => selection.toggleRow(workflow.id)}
                            aria-label={`Workflow ${workflow.id} auswählen`}
                          />
                        </td>
                        <td>
                          <div className="workflow-cell">
                            <div className="workflow-title">{workflow.title}</div>
                            <div className="workflow-sub">ID {workflow.id.slice(0, 8)}</div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge status-${workflow.status.toLowerCase()}`}
                            title={workflow.error || ''}
                          >
                            {STATUS_LABELS[workflow.status]}
                          </span>
                        </td>
                        <td>
                          <span className={`badge sla-${slaState}`}>{SLA_LABELS[slaState]}</span>
                        </td>
                        <td>
                          <span className="badge blocked-reason" title={workflow.blockedReason || ''}>
                            {BLOCKED_REASON_LABELS[workflow.blockedReason || 'none'] || workflow.blockedReason || 'Kein Blocker'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge mode-${workflow.executionMode.toLowerCase()}`}>
                            {MODE_LABELS[workflow.executionMode]}
                          </span>
                        </td>
                        <td>{workflow.category || '–'}</td>
                        <td>{displayTask?.title || '–'}</td>
                        <td>
                          {workflow.tasks.length === 0
                            ? '–'
                            : `${Math.min(workflow.currentTaskIndex + 1, workflow.tasks.length)}/${workflow.tasks.length}`}
                        </td>
                        <td>{pendingManualCount > 0 ? pendingManualCount : '–'}</td>
                        <td>{formatDate(workflow.startedAt)}</td>
                        <td>
                          {workflow.ticketId ? (
                            <Link to={`/tickets/${workflow.ticketId}`} className="workflow-link">
                              {workflow.ticketId.slice(0, 8)}
                            </Link>
                          ) : (
                            '–'
                          )}
                        </td>
                        <td>
                          <div className="workflow-actions">
                            <button
                              className="workflow-action details"
                              onClick={() => handleOpenWorkflowDetails(workflow.id)}
                            >
                              <i className="fa-solid fa-circle-info" /> Details
                            </button>
                            {canApprove && approvableTask && (
                              <>
                                <button
                                  className="workflow-action approve"
                                  onClick={() => handleApproveTask(workflow.id, approvableTask.id)}
                                  disabled={approvalLoading[approvableTask.id] || bulkLoading}
                                >
                                  {approvalLoading[approvableTask.id] ? (
                                    <i className="fa-solid fa-spinner fa-spin" />
                                  ) : (
                                    <i className="fa-solid fa-check" />
                                  )}
                                  Freigeben
                                </button>
                                <button
                                  className="workflow-action reject"
                                  onClick={() => handleRejectTask(workflow.id, approvableTask.id)}
                                  disabled={approvalLoading[approvableTask.id] || bulkLoading}
                                >
                                  <i className="fa-solid fa-xmark" /> Ablehnen
                                </button>
                              </>
                            )}
                            {failedTask && (
                              <>
                                <button
                                  className="workflow-action approve"
                                  onClick={() => handleRecoveryAction(workflow.id, failedTask.id, 'retry')}
                                  disabled={recoveryLoading[`${workflow.id}:${failedTask.id}:retry`] || bulkLoading}
                                >
                                  {recoveryLoading[`${workflow.id}:${failedTask.id}:retry`] ? (
                                    <i className="fa-solid fa-spinner fa-spin" />
                                  ) : (
                                    <i className="fa-solid fa-rotate-right" />
                                  )}
                                  Retry
                                </button>
                                <button
                                  className="workflow-action reject"
                                  onClick={() => handleRecoveryAction(workflow.id, failedTask.id, 'skip')}
                                  disabled={recoveryLoading[`${workflow.id}:${failedTask.id}:skip`] || bulkLoading}
                                >
                                  <i className="fa-solid fa-forward" /> Skip
                                </button>
                                <button
                                  className="workflow-action details"
                                  onClick={() => handleRecoveryAction(workflow.id, failedTask.id, 'resume')}
                                  disabled={recoveryLoading[`${workflow.id}:${failedTask.id}:resume`] || bulkLoading}
                                >
                                  <i className="fa-solid fa-user-check" /> Fortsetzen
                                </button>
                              </>
                            )}
                            <button
                              className="workflow-action delete"
                              onClick={() => handleDeleteWorkflow(workflow.id)}
                              disabled={deleteLoading[workflow.id] || bulkLoading}
                            >
                              {deleteLoading[workflow.id] ? (
                                <i className="fa-solid fa-spinner fa-spin" />
                              ) : (
                                <i className="fa-solid fa-trash" />
                              )}
                              Löschen
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="workflow-pagination">
              <div className="pagination-info">
                {pageSize === 'all'
                  ? `Alle ${totalFiltered} Instanzen`
                  : `Seite ${currentPage} von ${totalPages} · ${totalFiltered} Instanzen`}
              </div>
              <div className="pagination-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1 || pageSize === 'all'}
                >
                  Zurück
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages || pageSize === 'all'}
                >
                  Weiter
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {selectedWorkflowId && (
        <div className="workflow-detail-overlay" onClick={handleCloseWorkflowDetails}>
          <div
            className="workflow-detail-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="workflow-detail-header">
              <h2>
                <i className="fa-solid fa-diagram-project" /> Workflow-Instanz Details
              </h2>
              <button
                type="button"
                className="workflow-detail-close"
                onClick={handleCloseWorkflowDetails}
              >
                ×
              </button>
            </div>

            {detailsLoading ? (
              <div className="workflow-detail-loading">Details werden geladen…</div>
            ) : !selectedWorkflow ? (
              <div className="workflow-detail-loading">Keine Daten verfügbar.</div>
            ) : (
              <>
                <div className="workflow-detail-meta">
                  <div>
                    <span>Workflow-ID</span>
                    <strong>{selectedWorkflow.id}</strong>
                  </div>
                  <div>
                    <span>Workflow-Definition</span>
                    <strong>{selectedWorkflow.templateId || '–'}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>{STATUS_LABELS[selectedWorkflow.status]}</strong>
                  </div>
                  <div>
                    <span>SLA</span>
                    <strong>{SLA_LABELS[getWorkflowSlaState(selectedWorkflow)]}</strong>
                  </div>
                  <div>
                    <span>Blocker</span>
                    <strong>
                      {BLOCKED_REASON_LABELS[selectedWorkflow.blockedReason || 'none'] ||
                        selectedWorkflow.blockedReason ||
                        'Kein Blocker'}
                    </strong>
                  </div>
                  <div>
                    <span>Modus</span>
                    <strong>{MODE_LABELS[selectedWorkflow.executionMode]}</strong>
                  </div>
                  <div>
                    <span>Ticket</span>
                    <strong>{selectedWorkflow.ticketId || '–'}</strong>
                  </div>
                  <div>
                    <span>Meldung</span>
                    <strong>{selectedWorkflow.submissionId || '–'}</strong>
                  </div>
                  <div>
                    <span>Kategorie</span>
                    <strong>{selectedWorkflow.category || '–'}</strong>
                  </div>
                  <div>
                    <span>Aktueller Schritt</span>
                    <strong>
                      {selectedWorkflow.tasks.length > 0
                        ? `${Math.min(selectedWorkflow.currentTaskIndex + 1, selectedWorkflow.tasks.length)}/${selectedWorkflow.tasks.length}`
                        : '–'}
                    </strong>
                  </div>
                  <div>
                    <span>Gestartet</span>
                    <strong>{formatDate(selectedWorkflow.startedAt)}</strong>
                  </div>
                  <div>
                    <span>Beendet</span>
                    <strong>{formatDate(selectedWorkflow.completedAt)}</strong>
                  </div>
                </div>

                {selectedWorkflow.error && (
                  <div className="workflow-detail-error">{selectedWorkflow.error}</div>
                )}

                <div className="workflow-detail-section">
                  <h3>Workflow-Historie</h3>
                  {selectedWorkflow.history && selectedWorkflow.history.length > 0 ? (
                    <div className="workflow-history-list">
                      {[...selectedWorkflow.history]
                        .sort(
                          (a, b) =>
                            new Date(a.at).getTime() -
                            new Date(b.at).getTime()
                        )
                        .map((entry) => (
                          <div key={entry.id} className="workflow-history-item">
                            <div className="workflow-history-top">
                              <strong>{entry.message || entry.type}</strong>
                              <span>{formatDate(entry.at)}</span>
                            </div>
                            <div className="workflow-history-meta">
                              {entry.taskTitle ? `Task: ${entry.taskTitle}` : ''}
                              {entry.taskType ? ` (${taskTypeLabel(entry.taskType)})` : ''}
                              {entry.fromStatus || entry.toStatus
                                ? ` · ${entry.fromStatus || '–'} → ${entry.toStatus || '–'}`
                                : ''}
                            </div>
                            {entry.metadata && (
                              <details>
                                <summary>Metadaten</summary>
                                <pre>{JSON.stringify(entry.metadata, null, 2)}</pre>
                              </details>
                            )}
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="workflow-history-empty">Keine Historie vorhanden.</div>
                  )}
                </div>

                <div className="workflow-detail-section">
                  <h3>Schritte</h3>
                  <div className="workflow-detail-tasks">
                    {selectedWorkflow.tasks.map((task, index) => (
                      <div key={`${task.id}-${index}`} className="workflow-detail-task">
                        <div className="workflow-detail-task-head">
                          <strong>
                            {index + 1}. {task.title || `Schritt ${index + 1}`}
                          </strong>
                          <span className={`badge status-${task.status.toLowerCase()}`}>
                            {task.status}
                          </span>
                        </div>
                        <div className="workflow-detail-task-meta">
                          {taskTypeLabel(task.type)} ·{' '}
                          {task.auto ? 'Automatisch' : 'Manuelle Freigabe'}
                        </div>
                        {!task.auto && task.status === 'PENDING' && selectedWorkflow.status === 'PAUSED' && (
                          <div className="workflow-detail-task-actions">
                            <button
                              className="workflow-action approve"
                              type="button"
                              onClick={() => handleApproveTask(selectedWorkflow.id, task.id)}
                              disabled={approvalLoading[task.id] || bulkLoading}
                            >
                              {approvalLoading[task.id] ? (
                                <i className="fa-solid fa-spinner fa-spin" />
                              ) : (
                                <i className="fa-solid fa-check" />
                              )}
                              Freigeben
                            </button>
                            <button
                              className="workflow-action reject"
                              type="button"
                              onClick={() => handleRejectTask(selectedWorkflow.id, task.id)}
                              disabled={approvalLoading[task.id] || bulkLoading}
                            >
                              <i className="fa-solid fa-xmark" /> Ablehnen
                            </button>
                          </div>
                        )}
                        {task.status === 'FAILED' && (
                          <div className="workflow-detail-task-actions">
                            <button
                              className="workflow-action approve"
                              type="button"
                              onClick={() => handleRecoveryAction(selectedWorkflow.id, task.id, 'retry')}
                              disabled={recoveryLoading[`${selectedWorkflow.id}:${task.id}:retry`] || bulkLoading}
                            >
                              <i className="fa-solid fa-rotate-right" /> Retry
                            </button>
                            <button
                              className="workflow-action reject"
                              type="button"
                              onClick={() => handleRecoveryAction(selectedWorkflow.id, task.id, 'skip')}
                              disabled={recoveryLoading[`${selectedWorkflow.id}:${task.id}:skip`] || bulkLoading}
                            >
                              <i className="fa-solid fa-forward" /> Skip
                            </button>
                            <button
                              className="workflow-action details"
                              type="button"
                              onClick={() => handleRecoveryAction(selectedWorkflow.id, task.id, 'resume')}
                              disabled={recoveryLoading[`${selectedWorkflow.id}:${task.id}:resume`] || bulkLoading}
                            >
                              <i className="fa-solid fa-user-check" /> Fortsetzen
                            </button>
                          </div>
                        )}
                        {task.description && (
                          <div className="workflow-detail-task-text">{task.description}</div>
                        )}
                        <details>
                          <summary>Konfiguration</summary>
                          <pre>{JSON.stringify(task.config || {}, null, 2)}</pre>
                        </details>
                        {task.executionData && (
                          <details>
                            <summary>Ausführungsdaten</summary>
                            <pre>{JSON.stringify(task.executionData || {}, null, 2)}</pre>
                          </details>
                        )}
                        {task.executionData?.apiRequestPreview && (
                          <details>
                            <summary>Redmine API-Übergabe</summary>
                            <pre>{JSON.stringify(task.executionData.apiRequestPreview, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowMonitor;
