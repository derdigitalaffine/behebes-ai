# Dokumentationsportal – behebes.AI

**Einstieg:** Diese Seite ist der Navigationspunkt für Entwicklung, Betrieb, Produktplanung und KI-gestützte Mitarbeit. Inhalte beschreiben den **aus dem Repository nachvollziehbaren Stand**, nicht automatisch eine verifizierte Produktionsinstallation.

## Für welche Aufgabe welches Dokument?

| Aufgabe | Zuerst lesen | Ergänzend |
| --- | --- | --- |
| Projektstand / nächste Schritte | [STATUS](STATUS.md), [ROADMAP](ROADMAP.md) | [Entscheidungen](DECISIONS.md), [Issue-Backlog](ISSUE_BACKLOG.md) |
| Neue Entwickler / Agenten | [AGENTS](../AGENTS.md), [Entwicklungsprozess](DEVELOPMENT.md) | [Orchestrierung](AGENT_ORCHESTRATION.md), [Tests](TESTING.md) |
| KI-Provider-Baseline und Vertragsprüfung | [ADR-0004](ADR-0004-AI-PROVIDER-BASELINE.md), [KI-Backends](AI_BACKENDS.md) | [Tests](TESTING.md), [Sicherheit](SECURITY_PRIVACY.md) |
| Architektur und API | [Architektur](ARCHITECTURE.md), [API-Kontrakte](API_CONTRACTS.md) | [Daten & Migrationen](DATA_AND_MIGRATIONS.md) |
| Bürger-, Admin-, OPS-Oberflächen | [UX-Prinzipien](UX_PRINCIPLES.md) | [Architektur](ARCHITECTURE.md), [Tests](TESTING.md) |
| Sicherheit, Datenschutz, KI | [Security & Privacy](SECURITY_PRIVACY.md) | [Orchestrierung](AGENT_ORCHESTRATION.md), [Tests](TESTING.md) |
| Installation / Betrieb / Störung | [Quickstart](../QUICKSTART.md), [Operations](OPERATIONS.md) | [Versioning & Updates](versioning-and-updates.md), [Release-Checkliste](RELEASE_CHECKLIST.md) |
| Branches, Freigaben und Releases | [Git-Governance](git-governance.md) | [Entwicklungsprozess](DEVELOPMENT.md), [Changelog](../CHANGELOG.md) |
| Fachliche Spezialgebiete | [RLP-Importe und Zuständigkeit](rlp-imports-responsibility-internal-tasks.md) | [Chat & Calls](chat-presence-calls.md) |

## Agenten-Organisation als ausführbar prüfbarer Vertrag

[Agentenmanifest und Prüfregeln](../agents/README.md) · [Rollendefinitionen](../.github/agents/) · [Handoff-/Gate-Modell](AGENT_ORCHESTRATION.md).

## Behebes Next: nutzerzentrierter Ausbau

- [Produktvision und Nutzer-Journeys](PRODUCT_VISION.md)
- [Detaillierte Roadmap (92 geplante Issues)](ROADMAP.md) und [Issue-Index](ISSUE_BACKLOG.md)
- [Modulplattform und Feature-Controls](MODULE_PLATFORM.md)
- [Mantine-Migration und großer UI-Polish](MANTINE_MIGRATION.md)
- [Performance, Resilienz und SLOs](PERFORMANCE_SLOS.md)
- [Milestone-Plan mit acht Qualitäts-Gates](MILESTONES.md)
- [KI-Backend-Architektur und Provider-Fabric](AI_BACKENDS.md)
- [Maschinenlesbare Issue-Planung](../planning/README.md)

## Was ist heute vorhanden?

- **Anwendung:** `backend/` (Express/TS), `frontend/` (Bürger/PWA), `admin/` (Verwaltung), `ops/` (mobile Bearbeitung).
- **Betrieb:** MySQL, Nginx, XMPP/ejabberd, Docker-/Podman-Compose; Details in `docker-compose*.yml`.
- **KI zur Laufzeit:** vorhandene LLM-Modell-/Task-Routen (`backend/src/services/llm-hub.ts`) und KI-Queue (`backend/src/services/ai.ts`).
- **Neu dokumentiert:** getrennte **Entwicklungsagenten-Orchestrierung** und standardisierte Abnahme-/Betriebsprozesse. Das ist **kein Beleg**, dass selbstständig laufende Coding-Agenten oder neue produktive KI-Dienste installiert wären.

## Dokumentationsregeln

1. Dokumente direkt mit einem fachlichen Slice aktualisieren, nicht monatelang nachträglich.
2. Für Ist-Aussagen Implementierung/Release/Tests benennen; geplante Funktion als **geplant** kennzeichnen.
3. Änderungen an Sicherheit, API, Datenformaten, Betriebsvariablen, UX oder Migrationen müssen passende Doku mitändern.
4. Entscheidungen und verworfene Alternativen in `DECISIONS.md` oder einer verlinkten ADR festhalten.
5. API-Endpunkte aus `backend/src/openapi.ts` / geroutetem Code verifizieren; keine unbestätigten Endpunkte erfinden.
6. Keine produktiven Daten, Geheimnisse oder realen Nutzerinformationen in Dokus und Screenshots.
7. Interne Links mit `npm run docs:check` (nach Integration in `package.json`) bzw. `node scripts/check-docs.mjs` und `node scripts/check-agent-orchestration.mjs` validieren.

## Evidenzgrenzen

Dokumentstand: **2026-11-05**. Die Ist-Aufnahme beruht auf dem zum Erstellungszeitpunkt lesbaren `main`-Stand `12ae45fa` und GitHub-Metadaten. Ohne Zugang zur Laufzeitumgebung sind Verfügbarkeit, Sicherheitskonfiguration, Deploymentstand und reale Performance **ungeprüft**. Die Roadmap ist ein Priorisierungsvorschlag, kein zugesagter Zeitplan.
