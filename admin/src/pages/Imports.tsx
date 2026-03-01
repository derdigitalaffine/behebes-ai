import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import PreviewRoundedIcon from '@mui/icons-material/PreviewRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { getAdminToken } from '../lib/auth';
import { useAdminScopeContext } from '../lib/adminScopeContext';

type ImportKind = 'users' | 'org_units' | 'services';
type OrgTypeStrategy = 'single' | 'csv_column' | 'infer_from_name';
type OrgTypeMatchMode = 'key' | 'label' | 'both';

interface ImportTemplateConfig {
  matchFields: string[];
  selectedFields: string[];
  orgTypeKey?: string;
  orgTypeLabel?: string;
  orgTypeStrategy?: OrgTypeStrategy;
  orgTypeMatchMode?: OrgTypeMatchMode;
  orgTypeStripNumbers?: boolean;
  orgTypeRenameMap?: Record<string, string>;
}

interface ImportJobSnapshot {
  id: string;
  status: string;
  running?: boolean;
  preview?: Record<string, any>;
  report?: Record<string, any>;
  events?: Array<{
    id: string;
    eventType: string;
    message: string;
    createdAt: string;
  }>;
}

interface ImportFieldRow {
  id: string;
  field: string;
  label: string;
  selected: boolean;
}

interface PreviewSmartRow {
  id: string;
  rowIndex: number;
  action: string;
  identifier: string;
  matchedIdsText: string;
  changeCount: number;
  summary: string;
  diffRows: Array<{ field: string; current: any; incoming: any; changed: boolean }>;
}

interface DiffSmartRow {
  id: string;
  field: string;
  label: string;
  current: string;
  incoming: string;
  changed: boolean;
}

const KIND_OPTIONS: Array<{ value: ImportKind; label: string }> = [
  { value: 'users', label: 'Benutzer (Mitarbeiter)' },
  { value: 'org_units', label: 'Organisationsstruktur' },
  { value: 'services', label: 'Leistungen' },
];

const BOOL_OPTIONS = [
  { value: '1', label: 'Ja' },
  { value: '0', label: 'Nein' },
];

