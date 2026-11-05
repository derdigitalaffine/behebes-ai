# Start-Backlog für GitHub Issues (noch nicht angelegt)

**Stichtag:** 05.11.2026. Im geprüften GitHub-Stand von behebes-ai wurde **kein eigenständiges Issue** gefunden (nur geschlossener Release-PR #1). Diese Einträge sind **vorbereitete Issues**, keine existierenden Issue-Nummern, keine bestätigten Sicherheitslücken und kein verbindlicher Terminplan. Umsetzung nach menschlicher Priorisierung.

## P0 – Entwicklungs- und Betriebssicherheit

### B-01: Reproduzierbare Build-/Test-CI für alle Workspaces

- **Owner:** Backend & Frontend; **Review:** Security/QA; **Abhängigkeit:** Agenten-/Doku-Baseline.
- **Ziel:** PR-Checks `npm ci`, vier TS-Builds, real vorhandene Tests und OpenAPI-/Migrationsvertrag. CI darf fehlende Tests nicht als erfolgreiche Tests ausgeben.
- **Abnahme:** mindestens ein dokumentiert grüner Lauf, bekannte Ausnahmen sichtbar; GitHub-Required-Checks getrennt aktiviert.

### C-01: Produktive Compose-Secrets und Reverse-Proxy-Konfiguration härten

- **Owner:** Docs/Ops + Backend; **Review:** Security/QA; **Abhängigkeit:** B-01.
- **Ziel:** Fallback-Credentials für MySQL/JWT/XMPP bewerten und unsichere Produktionsstarts verhindern; Migrationsfolge für bestehende Installationen planen.
- **Abnahme:** nachvollziehbare Fail-Closed-/Setup-Strategie, Test mit fehlenden Credentials, Rotation, Rollback-/Upgradehinweis. Keine Secrets in Logs.

### C-02: Tenant-/RBAC-Isolation an Tickets, Workflows, Importen und Events nachweisen

- **Owner:** Security/QA + Backend; **Review:** Architektur.
- **Ziel:** direkter API-Zugriff mit falschem Mandanten/Org/Sitzung, SSE/Export/Attachments und Admin-Kontextwechsel geprüft.
- **Abnahme:** synthetische Negativtests mit Testprotokoll; Findings als eigene nicht-öffentliche Security-Aufgabe, soweit vertraulich.

### C-03: Backup-Restore- und Migrations-Drill

- **Owner:** Daten + Docs/Ops; **Review:** Security/QA.
- **Ziel:** Compose-Betrieb, `schema_migrations`, Legacy-Bootstrap und DB-/Datei-Restore in isoliertem Testsystem überprüfen.
- **Abnahme:** vollständiger Wiederherstellungsablauf inklusive RPO/RTO, Health- und fachlichen Smoke-Checks, dokumentierter Rollbackpfad.

## P1 – Fachliche Verlässlichkeit und UX

### D-01: AI-Queue-/Workflow-Lebenszyklus- und Idempotenz-Tests

- **Owner:** Backend; **Review:** Security/QA + Architektur.
- **Ziel:** Retry, Cancel, `failed`, Provider-Timeout, Doppelverarbeitung, untrusted LLM-Output und menschliche Freigaben belegen.
- **Abnahme:** deterministische Tests ohne externe KI-Credentials und ohne PII; keine unkontrollierte außenwirksame Aktion.

### D-02: OpenAPI–Route–Client-Contract-Abgleich

- **Owner:** Backend + Frontend; **Review:** Architektur.
- **Ziel:** Auth-/Tenant-/Fehlercodes und Task-/Response-Typen für die wichtigsten Bürger-/Admin-/OPS-Routen vergleichen.
- **Abnahme:** reproduzierbare Contract-/Integrationstests und aktualisierte API-Doku, dokumentierte Breaking Changes.

### E-01: Mobile-/Offline-/Accessibility-Kernweg-Abnahme

- **Owner:** Frontend/UX; **Review:** Security/QA.
- **Ziel:** Bürger-Meldung, Admin-Ticketbearbeitung, OPS-Ticket/QR/Offline-Queue auf 360px/Tablet/Desktop testen.
- **Abnahme:** synthetische Testdaten, Browser-/Keyboard-/Touch-Smokes, Offline-/Konfliktfälle und protokollierte verbleibende manuelle Prüfungen.

### F-01: Release-Runbook als geprobten Betriebspfad etablieren

- **Owner:** Docs/Ops; **Review:** Backend + Security/QA.
- **Ziel:** Git-/Version-/Preflight-/Backup-/Smoke-/Rollback-Dokumentation durch einen Probedurchlauf belegen.
- **Abnahme:** Testprotokoll, klare Owner und Freigabegrenzen, keine automatischen Produktivaktionen.

## Erstellen und nachhalten

Beim Übertragen nach GitHub `.github/ISSUE_TEMPLATE/feature.yml` verwenden. Issue-Titel, vollständige Akzeptanzkriterien und Scope übernehmen, sensible Befunde privat behandeln. Danach `ROADMAP.md`/`STATUS.md` mit tatsächlicher Issue-Nummer, Verantwortlichem und Status verknüpfen. `P0` bedeutet Reviewpflicht, **nicht** automatisch Produktionsvorfall.
