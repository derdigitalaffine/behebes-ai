# Roadmap – von Codebestand zu überprüfbarem Betrieb

**Stand 05.11.2026.** Dies ist eine **initiale, evidenzorientierte Roadmap** aus der Repository-Inventur, nicht die Behauptung einer vorhandenen GitHub-Projects-Planung. Termine/Stories werden nach fachlicher Priorität und Kapazität festgelegt. Release `v1.0.7` vom 01.03.2026 ist der letzte bestätigte GitHub-Release, kein attestierter aktueller Produktionstand.

## Prioritätsmodell

- **P0 – betriebskritisch:** Datenschutz, Mandantentrennung, Autorisierung, Datenintegrität, Restore, geschlossene kritische Lücken.
- **P1 – Releasequalität:** durchgängige Tests, beobachtbare Workflows, robuste UX, Dokumentationsvertrauen.
- **P2 – Weiterentwicklung:** Komfort, zusätzliche Automatisierung und Ausbau nach stabiler Basis.

## Phase A – Evidenz und Entwicklungsorganisation (P0)

**Liefergegenstand:** `AGENTS.md`, Rollen, Übergabeprotokoll, Doc-Index, Architekturkarte, Status-Snapshot, PR-/Issue-Vorlagen, Doku-CI; nachvollziehbare Risiken statt unbelegter Reifegradzahl.

**Abnahme:** Alle Agentenrollen kennen Read-first, Grenzen und Review-Owner; `node scripts/check-docs.mjs` ist grün; PR liefert Dateiliste und Validierung. **Status:** mit diesem Paket vorbereitet, noch nicht gemergt oder in GitHub aktiviert.

## Phase B – reproduzierbare Qualitätsbaseline (P0)

1. GitHub Actions mit Node-Version gemäß `backend/package.json` (`>=22`) aufsetzen.
2. `npm ci`, vier TS-Builds, passende Tests, `tsc`/Lint kontrolliert ausführen; nicht existierende Tests nicht als grün ausgeben.
3. GitHub-PR-Checks und Schutzregeln tatsächlich konfigurieren/prüfen; den bestehenden Git-Runbook-Anspruch mit Realität vergleichen.
4. OpenAPI- und Migrations-Drift-Checks sowie minimale API-Health-/Auth-Smokes ergänzen.

**Abnahme:** reproduzierbarer CI-Lauf mit echten Log-/Check-URLs, bekannten Flakes und einem benannten Pflicht-Gate. **Abhängigkeit:** Phase A.

## Phase C – Sicherheit & Datenresilienz (P0)

1. Compose-Fallback-Credentials entfernen oder produktiv fail-closed gestalten; bestehende Deployments migrationssicher behandeln.
2. JWT/CORS/Proxy-/Token-/API-Zugriffe prüfen, Tenant- und Org-Scope mit gezielten Negativtests belegen.
3. Bürger-Uploads, Datenexporte, Prompt-Injection, AI-Queue-Outputs und ausgehende Aktionen prüfen.
4. Datenaufbewahrung, Löschung, Audit, redaktionelle Freigaben und externe Provider-Datenströme dokumentieren.
5. Restore auf separater Testinstanz vorführen; Migration/Legacy-Bootstrap und Rollback-Szenarien belegen.

**Abnahme:** dokumentierte Prüfmatrix, Findings nach Schweregrad, verifizierte Gegenmaßnahmen, Restore-Protokoll ohne Echtdaten. **Abhängigkeit:** B.

## Phase D – deterministische Fach- und AI-Workflows (P1)

1. Workflow-/Queue-Lebenszyklus: Zustandsübergänge, Retries, Duplikate, Zuständigkeiten, Freigaben.
2. API-Schema zu Implementierung abgleichen, Berechtigungsvarianten pro Endpoint.
3. LLM-Routing und KI-Bewertung mit synthetischen Szenarien, Fallback/Timeout/Kostenlimit und Mensch-in-der-Schleife testen.
4. Import-/Organisations-Zuständigkeitskonflikte und Batch-Rollback testen.

**Abnahme:** Unit-/API-/Integrationstests inkl. Negativfälle; kein KI-Output löst unberechtigte Fachaktion aus. **Abhängigkeit:** B/C.

## Phase E – benutzbare, mobile End-to-End-Kernwege (P1)

- **Bürger:** Meldung, Verifikation, Status, Mehrsprachigkeit, PWA-Verbindungsabbruch.
- **Admin:** Login, Ticket, Zuweisung, Workflow, AI-Queue/Fehler, Mailbox, Rollenrechte.
- **OPS:** mobile Ticketannahme, Offline-Warteschlange, Wiederanlauf, QR-Deep-Link, Messenger.
- **Querschnitt:** 360px, Touch, Tastatur/Fokus, Fehlermeldungen ohne Datenverlust, leere/gesperrte Zustände.

**Abnahme:** Browser-Smokes mit Testkonten und Screenshots ohne PII; manuelle Accessibility-Abnahme dokumentiert. **Abhängigkeit:** B–D.

## Phase F – Release- und Betriebsreife (P1)

Runbooks für Installation, Monitoring, Backup/Restore, Incident-Reaktion, Migrationsblocker, Rollback, versionierte Container bauen. Readiness-Review vor jedem Tag.

**Abnahme:** mindestens ein vollständiger Drill mit Runbook, protokollierten Zeitpunkten und Verantwortlichen. **Abhängigkeit:** B/C/E.

## Phase G – Ausbau (P2)

Erst nach stabilen Gates: Modulentflechtung, zielgerichtete Agentenassistenz im Produkt, verfeinerte Suche/Analytik, Queue-Observability, automatische Bereitstellung mit expliziter Genehmigung.

Detaillierte vorgeschlagene Issues mit Akzeptanzkriterien: [Start-Backlog](ISSUE_BACKLOG.md).

## Arbeitsvorrat / Issue-Schnitt

| Paket | Rolle führend | Reviewer | Schnitt |
| --- | --- | --- | --- |
| A-01 Agenten- und Doku-Baseline | Docs/Operations + Orchestrator | Security/QA | dieses Paket |
| B-01 CI-Build-/Testbaseline | Backend + Frontend | Security/QA | 1 PR |
| C-01 Konfigurations-/Secrets-Hardening | Architektur + Backend | Security/QA | eigenes PR |
| C-02 Restore-/Migrations-Drill | Operations + Daten | Security/QA | eigenes PR |
| D-01 Workflow/Queue-Kontrakt-Tests | Backend | Security/QA | kleine vertikale PRs |
| E-01 Bürger-/Admin-/OPS-Smokes | Frontend/UX | Security/QA | pro Kernweg PR |

**Änderungsregel:** Jede priorisierte Zeile nach Anlage einer Issue-Nummer mit Issue/PR verlinken und den Status auf `offen`, `in Arbeit`, `blockiert`, `verifiziert` setzen. Kein automatisches „fertig“ aufgrund eines geschriebenen Dokumentes.
