# Betrieb, Beobachtbarkeit, Störung und Wiederherstellung

## Gültigkeit und Voraussetzungen

Operative Anleitung für den vorhandenen Compose-Ansatz. Der tatsächliche Produktionshost, Reverse Proxy, Zertifikats- und Backupplan sind **nicht verifiziert**. Gültige Details in `QUICKSTART.md`, `docker-compose.yml`, `docker-compose.prod.yml`, `docs/versioning-and-updates.md` und `docs/chat-presence-calls.md` abgleichen.

## Komponenten / Verantwortlichkeiten

| Komponente | Aufgabe | Beobachtung |
| --- | --- | --- |
| `proxy` (Nginx) | einziger HTTP-Eingang | Erreichbarkeit, 4xx/5xx, Routing, Header |
| `backend` | API, Fach-/KI-/E-Mail-/Mailbox-/Übersetzungsworker | `/api/health`, Fehler-/Queue-Raten, Restarts |+| `mysql` | persistente Verwaltungsdaten | Speicher, verfügbare Backups, Migrationen, Transaktionen |
| `frontend`, `admin`, `ops` | React-Clients | Asset-Version, Login-/Kernflows, Service-Worker |
| `xmpp` (ejabberd) | Messenger/Präsenz/Calls | Verbindungen, Auth, Qualität, ggf. TURN-Status |

## Erstkonfiguration (nur Test-/Entwicklungsumgebung)

```bash
cp .env.example .env.local
# Prüfe/ersetze unbedingt alle Credentials und URLs vor produktiver Nutzung.
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
curl -fsS http://localhost:8384/api/health
```

`PROXY_PORT` kann abweichen. Die Compose-Dateien besitzen unsichere Defaultpasswörter; **nicht ungeprüft produktiv starten**. Zugangsdaten niemals in Shell-History/Issue/Chat protokollieren. Datenbank-Schema und externe Provider vor jeder Migration berücksichtigen.

## Routinechecks

1. Proxy/Backend-Health plus Auth-/Ticket-Smoke mit Testaccount.
2. Warteschlangen: `pending`/`retry`/`failed`, Job-Alter, ungewöhnliche Wiederholungen und Auslieferungsduplikate.
3. DB: Kapazität, Migration-Drift, Backup-Erfolg **und Restore-Probe**.
4. Login-/SSE-/XMPP-Reconnect, Mobilnetz/Offline-Verhalten.
5. Laufende Version aus Statusseite/Build-Metadaten gegen ausgerollten Git-Tag/Commit abgleichen.
6. Fehlermeldungen ohne produktive personenbezogene Payloads erfassen.

## Deployment- und Update-Gate

Vor Update: Wartungsfenster, Verantwortliche, Backup und getesteter Restorepfad, `main`-Review/CI, Ziel-Tag, DB-Migrationsanalyse, Kommunikation. Danach erst `POST /api/admin/system/update/preflight` entsprechend vorhandener Dokumentation. Das System bietet **kein freigegebenes serverseitiges Shell-Update per API**. Per Runbook manuell deployen, dokumentierte Prüfungen durchführen und auf Rückrollbereitschaft achten.

### Checkliste

- [ ] Release/Commit und Docker-/Node-Version dokumentiert
- [ ] Release-Builds/Testnachweise vorhanden
- [ ] Secrets/URLs/Reverse-Proxy/Backup-Ziel geprüft
- [ ] DB-Backup erstellt, Integrität und separate Wiederherstellung geprüft
- [ ] Migrationen auf Testkopie gelaufen
- [ ] Deployment bewusst freigegeben
- [ ] `/api/health`, Login, Ticket, Workflow, OPS, Messenger nach Rollout geprüft
- [ ] Observability und Error-Trend beobachtet, Rollback-Entscheidung dokumentiert

## Runbook: API nicht erreichbar

1. Prüfen, ob nur Browser, Proxy oder Backend betroffen: `docker compose -f docker-compose.prod.yml ps`; externes TLS getrennt prüfen.
2. Gezielte Logs ohne unberechtigte Weitergabe: `docker compose -f docker-compose.prod.yml logs --tail=200 backend` (kann PII enthalten; vertraulich behandeln).
3. DB-/XMPP-Health und Migration-/Credential-Fehler prüfen.
4. Nicht reflexartig Datenvolumes löschen oder `down -v` nutzen.
5. Bei nicht sicher behebbarer Regression: Wartungs-/Rollbackplan; Zustand vor Eingriff sichern.

## Runbook: KI-/E-Mail-Queue staut

1. Worker-/Provider-/Netzfehler und Altersverteilung prüfen.
2. Wiederholungsstrategie und erlaubte Retry-Zahl kontrollieren; jede bereits versandte Mail/Action auf Duplikat prüfen.
3. Keine manuellen SQL-Requeues auf Produktivdaten ohne Freigabe und idempotente Prozedur.
4. Wenn Provider nicht vertrauenswürdig/verfügbar: Bearbeitung manuell fortsetzen, kritische autom. Aktionen pausieren.

## Runbook: DB-Migration schlägt fehl

1. Änderung stoppen, Fehler/Checksumme sichern, weitere Deployments blockieren.
2. Prüfen, ob Schreibtransaktion oder partielle DDL stattgefunden hat.
3. **Keine bereits angewandte Migrationsdatei ändern.** Fix als neue Migration oder restaurierbare Reparatur.
4. Restore nur nach dokumentierter Entscheidung inklusive potenziellem Datenverlust und Export neuer Daten.

## Backups und Wiederherstellung

Backups müssen neben MySQL alle nötigen Dateien/Uploads, relevanten Betriebs-/Versionsmetadaten und Schlüssel zur Wiederherstellung berücksichtigen. Sicher verschlüsselt/offsite speichern und Berechtigungen trennen. Restore mindestens regelmäßig in separater Testumgebung durchführen; Ergebnis, Dauer, Schema-/Dateizahl und Smoke dokumentieren. Die Backup-/Restore-Verfahren nicht aus ungetesteten Compose-Defaults ableiten.

## Kommunikations- und Incident-Prozess

Bei Datenschutz-, Verfügbarkeits- oder Integritätsvorfall: Incident-Owner bestimmen, Zeitraum/Version/Scope erfassen, Beweise geschützt sichern, Änderungen koordinieren, keine Echtdaten in öffentlichen PRs, externe Meldungen nur durch berechtigte Verantwortliche. Nachbereitung mit Root Cause, Prävention, Tests und Runbook-Update.
