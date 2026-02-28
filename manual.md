# behebes.AI Adminbackend - Endanwenderhandbuch

Stand: 18.02.2026  
Zielgruppe: Fachanwender, Sachbearbeitung, Administratoren  
System: behebes.AI (Adminportal der Verbandsgemeinde Otterbach-Otterberg)

## 1. Zweck und Leselogik dieses Handbuchs
Dieses Handbuch erklaert das gesamte Adminbackend als zusammenhaengenden Arbeitsablauf. Es ist bewusst als Fliesstext aufgebaut, damit jeder Bereich nicht nur als Funktionsliste, sondern als realer Bedienprozess verstanden wird. Die Kapitel folgen der tatsaechlichen Navigation im System und der Reihenfolge, in der die Funktionen im Alltag genutzt werden: zuerst Zugang und Orientierung, danach operative Kernarbeit, danach administrative Steuerung und schliesslich Wartung, Sicherheit und Stoerungsbehebung.

Wenn Sie neu im System sind, lesen Sie das Dokument einmal linear von oben nach unten. Wenn Sie bereits produktiv arbeiten, koennen Sie direkt in das Kapitel des jeweiligen Menuepunkts springen. Jedes Kapitel beschreibt die Bedienung schrittweise so, wie sie im Code umgesetzt ist, inklusive der zentralen Plausibilitaetsregeln und typischen Fehlerstellen.

## 2. Gesamtbild des Adminbackends
Das Adminbackend ist die operative Steuerzentrale fuer eingehende Meldungen. Technisch laufen hier drei Dinge zusammen: erstens die Ticketbearbeitung, zweitens die Workflow-Steuerung fuer automatisierte und manuelle Prozessschritte, und drittens die Systemkonfiguration fuer KI, E-Mail, Kategorien, Redmine und Mehrsprachigkeit. Alle Seiten sind so verknuepft, dass Sie von einem Ticket in den Workflow springen, aus dem Workflow in die Detailhistorie gehen und aus den Erkenntnissen direkt Konfigurationen anpassen koennen.

Im Alltag sollten Sie das System nicht als lose Sammlung einzelner Menuepunkte sehen, sondern als geschlossenen Regelkreis. Tickets entstehen im Buergerfrontend, werden im Adminbereich validiert und bearbeitet, Workflows steuern Folgeaktionen, Queues fuehren technische Aufgaben aus, und Statistik sowie Journal liefern die Rueckkopplung fuer Qualitaet und Betriebssicherheit.

## 3. Rollenmodell und Sichtbarkeit im Menue
Das Frontend normalisiert Rollen auf die operative Trennung zwischen `ADMIN` und `SACHBEARBEITER`. Die Rolle `SUPERADMIN` wird intern als `ADMIN` behandelt. In der Kopfzeile sehen Anwender den vereinheitlichten Rollenlabel.

Sachbearbeitung sieht die operativen Bereiche fuer taegliche Fallarbeit: Dashboard, Statistiken, Tickets, Karte/GIS, Workflow-Instanzen, Mail Queue, KI Queue, Profil und Logs. Administratoren sehen zusaetzlich den gesamten Block `Administration` inklusive Benutzer, Sessions, Journal, KI-Test und alle Einstellungen.

Wenn ein Menuepunkt fehlt, ist das in der Regel kein Darstellungsfehler, sondern ein Rollenrecht. Pruefen Sie in diesem Fall zuerst die Benutzerrolle in der Benutzerverwaltung.

## 4. Anmeldung, Passwortfluss und Sitzungssicherheit
Der Einstieg erfolgt ueber `/admin`. Die Loginseite bietet drei Modi in derselben Maske: regulaerer Login, Anforderung eines Reset-Links und Passwort-Neusetzung per Token. Im Loginmodus geben Sie Benutzername oder E-Mail und Passwort ein und entscheiden ueber `Angemeldet bleiben`. Bei aktivierter Option laeuft das Token laenger als bei einer Standardsitzung; organisatorisch sollten Sie diese Option nur auf vertrauten Arbeitsgeraeten nutzen.

Die Loginseite fuehrt parallel einen Gesundheitscheck gegen das Backend durch und zeigt den Zustand sichtbar an. Neben der Anmeldemaske wird ein Login-Gedicht angezeigt, das automatisch zyklisch aktualisiert wird; manuelle Erneuerung ist absichtlich zeitlich begrenzt, damit nicht beliebig oft neu generiert wird.

Der Resetprozess laeuft in drei Schritten. Erstens geben Sie im Reset-Link-Modus einen Identifier ein, zweitens erhalten Sie bei existierendem Konto eine Mail mit Ruecksetzlink, drittens setzen Sie mit Token ein neues Passwort. Die Rueckmeldung bei der Linkanforderung bleibt bewusst neutral, damit keine Benutzeraufzaehlung moeglich ist.

Nach erfolgreicher Anmeldung entsteht eine Session mit serverseitiger Nachvollziehbarkeit. Beim Logout wird sowohl der lokale Zustand geloescht als auch die Session serverseitig beendet. Gerade bei geteilten oder mobilen Geraeten ist aktives Logout verpflichtend.

## 5. Bediengrundlagen im Portal
Das Layout besteht aus Sidebar, Header, Hauptinhalt und Footer. Die Sidebar enthaelt die komplette Bereichsnavigation inklusive hierarchischer Gruppen. Der Header zeigt den aktiven Bereich, den angemeldeten Benutzer und den Logout. Der Footer zeigt den Live-Gesundheitszustand des Backends mit Zeitstempel.

Die Sidebar hat eine integrierte Menuesuche. Mit `/` fokussieren Sie das Suchfeld, auch wenn Sie nicht in der Sidebar stehen. Mit `Escape` leeren Sie den aktuellen Suchbegriff. Auf kleineren Viewports schaltet die Navigation in ein mobiles Verhalten mit Overlay um, auf grossen Viewports kann sie eingeklappt werden.

Wichtig fuer den Alltag ist ausserdem das automatische Verhalten bei Fehlermeldungen: Wenn neue Fehler- oder Erfolgsbanner eingeblendet werden, scrollt die Ansicht automatisch dorthin. Sie uebersehen damit kritische Rueckmeldungen deutlich seltener.

### 5.1 Live-Aktualisierung und Taktung
Das System arbeitet in fast allen Kernseiten mit einer Kombination aus Realtime-Events und periodischem Fallback-Polling. Das bedeutet praktisch: Sie muessen in der Regel nicht permanent manuell aktualisieren, sollten aber bei kritischen Entscheidungen trotzdem kurz auf den letzten Zeitstempel achten.

Die Loginseite prueft den Backend-Status in engem Rhythmus, die Hauptanwendung aktualisiert den globalen Healthzustand in laengerem Rhythmus. Ticket-, Dashboard-, Workflow- und Statistikseiten aktualisieren ihre Daten laufend, sofern die Seite sichtbar ist. Queue-Seiten arbeiten mit einem sehr kurzen Takt, damit Versand- und KI-Fehler zeitnah erkennbar bleiben.

### 5.2 Einheitliche Statusmodelle
Fuer Tickets sind die relevanten Stati `pending_validation`, `pending`, `open`, `assigned`, `in-progress`, `completed` und `closed`. Fuer Workflow-Instanzen werden `RUNNING`, `PAUSED`, `COMPLETED` und `FAILED` verwendet. Die Mail Queue nutzt `pending`, `retry`, `processing`, `sent`, `failed`, `cancelled`, und die KI Queue nutzt `pending`, `retry`, `processing`, `done`, `failed`, `cancelled`.

