# ADR-0010 – LLM-Hub-Pilot als schreibfreier, deaktivierter Routing-Preview

**Datum:** 06.11.2026 · **Status:** technische Teilimplementierung, **kein produktiver KI-Providerwechsel**. **Issues:** [K18 #90](https://github.com/derdigitalaffine/behebes-ai/issues/90), [K06 #78](https://github.com/derdigitalaffine/behebes-ai/issues/78), [K16 #88](https://github.com/derdigitalaffine/behebes-ai/issues/88).

## Warum zuerst ein Lesepfad?

Der vorhandene `resolveLlmRuntimeSelection()` im LLM-Hub hat historisch sinnvolle Fallbacks, die für eine neue datenschutz-/tenantgebundene KI-Ausführung **zu weitreichend** sind: Task-Routing → Default-Route → erste aktivierte Verbindung → Default-Modell. Die vorhandenen Connection-Datensätze speichern teilweise noch API-Schlüssel oder OAuth-Token; das Modellinventar nutzt teilweise Heuristiken für Fähigkeiten.

Eine sofortige Laufzeitumschaltung könnte dadurch ungeprüfte Daten an den falschen Provider senden. Deshalb beginnt die Migration mit einem bewusst **nicht ausführenden** Pilotplaner.

## Implementiert

- `ai-llm-hub-pilot.ts`: reine, deterministische Entscheidung über den **explizit hinterlegten** Task-`ui_translation`-Eintrag. Kein Default-, Erstverbindungs-, Modell- oder Providerfallback.
- Pilot nur für **öffentliche Texte**. Bürgeranliegen, Klassifikation, Bilder, personenbezogene und besondere Datenklassen werden ausgeschlossen, ebenso externe Side Effects.
- K03/K04/K07/K16-Gates werden auf bereits vorhandene LLM-Hub-Routen angewendet: exakte Tenant-/Connection-/Task-/Provider-/Region-/Modellbindung, gültige serverseitige Credential-Referenz, nachgewiesene Textfähigkeit, exakte HTTPS-Origin-/API-Pfad-Übereinstimmung und zeitlich begrenzte Tenant-/Egress-Freigabe.
- Gespeicherte Legacy-`apiKey`-/OAuth-Werte gelten **nicht** als migrierte Credentials. Solche Verbindungen werden bewusst als `legacy_secret_present` abgelehnt. Dies macht erforderliche Migrationen transparent, ohne Bestandsdaten zu verändern.
- Die Entscheidung enthält ausschließlich einen festgelegten Reason Code und bei positiver Vorprüfung Task-/Connection-/Modell-ID. **Kein Prompt, keine API-Schlüssel, keine OAuth-IDs, kein Secret-Store-Aufruf und keine externen Netzrequests.**
- `llm-hub.ts` exportiert `previewGuardedLlmHubUiTranslationPilot()`. **Standardmäßig komplett deaktiviert.** Nur der exakte serverseitige Wert `AI_LLM_HUB_GUARDED_PILOT_MODE=preview` gestattet eine interne Vorprüfung. Ein Modus `execute` ist nicht implementiert.
- Die Preview-Funktion liest den rohen gespeicherten `llmHub`-Wert mit `getSetting()`, **nicht** via `loadLlmHubState()`, weil letztere eine Legacy-Datenmigration durchführen und schreiben könnte. Bei Fehlern fail-closed.
- Kein HTTP-Route-Handler, keine neue Admin-API und keine Änderung an `ai.ts`, bestehendem Providerclient, Queue oder produktiven Taskaufrufen.

## Nachweis und Grenzen

Der neue Testkatalog prüft explizite Routen, fehlende/duplizierte/deaktivierte Verbindungen, unberechtigte oder abgelaufene Tenant-/Providerfreigaben, Legacy-Credentials, nicht belegte Modellfähigkeiten, abweichende Endpunkte sowie Datenschutz- und Modulgates.

**Wichtig:** `eligible_for_staging_review` ist **keine Erlaubnis**, einen Prompt zu senden. Vor realem Betrieb muss das System weiterhin eine autoritative Policyquelle besitzen, die K03-Credential-Bindings auf echten Tenant prüft, DNS-gepinnte Verbindungen nach K07 benutzen, ein Managed-Secret-/Audit-/Rotationsmodell bereitstellen, datenschutzrechtliche Grundlage und DPA/Region prüfen sowie Upgrade-/Queue-/Idempotenztests bestehen. Der boolesche Egress-Status ersetzt keine Infrastrukturfirewall.

## Weiteres Vorgehen

1. K03/K16: glaubwürdig serverseitige Policy-/Secretkonfiguration und Berechtigungsprüfung mit Mandant/Eigner-ID implementieren; keine Nutzereingaben als Genehmigungsstatus.
2. K18: kompatible Legacy-Credential-Migration mit Backup/Restore/Rollback; Altzustand lesbar halten.
3. K06/K12: mindestens eine im Staging getestete öffentliche UI-Übersetzung über den neuen **gepinnnten** HTTPS-Transport, zunächst unter explizitem Pilotflag und mit messbarem Audit/Budget. Kein stiller Cloudfallback.
4. Erst nach unabhängiger Security-/Privacy-/QA-Freigabe die Pilot-Task-Ausführung überhaupt ermöglichen; anschließend kontrollierte Ausweitung nach synthetischen Golden Cases.

**Rollback:** PR-Revert oder Flag nicht setzen. Die Preview schreibt nie Daten und kann keinen Provider ansprechen.

[Architektur](AI_BACKENDS.md) · [Milestones](MILESTONES.md) · [ADR-0009](ADR-0009-AI-CREDENTIAL-BINDINGS.md)
