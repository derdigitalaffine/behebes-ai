# AskCodi-Anbindung (Extrakt, ohne Credentials)

Diese Datei ist eine neutrale Vorlage aus der bestehenden Umsetzung in diesem Projekt, damit du die Anbindung in einem anderen Projekt per Prompt nachbauen kannst, ohne Secrets zu übernehmen.

## 1) Architektur, so wie hier umgesetzt

1. Provider-Abstraktion statt hartem Vendor-Lock.
2. Laufzeitkonfiguration aus zwei Schichten:
   - `ai` (Provider + Modell)
   - `aiCredentials` (API-Keys/Secrets, getrennt verwaltet)
3. Ein gemeinsamer AI-Client via OpenAI-SDK gegen OpenAI-kompatible API (`baseURL` umgebogen auf AskCodi).
4. Queue-basierte Ausführung (persistiert, retriable) für AI-Requests.
5. Admin-API für:
   - Credentials lesen/speichern (maskiert zurückgeben)
   - Provider/Modell lesen/speichern
   - Provider-Modelle dynamisch laden
   - Testprompt gegen aktiven Provider.

## 2) Konfigurationsmuster (credential-frei)

Empfohlene ENV-Variablen:

```bash
AI_PROVIDER=askcodi
AI_MODEL=openai/gpt-5-mini

ASKCODI_API_KEY=<SET_IN_ENV_OR_SECRET_STORE>
ASKCODI_BASE_URL=https://api.askcodi.com/v1

# optional, falls Multi-Provider
OPENAI_CLIENT_ID=
OPENAI_CLIENT_SECRET=
```

Wichtig:
- Niemals echte Keys in `.env.example` oder Repo committen.
- Secrets nur in Secret-Store, Runtime-ENV oder DB (verschlüsselt) halten.

## 3) Kernimplementierung (technisch exakt nach Muster)

### 3.1 Runtime-Config laden

- `loadAiSettings()` liefert:
  - `provider: 'openai' | 'askcodi'`
  - `model: string`
- `loadAiCredentials()` liefert:
  - `askcodiApiKey`, `askcodiBaseUrl`, optional OpenAI-Creds.
- `getAiRuntimeConfig()` führt beides zusammen.

### 3.2 AI-Client Factory

AskCodi-Zweig:
- Validierung: API-Key vorhanden.
- `baseUrl` normalisieren:
  - trailing `/` entfernen
  - optionales `/v1` entfernen
- OpenAI-SDK mit `apiKey` + `baseURL` instanziieren.

Minimalbeispiel:

```ts
import OpenAI from 'openai';

export function createAIClient(cfg: {
  aiProvider: 'openai' | 'askcodi';
  askcodi: { apiKey: string; baseUrl: string };
}) {
  if (cfg.aiProvider !== 'askcodi') throw new Error('Only askcodi expected here');
  if (!cfg.askcodi.apiKey) throw new Error('ASKCODI_API_KEY required');

  let base = cfg.askcodi.baseUrl || '';
  base = base.replace(/\/+$/g, '').replace(/\/v1$/g, '');

  return new OpenAI({
    apiKey: cfg.askcodi.apiKey,
    baseURL: base,
    defaultHeaders: { 'User-Agent': 'your-app/1.0.0 (AskCodi Provider)' },
  });
}
```

### 3.3 Request-Ausführung

Primär:
- `client.chat.completions.create({ model, messages, max_tokens })`

In dieser Codebasis zusätzlich:
- Für AskCodi ein direkter REST-Call auf `POST {base}/v1/chat/completions`
- Bei Fehler Fallback zurück auf SDK-Call.

### 3.4 Queue/Retry (robust)

Verwendetes Muster:
- Tabelle `ai_queue` mit Status:
  - `pending | retry | processing | done | failed | cancelled`
- Worker-Loop (Intervall) verarbeitet seriell.
- Exponential Backoff bei Fehlern.
- `testAIProvider()`:
  - request enqueuen
  - Verarbeitung anstoßen
  - auf Ergebnis warten (Timeout).

Das ist produktionsrobuster als direkte synchrone LLM-Calls in jedem API-Handler.

## 4) Admin-API-Verträge (übertragbares Muster)

1. `GET /api/admin/config/ai`
   - Gibt aktiven Provider, Modell, verfügbare Provider/Modelle zurück.
   - Lädt bei AskCodi optional dynamisch:
     - `GET {base}/v1/provider-models`
     - erwartet `data[]` mit `name`.

### 4.1 Verfügbare Modelle konkret auslesen (wie hier)

Flow:
1. Fallback-Liste initial setzen (damit UI immer etwas anzeigen kann).
2. AskCodi nur anfragen, wenn Provider `askcodi` aktiv ist oder ein AskCodi-Key vorhanden ist.
3. `askcodiBaseUrl` normalisieren:
   - trailing `/` entfernen
   - vorhandenes `/v1` entfernen
4. `GET {base}/v1/provider-models` mit `Authorization: Bearer <key>`.
5. Bei Erfolg:
   - `json.data` prüfen
   - `availableModels.askcodi = json.data.map(m => m.name).filter(Boolean)`
