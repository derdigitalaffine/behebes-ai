# ADR-0011 – Versionierter KI-Task-Vertrag und valide Übersetzungsentwürfe

**Datum:** 06.11.2026 · **Status:** erster isolierter K08-Referenzslice, kein produktiver Einsatz · **Issue:** [K08 #80](https://github.com/derdigitalaffine/behebes-ai/issues/80).

## Problem

Eine rohe LLM-Antwort als JSON oder Text ist kein verlässlicher Datenvertrag. Fehlende Pflichtfelder, erfundene IDs/Sprachen, abgeschnittenes JSON, HTML und beschädigte Platzhalter können Bürgerkommunikation oder dynamische UI-Texte verfälschen. Auch ein gültiger Provider-Transport garantiert keine fachlich richtige Übersetzung.

## Entscheidung

Der erste, risikoarme K08-Slice ist auf **öffentliche UI-Strings** begrenzt. Die neue `ai-task-contracts.ts` stellt eine strikt versionierte Task-Eingabe `ui_translation/v1` bereit:

- Feste Pflichtfelder: Task-Key, Version 1, Tenant-Identifikator, von vertrauenswürdigem Backend klassifizierter **öffentlicher** Datenstatus, explizite Quell-/Zielsprache, Eingabetext.
- Testweise zugelassene Sprachcodes: de/en/fr (nicht als bereits vollständige Produktlokalisierung interpretieren).
- Begrenzte Eingabelänge, keine Steuerzeichen oder HTML/Markup, keine beliebigen zusätzlichen JSON-Felder. Platzhalter `{{ticketNumber}}` werden nur in einer definierten Syntax akzeptiert.
- Prompt trennt die fachliche Übersetzungsanweisung (System) vom **untrusted** Quelltext (JSON-kodierte User-Daten). Die KI darf aus dem Quelltext keine privilegierten Anweisungen ableiten. **Die technische Trennung ist keine Garantie** gegen Prompt-Injection, deshalb folgt strikte Ausgabekontrolle.
- Erwartete KI-Antwort ausschließlich als JSON-Objekt `{"language":"en","translation":"..."}`; keine Markdown-Codeblöcke, zusätzlichen Felder, unvollständigen Generationen, falschen Sprachcodes, HTML oder geänderten/entfallenen/zusätzlichen Platzhaltern.
- Ergebnis wird ausschließlich als `status: "unreviewed"` zurückgegeben; keine Veröffentlichung, kein Versand, keine Änderung eines Verwaltungsvorgangs. Plausibilität und sprachliche Genauigkeit erfordern gesonderte Evals und menschliche Abnahme.

`ai-ui-translation-draft.ts` verbindet diesen Vertrag mit dem bisherigen K02/K03/K04/K07/K16-Gateway, prüft Tenant/Task/Datenklasse vor einem Request und normalisiert die Rückgabe. Bei nicht zulässiger Eingabe wird **weder ein Secret geladen noch ein Backend kontaktiert**. Die Tests verwenden nur Fake-Fetch und synthetische Daten.

## Sicherheitsgrenzen

- **Nicht** über die produktiven API-Routen, den LLM-Hub oder die KI-Queue erreichbar. Kein Deployment, kein Live-Provider, keine echten Bürgerdaten oder Credentials.
- Der Caller muss reale Tenant-/RBAC-/Datenschutz- und Netzpolicy aus einer vertrauenswürdigen Serverquelle bereitstellen. Ein `dataClass: public` vom Browser wäre **keine** gültige Freigabe.
- Kein garantierter Schutz gegen semantische Manipulationen oder fehlerhafte Übersetzungen. Die Ausgabe muss als Klartext gerendert und gegebenenfalls von einem Menschen geprüft werden.
- Weitere Tasktypen (Klassifizierung, Zuständigkeit, Workflow, Bildanalyse) verlangen **eigene** Versionen, Schemas, erlaubte Kategorien, Negativtests, Reviewpunkte und Evals; der v1-Übersetzungsvertrag darf nicht als generische Genehmigung für diese Aufgaben dienen.

## Tests und Fortsetzung

Testmatrix: strikte Input-Keys, Datenklassen, Locales, Längen/Steuerzeichen/Markup, Platzhalter-Syntax, modellseitige Finish-Reasons, kaputtes JSON, zusätzlich generierte Felder, fehlende oder erweiterte Platzhalter, fremder Tenant, falscher Task, Credential-/Netz-Read-Verhinderung und Normalisierung zum ungeprüften Entwurf.

Nächste Schritte: K13-Golden-Evals für Übersetzung, echte serverseitige Staging-Policy/Secret-Konfiguration, freigegebene Task-Registry und anschließend kontrollierte Pilotintegration in `llm-hub.ts` **nur nach** Architektur-, Security- und Datenschutzfreigabe.

**Rollback:** Isolierte neue Module und Tests können ohne Datenmigration zurückgenommen werden.

[KI-Zielbild](AI_BACKENDS.md) · [LLM-Hub-Pilot](ADR-0010-LLMHUB-PILOT-PREVIEW.md) · [Provider-Gateway](ADR-0007-AI-EGRESS-GOVERNANCE.md)
