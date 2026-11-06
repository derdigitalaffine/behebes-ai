import { describe, expect, it } from 'vitest';
import { buildOpenRedirectUrl, sanitizeOpenTarget } from './pwa';

describe('Citizen PWA deep links: origin and input validation', () => {
  it.each([
    ['/tickets/123', '/tickets/123'],
    [' /tickets/123?tab=history ', '/tickets/123?tab=history'],
    ['/meldungen%2F123', '/meldungen/123'],
    ['/a%20b', '/a b'],
  ])('accepts safe relative routes', (source, expected) => {
    expect(sanitizeOpenTarget(source)).toBe(expected);
  });
  it.each([
    '', ' ', '//evil.invalid', 'https://evil.invalid',
    '\\evil.invalid', '/\\evil.invalid',
    '/%5cevil.invalid', '/%5C%5Cevil.invalid',
    '/%2fevil.invalid', '/%252fevil.invalid',
    '/%255cevil.invalid', '/%0d%0aevil.invalid',
    '/%not-valid', '%2F%2Fevil.invalid',
  ])('rejects potentially external or malformed route %s', target => {
    expect(sanitizeOpenTarget(target)).toBeNull();
  });
  it('builds an encoded same-origin redirect in server rendering', () => {
    expect(buildOpenRedirectUrl('/tickets/abc?tab=files')).toBe(
      'http://localhost/?open=%2Ftickets%2Fabc%3Ftab%3Dfiles'
    );
  });
});
