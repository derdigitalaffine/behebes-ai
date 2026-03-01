# CHANGELOG / AENDERUNGSPROTOKOLL

All notable changes to this project are documented in this file.
Alle wichtigen Aenderungen an diesem Projekt werden in dieser Datei dokumentiert.

The format is inspired by Keep a Changelog and follows Semantic Versioning.
Das Format orientiert sich an Keep a Changelog und folgt Semantic Versioning.

## [Unreleased] / [Unveroeffentlicht]

### Added / Hinzugefuegt
- DE: OpenAPI/Swagger um Chat-Presence-, Heartbeat- und Call-Session-Endpunkte erweitert.
  EN: Extended OpenAPI/Swagger with chat presence, heartbeat, and call-session endpoints.
- DE: Neue Betriebsdoku fuer Chat-Stabilitaet und Call-Routing unter `docs/chat-presence-calls.md`.
  EN: New operational documentation for chat stability and call routing in `docs/chat-presence-calls.md`.

### Changed / Geaendert
- DE: Ops-Dashboard mobile-first fuer Touch-Bedienung (groessere Targets, klarere Primaraktionen, kompaktere Karten).
  EN: Refined Ops dashboard mobile-first for touch usability (larger targets, clearer primary actions, denser cards).
- DE: Globaler CSS-Feinschliff im Admin-Frontend fuer konsistentere Oberflaeche.
  EN: Global CSS polish in the admin frontend for stronger visual consistency.

## [v1.0.2a] - 2026-03-01

### Changed / Geaendert
- DE: Release-Inkrement fuer den aktuellen Integrationsstand auf `main`.
  EN: Release increment for the current integration state on `main`.

## [v1.0.2] - 2026-03-01

### Added / Hinzugefuegt
- DE: Vollstaendiger Import-/Keywording-Stack fuer Leistungen, Organisation und Benutzer inkl. API-Erweiterungen.
  EN: Full import/keywording stack for services, organization, and users including API extensions.
- DE: Verwaltungs-Zustaendigkeitslogik und interne Aufgaben-End-to-End-Flow.
  EN: Administrative responsibility logic and internal-task end-to-end flow.
- DE: Versionskennzeichnung in Frontend, Admin und OPS.
  EN: Version labeling across frontend, admin, and OPS.

### Changed / Geaendert
- DE: Plattform-Landingpage umfassend modernisiert, inkl. kompakterer Blog-Einbindung.
  EN: Platform landing page significantly redesigned, including a more compact blog integration.
- DE: SmartTable-Konsistenzwelle fuer zentrale Admin-Bereiche (u. a. Aufgaben/Organisation).
  EN: SmartTable consistency wave across key admin areas (including tasks/organization).
- DE: Dokumentation und Quickstart auf den aktuellen Betriebs-/Release-Stand aktualisiert.
  EN: Documentation and quickstart updated to the latest operational/release state.

### Fixed / Behoben
- DE: XMPP/ejabberd Host-Makroabgleich und Credential-Defaults korrigiert.
  EN: Fixed XMPP/ejabberd host macro alignment and credential defaults.
- DE: Chat-Call-Audioausgabe gehaertet (inkl. Sink-Fallback).
  EN: Hardened chat-call audio output handling (including sink fallback).

### Security & Governance / Sicherheit & Governance
- DE: Repository-Hygiene verbessert (lokale Utility-/Notizdateien aus Git-Tracking entfernt).
  EN: Improved repository hygiene (local utility/note files removed from Git tracking).

## [v1.0.1] - 2026-03-01

### Added / Hinzugefuegt
- DE: Backup-Flow in den Update-Advisor-Preflight integriert.
  EN: Backup flow integrated into update advisor preflight.

### Changed / Geaendert
- DE: Build-/Versionsmetadaten und Status-Typisierung fuer Update-Checks gehaertet.
  EN: Hardened build/version metadata and status typing for update checks.

### Docs / Dokumentation
- DE: Wartungs- und Backup-Artefaktfluss dokumentiert.
  EN: Maintenance and backup artifact flow documented.

## [v1.0.0] - 2026-03-01

### Added / Hinzugefuegt
- DE: Baseline-Release mit initialer, versionierter Projektbasis.
  EN: Baseline release with an initial, versioned project foundation.

### Changed / Geaendert
- DE: Laufzeit-/Build-Artefakte aus dem Git-Baseline-Stand bereinigt.
  EN: Runtime/build artifacts cleaned from the Git baseline state.

---

## Links
- [Unreleased]: https://github.com/derdigitalaffine/behebes-ai/compare/v1.0.2a...HEAD
- [v1.0.2a]: https://github.com/derdigitalaffine/behebes-ai/compare/v1.0.2...v1.0.2a
- [v1.0.2]: https://github.com/derdigitalaffine/behebes-ai/compare/v1.0.1...v1.0.2
- [v1.0.1]: https://github.com/derdigitalaffine/behebes-ai/compare/v1.0.0...v1.0.1
- [v1.0.0]: https://github.com/derdigitalaffine/behebes-ai/releases/tag/v1.0.0
