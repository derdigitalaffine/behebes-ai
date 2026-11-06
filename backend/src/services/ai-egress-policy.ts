/**
 * K16: pure AI egress grant check, without raw citizen/prompt content.
 *
 * Both ctx and grant MUST be derived from server-verified RBAC, tenant,
 * task metadata and approved configuration, never directly from browser
 * request parameters. This function is NOT a legal data-transfer approval.
 */
export type AiDataClass = 'public' | 'internal' | 'personal' | 'special_category';

export interface AiEgressContext {
  tenantId: string;
  taskKey: string;
  providerId: string;
  region: string;
  dataClass: AiDataClass;
  /** Server-calculated effective policy, not the UI's visible switch. */
  aiModuleEnabled: boolean;
  actorAuthorized: boolean;
  /** An independently enforced outbound network boundary is in place. */
  networkEgressApproved: boolean;
}

export interface AiTenantEgressGrant {
  tenantId: string;
  enabled: boolean;
  allowedTasks: ReadonlyArray<string>;
  allowedProviders: ReadonlyArray<string>;
  allowedRegions: ReadonlyArray<string>;
  allowedDataClasses: ReadonlyArray<AiDataClass>;
  /** Valid approval / data-flow review ID held in trusted server configuration. */
  privacyReviewRef?: string;
  /** Refresh or revoke an approval by its expiration. */
  expiresAt: string;
}

export type AiEgressReason =
  | 'allowed' | 'invalid_context' | 'not_authorized' | 'module_off'
  | 'network_unapproved' | 'tenant_mismatch' | 'grant_inactive'
  | 'grant_expired' | 'task_not_approved' | 'provider_not_approved'
  | 'region_not_approved' | 'data_not_approved' | 'privacy_review_required';

export type AiEgressDecision =
  | { allowed: true; reason: 'allowed' }
  | { allowed: false; reason: Exclude<AiEgressReason, 'allowed'> };

const reject = (reason: Exclude<AiEgressReason, 'allowed'>): AiEgressDecision =>
  ({ allowed: false, reason });
const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.trim() === value &&
  value.length <= 160;
const validDataClasses: ReadonlySet<AiDataClass> = new Set([
  'public', 'internal', 'personal', 'special_category',
]);

export function assessAiEgress(
  ctx: AiEgressContext,
  grant: AiTenantEgressGrant,
  nowMs = Date.now()
): AiEgressDecision {
  if (!ctx || !grant ||
      ![ctx.tenantId, ctx.taskKey, ctx.providerId, ctx.region, grant.tenantId].every(isId) ||
      !validDataClasses.has(ctx.dataClass) || !Number.isFinite(nowMs) ||
      !Array.isArray(grant.allowedTasks) || !Array.isArray(grant.allowedProviders) ||
      !Array.isArray(grant.allowedRegions) || !Array.isArray(grant.allowedDataClasses)) {
    return reject('invalid_context');
  }
  if (ctx.actorAuthorized !== true) return reject('not_authorized');
  if (ctx.aiModuleEnabled !== true) return reject('module_off');
  if (ctx.networkEgressApproved !== true) return reject('network_unapproved');
  if (ctx.tenantId !== grant.tenantId) return reject('tenant_mismatch');
  if (grant.enabled !== true) return reject('grant_inactive');
  const expiry = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= nowMs) return reject('grant_expired');
  if (!grant.allowedTasks.includes(ctx.taskKey)) return reject('task_not_approved');
  if (!grant.allowedProviders.includes(ctx.providerId)) return reject('provider_not_approved');
  if (!grant.allowedRegions.includes(ctx.region)) return reject('region_not_approved');
  // Special-category citizen data needs a dedicated approved workflow.
  if (ctx.dataClass === 'special_category' ||
      !grant.allowedDataClasses.includes(ctx.dataClass)) return reject('data_not_approved');
  if (ctx.dataClass === 'personal' && !isId(grant.privacyReviewRef))
    return reject('privacy_review_required');
  return { allowed: true, reason: 'allowed' };
}
