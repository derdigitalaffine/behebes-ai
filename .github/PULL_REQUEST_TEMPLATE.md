## Problem, Issue, Nutzerwirkung

- Verknüpfte Issue / Roadmap-Paket:
- Vorher → Nachher / betroffene Rollen und Mandanten:
- Nicht-Ziele / kompatibles Verhalten:

## Änderungen und Verantwortung

- Führender Agent/Owner:
- Reviewer (bei P0 unabhängig):
- Geänderte Daten-/API-/Frontend-/KI-/Betriebskontrakte:

## Risiken / Abnahmekriterien

- [ ] Tenant-/Org-Isolation und Rechte serverseitig berücksichtigt bzw. begründet nicht betroffen.
- [ ] PII, Dateien, externe Provider, E-Mail, KI-Prompts und Logs auf Datenschutz geprüft.
- [ ] Migration/Backfill/Audit/Idempotenz/Retry/Offline überprüft bzw. begründet nicht betroffen.
- [ ] Fehlerfälle, abgelehnter Zugriff und Konflikte geprüft.
- [ ] API/OpenAPI und passende Dokumentation aktualisiert.
- [ ] Keine echten Secrets, Bürgerdaten oder produktiven Logs in Commits, Screenshots oder Fixtures.

## Validierung mit echten Ergebnissen

| Prüfung/Befehl | Ergebnis oder „nicht ausgeführt“ mit Grund |
| --- | --- |
| `node scripts/check-docs.mjs` | |
| Backend-Build/Tests | |
| Frontend/Admin/OPS Build/Tests | |
| Migration/Contract/Browser/Offline je nach Scope | |
| Security-/UX-Review | |

## UX (wenn Nutzeroberfläche betroffen)

- [ ] Hauptaktion, Kontext, verständlicher Status.
- [ ] 360px/Touch, Tastatur, Fokus, accessible names und Kontrast.
- [ ] Laden, Leer, Berechtigung, Fehler, Erfolg, Offline/Conflict.
- [ ] Kein unnötiger Kontextverlust, bestehende Komponenten/Begriffe verwendet.

## Deployment / Rollback / offener Befund

- Neue Env-Variablen oder Deployment-Schritte:
- Backup/Restore-, Migration- und Rollback-Folgen:
- Offene Risiken, manuelle Fallbacks, noch fehlende Tests:
- Menschliche Freigabe für Release/Produktivaktion erforderlich: ja / nein (Begründung)
