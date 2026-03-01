import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import AnalyticsRoundedIcon from '@mui/icons-material/AnalyticsRounded';
import ConfirmationNumberRoundedIcon from '@mui/icons-material/ConfirmationNumberRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import AutoGraphRoundedIcon from '@mui/icons-material/AutoGraphRounded';
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';
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
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';

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
  startedAt?: string;
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

interface BlockedWorkflowRow {
  id: string;
  title: string;
  ticketId: string;
  blockedReason: string;
  slaState: 'ok' | 'risk' | 'overdue';
  startedAt: string;
}

interface ActiveTimerRow {
  id: string;
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
}

interface DashboardKpiCard {
  key: string;
  value: string | number;
  label: string;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  hint?: string;
}

interface QuickLinkItem {
  id: string;
  title: string;
  description: string;
  to: string;
  icon: React.ReactNode;
}

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

const statusChipColor = (status: Ticket['status']): 'default' | 'info' | 'warning' | 'success' => {
  if (status === 'pending_validation' || status === 'assigned') return 'info';
  if (status === 'in-progress' || status === 'pending') return 'warning';
  if (status === 'completed' || status === 'closed') return 'success';
  return 'default';
};

const workflowStatusChipColor = (status: WorkflowExecution['status']): 'default' | 'info' | 'warning' | 'success' | 'error' => {
  if (status === 'RUNNING') return 'info';
  if (status === 'PAUSED') return 'warning';
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED') return 'error';
  return 'default';
};

