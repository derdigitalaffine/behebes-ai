import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTableSelection } from '../lib/tableSelection';
import './Audit.css';

interface JournalEvent {
  id: string;
  eventType: string;
  severity?: 'info' | 'warning' | 'error';
  username?: string;
  role?: string;
  method?: string;
  path?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: any;
  createdAt?: string;
}

interface JournalProps {
  token: string;
}

type SortKey = 'createdAt' | 'eventType' | 'username' | 'path' | 'severity';
type SortDirection = 'asc' | 'desc';
type PageSize = 10 | 25 | 50 | 100;

const Journal: React.FC<JournalProps> = ({ token }) => {
  const [items, setItems] = useState<JournalEvent[]>([]);
  const [eventType, setEventType] = useState('');
  const [eventOptions, setEventOptions] = useState<Array<{ eventType: string; count: number }>>([]);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await axios.get('/api/admin/journal', {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            limit: 800,
            offset: 0,
            ...(eventType ? { eventType } : {}),
          },
        });
        setItems(Array.isArray(response.data?.items) ? response.data.items : []);
        setEventOptions(
          Array.isArray(response.data?.availableEventTypes) ? response.data.availableEventTypes : []
        );
        setError('');
      } catch (err) {
        if (axios.isAxiosError(err)) {
          setError(err.response?.data?.message || 'Fehler beim Laden des Journals');
        } else {
          setError('Fehler beim Laden des Journals');
        }
      } finally {
        setIsLoading(false);
      }
    };

    load();
    const timer = setInterval(load, 12000);
    return () => clearInterval(timer);
  }, [token, eventType]);

  useEffect(() => {
    setPage(1);
  }, [eventType, search, pageSize]);

  const formatDate = (value?: string) => {
    if (!value) return '–';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '–';
    return date.toLocaleString('de-DE');
  };

  const detailsAsText = (details: any) => {
    if (!details) return '–';
    try {
      const raw = typeof details === 'string' ? details : JSON.stringify(details);
      return raw.length > 160 ? `${raw.slice(0, 160)}...` : raw;
    } catch {
      return '–';
    }
  };

  const parseDate = (value?: string) => {
    if (!value) return 0;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  };

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((event) => {
      const haystack = [
        event.eventType,
        event.severity,
        event.username,
        event.role,
        event.method,
        event.path,
        event.ipAddress,
        event.userAgent,
        detailsAsText(event.details),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [items, search]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let comparison = 0;
      switch (sortKey) {
        case 'eventType':
          comparison = (a.eventType || '').localeCompare(b.eventType || '', 'de', { sensitivity: 'base' });
          break;
        case 'username':
          comparison = (a.username || '').localeCompare(b.username || '', 'de', { sensitivity: 'base' });
          break;
        case 'path':
          comparison = (a.path || '').localeCompare(b.path || '', 'de', { sensitivity: 'base' });
          break;
        case 'severity':
          comparison = (a.severity || '').localeCompare(b.severity || '', 'de', { sensitivity: 'base' });
          break;
        case 'createdAt':
        default:
          comparison = parseDate(a.createdAt) - parseDate(b.createdAt);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredItems, sortDirection, sortKey]);

  const total = sortedItems.length;
  const selection = useTableSelection(sortedItems);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pageItems = sortedItems.slice(start, start + pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection('asc');
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return '↕';
    return sortDirection === 'asc' ? '▲' : '▼';
  };

  const handleBulkDelete = async () => {
    if (selection.selectedRows.length === 0) {
      setError('Keine Journal-Einträge ausgewählt.');
      return;
    }
    if (!window.confirm(`${selection.selectedRows.length} Journal-Einträge wirklich löschen?`)) {
      return;
    }
    setBulkLoading(true);
    setError('');
    setSuccess('');
    try {
      await axios.delete('/api/admin/journal', {
        headers: { Authorization: `Bearer ${token}` },
        data: { ids: selection.selectedRows.map((entry) => entry.id) },
      });
      setSuccess(`${selection.selectedRows.length} Journal-Eintrag/Einträge gelöscht.`);
      selection.clearSelection();
      await axios
        .get('/api/admin/journal', {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            limit: 800,
            offset: 0,
            ...(eventType ? { eventType } : {}),
          },
        })
        .then((response) => {
          setItems(Array.isArray(response.data?.items) ? response.data.items : []);
          setEventOptions(Array.isArray(response.data?.availableEventTypes) ? response.data.availableEventTypes : []);
        });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Löschen der Journal-Einträge');
      } else {
        setError('Fehler beim Löschen der Journal-Einträge');
      }
    } finally {
      setBulkLoading(false);
    }
  };

  const handleExportSelection = () => {
    if (selection.selectedRows.length === 0) return;
    try {
      const blob = new Blob([JSON.stringify(selection.selectedRows, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      anchor.href = url;
      anchor.download = `journal-auswahl-${stamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccess('Auswahl wurde als JSON exportiert.');
      setError('');
    } catch {
      setError('Auswahl konnte nicht exportiert werden.');
    }
  };

  return (
    <div className="audit-page">
      <h2>Journal</h2>
      <div className="audit-toolbar">
        <div className="left">
          <label htmlFor="event-type">Ereignis</label>
          <select
            id="event-type"
            className="audit-select"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          >
            <option value="">Alle</option>
            {eventOptions.map((item) => (
              <option key={item.eventType} value={item.eventType}>
                {item.eventType} ({item.count})
              </option>
            ))}
          </select>
          <input
            className="audit-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche Ereignis, Benutzer, Pfad..."
          />
          <select
            className="audit-select"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {selection.selectedCount > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-actions-meta">
            <span className="count">{selection.selectedCount}</span>
            <span>ausgewählt</span>
          </div>
          <div className="bulk-actions-buttons">
            <button className="bulk-btn info" type="button" onClick={handleExportSelection} disabled={bulkLoading}>
              <i className="fa-solid fa-file-export" /> Exportieren
            </button>
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
      {isLoading ? (
        <div className="loading">Lade Journal...</div>
      ) : pageItems.length === 0 ? (
        <p>Keine Journal-Einträge gefunden.</p>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th className="table-select-col">
                  <input
                    type="checkbox"
                    className="table-select-checkbox"
                    checked={selection.areAllSelected(pageItems)}
                    onChange={() => selection.toggleAll(pageItems)}
                    aria-label="Alle Journal-Einträge auf der Seite auswählen"
                  />
                </th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => handleSort('createdAt')}>
                    Zeit {sortIcon('createdAt')}
                  </button>
                </th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => handleSort('eventType')}>
                    Ereignis {sortIcon('eventType')}
                  </button>
                </th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => handleSort('username')}>
                    Benutzer {sortIcon('username')}
                  </button>
                </th>
                <th>
                  <button type="button" className="audit-sort" onClick={() => handleSort('path')}>
                    Anfrage {sortIcon('path')}
                  </button>
                </th>
                <th>Client</th>
                <th>Details</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((event) => (
                <tr key={event.id}>
                  <td className="table-select-cell">
                    <input
                      type="checkbox"
                      className="table-select-checkbox"
                      checked={selection.isSelected(event.id)}
                      onChange={() => selection.toggleRow(event.id)}
                      aria-label={`Journal-Eintrag ${event.id} auswählen`}
                    />
                  </td>
                  <td>{formatDate(event.createdAt)}</td>
                  <td>
                    <div className={`audit-event ${event.severity || 'info'}`}>{event.eventType}</div>
                  </td>
                  <td>
                    <div>{event.username || '–'}</div>
                    <div className="audit-meta">{event.role || '–'}</div>
                  </td>
                  <td>
                    <div>{event.method || '–'}</div>
                    <div className="audit-meta">{event.path || '–'}</div>
                  </td>
                  <td>
                    <div>{event.ipAddress || '–'}</div>
                    <div className="audit-meta">{event.userAgent || '–'}</div>
                  </td>
                  <td>
                    <span className="audit-code">{detailsAsText(event.details)}</span>
                  </td>
                  <td>
                    <button
                      className="bulk-btn danger"
                      type="button"
                      disabled={bulkLoading}
                      onClick={async () => {
                        if (!window.confirm('Journal-Eintrag wirklich löschen?')) return;
                        try {
                          await axios.delete(`/api/admin/journal/${event.id}`, {
                            headers: { Authorization: `Bearer ${token}` },
                          });
                          setItems((prev) => prev.filter((item) => item.id !== event.id));
                          setSuccess('Journal-Eintrag gelöscht.');
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
          <div className="audit-pagination">
            <span>
              Zeige {total === 0 ? 0 : start + 1}-{Math.min(start + pageSize, total)} von {total}
            </span>
            <div className="audit-pagination-actions">
              <button type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1}>
                Zurück
              </button>
              <span>Seite {page} / {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
              >
                Weiter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Journal;
