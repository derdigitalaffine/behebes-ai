# UX-Leitplanken – Bürger, Admin, OPS

## Leitidee

In wenigen Sekunden muss erkennbar sein: **Wo bin ich? Was ist der Zustand? Muss ich handeln? Was passiert als Nächstes?** Ein gemeinsamer Service kann drei verschiedene Oberflächen haben, aber fachliche Begriffe und Status sollen konsistent sein.

## Verbindliche Prinzipien

1. **Aufgabe vor Menüstruktur:** Für häufige Fälle primäre Aktion direkt sichtbar; seltene Verwaltungsdetails nachgeordnet.
2. **Genau eine dominante nächste Aktion:** destruktive und administrative Alternativen klar getrennt.
3. **Status mit Konsequenz:** „Meldung eingegangen – Prüfung ausstehend“ statt interner Queue-Codes.
4. **Keine Kontextverluste:** Filter, Ticket, Org-Scope, Nutzerangaben und Rücksprung erhalten; bei Fehlern nicht unnötig neu anfangen.
5. **Mobil ist ein eigener Ablauf:** 320–360px als untere Prüfpunkte, große Touch-Ziele, keine rein horizontal scrollbare Pflicht-Tabelle.
6. **Zugänglichkeit:** Tastatur/Fokus, verständliche Labels, Screenreader-Namen, Status nicht nur per Farbe, Kontrast, reduzierte Animation.
7. **Progressive Offenlegung:** Standardfall zuerst; erweiterte Felder nur wenn fachlich nötig. Kein „deaktiviertes Großformular“ als Leseansicht.
8. **Sicherer Fehlerpfad:** verständliche Hinweise, Eingaben bleiben erhalten; Offline, Timeout, Konflikt und Berechtigung unterscheidbar.
9. **Sensible Daten minimieren:** keine versteckten Metadaten/Leerplatzhalter für unberechtigte Felder.
10. **Wiederverwendung:** bestehende Komponenten und Design-Standards in `admin/src/components/admin-ui/`, `admin/src/modules/smart-table/` und den jeweiligen Clientmodulen bevorzugen.

## Oberfläche je Nutzergruppe

| Fläche | Leitaufgabe | Besonderes Risiko |
| --- | --- | --- |
| Bürger-Frontend | Anliegen einreichen, Stand verstehen, Rückfragen beantworten | Unsicherheit über Fristen, sensible Uploads, mehrsprachiger Text |
| Admin | Priorisieren, zuweisen, Workflows, Nachvollziehen | komplexe Rechte, überladene Tabellen/Formulare, ungewollte Freigaben |
| OPS | vor Ort rasch ausführen, dokumentieren, kommunizieren | schlechte Verbindung, Touch, Offline-/Sync-Konflikte |

## UX-Review vor größerer Änderung

```text
Nutzerziel und häufigste Aktion:
Primäre Information / erster sichtbarer Zustand:
Sekundäre Schritte und progressive Offenlegung:
Rolle, Tenant, Org, gesperrter Zustand:
Mobile 360px / Touch / Tastatur / Fokus:
Laden, Leer, Fehler, Offline, Konflikt, Erfolg:
Datenschutz und Außenwirkung:
Manuelle Abnahme und offenes UX-Risiko:
```

Browser-/Screenshottests ergänzen, ersetzen aber keine reale Bedienprüfung. Für Call-/Messenger-Interaktionen den iOS-/TURN-Best-Effort-Hinweis in `chat-presence-calls.md` beachten.
