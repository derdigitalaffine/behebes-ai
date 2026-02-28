import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { getAdminToken } from '../lib/auth';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';
import './AISituationReport.css';

type MessageType = 'success' | 'error' | '';
type PoolType = 'name' | 'email';
type SaveMode = 'replace' | 'append';
type SituationViewTab = 'reports' | 'pseudonyms';
type SituationReportType = 'operations' | 'category_workflow' | 'free_analysis';

interface SituationControlSettings {
  enabled: boolean;
  pseudonymizeNames: boolean;
  pseudonymizeEmails: boolean;
  mappingTtlDays: number;
  defaultDays: number;
  defaultMaxTickets: number;
  includeClosedByDefault: boolean;
  autoRunEnabled: boolean;
  autoRunIntervalMinutes: number;
  autoRunScopeKey: string;
  autoRunNotifyOnRisk: boolean;
  autoRunNotifyOnAbuse: boolean;
  autoRunNotifyOnMessenger: boolean;
  autoRunEmailEnabled: boolean;
  autoRunEmailRecipients: string[];
  autoRunEmailSubject: string;
  autoRunEmailLastSentAt?: string | null;
  autoRunEmailLastError?: string | null;
  atomFeedEnabled: boolean;
  lastAutoRunAt?: string | null;
  lastAutoRunError?: string | null;
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

interface PseudonymPoolRecord {
  id: string;
  poolType: PoolType;
  version: number;
  entries: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

interface PseudonymMappingStats {
  total: number;
  active: number;
  expired: number;
}

interface PseudonymPoolsResponse {
  pools: {
    name: PseudonymPoolRecord;
    email: PseudonymPoolRecord;
  };
  mappingStats: {
    name: PseudonymMappingStats;
    email: PseudonymMappingStats;
    distinctScopes: number;
  };
  mappingRows?: PseudonymMappingRow[];
  ticketReporterRows?: TicketReporterPseudonymRow[];
  control: SituationControlSettings;
  fillControl?: PseudonymFillControlSettings;
  fillProgress?: PseudonymFillProgress;
}

interface PseudonymMappingRow {
  id: string;
  scopeKey: string;
  entityType: PoolType;
  pseudoValue: string;
  createdAt?: string | null;
  expiresAt?: string | null;
  isActive: boolean;
}

interface TicketReporterPseudonymRow {
  ticketId: string;
  scopeKey: string;
  pseudoName: string;
  pseudoFirstName?: string;
  pseudoLastName?: string;
  pseudoEmail: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  ticketStatus?: string | null;
  ticketCreatedAt?: string | null;
  ticketUpdatedAt?: string | null;
}

interface PseudonymFillControlSettings {
  enabled: boolean;
  running: boolean;
  intervalSeconds: number;
  fillNamesEnabled: boolean;
  fillEmailsEnabled: boolean;
  chunkSizeNames: number;
  chunkSizeEmails: number;
  targetNamePoolSize: number;
  targetEmailPoolSize: number;
  useAiGenerator: boolean;
  lastRunSource: 'none' | 'ai' | 'mixed' | 'deterministic';
  lastRunRequestedNames: number;
  lastRunRequestedEmails: number;
  lastRunAddedNames: number;
  lastRunAddedEmails: number;
  lastRunAt?: string | null;
  lastError?: string | null;
}

interface PseudonymFillProgress {
  nameCount: number;
  emailCount: number;
  targetNamePoolSize: number;
  targetEmailPoolSize: number;
  nameMissing: number;
  emailMissing: number;
  done: boolean;
}

interface RecommendedLabel {
  ticketId: string;
  label: string;
  score?: number;
}

interface FrequentReporterPattern {
  reporter: string;
  totalReports: number;
  banalReports: number;
  banalRatio: number;
  missingLocationReports?: number;
  missingLocationRatio?: number;
  repeatedDescriptionReports?: number;
  repeatedDescriptionRatio?: number;
  dominantCategories?: string[];
  lastAt: string | null;
}

interface ReporterAbuseScore {
  reporter: string;
  reporterPseudoName?: string | null;
  reporterPseudoEmail?: string | null;
  reporterResolvedName?: string | null;
  reporterResolvedEmail?: string | null;
  reporterResolved?: string | null;
  totalReports: number;
  banalReports: number;
  banalRatio: number;
  missingLocationReports?: number;
  missingLocationRatio?: number;
  repeatedDescriptionReports?: number;
  repeatedDescriptionRatio?: number;
  aiSuspicionScore?: number;
  aiSuspicionReason?: string | null;
  aiSignals?: string[];
  abuseScore: number;
  abuseLevel: 'niedrig' | 'mittel' | 'hoch' | 'kritisch' | string;
  dominantCategories?: string[];
  lastAt?: string | null;
  reasons?: string[];
}

interface SituationAiParsed {
  summary?: string;
  categoryWorkflowSummary?: string;
  hotspots?: string[];
  patterns?: string[];
  riskSignals?: string[];
  immediateActions?: string[];
  operationalRecommendations?: string[];
  resourceHints?: string[];
  coordinationHints?: string[];
  abuseTrends?: string[];
  lifecycleRisks?: string[];
  reporterRisks?: string[];
  categoryFindings?: Array<{
    category?: string;
    ticketCount?: number;
    openCount?: number;
    closedCount?: number;
    avgAgeHours?: number;
    avgClosedCycleHours?: number;
    workflowCoverage?: number;
    suggestedWorkflowTemplate?: string;
    confidence?: number;
    bottlenecks?: string[];
    actions?: string[];
  }>;
  workflowRecommendations?: Array<{
    workflowTemplate?: string;
    confidence?: number;
    fit?: string;
    reason?: string;
    optimizations?: string[];
    risks?: string[];
  }>;
  categoryWorkflowMappingSuggestions?: Array<{
    category?: string;
    recommendedWorkflowTemplate?: string;
    confidence?: number;
    reason?: string;
    expectedImpact?: string;
  }>;
  optimizationBacklog?: Array<{
    title?: string;
    impact?: string;
    effort?: string;
    owner?: string;
    reason?: string;
  }>;
  frequentReporterPatterns?: Array<{ reporter?: string; score?: number; reason?: string }>;
  reporterAbuseScores?: Array<{
    reporter?: string;
    score?: number;
    riskLevel?: string;
    reason?: string;
    signals?: string[];
  }>;
  recommendedLabels?: RecommendedLabel[];
  [key: string]: any;
}

interface SituationReportResult {
  reportId?: string;
  reportType?: SituationReportType | string;
  reportTypeLabel?: string;
  analysisQuestion?: string | null;
  generatedAt: string;
  scopeKey: string;
  days: number;
  ticketCount: number;
  controlApplied?: Partial<SituationControlSettings>;
  frequentReporterPatterns: FrequentReporterPattern[];
  frequentReporterPatternsResolved?: Array<
    FrequentReporterPattern & {
      reporterResolved?: string;
      reporterResolvedName?: string | null;
      reporterResolvedEmail?: string | null;
    }
  >;
  operationalMetrics?: {
    ticketCount?: number;
    missingLocationTickets?: number;
    missingLocationRatio?: number;
    priorities?: Array<{ priority: string; count: number }>;
    statuses?: Array<{ status: string; count: number }>;
    topCategories?: Array<{ category: string; count: number }>;
    frequentReporterSampleSize?: number;
  };
  ticketLifecycleSummary?: {
    ticketCount?: number;
    avgTicketAgeHours?: number;
    avgClosedCycleHours?: number;
    closedTicketCount?: number;
    workflowAttachedCount?: number;
  };
  categoryLifecycleMetrics?: Array<{
    category?: string;
    ticketCount?: number;
    openCount?: number;
    closedCount?: number;
    workflowCoverage?: number;
    avgAgeHours?: number;
    avgClosedCycleHours?: number;
    topWorkflowTemplates?: Array<{ workflowTemplate?: string; count?: number }>;
  }>;
  workflowTemplateMetrics?: Array<{
    workflowTemplate?: string;
    ticketCount?: number;
    completedCount?: number;
    failedCount?: number;
    runningCount?: number;
    pausedCount?: number;
    avgDurationHours?: number;
    avgTasks?: number;
    completionRate?: number;
    failureRate?: number;
  }>;
  reporterAbuseSummary?: {
    totalReporters: number;
    highOrCritical: number;
    medium: number;
    low: number;
    maxScore: number;
  };
  reporterAbuseScores?: ReporterAbuseScore[];
  ai: {
    raw: string | Record<string, string>;
    parsed: SituationAiParsed | null;
    dePseudonymizedRaw?: Record<string, string>;
    dePseudonymizedParsed?: SituationAiParsed | null;
    diagnostics?: {
      stageTimeoutMs?: number;
      stageErrors?: Array<{ stage?: string; error?: string }>;
      promptContext?: {
        totalTickets?: number;
        includedTickets?: number;
        truncated?: boolean;
        descriptionIncluded?: boolean;
      };
    };
  };
  recommendedLabels: RecommendedLabel[];
}

interface SituationReportHistoryItem {
  id: string;
  reportType?: SituationReportType | string;
  reportTypeLabel?: string;
  scopeKey?: string | null;
  days: number;
  maxTickets: number;
  includeClosed: boolean;
  pseudonymizeNames: boolean;
  pseudonymizeEmails: boolean;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdByAdminId?: string | null;
  createdByUsername?: string | null;
}

interface GeneratedPoolPreview {
  names: string[];
  emails: string[];
  domains: string[];
}

const DEFAULT_CONTROL: SituationControlSettings = {
  enabled: true,
  pseudonymizeNames: true,
  pseudonymizeEmails: true,
  mappingTtlDays: 90,
  defaultDays: 30,
  defaultMaxTickets: 600,
  includeClosedByDefault: true,
  autoRunEnabled: false,
  autoRunIntervalMinutes: 30,
  autoRunScopeKey: 'situation-report-stable',
  autoRunNotifyOnRisk: true,
  autoRunNotifyOnAbuse: true,
  autoRunNotifyOnMessenger: true,
  autoRunEmailEnabled: false,
  autoRunEmailRecipients: [],
  autoRunEmailSubject: 'Automatisches KI-Lagebild',
  autoRunEmailLastSentAt: null,
  autoRunEmailLastError: null,
  atomFeedEnabled: false,
  lastAutoRunAt: null,
  lastAutoRunError: null,
};

const DEFAULT_FILL_CONTROL: PseudonymFillControlSettings = {
  enabled: true,
  running: false,
  intervalSeconds: 20,
  fillNamesEnabled: true,
  fillEmailsEnabled: true,
  chunkSizeNames: 40,
  chunkSizeEmails: 40,
  targetNamePoolSize: 1500,
  targetEmailPoolSize: 1500,
  useAiGenerator: false,
  lastRunSource: 'none',
  lastRunRequestedNames: 0,
  lastRunRequestedEmails: 0,
  lastRunAddedNames: 0,
  lastRunAddedEmails: 0,
  lastRunAt: null,
  lastError: null,
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '–';
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

const formatPercent = (value: unknown): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '–';
  return `${Math.round(Math.max(0, Math.min(1, numeric)) * 100)}%`;
};

const formatHours = (value: unknown): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '–';
  return `${numeric.toFixed(1)} h`;
};

const REPORT_TYPE_LABELS: Record<SituationReportType, string> = {
  operations: 'Operatives Lagebild',
  category_workflow: 'Kategorien & Workflow-Beratung',
  free_analysis: 'Freie Analyse',
};

const extractEmailFromIdentity = (value: unknown): string => {
  const source = String(value || '').trim();
  if (!source) return '';
  const bracketMatch = source.match(/<([^<>@\s]+@[^\s<>]+\.[^\s<>]+)>/);
  if (bracketMatch?.[1]) return bracketMatch[1].trim();
  const plainMatch = source.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  return plainMatch?.[1]?.trim() || '';
};

const extractNameFromIdentity = (value: unknown): string => {
  const source = String(value || '').trim();
  if (!source) return '';
  const bracketIdx = source.indexOf('<');
  if (bracketIdx > 0) return source.slice(0, bracketIdx).trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(source)) return '';
  return source;
};

