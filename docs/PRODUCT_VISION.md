# Produktvision und Servicephilosophie · behebes.AI Next

**Stand:** 05.11.2026 · **Status:** Zielbild und überprüfbare Hypothesen; kein behauptetes Produktionsergebnis.

## Wofür behebes.AI existiert

Bürgerinnen und Bürger wollen keine Verwaltungssoftware bedienen. Sie wollen ein Problem melden, verstehen, ob es angekommen ist, und wissen, ob noch eine Handlung nötig ist. Sachbearbeitende wollen nicht Datensätze verwalten, sondern Anliegen **richtig zuordnen, transparent bearbeiten und verantwortlich abschließen**. Außendienstteams wollen wissen, was vor Ort zu tun ist, auch ohne stabile Verbindung. Leitung und Administration benötigen einen fachlich ehrlichen Überblick, klare Rechte und einen verlässlichen Betrieb.

Die produktseitige **North Star Journey** lautet:

```text
Anliegen verstehen → korrekt und datensparsam erfassen
  → Eingang nachweisbar → Zuständigkeit nachvollziehbar
  → Sachbearbeitung/Workflow → ggf. OPS-Einsatz
  → Bürger-Rückfrage/Information → nachvollziehbarer Abschluss
  → freiwillige Rückmeldung und mögliche Wiederaufnahme
```

KI darf diese Journey unterstützen, aber **nicht autonom hoheitliche oder sonst außenwirksame Entscheidungen** treffen. Das System ist ein Werkzeug für Menschen, nicht ihr Ersatz. Der Nachweis einer bearbeiteten Anfrage ist ebenso wichtig wie deren schnelle Bearbeitung.

## Rollen und Jobs to be Done

| Rolle | Kernanliegen | Startbild | Wichtigster Fehlerpfad |
| --- | --- | --- | --- |
| Bürger:in | „Ich möchte mein Anliegen einfach loswerden“ | Klarer Einstieg, wenige Felder, Fortschritt | Standort/Upload/Netz fehlgeschlagen; Eingaben bleiben erhalten |
| Bürger:in mit Rückfrage | „Was muss ich jetzt tun?“ | Verständliche Timeline und Rückfrage | Token abgelaufen, anderer Mandant, Sprache gewechselt |
| Sachbearbeitung | „Welche Fälle gehören mir, was ist der nächste Schritt?“ | Heute/offen/überfällig + eine Hauptaktion | Parallelbearbeitung, 409, falsch zugewiesene Zuständigkeit |
| Team-/Org-Leitung | „Wo müssen wir priorisieren, wer ist verantwortlich?“ | Belastung/SLA/Risiko und zulässiger Drilldown | Aggregation zeigt nicht autorisierte Details |
| Tenant-Admin | „Welche Module dürfen meine Teams nutzen?“ | Modulübersicht, Gründe für Sperren, Auswirkungen | Off während aktiver Aufgaben/Queues |
| Plattform-Admin | „Wie halte ich das System sicher und verfügbar?“ | Mandanten-/Provider-/Release-Health | Kein Backup, unklare Migration, beschädigter Provider |
| OPS | „Was muss ich vor Ort tun und was ist synchronisiert?“ | Meine Aufgaben, große Aktion, Offlineindikator | Konflikt nach langem Offlinebetrieb, QR/Push veraltet |

## Regeln, die im UI immer gelten

