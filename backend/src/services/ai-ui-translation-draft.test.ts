import { describe, expect, it, vi } from 'vitest';
import { generatePublicUiTranslationDraft } from './ai-ui-translation-draft.js';
import { AiTaskContractError } from './ai-task-contracts.js';
import { createBoundAiCredentialResolver } from './ai-credentials.js';
import type { GovernedGeneration } from './ai-governed-gateway.js';

const task = {
  taskKey: 'ui_translation', version: 1, tenantId: 'tenant-a',
  dataClass: 'public', sourceLocale: 'de', targetLocale: 'en',
  input: { text: 'Status {{ticketNumber}}' },
};
const governance: Omit<GovernedGeneration, 'request'> = {
  connection: {
    id: 'conn-1', providerId: 'cloud-eu', region: 'eu',
    baseUrl: 'https://approved.example.invalid/v1',
    allowedOrigins: ['https://approved.example.invalid'],
    credentialRef: 'ai-provider/cloud-eu',
    models: [{ modelId: 'model-a', supported: ['text'], evidence: 'declared' }],
  },
  context: {
    tenantId: 'tenant-a', taskKey: 'ui_translation', providerId: 'cloud-eu',
    region: 'eu', dataClass: 'public', actorAuthorized: true,
    aiModuleEnabled: true, networkEgressApproved: true,
  },
  grant: {
    tenantId: 'tenant-a', enabled: true, allowedTasks: ['ui_translation'],
    allowedProviders: ['cloud-eu'], allowedRegions: ['eu'],
    allowedDataClasses: ['public'], expiresAt: '2027-11-01T00:00:00Z',
  },
  credentials: { resolve: async () => 'synthetic-not-real' },
  nowMs: Date.parse('2026-11-06T12:00:00Z'),
};
const success = () => new Response(JSON.stringify({
  model: 'model-a',
  choices: [{
    message: { content: JSON.stringify({
      language: 'en', translation: 'Status {{ticketNumber}}',
    }) },
    finish_reason: 'stop',
  }],
}), { status: 200 });
describe('K08: governed public UI translation draft (offline fake transport)', () => {
  it('validates input, credentials, egress, output and returns an unreviewed draft', async () => {
    const read = vi.fn(() => 'synthetic-key');
    const credentials = createBoundAiCredentialResolver([{
      ref: 'ai-provider/cloud-eu', tenantId: 'tenant-a', providerId: 'cloud-eu',
      connectionId: 'conn-1', secretKey: 'AI_PROVIDER_CLOUD_EU',
    }], { read });
    const fetcher = vi.fn(async () => success());
    const draft = await generatePublicUiTranslationDraft({
      task, governance: { ...governance,
        credentials, fetcher: fetcher as unknown as typeof fetch,
      },
      modelId: 'model-a',
    });
    expect(draft).toEqual({
      taskKey: 'ui_translation', version: 1, status: 'unreviewed',
      targetLocale: 'en', translatedText: 'Status {{ticketNumber}}', modelId: 'model-a',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [_endpoint, opts] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(opts.body));
    expect(payload.model).toBe('model-a');
    expect(JSON.parse(payload.messages[1].content).text).toBe(task.input.text);
    expect(JSON.stringify(draft)).not.toContain('synthetic-key');
  });
  it.each([
    ['tenant mismatch', { ...governance, context: { ...governance.context, tenantId: 'tenant-b' } }],
    ['wrong task', { ...governance, context: { ...governance.context, taskKey: 'classification' } }],
    ['personal data', { ...governance, context: { ...governance.context, dataClass: 'personal' as const } }],
  ])('refuses %s before reading a credential or sending a request', async (_name, context) => {
    const resolve = vi.fn(async () => 'synthetic-key');
    const fetcher = vi.fn(async () => success());
    await expect(generatePublicUiTranslationDraft({
      task, governance: { ...context, credentials: { resolve },
        fetcher: fetcher as unknown as typeof fetch },
      modelId: 'model-a',
    })).rejects.toBeInstanceOf(AiTaskContractError);
    expect(resolve).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses extra prompt fields before contacting provider or secret store', async () => {
    const resolve = vi.fn(async () => 'synthetic-key');
    const fetcher = vi.fn(async () => success());
    await expect(generatePublicUiTranslationDraft({
      task: { ...task, privateMessage: 'do-not-send' },
      governance: { ...governance, credentials: { resolve },
        fetcher: fetcher as unknown as typeof fetch },
      modelId: 'model-a',
    })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(resolve).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects provider outputs that violate the approved schema', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"language":"en","translation":"wrong"}' },
        finish_reason: 'stop' }],
    }), { status: 200 }));
    await expect(generatePublicUiTranslationDraft({
      task, governance: { ...governance, fetcher: fetcher as unknown as typeof fetch },
      modelId: 'model-a',
    })).rejects.toMatchObject({ code: 'invalid_output' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
