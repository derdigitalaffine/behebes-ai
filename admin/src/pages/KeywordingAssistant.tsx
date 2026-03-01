import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import {
  SmartTable,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { getAdminToken } from '../lib/auth';
import { useAdminScopeContext } from '../lib/adminScopeContext';
import { useLocation } from 'react-router-dom';

type TargetScope = 'org_units' | 'users' | 'both';
type ApplyMode = 'review' | 'auto_if_confident';
type CandidateAction = 'add' | 'keep' | 'remove' | 'skip';

interface KeywordingJob {
  id: string;
  tenantId: string;
  status: string;
  sourceScope: string;
  targetScope: TargetScope;
  includeExistingKeywords: boolean;
  applyMode: ApplyMode;
  minSuggestConfidence: number;
  minAutoApplyConfidence: number;
  maxKeywordsPerTarget: number;
  errorMessage?: string | null;
  report?: Record<string, any>;
}

interface KeywordingEvent {
  id: string;
  eventType: string;
  message: string;
  createdAt: string;
}

interface KeywordingJobSummary {
  id: string;
  tenantId: string;
  status: string;
  sourceScope: string;
  targetScope: TargetScope;
  applyMode: ApplyMode;
  candidateCount: number;
  serviceCount: number;
  targetCount: number;
  errorMessage: string | null;
  running: boolean;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

interface CandidateRow {
  id: string;
  targetType: 'org_unit' | 'user';
  targetId: string;
  targetLabel: string;
  keyword: string;
  canonicalKeyword: string;
  action: CandidateAction;
  confidence: number;
  reasoning: string;
  serviceEvidence: string;
  stageDeterministic: number;
  stageLlmSeed: number;
  stageLlmAssignment: number;
  stageFinal: number;
}

interface DictionaryRow {
  id: string;
  canonicalKeyword: string;
  synonyms: string;
  category: string;
  active: boolean;
  notes: string;
}

const normalizeText = (value: unknown): string => String(value || '').trim();

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
    second: '2-digit',
  });
};

const formatScore = (value: unknown): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.00';
  return numeric.toFixed(2);
};

const parseServiceEvidence = (evidence: any): string => {
  const serviceIds = Array.isArray(evidence?.serviceIds)
    ? evidence.serviceIds.map((entry: any) => normalizeText(entry)).filter(Boolean)
    : [];
  return serviceIds.length > 0 ? serviceIds.join(', ') : '–';
};

const mapCandidateRow = (input: any): CandidateRow => ({
  id: normalizeText(input?.id),
  targetType: normalizeText(input?.targetType) === 'user' ? 'user' : 'org_unit',
  targetId: normalizeText(input?.targetId),
  targetLabel: normalizeText(input?.evidence?.targetLabel) || normalizeText(input?.targetId),
  keyword: normalizeText(input?.keyword),
  canonicalKeyword: normalizeText(input?.canonicalKeyword) || normalizeText(input?.keyword),
  action: (normalizeText(input?.action) || 'add') as CandidateAction,
  confidence: Number(input?.confidence || 0),
  reasoning: normalizeText(input?.reasoning),
  serviceEvidence: parseServiceEvidence(input?.evidence || {}),
  stageDeterministic: Number(input?.stageScores?.deterministic || 0),
  stageLlmSeed: Number(input?.stageScores?.llmSeed || 0),
  stageLlmAssignment: Number(input?.stageScores?.llmAssignment || 0),
  stageFinal: Number(input?.stageScores?.final || input?.confidence || 0),
});

const mapJobSummary = (input: any): KeywordingJobSummary => {
  const report = input?.report && typeof input.report === 'object' ? input.report : {};
  const status = normalizeText(input?.status);
  return {
    id: normalizeText(input?.id),
    tenantId: normalizeText(input?.tenantId),
    status,
    sourceScope: normalizeText(input?.sourceScope),
    targetScope: (normalizeText(input?.targetScope) || 'both') as TargetScope,
    applyMode: (normalizeText(input?.applyMode) || 'review') as ApplyMode,
    candidateCount: Number(input?.candidateCount || report?.candidateCount || 0),
    serviceCount: Number(report?.serviceCount || 0),
    targetCount: Number(report?.targetCount || 0),
    errorMessage: normalizeText(input?.errorMessage) || null,
    running: input?.running === true || status === 'running',
    createdAt: input?.createdAt || null,
    startedAt: input?.startedAt || null,
    finishedAt: input?.finishedAt || null,
  };
};