const linesFromText = (value: string): string[] =>
  String(value || '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeEmailList = (value: string): string[] =>
  String(value || '')
    .split(/[\r\n,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => !!entry && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry))
    .slice(0, 40);

interface AISituationReportProps {
  initialTab?: SituationViewTab;
}

const AISituationReport: React.FC<AISituationReportProps> = ({ initialTab = 'reports' }) => {
  const token = getAdminToken();
  const location = useLocation();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token || ''}` }), [token]);
  const [viewTab, setViewTab] = useState<SituationViewTab>(initialTab === 'pseudonyms' ? 'pseudonyms' : 'reports');

  const [control, setControl] = useState<SituationControlSettings>(DEFAULT_CONTROL);
  const [controlLoading, setControlLoading] = useState(true);
  const [controlSaving, setControlSaving] = useState(false);
  const [atomFeedTokenRotating, setAtomFeedTokenRotating] = useState(false);
  const [atomFeedTokenRevoking, setAtomFeedTokenRevoking] = useState(false);
  const [aiFeedTokenLoading, setAiFeedTokenLoading] = useState(false);
  const [aiFeedPath, setAiFeedPath] = useState('/api/admin/ai/situation-report/feed/atom');
  const [aiFeedToken, setAiFeedToken] = useState<SelfFeedTokenRecord | null>(null);
  const [autoRunEmailRecipientsInput, setAutoRunEmailRecipientsInput] = useState('');

  const [poolsLoading, setPoolsLoading] = useState(true);
  const [poolsSaving, setPoolsSaving] = useState<Record<PoolType, boolean>>({ name: false, email: false });
  const [poolSaveMode, setPoolSaveMode] = useState<SaveMode>('replace');
  const [poolInputs, setPoolInputs] = useState<Record<PoolType, string>>({ name: '', email: '' });
  const [poolMeta, setPoolMeta] = useState<Record<PoolType, PseudonymPoolRecord>>({
    name: { id: '', poolType: 'name', version: 0, entries: [], createdAt: null, updatedAt: null },
    email: { id: '', poolType: 'email', version: 0, entries: [], createdAt: null, updatedAt: null },
  });
  const [mappingStats, setMappingStats] = useState<PseudonymPoolsResponse['mappingStats']>({
    name: { total: 0, active: 0, expired: 0 },
    email: { total: 0, active: 0, expired: 0 },
    distinctScopes: 0,
  });
  const [mappingRows, setMappingRows] = useState<PseudonymMappingRow[]>([]);
  const [ticketReporterRows, setTicketReporterRows] = useState<TicketReporterPseudonymRow[]>([]);
  const [fillControl, setFillControl] = useState<PseudonymFillControlSettings>(DEFAULT_FILL_CONTROL);
  const [fillProgress, setFillProgress] = useState<PseudonymFillProgress>({
    nameCount: 0,
    emailCount: 0,
    targetNamePoolSize: DEFAULT_FILL_CONTROL.targetNamePoolSize,
    targetEmailPoolSize: DEFAULT_FILL_CONTROL.targetEmailPoolSize,
    nameMissing: DEFAULT_FILL_CONTROL.targetNamePoolSize,
    emailMissing: DEFAULT_FILL_CONTROL.targetEmailPoolSize,
    done: false,
  });
  const [fillControlSaving, setFillControlSaving] = useState(false);
  const [fillRunLoading, setFillRunLoading] = useState(false);

  const [generateLoading, setGenerateLoading] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState<GeneratedPoolPreview | null>(null);
  const [generateConfig, setGenerateConfig] = useState({
    nameCount: 200,
    emailCount: 200,
    domainCount: 20,
  });

  const [reportFilters, setReportFilters] = useState({
    reportType: 'operations' as SituationReportType,
    days: 30,
    maxTickets: 600,
    includeClosed: true,
    scopeKey: '',
    analysisQuestion: '',
  });
  const [reportRunning, setReportRunning] = useState(false);
  const [reportResult, setReportResult] = useState<SituationReportResult | null>(null);
  const [reportHistoryLoading, setReportHistoryLoading] = useState(false);
  const [reportHistory, setReportHistory] = useState<SituationReportHistoryItem[]>([]);
  const [reportHistoryTotal, setReportHistoryTotal] = useState(0);
  const reportAbortRef = useRef<AbortController | null>(null);
  const [labelSelection, setLabelSelection] = useState<Record<string, boolean>>({});
  const [applyLabelsLoading, setApplyLabelsLoading] = useState(false);

  const [resetScopeKey, setResetScopeKey] = useState('');
  const [resetEntityType, setResetEntityType] = useState<'all' | PoolType>('all');
  const [resetExpiredOnly, setResetExpiredOnly] = useState(true);
  const [resetLoading, setResetLoading] = useState(false);

  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<MessageType>('');

  useEffect(() => {
    setViewTab(initialTab === 'pseudonyms' ? 'pseudonyms' : 'reports');
  }, [initialTab]);

  const showMessage = (text: string, type: MessageType) => {
    setMessage(text);
    setMessageType(type);
  };

  const normalizeReportType = (value: unknown): SituationReportType => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (normalized === 'free_analysis' || normalized === 'free-analysis' || normalized === 'free' || normalized === 'custom') {
      return 'free_analysis';
    }
    if (normalized === 'category_workflow' || normalized === 'category-workflow' || normalized === 'workflow_advisory') {
      return 'category_workflow';
    }
    return 'operations';
  };

  const resolveReportTypeLabel = (value: unknown): string => {
    const normalized = normalizeReportType(value);
    return REPORT_TYPE_LABELS[normalized] || REPORT_TYPE_LABELS.operations;
  };

  const downloadJsonFile = (payload: unknown, fileName: string) => {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const atomFeedUrl = useMemo(() => {
    const tokenValue = String(aiFeedToken?.token || '').trim();
    if (!tokenValue) return '';
    const feedPath = String(aiFeedPath || '/api/admin/ai/situation-report/feed/atom').trim() || '/api/admin/ai/situation-report/feed/atom';
    if (typeof window === 'undefined') {
      return `${feedPath}?token=${encodeURIComponent(tokenValue)}`;
    }
    return `${window.location.origin}${feedPath}?token=${encodeURIComponent(tokenValue)}`;
  }, [aiFeedPath, aiFeedToken?.token]);

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

  const loadControl = async () => {
    if (!token) return;
    setControlLoading(true);
    try {
      const response = await axios.get('/api/admin/ai/situation-report/control', { headers });
      const nextControl = response.data as SituationControlSettings;
      setControl(nextControl);
      setAutoRunEmailRecipientsInput((nextControl.autoRunEmailRecipients || []).join('\n'));
      setReportFilters((current) => ({
        ...current,
        days: nextControl.defaultDays,
        maxTickets: nextControl.defaultMaxTickets,
        includeClosed: nextControl.includeClosedByDefault,
      }));
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Steuerung konnte nicht geladen werden.', 'error');
    } finally {
      setControlLoading(false);
    }
  };

  const loadAiFeedToken = async () => {
    if (!token) return;
    setAiFeedTokenLoading(true);
    try {
      const response = await axios.get('/api/admin/feed-tokens/self/ai_situation', { headers });
      const payload = response.data as SelfFeedTokenResponse;
      setAiFeedPath(
        typeof payload?.feedPath === 'string' && payload.feedPath.trim()
          ? payload.feedPath.trim()
          : '/api/admin/ai/situation-report/feed/atom'
      );
      setAiFeedToken(payload?.token || null);
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Feed-Token konnte nicht geladen werden.', 'error');
      setAiFeedToken(null);
    } finally {
      setAiFeedTokenLoading(false);
    }
  };

  const loadPools = async () => {
    if (!token) return;
    setPoolsLoading(true);
    try {
      const response = await axios.get('/api/admin/ai/pseudonym-pools', { headers });
      const payload = response.data as PseudonymPoolsResponse;
      if (payload.control) {
        setControl(payload.control);
        setAutoRunEmailRecipientsInput((payload.control.autoRunEmailRecipients || []).join('\n'));
      }
      setPoolMeta(payload.pools);
      setPoolInputs({
        name: (payload.pools.name.entries || []).join('\n'),
        email: (payload.pools.email.entries || []).join('\n'),
      });
      setMappingStats(payload.mappingStats);
      setMappingRows(Array.isArray(payload.mappingRows) ? payload.mappingRows : []);
      setTicketReporterRows(Array.isArray(payload.ticketReporterRows) ? payload.ticketReporterRows : []);
      if (payload.fillControl) {
        setFillControl(payload.fillControl);
      }
      if (payload.fillProgress) {
        setFillProgress(payload.fillProgress);
      }
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Pseudonym-Pools konnten nicht geladen werden.', 'error');
    } finally {
      setPoolsLoading(false);
    }
  };

  const loadReportHistory = async () => {
    if (!token) return;
    setReportHistoryLoading(true);
    try {
      const response = await axios.get('/api/admin/ai/situation-report/history', {
        headers,
        params: { limit: 40, offset: 0 },
      });
      setReportHistory(Array.isArray(response.data?.items) ? response.data.items : []);
      setReportHistoryTotal(Number(response.data?.total || 0));
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Lagebild-Historie konnte nicht geladen werden.', 'error');
    } finally {
      setReportHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      showMessage('Kein Admin-Token gefunden. Bitte neu anmelden.', 'error');
      setControlLoading(false);
      setPoolsLoading(false);
      return;
    }
    void Promise.all([loadControl(), loadPools(), loadReportHistory(), loadAiFeedToken()]);
    return () => {
      if (reportAbortRef.current) {
        reportAbortRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const saveControl = async (override?: Partial<SituationControlSettings>) => {
    if (!token) return;
    setControlSaving(true);
    try {
      const normalizedRecipients = normalizeEmailList(autoRunEmailRecipientsInput);
      const payload = {
        ...control,
        ...(override || {}),
        autoRunEmailRecipients: normalizedRecipients,
      };
      const response = await axios.patch('/api/admin/ai/situation-report/control', payload, { headers });
      const nextControl = (response.data?.control || payload) as SituationControlSettings;
      setControl(nextControl);
      setAutoRunEmailRecipientsInput((nextControl.autoRunEmailRecipients || []).join('\n'));
      showMessage('Steuerung gespeichert.', 'success');
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Steuerung konnte nicht gespeichert werden.', 'error');
    } finally {
      setControlSaving(false);
    }
  };

  const rotateAtomFeedToken = async () => {
    if (!token) return;
    setAtomFeedTokenRotating(true);
    try {
      const response = await axios.post('/api/admin/feed-tokens/self/ai_situation/rotate', {}, { headers });
      const payload = response.data as SelfFeedTokenResponse & { token?: SelfFeedTokenRecord | null };
      setAiFeedPath(
        typeof payload?.feedPath === 'string' && payload.feedPath.trim()
          ? payload.feedPath.trim()
          : '/api/admin/ai/situation-report/feed/atom'
      );
      setAiFeedToken(payload?.token || null);
      showMessage('Atom-Feed-Token wurde neu erzeugt.', 'success');
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Feed-Token konnte nicht erneuert werden.', 'error');
    } finally {
      setAtomFeedTokenRotating(false);
    }
  };

  const revokeAtomFeedToken = async () => {
    if (!token) return;
    setAtomFeedTokenRevoking(true);
    try {
      await axios.delete('/api/admin/feed-tokens/self/ai_situation', { headers });
      setAiFeedToken(null);
      showMessage('Atom-Feed-Token widerrufen.', 'success');
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Feed-Token konnte nicht widerrufen werden.', 'error');
    } finally {
      setAtomFeedTokenRevoking(false);
    }
  };

  const copyAtomFeedUrl = async () => {
    if (!atomFeedUrl) {
      showMessage('Noch keine Feed-URL vorhanden. Bitte zuerst Token erzeugen.', 'error');
      return;
    }
    const copied = await copyToClipboard(atomFeedUrl);
    if (copied) {
      showMessage('Atom-Feed-URL in Zwischenablage kopiert.', 'success');
    } else {
      showMessage('Atom-Feed-URL konnte nicht kopiert werden.', 'error');
    }
  };

  const savePool = async (poolType: PoolType) => {
    if (!token) return;
    setPoolsSaving((prev) => ({ ...prev, [poolType]: true }));
    try {
      await axios.patch(
        `/api/admin/ai/pseudonym-pools/${poolType}`,
        {
          mode: poolSaveMode,
          entries: linesFromText(poolInputs[poolType]),
        },
        { headers }
      );
      await loadPools();
      showMessage(
        `Pseudonym-Pool ${poolType === 'name' ? 'Namen' : 'E-Mails'} gespeichert (${poolSaveMode}).`,
        'success'
      );
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Pool konnte nicht gespeichert werden.', 'error');
    } finally {
      setPoolsSaving((prev) => ({ ...prev, [poolType]: false }));
    }
  };

  const generatePools = async () => {
    if (!token) return;
    setGenerateLoading(true);
    try {
      const response = await axios.post(
        '/api/admin/ai/pseudonym-pools/generate',
        {
          nameCount: generateConfig.nameCount,
          emailCount: generateConfig.emailCount,
          domainCount: generateConfig.domainCount,
          save: false,
        },
        { headers }
      );
      const generated = response.data?.generated as GeneratedPoolPreview;
      setGeneratedPreview(generated);
      showMessage('Pseudonym-Vorschlag per KI erstellt.', 'success');
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Pseudonym-Generator fehlgeschlagen.', 'error');
    } finally {
      setGenerateLoading(false);
    }
  };

  const applyGeneratedPreview = () => {
    if (!generatedPreview) return;
    setPoolInputs({
      name: (generatedPreview.names || []).join('\n'),
      email: (generatedPreview.emails || []).join('\n'),
    });
    showMessage('Generierte Pools in den Editor übernommen. Jetzt speichern.', 'success');
  };

  const saveFillControl = async (override?: Partial<PseudonymFillControlSettings>) => {
    if (!token) return;
    setFillControlSaving(true);
    try {
      const payload = {
        ...fillControl,
        ...(override || {}),
      };
      const response = await axios.patch('/api/admin/ai/pseudonym-fill/control', payload, { headers });
      if (response.data?.control) {
        setFillControl(response.data.control);
      }
      if (response.data?.progress) {
        setFillProgress(response.data.progress);
      }
      showMessage(response.data?.message || 'Füllsteuerung gespeichert.', 'success');
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Füllsteuerung konnte nicht gespeichert werden.', 'error');
    } finally {
      setFillControlSaving(false);
    }
  };

  const runFillChunk = async () => {
    if (!token) return;
    setFillRunLoading(true);
    try {
      const response = await axios.post('/api/admin/ai/pseudonym-fill/run-chunk', {}, { headers });
      const runControl = response.data?.control as PseudonymFillControlSettings | undefined;
      if (runControl) setFillControl(runControl);
      if (response.data?.progress) setFillProgress(response.data.progress);
      await loadPools();
      const addedNames = Number(runControl?.lastRunAddedNames || 0);
      const addedEmails = Number(runControl?.lastRunAddedEmails || 0);
      if (addedNames + addedEmails > 0) {
        showMessage(
          `Fülllauf ausgeführt: +${addedNames} Namen, +${addedEmails} E-Mails übernommen.`,
          'success'
        );
      } else {
        showMessage(
          `Fülllauf ausgeführt, aber keine neuen Einträge übernommen (Quelle: ${runControl?.lastRunSource || 'n/a'}).`,
          'error'
        );
      }
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Fülllauf konnte nicht ausgeführt werden.', 'error');
    } finally {
      setFillRunLoading(false);
    }
  };

  const loadStoredReport = async (reportId: string) => {
    if (!token || !reportId) return;
    try {
      const response = await axios.get(`/api/admin/ai/situation-report/report/${reportId}`, { headers });
      const result = response.data?.result as SituationReportResult | undefined;
      const reportType = normalizeReportType(response.data?.reportType || result?.reportType);
      if (result) {
        setReportResult({
          ...result,
          reportId,
          reportType,
          reportTypeLabel: resolveReportTypeLabel(response.data?.reportTypeLabel || reportType),
        });
        showMessage('Gespeichertes Lagebild geladen.', 'success');
      }
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Gespeichertes Lagebild konnte nicht geladen werden.', 'error');
    }
  };

  useEffect(() => {
    const query = new URLSearchParams(location.search || '');
    const requestedReportId = String(query.get('reportId') || '').trim();
    if (!requestedReportId || !token) return;
    setViewTab('reports');
    void loadStoredReport(requestedReportId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, token]);

  const deleteStoredReport = async (reportId: string) => {
    if (!token || !reportId) return;
    const confirmed = window.confirm('Analyse und Analysedaten wirklich löschen?');
    if (!confirmed) return;
    try {
      await axios.delete(`/api/admin/ai/situation-report/report/${reportId}`, { headers });
      if (reportResult?.reportId === reportId) {
        setReportResult(null);
        setLabelSelection({});
      }
      await loadReportHistory();
      showMessage('Analyse gelöscht.', 'success');
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Analyse konnte nicht gelöscht werden.', 'error');
    }
  };

  const downloadStoredReport = async (reportId: string) => {
    if (!token || !reportId) return;
    try {
      const response = await axios.get(`/api/admin/ai/situation-report/report/${reportId}`, { headers });
      const payload = {
        id: response.data?.id || reportId,
        reportType: response.data?.reportType || 'operations',
        reportTypeLabel: response.data?.reportTypeLabel || resolveReportTypeLabel(response.data?.reportType),
        analysisQuestion: response.data?.result?.analysisQuestion || null,
        createdAt: response.data?.createdAt || null,
        result: response.data?.result || null,
        rawData: response.data?.rawData || null,
      };
      downloadJsonFile(payload, `lagebericht-${reportId}.json`);
      showMessage('Lagebild-Export heruntergeladen.', 'success');
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Lagebild konnte nicht heruntergeladen werden.', 'error');
    }
  };

  const stopReportRun = () => {
    if (!reportAbortRef.current) return;
    reportAbortRef.current.abort();
    reportAbortRef.current = null;
  };

  const runSituationReport = async () => {
    if (!token) return;
    if (!control.enabled) {
      showMessage('Lagebild ist gestoppt. Bitte zuerst "Analyse starten" aktivieren.', 'error');
      return;
    }
    if (reportRunning) return;

    const controller = new AbortController();
    reportAbortRef.current = controller;
    setReportRunning(true);
    try {
      const response = await axios.post(
        '/api/admin/ai/situation-report',
        {
          reportType: reportFilters.reportType,
          days: reportFilters.days,
          maxTickets: reportFilters.maxTickets,
          includeClosed: reportFilters.includeClosed,
          scopeKey: reportFilters.scopeKey.trim() || undefined,
          analysisQuestion:
            reportFilters.reportType === 'free_analysis'
              ? reportFilters.analysisQuestion.trim() || undefined
              : undefined,
          pseudonymizeNames: control.pseudonymizeNames,
          pseudonymizeEmails: control.pseudonymizeEmails,
        },
        {
          headers,
          signal: controller.signal,
        }
      );
      const result = response.data as SituationReportResult;
      const normalizedType = normalizeReportType(result?.reportType || reportFilters.reportType);
      setReportResult({
        ...result,
        reportType: normalizedType,
        reportTypeLabel: resolveReportTypeLabel(result?.reportTypeLabel || normalizedType),
      });
      const nextSelection: Record<string, boolean> = {};
      (result.recommendedLabels || []).forEach((entry, index) => {
        nextSelection[`${entry.ticketId}__${entry.label}__${index}`] = true;
      });
      setLabelSelection(nextSelection);
      await loadReportHistory();
      showMessage(
        normalizedType === 'category_workflow'
          ? 'Kategorien-/Workflow-Beratung erfolgreich erstellt.'
          : normalizedType === 'free_analysis'
          ? 'Freie Analyse erfolgreich erstellt.'
          : 'KI-Lagebild erfolgreich erstellt.',
        'success'
      );
    } catch (error: any) {
      if (error?.code === 'ERR_CANCELED') {
        showMessage('Analyse wurde gestoppt.', 'success');
      } else {
        const backendMessage = String(error?.response?.data?.message || '').trim();
        const backendError = String(error?.response?.data?.error || '').trim();
        const composed = backendError
          ? `${backendMessage || 'Lagebild konnte nicht erstellt werden.'} (${backendError})`
          : backendMessage || 'Lagebild konnte nicht erstellt werden.';
        showMessage(composed, 'error');
      }
    } finally {
      reportAbortRef.current = null;
      setReportRunning(false);
    }
  };

  const selectedLabels = useMemo(() => {
    if (!reportResult) return [];
    return reportResult.recommendedLabels.filter((entry, index) => {
      const key = `${entry.ticketId}__${entry.label}__${index}`;
      return labelSelection[key] === true;
    });
  }, [labelSelection, reportResult]);

  const reporterRatioBars = useMemo(() => {
    if (!reportResult) return [];
    return (reportResult.frequentReporterPatterns || [])
      .slice(0, 8)
      .map((entry, index) => ({
        label:
          reportResult.frequentReporterPatternsResolved?.[index]?.reporterResolvedName ||
          reportResult.frequentReporterPatternsResolved?.[index]?.reporterResolved ||
          entry.reporter,
        total: entry.totalReports,
        ratio: Math.max(0, Math.min(1, Number(entry.banalRatio || 0))),
      }));
  }, [reportResult]);

  const reportParsed = useMemo(() => {
    if (!reportResult) return null;
    return reportResult.ai?.dePseudonymizedParsed || reportResult.ai?.parsed || null;
  }, [reportResult]);

  const reportRaw = useMemo(() => {
    if (!reportResult) return null;
    return reportResult.ai?.dePseudonymizedRaw || reportResult.ai?.raw || null;
  }, [reportResult]);

  const reportStageErrors = useMemo(() => {
    const raw = reportResult?.ai?.diagnostics?.stageErrors;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry: any) => ({
        stage: String(entry?.stage || '').trim(),
        error: String(entry?.error || '').trim(),
      }))
      .filter((entry: { stage: string; error: string }) => entry.stage || entry.error);
  }, [reportResult]);

  const currentReportType = useMemo<SituationReportType>(() => {
    return normalizeReportType(reportResult?.reportType || reportFilters.reportType);
  }, [reportResult?.reportType, reportFilters.reportType]);

  const currentReportTypeLabel = useMemo(() => {
    return reportResult?.reportTypeLabel || resolveReportTypeLabel(reportResult?.reportType || reportFilters.reportType);
  }, [reportResult?.reportTypeLabel, reportResult?.reportType, reportFilters.reportType]);

  const categoryFindings = useMemo(() => {
    if (!Array.isArray(reportParsed?.categoryFindings)) return [];
    return reportParsed.categoryFindings;
  }, [reportParsed]);

  const workflowRecommendations = useMemo(() => {
    if (!Array.isArray(reportParsed?.workflowRecommendations)) return [];
    return reportParsed.workflowRecommendations;
  }, [reportParsed]);

  const mappingSuggestions = useMemo(() => {
    if (!Array.isArray(reportParsed?.categoryWorkflowMappingSuggestions)) return [];
    return reportParsed.categoryWorkflowMappingSuggestions;
  }, [reportParsed]);

  const optimizationBacklog = useMemo(() => {
    if (!Array.isArray(reportParsed?.optimizationBacklog)) return [];
    return reportParsed.optimizationBacklog;
  }, [reportParsed]);

  const downloadCurrentReport = () => {
    if (!reportResult) return;
    const reportId = String(reportResult.reportId || '').trim() || `manual-${Date.now()}`;
    const reportType = normalizeReportType(reportResult.reportType);
    const payload = {
      reportId,
      reportType,
      reportTypeLabel: reportResult.reportTypeLabel || resolveReportTypeLabel(reportType),
      generatedAt: reportResult.generatedAt,
      scopeKey: reportResult.scopeKey,
      result: reportResult,
    };
    downloadJsonFile(payload, `lagebericht-${reportId}.json`);
    showMessage('Lagebild-Export heruntergeladen.', 'success');
  };

  const reporterAbuseRows = useMemo(() => {
    if (!reportResult || !Array.isArray(reportResult.reporterAbuseScores)) return [];
    return [...reportResult.reporterAbuseScores].sort((a, b) => {
      const scoreDiff = Number(b?.abuseScore || 0) - Number(a?.abuseScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(b?.totalReports || 0) - Number(a?.totalReports || 0);
    });
  }, [reportResult]);

  const reporterIdentityByKey = useMemo(() => {
    const map = new Map<string, { name: string; email: string; display: string }>();
    for (const entry of reporterAbuseRows) {
      const key = String(entry.reporter || '').trim();
      if (!key) continue;
      const display = String(entry.reporterResolved || '').trim();
      const name = String(entry.reporterResolvedName || '').trim() || extractNameFromIdentity(display);
      const email = String(entry.reporterResolvedEmail || '').trim() || extractEmailFromIdentity(display);
      map.set(key, { name, email, display });
    }
    return map;
  }, [reporterAbuseRows]);

  const fillProgressRatios = useMemo(() => {
    const nameTarget = Math.max(1, Number(fillProgress.targetNamePoolSize || 1));
    const emailTarget = Math.max(1, Number(fillProgress.targetEmailPoolSize || 1));
    return {
      names: Math.max(0, Math.min(1, Number(fillProgress.nameCount || 0) / nameTarget)),
      emails: Math.max(0, Math.min(1, Number(fillProgress.emailCount || 0) / emailTarget)),
    };
  }, [fillProgress]);

  const dbPoolPreview = useMemo(() => {
    return {
      names: (poolMeta.name.entries || []).slice(0, 40),
      emails: (poolMeta.email.entries || []).slice(0, 40),
    };
  }, [poolMeta]);

  const nextFillChunkPlan = useMemo(() => {
    const namesOpen = Math.max(0, Number(fillProgress.nameMissing || 0));
    const emailsOpen = Math.max(0, Number(fillProgress.emailMissing || 0));
    return {
      names:
        fillControl.enabled && fillControl.fillNamesEnabled ? Math.min(Number(fillControl.chunkSizeNames || 0), namesOpen) : 0,
      emails:
        fillControl.enabled && fillControl.fillEmailsEnabled
          ? Math.min(Number(fillControl.chunkSizeEmails || 0), emailsOpen)
          : 0,
    };
  }, [fillControl, fillProgress]);

  const fillRunSourceLabel = useMemo(() => {
    switch (fillControl.lastRunSource) {
      case 'ai':
        return 'nur KI';
      case 'mixed':
        return 'KI + Fallback';
      case 'deterministic':
        return 'deterministisch';
      default:
        return 'keine Daten';
    }
  }, [fillControl.lastRunSource]);

  const fillWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (!fillControl.fillNamesEnabled && !fillControl.fillEmailsEnabled) {
      warnings.push('Namen und E-Mails sind beide deaktiviert. Es werden keine neuen Pseudonyme erzeugt.');
    }
    if (!fillControl.enabled && fillControl.running) {
      warnings.push('Automatik ist aktiv markiert, aber die Fülllogik ist global deaktiviert.');
    }
    if (fillControl.intervalSeconds < 10 && fillControl.running) {
      warnings.push('Sehr kurzes Intervall kann unnötige Last verursachen.');
    }
    return warnings;
  }, [fillControl]);

  const applySelectedLabels = async () => {
    if (!token || !reportResult) return;
    if (selectedLabels.length === 0) {
      showMessage('Keine Label-Empfehlungen ausgewählt.', 'error');
      return;
    }
    setApplyLabelsLoading(true);
    try {
      const response = await axios.post(
        '/api/admin/ai/situation-report/label-apply',
        {
          source: 'ai_situation_report_ui',
          labels: selectedLabels,
        },
        { headers }
      );
      const inserted = Number(response.data?.inserted || 0);
      showMessage(`${inserted} Label(s) wurden gespeichert.`, 'success');
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Labels konnten nicht gespeichert werden.', 'error');
    } finally {
      setApplyLabelsLoading(false);
    }
  };

  const resetMappings = async () => {
    if (!token) return;
    const confirmation = window.confirm(
      'Pseudonym-Mappings wirklich löschen? Das beeinflusst bestehende Scope-Zuordnungen.'
    );
    if (!confirmation) return;
    setResetLoading(true);
    try {
      await axios.post(
        '/api/admin/ai/pseudonym-mappings/reset',
        {
          scopeKey: resetScopeKey.trim() || undefined,
          entityType: resetEntityType === 'all' ? undefined : resetEntityType,
          expiredOnly: resetExpiredOnly,
        },
        { headers }
      );
      await loadPools();
      showMessage('Mappings wurden aktualisiert.', 'success');
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Mappings konnten nicht gelöscht werden.', 'error');
    } finally {
      setResetLoading(false);
    }
  };

  const situationKpis = useMemo(
    () => [
      {
        id: 'lagebild',
        label: 'Lagebild',
        value: control.enabled ? 'Aktiv' : 'Gestoppt',
        hint: viewTab === 'reports' ? 'Analysepipeline' : 'Pseudonymisierung',
        tone: control.enabled ? ('success' as const) : ('warning' as const),
      },
      {
        id: 'autorun',
        label: 'Auto-Analyse',
        value: control.autoRunEnabled ? `Alle ${control.autoRunIntervalMinutes} Min` : 'Aus',
        hint: control.autoRunEnabled ? 'Intervallbetrieb aktiv' : 'Manueller Start',
        tone: control.autoRunEnabled ? ('info' as const) : ('default' as const),
      },
      {
        id: 'fill',
        label: 'Füllläufe',
        value: fillControl.running ? 'Laufend' : 'Inaktiv',
        hint: fillControl.running ? 'Pool-Aufbau im Hintergrund' : 'Kein aktiver Lauf',
        tone: fillControl.running ? ('success' as const) : ('default' as const),
      },
      {
        id: 'mappings',
        label: 'Aktive Mappings',
        value: mappingStats.name.active + mappingStats.email.active,
        hint: `${mappingStats.distinctScopes} Scopes`,
        tone: 'info' as const,
      },
      {
        id: 'history',
        label: 'Analyse-Historie',
        value: reportHistoryTotal,
        hint: 'Gespeicherte Läufe',
        tone: reportHistoryTotal > 0 ? ('default' as const) : ('warning' as const),
      },
    ],
    [
      control.autoRunEnabled,
      control.autoRunIntervalMinutes,
      control.enabled,
      fillControl.running,
      mappingStats.distinctScopes,
      mappingStats.email.active,
      mappingStats.name.active,
      reportHistoryTotal,
      viewTab,
    ]
  );

  if (controlLoading && poolsLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <i className="fa-solid fa-spinner fa-spin" />
      </div>
    );
  }

  return (
    <div className="ai-situation-page">
      <AdminPageHero
        title={viewTab === 'reports' ? 'KI-Lagebild' : 'KI-Pseudonymisierung'}
        subtitle={
          viewTab === 'reports'
            ? 'Analyseablauf, Historie, de-pseudonymisierte Ergebnisdarstellung und automatische Berichts-Mail.'
            : 'Pseudonym-Pools, Füllläufe, Mapping-Tabellen und Ticket-Pseudonymisierung zentral verwalten.'
        }
        icon={<i className={`fa-solid ${viewTab === 'reports' ? 'fa-chart-line' : 'fa-user-secret'}`} />}
        badges={[
          {
            id: 'mode',
            label: viewTab === 'reports' ? 'Modus: Lagebild' : 'Modus: Pseudonymisierung',
            tone: 'info',
          },
          {
            id: 'runtime',
            label: control.enabled ? 'Pipeline aktiv' : 'Pipeline gestoppt',
            tone: control.enabled ? 'success' : 'warning',
          },
        ]}
        actions={
          <div className="ai-situation-tab-switch">
            <button
              type="button"
              className={`ai-situation-tab-btn ${viewTab === 'reports' ? 'is-active' : ''}`}
              onClick={() => setViewTab('reports')}
            >
              <i className="fa-solid fa-chart-line" /> Lagebild
            </button>
            <button
              type="button"
              className={`ai-situation-tab-btn ${viewTab === 'pseudonyms' ? 'is-active' : ''}`}
              onClick={() => setViewTab('pseudonyms')}
            >
              <i className="fa-solid fa-user-secret" /> Pseudonymisierung
            </button>
          </div>
        }
      />

      {message ? (
        <div
          className={`message-banner p-4 rounded-lg flex items-center gap-2 ${
            messageType === 'success' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'
          }`}
        >
          <i className={`fa-solid ${messageType === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`} />
          <span>{message}</span>
        </div>
      ) : null}

      <AdminSurfaceCard
        className="ai-situation-intro-card"
        title="Funktionen im Überblick"
        subtitle="Die wichtigsten Bereiche für Betrieb, Qualität und Datenschutz auf einen Blick."
      >
        <div className="ai-situation-intro-grid">
          <div className="ai-situation-intro-item">
            <span className="ai-situation-intro-icon">
              <i className="fa-solid fa-layer-group" />
            </span>
            <div>
              <strong>Pseudonym-Pools</strong>
              <p>Namens- und E-Mail-Bestand verwalten, generieren und versioniert pflegen.</p>
            </div>
          </div>
          <div className="ai-situation-intro-item">
            <span className="ai-situation-intro-icon">
              <i className="fa-solid fa-gears" />
            </span>
            <div>
              <strong>Füllläufe</strong>
              <p>Chunkweise Auffüllung im Hintergrund, mit Start/Stop und klarer Laufdiagnostik.</p>
            </div>
          </div>
          <div className="ai-situation-intro-item">
            <span className="ai-situation-intro-icon">
              <i className="fa-solid fa-chart-line" />
            </span>
            <div>
              <strong>Lagebild</strong>
              <p>Pseudonymisierte Mehrstufenanalyse, Ergebnis-Historie und Label-Übernahme.</p>
            </div>
          </div>
        </div>
      </AdminSurfaceCard>

      <AdminKpiStrip items={situationKpis} className="ai-situation-kpi-row" />

      <section className="card ai-situation-card">
        <div className="ai-situation-card-head">
          <h3>Betriebssteuerung</h3>
          <div className="ai-situation-actions">
            <span className={`ai-status-pill ${control.enabled ? 'is-on' : 'is-off'}`}>
              <i className={`fa-solid ${control.enabled ? 'fa-play' : 'fa-stop'}`} />
              {control.enabled ? 'Analyse aktiv' : 'Analyse gestoppt'}
            </span>
            <button
              type="button"
              className={control.enabled ? 'btn btn-secondary' : 'btn btn-primary'}
              onClick={() => saveControl({ enabled: !control.enabled })}
              disabled={controlSaving}
            >
              {control.enabled ? 'Analyse stoppen' : 'Analyse starten'}
            </button>
          </div>
        </div>

        <div className="ai-situation-grid">
          {viewTab === 'pseudonyms' ? (
            <>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={control.pseudonymizeNames}
                  onChange={(event) => setControl((prev) => ({ ...prev, pseudonymizeNames: event.target.checked }))}
                />
                <span>Namen pseudonymisieren</span>
              </label>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={control.pseudonymizeEmails}
                  onChange={(event) => setControl((prev) => ({ ...prev, pseudonymizeEmails: event.target.checked }))}
                />
                <span>Pseudo-E-Mails verwenden</span>
              </label>
              <div className="ai-inline-action">
                <span className={`ai-status-pill ${control.pseudonymizeEmails ? 'is-on' : 'is-off'}`}>
                  {control.pseudonymizeEmails ? 'Pseudo-E-Mail: an' : 'Pseudo-E-Mail: aus'}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => saveControl({ pseudonymizeEmails: !control.pseudonymizeEmails })}
                  disabled={controlSaving}
                >
                  {control.pseudonymizeEmails ? 'Pseudo-E-Mail stoppen' : 'Pseudo-E-Mail starten'}
                </button>
              </div>
              <label className="ai-field">
                <span>Mapping-TTL (Tage)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={3650}
                  value={control.mappingTtlDays}
                  onChange={(event) =>
                    setControl((prev) => ({
                      ...prev,
                      mappingTtlDays: Number(event.target.value || prev.mappingTtlDays),
                    }))
                  }
                />
              </label>
            </>
          ) : (
            <>
              <label className="ai-field">
                <span>Standard Zeitraum (Tage)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={365}
                  value={control.defaultDays}
                  onChange={(event) =>
                    setControl((prev) => ({
                      ...prev,
                      defaultDays: Number(event.target.value || prev.defaultDays),
                    }))
                  }
                />
              </label>
              <label className="ai-field">
                <span>Standard Ticketlimit</span>
                <input
                  className="input"
                  type="number"
                  min={50}
                  max={2000}
                  value={control.defaultMaxTickets}
                  onChange={(event) =>
                    setControl((prev) => ({
                      ...prev,
                      defaultMaxTickets: Number(event.target.value || prev.defaultMaxTickets),
                    }))
                  }
                />
              </label>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={control.includeClosedByDefault}
                  onChange={(event) => setControl((prev) => ({ ...prev, includeClosedByDefault: event.target.checked }))}
                />
                <span>Abgeschlossene Tickets standardmäßig einschließen</span>
              </label>
            </>
          )}
        </div>

        {viewTab === 'reports' ? (
          <div className="ai-fill-control-layout">
            <div className="ai-fill-control-card">
              <h4>Regelmäßige Analyse</h4>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={control.autoRunEnabled}
                  onChange={(event) => setControl((prev) => ({ ...prev, autoRunEnabled: event.target.checked }))}
                />
                <span>Automatisch in Intervallen analysieren</span>
              </label>
              <label className="ai-field">
                <span>Intervall (Minuten)</span>
                <input
                  className="input"
                  type="number"
                  min={5}
                  max={1440}
                  value={control.autoRunIntervalMinutes}
                  onChange={(event) =>
                    setControl((prev) => ({
                      ...prev,
                      autoRunIntervalMinutes: Number(event.target.value || prev.autoRunIntervalMinutes),
                    }))
                  }
                />
              </label>
              <label className="ai-field">
                <span>Auto-Run Scope-Key</span>
                <input
                  className="input"
                  value={control.autoRunScopeKey || ''}
                  onChange={(event) => setControl((prev) => ({ ...prev, autoRunScopeKey: event.target.value }))}
                  placeholder="z. B. situation-report-stable"
                />
              </label>
              <p className="text-xs text-slate-500">
                Letzter Auto-Lauf: {formatDateTime(control.lastAutoRunAt)}{' '}
                {control.lastAutoRunError ? `· Fehler: ${control.lastAutoRunError}` : ''}
              </p>
            </div>
            <div className="ai-fill-control-card">
              <h4>Auto-Alerts</h4>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={control.autoRunNotifyOnRisk}
                  onChange={(event) => setControl((prev) => ({ ...prev, autoRunNotifyOnRisk: event.target.checked }))}
                />
                <span>Gefährliche Muster als Notification melden</span>
              </label>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={control.autoRunNotifyOnAbuse}
                  onChange={(event) => setControl((prev) => ({ ...prev, autoRunNotifyOnAbuse: event.target.checked }))}
                />
                <span>Missbrauchs-/Banalitätsmuster melden</span>
              </label>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={control.autoRunNotifyOnMessenger}
                  onChange={(event) =>
                    setControl((prev) => ({ ...prev, autoRunNotifyOnMessenger: event.target.checked }))
                  }
                />
                <span>Neues KI-Lagebild als Teamchat-Systemmeldung (abonnierbar)</span>
              </label>
              <p className="text-xs text-slate-500">
                Notifications sind dedupliziert, damit nicht jeder Lauf dieselbe Warnung erzeugt.
              </p>
            </div>
            <div className="ai-fill-control-card">
              <h4>Automatische Berichts-Mail</h4>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={control.autoRunEmailEnabled === true}
                  onChange={(event) => setControl((prev) => ({ ...prev, autoRunEmailEnabled: event.target.checked }))}
                />
                <span>Nach jedem Auto-Lauf Bericht per E-Mail versenden</span>
              </label>
              <label className="ai-field">
                <span>Empfänger (Komma/Zeilenumbruch getrennt)</span>
                <textarea
                  className="ai-pool-textarea ai-compact-textarea"
                  value={autoRunEmailRecipientsInput}
                  onChange={(event) => setAutoRunEmailRecipientsInput(event.target.value)}
                  placeholder="leitung@example.org&#10;lagebild@example.org"
                />
              </label>
              <label className="ai-field">
                <span>Betreff</span>
                <input
                  className="input"
                  value={control.autoRunEmailSubject || ''}
                  onChange={(event) =>
                    setControl((prev) => ({ ...prev, autoRunEmailSubject: event.target.value.slice(0, 180) }))
                  }
                  placeholder="Automatisches KI-Lagebild"
                />
              </label>
              <p className="text-xs text-slate-500">
                Letzter Mailversand: {formatDateTime(control.autoRunEmailLastSentAt)}{' '}
                {control.autoRunEmailLastError ? `· Fehler: ${control.autoRunEmailLastError}` : ''}
              </p>
              <hr className="ai-divider" />
              <h5 className="ai-subtitle">Atom-Feed (abonnierbar)</h5>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={control.atomFeedEnabled === true}
                  onChange={(event) => setControl((prev) => ({ ...prev, atomFeedEnabled: event.target.checked }))}
                />
                <span>KI-Lageberichte als geschützten Atom-Feed bereitstellen</span>
              </label>
              <div className="ai-situation-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={rotateAtomFeedToken}
                  disabled={atomFeedTokenRotating}
                >
                  {atomFeedTokenRotating ? 'Token wird erzeugt...' : 'Feed-Token neu erzeugen'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={revokeAtomFeedToken}
                  disabled={atomFeedTokenRevoking || !aiFeedToken}
                >
                  {atomFeedTokenRevoking ? 'Widerrufe...' : 'Feed-Token widerrufen'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={copyAtomFeedUrl} disabled={!atomFeedUrl}>
                  Feed-URL kopieren
                </button>
              </div>
              <label className="ai-field">
                <span>Feed-URL (Token enthalten)</span>
                <input
                  className="input"
                  value={atomFeedUrl || 'Noch kein Feed-Token vorhanden'}
                  readOnly
                  placeholder="Noch kein Feed-Token vorhanden"
                />
              </label>
              <p className="text-xs text-slate-500">
                Token erstellt: {formatDateTime(aiFeedToken?.createdAt || null)} · zuletzt genutzt:{' '}
                {formatDateTime(aiFeedToken?.lastUsedAt || null)}
              </p>
              {aiFeedTokenLoading ? <p className="text-xs text-slate-500">Feed-Token wird geladen…</p> : null}
              <p className="text-xs text-slate-500">
                Feed-Endpunkt: <code>/api/admin/ai/situation-report/feed/atom?token=...</code>
              </p>
            </div>
          </div>
        ) : null}

        <div className="ai-situation-actions">
          <button type="button" className="btn btn-primary" onClick={() => saveControl()} disabled={controlSaving}>
            {controlSaving ? 'Speichern...' : 'Steuerung speichern'}
          </button>
        </div>
      </section>

      {viewTab === 'pseudonyms' ? (
        <section className="card ai-situation-card">
        <div className="ai-situation-card-head">
          <h3>Pseudonym-Füllläufe (Background)</h3>
          <span className={`ai-status-pill ${fillControl.running ? 'is-on' : 'is-off'}`}>
            {fillControl.running ? 'Laufend' : 'Gestoppt'}
          </span>
        </div>

        <div className="ai-fill-explainer">
          <strong>Was macht der Fülllauf genau?</strong>
          <ol>
            <li>Er prüft, wie viele Namen und E-Mails bis zum Zielbestand noch fehlen.</li>
            <li>Er erzeugt pro Lauf nur kleine Chunks (Name- und E-Mail-Chunk getrennt).</li>
            <li>Er hängt nur neue Werte an und überschreibt keine vorhandenen Pseudonyme.</li>
            <li>Bei aktivierter KI wird bei Formatproblemen automatisch auf Fallback umgestellt.</li>
          </ol>
        </div>

        <div className="ai-fill-run-meta-grid">
          <div className="ai-fill-run-meta-card">
            <span>Letzte Quelle</span>
            <strong>{fillRunSourceLabel}</strong>
          </div>
          <div className="ai-fill-run-meta-card">
            <span>Letzter Chunk</span>
            <strong>
              +{fillControl.lastRunAddedNames} Namen · +{fillControl.lastRunAddedEmails} E-Mails
            </strong>
            <small>
              angefordert {fillControl.lastRunRequestedNames}/{fillControl.lastRunRequestedEmails}
            </small>
          </div>
          <div className="ai-fill-run-meta-card">
            <span>Nächster Chunk (Plan)</span>
            <strong>
              {nextFillChunkPlan.names} Namen · {nextFillChunkPlan.emails} E-Mails
            </strong>
            <small>abhängig von Zielgröße, Intervall und aktivierten Typen</small>
          </div>
        </div>

        {fillWarnings.length > 0 ? (
          <div className="ai-fill-warning-list">
            {fillWarnings.map((warning, index) => (
              <p key={`fill-warning-${index}`}>
                <i className="fa-solid fa-triangle-exclamation" />
                <span>{warning}</span>
              </p>
            ))}
          </div>
        ) : null}

        <div className="ai-fill-progress-grid">
          <div className="ai-fill-progress-card">
            <div className="ai-fill-progress-head">
              <strong>Namen</strong>
              <span>
                {fillProgress.nameCount}/{fillProgress.targetNamePoolSize}
              </span>
            </div>
            <div className="ai-fill-progress-track">
              <div className="ai-fill-progress-bar" style={{ width: `${Math.max(0, fillProgressRatios.names * 100)}%` }} />
            </div>
            <small>Noch offen: {fillProgress.nameMissing}</small>
          </div>
          <div className="ai-fill-progress-card">
            <div className="ai-fill-progress-head">
              <strong>E-Mails</strong>
              <span>
                {fillProgress.emailCount}/{fillProgress.targetEmailPoolSize}
              </span>
            </div>
            <div className="ai-fill-progress-track">
              <div className="ai-fill-progress-bar" style={{ width: `${Math.max(0, fillProgressRatios.emails * 100)}%` }} />
            </div>
            <small>Noch offen: {fillProgress.emailMissing}</small>
          </div>
        </div>

        <details className="ai-fill-help">
          <summary>Steuerlogik anzeigen</summary>
          <p>
            Aktiviert bedeutet: Lauf ist grundsätzlich erlaubt. Laufend bedeutet: es wird zyklisch im Intervall ein
            Chunk versucht. Manuelle Chunks können jederzeit zusätzlich ausgelöst werden.
          </p>
        </details>

        <div className="ai-fill-control-layout">
          <div className="ai-fill-control-card">
            <h4>Modus</h4>
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={fillControl.enabled}
                onChange={(event) => setFillControl((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              <span>Fülllogik aktiviert</span>
            </label>
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={fillControl.running}
                onChange={(event) => setFillControl((prev) => ({ ...prev, running: event.target.checked }))}
              />
              <span>Automatische Chunks zyklisch ausführen</span>
            </label>
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={fillControl.useAiGenerator === true}
                onChange={(event) => setFillControl((prev) => ({ ...prev, useAiGenerator: event.target.checked }))}
              />
              <span>KI-Generator für Chunks nutzen</span>
            </label>
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={fillControl.fillNamesEnabled}
                onChange={(event) => setFillControl((prev) => ({ ...prev, fillNamesEnabled: event.target.checked }))}
              />
              <span>Namen auffüllen</span>
            </label>
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={fillControl.fillEmailsEnabled}
                onChange={(event) => setFillControl((prev) => ({ ...prev, fillEmailsEnabled: event.target.checked }))}
              />
              <span>E-Mails auffüllen</span>
            </label>
          </div>

          <div className="ai-fill-control-card">
            <h4>Laufparameter</h4>
            <label className="ai-field">
              <span>Intervall (Sek.)</span>
              <input
                className="input"
                type="number"
                min={5}
                max={300}
                value={fillControl.intervalSeconds}
                onChange={(event) =>
                  setFillControl((prev) => ({ ...prev, intervalSeconds: Number(event.target.value || prev.intervalSeconds) }))
                }
              />
            </label>
            <label className="ai-field">
              <span>Chunk Namen</span>
              <input
                className="input"
                type="number"
                min={5}
                max={300}
                value={fillControl.chunkSizeNames}
                onChange={(event) =>
                  setFillControl((prev) => ({ ...prev, chunkSizeNames: Number(event.target.value || prev.chunkSizeNames) }))
                }
              />
            </label>
            <label className="ai-field">
              <span>Chunk E-Mails</span>
              <input
                className="input"
                type="number"
                min={5}
                max={300}
                value={fillControl.chunkSizeEmails}
                onChange={(event) =>
                  setFillControl((prev) => ({ ...prev, chunkSizeEmails: Number(event.target.value || prev.chunkSizeEmails) }))
                }
              />
            </label>
            <div className="ai-row-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setFillControl((prev) => ({ ...prev, chunkSizeNames: 20, chunkSizeEmails: 20 }))}
              >
                Klein
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setFillControl((prev) => ({ ...prev, chunkSizeNames: 40, chunkSizeEmails: 40 }))}
              >
                Mittel
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setFillControl((prev) => ({ ...prev, chunkSizeNames: 80, chunkSizeEmails: 80 }))}
              >
                Groß
              </button>
            </div>
          </div>

          <div className="ai-fill-control-card">
            <h4>Zielgrößen</h4>
            <label className="ai-field">
              <span>Ziel Namen</span>
              <input
                className="input"
                type="number"
                min={100}
                max={20000}
                value={fillControl.targetNamePoolSize}
                onChange={(event) =>
                  setFillControl((prev) => ({ ...prev, targetNamePoolSize: Number(event.target.value || prev.targetNamePoolSize) }))
                }
              />
            </label>
            <label className="ai-field">
              <span>Ziel E-Mails</span>
              <input
                className="input"
                type="number"
                min={100}
                max={20000}
                value={fillControl.targetEmailPoolSize}
                onChange={(event) =>
                  setFillControl((prev) => ({ ...prev, targetEmailPoolSize: Number(event.target.value || prev.targetEmailPoolSize) }))
                }
              />
            </label>
            <p className="text-xs text-slate-500">
              Bei erreichter Zielgröße stoppt der automatische Lauf selbstständig.
            </p>
          </div>
        </div>
        <div className="ai-situation-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => saveFillControl()}
            disabled={fillControlSaving}
          >
            {fillControlSaving ? 'Speichern...' : 'Füllsteuerung speichern'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => saveFillControl({ running: true })}
            disabled={fillControlSaving}
          >
            Start
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => saveFillControl({ running: false })}
            disabled={fillControlSaving}
          >
            Stop
          </button>
          <button type="button" className="btn btn-secondary" onClick={runFillChunk} disabled={fillRunLoading}>
            {fillRunLoading ? 'Läuft...' : 'Jetzt 1 Chunk ausführen'}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Letzter Lauf: {formatDateTime(fillControl.lastRunAt)} · Quelle: {fillRunSourceLabel} ·
          Hinzugefügt {fillControl.lastRunAddedNames}/{fillControl.lastRunAddedEmails} · Angefordert{' '}
          {fillControl.lastRunRequestedNames}/{fillControl.lastRunRequestedEmails}{' '}
          {fillProgress.done ? '· Zielwerte erreicht' : ''}
          {fillControl.lastError ? `· Fehler: ${fillControl.lastError}` : ''}
        </p>
        </section>
      ) : null}

      {viewTab === 'reports' ? (
        <section className="card ai-situation-card">
        <div className="ai-situation-card-head">
          <h3>Analyse-Historie</h3>
          <span className="text-sm text-slate-600">{reportHistoryTotal} gespeicherte Läufe</span>
        </div>
        <div className="ai-situation-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void loadReportHistory()} disabled={reportHistoryLoading}>
            {reportHistoryLoading ? 'Lade...' : 'Historie aktualisieren'}
          </button>
        </div>
        {reportHistory.length === 0 ? (
          <p className="text-sm text-slate-600">Noch keine gespeicherten Analysen.</p>
        ) : (
          <div className="ai-table-wrap">
            <table className="ai-situation-table">
              <thead>
                <tr>
                  <th>Erstellt</th>
                  <th>Typ</th>
                  <th>Scope</th>
                  <th>Tickets</th>
                  <th>Bearbeiter</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {reportHistory.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>{entry.reportTypeLabel || resolveReportTypeLabel(entry.reportType)}</td>
                    <td>{entry.scopeKey || '–'}</td>
                    <td>{entry.maxTickets}</td>
                    <td>{entry.createdByUsername || '–'}</td>
                    <td>
                      <div className="ai-row-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => void loadStoredReport(entry.id)}>
                          Laden
                        </button>
                        <button type="button" className="btn btn-danger" onClick={() => void deleteStoredReport(entry.id)}>
                          Löschen
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => void downloadStoredReport(entry.id)}>
                          JSON
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </section>
      ) : null}

      {viewTab === 'pseudonyms' ? (
        <section className="card ai-situation-card">
        <div className="ai-situation-card-head">
          <h3>Pseudonym-Pools</h3>
          <span className="text-sm text-slate-600">
            Name-Pool v{poolMeta.name.version} · E-Mail-Pool v{poolMeta.email.version}
          </span>
        </div>

        <div className="ai-mapping-stats">
          <div>
            <strong>Name-Mappings</strong>
            <p>
              aktiv {mappingStats.name.active} / gesamt {mappingStats.name.total} / abgelaufen {mappingStats.name.expired}
            </p>
          </div>
          <div>
            <strong>E-Mail-Mappings</strong>
            <p>
              aktiv {mappingStats.email.active} / gesamt {mappingStats.email.total} / abgelaufen {mappingStats.email.expired}
            </p>
          </div>
          <div>
            <strong>Aktive Scopes</strong>
            <p>{mappingStats.distinctScopes}</p>
          </div>
        </div>

        <div className="ai-table-wrap">
          <div className="ai-situation-card-head">
            <h4>Pseudonym-Mappings (letzte {mappingRows.length})</h4>
            <button type="button" className="btn btn-secondary" onClick={() => void loadPools()} disabled={poolsLoading}>
              {poolsLoading ? 'Lade...' : 'Tabellen aktualisieren'}
            </button>
          </div>
          {mappingRows.length === 0 ? (
            <p className="text-sm text-slate-600">Keine Mapping-Einträge vorhanden.</p>
          ) : (
            <table className="ai-situation-table">
              <thead>
                <tr>
                  <th>Erstellt</th>
                  <th>Scope</th>
                  <th>Typ</th>
                  <th>Pseudonym</th>
                  <th>Ablauf</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {mappingRows.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>{entry.scopeKey || '–'}</td>
                    <td>{entry.entityType}</td>
                    <td>{entry.pseudoValue || '–'}</td>
                    <td>{formatDateTime(entry.expiresAt)}</td>
                    <td>{entry.isActive ? 'aktiv' : 'abgelaufen'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="ai-table-wrap">
          <h4>Ticket-Pseudonyme (letzte {ticketReporterRows.length})</h4>
          {ticketReporterRows.length === 0 ? (
            <p className="text-sm text-slate-600">
              Keine Ticket-Pseudonyme vorhanden. Entstehen beim Pseudonymisieren im Ticket oder im KI-Lagebildlauf.
            </p>
          ) : (
            <table className="ai-situation-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Scope</th>
                  <th>Pseudo-Name</th>
                  <th>Pseudo-E-Mail</th>
                  <th>Ticket-Status</th>
                  <th>Aktualisiert</th>
                </tr>
              </thead>
              <tbody>
                {ticketReporterRows.map((entry) => (
                  <tr key={`${entry.ticketId}-${entry.updatedAt || entry.createdAt || 'row'}`}>
                    <td>{entry.ticketId || '–'}</td>
                    <td>{entry.scopeKey || '–'}</td>
                    <td>{entry.pseudoName || '–'}</td>
                    <td>{entry.pseudoEmail || '–'}</td>
                    <td>{entry.ticketStatus || '–'}</td>
                    <td>{formatDateTime(entry.updatedAt || entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="ai-pool-editors">
          <div>
            <h4>Namen</h4>
            <textarea
              className="ai-pool-textarea"
              value={poolInputs.name}
              onChange={(event) => setPoolInputs((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Ein Pseudonym pro Zeile"
            />
            <p className="text-xs text-slate-500">Letzte Aktualisierung: {formatDateTime(poolMeta.name.updatedAt)}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => savePool('name')}
              disabled={poolsSaving.name || poolsLoading}
            >
              {poolsSaving.name ? 'Speichern...' : 'Namen speichern'}
            </button>
          </div>
          <div>
            <h4>Pseudo-E-Mails</h4>
            <textarea
              className="ai-pool-textarea"
              value={poolInputs.email}
              onChange={(event) => setPoolInputs((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="Eine Pseudo-E-Mail pro Zeile"
            />
            <p className="text-xs text-slate-500">Letzte Aktualisierung: {formatDateTime(poolMeta.email.updatedAt)}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => savePool('email')}
              disabled={poolsSaving.email || poolsLoading}
            >
              {poolsSaving.email ? 'Speichern...' : 'Pseudo-E-Mails speichern'}
            </button>
          </div>
        </div>

        <div className="ai-pool-controls">
          <label className="ai-field">
            <span>Speichermodus</span>
            <select className="input" value={poolSaveMode} onChange={(event) => setPoolSaveMode(event.target.value as SaveMode)}>
              <option value="replace">replace (ersetzen)</option>
              <option value="append">append (anhängen)</option>
            </select>
          </label>
          <label className="ai-field">
            <span>Generator: Namen</span>
            <input
              className="input"
              type="number"
              min={10}
              max={5000}
              value={generateConfig.nameCount}
              onChange={(event) =>
                setGenerateConfig((prev) => ({ ...prev, nameCount: Number(event.target.value || prev.nameCount) }))
              }
            />
          </label>
          <label className="ai-field">
            <span>Generator: E-Mails</span>
            <input
              className="input"
              type="number"
              min={10}
              max={5000}
              value={generateConfig.emailCount}
              onChange={(event) =>
                setGenerateConfig((prev) => ({ ...prev, emailCount: Number(event.target.value || prev.emailCount) }))
              }
            />
          </label>
          <label className="ai-field">
            <span>Generator: Domains</span>
            <input
              className="input"
              type="number"
              min={1}
              max={200}
              value={generateConfig.domainCount}
              onChange={(event) =>
                setGenerateConfig((prev) => ({ ...prev, domainCount: Number(event.target.value || prev.domainCount) }))
              }
            />
          </label>
        </div>

        <div className="ai-situation-actions">
          <button type="button" className="btn btn-primary" onClick={generatePools} disabled={generateLoading}>
            {generateLoading ? 'Generiere...' : 'Pseudonym-Pools per KI generieren'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={applyGeneratedPreview}
            disabled={!generatedPreview}
          >
            Vorschlag in Editor übernehmen
          </button>
        </div>

        {generatedPreview ? (
          <div className="ai-generated-preview">
            <strong>KI-Vorschau</strong>
            <p>
              Namen: {generatedPreview.names.length} · E-Mails: {generatedPreview.emails.length} · Domains:{' '}
              {generatedPreview.domains.length}
            </p>
          </div>
        ) : null}

        <div className="ai-reset-tools">
          <h4>Mappings zurücksetzen</h4>
          <div className="ai-pool-controls">
            <label className="ai-field">
              <span>Scope-Key (optional)</span>
              <input
                className="input"
                value={resetScopeKey}
                onChange={(event) => setResetScopeKey(event.target.value)}
                placeholder="z. B. situation-report-2026-02-18"
              />
            </label>
            <label className="ai-field">
              <span>Typ</span>
              <select
                className="input"
                value={resetEntityType}
                onChange={(event) => setResetEntityType(event.target.value as 'all' | PoolType)}
              >
                <option value="all">alle</option>
                <option value="name">name</option>
                <option value="email">email</option>
              </select>
            </label>
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={resetExpiredOnly}
                onChange={(event) => setResetExpiredOnly(event.target.checked)}
              />
              <span>Nur abgelaufene Mappings löschen</span>
            </label>
          </div>
          <button type="button" className="btn btn-danger" onClick={resetMappings} disabled={resetLoading}>
            {resetLoading ? 'Lösche...' : 'Mappings löschen'}
          </button>
        </div>
      </section>
      ) : null}

      {viewTab === 'reports' ? (
        <section className="card ai-situation-card">
        <div className="ai-situation-card-head">
          <h3>KI-Lagebild starten</h3>
          <span className="text-sm text-slate-600">Analyse kann während des Laufs gestoppt werden.</span>
        </div>
        <div className="ai-pool-controls">
          <label className="ai-field">
            <span>Berichtsart</span>
            <select
              className="input"
              value={reportFilters.reportType}
              onChange={(event) =>
                setReportFilters((prev) => ({
                  ...prev,
                  reportType: normalizeReportType(event.target.value),
                }))
              }
            >
              <option value="operations">{REPORT_TYPE_LABELS.operations}</option>
              <option value="category_workflow">{REPORT_TYPE_LABELS.category_workflow} (nur manuell)</option>
              <option value="free_analysis">{REPORT_TYPE_LABELS.free_analysis} (nur manuell)</option>
            </select>
          </label>
          <label className="ai-field">
            <span>Zeitraum (Tage)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={365}
              value={reportFilters.days}
              onChange={(event) =>
                setReportFilters((prev) => ({ ...prev, days: Number(event.target.value || prev.days) }))
              }
            />
          </label>
          <label className="ai-field">
            <span>Max. Tickets</span>
            <input
              className="input"
              type="number"
              min={50}
              max={2000}
              value={reportFilters.maxTickets}
              onChange={(event) =>
                setReportFilters((prev) => ({ ...prev, maxTickets: Number(event.target.value || prev.maxTickets) }))
              }
            />
          </label>
          <label className="ai-field">
            <span>Scope-Key (optional)</span>
            <input
              className="input"
              value={reportFilters.scopeKey}
              onChange={(event) => setReportFilters((prev) => ({ ...prev, scopeKey: event.target.value }))}
              placeholder="Optional für stabile Pseudonyme"
            />
          </label>
          <label className="ai-toggle">
            <input
              type="checkbox"
              checked={reportFilters.includeClosed}
              onChange={(event) => setReportFilters((prev) => ({ ...prev, includeClosed: event.target.checked }))}
            />
            <span>Abgeschlossene Tickets einschließen</span>
          </label>
        </div>
        {reportFilters.reportType === 'free_analysis' ? (
          <label className="ai-field">
            <span>Freie Analysefrage (Klartext)</span>
            <textarea
              className="input"
              rows={4}
              value={reportFilters.analysisQuestion}
              onChange={(event) =>
                setReportFilters((prev) => ({
                  ...prev,
                  analysisQuestion: event.target.value,
                }))
              }
              placeholder="Beispiel: Welche Muster deuten auf systematische Falschmeldungen in den letzten 30 Tagen hin und welche Gegenmaßnahmen sind am wirksamsten?"
            />
          </label>
        ) : null}
        <div className="ai-situation-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              setReportFilters((prev) => ({
                ...prev,
                days: control.defaultDays,
                maxTickets: control.defaultMaxTickets,
                includeClosed: control.includeClosedByDefault,
              }))
            }
          >
            Defaults aus Steuerung übernehmen
          </button>
          <button type="button" className="btn btn-primary" onClick={runSituationReport} disabled={reportRunning}>
            {reportRunning
              ? 'Analyse läuft...'
              : reportFilters.reportType === 'category_workflow'
              ? 'Kategorien-/Workflow-Beratung starten'
              : reportFilters.reportType === 'free_analysis'
              ? 'Freie Analyse starten'
              : 'Analyse starten'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={stopReportRun} disabled={!reportRunning}>
            Analyse stoppen
          </button>
        </div>
        </section>
      ) : null}

      {viewTab === 'reports' && reportResult ? (
        <section className="card ai-situation-card">
          <div className="ai-situation-card-head">
            <h3>
              Analyseergebnis · <span className="text-sm text-slate-600">{currentReportTypeLabel}</span>
            </h3>
            <div className="ai-row-actions">
              <span className="text-sm text-slate-600">
                {reportResult.reportId ? `Run ${reportResult.reportId} · ` : ''}
                Scope {reportResult.scopeKey} · {reportResult.ticketCount} Tickets · {formatDateTime(reportResult.generatedAt)}
              </span>
              <button type="button" className="btn btn-secondary" onClick={downloadCurrentReport}>
                JSON herunterladen
              </button>
            </div>
          </div>

          <div className="ai-generated-preview">
            <strong>Zusammenfassung</strong>
            <p>
              {String(
                reportParsed?.summary ||
                  reportParsed?.categoryWorkflowSummary ||
                  reportParsed?.answer ||
                  'Keine strukturierte Zusammenfassung vorhanden.'
              )}
            </p>
          </div>

          {reportStageErrors.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <strong>Teilanalysen mit Fehlern:</strong>
              <ul>
                {reportStageErrors.map((entry, index) => (
                  <li key={`stage-error-${index}`}>
                    {entry.stage || 'stage'}: {entry.error || 'Unbekannter Fehler'}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {currentReportType === 'free_analysis' ? (
            <div className="ai-list-grid">
              <div>
                <strong>Fragestellung</strong>
                <p>{String(reportResult.analysisQuestion || 'Keine Fragestellung gespeichert.')}</p>
              </div>
              <div>
                <strong>Direkte Antwort</strong>
                <p>{String(reportParsed?.answer || 'Keine direkte Antwort im Ergebnis enthalten.')}</p>
              </div>
              <div>
                <strong>Kernbefunde</strong>
                <ul>
                  {!Array.isArray(reportParsed?.keyFindings) || reportParsed.keyFindings.length === 0 ? <li>Keine</li> : null}
                  {(Array.isArray(reportParsed?.keyFindings) ? reportParsed.keyFindings : []).map((entry: string, index: number) => (
                    <li key={`free-key-finding-${index}`}>{entry}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Empfohlene Maßnahmen</strong>
                <ul>
                  {!Array.isArray(reportParsed?.recommendedActions) || reportParsed.recommendedActions.length === 0 ? <li>Keine</li> : null}
                  {(Array.isArray(reportParsed?.recommendedActions) ? reportParsed.recommendedActions : []).map((entry: string, index: number) => (
                    <li key={`free-action-${index}`}>{entry}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {reportResult.operationalMetrics ? (
            <div className="ai-abuse-kpi-row">
              <div className="ai-abuse-kpi">
                <span>Tickets (Datensatz)</span>
                <strong>{Number(reportResult.operationalMetrics.ticketCount || reportResult.ticketCount || 0)}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Ohne Ort</span>
                <strong>{Number(reportResult.operationalMetrics.missingLocationTickets || 0)}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Ohne Ort Quote</span>
                <strong>{formatPercent(reportResult.operationalMetrics.missingLocationRatio)}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Top-Kategorien</span>
                <strong>{Array.isArray(reportResult.operationalMetrics.topCategories) ? reportResult.operationalMetrics.topCategories.length : 0}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Reporter-Muster</span>
                <strong>{Number(reportResult.operationalMetrics.frequentReporterSampleSize || 0)}</strong>
              </div>
            </div>
          ) : null}

          {reportResult.ticketLifecycleSummary ? (
            <div className="ai-abuse-kpi-row">
              <div className="ai-abuse-kpi">
                <span>Ø Ticketalter</span>
                <strong>{formatHours(reportResult.ticketLifecycleSummary.avgTicketAgeHours)}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Ø Closed-Zyklus</span>
                <strong>{formatHours(reportResult.ticketLifecycleSummary.avgClosedCycleHours)}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Closed-Tickets</span>
                <strong>{Number(reportResult.ticketLifecycleSummary.closedTicketCount || 0)}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Mit Workflow</span>
                <strong>{Number(reportResult.ticketLifecycleSummary.workflowAttachedCount || 0)}</strong>
              </div>
            </div>
          ) : null}

          {reportResult.reporterAbuseSummary ? (
            <div className="ai-abuse-kpi-row">
              <div className="ai-abuse-kpi">
                <span>Melder gesamt</span>
                <strong>{reportResult.reporterAbuseSummary.totalReporters}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Hoch/Kritisch</span>
                <strong>{reportResult.reporterAbuseSummary.highOrCritical}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Mittel</span>
                <strong>{reportResult.reporterAbuseSummary.medium}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Niedrig</span>
                <strong>{reportResult.reporterAbuseSummary.low}</strong>
              </div>
              <div className="ai-abuse-kpi">
                <span>Max-Score</span>
                <strong>{Number(reportResult.reporterAbuseSummary.maxScore || 0).toFixed(2)}</strong>
              </div>
            </div>
          ) : null}

          <div className="ai-db-pool-preview">
            <div className="ai-situation-card-head">
              <h4>Analyse-Highlights</h4>
              <span className="text-sm text-slate-600">
                Stufe-Outputs vollständig verfügbar
              </span>
            </div>
            <div className="ai-db-pool-columns">
              <div>
                <strong>Risikosignale</strong>
                <ul>
                  {!Array.isArray(reportParsed?.riskSignals) || reportParsed.riskSignals.length === 0 ? <li>Keine</li> : null}
                  {(Array.isArray(reportParsed?.riskSignals) ? reportParsed.riskSignals : []).map((entry: string, index: number) => (
                    <li key={`risk-signal-${index}`}>{entry}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Sofortmaßnahmen</strong>
                <ul>
                  {!Array.isArray(reportParsed?.immediateActions) || reportParsed.immediateActions.length === 0 ? <li>Keine</li> : null}
                  {(Array.isArray(reportParsed?.immediateActions) ? reportParsed.immediateActions : []).map((entry: string, index: number) => (
                    <li key={`immediate-action-${index}`}>{entry}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Operative Empfehlungen</strong>
                <ul>
                  {!Array.isArray(reportParsed?.operationalRecommendations) || reportParsed.operationalRecommendations.length === 0 ? <li>Keine</li> : null}
                  {(Array.isArray(reportParsed?.operationalRecommendations) ? reportParsed.operationalRecommendations : []).map((entry: string, index: number) => (
                    <li key={`operational-recommendation-${index}`}>{entry}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Reporter-Risiken</strong>
                <ul>
                  {!Array.isArray(reportParsed?.reporterRisks) || reportParsed.reporterRisks.length === 0 ? <li>Keine</li> : null}
                  {(Array.isArray(reportParsed?.reporterRisks) ? reportParsed.reporterRisks : []).map((entry: string, index: number) => (
                    <li key={`reporter-risk-${index}`}>{entry}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Ressourcenhinweise</strong>
                <ul>
                  {!Array.isArray(reportParsed?.resourceHints) || reportParsed.resourceHints.length === 0 ? <li>Keine</li> : null}
                  {(Array.isArray(reportParsed?.resourceHints) ? reportParsed.resourceHints : []).map((entry: string, index: number) => (
                    <li key={`resource-hint-${index}`}>{entry}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Koordinationshinweise</strong>
                <ul>
                  {!Array.isArray(reportParsed?.coordinationHints) || reportParsed.coordinationHints.length === 0 ? <li>Keine</li> : null}
                  {(Array.isArray(reportParsed?.coordinationHints) ? reportParsed.coordinationHints : []).map((entry: string, index: number) => (
                    <li key={`coordination-hint-${index}`}>{entry}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {currentReportType === 'category_workflow' ||
          categoryFindings.length > 0 ||
          workflowRecommendations.length > 0 ||
          mappingSuggestions.length > 0 ? (
            <>
              <div className="ai-list-block">
                <h4>Kategorien & Workflow-Beratung</h4>
                <ul>
                  {Array.isArray(reportParsed?.lifecycleRisks) && reportParsed.lifecycleRisks.length > 0 ? (
                    reportParsed.lifecycleRisks.map((entry: string, index: number) => (
                      <li key={`lifecycle-risk-${index}`}>{entry}</li>
                    ))
                  ) : (
                    <li>Keine zusätzlichen Lifecycle-Risiken gemeldet.</li>
                  )}
                </ul>
              </div>

              {Array.isArray(reportResult.categoryLifecycleMetrics) && reportResult.categoryLifecycleMetrics.length > 0 ? (
                <div className="ai-table-wrap">
                  <h4>Kategorie-Laufzeiten (berechnet)</h4>
                  <table className="ai-situation-table">
                    <thead>
                      <tr>
                        <th>Kategorie</th>
                        <th>Tickets</th>
                        <th>Open</th>
                        <th>Closed</th>
                        <th>Workflow-Coverage</th>
                        <th>Ø Alter</th>
                        <th>Ø Closed-Zyklus</th>
                        <th>Top-Workflow</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportResult.categoryLifecycleMetrics.map((entry, index) => (
                        <tr key={`category-lifecycle-${entry.category || 'row'}-${index}`}>
                          <td>{entry.category || '–'}</td>
                          <td>{Number(entry.ticketCount || 0)}</td>
                          <td>{Number(entry.openCount || 0)}</td>
                          <td>{Number(entry.closedCount || 0)}</td>
                          <td>{formatPercent(entry.workflowCoverage)}</td>
                          <td>{formatHours(entry.avgAgeHours)}</td>
                          <td>{formatHours(entry.avgClosedCycleHours)}</td>
                          <td>{entry.topWorkflowTemplates?.[0]?.workflowTemplate || '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {Array.isArray(reportResult.workflowTemplateMetrics) && reportResult.workflowTemplateMetrics.length > 0 ? (
                <div className="ai-table-wrap">
                  <h4>Workflow-Metriken (berechnet)</h4>
                  <table className="ai-situation-table">
                    <thead>
                      <tr>
                        <th>Workflow</th>
                        <th>Tickets</th>
                        <th>Completion</th>
                        <th>Failure</th>
                        <th>Ø Dauer</th>
                        <th>Ø Tasks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportResult.workflowTemplateMetrics.map((entry, index) => (
                        <tr key={`workflow-metric-${entry.workflowTemplate || 'row'}-${index}`}>
                          <td>{entry.workflowTemplate || '–'}</td>
                          <td>{Number(entry.ticketCount || 0)}</td>
                          <td>{formatPercent(entry.completionRate)}</td>
                          <td>{formatPercent(entry.failureRate)}</td>
                          <td>{formatHours(entry.avgDurationHours)}</td>
                          <td>{Number(entry.avgTasks || 0).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {categoryFindings.length > 0 ? (
                <div className="ai-table-wrap">
                  <h4>KI-Kategorie-Findings</h4>
                  <table className="ai-situation-table">
                    <thead>
                      <tr>
                        <th>Kategorie</th>
                        <th>Tickets</th>
                        <th>Ø Alter</th>
                        <th>Vorschlag Workflow</th>
                        <th>Konfidenz</th>
                        <th>Bottlenecks</th>
                        <th>Maßnahmen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryFindings.map((entry, index) => (
                        <tr key={`category-finding-${entry.category || 'row'}-${index}`}>
                          <td>{entry.category || '–'}</td>
                          <td>{Number(entry.ticketCount || 0)}</td>
                          <td>{formatHours(entry.avgAgeHours)}</td>
                          <td>{entry.suggestedWorkflowTemplate || '–'}</td>
                          <td>{Number(entry.confidence || 0).toFixed(2)}</td>
                          <td>
                            {Array.isArray(entry.bottlenecks) && entry.bottlenecks.length > 0
                              ? entry.bottlenecks.slice(0, 3).join(' · ')
                              : '–'}
                          </td>
                          <td>
                            {Array.isArray(entry.actions) && entry.actions.length > 0
                              ? entry.actions.slice(0, 3).join(' · ')
                              : '–'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {workflowRecommendations.length > 0 ? (
                <div className="ai-table-wrap">
                  <h4>KI-Workflow-Empfehlungen</h4>
                  <table className="ai-situation-table">
                    <thead>
                      <tr>
                        <th>Workflow</th>
                        <th>Fit</th>
                        <th>Konfidenz</th>
                        <th>Begründung</th>
                        <th>Optimierungen</th>
                        <th>Risiken</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workflowRecommendations.map((entry, index) => (
                        <tr key={`workflow-rec-${entry.workflowTemplate || 'row'}-${index}`}>
                          <td>{entry.workflowTemplate || '–'}</td>
                          <td>{entry.fit || '–'}</td>
                          <td>{Number(entry.confidence || 0).toFixed(2)}</td>
                          <td>{entry.reason || '–'}</td>
                          <td>
                            {Array.isArray(entry.optimizations) && entry.optimizations.length > 0
                              ? entry.optimizations.slice(0, 3).join(' · ')
                              : '–'}
                          </td>
                          <td>
                            {Array.isArray(entry.risks) && entry.risks.length > 0
                              ? entry.risks.slice(0, 3).join(' · ')
                              : '–'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {mappingSuggestions.length > 0 ? (
                <div className="ai-table-wrap">
                  <h4>Kategorie-Workflow-Mapping-Vorschläge</h4>
                  <table className="ai-situation-table">
                    <thead>
                      <tr>
                        <th>Kategorie</th>
                        <th>Workflow</th>
                        <th>Konfidenz</th>
                        <th>Impact</th>
                        <th>Begründung</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappingSuggestions.map((entry, index) => (
                        <tr key={`mapping-suggestion-${entry.category || 'row'}-${index}`}>
                          <td>{entry.category || '–'}</td>
                          <td>{entry.recommendedWorkflowTemplate || '–'}</td>
                          <td>{Number(entry.confidence || 0).toFixed(2)}</td>
                          <td>{entry.expectedImpact || '–'}</td>
                          <td>{entry.reason || '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {optimizationBacklog.length > 0 ? (
                <div className="ai-table-wrap">
                  <h4>Optimierungs-Backlog (KI)</h4>
                  <table className="ai-situation-table">
                    <thead>
                      <tr>
                        <th>Titel</th>
                        <th>Impact</th>
                        <th>Effort</th>
                        <th>Owner</th>
                        <th>Begründung</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optimizationBacklog.map((entry, index) => (
                        <tr key={`optimization-backlog-${entry.title || 'row'}-${index}`}>
                          <td>{entry.title || '–'}</td>
                          <td>{entry.impact || '–'}</td>
                          <td>{entry.effort || '–'}</td>
                          <td>{entry.owner || '–'}</td>
                          <td>{entry.reason || '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}

          {reporterRatioBars.length > 0 ? (
            <div className="ai-chart-block">
              <h4>Grafik: Banalitätsquote je Reporter (Top 8)</h4>
              <div className="ai-chart-list">
                {reporterRatioBars.map((bar) => (
                  <div key={bar.label} className="ai-chart-row">
                    <span className="ai-chart-label">{bar.label}</span>
                    <div className="ai-chart-bar-wrap">
                      <div className="ai-chart-bar" style={{ width: `${Math.max(2, bar.ratio * 100)}%` }} />
                    </div>
                    <span className="ai-chart-value">{Math.round(bar.ratio * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {Array.isArray(reportParsed?.hotspots) && reportParsed.hotspots.length > 0 ? (
            <div className="ai-list-block">
              <h4>Hotspots</h4>
              <ul>
                {reportParsed.hotspots.map((entry: string, index: number) => (
                  <li key={`hotspot-${index}`}>{entry}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {Array.isArray(reportParsed?.patterns) && reportParsed.patterns.length > 0 ? (
            <div className="ai-list-block">
              <h4>Muster</h4>
              <ul>
                {reportParsed.patterns.map((entry: string, index: number) => (
                  <li key={`pattern-${index}`}>{entry}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {Array.isArray(reportParsed?.abuseTrends) && reportParsed.abuseTrends.length > 0 ? (
            <div className="ai-list-block">
              <h4>Missbrauchstrends</h4>
              <ul>
                {reportParsed.abuseTrends.map((entry: string, index: number) => (
                  <li key={`abuse-trend-${index}`}>{entry}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {Array.isArray(reportParsed?.recommendedActions) && reportParsed.recommendedActions.length > 0 ? (
            <div className="ai-list-block">
              <h4>Empfohlene Maßnahmen</h4>
              <ul>
                {reportParsed.recommendedActions.map((entry: string, index: number) => (
                  <li key={`recommended-action-${index}`}>{entry}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="ai-table-wrap">
            <h4>Häufige Reporter-Muster</h4>
            <table className="ai-situation-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>E-Mail</th>
                  <th>Gesamt</th>
                  <th>Banal</th>
                  <th>Banal-Quote</th>
                  <th>Ohne Ort</th>
                  <th>Wiederholung</th>
                  <th>Letzte Meldung</th>
                </tr>
              </thead>
              <tbody>
                {(reportResult.frequentReporterPatterns || []).map((entry, index) => (
                  <tr key={`reporter-${entry.reporter}-${index}`}>
                    <td>{reportResult.frequentReporterPatternsResolved?.[index]?.reporterResolvedName || reporterIdentityByKey.get(entry.reporter)?.name || extractNameFromIdentity(reportResult.frequentReporterPatternsResolved?.[index]?.reporterResolved) || '–'}</td>
                    <td>{reportResult.frequentReporterPatternsResolved?.[index]?.reporterResolvedEmail || reporterIdentityByKey.get(entry.reporter)?.email || extractEmailFromIdentity(reportResult.frequentReporterPatternsResolved?.[index]?.reporterResolved) || '–'}</td>
                    <td>{entry.totalReports}</td>
                    <td>{entry.banalReports}</td>
                    <td>{formatPercent(entry.banalRatio)}</td>
                    <td>{formatPercent(entry.missingLocationRatio)}</td>
                    <td>{formatPercent(entry.repeatedDescriptionRatio)}</td>
                    <td>{formatDateTime(entry.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ai-table-wrap">
            <h4>Missbrauchsscoring je Melder (de-pseudonymisiert)</h4>
            {reporterAbuseRows.length === 0 ? (
              <p className="text-sm text-slate-600">Keine Melderdaten für Scoring vorhanden.</p>
            ) : (
              <table className="ai-situation-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>E-Mail</th>
                    <th>Score</th>
                    <th>Level</th>
                    <th>Gesamt</th>
                    <th>Banal</th>
                    <th>Ohne Ort</th>
                    <th>Wiederholung</th>
                    <th>KI-Signal</th>
                    <th>Kategorien</th>
                    <th>Letzte Meldung</th>
                    <th>Hinweise</th>
                  </tr>
                </thead>
                <tbody>
                  {reporterAbuseRows.map((entry, index) => (
                    <tr key={`abuse-row-${entry.reporter}-${index}`}>
                      <td>{entry.reporterResolvedName || extractNameFromIdentity(entry.reporterResolved) || '–'}</td>
                      <td>{entry.reporterResolvedEmail || extractEmailFromIdentity(entry.reporterResolved) || '–'}</td>
                      <td>{Number(entry.abuseScore || 0).toFixed(2)}</td>
                      <td>
                        <span className={`ai-abuse-level ai-abuse-level-${String(entry.abuseLevel || '').toLowerCase()}`}>
                          {entry.abuseLevel || 'niedrig'}
                        </span>
                      </td>
                      <td>{entry.totalReports}</td>
                      <td>{formatPercent(entry.banalRatio)}</td>
                      <td>{formatPercent(entry.missingLocationRatio)}</td>
                      <td>{formatPercent(entry.repeatedDescriptionRatio)}</td>
                      <td>{Number(entry.aiSuspicionScore || 0).toFixed(2)}</td>
                      <td>
                        {Array.isArray(entry.dominantCategories) && entry.dominantCategories.length > 0
                          ? entry.dominantCategories.slice(0, 3).join(', ')
                          : '–'}
                      </td>
                      <td>{formatDateTime(entry.lastAt)}</td>
                      <td>
                        {Array.isArray(entry.reasons) && entry.reasons.length > 0 ? (
                          <ul className="ai-inline-list">
                            {entry.reasons.slice(0, 3).map((reason, reasonIndex) => (
                              <li key={`abuse-reason-${entry.reporter}-${reasonIndex}`}>{reason}</li>
                            ))}
                          </ul>
                        ) : (
                          '–'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="ai-table-wrap">
            <div className="ai-situation-card-head">
              <h4>Empfohlene Labels</h4>
              <button type="button" className="btn btn-primary" onClick={applySelectedLabels} disabled={applyLabelsLoading}>
                {applyLabelsLoading ? 'Speichere...' : `Auswahl speichern (${selectedLabels.length})`}
              </button>
            </div>
            <table className="ai-situation-table">
              <thead>
                <tr>
                  <th>Übernehmen</th>
                  <th>Ticket</th>
                  <th>Label</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {(reportResult.recommendedLabels || []).map((entry, index) => {
                  const key = `${entry.ticketId}__${entry.label}__${index}`;
                  return (
                    <tr key={key}>
                      <td>
                        <input
                          type="checkbox"
                          checked={labelSelection[key] === true}
                          onChange={(event) =>
                            setLabelSelection((prev) => ({
                              ...prev,
                              [key]: event.target.checked,
                            }))
                          }
                        />
                      </td>
                      <td>{entry.ticketId}</td>
                      <td>{entry.label}</td>
                      <td>{Number.isFinite(Number(entry.score)) ? Number(entry.score).toFixed(2) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {reportRaw && typeof reportRaw === 'object' && !Array.isArray(reportRaw) ? (
            <div className="ai-table-wrap">
              <h4>Vollständige Stufenantwort</h4>
              <div className="ai-db-pool-columns">
                <div>
                  <strong>Übersicht</strong>
                  <pre className="ai-stage-pre">
                    {JSON.stringify((reportRaw as Record<string, any>).overview || {}, null, 2)}
                  </pre>
                </div>
                <div>
                  <strong>Reporter-Muster</strong>
                  <pre className="ai-stage-pre">
                    {JSON.stringify((reportRaw as Record<string, any>).reporters || {}, null, 2)}
                  </pre>
                </div>
                <div>
                  <strong>Label-Stufe</strong>
                  <pre className="ai-stage-pre">
                    {JSON.stringify((reportRaw as Record<string, any>).labels || {}, null, 2)}
                  </pre>
                </div>
                <div>
                  <strong>Kategorie/Workflow-Stufe</strong>
                  <pre className="ai-stage-pre">
                    {JSON.stringify((reportRaw as Record<string, any>).categoryWorkflow || {}, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}

          <details className="ai-raw-details">
            <summary>KI-Rohantwort (de-pseudonymisiert, falls verfügbar)</summary>
            <pre>
              {typeof reportRaw === 'string'
                ? reportRaw
                : JSON.stringify(reportRaw || {}, null, 2)}
            </pre>
          </details>
        </section>
      ) : null}
    </div>
  );
};

export default AISituationReport;
