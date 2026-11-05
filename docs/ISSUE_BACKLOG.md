# Verbindlicher Issue-Backlog (als Entwürfe gespeichert)

**Stand:** 05.11.2026. **Single Source of Truth:** [`planning/roadmap-issues.json`](../planning/roadmap-issues.json). Die GitHub-Issues im Fork sind derzeit **deaktiviert**; die folgenden stabilen Schlüssel sind **noch keine Issue-Nummern**.

Jeder Task enthält in der JSON-Datei: geschäftlichen Nutzen, eindeutigen Epic-/Prioritätsbezug, Implementierungsscope, spezifische Akzeptanzkriterien, negativen Testfall, Dependency-Keys und federführenden Bereich. Die Importdatei erzeugt daraus ausführliche, strukturierte Issues mit Sicherheits-/UX-/Rollout-/Qualitätsgate.

## Übersicht

### E-F – Produktführung, Qualitätsbaseline und überprüfbare Architektur (P0; 6 Tasks)

Die bestehende Plattform entlang echter Bürger-, Sachbearbeitungs-, Leitungs- und OPS-Aufgaben verstehen. Qualitätsstatus und technische Entscheidungen messbar machen.

| ID | Prio | Aufgabe | Vorbedingungen |
| --- | --- | --- | --- |
| F01 | P0 | Service Blueprint und reale Nutzerjobs für Bürger, Admin, OPS | – |
| F02 | P0 | Vier-Workspace-CI: Build, Typen, Tests und Sicherheitsminimum | – |
| F03 | P0 | API-/Datenvertrag und Fehlersemantik für drei Clients | F02 |
| F04 | P0 | Reproduzierbare Staging-Testdaten, Szenarien und E2E-Fixtures | F02 |
| F05 | P0 | UX-/Laufzeit-Baseline mit definierten Messmethoden | F04 |
| F06 | P0 | Architektur-ADR: modularer Monolith, Ownership und Migrationsstrategie | F03 |

### E-M – Modulplattform, Feature Controls und Entkopplung (P0; 8 Tasks)

Aus dem gewachsenen modularen Monolithen eine nachvollziehbare Modularchitektur mit sicherer Aktivierung je Tenant schaffen, ohne laufende Vorgänge zu verlieren.

| ID | Prio | Aufgabe | Vorbedingungen |
| --- | --- | --- | --- |
| M01 | P0 | Modulkatalog und fachliche Bounded Contexts festlegen | F06 |
| M02 | P0 | Gemeinsame Typen, API-Clients und Modulkontrakte für alle React-Apps | F03, F06 |
| M03 | P0 | Backend-Modulregistry mit Abhängigkeiten und sicheren Lifecycle-Hooks | M01, M02 |
| M04 | P0 | Tenant-aware Feature Controls: Policy, Konflikte und sichere Defaults | M03 |
| M05 | P1 | Admin-Verwaltungszentrale „Module & Funktionen“ für Plattform und Tenant | M04, D02 |
| M06 | P1 | Client-Modulregistry für Menüs, Routes, Quick Actions und Suche | M04, M02, D02 |
| M07 | P1 | Workflow-/Domänenevents als Module-Schnittstelle mit Outbox-Grundlage | M01, M04, R04 |
| M08 | P1 | Monolithische Hotspots kontrolliert in Fachmodule extrahieren | F03, M01, M02 |

### E-D – Mantine Design System und visueller UX-Polish (P1; 9 Tasks)

Eine ruhige, professionelle und barrierearme Oberfläche für alle drei Anwendungen etablieren, ohne unkontrollierte Big-Bang-Umschreibung.

| ID | Prio | Aufgabe | Vorbedingungen |
| --- | --- | --- | --- |
| D01 | P0 | Mantine-Migrations-ADR mit React-/Ökosystem-Kompatibilitätsmatrix | F02, F05 |
| D02 | P1 | Mantine-Foundation: Theme-Tokens, Komponentenrichtlinien und Barrierefreiheit | D01, F01 |
| D03 | P1 | Neue Mantine AppShell und kontextbezogene Navigation für Admin | D02, M06 |
| D04 | P1 | SmartTable → Mantine-konforme performante Datenraster und Listen | D02, F03, R01 |
| D05 | P1 | Formular-/Dialog-/Fehlerzustandsbibliothek auf Mantine | D02, F03 |
| D06 | P1 | Admin-Mantine-Migration: Tickets, Dashboard, Workflow, Settings als Slices | D03, D04, D05, M08 |
| D07 | P1 | OPS Mantine-AppShell und touch-zentrierte Komponenten | D02, D05, O02 |
| D08 | P1 | Bürgerfrontend-Mantine: freundlich, leicht, mehrsprachig und datensparsam | D02, D05, B01 |
| D09 | P1 | Visuelle Regression, UX-Review und A11y-Gates für Mantine-Rollout | D02, F04 |

