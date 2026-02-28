import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';
import SourceTag from '../components/SourceTag';

interface WeatherApiConfig {
  enabled: boolean;
  provider: 'open-meteo';
  archiveBaseUrl: string;
  forecastBaseUrl: string;
  apiKey: string;
  apiKeyMode: 'none' | 'header' | 'query';
  apiKeyHeaderName: string;
  apiKeyQueryParam: string;
  timeoutMs: number;
  userAgent: string;
  temperatureUnit: 'celsius' | 'fahrenheit';
  windSpeedUnit: 'kmh' | 'ms' | 'mph' | 'kn';
  precipitationUnit: 'mm' | 'inch';
}

const DEFAULT_CONFIG: WeatherApiConfig = {
  enabled: true,
  provider: 'open-meteo',
  archiveBaseUrl: 'https://archive-api.open-meteo.com',
  forecastBaseUrl: 'https://api.open-meteo.com',
  apiKey: '',
  apiKeyMode: 'none',
  apiKeyHeaderName: 'X-API-Key',
  apiKeyQueryParam: 'apikey',
  timeoutMs: 5500,
  userAgent: 'behebes-ai/1.0 (Verbandsgemeinde Otterbach Otterberg)',
  temperatureUnit: 'celsius',
  windSpeedUnit: 'kmh',
  precipitationUnit: 'mm',
};

const WeatherApiSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<WeatherApiConfig>(DEFAULT_CONFIG);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');
  const [testLatitude, setTestLatitude] = useState('49.4453');
  const [testLongitude, setTestLongitude] = useState('7.7694');
  const [testTimestamp, setTestTimestamp] = useState('');
  const [testResult, setTestResult] = useState<Record<string, any> | null>(null);

  const fetchConfig = async () => {
    try {
      const response = await axios.get('/api/admin/config/weather-api', {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const payload = response.data || {};
      const { sources: nextSources, ...rest } = payload;
      setConfig({
        ...DEFAULT_CONFIG,
        ...(rest || {}),
      });
      setSources(nextSources || {});
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Wetter-API-Konfiguration konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    setMessageType('');
    try {
      await axios.patch('/api/admin/config/weather-api', config, {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      setMessageType('success');
      setMessage('Wetter-API-Konfiguration gespeichert.');
      await fetchConfig();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Fehler beim Speichern der Wetter-API-Konfiguration.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage('');
    setMessageType('');
    setTestResult(null);
    try {
      const latitude = Number(testLatitude);
      const longitude = Number(testLongitude);
      const payload: Record<string, any> = {};
      if (Number.isFinite(latitude)) payload.latitude = latitude;
      if (Number.isFinite(longitude)) payload.longitude = longitude;
      if (testTimestamp.trim()) payload.reportedAt = testTimestamp.trim();

      const response = await axios.post('/api/admin/config/weather-api/test', payload, {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      setTestResult(response.data || null);
      setMessageType('success');
      setMessage(response.data?.message || 'Wetter-API-Test erfolgreich.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Wetter-API-Test fehlgeschlagen.');
    } finally {
      setTesting(false);
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
    <div>
      {message && (
        <div
          className={`message-banner mb-6 p-4 rounded-lg flex items-center gap-2 ${
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
        <h2 className="text-xl font-semibold mb-4">Wetter-API Konfiguration</h2>
        <p className="text-sm text-gray-600 mb-5">
          Diese Konfiguration wird für Wetterdaten zum Meldezeitpunkt genutzt (Ticket-Erstellung, Refresh, Klassifizierungs-Kontext).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="checkbox-label mt-6">
            <input
              type="checkbox"
              checked={config.enabled === true}
              onChange={(e) => setConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            <span>Wetter-API aktiv</span>
          </label>

          <div>
            <label className="block text-sm font-medium mb-2">
              Provider
              <SourceTag source={sources.provider} />
            </label>
            <input className="input w-full" value={config.provider} disabled />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Archiv Base URL
              <SourceTag source={sources.archiveBaseUrl} />
            </label>
            <input
              className="input w-full"
              value={config.archiveBaseUrl}
              onChange={(e) => setConfig((prev) => ({ ...prev, archiveBaseUrl: e.target.value }))}
              placeholder="https://archive-api.open-meteo.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Forecast Base URL
              <SourceTag source={sources.forecastBaseUrl} />
            </label>
            <input
              className="input w-full"
              value={config.forecastBaseUrl}
              onChange={(e) => setConfig((prev) => ({ ...prev, forecastBaseUrl: e.target.value }))}
              placeholder="https://api.open-meteo.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              API Key
              <SourceTag source={sources.apiKey} />
            </label>
            <input
              className="input w-full"
              value={config.apiKey}
              onChange={(e) => setConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder={config.apiKey ? '***' : 'optional'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              API Key Modus
              <SourceTag source={sources.apiKeyMode} />
            </label>
            <select
              className="input w-full"
              value={config.apiKeyMode}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  apiKeyMode:
                    e.target.value === 'header' || e.target.value === 'query' ? e.target.value : 'none',
                }))
              }
            >
              <option value="none">Kein API Key</option>
              <option value="header">Header</option>
              <option value="query">Query-Parameter</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              API Key Header Name
              <SourceTag source={sources.apiKeyHeaderName} />
            </label>
            <input
              className="input w-full"
              value={config.apiKeyHeaderName}
              onChange={(e) => setConfig((prev) => ({ ...prev, apiKeyHeaderName: e.target.value }))}
              placeholder="X-API-Key"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              API Key Query-Parameter
              <SourceTag source={sources.apiKeyQueryParam} />
            </label>
            <input
              className="input w-full"
              value={config.apiKeyQueryParam}
              onChange={(e) => setConfig((prev) => ({ ...prev, apiKeyQueryParam: e.target.value }))}
              placeholder="apikey"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Timeout (ms)
              <SourceTag source={sources.timeoutMs} />
            </label>
            <input
              type="number"
              min={500}
              max={30000}
              className="input w-full"
              value={config.timeoutMs}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  timeoutMs: Math.max(500, Math.min(30000, Number(e.target.value || 5500))),
                }))
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              User-Agent
              <SourceTag source={sources.userAgent} />
            </label>
            <input
              className="input w-full"
              value={config.userAgent}
              onChange={(e) => setConfig((prev) => ({ ...prev, userAgent: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Temperature Unit
              <SourceTag source={sources.temperatureUnit} />
            </label>
            <select
              className="input w-full"
              value={config.temperatureUnit}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  temperatureUnit: e.target.value === 'fahrenheit' ? 'fahrenheit' : 'celsius',
                }))
              }
            >
              <option value="celsius">celsius</option>
              <option value="fahrenheit">fahrenheit</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Wind Speed Unit
              <SourceTag source={sources.windSpeedUnit} />
            </label>
            <select
              className="input w-full"
              value={config.windSpeedUnit}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  windSpeedUnit:
                    e.target.value === 'ms' || e.target.value === 'mph' || e.target.value === 'kn'
                      ? e.target.value
                      : 'kmh',
                }))
              }
            >
              <option value="kmh">kmh</option>
              <option value="ms">ms</option>
              <option value="mph">mph</option>
              <option value="kn">kn</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Precipitation Unit
              <SourceTag source={sources.precipitationUnit} />
            </label>
            <select
              className="input w-full"
              value={config.precipitationUnit}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  precipitationUnit: e.target.value === 'inch' ? 'inch' : 'mm',
                }))
              }
            >
              <option value="mm">mm</option>
              <option value="inch">inch</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Speichere...' : 'Konfiguration speichern'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void fetchConfig()} disabled={saving}>
            Neu laden
          </button>
        </div>
      </div>

      <div className="card mt-8">
        <h3 className="text-lg font-semibold mb-4">Verbindung testen</h3>
        <p className="text-sm text-gray-600 mb-4">
          Testet die aktuell gespeicherte Konfiguration mit Koordinaten und optionalem Meldezeitpunkt.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Breitengrad</label>
            <input className="input w-full" value={testLatitude} onChange={(e) => setTestLatitude(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Längengrad</label>
            <input className="input w-full" value={testLongitude} onChange={(e) => setTestLongitude(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Meldezeitpunkt (ISO, optional)</label>
            <input
              className="input w-full"
              value={testTimestamp}
              onChange={(e) => setTestTimestamp(e.target.value)}
              placeholder="2026-02-23T10:15:00Z"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button type="button" className="btn btn-primary" onClick={handleTest} disabled={testing}>
            {testing ? 'Teste...' : 'Wetter-API testen'}
          </button>
        </div>

        {testResult && (
          <div className="mt-5">
            <div className="text-sm font-semibold mb-2">Testergebnis</div>
            <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-4 whitespace-pre-wrap">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default WeatherApiSettings;
