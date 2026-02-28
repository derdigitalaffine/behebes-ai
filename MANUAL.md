# behebes.AI MANUAL

Stand: 16.02.2026  
Herausgeber: Verbandsgemeinde Otterbach-Otterberg  
System: behebes.AI (KI-basierter Schadensmelder)

## 1. Ziel dieser Anleitung
Diese Anleitung beschreibt die Bedienung von behebes.AI vollständig aus Anwendersicht.

Reihenfolge:
1. Bürgerfrontend (Meldung erfassen, bestätigen, Status prüfen)
2. Adminfrontend (Tickets, Workflows, Redmine, E-Mail-Templates, Betrieb)

## 2. Schnellüberblick
- Bürger nutzen das öffentliche Formular, bestätigen die Meldung per E-Mail und verfolgen den Status.
- Verwaltung/Sachbearbeitung bearbeitet Meldungen im Adminportal, steuert Workflows, Kommunikation und Integrationen.
- E-Mails laufen über ein zentrales Template-System und eine Queue mit Wiederholungslogik.

---

## Teil A: Bürgerfrontend

## 3. Einstieg ins Bürgerfrontend
### 3.1 Aufruf
- URL: öffentliche Portaladresse (z. B. `/` hinter dem Reverse Proxy).
- Das Frontend prüft automatisch den Backend-Status.
- Bei Störung wird ein Wartungs-/Fehlerhinweis angezeigt.

### 3.2 Seitenaufbau
- Kopfbereich mit Branding der Verbandsgemeinde.
- Sprachumschaltung.
- Optionaler PWA-Install-Button (wenn vom Browser unterstützt).
- Hauptformular zur Schadensmeldung.
- Footer mit Links (Datenschutz, Impressum, Anleitung, Systemstatus).

## 4. Meldung erfassen
### 4.1 Pflichtfelder
- Name
- E-Mail-Adresse
- Beschreibung
- Ort/Adresse

### 4.2 Optionale Felder
- Fotos (mehrere möglich, Größen- und Typprüfung aktiv)
- Kartenposition (Marker kann gesetzt/verschoben werden)

### 4.3 Beschreibung richtig erfassen
Für schnelle Bearbeitung sollte die Beschreibung enthalten:
- Was ist passiert?
- Wo genau ist der Schaden?
- Seit wann besteht der Zustand?
- Gibt es Gefahren oder Behinderungen?

### 4.4 Standort erfassen
Möglichkeiten:
- Adresse über Suche eingeben.
- Karte öffnen und Marker setzen/ziehen.
- Standort automatisch ermitteln (bei Browserfreigabe).

Hinweise:
- Bei ungenauer Geolokalisierung Marker manuell korrigieren.
- Die textliche Adresse und der Kartenmarker sollten zusammenpassen.

### 4.5 Fotos hochladen
Empfehlungen:
- Scharfe Fotos bei Tageslicht.
- Nah- und Übersichtsaufnahme kombinieren.
- Keine irrelevanten oder personenbezogenen Inhalte hochladen.

## 5. Zusammenfassung und Absenden
Vor dem Absenden zeigt das System eine Zusammenfassung.

Prüfen:
- Name und E-Mail korrekt?
- Beschreibung vollständig?
- Standort korrekt?
- Fotos passend?

Danach:
- Meldung absenden
- Double-Opt-In Bestätigung per E-Mail durchführen

## 6. E-Mail-Bestätigung (Double Opt-In)
### 6.1 Warum erforderlich
Die Meldung wird erst nach E-Mail-Bestätigung verbindlich verarbeitet.

### 6.2 Ablauf
1. E-Mail öffnen
2. Bestätigungslink anklicken
3. Bestätigungsseite zeigt Ergebnis und Ticket-Kontext

### 6.3 Wenn keine E-Mail ankommt
- Spam-Ordner prüfen
- E-Mail-Adresse auf Tippfehler prüfen
- Erneut senden (falls Funktion angeboten)
- Bei Störung später erneut versuchen

