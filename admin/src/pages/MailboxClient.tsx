import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';

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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bodyMode, setBodyMode] = useState<'text' | 'html'>('text');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

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
      // optional
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
      const detail = response.data as MailboxMessageDetail;
      setSelectedMessage(detail);
      setBodyMode(detail?.textBody ? 'text' : 'html');
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
    if (silent) setRefreshing(true);
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
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Postfach konnte nicht geladen werden.');
    } finally {
      if (!silent) setLoading(false);
      if (silent) setRefreshing(false);
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

  const columns = useMemo<SmartTableColumnDef<MailboxMessageSummary>[]>(
    () => [
      {
        field: 'subject',
        headerName: 'Betreff',
        minWidth: 260,
        flex: 1.2,
        renderCell: ({ row }) => (
          <Stack spacing={0.5} sx={{ py: 0.25 }}>
            <Typography variant="body2" fontWeight={700}>
              {row.subject || '(ohne Betreff)'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 560, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {row.preview || 'Keine Vorschau verfügbar.'}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'fromEmail',
        headerName: 'Absender',
        minWidth: 210,
        flex: 0.9,
        valueGetter: (_value, row) => row.fromEmail || row.fromName || 'Unbekannt',
      },
      {
        field: 'ticketId',
        headerName: 'Ticket',
        minWidth: 160,
        flex: 0.55,
        renderCell: ({ row }) =>
          row.ticketId ? (
            <Chip size="small" label={`Ticket ${row.ticketId.slice(0, 8)}`} color="success" variant="outlined" />
          ) : (
            <Chip size="small" label="Nicht zugeordnet" variant="outlined" />
          ),
      },
      {
        field: 'attachmentCount',
        headerName: 'Anhänge',
        minWidth: 100,
        flex: 0.35,
        type: 'number',
      },
      {
        field: 'receivedAt',
        headerName: 'Empfangen',
        minWidth: 180,
        flex: 0.62,
        valueFormatter: (value) => formatDate(value as string),
      },
      {
        field: 'mailboxUid',
        headerName: 'UID',
        minWidth: 90,
        flex: 0.25,
      },
      {
        field: 'actions',
        headerName: '',
        sortable: false,
        filterable: false,
        width: 84,
        align: 'center',
        headerAlign: 'center',
        renderCell: ({ row }) => (
          <SmartTableRowActions>
            <SmartTableRowActionButton
              icon="fa-regular fa-eye"
              tooltip="Nachricht öffnen"
              onClick={() => {
                setSelectedMessageId(row.id);
                void loadDetail(row.id);
              }}
            />
            {row.ticketId ? (
              <SmartTableRowActionButton
                icon="fa-solid fa-ticket"
                tooltip="Ticket öffnen"
                onClick={() => navigate(`/tickets/${row.ticketId}`)}
              />
            ) : null}
          </SmartTableRowActions>
        ),
      },
    ],
    [navigate]
  );

  const selectedIdArray = selectedMessageId ? [selectedMessageId] : [];

  return (
    <div className="space-y-6">
      <AdminPageHero
        title="E-Mail Postfach (IMAP)"
        subtitle="Importierte Nachrichten, Ticket-Zuordnung und Detailprüfung im SmartTable-Layout."
        badges={[
          { label: syncing ? 'Sync läuft' : 'Sync bereit', tone: syncing ? 'warning' : 'success' },
          { label: refreshing ? 'Live-Refresh' : 'Idle', tone: refreshing ? 'info' : 'default' },
        ]}
        actions={(
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon />}
              onClick={() => void loadMessages()}
              disabled={loading}
            >
              Aktualisieren
            </Button>
            <Button
              variant="contained"
              startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <SyncRoundedIcon />}
              onClick={() => void triggerSync()}
              disabled={syncing}
            >
              IMAP synchronisieren
            </Button>
          </Stack>
        )}
      />

      {error ? <Alert severity="error">{error}</Alert> : null}
      {success ? <Alert severity="success">{success}</Alert> : null}

      {stats ? (
        <AdminKpiStrip
          items={[
            { label: 'Nachrichten', value: stats.totalMessages },
            { label: 'Ticket-Zuordnungen', value: stats.linkedMessages, tone: 'success' },
            { label: 'Anhänge', value: stats.totalAttachments, tone: 'info' },
          ]}
        />
      ) : null}

      <AdminSurfaceCard
        title="Nachrichtenliste"
        subtitle="Filter, Auswahl und Ticketbezug der importierten IMAP-Nachrichten."
        actions={(
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ minWidth: { sm: 420 } }}>
            <TextField
              size="small"
              label="Suche"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Betreff, Absender, Vorschau"
            />
            <TextField
              size="small"
              label="Ticket-ID"
              value={ticketFilter}
              onChange={(event) => setTicketFilter(event.target.value)}
              placeholder="0eb6707f-..."
            />
            <Button variant="outlined" onClick={() => void loadMessages()} disabled={loading}>
              Anwenden
            </Button>
          </Stack>
        )}
      >
        <SmartTable<MailboxMessageSummary>
          tableId="mailbox-client-messages"
          title="Postfach"
          rows={messages}
          columns={columns}
          loading={loading}
          error={error}
          defaultPageSize={25}
          pageSizeOptions={[10, 25, 50, 100]}
          selectionModel={selectedIdArray}
          onSelectionModelChange={(ids) => {
            const nextId = ids[0] || '';
            setSelectedMessageId(nextId);
            if (nextId) {
              void loadDetail(nextId);
            } else {
              setSelectedMessage(null);
            }
          }}
          onRowClick={(row) => {
            setSelectedMessageId(row.id);
            void loadDetail(row.id);
          }}
          onRefresh={async () => {
            await loadMessages({ silent: true });
            await loadStats();
          }}
          isRefreshing={refreshing}
        />
      </AdminSurfaceCard>

      <AdminSurfaceCard
        title="Nachrichtendetails"
        subtitle={selectedMessage ? `Mailbox ${selectedMessage.mailboxName} · UID ${selectedMessage.mailboxUid}` : 'Bitte Nachricht auswählen'}
        actions={
          selectedMessage?.ticketId ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNewRoundedIcon />}
              onClick={() => navigate(`/tickets/${selectedMessage.ticketId}`)}
            >
              Ticket öffnen
            </Button>
          ) : null
        }
      >
        {detailLoading ? (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight={220}>
            <CircularProgress size={28} />
          </Box>
        ) : !selectedMessage ? (
          <Alert severity="info">Bitte links eine Nachricht auswählen.</Alert>
        ) : (
          <Stack spacing={2}>
            <Stack spacing={0.4}>
              <Typography variant="h6">{selectedMessage.subject || '(ohne Betreff)'}</Typography>
              <Typography variant="body2" color="text.secondary">
                Von: {selectedMessage.fromName ? `${selectedMessage.fromName} ` : ''}
                {selectedMessage.fromEmail || 'Unbekannt'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                An: {selectedMessage.toEmails || '–'}
              </Typography>
              {selectedMessage.ccEmails ? (
                <Typography variant="body2" color="text.secondary">
                  CC: {selectedMessage.ccEmails}
                </Typography>
              ) : null}
              <Typography variant="caption" color="text.secondary">
                Empfangen: {formatDate(selectedMessage.receivedAt || selectedMessage.createdAt)}
              </Typography>
            </Stack>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Anhänge ({selectedMessage.attachments.length})
              </Typography>
              {selectedMessage.attachments.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Keine Anhänge vorhanden.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {selectedMessage.attachments.map((attachment) => (
                    <Stack
                      key={attachment.id}
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      justifyContent="space-between"
                      alignItems={{ xs: 'flex-start', sm: 'center' }}
                      sx={{ border: '1px solid #e2e8f0', borderRadius: 1.25, p: 1.25 }}
                    >
                      <Stack spacing={0.2}>
                        <Typography variant="body2" fontWeight={600}>
                          {attachment.fileName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {attachment.mimeType} · {formatBytes(attachment.byteSize)}
                        </Typography>
                      </Stack>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<DownloadRoundedIcon />}
                        onClick={() => void downloadAttachment(selectedMessage.id, attachment)}
                      >
                        Download
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>

            <Box>
              <Tabs
                value={bodyMode}
                onChange={(_event, value: 'text' | 'html') => setBodyMode(value)}
                sx={{ minHeight: 42 }}
              >
                <Tab value="text" label="Textansicht" disabled={!selectedMessage.textBody} />
                <Tab value="html" label="HTML-Ansicht" disabled={!selectedMessage.htmlBody} />
              </Tabs>
              <Box sx={{ mt: 1.5 }}>
                {bodyMode === 'html' && selectedMessage.htmlBody ? (
                  <iframe
                    title={`mail-${selectedMessage.id}`}
                    sandbox=""
                    srcDoc={selectedMessage.htmlBody}
                    style={{
                      width: '100%',
                      minHeight: 480,
                      border: '1px solid #cbd5e1',
                      borderRadius: 8,
                      background: '#fff',
                    }}
                  />
                ) : (
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 1.5,
                      minHeight: 320,
                      border: '1px solid #cbd5e1',
                      borderRadius: 1,
                      backgroundColor: '#f8fafc',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                      fontSize: 13,
                    }}
                  >
                    {selectedMessage.textBody || 'Keine Textinhalte vorhanden.'}
                  </Box>
                )}
              </Box>
            </Box>
          </Stack>
        )}
      </AdminSurfaceCard>
    </div>
  );
};

export default MailboxClient;
