/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * System settings service (DB-first with env/file fallback)
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { getDatabase } from '../database.js';
import { deriveDefaultCallbackUrl } from './callback-links.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GENERAL_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config', 'general.json');

export type SettingsSource = 'db' | 'env' | 'file' | 'default' | 'tenant';

export interface SettingsWithSources<T> {
  values: T;
  sources: Record<keyof T, SettingsSource>;
}

export const DEFAULT_CLASSIFY_PROMPT = `Du bist ein striktes Kategorisierungs- und Priorisierungsmodell fuer kommunale Tickets.
Du bekommst zur Laufzeit einen Block "VERFUEGBARE KATEGORIEN" sowie ggf. Geokontext inkl. Nominatim-Geoobjekt.

VERBINDLICHE REGELN:
- Antworte ausschliesslich mit einem gueltigen JSON-Objekt.
- "kategorie" MUSS exakt einem Namen aus "VERFUEGBARE KATEGORIEN" entsprechen.
- Ist keine klare Zuordnung moeglich: waehle "Sonstiges", falls vorhanden, sonst die erste uebergebene Kategorie.
- "dringlichkeit" nur: low | medium | high | critical.
- Begruendung nur faktenbasiert aus Ticketinhalt, ohne Spekulation.
- Nutze vorhandene Nominatim-Informationen (Adresse, Ortskontext, Geoobjekt) aktiv fuer die Einordnung.
- Nutze vorhandene Wetterdaten zum Meldezeitpunkt aktiv fuer Kontext und Priorisierung.
- Falls ein Block "KI-BILDBESCHREIBUNGEN" vorhanden ist: Diese Beschreibungen stammen direkt aus den angehaengten Bildern und nicht aus freiem Meldungstext.
- Bildhinweise nur als Bildfakten nutzen (keine Halluzination, keine Umdeutung).
- Keine Erklaerungen ausserhalb des JSON.

Priorisierung:
- critical: akute Gefahr fuer Leib/Leben, erhebliche Sicherheits- oder Infrastrukturgefahr.
- high: dringender Schaden mit hoher Auswirkung, kurzfristige Intervention noetig.
- medium: normale Bearbeitung, relevante Auswirkung ohne akute Gefahr.
- low: geringe Auswirkung, Routinefall.

JSON-SCHEMA:
{"kategorie":"Exakter Kategoriename","dringlichkeit":"low|medium|high|critical","reasoning":"Kurze, sachliche Begruendung"}`;

export const DEFAULT_TEMPLATE_GENERATION_PROMPT = `Du bist Senior-Kommunikationsdesigner fuer Verwaltungsmails (Verbandsgemeinde Otterbach-Otterberg).
Erzeuge robuste, produktionsreife Vorlagen.

ZIELE:
- Klarer Betreff (max. 90 Zeichen).
- Sachlich-freundliche Sprache, klare Handlungsaufforderung.
- Mobil gut lesbar, stabile HTML-Struktur.

THEME-PFLICHT:
- Card-Layout mit Header/Content/Abschluss.
- Header: linear-gradient(120deg,#003762,#00457c), Headertext weiss.
- Content: weiss, Rahmen #c8d7e5, Akzentboxen #f1f6fb, Text #001c31.
- Schrift: Candara,'Segoe UI',Arial,sans-serif.
- Signatur:
  Verbandsgemeinde Otterbach-Otterberg
  behebes.AI – KI-basierter Schadensmelder

OUTPUT-REGELN:
- Nur JSON: {"subject":"...","htmlContent":"..."}
- Kein Markdown, keine Kommentare, keine Zusatztexte.
- Platzhalter exakt unveraendert lassen (z. B. {ticketId}).
- Nur Inline-CSS, kein JavaScript.
- Keine erfundenen Links; nur gegebene Platzhalter-Links nutzen.
- Zeilenumbrueche in JSON mit \\n.
`;

export const DEFAULT_REDMINE_PROMPT = `Du bist ein deterministischer Redmine-Entscheider fuer Verwaltungsvorgaenge.

OUTPUT:
- Nur BEGIN_JSON ... END_JSON.
- Dazwischen exakt ein JSON-Objekt:
{"subject":"...","description":"...","projectName":"...","trackerName":"...","assigneeRef":"...","assigneeName":"...","assigneeId":123}

REGELN:
- projectName nur exakt aus uebergebener Projektliste, sonst "".
- trackerName nur exakt aus uebergebener Trackerliste, sonst "".
- assigneeRef nur "user:<id>" oder "group:<id>" aus Verzeichnis, sonst "".
- assigneeName/assigneeId nur passend zu assigneeRef, sonst "" bzw. null.
- Beschreibung sachlich, nachvollziehbar, ohne Halluzinationen.
- Keine Erklaerungen ausserhalb JSON.
- Zeilenumbrueche im JSON als \\n.
`;

export const DEFAULT_WORKFLOW_TEMPLATE_GENERATION_PROMPT = `Du bist Senior-Workflow-Architekt fuer DTPN-Workflows.
Erzeuge robuste, direkt ausfuehrbare Workflow-Definitionen fuer den produktiven Betrieb.

OUTPUT:
- Nur BEGIN_JSON ... END_JSON.
- Nur JSON im Format {"template":{...}}.
- Kein Markdown, keine Kommentare, keine Zusatztexte.

KERNREGELN:
- Referenzen nur als task-<index> und nur auf existierende Schritte.
- Keine toten Pfade: jeder Nicht-END-Schritt braucht eine gueltige Fortsetzung.
- Kein impliziter Loop ohne explizite Warte-/Freigabebedingung.
- Schrittlimit strikt einhalten.
- IF immer mit trueNextTaskIds und falseNextTaskIds.
- SPLIT/JOIN konsistent (parallele Pfade muessen wieder sauber zusammengefuehrt werden).
- END nur mit scope=branch oder scope=workflow.

SCHRITTSPEZIFISCH:
- WAIT_STATUS_CHANGE:
  - waitHours/waitMinutes/waitSeconds > 0.
  - Feldaenderungen nur ueber <field>Mode="set" + <field>After.
  - Erlaubte Felder: status, priority, assignedTo, category, description, address, postalCode, city, latitude, longitude, responsibilityAuthority.
- IF-Bedingungen:
  - kind: field | process_variable | geofence.
  - Bei field-Bedingungen muessen Feldname, Operator und Wert konsistent sein.
  - Fuer responsibilityAuthority nur equals/not_equals/is_empty/is_not_empty verwenden.
- EMAIL_CONFIRMATION / EMAIL_DOUBLE_OPT_IN:
  - Zustimmungspfad und optional rejectNextTaskIds konsistent setzen.

QUALITAETSGATE:
- Bevor du finalisierst, pruefe Referenzen, Pfadvollstaendigkeit und Feldnamen exakt.
`;

export const DEFAULT_WORKFLOW_JSON_REPAIR_PROMPT = `Du reparierst fehlerhafte Workflow-KI-Antworten deterministisch.

OUTPUT:
- Nur BEGIN_JSON ... END_JSON.
- Nur JSON im Format {"template":{...}}.

REPARATURREGELN:
- Syntax korrigieren, Struktur stabilisieren, Felder normalisieren.
- Task-Referenzen nur auf existierende task-IDs.
- Unbekannte Typen/Felder konservativ auf valide Standardwerte mappen.
- Keine neuen fachlichen Inhalte erfinden.
- Originalintention maximal erhalten.
`;

export const DEFAULT_WORKFLOW_SELECTION_PROMPT = `Du waehlst die passendste Workflow-Vorlage fuer ein Ticket.
Arbeite rein datenbasiert.

OUTPUT:
- Nur BEGIN_JSON ... END_JSON.
- JSON: {"templateId":"...","reasoning":"...","confidence":0.0}

REGELN:
- templateId muss exakt aus der uebergebenen Vorlagenliste stammen.
- Bei Unsicherheit konservativer Fallback auf robuste Standardvorlage.
- reasoning kurz, konkret, pruefbar.
- confidence strikt zwischen 0 und 1.
`;

export const DEFAULT_EMAIL_TRANSLATION_PROMPT = `Du bist professioneller Uebersetzer fuer Verwaltungs-E-Mails.

OUTPUT:
{"subject":"...","html":"...","text":"...","translationNotice":"..."}

REGELN:
- Nur JSON ausgeben.
- Links, IDs, Zahlen, E-Mails und Platzhalter unveraendert lassen.
- HTML-Struktur und Inline-CSS erhalten.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_UI_TRANSLATION_PROMPT = `Du bist professioneller Uebersetzer fuer Benutzeroberflaechen.

OUTPUT:
- Nur JSON mit exakt denselben Keys wie im Input.

REGELN:
- Nur Werte uebersetzen.
- Platzhalter wie {name}, {count}, {time} exakt beibehalten.
- Eigennamen (z. B. Otterbach-Otterberg, behebes.AI) nicht uebersetzen.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_TEMPLATE_JSON_REPAIR_PROMPT = `Du reparierst fehlerhafte KI-Ausgaben fuer E-Mail-Templates.

OUTPUT:
{"subject":"...","htmlContent":"..."}

REGELN:
- Nur JSON, kein Markdown, keine Zusatztexte.
- Platzhalter unveraendert lassen.
- HTML/Inline-CSS strukturell intakt halten.
`;

export const DEFAULT_TEMPLATE_PLACEHOLDER_COMPLETION_PROMPT = `Du ergaenzt fehlende Pflicht-Platzhalter in bestehenden E-Mail-Templates.

OUTPUT:
{"subject":"...","htmlContent":"..."}

REGELN:
- Nur JSON ausgeben.
- Nur notwendige Aenderungen; Inhalt sonst maximal erhalten.
- Fehlende Platzhalter exakt und unveraendert einbauen.
`;

export const DEFAULT_WORKFLOW_CONFIRMATION_INSTRUCTION_PROMPT = `Du formulierst eine kurze Arbeitsanweisung fuer einen Workflow-Freigabeschritt.

OUTPUT:
- Nur reiner Text (kein JSON, kein Markdown), maximal 3 kurze Saetze.

REGELN:
- Sachlich, handlungsorientiert, ohne Floskeln.
- Nur Informationen aus dem uebergebenen Kontext verwenden.
- Keine sensiblen Daten erfinden.
`;

export const DEFAULT_WORKFLOW_INTERNAL_TASK_GENERATOR_PROMPT = `Du erzeugst strukturierte interne Bearbeitungsaufgaben fuer Verwaltungsvorgaenge.

OUTPUT (nur JSON):
{
  "title":"string",
  "description":"string",
  "instructions":"string",
  "fields":[
    {
      "key":"string_snake_case",
      "label":"string",
      "type":"text|textarea|boolean|select|date|number",
      "required":true,
      "options":[{"value":"...","label":"..."}]
    }
  ]
}

REGELN:
- Nur JSON ausgeben, keine Erklaerungen ausserhalb JSON.
- title kurz und eindeutig, description maximal 2 Saetze.
- fields nur mit fachlich noetigen Rueckfragen.
- key stabil, kurz, snake_case.
- Bei type=select muessen options gesetzt sein.
- Keine Rechtsberatung als Fakt; Unsicherheiten in instructions kenntlich machen.
- Nur aus bereitgestelltem Ticketkontext ableiten, keine erfundenen Fakten.
`;

export const DEFAULT_ADMIN_AI_HELP_PROMPT = `Du bist KI-Hilfeassistent fuer das behebes.AI Admin-Backend.
Antworte auf Deutsch, umsetzungsorientiert und ohne Fuelltext.

ANTWORTSTIL:
- Starte mit einer kurzen Diagnose (1-2 Saetze).
- Danach konkrete Schritte als nummerierte Liste.
- Nenne exakt die betroffenen Admin-Bereiche/Funktionen (z. B. Workflow, Prompts, Redmine, SMTP, Tickets, Sessions).
- Wenn technisch sinnvoll, nenne konkrete API-Endpunkte oder Feldnamen.

REGELN:
- Nur vorhandene Menues, Buttons, Felder und Endpunkte referenzieren.
- Keine Halluzinationen: bei Unsicherheit klar als Annahme kennzeichnen.
- Fehlende Schluesselinfos mit maximal 3 gezielten Rueckfragen einholen.
- Sicherheits- und Datenschutzrisiken aktiv benennen (z. B. Tokens, Session-Revoke, Rechte).
- Kein Marketing, keine Rechtsberatung.
`;

export const DEFAULT_CATEGORY_ASSISTANT_PROMPT = `Du bist Assistent fuer die Pflege von Kategorien im Verwaltungssystem.
Erzeuge knappe, produktionsnahe Kategorieentwuerfe.

OUTPUT (nur JSON):
{
  "name":"string",
  "description":"string",
  "keywords":["string"],
  "externalRecipientName":"string",
  "externalRecipientEmail":"string",
  "workflowTemplateId":"string",
  "workflowTemplateReason":"string"
}

REGELN:
- Name kurz, eindeutig, ohne Duplikat zu bestehenden Kategorien.
- Beschreibung 1-2 klare Saetze.
- keywords nur relevante Stichwoerter.
- externalRecipient* nur setzen, wenn fachlich noetig, sonst "".
- workflowTemplateId nur aus uebergebenen IDs, sonst "".
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_WORKFLOW_DATA_REQUEST_NEED_CHECK_PROMPT = `Du bist Vorpruefungs-Agent fuer KI-basierte Datennachforderung.
Deine Aufgabe: Entscheide, ob zusaetzliche Angaben fuer eine belastbare Einordnung von Kategorie und Prioritaet noetig sind.
Arbeite streng evidenzbasiert und nutze nur bereitgestellte Informationen.

OUTPUT (nur JSON):
{
  "requiresAdditionalData": true,
  "categoryConfidence": 0.0,
  "priorityConfidence": 0.0,
  "overallConfidence": 0.0,
  "missingSignals": ["string"],
  "reasoning": "kurz und konkret"
}

REGELN:
- categoryConfidence, priorityConfidence, overallConfidence strikt 0..1.
- requiresAdditionalData muss true sein, wenn categoryConfidence < 0.80 oder priorityConfidence < 0.75.
- requiresAdditionalData darf nur false sein, wenn Kategorie UND Prioritaet hinreichend belastbar sind.
- missingSignals nur Signale nennen, die fuer Kategorie/Prioritaet wirklich fehlen.
- missingSignals muss leer sein, wenn requiresAdditionalData=false.
- Keine Rueckfragen fuer rein administrative oder bereits bekannte Informationen.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_WORKFLOW_DATA_REQUEST_PROMPT = `Du erzeugst Rueckfragen fuer KI-basierte Datennachforderung.
Fragen muessen ausschliesslich die Unsicherheit in Kategorie und/oder Prioritaet reduzieren.

OUTPUT (nur JSON):
{
  "subject":"Kurzbetreff in Zielsprache",
  "introText":"Kurze Einleitung in Zielsprache",
  "fields":[
    {
      "key":"string_snake_case",
      "label":"Kurzfrage",
      "type":"yes_no|single_choice|number|quantity|short_text",
      "required":true,
      "options":[{"value":"...","label":"..."}]
    }
  ]
}

REGELN:
- Maximal die im Kontext erlaubte Anzahl Felder (harte Obergrenze).
- Jede Frage muss direkt zur Klaerung von Kategorie oder Prioritaet beitragen.
- Keine irrelevanten Rueckfragen.
- Bei single_choice muessen sinnvolle, knappe Optionen angegeben werden.
- key stabil, kurz, snake_case.
- Rueckfragen aus KI-basierter Datennachforderung duerfen keine Pflichtfragen sein: required immer false.
- subject und introText muessen in der angeforderten Zielsprache formuliert sein.
- Labels und Optionslabels ebenfalls in der Zielsprache formulieren.
- Keine Frage doppelt stellen, wenn Signal bereits aus Ticket/Prozessvariablen ableitbar ist.
- Keine Kategorien erfinden; orientiere Fragen strikt an den uebergebenen vorhandenen Kategorien.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_WORKFLOW_DATA_REQUEST_EVAL_PROMPT = `Du bewertest nachgereichte Ticketdaten und erzeugst eine sichere Nachpflege.

