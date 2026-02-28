import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useI18n } from '../i18n/I18nProvider';

const TicketStatus: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { t } = useI18n();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [payload, setPayload] = useState<any>(null);

  const normalizeStatusLabel = (value: string): string => {
    const raw = String(value || '').trim().toLowerCase();
    const map: Record<string, string> = {
      pending_validation: 'Validierung ausstehend',
      pending: 'Ausstehend',
      open: 'Offen',
      assigned: 'Zugewiesen',
      'in-progress': 'In Bearbeitung',
      completed: 'Abgeschlossen',
      closed: 'Geschlossen',
    };
    return map[raw] || raw || 'Unbekannt';
  };

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setStatus('error');
        setMessage(t('verify_token_missing'));
        return;
      }

      try {
        const response = await axios.get('/api/submissions/status', {
          params: { token },
        });
        setPayload(response.data || null);
        setStatus('success');
      } catch (error: any) {
        setStatus('error');
        setMessage(error.response?.data?.error || t('status_error_message'));
      }
    };

    run();
  }, [token, t]);

  return (
    <main className="page-shell">
      <header className="page-head">
        <p className="page-kicker">{t('status_page_kicker')}</p>
        <h1 className="page-title">{t('status_page_title')}</h1>
        <p className="page-subtitle">{t('status_page_subtitle')}</p>
      </header>

      <section className="form-card">
        {status === 'loading' && (
          <div className="p-5 rounded-xl bg-slate-900 text-slate-100">
            <p>{t('status_loading')}</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4">
            <div className="success-card p-6">
              <h2 className="text-xl font-semibold text-slate-900">{t('status_label')}</h2>
              <p className="text-slate-700 mt-2">
                {normalizeStatusLabel(String(payload?.status || ''))}
              </p>
              <p className="text-slate-900 font-semibold text-lg mt-3">
                {t('success_ticket_label')}: {payload?.ticketId || '–'}
              </p>
            </div>

            <div className="card p-5 space-y-3">
              <h3 className="text-lg font-semibold text-slate-900">Ticketdetails</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <div><strong>Kategorie:</strong> {payload?.category || '–'}</div>
                <div><strong>Priorität:</strong> {payload?.priority || '–'}</div>
                <div><strong>Adresse:</strong> {payload?.address || payload?.location || '–'}</div>
                <div><strong>Ort:</strong> {[payload?.postalCode, payload?.city].filter(Boolean).join(' ') || '–'}</div>
                <div><strong>Erstellt:</strong> {payload?.createdAt ? new Date(payload.createdAt).toLocaleString('de-DE') : '–'}</div>
                <div><strong>Aktualisiert:</strong> {payload?.updatedAt ? new Date(payload.updatedAt).toLocaleString('de-DE') : '–'}</div>
                <div><strong>Zuständig:</strong> {payload?.assignedTo || '–'}</div>
                <div><strong>Redmine-Issue:</strong> {payload?.redmineIssueId || '–'}</div>
              </div>
              <div>
                <strong>Beschreibung:</strong>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">{payload?.description || '–'}</p>
              </div>
            </div>

            {Array.isArray(payload?.images) && payload.images.length > 0 && (
              <div className="card p-5 space-y-3">
                <h3 className="text-lg font-semibold text-slate-900">Fotos</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {payload.images.map((image: any) => (
                    <figure key={image.id || image.fileName} className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                      <img
                        src={image.url || image.dataUrl}
                        alt={image.fileName || 'Ticketbild'}
                        className="w-full h-48 object-cover"
                        loading="lazy"
                      />
                      <figcaption className="px-3 py-2 text-xs text-slate-600">
                        {image.fileName || 'Bild'} · {Number(image.byteSize || 0) > 0 ? `${(Number(image.byteSize) / 1024).toFixed(0)} KB` : ''}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            <div className="card p-5 space-y-3">
              <h3 className="text-lg font-semibold text-slate-900">Workflow</h3>
              <p className="text-sm text-slate-700">{payload?.workflowInfo || 'Keine Workflow-Information verfügbar.'}</p>
              {payload?.workflow && (
                <div className="text-sm space-y-2">
                  <div><strong>Workflow:</strong> {payload.workflow.title || '–'}</div>
                  <div>
                    <strong>Fortschritt:</strong>{' '}
                    {Number(payload.workflow.completedSteps || 0)} / {Number(payload.workflow.totalSteps || 0)} Schritt(e)
                  </div>
                  {payload.workflow.currentStep?.title && (
                    <div><strong>Aktueller Schritt:</strong> {payload.workflow.currentStep.title}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="p-6 rounded-xl bg-slate-100 border border-slate-300 border-l-4 border-l-rose-500">
            <h2 className="text-xl font-semibold text-slate-900">{t('status_error_title')}</h2>
            <p className="text-slate-700 mt-2">{message}</p>
          </div>
        )}

        <div className="mt-6">
          <Link to="/" className="btn btn-primary">
            {t('status_back')}
          </Link>
        </div>
      </section>
    </main>
  );
};

export default TicketStatus;