In der Bedienung ist entscheidend, diese Modelle nicht zu vermischen: Ein Ticket kann fachlich offen sein, waehrend die zugehoerige Workflow-Instanz bereits pausiert, und gleichzeitig kann eine Folge-E-Mail noch in der Queue haengen. Genau deshalb ist der Blick ueber mehrere Seiten hinweg im Alltag verpflichtend.

## 6. Empfohlener Arbeitsstart pro Schicht
Starten Sie jede Schicht auf dem Dashboard und pruefen Sie zuerst das Lagebild statt direkt einzelne Tickets zu oeffnen. Arbeiten Sie danach in dieser Reihenfolge: offene Ticketmengen filtern, kritische und blockierte Faelle priorisieren, haengende Workflows loesen, Queue-Fehler bereinigen und abschliessend die Statistik als Plausibilitaetskontrolle nutzen.

Fuer Administratoren kommt am Ende einer Schicht ein kurzer Kontrollblock hinzu: aktive Sessions, Journalereignisse und nur bei Bedarf Konfigurationsaenderungen. Konfigurationsaenderungen sollten immer in ruhigen Lastphasen passieren und intern dokumentiert werden.

## 7. Dashboard
Das Dashboard ist die operative Startseite und verbindet Kennzahlen mit direkter Aktion. Sie sehen KPI-Karten fuer Gesamtaufkommen, offene/geschlossene Lage und Workflow-SLA-Verteilung. Darunter folgen Schnellzugriffe auf die wichtigsten Bereiche, eine Tickettabelle fuer den direkten Einstieg, ein Panel fuer blockierte Workflows und ein Live-Panel fuer laufende Timer in Workflow-Schritten.

Die Daten werden nicht nur manuell geladen, sondern laufend aktualisiert: per Realtime-Events und periodischem Fallback-Refresh. Dadurch eignet sich das Dashboard fuer den laufenden Betrieb ohne staendiges manuelles Neuladen.

Praktischer Ablauf in Schritten:
1. Waehlen Sie im Ticketpanel zuerst einen Statusfilter, um die Arbeitsmenge zu fokussieren.
2. Nutzen Sie die Suche, wenn Sie Ticket-ID, Kategorie oder Ort bereits kennen.
3. Oeffnen Sie kritische Tickets direkt ueber den Detaillink.
4. Pruefen Sie im Blocker-Panel, ob Workflows manuelle Freigabe oder Fehlerbehandlung benoetigen.
5. Beobachten Sie im Timer-Panel ueberfaellige Warteaufgaben, bevor SLA-Verstoesse entstehen.

Als Administrator koennen Sie auf dem Dashboard Mehrfachauswahl nutzen und Tickets gesammelt loeschen. Diese Funktion ist absichtlich nicht fuer Sachbearbeitung sichtbar.

## 8. Statistiken
Die Statistikseite analysiert Tickets ueber definierte Zeitfenster von 30, 90, 180 oder 365 Tagen. Das Layout ist in Ebenen gegliedert: zuerst Gesamt-KPIs, danach Trendkarten gegen die Vorperiode, dann Verteilungen nach Kategorie, Ort, Status und Zeit, plus Backlog-Alter und Hotspotdaten.

Die Seite aktualisiert sich ebenfalls periodisch und reagiert auf Ticket-Realtime-Impulse. Sie ist damit nicht nur Reporting, sondern auch eine operative Fruherkennung fuer Lastspitzen, rueckstaendige Ticketalterung und geographische Haefungen.

Ein sinnvoller Auswerteablauf ist: Zeitraum festlegen, Trendkarten lesen, Ausreisserkategorien pruefen, Stadtverteilung und Hotspots vergleichen, dann Backlog-Alter gegen Teamkapazitaet spiegeln. So vermeiden Sie, dass einzelne Kennzahlen isoliert fehlinterpretiert werden.

## 9. Tickets-Liste
Die Ticketliste ist das zentrale Arbeitsboard fuer den Fallzugriff. Sie bietet Statusfilter, Volltextsuche, Sortierung je Spalte und Paging bis zur Vollanzeige. Jede Zeile oeffnet die Detailseite; fuer Administratoren kommen row-basierte und bulk-basierte Steueraktionen hinzu.

Inhaltlich sehen Sie pro Ticket mindestens Kategorie, Status, Prioritaet, Ort, Erstellzeit, Bildindikator und Workflowzustand. Ein gestarteter Workflow wird inklusive Kurzstatus und Instanz-ID dargestellt, ein nicht gestarteter Workflow ist explizit markiert.

Schrittfolge fuer die taegliche Arbeit:
1. Setzen Sie den Statusfilter auf den Bearbeitungsfokus der Schicht.
2. Sortieren Sie nach `Erstellt` oder `Prioritaet`, je nachdem ob Rueckstand oder Dringlichkeit im Vordergrund steht.
3. Oeffnen Sie Tickets per Zeilenklick in der Detailansicht.
4. Starten Sie bei Bedarf direkt aus der Tabelle einen Workflow, wenn noch keiner laeuft.
5. Nutzen Sie bei grossen Mengen die Mehrfachauswahl fuer Sammelaktionen.

Administrationsfunktionen in der Liste sind `Workflow starten` und `Loeschen`, jeweils einzeln und als Bulk. Bulk-Loeschen zeigt Teilerfolge und Fehlschlaege getrennt an.

## 10. Ticket-Detailseite
Die Ticket-Detailseite ist die tiefste operative Bearbeitungsebene. Sie kombiniert Stammdaten, Beschreibung, Standort, Bilder, Validierungsstatus, KI-Logik und Workflowsteuerung in einer Ansicht.

### 10.1 Workflow-Start im Ticket
Oben befindet sich der Workflow-Startblock. Sie koennen eine Vorlage explizit auswaehlen oder die automatische Vorlagenauswahl nutzen. Wenn bereits ein aktiver Workflow laeuft, ist ein erneuter Start blockiert, bis der aktive Ablauf abgeschlossen oder in Fehlerzustand ueberfuehrt wurde.

### 10.2 Workflow-Livebereich
Wenn ein Workflow existiert, sehen Sie zunaechst eine komprimierte Statuszeile mit SLA, Blocker, Fortschritt und aktueller Aufgabe. Ueber `Details anzeigen` oeffnen Sie die Vollansicht mit Fortschrittsbalken, Metadaten, aktiver Aufgabe und manuellen Freigaben.

Bei pausierten Instanzen mit offenen manuellen Tasks stehen `Freigeben` und `Ablehnen` direkt je Task bereit. Bei fehlgeschlagenen Tasks sehen Sie den Recoveryblock mit `Retry`, `Skip mit Grund` und `Manuell fortsetzen`.

### 10.3 DTPN-Workflowgrafik im Ticket
Die Seite zeigt die grafische DTPN-Uebersicht des laufenden Ablaufs mit Knoten, Kanten und Pfadstatus. Ueber den PDF-Button exportieren Sie die aktuelle grafische Sicht als Dokument, was fuer Abstimmung oder externe Dokumentation hilfreich ist.

