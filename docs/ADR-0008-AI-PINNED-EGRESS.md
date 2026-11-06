# ADR-0008 – DNS-gepinnter HTTPS-Egress für KI-Provider

**Datum:** 2026-11-06 · **Status:** zur unabhängigen Security-/Architektur-Review; Umsetzung in PR #99 · **Issue:** [K07 #79](https://github.com/derdigitalaffine/behebes-ai/issues/79).

## Problem

Eine statische HTTPS-Origin-Allowlist (ADR-0007) kann DNS-Rebinding nicht verhindern: Der geprüfte Domainname könnte beim tatsächlichen Verbindungsaufbau auf eine private Adresse zeigen. Eine einfache DNS-Vorabprüfung mit anschließendem generischem `fetch(url)` ist wegen eines zweiten Hostname-Lookups ebenfalls **nicht ausreichend**.

## Entscheidung

Der neue, zunächst nur im isolierten KI-Gateway verwendete `ai-pinned-egress.ts` arbeitet in einem überprüfbaren Ablauf:

1. Zuerst die bereits vorhandene **serverseitige Tenant-/Task-/Region-/Datenklassen-Policy und HTTPS-Origin-Allowlist** prüfen.
2. Den Hostnamen einmal über den Server-Resolver auf A-/AAAA-Adressen auflösen. **Alle** Antworten prüfen; bei leeren, ungewöhnlich großen, inkonsistenten oder gemischt öffentlichen/privaten Antworten vollständig verweigern.
3. Zulässig sind ausschließlich konservativ definierte globale IPv4-/IPv6-Unicast-Adressen. Loopback, RFC1918, Link-Local, CGNAT, reserved, Dokumentations-/Benchmarknetze, IPv4-mapped IPv6 und 6to4 werden abgewiesen.
4. Eine **geprüfte Adresse pinnen**. Node HTTPS verbindet sich mit der IP als `hostname`, aber mit der ursprünglichen Domain als `servername` (SNI), `Host`-Header und regulärer Zertifikatsvalidierung. Es gibt dadurch **keine zweite DNS-Auflösung** durch den HTTPS-Request.
5. Kein impliziter HTTP-Proxy oder Follow-Redirect; ausschließlich der festgelegte POST-Endpunkt, HTTPS-Port 443, begrenzte Request- und Response-Größen. Fehlerklassen bleiben redigiert.
6. **Erst nach** der erfolgreichen DNS-/IP-Prüfung wird die zugeordnete Secret-Referenz über den serverseitigen Resolver aufgelöst. Keine geheimen Credentials bei abgelehnter Route.

Die realen DNS-Records werden bei einem späteren produktiven Aufruf neu geprüft und anschließend ausschließlich für **diesen einen Request** gepinnt; keine providerübergreifende DNS-Cache-Freigabe.

## Gründe und Alternativen

- **Nur URL-Allowlist:** verworfen, weil die Zieladresse nach Erlaubnis wechseln kann.
- **DNS preflight + global fetch:** verworfen, weil `fetch` danach erneut DNS auflösen kann.
- **HTTP-Anfrage an IP mit ausgeschalteter TLS-Prüfung:** strikt verworfen, weil Hostname und Zertifikat nicht mehr verifiziert würden.
- **HTTPS-Request zur IP mit originalem SNI/Host und TLS-Verifikation:** gewählt als testbare Transport-Grenze.

## Sicherheitsgrenzen und offene Arbeit

- Diese Maßnahme reduziert DNS-Rebinding/SSRF im **neuen** Provider-Gateway, ersetzt aber **keine** betriebliche Egress-Firewall, dedizierte Netzsegmentierung, autorisierte Anbieterlisten und unabhängiges Security-Review.
- DNS-Daten selbst stammen aus dem vorgesehenen Systemresolver; dessen Vertrauenswürdigkeit und Netzausleitungsbedingungen sind Betreiberaufgabe. IP-Ranges ändern sich; die konservative Einordnung ist bewusst unvollständig und muss nach IANA-/Unternehmenspolicy gepflegt werden. Cloud-/VPN-/Proxy-Sonderpfade sind **nicht** automatisch erlaubt.
- Nur Standardport HTTPS/443; lokale Ollama-/vLLM-Server benötigen ein separat kontrolliertes K19-Netzprofil, **keine** globale Ausnahme.
- Die `fetcher`-Injection im Gateway ist ausschließlich für vertrauenswürdige Fake-Tests. Sie darf nicht über Admin/API-Requests und nicht durch untrusted Module konfigurierbar werden.
- **Kein produktiver Runtime-Switch:** `llm-hub.ts`, Legacy-/Queue-Clients und bestehende Auth-/Konfigurationsdaten werden weiterhin nicht verändert. Ein Betreiber darf die neuen Verträge erst mit K03/K16, Secret-Store/Rotation, Mandant/RBAC, GDPR-Egress-Freigaben und integrierten Sicherheitstests produktiv freigeben.
- Keine echten KI-Provideranfragen, keine Bürgerdaten, keine Datenbankmigration, kein Deployment in diesem PR.

## Tests

Synthetische Unit-Tests prüfen öffentliche/private/spezielle IPv4-/IPv6-Adressen, gemischte DNS-Antworten (auch „public + private“), zurückgewiesene Hostnamen, PIN/TLS/SNI-/Hostparameter, Manipulationsversuche an Ziel und Request sowie Abbruch ohne Socket. GitHub Actions baut vier Workspaces und führt Backend-/UI-Testjobs aus.

**Rollback:** PR-Revert, da keine vorhandenen Runtime-Aufrufstellen oder gespeicherten Datensätze verändert werden. [ADR-0007](ADR-0007-AI-EGRESS-GOVERNANCE.md) · [KI-Architektur](AI_BACKENDS.md) · [K07 #79](https://github.com/derdigitalaffine/behebes-ai/issues/79).
