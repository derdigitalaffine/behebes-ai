#!/usr/bin/env node
/**
 * Dependency-free documentation contract check.
 * Scans the project documentation, not user content or generated dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REQUIRED = [
  'AGENTS.md', 'README.md', 'QUICKSTART.md',
  'docs/INDEX.md', 'docs/STATUS.md', 'docs/ROADMAP.md',
  'docs/ARCHITECTURE.md', 'docs/DEVELOPMENT.md', 'docs/TESTING.md',
  'docs/AGENT_ORCHESTRATION.md', 'docs/SECURITY_PRIVACY.md',
  'docs/OPERATIONS.md', 'docs/DATA_AND_MIGRATIONS.md',
  'docs/API_CONTRACTS.md', 'docs/UX_PRINCIPLES.md',
  'docs/DECISIONS.md', 'docs/ISSUE_BACKLOG.md',
  'docs/RELEASE_CHECKLIST.md', 'agents/README.md',
];
const SCAN = ['AGENTS.md', 'README.md', 'QUICKSTART.md', 'docs', '.github/agents', '.github/PULL_REQUEST_TEMPLATE.md', '.github/copilot-instructions.md', 'agents/README.md'];
const MISSING = [];
const docs = [];
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(ROOT, f))) MISSING.push(`${f}: Pflichtdokument fehlt`);
}
function walk(p) {
  const abs = path.join(ROOT, p);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) {
    for (const e of fs.readdirSync(abs).sort()) walk(path.posix.join(p, e));
  } else if (p.endsWith('.md')) docs.push(p);
}
for (const p of SCAN) walk(p);
for (const doc of docs) {
  const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
  // Markdown links/images with simple destinations; ignore anchors/external protocols.
  // Complex references should be checked manually in PR reviews.
  const re = /!?\[[^\]]*\]\((<[^>]*>|[^\s)]+)(?:\s+["'][^"']+["'])?\)/g;
  for (const m of text.matchAll(re)) {
    const target = m[1].replace(/^<|>$/g, '').split('#')[0].split('?')[0];
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
    let decoded = target;
    try { decoded = decodeURIComponent(target); } catch {
      MISSING.push(`${doc}: ungültige URL-Kodierung: ${target}`); continue;
    }
    const resolved = path.resolve(ROOT, path.dirname(doc), decoded);
    if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
      MISSING.push(`${doc}: Link führt außerhalb des Repositories: ${target}`); continue;
    }
    if (!fs.existsSync(resolved)) MISSING.push(`${doc}: Linkziel fehlt: ${target}`);
  }
}
if (MISSING.length) {
  console.error('Dokumentationsprüfung fehlgeschlagen:');
  for (const problem of MISSING) console.error(' -', problem);
  process.exitCode = 1;
} else {
  console.log(`Dokumentationsprüfung erfolgreich: ${docs.length} Dateien geprüft, ${REQUIRED.length} Pflichtseiten vorhanden.`);
}