### 10.4 Ticketdaten bearbeiten
Im Bearbeitungsblock koennen Sie Kategorie, Prioritaet, Status, Zuweisung, Beschreibung und Standortdaten inklusive Koordinaten anpassen. Parallel existiert ein schneller Statuswechsler in der Basis-Informationskarte. Speichern im Editiermodus aktualisiert den Datensatz vollstaendig; der schnelle Statuswechsler ist fuer schnelle Prozesszustandswechsel gedacht.

### 10.5 Bilder, Validierung und KI-Feedback
Bilder werden als Galerie angezeigt und lassen sich vergroessern, durchblaettern und herunterladen. Pro Bild sehen Sie zusaetzlich EXIF-Metadaten, insbesondere ob EXIF vorhanden ist, ob GPS-Koordinaten in EXIF enthalten sind, sowie die erkannten Werte. Per Klick auf den EXIF-GPS-Hinweis oeffnen Sie eine Leaflet-Karte im Modal mit Marker auf der erkannten Position. In der Vollansicht steht zusaetzlich ein externer Kartenlink zur Verfuegung. Im Standortblock laesst sich die Adresse direkt in die Zwischenablage kopieren. Bei Tickets im Validierungsbereich sehen Sie den Double-Opt-In-Status inklusive Option fuer manuelle Verifikation.

Wenn ein KI-Log vorhanden ist, sehen Sie Entscheidung und Begruendung sowie ein Feedbackformular. Dort koennen Sie die Kategorie korrigieren und Freitextfeedback speichern. Dieses Feedback fliesst in die Nachvollziehbarkeit der KI-Entscheidungen ein.

### 10.6 Empfohlener Bearbeitungsablauf pro Ticket
1. Ticket oeffnen und zuerst Status, Kategorie und Standort plausibilisieren.
2. Wenn kein Workflow aktiv ist, passenden Ablauf starten.
3. Bei pausierten manuellen Schritten Freigabeentscheidung treffen.
4. Bei Fehlerschritten Recovery bewusst mit Begruendung ausfuehren.
5. Nach Abschluss der Fachpruefung Status und ggf. KI-Feedback final setzen.

## 11. Karte/GIS
Die GIS-Seite kombiniert Kartenansicht und operative Sammelbearbeitung. Neben klassischer Ticketanzeige unterstuetzt sie Basiskartenwechsel, Hotspot-Overlay, geographische Selektion und Bulk-Patching mit Begruendungspflicht.

Filterbar sind Status, Kategorie, Prioritaet, Workflowzustand und Freitext. Zusatztoggles begrenzen auf geocodierte Tickets, auf den aktuellen Kartenausschnitt oder auf Hotspotdarstellung. Hotspots beziehen sich auf ein waehlbares Zeitfenster.

Die Selektion erfolgt per Rechteck oder Polygon. Beim Polygon setzen Sie Punkte auf der Karte und schliessen die Flaeche explizit ab. Die resultierende Auswahl wird direkt fuer Bulk-Aktionen nutzbar.

### 11.1 Bulk-Aenderungen in der Karte
Im Seitenpanel `Bulk-Aktionen` waehlen Sie optional neuen Status, neue Prioritaet und optionalen Workflowstart inklusive optionaler Vorlage. Zwingend ist ein Begruendungstext. Ohne Begruendung wird die Aktion nicht ausgefuehrt.

### 11.2 Geocoding-Workflow
Ungeocodete Tickets erscheinen in einem separaten Panel. Sie koennen einzelne Tickets geocodieren oder Batch-Geocoding fuer eine begrenzte Menge starten. Der Batch verarbeitet bewusst nur einen begrenzten Block (maximal 15 Tickets pro Lauf), damit die Aktion kontrollierbar bleibt und Fehler gezielt nachvollzogen werden koennen. Nach Geocoding aktualisiert die Seite Tickets und optional Hotspots.

### 11.3 Praxisablauf fuer GIS-Arbeit
1. Fachfilter setzen und Kartenausschnitt fokussieren.
2. Selektion mit Rechteck oder Polygon erzeugen.
3. Plausibilitaet in der unteren Tabelle gegenpruefen.
4. Bulk-Aktion mit klarer Begruendung ausfuehren.
5. Ungeocodete Restmenge geocodieren, damit spaetere Analysen robuster werden.

## 12. Workflow-Instanzen
Die Seite `Workflow-Instanzen` ist die Leitwarte fuer laufende, pausierte, abgeschlossene und fehlerhafte Ausfuehrungen. Sie sehen Gesamtkennzahlen, SLA-Lage, Blockerzahl und offene manuelle Freigaben.

Der obere Bereich enthaelt Tabs fuer Fokusmodi (`Alle`, `Warten auf Freigabe`, `Pausiert`, `Abgeschlossen`) und darunter einen eigenen Bereich `Manuelle Workflow-Steuerung`, der pausierte Instanzen mit offenen manuellen Tasks priorisiert.

Im Haupttableau stehen pro Instanz Status, SLA, Blocker, Modus, Kategorie, aktuelle Task, Schrittposition und Ticketbezug. Pro Zeile sind je nach Zustand folgende Aktionen moeglich: Details, Freigeben, Ablehnen, Retry, Skip, Fortsetzen und Loeschen.

Bulk-Funktionen unterstuetzen Mehrfach-Freigaben und Mehrfach-Loeschungen. Die Detailansicht im Overlay zeigt Metadaten, Historie, Task-Konfigurationen und Ausfuehrungsdaten, inklusive technischer Payload-Vorschau bei API-Aufrufen.

Empfohlene Reihenfolge bei Stoerung:
1. Instanz ueber Filter und Suche eingrenzen.
2. Detailansicht oeffnen und Historie plus aktuellen Schritt lesen.
3. Bei manuellen Tasks fachlich freigeben oder ablehnen.
4. Bei Fehlern zwischen Retry, Skip und Fortsetzen unterscheiden.
5. Nur loeschen, wenn die Instanz fuer die Fachbearbeitung nicht mehr benoetigt wird.

## 13. Mail Queue
Die Mail Queue visualisiert den Versandzustand asynchroner E-Mail-Auftraege mit den Stati `pending`, `retry`, `processing`, `sent`, `failed` und `cancelled`. Die Seite aktualisiert sich sehr haeufig, damit Versandprobleme frueh sichtbar sind.

Pro Eintrag sind `Retry`, `Neu senden` und `Loeschen` moeglich. `Retry` nutzt denselben Auftrag erneut, waehrend `Neu senden` einen neuen Versandauftrag erzeugt. Das ist wichtig, wenn Inhalte zuvor korrigiert wurden.

Bulk-Aktionen sind fuer Retry, Neuversand und Loeschen verfuegbar. In der Praxis sollten Sie zuerst Fehlermeldung und SMTP-Konfiguration pruefen und erst danach Massenaktionen starten.

## 14. KI Queue
Die KI Queue arbeitet analog zur Mail Queue, aber fuer KI-Jobs mit den Stati `pending`, `retry`, `processing`, `done`, `failed`, `cancelled`. Sie bietet neben Retry, Abbrechen und Loeschen auch eine Detailansicht je Job.

Die Detailansicht zeigt Prompt, Ergebnis, letzten Fehler, Metadaten, Provider und Modell. Genau diese Kombination ist entscheidend, um Promptprobleme von Providerproblemen sauber zu trennen.

Fuer Betriebsstabilitaet gilt: Bei gehaeuften `failed`-Eintraegen zuerst Provider-/Modellzustand und Prompts pruefen, dann selektiv Retry fahren, statt blind die gesamte Queue erneut anzustossen.

