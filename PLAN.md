# Masterplan v5: Globale Bibliotheken + Tenant-Overrides, erweitertes RBAC, tenantbezogene KI-Analysen, nicht-anonymes Feedback

## Kurzfassung
1. Rollenmodell bleibt hierarchisch: `PLATFORM_ADMIN` > `TENANT_ADMIN` > `ORG_ADMIN` > `SACHBEARBEITER`.
2. `Kategorien`, `E-Mail-Templates`, `Workflow-Definitionen` werden als **globale Plattformbibliothek** plus **tenant-spezifische Bibliothek** geführt.
3. Tenant-Overrides sind erlaubt, mit **kein Auto-Merge** bei globalen Änderungen; stattdessen „Upstream geändert“-Hinweis + manuelle Übernahme.
4. Menü-/API-Zugriffe werden capability-basiert, inkl. Platform-Admin-Kontextschalter (`global`/`tenant`).
5. `KI-Modelle`, `KI-Provider`, `Systemprompts` nur für Platform-Admins.
6. `KI-Analysen/Lagebild` ausschließlich tenantbezogen (kein globaler Sammelreport), Platform-Admins wechseln tenantweise.
7. `SMTP/IMAP` global konfigurierbar, aber **volle Tenant-Override-Freiheit**.
8. Feedback wird **nicht anonym**, dauerhaft gespeichert (inkl. Freitext), rollenbasiert sichtbar nach Scope.
9. Tenantprofil wird um vollständigen Firmendatensatz erweitert.

## Menü-Zielbild (final abgestimmt)

| Bereich | Platform Admin | Tenant Admin | Orga Admin | Sachbearbeiter |
|---|---|---|---|---|
| Dashboard, Tickets, Karte, Workflows, Interne Aufgaben | RW global/tenant | RW tenant | RW scope | RW zugewiesen/scope |
| Statistiken inkl. Feedback | RW global/tenant | RW tenant | R scope | R basis |
| Mail Queue, Mailbox | RW global/tenant | RW tenant | RW fachlich | R/Teilaktionen |
| KI Queue | RW global/tenant | RW tenant | R scope | R |
| Benutzer, Registrierungen, Sessions | RW global | RW tenant | - | - |
| API-Tokens | RW global/tenant | RW tenant | - | - |
| Organisation & Mandanten | RW global | RW eigener Tenant | R/teilw. Fachsicht | - |
| Kategorien | RW global + tenant | RW tenant | RW fachlich | R |
| E-Mail-Templates | RW global + tenant | RW tenant | RW fachlich (nur tenant) | R |
| Workflow-Definitionen | RW global + tenant | RW tenant | RW fachlich (nur tenant) | R |
| KI-Einstellungen (Provider/Modelle/Systemprompts) | RW | R (tenant routing nur dort wo freigegeben) | - | - |
| KI-Lagebild / KI-Analysen | tenantweise RW | tenantweise RW | scope-R | - |
| SMTP/IMAP | RW global + tenant override | RW tenant override | - | - |
| Plattform-Blog | RW | - | - | - |
| Profil/Avatar | RW | RW | RW | RW |

## Public APIs / Interfaces / Typen

### 1) Access Context + Kontextschalter
1. `GET /api/admin/me/access-context`
- `effectiveRole`
- `capabilities[]`
- `tenantIds[]`, `tenantAdminTenantIds[]`, `orgScopes[]`
2. Kontextheader:
- `X-Admin-Context-Mode: global|tenant`
- `X-Admin-Context-Tenant-Id: <id>`

### 2) Shared Content (global + tenant)
1. Neue Scope-Parameter für Listen/Details:
- `scope=platform|tenant`
- `tenantId=<id>` (bei tenant scope)
2. Einheitliches Metamodell für Kategorien/Templates/Workflows:
- `originScope`, `originId`, `tenantId`, `isOverride`, `upstreamVersion`, `upstreamChanged`
3. Rebase-Endpoints:
- `POST /api/admin/<domain>/:id/rebase-from-upstream`
- `POST /api/admin/<domain>/:id/create-tenant-override`

### 3) SMTP/IMAP mit Tenant-Overrides
1. Global:
- `GET/PATCH /api/admin/config/smtp`
- `GET/PATCH /api/admin/config/imap`
2. Tenant:
- `GET/PATCH /api/admin/tenants/:tenantId/config/smtp`
- `GET/PATCH /api/admin/tenants/:tenantId/config/imap`
3. Effective Read:
- `GET /api/admin/tenants/:tenantId/config/email/effective`

### 4) KI-Schnitt
1. Nur Platform-Admins:
- `GET/POST/PATCH/DELETE /api/admin/llm/connections`
- `GET/PATCH /api/admin/llm/task-routing`
- `GET/PATCH /api/admin/prompts/system`
2. Tenantbezogene Analysen:
- `POST /api/admin/tenants/:tenantId/ai/situation-report`
- `GET /api/admin/tenants/:tenantId/ai/situation-report/history`
- `GET /api/admin/tenants/:tenantId/ai/situation-report/latest`

### 5) Feedback (nicht anonym)
1. Neuer Step-Typ:
- `CITIZEN_FEEDBACK`
2. Public:
- `GET /api/workflows/feedback/:token`
- `POST /api/workflows/feedback/:token`
3. Admin:
- `GET /api/admin/feedback`
- `GET /api/admin/feedback/analytics`
- Filterbar nach tenant/workflow/kategorie/orga/zeitraum

### 6) Tenantprofile
1. `GET/PATCH /api/admin/tenants/:tenantId/profile`
2. Felder:
- `legalName`, `displayName`, `street`, `houseNumber`, `postalCode`, `city`, `country`
- `generalEmail`, `supportEmail`, `phone`, `homepage`
- `responsiblePersonName`, `responsiblePersonRole`, `responsiblePersonEmail`, `responsiblePersonPhone`
- `vatId` (optional), `imprintText` (optional), `privacyContact` (optional)

