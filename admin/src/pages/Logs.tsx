import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTableSelection } from '../lib/tableSelection';
import './Audit.css';

interface LogsProps {
  token: string;
}

interface Log {
  id: string;
  ticketId: string;
  aiDecision: string;
  adminFeedback: string;
  createdAt: string;
}

type SortKey = 'createdAt' | 'ticketId';
type SortDirection = 'asc' | 'desc';

const Logs: React.FC<LogsProps> = ({ token }) => {
  const [logs, setLogs] = useState<Log[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchLogs = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    try {
      if (!silent) {
        setIsLoading(true);
      }
      const response = await axios.get('/api/admin/logs', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLogs(Array.isArray(response.data) ? response.data : []);
      setError('');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Laden der Logs');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchLogs({ silent: true });
      }
    }, 12000);
    return () => clearInterval(timer);
  }, [token]);

  const filteredLogs = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return logs;
    return logs.filter((log) => {
      const haystack = [log.ticketId, log.aiDecision, log.adminFeedback]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [logs, search]);

  const sortedLogs = useMemo(() => {
    const toDate = (value?: string) => {
      if (!value) return 0;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    };
    return [...filteredLogs].sort((a, b) => {
      const comparison =
        sortKey === 'ticketId'
          ? (a.ticketId || '').localeCompare(b.ticketId || '', 'de', { sensitivity: 'base' })
          : toDate(a.createdAt) - toDate(b.createdAt);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredLogs, sortDirection, sortKey]);

  const selection = useTableSelection(sortedLogs);

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return '↕';
    return sortDirection === 'asc' ? '▲' : '▼';
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const formatDate = (value?: string) => {
    if (!value) return '–';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '–';
    return date.toLocaleString('de-DE');
  };

  const handleBulkDelete = async () => {
    if (selection.selectedRows.length === 0) {
      setError('Keine AI-Logs ausgewählt.');
      return;
    }
    if (!window.confirm(`${selection.selectedRows.length} AI-Log-Einträge wirklich löschen?`)) {
      return;
    }
    setBulkLoading(true);
    setError('');
    setSuccess('');
    try {
      await axios.delete('/api/admin/logs', {
        headers: { Authorization: `Bearer ${token}` },
        data: { ids: selection.selectedRows.map((log) => log.id) },
      });
      setLogs((prev) => prev.filter((log) => !selection.selectedSet.has(log.id)));
      setSuccess(`${selection.selectedRows.length} AI-Log-Eintrag/Einträge gelöscht.`);
      selection.clearSelection();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Löschen der AI-Logs');
      } else {
        setError('Fehler beim Löschen der AI-Logs');
      }
    } finally {
      setBulkLoading(false);
    }
  };

  if (isLoading) return <div className="loading">Lädt...</div>;

  return (
    <div className="audit-page">
      <h2>AI Decision Logs</h2>
      <div className="audit-toolbar">
        <div className="left">
          <input
            className="audit-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Suche Ticket, AI-Entscheidung, Feedback..."
          />
          <button className="bulk-btn info" type="button" onClick={() => fetchLogs()} disabled={bulkLoading}>
            <i className="fa-solid fa-rotate" /> Aktualisieren
          </button>
        </div>
      </div>

      {selection.selectedCount > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-actions-meta">
            <span className="count">{selection.selectedCount}</span>
            <span>ausgewählt</span>
          </div>
          <div className="bulk-actions-buttons">
            <button className="bulk-btn danger" type="button" onClick={handleBulkDelete} disabled={bulkLoading}>
              <i className="fa-solid fa-trash" /> Löschen
            </button>
            <button className="bulk-btn" type="button" onClick={selection.clearSelection} disabled={bulkLoading}>
              Auswahl aufheben
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {sortedLogs.length === 0 ? (
        <p>Keine Logs vorhanden</p>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th className="table-select-col">
                  <input
                    type="checkbox"
                    className="table-select-checkbox"
                    checked={selection.areAllSelected(sortedLogs)}
                    onChange={() => selection.toggleAll(sortedLogs)}
                    aria-label="Alle Logs auswählen"
                  />
                </th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => toggleSort('ticketId')}>
                    Ticket ID {sortIcon('ticketId')}
                  </button>
                </th>
                <th>AI Decision</th>
                <th>Admin Feedback</th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => toggleSort('createdAt')}>
                    Datum {sortIcon('createdAt')}
                  </button>
                </th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {sortedLogs.map((log) => (
                <tr key={log.id}>
                  <td className="table-select-cell">
                    <input
                      type="checkbox"
                      className="table-select-checkbox"
                      checked={selection.isSelected(log.id)}
                      onChange={() => selection.toggleRow(log.id)}
                      aria-label={`Log ${log.id} auswählen`}
                    />
                  </td>
                  <td>{log.ticketId || '–'}</td>
                  <td>{log.aiDecision || '-'}</td>
                  <td>{log.adminFeedback || '-'}</td>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>
                    <button
                      className="bulk-btn danger"
                      type="button"
                      disabled={bulkLoading}
                      onClick={async () => {
                        if (!window.confirm('AI-Log wirklich löschen?')) return;
                        try {
                          await axios.delete(`/api/admin/logs/${log.id}`, {
                            headers: { Authorization: `Bearer ${token}` },
                          });
                          setLogs((prev) => prev.filter((item) => item.id !== log.id));
                          setSuccess('AI-Log gelöscht.');
                          setError('');
                        } catch (err) {
                          if (axios.isAxiosError(err)) {
                            setError(err.response?.data?.message || 'Löschen fehlgeschlagen');
                          } else {
                            setError('Löschen fehlgeschlagen');
                          }
                        }
                      }}
                    >
                      <i className="fa-solid fa-trash" /> Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Logs;

