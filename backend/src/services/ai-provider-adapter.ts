/**
 * K02: a real, testable OpenAI-compatible *chat* transport.
 *
 * The adapter is deliberately NOT connected to the live LLM Hub yet.
 * Before integration: K03/K07/K16 must authorize credentials, egress,
 * tenant and data residency. No API key may be supplied by an end user.
 */
import {
  classifyProviderFailure,
  type ProviderFailure,
  type ProviderGenerationRequest,
  type ProviderGenerationResult,
  type ProviderModelCapabilities,
} from './ai-provider-contract.js';

export interface ProviderAdapter {
  readonly kind: string;
  generate(request: ProviderGenerationRequest, options?: { signal?: AbortSignal }): Promise<ProviderGenerationResult>;
}

export interface OpenAiCompatibleChatConfig {
  /** Approved deployment URL, e.g. https://api.example.invalid/v1 */
  baseUrl: string;
  /** Server-side approved origins. This is NOT a replacement for K07 DNS/IP egress controls. */
  allowedOrigins: ReadonlyArray<string>;
  /** Secret sourced only from a trusted server-side credentials store. */
  apiKey?: string;
  /** Exact, explicitly reviewed model capabilities; unknown is not sufficient. */
  models: ReadonlyArray<ProviderModelCapabilities>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Injected in contract tests, never sourced from an HTTP request. */
  fetcher?: typeof fetch;
  /** Some providers use max_completion_tokens instead of max_tokens. */
  tokenParameter?: 'max_tokens' | 'max_completion_tokens';
}

/** Safe to surface/log; intentionally carries no provider message or response body. */
export class ProviderAdapterError extends Error {
  readonly failure: ProviderFailure;
  constructor(failure: ProviderFailure) {
    super('AI provider ' + failure.kind);
    this.name = 'ProviderAdapterError';
    this.failure = failure;
  }
}

function invalid(): never {
  throw new ProviderAdapterError({ kind: 'invalid_request', retryable: false });
}

function malformed(): never {
  throw new ProviderAdapterError({ kind: 'unknown', retryable: false });
}

function buildEndpoint(config: OpenAiCompatibleChatConfig): string {
  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.length === 0) return invalid();
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    return invalid();
  }
  // Local HTTP support requires an explicit, separately reviewed K07/K19 transport.
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return invalid();
  const authorized = config.allowedOrigins.some(entry => {
    try {
      const allowed = new URL(entry);
      return allowed.protocol === 'https:' && !allowed.username && !allowed.password &&
        !allowed.search && !allowed.hash && allowed.pathname === '/' && allowed.origin === url.origin;
    } catch {
      return false;
    }
  });
  if (!authorized) return invalid();
  const basePath = url.pathname.replace(/\/+$/g, '');
  if (basePath.endsWith('/chat/completions')) return invalid();
  url.pathname = (basePath || '') + '/chat/completions';
  return url.toString();
}

function validateRequest(
  request: ProviderGenerationRequest,
  models: ReadonlyArray<ProviderModelCapabilities>
): void {
  if (!request || typeof request.taskKey !== 'string' || !request.taskKey.trim() ||
      typeof request.modelId !== 'string' || !request.modelId.trim() ||
      !Array.isArray(request.messages) || request.messages.length === 0 ||
      request.messages.length > 64) return invalid();
  const allowedModel = models.find(model => model.modelId === request.modelId);
  if (!allowedModel || allowedModel.evidence === 'unknown' ||
      !allowedModel.supported.includes('text')) {
    throw new ProviderAdapterError({ kind: 'unsupported', retryable: false });
  }
  let aggregate = 0;
  for (const message of request.messages) {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' || message.content.length === 0 ||
        message.content.length > 65536) return invalid();
    aggregate += message.content.length;
  }
  if (aggregate > 262144) return invalid();
  const tokens = request.maxOutputTokens;
  if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > 8192)) {
    return invalid();
  }
}

async function readBoundedBody(response: Response, limit: number): Promise<string> {
  const len = response.headers.get('content-length');
  if (len !== null && Number.isFinite(Number(len)) && Number(len) > limit) return malformed();
  if (!response.body) return malformed();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      size += chunk.byteLength;
      if (size > limit) return malformed();
      parts.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts).toString('utf8');
}

function parseChatResponse(raw: string, requestedModel: string): ProviderGenerationResult {
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return malformed();
  }
  const first = payload?.choices?.[0];
  if (!first || typeof first?.message?.content !== 'string') return malformed();
  const actualModel = typeof payload.model === 'string' && payload.model.trim()
    ? payload.model : requestedModel;
  const rawFinish = first.finish_reason;
  const finishReason: ProviderGenerationResult['finishReason'] = rawFinish === 'stop'
    ? 'stop'
    : rawFinish === 'length' ? 'length'
    : rawFinish === 'content_filter' || rawFinish === 'refusal' ? 'refused'
    : 'unknown';
  const usage = payload?.usage;
  const safeCount = (x: unknown): number | undefined =>
    typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : undefined;
  const inputTokens = safeCount(usage?.prompt_tokens);
  const outputTokens = safeCount(usage?.completion_tokens);
  const result: ProviderGenerationResult = {
    modelId: actualModel,
    text: first.message.content,
    finishReason,
  };
  if (inputTokens !== undefined || outputTokens !== undefined) {
    result.usage = { inputTokens, outputTokens };
  }
  return result;
}

/**
 * Creates a transport for a single preapproved endpoint. No automatic retries,
 * failover, redirected requests, model discovery or network probing occur.
 */
export function createOpenAiCompatibleChatAdapter(config: OpenAiCompatibleChatConfig): ProviderAdapter {
  const endpoint = buildEndpoint(config);
  const timeoutMs = config.timeoutMs ?? 30000;
  const maxResponseBytes = config.maxResponseBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 ||
      maxResponseBytes > 4 * 1024 * 1024) return invalid();
  const fetcher = config.fetcher ?? fetch;
  return {
    kind: 'openai_compatible_chat',
    async generate(request, options) {
      validateRequest(request, config.models);
      if (options?.signal?.aborted) {
        throw new ProviderAdapterError({ kind: 'cancelled', retryable: false });
      }
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      options?.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const body: Record<string, unknown> = {
          model: request.modelId,
          messages: request.messages,
          stream: false,
        };
        if (request.maxOutputTokens !== undefined) {
          body[config.tokenParameter ?? 'max_tokens'] = request.maxOutputTokens;
        }
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (config.apiKey) headers.authorization = 'Bearer ' + config.apiKey;
        const response = await fetcher(endpoint, {
          method: 'POST',
          redirect: 'error', // prevent credential forwarding to a redirect target
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        // Never read/error-log the provider's HTTP error response.
        if (!response.ok) throw new ProviderAdapterError(classifyProviderFailure({ status: response.status }));
        const raw = await readBoundedBody(response, maxResponseBytes);
        return parseChatResponse(raw, request.modelId);
      } catch (error) {
        if (error instanceof ProviderAdapterError) throw error;
        if (options?.signal?.aborted) {
          throw new ProviderAdapterError({ kind: 'cancelled', retryable: false });
        }
        if (timedOut) {
          throw new ProviderAdapterError({ kind: 'timeout', retryable: true });
        }
        // No raw exception message, provider payload, headers, URL or cause escapes.
        throw new ProviderAdapterError(classifyProviderFailure(error));
      } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener('abort', abort);
      }
    },
  };
}
