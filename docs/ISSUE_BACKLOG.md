# Operativer GitHub-Issue-Backlog · behebes.AI Next

**Stand:** 06.11.2026. [Master-Roadmap [#3](https://github.com/derdigitalaffine/behebes-ai/issues/3)](https://github.com/derdigitalaffine/behebes-ai/issues/3) – tatsächlich angelegt, zusammen mit **10 Epics und 81 umsetzbaren Arbeitspaketen**. Die Issue-Nummern sind überprüft; „angelegt“ bedeutet **nicht implementiert**. Planungsquelle: [`planning/roadmap-issues.json`](../planning/roadmap-issues.json), Meilensteine: [`planning/milestones.json`](../planning/milestones.json).

## Überblick der Qualitätsmeilensteine

| Stage | Ziel | Aufgaben | Status |
| --- | --- | ---: | --- |
| M0 | Grundlagen, Produktqualität und Sicherheitsbaseline | 16 | Geplant – nach Testnachweis schließen |
| M1 | KI-Provider-Fabric und kontrollierter Backendzugang | 8 | Geplant – nach Testnachweis schließen |
| M2 | Modulplattform und deterministisches KI-Routing | 8 | Geplant – nach Testnachweis schließen |
| M3 | Mantine-Designsystem und Admin-Bedienfundament | 7 | Geplant – nach Testnachweis schließen |
| M4 | Goldener Bürger–Verwaltung–OPS-Prozess | 14 | Geplant – nach Testnachweis schließen |
| M5 | Fachmodule, Workflows und KI-Exzellenz | 11 | Geplant – nach Testnachweis schließen |
| M6 | Performance, Telemetrie und Resilienz unter Last | 10 | Geplant – nach Testnachweis schließen |
| M7 | Gesamtpolish, Security-Audit und Release-Freigabe | 7 | Geplant – nach Testnachweis schließen |

## Epics und verlinkte Arbeitspakete

### [#4](https://github.com/derdigitalaffine/behebes-ai/issues/4) · Produktführung, Qualitätsbaseline und überprüfbare Architektur (P0)

Die bestehende Plattform entlang echter Bürger-, Sachbearbeitungs-, Leitungs- und OPS-Aufgaben verstehen. Qualitätsstatus und technische Entscheidungen messbar machen.

| Issue | Priority | Milestone | Aufgabe | Blockiert durch |
| --- | --- | --- | --- | --- |
| [#13](https://github.com/derdigitalaffine/behebes-ai/issues/13) (F01) | P0 | M0 | Service Blueprint und reale Nutzerjobs für Bürger, Admin, OPS | – |
| [#14](https://github.com/derdigitalaffine/behebes-ai/issues/14) (F02) | P0 | M0 | Vier-Workspace-CI: Build, Typen, Tests und Sicherheitsminimum | – |
| [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03) | P0 | M0 | API-/Datenvertrag und Fehlersemantik für drei Clients | [#14](https://github.com/derdigitalaffine/behebes-ai/issues/14) (F02) |
| [#16](https://github.com/derdigitalaffine/behebes-ai/issues/16) (F04) | P0 | M0 | Reproduzierbare Staging-Testdaten, Szenarien und E2E-Fixtures | [#14](https://github.com/derdigitalaffine/behebes-ai/issues/14) (F02) |
| [#17](https://github.com/derdigitalaffine/behebes-ai/issues/17) (F05) | P0 | M0 | UX-/Laufzeit-Baseline mit definierten Messmethoden | [#16](https://github.com/derdigitalaffine/behebes-ai/issues/16) (F04) |
| [#19](https://github.com/derdigitalaffine/behebes-ai/issues/19) (F06) | P0 | M0 | Architektur-ADR: modularer Monolith, Ownership und Migrationsstrategie | [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03) |

### [#5](https://github.com/derdigitalaffine/behebes-ai/issues/5) · Modulplattform, Feature Controls und Entkopplung (P0)

Aus dem gewachsenen modularen Monolithen eine nachvollziehbare Modularchitektur mit sicherer Aktivierung je Tenant schaffen, ohne laufende Vorgänge zu verlieren.

| Issue | Priority | Milestone | Aufgabe | Blockiert durch |
| --- | --- | --- | --- | --- |
| [#20](https://github.com/derdigitalaffine/behebes-ai/issues/20) (M01) | P0 | M2 | Modulkatalog und fachliche Bounded Contexts festlegen | [#19](https://github.com/derdigitalaffine/behebes-ai/issues/19) (F06) |
| [#21](https://github.com/derdigitalaffine/behebes-ai/issues/21) (M02) | P0 | M0 | Gemeinsame Typen, API-Clients und Modulkontrakte für alle React-Apps | [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03), [#19](https://github.com/derdigitalaffine/behebes-ai/issues/19) (F06) |
| [#22](https://github.com/derdigitalaffine/behebes-ai/issues/22) (M03) | P0 | M2 | Backend-Modulregistry mit Abhängigkeiten und sicheren Lifecycle-Hooks | [#20](https://github.com/derdigitalaffine/behebes-ai/issues/20) (M01), [#21](https://github.com/derdigitalaffine/behebes-ai/issues/21) (M02) |
| [#23](https://github.com/derdigitalaffine/behebes-ai/issues/23) (M04) | P0 | M2 | Tenant-aware Feature Controls: Policy, Konflikte und sichere Defaults | [#22](https://github.com/derdigitalaffine/behebes-ai/issues/22) (M03) |
| [#46](https://github.com/derdigitalaffine/behebes-ai/issues/46) (M05) | P1 | M3 | Admin-Verwaltungszentrale „Module & Funktionen“ für Plattform und Tenant | [#23](https://github.com/derdigitalaffine/behebes-ai/issues/23) (M04), [#39](https://github.com/derdigitalaffine/behebes-ai/issues/39) (D02) |
| [#47](https://github.com/derdigitalaffine/behebes-ai/issues/47) (M06) | P1 | M3 | Client-Modulregistry für Menüs, Routes, Quick Actions und Suche | [#23](https://github.com/derdigitalaffine/behebes-ai/issues/23) (M04), [#21](https://github.com/derdigitalaffine/behebes-ai/issues/21) (M02), [#39](https://github.com/derdigitalaffine/behebes-ai/issues/39) (D02) |
| [#54](https://github.com/derdigitalaffine/behebes-ai/issues/54) (M07) | P1 | M5 | Workflow-/Domänenevents als Module-Schnittstelle mit Outbox-Grundlage | [#20](https://github.com/derdigitalaffine/behebes-ai/issues/20) (M01), [#23](https://github.com/derdigitalaffine/behebes-ai/issues/23) (M04), [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04) |
| [#55](https://github.com/derdigitalaffine/behebes-ai/issues/55) (M08) | P1 | M5 | Monolithische Hotspots kontrolliert in Fachmodule extrahieren | [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03), [#20](https://github.com/derdigitalaffine/behebes-ai/issues/20) (M01), [#21](https://github.com/derdigitalaffine/behebes-ai/issues/21) (M02) |

### [#6](https://github.com/derdigitalaffine/behebes-ai/issues/6) · Mantine Design System und visueller UX-Polish (P1)

Eine ruhige, professionelle und barrierearme Oberfläche für alle drei Anwendungen etablieren, ohne unkontrollierte Big-Bang-Umschreibung.

| Issue | Priority | Milestone | Aufgabe | Blockiert durch |
| --- | --- | --- | --- | --- |
| [#18](https://github.com/derdigitalaffine/behebes-ai/issues/18) (D01) | P0 | M0 | Mantine-Migrations-ADR mit React-/Ökosystem-Kompatibilitätsmatrix | [#14](https://github.com/derdigitalaffine/behebes-ai/issues/14) (F02), [#17](https://github.com/derdigitalaffine/behebes-ai/issues/17) (F05) |
| [#39](https://github.com/derdigitalaffine/behebes-ai/issues/39) (D02) | P1 | M3 | Mantine-Foundation: Theme-Tokens, Komponentenrichtlinien und Barrierefreiheit | [#18](https://github.com/derdigitalaffine/behebes-ai/issues/18) (D01), [#13](https://github.com/derdigitalaffine/behebes-ai/issues/13) (F01) |
| [#49](https://github.com/derdigitalaffine/behebes-ai/issues/49) (D03) | P1 | M3 | Neue Mantine AppShell und kontextbezogene Navigation für Admin | [#39](https://github.com/derdigitalaffine/behebes-ai/issues/39) (D02), [#47](https://github.com/derdigitalaffine/behebes-ai/issues/47) (M06) |
| [#40](https://github.com/derdigitalaffine/behebes-ai/issues/40) (D04) | P1 | M3 | SmartTable → Mantine-konforme performante Datenraster und Listen | [#39](https://github.com/derdigitalaffine/behebes-ai/issues/39) (D02), [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03), [#28](https://github.com/derdigitalaffine/behebes-ai/issues/28) (R01) |
| [#41](https://github.com/derdigitalaffine/behebes-ai/issues/41) (D05) | P1 | M3 | Formular-/Dialog-/Fehlerzustandsbibliothek auf Mantine | [#39](https://github.com/derdigitalaffine/behebes-ai/issues/39) (D02), [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03) |
| [#57](https://github.com/derdigitalaffine/behebes-ai/issues/57) (D06) | P1 | M5 | Admin-Mantine-Migration: Tickets, Dashboard, Workflow, Settings als Slices | [#49](https://github.com/derdigitalaffine/behebes-ai/issues/49) (D03), [#40](https://github.com/derdigitalaffine/behebes-ai/issues/40) (D04), [#41](https://github.com/derdigitalaffine/behebes-ai/issues/41) (D05), [#55](https://github.com/derdigitalaffine/behebes-ai/issues/55) (M08) |
| [#42](https://github.com/derdigitalaffine/behebes-ai/issues/42) (D07) | P1 | M4 | OPS Mantine-AppShell und touch-zentrierte Komponenten | [#39](https://github.com/derdigitalaffine/behebes-ai/issues/39) (D02), [#41](https://github.com/derdigitalaffine/behebes-ai/issues/41) (D05), [#27](https://github.com/derdigitalaffine/behebes-ai/issues/27) (O02) |
| [#43](https://github.com/derdigitalaffine/behebes-ai/issues/43) (D08) | P1 | M4 | Bürgerfrontend-Mantine: freundlich, leicht, mehrsprachig und datensparsam | [#39](https://github.com/derdigitalaffine/behebes-ai/issues/39) (D02), [#41](https://github.com/derdigitalaffine/behebes-ai/issues/41) (D05), [#37](https://github.com/derdigitalaffine/behebes-ai/issues/37) (B01) |
| [#45](https://github.com/derdigitalaffine/behebes-ai/issues/45) (D09) | P1 | M3 | Visuelle Regression, UX-Review und A11y-Gates für Mantine-Rollout | [#39](https://github.com/derdigitalaffine/behebes-ai/issues/39) (D02), [#16](https://github.com/derdigitalaffine/behebes-ai/issues/16) (F04) |

### [#7](https://github.com/derdigitalaffine/behebes-ai/issues/7) · Bürgererlebnis: melden, verstehen, verfolgen (P1)

Ein Anliegen in möglichst wenigen verständlichen Schritten erfassen und mit ehrlichem Status transparent verfolgen.

| Issue | Priority | Milestone | Aufgabe | Blockiert durch |
| --- | --- | --- | --- | --- |
| [#37](https://github.com/derdigitalaffine/behebes-ai/issues/37) (B01) | P1 | M4 | Bürgermeldung in drei verständlichen Schritten: Anliegen, Ort/Medien, Bestätigen | [#13](https://github.com/derdigitalaffine/behebes-ai/issues/13) (F01), [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03) |
| [#38](https://github.com/derdigitalaffine/behebes-ai/issues/38) (B02) | P1 | M4 | Standort- und Medienerfassung fehlertolerant, datensparsam und mobil | [#37](https://github.com/derdigitalaffine/behebes-ai/issues/37) (B01), [#36](https://github.com/derdigitalaffine/behebes-ai/issues/36) (S05) |
| [#53](https://github.com/derdigitalaffine/behebes-ai/issues/53) (B03) | P1 | M4 | Bürgerstatus und Rückfragen als transparente Timeline | [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03), [#51](https://github.com/derdigitalaffine/behebes-ai/issues/51) (A02) |
| [#44](https://github.com/derdigitalaffine/behebes-ai/issues/44) (B04) | P1 | M4 | Mehrsprachigkeit als konsistenter Produktvertrag inkl. Barrierefreiheit | [#37](https://github.com/derdigitalaffine/behebes-ai/issues/37) (B01), [#43](https://github.com/derdigitalaffine/behebes-ai/issues/43) (D08) |
| [#70](https://github.com/derdigitalaffine/behebes-ai/issues/70) (B05) | P2 | M7 | Abschluss, Rückmeldung und Servicequalität datenschutzkonform | [#53](https://github.com/derdigitalaffine/behebes-ai/issues/53) (B03), [#34](https://github.com/derdigitalaffine/behebes-ai/issues/34) (S03) |

### [#8](https://github.com/derdigitalaffine/behebes-ai/issues/8) · Admin als task-first Arbeitsraum für Verantwortung und Entscheidungen (P1)

Für Verwaltungsmitarbeitende die nächste verantwortbare Handlung vor Konfigurations- und Tabellenkomplexität stellen.

| Issue | Priority | Milestone | Aufgabe | Blockiert durch |
| --- | --- | --- | --- | --- |
| [#50](https://github.com/derdigitalaffine/behebes-ai/issues/50) (A01) | P1 | M4 | Task-first Admin-Dashboard: Heute, Jetzt erledigen, Verantwortung | [#13](https://github.com/derdigitalaffine/behebes-ai/issues/13) (F01), [#49](https://github.com/derdigitalaffine/behebes-ai/issues/49) (D03), [#47](https://github.com/derdigitalaffine/behebes-ai/issues/47) (M06) |
| [#51](https://github.com/derdigitalaffine/behebes-ai/issues/51) (A02) | P1 | M4 | Ticketdetail zum entscheidungsorientierten Arbeitsplatz umbauen | [#50](https://github.com/derdigitalaffine/behebes-ai/issues/50) (A01), [#41](https://github.com/derdigitalaffine/behebes-ai/issues/41) (D05), [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03) |
| [#56](https://github.com/derdigitalaffine/behebes-ai/issues/56) (A03) | P1 | M5 | Workflow-Editor für Verwaltungsteams verständlich und validierbar machen | [#55](https://github.com/derdigitalaffine/behebes-ai/issues/55) (M08), [#23](https://github.com/derdigitalaffine/behebes-ai/issues/23) (M04), [#41](https://github.com/derdigitalaffine/behebes-ai/issues/41) (D05), [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04) |
| [#52](https://github.com/derdigitalaffine/behebes-ai/issues/52) (A04) | P1 | M4 | Admin-Einstellungen nach Aufgabe und Verantwortlichkeit reorganisieren | [#46](https://github.com/derdigitalaffine/behebes-ai/issues/46) (M05), [#49](https://github.com/derdigitalaffine/behebes-ai/issues/49) (D03) |
| [#48](https://github.com/derdigitalaffine/behebes-ai/issues/48) (A05) | P1 | M6 | Globale Suche und Command Palette mit Mandanten- und Modulkontext | [#47](https://github.com/derdigitalaffine/behebes-ai/issues/47) (M06), [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03), [#29](https://github.com/derdigitalaffine/behebes-ai/issues/29) (R02) |
| [#69](https://github.com/derdigitalaffine/behebes-ai/issues/69) (A06) | P2 | M7 | Nachvollziehbares Analytics-/Lagebild statt Vanity-Dashboard | [#51](https://github.com/derdigitalaffine/behebes-ai/issues/51) (A02), [#28](https://github.com/derdigitalaffine/behebes-ai/issues/28) (R01), [#34](https://github.com/derdigitalaffine/behebes-ai/issues/34) (S03) |

### [#9](https://github.com/derdigitalaffine/behebes-ai/issues/9) · OPS: robuste Außendienstarbeit, offline und mobil (P1)

Feldteams sollen Aufgaben verlässlich auf dem Smartphone ausführen, mit klarer Synchronisierung und sicheren Übergaben.

| Issue | Priority | Milestone | Aufgabe | Blockiert durch |
| --- | --- | --- | --- | --- |
| [#58](https://github.com/derdigitalaffine/behebes-ai/issues/58) (O01) | P1 | M4 | OPS „Meine Einsätze“ als robuste mobile Tagesliste | [#51](https://github.com/derdigitalaffine/behebes-ai/issues/51) (A02), [#42](https://github.com/derdigitalaffine/behebes-ai/issues/42) (D07), [#27](https://github.com/derdigitalaffine/behebes-ai/issues/27) (O02) |
| [#27](https://github.com/derdigitalaffine/behebes-ai/issues/27) (O02) | P0 | M4 | Offline-Queue: Synckonflikte, Idempotenz und Datenlebenszyklus | [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03), [#16](https://github.com/derdigitalaffine/behebes-ai/issues/16) (F04), [#26](https://github.com/derdigitalaffine/behebes-ai/issues/26) (S01) |
| [#59](https://github.com/derdigitalaffine/behebes-ai/issues/59) (O03) | P1 | M7 | Messenger, Presence und Calls über mobile Netzwechsel stabilisieren | [#27](https://github.com/derdigitalaffine/behebes-ai/issues/27) (O02), [#25](https://github.com/derdigitalaffine/behebes-ai/issues/25) (R05) |
| [#60](https://github.com/derdigitalaffine/behebes-ai/issues/60) (O04) | P1 | M4 | OPS-Push, QR-Deep-Links und PWA-Lifecycle robust machen | [#27](https://github.com/derdigitalaffine/behebes-ai/issues/27) (O02), [#47](https://github.com/derdigitalaffine/behebes-ai/issues/47) (M06) |
| [#71](https://github.com/derdigitalaffine/behebes-ai/issues/71) (O05) | P2 | M7 | GIS im Feld: Karte, Zuständigkeiten und Navigation alltagstauglich | [#58](https://github.com/derdigitalaffine/behebes-ai/issues/58) (O01), [#36](https://github.com/derdigitalaffine/behebes-ai/issues/36) (S05) |

### [#10](https://github.com/derdigitalaffine/behebes-ai/issues/10) · Messbare Performance, Stabilität und Resilienz (P0)

Geschwindigkeit und Verfügbarkeit durch Evidenz statt Bauchgefühl verbessern: Datenbank, API, Frontend, Worker und Realtime.

| Issue | Priority | Milestone | Aufgabe | Blockiert durch |
| --- | --- | --- | --- | --- |
| [#28](https://github.com/derdigitalaffine/behebes-ai/issues/28) (R01) | P0 | M0 | Datenbank-Hotspots und Index-Strategie auf realistischer Datenmenge | [#16](https://github.com/derdigitalaffine/behebes-ai/issues/16) (F04), [#17](https://github.com/derdigitalaffine/behebes-ai/issues/17) (F05), [#26](https://github.com/derdigitalaffine/behebes-ai/issues/26) (S01) |
| [#29](https://github.com/derdigitalaffine/behebes-ai/issues/29) (R02) | P0 | M6 | API p95/p99, Ressourcenlimits und Backpressure verbessern | [#28](https://github.com/derdigitalaffine/behebes-ai/issues/28) (R01), [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03) |
| [#65](https://github.com/derdigitalaffine/behebes-ai/issues/65) (R03) | P1 | M6 | Frontends: Route-Splitting, render-sichere Datenabfragen und Bundle-Budgets | [#17](https://github.com/derdigitalaffine/behebes-ai/issues/17) (F05), [#49](https://github.com/derdigitalaffine/behebes-ai/issues/49) (D03), [#47](https://github.com/derdigitalaffine/behebes-ai/issues/47) (M06) |
| [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04) | P0 | M2 | Persistente Queue-/Workflow-Worker: Retry, Lease, Idempotenz, Dead Letter | [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03), [#16](https://github.com/derdigitalaffine/behebes-ai/issues/16) (F04) |
| [#25](https://github.com/derdigitalaffine/behebes-ai/issues/25) (R05) | P0 | M6 | SSE-/Realtime-Stabilität und Snapshot-Recovery | [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03), [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04) |
| [#66](https://github.com/derdigitalaffine/behebes-ai/issues/66) (R06) | P1 | M6 | Last-, Soak- und Chaos-Tests für kommunale Kernflows | [#29](https://github.com/derdigitalaffine/behebes-ai/issues/29) (R02), [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04), [#25](https://github.com/derdigitalaffine/behebes-ai/issues/25) (R05) |
| [#30](https://github.com/derdigitalaffine/behebes-ai/issues/30) (R07) | P0 | M6 | Observability: sichere Metriken, Tracing, strukturierte Logs und SLO-Dashboard | [#17](https://github.com/derdigitalaffine/behebes-ai/issues/17) (F05), [#29](https://github.com/derdigitalaffine/behebes-ai/issues/29) (R02) |
| [#67](https://github.com/derdigitalaffine/behebes-ai/issues/67) (R08) | P1 | M6 | Resiliente Fehlermeldungen, Recovery und Degraded Mode end-to-end | [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03), [#41](https://github.com/derdigitalaffine/behebes-ai/issues/41) (D05), [#30](https://github.com/derdigitalaffine/behebes-ai/issues/30) (R07) |

### [#11](https://github.com/derdigitalaffine/behebes-ai/issues/11) · Sicherheit, Datenschutz und KI-Governance (P0)

Öffentliche Verwaltungssoftware muss datensparsam, mandantensicher und prüfbar bleiben – auch bei modularen Features und KI.

| Issue | Priority | Milestone | Aufgabe | Blockiert durch |
| --- | --- | --- | --- | --- |
| [#26](https://github.com/derdigitalaffine/behebes-ai/issues/26) (S01) | P0 | M0 | Tenant-/Org-/Capability-Isolation als testbare Sicherheitsinvariante | [#14](https://github.com/derdigitalaffine/behebes-ai/issues/14) (F02), [#16](https://github.com/derdigitalaffine/behebes-ai/issues/16) (F04) |
| [#31](https://github.com/derdigitalaffine/behebes-ai/issues/31) (S02) | P0 | M0 | Produktionssecrets, sichere Compose-Defaults und Proxy-Härtung | [#14](https://github.com/derdigitalaffine/behebes-ai/issues/14) (F02) |
| [#34](https://github.com/derdigitalaffine/behebes-ai/issues/34) (S03) | P0 | M0 | Datenschutz, Datenflüsse, Aufbewahrung, Auskunft und Löschung | [#13](https://github.com/derdigitalaffine/behebes-ai/issues/13) (F01), [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03) |
| [#35](https://github.com/derdigitalaffine/behebes-ai/issues/35) (S04) | P0 | M2 | KI-Assistenten kontrolliert: Vorschlag, Validierung, Budget und menschlicher Entscheid | [#23](https://github.com/derdigitalaffine/behebes-ai/issues/23) (M04), [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04), [#26](https://github.com/derdigitalaffine/behebes-ai/issues/26) (S01) |
| [#36](https://github.com/derdigitalaffine/behebes-ai/issues/36) (S05) | P0 | M0 | Dateien, Anhänge, Exporte und Geodaten gegen Missbrauch härten | [#26](https://github.com/derdigitalaffine/behebes-ai/issues/26) (S01), [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03) |
| [#68](https://github.com/derdigitalaffine/behebes-ai/issues/68) (S06) | P1 | M7 | Security-Gates: Dependencies, SBOM, Secret-Scan und unabhängige Reviews | [#14](https://github.com/derdigitalaffine/behebes-ai/issues/14) (F02), [#18](https://github.com/derdigitalaffine/behebes-ai/issues/18) (D01) |

### [#12](https://github.com/derdigitalaffine/behebes-ai/issues/12) · Betrieb, Migration, Integration und Release-Exzellenz (P0)

Wiederherstellbarer, beobachtbarer und wartbarer Self-hosting-Betrieb mit getesteten Upgrade-/Rollbackpfaden.

| Issue | Priority | Milestone | Aufgabe | Blockiert durch |
| --- | --- | --- | --- | --- |
| [#32](https://github.com/derdigitalaffine/behebes-ai/issues/32) (P01) | P0 | M0 | Backup/Restore-Drill: vollständiger Daten- und Attachment-Wiederanlauf | [#16](https://github.com/derdigitalaffine/behebes-ai/issues/16) (F04), [#31](https://github.com/derdigitalaffine/behebes-ai/issues/31) (S02) |
| [#33](https://github.com/derdigitalaffine/behebes-ai/issues/33) (P02) | P0 | M0 | Migrationen und Legacy-Bootstrap auf sichere Upgradepfade bringen | [#14](https://github.com/derdigitalaffine/behebes-ai/issues/14) (F02), [#32](https://github.com/derdigitalaffine/behebes-ai/issues/32) (P01) |
| [#61](https://github.com/derdigitalaffine/behebes-ai/issues/61) (P03) | P1 | M4 | Release-Pipeline: reproduzierbare Images, Preflight, gestufter Rollout, Rollback | [#32](https://github.com/derdigitalaffine/behebes-ai/issues/32) (P01), [#33](https://github.com/derdigitalaffine/behebes-ai/issues/33) (P02), [#14](https://github.com/derdigitalaffine/behebes-ai/issues/14) (F02) |
| [#63](https://github.com/derdigitalaffine/behebes-ai/issues/63) (P04) | P1 | M7 | Betriebshandbuch, Supportdiagnose und Incident-Prozess professionalisieren | [#30](https://github.com/derdigitalaffine/behebes-ai/issues/30) (R07), [#32](https://github.com/derdigitalaffine/behebes-ai/issues/32) (P01), [#61](https://github.com/derdigitalaffine/behebes-ai/issues/61) (P03) |
| [#64](https://github.com/derdigitalaffine/behebes-ai/issues/64) (P05) | P1 | M5 | Integrationen als optionale, versionierte Connectoren mit Health und Limits | [#22](https://github.com/derdigitalaffine/behebes-ai/issues/22) (M03), [#23](https://github.com/derdigitalaffine/behebes-ai/issues/23) (M04), [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04), [#31](https://github.com/derdigitalaffine/behebes-ai/issues/31) (S02) |
| [#62](https://github.com/derdigitalaffine/behebes-ai/issues/62) (P06) | P0 | M4 | Staging-Golden-Path: Bürger → Admin → OPS → Abschluss inklusive Rollback | [#16](https://github.com/derdigitalaffine/behebes-ai/issues/16) (F04), [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04), [#23](https://github.com/derdigitalaffine/behebes-ai/issues/23) (M04), [#37](https://github.com/derdigitalaffine/behebes-ai/issues/37) (B01), [#51](https://github.com/derdigitalaffine/behebes-ai/issues/51) (A02), [#58](https://github.com/derdigitalaffine/behebes-ai/issues/58) (O01), [#61](https://github.com/derdigitalaffine/behebes-ai/issues/61) (P03) |

### [#72](https://github.com/derdigitalaffine/behebes-ai/issues/72) · KI-Backend-Plattform: Provider-Fabric, Modellrouting, Qualität, Datenschutz und Betrieb (P0)

KI als verlässlichen, überprüfbaren und mandantenfähigen Unterstützungsdienst betreiben: Wechsel zwischen lokalen und Cloud-Backends ohne Fachlogik-Rewrite, mit Fähigkeiten pro Modell, transparentem Routing, sicheren Zugangsdaten, gutem Fallback und menschlicher Kontrolle.

| Issue | Priority | Milestone | Aufgabe | Blockiert durch |
| --- | --- | --- | --- | --- |
| [#73](https://github.com/derdigitalaffine/behebes-ai/issues/73) (K01) | P0 | M0 | Ist-Aufnahme, Zielarchitektur und LLM-Backend-Migrations-ADR | [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03), [#26](https://github.com/derdigitalaffine/behebes-ai/issues/26) (S01) |
| [#74](https://github.com/derdigitalaffine/behebes-ai/issues/74) (K02) | P0 | M1 | Typisierte Provider-Adapter mit einheitlichem Request-/Response-Vertrag | [#73](https://github.com/derdigitalaffine/behebes-ai/issues/73) (K01), [#21](https://github.com/derdigitalaffine/behebes-ai/issues/21) (M02) |
| [#75](https://github.com/derdigitalaffine/behebes-ai/issues/75) (K03) | P0 | M1 | KI-Connection-Verwaltung mit sicherem Credential-Lifecycle und Tenant-Scope | [#73](https://github.com/derdigitalaffine/behebes-ai/issues/73) (K01), [#31](https://github.com/derdigitalaffine/behebes-ai/issues/31) (S02) |
| [#76](https://github.com/derdigitalaffine/behebes-ai/issues/76) (K04) | P0 | M1 | Modellkatalog und verifizierbare Capability-Matrix statt Namensheuristik | [#74](https://github.com/derdigitalaffine/behebes-ai/issues/74) (K02) |
| [#77](https://github.com/derdigitalaffine/behebes-ai/issues/77) (K05) | P0 | M1 | Provider-Probes, Health, Timeouts, Retries und Circuit Breaker | [#74](https://github.com/derdigitalaffine/behebes-ai/issues/74) (K02) |
| [#78](https://github.com/derdigitalaffine/behebes-ai/issues/78) (K06) | P0 | M2 | Deterministisches Task-Routing mit Fallback-Pools, Prioritäten und Governance | [#76](https://github.com/derdigitalaffine/behebes-ai/issues/76) (K04), [#77](https://github.com/derdigitalaffine/behebes-ai/issues/77) (K05), [#23](https://github.com/derdigitalaffine/behebes-ai/issues/23) (M04), [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04) |
| [#79](https://github.com/derdigitalaffine/behebes-ai/issues/79) (K07) | P0 | M1 | Sichere KI-Endpunktkonfiguration und kontrollierter Netzwerkzugang | [#74](https://github.com/derdigitalaffine/behebes-ai/issues/74) (K02), [#31](https://github.com/derdigitalaffine/behebes-ai/issues/31) (S02) |
| [#80](https://github.com/derdigitalaffine/behebes-ai/issues/80) (K08) | P0 | M1 | Fachliche Prompt-/Task-Verträge mit strukturierten Versionen | [#74](https://github.com/derdigitalaffine/behebes-ai/issues/74) (K02), [#15](https://github.com/derdigitalaffine/behebes-ai/issues/15) (F03) |
| [#81](https://github.com/derdigitalaffine/behebes-ai/issues/81) (K09) | P1 | M2 | Validierte KI-Ausgaben, Confidence/Provenance und kontrollierte Reparatur | [#80](https://github.com/derdigitalaffine/behebes-ai/issues/80) (K08), [#35](https://github.com/derdigitalaffine/behebes-ai/issues/35) (S04) |
| [#82](https://github.com/derdigitalaffine/behebes-ai/issues/82) (K10) | P1 | M5 | Multimodale KI-Backends für Bilder und Dokumente mit Datenschutz-Gates | [#76](https://github.com/derdigitalaffine/behebes-ai/issues/76) (K04), [#81](https://github.com/derdigitalaffine/behebes-ai/issues/81) (K09), [#36](https://github.com/derdigitalaffine/behebes-ai/issues/36) (S05) |
| [#83](https://github.com/derdigitalaffine/behebes-ai/issues/83) (K11) | P1 | M6 | Streaming-Antworten mit Abbruch, Limits und verständlicher Admin-UX | [#74](https://github.com/derdigitalaffine/behebes-ai/issues/74) (K02), [#29](https://github.com/derdigitalaffine/behebes-ai/issues/29) (R02) |
| [#84](https://github.com/derdigitalaffine/behebes-ai/issues/84) (K12) | P1 | M2 | KI-Queue: idempotente Ausführung und sichere Provider-Failover-Semantik | [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04), [#78](https://github.com/derdigitalaffine/behebes-ai/issues/78) (K06) |
| [#85](https://github.com/derdigitalaffine/behebes-ai/issues/85) (K13) | P0 | M1 | KI-Qualitäts-Evaluationsframework mit synthetischen Golden Cases | [#80](https://github.com/derdigitalaffine/behebes-ai/issues/80) (K08), [#16](https://github.com/derdigitalaffine/behebes-ai/issues/16) (F04) |
| [#86](https://github.com/derdigitalaffine/behebes-ai/issues/86) (K14) | P1 | M5 | Mantine-KI-Cockpit: Verbindungen, Modelle, Routing, Test und Diagnose | [#39](https://github.com/derdigitalaffine/behebes-ai/issues/39) (D02), [#46](https://github.com/derdigitalaffine/behebes-ai/issues/46) (M05), [#76](https://github.com/derdigitalaffine/behebes-ai/issues/76) (K04), [#78](https://github.com/derdigitalaffine/behebes-ai/issues/78) (K06) |
| [#87](https://github.com/derdigitalaffine/behebes-ai/issues/87) (K15) | P1 | M6 | KI-Nutzung, Tokenkosten, Budgets und datensparsames Monitoring | [#78](https://github.com/derdigitalaffine/behebes-ai/issues/78) (K06), [#30](https://github.com/derdigitalaffine/behebes-ai/issues/30) (R07) |
| [#88](https://github.com/derdigitalaffine/behebes-ai/issues/88) (K16) | P0 | M1 | KI-Datenschutz- und Egress-Governance je Task und Mandant | [#75](https://github.com/derdigitalaffine/behebes-ai/issues/75) (K03), [#34](https://github.com/derdigitalaffine/behebes-ai/issues/34) (S03) |
| [#89](https://github.com/derdigitalaffine/behebes-ai/issues/89) (K17) | P2 | M7 | Tenant-sichere Wissenskontexte und RAG für Assistenz | [#88](https://github.com/derdigitalaffine/behebes-ai/issues/88) (K16), [#81](https://github.com/derdigitalaffine/behebes-ai/issues/81) (K09), [#26](https://github.com/derdigitalaffine/behebes-ai/issues/26) (S01) |
| [#90](https://github.com/derdigitalaffine/behebes-ai/issues/90) (K18) | P1 | M5 | Kompatible Legacy-Integration und risikofreier Parallelbetrieb | [#74](https://github.com/derdigitalaffine/behebes-ai/issues/74) (K02), [#78](https://github.com/derdigitalaffine/behebes-ai/issues/78) (K06), [#85](https://github.com/derdigitalaffine/behebes-ai/issues/85) (K13), [#33](https://github.com/derdigitalaffine/behebes-ai/issues/33) (P02) |
| [#91](https://github.com/derdigitalaffine/behebes-ai/issues/91) (K19) | P1 | M5 | On-Prem-KI-Backends: Ollama, vLLM, LM Studio kontrolliert integrieren | [#74](https://github.com/derdigitalaffine/behebes-ai/issues/74) (K02), [#76](https://github.com/derdigitalaffine/behebes-ai/issues/76) (K04), [#79](https://github.com/derdigitalaffine/behebes-ai/issues/79) (K07), [#77](https://github.com/derdigitalaffine/behebes-ai/issues/77) (K05) |
| [#92](https://github.com/derdigitalaffine/behebes-ai/issues/92) (K20) | P1 | M5 | KI-gestützte Facharbeit: Provenance, Human-in-the-loop und Vieraugenfreigabe | [#81](https://github.com/derdigitalaffine/behebes-ai/issues/81) (K09), [#35](https://github.com/derdigitalaffine/behebes-ai/issues/35) (S04), [#51](https://github.com/derdigitalaffine/behebes-ai/issues/51) (A02) |
| [#93](https://github.com/derdigitalaffine/behebes-ai/issues/93) (K21) | P1 | M5 | Herstellerspezifische Adapter und Azure-/Native-API-Support | [#74](https://github.com/derdigitalaffine/behebes-ai/issues/74) (K02), [#76](https://github.com/derdigitalaffine/behebes-ai/issues/76) (K04), [#79](https://github.com/derdigitalaffine/behebes-ai/issues/79) (K07) |
| [#94](https://github.com/derdigitalaffine/behebes-ai/issues/94) (K22) | P1 | M6 | Provider-Contract-, Chaos- und Qualitätsregressionen als Release-Gate | [#85](https://github.com/derdigitalaffine/behebes-ai/issues/85) (K13), [#91](https://github.com/derdigitalaffine/behebes-ai/issues/91) (K19), [#93](https://github.com/derdigitalaffine/behebes-ai/issues/93) (K21), [#24](https://github.com/derdigitalaffine/behebes-ai/issues/24) (R04) |


## Definition of Ready und Done

Jedes Ticket beschreibt Nutzerziel, konkrete Umsetzungsgrenzen, messbare Akzeptanz, mindestens einen Negativ-/Fehlerfall und technische Vorbedingungen. Zu schließen nur nach tatsächlichem Test-/PR-Nachweis, Tenant-/Org-/RBAC-Gate, Mobile-/Tastaturprüfung bei UI-Arbeit, Performancevergleich bei Optimierung und dokumentiertem Rollback. **P0 ist Risikokategorie, kein Beleg eines aktuellen Sicherheitsvorfalls.**

**Hinweis zur Steuerung:** GitHub Issues sind der operative Fortschrittsstand. Die JSON-Dateien sind versionierte Planung/Abhängigkeiten, nicht anstelle von PR-/QA-Nachweisen. [KI-Architektur](AI_BACKENDS.md), [Produktvision](PRODUCT_VISION.md), [Milestone-Gates](MILESTONES.md), [Entwicklungsprozess](DEVELOPMENT.md).
