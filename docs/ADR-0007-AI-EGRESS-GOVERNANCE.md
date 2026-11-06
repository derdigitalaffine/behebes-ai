# ADR-0007 – KI-Provider: Tenant-Freigabe vor Secrets und Netzverkehr

**Datum:** 06.11.2026. **Status:** isolierter Implementierungs-PR, Architektur-/Datenschutz-/Security-Review noch ausstehend. **Arbeitsaufträge:** K03 #75, K07 #79, K16 #88.

## Ausgangslage

Der bestehende LLM-Hub und die KI-Queue verwenden eigene Connection-Einstellungen und Providerclients. Der isolierte K02-Chatadapter prüfte bisher HTTPS-Origin und Modellfähigkeiten, aber noch nicht verbindlich, welcher Tenant mit welcher Datenklasse an welchen Provider senden darf. K03/K07/K16 müssen vor einem produktiven Routing-Wechsel zusammen geprüft werden.

## Eingeführte sichere Verträge

1. **K07: Statische Endpoint-Schutzprüfung** in ai-provider-endpoint.ts. Zugelassen sind nur explizit freigegebene HTTPS-Origins mit einem festgelegten API-Pfad. URL-Userinfo, Query/Fragment, zweifach kodierte Trenner, Loopback- und andere IP-Literale sowie typische lokale/reservierte Hostnamen werden abgelehnt. Das ist Defence-in-depth, **kein vollständiger SSRF-Schutz**: öffentliche DNS-Namen können später auf private/unerlaubte IPs zeigen. Vor produktiver Nutzung sind Netzwerk-Egress-Regeln, DNS-Rebinding-Schutz und verbindlich an eine geprüfte Zieladresse gebundener Transport bzw. Egress-Proxy erforderlich.
2. **K16: Tenant-/Task-/Region-/Datenklasse-Entscheid** in ai-egress-policy.ts. Jede KI-Anfrage braucht einen autorisierten Actor, effektives aktives KI-Modul, bestätigten Netz-Egress-Gate, exakte Tenant-Übereinstimmung, aktive zeitlich begrenzte Freigabe und explizit erlaubte Kombination aus Task, Provider, Region und Datenklasse. Personenbezogene Daten erfordern eine dokumentierte Datenschutzfreigabe. Besondere Kategorien personenbezogener Daten sind in diesem generischen Gate grundsätzlich abgelehnt. **Kein Wildcard-Fallback** und keine automatische Cloud-Umschaltung.
3. **K03: Secret-Referenz statt Inline-Token** in ai-governed-gateway.ts. Eine nicht für Clients bestimmte Connection-Definition enthält nur credentialRef. Die Trusted-Resolver-Schnittstelle lädt den tatsächlichen Token **erst nach** erfolgreich durchlaufenen Policy- und Endpoint-Gates. Ungültige/fehlende Secrets und Resolverfehler werden ohne Credential-Inhalte gemeldet. Der Token wird nicht in Gateway-Fehlern gespeichert. Der konkrete produktive Secret-Store, Verschlüsselung/RBAC/Rotation/Audit sind **noch nicht implementiert**.
4. **K02-Adapter bleibt unverändert** und verarbeitet nach Freigabe genau einen synthetisch testbaren Chat-Request. Das Gateway ist **nicht** im live LLM-Hub oder der KI-Queue eingehängt.

## Grenzen und Vertrauensmodell

Die Prüffunktion ist kein Ersatz für eine authentisierte Backend-Middleware. Tenants, Actors, Sensitivitätsklassen, Provider-IDs, Regions- und Freigabedaten müssen durch vertrauenswürdige, serverseitige RBAC-/Policy-Services erstellt werden. Der Browser darf diese Angaben nicht bestimmen oder einen Secret-Resolver konfigurieren. Das Boolean-Feld networkEgressApproved muss erst nach realen, durch den Betreiber implementierten Netzschutzmaßnahmen aus einem kontrollierten Deployment-Kontext stammen; es ist kein Nachweis, dass der Netzwerkpfad bereits geschützt wäre.

Das neue Gateway darf **nicht produktiv aktiviert** werden, solange K03/K07/K16 und die Übernahme in das bestehende LLM-Hub-/Tenant-Modell nicht vollständig umgesetzt, geprüft und freigegeben sind. Die Tests verwenden Fake-Fetch und künstliche Secretwerte; kein echter KI-Anbieter, kein Netzverkehr zu externen Hosts, keine Bürgerdaten.

## Sicherheitsnachweis im PR

- Endpoint: nur exakter genehmigter Origin; keine IP-Literale, lokalen DNS-Suffixe oder unsichere URL-Formen.
- Daten: anderes Tenant/Task/Provider/Region, Modul off, Actor ohne Rechte, abgelaufene Freigabe, besondere Datenklasse, kein Review führen zur Ablehnung.
- Zugangsdaten: keine Secret-Auflösung vor Policyentscheidung, keine ausgehenden Requests bei fehlendem Secret, Resolverfehler ohne Offenlegung.
- Provider: Erfolg genau einmal, bei 429 kein heimlicher weiterer Provideraufruf.
- Wiederherstellung: Dateien können per Revert entfernt werden, weil keine Runtime-Aufrufstelle oder Datenbankmigration betroffen ist.

## Ausstehend vor dem Produktiveinsatz

Vollständiger DNS/IP-Schutz auf Netz-/Transportebene, authentisierte Tenant-Policy-Quelle, verifizierte Einwilligungs-/Rechtsgrundlagen und Datenflussvereinbarungen, verschlüsselter Secret-Store/Rotation, auditierbarer Admin-Approval-Prozess und Migrations-/Queue-/Failover-Integration. Zusätzlich sind API-/Browser-/Datenschutztests und ein unabhängiges Sicherheitsreview erforderlich.

[KI-Zielarchitektur](AI_BACKENDS.md) · [Modulplattform](MODULE_PLATFORM.md) · [Betrieb/Sicherheit](SECURITY_PRIVACY.md) · [ADR-0006](ADR-0006-MODEL-CAPABILITIES.md)