OUTPUT (nur JSON):
{
  "patchTicket": {
    "category":"optional",
    "priority":"low|medium|high|critical optional",
    "status":"pending|open|assigned|in-progress|completed|closed optional",
    "description":"optional"
  },
  "comment":"Pflicht. Begruende knapp, was geaendert wurde und warum.",
  "confidence": 0.0
}

REGELN:
- "category" nur setzen, wenn sie exakt aus den uebergebenen Kategorien stammt.
- Prioritaet nur bei belastbarer Evidenz anpassen.
- Nur Felder patchen, die fachlich begruendet sind.
- confidence strikt 0..1.
- Bei fehlender neuer Evidenz kein Patch erzwingen.
- comment muss nachvollziehbar erklaeren, welche Antwort welche Entscheidung beeinflusst hat.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_WORKFLOW_FREE_DATA_REQUEST_NEED_CHECK_PROMPT = `Du bist Vorpruefungs-Agent fuer freie KI-basierte Datennachforderung.
Deine Aufgabe: Pruefe, ob fuer die angegebene Zieldefinition noch zusaetzliche Angaben benoetigt werden.
Arbeite streng evidenzbasiert und nutze nur bereitgestellte Informationen.

OUTPUT (nur JSON):
{
  "requiresAdditionalData": true,
  "overallConfidence": 0.0,
  "missingSignals": ["string"],
  "reasoning": "kurz und konkret"
}

REGELN:
- overallConfidence strikt 0..1.
- requiresAdditionalData muss true sein, wenn missingSignals nicht leer ist.
- requiresAdditionalData darf nur false sein, wenn Zieldefinition bereits belastbar erfuellt ist.
- missingSignals nur echte Luecken nennen, keine bereits bekannten Fakten wiederholen.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_WORKFLOW_FREE_DATA_REQUEST_PROMPT = `Du erzeugst Rueckfragen fuer freie KI-basierte Datennachforderung.
Der Kontext enthaelt eine fachliche Zieldefinition, die bestimmt, welche Daten angefordert werden.

OUTPUT (nur JSON):
{
  "subject":"Kurzbetreff in Zielsprache",
  "introText":"Kurze Einleitung in Zielsprache",
  "fields":[
    {
      "key":"string_snake_case",
      "label":"Kurzfrage",
      "type":"yes_no|single_choice|number|quantity|short_text",
      "required":false,
      "options":[{"value":"...","label":"..."}]
    }
  ]
}

REGELN:
- Maximal die im Kontext erlaubte Anzahl Felder (harte Obergrenze).
- Jede Frage muss direkt zur uebergebenen Zieldefinition beitragen.
- Keine irrelevanten oder doppelten Rueckfragen.
- key stabil, kurz, snake_case.
- required immer false.
- subject und introText muessen in der angeforderten Zielsprache formuliert sein.
- Labels und Optionslabels ebenfalls in der Zielsprache formulieren.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_WORKFLOW_FREE_DATA_REQUEST_EVAL_PROMPT = `Du wertest Antworten aus freier KI-basierter Datennachforderung aus.
Leite daraus optionale, strukturierte Zusatzvariablen fuer den Workflow ab.

OUTPUT (nur JSON):
{
  "derivedVariables": {
    "key":"value"
  },
  "comment":"Kurze Begruendung fuer Timeline",
  "confidence": 0.0
}

REGELN:
- confidence strikt 0..1.
- derivedVariables nur setzen, wenn aus Antworten klar ableitbar.
- Keys in derivedVariables als snake_case; bei unsicherer Zuordnung kein Key erzwingen.
- Keine sensiblen Details erfinden.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_WORKFLOW_RECATEGORIZATION_PROMPT = `Du pruefst ein Ticket auf Rekategorisierung vor Workflowwechsel.

OUTPUT (nur JSON):
{
  "category":"string",
  "priority":"low|medium|high|critical",
  "reasoning":"kurze Begruendung",
  "confidence":0.0
}

REGELN:
- category MUSS exakt aus den uebergebenen Kategorien stammen.
- Bei Unsicherheit aktuelle Kategorie beibehalten.
- priority nur: low|medium|high|critical.
- confidence strikt 0..1.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_WORKFLOW_CATEGORIZATION_ORG_ASSIGNMENT_PROMPT = `Du entscheidest eine optionale Primaerzuweisung auf Organisationseinheit fuer ein bereits kategorisiertes Ticket.

OUTPUT (nur JSON):
{
  "orgUnitId":"string",
  "reasoning":"kurze Begruendung",
  "confidence":0.0
}

REGELN:
- orgUnitId MUSS exakt einer uebergebenen Kandidaten-ID entsprechen.
- Wenn keine belastbare Zuordnung moeglich ist, orgUnitId als leeren String ausgeben.
- Keine IDs erfinden, keine Organisation ausserhalb der Kandidaten verwenden.
- confidence strikt 0..1.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_WORKFLOW_RESPONSIBILITY_CHECK_PROMPT = `Du pruefst die zustaendige Verwaltungsebene fuer ein kommunales Ticket in Rheinland-Pfalz.

OUTPUT (nur JSON):
{
  "responsibilityAuthority":"string",
  "confidence":0.0,
  "reasoning":"kurze, sachliche Begruendung",
  "legalBasis":["string"],
  "notes":["string"]
}

REGELN:
- responsibilityAuthority MUSS exakt einem Eintrag aus "ERLAUBTE ZUSTAENDIGKEITEN" entsprechen.
- Nutze Ticketinhalt, Kategorie, Geodaten, Nominatim/OSM-Hinweise und Strassenklassen (B/L/K + innerorts/ausserorts) aktiv.
- Beruecksichtige fuer Rheinland-Pfalz:
  1) GemO RLP (lokale Selbstverwaltungsaufgaben Ortsgemeinde und Verwaltungsaufgaben der Verbandsgemeinde),
  2) (L)VwVfG (sachliche/oertliche Zustaendigkeit, Weiterleitung unzustaendiger Anliegen),
  3) einschlaegiges Fachrecht (insb. Strassen-, Abfall-, Wasser-, Ordnungs- und Immissionsschutzrecht).
- Priorisiere folgende Orientierungen:
  - GemO RLP §67: Verbandsgemeinde bzw. verbandsfreie Gemeinde typischerweise fuer Brandschutz/technische Hilfe, Wasserversorgung, Abwasserbeseitigung, Gewaesser dritter Ordnung.
  - Ortsgemeinde typischerweise fuer stark oertlich-lokale Anliegen der Daseinsvorsorge ohne ueberoertlichen Traegerbezug.
  - Landkreis bzw. kreisfreie Stadt typischerweise bei Kreisaufgaben und haeufig bei Kreisstrasse ausserorts.
- Bei Bundesstrasse/Landesstrasse liegt die fachliche Strassenbaulast regelmaessig nicht bei Orts-/Verbandsgemeinde.
- Bei Kreisstrasse ausserorts ist haeufig der Landkreis traegerbezogen relevant.
- Bei unklarer Lage zwischen Ebenen: die voraussichtlich federfuehrende Ebene waehlen und in notes den Abgrenzungsgrund nennen.
- Begruendung nur faktenbasiert und ohne Spekulation.
- confidence strikt 0..1.
- legalBasis und notes kurz halten (je max. 5 Eintraege).
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_WORKFLOW_API_PROBE_ANALYSIS_PROMPT = `Du bist API-Integrationsarchitekt fuer kommunale Workflow-Automatisierung.

Analysiere einen Probe-Lauf eines REST_API_CALL-Schritts.
Du bekommst:
- JavaScript-Quelltext,
- Script-Input (Ticket/Workflow/Task),
- HTTP-Request-Historie,
- Script-Logs,
- Script-Output.

ZIEL:
- strukturiere die API-Antworten,
- benenne Integrationsrisiken,
- liefere konkrete Verbesserungsvorschlaege fuer den JS-Step.

OUTPUT: Nur JSON im Format
{
  "summary":"kurze Gesamtbewertung",
  "responseStructure":{
    "topLevelKeys":["..."],
    "statusFields":["..."],
    "idFields":["..."],
    "timestampFields":["..."],
    "notes":["..."]
  },
  "risks":["..."],
  "suggestedScriptImprovements":["..."],
  "mappingHints":{
    "patchTicket":{"status":"optional", "priority":"optional", "category":"optional"},
    "stateKeys":["..."],
    "nextTaskHints":["..."]
  }
}

REGELN:
- Keine Spekulation ueber nicht vorhandene Felder.
- Bei fehlender Antwortstruktur: klar als unbekannt markieren.
- Vorschlaege nur umsetzbar und kurz halten.
- Max. 8 Punkte pro Liste.
- Keine Erklaerungen ausserhalb JSON.`;

export const DEFAULT_AI_SITUATION_REPORT_PROMPT = `Du analysierst die komplette Meldelage fuer die Verwaltung.

OUTPUT (nur JSON):
{
  "summary":"Operatives Lagebild in 10-16 Saetzen (akut/strukturell/nachrangig priorisiert)",
  "hotspots":["..."],
  "patterns":["..."],
  "riskSignals":["..."],
  "immediateActions":["..."],
  "operationalRecommendations":["..."],
  "resourceHints":["..."],
  "coordinationHints":["..."],
  "abuseTrends":["..."],
  "frequentReporterPatterns":[{"reporter":"stable-pseudo-id","score":0.0,"reason":"..."}],
  "reporterAbuseScores":[{"reporter":"stable-pseudo-id","score":0.0,"riskLevel":"niedrig|mittel|hoch|kritisch","reason":"...","signals":["..."]}],
  "recommendedLabels":[{"ticketId":"...","label":"...","score":0.0}],
  "recommendedActions":["..."]
}

REGELN:
- Nur auf Basis gelieferter Daten entscheiden.
- Reporter ausschliesslich als STABILE Pseudonyme behandeln (stablePseudoName/stablePseudoEmail/reporterKey).
- Keine neuen Reporter-IDs erfinden, niemals reporter-000x erzeugen.
- score strikt 0..1.
- riskLevel nur: niedrig|mittel|hoch|kritisch.
- Unsichere Aussagen mit score <= 0.35 kennzeichnen.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_AI_SITUATION_CATEGORY_WORKFLOW_PROMPT = `Du bist Spezialist fuer kommunale Prozessoptimierung.
Dein Fokus: Kategorien, Workflow-Passung, Ticketlaufzeiten und operative Verbesserungen.

OUTPUT (nur JSON):
{
  "summary":"Kurzlage 8-14 Saetze mit Fokus auf Kategorie-/Workflow-Fit",
  "categoryWorkflowSummary":"Kompakte Management-Zusammenfassung mit den 3 wichtigsten Hebeln",
  "lifecycleRisks":["..."],
  "categoryFindings":[
    {
      "category":"...",
      "ticketCount":0,
      "openCount":0,
      "closedCount":0,
      "avgAgeHours":0.0,
      "avgClosedCycleHours":0.0,
      "workflowCoverage":0.0,
      "suggestedWorkflowTemplate":"...",
      "confidence":0.0,
      "bottlenecks":["..."],
      "actions":["..."]
    }
  ],
  "workflowRecommendations":[
    {
      "workflowTemplate":"...",
      "confidence":0.0,
      "fit":"hoch|mittel|niedrig",
      "reason":"...",
      "optimizations":["..."],
      "risks":["..."]
    }
  ],
  "categoryWorkflowMappingSuggestions":[
    {
      "category":"...",
      "recommendedWorkflowTemplate":"...",
      "confidence":0.0,
      "reason":"...",
      "expectedImpact":"..."
    }
  ],
  "optimizationBacklog":[
    {
      "title":"...",
      "impact":"hoch|mittel|niedrig",
      "effort":"hoch|mittel|niedrig",
      "owner":"...",
      "reason":"..."
    }
  ]
}

REGELN:
- Nur auf Basis gelieferter Daten entscheiden.
- Reporter ausschliesslich als STABILE Pseudonyme behandeln.
- Keine neuen Kategorien, Workflows, Reporter oder Tickets erfinden.
- score/confidence strikt 0..1.
- Bei Unsicherheit confidence <= 0.35.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_AI_SITUATION_FREE_ANALYSIS_PROMPT = `Du bist ein kommunaler Analyse-Assistent fuer freie Fachfragen.

OUTPUT (nur JSON):
{
  "summary":"Kurze Zusammenfassung in 4-10 Saetzen",
  "answer":"Direkte Antwort auf die benutzerdefinierte Fragestellung",
  "keyFindings":["..."],
  "recommendedActions":["..."],
  "confidence":0.0
}

REGELN:
- Beantworte die Fragestellung direkt und umsetzungsorientiert.
- Nutze ausschliesslich die gelieferten Daten und den Memory-Kontext.
- Keine Halluzinationen, keine neuen Tickets/Reporter/Kategorien erfinden.
- confidence strikt 0..1.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_AI_SITUATION_MEMORY_COMPRESSION_PROMPT = `Du komprimierst Analyse-Ergebnisse zu dauerhaft nutzbarem Kurzkontext.

OUTPUT (nur JSON):
{
  "summary":"Maximal 700 Zeichen, operative Kernaussage",
  "signals":["Signal A","Signal B"],
  "openQuestions":["..."],
  "recommendedFollowUp":["..."],
  "confidence":0.0
}

REGELN:
- Nur robuste Erkenntnisse behalten; Details und Duplikate entfernen.
- Unklare Aussagen als offene Fragen kennzeichnen statt als Fakt.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_LLM_PSEUDONYM_POOL_PROMPT = `Du erzeugst neutrale Pseudonym-Pools fuer Datenschutz.

OUTPUT (nur JSON):
{
  "namePool":["..."],
  "emailDomainPool":["buergerservice.de","hinweispost.net"]
}

REGELN:
- Namen kurz, neutral, nicht beleidigend, ohne Realpersonenbezug.
- Domains synthetisch und datenschutzfreundlich, aber mit gueltiger TLD (z. B. .de, .com, .net, .org, .eu, .info).
- Keine lokalen/reservierten TLDs wie .local, .localhost, .invalid, .test, .example.
- Keine Erklaerungen ausserhalb JSON.
`;

export const DEFAULT_IMAGE_ANALYSIS_PROMPT = `Du analysierst ein Bild aus einer kommunalen Buerger-Meldung.

OUTPUT (nur JSON):
{
  "description":"kurze sachliche Bildbeschreibung (max 900 Zeichen)",
  "confidence":0.0,
  "tags":["stichwort"],
  "warnings":["optional"]
}

REGELN:
- description nur beobachtbare Bildinhalte, keine Spekulation.
- Nutze den gelieferten Ticketkontext nur zur fachlichen Einordnung.
- Kontextmodule koennen optional sein (Beschreibung, OSM/Nominatim, Wetterdaten). Fehlt ein Modul, darf nichts halluziniert werden.
- Keine Rueckschluesse auf reale Identitaeten und keine Deanonymisierung.
- confidence strikt 0..1.
- tags maximal 8 kurze Stichwoerter.
- warnings nur wenn Unsicherheit oder Bildqualitaet problematisch ist.
- Keine Erklaerungen ausserhalb JSON.
`;

function stripLegacyAmtsblatt(prompt: string): string {
  if (!prompt || !/amtsblatt/i.test(prompt)) return prompt;
  return prompt
    .split('\n')
    .filter((line) => !/amtsblatt/i.test(line))
    .join('\n')
    .trim();
}

function ensureTemplateThemeGuidelines(prompt: string): string {
  const source = String(prompt || '').trim();
  if (!source) return DEFAULT_TEMPLATE_GENERATION_PROMPT;
  const hasThemeHint =
    /#003762/.test(source) ||
    /#00457c/.test(source) ||
    /Candara/i.test(source) ||
    /Verbandsgemeinde Otterbach-Otterberg/i.test(source);
  if (hasThemeHint) return source;
  return `${source}

THEME-PFLICHT (ergänzend):
- Header: linear-gradient(120deg,#003762,#00457c), Text weiss
- Content: Hintergrund weiss, Rahmen #c8d7e5, Akzentboxen #f1f6fb
- Schrift: Candara,'Segoe UI',Arial,sans-serif
  - Signatur:
  Verbandsgemeinde Otterbach-Otterberg
  behebes.AI – KI-basierter Schadensmelder`;
}

