# ADR-0004 · KI-Provider-Vertrag und vierfache CI-Baseline vor Runtime-Umbau

**Datum:** 06.11.2026 · **Status:** technische Baseline im ersten Implementierungs-PR (vor Review; kein produktiver Nachweis). **Tickets:** [#14 F02](https://github.com/derdigitalaffine/behebes-ai/issues/14), [#73 K01](https://github.com/derdigitalaffine/behebes-ai/issues/73), vorbereitend [#74 K02](https://github.com/derdigitalaffine/behebes-ai/issues/74).

## Motivation

behebes.AI hat bereits einen LLM-Hub, ein KI-Queue-System und Administrationsfunktionen für Provider, Routing und Prompts. Ein Big-Bang-Refactor würde bestehende Aufgaben, Konfigurationen, Bildfunktionen und Bürger-/Verwaltungsvorgänge gefährden. Zuerst brauchen wir eine **reproduzierbare Baseline** und einen kleinen, verifizierbaren gemeinsamen Providervertrag.

## Ist-Aufnahme direkt aus Quellcode

| Codepfad | Beobachtetes Verhalten | Konkreter nächster Schritt |
| --- | --- | --- |
| `backend/src/services/llm-hub.ts` | `llmHub` speichert Connections, Task-/Default-Routen; Legacy-Migration bei leerem State | Typisierter Connection-Adapter, versionierter Zustand (K02/K18) |
| `llm-hub.ts:resolveLlmRuntimeSelection` | Explizite Connection/Model, danach Task-Route und Fallback auf erste aktivierte Connection | Policy-/Capability-/Budget-/Health-Prüfung vor Auswahl (K04/K06/K16) |
| `llm-hub.ts:fetchOpenAiCompatibleModels` | Versucht mehrere `/models`-Pfade; Modellcache und heuristische Modalitätsmerkmale | Kein Vertrauensbeweis aus Modellnamen; echte Probes und Capability-Gates (K04/K05) |
| `backend/src/services/ai.ts` | OpenAI-SDK-Clientcache, direkte Provider-Requests und persistierte Jobqueue mit Retry/Worker | Adapter-/Error-Vertrag und Side-Effect-Idempotenz (K02/K12/R04) |
| `backend/src/services/image-ai.ts` | Eigenständiger OpenAI-kompatibler Bildmodellclient | Multimodaler Adapter mit geprüften Datengrenzen (K10/S05) |
| `backend/src/services/ai-client.ts`, `openai.ts`, `config.ts` | Historische Providerpfade/AskCodi-Konfiguration neben dem LLM-Hub | Aufrufstellen vollständig inventarisieren und Alt-Config kompatibel migrieren (K18) |
| `admin/src/pages/AIProvider.tsx` und `AIQueue.tsx` | Provider-, Task-Routing-, Test- und Queue-UI, aktuell in bestehender Designbibliothek | Über Mantine-Foundation zu einem sicheren KI-Cockpit migrieren (K14) |

**Grenze:** Aus Quellcode lässt sich kein produktiver Lastwert, keine Betriebsfreigabe, keine vollständige Tenant-/Datenausleitungsprüfung und keine funktionierende Provider-API ableiten. Die Datenflüsse aller Task-Keys müssen vor Runtime-Wechsel verifiziert werden.

## Entscheidung 1 – CI als echte M0-Baseline

- Root `package-lock.json` plus `npm ci` mit Node 22, **vier getrennte Buildjobs** für Backend, Frontend, Admin und OPS; Fehler führen zu rotem Check, nicht zu `continue-on-error`.
- Backend-Testjob führt `vitest --run` aus. Keine Test-Watch-Schleife und kein automatisches „pass with no tests“.
- `scripts/report-test-inventory.mjs` berichtet Workspaces ohne Tests als **Coverage Gap**. Ein grüner Build sagt nichts über Business-Logik, Datenschutz oder E2E aus.
- Lint/Strict-Typechecking für Legacy-Code, Browser-/DB-Tests, Upgrade-/Restore-Drills und reale Providerproben bleiben explizit **separate** F02-, F04- und K22-Gates. Sie werden nicht fälschlich als bestanden angegeben.

## Entscheidung 2 – kleine, sichere Provider-Vertragsschicht

Neue Datei `backend/src/services/ai-provider-contract.ts` mit strukturellen Typen für Modellfähigkeiten, Generierung und einer **rein funktionalen** Fehlerklassifizierung. `classifyProviderFailure` gibt ausschließlich eine feste Fehlerkategorie, Retryability und optional den HTTP-Status zurück. Keine Weitergabe von rohen Provider-Fehlermeldungen, URLs, HTTP-Headers, Schlüssel oder Prompts; synthetische Tests decken 401/403, 408/429, 5xx, Netzwerkfehler, Abbruch und unbekannte Fehler ab.

**Bewusst nicht enthalten:** neuer Providerclient, Runtime-Adapterregistrierung, Task-Routing-Umbau, Secret-/Egress-Konfiguration, DB-Migration oder tatsächlicher automatischer Retry. `retryable: true` ist nur eine semantische Eigenschaft, **keine** Genehmigung zum Wiederholen: K06/K12 müssen Sensitivität, Tenant, freigegebene Provider und Idempotenz prüfen.

## Alternativen und Risiken

- Sofortiger Full-Replace von `llm-hub.ts`, `ai.ts` und Admin: **verworfen**, zu viele unverifizierte Daten- und API-Verträge.
- Alle Anbieter als gleichwertige „OpenAI-kompatible“ API behandeln: **verworfen**, Features, Auth, Outputformen und Fehlersemantik weichen ab.
- Nur Roadmap ohne echten Test-Code: **verworfen**, würde nicht belastbar auf Implementierung vorbereiten.
- Stufenweise CI, kontrollierter Vertrag, dann Provider-/Tenant-/Capability-Slices: **gewählt**, mit kleinster Rückfalloberfläche.

## Security, Migration und Rollback

**Keine** neuen Credentials, Netzwerkanfragen, Admin-/DB-Zustände, Releases oder Migrationen in dieser Stufe. Bestehende KI-Routinglogik läuft unverändert. Providerresponse-Objekte nicht raw loggen. Neue Endpunkt-/SSRF-/Egress-Policies erst nach Security-Review in K07; menschliche Freigaben vor außenwirksamen Aktionen sind invariant.

Rollback durch Revert dieses PRs; keine Datenmigration nötig. Freigabe durch Architekturreviews und unabhängiges Security-/QA-Review, nicht durch den Implementierer selbst.

## Evidenz / nächste Schritte

- GitHub Actions: Workspace-Buildmatrix, Backend-Contracttests und Testinventar (Ergebnis erst nach CI-Lauf dokumentieren).
- **K01 Teilabnahme:** Codepfade und Entscheidungs-/Migrationsrisiken erfasst; noch offen sind vollständige Aufrufstellen-/Datenflusskarte, Provider-Liveproben und operative SLOs.
- **K02 nächster Slice:** Provider-Adapterinterface und Mock-Transport mit verifizierter HTTP-/Timeout-/Abort-Semantik, bevor ein einzelner Task-Key unter Flag umgeschaltet wird.

[KI-Zielarchitektur](AI_BACKENDS.md) · [Teststrategie](TESTING.md) · [Security](SECURITY_PRIVACY.md) · [Git-Governance](git-governance.md).