## 7. Bearbeitungsstand prüfen
### 7.1 Möglichkeiten
- Über Statuslink aus E-Mail
- Über Ticket-ID auf der Statusseite

### 7.2 Typische Status
- Ausstehend / Validierung ausstehend
- Offen
- Zugewiesen / In Bearbeitung
- Abgeschlossen / Geschlossen

## 8. Anleitung im Bürgerfrontend
Die Seite `Anleitung` enthält:
- Schritt-für-Schritt-Prozess
- Schnellstart
- Hinweise zu Datenschutz und Datenqualität
- Checklisten
- Zurück-Button zum Meldeformular (oben und unten)

## 9. PWA-Nutzung
### 9.1 Installation
- Wenn verfügbar: Installieren-Button im Header nutzen.
- Alternativ Browser-Menü „App installieren“.

### 9.2 Vorteile
- Schneller Zugriff vom Homescreen
- Besseres mobiles Nutzungsgefühl
- Update-Hinweise bei neuen Versionen

### 9.3 Update-Verhalten
- Bei neuer Version erscheint ein Hinweis.
- „Aktualisieren“ lädt den neuesten Stand.

## 10. Datenschutz-Hinweise für Bürger
- Nur sachbezogene Informationen eintragen.
- Keine unnötigen sensiblen Daten in Freitext/Fotos.
- Standort und Fotos sind optional, verbessern aber die Bearbeitung.

## 11. Häufige Probleme im Bürgerfrontend
### 11.1 Standort wird nicht ermittelt
- Standortfreigabe im Browser aktivieren
- HTTPS nutzen
- Adresse manuell eingeben

### 11.2 Marker stimmt nicht
- Marker manuell auf die korrekte Position setzen
- Danach Adresse erneut prüfen

### 11.3 Formular lässt sich nicht absenden
- Pflichtfelder prüfen
- Datenschutzeinwilligung prüfen
- E-Mail-Format prüfen

---

## Teil B: Adminfrontend

## 12. Einstieg ins Adminfrontend
### 12.1 Anmeldung
- URL: `/admin`
- Login mit Admin/Sachbearbeiter-Zugang
- Session wird serverseitig geführt und kann zentral beendet werden

### 12.2 Rollen
- Sachbearbeitung: operative Bereiche (Tickets, Workflows, Wissen, Queue, Profil, Logs)
- Admin/Superadmin: zusätzlich Benutzer-, Session-, Journal- und Systemeinstellungen

### 12.3 Globaler Aufbau
- Header mit Backend-Health
- Hauptnavigation
- Inhaltsbereich je Modul
- Footer

## 13. Dashboard
Zweck:
- Überblick über Ticketlage, Statusverteilung, Aktivität
- Schneller Einstieg in operative Aufgaben

## 14. Tickets-Liste
### 14.1 Funktionen
- Suchen, Filtern, Sortieren
- Status-/Prioritätsauswertung
- Navigation in Ticket-Details

### 14.2 Typische Arbeitsweise
1. Eingangstickets filtern
2. Priorität und Kategorie prüfen
3. Ticket öffnen und weiterbearbeiten

## 15. Ticket-Detailseite
Die Ticket-Detailseite ist die zentrale Bearbeitungsmaske.

### 15.1 Inhalte
- Stammdaten (Kategorie, Priorität, Status, Standort, Beschreibung)
- Bilder
- Kommunikations- und Validierungsinformationen
- Workflow-Bereich

### 15.2 Workflow-Bereich im Ticket
- Kompakte Zusammenfassung mit den wichtigsten Kennzahlen
- Expandierbare Vollansicht mit Tasks und Pfaden
- Manuelle Freigaben direkt bedienbar
- Workflow-Start (inkl. Vorlagenauswahl)

### 15.3 DTPN-Workflowgrafik
- Grafische Prozessdarstellung im Ticket
- PDF-Export als direkter Download
- Ausgabeformat: DIN A3 Querformat

