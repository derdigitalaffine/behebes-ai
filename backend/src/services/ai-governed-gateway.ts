/**
 * K03/K07/K16: governed, opt-in facade for the isolated K02 chat adapter.
 *
 * This is NOT installed in the existing LLM Hub. The application must supply
 * trusted tenant/task/actor policies and an independently restricted deployment
 * egress firewall before it can be integrated. No inline credential values are
 * accepted as connection metadata.
 */
import {
  createOpenAiCompatibleChatAdapter,
  ProviderAdapterError,
} from './ai-provider-adapter.js';
import { assessProviderEndpoint } from './ai-provider-endpoint.js';
import { createPinnedHttpsFetcher, resolvePinnedAiDestination, type AiDnsResolver } from './ai-pinned-egress.js';
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

export interface AiCredentialAccessContext {
  tenantId: string;
  providerId: string;
  connectionId: string;
}

export interface AiCredentialResolver {
  /** Trusted server-side resolver; must never call a user-controlled URL. */
  resolve(ref: string, context: AiCredentialAccessContext): Promise<string | null>;
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
  /** Fake transport for server-side unit tests ONLY; never accept from user input. */
  fetcher?: typeof fetch;
  /** Synthetic DNS resolver for internal tests only. Never expose through API requests. */
  dnsResolver?: AiDnsResolver;
  nowMs?: number;
}

/** No fallback: every potential provider destination needs a NEW policy decision. */
export async function generateGovernedChat(
  input: GovernedGeneration
): Promise<ProviderGenerationResult> {
  const { connection, context, grant, request } = input;
  if (!input || !connection || !context || !request ||
      typeof connection.id !== 'string' || !connection.id.trim() ||
      typeof connection.providerId !== 'string' || !connection.providerId.trim() ||
      typeof connection.region !== 'string' || !connection.region.trim() ||
      context.providerId !== connection.providerId || context.region !== connection.region ||
      context.taskKey !== request.taskKey) {
    throw new AiGatewayError('policy_denied');
  }
  const decision = assessAiEgress(context, grant, input.nowMs);
  if (!decision.allowed) throw new AiGatewayError('policy_denied');
  if (!assessProviderEndpoint(connection.baseUrl, connection.allowedOrigins).allowed) {
    throw new AiGatewayError('endpoint_denied');
  }
  // Runtime transport: resolve and vet every A/AAAA record before loading a
  // credential; pin the approved IP for TLS so DNS cannot change at connect.
  // A supplied fake fetcher is reserved for trusted deterministic test harnesses.
  let transport = input.fetcher;
  if (!transport) {
    try {
      const pinned = await resolvePinnedAiDestination(connection.baseUrl, connection.allowedOrigins, input.dnsResolver);
      transport = createPinnedHttpsFetcher(pinned);
    } catch {
      throw new AiGatewayError('endpoint_denied');
    }
  }
  if (!/^ai-provider\/[a-z0-9][a-z0-9-]{1,63}$/.test(connection.credentialRef)) {
    throw new AiGatewayError('credential_unavailable');
  }
  // Resolve only AFTER policy and endpoint validation. No secret in audit/UI.
  let token: string | null;
  try {
    token = await input.credentials.resolve(connection.credentialRef, {
      tenantId: context.tenantId,
      providerId: connection.providerId,
      connectionId: connection.id,
    });
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
    fetcher: transport,
  });
  try {
    return await adapter.generate(request, { signal: input.signal });
  } catch (error) {
    // The existing adapter already redacts provider exceptions.
    if (error instanceof ProviderAdapterError) throw error;
    throw new AiGatewayError('policy_denied');
  }
}
