import { describe, expect, it, vi } from 'vitest';
import {
  createOpenAiCompatibleChatAdapter,
  ProviderAdapterError,
  type OpenAiCompatibleChatConfig,
} from './ai-provider-adapter.js';

const request = {
  taskKey: 'classification',
  modelId: 'reviewed-model',
  messages: [{ role: 'user' as const, content: 'Synthetic road issue, not citizen data' }],
  maxOutputTokens: 256,
};
const approved = {
  baseUrl: 'https://ai.example.invalid/v1',
  allowedOrigins: ['https://ai.example.invalid'],
  apiKey: 'synthetic-test-only',
  models: [
    { modelId: 'reviewed-model', supported: ['text' as const], evidence: 'probed' as const },
  ],
};
const reply = (json: unknown, status = 200) => new Response(JSON.stringify(json), {
  status,
  headers: { 'content-type': 'application/json' },
});
const success = {
  model: 'reviewed-model',
  choices: [{ message: { content: 'synthetic classification' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 8, completion_tokens: 3 },
};
const make = (fetcher: (...args: any[]) => Promise<Response>, overrides: Partial<OpenAiCompatibleChatConfig> = {}) =>
  createOpenAiCompatibleChatAdapter({
    ...approved, ...overrides,
    fetcher: fetcher as unknown as typeof fetch,
  });
const expectFailure = async (
  p: Promise<unknown>,
  kind: ProviderAdapterError['failure']['kind'],
  retryable: boolean
) => {
  try {
    await p;
    throw new Error('Expected adapter failure: ' + kind);
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderAdapterError);
    if (error instanceof ProviderAdapterError) {
      expect(error.failure.kind).toBe(kind);
      expect(error.failure.retryable).toBe(retryable);
      expect(error.message).toBe('AI provider ' + kind);
      expect(JSON.stringify(error)).not.toContain('synthetic-test-only');
    }
  }
};
describe('K02 OpenAI-compatible chat adapter (no real network)', () => {
  it('uses exactly the approved endpoint and produces a normalized response', async () => {
    const transport = vi.fn(async () => reply(success));
    const adapter = make(transport);
    expect(adapter.kind).toBe('openai_compatible_chat');
    expect(await adapter.generate(request)).toEqual({
      modelId: 'reviewed-model',
      text: 'synthetic classification',
      finishReason: 'stop',
      usage: { inputTokens: 8, outputTokens: 3 },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai.example.invalid/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer synthetic-test-only');
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'reviewed-model',
      messages: request.messages,
      stream: false,
      max_tokens: 256,
    });
  });
  it('supports provider-specific output token parameter without changing the task', async () => {
    const send = vi.fn(async () => reply(success));
    await make(send, { tokenParameter: 'max_completion_tokens' }).generate(request);
    const body = JSON.parse(String((send.mock.calls[0] as any)[1].body));
    expect(body.max_completion_tokens).toBe(256);
    expect(body).not.toHaveProperty('max_tokens');
  });
  it('does not transmit credentials when none were configured', async () => {
    const send = vi.fn(async () => reply(success));
    await make(send, { apiKey: '' }).generate(request);
    expect((send.mock.calls[0] as any)[1].headers).not.toHaveProperty('authorization');
  });

  it.each([
    ['non-HTTPS', 'http://ai.example.invalid/v1'],
    ['userinfo', 'https://user:password@ai.example.invalid/v1'],
    ['query', 'https://ai.example.invalid/v1?api_key=test'],
    ['hash', 'https://ai.example.invalid/v1#fragment'],
    ['other origin', 'https://evil.example.invalid/v1'],
    ['subdomain', 'https://sub.ai.example.invalid/v1'],
    ['nested-completions', 'https://ai.example.invalid/v1/chat/completions'],
    ['invalid URL', 'not-a-url'],
  ])('rejects unsafe endpoint %s before any request', (_name, baseUrl) => {
    const send = vi.fn(async () => reply(success));
    expect(() => make(send, { baseUrl })).toThrow(ProviderAdapterError);
    expect(send).not.toHaveBeenCalled();
  });
  it('fails closed without an explicit origin allowlist', () => {
    expect(() => make(async () => reply(success), { allowedOrigins: [] })).toThrow(ProviderAdapterError);
  });
  it.each([
    ['unknown capability evidence', [{ modelId: 'reviewed-model', supported: ['text' as const], evidence: 'unknown' as const }]],
    ['not-text model', [{ modelId: 'reviewed-model', supported: ['vision' as const], evidence: 'probed' as const }]],
    ['missing model', []],
  ])('refuses model with %s', async (_why, models) => {
    const send = vi.fn(async () => reply(success));
    await expectFailure(make(send, { models }).generate(request), 'unsupported', false);
    expect(send).not.toHaveBeenCalled();
  });
  it('refuses model ID not in preapproved capabilities', async () => {
    const send = vi.fn(async () => reply(success));
    await expectFailure(make(send).generate({ ...request, modelId: 'unapproved-model' }), 'unsupported', false);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    { ...request, taskKey: '' },
    { ...request, messages: [] },
    { ...request, messages: [{ role: 'tool' as any, content: 'do not trust me' }] },
    { ...request, messages: [{ role: 'user' as const, content: '' }] },
    { ...request, maxOutputTokens: 0 },
    { ...request, maxOutputTokens: 99999 },
  ])('rejects malformed task data before network access', async badRequest => {
    const send = vi.fn(async () => reply(success));
    await expectFailure(make(send).generate(badRequest), 'invalid_request', false);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'authentication', false],
    [403, 'forbidden', false],
    [404, 'unsupported', false],
    [408, 'timeout', true],
    [429, 'rate_limited', true],
    [500, 'unavailable', true],
    [502, 'unavailable', true],
  ] as const)('normalizes HTTP %i and ignores sensitive provider response', async (status, kind, retryable) => {
    const fetcher = vi.fn(async () => new Response('private token: SHOULD-NOT-LEAK', { status }));
    await expectFailure(make(fetcher).generate(request), kind, retryable);
  });
  it.each(['not-json', '{}', '{"choices":[{}]}', '{"choices":[{"message":{"content":null}}]}'])(
    'rejects malformed provider payload without passing through its body',
    async raw => {
      await expectFailure(make(async () => new Response(raw)).generate(request), 'unknown', false);
    }
  );
  it('bounds provider response size even when content-length is absent', async () => {
    const big = 'x'.repeat(5000);
    await expectFailure(make(async () => new Response(big), { maxResponseBytes: 1024 }).generate(request), 'unknown', false);
  });
  it('rejects oversized advertised bodies without exposing content', async () => {
    const response = new Response('synthetic provider response', {
      status: 200,
      headers: { 'content-length': '10000000' },
    });
    await expectFailure(make(async () => response, { maxResponseBytes: 1024 }).generate(request),
      'unknown', false);
    expect(response.bodyUsed).toBe(true);
  });
  it('handles unsupported/partial provider finish metadata without inventing success', async () => {
    const fetcher = async () => reply({
      choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
      usage: { prompt_tokens: '9', completion_tokens: -3 },
    });
    expect(await make(fetcher).generate(request)).toEqual({
      modelId: 'reviewed-model',
      text: '',
      finishReason: 'refused',
    });
  });
  it('returns a sanitized network error', async () => {
    const send = async () => { throw Object.assign(new Error('secret token'), { code: 'ECONNRESET' }); };
    await expectFailure(make(send as any).generate(request), 'network', true);
  });
  it('honors caller cancellation and never starts a request when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn(async () => reply(success));
    await expectFailure(make(send).generate(request, { signal: controller.signal }), 'cancelled', false);
    expect(send).not.toHaveBeenCalled();
  });
  it('aborts an inflight request when caller cancels', async () => {
    const controller = new AbortController();
    const send = async (_url: unknown, init?: RequestInit): Promise<Response> => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('private'), { name: 'AbortError' })));
        controller.abort();
      });
    };
    await expectFailure(make(send).generate(request, { signal: controller.signal }), 'cancelled', false);
  });
  it('enforces a finite timeout with no implicit retry', async () => {
    let attempts = 0;
    const send = async (_url: unknown, init?: RequestInit): Promise<Response> => {
      attempts++;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('private'), { name: 'AbortError' })));
      });
    };
    await expectFailure(make(send, { timeoutMs: 100 }).generate(request), 'timeout', true);
    expect(attempts).toBe(1);
  });
});