## Datenmodell / Migrationen

### 1) Shared-Content-Basis
1. Für `categories`, `email_templates`, `workflow_templates` je erweitern:
- `scope` (`platform|tenant`)
- `tenant_id` nullable
- `origin_id` nullable
- `is_override` bool
- `upstream_version` int
- `version` int
2. Indizes:
- `(scope, tenant_id, updated_at)`
- `(origin_id, tenant_id)`

### 2) Upstream-Change-Tracking
1. Bei Plattform-Objektänderung:
- `version++`
2. Tenant-Override zeigt `upstreamChanged=true`, wenn `upstream_version < platform.version`.

### 3) SMTP/IMAP Overrides
1. Neue Tabelle `tenant_settings_email`:
- `tenant_id`, `smtp_json`, `imap_json`, `updated_at`, `updated_by`
2. Effective Resolve:
- tenant override -> global default -> env fallback.

### 4) Feedback persistent & zuordenbar
1. `citizen_feedback_events`:
- `id`, `tenant_id`, `ticket_id`, `workflow_execution_id`, `workflow_task_id`, `citizen_account_id`
- `rating`, `comment_text`, `channel`, `language`, `created_at`, `updated_at`
2. Keine TTL-Löschung für Kommentare.

### 5) Tenantprofile
1. `tenants` ergänzen oder `tenant_profiles` einführen (empfohlen):
- vollständiger Firmendatensatz wie oben
2. `tenant_profiles.tenant_id` unique FK.

## UI/UX Umsetzungsplan

### 1) Settings-Browser (hierarchisch)
1. Einheitliches Browser-Widget für `Templates`, `Workflows`, `Kategorien`.
2. Tree-Struktur:
- `Plattformbibliothek`
- `Tenantbibliothek (<Tenant>)`
3. Knoten-Badges:
- `Global`
- `Tenant`
- `Override`
- `Upstream geändert`
4. Aktionen:
- „Als Tenant-Override übernehmen“
- „Mit Upstream neu abgleichen“
- „Override lösen / zurück auf Upstream“

### 2) KI-Bereich
1. `KI-Einstellungen` zeigt Provider/Modelle/Prompts nur Platform-Admins.
2. Tenant-Admins sehen nur tenantbezogene KI-Analyse-Ansichten und tenantbezogene Ergebnisse.
3. Platform-Admins wählen Tenant-Kontext im Header, Analysen laufen immer in diesem Tenant.

### 3) SMTP/IMAP Bereich
1. Seite bekommt Scope-Switch:
- Global Defaults
- Tenant Override
2. Anzeige „effektive Werte“ mit Herkunftstag (`global`, `tenant`, `env`).

### 4) Tenantprofil
1. Neuer Tab in `Organisation & Mandanten`: `Tenantprofil`.
2. Vollständiges Stammdatenformular, Validierung, Vorschau für öffentliche Verwendung.

## Implementierungsphasen

1. RBAC/Capability-Basis finalisieren + Menü-Rendering capability-basiert.
2. Shared-Content-Datenmodell + APIs + Rebase/Override-Logik.
3. Hierarchische Browserkomponente in drei Settings-Bereichen integrieren.
4. SMTP/IMAP tenant overrides Backend + UI.
5. KI-Bereich trennen: platform-only Settings vs tenant-only Analysen.
6. Tenantprofil-Datenmodell + API + UI.
7. Feedback-Step + Public Seite + persistente Detailspeicherung + Analytics.
8. OpenAPI/Swagger vollständig nachziehen.

## Testfälle und Abnahme

### A. Shared Content
1. Platform-Objekt ist in allen Tenants sichtbar.
2. Tenant kann Override erstellen.
3. Globales Update markiert Override als `upstreamChanged`.
4. Kein Auto-Merge; manuelle Rebase-Funktion arbeitet korrekt.

### B. Menü/RBAC
1. Jeder Menüpunkt wird für alle Rollen geprüft.
2. Tenant-Admin sieht nur eigenen Tenant.
3. Orga-Admin sieht nur scope-relevante Funktionsbereiche.

### C. SMTP/IMAP
1. Global-only Setup funktioniert.
2. Tenant Override überschreibt korrekt.
3. Effective-Werte entsprechen Fallback-Reihenfolge.

### D. KI
1. Provider/Modelle/Systemprompts nur Platform-Admin erreichbar.
2. KI-Analysen nur tenantbezogen ausführbar/abrufbar.
3. Kein globaler Sammelreport verfügbar.

### E. Feedback
1. Feedback-Step erzeugt tokenisierte öffentliche Erfassung.
2. Sterne + Freitext dauerhaft gespeichert.
3. Detailsicht folgt Rollen-/Scope-Regeln.

### F. Tenantprofil
1. Vollständige Stammdaten CRUD.
2. Validierung für Mail, URL, Pflichtfelder.
3. Daten in relevanten UI-Views korrekt eingebunden.

### G. Routing/PWA/Callbacks
1. Alle Callbacktypen funktionieren in beiden Root-Modi.
2. Magic-Link Login bleibt tenant-korrekt.
3. PWA-Scopes und Redirects bleiben konsistent.

## Annahmen und Defaults
1. `tenantBasePath` bleibt `/c`.
2. Shared Content: kein Auto-Merge, nur manuelle Rebase.
3. SMTP/IMAP Tenant-Overrides sind vollständig erlaubt.
4. KI-Analysen sind strikt tenantbezogen.
5. Feedback ist dauerhaft, person-/ticketzuordenbar.
6. Hierarchische Browser sind Standard-UX in Templates/Workflows/Kategorien.
