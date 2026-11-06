import { describe, expect, it } from 'vitest';
import { formatLlmTaskLabel, LLM_TASK_LABELS } from './llmTaskLabels';

describe('Admin: AI task labels and safe unknown-task fallback', () => {
  it('uses explicit labels for existing core tasks', () => {
    expect(formatLlmTaskLabel('classification')).toBe('Klassifizierung');
    expect(formatLlmTaskLabel('translation')).toBe('Übersetzung (allgemein)');
    expect(formatLlmTaskLabel('workflow_responsibility_check')).toBe('Verwaltungs-Zuständigkeitsprüfung');
    expect(formatLlmTaskLabel('situation_report')).toBe('Lagebild');
  });
  it('preserves unknown task keys transparently', () => {
    expect(formatLlmTaskLabel('new_provider_task')).toBe('new_provider_task');
    expect(formatLlmTaskLabel('  new_provider_task  ')).toBe('new_provider_task');
  });
  it('uses a clear fallback for blank tasks', () => {
    expect(formatLlmTaskLabel('')).toBe('Unbekannte Aufgabe');
    expect(formatLlmTaskLabel('  ')).toBe('Unbekannte Aufgabe');
  });
  it('ensures all static task labels are nonempty', () => {
    expect(Object.keys(LLM_TASK_LABELS).length).toBeGreaterThan(20);
    for (const [key, label] of Object.entries(LLM_TASK_LABELS)) {
      expect(key.trim()).not.toBe('');
      expect(label.trim()).not.toBe('');
    }
  });
});
