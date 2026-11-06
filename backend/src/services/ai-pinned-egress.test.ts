import { describe, expect, it, vi } from 'vitest';
import {
  AiEgressTransportError,
  createPinnedHttpsFetcher,
  isPublicAiEgressAddress,
  pinnedHttpsRequestOptions,
  resolvePinnedAiDestination,
} from './ai-pinned-egress.js';

const origin = 'https://models.example.invalid';
const base = origin + '/v1';
const publicDns = vi.fn(async (_hostname: string) => [
  { address: '1.1.1.1', family: 4 }, { address: '2606:4700:4700::1111', family: 6 },
]);
const expectDenied = async (action: Promise<unknown>, code: string) => {
  await expect(action).rejects.toMatchObject({ code });
};

describe('K07: address classes and DNS rebinding controls', () => {
  it.each([
    '1.1.1.1', '8.8.8.8', '9.9.9.9',
    '2606:4700:4700::1111', '2001:4860:4860::8888',
  ])('accepts globally routable test IP %s', address => {
    expect(isPublicAiEgressAddress(address)).toBe(true);
  });

  it.each([
    '0.0.0.0', '10.0.2.3', '100.64.0.1', '127.0.0.1',
    '169.254.169.254', '172.16.1.3', '172.31.255.254',
    '192.0.0.8', '192.0.2.3', '192.168.1.1',
    '198.18.1.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1',
    'fe80::1', 'fc00::1', 'fd00::1',
    '2001:db8::1', '2002:0a00:0001::1',
    'garbage',
  ])('rejects special/private/tunnel/non-IP destinations: %s', address => {
    expect(isPublicAiEgressAddress(address)).toBe(false);
  });

  it('validates ALL returned DNS A/AAAA records, then pins a single public IP', async () => {
    const resolver = vi.fn(async () => [
      { address: '1.1.1.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    const result = await resolvePinnedAiDestination(base, [origin], resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith('models.example.invalid');
    expect(result).toEqual({
      endpoint: origin + '/v1/chat/completions',
      hostname: 'models.example.invalid',
      address: '1.1.1.1',
      family: 4,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    { records: [{ address: '127.0.0.1', family: 4 }] },
    { records: [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }] },
    { records: [{ address: '2606:4700:4700::1111', family: 6 }, { address: '::1', family: 6 }] },
    { records: [{ address: '1.1.1.1', family: 6 }] },
    { records: [{ address: 'invalid', family: 4 }] },
  ])('rejects a DNS answer with even one unsafe or malformed address', async ({ records }) => {
    await expectDenied(resolvePinnedAiDestination(base, [origin], async () => records),
      'address_rejected');
  });

  it('refuses empty, abnormally large or failed DNS responses', async () => {
    await expectDenied(resolvePinnedAiDestination(base, [origin], async () => []),
      'address_rejected');
    await expectDenied(resolvePinnedAiDestination(base, [origin],
      async () => Array.from({ length: 33 }, () => ({ address: '1.1.1.1', family: 4 }))),
    'address_rejected');
    await expectDenied(resolvePinnedAiDestination(base, [origin],
      async () => { throw new Error('private provider DNS record'); }), 'dns_unavailable');
  });

  it('never contacts DNS for an unapproved origin or literal-IP endpoint', async () => {
    const resolver = vi.fn(async () => [{ address: '1.1.1.1', family: 4 }]);
    await expectDenied(resolvePinnedAiDestination('https://evil.invalid/v1', [origin], resolver),
      'endpoint_rejected');
    await expectDenied(resolvePinnedAiDestination('https://169.254.169.254/v1',
      ['https://169.254.169.254'], resolver), 'endpoint_rejected');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('binds TLS to original hostname while dialing the pinned address', async () => {
    const result = await resolvePinnedAiDestination(base, [origin], publicDns);
    const opts = pinnedHttpsRequestOptions(result, 'Bearer synthetic-never-log');
    expect(opts.hostname).toBe('1.1.1.1');
    expect(opts.servername).toBe('models.example.invalid');
    expect(opts.port).toBe(443);
    expect(opts.protocol).toBe('https:');
    expect(opts.method).toBe('POST');
    expect(opts.path).toBe('/v1/chat/completions');
    expect(opts.rejectUnauthorized).toBe(true);
    expect(opts.agent).toBe(false);
    expect(opts.headers).toMatchObject({
      host: 'models.example.invalid',
      'content-type': 'application/json',
      authorization: 'Bearer synthetic-never-log',
    });
  });

  it('rejects a tampered address, host or URL even after DNS verification', async () => {
    const valid = await resolvePinnedAiDestination(base, [origin], publicDns);
    expect(() => pinnedHttpsRequestOptions({ ...valid, address: '127.0.0.1' }))
      .toThrow(AiEgressTransportError);
    expect(() => pinnedHttpsRequestOptions({ ...valid, hostname: 'evil.invalid' }))
      .toThrow(AiEgressTransportError);
    expect(() => pinnedHttpsRequestOptions({ ...valid, family: 6 }))
      .toThrow(AiEgressTransportError);
  });

  it('denies any different endpoint, method or non-JSON request before opening a socket', async () => {
    const destination = await resolvePinnedAiDestination(base, [origin], publicDns);
    const fetcher = createPinnedHttpsFetcher(destination);
    const opts = { method: 'POST', redirect: 'error' as const,
      headers: { 'content-type': 'application/json' }, body: '{}' };
    await expectDenied(fetcher('https://different.invalid/v1/chat/completions', opts),
      'transport_rejected');
    await expectDenied(fetcher(destination.endpoint, { ...opts, method: 'GET' }),
      'transport_rejected');
    await expectDenied(fetcher(destination.endpoint, {
      ...opts, headers: { 'x-forwarded-host': 'evil.invalid', 'content-type': 'application/json' },
    }), 'transport_rejected');
    await expectDenied(fetcher(destination.endpoint, {
      ...opts, body: 'x'.repeat(350_000),
    }), 'transport_rejected');
    const controller = new AbortController();
    controller.abort();
    await expectDenied(fetcher(destination.endpoint, { ...opts, signal: controller.signal }),
      'transport_rejected');
  });
});
