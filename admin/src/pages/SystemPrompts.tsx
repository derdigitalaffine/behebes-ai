import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';
import SourceTag from '../components/SourceTag';
import './SystemPrompts.css';

type MessageType = 'success' | 'error' | '';

interface PromptMeta {
  label: string;
  description: string;
  nodePath: string[];
  keywords?: string[];
}

interface PromptEntry {
  key: string;
  label: string;
  description: string;
  value: string;
  source?: string;
  nodePath: string[];
  searchText: string;
  dirty: boolean;
}

interface PromptTreeNode {
  id: string;
  label: string;
  children: PromptTreeNode[];
  prompts: PromptEntry[];
  promptCount: number;
  dirtyCount: number;
}

interface MutablePromptTreeNode {
  id: string;
  label: string;
  childMap: Map<string, MutablePromptTreeNode>;
  prompts: PromptEntry[];
}

const TREE_EXPANDED_STATE_KEY = 'systemPrompts.tree.expanded.v1';
const DEFAULT_NODE_PATH = ['Benutzerdefiniert'];

const PROMPT_META: Record<string, PromptMeta> = {
  classifyPrompt: {
    label: 'Klassifizierung',
    description: 'Systemprompt für automatische Kategorisierung und Priorisierung.',
    nodePath: ['Ticket-Intake', 'Klassifizierung'],
    keywords: ['priority', 'kategorie', 'dringlichkeit'],
  },
  redmineTicketPrompt: {
    label: 'Redmine Ticket (KI)',
    description: 'Systemprompt für KI-unterstützte Redmine-Ticketgenerierung.',
    nodePath: ['Ticket-Intake', 'Redmine'],
    keywords: ['redmine', 'ticket'],
  },
  imageAnalysisPrompt: {
    label: 'Bildanalyse (Bild zu Text)',
    description: 'Systemprompt für KI-Bildauswertung mit pseudonymisiertem Ticketkontext.',
    nodePath: ['Ticket-Intake', 'Bildanalyse'],
    keywords: ['image', 'foto', 'anhang'],
  },
  templateGenerationPrompt: {
    label: 'E-Mail-Template Generierung',
    description: 'Systemprompt für die KI-Erzeugung neuer E-Mail-Templates.',
    nodePath: ['E-Mail', 'Template-Automation', 'Generierung'],
    keywords: ['email', 'vorlagen'],
  },
  templateJsonRepairPrompt: {
    label: 'Template JSON-Reparatur',
    description: 'Repariert fehlerhafte KI-Ausgaben bei Template-Generierung.',
    nodePath: ['E-Mail', 'Template-Automation', 'JSON-Reparatur'],
    keywords: ['json', 'repair'],
  },
  templatePlaceholderCompletionPrompt: {
    label: 'Template Platzhalter-Vervollständigung',
    description: 'Ergänzt fehlende Pflicht-Platzhalter in erzeugten Templates.',
    nodePath: ['E-Mail', 'Template-Automation', 'Platzhalter'],
    keywords: ['placeholder', 'pflichtfeld'],
  },
  workflowTemplateGenerationPrompt: {
    label: 'Workflow Generierung',
    description: 'Systemprompt zur KI-Erstellung von DTPN-Workflows.',
    nodePath: ['Workflow', 'Vorlagen', 'Generierung'],
    keywords: ['dtpn', 'workflow'],
  },
  workflowJsonRepairPrompt: {
    label: 'Workflow JSON-Reparatur',
    description: 'Repariert fehlerhafte KI-Workflow-JSON-Antworten.',
    nodePath: ['Workflow', 'Vorlagen', 'JSON-Reparatur'],
    keywords: ['json', 'workflow'],
  },
  workflowTemplateSelectionPrompt: {
    label: 'Workflow-Auswahl',
    description: 'Wählt passende Workflow-Vorlagen für eingehende Tickets.',
    nodePath: ['Workflow', 'Vorlagen', 'Auswahl'],
    keywords: ['selection', 'routing'],
  },
  workflowDataRequestPrompt: {
    label: 'Datennachforderung (Fragen)',
    description: 'Erzeugt strukturierte Rückfragen für fehlende Ticketdaten.',
    nodePath: ['Workflow', 'Datennachforderung', 'Standard', 'Fragen'],
    keywords: ['nachforderung', 'rueckfragen'],
  },
  workflowDataRequestNeedCheckPrompt: {
    label: 'Datennachforderung (Vorprüfung)',
    description: 'Prüft Konfidenz für Kategorie/Priorität und ob Rückfragen nötig sind.',
    nodePath: ['Workflow', 'Datennachforderung', 'Standard', 'Vorprüfung'],
    keywords: ['need check', 'confidence'],
  },
  workflowDataRequestAnswerEvaluationPrompt: {
    label: 'Datennachforderung (Auswertung)',
    description: 'Bewertet Antworten und erzeugt ggf. Ticket-Updates + Kommentar.',
    nodePath: ['Workflow', 'Datennachforderung', 'Standard', 'Auswertung'],
    keywords: ['answer evaluation', 'update'],
  },
  workflowFreeDataRequestNeedCheckPrompt: {
    label: 'Freie Datennachforderung (Vorprüfung)',
    description: 'Prüft zieldefinitionsbasiert, ob weitere Rückfragen erforderlich sind.',
    nodePath: ['Workflow', 'Datennachforderung', 'Frei', 'Vorprüfung'],
    keywords: ['free', 'need check'],
  },
  workflowFreeDataRequestPrompt: {
    label: 'Freie Datennachforderung (Fragen)',
    description: 'Erzeugt universelle, zielorientierte Rückfragen als strukturiertes Formular.',
    nodePath: ['Workflow', 'Datennachforderung', 'Frei', 'Fragen'],
    keywords: ['free', 'questions'],
  },
  workflowFreeDataRequestAnswerEvaluationPrompt: {
    label: 'Freie Datennachforderung (Auswertung)',
    description: 'Leitet strukturierte Zusatzvariablen aus Antworten ab.',
    nodePath: ['Workflow', 'Datennachforderung', 'Frei', 'Auswertung'],
    keywords: ['free', 'evaluation'],
  },
  workflowRecategorizationPrompt: {
    label: 'Workflowwechsel Rekategorisierung',
    description: 'KI-Rekategorisierung vor CHANGE_WORKFLOW inkl. Begründung/Konfidenz.',
    nodePath: ['Workflow', 'Steuerung', 'Rekategorisierung'],
    keywords: ['change workflow', 'recategorization'],
  },
  workflowCategorizationOrgAssignmentPrompt: {
    label: 'Kategorisierung Org-Zuweisung',
    description: 'Optionale KI-Zuweisung auf Org-Einheit nach Kategorisierung im Mandanten.',
    nodePath: ['Workflow', 'Steuerung', 'Kategorisierung'],
    keywords: ['categorization', 'assignment', 'org unit'],
  },
  workflowResponsibilityCheckPrompt: {
    label: 'Verwaltungs-Zuständigkeitsprüfung',
    description: 'Prüft die zuständige Verwaltungsebene (RLP) für ein Ticket.',
    nodePath: ['Workflow', 'Steuerung', 'Zuständigkeit'],
    keywords: ['zuständigkeit', 'jurisdiction', 'rlp'],
  },
  workflowApiProbeAnalysisPrompt: {
    label: 'REST API Probe-Auswertung',
    description: 'Analysiert Probe-API-Calls und liefert strukturierte Integrationshinweise.',
    nodePath: ['Workflow', 'REST API Call', 'Probefenster'],
    keywords: ['api', 'probe', 'integration'],
  },
  aiSituationReportPrompt: {
    label: 'KI Lagebild',
    description: 'Analysiert die Meldelage und liefert Label-Empfehlungen.',
    nodePath: ['Lagebild', 'Analysen', 'Berichte'],
    keywords: ['report', 'situation'],
  },
  aiSituationCategoryWorkflowPrompt: {
    label: 'KI Kategorien/Workflow-Beratung',
    description: 'Spezialanalyse für Kategorie-Fit, Workflow-Passung, Laufzeiten und Optimierung.',
    nodePath: ['Lagebild', 'Analysen', 'Kategorien & Workflow'],
    keywords: ['optimization', 'category fit'],
  },
  aiSituationFreeAnalysisPrompt: {
    label: 'KI Freie Analyse',
    description: 'Beantwortet freie, benutzerdefinierte Analysefragen auf Basis der Ticketdaten.',
    nodePath: ['Lagebild', 'Analysen', 'Freie Analyse'],
    keywords: ['free analysis'],
  },
  aiSituationMemoryCompressionPrompt: {
    label: 'KI Analyse-Memory Komprimierung',
    description: 'Verdichtet Analyseergebnisse zu kompaktem, langlebigem Kontext.',
    nodePath: ['Lagebild', 'Analysen', 'Memory'],
    keywords: ['memory', 'compression'],
  },
  llmPseudonymPoolPrompt: {
    label: 'Pseudonym-Pool Generator',
    description: 'Erzeugt Pseudonym-Listen für datenschutzkonforme LLM-Analysen.',
    nodePath: ['Lagebild', 'Pseudonymisierung'],
    keywords: ['privacy', 'pseudonym'],
  },
  workflowConfirmationInstructionPrompt: {
    label: 'Freigabe-Anweisung',
    description: 'Erzeugt kurze Arbeitsanweisungen für E-Mail-Freigabeschritte.',
    nodePath: ['Workflow', 'Kommunikation', 'Freigabe'],
    keywords: ['approval', 'instruction'],
  },
  workflowInternalTaskGeneratorPrompt: {
    label: 'Interne Aufgaben-Generierung',
    description: 'Erzeugt strukturierte interne Arbeitsaufträge im Workflow-Kontext.',
    nodePath: ['Workflow', 'Interne Bearbeitung'],
    keywords: ['internal task', 'workflow'],
  },
  emailTranslationPrompt: {
    label: 'E-Mail-Übersetzung',
    description: 'Übersetzt E-Mail-Inhalte bei mehrsprachiger Bürgerkommunikation.',
    nodePath: ['Übersetzung', 'E-Mail'],
    keywords: ['translation', 'email'],
  },
  uiTranslationPrompt: {
    label: 'UI-Übersetzung',
    description: 'Übersetzt Frontend-Texte für das Bürgerformular.',
    nodePath: ['Übersetzung', 'UI'],
    keywords: ['translation', 'frontend'],
  },
  adminAiHelpPrompt: {
    label: 'Admin KI-Hilfe',
    description: 'Systemprompt für die neue Bedienungs-KI im Admin-Backend.',
    nodePath: ['Admin', 'Assistenten'],
    keywords: ['help', 'assistant'],
  },
  categoryAssistantPrompt: {
    label: 'Kategorien-Assistent',
    description: 'Systemprompt für KI-Entwürfe neuer Kategorien im Admin-Bereich.',
    nodePath: ['Admin', 'Assistenten'],
    keywords: ['category', 'assistant'],
  },
};

