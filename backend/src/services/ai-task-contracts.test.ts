import { describe, expect, it } from 'vitest';
import {
  AiTaskContractError, buildPublicUiTranslationMessages,
  parsePublicUiTranslationDraft, validatePublicUiTranslationTask,
} from './ai-task-contracts.js';
import type { ProviderGenerationResult } from './ai-provider-contract.js';

const source = {
  taskKey: 'ui_translation', version: 1, tenantId: 'tenant-a',
  dataClass: 'public', sourceLocale: 'de', targetLocale: 'en',
  input: { text: 'Meldung {{ticketNumber}} erhalten' },
} as const;
const result: ProviderGenerationResult = {
  modelId: 'approved-model',
  text: JSON.stringify({ language: 'en', translation: 'Report {{ticketNumber}} received' }),
  finishReason: 'stop',
};
function fails(operation: () => unknown, code: AiTaskContractError['code']) {
  try {
    operation();
    throw Error('Expected failure');
  } catch (err) {
    expect(err).toBeInstanceOf(AiTaskContractError);
    if (err instanceof AiTaskContractError) {
      expect(err.code).toBe(code);
      expect(err.message).toBe('AI task ' + code);
    }
  }
}
describe('K08: public UI translation task v1', () => {
  it('builds a system instruction and isolated, JSON-encoded public text', () => {
    expect(validatePublicUiTranslationTask(source)).toEqual(source);
    const messages = buildPublicUiTranslationMessages(source);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(JSON.parse(messages[1].content)).toEqual({
      sourceLocale: 'de', targetLocale: 'en', text: source.input.text,
    });
  });
  it('creates only an unreviewed, structurally validated draft', () => {
    expect(parsePublicUiTranslationDraft(source, result)).toEqual({
      taskKey: 'ui_translation', version: 1, status: 'unreviewed',
      targetLocale: 'en', translatedText: 'Report {{ticketNumber}} received',
      modelId: 'approved-model',
    });
  });
  it.each([
    { ...source, version: 2 },
    { ...source, taskKey: 'classification' },
    { ...source, dataClass: 'personal' },
    { ...source, sourceLocale: 'de', targetLocale: 'de' },
    { ...source, sourceLocale: 'xx' },
    { ...source, tenantId: '' },
    { ...source, tenantId: '../tenant' },
    { ...source, input: { text: '' } },
    { ...source, input: { text: ' x' } },
    { ...source, input: { text: 'x\nmalicious header' } },
    { ...source, input: { text: '<img src=x>' } },
    { ...source, input: { text: 'x'.repeat(2001) } },
    { ...source, input: { text: 'Bad {{placeholder' } },
    { ...source, input: { text: 'Bad {{unknown!}}' } },
    { ...source, input: { text: 'x', privateContext: 'do-not-send' } },
    { ...source, userPrompt: 'override the provider' },
  ])('rejects malformed, sensitive and extra-field inputs', payload => {
    fails(() => validatePublicUiTranslationTask(payload), 'invalid_input');
  });
  it.each([
    { ...result, finishReason: 'length' as const },
    { ...result, finishReason: 'refused' as const },
    { ...result, finishReason: 'unknown' as const },
  ])('rejects incomplete generations', output => {
    fails(() => parsePublicUiTranslationDraft(source, output), 'incomplete_output');
  });
  it.each([
    'not-json',
    '~~~json\n{"language":"en","translation":"Hello"}',
    JSON.stringify({ language: 'de', translation: 'Meldung erhalten' }),
    JSON.stringify({ language: 'en', translation: '' }),
    JSON.stringify({ language: 'en', translation: 'Hello', extra: 'untrusted' }),
    JSON.stringify({ language: 'en', translation: 'Missing placeholder' }),
    JSON.stringify({ language: 'en', translation: 'Changed {{other}} token' }),
    JSON.stringify({ language: 'en', translation: '{{ticketNumber}} {{ticketNumber}}' }),
    JSON.stringify({ language: 'en', translation: '<script>alert(1)</script>' }),
    JSON.stringify({ language: 'en', translation: 'Trailing whitespace ' }),
    JSON.stringify({ language: 'en', translation: 'a'.repeat(4001) }),
    JSON.stringify({ language: 'en', translation: 'Unbalanced {{token' }),
  ])('rejects malformed JSON, markup and corrupted placeholders', text => {
    fails(() => parsePublicUiTranslationDraft(source, { ...result, text }), 'invalid_output');
  });
  it('denies missing model, without leaking raw input', () => {
    fails(() => parsePublicUiTranslationDraft(source, { ...result, modelId: '' }), 'invalid_output');
    fails(() => validatePublicUiTranslationTask({ ...source, secret: 'private-metadata' }), 'invalid_input');
  });
  it('preserves the set and multiplicity of template placeholders', () => {
    const task = { ...source, input: { text: 'Status {{first}} / {{second}}' } };
    const out = { ...result, text: JSON.stringify({
      language: 'en', translation: 'Status {{second}} / {{first}}',
    }) };
    expect(parsePublicUiTranslationDraft(task, out).status).toBe('unreviewed');
  });
});
