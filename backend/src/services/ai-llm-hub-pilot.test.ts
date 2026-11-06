import { describe, expect, it } from 'vitest';
import { assessLlmHubPilotEligibility, type LlmHubPilotRequest } from './ai-llm-hub-pilot.js';
import type { LlmHubState } from './llm-hub.js';

const NOW = Date.parse('2026-11-06T13:00:00Z');
const state: LlmHubState = {
  connections: [{
    id: 'connection-a', name: 'Approved backend', providerType: 'openai_compatible',
    baseUrl: 'https://ai.example.invalid/v1', authMode: 'api_key',
    apiKey: '', oauthTokenId: '', enabled: true, defaultModel: 'model-a',
    models: [{ id: 'model-a', label: 'Model A', vision: true,
      tts: false, imageGeneration: false, updatedAt: '' }],
    modelsFetchedAt: '', createdAt: '', updatedAt: '',
  }],
  taskRouting: {
    defaultRoute: { connectionId: 'connection-a', modelId: 'model-a' },
    routes: { ui_translation: { connectionId: 'connection-a', modelId: 'model-a' } },
  },
  chatbotSettings: {} as LlmHubState['chatbotSettings'],
};
const request: LlmHubPilotRequest = {
  tenantId: 'tenant-a', taskKey: 'ui_translation', dataClass: 'public',
  actorAuthorized: true, aiModuleEnabled: true, networkEgressApproved: true,
  nowMs: NOW,
  approval: {
    tenantId: 'tenant-a', taskKey: 'ui_translation',
    connectionId: 'connection-a', providerId: 'cloud-eu', region: 'eu',
    baseUrl: 'https://ai.example.invalid/v1', modelId: 'model-a',
    credentialRef: 'ai-provider/cloud-eu',
    allowedOrigins: ['https://ai.example.invalid'],
    models: [{ modelId: 'model-a', supported: ['text'], evidence: 'declared' }],
  },
  grant: {
    tenantId: 'tenant-a', enabled: true,
    allowedTasks: ['ui_translation'], allowedProviders: ['cloud-eu'],
    allowedRegions: ['eu'], allowedDataClasses: ['public'],
    expiresAt: '2027-01-01T00:00:00Z',
  },
};
const check = (s: LlmHubState | null | undefined = state, r: LlmHubPilotRequest = request) =>
  assessLlmHubPilotEligibility(s, r);

