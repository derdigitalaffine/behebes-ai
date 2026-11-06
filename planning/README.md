# Roadmap-Issues – Autoritativer Entwurfskatalog

`roadmap-issues.json` ist die **versionierte, maschinenlesbare Entwurfssammlung** der geplanten GitHub-Tickets. **Nicht** jede Aufgabe ist bereits umgesetzt, oder überhaupt als GitHub-Issue angelegt.

Enthalten: **1 Programmticket**, **10 Epics (E-F bis E-P einschließlich E-K)** und **81 Umsetzungstickets (F01…P06 sowie K01–K22)**. Die JSON-IDs sind stabil und werden über den Marker `<!-- behebes-roadmap-id:KEY -->` in den Issues gespeichert.

## Status: GitHub-Issues aktiv, 92 Planungsobjekte angelegt

Der Fork hat die Issues-Funktion aktiviert. Die ursprünglich vorbereiteten 69 Tickets wurden importiert; das KI-Programm ergänzt 23 weitere (Epic E-K und K01–K22). [Master-Roadmap #3](https://github.com/derdigitalaffine/behebes-ai/issues/3), [KI-Epic #72](https://github.com/derdigitalaffine/behebes-ai/issues/72). Die Aufgabe bleibt in den jeweiligen Issues offen, bis PRs und Tests eine Umsetzung nachweisen.

## Wiederholbarer Import

1. Vergewissern, dass Issues im Fork aktiviert bleiben (aktuell erfüllt).
2. Mit eigenem, minimal berechtigtem Token arbeiten (Issues: Read/Write). Token nicht in Git, Terminalhistorie oder Chat-Logs weitergeben. `GH_TOKEN` oder `GITHUB_TOKEN` nur im sicheren lokalen Lauf setzen.
3. `node scripts/check-roadmap.mjs` (statische Integrität).
4. `node scripts/import-roadmap-issues.mjs` (standardmäßig **Dry-run**, keine Writes).
5. `node scripts/import-roadmap-issues.mjs --apply` (erst nach ausdrücklicher Freigabe).
6. `node scripts/import-roadmap-issues.mjs --apply --update` **nur** bei gewünschter erneuter Synchronisierung der generierten Texte. **Achtung:** `--update` ersetzt den Issue-Body und darf nicht genutzt werden, wenn dort menschliche Fortschrittsnotizen gepflegt werden; lieber Kommentare/PR-Links getrennt führen.

`--apply` erstellt zunächst Programm und Epics, dann Tasks; vorhandene Issues werden durch Marker erkannt. Dependenzen werden in den Körper mit stabilen IDs und – soweit bereits bekannt – echten Nummern dargestellt. Das separate, geschützte [Milestone-Manifest](milestones.json) samt [Synchronisationsworkflow](../.github/workflows/roadmap-sync.yml) kann **acht native Meilensteine** erzeugen und die 81 Umsetzungstickets zuordnen. Labels werden nicht automatisch erfunden. Priorität und Epic erscheinen im Titel; optionale GitHub-Project-Felder können später kontrolliert ergänzt werden.

## Qualität und Governance

- Ein Issue entspricht einem **fachlichen vertikalen Schnitt** mit eigenem Nachweis; die Epics sind keine Ersatz-Implementierung.
- P0-Änderungen betreffen oft kritische Grenzen: Security-/Architektur-Review, Tenant-Negativtests, Recovery und Betriebspfad sind verpflichtend.
- Performance-Budgets vor Optimierung messen; keine heimliche Erfassung von Bürgerdaten.
- Keine autonomen Releases, Merges, externen Mailversände oder Änderungen außerhalb des Forks.
- `docs/ROADMAP.md` beschreibt Reihenfolge/Gates, `docs/ISSUE_BACKLOG.md` ist generierter Navigationsindex, GitHub-Issues sind der operative Fortschrittsstand nach Import.

[Produktvision](../docs/PRODUCT_VISION.md) · [Modularchitektur](../docs/MODULE_PLATFORM.md) · [Mantine](../docs/MANTINE_MIGRATION.md) · [Performance](../docs/PERFORMANCE_SLOS.md)

## Milestone-Verwaltung

`node scripts/check-milestones.mjs` validiert die eindeutige, azyklische 1:1-Zuordnung. `node scripts/sync-roadmap-milestones.mjs` ist standardmäßig ein **offline Dry-run**, schreibt nur mit `--apply` und akzeptiert ausschließlich den Fork. Die GitHub-Action nutzt `issues:write` und führt zunächst den idempotenten Ticketimport, danach den Milestone-Abgleich aus. Sie überschreibt keine fremden, manuell zugeteilten Milestones, setzt keine Fälligkeitsdaten und schließt nichts. Bei Änderungen an der Planung eine nachvollziehbare Code-Review durchführen.
