import { describe, expect, it, vi } from 'vitest';
import {
  AiGatewayError, generateGovernedChat,
  type GovernedGeneration,
} from './ai-governed-gateway.js';

const payload: GovernedGeneration = {
  connection: {
    id: 'conn1', providerId: 'cloud-eu', region: 'eu',
    baseUrl: 'https://models.example.invalid/v1',
    allowedOrigins: ['https://models.example.invalid'],
    credentialRef: 'ai-provider/cloud-eu',
    models: [{ modelId: 'approved-model', supported: ['text'], evidence: 'declared' }],
  },
  context: {
    tenantId: 't1', taskKey: 'classification', providerId: 'cloud-eu',
    region: 'eu', dataClass: 'personal', aiModuleEnabled: true,
    actorAuthorized: true, networkEgressApproved: true,
  },
  grant: {
    tenantId: 't1', enabled: true, allowedTasks: ['classification'],
    allowedProviders: ['cloud-eu'], allowedRegions: ['eu'],
    allowedDataClasses: ['personal'], privacyReviewRef: 'review-2026',
    expiresAt: '2027-01-01T00:00:00Z',
  },
  request: {
    taskKey: 'classification', modelId: 'approved-model',
    messages: [{ role: 'user', content: 'synthetic public issue description' }],
  },
  credentials: { resolve: vi.fn(async () => 'fake-secret-never-log') },
  nowMs: Date.parse('2026-11-06T12:00:00Z'),
};
const response = () => new Response(JSON.stringify({
  model: 'approved-model',
  choices: [{ message: { content: 'test classification' }, finish_reason: 'stop' }],
}), { status: 200 });
describe('K03/K07/K16: governed AI connection facade', () => {
  it('runs a single approved request and resolves credentials only after policy checks', async () => {
    const events: string[] = [];
    const resolve = vi.fn(async (ref: string) => { events.push('secret'); expect(ref).toBe('ai-provider/cloud-eu'); return 'fake-secret-never-log'; });
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      events.push('fetch');
      expect(init?.redirect).toBe('error');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer fake-secret-never-log');
      return response();
    });
    const result = await generateGovernedChat({
      ...payload, credentials: { resolve }, fetcher: fetcher as unknown as typeof fetch,
    });
    expect(result.text).toBe('test classification');
    expect(events).toEqual(['secret', 'fetch']);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://models.example.invalid/v1/chat/completions');
  });
  it.each([
    [{ context: { ...payload.context, tenantId: 'other' } }, 'policy_denied'],
    [{ context: { ...payload.context, aiModuleEnabled: false } }, 'policy_denied'],
    [{ context: { ...payload.context, networkEgressApproved: false } }, 'policy_denied'],
    [{ context: { ...payload.context, dataClass: 'special_category' as const } }, 'policy_denied'],
    [{ context: { ...payload.context, providerId: 'other-cloud' } }, 'policy_denied'],
    [{ connection: { ...payload.connection, baseUrl: 'https://127.0.0.1/v1' } }, 'endpoint_denied'],
    [{ connection: { ...payload.connection, baseUrl: 'https://other.invalid/v1' } }, 'endpoint_denied'],
    [{ connection: { ...payload.connection, credentialRef: 'sk-live-unsafe-value' } }, 'credential_unavailable'],
  ] as const)('rejects unauthorized configuration %s without reading secrets', async (change, code) => {
    const resolve = vi.fn(async () => 'fake-secret-never-log');
    const fetcher = vi.fn(async () => response());
    await expect(generateGovernedChat({
      ...payload, ...change, credentials: { resolve }, fetcher: fetcher as unknown as typeof fetch,
    })).rejects.toMatchObject({ code });
    expect(resolve).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fails closed on malformed connection identities without resolving credentials', async () => {
    const resolve = vi.fn(async () => 'fake-secret-never-log');
    for (const badId of [undefined, null, '', '  ']) {
      await expect(generateGovernedChat({
        ...payload, connection: { ...payload.connection, id: badId as any },
        credentials: { resolve },
      })).rejects.toMatchObject({ code: 'policy_denied' });
    }
    expect(resolve).not.toHaveBeenCalled();
  });
  it('rejects a private DNS result before resolving any credential or opening a socket', async () => {
    const resolve = vi.fn(async () => 'fake-secret-never-log');
    const dnsResolver = vi.fn(async () => [
      { address: '1.1.1.1', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(generateGovernedChat({
      ...payload,
      fetcher: undefined,
      dnsResolver,
      credentials: { resolve },
    })).rejects.toMatchObject({ code: 'endpoint_denied' });
    expect(dnsResolver).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not accept a task mismatch even with a valid tenant grant', async () => {
    const resolve = vi.fn(async () => 'fake-secret-never-log');
    await expect(generateGovernedChat({
      ...payload, request: { ...payload.request, taskKey: 'translation' },
      credentials: { resolve },
    })).rejects.toMatchObject({ code: 'policy_denied' });
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each(['', ' ', 'key\nnewline', null])('fails closed for unavailable/invalid secret: %s', async key => {
    const fetcher = vi.fn(async () => response());
    await expect(generateGovernedChat({
      ...payload, credentials: { resolve: async () => key }, fetcher: fetcher as unknown as typeof fetch,
    })).rejects.toMatchObject({ code: 'credential_unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('redacts backend credential store failures', async () => {
    const secret = 'sensitive-credential-test';
    let error: unknown;
    try {
      await generateGovernedChat({
        ...payload,
        credentials: { resolve: async () => { throw new Error(secret); } },
      });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(AiGatewayError);
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });
  it('does not fallback to another provider after a 429', async () => {
    const fetcher = vi.fn(async () => new Response('private quota message', { status: 429 }));
    await expect(generateGovernedChat({
      ...payload, fetcher: fetcher as unknown as typeof fetch,
    })).rejects.toMatchObject({ failure: { kind: 'rate_limited', retryable: true, status: 429 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
