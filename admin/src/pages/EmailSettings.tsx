import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';
import SourceTag from '../components/SourceTag';
import { useAdminScopeContext } from '../lib/adminScopeContext';

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
    if (!canManageScope) {
      setLoading(false);
      return;
    }
    if (tenantMode && !activeTenantId) {
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

  const handleSmtpChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setSmtpConfig((prev) => ({ ...prev, [name]: value }));
  };

  const handleImapChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = event.target;
    if (name === 'enabled') {
      setImapConfig((prev) => ({ ...prev, enabled: value === 'true' }));
      return;
    }
    if (name === 'imapSecure') {
      setImapConfig((prev) => ({ ...prev, imapSecure: value === 'true' }));
      return;
    }
    if (name === 'syncLimit') {
      const parsed = Number(value);
      setImapConfig((prev) => ({
        ...prev,
        syncLimit: Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : prev.syncLimit,
      }));
      return;
    }
    if (name === 'syncIntervalMinutes') {
      const parsed = Number(value);
      setImapConfig((prev) => ({
        ...prev,
        syncIntervalMinutes: Number.isFinite(parsed)
          ? Math.max(1, Math.min(1440, Math.floor(parsed)))
          : prev.syncIntervalMinutes,
      }));
      return;
    }
    if (type === 'checkbox') {
      return;
    }
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
      setMessage(tenantMode ? 'Tenant SMTP/IMAP-Konfiguration erfolgreich aktualisiert' : 'SMTP/IMAP-Konfiguration erfolgreich aktualisiert');
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
      <div className="flex justify-center items-center h-64">
        <i className="fa-solid fa-spinner fa-spin" />
      </div>
    );
  }

  if (!canManageScope) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-4">
        Für den aktuell gewählten Kontext fehlen die Berechtigungen zur SMTP/IMAP-Konfiguration.
      </div>
    );
  }

  if (tenantMode && !activeTenantId) {
    return (
      <div className="bg-slate-100 border border-slate-200 text-slate-700 rounded-lg p-4">
        Kein Mandant gewählt. Bitte zuerst einen Mandanten-Kontext auswählen.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold">E-Mail-Konfiguration (SMTP/IMAP)</h2>
        <p className="text-sm text-slate-600">
          Kontext: {tenantMode ? `Mandant (${activeTenantId})` : 'Plattform / Global'}
        </p>
      </div>

      {message && (
        <div
          className={`message-banner p-4 rounded-lg flex items-center gap-2 ${
            messageType === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
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

      <div className="bg-white rounded-lg shadow p-6 space-y-5">
        <h3 className="text-lg font-semibold">SMTP (ausgehend)</h3>

        <div>
          <label className="block text-sm font-medium mb-1">
            SMTP-Host
            <SourceTag source={smtpSources.smtpHost} />
          </label>
          <input
            type="text"
            name="smtpHost"
            value={smtpConfig.smtpHost}
            onChange={handleSmtpChange}
            placeholder="z.B. smtp.gmail.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            SMTP-Port
            <SourceTag source={smtpSources.smtpPort} />
          </label>
          <select
            name="smtpPort"
            value={smtpConfig.smtpPort}
            onChange={handleSmtpChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="25">25 (Unverschlüsselt)</option>
            <option value="465">465 (SSL)</option>
            <option value="587">587 (TLS)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Benutzername
            <SourceTag source={smtpSources.smtpUser} />
          </label>
          <input
            type="text"
            name="smtpUser"
            value={smtpConfig.smtpUser}
            onChange={handleSmtpChange}
            placeholder="z.B. info@example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Passwort
            <SourceTag source={smtpSources.smtpPassword} />
          </label>
          <input
            type="password"
            name="smtpPassword"
            value={smtpConfig.smtpPassword}
            onChange={handleSmtpChange}
            placeholder={
              smtpConfig.smtpPassword === '***'
                ? 'Passwort ist gespeichert (neues Passwort eingeben zum Ändern)'
                : 'Passwort eingeben'
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Absender-E-Mail
            <SourceTag source={smtpSources.smtpFromEmail} />
          </label>
          <input
            type="email"
            name="smtpFromEmail"
            value={smtpConfig.smtpFromEmail}
            onChange={handleSmtpChange}
            placeholder="z.B. noreply@example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Absender-Name
            <SourceTag source={smtpSources.smtpFromName} />
          </label>
          <input
            type="text"
            name="smtpFromName"
            value={smtpConfig.smtpFromName}
            onChange={handleSmtpChange}
            placeholder="z.B. behebes.AI"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-5">
        <h3 className="text-lg font-semibold">IMAP (eingehend / Ticket-Antworten)</h3>

        <div>
          <label className="block text-sm font-medium mb-1">
            IMAP aktiviert
            <SourceTag source={imapSources.enabled} />
          </label>
          <select
            name="enabled"
            value={imapConfig.enabled ? 'true' : 'false'}
            onChange={handleImapChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="false">Deaktiviert</option>
            <option value="true">Aktiviert</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            IMAP-Host
            <SourceTag source={imapSources.imapHost} />
          </label>
          <input
            type="text"
            name="imapHost"
            value={imapConfig.imapHost}
            onChange={handleImapChange}
            placeholder="z.B. imap.gmail.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              IMAP-Port
              <SourceTag source={imapSources.imapPort} />
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              name="imapPort"
              value={imapConfig.imapPort}
              onChange={handleImapChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Transport
              <SourceTag source={imapSources.imapSecure} />
            </label>
            <select
              name="imapSecure"
              value={imapConfig.imapSecure ? 'true' : 'false'}
              onChange={handleImapChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="true">TLS/SSL (empfohlen)</option>
              <option value="false">Klartext</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            IMAP-Benutzer
            <SourceTag source={imapSources.imapUser} />
          </label>
          <input
            type="text"
            name="imapUser"
            value={imapConfig.imapUser}
            onChange={handleImapChange}
            placeholder="z.B. info@example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            IMAP-Passwort
            <SourceTag source={imapSources.imapPassword} />
          </label>
          <input
            type="password"
            name="imapPassword"
            value={imapConfig.imapPassword}
            onChange={handleImapChange}
            placeholder={
              imapConfig.imapPassword === '***'
                ? 'Passwort ist gespeichert (neues Passwort eingeben zum Ändern)'
                : 'Passwort eingeben'
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Mailbox-Ordner
              <SourceTag source={imapSources.imapMailbox} />
            </label>
            <input
              type="text"
              name="imapMailbox"
              value={imapConfig.imapMailbox}
              onChange={handleImapChange}
              placeholder="INBOX"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Sync-Limit pro Lauf
              <SourceTag source={imapSources.syncLimit} />
            </label>
            <input
              type="number"
              min={1}
              max={500}
              name="syncLimit"
              value={imapConfig.syncLimit}
              onChange={handleImapChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Abrufintervall (Minuten)
              <SourceTag source={imapSources.syncIntervalMinutes} />
            </label>
            <input
              type="number"
              min={1}
              max={1440}
              name="syncIntervalMinutes"
              value={imapConfig.syncIntervalMinutes}
              onChange={handleImapChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-6">
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? (
            <span>
              <i className="fa-solid fa-spinner fa-spin" /> Wird gespeichert...
            </span>
          ) : (
            <span>
              <i className="fa-solid fa-floppy-disk" /> Speichern
            </span>
          )}
        </button>
        <button onClick={handleMailboxSync} disabled={syncing} className="btn btn-secondary">
          {syncing ? (
            <span>
              <i className="fa-solid fa-spinner fa-spin" /> Synchronisiere...
            </span>
          ) : (
            <span>
              <i className="fa-solid fa-cloud-arrow-down" /> IMAP jetzt synchronisieren
            </span>
          )}
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-300 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2">
          <i className="fa-solid fa-circle-info" /> Hinweise
        </h3>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li>Ausgehende E-Mails erhalten automatisch die Ticket-ID im Betreff.</li>
          <li>Antwortmails werden per IMAP importiert und mit Ticketdetails verknüpft.</li>
          <li>Das Postfach wird automatisch im konfigurierten Abrufintervall synchronisiert.</li>
          <li>Die Ansicht der importierten Mails findest du unter „E-Mail Postfach“ im Hauptmenü.</li>
        </ul>
      </div>
    </div>
  );
};

export default EmailSettings;
