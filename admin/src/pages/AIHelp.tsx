import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
};

const HELP_SECTIONS = [
  { value: 'allgemein', label: 'Allgemein' },
  { value: 'tickets', label: 'Tickets' },
  { value: 'workflows', label: 'Workflows' },
  { value: 'templates', label: 'E-Mail-Templates' },
  { value: 'prompts', label: 'Systemprompts' },
  { value: 'redmine', label: 'Redmine' },
  { value: 'email', label: 'SMTP/E-Mail' },
  { value: 'ki', label: 'KI-Einstellungen' },
];

const EXAMPLE_QUESTIONS = [
  'Wie richte ich einen Workflow mit Freigabe und Ablehnungspfad ein?',
  'Welche Platzhalter sollte ich im Workflow-Bestätigungs-Template verwenden?',
  'Wie prüfe ich, warum Redmine-Tickets nicht erstellt werden?',
  'Wie stelle ich alle KI-Systemprompts im Admin korrekt ein?',
];

const AIHelp: React.FC = () => {
  const [question, setQuestion] = useState('');
  const [section, setSection] = useState('allgemein');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [providerInfo, setProviderInfo] = useState('');

  const canSend = useMemo(() => question.trim().length >= 3 && !loading, [question, loading]);

  const handleAsk = async () => {
    if (!canSend) return;
    const nextQuestion = question.trim();
    const nextUserMessage: ChatMessage = {
      role: 'user',
      content: nextQuestion,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, nextUserMessage]);
    setQuestion('');
    setLoading(true);
    setError('');

    try {
      const token = getAdminToken();
      const response = await axios.post(
        '/api/admin/ai/help',
        {
          question: nextQuestion,
          section,
          history: [...messages.slice(-8), nextUserMessage].map((entry) => ({
            role: entry.role,
            content: entry.content,
          })),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const answer = String(response.data?.answer || '').trim();
      if (!answer) {
        setError('Die KI-Hilfe hat keine Antwort geliefert.');
        return;
      }

      setProviderInfo(
        response.data?.provider && response.data?.model
          ? `${response.data.provider} · ${response.data.model}`
          : ''
      );

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: answer,
          timestamp: String(response.data?.timestamp || new Date().toISOString()),
        },
      ]);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'KI-Hilfe aktuell nicht verfügbar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">KI-Hilfe</h2>
        <p className="text-slate-600 mt-1">
          Stellen Sie Fragen zur Bedienung des Admin-Backends. Die KI antwortet mit konkreten Schritten.
        </p>
        {providerInfo && (
          <p className="text-xs text-slate-500 mt-2">
            Aktuelle KI: {providerInfo}
          </p>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="md:col-span-1">
            <span className="block text-sm font-semibold text-slate-700 mb-1">Bereich</span>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              value={section}
              onChange={(event) => setSection(event.target.value)}
              disabled={loading}
            >
              {HELP_SECTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="block text-sm font-semibold text-slate-700 mb-1">Frage</span>
            <div className="flex gap-2">
              <input
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleAsk();
                  }
                }}
                placeholder="z. B. Wie aktiviere ich einen Statuslink in E-Mail-Templates?"
                disabled={loading}
              />
              <button
                type="button"
                className="btn btn-primary whitespace-nowrap"
                onClick={() => void handleAsk()}
                disabled={!canSend}
              >
                {loading ? 'Frage läuft...' : 'Fragen'}
              </button>
            </div>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              key={example}
              type="button"
              className="btn btn-secondary text-sm"
              onClick={() => setQuestion(example)}
              disabled={loading}
            >
              {example}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setMessages([])}
            disabled={loading || messages.length === 0}
          >
            Verlauf löschen
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="text-lg font-semibold text-slate-900">Verlauf</h3>
        {messages.length === 0 ? (
          <p className="text-sm text-slate-600">Noch keine Fragen gestellt.</p>
        ) : (
          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {messages.map((entry, index) => (
              <div
                key={`${entry.timestamp}-${index}`}
                className={`rounded-lg border p-3 text-sm ${
                  entry.role === 'assistant'
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="font-semibold mb-1">
                  {entry.role === 'assistant' ? 'KI-Hilfe' : 'Sie'} ·{' '}
                  {new Date(entry.timestamp).toLocaleString('de-DE')}
                </div>
                <div className="whitespace-pre-wrap text-slate-800">{entry.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AIHelp;
