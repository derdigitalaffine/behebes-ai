import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { useNavigate } from 'react-router-dom';
import { isAdminRole } from '../lib/auth';
import { subscribeAdminRealtime } from '../lib/realtime';
import { useTableSelection } from '../lib/tableSelection';
import { exportTicketListPdf, type TicketPdfBundle } from '../lib/ticketPdfExport';
import { useAdminScopeContext } from '../lib/adminScopeContext';
import {
  type AssignmentAdminUserOption,
  type AssignmentOrgUnitOption,
  type AssignmentTenantOption,
  buildAssignmentUserLabel,
  loadAssignmentDirectory,
  userCanBeAssignedToTenant,
} from '../lib/assignmentDirectory';
import { AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { loadSmartTableState } from '../modules/smart-table/storage/localStorageAdapter';
import './Tickets.css';

interface Ticket {
  id: string;
  submissionId?: string;
  citizenName?: string;
  citizenEmail?: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending_validation' | 'pending' | 'open' | 'assigned' | 'in-progress' | 'completed' | 'closed';
  address?: string;
  city?: string;
  createdAt: string;
  updatedAt?: string;
  workflowStarted?: boolean;
  workflowStatus?: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | null;
  workflowExecutionId?: string | null;
  workflowTemplateId?: string | null;
  workflowTitle?: string | null;
  imageCount?: number;
  hasImages?: boolean;
  assignedTo?: string | null;
  owningOrgUnitId?: string | null;
  primaryAssigneeUserId?: string | null;
  primaryAssigneeOrgUnitId?: string | null;
  assignmentUpdatedAt?: string | null;
  assignmentUpdatedBy?: string | null;
}

interface WorkflowTemplateOption {
  id: string;
  name: string;
}

interface SelfFeedTokenRecord {
  id: string;
  token: string;
  createdAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

interface SelfFeedTokenResponse {
  scope: 'tickets' | 'ai_situation';
  feedPath: string;
  token: SelfFeedTokenRecord | null;
}

interface TicketCreateDraft {
  citizenName: string;
  citizenEmail: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending_validation' | 'pending' | 'open' | 'assigned' | 'in-progress' | 'completed' | 'closed';
  description: string;
  address: string;
  postalCode: string;
  city: string;
  latitude: string;
  longitude: string;
  tenantId: string;
  responsibilityAuthority: string;
  owningOrgUnitId: string;
  assignmentTarget: string;
  assignedTo: string;
  collaboratorUserIds: string[];
  collaboratorOrgUnitIds: string[];
  startWorkflow: boolean;
  workflowTemplateId: string;
}

const STATUS_VALUES = new Set<Ticket['status']>([
  'pending_validation',
  'pending',
  'open',
  'assigned',
  'in-progress',
  'completed',
  'closed',
]);

const PRIORITY_VALUES = new Set<Ticket['priority']>(['low', 'medium', 'high', 'critical']);
const WORKFLOW_STATUS_VALUES = new Set<NonNullable<Ticket['workflowStatus']>>([
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
]);

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'ja';
  }
  return false;
};

const asStringOrUndefined = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const asStringOrNull = (value: unknown): string | null => {
  const normalized = asStringOrUndefined(value);
  return normalized ?? null;
};

const toNumber = (value: unknown): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
};

const normalizeTicket = (row: any): Ticket | null => {
  if (!row || typeof row !== 'object') return null;

  const id = asStringOrUndefined(row.id) || asStringOrUndefined(row.ticketId) || asStringOrUndefined(row.ticket_id);
  if (!id) return null;

  const statusRaw = asStringOrUndefined(row.status) || 'pending';
  const status = STATUS_VALUES.has(statusRaw as Ticket['status'])
    ? (statusRaw as Ticket['status'])
    : 'pending';

  const priorityRaw = asStringOrUndefined(row.priority) || 'medium';
  const priority = PRIORITY_VALUES.has(priorityRaw as Ticket['priority'])
    ? (priorityRaw as Ticket['priority'])
    : 'medium';

  const workflowStatusRaw = asStringOrUndefined(row.workflowStatus) || asStringOrUndefined(row.workflow_status);
  const workflowStatus = workflowStatusRaw && WORKFLOW_STATUS_VALUES.has(workflowStatusRaw as NonNullable<Ticket['workflowStatus']>)
    ? (workflowStatusRaw as NonNullable<Ticket['workflowStatus']>)
    : null;

  const imageCount = Math.max(0, Math.floor(toNumber(row.imageCount ?? row.image_count)));
  const hasImagesRaw = row.hasImages ?? row.has_images;
  const hasImages = typeof hasImagesRaw === 'undefined' ? imageCount > 0 : parseBoolean(hasImagesRaw);

  return {
    id,
    submissionId: asStringOrUndefined(row.submissionId ?? row.submission_id),
    citizenName: asStringOrUndefined(row.citizenName ?? row.citizen_name),
    citizenEmail: asStringOrUndefined(row.citizenEmail ?? row.citizen_email),
    category: asStringOrUndefined(row.category) || 'Sonstiges',
    priority,
    status,
    address: asStringOrUndefined(row.address),
    city: asStringOrUndefined(row.city),
    createdAt:
      asStringOrUndefined(row.createdAt ?? row.created_at) ||
      asStringOrUndefined(row.updatedAt ?? row.updated_at) ||
      new Date().toISOString(),
    updatedAt: asStringOrUndefined(row.updatedAt ?? row.updated_at),
    workflowStarted: parseBoolean(row.workflowStarted ?? row.workflow_started ?? workflowStatusRaw),
    workflowStatus,
    workflowExecutionId: asStringOrNull(row.workflowExecutionId ?? row.workflow_execution_id),
    workflowTemplateId: asStringOrNull(row.workflowTemplateId ?? row.workflow_template_id),
    workflowTitle: asStringOrNull(row.workflowTitle ?? row.workflow_title),
    imageCount,
    hasImages,
    assignedTo: asStringOrNull(row.assignedTo ?? row.assigned_to),
    owningOrgUnitId: asStringOrNull(row.owningOrgUnitId ?? row.owning_org_unit_id),
    primaryAssigneeUserId: asStringOrNull(row.primaryAssigneeUserId ?? row.primary_assignee_user_id),
    primaryAssigneeOrgUnitId: asStringOrNull(row.primaryAssigneeOrgUnitId ?? row.primary_assignee_org_unit_id),
    assignmentUpdatedAt: asStringOrNull(row.assignmentUpdatedAt ?? row.assignment_updated_at),
    assignmentUpdatedBy: asStringOrNull(row.assignmentUpdatedBy ?? row.assignment_updated_by),
  };
};

const STATUS_LABELS: Record<string, string> = {
  pending_validation: 'Validierung ausstehend',
  pending: 'Ausstehend',
  open: 'Offen',
  assigned: 'Zugewiesen',
  'in-progress': 'In Bearbeitung',
  completed: 'Abgeschlossen',
  closed: 'Geschlossen',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  critical: 'Kritisch',
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
const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  RUNNING: 'Läuft',
  PAUSED: 'Pausiert',
  COMPLETED: 'Abgeschlossen',
  FAILED: 'Fehler',
};
const WORKFLOW_STATUS_ICON: Record<string, string> = {
  RUNNING: 'fa-solid fa-play',
  PAUSED: 'fa-solid fa-pause',
  COMPLETED: 'fa-solid fa-check',
  FAILED: 'fa-solid fa-triangle-exclamation',
};
const DEFAULT_RESPONSIBILITY_AUTHORITIES = [
  'Ortsgemeinde',
  'Verbandsgemeinde / verbandsfreie Gemeinde',
  'Landkreis / kreisfreie Stadt',
  'Landesbehoerde',
];

const mergeOptionLists = (...lists: Array<unknown>): string[] => {
  const seen = new Set<string>();
  const merged: string[] = [];
  lists.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((entry) => {
      const value = String(entry || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(value);
    });
  });
  return merged;
};

