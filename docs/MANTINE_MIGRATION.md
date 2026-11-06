# Mantine-Migration und UI-Polish · Entscheidungsrahmen

**Status:** Geplanter Umbau. Kein ungeprüfter Major-Upgrade. **Ist:** React 18.3.1 in Frontend/Admin/OPS; MUI 7 und MUI X Data Grid in Admin/OPS, eigene SmartTable und umfangreiche Legacy-CSS; Bürgerfrontend React/Vite/Tailwind/Custom CSS.

## Versionentscheidung zuerst

Die React-/Mantine-Versionen hängen zusammen:
- Mantine 9 verlangt laut offizieller Migrationsanleitung React **19.2+** (https://mantine.dev/guides/8x-to-9x/).
- Mantine 8 ist als technische Brücke zu evaluieren; Unterstützung und Komponentenverhalten sind im konkret gewählten Patchstand und in CI zu prüfen (https://v8.mantine.dev/).
- `@mantine/core` und weitere `@mantine/*`-Pakete müssen eine konsistente Major-/Patchversion erhalten; Versionen pinnen und Lockfile reproduzieren. Kein bloßer Textwechsel von `@mui/*`-Imports.

D01 liefert ein **Architecture Decision Record** mit Spike unter Node 22+, Vite, iOS/PWA und drei Workspaces. React-19-Migration erfolgt **kontrolliert** mit Tests für Third-Party-Peers, Provider, Portals, Form State, Icons, Charts, Datepicker, komplexe Grid-Features und Map/QR.

## Zielprinzipien

- **Kommunal-professionell:** ruhige Oberflächen, klare Typografie, sparsame Akzentfarbe, hohe Lesbarkeit; keine verspielten Gradients oder dekorative Glas-/Schattenflut.
- **Task-first:** Status, Priorität, Zuständigkeit und eine dominante Hauptaktion. Admin-Details progressiv.
- **Ein konsistentes Designsystem:** Spacing-/Farbtokens, Form/Input-, Button-, Table-, Modal-/Drawer-, Notification-, Overlay-, Badge-, Skeleton-/Empty/Error-Komponenten.
- **Semantik vor Farbe:** Warnung, Information, Blockade und Erfolg mit Text/Icons/Screenreader-Ansage, nicht nur Rot/Grün.
- **Mobile als bewusster Flow:** Bürger/OPS 320–360px, Admin bei 360px Kernaktion, Table/Card-Alternativen, keine obligatorische Hover-Interaktion.
- **Markenfähig:** tenantbezogenes Branding als validierte Theme-Werte, nicht CSS Injection; Kontraste prüfen.
- **Fehler als Produktmoment:** Eingaben/Kontext retten, fachlichen Konflikt erklären, Wiederaufnahme anbieten, Timeout nicht als Erfolg zeigen.

## Reihenfolge statt Rewrite

| Schritt | Scope | Proof |
| --- | --- | --- |
| D01 | React-/Mantine-Spike, Kosten-/Risiko-ADR | kompatibler isolierter Build/Browser-Test |
| D02 | gemeinsame Tokens, MantineProvider, Primitive | Theme-/Focus-/A11y-Tests und Showroom |
| D03 | Admin-AppShell als erstes UI-Pilotstück | Rechte/Tenant/Navigation/360px |
| D04 | SmartTable-Funktionsinventar und Adapter | Feature-Parität bei Bulk, Print, Saved Views, SSE |
| D05 | Form-/Dialog-/Error-Primitives | Validierung, 409, Fokus, Cancel, Accessibility |
| D06 | Admin-Migration in fachlichen Slices | Dashboard → Tickets → Workflows → Settings |
| D07 | OPS-UI plus Offline-/Media-Sicherung | Touch, Scanner, PWA, Calls, Sync |
| D08 | Bürger-UI inkl. i18n und Barrierefreiheit | Meldung/Status/Verifikation auf 320–360px |
| D09 | visuelle Regression + Accessibility | manuell und automatisch, echte Geräte |

Eine gemischte Mantine/MUI-Phase ist **nur temporär und bewusst** zulässig. CSS-Reihenfolge, Reset-Styles, Fonts, Portal-Root, Dialogz-Index und Focus Traps werden je Pilot geprüft. Alte Abhängigkeiten werden **erst nach belegter Nichtverwendung** entfernt.

## UI-Polish-Qualitätsbar

1. Informationshierarchie/Handlungsbedarfe sind in 5 Sekunden erfassbar; genaue Zielwerte müssen Nutzerstudien bestätigen.
2. Keine Layoutsprünge, überlaufenden Dialoge, abgeschnittenen Labels oder rein horizontal scrollbaren Pflichtlisten bei 320/360px.
3. Jede kritische Aktion mit Loading, Success, Error, Conflict, Unauthorized, Offline und Wiederaufnahme.
4. Fokus bleibt sichtbar, accessible name/description vorhanden, kritische Controls per Tastatur bedienbar.
5. Route-Wechsel erhält Filter und berechtigte Auswahl; Modul-off ist ausdrücklich behandelt.
6. Performance wird vor/nach dem Slice gemessen. Ein schöneres, aber deutlich langsameres Frontend ist kein Abschluss.
7. Screenshots ohne sensible Echtdaten, UX-Review und Tests im PR; nicht nur Storybook-Demo ohne Integration.
8. Jede Route hat fachlichen Owner und bekannte Regressionstests.

## Nichtziele

Kein 1:1-Pixel-Kopieren von MUI; keine Einführung eines zweiten dauerhaften Designsystems; keine willkürliche Neuordnung fachlicher Rechte; keine vollständige Workflow-Neuimplementierung nur wegen UI-Wechsel.

[Produktvision](PRODUCT_VISION.md) · [Mantine-Arbeitspakete D01–D09](../planning/roadmap-issues.json) · [UX-Prinzipien](UX_PRINCIPLES.md)
