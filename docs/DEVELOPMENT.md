# Entwicklungsprozess, Ownership und Quality Gates

## Arbeitsprinzip

**Kleine vertikale, prüfbare Änderungen statt Big Bang.** Jeder Slice verbessert einen echten Bürger-/Sachbearbeitungs-/OPS-Weg und liefert nötige Datenmodell-, API-, UI-, Test- und Dokumentationsänderungen zusammen. `main` bleibt releasbar; kurze Branches und PRs. Siehe `docs/git-governance.md` für bestehenden Branch-/Release-Standard und `AGENTS.md` für Agentenregeln.

## Definition of Ready

Ein Issue ist bereit, wenn diese Fragen beantwortet sind:

- Welches konkrete Nutzer-/Betriebsproblem? Wer ist der Nutzer, was ist sichtbar besser?
- Welche Rolle/Capability und welcher Tenant-/Org-Scope? Gibt es Plattformadmin-Sonderfälle?
- Welche API, Datenobjekte, Backfills, Migrationen, Datenschutz- oder Auditfolgen?
- Welche Offline-/PWA-/Realtime-/Queue-/KI-Effekte und unerwünschten Duplikate?
- Welche positiven, negativen und Fehlerpfad-Abnahmekriterien?
- Welche Schnittstellen/Dateien, Reviewer und Rollbackstrategie?
- Welche fachliche Entscheidung ist offen (dann `blocked`, nicht still erfunden)?

## Definition of Done

Relevante Punkte müssen nachweisbar erfüllt sein:

- Fachliches Verhalten erfüllt Akzeptanzkriterien, keine unbeabsichtigten Nebeneffekte.
- Backend-Rechte und Tenant-/Org-Scope serverseitig geprüft, Negativtests vorhanden.
- API-/Datenmodell-/OpenAPI-Kontrakte synchron; Migrationen vorwärtskompatibel und dokumentiert.
- Unit-/Integration-/Browser-/Mobile-Tests passend zum Risiko ausgeführt; Ausnahmen begründet.
- Retry, Timeout, Offline, Duplicate-/Concurrency- und Error-/Empty-Zustände berücksichtigt.
- UI auf Smartphone (~360px), Tastatur/Fokus/Touch und bei Bedarf Screenreader geprüft.
- Sicherheits-/Datenschutzwirkung bewertet; keine PII oder echten Secrets in Tests/PRs.
- Runbook, Roadmap, Changelog und relevante Dokumente aktualisiert.
- PR enthält Testbefehle, Ergebnisse, bekannte Risiken und nötige menschliche Freigaben.
- CI-Status aus tatsächlich ausgeführtem Lauf bekannt; nicht „bestanden“ bei fehlendem Job.

## Branching und Review

Konvention: `feature/<kurzname>`, `fix/<kurzname>`, `docs/<kurzname>`, `chore/<kurzname>`. Commits sind logisch und beschreibend (`feat(backend): ...`, `docs(agents): ...`). Keine direkten Main-Pushes. Große Änderung in mehrere abhängige PRs aufteilen. PR-Template als verpflichtendes Review-Raster verwenden.

**Reviewpflicht:** Auth/Tenant/PII/KI-Aktion/Datenmigration erhält vorab Architektur-/Security-Review. Implementierer kann nicht der einzige Sicherheitsprüfer sein. UX bei neuen/umgebauten Flows vor der Implementierung grob skizzieren und nachher real testen. Freigabe durch einen Agenten ist keine Repo-Approval.

## Vertikale Arbeitsreihenfolge

1. Contract/Testfälle beschreiben; betroffene Nutzer, Rollen und Scopes.
2. Daten-/API-Schnittstellen kompatibel anlegen, Migration vorbereiten.
3. Backend: fachliche Validierung, Auth, Idempotenz, Audit, Fehlervertrag.
4. Frontend: aktive Zustände, Aktion, Fehler-/Offline-Feedback; keine doppelte Business Rule.
5. Automatisierte Tests + manuelle Smoke-/A11y-Checks.
6. Doku, Release-/Rollbacksicht, Review und PR-Evidenz.

## Besondere Änderungsarten

| Art | Mindestevidenz |
| --- | --- |
| API | Route+OpenAPI, Rolle/Tenant, Statuscodes, Erfolg/Fehler, Contract-Test |
| Migration | Migrations-ID, Fresh+Upgrade-Test, Backfill, Restoreplan |
| AI | Prompt-/Providerdatenfluss, Outputvalidierung, Failover, Human-Gate |
| Offline | Queue-Replay, Konflikt-/Versionsprüfung, UX bei Ausfall |
| Adminrechte | Rollen-/Scope-Matrix und direkten API-Negativtest |
| E-Mail/Notifications | doppelte Auslieferung verhindern, Sandbox/Testadresse, Escape |
| Release | Backup, Preflight, Version, Smoke, Rollback und Owner |

## Design-/Wartungsregeln

- Änderungen an sehr großen Dateien durch Extraktion **mit Tests** vorbereiten, nicht ungetestet neu schreiben.
- Keine Copy/Paste-Fachlogik in Admin/Ops/Bürger; gemeinsame API-Verträge bevorzugen.
- Fehler dürfen keine Eingaben verlieren, sofern technische Sicherheitsregeln nicht entgegenstehen.
- Neue Konfigurationsvariablen: `.env.example`, Compose, Doku und sichere Defaults gemeinsam anpassen.
- Bei fehlender Schreibberechtigung oder nicht ausführbarer CI: sauberer Blocker und anwendbares Patch statt behauptetem Merge.
