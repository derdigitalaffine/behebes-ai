import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import SourceTag from '../components/SourceTag';
import { useAdminScopeContext } from '../lib/adminScopeContext';
import { getAdminToken } from '../lib/auth';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';

interface SmtpConfig {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  smtpFromEmail: string;
  smtpFromName: string;
}

interface ImapConfig {
  enabled: boolean;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  imapUser: string;
  imapPassword: string;
  imapMailbox: string;
  syncLimit: number;
  syncIntervalMinutes: number;
}

const EmailSettings: React.FC = () => {
  const { selection, hasCapability } = useAdminScopeContext();
  const tenantMode = selection.scope === 'tenant' && !!selection.tenantId;
  const activeTenantId = selection.tenantId;
  const canManageGlobal = hasCapability('settings.email.global.manage');
  const canManageTenant = hasCapability('settings.email.tenant.manage');
  const canManageScope = tenantMode ? canManageTenant : canManageGlobal;

  const [smtpConfig, setSmtpConfig] = useState<SmtpConfig>({
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPassword: '',
    smtpFromEmail: '',
    smtpFromName: 'OI App',
  });
  const [imapConfig, setImapConfig] = useState<ImapConfig>({
    enabled: false,
    imapHost: '',
    imapPort: '993',
    imapSecure: true,
    imapUser: '',
    imapPassword: '',
    imapMailbox: 'INBOX',
    syncLimit: 80,
    syncIntervalMinutes: 2,
  });
  const [smtpSources, setSmtpSources] = useState<Record<string, string>>({});
  const [imapSources, setImapSources] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');

  const authHeader = () => ({
    Authorization: `Bearer ${getAdminToken()}`,
  });

  const getConfigEndpoint = (type: 'smtp' | 'imap'): string => {
    if (tenantMode && activeTenantId) {
      return `/api/admin/tenants/${encodeURIComponent(activeTenantId)}/config/${type}`;
    }
    return `/api/admin/config/${type}`;
  };

  useEffect(() => {
    if (!canManageScope || (tenantMode && !activeTenantId)) {
      setLoading(false);
      return;
    }
    void fetchConfig();
  }, [canManageScope, tenantMode, activeTenantId]);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const [smtpResponse, imapResponse] = await Promise.all([
        axios.get(getConfigEndpoint('smtp'), { headers: authHeader() }),
        axios.get(getConfigEndpoint('imap'), { headers: authHeader() }),
      ]);

      const smtpPayload = smtpResponse.data || {};
      const imapPayload = imapResponse.data || {};

      setSmtpConfig({
        smtpHost: smtpPayload.smtpHost || '',
        smtpPort: smtpPayload.smtpPort || '587',
        smtpUser: smtpPayload.smtpUser || '',
        smtpPassword: smtpPayload.smtpPassword || '',
        smtpFromEmail: smtpPayload.smtpFromEmail || '',
        smtpFromName: smtpPayload.smtpFromName || 'OI App',
      });
      setImapConfig({
        enabled: imapPayload.enabled === true,
        imapHost: imapPayload.imapHost || '',
        imapPort: imapPayload.imapPort || '993',
        imapSecure: imapPayload.imapSecure !== false,
        imapUser: imapPayload.imapUser || '',
        imapPassword: imapPayload.imapPassword || '',
        imapMailbox: imapPayload.imapMailbox || 'INBOX',
        syncLimit: Number.isFinite(Number(imapPayload.syncLimit))
          ? Math.max(1, Math.min(500, Math.floor(Number(imapPayload.syncLimit))))
          : 80,
        syncIntervalMinutes: Number.isFinite(Number(imapPayload.syncIntervalMinutes))
          ? Math.max(1, Math.min(1440, Math.floor(Number(imapPayload.syncIntervalMinutes))))
          : 2,
      });
      setSmtpSources(smtpPayload.sources || {});
      setImapSources(imapPayload.sources || {});
      setMessage('');
      setMessageType('');
    } catch {
      setMessageType('error');
      setMessage('Fehler beim Laden der Einstellungen');
    } finally {
      setLoading(false);
    }
  };

  const updateSmtp = (name: keyof SmtpConfig, value: string) => {
    setSmtpConfig((prev) => ({ ...prev, [name]: value }));
  };

  const updateImap = (name: keyof ImapConfig, value: string | number | boolean) => {
    setImapConfig((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    setMessageType('');
    try {
      if (!canManageScope) {
        setMessageType('error');
        setMessage('Keine Berechtigung für den aktuellen Kontext.');
        return;
      }
      await Promise.all([
        axios.patch(getConfigEndpoint('smtp'), smtpConfig, { headers: authHeader() }),
        axios.patch(getConfigEndpoint('imap'), imapConfig, { headers: authHeader() }),
      ]);
      setMessageType('success');
      setMessage(
        tenantMode
          ? 'Mandanten-SMTP/IMAP-Konfiguration erfolgreich aktualisiert.'
          : 'SMTP/IMAP-Konfiguration erfolgreich aktualisiert.'
      );
      setTimeout(() => setMessage(''), 3200);
      await fetchConfig();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Fehler beim Speichern der Konfiguration');
    } finally {
      setSaving(false);
    }
  };

  const handleMailboxSync = async () => {
    setSyncing(true);
    setMessage('');
    setMessageType('');
    try {
      if (!canManageScope) {
        setMessageType('error');
        setMessage('Keine Berechtigung für den aktuellen Kontext.');
        return;
      }
      const response = await axios.post('/api/admin/mailbox/sync', undefined, {
        headers: authHeader(),
        params: tenantMode && activeTenantId ? { tenantId: activeTenantId } : undefined,
      });
      const payload = response.data || {};
      const imported = Number(payload.imported || 0);
      const linked = Number(payload.linkedToTickets || 0);
      setMessageType('success');
      setMessage(`IMAP-Sync abgeschlossen: ${imported} neue Nachricht(en), ${linked} Ticket-Zuordnung(en).`);
      setTimeout(() => setMessage(''), 3600);
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.error || error?.response?.data?.message || 'IMAP-Sync fehlgeschlagen');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={280}>
        <CircularProgress size={30} />
      </Box>
    );
  }

  if (!canManageScope) {
    return (
      <Alert severity="warning">
        Für den aktuell gewählten Kontext fehlen die Berechtigungen zur SMTP/IMAP-Konfiguration.
      </Alert>
    );
  }

  if (tenantMode && !activeTenantId) {
    return (
      <Alert severity="info">
        Kein Mandant gewählt. Bitte zuerst einen Mandanten-Kontext auswählen.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHero
        title="E-Mail (SMTP/IMAP)"
        subtitle="Konsolidierte Konfiguration für ausgehende und eingehende Ticket-Kommunikation."
        badges={[
          { label: tenantMode ? `Mandant: ${activeTenantId}` : 'Kontext: Global', tone: tenantMode ? 'info' : 'default' },
          { label: imapConfig.enabled ? 'IMAP aktiv' : 'IMAP inaktiv', tone: imapConfig.enabled ? 'success' : 'warning' },
        ]}
        actions={(
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <Button
              variant="outlined"
              startIcon={syncing ? <CircularProgress size={16} /> : <SyncRoundedIcon />}
              onClick={handleMailboxSync}
              disabled={syncing}
            >
              IMAP synchronisieren
            </Button>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveRoundedIcon />}
              onClick={handleSave}
              disabled={saving}
            >
              Speichern
            </Button>
          </Stack>
        )}
      />

      {message ? (
        <Alert severity={messageType === 'success' ? 'success' : 'error'}>{message}</Alert>
      ) : null}

      <AdminKpiStrip
        items={[
          {
            label: 'SMTP-Host',
            value: smtpConfig.smtpHost || '–',
            hint: smtpConfig.smtpFromEmail || 'Kein Absender gesetzt',
          },
          {
            label: 'IMAP-Host',
            value: imapConfig.imapHost || '–',
            hint: `${imapConfig.imapMailbox || 'INBOX'} · Port ${imapConfig.imapPort || '993'}`,
          },
          {
            label: 'Abrufintervall',
            value: `${imapConfig.syncIntervalMinutes} min`,
            hint: `${imapConfig.syncLimit} Nachrichten je Lauf`,
            tone: 'info',
          },
        ]}
      />

      <AdminSurfaceCard title="SMTP (ausgehend)" subtitle="Versandkonfiguration inklusive Absender-Identität.">
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label={<Stack direction="row" alignItems="center" spacing={0.5}><span>SMTP-Host</span><SourceTag source={smtpSources.smtpHost} /></Stack>}
              value={smtpConfig.smtpHost}
              onChange={(event) => updateSmtp('smtpHost', event.target.value)}
              placeholder="z. B. smtp.example.org"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel id="smtp-port-label">SMTP-Port</InputLabel>
              <Select
                labelId="smtp-port-label"
                label="SMTP-Port"
                value={smtpConfig.smtpPort}
                onChange={(event) => updateSmtp('smtpPort', String(event.target.value))}
              >
                <MenuItem value="25">25 (Unverschlüsselt)</MenuItem>
                <MenuItem value="465">465 (SSL)</MenuItem>
                <MenuItem value="587">587 (TLS)</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label={<Stack direction="row" alignItems="center" spacing={0.5}><span>Absender-Name</span><SourceTag source={smtpSources.smtpFromName} /></Stack>}
              value={smtpConfig.smtpFromName}
              onChange={(event) => updateSmtp('smtpFromName', event.target.value)}
              placeholder="behebes.AI"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label={<Stack direction="row" alignItems="center" spacing={0.5}><span>Benutzername</span><SourceTag source={smtpSources.smtpUser} /></Stack>}
              value={smtpConfig.smtpUser}
              onChange={(event) => updateSmtp('smtpUser', event.target.value)}
              placeholder="mail@example.org"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              type="password"
              label={<Stack direction="row" alignItems="center" spacing={0.5}><span>Passwort</span><SourceTag source={smtpSources.smtpPassword} /></Stack>}
              value={smtpConfig.smtpPassword}
              onChange={(event) => updateSmtp('smtpPassword', event.target.value)}
              placeholder={smtpConfig.smtpPassword === '***' ? 'Passwort ist gespeichert (für Änderung neu eingeben)' : 'Passwort eingeben'}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              type="email"
              label={<Stack direction="row" alignItems="center" spacing={0.5}><span>Absender-E-Mail</span><SourceTag source={smtpSources.smtpFromEmail} /></Stack>}
              value={smtpConfig.smtpFromEmail}
              onChange={(event) => updateSmtp('smtpFromEmail', event.target.value)}
              placeholder="noreply@example.org"
            />
          </Grid>
        </Grid>
      </AdminSurfaceCard>

      <AdminSurfaceCard title="IMAP (eingehend / Ticket-Antworten)" subtitle="Import und Zuordnung eingehender E-Mails zu Tickets.">
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={imapConfig.enabled}
                  onChange={(event) => updateImap('enabled', event.target.checked)}
                />
              }
              label={(
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <span>IMAP aktiviert</span>
                  <SourceTag source={imapSources.enabled} />
                </Stack>
              )}
            />
            <FormControl fullWidth sx={{ maxWidth: 260 }}>
              <InputLabel id="imap-secure-label">Transport</InputLabel>
              <Select
                labelId="imap-secure-label"
                label="Transport"
                value={imapConfig.imapSecure ? 'true' : 'false'}
                onChange={(event) => updateImap('imapSecure', String(event.target.value) === 'true')}
              >
                <MenuItem value="true">TLS/SSL (empfohlen)</MenuItem>
                <MenuItem value="false">Klartext</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={<Stack direction="row" alignItems="center" spacing={0.5}><span>IMAP-Host</span><SourceTag source={imapSources.imapHost} /></Stack>}
                value={imapConfig.imapHost}
                onChange={(event) => updateImap('imapHost', event.target.value)}
                placeholder="imap.example.org"
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                type="number"
                inputProps={{ min: 1, max: 65535 }}
                label={<Stack direction="row" alignItems="center" spacing={0.5}><span>IMAP-Port</span><SourceTag source={imapSources.imapPort} /></Stack>}
                value={imapConfig.imapPort}
                onChange={(event) => updateImap('imapPort', event.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label={<Stack direction="row" alignItems="center" spacing={0.5}><span>Mailbox-Ordner</span><SourceTag source={imapSources.imapMailbox} /></Stack>}
                value={imapConfig.imapMailbox}
                onChange={(event) => updateImap('imapMailbox', event.target.value)}
                placeholder="INBOX"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={<Stack direction="row" alignItems="center" spacing={0.5}><span>IMAP-Benutzer</span><SourceTag source={imapSources.imapUser} /></Stack>}
                value={imapConfig.imapUser}
                onChange={(event) => updateImap('imapUser', event.target.value)}
                placeholder="mail@example.org"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="password"
                label={<Stack direction="row" alignItems="center" spacing={0.5}><span>IMAP-Passwort</span><SourceTag source={imapSources.imapPassword} /></Stack>}
                value={imapConfig.imapPassword}
                onChange={(event) => updateImap('imapPassword', event.target.value)}
                placeholder={imapConfig.imapPassword === '***' ? 'Passwort ist gespeichert (für Änderung neu eingeben)' : 'Passwort eingeben'}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                inputProps={{ min: 1, max: 500 }}
                label={<Stack direction="row" alignItems="center" spacing={0.5}><span>Sync-Limit je Lauf</span><SourceTag source={imapSources.syncLimit} /></Stack>}
                value={imapConfig.syncLimit}
                onChange={(event) =>
                  updateImap('syncLimit', Math.max(1, Math.min(500, Number(event.target.value || 1))))
                }
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                inputProps={{ min: 1, max: 1440 }}
                label={<Stack direction="row" alignItems="center" spacing={0.5}><span>Abrufintervall (Minuten)</span><SourceTag source={imapSources.syncIntervalMinutes} /></Stack>}
                value={imapConfig.syncIntervalMinutes}
                onChange={(event) =>
                  updateImap('syncIntervalMinutes', Math.max(1, Math.min(1440, Number(event.target.value || 1))))
                }
              />
            </Grid>
          </Grid>
        </Stack>
      </AdminSurfaceCard>

      <AdminSurfaceCard title="Hinweise" subtitle="Betrieb und Zuordnung von Ticket-Mails">
        <Stack spacing={0.75}>
          <Typography variant="body2">Ausgehende E-Mails enthalten automatisch die Ticket-ID im Betreff.</Typography>
          <Typography variant="body2">Antwortmails werden per IMAP importiert und mit Ticketdetails verknüpft.</Typography>
          <Typography variant="body2">Das Postfach wird automatisch im konfigurierten Intervall synchronisiert.</Typography>
          <Typography variant="body2">Die importierten Nachrichten sind unter „E-Mail Postfach“ einsehbar.</Typography>
        </Stack>
      </AdminSurfaceCard>
    </div>
  );
};

export default EmailSettings;
