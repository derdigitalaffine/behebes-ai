import React, { useMemo, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded';
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded';
import FormatUnderlinedRoundedIcon from '@mui/icons-material/FormatUnderlinedRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded';
import TitleRoundedIcon from '@mui/icons-material/TitleRounded';
import SubjectRoundedIcon from '@mui/icons-material/SubjectRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import {
  SmartTable,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';
import { getAdminToken } from '../lib/auth';
import { useAdminScopeContext } from '../lib/adminScopeContext';

interface PlaceholderMeta {
  label: string;
  description: string;
  example: string;
}

interface Template {
  id: string;
  name: string;
  subject: string;
  htmlContent?: string;
  textContent?: string;
  placeholders?: string[];
  editable?: boolean;
  usageHint?: string;
  audience?: string;
  groupPath?: string[];
  tags?: string[];
  lifecycle?: 'draft' | 'active' | 'deprecated';
  ownerTeam?: string;
  maintainer?: string;
  lastReviewedAt?: string | null;
  scope?: 'platform' | 'tenant';
  tenantId?: string;
  originId?: string;
  isOverride?: boolean;
}

type TemplateLifecycle = 'draft' | 'active' | 'deprecated';
type EditableFilter = 'all' | 'editable' | 'system';

interface TemplateTreeNode {
  id: string;
  label: string;
  path: string[];
  children: TemplateTreeNode[];
  templates: Template[];
  templateCount: number;
  issueCount: number;
}

const EMAIL_TEMPLATE_TREE_STATE_KEY = 'emailTemplates.tree.expanded.v1';

const normalizeTemplateText = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const normalizeTemplateGroupPath = (template: Template): string[] => {
  const source = Array.isArray(template.groupPath) ? template.groupPath : [];
  const normalized = source
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  if (normalized.length > 0) return normalized;
  if (template.id.startsWith('template-') || template.id === 'external-notification') {
    return ['Extern', 'Weiterleitung'];
  }
  if (template.id === 'workflow-confirmation') return ['Workflow', 'Freigabe'];
  if (template.id === 'workflow-data-request') return ['Workflow', 'Datennachforderung'];
  if (template.id === 'workflow-mayor-involvement-notify') return ['Workflow', 'Ortsgemeinde', 'Information'];
  if (template.id === 'workflow-mayor-involvement-approval') return ['Workflow', 'Ortsgemeinde', 'Zustimmung'];
  if (template.id === 'citizen-workflow-notification') return ['Workflow', 'Bürgerfrontend'];
  if (template.id === 'validation-email') return ['Bürger', 'Double Opt-In'];
  if (template.id === 'submission-confirmation') return ['Bürger', 'Eingangsbestätigung'];
  if (template.id === 'status-change') return ['Bürger', 'Statuskommunikation'];
  return ['System', 'Allgemein'];
};

const normalizeTemplateTags = (template: Template): string[] =>
  Array.from(
    new Set(
      (Array.isArray(template.tags) ? template.tags : [])
        .map((entry) => normalizeTemplateText(entry))
        .filter(Boolean)
    )
  );

const normalizeTemplateLifecycle = (template: Template): TemplateLifecycle => {
  if (template.lifecycle === 'draft' || template.lifecycle === 'deprecated') return template.lifecycle;
  return 'active';
};

const buildTemplateSearchText = (template: Template): string => {
  const groupPath = normalizeTemplateGroupPath(template).join(' ');
  const tags = normalizeTemplateTags(template).join(' ');
  return [
    template.id,
    template.name,
    template.subject,
    template.audience,
    template.usageHint,
    groupPath,
    tags,
  ]
    .map((entry) => normalizeTemplateText(entry))
    .filter(Boolean)
    .join(' ');
};

const templateMissingPlaceholderCount = (template: Template): number => {
  const placeholders = Array.isArray(template.placeholders) ? template.placeholders : [];
  if (placeholders.length === 0) return 0;
  const subject = String(template.subject || '');
  return placeholders.filter((placeholder) => !subject.includes(placeholder)).length;
};

const getTemplateScopeBadgeConfig = (template: Template): { label: string; className: string } => {
  const scope = template.scope === 'tenant' ? 'tenant' : 'platform';
  if (scope === 'platform') {
    return {
      label: 'Global',
      className: 'border-sky-300 bg-sky-50 text-sky-800',
    };
  }
  if (template.isOverride) {
    return {
      label: 'Mandanten-Override',
      className: 'border-amber-300 bg-amber-50 text-amber-800',
    };
  }
  return {
    label: 'Mandant',
    className: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  };
};

interface Category {
  id: string;
  name: string;
  description?: string;
}

interface EmailTemplateSettings {
  footerEnabled: boolean;
  footerHtml: string;
  footerText: string;
}

function htmlToPlainText(html: string): string {
  const source = String(html || '');
  if (!source.trim()) return '';
  return source
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const LAYOUT_BODY_START_MARKER = '<!--BEHEBES_EMAIL_LAYOUT_BODY_START-->';
const LAYOUT_BODY_END_MARKER = '<!--BEHEBES_EMAIL_LAYOUT_BODY_END-->';

function extractEditableTemplateBody(html: string): string {
  const source = String(html || '');
  const start = source.indexOf(LAYOUT_BODY_START_MARKER);
  const end = source.indexOf(LAYOUT_BODY_END_MARKER);
  if (start >= 0 && end > start) {
    return source
      .slice(start + LAYOUT_BODY_START_MARKER.length, end)
      .trim();
  }
  return source.trim();
}

interface HtmlTemplateEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  editorHeight?: number;
}

const HtmlTemplateEditor: React.FC<HtmlTemplateEditorProps> = ({
  label,
  value,
  onChange,
  disabled = false,
  editorHeight = 320,
}) => {
  const [sourceMode, setSourceMode] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (sourceMode) return;
    const editor = editorRef.current;
    if (!editor) return;
    const nextValue = String(value || '');
    if (editor.innerHTML !== nextValue) {
      editor.innerHTML = nextValue || '<p></p>';
    }
  }, [value, sourceMode]);

  const applyChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(editor.innerHTML);
  };

  const runCommand = (command: string, commandValue?: string) => {
    if (disabled || sourceMode) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, commandValue);
    applyChange();
  };

  const sourceMinRows = Math.max(8, Math.round(editorHeight / 24));
  const toolbarButtons = [
    {
      title: 'Fett',
      icon: <FormatBoldRoundedIcon fontSize="small" />,
      onClick: () => runCommand('bold'),
    },
    {
      title: 'Kursiv',
      icon: <FormatItalicRoundedIcon fontSize="small" />,
      onClick: () => runCommand('italic'),
    },
    {
      title: 'Unterstrichen',
      icon: <FormatUnderlinedRoundedIcon fontSize="small" />,
      onClick: () => runCommand('underline'),
    },
    {
      title: 'Liste',
      icon: <FormatListBulletedRoundedIcon fontSize="small" />,
      onClick: () => runCommand('insertUnorderedList'),
    },
    {
      title: 'Nummerierte Liste',
      icon: <FormatListNumberedRoundedIcon fontSize="small" />,
      onClick: () => runCommand('insertOrderedList'),
    },
    {
      title: 'Überschrift',
      icon: <TitleRoundedIcon fontSize="small" />,
      onClick: () => runCommand('formatBlock', 'h3'),
    },
    {
      title: 'Absatz',
      icon: <SubjectRoundedIcon fontSize="small" />,
      onClick: () => runCommand('formatBlock', 'p'),
    },
    {
      title: 'Link',
      icon: <LinkRoundedIcon fontSize="small" />,
      onClick: () => {
        if (disabled) return;
        const url = window.prompt('Link-URL', 'https://');
        if (!url) return;
        runCommand('createLink', url.trim());
      },
    },
    {
      title: 'Link entfernen',
      icon: <LinkOffRoundedIcon fontSize="small" />,
      onClick: () => runCommand('unlink'),
    },
  ];

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        sx={{ mb: 1 }}
      >
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap">
          {!sourceMode ? (
            toolbarButtons.map((button) => (
              <Tooltip key={button.title} title={button.title}>
                <span>
                  <IconButton
                    size="small"
                    onClick={button.onClick}
                    disabled={disabled}
                    sx={{ border: '1px solid #cbd5e1', borderRadius: 1 }}
                  >
                    {button.icon}
                  </IconButton>
                </span>
              </Tooltip>
            ))
          ) : null}
          <Button
            size="small"
            variant="outlined"
            startIcon={sourceMode ? <EditRoundedIcon fontSize="small" /> : <CodeRoundedIcon fontSize="small" />}
            onClick={() => setSourceMode((prev) => !prev)}
          >
            {sourceMode ? 'WYSIWYG' : 'HTML'}
          </Button>
        </Stack>
      </Stack>
      {sourceMode ? (
        <TextField
          fullWidth
          multiline
          minRows={sourceMinRows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          sx={{
            '& .MuiInputBase-root': {
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            },
          }}
        />
      ) : (
        <Box
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={applyChange}
          onBlur={applyChange}
          sx={{
            minHeight: editorHeight,
            px: 1.5,
            py: 1.25,
            border: '1px solid #cbd5e1',
            borderRadius: 1,
            bgcolor: disabled ? '#f1f5f9' : '#fff',
            color: disabled ? '#64748b' : 'inherit',
            overflow: 'auto',
            outline: 'none',
            '&:focus-within': {
              borderColor: '#1976d2',
              boxShadow: '0 0 0 2px rgba(25, 118, 210, 0.12)',
            },
          }}
        />
      )}
    </Box>
  );
};

