import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import {
  CitizenTicketSummary,
  getCitizenSession,
  listCitizenTickets,
  logoutCitizen,
} from '../lib/citizenAuth';

const DEFAULT_LIMIT = 20;

const STATUS_LABELS: Record<string, string> = {
  pending_validation: 'Validierung ausstehend',
  pending: 'Ausstehend',
  open: 'Offen',
  assigned: 'Zugewiesen',
  'in-progress': 'In Bearbeitung',
  completed: 'Abgeschlossen',
  closed: 'Geschlossen',
};

function normalizeStatusLabel(value: string): string {
  const key = String(value || '').trim().toLowerCase();
  return STATUS_LABELS[key] || value || 'Unbekannt';
}

const CitizenReports: React.FC = () => {
  const navigate = useNavigate();
  const { frontendToken } = useI18n();
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionEmail, setSessionEmail] = useState('');
  const [tickets, setTickets] = useState<CitizenTicketSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const loadTickets = useCallback(
    async (cursor?: string, append = false) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError('');
      try {
        const response = await listCitizenTickets({
          cursor,
          limit: DEFAULT_LIMIT,
        });
        setTickets((prev) => (append ? [...prev, ...response.items] : response.items));
        setNextCursor(response.nextCursor || null);
      } catch (requestError: any) {
        setError(requestError?.message || 'Meldungen konnten nicht geladen werden.');
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
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
        setSessionEmail(session.email || '');
        await loadTickets();
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
  }, [frontendToken, loadTickets, navigate]);

  const handleLogout = async () => {
    try {
      await logoutCitizen();
    } catch {
      // ignore
    }
    navigate('/login', { replace: true });
  };

  const hasTickets = tickets.length > 0;
  const canLoadMore = !!nextCursor;

  const subtitle = useMemo(() => {
    if (!sessionEmail) return 'Hier sehen Sie Ihre eingereichten Meldungen und deren Bearbeitungsstatus.';
    return `Angemeldet als ${sessionEmail}. Hier sehen Sie Ihre eingereichten Meldungen.`;
  }, [sessionEmail]);

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
        <h1 className="page-title">Meine Meldungen</h1>
        <p className="page-subtitle">{subtitle}</p>
      </header>

      <section className="form-card space-y-4">
        <div className="flex flex-wrap gap-2">
          <Link to="/" className="btn btn-secondary">
            Neue Meldung erstellen
          </Link>
          <Link to="/me/messages" className="btn btn-secondary">
            Nachrichten
          </Link>
          <button type="button" className="btn btn-secondary" onClick={() => void loadTickets()} disabled={loading}>
            Aktualisieren
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleLogout}>
            Abmelden
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-900">{error}</div>
        )}

        {loading && <p>Meldungen werden geladen...</p>}

        {!loading && !hasTickets && (
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
            Für dieses Konto sind aktuell keine Meldungen vorhanden.
          </div>
        )}

        {hasTickets && (
          <div className="space-y-3">
            {tickets.map((ticket) => (
              <article key={ticket.ticketId} className="rounded-lg border border-slate-200 p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-slate-900">Ticket {ticket.ticketId}</strong>
                  <span className="text-sm text-slate-700">{normalizeStatusLabel(ticket.status)}</span>
                </div>
                <div className="text-sm text-slate-700 grid grid-cols-1 md:grid-cols-2 gap-1">
                  <span>Kategorie: {ticket.category || '–'}</span>
                  <span>Priorität: {ticket.priority || '–'}</span>
                  <span>
                    Erstellt: {ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('de-DE') : '–'}
                  </span>
                  <span>
                    Aktualisiert: {ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString('de-DE') : '–'}
                  </span>
                </div>
                <div className="text-sm text-slate-700">
                  Ort: {[ticket.address, ticket.postalCode, ticket.city].filter(Boolean).join(', ') || '–'}
                </div>
                <Link to={`/me/tickets/${encodeURIComponent(ticket.ticketId)}`} className="btn btn-primary">
                  Details & Historie
                </Link>
              </article>
            ))}
          </div>
        )}

        {canLoadMore && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void loadTickets(nextCursor || undefined, true)}
            disabled={loadingMore}
          >
            {loadingMore ? 'Lädt...' : 'Weitere Meldungen laden'}
          </button>
        )}
      </section>
    </main>
  );
};

export default CitizenReports;
