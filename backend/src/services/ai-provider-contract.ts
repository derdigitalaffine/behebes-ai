/**
 * Dependency-free foundation for the planned provider adapter layer (K02).
 *
 * Not yet wired into the runtime LLM hub. Authorization, egress policy,
 * provider selection, budgeting and retries are separate guarded work items.
 * Never log the original provider error object, which may include PII.
 */
export type ProviderFailureKind =
  | 'cancelled' | 'timeout' | 'authentication' | 'forbidden'
  | 'rate_limited' | 'unavailable' | 'invalid_request'
  | 'unsupported' | 'network' | 'unknown';

export interface ProviderFailure {
  kind: ProviderFailureKind;
  retryable: boolean;
  /** The HTTP status only — never raw provider response or headers. */
  status?: number;
}

export type ProviderCapability =
  | 'text' | 'vision' | 'structured_output'
  | 'tool_calling' | 'streaming' | 'embeddings';

export interface ProviderModelCapabilities {
  modelId: string;
  /** Unprobed or unknown capabilities are not implicitly available. */
  supported: ReadonlyArray<ProviderCapability>;
  evidence: 'declared' | 'probed' | 'unknown';
  observedAt?: string;
}

export interface ProviderGenerationRequest {
  taskKey: string;
  modelId: string;
  /** The caller must authorize and minimize every message. */
  messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxOutputTokens?: number;
}

export interface ProviderGenerationResult {
  modelId: string;
  text: string;
  finishReason: 'stop' | 'length' | 'refused' | 'unknown';
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Pure error classification: no raw message, body, URL, token or header escapes. */
export function classifyProviderFailure(error: unknown): ProviderFailure {
  const record = error !== null && typeof error === 'object'
    ? error as Record<string, unknown> : {};
  const rawStatus = record.status ?? record.statusCode;
  const status = typeof rawStatus === 'number' && Number.isInteger(rawStatus) &&
    rawStatus >= 100 && rawStatus <= 599 ? rawStatus : undefined;
  const name = typeof record.name === 'string' ? record.name : '';
  const code = typeof record.code === 'string' ? record.code.toUpperCase() : '';
  const failure = (kind: ProviderFailureKind, retryable: boolean): ProviderFailure =>
    status === undefined ? { kind, retryable } : { kind, retryable, status };

  if (name === 'AbortError' || code === 'ABORT_ERR' || code === 'ERR_CANCELED')
    return failure('cancelled', false);
  if (name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' || status === 408 || status === 504)
    return failure('timeout', true);
  if (status === 401) return failure('authentication', false);
  if (status === 403) return failure('forbidden', false);
  if (status === 429) return failure('rate_limited', true);
  if (status === 404 || status === 501) return failure('unsupported', false);
  if (status !== undefined && status >= 500) return failure('unavailable', true);
  if (status !== undefined && status >= 400) return failure('invalid_request', false);
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code))
    return failure('network', true);
  return failure('unknown', false);
}
