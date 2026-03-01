import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { Link, useNavigate } from 'react-router-dom';
import { isAdminRole } from '../lib/auth';
import { subscribeAdminRealtime } from '../lib/realtime';
import { useTableSelection } from '../lib/tableSelection';
import { useAdminScopeContext } from '../lib/adminScopeContext';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import './Dashboard.css';

interface Ticket {
  id: string;
  submissionId: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending_validation' | 'pending' | 'open' | 'assigned' | 'in-progress' | 'completed' | 'closed';
  address?: string;
  city?: string;
  createdAt: string;
  imageCount?: number;
  hasImages?: boolean;
  assignedTo?: string | null;
  owningOrgUnitId?: string | null;
  primaryAssigneeUserId?: string | null;
  primaryAssigneeOrgUnitId?: string | null;
}

interface DashboardStats {
  totalSubmissions: number;
  openTickets: number;
  closedTickets: number;
  averageResolutionTime: number;
  database?: {
    client: 'mysql' | 'sqlite';
    label: string;
    connection: string;
  };
}

interface DashboardProps {
  token: string;
  role: string;
}

interface LatestSituationReport {
  id: string;
  scopeKey?: string;
  createdAt?: string | null;
  days?: number;
  maxTickets?: number;
  ticketCount?: number;
  summary?: string;
}

interface WorkflowTask {
  id: string;
  title: string;
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
  executionData?: Record<string, any>;
}

interface WorkflowExecution {
  id: string;
  title: string;
  ticketId: string;
  category?: string;
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
  tasks: WorkflowTask[];
}

type SortKey = 'createdAt' | 'status' | 'priority' | 'category' | 'location';
type SortDirection = 'asc' | 'desc';
type PageSize = 5 | 10 | 20 | 50;

const STATUS_LABELS: Record<string, string> = {
  pending_validation: 'Validierung ausstehend',
  pending: 'Ausstehend',
  open: 'Offen',
  assigned: 'Zugewiesen',
  'in-progress': 'In Bearbeitung',
  completed: 'Abgeschlossen',
  closed: 'Geschlossen',
};

const STATUS_ORDER = [
  'pending_validation',
  'pending',
  'open',
  'assigned',
  'in-progress',
  'completed',
  'closed',
];

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

const WORKFLOW_STATUS_LABELS: Record<WorkflowExecution['status'], string> = {
  RUNNING: 'Läuft',
  PAUSED: 'Pausiert',
  COMPLETED: 'Abgeschlossen',
  FAILED: 'Fehler',
};

const WORKFLOW_BLOCKED_REASON_LABELS: Record<string, string> = {
  none: 'Kein Blocker',
  waiting_external: 'Externes Warten',
  waiting_manual: 'Manuelle Freigabe',
  waiting_timer: 'Timer',
  deadlock_or_orphan_path: 'Deadlock/Orphan',
  loop_guard: 'Loop-Guard',
  error: 'Fehler',
};

const WORKFLOW_SLA_LABELS: Record<'ok' | 'risk' | 'overdue', string> = {
  ok: 'im Ziel',
  risk: 'gefährdet',
  overdue: 'überfällig',
};

const WORKFLOW_TASK_LABELS: Record<WorkflowTask['type'], string> = {
  REDMINE_TICKET: 'Redmine-Ticket',
  EMAIL: 'E-Mail',
  EMAIL_EXTERNAL: 'E-Mail (extern)',
  CATEGORIZATION: 'Kategorisierung',
  EMAIL_CONFIRMATION: 'E-Mail-Freigabe',
  EMAIL_DOUBLE_OPT_IN: 'E-Mail Double Opt-In',
  MAYOR_INVOLVEMENT: 'Ortsbürgermeister involvieren',
  CITIZEN_NOTIFICATION: 'Bürgerbenachrichtigung',
  REST_API_CALL: 'RESTful API Call',
  INTERNAL_PROCESSING: 'Interne Bearbeitung',
  DATENNACHFORDERUNG: 'Datennachforderung',
  ENHANCED_CATEGORIZATION: 'KI-Basierte Datennachforderung',
  FREE_AI_DATA_REQUEST: 'Freie KI-Datennachforderung',
  IMAGE_TO_TEXT_ANALYSIS: 'Bilder zu Text auswerten',
  END: 'Ende',
  JOIN: 'Join',
  SPLIT: 'Split',
  IF: 'IF',
  CUSTOM: 'Custom',
  WAIT_STATUS_CHANGE: 'Statuswechsel',
  CHANGE_WORKFLOW: 'Workflowwechsel',
  SUB_WORKFLOW: 'Teilworkflow',
  RESPONSIBILITY_CHECK: 'Zuständigkeit',
};

