# Architektur- und Organisationsentscheidungen (ADR-Register)

**Regel:** Entscheidungen dokumentieren **wann**, **warum**, **Alternativen**, **Konsequenzen**, **Prüfbedarf**. Keine nachträgliche Behauptung formeller Freigabe.

## ADR-0001 – Entwicklungsagenten von Laufzeit-KI trennen

- **Datum:** 2026-11-05
- **Status:** vorgeschlagen im Agenten-/Dokumentationspaket; wirksam erst nach Merge/Freigabe.
- **Kontext:** Produkt enthält bereits LLM-Hub/AI-Queue/Workflows. Gewünscht ist zusätzlich geordnete Multi-Agent-Arbeit an der Codebasis.
- **Entscheidung:** Provider-neutrale `AGENTS.md`-Regeln, `.github/agents/*.agent.md`-Rollen, zentrale Übergabe- und Review-Gates. Keine neue produktive Agentenruntime und kein autonomes Deployment.
- **Alternativen:** unkoordinierte freie Coding-Agenten (verworfen), sofortiges Agenten-Framework mit DB/Queue/Secrets (später erst nach separater Sicherheits- und Kostenentscheidung).
- **Konsequenz:** klare Ownership, aber zunächst manueller Task-Dispatch und menschliche Freigabe.

## ADR-0002 – Dokumentation als ausführbaren Qualitätsvertrag prüfen

- **Datum:** 2026-11-05
- **Status:** vorgeschlagen.
- **Entscheidung:** Index + Markdown-Pflichtseiten + relativer Linkcheck mit Node-Standardbibliothek in einer isolierten GitHub Actions Workflow-Datei. Kein CI-Grün für Produktcode behauptet.
- **Konsequenz:** schnelle statische Doku-Checks; vollständiger Node-/Browser-/DB-Testpfad ist separater Roadmap-Punkt.

## ADR-0003 – Roadmap nach nachweisbaren Gates statt angenommenem Reifegrad

- **Datum:** 2026-11-05
- **Status:** vorgeschlagen.
- **Entscheidung:** P0 Betrieb/Security/Restore/CI vor P1 UX/Fachvertragsausbau und P2 Erweiterungen. Ein Punkt wird erst mit Test-/PR-Evidenz verifiziert.
- **Konsequenz:** ehrliche Statusführung, keine erfundenen Deadlines oder Produktionsfreigaben.

## ADR-0004 – Testbare KI-Provider-Baseline vor Runtime-Migration

- **Datum:** 2026-11-06.
- **Status:** implementierter CI-/Contract-Entwurf im ersten M0-PR; nach unabhängiger Freigabe wirksam.
- **Entscheidung:** alle vier Workspace-Builds und echte Vitest-Tests automatisiert prüfen; zunächst nur einen redigierten, typisierten KI-Fehlervertrag einführen und den bestehenden LLM-Hub unverändert lassen.
- **Kontext und Risiken:** [ADR-0004](ADR-0004-AI-PROVIDER-BASELINE.md).
- **Tickets:** [#14 F02](https://github.com/derdigitalaffine/behebes-ai/issues/14), [#73 K01](https://github.com/derdigitalaffine/behebes-ai/issues/73), vorbereitend [#74 K02](https://github.com/derdigitalaffine/behebes-ai/issues/74).

## ADR-0005 – Isolierter, geprüfter KI-Provideradapter

- **Datum:** 2026-11-06; **Status:** PR #96 zur Architektur- und Security-Review.
- **Entscheidung:** Kontrollierter HTTPS-Chat-Transport mit strikt vorher zugelassenem Endpoint, Modellfähigkeiten, Abbruch/Timeout und redigierten Fehlern. Keine automatische Runtime-Migration.
- **Details:** [ADR-0005](ADR-0005-PROVIDER-ADAPTER.md). **Issues:** [K02 #74](https://github.com/derdigitalaffine/behebes-ai/issues/74), [F02 #14](https://github.com/derdigitalaffine/behebes-ai/issues/14).

## ADR-0006 – Modellfähigkeit mit Nachweis und Verfall statt Namensheuristik

- **Datum:** 2026-11-06; **Status:** K04-PR, Review erforderlich.
- **Entscheidung:** Fähigkeitsprüfung gegen expliziten, vertrauenswürdigen Modellkatalog; stale/unknown-Probes führen vor dem Provideraufruf zu einem kontrollierten Fehler.
- **Details:** [ADR-0006](ADR-0006-MODEL-CAPABILITIES.md), [Issue #76](https://github.com/derdigitalaffine/behebes-ai/issues/76).

## ADR-0007 – Sicherheitsprüfungen für KI-Egress und Credentials

- **Datum:** 2026-11-06; **Status:** isolierte Implementierung, keine produktive Freigabe.
- **Entscheidung:** ausdrückliche Tenant-/Task-/Region-/Datenklassen-Freigabe **vor** Secret-Auflösung und Provideraufruf; statische Endpoint-Prüfung und dokumentierte DNS/IP-Transportgrenze.
- **Details:** [ADR-0007](ADR-0007-AI-EGRESS-GOVERNANCE.md). **Issues:** [K03 #75](https://github.com/derdigitalaffine/behebes-ai/issues/75), [K07 #79](https://github.com/derdigitalaffine/behebes-ai/issues/79), [K16 #88](https://github.com/derdigitalaffine/behebes-ai/issues/88).

## ADR-0008 – DNS-gepinnte KI-Verbindungen statt DNS-Preflight allein

- **Datum:** 2026-11-06; **Status:** implementiert im isolierten Gate, produktive Integration/Review offen.
- **Entscheidung:** Alle DNS-Adressen bewerten, geprüfte IP am HTTPS-Socket pinnen und ursprünglichen Providerhostname für TLS/SNI/Host belassen.
- **Details:** [ADR-0008](ADR-0008-AI-PINNED-EGRESS.md), [K07 #79](https://github.com/derdigitalaffine/behebes-ai/issues/79).

## Neues ADR-Template

```text
ADR-NNNN: Titel
Datum / Status: vorgeschlagen | akzeptiert | ersetzt
Problem und Nutzer-/Betriebswirkung:
Bisheriger Stand und beteiligte Komponenten:
Entscheidung und Alternativen:
Tenant/RBAC/PII/AI/Audit/Offline/Migration:
Kompatibilität, Kosten, Risiken und Rollback:
Test-/Review-Evidenz:
Links auf Issue, PR und ersetzte ADRs:
```