const PROMPT_ORDER: string[] = [
  'classifyPrompt',
  'redmineTicketPrompt',
  'imageAnalysisPrompt',
  'templateGenerationPrompt',
  'templateJsonRepairPrompt',
  'templatePlaceholderCompletionPrompt',
  'workflowTemplateGenerationPrompt',
  'workflowJsonRepairPrompt',
  'workflowTemplateSelectionPrompt',
  'workflowDataRequestNeedCheckPrompt',
  'workflowDataRequestPrompt',
  'workflowDataRequestAnswerEvaluationPrompt',
  'workflowFreeDataRequestNeedCheckPrompt',
  'workflowFreeDataRequestPrompt',
  'workflowFreeDataRequestAnswerEvaluationPrompt',
  'workflowRecategorizationPrompt',
  'workflowCategorizationOrgAssignmentPrompt',
  'workflowResponsibilityCheckPrompt',
  'workflowApiProbeAnalysisPrompt',
  'aiSituationReportPrompt',
  'aiSituationCategoryWorkflowPrompt',
  'aiSituationFreeAnalysisPrompt',
  'aiSituationMemoryCompressionPrompt',
  'llmPseudonymPoolPrompt',
  'workflowConfirmationInstructionPrompt',
  'workflowInternalTaskGeneratorPrompt',
  'emailTranslationPrompt',
  'uiTranslationPrompt',
  'adminAiHelpPrompt',
  'categoryAssistantPrompt',
];

