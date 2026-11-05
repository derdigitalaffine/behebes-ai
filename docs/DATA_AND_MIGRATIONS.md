# Datenhaltung, Import, Migration und Wiederherstellbarkeit

## Bekannter Bestand

Standard-Compose startet MySQL 8.4. Der Backend-Code enthält einen Datenbankadapter, Legacy-SQLite-Pfade und versionierte Migrationen unter `backend/src/db/migrations/definitions/`. Das Register `backend/src/db/migrations/index.ts` referenziert die Definitionen; `schema_migrations` speichert Version, Name, Checksumme, Anwendungszeitpunkt, Dauer und Erfolg. `docs/versioning-and-updates.md` beschreibt `DB_LEGACY_SCHEMA_BOOTSTRAP`.

## Migrationspolicy

- Bereits veröffentlichte/angewandte Migrationen **nicht verändern**; Drift-Check bleibt wirksam.
- Neue Migration eindeutig datieren/versionieren, im Register ergänzen, kontextneutralen Namen und nachvollziehbare Checksummenquelle verwenden.
- Erst mit frischer Testdatenbank, dann gegen anonymisierte/isolierte Bestandskopie testen.
- Große Datenmigrationen: Backfill separat, wiederaufnehmbar, mit Fortschritt und Fehlerreport.
- Irreversible Schritte: explizite Review, Backup, Wiederherstellungsprobe und manuell freigegebene Ausführung.
- Schemaänderung, zugehöriger API-/Servicecode und Dokumentation bilden einen überprüfbaren PR-Slice.

## Tenant-/Org-Isolation

Jede neue Fachtabelle benötigt nachvollziehbare Zuordnung oder bewusst globale Referenzklassifikation. Indizes, Beziehungen, Cache-/Dateipfade, Imports und Background Jobs müssen dieselben Grenzen respektieren. Keine Filterung allein im Client. Querverweise auf andere Mandanten serverseitig verbieten; Negativtests für Objekt-ID-Manipulation sind Pflicht.

## Imports und Zuordnungen

Die Bestandsdoku `rlp-imports-responsibility-internal-tasks.md` beschreibt Importjobs, Vorschau, Mapping, Abbruch und Zuständigkeitsabfrage. Jeder neue Import benötigt Format-/Encoding-Validierung, Zeilenfehler, Duplikat- und Konfliktregeln, Audit, atomare oder begründet teil-atomare Commitphase und einen nachvollziehbaren Re-Run-/Rollbackplan. Automatische KI-Mappings sind Vorschläge, keine ungeprüfte Direktübernahme.

## Restore-Drill (isoliert)

1. Version, Quell-Datenbank und Datei-/Konfigurationsumfang protokollieren (ohne Credentials zu veröffentlichen).
2. Backup vollständig und verschlüsselt in isolierte Umgebung kopieren.
3. Datenbank/Medien wiederherstellen, Schlüssel sicher bereitstellen, Dienste in Testnetz starten.
4. Migrationstand und Checksummen prüfen, Health- und Kernflüsse mit Testdaten ausführen.
5. RPO/RTO-Messung, ausgelassene Daten, Fehler, nächste Verbesserungen dokumentieren.
6. Niemals Restore-Proben gegen produktive DB oder unter `docker compose down -v` ausführen.

## Pflichtdaten zur PR-Übergabe

Migrations-ID, Tabellen/Indizes, Alt-/Neuzustand, erwartetes Volumen, Downtime/Lockrisiko, Forwardtest, Upgrade-Test, Rollback-/Restore-Verfahren, Datenaufbewahrung und Tests für fremde Tenant-/Org-IDs.
