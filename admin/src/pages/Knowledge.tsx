import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { MenuItem, TextField } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getAdminToken, isAdminRole, loadAuthState } from '../lib/auth';
import { useAdminScopeContext } from '../lib/adminScopeContext';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import './Knowledge.css';

interface RedmineProject {
  id: number;
  name: string;
  identifier: string;
  enabled: boolean;
}

type CategoryProcessingMode = 'internal' | 'external';
type CategoryProcessingModeValue = CategoryProcessingMode | '';

interface Category {
  id: string;
  name: string;
  description: string;
  keywords?: string[];
  locked?: boolean;
  isSystemCategory?: boolean;
  isInternal?: boolean;
  externalRecipientEmail?: string;
  externalRecipientName?: string;
  workflowTemplateId?: string;
  internalOrgUnitId?: string;
  processingMode?: CategoryProcessingModeValue;
  scope?: 'platform' | 'tenant';
  tenantId?: string;
  originId?: string;
  isOverride?: boolean;
}

interface InternalCategory extends Category {
  isInternal: true;
  redmineProject?: string;
  redmineTracker?: string;
  externalRecipientEmail?: string;
  externalRecipientName?: string;
  workflowTemplateId?: string;
}

interface ExternalCategory extends Category {
  isInternal: false;
  recipientEmail?: string;
}

interface KnowledgeBase {
  version: string;
  classifyPrompt: string;
  categories: InternalCategory[];
  externalCategories: ExternalCategory[];
  urgencies: any[];
  assignments?: any[];
}

interface KnowledgeProps {
  token?: string;
  role?: string | null;
}

interface KnowledgeCategoryTableRow {
  id: string;
  name: string;
  scopeLabel: string;
  scopeVariant: 'global' | 'tenant' | 'override';
  processingMode: string;
  description: string;
  keywords: string;
  recipient: string;
  internal: string;
  workflow: string;
  locked: boolean;
  raw: InternalCategory;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  enabled?: boolean;
}

interface TenantOption {
  id: string;
  name: string;
  active: boolean;
}

interface OrgUnitOption {
  id: string;
  tenantId: string;
  label: string;
  active: boolean;
}

function getAxiosErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data;
    if (typeof payload === 'string' && payload.trim()) {
      return payload;
    }
    if (payload && typeof payload === 'object') {
      const maybeMessage = (payload as { message?: unknown }).message;
      if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
        return maybeMessage;
      }
    }
    if (error.response?.status === 429) {
      return 'Zu viele Anfragen. Bitte kurz warten und erneut versuchen.';
    }
  }
  return fallback;
}

const resolveCategoryScopeBadge = (category: Category): {
  label: string;
  variant: 'global' | 'tenant' | 'override';
} => {
  const scope = category.scope === 'tenant' ? 'tenant' : 'platform';
  if (scope === 'platform') {
    return { label: 'Global', variant: 'global' };
  }
  if (category.isOverride) {
    return { label: 'Mandanten-Override', variant: 'override' };
  }
  return { label: 'Mandant', variant: 'tenant' };
};

const categoryScopeBadgeClass = (variant: 'global' | 'tenant' | 'override'): string => {
  if (variant === 'global') return 'border-sky-300 bg-sky-50 text-sky-800';
  if (variant === 'override') return 'border-amber-300 bg-amber-50 text-amber-800';
  return 'border-emerald-300 bg-emerald-50 text-emerald-800';
};

const normalizeCategoryProcessingMode = (value: unknown): CategoryProcessingModeValue => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'internal' || raw === 'intern') return 'internal';
  if (raw === 'external' || raw === 'extern') return 'external';
  return '';
};

const formatCategoryProcessingMode = (value: unknown): string => {
  const normalized = normalizeCategoryProcessingMode(value);
  if (normalized === 'internal') return 'Intern';
  if (normalized === 'external') return 'Extern';
  return '—';
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

    const chainGuard = new Set<string>();
    chainGuard.add(id);
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
  for (const id of byId.keys()) {
    out[id] = resolveLabel(id);
  }
  return out;
};

