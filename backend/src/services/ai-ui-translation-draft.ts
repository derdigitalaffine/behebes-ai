/**
 * K08 first vertical slice: a validated, human-review-only UI translation
 * built on the K02/K03/K04/K07/K16 governed provider gateway.
 *
 * Not installed in public/admin routes or the legacy AI queue. The caller must
 * pass server-verified actor/tenant/egress/grant and a trusted secret resolver.
 */
import {
  generateGovernedChat, type GovernedGeneration,
} from './ai-governed-gateway.js';
import {
  buildPublicUiTranslationMessages,
  parsePublicUiTranslationDraft,
  validatePublicUiTranslationTask,
  AiTaskContractError,
  type UiTranslationDraftV1,
} from './ai-task-contracts.js';

export interface UiTranslationDraftRequest {
  /** JSON input is untrusted until the versioned validator accepts it. */
  task: unknown;
  /** Trusted, server-authorized connection/policy; never accept from a client. */
  governance: Omit<GovernedGeneration, 'request'>;
  /** An exact operator-approved model; not inferred from incoming text. */
  modelId: string;
}

export async function generatePublicUiTranslationDraft(
  input: UiTranslationDraftRequest
): Promise<UiTranslationDraftV1> {
  if (!input || !input.governance) throw new AiTaskContractError('invalid_input');
  const task = validatePublicUiTranslationTask(input.task);
  const { context, connection } = input.governance;
  if (!context || !connection || task.tenantId !== context.tenantId ||
      context.taskKey !== 'ui_translation' || context.dataClass !== 'public' ||
      typeof input.modelId !== 'string' || !input.modelId.trim()) {
    throw new AiTaskContractError('invalid_input');
  }
  const result = await generateGovernedChat({
    ...input.governance,
    request: {
      taskKey: 'ui_translation',
      modelId: input.modelId,
      messages: buildPublicUiTranslationMessages(task),
      maxOutputTokens: 512,
    },
  });
  return parsePublicUiTranslationDraft(task, result);
}