function appendPromptRulesIfMissing(
  prompt: string,
  validators: RegExp[],
  mandatoryBlock: string,
  fallbackPrompt: string
): string {
  const source = String(prompt || '').trim();
  const base = source || fallbackPrompt;
  const hasAllRules = validators.every((validator) => validator.test(base));
  if (hasAllRules) return base;
  return `${base}\n\n${mandatoryBlock}`.trim();
}

function ensureRedminePromptGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/BEGIN_JSON/i, /END_JSON/i, /assigneeRef/i, /projectName/i, /trackerName/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur BEGIN_JSON ... END_JSON.
- Nur JSON:
  {"subject":"...","description":"...","projectName":"...","trackerName":"...","assigneeRef":"...","assigneeName":"...","assigneeId":123}
- assigneeRef nur "user:<id>" oder "group:<id>", sonst leer.
- Keine Erklaerungen ausserhalb JSON.`,
    DEFAULT_REDMINE_PROMPT
  );
}

function ensureWorkflowTemplateGenerationGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/BEGIN_JSON/i, /END_JSON/i, /"template"/i, /task-<index>|task-\d/i, /IF|trueNextTaskIds/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur BEGIN_JSON ... END_JSON.
- Nur JSON im Format {"template":{...}}.
- Task-Referenzen nur als task-<index> und nur auf existierende Schritte.
- WAIT_STATUS_CHANGE nur mit gueltigen Mode/After-Feldpaaren, inkl. responsibilityAuthority.
- IF-Feldbedingungen fuer responsibilityAuthority nur mit equals/not_equals/is_empty/is_not_empty.
- Kein Markdown, keine Kommentare.`,
    DEFAULT_WORKFLOW_TEMPLATE_GENERATION_PROMPT
  );
}

function ensureWorkflowJsonRepairGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/BEGIN_JSON/i, /END_JSON/i, /"template"/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur BEGIN_JSON ... END_JSON.
- Nur JSON im Format {"template":{...}}.
- Syntax/Referenzen reparieren, keine inhaltlichen Halluzinationen.`,
    DEFAULT_WORKFLOW_JSON_REPAIR_PROMPT
  );
}

function ensureAdminAiHelpGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/admin/i, /schritt|nummeriert|liste/i, /keine erfundenen menues|keine halluzinationen|keine halluzination/i],
    `VERBINDLICHE VERHALTENSREGELN:
- Antworte mit kurzer Diagnose und konkreter Schrittfolge.
- Nur vorhandene Menues/Felder/Endpunkte referenzieren.
- Unsicherheiten als Annahme markieren und gezielt Rueckfragen stellen.
- Sicherheitsrelevante Hinweise (Tokens/Sessions/Rechte) aktiv nennen.`,
    DEFAULT_ADMIN_AI_HELP_PROMPT
  );
}

function ensureWorkflowSelectionGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/BEGIN_JSON/i, /END_JSON/i, /templateId/i, /confidence/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur BEGIN_JSON ... END_JSON.
- Nur JSON: {"templateId":"...","reasoning":"...","confidence":0.0}
- templateId nur aus uebergebenen Vorlagen.`,
    DEFAULT_WORKFLOW_SELECTION_PROMPT
  );
}

function ensureClassifyPromptGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/kategorie/i, /dringlichkeit/i, /JSON/i, /verfuegbare kategorien|kategorien/i, /bild/i, /angehaeng/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON: {"kategorie":"...","dringlichkeit":"low|medium|high|critical","reasoning":"..."}
- kategorie nur exakt aus uebergebenen Kategorien.
- Bei Unsicherheit "Sonstiges" (falls vorhanden), sonst erste uebergebene Kategorie.
- Wenn KI-Bildbeschreibungen vorhanden sind: Diese stammen aus den angehaengten Bildern; als Bildfakten beruecksichtigen.
- Keine Erklaerungen ausserhalb JSON.`,
    DEFAULT_CLASSIFY_PROMPT
  );
}

function ensureWorkflowDataRequestNeedCheckGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/requiresAdditionalData/i, /categoryConfidence/i, /priorityConfidence/i, /missingSignals/i, /JSON/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON mit requiresAdditionalData, categoryConfidence, priorityConfidence, overallConfidence, missingSignals, reasoning.
- Konfidenzen im Bereich 0..1.
- requiresAdditionalData=true bei niedriger Kategorie-/Prioritaetskonfidenz.`,
    DEFAULT_WORKFLOW_DATA_REQUEST_NEED_CHECK_PROMPT
  );
}

function ensureWorkflowDataRequestPromptGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/fields/i, /subject/i, /introText/i, /type/i, /required/i, /category|priorit/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON mit "subject", "introText" und "fields".
- Rueckfragen nur zur Reduktion von Unsicherheit in Kategorie/Prioritaet.
- Maximal die im Kontext erlaubte Feldanzahl.
- Bei KI-basierter Datennachforderung muss required immer false sein.
- Labels und Optionstexte in angeforderter Zielsprache.
- Keine Erklaerungen ausserhalb JSON.`,
    DEFAULT_WORKFLOW_DATA_REQUEST_PROMPT
  );
}

function ensureWorkflowDataRequestEvalGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/patchTicket/i, /comment/i, /confidence/i, /category|kategorien/i, /priority/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON mit patchTicket/comment/confidence.
- patchTicket.category nur aus uebergebenen Kategorien.
- Keine Erklaerungen ausserhalb JSON.`,
    DEFAULT_WORKFLOW_DATA_REQUEST_EVAL_PROMPT
  );
}

function ensureWorkflowFreeDataRequestNeedCheckGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/requiresAdditionalData/i, /overallConfidence|confidence/i, /missingSignals/i, /JSON/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON mit requiresAdditionalData, overallConfidence, missingSignals, reasoning.
- Konfidenz im Bereich 0..1.
- requiresAdditionalData=true, wenn missingSignals nicht leer ist.`,
    DEFAULT_WORKFLOW_FREE_DATA_REQUEST_NEED_CHECK_PROMPT
  );
}

function ensureWorkflowFreeDataRequestPromptGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/fields/i, /subject/i, /introText/i, /type/i, /required/i, /zieldefinition|objective/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON mit "subject", "introText" und "fields".
- Fragen strikt an Zieldefinition ausrichten.
- Maximal die im Kontext erlaubte Feldanzahl.
- required immer false.
- Labels und Optionstexte in angeforderter Zielsprache.
- Keine Erklaerungen ausserhalb JSON.`,
    DEFAULT_WORKFLOW_FREE_DATA_REQUEST_PROMPT
  );
}

function ensureWorkflowFreeDataRequestEvalGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/derivedVariables/i, /comment/i, /confidence/i, /JSON/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON mit derivedVariables/comment/confidence.
- derivedVariables nur bei belastbarer Ableitung aus Antworten.
- Keine Erklaerungen ausserhalb JSON.`,
    DEFAULT_WORKFLOW_FREE_DATA_REQUEST_EVAL_PROMPT
  );
}

function ensureWorkflowRecategorizationGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/category/i, /priority/i, /confidence/i, /kategorien|categories/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON mit category/priority/reasoning/confidence.
- category nur aus uebergebenen Kategorien.
- Bei Unsicherheit aktuelle Kategorie beibehalten.`,
    DEFAULT_WORKFLOW_RECATEGORIZATION_PROMPT
  );
}

function ensureWorkflowCategorizationOrgAssignmentGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/orgUnitId/i, /confidence/i, /reasoning/i, /kandidaten|candidates/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON mit orgUnitId/reasoning/confidence.
- orgUnitId nur aus uebergebenen Kandidaten-IDs.
- Bei Unsicherheit orgUnitId leer lassen.
- Keine Erklaerungen ausserhalb JSON.`,
    DEFAULT_WORKFLOW_CATEGORIZATION_ORG_ASSIGNMENT_PROMPT
  );
}

function ensureTemplateJsonRepairGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/subject/i, /htmlContent/i, /JSON/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON: {"subject":"...","htmlContent":"..."}
- Keine Erklaerungen ausserhalb JSON.
- Platzhalter unveraendert lassen.`,
    DEFAULT_TEMPLATE_JSON_REPAIR_PROMPT
  );
}

function ensureTemplatePlaceholderCompletionGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/subject/i, /htmlContent/i, /JSON/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON: {"subject":"...","htmlContent":"..."}
- Fehlende Pflicht-Platzhalter ergaenzen, sonst minimal-invasiv bleiben.`,
    DEFAULT_TEMPLATE_PLACEHOLDER_COMPLETION_PROMPT
  );
}

function ensureTranslationPromptGuidelines(prompt: string, fallbackPrompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/JSON/i, /keine|kein/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON-Antwort.
- Platzhalter, IDs, Links und Zahlen unveraendert lassen.
- Keine Erklaerungen ausserhalb JSON.`,
    fallbackPrompt
  );
}

function ensureImageAnalysisPromptGuidelines(prompt: string): string {
  return appendPromptRulesIfMissing(
    prompt,
    [/JSON/i, /description/i, /confidence/i, /tags/i, /warnings/i, /kontext|context/i],
    `VERBINDLICHE AUSGABEREGELN:
- Nur JSON mit description/confidence/tags/warnings.
- Ticketkontext (Beschreibung/OSM/Wetter) nur zur fachlichen Einordnung nutzen.
- Wenn Kontextmodule fehlen oder leer sind: keine Annahmen erfinden.
- Keine Erklaerungen ausserhalb JSON.`,
    DEFAULT_IMAGE_ANALYSIS_PROMPT
  );
}

function hasOwn(obj: Record<string, any> | null | undefined, key: string): boolean {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function mergeWithSources<T extends Record<string, any>>(
  defaults: T,
  env: Partial<T>,
  file: Partial<T>,
  db: Partial<T> | null
): SettingsWithSources<T> {
  const values: T = {
    ...defaults,
    ...file,
    ...env,
    ...(db || {}),
  } as T;

  const sources = Object.keys(defaults).reduce((acc, key) => {
    if (db && hasOwn(db, key)) {
      acc[key as keyof T] = 'db';
    } else if (hasOwn(env, key)) {
      acc[key as keyof T] = 'env';
    } else if (hasOwn(file, key)) {
      acc[key as keyof T] = 'file';
    } else {
      acc[key as keyof T] = 'default';
    }
    return acc;
  }, {} as Record<keyof T, SettingsSource>);

  return { values, sources };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const db = getDatabase();
  const row = await db.get(`SELECT \`value\` FROM system_settings WHERE \`key\` = ?`, [key]);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = getDatabase();
  const payload = JSON.stringify(value ?? null);
  await db.run(
    `INSERT INTO system_settings (\`key\`, \`value\`, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(\`key\`) DO UPDATE SET \`value\` = excluded.\`value\`, updated_at = CURRENT_TIMESTAMP`,
    [key, payload]
  );
}

// ---------------------------------------------------------------------------
// General settings
// ---------------------------------------------------------------------------
export interface GeneralSettings {
  callbackMode?: 'auto' | 'custom';
  callbackUrl: string;
  appName: string;
  webPush?: GeneralWebPushSettings;
  xmppRtc?: GeneralXmppRtcSettings;
  maintenanceMode?: boolean;
  maintenanceMessage?: string;
  restrictLocations?: boolean;
  allowedLocations?: string[];
  jurisdictionGeofence?: JurisdictionGeofenceConfig;
  responsibilityAuthorities?: string[];
  defaultLanguage?: string;
  workflowAbortNotificationEnabled?: boolean;
  workflowAbortRecipientEmail?: string;
  workflowAbortRecipientName?: string;
  citizenFrontend?: {
    intakeWorkflowTemplateId?: string;
    tenantId?: string;
    emailDoubleOptInTimeoutHours?: number;
    dataRequestTimeoutHours?: number;
    enhancedCategorizationTimeoutHours?: number;
    profiles?: Array<{
      id?: string;
      name?: string;
      token?: string;
      tenantId?: string;
      intakeWorkflowTemplateId?: string;
      authenticatedIntakeWorkflowTemplateId?: string | null;
      citizenAuthEnabled?: boolean;
      enabled?: boolean;
      headerTag?: string;
      headerKicker?: string;
      headerTitle?: string;
      headerSubtitle?: string;
      submissionKicker?: string;
      submissionTitle?: string;
      submissionSubtitle?: string;
    }>;
    announcementEnabled?: boolean;
    announcementMode?: 'banner' | 'modal';
    announcementTitle?: string;
    announcementMessage?: string;
    announcementSourceHash?: string;
    announcementTranslations?: Record<
      string,
      {
        title?: string;
        message?: string;
        sourceHash?: string;
      }
    >;
  };
  languages?: Array<{
    code: string;
    label: string;
    aiName?: string;
    locale?: string;
    dir?: 'ltr' | 'rtl';
    flag?: string;
  }>;
  routing?: Partial<RoutingSettings>;
}

export interface RoutingSettings {
  rootMode: 'platform' | 'tenant';
  rootTenantId: string;
  platformPath: string;
  tenantBasePath: '/c';
}

export interface GeneralWebPushSettings {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
}

export interface GeneralXmppRtcSettings {
  stunUrls: string[];
  turnUrls: string[];
  turnUsername: string;
  turnCredential: string;
}

export type WeatherApiKeyMode = 'none' | 'header' | 'query';
export type WeatherTemperatureUnit = 'celsius' | 'fahrenheit';
export type WeatherWindSpeedUnit = 'kmh' | 'ms' | 'mph' | 'kn';
export type WeatherPrecipitationUnit = 'mm' | 'inch';

export interface WeatherApiSettings {
  enabled: boolean;
  provider: 'open-meteo';
  archiveBaseUrl: string;
  forecastBaseUrl: string;
  apiKey: string;
  apiKeyMode: WeatherApiKeyMode;
  apiKeyHeaderName: string;
  apiKeyQueryParam: string;
  timeoutMs: number;
  userAgent: string;
  temperatureUnit: WeatherTemperatureUnit;
  windSpeedUnit: WeatherWindSpeedUnit;
  precipitationUnit: WeatherPrecipitationUnit;
}

export interface CitizenFrontendSettings {
  intakeWorkflowTemplateId: string;
  tenantId: string;
  emailDoubleOptInTimeoutHours: number;
  dataRequestTimeoutHours: number;
  enhancedCategorizationTimeoutHours: number;
  profiles: CitizenFrontendProfileSettings[];
  announcementEnabled: boolean;
  announcementMode: 'banner' | 'modal';
  announcementTitle: string;
  announcementMessage: string;
  announcementSourceHash: string;
  announcementTranslations: Record<
    string,
    {
      title: string;
      message: string;
      sourceHash?: string;
    }
  >;
}

export const DEFAULT_ROUTING_SETTINGS: RoutingSettings = {
  rootMode: 'platform',
  rootTenantId: '',
  platformPath: '/plattform',
  tenantBasePath: '/c',
};

export function normalizeGeneralWebPushSettings(
  input: unknown,
  fallback?: Partial<GeneralWebPushSettings>
): GeneralWebPushSettings {
  const source = input && typeof input === 'object' ? (input as Record<string, any>) : {};
  const publicKey = String(source.vapidPublicKey ?? fallback?.vapidPublicKey ?? '')
    .trim()
    .slice(0, 2000);
  const privateKey = String(source.vapidPrivateKey ?? fallback?.vapidPrivateKey ?? '')
    .trim()
    .slice(0, 2000);
  let subject = String(source.vapidSubject ?? fallback?.vapidSubject ?? 'mailto:noreply@example.com')
    .trim()
    .slice(0, 240);
  if (!subject) {
    subject = 'mailto:noreply@example.com';
  }
  if (!/^mailto:|^https?:\/\//i.test(subject)) {
    subject = `mailto:${subject}`;
  }
  return {
    vapidPublicKey: publicKey,
    vapidPrivateKey: privateKey,
    vapidSubject: subject,
  };
}

export function normalizeGeneralXmppRtcSettings(
  input: unknown,
  fallback?: Partial<GeneralXmppRtcSettings>
): GeneralXmppRtcSettings {
  const source =
    input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, any>) : {};
  const fallbackValue: GeneralXmppRtcSettings = {
    stunUrls: Array.isArray(fallback?.stunUrls) ? fallback!.stunUrls.map((entry) => String(entry || '').trim()).filter(Boolean) : [],
    turnUrls: Array.isArray(fallback?.turnUrls) ? fallback!.turnUrls.map((entry) => String(entry || '').trim()).filter(Boolean) : [],
    turnUsername: typeof fallback?.turnUsername === 'string' ? fallback.turnUsername.trim() : '',
    turnCredential: typeof fallback?.turnCredential === 'string' ? fallback.turnCredential.trim() : '',
  };

  const normalizeUrlList = (value: unknown, fallbackList: string[]): string[] => {
    const pushUnique = (bucket: string[], entry: string) => {
      const normalized = entry.trim();
      if (!normalized) return;
      if (bucket.some((item) => item.toLowerCase() === normalized.toLowerCase())) return;
      bucket.push(normalized);
    };

    const next: string[] = [];
    if (Array.isArray(value)) {
      for (const entry of value) {
        pushUnique(next, String(entry || ''));
      }
      return next.length > 0 ? next.slice(0, 24) : fallbackList.slice(0, 24);
    }
    const raw = String(value || '').trim();
    if (!raw) return fallbackList.slice(0, 24);
    raw
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => pushUnique(next, entry));
    return next.length > 0 ? next.slice(0, 24) : fallbackList.slice(0, 24);
  };

  const turnUsername =
    typeof source.turnUsername === 'string' ? source.turnUsername.trim().slice(0, 200) : fallbackValue.turnUsername;
  const turnCredential =
    typeof source.turnCredential === 'string' ? source.turnCredential.trim().slice(0, 300) : fallbackValue.turnCredential;

  return {
    stunUrls: normalizeUrlList(source.stunUrls, fallbackValue.stunUrls),
    turnUrls: normalizeUrlList(source.turnUrls, fallbackValue.turnUrls),
    turnUsername,
    turnCredential,
  };
}

