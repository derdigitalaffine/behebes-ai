import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useI18n } from '../i18n/I18nProvider';

type Decision = 'approve' | 'reject';

const WorkflowConfirm: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const decisionParam = searchParams.get('decision');
  const { t } = useI18n();

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [payload, setPayload] = useState<any>(null);
  const [selectedDecision, setSelectedDecision] = useState<Decision>(
    decisionParam === 'reject' ? 'reject' : 'approve'
  );
  const [submitting, setSubmitting] = useState(false);
  const autoDecisionTriggeredRef = useRef(false);

  const canDecide = useMemo(() => {
    if (!payload) return false;
    if (payload.expired) return false;
    if (payload.alreadyProcessed) return false;
    return true;
  }, [payload]);

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
        setMessage(t('workflow_token_missing'));
        return;
      }

      try {
        const response = await axios.get(`/api/workflows/confirm/${token}`);
        setPayload(response.data || null);
        setStatus('ready');
      } catch (error: any) {
        const responsePayload = error?.response?.data;
        if (responsePayload && typeof responsePayload === 'object' && responsePayload.token) {
          setPayload(responsePayload);
          setStatus('ready');
          setMessage(responsePayload.message || '');
          return;
        }
        setStatus('error');
        setMessage(error?.response?.data?.message || t('workflow_failed_default'));
      }
    };

    run();
  }, [token, t]);

  const handleDecision = async (forcedDecision?: Decision) => {
    if (!token || !canDecide) return;
    const decisionToSubmit: Decision = forcedDecision || selectedDecision;
    setSubmitting(true);
    setMessage('');
    try {
      const response = await axios.post(`/api/workflows/confirm/${token}/decision`, {
        decision: decisionToSubmit,
      });
      setMessage(response.data?.message || t('workflow_success_default'));
      setPayload((prev: any) =>
        prev
          ? {
              ...prev,
              alreadyProcessed: true,
              decision: decisionToSubmit,
              confirmationTask: prev.confirmationTask
                ? { ...prev.confirmationTask, status: 'COMPLETED' }
                : prev.confirmationTask,
            }
          : prev
      );
    } catch (error: any) {
      setMessage(error?.response?.data?.message || t('workflow_failed_default'));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!decisionParam || autoDecisionTriggeredRef.current) return;
    if (status !== 'ready' || !canDecide || submitting) return;
    const parsedDecision: Decision = decisionParam === 'reject' ? 'reject' : 'approve';
    autoDecisionTriggeredRef.current = true;
    setSelectedDecision(parsedDecision);
    void handleDecision(parsedDecision);
  }, [decisionParam, status, canDecide, submitting]);

  return (
    <main className="page-shell">
      <header className="page-head">
        <p className="page-kicker">{t('workflow_kicker')}</p>
        <h1 className="page-title">{t('workflow_title')}</h1>
        <p className="page-subtitle">{t('workflow_subtitle')}</p>
      </header>

      <section className="form-card">
        {status === 'loading' && (
          <div className="p-5 rounded-xl bg-slate-900 text-slate-100">
            <p>{t('workflow_loading')}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="p-6 rounded-xl bg-slate-100 border border-slate-300 border-l-4 border-l-rose-500">
            <h2 className="text-xl font-semibold text-slate-900">{t('workflow_error_title')}</h2>
            <p className="text-slate-700 mt-2">{message}</p>
          </div>
        )}

        {status === 'ready' && payload && (
          <div className="space-y-4">
            {message && (
              <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                {message}
              </div>
            )}

            {payload.expired && (
              <div className="p-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-900 text-sm">
                {payload.message || 'Dieser Entscheidungslink ist abgelaufen.'}
              </div>
            )}

            {payload.alreadyProcessed && (
              <div className="p-4 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 text-sm">
                Diese Entscheidung wurde bereits verarbeitet: {payload.decision === 'reject' ? 'abgelehnt' : 'zugestimmt'}.
              </div>
            )}

            <div className="card p-5 space-y-3">
              <h2 className="text-lg font-semibold text-slate-900">Freigabeentscheidung</h2>
              <p className="text-sm text-slate-700">
                {payload.confirmationTask?.instruction || 'Bitte prüfen Sie die Ticketdetails und treffen Sie eine Entscheidung.'}
              </p>
              {payload.confirmationTask?.title && (
                <div className="text-sm text-slate-700">
                  <strong>Schritt:</strong> {payload.confirmationTask.title}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  className={`btn ${
                    selectedDecision === 'approve' ? 'btn-primary' : 'btn-secondary'
                  }`}
                  onClick={() => setSelectedDecision('approve')}
                  disabled={!canDecide || submitting}
                >
                  Zustimmen
                </button>
                <button
                  type="button"
                  className={`btn ${
                    selectedDecision === 'reject' ? 'btn-danger' : 'btn-secondary'
                  }`}
                  onClick={() => setSelectedDecision('reject')}
                  disabled={!canDecide || submitting}
                >
                  Ablehnen
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleDecision}
                  disabled={!canDecide || submitting}
                >
                  {submitting ? 'Wird gespeichert...' : selectedDecision === 'reject' ? 'Ablehnung bestätigen' : 'Zustimmung bestätigen'}
                </button>
              </div>
            </div>

            <div className="card p-5 space-y-3">
              <h2 className="text-lg font-semibold text-slate-900">Ticketdetails</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <div><strong>Ticket-ID:</strong> {payload.ticket?.id || '–'}</div>
                <div><strong>Status:</strong> {normalizeStatusLabel(String(payload.ticket?.status || ''))}</div>
                <div><strong>Kategorie:</strong> {payload.ticket?.category || '–'}</div>
                <div><strong>Priorität:</strong> {payload.ticket?.priority || '–'}</div>
                <div><strong>Adresse:</strong> {payload.ticket?.address || payload.ticket?.location || '–'}</div>
                <div><strong>Ort:</strong> {[payload.ticket?.postalCode, payload.ticket?.city].filter(Boolean).join(' ') || '–'}</div>
              </div>
              <div>
                <strong>Beschreibung:</strong>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">{payload.ticket?.description || '–'}</p>
              </div>
            </div>

            {Array.isArray(payload.images) && payload.images.length > 0 && (
              <div className="card p-5 space-y-3">
                <h2 className="text-lg font-semibold text-slate-900">Fotos</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {payload.images.map((image: any) => (
                    <figure key={image.id || image.fileName} className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                      <img
                        src={image.url || image.dataUrl}
                        alt={image.fileName || 'Ticketbild'}
                        className="w-full h-48 object-cover"
                        loading="lazy"
                      />
                      <figcaption className="px-3 py-2 text-xs text-slate-600">{image.fileName || 'Bild'}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {payload.workflow && (
              <div className="card p-5 space-y-3">
                <h2 className="text-lg font-semibold text-slate-900">Workflowüberblick</h2>
                <p className="text-sm text-slate-700">
                  {payload.workflowInfo?.overview || 'Workflowinformationen verfügbar.'}
                </p>
                <div className="text-sm text-slate-700">
                  <strong>Fortschritt:</strong> {Number(payload.workflow.completedSteps || 0)} / {Number(payload.workflow.totalSteps || 0)} Schritt(e)
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              {payload.quickLinks?.statusLink && (
                <a href={payload.quickLinks.statusLink} className="btn btn-secondary">
                  Ticketstatus öffnen
                </a>
              )}
              <Link to="/" className="btn btn-primary">
                {t('workflow_back')}
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
};

export default WorkflowConfirm;
