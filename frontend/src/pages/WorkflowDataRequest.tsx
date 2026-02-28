import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, useSearchParams } from 'react-router-dom';

type DataRequestFieldType = 'yes_no' | 'single_choice' | 'number' | 'quantity' | 'short_text';

interface DataRequestField {
  key: string;
  label: string;
  type: DataRequestFieldType;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

interface DataRequestPayload {
  requestId: string;
  status: string;
  mode: 'parallel' | 'blocking';
  expiresAt?: string | null;
  answeredAt?: string | null;
  subject?: string | null;
  introText?: string | null;
  cycle?: number;
  maxCycles?: number;
  languageCode?: string;
  languageName?: string;
  uiLocale?: Partial<DataRequestLocale>;
  ticket?: {
    id?: string;
    category?: string;
    priority?: string;
    status?: string;
    description?: string;
    address?: string;
    postalCode?: string;
    city?: string;
    citizenPreferredLanguage?: string;
    citizenPreferredLanguageName?: string;
  };
  images?: Array<{
    id?: string;
    fileName?: string;
    createdAt?: string | null;
    byteSize?: number;
    url?: string;
    dataUrl?: string;
  }>;
  fields: DataRequestField[];
}

interface DataRequestLocale {
  tokenMissing: string;
  loading: string;
  loadFailed: string;
  alreadySubmitted: string;
  requiredPrefix: string;
  submitSuccess: string;
  submitError: string;
  kicker: string;
  title: string;
  subtitle: string;
  ticket: string;
  category: string;
  priority: string;
  mode: string;
  cycle: string;
  modeParallel: string;
  modeBlocking: string;
  subjectFallback: string;
  selectPlaceholder: string;
  yes: string;
  no: string;
  send: string;
  sending: string;
  complete: string;
  back: string;
  typeYesNo: string;
  typeChoice: string;
  typeNumber: string;
  typeQuantity: string;
  typeText: string;
  requiredHint: string;
  answerPlaceholder: string;
  originalTicket: string;
  originalDescription: string;
  originalPhotos: string;
  originalLocation: string;
  noDescription: string;
  noPhotos: string;
}

const DATA_REQUEST_LOCALES: Record<'de' | 'en', DataRequestLocale> = {
  de: {
    tokenMissing: 'Kein Token gefunden.',
    loading: 'Datennachforderung wird geladen...',
    loadFailed: 'Datennachforderung konnte nicht geladen werden.',
    alreadySubmitted: 'Die Antworten wurden bereits übermittelt.',
    requiredPrefix: 'Bitte Pflichtfelder ausfüllen:',
    submitSuccess: 'Vielen Dank. Die Angaben wurden gespeichert.',
    submitError: 'Antworten konnten nicht gespeichert werden.',
    kicker: 'Workflow',
    title: 'Datennachforderung',
    subtitle: 'Bitte ergänzen Sie die fehlenden Angaben zu Ihrer Meldung.',
    ticket: 'Ticket',
    category: 'Kategorie',
    priority: 'Priorität',
    mode: 'Modus',
    cycle: 'Zyklus',
    modeParallel: 'Parallel (Workflow läuft weiter)',
    modeBlocking: 'Blockierend',
    subjectFallback: 'Rückfragen zur Meldung',
    selectPlaceholder: 'Bitte wählen',
    yes: 'Ja',
    no: 'Nein',
    send: 'Antworten senden',
    sending: 'Wird übermittelt...',
    complete: 'Datennachforderung abgeschlossen.',
    back: 'Zurück zum Formular',
    typeYesNo: 'Ja/Nein',
    typeChoice: 'Auswahl',
    typeNumber: 'Zahl',
    typeQuantity: 'Menge',
    typeText: 'Freitext',
    requiredHint: 'Pflichtfeld',
    answerPlaceholder: 'Ihre Antwort',
    originalTicket: 'Ursprüngliche Meldung',
    originalDescription: 'Beschreibung',
    originalPhotos: 'Bilder',
    originalLocation: 'Ort',
    noDescription: 'Keine Beschreibung vorhanden.',
    noPhotos: 'Keine Bilder vorhanden.',
  },
  en: {
    tokenMissing: 'No token found.',
    loading: 'Loading data request...',
    loadFailed: 'Could not load data request.',
    alreadySubmitted: 'Answers have already been submitted.',
    requiredPrefix: 'Please complete required fields:',
    submitSuccess: 'Thank you. Your answers were saved.',
    submitError: 'Could not save answers.',
    kicker: 'Workflow',
    title: 'Data Request',
    subtitle: 'Please provide the missing details for your report.',
    ticket: 'Ticket',
    category: 'Category',
    priority: 'Priority',
    mode: 'Mode',
    cycle: 'Cycle',
    modeParallel: 'Parallel (workflow continues)',
    modeBlocking: 'Blocking',
    subjectFallback: 'Follow-up questions for your report',
    selectPlaceholder: 'Please select',
    yes: 'Yes',
    no: 'No',
    send: 'Send answers',
    sending: 'Submitting...',
    complete: 'Data request completed.',
    back: 'Back to form',
    typeYesNo: 'Yes/No',
    typeChoice: 'Choice',
    typeNumber: 'Number',
    typeQuantity: 'Quantity',
    typeText: 'Text',
    requiredHint: 'Required',
    answerPlaceholder: 'Your answer',
    originalTicket: 'Original report',
    originalDescription: 'Description',
    originalPhotos: 'Photos',
    originalLocation: 'Location',
    noDescription: 'No description available.',
    noPhotos: 'No photos available.',
  },
};

const DATA_REQUEST_LOCALE_KEYS = Object.keys(DATA_REQUEST_LOCALES.de) as Array<keyof DataRequestLocale>;

const resolveDataRequestLocale = (code?: string): DataRequestLocale => {
  const normalized = String(code || '')
    .trim()
    .toLowerCase();
  if (!normalized || normalized.startsWith('de')) return DATA_REQUEST_LOCALES.de;
  return DATA_REQUEST_LOCALES.en;
};

const mergeDataRequestLocale = (
  baseLocale: DataRequestLocale,
  overrideLocale?: Partial<DataRequestLocale> | null
): DataRequestLocale => {
  if (!overrideLocale || typeof overrideLocale !== 'object') return baseLocale;
  const merged: DataRequestLocale = { ...baseLocale };
  DATA_REQUEST_LOCALE_KEYS.forEach((key) => {
    const value = overrideLocale[key];
    if (typeof value === 'string' && value.trim()) {
      merged[key] = value.trim();
    }
  });
  return merged;
};

const escapeHtml = (input: string): string =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildIntroMarkup = (input?: string | null): string => {
  const fallback = 'Bitte beantworten Sie die folgenden Fragen.';
  const raw = String(input || fallback).trim() || fallback;
  const hasHtml = /<[^>]+>/.test(raw);
  if (!hasHtml) {
    return `<p>${escapeHtml(raw).replace(/\n+/g, '<br />')}</p>`;
  }
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*\"[^\"]*\"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
};

const normalizeInputValue = (field: DataRequestField, value: any): any => {
  if (field.type === 'number' || field.type === 'quantity') {
    const normalized = String(value ?? '').trim();
    return normalized === '' ? '' : normalized;
  }
  if (field.type === 'yes_no') {
    return value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : '';
  }
  return String(value ?? '');
};

const resolveFieldTypeLabel = (type: DataRequestFieldType, locale: DataRequestLocale): string => {
  if (type === 'yes_no') return locale.typeYesNo;
  if (type === 'single_choice') return locale.typeChoice;
  if (type === 'number') return locale.typeNumber;
  if (type === 'quantity') return locale.typeQuantity;
  return locale.typeText;
};

const WorkflowDataRequest: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'submitted'>('loading');
  const [message, setMessage] = useState('');
  const [payload, setPayload] = useState<DataRequestPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const baseLocale = useMemo(
    () =>
      resolveDataRequestLocale(
        payload?.languageCode || payload?.ticket?.citizenPreferredLanguage || payload?.ticket?.citizenPreferredLanguageName
      ),
    [payload?.languageCode, payload?.ticket?.citizenPreferredLanguage, payload?.ticket?.citizenPreferredLanguageName]
  );
  const locale = useMemo(
    () => mergeDataRequestLocale(baseLocale, payload?.uiLocale),
    [baseLocale, payload?.uiLocale]
  );
  const introMarkup = useMemo(() => buildIntroMarkup(payload?.introText), [payload?.introText]);

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setStatus('error');
        setMessage(DATA_REQUEST_LOCALES.de.tokenMissing);
        return;
      }
      try {
        const response = await axios.get(`/api/workflows/data-request/${token}`);
        const data = response.data as DataRequestPayload;
        const resolvedLocale = mergeDataRequestLocale(
          resolveDataRequestLocale(
            data.languageCode || data.ticket?.citizenPreferredLanguage || data.ticket?.citizenPreferredLanguageName
          ),
          data.uiLocale
        );
        setPayload(data);
        const initialAnswers: Record<string, any> = {};
        (Array.isArray(data.fields) ? data.fields : []).forEach((field) => {
          initialAnswers[field.key] = '';
        });
        setAnswers(initialAnswers);
        if (String(data.status || '').toLowerCase() === 'answered') {
          setStatus('submitted');
          setMessage(resolvedLocale.alreadySubmitted);
          return;
        }
        setStatus('ready');
      } catch (error: any) {
        const responsePayload = error?.response?.data;
        if (responsePayload && typeof responsePayload === 'object' && responsePayload.status === 'answered') {
          const data = responsePayload as DataRequestPayload;
          const resolvedLocale = mergeDataRequestLocale(
            resolveDataRequestLocale(
              data.languageCode || data.ticket?.citizenPreferredLanguage || data.ticket?.citizenPreferredLanguageName
            ),
            data.uiLocale
          );
          setPayload(data);
          setStatus('submitted');
          setMessage(resolvedLocale.alreadySubmitted);
          return;
        }
        setStatus('error');
        setMessage(responsePayload?.message || DATA_REQUEST_LOCALES.de.loadFailed);
      }
    };
    run();
  }, [token]);

  const requiredFieldErrors = useMemo(() => {
    if (!payload || status !== 'ready') return [];
    return (payload.fields || [])
      .filter((field) => field.required)
      .filter((field) => {
        const raw = answers[field.key];
        if (field.type === 'yes_no') return !(raw === 'true' || raw === 'false');
        return String(raw ?? '').trim() === '';
      })
      .map((field) => field.label || field.key);
  }, [payload, answers, status]);

  const handleSubmit = async () => {
    if (!token || !payload) return;
    if (requiredFieldErrors.length > 0) {
      setMessage(`${locale.requiredPrefix} ${requiredFieldErrors.join(', ')}`);
      return;
    }

    const requestBody: Record<string, any> = {};
    payload.fields.forEach((field) => {
      const raw = answers[field.key];
      if (field.type === 'yes_no') {
        if (raw === 'true') requestBody[field.key] = true;
        else if (raw === 'false') requestBody[field.key] = false;
        else requestBody[field.key] = '';
        return;
      }
      if (field.type === 'number' || field.type === 'quantity') {
        const normalized = String(raw ?? '').trim();
        requestBody[field.key] = normalized === '' ? '' : Number(normalized);
        return;
      }
      requestBody[field.key] = String(raw ?? '').trim();
    });

    setSubmitting(true);
    setMessage('');
    try {
      const response = await axios.post(`/api/workflows/data-request/${token}`, {
        answers: requestBody,
      });
      setStatus('submitted');
      setMessage(response.data?.message || locale.submitSuccess);
    } catch (error: any) {
      setMessage(error?.response?.data?.message || locale.submitError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page-shell">
      <header className="page-head">
        <p className="page-kicker">{locale.kicker}</p>
        <h1 className="page-title">{locale.title}</h1>
        <p className="page-subtitle">{locale.subtitle}</p>
      </header>

      <section className="form-card workflow-data-request-card">
        {status === 'loading' && (
          <div className="data-request-alert loading">
            <i className="fa-solid fa-spinner fa-spin" /> {locale.loading}
          </div>
        )}

        {status === 'error' && (
          <div className="data-request-alert error">
            <i className="fa-solid fa-triangle-exclamation" /> {message}
          </div>
        )}

        {status === 'submitted' && payload && (
          <div className="workflow-data-request-content">
            <div className="data-request-alert success">
              <i className="fa-solid fa-circle-check" /> {message || locale.submitSuccess}
            </div>
          </div>
        )}

        {status === 'ready' && payload && (
          <div className="workflow-data-request-content">
            {message && (
              <div className="data-request-alert warning">
                <i className="fa-solid fa-circle-info" /> {message}
              </div>
            )}

            <div className="data-request-ticket-meta">
              <span><i className="fa-solid fa-ticket" /> {locale.ticket}: {payload.ticket?.id || '–'}</span>
              <span><i className="fa-solid fa-tags" /> {locale.category}: {payload.ticket?.category || '–'}</span>
              <span><i className="fa-solid fa-bolt" /> {locale.priority}: {payload.ticket?.priority || '–'}</span>
              <span>
                <i className="fa-solid fa-timeline" /> {locale.mode}:{' '}
                {payload.mode === 'parallel' ? locale.modeParallel : locale.modeBlocking}
              </span>
              <span>
                <i className="fa-solid fa-repeat" /> {locale.cycle}: {Math.max(1, Number(payload.cycle || 1))}/
                {Math.max(1, Number(payload.maxCycles || 1))}
              </span>
            </div>

            <div className="data-request-intro">
              <h2>{payload.subject || locale.subjectFallback}</h2>
              <div dangerouslySetInnerHTML={{ __html: introMarkup }} />
            </div>

            <div className="card p-5 space-y-3">
              <h2 className="text-lg font-semibold text-slate-900">{locale.originalTicket}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <div><strong>{locale.ticket}:</strong> {payload.ticket?.id || '–'}</div>
                <div><strong>{locale.category}:</strong> {payload.ticket?.category || '–'}</div>
                <div><strong>{locale.priority}:</strong> {payload.ticket?.priority || '–'}</div>
                <div>
                  <strong>{locale.originalLocation}:</strong>{' '}
                  {[payload.ticket?.address, payload.ticket?.postalCode, payload.ticket?.city].filter(Boolean).join(', ') || '–'}
                </div>
              </div>
              <div>
                <strong>{locale.originalDescription}:</strong>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">
                  {payload.ticket?.description || locale.noDescription}
                </p>
              </div>

              <div>
                <strong>{locale.originalPhotos}:</strong>
                {Array.isArray(payload.images) && payload.images.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
                    {payload.images.map((image) => (
                      <figure
                        key={image.id || image.fileName}
                        className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50"
                      >
                        <img
                          src={image.url || image.dataUrl}
                          alt={image.fileName || 'Ticketbild'}
                          className="w-full h-48 object-cover"
                          loading="lazy"
                        />
                        <figcaption className="px-3 py-2 text-xs text-slate-600">
                          {image.fileName || 'Bild'}
                          {Number(image.byteSize || 0) > 0
                            ? ` · ${(Number(image.byteSize) / 1024).toFixed(0)} KB`
                            : ''}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-slate-700">{locale.noPhotos}</p>
                )}
              </div>
            </div>

            <div className="data-request-form-grid">
              {payload.fields.map((field, index) => {
                const inputId = `data-request-field-${field.key}`;
                return (
                  <div key={field.key} className="data-request-question-card">
                    <div className="data-request-question-head">
                      <span className="data-request-question-index">{index + 1}</span>
                      <div className="data-request-question-label-wrap">
                        <label htmlFor={inputId} className="mui-field-label">
                          <i
                            className={`fa-solid ${
                              field.type === 'yes_no'
                                ? 'fa-circle-question'
                                : field.type === 'single_choice'
                                ? 'fa-list-check'
                                : field.type === 'number' || field.type === 'quantity'
                                ? 'fa-hashtag'
                                : 'fa-pen'
                            }`}
                          />
                          {field.label}
                          {field.required && <strong>*</strong>}
                        </label>
                        <span className="data-request-question-meta">
                          {resolveFieldTypeLabel(field.type, locale)}
                          {field.required ? ` · ${locale.requiredHint}` : ''}
                        </span>
                      </div>
                    </div>

                    {field.type === 'yes_no' && (
                      <select
                        id={inputId}
                        className="mui-select"
                        value={normalizeInputValue(field, answers[field.key])}
                        onChange={(event) =>
                          setAnswers((prev) => ({ ...prev, [field.key]: event.target.value }))
                        }
                      >
                        <option value="">{locale.selectPlaceholder}</option>
                        <option value="true">{locale.yes}</option>
                        <option value="false">{locale.no}</option>
                      </select>
                    )}

                    {field.type === 'single_choice' && (
                      <select
                        id={inputId}
                        className="mui-select"
                        value={normalizeInputValue(field, answers[field.key])}
                        onChange={(event) =>
                          setAnswers((prev) => ({ ...prev, [field.key]: event.target.value }))
                        }
                      >
                        <option value="">{locale.selectPlaceholder}</option>
                        {(field.options || []).map((option) => (
                          <option key={`${field.key}-${option.value}`} value={option.value}>
                            {option.label || option.value}
                          </option>
                        ))}
                      </select>
                    )}

                    {(field.type === 'number' || field.type === 'quantity') && (
                      <input
                        id={inputId}
                        className="mui-input"
                        type="number"
                        value={normalizeInputValue(field, answers[field.key])}
                        onChange={(event) =>
                          setAnswers((prev) => ({ ...prev, [field.key]: event.target.value }))
                        }
                        placeholder="0"
                      />
                    )}

                    {field.type === 'short_text' && (
                      <textarea
                        id={inputId}
                        className="mui-textarea"
                        rows={3}
                        value={normalizeInputValue(field, answers[field.key])}
                        onChange={(event) =>
                          setAnswers((prev) => ({ ...prev, [field.key]: event.target.value }))
                        }
                        placeholder={locale.answerPlaceholder}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="data-request-actions">
              <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> {locale.sending}
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-paper-plane" /> {locale.send}
                  </>
                )}
              </button>
              <Link to="/" className="btn btn-secondary">
                {locale.back}
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
};

export default WorkflowDataRequest;