const EmailTemplates: React.FC = () => {
  const { selection: scopeSelection } = useAdminScopeContext();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [subject, setSubject] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [textContent, setTextContent] = useState('');
  const [selectedPlaceholders, setSelectedPlaceholders] = useState<string[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewText, setPreviewText] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [placeholderCatalog, setPlaceholderCatalog] = useState<Record<string, PlaceholderMeta>>({});
  const [aiExtraPrompt, setAiExtraPrompt] = useState('');
  const [aiTone, setAiTone] = useState<'neutral' | 'formal' | 'friendly' | 'concise'>('neutral');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [footerEnabled, setFooterEnabled] = useState(true);
  const [footerHtml, setFooterHtml] = useState('');
  const [footerText, setFooterText] = useState('');
  const [savingFooter, setSavingFooter] = useState(false);
  const [showCreateTemplateForm, setShowCreateTemplateForm] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [newTemplateSubject, setNewTemplateSubject] = useState('Neue Nachricht zu Ihrer Meldung');
  const [newTemplateHtml, setNewTemplateHtml] = useState('<p>Guten Tag {citizenName},</p><p>{customMessage}</p>');
  const [newTemplateText, setNewTemplateText] = useState('Guten Tag {citizenName},\n\n{customMessage}');
  const [newTemplatePlaceholders, setNewTemplatePlaceholders] = useState<string[]>([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [editableFilter, setEditableFilter] = useState<EditableFilter>('all');
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | TemplateLifecycle>('all');
  const [onlyWithIssues, setOnlyWithIssues] = useState(false);
  const [showAdvancedMeta, setShowAdvancedMeta] = useState(false);
  const [expandedTreeNodes, setExpandedTreeNodes] = useState<Record<string, boolean>>({});
  const [groupPathInput, setGroupPathInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [lifecycleValue, setLifecycleValue] = useState<TemplateLifecycle>('active');
  const [ownerTeamValue, setOwnerTeamValue] = useState('');
  const [maintainerValue, setMaintainerValue] = useState('');
  const [lastReviewedAtValue, setLastReviewedAtValue] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');

  const previewDoc = previewHtml
    ? `<!doctype html><html><head><meta charset="utf-8" /><style>body{margin:0;padding:16px;font-family:Candara,'Segoe UI',Arial,Helvetica,sans-serif;background:#ffffff;color:#001c31;}</style></head><body>${previewHtml}</body></html>`
    : '';
  const selectedCategory = useMemo(
    () => categories.find((cat) => cat.id === selectedCategoryId),
    [categories, selectedCategoryId]
  );
  const selectedTemplateScopeBadge = useMemo(
    () => (selectedTemplate ? getTemplateScopeBadgeConfig(selectedTemplate) : null),
    [selectedTemplate]
  );
  const libraryScopeParams = useMemo(
    () =>
      scopeSelection.scope === 'tenant' && scopeSelection.tenantId
        ? { scope: 'tenant' as const, tenantId: scopeSelection.tenantId }
        : { scope: 'platform' as const, tenantId: '' },
    [scopeSelection.scope, scopeSelection.tenantId]
  );
  const placeholderEntries = useMemo(
    () =>
      Object.entries(placeholderCatalog).sort((a, b) =>
        a[0].localeCompare(b[0], 'de', { sensitivity: 'base' })
      ),
    [placeholderCatalog]
  );
  const allPlaceholderKeys = useMemo(() => placeholderEntries.map(([key]) => key), [placeholderEntries]);
  const missingPlaceholders = useMemo(() => {
    const required = selectedPlaceholders;
    if (!required.length) return [];
    return required.filter((placeholder) => !subject.includes(placeholder) && !htmlContent.includes(placeholder));
  }, [selectedPlaceholders, subject, htmlContent]);
  const textOnlyMissingPlaceholders = useMemo(() => {
    const required = selectedPlaceholders;
    if (!required.length) return [];
    return required.filter((placeholder) => !textContent.includes(placeholder));
  }, [selectedPlaceholders, textContent]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EMAIL_TEMPLATE_TREE_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      setExpandedTreeNodes(parsed as Record<string, boolean>);
    } catch {
      // ignore persisted parse failures
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(EMAIL_TEMPLATE_TREE_STATE_KEY, JSON.stringify(expandedTreeNodes));
    } catch {
      // ignore storage failures
    }
  }, [expandedTreeNodes]);

  const filteredTemplates = useMemo(() => {
    const query = normalizeTemplateText(templateSearch);
    return templates.filter((template) => {
      const isEditable = template.editable !== false;
      if (editableFilter === 'editable' && !isEditable) return false;
      if (editableFilter === 'system' && isEditable) return false;
      const lifecycle = normalizeTemplateLifecycle(template);
      if (lifecycleFilter !== 'all' && lifecycle !== lifecycleFilter) return false;
      if (onlyWithIssues && templateMissingPlaceholderCount(template) === 0) return false;
      if (!query) return true;
      return buildTemplateSearchText(template).includes(query);
    });
  }, [templates, templateSearch, editableFilter, lifecycleFilter, onlyWithIssues]);

  const templateTree = useMemo(() => {
    interface MutableNode {
      id: string;
      label: string;
      path: string[];
      childrenById: Map<string, MutableNode>;
      templates: Template[];
      templateCount: number;
      issueCount: number;
    }

    const createNode = (path: string[]): MutableNode => ({
      id: path.join(' / '),
      label: path[path.length - 1] || 'Vorlagen',
      path,
      childrenById: new Map<string, MutableNode>(),
      templates: [],
      templateCount: 0,
      issueCount: 0,
    });

    const rootNodes = new Map<string, MutableNode>();

    filteredTemplates.forEach((template) => {
      const path = normalizeTemplateGroupPath(template);
      let level = rootNodes;
      const chain: MutableNode[] = [];

      for (let index = 0; index < path.length; index += 1) {
        const segmentPath = path.slice(0, index + 1);
        const key = segmentPath.join(' / ');
        let node = level.get(key);
        if (!node) {
          node = createNode(segmentPath);
          level.set(key, node);
        }
        chain.push(node);
        level = node.childrenById;
      }

      const issueCount = templateMissingPlaceholderCount(template) > 0 ? 1 : 0;
      chain.forEach((node) => {
        node.templateCount += 1;
        node.issueCount += issueCount;
      });
      const leaf = chain[chain.length - 1];
      if (leaf) leaf.templates.push(template);
    });

    const toViewNode = (node: MutableNode): TemplateTreeNode => {
      const children = Array.from(node.childrenById.values())
        .map(toViewNode)
        .sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
      const templates = [...node.templates].sort((a, b) =>
        String(a.name || a.id).localeCompare(String(b.name || b.id), 'de', { sensitivity: 'base' })
      );
      return {
        id: node.id,
        label: node.label,
        path: node.path,
        children,
        templates,
        templateCount: node.templateCount,
        issueCount: node.issueCount,
      };
    };

    return Array.from(rootNodes.values())
      .map(toViewNode)
      .sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
  }, [filteredTemplates]);

  const templateColumns = useMemo<SmartTableColumnDef<Template>[]>(
    () => [
      {
        field: 'name',
        headerName: 'Vorlage',
        minWidth: 240,
        flex: 1.1,
        renderCell: ({ row }) => (
          <Stack spacing={0.25}>
            <Typography variant="body2" fontWeight={700}>
              {row.name || row.id}
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
              {row.id}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'scope',
        headerName: 'Scope',
        minWidth: 150,
        flex: 0.4,
        sortable: false,
        renderCell: ({ row }) => {
          const scopeBadge = getTemplateScopeBadgeConfig(row);
          return <Chip size="small" label={scopeBadge.label} />;
        },
      },
      {
        field: 'lifecycle',
        headerName: 'Lifecycle',
        minWidth: 120,
        flex: 0.33,
        valueGetter: (_value, row) => normalizeTemplateLifecycle(row),
      },
      {
        field: 'editable',
        headerName: 'Typ',
        minWidth: 110,
        flex: 0.3,
        valueGetter: (_value, row) => (row.editable !== false ? 'Editierbar' : 'System'),
      },
      {
        field: 'issues',
        headerName: 'Checks',
        minWidth: 120,
        flex: 0.35,
        type: 'number',
        valueGetter: (_value, row) => templateMissingPlaceholderCount(row),
      },
      {
        field: 'groupPath',
        headerName: 'Gruppe',
        minWidth: 180,
        flex: 0.55,
        valueGetter: (_value, row) => normalizeTemplateGroupPath(row).join(' / '),
      },
    ],
    []
  );

  useEffect(() => {
    void fetchData();
  }, [libraryScopeParams.scope, libraryScopeParams.tenantId]);

  const sanitizeTemplateId = (input: string): string => {
    return String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const ensureTemplatePlaceholders = (input: string[]): string[] => {
    return Array.from(new Set(input.filter(Boolean)));
  };

  const parseGroupPathInput = (input: string): string[] =>
    input
      .split(/[>/|]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 3);

  const parseTagsInput = (input: string): string[] =>
    Array.from(
      new Set(
        input
          .split(',')
          .map((entry) => normalizeTemplateText(entry))
          .filter(Boolean)
      )
    );

  const fetchData = async () => {
    try {
      const token = getAdminToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [templatesRes, knowledgeRes, settingsRes] = await Promise.all([
        axios.get('/api/admin/config/templates', {
          headers,
          params: {
            scope: libraryScopeParams.scope,
            tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
          },
        }),
        axios
          .get('/api/knowledge', {
            headers,
            params: {
              scope: libraryScopeParams.scope,
              tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
              includeInherited: libraryScopeParams.scope === 'tenant' ? '1' : undefined,
            },
          })
          .catch(() => ({ data: { categories: [] } })),
        axios.get('/api/admin/config/templates/settings', { headers }).catch(() => ({ data: null })),
      ]);

      const loadedTemplates: Template[] = Array.isArray(templatesRes.data?.templates)
        ? templatesRes.data.templates
        : [];
      setTemplates(loadedTemplates);
      setPlaceholderCatalog(
        templatesRes.data?.placeholderCatalog && typeof templatesRes.data.placeholderCatalog === 'object'
          ? templatesRes.data.placeholderCatalog
          : {}
      );
      if (loadedTemplates.length > 0 && !selectedTemplate) {
        setSelectedTemplate(loadedTemplates[0]);
      } else if (selectedTemplate) {
        const refreshedTemplate = loadedTemplates.find((item) => item.id === selectedTemplate.id) || null;
        setSelectedTemplate(refreshedTemplate);
        setSelectedPlaceholders(refreshedTemplate?.placeholders || []);
      }
      const templateSettings: EmailTemplateSettings | null =
        (settingsRes.data && typeof settingsRes.data === 'object' ? settingsRes.data : null) ||
        (templatesRes.data?.settings && typeof templatesRes.data.settings === 'object'
          ? templatesRes.data.settings
          : null);
      if (templateSettings) {
        setFooterEnabled(templateSettings.footerEnabled !== false);
        setFooterHtml(typeof templateSettings.footerHtml === 'string' ? templateSettings.footerHtml : '');
        setFooterText(typeof templateSettings.footerText === 'string' ? templateSettings.footerText : '');
      }

      const categoriesData = Array.isArray(knowledgeRes.data?.categories)
        ? knowledgeRes.data.categories
        : [];
      const sorted = categoriesData
        .map((category: any) => ({
          id: category.id,
          name: category.name || category.id,
          description: category.description || '',
        }))
        .sort((a: Category, b: Category) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
      setCategories(sorted);
      setSelectedCategoryId((prev) => {
        if (prev && sorted.some((cat: Category) => cat.id === prev)) return prev;
        return sorted[0]?.id || '';
      });
    } catch (error) {
      setMessageType('error');
      setMessage('Fehler beim Laden der Daten');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTemplate = async (template: Template) => {
    setSelectedTemplate(template);
    setTemplateName(template.name || template.id);
    setSelectedPlaceholders(Array.isArray(template.placeholders) ? template.placeholders : []);
    setShowPreview(false);
    setPreviewHtml('');
    setPreviewText('');
    try {
      const response = await axios.get(`/api/admin/config/templates/${template.id}`, {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
        params: {
          scope: libraryScopeParams.scope,
          tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
        },
      });
      const loadedSubject = String(response.data?.subject || '');
      const loadedName =
        typeof response.data?.name === 'string' && response.data.name.trim()
          ? response.data.name.trim()
          : template.name || template.id;
      const loadedHtml = String(response.data?.htmlContent || '');
      const loadedText = String(response.data?.textContent || '');
      const loadedPlaceholders = Array.isArray(response.data?.placeholders)
        ? response.data.placeholders.filter((entry: any) => typeof entry === 'string')
        : Array.isArray(template.placeholders)
        ? template.placeholders
        : [];
      const loadedGroupPath = Array.isArray(response.data?.groupPath)
        ? response.data.groupPath
        : normalizeTemplateGroupPath(template);
      const loadedTags = Array.isArray(response.data?.tags)
        ? response.data.tags
        : normalizeTemplateTags(template);
      const loadedLifecycle = response.data?.lifecycle || normalizeTemplateLifecycle(template);
      setTemplateName(loadedName);
      setSubject(loadedSubject);
      setHtmlContent(extractEditableTemplateBody(loadedHtml));
      setTextContent(loadedText.trim() ? loadedText : htmlToPlainText(loadedHtml));
      setSelectedPlaceholders(loadedPlaceholders);
      setGroupPathInput(loadedGroupPath.join(' > '));
      setTagsInput(loadedTags.join(', '));
      setLifecycleValue(
        loadedLifecycle === 'draft' || loadedLifecycle === 'deprecated' ? loadedLifecycle : 'active'
      );
      setOwnerTeamValue(
        typeof response.data?.ownerTeam === 'string'
          ? response.data.ownerTeam
          : template.ownerTeam || ''
      );
      setMaintainerValue(
        typeof response.data?.maintainer === 'string'
          ? response.data.maintainer
          : template.maintainer || ''
      );
      setLastReviewedAtValue(
        typeof response.data?.lastReviewedAt === 'string'
          ? response.data.lastReviewedAt
          : template.lastReviewedAt || ''
      );
      setAiExtraPrompt('');
    } catch (error) {
      setMessageType('error');
      setMessage('Fehler beim Laden des Templates');
    }
  };

  const handleGenerateTemplate = async () => {
    if (!selectedTemplate) {
      setMessageType('error');
      setMessage('Bitte wählen Sie ein Template aus');
      return;
    }

    if (!selectedCategory) {
      setMessageType('error');
      setMessage('Bitte eine Kategorie für die KI-Generierung auswählen');
      return;
    }

    const categoryDescription = (selectedCategory.description || '').trim();
    if (!categoryDescription) {
      setMessageType('error');
      setMessage('Die ausgewählte Kategorie benötigt eine Beschreibung für die KI-Generierung');
      return;
    }

    setGenerating(true);
    try {
      const response = await axios.post(
        '/api/admin/templates/generate',
        {
          categoryName: selectedCategory.name,
          categoryDescription,
          customPrompt: aiExtraPrompt,
          tone: aiTone,
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          requiredPlaceholders: selectedPlaceholders,
        },
        {
          headers: {
            Authorization: `Bearer ${getAdminToken()}`,
          },
        }
      );

      const generatedSubject = String(response.data?.subject || '');
      const generatedHtml = String(response.data?.htmlContent || '');
      const generatedText = String(response.data?.textContent || '');
      setSubject(generatedSubject);
      setHtmlContent(extractEditableTemplateBody(generatedHtml));
      setTextContent(generatedText.trim() ? generatedText : htmlToPlainText(generatedHtml));
      const missingFromBackend = Array.isArray(response.data?.missingPlaceholders)
        ? response.data.missingPlaceholders
        : [];
      if (missingFromBackend.length > 0) {
        setMessageType('error');
        setMessage(`Template generiert, aber Platzhalter fehlen: ${missingFromBackend.join(', ')}`);
      } else {
        setMessageType('success');
        setMessage('E-Mail-Template erfolgreich generiert');
      }
      setTimeout(() => setMessage(''), 3000);
    } catch (error: any) {
      setMessageType('error');
      setMessage(error.response?.data?.message || 'Fehler beim Generieren des Templates');
    } finally {
      setGenerating(false);
    }
  };

  const handlePreview = async () => {
    if (!selectedTemplate) return;
    try {
      const response = await axios.get(`/api/admin/config/templates/${selectedTemplate.id}/preview`, {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
        params: {
          scope: libraryScopeParams.scope,
          tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
        },
      });
      setPreviewHtml(String(response.data?.preview || ''));
      setPreviewText(String(response.data?.previewText || htmlToPlainText(String(response.data?.preview || ''))));
      setShowPreview(true);
    } catch (error) {
      setMessageType('error');
      setMessage('Fehler beim Generieren der Vorschau');
    }
  };

  const handleSave = async () => {
    if (!selectedTemplate || !selectedTemplate.editable) {
      setMessageType('error');
      setMessage('Dieses Template kann nicht bearbeitet werden');
      return;
    }

    if (!subject.trim() || !htmlContent.trim()) {
      setMessageType('error');
      setMessage('Betreff und HTML-Inhalt sind erforderlich');
      return;
    }

    setSaving(true);
    try {
      await axios.patch(
        `/api/admin/config/templates/${selectedTemplate.id}`,
        {
          name: templateName.trim() || selectedTemplate.name || selectedTemplate.id,
          subject,
          htmlContent,
          textContent: textContent.trim(),
          placeholders: ensureTemplatePlaceholders(selectedPlaceholders),
          groupPath: parseGroupPathInput(groupPathInput),
          tags: parseTagsInput(tagsInput),
          lifecycle: lifecycleValue,
          ownerTeam: ownerTeamValue.trim(),
          maintainer: maintainerValue.trim(),
          lastReviewedAt: lastReviewedAtValue.trim() || null,
        },
        {
          headers: {
            Authorization: `Bearer ${getAdminToken()}`,
          },
          params: {
            scope: libraryScopeParams.scope,
            tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
          },
        }
      );
      setMessageType('success');
      setMessage('Template erfolgreich gespeichert');
      setSelectedTemplate((prev) =>
        prev
          ? {
              ...prev,
              name: templateName.trim() || prev.name,
              subject,
              placeholders: ensureTemplatePlaceholders(selectedPlaceholders),
              groupPath: parseGroupPathInput(groupPathInput),
              tags: parseTagsInput(tagsInput),
              lifecycle: lifecycleValue,
              ownerTeam: ownerTeamValue.trim(),
              maintainer: maintainerValue.trim(),
              lastReviewedAt: lastReviewedAtValue.trim() || null,
            }
          : prev
      );
      setTemplates((prev) =>
        prev.map((template) =>
          template.id === selectedTemplate.id
            ? {
                ...template,
                name: templateName.trim() || template.name,
                subject,
                placeholders: ensureTemplatePlaceholders(selectedPlaceholders),
                groupPath: parseGroupPathInput(groupPathInput),
                tags: parseTagsInput(tagsInput),
                lifecycle: lifecycleValue,
                ownerTeam: ownerTeamValue.trim(),
                maintainer: maintainerValue.trim(),
                lastReviewedAt: lastReviewedAtValue.trim() || null,
              }
            : template
        )
      );
      setTimeout(() => setMessage(''), 3000);
    } catch (error: any) {
      setMessageType('error');
      const missing = Array.isArray(error?.response?.data?.missingPlaceholders)
        ? error.response.data.missingPlaceholders
        : [];
      if (missing.length > 0) {
        setMessage(`Fehler beim Speichern: fehlende Platzhalter (${missing.join(', ')})`);
      } else {
        setMessage(error?.response?.data?.message || 'Fehler beim Speichern des Templates');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTemplate = async () => {
    const normalizedId = sanitizeTemplateId(newTemplateId || newTemplateName);
    if (!normalizedId) {
      setMessageType('error');
      setMessage('Bitte einen gültigen Vorlagennamen oder eine ID angeben.');
      return;
    }
    if (!newTemplateSubject.trim() || !newTemplateHtml.trim()) {
      setMessageType('error');
      setMessage('Betreff und HTML-Inhalt sind erforderlich.');
      return;
    }

    setCreatingTemplate(true);
    try {
      await axios.post(
        '/api/admin/config/templates',
        {
          id: normalizedId,
          name: newTemplateName.trim() || normalizedId,
          subject: newTemplateSubject.trim(),
          htmlContent: newTemplateHtml.trim(),
          textContent: newTemplateText.trim(),
          placeholders: ensureTemplatePlaceholders(newTemplatePlaceholders),
          groupPath: ['System', 'Allgemein'],
          tags: [],
          lifecycle: 'draft',
        },
        {
          headers: {
            Authorization: `Bearer ${getAdminToken()}`,
          },
          params: {
            scope: libraryScopeParams.scope,
            tenantId: libraryScopeParams.scope === 'tenant' ? libraryScopeParams.tenantId : undefined,
          },
        }
      );

      setShowCreateTemplateForm(false);
      setNewTemplateName('');
      setNewTemplateId('');
      setNewTemplateSubject('Neue Nachricht zu Ihrer Meldung');
      setNewTemplateHtml('<p>Guten Tag {citizenName},</p><p>{customMessage}</p>');
      setNewTemplateText('Guten Tag {citizenName},\n\n{customMessage}');
      setNewTemplatePlaceholders([]);
      await fetchData();
      const createdTemplate: Template = {
        id: normalizedId,
        name: newTemplateName.trim() || normalizedId,
        subject: newTemplateSubject.trim(),
        placeholders: ensureTemplatePlaceholders(newTemplatePlaceholders),
        editable: true,
        groupPath: ['System', 'Allgemein'],
        tags: [],
        lifecycle: 'draft',
      };
      await handleSelectTemplate(createdTemplate);
      setMessageType('success');
      setMessage('Neue E-Mail-Vorlage erfolgreich angelegt.');
      setTimeout(() => setMessage(''), 3000);
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Fehler beim Anlegen der Vorlage');
    } finally {
      setCreatingTemplate(false);
    }
  };

  const toggleSelectedPlaceholder = (placeholder: string) => {
    setSelectedPlaceholders((prev) =>
      prev.includes(placeholder)
        ? prev.filter((entry) => entry !== placeholder)
        : [...prev, placeholder]
    );
  };

  const toggleCreatePlaceholder = (placeholder: string) => {
    setNewTemplatePlaceholders((prev) =>
      prev.includes(placeholder)
        ? prev.filter((entry) => entry !== placeholder)
        : [...prev, placeholder]
    );
  };

  const handleSaveFooterSettings = async () => {
    setSavingFooter(true);
    try {
      await axios.patch(
        '/api/admin/config/templates/settings',
        {
          footerEnabled,
          footerHtml,
          footerText,
        },
        {
          headers: {
            Authorization: `Bearer ${getAdminToken()}`,
          },
        }
      );
      setMessageType('success');
      setMessage('Globale Footer-Signatur gespeichert');
      setTimeout(() => setMessage(''), 2500);
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Fehler beim Speichern der Footer-Signatur');
    } finally {
      setSavingFooter(false);
    }
  };

  const copyPlaceholder = async (placeholder: string) => {
    try {
      await navigator.clipboard.writeText(placeholder);
      setMessageType('success');
      setMessage(`Platzhalter ${placeholder} in die Zwischenablage kopiert`);
      setTimeout(() => setMessage(''), 1800);
    } catch {
      setMessageType('error');
      setMessage('Platzhalter konnte nicht kopiert werden');
    }
  };

  const toggleTreeNode = (nodeId: string) => {
    setExpandedTreeNodes((prev) => ({
      ...prev,
      [nodeId]: prev[nodeId] === false,
    }));
  };

  const setAllTreeNodesExpanded = (expanded: boolean) => {
    const next: Record<string, boolean> = {};
    const walk = (nodes: TemplateTreeNode[]) => {
      nodes.forEach((node) => {
        next[node.id] = expanded;
        walk(node.children);
      });
    };
    walk(templateTree);
    setExpandedTreeNodes(next);
  };

  const renderTemplateTreeNode = (node: TemplateTreeNode): React.ReactNode => {
    const isExpanded = expandedTreeNodes[node.id] !== false;
    return (
      <div key={node.id} className="space-y-2">
        <button
          type="button"
          onClick={() => toggleTreeNode(node.id)}
          className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-between gap-2"
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs text-slate-500`} />
            <span className="font-semibold text-slate-900 truncate">{node.label}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-300 bg-white text-slate-600">
              {node.templateCount}
            </span>
            {node.issueCount > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800">
                {node.issueCount} Warnung{node.issueCount === 1 ? '' : 'en'}
              </span>
            )}
          </span>
        </button>

        {isExpanded && (
          <div className="pl-3 space-y-2 border-l border-slate-200">
            {node.children.map((child) => renderTemplateTreeNode(child))}
            {node.templates.map((template) => {
              const lifecycle = normalizeTemplateLifecycle(template);
              const issueCount = templateMissingPlaceholderCount(template);
              const scopeBadge = getTemplateScopeBadgeConfig(template);
              return (
                <button
                  key={template.id}
                  onClick={() => handleSelectTemplate(template)}
                  className={`w-full text-left px-3 py-3 rounded-lg border transition ${
                    selectedTemplate?.id === template.id
                      ? 'bg-blue-50 border-blue-300 text-blue-950'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-semibold">{template.name || template.id}</div>
                  <div className="text-xs mt-1 text-slate-500 font-mono">{template.id}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${scopeBadge.className}`}>
                      {scopeBadge.label}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-300 bg-slate-50 text-slate-700">
                      {template.editable !== false ? 'Editierbar' : 'System'}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-300 bg-slate-50 text-slate-700">
                      {lifecycle}
                    </span>
                    {issueCount > 0 && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800">
                        Platzhalterprüfung
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={280}>
        <CircularProgress size={30} />
      </Box>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHero
        title="E-Mail-Templates"
        subtitle="Konsolidierte Vorlagenverwaltung mit SmartTable-Navigation und strukturierten Metadaten."
        badges={[
          { label: `Kontext: ${libraryScopeParams.scope === 'tenant' ? 'Mandant' : 'Global'}`, tone: 'info' },
          { label: `${filteredTemplates.length} Vorlagen`, tone: 'default' },
        ]}
        actions={(
          <Button variant="contained" onClick={() => setShowCreateTemplateForm((prev) => !prev)}>
            {showCreateTemplateForm ? 'Anlage schließen' : 'Neue Vorlage'}
          </Button>
        )}
      />

      {message ? (
        <Alert severity={messageType === 'success' ? 'success' : 'error'}>{message}</Alert>
      ) : null}

      {showCreateTemplateForm && (
        <AdminSurfaceCard
          title="Neue E-Mail-Vorlage anlegen"
          subtitle="Neue Vorlagen können anschließend direkt in Workflow-Schritten ausgewählt werden."
          bodyClassName="space-y-4"
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
            <TextField
              fullWidth
              label="Name *"
              value={newTemplateName}
              onChange={(event) => setNewTemplateName(event.target.value)}
              placeholder="z. B. Interne Rückmeldung"
            />
            <TextField
              fullWidth
              label="Technische ID (optional)"
              value={newTemplateId}
              onChange={(event) => setNewTemplateId(sanitizeTemplateId(event.target.value))}
              placeholder="z. B. interne-rueckmeldung"
            />
            <TextField
              fullWidth
              label="Betreff *"
              value={newTemplateSubject}
              onChange={(event) => setNewTemplateSubject(event.target.value)}
              placeholder="z. B. Rückmeldung zu Ihrer Meldung ({ticketId})"
            />
          </Stack>

          <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 1.5, p: 1.5, bgcolor: '#f8fafc' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1}>
              <Typography variant="subtitle2">Pflicht-Platzhalter für diese Vorlage</Typography>
              <Typography variant="caption" color="text.secondary">
                {newTemplatePlaceholders.length} ausgewählt
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button size="small" variant="outlined" onClick={() => setNewTemplatePlaceholders(allPlaceholderKeys)}>
                Alle auswählen
              </Button>
              <Button size="small" variant="outlined" onClick={() => setNewTemplatePlaceholders([])}>
                Keine Auswahl
              </Button>
            </Stack>
            <Box
              sx={{
                mt: 1.25,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                gap: 0.75,
              }}
            >
              {placeholderEntries.map(([placeholder, meta]) => (
                <Box
                  key={`create-${placeholder}`}
                  sx={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 1,
                    px: 1.25,
                    py: 0.75,
                    bgcolor: '#fff',
                  }}
                >
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={newTemplatePlaceholders.includes(placeholder)}
                        onChange={() => toggleCreatePlaceholder(placeholder)}
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                          {placeholder}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {meta.label}
                        </Typography>
                      </Box>
                    }
                  />
                </Box>
              ))}
            </Box>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
            <HtmlTemplateEditor
              label="HTML-Inhalt *"
              value={newTemplateHtml}
              onChange={setNewTemplateHtml}
              editorHeight={260}
            />
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="body2" fontWeight={600}>
                  Nur-Text-Fallback
                </Typography>
                <Button size="small" variant="outlined" onClick={() => setNewTemplateText(htmlToPlainText(newTemplateHtml))}>
                  Aus HTML ableiten
                </Button>
              </Stack>
              <TextField
                fullWidth
                multiline
                minRows={12}
                value={newTemplateText}
                onChange={(event) => setNewTemplateText(event.target.value)}
              />
            </Box>
          </Box>

          <Button
            type="button"
            variant="contained"
            onClick={() => void handleCreateTemplate()}
            disabled={creatingTemplate}
          >
            {creatingTemplate ? 'Vorlage wird angelegt...' : 'Vorlage anlegen'}
          </Button>
        </AdminSurfaceCard>
      )}

      {libraryScopeParams.scope === 'platform' ? (
        <AdminSurfaceCard
          title="Globale Footer-Signatur"
          subtitle="Diese Signatur wird automatisch an alle ausgehenden E-Mails angehängt."
          bodyClassName="space-y-3"
        >
          <FormControlLabel
            control={<Switch checked={footerEnabled} onChange={(event) => setFooterEnabled(event.target.checked)} />}
            label="Footer-Signatur aktivieren"
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
            <TextField
              fullWidth
              multiline
              minRows={6}
              label="Footer HTML"
              value={footerHtml}
              onChange={(event) => setFooterHtml(event.target.value)}
              placeholder="<p><strong>Verbandsgemeinde Otterbach-Otterberg</strong></p>"
            />
            <TextField
              fullWidth
              multiline
              minRows={6}
              label="Footer Text (Fallback)"
              value={footerText}
              onChange={(event) => setFooterText(event.target.value)}
              placeholder="Verbandsgemeinde Otterbach-Otterberg"
            />
          </Box>
          <Button variant="contained" onClick={handleSaveFooterSettings} disabled={savingFooter}>
            {savingFooter ? 'Speichere Footer...' : 'Footer speichern'}
          </Button>
        </AdminSurfaceCard>
      ) : (
        <Alert severity="info">
          Die globale Footer-Signatur ist nur im globalen Kontext sichtbar und bearbeitbar.
        </Alert>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[430px_minmax(0,1fr)] gap-6">
        <AdminSurfaceCard
          title="Template-Navigation"
          subtitle="Filter- und Auswahlansicht im SmartTable-Standard."
          bodyClassName="space-y-3"
        >
          <TextField
            size="small"
            label="Suche"
            value={templateSearch}
            onChange={(event) => setTemplateSearch(event.target.value)}
            placeholder="Name, ID, Tag, Gruppe..."
            fullWidth
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <FormControl size="small" fullWidth>
              <InputLabel id="email-template-editable-filter-label">Filter</InputLabel>
              <Select
                labelId="email-template-editable-filter-label"
                label="Filter"
                value={editableFilter}
                onChange={(event) => setEditableFilter(event.target.value as EditableFilter)}
              >
                <MenuItem value="all">Alle Vorlagen</MenuItem>
                <MenuItem value="editable">Nur editierbar</MenuItem>
                <MenuItem value="system">Nur System</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel id="email-template-lifecycle-filter-label">Lifecycle</InputLabel>
              <Select
                labelId="email-template-lifecycle-filter-label"
                label="Lifecycle"
                value={lifecycleFilter}
                onChange={(event) => setLifecycleFilter(event.target.value as 'all' | TemplateLifecycle)}
              >
                <MenuItem value="all">Alle</MenuItem>
                <MenuItem value="active">Aktiv</MenuItem>
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="deprecated">Veraltet</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <input
              id="template-issue-filter-toggle"
              type="checkbox"
              checked={onlyWithIssues}
              onChange={(event) => setOnlyWithIssues(event.target.checked)}
            />
            <label htmlFor="template-issue-filter-toggle" className="text-sm text-slate-700">
              Nur mit Qualitätswarnung
            </label>
          </Stack>
          <SmartTable<Template>
            tableId="email-template-navigation"
            title="Vorlagen"
            rows={filteredTemplates}
            columns={templateColumns}
            loading={false}
            error=""
            defaultPageSize={10}
            pageSizeOptions={[10, 25, 50]}
            selectionModel={selectedTemplate?.id ? [selectedTemplate.id] : []}
            onSelectionModelChange={(ids) => {
              const id = ids[0];
              if (!id) return;
              const match = filteredTemplates.find((entry) => entry.id === id);
              if (match) {
                void handleSelectTemplate(match);
              }
            }}
            onRowClick={(row) => {
              void handleSelectTemplate(row);
            }}
          />
        </AdminSurfaceCard>

        <div>
          {selectedTemplate ? (
            <AdminSurfaceCard
              title={selectedTemplate.name || selectedTemplate.id}
              subtitle={selectedTemplate.usageHint || 'Template-Details'}
              bodyClassName="space-y-4"
            >
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                {selectedTemplateScopeBadge ? (
                  <Chip size="small" label={selectedTemplateScopeBadge.label} />
                ) : null}
                {selectedTemplate.scope === 'tenant' && selectedTemplate.tenantId ? (
                  <Chip size="small" variant="outlined" label={selectedTemplate.tenantId} />
                ) : null}
                <Button size="small" variant={showAdvancedMeta ? 'outlined' : 'contained'} onClick={() => setShowAdvancedMeta(false)}>
                  Basic
                </Button>
                <Button size="small" variant={showAdvancedMeta ? 'contained' : 'outlined'} onClick={() => setShowAdvancedMeta(true)}>
                  Advanced
                </Button>
              </Stack>

              {!selectedTemplate.editable ? (
                <Alert severity="info">Dieses System-Template ist schreibgeschützt.</Alert>
              ) : null}

              {showAdvancedMeta && (
                <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 1.5, p: 1.5, bgcolor: '#f8fafc' }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Metadaten & Governance
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
                    <TextField
                      fullWidth
                      label="Gruppenpfad"
                      value={groupPathInput}
                      onChange={(event) => setGroupPathInput(event.target.value)}
                      disabled={!selectedTemplate.editable}
                      placeholder="z. B. Workflow > Datennachforderung"
                    />
                    <TextField
                      fullWidth
                      label="Tags"
                      value={tagsInput}
                      onChange={(event) => setTagsInput(event.target.value)}
                      disabled={!selectedTemplate.editable}
                      placeholder="doi, workflow, status"
                    />
                    <FormControl fullWidth disabled={!selectedTemplate.editable}>
                      <InputLabel id="template-lifecycle-select-label">Lifecycle</InputLabel>
                      <Select
                        labelId="template-lifecycle-select-label"
                        label="Lifecycle"
                        value={lifecycleValue}
                        onChange={(event) => setLifecycleValue(event.target.value as TemplateLifecycle)}
                      >
                        <MenuItem value="active">active</MenuItem>
                        <MenuItem value="draft">draft</MenuItem>
                        <MenuItem value="deprecated">deprecated</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      fullWidth
                      label="Owner-Team"
                      value={ownerTeamValue}
                      onChange={(event) => setOwnerTeamValue(event.target.value)}
                      disabled={!selectedTemplate.editable}
                      placeholder="z. B. Bürgerbüro"
                    />
                    <TextField
                      fullWidth
                      label="Maintainer"
                      value={maintainerValue}
                      onChange={(event) => setMaintainerValue(event.target.value)}
                      disabled={!selectedTemplate.editable}
                      placeholder="z. B. templates@kommune.de"
                    />
                    <TextField
                      fullWidth
                      label="Zuletzt geprüft am"
                      value={lastReviewedAtValue}
                      onChange={(event) => setLastReviewedAtValue(event.target.value)}
                      disabled={!selectedTemplate.editable}
                      placeholder="z. B. 2026-02-18"
                    />
                  </Box>
                </Box>
              )}

              <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 1.5, p: 1.5, bgcolor: '#f8fafc' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1}>
                  <Typography variant="subtitle2">Platzhalter-Auswahl für diese Vorlage</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selectedPlaceholders.length} ausgewählt
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setSelectedPlaceholders(allPlaceholderKeys)}
                    disabled={!selectedTemplate.editable}
                  >
                    Alle auswählen
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setSelectedPlaceholders([])}
                    disabled={!selectedTemplate.editable}
                  >
                    Keine Auswahl
                  </Button>
                </Stack>
                <Box
                  sx={{
                    mt: 1.25,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                    gap: 0.75,
                  }}
                >
                  {placeholderEntries.map(([placeholder, meta]) => {
                    const active =
                      selectedPlaceholders.length === 0 || selectedPlaceholders.includes(placeholder);
                    return (
                      <Box
                        key={`template-${placeholder}`}
                        sx={{
                          border: active ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                          borderRadius: 1,
                          px: 1.25,
                          py: 0.75,
                          bgcolor: active ? '#eff6ff' : '#fff',
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                size="small"
                                checked={selectedPlaceholders.includes(placeholder)}
                                onChange={() => toggleSelectedPlaceholder(placeholder)}
                                disabled={!selectedTemplate.editable}
                              />
                            }
                            label={
                              <Box>
                                <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                                  {placeholder}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                  {meta.label}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                  {meta.description}
                                </Typography>
                              </Box>
                            }
                          />
                          <Button size="small" variant="outlined" onClick={() => void copyPlaceholder(placeholder)}>
                            Kopieren
                          </Button>
                        </Stack>
                      </Box>
                    );
                  })}
                </Box>
              </Box>

              <TextField
                fullWidth
                label="Vorlagenname"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                disabled={!selectedTemplate.editable}
                placeholder="Anzeigename der Vorlage"
              />

              <TextField
                fullWidth
                label="E-Mail-Betreff"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={!selectedTemplate.editable}
                placeholder="z. B. Ihre Meldung wurde bestätigt"
              />

              {selectedTemplate.editable ? (
                <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 1.5, p: 1.5, bgcolor: '#f8fafc' }}>
                  <Typography variant="subtitle2" gutterBottom>
                    KI-Unterstützung für Textentwurf
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                    Kategorien werden aus dem Bereich Kategorien übernommen. Platzhalter bleiben erhalten.
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
                    <FormControl fullWidth>
                      <InputLabel id="template-ai-category-select-label">Kategorie *</InputLabel>
                      <Select
                        labelId="template-ai-category-select-label"
                        label="Kategorie *"
                        value={selectedCategoryId}
                        onChange={(event) => setSelectedCategoryId(String(event.target.value))}
                      >
                        <MenuItem value="">Kategorie wählen</MenuItem>
                        {categories.map((category) => (
                          <MenuItem key={category.id} value={category.id}>
                            {category.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl fullWidth>
                      <InputLabel id="template-ai-tone-select-label">Tonfall</InputLabel>
                      <Select
                        labelId="template-ai-tone-select-label"
                        label="Tonfall"
                        value={aiTone}
                        onChange={(event) => setAiTone(event.target.value as typeof aiTone)}
                      >
                        <MenuItem value="neutral">Neutral / sachlich</MenuItem>
                        <MenuItem value="formal">Formal / verwaltungsnah</MenuItem>
                        <MenuItem value="friendly">Freundlich / serviceorientiert</MenuItem>
                        <MenuItem value="concise">Kurz / handlungsorientiert</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      fullWidth
                      multiline
                      minRows={2}
                      label="Kategoriebeschreibung"
                      value={selectedCategory?.description || ''}
                      InputProps={{ readOnly: true }}
                      sx={{ gridColumn: { xs: '1 / -1', md: '1 / -1' } }}
                      placeholder="Beschreibung der Kategorie"
                    />
                    <TextField
                      fullWidth
                      multiline
                      minRows={2}
                      label="Zusatzprompt (optional)"
                      value={aiExtraPrompt}
                      onChange={(event) => setAiExtraPrompt(event.target.value)}
                      sx={{ gridColumn: { xs: '1 / -1', md: '1 / -1' } }}
                      placeholder="z. B. sachlich, kurze Sätze, klare Handlungsaufforderung"
                    />
                  </Box>
                  <Button
                    variant="contained"
                    sx={{ mt: 1.5 }}
                    onClick={() => void handleGenerateTemplate()}
                    disabled={generating}
                  >
                    {generating ? 'Wird generiert...' : 'Mit KI vorschlagen'}
                  </Button>
                </Box>
              ) : null}

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
                <HtmlTemplateEditor
                  label="HTML-Inhalt"
                  value={htmlContent}
                  onChange={setHtmlContent}
                  disabled={!selectedTemplate.editable}
                  editorHeight={420}
                />
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="body2" fontWeight={600}>
                      Nur-Text-Fallback (ohne HTML)
                    </Typography>
                    {selectedTemplate.editable ? (
                      <Button size="small" variant="outlined" onClick={() => setTextContent(htmlToPlainText(htmlContent))}>
                        Aus HTML ableiten
                      </Button>
                    ) : null}
                  </Stack>
                  <TextField
                    fullWidth
                    multiline
                    minRows={19}
                    value={textContent}
                    onChange={(event) => setTextContent(event.target.value)}
                    disabled={!selectedTemplate.editable}
                    placeholder="Dieser Text wird verwendet, wenn das E-Mail-Programm kein HTML unterstützt."
                  />
                </Box>
              </Box>

              {missingPlaceholders.length > 0 ? (
                <Alert severity="warning">
                  Fehlende Pflicht-Platzhalter in Betreff/HTML: {missingPlaceholders.join(', ')}
                </Alert>
              ) : null}
              {textOnlyMissingPlaceholders.length > 0 ? (
                <Alert severity="info">
                  Im Text-Fallback fehlen aktuell: {textOnlyMissingPlaceholders.join(', ')}
                </Alert>
              ) : null}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <Button variant="outlined" onClick={() => void handlePreview()}>
                  Vorschau
                </Button>
                {selectedTemplate.editable ? (
                  <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? 'Wird gespeichert...' : 'Speichern'}
                  </Button>
                ) : null}
              </Stack>

              {showPreview ? (
                <Box sx={{ borderTop: '1px solid #e2e8f0', pt: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Vorschau
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                    <strong>Betreff:</strong> {subject}
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
                    <iframe
                      title="E-Mail HTML Vorschau"
                      sandbox=""
                      srcDoc={previewDoc}
                      style={{ width: '100%', minHeight: 460, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff' }}
                    />
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        minHeight: 460,
                        overflow: 'auto',
                        borderRadius: 1,
                        border: '1px solid #e2e8f0',
                        bgcolor: '#f8fafc',
                        p: 1.25,
                        whiteSpace: 'pre-wrap',
                        fontSize: 13,
                      }}
                    >
                      {previewText}
                    </Box>
                  </Box>
                </Box>
              ) : null}
            </AdminSurfaceCard>
          ) : (
            <Alert severity="info">Wählen Sie links ein Template aus.</Alert>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailTemplates;