const normalizeSearch = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const loadExpandedTreeNodes = (): Record<string, boolean> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(TREE_EXPANDED_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.entries(parsed).reduce<Record<string, boolean>>((acc, [key, value]) => {
      acc[key] = value !== false;
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const buildPromptTree = (entries: PromptEntry[]): PromptTreeNode[] => {
  const rootMap = new Map<string, MutablePromptTreeNode>();

  const getOrCreateNode = (
    map: Map<string, MutablePromptTreeNode>,
    label: string,
    path: string[]
  ): MutablePromptTreeNode => {
    const existing = map.get(label);
    if (existing) return existing;
    const node: MutablePromptTreeNode = {
      id: path.join('::'),
      label,
      childMap: new Map<string, MutablePromptTreeNode>(),
      prompts: [],
    };
    map.set(label, node);
    return node;
  };

  entries.forEach((entry) => {
    const safePath = (entry.nodePath || []).map((segment) => String(segment || '').trim()).filter(Boolean);
    const path = safePath.length > 0 ? safePath : DEFAULT_NODE_PATH;
    let level = rootMap;
    let parentNode: MutablePromptTreeNode | null = null;
    const currentPath: string[] = [];
    path.forEach((segment) => {
      currentPath.push(segment);
      const node = getOrCreateNode(level, segment, currentPath);
      parentNode = node;
      level = node.childMap;
    });
    if (parentNode) parentNode.prompts.push(entry);
  });

  const finalizeNode = (node: MutablePromptTreeNode): PromptTreeNode => {
    const children = Array.from(node.childMap.values()).map(finalizeNode);
    const ownDirtyCount = node.prompts.filter((entry) => entry.dirty).length;
    const childPromptCount = children.reduce((sum, child) => sum + child.promptCount, 0);
    const childDirtyCount = children.reduce((sum, child) => sum + child.dirtyCount, 0);
    return {
      id: node.id,
      label: node.label,
      children,
      prompts: node.prompts,
      promptCount: node.prompts.length + childPromptCount,
      dirtyCount: ownDirtyCount + childDirtyCount,
    };
  };

  return Array.from(rootMap.values()).map(finalizeNode);
};

const SystemPrompts: React.FC = () => {
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [initialPrompts, setInitialPrompts] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, string>>({});
  const [selectedPromptKey, setSelectedPromptKey] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedTreeNodes, setExpandedTreeNodes] = useState<Record<string, boolean>>(loadExpandedTreeNodes);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<MessageType>('');

  const fetchPrompts = async (options: { showBlockingLoader?: boolean; resetMessage?: boolean } = {}) => {
    const { showBlockingLoader = false, resetMessage = false } = options;
    if (showBlockingLoader) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    if (resetMessage) {
      setMessage('');
      setMessageType('');
    }

    try {
      const token = getAdminToken();
      const response = await axios.get('/api/admin/config/prompts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const loadedPrompts = response.data?.prompts || {};
      setPrompts(loadedPrompts);
      setInitialPrompts(loadedPrompts);
      setSources(response.data?.sources || {});
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Fehler beim Laden der Prompts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchPrompts({ showBlockingLoader: true });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(TREE_EXPANDED_STATE_KEY, JSON.stringify(expandedTreeNodes));
    } catch {
      // Ignore localStorage write failures.
    }
  }, [expandedTreeNodes]);

  const dirtyPromptKeys = useMemo(() => {
    const keys = new Set<string>([...Object.keys(prompts || {}), ...Object.keys(initialPrompts || {})]);
    const changed: string[] = [];
    keys.forEach((key) => {
      const currentValue = String(prompts[key] || '');
      const initialValue = String(initialPrompts[key] || '');
      if (currentValue !== initialValue) changed.push(key);
    });
    return changed;
  }, [prompts, initialPrompts]);

  const dirtySet = useMemo(() => new Set(dirtyPromptKeys), [dirtyPromptKeys]);

  const promptEntries = useMemo(() => {
    const knownOrder = new Set(PROMPT_ORDER);
    const keys = Object.keys(prompts || {});
    const orderedKnownKeys = PROMPT_ORDER.filter((key) => keys.includes(key));
    const unknownKeys = keys
      .filter((key) => !knownOrder.has(key))
      .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));

    return [...orderedKnownKeys, ...unknownKeys].map<PromptEntry>((key) => {
      const meta = PROMPT_META[key];
      const nodePath = meta?.nodePath?.length ? meta.nodePath : DEFAULT_NODE_PATH;
      const label = meta?.label || key;
      const description = meta?.description || 'Benutzerdefinierter Systemprompt.';
      const keywords = meta?.keywords || [];
      const searchText = normalizeSearch(
        [key, label, description, ...nodePath, ...keywords].join(' ')
      );

      return {
        key,
        label,
        description,
        value: String(prompts[key] || ''),
        source: sources[key],
        nodePath,
        searchText,
        dirty: dirtySet.has(key),
      };
    });
  }, [prompts, sources, dirtySet]);

  const filteredPromptEntries = useMemo(() => {
    const normalizedSearch = normalizeSearch(searchTerm);
    if (!normalizedSearch) return promptEntries;
    return promptEntries.filter((entry) => entry.searchText.includes(normalizedSearch));
  }, [promptEntries, searchTerm]);

  const promptTree = useMemo(() => buildPromptTree(filteredPromptEntries), [filteredPromptEntries]);

  useEffect(() => {
    if (!selectedPromptKey) {
      if (filteredPromptEntries.length > 0) setSelectedPromptKey(filteredPromptEntries[0].key);
      return;
    }
    const existsInFiltered = filteredPromptEntries.some((entry) => entry.key === selectedPromptKey);
    const existsInAll = promptEntries.some((entry) => entry.key === selectedPromptKey);
    if (existsInFiltered) return;
    if (!searchTerm && existsInAll) return;
    if (filteredPromptEntries.length > 0) {
      setSelectedPromptKey(filteredPromptEntries[0].key);
    } else if (promptEntries.length > 0) {
      setSelectedPromptKey(promptEntries[0].key);
    } else {
      setSelectedPromptKey('');
    }
  }, [selectedPromptKey, filteredPromptEntries, promptEntries, searchTerm]);

  const selectedPromptEntry =
    promptEntries.find((entry) => entry.key === selectedPromptKey) || filteredPromptEntries[0] || null;
  const selectedPromptValue = selectedPromptEntry ? String(prompts[selectedPromptEntry.key] || '') : '';
  const selectedInitialValue = selectedPromptEntry ? String(initialPrompts[selectedPromptEntry.key] || '') : '';
  const selectedPromptIsDirty = selectedPromptEntry ? selectedPromptValue !== selectedInitialValue : false;

  const selectedPromptStats = {
    characters: selectedPromptValue.length,
    lines: selectedPromptValue ? selectedPromptValue.split(/\r?\n/).length : 0,
  };

  const handleChange = (key: string, value: string) => {
    setPrompts((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    setMessageType('');
    try {
      const token = getAdminToken();
      await axios.patch(
        '/api/admin/config/prompts',
        { prompts },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchPrompts();
      setMessageType('success');
      setMessage('Prompts erfolgreich gespeichert');
      window.setTimeout(() => setMessage(''), 2600);
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Fehler beim Speichern der Prompts');
    } finally {
      setSaving(false);
    }
  };

  const handleResetSelected = () => {
    if (!selectedPromptEntry) return;
    const originalValue = String(initialPrompts[selectedPromptEntry.key] || '');
    setPrompts((prev) => ({ ...prev, [selectedPromptEntry.key]: originalValue }));
  };

  const toggleTreeNode = (nodeId: string) => {
    setExpandedTreeNodes((prev) => ({
      ...prev,
      [nodeId]: prev[nodeId] === false,
    }));
  };

  const setAllTreeNodesExpanded = (expanded: boolean) => {
    const next: Record<string, boolean> = {};
    const walk = (nodes: PromptTreeNode[]) => {
      nodes.forEach((node) => {
        next[node.id] = expanded;
        walk(node.children);
      });
    };
    walk(promptTree);
    setExpandedTreeNodes(next);
  };

  const renderPromptTreeNode = (node: PromptTreeNode): React.ReactNode => {
    const isExpanded = expandedTreeNodes[node.id] !== false;
    return (
      <div key={node.id} className="system-prompts-tree-node">
        <button
          type="button"
          onClick={() => toggleTreeNode(node.id)}
          className="system-prompts-tree-node-toggle"
        >
          <span className="system-prompts-tree-node-label-wrap">
            <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} system-prompts-tree-chevron`} />
            <span className="system-prompts-tree-node-label">{node.label}</span>
          </span>
          <span className="system-prompts-tree-node-count-wrap">
            <span className="system-prompts-tree-count">{node.promptCount}</span>
            {node.dirtyCount > 0 && (
              <span className="system-prompts-tree-dirty-count">{node.dirtyCount}</span>
            )}
          </span>
        </button>

        {isExpanded && (
          <div className="system-prompts-tree-children">
            {node.children.map((child) => renderPromptTreeNode(child))}
            {node.prompts.map((entry) => (
              <button
                type="button"
                key={entry.key}
                onClick={() => setSelectedPromptKey(entry.key)}
                className={`system-prompts-tree-item ${selectedPromptEntry?.key === entry.key ? 'active' : ''}`}
              >
                <span className="system-prompts-tree-item-title-row">
                  <span className="system-prompts-tree-item-title">{entry.label}</span>
                  {entry.dirty && <span className="system-prompts-tree-item-dirty-dot" title="Ungespeichert" />}
                </span>
                <span className="system-prompts-tree-item-key">{entry.key}</span>
              </button>
            ))}
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
    <div className="system-prompts-page">
      <header className="system-prompts-header">
        <div>
          <p className="system-prompts-kicker">KI-Konfiguration</p>
          <h2 className="text-2xl font-semibold">Systemprompts</h2>
          <p className="system-prompts-subtitle">
            Baumansicht für alle produktiven Prompts inklusive Quelle, Änderungsstatus und fokussiertem Editor.
          </p>
        </div>
        <div className="system-prompts-metrics">
          <span className="system-prompts-metric-chip">
            <i className="fa-solid fa-terminal" /> {promptEntries.length} Prompts
          </span>
          <span className={`system-prompts-metric-chip ${dirtyPromptKeys.length > 0 ? 'is-dirty' : ''}`}>
            <i className="fa-solid fa-pen-to-square" /> {dirtyPromptKeys.length} ungespeichert
          </span>
          {refreshing && (
            <span className="system-prompts-metric-chip">
              <i className="fa-solid fa-rotate fa-spin" /> aktualisiere
            </span>
          )}
        </div>
      </header>

      {message && (
        <div
          className={`message-banner p-4 rounded-lg flex items-center gap-2 ${
            messageType === 'success'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
          role="status"
          aria-live="polite"
        >
          {messageType === 'success' ? (
            <i className="fa-solid fa-circle-check" />
          ) : (
            <i className="fa-solid fa-circle-exclamation" />
          )}
          {message}
        </div>
      )}

      <div className="system-prompts-layout">
        <aside className="system-prompts-nav card">
          <div className="system-prompts-nav-header">
            <h3 className="font-semibold">Prompt-Baum</h3>
            <div className="system-prompts-nav-controls">
              <button
                type="button"
                className="system-prompts-mini-btn"
                onClick={() => setAllTreeNodesExpanded(true)}
              >
                Alle auf
              </button>
              <button
                type="button"
                className="system-prompts-mini-btn"
                onClick={() => setAllTreeNodesExpanded(false)}
              >
                Alle zu
              </button>
            </div>
          </div>

          <div className="system-prompts-nav-search-wrap">
            <i className="fa-solid fa-magnifying-glass" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Suche nach Name, Key, Funktion..."
              className="system-prompts-nav-search"
            />
            {searchTerm && (
              <button
                type="button"
                className="system-prompts-nav-search-clear"
                onClick={() => setSearchTerm('')}
                aria-label="Suche löschen"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            )}
          </div>

          <p className="system-prompts-nav-summary">
            {filteredPromptEntries.length} Treffer
          </p>

          <div className="system-prompts-tree-wrap">
            {promptTree.length === 0 ? (
              <p className="system-prompts-tree-empty">Keine Prompts für den aktuellen Filter gefunden.</p>
            ) : (
              promptTree.map((node) => renderPromptTreeNode(node))
            )}
          </div>
        </aside>

        <section className="system-prompts-editor card">
          {selectedPromptEntry ? (
            <>
              <div className="system-prompts-editor-header">
                <div>
                  <h3 className="system-prompts-editor-title">
                    {selectedPromptEntry.label}
                    <SourceTag source={selectedPromptEntry.source} />
                    {selectedPromptIsDirty && <span className="system-prompts-editor-dirty-flag">ungespeichert</span>}
                  </h3>
                  <p className="system-prompts-editor-description">{selectedPromptEntry.description}</p>
                  <p className="system-prompts-editor-key">{selectedPromptEntry.key}</p>
                </div>
                <div className="system-prompts-editor-path">
                  {selectedPromptEntry.nodePath.map((segment) => (
                    <span key={`${selectedPromptEntry.key}-${segment}`} className="system-prompts-path-chip">
                      {segment}
                    </span>
                  ))}
                </div>
              </div>

              <textarea
                className="system-prompts-editor-textarea"
                value={selectedPromptValue}
                onChange={(event) => handleChange(selectedPromptEntry.key, event.target.value)}
              />

              <div className="system-prompts-editor-footer">
                <span>{selectedPromptStats.lines} Zeilen</span>
                <span>{selectedPromptStats.characters} Zeichen</span>
              </div>

              <div className="system-prompts-callout">
                <i className="fa-solid fa-circle-info" />
                <span>
                  Änderungen wirken unmittelbar auf KI-Antworten. Bei Klassifizierungs- und Bildprompts klar festlegen,
                  dass Bildbeschreibungen ausschließlich aus angehängten Bildern abgeleitet werden.
                </span>
              </div>
            </>
          ) : (
            <div className="system-prompts-empty-editor">
              <i className="fa-solid fa-diagram-project" />
              <p>Wähle links einen Prompt aus, um ihn zu bearbeiten.</p>
            </div>
          )}
        </section>
      </div>

      <div className="system-prompts-actions">
        <button onClick={handleSave} disabled={saving || dirtyPromptKeys.length === 0} className="btn btn-primary">
          {saving ? 'Speichern...' : 'Prompts speichern'}
        </button>
        <button
          type="button"
          onClick={handleResetSelected}
          disabled={!selectedPromptIsDirty}
          className="btn btn-secondary"
        >
          Auswahl zurücksetzen
        </button>
        <button
          type="button"
          onClick={() => void fetchPrompts({ resetMessage: true })}
          disabled={saving || refreshing}
          className="btn btn-secondary"
        >
          {refreshing ? 'Lade neu...' : 'Serverstand neu laden'}
        </button>
      </div>
    </div>
  );
};

export default SystemPrompts;
