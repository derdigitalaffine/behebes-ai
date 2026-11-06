import { describe, expect, it } from 'vitest';
import { assessModelSupport } from './ai-model-capabilities.js';
import type { ProviderModelCapabilities } from './ai-provider-contract.js';

const timestamp = '2026-11-06T10:00:00.000Z';
const nowMs = Date.parse(timestamp);
const declared: ProviderModelCapabilities = {
  modelId: 'reviewed-model',
  supported: ['text', 'vision', 'structured_output'],
  evidence: 'declared',
};
const probed: ProviderModelCapabilities = {
  ...declared, evidence: 'probed', observedAt: timestamp,
};
describe('K04: explicit, evidence-based model capability decisions', () => {
  it('accepts an operator-declared model only when every required capability exists', () => {
    expect(assessModelSupport(declared, ['text', 'structured_output'])).toEqual({
      allowed: true, reason: 'eligible', missing: [],
    });
    expect(assessModelSupport(declared, ['text', 'tool_calling'])).toEqual({
      allowed: false, reason: 'capability_missing', missing: ['tool_calling'],
    });
  });
  it('does not infer vision/tools from a marketing model name', () => {
    const nameOnly: ProviderModelCapabilities = {
      modelId: 'super-vision-tools', supported: ['text'], evidence: 'declared',
    };
    expect(assessModelSupport(nameOnly, ['vision', 'tool_calling'])).toEqual({
      allowed: false, reason: 'capability_missing', missing: ['vision', 'tool_calling'],
    });
  });
  it('denies unknown/unverified evidence even when supported flags are present', () => {
    expect(assessModelSupport({ ...declared, evidence: 'unknown' }, ['text'])).toEqual({
      allowed: false, reason: 'unverified', missing: ['text'],
    });
  });
  it('accepts a fresh synthetic capability probe', () => {
    expect(assessModelSupport(probed, ['text', 'vision'], { nowMs })).toEqual({
      allowed: true, reason: 'eligible', missing: [],
    });
  });
  it.each([
    [undefined, nowMs],
    ['bad-timestamp', nowMs],
    ['2026-11-04T09:00:00.000Z', nowMs],
    ['2026-11-07T09:00:00.000Z', nowMs],
  ])('rejects stale, invalid or far-future probe evidence', (observedAt, now) => {
    expect(assessModelSupport({ ...probed, observedAt }, ['text'], { nowMs: now })).toEqual({
      allowed: false, reason: 'probe_expired', missing: ['text'],
    });
  });
  it('keeps the time budget explicit and rejects invalid probe TTL', () => {
    expect(assessModelSupport(probed, ['text'], { nowMs, maxProbeAgeMs: -1 }).allowed).toBe(false);
    expect(assessModelSupport(probed, ['text'], { nowMs, maxProbeAgeMs: 60000 }).allowed).toBe(true);
  });
  it('rejects empty requirements and missing model rather than assuming all features', () => {
    expect(assessModelSupport(declared, [])).toEqual({
      allowed: false, reason: 'invalid_requirements', missing: [],
    });
    expect(assessModelSupport(undefined, ['text'])).toEqual({
      allowed: false, reason: 'model_unavailable', missing: ['text'],
    });
  });
  it('deduplicates missing required capabilities deterministically', () => {
    expect(assessModelSupport(declared, ['tool_calling', 'tool_calling', 'embeddings'])).toEqual({
      allowed: false, reason: 'capability_missing', missing: ['tool_calling', 'embeddings'],
    });
  });
  it('fails closed for malformed runtime capability metadata', () => {
    expect(assessModelSupport({
      modelId: 'untrusted-model', supported: ['text', 'unrecognized-protocol'] as any,
      evidence: 'declared',
    }, ['text']).allowed).toBe(false);
  });
});
