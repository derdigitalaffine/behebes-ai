import React, { useMemo, useState, useEffect, useRef } from 'react';
import axios from 'axios';
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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="block text-sm font-medium">{label}</span>
        <div className="flex flex-wrap gap-1">
          {!sourceMode && (
            <>
              <button
                type="button"
                onClick={() => runCommand('bold')}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs disabled:bg-slate-100 disabled:text-slate-400"
                title="Fett"
              >
                <i className="fa-solid fa-bold" />
              </button>
              <button
                type="button"
                onClick={() => runCommand('italic')}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs disabled:bg-slate-100 disabled:text-slate-400"
                title="Kursiv"
              >
                <i className="fa-solid fa-italic" />
              </button>
              <button
                type="button"
                onClick={() => runCommand('underline')}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs disabled:bg-slate-100 disabled:text-slate-400"
                title="Unterstrichen"
              >
                <i className="fa-solid fa-underline" />
              </button>
              <button
                type="button"
                onClick={() => runCommand('insertUnorderedList')}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs disabled:bg-slate-100 disabled:text-slate-400"
                title="Liste"
              >
                <i className="fa-solid fa-list-ul" />
              </button>
              <button
                type="button"
                onClick={() => runCommand('insertOrderedList')}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs disabled:bg-slate-100 disabled:text-slate-400"
                title="Nummerierte Liste"
              >
                <i className="fa-solid fa-list-ol" />
              </button>
              <button
                type="button"
                onClick={() => runCommand('formatBlock', 'h3')}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs disabled:bg-slate-100 disabled:text-slate-400"
                title="Überschrift"
              >
                H3
              </button>
              <button
                type="button"
                onClick={() => runCommand('formatBlock', 'p')}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs disabled:bg-slate-100 disabled:text-slate-400"
                title="Absatz"
              >
                P
              </button>
              <button
                type="button"
                onClick={() => {
                  if (disabled) return;
                  const url = window.prompt('Link-URL', 'https://');
                  if (!url) return;
                  runCommand('createLink', url.trim());
                }}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs disabled:bg-slate-100 disabled:text-slate-400"
                title="Link"
              >
                <i className="fa-solid fa-link" />
              </button>
              <button
                type="button"
                onClick={() => runCommand('unlink')}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs disabled:bg-slate-100 disabled:text-slate-400"
                title="Link entfernen"
              >
                <i className="fa-solid fa-link-slash" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSourceMode((prev) => !prev)}
            className="px-2 py-1 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs"
          >
            {sourceMode ? 'WYSIWYG' : 'HTML'}
          </button>
        </div>
      </div>
      {sourceMode ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm ${
            disabled ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
          }`}
          style={{ minHeight: `${editorHeight}px` }}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={applyChange}
          onBlur={applyChange}
          className={`w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-blue-500 overflow-auto ${
            disabled ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
          }`}
          style={{ minHeight: `${editorHeight}px` }}
        />
      )}
    </div>
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
      <div className="flex justify-center items-center h-64">
        <i className="fa-solid fa-spinner fa-spin text-slate-600 text-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">E-Mail-Templates</h2>
          <p className="text-sm text-slate-600 mt-1">
            Einheitliches Wording für die Verbandsgemeinde Otterbach-Otterberg und klare Platzhaltersteuerung für behebes.AI.
          </p>
          <div className="mt-2">
            <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
              Aktueller Kontext: {libraryScopeParams.scope === 'tenant' ? 'Mandant' : 'Global'}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
          onClick={() => setShowCreateTemplateForm((prev) => !prev)}
        >
          <i className={`fa-solid ${showCreateTemplateForm ? 'fa-xmark' : 'fa-plus'}`} />
          {showCreateTemplateForm ? 'Anlage schließen' : 'Neue Vorlage'}
        </button>
      </div>

      {message && (
        <div
          className={`message-banner p-4 rounded-lg flex items-center gap-2 ${
            messageType === 'success'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {messageType === 'success' ? (
            <i className="fa-solid fa-circle-check" />
          ) : (
            <i className="fa-solid fa-circle-exclamation" />
          )}
          {message}
        </div>
      )}

      {showCreateTemplateForm && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="font-semibold text-lg">Neue E-Mail-Vorlage anlegen</h3>
          <p className="text-sm text-slate-600">
            Neue Vorlagen können anschließend direkt in Workflow-Schritten ausgewählt werden.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label>
              <span className="block text-sm font-medium mb-1">Name *</span>
              <input
                type="text"
                value={newTemplateName}
                onChange={(event) => setNewTemplateName(event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="z. B. Interne Rückmeldung"
              />
            </label>
            <label>
              <span className="block text-sm font-medium mb-1">Technische ID (optional)</span>
              <input
                type="text"
                value={newTemplateId}
                onChange={(event) => setNewTemplateId(sanitizeTemplateId(event.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder="z. B. interne-rueckmeldung"
              />
            </label>
            <label>
              <span className="block text-sm font-medium mb-1">Betreff *</span>
              <input
                type="text"
                value={newTemplateSubject}
                onChange={(event) => setNewTemplateSubject(event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="z. B. Rückmeldung zu Ihrer Meldung ({ticketId})"
              />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-semibold text-slate-900">Pflicht-Platzhalter für diese Vorlage</h4>
              <span className="text-xs text-slate-500">
                {newTemplatePlaceholders.length} ausgewählt
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
                onClick={() => setNewTemplatePlaceholders(allPlaceholderKeys)}
              >
                Alle auswählen
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
                onClick={() => setNewTemplatePlaceholders([])}
              >
                Keine Auswahl (alle erlaubt)
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {placeholderEntries.map(([placeholder, meta]) => (
                <label
                  key={`create-${placeholder}`}
                  className="rounded border border-slate-200 bg-white px-3 py-2 text-sm flex items-start gap-2"
                >
                  <input
                    type="checkbox"
                    checked={newTemplatePlaceholders.includes(placeholder)}
                    onChange={() => toggleCreatePlaceholder(placeholder)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono text-slate-900">{placeholder}</span>
                    <span className="block text-xs text-slate-600">{meta.label}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <HtmlTemplateEditor
              label="HTML-Inhalt *"
              value={newTemplateHtml}
              onChange={setNewTemplateHtml}
              editorHeight={260}
            />
            <label>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="block text-sm font-medium">Nur-Text-Fallback</span>
                <button
                  type="button"
                  onClick={() => setNewTemplateText(htmlToPlainText(newTemplateHtml))}
                  className="text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
                >
                  Aus HTML ableiten
                </button>
              </div>
              <textarea
                value={newTemplateText}
                onChange={(event) => setNewTemplateText(event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                rows={12}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition"
              onClick={() => void handleCreateTemplate()}
              disabled={creatingTemplate}
            >
              <i className="fa-solid fa-floppy-disk" />
              {creatingTemplate ? 'Vorlage wird angelegt...' : 'Vorlage anlegen'}
            </button>
          </div>
        </div>
      )}

      {libraryScopeParams.scope === 'platform' ? (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="font-semibold">Globale Footer-Signatur</h3>
          <p className="text-sm text-gray-600">
            Diese Signatur wird automatisch an alle ausgehenden E-Mails angehängt.
          </p>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={footerEnabled}
              onChange={(event) => setFooterEnabled(event.target.checked)}
            />
            Footer-Signatur aktivieren
          </label>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <label>
              <span className="block text-sm font-medium mb-2">Footer HTML</span>
              <textarea
                value={footerHtml}
                onChange={(event) => setFooterHtml(event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                rows={6}
                placeholder="<p><strong>Verbandsgemeinde Otterbach-Otterberg</strong></p>"
              />
            </label>
            <label>
              <span className="block text-sm font-medium mb-2">Footer Text (Fallback)</span>
              <textarea
                value={footerText}
                onChange={(event) => setFooterText(event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                rows={6}
                placeholder="Verbandsgemeinde Otterbach-Otterberg"
              />
            </label>
          </div>
          <div>
            <button
              type="button"
              onClick={handleSaveFooterSettings}
              disabled={savingFooter}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:bg-gray-400 text-white font-semibold rounded-lg transition"
            >
              {savingFooter ? 'Speichere Footer...' : <><i className="fa-solid fa-floppy-disk" /> Footer speichern</>}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Die globale Footer-Signatur ist nur im globalen Kontext sichtbar und bearbeitbar.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-4">Template-Navigation</h3>
          <div className="space-y-3 mb-4">
            <input
              type="search"
              value={templateSearch}
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="Suche nach Name, ID, Tag, Gruppe..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
            <div className="grid grid-cols-1 gap-2">
              <select
                value={editableFilter}
                onChange={(event) => setEditableFilter(event.target.value as EditableFilter)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                <option value="all">Alle Vorlagen</option>
                <option value="editable">Nur editierbar</option>
                <option value="system">Nur System</option>
              </select>
              <select
                value={lifecycleFilter}
                onChange={(event) => setLifecycleFilter(event.target.value as 'all' | TemplateLifecycle)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                <option value="all">Alle Lifecycle-Stufen</option>
                <option value="active">Nur aktiv</option>
                <option value="draft">Nur Draft</option>
                <option value="deprecated">Nur veraltet</option>
              </select>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={onlyWithIssues}
                  onChange={(event) => setOnlyWithIssues(event.target.checked)}
                />
                Nur mit Qualitätswarnung
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
                onClick={() => setAllTreeNodesExpanded(true)}
              >
                Alle aufklappen
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
                onClick={() => setAllTreeNodesExpanded(false)}
              >
                Alle zuklappen
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-[72vh] overflow-y-auto pr-1">
            {templateTree.length === 0 && (
              <p className="text-sm text-slate-500">Keine Templates für die aktuelle Filterung gefunden.</p>
            )}
            {templateTree.map((node) => renderTemplateTreeNode(node))}
          </div>
        </div>

        <div>
          {selectedTemplate ? (
            <div className="bg-white rounded-lg shadow p-6 space-y-4">
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold text-lg">{selectedTemplate.name}</h3>
                <p className="text-sm text-slate-600">{selectedTemplate.usageHint}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedTemplateScopeBadge ? (
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${selectedTemplateScopeBadge.className}`}
                    >
                      {selectedTemplateScopeBadge.label}
                    </span>
                  ) : null}
                  {selectedTemplate.scope === 'tenant' && selectedTemplate.tenantId ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-300 bg-white text-slate-600 font-mono">
                      {selectedTemplate.tenantId}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedMeta(false)}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${
                      !showAdvancedMeta
                        ? 'bg-blue-50 border-blue-300 text-blue-800'
                        : 'bg-white border-slate-300 text-slate-700'
                    }`}
                  >
                    Basic
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAdvancedMeta(true)}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${
                      showAdvancedMeta
                        ? 'bg-blue-50 border-blue-300 text-blue-800'
                        : 'bg-white border-slate-300 text-slate-700'
                    }`}
                  >
                    Advanced
                  </button>
                </div>
                {!selectedTemplate.editable && (
                  <div className="bg-blue-50 border border-blue-300 rounded p-3 text-sm text-blue-800">
                    <i className="fa-solid fa-lock" /> Dieses System-Template ist schreibgeschützt.
                  </div>
                )}
              </div>

              {showAdvancedMeta && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <h4 className="font-semibold text-slate-900">Metadaten & Governance</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label>
                      <span className="block text-sm font-medium mb-1">Gruppenpfad</span>
                      <input
                        type="text"
                        value={groupPathInput}
                        onChange={(event) => setGroupPathInput(event.target.value)}
                        disabled={!selectedTemplate.editable}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                          !selectedTemplate.editable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                        }`}
                        placeholder="z. B. Workflow > Datennachforderung"
                      />
                    </label>
                    <label>
                      <span className="block text-sm font-medium mb-1">Tags</span>
                      <input
                        type="text"
                        value={tagsInput}
                        onChange={(event) => setTagsInput(event.target.value)}
                        disabled={!selectedTemplate.editable}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                          !selectedTemplate.editable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                        }`}
                        placeholder="doi, workflow, status"
                      />
                    </label>
                    <label>
                      <span className="block text-sm font-medium mb-1">Lifecycle</span>
                      <select
                        value={lifecycleValue}
                        onChange={(event) => setLifecycleValue(event.target.value as TemplateLifecycle)}
                        disabled={!selectedTemplate.editable}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                          !selectedTemplate.editable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                        }`}
                      >
                        <option value="active">active</option>
                        <option value="draft">draft</option>
                        <option value="deprecated">deprecated</option>
                      </select>
                    </label>
                    <label>
                      <span className="block text-sm font-medium mb-1">Owner-Team</span>
                      <input
                        type="text"
                        value={ownerTeamValue}
                        onChange={(event) => setOwnerTeamValue(event.target.value)}
                        disabled={!selectedTemplate.editable}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                          !selectedTemplate.editable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                        }`}
                        placeholder="z. B. Bürgerbüro"
                      />
                    </label>
                    <label>
                      <span className="block text-sm font-medium mb-1">Maintainer</span>
                      <input
                        type="text"
                        value={maintainerValue}
                        onChange={(event) => setMaintainerValue(event.target.value)}
                        disabled={!selectedTemplate.editable}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                          !selectedTemplate.editable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                        }`}
                        placeholder="z. B. templates@kommune.de"
                      />
                    </label>
                    <label>
                      <span className="block text-sm font-medium mb-1">Zuletzt geprüft am</span>
                      <input
                        type="text"
                        value={lastReviewedAtValue}
                        onChange={(event) => setLastReviewedAtValue(event.target.value)}
                        disabled={!selectedTemplate.editable}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                          !selectedTemplate.editable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                        }`}
                        placeholder="z. B. 2026-02-18"
                      />
                    </label>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="font-semibold text-slate-900">Platzhalter-Auswahl für diese Vorlage</h4>
                  <span className="text-xs text-slate-500">
                    {selectedPlaceholders.length} ausgewählt
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
                    onClick={() => setSelectedPlaceholders(allPlaceholderKeys)}
                    disabled={!selectedTemplate.editable}
                  >
                    Alle auswählen
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
                    onClick={() => setSelectedPlaceholders([])}
                    disabled={!selectedTemplate.editable}
                  >
                    Keine Auswahl (alle erlaubt)
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {placeholderEntries.map(([placeholder, meta]) => {
                    const active =
                      selectedPlaceholders.length === 0 || selectedPlaceholders.includes(placeholder);
                    return (
                      <label
                        key={`template-${placeholder}`}
                        className={`rounded border px-3 py-2 text-sm flex items-start justify-between gap-3 ${
                          active ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <span className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selectedPlaceholders.includes(placeholder)}
                            onChange={() => toggleSelectedPlaceholder(placeholder)}
                            className="mt-0.5"
                            disabled={!selectedTemplate.editable}
                          />
                          <span>
                            <span className="font-mono text-slate-900">{placeholder}</span>
                            <span className="block text-xs text-slate-600">{meta.label}</span>
                            <span className="block text-xs text-slate-500">{meta.description}</span>
                          </span>
                        </span>
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
                          onClick={() => void copyPlaceholder(placeholder)}
                        >
                          Kopieren
                        </button>
                      </label>
                    );
                  })}
                </div>
              </div>

              <label>
                <span className="block text-sm font-medium mb-2">Vorlagenname</span>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  disabled={!selectedTemplate.editable}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    !selectedTemplate.editable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                  }`}
                  placeholder="Anzeigename der Vorlage"
                />
              </label>

              <label>
                <span className="block text-sm font-medium mb-2">E-Mail-Betreff</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={!selectedTemplate.editable}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    !selectedTemplate.editable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                  }`}
                  placeholder="z. B. Ihre Meldung wurde bestätigt"
                />
              </label>

              {selectedTemplate.editable && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                  <h4 className="font-semibold text-slate-800">KI-Unterstützung für Textentwurf</h4>
                  <p className="text-xs text-slate-500">
                    Kategorien werden aus dem Bereich Kategorien übernommen. Platzhalter bleiben erhalten.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label>
                      <span className="block text-sm font-medium mb-1">Kategorie *</span>
                      <select
                        value={selectedCategoryId}
                        onChange={(e) => setSelectedCategoryId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Kategorie wählen</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="block text-sm font-medium mb-1">Tonfall</span>
                      <select
                        value={aiTone}
                        onChange={(e) => setAiTone(e.target.value as typeof aiTone)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="neutral">Neutral / sachlich</option>
                        <option value="formal">Formal / verwaltungsnah</option>
                        <option value="friendly">Freundlich / serviceorientiert</option>
                        <option value="concise">Kurz / handlungsorientiert</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    <span className="block text-sm font-medium mb-1">Kategoriebeschreibung</span>
                    <textarea
                      value={selectedCategory?.description || ''}
                      readOnly
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-700"
                      rows={2}
                      placeholder="Beschreibung der Kategorie"
                    />
                  </label>
                  <label>
                    <span className="block text-sm font-medium mb-1">Zusatzprompt (optional)</span>
                    <textarea
                      value={aiExtraPrompt}
                      onChange={(e) => setAiExtraPrompt(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      rows={2}
                      placeholder="z. B. sachlich, kurze Sätze, klare Handlungsaufforderung"
                    />
                  </label>
                  <button
                    onClick={() => void handleGenerateTemplate()}
                    disabled={generating}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-semibold transition"
                  >
                    <i className="fa-solid fa-wand-magic-sparkles" />
                    {generating ? 'Wird generiert...' : 'Mit KI vorschlagen'}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <HtmlTemplateEditor
                  label="HTML-Inhalt"
                  value={htmlContent}
                  onChange={setHtmlContent}
                  disabled={!selectedTemplate.editable}
                  editorHeight={420}
                />
                <label>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="block text-sm font-medium">Nur-Text-Fallback (ohne HTML)</span>
                    {selectedTemplate.editable && (
                      <button
                        type="button"
                        onClick={() => setTextContent(htmlToPlainText(htmlContent))}
                        className="text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
                      >
                        Aus HTML ableiten
                      </button>
                    )}
                  </div>
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    disabled={!selectedTemplate.editable}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm ${
                      !selectedTemplate.editable ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                    }`}
                    rows={19}
                    placeholder="Dieser Text wird verwendet, wenn das E-Mail-Programm kein HTML unterstützt."
                  />
                </label>
              </div>

              {missingPlaceholders.length > 0 && (
                <div className="p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                  <strong><i className="fa-solid fa-triangle-exclamation" /> Fehlende Pflicht-Platzhalter in Betreff/HTML:</strong>{' '}
                  {missingPlaceholders.join(', ')}
                </div>
              )}
              {textOnlyMissingPlaceholders.length > 0 && (
                <div className="p-3 rounded border border-blue-300 bg-blue-50 text-blue-900 text-sm">
                  <strong><i className="fa-solid fa-circle-info" /> Hinweis:</strong> Im Text-Fallback fehlen aktuell:{' '}
                  {textOnlyMissingPlaceholders.join(', ')}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void handlePreview()}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white font-semibold rounded-lg transition"
                >
                  <i className="fa-solid fa-eye" /> Vorschau
                </button>
                {selectedTemplate.editable && (
                  <button
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition"
                  >
                    {saving ? 'Wird gespeichert...' : <><i className="fa-solid fa-floppy-disk" /> Speichern</>}
                  </button>
                )}
              </div>

              {showPreview && (
                <div className="mt-2 border-t pt-4">
                  <h4 className="font-semibold mb-3"><i className="fa-solid fa-envelope" /> Vorschau</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    <strong>Betreff:</strong> {subject}
                  </p>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <iframe
                      title="E-Mail HTML Vorschau"
                      sandbox=""
                      className="w-full h-[460px] rounded border border-gray-200 bg-white"
                      srcDoc={previewDoc}
                    />
                    <pre className="w-full h-[460px] overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                      {previewText}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
              Wählen Sie links ein Template aus.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailTemplates;
