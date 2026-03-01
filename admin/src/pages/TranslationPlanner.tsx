import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';
import {
  SmartTable,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import './TranslationPlanner.css';

type EntryKind = 'ui' | 'email';
type EntryKindFilter = 'all' | EntryKind;

interface PlannerSummary {
  languageCount: number;
  templateCount: number;
  uiCreated: number;
  uiUpdated: number;
  emailCreated: number;
  emailUpdated: number;
  durationMs: number;
}

interface PlannerStatus {
  enabled: boolean;
  inProgress: boolean;
  currentRunStartedAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  lastSummary: PlannerSummary | null;
}

interface TranslationEntry {
  id: string;
  kind: EntryKind;
  language: string;
  title: string;
  subtitle: string;
  sourcePreview: string;
  translationPreview: string;
  updatedAt: string | null;
  key?: string;
  templateId?: string;
}

interface TranslationListResponse {
  items: TranslationEntry[];
  total: number;
  limit: number;
  offset: number;
  counts: {
    ui: number;
    email: number;
  };
  languages: string[];
}

interface UiTranslationDetail {
  kind: 'ui';
  language: string;
  key: string;
  sourceValue: string;
  translatedValue: string;
  updatedAt: string | null;
}

interface EmailTranslationDetail {
  kind: 'email';
  language: string;
  templateId: string;
  templateName: string;
  sourceSubject: string;
  sourceHtmlContent: string;
  sourceTextContent: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  translationNotice: string;
  sourceHash: string;
  updatedAt: string | null;
}

const TranslationPlanner: React.FC = () => {
  const [status, setStatus] = useState<PlannerStatus | null>(null);
  const [entries, setEntries] = useState<TranslationListResponse | null>(null);
  const [kind, setKind] = useState<EntryKindFilter>('all');
  const [language, setLanguage] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<TranslationEntry | null>(null);

  const [uiDetail, setUiDetail] = useState<UiTranslationDetail | null>(null);
  const [emailDetail, setEmailDetail] = useState<EmailTranslationDetail | null>(null);
  const [uiDraftValue, setUiDraftValue] = useState('');
  const [emailDraft, setEmailDraft] = useState({
    templateName: '',
    subject: '',
    htmlContent: '',
    textContent: '',
    translationNotice: '',
  });

  const [statusLoading, setStatusLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'play' | 'stop' | 'run' | 'purge' | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${getAdminToken()}` }), []);

  const selectedKey = selectedEntry
    ? `${selectedEntry.kind}:${selectedEntry.language}:${selectedEntry.key || selectedEntry.templateId || selectedEntry.id}`
    : '';

  const setSuccess = (text: string) => {
    setMessageType('success');
    setMessage(text);
  };

  const setError = (text: string) => {
    setMessageType('error');
    setMessage(text);
  };

  const clearMessage = () => {
    setMessage('');
    setMessageType('');
  };

  const formatDate = (value?: string | null) => {
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

  const translationColumns = useMemo<SmartTableColumnDef<TranslationEntry>[]>(
    () => [
      {
        field: 'kind',
        headerName: 'Typ',
        minWidth: 100,
        flex: 0.5,
        valueGetter: (_value, row) => (row.kind === 'ui' ? 'UI' : 'E-Mail'),
      },
      {
        field: 'language',
        headerName: 'Sprache',
        minWidth: 110,
        flex: 0.45,
      },
      {
        field: 'title',
        headerName: 'Eintrag',
        minWidth: 260,
        flex: 1.1,
        renderCell: (params) => (
          <div style={{ lineHeight: 1.3, paddingTop: 4, paddingBottom: 4 }}>
            <strong>{params.row.title}</strong>
            <div style={{ fontSize: 12, color: '#64748b' }}>{params.row.subtitle}</div>
          </div>
        ),
      },
      {
        field: 'sourcePreview',
        headerName: 'Quelle',
        minWidth: 230,
        flex: 1,
        valueGetter: (_value, row) => row.sourcePreview || '–',
      },
      {
        field: 'translationPreview',
        headerName: 'Übersetzung',
        minWidth: 230,
        flex: 1,
        valueGetter: (_value, row) => row.translationPreview || '–',
      },
      {
        field: 'updatedAt',
        headerName: 'Aktualisiert',
        minWidth: 170,
        flex: 0.7,
        valueGetter: (_value, row) => formatDate(row.updatedAt),
      },
    ],
    []
  );

  const loadStatus = async (silent = false) => {
    if (!silent) setStatusLoading(true);
    try {
      const response = await axios.get('/api/admin/translation-planner/status', { headers });
      setStatus(response.data);
    } catch (error: any) {
      if (!silent) {
        setError(error.response?.data?.message || 'Status konnte nicht geladen werden');
      }
    } finally {
      if (!silent) setStatusLoading(false);
    }
  };

  const loadEntries = async (silent = false) => {
    if (!silent) setListLoading(true);
    try {
      const response = await axios.get('/api/admin/translation-planner/entries', {
        headers,
        params: {
          kind,
          language,
          search: searchQuery,
          limit: 250,
          offset: 0,
        },
      });
      const payload: TranslationListResponse = response.data;
      setEntries(payload);

      if (selectedEntry) {
        const exists = payload.items.some((item) => item.id === selectedEntry.id);
        if (!exists) {
          setSelectedEntry(null);
          setUiDetail(null);
          setEmailDetail(null);
        }
      }
    } catch (error: any) {
      if (!silent) {
        setError(error.response?.data?.message || 'Übersetzungen konnten nicht geladen werden');
      }
    } finally {
      if (!silent) setListLoading(false);
    }
  };

  const loadDetail = async (entry: TranslationEntry) => {
    setDetailLoading(true);
    try {
      if (entry.kind === 'ui') {
        const response = await axios.get('/api/admin/translation-planner/entries/ui', {
          headers,
          params: {
            language: entry.language,
            key: entry.key,
          },
        });
        const detail = response.data as UiTranslationDetail;
        setUiDetail(detail);
        setEmailDetail(null);
        setUiDraftValue(detail.translatedValue || '');
      } else {
        const response = await axios.get('/api/admin/translation-planner/entries/email', {
          headers,
          params: {
            language: entry.language,
            templateId: entry.templateId,
          },
        });
        const detail = response.data as EmailTranslationDetail;
        setEmailDetail(detail);
        setUiDetail(null);
        setEmailDraft({
          templateName: detail.templateName || '',
          subject: detail.subject || '',
          htmlContent: detail.htmlContent || '',
          textContent: detail.textContent || '',
          translationNotice: detail.translationNotice || '',
        });
      }
    } catch (error: any) {
      setError(error.response?.data?.message || 'Detail konnte nicht geladen werden');
      setUiDetail(null);
      setEmailDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    void loadEntries();
  }, [kind, language, searchQuery]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadStatus(true);
      void loadEntries(true);
      if (selectedEntry) {
        void loadDetail(selectedEntry);
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [selectedKey, kind, language, searchQuery]);

  const handleSelectEntry = async (entry: TranslationEntry) => {
    clearMessage();
    setSelectedEntry(entry);
    await loadDetail(entry);
  };

  const handlePlay = async () => {
    setActionLoading('play');
    clearMessage();
    try {
      const response = await axios.post('/api/admin/translation-planner/play', {}, { headers });
      setStatus(response.data);
      setSuccess('Übersetzungen vorplanen wurde gestartet.');
      await loadEntries(true);
    } catch (error: any) {
      setError(error.response?.data?.message || 'Play konnte nicht aktiviert werden');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    setActionLoading('stop');
    clearMessage();
    try {
      const response = await axios.post('/api/admin/translation-planner/stop', {}, { headers });
      setStatus(response.data);
      setSuccess('Übersetzungen vorplanen wurde gestoppt.');
    } catch (error: any) {
      setError(error.response?.data?.message || 'Stop konnte nicht aktiviert werden');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRunNow = async () => {
    setActionLoading('run');
    clearMessage();
    try {
      const response = await axios.post('/api/admin/translation-planner/run-now', {}, { headers });
      setStatus(response.data);
      setSuccess('Ein Lauf wurde angestoßen.');
    } catch (error: any) {
      setError(error.response?.data?.message || 'Lauf konnte nicht gestartet werden');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteAllPretranslations = async () => {
    const scopeLabel =
      kind === 'all'
        ? 'alle Typen'
        : kind === 'ui'
        ? 'nur UI'
        : 'nur E-Mail';
    const languageLabel = language ? `Sprache "${language}"` : 'alle Sprachen';
    const confirmed = window.confirm(
      `Vorübersetzungen wirklich komplett löschen? (${scopeLabel}, ${languageLabel})\nDer Planner wird dabei gestoppt.`
    );
    if (!confirmed) return;

    setActionLoading('purge');
    clearMessage();
    try {
      const response = await axios.delete('/api/admin/translation-planner/entries', {
        headers,
        data: {
          kind,
          language,
          stopPlanner: true,
        },
      });
      setStatus(response.data?.status || null);
      setSelectedEntry(null);
      setUiDetail(null);
      setEmailDetail(null);
      await loadStatus(true);
      await loadEntries(true);
      setSuccess(`Vorübersetzungen gelöscht (${Number(response.data?.deleted || 0)} Einträge).`);
    } catch (error: any) {
      setError(error.response?.data?.message || 'Vorübersetzungen konnten nicht gelöscht werden');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveUi = async () => {
    if (!uiDetail) return;
    setSaveLoading(true);
    clearMessage();
    try {
      await axios.patch(
        '/api/admin/translation-planner/entries/ui',
        {
          language: uiDetail.language,
          key: uiDetail.key,
          value: uiDraftValue,
        },
        { headers }
      );
      setSuccess('UI-Übersetzung gespeichert.');
      if (selectedEntry) {
        await loadDetail(selectedEntry);
      }
      await loadEntries(true);
    } catch (error: any) {
      setError(error.response?.data?.message || 'UI-Übersetzung konnte nicht gespeichert werden');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteUi = async () => {
    if (!uiDetail) return;
    const confirmed = window.confirm('Diese UI-Übersetzung wirklich löschen?');
    if (!confirmed) return;

    setDeleteLoading(true);
    clearMessage();
    try {
      await axios.delete('/api/admin/translation-planner/entries/ui', {
        headers,
        data: {
          language: uiDetail.language,
          key: uiDetail.key,
        },
      });
      setSuccess('UI-Übersetzung gelöscht.');
      setSelectedEntry(null);
      setUiDetail(null);
      await loadEntries(true);
    } catch (error: any) {
      setError(error.response?.data?.message || 'UI-Übersetzung konnte nicht gelöscht werden');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!emailDetail) return;
    setSaveLoading(true);
    clearMessage();
    try {
      await axios.patch(
        '/api/admin/translation-planner/entries/email',
        {
          language: emailDetail.language,
          templateId: emailDetail.templateId,
          templateName: emailDraft.templateName,
          subject: emailDraft.subject,
          htmlContent: emailDraft.htmlContent,
          textContent: emailDraft.textContent,
          translationNotice: emailDraft.translationNotice,
        },
        { headers }
      );
      setSuccess('E-Mail-Übersetzung gespeichert.');
      if (selectedEntry) {
        await loadDetail(selectedEntry);
      }
      await loadEntries(true);
    } catch (error: any) {
      setError(error.response?.data?.message || 'E-Mail-Übersetzung konnte nicht gespeichert werden');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteEmail = async () => {
    if (!emailDetail) return;
    const confirmed = window.confirm('Diese E-Mail-Übersetzung wirklich löschen?');
    if (!confirmed) return;

    setDeleteLoading(true);
    clearMessage();
    try {
      await axios.delete('/api/admin/translation-planner/entries/email', {
        headers,
        data: {
          language: emailDetail.language,
          templateId: emailDetail.templateId,
        },
      });
      setSuccess('E-Mail-Übersetzung gelöscht.');
      setSelectedEntry(null);
      setEmailDetail(null);
      await loadEntries(true);
    } catch (error: any) {
      setError(error.response?.data?.message || 'E-Mail-Übersetzung konnte nicht gelöscht werden');
    } finally {
      setDeleteLoading(false);
    }
  };

  const lastSummary = status?.lastSummary;

  return (
    <div className="translation-planner-page space-y-6">
      <div className="card p-5 space-y-4">
        <div className="translation-planner-header">
          <div>
            <h2 className="text-2xl font-semibold">Übersetzungen vorplanen</h2>
            <p className="text-sm text-slate-600">
              Laufende Vorplanung für UI- und E-Mail-Übersetzungen mit persistenter Bearbeitung.
            </p>
          </div>
          <div className="translation-planner-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRunNow}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'run' ? 'Starte...' : 'Jetzt durchlaufen'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePlay}
              disabled={actionLoading !== null || status?.enabled === true}
            >
              {actionLoading === 'play' ? 'Aktiviere...' : 'Play'}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleStop}
              disabled={actionLoading !== null || status?.enabled === false}
            >
              {actionLoading === 'stop' ? 'Stoppe...' : 'Stop'}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDeleteAllPretranslations}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'purge' ? 'Lösche...' : 'Alle Vorübersetzungen löschen'}
            </button>
          </div>
        </div>

        <div className="translation-planner-status-row">
          <span className={`translation-status-badge ${status?.enabled ? 'is-enabled' : 'is-disabled'}`}>
            <i className={`fa-solid ${status?.enabled ? 'fa-play' : 'fa-pause'}`} />
            {status?.enabled ? 'Aktiv' : 'Inaktiv'}
          </span>
          <span className={`translation-status-badge ${status?.inProgress ? 'is-running' : 'is-idle'}`}>
            <i className={`fa-solid ${status?.inProgress ? 'fa-gear fa-spin' : 'fa-circle-check'}`} />
            {status?.inProgress ? 'Laufend' : 'Leerlauf'}
          </span>
          <span className="translation-status-meta">
            Letzter Start: {formatDate(status?.lastStartedAt)}
          </span>
          <span className="translation-status-meta">
            Letztes Ende: {formatDate(status?.lastCompletedAt)}
          </span>
        </div>

        {status?.lastError && (
          <div className="message-banner p-3 rounded-lg bg-red-100 text-red-800">
            <i className="fa-solid fa-triangle-exclamation" /> {status.lastError}
          </div>
        )}

        {lastSummary && (
          <div className="translation-summary-grid">
            <div>
              <span>Sprachen</span>
              <strong>{lastSummary.languageCount}</strong>
            </div>
            <div>
              <span>Templates</span>
              <strong>{lastSummary.templateCount}</strong>
            </div>
            <div>
              <span>UI neu</span>
              <strong>{lastSummary.uiCreated}</strong>
            </div>
            <div>
              <span>UI aktualisiert</span>
              <strong>{lastSummary.uiUpdated}</strong>
            </div>
            <div>
              <span>E-Mail neu</span>
              <strong>{lastSummary.emailCreated}</strong>
            </div>
            <div>
              <span>E-Mail aktualisiert</span>
              <strong>{lastSummary.emailUpdated}</strong>
            </div>
            <div>
              <span>Dauer</span>
              <strong>{Math.max(0, Math.round((lastSummary.durationMs || 0) / 1000))}s</strong>
            </div>
          </div>
        )}
      </div>

      {message && (
        <div
          className={`message-banner p-3 rounded-lg flex items-center gap-2 ${
            messageType === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          <i className={`fa-solid ${messageType === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`} />
          {message}
        </div>
      )}

      <div className="translation-planner-grid">
        <div className="card p-4 space-y-4">
          <div className="translation-filter-row">
            <select value={kind} onChange={(e) => setKind(e.target.value as EntryKindFilter)}>
              <option value="all">Alle Typen</option>
              <option value="ui">UI</option>
              <option value="email">E-Mail</option>
            </select>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">Alle Sprachen</option>
              {(entries?.languages || []).map((entryLanguage) => (
                <option key={entryLanguage} value={entryLanguage}>
                  {entryLanguage}
                </option>
              ))}
            </select>
            <input
              type="search"
              placeholder="Suchen nach Schlüssel, Template oder Inhalt"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSearchQuery(searchInput.trim());
                }
              }}
            />
            <button type="button" className="btn btn-secondary" onClick={() => setSearchQuery(searchInput.trim())}>
              <i className="fa-solid fa-magnifying-glass" /> Suchen
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => loadEntries()}>
              <i className="fa-solid fa-rotate" /> Aktualisieren
            </button>
          </div>

          <div className="translation-table-meta text-sm text-slate-600">
            <span>Gesamt: {entries?.total || 0}</span>
            <span>UI: {entries?.counts.ui || 0}</span>
            <span>E-Mail: {entries?.counts.email || 0}</span>
          </div>

          <div className="translation-table-wrap">
            <SmartTable<TranslationEntry>
              tableId="admin-translation-planner-entries"
              userId={headers.Authorization}
              title="Übersetzungen"
              rows={entries?.items || []}
              columns={translationColumns}
              loading={listLoading}
              onRefresh={() => {
                void loadEntries();
              }}
              onRowClick={(row) => {
                void handleSelectEntry(row);
              }}
              getRowClassName={(row) => (selectedEntry?.id === row.id ? 'is-selected' : '')}
              disableRowSelectionOnClick
            />
          </div>
        </div>

        <div className="card p-4 space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Detailansicht</h3>
            <p className="text-sm text-slate-600">
              Ausgewählte Übersetzung prüfen, bearbeiten oder löschen.
            </p>
          </div>

          {detailLoading && (
            <div className="translation-detail-loading">
              <i className="fa-solid fa-spinner fa-spin" /> Detail wird geladen...
            </div>
          )}

          {!detailLoading && !selectedEntry && (
            <div className="translation-detail-empty">Bitte links einen Eintrag auswählen.</div>
          )}

          {!detailLoading && uiDetail && (
            <div className="space-y-3">
              <div className="translation-detail-header">
                <span className="badge">UI</span>
                <span>{uiDetail.language}</span>
                <span>{uiDetail.key}</span>
              </div>
              <div>
                <label>Quelle</label>
                <textarea value={uiDetail.sourceValue || ''} readOnly rows={5} />
              </div>
              <div>
                <label>Übersetzung</label>
                <textarea
                  value={uiDraftValue}
                  onChange={(e) => setUiDraftValue(e.target.value)}
                  rows={7}
                />
              </div>
              <div className="translation-detail-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveUi}
                  disabled={saveLoading || deleteLoading}
                >
                  {saveLoading ? 'Speichere...' : 'Speichern'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDeleteUi}
                  disabled={saveLoading || deleteLoading}
                >
                  {deleteLoading ? 'Lösche...' : 'Löschen'}
                </button>
              </div>
            </div>
          )}

          {!detailLoading && emailDetail && (
            <div className="space-y-3">
              <div className="translation-detail-header">
                <span className="badge">E-Mail</span>
                <span>{emailDetail.language}</span>
                <span>{emailDetail.templateId}</span>
              </div>
              <div>
                <label>Template-Name</label>
                <input
                  type="text"
                  value={emailDraft.templateName}
                  onChange={(e) =>
                    setEmailDraft((prev) => ({
                      ...prev,
                      templateName: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label>Quelle Betreff</label>
                <textarea value={emailDetail.sourceSubject || ''} readOnly rows={2} />
              </div>
              <div>
                <label>Betreff</label>
                <textarea
                  value={emailDraft.subject}
                  onChange={(e) =>
                    setEmailDraft((prev) => ({
                      ...prev,
                      subject: e.target.value,
                    }))
                  }
                  rows={2}
                />
              </div>
              <div>
                <label>Quelle HTML</label>
                <textarea value={emailDetail.sourceHtmlContent || ''} readOnly rows={6} />
              </div>
              <div>
                <label>HTML</label>
                <textarea
                  value={emailDraft.htmlContent}
                  onChange={(e) =>
                    setEmailDraft((prev) => ({
                      ...prev,
                      htmlContent: e.target.value,
                    }))
                  }
                  rows={10}
                />
              </div>
              <div>
                <label>Text</label>
                <textarea
                  value={emailDraft.textContent}
                  onChange={(e) =>
                    setEmailDraft((prev) => ({
                      ...prev,
                      textContent: e.target.value,
                    }))
                  }
                  rows={6}
                />
              </div>
              <div>
                <label>Übersetzungshinweis</label>
                <input
                  type="text"
                  value={emailDraft.translationNotice}
                  onChange={(e) =>
                    setEmailDraft((prev) => ({
                      ...prev,
                      translationNotice: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="translation-detail-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveEmail}
                  disabled={saveLoading || deleteLoading}
                >
                  {saveLoading ? 'Speichere...' : 'Speichern'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDeleteEmail}
                  disabled={saveLoading || deleteLoading}
                >
                  {deleteLoading ? 'Lösche...' : 'Löschen'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {(statusLoading || !status) && (
        <div className="text-sm text-slate-500">
          <i className="fa-solid fa-spinner fa-spin" /> Status wird geladen...
        </div>
      )}
    </div>
  );
};

export default TranslationPlanner;
