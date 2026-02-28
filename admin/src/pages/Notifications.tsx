import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import './Notifications.css';

interface NotificationsProps {
  token: string;
}

type NotificationStatus = 'open' | 'read' | 'resolved';
type NotificationSeverity = 'info' | 'warning' | 'error';

interface AdminNotification {
  id: string;
  eventType: string;
  severity: NotificationSeverity;
  roleScope: 'all' | 'admin' | 'staff';
  title: string;
  message: string;
  context: Record<string, any> | null;
  relatedTicketId?: string | null;
  relatedExecutionId?: string | null;
  status: NotificationStatus;
  createdAt?: string | null;
  updatedAt?: string | null;
  resolvedAt?: string | null;
  resolvedByAdminId?: string | null;
}

interface NotificationEventDefinition {
  eventType: string;
  label: string;
  description: string;
}

const STATUS_LABELS: Record<NotificationStatus | 'all', string> = {
  all: 'Alle',
  open: 'Offen',
  read: 'Gelesen',
  resolved: 'Erledigt',
};

const SEVERITY_LABELS: Record<NotificationSeverity | 'all', string> = {
  all: 'Alle',
  info: 'Info',
  warning: 'Warnung',
  error: 'Fehler',
};

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

const Notifications: React.FC<NotificationsProps> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [eventOptions, setEventOptions] = useState<NotificationEventDefinition[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<NotificationStatus | 'all'>('open');
  const [severityFilter, setSeverityFilter] = useState<NotificationSeverity | 'all'>('all');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage(text);
    setMessageType(type);
    window.setTimeout(() => {
      setMessage('');
      setMessageType('');
    }, 3500);
  };

  const loadEventDefinitions = useCallback(async () => {
    try {
      const response = await axios.get('/api/admin/notifications/events', { headers });
      setEventOptions(Array.isArray(response.data?.events) ? response.data.events : []);
    } catch {
      setEventOptions([]);
    }
  }, [headers]);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/admin/notifications', {
        headers,
        params: {
          status: statusFilter,
          severity: severityFilter,
          eventType: eventTypeFilter !== 'all' ? eventTypeFilter : undefined,
          limit: 200,
          offset: 0,
        },
      });
      setItems(Array.isArray(response.data?.items) ? response.data.items : []);
      setTotal(Number(response.data?.total || 0));
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Benachrichtigungen konnten nicht geladen werden.', 'error');
    } finally {
      setLoading(false);
    }
  }, [eventTypeFilter, headers, severityFilter, statusFilter]);

  useEffect(() => {
    void loadEventDefinitions();
  }, [loadEventDefinitions]);

  useEffect(() => {
    void loadNotifications();
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => {
      void loadNotifications();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadNotifications]);

  const eventLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    eventOptions.forEach((entry) => {
      if (!entry?.eventType) return;
      map[entry.eventType] = entry.label || entry.eventType;
    });
    return map;
  }, [eventOptions]);

  const visibleItems = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      const label = eventLabelMap[item.eventType] || item.eventType;
      return [
        item.title,
        item.message,
        item.eventType,
        label,
        item.relatedTicketId || '',
        item.relatedExecutionId || '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [eventLabelMap, items, searchQuery]);

  const stats = useMemo(() => {
    const open = visibleItems.filter((item) => item.status === 'open').length;
    const read = visibleItems.filter((item) => item.status === 'read').length;
    const errors = visibleItems.filter((item) => item.severity === 'error').length;
    const warnings = visibleItems.filter((item) => item.severity === 'warning').length;
    return {
      open,
      read,
      errors,
      warnings,
    };
  }, [visibleItems]);

  const updateNotificationStatus = async (id: string, status: NotificationStatus) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await axios.patch(
        `/api/admin/notifications/${id}`,
        { status },
        { headers }
      );
      await loadNotifications();
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Benachrichtigung konnte nicht aktualisiert werden.', 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const deleteNotification = async (id: string) => {
    const confirmed = window.confirm('Benachrichtigung wirklich löschen?');
    if (!confirmed) return;
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await axios.delete(`/api/admin/notifications/${id}`, { headers });
      showMessage('Benachrichtigung gelöscht.', 'success');
      await loadNotifications();
    } catch (error: any) {
      showMessage(error.response?.data?.message || 'Benachrichtigung konnte nicht gelöscht werden.', 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="notifications-page">
      <section className="card notifications-hero">
        <div className="notifications-header">
          <h1>Benachrichtigungen</h1>
          <p>
            Zentrale Warnmeldungen für Betriebsfehler, Workflow-Probleme, Missbrauchsversuche und gefährliche
            Lagehinweise.
          </p>
        </div>
        <div className="notifications-hero-actions">
          <label className="notifications-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <span>Auto-Refresh (15s)</span>
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => void loadNotifications()} disabled={loading}>
            {loading ? 'Lade...' : 'Aktualisieren'}
          </button>
        </div>
      </section>

      {message ? (
        <div
          className={`message-banner ${messageType === 'success' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'}`}
        >
          {message}
        </div>
      ) : null}

      <div className="notifications-stats-grid">
        <article className="card notifications-stat">
          <span>Offen</span>
          <strong>{stats.open}</strong>
        </article>
        <article className="card notifications-stat">
          <span>Gelesen</span>
          <strong>{stats.read}</strong>
        </article>
        <article className="card notifications-stat notifications-stat-danger">
          <span>Fehler</span>
          <strong>{stats.errors}</strong>
        </article>
        <article className="card notifications-stat notifications-stat-warning">
          <span>Warnungen</span>
          <strong>{stats.warnings}</strong>
        </article>
      </div>

      <div className="notifications-toolbar card">
        <label>
          <span>Status</span>
          <select
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as NotificationStatus | 'all')}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Schweregrad</span>
          <select
            className="input"
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value as NotificationSeverity | 'all')}
          >
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Ereignistyp</span>
          <select className="input" value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)}>
            <option value="all">Alle</option>
            {eventOptions.map((option) => (
              <option key={option.eventType} value={option.eventType}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="notifications-search">
          <span>Suche</span>
          <input
            className="input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Titel, Meldung, Ticket, Typ"
          />
        </label>
        <div className="notifications-count">
          <strong>{visibleItems.length}</strong>
          <span>von {total} Treffer</span>
        </div>
      </div>

      <div className="notifications-list">
        {loading ? (
          <div className="card notifications-empty">Lade Benachrichtigungen...</div>
        ) : visibleItems.length === 0 ? (
          <div className="card notifications-empty">Keine Benachrichtigungen für die aktuelle Auswahl.</div>
        ) : (
          visibleItems.map((item) => (
            <article key={item.id} className={`card notification-item sev-${item.severity} state-${item.status}`}>
              <header className="notification-item-head">
                <div className="notification-item-title">
                  <span className={`notification-severity ${item.severity}`}>{SEVERITY_LABELS[item.severity]}</span>
                  <h3>{item.title}</h3>
                </div>
                <div className="notification-item-meta">
                  <span className={`notification-status status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
              </header>
              <p className="notification-item-message">{item.message}</p>
              <div className="notification-item-links">
                {item.relatedTicketId ? <span>Ticket: {item.relatedTicketId}</span> : null}
                {item.relatedExecutionId ? <span>Workflow: {item.relatedExecutionId}</span> : null}
                <span>Typ: {eventLabelMap[item.eventType] || item.eventType}</span>
              </div>
              {item.context && Object.keys(item.context).length > 0 ? (
                <details className="notification-context">
                  <summary>Kontext anzeigen</summary>
                  <pre>{JSON.stringify(item.context, null, 2)}</pre>
                </details>
              ) : null}
              <div className="notification-item-actions">
                {item.status !== 'read' ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void updateNotificationStatus(item.id, 'read')}
                    disabled={actionLoading[item.id] === true}
                  >
                    Als gelesen markieren
                  </button>
                ) : null}
                {item.status !== 'resolved' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void updateNotificationStatus(item.id, 'resolved')}
                    disabled={actionLoading[item.id] === true}
                  >
                    Erledigen
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void updateNotificationStatus(item.id, 'open')}
                    disabled={actionLoading[item.id] === true}
                  >
                    Wieder öffnen
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void deleteNotification(item.id)}
                  disabled={actionLoading[item.id] === true}
                >
                  Löschen
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
};

export default Notifications;