## 15. Logs
Die Logseite zeigt KI-Entscheidungslogs mit Ticketbezug, KI-Entscheidung, Admin-Feedback und Zeitstempel. Suche, Sortierung, Einzel-Loeschung und Bulk-Loeschung sind vorhanden. Fachlich sollten Loeschungen restriktiv verwendet werden, weil diese Daten fuer Rueckanalysen und Qualitaetsarbeit relevant sind.

## 16. Mein Profil
Im Profilbereich verwalten Anwender eigene Stammdaten und das eigene Passwort. Beim Passwortwechsel sind Mindestlaenge und Passwortbestaetigung verpflichtend. Profilaenderungen aktualisieren gleichzeitig den angezeigten Nutzernamen im Portalheader.

Empfehlung fuer den Betrieb: Profilfelder aktuell halten, Passwortwechsel bei Verdacht sofort ausfuehren und keine Wiederverwendung alter Kennwoerter.

## 17. Benutzerverwaltung (nur ADMIN)
Die Benutzerverwaltung deckt Lebenszyklus und Rechtevergabe ab: Anlegen, Bearbeiten, Rollenwechsel, Aktiv/Inaktiv, Passwortreset ueber Editiermaske und Loeschen.

Der Erstellprozess verlangt Benutzername und Startpasswort, Rolle ist waehlbar. In der Bearbeitung koennen E-Mail, Rolle, Aktivstatus und optional neues Passwort gesetzt werden. Tabellenansicht und Suche erleichtern groessere Nutzerbestaende.

Bulk-Aktionen erlauben Aktivieren, Deaktivieren, Rollenwechsel auf Admin oder Sachbearbeiter sowie Sammelloeschung. Aus Sicherheitssicht sollten Rollenwechsel immer nach dem Prinzip minimaler Rechte erfolgen.

## 18. Sessions (nur ADMIN)
Die Sessionseite zeigt aktive, inaktive oder alle Sitzungen inklusive Session-Cookie, Clientdaten, Aktivitaetszeiten und Ablauf. Administratoren koennen einzelne Sitzungen beenden, Eintraege loeschen und Session-Cookies kopieren. Dasselbe geht als Bulk fuer markierte Reihen.

Typische Einsatzfaelle sind erzwungene Abmeldung bei Vorfaellen, Bereinigung alter Sessions oder technische Fehleranalyse ueber User-Agent/IP-Muster.

## 19. Journal (nur ADMIN)
Das Journal ist die revisionsnahe Sicht auf Adminereignisse. Sie filtern nach Eventtyp, suchen ueber Benutzer/Request/Details, sortieren und paginieren. Auswahlen koennen als JSON exportiert werden, was fuer Uebergaben an Revision oder IT-Sicherheit hilfreich ist.

Loeschungen sind einzeln und als Bulk moeglich. In produktiven Umgebungen sollte eine klare interne Policy definieren, wann Journaldaten geloescht werden duerfen.

## 20. KI-Test (nur ADMIN)
Der Menuepunkt `KI-Test` ist ein freier Prompttester fuer den aktuell konfigurierten Provider und das aktive Modell. Sie senden beliebigen Prompttext, sehen die Rohantwort und behalten die letzten Testergebnisse als Verlauf.

Der Ablauf ist einfach: Prompt eingeben, testen, Antwort pruefen, bei Bedarf Prompt anpassen und erneut testen. Fuer reproduzierbare Fehleranalyse empfiehlt sich, Prompt und Zeitstempel zusammen intern zu dokumentieren.

## 21. Einstellungen - Struktur
Der Einstellungsbereich ist in logisch getrennte Unterseiten aufgeteilt. Jede Unterseite hat einen klaren Verantwortungsbereich: allgemeine Systemparameter, Kategorien, KI, SMTP, Templates, Prompts, KI-Hilfe, Redmine, Workflow-Definitionen und Uebersetzungsplanung. Durch die Segmentierung koennen Aenderungen mit geringerem Seiteneffekt durchgefuehrt werden.

## 22. Allgemein - Basis und Links
Hier konfigurieren Sie den Anwendungsnamen sowie die Callback-Logik fuer Verifizierungs-, Status-, Workflow- und Passwort-Reset-Links. Es gibt zwei Modi: `auto` (empfohlen) und `custom`.

Im Auto-Modus wird die wirksame URL deploymentbasiert bestimmt. Im Custom-Modus muss eine gueltige absolute URL eingetragen werden. Beim Speichern validiert das System URL-Format und Konfiguration. Fuer produktive Umgebungen sollte Custom nur genutzt werden, wenn die Standardableitung technisch nicht passt.

## 23. Allgemein - Buergerportal, Orte und Geofence
Dieser Block steuert oeffentliches Eingabeverhalten und geographische Zustaendigkeit.

Der Wartungsmodus kann aktiviert werden, inklusive frei formulierbarer Wartungsnachricht. Fuer Standorteingrenzung gibt es zwei Ebenen: Orts-Whitelist und koordinatenbasierten Geofence. Bei aktivem Geofence kann zwischen Kreis und Polygon gewaehlt werden.

Kreis verlangt Mittelpunktkoordinaten plus Radius. Polygon verlangt mindestens drei Punkte. Die Speicherung prueft diese Mindestbedingungen explizit. Fachlich sollte Geofence immer mit realen Testmeldungen gegen geographische Randfaelle verifiziert werden.

## 24. Allgemein - Sprachen und Uebersetzung
In der Sprachsektion pflegen Sie Standardsprache und Sprachkatalog. Sprachen koennen per Schnellwahl hinzugefuegt oder frei editiert werden, inklusive Code, Label, KI-Name, Locale, Schreibrichtung und Flagge.

Pro Sprache steht `Uebersetzung erzeugen` zur Verfuegung. Dabei werden die Buerger-UI-Strings gegen die gewaehlte Zielsprache voruebersetzt. Die Seite zeigt je Sprache den Zustand `Uebersetzt` oder `Nicht uebersetzt`.

Wichtig fuer die Praxis ist die Reihenfolge: zuerst Sprachkatalog sauber pflegen, dann Uebersetzungen erzeugen, danach Standardsprache festlegen und speichern.

## 25. Uebersetzungen vorplanen
Dieser Bereich ist die zentrale Funktion fuer persistente Voruebersetzung von UI- und E-Mail-Inhalten. Genau hier wird Laufzeitlatenz reduziert, weil benoetigte Uebersetzungen bereits vorbereitet in der Datenbank liegen.

### 25.1 Betriebslogik
`Play` aktiviert den Planer dauerhaft. `Stop` deaktiviert neue zyklische Durchlaeufe, ein bereits laufender Durchlauf endet reguler. `Jetzt durchlaufen` triggert sofort einen Lauf. Wenn bereits ein Lauf aktiv ist, wird der manuelle Trigger vorgemerkt und anschliessend ausgefuehrt.

Der Worker laeuft serverseitig im Hintergrund und prueft zyklisch in einem festen Intervall von 45 Sekunden. Verarbeitet werden alle konfigurierten Zielsprachen ausser der Standardsprache. Im Ergebnis sehen Sie Metriken wie Anzahl Sprachen, Anzahl Templates, neu/aktualisiert fuer UI und E-Mail sowie Gesamtdauer.

