import React, { useState } from 'react';
import axios from 'axios';

interface TestResult {
  prompt: string;
  response: string;
  provider: string;
  model: string;
  timestamp: string;
}

const AIPromptTest: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<TestResult[]>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setResponse('');

    try {
      const token = localStorage.getItem('auth');
      const authData = token ? JSON.parse(token) : null;
      
      const apiResponse = await axios.post('/api/admin/ai/test', { prompt }, {
        headers: {
          Authorization: `Bearer ${authData?.token}`,
        },
      });

      setResponse(apiResponse.data.response);
      setProvider(apiResponse.data.provider);
      setModel(apiResponse.data.model);
      
      setResults([
        {
          prompt: apiResponse.data.prompt,
          response: apiResponse.data.response,
          provider: apiResponse.data.provider,
          model: apiResponse.data.model,
          timestamp: apiResponse.data.timestamp,
        },
        ...results.slice(0, 9),
      ]);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error || 'Test fehlgeschlagen');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearPrompt = () => {
    setPrompt('');
    setResponse('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">KI-Prompt-Tester</h1>
        <p className="text-slate-600 mt-2">
          Teste die aktuelle KI-Konfiguration mit benutzerdefinierten Prompts
        </p>
      </div>

      {/* Current Config */}
      {provider && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm">
            <span className="font-semibold">Aktueller Provider:</span> {provider} · <span className="font-semibold">Modell:</span> {model}
          </p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {error}
        </div>
      )}

      {/* Prompt Form */}
      <form onSubmit={handleTest} className="bg-white rounded-lg shadow-md p-6">
        <div className="mb-4">
          <label htmlFor="prompt" className="block text-sm font-semibold text-slate-900 mb-2">
            Prompt eingeben
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isLoading}
            rows={5}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            placeholder="Geben Sie einen Prompt ein, um die KI zu testen..."
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isLoading || !prompt.trim()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold rounded-lg transition"
          >
            {isLoading ? (
              <span><i className="fa-solid fa-spinner fa-spin" /> Wird verarbeitet...</span>
            ) : (
              <span><i className="fa-solid fa-flask" /> Testen</span>
            )}
          </button>
          <button
            type="button"
            onClick={handleClearPrompt}
            disabled={isLoading}
            className="px-6 py-2 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-300 text-slate-900 font-semibold rounded-lg transition"
          >
            Löschen
          </button>
        </div>
      </form>

      {/* Response Display */}
      {response && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">KI-Antwort</h3>
          <div className="bg-white p-4 rounded border border-emerald-100 max-h-96 overflow-y-auto">
            <p className="text-slate-700 whitespace-pre-wrap">{response}</p>
          </div>
        </div>
      )}

      {/* Results History */}
      {results.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Verlauf (letzte 10)</h3>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {results.map((result, idx) => (
              <div key={idx} className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-2">{new Date(result.timestamp).toLocaleString('de-DE')}</div>
                <p className="text-sm font-medium text-slate-900 mb-2">
                  Prompt: {result.prompt.substring(0, 80)}...
                </p>
                <p className="text-sm text-slate-700 bg-slate-50 p-2 rounded">
                  {result.response.substring(0, 120)}...
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Example Prompts */}
      <div className="bg-slate-50 rounded-lg p-6 border border-slate-200">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Beispiel-Prompts</h3>
        <div className="space-y-2">
          {[
            'Erkläre die Unterschiede zwischen SQLite und PostgreSQL.',
            'Wie kann ich einen REST API in Express.js erstellen?',
            'Was ist PII und welche Daten gehören dazu?',
            'Schreibe einen kurzen Gedicht über die Verbandsgemeinde Otterbach Otterberg.',
          ].map((example, idx) => (
            <button
              key={idx}
              onClick={() => setPrompt(example)}
              className="w-full text-left px-3 py-2 bg-white rounded border border-slate-200 hover:bg-blue-50 transition text-sm text-slate-700"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AIPromptTest;
