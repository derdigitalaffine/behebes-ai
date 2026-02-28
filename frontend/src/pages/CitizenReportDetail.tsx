import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import {
  CitizenTicketDetail,
  CitizenTicketHistory,
  getCitizenSession,
  getCitizenTicket,
  getCitizenTicketHistory,
} from '../lib/citizenAuth';

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

const CitizenReportDetail: React.FC = () => {
  const navigate = useNavigate();
  const { ticketId = '' } = useParams<{ ticketId: string }>();
  const { frontendToken } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ticket, setTicket] = useState<CitizenTicketDetail | null>(null);
  const [history, setHistory] = useState<CitizenTicketHistory | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!ticketId) {
        setError('Ticket-ID fehlt.');
        setLoading(false);
        return;
      }

      try {
        const session = await getCitizenSession(frontendToken);
        if (!alive) return;
        if (!session.authenticated) {
          navigate('/login', { replace: true });
          return;
        }

        const [ticketResponse, historyResponse] = await Promise.all([
          getCitizenTicket(ticketId),
          getCitizenTicketHistory(ticketId),
        ]);

        if (!alive) return;
        setTicket(ticketResponse);
        setHistory(historyResponse);
      } catch (requestError: any) {
        if (!alive) return;
        setError(requestError?.message || 'Ticket konnte nicht geladen werden.');
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [frontendToken, navigate, ticketId]);

  const workflowProgress = useMemo(() => {
    if (!ticket?.workflow) return '';
    return `${ticket.workflow.completedSteps} / ${ticket.workflow.totalSteps} Schritt(e)`;
  }, [ticket]);

  return (
    <main className="page-shell">
      <header className="page-head">
        <p className="page-kicker">Bürgerkonto</p>
        <h1 className="page-title">Meldungsdetails</h1>
        <p className="page-subtitle">Ticket {ticketId || '–'}</p>
      </header>

      <section className="form-card space-y-4">
        <div className="flex flex-wrap gap-2">
          <Link to="/me" className="btn btn-secondary">
            Zurück zu meinen Meldungen
          </Link>
          <Link to="/" className="btn btn-secondary">
            Neue Meldung erstellen
          </Link>
        </div>

        {loading && <p>Daten werden geladen...</p>}

        {error && (
          <div className="p-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-900">{error}</div>
        )}

        {!loading && !error && ticket && (
          <>
            <div className="rounded-lg border border-slate-200 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>Status: {normalizeStatusLabel(ticket.status)}</strong>
                <span>Priorität: {ticket.priority || '–'}</span>
              </div>
              <div className="text-sm text-slate-700 grid grid-cols-1 md:grid-cols-2 gap-1">
                <span>Kategorie: {ticket.category || '–'}</span>
                <span>Zuständigkeit: {ticket.responsibilityAuthority || '–'}</span>
                <span>Erstellt: {ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('de-DE') : '–'}</span>
                <span>
                  Aktualisiert: {ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString('de-DE') : '–'}
                </span>
              </div>
              <div className="text-sm text-slate-700">
                Ort: {[ticket.address, ticket.postalCode, ticket.city].filter(Boolean).join(', ') || '–'}
              </div>
              <div className="text-sm text-slate-700 whitespace-pre-wrap">
                <strong>Beschreibung:</strong>
                <p className="mt-1">{ticket.description || '–'}</p>
              </div>
              {ticket.workflow && (
                <div className="text-sm text-slate-700">
                  <strong>Workflow:</strong> {ticket.workflow.title || '–'} · {workflowProgress}
                </div>
              )}
            </div>

            {Array.isArray(ticket.images) && ticket.images.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                <h2 className="text-lg font-semibold">Fotos</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ticket.images.map((image) => (
                    <figure
                      key={image.id || image.fileName}
                      className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50"
                    >
                      <img
                        src={image.url}
                        alt={image.fileName || 'Ticketbild'}
                        className="w-full h-48 object-cover"
                        loading="lazy"
                      />
                      <figcaption className="px-3 py-2 text-xs text-slate-600">
                        {image.fileName || 'Bild'} ·{' '}
                        {Number(image.byteSize || 0) > 0 ? `${(Number(image.byteSize) / 1024).toFixed(0)} KB` : ''}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {history && (
              <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                <h2 className="text-lg font-semibold">Historie</h2>
                {history.comments.length === 0 ? (
                  <p className="text-sm text-slate-600">Noch keine öffentlichen Historieneinträge vorhanden.</p>
                ) : (
                  <div className="space-y-2">
                    {history.comments.map((entry) => (
                      <article key={entry.id} className="rounded border border-slate-200 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
                          <span>{entry.authorName || entry.authorType || 'System'}</span>
                          <span>
                            {entry.createdAt ? new Date(entry.createdAt).toLocaleString('de-DE') : 'ohne Zeitstempel'}
                          </span>
                        </div>
                        <p className="mt-2 text-slate-800 whitespace-pre-wrap">{entry.content || '–'}</p>
                      </article>
                    ))}
                  </div>
                )}

                {history.milestones.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="font-semibold">Öffentliche Workflow-Meilensteine</h3>
                    <ul className="space-y-1 text-sm text-slate-700">
                      {history.milestones.map((milestone) => (
                        <li key={milestone.id || `${milestone.order}-${milestone.title}`}>
                          #{milestone.order + 1} · {milestone.title} ({milestone.status})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
};

export default CitizenReportDetail;
