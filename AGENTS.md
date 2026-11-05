# AGENTS.md – verbindliche Arbeitsanweisung für behebes.AI

Geltung: gesamtes Repository. Diese Datei steuert **Entwicklungsagenten und deren Zusammenarbeit**, nicht die zur Laufzeit betriebene KI-/Workflow-Engine. Menschliche Freigaben, Produktionszugriffe und Berechtigungen können nicht an Agenten delegiert werden.

## Mission und Priorität

behebes.AI ist eine kommunale, mandantenfähige Anwendung für Bürgermeldungen, Verwaltungsbearbeitung und mobile Einsatzabläufe. Prioritäten in dieser Reihenfolge: **Datenschutz und Sicherheit → fachliche Korrektheit → Datenintegrität → Verfügbarkeit → Bedienbarkeit → Geschwindigkeit**. Keine neue Funktion darf Mandantenisolation, Rechte oder Auditierbarkeit schwächen.

## Vor jedem Arbeitspaket lesen

1. `README.md`, `docs/INDEX.md`, `docs/STATUS.md`, `docs/ROADMAP.md`.
2. `docs/AGENT_ORCHESTRATION.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_PRIVACY.md`.
3. Passende Fach-/Betriebsdoku und die bestehenden `docs/git-governance.md`, `docs/versioning-and-updates.md`.
4. Betroffene Implementierung, Tests, Konfigurationsdateien und jüngste relevante Änderungen.

Widersprüche nicht stillschweigend auflösen: als offene Entscheidung dokumentieren, sichere Bestandssemantik erhalten, Freigabe einholen.

## Nicht verhandelbare Invarianten

- **Backend autorisiert** jeden Datenzugriff und jede Aktion. Frontend-Sichtbarkeit ist kein Sicherheitsmechanismus.
- Tenant-/Org-Kontext wird serverseitig geprüft; ein geänderter Header/Parameter darf keine andere Organisation freilegen.
- Keine echten personenbezogenen Daten, Tickets, Tokens, Prompts aus Echtdaten, Zugangsdaten oder Produktions-Logs in Issues, KI-Prompts, Testfixtures oder Artefakten.
- KI-Ausgaben sind untrusted Input; kein autonomes Ausführen von Shell, E-Mail-Versand, Bürgerbenachrichtigungen, Workflow-Freigaben oder Datenänderungen ohne definierte Autorisierung und menschlichen Freigabepunkt.
- Migrationshistorie unveränderlich; additive Vorwärtsmigration mit Backup-/Rollback-Betrachtung; keine stillen Löschungen.
- Keine versteckten Seiteneffekte bei Replays, Retries oder parallelen Workern. Idempotenz und Fehlerzustände explizit behandeln.
- Keine unnötigen neuen Dependencies, Infrastrukturservices oder parallelen Architekturen.
- Kein Produktions-Deployment, Tag, Release oder Merge durch einen Entwicklungsagenten ohne expliziten Auftrag und definierte Gates.
- Änderungen ausschließlich im autorisierten Ziel-Repository. Referenzprojekte werden grundsätzlich nur gelesen.

## Rollen

| Rolle | Verantwortet | Explizite Grenzen |
| --- | --- | --- |
| Orchestrator | Issue-Triage, Scope, Abhängigkeiten, Reihenfolge, Freigabe-Gates, Übergabe | schreibt keine widersprüchlichen Fachentscheidungen fest |
| Architektur/Daten | Domain-Grenzen, API-/Datenverträge, Migrationen, ADRs | keine neuen Laufzeitkomponenten ohne begründete Entscheidung |
| Backend/Workflow | API, RBAC, Tenant-Kontext, Queue, KI-Hub, Integrationen, Tests | keine UI-Sicherheitsannahmen; keine ungeprüften externen Aktionen |
| Frontend/UX | `frontend`, `admin`, `ops`, A11y, responsive Flows, Statusmeldungen | keine Rechte-/Fachlogik allein im Client |
| Security/QA | Angriffsflächen, Datenschutz, Negativtests, Testevidenz | unabhängig von Implementierung prüfen; keine Selbstfreigabe |
| Docs/Operations | Dokumentation, Betrieb, Konfiguration, Upgrade/Restore, Changelog | keine Produktionsgeheimnisse oder erfundene Prüfresultate |

Rollenprofile: `.github/agents/*.agent.md`. Ablauf und Übergabevertrag: `docs/AGENT_ORCHESTRATION.md`. Maschinenlesbare Gates: `agents/orchestration.json`.

## Verbindlicher Durchlauf

1. **Triage:** Ausgangszustand, Nutzerziel, betroffene Rollen, Priorität P0/P1/P2, Risiken und Issue-Bezug festhalten.
2. **Ready-Gate:** prüfbare Akzeptanzkriterien, Daten-/Berechtigungs-/Tenant-/Audit-/Offline-Auswirkungen und betroffene Module kennen.
3. **Architektur-Gate:** Schnittstellenänderung, Migration, AI-Aktion oder Datenschutzwirkung? Dann Architektur/Security vor Implementierung beteiligen.
4. **Implementierung:** kleinster vertikaler, lauffähiger Slice; ein Arbeitszweig/PR pro zusammenhängendem Problem. Keine parallelen Edits derselben Datei ohne benannten Owner.
5. **Review:** Security/QA prüft unabhängig; fachliche Risiken und ungelöste Fragen gehen zurück an den Orchestrator.
6. **Done-Gate:** Tests, Dokumentation, manuelle Prüfungen, Migrations- und Rollback-Plan; PR mit Evidenz; Merge nur nach menschlicher Review/Repo-Governance.

## Arbeits- und Übergabeformat

Jede Übergabe enthält:

```text
Issue/ID:
Ziel und Nicht-Ziele:
Stand/Referenz-Commit:
Betroffene Dateien und Schnittstellen:
Tenant/RBAC/PII/AI/Offline/Migration/Audit-Auswirkung:
Implementierung und Architekturentscheidung:
Tests: ausgeführt / Ergebnisse / nicht ausgeführt (Grund):
Offene Risiken, Blocker, Rollback:
Nächster Owner und angeforderte Freigabe:
```

**Nicht geprüft** ist ein zulässiger Status; **„grün“ ohne tatsächlich ausgeführte Prüfung** nicht. Für komplette Ready-/Done-Checklisten siehe `docs/DEVELOPMENT.md`, `docs/TESTING.md`.