### E-B – Bürgererlebnis: melden, verstehen, verfolgen (P1; 5 Tasks)

Ein Anliegen in möglichst wenigen verständlichen Schritten erfassen und mit ehrlichem Status transparent verfolgen.

| ID | Prio | Aufgabe | Vorbedingungen |
| --- | --- | --- | --- |
| B01 | P1 | Bürgermeldung in drei verständlichen Schritten: Anliegen, Ort/Medien, Bestätigen | F01, F03 |
| B02 | P1 | Standort- und Medienerfassung fehlertolerant, datensparsam und mobil | B01, S05 |
| B03 | P1 | Bürgerstatus und Rückfragen als transparente Timeline | F03, A02 |
| B04 | P1 | Mehrsprachigkeit als konsistenter Produktvertrag inkl. Barrierefreiheit | B01, D08 |
| B05 | P2 | Abschluss, Rückmeldung und Servicequalität datenschutzkonform | B03, S03 |

### E-A – Admin als task-first Arbeitsraum für Verantwortung und Entscheidungen (P1; 6 Tasks)

Für Verwaltungsmitarbeitende die nächste verantwortbare Handlung vor Konfigurations- und Tabellenkomplexität stellen.

| ID | Prio | Aufgabe | Vorbedingungen |
| --- | --- | --- | --- |
| A01 | P1 | Task-first Admin-Dashboard: Heute, Jetzt erledigen, Verantwortung | F01, D03, M06 |
| A02 | P1 | Ticketdetail zum entscheidungsorientierten Arbeitsplatz umbauen | A01, D05, F03 |
| A03 | P1 | Workflow-Editor für Verwaltungsteams verständlich und validierbar machen | M08, M04, D05, R04 |
| A04 | P1 | Admin-Einstellungen nach Aufgabe und Verantwortlichkeit reorganisieren | M05, D03 |
| A05 | P1 | Globale Suche und Command Palette mit Mandanten- und Modulkontext | M06, F03, R02 |
| A06 | P2 | Nachvollziehbares Analytics-/Lagebild statt Vanity-Dashboard | A02, R01, S03 |

### E-O – OPS: robuste Außendienstarbeit, offline und mobil (P1; 5 Tasks)

Feldteams sollen Aufgaben verlässlich auf dem Smartphone ausführen, mit klarer Synchronisierung und sicheren Übergaben.

| ID | Prio | Aufgabe | Vorbedingungen |
| --- | --- | --- | --- |
| O01 | P1 | OPS „Meine Einsätze“ als robuste mobile Tagesliste | A02, D07, O02 |
| O02 | P0 | Offline-Queue: Synckonflikte, Idempotenz und Datenlebenszyklus | F03, F04, S01 |
| O03 | P1 | Messenger, Presence und Calls über mobile Netzwechsel stabilisieren | O02, R05 |
| O04 | P1 | OPS-Push, QR-Deep-Links und PWA-Lifecycle robust machen | O02, M06 |
| O05 | P2 | GIS im Feld: Karte, Zuständigkeiten und Navigation alltagstauglich | O01, S05 |

### E-R – Messbare Performance, Stabilität und Resilienz (P0; 8 Tasks)

Geschwindigkeit und Verfügbarkeit durch Evidenz statt Bauchgefühl verbessern: Datenbank, API, Frontend, Worker und Realtime.

