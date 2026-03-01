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
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import PreviewRoundedIcon from '@mui/icons-material/PreviewRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { getAdminToken } from '../lib/auth';
import { useAdminScopeContext } from '../lib/adminScopeContext';

type ImportKind = 'users' | 'org_units';

interface ImportTemplateConfig {
  matchFields: string[];
  selectedFields: string[];
  orgTypeKey?: string;
  orgTypeLabel?: string;
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

const KIND_OPTIONS: Array<{ value: ImportKind; label: string }> = [
  { value: 'users', label: 'Benutzer (Mitarbeiter)' },
  { value: 'org_units', label: 'Organisationsstruktur' },
];

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
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJobSnapshot | null>(null);
  const [assistResult, setAssistResult] = useState<Record<string, any> | null>(null);
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
    } catch {
      setTemplate(null);
      setMatchFields([]);
      setSelectedFields([]);
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

  const toggleFromList = (list: string[], value: string) => {
    if (list.includes(value)) return list.filter((entry) => entry !== value);
    return [...list, value];
  };

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
        options: {
          matchFields,
          selectedFields,
          autoAssignOrgScopes,
          sendInvites,
          orgTypeKey,
          orgTypeLabel,
        },
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
          options: {
            matchFields,
            selectedFields,
            autoAssignOrgScopes,
            sendInvites,
            orgTypeKey,
            orgTypeLabel,
          },
        },
        { headers }
      );
      await refreshJob(jobId);
      setMessage('Vorschau erstellt.');
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
          options: {
            matchFields,
            selectedFields,
            autoAssignOrgScopes,
            sendInvites,
            orgTypeKey,
            orgTypeLabel,
          },
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

  const sampleRows = Array.isArray(job?.preview?.sampleRows) ? job?.preview?.sampleRows : [];
  const counters = (job?.preview?.counters || job?.report?.counters || {}) as Record<string, number>;
  const events = Array.isArray(job?.events) ? job.events : [];

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
                Unterstützt Benutzer- und Organisationsstrukturimporte mit Vorschau, Konflikterkennung, Assistenzfunktionen und asynchroner Ausführung.
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
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                <TextField
                  size="small"
                  label="Orga-Typ-Key"
                  value={orgTypeKey}
                  onChange={(event) => setOrgTypeKey(event.target.value)}
                />
                <TextField
                  size="small"
                  label="Orga-Typ-Label"
                  value={orgTypeLabel}
                  onChange={(event) => setOrgTypeLabel(event.target.value)}
                />
              </Stack>
            ) : null}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <Box sx={{ minWidth: 260 }}>
                <Typography variant="subtitle2">Matching-Felder</Typography>
                <FormGroup>
                  {(template?.matchFields || []).map((field) => (
                    <FormControlLabel
                      key={`match-${field}`}
                      control={
                        <Switch
                          checked={matchFields.includes(field)}
                          onChange={() => setMatchFields((prev) => toggleFromList(prev, field))}
                        />
                      }
                      label={field}
                    />
                  ))}
                </FormGroup>
              </Box>
              <Box sx={{ minWidth: 260 }}>
                <Typography variant="subtitle2">Übernahmefelder</Typography>
                <FormGroup>
                  {(template?.selectedFields || []).map((field) => (
                    <FormControlLabel
                      key={`select-${field}`}
                      control={
                        <Switch
                          checked={selectedFields.includes(field)}
                          onChange={() => setSelectedFields((prev) => toggleFromList(prev, field))}
                        />
                      }
                      label={field}
                    />
                  ))}
                </FormGroup>
              </Box>
            </Stack>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {kind === 'users' ? (
                <FormControlLabel
                  control={
                    <Switch
                      checked={autoAssignOrgScopes}
                      onChange={(event) => setAutoAssignOrgScopes(event.target.checked)}
                    />
                  }
                  label="Org-Scope optional automatisch zuordnen"
                />
              ) : null}
              {kind === 'users' ? (
                <FormControlLabel
                  control={<Switch checked={sendInvites} onChange={(event) => setSendInvites(event.target.checked)} />}
                  label="Einladungs-Mails im Import versenden"
                />
              ) : null}
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
                <Chip size="small" label={job.status || 'unknown'} color={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'default'} />
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
                <Chip size="small" label={`Conflict: ${counters.conflict ?? counters.conflicts ?? 0}`} color={(counters.conflict ?? counters.conflicts ?? 0) > 0 ? 'warning' : 'default'} />
                <Chip size="small" label={`Invalid: ${counters.invalid ?? 0}`} />
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

              {sampleRows.length > 0 ? (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>Aktion</TableCell>
                        <TableCell>Daten</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sampleRows.slice(0, 50).map((row: any) => (
                        <TableRow key={`sample-${row.rowIndex}`}>
                          <TableCell>{row.rowIndex}</TableCell>
                          <TableCell>{row.action || '—'}</TableCell>
                          <TableCell>
                            <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap' }}>
                              {JSON.stringify(row.mapped || {}, null, 2)}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
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
    </Stack>
  );
};

export default Imports;

