import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { getAdminToken } from '../lib/auth';
import { useAdminScopeContext } from '../lib/adminScopeContext';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';

type MemorySource = 'auto' | 'manual';
type ReportType = 'operations' | 'category_workflow' | 'free_analysis';

interface AnalysisMemorySettings {
  enabled: boolean;
  includeInPrompts: boolean;
  autoPersist: boolean;
  maxContextEntries: number;
  maxContextChars: number;
  retentionDays: number;
  additionalInstruction: string;
  maxAutoSummaryChars: number;
}

interface AnalysisMemoryEntry {
  id: string;
  scopeKey: string;
  reportType: ReportType | string;
  source: MemorySource | string;
  summary: string;
  promptInstruction: string | null;
  confidence: number | null;
  reportId: string | null;
  createdByAdminId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  details?: Record<string, unknown> | null;
}

interface SettingsWithSources {
  [key: string]: string;
}

interface MemoryTableRow {
  id: string;
  scopeKey: string;
  reportType: string;
  source: string;
  summary: string;
  confidenceText: string;
  createdAtText: string;
  reportId: string;
  promptInstruction: string;
  detailsPreview: string;
}

const DEFAULT_SETTINGS: AnalysisMemorySettings = {
  enabled: true,
  includeInPrompts: true,
  autoPersist: true,
  maxContextEntries: 8,
  maxContextChars: 5000,
  retentionDays: 365,
  additionalInstruction: '',
  maxAutoSummaryChars: 900,
};