Inhaltlich werden UI-Texte und E-Mail-Templates unterschiedlich behandelt. Bei UI-Eintraegen werden fehlende oder leere Zieltexte pro Sprachkatalog ergaenzt. Bei E-Mail-Eintraegen wird geprueft, ob sich die Quellvorlage geaendert hat; nur dann wird die Zieluebersetzung aktualisiert. Dadurch bleiben manuell nachgearbeitete Inhalte stabil, solange die Quelle unveraendert ist.

### 25.2 Listen- und Detailarbeit
Die linke Seite filtert nach Typ (`UI`, `E-Mail`) und Sprache, plus Suche. Jede Zeile oeffnet rechts die Detailansicht.

Bei UI-Eintraegen sehen Sie Queltext und Uebersetzung und koennen den Zieltext direkt speichern oder loeschen. Bei E-Mail-Eintraegen koennen Sie Template-Name, Betreff, HTML, Text und Uebersetzungshinweis editieren, speichern oder loeschen. Damit ist die Funktion nicht nur Automatisierung, sondern auch redaktioneller Feinschliff.

### 25.3 Schrittfolge fuer produktive Nutzung
1. In `Allgemein - Sprachen` Zielsprachen sauber anlegen.
2. In `Uebersetzungen vorplanen` `Play` aktivieren.
3. Einmal `Jetzt durchlaufen` ausfuehren und Summary pruefen.
4. Kritische Eintraege in der Detailansicht redaktionell nacharbeiten.
5. Bei Templateaenderungen spaeter erneut Lauf anstossen, damit neue Quellen nachgezogen werden.

## 26. Allgemein - Betriebsalarme
Hier steuern Sie Benachrichtigungen bei Workflow-Abbruechen. Wenn aktiviert, versendet das System bei fehlgeschlagenen Instanzen eine Mail mit Ticket-, Workflow- und Fehlerbezug an den konfigurierten Empfaenger.

Fuer den Betrieb empfiehlt sich ein dediziertes Funktionspostfach statt personenbezogener Adresse, damit Alarme auch bei Abwesenheit abgearbeitet werden.

## 27. Allgemein - Daten und Wartung
Die Wartungsseite bietet SQL-Backup-Export, SQL-Import und eine Gefahrenzone fuer harte Loeschung von Ticket- und Workflowdaten.

Der SQL-Export liefert einen Dump als Datei. Beim Import wird ein SQL-Dump eingespielt; diese Aktion kann Bestanddaten ueberschreiben. Die Gefahrenzone loescht Ticket- und zugehoerige Workflowdaten irreversibel.

Verbindliche Reihenfolge bei riskanten Eingriffen:
1. Vor jeder grossen Aktion Backup exportieren.
2. Aktion und Zeitpunkt intern abstimmen.
3. Import oder Purge bestaetigen.
4. Nachlaufend Stichproben in Tickets, Workflows und Queues pruefen.

## 28. Kategorien
Die Kategorienseite steuert die Klassifikationsbasis. Kategorien enthalten Name, Beschreibung, Keywords, optional externen Empfaenger und optionales Workflow-Template. Die Seite bietet Karten- und Tabellenansicht, Suche, Sortierung und Filter.

Fuer Administratoren gibt es einen KI-Assistenten, der aus einer Freitextbeschreibung einen Kategorieentwurf inklusive Workflowvorschlag erzeugt. Entwuerfe koennen als neue Kategorie uebernommen oder in eine bestehende Bearbeitung eingespielt werden.

Die Seite enthaelt zusaetzlich den Tab `Classify Prompt`, in dem der globale Klassifikationsprompt direkt gepflegt wird. Speichern ist nur aktiv, wenn sich der Inhalt geaendert hat.

## 29. KI-Provider
Hier waehlen Sie aktiven KI-Provider und Modell, pflegen Credentials und pruefen den Klassifikationsprompt mit Testpayload.

Providerseitig ist die Umschaltung zwischen `openai` und `askcodi` vorgesehen, inklusive modellabhaengiger Auswahl. Credentials sind getrennt pflegbar (API-Keys bzw. OAuth/Client-Daten).

Der integrierte Prompttest akzeptiert Beschreibung, Ortsinformationen und optional Koordinaten. Als Ergebnis sehen Sie gesendeten Prompt und rohe Modellantwort, was fuer Diagnose und Promptarbeit essenziell ist.

## 30. E-Mail SMTP
Die SMTP-Seite verwaltet Host, Port, Benutzer, Passwort und Absenderdaten. Uebliche Ports sind 25, 465 und 587. Nach Aenderungen sollte immer ein kontrollierter Versandtest erfolgen, idealerweise ueber Queuebeobachtung.

Wenn Zustellung fehlschlaegt, pruefen Sie Reihenfolge: SMTP-Daten, Netzwerk/Erreichbarkeit, Authentifizierung und dann erst Queue-Retry.

## 31. E-Mail-Templates
Die Templateverwaltung ist ein umfangreicher Editor fuer systemweite Mails. Links waehlen Sie Vorlagen, rechts bearbeiten Sie Name, Betreff, HTML und Text-Fallback. Systemvorlagen koennen schreibgeschuetzt sein.

### 31.1 Platzhaltersteuerung
Jede Vorlage hat einen Platzhalterkatalog und eine Auswahl verpflichtender Platzhalter. Beim Speichern prueft das System, ob diese Platzhalter in Betreff/HTML enthalten sind. Fehlende Pflichtplatzhalter werden als Fehler gemeldet.

### 31.2 KI-Unterstuetzung
Fuer editierbare Vorlagen koennen Sie auf Basis einer Kategorie und eines Tonfalls einen KI-Entwurf erzeugen. Die Kategoriebeschreibung wird dabei als Kontext genutzt. Nach Generierung sollten Sie immer manuell pruefen, ob Platzhalter, Stil und Fachsprache passen.

### 31.3 Vorschau und globale Signatur
Die Vorschau zeigt gerendertes HTML und Text-Fallback nebeneinander. Separat pflegen Sie eine globale Footer-Signatur (HTML + Text), die optional aktivierbar ist und an alle ausgehenden Mails angehaengt wird.

### 31.4 Neue Vorlage anlegen
Sie koennen eigene Vorlagen mit Name, optional technischer ID, Betreff, HTML, Text und Platzhalterset erstellen. Nach Anlage wird die Vorlage direkt in der Liste verfuegbar und kann in Workflows referenziert werden.

## 32. System-Prompts
Diese Seite ist das zentrale Steuerpanel fuer KI-Systemprompts. Alle relevanten Promptgruppen sind separat editierbar, darunter Klassifizierung, Redmine-Ticketerzeugung, Templategenerierung, JSON-Reparatur, Workflowgenerierung, Workflowauswahl, Uebersetzungsprompts, Admin-KI-Hilfe und Kategorienassistent.

Aenderungen wirken unmittelbar auf KI-Antworten. Deshalb gilt ein kontrollierter Ablauf: Prompt zielgerichtet aendern, speichern, Testfaelle ausfuehren, Ergebnis dokumentieren, erst dann naechsten Prompt anfassen.

## 33. KI-Hilfe
Die KI-Hilfe ist ein interaktiver Assistent fuer Bedienfragen im Adminbereich. Sie waehlen einen Kontextbereich, stellen eine Frage und erhalten eine konkrete Antwort mit Verlauf.

Der Verlauf bleibt in der Seite sichtbar und kann geloescht werden. Fuer reproduzierbare Teamarbeit ist es sinnvoll, besonders hilfreiche Antworten intern als SOP zu uebernehmen.