interface DashboardKpiCard {
  key: string;
  value: string | number;
  label: string;
  icon: string;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  hint?: string;
}

const parseTaskAwaitingUntilMs = (task: WorkflowTask | null | undefined): number | null => {
  if (!task) return null;
  const raw = task.executionData?.awaitingUntil;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatDurationClock = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatTimerCountdown = (targetMs: number, nowMs: number): string => {
  const diff = targetMs - nowMs;
  if (diff >= 0) {
    return formatDurationClock(diff);
  }
  return `+${formatDurationClock(Math.abs(diff))} überfällig`;
};

const Dashboard: React.FC<DashboardProps> = ({ token, role }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowExecution[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [timerNowMs, setTimerNowMs] = useState(() => Date.now());
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [liveConnectionState, setLiveConnectionState] = useState<'live' | 'reconnecting'>('live');
  const [liveLastEventAt, setLiveLastEventAt] = useState<string | null>(null);
  const [isLiveRefreshing, setIsLiveRefreshing] = useState(false);
  const [latestSituationReports, setLatestSituationReports] = useState<LatestSituationReport[]>([]);
  const [responsibilityQuery, setResponsibilityQuery] = useState('');
  const [responsibilityLoading, setResponsibilityLoading] = useState(false);
  const [responsibilityResult, setResponsibilityResult] = useState<Array<{
    type: string;
    id: string;
    name: string;
    confidence: number;
    reasoning?: string;
  }>>([]);

  const admin = isAdminRole(role);
  const { selection: scopeSelection } = useAdminScopeContext();

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) {
        setIsLoading(true);
      }
      const headers = { Authorization: `Bearer ${token}` };

      const [statsRes, ticketsRes, myTicketsRes, workflowsRes, situationRes] = await Promise.all([
        axios.get('/api/admin/dashboard/stats', { headers }),
        axios.get('/api/tickets', { headers }),
        axios
          .get('/api/tickets', { headers, params: { assignment: 'me', limit: 8 } })
          .catch(() => ({ data: [] })),
        axios.get('/api/admin/workflows', { headers }).catch(() => ({ data: [] })),
        axios.get('/api/admin/ai/situation-report/latest?limit=5', { headers }).catch(() => ({ data: { items: [] } })),
      ]);

      setStats(statsRes.data);
      const payload = ticketsRes.data;
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
        ? payload.items
        : [];
      setTickets(Array.isArray(list) ? list : []);

      const myPayload = myTicketsRes?.data;
      const myList = Array.isArray(myPayload)
        ? myPayload
        : Array.isArray(myPayload?.items)
        ? myPayload.items
        : [];
      setMyTickets(Array.isArray(myList) ? myList : []);

      setWorkflows(Array.isArray(workflowsRes?.data) ? workflowsRes.data : []);
      setLatestSituationReports(
        Array.isArray(situationRes?.data?.items)
          ? (situationRes.data.items as LatestSituationReport[])
          : []
      );
      setLastSyncAt(Date.now());
      setLiveConnectionState('live');
      setError('');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Laden der Daten');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [token]);

  const runResponsibilityQuery = useCallback(async () => {
    const text = responsibilityQuery.trim();
    if (!text) return;
    try {
      setResponsibilityLoading(true);
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(
        '/api/admin/responsibility/query',
        {
          query: text,
          tenantId: scopeSelection.scope === 'tenant' ? scopeSelection.tenantId : undefined,
          includeUsers: true,
          limit: 6,
        },
        { headers }
      );
      const candidates = Array.isArray(response.data?.candidates) ? response.data.candidates : [];
      setResponsibilityResult(candidates);
    } catch (err) {
      setError('Zuständigkeitsabfrage fehlgeschlagen.');
    } finally {
      setResponsibilityLoading(false);
    }
  }, [responsibilityQuery, scopeSelection.scope, scopeSelection.tenantId, token]);

  useEffect(() => {
    void fetchData();

    let queuedRefresh = false;
    let refreshInFlight = false;
    const requestSilentRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (queuedRefresh) return;
      queuedRefresh = true;
      window.setTimeout(() => {
        queuedRefresh = false;
        if (refreshInFlight) return;
        refreshInFlight = true;
        setIsLiveRefreshing(true);
        void fetchData({ silent: true }).finally(() => {
          refreshInFlight = false;
          setIsLiveRefreshing(false);
        });
      }, 150);
    };

    const unsubscribe = subscribeAdminRealtime({
      token,
      topics: ['tickets', 'workflows'],
      onUpdate: (event) => {
        setLiveConnectionState('live');
        setLiveLastEventAt(typeof event?.at === 'string' && event.at.trim() ? event.at : new Date().toISOString());
        requestSilentRefresh();
      },
      onError: () => {
        setLiveConnectionState('reconnecting');
        // Fallback polling continues below.
      },
    });

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchData({ silent: true });
      }
    }, 30000);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [fetchData, token]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimerNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pageSize]);

  const parseDate = (value?: string) => {
    if (!value) return 0;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  };

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (Array.isArray(tickets) ? tickets : []).filter((ticket) => {
      const statusOk = statusFilter === 'all' || ticket.status === statusFilter;
      if (!statusOk) return false;
      if (!term) return true;

      const haystack = [
        ticket.id,
        ticket.category,
        ticket.status,
        ticket.city,
        ticket.address,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [tickets, search, statusFilter]);

  const ticketById = useMemo(() => {
    const map = new Map<string, Ticket>();
    (Array.isArray(tickets) ? tickets : []).forEach((ticket) => map.set(ticket.id, ticket));
    return map;
  }, [tickets]);

  const activeTimerRows = useMemo(() => {
    const rows: Array<{
      workflowId: string;
      workflowTitle: string;
      workflowStatus: WorkflowExecution['status'];
      workflowBlockedReason: string;
      workflowSlaState: 'ok' | 'risk' | 'overdue';
      ticketId: string;
      ticketCategory: string;
      taskId: string;
      taskTitle: string;
      taskType: WorkflowTask['type'];
      awaitingUntilMs: number;
      countdown: string;
      overdue: boolean;
    }> = [];

    const workflowList = Array.isArray(workflows) ? workflows : [];
    workflowList.forEach((workflow) => {
      if (workflow.status !== 'RUNNING' && workflow.status !== 'PAUSED') return;
      const tasks = Array.isArray(workflow.tasks) ? workflow.tasks : [];
      tasks.forEach((task) => {
        if (task.status !== 'RUNNING') return;
        const awaitingUntilMs = parseTaskAwaitingUntilMs(task);
        if (awaitingUntilMs === null) return;
        const ticket = workflow.ticketId ? ticketById.get(workflow.ticketId) : null;
        rows.push({
          workflowId: workflow.id,
          workflowTitle: workflow.title || 'Workflow',
          workflowStatus: workflow.status,
          workflowBlockedReason: workflow.blockedReason || 'none',
          workflowSlaState: workflow.health?.slaState || 'ok',
          ticketId: workflow.ticketId,
          ticketCategory: ticket?.category || workflow.category || '–',
          taskId: task.id,
          taskTitle: task.title || task.type,
          taskType: task.type,
          awaitingUntilMs,
          countdown: formatTimerCountdown(awaitingUntilMs, timerNowMs),
          overdue: awaitingUntilMs < timerNowMs,
        });
      });
    });

    return rows.sort((a, b) => a.awaitingUntilMs - b.awaitingUntilMs);
  }, [workflows, ticketById, timerNowMs]);

  const workflowSlaDistribution = useMemo(() => {
    const counters = { ok: 0, risk: 0, overdue: 0 };
    workflows.forEach((workflow) => {
      const state = workflow.health?.slaState || 'ok';
      if (state === 'risk' || state === 'overdue') {
        counters[state] += 1;
      } else {
        counters.ok += 1;
      }
    });
    return counters;
  }, [workflows]);

  const myTicketsSorted = useMemo(
    () => [...(Array.isArray(myTickets) ? myTickets : [])].sort((a, b) => parseDate(b.createdAt) - parseDate(a.createdAt)),
    [myTickets]
  );

  const myTicketStatusCounts = useMemo(() => {
    const counters = {
      total: myTicketsSorted.length,
      open: 0,
      inProgress: 0,
      waiting: 0,
      closed: 0,
    };
    myTicketsSorted.forEach((ticket) => {
      if (ticket.status === 'closed' || ticket.status === 'completed') {
        counters.closed += 1;
        return;
      }
      if (ticket.status === 'in-progress') {
        counters.inProgress += 1;
        return;
      }
      if (ticket.status === 'pending' || ticket.status === 'pending_validation') {
        counters.waiting += 1;
        return;
      }
      counters.open += 1;
    });
    return counters;
  }, [myTicketsSorted]);

  const kpiCards = useMemo<DashboardKpiCard[]>(() => {
    if (!stats) return [];
    const databaseLabel =
      stats.database?.label ||
      (stats.database?.client === 'sqlite'
        ? 'SQLite'
        : stats.database?.client === 'mysql'
        ? 'MySQL'
        : 'Unbekannt');
    const databaseConnection = stats.database?.connection || 'n/a';
    return [
      {
        key: 'database',
        value: databaseLabel,
        label: 'Aktive Datenbank',
        icon: 'fa-database',
        tone: 'primary',
        hint: databaseConnection,
      },
      {
        key: 'totalSubmissions',
        value: stats.totalSubmissions,
        label: 'Gesamt Meldungen',
        icon: 'fa-inbox',
        tone: 'primary',
      },
      {
        key: 'openTickets',
        value: stats.openTickets,
        label: 'Offene Tickets',
        icon: 'fa-folder-open',
        tone: 'warning',
      },
      {
        key: 'closedTickets',
        value: stats.closedTickets,
        label: 'Geschlossene Tickets',
        icon: 'fa-circle-check',
        tone: 'success',
      },
      {
        key: 'avgResolution',
        value: `${stats.averageResolutionTime}h`,
        label: 'Ø Bearbeitungszeit',
        icon: 'fa-hourglass-half',
        tone: 'neutral',
      },
      {
        key: 'slaOk',
        value: workflowSlaDistribution.ok,
        label: 'Workflows SLA im Ziel',
        icon: 'fa-shield-halved',
        tone: 'success',
      },
      {
        key: 'slaRisk',
        value: workflowSlaDistribution.risk,
        label: 'Workflows SLA gefährdet',
        icon: 'fa-triangle-exclamation',
        tone: 'warning',
      },
      {
        key: 'slaOverdue',
        value: workflowSlaDistribution.overdue,
        label: 'Workflows SLA überfällig',
        icon: 'fa-fire',
        tone: 'danger',
      },
    ];
  }, [stats, workflowSlaDistribution]);

  const blockedWorkflows = useMemo(
    () =>
      workflows
        .filter((workflow) => (workflow.blockedReason || 'none') !== 'none')
        .map((workflow) => ({
          id: workflow.id,
          title: workflow.title || 'Workflow',
          ticketId: workflow.ticketId,
          blockedReason: workflow.blockedReason || 'none',
          slaState: workflow.health?.slaState || 'ok',
          startedAt: workflow.startedAt,
        }))
        .sort((a, b) => parseDate(b.startedAt) - parseDate(a.startedAt))
        .slice(0, 8),
    [workflows]
  );

  const sortedTickets = useMemo(() => {
    return [...filteredTickets].sort((a, b) => {
      let aValue: string | number = '';
      let bValue: string | number = '';

      switch (sortKey) {
        case 'status':
          aValue = Math.max(0, STATUS_ORDER.indexOf(a.status));
          bValue = Math.max(0, STATUS_ORDER.indexOf(b.status));
          break;
        case 'priority':
          aValue = Math.max(0, PRIORITY_ORDER.indexOf(a.priority));
          bValue = Math.max(0, PRIORITY_ORDER.indexOf(b.priority));
          break;
        case 'category':
          aValue = (a.category || '').toLowerCase();
          bValue = (b.category || '').toLowerCase();
          break;
        case 'location':
          aValue = (a.city || a.address || '').toLowerCase();
          bValue = (b.city || b.address || '').toLowerCase();
          break;
        case 'createdAt':
        default:
          aValue = parseDate(a.createdAt);
          bValue = parseDate(b.createdAt);
      }

      let result = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        result = aValue.localeCompare(bValue, 'de', { sensitivity: 'base' });
      } else {
        result = Number(aValue) - Number(bValue);
      }

      return sortDirection === 'asc' ? result : -result;
    });
  }, [filteredTickets, sortKey, sortDirection]);

  const total = sortedTickets.length;
  const selection = useTableSelection(sortedTickets);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pageItems = sortedTickets.slice(start, start + pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const setSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection('asc');
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '↕';
    return sortDirection === 'asc' ? '▲' : '▼';
  };

  const formatDate = (value: string) => {
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

  const formatDateTimeFromMs = (timestampMs: number) =>
    new Date(timestampMs).toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  const formatCompactDateTime = (timestampMs: number) =>
    new Date(timestampMs).toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const handleBulkDelete = async () => {
    if (!admin) return;
    if (selection.selectedRows.length === 0) {
      setError('Keine Tickets ausgewählt.');
      return;
    }
    if (!window.confirm(`${selection.selectedRows.length} Ticket(s) wirklich löschen?`)) {
      return;
    }
    setBulkLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const ids = selection.selectedRows.map((ticket) => ticket.id);
      const results = await Promise.allSettled(
        ids.map((id) => axios.delete(`/api/tickets/${id}`, { headers }).then(() => id))
      );
      const deletedIds = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map((result) => result.value);
      const failed = results.length - deletedIds.length;
      if (deletedIds.length > 0) {
        setTickets((prev) => prev.filter((ticket) => !deletedIds.includes(ticket.id)));
      }
      if (failed > 0) {
        setError(`${deletedIds.length} Ticket(s) gelöscht, ${failed} fehlgeschlagen.`);
      }
      selection.clearSelection();
    } catch {
      setError('Fehler beim Löschen der ausgewählten Tickets');
    } finally {
      setBulkLoading(false);
    }
  };

  const ticketColumns = useMemo<SmartTableColumnDef<Ticket>[]>(
    () => [
      {
        field: 'id',
        headerName: 'Ticket',
        minWidth: 120,
        renderCell: (params) => <code className="ticket-id">{String(params.row.id || '').slice(0, 8)}</code>,
      },
      {
        field: 'submissionId',
        headerName: 'Submission',
        minWidth: 190,
        defaultVisible: false,
      },
      {
        field: 'category',
        headerName: 'Kategorie',
        minWidth: 200,
        flex: 1,
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 170,
        renderCell: (params) => (
          <span className={`status-pill status-${params.row.status}`}>
            {STATUS_LABELS[params.row.status] || params.row.status}
          </span>
        ),
      },
      {
        field: 'priority',
        headerName: 'Priorität',
        minWidth: 130,
      },
      {
        field: 'location',
        headerName: 'Ort',
        minWidth: 200,
        flex: 1,
        valueGetter: (_value, row) => row.city || row.address || '–',
      },
      {
        field: 'imageCount',
        headerName: 'Bilder',
        minWidth: 100,
        renderCell: (params) =>
          params.row.hasImages ? (
            <span className="attachment-indicator has-images" title={`${params.row.imageCount || 1} Bild(er)`}>
              <i className="fa-solid fa-paperclip" /> {params.row.imageCount || 1}
            </span>
          ) : (
            <span className="attachment-indicator no-images">–</span>
          ),
      },
      {
        field: 'primaryAssigneeUserId',
        headerName: 'Assignee User',
        minWidth: 170,
        defaultVisible: false,
        valueGetter: (_value, row) => row.primaryAssigneeUserId || '–',
      },
      {
        field: 'assignedTo',
        headerName: 'Zugewiesen an',
        minWidth: 200,
        defaultVisible: false,
        valueGetter: (_value, row) =>
          row.primaryAssigneeUserId ||
          row.primaryAssigneeOrgUnitId ||
          row.assignedTo ||
          '–',
      },
      {
        field: 'primaryAssigneeOrgUnitId',
        headerName: 'Assignee Org',
        minWidth: 170,
        defaultVisible: false,
        valueGetter: (_value, row) => row.primaryAssigneeOrgUnitId || '–',
      },
      {
        field: 'owningOrgUnitId',
        headerName: 'Owning Org',
        minWidth: 170,
        defaultVisible: false,
        valueGetter: (_value, row) => row.owningOrgUnitId || '–',
      },
      {
        field: 'createdAt',
        headerName: 'Erstellt',
        minWidth: 170,
        valueFormatter: (value) => formatDate(String(value || '')),
      },
      {
        field: 'actions',
        headerName: 'Aktion',
        minWidth: 96,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        hideable: false,
        renderCell: (params) => (
          <SmartTableRowActions>
            <SmartTableRowActionButton
              label="Ticket öffnen"
              icon={<OpenInNewRoundedIcon fontSize="inherit" />}
              tone="primary"
              onClick={() => {
                navigate(`/tickets/${params.row.id}`);
              }}
            />
          </SmartTableRowActions>
        ),
      },
    ],
    [navigate]
  );

  if (isLoading) return <div className="loading">Lädt...</div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Dashboard Übersicht</h2>
          <p className="dashboard-subtitle">
            Zentrale Startseite mit Schnellzugriff, Status und den wichtigsten Tickets.
          </p>
        </div>
        <div className="dashboard-header-chip">
          <span className="dashboard-header-chip-title">
            <i className="fa-solid fa-arrows-rotate" /> Live-Synchronisierung
          </span>
          <span className="dashboard-header-chip-value">
            {lastSyncAt ? `Letztes Update: ${formatCompactDateTime(lastSyncAt)}` : 'Wird aktualisiert...'}
          </span>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <section className="dashboard-panel">
        <div className="panel-header">
          <h3>Zuständigkeit abfragen</h3>
          <span className="panel-hint">Verwaltungs-Zuständigkeitsprüfung</span>
        </div>
        <div className="quick-actions">
          <input
            className="input w-full"
            placeholder="Anliegen oder Stichworte eingeben (z. B. Straßenbeleuchtung defekt in Otterbach)"
            value={responsibilityQuery}
            onChange={(event) => setResponsibilityQuery(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={responsibilityLoading || !responsibilityQuery.trim()}
            onClick={() => void runResponsibilityQuery()}
          >
            <i className={`fa-solid ${responsibilityLoading ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}`} /> Prüfen
          </button>
        </div>
        {responsibilityResult.length > 0 ? (
          <div className="ticket-list">
            {responsibilityResult.map((entry) => (
              <div key={`${entry.type}-${entry.id}`} className="ticket-row">
                <div className="ticket-row-header">
                  <span className="ticket-id">{entry.name}</span>
                  <span className="status-pill status-open">
                    {Math.round(Math.max(0, Math.min(1, Number(entry.confidence || 0))) * 100)}%
                  </span>
                </div>
                <div className="ticket-row-meta">
                  <span>{entry.type === 'user' ? 'Benutzer' : 'Organisationseinheit'}</span>
                  <span>{entry.id}</span>
                  <span>{entry.reasoning || 'Regelbasiertes Matching'}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="timer-empty">Noch keine Abfrage durchgeführt.</p>
        )}
      </section>

      <section className="dashboard-panel my-tickets-panel">
        <div className="panel-header">
          <h3>Meine Tickets</h3>
          <Link className="panel-link" to="/tickets">
            Ticketübersicht
          </Link>
        </div>
        <div className="my-ticket-kpis">
          <span className="my-ticket-kpi total">
            <i className="fa-solid fa-user-check" /> {myTicketStatusCounts.total} zugeordnet
          </span>
          <span className="my-ticket-kpi open">
            <i className="fa-solid fa-folder-open" /> {myTicketStatusCounts.open} offen
          </span>
          <span className="my-ticket-kpi progress">
            <i className="fa-solid fa-person-digging" /> {myTicketStatusCounts.inProgress} in Bearbeitung
          </span>
          <span className="my-ticket-kpi waiting">
            <i className="fa-solid fa-hourglass-half" /> {myTicketStatusCounts.waiting} wartend
          </span>
          <span className="my-ticket-kpi closed">
            <i className="fa-solid fa-circle-check" /> {myTicketStatusCounts.closed} erledigt
          </span>
        </div>
        {myTicketsSorted.length === 0 ? (
          <p className="timer-empty">Dir sind aktuell keine Tickets direkt zugewiesen.</p>
        ) : (
          <div className="ticket-list">
            {myTicketsSorted.slice(0, 8).map((ticket) => (
              <Link key={`my-ticket-${ticket.id}`} to={`/tickets/${ticket.id}`} className="ticket-row my-ticket-row">
                <div className="ticket-row-header">
                  <code className="ticket-id">{ticket.id.slice(0, 8)}</code>
                  <span className={`status-pill status-${ticket.status}`}>
                    {STATUS_LABELS[ticket.status] || ticket.status}
                  </span>
                </div>
                <div className="ticket-row-meta">
                  <span>{ticket.category || '–'}</span>
                  <span>{ticket.city || ticket.address || '–'}</span>
                  <span>{formatDate(ticket.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {kpiCards.length > 0 && (
        <div className="stats-grid">
          {kpiCards.map((card) => (
            <div key={card.key} className={`stat-card stat-${card.tone}`}>
              <div className="stat-head">
                <span className="stat-icon">
                  <i className={`fa-solid ${card.icon}`} />
                </span>
                <span className="stat-label">{card.label}</span>
              </div>
              <div className="stat-value">{card.value}</div>
              {card.hint && <div className="stat-meta">{card.hint}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="dashboard-grid">
        <section className="dashboard-panel">
          <div className="panel-header">
            <h3>Schnellzugriff</h3>
            <span className="panel-hint">Häufig genutzte Bereiche</span>
          </div>
          <div className="widget-grid">
            <Link to="/analytics" className="widget-card">
              <span className="widget-icon"><i className="fa-solid fa-chart-pie" /></span>
              <div>
                <div className="widget-title">Statistiken</div>
                <div className="widget-desc">Orte, Zeiten, Kategorien analysieren</div>
              </div>
            </Link>
            <Link to="/tickets" className="widget-card">
              <span className="widget-icon"><i className="fa-solid fa-ticket" /></span>
              <div>
                <div className="widget-title">Tickets</div>
                <div className="widget-desc">Suchen, filtern, bearbeiten</div>
              </div>
            </Link>
            <Link to="/map" className="widget-card">
              <span className="widget-icon"><i className="fa-solid fa-map-location-dot" /></span>
              <div>
                <div className="widget-title">Karte/GIS</div>
                <div className="widget-desc">Lagebild, Selektion, Geodaten</div>
              </div>
            </Link>
            <Link to="/workflows" className="widget-card">
              <span className="widget-icon"><i className="fa-solid fa-diagram-project" /></span>
              <div>
                <div className="widget-title">Workflow-Instanzen</div>
                <div className="widget-desc">Abläufe überwachen</div>
              </div>
            </Link>
            {admin && (
              <Link to="/admin-settings/ai-situation" className="widget-card">
                <span className="widget-icon"><i className="fa-solid fa-chart-line" /></span>
                <div>
                  <div className="widget-title">KI-Lagebild</div>
                  <div className="widget-desc">Aktuelle Lageberichte öffnen</div>
                </div>
              </Link>
            )}
            {admin && (
              <Link to="/admin-settings/categories" className="widget-card">
                <span className="widget-icon"><i className="fa-solid fa-tags" /></span>
                <div>
                  <div className="widget-title">Kategorien</div>
                  <div className="widget-desc">Kategorielogik und Prompt</div>
                </div>
              </Link>
            )}
            <Link to="/mail-queue" className="widget-card">
              <span className="widget-icon"><i className="fa-solid fa-envelope" /></span>
              <div>
                <div className="widget-title">Mail Queue</div>
                <div className="widget-desc">Status, Retry, Neuversand</div>
              </div>
            </Link>
            {admin && (
              <Link to="/sessions" className="widget-card">
                <span className="widget-icon"><i className="fa-solid fa-user-shield" /></span>
                <div>
                  <div className="widget-title">Sessions</div>
                  <div className="widget-desc">Aktive Logins und Cookies</div>
                </div>
              </Link>
            )}
            {admin && (
              <Link to="/journal" className="widget-card">
                <span className="widget-icon"><i className="fa-solid fa-book" /></span>
                <div>
                  <div className="widget-title">Journal</div>
                  <div className="widget-desc">Login-/API-Ereignisse</div>
                </div>
              </Link>
            )}
          </div>
        </section>

        {admin && (
          <section className="dashboard-panel">
            <div className="panel-header">
              <h3>Neueste KI-Lageberichte</h3>
              <Link className="panel-link" to="/admin-settings/ai-situation">
                Alle öffnen
              </Link>
            </div>
            {latestSituationReports.length === 0 ? (
              <p className="timer-empty">Noch keine gespeicherten KI-Lageberichte vorhanden.</p>
            ) : (
              <div className="ticket-list">
                {latestSituationReports.map((report) => (
                  <Link key={report.id} to={`/admin-settings/ai-situation?reportId=${encodeURIComponent(report.id)}`} className="ticket-row">
                    <div className="ticket-row-header">
                      <code className="ticket-id">{report.id.slice(0, 16)}</code>
                      <span className="status-pill status-open">{report.ticketCount || 0} Tickets</span>
                    </div>
                    <div className="ticket-row-meta">
                      <span>Scope: {report.scopeKey || '–'}</span>
                      <span>{report.createdAt ? formatDate(report.createdAt) : '–'}</span>
                    </div>
                    <div className="ticket-row-title">
                      {(report.summary || 'Keine Zusammenfassung verfügbar.').slice(0, 180)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="dashboard-panel dashboard-panel-full">
          <div className="panel-header">
            <h3>Tickets</h3>
            <span className="panel-hint">
              Suchbar, sortierbar, filterbar, paginiert
            </span>
          </div>

          <div className="dashboard-controls">
            <div className="control-group">
              <label>Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">Alle</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="control-group grow">
              <label>Suche</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ticket-ID, Kategorie, Ort..."
              />
            </div>
            <div className="control-group">
              <label>Pro Seite</label>
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}>
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>

          {pageItems.length === 0 ? (
            <p className="no-tickets">Keine Tickets gefunden.</p>
          ) : (
            <>
              {admin && selection.selectedCount > 0 && (
                <div className="bulk-actions-bar">
                  <div className="bulk-actions-meta">
                    <span className="count">{selection.selectedCount}</span>
                    <span>ausgewählt</span>
                  </div>
                  <div className="bulk-actions-buttons">
                    <button className="bulk-btn danger" type="button" onClick={handleBulkDelete} disabled={bulkLoading}>
                      <i className="fa-solid fa-trash" /> Löschen
                    </button>
                    <button className="bulk-btn" type="button" onClick={selection.clearSelection} disabled={bulkLoading}>
                      Auswahl aufheben
                    </button>
                  </div>
                </div>
              )}
              <SmartTable<Ticket>
                tableId="dashboard-tickets"
                userId={token}
                title="Tickets"
                rows={pageItems}
                columns={ticketColumns}
                loading={isLoading}
                checkboxSelection={admin}
                selectionModel={selection.selectedIds}
                onSelectionModelChange={(ids) => selection.setSelectedIds(ids)}
                onRefresh={() => {
                  void fetchData();
                }}
                liveState={liveConnectionState}
                lastEventAt={liveLastEventAt}
                lastSyncAt={lastSyncAt ? new Date(lastSyncAt).toISOString() : null}
                isRefreshing={isLiveRefreshing}
                defaultPageSize={pageSize}
                pageSizeOptions={[5, 10, 20, 50]}
                disableRowSelectionOnClick
              />
            </>
          )}

          <div className="dashboard-pagination">
            <span>
              Zeige {total === 0 ? 0 : start + 1}-{Math.min(start + pageSize, total)} von {total}
            </span>
            <div className="pagination-actions">
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
        </section>
      </div>

      <section className="dashboard-panel">
        <div className="panel-header">
          <h3>Blockierte Workflows</h3>
          <span className="panel-hint">{blockedWorkflows.length} sichtbar</span>
        </div>
        {blockedWorkflows.length === 0 ? (
          <p className="timer-empty">Aktuell sind keine Workflows mit Blocker gemeldet.</p>
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Ticket</th>
                  <th>Blocker</th>
                  <th>SLA</th>
                  <th>Start</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {blockedWorkflows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="timer-workflow-title">{row.title}</div>
                      <div className="timer-workflow-id">{row.id.slice(0, 12)}</div>
                    </td>
                    <td>
                      <code className="ticket-id">{row.ticketId?.slice(0, 8) || '–'}</code>
                    </td>
                    <td>{WORKFLOW_BLOCKED_REASON_LABELS[row.blockedReason] || row.blockedReason}</td>
                    <td>
                      <span className={`timer-countdown-chip ${row.slaState === 'overdue' ? 'is-overdue' : 'is-running'}`}>
                        {WORKFLOW_SLA_LABELS[row.slaState as 'ok' | 'risk' | 'overdue'] || WORKFLOW_SLA_LABELS.ok}
                      </span>
                    </td>
                    <td>{formatDate(row.startedAt)}</td>
                    <td>
                      {row.ticketId ? (
                        <Link className="panel-link" to={`/tickets/${row.ticketId}`}>
                          Ticket öffnen
                        </Link>
                      ) : (
                        <Link className="panel-link" to="/workflows">
                          Workflows
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dashboard-panel timer-panel">
        <div className="panel-header">
          <h3>Aktive laufende Timer</h3>
          <span className="panel-hint">
            {activeTimerRows.length} aktiv · Live-Countdown
          </span>
        </div>
        {activeTimerRows.length === 0 ? (
          <p className="timer-empty">Aktuell laufen keine Timer in Workflow-Schritten.</p>
        ) : (
          <div className="dashboard-table-wrap timer-table-wrap">
            <table className="dashboard-table timer-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Ticket</th>
                  <th>Schritt</th>
                  <th>Fällig um</th>
                  <th>Restzeit</th>
                  <th>Status</th>
                  <th>SLA</th>
                  <th>Blocker</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {activeTimerRows.map((row) => (
                  <tr key={`${row.workflowId}-${row.taskId}`}>
                    <td>
                      <div className="timer-workflow-title">{row.workflowTitle}</div>
                      <div className="timer-workflow-id">{row.workflowId.slice(0, 12)}</div>
                    </td>
                    <td>
                      <div className="timer-ticket-main">
                        <code className="ticket-id">{row.ticketId.slice(0, 8)}</code>
                      </div>
                      <div className="timer-ticket-category">{row.ticketCategory}</div>
                    </td>
                    <td>
                      <div className="timer-task-title">{row.taskTitle}</div>
                      <div className="timer-task-type">{WORKFLOW_TASK_LABELS[row.taskType] || row.taskType}</div>
                    </td>
                    <td>{formatDateTimeFromMs(row.awaitingUntilMs)}</td>
                    <td>
                      <span className={`timer-countdown-chip ${row.overdue ? 'is-overdue' : 'is-running'}`}>
                        <i className={`fa-solid ${row.overdue ? 'fa-triangle-exclamation' : 'fa-stopwatch'}`} />
                        {row.countdown}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill status-${row.workflowStatus.toLowerCase()}`}>
                        {WORKFLOW_STATUS_LABELS[row.workflowStatus]}
                      </span>
                    </td>
                    <td>
                      <span className={`timer-countdown-chip ${row.workflowSlaState === 'overdue' ? 'is-overdue' : 'is-running'}`}>
                        {WORKFLOW_SLA_LABELS[row.workflowSlaState]}
                      </span>
                    </td>
                    <td>{WORKFLOW_BLOCKED_REASON_LABELS[row.workflowBlockedReason] || row.workflowBlockedReason}</td>
                    <td>
                      <div className="timer-actions">
                        <Link className="panel-link" to={`/tickets/${row.ticketId}`}>
                          Ticket
                        </Link>
                        <Link className="panel-link" to="/workflows">
                          Workflows
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
