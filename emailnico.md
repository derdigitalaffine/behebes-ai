Betreff: Rückmeldung zu Ihrem Testlauf und den gemeldeten Punkten

Hallo Herr Heinz,

vielen Dank für Ihren ausführlichen Test und die sehr konkreten Hinweise.
Ich habe Ihre Punkte systematisch übernommen und die Anwendung entsprechend angepasst.

Folgende Änderungen wurden umgesetzt:

1. Impressum / Datenschutz
- Die Links wurden auf die korrekten Pfade mit `/service/` umgestellt:
  - https://www.otterbach-otterberg.de/service/impressum
  - https://www.otterbach-otterberg.de/service/datenschutz

2. Kartenstart bei deaktiviertem GPS
- Der Karten-Startpunkt wurde auf Otterberg als Standard-Zentrum umgestellt.

3. Meldung „liegt nicht im Zuständigkeitsbereich“ trotz Otterberg-Adresse
- Der Ortsfilter wurde überarbeitet:
  - Geofence + Ortslisten-Match werden robuster kombiniert.
  - Bei abgelehnter Position wird die Adresse im Formular sauber zurückgesetzt, damit keine widersprüchliche Anzeige bleibt.

4. Text und Darstellung „Fast geschafft“
- Der Text wurde gekürzt und klarer formuliert.
- Die Ticket-ID wird nun in konsistenter Schrift wie der restliche Text dargestellt (keine abweichende Monospace-Darstellung mehr).

5. Bestätigungsmail (Lesbarkeit, Wording, Linkabstände)
- Das Wording wurde auf positive, bürgernahe Formulierungen angepasst.
- Die Lesbarkeit wurde verbessert (keine problematische weiß-auf-hellblau-Konstellation im relevanten Inhalt).
- Bestätigungs- und Statuslink sind klar getrennt dargestellt.
- Ihre Textvorschläge wurden als Grundlage übernommen.

6. Text nach Klick auf Bestätigungslink („bereits bestätigt“)
- Die Formulierung wurde angepasst: „bereits“ wird nicht mehr als Standardtext ausgegeben.
- Die Bestätigungsseite zeigt jetzt eine klare, einfache Erfolgsmeldung.

7. Bürgerverständliche Formulierungen statt interner Prozesssprache
- Aussagen wie „im Hintergrund automatisiert klassifiziert“ wurden aus der Bürgerkommunikation vereinfacht.
- Fokus liegt jetzt auf: „Bestätigt“, „eingegangen“, „in Bearbeitung“, „Statuslink nutzen“.

8. Konsistenz Mail/Web bei Kategorisierung
- Um Widersprüche in der Frühphase zu vermeiden, wird in der Eingangs-/Bestätigungskommunikation keine vorauseilende Kategorieaussage mehr erzwungen.
- Dadurch sind Mail und Web für Bürger konsistenter.

9. Opt-out für Statusänderungs-Mails
- Ein Abmeldelink für automatische Statusbenachrichtigungen wurde ergänzt.
- Nach Abmeldung werden weitere Status-E-Mails für das Ticket unterdrückt.
- Zusätzlich wurde eine eigene Bürger-Rückmeldeseite für die Abmeldung umgesetzt.

10. Stabilität Backend bei Prozessen mit E-Mail-Freigabe
- Der kritische Lastpfad wurde entschärft:
  - Große Bilder werden in Freigabe-/Statusantworten nicht mehr als Base64 im JSON mitgeliefert.
  - Bilder werden stattdessen über separate Bild-Endpunkte ausgeliefert.
  - Der Entscheidungs-Endpunkt der E-Mail-Freigabe lädt keine schweren Bilddaten mehr.
- Ziel: Event-Loop-Blockaden und „Backend antwortet nicht mehr“-Verhalten unter Last vermeiden.

Einschätzung zum aktuellen Stand
- Der technisch wahrscheinlichste Hänger-Ursachepfad ist damit behoben.
- Eine finale Bestätigung erfolgt nach erneutem End-to-End-Test in Ihrer Laufumgebung (inkl. größerer Bildmengen und aktivem E-Mail-Freigabeschritt).

Wenn Sie möchten, bereite ich Ihnen im nächsten Schritt einen kurzen, strukturierten Abnahmetest (5–8 Klickpfade) vor, damit wir die Punkte gemeinsam sauber abhaken können.

Mit freundlichen Grüßen

behebes.AI
(im Auftrag der Verbandsgemeindeverwaltung Otterbach-Otterberg)
