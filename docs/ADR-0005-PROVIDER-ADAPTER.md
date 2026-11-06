# ADR-0005 – Geprüfter KI-Chat-Provideradapter

**Datum:** 2026-11-06. **Status:** Implementierung als PR #96, unabhängige Architektur-/Security-Review noch offen. **Bezug:** K02 #74 und F02 #14.

## Anlass und Architekturentscheidung

Der bestehende LLM-Hub und die KI-Queue besitzen bereits produktive fachliche Aufrufstellen. Diese dürfen nicht still auf neue HTTP-Transporte umgeroutet werden. Die erste Adapterstufe ist daher **isoliert**, deterministisch per Fake-Fetch testbar und nicht an den laufenden LLM-Hub angeschlossen.

- **Schnittstelle:** ProviderAdapter mit generate(request, abortSignal), umgesetzt als OpenAI-kompatibler Chat-Completions-Transport. Andere Protokolle (native Provider, Streaming, Vision/Tools) sind **nicht** durch den Namen „kompatibel“ zugesagt.
- **Zielprüfung:** Nur freigegebene HTTPS-Origin-Liste. Keine Zugangsdaten, Queries oder Fragmente in Base-URLs. HTTP-Redirects werden nicht verfolgt, sodass ein Token nicht an einen Redirect-Zielhost weitergereicht wird.
- **Fähigkeiten:** Der Modellbezeichner muss exakt in einem vorher geprüften/declared Katalog stehen und explizit Text unterstützen. Unbekannte Capability = keine Ausführung, kein stiller Providerwechsel.
- **Gebundene Ausführung:** Nachrichten- und Ausgabelimits, Abort-Signal, begrenzte Timeoutspanne und Antwortgrößenlimit. Pro Aufruf genau eine Netzwerkoperation, kein impliziter Retry oder kostenpflichtiger Probe-Aufruf.
- **Fehler-/Ausgabevertrag:** Nur feste Fehlerkategorie, Retry-Klassifikation und optional HTTP-Status verlassen den Transport. Provider-Rohantworten, Token, persönliche Daten und Fehlermeldungen werden bei Fehlern verworfen. Ein gültiger Chat-Response wird normalisiert; ungültige/fehlende Inhalte werden abgelehnt.
- **Varianten:** Max-Token-Feldname ist providerabhängig konfigurierbar, um Unterschiede zwischen Chat-Endpunkten nicht durch implizite Annahmen zu verdecken.

## Bedrohungs- und Migrationsgrenzen

Eine Origin-Allowlist allein **verhindert nicht DNS-Rebinding/SSRF**. K07 erfordert Netzwerk-/DNS-/IP-/Egress-Policies auch nach Resolving/Redirects; K03 erfordert Secret-Lifecycle; K16 Tenant-/Datenresidenz-/Privacy-Gates; K06 Policy-Routing; K12 Side-Effect-Idempotenz. Auf Grundlage dieses PRs darf **kein Admin eine beliebige Provider-URL freigeben**. Der Adapter ist kein produktiver Auth-, Tenant- oder Datenschutz-Guard.

Die vorhandenen Dateien llm-hub.ts, ai.ts, image-ai.ts sowie die Legacy-Konfiguration und alle gespeicherten Jobs bleiben unverändert. Keine Migration, kein Live-Provider-Test, kein Deployment. Rückfall = Revert des isolierten Adapterpakets.

## Parallel eingeführte UI-Tests (F02)

Gemeinsames Vitest als deklarierte Root-Devdependency, festgehalten im Root-Lockfile. Drei CI-Jobs führen Unit-Suites für Bürgerfrontend (PWA-Deep-Link-Sanitization), Admin (Task-Key-Beschriftungen) und OPS (Tenant-/Capability-Scopes) aus. Das Bürgerfrontend lehnt nun zusätzlich Backslash- und gefährlich mehrfach kodierte lokale Pfade ab.

**Umfang und Ehrlichkeit:** Dies sind erste Pure-Logic-Tests, keine Browser-/DB-/RBAC-/Offline-/E2E-Abnahme. Eine PWA-UI-Prüfung kann serverseitige Berechtigung nicht ersetzen.

## Review, Gate und Ausblick

PR #96: https://github.com/derdigitalaffine/behebes-ai/pull/96

- Backend-Architekturreview: Request-/Response-/Error-Contract und Provider-Kompatibilität.
- Security-Review: Secretweitergabe, DNS/IP-/Egress-Lücke, Timeout-/Abort-Verhalten, Fehlerredaktion und UX-Scope.
- Produktreview: keine ungeprüften externen KI-Aktionen.
- Nach erfolgreichen Unit-/Build-Checks folgen getrennte K03/K07/K16-Implementierungen und eine zunächst geflaggte Pilot-Task-Migration. Ein bloßes CI-Grün erlaubt noch keinen produktiven Providerwechsel.

Referenzen: [KI-Zielarchitektur](AI_BACKENDS.md), [ADR-0004](ADR-0004-AI-PROVIDER-BASELINE.md), [Teststrategie](TESTING.md).