1. **Job first, Modul second:** Navigation richtet sich nach Aufgaben. Konfiguration bleibt verfügbar, aber nicht auf Kosten des Arbeitsflusses.
2. **Ort, Zustand, Konsequenz, Hauptaktion:** Auf jedem Screen sind Kontext, aktueller Zustand und nächster sinnvoller Schritt erkennbar. Besonders bei Wartezeiten wird erklärt, ob die Person handeln muss.
3. **Keine Kontextvernichtung:** Ticket, Tenant, Org, Filter, Suchbegriff, Formzustand, Scrollposition und Rücksprung sollen, soweit berechtigt, bei Navigation/Fehlern erhalten bleiben.
4. **Mobile ist kein verkleinerter Desktop:** Bürger und OPS werden primär mit 320–360px und Touch konzipiert. Admin arbeitet auf Desktop/Tablet, aber Kernhandlungen bleiben mobil bedienbar.
5. **Nur das Notwendige zuerst:** Erst Pflichtkern, dann Zusatzinformationen. Kein komplettes Konfigurationsschema als Erstkontakt.
6. **Echte Zustände statt Illusionen:** Speichern = serverseitig bestätigt; Offline/Queue/Retry sichtbar; keine falschen „Erfolg!“-Toasts.
7. **Rechte und Datenschutz sind Teil des UX:** Nicht erlaubte Daten werden nicht geladen; bei Modul-off gibt es einen verständlichen Zustand, keine heimlich funktionsfähige API.
8. **Barrierefreiheit ist Definition of Done:** Tastatur, sichtbarer Fokus, Accessible Names, Status nicht nur per Farbe, Reduced Motion, Screenreader-/Kontrastchecks.
9. **Fachsprache nur, wo sie nötig ist:** Bürger verstehen Alltagssprache. Interne Details können im Admin fachlich präzise sein, dürfen aber die nächsten Handlungen nicht verdecken.
10. **Kontrollierte Automatisierung:** Bei Mail, Löschung, Freigabe oder externer API-Aktion bleibt der menschliche Kontext nachvollziehbar.

## Messbarer Kundennutzen

Die nachfolgenden Metriken sind **Vorschläge**, keine vorhandenen Daten. Erhebung nur nach Datenschutzprüfung, möglichst aggregiert und synthetisch im Test.

- Bürger: Anteil erfolgreicher Meldungen, Zeit bis Abschluss der Eingabe, Validierungs- und Abbruchgründe, Statusverständnis, Rückfragerate.
- Sachbearbeitung: Zeit bis richtige Zuweisung, Klickwege zur Hauptaktion, Anteil konfliktfreier Änderungen, Bearbeitungszeit nach Falltyp.
- OPS: Zeit bis Aufgabenaufnahme, Offline-Erfolgsquote, Sync-Konflikte, erfolgreiche Wiederaufnahmen, ungewollte Duplikate.
- Leitung: tatsächliche Rückstands- und SLA-Risiken, Datenqualität und Aufwand von Freigaben/Reporting.
- Betreiber: Wiederherstellungsfähigkeit, SLO-Einhaltung, Fehlerbehebungsdauer, Regressionen nach Releases.

## UX-/Produkt-Abnahme (Beispiel)

Ein synthetischer Bürger meldet eine beschädigte Straßenlaterne ohne Standortfreigabe und mit schwachem Netz. Die Meldung ist nachweisbar genau einmal eingegangen, er sieht eine verständliche Statusmeldung und erhält keine interne Ticket-ID als einzige Orientierung. Eine berechtigte Sachbearbeitung erkennt Zuständigkeit und nächsten Schritt; der OPS-Mitarbeiter öffnet die Aufgabe vom QR-/Push-Einstieg, arbeitet offline und sieht nach Wiederverbindung einen transparenten Synczustand. Ein unberechtigter Nutzer kann weder Fall, Anhänge noch interne Journalnotizen lesen. Der Bürger sieht den Abschluss in seiner gewählten Sprache.

**Evidenz:** Szenarien, Nutzerbeobachtung, Browser-/API-/Offline-Smokes, Datenschutzprüfung, Vorher/Nachher-Metriken. Erst dann „fertig“.

## Zugehörige Planungsunterlagen

- [Mehrstufige Roadmap](ROADMAP.md) und [Issue-Katalog](../planning/roadmap-issues.json)
- [Mantine-Migrationsstrategie](MANTINE_MIGRATION.md)
- [Modulplattform & Feature Controls](MODULE_PLATFORM.md)
- [Performance & SLOs](PERFORMANCE_SLOS.md)
- [Sicherheit](SECURITY_PRIVACY.md), [UX-Prinzipien](UX_PRINCIPLES.md) und [Architektur](ARCHITECTURE.md)
