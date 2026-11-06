/**
 * K18/K06: read-only compatibility plan for one low-risk legacy LLM Hub task.
 *
 * This does not execute an AI call, resolve any credential or mutate a setting.
 * Inputs named "approval" and "grant" MUST originate from trusted server-side
 * operator configuration and authenticated RBAC, never from a browser payload.
 * Pilot mode only supports public UI translation, never citizen/tenant records.
 */
import type { LlmHubState } from './llm-hub.js';
import type { ProviderModelCapabilities } from './ai-provider-contract.js';
import { assessModelSupport } from './ai-model-capabilities.js';
import { assessProviderEndpoint } from './ai-provider-endpoint.js';
import {
  assessAiEgress, type AiTenantEgressGrant,
} from './ai-egress-policy.js';

export interface LlmHubPilotApproval {
  /** Exact trusted tenant/connection/task tuple, not a wildcard policy. */
  tenantId: string;
  connectionId: string;
  taskKey: string;
  providerId: string;
  region: string;
  baseUrl: string;
  modelId: string;
  credentialRef: string;
  allowedOrigins: ReadonlyArray<string>;
  models: ReadonlyArray<ProviderModelCapabilities>;
}

export interface LlmHubPilotRequest {
  tenantId: string;
  taskKey: string;
  dataClass: 'public' | 'internal' | 'personal' | 'special_category';
  actorAuthorized: boolean;
  aiModuleEnabled: boolean;
  networkEgressApproved: boolean;
  approval: LlmHubPilotApproval;
  grant: AiTenantEgressGrant;
  nowMs?: number;
}

export type LlmHubPilotReason =
  | 'disabled' | 'task_not_supported' | 'route_not_configured'
  | 'connection_unavailable' | 'connection_not_approved'
  | 'model_not_approved' | 'legacy_secret_present'
  | 'model_capability_unverified' | 'endpoint_denied'
  | 'data_egress_denied' | 'eligible_for_staging_review';

export type LlmHubPilotDecision =
  | { eligible: false; reason: Exclude<LlmHubPilotReason, 'eligible_for_staging_review'> }
  | {
      eligible: true;
      reason: 'eligible_for_staging_review';
      /** Non-secret information only; never export saved LLM Hub connections. */
      route: { taskKey: 'ui_translation'; connectionId: string; modelId: string };
    };

const deny = (reason: Exclude<LlmHubPilotReason, 'eligible_for_staging_review'>):
  LlmHubPilotDecision => ({ eligible: false, reason });

/**
 * Plan only. Unlike legacy resolveLlmRuntimeSelection this deliberately uses
 * NO default-route, first-enabled-connection or default-model fallback.
 */
export function assessLlmHubPilotEligibility(
  state: LlmHubState | null | undefined,
  input: LlmHubPilotRequest
): LlmHubPilotDecision {
  if (!input || input.taskKey !== 'ui_translation' || input.dataClass !== 'public') {
    return deny('task_not_supported');
  }
  if (!state || !Array.isArray(state.connections) ||
      !state.taskRouting || !state.taskRouting.routes ||
      !Object.prototype.hasOwnProperty.call(state.taskRouting.routes, input.taskKey)) {
    return deny('route_not_configured');
  }
  const route = state.taskRouting.routes[input.taskKey];
  if (!route || typeof route.connectionId !== 'string' ||
      !route.connectionId.trim() || typeof route.modelId !== 'string' ||
      !route.modelId.trim()) return deny('route_not_configured');

  const matching = state.connections.filter(entry => entry?.id === route.connectionId);
  if (matching.length !== 1 || matching[0].enabled !== true) {
    return deny('connection_unavailable');
  }
  const connection = matching[0];
  const approval = input.approval;
  if (!approval ||
      approval.tenantId !== input.tenantId ||
      approval.taskKey !== 'ui_translation' ||
      approval.connectionId !== route.connectionId ||
      approval.providerId?.trim() !== approval.providerId ||
      !approval.providerId || approval.region?.trim() !== approval.region ||
      !approval.region || connection.providerType !== 'openai_compatible') {
    return deny('connection_not_approved');
  }
  if (approval.modelId !== route.modelId ||
      !/^ai-provider\/[a-z0-9][a-z0-9-]{1,63}$/.test(approval.credentialRef)) {
    return deny('model_not_approved');
  }
  // Never treat saved legacy API keys/OAuth tokens as if migrated to K03 refs.
  if (connection.apiKey || connection.oauthTokenId || connection.authMode !== 'api_key') {
    return deny('legacy_secret_present');
  }
  const selected = approval.models?.find(model => model?.modelId === route.modelId);
  if (!assessModelSupport(selected, ['text'], { nowMs: input.nowMs }).allowed) {
    return deny('model_capability_unverified');
  }
  const legacyEndpoint = assessProviderEndpoint(connection.baseUrl, approval.allowedOrigins);
  const approvedEndpoint = assessProviderEndpoint(approval.baseUrl, approval.allowedOrigins);
  if (!legacyEndpoint.allowed || !approvedEndpoint.allowed ||
      legacyEndpoint.endpoint !== approvedEndpoint.endpoint) {
    return deny('endpoint_denied');
  }
  const policy = assessAiEgress({
    tenantId: input.tenantId,
    taskKey: 'ui_translation',
    providerId: approval.providerId,
    region: approval.region,
    dataClass: 'public',
    actorAuthorized: input.actorAuthorized,
    aiModuleEnabled: input.aiModuleEnabled,
    networkEgressApproved: input.networkEgressApproved,
  }, input.grant, input.nowMs);
  if (!policy.allowed) return deny('data_egress_denied');
  return {
    eligible: true,
    reason: 'eligible_for_staging_review',
    route: {
      taskKey: 'ui_translation',
      connectionId: connection.id,
      modelId: route.modelId,
    },
  };
}
