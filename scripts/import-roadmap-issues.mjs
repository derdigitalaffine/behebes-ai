#!/usr/bin/env node
/**
 * Idempotenter GitHub-Issue-Importer für behebes.AI.
 *
 * DEFAULT DRY RUN: KEINE Netzwerk- oder Schreiboperationen.
 * --apply setzt explizite Nutzerfreigabe, GH_TOKEN/GITHUB_TOKEN mit Issues write,
 * und in GitHub Settings → Features aktivierte Issues voraus.
 *
 * Scope ist ABSICHTLICH auf derdigitalaffine/behebes-ai begrenzt.
 */
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('planning/roadmap-issues.json', 'utf8'));
const DEST = 'derdigitalaffine/behebes-ai';
const API = `https://api.github.com/repos/${DEST}`;
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const update = argv.includes('--update');
const preview = argv.includes('--help');
const limitRaw = argv.find(x => x.startsWith('--limit='));
const limit = limitRaw ? Number(limitRaw.split('=')[1]) : Number.POSITIVE_INFINITY;
if (preview) {
  console.log('Usage: node scripts/import-roadmap-issues.mjs [--apply] [--update] [--limit=N]');
  console.log('Default = offline dry-run; --apply creates missing issues only; --update replaces generated bodies on existing issues.');
  process.exit(0);
}
if (data.repository !== DEST || data.schemaVersion !== 1) throw new Error('Roadmap nicht für autorisierten Fork');
if (update && !apply) throw new Error('--update nur mit --apply');
if (!(limit > 0 && (Number.isInteger(limit) || limit === Infinity))) throw new Error('--limit muss positive Ganzzahl sein');
const tasks = data.tasks;
const issueItems = [
  { id: data.roadmapId || 'ROADMAP', kind: 'program', title: 'behebes.AI Next – nutzerzentrierte Plattform-Roadmap', priority: 'P0–P2' },
  ...data.epics,
  ...tasks,
];
const byId = new Map(issueItems.map(item => [item.id, item]));
if (byId.size !== issueItems.length) throw new Error('Roadmap-IDs nicht eindeutig – zuerst check-roadmap ausführen');
for (const task of tasks) {
  if (!byId.has('E-' + task.epic) || (task.dependsOn || []).some(id => !byId.has(id))) {
    throw new Error('Fehlerhafte Abhängigkeit bei ' + task.id);
  }
}
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const origin = 'https://github.com/' + DEST;
const stableLink = (id, idToNumber) => idToNumber.has(id)
  ? `[#${idToNumber.get(id)}](${origin}/issues/${idToNumber.get(id)}) (${id})`
  : '`' + id + '`';
const lines = arr => (arr || []).map(s => '- ' + s).join('\n') || '- Nicht zutreffend – im PR begründen.';
const checks = arr => (arr || []).map(s => '- [ ] ' + s).join('\n');
const marker = id => `<!-- behebes-roadmap-id:${id} -->`;
const titleOf = item => item.kind === 'program' ? '[ROADMAP][P0–P2] ' + item.title
  : item.kind === 'epic' ? `[EPIC][${item.priority}][${item.id}] ${item.title}`
    : `[${item.priority}][${item.id}] ${item.title}`;