const parseAssignmentTarget = (value: string): { userId: string; orgUnitId: string; assignedTo: string } => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { userId: '', orgUnitId: '', assignedTo: '' };
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('user:')) {
    return { userId: trimmed.slice(5).trim(), orgUnitId: '', assignedTo: '' };
  }
  if (lower.startsWith('org:')) {
    return { userId: '', orgUnitId: trimmed.slice(4).trim(), assignedTo: '' };
  }
  if (lower.startsWith('legacy:')) {
    return { userId: '', orgUnitId: '', assignedTo: trimmed.slice(7).trim() };
  }
  return { userId: '', orgUnitId: '', assignedTo: trimmed };
};

type SortKey = 'id' | 'reporter' | 'category' | 'status' | 'priority' | 'location' | 'createdAt';
type SortDirection = 'asc' | 'desc';
type PageSize = 10 | 25 | 50 | 'all';
type PdfOrientation = 'auto' | 'landscape' | 'portrait';

const TICKETS_TABLE_ID = 'tickets-overview';
const TICKETS_PDF_COLUMN_CATALOG: Array<{ field: string; headerName: string; defaultVisible: boolean }> = [
  { field: 'id', headerName: 'Ticket', defaultVisible: true },
  { field: 'reporter', headerName: 'Meldende Person', defaultVisible: true },
  { field: 'citizenEmail', headerName: 'E-Mail', defaultVisible: false },
  { field: 'submissionId', headerName: 'Submission', defaultVisible: false },
  { field: 'assignedTo', headerName: 'Zugewiesen an', defaultVisible: false },
  { field: 'primaryAssigneeUserId', headerName: 'Primär User-ID', defaultVisible: false },
  { field: 'primaryAssigneeOrgUnitId', headerName: 'Primär Org-Unit-ID', defaultVisible: false },
  { field: 'owningOrgUnitId', headerName: 'Owning Org-Unit-ID', defaultVisible: false },
  { field: 'category', headerName: 'Kategorie', defaultVisible: true },
  { field: 'status', headerName: 'Status', defaultVisible: true },
  { field: 'priority', headerName: 'Priorität', defaultVisible: true },
  { field: 'location', headerName: 'Ort', defaultVisible: true },
  { field: 'createdAt', headerName: 'Erstellt', defaultVisible: true },
  { field: 'updatedAt', headerName: 'Aktualisiert', defaultVisible: false },
  { field: 'assignmentUpdatedAt', headerName: 'Assignment aktualisiert', defaultVisible: false },
  { field: 'assignmentUpdatedBy', headerName: 'Assignment geändert von', defaultVisible: false },
  { field: 'imageCount', headerName: 'Bilder', defaultVisible: true },
  { field: 'workflowStatus', headerName: 'Workflow', defaultVisible: true },
  { field: 'workflowExecutionId', headerName: 'Workflow-ID', defaultVisible: false },
];

function resolveTicketPdfTableSettings(userId: string) {
  const persisted = loadSmartTableState(TICKETS_TABLE_ID, userId);
  const viewState = persisted?.viewState;
  const visibilityModel = viewState?.columnVisibilityModel || {};
  const persistedOrder = Array.isArray(viewState?.columnOrder) ? viewState?.columnOrder : [];
  const knownByField = new Map(TICKETS_PDF_COLUMN_CATALOG.map((entry) => [entry.field, entry]));

  const mergedOrder = [
    ...persistedOrder.filter((field) => knownByField.has(field)),
    ...TICKETS_PDF_COLUMN_CATALOG.map((entry) => entry.field).filter((field) => !persistedOrder.includes(field)),
  ];

  const selectedColumns = mergedOrder
    .map((field) => knownByField.get(field) || null)
    .filter((entry): entry is { field: string; headerName: string; defaultVisible: boolean } => !!entry)
    .filter((entry) => {
      const visibility = visibilityModel[entry.field];
      if (typeof visibility === 'boolean') return visibility;
      return entry.defaultVisible;
    })
    .map((entry) => ({
      field: entry.field,
      headerName: entry.headerName,
    }));

  const fallbackColumns = TICKETS_PDF_COLUMN_CATALOG.filter((entry) => entry.defaultVisible).map((entry) => ({
    field: entry.field,
    headerName: entry.headerName,
  }));

  return {
    columns: selectedColumns.length > 0 ? selectedColumns : fallbackColumns,
    layoutMode: viewState?.layoutMode === 'expanded' ? 'expanded' : 'compact',
    textSize: viewState?.textSize === 'sm' || viewState?.textSize === 'lg' ? viewState.textSize : 'md',
  } as const;
}

const DEFAULT_CREATE_DRAFT: TicketCreateDraft = {
  citizenName: '',
  citizenEmail: '',
  category: 'Sonstiges',
  priority: 'medium',
  status: 'open',
  description: '',
  address: '',
  postalCode: '',
  city: '',
  latitude: '',
  longitude: '',
  tenantId: '',
  responsibilityAuthority: '',
  owningOrgUnitId: '',
  assignmentTarget: '',
  assignedTo: '',
  collaboratorUserIds: [],
  collaboratorOrgUnitIds: [],
  startWorkflow: false,
  workflowTemplateId: '',
};

