import { describe, expect, it } from 'vitest';
import { assessProviderEndpoint } from './ai-provider-endpoint.js';

const approved = ['https://models.example.invalid'];
describe('K07: static AI endpoint controls', () => {
  it('accepts an exact reviewed HTTPS origin and preserves API prefix', () => {
    expect(assessProviderEndpoint('https://models.example.invalid/v1/', approved)).toEqual({
      allowed: true,
      endpoint: 'https://models.example.invalid/v1/chat/completions',
      origin: 'https://models.example.invalid',
    });
  });
  it('does not approve a different subdomain, port or trailing-label suffix', () => {
    for (const url of [
      'https://api.models.example.invalid/v1',
      'https://models.example.invalid:8443/v1',
      'https://models.example.invalid.evil.invalid/v1',
    ]) expect(assessProviderEndpoint(url, approved).allowed).toBe(false);
  });
  it.each([
    'http://models.example.invalid/v1',
    'ftp://models.example.invalid/v1',
    'https://user:pass@models.example.invalid/v1',
    'https://models.example.invalid/v1?token=secret',
    'https://models.example.invalid/v1#fragment',
    'https://models.example.invalid/v1%2fhidden',
    'https://models.example.invalid/v1%5chidden',
    'https://models.example.invalid/v1/chat/completions',
    'not-a-url',
  ])('rejects invalid transport, authority or path %s', value => {
    expect(assessProviderEndpoint(value, approved).allowed).toBe(false);
  });
  it.each([
    'localhost', 'localhost.localdomain', 'a.local', 'foo.internal',
    'ai.lan', 'ai.home', 'metadata.google.internal',
    '127.0.0.1', '169.254.169.254', '10.1.2.3',
    '192.168.0.1', '[::1]', '[::ffff:127.0.0.1]',
  ])('refuses literal IPs and restricted hostname classes: %s', host => {
    expect(assessProviderEndpoint('https://' + host + '/v1',
      ['https://' + host]).allowed).toBe(false);
  });
  it('canonicalizes an encoded literal IP before checking host restrictions', () => {
    expect(assessProviderEndpoint('https://%31%32%37.0.0.1/v1',
      ['https://127.0.0.1']).allowed).toBe(false);
  });
  it('refuses missing, malformed or broad origin entries', () => {
    expect(assessProviderEndpoint('https://models.example.invalid', []).allowed).toBe(false);
    expect(assessProviderEndpoint('https://models.example.invalid', ['https://models.example.invalid/v1']).allowed).toBe(false);
    expect(assessProviderEndpoint('https://models.example.invalid', ['http://models.example.invalid']).allowed).toBe(false);
  });
});
