import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
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

interface ServiceItem {
  id: string;
  tenantId: string;
  externalRef: string | null;
  name: string;
  descriptionHtml: string;
  publicationStatus: string | null;
  chatbotRelevant: boolean;
  appointmentAllowed: boolean;
  leikaKey: string | null;
  ozgServices: string[];
  ozgRelevant: boolean;
  assignmentKeywords: string[];
  metadata: Record<string, unknown>;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ServiceFormState {
  name: string;
  externalRef: string;
  descriptionHtml: string;
  publicationStatus: string;
  leikaKey: string;
  chatbotRelevant: boolean;
  appointmentAllowed: boolean;
  ozgRelevant: boolean;
  active: boolean;
  assignmentKeywords: string[];
  ozgServices: string[];
  metadataText: string;
}

const PUBLICATION_STATUS_OPTIONS = [
  { value: '', label: 'Nicht gesetzt' },
  { value: 'draft', label: 'Entwurf' },
  { value: 'internal', label: 'Intern' },
  { value: 'published', label: 'Veröffentlicht' },
] as const;

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
  });
};

const normalizeKeywordList = (input: unknown): string[] => {
  const source = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of source) {
    const keyword = normalizeText(raw).replace(/\s+/g, ' ').slice(0, 80);
    if (!keyword) continue;
    const key = keyword.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
    if (out.length >= 120) break;
  }
  return out;
};

const parseMetadataText = (raw: string): { ok: boolean; value: Record<string, unknown>; error?: string } => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, value: {}, error: 'Metadaten müssen ein JSON-Objekt sein.' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, value: {}, error: 'Metadaten enthalten ungültiges JSON.' };
  }
};

const emptyFormState = (): ServiceFormState => ({
  name: '',
  externalRef: '',
  descriptionHtml: '',
  publicationStatus: '',
  leikaKey: '',
  chatbotRelevant: false,
  appointmentAllowed: false,
  ozgRelevant: false,
  active: true,
  assignmentKeywords: [],
  ozgServices: [],
  metadataText: '{}',
});

const formStateFromService = (service: ServiceItem): ServiceFormState => ({
  name: normalizeText(service.name),
  externalRef: normalizeText(service.externalRef),
  descriptionHtml: String(service.descriptionHtml || ''),
  publicationStatus: normalizeText(service.publicationStatus),
  leikaKey: normalizeText(service.leikaKey),
  chatbotRelevant: service.chatbotRelevant === true,
  appointmentAllowed: service.appointmentAllowed === true,
  ozgRelevant: service.ozgRelevant === true,
  active: service.active !== false,
  assignmentKeywords: normalizeKeywordList(service.assignmentKeywords),
  ozgServices: normalizeKeywordList(service.ozgServices),
  metadataText: JSON.stringify(service.metadata || {}, null, 2),
});

const buildPurgeConfirmationPhrase = (tenantId: string, serviceCount: number): string =>
  `LOESCHE-ALLE-LEISTUNGEN:${tenantId}:${serviceCount}`;

