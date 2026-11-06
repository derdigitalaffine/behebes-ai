# Milestone-Programm: Umbau ohne Qualitäts- und Sicherheitsbruch

**Stand:** 06.11.2026 · **Autoritativ für Zuordnung:** [`planning/milestones.json`](../planning/milestones.json). **Autoritativ für Arbeitspaketdetails:** [`planning/roadmap-issues.json`](../planning/roadmap-issues.json). Die Milestone-IDs M0–M7 sind **Qualitäts-/Liefergates, keine Kalendertermine**. Erst nach Kapazitäts- und Risikoabgleich Due Dates setzen.

## Strategie

Ein großer Umbau der UI und Architektur darf den kommunalen Betrieb nicht unterbrechen. Deshalb hat jedes der 81 Umsetzungs-Issues **genau einen** Zielmeilenstein, obwohl fachliche Epics mehrere Meilensteine überspannen. Der Plan hat 10 Epics und 81 Tasks; Master-Issue und Epics bleiben übergreifende Tracker. Alle Task-Abhängigkeiten liegen im **gleichen oder einem früheren** Meilenstein, nicht später.

M0 baut Sicherheit, Tests und Evidenz auf. M1 konsolidiert KI-Providergrundlagen früh, bevor sie in neuen Modulen oder Mantine-Cockpit auftauchen. M2 setzt technische Modul-/KI-Gates um. M3 liefert Designsystem. M4 beweist Bürger→Admin→OPS. M5 führt KI-/Workflow- und Fachkomplexität zusammen. M6 optimiert unter Last. M7 ist Gesamtfreigabe mit UX-/Security-/Support-Qualität.

## Meilensteine und Umfang