const FIELD_LABELS: Record<string, string> = {
  external_person_id: 'Externe Personal-ID',
  username: 'Benutzername',
  email: 'Login-E-Mail',
  salutation: 'Anrede',
  title: 'Titel',
  first_name: 'Vorname',
  last_name: 'Nachname',
  job_title: 'Positionsbezeichnung',
  work_phone: 'Telefon (primär)',
  building: 'Gebäude',
  floor: 'Stockwerk',
  room: 'Zimmer / Raum',
  position_slot: 'Stelle',
  function_text: 'Funktion',
  tasks_text: 'Aufgaben',
  notes_text: 'Sonstige Angaben',
  phone_public: 'Telefon (öffentlich)',
  phone_contact: 'Telefon (Kontakt)',
  fax_public: 'Fax (öffentlich)',
  fax_contact: 'Fax (Kontakt)',
  mobile_public: 'Mobil (öffentlich)',
  mobile_contact: 'Mobil (Kontakt)',
  email_public: 'E-Mail (öffentlich)',
  email_contact: 'E-Mail (Kontakt)',
  website_public: 'Website (öffentlich)',
  website_contact: 'Website (Kontakt)',
  postal_street: 'Postadresse Straße',
  postal_house_number: 'Postadresse Hausnr.',
  postal_postal_code: 'Postadresse PLZ',
  postal_city: 'Postadresse Ort',
  postal_address_supplement: 'Postadresse Zusatz',
  postal_elevator_available: 'Postadresse Aufzug',
  postal_wheelchair_accessible: 'Postadresse Rollstuhlgeeignet',
  postbox_postal_code: 'Postfach PLZ',
  postbox_city: 'Postfach Ort',
  postbox_number: 'Postfach Nummer',
  postbox_elevator_available: 'Postfach Aufzug',
  postbox_wheelchair_accessible: 'Postfach Rollstuhlgeeignet',
  visitor_street: 'Besucheradresse Straße',
  visitor_house_number: 'Besucheradresse Hausnr.',
  visitor_postal_code: 'Besucheradresse PLZ',
  visitor_city: 'Besucheradresse Ort',
  visitor_address_supplement: 'Besucheradresse Zusatz',
  visitor_elevator_available: 'Besucheradresse Aufzug',
  visitor_wheelchair_accessible: 'Besucheradresse Rollstuhlgeeignet',
  delivery_street: 'Lieferadresse Straße',
  delivery_house_number: 'Lieferadresse Hausnr.',
  delivery_postal_code: 'Lieferadresse PLZ',
  delivery_city: 'Lieferadresse Ort',
  delivery_address_supplement: 'Lieferadresse Zusatz',
  delivery_elevator_available: 'Lieferadresse Aufzug',
  delivery_wheelchair_accessible: 'Lieferadresse Rollstuhlgeeignet',
  org_unit_names_text: 'Orga-Einheiten (Namen)',
  assignment_keywords_json: 'Schlagworte',
  profile_data_json: 'Original-/Profildaten (JSON)',
  name: 'Name',
  contact_email: 'Kontakt-E-Mail',
  metadata_json: 'Metadaten (JSON)',
  external_ref: 'Externe Referenz',
  type_id: 'Organisationseinheitstyp',
  typeKey: 'Typ-Key (aufgelöst)',
  typeLabel: 'Typ-Label (aufgelöst)',
  type_key: 'Typ-Key (CSV)',
  type_label: 'Typ-Label (CSV)',
  sourceTypeKey: 'Quelltyp-Key',
  sourceTypeLabel: 'Quelltyp-Label',
  parent_external_ref: 'Elterneinheit (Ref)',
  description_html: 'Beschreibung',
  publication_status: 'Veröffentlichungsstatus',
  chatbot_relevant: 'Chatbot-relevant',
  appointment_allowed: 'Termin erlaubt',
  leika_key: 'LeiKa-Schlüssel',
  ozg_services_json: 'OZG-Leistungen',
  ozg_relevant: 'OZG-relevant',
  org_unit_links: 'Orga-Verknüpfungen',
  admin_user_links: 'Mitarbeiter-Verknüpfungen',
  form_links: 'Formular-Verknüpfungen',
};

function toYesNo(value: boolean): '1' | '0' {
  return value ? '1' : '0';
}

function fromYesNo(value: unknown): boolean {
  return String(value || '0') === '1';
}

function getFieldLabel(field: string): string {
  const key = String(field || '').trim();
  if (!key) return '—';
  return FIELD_LABELS[key] || key;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim() || '—';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseRenameMapText(raw: string): Record<string, string> {
  const lines = String(raw || '')
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const out: Record<string, string> = {};
  for (const line of lines) {
    let separator = '';
    if (line.includes('=>')) separator = '=>';
    else if (line.includes('=')) separator = '=';
    else if (line.includes(':')) separator = ':';
    if (!separator) continue;

    const pair = line.split(separator);
    if (pair.length < 2) continue;
    const source = String(pair[0] || '').trim();
    const target = String(pair.slice(1).join(separator) || '').trim();
    if (!source || !target) continue;
    out[source] = target;
  }
  return out;
}

function formatRenameMapText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const entries = Object.entries(value as Record<string, string>)
    .map(([source, target]) => `${String(source || '').trim()} => ${String(target || '').trim()}`)
    .filter((entry) => !entry.startsWith(' =>') && !entry.endsWith('=>'));
  return entries.join('\n');
}