function normalizePublicPath(value: unknown, fallbackPath: string): string {
  const raw = String(value || '').trim();
  const source = raw || fallbackPath;
  const withLeadingSlash = source.startsWith('/') ? source : `/${source}`;
  const normalized = withLeadingSlash.replace(/\/+$/g, '') || '/';
  return normalized;
}

function normalizePlatformPath(value: unknown, fallbackPath: string): string {
  const raw = String(value || '').trim();
  const source = raw || fallbackPath;
  const normalized = `/${source.replace(/^\/+|\/+$/g, '')}`;
  if (!normalized || normalized === '/') return fallbackPath;
  return normalized.slice(0, 120);
}

export function normalizeRoutingSettings(
  input: unknown,
  fallback: RoutingSettings = DEFAULT_ROUTING_SETTINGS
): RoutingSettings {
  const source = input && typeof input === 'object' ? (input as Record<string, any>) : {};
  const rootMode =
    String(source.rootMode || '').trim().toLowerCase() === 'tenant' ? 'tenant' : fallback.rootMode;
  const rootTenantId = String(source.rootTenantId || '').trim().slice(0, 120);
  const tenantBasePath: '/c' = '/c';
  const platformPath = normalizePlatformPath(source.platformPath, fallback.platformPath || '/plattform');
  return {
    rootMode,
    rootTenantId,
    platformPath,
    tenantBasePath,
  };
}

const RESERVED_PLATFORM_PATH_PREFIXES = [
  '/api',
  '/admin',
  '/verify',
  '/status',
  '/workflow',
  '/login',
  '/me',
  '/guide',
  '/privacy',
];

export function validateRoutingSettings(routing: RoutingSettings): string | null {
  const tenantBasePath = normalizePublicPath(routing.tenantBasePath || '/c', '/c');
  const platformPath = normalizePublicPath(routing.platformPath || '/plattform', '/plattform');

  if (platformPath === '/') {
    return 'Der Plattform-Unterpfad darf nicht "/" sein.';
  }

  if (platformPath === tenantBasePath || platformPath.startsWith(`${tenantBasePath}/`)) {
    return `Der Plattform-Unterpfad darf nicht mit "${tenantBasePath}" kollidieren.`;
  }

  const reservedPrefix = RESERVED_PLATFORM_PATH_PREFIXES.find(
    (prefix) => platformPath === prefix || platformPath.startsWith(`${prefix}/`)
  );
  if (reservedPrefix) {
    return `Der Plattform-Unterpfad "${platformPath}" kollidiert mit der reservierten Route "${reservedPrefix}".`;
  }

  return null;
}

export interface CitizenFrontendProfileSettings {
  id: string;
  name: string;
  token: string;
  tenantId: string;
  intakeWorkflowTemplateId: string;
  authenticatedIntakeWorkflowTemplateId: string;
  citizenAuthEnabled: boolean;
  enabled: boolean;
  headerTag: string;
  headerKicker: string;
  headerTitle: string;
  headerSubtitle: string;
  submissionKicker: string;
  submissionTitle: string;
  submissionSubtitle: string;
}

export interface ResolvedCitizenFrontendProfile {
  profileId: string;
  profileName: string;
  token: string;
  requestedToken: string;
  tokenMatched: boolean;
  intakeWorkflowTemplateId: string;
  tenantId: string;
  authenticatedIntakeWorkflowTemplateId: string;
  citizenAuthEnabled: boolean;
  headerTag: string;
  headerKicker: string;
  headerTitle: string;
  headerSubtitle: string;
  submissionKicker: string;
  submissionTitle: string;
  submissionSubtitle: string;
}

export interface JurisdictionGeofencePoint {
  lat: number;
  lon: number;
}

export interface JurisdictionGeofenceConfig {
  enabled: boolean;
  shape: 'circle' | 'polygon';
  centerLat?: number;
  centerLon?: number;
  radiusMeters?: number;
  points?: JurisdictionGeofencePoint[];
}

const DEFAULT_RESPONSIBILITY_AUTHORITIES = [
  'Ortsgemeinde',
  'Verbandsgemeinde / verbandsfreie Gemeinde',
  'Landkreis / kreisfreie Stadt',
  'Landesbehoerde',
];

export function normalizeResponsibilityAuthorities(
  input: unknown,
  fallback?: string[]
): string[] {
  const base = Array.isArray(input)
    ? input
    : Array.isArray(fallback)
    ? fallback
    : DEFAULT_RESPONSIBILITY_AUTHORITIES;

  const entries: string[] = [];
  const seen = new Set<string>();
  for (const rawEntry of base) {
    const value = String(rawEntry || '').trim().slice(0, 120);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(value);
    if (entries.length >= 30) break;
  }

  if (entries.length > 0) return entries;
  return [...DEFAULT_RESPONSIBILITY_AUTHORITIES];
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeGeofencePoints(value: unknown): JurisdictionGeofencePoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const source = entry as Record<string, any>;
      const lat = asFiniteNumber(source.lat ?? source.latitude);
      const lon = asFiniteNumber(source.lon ?? source.lng ?? source.longitude);
      if (lat === null || lon === null) return null;
      return { lat, lon };
    })
    .filter((entry): entry is JurisdictionGeofencePoint => entry !== null);
}

function normalizeCitizenFrontendSettings(input: unknown): CitizenFrontendSettings {
  const source = input && typeof input === 'object' ? (input as Record<string, any>) : {};
  const intakeWorkflowTemplateIdRaw =
    typeof source.intakeWorkflowTemplateId === 'string' ? source.intakeWorkflowTemplateId.trim() : '';
  const intakeWorkflowTemplateId = intakeWorkflowTemplateIdRaw || 'standard-intake-workflow';
  const normalizeTenantId = (value: unknown): string => String(value || '').trim().slice(0, 120);
  const tenantId = normalizeTenantId(source.tenantId || source.tenant_id);

  const sanitizeHours = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(24 * 30, Math.floor(parsed)));
  };

  const sanitizeAnnouncementText = (value: unknown, maxLength: number): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : '';
  };
  const sanitizeProfileText = (value: unknown, maxLength: number): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : '';
  };
  const parseEnabledFlag = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    }
    return false;
  };

  const normalizeProfileToken = (value: unknown): string =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 80);

  const normalizeProfileId = (value: unknown, fallback: string): string => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
    return normalized || fallback;
  };

  const normalizeProfileName = (value: unknown, fallback: string): string => {
    const normalized = String(value || '').trim().slice(0, 120);
    return normalized || fallback;
  };

  const normalizeFrontendProfiles = (
    value: unknown
  ): CitizenFrontendProfileSettings[] => {
    if (!Array.isArray(value)) return [];
    const result: CitizenFrontendProfileSettings[] = [];
    const seenIds = new Set<string>();
    const seenTokens = new Set<string>();

    value.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const profile = entry as Record<string, any>;
      const token = normalizeProfileToken(profile.token);
      if (!token || seenTokens.has(token)) return;

      const fallbackId = `profile-${index + 1}`;
      let id = normalizeProfileId(profile.id, fallbackId);
      let suffix = 2;
      while (seenIds.has(id)) {
        id = `${normalizeProfileId(profile.id, fallbackId)}-${suffix}`;
        suffix += 1;
      }

      seenIds.add(id);
      seenTokens.add(token);
      result.push({
        id,
        name: normalizeProfileName(profile.name, `Profil ${index + 1}`),
        token,
        tenantId: normalizeTenantId(profile.tenantId || profile.tenant_id || tenantId),
        intakeWorkflowTemplateId:
          typeof profile.intakeWorkflowTemplateId === 'string' && profile.intakeWorkflowTemplateId.trim()
            ? profile.intakeWorkflowTemplateId.trim()
            : intakeWorkflowTemplateId,
        authenticatedIntakeWorkflowTemplateId:
          typeof profile.authenticatedIntakeWorkflowTemplateId === 'string' &&
          profile.authenticatedIntakeWorkflowTemplateId.trim()
            ? profile.authenticatedIntakeWorkflowTemplateId.trim()
            : '',
        citizenAuthEnabled: parseEnabledFlag(profile.citizenAuthEnabled),
        enabled: profile.enabled !== false,
        headerTag: sanitizeProfileText(profile.headerTag, 80),
        headerKicker: sanitizeProfileText(profile.headerKicker, 120),
        headerTitle: sanitizeProfileText(profile.headerTitle, 160),
        headerSubtitle: sanitizeProfileText(profile.headerSubtitle, 240),
        submissionKicker: sanitizeProfileText(profile.submissionKicker, 120),
        submissionTitle: sanitizeProfileText(profile.submissionTitle, 160),
        submissionSubtitle: sanitizeProfileText(profile.submissionSubtitle, 400),
      });
    });

    return result.slice(0, 50);
  };

  const normalizeAnnouncementTranslations = (
    value: unknown
  ): CitizenFrontendSettings['announcementTranslations'] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const sourceMap = value as Record<string, any>;
    const result: CitizenFrontendSettings['announcementTranslations'] = {};
    for (const [rawCode, rawEntry] of Object.entries(sourceMap)) {
      const code = String(rawCode || '').trim().toLowerCase();
      if (!code) continue;
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
      const entry = rawEntry as Record<string, any>;
      const title = sanitizeAnnouncementText(entry.title, 240);
      const message = sanitizeAnnouncementText(entry.message, 4000);
      const sourceHash =
        typeof entry.sourceHash === 'string' && entry.sourceHash.trim()
          ? entry.sourceHash.trim().slice(0, 128)
          : undefined;
      if (!title && !message) continue;
      result[code] = sourceHash ? { title, message, sourceHash } : { title, message };
    }
    return result;
  };

  const announcementMode: 'banner' | 'modal' = source.announcementMode === 'modal' ? 'modal' : 'banner';
  const announcementTitle = sanitizeAnnouncementText(source.announcementTitle, 240);
  const announcementMessage = sanitizeAnnouncementText(source.announcementMessage, 4000);
  const announcementSourceHash =
    typeof source.announcementSourceHash === 'string' && source.announcementSourceHash.trim()
      ? source.announcementSourceHash.trim().slice(0, 128)
      : '';
  const announcementTranslations = normalizeAnnouncementTranslations(source.announcementTranslations);
  const profiles = normalizeFrontendProfiles(source.profiles);

  return {
    intakeWorkflowTemplateId,
    tenantId,
    emailDoubleOptInTimeoutHours: sanitizeHours(source.emailDoubleOptInTimeoutHours, 48),
    dataRequestTimeoutHours: sanitizeHours(source.dataRequestTimeoutHours, 72),
    enhancedCategorizationTimeoutHours: sanitizeHours(source.enhancedCategorizationTimeoutHours, 72),
    profiles,
    announcementEnabled: parseEnabledFlag(source.announcementEnabled),
    announcementMode,
    announcementTitle,
    announcementMessage,
    announcementSourceHash,
    announcementTranslations,
  };
}

function normalizeFrontendProfileTokenInput(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 80);
}

export function resolveCitizenFrontendProfile(
  settings: Pick<GeneralSettings, 'citizenFrontend'>,
  tokenInput: unknown
): ResolvedCitizenFrontendProfile {
  const citizenFrontend = normalizeCitizenFrontendSettings(settings?.citizenFrontend);
  const requestedToken = normalizeFrontendProfileTokenInput(tokenInput);
  const defaultIntakeWorkflowTemplateId =
    String(citizenFrontend.intakeWorkflowTemplateId || '').trim() || 'standard-intake-workflow';
  const defaultTenantId = String(citizenFrontend.tenantId || '').trim();

  if (!requestedToken) {
    return {
      profileId: 'default',
      profileName: 'Standard',
      token: '',
      requestedToken: '',
      tokenMatched: false,
      intakeWorkflowTemplateId: defaultIntakeWorkflowTemplateId,
      tenantId: defaultTenantId,
      authenticatedIntakeWorkflowTemplateId: '',
      citizenAuthEnabled: true,
      headerTag: '',
      headerKicker: '',
      headerTitle: '',
      headerSubtitle: '',
      submissionKicker: '',
      submissionTitle: '',
      submissionSubtitle: '',
    };
  }

  const matched = citizenFrontend.profiles.find(
    (profile) => profile.enabled !== false && profile.token === requestedToken
  );
  if (!matched) {
    return {
      profileId: 'default',
      profileName: 'Standard',
      token: '',
      requestedToken,
      tokenMatched: false,
      intakeWorkflowTemplateId: defaultIntakeWorkflowTemplateId,
      tenantId: defaultTenantId,
      authenticatedIntakeWorkflowTemplateId: '',
      citizenAuthEnabled: true,
      headerTag: '',
      headerKicker: '',
      headerTitle: '',
      headerSubtitle: '',
      submissionKicker: '',
      submissionTitle: '',
      submissionSubtitle: '',
    };
  }

  return {
    profileId: matched.id || 'default',
    profileName: matched.name || 'Profil',
    token: matched.token,
    requestedToken,
    tokenMatched: true,
    intakeWorkflowTemplateId:
      String(matched.intakeWorkflowTemplateId || '').trim() || defaultIntakeWorkflowTemplateId,
    tenantId: String(matched.tenantId || '').trim() || defaultTenantId,
    authenticatedIntakeWorkflowTemplateId:
      String(matched.authenticatedIntakeWorkflowTemplateId || '').trim(),
    citizenAuthEnabled: matched.citizenAuthEnabled === true,
    headerTag: String(matched.headerTag || '').trim(),
    headerKicker: String(matched.headerKicker || '').trim(),
    headerTitle: String(matched.headerTitle || '').trim(),
    headerSubtitle: String(matched.headerSubtitle || '').trim(),
    submissionKicker: String(matched.submissionKicker || '').trim(),
    submissionTitle: String(matched.submissionTitle || '').trim(),
    submissionSubtitle: String(matched.submissionSubtitle || '').trim(),
  };
}

