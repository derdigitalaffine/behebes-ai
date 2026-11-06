# ADR-0006 – Modellfähigkeiten müssen belegt und aktuell sein

**Datum:** 2026-11-06 · **Status:** vorgeschlagen, Implementierung im separaten K04-PR.

## Problem

Eine Modell-ID wie „vision“ oder „tools“ garantiert keine tatsächliche Unterstützung von Bildverarbeitung, strukturierten Antworten oder Tool-Calling. Auch per Provider ermittelte Fähigkeiten können nach einem Modellupdate veralten. Die Modellwahl darf deshalb nicht allein aus einem Anzeigenamen oder einem ungeprüften /models-Ergebnis abgeleitet werden.

## Entscheidung

Ein reiner, deterministisch testbarer Backendvertrag bewertet die angeforderten Task-Fähigkeiten gegen eine explizite Modell-Capability-Liste. Der Nachweisstatus wird unterschieden:

- **declared:** vom Betreiber ausdrücklich geprüft und in einer **vertrauenswürdigen serverseitigen** Modellkonfiguration freigegeben.
- **probed:** aus einem technischen Test mit Zeitstempel gewonnen. Standard-TTL: 24 Stunden, aufrufseitig für andere Anforderungen konfigurierbar. Fehlender, invalider, veralteter oder unplausibel zukünftiger Zeitstempel führt zur Ablehnung.
- **unknown:** kein belastbarer Nachweis; daher keine automatische Modellselektion.
- **missing:** wird explizit erfasst, nie durch stillen Modell-/Providerwechsel ersetzt.

Die K04-Funktion liefert eine nachvollziehbare interne Entscheidungsstruktur mit erlaubtem Zustand, Reason Code und fehlenden Fähigkeiten, **ohne** Bürgertext, API-Schlüssel, Provider-Response oder Taskprompt. Sie ist nun in den K02-Chatadapter eingebunden: Dort ist mindestens eine nachgewiesene Textfähigkeit Voraussetzung. Ein veralteter Probelauf führt zu einem kontrollierten Unsupported-Fehler **vor** jedem HTTP-Request.

## Abgrenzung und Risiken

Diese Prüfung ist **kein** Auth-, Tenant-, DPA-/Region-, DNS-/IP-Egress- oder Budget-Gate. Das spätere Modellregister muss sicherstellen, dass „declared“ nur von autorisierter serverseitiger Konfiguration stammt und Provider-Metadaten nicht eigenmächtig die Vertrauensstufe aufwerten. Das Routing und die Runtime des bestehenden LLM-Hubs sind weiterhin **nicht** umgestellt.

Capabilities: text, vision, structured_output, tool_calling, streaming, embeddings. Keine Capability wird aus dem Modellnamen behauptet.

## Tests und Einführung

Unit-Tests mit synthetischen Modellkatalogen prüfen: mehrere gleichzeitig erforderliche Fähigkeiten, unbekannte/stale/probed/declared Zustände, Zeitgrenzen, ungültige Metadaten und exakte Ablehnungsgründe. Backend-Adaptertest weist zusätzlich nach, dass abgelaufene Capability-Probes keinen Netzaufruf verursachen.

Rollback durch Revert des isolierten PRs; keine Datenmigration, keine Provider-API-Aufrufe. Spätere K04-Schritte: verifizierte Model Discovery/Probe-Routen, Admin-Override-RBAC, Caching/Invalidierung und saubere Versionierung. [Roadmap K04 #76](https://github.com/derdigitalaffine/behebes-ai/issues/76) · [K02 #74](https://github.com/derdigitalaffine/behebes-ai/issues/74) · [KI-Zielbild](AI_BACKENDS.md).