const Imports: React.FC = () => {
  const token = getAdminToken();
  const { selection, isGlobalAdmin, tenants } = useAdminScopeContext();
  const [kind, setKind] = useState<ImportKind>('users');
  const [tenantId, setTenantId] = useState('');
  const [template, setTemplate] = useState<ImportTemplateConfig | null>(null);
  const [matchFields, setMatchFields] = useState<string[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [autoAssignOrgScopes, setAutoAssignOrgScopes] = useState(true);
  const [sendInvites, setSendInvites] = useState(false);
  const [orgTypeKey, setOrgTypeKey] = useState('fachbereich');
  const [orgTypeLabel, setOrgTypeLabel] = useState('Fachbereich');
  const [orgTypeStrategy, setOrgTypeStrategy] = useState<OrgTypeStrategy>('csv_column');
  const [orgTypeMatchMode, setOrgTypeMatchMode] = useState<OrgTypeMatchMode>('both');
  const [orgTypeStripNumbers, setOrgTypeStripNumbers] = useState(true);
  const [orgTypeRenameMapText, setOrgTypeRenameMapText] = useState('');
  const [triggerKeywordingAfterImport, setTriggerKeywordingAfterImport] = useState(true);
  const [keywordingTargetScope, setKeywordingTargetScope] = useState<'both' | 'org_units' | 'users'>('both');
  const [keywordingApplyMode, setKeywordingApplyMode] = useState<'review' | 'auto_if_confident'>('review');
  const [keywordingMinSuggestConfidence, setKeywordingMinSuggestConfidence] = useState(0.42);
  const [keywordingMinAutoApplyConfidence, setKeywordingMinAutoApplyConfidence] = useState(0.82);
  const [keywordingMaxKeywordsPerTarget, setKeywordingMaxKeywordsPerTarget] = useState(15);
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJobSnapshot | null>(null);
  const [assistResult, setAssistResult] = useState<Record<string, any> | null>(null);
  const [activePreviewRow, setActivePreviewRow] = useState<PreviewSmartRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const resolvedTenantId = isGlobalAdmin ? tenantId : selection.tenantId;

  const loadTemplate = async (nextKind: ImportKind) => {
    try {
      const response = await axios.get(`/api/admin/imports/templates/${nextKind}`, { headers });
      const tpl = (response.data?.template || {}) as ImportTemplateConfig;
      setTemplate(tpl);
      setMatchFields(Array.isArray(tpl.matchFields) ? tpl.matchFields : []);
      setSelectedFields(Array.isArray(tpl.selectedFields) ? tpl.selectedFields : []);
      setOrgTypeKey(String(tpl.orgTypeKey || 'fachbereich'));
      setOrgTypeLabel(String(tpl.orgTypeLabel || 'Fachbereich'));
      setOrgTypeStrategy((tpl.orgTypeStrategy as OrgTypeStrategy) || 'csv_column');
      setOrgTypeMatchMode((tpl.orgTypeMatchMode as OrgTypeMatchMode) || 'both');
      setOrgTypeStripNumbers(tpl.orgTypeStripNumbers !== false);
      setOrgTypeRenameMapText(formatRenameMapText(tpl.orgTypeRenameMap));
    } catch {
      setTemplate(null);
      setMatchFields([]);
      setSelectedFields([]);
      setOrgTypeStrategy('csv_column');
      setOrgTypeMatchMode('both');
      setOrgTypeStripNumbers(true);
      setOrgTypeRenameMapText('');
    }
  };

  useEffect(() => {
    if (!isGlobalAdmin) {
      setTenantId(selection.tenantId || '');
    }
  }, [isGlobalAdmin, selection.tenantId]);

  useEffect(() => {
    void loadTemplate(kind);
  }, [kind]);

  useEffect(() => {
    if (!job?.id) return;
    if (!job.running && job.status !== 'running') return;
    const timer = window.setInterval(() => {
      void refreshJob(job.id);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.running, job?.status]);

  const refreshJob = async (jobId: string) => {
    try {
      const response = await axios.get(`/api/admin/imports/${jobId}`, { headers });
      setJob({
        id: response.data?.job?.id || jobId,
        status: String(response.data?.job?.status || ''),
        running: !!response.data?.running,
        preview: response.data?.preview || {},
        report: response.data?.report || {},
        events: Array.isArray(response.data?.events) ? response.data.events : [],
      });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Jobstatus konnte nicht geladen werden.');
    }
  };

  const buildImportOptions = () => ({
    matchFields,
    selectedFields,
    autoAssignOrgScopes,
    sendInvites,
    orgTypeKey,
    orgTypeLabel,
    orgTypeStrategy,
    orgTypeMatchMode,
    orgTypeStripNumbers,
    orgTypeRenameMap: parseRenameMapText(orgTypeRenameMapText),
    triggerKeywordingAfterImport,
    keywordingTargetScope,
    keywordingApplyMode,
    keywordingMinSuggestConfidence,
    keywordingMinAutoApplyConfidence,
    keywordingMaxKeywordsPerTarget,
  });

  const createJob = async (): Promise<string | null> => {
    if (!resolvedTenantId) {
      setError('Bitte Mandant auswählen.');
      return null;
    }
    const response = await axios.post(
      '/api/admin/imports',
      {
        kind,
        tenantId: resolvedTenantId,
        options: buildImportOptions(),
      },
      { headers }
    );
    const id = String(response.data?.id || '').trim();
    if (!id) return null;
    return id;
  };

  const handleUploadAndPreview = async () => {
    try {
      if (!file) {
        setError('Bitte zuerst eine CSV-Datei auswählen.');
        return;
      }
      setLoading(true);
      setError('');
      setMessage('');
      setAssistResult(null);
      setActivePreviewRow(null);

      const jobId = (job?.id && job.id.trim()) || (await createJob());
      if (!jobId) throw new Error('Importjob konnte nicht erstellt werden.');

      const form = new FormData();
      form.append('file', file);
      await axios.post(`/api/admin/imports/${jobId}/upload`, form, {
        headers: {
          ...headers,
          'Content-Type': 'multipart/form-data',
        },
      });

      await axios.post(
        `/api/admin/imports/${jobId}/preview`,
        {
          options: buildImportOptions(),
        },
        { headers }
      );
      await refreshJob(jobId);
      setMessage('Vorschau erstellt. Änderungen können jetzt pro Zeile geprüft werden.');
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Upload/Vorschau fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    try {
      const jobId = (job?.id && job.id.trim()) || (await createJob());
      if (!jobId) throw new Error('Importjob konnte nicht erstellt werden.');
      setLoading(true);
      setError('');
      setMessage('');
      await axios.post(
        `/api/admin/imports/${jobId}/execute`,
        {
          options: buildImportOptions(),
        },
        { headers }
      );
      await refreshJob(jobId);
      setMessage('Import gestartet. Status wird laufend aktualisiert.');
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Importstart fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  };

  const runAssist = async (kindKey: 'mapping' | 'keywords' | 'scope-assignment') => {
    try {
      if (!job?.id) {
        setError('Bitte zuerst Job mit Vorschau erstellen.');
        return;
      }
      setLoading(true);
      setError('');
      const response = await axios.post(`/api/admin/imports/${job.id}/assist/${kindKey}`, {}, { headers });
      setAssistResult(response.data || null);
      setMessage(`Assistenz (${kindKey}) ausgeführt.`);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Assistenz konnte nicht ausgeführt werden.');
    } finally {
      setLoading(false);
    }
  };

  const fieldMatchRows = useMemo<ImportFieldRow[]>(
    () =>
      (template?.matchFields || []).map((field) => ({
        id: field,
        field,
        label: getFieldLabel(field),
        selected: matchFields.includes(field),
      })),
    [template?.matchFields, matchFields]
  );

  const fieldSelectedRows = useMemo<ImportFieldRow[]>(
    () =>
      (template?.selectedFields || []).map((field) => ({
        id: field,
        field,
        label: getFieldLabel(field),
        selected: selectedFields.includes(field),
      })),
    [template?.selectedFields, selectedFields]
  );

  const sampleRows = Array.isArray(job?.preview?.sampleRows) ? job?.preview?.sampleRows : [];
  const previewRows = useMemo<PreviewSmartRow[]>(() => {
    return sampleRows.slice(0, 300).map((row: any, index: number) => {
      const mapped = (row?.mapped || {}) as Record<string, any>;
      const identifier =
        stringifyValue(mapped.externalId) !== '—'
          ? stringifyValue(mapped.externalId)
          : stringifyValue(mapped.email) !== '—'
          ? stringifyValue(mapped.email)
          : stringifyValue(mapped.username) !== '—'
          ? stringifyValue(mapped.username)
          : stringifyValue(mapped.externalRef) !== '—'
          ? stringifyValue(mapped.externalRef)
          : stringifyValue(mapped.name) !== '—'
          ? stringifyValue(mapped.name)
          : `Zeile ${Number(row?.rowIndex || index + 2)}`;

      const summaryParts = Object.entries(mapped)
        .slice(0, 8)
        .map(([key, value]) => `${getFieldLabel(key)}: ${stringifyValue(value)}`);

      return {
        id: `preview-${Number(row?.rowIndex || index + 2)}`,
        rowIndex: Number(row?.rowIndex || index + 2),
        action: String(row?.action || '—'),
        identifier,
        matchedIdsText: Array.isArray(row?.matchedIds) ? row.matchedIds.join(', ') : '',
        changeCount: Number(row?.changeCount || 0),
        summary: summaryParts.join(' | '),
        diffRows: Array.isArray(row?.diffRows) ? row.diffRows : [],
      };
    });
  }, [sampleRows]);

  const counters = (job?.preview?.counters || job?.report?.counters || {}) as Record<string, number>;
  const events = Array.isArray(job?.events) ? job.events : [];

  const fieldColumns = useMemo<SmartTableColumnDef<ImportFieldRow>[]>(
    () => [
      { field: 'label', headerName: 'Feld', flex: 1.1, minWidth: 220, defaultVisible: true },
      { field: 'field', headerName: 'Technischer Schlüssel', flex: 1, minWidth: 220, defaultVisible: true },
      {
        field: 'selected',
        headerName: 'Aktiv',
        width: 110,
        defaultVisible: true,
        valueFormatter: (value: any) => (value ? 'Ja' : 'Nein'),
      },
    ],
    []
  );

  const previewColumns = useMemo<SmartTableColumnDef<PreviewSmartRow>[]>(
    () => [
      { field: 'rowIndex', headerName: 'Zeile', width: 90, type: 'number', defaultVisible: true },
      { field: 'action', headerName: 'Aktion', width: 120, defaultVisible: true },
      { field: 'identifier', headerName: 'Identifikator', flex: 0.9, minWidth: 180, defaultVisible: true },
      { field: 'matchedIdsText', headerName: 'Treffer', flex: 1, minWidth: 180, defaultVisible: true },
      { field: 'changeCount', headerName: 'Änderungen', width: 120, type: 'number', defaultVisible: true },
      { field: 'summary', headerName: 'Vorschau', flex: 2, minWidth: 360, defaultVisible: true },
      {
        field: 'actions',
        headerName: '',
        type: 'actions',
        width: 74,
        lockVisibility: true,
        getActions: (params: any) => {
          const row = params?.row as PreviewSmartRow;
          return [
            <SmartTableRowActions key={`actions-${row.id}`}>
              <SmartTableRowActionButton
                icon={<VisibilityOutlinedIcon fontSize="small" />}
                label="Änderungen prüfen"
                onClick={() => setActivePreviewRow(row)}
                disabled={row.action !== 'update' || (row.diffRows || []).length === 0}
              />
            </SmartTableRowActions>,
          ];
        },
      },
    ],
    []
  );

  const diffRows = useMemo<DiffSmartRow[]>(() => {
    if (!activePreviewRow) return [];
    return (activePreviewRow.diffRows || []).map((entry, index) => ({
      id: `diff-${activePreviewRow.id}-${index}`,
      field: entry.field,
      label: getFieldLabel(entry.field),
      current: stringifyValue(entry.current),
      incoming: stringifyValue(entry.incoming),
      changed: !!entry.changed,
    }));
  }, [activePreviewRow]);

  const diffColumns = useMemo<SmartTableColumnDef<DiffSmartRow>[]>(
    () => [
      { field: 'label', headerName: 'Feld', flex: 1, minWidth: 220, defaultVisible: true },
      { field: 'current', headerName: 'Aktuell', flex: 1.1, minWidth: 220, defaultVisible: true },
      { field: 'incoming', headerName: 'CSV-Wert', flex: 1.1, minWidth: 220, defaultVisible: true },
      {
        field: 'changed',
        headerName: 'Ändert sich',
        width: 120,
        defaultVisible: true,
        valueFormatter: (value: any) => (value ? 'Ja' : 'Nein'),
      },
      { field: 'field', headerName: 'Key', width: 220, defaultVisible: false },
    ],
    []
  );

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6" fontWeight={700}>
                CSV-Import (mandantenbezogen)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Benutzer-, Organisationsstruktur- und Leistungsimporte mit SmartTable-Vorschau, Update-Matching und prüfbarem Zwischendialog.
              </Typography>
            </Box>

            {message ? <Alert severity="success">{message}</Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
              <FormControl size="small" sx={{ minWidth: 260 }}>
                <InputLabel>Importtyp</InputLabel>
                <Select
                  label="Importtyp"
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as ImportKind);
                    setJob(null);
                    setAssistResult(null);
                    setActivePreviewRow(null);
                  }}
                >
                  {KIND_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

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
            </Stack>

            {kind === 'org_units' ? (
              <Stack spacing={1.2}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                  <FormControl size="small" sx={{ minWidth: 240 }}>
                    <InputLabel>Typ-Ermittlung</InputLabel>
                    <Select
                      label="Typ-Ermittlung"
                      value={orgTypeStrategy}
                      onChange={(event) => setOrgTypeStrategy(event.target.value as OrgTypeStrategy)}
                    >
                      <MenuItem value="csv_column">Aus CSV-Spalte</MenuItem>
                      <MenuItem value="infer_from_name">Aus Namen ableiten</MenuItem>
                      <MenuItem value="single">Einheitlicher Typ</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 240 }}>
                    <InputLabel>Typ-Matching</InputLabel>
                    <Select
                      label="Typ-Matching"
                      value={orgTypeMatchMode}
                      onChange={(event) => setOrgTypeMatchMode(event.target.value as OrgTypeMatchMode)}
                    >
                      <MenuItem value="both">Key + Label</MenuItem>
                      <MenuItem value="key">Nur Key</MenuItem>
                      <MenuItem value="label">Nur Label</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 220 }}>
                    <InputLabel>Nummern im Typ entfernen</InputLabel>
                    <Select
                      label="Nummern im Typ entfernen"
                      value={toYesNo(orgTypeStripNumbers)}
                      onChange={(event) => setOrgTypeStripNumbers(fromYesNo(event.target.value))}
                    >
                      {BOOL_OPTIONS.map((option) => (
                        <MenuItem key={`strip-numbers-${option.value}`} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                  <TextField
                    size="small"
                    label="Fallback Typ-Key"
                    value={orgTypeKey}
                    onChange={(event) => setOrgTypeKey(event.target.value)}
                  />
                  <TextField
                    size="small"
                    label="Fallback Typ-Label"
                    value={orgTypeLabel}
                    onChange={(event) => setOrgTypeLabel(event.target.value)}
                  />
                </Stack>
                <TextField
                  size="small"
                  label="Typ-Umbenennung nach Import (pro Zeile)"
                  value={orgTypeRenameMapText}
                  onChange={(event) => setOrgTypeRenameMapText(event.target.value)}
                  multiline
                  minRows={3}
                  placeholder={'Abteilung => Fachbereich\nReferat => Stabsstelle'}
                  helperText="Format je Zeile: Quelle => Ziel. Wird vor dem Typ-Matching angewendet."
                />
              </Stack>
            ) : null}

            {kind === 'users' ? (
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                <FormControl size="small" sx={{ minWidth: 300 }}>
                  <InputLabel>Org-Scope automatisch zuordnen</InputLabel>
                  <Select
                    label="Org-Scope automatisch zuordnen"
                    value={toYesNo(autoAssignOrgScopes)}
                    onChange={(event) => setAutoAssignOrgScopes(fromYesNo(event.target.value))}
                  >
                    {BOOL_OPTIONS.map((option) => (
                      <MenuItem key={`auto-org-${option.value}`} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 300 }}>
                  <InputLabel>Einladungs-Mails senden</InputLabel>
                  <Select
                    label="Einladungs-Mails senden"
                    value={toYesNo(sendInvites)}
                    onChange={(event) => setSendInvites(fromYesNo(event.target.value))}
                  >
                    {BOOL_OPTIONS.map((option) => (
                      <MenuItem key={`invite-${option.value}`} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            ) : null}

            {kind === 'services' ? (
              <Stack spacing={1.2}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                  <FormControl size="small" sx={{ minWidth: 360 }}>
                    <InputLabel>Nach Import Schlagwort-Folgejob</InputLabel>
                    <Select
                      label="Nach Import Schlagwort-Folgejob"
                      value={toYesNo(triggerKeywordingAfterImport)}
                      onChange={(event) => setTriggerKeywordingAfterImport(fromYesNo(event.target.value))}
                    >
                      {BOOL_OPTIONS.map((option) => (
                        <MenuItem key={`keywording-${option.value}`} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
                {triggerKeywordingAfterImport ? (
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                      <InputLabel>Keywording-Target</InputLabel>
                      <Select
                        label="Keywording-Target"
                        value={keywordingTargetScope}
                        onChange={(event) => setKeywordingTargetScope(event.target.value as 'both' | 'org_units' | 'users')}
                      >
                        <MenuItem value="both">Mitarbeiter + Orga</MenuItem>
                        <MenuItem value="org_units">Nur Orga</MenuItem>
                        <MenuItem value="users">Nur Mitarbeiter</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                      <InputLabel>Apply-Modus</InputLabel>
                      <Select
                        label="Apply-Modus"
                        value={keywordingApplyMode}
                        onChange={(event) => setKeywordingApplyMode(event.target.value as 'review' | 'auto_if_confident')}
                      >
                        <MenuItem value="review">Review</MenuItem>
                        <MenuItem value="auto_if_confident">Auto bei hoher Konfidenz</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      size="small"
                      type="number"
                      label="Min. Suggest"
                      value={keywordingMinSuggestConfidence}
                      onChange={(event) => setKeywordingMinSuggestConfidence(Number(event.target.value || 0))}
                      inputProps={{ min: 0.05, max: 0.99, step: 0.01 }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Min. Auto-Apply"
                      value={keywordingMinAutoApplyConfidence}
                      onChange={(event) => setKeywordingMinAutoApplyConfidence(Number(event.target.value || 0))}
                      inputProps={{ min: 0.05, max: 0.99, step: 0.01 }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Max Keywords/Ziel"
                      value={keywordingMaxKeywordsPerTarget}
                      onChange={(event) => setKeywordingMaxKeywordsPerTarget(Number(event.target.value || 0))}
                      inputProps={{ min: 1, max: 40, step: 1 }}
                    />
                  </Stack>
                ) : null}
              </Stack>
            ) : null}

            <Divider />

            <Stack spacing={1}>
              <Typography variant="subtitle1" fontWeight={700}>
                Matching-Felder
              </Typography>
              <SmartTable<ImportFieldRow>
                tableId={`imports-match-fields-${kind}`}
                rows={fieldMatchRows}
                columns={fieldColumns}
                title="Matching-Felder"
                checkboxSelection
                selectionModel={matchFields}
                onSelectionModelChange={(ids) => setMatchFields(ids)}
                defaultPageSize={10}
                pageSizeOptions={[10, 25, 50]}
              />
            </Stack>

            <Stack spacing={1}>
              <Typography variant="subtitle1" fontWeight={700}>
                Übernahmefelder
              </Typography>
              <SmartTable<ImportFieldRow>
                tableId={`imports-selected-fields-${kind}`}
                rows={fieldSelectedRows}
                columns={fieldColumns}
                title="Übernahmefelder"
                checkboxSelection
                selectionModel={selectedFields}
                onSelectionModelChange={(ids) => setSelectedFields(ids)}
                defaultPageSize={10}
                pageSizeOptions={[10, 25, 50, 100]}
              />
            </Stack>

            <Divider />

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ md: 'center' }}>
              <Button variant="outlined" component="label" startIcon={<UploadFileRoundedIcon />} disabled={loading}>
                CSV auswählen
                <input
                  hidden
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const candidate = event.target.files?.[0] || null;
                    setFile(candidate);
                  }}
                />
              </Button>
              <Typography variant="body2" color="text.secondary">
                {file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : 'Keine Datei ausgewählt'}
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Button
                variant="contained"
                onClick={() => void handleUploadAndPreview()}
                disabled={loading || !file}
                startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <PreviewRoundedIcon />}
              >
                Vorschau
              </Button>
              <Button
                variant="contained"
                color="success"
                onClick={() => void handleExecute()}
                disabled={loading || !file}
                startIcon={<PlayArrowRoundedIcon />}
              >
                Import ausführen
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {job ? (
        <Card>
          <CardContent>
            <Stack spacing={1.4}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography variant="subtitle1" fontWeight={700}>
                  Job {job.id}
                </Typography>
                <Chip
                  size="small"
                  label={job.status || 'unknown'}
                  color={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'default'}
                />
                {job.running ? <Chip size="small" label="läuft" color="warning" /> : null}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<RefreshRoundedIcon />}
                  onClick={() => void refreshJob(job.id)}
                >
                  Aktualisieren
                </Button>
              </Stack>

              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip size="small" label={`Create: ${counters.create ?? counters.created ?? 0}`} />
                <Chip size="small" label={`Update: ${counters.update ?? counters.updated ?? 0}`} />
                <Chip size="small" label={`Skip: ${counters.skip ?? counters.skipped ?? 0}`} />
                <Chip
                  size="small"
                  label={`Conflict: ${counters.conflict ?? counters.conflicts ?? 0}`}
                  color={(counters.conflict ?? counters.conflicts ?? 0) > 0 ? 'warning' : 'default'}
                />
                <Chip size="small" label={`Invalid: ${counters.invalid ?? 0}`} />
                {String(job?.report?.followUpKeywordingJobId || '').trim() ? (
                  <Chip
                    size="small"
                    color="info"
                    label={`Keywording-Folgejob: ${String(job.report?.followUpKeywordingJobId).slice(0, 18)}…`}
                  />
                ) : null}
              </Stack>

              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Button size="small" variant="outlined" startIcon={<SmartToyRoundedIcon />} onClick={() => void runAssist('mapping')}>
                  Mapping-Assist
                </Button>
                <Button size="small" variant="outlined" startIcon={<SmartToyRoundedIcon />} onClick={() => void runAssist('keywords')}>
                  Keyword-Assist
                </Button>
                {kind === 'users' ? (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<SmartToyRoundedIcon />}
                    onClick={() => void runAssist('scope-assignment')}
                  >
                    Scope-Assist
                  </Button>
                ) : null}
              </Stack>

              {assistResult ? (
                <Alert severity="info">
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(assistResult, null, 2)}
                  </Typography>
                </Alert>
              ) : null}

              {previewRows.length > 0 ? (
                <SmartTable<PreviewSmartRow>
                  tableId={`imports-preview-${kind}`}
                  rows={previewRows}
                  columns={previewColumns}
                  title="Vorschau / Matching"
                  defaultPageSize={25}
                  pageSizeOptions={[10, 25, 50, 100]}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Noch keine Vorschau vorhanden.
                </Typography>
              )}

              {events.length > 0 ? (
                <>
                  <Divider />
                  <Typography variant="subtitle2">Verlauf</Typography>
                  <Stack spacing={0.6}>
                    {events.slice(0, 20).map((entry) => (
                      <Typography key={entry.id} variant="caption" color="text.secondary">
                        [{entry.createdAt || '—'}] {entry.eventType}: {entry.message}
                      </Typography>
                    ))}
                  </Stack>
                </>
              ) : null}
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={!!activePreviewRow}
        onClose={() => setActivePreviewRow(null)}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle>
          Änderungsprüfung CSV-Zeile {activePreviewRow?.rowIndex || '—'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.2}>
            <Typography variant="body2" color="text.secondary">
              {activePreviewRow?.identifier || '—'}
            </Typography>
            {diffRows.length === 0 ? (
              <Alert severity="info">Für diese Zeile sind keine Feldänderungen vorhanden.</Alert>
            ) : (
              <SmartTable<DiffSmartRow>
                tableId={`imports-diff-${kind}`}
                rows={diffRows}
                columns={diffColumns}
                title="Feldvergleich"
                defaultPageSize={25}
                pageSizeOptions={[10, 25, 50, 100]}
              />
            )}
          </Stack>
        </DialogContent>
      </Dialog>
    </Stack>
  );
};

export default Imports;