export function normalizeJurisdictionGeofence(
  input: unknown,
  fallback?: JurisdictionGeofenceConfig
): JurisdictionGeofenceConfig {
  const source = input && typeof input === 'object' ? (input as Record<string, any>) : {};
  const defaultFallback: JurisdictionGeofenceConfig = fallback
    ? {
        enabled: !!fallback.enabled,
        shape: fallback.shape === 'polygon' ? 'polygon' : 'circle',
        centerLat: asFiniteNumber(fallback.centerLat) ?? undefined,
        centerLon: asFiniteNumber(fallback.centerLon) ?? undefined,
        radiusMeters: asFiniteNumber(fallback.radiusMeters) ?? 5000,
        points: normalizeGeofencePoints(fallback.points),
      }
    : {
        enabled: false,
        shape: 'circle',
        centerLat: undefined,
        centerLon: undefined,
        radiusMeters: 5000,
        points: [],
      };

  const points = normalizeGeofencePoints(source.points);
  const shapeRaw = String(source.shape || defaultFallback.shape || 'circle').trim().toLowerCase();
  const shape: 'circle' | 'polygon' = shapeRaw === 'polygon' ? 'polygon' : 'circle';
  const centerLat = asFiniteNumber(source.centerLat) ?? defaultFallback.centerLat;
  const centerLon = asFiniteNumber(source.centerLon) ?? defaultFallback.centerLon;
  const radiusMeters =
    asFiniteNumber(source.radiusMeters) !== null
      ? Math.max(1, Number(asFiniteNumber(source.radiusMeters)))
      : defaultFallback.radiusMeters ?? 5000;

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : defaultFallback.enabled,
    shape,
    centerLat: centerLat ?? undefined,
    centerLon: centerLon ?? undefined,
    radiusMeters: Number.isFinite(radiusMeters) ? radiusMeters : 5000,
    points: points.length > 0 ? points : defaultFallback.points || [],
  };
}

export function normalizeWeatherApiSettings(
  input: unknown,
  fallback?: Partial<WeatherApiSettings>
): WeatherApiSettings {
  const source = input && typeof input === 'object' ? (input as Record<string, any>) : {};
  const defaults: WeatherApiSettings = {
    enabled: fallback?.enabled !== undefined ? !!fallback.enabled : true,
    provider: 'open-meteo',
    archiveBaseUrl: typeof fallback?.archiveBaseUrl === 'string' && fallback.archiveBaseUrl.trim()
      ? fallback.archiveBaseUrl.trim()
      : 'https://archive-api.open-meteo.com',
    forecastBaseUrl: typeof fallback?.forecastBaseUrl === 'string' && fallback.forecastBaseUrl.trim()
      ? fallback.forecastBaseUrl.trim()
      : 'https://api.open-meteo.com',
    apiKey: typeof fallback?.apiKey === 'string' ? fallback.apiKey : '',
    apiKeyMode:
      fallback?.apiKeyMode === 'header' || fallback?.apiKeyMode === 'query'
        ? fallback.apiKeyMode
        : 'none',
    apiKeyHeaderName:
      typeof fallback?.apiKeyHeaderName === 'string' && fallback.apiKeyHeaderName.trim()
        ? fallback.apiKeyHeaderName.trim()
        : 'X-API-Key',
    apiKeyQueryParam:
      typeof fallback?.apiKeyQueryParam === 'string' && fallback.apiKeyQueryParam.trim()
        ? fallback.apiKeyQueryParam.trim()
        : 'apikey',
    timeoutMs: Number.isFinite(Number(fallback?.timeoutMs)) ? Math.max(500, Math.min(30000, Number(fallback?.timeoutMs))) : 5500,
    userAgent:
      typeof fallback?.userAgent === 'string' && fallback.userAgent.trim()
        ? fallback.userAgent.trim()
        : 'behebes-ai/1.0 (Verbandsgemeinde Otterbach Otterberg)',
    temperatureUnit: fallback?.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    windSpeedUnit:
      fallback?.windSpeedUnit === 'ms' || fallback?.windSpeedUnit === 'mph' || fallback?.windSpeedUnit === 'kn'
        ? fallback.windSpeedUnit
        : 'kmh',
    precipitationUnit: fallback?.precipitationUnit === 'inch' ? 'inch' : 'mm',
  };

  const parseString = (value: unknown, fallbackValue: string): string => {
    if (typeof value !== 'string') return fallbackValue;
    const trimmed = value.trim();
    return trimmed || fallbackValue;
  };

  const parseUrl = (value: unknown, fallbackValue: string): string => {
    const raw = parseString(value, fallbackValue).replace(/\/+$/g, '');
    try {
      return new URL(raw).toString().replace(/\/+$/g, '');
    } catch {
      return fallbackValue;
    }
  };

  const parseApiKeyMode = (value: unknown, fallbackValue: WeatherApiKeyMode): WeatherApiKeyMode => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'header' || raw === 'query' || raw === 'none') return raw;
    return fallbackValue;
  };

  const parseTimeout = (value: unknown, fallbackValue: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.max(500, Math.min(30000, Math.floor(parsed)));
  };

  const parseTemperatureUnit = (value: unknown, fallbackValue: WeatherTemperatureUnit): WeatherTemperatureUnit => {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'fahrenheit' ? 'fahrenheit' : fallbackValue;
  };

  const parseWindSpeedUnit = (value: unknown, fallbackValue: WeatherWindSpeedUnit): WeatherWindSpeedUnit => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'ms' || raw === 'mph' || raw === 'kn' || raw === 'kmh') return raw;
    return fallbackValue;
  };

  const parsePrecipitationUnit = (
    value: unknown,
    fallbackValue: WeatherPrecipitationUnit
  ): WeatherPrecipitationUnit => {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'inch' ? 'inch' : fallbackValue;
  };

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
    provider: 'open-meteo',
    archiveBaseUrl: parseUrl(source.archiveBaseUrl, defaults.archiveBaseUrl),
    forecastBaseUrl: parseUrl(source.forecastBaseUrl, defaults.forecastBaseUrl),
    apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : defaults.apiKey,
    apiKeyMode: parseApiKeyMode(source.apiKeyMode, defaults.apiKeyMode),
    apiKeyHeaderName: parseString(source.apiKeyHeaderName, defaults.apiKeyHeaderName).slice(0, 80),
    apiKeyQueryParam: parseString(source.apiKeyQueryParam, defaults.apiKeyQueryParam).slice(0, 80),
    timeoutMs: parseTimeout(source.timeoutMs, defaults.timeoutMs),
    userAgent: parseString(source.userAgent, defaults.userAgent).slice(0, 180),
    temperatureUnit: parseTemperatureUnit(source.temperatureUnit, defaults.temperatureUnit),
    windSpeedUnit: parseWindSpeedUnit(source.windSpeedUnit, defaults.windSpeedUnit),
    precipitationUnit: parsePrecipitationUnit(source.precipitationUnit, defaults.precipitationUnit),
  };
}

export async function loadGeneralSettings(): Promise<SettingsWithSources<GeneralSettings>> {
  const defaultCallbackUrl = deriveDefaultCallbackUrl(process.env.FRONTEND_URL);

  const defaults: GeneralSettings = {
    callbackMode: 'auto',
    callbackUrl: defaultCallbackUrl,
    appName: 'OI App',
    webPush: normalizeGeneralWebPushSettings({
      vapidPublicKey: '',
      vapidPrivateKey: '',
      vapidSubject: 'mailto:noreply@example.com',
    }),
    xmppRtc: normalizeGeneralXmppRtcSettings({
      stunUrls: String(process.env.XMPP_RTC_STUN_URLS || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      turnUrls: String(process.env.XMPP_RTC_TURN_URLS || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      turnUsername: String(process.env.XMPP_RTC_TURN_USERNAME || '').trim(),
      turnCredential: String(process.env.XMPP_RTC_TURN_CREDENTIAL || '').trim(),
    }),
    maintenanceMode: false,
    maintenanceMessage: '',
    restrictLocations: false,
    allowedLocations: [],
    jurisdictionGeofence: normalizeJurisdictionGeofence(null),
    responsibilityAuthorities: normalizeResponsibilityAuthorities(null),
    defaultLanguage: 'de',
    workflowAbortNotificationEnabled: false,
    workflowAbortRecipientEmail: '',
    workflowAbortRecipientName: '',
    citizenFrontend: normalizeCitizenFrontendSettings(null),
    languages: [],
    routing: normalizeRoutingSettings(null),
  };

  const env: Partial<GeneralSettings> = {};
  if (process.env.CALLBACK_URL) {
    env.callbackMode = 'custom';
    env.callbackUrl = process.env.CALLBACK_URL;
  }
  if (process.env.APP_NAME) env.appName = process.env.APP_NAME;
  if (process.env.WEB_PUSH_VAPID_PUBLIC_KEY || process.env.WEB_PUSH_VAPID_PRIVATE_KEY || process.env.WEB_PUSH_VAPID_SUBJECT) {
    env.webPush = normalizeGeneralWebPushSettings({
      vapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '',
      vapidPrivateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '',
      vapidSubject: process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:noreply@example.com',
    });
  }
  if (
    process.env.XMPP_RTC_STUN_URLS ||
    process.env.XMPP_RTC_TURN_URLS ||
    process.env.XMPP_RTC_TURN_USERNAME ||
    process.env.XMPP_RTC_TURN_CREDENTIAL
  ) {
    env.xmppRtc = normalizeGeneralXmppRtcSettings(
      {
        stunUrls: String(process.env.XMPP_RTC_STUN_URLS || '')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        turnUrls: String(process.env.XMPP_RTC_TURN_URLS || '')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        turnUsername: String(process.env.XMPP_RTC_TURN_USERNAME || '').trim(),
        turnCredential: String(process.env.XMPP_RTC_TURN_CREDENTIAL || '').trim(),
      },
      defaults.xmppRtc
    );
  }
  if (process.env.WORKFLOW_ABORT_NOTIFICATION_ENABLED) {
    const value = process.env.WORKFLOW_ABORT_NOTIFICATION_ENABLED.trim().toLowerCase();
    env.workflowAbortNotificationEnabled = ['1', 'true', 'yes', 'on'].includes(value);
  }
  if (process.env.WORKFLOW_ABORT_RECIPIENT_EMAIL) {
    env.workflowAbortRecipientEmail = process.env.WORKFLOW_ABORT_RECIPIENT_EMAIL;
  }
  if (process.env.WORKFLOW_ABORT_RECIPIENT_NAME) {
    env.workflowAbortRecipientName = process.env.WORKFLOW_ABORT_RECIPIENT_NAME;
  }

  const file = (await readJsonFile<Partial<GeneralSettings>>(GENERAL_CONFIG_PATH)) || {};
  const db = await getSetting<Partial<GeneralSettings>>('general');

  const merged = mergeWithSources(defaults, env, file || {}, db);
  let callbackMode: 'auto' | 'custom' = merged.values.callbackMode === 'custom' ? 'custom' : 'auto';
  let callbackUrl = merged.values.callbackUrl || defaultCallbackUrl;

  if (callbackMode === 'custom') {
    try {
      callbackUrl = new URL(callbackUrl).toString();
    } catch {
      callbackUrl = defaultCallbackUrl;
      callbackMode = 'auto';
    }
  } else {
    callbackUrl = defaultCallbackUrl;
  }

  merged.values.callbackMode = callbackMode;
  merged.values.callbackUrl = callbackUrl;
  merged.values.webPush = normalizeGeneralWebPushSettings(merged.values.webPush, defaults.webPush);
  merged.values.xmppRtc = normalizeGeneralXmppRtcSettings(merged.values.xmppRtc, defaults.xmppRtc);
  merged.values.jurisdictionGeofence = normalizeJurisdictionGeofence(
    merged.values.jurisdictionGeofence,
    defaults.jurisdictionGeofence
  );
  merged.values.responsibilityAuthorities = normalizeResponsibilityAuthorities(
    merged.values.responsibilityAuthorities,
    defaults.responsibilityAuthorities
  );
  merged.values.citizenFrontend = normalizeCitizenFrontendSettings(merged.values.citizenFrontend);
  const defaultRouting = normalizeRoutingSettings(defaults.routing, DEFAULT_ROUTING_SETTINGS);
  merged.values.routing = normalizeRoutingSettings(merged.values.routing, defaultRouting);
  return merged;
}

export async function loadWeatherApiSettings(maskSecrets = false): Promise<SettingsWithSources<WeatherApiSettings>> {
  const defaults = normalizeWeatherApiSettings(null);

  const env: Partial<WeatherApiSettings> = {};
  if (process.env.WEATHER_API_ENABLED) {
    const raw = process.env.WEATHER_API_ENABLED.trim().toLowerCase();
    env.enabled = ['1', 'true', 'yes', 'on'].includes(raw);
  }
  if (process.env.WEATHER_API_ARCHIVE_BASE_URL) {
    env.archiveBaseUrl = process.env.WEATHER_API_ARCHIVE_BASE_URL;
  }
  if (process.env.WEATHER_API_FORECAST_BASE_URL) {
    env.forecastBaseUrl = process.env.WEATHER_API_FORECAST_BASE_URL;
  }
  if (process.env.WEATHER_API_KEY) {
    env.apiKey = process.env.WEATHER_API_KEY;
  }
  if (process.env.WEATHER_API_KEY_MODE) {
    const raw = process.env.WEATHER_API_KEY_MODE.trim().toLowerCase();
    if (raw === 'header' || raw === 'query' || raw === 'none') env.apiKeyMode = raw;
  }
  if (process.env.WEATHER_API_KEY_HEADER_NAME) {
    env.apiKeyHeaderName = process.env.WEATHER_API_KEY_HEADER_NAME;
  }
  if (process.env.WEATHER_API_KEY_QUERY_PARAM) {
    env.apiKeyQueryParam = process.env.WEATHER_API_KEY_QUERY_PARAM;
  }
  if (process.env.WEATHER_API_TIMEOUT_MS) {
    const timeout = Number(process.env.WEATHER_API_TIMEOUT_MS);
    if (Number.isFinite(timeout)) env.timeoutMs = timeout;
  }
  if (process.env.WEATHER_API_USER_AGENT) {
    env.userAgent = process.env.WEATHER_API_USER_AGENT;
  }
  if (process.env.WEATHER_API_TEMPERATURE_UNIT) {
    const raw = process.env.WEATHER_API_TEMPERATURE_UNIT.trim().toLowerCase();
    if (raw === 'celsius' || raw === 'fahrenheit') env.temperatureUnit = raw;
  }
  if (process.env.WEATHER_API_WIND_SPEED_UNIT) {
    const raw = process.env.WEATHER_API_WIND_SPEED_UNIT.trim().toLowerCase();
    if (raw === 'kmh' || raw === 'ms' || raw === 'mph' || raw === 'kn') env.windSpeedUnit = raw;
  }
  if (process.env.WEATHER_API_PRECIPITATION_UNIT) {
    const raw = process.env.WEATHER_API_PRECIPITATION_UNIT.trim().toLowerCase();
    if (raw === 'mm' || raw === 'inch') env.precipitationUnit = raw;
  }

  const db = await getSetting<Partial<WeatherApiSettings>>('weatherApi');
  const merged = mergeWithSources(defaults, env, {}, db || {});
  merged.values = normalizeWeatherApiSettings(merged.values, defaults);
  if (maskSecrets && merged.values.apiKey) {
    merged.values.apiKey = '***';
  }
  return merged;
}

// ---------------------------------------------------------------------------
// SMTP settings
// ---------------------------------------------------------------------------
export interface SmtpSettings {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  smtpFromEmail: string;
  smtpFromName: string;
}

interface TenantEmailSettingsRow {
  tenant_id: string;
  smtp_json: string | null;
  imap_json: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

function normalizeTenantId(value: unknown): string {
  return String(value || '').trim();
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string') return {};
  const normalized = value.trim();
  if (!normalized) return {};
  try {
    const parsed = JSON.parse(normalized);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return {};
  }
  return {};
}

function normalizeSmtpPartial(value: unknown): Partial<SmtpSettings> {
  const source = parseJsonObject(value);
  const normalized: Partial<SmtpSettings> = {};
  if (hasOwn(source, 'smtpHost')) normalized.smtpHost = String(source.smtpHost || '').trim();
  if (hasOwn(source, 'smtpPort')) normalized.smtpPort = String(source.smtpPort || '').trim();
  if (hasOwn(source, 'smtpUser')) normalized.smtpUser = String(source.smtpUser || '').trim();
  if (hasOwn(source, 'smtpPassword')) normalized.smtpPassword = String(source.smtpPassword || '');
  if (hasOwn(source, 'smtpFromEmail')) normalized.smtpFromEmail = String(source.smtpFromEmail || '').trim();
  if (hasOwn(source, 'smtpFromName')) normalized.smtpFromName = String(source.smtpFromName || '').trim();
  return normalized;
}

function normalizeImapPartial(value: unknown): Partial<ImapSettings> {
  const source = parseJsonObject(value);
  const normalized: Partial<ImapSettings> = {};
  if (hasOwn(source, 'enabled')) normalized.enabled = parseBooleanFlag(source.enabled, false);
  if (hasOwn(source, 'imapHost')) normalized.imapHost = String(source.imapHost || '').trim();
  if (hasOwn(source, 'imapPort')) normalized.imapPort = String(source.imapPort || '').trim();
  if (hasOwn(source, 'imapSecure')) normalized.imapSecure = parseBooleanFlag(source.imapSecure, true);
  if (hasOwn(source, 'imapUser')) normalized.imapUser = String(source.imapUser || '').trim();
  if (hasOwn(source, 'imapPassword')) normalized.imapPassword = String(source.imapPassword || '');
  if (hasOwn(source, 'imapMailbox')) normalized.imapMailbox = String(source.imapMailbox || '').trim();
  if (hasOwn(source, 'syncLimit')) {
    const parsed = Number(source.syncLimit);
    if (Number.isFinite(parsed)) normalized.syncLimit = Math.max(1, Math.min(500, Math.floor(parsed)));
  }
  if (hasOwn(source, 'syncIntervalMinutes')) {
    const parsed = Number(source.syncIntervalMinutes);
    if (Number.isFinite(parsed)) normalized.syncIntervalMinutes = Math.max(1, Math.min(1440, Math.floor(parsed)));
  }
  return normalized;
}

async function loadTenantEmailSettingsRow(tenantId: string): Promise<TenantEmailSettingsRow | null> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) return null;
  const db = getDatabase();
  const row = await db.get<TenantEmailSettingsRow>(
    `SELECT tenant_id, smtp_json, imap_json, updated_at, updated_by
     FROM tenant_settings_email
     WHERE tenant_id = ?
     LIMIT 1`,
    [normalizedTenantId]
  );
  return row || null;
}

function buildTenantEmailSettingId(tenantId: string): string {
  return `tenantmail_${normalizeTenantId(tenantId)}_${Date.now()}`;
}

export async function saveTenantSmtpSettings(
  tenantId: string,
  smtp: SmtpSettings,
  updatedBy?: string | null
): Promise<void> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) throw new Error('tenantId fehlt.');
  const db = getDatabase();
  await db.run(
    `INSERT INTO tenant_settings_email (id, tenant_id, smtp_json, updated_at, updated_by)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(tenant_id)
     DO UPDATE SET smtp_json = excluded.smtp_json, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by`,
    [buildTenantEmailSettingId(normalizedTenantId), normalizedTenantId, JSON.stringify(smtp || {}), updatedBy || null]
  );
}