const ServicesCatalog: React.FC = () => {
  const token = getAdminToken();
  const { capabilities, isGlobalAdmin, selection, tenants } = useAdminScopeContext();
  const capabilitySet = useMemo(
    () => new Set((capabilities || []).map((entry) => String(entry || '').trim())),
    [capabilities]
  );
  const canManage = useMemo(
    () =>
      capabilitySet.has('settings.organization.global.manage') ||
      capabilitySet.has('settings.organization.tenant.manage') ||
      capabilitySet.has('settings.categories.manage'),
    [capabilitySet]
  );
  const canRead = useMemo(
    () => canManage || capabilitySet.has('tickets.read') || capabilitySet.has('workflows.read'),
    [canManage, capabilitySet]
  );

  const [tenantId, setTenantId] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [form, setForm] = useState<ServiceFormState>(emptyFormState);
  const [saving, setSaving] = useState(false);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeServiceCount, setPurgeServiceCount] = useState(0);
  const [purgeConfirmed, setPurgeConfirmed] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');

  useEffect(() => {
    if (!isGlobalAdmin) {
      setTenantId(selection.tenantId || '');
      return;
    }
    if (!tenantId && selection.tenantId) {
      setTenantId(selection.tenantId);
    }
  }, [isGlobalAdmin, selection.tenantId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  const resolvedTenantId = isGlobalAdmin ? tenantId : selection.tenantId;

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const purgeConfirmationPhrase = useMemo(() => {
    const tenant = normalizeText(resolvedTenantId);
    if (!tenant) return '';
    return buildPurgeConfirmationPhrase(tenant, purgeServiceCount);
  }, [resolvedTenantId, purgeServiceCount]);

  const loadServices = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!canRead) return;
      const targetTenantId = normalizeText(resolvedTenantId);
      if (!targetTenantId) {
        setItems([]);
        setTotal(0);
        return;
      }
      const silent = options?.silent === true;
      try {
        if (!silent) setLoading(true);
        const response = await axios.get('/api/admin/services', {
          headers,
          params: {
            tenantId: targetTenantId,
            q: query || undefined,
            activeOnly: showInactive ? 0 : 1,
            limit: 500,
            offset: 0,
          },
        });
        const nextItems = Array.isArray(response.data?.items) ? (response.data.items as ServiceItem[]) : [];
        setItems(nextItems);
        setTotal(Number(response.data?.total || nextItems.length));
        setError('');
      } catch (err: any) {
        setError(err?.response?.data?.message || 'Leistungen konnten nicht geladen werden.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [canRead, headers, query, resolvedTenantId, showInactive]
  );

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const openCreateDialog = () => {
    setEditing(null);
    setForm(emptyFormState());
    setDialogOpen(true);
    setError('');
    setMessage('');
  };

  const openEditDialog = (service: ServiceItem) => {
    setEditing(service);
    setForm(formStateFromService(service));
    setDialogOpen(true);
    setError('');
    setMessage('');
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
  };

  const openPurgeDialog = async () => {
    if (!canManage) return;
    const targetTenantId = normalizeText(resolvedTenantId);
    if (!targetTenantId) {
      setError('Bitte Mandant auswählen.');
      return;
    }

    setError('');
    setMessage('');
    setPurgeLoading(true);
    try {
      const response = await axios.get('/api/admin/services', {
        headers,
        params: {
          tenantId: targetTenantId,
          activeOnly: 0,
          limit: 1,
          offset: 0,
        },
      });
      const count = Math.max(0, Number(response.data?.total || 0));
      setPurgeServiceCount(count);
      setPurgeConfirmed(false);
      setPurgeConfirmText('');
      setPurgeDialogOpen(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Leistungsanzahl konnte nicht ermittelt werden.');
    } finally {
      setPurgeLoading(false);
    }
  };

  const closePurgeDialog = () => {
    if (purgeLoading) return;
    setPurgeDialogOpen(false);
  };

  const handleSave = async () => {
    if (!canManage) return;
    const targetTenantId = normalizeText(resolvedTenantId);
    if (!targetTenantId) {
      setError('Bitte Mandant auswählen.');
      return;
    }
    const name = normalizeText(form.name);
    if (!name) {
      setError('Bitte einen Namen für die Leistung angeben.');
      return;
    }
    const metadata = parseMetadataText(form.metadataText);
    if (!metadata.ok) {
      setError(metadata.error || 'Metadaten sind ungültig.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        tenantId: targetTenantId,
        name,
        externalRef: normalizeText(form.externalRef) || null,
        descriptionHtml: String(form.descriptionHtml || '').trim(),
        publicationStatus: normalizeText(form.publicationStatus) || null,
        leikaKey: normalizeText(form.leikaKey) || null,
        chatbotRelevant: form.chatbotRelevant === true,
        appointmentAllowed: form.appointmentAllowed === true,
        ozgRelevant: form.ozgRelevant === true,
        active: form.active !== false,
        assignmentKeywords: normalizeKeywordList(form.assignmentKeywords),
        ozgServices: normalizeKeywordList(form.ozgServices),
        metadata: metadata.value,
      };

      if (editing?.id) {
        await axios.patch(`/api/admin/services/${encodeURIComponent(editing.id)}`, payload, { headers });
        setMessage('Leistung aktualisiert.');
      } else {
        await axios.post('/api/admin/services', payload, { headers });
        setMessage('Leistung angelegt.');
      }

      setDialogOpen(false);
      await loadServices({ silent: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Leistung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (service: ServiceItem) => {
    if (!canManage) return;
    const targetTenantId = normalizeText(resolvedTenantId);
    if (!targetTenantId) {
      setError('Bitte Mandant auswählen.');
      return;
    }
    const confirmed = window.confirm(`Leistung "${service.name}" deaktivieren?`);
    if (!confirmed) return;
    setBusyId(service.id);
    setError('');
    setMessage('');
    try {
      await axios.delete(`/api/admin/services/${encodeURIComponent(service.id)}`, {
        headers,
        params: { tenantId: targetTenantId },
      });
      setMessage('Leistung wurde deaktiviert.');
      await loadServices({ silent: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Leistung konnte nicht deaktiviert werden.');
    } finally {
      setBusyId('');
    }
  };

  const handleReactivate = async (service: ServiceItem) => {
    if (!canManage) return;
    const targetTenantId = normalizeText(resolvedTenantId);
    if (!targetTenantId) {
      setError('Bitte Mandant auswählen.');
      return;
    }
    setBusyId(service.id);
    setError('');
    setMessage('');
    try {
      await axios.patch(
        `/api/admin/services/${encodeURIComponent(service.id)}`,
        {
          tenantId: targetTenantId,
          active: true,
        },
        { headers }
      );
      setMessage('Leistung wurde wieder aktiviert.');
      await loadServices({ silent: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Leistung konnte nicht aktiviert werden.');
    } finally {
      setBusyId('');
    }
  };

  const handlePurgeAllServices = async () => {
    if (!canManage) return;
    const targetTenantId = normalizeText(resolvedTenantId);
    if (!targetTenantId) {
      setError('Bitte Mandant auswählen.');
      return;
    }
    const expectedPhrase = buildPurgeConfirmationPhrase(targetTenantId, purgeServiceCount);
    if (!purgeConfirmed || normalizeText(purgeConfirmText) !== expectedPhrase) {
      setError('Doppelte Sicherheitsprüfung nicht erfüllt.');
      return;
    }

    setPurgeLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await axios.post(
        '/api/admin/services/purge-all',
        {
          tenantId: targetTenantId,
          confirmTenantId: targetTenantId,
          expectedServiceCount: purgeServiceCount,
          confirmPhrase: normalizeText(purgeConfirmText),
        },
        { headers }
      );
      const deletedServices = Number(response.data?.deleted?.services || 0);
      setMessage(`Alle Leistungen wurden gelöscht. Entfernte Leistungen: ${deletedServices}.`);
      setPurgeDialogOpen(false);
      await loadServices({ silent: true });
    } catch (err: any) {
      const responseData = err?.response?.data || {};
      if (Number.isFinite(Number(responseData?.actualServiceCount))) {
        setPurgeServiceCount(Math.max(0, Number(responseData.actualServiceCount)));
      }
      setError(responseData?.message || 'Alle Leistungen konnten nicht gelöscht werden.');
    } finally {
      setPurgeLoading(false);
    }
  };

  const columns = useMemo<SmartTableColumnDef<ServiceItem>[]>(
    () => [
      {
        field: 'name',
        headerName: 'Name',
        minWidth: 260,
        flex: 1.3,
      },
      {
        field: 'externalRef',
        headerName: 'Externe Referenz',
        minWidth: 170,
        flex: 0.7,
        valueGetter: (_value, row) => normalizeText(row.externalRef) || '–',
      },
      {
        field: 'publicationStatus',
        headerName: 'Status',
        minWidth: 160,
        flex: 0.6,
        valueGetter: (_value, row) => normalizeText(row.publicationStatus) || '–',
      },
      {
        field: 'leikaKey',
        headerName: 'LeiKa',
        minWidth: 130,
        flex: 0.55,
        valueGetter: (_value, row) => normalizeText(row.leikaKey) || '–',
      },
      {
        field: 'assignmentKeywords',
        headerName: 'Schlagworte',
        minWidth: 240,
        flex: 1,
        sortable: false,
        valueGetter: (_value, row) =>
          Array.isArray(row.assignmentKeywords) && row.assignmentKeywords.length > 0
            ? row.assignmentKeywords.join(', ')
            : '–',
      },
      {
        field: 'flags',
        headerName: 'Kennzeichen',
        minWidth: 220,
        sortable: false,
        filterable: false,
        valueGetter: (_value, row) => {
          const flags: string[] = [];
          if (row.chatbotRelevant) flags.push('Chatbot');
          if (row.appointmentAllowed) flags.push('Termin');
          if (row.ozgRelevant) flags.push('OZG');
          if (!row.active) flags.push('Inaktiv');
          return flags.length > 0 ? flags.join(', ') : '–';
        },
        renderCell: (params) => {
          const row = params.row;
          const chips: Array<{ key: string; label: string; color: 'default' | 'success' | 'warning' }> = [];
          if (row.chatbotRelevant) chips.push({ key: 'chatbot', label: 'Chatbot', color: 'success' });
          if (row.appointmentAllowed) chips.push({ key: 'appointment', label: 'Termin', color: 'success' });
          if (row.ozgRelevant) chips.push({ key: 'ozg', label: 'OZG', color: 'warning' });
          if (!row.active) chips.push({ key: 'inactive', label: 'Inaktiv', color: 'default' });
          if (chips.length === 0) return <span>–</span>;
          return (
            <Stack direction="row" spacing={0.6} sx={{ flexWrap: 'wrap', py: 0.2 }}>
              {chips.map((chip) => (
                <Chip key={chip.key} size="small" label={chip.label} color={chip.color} />
              ))}
            </Stack>
          );
        },
      },
      {
        field: 'updatedAt',
        headerName: 'Aktualisiert',
        minWidth: 170,
        flex: 0.6,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 150,
        flex: 0.5,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (params) => {
          const row = params.row;
          const rowBusy = busyId === row.id;
          return (
            <SmartTableRowActions>
              <SmartTableRowActionButton
                label="Leistung bearbeiten"
                icon={<EditRoundedIcon fontSize="inherit" />}
                onClick={() => openEditDialog(row)}
                disabled={!canManage || rowBusy || saving}
              />
              {row.active ? (
                <SmartTableRowActionButton
                  label="Leistung deaktivieren"
                  icon={<DeleteOutlineRoundedIcon fontSize="inherit" />}
                  tone="danger"
                  onClick={() => {
                    void handleDeactivate(row);
                  }}
                  disabled={!canManage || rowBusy || saving}
                  loading={rowBusy}
                />
              ) : (
                <SmartTableRowActionButton
                  label="Leistung aktivieren"
                  icon={<ReplayRoundedIcon fontSize="inherit" />}
                  tone="success"
                  onClick={() => {
                    void handleReactivate(row);
                  }}
                  disabled={!canManage || rowBusy || saving}
                  loading={rowBusy}
                />
              )}
            </SmartTableRowActions>
          );
        },
      },
    ],
    [busyId, canManage, saving]
  );

  const kpiItems = useMemo(
    () => [
      { id: 'total', label: 'Gefundene Leistungen', value: total },
      { id: 'active', label: 'Aktive Leistungen', value: items.filter((entry) => entry.active).length },
      { id: 'inactive', label: 'Inaktive Leistungen', value: items.filter((entry) => !entry.active).length },
    ],
    [items, total]
  );

  if (!canRead) {
    return (
      <Alert severity="warning">
        Für den Bereich <strong>Leistungen</strong> fehlen die nötigen Rechte.
      </Alert>
    );
  }

  return (
    <div>
      <AdminPageHero
        title="Leistungen"
        subtitle="Leistungen mandantenbezogen anzeigen, pflegen und deaktivieren."
        icon={<i className="fa-solid fa-list-check" />}
        actions={
          canManage ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openCreateDialog}>
                Leistung hinzufügen
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteSweepRoundedIcon />}
                onClick={() => {
                  void openPurgeDialog();
                }}
                disabled={purgeLoading || !resolvedTenantId}
              >
                Alle Leistungen löschen
              </Button>
            </Stack>
          ) : undefined
        }
        badges={[
          {
            id: 'scope',
            label: resolvedTenantId ? `Mandant: ${resolvedTenantId}` : 'Mandant auswählen',
            tone: resolvedTenantId ? 'info' : 'warning',
          },
          {
            id: 'rights',
            label: canManage ? 'Verwalten erlaubt' : 'Nur Lesen',
            tone: canManage ? 'success' : 'default',
          },
        ]}
      />

      <AdminKpiStrip items={kpiItems} />

      <AdminSurfaceCard
        title="Leistungskatalog"
        subtitle="Alle Änderungen wirken direkt auf Import, Zuordnung und KI-gestützte Vorschläge."
      >
        <Stack spacing={1.2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {message ? <Alert severity="success">{message}</Alert> : null}

          <SmartTable<ServiceItem>
            tableId="services-catalog"
            userId={token}
            title="Leistungen"
            rows={items}
            columns={columns}
            loading={loading}
            onRefresh={() => loadServices({ silent: true })}
            toolbarStartActions={
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'center' } }}>
                {isGlobalAdmin ? (
                  <TextField
                    select
                    size="small"
                    label="Mandant"
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    sx={{ minWidth: 230 }}
                  >
                    <MenuItem value="">Mandant wählen</MenuItem>
                    {tenants.map((tenant) => (
                      <MenuItem key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
                <TextField
                  size="small"
                  label="Suche"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, Referenz, LeiKa"
                  sx={{ minWidth: 260 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={showInactive}
                      onChange={(event) => setShowInactive(event.target.checked)}
                    />
                  }
                  label="Inaktive anzeigen"
                />
              </Stack>
            }
          />
        </Stack>
      </AdminSurfaceCard>

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Leistung bearbeiten' : 'Leistung anlegen'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
              <TextField
                label="Name"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                fullWidth
                required
              />
              <TextField
                label="Externe Referenz"
                value={form.externalRef}
                onChange={(event) => setForm((prev) => ({ ...prev, externalRef: event.target.value }))}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
              <TextField
                select
                label="Publikationsstatus"
                value={form.publicationStatus}
                onChange={(event) => setForm((prev) => ({ ...prev, publicationStatus: event.target.value }))}
                fullWidth
              >
                {PUBLICATION_STATUS_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="LeiKa-Schlüssel"
                value={form.leikaKey}
                onChange={(event) => setForm((prev) => ({ ...prev, leikaKey: event.target.value }))}
                fullWidth
              />
            </Stack>

            <TextField
              label="Beschreibung (HTML/Text)"
              value={form.descriptionHtml}
              onChange={(event) => setForm((prev) => ({ ...prev, descriptionHtml: event.target.value }))}
              multiline
              minRows={4}
              fullWidth
            />

            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={form.assignmentKeywords}
              onChange={(_event, value) => {
                setForm((prev) => ({ ...prev, assignmentKeywords: normalizeKeywordList(value) }));
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Zuständigkeits-Schlagworte"
                  helperText="Mit Enter bestätigen. Diese Schlagworte werden für Zuständigkeit und KI-Zuweisung verwendet."
                />
              )}
            />

            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={form.ozgServices}
              onChange={(_event, value) => {
                setForm((prev) => ({ ...prev, ozgServices: normalizeKeywordList(value) }));
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="OZG-Services"
                  helperText="Optional: OZG-Bezeichner oder Synonyme."
                />
              )}
            />

            <TextField
              label="Metadaten (JSON)"
              value={form.metadataText}
              onChange={(event) => setForm((prev) => ({ ...prev, metadataText: event.target.value }))}
              multiline
              minRows={4}
              fullWidth
            />

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.chatbotRelevant}
                    onChange={(event) => setForm((prev) => ({ ...prev, chatbotRelevant: event.target.checked }))}
                  />
                }
                label="Chatbot-relevant"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.appointmentAllowed}
                    onChange={(event) => setForm((prev) => ({ ...prev, appointmentAllowed: event.target.checked }))}
                  />
                }
                label="Termin erlaubt"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.ozgRelevant}
                    onChange={(event) => setForm((prev) => ({ ...prev, ozgRelevant: event.target.checked }))}
                  />
                }
                label="OZG-relevant"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.active}
                    onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
                  />
                }
                label="Aktiv"
              />
            </Stack>

            {!canManage ? (
              <Alert severity="warning">Nur Lesen möglich. Zum Speichern fehlen die nötigen Rechte.</Alert>
            ) : null}
            <Box>
              <Typography variant="body2" color="text.secondary">
                Hinweis: Löschen deaktiviert Leistungen (soft delete). Inaktive Leistungen können wieder aktiviert werden.
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveRoundedIcon />}
            onClick={() => {
              void handleSave();
            }}
            disabled={saving || !canManage}
          >
            {saving ? 'Speichern...' : 'Speichern'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={purgeDialogOpen} onClose={closePurgeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Alle Leistungen löschen</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Alert severity="error">
              Diese Aktion löscht <strong>dauerhaft</strong> alle Leistungen des gewählten Mandanten inklusive Verknüpfungen.
            </Alert>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Mandant: <strong>{resolvedTenantId || '–'}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Zu löschende Leistungen: <strong>{purgeServiceCount}</strong>
              </Typography>
            </Box>
            <Alert severity="warning">
              Sicherheitscode exakt eingeben:
              <Box
                component="code"
                sx={{
                  mt: 0.8,
                  display: 'block',
                  px: 1,
                  py: 0.8,
                  borderRadius: 1,
                  bgcolor: 'rgba(0,0,0,0.06)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  wordBreak: 'break-all',
                }}
              >
                {purgeConfirmationPhrase}
              </Box>
            </Alert>
            <TextField
              label="Sicherheitscode"
              value={purgeConfirmText}
              onChange={(event) => setPurgeConfirmText(event.target.value)}
              placeholder={purgeConfirmationPhrase}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={purgeConfirmed}
                  onChange={(event) => setPurgeConfirmed(event.target.checked)}
                />
              }
              label="Ich bestätige, dass alle Leistungen dieses Mandanten dauerhaft gelöscht werden."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closePurgeDialog} disabled={purgeLoading}>
            Abbrechen
          </Button>
          <Button
            variant="contained"
            color="error"
            startIcon={<DeleteSweepRoundedIcon />}
            onClick={() => {
              void handlePurgeAllServices();
            }}
            disabled={
              purgeLoading ||
              purgeServiceCount < 0 ||
              !purgeConfirmed ||
              normalizeText(purgeConfirmText) !== purgeConfirmationPhrase
            }
          >
            {purgeLoading ? 'Lösche...' : 'Dauerhaft löschen'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default ServicesCatalog;
