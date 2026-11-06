import { describe, expect, it } from 'vitest';
import { assessAiEgress, type AiEgressContext, type AiTenantEgressGrant } from './ai-egress-policy.js';

const now = Date.parse('2026-11-06T12:00:00Z');
const context: AiEgressContext = {
  tenantId: 't1', taskKey: 'classification', providerId: 'cloud-eu',
  region: 'eu', dataClass: 'personal',
  aiModuleEnabled: true, actorAuthorized: true, networkEgressApproved: true,
};
const grant: AiTenantEgressGrant = {
  tenantId: 't1', enabled: true, allowedTasks: ['classification'],
  allowedProviders: ['cloud-eu'], allowedRegions: ['eu'],
  allowedDataClasses: ['public', 'internal', 'personal'],
  privacyReviewRef: 'approved-dataflow-2026', expiresAt: '2027-11-06T12:00:00Z',
};
describe('K16: tenant/task/provider/data-class egress policy', () => {
  it('accepts only a completely authorized, reviewed and unexpired route', () => {
    expect(assessAiEgress(context, grant, now)).toEqual({
      allowed: true, reason: 'allowed',
    });
  });
  it.each([
    [{ actorAuthorized: false }, 'not_authorized'],
    [{ aiModuleEnabled: false }, 'module_off'],
    [{ networkEgressApproved: false }, 'network_unapproved'],
    [{ tenantId: 't2' }, 'tenant_mismatch'],
    [{ taskKey: 'translate' }, 'task_not_approved'],
    [{ providerId: 'other-cloud' }, 'provider_not_approved'],
    [{ region: 'us' }, 'region_not_approved'],
    [{ dataClass: 'special_category' }, 'data_not_approved'],
  ] as const)('fails closed on a context mismatch: %s', (change, reason) => {
    expect(assessAiEgress({ ...context, ...change }, grant, now)).toEqual({
      allowed: false, reason,
    });
  });
  it('does not allow external use if the grant is disabled or expired', () => {
    expect(assessAiEgress(context, { ...grant, enabled: false }, now).reason).toBe('grant_inactive');
    expect(assessAiEgress(context, { ...grant, expiresAt: '2026-11-06T12:00:00Z' }, now).reason).toBe('grant_expired');
    expect(assessAiEgress(context, { ...grant, expiresAt: 'bad-date' }, now).reason).toBe('grant_expired');
  });
  it('requires explicit privacy review for personal data', () => {
    expect(assessAiEgress(context, { ...grant, privacyReviewRef: '' }, now).reason).toBe('privacy_review_required');
    expect(assessAiEgress(context, { ...grant, privacyReviewRef: ' ' }, now).reason).toBe('privacy_review_required');
    expect(assessAiEgress({ ...context, dataClass: 'public' },
      { ...grant, privacyReviewRef: '' }, now).allowed).toBe(true);
  });
  it('does not let a grant enable data classes that were never approved', () => {
    expect(assessAiEgress(context, { ...grant, allowedDataClasses: ['public'] }, now).reason).toBe('data_not_approved');
    expect(assessAiEgress({ ...context, dataClass: 'special_category' },
      { ...grant, allowedDataClasses: ['special_category'], privacyReviewRef: 'review' }, now).allowed).toBe(false);
  });
  it('never implies a wildcard permission or defaults to enabled', () => {
    expect(assessAiEgress(context, { ...grant, allowedProviders: ['*'] }, now).allowed).toBe(false);
    expect(assessAiEgress(context, { ...grant, allowedTasks: [] }, now).allowed).toBe(false);
    expect(assessAiEgress({ ...context, actorAuthorized: undefined as any }, grant, now).allowed).toBe(false);
  });
  it('denies malformed tenant and data-class inputs without sensitive diagnostics', () => {
    expect(assessAiEgress({ ...context, tenantId: ' t1 ' }, grant, now).reason).toBe('invalid_context');
    expect(assessAiEgress({ ...context, dataClass: 'other' as any }, grant, now).reason).toBe('invalid_context');
    expect(assessAiEgress(context, { ...grant, allowedTasks: undefined as any }, now).reason).toBe('invalid_context');
  });
});
