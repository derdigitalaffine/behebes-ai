# Projektstand / Status-Snapshot

**Stichtag:** 05.11.2026  · **Referenz:** `main` @ `12ae45fa697a63a4f005b8b1478e53f21f9bb333` · **Methode:** Repository-Inventur + GitHub Issues/PRs/Releases. Nicht live gegen eine Installation getestet.

## Kurzfazit

behebes.AI besitzt eine umfangreiche vertikal integrierte Codebasis und einen veröffentlichten Release `v1.0.7` vom **01.03.2026**. Die Doku und Release-Historie bilden den März-Stand ab; der untersuchte Branch enthält weder eine zentrale Roadmap noch repositoryweite Agentenanweisungen oder ein CI-Workflow-Verzeichnis. Es gibt zu diesem Snapshot keine eigenständigen GitHub-Issues, lediglich den geschlossenen Release-PR #1. **Daraus folgt nicht, dass keine Probleme existieren.**

## Verifiziert am Codebestand

| Bereich | Nachweis | Evidenzstatus |
| --- | --- | --- |
| Bürger-, Admin-, OPS-Frontend | `frontend/`, `admin/`, `ops/` | vorhanden, Laufzeit ungeprüft |
| API und OpenAPI | `backend/src/index.ts`, `backend/src/openapi.ts` | vorhanden, Vertragskonsistenz ungeprüft |
| KI-Provider/Task-Routing und Queue | `backend/src/services/llm-hub.ts`, `backend/src/services/ai.ts` | vorhanden, Verhalten/Belastung ungeprüft |
| Workflows und interne Aufgaben | `backend/src/routes/workflows.ts`, `backend/knowledge/workflows.json` | vorhanden, End-to-End ungeprüft |
| Migrationen, MySQL/SQLite-Adapter | `backend/src/db/migrations/`, `backend/src/db-adapter.ts` | vorhanden, Restore/Upgrade ungeprüft |
| Messenger/Realtimesignale | `backend/src/routes/chat.ts`, `backend/src/services/realtime.ts`, `xmpp/` | vorhanden, reale Mobil-/NAT-Tests ungeprüft |
| Compose für Betrieb | `docker-compose.yml`, `docker-compose.prod.yml`, `nginx/` | vorhanden, Deployment ungeprüft |
| Release/Governance-Doku | `CHANGELOG.md`, `docs/git-governance.md`, `docs/versioning-and-updates.md` | vorhanden, reale Branch-Policy nicht vollständig verifizierbar |

## Belegte Dokumentations-/Prozesslücken vor diesem Paket

- Kein `AGENTS.md`, keine entwicklungsbezogenen Agenten-Rollenprofile, kein Orchestrierungsvertrag.
- Keine dedizierten `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/OPERATIONS.md` als fachlich gebündelte Einstiege.
- Keine `.github/workflows/`-CI-Definition im überprüften Tree; `package.json` hat Build-/Test-Skripte, doch ihre Ausführung/Ergebnisse sind nicht nachgewiesen.
- README nennt `v1.0.7` und `CHANGELOG.md` enthält teils Vergleichslinks auf einen anderen Repository-Owner (`derdigitalaffine/behebes-ai`). Diese Links sollten validiert werden.
- Compose-Dateien enthalten unsichere **Fallback-Passwörter** für mehrere Dienste. Ohne tatsächliche Umgebungswerte ist dies **ein Konfigurationsrisiko zur Prüfung**, kein Nachweis eines kompromittierten Systems.
- Für Deployment, Datenschutz-Folgenabschätzung, Pen-Test, Backup-Restore und produktive Mandantentrennung liegt hier keine aktuelle Abnahme-Evidenz vor.

## Bewertung und nächste Prüfschritte

| Priorität | Nächstes überprüfbares Ergebnis |
| --- | --- |
| P0 | Baseline-CI mit Build-/Test-/Doku-Checks, ohne unbelegte „alles grün“-Behauptung |
| P0 | Secrets-/Compose-Defaults und Tenant/RBAC-Angriffswege prüfen, Gegenmaßnahmen nachweisbar testen |
| P0 | Backup + Restore + Migrations- und Rollback-Drill auf Wegwerf-Datenbasis |
| P1 | API-/Daten-/Queue-Kontrakte mit deterministischen Tests erfassen |
| P1 | Bürger-, Admin-, OPS-Kernflows mobil, Tastatur und Fehlerszenarien abnehmen |
| P1 | Issue-Backlog, reale technische Risiken, Ownership und Release-Gates pflegen |

**Fortschrittsdefinition:** Ein Arbeitspunkt wechselt erst auf „verifiziert“, wenn Commit/PR, Testlauf und verbleibende Risiken dokumentiert sind. Vorschläge in `ROADMAP.md` und `ISSUE_BACKLOG.md` gelten zunächst als offen.
