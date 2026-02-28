import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import {
  CitizenAppMessage,
  getCitizenSession,
  listCitizenMessages,
  markAllCitizenMessagesRead,
  markCitizenMessageReadState,
  subscribeCitizenPush,
  unsubscribeCitizenPush,
} from '../lib/citizenAuth';

const DEFAULT_LIMIT = 40;

const emitUnreadCount = (count: number) => {
  window.dispatchEvent(
    new CustomEvent('citizen-unread-count', {
      detail: { count: Math.max(0, Number(count || 0)) },
    })
  );
};

const toBase64UrlUint8Array = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
  const decoded = window.atob(padded);
  const output = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    output[index] = decoded.charCodeAt(index);
  }
  return output;
};

const formatDate = (value?: string | null): string => {
  if (!value) return '–';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '–';
  return parsed.toLocaleString('de-DE');
};

const CitizenMessages: React.FC = () => {
  const navigate = useNavigate();
  const { frontendToken } = useI18n();
  const [checkingSession, setCheckingSession] = useState(true);
  const [messages, setMessages] = useState<CitizenAppMessage[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'read' | 'unread'>('all');
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [messageActionLoading, setMessageActionLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [sessionEmail, setSessionEmail] = useState('');
  const [pushAvailable, setPushAvailable] = useState(false);
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const refreshPushState = useCallback(async () => {
    const supportsPush = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
    setPushSupported(supportsPush);
    if (!supportsPush) {
      setPushSubscribed(false);
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setPushSubscribed(!!subscription);
    } catch {
      setPushSubscribed(false);
    }
  }, []);

  const loadMessages = useCallback(
    async (status: 'all' | 'read' | 'unread') => {
      setLoading(true);
      setError('');
      try {
        const response = await listCitizenMessages({
          status,
          limit: DEFAULT_LIMIT,
          offset: 0,
        });
        setMessages(Array.isArray(response.items) ? response.items : []);
        setUnreadCount(Number(response.unreadCount || 0));
        setTotal(Number(response.total || 0));
        emitUnreadCount(Number(response.unreadCount || 0));
      } catch (requestError: any) {
        setError(requestError?.message || 'Nachrichten konnten nicht geladen werden.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const session = await getCitizenSession(frontendToken);
        if (!alive) return;
        if (!session.authenticated) {
          navigate('/login', { replace: true });
          return;
        }

        setSessionEmail(String(session.email || ''));
        setPushAvailable(session.pushAvailable === true && !!session.pushPublicKey);
        setPushPublicKey(session.pushPublicKey || null);
        await loadMessages(statusFilter);
        await refreshPushState();
      } catch (sessionError: any) {
        if (!alive) return;
        setError(sessionError?.message || 'Sitzung konnte nicht geprüft werden.');
      } finally {
        if (alive) {
          setCheckingSession(false);
        }
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [frontendToken, loadMessages, navigate, refreshPushState, statusFilter]);

  const handleMarkRead = async (entry: CitizenAppMessage, read: boolean) => {
    if (!entry?.id) return;
    setMessageActionLoading((prev) => ({ ...prev, [entry.id]: true }));
    setError('');
    try {
      const nextUnreadCount = await markCitizenMessageReadState(entry.id, read);
      setMessages((prev) =>
        prev.map((item) =>
          item.id === entry.id
            ? { ...item, isRead: read, readAt: read ? new Date().toISOString() : null }
            : item
        )
      );
      setUnreadCount(nextUnreadCount);
      emitUnreadCount(nextUnreadCount);
    } catch (requestError: any) {
      setError(requestError?.message || 'Nachricht konnte nicht aktualisiert werden.');
    } finally {
      setMessageActionLoading((prev) => ({ ...prev, [entry.id]: false }));
    }
  };

  const handleMarkAllRead = async () => {
    setLoading(true);
    setError('');
    try {
      const nextUnreadCount = await markAllCitizenMessagesRead();
      setMessages((prev) => prev.map((item) => ({ ...item, isRead: true, readAt: item.readAt || new Date().toISOString() })));
      setUnreadCount(nextUnreadCount);
      emitUnreadCount(nextUnreadCount);
    } catch (requestError: any) {
      setError(requestError?.message || 'Nachrichten konnten nicht aktualisiert werden.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnablePush = async () => {
    if (!pushPublicKey) {
      setError('Push-Schlüssel ist nicht verfügbar.');
      return;
    }
    if (!pushSupported) {
      setError('Push wird von diesem Gerät/Browser nicht unterstützt.');
      return;
    }
    setPushBusy(true);
    setError('');
    try {
      const permission = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
      let effectivePermission = permission;
      if (permission === 'default' && typeof Notification !== 'undefined') {
        effectivePermission = await Notification.requestPermission();
      }
      if (effectivePermission !== 'granted') {
        throw new Error('Push-Berechtigung wurde nicht erteilt.');
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toBase64UrlUint8Array(pushPublicKey),
        });
      }
      await subscribeCitizenPush(subscription.toJSON());
      setPushSubscribed(true);
    } catch (requestError: any) {
      setError(requestError?.message || 'Push-Benachrichtigungen konnten nicht aktiviert werden.');
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    if (!pushSupported) return;
    setPushBusy(true);
    setError('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint || '';
      if (subscription) {
        await subscription.unsubscribe();
      }
      await unsubscribeCitizenPush(endpoint);
      setPushSubscribed(false);
    } catch (requestError: any) {
      setError(requestError?.message || 'Push-Benachrichtigungen konnten nicht deaktiviert werden.');
    } finally {
      setPushBusy(false);
    }
  };

  const pushStatusLabel = useMemo(() => {
    if (!pushSupported) return 'Nicht unterstützt';
    if (!pushAvailable) return 'Serverseitig deaktiviert';
    return pushSubscribed ? 'Aktiv' : 'Inaktiv';
  }, [pushAvailable, pushSubscribed, pushSupported]);

  if (checkingSession) {
    return (
      <main className="page-shell">
        <section className="form-card">
          <p>Sitzung wird geprüft...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="page-head">
        <p className="page-kicker">Bürgerkonto</p>
        <h1 className="page-title">Nachrichten</h1>
        <p className="page-subtitle">
          {sessionEmail ? `Angemeldet als ${sessionEmail}.` : ''} Hier sehen Sie E-Mails und Mitteilungen direkt in der App.
        </p>
      </header>

      <section className="form-card space-y-4">
        <div className="flex flex-wrap gap-2">
          <Link to="/me" className="btn btn-secondary">
            Meine Meldungen
          </Link>
          <button type="button" className="btn btn-secondary" onClick={() => void loadMessages(statusFilter)} disabled={loading}>
            Aktualisieren
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleMarkAllRead}
            disabled={loading || unreadCount <= 0}
          >
            Alle als gelesen markieren
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 flex flex-wrap items-center gap-3">
          <strong>Push:</strong>
          <span>{pushStatusLabel}</span>
          {pushAvailable && pushSupported && !pushSubscribed && (
            <button type="button" className="btn btn-secondary" onClick={handleEnablePush} disabled={pushBusy}>
              {pushBusy ? 'Aktiviert...' : 'Push aktivieren'}
            </button>
          )}
          {pushAvailable && pushSupported && pushSubscribed && (
            <button type="button" className="btn btn-secondary" onClick={handleDisablePush} disabled={pushBusy}>
              {pushBusy ? 'Deaktiviert...' : 'Push deaktivieren'}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="message-status-filter" className="text-sm text-slate-700">
            Status
          </label>
          <select
            id="message-status-filter"
            className="mui-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | 'read' | 'unread')}
          >
            <option value="all">Alle</option>
            <option value="unread">Ungelesen</option>
            <option value="read">Gelesen</option>
          </select>
          <span className="text-sm text-slate-700">
            {total} Nachricht(en), davon {unreadCount} ungelesen
          </span>
        </div>

        {error && <div className="p-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-900">{error}</div>}
        {loading && <p>Nachrichten werden geladen...</p>}

        {!loading && messages.length === 0 && (
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
            Keine Nachrichten vorhanden.
          </div>
        )}

        {!loading && messages.length > 0 && (
          <div className="space-y-3">
            {messages.map((entry) => {
              const loadingRow = !!messageActionLoading[entry.id];
              const actionHref = entry.actionUrl || '';
              let resolvedActionHref = actionHref;
              let isExternal = false;
              if (actionHref) {
                try {
                  const resolvedUrl = new URL(actionHref, window.location.origin);
                  isExternal = resolvedUrl.origin !== window.location.origin;
                  resolvedActionHref = isExternal
                    ? resolvedUrl.toString()
                    : `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
                } catch {
                  resolvedActionHref = actionHref;
                  isExternal = /^https?:\/\//i.test(actionHref);
                }
              }
              return (
                <article
                  key={entry.id}
                  className={`rounded-lg border p-4 space-y-2 ${
                    entry.isRead ? 'border-slate-200 bg-white' : 'border-sky-300 bg-sky-50/50'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-slate-900">{entry.title || 'Neue Nachricht'}</strong>
                    <span className="text-xs text-slate-600">{formatDate(entry.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{entry.body || '–'}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {!entry.isRead && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleMarkRead(entry, true)}
                        disabled={loadingRow}
                      >
                        Als gelesen markieren
                      </button>
                    )}
                    {entry.isRead && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleMarkRead(entry, false)}
                        disabled={loadingRow}
                      >
                        Als ungelesen markieren
                      </button>
                    )}
                    {actionHref && (
                      <a
                        href={resolvedActionHref}
                        className="btn btn-primary"
                        target={isExternal ? '_blank' : undefined}
                        rel={isExternal ? 'noopener noreferrer' : undefined}
                        onClick={() => {
                          if (!entry.isRead) {
                            void handleMarkRead(entry, true);
                          }
                        }}
                      >
                        Öffnen
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
};

export default CitizenMessages;