export async function saveTenantImapSettings(
  tenantId: string,
  imap: ImapSettings,
  updatedBy?: string | null
): Promise<void> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) throw new Error('tenantId fehlt.');
  const db = getDatabase();
  await db.run(
    `INSERT INTO tenant_settings_email (id, tenant_id, imap_json, updated_at, updated_by)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(tenant_id)
     DO UPDATE SET imap_json = excluded.imap_json, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by`,
    [buildTenantEmailSettingId(normalizedTenantId), normalizedTenantId, JSON.stringify(imap || {}), updatedBy || null]
  );
}

export async function loadSmtpSettings(maskSecrets = false): Promise<SettingsWithSources<SmtpSettings>> {
  const defaults: SmtpSettings = {
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPassword: '',
    smtpFromEmail: '',
    smtpFromName: 'OI App',
  };

  const env: Partial<SmtpSettings> = {};
  if (process.env.SMTP_HOST) env.smtpHost = process.env.SMTP_HOST;
  if (process.env.SMTP_PORT) env.smtpPort = process.env.SMTP_PORT;
  if (process.env.SMTP_USER) env.smtpUser = process.env.SMTP_USER;
  if (process.env.SMTP_PASSWORD || process.env.SMTP_PASS) {
    env.smtpPassword = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '';
  }
  if (process.env.SMTP_FROM_EMAIL || process.env.SMTP_FROM) {
    env.smtpFromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_FROM || '';
  }
  if (process.env.SMTP_FROM_NAME) env.smtpFromName = process.env.SMTP_FROM_NAME;

  const db = await getSetting<Partial<SmtpSettings>>('smtp');

  const merged = mergeWithSources(defaults, env, {}, db);
  if (maskSecrets && merged.values.smtpPassword) {
    merged.values.smtpPassword = '***';
  }
  return merged;
}

export async function loadSmtpSettingsForTenant(
  tenantId: string,
  maskSecrets = false
): Promise<SettingsWithSources<SmtpSettings>> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) return loadSmtpSettings(maskSecrets);

  const global = await loadSmtpSettings(false);
  const row = await loadTenantEmailSettingsRow(normalizedTenantId);
  const tenantOverride = normalizeSmtpPartial(row?.smtp_json);
  const values: SmtpSettings = {
    ...global.values,
    ...tenantOverride,
  };
  const sources: Record<keyof SmtpSettings, SettingsSource> = { ...global.sources };
  (Object.keys(values) as Array<keyof SmtpSettings>).forEach((key) => {
    if (hasOwn(tenantOverride as Record<string, any>, String(key))) {
      sources[key] = 'tenant';
    }
  });
  if (maskSecrets && values.smtpPassword) {
    values.smtpPassword = '***';
  }
  return { values, sources };
}

// ---------------------------------------------------------------------------
// IMAP settings
// ---------------------------------------------------------------------------
export interface ImapSettings {
  enabled: boolean;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  imapUser: string;
  imapPassword: string;
  imapMailbox: string;
  syncLimit: number;
  syncIntervalMinutes: number;
}

function parseBooleanFlag(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function deriveImapHostFromSmtpHost(smtpHost: string): string {
  const normalized = String(smtpHost || '').trim();
  if (!normalized) return '';
  if (/^smtp\./i.test(normalized)) return normalized.replace(/^smtp\./i, 'imap.');
  return normalized;
}

function normalizeImapSettingsValues(values: ImapSettings, defaults: ImapSettings): ImapSettings {
  const normalized: ImapSettings = {
    ...values,
  };
  normalized.enabled = parseBooleanFlag(normalized.enabled, false);
  normalized.imapHost = String(normalized.imapHost || '').trim();
  normalized.imapPort = String(normalized.imapPort || '').trim() || '993';
  normalized.imapSecure = parseBooleanFlag(normalized.imapSecure, true);
  normalized.imapUser = String(normalized.imapUser || '').trim();
  normalized.imapPassword = String(normalized.imapPassword || '');
  normalized.imapMailbox = String(normalized.imapMailbox || '').trim() || 'INBOX';
  const normalizedLimit = Number(normalized.syncLimit);
  normalized.syncLimit = Number.isFinite(normalizedLimit)
    ? Math.max(1, Math.min(500, Math.floor(normalizedLimit)))
    : defaults.syncLimit;
  const normalizedInterval = Number(normalized.syncIntervalMinutes);
  normalized.syncIntervalMinutes = Number.isFinite(normalizedInterval)
    ? Math.max(1, Math.min(1440, Math.floor(normalizedInterval)))
    : defaults.syncIntervalMinutes;
  return normalized;
}

export async function loadImapSettings(maskSecrets = false): Promise<SettingsWithSources<ImapSettings>> {
  const smtp = await loadSmtpSettings(false);
  const defaults: ImapSettings = {
    enabled: false,
    imapHost: deriveImapHostFromSmtpHost(smtp.values.smtpHost),
    imapPort: '993',
    imapSecure: true,
    imapUser: smtp.values.smtpUser || '',
    imapPassword: smtp.values.smtpPassword || '',
    imapMailbox: 'INBOX',
    syncLimit: 80,
    syncIntervalMinutes: 2,
  };

  const env: Partial<ImapSettings> = {};
  if (process.env.IMAP_ENABLED) env.enabled = parseBooleanFlag(process.env.IMAP_ENABLED, defaults.enabled);
  if (process.env.IMAP_HOST) env.imapHost = process.env.IMAP_HOST;
  if (process.env.IMAP_PORT) env.imapPort = process.env.IMAP_PORT;
  if (process.env.IMAP_SECURE) env.imapSecure = parseBooleanFlag(process.env.IMAP_SECURE, defaults.imapSecure);
  if (process.env.IMAP_USER) env.imapUser = process.env.IMAP_USER;
  if (process.env.IMAP_PASSWORD || process.env.IMAP_PASS) {
    env.imapPassword = process.env.IMAP_PASSWORD || process.env.IMAP_PASS || '';
  }
  if (process.env.IMAP_MAILBOX) env.imapMailbox = process.env.IMAP_MAILBOX;
  if (process.env.IMAP_SYNC_LIMIT) {
    const parsed = Number(process.env.IMAP_SYNC_LIMIT);
    if (Number.isFinite(parsed)) env.syncLimit = parsed;
  }
  if (process.env.IMAP_SYNC_INTERVAL_MINUTES) {
    const parsed = Number(process.env.IMAP_SYNC_INTERVAL_MINUTES);
    if (Number.isFinite(parsed)) env.syncIntervalMinutes = parsed;
  }

  const db = await getSetting<Partial<ImapSettings>>('imap');
  const merged = mergeWithSources(defaults, env, {}, db || {});
  merged.values = normalizeImapSettingsValues(merged.values, defaults);

  if (maskSecrets && merged.values.imapPassword) {
    merged.values.imapPassword = '***';
  }
  return merged;
}

export async function loadImapSettingsForTenant(
  tenantId: string,
  maskSecrets = false
): Promise<SettingsWithSources<ImapSettings>> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) return loadImapSettings(maskSecrets);

  const global = await loadImapSettings(false);
  const row = await loadTenantEmailSettingsRow(normalizedTenantId);
  const tenantOverride = normalizeImapPartial(row?.imap_json);
  const values = normalizeImapSettingsValues(
    {
      ...global.values,
      ...tenantOverride,
    } as ImapSettings,
    global.values
  );
  const sources: Record<keyof ImapSettings, SettingsSource> = { ...global.sources };
  (Object.keys(values) as Array<keyof ImapSettings>).forEach((key) => {
    if (hasOwn(tenantOverride as Record<string, any>, String(key))) {
      sources[key] = 'tenant';
    }
  });
  if (maskSecrets && values.imapPassword) {
    values.imapPassword = '***';
  }
  return { values, sources };
}

export async function loadTenantEffectiveEmailSettings(
  tenantId: string,
  maskSecrets = false
): Promise<{
  tenantId: string;
  smtp: SettingsWithSources<SmtpSettings>;
  imap: SettingsWithSources<ImapSettings>;
}> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) {
    throw new Error('tenantId fehlt.');
  }
  const [smtp, imap] = await Promise.all([
    loadSmtpSettingsForTenant(normalizedTenantId, maskSecrets),
    loadImapSettingsForTenant(normalizedTenantId, maskSecrets),
  ]);
  return {
    tenantId: normalizedTenantId,
    smtp,
    imap,
  };
}

export async function listTenantEmailOverrideTenantIds(imapOnly = false): Promise<string[]> {
  const db = getDatabase();
  const rows = await db.all<any>(
    imapOnly
      ? `SELECT tenant_id
         FROM tenant_settings_email
         WHERE imap_json IS NOT NULL AND TRIM(imap_json) <> ''`
      : `SELECT tenant_id
         FROM tenant_settings_email
         WHERE (smtp_json IS NOT NULL AND TRIM(smtp_json) <> '')
            OR (imap_json IS NOT NULL AND TRIM(imap_json) <> '')`
  );
  return Array.from(
    new Set(
      (rows || [])
        .map((row: any) => normalizeTenantId(row?.tenant_id))
        .filter(Boolean)
    )
  );
}

// ---------------------------------------------------------------------------
// AI settings
// ---------------------------------------------------------------------------
export interface AiSettings {
  provider: 'openai' | 'askcodi';
  model: string;
}

export interface AiAnalysisMemorySettings {
  enabled: boolean;
  includeInPrompts: boolean;
  autoPersist: boolean;
  maxContextEntries: number;
  maxContextChars: number;
  retentionDays: number;
  additionalInstruction: string;
  maxAutoSummaryChars: number;
}

export interface AiCredentials {
  openaiClientId: string;
  openaiClientSecret: string;
  askcodiApiKey: string;
  askcodiBaseUrl: string;
}

export type ImageAiDetailMode = 'low' | 'high' | 'auto';

export interface ImageAiSettings {
  enabled: boolean;
  model: string;
  apiKey: string;
  baseUrl: string;
  prompt: string;
  detail: ImageAiDetailMode;
  maxTokens: number;
  temperature: number;
}

export async function loadAiSettings(): Promise<SettingsWithSources<AiSettings>> {
  const defaults: AiSettings = {
    provider: 'askcodi',
    model: 'openai/gpt-5-mini',
  };

  const env: Partial<AiSettings> = {};
  if (process.env.AI_PROVIDER === 'openai' || process.env.AI_PROVIDER === 'askcodi') {
    env.provider = process.env.AI_PROVIDER as AiSettings['provider'];
  }
  if (process.env.AI_MODEL) env.model = process.env.AI_MODEL;

  const db = await getSetting<Partial<AiSettings>>('ai');
  return mergeWithSources(defaults, env, {}, db);
}

export async function loadAiAnalysisMemorySettings(): Promise<SettingsWithSources<AiAnalysisMemorySettings>> {
  const defaults: AiAnalysisMemorySettings = {
    enabled: true,
    includeInPrompts: true,
    autoPersist: true,
    maxContextEntries: 8,
    maxContextChars: 5000,
    retentionDays: 365,
    additionalInstruction: '',
    maxAutoSummaryChars: 900,
  };

  const env: Partial<AiAnalysisMemorySettings> = {};
  if (process.env.AI_ANALYSIS_MEMORY_ENABLED) {
    const normalized = process.env.AI_ANALYSIS_MEMORY_ENABLED.trim().toLowerCase();
    env.enabled = ['1', 'true', 'yes', 'on'].includes(normalized);
  }
  if (process.env.AI_ANALYSIS_MEMORY_INCLUDE_IN_PROMPTS) {
    const normalized = process.env.AI_ANALYSIS_MEMORY_INCLUDE_IN_PROMPTS.trim().toLowerCase();
    env.includeInPrompts = ['1', 'true', 'yes', 'on'].includes(normalized);
  }
  if (process.env.AI_ANALYSIS_MEMORY_AUTO_PERSIST) {
    const normalized = process.env.AI_ANALYSIS_MEMORY_AUTO_PERSIST.trim().toLowerCase();
    env.autoPersist = ['1', 'true', 'yes', 'on'].includes(normalized);
  }
  if (process.env.AI_ANALYSIS_MEMORY_MAX_CONTEXT_ENTRIES) {
    const parsed = Number(process.env.AI_ANALYSIS_MEMORY_MAX_CONTEXT_ENTRIES);
    if (Number.isFinite(parsed)) env.maxContextEntries = parsed;
  }
  if (process.env.AI_ANALYSIS_MEMORY_MAX_CONTEXT_CHARS) {
    const parsed = Number(process.env.AI_ANALYSIS_MEMORY_MAX_CONTEXT_CHARS);
    if (Number.isFinite(parsed)) env.maxContextChars = parsed;
  }
  if (process.env.AI_ANALYSIS_MEMORY_RETENTION_DAYS) {
    const parsed = Number(process.env.AI_ANALYSIS_MEMORY_RETENTION_DAYS);
    if (Number.isFinite(parsed)) env.retentionDays = parsed;
  }
  if (process.env.AI_ANALYSIS_MEMORY_ADDITIONAL_INSTRUCTION) {
    env.additionalInstruction = process.env.AI_ANALYSIS_MEMORY_ADDITIONAL_INSTRUCTION;
  }
  if (process.env.AI_ANALYSIS_MEMORY_MAX_SUMMARY_CHARS) {
    const parsed = Number(process.env.AI_ANALYSIS_MEMORY_MAX_SUMMARY_CHARS);
    if (Number.isFinite(parsed)) env.maxAutoSummaryChars = parsed;
  }

  const db = await getSetting<Partial<AiAnalysisMemorySettings>>('aiAnalysisMemory');
  const merged = mergeWithSources(defaults, env, {}, db);

  merged.values.enabled = merged.values.enabled !== false;
  merged.values.includeInPrompts = merged.values.includeInPrompts !== false;
  merged.values.autoPersist = merged.values.autoPersist !== false;
  merged.values.maxContextEntries = Number.isFinite(Number(merged.values.maxContextEntries))
    ? Math.max(1, Math.min(40, Math.floor(Number(merged.values.maxContextEntries))))
    : defaults.maxContextEntries;
  merged.values.maxContextChars = Number.isFinite(Number(merged.values.maxContextChars))
    ? Math.max(400, Math.min(60000, Math.floor(Number(merged.values.maxContextChars))))
    : defaults.maxContextChars;
  merged.values.retentionDays = Number.isFinite(Number(merged.values.retentionDays))
    ? Math.max(1, Math.min(3650, Math.floor(Number(merged.values.retentionDays))))
    : defaults.retentionDays;
  merged.values.additionalInstruction = typeof merged.values.additionalInstruction === 'string'
    ? merged.values.additionalInstruction.trim()
    : '';
  merged.values.maxAutoSummaryChars = Number.isFinite(Number(merged.values.maxAutoSummaryChars))
    ? Math.max(200, Math.min(4000, Math.floor(Number(merged.values.maxAutoSummaryChars))))
    : defaults.maxAutoSummaryChars;

  return merged;
}