const Knowledge: React.FC<KnowledgeProps> = ({ token: tokenProp, role: roleProp }) => {
  const navigate = useNavigate();
  const authState = loadAuthState();
  const token = tokenProp || getAdminToken() || authState.token || '';
  const role = roleProp || authState.role || null;
  const { selection: scopeSelection } = useAdminScopeContext();
  const [knowledge, setKnowledge] = useState<KnowledgeBase | null>(null);
  const [activeTab, setActiveTab] = useState<'internal' | 'external' | 'prompt'>('internal');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [initialClassifyPrompt, setInitialClassifyPrompt] = useState('');
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplate[]>([]);
  const [categoryViewMode, setCategoryViewMode] = useState<'cards' | 'table'>('table');
  const [tableFilter, setTableFilter] = useState<'all' | 'locked' | 'unlocked' | 'withWorkflow' | 'withoutWorkflow'>('all');
  
  const [redmineProjects, setRedmineProjects] = useState<RedmineProject[]>([]);
  const [availableTrackers, setAvailableTrackers] = useState<{ id: number; name: string }[]>([]);
  const [orgUnitOptions, setOrgUnitOptions] = useState<OrgUnitOption[]>([]);

  const [editingCategory, setEditingCategory] = useState<(InternalCategory | ExternalCategory) | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const [assistantResult, setAssistantResult] = useState<{
    draft: Partial<Category> & { workflowTemplateReason?: string };
    nameConflict: boolean;
  } | null>(null);
  const canEdit = isAdminRole(role);
  const categories = knowledge?.categories || [];
  const workflowLabelById = useMemo(() => new Map(workflowTemplates.map((t) => [t.id, t.name])), [workflowTemplates]);
  const orgUnitLabelById = useMemo(() => new Map(orgUnitOptions.map((entry) => [entry.id, entry.label])), [orgUnitOptions]);
  const sortedOrgUnits = useMemo(
    () => [...orgUnitOptions].sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })),
    [orgUnitOptions]
  );
  const libraryScopeParams = useMemo(
    () =>
      scopeSelection.scope === 'tenant' && scopeSelection.tenantId
        ? { scope: 'tenant' as const, tenantId: scopeSelection.tenantId }
        : { scope: 'platform' as const, tenantId: '' },
    [scopeSelection.scope, scopeSelection.tenantId]
  );

  const tableCategories = useMemo(() => {
    const filtered = categories.filter((cat) => {
      if (tableFilter === 'locked' && !cat.locked) return false;
      if (tableFilter === 'unlocked' && cat.locked) return false;
      if (tableFilter === 'withWorkflow' && !cat.workflowTemplateId) return false;
      if (tableFilter === 'withoutWorkflow' && cat.workflowTemplateId) return false;
      return true;
    });

    return [...filtered].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de', { sensitivity: 'base' }));
  }, [categories, tableFilter]);

  const tableRows = useMemo<KnowledgeCategoryTableRow[]>(
    () =>
      tableCategories.map((cat) => {
        const scopeBadge = resolveCategoryScopeBadge(cat);
        return {
          id: cat.id,
          name: cat.name,
          scopeLabel: scopeBadge.label,
          scopeVariant: scopeBadge.variant,
          processingMode: formatCategoryProcessingMode(cat.processingMode),
          description: cat.description || '—',
          keywords: cat.keywords?.length ? cat.keywords.join(', ') : '—',
          recipient: cat.externalRecipientEmail
            ? `${cat.externalRecipientName || 'Empfänger'}: ${cat.externalRecipientEmail}`
            : '—',
          internal: cat.internalOrgUnitId
            ? orgUnitLabelById.get(cat.internalOrgUnitId) || cat.internalOrgUnitId
            : '—',
          workflow: cat.workflowTemplateId
            ? workflowLabelById.get(cat.workflowTemplateId) || cat.workflowTemplateId
            : '—',
          locked: !!cat.locked,
          raw: cat,
        };
      }),
    [tableCategories, orgUnitLabelById, workflowLabelById]
  );

  useEffect(() => {
    if (!token) {
      setError('Authentifizierung fehlt. Bitte erneut anmelden.');
      setIsLoading(false);
      return;
    }
    fetchKnowledge();
    fetchRedmineProjects();
    fetchWorkflowTemplates();
    fetchOrgUnits();
    // Set default trackers on load
    setAvailableTrackers([
      { id: 1, name: 'Bug' },
      { id: 2, name: 'Feature' },
      { id: 3, name: 'Support' },
      { id: 4, name: 'Defect' },
      { id: 5, name: 'Task' },
    ]);
  }, [token, libraryScopeParams.scope, libraryScopeParams.tenantId]);

  const fetchRedmineProjects = async () => {
    try {
      const response = await axios.get('/api/admin/config/redmine', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.data?.projects) {
        // Only show enabled projects
        const enabledProjects = response.data.projects.filter((p: any) => p.enabled);
        setRedmineProjects(enabledProjects);
      }
    } catch (err) {
      console.error('Fehler beim Laden der Redmine-Projekte:', err);
      setError(getAxiosErrorMessage(err, 'Redmine-Projekte konnten nicht geladen werden'));
    }
  };

  const fetchWorkflowTemplates = async () => {
    try {
      const response = await axios.get('/api/admin/config/workflow/templates', {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          scope: libraryScopeParams.scope,
          tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
        },
      });
      const templates = Array.isArray(response.data) ? response.data : [];
      setWorkflowTemplates(templates.filter((template: any) => template && template.id && template.name));
    } catch (err) {
      console.error('Fehler beim Laden der Workflow-Templates:', err);
      setError(getAxiosErrorMessage(err, 'Workflow-Templates konnten nicht geladen werden'));
      setWorkflowTemplates([]);
    }
  };

  const fetchOrgUnits = async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const tenantResponse = await axios.get('/api/admin/tenants', { headers });
      const tenants: TenantOption[] = Array.isArray(tenantResponse.data)
        ? tenantResponse.data
            .map((row: any) => ({
              id: String(row?.id || '').trim(),
              name: String(row?.name || '').trim(),
              active: !!row?.active,
            }))
            .filter((row: TenantOption) => !!row.id)
        : [];

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

      units.sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
      setOrgUnitOptions(units);
    } catch (err) {
      console.error('Fehler beim Laden der Organisationseinheiten:', err);
    }
  };

  const fetchAvailableTrackers = async (projectName: string | number) => {
    try {
      const response = await axios.get(`/api/admin/config/redmine/trackers/${projectName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.data?.trackers) {
        setAvailableTrackers(response.data.trackers);
      }
    } catch (err) {
      console.error('Fehler beim Laden der Tracker:', err);
      // Set default trackers on error
      setAvailableTrackers([
        { id: 1, name: 'Bug' },
        { id: 2, name: 'Feature' },
        { id: 3, name: 'Support' },
        { id: 4, name: 'Defect' },
        { id: 5, name: 'Task' },
      ]);
    }
  };

  const fetchKnowledge = async () => {
    try {
      const response = await axios.get('/api/knowledge', {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          scope: libraryScopeParams.scope,
          tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
          includeInherited: libraryScopeParams.scope === 'tenant' ? '1' : undefined,
        },
      });
      setKnowledge(response.data);
      setInitialClassifyPrompt(String(response.data?.classifyPrompt || ''));
    } catch (err) {
      setError(getAxiosErrorMessage(err, 'Fehler beim Laden der Kategorien'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSavePrompt = async () => {
    if (!knowledge) return;
    setIsSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      await axios.patch(
        '/api/knowledge/classify-prompt',
        { classifyPrompt: knowledge.classifyPrompt || '' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setInitialClassifyPrompt(knowledge.classifyPrompt || '');
      setSuccessMessage('Classify Prompt erfolgreich aktualisiert');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(getAxiosErrorMessage(err, 'Fehler beim Speichern des Classify Prompts'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCategory = async () => {
    if (!editingCategory) return;

    if (editingCategory.locked) {
      setError('Diese Kategorie ist geschützt und kann nicht bearbeitet werden');
      return;
    }

    setIsSaving(true);
    setError('');
    setSuccessMessage('');
    const payload = {
      ...editingCategory,
      processingMode: normalizeCategoryProcessingMode(editingCategory.processingMode),
    };
    try {
      await axios.patch(`/api/knowledge/categories/${editingCategory.id}`, payload, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          scope: libraryScopeParams.scope,
          tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
        },
      });
      setSuccessMessage('Kategorie erfolgreich aktualisiert');
      setEditingCategory(null);
      setTimeout(() => fetchKnowledge(), 500);
    } catch (error: any) {
      setError(getAxiosErrorMessage(error, 'Fehler beim Speichern'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!editingCategory || !editingCategory.name.trim()) {
      setError('Kategoriename erforderlich');
      return;
    }

    const slugBase = editingCategory.name
      .trim()
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const existingIds = new Set((knowledge?.categories || []).map((category) => String(category.id)));
    const baseId = slugBase || `kategorie-${Date.now()}`;
    let categoryId = baseId;
    let counter = 2;
    while (existingIds.has(categoryId)) {
      categoryId = `${baseId}-${counter}`;
      counter += 1;
    }

    const payload = {
      ...editingCategory,
      id: categoryId,
      name: editingCategory.name.trim(),
      description: editingCategory.description?.trim() || '',
      keywords: (editingCategory.keywords || []).map((keyword) => keyword.trim()).filter(Boolean),
      processingMode: normalizeCategoryProcessingMode(editingCategory.processingMode),
    };

    setIsSaving(true);
    setError('');
    setSuccessMessage('');
    try {
      await axios.post('/api/knowledge/categories', payload, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          scope: libraryScopeParams.scope,
          tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
        },
      });

      // Kategorien werden unabhängig von Workflows gepflegt

      setSuccessMessage('Kategorie erfolgreich erstellt');
      setEditingCategory(null);
      setIsAddingNew(false);
      setTimeout(() => fetchKnowledge(), 500);
    } catch (error: any) {
      setError(getAxiosErrorMessage(error, 'Fehler beim Erstellen'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Wirklich löschen?')) return;

    try {
      await axios.delete(`/api/knowledge/categories/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          scope: libraryScopeParams.scope,
          tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
        },
      });
      setSuccessMessage('Kategorie gelöscht');
      setTimeout(() => fetchKnowledge(), 500);
    } catch (error: any) {
      setError(getAxiosErrorMessage(error, 'Fehler beim Löschen'));
    }
  };

  const createNewCategory = (): Category => ({
    id: '',
    name: '',
    description: '',
    keywords: [],
    externalRecipientEmail: '',
    externalRecipientName: '',
    workflowTemplateId: '',
    internalOrgUnitId: '',
    processingMode: '',
  });

  const normalizeWorkflowTemplateId = (value?: string | null) => {
    if (!value) return '';
    const direct = workflowTemplates.some((template) => template.id === value);
    if (direct) return value;
    const byName = workflowTemplates.find((template) => template.name === value);
    return byName?.id || '';
  };

  const knowledgeTableColumns = useMemo<SmartTableColumnDef<KnowledgeCategoryTableRow>[]>(() => {
    const base: SmartTableColumnDef<KnowledgeCategoryTableRow>[] = [
      {
        field: 'name',
        headerName: 'Name',
        minWidth: 220,
        flex: 1,
        renderCell: (params) => (
          <span className="smart-table-multiline-text">
            {params.row.name} {params.row.locked ? <i className="fa-solid fa-lock lock-icon" /> : null}
          </span>
        ),
      },
      {
        field: 'scopeLabel',
        headerName: 'Gültigkeit',
        minWidth: 170,
        renderCell: (params) => (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${categoryScopeBadgeClass(params.row.scopeVariant)}`}
          >
            {params.row.scopeLabel}
          </span>
        ),
      },
      {
        field: 'processingMode',
        headerName: 'Bearbeitung',
        minWidth: 150,
        renderCell: (params) => <span>{params.row.processingMode}</span>,
      },
      {
        field: 'description',
        headerName: 'Beschreibung',
        minWidth: 280,
        flex: 1.4,
        renderCell: (params) => (
          <span className="smart-table-multiline-text" title={params.row.description}>
            {params.row.description}
          </span>
        ),
      },
      {
        field: 'keywords',
        headerName: 'Stichwörter',
        minWidth: 220,
        flex: 1,
        renderCell: (params) => (
          <span className="smart-table-multiline-text" title={params.row.keywords}>
            {params.row.keywords}
          </span>
        ),
      },
      {
        field: 'recipient',
        headerName: 'Externer Empfänger',
        minWidth: 250,
        flex: 1.1,
        renderCell: (params) => (
          <span className="smart-table-multiline-text" title={params.row.recipient}>
            {params.row.recipient}
          </span>
        ),
      },
      {
        field: 'internal',
        headerName: 'Interne Zuständigkeit',
        minWidth: 250,
        flex: 1.1,
        renderCell: (params) => (
          <span className="smart-table-multiline-text" title={params.row.internal}>
            {params.row.internal}
          </span>
        ),
      },
      {
        field: 'workflow',
        headerName: 'Workflow',
        minWidth: 230,
        flex: 1,
        renderCell: (params) => (
          <span className="smart-table-multiline-text" title={params.row.workflow}>
            {params.row.workflow}
          </span>
        ),
      },
    ];

    if (canEdit) {
      base.push({
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 108,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        hideable: false,
        renderCell: (params) =>
          params.row.locked ? (
            <span className="knowledge-table-empty">Geschützt</span>
          ) : (
            <SmartTableRowActions>
              <SmartTableRowActionButton
                label="Kategorie bearbeiten"
                icon={<EditOutlinedIcon fontSize="inherit" />}
                tone="primary"
                onClick={() => {
                  setCategoryViewMode('cards');
                  setIsAddingNew(false);
                  setEditingCategory({
                    ...params.row.raw,
                    workflowTemplateId: normalizeWorkflowTemplateId(params.row.raw.workflowTemplateId),
                    processingMode: normalizeCategoryProcessingMode(params.row.raw.processingMode),
                  });
                }}
              />
              <SmartTableRowActionButton
                label="Kategorie löschen"
                icon={<DeleteOutlineRoundedIcon fontSize="inherit" />}
                tone="danger"
                onClick={() => {
                  void handleDeleteCategory(params.row.id);
                }}
              />
            </SmartTableRowActions>
          ),
      });
    }
    return base;
  }, [canEdit, handleDeleteCategory, normalizeWorkflowTemplateId]);

  const normalizeDraftCategory = (
    draft: Partial<Category> & { workflowTemplateReason?: string },
    base?: Partial<Category>
  ): Category => {
    const keywords = Array.isArray(draft.keywords)
      ? draft.keywords.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    return {
      id: String(base?.id || draft.id || '').trim(),
      name: String(draft.name || base?.name || '').trim(),
      description: String(draft.description || base?.description || '').trim(),
      keywords,
      internalOrgUnitId: String(draft.internalOrgUnitId || base?.internalOrgUnitId || '').trim(),
      externalRecipientEmail: String(draft.externalRecipientEmail || base?.externalRecipientEmail || '').trim(),
      externalRecipientName: String(draft.externalRecipientName || base?.externalRecipientName || '').trim(),
      workflowTemplateId: normalizeWorkflowTemplateId(
        String(draft.workflowTemplateId || base?.workflowTemplateId || '').trim()
      ),
      processingMode: normalizeCategoryProcessingMode(draft.processingMode || base?.processingMode || ''),
    };
  };

  const handleGenerateCategoryDraft = async () => {
    if (!canEdit) return;
    const prompt = assistantPrompt.trim();
    if (prompt.length < 8) {
      setAssistantError('Bitte eine ausreichend konkrete Anforderung eingeben.');
      return;
    }

    setAssistantLoading(true);
    setAssistantError('');
    setAssistantResult(null);
    try {
      const response = await axios.post(
        '/api/knowledge/categories/assistant',
        {
          prompt,
          workflowTemplates: workflowTemplates.map((entry) => ({ id: entry.id, name: entry.name })),
          scope: libraryScopeParams.scope,
          tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : '',
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const draft = response.data?.draft;
      if (!draft || typeof draft !== 'object') {
        setAssistantError('Die KI hat keinen gültigen Entwurf zurückgegeben.');
        return;
      }
      const nameConflict = response.data?.nameConflict === true;
      setAssistantResult({
        draft,
        nameConflict,
      });
      setSuccessMessage('KI-Entwurf erzeugt. Prüfen und übernehmen.');
      setTimeout(() => setSuccessMessage(''), 2500);
    } catch (err) {
      setAssistantError(getAxiosErrorMessage(err, 'KI-Entwurf konnte nicht erzeugt werden.'));
    } finally {
      setAssistantLoading(false);
    }
  };

  const applyAssistantDraftAsNewCategory = () => {
    if (!assistantResult) return;
    const normalized = normalizeDraftCategory(assistantResult.draft);
    setCategoryViewMode('cards');
    setIsAddingNew(true);
    setEditingCategory({
      ...createNewCategory(),
      ...normalized,
      id: '',
    });
    setAssistantOpen(false);
  };

  const applyAssistantDraftToCurrentCategory = () => {
    if (!assistantResult || !editingCategory) return;
    const normalized = normalizeDraftCategory(assistantResult.draft, editingCategory);
    setEditingCategory({
      ...editingCategory,
      ...normalized,
      id: editingCategory.id,
    });
    setAssistantOpen(false);
  };

  const promptDirty = Boolean(
    knowledge && String(knowledge.classifyPrompt || '') !== String(initialClassifyPrompt || '')
  );

  if (isLoading) return <div className="loading">Lädt...</div>;

  return (
    <div className="knowledge-container">
      <div className="knowledge-header">
        <div>
          <h2>Kategorien</h2>
          <p className="knowledge-header-subtitle">
            Direkt bearbeitbar. Kein globaler Bearbeitungsmodus erforderlich.
          </p>
          <div className="mt-2">
            <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
              Aktueller Kontext: {libraryScopeParams.scope === 'tenant' ? 'Mandant' : 'Global'}
            </span>
          </div>
        </div>
        {canEdit && (
          <div className="knowledge-header-actions">
            <button
              type="button"
              className="btn-add-category"
              onClick={() => {
                setError('');
                setSuccessMessage('');
                setCategoryViewMode('cards');
                setEditingCategory(createNewCategory());
                setIsAddingNew(true);
              }}
            >
              <i className="fa-solid fa-plus" /> Neue Kategorie
            </button>
            <button
              type="button"
              className={`btn-add-workflow ${assistantOpen ? 'active' : ''}`}
              onClick={() => setAssistantOpen((prev) => !prev)}
            >
              <i className="fa-solid fa-wand-magic-sparkles" /> KI-Assistent
            </button>
          </div>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}

      {knowledge && (
        <>
          <div className="tabs">
            <button
              className={`tab-btn ${activeTab === 'internal' ? 'active' : ''}`}
              onClick={() => setActiveTab('internal')}
            >
              Kategorien ({categories.length})
            </button>
            <button
              className={`tab-btn ${activeTab === 'prompt' ? 'active' : ''}`}
              onClick={() => setActiveTab('prompt')}
            >
              Classify Prompt
            </button>
          </div>

          {activeTab === 'internal' && (
            <div className="tab-content">
              <div className="knowledge-section-head">
                <h3>Kategorien</h3>
                <div className="knowledge-view-toggle" role="group" aria-label="Ansicht">
                  <button
                    type="button"
                    className={`view-toggle-btn ${categoryViewMode === 'cards' ? 'active' : ''}`}
                    onClick={() => setCategoryViewMode('cards')}
                  >
                    <i className="fa-solid fa-grip" /> Kacheln
                  </button>
                  <button
                    type="button"
                    className={`view-toggle-btn ${categoryViewMode === 'table' ? 'active' : ''}`}
                    onClick={() => setCategoryViewMode('table')}
                  >
                    <i className="fa-solid fa-table" /> Tabelle
                  </button>
                </div>
              </div>
              <p className="section-desc">Kategorien für die automatische Zuordnung. Weiterleitungen erfolgen über Workflow-Definitionen.</p>
              {canEdit && (
                <div className="workflow-stub-actions">
                  <button
                    type="button"
                    className="btn-add-workflow"
                    onClick={() => navigate('/admin-settings/workflow?createWorkflow=1')}
                  >
                    <i className="fa-solid fa-diagram-project" /> Neuer Workflow erzeugen
                  </button>
                  <small>Öffnet den Workflow-Editor direkt im Erstellen-Modus.</small>
                </div>
              )}

              {canEdit && assistantOpen && (
                <div className="category-ai-panel">
                  <div className="category-ai-panel-head">
                    <h4><i className="fa-solid fa-wand-magic-sparkles" /> KI-Assistent für Kategorien</h4>
                    <p>
                      Beschreibe den Fall kurz. Die KI erzeugt einen Vorschlag für Name, Beschreibung, Keywords,
                      optionalen Empfänger und Workflow.
                    </p>
                  </div>
                  <textarea
                    value={assistantPrompt}
                    onChange={(event) => setAssistantPrompt(event.target.value)}
                    rows={4}
                    placeholder="Beispiel: Viele Meldungen zu beschädigten Straßenabläufen nach Starkregen. Zuständig ist Tiefbauamt."
                    className="prompt-textarea"
                  />
                  <div className="category-ai-actions">
                    <button
                      type="button"
                      className="btn-save"
                      disabled={assistantLoading}
                      onClick={() => void handleGenerateCategoryDraft()}
                    >
                      {assistantLoading ? (
                        <><i className="fa-solid fa-spinner fa-spin" /> Erzeuge Entwurf…</>
                      ) : (
                        <><i className="fa-solid fa-bolt" /> Entwurf erzeugen</>
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={() => {
                        setAssistantOpen(false);
                        setAssistantError('');
                      }}
                    >
                      Schließen
                    </button>
                  </div>
                  {assistantError && <div className="error-message">{assistantError}</div>}
                  {assistantResult && (
                    <div className="category-ai-result">
                      <h5>Vorschlag</h5>
                      <div className="category-ai-result-grid">
                        <div><strong>Name:</strong> {assistantResult.draft.name || '—'}</div>
                        <div><strong>Workflow:</strong> {assistantResult.draft.workflowTemplateId || '—'}</div>
                        <div className="full"><strong>Beschreibung:</strong> {assistantResult.draft.description || '—'}</div>
                        <div className="full">
                          <strong>Keywords:</strong>{' '}
                          {Array.isArray(assistantResult.draft.keywords) && assistantResult.draft.keywords.length
                            ? assistantResult.draft.keywords.join(', ')
                            : '—'}
                        </div>
                        {assistantResult.draft.workflowTemplateReason ? (
                          <div className="full">
                            <strong>Workflow-Begründung:</strong> {assistantResult.draft.workflowTemplateReason}
                          </div>
                        ) : null}
                      </div>
                      {assistantResult.nameConflict && (
                        <p className="category-ai-warning">
                          Der vorgeschlagene Name ähnelt einer bestehenden Kategorie. Bitte vor dem Speichern anpassen.
                        </p>
                      )}
                      <div className="category-ai-actions">
                        <button type="button" className="btn-save" onClick={applyAssistantDraftAsNewCategory}>
                          Als neue Kategorie übernehmen
                        </button>
                        {editingCategory && !isAddingNew ? (
                          <button type="button" className="btn-add-workflow" onClick={applyAssistantDraftToCurrentCategory}>
                            In aktuelle Bearbeitung übernehmen
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {isAddingNew && editingCategory && (
                <div className="category-edit-panel">
                  <h4>Neue Kategorie</h4>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Kategoriename *</label>
                      <input
                        type="text"
                        value={editingCategory.name}
                        onChange={(e) =>
                          setEditingCategory({ ...editingCategory, name: e.target.value })
                        }
                        placeholder="z.B. Schlaglöcher"
                      />
                    </div>
                    <div className="form-group">
                      <label>Beschreibung</label>
                      <textarea
                        value={editingCategory.description}
                        onChange={(e) =>
                          setEditingCategory({ ...editingCategory, description: e.target.value })
                        }
                        placeholder="Detaillierte Beschreibung für Classify Prompt"
                        rows={3}
                      />
                    </div>
                    <div className="form-group full">
                      <label>Stichwörter (kommagetrennt)</label>
                      <input
                        type="text"
                        value={(editingCategory.keywords || []).join(', ')}
                        onChange={(e) =>
                          setEditingCategory({
                            ...editingCategory,
                            keywords: e.target.value.split(',').map(k => k.trim()),
                          })
                        }
                        placeholder="loch, asphalt, straße"
                      />
                    </div>
                    <div className="form-group">
                      <label>Externe Empfänger-Email</label>
                      <input
                        type="email"
                        value={editingCategory.externalRecipientEmail || ''}
                        onChange={(e) =>
                          setEditingCategory({
                            ...editingCategory,
                            externalRecipientEmail: e.target.value,
                          })
                        }
                        placeholder="kontakt@externe-stelle.de"
                      />
                    </div>
                    <div className="form-group">
                      <label>Externer Empfänger (Name)</label>
                      <input
                        type="text"
                        value={editingCategory.externalRecipientName || ''}
                        onChange={(e) =>
                          setEditingCategory({
                            ...editingCategory,
                            externalRecipientName: e.target.value,
                          })
                        }
                        placeholder="z.B. Bauhof Otterbach"
                      />
                    </div>
                    <div className="form-group">
                      <label>Interne Zuständigkeit</label>
                      <select
                        value={editingCategory.internalOrgUnitId || ''}
                        onChange={(e) =>
                          setEditingCategory({
                            ...editingCategory,
                            internalOrgUnitId: e.target.value,
                          })
                        }
                      >
                        <option value="">-- Nicht gesetzt --</option>
                        {sortedOrgUnits.map((unit) => (
                          <option key={`internal-org-${unit.id}`} value={unit.id}>
                            {unit.active ? unit.label : `${unit.label} (inaktiv)`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Bearbeitung</label>
                      <select
                        value={normalizeCategoryProcessingMode(editingCategory.processingMode)}
                        onChange={(e) =>
                          setEditingCategory({
                            ...editingCategory,
                            processingMode: normalizeCategoryProcessingMode(e.target.value),
                          })
                        }
                      >
                        <option value="">-- Nicht gesetzt --</option>
                        <option value="internal">Intern</option>
                        <option value="external">Extern</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Workflow bei Kategorie</label>
                      <select
                        value={editingCategory.workflowTemplateId || ''}
                        onChange={(e) =>
                          setEditingCategory({
                            ...editingCategory,
                            workflowTemplateId: e.target.value,
                          })
                        }
                      >
                        <option value="">Kein Workflow</option>
                        {workflowTemplates.map((wf) => (
                          <option key={wf.id} value={wf.id}>
                            {wf.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="form-actions">
                    <button
                      onClick={handleCreateCategory}
                      disabled={isSaving}
                      className="btn-save"
                    >
                      ✓ Erstellen
                    </button>
                    <button
                      onClick={() => {
                        setEditingCategory(null);
                        setIsAddingNew(false);
                      }}
                      className="btn-cancel"
                    >
                      ✕ Abbrechen
                    </button>
                  </div>
                </div>
              )}

              {categoryViewMode === 'cards' ? (
                <div className="categories-list">
                  {categories.map((cat) => {
                    const scopeBadge = resolveCategoryScopeBadge(cat);
                    return (
                    <div key={cat.id} className={`category-item ${cat.locked ? 'locked' : ''}`}>
                      {editingCategory?.id === cat.id && !isAddingNew ? (
                        <div className="category-edit-panel">
                          <h4>Bearbeite: {cat.name}</h4>
                          <div className="form-grid">
                            <div className="form-group">
                              <label>Kategoriename</label>
                              <input
                                type="text"
                                value={editingCategory.name}
                                onChange={(e) =>
                                  setEditingCategory({ ...editingCategory, name: e.target.value })
                                }
                              />
                            </div>
                            <div className="form-group">
                              <label>Beschreibung</label>
                              <textarea
                                value={editingCategory.description}
                                onChange={(e) =>
                                  setEditingCategory({ ...editingCategory, description: e.target.value })
                                }
                                rows={3}
                              />
                            </div>
                            <div className="form-group full">
                              <label>Stichwörter (kommagetrennt)</label>
                              <input
                                type="text"
                                value={(editingCategory.keywords || []).join(', ')}
                                onChange={(e) =>
                                  setEditingCategory({
                                    ...editingCategory,
                                    keywords: e.target.value.split(',').map((k) => k.trim()),
                                  })
                                }
                              />
                            </div>
                            <div className="form-group">
                              <label>Externe Empfänger-Email</label>
                              <input
                                type="email"
                                value={editingCategory.externalRecipientEmail || ''}
                                onChange={(e) =>
                                  setEditingCategory({
                                    ...editingCategory,
                                    externalRecipientEmail: e.target.value,
                                  })
                                }
                                placeholder="kontakt@externe-stelle.de"
                              />
                            </div>
                            <div className="form-group">
                              <label>Externer Empfänger (Name)</label>
                              <input
                                type="text"
                                value={editingCategory.externalRecipientName || ''}
                            onChange={(e) =>
                              setEditingCategory({
                                ...editingCategory,
                                externalRecipientName: e.target.value,
                              })
                            }
                            placeholder="z.B. Bauhof Otterbach"
                          />
                        </div>
                        <div className="form-group">
                          <label>Interne Zuständigkeit</label>
                          <select
                            value={editingCategory.internalOrgUnitId || ''}
                            onChange={(e) =>
                              setEditingCategory({
                                ...editingCategory,
                                internalOrgUnitId: e.target.value,
                              })
                            }
                          >
                            <option value="">-- Nicht gesetzt --</option>
                            {sortedOrgUnits.map((unit) => (
                              <option key={`internal-org-edit-${unit.id}`} value={unit.id}>
                                {unit.active ? unit.label : `${unit.label} (inaktiv)`}
                              </option>
                        ))}
                      </select>
                    </div>
                        <div className="form-group">
                          <label>Bearbeitung</label>
                          <select
                            value={normalizeCategoryProcessingMode(editingCategory.processingMode)}
                            onChange={(e) =>
                              setEditingCategory({
                                ...editingCategory,
                                processingMode: normalizeCategoryProcessingMode(e.target.value),
                              })
                            }
                          >
                            <option value="">-- Nicht gesetzt --</option>
                            <option value="internal">Intern</option>
                            <option value="external">Extern</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Workflow bei Kategorie</label>
                          <select
                            value={editingCategory.workflowTemplateId || ''}
                            onChange={(e) =>
                                  setEditingCategory({
                                    ...editingCategory,
                                    workflowTemplateId: e.target.value,
                                  })
                                }
                              >
                                <option value="">Kein Workflow</option>
                                {workflowTemplates.map((wf) => (
                                  <option key={wf.id} value={wf.id}>
                                    {wf.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="form-actions">
                            <button
                              onClick={handleSaveCategory}
                              disabled={isSaving}
                              className="btn-save"
                            >
                              ✓ Speichern
                            </button>
                            <button
                              onClick={() => setEditingCategory(null)}
                              className="btn-cancel"
                            >
                              ✕ Abbrechen
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="category-info">
                            <div className="category-header">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4>{cat.name}</h4>
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${categoryScopeBadgeClass(scopeBadge.variant)}`}
                                >
                                  {scopeBadge.label}
                                </span>
                              </div>
                              {cat.locked && <i className="fa-solid fa-lock lock-icon" />}
                            </div>
                            <p className="description">{cat.description}</p>
                            <div className="category-meta">
                              {cat.redmineProject && (
                                <span>📋 Projekt: <strong>{cat.redmineProject}</strong></span>
                              )}
                              {cat.redmineTracker && (
                                <span>🏷️ Tracker: <strong>{cat.redmineTracker}</strong></span>
                              )}
                              {cat.keywords && cat.keywords.length > 0 && (
                                <span>🔑 {cat.keywords.join(', ')}</span>
                              )}
                              <span>
                                <i className="fa-solid fa-arrows-left-right-to-line" /> Bearbeitung:{' '}
                                {formatCategoryProcessingMode(cat.processingMode)}
                              </span>
                              {cat.externalRecipientEmail && (
                                <span>
                                  <i className="fa-solid fa-envelope" /> {cat.externalRecipientName || 'Externer Empfänger'}: {cat.externalRecipientEmail}
                                </span>
                              )}
                              {cat.internalOrgUnitId && (
                                <span>
                                  <i className="fa-solid fa-sitemap" /> Interne Zuständigkeit:{' '}
                                  {orgUnitLabelById.get(cat.internalOrgUnitId) || cat.internalOrgUnitId}
                                </span>
                              )}
                              {cat.workflowTemplateId && (
                                <span>
                                  <i className="fa-solid fa-diagram-project" /> Workflow:{' '}
                                  {workflowLabelById.get(cat.workflowTemplateId) || cat.workflowTemplateId}
                                </span>
                              )}
                            </div>
                          </div>
                          {canEdit && !cat.locked && (
                            <div className="category-actions">
                              <button
                                onClick={() => {
                                  setIsAddingNew(false);
                                  setEditingCategory({
                                    ...cat,
                                    workflowTemplateId: normalizeWorkflowTemplateId(cat.workflowTemplateId),
                                    processingMode: normalizeCategoryProcessingMode(cat.processingMode),
                                  });
                                }}
                                className="btn-edit"
                              >
                                <i className="fa-solid fa-pen-to-square" />
                              </button>
                              <button
                                onClick={() => handleDeleteCategory(cat.id)}
                                className="btn-delete"
                              >
                                <i className="fa-solid fa-trash" />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                  })}
                </div>
              ) : (
                <div className="knowledge-table-section">
                  <div className="knowledge-table-toolbar">
                    <span className="knowledge-table-count">
                      {tableCategories.length} Treffer
                    </span>
                  </div>

                  <SmartTable<KnowledgeCategoryTableRow>
                    tableId="knowledge-categories"
                    userId={token}
                    title="Kategorien (Tabelle)"
                    rows={tableRows}
                    columns={knowledgeTableColumns}
                    loading={false}
                    defaultPageSize={25}
                    pageSizeOptions={[10, 25, 50, 100]}
                    onRowClick={(row) => {
                      if (row.locked) return;
                      if (!canEdit) return;
                      setCategoryViewMode('cards');
                      setIsAddingNew(false);
                      setEditingCategory({
                        ...row.raw,
                        workflowTemplateId: normalizeWorkflowTemplateId(row.raw.workflowTemplateId),
                        processingMode: normalizeCategoryProcessingMode(row.raw.processingMode),
                      });
                    }}
                    getRowClassName={(row) => (row.locked ? 'is-locked' : '')}
                    disableRowSelectionOnClick
                    toolbarStartActions={
                      <TextField
                        select
                        size="small"
                        label="Filter"
                        value={tableFilter}
                        onChange={(event) => setTableFilter(event.target.value as typeof tableFilter)}
                        sx={{ minWidth: 220 }}
                      >
                        <MenuItem value="all">Alle Kategorien</MenuItem>
                        <MenuItem value="locked">Nur geschützt</MenuItem>
                        <MenuItem value="unlocked">Nur bearbeitbar</MenuItem>
                        <MenuItem value="withWorkflow">Mit Workflow</MenuItem>
                        <MenuItem value="withoutWorkflow">Ohne Workflow</MenuItem>
                      </TextField>
                    }
                  />
                </div>
              )}
            </div>
          )}

          {/* CLASSIFY PROMPT */}
          {activeTab === 'prompt' && (
            <div className="tab-content">
              <h3>AI Classify Prompt</h3>
              <p className="section-desc">Basis-Prompt für die KI-Kategorisierung (Markdown-Format)</p>

              <div className="prompt-editor">
                <textarea
                  value={knowledge.classifyPrompt}
                  onChange={(e) =>
                    setKnowledge({ ...knowledge, classifyPrompt: e.target.value })
                  }
                  disabled={!canEdit}
                  rows={16}
                  className="prompt-textarea"
                />
              </div>

              {canEdit && (
                <div className="form-actions">
                  <button
                    onClick={handleSavePrompt}
                    disabled={isSaving || !promptDirty}
                    className="btn-save"
                  >
                    💾 {isSaving ? 'Wird gespeichert...' : promptDirty ? 'Speichern' : 'Keine Änderungen'}
                  </button>
                </div>
              )}

              <div className="prompt-info">
                <h4>💡 Verfügbare Variablen im Prompt</h4>
                <ul>
                  <li><strong>KATEGORIEN</strong> - Liste aller Kategorien mit Beschreibungen</li>
                  <li><strong>DRINGLICHKEITEN</strong> - Verfügbare Prioritätsstufen</li>
                  <li><strong>ORT</strong> - Adresse und Koordinaten aus dem Ticket</li>
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Knowledge;
