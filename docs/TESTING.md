# Teststrategie und Nachweismatrix

## Grundsatz

Tests sind Teil jedes fachlichen Slices. Bestehende `npm`-Scripts sind **kein Beleg**, dass Testfälle vorhanden sind oder ein Build grün ist. Die folgende Matrix ist der Zielzustand. Vor jedem PR sind ausgeführte und bewusst nicht ausgeführte Prüfungen mit tatsächlichem Ergebnis aufzuschreiben.

## Prüflevel und Beispiele

| Level | Geeignete Testfälle | Ziel |
| --- | --- | --- |
| Unit | Zuordnungs-/Validierungsregeln, Datum/Fristen, Statusübergänge, Retry-Berechnung | deterministisch und schnell |
| API/Integration | Auth, Tenant, Org-Scope, DB-Transaktionen, Queue-Idempotenz, OpenAPI | Server ist Autorität |
| Browser/E2E | Bürger meldet Anliegen, Admin bearbeitet, OPS übernimmt | End-to-End-Usability |
| Mobile/Offline | 360px, Touch, Flugmodus, verzögerter Sync, Konflikt/Wiederanlauf | reproduzierbare Feldnutzung |
| Betrieb/Release | Compose-Config, Health, Backup/Restore, Migration, Rollback | Wiederherstellbarkeit |
| Security | Upload, Export, RBAC-Negativfälle, Token, Prompt-Injection | gegen missbräuchliche Pfade |

## Lokale Startbefehle

```bash
# Voraussetzung: Node.js >= 22, passende lokale .env.local und Testsystem
npm ci
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix admin run build
npm --prefix ops run build

# Nur wenn die jeweiligen Tests im Workspace vorhanden und konfiguriert sind
npm --prefix backend test -- --run
npm --prefix frontend test -- --run
npm --prefix admin test -- --run
npm --prefix ops test -- --run

# Rein textbasierte Doku-/Link-Prüfung
node scripts/check-docs.mjs
```

`npm test` ruft in der aktuellen Codebasis teilweise Vitest auf; ein nicht terminierender Watch-Modus muss in CI mit `--run` ausgeschaltet werden. Fehlen Testdateien, ist dies ein **fehlender Gate**, nicht automatisch ein Erfolg. Verwende nie echte Produktions-Datenbanken für Tests oder Drills.

## Kernfall-Matrix (anzulegen)

| Flow | Positiv | Negativ | Wiederanlauf |
| --- | --- | --- | --- |
| Bürger-Meldung | gültige Eingabe → referenzierbarer Status | fehlende Pflichtdaten, falscher Dateityp, Rate Limit | Verbindung verliert Antwort nach Submit |
| Anmeldung / Sitzung | valider Login und Scope | alter Token, andere Org, fehlende Berechtigung | Refresh/Logout, 401/403 |
| Ticket / Workflow | autorisierte Bearbeitung | falsche Rolle, falscher Tenant, Statuskonflikt | Doppel-Klick, parallele Bearbeitung |
| KI-Queue | definierte Task-Route und Ergebnis | Provider-Ausfall, ungültige Antwort, Injection | Retry, Cancel, Duplicate Worker |
| E-Mail / Nachricht | eine autorisierte Zustellung | fehlerhafter Empfänger, fehlende Freigabe | Neustart nach Versandbestätigung |
| OPS / Offline | online Tickets, QR-Link, Sync | fremdes Ticket, veralteter Bearbeitungsstand | Offline-Queue, Versionskonflikt |
| Restore / Migration | auf isoliertem DB-Snapshot | Checksum-Drift, fehlender Backupstand | Rollback / erneuter Preflight |

## Browser-Abnahmestandard

Mindestens 360px, typische Tablet- und Desktopbreite; Touch und Tastatur. Teste Fokus, sichtbare Beschriftungen, primäre Handlung, Laden/Leer/Fehler/Erfolg/Gesperrt. Fehlermeldungen müssen Aktion und Kontext erhalten. Screenshot-Artefakte ausschließlich mit synthetischen Daten und kurzer Retention.

## Qualitäts-Evidenz im PR

Für jeden Testlauf: Commit, Befehl, Umgebung/Versionsstand, Ergebnis, Link auf CI/Artefakt oder lokal nachvollziehbare Ausgabe, bekannte Flakes und manuelle Prüfer. **Nicht ausgeführt** mit Grund versehen. Ausfälle nicht durch bloßes Erhöhen von Timeouts maskieren.

## Reihenfolge zum Aufbau neuer Tests

1. Backend: Auth-/Tenant-Negativfälle für Ticket-/Workflow-Routen.
2. Queue-/Job-Status- und Idempotenz-Tests mit fester Uhr/Provider-Mocks.
3. DB-Fresh- und Upgrade-Migrations-Tests.
4. Browser-Bürger-, Admin- und OPS-Smokes ohne echte Accounts.
5. Restore-/Rollback-Drill und Proxy-/Secret-Hardening in isoliertem Teststack.

## M0: erste laufende Produktcode-Baseline (nach Review/Merge)

Die neue Workflow-Datei `.github/workflows/application-quality.yml` führt für geänderte Workspaces vier **getrennte Buildjobs** und einen Backend-Vitest-Run aus. `npm ci` nutzt die Root-Lockdatei. Das Testinventar `scripts/report-test-inventory.mjs` meldet fehlende Tests, behauptet aber keine Testabdeckung.

```bash
npm ci --no-audit --no-fund
npm run build --workspace=backend
npm run build --workspace=frontend
npm run build --workspace=admin
npm run build --workspace=ops
npm test --workspace=backend -- --run
node scripts/report-test-inventory.mjs
```

Die ersten Backend-Tests prüfen **nur synthetische KI-Provider-Fehlerfälle**. Es gibt noch keine Aussage über API-/DB-/Queue-/Tenant-/Offline-/Browser-Funktion und keine vollständige ESLint-/Typecheck-/E2E-Freigabe. Fehler in der Baseline-CI bleiben als echte Findings sichtbar, nicht als still übergangene grüne Checks. [ADR-0004](ADR-0004-AI-PROVIDER-BASELINE.md).
