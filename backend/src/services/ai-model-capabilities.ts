/**
 * K04: deterministic task-to-model capability gate.
 *
 * The inputs MUST originate from an authorized, server-side catalogue.
 * Never treat provider-supplied model names or marketing metadata as proof
 * of vision, tool-calling, JSON or other features.
 */
import type { ProviderCapability, ProviderModelCapabilities } from './ai-provider-contract.js';

export type ModelSupportReason =
  | 'eligible'
  | 'model_unavailable'
  | 'invalid_requirements'
  | 'unverified'
  | 'probe_expired'
  | 'capability_missing';

export interface ModelSupportDecision {
  allowed: boolean;
  reason: ModelSupportReason;
  /** Required features not explicitly present. No claims about other model functions. */
  missing: ProviderCapability[];
}

export interface ModelSupportOptions {
  /** Bound age for synthetic or server-side capability probes (default 24h). */
  maxProbeAgeMs?: number;
  /** For deterministic tests. Defaults to current time. */
  nowMs?: number;
}

const CAPABILITIES: ReadonlySet<ProviderCapability> = new Set<ProviderCapability>([
  'text', 'vision', 'structured_output', 'tool_calling', 'streaming', 'embeddings',
]);

const denied = (reason: ModelSupportReason, missing: ProviderCapability[] = []): ModelSupportDecision =>
  ({ allowed: false, reason, missing });

/**
 * A manually and explicitly operator-declared capability has no probe TTL.
 * A probed capability requires a fresh, valid observedAt. Unknown fails closed.
 * Neither this gate nor an allowlisted model grants Tenant/PII/Egress permissions.
 */
export function assessModelSupport(
  model: ProviderModelCapabilities | undefined | null,
  required: ReadonlyArray<ProviderCapability>,
  options: ModelSupportOptions = {}
): ModelSupportDecision {
  if (!Array.isArray(required) || required.length === 0 ||
      required.some(cap => !CAPABILITIES.has(cap))) {
    return denied('invalid_requirements');
  }
  if (!model || typeof model.modelId !== 'string' || !model.modelId.trim() ||
      !Array.isArray(model.supported) ||
      model.supported.some(cap => !CAPABILITIES.has(cap))) {
    return denied('model_unavailable', [...new Set(required)]);
  }
  if (model.evidence !== 'declared' && model.evidence !== 'probed') {
    return denied('unverified', [...new Set(required)]);
  }
  if (model.evidence === 'probed') {
    const nowMs = options.nowMs ?? Date.now();
    const maxAgeMs = options.maxProbeAgeMs ?? 24 * 60 * 60 * 1000;
    const observedAt = typeof model.observedAt === 'string'
      ? Date.parse(model.observedAt) : Number.NaN;
    if (!Number.isFinite(nowMs) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 ||
        !Number.isFinite(observedAt) || observedAt > nowMs + 60000 ||
        observedAt < nowMs - maxAgeMs) {
      return denied('probe_expired', [...new Set(required)]);
    }
  }
  const supported = new Set(model.supported);
  const missing = [...new Set(required)].filter(cap => !supported.has(cap));
  if (missing.length > 0) return denied('capability_missing', missing);
  return { allowed: true, reason: 'eligible', missing: [] };
}
