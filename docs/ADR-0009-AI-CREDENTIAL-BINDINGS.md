# ADR-0009 – Mandanten- und verbindungsgebundener KI-Credential-Resolver

**Datum:** 06.11.2026 · **Status:** implementierter, isolierter K03-Baustein zur Review (PR #100) · **Arbeitspaket:** [K03 #75](https://github.com/derdigitalaffine/behebes-ai/issues/75).

## Problem

Eine Datenbankverbindung mit bloßer `credentialRef` schützt noch nicht davor, dass ein anderer Tenant, ein anderer Provider oder eine andere Verbindung einen gültigen Secret-Verweis verwendet. Zusätzlich müssen Secret-Rotation und Fehlerbehandlung ohne Credential-Logging möglich sein.

## Entscheidung und Datenfluss

1. Vertrauenswürdige Serverkonfiguration erzeugt ausschließlich explizite `AiCredentialBinding`-Datensätze: **Ref, Tenant, Provider, Connection und genehmigter Secret-Name**. Die Bindung ist **niemals** aus einem Client-Request, URL-Pfad oder ungeprüften Model Catalog abzuleiten.
2. Die `AiCredentialResolver`-Schnittstelle erhält nun bei jedem Lookup den serverseitig verifizierten **Tenant-, Provider- und Connection-Kontext**. Eine fehlende oder ungleiche Identität führt zu `null` und **keinem Zugriff auf den Secret Store**.
3. Der Resolver akzeptiert nur normierte Referenzen der Form `ai-provider/<id>` und ausdrücklich konfigurierte Secret-Namen mit Präfix `AI_PROVIDER_`. Doppelte Referenzen sind bei der Initialisierung **verboten**. Bindings werden kopiert, damit nachträgliche Mutation keinen anderen Secret-Key zulässt.
4. Die Secret-Quelle wird über eine kleine `AiSecretReader`-Schnittstelle eingebunden. Ein konkreter **Environment-Adapter** liest ausschließlich explizit gebundene Env-Keys; ein verwalteter Secretmanager kann zukünftig einen eigenen Reader bereitstellen. Der Resolver speichert Tokens **nicht in einem zusätzlichen Cache**; ein Reader kann bei Folgelookups einen rotierten Wert liefern.
5. Ungültige/leere Credentials, Steuerzeichen, übergroße Werte und Secret-Service-Fehler werden **fail closed** als `null` behandelt. Das KI-Gateway verwandelt dies in einen konstanten, redigierten Fehler. Keine Tokens, Backend-URLs oder Secret-Service-Causes werden übertragen.

## Rotations- und Betriebsgrenzen

- **Prozessumgebungsvariablen werden in laufenden Containern nicht automatisch von außen aktualisiert.** Der Environment-Adapter erhält neue Werte in der Praxis meist beim sicheren Neustart/Redeployment. Für unterbrechungsarme Rotation ist ein genehmigter Managed-Secret-Reader (K03-Fortsetzung) mit Revision/Audit und ggf. Token-Overlap erforderlich. Die Lesestrategie allein belegt noch keine produktive Rotation.
- Das Gateway entscheidet zuerst Tenant-/Task-/Region-/Datenklasse und freigegebenes DNS-/IP-Ziel; **erst danach** wird die Secret-Referenz aufgelöst.
- Der Resolver autorisiert **keine** Bürger-/Sachbearbeitungsaktion selbst und ersetzt keine RBAC-Middleware, Datenschutzprüfung, DPA, PII-Redaktion, Netzwerk-Egress-Firewall oder konfigurationsseitige Adminfreigabe.
- Das bestehende LLM-Hub-, Queue- und Legacy-Secretmodell bleibt **unverändert**. Es gibt keine Migration, keine Live-Provider-Calls und kein Deployment in diesem PR.

## Abnahme und Tests

Synthetische Unit-Tests decken Tenant-/Provider-/Connection-Wechsel, unbekannte oder manipulierte Referenzen, nicht zugelassene Env-Keys, doppeltes Binding, Tokenformat, Lesefehler, nachträgliche Bindings-Mutation und kontrollierte Wertänderung ab. Ein Gateway-Integrationstest zeigt **keinen Secret-Read bei anderer Connection**, auch wenn Tenant/Task sonst gültig sind.

**Vor Produktivmigration:** verwaltete Credential-Speicherung mit Schutz ruhender Daten und Rotation, prüffähiger Admin-/Tenant-RBAC, Audit, Migrationsadapter für bestehendes `llmHub`/OAuth, Secret-Scrubbing in Logs/Backups, Betriebshandbuch und unabhängiger Security-/Datenschutzreview.

[KI-Backend-Zielbild](AI_BACKENDS.md) · [ADR-0008](ADR-0008-AI-PINNED-EGRESS.md) · [K03 #75](https://github.com/derdigitalaffine/behebes-ai/issues/75).