6. Bei Fehler:
   - nur warnen/loggen
   - Fallback-Liste behalten (Endpoint `/config/ai` bleibt stabil).

Beispiel (nah an der laufenden Implementierung):

```ts
let availableModels = {
  openai: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'],
  askcodi: ['gpt-4o', 'gpt-4'],
};

if (aiConfig.provider === 'askcodi' || creds.askcodiApiKey) {
  try {
    const base = (creds.askcodiBaseUrl || '')
      .replace(/\/+$/g, '')
      .replace(/\/v1$/g, '');
    const url = `${base}/v1/provider-models`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${creds.askcodiApiKey}`,
        'User-Agent': 'your-app/1.0.0',
      },
    });

    if (resp.ok) {
      const json = (await resp.json()) as any;
      if (Array.isArray(json?.data)) {
        availableModels.askcodi = json.data.map((m: any) => m.name).filter(Boolean);
      }
    } else {
      console.warn('provider-models fetch failed', resp.status);
    }
  } catch (err) {
    console.warn('Error fetching provider models:', err);
  }
}
```

2. `PATCH /api/admin/config/ai`
   - Setzt `provider` + `model`.
   - Validiert, dass erforderliche Credentials vorhanden sind.

3. `GET /api/admin/config/ai/credentials`
   - Gibt Credentials maskiert zurück (`***` statt Secret).

4. `PATCH /api/admin/config/ai/credentials`
   - Speichert neue Werte.
   - Behandelt `'***'` als „bestehenden Wert behalten“.

5. `POST /api/admin/ai/test`
   - Nimmt `prompt`
   - Führt Test über Queue aus
   - Antwort mit `provider`, `model`, `response`.

## 5) Sicherheits- und Betriebsregeln

1. Keys niemals ins Frontend senden.
2. Credential-Endpunkte nur für Admin/Superadmin.
3. Maskierte Rückgabe von Secrets.
4. Audit-Logging für Credential-Änderungen.
5. Rate-Limit + Timeout + Retry zentral steuern.
6. Bei personenbezogenen Daten: vor LLM-Aufruf serverseitig PII filtern.

## 6) Copy/Paste Prompt für ein anderes Projekt

```text
Implementiere in meinem Projekt eine AskCodi-Anbindung als OpenAI-kompatiblen Gateway (TypeScript + Node.js + Express), ohne hardcodierte Credentials.

Ziele:
1) Provider-Abstraktion: aiProvider ('openai' | 'askcodi') + aiModel.
2) Separate Credential-Verwaltung: askcodiApiKey, askcodiBaseUrl.
3) Runtime-Config aus ENV + optional DB-Settings.
4) AI-Client-Fabrik mit OpenAI-SDK:
   - bei askcodi: baseUrl normalisieren (trailing slash + optional /v1 entfernen)
   - client.chat.completions.create(...) verwenden.
5) Robuste AI-Queue:
   - Tabelle ai_queue mit Status pending/retry/processing/done/failed/cancelled
   - Worker mit Retry + Exponential Backoff
   - testAIProvider(prompt): enqueue + wait for result mit Timeout.
6) Admin-Endpunkte:
   - GET/PATCH /api/admin/config/ai
   - GET/PATCH /api/admin/config/ai/credentials (maskiert, '***' = beibehalten)
   - POST /api/admin/ai/test
   - optional: provider-models von AskCodi via /v1/provider-models laden.
7) Keine Secrets im Code/Repo:
   - nur Placeholders in .env.example
   - klare Validation-Fehler bei fehlendem API-Key.
8) Liefere:
   - konkrete Code-Änderungen
   - Migrationsskript (falls ai_queue neu)
   - kurze Smoke-Tests (curl)
   - Fehlerfälle (401/429/5xx) sauber behandelt.

Akzeptanzkriterien:
- Wechsel des Providers/Modells zur Laufzeit ohne Deploy.
- AskCodi-Testprompt liefert Antwort über Admin-Endpoint.
- Secrets werden nie unmaskiert ausgegeben.
- Queue verarbeitet Requests stabil mit Retry.
```

## 7) Kurzer Smoke-Test (ohne echte Keys im Prompt)

```bash
# 1) Provider setzen
curl -X PATCH http://localhost:3001/api/admin/config/ai \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"askcodi","model":"openai/gpt-5-mini"}'

# 2) Credentials setzen (nur Beispiel)
curl -X PATCH http://localhost:3001/api/admin/config/ai/credentials \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"askcodiApiKey":"<SECRET>","askcodiBaseUrl":"https://api.askcodi.com/v1"}'

# 3) AI-Test
curl -X POST http://localhost:3001/api/admin/ai/test \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Erkläre kurz den Zweck einer REST-API."}'
```

---

Stand dieser Vorlage: basiert auf der aktuellen Implementierungsstruktur dieses Repos (Provider-Fabrik + Admin-Config + Queue-gestützter Testaufruf).