| ID | Outcome | Tasks | Wesentliche Exit-Gates |
| --- | --- | ---: | --- |
| [M0](https://github.com/derdigitalaffine/behebes-ai/milestone/1) | **Grundlagen, Produktqualität und Sicherheitsbaseline** | 16 | Vier-Workspace-CI und relevante negative Auth-/Tenant-/Org-Tests mit echtem Laufnachweis; Synthetischer End-to-End-Datenbestand, Messbaseline für Web/API/DB/Queue und UX-/Service-Blueprint |
| [M1](https://github.com/derdigitalaffine/behebes-ai/milestone/2) | **KI-Provider-Fabric und kontrollierter Backendzugang** | 8 | Typisierte Provider-Adapter und verpflichtende Contract-/Fault-Tests für API, Auth, Fehler und Limits; Geprüfte Connection-/Credential-/Endpoint-Richtlinien mit Maskierung, Rotation und Tenant-/Data-Egress-Gates |
| [M2](https://github.com/derdigitalaffine/behebes-ai/milestone/3) | **Modulplattform und deterministisches KI-Routing** | 8 | Core-Module bleiben unveränderlich aktiv; optionale Module und Dependencies sind validiert, auditierbar und sicher an-/abschaltbar; Direkt-API, UI, Deep-Link, SSE, Queue und externe Aktionen respektieren Tenant-/Capability-/Module-Off-Policy |
| [M3](https://github.com/derdigitalaffine/behebes-ai/milestone/4) | **Mantine-Designsystem und Admin-Bedienfundament** | 7 | Mantine-/React-Versionenentscheidung und Provider-/CSS-Koexistenz technisch geprüft; Design-Tokens, Primitive, AppShell, Formular-/Tabellenstandards mit Tests und Referenzscreens |
| [M4](https://github.com/derdigitalaffine/behebes-ai/milestone/5) | **Goldener Bürger–Verwaltung–OPS-Prozess** | 14 | Bürger-Meldung, Standort/Medien, Status, i18n und Admin-Task-Workspace sind durchgängig nutzbar; OPS mit Offline-Queue, Touch, QR/Push, sicheren Konflikten und robustem Wiederanlauf |
| [M5](https://github.com/derdigitalaffine/behebes-ai/milestone/6) | **Fachmodule, Workflows und KI-Exzellenz** | 11 | Workflow-Versionierung, AI-/Mail-Queue-Verhalten und externe Integrationen mit Vertrags-/Regressionstests; KI-Cockpit für Connectors/Models/Routes/Tests mit auditierter, tenant-sicherer Konfiguration |
| [M6](https://github.com/derdigitalaffine/behebes-ai/milestone/7) | **Performance, Telemetrie und Resilienz unter Last** | 10 | Web-Vitals und API-/DB-/Queue-p95/99 mit identischem Stagingprofil vor/nach Optimierung; SSE-Snapshot-/Reconnect-Recovery, KI-Streaming-Abbruch, kontrollierte Backpressure und Dead-Letter-Fälle geprüft |
| [M7](https://github.com/derdigitalaffine/behebes-ai/milestone/8) | **Gesamtpolish, Security-Audit und Release-Freigabe** | 7 | A11y-/Mobile-/Dialog-/Error-/Offline-Polish und verbleibende P1/P2-UX-Slices fachlich abgenommen; Individuelle Berechtigungen, KI-/Provider-/Supply-Chain- und Datenschutz-Security-Reviews abgeschlossen |

## Gates, Verantwortliche und Risiken

### [M0](https://github.com/derdigitalaffine/behebes-ai/milestone/1) · Grundlagen, Produktqualität und Sicherheitsbaseline

**Ziel:** Produktnutzen, Risiken und messbare Ausgangslage erfassen. CI, synthetisches Staging, Tenant-Schutz, Restore/Upgrade und Architekturentscheidungen vor riskanten Umbauten absichern.

**Führung:** Produkt/Architektur, Backend, Security/QA, Operations. **Umfang:** 16 Arbeitspakete (`F01 · F02 · F03 · F04 · F05 · F06 · M02 · D01 · R01 · S01 · S02 · S03 · S05 · P01 · P02 · K01`).

**Abnahme (alle vor Schließung des Milestones nachweisen):**
- [ ] Vier-Workspace-CI und relevante negative Auth-/Tenant-/Org-Tests mit echtem Laufnachweis
- [ ] Synthetischer End-to-End-Datenbestand, Messbaseline für Web/API/DB/Queue und UX-/Service-Blueprint
- [ ] Sichere Betriebs-Defaults und Restore-/Upgrade-Drill auf isolierter Instanz
- [ ] Gemessene, versionierte Verträge und Architektur-/Mantine-/KI-ADRs

**Übergabe:** Blockierende Vorgänger abgeschlossen oder ausdrücklich mit fachlich genehmigter Ausnahme dokumentiert. Keine offene P0-Datenintegritäts-/Tenant-/Privacy-Blockade, kein Einsatz von echten Bürgerdaten zu Tests. Ein Milestone ist nicht durch „alle Issues geschlossen“ automatisch produktiv ausgerollt.

### [M1](https://github.com/derdigitalaffine/behebes-ai/milestone/2) · KI-Provider-Fabric und kontrollierter Backendzugang

**Ziel:** Die bestehenden LLM-/Legacy-Konfigurationen auf vertragliche, sichere und testbare Provider-, Modell- und Datenschutzgrundlagen heben – ohne Fachfunktionen umzuschreiben.

**Führung:** Backend/AI, Architektur, Security/Datenschutz. **Umfang:** 8 Arbeitspakete (`K02 · K03 · K04 · K05 · K07 · K08 · K13 · K16`).

**Abnahme (alle vor Schließung des Milestones nachweisen):**
- [ ] Typisierte Provider-Adapter und verpflichtende Contract-/Fault-Tests für API, Auth, Fehler und Limits
- [ ] Geprüfte Connection-/Credential-/Endpoint-Richtlinien mit Maskierung, Rotation und Tenant-/Data-Egress-Gates
- [ ] Modell-Capabilities nicht allein aus Namensmustern; dokumentierte Probes und manuelle Overrides
- [ ] Qualitäts-Golden-Cases und KI-Datenfluss-/Privacyfreigaben mit menschlichem Review

**Übergabe:** Blockierende Vorgänger abgeschlossen oder ausdrücklich mit fachlich genehmigter Ausnahme dokumentiert. Keine offene P0-Datenintegritäts-/Tenant-/Privacy-Blockade, kein Einsatz von echten Bürgerdaten zu Tests. Ein Milestone ist nicht durch „alle Issues geschlossen“ automatisch produktiv ausgerollt.

### [M2](https://github.com/derdigitalaffine/behebes-ai/milestone/3) · Modulplattform und deterministisches KI-Routing

**Ziel:** Modul-Registry und serverseitiges tenant-sicheres On/Off mit Job-/Event-Gates; KI-Ausführung über nachvollziehbare Task-Policies, Quality Gates und ausfallsichere Queue.

**Führung:** Architektur/Backend/AI, Security/QA. **Umfang:** 8 Arbeitspakete (`M01 · M03 · M04 · R04 · S04 · K06 · K09 · K12`).

**Abnahme (alle vor Schließung des Milestones nachweisen):**
- [ ] Core-Module bleiben unveränderlich aktiv; optionale Module und Dependencies sind validiert, auditierbar und sicher an-/abschaltbar
- [ ] Direkt-API, UI, Deep-Link, SSE, Queue und externe Aktionen respektieren Tenant-/Capability-/Module-Off-Policy
- [ ] Deterministische KI-Routen mit Modellcapabilities, Health-/Budget-/Datenfluss-Gates; manuelle Fallbacks
- [ ] Retry-/Idempotenz-/Outbox- und KI-Outputvalidierung für mindestens einen realistischen vertikalen Slice getestet

**Übergabe:** Blockierende Vorgänger abgeschlossen oder ausdrücklich mit fachlich genehmigter Ausnahme dokumentiert. Keine offene P0-Datenintegritäts-/Tenant-/Privacy-Blockade, kein Einsatz von echten Bürgerdaten zu Tests. Ein Milestone ist nicht durch „alle Issues geschlossen“ automatisch produktiv ausgerollt.

### [M3](https://github.com/derdigitalaffine/behebes-ai/milestone/4) · Mantine-Designsystem und Admin-Bedienfundament

**Ziel:** Ein konsistentes, barrierearmes Mantine-Designsystem, Modulverwaltung, Navigation, Formulare und Tabellen samt UX-Regressionsgates für einen produktiven Referenzslice bereitstellen.

**Führung:** Frontend/UX, Produkt, Security/QA. **Umfang:** 7 Arbeitspakete (`M05 · M06 · D02 · D03 · D04 · D05 · D09`).

**Abnahme (alle vor Schließung des Milestones nachweisen):**
- [ ] Mantine-/React-Versionenentscheidung und Provider-/CSS-Koexistenz technisch geprüft
- [ ] Design-Tokens, Primitive, AppShell, Formular-/Tabellenstandards mit Tests und Referenzscreens
- [ ] Module und Rechte werden korrekt in Navigation, Verwaltungszentrale, Deeplinks abgebildet
- [ ] Mobile 320/360px, Keyboard/Focus, Screenreader und Screenshot-Regression mit künstlichen Daten

**Übergabe:** Blockierende Vorgänger abgeschlossen oder ausdrücklich mit fachlich genehmigter Ausnahme dokumentiert. Keine offene P0-Datenintegritäts-/Tenant-/Privacy-Blockade, kein Einsatz von echten Bürgerdaten zu Tests. Ein Milestone ist nicht durch „alle Issues geschlossen“ automatisch produktiv ausgerollt.

### [M4](https://github.com/derdigitalaffine/behebes-ai/milestone/5) · Goldener Bürger–Verwaltung–OPS-Prozess

**Ziel:** Die Kernphilosophie als Ende-zu-Ende-Produkt nachweisen: Bürger meldet, Admin priorisiert, OPS bearbeitet, Bürger erhält Rückmeldung – auch offline und bei Fehlern.

**Führung:** Produkt, Bürger-Frontend, Admin/OPS, Backend/QA. **Umfang:** 14 Arbeitspakete (`D07 · D08 · B01 · B02 · B03 · B04 · A01 · A02 · A04 · O01 · O02 · O04 · P03 · P06`).

**Abnahme (alle vor Schließung des Milestones nachweisen):**
- [ ] Bürger-Meldung, Standort/Medien, Status, i18n und Admin-Task-Workspace sind durchgängig nutzbar
- [ ] OPS mit Offline-Queue, Touch, QR/Push, sicheren Konflikten und robustem Wiederanlauf
- [ ] Synthetischer Golden-Path für mindestens zwei Tenants und relevante Modul-on/off-Varianten reproduzierbar
- [ ] Staging-Release-/Restore-/Rollback-Smoketest und verständliche Fehlermeldungen

**Übergabe:** Blockierende Vorgänger abgeschlossen oder ausdrücklich mit fachlich genehmigter Ausnahme dokumentiert. Keine offene P0-Datenintegritäts-/Tenant-/Privacy-Blockade, kein Einsatz von echten Bürgerdaten zu Tests. Ein Milestone ist nicht durch „alle Issues geschlossen“ automatisch produktiv ausgerollt.

### [M5](https://github.com/derdigitalaffine/behebes-ai/milestone/6) · Fachmodule, Workflows und KI-Exzellenz

**Ziel:** KI-Modelle wirklich in fachliche Abläufe integrieren und den monolithischen Code kontrolliert nach Modulen und Workflows entflechten; Administration auf Mantine konsolidieren.

**Führung:** Backend/AI, Frontend, Architektur, Security/QA, Ops. **Umfang:** 11 Arbeitspakete (`M07 · M08 · D06 · A03 · P05 · K10 · K14 · K18 · K19 · K20 · K21`).

**Abnahme (alle vor Schließung des Milestones nachweisen):**
- [ ] Workflow-Versionierung, AI-/Mail-Queue-Verhalten und externe Integrationen mit Vertrags-/Regressionstests
- [ ] KI-Cockpit für Connectors/Models/Routes/Tests mit auditierter, tenant-sicherer Konfiguration
- [ ] Multimodalität, lokale und ggf. native Cloud-Backends nur bei geprüften Capabilities und Datenfreigaben
- [ ] KI-Hilfen mit Quellen/Ungewissheit und verpflichtenden menschlichen Aktionen; Legacy-Migration rückschaltbar

**Übergabe:** Blockierende Vorgänger abgeschlossen oder ausdrücklich mit fachlich genehmigter Ausnahme dokumentiert. Keine offene P0-Datenintegritäts-/Tenant-/Privacy-Blockade, kein Einsatz von echten Bürgerdaten zu Tests. Ein Milestone ist nicht durch „alle Issues geschlossen“ automatisch produktiv ausgerollt.

### [M6](https://github.com/derdigitalaffine/behebes-ai/milestone/7) · Performance, Telemetrie und Resilienz unter Last

**Ziel:** Echte Engpässe messen und nachweislich beheben; robuste Realtime-/Streaming- und Queue-Ausführung sowie kostentransparente KI-Nutzung schaffen.

**Führung:** Performance/Backend/AI, Frontend, Ops/QA. **Umfang:** 10 Arbeitspakete (`A05 · R02 · R03 · R05 · R06 · R07 · R08 · K11 · K15 · K22`).

**Abnahme (alle vor Schließung des Milestones nachweisen):**
- [ ] Web-Vitals und API-/DB-/Queue-p95/99 mit identischem Stagingprofil vor/nach Optimierung
- [ ] SSE-Snapshot-/Reconnect-Recovery, KI-Streaming-Abbruch, kontrollierte Backpressure und Dead-Letter-Fälle geprüft
- [ ] AI-Usage/Kosten-/Budget- und Provider-Latenztelemetrie ohne PII; messbare Fehlerbudgets
- [ ] Load-/Soak-/Chaos-/Provider-Contract-Gates für unterschiedliche Backend-Konfigurationen

**Übergabe:** Blockierende Vorgänger abgeschlossen oder ausdrücklich mit fachlich genehmigter Ausnahme dokumentiert. Keine offene P0-Datenintegritäts-/Tenant-/Privacy-Blockade, kein Einsatz von echten Bürgerdaten zu Tests. Ein Milestone ist nicht durch „alle Issues geschlossen“ automatisch produktiv ausgerollt.

### [M7](https://github.com/derdigitalaffine/behebes-ai/milestone/8) · Gesamtpolish, Security-Audit und Release-Freigabe

**Ziel:** Produktqualität über alle Workflows und Rollen konsolidieren, Betrieb/Security härten und echte Go/No-Go-Gates für Rollout und Support nachweisen.

**Führung:** Produkt/UX, QA/Security, Operations, Fachverantwortliche. **Umfang:** 7 Arbeitspakete (`B05 · A06 · O03 · O05 · S06 · P04 · K17`).

**Abnahme (alle vor Schließung des Milestones nachweisen):**
- [ ] A11y-/Mobile-/Dialog-/Error-/Offline-Polish und verbleibende P1/P2-UX-Slices fachlich abgenommen
- [ ] Individuelle Berechtigungen, KI-/Provider-/Supply-Chain- und Datenschutz-Security-Reviews abgeschlossen
- [ ] Runbooks, Support, Restore-/Rollback-Gates und produktive Upgrade-Checks tatsächlich geprobt
- [ ] Offene P0-Blocker klar dokumentiert und menschliches Go/No-Go-Review durchgeführt

**Übergabe:** Blockierende Vorgänger abgeschlossen oder ausdrücklich mit fachlich genehmigter Ausnahme dokumentiert. Keine offene P0-Datenintegritäts-/Tenant-/Privacy-Blockade, kein Einsatz von echten Bürgerdaten zu Tests. Ein Milestone ist nicht durch „alle Issues geschlossen“ automatisch produktiv ausgerollt.


## Native GitHub-Milestones – Status und Fortschritt

**Die acht Meilensteine wurden im Fork tatsächlich erstellt.** Alle 81 Umsetzungstickets sind zugeordnet; die Master-Roadmap und die zehn fachlichen Epics bleiben bewusst meilensteinübergreifend. GitHub bildet den operativen Fortschritt über die jeweilige Milestone-Seite ab. Der Erfüllungsgrad ist noch **kein** Nachweis der Produktivfähigkeit.

[Alle Milestones in GitHub](https://github.com/derdigitalaffine/behebes-ai/milestones) · [Master-Roadmap #3](https://github.com/derdigitalaffine/behebes-ai/issues/3) · [KI-Epic #72](https://github.com/derdigitalaffine/behebes-ai/issues/72)

## Milestones in GitHub synchronisieren

Ein prüfbares, deklaratives Manifest steuert die nativen GitHub-Milestones. [`scripts/check-milestones.mjs`](../scripts/check-milestones.mjs) prüft 1:1-Abdeckung, Duplikate und Abhängigkeitsreihenfolge. [`scripts/sync-roadmap-milestones.mjs`](../scripts/sync-roadmap-milestones.mjs) ist standardmäßig Dry-run und schreibt nur mit `--apply`.

Die eng begrenzte GitHub-Action `roadmap-sync.yml` darf bei Push auf den eigenen Dokumentationsbranch mittels `GITHUB_TOKEN` mit `issues: write` neue fehlende Roadmap-Tickets und native Milestones anlegen und Aufgaben zuordnen. Sie **verändert keine Issues ohne Roadmap-ID-Marker**, löscht keine Milestones, setzt keine Fälligkeitsdaten und ändert keinen fachlichen Implementierungsstatus. Bei fehlender Actions-Berechtigung muss die GitHub-Milestone-Erstellung separat autorisiert werden; Änderungen an Daten oder Deployment werden nicht ausgelöst.

**Definition of Done je Milestone:** Nachvollziehbare Nutzertests, CI-/API-/Browser-/Offline-/Security-Gates und Performance-/SLO-Belege entsprechend Scope. Menschlicher Review und Release-Freigabe bleiben zwingend, ebenso Backups und sichere Rollbacks.

[Gesamte Roadmap](ROADMAP.md) · [KI-Backend-Programm](AI_BACKENDS.md) · [Issue-Backlog](ISSUE_BACKLOG.md)
