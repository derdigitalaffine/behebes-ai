#!/usr/bin/env node
/** Reports actual .test/.spec files; this is not evidence of test success. */
import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
const workspaces = ['backend', 'frontend', 'admin', 'ops'];
const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
function collect(dir, found) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, found);
    else if (entry.isFile() && testFile.test(entry.name)) found.push(relative('.', full));
  }
}
let backendCount = 0;
for (const workspace of workspaces) {
  const files = [];
  collect(join(workspace, 'src'), files);
  files.sort();
  console.log(workspace + ': ' + files.length + ' test source file(s)' +
    (files.length ? ' [' + files.join(', ') + ']' : ' — COVERAGE GAP'));
  if (workspace === 'backend') backendCount = files.length;
  if (files.length === 0) {
    console.warn('::warning file=' + workspace + '/package.json::' + workspace +
      ' has no .test/.spec source files; passing builds are NOT test coverage.');
  }
}
if (backendCount === 0) {
  console.error('M0 CI requires at least one deterministic backend test suite.');
  process.exitCode = 1;
}
