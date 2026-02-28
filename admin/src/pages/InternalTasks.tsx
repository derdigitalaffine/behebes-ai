import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import './InternalTasks.css';

interface InternalTaskItem {
  id: string;
  ticketId: string;
  workflowExecutionId: string;
  stepId: string;
  title: string;
  description?: string;
  instructions?: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';
  mode: 'blocking' | 'parallel';
  assigneeUserId?: string | null;
  assigneeOrgUnitId?: string | null;
  formSchema?: Record<string, any> | Array<Record<string, any>> | null;
  response?: Record<string, any> | null;
  dueAt?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  ticketStatus?: string | null;
  ticketCategory?: string | null;
  ticketPriority?: string | null;
}

interface InternalTaskEvent {
  id: string;
  eventType: string;
  actorUserId?: string | null;
  createdAt?: string | null;
  payload?: Record<string, any> | null;
}

interface InternalTaskDetailResponse {
  task: InternalTaskItem;
  events: InternalTaskEvent[];
}

interface OrgUnitOption {
  id: string;
  tenantId: string;
  label: string;
  active: boolean;
}

interface AdminUserOption {
  id: string;
  username: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  active: boolean;
}

type InternalTaskFormFieldType = 'text' | 'textarea' | 'boolean' | 'select' | 'date' | 'number';

interface InternalTaskFormFieldOption {
  value: string;
  label: string;
}

interface InternalTaskFormField {
  key: string;
  label: string;
  type: InternalTaskFormFieldType;
  required: boolean;
  placeholder: string;
  helpText: string;
  options?: InternalTaskFormFieldOption[];
}

type TaskSortKey = 'title' | 'status' | 'mode' | 'assignee' | 'dueAt' | 'createdAt' | 'ticketId';
type DueFilter = 'all' | 'overdue' | 'today' | 'without_due';

const STATUS_OPTIONS = [
  { value: '', label: 'Alle Status' },
  { value: 'pending', label: 'Offen' },
  { value: 'in_progress', label: 'In Bearbeitung' },
  { value: 'completed', label: 'Abgeschlossen' },
  { value: 'rejected', label: 'Abgelehnt' },
  { value: 'cancelled', label: 'Abgebrochen' },
] as const;

const ASSIGNMENT_OPTIONS = [
  { value: '', label: 'Alle Zuweisungen' },
  { value: 'me', label: 'Mir zugewiesen' },
  { value: 'my_units', label: 'Meine Bereiche' },
  { value: 'unassigned', label: 'Nicht zugewiesen' },
] as const;

const MODE_OPTIONS = [
  { value: '', label: 'Alle Modi' },
  { value: 'blocking', label: 'Blockierend' },
  { value: 'parallel', label: 'Parallel' },
] as const;

