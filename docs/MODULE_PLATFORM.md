# Zielarchitektur: Modulplattform und sichere Feature Controls

**Status:** Geplante Architektur, nicht als implementiert behaupten. Ausgangspunkt ist ein modularer Monolith (Express/TS + MySQL + drei React-Clients) mit bestehenden berechtigungsrelevanten Diensten, Workflows und Tenant-/Org-Kontexten.

## Grundentscheidung

**Kein Microservice-Programm.** Zuerst saubere Fachmodule und getestete Verträge im bestehenden Backend. Module sind **bounded contexts**, nicht nur Navigationsgruppen. Ein Modul besitzt: fachliche Aufgabe, Datenhoheit, API-Vertrag, Kommandos/Events, optionalen Hintergrundjob, UI-Punkte, Berechtigungs-/Datenschutzregeln, Abhängigkeiten, Health und Lifecycle.

Der sichere Kern bleibt stets aktiv: Identity/Session, Tenant/Org, serverseitiges RBAC, Audit, Konfigurationskontrolle, Mindest-Ticket-/Intake-Fähigkeiten, Migration/Backup/Recovery. Ob Bürgerintake zu einem verpflichtenden Kern gehört, ist für jede Installationsform per ADR zu konkretisieren; niemals dürfen Sicherheitsfunktionen abgeschaltet werden.

## Modulklassen

| Klasse | Beispiele | Standardfrage |
| --- | --- | --- |
| Plattformkern | Auth, Tenant, RBAC, Audit, Konfiguration, Pflicht-Health | immer aktiv, nie im Tenant abschaltbar |
| Fachkern | Tickets/Intake, Ticketzuordnung, Workflows | kann in einem definierbaren Betriebsprofil erforderlich sein |
| Optionales Fachmodul | GIS, Statistik, interne Aufgaben, Importe, Servicekatalog | kann Tenant-Modul sein, braucht klare Off-Semantik |
| Optionale Integration | Redmine, SMTP/IMAP, XMPP, KI-Provider, Wetter/Geocoder | off oder degradiert ohne Kern-Blocking |
| Client-Präsentation | Bürger, Admin, OPS, Quick Actions, Suche | UI hängt von erlaubten Server-Capabilities ab |

## Manifestvertrag (Beispiel, keine produktive Konfiguration)

```ts
interface ModuleManifest {
  id: string;                  // stabile ID, z. B. "geo"
  version: string;             // SemVer / Kompatibilitätsfenster
  displayNameKey: string;      // i18n, niemals einzige ID
  kind: 'core' | 'feature' | 'integration';
  dependsOn: string[];
  requiredCapabilities: string[];
  scopes: Array<'platform' | 'tenant'>;
  routes: string[];            // serverseitig gewählte Guards
  jobs: string[];              // eindeutig zuordenbare Worker
  eventsPublished: string[];
  eventsConsumed: string[];
  dataOwner: string;
  disablePolicy: 'drain' | 'readonly' | 'pause';
  migrationRef: string | null;
}
```

Metadaten dienen **nicht** als Mechanismus zum Laden beliebigen Codes aus Nutzereingaben. Ein geprüftes Register bindet statisch implementierte Module an bekannte Schnittstellen. Defaultmodule und Bestehende-Tenant-Migration müssen getrennt festgelegt werden.

## Effektiver Aktivierungs-/Berechtigungszustand

```text
allowed =
  deployment_has_capability
  AND platform_allows_module
  AND tenant_enabled_module
  AND dependencies_active
  AND actor_has_required_permissions
  AND actor_in_valid_tenant_and_org_scope
```

Zwischen **lizenziert/verfügbar**, **aktiviert**, **konfiguriert/gesund** und **für diesen Nutzer erlaubt** unterscheiden. Eine deaktivierte Integration darf weder über API, Hintergrundjob noch durch alten Deep-Link aktiv werden. Plattform-/Tenant-Konfiguration sind revisionsfähig, Autorisierungsentscheidung ist serverseitig und bei sensiblen Aktionen aktuell (stale Clientzustand nie Vertrauensquelle).

## Aktivieren und Deaktivieren

1. **Vorschau:** Konsequenzen bei aktiven Workflows, offenen Jobs, bestehenden Datensätzen, gespeicherten Nutzeransichten und externen Notifications zeigen.
2. **Dependency Gate:** Vor erforderlichen Abhängigkeiten und verbotenen Kombinationen warnen/blockieren. Kein Aktivieren ohne erforderliche Credentials/Setup-/Healthprüfung.
3. **Versionierung:** Änderung mit Actor, Timestamp, Tenant/Org, altem/neuem Zustand auditieren. Konflikte/gleichzeitige Admins mit Version/409 behandeln.
4. **Quiesce:** Für laufende Arbeit explizite `drain`, `pause` oder `readonly`-Strategie; nie still verwerfen, löschen oder externe Aktion verdoppeln.
5. **UI:** Navigationspunkte, Formulare, Quick Actions, Suchprovider und Deep-Links zeigen den effektiven Status. Fehlende Rechte und fehlende Module sind unterschiedliche Meldungen.
6. **Reaktivieren:** Kompatible Jobs/Events/Versionsstände prüfen, nötige Migrationen und Berechtigungen re-evaluieren; ggf. menschliche Freigabe.
7. **Testmatrix:** Plattform-Admin, Tenant-Admin, Sachbearbeitung, OPS, Bürger, an/aus, fehlende Dependency, offene Queue, Cross-Tenant, Offline-/stale Session, 403/404/409.

## Daten- und Eventgrenzen

- Ein Domänenereignis besitzt schemaVersion, eventId, occurredAt, tenantId, orgContext, actor/Correlation, minimalen payload ohne unnötige PII.
- Transactional Outbox oder gleichwertiger zustandsfester Mechanismus für kritische externe Side Effects.
- Empfänger sind idempotent, greifen nur auf aktuell autorisierte Tenant-/Org-Daten zu.
- Keine impliziten gemeinsamen Tabellenabfragen durch fremde Module; Query/Service-Grenzen mit Schnittstellengate.
- Große Hotspots werden vertikal extrahiert: `backend/src/routes/workflows.ts`, `backend/src/routes/admin.ts`, `backend/src/services/settings.ts`, `admin/src/pages/WorkflowSettings.tsx`.

## Einführung in Stufen

**1.** Modul-/Abhängigkeitsinventar, ADR, technische Contracts, Baseline Tests → **2.** Registry ohne dynamisches Abschalten → **3.** Flag-Resolution und Tenant-API für ein risikoarmes Modul → **4.** Pilotmodul samt Admin-Verwaltung, Clientroute, Negativ-/Off-Tests → **5.** mehr Fachmodule; nur danach Legacy-Entkopplung.

**Rollback:** Bestehende Daten bleiben, Codepfad über Featureflag zurückschaltbar, Migrationen vorwärtskompatibel; Protokoll und Alert nach Fehlumschaltung.

[Detailarbeitspakete M01–M08](../planning/roadmap-issues.json) · [Sicherheitsprofil](SECURITY_PRIVACY.md)