function render(item, idToNumber) {
  const head = marker(item.id) + '\n';
  if (item.kind === 'program') {
    return head + `# Master-Roadmap: Bürgeranliegen bis nachvollziehbare Erledigung

**Produktphilosophie:** Bürger melden einfach und datensparsam; die Verwaltung findet verlässlich die Zuständigkeit; Workflows koordinieren Arbeit; OPS erledigt Aufgaben mobil/offline; Bürger sehen einen verständlichen Status und einen nachvollziehbaren Abschluss. KI ist Assistenz, nicht unkontrollierte Entscheidungsinstanz.

**Aktueller Stand:** Repository und Dokumentationsroadmap, nicht produktiv validiert. Keine vorgetäuschten KPIs/„fertig“-Aussagen.

## Epics nach Nutzwert und Risiko

${data.epics.map(e => '- ' + stableLink(e.id, idToNumber) + ' – **' + e.title + '** (' + e.priority + ')').join('\n')}

## Wellen mit Abnahmestopps

1. **W0 Bestand/Qualität:** F01–F06, S01–S03, P01/P02: CI, Rollen-/Tenant-/Security-Baseline, Backup/Restore, Benutzerjobs und Messprofil.
2. **W1 Module:** M01–M04: Fachgrenzen, sichere serverseitige Featurepolicies, Abhängigkeiten, Tenant-On/Off inklusive Job-/API-Gates.
3. **W2 Mantine:** D01–D05: React-/Mantine-ADR, Design Tokens, AppShell, Table, Forms; ein Referenzslice statt Komplettrewrites.
4. **W3 Golden Path:** B01, A01–A02, O01–O02 und P06 integrieren Bürger → Admin → OPS → Abschluss unter Offline-/Fehler-/Tenant-Bedingungen.
5. **W4 Breite:** Restliche fachliche UX-Slices, Settings, Workflows, i18n, Suche, Analytics und kontextbezogene Mobile-Experience.
6. **W5 Belastbar:** R01–R08, S04–S06, P03–P05 kontinuierlich anhand gemessener Engpässe und SLOs.

## Mess- und Freigabekriterien

- Nutzerjob pro Persona: Zeit bis erster Erfolg, unnötige Klicks, Abbrüche, Wiederaufnahme, verständlicher Zustand.
- Mobile Web Vitals als **Zielvorschlag** p75 LCP ≤ 2,5s, INP ≤ 200ms, CLS ≤ 0,1; erst Ausgangswerte erheben.
- API p50/p95/p99, Queue Lag, SSE-Reconnect, DB/Index, fehlgeschlagene Jobs, Restore-Zeit und Rollbackprobe.
- Autorisierung serverseitig, negative Cross-Tenant-/Org-/Module-off-Tests, Datenschutz und unabhängiges Security-Review.
- 320/360px, Tastatur/Fokus/Screenreader, Error/Loading/Offline/409/Forbidden, kein Datenverlust, menschliche Deploy-Freigabe.

**Referenzen:** [Roadmap](${origin}/blob/docs/agenten-orchestrierung-und-projektleitfaden/docs/ROADMAP.md) · [Vision](${origin}/blob/docs/agenten-orchestrierung-und-projektleitfaden/docs/PRODUCT_VISION.md) · [maschinenlesbarer Backlog](${origin}/blob/docs/agenten-orchestrierung-und-projektleitfaden/planning/roadmap-issues.json).

**Statusregel:** Erstellen eines Issues oder Dokumentieren einer Funktion bedeutet nicht „implementiert“. Umsetzung erst nach PR, Testnachweis und Review als done markieren.
`;
  }
  if (item.kind === 'epic') {
    const children = tasks.filter(t => t.epic === item.area);
    return head + `# Epic ${item.id}: ${item.title}

**Priorität:** ${item.priority} · **Typ:** Epic · **Status:** geplant, nicht implementiert · **Programm:** ${stableLink('ROADMAP', idToNumber)}

## Nutzer-/Produktnutzen

${item.goal}

## Geplanter Lieferumfang

${item.deliverables}

## Sicherheit und Architekturgrenzen

${item.risk}

## Umsetzungs-Issues

${children.map(t => '- ' + stableLink(t.id, idToNumber) + ' – ' + t.title + ' (' + t.priority + ')').join('\n')}

## Exit-Gates

- [ ] Einzelne Slices haben eigenes Scope, unabhängige Reviews, Testevidenz und kompatible Rollout-/Rollbackpfade.
- [ ] Kein offener kritischer Tenant-/RBAC-/Datenintegritätsblocker wird durch „Epic done“ kaschiert.
- [ ] Nutzerjourney, UX (320/360px, Keyboard), API-/Offline-/Modul-Off-Verhalten und Observability sind soweit relevant nachgewiesen.
- [ ] Roadmap und technische Dokumentation spiegeln tatsächlich verifizierte PRs wider.

**Details:** [Programmplan](${origin}/blob/docs/agenten-orchestrierung-und-projektleitfaden/docs/ROADMAP.md). Nicht alle Slices müssen zeitlich nacheinander erfolgen; Dependencies sind verbindliche technische Gates.
`;
  }
  return head + `# ${item.title}

| Merkmal | Wert |
| --- | --- |
| Priorität | **${item.priority}** |
| Typ | Vertikales, fachlich abnehmbares Arbeitspaket |
| Epic | ${stableLink('E-' + item.epic, idToNumber)} |
| Fach-/Technik-Lead | ${item.focus} (konkret zuzuweisen) |
| Status | Geplant, noch kein Implementierungsnachweis |

## Nutzerproblem und gewünschte Wirkung

${item.goal}

## Umsetzungsscope

${lines(item.scope)}

## Konkrete Akzeptanzkriterien (Definition of Done)

${checks(item.acceptance)}

## Negative/Fehler-/Sicherheitsfälle

${checks(item.failureCases)}

## Abhängigkeiten / Reihenfolge

${(item.dependsOn || []).length ? item.dependsOn.map(k => '- ' + stableLink(k, idToNumber)).join('\n') : '- Keine zwingende fachliche Vorbedingung; bei P0 Baseline und Security-Review trotzdem beachten.'}

## Obligatorischer PR-Nachweis

- [ ] **Ready:** Persona, Ausgangsverhalten, Tenant-/Org-/Capability-Grenzen, Modul-On/Off-Wirkung, API-/DB-/Job-/Offline-Kontrakt, Migration und Rollback geklärt oder mit Begründung als N/A.
- [ ] **Tests:** je Risiko Unit, API/Integration, Browser/E2E, 320/360px, Tastatur/Fokus, Loading/Empty/Error/Offline/409/403, Duplicate/Retry. Kommandos und tatsächliche CI-Links nennen, fehlende Tests nicht als bestanden ausgeben.
- [ ] **Privacy/Security:** synthetische Testdaten, keine PII/Secrets/Provider-Prompts in Logs, direkter API-Negativtest (fremder Tenant/Org/fehlende Capability); unabhängiges Security-Review bei kritischen Pfaden.
- [ ] **Performance:** Baseline und Vorher/Nachher-Messung oder fachlich begründetes „nicht messrelevant“; keine ungestützte Speed-Aussage.
- [ ] **Betrieb:** Änderung dokumentiert, Version/Dependency/Migration, Deploy-/Featureflag-/Backout-/Restoreplan und ggf. Health-/Alert-Anpassung.
- [ ] **Human Gate:** PR-Approval und Release/Deployment durch berechtigte Menschen; keine autonomen außenwirksamen KI-Aktionen.

**Bezug:** [Produktvision](${origin}/blob/docs/agenten-orchestrierung-und-projektleitfaden/docs/PRODUCT_VISION.md) · [Engineering-Gates](${origin}/blob/docs/agenten-orchestrierung-und-projektleitfaden/docs/DEVELOPMENT.md).
`;
}
const inspect = () => {
  console.log(`ROADMAP DRY RUN: ${issueItems.length} geplante Issues für ${DEST} (1 Programm, ${data.epics.length} Epics, ${tasks.length} Tasks).`);
  for (const [i, item] of issueItems.entries()) console.log(String(i + 1).padStart(2, '0') + ' ' + titleOf(item));
};
async function api(path, options = {}) {
  const res = await fetch('https://api.github.com' + path, {
    method: options.method || 'GET',
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Authorization': 'Bearer ' + token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const raw = await res.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`GitHub ${res.status}: nicht-JSON-Antwort`); }
  if (!res.ok) {
    const msg = String(payload.message || raw.slice(0, 150));
    const hint = res.status === 410 ? ' – Issues im Fork unter Settings → General → Features aktivieren.'
      : res.status === 403 ? ' – GitHub Issues: write für den Fork erforderlich; ggf. Secondary Rate Limit.'
        : '';
    throw new Error(`GitHub HTTP ${res.status} (${path}): ${msg}${hint}`);
  }
  return payload;
}
async function existing() {
  const all = [];
  for (let page = 1; page <= 30; page++) {
    const rows = await api(`/repos/${DEST}/issues?state=all&per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new Error('Issue-Liste nicht vorhanden');
    all.push(...rows.filter(x => !x.pull_request));
    if (rows.length < 100) break;
  }
  return all;
}
async function main() {
  if (!apply) { inspect(); console.log('Keine GitHub-Schreiboperation. --apply nach Aktivierung der Issues verwenden.'); return; }
  if (!token) throw new Error('--apply braucht GH_TOKEN oder GITHUB_TOKEN mit Issues write. Token niemals in Git speichern.');
  const meta = await api('/repos/' + DEST);
  if (meta.full_name !== DEST || !meta.fork) throw new Error('Sicherheitsabbruch: Ziel ist nicht erwarteter Fork');
  if (!meta.has_issues) throw new Error('Issues im Fork sind deaktiviert. Öffne GitHub Settings → General → Features → Issues.');
  const already = await existing();
  const refs = new Map();
  for (const x of already) {
    const m = String(x.body || '').match(/<!-- behebes-roadmap-id:([^ >]+) -->/);
    if (m) {
      if (refs.has(m[1])) throw new Error('Doppelte Roadmap-ID in GitHub: ' + m[1]);
      refs.set(m[1], x.number);
    }
  }
  console.log(`Gefunden: ${refs.size} roadmap-gebundene Issues; ${already.length} existierende Issues gesamt.`);
  let created = 0, skipped = 0, refreshed = 0, examined = 0;
  for (const item of issueItems) {
    if (examined++ >= limit) break;
    const existingId = refs.get(item.id);
    const newBody = render(item, refs);
    if (existingId) {
      if (update) {
        await api(`/repos/${DEST}/issues/${existingId}`, { method: 'PATCH', body: { title: titleOf(item), body: newBody } });
        refreshed++;
        console.log('Aktualisiert: #' + existingId + ' ' + item.id);
      } else { skipped++; console.log('Übersprungen (bereits vorhanden): #' + existingId + ' ' + item.id); }
      continue;
    }
    const x = await api(`/repos/${DEST}/issues`, { method: 'POST', body: { title: titleOf(item), body: newBody } });
    refs.set(item.id, x.number);
    created++;
    console.log('Angelegt: #' + x.number + ' ' + item.id);
    // Sekundärlimit vermeiden. Bei Fehler abbrechen; ein späterer Lauf dedupliziert.
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  console.log(`Fertig: neu=${created}, übersprungen=${skipped}, aktualisiert=${refreshed}. Echte Links ggf. per --apply --update ergänzen (überschreibt Bodies!).`);
}
main().catch(error => { console.error(String(error?.message || error)); process.exitCode = 1; });
