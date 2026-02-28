import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './Audit.css';

interface ApiTokenItem {
  id: string;
  label?: string;
  tokenPrefix: string;
  createdAt?: string | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  isExpired?: boolean;
  isActive?: boolean;
}

interface ApiTokensProps {
  token: string;
}

type TokenStatusFilter = 'active' | 'all' | 'revoked';

function toLocalDateTimeInput(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

const APITokens: React.FC<ApiTokensProps> = ({ token }) => {
  const [items, setItems] = useState<ApiTokenItem[]>([]);
  const [status, setStatus] = useState<TokenStatusFilter>('active');
  const [loading, setLoading] = useState(true);
  const [createLoading, setCreateLoading] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<{ active: number; revoked: number; expired: number }>({
    active: 0,
    revoked: 0,
    expired: 0,
  });
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState(toLocalDateTimeInput(90));
  const [createdToken, setCreatedToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchTokens = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await axios.get('/api/admin/api-tokens', {
        headers: { Authorization: `Bearer ${token}` },
        params: { status },
      });
      setItems(Array.isArray(response.data?.items) ? response.data.items : []);
      setCounts({
        active: Number(response.data?.counts?.active || 0),
        revoked: Number(response.data?.counts?.revoked || 0),
        expired: Number(response.data?.counts?.expired || 0),
      });
      setError('');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'API-Tokens konnten nicht geladen werden.');
      } else {
        setError('API-Tokens konnten nicht geladen werden.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTokens();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchTokens(true);
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [status, token]);

  const formatDate = (value?: string | null) => {
    if (!value) return '–';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '–';
    return date.toLocaleString('de-DE');
  };

  const copyText = async (value: string, successText: string) => {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.focus();
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setMessage(successText);
      setError('');
    } catch {
      setError('Kopieren in die Zwischenablage fehlgeschlagen.');
    }
  };

  const handleCreateToken = async () => {
    setCreateLoading(true);
    setError('');
    setMessage('');
    setCreatedToken('');
    try {
      const response = await axios.post(
        '/api/admin/api-tokens',
        {
          label: label.trim(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const tokenValue = String(response.data?.token || '').trim();
      if (tokenValue) {
        setCreatedToken(tokenValue);
      }
      setLabel('');
      setExpiresAt(toLocalDateTimeInput(90));
      setMessage('API-Token erzeugt. Klartext wird nur einmal angezeigt.');
      await fetchTokens(true);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'API-Token konnte nicht erzeugt werden.');
      } else {
        setError('API-Token konnte nicht erzeugt werden.');
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const handleRevoke = async (item: ApiTokenItem) => {
    if (!item.id) return;
    if (!window.confirm('API-Token wirklich widerrufen?')) return;
    setRevokeLoading((prev) => ({ ...prev, [item.id]: true }));
    setError('');
    setMessage('');
    try {
      await axios.post(
        `/api/admin/api-tokens/${item.id}/revoke`,
        { reason: 'revoked_by_user' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage('API-Token widerrufen.');
      await fetchTokens(true);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'API-Token konnte nicht widerrufen werden.');
      } else {
        setError('API-Token konnte nicht widerrufen werden.');
      }
    } finally {
      setRevokeLoading((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  return (
    <div className="audit-page">
      <h2>API-Tokens</h2>
      <p className="audit-meta" style={{ marginBottom: '0.8rem' }}>
        API-Tokens sind für automatisierte Zugriffe gedacht. Das Token wird nur direkt nach Erzeugung im Klartext angezeigt.
      </p>

      <div className="bulk-actions-bar" style={{ marginBottom: '1rem' }}>
        <div className="bulk-actions-buttons" style={{ width: '100%' }}>
          <input
            className="audit-input"
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Bezeichnung (z. B. n8n Produktion)"
            maxLength={120}
            disabled={createLoading}
          />
          <label className="audit-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            Gültig bis
          </label>
          <input
            className="audit-input"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            disabled={createLoading}
          />
          <button
            type="button"
            className="bulk-btn success"
            disabled={createLoading || !expiresAt}
            onClick={() => void handleCreateToken()}
          >
            <i className="fa-solid fa-key" /> {createLoading ? 'Erzeuge...' : 'Token erzeugen'}
          </button>
        </div>
      </div>

      {createdToken && (
        <div className="bulk-actions-bar" style={{ marginBottom: '1rem' }}>
          <div className="bulk-actions-meta">
            <span className="count">
              <i className="fa-solid fa-triangle-exclamation" />
            </span>
            <span>Nur einmal sichtbar</span>
          </div>
          <div className="bulk-actions-buttons" style={{ width: '100%' }}>
            <span className="audit-code" style={{ fontSize: '0.88rem' }}>{createdToken}</span>
            <button
              type="button"
              className="bulk-btn info"
              onClick={() => void copyText(createdToken, 'API-Token in die Zwischenablage kopiert.')}
            >
              <i className="fa-solid fa-copy" /> Token kopieren
            </button>
          </div>
        </div>
      )}

      <div className="audit-toolbar">
        <div className="left">
          <label htmlFor="api-token-status">Status</label>
          <select
            id="api-token-status"
            className="audit-select"
            value={status}
            onChange={(event) => setStatus(event.target.value as TokenStatusFilter)}
          >
            <option value="active">Aktiv</option>
            <option value="revoked">Widerrufen</option>
            <option value="all">Alle</option>
          </select>
          <button
            className="bulk-btn info"
            type="button"
            onClick={() => void fetchTokens()}
            disabled={loading}
          >
            <i className="fa-solid fa-rotate" /> Aktualisieren
          </button>
        </div>
        <div className="right">
          <span className="audit-pill">Aktiv: {counts.active}</span>
          <span className="audit-pill">Widerrufen: {counts.revoked}</span>
          <span className="audit-pill">Abgelaufen: {counts.expired}</span>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {message && <div className="success-message">{message}</div>}

      {loading ? (
        <div className="loading">Lade API-Tokens...</div>
      ) : items.length === 0 ? (
        <p>Keine API-Tokens vorhanden.</p>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Bezeichnung</th>
                <th>Präfix</th>
                <th>Erstellt</th>
                <th>Gültig bis</th>
                <th>Zuletzt genutzt</th>
                <th>Status</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isRevoked = !!item.revokedAt;
                const isExpired = !!item.isExpired && !isRevoked;
                const isActive = !!item.isActive;
                const rowBusy = !!revokeLoading[item.id];
                return (
                  <tr key={item.id}>
                    <td>
                      <div>{item.label || '–'}</div>
                      <div className="audit-meta">{item.id}</div>
                    </td>
                    <td>
                      <span className="audit-code">{item.tokenPrefix}…</span>
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>{formatDate(item.expiresAt)}</td>
                    <td>{formatDate(item.lastUsedAt)}</td>
                    <td>
                      {isActive && <div className="audit-event info">aktiv</div>}
                      {isExpired && <div className="audit-event warning">abgelaufen</div>}
                      {isRevoked && <div className="audit-event error">widerrufen</div>}
                      {item.revokeReason ? <div className="audit-meta">{item.revokeReason}</div> : null}
                    </td>
                    <td>
                      <div className="audit-row-actions">
                        <button
                          type="button"
                          className="bulk-btn warning"
                          disabled={!isActive || rowBusy}
                          onClick={() => void handleRevoke(item)}
                        >
                          <i className="fa-solid fa-ban" /> Widerrufen
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default APITokens;