const Tickets: React.FC<{ token: string; role: string }> = ({ token, role }) => {
  const navigate = useNavigate();
  const { selection: scopeSelection, hasCapability, effectiveRole, isGlobalAdmin } = useAdminScopeContext();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});
  const [startWorkflowLoading, setStartWorkflowLoading] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [createDraft, setCreateDraft] = useState<TicketCreateDraft>({ ...DEFAULT_CREATE_DRAFT });
  const [createCategoryOptions, setCreateCategoryOptions] = useState<string[]>(['Sonstiges']);
  const [createWorkflowOptions, setCreateWorkflowOptions] = useState<WorkflowTemplateOption[]>([]);
  const [createTenantOptions, setCreateTenantOptions] = useState<AssignmentTenantOption[]>([]);
  const [createOrgUnitOptions, setCreateOrgUnitOptions] = useState<AssignmentOrgUnitOption[]>([]);
  const [createAdminUserOptions, setCreateAdminUserOptions] = useState<AssignmentAdminUserOption[]>([]);
  const [createResponsibilityAuthorityOptions, setCreateResponsibilityAuthorityOptions] = useState<string[]>(
    DEFAULT_RESPONSIBILITY_AUTHORITIES
  );
  const [loadingCreateOptions, setLoadingCreateOptions] = useState(false);
  const [liveConnectionState, setLiveConnectionState] = useState<'live' | 'reconnecting'>('live');
  const [liveLastEventAt, setLiveLastEventAt] = useState<string | null>(null);
  const [liveLastSyncAt, setLiveLastSyncAt] = useState<string | null>(null);
  const [isLiveRefreshing, setIsLiveRefreshing] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfOrientation, setPdfOrientation] = useState<PdfOrientation>('auto');
  const [ticketFeedTokenLoading, setTicketFeedTokenLoading] = useState(false);
  const [ticketFeedTokenRotating, setTicketFeedTokenRotating] = useState(false);
  const [ticketFeedTokenRevoking, setTicketFeedTokenRevoking] = useState(false);
  const [ticketFeedPath, setTicketFeedPath] = useState('/api/tickets/feed/atom');
  const [ticketFeedToken, setTicketFeedToken] = useState<SelfFeedTokenRecord | null>(null);
  const isAdmin = isAdminRole(role);
  const canCreateTicket = hasCapability('tickets.write');
  const canManageAdvancedAssignment =
    effectiveRole === 'PLATFORM_ADMIN' || effectiveRole === 'TENANT_ADMIN' || effectiveRole === 'ORG_ADMIN';
  const canSelectTenantInDialog = isGlobalAdmin || effectiveRole === 'TENANT_ADMIN';

  const createSelectedAssignmentTarget = useMemo(
    () => parseAssignmentTarget(createDraft.assignmentTarget),
    [createDraft.assignmentTarget]
  );
  const createScopedTenantId = useMemo(() => {
    if (scopeSelection.scope === 'tenant' && scopeSelection.tenantId) {
      return scopeSelection.tenantId;
    }
    return '';
  }, [scopeSelection.scope, scopeSelection.tenantId]);
  const createDefaultTenantId = useMemo(() => {
    if (createScopedTenantId) return createScopedTenantId;
    if (createTenantOptions.length === 1) return createTenantOptions[0].id;
    return '';
  }, [createScopedTenantId, createTenantOptions]);
  const createAssignmentTenantId = useMemo(() => {
    const explicit = String(createDraft.tenantId || '').trim();
    if (explicit) return explicit;
    if (createDefaultTenantId) return createDefaultTenantId;
    const selectedOrg = String(createDraft.owningOrgUnitId || createSelectedAssignmentTarget.orgUnitId || '').trim();
    if (!selectedOrg) return '';
    return String(createOrgUnitOptions.find((entry) => entry.id === selectedOrg)?.tenantId || '').trim();
  }, [
    createDraft.tenantId,
    createDraft.owningOrgUnitId,
    createDefaultTenantId,
    createOrgUnitOptions,
    createSelectedAssignmentTarget.orgUnitId,
  ]);
  const createOrgUnitSelectionOptions = useMemo(() => {
    const stickyIds = new Set<string>();
    [createDraft.owningOrgUnitId, createSelectedAssignmentTarget.orgUnitId].forEach((entry) => {
      const normalized = String(entry || '').trim();
      if (normalized) stickyIds.add(normalized);
    });
    (Array.isArray(createDraft.collaboratorOrgUnitIds) ? createDraft.collaboratorOrgUnitIds : []).forEach((entry) => {
      const normalized = String(entry || '').trim();
      if (normalized) stickyIds.add(normalized);
    });
    return [...createOrgUnitOptions]
      .filter((unit) => !createAssignmentTenantId || unit.tenantId === createAssignmentTenantId || stickyIds.has(unit.id))
      .sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
  }, [
    createAssignmentTenantId,
    createDraft.collaboratorOrgUnitIds,
    createDraft.owningOrgUnitId,
    createOrgUnitOptions,
    createSelectedAssignmentTarget.orgUnitId,
  ]);
  const createUserSelectionOptions = useMemo(() => {
    const stickyIds = new Set<string>();
    [createSelectedAssignmentTarget.userId].forEach((entry) => {
      const normalized = String(entry || '').trim();
      if (normalized) stickyIds.add(normalized);
    });
    (Array.isArray(createDraft.collaboratorUserIds) ? createDraft.collaboratorUserIds : []).forEach((entry) => {
      const normalized = String(entry || '').trim();
      if (normalized) stickyIds.add(normalized);
    });
    return [...createAdminUserOptions]
      .filter((user) => stickyIds.has(user.id) || userCanBeAssignedToTenant(user, createAssignmentTenantId))
      .sort((a, b) => buildAssignmentUserLabel(a).localeCompare(buildAssignmentUserLabel(b), 'de', { sensitivity: 'base' }));
  }, [createAdminUserOptions, createAssignmentTenantId, createDraft.collaboratorUserIds, createSelectedAssignmentTarget.userId]);
  const createCollaboratorUserSelectionOptions = useMemo(() => {
    const byId = new Map(
      createUserSelectionOptions.map((entry) => [
        entry.id,
        {
          id: entry.id,
          label: entry.active ? buildAssignmentUserLabel(entry) : `${buildAssignmentUserLabel(entry)} (inaktiv)`,
          missing: false,
        },
      ])
    );
    const selectedIds = Array.isArray(createDraft.collaboratorUserIds) ? createDraft.collaboratorUserIds : [];
    selectedIds.forEach((entry) => {
      const id = String(entry || '').trim();
      if (!id || byId.has(id)) return;
      byId.set(id, {
        id,
        label: `${id} (nicht mehr vorhanden)`,
        missing: true,
      });
    });
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
  }, [createDraft.collaboratorUserIds, createUserSelectionOptions]);
  const createCollaboratorOrgSelectionOptions = useMemo(() => {
    const byId = new Map(
      createOrgUnitSelectionOptions.map((entry) => [
        entry.id,
        {
          id: entry.id,
          label: entry.active ? entry.label : `${entry.label} (inaktiv)`,
          missing: false,
        },
      ])
    );
    const selectedIds = Array.isArray(createDraft.collaboratorOrgUnitIds) ? createDraft.collaboratorOrgUnitIds : [];
    selectedIds.forEach((entry) => {
      const id = String(entry || '').trim();
      if (!id || byId.has(id)) return;
      byId.set(id, {
        id,
        label: `${id} (nicht mehr vorhanden)`,
        missing: true,
      });
    });
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
  }, [createDraft.collaboratorOrgUnitIds, createOrgUnitSelectionOptions]);
  const createFormMissingRequiredCount = useMemo(() => {
    let missing = 0;
    if (!createDraft.citizenName.trim()) missing += 1;
    if (!createDraft.citizenEmail.trim()) missing += 1;
    if (!createDraft.description.trim()) missing += 1;
    return missing;
  }, [createDraft.citizenEmail, createDraft.citizenName, createDraft.description]);

  const fetchTickets = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) {
        setLoading(true);
      }
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.get('/api/tickets', { headers });
      const payload = response.data;
      const rawTickets = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
      const nextTickets = rawTickets
        .map((entry: any) => normalizeTicket(entry))
        .filter((entry: Ticket | null): entry is Ticket => !!entry);
      setTickets(nextTickets);
      setLiveLastSyncAt(new Date().toISOString());
      setLiveConnectionState('live');
      setError('');
      if (!silent) {
        setSuccessMessage('');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Fehler beim Laden der Tickets');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [token]);

  const loadTicketFeedToken = useCallback(async () => {
    setTicketFeedTokenLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.get('/api/admin/feed-tokens/self/tickets', { headers });
      const payload = response.data as SelfFeedTokenResponse;
      setTicketFeedPath(
        typeof payload?.feedPath === 'string' && payload.feedPath.trim()
          ? payload.feedPath.trim()
          : '/api/tickets/feed/atom'
      );
      setTicketFeedToken(payload?.token || null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Feed-Token konnte nicht geladen werden.');
      setTicketFeedToken(null);
    } finally {
      setTicketFeedTokenLoading(false);
    }
  }, [token]);

  const fetchCreateOptions = useCallback(async () => {
    setLoadingCreateOptions(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [knowledgeRes, workflowRes, generalRes, assignmentDirectory] = await Promise.all([
        axios.get('/api/knowledge', { headers }).catch(() => ({ data: { categories: [] } })),
        axios.get('/api/admin/config/workflow/templates', { headers }).catch(() => ({ data: [] })),
        axios.get('/api/admin/config/general', { headers }).catch(() => null),
        loadAssignmentDirectory(headers, { includeInactiveOrgUnits: true }).catch(() => null),
      ]);
      const categories = Array.isArray(knowledgeRes.data?.categories)
        ? knowledgeRes.data.categories
            .map((entry: any) => String(entry?.name || '').trim())
            .filter(Boolean)
        : [];
      const workflowTemplatesRaw = Array.isArray(workflowRes.data)
        ? workflowRes.data
        : Array.isArray(workflowRes.data?.items)
        ? workflowRes.data.items
        : [];
      const workflowOptions = workflowTemplatesRaw
        .map((entry: any) => ({
          id: String(entry?.id || '').trim(),
          name: String(entry?.name || entry?.id || '').trim(),
        }))
        .filter((entry: WorkflowTemplateOption) => !!entry.id);
      const responsibilityAuthorityOptions = mergeOptionLists(
        DEFAULT_RESPONSIBILITY_AUTHORITIES,
        generalRes?.data?.responsibilityAuthorities
      );
      const uniqueCategories = Array.from(new Set(['Sonstiges', ...categories]));
      setCreateCategoryOptions(uniqueCategories);
      setCreateWorkflowOptions(workflowOptions);
      setCreateTenantOptions(assignmentDirectory?.tenants || []);
      setCreateOrgUnitOptions(assignmentDirectory?.orgUnits || []);
      setCreateAdminUserOptions(assignmentDirectory?.users || []);
      setCreateResponsibilityAuthorityOptions(
        responsibilityAuthorityOptions.length > 0
          ? responsibilityAuthorityOptions
          : DEFAULT_RESPONSIBILITY_AUTHORITIES
      );
      setCreateDraft((prev) => ({
        ...prev,
        tenantId:
          prev.tenantId ||
          createScopedTenantId ||
          (assignmentDirectory?.tenants?.length === 1 ? assignmentDirectory.tenants[0].id : ''),
        category: uniqueCategories.includes(prev.category) ? prev.category : uniqueCategories[0] || 'Sonstiges',
      }));
    } catch {
      setCreateTenantOptions([]);
      setCreateOrgUnitOptions([]);
      setCreateAdminUserOptions([]);
      setCreateResponsibilityAuthorityOptions(DEFAULT_RESPONSIBILITY_AUTHORITIES);
    } finally {
      setLoadingCreateOptions(false);
    }
  }, [createScopedTenantId, token]);

  const openCreateModal = () => {
    if (!canCreateTicket) {
      setError('Sie haben keine Berechtigung, Tickets anzulegen.');
      return;
    }
    setCreateDraft({
      ...DEFAULT_CREATE_DRAFT,
      tenantId: createScopedTenantId || createDefaultTenantId,
    });
    setShowCreateModal(true);
    void fetchCreateOptions();
  };

  const closeCreateModal = () => {
    if (creatingTicket) return;
    setShowCreateModal(false);
  };

  useEffect(() => {
    if (!showCreateModal) return;
    if (!createScopedTenantId) return;
    setCreateDraft((prev) =>
      prev.tenantId === createScopedTenantId
        ? prev
        : {
            ...prev,
            tenantId: createScopedTenantId,
          }
    );
  }, [createScopedTenantId, showCreateModal]);

  useEffect(() => {
    void fetchTickets();
    void loadTicketFeedToken();

    let queuedRefresh = false;
    let refreshTimer: number | null = null;
    let refreshInFlight = false;

    const triggerSilentRefresh = (delayMs = 150) => {
      if (document.visibilityState !== 'visible') return;
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void runSilentRefresh();
      }, delayMs);
    };

    const runSilentRefresh = async () => {
      if (refreshInFlight) {
        queuedRefresh = true;
        return;
      }
      refreshInFlight = true;
      setIsLiveRefreshing(true);
      try {
        await fetchTickets({ silent: true });
      } finally {
        refreshInFlight = false;
        setIsLiveRefreshing(false);
        if (queuedRefresh) {
          queuedRefresh = false;
          triggerSilentRefresh(120);
        }
      }
    };

    const unsubscribe = subscribeAdminRealtime({
      token,
      topics: ['tickets', 'workflows'],
      onUpdate: (event) => {
        setLiveConnectionState('live');
        setLiveLastEventAt(
          typeof event?.at === 'string' && event.at.trim() ? event.at : new Date().toISOString()
        );
        triggerSilentRefresh(120);
      },
      onError: () => {
        setLiveConnectionState('reconnecting');
      },
    });

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        triggerSilentRefresh(60);
      }
    }, 30000);
    return () => {
      unsubscribe();
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      window.clearInterval(interval);
    };
  }, [fetchTickets, loadTicketFeedToken, token]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, pageSize]);

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    const ticketList = Array.isArray(tickets) ? tickets : [];
    return ticketList.filter((ticket) => {
      const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
      const haystack = [
        ticket.id,
        ticket.citizenName,
        ticket.citizenEmail,
        ticket.category,
        ticket.status,
        ticket.city,
        ticket.address,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const matchesSearch = term ? haystack.includes(term) : true;
      return matchesStatus && matchesSearch;
    });
  }, [tickets, statusFilter, search]);

  const sortedTickets = useMemo(() => {
    const getLocation = (ticket: Ticket) => (ticket.city || ticket.address || '').toLowerCase();
    const getStatusIndex = (status: string) => {
      const idx = STATUS_ORDER.indexOf(status);
      return idx === -1 ? STATUS_ORDER.length : idx;
    };
    const getPriorityIndex = (priority: string) => {
      const idx = PRIORITY_ORDER.indexOf(priority);
      return idx === -1 ? PRIORITY_ORDER.length : idx;
    };

    const parsedDate = (value?: string) => {
      if (!value) return 0;
      const timestamp = parseInt(value, 10);
      if (!Number.isNaN(timestamp) && timestamp > 1000000000) return timestamp;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    };

    return [...filteredTickets].sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      switch (sortKey) {
        case 'id':
          aVal = a.id;
          bVal = b.id;
          break;
        case 'category':
          aVal = a.category || '';
          bVal = b.category || '';
          break;
        case 'reporter':
          aVal = a.citizenName || a.citizenEmail || '';
          bVal = b.citizenName || b.citizenEmail || '';
          break;
        case 'status':
          aVal = getStatusIndex(a.status);
          bVal = getStatusIndex(b.status);
          break;
        case 'priority':
          aVal = getPriorityIndex(a.priority);
          bVal = getPriorityIndex(b.priority);
          break;
        case 'location':
          aVal = getLocation(a);
          bVal = getLocation(b);
          break;
        case 'createdAt':
        default:
          aVal = parsedDate(a.createdAt);
          bVal = parsedDate(b.createdAt);
      }

      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal, 'de', { sensitivity: 'base' });
      } else {
        comparison = Number(aVal) - Number(bVal);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredTickets, sortKey, sortDirection]);

  const totalTickets = sortedTickets.length;
  const selection = useTableSelection(sortedTickets);
  const effectivePageSize = pageSize === 'all' ? totalTickets || 1 : pageSize;
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalTickets / effectivePageSize));
  const pageStart = pageSize === 'all' ? 0 : (currentPage - 1) * effectivePageSize;
  const paginatedTickets =
    pageSize === 'all' ? sortedTickets : sortedTickets.slice(pageStart, pageStart + effectivePageSize);

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

  const formatDateTime = (dateString?: string | null) => {
    if (!dateString) return '–';
    try {
      const timestamp = typeof dateString === 'number' ? dateString : parseInt(dateString);
      const date = !isNaN(timestamp) && timestamp > 1000000000 ? new Date(timestamp) : new Date(dateString);
      if (isNaN(date.getTime())) return '–';
      return date.toLocaleString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '–';
    }
  };

  const formatTimeShort = (dateString?: string | null) => {
    if (!dateString) return '–';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '–';
    return date.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const ticketFeedUrl = useMemo(() => {
    const tokenValue = String(ticketFeedToken?.token || '').trim();
    if (!tokenValue) return '';
    const feedPath = String(ticketFeedPath || '/api/tickets/feed/atom').trim() || '/api/tickets/feed/atom';
    if (typeof window === 'undefined') {
      return `${feedPath}?token=${encodeURIComponent(tokenValue)}`;
    }
    return `${window.location.origin}${feedPath}?token=${encodeURIComponent(tokenValue)}`;
  }, [ticketFeedPath, ticketFeedToken?.token]);

  const copyToClipboard = async (value: string): Promise<boolean> => {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalized);
        return true;
      }
    } catch {
      // fallback below
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = normalized;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch {
      return false;
    }
  };

  const rotateTicketFeedToken = async () => {
    setTicketFeedTokenRotating(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post('/api/admin/feed-tokens/self/tickets/rotate', {}, { headers });
      const payload = response.data as SelfFeedTokenResponse;
      setTicketFeedPath(
        typeof payload?.feedPath === 'string' && payload.feedPath.trim()
          ? payload.feedPath.trim()
          : '/api/tickets/feed/atom'
      );
      setTicketFeedToken(payload?.token || null);
      setSuccessMessage('Persönlicher Ticket-Feed-Token erzeugt.');
      setError('');
      window.setTimeout(() => setSuccessMessage(''), 3200);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Feed-Token konnte nicht erzeugt werden.');
    } finally {
      setTicketFeedTokenRotating(false);
    }
  };

  const revokeTicketFeedToken = async () => {
    setTicketFeedTokenRevoking(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.delete('/api/admin/feed-tokens/self/tickets', { headers });
      setTicketFeedToken(null);
      setSuccessMessage('Ticket-Feed-Token widerrufen.');
      setError('');
      window.setTimeout(() => setSuccessMessage(''), 3200);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Feed-Token konnte nicht widerrufen werden.');
    } finally {
      setTicketFeedTokenRevoking(false);
    }
  };

  const copyTicketFeedUrl = async () => {
    if (!ticketFeedUrl) {
      setError('Noch kein aktiver Feed-Token vorhanden.');
      return;
    }
    const copied = await copyToClipboard(ticketFeedUrl);
    if (copied) {
      setSuccessMessage('Ticket-Feed-URL kopiert.');
      setError('');
      window.setTimeout(() => setSuccessMessage(''), 3000);
    } else {
      setError('Ticket-Feed-URL konnte nicht kopiert werden.');
    }
  };

  const handleCreateTicket = async () => {
    const name = createDraft.citizenName.trim();
    const email = createDraft.citizenEmail.trim();
    const description = createDraft.description.trim();
    if (!name || !email || !description) {
      setError('Bitte Name, E-Mail und Beschreibung ausfüllen.');
      return;
    }
    if (createDraft.latitude.trim() !== '' && !Number.isFinite(Number(createDraft.latitude))) {
      setError('Breitengrad ist ungültig.');
      return;
    }
    if (createDraft.longitude.trim() !== '' && !Number.isFinite(Number(createDraft.longitude))) {
      setError('Längengrad ist ungültig.');
      return;
    }
    const assignmentTarget = parseAssignmentTarget(createDraft.assignmentTarget);
    const tenantIdForCreate = String(createAssignmentTenantId || createDefaultTenantId || '').trim();
    if (canSelectTenantInDialog && !tenantIdForCreate) {
      setError('Bitte einen Mandanten auswählen.');
      return;
    }

    const payload: Record<string, any> = {
      citizenName: name,
      citizenEmail: email,
      category: createDraft.category.trim() || 'Sonstiges',
      priority: createDraft.priority,
      status: createDraft.status,
      description,
      address: createDraft.address.trim(),
      postalCode: createDraft.postalCode.trim(),
      city: createDraft.city.trim(),
      startWorkflow: createDraft.startWorkflow,
      workflowTemplateId: createDraft.workflowTemplateId.trim(),
    };
    if (tenantIdForCreate) {
      payload.tenantId = tenantIdForCreate;
    }
    if (canManageAdvancedAssignment) {
      const responsibilityAuthority = createDraft.responsibilityAuthority.trim();
      const owningOrgUnitId = createDraft.owningOrgUnitId.trim();
      if (responsibilityAuthority) {
        payload.responsibilityAuthority = responsibilityAuthority;
      }
      if (owningOrgUnitId) {
        payload.owningOrgUnitId = owningOrgUnitId;
      }
      if (assignmentTarget.userId) {
        payload.primaryAssigneeUserId = assignmentTarget.userId;
      } else if (assignmentTarget.orgUnitId) {
        payload.primaryAssigneeOrgUnitId = assignmentTarget.orgUnitId;
      } else if (assignmentTarget.assignedTo) {
        payload.assignedTo = assignmentTarget.assignedTo;
      }
      if (createDraft.collaboratorUserIds.length > 0) {
        payload.collaboratorUserIds = createDraft.collaboratorUserIds;
      }
      if (createDraft.collaboratorOrgUnitIds.length > 0) {
        payload.collaboratorOrgUnitIds = createDraft.collaboratorOrgUnitIds;
      }
    }
    if (createDraft.latitude.trim() !== '') {
      payload.latitude = Number(createDraft.latitude);
    }
    if (createDraft.longitude.trim() !== '') {
      payload.longitude = Number(createDraft.longitude);
    }

    setCreatingTicket(true);
    setError('');
    setSuccessMessage('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post('/api/tickets', payload, { headers });
      const createdTicket = normalizeTicket(response.data);
      if (createdTicket) {
        setTickets((prev) => [createdTicket, ...prev]);
      } else {
        await fetchTickets();
      }
      setShowCreateModal(false);
      setCreateDraft({ ...DEFAULT_CREATE_DRAFT });
      setSuccessMessage('Ticket wurde angelegt.');
      window.setTimeout(() => setSuccessMessage(''), 3200);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ticket konnte nicht angelegt werden.');
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleDeleteTicket = async (ticketId: string) => {
    if (!window.confirm('Ticket wirklich löschen?')) return;
    setDeleteLoading((prev) => ({ ...prev, [ticketId]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.delete(`/api/tickets/${ticketId}`, { headers });
      setTickets((prev) => prev.filter((ticket) => ticket.id !== ticketId));
      setSuccessMessage('Ticket gelöscht');
      setError('');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Fehler beim Löschen des Tickets');
    } finally {
      setDeleteLoading((prev) => ({ ...prev, [ticketId]: false }));
    }
  };

  const handleStartWorkflow = async (ticket: Ticket) => {
    setStartWorkflowLoading((prev) => ({ ...prev, [ticket.id]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(
        `/api/admin/workflows/ticket/${ticket.id}`,
        {},
        { headers }
      );

      const execution = response.data;
      setTickets((prev) =>
        prev.map((row) =>
          row.id === ticket.id
            ? {
                ...row,
                workflowStarted: true,
                workflowStatus:
                  execution?.status ||
                  row.workflowStatus ||
                  'PAUSED',
                workflowExecutionId: execution?.id || row.workflowExecutionId || null,
                workflowTemplateId: execution?.templateId || row.workflowTemplateId || null,
                workflowTitle: execution?.title || row.workflowTitle || null,
              }
            : row
        )
      );
      setSuccessMessage(
        execution?.id
          ? 'Workflow-Instanz gestartet'
          : response.data?.message || 'Workflow-Aktion ausgeführt'
      );
      setError('');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Workflow konnte nicht gestartet werden');
    } finally {
      setStartWorkflowLoading((prev) => ({ ...prev, [ticket.id]: false }));
    }
  };

  const handleBulkDeleteTickets = async () => {
    if (selection.selectedRows.length === 0) {
      setError('Keine Tickets ausgewählt.');
      return;
    }
    if (!window.confirm(`${selection.selectedRows.length} Ticket(s) wirklich löschen?`)) {
      return;
    }
    setBulkLoading(true);
    setError('');
    setSuccessMessage('');
    const selectedIds = selection.selectedRows.map((ticket) => ticket.id);
    setDeleteLoading((prev) => {
      const next = { ...prev };
      selectedIds.forEach((id) => {
        next[id] = true;
      });
      return next;
    });
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const results = await Promise.allSettled(
        selectedIds.map((id) => axios.delete(`/api/tickets/${id}`, { headers }).then(() => id))
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
      } else {
        setSuccessMessage(`${deletedIds.length} Ticket(s) gelöscht.`);
      }
      selection.clearSelection();
    } catch {
      setError('Fehler beim Löschen der ausgewählten Tickets');
    } finally {
      setDeleteLoading((prev) => {
        const next = { ...prev };
        selectedIds.forEach((id) => {
          next[id] = false;
        });
        return next;
      });
      setBulkLoading(false);
    }
  };

  const handleBulkStartWorkflow = async () => {
    const targets = selection.selectedRows.filter((ticket) => !ticket.workflowStarted);
    if (targets.length === 0) {
      setError('In der Auswahl sind keine Tickets ohne gestarteten Workflow.');
      return;
    }
    setBulkLoading(true);
    setError('');
    setSuccessMessage('');
    const ids = targets.map((ticket) => ticket.id);
    setStartWorkflowLoading((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = true;
      });
      return next;
    });
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const results = await Promise.allSettled(
        targets.map((ticket) =>
          axios.post(`/api/admin/workflows/ticket/${ticket.id}`, {}, { headers }).then((response) => ({
            id: ticket.id,
            execution: response.data,
          }))
        )
      );

      const successful = results.filter(
        (result): result is PromiseFulfilledResult<{ id: string; execution: any }> => result.status === 'fulfilled'
      );
      const failed = results.length - successful.length;
      if (successful.length > 0) {
        const byId = new Map(successful.map((entry) => [entry.value.id, entry.value.execution]));
        setTickets((prev) =>
          prev.map((row) => {
            const execution = byId.get(row.id);
            if (!execution) return row;
            return {
              ...row,
              workflowStarted: true,
              workflowStatus: execution?.status || row.workflowStatus || 'PAUSED',
              workflowExecutionId: execution?.id || row.workflowExecutionId || null,
              workflowTemplateId: execution?.templateId || row.workflowTemplateId || null,
              workflowTitle: execution?.title || row.workflowTitle || null,
            };
          })
        );
      }
      if (failed > 0) {
        setError(`${successful.length} Workflow(s) gestartet, ${failed} fehlgeschlagen.`);
      } else {
        setSuccessMessage(`${successful.length} Workflow(s) gestartet.`);
      }
      selection.clearSelection();
    } catch {
      setError('Fehler beim Starten der ausgewählten Workflows');
    } finally {
      setStartWorkflowLoading((prev) => {
        const next = { ...prev };
        ids.forEach((id) => {
          next[id] = false;
        });
        return next;
      });
      setBulkLoading(false);
    }
  };

  const handleExportTicketsAsPdf = async () => {
    const selectedRows = selection.selectedRows;
    const targets = selectedRows.length > 0 ? selectedRows : sortedTickets;
    if (targets.length === 0) {
      setError('Keine Tickets für den PDF-Export vorhanden.');
      return;
    }

    if (targets.length > 120) {
      const confirmed = window.confirm(
        `Es werden ${targets.length} Tickets inklusive Journaldaten exportiert. Das kann etwas dauern. Fortfahren?`
      );
      if (!confirmed) return;
    }

    setError('');
    setSuccessMessage('');
    setIsExportingPdf(true);

    try {
      const headers = { Authorization: `Bearer ${token}` };
      const bundles: TicketPdfBundle[] = [];
      const chunkSize = 6;
      const tableSettings = resolveTicketPdfTableSettings(token);

      const fetchBundle = async (ticket: Ticket): Promise<TicketPdfBundle> => {
        const ticketResponse = await axios.get(`/api/tickets/${ticket.id}`, { headers });
        const detail = ticketResponse.data || {};
        const workflowExecutionId = String(
          detail?.workflowExecutionId || detail?.workflowId || ticket.workflowExecutionId || ''
        ).trim();

        let workflow: Record<string, any> | null = null;
        if (workflowExecutionId) {
          try {
            const workflowResponse = await axios.get(`/api/admin/workflows/${workflowExecutionId}`, { headers });
            workflow = workflowResponse.data && typeof workflowResponse.data === 'object' ? workflowResponse.data : null;
          } catch {
            workflow = null;
          }
        }

        return {
          ticket: detail,
          workflow,
        };
      };

      for (let start = 0; start < targets.length; start += chunkSize) {
        const chunk = targets.slice(start, start + chunkSize);
        const chunkResults = await Promise.all(chunk.map((ticket) => fetchBundle(ticket)));
        bundles.push(...chunkResults);
      }

      const filterSummary = [
        selectedRows.length > 0
          ? `Quelle: ${selectedRows.length} selektierte Tickets`
          : `Quelle: ${sortedTickets.length} gefilterte Tickets`,
        `Statusfilter: ${statusFilter === 'all' ? 'Alle' : STATUS_LABELS[statusFilter] || statusFilter}`,
        `Suche: ${search.trim() || 'keine'}`,
        `Sortierung: ${sortKey} (${sortDirection})`,
        `Ansicht: ${tableSettings.layoutMode === 'expanded' ? 'Erweitert (mehrzeilig)' : 'Kompakt'}`,
        `Spalten: ${tableSettings.columns.length}`,
        `Format: ${
          pdfOrientation === 'auto'
            ? 'Auto'
            : pdfOrientation === 'landscape'
            ? 'Querformat'
            : 'Hochformat'
        }`,
      ];

      exportTicketListPdf(bundles, {
        reportTitle: 'Ticketliste',
        subtitle: `DIN A4 ${
          pdfOrientation === 'auto'
            ? 'Auto'
            : pdfOrientation === 'landscape'
            ? 'Querformat'
            : 'Hochformat'
        } · ${tableSettings.layoutMode === 'expanded' ? 'erweiterte' : 'kompakte'} SmartGrid-Tabelle`,
        filterSummary,
        generatedBy: 'Admin-Frontend',
        orientation: pdfOrientation,
        tableLayoutMode: tableSettings.layoutMode,
        tableTextSize: tableSettings.textSize,
        tableColumns: tableSettings.columns,
      });

      setSuccessMessage(`${bundles.length} Ticket(s) als PDF exportiert.`);
      setTimeout(() => setSuccessMessage(''), 3200);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Ticketliste konnte nicht als PDF exportiert werden.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const columns = useMemo<SmartTableColumnDef<Ticket>[]>(
    () => [
      {
        field: 'id',
        headerName: 'Ticket',
        minWidth: 140,
        renderCell: (params) => <span className="ticket-id">{String(params.row.id || '').substring(0, 8)}</span>,
      },
      {
        field: 'reporter',
        headerName: 'Meldende Person',
        minWidth: 220,
        flex: 1,
        valueGetter: (_value, row) => row.citizenName || row.citizenEmail || '–',
      },
      {
        field: 'citizenEmail',
        headerName: 'E-Mail',
        minWidth: 220,
        flex: 1,
        defaultVisible: false,
        valueGetter: (_value, row) => row.citizenEmail || '–',
      },
      {
        field: 'submissionId',
        headerName: 'Submission',
        minWidth: 180,
        defaultVisible: false,
        valueGetter: (_value, row) => row.submissionId || '–',
      },
      {
        field: 'assignedTo',
        headerName: 'Zugewiesen an',
        minWidth: 210,
        defaultVisible: false,
        valueGetter: (_value, row) =>
          row.primaryAssigneeUserId ||
          row.primaryAssigneeOrgUnitId ||
          row.assignedTo ||
          '–',
      },
      {
        field: 'primaryAssigneeUserId',
        headerName: 'Primär User-ID',
        minWidth: 180,
        defaultVisible: false,
        valueGetter: (_value, row) => row.primaryAssigneeUserId || '–',
      },
      {
        field: 'primaryAssigneeOrgUnitId',
        headerName: 'Primär Org-Unit-ID',
        minWidth: 190,
        defaultVisible: false,
        valueGetter: (_value, row) => row.primaryAssigneeOrgUnitId || '–',
      },
      {
        field: 'owningOrgUnitId',
        headerName: 'Owning Org-Unit-ID',
        minWidth: 190,
        defaultVisible: false,
        valueGetter: (_value, row) => row.owningOrgUnitId || '–',
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
        minWidth: 150,
        renderCell: (params) => (
          <span className={`priority-pill priority-${params.row.priority}`}>
            {PRIORITY_LABELS[params.row.priority] || params.row.priority}
          </span>
        ),
      },
      {
        field: 'location',
        headerName: 'Ort',
        minWidth: 200,
        flex: 1,
        valueGetter: (_value, row) => row.city || row.address || '–',
      },
      {
        field: 'createdAt',
        headerName: 'Erstellt',
        minWidth: 165,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'updatedAt',
        headerName: 'Aktualisiert',
        minWidth: 165,
        defaultVisible: false,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'assignmentUpdatedAt',
        headerName: 'Assignment aktualisiert',
        minWidth: 180,
        defaultVisible: false,
        valueGetter: (_value, row) => row.assignmentUpdatedAt || '',
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'assignmentUpdatedBy',
        headerName: 'Assignment geändert von',
        minWidth: 210,
        defaultVisible: false,
        valueGetter: (_value, row) => row.assignmentUpdatedBy || '–',
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
        field: 'workflowStatus',
        headerName: 'Workflow',
        minWidth: 320,
        flex: 1.2,
        renderCell: (params) =>
          params.row.workflowStarted ? (
            <div className={`workflow-state is-${String(params.row.workflowStatus || 'PAUSED').toLowerCase()}`}>
              <span className={`workflow-badge workflow-${(params.row.workflowStatus || 'PAUSED').toLowerCase()}`}>
                <i className={WORKFLOW_STATUS_ICON[params.row.workflowStatus || 'PAUSED'] || 'fa-solid fa-circle'} />{' '}
                {WORKFLOW_STATUS_LABELS[params.row.workflowStatus || 'PAUSED'] || 'Gestartet'}
              </span>
              <div className="workflow-meta-line">
                {params.row.workflowExecutionId && (
                  <span className="workflow-ref-chip">
                    <i className="fa-solid fa-diagram-project" /> {params.row.workflowExecutionId.slice(0, 8)}
                  </span>
                )}
                <span
                  className="workflow-ref-chip workflow-title-chip"
                  title={params.row.workflowTitle || 'Workflow ohne Titel'}
                >
                  <i className="fa-solid fa-shapes" /> {params.row.workflowTitle || 'Workflow ohne Titel'}
                </span>
              </div>
            </div>
          ) : (
            <span className="workflow-none">
              <i className="fa-solid fa-circle-minus" /> Nicht gestartet
            </span>
          ),
      },
      {
        field: 'workflowExecutionId',
        headerName: 'Workflow-ID',
        minWidth: 180,
        defaultVisible: false,
        valueGetter: (_value, row) => row.workflowExecutionId || '–',
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 130,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        hideable: false,
        renderCell: (params) => (
          <SmartTableRowActions>
            {!params.row.workflowStarted && (
              <SmartTableRowActionButton
                label={startWorkflowLoading[params.row.id] ? 'Workflow wird gestartet…' : 'Workflow starten'}
                icon={<PlayArrowRoundedIcon fontSize="inherit" />}
                tone="primary"
                onClick={() => {
                  void handleStartWorkflow(params.row);
                }}
                disabled={startWorkflowLoading[params.row.id] || bulkLoading}
                loading={!!startWorkflowLoading[params.row.id]}
              />
            )}
            {isAdmin && (
              <SmartTableRowActionButton
                label={deleteLoading[params.row.id] ? 'Ticket wird gelöscht…' : 'Ticket löschen'}
                icon={<DeleteOutlineRoundedIcon fontSize="inherit" />}
                tone="danger"
                onClick={() => {
                  void handleDeleteTicket(params.row.id);
                }}
                disabled={deleteLoading[params.row.id] || bulkLoading}
                loading={!!deleteLoading[params.row.id]}
              />
            )}
          </SmartTableRowActions>
        ),
      },
    ],
    [bulkLoading, deleteLoading, handleDeleteTicket, handleStartWorkflow, isAdmin, startWorkflowLoading]
  );

  return (
    <div className="tickets-page">
      <AdminPageHero
        title="Tickets"
        subtitle="Alle Meldungen im System inklusive Status, Priorität, Workflow und Zuweisung."
        icon={<i className="fa-solid fa-ticket" />}
        badges={[
          {
            id: 'live-state',
            label: liveConnectionState === 'reconnecting' ? 'Live-Reconnect' : 'Live verbunden',
            tone: liveConnectionState === 'reconnecting' ? 'warning' : 'success',
          },
          {
            id: 'count',
            label: `${totalTickets} Tickets`,
            tone: 'info',
          },
        ]}
        actions={
          <div className="tickets-header-actions tickets-hero-actions">
          <button type="button" className="tickets-create" onClick={openCreateModal}>
            <i className="fa-solid fa-plus" /> Neues Ticket
          </button>
          <label className="tickets-pdf-format">
            <span>PDF</span>
            <select
              value={pdfOrientation}
              onChange={(event) => setPdfOrientation(event.target.value as PdfOrientation)}
              aria-label="PDF-Seitenformat"
            >
              <option value="auto">Auto</option>
              <option value="landscape">Querformat</option>
              <option value="portrait">Hochformat</option>
            </select>
          </label>
          <button
            type="button"
            className="tickets-export"
            onClick={handleExportTicketsAsPdf}
            disabled={isExportingPdf || loading}
            title="Ticketliste als PDF gemäß SmartTable-Spalten/Ansicht exportieren"
          >
            {isExportingPdf ? (
              <>
                <i className="fa-solid fa-spinner fa-spin" /> Export...
              </>
            ) : (
              <>
                <i className="fa-solid fa-file-pdf" />{' '}
                {selection.selectedCount > 0 ? `PDF (${selection.selectedCount})` : 'PDF-Export'}
              </>
            )}
          </button>
          <button
            className="tickets-refresh"
            onClick={() => {
              void fetchTickets();
            }}
            disabled={loading || isLiveRefreshing}
          >
            <i className={`fa-solid ${loading || isLiveRefreshing ? 'fa-spinner fa-spin' : 'fa-rotate'}`} />{' '}
            {loading || isLiveRefreshing ? 'Aktualisiere...' : 'Aktualisieren'}
          </button>
          </div>
        }
      />

      <div className="tickets-live-strip" role="status" aria-live="polite">
        <span className={`tickets-live-chip ${liveConnectionState === 'reconnecting' ? 'state-reconnecting' : 'state-live'}`}>
          <i className={`fa-solid ${liveConnectionState === 'reconnecting' ? 'fa-plug-circle-xmark' : 'fa-satellite-dish'}`} />{' '}
          {liveConnectionState === 'reconnecting' ? 'Live-Verbindung wird hergestellt…' : 'Live verbunden'}
        </span>
        <span className="tickets-live-meta">Event: {formatTimeShort(liveLastEventAt)}</span>
        <span className="tickets-live-meta">Sync: {formatTimeShort(liveLastSyncAt)}</span>
      </div>

      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <AdminSurfaceCard
        className="tickets-filters-card"
        title="Filter & Suche"
        subtitle="Einschränken nach Status, Stichworten und Seitenumfang."
      >
        <div className="tickets-filters">
          <div className="filter-group">
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
          <div className="filter-group grow">
            <label>Suche</label>
            <input
              type="text"
              placeholder="Ticket-ID, Meldender, Kategorie, Ort..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
      </AdminSurfaceCard>

      {isAdmin && selection.selectedCount > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-actions-meta">
            <span className="count">{selection.selectedCount}</span>
            <span>ausgewählt</span>
          </div>
          <div className="bulk-actions-buttons">
            <button className="bulk-btn info" type="button" onClick={handleBulkStartWorkflow} disabled={bulkLoading}>
              <i className="fa-solid fa-play" /> Workflow starten
            </button>
            <button className="bulk-btn danger" type="button" onClick={handleBulkDeleteTickets} disabled={bulkLoading}>
              <i className="fa-solid fa-trash" /> Tickets löschen
            </button>
            <button className="bulk-btn" type="button" onClick={selection.clearSelection} disabled={bulkLoading}>
              Auswahl aufheben
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Lädt...</div>
      ) : totalTickets === 0 ? (
        <div className="tickets-empty">Keine Tickets gefunden.</div>
      ) : (
        <>
          <SmartTable<Ticket>
            tableId="tickets-overview"
            userId={token}
            title="Ticketübersicht"
            rows={paginatedTickets}
            columns={columns}
            loading={loading}
            checkboxSelection={isAdmin}
            selectionModel={selection.selectedIds}
            onSelectionModelChange={(ids) => selection.setSelectedIds(ids)}
            onRowClick={(row) => navigate(`/tickets/${row.id}`)}
            getRowClassName={(row) =>
              row.workflowStarted
                ? `tickets-row tickets-row-workflow-${String(row.workflowStatus || 'PAUSED').toLowerCase()}`
                : 'tickets-row'
            }
            onRefresh={() => {
              void fetchTickets();
            }}
            liveState={liveConnectionState}
            lastEventAt={liveLastEventAt}
            lastSyncAt={liveLastSyncAt}
            isRefreshing={isLiveRefreshing}
            defaultPageSize={pageSize === 'all' ? 50 : effectivePageSize}
            pageSizeOptions={[10, 25, 50, 100]}
            disableRowSelectionOnClick
          />

          <div className="tickets-feed-box">
            <div className="tickets-feed-header">
              <strong>Atom-Feed (persönlicher Link)</strong>
              <span>Nur für deinen User · widerrufbar</span>
            </div>
            <div className="tickets-feed-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={rotateTicketFeedToken}
                disabled={ticketFeedTokenRotating}
              >
                {ticketFeedTokenRotating ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Erzeuge...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-key" /> Feed-Token erzeugen/erneuern
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={revokeTicketFeedToken}
                disabled={ticketFeedTokenRevoking || !ticketFeedToken}
              >
                {ticketFeedTokenRevoking ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Widerrufe...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-ban" /> Feed-Token widerrufen
                  </>
                )}
              </button>
              <button type="button" className="btn btn-secondary" onClick={copyTicketFeedUrl} disabled={!ticketFeedUrl}>
                <i className="fa-solid fa-copy" /> Feed-URL kopieren
              </button>
            </div>
            <label className="tickets-feed-url-wrap">
              <span>Feed-URL</span>
              <input
                type="text"
                className="tickets-feed-url"
                value={ticketFeedUrl || 'Noch kein aktiver Feed-Token vorhanden'}
                readOnly
              />
            </label>
            <div className="tickets-feed-meta">
              <span>Token erstellt: {formatDateTime(ticketFeedToken?.createdAt || null)}</span>
              <span>Zuletzt genutzt: {formatDateTime(ticketFeedToken?.lastUsedAt || null)}</span>
              {ticketFeedTokenLoading ? <span>Token wird geladen…</span> : null}
            </div>
          </div>
        </>
      )}

      {showCreateModal && (
        <div className="ticket-create-overlay" onClick={closeCreateModal}>
          <div
            className="ticket-create-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Neues Ticket anlegen"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ticket-create-head">
              <h3>
                <i className="fa-solid fa-plus" /> Neues Ticket anlegen
              </h3>
              <button type="button" className="ticket-create-close" onClick={closeCreateModal} disabled={creatingTicket}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="ticket-create-body">
              <div className="ticket-create-summary">
                <span>
                  Pflichtfelder offen: <strong>{createFormMissingRequiredCount}</strong>
                </span>
                <span>
                  Kontext: <strong>{effectiveRole || 'SACHBEARBEITER'}</strong>
                </span>
              </div>

              <div className="ticket-create-grid">
                <label>
                  <span>Name *</span>
                  <input
                    type="text"
                    value={createDraft.citizenName}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, citizenName: event.target.value }))}
                  />
                </label>
                <label>
                  <span>E-Mail *</span>
                  <input
                    type="email"
                    value={createDraft.citizenEmail}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, citizenEmail: event.target.value }))}
                  />
                </label>
                {canSelectTenantInDialog && (
                  <label>
                    <span>Mandant *</span>
                    <select
                      value={createDraft.tenantId || createDefaultTenantId}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({
                          ...prev,
                          tenantId: event.target.value,
                          owningOrgUnitId: '',
                          assignmentTarget: '',
                          collaboratorUserIds: [],
                          collaboratorOrgUnitIds: [],
                        }))
                      }
                      disabled={loadingCreateOptions || createTenantOptions.length === 0}
                    >
                      <option value="">Mandant wählen...</option>
                      {createTenantOptions.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.label || tenant.id}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <span>Kategorie</span>
                  <select
                    value={createDraft.category}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, category: event.target.value }))}
                    disabled={loadingCreateOptions}
                  >
                    {createCategoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Priorität</span>
                  <select
                    value={createDraft.priority}
                    onChange={(event) =>
                      setCreateDraft((prev) => ({
                        ...prev,
                        priority: event.target.value as TicketCreateDraft['priority'],
                      }))
                    }
                  >
                    {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={createDraft.status}
                    onChange={(event) =>
                      setCreateDraft((prev) => ({
                        ...prev,
                        status: event.target.value as TicketCreateDraft['status'],
                      }))
                    }
                  >
                    <option value="pending_validation">Validierung ausstehend</option>
                    <option value="pending">Ausstehend</option>
                    <option value="open">Offen</option>
                    <option value="assigned">Zugewiesen</option>
                    <option value="in-progress">In Bearbeitung</option>
                    <option value="completed">Abgeschlossen</option>
                    <option value="closed">Geschlossen</option>
                  </select>
                </label>
                <label>
                  <span>PLZ</span>
                  <input
                    type="text"
                    value={createDraft.postalCode}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, postalCode: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Ort</span>
                  <input
                    type="text"
                    value={createDraft.city}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, city: event.target.value }))}
                  />
                </label>
                {canManageAdvancedAssignment && (
                  <label>
                    <span>Zuständigkeit</span>
                    <select
                      value={createDraft.responsibilityAuthority}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, responsibilityAuthority: event.target.value }))
                      }
                      disabled={loadingCreateOptions}
                    >
                      <option value="">Automatisch/leer</option>
                      {createResponsibilityAuthorityOptions.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {canManageAdvancedAssignment && (
                  <label>
                    <span>Owning Orga-Einheit</span>
                    <select
                      value={createDraft.owningOrgUnitId}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({
                          ...prev,
                          owningOrgUnitId: event.target.value,
                        }))
                      }
                      disabled={loadingCreateOptions}
                    >
                      <option value="">Keine</option>
                      {createOrgUnitSelectionOptions.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="ticket-create-grid-wide">
                  <span>Adresse</span>
                  <input
                    type="text"
                    value={createDraft.address}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, address: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Breitengrad</span>
                  <input
                    type="number"
                    value={createDraft.latitude}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, latitude: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Längengrad</span>
                  <input
                    type="number"
                    value={createDraft.longitude}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, longitude: event.target.value }))}
                  />
                </label>
                <label className="ticket-create-grid-wide">
                  <span>Beschreibung *</span>
                  <textarea
                    rows={5}
                    value={createDraft.description}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, description: event.target.value }))}
                  />
                </label>
                {canManageAdvancedAssignment && (
                  <label className="ticket-create-grid-wide">
                    <span>Primäre Zuweisung</span>
                    <select
                      value={createDraft.assignmentTarget}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({
                          ...prev,
                          assignmentTarget: event.target.value,
                        }))
                      }
                      disabled={loadingCreateOptions}
                    >
                      <option value="">Keine primäre Zuweisung</option>
                      {createUserSelectionOptions.map((user) => (
                        <option key={`user-${user.id}`} value={`user:${user.id}`}>
                          [User] {buildAssignmentUserLabel(user)}
                        </option>
                      ))}
                      {createOrgUnitSelectionOptions.map((unit) => (
                        <option key={`org-${unit.id}`} value={`org:${unit.id}`}>
                          [Orga] {unit.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {canManageAdvancedAssignment && (
                  <label className="ticket-create-grid-wide">
                    <span>Kollaborierende User (Mehrfachauswahl)</span>
                    <select
                      multiple
                      size={Math.min(6, Math.max(3, createCollaboratorUserSelectionOptions.length || 3))}
                      className="ticket-create-multi"
                      value={createDraft.collaboratorUserIds}
                      onChange={(event) => {
                        const values = Array.from(event.target.selectedOptions).map((option) => option.value);
                        setCreateDraft((prev) => ({ ...prev, collaboratorUserIds: values }));
                      }}
                      disabled={loadingCreateOptions || createCollaboratorUserSelectionOptions.length === 0}
                    >
                      {createCollaboratorUserSelectionOptions.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                    <small className="ticket-create-help">
                      Tipp: `Strg`/`Cmd` gedrückt halten für Mehrfachauswahl.
                    </small>
                  </label>
                )}
                {canManageAdvancedAssignment && (
                  <label className="ticket-create-grid-wide">
                    <span>Kollaborierende Orga-Einheiten (Mehrfachauswahl)</span>
                    <select
                      multiple
                      size={Math.min(6, Math.max(3, createCollaboratorOrgSelectionOptions.length || 3))}
                      className="ticket-create-multi"
                      value={createDraft.collaboratorOrgUnitIds}
                      onChange={(event) => {
                        const values = Array.from(event.target.selectedOptions).map((option) => option.value);
                        setCreateDraft((prev) => ({ ...prev, collaboratorOrgUnitIds: values }));
                      }}
                      disabled={loadingCreateOptions || createCollaboratorOrgSelectionOptions.length === 0}
                    >
                      {createCollaboratorOrgSelectionOptions.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="ticket-create-workflow-block">
                <label className="ticket-create-check">
                  <input
                    type="checkbox"
                    checked={createDraft.startWorkflow}
                    onChange={(event) =>
                      setCreateDraft((prev) => ({
                        ...prev,
                        startWorkflow: event.target.checked,
                        workflowTemplateId: event.target.checked ? prev.workflowTemplateId : '',
                      }))
                    }
                  />
                  <span>Workflow sofort starten</span>
                </label>
                {createDraft.startWorkflow && (
                  <label className="ticket-create-workflow-select">
                    <span>Workflow-Vorlage</span>
                    <select
                      value={createDraft.workflowTemplateId}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, workflowTemplateId: event.target.value }))
                      }
                      disabled={loadingCreateOptions}
                    >
                      <option value="">Automatisch aus Kategorie ableiten</option>
                      {createWorkflowOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name} ({option.id})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>

            <div className="ticket-create-actions">
              <button type="button" className="btn btn-secondary" onClick={closeCreateModal} disabled={creatingTicket}>
                Abbrechen
              </button>
              <button type="button" className="btn btn-primary" onClick={handleCreateTicket} disabled={creatingTicket}>
                {creatingTicket ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Speichere...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-floppy-disk" /> Ticket anlegen
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tickets;