## 34. Redmine
Die Redmine-Seite verbindet das System mit externer Ticketinfrastruktur. Sie pflegen Base-URL und API-Key, synchronisieren Stammdaten und aktivieren gezielt nutzbare Projekte, Benutzer, Tracker, Rollen und Gruppen.

Nach der Synchronisierung zeigt die Seite einen konsolidierten Stand mit aktivierten Anteilen pro Entitaet. Benutzer koennen ueber Suche, Statusfilter und Sichtbarkeitsfilter eingegrenzt und gruppenweise aktiviert oder deaktiviert werden.

Issue-Status werden zusaetzlich gelistet, damit Workflowschritte mit Wartebedingungen fachlich korrekt konfiguriert werden koennen.

Empfohlene Inbetriebnahme in Schritten:
1. Base-URL und API-Key eintragen.
2. Synchronisierung starten.
3. Projekte und Tracker fachlich freischalten.
4. Assignee-Pool ueber Benutzer und Gruppen einschaerfen.
5. Konfiguration speichern.
6. End-to-End-Test mit echtem Testticket durchfuehren.

## 35. Workflow-Definitionen
Dies ist die tiefste Konfigurationsseite des gesamten Adminbackends. Hier werden nicht nur Vorlagen angelegt, sondern die gesamte Ablauflogik modelliert, validiert, importiert, exportiert und im DTPN-Graph visuell geprueft.

### 35.1 Was diese Seite fachlich steuert
Jede Workflowvorlage besteht aus Grunddaten, Runtime/SLA-Regeln und einer geordneten Schrittliste. Beim Speichern werden die Schrittbeziehungen in eine technische Task-Referenzstruktur umgerechnet und bei der Ausfuehrung genau so abgearbeitet. Diese Seite ist damit direkt wirksam fuer echte Tickets.

### 35.2 Vorlagenliste vor dem Editor
Vor dem Oeffnen des Editors sehen Sie alle Vorlagen in `Kacheln` oder `Tabelle`. Beide Ansichten zeigen Name, Ausfuehrungsmodus, Schrittzahl, Aktivstatus und Auto-Startmarkierung nach Verifizierung.

Pro Vorlage stehen `Bearbeiten`, `Export` und `Loeschen` bereit. Der Standardworkflow mit der ID `standard-redmine-ticket` ist absichtlich gegen Loeschung gesperrt.

### 35.3 Aktionen auf Listenebene
Oben in der Vorlagenliste steuern Sie den Gesamtbestand:
1. `KI-Assistent` oeffnet den Generator fuer neue Entwuerfe.
2. `JSON Export` exportiert den gesamten Vorlagenbestand.
3. `JSON Import` importiert eine oder mehrere Vorlagen.
4. `Neue Vorlage` startet einen leeren Entwurf.

### 35.4 JSON Import sehr genau
Der Importdialog liest die Datei ein und zeigt alle erkannten Vorlagen mit Schrittzahl und Modus. Danach waehlen Sie den Importmodus:
1. `Zusammenfuehren (merge)`: existierende IDs werden aktualisiert, neue IDs werden angelegt.
2. `Ersetzen (replace)`: bestehende Vorlagen werden vor dem Import geloescht, danach werden die importierten Vorlagen geschrieben.

Wenn genau eine Vorlage ausgewaehlt ist, koennen Sie den Namen vor dem Import direkt ueberschreiben. Bei mehreren Vorlagen ist Mehrfachauswahl moeglich, inklusive `Alle auswaehlen` oder `Auswahl aufheben`.

### 35.5 KI-Workflowassistent sehr genau
Der KI-Dialog erzeugt einen DTPN-Entwurf aus Freitext. Sie steuern dort:
1. Name-Vorschlag.
2. Beschreibung-Vorschlag.
3. Ausfuehrungsmodus `MANUAL`, `AUTO` oder `HYBRID`.
4. Maximale Schrittzahl.
5. Auto-Start nach Verifizierung.
6. Aktivstatus der Vorlage.

Der Prompt muss ausreichend konkret sein, damit die KI eine gueltige Struktur erzeugt. Der Dialog zeigt eine eingebaute Referenz mit erlaubten Schrittarten, Config-Feldern und Modellierungsregeln. Wird bereits ein Entwurf bearbeitet, fragt das System vor Ersetzung bestaetigend nach.

### 35.6 Editoraufbau und Panel-Logik
Der Editor besteht aus drei auf- und zuklappbaren Bereichen:
1. `Workflow-Grunddaten` links oben.
2. `Ablauf-Editor` links unten.
3. `Grafischer Workflow-Editor` rechts.

Oben im Editor stehen zusaetzlich `KI-Assistent`, `JSON Import` und `JSON Export` fuer genau den aktuellen Entwurf bereit. Ueber `Zurueck zur Vorlagenliste` verlassen Sie den Editor ohne Speichern.

### 35.7 Workflow-Grunddaten im Detail
Im Grunddatenblock pflegen Sie:
1. `Name`.
2. `Beschreibung`.
3. `Ausfuehrungsmodus`.
4. `Vorlage aktiv`.
5. `Auto-Start nach E-Mail-Verifizierung`.

Diese Werte gelten fuer die gesamte Vorlage. Sie steuern also nicht einen einzelnen Schritt, sondern das globale Verhalten bei Instanzstart und Laufzeitmodus.

### 35.8 Runtime & SLA im Detail
Der Block `Runtime & SLA` setzt Guardrails fuer Stabilitaet und Ueberwachung:
1. `Max. Transitionen`: harte Obergrenze fuer Schrittwechsel einer Instanz.
2. `Max. Besuche pro Knoten`: Loop-Schutz gegen endlose Rueckspruenge.
3. `Default Timeout (Sek.)`: Fallback-Timeout pro Schritt.
4. `Retry max. Versuche` und `Retry Backoff`: globale Wiederholungslogik.
5. `SLA Ziel` in Wochen/Tagen/Stunden.
6. `SLA Risiko-Schwelle (%)`: Umschlagpunkt von `ok` auf `risk`.

Praxisregel: Setzen Sie diese Werte zuerst konservativ, testen Sie reale Lastfaelle und lockern Sie erst danach. Zu niedrige Werte brechen Prozesse ab, zu hohe Werte verbergen Fehler zu lange.

### 35.9 Ablauf-Editor Grundbedienung
Jeder Schritt liegt als eigene Karte in der Schrittliste. Die Liste unterstuetzt:
1. Drag-and-Drop-Reihenfolge per Griff.
2. Einfuegen zwischen zwei Karten ueber die Separatoren.
3. Entfernen einzelner Schritte.
4. Fokussiertes Aufklappen genau eines Schritts.

Beim Schritt selbst definieren Sie:
1. Titel.
2. Schritt-Typ.
3. Automatikflag `Automatisch ausfuehren`.

Wichtig: Bei `JOIN` ist Automatik immer fest aktiv und nicht deaktivierbar. Wenn Sie den Typ eines vorhandenen Schrittes aendern, wird die Config des Schritts auf den Default dieses Typs zurueckgesetzt.

### 35.10 Schrittarten und Konfiguration
Unterstuetzte Typen sind `REDMINE_TICKET`, `EMAIL`, `EMAIL_EXTERNAL`, `EMAIL_CONFIRMATION`, `CITIZEN_NOTIFICATION`, `REST_API_CALL`, `SPLIT`, `JOIN`, `IF`, `WAIT_STATUS_CHANGE`, `CHANGE_WORKFLOW`, `END` und `CUSTOM`.

