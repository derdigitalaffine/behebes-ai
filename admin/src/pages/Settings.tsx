import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';

interface SMTPConfig {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  smtpFromEmail: string;
  smtpFromName: string;
}

const Settings: React.FC = () => {
  const [config, setConfig] = useState<SMTPConfig>({
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPassword: '',
    smtpFromEmail: '',
    smtpFromName: 'OI App',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await axios.get('/api/admin/config/smtp', {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });
      setConfig(response.data);
    } catch (error) {
      setMessageType('error');
      setMessage('Fehler beim Laden der Einstellungen');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.patch('/api/admin/config/smtp', config, {
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
      });
      setMessageType('success');
      setMessage('SMTP-Konfiguration erfolgreich aktualisiert');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessageType('error');
      setMessage('Fehler beim Speichern der Konfiguration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <i className="fa-solid fa-spinner fa-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Einstellungen</h1>

      {message && (
        <div
          className={`message-banner mb-6 p-4 rounded-lg flex items-center gap-2 ${
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

      <div className="card">
        <h2 className="text-xl font-semibold mb-4">SMTP-Konfiguration</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">SMTP-Host</label>
            <input
              type="text"
              name="smtpHost"
              value={config.smtpHost}
              onChange={handleChange}
              placeholder="z.B. smtp.gmail.com"
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">SMTP-Port</label>
            <select
              name="smtpPort"
              value={config.smtpPort}
              onChange={handleChange}
              className="input w-full"
            >
              <option value="25">25 (Unverschlüsselt)</option>
              <option value="465">465 (SSL)</option>
              <option value="587">587 (TLS)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Benutzername</label>
            <input
              type="text"
              name="smtpUser"
              value={config.smtpUser}
              onChange={handleChange}
              placeholder="z.B. info@example.com"
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Passwort</label>
            <input
              type="password"
              name="smtpPassword"
              value={config.smtpPassword}
              onChange={handleChange}
              placeholder="Passwort eingeben"
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Absender-E-Mail
            </label>
            <input
              type="email"
              name="smtpFromEmail"
              value={config.smtpFromEmail}
              onChange={handleChange}
              placeholder="z.B. noreply@example.com"
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Absender-Name
            </label>
            <input
              type="text"
              name="smtpFromName"
              value={config.smtpFromName}
              onChange={handleChange}
              placeholder="z.B. OI App"
              className="input w-full"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? 'Wird gespeichert...' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
