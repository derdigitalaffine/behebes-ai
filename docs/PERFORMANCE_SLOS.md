# Performance-, Stabilitäts- und SLO-Programm

**Status:** Mess- und Abnahmeplan. **Kein** Performanceziel ist hier als bereits erreicht angegeben. Der konkrete Betrieb wurde nicht gemessen.

## Warum zuerst instrumentieren?

behebes.AI verarbeitet personenbezogene Vorgänge, wartende Workflows, KI-/E-Mail-Queues und mobiles Arbeiten. Langsame Rückmeldung erzeugt Doppelaktionen und Unsicherheit; unsichtbare Fehler gefährden Bearbeitungsqualität. Schnelligkeit bedeutet **Zeit bis zur verlässlichen nächsten Handlung**, nicht nur kürzere Ladezeit.

## Messfelder

| Ebene | Metriken | Qualitative Prüfung |
| --- | --- | --- |
| Bürger/OPS/Admin | p75 LCP, INP, CLS, Route-Wechsel, Bundle, Rendering-Hitches | Aufgabe erledigbar bei 360px/Slow-4G |
| API | p50/p95/p99 nach Route und zulässigem Tenant-/Org-Segment, 4xx/5xx, Timeout | korrekter Fehlervertrag und kein PII-Leak |
| Datenbank | Query-Count, EXPLAIN/Slow Queries, Indizes, Pool/Locks, Migration Dauer | keine N+1-/globalen Counts/Umgebungsdrift |
| Worker/AI/Mail | Queue-Lag, Retry, Dead-Letter, Timeout, Side-Effect-Duplikate | kein doppelter Versand, sicherer manueller Fallback |
| Realtime | SSE-Verbindungsrate, Reconnects, Eventverlust, Snapshot-Recovery | Client ist nach Netzausfall korrekt |
| Betrieb | Uptime, Restore-Dauer, Release-Regression, Incident MTTR | realistischer Backup-/Rollback-Drill |

## Vorläufige Zielkorridore (per ADR/SLO zu bestätigen)

- Core Web Vitals nach offiziellen Good-Kriterien: **p75 LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1**, nach Gerät und Netzwerk segmentiert; zunächst mit Synthetik-/Labordaten, echte Feldtelemetrie nur datenschutzkonform.
- API-/DB-/Queue-Latenzen: **erst reale Baseline und Lastprofil bestimmen**, dann Service-Level-Objectives pro kritischer Route und Tenant-Größenklasse vereinbaren; keine unbegründete „jede API <100ms“-Behauptung.
- Releases: Korrekte Kernflows mit realitätsnaher Testdatenbasis; neue Version bringt messbar nicht mehr kritische Fehler, Datensperren oder verlorene Jobs als die genehmigte Baseline.
- Auffälligkeiten und Abweichungen haben benannte Verantwortliche, Störungshandbuch und Datenaufbewahrungsstrategie.

## Performancebudget-Workflow je Issue

```text
Hypothese → reproduzierbares Szenario und Baseline (Hardware/Commit/Datenmenge)
→ Eingriff in eine klar benannte Schicht → Vorher/Nachher auf identischem Profil
→ Regression/PII/Auth/Offline-Checks → Release-/Rollback-Evidenz
```

„Optimiert“ ist nur nach Messung zulässig. Median alleine reicht nicht; lange Tail-Latenz, Fehler und Teilabbrüche beachten. Bei Provider-/Netzausfall darf der Client nicht unbegrenzt laden und muss die Wiederaufnahme erklären.

## Architekturmaßnahmen in Reihenfolge

1. **R01:** Tenant-gefilterte SQL-Indizes, Pagination, Query-Pläne, Lock-Profil; DB-Migrationen vorwärtskompatibel.
2. **R02:** API-p95/99, Rate-/Timeout-/Cancellation- und Backpressure-Modelle.
3. **R03:** Lazy Routes und Modulcode, Bundle-/Renderprofil, Query Cache mit Scope.
4. **R04:** Lease/Idempotency/Retry/Dead Letter und Side-Effect-Sicherheit.
5. **R05:** SSE-Snapshot-Recovery, Auth-/Tenantwechsel, Reconnect-Limits.
6. **R06:** Last-/Soak-/Chaos-Tests nur auf Testsystemen.
7. **R07:** sichere Metriken/Traces/Alerts ohne Rohprompts oder Bürgerpayloads.
8. **R08:** verständliche Recovery-UX über Bürger, Admin und OPS.

## Betrieb und Datenschutz

Keine Replay-/Analytics-Daten aus echten Bürgerformularen ohne konkrete Rechtsgrundlage. Tenant-Kennzahlen werden aggregiert oder sicher eingeschränkt, Correlation-IDs enthalten keine E-Mail/Adresse, Queries/Headers mit Token werden redigiert. Die SLO-Zustimmung liegt bei technischen und fachlichen Betriebsverantwortlichen.

[Produktvision](PRODUCT_VISION.md) · [Roadmap](ROADMAP.md) · [Issue-Katalog](../planning/roadmap-issues.json)