const workflowSlaChipColor = (state: 'ok' | 'risk' | 'overdue'): 'success' | 'warning' | 'error' => {
  if (state === 'risk') return 'warning';
  if (state === 'overdue') return 'error';
  return 'success';
};

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
    } catch {
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

  const parseDate = (value?: string) => {
    if (!value) return 0;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  };

  const filteredTickets = useMemo(() => {
    return (Array.isArray(tickets) ? tickets : []).filter((ticket) => {
      const statusOk = statusFilter === 'all' || ticket.status === statusFilter;
      return statusOk;
    });
  }, [tickets, statusFilter]);

  const ticketById = useMemo(() => {
    const map = new Map<string, Ticket>();
    (Array.isArray(tickets) ? tickets : []).forEach((ticket) => map.set(ticket.id, ticket));
    return map;
  }, [tickets]);

  const activeTimerRows = useMemo(() => {
    const rows: ActiveTimerRow[] = [];

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
          id: `${workflow.id}:${task.id}`,
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
        tone: 'primary',
        hint: databaseConnection,
      },
      {
        key: 'totalSubmissions',
        value: stats.totalSubmissions,
        label: 'Gesamt Meldungen',
        tone: 'primary',
      },
      {
        key: 'openTickets',
        value: stats.openTickets,
        label: 'Offene Tickets',
        tone: 'warning',
      },
      {
        key: 'closedTickets',
        value: stats.closedTickets,
        label: 'Geschlossene Tickets',
        tone: 'success',
      },
      {
        key: 'avgResolution',
        value: `${stats.averageResolutionTime}h`,
        label: 'Ø Bearbeitungszeit',
        tone: 'neutral',
      },
      {
        key: 'slaOk',
        value: workflowSlaDistribution.ok,
        label: 'Workflows SLA im Ziel',
        tone: 'success',
      },
      {
        key: 'slaRisk',
        value: workflowSlaDistribution.risk,
        label: 'Workflows SLA gefährdet',
        tone: 'warning',
      },
      {
        key: 'slaOverdue',
        value: workflowSlaDistribution.overdue,
        label: 'Workflows SLA überfällig',
        tone: 'danger',
      },
    ];
  }, [stats, workflowSlaDistribution]);

  const blockedWorkflows = useMemo<BlockedWorkflowRow[]>(
    () =>
      workflows
        .filter((workflow) => (workflow.blockedReason || 'none') !== 'none')
        .map((workflow) => ({
          id: workflow.id,
          title: workflow.title || 'Workflow',
          ticketId: workflow.ticketId,
          blockedReason: workflow.blockedReason || 'none',
          slaState: workflow.health?.slaState || 'ok',
          startedAt: workflow.startedAt || '',
        }))
        .sort((a, b) => parseDate(b.startedAt) - parseDate(a.startedAt))
        .slice(0, 8),
    [workflows]
  );

  const sortedTickets = useMemo(
    () =>
      [...filteredTickets].sort((a, b) => {
        const priorityDiff =
          Math.max(0, PRIORITY_ORDER.indexOf(a.priority)) - Math.max(0, PRIORITY_ORDER.indexOf(b.priority));
        if (priorityDiff !== 0) return priorityDiff;
        const statusDiff = Math.max(0, STATUS_ORDER.indexOf(a.status)) - Math.max(0, STATUS_ORDER.indexOf(b.status));
        if (statusDiff !== 0) return statusDiff;
        return parseDate(b.createdAt) - parseDate(a.createdAt);
      }),
    [filteredTickets]
  );

  const selection = useTableSelection(sortedTickets);

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
        renderCell: (params) => (
          <Typography component="code" sx={codeSx}>
            {String(params.row.id || '').slice(0, 8)}
          </Typography>
        ),
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
          <Chip
            size="small"
            color={statusChipColor(params.row.status)}
            variant="filled"
            label={STATUS_LABELS[params.row.status] || params.row.status}
          />
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
        minWidth: 120,
        renderCell: (params) =>
          params.row.hasImages ? (
            <Chip
              size="small"
              color="info"
              icon={<AttachFileRoundedIcon fontSize="small" />}
              label={params.row.imageCount || 1}
              variant="outlined"
            />
          ) : (
            <Typography color="text.secondary">–</Typography>
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

  const blockedWorkflowColumns = useMemo<SmartTableColumnDef<BlockedWorkflowRow>[]>(
    () => [
      {
        field: 'title',
        headerName: 'Workflow',
        minWidth: 220,
        flex: 1,
        renderCell: (params) => (
          <Stack spacing={0.3}>
            <Typography fontWeight={700} variant="body2">{params.row.title}</Typography>
            <Typography component="code" sx={codeSx}>{params.row.id.slice(0, 12)}</Typography>
          </Stack>
        ),
      },
      {
        field: 'ticketId',
        headerName: 'Ticket',
        minWidth: 120,
        renderCell: (params) => (
          <Typography component="code" sx={codeSx}>{params.row.ticketId?.slice(0, 8) || '–'}</Typography>
        ),
      },
      {
        field: 'blockedReason',
        headerName: 'Blocker',
        minWidth: 190,
        valueFormatter: (value) => WORKFLOW_BLOCKED_REASON_LABELS[String(value || '')] || String(value || '–'),
      },
      {
        field: 'slaState',
        headerName: 'SLA',
        minWidth: 140,
        renderCell: (params) => (
          <Chip
            size="small"
            color={workflowSlaChipColor(params.row.slaState)}
            label={WORKFLOW_SLA_LABELS[params.row.slaState] || WORKFLOW_SLA_LABELS.ok}
          />
        ),
      },
      {
        field: 'startedAt',
        headerName: 'Start',
        minWidth: 160,
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
              label={params.row.ticketId ? 'Ticket öffnen' : 'Workflows öffnen'}
              icon={<OpenInNewRoundedIcon fontSize="inherit" />}
              tone="primary"
              onClick={() => {
                if (params.row.ticketId) {
                  navigate(`/tickets/${params.row.ticketId}`);
                  return;
                }
                navigate('/workflows');
              }}
            />
          </SmartTableRowActions>
        ),
      },
    ],
    [navigate]
  );

  const activeTimerColumns = useMemo<SmartTableColumnDef<ActiveTimerRow>[]>(
    () => [
      {
        field: 'workflowTitle',
        headerName: 'Workflow',
        minWidth: 220,
        flex: 1,
        renderCell: (params) => (
          <Stack spacing={0.3}>
            <Typography fontWeight={700} variant="body2">{params.row.workflowTitle}</Typography>
            <Typography component="code" sx={codeSx}>{params.row.workflowId.slice(0, 12)}</Typography>
          </Stack>
        ),
      },
      {
        field: 'ticketId',
        headerName: 'Ticket',
        minWidth: 170,
        renderCell: (params) => (
          <Stack spacing={0.3}>
            <Typography component="code" sx={codeSx}>{params.row.ticketId.slice(0, 8)}</Typography>
            <Typography variant="caption" color="text.secondary">{params.row.ticketCategory}</Typography>
          </Stack>
        ),
      },
      {
        field: 'taskTitle',
        headerName: 'Schritt',
        minWidth: 210,
        flex: 1,
        renderCell: (params) => (
          <Stack spacing={0.3}>
            <Typography fontWeight={600} variant="body2">{params.row.taskTitle}</Typography>
            <Typography variant="caption" color="text.secondary">
              {WORKFLOW_TASK_LABELS[params.row.taskType] || params.row.taskType}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'awaitingUntilMs',
        headerName: 'Fällig um',
        minWidth: 170,
        valueFormatter: (value) => formatDateTimeFromMs(Number(value || 0)),
      },
      {
        field: 'countdown',
        headerName: 'Restzeit',
        minWidth: 170,
        renderCell: (params) => (
          <Chip
            size="small"
            color={params.row.overdue ? 'warning' : 'info'}
            label={params.row.countdown}
          />
        ),
      },
      {
        field: 'workflowStatus',
        headerName: 'Status',
        minWidth: 130,
        renderCell: (params) => (
          <Chip
            size="small"
            color={workflowStatusChipColor(params.row.workflowStatus)}
            label={WORKFLOW_STATUS_LABELS[params.row.workflowStatus]}
          />
        ),
      },
      {
        field: 'workflowSlaState',
        headerName: 'SLA',
        minWidth: 120,
        renderCell: (params) => (
          <Chip
            size="small"
            color={workflowSlaChipColor(params.row.workflowSlaState)}
            label={WORKFLOW_SLA_LABELS[params.row.workflowSlaState]}
          />
        ),
      },
      {
        field: 'workflowBlockedReason',
        headerName: 'Blocker',
        minWidth: 190,
        valueFormatter: (value) => WORKFLOW_BLOCKED_REASON_LABELS[String(value || '')] || String(value || '–'),
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
                navigate(`/tickets/${params.row.ticketId}`);
              }}
            />
          </SmartTableRowActions>
        ),
      },
    ],
    [navigate]
  );

  const quickLinks = useMemo<QuickLinkItem[]>(() => {
    const base: QuickLinkItem[] = [
      {
        id: 'analytics',
        title: 'Statistiken',
        description: 'Orte, Zeiten und Kategorien analysieren',
        to: '/analytics',
        icon: <AnalyticsRoundedIcon fontSize="small" />,
      },
      {
        id: 'tickets',
        title: 'Tickets',
        description: 'Suchen, filtern und bearbeiten',
        to: '/tickets',
        icon: <ConfirmationNumberRoundedIcon fontSize="small" />,
      },
      {
        id: 'map',
        title: 'Karte / GIS',
        description: 'Lagebild und Geodaten',
        to: '/map',
        icon: <MapRoundedIcon fontSize="small" />,
      },
      {
        id: 'workflows',
        title: 'Workflow-Instanzen',
        description: 'Abläufe überwachen',
        to: '/workflows',
        icon: <AccountTreeRoundedIcon fontSize="small" />,
      },
      {
        id: 'mail-queue',
        title: 'Mail Queue',
        description: 'Status, Retry und Neuversand',
        to: '/mail-queue',
        icon: <MailOutlineRoundedIcon fontSize="small" />,
      },
    ];

    if (admin) {
      base.push(
        {
          id: 'ai-situation',
          title: 'KI-Lagebild',
          description: 'Lageberichte und Trends',
          to: '/admin-settings/ai-situation',
          icon: <AutoGraphRoundedIcon fontSize="small" />,
        },
        {
          id: 'categories',
          title: 'Kategorien',
          description: 'Kategorielogik und Prompting',
          to: '/admin-settings/categories',
          icon: <LocalOfferRoundedIcon fontSize="small" />,
        },
        {
          id: 'sessions',
          title: 'Sessions',
          description: 'Aktive Logins und Geräte',
          to: '/sessions',
          icon: <SecurityRoundedIcon fontSize="small" />,
        },
        {
          id: 'journal',
          title: 'Journal',
          description: 'Login- und API-Ereignisse',
          to: '/journal',
          icon: <MenuBookRoundedIcon fontSize="small" />,
        }
      );
    }

    return base;
  }, [admin]);

  const dashboardKpis = useMemo(
    () =>
      kpiCards.map((card) => ({
        id: card.key,
        label: card.label,
        value: card.value,
        hint: card.hint,
        tone:
          card.tone === 'success'
            ? 'success'
            : card.tone === 'warning'
            ? 'warning'
            : card.tone === 'danger'
            ? 'danger'
            : card.tone === 'primary'
            ? 'info'
            : 'default',
      })),
    [kpiCards]
  );

  if (isLoading) {
    return (
      <Box sx={{ py: 7, textAlign: 'center' }}>
        <Typography color="text.secondary">Dashboard wird geladen...</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      <AdminPageHero
        title="Dashboard"
        subtitle="Operative Übersicht mit Live-Status, Zuständigkeitsprüfung und SmartTable-Ansichten für Tickets und Workflow-Lage."
        icon={<TaskAltRoundedIcon />}
        badges={[
          {
            id: 'live-state',
            label: liveConnectionState === 'live' ? 'Live verbunden' : 'Synchronisierung stellt neu her',
            tone: liveConnectionState === 'live' ? 'success' : 'warning',
          },
          {
            id: 'last-sync',
            label: lastSyncAt ? `Letztes Update: ${formatCompactDateTime(lastSyncAt)}` : 'Wird aktualisiert',
            tone: 'info',
          },
        ]}
        actions={
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={() => {
              void fetchData();
            }}
            disabled={isLiveRefreshing}
          >
            Aktualisieren
          </Button>
        }
      />

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
          gap: 2,
        }}
      >
        <AdminSurfaceCard
          title="Zuständigkeit abfragen"
          subtitle="Verwaltungs-Zuständigkeitsprüfung mit Top-Treffern und Konfidenz."
          actions={
            <Chip
              size="small"
              color="info"
              icon={<SearchRoundedIcon fontSize="small" />}
              label="Sofortabfrage"
              variant="outlined"
            />
          }
        >
          <Stack spacing={1.2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Anliegen"
                placeholder="z. B. Straßenbeleuchtung defekt in Otterbach"
                value={responsibilityQuery}
                onChange={(event) => setResponsibilityQuery(event.target.value)}
              />
              <Button
                variant="contained"
                startIcon={responsibilityLoading ? <CircularProgress size={16} color="inherit" /> : <SearchRoundedIcon />}
                disabled={responsibilityLoading || !responsibilityQuery.trim()}
                onClick={() => {
                  void runResponsibilityQuery();
                }}
                sx={{ minWidth: { sm: 170 }, alignSelf: { sm: 'stretch' } }}
              >
                Prüfen
              </Button>
            </Stack>
            {responsibilityResult.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Noch keine Abfrage durchgeführt.
              </Typography>
            ) : (
              <Stack spacing={0.9}>
                {responsibilityResult.map((entry) => {
                  const pct = Math.round(Math.max(0, Math.min(1, Number(entry.confidence || 0))) * 100);
                  return (
                    <Box
                      key={`${entry.type}-${entry.id}`}
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        p: 1,
                        backgroundColor: 'background.paper',
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Typography variant="body2" fontWeight={700} noWrap>
                          {entry.name}
                        </Typography>
                        <Chip
                          size="small"
                          color={pct >= 80 ? 'success' : pct >= 60 ? 'warning' : 'default'}
                          label={`${pct}%`}
                        />
                      </Stack>
                      <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap sx={{ mt: 0.6 }}>
                        <Chip size="small" variant="outlined" label={entry.type === 'user' ? 'Benutzer' : 'Organisationseinheit'} />
                        <Chip size="small" variant="outlined" label={entry.id} />
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                        {entry.reasoning || 'Regelbasiertes Matching'}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Stack>
        </AdminSurfaceCard>

        <AdminSurfaceCard
          title="Meine Tickets"
          subtitle="Direkt zugewiesene Tickets mit aktuellem Bearbeitungsstand."
          actions={
            <Button component={Link} to="/tickets" size="small" endIcon={<OpenInNewRoundedIcon />}>
              Ticketübersicht
            </Button>
          }
        >
          <Stack spacing={1}>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.7}>
              <Chip size="small" color="info" label={`${myTicketStatusCounts.total} zugeordnet`} />
              <Chip size="small" color="default" label={`${myTicketStatusCounts.open} offen`} />
              <Chip size="small" color="warning" label={`${myTicketStatusCounts.inProgress} in Bearbeitung`} />
              <Chip size="small" color="info" variant="outlined" label={`${myTicketStatusCounts.waiting} wartend`} />
              <Chip size="small" color="success" label={`${myTicketStatusCounts.closed} erledigt`} />
            </Stack>
            {myTicketsSorted.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Dir sind aktuell keine Tickets direkt zugewiesen.
              </Typography>
            ) : (
              <Stack spacing={0.8}>
                {myTicketsSorted.slice(0, 8).map((ticket) => (
                  <Card key={`my-ticket-${ticket.id}`} variant="outlined">
                    <CardActionArea component={Link} to={`/tickets/${ticket.id}`}>
                      <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                          <Typography component="code" sx={codeSx}>{ticket.id.slice(0, 8)}</Typography>
                          <Chip
                            size="small"
                            color={statusChipColor(ticket.status)}
                            label={STATUS_LABELS[ticket.status] || ticket.status}
                          />
                        </Stack>
                        <Typography variant="body2" sx={{ mt: 0.7 }} noWrap>
                          {ticket.category || '–'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {ticket.city || ticket.address || '–'} · {formatDate(ticket.createdAt)}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>
        </AdminSurfaceCard>
      </Box>

      {dashboardKpis.length > 0 ? <AdminKpiStrip items={dashboardKpis} /> : null}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: admin ? '1.2fr 1fr' : '1fr' },
          gap: 2,
        }}
      >
        <AdminSurfaceCard
          title="Schnellzugriff"
          subtitle="Direkteinstieg in die operativen Bereiche."
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: 1,
            }}
          >
            {quickLinks.map((item) => (
              <Card key={item.id} variant="outlined">
                <CardActionArea component={Link} to={item.to}>
                  <CardContent>
                    <Stack direction="row" spacing={1.1} alignItems="center">
                      <Box
                        sx={{
                          width: 34,
                          height: 34,
                          borderRadius: 1.5,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: 'action.hover',
                          color: 'primary.main',
                        }}
                      >
                        {item.icon}
                      </Box>
                      <Box>
                        <Typography variant="body2" fontWeight={700}>{item.title}</Typography>
                        <Typography variant="caption" color="text.secondary">{item.description}</Typography>
                      </Box>
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </AdminSurfaceCard>

        {admin ? (
          <AdminSurfaceCard
            title="Neueste KI-Lageberichte"
            subtitle="Kompakte Vorschau der letzten Reports."
            actions={
              <Button component={Link} to="/admin-settings/ai-situation" size="small" endIcon={<OpenInNewRoundedIcon />}>
                Alle öffnen
              </Button>
            }
          >
            {latestSituationReports.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Noch keine gespeicherten KI-Lageberichte vorhanden.
              </Typography>
            ) : (
              <Stack spacing={0.9}>
                {latestSituationReports.map((report) => (
                  <Card key={report.id} variant="outlined">
                    <CardActionArea
                      component={Link}
                      to={`/admin-settings/ai-situation?reportId=${encodeURIComponent(report.id)}`}
                    >
                      <CardContent sx={{ py: 1.1, '&:last-child': { pb: 1.1 } }}>
                        <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                          <Typography component="code" sx={codeSx}>
                            {report.id.slice(0, 16)}
                          </Typography>
                          <Chip size="small" color="info" label={`${report.ticketCount || 0} Tickets`} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.7, display: 'block' }}>
                          Scope: {report.scopeKey || '–'} · {report.createdAt ? formatDate(report.createdAt) : '–'}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                          {(report.summary || 'Keine Zusammenfassung verfügbar.').slice(0, 180)}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}
              </Stack>
            )}
          </AdminSurfaceCard>
        ) : null}
      </Box>

      <AdminSurfaceCard
        title="Tickets"
        subtitle="SmartTable-Ansicht mit persistenter Layout-/Spaltenkonfiguration, Suche und Druckansicht."
      >
        {sortedTickets.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Tickets gefunden.
          </Typography>
        ) : (
          <>
            {admin && selection.selectedCount > 0 ? (
              <Alert
                severity="warning"
                sx={{ mb: 1 }}
                action={
                  <Stack direction="row" spacing={0.8}>
                    <Button color="error" size="small" onClick={() => void handleBulkDelete()} disabled={bulkLoading}>
                      Löschen
                    </Button>
                    <Button size="small" onClick={() => selection.clearSelection()} disabled={bulkLoading}>
                      Auswahl aufheben
                    </Button>
                  </Stack>
                }
              >
                {selection.selectedCount} Ticket(s) ausgewählt
              </Alert>
            ) : null}

            <SmartTable<Ticket>
              tableId="dashboard-tickets"
              userId={token}
              title="Tickets"
              rows={sortedTickets}
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
              defaultPageSize={10}
              pageSizeOptions={[5, 10, 20, 50]}
              disableRowSelectionOnClick
              toolbarStartActions={
                <TextField
                  select
                  size="small"
                  label="Status"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  sx={{ minWidth: 190 }}
                >
                  <MenuItem value="all">Alle</MenuItem>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
              }
            />
          </>
        )}
      </AdminSurfaceCard>

      <AdminSurfaceCard
        title="Blockierte Workflows"
        subtitle="Instanzen mit aktivem Blocker oder manuellem Eingriffsbedarf."
        actions={<Chip size="small" color="warning" label={`${blockedWorkflows.length} sichtbar`} />}
      >
        {blockedWorkflows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aktuell sind keine Workflows mit Blocker gemeldet.
          </Typography>
        ) : (
          <SmartTable<BlockedWorkflowRow>
            tableId="dashboard-blocked-workflows"
            userId={token}
            title="Blockierte Workflows"
            rows={blockedWorkflows}
            columns={blockedWorkflowColumns}
            loading={isLoading}
            onRefresh={() => {
              void fetchData();
            }}
            liveState={liveConnectionState}
            lastEventAt={liveLastEventAt}
            lastSyncAt={lastSyncAt ? new Date(lastSyncAt).toISOString() : null}
            isRefreshing={isLiveRefreshing}
            defaultPageSize={8}
            pageSizeOptions={[5, 8, 10, 20]}
            disableRowSelectionOnClick
          />
        )}
      </AdminSurfaceCard>

      <AdminSurfaceCard
        title="Aktive Workflow-Timer"
        subtitle="Live-Countdown für laufende Timer-Schritte mit direktem Ticket-Sprung."
        actions={<Chip size="small" color="info" label={`${activeTimerRows.length} aktiv`} />}
      >
        {activeTimerRows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aktuell laufen keine Timer in Workflow-Schritten.
          </Typography>
        ) : (
          <SmartTable<ActiveTimerRow>
            tableId="dashboard-active-timers"
            userId={token}
            title="Aktive laufende Timer"
            rows={activeTimerRows}
            columns={activeTimerColumns}
            loading={isLoading}
            onRefresh={() => {
              void fetchData();
            }}
            liveState={liveConnectionState}
            lastEventAt={liveLastEventAt}
            lastSyncAt={lastSyncAt ? new Date(lastSyncAt).toISOString() : null}
            isRefreshing={isLiveRefreshing}
            defaultPageSize={10}
            pageSizeOptions={[5, 10, 20, 50]}
            disableRowSelectionOnClick
          />
        )}
      </AdminSurfaceCard>
    </Stack>
  );
};

export default Dashboard;