| ID | Prio | Aufgabe | Vorbedingungen |
| --- | --- | --- | --- |
| R01 | P0 | Datenbank-Hotspots und Index-Strategie auf realistischer Datenmenge | F04, F05, S01 |
| R02 | P0 | API p95/p99, Ressourcenlimits und Backpressure verbessern | R01, F03 |
| R03 | P1 | Frontends: Route-Splitting, render-sichere Datenabfragen und Bundle-Budgets | F05, D03, M06 |
| R04 | P0 | Persistente Queue-/Workflow-Worker: Retry, Lease, Idempotenz, Dead Letter | F03, F04 |
| R05 | P0 | SSE-/Realtime-Stabilität und Snapshot-Recovery | F03, R04 |
| R06 | P1 | Last-, Soak- und Chaos-Tests für kommunale Kernflows | R02, R04, R05 |
| R07 | P0 | Observability: sichere Metriken, Tracing, strukturierte Logs und SLO-Dashboard | F05, R02 |
| R08 | P1 | Resiliente Fehlermeldungen, Recovery und Degraded Mode end-to-end | F03, D05, R07 |

### E-S – Sicherheit, Datenschutz und KI-Governance (P0; 6 Tasks)

Öffentliche Verwaltungssoftware muss datensparsam, mandantensicher und prüfbar bleiben – auch bei modularen Features und KI.

| ID | Prio | Aufgabe | Vorbedingungen |
| --- | --- | --- | --- |
| S01 | P0 | Tenant-/Org-/Capability-Isolation als testbare Sicherheitsinvariante | F02, F04 |
| S02 | P0 | Produktionssecrets, sichere Compose-Defaults und Proxy-Härtung | F02, P02 |
| S03 | P0 | Datenschutz, Datenflüsse, Aufbewahrung, Auskunft und Löschung | F01, F03 |
| S04 | P0 | KI-Assistenten kontrolliert: Vorschlag, Validierung, Budget und menschlicher Entscheid | M04, R04, S01 |
| S05 | P0 | Dateien, Anhänge, Exporte und Geodaten gegen Missbrauch härten | S01, F03 |
| S06 | P1 | Security-Gates: Dependencies, SBOM, Secret-Scan und unabhängige Reviews | F02, D01 |

### E-P – Betrieb, Migration, Integration und Release-Exzellenz (P0; 6 Tasks)

Wiederherstellbarer, beobachtbarer und wartbarer Self-hosting-Betrieb mit getesteten Upgrade-/Rollbackpfaden.

| ID | Prio | Aufgabe | Vorbedingungen |
| --- | --- | --- | --- |
| P01 | P0 | Backup/Restore-Drill: vollständiger Daten- und Attachment-Wiederanlauf | F04, S02 |
| P02 | P0 | Migrationen und Legacy-Bootstrap auf sichere Upgradepfade bringen | F02, P01 |
| P03 | P1 | Release-Pipeline: reproduzierbare Images, Preflight, gestufter Rollout, Rollback | P01, P02, F02 |
| P04 | P1 | Betriebshandbuch, Supportdiagnose und Incident-Prozess professionalisieren | R07, P01, P03 |
| P05 | P1 | Integrationen als optionale, versionierte Connectoren mit Health und Limits | M03, M04, R04, S02 |
| P06 | P0 | Staging-Golden-Path: Bürger → Admin → OPS → Abschluss inklusive Rollback | F04, R04, M04, B01, A02, O01, P03 |


## Vollständige Akzeptanz und Import

Der Kurzindex dupliziert bewusst **nicht** alle Details, damit Roadmap und Tickets nicht auseinanderlaufen. Vollständige Abnahmekriterien und Fehlerfälle stehen in `planning/roadmap-issues.json`. `node scripts/check-roadmap.mjs` prüft Schlüssel, Bereichszuordnung und Abhängigkeiten. `node scripts/import-roadmap-issues.mjs` zeigt standardmäßig nur eine Vorschau, schreibt erst mit `--apply` und benötigt GitHub-Issues im Fork sowie `GH_TOKEN`/`GITHUB_TOKEN` mit Issues write. Erneute Importe identifizieren vorhandene Ticket-IDs und erzeugen keine Duplikate. Linkaktualisierung erfolgt kontrolliert mit `--update`.

Nach Aktivierung die Arbeitsfortschritte und Verweise auf die tatsächlichen GitHub-Issues tracken. Die Datei ist weiterhin die **ursprüngliche Planungsbasis**, der Status selbst steht in den echten Issues.

[Roadmap](ROADMAP.md) · [Produktvision](PRODUCT_VISION.md) · [Planungsanleitung](../planning/README.md)