### 35.10.1 REDMINE_TICKET
Dieser Typ hat drei Konfigurationsbloecke:
1. Ziel in Redmine: Projektmodus, Trackermodus und Zuweisungsmodus jeweils `KI` oder `Fest`; fuer Zuweisung zusaetzlich `Ohne Zuweisung`.
2. Tickettext: Textmodus `KI` oder `Vorlagen-Text`, plus Titel- und Beschreibungsvorlage mit Platzhaltern und Live-Vorschau.
3. Optionales Status-Warten: `Nach Erstellung auf Zielstatus in Redmine warten`, inkl. Intervall und Zielstatusauswahl.

Wenn Konfigurationen unvollstaendig sind, zeigt der Editor Warnhinweise, zum Beispiel bei aktivem Festmodus ohne gewaehlten Wert oder aktiviertem Status-Warten ohne Zielstatus.

### 35.10.2 EMAIL und EMAIL_EXTERNAL
Beide Typen arbeiten gleich: optionale Empfaengeradresse, optionaler Empfaengername und Template-ID. Leere Empfaengeradresse bedeutet, dass der Empfaenger aus der Kategoriekonfiguration gezogen werden kann.

### 35.10.3 EMAIL_CONFIRMATION
Dieser Typ fordert eine Freigabe an und pausiert den Ablauf bis zur Entscheidung. Sie konfigurieren:
1. Empfaengertyp `Buerger aus Ticket` oder `Fester Empfaenger`.
2. Template-ID fuer die Freigabemail.
3. Optionalen Ablehnungspfad.
4. Anweisungstext in der Mail.
5. Optionalen KI-Prompt, um den Anweisungstext generieren zu lassen.

Der Zustimmungs-Pfad wird ueber den regulaeren `Naechster Schritt` gesteuert, der Ablehnungspfad separat im gleichen Schritt.

### 35.10.4 CITIZEN_NOTIFICATION
Hier definieren Sie Template-ID und optionalen Zusatzhinweis. Der Typ dient als reine Buergerbenachrichtigung aus dem laufenden Workflow.

### 35.10.5 WAIT_STATUS_CHANGE
Dieser Schritt wartet zuerst eine Zeitspanne in Stunden/Minuten/Sekunden und kann danach Ticketfelder setzen. Fuer jedes Feld gibt es `Unveraendert lassen` oder `Fest setzen`.

Setzbar sind:
1. Status.
2. Prioritaet.
3. Assignee.
4. Kategorie.
5. Adresse.
6. PLZ.
7. Ort.
8. Breitengrad.
9. Laengengrad.
10. Beschreibung.

Damit koennen Sie Eskalations- oder Nachfasslogik ohne externes System bauen.

### 35.10.6 SPLIT
`SPLIT` erzeugt zwei parallele Pfade. Ohne manuelle Zieldefinition nimmt das System automatisch die beiden direkt folgenden Schritte. Fuer Pfad A und B koennen Sie Ziele gezielt in der Grafik waehlen oder wieder auf Automatik zuruecksetzen.

### 35.10.7 IF
`IF` arbeitet mit Logik `UND` oder `ODER` und einer Bedingungsliste. Pro Bedingung waehlen Sie:
1. Typ `Ticketfeld` oder `Geofence`.
2. Bei Ticketfeld: Feld, Operator und Wert.
3. Bei Geofence: `inside` oder `outside`, plus Kreis oder Polygon.

TRUE- und FALSE-Ziele koennen getrennt gesetzt werden. Ohne explizite Ziele entsteht ein Diagnosehinweis.

Fuer Geofence gibt es einen Karteneditor direkt im Schritt: Klick setzt beim Kreis den Mittelpunkt, beim Polygon fuegt jeder Klick einen neuen Punkt hinzu; Punkte koennen entfernt oder komplett geloescht werden.

### 35.10.8 JOIN
`JOIN` fuehrt parallele Pfade wieder zusammen. Sie setzen, wie viele eingehende Pfade erwartet werden (`requiredArrivals`). Erst wenn diese Anzahl erreicht ist, laeuft der Prozess weiter.

### 35.10.9 END
`END` beendet entweder nur den aktuellen Pfad (`branch`) oder den gesamten Workflow (`workflow`). Diese Entscheidung ist fachlich kritisch, weil `workflow` alle offenen Parallelpfade beendet.

### 35.10.10 CHANGE_WORKFLOW
Dieser Typ wechselt in eine andere Vorlage. Sie waehlen:
1. `KI-Auswahl` fuer dynamische Zielvorlage.
2. `Feste Workflow-Vorlage` fuer statischen Wechsel.

Bei fester Auswahl ist die Zielvorlage explizit aus der aktiven Vorlagenliste auszuwaehlen.

### 35.10.11 REST_API_CALL
Dieser Typ ist der technische Erweiterungspunkt fuer externe API-Logik. Sie setzen:
1. Optionale Basis-URL.
2. Script-Timeout.
3. HTTP-Timeout.
4. `Bei Fehler Workflow fortsetzen`.
5. JavaScript-Quelltext.

Der Editor zeigt zulaessige URL-Tokens und die im Script verfuegbaren Helper. Damit koennen externe Calls, Ticket-Patches und dynamische Pfadentscheidungen modelliert werden.

### 35.10.12 CUSTOM
`CUSTOM` ist ein Platzhaltertyp mit Notizfeld. Er ist fuer manuelle Strukturierung oder spaetere Ausbaustufen gedacht.

### 35.10.13 Step Runtime Overrides pro Schritt
Unter der typspezifischen Konfiguration kann ein optionaler Override-Block erscheinen. Damit ueberschreiben Sie die globalen Runtime-Werte nur fuer diesen einen Schritt.

Je nach Schritt-Typ sind verfuegbar:
1. `Timeout (Sek.)` als Schritt-Override.
2. `Retry max. Versuche`.
3. `Retry Backoff (Sek.)`.

Leere Werte oder `0` bedeuten: Es gilt wieder der globale Wert aus `Runtime & SLA` der Vorlage.

### 35.11 Direkte Next-Verweise je Schritt
Fuer fast alle Typen (ausser `SPLIT`, `IF`, `END`) gibt es den Block `Naechster Schritt (optional)`. Dort gilt:
1. `Automatisch` nutzt den naechsten Schritt in der Liste als Fallback.
2. Ein explizites Ziel schreibt eine feste Kante.
3. Ziel kann per Dropdown oder per Klick in der Grafik gesetzt werden.

Bei `EMAIL_CONFIRMATION` heisst dieser Block bewusst `Naechster Schritt bei Zustimmung`, damit Zustimmung und Ablehnung sauber getrennt bleiben.

### 35.12 Grafischer Workflow-Editor (DTPN) im Detail
Der rechte Bereich visualisiert den Ablauf als DTPN-Graph mit Startknoten, Prozessknoten, Verzweigungen und Endknoten. Oben sehen Sie Statistikwerte wie Knotenanzahl, Verbindungen, Auto/Manuell-Anteil, Split/Join/IF-Anzahl und Anzahl expliziter Teilworkflow-Enden.

Die wichtigsten Bedienablaeufe:
1. `Knoten hinzufuegen` fuegt den gewaehlten Typ ans Ende.
2. `Nach Auswahl einfuegen` fuegt hinter den fokussierten Knoten.
3. Ausgaenge (Ports) anklicken startet den Verbindungsmodus.
4. Eingangsport eines Zielknotens anklicken setzt die Verbindung.
5. Klick auf freie Flaeche im Verbindungsmodus oeffnet `Quick-Insert`: neuer Knoten wird direkt eingefuegt und sofort verbunden.

