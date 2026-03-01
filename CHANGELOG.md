# CHANGELOG / AENDERUNGSPROTOKOLL

All notable changes to this project are documented in this file.
Alle wichtigen Aenderungen an diesem Projekt werden in dieser Datei dokumentiert.

The format is inspired by Keep a Changelog and follows Semantic Versioning.
Das Format orientiert sich an Keep a Changelog und folgt Semantic Versioning.

## [Unreleased] / [Unveroeffentlicht]

### Changed / Geaendert
- DE: Laufende Weiterentwicklung fuer Messenger-Stabilitaet, Mobile-UX und Admin-Konsistenz.
  EN: Ongoing development for messenger stability, mobile UX, and admin consistency.

## [v1.0.6] - 2026-03-01

### Added / Hinzugefuegt
- DE: Ticket-PDF-Auszug erweitert um OPS-Deep-Link inkl. QR-Code fuer direkten App-Einstieg.
  EN: Extended ticket PDF export with an OPS deep link including QR code for direct app entry.
- DE: Chat-Call-Session-Erweiterung fuer Medienstatus (Audio/Video), Client-Connection-Tracking und Endgruende.
  EN: Extended chat call sessions with media state (audio/video), client-connection tracking, and end reasons.

### Changed / Geaendert
- DE: SMTP/IMAP-Einstellungen, E-Mail-Templates und IMAP-Postfach im Admin konsistent auf MUI-/SmartTable-Design umgestellt.
  EN: Consolidated SMTP/IMAP settings, email templates, and IMAP mailbox in admin to a consistent MUI/SmartTable design.
- DE: Weitere Admin-Seiten auf den einheitlichen SmartTable-/AdminSurface-Standard gehoben (u. a. Dashboard, Logs, Sessions, Analytics).
  EN: Brought additional admin pages to the unified SmartTable/AdminSurface standard (including dashboard, logs, sessions, analytics).

### Fixed / Behoben
- DE: Realtime-/Messenger-Stabilitaet verbessert (401/403-Handling, robustere Reconnect-Logik, idempotentes Call-Release ohne 404-Rauschen).
  EN: Improved realtime/messenger stability (401/403 handling, more robust reconnect logic, idempotent call release without 404 noise).
- DE: Chat-Overlay in Admin und OPS gegen Send-Fehler bei schliessender Verbindung gehaertet.
  EN: Hardened admin and OPS chat overlays against send errors when the connection is closing.

## [v1.0.3] - 2026-03-01

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
- [Unreleased]: https://github.com/derdigitalaffine/behebes-ai/compare/v1.0.6...HEAD
- [v1.0.6]: https://github.com/derdigitalaffine/behebes-ai/compare/v1.0.5...v1.0.6
- [v1.0.3]: https://github.com/derdigitalaffine/behebes-ai/compare/v1.0.2a...v1.0.3
- [v1.0.2a]: https://github.com/derdigitalaffine/behebes-ai/compare/v1.0.2...v1.0.2a
- [v1.0.2]: https://github.com/derdigitalaffine/behebes-ai/compare/v1.0.1...v1.0.2
- [v1.0.1]: https://github.com/derdigitalaffine/behebes-ai/compare/v1.0.0...v1.0.1
- [v1.0.0]: https://github.com/derdigitalaffine/behebes-ai/releases/tag/v1.0.0
