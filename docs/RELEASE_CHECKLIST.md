# Release- und Abnahme-Checkliste

Dieses Dokument ergänzt, ersetzt aber nicht `docs/git-governance.md` und `docs/versioning-and-updates.md`. **Releaseausführung ist eine bewusst manuelle, menschlich freizugebende Aktion.**

## Vor der PR-Freigabe

- [ ] Issue/Scope/Akzeptanzkriterien und Reviewer dokumentiert.
- [ ] Code-, Migration-, OpenAPI-, Env- und Docs-Änderungen in sich konsistent.
- [ ] Backend, Bürger-Frontend, Admin, OPS tatsächlich gebaut und getestet oder Abweichung begründet.
- [ ] Auth-/Tenant-/Org-/PII-/AI-/Audit-Risiken bewertet und Negativtests ausgeführt.
- [ ] Mobile/Offline/UX-Prüfung bei relevanten Oberflächen.
- [ ] Neue Abhängigkeiten, Secrets, Ports, Providerdaten und sicherer Fallback bekannt.

## Vor dem Tag/Deployment

- [ ] PR nach Branch-Governance geprüft und gemergt; main/Commit und Release-Version dokumentiert.
- [ ] Backup vollständig und Restore in Testsystem nachweisbar.
- [ ] Automatisierte und manuelle Kernflows erfolgreich, offene Risiken akzeptiert.
- [ ] Checksum-/Migration-/Upgradeplan auf Bestandsdaten geprobt.
- [ ] Laufzeit-Konfiguration/URLs/Proxy/TLS/Provider ohne unsichere Default-Credentials.
- [ ] Update-Preflight im Admin durch berechtigte Person ausgeführt.
- [ ] Rollbackschwellen, Wartungsfenster und verantwortliche Personen festgelegt.

## Nach dem Deployment

- [ ] Health/Version/Commit stimmen.
- [ ] Bürger-Meldung/Status, Admin-Login/Ticket/Workflow, OPS-Aufgabe, Messaging und Queue geprüft.
- [ ] Migrationsstand, Worker-Retries, Fehlerraten und alte Clients/PWA überprüft.
- [ ] Changelog, Release-Notes, Dokumentationsstand und bekannte Einschränkungen aktualisiert.
- [ ] Review/Incident-Nachbesprechung geplant, falls Abweichungen.

Jeder Haken benötigt eine verantwortliche Person und einen nachprüfbaren Test-/Betriebsbeleg. Ein nicht ausgeführter Test bleibt offen; fehlender CI-Job ist kein grüner Test.
