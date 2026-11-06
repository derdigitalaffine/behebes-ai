#!/usr/bin/env node
/**
 * Sync the versioned milestone roadmap into native GitHub milestones (fork only).
 * Default: offline dry-run. --apply requires GH_TOKEN/GITHUB_TOKEN with issues:write.
 * Neither closes issues nor edits milestone due dates or task bodies.
 */
import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync('planning/roadmap-issues.json', 'utf8'));
const plan = JSON.parse(readFileSync('planning/milestones.json', 'utf8'));
const TARGET = 'derdigitalaffine/behebes-ai';
const PREFIX = '/repos/' + TARGET;
const apply = process.argv.includes('--apply');
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const msMarker = id => '<!-- behebes-roadmap-milestone:' + id + ' -->';
const issueMarkerPattern = /<!-- behebes-roadmap-id:([A-Z0-9-]+) -->/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (plan.repository !== TARGET || catalog.repository !== TARGET) throw Error('Unexpected target repository');
if (plan.milestones.length !== 8 || catalog.tasks.length < 80) throw Error('Incomplete milestone roadmap');
if (!apply) {
  console.log('DRY RUN: ' + plan.milestones.length + ' native milestones and ' +
    catalog.tasks.length + ' task assignments in ' + TARGET + '. No network or writes.');
  for (const m of plan.milestones) console.log(m.id + ': ' + m.taskIds.length + ' tasks · ' + m.title);
  process.exit(0);
}
if (!token) throw Error('Missing GH_TOKEN/GITHUB_TOKEN with Issues write permission');
if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== TARGET)
  throw Error('Write operation blocked outside expected GitHub repository');
if (process.env.GITHUB_REF && ![
    'refs/heads/docs/agenten-orchestrierung-und-projektleitfaden',
    'refs/heads/main',
  ].includes(process.env.GITHUB_REF)) throw Error('Unexpected workflow ref for write operation');

async function api(path, method = 'GET', body) {
  for (let retry = 0; retry < 4; retry++) {
    const res = await fetch('https://api.github.com' + path, {
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Authorization': 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const content = await res.text();
    let data;
    try { data = content ? JSON.parse(content) : {}; } catch { data = { message: content.slice(0, 180) }; }
    if (res.ok) return data;
    const detail = String(data.message || '').slice(0, 240);
    const throttled = res.status === 429 || (res.status === 403 &&
      (/secondary rate limit|abuse detection/i.test(detail) || res.headers.get('x-ratelimit-remaining') === '0'));
    if (throttled && retry < 3) {
      const pause = Math.max(Number(res.headers.get('retry-after') || 0) * 1000, 2500 * (retry + 1));
      console.warn('Rate limited, retry in ' + pause + 'ms');
      await sleep(pause);
      continue;
    }
    throw Error('GitHub HTTP ' + res.status + ' ' + method + ' ' + path + ': ' + detail);
  }
}
async function getAll(path) {
  const all = [];
  for (let page = 1; page <= 30; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const rows = await api(path + sep + 'per_page=100&page=' + page);
    if (!Array.isArray(rows)) throw Error('Expected array for ' + path);
    all.push(...rows);
    if (rows.length < 100) return all;
  }
  throw Error('GitHub pagination exceeded safety limit for ' + path);
}
const repo = await api(PREFIX);
if (repo.full_name !== TARGET || repo.fork !== true || repo.has_issues !== true)
  throw Error('Not the expected enabled fork; stop without mutations');
const existingMs = await getAll(PREFIX + '/milestones?state=all');
const msById = new Map();
for (const x of existingMs) {
  const found = String(x.description || '').match(/<!-- behebes-roadmap-milestone:(M[0-7]) -->/);
  if (found) {
    if (msById.has(found[1])) throw Error('Duplicate milestone ID ' + found[1]);
    msById.set(found[1], x);
  }
}
const planned = new Set(plan.milestones.map(m => m.id));
for (const [id] of msById) if (!planned.has(id)) throw Error('Unexpected managed milestone ' + id);
const byId = new Map();
for (const issue of (await getAll(PREFIX + '/issues?state=all')).filter(x => !x.pull_request)) {
  const found = String(issue.body || '').match(issueMarkerPattern);
  if (!found) continue;
  if (byId.has(found[1])) throw Error('Duplicate issue key ' + found[1]);
  byId.set(found[1], issue);
}
for (const t of catalog.tasks) if (!byId.has(t.id)) throw Error('Task ' + t.id + ' not imported as GitHub issue');
for (const m of plan.milestones) if (m.taskIds.some(id => !byId.has(id))) throw Error('Missing milestone task ' + m.id);
console.log('Validated ' + byId.size + ' tracked issues; no duplicate markers.');

for (const m of plan.milestones) {
  const previous = msById.get(m.id);
  const description = m.description + '\n\nAbnahme-/Exit-Gates:\n' +
    m.exitGates.map(gate => '- ' + gate).join('\n') +
    '\n\nOwner-Bereiche: ' + m.owners +
    '\n\nZeitplanung: keine willkürlichen Fälligkeiten; fachlicher Review vor Release.\n' + msMarker(m.id);
  const collision = existingMs.find(x => x.title === m.title && !String(x.description || '').includes(msMarker(m.id)));
  if (collision && !previous) throw Error('Existing milestone title collision; manual review: ' + m.title);
  if (!previous) {
    const created = await api(PREFIX + '/milestones', 'POST', {
      title: m.title, description, state: 'open',
    });
    if (!Number.isInteger(created.number)) throw Error('Milestone not created: ' + m.id);
    msById.set(m.id, created);
    console.log('Created milestone #' + created.number + ' ' + m.id);
    await sleep(900);
  } else {
    // Preserve any manually managed dates/state; correct title/description only if still our managed milestone.
    if (previous.title !== m.title || previous.description !== description) {
      const changed = await api(PREFIX + '/milestones/' + previous.number, 'PATCH', {
        title: m.title, description,
      });
      msById.set(m.id, changed);
      console.log('Updated milestone #' + previous.number + ' ' + m.id);
      await sleep(900);
    } else console.log('Unchanged milestone #' + previous.number + ' ' + m.id);
  }
}
let assigned = 0, skipped = 0;
const ownedNumbers = new Set([...msById.values()].map(x => x.number));
for (const milestone of plan.milestones) {
  const number = msById.get(milestone.id).number;
  for (const taskId of milestone.taskIds) {
    const issue = byId.get(taskId);
    if (issue.milestone?.number === number) { skipped++; continue; }
    if (issue.milestone && !ownedNumbers.has(issue.milestone.number)) {
      throw Error('Refusing to overwrite manually assigned external milestone on #' + issue.number);
    }
    await api(PREFIX + '/issues/' + issue.number, 'PATCH', { milestone: number });
    assigned++;
    console.log('Assigned ' + taskId + ' (#' + issue.number + ') to ' + milestone.id + ' (#' + number + ')');
    await sleep(900);
  }
}
console.log('Milestone sync complete: ' + msById.size + ' milestones, ' +
  assigned + ' task assignments changed, ' + skipped + ' already correct.');
