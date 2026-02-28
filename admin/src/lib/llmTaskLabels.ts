const LLM_TASK_LABELS: Record<string, string> = {
  default: 'Standard',
  classification: 'Klassifizierung',
  translation: 'Übersetzung (allgemein)',
  ui_translation: 'UI-Übersetzung',
  email_translation: 'E-Mail-Übersetzung',
  image_to_text: 'Bild-zu-Text-Auswertung',
  admin_help: 'Admin-Hilfe',
  category_assistant: 'Kategorien-Assistent',
  template_generation: 'Template-Generierung',
  template_json_repair: 'Template JSON-Reparatur',
  template_placeholder_completion: 'Template Platzhalter-Vervollständigung',
  redmine_ticket: 'Redmine-Ticket KI',
  workflow_template_generation: 'Workflow-Generierung',
  workflow_json_repair: 'Workflow JSON-Reparatur',
  workflow_template_selection: 'Workflow-Auswahl',
  workflow_data_request_need_check: 'Datennachforderung Vorprüfung',
  workflow_data_request: 'Datennachforderung Fragen',
  workflow_data_request_answer_evaluation: 'Datennachforderung Auswertung',
  workflow_free_data_request_need_check: 'Freie Datennachforderung Vorprüfung',
  workflow_free_data_request: 'Freie Datennachforderung Fragen',
  workflow_free_data_request_answer_evaluation: 'Freie Datennachforderung Auswertung',
  workflow_recategorization: 'Workflowwechsel Rekategorisierung',
  workflow_categorization_org_assignment: 'Kategorisierung Org-Zuweisung',
  workflow_responsibility_check: 'Verwaltungs-Zuständigkeitsprüfung',
  workflow_confirmation_instruction: 'Freigabe-Anweisung',
  workflow_internal_task_generation: 'Interne Aufgaben-Generierung',
  workflow_api_probe_analysis: 'REST API Probe-Auswertung',
  situation_report: 'Lagebild',
  situation_report_category_workflow: 'Lagebild Kategorien/Workflow',
  situation_report_free_analysis: 'Lagebild Freie Analyse',
  situation_report_memory_compression: 'Lagebild Memory-Komprimierung',
  pseudonym_pool: 'Pseudonym-Pool',
};

export function formatLlmTaskLabel(taskKey: string): string {
  const normalized = String(taskKey || '').trim();
  if (!normalized) return 'Unbekannte Aufgabe';
  return LLM_TASK_LABELS[normalized] || normalized;
}

export { LLM_TASK_LABELS };