## 16. Kartenansicht (Admin)
- Geografische Ticketübersicht
- Marker mit Ticketkontext
- Direkter Sprung in Ticketdetails

## 17. Workflow-Instanzen
### 17.1 Zweck
- Laufende, pausierte, abgeschlossene und fehlerhafte Instanzen überwachen

### 17.2 Funktionen
- Filter nach Zustand
- Anzeige offener manueller Schritte
- Freigabe/Ablehnung einzelner Tasks
- Operative Kontrolle über Wartepunkte und Verzweigungen

## 18. Wissensdatenbank
- Kategorien verwalten
- Regeln/Hinweise pflegen
- Grundlage für Klassifikation, Routing und teils Workflow-Automatik

## 19. Mail Queue
### 19.1 Zweck
- Transparenz über E-Mail-Versand
- Robuster Versand über Wiederholungen

### 19.2 Aktionen
- Queue-Einträge prüfen
- Retry auslösen
- Erneut versenden
- Fehlerbilder analysieren

## 20. Profil
- Eigenes Passwort/Benutzerdaten verwalten
- Persönliche Sicherheitseinstellungen prüfen

## 21. Logs
- Technische und fachliche Ereignisse einsehen
- Fehlerbilder zeitlich einordnen

## 22. Verwaltungsmodule (Admin)

## 22.1 Benutzer
- Benutzer anlegen/bearbeiten
- Rollen zuweisen
- Aktivität und Berechtigungen steuern

## 22.2 Sessions
- Aktive Logins einsehen
- Sitzungen gezielt beenden

## 22.3 Journal
- Auditierbare Änderungen und sicherheitsrelevante Ereignisse
- Nachvollziehbarkeit für Betrieb und Compliance

## 23. Einstellungen (Admin Settings)

## 23.1 Allgemeine Einstellungen
- Systemweite Basisparameter
- Betriebsoptionen und globale Schalter

## 23.2 KI-Provider
- Provider-Setup
- Modellkonfiguration
- API-Zugangsdaten und Test

## 23.3 E-Mail (SMTP)
- Host/Port/Authentifizierung
- Absendername und Absenderadresse
- Versandtest

## 23.4 E-Mail-Templates
Dieses Modul steuert alle E-Mail-Vorlagen zentral.

### 23.4.1 Vorlagen auswählen und bearbeiten
- Vorlage links auswählen
- Betreff, HTML, Nur-Text-Fallback bearbeiten
- Vorschau als HTML und Text prüfen

### 23.4.2 Neue Vorlage anlegen
- „Neue Vorlage“ öffnen
- Name und optional technische ID vergeben
- Betreff + HTML + Text definieren
- Platzhalter auswählen
- Vorlage speichern

### 23.4.3 Platzhalterlogik
- Vollständiger Platzhalterkatalog verfügbar
- Platzhalter können pro Vorlage als Pflicht-Platzhalter markiert werden
- Beim Speichern wird geprüft, ob Pflicht-Platzhalter im Betreff/HTML enthalten sind

### 23.4.4 Globale Footer-Signatur
- HTML- und Text-Footer zentral definieren
- Wird an ausgehende E-Mails angehängt

## 23.5 System-Prompts
- Zentrale KI-Anweisungen verwalten
- Qualität und Verhalten von Klassifikation/Generierung steuern

## 23.6 Redmine
- Verbindung, Projekte, Tracker, Assignees
- Benutzer und Gruppen als Zuweisungsziele
- Feldzuordnungen inkl. Koordinaten/Fachfelder

## 23.7 Workflow-Definitionen
Dieses Modul definiert die fachliche Automatisierung.

### 23.7.1 Vorlagenverwaltung
- Kachel- oder Tabellenansicht
- Neue Vorlage
- Bearbeiten/Löschen
- JSON Export/Import (gesamt und einzeln)

### 23.7.2 DTPN-Grafikeditor
- Startknoten immer sichtbar
- Knoten per Drag & Drop positionierbar
- Verbindungen über Ein-/Ausgänge definierbar
- Zoom-Steuerung im Editor

