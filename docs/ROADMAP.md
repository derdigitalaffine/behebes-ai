# behebes.AI Next · detaillierte Weiterentwicklungsroadmap

**Stand:** 06.11.2026. **Quellcodebasis:** `main@12ae45fa`, Arbeitsdokumente im Branch `docs/agenten-orchestrierung-und-projektleitfaden`. **Ist und Soll strikt getrennt.** Kein produktiver Performance-/Datenschutz-/QA-Nachweis aus diesem Plan ableitbar.

> **GitHub-Status:** Issues sind aktiv und **alle 92 Planungsobjekte sind tatsächlich in GitHub angelegt**: [Master-Roadmap [#3](https://github.com/derdigitalaffine/behebes-ai/issues/3)](https://github.com/derdigitalaffine/behebes-ai/issues/3), 10 Epics und 81 Slices. Die 8 Milestone-Gates werden unter [Meilensteinplan](MILESTONES.md) und [Planungsmanifest](../planning/milestones.json) verwaltet. Angelegt ≠ implementiert; es liegen keine produktiven Performance- oder Abnahmedaten aus dem Roadmap-Prozess vor.

## Produktleitbild

**Bürgeranliegen → korrekte Zuständigkeit → sichere Sachbearbeitung/Workflow → mobile OPS-Ausführung → transparenter Abschluss.** Eine funktionierende App minimiert Unsicherheit, Nacharbeit, Kontextwechsel und unkontrollierte Automatisierung. Kein generisches Dashboard-Redesign ohne belegten Nutzwert. Siehe [Produktvision und Nutzerjobs](PRODUCT_VISION.md).

## Prioritäten und Qualitäts-Gates

- **P0:** Auth/Privacy/Tenant, Datenintegrität, Bereitstellung/Restore, CI/Testbasis, Modulvertrags- und Job-Sicherheit. P0 ist Risikoklasse, keine Behauptung akuter Sicherheitslücken.
- **P1:** anwendungsübergreifender UI-Polish/Mantine, task-first Admin, Bürger- und OPS-Experience, solide Performance, Release-Prozess.
- **P2:** nutzerzentrierte Verbesserungen nach stabiler Basis (Feedback, GIS-Comfort, ergänzende Analytics).
- **Ready:** Persona + Nutzen, Modul-/Tenant-/Org-Scope, Fehlerpfade/Dependencies, API-/DB-/Offline-/Job-/KI-Folgen, Testplan und Review.
- **Done:** funktionierender vertikaler Slice, Backend-Guards + Negativtests, 320/360px/Keyboard, CI/Browser/E2E, Performancevergleich, Doku/Runbook, Rollback und unabhängige Security-Freigabe wo erforderlich.
- **Harte Stopps:** fehlende produktive Secrets, nicht nachweisbare Tenant- oder Queue-Sicherheit, nicht geprobter Restore vor inkompatibler Migration, kritische A11y-/Datenverlust-Regression.

## Operative Milestones statt bloßer Phasen

**Acht tatsächlich angelegte GitHub-Meilensteine M0–M7** sind unter [GitHub Milestones](https://github.com/derdigitalaffine/behebes-ai/milestones) und in [MILESTONES.md](MILESTONES.md) beschrieben und in [planning/milestones.json](../planning/milestones.json) versioniert. Alle 81 Arbeitspakete haben genau einen Milestone, der erst nach dokumentierten Exit-Gates abgeschlossen werden darf. Due Dates werden nicht ohne Teamkapazität erfunden.

**Neuer wesentlicher Querschnitt:** [KI-Backend-/Provider-Fabric](AI_BACKENDS.md) mit 22 priorisierten Aufgaben K01–K22, sicheren Credentials, mehrteiliger Provider-Kompatibilität, Tenant-Egress-Policies, Modellfähigkeiten, robustem Failover, Queue und Qualitäts-Evaluationen. Die ursprüngliche LLM-Hub-/Legacy-Provider-Migration muss kompatibel bleiben.

## Umsetzungswellen (Gates statt frei erfundener Termine)

| Welle | Vorbedingungen | Endzustand / Exit-Gate |
| --- | --- | --- |
| W0 **Bestand verstehen und absichern** | bestehender Stand + synthetische Testumgebung | `F01–F06`, `S01–S03`, `P01–P02` mit reproduzierbaren Tests; alle Risiken sichtbar |
| W1 **Modulare Contracts** | W0 Sicherheits-/CI-Grundlage | `M01–M04` und erstes risikoarmes Pilotmodul mit Tenant-/Off-/Direct-API-Tests |
| W2 **Mantine Foundations** | F02/F05, D01 ADR | `D01–D05` plus referenzierter Admin-Pilot; keine unbeabsichtigte MUI-/React-Regression |
| W3 **Erste perfekte durchgehende Journey** | M04/D05/F04 | `B01`, `A01–A02`, `O01–O02` integriert in Golden-Path `P06` |
| W4 **Migration vertikal nach Fachwert** | erfolgreiche Pilot-Journey | `D06–D09`, `A03–A06`, `B02–B05`, `O03–O05`; jede Route mit Rollback |
| W5 **Skalierung & Release-Vertrauen** | Metriken und synthetische Last | `R01–R08`, `S04–S06`, `P03–P05` entlang nachgewiesener Engpässe; laufende Pflege ab W0 |

**Wellen sind nicht strikt vollständig sequenziell:** Beobachtbarkeit, Security, UX-Research und fachliche Prototypen beginnen parallel. Kritische Gates blockieren aber die riskante produktive Migration. `P06` ist fortlaufender End-to-End-Beweis, kein einmaliges Abschluss-Screenshot.

## GitHub-Master, Epic- und KI-Tracker

Master: [#3](https://github.com/derdigitalaffine/behebes-ai/issues/3); KI-/Provider-Fabric: [#72](https://github.com/derdigitalaffine/behebes-ai/issues/72); Modulplattform: [#5](https://github.com/derdigitalaffine/behebes-ai/issues/5); Mantine/UX: [#6](https://github.com/derdigitalaffine/behebes-ai/issues/6); Stabilität: [#10](https://github.com/derdigitalaffine/behebes-ai/issues/10). Der [Issue-Index](ISSUE_BACKLOG.md) verlinkt alle 81 Tasks und ihre blockierenden Vorgänger. Im KI-Bereich werden 22 konkrete Tickets ([#73](https://github.com/derdigitalaffine/behebes-ai/issues/73) bis [#94](https://github.com/derdigitalaffine/behebes-ai/issues/94)) abgearbeitet – inklusive kompatibler Legacy-Provider-Migration und sicherem lokalem Inferenzbetrieb.

## Epics und Deliverables

| Epic | Priorität | Geplanter Umfang | Fachliche Wirkung | Erste wesentliche Abhängigkeit |
| --- | --- | --- | --- | --- |
| **E-F** – Produktführung, Qualitätsbaseline und überprüfbare Architektur | P0 | 6 Slices | Die bestehende Plattform entlang echter Bürger-, Sachbearbeitungs-, Leitungs- und OPS-Aufgaben verstehen. Qualitätsstatus und technische Entscheidungen messbar machen. | Ist-Stand |
| **E-M** – Modulplattform, Feature Controls und Entkopplung | P0 | 8 Slices | Aus dem gewachsenen modularen Monolithen eine nachvollziehbare Modularchitektur mit sicherer Aktivierung je Tenant schaffen, ohne laufende Vorgänge zu verlieren. | F03/F06 |
| **E-D** – Mantine Design System und visueller UX-Polish | P1 | 9 Slices | Eine ruhige, professionelle und barrierearme Oberfläche für alle drei Anwendungen etablieren, ohne unkontrollierte Big-Bang-Umschreibung. | D01 und CI |
| **E-B** – Bürgererlebnis: melden, verstehen, verfolgen | P1 | 5 Slices | Ein Anliegen in möglichst wenigen verständlichen Schritten erfassen und mit ehrlichem Status transparent verfolgen. | B01/F01 |
| **E-A** – Admin als task-first Arbeitsraum für Verantwortung und Entscheidungen | P1 | 6 Slices | Für Verwaltungsmitarbeitende die nächste verantwortbare Handlung vor Konfigurations- und Tabellenkomplexität stellen. | A01/D03 |
| **E-O** – OPS: robuste Außendienstarbeit, offline und mobil | P1 | 5 Slices | Feldteams sollen Aufgaben verlässlich auf dem Smartphone ausführen, mit klarer Synchronisierung und sicheren Übergaben. | O02/F04 |
| **E-R** – Messbare Performance, Stabilität und Resilienz | P0 | 8 Slices | Geschwindigkeit und Verfügbarkeit durch Evidenz statt Bauchgefühl verbessern: Datenbank, API, Frontend, Worker und Realtime. | F05 |
| **E-S** – Sicherheit, Datenschutz und KI-Governance | P0 | 6 Slices | Öffentliche Verwaltungssoftware muss datensparsam, mandantensicher und prüfbar bleiben – auch bei modularen Features und KI. | F02 |
| **E-K** – KI-Backend-Plattform: Provider-Fabric, Modellrouting, Qualität, Datenschutz und Betrieb | P0 | 22 Slices | KI als verlässlichen, überprüfbaren und mandantenfähigen Unterstützungsdienst betreiben: Wechsel zwischen lokalen und Cloud-Backends ohne Fachlogik-Rewrite, mit Fähigkeiten pro Modell, transparentem Routing, sicheren Zugangsdaten, gutem Fallback und menschlicher Kontrolle. | K01/F03/S01 |
| **E-P** – Betrieb, Migration, Integration und Release-Exzellenz | P0 | 6 Slices | Wiederherstellbarer, beobachtbarer und wartbarer Self-hosting-Betrieb mit getesteten Upgrade-/Rollbackpfaden. | P01/F04 |

## Architektur- und UX-Entscheidungen

### 1. Modularchitektur
- Sicherer Kern (Auth, Tenant, RBAC, Audit, Wiederherstellbarkeit) immer aktiv.
- Optionen je Plattform/Tenant konfigurierbar; effektiver Zustand berücksichtigt Berechtigungen, Abhängigkeiten, Deployment-Konfiguration und laufende Jobs.
- **Modul „aus“ heißt nicht „Daten löschen“**: Drain/Pause/Read-only je Kontrakt; Direct-API/Jobs/SSE/Push/Deep-Links konsistent.
- [Konkretes Modell](MODULE_PLATFORM.md) und `M01–M08`.

### 2. Mantine und großer UI-Polish
- Kein sofortiger globaler MUI-Replace. Zuerst React-19-/Mantine-Kompatibilitäts-ADR; Mantine 9 erfordert React 19.2+, ggf. Mantine 8 als bewusst begrenzte Brücke.
- Ein Designsystem mit MantineProvider, Tokens, Formular-/Overlay-/Tabellen-/Error-Primitives.
- Admin zuerst an einer repräsentativen Route, dann Tickets, Workflows, Settings. OPS und Bürger separat, aber mit gleicher Designphilosophie.
- UX-Erfolg: Aufgabe schneller, weniger Fehler, kein Kontextverlust, mobil/keyboard/screenreader robust, nicht nur modernere Farben.
- [UI-Migrationsstrategie](MANTINE_MIGRATION.md) und `D01–D09`.

### 3. Stabilität und Performance
- Messen vor Optimieren: DB/API/Queue/SSE/Mobile/Bundles, p50/p95/p99 und Benutzererfolg.
- Queue-/Mail-/KI-Aktionen idempotent und wiederholbar; Double Submit/Timeout/Offline/Parallelbearbeitung explizit behandeln.
- Realistische synthetische Testfälle und Lastszenarien; Slow-4G/320–360px/Low-End-Hardware.
- [SLO-/Performanceplan](PERFORMANCE_SLOS.md) und `R01–R08`.

## Ownership und Ablauf

Ein Task besitzt genau eine federführende Rolle, verpflichtenden unabhängigen Review (kritische Schritte Security-/Architektur-Review), alle betroffenen Verträge und CI-/E2E-Evidenz im PR. Parallelarbeit nur bei geklärten API-/DB-Grenzen. Keine Big-Bang-Änderung an `routes/workflows.ts`, `routes/admin.ts`, `WorkflowSettings.tsx` ohne Regressionstests. Details: [Agentenorchestrierung](AGENT_ORCHESTRATION.md).

## Benötigte nächste Handlungen

1. Auf GitHub im Fork **Settings → General → Features → Issues aktivieren**. Die aktuelle API gibt `410: Issues has been disabled` zurück.
2. [Roadmap-Validator](../scripts/check-roadmap.mjs) laufen lassen und [Issue-Importer](../scripts/import-roadmap-issues.mjs) im Dry-run prüfen; danach im eigenen GitHub-Zugriff mit explizitem `--apply` importieren.
3. Nach Import die angezeigten echten Ticketnummern als Navigationshilfe ergänzen; **keine** bestehenden PRs oder Issues automatisch als erledigt markieren.
4. W0 zuerst fachlich/technisch freigeben, anschließend die kleinsten vertikalen Slices priorisieren.

[Ausführlicher Issue-Backlog](ISSUE_BACKLOG.md) · [Planungsanleitung](../planning/README.md)