export async function loadAiCredentials(maskSecrets = false): Promise<SettingsWithSources<AiCredentials>> {
  const defaults: AiCredentials = {
    openaiClientId: '',
    openaiClientSecret: '',
    askcodiApiKey: '',
    askcodiBaseUrl: 'https://api.askcodi.com/v1',
  };

  const env: Partial<AiCredentials> = {};
  if (process.env.OPENAI_CLIENT_ID || process.env.OPENAI_OAUTH_CLIENT_ID) {
    env.openaiClientId = process.env.OPENAI_CLIENT_ID || process.env.OPENAI_OAUTH_CLIENT_ID || '';
  }
  if (process.env.OPENAI_CLIENT_SECRET || process.env.OPENAI_OAUTH_CLIENT_SECRET) {
    env.openaiClientSecret = process.env.OPENAI_CLIENT_SECRET || process.env.OPENAI_OAUTH_CLIENT_SECRET || '';
  }
  if (process.env.ASKCODI_API_KEY) env.askcodiApiKey = process.env.ASKCODI_API_KEY;
  if (process.env.ASKCODI_BASE_URL) env.askcodiBaseUrl = process.env.ASKCODI_BASE_URL;

  const db = await getSetting<Partial<AiCredentials>>('aiCredentials');
  const merged = mergeWithSources(defaults, env, {}, db);

  if (maskSecrets) {
    if (merged.values.openaiClientSecret) merged.values.openaiClientSecret = '***';
    if (merged.values.askcodiApiKey) merged.values.askcodiApiKey = '***';
  }
  return merged;
}

export async function loadImageAiSettings(maskSecrets = false): Promise<SettingsWithSources<ImageAiSettings>> {
  const defaults: ImageAiSettings = {
    enabled: false,
    model: 'gpt-4o-mini',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    prompt: DEFAULT_IMAGE_ANALYSIS_PROMPT,
    detail: 'auto',
    maxTokens: 500,
    temperature: 0.2,
  };

  const env: Partial<ImageAiSettings> = {};
  if (process.env.IMAGE_AI_ENABLED) {
    const value = process.env.IMAGE_AI_ENABLED.trim().toLowerCase();
    env.enabled = ['1', 'true', 'yes', 'on'].includes(value);
  }
  if (process.env.IMAGE_AI_MODEL) env.model = process.env.IMAGE_AI_MODEL;
  if (process.env.IMAGE_AI_API_KEY) env.apiKey = process.env.IMAGE_AI_API_KEY;
  if (process.env.IMAGE_AI_BASE_URL) env.baseUrl = process.env.IMAGE_AI_BASE_URL;
  if (process.env.IMAGE_AI_PROMPT) env.prompt = process.env.IMAGE_AI_PROMPT;
  if (process.env.IMAGE_AI_DETAIL) env.detail = process.env.IMAGE_AI_DETAIL as ImageAiDetailMode;
  if (process.env.IMAGE_AI_MAX_TOKENS) {
    const maxTokens = Number(process.env.IMAGE_AI_MAX_TOKENS);
    if (Number.isFinite(maxTokens)) env.maxTokens = maxTokens;
  }
  if (process.env.IMAGE_AI_TEMPERATURE) {
    const temperature = Number(process.env.IMAGE_AI_TEMPERATURE);
    if (Number.isFinite(temperature)) env.temperature = temperature;
  }

  const db = await getSetting<Partial<ImageAiSettings>>('imageAi');
  const merged = mergeWithSources(defaults, env, {}, db);

  merged.values.enabled = merged.values.enabled === true;
  merged.values.model = String(merged.values.model || defaults.model).trim() || defaults.model;
  merged.values.apiKey = String(merged.values.apiKey || '').trim();
  merged.values.baseUrl = String(merged.values.baseUrl || defaults.baseUrl).trim() || defaults.baseUrl;
  merged.values.prompt = String(merged.values.prompt || '').trim() || DEFAULT_IMAGE_ANALYSIS_PROMPT;
  const detailRaw = String(merged.values.detail || '').trim().toLowerCase();
  merged.values.detail = detailRaw === 'low' || detailRaw === 'high' ? (detailRaw as ImageAiDetailMode) : 'auto';
  merged.values.maxTokens = Number.isFinite(Number(merged.values.maxTokens))
    ? Math.max(64, Math.min(4000, Math.floor(Number(merged.values.maxTokens))))
    : defaults.maxTokens;
  merged.values.temperature = Number.isFinite(Number(merged.values.temperature))
    ? Math.max(0, Math.min(2, Number(merged.values.temperature)))
    : defaults.temperature;

  try {
    const { values: systemPrompts, sources: systemPromptSources } = await loadSystemPrompts();
    const systemPrompt = String(systemPrompts.imageAnalysisPrompt || '').trim();
    if (systemPrompt) {
      merged.values.prompt = systemPrompt;
      merged.sources.prompt = (systemPromptSources.imageAnalysisPrompt || merged.sources.prompt) as SettingsSource;
    }
  } catch {
    // ignore prompt sync errors; keep imageAi prompt fallback
  }

  if (maskSecrets && merged.values.apiKey) {
    merged.values.apiKey = '***';
  }

  return merged;
}

// Runtime config for AI client
export interface AiRuntimeConfig {
  aiProvider: 'openai' | 'askcodi';
  aiModel: string;
  openaiClientId: string;
  openaiClientSecret: string;
  askcodi: {
    apiKey: string;
    baseUrl: string;
  };
}

export async function getAiRuntimeConfig(): Promise<AiRuntimeConfig> {
  const { values: ai } = await loadAiSettings();
  const { values: creds } = await loadAiCredentials(false);

  return {
    aiProvider: ai.provider,
    aiModel: ai.model,
    openaiClientId: creds.openaiClientId,
    openaiClientSecret: creds.openaiClientSecret,
    askcodi: {
      apiKey: creds.askcodiApiKey,
      baseUrl: creds.askcodiBaseUrl || 'https://api.askcodi.com/v1',
    },
  };
}

// ---------------------------------------------------------------------------
// Redmine settings
// ---------------------------------------------------------------------------
export interface RedmineSettings {
  enabled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  projects: any[];
  assignableUsers: any[];
  assignableGroupIds: number[];
  trackers: any[];
  roles: any[];
  groups: any[];
  issueStatuses: any[];
  lastSync?: string | null;
}

export async function loadRedmineSettings(): Promise<SettingsWithSources<RedmineSettings>> {
  const defaults: RedmineSettings = {
    enabled: false,
    baseUrl: null,
    apiKey: null,
    projects: [],
    assignableUsers: [],
    assignableGroupIds: [],
    trackers: [],
    roles: [],
    groups: [],
    issueStatuses: [],
    lastSync: null,
  };

  const env: Partial<RedmineSettings> = {};
  if (process.env.REDMINE_API_URL) env.baseUrl = process.env.REDMINE_API_URL;
  if (process.env.REDMINE_API_KEY) env.apiKey = process.env.REDMINE_API_KEY;

  const file = {};
  const db = await getSetting<Partial<RedmineSettings>>('redmine');

  const merged = mergeWithSources(defaults, env, file || {}, db);
  const normalizedGroups = Array.isArray(merged.values.groups)
    ? merged.values.groups
        .map((group: any) => ({
          id: Number(group?.id),
          name: String(group?.name || '').trim(),
          enabled: typeof group?.enabled === 'boolean' ? group.enabled : undefined,
        }))
        .filter((group: any) => Number.isFinite(group.id) && group.name)
    : [];
  const configuredGroupIds = Array.isArray(merged.values.assignableGroupIds)
    ? merged.values.assignableGroupIds
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id))
    : [];
  const groupIdsFromEnabledFlags = normalizedGroups
    .filter((group: any) => group.enabled === true)
    .map((group: any) => group.id);
  const hasExplicitGroupSelection =
    configuredGroupIds.length > 0 || normalizedGroups.some((group: any) => typeof group.enabled === 'boolean');
  const assignableGroupIds =
    configuredGroupIds.length > 0
      ? configuredGroupIds
      : groupIdsFromEnabledFlags;
  const assignableGroupIdSet = new Set(assignableGroupIds);

  merged.values = {
    enabled: !!(merged.values.baseUrl && merged.values.apiKey),
    baseUrl: merged.values.baseUrl || null,
    apiKey: merged.values.apiKey || null,
    projects: Array.isArray(merged.values.projects) ? merged.values.projects : [],
    assignableUsers: Array.isArray(merged.values.assignableUsers) ? merged.values.assignableUsers : [],
    assignableGroupIds,
    trackers: Array.isArray(merged.values.trackers) ? merged.values.trackers : [],
    roles: Array.isArray(merged.values.roles) ? merged.values.roles : [],
    groups: normalizedGroups.map((group: any) => ({
      ...group,
      enabled: hasExplicitGroupSelection
        ? assignableGroupIdSet.has(group.id)
          ? true
          : group.enabled === true
          ? true
          : false
        : undefined,
    })),
    issueStatuses: Array.isArray(merged.values.issueStatuses) ? merged.values.issueStatuses : [],
    lastSync: merged.values.lastSync || null,
  };
  return merged;
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------
export interface SystemPrompts {
  classifyPrompt: string;
  templateGenerationPrompt: string;
  redmineTicketPrompt: string;
  imageAnalysisPrompt: string;
  workflowTemplateGenerationPrompt: string;
  workflowJsonRepairPrompt: string;
  workflowTemplateSelectionPrompt: string;
  workflowDataRequestNeedCheckPrompt: string;
  workflowDataRequestPrompt: string;
  workflowDataRequestAnswerEvaluationPrompt: string;
  workflowFreeDataRequestNeedCheckPrompt: string;
  workflowFreeDataRequestPrompt: string;
  workflowFreeDataRequestAnswerEvaluationPrompt: string;
  workflowRecategorizationPrompt: string;
  workflowCategorizationOrgAssignmentPrompt: string;
  workflowResponsibilityCheckPrompt: string;
  workflowApiProbeAnalysisPrompt: string;
  aiSituationReportPrompt: string;
  aiSituationCategoryWorkflowPrompt: string;
  aiSituationFreeAnalysisPrompt: string;
  aiSituationMemoryCompressionPrompt: string;
  llmPseudonymPoolPrompt: string;
  emailTranslationPrompt: string;
  uiTranslationPrompt: string;
  templateJsonRepairPrompt: string;
  templatePlaceholderCompletionPrompt: string;
  workflowConfirmationInstructionPrompt: string;
  workflowInternalTaskGeneratorPrompt: string;
  adminAiHelpPrompt: string;
  categoryAssistantPrompt: string;
}