const KeywordingAssistant: React.FC = () => {
  const location = useLocation();
  const token = getAdminToken();
  const { isGlobalAdmin, selection, tenants } = useAdminScopeContext();

  const [tenantId, setTenantId] = useState('');
  const [sourceScope, setSourceScope] = useState<'services_all' | 'services_filtered' | 'services_recent_import'>('services_all');
  const [targetScope, setTargetScope] = useState<TargetScope>('both');
  const [includeExistingKeywords, setIncludeExistingKeywords] = useState(true);
  const [applyMode, setApplyMode] = useState<ApplyMode>('review');
  const [minSuggestConfidence, setMinSuggestConfidence] = useState(0.42);
  const [minAutoApplyConfidence, setMinAutoApplyConfidence] = useState(0.82);
  const [maxKeywordsPerTarget, setMaxKeywordsPerTarget] = useState(15);
  const [filteredServiceIdsInput, setFilteredServiceIdsInput] = useState('');

  const [currentJobId, setCurrentJobId] = useState('');
  const [job, setJob] = useState<KeywordingJob | null>(null);
  const [jobEvents, setJobEvents] = useState<KeywordingEvent[]>([]);
  const [candidateRows, setCandidateRows] = useState<CandidateRow[]>([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);

  const [filterTargetType, setFilterTargetType] = useState<'all' | 'org_unit' | 'user'>('all');
  const [filterAction, setFilterAction] = useState<'all' | CandidateAction>('all');
  const [filterMinConfidence, setFilterMinConfidence] = useState(0.2);
  const [filterQuery, setFilterQuery] = useState('');
  const [applyThreshold, setApplyThreshold] = useState(0.82);

  const [dictionaryRows, setDictionaryRows] = useState<DictionaryRow[]>([]);
  const [dictionaryDirty, setDictionaryDirty] = useState(false);
  const [jobHistory, setJobHistory] = useState<KeywordingJobSummary[]>([]);
  const [loadingJobHistory, setLoadingJobHistory] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [loadingDictionary, setLoadingDictionary] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const resolvedTenantId = isGlobalAdmin ? tenantId : selection.tenantId;
  const lastJobStorageKey = useMemo(
    () => (resolvedTenantId ? `keywording:last-job:${resolvedTenantId}` : ''),
    [resolvedTenantId]
  );

  useEffect(() => {
    if (!isGlobalAdmin) {
      setTenantId(selection.tenantId || '');
    }
  }, [isGlobalAdmin, selection.tenantId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const nextTargetType = normalizeText(params.get('targetType')).toLowerCase();
    if (nextTargetType === 'user' || nextTargetType === 'org_unit') {
      setFilterTargetType(nextTargetType);
      setTargetScope(nextTargetType === 'user' ? 'users' : 'org_units');
    }
    const nextTenant = normalizeText(params.get('tenantId'));
    if (isGlobalAdmin && nextTenant) {
      setTenantId(nextTenant);
    }
    const nextQuery = normalizeText(params.get('q') || params.get('targetId'));
    if (nextQuery) {
      setFilterQuery(nextQuery);
    }
  }, [isGlobalAdmin, location.search]);

  const loadDictionary = async (tenant: string) => {
    const targetTenant = normalizeText(tenant);
    if (!targetTenant) return;
    setLoadingDictionary(true);
    try {
      const response = await axios.get('/api/admin/keywording/dictionary', {
        headers,
        params: { tenantId: targetTenant },
      });
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      setDictionaryRows(
        items.map((item: any) => ({
          id: normalizeText(item?.id),
          canonicalKeyword: normalizeText(item?.canonicalKeyword),
          synonyms: Array.isArray(item?.synonyms) ? item.synonyms.join(', ') : '',
          category: normalizeText(item?.category),
          active: item?.active !== false,
          notes: normalizeText(item?.notes),
        }))
      );
      setDictionaryDirty(false);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Keyword-Wörterbuch konnte nicht geladen werden.');
    } finally {
      setLoadingDictionary(false);
    }
  };

  useEffect(() => {
    if (!resolvedTenantId) return;
    void loadDictionary(resolvedTenantId);
  }, [resolvedTenantId]);

  const loadJobHistory = useCallback(
    async (tenant: string, options?: { silent?: boolean }) => {
      const targetTenant = normalizeText(tenant);
      if (!targetTenant) {
        setJobHistory([]);
        return;
      }
      const silent = options?.silent === true;
      if (!silent) setLoadingJobHistory(true);
      try {
        const response = await axios.get('/api/admin/keywording/jobs', {
          headers,
          params: {
            tenantId: targetTenant,
            limit: 50,
            offset: 0,
          },
        });
        const items = Array.isArray(response.data?.items) ? response.data.items : [];
        setJobHistory(items.map((item: any) => mapJobSummary(item)));
      } catch (err: any) {
        if (!silent) {
          setError(err?.response?.data?.message || 'Job-Historie konnte nicht geladen werden.');
        }
      } finally {
        if (!silent) setLoadingJobHistory(false);
      }
    },
    [headers]
  );

  useEffect(() => {
    if (!resolvedTenantId) {
      setCurrentJobId('');
      setJob(null);
      setCandidateRows([]);
      setCandidateTotal(0);
      setSelectedCandidateIds([]);
      setJobHistory([]);
      return;
    }
    const remembered = lastJobStorageKey ? normalizeText(window.localStorage.getItem(lastJobStorageKey)) : '';
    setCurrentJobId(remembered);
    setJob(null);
    setCandidateRows([]);
    setCandidateTotal(0);
    setSelectedCandidateIds([]);
    void loadJobHistory(resolvedTenantId);
  }, [lastJobStorageKey, loadJobHistory, resolvedTenantId]);

  useEffect(() => {
    if (!lastJobStorageKey) return;
    if (currentJobId) {
      window.localStorage.setItem(lastJobStorageKey, currentJobId);
    } else {
      window.localStorage.removeItem(lastJobStorageKey);
    }
  }, [currentJobId, lastJobStorageKey]);

  useEffect(() => {
    if (!currentJobId && jobHistory.length > 0) {
      const preferred =
        jobHistory.find((entry) => entry.running || entry.status === 'draft') ||
        jobHistory[0];
      if (preferred?.id) {
        setCurrentJobId(preferred.id);
      }
    }
  }, [currentJobId, jobHistory]);

  const loadCandidates = async (jobId: string) => {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) return;
    setLoadingCandidates(true);
    try {
      const response = await axios.get(`/api/admin/keywording/jobs/${encodeURIComponent(normalizedJobId)}/candidates`, {
        headers,
        params: {
          limit: 400,
          offset: 0,
          minConfidence: filterMinConfidence,
          targetType: filterTargetType === 'all' ? undefined : filterTargetType,
          action: filterAction === 'all' ? undefined : filterAction,
          q: normalizeText(filterQuery) || undefined,
        },
      });
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      setCandidateRows(items.map((item: any) => mapCandidateRow(item)));
      setCandidateTotal(Number(response.data?.total || items.length));
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Kandidaten konnten nicht geladen werden.');
    } finally {
      setLoadingCandidates(false);
    }
  };

  const loadJob = async (jobId: string) => {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) return;
    try {
      const response = await axios.get(`/api/admin/keywording/jobs/${encodeURIComponent(normalizedJobId)}`, { headers });
      const rawJob = response.data?.job || {};
      const nextJob: KeywordingJob = {
        id: normalizeText(rawJob.id),
        tenantId: normalizeText(rawJob.tenantId),
        status: normalizeText(rawJob.status),
        sourceScope: normalizeText(rawJob.sourceScope),
        targetScope: (normalizeText(rawJob.targetScope) || 'both') as TargetScope,
        includeExistingKeywords: rawJob.includeExistingKeywords !== false,
        applyMode: (normalizeText(rawJob.applyMode) || 'review') as ApplyMode,
        minSuggestConfidence: Number(rawJob.minSuggestConfidence || 0.42),
        minAutoApplyConfidence: Number(rawJob.minAutoApplyConfidence || 0.82),
        maxKeywordsPerTarget: Number(rawJob.maxKeywordsPerTarget || 15),
        errorMessage: normalizeText(rawJob.errorMessage) || null,
        report: rawJob.report || {},
      };
      setJob(nextJob);
      setJobEvents(
        (Array.isArray(response.data?.events) ? response.data.events : []).map((event: any) => ({
          id: normalizeText(event?.id),
          eventType: normalizeText(event?.eventType),
          message: normalizeText(event?.message),
          createdAt: String(event?.createdAt || ''),
        }))
      );
      await loadCandidates(normalizedJobId);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Keywording-Job konnte nicht geladen werden.');
    }
  };

  useEffect(() => {
    if (!currentJobId) return;
    void loadJob(currentJobId);
  }, [currentJobId]);

  useEffect(() => {
    if (!currentJobId) return;
    void loadCandidates(currentJobId);
  }, [currentJobId, filterTargetType, filterAction, filterMinConfidence, filterQuery]);

  useEffect(() => {
    if (!job?.id) return undefined;
    if (!['draft', 'running'].includes(job.status)) return undefined;
    const timer = window.setInterval(() => {
      void loadJob(job.id);
    }, 2400);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!resolvedTenantId) return undefined;
    const hasActive = jobHistory.some((entry) => entry.running || entry.status === 'draft');
    if (!hasActive) return undefined;
    const timer = window.setInterval(() => {
      void loadJobHistory(resolvedTenantId, { silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [jobHistory, loadJobHistory, resolvedTenantId]);

  const handleCreateAndRun = async () => {
    try {
      if (!resolvedTenantId) {
        setError('Bitte zuerst einen Mandanten auswählen.');
        return;
      }
      setLoading(true);
      setError('');
      setSuccess('');

      const createResponse = await axios.post(
        '/api/admin/keywording/jobs',
        {
          tenantId: resolvedTenantId,
          sourceScope,
          targetScope,
          includeExistingKeywords,
          applyMode,
          minSuggestConfidence,
          minAutoApplyConfidence,
          maxKeywordsPerTarget,
          options: {
            serviceIds:
              sourceScope === 'services_filtered'
                ? filteredServiceIdsInput
                    .split(/[,\n;|]+/g)
                    .map((entry) => normalizeText(entry))
                    .filter(Boolean)
                : [],
          },
        },
        { headers }
      );
      const nextJobId = normalizeText(createResponse.data?.job?.id);
      if (!nextJobId) throw new Error('Job-ID fehlt.');

      await axios.post(`/api/admin/keywording/jobs/${encodeURIComponent(nextJobId)}/run`, {}, { headers });
      setCurrentJobId(nextJobId);
      setSelectedCandidateIds([]);
      await Promise.all([loadJob(nextJobId), loadJobHistory(resolvedTenantId, { silent: true })]);
      setSuccess(
        'Schlagwortlauf wurde im Hintergrund gestartet. Du kannst die Seite verlassen und den Job später über die Job-Historie wieder öffnen.'
      );
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Schlagwortlauf konnte nicht gestartet werden.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplySelected = async () => {
    try {
      if (!currentJobId) return;
      if (selectedCandidateIds.length === 0) {
        setError('Bitte mindestens einen Kandidaten auswählen.');
        return;
      }
      setLoading(true);
      setError('');
      setSuccess('');
      await axios.post(
        `/api/admin/keywording/jobs/${encodeURIComponent(currentJobId)}/apply`,
        {
          mode: 'selected',
          selectedCandidateIds,
          preserveManualKeywords: true,
        },
        { headers }
      );
      setSelectedCandidateIds([]);
      await Promise.all([
        loadJob(currentJobId),
        resolvedTenantId ? loadJobHistory(resolvedTenantId, { silent: true }) : Promise.resolve(),
      ]);
      setSuccess('Ausgewählte Kandidaten wurden übernommen.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Ausgewählte Kandidaten konnten nicht übernommen werden.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyThreshold = async () => {
    try {
      if (!currentJobId) return;
      setLoading(true);
      setError('');
      setSuccess('');
      await axios.post(
        `/api/admin/keywording/jobs/${encodeURIComponent(currentJobId)}/apply`,
        {
          mode: 'all_above_threshold',
          thresholdOverride: applyThreshold,
          preserveManualKeywords: true,
        },
        { headers }
      );
      setSelectedCandidateIds([]);
      await Promise.all([
        loadJob(currentJobId),
        resolvedTenantId ? loadJobHistory(resolvedTenantId, { silent: true }) : Promise.resolve(),
      ]);
      setSuccess('Kandidaten oberhalb des Schwellwerts wurden übernommen.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Übernahme nach Schwellwert fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async () => {
    try {
      if (!currentJobId) return;
      setLoading(true);
      setError('');
      setSuccess('');
      await axios.post(`/api/admin/keywording/jobs/${encodeURIComponent(currentJobId)}/revert`, {}, { headers });
      await Promise.all([
        loadJob(currentJobId),
        resolvedTenantId ? loadJobHistory(resolvedTenantId, { silent: true }) : Promise.resolve(),
      ]);
      setSuccess('Übernahmen wurden zurückgesetzt.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Revert fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    try {
      if (!currentJobId) return;
      setLoading(true);
      setError('');
      setSuccess('');
      await axios.post(`/api/admin/keywording/jobs/${encodeURIComponent(currentJobId)}/cancel`, {}, { headers });
      await Promise.all([
        loadJob(currentJobId),
        resolvedTenantId ? loadJobHistory(resolvedTenantId, { silent: true }) : Promise.resolve(),
      ]);
      setSuccess('Job wurde abgebrochen.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Job konnte nicht abgebrochen werden.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenJob = async (jobId: string) => {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) return;
    setCurrentJobId(normalizedJobId);
    setSelectedCandidateIds([]);
    await loadJob(normalizedJobId);
  };

  const handleRunExistingJob = async (jobId: string) => {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) return;
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      await axios.post(`/api/admin/keywording/jobs/${encodeURIComponent(normalizedJobId)}/run`, {}, { headers });
      setCurrentJobId(normalizedJobId);
      setSelectedCandidateIds([]);
      await Promise.all([
        loadJob(normalizedJobId),
        resolvedTenantId ? loadJobHistory(resolvedTenantId, { silent: true }) : Promise.resolve(),
      ]);
      setSuccess('Job erneut gestartet und im Hintergrund ausgeführt.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Job konnte nicht gestartet werden.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyJobId = async (jobId: string) => {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalizedJobId);
        setSuccess(`Job-ID kopiert: ${normalizedJobId}`);
        return;
      }
      throw new Error('Clipboard API nicht verfügbar');
    } catch {
      setError(`Job-ID konnte nicht kopiert werden. Bitte manuell kopieren: ${normalizedJobId}`);
    }
  };

  const handleSaveDictionary = async () => {
    try {
      if (!resolvedTenantId) {
        setError('Bitte einen Mandanten auswählen.');
        return;
      }
      setLoadingDictionary(true);
      setError('');
      setSuccess('');
      await axios.patch(
        '/api/admin/keywording/dictionary',
        {
          tenantId: resolvedTenantId,
          items: dictionaryRows.map((row) => ({
            id: normalizeText(row.id) || undefined,
            canonicalKeyword: normalizeText(row.canonicalKeyword),
            synonyms: normalizeText(row.synonyms)
              .split(',')
              .map((entry) => normalizeText(entry))
              .filter(Boolean),
            category: normalizeText(row.category) || null,
            active: row.active !== false,
            notes: normalizeText(row.notes) || null,
          })),
        },
        { headers }
      );
      await loadDictionary(resolvedTenantId);
      setSuccess('Keyword-Wörterbuch gespeichert.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Keyword-Wörterbuch konnte nicht gespeichert werden.');
    } finally {
      setLoadingDictionary(false);
    }
  };

  const columns = useMemo<SmartTableColumnDef<CandidateRow>[]>(() => {
    return [
      {
        field: 'targetType',
        headerName: 'Zieltyp',
        width: 120,
        valueFormatter: (value) => (String(value) === 'user' ? 'Mitarbeiter' : 'Orga'),
      },
      { field: 'targetLabel', headerName: 'Ziel', flex: 1.2, minWidth: 180 },
      { field: 'targetId', headerName: 'Ziel-ID', width: 170 },
      { field: 'canonicalKeyword', headerName: 'Schlagwort', minWidth: 170, flex: 1 },
      { field: 'action', headerName: 'Aktion', width: 110 },
      {
        field: 'confidence',
        headerName: 'Konfidenz',
        width: 110,
        valueFormatter: (value) => formatScore(value),
      },
      {
        field: 'stageFinal',
        headerName: 'Final',
        width: 100,
        valueFormatter: (value) => formatScore(value),
      },
      {
        field: 'serviceEvidence',
        headerName: 'Service-Evidence',
        minWidth: 200,
        flex: 1.1,
      },
      {
        field: 'reasoning',
        headerName: 'Begründung',
        minWidth: 240,
        flex: 1.5,
      },
    ];
  }, []);

  const historyColumns = useMemo<SmartTableColumnDef<KeywordingJobSummary>[]>(() => {
    return [
      { field: 'id', headerName: 'Job-ID', minWidth: 220, flex: 1 },
      { field: 'status', headerName: 'Status', width: 120 },
      {
        field: 'running',
        headerName: 'Lauf',
        width: 90,
        valueFormatter: (value) => (value ? 'Ja' : 'Nein'),
      },
      {
        field: 'candidateCount',
        headerName: 'Kandidaten',
        width: 120,
      },
      {
        field: 'serviceCount',
        headerName: 'Services',
        width: 100,
      },
      {
        field: 'targetCount',
        headerName: 'Ziele',
        width: 90,
      },
      {
        field: 'finishedAt',
        headerName: 'Beendet',
        minWidth: 170,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'errorMessage',
        headerName: 'Fehler',
        minWidth: 220,
        flex: 1.1,
        valueGetter: (_value, row) => normalizeText(row.errorMessage) || '–',
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 260,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (params) => {
          const row = params.row;
          return (
            <Stack direction="row" spacing={0.5}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  void handleOpenJob(row.id);
                }}
              >
                Öffnen
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<PlayArrowRoundedIcon />}
                disabled={loading || !['draft', 'failed', 'cancelled'].includes(row.status)}
                onClick={() => {
                  void handleRunExistingJob(row.id);
                }}
              >
                Starten
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ContentCopyRoundedIcon />}
                onClick={() => {
                  void handleCopyJobId(row.id);
                }}
              >
                ID
              </Button>
            </Stack>
          );
        },
      },
    ];
  }, [handleCopyJobId, handleOpenJob, handleRunExistingJob, loading]);

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Typography variant="h6" fontWeight={700}>
              Schlagwort-Assistent (Leistungsbasiert)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Mehrstufiger KI-/Regelprozess für Schlagwortvorschläge aus Leistungen mit Review, Konfidenzfilter und revisionssicherer Übernahme.
            </Typography>

            {success ? <Alert severity="success">{success}</Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
              <FormControl size="small" sx={{ minWidth: 260 }}>
                <InputLabel>Mandant</InputLabel>
                <Select
                  label="Mandant"
                  value={resolvedTenantId || ''}
                  onChange={(event) => setTenantId(String(event.target.value || ''))}
                  disabled={!isGlobalAdmin}
                >
                  {(tenants || []).map((tenant) => (
                    <MenuItem key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel>Quelle</InputLabel>
                <Select
                  label="Quelle"
                  value={sourceScope}
                  onChange={(event) =>
                    setSourceScope(event.target.value as 'services_all' | 'services_filtered' | 'services_recent_import')
                  }
                >
                  <MenuItem value="services_all">Alle Leistungen</MenuItem>
                  <MenuItem value="services_recent_import">Letzter Leistungsimport</MenuItem>
                  <MenuItem value="services_filtered">Gefilterte Leistungen</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel>Ziele</InputLabel>
                <Select
                  label="Ziele"
                  value={targetScope}
                  onChange={(event) => setTargetScope(event.target.value as TargetScope)}
                >
                  <MenuItem value="both">Mitarbeiter + Orga</MenuItem>
                  <MenuItem value="users">Nur Mitarbeiter</MenuItem>
                  <MenuItem value="org_units">Nur Orga</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel>Apply-Modus</InputLabel>
                <Select
                  label="Apply-Modus"
                  value={applyMode}
                  onChange={(event) => setApplyMode(event.target.value as ApplyMode)}
                >
                  <MenuItem value="review">Review</MenuItem>
                  <MenuItem value="auto_if_confident">Auto bei hoher Konfidenz</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
              <TextField
                size="small"
                type="number"
                label="Min. Suggest Konfidenz"
                value={minSuggestConfidence}
                onChange={(event) => setMinSuggestConfidence(Number(event.target.value || 0))}
                inputProps={{ min: 0.05, max: 0.99, step: 0.01 }}
              />
              <TextField
                size="small"
                type="number"
                label="Min. Auto-Apply Konfidenz"
                value={minAutoApplyConfidence}
                onChange={(event) => setMinAutoApplyConfidence(Number(event.target.value || 0))}
                inputProps={{ min: 0.05, max: 0.99, step: 0.01 }}
              />
              <TextField
                size="small"
                type="number"
                label="Max Keywords pro Ziel"
                value={maxKeywordsPerTarget}
                onChange={(event) => setMaxKeywordsPerTarget(Number(event.target.value || 0))}
                inputProps={{ min: 1, max: 40, step: 1 }}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={includeExistingKeywords}
                    onChange={(event) => setIncludeExistingKeywords(event.target.checked)}
                  />
                }
                label="Bestehende Schlagworte einbeziehen"
              />
            </Stack>

            {sourceScope === 'services_filtered' ? (
              <TextField
                size="small"
                label="Service-IDs (Komma-getrennt)"
                value={filteredServiceIdsInput}
                onChange={(event) => setFilteredServiceIdsInput(event.target.value)}
                helperText="Optional: Nur diese Service-IDs für den Lauf berücksichtigen."
                placeholder="svc_..., svc_..."
              />
            ) : null}

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button
                variant="contained"
                startIcon={<PlayArrowRoundedIcon />}
                disabled={loading || !resolvedTenantId}
                onClick={() => void handleCreateAndRun()}
              >
                Dry-Run starten
              </Button>
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                disabled={!currentJobId}
                onClick={() => {
                  if (currentJobId) void loadJob(currentJobId);
                }}
              >
                Job aktualisieren
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<CancelRoundedIcon />}
                disabled={!currentJobId || loading}
                onClick={() => void handleCancel()}
              >
                Job abbrechen
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1.2}>
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography variant="subtitle1" fontWeight={700}>
                Hintergrundläufe
              </Typography>
              <Chip size="small" label={`${jobHistory.length} Jobs`} />
              {jobHistory.some((entry) => entry.running || entry.status === 'draft') ? (
                <Chip size="small" color="info" label="Aktive Läufe vorhanden" />
              ) : null}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Läufe sind vom Formular entkoppelt. Du kannst die Seite jederzeit verlassen und später über diese Liste wieder einsteigen.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                disabled={loadingJobHistory || !resolvedTenantId}
                onClick={() => {
                  if (resolvedTenantId) void loadJobHistory(resolvedTenantId);
                }}
              >
                Historie aktualisieren
              </Button>
            </Stack>
            <SmartTable<KeywordingJobSummary>
              tableId="keywording-jobs-history"
              userId={token}
              title="Keywording-Jobs"
              rows={jobHistory}
              columns={historyColumns}
              loading={loadingJobHistory}
              defaultPageSize={10}
              pageSizeOptions={[5, 10, 25, 50]}
            />
          </Stack>
        </CardContent>
      </Card>

      {job ? (
        <Card>
          <CardContent>
            <Stack spacing={1.2}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography variant="subtitle1" fontWeight={700}>
                  Job {job.id}
                </Typography>
                <Chip size="small" label={job.status} color={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'default'} />
                <Chip size="small" label={`Kandidaten: ${candidateTotal}`} />
                {job.report?.fallbackUsed ? <Chip size="small" color="warning" label="Fallback aktiv" /> : null}
                {Number.isFinite(Number(job.report?.llmSeedCount)) ? (
                  <Chip size="small" variant="outlined" label={`LLM Seeds: ${Number(job.report?.llmSeedCount || 0)}`} />
                ) : null}
                {Number.isFinite(Number(job.report?.llmAssignmentCount)) ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`LLM Zuordnungen: ${Number(job.report?.llmAssignmentCount || 0)}`}
                  />
                ) : null}
                {job.errorMessage ? <Chip size="small" color="error" label={job.errorMessage} /> : null}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Letzter Lauf: {formatDateTime(job.report?.finishedAt as string)} · ServiceCount: {job.report?.serviceCount ?? '–'} ·
                TargetCount: {job.report?.targetCount ?? '–'} · Effektive Suggest-Schwelle:{' '}
                {formatScore(job.report?.effectiveMinSuggestConfidence ?? job.report?.minSuggestConfidence ?? job.minSuggestConfidence)} ·
                Fallback-Ziele: {Number(job.report?.fallbackTargetCount || 0)}
              </Typography>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Zieltyp</InputLabel>
                  <Select
                    label="Zieltyp"
                    value={filterTargetType}
                    onChange={(event) => setFilterTargetType(event.target.value as 'all' | 'org_unit' | 'user')}
                  >
                    <MenuItem value="all">Alle</MenuItem>
                    <MenuItem value="org_unit">Orga</MenuItem>
                    <MenuItem value="user">Mitarbeiter</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 170 }}>
                  <InputLabel>Aktion</InputLabel>
                  <Select
                    label="Aktion"
                    value={filterAction}
                    onChange={(event) => setFilterAction(event.target.value as 'all' | CandidateAction)}
                  >
                    <MenuItem value="all">Alle</MenuItem>
                    <MenuItem value="add">add</MenuItem>
                    <MenuItem value="keep">keep</MenuItem>
                    <MenuItem value="remove">remove</MenuItem>
                    <MenuItem value="skip">skip</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  type="number"
                  label="Min. Konfidenz Filter"
                  value={filterMinConfidence}
                  onChange={(event) => setFilterMinConfidence(Number(event.target.value || 0))}
                  inputProps={{ min: 0, max: 1, step: 0.01 }}
                />
                <TextField
                  size="small"
                  label="Suche"
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                />
                <Box sx={{ flexGrow: 1 }} />
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<RefreshRoundedIcon />}
                  disabled={!currentJobId || loadingCandidates}
                  onClick={() => {
                    if (currentJobId) void loadCandidates(currentJobId);
                  }}
                >
                  Kandidaten laden
                </Button>
              </Stack>

              <SmartTable<CandidateRow>
                tableId="keywording-candidates"
                userId={token}
                title="Review-Kandidaten"
                rows={candidateRows}
                columns={columns}
                loading={loadingCandidates}
                checkboxSelection
                selectionModel={selectedCandidateIds}
                onSelectionModelChange={setSelectedCandidateIds}
                defaultPageSize={25}
                pageSizeOptions={[10, 25, 50, 100]}
              />

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<CheckRoundedIcon />}
                  disabled={loading || selectedCandidateIds.length === 0}
                  onClick={() => void handleApplySelected()}
                >
                  Auswahl übernehmen ({selectedCandidateIds.length})
                </Button>
                <TextField
                  size="small"
                  type="number"
                  label="Apply-Schwelle"
                  value={applyThreshold}
                  onChange={(event) => setApplyThreshold(Number(event.target.value || 0))}
                  inputProps={{ min: 0, max: 1, step: 0.01 }}
                  sx={{ maxWidth: 180 }}
                />
                <Button
                  variant="outlined"
                  color="success"
                  startIcon={<CheckRoundedIcon />}
                  disabled={loading || !currentJobId}
                  onClick={() => void handleApplyThreshold()}
                >
                  Alle oberhalb Schwelle übernehmen
                </Button>
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={<UndoRoundedIcon />}
                  disabled={loading || !currentJobId}
                  onClick={() => void handleRevert()}
                >
                  Übernahme zurücksetzen
                </Button>
              </Stack>

              {jobEvents.length > 0 ? (
                <>
                  <Divider />
                  <Typography variant="subtitle2">Job-Verlauf</Typography>
                  <Stack spacing={0.5}>
                    {jobEvents.slice(0, 20).map((entry) => (
                      <Typography key={entry.id} variant="caption" color="text.secondary">
                        [{formatDateTime(entry.createdAt)}] {entry.eventType}: {entry.message}
                      </Typography>
                    ))}
                  </Stack>
                </>
              ) : null}
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          <Stack spacing={1.2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" fontWeight={700}>
                Keyword-Wörterbuch
              </Typography>
              <Chip size="small" label={`${dictionaryRows.length} Einträge`} />
              {dictionaryDirty ? <Chip size="small" color="warning" label="Ungespeicherte Änderungen" /> : null}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Tenant-spezifische Kanonisierung und Synonympflege für den Schlagwortlauf.
            </Typography>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddRoundedIcon />}
                onClick={() => {
                  setDictionaryRows((current) => [
                    {
                      id: '',
                      canonicalKeyword: '',
                      synonyms: '',
                      category: '',
                      active: true,
                      notes: '',
                    },
                    ...current,
                  ]);
                  setDictionaryDirty(true);
                }}
              >
                Eintrag hinzufügen
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                disabled={loadingDictionary || !resolvedTenantId}
                onClick={() => {
                  if (resolvedTenantId) void loadDictionary(resolvedTenantId);
                }}
              >
                Neu laden
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<SaveRoundedIcon />}
                disabled={loadingDictionary || !dictionaryDirty || !resolvedTenantId}
                onClick={() => void handleSaveDictionary()}
              >
                Wörterbuch speichern
              </Button>
            </Stack>

            <Box sx={{ maxHeight: 420, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
              <Stack spacing={1}>
                {dictionaryRows.map((row, index) => (
                  <Stack key={`dict-${index}-${row.id || 'new'}`} direction={{ xs: 'column', md: 'row' }} spacing={1}>
                    <TextField
                      size="small"
                      label="Kanonisch"
                      value={row.canonicalKeyword}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDictionaryRows((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, canonicalKeyword: value } : entry
                          )
                        );
                        setDictionaryDirty(true);
                      }}
                      sx={{ minWidth: 220 }}
                    />
                    <TextField
                      size="small"
                      label="Synonyme (Komma)"
                      value={row.synonyms}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDictionaryRows((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, synonyms: value } : entry
                          )
                        );
                        setDictionaryDirty(true);
                      }}
                      sx={{ minWidth: 260, flex: 1 }}
                    />
                    <TextField
                      size="small"
                      label="Kategorie"
                      value={row.category}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDictionaryRows((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, category: value } : entry
                          )
                        );
                        setDictionaryDirty(true);
                      }}
                      sx={{ minWidth: 180 }}
                    />
                    <TextField
                      size="small"
                      label="Notiz"
                      value={row.notes}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDictionaryRows((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, notes: value } : entry
                          )
                        );
                        setDictionaryDirty(true);
                      }}
                      sx={{ minWidth: 220, flex: 1 }}
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={row.active !== false}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setDictionaryRows((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, active: checked } : entry
                              )
                            );
                            setDictionaryDirty(true);
                          }}
                        />
                      }
                      label="Aktiv"
                    />
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
};

export default KeywordingAssistant;
