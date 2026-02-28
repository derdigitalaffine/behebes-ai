# Versionierung und Updatefähigkeit

## Zielbild

- Ein zentraler `main`-Branch als Release-Basis.
- SemVer-Tags (`vMAJOR.MINOR.PATCH`) als deploybare Stände.
- Reproduzierbare Datenbankmigrationen über `schema_migrations`.
- Geführte, manuelle Updates über den Admin-Bereich (`System-Updates`) mit verpflichtendem Backup-Gate.

## Git- und Release-Regeln

1. Branch-Standard: `main`.
2. Release-Tags: `vX.Y.Z` (Beispiel: `v1.0.0`).
3. Vor jedem Release:
   - alle Builds grün (`backend`, `admin`, `frontend`, `ops`),
   - Preflight im Admin erfolgreich,
   - frisches Backup vorhanden.
4. Tagging:
   - `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
   - `git push origin main --tags`

## Datenbankmigrationen

### Technisches Modell

- Migrationen liegen in `backend/src/db/migrations/definitions`.
- Beim Backend-Start läuft der Runner automatisch.
- Verlauf wird in `schema_migrations` protokolliert:
  - `id`
  - `version`
  - `name`
  - `checksum`
  - `applied_at`
  - `duration_ms`
  - `success`

### Ablauf

1. Runner lädt registrierte Migrationen.
2. Bereits erfolgreiche Versionen werden übersprungen.
3. Checksummenabweichungen bei bereits erfolgreichen Migrationen blockieren den Start (Schutz vor Drift).
4. Fehlgeschlagene Migrationen werden protokolliert (`success = 0`) und beim nächsten Start erneut versucht.

### Legacy-Schema-Bootstrap (Übergangsmodus)

- Variable: `DB_LEGACY_SCHEMA_BOOTSTRAP=true|false` (Default: `true`).
- `true`: historische `ensureColumn`-Evolution bleibt aktiv (Bestandskompatibilität).
- `false`: nur versionierte Migrationen laufen; geeignet für kontrollierte Zielumgebungen.
- Empfehlung für Produktion während der Übergangsphase: `true`, bis alle Altpfade migriert sind.

## Build-Metadaten (Backend + Frontends + Docker)

Folgende Variablen sind standardisiert:

- `APP_VERSION`
- `APP_BUILD_ID`
- `APP_BUILD_TIME`
- `GIT_COMMIT`

Docker Compose reicht diese als Build-Args an alle Images durch. Frontends nutzen daraus ihre Vite-Buildinfos (`VITE_APP_VERSION`, `VITE_BUILD_ID`, `VITE_BUILD_TIME`, `VITE_COMMIT_SHA`).

## Geführte manuelle Updates (Admin)

### Endpunkte

- `GET /api/admin/system/update/status`
- `POST /api/admin/system/update/preflight`
- `GET /api/admin/system/update/runbook`
- `GET /api/admin/system/update/history`

### Sicherheitsprinzip

- Keine serverseitige Shell-Ausführung durch die API.
- Das Admin-Frontend zeigt nur Preflight und kopierbare Runbook-Kommandos.
- Ohne frisches Backup blockiert der Preflight das Update.
- `GET /api/admin/maintenance/backup` speichert zusätzlich ein Server-Artefakt unter `backups/`, damit das Backup-Gate direkt erfüllt werden kann.

## Runbook-Referenz (Compose-first)

1. Backup erzeugen.
2. Zieltag holen und auschecken.
3. Images neu bauen.
4. Stack starten.
5. Health/Logs prüfen.
6. Bei Bedarf Rollback auf vorherigen Tag.

## Rollback-Entscheidungsbaum

1. Preflight blockiert:
   - Kein Deployment starten.
   - Backup aktualisieren und Blocker beheben.
2. Deployment durchgeführt, aber Health-Checks schlagen fehl:
   - `docker compose ... logs --tail=200 backend` prüfen.
   - Wenn Fehler nicht sofort behebbar: auf vorherigen Tag zurückrollen.
3. Migration fehlgeschlagen:
   - Keine weiteren Releases darüber deployen.
   - Fehlerursache beheben und denselben Tag reproduzierbar neu bauen.
   - Falls nötig auf letzten stabilen Tag zurückrollen und Backup/Restore-Plan aktivieren.
4. Funktionaler Regression-Fund nach erfolgreichem Start:
   - Kurzfristig Rollback auf letzten stabilen Tag.
   - Danach Fix als neues Patch-Release (`vX.Y.Z+1`) ausrollen.

## Hinweis zu Sprachanrufen (Best-Effort ohne offene TURN-Ports)

- Calls sind ohne extern erreichbaren TURN nur Best-Effort.
- Admin/Ops zeigen dafür `bestEffortOnly` und Reliability-Hinweise im Chat-Bootstrap.
- iOS/PWA kann zusätzliche Audio-Freigabe per Nutzerinteraktion benötigen.
- NAT-/Carrier-Szenarien können trotz stabiler Signalisierung zu fehlendem Audio führen.
- Für produktionssichere Internet-Telefonie sind öffentlich erreichbare TURN-Ports erforderlich.

## Abnahme-Checkliste (Release-Gate)

1. Build-Grün: `backend`, `admin`, `frontend`, `ops`.
2. `GET /api/admin/system/update/status` liefert gültige Build-/Git-/Migrationsdaten.
3. `POST /api/admin/system/update/preflight` ist grün (inkl. Backup-Gate).
4. Runbook ist generierbar und enthält zur Laufzeit passende Runtime-Kommandos.
5. Historie zeigt neue Preflight-/Status-Checks mit Zeitstempel und Ergebnis.
6. Nach Deployment: Health + kritische Kernflows (Login, Tickets, Messenger, Call-Aufbau) manuell verifizieren.
