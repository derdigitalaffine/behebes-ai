#!/usr/bin/env node
/** Validate milestone coverage and dependency ordering without network requests. */
import { readFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync('planning/roadmap-issues.json', 'utf8'));
const plan = JSON.parse(readFileSync('planning/milestones.json', 'utf8'));
const errors = [];
const check = (ok, message) => { if (!ok) errors.push(message); };
check(plan.schemaVersion === 1, 'milestone schemaVersion must be 1');
check(plan.repository === 'derdigitalaffine/behebes-ai', 'target is not the allowed fork');
check(plan.repository === catalog.repository, 'catalog/repo mismatch');
check(plan.sourceCatalog === 'planning/roadmap-issues.json', 'sourceCatalog mismatch');
check(plan.milestones.length === 8, 'Expected M0–M7 quality milestones');
const tasks = new Map(catalog.tasks.map(task => [task.id, task]));
const assignments = new Map();
const milestones = new Map();
for (const [index, item] of plan.milestones.entries()) {
  check(item.id === 'M' + index, 'Wrong milestone order: ' + item.id);
  check(!milestones.has(item.id), 'Duplicate milestone: ' + item.id);
  milestones.set(item.id, index);
  check(typeof item.title === 'string' && item.title.startsWith(item.id + ' · '), 'Invalid title ' + item.id);
  check(typeof item.description === 'string' && item.description.length >= 80, 'Missing outcome ' + item.id);
  check(Array.isArray(item.exitGates) && item.exitGates.length >= 3, 'Missing exit gates ' + item.id);
  check(Array.isArray(item.taskIds) && item.taskIds.length >= 1, 'Empty task list ' + item.id);
  for (const id of item.taskIds) {
    check(tasks.has(id), 'Unknown task ' + id + ' in ' + item.id);
    check(!assignments.has(id), 'Duplicate assignment ' + id);
    assignments.set(id, index);
  }
}
for (const task of catalog.tasks) {
  check(assignments.has(task.id), 'Task not assigned: ' + task.id);
  for (const dep of task.dependsOn) {
    check(assignments.has(dep), 'Dependency not assigned: ' + task.id + ' <- ' + dep);
    if (assignments.has(dep)) check(assignments.get(dep) <= assignments.get(task.id),
      'Backwards dependency ' + task.id + ' (' + plan.milestones[assignments.get(task.id)].id + ') <- ' +
      dep + ' (' + plan.milestones[assignments.get(dep)].id + ')');
  }
}
check(assignments.size === tasks.size, 'Not all tasks assigned exactly once');
if (errors.length) {
  console.error('Milestone-Plan ungültig:\n' + errors.map(item => '- ' + item).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Milestone-Gates geprüft: ' + plan.milestones.length + ' Milestones, ' + assignments.size +
    ' Task-Zuordnungen, keine rückwärts laufenden Abhängigkeiten.');
  for (const m of plan.milestones) console.log('  ' + m.id + ': ' + m.taskIds.length + ' Aufgaben');
}
