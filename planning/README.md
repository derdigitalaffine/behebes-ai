# Roadmap-Issues – Autoritativer Entwurfskatalog

`roadmap-issues.json` ist die **versionierte, maschinenlesbare Entwurfssammlung** der geplanten GitHub-Tickets. **Nicht** jede Aufgabe ist bereits umgesetzt, oder überhaupt als GitHub-Issue angelegt.

Enthalten: **1 Programmticket**, **9 Epics (E-F bis E-P)** und **59 Umsetzungstickets (F01…P06)**. Die JSON-IDs sind stabil und werden über den Marker `<!-- behebes-roadmap-id:KEY -->` in den Issues gespeichert.

## Freigabe / Import

1. Im Fork `derdigitalaffine/behebes-ai` unter GitHub **Settings → General → Features → Issues** aktivieren. Ohne diesen Schritt antwortet GitHub auf `POST /issues` mit 410.
2. Mit eigenem, minimal berechtigtem Token arbeiten (Issues: Read/Write). Token nicht in Git, Terminalhistorie oder Chat-Logs weitergeben. `GH_TOKEN` oder `GITHUB_TOKEN` nur im sicheren lokalen Lauf setzen.
3. `node scripts/check-roadmap.mjs` (statische Integrität).
4. `node scripts/import-roadmap-issues.mjs` (standardmäßig **Dry-run**, keine Writes).
5. `node scripts/import-roadmap-issues.mjs --apply` (erst nach ausdrücklicher Freigabe).
6. `node scripts/import-roadmap-issues.mjs --apply --update` **nur** bei gewünschter erneuter Synchronisierung der generierten Texte. **Achtung:** `--update` ersetzt den Issue-Body und darf nicht genutzt werden, wenn dort menschliche Fortschrittsnotizen gepflegt werden; lieber Kommentare/PR-Links getrennt führen.

`--apply` erstellt zunächst Programm und Epics, dann Tasks; vorhandene Issues werden durch Marker erkannt. Dependenzen werden in den Körper mit stabilen IDs und – soweit bereits bekannt – echten Nummern dargestellt. Labels/Milestones werden **nicht** automatisch erzeugt oder frei erfunden. Priorität und Epic erscheinen im Titel; optionale GitHub-Project-Felder können später kontrolliert ergänzt werden.

## Qualität und Governance

- Ein Issue entspricht einem **fachlichen vertikalen Schnitt** mit eigenem Nachweis; die Epics sind keine Ersatz-Implementierung.
- P0-Änderungen betreffen oft kritische Grenzen: Security-/Architektur-Review, Tenant-Negativtests, Recovery und Betriebspfad sind verpflichtend.
- Performance-Budgets vor Optimierung messen; keine heimliche Erfassung von Bürgerdaten.
- Keine autonomen Releases, Merges, externen Mailversände oder Änderungen außerhalb des Forks.
- `docs/ROADMAP.md` beschreibt Reihenfolge/Gates, `docs/ISSUE_BACKLOG.md` ist generierter Navigationsindex, GitHub-Issues sind der operative Fortschrittsstand nach Import.

[Produktvision](../docs/PRODUCT_VISION.md) · [Modularchitektur](../docs/MODULE_PLATFORM.md) · [Mantine](../docs/MANTINE_MIGRATION.md) · [Performance](../docs/PERFORMANCE_SLOS.md)
