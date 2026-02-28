import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import './MailboxClient.css';

interface MailboxAttachment {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  contentDisposition: string;
  contentId?: string | null;
  createdAt?: string | null;
  downloadUrl?: string;
}

interface MailboxMessageSummary {
  id: string;
  mailboxUid: number;
  mailboxName: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  subject: string;
  fromName?: string | null;
  fromEmail?: string | null;
  toEmails?: string | null;
  ccEmails?: string | null;
  dateHeader?: string | null;
  receivedAt?: string | null;
  ticketId?: string | null;
  ticketCommentId?: string | null;
  matchReason?: string | null;
  preview: string;
  hasHtmlBody: boolean;
  attachmentCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface MailboxMessageDetail extends MailboxMessageSummary {
  textBody: string;
  htmlBody: string;
  attachments: MailboxAttachment[];
}

interface MailboxListResponse {
  items: MailboxMessageSummary[];
  total: number;
  limit: number;
  offset: number;
}

interface MailboxStats {
  totalMessages: number;
  linkedMessages: number;
  totalAttachments: number;
}

interface MailboxClientProps {
  token: string;
}

const MailboxClient: React.FC<MailboxClientProps> = ({ token }) => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<MailboxMessageSummary[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string>('');
  const [selectedMessage, setSelectedMessage] = useState<MailboxMessageDetail | null>(null);
  const [stats, setStats] = useState<MailboxStats | null>(null);
  const [query, setQuery] = useState('');
  const [ticketFilter, setTicketFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bodyMode, setBodyMode] = useState<'text' | 'html'>('text');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const formatDate = (value?: string | null): string => {
    if (!value) return '–';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '–';
    return parsed.toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatBytes = (value?: number | null): string => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return '0 B';
    if (amount < 1024) return `${Math.floor(amount)} B`;
    if (amount < 1024 * 1024) return `${(amount / 1024).toFixed(1)} KB`;
    return `${(amount / (1024 * 1024)).toFixed(1)} MB`;
  };

  const loadStats = async () => {
    try {
      const response = await axios.get('/api/admin/mailbox/stats', { headers });
      const payload = response.data || {};
      setStats({
        totalMessages: Number(payload.totalMessages || 0),
        linkedMessages: Number(payload.linkedMessages || 0),
        totalAttachments: Number(payload.totalAttachments || 0),
      });
    } catch {
      // stats are optional
    }
  };

  const loadDetail = async (messageId: string) => {
    const normalizedId = String(messageId || '').trim();
    if (!normalizedId) {
      setSelectedMessage(null);
      return;
    }
    setDetailLoading(true);
    try {
      const response = await axios.get(`/api/admin/mailbox/messages/${encodeURIComponent(normalizedId)}`, {
        headers,
      });
      setSelectedMessage(response.data as MailboxMessageDetail);
      setBodyMode((response.data as MailboxMessageDetail)?.textBody ? 'text' : 'html');
      setError('');
    } catch (err: any) {
      setSelectedMessage(null);
      setError(err?.response?.data?.message || 'Nachricht konnte nicht geladen werden.');
    } finally {
      setDetailLoading(false);
    }
  };

  const loadMessages = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    try {
      const response = await axios.get('/api/admin/mailbox/messages', {
        headers,
        params: {
          limit: 120,
          offset: 0,
          q: query || undefined,
          ticketId: ticketFilter || undefined,
        },
      });
      const payload = response.data as MailboxListResponse;
      const nextMessages = Array.isArray(payload?.items) ? payload.items : [];
      setMessages(nextMessages);
      setError('');

      const activeId =
        nextMessages.find((entry) => entry.id === selectedMessageId)?.id ||
        nextMessages[0]?.id ||
        '';
      if (activeId && activeId !== selectedMessageId) {
        setSelectedMessageId(activeId);
        void loadDetail(activeId);
      } else if (!activeId) {
        setSelectedMessageId('');
        setSelectedMessage(null);
      } else if (selectedMessageId) {
        void loadDetail(selectedMessageId);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Postfach konnte nicht geladen werden.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const triggerSync = async () => {
    setSyncing(true);
    setError('');
    setSuccess('');
    try {
      const response = await axios.post('/api/admin/mailbox/sync', undefined, { headers });
      const payload = response.data || {};
      const imported = Number(payload.imported || 0);
      const linked = Number(payload.linkedToTickets || 0);
      setSuccess(`Synchronisierung abgeschlossen: ${imported} neue Nachricht(en), ${linked} Ticket-Zuordnung(en).`);
      await Promise.all([loadMessages({ silent: true }), loadStats()]);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.response?.data?.message || 'Synchronisierung fehlgeschlagen.');
    } finally {
      setSyncing(false);
    }
  };

  const downloadAttachment = async (messageId: string, attachment: MailboxAttachment) => {
    try {
      const response = await axios.get(
        `/api/admin/mailbox/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(
          attachment.id
        )}/download`,
        {
          headers,
          responseType: 'blob',
        }
      );
      const blob = new Blob([response.data], { type: attachment.mimeType || 'application/octet-stream' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = attachment.fileName || 'attachment.bin';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Anhang konnte nicht heruntergeladen werden.');
    }
  };

  useEffect(() => {
    void loadMessages();
    void loadStats();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadMessages({ silent: true });
        void loadStats();
      }
    }, 25000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="mailbox-client-page">
      <div className="mailbox-client-header">
        <div>
          <h2>Ticket-Postfach (IMAP)</h2>
          <p>Antwortmails werden hier angezeigt und automatisch den Tickets zugeordnet.</p>
        </div>
        <div className="mailbox-client-actions">
          <button type="button" className="btn-refresh" onClick={() => void loadMessages()} disabled={loading}>
            <i className="fa-solid fa-rotate" /> Aktualisieren
          </button>
          <button type="button" className="btn-sync" onClick={triggerSync} disabled={syncing}>
            {syncing ? (
              <>
                <i className="fa-solid fa-spinner fa-spin" /> Synchronisiere...
              </>
            ) : (
              <>
                <i className="fa-solid fa-cloud-arrow-down" /> IMAP synchronisieren
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mailbox-filters">
        <label>
          Suche
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Betreff, Absender, Vorschau"
          />
        </label>
        <label>
          Ticket-ID
          <input
            type="text"
            value={ticketFilter}
            onChange={(event) => setTicketFilter(event.target.value)}
            placeholder="z. B. 0eb6707f-..."
          />
        </label>
        <button type="button" onClick={() => void loadMessages()} disabled={loading}>
          Filter anwenden
        </button>
      </div>

      {stats && (
        <div className="mailbox-stats">
          <article>
            <span>Importierte Nachrichten</span>
            <strong>{stats.totalMessages}</strong>
          </article>
          <article>
            <span>Ticket-Zuordnungen</span>
            <strong>{stats.linkedMessages}</strong>
          </article>
          <article>
            <span>Gespeicherte Anhänge</span>
            <strong>{stats.totalAttachments}</strong>
          </article>
        </div>
      )}

      {error ? <div className="error-message">{error}</div> : null}
      {success ? <div className="success-message">{success}</div> : null}

      <div className="mailbox-client-shell">
        <aside className="mailbox-list-panel">
          <header>
            <h3>Nachrichten</h3>
            <span>{messages.length}</span>
          </header>
          {loading ? (
            <div className="mailbox-empty">
              <i className="fa-solid fa-spinner fa-spin" /> Lade...
            </div>
          ) : messages.length === 0 ? (
            <div className="mailbox-empty">Keine Nachrichten gefunden.</div>
          ) : (
            <div className="mailbox-list">
              {messages.map((message) => {
                const isActive = message.id === selectedMessageId;
                return (
                  <button
                    key={message.id}
                    type="button"
                    className={`mailbox-list-item ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedMessageId(message.id);
                      void loadDetail(message.id);
                    }}
                  >
                    <div className="mailbox-list-item-head">
                      <strong>{message.subject || '(ohne Betreff)'}</strong>
                      <span>{formatDate(message.receivedAt || message.createdAt)}</span>
                    </div>
                    <div className="mailbox-list-item-meta">
                      <span>{message.fromEmail || message.fromName || 'Unbekannt'}</span>
                      <span>
                        <i className="fa-solid fa-paperclip" /> {message.attachmentCount}
                      </span>
                    </div>
                    <p>{message.preview || 'Keine Vorschau verfügbar.'}</p>
                    <div className="mailbox-list-item-tags">
                      {message.ticketId ? (
                        <span className="tag-linked">Ticket {message.ticketId.slice(0, 8)}</span>
                      ) : (
                        <span className="tag-unlinked">Nicht zugeordnet</span>
                      )}
                      <span className="tag-uid">UID {message.mailboxUid}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="mailbox-detail-panel">
          {detailLoading ? (
            <div className="mailbox-empty">
              <i className="fa-solid fa-spinner fa-spin" /> Nachricht wird geladen...
            </div>
          ) : !selectedMessage ? (
            <div className="mailbox-empty">Bitte links eine Nachricht auswählen.</div>
          ) : (
            <div className="mailbox-detail-content">
              <header className="mailbox-detail-header">
                <div>
                  <h3>{selectedMessage.subject || '(ohne Betreff)'}</h3>
                  <p>
                    Von: {selectedMessage.fromName ? `${selectedMessage.fromName} ` : ''}
                    {selectedMessage.fromEmail || 'Unbekannt'}
                  </p>
                  <p>An: {selectedMessage.toEmails || '–'}</p>
                  {selectedMessage.ccEmails ? <p>CC: {selectedMessage.ccEmails}</p> : null}
                </div>
                <div className="mailbox-detail-header-right">
                  <span>Empfangen: {formatDate(selectedMessage.receivedAt || selectedMessage.createdAt)}</span>
                  <span>Mailbox: {selectedMessage.mailboxName} · UID {selectedMessage.mailboxUid}</span>
                  {selectedMessage.ticketId ? (
                    <button
                      type="button"
                      className="btn-open-ticket"
                      onClick={() => navigate(`/tickets/${selectedMessage.ticketId}`)}
                    >
                      <i className="fa-solid fa-ticket" /> Ticket öffnen
                    </button>
                  ) : (
                    <span className="not-linked">Keiner Ticket-ID zugeordnet</span>
                  )}
                </div>
              </header>

              <section className="mailbox-attachments">
                <h4>
                  <i className="fa-solid fa-paperclip" /> Anhänge ({selectedMessage.attachments.length})
                </h4>
                {selectedMessage.attachments.length === 0 ? (
                  <p>Keine Anhänge vorhanden.</p>
                ) : (
                  <ul>
                    {selectedMessage.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <div>
                          <strong>{attachment.fileName}</strong>
                          <span>{attachment.mimeType}</span>
                          <span>{formatBytes(attachment.byteSize)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void downloadAttachment(selectedMessage.id, attachment)}
                        >
                          <i className="fa-solid fa-download" /> Download
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="mailbox-body">
                <div className="mailbox-body-tabs">
                  <button
                    type="button"
                    className={bodyMode === 'text' ? 'active' : ''}
                    onClick={() => setBodyMode('text')}
                    disabled={!selectedMessage.textBody}
                  >
                    Textansicht
                  </button>
                  <button
                    type="button"
                    className={bodyMode === 'html' ? 'active' : ''}
                    onClick={() => setBodyMode('html')}
                    disabled={!selectedMessage.htmlBody}
                  >
                    HTML-Ansicht
                  </button>
                </div>
                {bodyMode === 'html' && selectedMessage.htmlBody ? (
                  <iframe
                    className="mailbox-html-preview"
                    title={`mail-${selectedMessage.id}`}
                    sandbox=""
                    srcDoc={selectedMessage.htmlBody}
                  />
                ) : (
                  <pre className="mailbox-text-preview">{selectedMessage.textBody || 'Keine Textinhalte vorhanden.'}</pre>
                )}
              </section>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default MailboxClient;
