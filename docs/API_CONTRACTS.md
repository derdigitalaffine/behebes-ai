# API-, Realtime- und Workflow-Verträge

## Quelle und Status

Die zu prüfende **Ist-Quelle** sind `backend/src/index.ts` (Mounts), `backend/src/routes/*.ts` (Implementierung) und `backend/src/openapi.ts` (Dokumentationsmodell). Diese Datei beschreibt die Kontraktdisziplin und ausgewählte im Bestands-README dokumentierte Einstiegspunkte; sie ist **keine vollständige generierte Endpointliste**.

## API-Basis

Proxy-Pfad: `/api`; Swagger UI: `/api/docs`; Health: `/api/health`. Bürger-Frontend root bzw. `/c/<tenant-slug>` gemäß Routing, Administration `/admin`, OPS `/ops`. Versionierte URLs/Kompatibilitätsgarantien nur behaupten, wenn im Code nachgewiesen.

## Kontrakt pro Endpoint

```yaml
method: POST
path: /api/<resource>
actor: <berechtigte Rolle/Capability>
tenant_context: <serverseitig abgeleitet, fehlender Kontext führt zu Verweigerung>
request: <Schema, Limits, Idempotency-Key falls Schreibaktion>
responses:
  success: <Code und Datenvertrag>
  invalid: <400/422 und sichere Fehlermeldung>
  unauthenticated: 401
  forbidden: 403
  conflict: 409
side_effects: <DB, Audit, Events, externe Nachrichten>
retry_semantics: <idempotent oder ausdrücklich nicht wiederholbar>
privacy: <PII-Kategorien/Retention/Logging>
```

HTTP-Codes sind hier **Konventionsbeispiele**, nicht die Behauptung, jeder bestehende Endpoint implementiere sie bereits. Bestehendes Verhalten vor Änderungen mit Contract-Tests erfassen.

## Bewährte Zustandsregeln

- **HTTP-Schreibaktion:** Eingabe validieren, Actor und Scope prüfen, Transaktion, persistentes Ergebnis, Audit und anschließend ggf. Event.
- **Asynchroner Job:** stabiler Job-Key, erlaubte State Transitions, deduplizierte Ausführung, Retry mit Backoff, finale Fehlerdiagnose ohne PII.
- **SSE:** Event ist Zustands-Hinweis, keine alleinige Quelle der Wahrheit; nach Reconnect aktuelle Daten abrufen.
- **XMPP/Calls:** vorhandenes Hybrid-Presence-/`parallel_first_accept`-Modell und seinen Best-Effort-Caveat beachten (`chat-presence-calls.md`).
- **Import/Workflow:** fachlich überprüfbarer Preview-/Freigabeschritt vor schwer reversiblen Aktionen; Tenant-Grenzen auch in Worker-/Batch-Jobs.

## Dokumentierte administrative Update-Endpunkte

- `GET /api/admin/system/update/status`
- `POST /api/admin/system/update/preflight`
- `GET /api/admin/system/update/runbook`
- `GET /api/admin/system/update/history`

Diese liefern Prüf-/Runbook-Informationen und sind **keine allgemeine Remote-Shell**. Rechte und konkrete Responses immer gegen tatsächlichen Code testen.

## Kontraktänderung

1. Auswirkungen auf Bürger/Admin/OPS, bestehende Clients und Offline-Queue erfassen.
2. Bestehende Consumer nicht kommentarlos brechen; falls erforderlich Versionierungs-/Migrationsplan.
3. Route + OpenAPI + Integrationstests + Doku im selben PR ändern.
4. Sicherstellen, dass Fehlermeldungen, Suche, Exporte und Events keine fremden Mandantenobjekte offenlegen.
5. Retry/Concurrency und Audit-Folgen nachvollziehbar dokumentieren.
