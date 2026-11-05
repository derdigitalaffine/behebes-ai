#!/usr/bin/env node
/**
 * Deterministische, offline ausführbare Qualitätsprüfung der Roadmap.
 * Weder Netzwerkzugriff noch GitHub-Mutationen.
 */
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('planning/roadmap-issues.json', 'utf8'));
const errors = [];
const assert = (ok, message) => { if (!ok) errors.push(message); };
const epics = Array.isArray(data.epics) ? data.epics : [];
const tasks = Array.isArray(data.tasks) ? data.tasks : [];
const all = [...epics, ...tasks];
const idMap = new Map();
assert(data.schemaVersion === 1, 'schemaVersion muss 1 sein');
assert(data.repository === 'derdigitalaffine/behebes-ai', 'Nur der autorisierte Fork ist Ziel');
assert(epics.length >= 8 && tasks.length >= 40, 'Roadmap muss vollständige Epics und fachliche Slices enthalten');
assert(data.issueState === 'drafts-until-issues-enabled', 'Issue-Katalog verwechselt Entwürfe mit echten Tickets');
for (const item of all) {
  const id = String(item.id || '');
  assert(!idMap.has(id), 'Doppelte ID: ' + id);
  idMap.set(id, item);
  assert(typeof item.title === 'string' && item.title.length >= 12, id + ': Titel zu kurz');
  assert(typeof item.goal === 'string' && item.goal.length >= 35, id + ': Nutzerziel zu unklar');
  assert(['P0', 'P1', 'P2'].includes(item.priority), id + ': ungültige Priorität');
}
for (const epic of epics) {
  assert(epic.kind === 'epic', epic.id + ': kein Epic');
  assert(epic.id === 'E-' + epic.area, epic.id + ': Epic-ID/Area inkonsistent');
  assert(typeof epic.deliverables === 'string' && epic.deliverables.length > 70, epic.id + ': Deliverables fehlen');
  assert(tasks.some(t => t.epic === epic.area), epic.id + ': Epic ohne Tasks');
}
for (const task of tasks) {
  assert(task.kind === 'task', task.id + ': kein Task');
  assert(/^[A-Z][0-9]{2}$/.test(task.id), task.id + ': instabile Task-ID');
  assert(task.id[0] === task.epic, task.id + ': Task im falschen Epic');
  assert(idMap.has('E-' + task.epic), task.id + ': Epic fehlt');
  assert(Array.isArray(task.scope) && task.scope.length >= 3, task.id + ': Scope zu gering');
  assert(Array.isArray(task.acceptance) && task.acceptance.length >= 3, task.id + ': Akzeptanz unvollständig');
  assert(Array.isArray(task.failureCases) && task.failureCases.length >= 1, task.id + ': negativer Pfad fehlt');
  assert(typeof task.focus === 'string' && task.focus.length > 2, task.id + ': Owner fehlt');
  assert(Array.isArray(task.dependsOn), task.id + ': dependsOn kein Array');
  for (const dep of task.dependsOn || []) {
    assert(dep !== task.id, task.id + ': Selbstabhängigkeit');
    assert(idMap.has(dep) && dep[0] !== 'E', task.id + ': unbekannte Task-Abhängigkeit ' + dep);
  }
}
const state = new Map();
function walk(id, stack = []) {
  const stage = state.get(id) || 0;
  if (stage === 2) return;
  if (stage === 1) { errors.push('Zyklische Abhängigkeit: ' + [...stack, id].join(' -> ')); return; }
  state.set(id, 1);
  const node = idMap.get(id);
  for (const dep of node?.dependsOn || []) walk(dep, [...stack, id]);
  state.set(id, 2);
}
for (const task of tasks) walk(task.id);
if (errors.length) {
  console.error('Roadmap-Vertrag ungültig:\n' + errors.map(x => '- ' + x).join('\n'));
  process.exitCode = 1;
} else {
  const p = tasks.reduce((acc, t) => { acc[t.priority] = (acc[t.priority] || 0) + 1; return acc; }, {});
  console.log(`Roadmap-Prüfung erfolgreich: 1 Programm, ${epics.length} Epics, ${tasks.length} Tasks (P0=${p.P0 || 0}, P1=${p.P1 || 0}, P2=${p.P2 || 0}); eindeutige IDs, Abhängigkeiten zyklusfrei, Akzeptanz/Fehlerfälle vorhanden.`);
}
