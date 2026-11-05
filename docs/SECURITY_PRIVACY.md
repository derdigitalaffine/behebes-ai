# Sicherheits-, Datenschutz- und KI-Leitplanken

**Anwendungskontext:** kommunale Bürgeranliegen und Verwaltungsaufgaben. Dieses Dokument ist ein Engineering-Sicherheitsprofil, **keine** Rechtsberatung, Auditbestätigung oder Datenschutz-Folgenabschätzung.

## Schutzgüter und Angriffsflächen

Schutzgüter: Bürgerkontaktdaten, Meldungsinhalt und Anhänge/Geokoordinaten, Verwaltungsrollen/-zuständigkeiten, interne Kommunikation, Exporte, API-Tokens, Mail-/XMPP-/KI-Credentials, Migrationen/Backups. Angriffsflächen: öffentlicher API-Eingang, Login/Registrierung, Upload, Mandanten-/Rollenwechsel, Workflow-Freigaben, E-Mail-/Provider-Aufrufe, XMPP/WebRTC, Importdateien, Admin-Einstellungen, Offline-Persistenz und Logs.

## Verbindliche Kontrollen

### Authentisierung / Autorisierung / Tenant

- Serverseitige Entscheidungen für jeden API-Aufruf; ein UI-Guard zählt nicht.
- Den Tenant-Kontext aus verifizierter Identität/Sitzung ableiten und zusätzlich Org-/Capability-Scopes prüfen.
- Negativtests: ohne Auth, falsche Rolle, fremder Tenant, fremde Org, alter/entwerteter Token, ungültiger Scope, direkt aufgerufene API ohne UI.
- Exporte, Suche, Verlauf, SSE-Events und Push-Nachrichten unterliegen denselben Grenzen.
- Admin- oder Plattformrolle darf nicht ungeprüft auf Bürgerdaten anderer Mandanten zugreifen.

### Eingaben und Dateien

- Request-/Upload-Größen und erlaubte Medientypen serverseitig prüfen; Erweiterung/MIME-Header allein nicht vertrauen.
- Keine hochgeladenen Dateien unter einem ungeschützten statischen Webpfad veröffentlichen.
- Namen/Dateipfade normalisieren; schädliche HTML-/CSV-/Formel-/Markdown-Eingaben kontextsicher darstellen/exportieren.
- EXIF-/GPS-Verwendung und Speicherung minimieren; Aufbewahrung/Löschung fachlich festlegen.

### Secrets und Betriebsdefaults

- In `docker-compose.yml` und `docker-compose.prod.yml` sind Fallback-Zugangsdaten wie `change-root-password`, `behebes`, `change-this-in-production` enthalten: für Produktionsbetrieb **nicht akzeptabel**.
- Vor produktivem Start eindeutige Secrets und explizite Umgebungsvariablen verlangen; Secret-Rotation und bestehende Datenbankeinträge beim Härten berücksichtigen.
- `.env.local`, Datenbank-/XMPP-/SMTP-Schlüssel und Backups niemals committen, loggen oder an LLM-Provider senden.
- `EXPRESS_TRUST_PROXY`/CORS/Header/HTTPS nur nach realem Proxy-Pfad einstellen; Debug-/Docs-/Health-Endpunkte risikobewerten.

### Datenschutz in KI-Workflows

- Bürger- und interne Fachtexte gelten als untrusted; enthaltene Anweisungen dürfen niemals System-/Developer- oder Toolrechte überschreiben.
- Externe Provider nur mit definierter Zweck-/Daten-/Löschgrundlage; Daten minimieren, ggf. pseudonymisieren.
- KI-Ausgaben vor Persistenz/Aktion validieren: Format, fachliche Plausibilität, erlaubte Werte, Tenant, Zuständigkeit.
- **Keine automatischen außenwirksamen Entscheidungen** (Benachrichtigung, Zuweisung, Löschung, Freigabe) allein aufgrund einer generativen Antwort.
- Logs enthalten Korrelation/Zustand statt Rohprompts oder Kontaktdaten; Replay nur mit synthetischen Fixtures.
- Provider-Ausfall/Timeout/Rate-Limit muss zu sichtbarem Fehler oder klarer manueller Bearbeitung führen.

### Änderungen an Daten und Audit

- Fachliche Historie ist nicht Audit-Log. Status-/Rechte-/Freigabeänderungen erhalten nachvollziehbare Actor-/Zeit-/Objekt-Referenz.
- Destruktive Schritte mit Bestätigung, Rückfallplan und ggf. Vier-Augen-Freigabe.
- Migrationen unveränderlich und reproduzierbar; Backups werden regelmäßig **wiederhergestellt getestet**.

## P0-Sicherheits-Abnahmematrix

| Szenario | Erwartung |
| --- | --- |
| Fremder Tenant liest Ticket/Anhang/Stream | 403 oder 404, keine Metadaten preisgeben |
| Mitarbeiter ohne Capability startet Admin-Aktion | serverseitig abgelehnt und sicher protokolliert |
| KI-Antwort enthält Prompt-Injection oder falsches Toolziel | keine Aktion; Validierung/Fallback |
| Queue-Job wird doppelt verarbeitet | idempotentes Ergebnis, keine doppelte Mail/Aktion |
| Unsichere Compose-Defaults ohne gesetzte Produktions-Secrets | Start blockiert oder dokumentierter sicherer Erstkonfigurationsmodus |
| Restore eines getrennten Testsnapshots | vollständige Wiederherstellung und verifizierte Kernflüsse |
| Export eines unbefugten Objekts | keine Datenrückgabe, keine Nebenkanal-Information |

## Meldeweg und Incident-Grundregeln

Bei potenziellem Datenabfluss: keine echten Datensätze in öffentlichen Issues posten; im autorisierten Sicherheitskanal melden, Zugriff begrenzen, Zeitachse/Logs geschützt sichern, Auswirkungen prüfen, fachlich Verantwortliche hinzuziehen. Rechtliche Meldefristen anhand des konkreten Vorfalls beurteilen. Kein Agent kommuniziert eigenständig Behörden/Bürger oder veröffentlicht Sicherheitsdetails.

## Offene Prüfungen

Erforderlich sind aktuelle Datenfluss-/Löschkonzepte, SAST/Dependency-/Secret-Scans, Pen-Test/Review für Upload/Dateiabruf, Probe der RBAC-/Tenant-Trennung, KI-Datenflussfreigaben, PWA-/Offline-Datenschutz und Secret-Rotation. **Status: nicht durch die Erstellung dieser Doku nachgewiesen.**