Explizite Kanten lassen sich ueber das `x` an der Kante entfernen. Automatische Fallback-Kanten sind gestrichelt dargestellt, explizite Kanten durchgezogen.

### 35.13 Graphnavigation und Layout
Der Graph bietet:
1. Zoom ueber Buttons.
2. Zoom ueber `Strg/Cmd + Mausrad`.
3. Manuelles Verschieben einzelner Knoten per Drag.
4. `Layout` zum Zuruecksetzen aller manuell verschobenen Positionen.
5. `PDF` zum Export der aktuellen Grafikansicht.

Wichtig fuer die Bedienung: Das Verschieben von Knoten aendert nur die Darstellung, nicht die fachliche Ablauflogik.

### 35.14 Eingebaute Validierung und Diagnose
Unter dem Graph erscheint eine Diagnosebox mit modellierungsnahen Warnungen. Typische Meldungen sind:
1. Split hat weniger als zwei gueltige Ziele.
2. IF hat keine expliziten TRUE/FALSE-Ziele.
3. Join erwartet mehr eingehende Pfade als aktuell verbunden.
4. Ein Nicht-Join-Knoten hat mehrere eingehende Kanten und fuehrt damit Pfade ohne Join zusammen.

Praxisregel: Speichern Sie nur, wenn diese Hinweise bewusst verstanden und fachlich begruendet sind.

### 35.15 Speichern, Editor-Import und Editor-Export
Beim Speichern prueft die UI mindestens Name und Schrittanzahl. Danach wird der Entwurf in das Backend geschrieben. Dabei werden lokale Editor-Referenzen in technische `task-<index>`-Verweise umgerechnet.

Zusatzlogik beim Speichern und Import:
1. Unbekannte oder ungueltige Schritt-Typen werden auf `CUSTOM` normalisiert.
2. `JOIN` wird immer als automatischer Schritt behandelt.
3. Referenzen werden auf vorhandene Schritte bereinigt.
4. Importierte IDs werden auf ein sicheres Format normalisiert.

`JSON Export` im Editor exportiert genau den aktuellen Entwurf. `JSON Import` im Editor ersetzt den laufenden Entwurf nach expliziter Bestaetigung. Das ist der sichere Weg, um externe Entwuerfe in Ruhe nachzuarbeiten, bevor sie als Vorlage gespeichert werden.

### 35.16 Empfohlener Bauablauf fuer neue Workflows
1. Zielprozess fachlich in Hauptpfade, Ausnahmepfade und Endkriterien zerlegen.
2. Neue Vorlage anlegen, Name/Beschreibung/Modus setzen.
3. Runtime & SLA konservativ setzen.
4. Schrittliste grob aufbauen, dann Reihenfolge per Drag-and-Drop finalisieren.
5. Pro Schritt typspezifische Config vollstaendig ausfuellen.
6. Next-Verweise und Split/IF-Pfade im Graph explizit pruefen.
7. Diagnosebox lesen und jede Warnung aktiv aufloesen.
8. PDF der DTPN-Grafik exportieren und intern fachlich gegenpruefen.
9. Vorlage speichern.
10. Mit echtem Testticket starten und Lauf in `Workflow-Instanzen` Schritt fuer Schritt verifizieren.

## 36. Typische End-to-End-Betriebsprozesse
### 36.1 Neue Meldung bis Abschluss
Oeffnen Sie das Ticket, validieren Sie Kategorie, Standort und Prioritaet, starten Sie den passenden Workflow, bearbeiten Sie manuelle Freigaben, setzen Sie finalen Status und dokumentieren Sie KI-Feedback nur dann, wenn die automatische Zuordnung fachlich korrigiert werden musste.

### 36.2 Workflow haengt im Pausen- oder Fehlerzustand
Gehen Sie in `Workflow-Instanzen`, filtern Sie auf betroffene Zustaende, oeffnen Sie Details und Historie, entscheiden Sie fachlich zwischen Freigabe, Ablehnung, Retry, Skip oder Fortsetzen, und pruefen Sie danach Ticketstatus plus Folgeaktionen in Queue und Journal.

### 36.3 Massenkorrektur im GIS
Setzen Sie fachliche Filter, markieren Sie geographisch die Zielmenge, kontrollieren Sie Auswahl in Tabelle und Karte, setzen Sie Bulk-Patch mit Pflichtbegruendung und kontrollieren Sie danach Stichproben im Ticketdetail.

### 36.4 Queue-Stoerung
Bei Mailproblemen starten Sie in Mail Queue mit `failed`, lesen Fehlertext, pruefen SMTP, korrigieren bei Bedarf Templates und entscheiden dann zwischen Retry und Neuversand. Bei KI-Problemen gehen Sie analog ueber KI Queue, Providerseite und Prompttest.

## 37. Fehlerbilder und konkrete Loesungswege
Wenn Menuepunkte fehlen, ist meist die Rolle falsch. Wenn Queue-Eintraege lange auf Verarbeitung stehen, pruefen Sie zuerst Dienstverfuegbarkeit und externe Abhaengigkeiten, dann Retry. Wenn Uebersetzungen trotz Sprache fehlen, aktivieren Sie den Planer, starten einen Lauf und bearbeiten fehlende Details manuell.

Wenn Workflows nicht starten, pruefen Sie zuerst Vorlagenverfuegbarkeit und Kategoriezuordnung. Wenn Redmine-Schritte nicht liefern, pruefen Sie Synchronisierung, Projekt-/Trackerfreigaben, Assignee-Menge und den Redmine-bezogenen KI-Output.

## 38. Sicherheits-, Compliance- und Qualitaetsregeln
Arbeiten Sie nach dem Prinzip minimaler Rechte, loeschen Sie Nachvollziehbarkeitsdaten nicht ohne Regelwerk und fuehren Sie riskante Wartungsaktionen nur mit Backup und Vier-Augen-Abstimmung aus. Prompt- und Templateaenderungen sollten niemals breit und gleichzeitig erfolgen, sondern inkrementell mit Testfaellen.

Sensible Daten gehoeren nicht in Freitextfelder, wenn der Prozess ohne diese Daten auskommt. Standort- und Bilddaten sollten fachlich notwendig und sachbezogen sein.

## 39. Glossar fuer den Betrieb
Ein Ticket ist die fachliche Bearbeitungseinheit einer Meldung. Ein Workflow ist die definierte Prozesslogik aus Schritten, Verzweigungen und Endzustaenden. Eine Queue ist eine asynchrone Warteschlange fuer technische Abarbeitung. Retry ist der erneute Versuch desselben Auftrags, Resend erzeugt einen neuen Mailauftrag. Geocoding bedeutet Adressinformationen in Koordinaten umzuwandeln. Ein Prompt ist die steuernde Systemanweisung fuer KI-Modelle.

## 40. Pflege dieses Handbuchs
Das Handbuch muss bei jeder funktionalen Aenderung synchron aktualisiert werden. Konkret bedeutet das: neue Menuepunkte aufnehmen, geaenderte Rollenrechte anpassen, neue Prozesspfade im Kapitel `Typische End-to-End-Betriebsprozesse` nachziehen und oben das Datum aktualisieren. Nur so bleibt die Dokumentation fuer Endanwender wirklich belastbar.
