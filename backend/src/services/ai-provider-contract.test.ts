import { describe, expect, it } from 'vitest';
import { classifyProviderFailure } from './ai-provider-contract.js';

describe('classifyProviderFailure: redacted, deterministic provider errors', () => {
  it.each([
    [401, 'authentication', false],
    [403, 'forbidden', false],
    [400, 'invalid_request', false],
    [422, 'invalid_request', false],
    [404, 'unsupported', false],
    [408, 'timeout', true],
    [429, 'rate_limited', true],
    [500, 'unavailable', true],
    [502, 'unavailable', true],
    [503, 'unavailable', true],
    [504, 'timeout', true],
    [501, 'unsupported', false],
  ] as const)('classifies HTTP %i without provider content', (status, kind, retryable) => {
    const raw = {
      status,
      message: 'Bearer should-not-escape',
      response: { data: { prompt: 'synthetic private value' } },
      headers: { authorization: 'not-for-logs' },
    };
    expect(classifyProviderFailure(raw)).toEqual({ kind, status, retryable });
    expect(JSON.stringify(classifyProviderFailure(raw))).not.toContain('should-not-escape');
    expect(JSON.stringify(classifyProviderFailure(raw))).not.toContain('not-for-logs');
  });

  it.each([
    ['AbortError', 'ABORT_ERR', 'cancelled', false],
    ['Error', 'ERR_CANCELED', 'cancelled', false],
    ['TimeoutError', 'UNRECOGNIZED', 'timeout', true],
    ['Error', 'ETIMEDOUT', 'timeout', true],
    ['Error', 'ENOTFOUND', 'network', true],
    ['Error', 'ECONNRESET', 'network', true],
    ['Error', 'EAI_AGAIN', 'network', true],
  ] as const)('%s / %s yields %s', (name, code, kind, retryable) => {
    expect(classifyProviderFailure({ name, code })).toEqual({ kind, retryable });
  });

  it('does not retry an aborted request even when it has an HTTP status', () => {
    expect(classifyProviderFailure({ name: 'AbortError', status: 503 })).toEqual({
      kind: 'cancelled', retryable: false, status: 503,
    });
  });

  it('accepts statusCode from different SDKs', () => {
    expect(classifyProviderFailure({ statusCode: 429 })).toEqual({
      kind: 'rate_limited', retryable: true, status: 429,
    });
  });

  it('does not propagate untrusted properties or retry unknown failures', () => {
    expect(classifyProviderFailure({ code: 'UNRECOGNIZED', message: 'secret' })).toEqual({
      kind: 'unknown', retryable: false,
    });
    expect(classifyProviderFailure(null)).toEqual({ kind: 'unknown', retryable: false });
    expect(classifyProviderFailure('secret')).toEqual({ kind: 'unknown', retryable: false });
  });

  it('rejects invalid/out-of-range status values', () => {
    expect(classifyProviderFailure({ status: 999, message: 'secret' })).toEqual({
      kind: 'unknown', retryable: false,
    });
    expect(classifyProviderFailure({ status: '429' })).toEqual({
      kind: 'unknown', retryable: false,
    });
  });
});
