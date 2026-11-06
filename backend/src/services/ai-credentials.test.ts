import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiCredentialConfigurationError,
  createBoundAiCredentialResolver,
  createEnvironmentAiCredentialResolver,
  type AiCredentialBinding,
} from './ai-credentials.js';

const binding: AiCredentialBinding = {
  ref: 'ai-provider/cloud-eu',
  tenantId: 'tenant-a',
  providerId: 'cloud-eu',
  connectionId: 'conn-1',
  secretKey: 'AI_PROVIDER_CLOUD_EU',
};
const authorized = {
  tenantId: 'tenant-a', providerId: 'cloud-eu', connectionId: 'conn-1',
};

describe('K03: tenant-bound secret resolution', () => {
  it('resolves the exact server-selected key for an authorized connection', async () => {
    const read = vi.fn(async (_key: string) => 'synthetic-provider-key');
    const resolver = createBoundAiCredentialResolver([binding], { read });
    expect(await resolver.resolve(binding.ref, authorized)).toBe('synthetic-provider-key');
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('AI_PROVIDER_CLOUD_EU');
  });

  it.each([
    { ...authorized, tenantId: 'tenant-b' },
    { ...authorized, providerId: 'other-provider' },
    { ...authorized, connectionId: 'conn-2' },
    { ...authorized, tenantId: ' tenant-a' },
    { ...authorized, providerId: '' },
  ])('refuses mismatched or malformed identity before accessing a secret', async identity => {
    const read = vi.fn(async () => 'synthetic-private-value');
    const resolver = createBoundAiCredentialResolver([binding], { read });
    expect(await resolver.resolve(binding.ref, identity)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('does not accept a different or user-constructed secret reference', async () => {
    const read = vi.fn(async () => 'synthetic-private-value');
    const resolver = createBoundAiCredentialResolver([binding], { read });
    for (const ref of [
      'ai-provider/other', 'AI_PROVIDER_CLOUD_EU', 'ai-provider/../cloud-eu',
      'ai-provider/cloud-eu?secret=1', '', 'ai-provider/cloud-eu\n',
    ]) {
      expect(await resolver.resolve(ref, authorized)).toBeNull();
    }
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    { ...binding, secretKey: 'PATH' },
    { ...binding, secretKey: 'AWS_SECRET_ACCESS_KEY' },
    { ...binding, secretKey: 'AI_PROVIDER_SECRET\nHEADER' },
    { ...binding, secretKey: 'AI_PROVIDER_secret' },
    { ...binding, tenantId: '' },
    { ...binding, tenantId: 'tenant with spaces' },
    { ...binding, ref: 'ai-provider/../secret' },
  ])('rejects unsafe binding configuration without exposing input', invalid => {
    let thrown: unknown;
    try { createBoundAiCredentialResolver([invalid], { read: () => 'secret' }); }
    catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(AiCredentialConfigurationError);
    expect(String(thrown)).not.toContain(invalid.secretKey);
  });

  it('fails on duplicate references, even if the tenant differs', () => {
    expect(() => createBoundAiCredentialResolver(
      [binding, { ...binding, tenantId: 'tenant-b' }],
      { read: () => 'synthetic-private-value' },
    )).toThrow(AiCredentialConfigurationError);
  });

  it.each([
    '', ' token', 'token ', 'bad\nheader', 'bad\rheader',
    'emoji-🔒', 'A'.repeat(4097),
  ])('rejects invalid provider tokens without logging the returned value', async value => {
    const resolver = createBoundAiCredentialResolver([binding], { read: () => value });
    expect(await resolver.resolve(binding.ref, authorized)).toBeNull();
  });

  it('does not cache secrets and permits trusted source rotation', async () => {
    let current = 'first-token';
    const read = vi.fn(() => current);
    const resolver = createBoundAiCredentialResolver([binding], { read });
    expect(await resolver.resolve(binding.ref, authorized)).toBe('first-token');
    current = 'rotated-token';
    expect(await resolver.resolve(binding.ref, authorized)).toBe('rotated-token');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('copies bindings to protect against later source-object mutations', async () => {
    const mutable = { ...binding };
    const read = vi.fn((key: string) => key === 'AI_PROVIDER_CLOUD_EU' ? 'trusted-token' : 'bad-token');
    const resolver = createBoundAiCredentialResolver([mutable], { read });
    mutable.secretKey = 'AI_PROVIDER_OTHER';
    mutable.tenantId = 'tenant-b';
    expect(await resolver.resolve(binding.ref, authorized)).toBe('trusted-token');
    expect(read).toHaveBeenCalledWith('AI_PROVIDER_CLOUD_EU');
  });

  it('redacts secret service errors and denies instead of leaking a cause', async () => {
    const secret = 'sensitive-secret-service-URL';
    const resolver = createBoundAiCredentialResolver([binding], {
      read: async () => { throw new Error(secret); },
    });
    const result = await resolver.resolve(binding.ref, authorized);
    expect(result).toBeNull();
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('fails closed without an actual configured secret', async () => {
    const resolver = createBoundAiCredentialResolver([binding], { read: () => undefined });
    expect(await resolver.resolve(binding.ref, authorized)).toBeNull();
  });
});

describe('K03: environment-backed deployment adapter', () => {
  const name = 'AI_PROVIDER_K03_TEST_ONLY';
  const testBinding: AiCredentialBinding = { ...binding, secretKey: name };
  const original = process.env[name];

  afterEach(() => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });

  it('reads only an explicitly mapped environment variable', async () => {
    process.env[name] = 'synthetic-env-token';
    const resolver = createEnvironmentAiCredentialResolver([testBinding]);
    expect(await resolver.resolve(testBinding.ref, authorized)).toBe('synthetic-env-token');
    expect(await resolver.resolve(testBinding.ref, { ...authorized, tenantId: 'other' })).toBeNull();
  });

  it('reads the current process environment again after a local change', async () => {
    process.env[name] = 'test-v1';
    const resolver = createEnvironmentAiCredentialResolver([testBinding]);
    expect(await resolver.resolve(testBinding.ref, authorized)).toBe('test-v1');
    process.env[name] = 'test-v2';
    expect(await resolver.resolve(testBinding.ref, authorized)).toBe('test-v2');
  });
});