const DUE_OPTIONS: Array<{ value: DueFilter; label: string }> = [
  { value: 'all', label: 'Alle Fristen' },
  { value: 'overdue', label: 'Überfällig' },
  { value: 'today', label: 'Heute fällig' },
  { value: 'without_due', label: 'Ohne Fälligkeit' },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

const STATUS_LABELS: Record<InternalTaskItem['status'], string> = {
  pending: 'Offen',
  in_progress: 'In Bearbeitung',
  completed: 'Abgeschlossen',
  rejected: 'Abgelehnt',
  cancelled: 'Abgebrochen',
};

const STATUS_SORT_ORDER: Record<InternalTaskItem['status'], number> = {
  pending: 1,
  in_progress: 2,
  completed: 3,
  rejected: 4,
  cancelled: 5,
};

const EVENT_LABELS: Record<string, string> = {
  created: 'Angelegt',
  in_progress: 'In Bearbeitung',
  reassigned: 'Neu zugewiesen',
  completed: 'Abgeschlossen',
  rejected: 'Abgelehnt',
  cancelled: 'Abgebrochen',
};

const isTaskActionable = (status: InternalTaskItem['status']) => status === 'pending' || status === 'in_progress';

const formatDateTime = (value?: string | null) => {
  if (!value) return '–';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('de-DE');
};

const parseDateMs = (value?: string | null): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const startOfLocalDay = (valueMs: number): number => {
  const d = new Date(valueMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const endOfLocalDay = (valueMs: number): number => {
  const d = new Date(valueMs);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

const isTaskOverdue = (task: InternalTaskItem, nowMs: number) => {
  if (!isTaskActionable(task.status) || !task.dueAt) return false;
  const dueMs = parseDateMs(task.dueAt);
  return dueMs !== null && dueMs < nowMs;
};

const isTaskDueToday = (task: InternalTaskItem, nowMs: number) => {
  if (!task.dueAt) return false;
  const dueMs = parseDateMs(task.dueAt);
  if (dueMs === null) return false;
  return dueMs >= startOfLocalDay(nowMs) && dueMs <= endOfLocalDay(nowMs);
};

const buildOrgUnitPathMap = (rows: any[]): Record<string, string> => {
  const byId = new Map<string, any>();
  for (const row of rows || []) {
    const id = String(row?.id || '').trim();
    if (!id) continue;
    byId.set(id, row);
  }

  const cache = new Map<string, string>();

  const resolveLabel = (id: string): string => {
    if (!id) return '';
    const cached = cache.get(id);
    if (cached) return cached;

    const row = byId.get(id);
    if (!row) {
      cache.set(id, id);
      return id;
    }

    const ownName = String(row?.name || '').trim() || id;
    const parentId = String(row?.parentId || row?.parent_id || '').trim();
    if (!parentId || !byId.has(parentId)) {
      cache.set(id, ownName);
      return ownName;
    }

    const chainGuard = new Set<string>([id]);
    let currentParent = parentId;
    const segments = [ownName];
    while (currentParent && byId.has(currentParent) && !chainGuard.has(currentParent)) {
      chainGuard.add(currentParent);
      const parentRow = byId.get(currentParent);
      const parentName = String(parentRow?.name || '').trim() || currentParent;
      segments.unshift(parentName);
      currentParent = String(parentRow?.parentId || parentRow?.parent_id || '').trim();
    }

    const value = segments.join(' / ');
    cache.set(id, value);
    return value;
  };

  const out: Record<string, string> = {};
  for (const id of byId.keys()) out[id] = resolveLabel(id);
  return out;
};

const buildUserLabel = (user: AdminUserOption): string => {
  const firstName = String(user.firstName || '').trim();
  const lastName = String(user.lastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (fullName) {
    return user.username ? `${fullName} (@${user.username})` : fullName;
  }
  return user.username || user.id;
};

const parseAssignmentTarget = (value: string): { userId: string; orgUnitId: string } => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { userId: '', orgUnitId: '' };
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('user:')) return { userId: trimmed.slice(5).trim(), orgUnitId: '' };
  if (lower.startsWith('org:')) return { userId: '', orgUnitId: trimmed.slice(4).trim() };
  return { userId: '', orgUnitId: '' };
};

const compareText = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' });

const normalizeInternalTaskFormFields = (rawFormSchema: unknown): InternalTaskFormField[] => {
  const rawFields =
    rawFormSchema && typeof rawFormSchema === 'object' && !Array.isArray(rawFormSchema)
      ? Array.isArray((rawFormSchema as Record<string, any>).fields)
        ? ((rawFormSchema as Record<string, any>).fields as any[])
        : []
      : Array.isArray(rawFormSchema)
      ? (rawFormSchema as any[])
      : [];

  return rawFields
    .map((field: any, index: number): InternalTaskFormField | null => {
      if (!field || typeof field !== 'object') return null;
      const key = String(field.key || `field_${index + 1}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_');
      if (!key) return null;
      const rawType = String(field.type || 'text').trim().toLowerCase();
      const type: InternalTaskFormFieldType = ['text', 'textarea', 'boolean', 'select', 'date', 'number'].includes(rawType)
        ? (rawType as InternalTaskFormFieldType)
        : 'text';
      const options: InternalTaskFormFieldOption[] =
        type === 'select' && Array.isArray(field.options)
          ? field.options
              .map((entry: any) => {
                const value = String(entry?.value ?? entry ?? '').trim();
                if (!value) return null;
                const label = String(entry?.label || value).trim() || value;
                return { value, label };
              })
              .filter((entry: InternalTaskFormFieldOption | null): entry is InternalTaskFormFieldOption => !!entry)
          : [];
      return {
        key,
        label: String(field.label || key).trim() || key,
        type,
        required: field.required === true,
        placeholder: String(field.placeholder || '').trim(),
        helpText: String(field.helpText || '').trim(),
        ...(options.length > 0 ? { options } : {}),
      };
    })
    .filter((field: InternalTaskFormField | null): field is InternalTaskFormField => !!field);
};

const normalizeInternalTaskFieldValue = (field: InternalTaskFormField, value: unknown): any => {
  if (value === undefined || value === null) {
    return field.type === 'boolean' ? false : '';
  }
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'ja', 'on'].includes(value.trim().toLowerCase());
    }
    if (typeof value === 'number') return value !== 0;
    return Boolean(value);
  }
  if (field.type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : '';
  }
  if (field.type === 'date') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
  }
  return String(value ?? '');
};

const serializeInternalTaskFieldValue = (field: InternalTaskFormField, value: unknown): any => {
  if (field.type === 'boolean') {
    return value === true;
  }
  if (field.type === 'number') {
    if (value === '' || value === null || value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const text = String(value ?? '').trim();
  return text ? text : undefined;
};

const isMissingInternalTaskFieldValue = (field: InternalTaskFormField, value: unknown): boolean => {
  if (field.type === 'boolean') return typeof value !== 'boolean';
  if (field.type === 'number') return value === '' || value === null || value === undefined || !Number.isFinite(Number(value));
  return String(value ?? '')
    .trim()
    .length === 0;
};

const buildInternalTaskFormPayload = (
  fields: InternalTaskFormField[],
  values: Record<string, any>
): Record<string, any> => {
  const payload: Record<string, any> = {};
  fields.forEach((field) => {
    const serialized = serializeInternalTaskFieldValue(field, values[field.key]);
    if (serialized !== undefined) payload[field.key] = serialized;
  });
  return payload;
};

const validateInternalTaskRequiredFields = (
  fields: InternalTaskFormField[],
  payload: Record<string, any>
): string[] =>
  fields
    .filter((field) => field.required)
    .filter((field) => isMissingInternalTaskFieldValue(field, payload[field.key]))
    .map((field) => field.label || field.key);

const InternalTasks: React.FC<{ token: string }> = ({ token }) => {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingTaskId, setSubmittingTaskId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<InternalTaskItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedTask, setSelectedTask] = useState<InternalTaskItem | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<InternalTaskEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState('');
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [dueFilter, setDueFilter] = useState<DueFilter>('all');
  const [onlyActionable, setOnlyActionable] = useState(false);
  const [tableSortKey, setTableSortKey] = useState<TaskSortKey>('dueAt');
  const [tableSortDirection, setTableSortDirection] = useState<'asc' | 'desc'>('asc');
  const [tablePageSize, setTablePageSize] = useState<number>(25);
  const [tablePage, setTablePage] = useState<number>(1);
  const [assignmentTarget, setAssignmentTarget] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [actionResponse, setActionResponse] = useState('{}');
  const [responseFormValues, setResponseFormValues] = useState<Record<string, any>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [orgUnitOptions, setOrgUnitOptions] = useState<OrgUnitOption[]>([]);
  const [adminUserOptions, setAdminUserOptions] = useState<AdminUserOption[]>([]);
  const [assignmentDirectoryLoading, setAssignmentDirectoryLoading] = useState(false);
  const [assignmentDirectoryError, setAssignmentDirectoryError] = useState<string | null>(null);
  const [handledQueryTaskId, setHandledQueryTaskId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const taskIdFromQuery = useMemo(() => {
    const searchParams = new URLSearchParams(location.search || '');
    return String(searchParams.get('taskId') || searchParams.get('task') || '').trim();
  }, [location.search]);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const orgUnitLabelById = useMemo(
    () => new Map(orgUnitOptions.map((entry) => [entry.id, entry.label])),
    [orgUnitOptions]
  );
  const userLabelById = useMemo(
    () => new Map(adminUserOptions.map((entry) => [entry.id, buildUserLabel(entry)])),
    [adminUserOptions]
  );
  const sortedOrgUnits = useMemo(
    () => [...orgUnitOptions].sort((a, b) => compareText(a.label, b.label)),
    [orgUnitOptions]
  );
  const sortedUsers = useMemo(
    () => [...adminUserOptions].sort((a, b) => compareText(buildUserLabel(a), buildUserLabel(b))),
    [adminUserOptions]
  );

  const getAssigneeLabel = useCallback(
    (task: InternalTaskItem): string => {
      if (task.assigneeUserId) {
        return userLabelById.get(task.assigneeUserId) || `User ${task.assigneeUserId}`;
      }
      if (task.assigneeOrgUnitId) {
        return orgUnitLabelById.get(task.assigneeOrgUnitId) || `Org ${task.assigneeOrgUnitId}`;
      }
      return 'Unzugewiesen';
    },
    [orgUnitLabelById, userLabelById]
  );

  const loadTaskDetail = useCallback(
    async (taskId: string) => {
      if (!taskId) return;
      setSelectedTaskId(taskId);
      try {
        const response = await axios.get<InternalTaskDetailResponse>(`/api/admin/internal-tasks/${taskId}`, { headers });
        const incomingTask = response.data?.task || null;
        setSelectedTask(incomingTask);
        setSelectedEvents(Array.isArray(response.data?.events) ? response.data.events : []);
      } catch (detailError: any) {
        setError(detailError?.response?.data?.message || 'Detailansicht konnte nicht geladen werden.');
      }
    },
    [headers]
  );

  const loadTasks = useCallback(async () => {
    const initial = tasks.length === 0;
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const response = await axios.get('/api/admin/internal-tasks', {
        headers,
        params: {
          status: statusFilter || undefined,
          assignment: assignmentFilter || undefined,
          limit: 200,
        },
      });
      const rows = Array.isArray(response.data?.items) ? response.data.items : [];
      setTasks(rows);

      if (selectedTaskId) {
        const refreshed = rows.find((entry: InternalTaskItem) => entry.id === selectedTaskId) || null;
        if (!refreshed) {
          setSelectedTaskId('');
          setSelectedTask(null);
          setSelectedEvents([]);
        } else {
          setSelectedTask((previous) => {
            if (!previous || previous.id !== selectedTaskId) return previous;
            return { ...previous, ...refreshed };
          });
        }
      }
    } catch (loadError: any) {
      setError(loadError?.response?.data?.message || 'Interne Aufgaben konnten nicht geladen werden.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [assignmentFilter, headers, selectedTaskId, statusFilter, tasks.length]);

  const loadAssignmentDirectory = useCallback(async () => {
    if (!token) return;
    setAssignmentDirectoryLoading(true);
    setAssignmentDirectoryError(null);
    try {
      const [tenantsRes, usersRes] = await Promise.all([
        axios.get('/api/admin/tenants', { headers }),
        axios.get('/api/admin/users', { headers }),
      ]);

      const tenants: Array<{ id: string; name: string }> = Array.isArray(tenantsRes.data)
        ? tenantsRes.data
            .map((row: any) => ({
              id: String(row?.id || '').trim(),
              name: String(row?.name || '').trim(),
            }))
            .filter((row: { id: string }) => !!row.id)
        : [];

      const users: AdminUserOption[] = Array.isArray(usersRes.data)
        ? usersRes.data
            .map((row: any) => ({
              id: String(row?.id || '').trim(),
              username: String(row?.username || '').trim(),
              email: row?.email ? String(row.email) : null,
              firstName: row?.first_name ? String(row.first_name) : row?.firstName ? String(row.firstName) : null,
              lastName: row?.last_name ? String(row.last_name) : row?.lastName ? String(row.lastName) : null,
              role: row?.role ? String(row.role) : null,
              active: !!row?.active,
            }))
            .filter((row: AdminUserOption) => !!row.id)
        : [];
      setAdminUserOptions(users);

      const unitResponses = await Promise.all(
        tenants.map(async (tenant) => {
          try {
            const response = await axios.get(`/api/admin/tenants/${tenant.id}/org-units`, {
              headers,
              params: { includeInactive: true },
            });
            return { tenant, rows: Array.isArray(response.data) ? response.data : [] };
          } catch {
            return { tenant, rows: [] as any[] };
          }
        })
      );

      const units: OrgUnitOption[] = [];
      for (const entry of unitResponses) {
        const labelsById = buildOrgUnitPathMap(entry.rows);
        entry.rows.forEach((row: any) => {
          const id = String(row?.id || '').trim();
          if (!id) return;
          const baseLabel = labelsById[id] || String(row?.name || '').trim() || id;
          const tenantPrefix = entry.tenant?.name ? `${entry.tenant.name} / ` : '';
          units.push({
            id,
            tenantId: String(row?.tenantId || row?.tenant_id || entry.tenant?.id || '').trim(),
            label: `${tenantPrefix}${baseLabel}`,
            active: row?.active !== false,
          });
        });
      }
      units.sort((a, b) => compareText(a.label, b.label));
      setOrgUnitOptions(units);
    } catch {
      setAssignmentDirectoryError('Zuweisungsdaten konnten nicht geladen werden.');
    } finally {
      setAssignmentDirectoryLoading(false);
    }
  }, [headers, token]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    void loadAssignmentDirectory();
  }, [loadAssignmentDirectory]);

  useEffect(() => {
    if (!taskIdFromQuery) return;
    if (handledQueryTaskId === taskIdFromQuery) return;
    setHandledQueryTaskId(taskIdFromQuery);
    void loadTaskDetail(taskIdFromQuery);
  }, [handledQueryTaskId, loadTaskDetail, taskIdFromQuery]);

  useEffect(() => {
    if (!selectedTask) {
      setAssignmentTarget('');
      setActionNote('');
      setActionResponse('{}');
      setResponseFormValues({});
      setActionError(null);
      return;
    }
    if (selectedTask.assigneeUserId) setAssignmentTarget(`user:${selectedTask.assigneeUserId}`);
    else if (selectedTask.assigneeOrgUnitId) setAssignmentTarget(`org:${selectedTask.assigneeOrgUnitId}`);
    else setAssignmentTarget('');
    const parsedResponse =
      selectedTask.response && typeof selectedTask.response === 'object' && !Array.isArray(selectedTask.response)
        ? (selectedTask.response as Record<string, any>)
        : {};
    const formFields = normalizeInternalTaskFormFields(selectedTask.formSchema);
    const nextFormValues: Record<string, any> = {};
    formFields.forEach((field) => {
      nextFormValues[field.key] = normalizeInternalTaskFieldValue(field, parsedResponse[field.key]);
    });
    setResponseFormValues(nextFormValues);
    setActionNote('');
    setActionResponse(JSON.stringify(parsedResponse, null, 2));
    setActionError(null);
  }, [
    selectedTask?.id,
    selectedTask?.assigneeOrgUnitId,
    selectedTask?.assigneeUserId,
    selectedTask?.formSchema,
    selectedTask?.response,
  ]);

  const parseResponsePayload = useCallback((raw: string): { ok: boolean; payload: Record<string, any>; error?: string } => {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, payload: {} };
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, payload: {}, error: 'Antwortdaten müssen ein JSON-Objekt sein.' };
      }
      return { ok: true, payload: parsed as Record<string, any> };
    } catch {
      return { ok: false, payload: {}, error: 'Antwortdaten müssen gültiges JSON sein.' };
    }
  }, []);

  const startTask = useCallback(
    async (task: InternalTaskItem, claimSelf = false) => {
      if (!task?.id) return;
      setSubmittingTaskId(task.id);
      setError(null);
      setMessage(null);
      try {
        const response = await axios.post(
          `/api/admin/internal-tasks/${task.id}/start`,
          {
            claimSelf,
          },
          { headers }
        );
        setMessage(
          response.data?.claimed
            ? 'Interne Aufgabe übernommen und in Bearbeitung gesetzt.'
            : 'Interne Aufgabe in Bearbeitung gesetzt.'
        );
        await loadTasks();
        await loadTaskDetail(response.data?.task?.id || task.id);
      } catch (actionErr: any) {
        setError(actionErr?.response?.data?.message || 'Starten der Aufgabe fehlgeschlagen.');
      } finally {
        setSubmittingTaskId(null);
      }
    },
    [headers, loadTaskDetail, loadTasks]
  );

  const executeTaskAction = useCallback(
    async (
      task: InternalTaskItem,
      action: 'complete' | 'reject',
      options?: { note?: string; payload?: Record<string, any> }
    ) => {
      if (!task?.id) return;
      const isDetailAction = selectedTask?.id === task.id && !options;
      setActionError(null);

      const taskFormFields = normalizeInternalTaskFormFields(task.formSchema);
      const hasRequiredFormFields = taskFormFields.some((field) => field.required);
      if (options?.payload && hasRequiredFormFields) {
        setError('Diese Aufgabe hat Pflichtfelder. Bitte in der Detailansicht ausfüllen und dort abschließen.');
        return;
      }

      let responsePayload = options?.payload;
      if (!responsePayload) {
        const parsed = parseResponsePayload(actionResponse);
        if (!parsed.ok) {
          if (isDetailAction) setActionError(parsed.error || 'Ungültige Antwortdaten.');
          else setError(parsed.error || 'Ungültige Antwortdaten.');
          return;
        }
        responsePayload = parsed.payload;

        if (isDetailAction && taskFormFields.length > 0) {
          responsePayload = {
            ...responsePayload,
            ...buildInternalTaskFormPayload(taskFormFields, responseFormValues),
          };
        }
      }

      const missingRequiredFields = validateInternalTaskRequiredFields(taskFormFields, responsePayload || {});
      if (missingRequiredFields.length > 0) {
        const messageText = `Pflichtfelder fehlen: ${missingRequiredFields.join(', ')}`;
        if (isDetailAction) setActionError(messageText);
        else setError(messageText);
        return;
      }

      setSubmittingTaskId(task.id);
      setError(null);
      setMessage(null);
      try {
        const response = await axios.post(
          `/api/admin/internal-tasks/${task.id}/${action}`,
          {
            note: (options?.note ?? actionNote).trim(),
            response: responsePayload,
          },
          { headers }
        );
        setMessage(action === 'complete' ? 'Interne Aufgabe abgeschlossen.' : 'Interne Aufgabe abgelehnt.');
        await loadTasks();
        await loadTaskDetail(response.data?.task?.id || task.id);
      } catch (actionErr: any) {
        setError(actionErr?.response?.data?.message || 'Aktion fehlgeschlagen.');
      } finally {
        setSubmittingTaskId(null);
      }
    },
    [
      actionNote,
      actionResponse,
      headers,
      loadTaskDetail,
      loadTasks,
      parseResponsePayload,
      responseFormValues,
      selectedTask?.id,
    ]
  );

  const handleReassign = useCallback(async () => {
    if (!selectedTask) return;
    const parsed = parseAssignmentTarget(assignmentTarget);
    setReassigning(true);
    setError(null);
    setMessage(null);
    try {
      await axios.post(
        `/api/admin/internal-tasks/${selectedTask.id}/reassign`,
        {
          assigneeUserId: parsed.userId || null,
          assigneeOrgUnitId: parsed.orgUnitId || null,
        },
        { headers }
      );
      setMessage('Interne Aufgabe neu zugewiesen.');
      await loadTasks();
      await loadTaskDetail(selectedTask.id);
    } catch (actionErr: any) {
      setError(actionErr?.response?.data?.message || 'Neuzuweisung fehlgeschlagen.');
    } finally {
      setReassigning(false);
    }
  }, [assignmentTarget, headers, loadTaskDetail, loadTasks, selectedTask]);

  const sortedAndFilteredTasks = useMemo(() => {
    const nowMs = Date.now();
    const searchTerm = search.trim().toLowerCase();
    const filtered = tasks.filter((task) => {
      if (modeFilter && task.mode !== modeFilter) return false;
      if (onlyActionable && !isTaskActionable(task.status)) return false;
      if (dueFilter === 'overdue' && !isTaskOverdue(task, nowMs)) return false;
      if (dueFilter === 'today' && !isTaskDueToday(task, nowMs)) return false;
      if (dueFilter === 'without_due' && !!task.dueAt) return false;

      if (!searchTerm) return true;
      const haystack = [
        task.id,
        task.title,
        task.description,
        task.ticketId,
        task.workflowExecutionId,
        task.ticketCategory,
        task.ticketStatus,
        task.ticketPriority,
        STATUS_LABELS[task.status] || task.status,
        task.mode === 'parallel' ? 'parallel' : 'blockierend',
        getAssigneeLabel(task),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchTerm);
    });

    const sorted = [...filtered].sort((left, right) => {
      let comparison = 0;
      switch (tableSortKey) {
        case 'title':
          comparison = compareText(String(left.title || left.id), String(right.title || right.id));
          break;
        case 'status':
          comparison = STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status];
          break;
        case 'mode':
          comparison = compareText(left.mode === 'parallel' ? 'parallel' : 'blocking', right.mode === 'parallel' ? 'parallel' : 'blocking');
          break;
        case 'assignee':
          comparison = compareText(getAssigneeLabel(left), getAssigneeLabel(right));
          break;
        case 'ticketId':
          comparison = compareText(String(left.ticketId || ''), String(right.ticketId || ''));
          break;
        case 'createdAt': {
          const leftMs = parseDateMs(left.createdAt) ?? 0;
          const rightMs = parseDateMs(right.createdAt) ?? 0;
          comparison = leftMs - rightMs;
          break;
        }
        case 'dueAt':
        default: {
          const leftMs = parseDateMs(left.dueAt);
          const rightMs = parseDateMs(right.dueAt);
          if (leftMs === null && rightMs === null) comparison = 0;
          else if (leftMs === null) comparison = 1;
          else if (rightMs === null) comparison = -1;
          else comparison = leftMs - rightMs;
          break;
        }
      }
      if (comparison === 0) comparison = compareText(String(left.id || ''), String(right.id || ''));
      return tableSortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [dueFilter, getAssigneeLabel, modeFilter, onlyActionable, search, tableSortDirection, tableSortKey, tasks]);

  const tableTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedAndFilteredTasks.length / tablePageSize)),
    [sortedAndFilteredTasks.length, tablePageSize]
  );

  const pagedTasks = useMemo(() => {
    const start = (tablePage - 1) * tablePageSize;
    return sortedAndFilteredTasks.slice(start, start + tablePageSize);
  }, [sortedAndFilteredTasks, tablePage, tablePageSize]);

  useEffect(() => {
    setTablePage(1);
  }, [statusFilter, assignmentFilter, modeFilter, dueFilter, onlyActionable, search, tablePageSize]);

  useEffect(() => {
    setTablePage((current) => Math.min(current, tableTotalPages));
  }, [tableTotalPages]);

  const statusCounts = useMemo(() => {
    const counts = {
      total: tasks.length,
      pending: 0,
      in_progress: 0,
      completed: 0,
      rejected: 0,
      cancelled: 0,
      overdue: 0,
    };
    const nowMs = Date.now();
    tasks.forEach((task) => {
      counts[task.status] += 1;
      if (isTaskOverdue(task, nowMs)) counts.overdue += 1;
    });
    return counts;
  }, [tasks]);

  const selectedAssignmentLabel = useMemo(() => {
    if (!selectedTask) return '–';
    return getAssigneeLabel(selectedTask);
  }, [getAssigneeLabel, selectedTask]);
  const selectedTaskFormFields = useMemo(
    () => normalizeInternalTaskFormFields(selectedTask?.formSchema),
    [selectedTask?.formSchema]
  );
  const selectedTaskHasRequiredFormFields = useMemo(
    () => selectedTaskFormFields.some((field) => field.required),
    [selectedTaskFormFields]
  );

  const assignmentDirty = useMemo(() => {
    if (!selectedTask) return false;
    const current = selectedTask.assigneeUserId
      ? `user:${selectedTask.assigneeUserId}`
      : selectedTask.assigneeOrgUnitId
      ? `org:${selectedTask.assigneeOrgUnitId}`
      : '';
    return assignmentTarget !== current;
  }, [assignmentTarget, selectedTask]);

  const toggleSort = (key: TaskSortKey) => {
    if (tableSortKey === key) {
      setTableSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setTableSortKey(key);
    setTableSortDirection('asc');
  };

  const sortIndicator = (key: TaskSortKey) => {
    if (tableSortKey !== key) return '↕';
    return tableSortDirection === 'asc' ? '↑' : '↓';
  };

  const clearAllFilters = () => {
    setStatusFilter('');
    setAssignmentFilter('');
    setModeFilter('');
    setDueFilter('all');
    setOnlyActionable(false);
    setSearch('');
    setTableSortKey('dueAt');
    setTableSortDirection('asc');
    setTablePageSize(25);
  };

  const firstVisible = sortedAndFilteredTasks.length === 0 ? 0 : (tablePage - 1) * tablePageSize + 1;
  const lastVisible = Math.min(tablePage * tablePageSize, sortedAndFilteredTasks.length);

  return (
    <div className="internal-tasks-page">
      <div className="internal-tasks-header card">
        <div>
          <p className="internal-tasks-kicker">Workflow Inbox</p>
          <h2>Interne Aufgaben</h2>
          <p>Smart Table für Workflow-Schritte vom Typ „Interne Bearbeitung“.</p>
        </div>
        <div className="internal-tasks-header-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void loadTasks()} disabled={loading || refreshing}>
            <i className={`fa-solid ${refreshing ? 'fa-spinner fa-spin' : 'fa-rotate'}`} /> Aktualisieren
          </button>
        </div>
      </div>

      <div className="internal-tasks-metrics">
        <div className="metric-card">
          <span>Gesamt</span>
          <strong>{statusCounts.total}</strong>
        </div>
        <div className="metric-card">
          <span>Offen/In Arbeit</span>
          <strong>{statusCounts.pending + statusCounts.in_progress}</strong>
        </div>
        <div className="metric-card">
          <span>Überfällig</span>
          <strong className={statusCounts.overdue > 0 ? 'danger' : ''}>{statusCounts.overdue}</strong>
        </div>
        <div className="metric-card">
          <span>Sichtbar</span>
          <strong>{sortedAndFilteredTasks.length}</strong>
        </div>
      </div>

      <div className="internal-tasks-filters card">
        <div className="internal-tasks-filters-grid">
          <label className="filter-group">
            <span>Status (Server)</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-group">
            <span>Zuweisung (Server)</span>
            <select value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)}>
              {ASSIGNMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-group">
            <span>Modus</span>
            <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-group">
            <span>Fälligkeit</span>
            <select value={dueFilter} onChange={(event) => setDueFilter(event.target.value as DueFilter)}>
              {DUE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-group grow">
            <span>Suche</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Titel, Ticket, Workflow, Kategorie, Zuweisung ..."
            />
          </label>
          <label className="filter-group filter-pagesize">
            <span>Zeilen</span>
            <select value={String(tablePageSize)} onChange={(event) => setTablePageSize(Number(event.target.value) || 25)}>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={String(size)}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="internal-tasks-filters-footer">
          <label className="inline-check">
            <input
              type="checkbox"
              checked={onlyActionable}
              onChange={(event) => setOnlyActionable(event.target.checked)}
            />
            <span>Nur offene Aufgaben anzeigen</span>
          </label>
          <div className="filter-hint">
            {refreshing ? 'Aktualisiere…' : `Treffer ${firstVisible}–${lastVisible} von ${sortedAndFilteredTasks.length}`}
          </div>
          <button type="button" className="btn btn-secondary" onClick={clearAllFilters}>
            Filter zurücksetzen
          </button>
        </div>
      </div>

      {error && <div className="internal-tasks-alert error">{error}</div>}
      {message && <div className="internal-tasks-alert success">{message}</div>}

      <div className="internal-tasks-layout">
        <div className="internal-tasks-list card">
          <div className="internal-tasks-list-head">
            <h3>Smart Table</h3>
            <span>{sortedAndFilteredTasks.length} Aufgaben</span>
          </div>

          {loading && tasks.length === 0 ? (
            <p className="internal-tasks-empty">
              <i className="fa-solid fa-spinner fa-spin" /> Lade interne Aufgaben...
            </p>
          ) : sortedAndFilteredTasks.length === 0 ? (
            <p className="internal-tasks-empty">Keine passenden Aufgaben gefunden.</p>
          ) : (
            <>
              <div className="internal-tasks-table-wrap">
                <table className="internal-tasks-table">
                  <thead>
                    <tr>
                      <th>
                        <button type="button" className="table-sort" onClick={() => toggleSort('title')}>
                          Aufgabe <span className="sort-indicator">{sortIndicator('title')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort" onClick={() => toggleSort('status')}>
                          Status <span className="sort-indicator">{sortIndicator('status')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort" onClick={() => toggleSort('mode')}>
                          Modus <span className="sort-indicator">{sortIndicator('mode')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort" onClick={() => toggleSort('assignee')}>
                          Zuweisung <span className="sort-indicator">{sortIndicator('assignee')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort" onClick={() => toggleSort('dueAt')}>
                          Fällig <span className="sort-indicator">{sortIndicator('dueAt')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort" onClick={() => toggleSort('createdAt')}>
                          Erstellt <span className="sort-indicator">{sortIndicator('createdAt')}</span>
                        </button>
                      </th>
                      <th>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTasks.map((task) => {
                      const overdue = isTaskOverdue(task, Date.now());
                      const actionable = isTaskActionable(task.status);
                      const startable = task.status === 'pending' || task.status === 'in_progress';
                      const quickActionLocked = normalizeInternalTaskFormFields(task.formSchema).some(
                        (field) => field.required
                      );
                      const selected = selectedTaskId === task.id;
                      return (
                        <tr
                          key={task.id}
                          className={`${selected ? 'is-selected' : ''} ${overdue ? 'is-overdue' : ''}`.trim()}
                          onClick={() => void loadTaskDetail(task.id)}
                        >
                          <td>
                            <div className="task-cell">
                              <strong className="task-title">{task.title || task.id}</strong>
                              <div className="task-sub">
                                <span className="ticket-id">Ticket {task.ticketId}</span>
                                <span>Workflow {task.workflowExecutionId}</span>
                              </div>
                              <div className="task-sub">
                                <span>Kategorie: {task.ticketCategory || '–'}</span>
                                <span>Priorität: {task.ticketPriority || '–'}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`status-pill status-${task.status}`}>{STATUS_LABELS[task.status] || task.status}</span>
                          </td>
                          <td>
                            <span className="mode-pill">{task.mode === 'parallel' ? 'Parallel' : 'Blockierend'}</span>
                          </td>
                          <td>{getAssigneeLabel(task)}</td>
                          <td>
                            <div className="due-cell">
                              <span>{formatDateTime(task.dueAt)}</span>
                              {overdue && <small>Überfällig</small>}
                            </div>
                          </td>
                          <td>{formatDateTime(task.createdAt)}</td>
                          <td onClick={(event) => event.stopPropagation()}>
                            <div className="task-actions">
                              <button type="button" className="btn btn-secondary btn-compact" onClick={() => void loadTaskDetail(task.id)}>
                                Öffnen
                              </button>
                              <Link to={`/tickets/${encodeURIComponent(task.ticketId)}`} className="btn btn-secondary btn-compact">
                                Ticket
                              </Link>
                              <button
                                type="button"
                                className="btn btn-secondary btn-compact"
                                disabled={!startable || submittingTaskId === task.id}
                                onClick={() => void startTask(task, false)}
                              >
                                Start
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-compact"
                                disabled={!startable || submittingTaskId === task.id}
                                onClick={() => void startTask(task, true)}
                              >
                                Übernehmen
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary btn-compact"
                                disabled={!actionable || submittingTaskId === task.id || quickActionLocked}
                                title={quickActionLocked ? 'Pflichtfelder vorhanden: bitte Detailansicht nutzen.' : undefined}
                                onClick={() =>
                                  void executeTaskAction(task, 'complete', {
                                    note: '',
                                    payload: {},
                                  })
                                }
                              >
                                Abschluss
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger btn-compact"
                                disabled={!actionable || submittingTaskId === task.id || quickActionLocked}
                                title={quickActionLocked ? 'Pflichtfelder vorhanden: bitte Detailansicht nutzen.' : undefined}
                                onClick={() =>
                                  void executeTaskAction(task, 'reject', {
                                    note: '',
                                    payload: {},
                                  })
                                }
                              >
                                Ablehnen
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="internal-tasks-pagination">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setTablePage((current) => Math.max(1, current - 1))}
                  disabled={tablePage <= 1}
                >
                  Zurück
                </button>
                <span>
                  Seite {tablePage} von {tableTotalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setTablePage((current) => Math.min(tableTotalPages, current + 1))}
                  disabled={tablePage >= tableTotalPages}
                >
                  Weiter
                </button>
              </div>
            </>
          )}
        </div>

        <div className="internal-tasks-detail card">
          {!selectedTask ? (
            <p className="internal-tasks-empty">Aufgabe in der Liste auswählen, um Details zu sehen.</p>
          ) : (
            <>
              <div className="detail-head">
                <div>
                  <h3>{selectedTask.title || selectedTask.id}</h3>
                  <p className="detail-meta">
                    <Link to={`/tickets/${encodeURIComponent(selectedTask.ticketId)}`}>Ticket {selectedTask.ticketId}</Link>
                    <span>Workflow {selectedTask.workflowExecutionId}</span>
                    <span>Schritt {selectedTask.stepId}</span>
                  </p>
                </div>
                <div className="detail-head-badges">
                  <span className={`status-pill status-${selectedTask.status}`}>
                    {STATUS_LABELS[selectedTask.status] || selectedTask.status}
                  </span>
                  <span className="mode-pill">{selectedTask.mode === 'parallel' ? 'Parallel' : 'Blockierend'}</span>
                </div>
              </div>

              {selectedTask.description && <p className="detail-description">{selectedTask.description}</p>}
              {selectedTask.instructions && (
                <div className="detail-instructions">
                  <strong>Anweisungen</strong>
                  <p>{selectedTask.instructions}</p>
                </div>
              )}

              <div className="detail-grid">
                <div>
                  <strong>Zuweisung</strong>
                  <span>{selectedAssignmentLabel}</span>
                </div>
                <div>
                  <strong>Fällig</strong>
                  <span>{formatDateTime(selectedTask.dueAt)}</span>
                </div>
                <div>
                  <strong>Erstellt</strong>
                  <span>{formatDateTime(selectedTask.createdAt)}</span>
                </div>
                <div>
                  <strong>Abgeschlossen</strong>
                  <span>{formatDateTime(selectedTask.completedAt)}</span>
                </div>
                <div>
                  <strong>Ticketstatus</strong>
                  <span>{selectedTask.ticketStatus || '–'}</span>
                </div>
                <div>
                  <strong>Kategorie / Priorität</strong>
                  <span>
                    {selectedTask.ticketCategory || '–'} / {selectedTask.ticketPriority || '–'}
                  </span>
                </div>
              </div>

              <section className="detail-section">
                <h4>Zuweisung ändern</h4>
                <div className="detail-form-row">
                  <select value={assignmentTarget} onChange={(event) => setAssignmentTarget(event.target.value)}>
                    <option value="">Unzugewiesen</option>
                    <optgroup label="Benutzer">
                      {sortedUsers.map((user) => (
                        <option key={`user-${user.id}`} value={`user:${user.id}`}>
                          {buildUserLabel(user)}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Organisationseinheiten">
                      {sortedOrgUnits.map((orgUnit) => (
                        <option key={`org-${orgUnit.id}`} value={`org:${orgUnit.id}`}>
                          {orgUnit.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handleReassign()}
                    disabled={!assignmentDirty || reassigning}
                  >
                    {reassigning ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" /> Speichern...
                      </>
                    ) : (
                      'Speichern'
                    )}
                  </button>
                </div>
                {assignmentDirectoryLoading && <p className="helper-text">Lade verfügbare Benutzer und Bereiche…</p>}
                {assignmentDirectoryError && <p className="helper-text error">{assignmentDirectoryError}</p>}
              </section>

              <section className="detail-section">
                <h4>Aktion ausführen</h4>
                {selectedTaskFormFields.length > 0 && (
                  <>
                    <div className="internal-task-form-grid">
                      {selectedTaskFormFields.map((field) => {
                        const rawValue = responseFormValues[field.key];
                        if (field.type === 'boolean') {
                          return (
                            <label key={`${selectedTask.id}-field-${field.key}`} className="internal-task-form-check">
                              <input
                                type="checkbox"
                                checked={rawValue === true}
                                onChange={(event) =>
                                  setResponseFormValues((current) => ({
                                    ...current,
                                    [field.key]: event.target.checked,
                                  }))
                                }
                              />
                              <span>{field.required ? `${field.label} *` : field.label}</span>
                            </label>
                          );
                        }

                        if (field.type === 'textarea') {
                          return (
                            <label key={`${selectedTask.id}-field-${field.key}`} className="internal-task-form-field span-2">
                              <span>{field.required ? `${field.label} *` : field.label}</span>
                              <textarea
                                rows={3}
                                value={String(rawValue ?? '')}
                                onChange={(event) =>
                                  setResponseFormValues((current) => ({
                                    ...current,
                                    [field.key]: event.target.value,
                                  }))
                                }
                                placeholder={field.placeholder || ''}
                              />
                              {field.helpText && <small className="helper-text">{field.helpText}</small>}
                            </label>
                          );
                        }

                        if (field.type === 'select') {
                          return (
                            <label key={`${selectedTask.id}-field-${field.key}`} className="internal-task-form-field">
                              <span>{field.required ? `${field.label} *` : field.label}</span>
                              <select
                                value={String(rawValue ?? '')}
                                onChange={(event) =>
                                  setResponseFormValues((current) => ({
                                    ...current,
                                    [field.key]: event.target.value,
                                  }))
                                }
                              >
                                <option value="">Bitte wählen…</option>
                                {(field.options || []).map((option) => (
                                  <option key={`${field.key}-option-${option.value}`} value={option.value}>
                                    {option.label || option.value}
                                  </option>
                                ))}
                              </select>
                              {field.helpText && <small className="helper-text">{field.helpText}</small>}
                            </label>
                          );
                        }

                        const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
                        return (
                          <label key={`${selectedTask.id}-field-${field.key}`} className="internal-task-form-field">
                            <span>{field.required ? `${field.label} *` : field.label}</span>
                            <input
                              type={inputType}
                              value={String(rawValue ?? '')}
                              onChange={(event) =>
                                setResponseFormValues((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                              placeholder={field.placeholder || ''}
                            />
                            {field.helpText && <small className="helper-text">{field.helpText}</small>}
                          </label>
                        );
                      })}
                    </div>
                    <p className="helper-text">
                      Formularwerte werden beim Speichern in die Antwortdaten übernommen und überschreiben gleichnamige JSON-Keys.
                    </p>
                    {selectedTaskHasRequiredFormFields && <p className="helper-text">Pflichtfelder sind mit * markiert.</p>}
                  </>
                )}
                <label>
                  <span>Notiz</span>
                  <textarea
                    value={actionNote}
                    onChange={(event) => setActionNote(event.target.value)}
                    rows={3}
                    placeholder="Optionaler Kommentar für den Workflow-Verlauf"
                  />
                </label>
                <label>
                  <span>Antwortdaten (JSON)</span>
                  <textarea value={actionResponse} onChange={(event) => setActionResponse(event.target.value)} rows={6} />
                </label>
                {actionError && <div className="internal-tasks-alert error">{actionError}</div>}
                <div className="detail-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!isTaskActionable(selectedTask.status) || submittingTaskId === selectedTask.id}
                    onClick={() => void startTask(selectedTask, false)}
                  >
                    {submittingTaskId === selectedTask.id ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" /> Verarbeite...
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-play" /> Starten
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!isTaskActionable(selectedTask.status) || submittingTaskId === selectedTask.id}
                    onClick={() => void startTask(selectedTask, true)}
                  >
                    {submittingTaskId === selectedTask.id ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" /> Verarbeite...
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-hand" /> Übernehmen
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!isTaskActionable(selectedTask.status) || submittingTaskId === selectedTask.id}
                    onClick={() => void executeTaskAction(selectedTask, 'complete')}
                  >
                    {submittingTaskId === selectedTask.id ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" /> Verarbeite...
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-check" /> Abschließen
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={!isTaskActionable(selectedTask.status) || submittingTaskId === selectedTask.id}
                    onClick={() => void executeTaskAction(selectedTask, 'reject')}
                  >
                    {submittingTaskId === selectedTask.id ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" /> Verarbeite...
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-ban" /> Ablehnen
                      </>
                    )}
                  </button>
                </div>
                {!isTaskActionable(selectedTask.status) && (
                  <p className="helper-text">Diese Aufgabe ist bereits abgeschlossen und kann nicht erneut bearbeitet werden.</p>
                )}
              </section>

              <section className="detail-section">
                <h4>Ereignisjournal</h4>
                {selectedEvents.length === 0 ? (
                  <p className="internal-tasks-empty">Keine Ereignisse vorhanden.</p>
                ) : (
                  <ul className="event-list">
                    {selectedEvents.map((event) => (
                      <li key={event.id}>
                        <div className="event-head">
                          <strong>{EVENT_LABELS[event.eventType] || event.eventType}</strong>
                          <span>{formatDateTime(event.createdAt)}</span>
                        </div>
                        <div className="event-meta">Akteur: {event.actorUserId || 'system'}</div>
                        {event.payload && <pre>{JSON.stringify(event.payload, null, 2)}</pre>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default InternalTasks;
