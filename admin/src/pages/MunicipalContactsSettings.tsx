import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';

type LocationType = 'city' | 'postal_code';

interface MunicipalContactPerson {
  name: string;
  email: string;
  deputyName: string;
  deputyEmail: string;
}

interface MunicipalContactEntry extends MunicipalContactPerson {
  id: string;
  label: string;
  locationType: LocationType;
  locationValue: string;
  notes: string;
  active: boolean;
}

interface MunicipalContactsConfig {
  version: number;
  updatedAt: string;
  fallback: MunicipalContactPerson;
  entries: MunicipalContactEntry[];
}

const EMPTY_PERSON: MunicipalContactPerson = {
  name: '',
  email: '',
  deputyName: '',
  deputyEmail: '',
};

const DEFAULT_CONFIG: MunicipalContactsConfig = {
  version: 1,
  updatedAt: '',
  fallback: { ...EMPTY_PERSON },
  entries: [],
};

function createEntryId(): string {
  return `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const MunicipalContactsSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');
  const [config, setConfig] = useState<MunicipalContactsConfig>(DEFAULT_CONFIG);

  const fetchConfig = async () => {
    try {
      const response = await axios.get('/api/admin/config/municipal-contacts', {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const payload = response.data || {};
      const fallback =
        payload.fallback && typeof payload.fallback === 'object'
          ? {
              name: String(payload.fallback.name || ''),
              email: String(payload.fallback.email || ''),
              deputyName: String(payload.fallback.deputyName || ''),
              deputyEmail: String(payload.fallback.deputyEmail || ''),
            }
          : { ...EMPTY_PERSON };
      const entries = Array.isArray(payload.entries)
        ? payload.entries.map((entry: any, index: number) => ({
            id: String(entry?.id || `${createEntryId()}-${index + 1}`),
            label: String(entry?.label || ''),
            locationType: entry?.locationType === 'postal_code' ? 'postal_code' : 'city',
            locationValue: String(entry?.locationValue || ''),
            name: String(entry?.name || ''),
            email: String(entry?.email || ''),
            deputyName: String(entry?.deputyName || ''),
            deputyEmail: String(entry?.deputyEmail || ''),
            notes: String(entry?.notes || ''),
            active: entry?.active !== false,
          }))
        : [];
      setConfig({
        version: Number(payload.version) || 1,
        updatedAt: String(payload.updatedAt || ''),
        fallback,
        entries,
      });
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Kommunale Ansprechpartner konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchConfig();
  }, []);

  const updateFallback = (patch: Partial<MunicipalContactPerson>) => {
    setConfig((prev) => ({
      ...prev,
      fallback: {
        ...prev.fallback,
        ...patch,
      },
    }));
  };

  const updateEntry = (entryId: string, patch: Partial<MunicipalContactEntry>) => {
    setConfig((prev) => ({
      ...prev,
      entries: prev.entries.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    }));
  };

  const addEntry = () => {
    setConfig((prev) => ({
      ...prev,
      entries: [
        ...prev.entries,
        {
          id: createEntryId(),
          label: '',
          locationType: 'city',
          locationValue: '',
          name: '',
          email: '',
          deputyName: '',
          deputyEmail: '',
          notes: '',
          active: true,
        },
      ],
    }));
  };

  const removeEntry = (entryId: string) => {
    setConfig((prev) => ({
      ...prev,
      entries: prev.entries.filter((entry) => entry.id !== entryId),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    setMessageType('');
    try {
      const payload = {
        fallback: config.fallback,
        entries: config.entries,
      };
      const response = await axios.patch('/api/admin/config/municipal-contacts', payload, {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      setMessageType('success');
      setMessage(response.data?.message || 'Kommunale Ansprechpartner gespeichert.');
      await fetchConfig();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Speichern fehlgeschlagen.');
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
    <div className="space-y-6">
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

      <div className="card">
        <h3 className="text-xl font-semibold mb-2">Fallback-Kontakt</h3>
        <p className="setting-help mb-4">
          Dieser Kontakt wird genutzt, wenn für Ort oder PLZ keine aktive Zuordnung mit gültiger E-Mail vorhanden ist.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label>
            <span className="editor-label">Name</span>
            <input
              className="editor-input"
              value={config.fallback.name}
              onChange={(event) => updateFallback({ name: event.target.value })}
            />
          </label>
          <label>
            <span className="editor-label">E-Mail</span>
            <input
              className="editor-input"
              type="email"
              value={config.fallback.email}
              onChange={(event) => updateFallback({ email: event.target.value })}
            />
          </label>
          <label>
            <span className="editor-label">Vertretung Name (optional)</span>
            <input
              className="editor-input"
              value={config.fallback.deputyName}
              onChange={(event) => updateFallback({ deputyName: event.target.value })}
            />
          </label>
          <label>
            <span className="editor-label">Vertretung E-Mail (optional)</span>
            <input
              className="editor-input"
              type="email"
              value={config.fallback.deputyEmail}
              onChange={(event) => updateFallback({ deputyEmail: event.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-xl font-semibold">Zuständigkeits-Zuordnungen</h3>
          <button type="button" className="btn btn-secondary" onClick={addEntry}>
            <i className="fa-solid fa-plus" /> Ansprechpartner hinzufuegen
          </button>
        </div>
        <p className="setting-help mb-4">
          Reihenfolge: zuerst PLZ-Treffer, dann Ort, danach Fallback. Inaktive Eintraege werden ignoriert.
        </p>

        <div className="space-y-4">
          {config.entries.length === 0 && (
            <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              Noch keine Zuordnungen vorhanden.
            </div>
          )}

          {config.entries.map((entry, index) => (
            <div key={entry.id} className="rounded border border-slate-200 p-4 bg-white">
              <div className="flex justify-between items-center mb-3">
                <strong>Eintrag {index + 1}</strong>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => removeEntry(entry.id)}
                >
                  Entfernen
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label>
                  <span className="editor-label">Bezeichnung</span>
                  <input
                    className="editor-input"
                    value={entry.label}
                    onChange={(event) => updateEntry(entry.id, { label: event.target.value })}
                    placeholder="z. B. Otterberg"
                  />
                </label>
                <label>
                  <span className="editor-label">Zuordnung über</span>
                  <select
                    className="editor-input"
                    value={entry.locationType}
                    onChange={(event) =>
                      updateEntry(entry.id, {
                        locationType: event.target.value === 'postal_code' ? 'postal_code' : 'city',
                      })
                    }
                  >
                    <option value="city">Ort</option>
                    <option value="postal_code">PLZ</option>
                  </select>
                </label>
                <label>
                  <span className="editor-label">
                    {entry.locationType === 'postal_code' ? 'PLZ-Wert' : 'Ortsname'}
                  </span>
                  <input
                    className="editor-input"
                    value={entry.locationValue}
                    onChange={(event) => updateEntry(entry.id, { locationValue: event.target.value })}
                    placeholder={entry.locationType === 'postal_code' ? 'z. B. 67731' : 'z. B. Otterbach'}
                  />
                </label>
                <label>
                  <span className="editor-label">Ortsbürgermeister Name</span>
                  <input
                    className="editor-input"
                    value={entry.name}
                    onChange={(event) => updateEntry(entry.id, { name: event.target.value })}
                  />
                </label>
                <label>
                  <span className="editor-label">Ortsbürgermeister E-Mail</span>
                  <input
                    className="editor-input"
                    type="email"
                    value={entry.email}
                    onChange={(event) => updateEntry(entry.id, { email: event.target.value })}
                  />
                </label>
                <label className="checkbox-label mt-7">
                  <input
                    type="checkbox"
                    checked={entry.active !== false}
                    onChange={(event) => updateEntry(entry.id, { active: event.target.checked })}
                  />
                  <span>Eintrag aktiv</span>
                </label>
                <label>
                  <span className="editor-label">Vertretung Name (optional)</span>
                  <input
                    className="editor-input"
                    value={entry.deputyName}
                    onChange={(event) => updateEntry(entry.id, { deputyName: event.target.value })}
                  />
                </label>
                <label>
                  <span className="editor-label">Vertretung E-Mail (optional)</span>
                  <input
                    className="editor-input"
                    type="email"
                    value={entry.deputyEmail}
                    onChange={(event) => updateEntry(entry.id, { deputyEmail: event.target.value })}
                  />
                </label>
                <label className="md:col-span-3">
                  <span className="editor-label">Notiz (optional)</span>
                  <input
                    className="editor-input"
                    value={entry.notes}
                    onChange={(event) => updateEntry(entry.id, { notes: event.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
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
      </div>
    </div>
  );
};

export default MunicipalContactsSettings;
