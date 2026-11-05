#!/usr/bin/env node
/** Deterministic structural validation; this does not execute coding agents. */
import { readFileSync, existsSync } from 'node:fs';
const source = 'agents/orchestration.json';
let contract;
try { contract = JSON.parse(readFileSync(source, 'utf8')); }
catch (error) { console.error(`${source}: invalid JSON: ${error.message}`); process.exit(1); }
function requireThat(condition, reason) { if (!condition) throw new Error(reason); }
try {
  requireThat(contract.schemaVersion === 1, 'Unsupported schemaVersion');
  requireThat(existsSync(contract.authority), 'Missing authority document');
  requireThat(contract.approvalPolicy?.implementationMayNotSelfApprove === true, 'Missing independent approval');
  for (const action of ['merge', 'release', 'deployment', 'production-data-access', 'external-actions']) {
    requireThat(contract.approvalPolicy.humanRequiredFor.includes(action), `Human approval missing: ${action}`);
  }
  const agents = contract.agents ?? {};
  requireThat(Object.keys(agents).length >= 6, 'Expected named role profiles');
  for (const [id, agent] of Object.entries(agents)) {
    requireThat(typeof agent.profile === 'string' && existsSync(agent.profile), `Profile missing: ${id}`);
    requireThat(agent.writesProduction === false, `Production mutation not forbidden: ${id}`);
    const profile = readFileSync(agent.profile, 'utf8');
    requireThat(profile.startsWith('---\n') && profile.includes('\nname:') && profile.includes('\ndescription:'), `Profile metadata missing: ${id}`);
  }
  const gates = contract.gates ?? [];
  const byId = new Map(gates.map(gate => [gate.id, gate]));
  requireThat(byId.size === gates.length && gates.length >= 6, 'Duplicate/missing gate ids');
  requireThat(byId.has('humanApproval'), 'Missing human review gate');
  requireThat(byId.get('humanApproval').reviewer === 'human', 'Final approval must be human');
  for (const gate of gates) {
    requireThat(agents[gate.owner], `Unknown owner: ${gate.id}`);
    requireThat(gate.reviewer === 'human' || agents[gate.reviewer], `Unknown reviewer: ${gate.id}`);
    requireThat(gate.owner !== gate.reviewer, `Self review is not allowed: ${gate.id}`);
    requireThat(typeof gate.evidence === 'string' && gate.evidence.length >= 10, `Missing evidence contract: ${gate.id}`);
    for (const dependency of gate.dependsOn) requireThat(byId.has(dependency), `Unknown dependency: ${gate.id} -> ${dependency}`);
  }
  const seen = new Set(), active = new Set();
  function visit(id) {
    requireThat(!active.has(id), `Cyclic gate dependency: ${id}`);
    if (seen.has(id)) return;
    active.add(id);
    for (const dep of byId.get(id).dependsOn) visit(dep);
    active.delete(id);
    seen.add(id);
  }
  for (const gate of gates) visit(gate.id);
  requireThat(seen.size === gates.length, 'Not all gates are reachable');
  console.log(`Agentenvertrag geprüft: ${Object.keys(agents).length} Rollen, ${gates.length} Gates, keine Zyklen.`);
} catch (error) {
  console.error(`Agentenvertrag ungültig: ${error.message}`);
  process.exitCode = 1;
}
