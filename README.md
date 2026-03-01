# behebes.AI

**Digital public service operations platform for municipal case management, workflow automation, and AI-supported administration.**  
**Digitale Verwaltungsplattform fuer Buergermeldungen, Workflow-Automation und KI-gestuetzte Sachbearbeitung.**

## Executive Summary | Zusammenfassung

**EN**  
behebes.AI is a multi-tenant platform for modern municipal operations. It combines a citizen reporting experience, a full administrative control center, and a mobile-first operations app into one coherent system. The platform is designed for reliability, accountability, data protection, and practical day-to-day execution in public administration.

**DE**  
behebes.AI ist eine mandantenfaehige Plattform fuer moderne Verwaltungsprozesse. Sie vereint Buerger-Frontend, Admin-Kontrollzentrum und mobile Ops-App in einem durchgaengigen System. Der Fokus liegt auf Verlaesslichkeit, Nachvollziehbarkeit, Datenschutz und praktischer Einsatzfaehigkeit im Verwaltungsalltag.

## Mission | Leitbild

**EN**  
Build trustworthy, high-performance municipal software that teams can operate with confidence under real-world conditions.

**DE**  
Vertrauenswuerdige, leistungsstarke Verwaltungssoftware schaffen, die Teams unter realen Einsatzbedingungen sicher betreiben koennen.

## Platform Scope | Plattformumfang

### 1) Citizen Frontend
- **EN:** Public reporting entrypoint with multilingual guidance, token-based status tracking, and PWA behavior.
- **DE:** Oeffentlicher Meldungseingang mit mehrsprachiger Fuehrung, tokenbasierter Statusverfolgung und PWA-Funktionen.

### 2) Admin Frontend
- **EN:** Operational control center for tickets, workflows, governance settings, queues, system operations, and API documentation.
- **DE:** Operatives Kontrollzentrum fuer Tickets, Workflows, Governance-Einstellungen, Queues, Systembetrieb und API-Dokumentation.

### 3) Ops Frontend (`/ops`)
- **EN:** Mobile-first operations app for staff execution (tickets, messenger, field workflows, push notifications).
- **DE:** Mobile-First Einsatzoberflaeche fuer die operative Bearbeitung (Tickets, Messenger, Feldprozesse, Push-Benachrichtigungen).

## Key Capabilities | Kernfaehigkeiten

- **Multi-tenancy and context-aware operations**
  - EN: Tenant-aware routing, role/capability enforcement, context switching for platform admins.
  - DE: Mandantenbezogenes Routing, Rollen-/Capability-Pruefung, Kontextwechsel fuer Plattformadmins.

- **Workflow and queue orchestration**
  - EN: Structured task execution with retry, monitoring, and controlled automation paths.
  - DE: Strukturierte Aufgabenbearbeitung mit Retry, Monitoring und kontrollierten Automationspfaden.

- **AI integration hub**
  - EN: Multiple OpenAI-compatible providers, model routing by task, and centrally managed AI settings.
  - DE: Mehrere OpenAI-kompatible Provider, Task-basiertes Modellrouting und zentral verwaltete KI-Einstellungen.

- **Realtime operations**
  - EN: SSE-based updates for tickets, workflows, and queues; smart table live refresh.
  - DE: SSE-basierte Live-Updates fuer Tickets, Workflows und Queues; Smart-Table Live-Refresh.

- **Operational communication**
  - EN: Integrated XMPP-based team messaging with enterprise-oriented control features.
  - DE: Integrierter XMPP-basierter Team-Messenger mit betriebstauglichen Steuerungsfunktionen.

## Architecture at a Glance | Architektur auf einen Blick

- **Backend:** Node.js + Express + TypeScript
- **Database:** MySQL (default in compose) with migration framework (`schema_migrations`)
- **Frontends:** React + Vite + TypeScript (`frontend`, `admin`, `ops`)
- **Realtime:** SSE + websocket/XMPP channels where applicable
- **Proxy:** Nginx reverse proxy (`PROXY_PORT`, default `8384`)
- **Containers:** `docker-compose.yml` and `docker-compose.prod.yml`

## URL Model | URL-Modell

- **EN:**
  - Citizen frontend: root or tenant path (`/c/<tenant-slug>`) depending on admin routing policy
  - Platform presentation page: configurable path (default concept uses `/plattform`)
  - Admin frontend: `/admin`
  - Ops frontend: `/ops`
  - API: `/api`
  - Swagger UI: `/api/docs`

- **DE:**
  - Buergerfrontend: je nach Routing-Policy auf Root oder mandantenbezogen (`/c/<tenant-slug>`)
  - Plattformseite: konfigurierbarer Pfad (konzeptionell standardmaessig `/plattform`)
  - Adminfrontend: `/admin`
  - Ops-Frontend: `/ops`
  - API: `/api`
  - Swagger UI: `/api/docs`