### 23.7.3 Ablaufeditor
- Schrittliste mit fokussierter Bearbeitung
- Nur der im Grafikeditor gewählte Knoten zeigt Details
- Bereiche ein-/ausklappbar

### 23.7.4 Knotentypen (Auszug)
- REDMINE_TICKET
- EMAIL / EMAIL_EXTERNAL / EMAIL_CONFIRMATION / CITIZEN_NOTIFICATION
- REST_API_CALL
- SPLIT / JOIN
- IF
- WAIT_STATUS_CHANGE
- CHANGE_WORKFLOW
- END (Workflow/Teilworkflow beenden)

### 23.7.5 IF-Knoten
- Feldbedingungen mit Operatoren
- Für geeignete Felder Wertauswahl per Dropdown (z. B. Status/Priorität)
- Logische Verknüpfung AND/OR

### 23.7.6 Geofence im IF-Knoten
Unterstützte Formen:
- Kreis (Mittelpunkt + Radius)
- Geschlossener Polygonzug (Punkt-für-Punkt per Leaflet)

Bedingungen:
- innerhalb
- außerhalb

### 23.7.7 Split/Join
- Split verzweigt den Ablauf in getrennte Pfade
- Join führt Pfade kontrolliert wieder zusammen
- Endknoten können Teilpfade oder Gesamtworkflow beenden

### 23.7.8 PDF-Export der Workflowgrafik
- Direkter PDF-Download
- DIN A3 Querformat
- Weiße Exportfläche für saubere Druckausgabe

## 24. Workflows und E-Mail-Templates zusammen nutzen
Empfohlenes Vorgehen:
1. E-Mail-Vorlage mit passenden Platzhaltern erstellen
2. Vorlage im Workflow-Schritt auswählen
3. Testlauf über Ticket durchführen
4. Vorschau/Queue/Log prüfen

## 25. Betriebsempfehlungen
- Änderungen in Templates, Workflows und Prompts versionieren
- Vor produktiver Aktivierung immer mit Testtickets prüfen
- Queue-Fehler und Integrationsfehler täglich überwachen
- Rechtevergabe streng rollenbasiert halten

## 26. Troubleshooting (Admin)
### 26.1 Workflow startet nicht
- Ticketstatus prüfen
- Vorlagen-ID prüfen
- Workflow-Instanz und Logs prüfen

### 26.2 Redmine-Tickets werden nicht erstellt
- API-Zugangsdaten/Projekt/Tracker prüfen
- Assignee-Mapping (User/Gruppe) prüfen
- Redmine-Schritt im Workflow auf Fehlermeldung prüfen

### 26.3 E-Mails gehen nicht raus
- SMTP-Test ausführen
- Mail Queue auf `failed` prüfen
- Retry/Resend mit Logabgleich

### 26.4 IF-Bedingung greift nicht wie erwartet
- Feldname und Operator prüfen
- Datentyp (Text/Status/Priorität) prüfen
- Bei Geofence Koordinaten und Form (Kreis/Polygon) prüfen

## 27. Empfohlener Einführungsablauf in der Verwaltung
1. Rollen und Benutzer anlegen
2. SMTP und KI-Provider konfigurieren
3. Redmine-Verbindung und Mapping validieren
4. E-Mail-Templates finalisieren
5. Workflows als DTPN modellieren und testen
6. Pilotbetrieb mit ausgewählten Kategorien
7. Go-Live und Monitoring

## 28. Änderungsmanagement
- Nach jeder fachlichen Änderung:
  - Funktionstest im Admin
  - Testmeldung im Bürgerfrontend
  - Prüfung von E-Mail-Output und Workflowlauf
- Größere Änderungen in Wartungsfenstern umsetzen

## 29. Kontakt und Verantwortlichkeit
Verantwortlich für den Betrieb:
- Verbandsgemeinde Otterbach-Otterberg

Systemname:
- behebes.AI