describe('K18: legacy LLM Hub -> governed pilot, read-only and fail-closed', () => {
  it('allows only an explicitly approved public UI translation for a staging review', () => {
    expect(check()).toEqual({
      eligible: true, reason: 'eligible_for_staging_review',
      route: { taskKey: 'ui_translation', connectionId: 'connection-a', modelId: 'model-a' },
    });
    expect(JSON.stringify(check())).not.toContain('apiKey');
  });

  it.each([
    ['internal task', { taskKey: 'classification' }],
    ['image analysis', { taskKey: 'image_to_text' }],
    ['personal data', { dataClass: 'personal' }],
    ['special-category data', { dataClass: 'special_category' }],
  ] as const)('does not pilot %s', (_what, changes) => {
    expect(check(state, { ...request, ...changes }).reason).toBe('task_not_supported');
  });

  it('never silently uses the default task route', () => {
    const s = {
      ...state, taskRouting: {
        ...state.taskRouting, routes: {},
      },
    };
    expect(check(s).reason).toBe('route_not_configured');
    expect(check(null).reason).toBe('route_not_configured');
  });

  it('does not substitute the first enabled connection or an unconfigured model', () => {
    const s = {
      ...state, taskRouting: {
        ...state.taskRouting, routes: {
          ui_translation: { connectionId: 'missing', modelId: 'model-a' },
        },
      },
    };
    expect(check(s).reason).toBe('connection_unavailable');
    expect(check({
      ...state, taskRouting: { ...state.taskRouting,
        routes: { ui_translation: { connectionId: 'connection-a', modelId: '' } },
      },
    }).reason).toBe('route_not_configured');
  });

  it('fails closed if a connection is disabled or duplicated', () => {
    expect(check({ ...state, connections: [{ ...state.connections[0], enabled: false }] })
      .reason).toBe('connection_unavailable');
    expect(check({ ...state, connections: [state.connections[0], state.connections[0]] })
      .reason).toBe('connection_unavailable');
  });

  it('rejects any connection/tenant/task mismatch with the approved configuration', () => {
    expect(check(state, { ...request, tenantId: 'tenant-b' }).reason).toBe('connection_not_approved');
    expect(check(state, { ...request, approval: {
      ...request.approval, connectionId: 'other',
    } }).reason).toBe('connection_not_approved');
    expect(check(state, { ...request, approval: {
      ...request.approval, taskKey: 'classification',
    } }).reason).toBe('connection_not_approved');
  });

  it('refuses a different model or malformed credential reference', () => {
    expect(check(state, { ...request, approval: {
      ...request.approval, modelId: 'model-b',
    } }).reason).toBe('model_not_approved');
    expect(check(state, { ...request, approval: {
      ...request.approval, credentialRef: 'api-key=secret',
    } }).reason).toBe('model_not_approved');
  });

  it('never treats a legacy saved API key or OAuth token as migrated', () => {
    const modified = (values: Partial<LlmHubState['connections'][number]>) =>
      check({ ...state, connections: [{ ...state.connections[0], ...values }] });
    expect(modified({ apiKey: 'synthetic-token' }).reason).toBe('legacy_secret_present');
    expect(modified({ authMode: 'oauth', oauthTokenId: 'saved-oauth' }).reason)
      .toBe('legacy_secret_present');
  });

  it('does not infer capabilities from legacy Vision flags or marketing model names', () => {
    expect(check(state, { ...request, approval: {
      ...request.approval,
      models: [{ modelId: 'model-a', evidence: 'unknown', supported: ['text', 'vision'] }],
    } }).reason).toBe('model_capability_unverified');
    expect(check(state, { ...request, approval: {
      ...request.approval,
      models: [{ modelId: 'model-a', evidence: 'declared', supported: ['vision'] }],
    } }).reason).toBe('model_capability_unverified');
  });

  it('rejects expired probes, even if the legacy model still looks current', () => {
    expect(check(state, { ...request, approval: {
      ...request.approval,
      models: [{ modelId: 'model-a', evidence: 'probed', supported: ['text'],
        observedAt: '2026-10-01T00:00:00Z' }],
    } }).reason).toBe('model_capability_unverified');
  });

  it('rejects endpoint and approved base-url mismatches', () => {
    expect(check({ ...state, connections: [{
      ...state.connections[0], baseUrl: 'https://other.invalid/v1',
    }] }).reason).toBe('endpoint_denied');
    expect(check(state, { ...request, approval: {
      ...request.approval, baseUrl: 'https://ai.example.invalid/other',
    } }).reason).toBe('endpoint_denied');
  });

  it.each([
    ['actor', { actorAuthorized: false }],
    ['module-off', { aiModuleEnabled: false }],
    ['network-unapproved', { networkEgressApproved: false }],
  ] as const)('applies K16 egress checks: %s', (_what, changes) => {
    expect(check(state, { ...request, ...changes }).reason).toBe('data_egress_denied');
  });

  it('rejects missing tenant grant, expired approval or unauthorized destination', () => {
    expect(check(state, { ...request, grant: {
      ...request.grant, tenantId: 'other-tenant',
    } }).reason).toBe('data_egress_denied');
    expect(check(state, { ...request, grant: {
      ...request.grant, expiresAt: '2025-11-06T12:00:00Z',
    } }).reason).toBe('data_egress_denied');
    expect(check(state, { ...request, grant: {
      ...request.grant, allowedProviders: [],
    } }).reason).toBe('data_egress_denied');
  });

  it('contains no credential or prompt even when the stored connection does', () => {
    const saved = { ...state, connections: [{
      ...state.connections[0], apiKey: 'DO_NOT_DISCLOSE_SECRET',
    }] };
    const result = check(saved);
    expect(result.reason).toBe('legacy_secret_present');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_DISCLOSE_SECRET');
    expect(JSON.stringify(result)).not.toContain('oauthTokenId');
  });
});