export async function loadSystemPrompts(): Promise<SettingsWithSources<SystemPrompts>> {
  const defaults: SystemPrompts = {
    classifyPrompt: DEFAULT_CLASSIFY_PROMPT,
    templateGenerationPrompt: DEFAULT_TEMPLATE_GENERATION_PROMPT,
    redmineTicketPrompt: DEFAULT_REDMINE_PROMPT,
    imageAnalysisPrompt: DEFAULT_IMAGE_ANALYSIS_PROMPT,
    workflowTemplateGenerationPrompt: DEFAULT_WORKFLOW_TEMPLATE_GENERATION_PROMPT,
    workflowJsonRepairPrompt: DEFAULT_WORKFLOW_JSON_REPAIR_PROMPT,
    workflowTemplateSelectionPrompt: DEFAULT_WORKFLOW_SELECTION_PROMPT,
    workflowDataRequestNeedCheckPrompt: DEFAULT_WORKFLOW_DATA_REQUEST_NEED_CHECK_PROMPT,
    workflowDataRequestPrompt: DEFAULT_WORKFLOW_DATA_REQUEST_PROMPT,
    workflowDataRequestAnswerEvaluationPrompt: DEFAULT_WORKFLOW_DATA_REQUEST_EVAL_PROMPT,
    workflowFreeDataRequestNeedCheckPrompt: DEFAULT_WORKFLOW_FREE_DATA_REQUEST_NEED_CHECK_PROMPT,
    workflowFreeDataRequestPrompt: DEFAULT_WORKFLOW_FREE_DATA_REQUEST_PROMPT,
    workflowFreeDataRequestAnswerEvaluationPrompt: DEFAULT_WORKFLOW_FREE_DATA_REQUEST_EVAL_PROMPT,
    workflowRecategorizationPrompt: DEFAULT_WORKFLOW_RECATEGORIZATION_PROMPT,
    workflowCategorizationOrgAssignmentPrompt: DEFAULT_WORKFLOW_CATEGORIZATION_ORG_ASSIGNMENT_PROMPT,
    workflowResponsibilityCheckPrompt: DEFAULT_WORKFLOW_RESPONSIBILITY_CHECK_PROMPT,
    workflowApiProbeAnalysisPrompt: DEFAULT_WORKFLOW_API_PROBE_ANALYSIS_PROMPT,
    aiSituationReportPrompt: DEFAULT_AI_SITUATION_REPORT_PROMPT,
    aiSituationCategoryWorkflowPrompt: DEFAULT_AI_SITUATION_CATEGORY_WORKFLOW_PROMPT,
    aiSituationFreeAnalysisPrompt: DEFAULT_AI_SITUATION_FREE_ANALYSIS_PROMPT,
    aiSituationMemoryCompressionPrompt: DEFAULT_AI_SITUATION_MEMORY_COMPRESSION_PROMPT,
    llmPseudonymPoolPrompt: DEFAULT_LLM_PSEUDONYM_POOL_PROMPT,
    emailTranslationPrompt: DEFAULT_EMAIL_TRANSLATION_PROMPT,
    uiTranslationPrompt: DEFAULT_UI_TRANSLATION_PROMPT,
    templateJsonRepairPrompt: DEFAULT_TEMPLATE_JSON_REPAIR_PROMPT,
    templatePlaceholderCompletionPrompt: DEFAULT_TEMPLATE_PLACEHOLDER_COMPLETION_PROMPT,
    workflowConfirmationInstructionPrompt: DEFAULT_WORKFLOW_CONFIRMATION_INSTRUCTION_PROMPT,
    workflowInternalTaskGeneratorPrompt: DEFAULT_WORKFLOW_INTERNAL_TASK_GENERATOR_PROMPT,
    adminAiHelpPrompt: DEFAULT_ADMIN_AI_HELP_PROMPT,
    categoryAssistantPrompt: DEFAULT_CATEGORY_ASSISTANT_PROMPT,
  };

  const env: Partial<SystemPrompts> = {};
  if (process.env.CLASSIFY_PROMPT) env.classifyPrompt = process.env.CLASSIFY_PROMPT;
  if (process.env.TEMPLATE_GENERATION_PROMPT) env.templateGenerationPrompt = process.env.TEMPLATE_GENERATION_PROMPT;
  if (process.env.REDMINE_TICKET_PROMPT) env.redmineTicketPrompt = process.env.REDMINE_TICKET_PROMPT;
  if (process.env.IMAGE_ANALYSIS_PROMPT) {
    env.imageAnalysisPrompt = process.env.IMAGE_ANALYSIS_PROMPT;
  } else if (process.env.IMAGE_AI_PROMPT) {
    env.imageAnalysisPrompt = process.env.IMAGE_AI_PROMPT;
  }
  if (process.env.WORKFLOW_TEMPLATE_GENERATION_PROMPT) {
    env.workflowTemplateGenerationPrompt = process.env.WORKFLOW_TEMPLATE_GENERATION_PROMPT;
  }
  if (process.env.WORKFLOW_JSON_REPAIR_PROMPT) {
    env.workflowJsonRepairPrompt = process.env.WORKFLOW_JSON_REPAIR_PROMPT;
  }
  if (process.env.WORKFLOW_TEMPLATE_SELECTION_PROMPT) {
    env.workflowTemplateSelectionPrompt = process.env.WORKFLOW_TEMPLATE_SELECTION_PROMPT;
  }
  if (process.env.WORKFLOW_DATA_REQUEST_NEED_CHECK_PROMPT) {
    env.workflowDataRequestNeedCheckPrompt = process.env.WORKFLOW_DATA_REQUEST_NEED_CHECK_PROMPT;
  }
  if (process.env.WORKFLOW_DATA_REQUEST_PROMPT) {
    env.workflowDataRequestPrompt = process.env.WORKFLOW_DATA_REQUEST_PROMPT;
  }
  if (process.env.WORKFLOW_DATA_REQUEST_ANSWER_EVAL_PROMPT) {
    env.workflowDataRequestAnswerEvaluationPrompt = process.env.WORKFLOW_DATA_REQUEST_ANSWER_EVAL_PROMPT;
  }
  if (process.env.WORKFLOW_FREE_DATA_REQUEST_NEED_CHECK_PROMPT) {
    env.workflowFreeDataRequestNeedCheckPrompt = process.env.WORKFLOW_FREE_DATA_REQUEST_NEED_CHECK_PROMPT;
  }
  if (process.env.WORKFLOW_FREE_DATA_REQUEST_PROMPT) {
    env.workflowFreeDataRequestPrompt = process.env.WORKFLOW_FREE_DATA_REQUEST_PROMPT;
  }
  if (process.env.WORKFLOW_FREE_DATA_REQUEST_ANSWER_EVAL_PROMPT) {
    env.workflowFreeDataRequestAnswerEvaluationPrompt = process.env.WORKFLOW_FREE_DATA_REQUEST_ANSWER_EVAL_PROMPT;
  }
  if (process.env.WORKFLOW_RECATEGORIZATION_PROMPT) {
    env.workflowRecategorizationPrompt = process.env.WORKFLOW_RECATEGORIZATION_PROMPT;
  }
  if (process.env.WORKFLOW_CATEGORIZATION_ORG_ASSIGNMENT_PROMPT) {
    env.workflowCategorizationOrgAssignmentPrompt = process.env.WORKFLOW_CATEGORIZATION_ORG_ASSIGNMENT_PROMPT;
  }
  if (process.env.WORKFLOW_RESPONSIBILITY_CHECK_PROMPT) {
    env.workflowResponsibilityCheckPrompt = process.env.WORKFLOW_RESPONSIBILITY_CHECK_PROMPT;
  }
  if (process.env.WORKFLOW_API_PROBE_ANALYSIS_PROMPT) {
    env.workflowApiProbeAnalysisPrompt = process.env.WORKFLOW_API_PROBE_ANALYSIS_PROMPT;
  }
  if (process.env.AI_SITUATION_REPORT_PROMPT) {
    env.aiSituationReportPrompt = process.env.AI_SITUATION_REPORT_PROMPT;
  }
  if (process.env.AI_SITUATION_CATEGORY_WORKFLOW_PROMPT) {
    env.aiSituationCategoryWorkflowPrompt = process.env.AI_SITUATION_CATEGORY_WORKFLOW_PROMPT;
  }
  if (process.env.AI_SITUATION_FREE_ANALYSIS_PROMPT) {
    env.aiSituationFreeAnalysisPrompt = process.env.AI_SITUATION_FREE_ANALYSIS_PROMPT;
  }
  if (process.env.AI_SITUATION_MEMORY_COMPRESSION_PROMPT) {
    env.aiSituationMemoryCompressionPrompt = process.env.AI_SITUATION_MEMORY_COMPRESSION_PROMPT;
  }
  if (process.env.LLM_PSEUDONYM_POOL_PROMPT) {
    env.llmPseudonymPoolPrompt = process.env.LLM_PSEUDONYM_POOL_PROMPT;
  }
  if (process.env.EMAIL_TRANSLATION_PROMPT) env.emailTranslationPrompt = process.env.EMAIL_TRANSLATION_PROMPT;
  if (process.env.UI_TRANSLATION_PROMPT) env.uiTranslationPrompt = process.env.UI_TRANSLATION_PROMPT;
  if (process.env.TEMPLATE_JSON_REPAIR_PROMPT) {
    env.templateJsonRepairPrompt = process.env.TEMPLATE_JSON_REPAIR_PROMPT;
  }
  if (process.env.TEMPLATE_PLACEHOLDER_COMPLETION_PROMPT) {
    env.templatePlaceholderCompletionPrompt = process.env.TEMPLATE_PLACEHOLDER_COMPLETION_PROMPT;
  }
  if (process.env.WORKFLOW_CONFIRMATION_INSTRUCTION_PROMPT) {
    env.workflowConfirmationInstructionPrompt = process.env.WORKFLOW_CONFIRMATION_INSTRUCTION_PROMPT;
  }
  if (process.env.WORKFLOW_INTERNAL_TASK_GENERATOR_PROMPT) {
    env.workflowInternalTaskGeneratorPrompt = process.env.WORKFLOW_INTERNAL_TASK_GENERATOR_PROMPT;
  }
  if (process.env.ADMIN_AI_HELP_PROMPT) env.adminAiHelpPrompt = process.env.ADMIN_AI_HELP_PROMPT;
  if (process.env.CATEGORY_ASSISTANT_PROMPT) env.categoryAssistantPrompt = process.env.CATEGORY_ASSISTANT_PROMPT;

  const fileGeneral = await readJsonFile<any>(GENERAL_CONFIG_PATH);

  const file: Partial<SystemPrompts> = {
    classifyPrompt: fileGeneral?.classifyPrompt,
  };

  const db = await getSetting<Partial<SystemPrompts>>('systemPrompts');
  const merged = mergeWithSources(defaults, env, file || {}, db);

  merged.values.classifyPrompt = ensureClassifyPromptGuidelines(
    stripLegacyAmtsblatt(merged.values.classifyPrompt)
  );
  merged.values.templateGenerationPrompt = ensureTemplateThemeGuidelines(
    merged.values.templateGenerationPrompt
  );
  merged.values.redmineTicketPrompt = ensureRedminePromptGuidelines(
    merged.values.redmineTicketPrompt
  );
  merged.values.imageAnalysisPrompt = ensureImageAnalysisPromptGuidelines(
    merged.values.imageAnalysisPrompt
  );
  merged.values.workflowTemplateGenerationPrompt = ensureWorkflowTemplateGenerationGuidelines(
    merged.values.workflowTemplateGenerationPrompt
  );
  merged.values.workflowJsonRepairPrompt = ensureWorkflowJsonRepairGuidelines(
    merged.values.workflowJsonRepairPrompt
  );
  merged.values.workflowTemplateSelectionPrompt = ensureWorkflowSelectionGuidelines(
    merged.values.workflowTemplateSelectionPrompt
  );
  merged.values.workflowDataRequestNeedCheckPrompt = ensureWorkflowDataRequestNeedCheckGuidelines(
    merged.values.workflowDataRequestNeedCheckPrompt
  );
  merged.values.workflowDataRequestPrompt = ensureWorkflowDataRequestPromptGuidelines(
    merged.values.workflowDataRequestPrompt
  );
  merged.values.workflowDataRequestAnswerEvaluationPrompt = ensureWorkflowDataRequestEvalGuidelines(
    merged.values.workflowDataRequestAnswerEvaluationPrompt
  );
  merged.values.workflowFreeDataRequestNeedCheckPrompt = ensureWorkflowFreeDataRequestNeedCheckGuidelines(
    merged.values.workflowFreeDataRequestNeedCheckPrompt
  );
  merged.values.workflowFreeDataRequestPrompt = ensureWorkflowFreeDataRequestPromptGuidelines(
    merged.values.workflowFreeDataRequestPrompt
  );
  merged.values.workflowFreeDataRequestAnswerEvaluationPrompt = ensureWorkflowFreeDataRequestEvalGuidelines(
    merged.values.workflowFreeDataRequestAnswerEvaluationPrompt
  );
  merged.values.workflowRecategorizationPrompt = ensureWorkflowRecategorizationGuidelines(
    merged.values.workflowRecategorizationPrompt
  );
  merged.values.workflowCategorizationOrgAssignmentPrompt = ensureWorkflowCategorizationOrgAssignmentGuidelines(
    merged.values.workflowCategorizationOrgAssignmentPrompt
  );
  merged.values.templateJsonRepairPrompt = ensureTemplateJsonRepairGuidelines(
    merged.values.templateJsonRepairPrompt
  );
  merged.values.templatePlaceholderCompletionPrompt = ensureTemplatePlaceholderCompletionGuidelines(
    merged.values.templatePlaceholderCompletionPrompt
  );
  merged.values.emailTranslationPrompt = ensureTranslationPromptGuidelines(
    merged.values.emailTranslationPrompt,
    DEFAULT_EMAIL_TRANSLATION_PROMPT
  );
  merged.values.uiTranslationPrompt = ensureTranslationPromptGuidelines(
    merged.values.uiTranslationPrompt,
    DEFAULT_UI_TRANSLATION_PROMPT
  );
  merged.values.adminAiHelpPrompt = ensureAdminAiHelpGuidelines(
    merged.values.adminAiHelpPrompt
  );

  return merged;
}

export async function getSystemPrompt(key: keyof SystemPrompts): Promise<string> {
  const { values } = await loadSystemPrompts();
  const defaults: SystemPrompts = {
    classifyPrompt: DEFAULT_CLASSIFY_PROMPT,
    templateGenerationPrompt: DEFAULT_TEMPLATE_GENERATION_PROMPT,
    redmineTicketPrompt: DEFAULT_REDMINE_PROMPT,
    imageAnalysisPrompt: DEFAULT_IMAGE_ANALYSIS_PROMPT,
    workflowTemplateGenerationPrompt: DEFAULT_WORKFLOW_TEMPLATE_GENERATION_PROMPT,
    workflowJsonRepairPrompt: DEFAULT_WORKFLOW_JSON_REPAIR_PROMPT,
    workflowTemplateSelectionPrompt: DEFAULT_WORKFLOW_SELECTION_PROMPT,
    workflowDataRequestNeedCheckPrompt: DEFAULT_WORKFLOW_DATA_REQUEST_NEED_CHECK_PROMPT,
    workflowDataRequestPrompt: DEFAULT_WORKFLOW_DATA_REQUEST_PROMPT,
    workflowDataRequestAnswerEvaluationPrompt: DEFAULT_WORKFLOW_DATA_REQUEST_EVAL_PROMPT,
    workflowFreeDataRequestNeedCheckPrompt: DEFAULT_WORKFLOW_FREE_DATA_REQUEST_NEED_CHECK_PROMPT,
    workflowFreeDataRequestPrompt: DEFAULT_WORKFLOW_FREE_DATA_REQUEST_PROMPT,
    workflowFreeDataRequestAnswerEvaluationPrompt: DEFAULT_WORKFLOW_FREE_DATA_REQUEST_EVAL_PROMPT,
    workflowRecategorizationPrompt: DEFAULT_WORKFLOW_RECATEGORIZATION_PROMPT,
    workflowCategorizationOrgAssignmentPrompt: DEFAULT_WORKFLOW_CATEGORIZATION_ORG_ASSIGNMENT_PROMPT,
    workflowResponsibilityCheckPrompt: DEFAULT_WORKFLOW_RESPONSIBILITY_CHECK_PROMPT,
    workflowApiProbeAnalysisPrompt: DEFAULT_WORKFLOW_API_PROBE_ANALYSIS_PROMPT,
    aiSituationReportPrompt: DEFAULT_AI_SITUATION_REPORT_PROMPT,
    aiSituationCategoryWorkflowPrompt: DEFAULT_AI_SITUATION_CATEGORY_WORKFLOW_PROMPT,
    aiSituationFreeAnalysisPrompt: DEFAULT_AI_SITUATION_FREE_ANALYSIS_PROMPT,
    aiSituationMemoryCompressionPrompt: DEFAULT_AI_SITUATION_MEMORY_COMPRESSION_PROMPT,
    llmPseudonymPoolPrompt: DEFAULT_LLM_PSEUDONYM_POOL_PROMPT,
    emailTranslationPrompt: DEFAULT_EMAIL_TRANSLATION_PROMPT,
    uiTranslationPrompt: DEFAULT_UI_TRANSLATION_PROMPT,
    templateJsonRepairPrompt: DEFAULT_TEMPLATE_JSON_REPAIR_PROMPT,
    templatePlaceholderCompletionPrompt: DEFAULT_TEMPLATE_PLACEHOLDER_COMPLETION_PROMPT,
    workflowConfirmationInstructionPrompt: DEFAULT_WORKFLOW_CONFIRMATION_INSTRUCTION_PROMPT,
    workflowInternalTaskGeneratorPrompt: DEFAULT_WORKFLOW_INTERNAL_TASK_GENERATOR_PROMPT,
    adminAiHelpPrompt: DEFAULT_ADMIN_AI_HELP_PROMPT,
    categoryAssistantPrompt: DEFAULT_CATEGORY_ASSISTANT_PROMPT,
  };
  return values[key] || defaults[key];
}

// ---------------------------------------------------------------------------
// Email template settings
// ---------------------------------------------------------------------------
export interface EmailTemplateSettings {
  footerEnabled: boolean;
  footerHtml: string;
  footerText: string;
}

const DEFAULT_EMAIL_TEMPLATE_FOOTER_HTML =
  '<p style="margin:0 0 4px 0;"><strong>Verbandsgemeinde Otterbach-Otterberg</strong></p>' +
  '<p style="margin:0;">Digitaler Bürgerservice behebes.AI</p>' +
  '<p style="margin:8px 0 0 0;color:#64748b;font-size:12px;">Diese E-Mail wurde automatisch erstellt.</p>';

const DEFAULT_EMAIL_TEMPLATE_FOOTER_TEXT =
  'Verbandsgemeinde Otterbach-Otterberg\nDigitaler Bürgerservice behebes.AI\nDiese E-Mail wurde automatisch erstellt.';

export async function loadEmailTemplateSettings(): Promise<SettingsWithSources<EmailTemplateSettings>> {
  const defaults: EmailTemplateSettings = {
    footerEnabled: true,
    footerHtml: DEFAULT_EMAIL_TEMPLATE_FOOTER_HTML,
    footerText: DEFAULT_EMAIL_TEMPLATE_FOOTER_TEXT,
  };

  const db = await getSetting<Partial<EmailTemplateSettings>>('emailTemplates');
  const merged = mergeWithSources(defaults, {}, {}, db);

  merged.values.footerEnabled = merged.values.footerEnabled !== false;
  merged.values.footerHtml = typeof merged.values.footerHtml === 'string'
    ? merged.values.footerHtml
    : DEFAULT_EMAIL_TEMPLATE_FOOTER_HTML;
  merged.values.footerText = typeof merged.values.footerText === 'string'
    ? merged.values.footerText
    : DEFAULT_EMAIL_TEMPLATE_FOOTER_TEXT;

  return merged;
}