## Security and Privacy Principles | Sicherheits- und Datenschutzprinzipien

- **EN**
  - Server-side authorization is authoritative (frontend gating is UX-only).
  - Centralized admin context and capability checks.
  - Sensitive data handling is designed for public-sector constraints.
  - Versioned migrations and update preflight reduce operational risk.

- **DE**
  - Serverseitige Autorisierung ist massgeblich (Frontend-Gating nur UX).
  - Zentraler Admin-Kontext mit Capability-Pruefungen.
  - Umgang mit sensiblen Daten ist auf Verwaltungskontext ausgelegt.
  - Versionierte Migrationen und Update-Preflight reduzieren Betriebsrisiken.

## Quick Start (Local Development) | Schnellstart (lokale Entwicklung)

```bash
# 1) Install dependencies
npm install

# 2) Configure environment
cp .env.example .env.local
# Review and adjust values in .env.local

# 3) Start services (workspace mode)
npm run dev:backend
npm run dev:frontend
npm run dev:admin
npm run dev:ops
```

## Container Deployment | Container-Betrieb

```bash
# Development-like stack
podman-compose -f docker-compose.yml up -d --build

# Production-oriented stack
podman-compose -f docker-compose.prod.yml up -d --build
```

> If you use Docker instead of Podman, replace `podman-compose` with `docker compose`.

## Build and Validation | Build und Validierung

```bash
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix admin run build
npm --prefix ops run build
```

## Documentation | Dokumentation

- Platform overview: `README.md`
- Quick start and runtime operations: `QUICKSTART.md`
- Versioning and system updates: `docs/versioning-and-updates.md`
- Git governance and release workflow: `docs/git-governance.md`
- RLP import/responsibility/internal-task package: `docs/rlp-imports-responsibility-internal-tasks.md`
- Chat presence/call stability and realtime model: `docs/chat-presence-calls.md`

## Release and Governance Baseline | Release- und Governance-Basis

**EN**
- Mainline is `main` with SemVer tags (`vMAJOR.MINOR.PATCH`).
- Releases are created from clean, build-green states only.
- Branch protection is mandatory for production integrity.
- Update execution remains guided and manual via runbook, never arbitrary server-side shell execution from UI/API.

**DE**
- Hauptlinie ist `main` mit SemVer-Tags (`vMAJOR.MINOR.PATCH`).
- Releases werden nur aus sauberen, build-gruenen Staenden erzeugt.
- Branch-Protection ist fuer Produktionsintegritaet verpflichtend.
- Updates bleiben gefuehrt und manuell per Runbook, keine beliebige serverseitige Shell-Ausfuehrung aus UI/API.

Recommended references:
- `docs/git-governance.md`
- `docs/versioning-and-updates.md`

## Operations and Updates | Betrieb und Updates

- Update and release process: [`docs/versioning-and-updates.md`](docs/versioning-and-updates.md)
- Chat stability model (presence heartbeat, first-catch routing): [`docs/chat-presence-calls.md`](docs/chat-presence-calls.md)
- Admin update advisor endpoints:
  - `GET /api/admin/system/update/status`
  - `POST /api/admin/system/update/preflight`
  - `GET /api/admin/system/update/runbook`
  - `GET /api/admin/system/update/history`

## Repository Layout | Repository-Struktur

```text
backend/   -> API, business logic, migrations, realtime, integrations
frontend/  -> citizen-facing frontend
admin/     -> administrative control frontend
ops/       -> mobile-first staff operations frontend
docs/      -> operational and release documentation
nginx/     -> reverse proxy configuration
xmpp/      -> ejabberd configuration
```

## Ownership and Responsibility | Verantwortlichkeit

**Project Owner / Projektverantwortung**  
Dominik Troester  
Digitalbeauftragter, Verbandsgemeinde Otterbach-Otterberg

**Project Character / Projektcharakter**  
EN: Public-sector software initiative with single-owner execution and continuous operational evolution.  
DE: Verwaltungsnahes Softwareprojekt mit Ein-Personen-Verantwortung und kontinuierlicher Weiterentwicklung im Betrieb.

## Public Repository Readiness | Public-Repository-Readiness

Before switching repository visibility from private to public:

1. Verify that secrets are not tracked (`.env*`, private keys, local notes, ad-hoc scripts).
2. Confirm branch protection is active on `main`.
3. Ensure release tag and release notes are created for the published state.
4. Validate build and core runtime checks once more on the tagged commit.

## License

Apache License 2.0 - see [`LICENSE`](LICENSE)