const REPORT_TYPE_OPTIONS: Array<{ value: ReportType; label: string }> = [
  { value: 'operations', label: 'Operatives Lagebild' },
  { value: 'category_workflow', label: 'Kategorien & Workflow' },
  { value: 'free_analysis', label: 'Freie Analyse' },
];

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function formatDateTime(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return '–';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatConfidence(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '–';
  return `${Math.round(Math.max(0, Math.min(1, numeric)) * 100)} %`;
}

const AIMemorySettings: React.FC = () => {
  const token = getAdminToken();
  const { effectiveRole, capabilities } = useAdminScopeContext();
  const capabilitySet = useMemo(
    () => new Set((capabilities || []).map((entry) => String(entry || '').trim())),
    [capabilities]
  );
  const canManage = effectiveRole === 'PLATFORM_ADMIN' && capabilitySet.has('settings.ai.global.manage');
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [settings, setSettings] = useState<AnalysisMemorySettings>(DEFAULT_SETTINGS);
  const [sources, setSources] = useState<SettingsWithSources>({});
  const [entries, setEntries] = useState<AnalysisMemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [addingEntry, setAddingEntry] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [manualScopeKey, setManualScopeKey] = useState('situation-report-stable');
  const [manualReportType, setManualReportType] = useState<ReportType>('operations');
  const [manualSummary, setManualSummary] = useState('');
  const [manualPromptInstruction, setManualPromptInstruction] = useState('');
  const [manualConfidence, setManualConfidence] = useState('');

  const [compressScopeKey, setCompressScopeKey] = useState('situation-report-stable');
  const [compressReportType, setCompressReportType] = useState<'all' | ReportType>('all');
  const [compressDays, setCompressDays] = useState(180);
  const [compressMaxReports, setCompressMaxReports] = useState(14);
  const [compressPromptInstruction, setCompressPromptInstruction] = useState('');

  const loadMemory = useCallback(async () => {
    if (!canManage) return;
    try {
      setLoading(true);
      const response = await axios.get('/api/admin/config/ai/memory', { headers });
      const nextSettings = (response.data?.settings || {}) as Partial<AnalysisMemorySettings>;
      setSettings({
        enabled: nextSettings.enabled !== false,
        includeInPrompts: nextSettings.includeInPrompts !== false,
        autoPersist: nextSettings.autoPersist !== false,
        maxContextEntries: Number(nextSettings.maxContextEntries || DEFAULT_SETTINGS.maxContextEntries),
        maxContextChars: Number(nextSettings.maxContextChars || DEFAULT_SETTINGS.maxContextChars),
        retentionDays: Number(nextSettings.retentionDays || DEFAULT_SETTINGS.retentionDays),
        additionalInstruction: String(nextSettings.additionalInstruction || ''),
        maxAutoSummaryChars: Number(nextSettings.maxAutoSummaryChars || DEFAULT_SETTINGS.maxAutoSummaryChars),
      });
      setSources((response.data?.sources || {}) as SettingsWithSources);
      setEntries(Array.isArray(response.data?.entries) ? (response.data.entries as AnalysisMemoryEntry[]) : []);
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'KI-Gedächtnis konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [canManage, headers]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  const tableRows = useMemo<MemoryTableRow[]>(
    () =>
      (entries || []).map((entry) => ({
        id: String(entry.id || ''),
        scopeKey: normalizeText(entry.scopeKey) || 'situation-report-stable',
        reportType: normalizeText(entry.reportType) || 'operations',
        source: normalizeText(entry.source) || 'auto',
        summary: normalizeText(entry.summary),
        confidenceText: formatConfidence(entry.confidence),
        createdAtText: formatDateTime(entry.createdAt),
        reportId: normalizeText(entry.reportId),
        promptInstruction: normalizeText(entry.promptInstruction),
        detailsPreview: entry.details ? JSON.stringify(entry.details).slice(0, 220) : '',
      })),
    [entries]
  );

  const columns = useMemo<SmartTableColumnDef<MemoryTableRow>[]>(
    () => [
      { field: 'createdAtText', headerName: 'Erstellt', minWidth: 160, width: 170, defaultVisible: true },
      { field: 'scopeKey', headerName: 'Scope', minWidth: 170, width: 190, defaultVisible: true },
      { field: 'reportType', headerName: 'Berichtstyp', minWidth: 170, width: 180, defaultVisible: true },
      {
        field: 'source',
        headerName: 'Quelle',
        minWidth: 120,
        width: 120,
        defaultVisible: true,
        renderCell: (params: any) => (
          <Chip
            size="small"
            color={String(params?.value || '').toLowerCase() === 'manual' ? 'info' : 'default'}
            label={String(params?.value || '').toLowerCase() === 'manual' ? 'manuell' : 'auto'}
          />
        ),
      },
      { field: 'confidenceText', headerName: 'Konfidenz', minWidth: 110, width: 120, defaultVisible: true },
      { field: 'summary', headerName: 'Summary', flex: 1.8, minWidth: 320, defaultVisible: true },
      { field: 'promptInstruction', headerName: 'Prompt-Hinweis', flex: 1.1, minWidth: 220, defaultVisible: true },
      { field: 'reportId', headerName: 'Report-ID', minWidth: 190, width: 210, defaultVisible: false },
      { field: 'detailsPreview', headerName: 'Details', flex: 1.1, minWidth: 220, defaultVisible: false },
      {
        field: 'actions',
        headerName: '',
        type: 'actions',
        width: 74,
        lockVisibility: true,
        getActions: (params: any) => {
          const row = params?.row as MemoryTableRow;
          return [
            <SmartTableRowActions key={`actions-${row.id}`}>
              <SmartTableRowActionButton
                icon={<DeleteOutlineRoundedIcon fontSize="small" />}
                label="Eintrag löschen"
                onClick={() => {
                  void (async () => {
                    try {
                      setDeletingId(row.id);
                      setError('');
                      await axios.delete(`/api/admin/config/ai/memory/entries/${row.id}`, { headers });
                      setMessage('Memory-Eintrag gelöscht.');
                      await loadMemory();
                    } catch (err: any) {
                      setError(err?.response?.data?.message || 'Memory-Eintrag konnte nicht gelöscht werden.');
                    } finally {
                      setDeletingId('');
                    }
                  })();
                }}
                disabled={deletingId === row.id}
                color="danger"
              />
            </SmartTableRowActions>,
          ];
        },
      },
    ],
    [deletingId, headers, loadMemory]
  );

  const kpis = useMemo(
    () => [
      {
        id: 'entries',
        label: 'Memory-Einträge',
        value: entries.length,
      },
      {
        id: 'enabled',
        label: 'Memory aktiv',
        value: settings.enabled ? 'Ja' : 'Nein',
        tone: settings.enabled ? ('success' as const) : ('warning' as const),
      },
      {
        id: 'in-prompts',
        label: 'In Prompts',
        value: settings.includeInPrompts ? 'Ja' : 'Nein',
      },
      {
        id: 'context',
        label: 'Kontextbudget',
        value: `${settings.maxContextEntries} / ${settings.maxContextChars}`,
        hint: 'Einträge / Zeichen',
      },
    ],
    [entries.length, settings.enabled, settings.includeInPrompts, settings.maxContextChars, settings.maxContextEntries]
  );

  const sourceHint = useMemo(() => {
    const tags = Object.entries(sources || {})
      .map(([key, source]) => `${key}: ${source}`)
      .slice(0, 4);
    return tags.join(' · ');
  }, [sources]);

  if (!canManage) {
    return (
      <Stack spacing={2}>
        <Alert severity="warning">
          Der Bereich <strong>KI-Gedächtnis</strong> ist nur für Plattformadmins verfügbar.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <AdminPageHero
        title="KI-Gedächtnis"
        subtitle="Memory-Kontext für das KI-Lagebild zentral steuern, verdichten und revisionssicher verwalten."
        icon={<i className="fa-solid fa-brain" />}
        actions={
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={() => void loadMemory()}
            disabled={loading}
          >
            Neu laden
          </Button>
        }
        badges={[
          { label: 'Nur Plattformadmin', tone: 'info' },
          { label: settings.enabled ? 'Aktiv' : 'Deaktiviert', tone: settings.enabled ? 'success' : 'warning' },
        ]}
      />

      {message ? <Alert severity="success">{message}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <AdminKpiStrip items={kpis} />

      <AdminSurfaceCard
        title="Memory-Einstellungen"
        subtitle="Steuert Persistenz, Prompt-Kontext und Aufbewahrung."
        actions={
          <Button
            variant="contained"
            startIcon={<SaveRoundedIcon />}
            onClick={() => {
              void (async () => {
                try {
                  setSavingSettings(true);
                  setMessage('');
                  setError('');
                  const payload = {
                    ...settings,
                    maxContextEntries: Number(settings.maxContextEntries || 0),
                    maxContextChars: Number(settings.maxContextChars || 0),
                    retentionDays: Number(settings.retentionDays || 0),
                    maxAutoSummaryChars: Number(settings.maxAutoSummaryChars || 0),
                  };
                  const response = await axios.patch('/api/admin/config/ai/memory', payload, { headers });
                  const next = (response.data?.settings || payload) as AnalysisMemorySettings;
                  setSettings(next);
                  setMessage(response.data?.message || 'KI-Gedächtnis gespeichert.');
                  await loadMemory();
                } catch (err: any) {
                  setError(err?.response?.data?.message || 'KI-Gedächtnis konnte nicht gespeichert werden.');
                } finally {
                  setSavingSettings(false);
                }
              })();
            }}
            disabled={savingSettings}
          >
            Speichern
          </Button>
        }
      >
        <Stack spacing={1.2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Switch
                checked={settings.enabled}
                onChange={(_, checked) => setSettings((current) => ({ ...current, enabled: checked }))}
              />
              <Typography variant="body2">Memory aktiv</Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Switch
                checked={settings.includeInPrompts}
                onChange={(_, checked) => setSettings((current) => ({ ...current, includeInPrompts: checked }))}
              />
              <Typography variant="body2">Im Prompt verwenden</Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Switch
                checked={settings.autoPersist}
                onChange={(_, checked) => setSettings((current) => ({ ...current, autoPersist: checked }))}
              />
              <Typography variant="body2">Automatisch persistieren</Typography>
            </Stack>
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
            <TextField
              size="small"
              type="number"
              label="Max Kontext-Einträge"
              value={settings.maxContextEntries}
              onChange={(event) =>
                setSettings((current) => ({ ...current, maxContextEntries: Number(event.target.value || 0) }))
              }
              inputProps={{ min: 1, max: 40 }}
            />
            <TextField
              size="small"
              type="number"
              label="Max Kontext-Zeichen"
              value={settings.maxContextChars}
              onChange={(event) =>
                setSettings((current) => ({ ...current, maxContextChars: Number(event.target.value || 0) }))
              }
              inputProps={{ min: 400, max: 60000 }}
            />
            <TextField
              size="small"
              type="number"
              label="Aufbewahrung (Tage)"
              value={settings.retentionDays}
              onChange={(event) =>
                setSettings((current) => ({ ...current, retentionDays: Number(event.target.value || 0) }))
              }
              inputProps={{ min: 1, max: 3650 }}
            />
            <TextField
              size="small"
              type="number"
              label="Max Auto-Summary (Zeichen)"
              value={settings.maxAutoSummaryChars}
              onChange={(event) =>
                setSettings((current) => ({ ...current, maxAutoSummaryChars: Number(event.target.value || 0) }))
              }
              inputProps={{ min: 200, max: 4000 }}
            />
          </Stack>
          <TextField
            size="small"
            label="Zusatzanweisung für Memory-Verwendung"
            value={settings.additionalInstruction}
            onChange={(event) =>
              setSettings((current) => ({ ...current, additionalInstruction: event.target.value }))
            }
            multiline
            minRows={2}
          />
          {sourceHint ? (
            <Typography variant="caption" color="text.secondary">
              Quellen: {sourceHint}
            </Typography>
          ) : null}
        </Stack>
      </AdminSurfaceCard>

      <AdminSurfaceCard
        title="Manueller Eintrag"
        subtitle="Einzelne Leitgedanken direkt ins KI-Gedächtnis schreiben."
        actions={
          <Button
            variant="outlined"
            startIcon={<AddRoundedIcon />}
            onClick={() => {
              void (async () => {
                try {
                  if (!normalizeText(manualSummary)) {
                    setError('Summary ist erforderlich.');
                    return;
                  }
                  setAddingEntry(true);
                  setError('');
                  setMessage('');
                  const confidenceNumeric = Number(manualConfidence);
                  const payload: Record<string, unknown> = {
                    scopeKey: normalizeText(manualScopeKey) || 'situation-report-stable',
                    reportType: manualReportType,
                    summary: normalizeText(manualSummary),
                    promptInstruction: normalizeText(manualPromptInstruction) || undefined,
                  };
                  if (Number.isFinite(confidenceNumeric)) {
                    payload.confidence = Math.max(0, Math.min(1, confidenceNumeric));
                  }
                  const response = await axios.post('/api/admin/config/ai/memory/entries', payload, { headers });
                  setMessage(response.data?.message || 'Memory-Eintrag erstellt.');
                  setManualSummary('');
                  setManualPromptInstruction('');
                  setManualConfidence('');
                  await loadMemory();
                } catch (err: any) {
                  setError(err?.response?.data?.message || 'Memory-Eintrag konnte nicht erstellt werden.');
                } finally {
                  setAddingEntry(false);
                }
              })();
            }}
            disabled={addingEntry}
          >
            Eintrag anlegen
          </Button>
        }
      >
        <Stack spacing={1.2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
            <TextField
              size="small"
              label="Scope-Key"
              value={manualScopeKey}
              onChange={(event) => setManualScopeKey(event.target.value)}
            />
            <TextField
              size="small"
              select
              label="Berichtstyp"
              value={manualReportType}
              onChange={(event) => setManualReportType(event.target.value as ReportType)}
              sx={{ minWidth: 220 }}
            >
              {REPORT_TYPE_OPTIONS.map((option) => (
                <MenuItem key={`manual-report-${option.value}`} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="number"
              label="Konfidenz (0..1)"
              value={manualConfidence}
              onChange={(event) => setManualConfidence(event.target.value)}
              inputProps={{ min: 0, max: 1, step: 0.01 }}
            />
          </Stack>
          <TextField
            size="small"
            label="Summary"
            value={manualSummary}
            onChange={(event) => setManualSummary(event.target.value)}
            multiline
            minRows={3}
          />
          <TextField
            size="small"
            label="Prompt-Hinweis (optional)"
            value={manualPromptInstruction}
            onChange={(event) => setManualPromptInstruction(event.target.value)}
            multiline
            minRows={2}
          />
        </Stack>
      </AdminSurfaceCard>

      <AdminSurfaceCard
        title="Historie verdichten"
        subtitle="Verdichtet historische Lagebildläufe zu einem stabilen Memory-Eintrag."
        actions={
          <Button
            variant="outlined"
            startIcon={<AutoFixHighRoundedIcon />}
            onClick={() => {
              void (async () => {
                try {
                  setCompressing(true);
                  setError('');
                  setMessage('');
                  const payload: Record<string, unknown> = {
                    scopeKey: normalizeText(compressScopeKey) || 'situation-report-stable',
                    days: Number(compressDays || 180),
                    maxReports: Number(compressMaxReports || 14),
                    promptInstruction: normalizeText(compressPromptInstruction) || undefined,
                  };
                  if (compressReportType !== 'all') payload.reportType = compressReportType;
                  const response = await axios.post('/api/admin/config/ai/memory/compress-history', payload, { headers });
                  setMessage(response.data?.message || 'Historie erfolgreich verdichtet.');
                  await loadMemory();
                } catch (err: any) {
                  setError(err?.response?.data?.message || 'Historie konnte nicht verdichtet werden.');
                } finally {
                  setCompressing(false);
                }
              })();
            }}
            disabled={compressing}
          >
            Verdichtung starten
          </Button>
        }
      >
        <Stack spacing={1.2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
            <TextField
              size="small"
              label="Scope-Key"
              value={compressScopeKey}
              onChange={(event) => setCompressScopeKey(event.target.value)}
            />
            <TextField
              size="small"
              select
              label="Berichtstyp-Filter"
              value={compressReportType}
              onChange={(event) => setCompressReportType(event.target.value as 'all' | ReportType)}
              sx={{ minWidth: 240 }}
            >
              <MenuItem value="all">Alle Berichtstypen</MenuItem>
              {REPORT_TYPE_OPTIONS.map((option) => (
                <MenuItem key={`compress-report-${option.value}`} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="number"
              label="Zeitraum (Tage)"
              value={compressDays}
              onChange={(event) => setCompressDays(Number(event.target.value || 0))}
              inputProps={{ min: 1, max: 3650 }}
            />
            <TextField
              size="small"
              type="number"
              label="Max Reports"
              value={compressMaxReports}
              onChange={(event) => setCompressMaxReports(Number(event.target.value || 0))}
              inputProps={{ min: 2, max: 80 }}
            />
          </Stack>
          <TextField
            size="small"
            label="Zusatzanweisung für Verdichtung (optional)"
            value={compressPromptInstruction}
            onChange={(event) => setCompressPromptInstruction(event.target.value)}
            multiline
            minRows={2}
          />
        </Stack>
      </AdminSurfaceCard>

      <AdminSurfaceCard title="Memory-Einträge" subtitle="Review, Filter und selektives Aufräumen im SmartTable-Layout.">
        <SmartTable<MemoryTableRow>
          tableId="ai-memory-entries"
          rows={tableRows}
          columns={columns}
          title="KI-Gedächtnis"
          loading={loading}
          defaultPageSize={25}
          pageSizeOptions={[10, 25, 50, 100]}
          toolbarEndActions={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip size="small" label={`Einträge: ${tableRows.length}`} />
            </Box>
          }
        />
      </AdminSurfaceCard>
    </Stack>
  );
};

export default AIMemorySettings;
