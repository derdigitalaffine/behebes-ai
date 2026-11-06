/**
 * K03/K07/K16: governed, opt-in facade for the isolated K02 chat adapter.
 *
 * This is NOT installed in the existing LLM Hub. The application must supply
 * trusted tenant/task/actor policies and an independently restricted egress
 * transport before it can be integrated. No inline credential values are
 * accepted as connection metadata.
 */
import {
  createOpenAiCompatibleChatAdapter,
  ProviderAdapterError,
} from './ai-provider-adapter.js';
import { assessProviderEndpoint } from './ai-provider-endpoint.js';
import {
  assessAiEgress, type AiEgressContext, type AiTenantEgressGrant,
} from './ai-egress-policy.js';
import type {
  ProviderGenerationRequest, ProviderGenerationResult, ProviderModelCapabilities,
} from './ai-provider-contract.js';

export interface AiConnectionDescriptor {
  id: string;
  providerId: string;
  region: string;
  baseUrl: string;
  allowedOrigins: ReadonlyArray<string>;
  /** Identifier of a server-side stored secret, not the secret itself. */
  credentialRef: string;
  models: ReadonlyArray<ProviderModelCapabilities>;
  timeoutMs?: number;
}

export interface AiCredentialResolver {
  /** Trusted server-side resolver; must never call a user-controlled URL. */
  resolve(ref: string): Promise<string | null>;
}

export class AiGatewayError extends Error {
  constructor(readonly code:
    'policy_denied' | 'endpoint_denied' | 'credential_unavailable') {
    super('AI gateway ' + code);
    this.name = 'AiGatewayError';
  }
}

export interface GovernedGeneration {
  connection: AiConnectionDescriptor;
  context: AiEgressContext;
  grant: AiTenantEgressGrant;
  request: ProviderGenerationRequest;
  credentials: AiCredentialResolver;
  signal?: AbortSignal;
  /** Synthetic transport only; production transport needs K07 egress controls. */
  fetcher?: typeof fetch;
  nowMs?: number;
}

/** No fallback: every potential provider destination needs a NEW policy decision. */
export async function generateGovernedChat(
  input: GovernedGeneration
): Promise<ProviderGenerationResult> {
  const { connection, context, grant, request } = input;
  if (!connection || !context || connection.id.length === 0 ||
      context.providerId !== connection.providerId || context.region !== connection.region ||
      context.taskKey !== request?.taskKey) {
    throw new AiGatewayError('policy_denied');
  }
  const decision = assessAiEgress(context, grant, input.nowMs);
  if (!decision.allowed) throw new AiGatewayError('policy_denied');
  if (!assessProviderEndpoint(connection.baseUrl, connection.allowedOrigins).allowed) {
    throw new AiGatewayError('endpoint_denied');
  }
  if (!/^ai-provider\/[a-z0-9][a-z0-9-]{1,63}$/.test(connection.credentialRef)) {
    throw new AiGatewayError('credential_unavailable');
  }
  // Resolve only AFTER policy and endpoint validation. No secret in audit/UI.
  let token: string | null;
  try {
    token = await input.credentials.resolve(connection.credentialRef);
  } catch {
    throw new AiGatewayError('credential_unavailable');
  }
  if (typeof token !== 'string' || !token.trim() ||
      /[\u0000-\u001f\u007f]/.test(token)) {
    throw new AiGatewayError('credential_unavailable');
  }
  const adapter = createOpenAiCompatibleChatAdapter({
    baseUrl: connection.baseUrl,
    allowedOrigins: connection.allowedOrigins,
    models: connection.models,
    apiKey: token,
    timeoutMs: connection.timeoutMs,
    fetcher: input.fetcher,
  });
  try {
    return await adapter.generate(request, { signal: input.signal });
  } catch (error) {
    // The existing adapter already redacts provider exceptions.
    if (error instanceof ProviderAdapterError) throw error;
    throw new AiGatewayError('policy_denied');
  }
}
