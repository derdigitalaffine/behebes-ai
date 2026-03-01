import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useLocation, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getAdminToken } from '../lib/auth';
import { useAdminScopeContext } from '../lib/adminScopeContext';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import {
  buildAssignmentUserLabel,
  loadAssignmentDirectory as fetchAssignmentDirectory,
  type AssignmentAdminUserOption,
  type AssignmentOrgUnitOption,
} from '../lib/assignmentDirectory';
import './WorkflowSettings.css';

type WorkflowExecutionMode = 'MANUAL' | 'AUTO' | 'HYBRID';
type WorkflowStepType =
  | 'REDMINE_TICKET'
  | 'EMAIL'
  | 'EMAIL_EXTERNAL'
  | 'CATEGORIZATION'
  | 'RESPONSIBILITY_CHECK'
  | 'EMAIL_DOUBLE_OPT_IN'
  | 'EMAIL_CONFIRMATION'
  | 'MAYOR_INVOLVEMENT'
  | 'DATENNACHFORDERUNG'
  | 'ENHANCED_CATEGORIZATION'
  | 'FREE_AI_DATA_REQUEST'
  | 'IMAGE_TO_TEXT_ANALYSIS'
  | 'CITIZEN_NOTIFICATION'
  | 'REST_API_CALL'
  | 'INTERNAL_PROCESSING'
  | 'END'
  | 'JOIN'
  | 'SPLIT'
  | 'IF'
  | 'WAIT_STATUS_CHANGE'
  | 'CHANGE_WORKFLOW'
  | 'SUB_WORKFLOW'
  | 'CUSTOM';

interface WorkflowTemplateStep {
  title: string;
  type: WorkflowStepType;
  config: Record<string, any>;
  auto?: boolean;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowTemplateStep[];
  executionMode: WorkflowExecutionMode;
  autoTriggerOnEmailVerified?: boolean;
  runtime?: WorkflowRuntimeConfig;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  scope?: 'platform' | 'tenant';
  tenantId?: string;
  originId?: string;
  isOverride?: boolean;
}

interface WorkflowTemplateTableRow {
  id: string;
  name: string;
  scopeLabel: string;
  scopeVariant: 'global' | 'tenant' | 'override';
  executionMode: WorkflowExecutionMode;
  stepsCount: number;
  enabledLabel: string;
  autoTriggerLabel: string;
  description: string;
  templateRef: WorkflowTemplate;
}

interface WorkflowRetryPolicy {
  maxRetries: number;
  backoffSeconds: number;
}

interface WorkflowSlaConfig {
  targetMinutes: number;
  riskThresholdPercent: number;
}

interface WorkflowRuntimeConfig {
  maxTransitionsPerExecution: number;
  maxVisitsPerTask: number;
  defaultStepTimeoutSeconds: number;
  retryPolicy: WorkflowRetryPolicy;
  sla: WorkflowSlaConfig;
}

interface WorkflowSlaDurationParts {
  weeks: number;
  days: number;
  hours: number;
}

interface RedmineIssueStatus {
  id: number;
  name: string;
}

interface RedmineProjectOption {
  id: number;
  name: string;
  identifier?: string;
  enabled?: boolean;
}

interface RedmineTrackerOption {
  id: number;
  name: string;
  enabled?: boolean;
}

interface RedmineUserOption {
  id: number;
  firstname?: string;
  lastname?: string;
  login?: string;
  mail?: string;
  enabled?: boolean;
}

interface RedmineGroupOption {
  id: number;
  name: string;
  enabled?: boolean;
}

interface EmailTemplateOption {
  id: string;
  name: string;
}

interface RestProbeResultPayload {
  runtimeMs?: number;
  requests?: Array<Record<string, any>>;
  logs?: Array<string>;
  output?: any;
  outputObject?: any;
  state?: any;
  awaitingUntil?: string | null;
  aiAnalysis?: any;
  aiAnalysisRaw?: string;
  aiAnalysisError?: string;
  error?: string;
  probeData?: any;
}

interface EditableWorkflowStep extends WorkflowTemplateStep {
  localId: string;
}

interface EditableTemplate {
  id?: string;
  name: string;
  description: string;
  executionMode: WorkflowExecutionMode;
  autoTriggerOnEmailVerified: boolean;
  enabled: boolean;
  runtime: WorkflowRuntimeConfig;
  steps: EditableWorkflowStep[];
}

type WorkflowImportMode = 'merge' | 'replace';

interface WorkflowImportTemplateCandidate {
  sourceIndex: number;
  raw: Record<string, any>;
  id: string;
  name: string;
  description: string;
  stepsCount: number;
  executionMode: string;
}

interface WorkflowImportDialogState {
  fileName: string;
  templates: WorkflowImportTemplateCandidate[];
  mode: WorkflowImportMode;
  selectedSourceIndexes: number[];
  nameOverride: string;
  importing: boolean;
}

interface WorkflowAiGenerateDialogState {
  prompt: string;
  nameHint: string;
  descriptionHint: string;
  executionMode: WorkflowExecutionMode;
  autoTriggerOnEmailVerified: boolean;
  enabled: boolean;
  maxSteps: number;
  generating: boolean;
}

interface WorkflowAiElementReference {
  type: WorkflowStepType;
  icon: string;
  purpose: string;
  config: string[];
  notes?: string[];
}

const STEP_TYPE_LABELS: Record<WorkflowStepType, string> = {
  REDMINE_TICKET: 'Redmine-Ticket',
  EMAIL: 'E-Mail',
  EMAIL_EXTERNAL: 'Externe E-Mail',
  CATEGORIZATION: 'Kategorisierung',
  RESPONSIBILITY_CHECK: 'Verwaltungs-Zuständigkeitsprüfung',
  EMAIL_DOUBLE_OPT_IN: 'E-Mail Double Opt-In',
  EMAIL_CONFIRMATION: 'E-Mail-Freigabe',
  MAYOR_INVOLVEMENT: 'Ortsbürgermeister involvieren',
  DATENNACHFORDERUNG: 'Datennachforderung',
  ENHANCED_CATEGORIZATION: 'KI-Basierte Datennachforderung',
  FREE_AI_DATA_REQUEST: 'Freie KI-Datennachforderung',
  IMAGE_TO_TEXT_ANALYSIS: 'Bilder zu Text auswerten',
  CITIZEN_NOTIFICATION: 'Bürgerbenachrichtigung',
  REST_API_CALL: 'RESTful API Call',
  INTERNAL_PROCESSING: 'Interne Bearbeitung',
  END: 'Workflow-/Teilworkflow beenden',
  JOIN: 'Join-Knoten',
  SPLIT: 'Split-Knoten',
  IF: 'IF-Bedingung',
  WAIT_STATUS_CHANGE: 'Warte/Statuswechsel',
  CHANGE_WORKFLOW: 'Workflow wechseln',
  SUB_WORKFLOW: 'Teilworkflow starten',
  CUSTOM: 'Benutzerdefiniert',
};

const WAIT_STATUS_OPTIONS = [
  { value: 'pending_validation', label: 'Validierung ausstehend' },
  { value: 'pending', label: 'Ausstehend' },
  { value: 'open', label: 'Offen' },
  { value: 'assigned', label: 'Zugewiesen' },
  { value: 'in-progress', label: 'In Bearbeitung' },
  { value: 'completed', label: 'Abgeschlossen' },
  { value: 'closed', label: 'Geschlossen' },
] as const;

const WAIT_FIELD_MODE_OPTIONS = [
  { value: 'keep', label: 'Unverändert lassen' },
  { value: 'set', label: 'Fest setzen' },
] as const;

type WorkflowRecipientEmailSource =
  | 'manual'
  | 'org_unit'
  | 'ticket_primary_assignee'
  | 'ticket_collaborators';

function normalizeRecipientEmailSource(value: unknown): WorkflowRecipientEmailSource {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'org_unit') return 'org_unit';
  if (normalized === 'ticket_primary_assignee') return 'ticket_primary_assignee';
  if (normalized === 'ticket_collaborators') return 'ticket_collaborators';
  return 'manual';
}

function getRecipientSourceSummaryLabel(
  source: WorkflowRecipientEmailSource,
  fallbackLabel: string
): string {
  if (source === 'org_unit') return 'Org-Kontakt';
  if (source === 'ticket_primary_assignee') return 'Primär-Zuweisung';
  if (source === 'ticket_collaborators') return 'Beteiligte';
  return fallbackLabel;
}

const DEFAULT_REDMINE_CONFIG = {
  projectMode: 'ai',
  trackerMode: 'ai',
  assigneeMode: 'ai',
  textMode: 'ai',
  waitForTargetStatus: false,
  targetStatusIds: [] as number[],
  targetStatusCheckIntervalSeconds: 60,
  aiPromptTemplate: '',
  aiPromptExtension: '',
  projectId: 'auto',
  tracker: 'auto',
  assigneeId: '',
  noAssignee: false,
  titleTemplate: '{category}: {address}',
  descriptionTemplate:
    'Ticket-ID: {ticketId}\nKategorie: {category}\nAdresse: {address}\nKoordinaten: {coordinates}\nMeldende Person: {citizenName} ({citizenEmail})\n\nBeschreibung:\n{description}',
};

const TEMPLATE_FALLBACK_LABELS: Record<string, string> = {
  'external-notification': 'Externe Benachrichtigung',
  'workflow-confirmation': 'Workflow-Bestätigung',
  'citizen-workflow-notification': 'Bürgerbenachrichtigung',
  'workflow-mayor-involvement-notify': 'Ortsbürgermeister-Info',
  'workflow-mayor-involvement-approval': 'Ortsbürgermeister-Zustimmung',
};

const DEFAULT_RESPONSIBILITY_AUTHORITIES = [
  'Ortsgemeinde',
  'Verbandsgemeinde / verbandsfreie Gemeinde',
  'Landkreis / kreisfreie Stadt',
  'Landesbehoerde',
] as const;

const RESPONSIBILITY_IF_FIELD_ALIASES = new Set([
  'responsibilityauthority',
  'responsibility_authority',
  'responsibility',
  'zuständigkeit',
  'zustandigkeit',
]);

const resolveWorkflowScopeBadge = (template: WorkflowTemplate): {
  label: string;
  variant: 'global' | 'tenant' | 'override';
} => {
  const scope = template.scope === 'tenant' ? 'tenant' : 'platform';
  if (scope === 'platform') {
    return { label: 'Global', variant: 'global' };
  }
  if (template.isOverride) {
    return { label: 'Mandanten-Override', variant: 'override' };
  }
  return { label: 'Mandant', variant: 'tenant' };
};

const workflowScopeBadgeClassName = (variant: 'global' | 'tenant' | 'override'): string => {
  if (variant === 'global') return 'border-sky-300 bg-sky-50 text-sky-800';
  if (variant === 'override') return 'border-amber-300 bg-amber-50 text-amber-800';
  return 'border-emerald-300 bg-emerald-50 text-emerald-800';
};

const IF_FIELD_OPTIONS = [
  { value: 'category', label: 'Kategorie' },
  { value: 'priority', label: 'Priorität' },
  { value: 'status', label: 'Ticketstatus' },
  { value: 'assignedTo', label: 'Zugewiesen an' },
  { value: 'responsibilityAuthority', label: 'Zuständigkeit' },
  { value: 'description', label: 'Beschreibung' },
  { value: 'address', label: 'Adresse' },
  { value: 'postalCode', label: 'PLZ' },
  { value: 'city', label: 'Ort' },
  { value: 'latitude', label: 'Breitengrad' },
  { value: 'longitude', label: 'Längengrad' },
  { value: 'redmineIssueId', label: 'Redmine-Issue-ID' },
  { value: 'citizenName', label: 'Bürgername' },
  { value: 'citizenEmail', label: 'Bürger-E-Mail' },
  { value: 'ticketId', label: 'Ticket-ID' },
] as const;

const IF_OPERATOR_OPTIONS = [
  { value: 'equals', label: '=' },
  { value: 'not_equals', label: '!=' },
  { value: 'contains', label: 'enthält' },
  { value: 'not_contains', label: 'enthält nicht' },
  { value: 'starts_with', label: 'beginnt mit' },
  { value: 'ends_with', label: 'endet mit' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'is_empty', label: 'ist leer' },
  { value: 'is_not_empty', label: 'ist nicht leer' },
] as const;

const IF_PRIORITY_OPERATOR_OPTIONS = [
  { value: 'gte', label: 'höher oder gleich' },
  { value: 'gt', label: 'höher als' },
  { value: 'equals', label: 'gleich' },
  { value: 'not_equals', label: 'ungleich' },
  { value: 'lte', label: 'niedriger oder gleich' },
  { value: 'lt', label: 'niedriger als' },
  { value: 'is_empty', label: 'ist leer' },
  { value: 'is_not_empty', label: 'ist nicht leer' },
] as const;

const IF_RESPONSIBILITY_OPERATOR_OPTIONS = [
  { value: 'equals', label: 'ist' },
  { value: 'not_equals', label: 'ist nicht' },
  { value: 'is_empty', label: 'ist leer' },
  { value: 'is_not_empty', label: 'ist nicht leer' },
] as const;

const PRIORITY_LEVEL_OPTIONS = [
  { value: 'low', label: 'Niedrig (low)' },
  { value: 'medium', label: 'Mittel (medium)' },
  { value: 'high', label: 'Hoch (high)' },
  { value: 'critical', label: 'Kritisch (critical)' },
] as const;

const IF_STATUS_VALUE_OPTIONS = [
  { value: 'pending_validation', label: 'Validierung ausstehend' },
  { value: 'pending', label: 'Ausstehend' },
  { value: 'open', label: 'Offen' },
  { value: 'assigned', label: 'Zugewiesen' },
  { value: 'in-progress', label: 'In Bearbeitung' },
  { value: 'completed', label: 'Abgeschlossen' },
  { value: 'closed', label: 'Geschlossen' },
] as const;

const WORKFLOW_AI_REFERENCE_IF_FIELDS = [...IF_FIELD_OPTIONS.map((option) => option.value)];

const WORKFLOW_AI_REFERENCE_IF_OPERATORS = IF_OPERATOR_OPTIONS.map((option) => option.value);
const WORKFLOW_AI_REFERENCE_STATUS_VALUES = WAIT_STATUS_OPTIONS.map((option) => option.value);
const WORKFLOW_AI_REFERENCE_PRIORITY_VALUES = PRIORITY_LEVEL_OPTIONS.map((option) => option.value);

const WORKFLOW_AI_ELEMENT_REFERENCES: WorkflowAiElementReference[] = [
  {
    type: 'CATEGORIZATION',
    icon: 'fa-tags',
    purpose: 'Normale KI-Klassifizierung mit Kategoriezuordnung und Start des Kategorie-Workflows.',
    config: [
      'startCategoryWorkflow, endCurrentWorkflow',
      'fallbackTemplateId bei fehlender Kategoriezuordnung',
      'addAiComment, aiCommentVisibility',
    ],
  },
  {
    type: 'RESPONSIBILITY_CHECK',
    icon: 'fa-scale-balanced',
    purpose:
      'Verwaltungs-Zuständigkeitsprüfung: Prüft die zuständige Verwaltungsebene (Ortsgemeinde/Verbandsgemeinde/Landkreis/Landesbehörde) anhand Ticket- und OSM-Kontext.',
    config: [
      'applyToTicket (setzt Feld "Zuständig ist" im Ticket)',
      'addAiComment, aiCommentVisibility',
    ],
  },
  {
    type: 'EMAIL_CONFIRMATION',
    icon: 'fa-envelope-open-text',
    purpose: 'Fordert eine Freigabe an (z. B. vom Bürger) und pausiert den Ablauf bis zur Entscheidung.',
    config: [
      'recipientType (citizen|custom), recipientEmail, recipientName, templateId',
      'instructionText, instructionAiPrompt',
      'nextTaskIds (Pfad bei Zustimmung)',
      'rejectNextTaskIds / rejectNextTaskId (Pfad bei Ablehnung)',
    ],
  },
  {
    type: 'EMAIL_DOUBLE_OPT_IN',
    icon: 'fa-user-check',
    purpose: 'Double Opt-In Schritt innerhalb der Workflow-Engine.',
    config: [
      'gleiches Modell wie EMAIL_CONFIRMATION',
      'timeoutHours/timeoutMinutes definierbar',
      'rejectNextTaskIds / rejectNextTaskId für Timeout/Ablehnung',
    ],
  },
  {
    type: 'MAYOR_INVOLVEMENT',
    icon: 'fa-user-tie',
    purpose:
      'Bindet den zuständigen Ortsbürgermeister ein: nur informieren oder eine Entscheidung einholen.',
    config: [
      'mode (notify|approval), templateId',
      'approvalQuestion (Default-Entscheidungsfrage)',
      'timeoutHours/timeoutMinutes für den Zustimmungsmodus',
      'nextTaskIds bei Zustimmung, rejectNextTaskIds bei Ablehnung (nur approval)',
      'Empfaenger wird aus Einstellungen "Kommunale Ansprechpartner" ermittelt',
    ],
  },
  {
    type: 'REDMINE_TICKET',
    icon: 'fa-ticket',
    purpose: 'Erzeugt ein Redmine-Issue und kann optional bis zu Zielstatus warten.',
    config: [
      'projectMode, trackerMode, assigneeMode, textMode',
      'projectId, tracker, assigneeId, noAssignee',
      'titleTemplate, descriptionTemplate',
      'waitForTargetStatus, targetStatusIds, targetStatusCheckIntervalSeconds (>=15)',
      'aiPromptTemplate, aiPromptExtension, nextTaskIds',
    ],
  },
  {
    type: 'EMAIL',
    icon: 'fa-envelope',
    purpose: 'Sendet eine interne E-Mail basierend auf einer Vorlage.',
    config: ['recipientEmail, recipientName, templateId, nextTaskIds'],
  },
  {
    type: 'EMAIL_EXTERNAL',
    icon: 'fa-paper-plane',
    purpose: 'Sendet eine externe E-Mail basierend auf einer Vorlage.',
    config: ['recipientEmail, recipientName, templateId, nextTaskIds'],
  },
  {
    type: 'CITIZEN_NOTIFICATION',
    icon: 'fa-bell',
    purpose: 'Informiert die meldende Person per E-Mail über den Workflowstand.',
    config: ['templateId, customMessage, nextTaskIds'],
  },
  {
    type: 'WAIT_STATUS_CHANGE',
    icon: 'fa-hourglass-half',
    purpose: 'Wartet eine Zeitspanne und kann danach Ticketfelder gezielt setzen.',
    config: [
      'waitHours, waitMinutes, waitSeconds (Summe > 0)',
      'statusMode/priorityMode/assigneeMode/categoryMode/descriptionMode/addressMode/postalCodeMode/cityMode/latitudeMode/longitudeMode/responsibilityMode (keep|set)',
      'statusAfter, priorityAfter, assigneeAfter (user:<id>|org:<id>|assigned:<text>), categoryAfter, descriptionAfter, addressAfter, postalCodeAfter, cityAfter, latitudeAfter, longitudeAfter, responsibilityAfter',
      'nextTaskIds',
    ],
  },
  {
    type: 'IF',
    icon: 'fa-code-branch',
    purpose: 'Bedingte Verzweigung mit True- und False-Pfaden.',
    config: [
      'logic (AND|OR), conditions[]',
      'trueNextTaskIds, falseNextTaskIds, trueNextTaskId, falseNextTaskId',
      'nextTaskIds bleibt leer (Verzweigung nur über true/false)',
    ],
    notes: [
      `Field-Conditions: field in [${WORKFLOW_AI_REFERENCE_IF_FIELDS.join(', ')}], operator in [${WORKFLOW_AI_REFERENCE_IF_OPERATORS.join(', ')}], value passend zum Feld.`,
      'Für field "responsibilityAuthority" nur equals/not_equals/is_empty/is_not_empty nutzen.',
      'Process-Variable-Conditions: kind "process_variable", key (z. B. var.menge), operator, value.',
      'Geofence-Conditions: kind "geofence", operator ("inside"|"outside"), shape ("circle"|"polygon"), bei circle centerLat/centerLon/radiusMeters, bei polygon points[{lat,lon}], optional latitudeField/longitudeField.',
    ],
  },
  {
    type: 'DATENNACHFORDERUNG',
    icon: 'fa-file-circle-question',
    purpose: 'Statisches Rückfrageformular mit Prozessvariablen-Ausgabe.',
    config: [
      'templateId (z. B. workflow-data-request)',
      'fields[] mit key/label/type/required/options',
      'parallelMode, timeoutHours, rejectNextTaskIds',
      'variablePrefix, aliasPrefix, createAlias',
    ],
  },
  {
    type: 'ENHANCED_CATEGORIZATION',
    icon: 'fa-wand-sparkles',
    purpose: 'KI-basierte Datennachforderung mit optionaler Vorprüfung und optionaler Rekategorisierung.',
    config: [
      'questionPrompt optional',
      'gleiches Variablenmodell wie DATENNACHFORDERUNG',
      'enableNeedCheck + needCheckPrompt für optionale Vorprüfung',
      'enableRecategorization true|false für späte KI-Ticketanpassung',
      'parallelMode + Timeout + Reject-Pfad',
    ],
  },
  {
    type: 'FREE_AI_DATA_REQUEST',
    icon: 'fa-brain',
    purpose: 'Universelle KI-Datennachforderung mit freier Zieldefinition und strukturierten Variablen.',
    config: [
      'collectionObjective (fachliches Ziel, z. B. OWiG-Taeterdaten)',
      'questionPrompt als Klartext-Fokus (optional), needCheckPrompt / answerEvaluationPrompt optional',
      'gleiches Variablenmodell wie DATENNACHFORDERUNG',
      'maxQuestionsPerCycle, allowFollowUpCycles, maxFollowUpCycles',
      'parallelMode + Timeout + Reject-Pfad',
    ],
  },
  {
    type: 'IMAGE_TO_TEXT_ANALYSIS',
    icon: 'fa-image',
    purpose: 'Erzeugt KI-Bildbeschreibungen aus Ticket-Bildern und speichert sie am Bild.',
    config: [
      'mode/runMode: always oder below_confidence',
      'confidenceThreshold (0..1) + optional confidenceVariableKey',
      'onlyMissing/overwriteExisting',
      'includeDescription/includeOsmData/includeWeatherData',
      'failOnError, addAiComment, aiCommentVisibility',
    ],
  },
  {
    type: 'INTERNAL_PROCESSING',
    icon: 'fa-user-gear',
    purpose: 'Erzeugt eine interne Bearbeitungsaufgabe für Admin/Sachbearbeitung mit optionaler Workflow-Blockierung.',
    config: [
      'mode (blocking|parallel), assigneeStrategy (ticket_primary|fixed_user|fixed_org|process_variable)',
      'assigneeUserId, assigneeOrgUnitId, assigneeProcessVariableKey',
      'taskSource (static|ai_generated), taskTitle, taskDescription, instructions',
      'formSchema.fields[] (text|textarea|boolean|select|date|number)',
      'processVarMappings und optionale onComplete/onReject-Regeln',
    ],
  },
  {
    type: 'SPLIT',
    icon: 'fa-share-nodes',
    purpose: 'Startet zwei oder mehr parallele Pfade.',
    config: ['leftNextTaskId, rightNextTaskId, nextTaskIds (mindestens 2 verschiedene Ziele)'],
  },
  {
    type: 'JOIN',
    icon: 'fa-code-merge',
    purpose: 'Führt parallele Pfade wieder zusammen.',
    config: ['requiredArrivals (>=1), nextTaskIds'],
    notes: ['JOIN muss auto=true sein.'],
  },
  {
    type: 'END',
    icon: 'fa-circle-stop',
    purpose: 'Beendet einen Teilpfad oder den kompletten Workflow.',
    config: ['scope ("branch"|"workflow"), endScope identisch, nextTaskIds []'],
  },
  {
    type: 'CHANGE_WORKFLOW',
    icon: 'fa-shuffle',
    purpose: 'Wechselt in einen anderen Workflow.',
    config: ['selectionMode ("manual"|"ai"), templateId (nur bei manual), nextTaskIds'],
  },
  {
    type: 'SUB_WORKFLOW',
    icon: 'fa-diagram-project',
    purpose:
      'Startet einen untergeordneten Workflow und setzt den aktuellen Workflow nach dessen Abschluss fort.',
    config: [
      'selectionMode ("manual"|"ai"), templateId (nur bei manual), fallbackTemplateId',
      'allowSameTemplate, reuseActiveChild, failOnChildFailure',
      'nextTaskIds (werden nach Abschluss des Teilworkflows angewendet)',
    ],
  },
  {
    type: 'REST_API_CALL',
    icon: 'fa-plug-circle-bolt',
    purpose: 'Bidirektionale API-/JS-Integration (Request + strukturierte Rückkanalverarbeitung).',
    config: [
      'timeoutMs, requestTimeoutMs, continueOnError, baseUrl, sourceCode',
      'Rückkanal: result, patchTicket, state, nextTaskIds/pathGroupsByTaskId, awaitingUntil',
      'Probe-Fenster mit KI-Auswertung für API-Antwortstrukturen',
    ],
  },
  {
    type: 'CUSTOM',
    icon: 'fa-pencil',
    purpose: 'Platzhalter ohne Runtime-Logik (wird zur Laufzeit übersprungen).',
    config: ['nextTaskIds'],
  },
];

function normalizePriorityLevelValue(value: unknown): 'low' | 'medium' | 'high' | 'critical' | '' {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (raw === 'low' || raw === 'niedrig') return 'low';
  if (raw === 'medium' || raw === 'mittel' || raw === 'normal') return 'medium';
  if (raw === 'high' || raw === 'hoch') return 'high';
  if (raw === 'critical' || raw === 'kritisch') return 'critical';
  return '';
}

function normalizeStatusValue(value: unknown): string {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (raw === 'pending validation') return 'pending_validation';
  if (raw === 'in_progress' || raw === 'in progress') return 'in-progress';
  const known = IF_STATUS_VALUE_OPTIONS.some((option) => option.value === raw);
  return known ? raw : '';
}

function normalizeWaitFieldModeValue(value: unknown): 'keep' | 'set' {
  return String(value ?? '').trim().toLowerCase() === 'set' ? 'set' : 'keep';
}

function mergeDistinctTextOptions(...sources: unknown[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const source of sources) {
    const entries = Array.isArray(source) ? source : source === null || source === undefined ? [] : [source];
    for (const entry of entries) {
      const value = String(entry ?? '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(value);
    }
  }

  return merged;
}

function normalizeIfFieldValue(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'category';
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'assignedto') return 'assignedTo';
  if (normalized === 'postalcode') return 'postalCode';
  if (normalized === 'citizenemail') return 'citizenEmail';
  if (normalized === 'citizenname') return 'citizenName';
  if (normalized === 'redmineissueid') return 'redmineIssueId';
  if (RESPONSIBILITY_IF_FIELD_ALIASES.has(normalized)) {
    return 'responsibilityAuthority';
  }
  return raw;
}

function isResponsibilityIfField(value: unknown): boolean {
  return normalizeIfFieldValue(value) === 'responsibilityAuthority';
}

function normalizeIfOperatorForField(fieldValue: unknown, operatorValue: unknown): string {
  const field = normalizeIfFieldValue(fieldValue);
  const operator = String(operatorValue ?? '').trim().toLowerCase();
  const defaultOperator = field === 'priority' ? 'gte' : 'equals';
  const options =
    field === 'priority'
      ? IF_PRIORITY_OPERATOR_OPTIONS
      : field === 'responsibilityAuthority'
      ? IF_RESPONSIBILITY_OPERATOR_OPTIONS
      : IF_OPERATOR_OPTIONS;
  if (options.some((option) => option.value === operator)) return operator;
  return defaultOperator;
}

const REDMINE_TEMPLATE_PLACEHOLDERS = [
  '{category}',
  '{address}',
  '{coordinates}',
  '{description}',
  '{ticketId}',
  '{submissionId}',
  '{citizenName}',
  '{citizenEmail}',
] as const;

const DTPN_NOTATION_META = Object.freeze({
  notation: 'DTPN',
  fullName: 'Do Troe Process Notation',
  version: 1,
});

const DEFAULT_WORKFLOW_RUNTIME: WorkflowRuntimeConfig = {
  maxTransitionsPerExecution: 500,
  maxVisitsPerTask: 20,
  defaultStepTimeoutSeconds: 60,
  retryPolicy: {
    maxRetries: 0,
    backoffSeconds: 0,
  },
  sla: {
    targetMinutes: 1440,
    riskThresholdPercent: 80,
  },
};

function normalizeRuntimeConfig(input: any): WorkflowRuntimeConfig {
  const source = input && typeof input === 'object' ? input : {};
  const retryPolicySource = source.retryPolicy && typeof source.retryPolicy === 'object' ? source.retryPolicy : {};
  const slaSource = source.sla && typeof source.sla === 'object' ? source.sla : {};
  return {
    maxTransitionsPerExecution: Number.isFinite(Number(source.maxTransitionsPerExecution))
      ? Math.max(50, Math.floor(Number(source.maxTransitionsPerExecution)))
      : DEFAULT_WORKFLOW_RUNTIME.maxTransitionsPerExecution,
    maxVisitsPerTask: Number.isFinite(Number(source.maxVisitsPerTask))
      ? Math.max(1, Math.floor(Number(source.maxVisitsPerTask)))
      : DEFAULT_WORKFLOW_RUNTIME.maxVisitsPerTask,
    defaultStepTimeoutSeconds: Number.isFinite(Number(source.defaultStepTimeoutSeconds))
      ? Math.max(1, Math.floor(Number(source.defaultStepTimeoutSeconds)))
      : DEFAULT_WORKFLOW_RUNTIME.defaultStepTimeoutSeconds,
    retryPolicy: {
      maxRetries: Number.isFinite(Number(retryPolicySource.maxRetries))
        ? Math.max(0, Math.floor(Number(retryPolicySource.maxRetries)))
        : DEFAULT_WORKFLOW_RUNTIME.retryPolicy.maxRetries,
      backoffSeconds: Number.isFinite(Number(retryPolicySource.backoffSeconds))
        ? Math.max(0, Math.floor(Number(retryPolicySource.backoffSeconds)))
        : DEFAULT_WORKFLOW_RUNTIME.retryPolicy.backoffSeconds,
    },
    sla: {
      targetMinutes: Number.isFinite(Number(slaSource.targetMinutes))
        ? Math.max(1, Math.floor(Number(slaSource.targetMinutes)))
        : DEFAULT_WORKFLOW_RUNTIME.sla.targetMinutes,
      riskThresholdPercent: Number.isFinite(Number(slaSource.riskThresholdPercent))
        ? Math.max(1, Math.min(99, Math.floor(Number(slaSource.riskThresholdPercent))))
        : DEFAULT_WORKFLOW_RUNTIME.sla.riskThresholdPercent,
    },
  };
}

function splitSlaTargetMinutes(targetMinutes: number): WorkflowSlaDurationParts {
  const normalizedMinutes = Math.max(1, Math.floor(Number(targetMinutes) || 1));
  const totalHours = Math.max(1, Math.floor(normalizedMinutes / 60));
  const weeks = Math.floor(totalHours / (24 * 7));
  const days = Math.floor((totalHours % (24 * 7)) / 24);
  const hours = totalHours % 24;
  return { weeks, days, hours };
}

function combineSlaDurationParts(parts: WorkflowSlaDurationParts): number {
  const weeks = Math.max(0, Math.floor(Number(parts.weeks) || 0));
  const days = Math.max(0, Math.floor(Number(parts.days) || 0));
  const hours = Math.max(0, Math.floor(Number(parts.hours) || 0));
  const totalHours = weeks * 7 * 24 + days * 24 + hours;
  return Math.max(1, totalHours > 0 ? totalHours * 60 : 60);
}

const normalizeNumericIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
};

const normalizeRedmineGroups = (rawGroups: unknown, assignableGroupIdsRaw: unknown): RedmineGroupOption[] => {
  const groups = Array.isArray(rawGroups)
    ? rawGroups
        .map((group: any) => ({
          id: Number(group?.id),
          name: String(group?.name || '').trim(),
          enabled: typeof group?.enabled === 'boolean' ? group.enabled : undefined,
        }))
        .filter((group: RedmineGroupOption) => Number.isFinite(group.id) && group.name)
    : [];
  const explicitGroupIdSet = new Set(normalizeNumericIds(assignableGroupIdsRaw));
  const hasExplicitSelection = explicitGroupIdSet.size > 0;
  return groups.map((group) => ({
    ...group,
    enabled: hasExplicitSelection ? explicitGroupIdSet.has(group.id) : group.enabled,
  }));
};

type GraphEdgeKind = 'default' | 'split' | 'if_true' | 'if_false' | 'confirm_reject';
type WorkflowGraphNodeType = WorkflowStepType | 'START';
type WorkflowGraphNodeShape = 'rect' | 'circle' | 'diamond';
type GraphPortKey = 'start' | 'default' | 'left' | 'right' | 'true' | 'false';
type TemplateViewMode = 'cards' | 'table';
type WorkflowEditorPanelKey = 'meta' | 'graph' | 'flow';
type WorkflowGraphViewMode = 'standard' | 'compact';

interface WorkflowGraphNode {
  id: string;
  index: number;
  title: string;
  type: WorkflowGraphNodeType;
  shape: WorkflowGraphNodeShape;
  meta?: string;
  isAuto?: boolean;
  radius?: number;
  lane: number;
  x: number;
  y: number;
}

interface WorkflowGraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind: GraphEdgeKind;
  explicit?: boolean;
  sourcePort?: GraphPortKey;
}

interface GraphPortDescriptor {
  key: GraphPortKey;
  label: string;
}

interface GeofenceMapEditorProps {
  mode: 'circle' | 'polygon';
  centerLat: number | null;
  centerLon: number | null;
  radiusMeters: number;
  polygonPoints: Array<{ lat: number; lon: number }>;
  onCenterChange: (lat: number, lon: number) => void;
  onPolygonChange: (points: Array<{ lat: number; lon: number }>) => void;
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeGeofencePolygonPoints(
  value: unknown
): Array<{ lat: number; lon: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (!point || typeof point !== 'object') return null;
      const source = point as Record<string, any>;
      const lat = asOptionalNumber(source.lat ?? source.latitude);
      const lon = asOptionalNumber(source.lon ?? source.lng ?? source.longitude);
      if (lat === null || lon === null) return null;
      return {
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
      };
    })
    .filter((point): point is { lat: number; lon: number } => point !== null);
}

function normalizeSingleReference(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatOrgUnitRecipientLabel(unit: AssignmentOrgUnitOption): string {
  const base = unit.active ? unit.label : `${unit.label} (inaktiv)`;
  const email = String(unit.contactEmail || '').trim();
  return email ? `${base} <${email}>` : `${base} (ohne Kontakt-E-Mail)`;
}

function fillTemplateTokens(template: string, data: Record<string, string>): string {
  return String(template || '').replace(/\{(\w+)\}/g, (match, token) =>
    Object.prototype.hasOwnProperty.call(data, token) ? data[token] ?? '' : match
  );
}

const GeofenceMapEditor: React.FC<GeofenceMapEditorProps> = ({
  mode,
  centerLat,
  centerLon,
  radiusMeters,
  polygonPoints,
  onCenterChange,
  onPolygonChange,
}) => {
  const onCenterChangeRef = useRef(onCenterChange);
  const onPolygonChangeRef = useRef(onPolygonChange);
  const modeRef = useRef(mode);
  const polygonPointsRef = useRef(polygonPoints);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const centerRef = useRef<L.CircleMarker | null>(null);
  const fenceRef = useRef<L.Circle | null>(null);
  const polygonRef = useRef<L.Polygon | null>(null);
  const polygonVertexRefs = useRef<L.CircleMarker[]>([]);
  const initializedRef = useRef(false);

  useEffect(() => {
    onCenterChangeRef.current = onCenterChange;
  }, [onCenterChange]);

  useEffect(() => {
    onPolygonChangeRef.current = onPolygonChange;
  }, [onPolygonChange]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    polygonPointsRef.current = polygonPoints;
  }, [polygonPoints]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      minZoom: 4,
      maxZoom: 19,
    }).setView([49.446, 7.759], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    map.on('click', (event: L.LeafletMouseEvent) => {
      if (modeRef.current === 'polygon') {
        const nextPoints = [
          ...polygonPointsRef.current,
          {
            lat: Number(event.latlng.lat.toFixed(6)),
            lon: Number(event.latlng.lng.toFixed(6)),
          },
        ];
        onPolygonChangeRef.current(nextPoints);
        return;
      }
      onCenterChangeRef.current(event.latlng.lat, event.latlng.lng);
    });

    mapRef.current = map;
    const timer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(timer);
      map.off();
      map.remove();
      mapRef.current = null;
      centerRef.current = null;
      fenceRef.current = null;
      polygonRef.current = null;
      polygonVertexRefs.current = [];
      initializedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (mode === 'polygon') {
      if (centerRef.current) {
        centerRef.current.remove();
        centerRef.current = null;
      }
      if (fenceRef.current) {
        fenceRef.current.remove();
        fenceRef.current = null;
      }

      polygonVertexRefs.current.forEach((marker) => marker.remove());
      polygonVertexRefs.current = [];

      const points = normalizeGeofencePolygonPoints(polygonPoints);
      if (points.length >= 3) {
        const latLngs = points.map((point) => L.latLng(point.lat, point.lon));
        if (!polygonRef.current) {
          polygonRef.current = L.polygon(latLngs, {
            color: '#0284c7',
            weight: 2,
            fillColor: '#7dd3fc',
            fillOpacity: 0.24,
          }).addTo(map);
        } else {
          polygonRef.current.setLatLngs(latLngs);
        }
      } else if (polygonRef.current) {
        polygonRef.current.remove();
        polygonRef.current = null;
      }

      polygonVertexRefs.current = points.map((point, index) =>
        L.circleMarker([point.lat, point.lon], {
          radius: 5.5,
          color: '#0369a1',
          weight: 2,
          fillColor: '#0ea5e9',
          fillOpacity: 0.95,
        })
          .bindTooltip(`${index + 1}`, {
            permanent: true,
            direction: 'top',
            opacity: 0.88,
            offset: [0, -4],
            className: 'geofence-map-point-label',
          })
          .addTo(map)
      );

      if (!initializedRef.current) {
        if (points.length >= 3 && polygonRef.current) {
          map.fitBounds(polygonRef.current.getBounds().pad(0.2));
        } else if (points.length > 0) {
          map.setView([points[points.length - 1].lat, points[points.length - 1].lon], 13);
        }
        initializedRef.current = true;
      }
      return;
    }

    if (polygonRef.current) {
      polygonRef.current.remove();
      polygonRef.current = null;
    }
    polygonVertexRefs.current.forEach((marker) => marker.remove());
    polygonVertexRefs.current = [];

    const hasCenter = typeof centerLat === 'number' && typeof centerLon === 'number';
    if (!hasCenter) {
      if (centerRef.current) {
        centerRef.current.remove();
        centerRef.current = null;
      }
      if (fenceRef.current) {
        fenceRef.current.remove();
        fenceRef.current = null;
      }
      return;
    }

    const latLng = L.latLng(centerLat, centerLon);
    const safeRadius = Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : 250;

    if (!centerRef.current) {
      centerRef.current = L.circleMarker(latLng, {
        radius: 6,
        color: '#001c31',
        weight: 2,
        fillColor: '#38bdf8',
        fillOpacity: 0.85,
      }).addTo(map);
    } else {
      centerRef.current.setLatLng(latLng);
    }

    if (!fenceRef.current) {
      fenceRef.current = L.circle(latLng, {
        radius: safeRadius,
        color: '#0ea5e9',
        weight: 2,
        fillColor: '#7dd3fc',
        fillOpacity: 0.25,
      }).addTo(map);
    } else {
      fenceRef.current.setLatLng(latLng);
      fenceRef.current.setRadius(safeRadius);
    }

    if (!initializedRef.current) {
      map.setView(latLng, 13);
      initializedRef.current = true;
    }
  }, [mode, centerLat, centerLon, radiusMeters, polygonPoints]);

  const hasPolygonPoints = polygonPoints.length > 0;

  return (
    <div className="geofence-map-editor">
      <div ref={mapContainerRef} className="geofence-map-canvas" />
      {mode === 'polygon' ? (
        <>
          <p className="setting-help">
            Klick auf die Karte fügt einen Polygonpunkt hinzu. Ab 3 Punkten wird ein geschlossener Polygonzug erzeugt.
          </p>
          <div className="split-branch-actions">
            <button
              type="button"
              className="btn btn-secondary split-branch-btn"
              onClick={() => onPolygonChange(polygonPoints.slice(0, -1))}
              disabled={!hasPolygonPoints}
            >
              Letzten Punkt entfernen
            </button>
            <button
              type="button"
              className="btn btn-secondary split-branch-btn"
              onClick={() => onPolygonChange([])}
              disabled={!hasPolygonPoints}
            >
              Polygon leeren
            </button>
            <span className="setting-help">Punkte: {polygonPoints.length}</span>
          </div>
        </>
      ) : (
        <p className="setting-help">Klick auf die Karte setzt den Mittelpunkt des Geofence.</p>
      )}
    </div>
  );
};

function makeStepId() {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildAutoNodeTitle(nodeNumber: number): string {
  return `Knoten ${Math.max(1, Math.floor(Number(nodeNumber) || 1))}`;
}

function getNextAutoNodeNumber(steps: Array<Pick<EditableWorkflowStep, 'title'>>): number {
  let maxNumber = 0;
  for (const step of steps) {
    const title = String(step?.title || '').trim();
    const match = title.match(/^knoten\s+(\d+)$/i);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > maxNumber) {
      maxNumber = parsed;
    }
  }
  return maxNumber > 0 ? maxNumber + 1 : steps.length + 1;
}

function extractImportedTemplates(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  const payload = input as Record<string, any>;
  if (Array.isArray(payload.templates)) return payload.templates;
  if (payload.template && typeof payload.template === 'object' && !Array.isArray(payload.template)) {
    return [payload.template];
  }
  if (payload.workflow && typeof payload.workflow === 'object' && !Array.isArray(payload.workflow)) {
    return [payload.workflow];
  }
  if (payload.definition && typeof payload.definition === 'object' && !Array.isArray(payload.definition)) {
    return [payload.definition];
  }
  if (Array.isArray(payload.steps)) return [payload];
  return [];
}

function toImportTemplateCandidate(rawTemplate: unknown, sourceIndex: number): WorkflowImportTemplateCandidate | null {
  if (!rawTemplate || typeof rawTemplate !== 'object' || Array.isArray(rawTemplate)) return null;
  const template = rawTemplate as Record<string, any>;
  const steps = Array.isArray(template.steps) ? template.steps : [];
  if (steps.length === 0) return null;
  const fallbackName = `Importierter Workflow ${sourceIndex + 1}`;
  return {
    sourceIndex,
    raw: { ...template },
    id: String(template.id || `template-import-${Date.now()}-${sourceIndex}`).trim(),
    name: String(template.name || fallbackName).trim() || fallbackName,
    description: String(template.description || '').trim(),
    stepsCount: steps.length,
    executionMode: String(template.executionMode || 'MANUAL').trim().toUpperCase() || 'MANUAL',
  };
}

function normalizeReferenceArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    const id = String(item || '').trim();
    if (!id) continue;
    unique.add(id);
  }
  return Array.from(unique);
}

function resolveSplitBranchTargets(config: Record<string, any>): string[] {
  const ordered: string[] = [];
  const add = (value: unknown) => {
    const id = normalizeSingleReference(value);
    if (!id || ordered.includes(id)) return;
    ordered.push(id);
  };

  add(config?.leftNextTaskId);
  add(config?.rightNextTaskId);
  normalizeReferenceArray(config?.nextTaskIds).forEach((id) => add(id));
  return ordered.slice(0, 2);
}

function mapTaskReferences(
  type: WorkflowStepType,
  config: Record<string, any>,
  mapRef: (id: string) => string
): Record<string, any> {
  const next = { ...(config || {}) };
  const mappedGenericNextTaskId =
    typeof config?.nextTaskId === 'string' ? normalizeSingleReference(mapRef(config.nextTaskId)) : '';
  const mappedGenericNextTaskIds = normalizeReferenceArray(config?.nextTaskIds)
    .map((id) => normalizeSingleReference(mapRef(id)))
    .filter((id: string) => id.trim().length > 0);

  if (mappedGenericNextTaskId) {
    next.nextTaskId = mappedGenericNextTaskId;
  } else {
    delete next.nextTaskId;
  }
  next.nextTaskIds = mappedGenericNextTaskIds;

  if (type === 'SPLIT') {
    const mappedTargets = resolveSplitBranchTargets(config)
      .map(mapRef)
      .filter((id: string) => id.trim().length > 0);
    const left = typeof config?.leftNextTaskId === 'string' ? mapRef(config.leftNextTaskId) : '';
    const right = typeof config?.rightNextTaskId === 'string' ? mapRef(config.rightNextTaskId) : '';
    next.leftNextTaskId = normalizeSingleReference(left || mappedTargets[0] || '');
    next.rightNextTaskId = normalizeSingleReference(right || mappedTargets[1] || '');
    next.nextTaskIds = [next.leftNextTaskId, next.rightNextTaskId].filter((id: string) => id.trim().length > 0);
    return next;
  }

  if (type === 'IF') {
    next.trueNextTaskId = typeof config?.trueNextTaskId === 'string'
      ? mapRef(config.trueNextTaskId)
      : '';
    next.falseNextTaskId = typeof config?.falseNextTaskId === 'string'
      ? mapRef(config.falseNextTaskId)
      : '';
    next.trueNextTaskIds = normalizeReferenceArray(config?.trueNextTaskIds)
      .map(mapRef)
      .filter((id: string) => id.trim().length > 0);
    next.falseNextTaskIds = normalizeReferenceArray(config?.falseNextTaskIds)
      .map(mapRef)
      .filter((id: string) => id.trim().length > 0);
  }

  if (
    type === 'EMAIL_CONFIRMATION' ||
    type === 'EMAIL_DOUBLE_OPT_IN' ||
    type === 'MAYOR_INVOLVEMENT' ||
    type === 'DATENNACHFORDERUNG' ||
    type === 'ENHANCED_CATEGORIZATION' ||
    type === 'FREE_AI_DATA_REQUEST'
  ) {
    const rejectNextTaskIds = normalizeReferenceArray(
      config?.rejectNextTaskIds ?? config?.rejectNextTaskId
    )
      .map((id) => normalizeSingleReference(mapRef(id)))
      .filter((id: string) => id.trim().length > 0);
    next.rejectNextTaskIds = rejectNextTaskIds;
    if (rejectNextTaskIds.length > 0) {
      next.rejectNextTaskId = rejectNextTaskIds[0];
    } else {
      delete next.rejectNextTaskId;
    }
  }

  return next;
}

function buildDefaultStepConfig(type: WorkflowStepType): Record<string, any> {
  switch (type) {
    case 'REDMINE_TICKET':
      return { ...DEFAULT_REDMINE_CONFIG };
    case 'EMAIL':
    case 'EMAIL_EXTERNAL':
      return {
        recipientEmailSource: 'manual',
        recipientOrgUnitId: '',
        recipientEmail: '',
        recipientName: '',
        templateId: 'external-notification',
      };
    case 'RESPONSIBILITY_CHECK':
      return {
        applyToTicket: true,
        addAiComment: true,
        aiCommentVisibility: 'internal',
      };
    case 'EMAIL_CONFIRMATION':
      return {
        recipientType: 'citizen',
        recipientEmailSource: 'manual',
        recipientOrgUnitId: '',
        recipientEmail: '',
        recipientName: '',
        templateId: 'workflow-confirmation',
        instructionText: '',
        instructionAiPrompt: '',
        timeoutHours: 48,
        rejectNextTaskIds: [] as string[],
      };
    case 'EMAIL_DOUBLE_OPT_IN':
      return {
        recipientType: 'citizen',
        recipientEmailSource: 'manual',
        recipientOrgUnitId: '',
        recipientEmail: '',
        recipientName: '',
        templateId: 'workflow-confirmation',
        sendLegacySubmissionConfirmation: true,
        instructionText: '',
        instructionAiPrompt: '',
        timeoutHours: 48,
        rejectNextTaskIds: [] as string[],
      };
    case 'MAYOR_INVOLVEMENT':
      return {
        mode: 'notify',
        operationMode: 'notify',
        templateId: 'workflow-mayor-involvement-notify',
        approvalQuestion:
          'Möchten Sie dieses Anliegen weiter bearbeiten lassen (von behebes) oder den Workflow hier abbrechen und die Bearbeitung ablehnen?',
        timeoutHours: 48,
        timeoutMinutes: 0,
        rejectNextTaskIds: [] as string[],
      };
    case 'DATENNACHFORDERUNG':
      return {
        recipientType: 'citizen',
        recipientEmailSource: 'manual',
        recipientOrgUnitId: '',
        recipientEmail: '',
        recipientName: '',
        templateId: 'workflow-data-request',
        subject: 'Rückfrage zu Ihrer Meldung',
        introText: 'Für die weitere Bearbeitung benötigen wir zusätzliche Angaben.',
        fields: [
          { key: 'is_urgent', label: 'Ist die Angelegenheit dringend?', type: 'yes_no', required: true },
        ],
        parallelMode: true,
        timeoutHours: 72,
        variablePrefix: '',
        aliasPrefix: 'var',
        createAlias: true,
        responseCommentVisibility: 'internal',
        aiCommentVisibility: 'internal',
        rejectNextTaskIds: [] as string[],
      };
    case 'ENHANCED_CATEGORIZATION':
      return {
        recipientType: 'citizen',
        recipientEmailSource: 'manual',
        recipientOrgUnitId: '',
        recipientEmail: '',
        recipientName: '',
        templateId: 'workflow-data-request',
        subject: 'Rückfragen für bessere Einordnung Ihrer Meldung',
        introText: 'Bitte beantworten Sie ein paar kurze Rückfragen.',
        fields: [] as any[],
        questionPrompt: '',
        enableNeedCheck: false,
        needCheckPrompt: '',
        enableRecategorization: true,
        maxQuestionsPerCycle: 5,
        allowFollowUpCycles: false,
        maxFollowUpCycles: 2,
        parallelMode: true,
        timeoutHours: 72,
        variablePrefix: '',
        aliasPrefix: 'var',
        createAlias: true,
        responseCommentVisibility: 'internal',
        aiCommentVisibility: 'internal',
        rejectNextTaskIds: [] as string[],
      };
    case 'FREE_AI_DATA_REQUEST':
      return {
        recipientType: 'citizen',
        recipientEmailSource: 'manual',
        recipientOrgUnitId: '',
        recipientEmail: '',
        recipientName: '',
        templateId: 'workflow-data-request',
        subject: 'Rückfragen zu Ihrer Meldung',
        introText: 'Bitte beantworten Sie die folgenden Rückfragen für die weitere Bearbeitung.',
        fields: [] as any[],
        collectionObjective:
          'Erfrage gezielt alle Informationen, die für die fachliche Bearbeitung in diesem Workflow benötigt werden.',
        questionPrompt: '',
        questionPromptMode: 'append',
        enableNeedCheck: true,
        needCheckPrompt: '',
        needCheckConfidenceThreshold: 0.82,
        answerEvaluationPrompt: '',
        maxQuestionsPerCycle: 6,
        allowFollowUpCycles: false,
        maxFollowUpCycles: 2,
        parallelMode: true,
        timeoutHours: 72,
        variablePrefix: '',
        aliasPrefix: 'var',
        createAlias: true,
        responseCommentVisibility: 'internal',
        aiCommentVisibility: 'internal',
        rejectNextTaskIds: [] as string[],
      };
    case 'IMAGE_TO_TEXT_ANALYSIS':
      return {
        mode: 'always',
        runMode: 'always',
        confidenceThreshold: 0.75,
        confidenceVariableKey: 'classification.overallConfidence',
        onlyMissing: true,
        overwriteExisting: false,
        includeDescription: true,
        includeOsmData: false,
        includeWeatherData: false,
        failOnError: false,
        addAiComment: true,
        aiCommentVisibility: 'internal',
      };
    case 'CITIZEN_NOTIFICATION':
      return {
        templateId: 'citizen-workflow-notification',
        customMessage: '',
      };
    case 'REST_API_CALL':
      return {
        timeoutMs: 20000,
        requestTimeoutMs: 15000,
        continueOnError: false,
        baseUrl: '',
        sourceCode: `// Bidirektionaler REST-Call:
// - Outbound: Request an externes API
// - Inbound: Antwort in result/state/patchTicket zurueck in den Workflow
//
// Verfügbarer Kontext:
// input.ticket, input.workflow, input.task, state
// Helpers: await request({ method, url, headers, query, json/body, timeoutMs })
//          interpolate("https://api.example.local/items/{ticketId}")
//          await sleep(ms)
// Rückgabe: { result, nextTaskIds, endScope, patchTicket, state }

const apiUrl = interpolate("https://api.example.local/incidents/{ticketId}");
const response = await request({
  method: "POST",
  url: apiUrl,
  json: {
    ticketId: input.ticket.id,
    category: input.ticket.category,
    description: input.ticket.description,
    citizenName: input.ticket.citizen_name,
    citizenEmail: input.ticket.citizen_email
  },
  throwOnHttpError: true
});

return {
  result: {
    remoteStatus: response.status,
    remoteBody: response.data
  },
  // Optional:
  // patchTicket: { status: "assigned", assignedTo: "API-Router" },
  state: { lastCallAt: new Date().toISOString() }
	};`,
      };
    case 'INTERNAL_PROCESSING':
      return {
        mode: 'blocking',
        assigneeStrategy: 'ticket_primary',
        assigneeUserId: '',
        assigneeOrgUnitId: '',
        assigneeProcessVariableKey: '',
        taskSource: 'static',
        taskTitle: '',
        taskDescription: '',
        instructions: '',
        dueDays: 0,
        dueHours: 0,
        dueMinutes: 0,
        formSchema: {
          fields: [
            { key: 'bearbeitungsnotiz', label: 'Bearbeitungsnotiz', type: 'textarea', required: true },
            { key: 'weiterbearbeitung_empfohlen', label: 'Weiterbearbeitung empfohlen', type: 'boolean', required: true },
          ],
        },
        processVarMappings: {},
        onComplete: {},
        onReject: {},
      };
    case 'END':
      return {
        scope: 'branch',
      };
    case 'JOIN':
      return {
        requiredArrivals: 2,
      };
    case 'SPLIT':
      return {
        leftNextTaskId: '',
        rightNextTaskId: '',
        nextTaskIds: [] as string[],
      };
    case 'IF':
      return {
        logic: 'AND',
        conditions: [
          {
            kind: 'field',
            field: 'category',
            operator: 'equals',
            value: '',
          },
        ],
        trueNextTaskId: '',
        falseNextTaskId: '',
      };
    case 'WAIT_STATUS_CHANGE':
      return {
        waitHours: 0,
        waitMinutes: 15,
        waitSeconds: 0,
        statusMode: 'keep',
        statusAfter: 'completed',
        priorityMode: 'keep',
        priorityAfter: 'medium',
        assigneeMode: 'keep',
        assigneeAfter: '',
        categoryMode: 'keep',
        categoryAfter: '',
        descriptionMode: 'keep',
        descriptionAfter: '',
        addressMode: 'keep',
        addressAfter: '',
        postalCodeMode: 'keep',
        postalCodeAfter: '',
        cityMode: 'keep',
        cityAfter: '',
        responsibilityMode: 'keep',
        responsibilityAfter: '',
        latitudeMode: 'keep',
        latitudeAfter: '',
        longitudeMode: 'keep',
        longitudeAfter: '',
      };
    case 'CHANGE_WORKFLOW':
      return {
        selectionMode: 'ai',
        templateId: '',
        fallbackTemplateId: '',
        enableAiRecategorization: false,
        addAiComment: true,
        aiCommentVisibility: 'internal',
      };
    case 'SUB_WORKFLOW':
      return {
        selectionMode: 'ai',
        templateId: '',
        fallbackTemplateId: '',
        allowSameTemplate: false,
        reuseActiveChild: true,
        failOnChildFailure: true,
      };
    case 'CATEGORIZATION':
      return {
        startCategoryWorkflow: true,
        endCurrentWorkflow: true,
        fallbackTemplateId: 'standard-redmine-ticket',
        allowSameTemplateSwitch: false,
        enableOrgUnitAssignment: false,
        orgAssignmentFallbackOrgUnitId: '',
        addAiComment: true,
        aiCommentVisibility: 'internal',
      };
    case 'CUSTOM':
    default:
      return {
        note: '',
      };
  }
}

function normalizeRedmineConfig(config: Record<string, any>): Record<string, any> {
  const targetStatusIds = Array.isArray(config?.targetStatusIds)
    ? config.targetStatusIds
        .map((value: any) => Number(value))
        .filter((value: number) => Number.isFinite(value))
    : [];
  const assigneeModeRaw = String(config?.assigneeMode || '').toLowerCase();
  const assigneeMode = assigneeModeRaw === 'fixed' || assigneeModeRaw === 'none' ? assigneeModeRaw : 'ai';

  return {
    ...DEFAULT_REDMINE_CONFIG,
    ...config,
    projectMode: config?.projectMode === 'fixed' ? 'fixed' : 'ai',
    trackerMode: config?.trackerMode === 'fixed' ? 'fixed' : 'ai',
    assigneeMode,
    noAssignee: assigneeMode === 'none',
    textMode: config?.textMode === 'fixed' ? 'fixed' : 'ai',
    waitForTargetStatus: config?.waitForTargetStatus === true,
    targetStatusIds,
    targetStatusCheckIntervalSeconds: Number.isFinite(Number(config?.targetStatusCheckIntervalSeconds))
      ? Math.max(15, Number(config.targetStatusCheckIntervalSeconds))
      : 60,
  };
}

function normalizeStepConfig(type: WorkflowStepType, config: Record<string, any>): Record<string, any> {
  if (type === 'REDMINE_TICKET') {
    return normalizeRedmineConfig(config || {});
  }

  const source = config && typeof config === 'object' ? config : {};
  const base = buildDefaultStepConfig(type);

  if (type === 'EMAIL' || type === 'EMAIL_EXTERNAL') {
    return {
      ...base,
      ...source,
      recipientEmailSource: normalizeRecipientEmailSource(source?.recipientEmailSource),
      recipientOrgUnitId:
        typeof source?.recipientOrgUnitId === 'string' ? source.recipientOrgUnitId : base.recipientOrgUnitId,
      recipientEmail: typeof source?.recipientEmail === 'string' ? source.recipientEmail : base.recipientEmail,
      recipientName: typeof source?.recipientName === 'string' ? source.recipientName : base.recipientName,
      templateId:
        typeof source?.templateId === 'string' && source.templateId.trim()
          ? source.templateId
          : base.templateId,
    };
  }

  if (type === 'EMAIL_CONFIRMATION' || type === 'EMAIL_DOUBLE_OPT_IN') {
    const recipientType = source?.recipientType === 'custom' ? 'custom' : 'citizen';
    const rejectNextTaskIds = normalizeReferenceArray(
      source?.rejectNextTaskIds ?? source?.rejectNextTaskId
    );
    const instructionText =
      source?.instructionText === null || source?.instructionText === undefined
        ? ''
        : String(source.instructionText);
    const instructionAiPrompt =
      source?.instructionAiPrompt === null || source?.instructionAiPrompt === undefined
        ? ''
        : String(source.instructionAiPrompt);
    return {
      ...base,
      ...source,
      recipientType,
      recipientEmailSource: normalizeRecipientEmailSource(source?.recipientEmailSource),
      recipientOrgUnitId:
        typeof source?.recipientOrgUnitId === 'string' ? source.recipientOrgUnitId : base.recipientOrgUnitId,
      recipientEmail: typeof source?.recipientEmail === 'string' ? source.recipientEmail : base.recipientEmail,
      recipientName: typeof source?.recipientName === 'string' ? source.recipientName : base.recipientName,
      sendLegacySubmissionConfirmation:
        type === 'EMAIL_DOUBLE_OPT_IN'
          ? source?.sendLegacySubmissionConfirmation !== false
          : undefined,
      instructionText,
      instructionAiPrompt,
      timeoutHours: Number.isFinite(Number(source?.timeoutHours))
        ? Math.max(0, Math.floor(Number(source.timeoutHours)))
        : base.timeoutHours,
      timeoutMinutes: Number.isFinite(Number(source?.timeoutMinutes))
        ? Math.max(0, Math.floor(Number(source.timeoutMinutes)))
        : 0,
      rejectNextTaskIds,
      rejectNextTaskId: normalizeSingleReference(source?.rejectNextTaskId) || rejectNextTaskIds[0] || '',
    };
  }

  if (type === 'MAYOR_INVOLVEMENT') {
    const modeRaw = String(source?.mode || source?.operationMode || '').trim().toLowerCase();
    const mode = modeRaw === 'approval' ? 'approval' : 'notify';
    const rejectNextTaskIds = normalizeReferenceArray(
      source?.rejectNextTaskIds ?? source?.rejectNextTaskId
    );
    const fallbackTemplateId =
      mode === 'approval' ? 'workflow-mayor-involvement-approval' : 'workflow-mayor-involvement-notify';
    const templateId =
      typeof source?.templateId === 'string' && source.templateId.trim()
        ? source.templateId
        : fallbackTemplateId;
    return {
      ...base,
      ...source,
      mode,
      operationMode: mode,
      templateId,
      approvalQuestion:
        typeof source?.approvalQuestion === 'string' && source.approvalQuestion.trim()
          ? source.approvalQuestion
          : base.approvalQuestion,
      timeoutHours: Number.isFinite(Number(source?.timeoutHours))
        ? Math.max(0, Math.floor(Number(source.timeoutHours)))
        : base.timeoutHours,
      timeoutMinutes: Number.isFinite(Number(source?.timeoutMinutes))
        ? Math.max(0, Math.floor(Number(source.timeoutMinutes)))
        : 0,
      rejectNextTaskIds,
      rejectNextTaskId: normalizeSingleReference(source?.rejectNextTaskId) || rejectNextTaskIds[0] || '',
    };
  }

  if (type === 'DATENNACHFORDERUNG' || type === 'ENHANCED_CATEGORIZATION' || type === 'FREE_AI_DATA_REQUEST') {
    const rejectNextTaskIds = normalizeReferenceArray(
      source?.rejectNextTaskIds ?? source?.rejectNextTaskId
    );
    const normalizedFields =
      Array.isArray(source?.fields)
        ? source.fields
            .map((field: any) => {
              const key = String(field?.key || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
              if (!key) return null;
              const label = String(field?.label || key).trim();
              const typeRaw = String(field?.type || 'short_text').trim().toLowerCase();
              const fieldType = ['yes_no', 'single_choice', 'number', 'quantity', 'short_text'].includes(typeRaw)
                ? typeRaw
                : 'short_text';
              const options =
                fieldType === 'single_choice' && Array.isArray(field?.options)
                  ? field.options
                      .map((option: any) => {
                        const value = String(option?.value ?? option ?? '').trim();
                        if (!value) return null;
                        return { value, label: String(option?.label || value).trim() || value };
                      })
                      .filter((option: any) => option !== null)
                  : [];
              return {
                key,
                label: label || key,
                type: fieldType,
                required:
                  type === 'ENHANCED_CATEGORIZATION' || type === 'FREE_AI_DATA_REQUEST'
                    ? false
                    : field?.required === true,
                ...(options.length > 0 ? { options } : {}),
              };
            })
            .filter((field: any) => field !== null)
        : base.fields;

    return {
      ...base,
      ...source,
      recipientType: source?.recipientType === 'custom' ? 'custom' : 'citizen',
      recipientEmailSource: normalizeRecipientEmailSource(source?.recipientEmailSource),
      recipientOrgUnitId:
        typeof source?.recipientOrgUnitId === 'string' ? source.recipientOrgUnitId : base.recipientOrgUnitId,
      recipientEmail: typeof source?.recipientEmail === 'string' ? source.recipientEmail : base.recipientEmail,
      recipientName: typeof source?.recipientName === 'string' ? source.recipientName : base.recipientName,
      templateId:
        typeof source?.templateId === 'string' && source.templateId.trim()
          ? source.templateId
          : base.templateId,
      subject: typeof source?.subject === 'string' ? source.subject : base.subject,
      introText: typeof source?.introText === 'string' ? source.introText : base.introText,
      fields: normalizedFields,
      collectionObjective:
        typeof source?.collectionObjective === 'string'
          ? source.collectionObjective
          : typeof source?.requestedInformation === 'string'
          ? source.requestedInformation
          : typeof source?.requestedInfo === 'string'
          ? source.requestedInfo
          : typeof source?.requested_information === 'string'
          ? source.requested_information
          : typeof source?.informationGoal === 'string'
          ? source.informationGoal
          : base.collectionObjective,
      questionPrompt: typeof source?.questionPrompt === 'string' ? source.questionPrompt : base.questionPrompt,
      questionPromptMode: source?.questionPromptMode === 'override' ? 'override' : 'append',
      enableNeedCheck:
        typeof source?.enableNeedCheck === 'boolean' ? source.enableNeedCheck : base.enableNeedCheck,
      needCheckPrompt: typeof source?.needCheckPrompt === 'string' ? source.needCheckPrompt : base.needCheckPrompt,
      needCheckConfidenceThreshold:
        type === 'FREE_AI_DATA_REQUEST'
          ? Number.isFinite(Number(source?.needCheckConfidenceThreshold))
            ? Math.max(0, Math.min(1, Number(source.needCheckConfidenceThreshold)))
            : Number.isFinite(Number(source?.confidenceThreshold))
            ? Math.max(0, Math.min(1, Number(source.confidenceThreshold)))
            : base.needCheckConfidenceThreshold
          : undefined,
      answerEvaluationPrompt:
        typeof source?.answerEvaluationPrompt === 'string'
          ? source.answerEvaluationPrompt
          : base.answerEvaluationPrompt,
      enableRecategorization:
        type === 'ENHANCED_CATEGORIZATION'
          ? source?.enableRecategorization !== false
          : source?.enableRecategorization === true,
      maxQuestionsPerCycle: Number.isFinite(Number(source?.maxQuestionsPerCycle))
        ? Math.max(1, Math.min(25, Math.floor(Number(source.maxQuestionsPerCycle))))
        : base.maxQuestionsPerCycle,
      allowFollowUpCycles: source?.allowFollowUpCycles === true,
      maxFollowUpCycles: Number.isFinite(Number(source?.maxFollowUpCycles))
        ? Math.max(1, Math.min(8, Math.floor(Number(source.maxFollowUpCycles))))
        : base.maxFollowUpCycles,
      parallelMode: source?.parallelMode !== false,
      timeoutHours: Number.isFinite(Number(source?.timeoutHours))
        ? Math.max(0, Math.floor(Number(source.timeoutHours)))
        : base.timeoutHours,
      timeoutMinutes: Number.isFinite(Number(source?.timeoutMinutes))
        ? Math.max(0, Math.floor(Number(source.timeoutMinutes)))
        : 0,
      variablePrefix: typeof source?.variablePrefix === 'string' ? source.variablePrefix : base.variablePrefix,
      aliasPrefix: typeof source?.aliasPrefix === 'string' ? source.aliasPrefix : base.aliasPrefix,
      createAlias: source?.createAlias !== false,
      responseCommentVisibility: source?.responseCommentVisibility === 'public' ? 'public' : 'internal',
      aiCommentVisibility: source?.aiCommentVisibility === 'public' ? 'public' : 'internal',
      rejectNextTaskIds,
      rejectNextTaskId: normalizeSingleReference(source?.rejectNextTaskId) || rejectNextTaskIds[0] || '',
    };
  }

  if (type === 'INTERNAL_PROCESSING') {
    const mode = source?.mode === 'parallel' ? 'parallel' : 'blocking';
    const assigneeStrategy =
      source?.assigneeStrategy === 'fixed_user' ||
      source?.assigneeStrategy === 'fixed_org' ||
      source?.assigneeStrategy === 'process_variable'
        ? source.assigneeStrategy
        : 'ticket_primary';
    const taskSource = source?.taskSource === 'ai_generated' ? 'ai_generated' : 'static';
    const formFieldsRaw =
      source?.formSchema && typeof source.formSchema === 'object' && Array.isArray(source.formSchema.fields)
        ? source.formSchema.fields
        : Array.isArray(source?.formSchema)
        ? source.formSchema
        : [];
    const formFields = formFieldsRaw
      .map((field: any, index: number) => {
        if (!field || typeof field !== 'object') return null;
        const key = String(field.key || `field_${index + 1}`)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, '_');
        if (!key) return null;
        const typeRaw = String(field.type || 'text').trim().toLowerCase();
        const fieldType = ['text', 'textarea', 'boolean', 'select', 'date', 'number'].includes(typeRaw)
          ? typeRaw
          : 'text';
        const options =
          fieldType === 'select' && Array.isArray(field.options)
            ? field.options
                .map((option: any) => {
                  const value = String(option?.value ?? option ?? '').trim();
                  if (!value) return null;
                  return {
                    value,
                    label: String(option?.label || value).trim() || value,
                  };
                })
                .filter((option: any) => option !== null)
            : [];
        return {
          key,
          label: String(field.label || key).trim() || key,
          type: fieldType,
          required: field.required === true,
          placeholder: field.placeholder ? String(field.placeholder) : '',
          helpText: field.helpText ? String(field.helpText) : '',
          ...(options.length > 0 ? { options } : {}),
        };
      })
      .filter((field: any) => field !== null);
    const normalizedFormFields =
      formFields.length > 0 ? formFields : ((base.formSchema?.fields as any[]) || []);
    const processVarMappings =
      source?.processVarMappings && typeof source.processVarMappings === 'object' && !Array.isArray(source.processVarMappings)
        ? Object.fromEntries(
            Object.entries(source.processVarMappings as Record<string, any>)
              .map(([rawKey, rawValue]) => [
                String(rawKey || '')
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9_]+/g, '_'),
                String(rawValue || '').trim(),
              ])
              .filter(([key, value]) => !!key && !!value)
          )
        : (base.processVarMappings || {});
    const normalizeDecisionConfig = (value: any) =>
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      ...base,
      ...source,
      mode,
      assigneeStrategy,
      assigneeUserId: typeof source?.assigneeUserId === 'string' ? source.assigneeUserId : '',
      assigneeOrgUnitId: typeof source?.assigneeOrgUnitId === 'string' ? source.assigneeOrgUnitId : '',
      assigneeProcessVariableKey:
        typeof source?.assigneeProcessVariableKey === 'string'
          ? source.assigneeProcessVariableKey
          : typeof source?.processVariableKey === 'string'
          ? source.processVariableKey
          : '',
      taskSource,
      taskTitle: typeof source?.taskTitle === 'string' ? source.taskTitle : '',
      taskDescription: typeof source?.taskDescription === 'string' ? source.taskDescription : '',
      instructions: typeof source?.instructions === 'string' ? source.instructions : '',
      dueDays: Number.isFinite(Number(source?.dueDays)) ? Math.max(0, Number(source.dueDays)) : 0,
      dueHours: Number.isFinite(Number(source?.dueHours)) ? Math.max(0, Number(source.dueHours)) : 0,
      dueMinutes: Number.isFinite(Number(source?.dueMinutes)) ? Math.max(0, Number(source.dueMinutes)) : 0,
      formSchema: {
        fields: normalizedFormFields,
      },
      processVarMappings,
      onComplete: normalizeDecisionConfig(source?.onComplete),
      onReject: normalizeDecisionConfig(source?.onReject),
    };
  }

  if (type === 'IMAGE_TO_TEXT_ANALYSIS') {
    const modeRaw = String(source?.mode || source?.runMode || '').trim().toLowerCase();
    const mode = modeRaw === 'below_confidence' ? 'below_confidence' : 'always';
    return {
      ...base,
      ...source,
      mode,
      runMode: mode,
      confidenceThreshold: Number.isFinite(Number(source?.confidenceThreshold))
        ? Math.max(0, Math.min(1, Number(source.confidenceThreshold)))
        : base.confidenceThreshold,
      confidenceVariableKey:
        typeof source?.confidenceVariableKey === 'string'
          ? source.confidenceVariableKey
          : base.confidenceVariableKey,
      onlyMissing: source?.onlyMissing !== false,
      overwriteExisting: source?.overwriteExisting === true,
      includeDescription: source?.includeDescription !== false,
      includeOsmData: source?.includeOsmData === true,
      includeWeatherData: source?.includeWeatherData === true,
      failOnError: source?.failOnError === true,
      addAiComment: source?.addAiComment !== false,
      aiCommentVisibility: source?.aiCommentVisibility === 'public' ? 'public' : 'internal',
    };
  }

  if (type === 'WAIT_STATUS_CHANGE') {
    const explicitStatusMode = Object.prototype.hasOwnProperty.call(source, 'statusMode');
    const sourceStatus = source?.statusAfter ?? source?.targetStatus;
    const normalizedStatus = normalizeStatusValue(sourceStatus);
    const statusAfter = WAIT_STATUS_OPTIONS.some((option) => option.value === normalizedStatus)
      ? normalizedStatus
      : base.statusAfter;
    const statusMode = explicitStatusMode
      ? normalizeWaitFieldModeValue(source?.statusMode)
      : normalizedStatus
      ? 'set'
      : base.statusMode;
    const priorityAfter = normalizePriorityLevelValue(source?.priorityAfter) || base.priorityAfter;
    const explicitAssigneeAfter = String(source?.assigneeAfter || '').trim();
    const explicitPrimaryAssigneeUserId = String(
      source?.assigneeUserIdAfter ||
        source?.primaryAssigneeUserIdAfter ||
        source?.primaryAssigneeUserId ||
        source?.primary_assignee_user_id ||
        ''
    ).trim();
    const explicitPrimaryAssigneeOrgUnitId = String(
      source?.assigneeOrgUnitIdAfter ||
        source?.primaryAssigneeOrgUnitIdAfter ||
        source?.primaryAssigneeOrgUnitId ||
        source?.primary_assignee_org_unit_id ||
        ''
    ).trim();
    const normalizedAssigneeAfter = explicitAssigneeAfter
      ? explicitAssigneeAfter
      : explicitPrimaryAssigneeUserId
      ? `user:${explicitPrimaryAssigneeUserId}`
      : explicitPrimaryAssigneeOrgUnitId
      ? `org:${explicitPrimaryAssigneeOrgUnitId}`
      : '';
    return {
      ...base,
      ...source,
      statusMode,
      statusAfter,
      priorityMode: normalizeWaitFieldModeValue(source?.priorityMode),
      priorityAfter,
      assigneeMode: normalizeWaitFieldModeValue(source?.assigneeMode),
      assigneeAfter: normalizedAssigneeAfter,
      categoryMode: normalizeWaitFieldModeValue(source?.categoryMode),
      categoryAfter:
        source?.categoryAfter === null || source?.categoryAfter === undefined
          ? ''
          : String(source.categoryAfter),
      descriptionMode: normalizeWaitFieldModeValue(source?.descriptionMode),
      descriptionAfter:
        source?.descriptionAfter === null || source?.descriptionAfter === undefined
          ? ''
          : String(source.descriptionAfter),
      addressMode: normalizeWaitFieldModeValue(source?.addressMode),
      addressAfter:
        source?.addressAfter === null || source?.addressAfter === undefined
          ? ''
          : String(source.addressAfter),
      postalCodeMode: normalizeWaitFieldModeValue(source?.postalCodeMode),
      postalCodeAfter:
        source?.postalCodeAfter === null || source?.postalCodeAfter === undefined
          ? ''
          : String(source.postalCodeAfter),
      cityMode: normalizeWaitFieldModeValue(source?.cityMode),
      cityAfter:
        source?.cityAfter === null || source?.cityAfter === undefined
          ? ''
          : String(source.cityAfter),
      responsibilityMode: normalizeWaitFieldModeValue(source?.responsibilityMode),
      responsibilityAfter:
        source?.responsibilityAfter === null || source?.responsibilityAfter === undefined
          ? ''
          : String(source.responsibilityAfter).trim(),
      latitudeMode: normalizeWaitFieldModeValue(source?.latitudeMode),
      latitudeAfter:
        source?.latitudeAfter === null || source?.latitudeAfter === undefined
          ? ''
          : String(source.latitudeAfter),
      longitudeMode: normalizeWaitFieldModeValue(source?.longitudeMode),
      longitudeAfter:
        source?.longitudeAfter === null || source?.longitudeAfter === undefined
          ? ''
          : String(source.longitudeAfter),
      waitHours: Number.isFinite(Number(source?.waitHours)) ? Number(source.waitHours) : base.waitHours,
      waitMinutes: Number.isFinite(Number(source?.waitMinutes)) ? Number(source.waitMinutes) : base.waitMinutes,
      waitSeconds: Number.isFinite(Number(source?.waitSeconds)) ? Number(source.waitSeconds) : base.waitSeconds,
    };
  }

  if (type === 'CHANGE_WORKFLOW') {
    const selectionMode = source?.selectionMode === 'manual' ? 'manual' : 'ai';
    return {
      ...base,
      ...source,
      selectionMode,
      enableAiRecategorization: source?.enableAiRecategorization === true,
      addAiComment: source?.addAiComment !== false,
      aiCommentVisibility: source?.aiCommentVisibility === 'public' ? 'public' : 'internal',
    };
  }

  if (type === 'SUB_WORKFLOW') {
    const selectionMode = source?.selectionMode === 'manual' ? 'manual' : 'ai';
    return {
      ...base,
      ...source,
      selectionMode,
      templateId:
        source?.templateId === null || source?.templateId === undefined
          ? ''
          : String(source.templateId).trim(),
      fallbackTemplateId:
        source?.fallbackTemplateId === null || source?.fallbackTemplateId === undefined
          ? ''
          : String(source.fallbackTemplateId).trim(),
      allowSameTemplate: source?.allowSameTemplate === true,
      reuseActiveChild: source?.reuseActiveChild !== false,
      failOnChildFailure: source?.failOnChildFailure !== false,
    };
  }

  if (type === 'RESPONSIBILITY_CHECK') {
    return {
      ...base,
      ...source,
      applyToTicket: source?.applyToTicket !== false,
      addAiComment: source?.addAiComment !== false,
      aiCommentVisibility: source?.aiCommentVisibility === 'public' ? 'public' : 'internal',
    };
  }

  if (type === 'CATEGORIZATION') {
    return {
      ...base,
      ...source,
      startCategoryWorkflow: source?.startCategoryWorkflow !== false,
      endCurrentWorkflow: source?.endCurrentWorkflow !== false,
      enableOrgUnitAssignment: source?.enableOrgUnitAssignment === true,
      orgAssignmentFallbackOrgUnitId:
        source?.orgAssignmentFallbackOrgUnitId === null ||
        source?.orgAssignmentFallbackOrgUnitId === undefined
          ? source?.fallbackOrgUnitId === null || source?.fallbackOrgUnitId === undefined
            ? ''
            : String(source.fallbackOrgUnitId).trim()
          : String(source.orgAssignmentFallbackOrgUnitId).trim(),
      fallbackTemplateId:
        source?.fallbackTemplateId === null || source?.fallbackTemplateId === undefined
          ? 'standard-redmine-ticket'
          : String(source.fallbackTemplateId).trim() || 'standard-redmine-ticket',
      allowSameTemplateSwitch: source?.allowSameTemplateSwitch === true,
      addAiComment: source?.addAiComment !== false,
      aiCommentVisibility: source?.aiCommentVisibility === 'public' ? 'public' : 'internal',
    };
  }

  if (type === 'REST_API_CALL') {
    const timeoutMs = Number.isFinite(Number(source?.timeoutMs))
      ? Math.max(1000, Math.min(120000, Number(source.timeoutMs)))
      : base.timeoutMs;
    const requestTimeoutMs = Number.isFinite(Number(source?.requestTimeoutMs))
      ? Math.max(500, Math.min(120000, Number(source.requestTimeoutMs)))
      : base.requestTimeoutMs;
    return {
      ...base,
      ...source,
      timeoutMs,
      requestTimeoutMs,
      continueOnError: source?.continueOnError === true,
      baseUrl: typeof source?.baseUrl === 'string' ? source.baseUrl : '',
      sourceCode: typeof source?.sourceCode === 'string' ? source.sourceCode : base.sourceCode,
    };
  }

  if (type === 'END') {
    const scope = source?.scope === 'workflow' || source?.endScope === 'workflow' ? 'workflow' : 'branch';
    return {
      ...base,
      ...source,
      scope,
      endScope: scope,
    };
  }

  if (type === 'JOIN') {
    const requiredArrivals = Number.isFinite(Number(source?.requiredArrivals ?? source?.expectedBranches))
      ? Math.max(1, Math.floor(Number(source.requiredArrivals ?? source.expectedBranches)))
      : 2;
    return {
      ...base,
      ...source,
      requiredArrivals,
      expectedBranches: requiredArrivals,
    };
  }

  if (type === 'SPLIT') {
    const configuredTargets = resolveSplitBranchTargets(source);
    const leftNextTaskId =
      normalizeSingleReference(source?.leftNextTaskId) || configuredTargets[0] || '';
    const rightFallback = configuredTargets.find((id) => id !== leftNextTaskId) || '';
    const rightNextTaskId = normalizeSingleReference(source?.rightNextTaskId) || rightFallback;
    const nextTaskIds = [leftNextTaskId, rightNextTaskId].filter((id) => id.trim().length > 0);

    return {
      ...base,
      ...source,
      leftNextTaskId,
      rightNextTaskId,
      nextTaskIds,
    };
  }

  if (type === 'IF') {
    const conditions = Array.isArray(source?.conditions)
      ? source.conditions.map((condition: any) => {
          const kind = condition?.kind === 'geofence'
            ? 'geofence'
            : condition?.kind === 'process_variable'
            ? 'process_variable'
            : 'field';
          if (kind === 'geofence') {
            const centerLat = asOptionalNumber(condition?.centerLat);
            const centerLon = asOptionalNumber(condition?.centerLon);
            const radiusMeters = asOptionalNumber(condition?.radiusMeters);
            const points = normalizeGeofencePolygonPoints(condition?.points ?? condition?.polygonPoints);
            const shape =
              condition?.shape === 'polygon' || points.length >= 3
                ? 'polygon'
                : 'circle';
            return {
              kind,
              shape,
              operator: condition?.operator === 'outside' ? 'outside' : 'inside',
              centerLat: centerLat === null ? '' : centerLat,
              centerLon: centerLon === null ? '' : centerLon,
              radiusMeters: radiusMeters !== null && radiusMeters > 0 ? radiusMeters : 250,
              points,
            };
          }
          if (kind === 'process_variable') {
            return {
              kind: 'process_variable',
              key:
                typeof condition?.key === 'string' && condition.key.trim()
                  ? condition.key.trim()
                  : typeof condition?.variableKey === 'string' && condition.variableKey.trim()
                  ? condition.variableKey.trim()
                  : 'var.input',
              operator: typeof condition?.operator === 'string' ? condition.operator : 'equals',
              value: condition?.value ?? '',
            };
          }
          const field = normalizeIfFieldValue(condition?.field);
          const operator = normalizeIfOperatorForField(field, condition?.operator);
          const normalizedPriorityValue = normalizePriorityLevelValue(condition?.value);
          const normalizedStatusValue = normalizeStatusValue(condition?.value);
          const normalizedResponsibilityValue =
            condition?.value === null || condition?.value === undefined
              ? ''
              : String(condition.value).trim();
          return {
            kind: 'field',
            field,
            operator,
            value:
              field === 'priority'
                ? normalizedPriorityValue || 'medium'
                : field === 'status'
                ? normalizedStatusValue || 'open'
                : field === 'responsibilityAuthority'
                ? normalizedResponsibilityValue
                : condition?.value ?? '',
          };
        })
      : base.conditions;

    const logic = String(source?.logic || source?.logicalOperator || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
    return {
      ...base,
      ...source,
      logic,
      conditions,
      trueNextTaskId: typeof source?.trueNextTaskId === 'string' ? source.trueNextTaskId : '',
      falseNextTaskId: typeof source?.falseNextTaskId === 'string' ? source.falseNextTaskId : '',
      trueNextTaskIds: normalizeReferenceArray(source?.trueNextTaskIds),
      falseNextTaskIds: normalizeReferenceArray(source?.falseNextTaskIds),
    };
  }

  return { ...base, ...source };
}

function createStep(type: WorkflowStepType = 'REDMINE_TICKET', nodeNumber?: number): EditableWorkflowStep {
  const safeNodeNumber =
    Number.isFinite(Number(nodeNumber)) && Number(nodeNumber) > 0
      ? Math.floor(Number(nodeNumber))
      : 1;
  return {
    localId: makeStepId(),
    title: buildAutoNodeTitle(safeNodeNumber),
    type,
    auto: type === 'JOIN',
    config: normalizeStepConfig(type, {}),
  };
}

function buildStepProcessVariableOutputKeys(step: EditableWorkflowStep): string[] {
  if (
    step.type !== 'DATENNACHFORDERUNG' &&
    step.type !== 'ENHANCED_CATEGORIZATION' &&
    step.type !== 'FREE_AI_DATA_REQUEST'
  ) {
    return [];
  }
  const config = normalizeStepConfig(step.type, step.config || {});
  const fields = Array.isArray(config.fields) ? config.fields : [];
  const canonicalPrefix = String(config.variablePrefix || '')
    .trim()
    .replace(/\.+$/g, '') || `data_request.${step.localId}`;
  const aliasPrefix = String(config.aliasPrefix || 'var')
    .trim()
    .replace(/\.+$/g, '');
  const createAlias = config.createAlias !== false && !!aliasPrefix;
  const keys = new Set<string>();

  fields.forEach((field: any) => {
    const fieldKey = String(field?.key || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!fieldKey) return;
    keys.add(`${canonicalPrefix}.${fieldKey}`.replace(/\.\.+/g, '.'));
    if (createAlias) {
      keys.add(`${aliasPrefix}.${fieldKey}`.replace(/\.\.+/g, '.'));
    }
  });

  return Array.from(keys);
}

function collectKnownProcessVariableKeys(template: EditableTemplate | null): string[] {
  if (!template) return [];
  const keys = new Set<string>();

  template.steps.forEach((step) => {
    buildStepProcessVariableOutputKeys(step).forEach((key) => keys.add(key));
    if (step.type === 'IF') {
      const config = normalizeStepConfig(step.type, step.config || {});
      const conditions = Array.isArray(config.conditions) ? config.conditions : [];
      conditions.forEach((condition: any) => {
        if (condition?.kind !== 'process_variable') return;
        const rawKey =
          typeof condition?.key === 'string' && condition.key.trim()
            ? condition.key.trim()
            : typeof condition?.variableKey === 'string' && condition.variableKey.trim()
            ? condition.variableKey.trim()
            : '';
        if (rawKey) keys.add(rawKey);
      });
    }
  });

  return Array.from(keys).sort((a, b) => a.localeCompare(b, 'de'));
}

function getOutputPortsForNode(nodeType: WorkflowGraphNodeType): GraphPortDescriptor[] {
  if (nodeType === 'START') return [{ key: 'start', label: 'Start' }];
  if (nodeType === 'END') return [];
  if (nodeType === 'SPLIT') {
    return [
      { key: 'left', label: 'A' },
      { key: 'right', label: 'B' },
    ];
  }
  if (nodeType === 'IF') {
    return [
      { key: 'true', label: 'T' },
      { key: 'false', label: 'F' },
    ];
  }
  return [{ key: 'default', label: '→' }];
}

function summarizeGraphNodeMeta(step: EditableWorkflowStep): string {
  const config = normalizeStepConfig(step.type, step.config || {});
  switch (step.type) {
    case 'REDMINE_TICKET': {
      const projectMode = config.projectMode === 'fixed'
        ? `Projekt fix${config.projectId ? ` (${config.projectId})` : ''}`
        : 'Projekt KI';
      const trackerMode = config.trackerMode === 'fixed'
        ? `Tracker fix${config.tracker ? ` (${config.tracker})` : ''}`
        : 'Tracker KI';
      const assigneeMode =
        config.assigneeMode === 'none'
          ? 'ohne Assignee'
          : config.assigneeMode === 'fixed'
          ? `Assignee fix${config.assigneeId ? ` (${config.assigneeId})` : ''}`
          : 'Assignee KI';
      const textMode = config.textMode === 'fixed' ? 'Text fix' : 'Text KI';
      const waitMode = config.waitForTargetStatus ? 'wartet auf Status' : 'kein Status-Wait';
      return `${projectMode} · ${trackerMode} · ${assigneeMode} · ${textMode} · ${waitMode}`;
    }
    case 'SPLIT':
      return 'zwei parallele Pfade';
    case 'JOIN': {
      const requiredArrivals = Number(config.requiredArrivals || config.expectedBranches || 2);
      const safeCount = Number.isFinite(requiredArrivals) ? Math.max(1, Math.floor(requiredArrivals)) : 2;
      return `wartet auf ${safeCount} Pfad${safeCount === 1 ? '' : 'e'}`;
    }
    case 'IF': {
      const logic = config.logic === 'OR' ? 'ODER' : 'UND';
      const conditionCount = Array.isArray(config.conditions) ? config.conditions.length : 0;
      return `${logic} · ${conditionCount} Bedingung${conditionCount === 1 ? '' : 'en'}`;
    }
    case 'END':
      return config.scope === 'workflow' ? 'beendet gesamten Workflow' : 'beendet aktuellen Pfad';
    case 'INTERNAL_PROCESSING': {
      const modeLabel = config.mode === 'parallel' ? 'parallel' : 'blockierend';
      const strategyLabelMap: Record<string, string> = {
        ticket_primary: 'Ticket-Zuweisung',
        fixed_user: `Fixer Nutzer${config.assigneeUserId ? ` (${config.assigneeUserId})` : ''}`,
        fixed_org: `Fixe Organisation${config.assigneeOrgUnitId ? ` (${config.assigneeOrgUnitId})` : ''}`,
        process_variable: `Per Variable${config.assigneeProcessVariableKey ? ` (${config.assigneeProcessVariableKey})` : ''}`,
      };
      const strategyLabel = strategyLabelMap[config.assigneeStrategy] || 'Ticket-Zuweisung';
      const fieldCount =
        config.formSchema && typeof config.formSchema === 'object' && Array.isArray(config.formSchema.fields)
          ? config.formSchema.fields.length
          : 0;
      const sourceLabel = config.taskSource === 'ai_generated' ? 'KI-Taskdesign' : 'statisches Taskdesign';
      return `${modeLabel} · ${strategyLabel} · ${fieldCount} Felder · ${sourceLabel}`;
    }
    case 'WAIT_STATUS_CHANGE': {
      const hours = Number(config.waitHours || 0);
      const minutes = Number(config.waitMinutes || 0);
      const seconds = Number(config.waitSeconds || 0);
      const updates: string[] = [];
      if (config.statusMode === 'set') updates.push(`Status=${config.statusAfter || 'completed'}`);
      if (config.priorityMode === 'set') updates.push(`Priorität=${config.priorityAfter || 'medium'}`);
      if (config.assigneeMode === 'set') {
        const assigneeRaw = String(config.assigneeAfter || '').trim();
        if (!assigneeRaw) {
          updates.push('Primärzuweisung entfernen');
        } else {
          const lowered = assigneeRaw.toLowerCase();
          if (lowered.startsWith('user:')) {
            updates.push(`Primärzuweisung User=${assigneeRaw.slice(5).trim() || '—'}`);
          } else if (lowered.startsWith('org:')) {
            updates.push(`Primärzuweisung Org=${assigneeRaw.slice(4).trim() || '—'}`);
          } else if (lowered.startsWith('assigned:')) {
            updates.push(`Legacy-Zuweisung=${assigneeRaw.slice(9).trim() || 'leer'}`);
          } else {
            updates.push(`Legacy-Zuweisung=${assigneeRaw}`);
          }
        }
      }
      if (config.categoryMode === 'set' && String(config.categoryAfter || '').trim()) updates.push('Kategorie');
      if (config.descriptionMode === 'set' && String(config.descriptionAfter || '').trim()) updates.push('Beschreibung');
      if (config.addressMode === 'set' && String(config.addressAfter || '').trim()) updates.push('Adresse');
      if (config.postalCodeMode === 'set' && String(config.postalCodeAfter || '').trim()) updates.push('PLZ');
      if (config.cityMode === 'set' && String(config.cityAfter || '').trim()) updates.push('Ort');
      if (config.responsibilityMode === 'set' && String(config.responsibilityAfter || '').trim()) {
        updates.push('Zuständigkeit');
      }
      if (config.latitudeMode === 'set' || config.longitudeMode === 'set') updates.push('Koordinaten');
      const updateLabel =
        updates.length === 0
          ? 'keine Feldänderung'
          : updates.length <= 2
          ? updates.join(' · ')
          : `${updates.slice(0, 2).join(' · ')} +${updates.length - 2}`;
      return `${hours}h ${minutes}m ${seconds}s · ${updateLabel}`;
    }
    case 'REST_API_CALL': {
      const timeoutMs = Number(config.timeoutMs || 20000);
      const continueOnError = config.continueOnError === true ? 'continueOnError' : 'hard fail';
      const baseUrl = String(config.baseUrl || '').trim();
      return `${timeoutMs}ms · ${continueOnError}${baseUrl ? ` · ${baseUrl}` : ''}`;
    }
    case 'EMAIL':
    case 'EMAIL_EXTERNAL': {
      const recipientSource = normalizeRecipientEmailSource(config.recipientEmailSource);
      const recipientMode =
        recipientSource === 'org_unit'
          ? `Org-Kontakt${config.recipientOrgUnitId ? ` (${config.recipientOrgUnitId})` : ''}`
          : recipientSource === 'ticket_primary_assignee'
          ? 'Primär-Zuweisung'
          : recipientSource === 'ticket_collaborators'
          ? 'Beteiligte'
          : config.recipientEmail
          ? 'feste Adresse'
          : 'Kategorie/Fallback';
      return `${config.templateId ? `Template: ${config.templateId}` : 'E-Mail-Versand'} · ${recipientMode}`;
    }
    case 'EMAIL_CONFIRMATION':
      return `Freigabe via ${
        config.recipientType === 'custom'
          ? getRecipientSourceSummaryLabel(
              normalizeRecipientEmailSource(config.recipientEmailSource),
              'feste Adresse'
            )
          : 'Bürger-E-Mail'
      }`;
    case 'EMAIL_DOUBLE_OPT_IN':
      return `DOI via ${
        config.recipientType === 'custom'
          ? getRecipientSourceSummaryLabel(
              normalizeRecipientEmailSource(config.recipientEmailSource),
              'feste Adresse'
            )
          : 'Bürger-E-Mail'
      }`;
    case 'MAYOR_INVOLVEMENT':
      return config.mode === 'approval'
        ? 'Ortsbürgermeister-Zustimmung erforderlich'
        : 'Ortsbürgermeister nur informieren';
    case 'DATENNACHFORDERUNG': {
      const recipientSource = normalizeRecipientEmailSource(config.recipientEmailSource);
      const recipientMode =
        config.recipientType === 'custom'
          ? getRecipientSourceSummaryLabel(recipientSource, 'feste Adresse')
          : 'Bürger';
      return `${config.parallelMode === false ? 'blockierend' : 'parallel'} · ${
        Array.isArray(config.fields) ? config.fields.length : 0
      } Felder · ${recipientMode} · Template ${config.templateId || 'workflow-data-request'}`;
    }
    case 'ENHANCED_CATEGORIZATION':
      return `${config.parallelMode === false ? 'blockierend' : 'parallel'} · ${
        config.enableNeedCheck === true ? 'mit Vorprüfung' : 'ohne Vorprüfung'
      } · Rekategorisierung ${config.enableRecategorization !== false ? 'an' : 'aus'}`;
    case 'FREE_AI_DATA_REQUEST': {
      const objective = String(config.collectionObjective || '').trim();
      const thresholdLabel =
        config.enableNeedCheck === true
          ? ` · Schwellwert ${Number(config.needCheckConfidenceThreshold ?? 0.82).toFixed(2)}`
          : '';
      return `${config.parallelMode === false ? 'blockierend' : 'parallel'} · ${
        config.enableNeedCheck === true ? 'mit Vorprüfung' : 'ohne Vorprüfung'
      }${thresholdLabel} · ${
        objective ? `Ziel: ${objective.slice(0, 42)}${objective.length > 42 ? '…' : ''}` : 'freie Zieldefinition'
      }`;
    }
    case 'IMAGE_TO_TEXT_ANALYSIS': {
      const imageContextModules = [
        config.includeDescription !== false ? 'Beschreibung' : '',
        config.includeOsmData === true ? 'OSM' : '',
        config.includeWeatherData === true ? 'Wetter' : '',
      ].filter(Boolean);
      return `${config.mode === 'below_confidence' ? `nur unter ${Number(config.confidenceThreshold ?? 0.75).toFixed(2)}` : 'immer'} · ${
        config.onlyMissing !== false ? 'nur fehlende' : 'alle Bilder'
      } · Kontext: ${imageContextModules.length > 0 ? imageContextModules.join('/') : 'kein Zusatzkontext'}`;
    }
    case 'CITIZEN_NOTIFICATION':
      return config.templateId ? `Template: ${config.templateId}` : 'Bürgerinfo';
    case 'CHANGE_WORKFLOW':
      return `${
        config.selectionMode === 'manual' ? 'fester Ziel-Workflow' : 'KI-Workflow-Auswahl'
      } · Rekategorisierung ${config.enableAiRecategorization === true ? 'an' : 'aus'}`;
    case 'SUB_WORKFLOW':
      return `${
        config.selectionMode === 'manual' ? 'fester Teilworkflow' : 'KI-Teilworkflow-Auswahl'
      } · Reuse ${config.reuseActiveChild !== false ? 'an' : 'aus'} · Fehler ${
        config.failOnChildFailure !== false ? 'brechen ab' : 'laufen weiter'
      }`;
    case 'RESPONSIBILITY_CHECK':
      return `${config.applyToTicket !== false ? 'setzt Ticketfeld' : 'nur Vorschlag'} · ${
        config.addAiComment !== false ? 'mit KI-Kommentar' : 'ohne Kommentar'
      }`;
    case 'CATEGORIZATION':
      return `${config.startCategoryWorkflow !== false ? 'startet Kategorie-Workflow' : 'nur Klassifizierung'} · ${
        config.endCurrentWorkflow !== false ? 'beendet aktuellen Workflow' : 'Workflow läuft weiter'
      } · ${config.enableOrgUnitAssignment === true ? 'Org-Zuweisung optional an' : 'Org-Zuweisung aus'}`;
    case 'CUSTOM':
      return config.note ? String(config.note).slice(0, 50) : 'manueller Platzhalter';
    default:
      return '';
  }
}

function createNewTemplateDraft(): EditableTemplate {
  return {
    name: 'Neuer Workflow',
    description: '',
    executionMode: 'MANUAL',
    autoTriggerOnEmailVerified: false,
    enabled: true,
    runtime: normalizeRuntimeConfig(null),
    steps: [createStep('REDMINE_TICKET', 1)],
  };
}

function toEditableTemplate(template: WorkflowTemplate): EditableTemplate {
  const steps = (template.steps || []).map((step) => ({
    localId: makeStepId(),
    title: step.title || '',
    type: step.type,
    auto: step.type === 'JOIN' ? true : !!step.auto,
    config: step.config || {},
  }));
  const taskToLocal = new Map<string, string>();
  steps.forEach((step, index) => {
    taskToLocal.set(`task-${index}`, step.localId);
  });

  return {
    id: template.id,
    name: template.name || '',
    description: template.description || '',
    executionMode: template.executionMode || 'MANUAL',
    autoTriggerOnEmailVerified: !!template.autoTriggerOnEmailVerified,
    enabled: template.enabled !== false,
    runtime: normalizeRuntimeConfig(template.runtime),
    steps: steps.map((step) => ({
      ...step,
      config: normalizeStepConfig(
        step.type,
        mapTaskReferences(step.type, step.config || {}, (taskId) => taskToLocal.get(taskId) || '')
      ),
    })),
  };
}

function fromEditableTemplate(template: EditableTemplate): Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'> {
  const localToTask = new Map<string, string>();
  template.steps.forEach((step, index) => {
    localToTask.set(step.localId, `task-${index}`);
  });

  return {
    name: template.name.trim(),
    description: template.description.trim(),
    executionMode: template.executionMode,
    autoTriggerOnEmailVerified: template.autoTriggerOnEmailVerified,
    enabled: template.enabled,
    runtime: normalizeRuntimeConfig(template.runtime),
    steps: template.steps.map((step) => ({
      title: step.title.trim() || buildAutoNodeTitle(template.steps.findIndex((candidate) => candidate.localId === step.localId) + 1),
      type: step.type,
      auto: step.type === 'JOIN' ? true : !!step.auto,
      config: normalizeStepConfig(
        step.type,
        mapTaskReferences(step.type, step.config || {}, (localId) => localToTask.get(localId) || '')
      ),
    })),
  };
}

const DATA_REQUEST_FIELD_TYPE_OPTIONS: Array<{
  value: string;
  label: string;
  icon: string;
}> = [
  { value: 'yes_no', label: 'Ja/Nein', icon: 'fa-circle-question' },
  { value: 'single_choice', label: 'Auswahl', icon: 'fa-list-check' },
  { value: 'number', label: 'Zahl', icon: 'fa-hashtag' },
  { value: 'quantity', label: 'Menge', icon: 'fa-ruler-combined' },
  { value: 'short_text', label: 'Kurztext', icon: 'fa-pen' },
];

const INTERNAL_PROCESSING_FIELD_TYPE_OPTIONS: Array<{
  value: 'text' | 'textarea' | 'boolean' | 'select' | 'date' | 'number';
  label: string;
  icon: string;
}> = [
  { value: 'text', label: 'Text', icon: 'fa-font' },
  { value: 'textarea', label: 'Mehrzeilig', icon: 'fa-align-left' },
  { value: 'boolean', label: 'Ja/Nein', icon: 'fa-toggle-on' },
  { value: 'select', label: 'Auswahl', icon: 'fa-list-check' },
  { value: 'date', label: 'Datum', icon: 'fa-calendar-days' },
  { value: 'number', label: 'Zahl', icon: 'fa-hashtag' },
];

function sanitizeRichTextHtml(input: string): string {
  const html = String(input || '');
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*\"[^\"]*\"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

const RichTextEditor: React.FC<{
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
}> = ({ value, placeholder, onChange }) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const syncContentState = useCallback(() => {
    const node = editorRef.current;
    if (!node) return;
    const empty = !String(node.textContent || '').trim();
    setIsEmpty(empty);
  }, []);

  useEffect(() => {
    const node = editorRef.current;
    if (!node || focused) return;
    const sanitized = sanitizeRichTextHtml(value || '');
    if (node.innerHTML !== sanitized) {
      node.innerHTML = sanitized;
    }
    syncContentState();
  }, [value, focused, syncContentState]);

  const emitChange = useCallback(() => {
    const node = editorRef.current;
    if (!node) return;
    onChange(sanitizeRichTextHtml(node.innerHTML || ''));
    syncContentState();
  }, [onChange, syncContentState]);

  const executeCommand = useCallback(
    (command: string, commandValue?: string) => {
      const node = editorRef.current;
      if (!node) return;
      node.focus();
      document.execCommand(command, false, commandValue);
      emitChange();
    },
    [emitChange]
  );

  const handleLink = useCallback(() => {
    const input = window.prompt('Link-URL eingeben (https://...)');
    if (!input) return;
    const url = input.trim();
    if (!url) return;
    executeCommand('createLink', url);
  }, [executeCommand]);

  return (
    <div className="richtext-editor">
      <div className="richtext-toolbar">
        <button type="button" onClick={() => executeCommand('bold')} title="Fett">
          <i className="fa-solid fa-bold" />
        </button>
        <button type="button" onClick={() => executeCommand('italic')} title="Kursiv">
          <i className="fa-solid fa-italic" />
        </button>
        <button type="button" onClick={() => executeCommand('underline')} title="Unterstrichen">
          <i className="fa-solid fa-underline" />
        </button>
        <button type="button" onClick={() => executeCommand('insertUnorderedList')} title="Aufzählung">
          <i className="fa-solid fa-list-ul" />
        </button>
        <button type="button" onClick={() => executeCommand('insertOrderedList')} title="Nummerierung">
          <i className="fa-solid fa-list-ol" />
        </button>
        <button type="button" onClick={handleLink} title="Link">
          <i className="fa-solid fa-link" />
        </button>
        <button type="button" onClick={() => executeCommand('removeFormat')} title="Formatierung entfernen">
          <i className="fa-solid fa-eraser" />
        </button>
      </div>
      <div
        ref={editorRef}
        className={`richtext-surface${isEmpty ? ' is-empty' : ''}`}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder || 'Text eingeben...'}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          emitChange();
        }}
        onInput={emitChange}
      />
    </div>
  );
};

const WorkflowSettings: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { selection: scopeSelection } = useAdminScopeContext();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplateOption[]>([]);
  const [redmineStatuses, setRedmineStatuses] = useState<RedmineIssueStatus[]>([]);
  const [redmineProjects, setRedmineProjects] = useState<RedmineProjectOption[]>([]);
  const [redmineTrackers, setRedmineTrackers] = useState<RedmineTrackerOption[]>([]);
  const [redmineUsers, setRedmineUsers] = useState<RedmineUserOption[]>([]);
  const [redmineGroups, setRedmineGroups] = useState<RedmineGroupOption[]>([]);
  const [responsibilityAuthorityOptions, setResponsibilityAuthorityOptions] = useState<string[]>(
    [...DEFAULT_RESPONSIBILITY_AUTHORITIES]
  );
  const [orgUnitDirectory, setOrgUnitDirectory] = useState<AssignmentOrgUnitOption[]>([]);
  const [adminUserDirectory, setAdminUserDirectory] = useState<AssignmentAdminUserOption[]>([]);
  const [assignmentDirectoryLoading, setAssignmentDirectoryLoading] = useState(false);
  const [assignmentDirectoryError, setAssignmentDirectoryError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditableTemplate | null>(null);
  const [newStepType, setNewStepType] = useState<WorkflowStepType>('REDMINE_TICKET');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [templateViewMode, setTemplateViewMode] = useState<TemplateViewMode>('cards');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');
  const [generatingConfirmationInstructionFor, setGeneratingConfirmationInstructionFor] = useState<string | null>(null);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [splitTargetPick, setSplitTargetPick] = useState<{
    splitStepId: string;
    branch: 'left' | 'right';
  } | null>(null);
  const [nextTargetPick, setNextTargetPick] = useState<{
    stepId: string;
  } | null>(null);
  const [graphConnectionDraft, setGraphConnectionDraft] = useState<{
    sourceNodeId: string;
    sourcePort: GraphPortKey;
  } | null>(null);
  const [graphCursorPoint, setGraphCursorPoint] = useState<{ x: number; y: number } | null>(null);
  const [graphInsertType, setGraphInsertType] = useState<WorkflowStepType>('REDMINE_TICKET');
  const [graphZoom, setGraphZoom] = useState(1);
  const [graphViewMode, setGraphViewMode] = useState<WorkflowGraphViewMode>('standard');
  const [graphNodePositions, setGraphNodePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [graphDragging, setGraphDragging] = useState<{
    nodeId: string;
    pointerStart: { x: number; y: number };
    nodeStart: { x: number; y: number };
  } | null>(null);
  const [graphQuickInsertDraft, setGraphQuickInsertDraft] = useState<{
    sourceNodeId: string;
    sourcePort: GraphPortKey;
    graphX: number;
    graphY: number;
    clientX: number;
    clientY: number;
    nodeType: WorkflowStepType;
  } | null>(null);
  const graphSvgRef = useRef<SVGSVGElement | null>(null);
  const graphCanvasWrapRef = useRef<HTMLDivElement | null>(null);
  const graphSuppressClickRef = useRef(false);
  const [editorPanels, setEditorPanels] = useState<Record<WorkflowEditorPanelKey, boolean>>({
    meta: true,
    graph: true,
    flow: true,
  });
  const [restProbeInputByStepId, setRestProbeInputByStepId] = useState<Record<string, string>>({});
  const [restProbeAnalyzeByStepId, setRestProbeAnalyzeByStepId] = useState<Record<string, boolean>>({});
  const [restProbeResultByStepId, setRestProbeResultByStepId] = useState<Record<string, RestProbeResultPayload>>({});
  const [restProbeLoadingStepId, setRestProbeLoadingStepId] = useState<string | null>(null);

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de')),
    [templates]
  );
  const activeEditorTemplateMeta = useMemo(
    () => (editor?.id ? sortedTemplates.find((template) => template.id === editor.id) || null : null),
    [editor?.id, sortedTemplates]
  );
  const activeEditorScopeBadge = useMemo(
    () => (activeEditorTemplateMeta ? resolveWorkflowScopeBadge(activeEditorTemplateMeta) : null),
    [activeEditorTemplateMeta]
  );

  const sortedEmailTemplates = useMemo(
    () => [...emailTemplates].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'de')),
    [emailTemplates]
  );
  const availableProcessVariableKeys = useMemo(
    () => collectKnownProcessVariableKeys(editor),
    [editor]
  );
  const availableRedmineProjects = useMemo(() => {
    const pool = redmineProjects.some((project) => project.enabled)
      ? redmineProjects.filter((project) => project.enabled)
      : redmineProjects;
    return [...pool].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de'));
  }, [redmineProjects]);
  const availableRedmineTrackers = useMemo(() => {
    const pool = redmineTrackers.some((tracker) => tracker.enabled)
      ? redmineTrackers.filter((tracker) => tracker.enabled)
      : redmineTrackers;
    return [...pool].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de'));
  }, [redmineTrackers]);
  const availableRedmineAssignees = useMemo(() => {
    const hasEnabledUsers = redmineUsers.some((user) => user.enabled === true);
    const userPool = hasEnabledUsers ? redmineUsers.filter((user) => user.enabled === true) : redmineUsers;
    const users = userPool
      .map((user) => ({
        id: `user:${user.id}`,
        label: `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login || user.mail || `User ${user.id}`,
        rawId: user.id,
      }));
    const hasGroupSelection = redmineGroups.some((group) => typeof group.enabled === 'boolean');
    const groupPool = hasGroupSelection
      ? redmineGroups.filter((group) => group.enabled === true)
      : redmineGroups;
    const groups = groupPool.map((group) => ({
      id: `group:${group.id}`,
      label: `${group.name} (Gruppe)`,
      rawId: group.id,
    }));
    return [...users, ...groups].sort((a, b) => a.label.localeCompare(b.label, 'de'));
  }, [redmineUsers, redmineGroups]);
  const fixedProjectOptions = useMemo(
    () =>
      availableRedmineProjects.map((project) => ({
        value: String(project.identifier || project.id),
        label: `${project.name}${project.identifier ? ` (${project.identifier})` : ''}`,
      })),
    [availableRedmineProjects]
  );
  const fixedTrackerOptions = useMemo(
    () =>
      availableRedmineTrackers.map((tracker) => ({
        value: String(tracker.id),
        label: tracker.name,
      })),
    [availableRedmineTrackers]
  );
  const fixedAssigneeOptions = useMemo(
    () =>
      availableRedmineAssignees.map((assignee) => ({
        value: String(assignee.id),
        label: assignee.label,
        legacyValue: String(assignee.rawId),
      })),
    [availableRedmineAssignees]
  );
  const fixedInternalUserOptions = useMemo(
    () =>
      [...adminUserDirectory].sort((a, b) =>
        buildAssignmentUserLabel(a).localeCompare(buildAssignmentUserLabel(b), 'de', { sensitivity: 'base' })
      ),
    [adminUserDirectory]
  );
  const fixedInternalOrgOptions = useMemo(
    () => [...orgUnitDirectory].sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })),
    [orgUnitDirectory]
  );
  const orgUnitDirectoryById = useMemo(
    () => new Map(orgUnitDirectory.map((entry) => [entry.id, entry])),
    [orgUnitDirectory]
  );
  const orgEmailRecipientOptions = useMemo(
    () =>
      [...orgUnitDirectory]
        .filter((entry) => String(entry.contactEmail || '').trim().length > 0)
        .sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })),
    [orgUnitDirectory]
  );
  const resolveRecipientOrgUnitOptions = useCallback(
    (currentOrgUnitId?: string) => {
      const normalizedCurrentId = String(currentOrgUnitId || '').trim();
      const options = [...orgEmailRecipientOptions];
      if (normalizedCurrentId && !options.some((entry) => entry.id === normalizedCurrentId)) {
        const fallback = orgUnitDirectoryById.get(normalizedCurrentId);
        if (fallback) {
          options.unshift(fallback);
        } else {
          options.unshift({
            id: normalizedCurrentId,
            tenantId: '',
            parentId: null,
            name: normalizedCurrentId,
            label: normalizedCurrentId,
            contactEmail: null,
            active: false,
          });
        }
      }
      return options;
    },
    [orgEmailRecipientOptions, orgUnitDirectoryById]
  );
  const [workflowAiDialog, setWorkflowAiDialog] = useState<WorkflowAiGenerateDialogState | null>(null);
  const [workflowImportDialog, setWorkflowImportDialog] = useState<WorkflowImportDialogState | null>(null);
  const selectedImportTemplates = useMemo(() => {
    if (!workflowImportDialog) return [];
    const selectedSet = new Set(workflowImportDialog.selectedSourceIndexes);
    return workflowImportDialog.templates.filter((template) => selectedSet.has(template.sourceIndex));
  }, [workflowImportDialog]);
  const selectedImportTemplate = useMemo(() => {
    return selectedImportTemplates.length === 1 ? selectedImportTemplates[0] : null;
  }, [selectedImportTemplates]);
  const workflowScopeParams = useMemo(
    () =>
      scopeSelection.scope === 'tenant' && scopeSelection.tenantId
        ? { scope: 'tenant' as const, tenantId: scopeSelection.tenantId }
        : { scope: 'platform' as const, tenantId: '' },
    [scopeSelection.scope, scopeSelection.tenantId]
  );
  const stepCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const importTemplatesInputRef = useRef<HTMLInputElement | null>(null);
  const editorImportTemplateInputRef = useRef<HTMLInputElement | null>(null);
  const [focusedStepId, setFocusedStepId] = useState<string | null>(null);
  const slaDurationParts = useMemo(
    () =>
      splitSlaTargetMinutes(
        editor?.runtime?.sla?.targetMinutes ?? DEFAULT_WORKFLOW_RUNTIME.sla.targetMinutes
      ),
    [editor?.runtime?.sla?.targetMinutes]
  );

  const updateSlaDurationPart = useCallback(
    (part: keyof WorkflowSlaDurationParts, rawValue: string) => {
      const nextValue = Math.max(0, Math.floor(Number(rawValue) || 0));
      setEditor((prev) => {
        if (!prev) return prev;
        const currentParts = splitSlaTargetMinutes(prev.runtime.sla.targetMinutes);
        const nextParts: WorkflowSlaDurationParts = {
          ...currentParts,
          [part]: nextValue,
        };
        return {
          ...prev,
          runtime: {
            ...prev.runtime,
            sla: {
              ...prev.runtime.sla,
              targetMinutes: combineSlaDurationParts(nextParts),
            },
          },
        };
      });
    },
    []
  );

  const setEditorQuery = (editorId: string | null, replace = false) => {
    const query = new URLSearchParams(location.search);
    query.delete('createWorkflow');
    if (editorId) {
      query.set('editor', editorId);
    } else {
      query.delete('editor');
    }

    const nextSearch = query.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace }
    );
  };

  const toggleEditorPanel = (panelKey: WorkflowEditorPanelKey) => {
    setEditorPanels((prev) => ({ ...prev, [panelKey]: !prev[panelKey] }));
  };

  const updateGraphZoom = useCallback((nextZoom: number | ((current: number) => number)) => {
    setGraphZoom((current) => {
      const raw = typeof nextZoom === 'function' ? nextZoom(current) : nextZoom;
      const bounded = Math.max(0.55, Math.min(1.9, Number(raw)));
      return Number.isFinite(bounded) ? Number(bounded.toFixed(2)) : current;
    });
  }, []);

  useEffect(() => {
    const container = graphCanvasWrapRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const step = event.deltaY < 0 ? 0.08 : -0.08;
      updateGraphZoom((value) => value + step);
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [updateGraphZoom, editor, editorPanels.graph]);

  const resolveEmailTemplateOptions = (
    preferredTemplateIds: string[],
    currentTemplateId?: string
  ) => {
    const optionMap = new Map<string, string>();
    const addOption = (id: string, label?: string) => {
      const key = String(id || '').trim();
      if (!key || optionMap.has(key)) return;
      optionMap.set(key, (label || TEMPLATE_FALLBACK_LABELS[key] || key).trim());
    };

    preferredTemplateIds.forEach((templateId) => addOption(templateId));
    sortedEmailTemplates.forEach((template) =>
      addOption(template.id, template.name || TEMPLATE_FALLBACK_LABELS[template.id])
    );
    if (currentTemplateId && !optionMap.has(currentTemplateId)) {
      addOption(currentTemplateId, `Benutzerdefiniert (${currentTemplateId})`);
    }

    return Array.from(optionMap.entries()).map(([id, label]) => ({ id, label }));
  };

  const loadAssignmentDirectory = useCallback(async () => {
    const token = getAdminToken();
    if (!token) {
      setOrgUnitDirectory([]);
      setAdminUserDirectory([]);
      setAssignmentDirectoryError('Keine gültige Admin-Session für Zuweisungsdaten.');
      return;
    }

    setAssignmentDirectoryLoading(true);
    setAssignmentDirectoryError(null);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const directory = await fetchAssignmentDirectory(headers, { includeInactiveOrgUnits: true });
      setOrgUnitDirectory(directory.orgUnits);
      setAdminUserDirectory(directory.users);
    } catch {
      setOrgUnitDirectory([]);
      setAdminUserDirectory([]);
      setAssignmentDirectoryError('Zuweisungsdaten konnten nicht geladen werden.');
    } finally {
      setAssignmentDirectoryLoading(false);
    }
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const token = getAdminToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [templateResponse, redmineResponse, emailTemplateResponse, generalConfigResponse] = await Promise.all([
        axios.get('/api/admin/config/workflow/templates', {
          headers,
          params: {
            scope: workflowScopeParams.scope,
            tenantId: workflowScopeParams.scope === 'tenant' ? workflowScopeParams.tenantId : undefined,
          },
        }),
        axios.get('/api/admin/config/redmine', { headers }),
        axios
          .get('/api/admin/config/templates', {
            headers,
            params: {
              scope: workflowScopeParams.scope,
              tenantId: workflowScopeParams.scope === 'tenant' ? workflowScopeParams.tenantId : undefined,
            },
          })
          .catch(() => null),
        axios.get('/api/admin/config/general', { headers }).catch(() => null),
      ]);

      setTemplates(Array.isArray(templateResponse.data) ? templateResponse.data : []);
      setRedmineStatuses(Array.isArray(redmineResponse.data?.issueStatuses) ? redmineResponse.data.issueStatuses : []);
      setRedmineProjects(Array.isArray(redmineResponse.data?.projects) ? redmineResponse.data.projects : []);
      setRedmineTrackers(Array.isArray(redmineResponse.data?.trackers) ? redmineResponse.data.trackers : []);
      setRedmineUsers(Array.isArray(redmineResponse.data?.assignableUsers) ? redmineResponse.data.assignableUsers : []);
      setRedmineGroups(
        normalizeRedmineGroups(redmineResponse.data?.groups, redmineResponse.data?.assignableGroupIds)
      );
      const rawTemplates = Array.isArray(emailTemplateResponse?.data)
        ? emailTemplateResponse?.data
        : Array.isArray(emailTemplateResponse?.data?.templates)
        ? emailTemplateResponse?.data?.templates
        : [];
      const normalizedEmailTemplates = rawTemplates
        .filter((template: any) => template && typeof template.id === 'string')
        .map((template: any) => ({
          id: template.id,
          name: String(template.name || template.id),
        }));
      setEmailTemplates(normalizedEmailTemplates);
      const normalizedAuthorities = mergeDistinctTextOptions(
        DEFAULT_RESPONSIBILITY_AUTHORITIES,
        generalConfigResponse?.data?.responsibilityAuthorities
      );
      setResponsibilityAuthorityOptions(
        normalizedAuthorities.length > 0
          ? normalizedAuthorities
          : [...DEFAULT_RESPONSIBILITY_AUTHORITIES]
      );
      setMessage('');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Workflow-Definitionen konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [workflowScopeParams.scope, workflowScopeParams.tenantId]);

  useEffect(() => {
    void loadAssignmentDirectory();
  }, [loadAssignmentDirectory]);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.get('createWorkflow') !== '1') return;
    query.delete('createWorkflow');
    if (!query.get('editor')) {
      query.set('editor', 'new');
    }
    const nextSearch = query.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const editorId = query.get('editor');
    if (!editorId) {
      setEditor(null);
      return;
    }

    setDraggedStepId(null);
    setDropIndex(null);
    setNewStepType('REDMINE_TICKET');

    if (editorId === 'new') {
      setEditor((prev) => {
        if (prev && !prev.id) return prev;
        return createNewTemplateDraft();
      });
      return;
    }

    const matchedTemplate = templates.find((template) => template.id === editorId);
    if (!matchedTemplate) {
      if (!loading) {
        setMessageType('error');
        setMessage('Die angeforderte Workflow-Vorlage wurde nicht gefunden.');
        const nextQuery = new URLSearchParams(location.search);
        nextQuery.delete('editor');
        nextQuery.delete('createWorkflow');
        const nextSearch = nextQuery.toString();
        navigate(
          {
            pathname: location.pathname,
            search: nextSearch ? `?${nextSearch}` : '',
          },
          { replace: true }
        );
      }
      return;
    }

    setEditor((prev) => {
      if (prev?.id === matchedTemplate.id) return prev;
      return toEditableTemplate(matchedTemplate);
    });
  }, [loading, location.pathname, location.search, navigate, templates]);

  useEffect(() => {
    if (!editor) {
      setFocusedStepId(null);
      setSplitTargetPick(null);
      setNextTargetPick(null);
      setGraphConnectionDraft(null);
      setGraphCursorPoint(null);
      setGraphQuickInsertDraft(null);
      setGraphNodePositions({});
      setGraphDragging(null);
      stepCardRefs.current = {};
      return;
    }
    if (editor.steps.length > 0) {
      const fallbackStepId = editor.steps[0].localId;
      if (!focusedStepId || !editor.steps.some((step) => step.localId === focusedStepId)) {
        setFocusedStepId(fallbackStepId);
      }
    } else if (focusedStepId) {
      setFocusedStepId(null);
    }
    if (
      splitTargetPick &&
      !editor.steps.some((step) => step.localId === splitTargetPick.splitStepId && step.type === 'SPLIT')
    ) {
      setSplitTargetPick(null);
    }
    if (nextTargetPick && !editor.steps.some((step) => step.localId === nextTargetPick.stepId)) {
      setNextTargetPick(null);
    }
    if (
      graphConnectionDraft &&
      graphConnectionDraft.sourceNodeId !== '__start__' &&
      !editor.steps.some((step) => step.localId === graphConnectionDraft.sourceNodeId)
    ) {
      setGraphConnectionDraft(null);
      setGraphCursorPoint(null);
      setGraphQuickInsertDraft(null);
    }
    const validIds = new Set(editor.steps.map((step) => step.localId));
    setGraphNodePositions((prev) => {
      const nextEntries = Object.entries(prev).filter(([nodeId]) => validIds.has(nodeId));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries);
    });
  }, [editor, focusedStepId, splitTargetPick, nextTargetPick, graphConnectionDraft]);

  useEffect(() => {
    if (splitTargetPick || nextTargetPick) {
      setGraphConnectionDraft(null);
      setGraphCursorPoint(null);
      setGraphQuickInsertDraft(null);
    }
  }, [splitTargetPick, nextTargetPick]);

  useEffect(() => {
    if (!graphConnectionDraft) {
      setGraphQuickInsertDraft(null);
    }
  }, [graphConnectionDraft]);

  const updateStep = (localId: string, updater: (step: EditableWorkflowStep) => EditableWorkflowStep) => {
    setEditor((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map((step) => (step.localId === localId ? updater(step) : step)),
      };
    });
  };

  const reorderStepToIndex = (sourceStepId: string, targetIndex: number) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const sourceIndex = prev.steps.findIndex((step) => step.localId === sourceStepId);
      if (sourceIndex === -1) return prev;

      const boundedTarget = Math.max(0, Math.min(targetIndex, prev.steps.length));
      const nextSteps = [...prev.steps];
      const [moved] = nextSteps.splice(sourceIndex, 1);
      const insertIndex = sourceIndex < boundedTarget ? boundedTarget - 1 : boundedTarget;
      nextSteps.splice(insertIndex, 0, moved);
      return { ...prev, steps: nextSteps };
    });
  };

  const closeEditor = () => {
    setEditor(null);
    setDraggedStepId(null);
    setDropIndex(null);
    setSplitTargetPick(null);
    setNextTargetPick(null);
    setGraphConnectionDraft(null);
    setGraphCursorPoint(null);
    setGraphNodePositions({});
    setGraphDragging(null);
    setGraphZoom(1);
    setNewStepType('REDMINE_TICKET');
    setGraphInsertType('REDMINE_TICKET');
    setEditorQuery(null);
  };

  const startCreateTemplate = () => {
    setEditor(createNewTemplateDraft());
    setDraggedStepId(null);
    setDropIndex(null);
    setSplitTargetPick(null);
    setNextTargetPick(null);
    setGraphConnectionDraft(null);
    setGraphCursorPoint(null);
    setGraphNodePositions({});
    setGraphDragging(null);
    setGraphZoom(1);
    setNewStepType('REDMINE_TICKET');
    setGraphInsertType('REDMINE_TICKET');
    setMessage('');
    setMessageType('');
    setEditorQuery('new');
  };

  const startEditTemplate = (template: WorkflowTemplate) => {
    const nextEditor = toEditableTemplate(template);
    setEditor(nextEditor);
    setDraggedStepId(null);
    setDropIndex(null);
    setSplitTargetPick(null);
    setNextTargetPick(null);
    setGraphConnectionDraft(null);
    setGraphCursorPoint(null);
    setGraphNodePositions({});
    setGraphDragging(null);
    setGraphZoom(1);
    setNewStepType('REDMINE_TICKET');
    setGraphInsertType('REDMINE_TICKET');
    setMessage('');
    setMessageType('');
    setEditorQuery(template.id);
  };

  const startDuplicateTemplate = (template: WorkflowTemplate) => {
    const nextEditor = toEditableTemplate(template);
    setEditor({
      ...nextEditor,
      id: undefined,
      name: `${(template.name || 'Workflow').trim()} (Kopie)`.trim(),
    });
    setDraggedStepId(null);
    setDropIndex(null);
    setSplitTargetPick(null);
    setNextTargetPick(null);
    setGraphConnectionDraft(null);
    setGraphCursorPoint(null);
    setGraphNodePositions({});
    setGraphDragging(null);
    setGraphZoom(1);
    setNewStepType('REDMINE_TICKET');
    setGraphInsertType('REDMINE_TICKET');
    setMessage('');
    setMessageType('');
    setEditorQuery('new');
  };

  const handleDeleteTemplate = async (template: WorkflowTemplate) => {
    if (!window.confirm(`Workflow "${template.name}" wirklich löschen?`)) return;
    try {
      setDeletingTemplateId(template.id);
      const token = getAdminToken();
      await axios.delete(`/api/admin/config/workflow/templates/${template.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          scope: workflowScopeParams.scope,
          tenantId: workflowScopeParams.scope === 'tenant' ? workflowScopeParams.tenantId : undefined,
        },
      });
      setTemplates((prev) => prev.filter((item) => item.id !== template.id));
      setMessageType('success');
      setMessage('Workflow gelöscht');
      if (editor?.id === template.id) closeEditor();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Workflow konnte nicht gelöscht werden');
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const sanitizeFilenamePart = (value: string, fallback: string) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return normalized || fallback;
  };

  const downloadJsonFile = (payload: any, fileBaseName: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${fileBaseName}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  };

  const handleExportSingleTemplateAsJson = (template: WorkflowTemplate) => {
    const payload = {
      version: 1,
      dtpn: DTPN_NOTATION_META,
      exportedAt: new Date().toISOString(),
      template,
    };
    const fileBase = `workflow-${sanitizeFilenamePart(template.name || template.id, template.id || 'template')}`;
    downloadJsonFile(payload, fileBase);
    setMessageType('success');
    setMessage(`Workflow "${template.name}" als JSON exportiert.`);
  };

  const handleExportEditorTemplateAsJson = () => {
    if (!editor) return;
    const exported = fromEditableTemplate(editor);
    const now = new Date().toISOString();
    const existing = editor.id ? templates.find((item) => item.id === editor.id) : null;
    const template: WorkflowTemplate = {
      id: editor.id || `template-import-${Date.now()}`,
      name: exported.name || editor.name || 'Importierter Workflow',
      description: exported.description || '',
      steps: exported.steps || [],
      executionMode: exported.executionMode || 'MANUAL',
      autoTriggerOnEmailVerified: !!exported.autoTriggerOnEmailVerified,
      runtime: normalizeRuntimeConfig(exported.runtime),
      enabled: exported.enabled !== false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    handleExportSingleTemplateAsJson(template);
  };

  const normalizeSingleImportedStepType = (rawType: unknown): WorkflowStepType => {
    const normalized = String(rawType || '').trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(STEP_TYPE_LABELS, normalized)
      ? (normalized as WorkflowStepType)
      : 'CUSTOM';
  };

  const normalizeSingleImportedExecutionMode = (rawMode: unknown): WorkflowExecutionMode => {
    const normalized = String(rawMode || '').trim().toUpperCase();
    if (normalized === 'AUTO' || normalized === 'HYBRID' || normalized === 'MANUAL') {
      return normalized as WorkflowExecutionMode;
    }
    return 'MANUAL';
  };

  const extractSingleTemplateCandidate = (input: any): any => {
    const candidates = extractImportedTemplates(input);
    return candidates[0] || null;
  };

  const openEditorImportTemplateDialog = () => {
    editorImportTemplateInputRef.current?.click();
  };

  const handleImportSingleTemplateIntoEditor = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const candidate = extractSingleTemplateCandidate(parsed);
      if (!candidate || !Array.isArray(candidate.steps) || candidate.steps.length === 0) {
        setMessageType('error');
        setMessage('Die Datei enthält keine einzelne Workflow-Definition mit Schritten.');
        return;
      }

      if (
        editor &&
        editor.steps.length > 0 &&
        !window.confirm('Aktuelle Editor-Inhalte durch importierte Workflow-Definition ersetzen?')
      ) {
        return;
      }

      const now = new Date().toISOString();
      const normalizedTemplate: WorkflowTemplate = {
        id: String(candidate.id || `template-import-${Date.now()}`)
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '-') || `template-import-${Date.now()}`,
        name: String(candidate.name || 'Importierter Workflow').trim() || 'Importierter Workflow',
        description: String(candidate.description || '').trim(),
        steps: (candidate.steps || []).map((step: any, index: number) => {
          const type = normalizeSingleImportedStepType(step?.type);
          const titleFallback = buildAutoNodeTitle(index + 1);
          return {
            title: String(step?.title || titleFallback).trim() || titleFallback,
            type,
            config: step?.config && typeof step.config === 'object' && !Array.isArray(step.config) ? step.config : {},
            auto: type === 'JOIN' ? true : !!step?.auto,
          };
        }),
        executionMode: normalizeSingleImportedExecutionMode(candidate.executionMode),
        autoTriggerOnEmailVerified: !!candidate.autoTriggerOnEmailVerified,
        runtime: normalizeRuntimeConfig(candidate.runtime),
        enabled: candidate.enabled !== false,
        createdAt: typeof candidate.createdAt === 'string' && candidate.createdAt.trim() ? candidate.createdAt : now,
        updatedAt: now,
      };

      const editable = toEditableTemplate(normalizedTemplate);
      setEditor({
        ...editable,
        id: undefined,
        name: editable.name || 'Importierter Workflow',
      });
      setDraggedStepId(null);
      setDropIndex(null);
      setSplitTargetPick(null);
      setNextTargetPick(null);
      setGraphConnectionDraft(null);
      setGraphCursorPoint(null);
      setGraphNodePositions({});
      setGraphDragging(null);
      setGraphZoom(1);
      setFocusedStepId(editable.steps[0]?.localId || null);
      setEditorQuery('new');
      setMessageType('success');
      setMessage(`Workflow "${normalizedTemplate.name}" in den Editor importiert.`);
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.message || 'Workflow-Definition konnte nicht importiert werden.');
    } finally {
      if (event.target) event.target.value = '';
    }
  };

  const dataUrlToBytes = (dataUrl: string): Uint8Array => {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  };

  const SVG_EXPORT_STYLE_PROPERTIES = [
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-opacity',
    'stroke-width',
    'stroke-dasharray',
    'stroke-linecap',
    'stroke-linejoin',
    'opacity',
    'color',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-anchor',
    'letter-spacing',
    'word-spacing',
    'shape-rendering',
    'paint-order',
    'filter',
  ] as const;

  const cloneSvgForExport = (svgElement: SVGSVGElement): SVGSVGElement => {
    const clone = svgElement.cloneNode(true) as SVGSVGElement;
    const sourceNodes = [svgElement, ...Array.from(svgElement.querySelectorAll('*'))];
    const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
    const nodeCount = Math.min(sourceNodes.length, cloneNodes.length);

    for (let index = 0; index < nodeCount; index += 1) {
      const sourceNode = sourceNodes[index];
      const cloneNode = cloneNodes[index];
      const computed = window.getComputedStyle(sourceNode);
      const stylePairs: string[] = [];
      for (const property of SVG_EXPORT_STYLE_PROPERTIES) {
        const value = computed.getPropertyValue(property);
        if (!value || !value.trim()) continue;
        stylePairs.push(`${property}:${value.trim()}`);
      }
      if (stylePairs.length > 0) {
        const existingStyle = cloneNode.getAttribute('style');
        cloneNode.setAttribute(
          'style',
          `${existingStyle ? `${existingStyle};` : ''}${stylePairs.join(';')};`
        );
      }
    }

    const viewBox = svgElement.viewBox?.baseVal;
    const fallbackWidth = Number(svgElement.getAttribute('width'));
    const fallbackHeight = Number(svgElement.getAttribute('height'));
    const sourceWidth =
      (viewBox && Number.isFinite(viewBox.width) && viewBox.width > 0 ? viewBox.width : null) ||
      (Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : null) ||
      1200;
    const sourceHeight =
      (viewBox && Number.isFinite(viewBox.height) && viewBox.height > 0 ? viewBox.height : null) ||
      (Number.isFinite(fallbackHeight) && fallbackHeight > 0 ? fallbackHeight : null) ||
      720;

    const backgroundRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    backgroundRect.setAttribute('x', '0');
    backgroundRect.setAttribute('y', '0');
    backgroundRect.setAttribute('width', String(sourceWidth));
    backgroundRect.setAttribute('height', String(sourceHeight));
    backgroundRect.setAttribute('fill', '#ffffff');
    clone.insertBefore(backgroundRect, clone.firstChild);
    clone.setAttribute('style', `${clone.getAttribute('style') || ''};background:#ffffff;`);

    return clone;
  };

  const rasterizeSvgToJpeg = async (
    svgElement: SVGSVGElement
  ): Promise<{ jpegBytes: Uint8Array; width: number; height: number }> => {
    const exportSvg = cloneSvgForExport(svgElement);
    const serializer = new XMLSerializer();
    const serialized = serializer.serializeToString(exportSvg);
    const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = window.URL.createObjectURL(svgBlob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const instance = new Image();
        instance.onload = () => resolve(instance);
        instance.onerror = () => reject(new Error('SVG konnte nicht gerendert werden.'));
        instance.src = svgUrl;
      });

      const viewBox = svgElement.viewBox?.baseVal;
      const fallbackWidth = Number(svgElement.getAttribute('width'));
      const fallbackHeight = Number(svgElement.getAttribute('height'));
      const sourceWidth =
        (viewBox && Number.isFinite(viewBox.width) && viewBox.width > 0 ? viewBox.width : null) ||
        (Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : null) ||
        image.naturalWidth ||
        1200;
      const sourceHeight =
        (viewBox && Number.isFinite(viewBox.height) && viewBox.height > 0 ? viewBox.height : null) ||
        (Number.isFinite(fallbackHeight) && fallbackHeight > 0 ? fallbackHeight : null) ||
        image.naturalHeight ||
        720;
      const exportScale = 2;
      const width = Math.max(1, Math.round(sourceWidth * exportScale));
      const height = Math.max(1, Math.round(sourceHeight * exportScale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas-Kontext konnte nicht erstellt werden.');
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.94);
      return {
        jpegBytes: dataUrlToBytes(jpegDataUrl),
        width,
        height,
      };
    } finally {
      window.URL.revokeObjectURL(svgUrl);
    }
  };

  const createPdfBlobFromJpeg = (
    jpegBytes: Uint8Array,
    imageWidth: number,
    imageHeight: number
  ): Blob => {
    const pageWidth = 1190.55;
    const pageHeight = 841.89;
    const margin = 24;
    const scale = Math.min(
      (pageWidth - margin * 2) / imageWidth,
      (pageHeight - margin * 2) / imageHeight
    );
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    const offsetX = (pageWidth - drawWidth) / 2;
    const offsetY = (pageHeight - drawHeight) / 2;
    const contentStream = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(
      2
    )} ${offsetX.toFixed(2)} ${offsetY.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const objectOffsets: number[] = [];
    let offset = 0;
    const pushString = (value: string) => {
      const bytes = encoder.encode(value);
      chunks.push(bytes);
      offset += bytes.length;
    };
    const pushBytes = (value: Uint8Array) => {
      chunks.push(value);
      offset += value.length;
    };
    const pushObject = (id: number, writer: () => void) => {
      objectOffsets[id] = offset;
      pushString(`${id} 0 obj\n`);
      writer();
      pushString('endobj\n');
    };

    pushString('%PDF-1.4\n');
    pushObject(1, () => pushString('<< /Type /Catalog /Pages 2 0 R >>\n'));
    pushObject(2, () => pushString('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n'));
    pushObject(3, () =>
      pushString(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(
          2
        )} ${pageHeight.toFixed(
          2
        )}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\n`
      )
    );
    pushObject(4, () => {
      pushString(
        `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
      );
      pushBytes(jpegBytes);
      pushString('\nendstream\n');
    });
    pushObject(5, () => {
      pushString(`<< /Length ${contentStream.length} >>\nstream\n`);
      pushString(contentStream);
      pushString('endstream\n');
    });

    const xrefOffset = offset;
    pushString('xref\n0 6\n');
    pushString('0000000000 65535 f \n');
    for (let index = 1; index <= 5; index += 1) {
      pushString(`${String(objectOffsets[index] || 0).padStart(10, '0')} 00000 n \n`);
    }
    pushString('trailer\n<< /Size 6 /Root 1 0 R >>\n');
    pushString(`startxref\n${xrefOffset}\n%%EOF`);

    return new Blob(chunks, { type: 'application/pdf' });
  };

  const handlePrintGraphAsPdf = async () => {
    if (!graphSvgRef.current) {
      setMessageType('error');
      setMessage('Keine DTPN-Grafik zum Export verfügbar.');
      return;
    }
    try {
      const rasterized = await rasterizeSvgToJpeg(graphSvgRef.current);
      const pdfBlob = createPdfBlobFromJpeg(
        rasterized.jpegBytes,
        rasterized.width,
        rasterized.height
      );
      const downloadUrl = window.URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      const baseFileName = sanitizeFilenamePart(editor?.name || 'workflow-dtpn', 'workflow-dtpn');
      link.href = downloadUrl;
      link.download = `${baseFileName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setMessageType('success');
      setMessage('DTPN-Grafik als PDF heruntergeladen.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.message || 'PDF-Export fehlgeschlagen.');
    }
  };

  const handleExportTemplatesAsJson = () => {
    if (sortedTemplates.length === 0) {
      setMessageType('error');
      setMessage('Keine Workflow-Vorlagen zum Export vorhanden.');
      return;
    }

    const payload = {
      version: 1,
      dtpn: DTPN_NOTATION_META,
      exportedAt: new Date().toISOString(),
      templates: sortedTemplates,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const datePart = new Date().toISOString().slice(0, 10);
    link.href = objectUrl;
    link.download = `workflows-${datePart}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
    setMessageType('success');
    setMessage('Workflow-Definitionen als JSON exportiert.');
  };

  const openWorkflowAiDialog = () => {
    const fallbackName = (editor?.name || '').trim() || 'KI-Workflow';
    const fallbackDescription = editor?.description || '';
    const fallbackMode = editor?.executionMode || 'AUTO';
    const fallbackAutoTrigger = editor?.autoTriggerOnEmailVerified ?? false;
    const fallbackEnabled = editor?.enabled ?? true;
    const inferredMaxSteps = editor?.steps?.length ? Math.min(120, Math.max(3, editor.steps.length + 6)) : 24;

    setWorkflowAiDialog({
      prompt: '',
      nameHint: fallbackName,
      descriptionHint: fallbackDescription,
      executionMode: fallbackMode,
      autoTriggerOnEmailVerified: fallbackAutoTrigger,
      enabled: fallbackEnabled,
      maxSteps: inferredMaxSteps,
      generating: false,
    });
  };

  const closeWorkflowAiDialog = () => {
    setWorkflowAiDialog(null);
  };

  const handleGenerateWorkflowViaAi = async () => {
    const dialog = workflowAiDialog;
    if (!dialog || dialog.generating) return;

    const prompt = dialog.prompt.trim();
    if (prompt.length < 8) {
      setMessageType('error');
      setMessage('Bitte beschreiben Sie den gewünschten Workflow im Prompt ausführlicher.');
      return;
    }

    const maxSteps = Number.isFinite(Number(dialog.maxSteps))
      ? Math.max(3, Math.min(120, Math.floor(Number(dialog.maxSteps))))
      : 24;

    try {
      setWorkflowAiDialog((prev) => (prev ? { ...prev, generating: true } : prev));
      const token = getAdminToken();
      const response = await axios.post(
        '/api/admin/config/workflow/templates/generate',
        {
          prompt,
          nameHint: dialog.nameHint.trim(),
          descriptionHint: dialog.descriptionHint.trim(),
          executionMode: dialog.executionMode,
          autoTriggerOnEmailVerified: dialog.autoTriggerOnEmailVerified,
          enabled: dialog.enabled,
          maxSteps,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const candidate = extractSingleTemplateCandidate(response.data);
      if (!candidate || !Array.isArray(candidate.steps) || candidate.steps.length === 0) {
        throw new Error('Die KI-Antwort enthält keine gültige Workflow-Definition.');
      }

      if (
        editor &&
        editor.steps.length > 0 &&
        !window.confirm('Der aktuelle Entwurf enthält bereits Schritte. Durch KI-Generierung ersetzen?')
      ) {
        setWorkflowAiDialog((prev) => (prev ? { ...prev, generating: false } : prev));
        return;
      }

      const now = new Date().toISOString();
      const normalizedTemplate: WorkflowTemplate = {
        id: String(candidate.id || `template-import-${Date.now()}`)
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '-') || `template-import-${Date.now()}`,
        name: String(candidate.name || dialog.nameHint || 'KI-Workflow').trim() || 'KI-Workflow',
        description: String(candidate.description || dialog.descriptionHint || '').trim(),
        steps: (candidate.steps || []).map((step: any, index: number) => {
          const type = normalizeSingleImportedStepType(step?.type);
          const titleFallback = buildAutoNodeTitle(index + 1);
          return {
            title: String(step?.title || titleFallback).trim() || titleFallback,
            type,
            config:
              step?.config && typeof step.config === 'object' && !Array.isArray(step.config)
                ? step.config
                : {},
            auto: type === 'JOIN' ? true : !!step?.auto,
          };
        }),
        executionMode: normalizeSingleImportedExecutionMode(candidate.executionMode || dialog.executionMode),
        autoTriggerOnEmailVerified:
          candidate.autoTriggerOnEmailVerified !== undefined
            ? !!candidate.autoTriggerOnEmailVerified
            : dialog.autoTriggerOnEmailVerified,
        runtime: normalizeRuntimeConfig(candidate.runtime),
        enabled: candidate.enabled !== undefined ? candidate.enabled !== false : dialog.enabled,
        createdAt: typeof candidate.createdAt === 'string' && candidate.createdAt.trim() ? candidate.createdAt : now,
        updatedAt: now,
      };

      const editable = toEditableTemplate(normalizedTemplate);
      setEditor({
        ...editable,
        id: undefined,
        name: editable.name || dialog.nameHint || 'KI-Workflow',
      });
      setDraggedStepId(null);
      setDropIndex(null);
      setSplitTargetPick(null);
      setNextTargetPick(null);
      setGraphConnectionDraft(null);
      setGraphCursorPoint(null);
      setGraphNodePositions({});
      setGraphDragging(null);
      setGraphZoom(1);
      setFocusedStepId(editable.steps[0]?.localId || null);
      setEditorQuery('new');
      setWorkflowAiDialog(null);
      setMessageType('success');
      setMessage(`KI-Workflow "${normalizedTemplate.name}" als Entwurf erstellt.`);
    } catch (error: any) {
      setWorkflowAiDialog((prev) => (prev ? { ...prev, generating: false } : prev));
      setMessageType('error');
      setMessage(
        error?.response?.data?.message ||
          error?.message ||
          'Workflow konnte nicht mit KI erstellt werden.'
      );
    }
  };

  const openImportTemplatesDialog = () => {
    importTemplatesInputRef.current?.click();
  };

  const handleImportTemplatesFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const candidates = extractImportedTemplates(parsed)
        .map((template, index) => toImportTemplateCandidate(template, index))
        .filter((template): template is WorkflowImportTemplateCandidate => template !== null);

      if (candidates.length === 0) {
        setMessageType('error');
        setMessage('Die ausgewählte Datei enthält keine Workflow-Vorlagen.');
        return;
      }
      const defaultTemplate = candidates[0];
      setWorkflowImportDialog({
        fileName: file.name || 'workflow-import.json',
        templates: candidates,
        mode: 'merge',
        selectedSourceIndexes: [defaultTemplate.sourceIndex],
        nameOverride: defaultTemplate.name,
        importing: false,
      });
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Workflow-JSON konnte nicht importiert werden.');
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const closeWorkflowImportDialog = () => {
    setWorkflowImportDialog(null);
  };

  const handleConfirmWorkflowImport = async () => {
    const dialog = workflowImportDialog;
    if (!dialog || dialog.importing) return;

    const selectedSet = new Set(dialog.selectedSourceIndexes);
    const selectedTemplates = dialog.templates.filter((template) => selectedSet.has(template.sourceIndex));
    const selectedSingle = selectedTemplates.length === 1 ? selectedTemplates[0] : null;
    const templatesToImport = selectedTemplates.map((template) => {
      if (selectedSingle && template.sourceIndex === selectedSingle.sourceIndex) {
        return {
          ...template.raw,
          name: dialog.nameOverride.trim() || template.name || 'Importierter Workflow',
        };
      }
      return { ...template.raw };
    });

    if (templatesToImport.length === 0) {
      setMessageType('error');
      setMessage('Bitte mindestens einen Workflow für den Import auswählen.');
      return;
    }

    try {
      setWorkflowImportDialog((prev) => (prev ? { ...prev, importing: true } : prev));
      const token = getAdminToken();
      const response = await axios.post(
        '/api/admin/config/workflow/templates/import',
        {
          mode: dialog.mode,
          templates: templatesToImport,
          scope: workflowScopeParams.scope,
          tenantId: workflowScopeParams.scope === 'tenant' ? workflowScopeParams.tenantId : '',
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchData();
      setWorkflowImportDialog(null);
      setMessageType('success');
      const importedCount = Number.isFinite(Number(response.data?.imported))
        ? Number(response.data.imported)
        : templatesToImport.length;
      const createdCount = Number.isFinite(Number(response.data?.created))
        ? Number(response.data.created)
        : 0;
      const mergedCount = Number.isFinite(Number(response.data?.merged))
        ? Number(response.data.merged)
        : Number.isFinite(Number(response.data?.updated))
        ? Number(response.data.updated)
        : 0;
      const defaultMessage =
        `Import abgeschlossen: ${importedCount} importiert · ${createdCount} neu angelegt · ${mergedCount} zusammengeführt (${dialog.mode === 'replace' ? 'Ersetzen' : 'Zusammenführen'}).`;
      setMessage(defaultMessage);
    } catch (error: any) {
      setWorkflowImportDialog((prev) => (prev ? { ...prev, importing: false } : prev));
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Workflow-JSON konnte nicht importiert werden.');
    }
  };

  const handleSaveTemplate = async () => {
    if (!editor) return;
    if (!editor.name.trim()) {
      setMessageType('error');
      setMessage('Name ist erforderlich');
      return;
    }
    if (editor.steps.length === 0) {
      setMessageType('error');
      setMessage('Mindestens ein Prozessschritt ist erforderlich');
      return;
    }

    try {
      setSaving(true);
      const token = getAdminToken();
      const payload = fromEditableTemplate(editor);
      if (editor.id) {
        await axios.put(`/api/admin/config/workflow/templates/${editor.id}`, payload, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            scope: workflowScopeParams.scope,
            tenantId: workflowScopeParams.scope === 'tenant' ? workflowScopeParams.tenantId : undefined,
          },
        });
      } else {
        await axios.post('/api/admin/config/workflow/templates', payload, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            scope: workflowScopeParams.scope,
            tenantId: workflowScopeParams.scope === 'tenant' ? workflowScopeParams.tenantId : undefined,
          },
        });
      }

      await fetchData();
      setMessageType('success');
      setMessage('Workflow gespeichert');
      closeEditor();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Workflow konnte nicht gespeichert werden');
    } finally {
      setSaving(false);
    }
  };

  const renderRedmineStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeRedmineConfig(step.config || {});
    const selectedStatusIds = Array.isArray(config.targetStatusIds) ? config.targetStatusIds : [];
    const isProjectFixed = config.projectMode === 'fixed';
    const isTrackerFixed = config.trackerMode === 'fixed';
    const isAssigneeFixed = config.assigneeMode === 'fixed';
    const isNoAssignee = config.assigneeMode === 'none';
    const titleTemplate = String(config.titleTemplate || '').trim() || DEFAULT_REDMINE_CONFIG.titleTemplate;
    const descriptionTemplate =
      String(config.descriptionTemplate || '').trim() || DEFAULT_REDMINE_CONFIG.descriptionTemplate;
    const fixedProjectValue = String(config.projectId || '').trim();
    const fixedTrackerValue = String(config.tracker || '').trim();
    const fixedAssigneeValue = String(config.assigneeId || '').trim();
    const fixedAssigneeSelectValue = (() => {
      if (!fixedAssigneeValue) return '';
      const directMatch = fixedAssigneeOptions.some((option) => option.value === fixedAssigneeValue);
      if (directMatch) return fixedAssigneeValue;
      const legacyMatch = fixedAssigneeOptions.find((option) => option.legacyValue === fixedAssigneeValue);
      return legacyMatch?.value || fixedAssigneeValue;
    })();
    const projectInputValue = fixedProjectValue === 'auto' ? '' : fixedProjectValue;
    const trackerInputValue = fixedTrackerValue === 'auto' ? '' : fixedTrackerValue;
    const hasProjectValue = projectInputValue.length > 0;
    const hasTrackerValue = trackerInputValue.length > 0;
    const previewData: Record<string, string> = {
      category: 'Straßenschaden',
      address: 'Hauptstraße 42, 67697 Otterbach',
      coordinates: '49.484200, 7.698100',
      description: 'Auf der Fahrbahn befindet sich ein tiefes Schlagloch.',
      ticketId: 'TK-12345678',
      submissionId: 'SUB-9012',
      citizenName: 'Max Mustermann',
      citizenEmail: 'max.mustermann@example.com',
    };
    const titlePreview = fillTemplateTokens(titleTemplate, previewData);
    const descriptionPreview = fillTemplateTokens(descriptionTemplate, previewData);
    const redmineWarnings: string[] = [];
    if (isProjectFixed && !hasProjectValue) {
      redmineWarnings.push('Projektmodus "Fest" ist aktiv, aber kein Projekt gesetzt.');
    }
    if (isTrackerFixed && !hasTrackerValue) {
      redmineWarnings.push('Trackermodus "Fest" ist aktiv, aber kein Tracker gesetzt.');
    }
    if (isAssigneeFixed && !fixedAssigneeValue) {
      redmineWarnings.push('Zuweisung "Fest" ist aktiv, aber kein Assignee ausgewählt.');
    }
    if (config.waitForTargetStatus && selectedStatusIds.length === 0) {
      redmineWarnings.push('Warte-Logik ist aktiv, aber es wurden keine Zielstatus ausgewählt.');
    }
    if (config.textMode === 'fixed' && !descriptionTemplate.trim()) {
      redmineWarnings.push('Textmodus "Vorlagen-Text" ist aktiv, aber die Beschreibungsvorlage ist leer.');
    }

    const toggleStatusId = (statusId: number) => {
      const hasStatus = selectedStatusIds.includes(statusId);
      const nextIds = hasStatus
        ? selectedStatusIds.filter((id: number) => id !== statusId)
        : [...selectedStatusIds, statusId];
      updateStep(step.localId, (current) => ({
        ...current,
        config: {
          ...normalizeRedmineConfig(current.config || {}),
          targetStatusIds: nextIds,
        },
      }));
    };

    return (
      <div className="editor-group space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <h4 className="font-semibold text-slate-900">1. Ziel in Redmine festlegen</h4>
          <p className="setting-help">
            Bei <strong>KI</strong> wird die Auswahl dynamisch getroffen. Bei <strong>Fest</strong> wird exakt Ihr Wert genutzt.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label>
              <span className="editor-label">Projektmodus</span>
              <select
                className="editor-input"
                value={config.projectMode}
                onChange={(e) => updateStep(step.localId, (current) => ({
                  ...current,
                  config: {
                    ...normalizeRedmineConfig(current.config || {}),
                    projectMode: e.target.value === 'fixed' ? 'fixed' : 'ai',
                  },
                }))}
              >
                <option value="ai">KI-Auswahl</option>
                <option value="fixed">Fest vorgeben</option>
              </select>
            </label>
            <label>
              <span className="editor-label">Trackermodus</span>
              <select
                className="editor-input"
                value={config.trackerMode}
                onChange={(e) => updateStep(step.localId, (current) => ({
                  ...current,
                  config: {
                    ...normalizeRedmineConfig(current.config || {}),
                    trackerMode: e.target.value === 'fixed' ? 'fixed' : 'ai',
                  },
                }))}
              >
                <option value="ai">KI-Auswahl</option>
                <option value="fixed">Fest vorgeben</option>
              </select>
            </label>
            <label>
              <span className="editor-label">Zuweisung</span>
              <select
                className="editor-input"
                value={config.assigneeMode}
                onChange={(e) => updateStep(step.localId, (current) => {
                  const mode = e.target.value === 'fixed' || e.target.value === 'none' ? e.target.value : 'ai';
                  return {
                    ...current,
                    config: {
                      ...normalizeRedmineConfig(current.config || {}),
                      assigneeMode: mode,
                      noAssignee: mode === 'none',
                    },
                  };
                })}
              >
                <option value="ai">KI-Auswahl</option>
                <option value="fixed">Fest vorgeben</option>
                <option value="none">Ohne Zuweisung</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label>
              <span className="editor-label">Projekt (fest)</span>
              {isProjectFixed ? (
                <select
                  className="editor-input"
                  value={projectInputValue}
                  onChange={(e) =>
                    updateStep(step.localId, (current) => ({
                      ...current,
                      config: { ...normalizeRedmineConfig(current.config || {}), projectId: e.target.value },
                    }))
                  }
                >
                  <option value="">Projekt auswählen…</option>
                  {fixedProjectOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="editor-input"
                  value=""
                  disabled
                  placeholder='Nur bei Projektmodus "Fest"'
                  readOnly
                />
              )}
            </label>
            <label>
              <span className="editor-label">Tracker (fest)</span>
              {isTrackerFixed ? (
                <select
                  className="editor-input"
                  value={trackerInputValue}
                  onChange={(e) =>
                    updateStep(step.localId, (current) => ({
                      ...current,
                      config: { ...normalizeRedmineConfig(current.config || {}), tracker: e.target.value },
                    }))
                  }
                >
                  <option value="">Tracker auswählen…</option>
                  {fixedTrackerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="editor-input"
                  value=""
                  disabled
                  placeholder='Nur bei Trackermodus "Fest"'
                  readOnly
                />
              )}
            </label>
            <label>
              <span className="editor-label">Assignee (fest)</span>
              {isAssigneeFixed && !isNoAssignee ? (
                <select
                  className="editor-input"
                  value={fixedAssigneeSelectValue}
                  onChange={(e) =>
                    updateStep(step.localId, (current) => ({
                      ...current,
                      config: { ...normalizeRedmineConfig(current.config || {}), assigneeId: e.target.value },
                    }))
                  }
                >
                  <option value="">Assignee auswählen…</option>
                  {fixedAssigneeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="editor-input"
                  value=""
                  disabled
                  placeholder='Nur bei Zuweisung "Fest"'
                  readOnly
                />
              )}
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <h4 className="font-semibold text-slate-900">2. Ticket-Text und Vorlagen</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label>
              <span className="editor-label">Textmodus</span>
              <select
                className="editor-input"
                value={config.textMode || 'ai'}
                onChange={(e) => updateStep(step.localId, (current) => ({
                  ...current,
                  config: {
                    ...normalizeRedmineConfig(current.config || {}),
                    textMode: e.target.value === 'fixed' ? 'fixed' : 'ai',
                  },
                }))}
              >
                <option value="ai">KI erzeugt Betreff + Beschreibung</option>
                <option value="fixed">Vorlagen-Text aus Templates</option>
              </select>
            </label>
            <label>
              <span className="editor-label">Titel-Vorlage</span>
              <input
                className="editor-input"
                value={config.titleTemplate || ''}
                onChange={(e) => updateStep(step.localId, (current) => ({
                  ...current,
                  config: { ...normalizeRedmineConfig(current.config || {}), titleTemplate: e.target.value },
                }))}
              />
            </label>
          </div>

          <label className="block">
            <span className="editor-label">Beschreibungsvorlage</span>
            <textarea
              className="editor-textarea"
              rows={5}
              value={config.descriptionTemplate || ''}
              onChange={(e) => updateStep(step.localId, (current) => ({
                ...current,
                config: { ...normalizeRedmineConfig(current.config || {}), descriptionTemplate: e.target.value },
              }))}
            />
          </label>

          <div>
            <div className="editor-label">Verfügbare Platzhalter für Titel/Beschreibung</div>
            <div className="flex flex-wrap gap-2">
              {REDMINE_TEMPLATE_PLACEHOLDERS.map((token) => (
                <span key={token} className="px-2 py-1 rounded-full border border-slate-300 bg-slate-100 text-xs font-mono text-slate-700">
                  {token}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Vorschau Titel</div>
              <div className="text-sm text-slate-800">{titlePreview || '–'}</div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Vorschau Beschreibung</div>
              <pre className="text-xs text-slate-700 whitespace-pre-wrap m-0">{descriptionPreview || '–'}</pre>
            </div>
          </div>

          <details className="rounded border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer font-medium text-slate-800">Erweiterte KI-Promptsteuerung</summary>
            <div className="grid grid-cols-1 gap-3 mt-3">
              <label>
                <span className="editor-label">Prompt-Template (optional)</span>
                <textarea
                  className="editor-textarea"
                  rows={4}
                  value={config.aiPromptTemplate || ''}
                  onChange={(e) => updateStep(step.localId, (current) => ({
                    ...current,
                    config: { ...normalizeRedmineConfig(current.config || {}), aiPromptTemplate: e.target.value },
                  }))}
                  placeholder="Leer = Systemstandard"
                />
              </label>
              <label>
                <span className="editor-label">Prompt-Erweiterung (optional)</span>
                <textarea
                  className="editor-textarea"
                  rows={3}
                  value={config.aiPromptExtension || ''}
                  onChange={(e) => updateStep(step.localId, (current) => ({
                    ...current,
                    config: { ...normalizeRedmineConfig(current.config || {}), aiPromptExtension: e.target.value },
                  }))}
                  placeholder="Zusätzliche Hinweise für die KI"
                />
              </label>
            </div>
          </details>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.waitForTargetStatus === true}
              onChange={(e) => updateStep(step.localId, (current) => ({
                ...current,
                config: {
                  ...normalizeRedmineConfig(current.config || {}),
                  waitForTargetStatus: e.target.checked,
                },
              }))}
            />
            <span>3. Nach Erstellung auf Zielstatus in Redmine warten</span>
          </label>

          {config.waitForTargetStatus && (
            <div className="mt-3 space-y-3">
              <label>
                <span className="editor-label">Prüfintervall in Sekunden (mind. 15)</span>
                <input
                  className="editor-input"
                  type="number"
                  min={15}
                  step={1}
                  value={config.targetStatusCheckIntervalSeconds || 60}
                  onChange={(e) => updateStep(step.localId, (current) => ({
                    ...current,
                    config: {
                      ...normalizeRedmineConfig(current.config || {}),
                      targetStatusCheckIntervalSeconds: Number(e.target.value || 60),
                    },
                  }))}
                />
              </label>
              {redmineStatuses.length > 0 ? (
                <div>
                  <div className="editor-label">Zielstatus (mindestens einer)</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {redmineStatuses.map((status) => (
                      <label key={status.id} className="checkbox-label p-2 rounded border border-slate-200 bg-white">
                        <input
                          type="checkbox"
                          checked={selectedStatusIds.includes(status.id)}
                          onChange={() => toggleStatusId(status.id)}
                        />
                        <span>{status.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="setting-help">Keine Redmine-Status verfügbar. Bitte zuerst in den Redmine-Einstellungen synchronisieren.</p>
              )}
            </div>
          )}
        </div>

        {redmineWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <div className="font-semibold text-sm mb-1"><i className="fa-solid fa-triangle-exclamation" /> Konfigurationshinweise</div>
            <ul className="text-sm list-disc pl-5 space-y-1">
              {redmineWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const updateStepConfig = (stepId: string, patch: Record<string, any>) => {
    updateStep(stepId, (current) => ({
      ...current,
      config: {
        ...normalizeStepConfig(current.type, current.config || {}),
        ...patch,
      },
    }));
  };

  const getStepTargetOptions = (currentStepId: string) =>
    (editor?.steps || [])
      .filter((candidate) => candidate.localId !== currentStepId)
      .map((candidate, index) => ({
        id: candidate.localId,
        label: `Knoten ${index + 1}: ${candidate.title || STEP_TYPE_LABELS[candidate.type]}`,
      }));

  const scrollToStep = (stepId: string) => {
    setEditorPanels((prev) => ({ ...prev, flow: true }));
    setFocusedStepId(stepId);
    const element = stepCardRefs.current[stepId];
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    window.requestAnimationFrame(() => {
      const nextElement = stepCardRefs.current[stepId];
      if (nextElement) {
        nextElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  };

  const setSplitBranchTarget = (
    splitStepId: string,
    branch: 'left' | 'right',
    targetStepId: string
  ) => {
    if (!targetStepId || splitStepId === targetStepId) return;

    updateStep(splitStepId, (current) => {
      if (current.type !== 'SPLIT') return current;
      const normalized = normalizeStepConfig('SPLIT', current.config || {});
      let leftNextTaskId = normalizeSingleReference(normalized.leftNextTaskId);
      let rightNextTaskId = normalizeSingleReference(normalized.rightNextTaskId);

      if (branch === 'left') leftNextTaskId = targetStepId;
      if (branch === 'right') rightNextTaskId = targetStepId;

      if (leftNextTaskId && rightNextTaskId && leftNextTaskId === rightNextTaskId) {
        if (branch === 'left') rightNextTaskId = '';
        else leftNextTaskId = '';
      }

      return {
        ...current,
        config: {
          ...normalized,
          leftNextTaskId,
          rightNextTaskId,
          nextTaskIds: [leftNextTaskId, rightNextTaskId].filter((id) => id.trim().length > 0),
        },
      };
    });
  };

  const setStepNextTarget = (stepId: string, targetStepId: string) => {
    if (!targetStepId || stepId === targetStepId) return;
    updateStep(stepId, (current) => ({
      ...current,
      config: {
        ...normalizeStepConfig(current.type, current.config || {}),
        nextTaskId: targetStepId,
        nextTaskIds: [targetStepId],
      },
    }));
  };

  const insertStepFromGraph = (
    type: WorkflowStepType,
    options: {
      afterNodeId?: string | null;
      position?: { x: number; y: number } | null;
      connectFrom?: {
        sourceNodeId: string;
        sourcePort: GraphPortKey;
      } | null;
    } = {}
  ) => {
    let insertedStepId: string | null = null;
    setEditor((prev) => {
      if (!prev) return prev;
      const newStep = createStep(type, getNextAutoNodeNumber(prev.steps));
      insertedStepId = newStep.localId;
      const afterNodeId = options.afterNodeId || null;
      if (!afterNodeId) {
        return { ...prev, steps: [...prev.steps, newStep] };
      }
      if (afterNodeId === '__start__') {
        return { ...prev, steps: [newStep, ...prev.steps] };
      }
      const sourceIndex = prev.steps.findIndex((step) => step.localId === afterNodeId);
      if (sourceIndex === -1) {
        return { ...prev, steps: [...prev.steps, newStep] };
      }
      const nextSteps = [...prev.steps];
      nextSteps.splice(sourceIndex + 1, 0, newStep);
      return { ...prev, steps: nextSteps };
    });
    if (insertedStepId) {
      if (options.position) {
        setGraphNodePositions((prev) => ({
          ...prev,
          [insertedStepId as string]: {
            x: options.position!.x,
            y: options.position!.y,
          },
        }));
      }
      setFocusedStepId(insertedStepId);
      if (options.connectFrom) {
        connectGraphPort(
          options.connectFrom.sourceNodeId,
          options.connectFrom.sourcePort,
          insertedStepId
        );
      }
    }
  };

  const connectGraphPort = (sourceNodeId: string, sourcePort: GraphPortKey, targetNodeId: string) => {
    if (!targetNodeId || targetNodeId === '__start__') return;
    if (sourceNodeId === targetNodeId) return;

    if (sourceNodeId === '__start__') {
      setEditor((prev) => {
        if (!prev) return prev;
        const targetIndex = prev.steps.findIndex((step) => step.localId === targetNodeId);
        if (targetIndex <= 0) return prev;
        const nextSteps = [...prev.steps];
        const [targetStep] = nextSteps.splice(targetIndex, 1);
        nextSteps.unshift(targetStep);
        return { ...prev, steps: nextSteps };
      });
      return;
    }

    updateStep(sourceNodeId, (current) => {
      const normalized = normalizeStepConfig(current.type, current.config || {});
      if (current.type === 'END') return current;

      if (current.type === 'SPLIT') {
        let leftNextTaskId = normalizeSingleReference(normalized.leftNextTaskId);
        let rightNextTaskId = normalizeSingleReference(normalized.rightNextTaskId);

        if (sourcePort === 'left') leftNextTaskId = targetNodeId;
        else if (sourcePort === 'right') rightNextTaskId = targetNodeId;

        if (leftNextTaskId && rightNextTaskId && leftNextTaskId === rightNextTaskId) {
          if (sourcePort === 'left') rightNextTaskId = '';
          else leftNextTaskId = '';
        }

        return {
          ...current,
          config: {
            ...normalized,
            leftNextTaskId,
            rightNextTaskId,
            nextTaskIds: [leftNextTaskId, rightNextTaskId].filter((id: string) => id.trim().length > 0),
          },
        };
      }

      if (current.type === 'IF') {
        const trueNextTaskIds = normalizeReferenceArray(normalized.trueNextTaskIds);
        const falseNextTaskIds = normalizeReferenceArray(normalized.falseNextTaskIds);
        if (sourcePort === 'true') {
          return {
            ...current,
            config: {
              ...normalized,
              trueNextTaskId: targetNodeId,
              trueNextTaskIds: [targetNodeId, ...trueNextTaskIds.filter((id) => id !== targetNodeId)],
            },
          };
        }
        if (sourcePort === 'false') {
          return {
            ...current,
            config: {
              ...normalized,
              falseNextTaskId: targetNodeId,
              falseNextTaskIds: [targetNodeId, ...falseNextTaskIds.filter((id) => id !== targetNodeId)],
            },
          };
        }
      }

      return {
        ...current,
        config: {
          ...normalized,
          nextTaskId: targetNodeId,
          nextTaskIds: [targetNodeId],
        },
      };
    });
  };

  const disconnectGraphEdge = (edge: WorkflowGraphEdge) => {
    if (!edge.explicit || edge.from === '__start__') return;
    updateStep(edge.from, (current) => {
      const normalized = normalizeStepConfig(current.type, current.config || {});

      if (current.type === 'SPLIT') {
        let leftNextTaskId = normalizeSingleReference(normalized.leftNextTaskId);
        let rightNextTaskId = normalizeSingleReference(normalized.rightNextTaskId);
        if (edge.sourcePort === 'left' || edge.label === 'Pfad A') {
          leftNextTaskId = '';
        } else if (edge.sourcePort === 'right' || edge.label === 'Pfad B') {
          rightNextTaskId = '';
        } else {
          if (leftNextTaskId === edge.to) leftNextTaskId = '';
          if (rightNextTaskId === edge.to) rightNextTaskId = '';
        }
        return {
          ...current,
          config: {
            ...normalized,
            leftNextTaskId,
            rightNextTaskId,
            nextTaskIds: [leftNextTaskId, rightNextTaskId].filter((id: string) => id.trim().length > 0),
          },
        };
      }

      if (current.type === 'IF') {
        if (edge.sourcePort === 'true' || edge.kind === 'if_true') {
          return {
            ...current,
            config: {
              ...normalized,
              trueNextTaskId:
                normalizeSingleReference(normalized.trueNextTaskId) === edge.to
                  ? ''
                  : normalizeSingleReference(normalized.trueNextTaskId),
              trueNextTaskIds: normalizeReferenceArray(normalized.trueNextTaskIds).filter((id) => id !== edge.to),
            },
          };
        }
        if (edge.sourcePort === 'false' || edge.kind === 'if_false') {
          return {
            ...current,
            config: {
              ...normalized,
              falseNextTaskId:
                normalizeSingleReference(normalized.falseNextTaskId) === edge.to
                  ? ''
                  : normalizeSingleReference(normalized.falseNextTaskId),
              falseNextTaskIds: normalizeReferenceArray(normalized.falseNextTaskIds).filter((id) => id !== edge.to),
            },
          };
        }
      }

      if (
        (current.type === 'EMAIL_CONFIRMATION' ||
          current.type === 'EMAIL_DOUBLE_OPT_IN' ||
          current.type === 'MAYOR_INVOLVEMENT' ||
          current.type === 'DATENNACHFORDERUNG' ||
          current.type === 'ENHANCED_CATEGORIZATION' ||
          current.type === 'FREE_AI_DATA_REQUEST') &&
        edge.kind === 'confirm_reject'
      ) {
        const rejectNextTaskId = normalizeSingleReference(normalized.rejectNextTaskId);
        const rejectNextTaskIds = normalizeReferenceArray(normalized.rejectNextTaskIds).filter(
          (id) => id !== edge.to
        );
        return {
          ...current,
          config: {
            ...normalized,
            rejectNextTaskId: rejectNextTaskId === edge.to ? '' : rejectNextTaskId,
            rejectNextTaskIds,
          },
        };
      }

      const nextTaskId = normalizeSingleReference(normalized.nextTaskId);
      const nextTaskIds = normalizeReferenceArray(normalized.nextTaskIds).filter((id) => id !== edge.to);
      return {
        ...current,
        config: {
          ...normalized,
          nextTaskId: nextTaskId === edge.to ? '' : nextTaskId,
          nextTaskIds,
        },
      };
    });
  };

  const beginGraphConnection = (sourceNodeId: string, sourcePort: GraphPortKey) => {
    setSplitTargetPick(null);
    setNextTargetPick(null);
    setGraphCursorPoint(null);
    setGraphQuickInsertDraft(null);
    setGraphConnectionDraft((prev) =>
      prev?.sourceNodeId === sourceNodeId && prev.sourcePort === sourcePort
        ? null
        : { sourceNodeId, sourcePort }
    );
    if (sourceNodeId !== '__start__') {
      setFocusedStepId(sourceNodeId);
    }
  };

  const completeGraphConnection = (targetNodeId: string) => {
    if (!graphConnectionDraft) return;
    connectGraphPort(graphConnectionDraft.sourceNodeId, graphConnectionDraft.sourcePort, targetNodeId);
    setGraphConnectionDraft(null);
    setGraphCursorPoint(null);
    setGraphQuickInsertDraft(null);
    if (graphConnectionDraft.sourceNodeId !== '__start__') {
      setFocusedStepId(graphConnectionDraft.sourceNodeId);
    }
  };

  const openQuickInsertForConnection = (
    graphPoint: { x: number; y: number },
    clientPoint: { x: number; y: number }
  ) => {
    if (!graphConnectionDraft) return;
    setGraphQuickInsertDraft({
      sourceNodeId: graphConnectionDraft.sourceNodeId,
      sourcePort: graphConnectionDraft.sourcePort,
      graphX: graphPoint.x,
      graphY: graphPoint.y,
      clientX: clientPoint.x,
      clientY: clientPoint.y,
      nodeType: graphInsertType,
    });
  };

  const applyQuickInsertForConnection = () => {
    if (!graphQuickInsertDraft) return;
    const sourceNodeId = graphQuickInsertDraft.sourceNodeId;
    const sourcePort = graphQuickInsertDraft.sourcePort;
    const nodeType = graphQuickInsertDraft.nodeType;
    const graphX = graphQuickInsertDraft.graphX;
    const graphY = graphQuickInsertDraft.graphY;
    const afterNodeId = sourceNodeId === '__start__' ? '__start__' : sourceNodeId;

    insertStepFromGraph(nodeType, {
      afterNodeId,
      position: { x: graphX, y: graphY },
      connectFrom: {
        sourceNodeId,
        sourcePort,
      },
    });
    setGraphQuickInsertDraft(null);
    setGraphConnectionDraft(null);
    setGraphCursorPoint(null);
  };

  const handleGraphNodeClick = (nodeId: string) => {
    if (graphConnectionDraft) {
      if (nodeId !== '__start__' && nodeId !== graphConnectionDraft.sourceNodeId) {
        completeGraphConnection(nodeId);
      } else {
        setGraphConnectionDraft(null);
        setGraphCursorPoint(null);
        setGraphQuickInsertDraft(null);
      }
      return;
    }
    if (nodeId === '__start__') return;
    if (splitTargetPick) {
      if (nodeId === splitTargetPick.splitStepId) return;
      setSplitBranchTarget(splitTargetPick.splitStepId, splitTargetPick.branch, nodeId);
      setFocusedStepId(splitTargetPick.splitStepId);
      setSplitTargetPick(null);
      return;
    }
    if (nextTargetPick) {
      if (nodeId === nextTargetPick.stepId) return;
      setStepNextTarget(nextTargetPick.stepId, nodeId);
      setFocusedStepId(nextTargetPick.stepId);
      setNextTargetPick(null);
      return;
    }
    scrollToStep(nodeId);
  };

  const workflowGraph = useMemo(() => {
    if (!editor) return null;
    const compactGraph = graphViewMode === 'compact';
    const laneGap = compactGraph ? 168 : 210;
    const stepGap = compactGraph ? 108 : 136;
    const nodeWidth = compactGraph ? 220 : 250;
    const nodeHeight = compactGraph ? 68 : 78;
    const joinSize = compactGraph ? 64 : 76;
    const startRadius = compactGraph ? 22 : 24;
    const endRadius = compactGraph ? 26 : 30;
    const marginX = compactGraph ? 54 : 72;
    const marginY = compactGraph ? 22 : 28;
    const topOffset = compactGraph ? 68 : 82;
    const steps = editor.steps;
    if (steps.length === 0) {
      const width = compactGraph ? 540 : 620;
      const height = compactGraph ? 280 : 320;
      const startNode: WorkflowGraphNode = {
        id: '__start__',
        index: -1,
        title: 'Start',
        type: 'START',
        shape: 'circle',
        radius: startRadius,
        lane: 0,
        x: width / 2,
        y: 64,
        meta: 'Workflow-Einstieg',
        isAuto: true,
      };
      return {
        width,
        height,
        nodeWidth,
        nodeHeight,
        joinSize,
        startRadius,
        endRadius,
        nodes: [startNode],
        edges: [] as WorkflowGraphEdge[],
        nodeById: new Map([[startNode.id, startNode]]),
        splitCount: 0,
        ifCount: 0,
        joinCount: 0,
        endNodeCount: 0,
        restCallCount: 0,
        autoCount: 0,
        explicitPathEnds: 0,
      };
    }
    const idToIndex = new Map<string, number>();
    steps.forEach((step, index) => idToIndex.set(step.localId, index));

    const edges: WorkflowGraphEdge[] = [];
    const addEdge = (
      from: string,
      to: string,
      kind: GraphEdgeKind,
      label?: string,
      options?: {
        explicit?: boolean;
        sourcePort?: GraphPortKey;
      }
    ) => {
      if (!idToIndex.has(to) || from === to) return;
      const id = `${from}->${to}:${kind}:${label || ''}`;
      if (edges.some((edge) => edge.id === id)) return;
      edges.push({
        id,
        from,
        to,
        kind,
        label,
        explicit: options?.explicit === true,
        sourcePort: options?.sourcePort,
      });
    };

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const config = normalizeStepConfig(step.type, step.config || {});
      const explicitSingleNext = normalizeSingleReference(config.nextTaskId);
      const explicitListNext = normalizeReferenceArray(config.nextTaskIds).find((targetId) => idToIndex.has(targetId)) || '';
      const defaultNext =
        (explicitSingleNext && idToIndex.has(explicitSingleNext) ? explicitSingleNext : '') ||
        explicitListNext ||
        steps[index + 1]?.localId ||
        '';

      if (step.type === 'END') {
        continue;
      }

      if (step.type === 'SPLIT') {
        const explicitTargets = resolveSplitBranchTargets(config).filter((targetId) => idToIndex.has(targetId));
        const autoTargets =
          explicitTargets.length > 0
            ? explicitTargets
            : steps
                .slice(index + 1, index + 3)
                .map((candidate) => candidate.localId)
                .filter((targetId) => idToIndex.has(targetId));
        autoTargets.forEach((targetId, branchIndex) => {
          const branch = branchIndex === 0 ? 'left' : 'right';
          addEdge(
            step.localId,
            targetId,
            'split',
            branchIndex === 0 ? 'Pfad A' : 'Pfad B',
            { explicit: explicitTargets.length > 0, sourcePort: branch }
          );
        });
        continue;
      }

      if (step.type === 'IF') {
        const trueTargets = Array.from(
          new Set(
            [
              normalizeSingleReference(config.trueNextTaskId),
              ...normalizeReferenceArray(config.trueNextTaskIds),
            ].filter((targetId) => idToIndex.has(targetId))
          )
        );
        const falseTargets = Array.from(
          new Set(
            [
              normalizeSingleReference(config.falseNextTaskId),
              ...normalizeReferenceArray(config.falseNextTaskIds),
            ].filter((targetId) => idToIndex.has(targetId))
          )
        );

        if (trueTargets.length > 0) {
          trueTargets.forEach((targetId) =>
            addEdge(step.localId, targetId, 'if_true', 'TRUE', { explicit: true, sourcePort: 'true' })
          );
        } else if (defaultNext) {
          addEdge(step.localId, defaultNext, 'if_true', 'TRUE', { explicit: false, sourcePort: 'true' });
        }

        falseTargets.forEach((targetId) =>
          addEdge(step.localId, targetId, 'if_false', 'FALSE', { explicit: true, sourcePort: 'false' })
        );
        continue;
      }

      if (
        step.type === 'EMAIL_CONFIRMATION' ||
        step.type === 'EMAIL_DOUBLE_OPT_IN' ||
        step.type === 'MAYOR_INVOLVEMENT' ||
        step.type === 'DATENNACHFORDERUNG' ||
        step.type === 'ENHANCED_CATEGORIZATION' ||
        step.type === 'FREE_AI_DATA_REQUEST'
      ) {
        const rejectTargets = Array.from(
          new Set(
            [
              normalizeSingleReference(config.rejectNextTaskId),
              ...normalizeReferenceArray(config.rejectNextTaskIds),
            ].filter((targetId) => idToIndex.has(targetId))
          )
        );
        rejectTargets.forEach((targetId) =>
          addEdge(
            step.localId,
            targetId,
            'confirm_reject',
            step.type === 'DATENNACHFORDERUNG' ||
            step.type === 'ENHANCED_CATEGORIZATION' ||
            step.type === 'FREE_AI_DATA_REQUEST'
              ? 'TIMEOUT'
              : 'ABLEHNUNG',
            {
            explicit: true,
            sourcePort: 'default',
            }
          )
        );
      }

      if (defaultNext) {
        addEdge(step.localId, defaultNext, 'default', undefined, {
          explicit: Boolean(explicitSingleNext || explicitListNext),
          sourcePort: 'default',
        });
      }
    }
    if (steps[0]) {
      addEdge('__start__', steps[0].localId, 'default', 'START', { explicit: false, sourcePort: 'start' });
    }

    const laneByStep = new Map<string, number>();
    if (steps[0]) laneByStep.set(steps[0].localId, 0);

    for (const step of steps) {
      if (!laneByStep.has(step.localId)) laneByStep.set(step.localId, 0);
      const sourceLane = laneByStep.get(step.localId) || 0;
      const outgoing = edges.filter((edge) => edge.from === step.localId);
      if (outgoing.length === 1) {
        if (!laneByStep.has(outgoing[0].to)) laneByStep.set(outgoing[0].to, sourceLane);
      } else if (outgoing.length > 1) {
        const spread = outgoing.length - 1;
        outgoing.forEach((edge, edgeIndex) => {
          const lane = sourceLane + edgeIndex - spread / 2;
          if (!laneByStep.has(edge.to)) laneByStep.set(edge.to, lane);
        });
      }
    }

    for (const step of steps) {
      if (laneByStep.has(step.localId)) continue;
      const incomingLanes = edges
        .filter((edge) => edge.to === step.localId)
        .map((edge) => laneByStep.get(edge.from))
        .filter((lane): lane is number => typeof lane === 'number');
      laneByStep.set(
        step.localId,
        incomingLanes.length > 0
          ? incomingLanes.reduce((sum, lane) => sum + lane, 0) / incomingLanes.length
          : 0
      );
    }

    const laneValues = steps.map((step) => laneByStep.get(step.localId) || 0);
    const minLane = Math.min(...laneValues);
    const maxLane = Math.max(...laneValues);
    const width = Math.max(compactGraph ? 520 : 620, marginX * 2 + (maxLane - minLane + 1) * laneGap + nodeWidth);
    const height = Math.max(compactGraph ? 280 : 320, marginY * 2 + topOffset + (steps.length - 1) * stepGap + nodeHeight);

    const processNodes: WorkflowGraphNode[] = steps.map((step, index) => {
      const lane = laneByStep.get(step.localId) || 0;
      const x = marginX + (lane - minLane) * laneGap + nodeWidth / 2;
      const y = marginY + topOffset + index * stepGap + nodeHeight / 2;
      const isEnd = step.type === 'END';
      const isJoin = step.type === 'JOIN';
      const isIf = step.type === 'IF';
      const isSplit = step.type === 'SPLIT';
      return {
        id: step.localId,
        index,
        title: step.title || STEP_TYPE_LABELS[step.type],
        type: step.type,
        shape: isEnd ? 'circle' : isJoin || isIf || isSplit ? 'diamond' : 'rect',
        radius: isEnd ? endRadius : undefined,
        meta: summarizeGraphNodeMeta(step),
        isAuto: !!step.auto,
        lane,
        x,
        y,
      };
    });

    const firstStepLane = steps[0] ? laneByStep.get(steps[0].localId) || 0 : 0;
    const startNode: WorkflowGraphNode = {
      id: '__start__',
      index: -1,
      title: 'Start',
      type: 'START',
      shape: 'circle',
      radius: startRadius,
      lane: firstStepLane,
      x: marginX + (firstStepLane - minLane) * laneGap + nodeWidth / 2,
      y: marginY + startRadius + 4,
      meta: 'Workflow-Einstieg',
      isAuto: true,
    };

    const nodes: WorkflowGraphNode[] = [startNode, ...processNodes].map((node) => {
      if (node.id === '__start__') return node;
      const customPosition = graphNodePositions[node.id];
      if (!customPosition) return node;
      const halfWidth =
        node.shape === 'rect'
          ? nodeWidth / 2
          : node.shape === 'diamond'
          ? joinSize / 2
          : (node.radius || endRadius) + 4;
      const halfHeight =
        node.shape === 'rect'
          ? nodeHeight / 2
          : node.shape === 'diamond'
          ? joinSize / 2
          : (node.radius || endRadius) + 4;
      return {
        ...node,
        x: Math.max(halfWidth + marginX * 0.2, Math.min(width - halfWidth - marginX * 0.2, customPosition.x)),
        y: Math.max(halfHeight + marginY * 0.2, Math.min(height - halfHeight - marginY * 0.2, customPosition.y)),
      };
    });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const splitCount = steps.filter((step) => step.type === 'SPLIT').length;
    const ifCount = steps.filter((step) => step.type === 'IF').length;
    const joinCount = steps.filter((step) => step.type === 'JOIN').length;
    const endNodeCount = steps.filter((step) => step.type === 'END').length;
    const restCallCount = steps.filter((step) => step.type === 'REST_API_CALL').length;
    const autoCount = steps.filter((step) => !!step.auto).length;
    const explicitPathEnds = steps.filter((step) => step.type === 'END' && normalizeStepConfig(step.type, step.config || {}).scope !== 'workflow').length;

    return {
      width,
      height,
      nodeWidth,
      nodeHeight,
      joinSize,
      startRadius,
      endRadius,
      nodes,
      edges,
      nodeById,
      splitCount,
      ifCount,
      joinCount,
      endNodeCount,
      restCallCount,
      autoCount,
      explicitPathEnds,
    };
  }, [editor, graphNodePositions, graphViewMode]);

  const projectClientPointToGraph = (clientX: number, clientY: number) => {
    if (!workflowGraph || !graphSvgRef.current) return null;
    const bounds = graphSvgRef.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      x: ((clientX - bounds.left) / bounds.width) * workflowGraph.width,
      y: ((clientY - bounds.top) / bounds.height) * workflowGraph.height,
    };
  };

  const startGraphNodeDrag = (
    event: React.MouseEvent<SVGGElement>,
    node: WorkflowGraphNode
  ) => {
    if (event.button !== 0) return;
    if (node.id === '__start__') return;
    if (graphConnectionDraft || splitTargetPick || nextTargetPick) return;
    if (!workflowGraph) return;
    const pointer = projectClientPointToGraph(event.clientX, event.clientY);
    if (!pointer) return;
    event.preventDefault();
    event.stopPropagation();
    setFocusedStepId(node.id);
    setGraphDragging({
      nodeId: node.id,
      pointerStart: pointer,
      nodeStart: { x: node.x, y: node.y },
    });
  };

  useEffect(() => {
    if (!graphDragging || !workflowGraph) return;

    const handleMove = (event: MouseEvent) => {
      const pointer = projectClientPointToGraph(event.clientX, event.clientY);
      if (!pointer) return;
      const draggedNode = workflowGraph.nodeById.get(graphDragging.nodeId);
      if (!draggedNode) return;
      const deltaX = pointer.x - graphDragging.pointerStart.x;
      const deltaY = pointer.y - graphDragging.pointerStart.y;
      if (!graphSuppressClickRef.current && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
        graphSuppressClickRef.current = true;
      }
      const halfWidth =
        draggedNode.shape === 'rect'
          ? workflowGraph.nodeWidth / 2
          : draggedNode.shape === 'diamond'
          ? workflowGraph.joinSize / 2
          : (draggedNode.radius || workflowGraph.endRadius) + 4;
      const halfHeight =
        draggedNode.shape === 'rect'
          ? workflowGraph.nodeHeight / 2
          : draggedNode.shape === 'diamond'
          ? workflowGraph.joinSize / 2
          : (draggedNode.radius || workflowGraph.endRadius) + 4;
      const nextX = graphDragging.nodeStart.x + deltaX;
      const nextY = graphDragging.nodeStart.y + deltaY;
      setGraphNodePositions((prev) => ({
        ...prev,
        [graphDragging.nodeId]: {
          x: Math.max(halfWidth + 6, Math.min(workflowGraph.width - halfWidth - 6, nextX)),
          y: Math.max(halfHeight + 6, Math.min(workflowGraph.height - halfHeight - 6, nextY)),
        },
      }));
    };

    const handleUp = () => {
      setGraphDragging(null);
      window.setTimeout(() => {
        graphSuppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [graphDragging, workflowGraph]);

  const resolveGraphInputPortPosition = (
    node: WorkflowGraphNode,
    graph: NonNullable<typeof workflowGraph>
  ): { x: number; y: number } | null => {
    if (node.id === '__start__') return null;
    if (node.shape === 'circle') {
      const radius = node.radius || graph.endRadius;
      return { x: node.x, y: node.y - radius };
    }
    if (node.shape === 'diamond') {
      return { x: node.x, y: node.y - graph.joinSize / 2 };
    }
    return { x: node.x, y: node.y - graph.nodeHeight / 2 };
  };

  const resolveGraphOutputPortPosition = (
    node: WorkflowGraphNode,
    port: GraphPortKey,
    graph: NonNullable<typeof workflowGraph>
  ): { x: number; y: number } | null => {
    if (node.type === 'END') return null;
    if (node.shape === 'circle') {
      const radius = node.radius || graph.startRadius;
      return { x: node.x, y: node.y + radius };
    }
    if (node.shape === 'diamond') {
      if (node.type === 'IF') {
        const half = graph.joinSize / 2;
        const branchOffset = half * 0.58;
        if (port === 'true' || port === 'left') {
          return { x: node.x - branchOffset, y: node.y + branchOffset };
        }
        if (port === 'false' || port === 'right') {
          return { x: node.x + branchOffset, y: node.y + branchOffset };
        }
      }
      return { x: node.x, y: node.y + graph.joinSize / 2 };
    }
    const baseY = node.y + graph.nodeHeight / 2;
    if (port === 'left' || port === 'true') {
      return { x: node.x - graph.nodeWidth * 0.24, y: baseY };
    }
    if (port === 'right' || port === 'false') {
      return { x: node.x + graph.nodeWidth * 0.24, y: baseY };
    }
    return { x: node.x, y: baseY };
  };

  const resolveEdgeAnchorPoints = (
    edge: WorkflowGraphEdge,
    source: WorkflowGraphNode,
    target: WorkflowGraphNode,
    graph: NonNullable<typeof workflowGraph>
  ) => {
    const sourcePort: GraphPortKey =
      edge.sourcePort ||
      (edge.kind === 'if_true'
        ? 'true'
        : edge.kind === 'if_false'
        ? 'false'
        : edge.kind === 'split'
        ? edge.label === 'Pfad B'
          ? 'right'
          : 'left'
        : source.id === '__start__'
        ? 'start'
        : 'default');
    const start = resolveGraphOutputPortPosition(source, sourcePort, graph);
    const end = resolveGraphInputPortPosition(target, graph);
    if (!start || !end) return null;
    return { start, end, sourcePort };
  };

  const buildGraphConnectorPath = (
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): { d: string; labelX: number; labelY: number } => {
    const dx = Math.abs(end.x - start.x);
    const dy = end.y - start.y;

    if (dx < 4) {
      return {
        d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
        labelX: start.x,
        labelY: (start.y + end.y) / 2 - 6,
      };
    }

    const direction = dy >= 0 ? 1 : -1;
    const clearance = Math.max(18, Math.min(42, Math.abs(dy) * 0.35));
    const preferredMidY = start.y + direction * clearance;
    const arrivalLimit = end.y - direction * clearance;
    const canUsePreferredMidY =
      direction > 0 ? preferredMidY <= arrivalLimit : preferredMidY >= arrivalLimit;
    const midY = canUsePreferredMidY ? preferredMidY : (start.y + end.y) / 2;

    return {
      d: `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`,
      labelX: (start.x + end.x) / 2,
      labelY: midY - 6,
    };
  };

  const workflowDiagnostics = useMemo(() => {
    if (!editor || !workflowGraph) return [];
    const diagnostics: string[] = [];
    const allowedResponsibilitySet = new Set(
      mergeDistinctTextOptions(DEFAULT_RESPONSIBILITY_AUTHORITIES, responsibilityAuthorityOptions).map((entry) =>
        entry.toLowerCase()
      )
    );

    editor.steps.forEach((step, index) => {
      const config = normalizeStepConfig(step.type, step.config || {});
      if (step.type === 'SPLIT') {
        const targets = resolveSplitBranchTargets(config).filter((targetId) =>
          editor.steps.some((candidate) => candidate.localId === targetId)
        );
        if (targets.length < 2) {
          diagnostics.push(`Split in Schritt ${index + 1} hat weniger als zwei gültige Pfadziele.`);
        }
      }

      if (step.type === 'IF') {
        const trueTargets = normalizeReferenceArray(config.trueNextTaskIds);
        const falseTargets = normalizeReferenceArray(config.falseNextTaskIds);
        const hasTrueTarget = !!normalizeSingleReference(config.trueNextTaskId) || trueTargets.length > 0;
        const hasFalseTarget = !!normalizeSingleReference(config.falseNextTaskId) || falseTargets.length > 0;
        if (!hasTrueTarget && !hasFalseTarget) {
          diagnostics.push(
            `IF in Schritt ${index + 1} hat keine expliziten TRUE/FALSE-Ziele. Es wird sonst nur der Standard-Folgepfad genutzt.`
          );
        }

        const conditions = Array.isArray(config.conditions) ? config.conditions : [];
        conditions.forEach((rawCondition: any, conditionIndex: number) => {
          if (!rawCondition || typeof rawCondition !== 'object') return;
          const conditionKind = String(rawCondition.kind || rawCondition.type || 'field').toLowerCase();
          if (conditionKind !== 'field') return;
          const field = normalizeIfFieldValue(rawCondition.field);
          if (!isResponsibilityIfField(field)) return;
          const rawOperator = String(rawCondition.operator ?? 'equals')
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
          const operatorAliases: Record<string, string> = {
            '=': 'equals',
            '==': 'equals',
            eq: 'equals',
            is: 'equals',
            ist: 'equals',
            '!=': 'not_equals',
            neq: 'not_equals',
            is_not: 'not_equals',
            isnot: 'not_equals',
            ist_nicht: 'not_equals',
          };
          const operator = operatorAliases[rawOperator] || rawOperator;
          if (!['equals', 'not_equals', 'is_empty', 'is_not_empty'].includes(operator)) {
            diagnostics.push(
              `IF in Schritt ${index + 1}, Bedingung ${conditionIndex + 1}: Für Zuständigkeit sind nur "ist/ist nicht/ist leer/ist nicht leer" erlaubt.`
            );
          }
          const value = String(rawCondition.value ?? '').trim();
          if (!value) return;
          if (!allowedResponsibilitySet.has(value.toLowerCase())) {
            diagnostics.push(
              `IF in Schritt ${index + 1}, Bedingung ${conditionIndex + 1}: Zuständigkeit "${value}" ist nicht in den allgemeinen Einstellungen hinterlegt.`
            );
          }
        });
      }

      if (
        step.type === 'EMAIL' ||
        step.type === 'EMAIL_EXTERNAL' ||
        step.type === 'EMAIL_CONFIRMATION' ||
        step.type === 'EMAIL_DOUBLE_OPT_IN' ||
        step.type === 'DATENNACHFORDERUNG' ||
        step.type === 'ENHANCED_CATEGORIZATION' ||
        step.type === 'FREE_AI_DATA_REQUEST'
      ) {
        const recipientSource = normalizeRecipientEmailSource(config.recipientEmailSource);
        const requiresCustomRecipient =
          step.type === 'EMAIL' ||
          step.type === 'EMAIL_EXTERNAL' ||
          config.recipientType === 'custom';
        if (
          requiresCustomRecipient &&
          recipientSource === 'org_unit' &&
          !String(config.recipientOrgUnitId || '').trim()
        ) {
          diagnostics.push(
            `Schritt ${index + 1}: Empfängerquelle "Organisationseinheit" ist aktiv, aber kein Hierarchieknoten ausgewählt.`
          );
        }
      }

      if (step.type === 'JOIN') {
        const incomingCount = workflowGraph.edges.filter((edge) => edge.to === step.localId).length;
        const requiredArrivals = Number(config.requiredArrivals || config.expectedBranches || 2);
        const safeRequired = Number.isFinite(requiredArrivals) ? Math.max(1, Math.floor(requiredArrivals)) : 2;
        if (incomingCount < safeRequired) {
          diagnostics.push(
            `Join in Schritt ${index + 1} erwartet ${safeRequired} Pfade, aktuell sind nur ${incomingCount} eingehende Kanten vorhanden.`
          );
        }
      }

      if (step.type !== 'JOIN') {
        const incomingCount = workflowGraph.edges.filter((edge) => edge.to === step.localId).length;
        if (incomingCount > 1) {
          diagnostics.push(
            `Schritt ${index + 1} hat ${incomingCount} eingehende Kanten ohne JOIN. Pfade können dadurch logisch zusammenlaufen.`
          );
        }
      }
    });

    return diagnostics;
  }, [editor, workflowGraph, responsibilityAuthorityOptions]);

  const graphRenderSize = useMemo(() => {
    if (!workflowGraph) return null;
    return {
      width: Math.max(460, Math.round(workflowGraph.width * graphZoom)),
      height: Math.max(260, Math.round(workflowGraph.height * graphZoom)),
    };
  }, [workflowGraph, graphZoom]);

  const renderEmailStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const templateOptions = resolveEmailTemplateOptions(['external-notification'], config.templateId);
    const recipientSource = normalizeRecipientEmailSource(config.recipientEmailSource);
    const recipientOrgUnitId = String(config.recipientOrgUnitId || '').trim();
    const recipientOrgOptions = resolveRecipientOrgUnitOptions(recipientOrgUnitId);
    const selectedRecipientOrg =
      recipientOrgUnitId && recipientOrgOptions.length > 0
        ? recipientOrgOptions.find((entry) => entry.id === recipientOrgUnitId) || null
        : null;
    return (
      <div className="editor-group">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label>
            <span className="editor-label">Empfängerquelle</span>
            <select
              className="editor-input"
              value={recipientSource}
              onChange={(e) => updateStepConfig(step.localId, { recipientEmailSource: normalizeRecipientEmailSource(e.target.value) })}
            >
              <option value="manual">Feste E-Mail / Kategorie-Fallback</option>
              <option value="org_unit">Organisationseinheit (Kontakt-E-Mail)</option>
              <option value="ticket_primary_assignee">Primär-Zuweisung aus Ticket</option>
              <option value="ticket_collaborators">Beteiligte aus Ticket</option>
            </select>
          </label>
          {recipientSource === 'manual' ? (
            <>
              <label>
                <span className="editor-label">Empfänger-E-Mail (optional)</span>
                <input
                  className="editor-input"
                  type="email"
                  value={config.recipientEmail || ''}
                  onChange={(e) => updateStepConfig(step.localId, { recipientEmail: e.target.value })}
                  placeholder="leer = aus Kategorie"
                />
              </label>
              <label>
                <span className="editor-label">Empfängername (optional)</span>
                <input
                  className="editor-input"
                  value={config.recipientName || ''}
                  onChange={(e) => updateStepConfig(step.localId, { recipientName: e.target.value })}
                />
              </label>
            </>
          ) : recipientSource === 'org_unit' ? (
            <>
              <label className="md:col-span-2">
                <span className="editor-label">Organisationseinheit</span>
                <select
                  className="editor-input"
                  value={recipientOrgUnitId}
                  onChange={(e) => updateStepConfig(step.localId, { recipientOrgUnitId: e.target.value })}
                  disabled={assignmentDirectoryLoading}
                >
                  <option value="">-- Organisationseinheit auswählen --</option>
                  {recipientOrgOptions.map((unit) => (
                    <option key={`email-recipient-org-${unit.id}`} value={unit.id}>
                      {formatOrgUnitRecipientLabel(unit)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : recipientSource === 'ticket_primary_assignee' ? (
            <p className="setting-help md:col-span-2">
              Empfänger wird zur Laufzeit aus der Primär-Zuweisung des Tickets ermittelt
              (Benutzer-E-Mail, sonst Kontakt-E-Mail der primär zugewiesenen Organisationseinheit).
            </p>
          ) : (
            <p className="setting-help md:col-span-2">
              Empfänger werden zur Laufzeit aus allen Beteiligten des Tickets ermittelt
              (Kollaborierende Benutzer + Kollaborierende Organisationseinheiten mit Kontakt-E-Mail).
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <label>
            <span className="editor-label">Template-ID</span>
            <select
              className="editor-input"
              value={config.templateId || 'external-notification'}
              onChange={(e) => updateStepConfig(step.localId, { templateId: e.target.value })}
            >
              <option value="auto">Auto (Kategorie-Template oder Standard)</option>
              {templateOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {recipientSource === 'org_unit' && selectedRecipientOrg && !String(selectedRecipientOrg.contactEmail || '').trim() ? (
          <p className="setting-help text-rose-700 mt-2">
            Die gewählte Organisationseinheit hat keine Kontakt-E-Mail in den Stammdaten.
          </p>
        ) : null}
        {recipientSource === 'org_unit' && assignmentDirectoryLoading ? (
          <p className="setting-help mt-2">Organisationsdaten werden geladen…</p>
        ) : null}
        {recipientSource === 'org_unit' && assignmentDirectoryError ? (
          <p className="setting-help text-rose-700 mt-2">{assignmentDirectoryError}</p>
        ) : null}
      </div>
    );
  };

  const handleGenerateConfirmationInstruction = async (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const instructionPrompt = String(config.instructionAiPrompt || '').trim();
    if (instructionPrompt.length < 6) {
      setMessageType('error');
      setMessage('Bitte zuerst eine ausreichend konkrete KI-Anforderung eintragen.');
      return;
    }

    try {
      setGeneratingConfirmationInstructionFor(step.localId);
      const token = getAdminToken();
      const response = await axios.post(
        '/api/admin/config/workflow/confirmation-instruction/generate',
        {
          instructionPrompt,
          workflowTitle: editor?.name || '',
          stepTitle: step.title || '',
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const instruction = String(response.data?.instruction || '').trim();
      if (!instruction) {
        setMessageType('error');
        setMessage('Die KI hat keine Anweisung erzeugt.');
        return;
      }
      updateStepConfig(step.localId, { instructionText: instruction });
      setMessageType('success');
      setMessage('Anweisung per KI erzeugt und übernommen.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Anweisung konnte nicht per KI erzeugt werden.');
    } finally {
      setGeneratingConfirmationInstructionFor(null);
    }
  };

  const renderConfirmationStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const recipientType = config.recipientType === 'custom' ? 'custom' : 'citizen';
    const recipientSource = normalizeRecipientEmailSource(config.recipientEmailSource);
    const recipientOrgUnitId = String(config.recipientOrgUnitId || '').trim();
    const recipientOrgOptions = resolveRecipientOrgUnitOptions(recipientOrgUnitId);
    const selectedRecipientOrg =
      recipientOrgUnitId && recipientOrgOptions.length > 0
        ? recipientOrgOptions.find((entry) => entry.id === recipientOrgUnitId) || null
        : null;
    const isDoubleOptIn = step.type === 'EMAIL_DOUBLE_OPT_IN';
    const templateOptions = resolveEmailTemplateOptions(['workflow-confirmation'], config.templateId);
    const targetOptions = getStepTargetOptions(step.localId);
    const rejectNextTaskId =
      normalizeSingleReference(config.rejectNextTaskId) ||
      normalizeReferenceArray(config.rejectNextTaskIds)[0] ||
      '';
    const generatingInstruction = generatingConfirmationInstructionFor === step.localId;

    return (
      <div className="editor-group">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label>
            <span className="editor-label">Empfänger</span>
            <select
              className="editor-input"
              value={recipientType}
              onChange={(e) => updateStepConfig(step.localId, { recipientType: e.target.value === 'custom' ? 'custom' : 'citizen' })}
            >
              <option value="citizen">Bürger aus Ticket</option>
              <option value="custom">Fester Empfänger</option>
            </select>
          </label>
          <label>
            <span className="editor-label">Template-ID</span>
            <select
              className="editor-input"
              value={config.templateId || 'workflow-confirmation'}
              onChange={(e) => updateStepConfig(step.localId, { templateId: e.target.value })}
            >
              <option value="workflow-confirmation">Standard (Workflow-Bestätigung)</option>
              {templateOptions
                .filter((option) => option.id !== 'workflow-confirmation')
                .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
                ))}
            </select>
          </label>
          <label>
            <span className="editor-label">Timeout (Stunden)</span>
            <input
              className="editor-input"
              type="number"
              min={1}
              max={720}
              value={Number(config.timeoutHours || 48)}
              onChange={(e) => updateStepConfig(step.localId, { timeoutHours: Math.max(1, Number(e.target.value || 48)) })}
            />
          </label>
        </div>

        {isDoubleOptIn && (
          <label className="checkbox-label mt-3">
            <input
              type="checkbox"
              checked={config.sendLegacySubmissionConfirmation !== false}
              onChange={(e) =>
                updateStepConfig(step.localId, {
                  sendLegacySubmissionConfirmation: e.target.checked,
                })
              }
            />
            <span>Legacy Bürger-Bestätigungs-E-Mail nach DOI versenden</span>
          </label>
        )}

        {recipientType === 'custom' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <label>
                <span className="editor-label">Empfängerquelle</span>
                <select
                  className="editor-input"
                  value={recipientSource}
                  onChange={(e) => updateStepConfig(step.localId, { recipientEmailSource: normalizeRecipientEmailSource(e.target.value) })}
                >
                  <option value="manual">Feste E-Mail</option>
                  <option value="org_unit">Organisationseinheit (Kontakt-E-Mail)</option>
                  <option value="ticket_primary_assignee">Primär-Zuweisung aus Ticket</option>
                  <option value="ticket_collaborators">Beteiligte aus Ticket</option>
                </select>
              </label>
              {recipientSource === 'manual' ? (
                <>
                  <label>
                    <span className="editor-label">Empfänger-E-Mail</span>
                    <input
                      className="editor-input"
                      type="email"
                      value={config.recipientEmail || ''}
                      onChange={(e) => updateStepConfig(step.localId, { recipientEmail: e.target.value })}
                    />
                  </label>
                  <label>
                    <span className="editor-label">Empfängername (optional)</span>
                    <input
                      className="editor-input"
                      value={config.recipientName || ''}
                      onChange={(e) => updateStepConfig(step.localId, { recipientName: e.target.value })}
                    />
                  </label>
                </>
              ) : recipientSource === 'org_unit' ? (
                <label className="md:col-span-2">
                  <span className="editor-label">Organisationseinheit</span>
                  <select
                    className="editor-input"
                    value={recipientOrgUnitId}
                    onChange={(e) => updateStepConfig(step.localId, { recipientOrgUnitId: e.target.value })}
                    disabled={assignmentDirectoryLoading}
                  >
                    <option value="">-- Organisationseinheit auswählen --</option>
                    {recipientOrgOptions.map((unit) => (
                      <option key={`confirm-recipient-org-${unit.id}`} value={unit.id}>
                        {formatOrgUnitRecipientLabel(unit)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : recipientSource === 'ticket_primary_assignee' ? (
                <p className="setting-help md:col-span-2 m-0">
                  Empfänger wird zur Laufzeit aus der Primär-Zuweisung des Tickets ermittelt.
                </p>
              ) : (
                <p className="setting-help md:col-span-2 m-0">
                  Empfänger werden zur Laufzeit aus allen Beteiligten des Tickets ermittelt.
                </p>
              )}
            </div>
            {recipientSource === 'org_unit' && selectedRecipientOrg && !String(selectedRecipientOrg.contactEmail || '').trim() ? (
              <p className="setting-help text-rose-700 mt-2">
                Die gewählte Organisationseinheit hat keine Kontakt-E-Mail in den Stammdaten.
              </p>
            ) : null}
          </>
        )}

        <div className="rounded border border-slate-200 bg-slate-50 p-3 mt-3 space-y-3">
          <p className="setting-help m-0">
            {isDoubleOptIn ? 'Der DOI-Zustimmungs-Pfad' : 'Der Zustimmungs-Pfad'} wird über{' '}
            <strong>Nächster Schritt</strong> (unten im Editor) gesteuert.
            Für Ablehnungen kann hier ein separater Zielpfad definiert werden.
          </p>
          <label>
            <span className="editor-label">Ablehnungspfad (optional)</span>
            <select
              className="editor-input"
              value={rejectNextTaskId}
              onChange={(e) => {
                const targetId = normalizeSingleReference(e.target.value);
                updateStepConfig(step.localId, {
                  rejectNextTaskId: targetId,
                  rejectNextTaskIds: targetId ? [targetId] : [],
                });
              }}
            >
              <option value="">Workflow bei Ablehnung beenden</option>
              {targetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-3 block">
          <span className="editor-label">Anweisungstext in der Freigabe-Mail</span>
          <textarea
            className="editor-textarea"
            rows={3}
            value={config.instructionText || ''}
            onChange={(e) => updateStepConfig(step.localId, { instructionText: e.target.value })}
            placeholder="Manuelle Arbeitsanweisung für den Empfänger."
          />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mt-3">
          <label>
            <span className="editor-label">KI-Anforderung für Anweisung (optional)</span>
            <textarea
              className="editor-textarea"
              rows={3}
              value={config.instructionAiPrompt || ''}
              onChange={(e) => updateStepConfig(step.localId, { instructionAiPrompt: e.target.value })}
              placeholder="Beispiel: Prüfen Sie, ob Standort und Fotos plausibel sind und ob das Ticket priorisiert werden muss."
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="btn btn-secondary w-full md:w-auto"
              onClick={() => void handleGenerateConfirmationInstruction(step)}
              disabled={generatingInstruction}
            >
              {generatingInstruction ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Erzeuge...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-wand-magic-sparkles" /> KI-Anweisung erzeugen
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderMayorInvolvementStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const mode = config.mode === 'approval' ? 'approval' : 'notify';
    const defaultTemplateId =
      mode === 'approval'
        ? 'workflow-mayor-involvement-approval'
        : 'workflow-mayor-involvement-notify';
    const templateOptions = resolveEmailTemplateOptions(
      ['workflow-mayor-involvement-notify', 'workflow-mayor-involvement-approval'],
      config.templateId
    );
    const targetOptions = getStepTargetOptions(step.localId);
    const rejectNextTaskId =
      normalizeSingleReference(config.rejectNextTaskId) ||
      normalizeReferenceArray(config.rejectNextTaskIds)[0] ||
      '';

    return (
      <div className="editor-group">
        <div className="rounded border border-slate-200 bg-slate-50 p-3 mb-3">
          <p className="setting-help m-0">
            Der Empfaenger wird automatisch aus den Einstellungen <strong>Kommunale Ansprechpartner</strong> (Ort/PLZ)
            ermittelt. Gibt es keine aktive Zuordnung, wird der Fallback-Kontakt verwendet.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label>
            <span className="editor-label">Modus</span>
            <select
              className="editor-input"
              value={mode}
              onChange={(e) => {
                const nextMode = e.target.value === 'approval' ? 'approval' : 'notify';
                const currentTemplate = String(config.templateId || '').trim();
                const knownTemplates = new Set([
                  '',
                  'workflow-mayor-involvement-notify',
                  'workflow-mayor-involvement-approval',
                ]);
                const nextTemplate = knownTemplates.has(currentTemplate)
                  ? nextMode === 'approval'
                    ? 'workflow-mayor-involvement-approval'
                    : 'workflow-mayor-involvement-notify'
                  : currentTemplate;
                updateStepConfig(step.localId, {
                  mode: nextMode,
                  operationMode: nextMode,
                  templateId: nextTemplate,
                });
              }}
            >
              <option value="notify">Nur informieren (Workflow läuft weiter)</option>
              <option value="approval">Zustimmung einholen (Workflow wartet)</option>
            </select>
          </label>
          <label>
            <span className="editor-label">Template-ID</span>
            <select
              className="editor-input"
              value={config.templateId || defaultTemplateId}
              onChange={(e) => updateStepConfig(step.localId, { templateId: e.target.value })}
            >
              {mode === 'notify' ? (
                <option value="workflow-mayor-involvement-notify">
                  Standard (Ortsbürgermeister-Info)
                </option>
              ) : (
                <option value="workflow-mayor-involvement-approval">
                  Standard (Ortsbürgermeister-Zustimmung)
                </option>
              )}
              {templateOptions
                .filter(
                  (option) =>
                    option.id !== 'workflow-mayor-involvement-notify' &&
                    option.id !== 'workflow-mayor-involvement-approval'
                )
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>
          {mode === 'approval' ? (
            <label>
              <span className="editor-label">Timeout (Stunden)</span>
              <input
                className="editor-input"
                type="number"
                min={1}
                max={720}
                value={Number(config.timeoutHours || 48)}
                onChange={(e) =>
                  updateStepConfig(step.localId, { timeoutHours: Math.max(1, Number(e.target.value || 48)) })
                }
              />
            </label>
          ) : (
            <div />
          )}
        </div>

        {mode === 'approval' && (
          <>
            <label className="mt-3 block">
              <span className="editor-label">Zustimmungsfrage</span>
              <textarea
                className="editor-textarea"
                rows={3}
                value={config.approvalQuestion || ''}
                onChange={(e) => updateStepConfig(step.localId, { approvalQuestion: e.target.value })}
                placeholder="Frage, die im Freigabe-Mailtext an den Ortsbürgermeister gestellt wird."
              />
            </label>

            <div className="rounded border border-slate-200 bg-slate-50 p-3 mt-3 space-y-3">
              <label>
                <span className="editor-label">Ablehnungspfad (optional)</span>
                <select
                  className="editor-input"
                  value={rejectNextTaskId}
                  onChange={(e) => {
                    const targetId = normalizeSingleReference(e.target.value);
                    updateStepConfig(step.localId, {
                      rejectNextTaskId: targetId,
                      rejectNextTaskIds: targetId ? [targetId] : [],
                    });
                  }}
                >
                  <option value="">Workflow bei Ablehnung beenden</option>
                  {targetOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderDataRequestStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const recipientType = config.recipientType === 'custom' ? 'custom' : 'citizen';
    const recipientSource = normalizeRecipientEmailSource(config.recipientEmailSource);
    const recipientOrgUnitId = String(config.recipientOrgUnitId || '').trim();
    const recipientOrgOptions = resolveRecipientOrgUnitOptions(recipientOrgUnitId);
    const selectedRecipientOrg =
      recipientOrgUnitId && recipientOrgOptions.length > 0
        ? recipientOrgOptions.find((entry) => entry.id === recipientOrgUnitId) || null
        : null;
    const isEnhanced = step.type === 'ENHANCED_CATEGORIZATION';
    const isFreeAi = step.type === 'FREE_AI_DATA_REQUEST';
    const isAiDataRequest = isEnhanced || isFreeAi;
    const templateOptions = resolveEmailTemplateOptions(['workflow-data-request'], config.templateId);
    const targetOptions = getStepTargetOptions(step.localId);
    const rejectNextTaskId =
      normalizeSingleReference(config.rejectNextTaskId) ||
      normalizeReferenceArray(config.rejectNextTaskIds)[0] ||
      '';
    const fields = Array.isArray(config.fields) ? config.fields : [];
    const stepProcessVariableKeys = buildStepProcessVariableOutputKeys(step);

    const updateField = (index: number, patch: Record<string, any>) => {
      const nextFields = [...fields];
      nextFields[index] = {
        ...nextFields[index],
        ...patch,
        ...(isAiDataRequest ? { required: false } : {}),
      };
      updateStepConfig(step.localId, { fields: nextFields });
    };

    const addField = () => {
      const nextIndex = fields.length + 1;
      updateStepConfig(step.localId, {
        fields: [
          ...fields,
          { key: `field_${nextIndex}`, label: `Feld ${nextIndex}`, type: 'short_text', required: false },
        ],
      });
    };

    return (
      <div className="editor-group workflow-form-designer">
        <div className="workflow-form-designer-card">
          <div className="workflow-form-designer-card-head">
            <h4>
              <i className="fa-solid fa-envelope-open-text" /> Versand & Laufzeit
            </h4>
          </div>
          <div className="workflow-form-designer-grid">
            <label className="mui-editor-field">
              <span className="mui-editor-label">Empfänger</span>
              <select
                className="mui-editor-input"
                value={recipientType}
                onChange={(e) =>
                  updateStepConfig(step.localId, { recipientType: e.target.value === 'custom' ? 'custom' : 'citizen' })
                }
              >
                <option value="citizen">Bürger aus Ticket</option>
                <option value="custom">Fester Empfänger</option>
              </select>
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Timeout (Stunden)</span>
              <input
                className="mui-editor-input"
                type="number"
                min={1}
                max={720}
                value={Number(config.timeoutHours || 72)}
                onChange={(e) =>
                  updateStepConfig(step.localId, { timeoutHours: Math.max(1, Number(e.target.value || 72)) })
                }
              />
            </label>
            <label className="mui-editor-check">
              <input
                type="checkbox"
                checked={config.parallelMode !== false}
                onChange={(e) => updateStepConfig(step.localId, { parallelMode: e.target.checked })}
              />
              <span>Asynchron weiterlaufen (Workflow wird nicht blockiert)</span>
            </label>

            {recipientType === 'custom' && (
              <>
                <label className="mui-editor-field">
                  <span className="mui-editor-label">Empfängerquelle</span>
                  <select
                  className="mui-editor-input"
                  value={recipientSource}
                    onChange={(e) => updateStepConfig(step.localId, { recipientEmailSource: normalizeRecipientEmailSource(e.target.value) })}
                  >
                    <option value="manual">Feste E-Mail</option>
                    <option value="org_unit">Organisationseinheit (Kontakt-E-Mail)</option>
                    <option value="ticket_primary_assignee">Primär-Zuweisung aus Ticket</option>
                    <option value="ticket_collaborators">Beteiligte aus Ticket</option>
                  </select>
                </label>
                {recipientSource === 'manual' ? (
                  <>
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Empfänger-E-Mail</span>
                      <input
                        className="mui-editor-input"
                        type="email"
                        value={config.recipientEmail || ''}
                        onChange={(e) => updateStepConfig(step.localId, { recipientEmail: e.target.value })}
                      />
                    </label>
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Empfängername (optional)</span>
                      <input
                        className="mui-editor-input"
                        value={config.recipientName || ''}
                        onChange={(e) => updateStepConfig(step.localId, { recipientName: e.target.value })}
                      />
                    </label>
                  </>
                ) : recipientSource === 'org_unit' ? (
                  <label className="mui-editor-field md:col-span-2">
                    <span className="mui-editor-label">Organisationseinheit</span>
                    <select
                      className="mui-editor-input"
                      value={recipientOrgUnitId}
                      onChange={(e) => updateStepConfig(step.localId, { recipientOrgUnitId: e.target.value })}
                      disabled={assignmentDirectoryLoading}
                    >
                      <option value="">-- Organisationseinheit auswählen --</option>
                      {recipientOrgOptions.map((unit) => (
                        <option key={`data-request-recipient-org-${unit.id}`} value={unit.id}>
                          {formatOrgUnitRecipientLabel(unit)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : recipientSource === 'ticket_primary_assignee' ? (
                  <p className="setting-help m-0 md:col-span-2">
                    Empfänger wird zur Laufzeit aus der Primär-Zuweisung des Tickets ermittelt.
                  </p>
                ) : (
                  <p className="setting-help m-0 md:col-span-2">
                    Empfänger werden zur Laufzeit aus allen Beteiligten des Tickets ermittelt.
                  </p>
                )}
              </>
            )}
          </div>
          {recipientType === 'custom' && recipientSource === 'org_unit' && selectedRecipientOrg && !String(selectedRecipientOrg.contactEmail || '').trim() ? (
            <p className="setting-help text-rose-700 m-0">
              Die gewählte Organisationseinheit hat keine Kontakt-E-Mail in den Stammdaten.
            </p>
          ) : null}
          {recipientType === 'custom' && recipientSource === 'org_unit' && assignmentDirectoryLoading ? (
            <p className="setting-help m-0">Organisationsdaten werden geladen…</p>
          ) : null}
          {recipientType === 'custom' && recipientSource === 'org_unit' && assignmentDirectoryError ? (
            <p className="setting-help text-rose-700 m-0">{assignmentDirectoryError}</p>
          ) : null}
        </div>

        <div className="workflow-form-designer-card">
          <div className="workflow-form-designer-card-head">
            <h4>
              <i className="fa-solid fa-pen-ruler" /> Formularaufbau
            </h4>
            <button type="button" className="btn btn-secondary" onClick={addField}>
              <i className="fa-solid fa-plus" /> Feld hinzufügen
            </button>
          </div>

          <div className="workflow-form-designer-grid">
            <label className="mui-editor-field">
              <span className="mui-editor-label">Template-ID</span>
              <select
                className="mui-editor-input"
                value={config.templateId || 'workflow-data-request'}
                onChange={(e) => updateStepConfig(step.localId, { templateId: e.target.value })}
              >
                <option value="workflow-data-request">Standard (Workflow-Datennachforderung)</option>
                {templateOptions
                  .filter((option) => option.id !== 'workflow-data-request')
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Betreff</span>
              <input
                className="mui-editor-input"
                value={config.subject || ''}
                onChange={(e) => updateStepConfig(step.localId, { subject: e.target.value })}
              />
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Ablehnung/Timeout Pfad</span>
              <select
                className="mui-editor-input"
                value={rejectNextTaskId}
                onChange={(e) => {
                  const targetId = normalizeSingleReference(e.target.value);
                  updateStepConfig(step.localId, {
                    rejectNextTaskId: targetId,
                    rejectNextTaskIds: targetId ? [targetId] : [],
                  });
                }}
              >
                <option value="">Workflow bei Timeout beenden</option>
                {targetOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="workflow-form-richtext">
            <span className="mui-editor-label">Einleitungstext (WYSIWYG)</span>
            <RichTextEditor
              value={config.introText || ''}
              onChange={(next) => updateStepConfig(step.localId, { introText: next })}
              placeholder="Kurze Einleitung für Bürgerinnen und Bürger..."
            />
          </div>

          {isAiDataRequest && (
            <div className="space-y-3">
              <p className="setting-help m-0">
                Hinweis: <strong>Asynchron weiterlaufen</strong> steuert nur, ob der Hauptworkflow wartet.
                <strong> Mehrere Fragezyklen</strong> steuert zusätzliche Rückfragerunden.
              </p>
              {isFreeAi && (
                <label className="mui-editor-field">
                  <span className="mui-editor-label">Gewünschte Informationen (Klartext-Ziel)</span>
                  <textarea
                    className="mui-editor-input"
                    rows={4}
                    value={config.collectionObjective || ''}
                    onChange={(e) => updateStepConfig(step.localId, { collectionObjective: e.target.value })}
                    placeholder='Beispiel: Ermittele den mutmaßlichen Täter und fordere verwertbare Hinweise (Zeit, Ort, Merkmale, Zeugen, Bilder) an.'
                  />
                </label>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="mui-editor-field">
                  <span className="mui-editor-label">Max. Fragen pro Zyklus</span>
                  <input
                    className="mui-editor-input"
                    type="number"
                    min={1}
                    max={25}
                    value={Number(config.maxQuestionsPerCycle || 5)}
                    onChange={(e) =>
                      updateStepConfig(step.localId, {
                        maxQuestionsPerCycle: Math.max(1, Math.min(25, Number(e.target.value || 5))),
                      })
                    }
                  />
                </label>
                <label className="mui-editor-check md:col-span-2">
                  <input
                    type="checkbox"
                    checked={config.allowFollowUpCycles === true}
                    onChange={(e) => updateStepConfig(step.localId, { allowFollowUpCycles: e.target.checked })}
                  />
                  <span>Mehrere Rückfragezyklen erlauben (Antwort, erneute Vorprüfung, weitere Fragen)</span>
                </label>
              </div>
              {config.allowFollowUpCycles === true && (
                <label className="mui-editor-field">
                  <span className="mui-editor-label">Max. Anzahl Fragezyklen</span>
                  <input
                    className="mui-editor-input"
                    type="number"
                    min={1}
                    max={8}
                    value={Number(config.maxFollowUpCycles || 2)}
                    onChange={(e) =>
                      updateStepConfig(step.localId, {
                        maxFollowUpCycles: Math.max(1, Math.min(8, Number(e.target.value || 2))),
                      })
                    }
                  />
                </label>
              )}
              <label className="mui-editor-field">
                <span className="mui-editor-label">Klartext-Zusatzanweisung (optional)</span>
                <textarea
                  className="mui-editor-input"
                  rows={4}
                  value={config.questionPrompt || ''}
                  onChange={(e) => updateStepConfig(step.localId, { questionPrompt: e.target.value })}
                  placeholder={
                    isFreeAi
                      ? 'Beispiel: Ermittele den mutmaßlichen Täter und fordere verwertbare Hinweise an.'
                      : 'Optionaler Prompt für die Generierung von Rückfragen.'
                  }
                />
              </label>
              {isFreeAi && (
                <label className="mui-editor-field">
                  <span className="mui-editor-label">Modus für Zusatzanweisung</span>
                  <select
                    className="mui-editor-input"
                    value={config.questionPromptMode === 'override' ? 'override' : 'append'}
                    onChange={(e) =>
                      updateStepConfig(step.localId, {
                        questionPromptMode: e.target.value === 'override' ? 'override' : 'append',
                      })
                    }
                  >
                    <option value="append">Ergänzend zum Klartext-Ziel verwenden</option>
                    <option value="override">Als primäre Zieldefinition verwenden</option>
                  </select>
                </label>
              )}
              <label className="mui-editor-check">
                <input
                  type="checkbox"
                  checked={config.enableNeedCheck === true}
                  onChange={(e) => updateStepConfig(step.localId, { enableNeedCheck: e.target.checked })}
                />
                <span>
                  Vorprüfung aktivieren: KI entscheidet zuerst, ob zusätzliche Daten nötig sind
                </span>
              </label>
              {config.enableNeedCheck === true && (
                <>
                  <label className="mui-editor-field">
                    <span className="mui-editor-label">Prompt für Vorprüfung (optional)</span>
                    <textarea
                      className="mui-editor-input"
                      rows={3}
                      value={config.needCheckPrompt || ''}
                      onChange={(e) => updateStepConfig(step.localId, { needCheckPrompt: e.target.value })}
                      placeholder='JSON-Antwort: {"requiresAdditionalData":true|false,"reasoning":"...","confidence":0.0}'
                    />
                  </label>
                  {isFreeAi && (
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Konfidenz-Schwellwert Vorprüfung (0..1)</span>
                      <input
                        className="mui-editor-input"
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={Number(config.needCheckConfidenceThreshold ?? 0.82)}
                        onChange={(e) =>
                          updateStepConfig(step.localId, {
                            needCheckConfidenceThreshold: Math.max(0, Math.min(1, Number(e.target.value || 0.82))),
                          })
                        }
                      />
                    </label>
                  )}
                </>
              )}
              {isFreeAi && (
                <label className="mui-editor-field">
                  <span className="mui-editor-label">Prompt für Antwort-Auswertung (optional)</span>
                  <textarea
                    className="mui-editor-input"
                    rows={3}
                    value={config.answerEvaluationPrompt || ''}
                    onChange={(e) => updateStepConfig(step.localId, { answerEvaluationPrompt: e.target.value })}
                    placeholder='JSON-Antwort: {"derivedVariables":{"key":"value"},"comment":"...","confidence":0.0}'
                  />
                </label>
              )}
              {isEnhanced && (
                <label className="mui-editor-check">
                  <input
                    type="checkbox"
                    checked={config.enableRecategorization !== false}
                    onChange={(e) => updateStepConfig(step.localId, { enableRecategorization: e.target.checked })}
                  />
                  <span>Späte KI-Rekategorisierung/Ticketanpassung erlauben</span>
                </label>
              )}
            </div>
          )}

          {fields.length === 0 && (
            <p className="setting-help m-0">
              {isAiDataRequest
                ? 'Keine statischen Felder gesetzt. Die KI erzeugt Rückfragen dynamisch.'
                : 'Mindestens ein statisches Feld wird empfohlen.'}
            </p>
          )}

          <div className="workflow-form-field-list">
            {fields.map((field: any, index: number) => {
              const typeOption = DATA_REQUEST_FIELD_TYPE_OPTIONS.find((entry) => entry.value === field.type);
              return (
                <div key={`${step.localId}-data-field-${index}`} className="workflow-form-field-card">
                  <div className="workflow-form-field-head">
                    <strong>
                      <i className={`fa-solid ${typeOption?.icon || 'fa-pen'}`} /> Feld {index + 1}
                    </strong>
                    <button
                      type="button"
                      className="action-btn delete-btn"
                      onClick={() =>
                        updateStepConfig(step.localId, {
                          fields: fields.filter((_: any, i: number) => i !== index),
                        })
                      }
                    >
                      Entfernen
                    </button>
                  </div>
                  <div className="workflow-form-designer-grid">
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Key</span>
                      <input
                        className="mui-editor-input"
                        value={field.key || ''}
                        onChange={(e) =>
                          updateField(index, {
                            key: String(e.target.value || '')
                              .trim()
                              .toLowerCase()
                              .replace(/[^a-z0-9_]+/g, '_'),
                          })
                        }
                      />
                    </label>
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Label</span>
                      <input
                        className="mui-editor-input"
                        value={field.label || ''}
                        onChange={(e) => updateField(index, { label: e.target.value })}
                      />
                    </label>
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Typ</span>
                      <select
                        className="mui-editor-input"
                        value={field.type || 'short_text'}
                        onChange={(e) => updateField(index, { type: e.target.value })}
                      >
                        {DATA_REQUEST_FIELD_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="mui-editor-check">
                      <input
                        type="checkbox"
                        checked={isAiDataRequest ? false : field.required === true}
                        onChange={(e) => updateField(index, { required: e.target.checked })}
                        disabled={isAiDataRequest}
                      />
                      <span>{isAiDataRequest ? 'Bei KI-Datennachforderung immer optional' : 'Pflichtfeld'}</span>
                    </label>
                  </div>
                  {field.type === 'single_choice' && (
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Auswahloptionen (eine pro Zeile)</span>
                      <textarea
                        className="mui-editor-input"
                        rows={3}
                        value={Array.isArray(field.options) ? field.options.map((option: any) => option?.value || '').join('\n') : ''}
                        onChange={(e) => {
                          const options = e.target.value
                            .split('\n')
                            .map((entry) => entry.trim())
                            .filter(Boolean)
                            .map((entry) => ({ value: entry, label: entry }));
                          updateField(index, { options });
                        }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="workflow-form-designer-card">
          <div className="workflow-form-designer-card-head">
            <h4>
              <i className="fa-solid fa-code-branch" /> Prozessvariablen
            </h4>
          </div>
          <div className="workflow-form-designer-grid">
            <label className="mui-editor-field">
              <span className="mui-editor-label">Variablen-Prefix (kanonisch)</span>
              <input
                className="mui-editor-input"
                value={config.variablePrefix || ''}
                onChange={(e) => updateStepConfig(step.localId, { variablePrefix: e.target.value })}
                placeholder={`Standard: data_request.${step.localId}`}
              />
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Alias-Prefix</span>
              <input
                className="mui-editor-input"
                value={config.aliasPrefix || 'var'}
                onChange={(e) => updateStepConfig(step.localId, { aliasPrefix: e.target.value })}
              />
            </label>
            <label className="mui-editor-check">
              <input
                type="checkbox"
                checked={config.createAlias !== false}
                onChange={(e) => updateStepConfig(step.localId, { createAlias: e.target.checked })}
              />
              <span>Alias-Variablen erzeugen</span>
            </label>
          </div>
          <div className="mt-3 text-xs text-slate-600">
            <strong>Verfuegbare Keys aus diesem Schritt:</strong>{' '}
            {stepProcessVariableKeys.length > 0
              ? stepProcessVariableKeys.join(', ')
              : 'Noch keine Felder definiert.'}
          </div>
        </div>
      </div>
    );
  };

  const renderImageToTextStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const mode = config.mode === 'below_confidence' ? 'below_confidence' : 'always';

    return (
      <div className="editor-group space-y-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <h4 className="font-semibold text-slate-900">
            <i className="fa-solid fa-image" /> Ausführungsmodus
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label>
              <span className="editor-label">Modus</span>
              <select
                className="editor-input"
                value={mode}
                onChange={(e) =>
                  updateStepConfig(step.localId, {
                    mode: e.target.value === 'below_confidence' ? 'below_confidence' : 'always',
                    runMode: e.target.value === 'below_confidence' ? 'below_confidence' : 'always',
                  })
                }
              >
                <option value="always">Immer ausführen</option>
                <option value="below_confidence">Nur bei niedriger Text-Konfidenz</option>
              </select>
            </label>
            <label>
              <span className="editor-label">Schwellwert (0..1)</span>
              <input
                className="editor-input"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={Number(config.confidenceThreshold ?? 0.75)}
                disabled={mode !== 'below_confidence'}
                onChange={(e) =>
                  updateStepConfig(step.localId, {
                    confidenceThreshold: Math.max(0, Math.min(1, Number(e.target.value || 0.75))),
                  })
                }
              />
            </label>
          </div>
          <label>
            <span className="editor-label">Konfidenz-Prozessvariable (optional)</span>
            <input
              className="editor-input"
              value={config.confidenceVariableKey || ''}
              disabled={mode !== 'below_confidence'}
              onChange={(e) => updateStepConfig(step.localId, { confidenceVariableKey: e.target.value })}
              placeholder="z. B. classification.overallConfidence"
            />
          </label>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <h4 className="font-semibold text-slate-900">
            <i className="fa-solid fa-layer-group" /> Prompt-Kontext
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.includeDescription !== false}
                onChange={(e) => updateStepConfig(step.localId, { includeDescription: e.target.checked })}
              />
              <span>Beschreibungstext der Meldung einbeziehen</span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.includeOsmData === true}
                onChange={(e) => updateStepConfig(step.localId, { includeOsmData: e.target.checked })}
              />
              <span>OSM-/Nominatim-Daten (kompakt) einbeziehen</span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.includeWeatherData === true}
                onChange={(e) => updateStepConfig(step.localId, { includeWeatherData: e.target.checked })}
              />
              <span>Wetterdaten (kompakt) einbeziehen</span>
            </label>
          </div>
          <p className="text-xs text-slate-600">
            Tipp: OSM/Wetter nur aktivieren, wenn diese Zusatzdaten für die Bildinterpretation fachlich relevant sind.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <h4 className="font-semibold text-slate-900">
            <i className="fa-solid fa-database" /> Persistenz & Fehlerverhalten
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.onlyMissing !== false}
                onChange={(e) => updateStepConfig(step.localId, { onlyMissing: e.target.checked })}
              />
              <span>Nur Bilder ohne vorhandene Beschreibung analysieren</span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.overwriteExisting === true}
                onChange={(e) => updateStepConfig(step.localId, { overwriteExisting: e.target.checked })}
              />
              <span>Vorhandene Beschreibungen überschreiben</span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.failOnError === true}
                onChange={(e) => updateStepConfig(step.localId, { failOnError: e.target.checked })}
              />
              <span>Bei Analysefehler Workflow stoppen</span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.addAiComment !== false}
                onChange={(e) => updateStepConfig(step.localId, { addAiComment: e.target.checked })}
              />
              <span>Kommentar mit Analyse-Statistik schreiben</span>
            </label>
          </div>
          <label>
            <span className="editor-label">Kommentar-Sichtbarkeit</span>
            <select
              className="editor-input"
              value={config.aiCommentVisibility === 'public' ? 'public' : 'internal'}
              onChange={(e) =>
                updateStepConfig(step.localId, {
                  aiCommentVisibility: e.target.value === 'public' ? 'public' : 'internal',
                })
              }
            >
              <option value="internal">Intern (Standard)</option>
              <option value="public">Öffentlich</option>
            </select>
          </label>
        </div>
      </div>
    );
  };

  const renderCitizenNotificationStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const templateOptions = resolveEmailTemplateOptions(
      ['citizen-workflow-notification'],
      config.templateId
    );
    return (
      <div className="editor-group">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label>
            <span className="editor-label">Template-ID</span>
            <select
              className="editor-input"
              value={config.templateId || 'citizen-workflow-notification'}
              onChange={(e) => updateStepConfig(step.localId, { templateId: e.target.value })}
            >
              <option value="citizen-workflow-notification">Standard (Bürgerbenachrichtigung)</option>
              {templateOptions
                .filter((option) => option.id !== 'citizen-workflow-notification')
                .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
                ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block">
          <span className="editor-label">Zusätzlicher Hinweistext</span>
          <textarea
            className="editor-textarea"
            rows={3}
            value={config.customMessage || ''}
            onChange={(e) => updateStepConfig(step.localId, { customMessage: e.target.value })}
          />
        </label>
      </div>
    );
  };

  const renderWaitStatusStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const isStatusSet = config.statusMode === 'set';
    const isPrioritySet = config.priorityMode === 'set';
    const isAssigneeSet = config.assigneeMode === 'set';
    const isCategorySet = config.categoryMode === 'set';
    const isDescriptionSet = config.descriptionMode === 'set';
    const isAddressSet = config.addressMode === 'set';
    const isPostalCodeSet = config.postalCodeMode === 'set';
    const isCitySet = config.cityMode === 'set';
    const isResponsibilitySet = config.responsibilityMode === 'set';
    const isLatitudeSet = config.latitudeMode === 'set';
    const isLongitudeSet = config.longitudeMode === 'set';
    const assigneeRaw = String(config.assigneeAfter || '').trim();
    const assigneeSelectValue = (() => {
      if (!assigneeRaw) return '';
      const lowered = assigneeRaw.toLowerCase();
      if (lowered.startsWith('user:') || lowered.startsWith('org:') || lowered.startsWith('assigned:')) {
        return assigneeRaw;
      }
      return `assigned:${assigneeRaw}`;
    })();
    const isAssigneeLegacyValue = assigneeSelectValue.toLowerCase().startsWith('assigned:');
    const assigneeLegacyText = isAssigneeLegacyValue ? assigneeSelectValue.slice(9).trim() : '';
    const assigneeSelectionUserOptionMap = new Map(
      fixedInternalUserOptions.map((user) => [user.id, buildAssignmentUserLabel(user)])
    );
    const assigneeSelectionOrgOptionMap = new Map(
      fixedInternalOrgOptions.map((unit) => [unit.id, unit.label])
    );
    const waitResponsibilityOptions = mergeDistinctTextOptions(
      DEFAULT_RESPONSIBILITY_AUTHORITIES,
      responsibilityAuthorityOptions,
      [config.responsibilityAfter]
    );

    return (
      <div className="editor-group space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label>
              <span className="editor-label">Wartezeit Stunden</span>
              <input
                className="editor-input"
                type="number"
                min={0}
                value={config.waitHours ?? 0}
                onChange={(e) => updateStepConfig(step.localId, { waitHours: Number(e.target.value || 0) })}
              />
            </label>
            <label>
              <span className="editor-label">Wartezeit Minuten</span>
              <input
                className="editor-input"
                type="number"
                min={0}
                value={config.waitMinutes ?? 15}
                onChange={(e) => updateStepConfig(step.localId, { waitMinutes: Number(e.target.value || 0) })}
              />
            </label>
            <label>
              <span className="editor-label">Wartezeit Sekunden</span>
              <input
                className="editor-input"
                type="number"
                min={0}
                value={config.waitSeconds ?? 0}
                onChange={(e) => updateStepConfig(step.localId, { waitSeconds: Number(e.target.value || 0) })}
              />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
          <p className="setting-help">
            Nach Ablauf der Wartezeit können Ticketfelder optional gesetzt werden.
            Felder im Modus <strong>Unverändert lassen</strong> bleiben unberührt.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label>
              <span className="editor-label">Status ändern</span>
              <select
                className="editor-input"
                value={config.statusMode || 'keep'}
                onChange={(e) => updateStepConfig(step.localId, { statusMode: e.target.value === 'set' ? 'set' : 'keep' })}
              >
                {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="editor-label">Statuswert</span>
              <select
                className="editor-input"
                disabled={!isStatusSet}
                value={config.statusAfter || 'completed'}
                onChange={(e) => updateStepConfig(step.localId, { statusAfter: e.target.value })}
              >
                {WAIT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="editor-label">Priorität ändern</span>
              <select
                className="editor-input"
                value={config.priorityMode || 'keep'}
                onChange={(e) => updateStepConfig(step.localId, { priorityMode: e.target.value === 'set' ? 'set' : 'keep' })}
              >
                {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="editor-label">Prioritätswert</span>
              <select
                className="editor-input"
                disabled={!isPrioritySet}
                value={config.priorityAfter || 'medium'}
                onChange={(e) => updateStepConfig(step.localId, { priorityAfter: e.target.value })}
              >
                {PRIORITY_LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label>
              <span className="editor-label">Assignee ändern</span>
              <select
                className="editor-input"
                value={config.assigneeMode || 'keep'}
                onChange={(e) => updateStepConfig(step.localId, { assigneeMode: e.target.value === 'set' ? 'set' : 'keep' })}
              >
                {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-3">
              <span className="editor-label">Primärzuweisung</span>
              <select
                className="editor-input"
                disabled={!isAssigneeSet}
                value={assigneeSelectValue}
                onChange={(e) => updateStepConfig(step.localId, { assigneeAfter: e.target.value })}
              >
                <option value="">Zuweisung entfernen</option>
                <optgroup label="Benutzer">
                  {fixedInternalUserOptions.map((user) => (
                    <option key={`wait-assignee-user-${user.id}`} value={`user:${user.id}`}>
                      {buildAssignmentUserLabel(user)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Organisationseinheiten">
                  {fixedInternalOrgOptions.map((unit) => (
                    <option key={`wait-assignee-org-${unit.id}`} value={`org:${unit.id}`}>
                      {unit.active ? unit.label : `${unit.label} (inaktiv)`}
                    </option>
                  ))}
                </optgroup>
                <option value="assigned:">Legacy-Zuweisung (Freitext)</option>
                {assigneeSelectValue &&
                  !assigneeSelectValue.toLowerCase().startsWith('assigned:') &&
                  ((assigneeSelectValue.toLowerCase().startsWith('user:') &&
                    !assigneeSelectionUserOptionMap.has(assigneeSelectValue.slice(5).trim())) ||
                    (assigneeSelectValue.toLowerCase().startsWith('org:') &&
                      !assigneeSelectionOrgOptionMap.has(assigneeSelectValue.slice(4).trim()))) && (
                    <option value={assigneeSelectValue}>
                      {assigneeSelectValue} (nicht mehr im Verzeichnis)
                    </option>
                  )}
                {assigneeSelectValue.toLowerCase().startsWith('assigned:') && assigneeLegacyText && (
                  <option value={assigneeSelectValue}>Legacy: {assigneeLegacyText}</option>
                )}
              </select>
            </label>
            {isAssigneeSet && isAssigneeLegacyValue && (
              <label className="md:col-span-4">
                <span className="editor-label">Legacy-Zuweisungstext</span>
                <input
                  className="editor-input"
                  value={assigneeLegacyText}
                  onChange={(e) =>
                    updateStepConfig(step.localId, {
                      assigneeAfter: e.target.value.trim() ? `assigned:${e.target.value.trim()}` : 'assigned:',
                    })
                  }
                  placeholder="Optionaler Freitext für das Legacy-Feld assigned_to"
                />
              </label>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label>
              <span className="editor-label">Kategorie ändern</span>
              <select
                className="editor-input"
                value={config.categoryMode || 'keep'}
                onChange={(e) => updateStepConfig(step.localId, { categoryMode: e.target.value === 'set' ? 'set' : 'keep' })}
              >
                {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="editor-label">Kategorie-Wert</span>
              <input
                className="editor-input"
                disabled={!isCategorySet}
                value={config.categoryAfter || ''}
                onChange={(e) => updateStepConfig(step.localId, { categoryAfter: e.target.value })}
              />
            </label>
            <label>
              <span className="editor-label">Adresse ändern</span>
              <select
                className="editor-input"
                value={config.addressMode || 'keep'}
                onChange={(e) => updateStepConfig(step.localId, { addressMode: e.target.value === 'set' ? 'set' : 'keep' })}
              >
                {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="editor-label">Adresswert</span>
              <input
                className="editor-input"
                disabled={!isAddressSet}
                value={config.addressAfter || ''}
                onChange={(e) => updateStepConfig(step.localId, { addressAfter: e.target.value })}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label>
              <span className="editor-label">PLZ ändern</span>
              <select
                className="editor-input"
                value={config.postalCodeMode || 'keep'}
                onChange={(e) => updateStepConfig(step.localId, { postalCodeMode: e.target.value === 'set' ? 'set' : 'keep' })}
              >
                {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="editor-label">PLZ-Wert</span>
              <input
                className="editor-input"
                disabled={!isPostalCodeSet}
                value={config.postalCodeAfter || ''}
                onChange={(e) => updateStepConfig(step.localId, { postalCodeAfter: e.target.value })}
              />
            </label>
            <label>
              <span className="editor-label">Ort ändern</span>
              <select
                className="editor-input"
                value={config.cityMode || 'keep'}
                onChange={(e) => updateStepConfig(step.localId, { cityMode: e.target.value === 'set' ? 'set' : 'keep' })}
              >
                {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="editor-label">Ortswert</span>
              <input
                className="editor-input"
                disabled={!isCitySet}
                value={config.cityAfter || ''}
                onChange={(e) => updateStepConfig(step.localId, { cityAfter: e.target.value })}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label>
              <span className="editor-label">Zuständigkeit ändern</span>
              <select
                className="editor-input"
                value={config.responsibilityMode || 'keep'}
                onChange={(e) =>
                  updateStepConfig(step.localId, { responsibilityMode: e.target.value === 'set' ? 'set' : 'keep' })
                }
              >
                {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-3">
              <span className="editor-label">Zuständigkeit-Wert</span>
              <select
                className="editor-input"
                disabled={!isResponsibilitySet}
                value={String(config.responsibilityAfter || '')}
                onChange={(e) => updateStepConfig(step.localId, { responsibilityAfter: e.target.value })}
              >
                <option value="">Bitte auswählen</option>
                {waitResponsibilityOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label>
              <span className="editor-label">Breitengrad ändern</span>
              <select
                className="editor-input"
                value={config.latitudeMode || 'keep'}
                onChange={(e) => updateStepConfig(step.localId, { latitudeMode: e.target.value === 'set' ? 'set' : 'keep' })}
              >
                {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="editor-label">Lat-Wert</span>
              <input
                className="editor-input"
                type="number"
                step="0.000001"
                disabled={!isLatitudeSet}
                value={config.latitudeAfter ?? ''}
                onChange={(e) => updateStepConfig(step.localId, { latitudeAfter: e.target.value })}
              />
            </label>
            <label>
              <span className="editor-label">Längengrad ändern</span>
              <select
                className="editor-input"
                value={config.longitudeMode || 'keep'}
                onChange={(e) => updateStepConfig(step.localId, { longitudeMode: e.target.value === 'set' ? 'set' : 'keep' })}
              >
                {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="editor-label">Lon-Wert</span>
              <input
                className="editor-input"
                type="number"
                step="0.000001"
                disabled={!isLongitudeSet}
                value={config.longitudeAfter ?? ''}
                onChange={(e) => updateStepConfig(step.localId, { longitudeAfter: e.target.value })}
              />
            </label>
          </div>

          <label>
            <span className="editor-label">Beschreibung ändern</span>
            <select
              className="editor-input"
              value={config.descriptionMode || 'keep'}
              onChange={(e) => updateStepConfig(step.localId, { descriptionMode: e.target.value === 'set' ? 'set' : 'keep' })}
            >
              {WAIT_FIELD_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="editor-label">Beschreibungstext</span>
            <textarea
              className="editor-textarea"
              rows={4}
              disabled={!isDescriptionSet}
              value={config.descriptionAfter || ''}
              onChange={(e) => updateStepConfig(step.localId, { descriptionAfter: e.target.value })}
            />
          </label>
        </div>
      </div>
    );
  };

  const renderSplitStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const stepIndex = editor?.steps.findIndex((candidate) => candidate.localId === step.localId) ?? -1;
    const explicitTargets = resolveSplitBranchTargets(config);
    const autoTargets =
      stepIndex >= 0
        ? (editor?.steps || []).slice(stepIndex + 1, stepIndex + 3).map((candidate) => candidate.localId)
        : [];
    const effectiveTargets = explicitTargets.length > 0 ? explicitTargets : autoTargets;

    const resolveTargetLabel = (targetId?: string) => {
      const id = normalizeSingleReference(targetId);
      if (!id) return 'Kein Zielknoten vorhanden';
      const targetIndex = editor?.steps.findIndex((candidate) => candidate.localId === id) ?? -1;
      if (targetIndex === -1) return `Nicht gefunden (${id})`;
      const targetStep = editor?.steps[targetIndex];
      if (!targetStep) return `Nicht gefunden (${id})`;
      return `Knoten ${targetIndex + 1}: ${targetStep.title || STEP_TYPE_LABELS[targetStep.type]}`;
    };
    const isPickingForThisStep = splitTargetPick?.splitStepId === step.localId;
    const isPickingLeft = isPickingForThisStep && splitTargetPick?.branch === 'left';
    const isPickingRight = isPickingForThisStep && splitTargetPick?.branch === 'right';

    return (
      <div className="editor-group">
        <p className="setting-help">
          Split erzeugt automatisch zwei Pfade. Ohne manuelle Zieldefinition werden die beiden
          direkt folgenden Schritte genutzt.
        </p>
        {isPickingForThisStep && (
          <p className="setting-help">
            Zielknoten wählen: Bitte in der Pfadgrafik den gewünschten Knoten für{' '}
            {isPickingLeft ? 'Pfad A' : 'Pfad B'} anklicken.
          </p>
        )}
        <div className="split-branch-preview">
          <div className="split-branch-card">
            <div className="split-branch-title">Pfad A</div>
            <div className="split-branch-target">{resolveTargetLabel(effectiveTargets[0])}</div>
            <div className="split-branch-actions">
              <button
                type="button"
                className={`btn btn-secondary split-branch-btn ${isPickingLeft ? 'active' : ''}`}
                onClick={() =>
                  {
                    setNextTargetPick(null);
                    setSplitTargetPick((prev) =>
                      prev?.splitStepId === step.localId && prev.branch === 'left'
                        ? null
                        : { splitStepId: step.localId, branch: 'left' }
                    );
                  }
                }
              >
                {isPickingLeft ? 'Abbrechen' : 'In Grafik wählen'}
              </button>
              <button
                type="button"
                className="btn btn-secondary split-branch-btn"
                onClick={() =>
                  updateStepConfig(step.localId, {
                    leftNextTaskId: '',
                    nextTaskIds: [normalizeSingleReference(config.rightNextTaskId)].filter((id) => id.trim().length > 0),
                  })
                }
                disabled={!normalizeSingleReference(config.leftNextTaskId)}
              >
                Zurück auf Auto
              </button>
            </div>
          </div>
          <div className="split-branch-card">
            <div className="split-branch-title">Pfad B</div>
            <div className="split-branch-target">{resolveTargetLabel(effectiveTargets[1])}</div>
            <div className="split-branch-actions">
              <button
                type="button"
                className={`btn btn-secondary split-branch-btn ${isPickingRight ? 'active' : ''}`}
                onClick={() =>
                  {
                    setNextTargetPick(null);
                    setSplitTargetPick((prev) =>
                      prev?.splitStepId === step.localId && prev.branch === 'right'
                        ? null
                        : { splitStepId: step.localId, branch: 'right' }
                    );
                  }
                }
              >
                {isPickingRight ? 'Abbrechen' : 'In Grafik wählen'}
              </button>
              <button
                type="button"
                className="btn btn-secondary split-branch-btn"
                onClick={() =>
                  updateStepConfig(step.localId, {
                    rightNextTaskId: '',
                    nextTaskIds: [normalizeSingleReference(config.leftNextTaskId)].filter((id) => id.trim().length > 0),
                  })
                }
                disabled={!normalizeSingleReference(config.rightNextTaskId)}
              >
                Zurück auf Auto
              </button>
            </div>
          </div>
        </div>
        {stepIndex >= 0 && (editor?.steps || []).length - stepIndex <= 2 && (
          <p className="setting-help">
            Für zwei Pfade sind mindestens zwei Folgeschritte nach dem Split erforderlich.
          </p>
        )}
        {explicitTargets.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary mt-2"
            onClick={() =>
              updateStepConfig(step.localId, {
                leftNextTaskId: '',
                rightNextTaskId: '',
                nextTaskIds: [],
              })
            }
          >
            Manuelle Pfadziele zurücksetzen (Automatik)
          </button>
        )}
      </div>
    );
  };

  const renderIfStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const targetOptions = getStepTargetOptions(step.localId);
    const conditionList = Array.isArray(config.conditions) ? config.conditions : [];
    const processVariableKeys = availableProcessVariableKeys;

    return (
      <div className="editor-group space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label>
            <span className="editor-label">Logik</span>
            <select
              className="editor-input"
              value={config.logic || 'AND'}
              onChange={(e) => updateStepConfig(step.localId, { logic: e.target.value === 'OR' ? 'OR' : 'AND' })}
            >
              <option value="AND">UND (alle Bedingungen)</option>
              <option value="OR">ODER (mind. eine Bedingung)</option>
            </select>
          </label>
          <label>
            <span className="editor-label">Bei TRUE weiter zu</span>
            <select
              className="editor-input"
              value={config.trueNextTaskId || ''}
              onChange={(e) => updateStepConfig(step.localId, { trueNextTaskId: e.target.value })}
            >
              <option value="">Standard (nächster Schritt)</option>
              {targetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="editor-label">Bei FALSE weiter zu</span>
            <select
              className="editor-input"
              value={config.falseNextTaskId || ''}
              onChange={(e) => updateStepConfig(step.localId, { falseNextTaskId: e.target.value })}
            >
              <option value="">Pfad beenden</option>
              {targetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-2">
          <div className="editor-label">Bedingungen</div>
          <div className="text-xs text-slate-600">
            <strong>Verfuegbare Prozessvariablen:</strong>{' '}
            {processVariableKeys.length > 0 ? processVariableKeys.join(', ') : 'Keine bekannt.'}
          </div>
          {conditionList.map((condition: any, index: number) => {
            const kind =
              condition?.kind === 'geofence'
                ? 'geofence'
                : condition?.kind === 'process_variable'
                ? 'process_variable'
                : 'field';
            const conditionField = normalizeIfFieldValue(condition?.field);
            const isPriorityField = conditionField === 'priority';
            const isStatusField = conditionField === 'status';
            const isResponsibilityField = isResponsibilityIfField(conditionField);
            const operatorOptions = isPriorityField
              ? IF_PRIORITY_OPERATOR_OPTIONS
              : isResponsibilityField
              ? IF_RESPONSIBILITY_OPERATOR_OPTIONS
              : IF_OPERATOR_OPTIONS;
            const conditionOperator = String(condition?.operator || (isPriorityField ? 'gte' : 'equals')).toLowerCase();
            const hasOperator = operatorOptions.some((option) => option.value === conditionOperator);
            const selectedOperator =
              hasOperator
                ? conditionOperator
                : normalizeIfOperatorForField(conditionField, conditionOperator);
            const isEmptyOperator = selectedOperator === 'is_empty' || selectedOperator === 'is_not_empty';
            const selectedPriorityValue = normalizePriorityLevelValue(condition?.value) || 'medium';
            const selectedStatusValue = normalizeStatusValue(condition?.value) || 'open';
            const responsibilityValue = String(condition?.value ?? '').trim();
            const conditionResponsibilityOptions = mergeDistinctTextOptions(
              DEFAULT_RESPONSIBILITY_AUTHORITIES,
              responsibilityAuthorityOptions,
              [responsibilityValue]
            );
            const selectedResponsibilityValue =
              isEmptyOperator ? '' : responsibilityValue || conditionResponsibilityOptions[0] || '';
            const geofenceShape = condition?.shape === 'polygon' ? 'polygon' : 'circle';
            const geofencePoints = normalizeGeofencePolygonPoints(condition?.points ?? condition?.polygonPoints);
            return (
              <div key={`${step.localId}-cond-${index}`} className="p-3 rounded border border-slate-200 bg-slate-50 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <label>
                    <span className="editor-label">Typ</span>
                    <select
                      className="editor-input"
                      value={kind}
                      onChange={(e) => {
                        const nextConditions = [...conditionList];
                        nextConditions[index] = e.target.value === 'geofence'
                          ? {
                              kind: 'geofence',
                              shape: 'circle',
                              operator: 'inside',
                              centerLat: '',
                              centerLon: '',
                              radiusMeters: 250,
                              points: [],
                            }
                          : e.target.value === 'process_variable'
                          ? {
                              kind: 'process_variable',
                              key: 'var.input',
                              operator: 'equals',
                              value: '',
                            }
                          : {
                              kind: 'field',
                              field: 'category',
                              operator: 'equals',
                              value: '',
                            };
                        updateStepConfig(step.localId, { conditions: nextConditions });
                      }}
                    >
                      <option value="field">Ticketfeld</option>
                      <option value="process_variable">Prozessvariable</option>
                      <option value="geofence">Geofence (Kreis/Polygon)</option>
                    </select>
                  </label>

                  {kind === 'field' ? (
                    <>
                      <label>
                        <span className="editor-label">Feld</span>
                        <select
                          className="editor-input"
                          value={conditionField}
                          onChange={(e) => {
                            const nextField = normalizeIfFieldValue(e.target.value);
                            const nextOperator = normalizeIfOperatorForField(nextField, conditionOperator);
                            const nextConditions = [...conditionList];
                            nextConditions[index] = {
                              ...condition,
                              kind: 'field',
                              field: nextField,
                              operator: nextOperator,
                              value:
                                nextField === 'priority'
                                  ? normalizePriorityLevelValue(condition?.value) || 'medium'
                                  : nextField === 'status'
                                  ? normalizeStatusValue(condition?.value) || 'open'
                                  : nextField === 'responsibilityAuthority'
                                  ? String(condition?.value ?? '').trim() ||
                                    conditionResponsibilityOptions[0] ||
                                    ''
                                  : condition?.value ?? '',
                            };
                            updateStepConfig(step.localId, { conditions: nextConditions });
                          }}
                        >
                          {IF_FIELD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="editor-label">
                          Operator
                          {isPriorityField && (
                            <span
                              className="editor-label-hint"
                              title='Prioritäten werden als Text gespeichert (low, medium, high, critical) und intern in dieser Reihenfolge verglichen.'
                            >
                              <i className="fa-solid fa-circle-info" />
                            </span>
                          )}
                        </span>
                        <select
                          className="editor-input"
                          value={selectedOperator}
                          onChange={(e) => {
                            const nextConditions = [...conditionList];
                            nextConditions[index] = { ...condition, kind: 'field', operator: e.target.value };
                            updateStepConfig(step.localId, { conditions: nextConditions });
                          }}
                        >
                          {operatorOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="editor-label">Wert</span>
                        {isPriorityField ? (
                          <select
                            className="editor-input"
                            value={selectedPriorityValue}
                            onChange={(e) => {
                              const nextConditions = [...conditionList];
                              nextConditions[index] = {
                                ...condition,
                                kind: 'field',
                                value: normalizePriorityLevelValue(e.target.value) || 'medium',
                              };
                              updateStepConfig(step.localId, { conditions: nextConditions });
                            }}
                            disabled={isEmptyOperator}
                          >
                            {PRIORITY_LEVEL_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : isStatusField ? (
                          <select
                            className="editor-input"
                            value={selectedStatusValue}
                            onChange={(e) => {
                              const nextConditions = [...conditionList];
                              nextConditions[index] = {
                                ...condition,
                                kind: 'field',
                                value: normalizeStatusValue(e.target.value) || 'open',
                              };
                              updateStepConfig(step.localId, { conditions: nextConditions });
                            }}
                            disabled={isEmptyOperator}
                          >
                            {IF_STATUS_VALUE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                              ))}
                          </select>
                        ) : isResponsibilityField ? (
                          <select
                            className="editor-input"
                            value={selectedResponsibilityValue}
                            onChange={(e) => {
                              const nextConditions = [...conditionList];
                              nextConditions[index] = {
                                ...condition,
                                kind: 'field',
                                value: e.target.value,
                              };
                              updateStepConfig(step.localId, { conditions: nextConditions });
                            }}
                            disabled={isEmptyOperator}
                          >
                            <option value="">Bitte auswählen</option>
                            {conditionResponsibilityOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="editor-input"
                            value={condition.value ?? ''}
                            onChange={(e) => {
                              const nextConditions = [...conditionList];
                              nextConditions[index] = { ...condition, kind: 'field', value: e.target.value };
                              updateStepConfig(step.localId, { conditions: nextConditions });
                            }}
                            disabled={isEmptyOperator}
                          />
                        )}
                      </label>
                    </>
                  ) : kind === 'process_variable' ? (
                    <>
                      <label>
                        <span className="editor-label">Variablen-Key</span>
                        <input
                          className="editor-input"
                          list={`process-variable-options-${step.localId}-${index}`}
                          value={condition.key || condition.variableKey || ''}
                          onChange={(e) => {
                            const nextConditions = [...conditionList];
                            nextConditions[index] = {
                              ...condition,
                              kind: 'process_variable',
                              key: e.target.value,
                            };
                            updateStepConfig(step.localId, { conditions: nextConditions });
                          }}
                          placeholder="z. B. var.menge oder data_request.task-2.menge"
                        />
                        <datalist id={`process-variable-options-${step.localId}-${index}`}>
                          {processVariableKeys.map((key) => (
                            <option key={`${step.localId}-${index}-${key}`} value={key} />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        <span className="editor-label">Operator</span>
                        <select
                          className="editor-input"
                          value={selectedOperator}
                          onChange={(e) => {
                            const nextConditions = [...conditionList];
                            nextConditions[index] = {
                              ...condition,
                              kind: 'process_variable',
                              operator: e.target.value,
                            };
                            updateStepConfig(step.localId, { conditions: nextConditions });
                          }}
                        >
                          {IF_OPERATOR_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="editor-label">Wert</span>
                        <input
                          className="editor-input"
                          value={condition.value ?? ''}
                          onChange={(e) => {
                            const nextConditions = [...conditionList];
                            nextConditions[index] = {
                              ...condition,
                              kind: 'process_variable',
                              value: e.target.value,
                            };
                            updateStepConfig(step.localId, { conditions: nextConditions });
                          }}
                          disabled={selectedOperator === 'is_empty' || selectedOperator === 'is_not_empty'}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        <span className="editor-label">Modus</span>
                        <select
                          className="editor-input"
                          value={condition.operator === 'outside' ? 'outside' : 'inside'}
                          onChange={(e) => {
                            const nextConditions = [...conditionList];
                            nextConditions[index] = {
                              ...condition,
                              kind: 'geofence',
                              operator: e.target.value === 'outside' ? 'outside' : 'inside',
                            };
                            updateStepConfig(step.localId, { conditions: nextConditions });
                          }}
                        >
                          <option value="inside">innerhalb</option>
                          <option value="outside">außerhalb</option>
                        </select>
                      </label>
                      <label>
                        <span className="editor-label">Form</span>
                        <select
                          className="editor-input"
                          value={geofenceShape}
                          onChange={(e) => {
                            const nextShape = e.target.value === 'polygon' ? 'polygon' : 'circle';
                            const nextConditions = [...conditionList];
                            const fallbackCenterLat =
                              asOptionalNumber(condition.centerLat) ??
                              (geofencePoints[0] ? geofencePoints[0].lat : null);
                            const fallbackCenterLon =
                              asOptionalNumber(condition.centerLon) ??
                              (geofencePoints[0] ? geofencePoints[0].lon : null);
                            nextConditions[index] = {
                              ...condition,
                              kind: 'geofence',
                              shape: nextShape,
                              centerLat: fallbackCenterLat === null ? '' : fallbackCenterLat,
                              centerLon: fallbackCenterLon === null ? '' : fallbackCenterLon,
                              radiusMeters: Math.max(1, Number(condition.radiusMeters || 250)),
                              points:
                                nextShape === 'polygon'
                                  ? geofencePoints
                                  : geofencePoints.slice(0, geofencePoints.length),
                            };
                            updateStepConfig(step.localId, { conditions: nextConditions });
                          }}
                        >
                          <option value="circle">Kreis</option>
                          <option value="polygon">Polygonzug (geschlossen)</option>
                        </select>
                      </label>
                      {geofenceShape === 'circle' ? (
                        <>
                          <label>
                            <span className="editor-label">Mittelpunkt Lat</span>
                            <input
                              className="editor-input"
                              type="number"
                              value={condition.centerLat ?? ''}
                              onChange={(e) => {
                                const nextConditions = [...conditionList];
                                const raw = e.target.value.trim();
                                nextConditions[index] = {
                                  ...condition,
                                  kind: 'geofence',
                                  shape: 'circle',
                                  centerLat: raw === '' ? '' : Number(raw),
                                };
                                updateStepConfig(step.localId, { conditions: nextConditions });
                              }}
                            />
                          </label>
                          <label>
                            <span className="editor-label">Mittelpunkt Lon</span>
                            <input
                              className="editor-input"
                              type="number"
                              value={condition.centerLon ?? ''}
                              onChange={(e) => {
                                const nextConditions = [...conditionList];
                                const raw = e.target.value.trim();
                                nextConditions[index] = {
                                  ...condition,
                                  kind: 'geofence',
                                  shape: 'circle',
                                  centerLon: raw === '' ? '' : Number(raw),
                                };
                                updateStepConfig(step.localId, { conditions: nextConditions });
                              }}
                            />
                          </label>
                          <label>
                            <span className="editor-label">Radius (m)</span>
                            <input
                              className="editor-input"
                              type="number"
                              min={1}
                              value={condition.radiusMeters ?? 250}
                              onChange={(e) => {
                                const nextConditions = [...conditionList];
                                const raw = e.target.value.trim();
                                nextConditions[index] = {
                                  ...condition,
                                  kind: 'geofence',
                                  shape: 'circle',
                                  radiusMeters: raw === '' ? 250 : Math.max(1, Number(raw)),
                                };
                                updateStepConfig(step.localId, { conditions: nextConditions });
                              }}
                            />
                          </label>
                        </>
                      ) : (
                        <label>
                          <span className="editor-label">Polygonpunkte</span>
                          <input
                            className="editor-input"
                            value={`${geofencePoints.length} Punkte`}
                            disabled
                            readOnly
                          />
                        </label>
                      )}
                    </>
                  )}
                </div>
                {kind === 'field' && isPriorityField && (
                  <p className="setting-help">
                    Prioritäten werden in der Datenbank als Text gespeichert und in dieser Reihenfolge verglichen:
                    <strong> low &lt; medium &lt; high &lt; critical</strong>.
                  </p>
                )}
                {kind === 'geofence' && (
                  <GeofenceMapEditor
                    mode={geofenceShape}
                    centerLat={asOptionalNumber(condition.centerLat)}
                    centerLon={asOptionalNumber(condition.centerLon)}
                    radiusMeters={Math.max(1, Number(condition.radiusMeters || 250))}
                    polygonPoints={geofencePoints}
                    onCenterChange={(lat, lon) => {
                      const nextConditions = [...conditionList];
                      nextConditions[index] = {
                        ...condition,
                        kind: 'geofence',
                        shape: 'circle',
                        centerLat: Number(lat.toFixed(6)),
                        centerLon: Number(lon.toFixed(6)),
                      };
                      updateStepConfig(step.localId, { conditions: nextConditions });
                    }}
                    onPolygonChange={(points) => {
                      const nextConditions = [...conditionList];
                      nextConditions[index] = {
                        ...condition,
                        kind: 'geofence',
                        shape: 'polygon',
                        points,
                      };
                      updateStepConfig(step.localId, { conditions: nextConditions });
                    }}
                  />
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    className="action-btn delete-btn"
                    onClick={() => {
                      const nextConditions = conditionList.filter((_: any, idx: number) => idx !== index);
                      updateStepConfig(step.localId, { conditions: nextConditions });
                    }}
                  >
                    Bedingung entfernen
                  </button>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              updateStepConfig(step.localId, {
                conditions: [
                  ...conditionList,
                  { kind: 'field', field: 'category', operator: 'equals', value: '' },
                ],
              });
            }}
          >
            <i className="fa-solid fa-plus" /> Bedingung hinzufügen
          </button>
        </div>
      </div>
    );
  };

  const renderEndStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const scope = config.scope === 'workflow' ? 'workflow' : 'branch';
    return (
      <div className="editor-group">
        <label>
          <span className="editor-label">Beenden-Modus</span>
          <select
            className="editor-input"
            value={scope}
            onChange={(e) =>
              updateStepConfig(step.localId, { scope: e.target.value === 'workflow' ? 'workflow' : 'branch' })
            }
          >
            <option value="branch">Teilworkflow/Pfad beenden</option>
            <option value="workflow">Gesamten Workflow beenden</option>
          </select>
        </label>
        <p className="setting-help">
          Teilworkflow beendet nur den aktiven Pfad. Gesamter Workflow markiert alle anderen offenen Pfade als
          beendet.
        </p>
      </div>
    );
  };

  const renderChangeWorkflowStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const selectionMode = config.selectionMode === 'manual' ? 'manual' : 'ai';
    return (
      <div className="editor-group">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label>
            <span className="editor-label">Auswahlmodus</span>
            <select
              className="editor-input"
              value={selectionMode}
              onChange={(e) => updateStepConfig(step.localId, { selectionMode: e.target.value === 'manual' ? 'manual' : 'ai' })}
            >
              <option value="ai">KI-Auswahl</option>
              <option value="manual">Feste Workflow-Vorlage</option>
            </select>
          </label>
          <label>
            <span className="editor-label">Workflow-Vorlage (bei fester Auswahl)</span>
            <select
              className="editor-input"
              value={config.templateId || ''}
              onChange={(e) => updateStepConfig(step.localId, { templateId: e.target.value })}
              disabled={selectionMode !== 'manual'}
            >
              <option value="">Keine feste Vorlage</option>
              {sortedTemplates
                .filter((template) => template.enabled !== false)
                .map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.enableAiRecategorization === true}
              onChange={(e) => updateStepConfig(step.localId, { enableAiRecategorization: e.target.checked })}
            />
            <span>Vor Wechsel KI-Rekategorisierung ausführen</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.addAiComment !== false}
              onChange={(e) => updateStepConfig(step.localId, { addAiComment: e.target.checked })}
            />
            <span>KI/System-Kommentar mit Begründung schreiben</span>
          </label>
          <label>
            <span className="editor-label">Kommentar-Sichtbarkeit</span>
            <select
              className="editor-input"
              value={config.aiCommentVisibility === 'public' ? 'public' : 'internal'}
              onChange={(e) =>
                updateStepConfig(step.localId, {
                  aiCommentVisibility: e.target.value === 'public' ? 'public' : 'internal',
                })
              }
            >
              <option value="internal">Intern (Standard)</option>
              <option value="public">Öffentlich</option>
            </select>
          </label>
        </div>
      </div>
    );
  };

  const renderSubWorkflowStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const selectionMode = config.selectionMode === 'manual' ? 'manual' : 'ai';
    return (
      <div className="editor-group">
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-violet-900 text-sm mb-3">
          <i className="fa-solid fa-diagram-project mr-2" />
          Startet einen Teilworkflow. Der aktuelle Workflow wartet, bis der Teilworkflow abgeschlossen ist, und setzt
          danach an diesem Schritt fort.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label>
            <span className="editor-label">Auswahlmodus</span>
            <select
              className="editor-input"
              value={selectionMode}
              onChange={(e) =>
                updateStepConfig(step.localId, {
                  selectionMode: e.target.value === 'manual' ? 'manual' : 'ai',
                })
              }
            >
              <option value="ai">KI-Auswahl</option>
              <option value="manual">Feste Workflow-Vorlage</option>
            </select>
          </label>
          <label>
            <span className="editor-label">Teilworkflow-Vorlage (bei fester Auswahl)</span>
            <select
              className="editor-input"
              value={config.templateId || ''}
              onChange={(e) => updateStepConfig(step.localId, { templateId: e.target.value })}
              disabled={selectionMode !== 'manual'}
            >
              <option value="">Keine feste Vorlage</option>
              {sortedTemplates
                .filter((template) => template.enabled !== false)
                .map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <label>
            <span className="editor-label">Fallback-Vorlage (wenn KI-Auswahl fehlschlägt)</span>
            <select
              className="editor-input"
              value={config.fallbackTemplateId || ''}
              onChange={(e) => updateStepConfig(step.localId, { fallbackTemplateId: e.target.value })}
            >
              <option value="">Automatisch erste aktive Vorlage</option>
              {sortedTemplates
                .filter((template) => template.enabled !== false)
                .map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="checkbox-label mt-7">
            <input
              type="checkbox"
              checked={config.allowSameTemplate === true}
              onChange={(e) => updateStepConfig(step.localId, { allowSameTemplate: e.target.checked })}
            />
            <span>Gleiche Vorlage wie Elternworkflow zulassen</span>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.reuseActiveChild !== false}
              onChange={(e) => updateStepConfig(step.localId, { reuseActiveChild: e.target.checked })}
            />
            <span>Bereits laufenden Teilworkflow wiederverwenden</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.failOnChildFailure !== false}
              onChange={(e) => updateStepConfig(step.localId, { failOnChildFailure: e.target.checked })}
            />
            <span>Bei Fehler im Teilworkflow Elternworkflow abbrechen</span>
          </label>
        </div>
      </div>
    );
  };

  const renderResponsibilityCheckStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    return (
      <div className="editor-group">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-900 text-sm mb-3">
          <i className="fa-solid fa-circle-info mr-2" />
          Verwaltungs-Zuständigkeitsprüfung per KI: Prüft die zuständige Ebene (z. B. Ortsgemeinde, Verbandsgemeinde, Landkreis, Landesbehörde)
          auf Basis von Ticketinhalt, Kategorie und OSM-Kontext.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.applyToTicket !== false}
              onChange={(e) => updateStepConfig(step.localId, { applyToTicket: e.target.checked })}
            />
            <span>Ermittelte Zuständigkeit direkt ins Ticketfeld schreiben</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.addAiComment !== false}
              onChange={(e) => updateStepConfig(step.localId, { addAiComment: e.target.checked })}
            />
            <span>KI-Kommentar mit Begruendung schreiben</span>
          </label>
          <label>
            <span className="editor-label">Kommentar-Sichtbarkeit</span>
            <select
              className="editor-input"
              value={config.aiCommentVisibility === 'public' ? 'public' : 'internal'}
              onChange={(e) =>
                updateStepConfig(step.localId, {
                  aiCommentVisibility: e.target.value === 'public' ? 'public' : 'internal',
                })
              }
            >
              <option value="internal">Intern (Standard)</option>
              <option value="public">Öffentlich</option>
            </select>
          </label>
        </div>
      </div>
    );
  };

  const renderCategorizationStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const fallbackOrgUnitId = String(config.orgAssignmentFallbackOrgUnitId || '').trim();
    const categorizationOrgFallbackOptions = [...fixedInternalOrgOptions];
    if (fallbackOrgUnitId && !categorizationOrgFallbackOptions.some((unit) => unit.id === fallbackOrgUnitId)) {
      const fallback = orgUnitDirectoryById.get(fallbackOrgUnitId);
      if (fallback) {
        categorizationOrgFallbackOptions.unshift(fallback);
      } else {
        categorizationOrgFallbackOptions.unshift({
          id: fallbackOrgUnitId,
          tenantId: '',
          parentId: null,
          name: fallbackOrgUnitId,
          label: fallbackOrgUnitId,
          contactEmail: null,
          active: false,
        });
      }
    }
    return (
      <div className="editor-group">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-indigo-900 text-sm mb-3">
          <i className="fa-solid fa-circle-info mr-2" />
          Dieser Schritt führt die normale KI-Klassifizierung aus, setzt Kategorie/Priorität und startet anschließend
          den zur Kategorie zugeordneten Workflow.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.startCategoryWorkflow !== false}
              onChange={(e) => updateStepConfig(step.localId, { startCategoryWorkflow: e.target.checked })}
            />
            <span>Kategorie-Workflow automatisch starten</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.endCurrentWorkflow !== false}
              onChange={(e) => updateStepConfig(step.localId, { endCurrentWorkflow: e.target.checked })}
            />
            <span>Aktuellen Workflow nach Kategorisierung beenden</span>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <label>
            <span className="editor-label">Fallback-Workflow (wenn Kategorie kein Mapping hat)</span>
            <select
              className="editor-input"
              value={config.fallbackTemplateId || 'standard-redmine-ticket'}
              onChange={(e) => updateStepConfig(step.localId, { fallbackTemplateId: e.target.value })}
            >
              {sortedTemplates
                .filter((template) => template.enabled !== false)
                .map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="checkbox-label mt-7">
            <input
              type="checkbox"
              checked={config.allowSameTemplateSwitch === true}
              onChange={(e) => updateStepConfig(step.localId, { allowSameTemplateSwitch: e.target.checked })}
            />
            <span>Auch bei identischer Vorlage Workflowwechsel erlauben</span>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.enableOrgUnitAssignment === true}
              onChange={(e) => updateStepConfig(step.localId, { enableOrgUnitAssignment: e.target.checked })}
            />
            <span>Optional Primärzuweisung auf Org-Einheit setzen (KI)</span>
          </label>
          {config.enableOrgUnitAssignment === true ? (
            <label>
              <span className="editor-label">Fallback-Org-Einheit (wenn KI keine valide ID liefert)</span>
              <select
                className="editor-input"
                value={fallbackOrgUnitId}
                onChange={(e) =>
                  updateStepConfig(step.localId, { orgAssignmentFallbackOrgUnitId: e.target.value })
                }
                disabled={assignmentDirectoryLoading}
              >
                <option value="">Kein Fallback (nur KI-Auswahl)</option>
                {categorizationOrgFallbackOptions.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="text-xs text-slate-600 md:pt-8">
              Zuweisung wird nur aus Kandidaten der Ticket-Mandantenhierarchie berechnet.
            </div>
          )}
        </div>
        {config.enableOrgUnitAssignment === true && assignmentDirectoryError ? (
          <p className="setting-help text-rose-700 mt-2">{assignmentDirectoryError}</p>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.addAiComment !== false}
              onChange={(e) => updateStepConfig(step.localId, { addAiComment: e.target.checked })}
            />
            <span>KI-Kommentar mit Begründung schreiben</span>
          </label>
          <label>
            <span className="editor-label">Kommentar-Sichtbarkeit</span>
            <select
              className="editor-input"
              value={config.aiCommentVisibility === 'public' ? 'public' : 'internal'}
              onChange={(e) =>
                updateStepConfig(step.localId, {
                  aiCommentVisibility: e.target.value === 'public' ? 'public' : 'internal',
                })
              }
            >
              <option value="internal">Intern (Standard)</option>
              <option value="public">Öffentlich</option>
            </select>
          </label>
        </div>
      </div>
    );
  };

  const buildDefaultRestProbeInput = (step: EditableWorkflowStep): string => {
    const workflowId = String(editor?.id || 'probe-workflow').trim() || 'probe-workflow';
    const workflowTitle = String(editor?.name || 'Probe-Workflow').trim() || 'Probe-Workflow';
    const payload = {
      ticket: {
        id: 'ticket-probe-001',
        submissionId: 'submission-probe-001',
        category: 'Allgemein',
        priority: 'medium',
        status: 'open',
        description: 'Dies ist ein Probe-Ticket für den API-Call-Test.',
        address: 'Hauptstrasse 1',
        location: 'Otterbach',
        city: 'Otterbach',
        postalCode: '67731',
        latitude: 49.4857,
        longitude: 7.7349,
        citizenName: 'Max Mustermann',
        citizenEmail: 'max@example.org',
      },
      workflow: {
        id: workflowId,
        title: workflowTitle,
        executionMode: editor?.executionMode || 'MANUAL',
        status: 'running',
      },
      task: {
        id: step.localId,
        title: step.title || 'RESTful API Call',
        type: 'REST_API_CALL',
      },
    };
    return JSON.stringify(payload, null, 2);
  };

  const resolveRestProbeInput = (step: EditableWorkflowStep): string =>
    restProbeInputByStepId[step.localId] ?? buildDefaultRestProbeInput(step);

  const updateRestProbeInput = (stepId: string, value: string) => {
    setRestProbeInputByStepId((prev) => ({ ...prev, [stepId]: value }));
  };

  const resolveRestProbeAnalyzeWithAi = (stepId: string): boolean =>
    restProbeAnalyzeByStepId[stepId] !== false;

  const handleRunRestProbe = async (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const sourceCode = String(config.sourceCode || '').trim();
    if (!sourceCode) {
      setRestProbeResultByStepId((prev) => ({
        ...prev,
        [step.localId]: { error: 'Kein JavaScript-Quelltext für die Probe vorhanden.' },
      }));
      return;
    }

    const inputRaw = resolveRestProbeInput(step);
    let parsedInput: any = {};
    if (inputRaw.trim()) {
      try {
        parsedInput = JSON.parse(inputRaw);
      } catch {
        setRestProbeResultByStepId((prev) => ({
          ...prev,
          [step.localId]: { error: 'Probe-Input ist kein gültiges JSON.' },
        }));
        return;
      }
    }

    try {
      setRestProbeLoadingStepId(step.localId);
      const token = getAdminToken();
      const response = await axios.post(
        '/api/admin/config/workflow/rest/probe',
        {
          sourceCode,
          baseUrl: config.baseUrl || '',
          timeoutMs: Number(config.timeoutMs ?? 20000),
          requestTimeoutMs: Number(config.requestTimeoutMs ?? 15000),
          input: parsedInput,
          analyzeWithAi: resolveRestProbeAnalyzeWithAi(step.localId),
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setRestProbeResultByStepId((prev) => ({
        ...prev,
        [step.localId]: response.data || {},
      }));
    } catch (error: any) {
      setRestProbeResultByStepId((prev) => ({
        ...prev,
        [step.localId]: {
          error: error?.response?.data?.message || 'REST-Probe fehlgeschlagen.',
          probeData:
            error?.response?.data?.probeData && typeof error.response.data.probeData === 'object'
              ? error.response.data.probeData
              : undefined,
        },
      }));
    } finally {
      setRestProbeLoadingStepId((prev) => (prev === step.localId ? null : prev));
    }
  };

  const renderRestApiCallStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const probeInput = resolveRestProbeInput(step);
    const probeResult = restProbeResultByStepId[step.localId];
    const probeRunning = restProbeLoadingStepId === step.localId;
    const analyzeWithAi = resolveRestProbeAnalyzeWithAi(step.localId);
    const tokens = [
      '{ticketId}',
      '{submissionId}',
      '{category}',
      '{priority}',
      '{status}',
      '{description}',
      '{address}',
      '{location}',
      '{city}',
      '{postalCode}',
      '{coordinates}',
      '{latitude}',
      '{longitude}',
      '{citizenName}',
      '{citizenEmail}',
    ];

    return (
      <div className="editor-group space-y-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <h4 className="font-semibold text-slate-900">REST-Ausführung</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label>
              <span className="editor-label">Basis-URL (optional)</span>
              <input
                className="editor-input"
                value={config.baseUrl || ''}
                onChange={(e) => updateStepConfig(step.localId, { baseUrl: e.target.value })}
                placeholder="https://api.example.local"
              />
            </label>
            <label>
              <span className="editor-label">Script-Timeout (ms)</span>
              <input
                className="editor-input"
                type="number"
                min={1000}
                max={120000}
                value={config.timeoutMs ?? 20000}
                onChange={(e) => updateStepConfig(step.localId, { timeoutMs: Number(e.target.value || 20000) })}
              />
            </label>
            <label>
              <span className="editor-label">Default HTTP-Timeout (ms)</span>
              <input
                className="editor-input"
                type="number"
                min={500}
                max={120000}
                value={config.requestTimeoutMs ?? 15000}
                onChange={(e) =>
                  updateStepConfig(step.localId, { requestTimeoutMs: Number(e.target.value || 15000) })
                }
              />
            </label>
            <label className="checkbox-label mt-7">
              <input
                type="checkbox"
                checked={config.continueOnError === true}
                onChange={(e) => updateStepConfig(step.localId, { continueOnError: e.target.checked })}
              />
              <span>Bei Fehler Workflow fortsetzen (Schritt = skipped)</span>
            </label>
          </div>

          <div>
            <div className="editor-label">URL-Token</div>
            <div className="flex flex-wrap gap-2">
              {tokens.map((token) => (
                <span
                  key={token}
                  className="px-2 py-1 rounded-full border border-slate-300 bg-white text-xs font-mono text-slate-700"
                >
                  {token}
                </span>
              ))}
            </div>
          </div>
        </div>

        <label>
          <span className="editor-label">JavaScript-Quelltext</span>
          <textarea
            className="editor-textarea workflow-script-editor"
            rows={20}
            value={config.sourceCode || ''}
            onChange={(e) => updateStepConfig(step.localId, { sourceCode: e.target.value })}
          />
        </label>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold text-slate-900">API-Testfenster (bidirektional)</h4>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={analyzeWithAi}
                onChange={(e) =>
                  setRestProbeAnalyzeByStepId((prev) => ({ ...prev, [step.localId]: e.target.checked }))
                }
              />
              <span>KI-Auswertung aktiv</span>
            </label>
          </div>
          <p className="setting-help m-0">
            Probe-Läufe senden API-Requests und werten Antworten direkt als Rückkanal für <code>patchTicket</code>,{' '}
            <code>state</code> und Folgepfade aus.
          </p>
          <label>
            <span className="editor-label">Probe-Input (JSON)</span>
            <textarea
              className="editor-textarea font-mono text-xs"
              rows={12}
              value={probeInput}
              onChange={(e) => updateRestProbeInput(step.localId, e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleRunRestProbe(step)}
              disabled={probeRunning}
            >
              {probeRunning ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Probe läuft...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-vial" /> Probe ausführen
                </>
              )}
            </button>
          </div>

          {probeResult?.error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <strong>Probe-Fehler:</strong> {probeResult.error}
            </div>
          )}

          {(probeResult?.requests || probeResult?.outputObject || probeResult?.probeData) && (
            <div className="space-y-2">
              {Number.isFinite(Number(probeResult?.runtimeMs)) && (
                <p className="text-xs text-slate-600 m-0">
                  Laufzeit: <strong>{Math.max(0, Number(probeResult?.runtimeMs))} ms</strong>
                </p>
              )}
              {Array.isArray(probeResult?.requests) && probeResult.requests.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">
                    HTTP-Probecalls ({probeResult.requests.length})
                  </summary>
                  <pre className="mt-2 p-2 bg-white border border-slate-200 rounded text-xs overflow-auto max-h-64">
                    {JSON.stringify(probeResult.requests, null, 2)}
                  </pre>
                </details>
              )}
              {(probeResult?.outputObject !== undefined || probeResult?.output !== undefined) && (
                <details open>
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">
                    Script-Output
                  </summary>
                  <pre className="mt-2 p-2 bg-white border border-slate-200 rounded text-xs overflow-auto max-h-64">
                    {JSON.stringify(probeResult.outputObject ?? probeResult.output, null, 2)}
                  </pre>
                </details>
              )}
              {Array.isArray(probeResult?.logs) && probeResult.logs.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">
                    Script-Logs ({probeResult.logs.length})
                  </summary>
                  <pre className="mt-2 p-2 bg-white border border-slate-200 rounded text-xs overflow-auto max-h-64">
                    {probeResult.logs.join('\n')}
                  </pre>
                </details>
              )}
              {probeResult?.aiAnalysis && (
                <details open>
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">
                    KI-Analyse (strukturierte Integrationshinweise)
                  </summary>
                  <pre className="mt-2 p-2 bg-white border border-slate-200 rounded text-xs overflow-auto max-h-80">
                    {JSON.stringify(probeResult.aiAnalysis, null, 2)}
                  </pre>
                </details>
              )}
              {!probeResult?.aiAnalysis && probeResult?.aiAnalysisRaw && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">
                    KI-Analyse (Rohtext)
                  </summary>
                  <pre className="mt-2 p-2 bg-white border border-slate-200 rounded text-xs overflow-auto max-h-80">
                    {probeResult.aiAnalysisRaw}
                  </pre>
                </details>
              )}
              {probeResult?.aiAnalysisError && (
                <p className="text-xs text-amber-700 m-0">
                  KI-Auswertung: {probeResult.aiAnalysisError}
                </p>
              )}
              {probeResult?.probeData && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">
                    Fehlerdiagnose
                  </summary>
                  <pre className="mt-2 p-2 bg-white border border-slate-200 rounded text-xs overflow-auto max-h-64">
                    {JSON.stringify(probeResult.probeData, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <strong>Verfügbar im Script:</strong> <code>input</code>, <code>state</code>,{' '}
          <code>request(&#123;...&#125;)</code>, <code>fetch(&#123;...&#125;)</code>,{' '}
          <code>interpolate("...")</code>,{' '}
          <code>sleep(ms)</code>, <code>setResult(value)</code>.
          <br />
          Rückgabe-Objekt unterstützt: <code>result</code>, <code>nextTaskIds</code>,{' '}
          <code>pathGroupsByTaskId</code>, <code>endScope</code>, <code>awaitingUntil</code>,{' '}
          <code>awaitingMs</code>, <code>patchTicket</code>, <code>state</code>.
        </div>
      </div>
    );
  };

  const renderInternalProcessingStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    const mode = config.mode === 'parallel' ? 'parallel' : 'blocking';
    const assigneeStrategy =
      config.assigneeStrategy === 'fixed_user' ||
      config.assigneeStrategy === 'fixed_org' ||
      config.assigneeStrategy === 'process_variable'
        ? config.assigneeStrategy
        : 'ticket_primary';
    const taskSource = config.taskSource === 'ai_generated' ? 'ai_generated' : 'static';
    const formFields =
      config.formSchema && typeof config.formSchema === 'object' && Array.isArray(config.formSchema.fields)
        ? config.formSchema.fields
        : [];
    const processVarMappings =
      config.processVarMappings && typeof config.processVarMappings === 'object' && !Array.isArray(config.processVarMappings)
        ? (config.processVarMappings as Record<string, string>)
        : {};
    const mappingEntries = Object.entries(processVarMappings);
    const onComplete =
      config.onComplete && typeof config.onComplete === 'object' && !Array.isArray(config.onComplete)
        ? config.onComplete
        : {};
    const onReject =
      config.onReject && typeof config.onReject === 'object' && !Array.isArray(config.onReject)
        ? config.onReject
        : {};
    const dueDays = Number.isFinite(Number(config.dueDays)) ? Math.max(0, Number(config.dueDays)) : 0;
    const dueHours = Number.isFinite(Number(config.dueHours)) ? Math.max(0, Number(config.dueHours)) : 0;
    const dueMinutes = Number.isFinite(Number(config.dueMinutes)) ? Math.max(0, Number(config.dueMinutes)) : 0;
    const dueTotalMinutes = dueDays * 24 * 60 + dueHours * 60 + dueMinutes;
    const duePreview =
      dueTotalMinutes <= 0
        ? 'ohne Fälligkeit'
        : `${dueDays}d ${dueHours}h ${dueMinutes}m`;
    const assigneePreview =
      assigneeStrategy === 'fixed_user'
        ? buildAssignmentUserLabel(
            fixedInternalUserOptions.find((entry) => entry.id === String(config.assigneeUserId || '').trim()) || {
              id: String(config.assigneeUserId || '').trim(),
              username: String(config.assigneeUserId || '').trim(),
              active: false,
              isGlobalAdmin: false,
              tenantScopes: [],
              orgScopes: [],
            }
          )
        : assigneeStrategy === 'fixed_org'
        ? fixedInternalOrgOptions.find((entry) => entry.id === String(config.assigneeOrgUnitId || '').trim())?.label ||
          String(config.assigneeOrgUnitId || '').trim() ||
          'nicht gesetzt'
        : assigneeStrategy === 'process_variable'
        ? String(config.assigneeProcessVariableKey || '').trim() || 'nicht gesetzt'
        : 'Ticket-Primärzuweisung';

    const updateField = (index: number, patch: Record<string, any>) => {
      const nextFields = [...formFields];
      nextFields[index] = {
        ...nextFields[index],
        ...patch,
      };
      updateStepConfig(step.localId, {
        formSchema: {
          fields: nextFields,
        },
      });
    };

    const addField = () => {
      const nextIndex = formFields.length + 1;
      updateStepConfig(step.localId, {
        formSchema: {
          fields: [
            ...formFields,
            {
              key: `field_${nextIndex}`,
              label: `Feld ${nextIndex}`,
              type: 'text',
              required: false,
            },
          ],
        },
      });
    };

    const setMappingEntries = (entries: Array<[string, string]>) => {
      const next: Record<string, string> = {};
      for (const [rawSource, rawTarget] of entries) {
        const source = String(rawSource || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, '_');
        const target = String(rawTarget || '').trim();
        if (!source || !target) continue;
        next[source] = target;
      }
      updateStepConfig(step.localId, {
        processVarMappings: next,
      });
    };

    const updateDecisionStatus = (decisionKey: 'onComplete' | 'onReject', nextStatusValue: string) => {
      const currentDecision =
        decisionKey === 'onComplete'
          ? onComplete && typeof onComplete === 'object'
            ? { ...onComplete }
            : {}
          : onReject && typeof onReject === 'object'
          ? { ...onReject }
          : {};
      if (!nextStatusValue) {
        delete (currentDecision as any).statusAfter;
      } else {
        (currentDecision as any).statusAfter = nextStatusValue;
      }
      updateStepConfig(step.localId, {
        [decisionKey]: currentDecision,
      });
    };

    return (
      <div className="editor-group workflow-form-designer">
        <div className="workflow-form-designer-card">
          <div className="workflow-form-designer-grid">
            <div className="mui-editor-field">
              <span className="mui-editor-label">Laufzeit-Modus</span>
              <div className="setting-help m-0">
                {mode === 'parallel'
                  ? 'Parallel: Workflow läuft weiter, Aufgabe wird separat abgearbeitet.'
                  : 'Blockierend: Workflow wartet bis Abschluss/Ablehnung der Aufgabe.'}
              </div>
            </div>
            <div className="mui-editor-field">
              <span className="mui-editor-label">Assignee-Auflösung</span>
              <div className="setting-help m-0">{assigneePreview || 'nicht gesetzt'}</div>
            </div>
            <div className="mui-editor-field">
              <span className="mui-editor-label">Fälligkeit</span>
              <div className="setting-help m-0">{duePreview}</div>
            </div>
          </div>
        </div>

        <div className="workflow-form-designer-card">
          <div className="workflow-form-designer-card-head">
            <h4>
              <i className="fa-solid fa-user-gear" /> Ausführung & Zuweisung
            </h4>
          </div>
          <div className="workflow-form-designer-grid">
            <label className="mui-editor-field">
              <span className="mui-editor-label">Modus</span>
              <select
                className="mui-editor-input"
                value={mode}
                onChange={(e) =>
                  updateStepConfig(step.localId, {
                    mode: e.target.value === 'parallel' ? 'parallel' : 'blocking',
                  })
                }
              >
                <option value="blocking">Blockierend (Workflow wartet)</option>
                <option value="parallel">Parallel (Workflow läuft weiter)</option>
              </select>
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Task-Design</span>
              <select
                className="mui-editor-input"
                value={taskSource}
                onChange={(e) =>
                  updateStepConfig(step.localId, {
                    taskSource: e.target.value === 'ai_generated' ? 'ai_generated' : 'static',
                  })
                }
              >
                <option value="static">Statisch konfiguriert</option>
                <option value="ai_generated">KI-generiert</option>
              </select>
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Zuweisungsstrategie</span>
              <select
                className="mui-editor-input"
                value={assigneeStrategy}
                onChange={(e) =>
                  updateStepConfig(step.localId, {
                    assigneeStrategy: e.target.value,
                  })
                }
              >
                <option value="ticket_primary">Ticket-Primärzuweisung</option>
                <option value="fixed_user">Fester Benutzer</option>
                <option value="fixed_org">Feste Organisationseinheit</option>
                <option value="process_variable">Aus Prozessvariable</option>
              </select>
            </label>
            {assigneeStrategy === 'fixed_user' && (
              <label className="mui-editor-field">
                <span className="mui-editor-label">Assignee Benutzer</span>
                <select
                  className="mui-editor-input"
                  value={config.assigneeUserId || ''}
                  onChange={(e) =>
                    updateStepConfig(step.localId, { assigneeUserId: e.target.value, assigneeOrgUnitId: '' })
                  }
                  disabled={assignmentDirectoryLoading}
                >
                  <option value="">-- Benutzer auswählen --</option>
                  {config.assigneeUserId &&
                    !fixedInternalUserOptions.some((user) => user.id === String(config.assigneeUserId || '').trim()) && (
                      <option value={String(config.assigneeUserId)}>
                        {String(config.assigneeUserId)} (nicht mehr im Verzeichnis)
                      </option>
                    )}
                  {fixedInternalUserOptions.map((user) => (
                    <option key={`workflow-internal-user-${user.id}`} value={user.id}>
                      {user.active
                        ? buildAssignmentUserLabel(user)
                        : `${buildAssignmentUserLabel(user)} (inaktiv)`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {assigneeStrategy === 'fixed_org' && (
              <label className="mui-editor-field">
                <span className="mui-editor-label">Assignee Organisationseinheit</span>
                <select
                  className="mui-editor-input"
                  value={config.assigneeOrgUnitId || ''}
                  onChange={(e) =>
                    updateStepConfig(step.localId, { assigneeOrgUnitId: e.target.value, assigneeUserId: '' })
                  }
                  disabled={assignmentDirectoryLoading}
                >
                  <option value="">-- Organisationseinheit auswählen --</option>
                  {config.assigneeOrgUnitId &&
                    !fixedInternalOrgOptions.some((unit) => unit.id === String(config.assigneeOrgUnitId || '').trim()) && (
                      <option value={String(config.assigneeOrgUnitId)}>
                        {String(config.assigneeOrgUnitId)} (nicht mehr im Verzeichnis)
                      </option>
                    )}
                  {fixedInternalOrgOptions.map((unit) => (
                    <option key={`workflow-internal-org-${unit.id}`} value={unit.id}>
                      {unit.active ? unit.label : `${unit.label} (inaktiv)`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {assigneeStrategy === 'process_variable' && (
              <label className="mui-editor-field">
                <span className="mui-editor-label">Variable-Key für Assignee</span>
                <input
                  className="mui-editor-input"
                  value={config.assigneeProcessVariableKey || ''}
                  onChange={(e) => updateStepConfig(step.localId, { assigneeProcessVariableKey: e.target.value })}
                  placeholder="z. B. var.internalAssignee"
                />
              </label>
            )}
            {(assigneeStrategy === 'fixed_user' || assigneeStrategy === 'fixed_org') && assignmentDirectoryLoading && (
              <p className="md:col-span-2 text-xs text-slate-600">Zuweisungsverzeichnis wird geladen …</p>
            )}
            {(assigneeStrategy === 'fixed_user' || assigneeStrategy === 'fixed_org') && assignmentDirectoryError && (
              <p className="md:col-span-2 text-xs text-rose-700">{assignmentDirectoryError}</p>
            )}
          </div>
        </div>

        <div className="workflow-form-designer-card">
          <div className="workflow-form-designer-card-head">
            <h4>
              <i className="fa-solid fa-file-signature" /> Aufgabe
            </h4>
          </div>
          <div className="workflow-form-designer-grid">
            <label className="mui-editor-field">
              <span className="mui-editor-label">Aufgabentitel</span>
              <input
                className="mui-editor-input"
                value={config.taskTitle || ''}
                onChange={(e) => updateStepConfig(step.localId, { taskTitle: e.target.value })}
                placeholder="Interne Prüfung"
              />
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Beschreibung</span>
              <input
                className="mui-editor-input"
                value={config.taskDescription || ''}
                onChange={(e) => updateStepConfig(step.localId, { taskDescription: e.target.value })}
                placeholder="Kurzbeschreibung der internen Aufgabe"
              />
            </label>
            <label className="mui-editor-field md:col-span-2">
              <span className="mui-editor-label">Anweisungen</span>
              <textarea
                className="mui-editor-input"
                rows={4}
                value={config.instructions || ''}
                onChange={(e) => updateStepConfig(step.localId, { instructions: e.target.value })}
                placeholder="Was soll bei der internen Bearbeitung geprüft/entschieden werden?"
              />
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Fällig in Tagen</span>
              <input
                className="mui-editor-input"
                type="number"
                min={0}
                value={Number(config.dueDays || 0)}
                onChange={(e) => updateStepConfig(step.localId, { dueDays: Math.max(0, Number(e.target.value || 0)) })}
              />
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Fällig in Stunden</span>
              <input
                className="mui-editor-input"
                type="number"
                min={0}
                value={Number(config.dueHours || 0)}
                onChange={(e) => updateStepConfig(step.localId, { dueHours: Math.max(0, Number(e.target.value || 0)) })}
              />
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Fällig in Minuten</span>
              <input
                className="mui-editor-input"
                type="number"
                min={0}
                value={Number(config.dueMinutes || 0)}
                onChange={(e) => updateStepConfig(step.localId, { dueMinutes: Math.max(0, Number(e.target.value || 0)) })}
              />
            </label>
            <div className="flex items-end gap-2 md:col-span-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => updateStepConfig(step.localId, { dueDays: 0, dueHours: 4, dueMinutes: 0 })}
              >
                SLA 4h
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => updateStepConfig(step.localId, { dueDays: 1, dueHours: 0, dueMinutes: 0 })}
              >
                SLA 1 Tag
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => updateStepConfig(step.localId, { dueDays: 3, dueHours: 0, dueMinutes: 0 })}
              >
                SLA 3 Tage
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => updateStepConfig(step.localId, { dueDays: 0, dueHours: 0, dueMinutes: 0 })}
              >
                Keine Fälligkeit
              </button>
            </div>
          </div>
        </div>

        <div className="workflow-form-designer-card">
          <div className="workflow-form-designer-card-head">
            <h4>
              <i className="fa-solid fa-list-check" /> Formularfelder
            </h4>
            <button type="button" className="btn btn-secondary" onClick={addField}>
              <i className="fa-solid fa-plus" /> Feld hinzufügen
            </button>
          </div>
          <div className="workflow-form-field-list">
            {formFields.map((field: any, index: number) => {
              const typeOption = INTERNAL_PROCESSING_FIELD_TYPE_OPTIONS.find((entry) => entry.value === field.type);
              return (
                <div key={`${step.localId}-internal-field-${index}`} className="workflow-form-field-card">
                  <div className="workflow-form-field-head">
                    <strong>
                      <i className={`fa-solid ${typeOption?.icon || 'fa-pen'}`} /> Feld {index + 1}
                    </strong>
                    <button
                      type="button"
                      className="action-btn delete-btn"
                      onClick={() =>
                        updateStepConfig(step.localId, {
                          formSchema: {
                            fields: formFields.filter((_: any, i: number) => i !== index),
                          },
                        })
                      }
                    >
                      Entfernen
                    </button>
                  </div>
                  <div className="workflow-form-designer-grid">
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Key</span>
                      <input
                        className="mui-editor-input"
                        value={field.key || ''}
                        onChange={(e) =>
                          updateField(index, {
                            key: String(e.target.value || '')
                              .trim()
                              .toLowerCase()
                              .replace(/[^a-z0-9_]+/g, '_'),
                          })
                        }
                      />
                    </label>
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Label</span>
                      <input
                        className="mui-editor-input"
                        value={field.label || ''}
                        onChange={(e) => updateField(index, { label: e.target.value })}
                      />
                    </label>
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Typ</span>
                      <select
                        className="mui-editor-input"
                        value={field.type || 'text'}
                        onChange={(e) => updateField(index, { type: e.target.value })}
                      >
                        {INTERNAL_PROCESSING_FIELD_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="mui-editor-check">
                      <input
                        type="checkbox"
                        checked={field.required === true}
                        onChange={(e) => updateField(index, { required: e.target.checked })}
                      />
                      <span>Pflichtfeld</span>
                    </label>
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Platzhalter</span>
                      <input
                        className="mui-editor-input"
                        value={field.placeholder || ''}
                        onChange={(e) => updateField(index, { placeholder: e.target.value })}
                      />
                    </label>
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Hilfetext</span>
                      <input
                        className="mui-editor-input"
                        value={field.helpText || ''}
                        onChange={(e) => updateField(index, { helpText: e.target.value })}
                      />
                    </label>
                  </div>
                  {field.type === 'select' && (
                    <label className="mui-editor-field">
                      <span className="mui-editor-label">Auswahloptionen (eine pro Zeile)</span>
                      <textarea
                        className="mui-editor-input"
                        rows={3}
                        value={
                          Array.isArray(field.options)
                            ? field.options.map((option: any) => option?.value || '').join('\n')
                            : ''
                        }
                        onChange={(e) => {
                          const options = e.target.value
                            .split('\n')
                            .map((entry) => entry.trim())
                            .filter(Boolean)
                            .map((entry) => ({ value: entry, label: entry }));
                          updateField(index, { options });
                        }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
            {formFields.length === 0 && (
              <p className="setting-help m-0">Noch keine Felder definiert. Mit „Feld hinzufügen“ starten.</p>
            )}
          </div>
        </div>

        <div className="workflow-form-designer-card">
          <div className="workflow-form-designer-card-head">
            <h4>
              <i className="fa-solid fa-code-branch" /> Variablen & Abschlusslogik
            </h4>
          </div>
          <div className="workflow-form-designer-grid">
            <label className="mui-editor-field">
              <span className="mui-editor-label">Status nach Abschluss (optional)</span>
              <select
                className="mui-editor-input"
                value={String(onComplete.statusAfter || '')}
                onChange={(e) => updateDecisionStatus('onComplete', e.target.value)}
              >
                <option value="">Kein Ticketstatus-Update</option>
                {WAIT_STATUS_OPTIONS.map((option) => (
                  <option key={`internal-complete-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mui-editor-field">
              <span className="mui-editor-label">Status bei Ablehnung (optional)</span>
              <select
                className="mui-editor-input"
                value={String(onReject.statusAfter || '')}
                onChange={(e) => updateDecisionStatus('onReject', e.target.value)}
              >
                <option value="">Kein Ticketstatus-Update</option>
                {WAIT_STATUS_OPTIONS.map((option) => (
                  <option key={`internal-reject-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="workflow-form-field-list mt-3">
            <div className="workflow-form-field-head">
              <strong>Feld → Prozessvariable Mapping</strong>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setMappingEntries([...mappingEntries, ['', '']])}
              >
                <i className="fa-solid fa-plus" /> Mapping hinzufügen
              </button>
            </div>
            {mappingEntries.length === 0 && (
              <p className="setting-help m-0">
                Kein Mapping gesetzt. Antworten werden unter <code>internal.&lt;stepId&gt;.responses.*</code> gespeichert.
              </p>
            )}
            {mappingEntries.map(([sourceKey, targetVariable], index) => (
              <div key={`${step.localId}-mapping-${index}`} className="workflow-form-field-card">
                <div className="workflow-form-designer-grid">
                  <label className="mui-editor-field">
                    <span className="mui-editor-label">Feld-Key</span>
                    <input
                      className="mui-editor-input"
                      value={sourceKey}
                      onChange={(e) => {
                        const nextEntries = [...mappingEntries];
                        nextEntries[index] = [e.target.value, targetVariable];
                        setMappingEntries(nextEntries);
                      }}
                      placeholder="z. B. bearbeitungsnotiz"
                    />
                  </label>
                  <label className="mui-editor-field">
                    <span className="mui-editor-label">Prozessvariablen-Key</span>
                    <input
                      className="mui-editor-input"
                      value={targetVariable}
                      onChange={(e) => {
                        const nextEntries = [...mappingEntries];
                        nextEntries[index] = [sourceKey, e.target.value];
                        setMappingEntries(nextEntries);
                      }}
                      placeholder="z. B. internal.reviewNote"
                    />
                  </label>
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    className="action-btn delete-btn"
                    onClick={() => setMappingEntries(mappingEntries.filter((_, rowIndex) => rowIndex !== index))}
                  >
                    Entfernen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderCustomStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    return (
      <div className="editor-group">
        <label>
          <span className="editor-label">Hinweis / Notiz</span>
          <textarea
            className="editor-textarea"
            rows={3}
            value={config.note || ''}
            onChange={(e) => updateStepConfig(step.localId, { note: e.target.value })}
          />
        </label>
      </div>
    );
  };

  const renderDirectNextEditor = (step: EditableWorkflowStep) => {
    if (step.type === 'SPLIT' || step.type === 'IF' || step.type === 'END') return null;
    const config = normalizeStepConfig(step.type, step.config || {});
    const nextTaskId = normalizeSingleReference(config.nextTaskId);
    const targetOptions = getStepTargetOptions(step.localId);
    const isPicking = nextTargetPick?.stepId === step.localId;
    const nextLabel =
      step.type === 'EMAIL_CONFIRMATION' ||
      step.type === 'EMAIL_DOUBLE_OPT_IN' ||
      step.type === 'MAYOR_INVOLVEMENT' ||
      step.type === 'DATENNACHFORDERUNG' ||
      step.type === 'ENHANCED_CATEGORIZATION' ||
      step.type === 'FREE_AI_DATA_REQUEST'
        ? 'Nächster Schritt bei Zustimmung/Antwort (optional)'
        : 'Nächster Schritt (optional)';

    return (
      <div className="editor-group">
        <label>
          <span className="editor-label">{nextLabel}</span>
          <select
            className="editor-input"
            value={nextTaskId}
            onChange={(e) => {
              const targetId = normalizeSingleReference(e.target.value);
              updateStepConfig(step.localId, {
                nextTaskId: targetId,
                nextTaskIds: targetId ? [targetId] : [],
              });
            }}
          >
            <option value="">Automatisch</option>
            {targetOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="split-branch-actions mt-2">
          <button
            type="button"
            className={`btn btn-secondary split-branch-btn ${isPicking ? 'active' : ''}`}
            onClick={() => {
              setSplitTargetPick(null);
              setNextTargetPick((prev) => (prev?.stepId === step.localId ? null : { stepId: step.localId }));
            }}
          >
            {isPicking ? 'Zielauswahl abbrechen' : 'In Grafik wählen'}
          </button>
          <button
            type="button"
            className="btn btn-secondary split-branch-btn"
            disabled={!nextTaskId}
            onClick={() =>
              updateStepConfig(step.localId, {
                nextTaskId: '',
                nextTaskIds: [],
              })
            }
          >
            Zurück auf Automatik
          </button>
        </div>
        {isPicking && (
          <p className="setting-help mt-2">
            Bitte in der Pfadgrafik den Zielknoten für diesen Schritt anklicken.
          </p>
        )}
      </div>
    );
  };

  const renderJoinStepEditor = (step: EditableWorkflowStep) => {
    const config = normalizeStepConfig(step.type, step.config || {});
    return (
      <div className="editor-group">
        <label>
          <span className="editor-label">Wartet auf Anzahl eingehender Pfade</span>
          <input
            className="editor-input"
            type="number"
            min={1}
            value={Number(config.requiredArrivals || 2)}
            onChange={(e) =>
              updateStepConfig(step.localId, {
                requiredArrivals: Math.max(1, Number(e.target.value || 1)),
                expectedBranches: Math.max(1, Number(e.target.value || 1)),
              })
            }
          />
        </label>
        <p className="setting-help">
          Der Join-Knoten wird erst aktiviert, wenn die konfigurierte Anzahl an Pfaden ihn erreicht hat.
        </p>
      </div>
    );
  };

  const renderStepRuntimeOverrideEditor = (step: EditableWorkflowStep) => {
    const timeoutSupported = [
      'REST_API_CALL',
      'REDMINE_TICKET',
      'CHANGE_WORKFLOW',
      'SUB_WORKFLOW',
      'CATEGORIZATION',
      'RESPONSIBILITY_CHECK',
    ].includes(step.type);
    const retrySupported = !['SPLIT', 'JOIN', 'IF', 'END', 'CUSTOM'].includes(step.type);
    if (!timeoutSupported && !retrySupported) return null;

    const config = normalizeStepConfig(step.type, step.config || {});
    const retryPolicy = config.retryPolicy && typeof config.retryPolicy === 'object'
      ? config.retryPolicy
      : { maxRetries: 0, backoffSeconds: 0 };
    const timeoutSeconds =
      Number.isFinite(Number(config.timeoutSeconds)) && Number(config.timeoutSeconds) > 0
        ? Math.max(1, Math.floor(Number(config.timeoutSeconds)))
        : '';

    return (
      <div className="editor-group rounded-xl border border-slate-200 bg-slate-50 p-4 mt-3">
        <h4 className="font-semibold text-slate-900">Step Runtime Overrides (optional)</h4>
        <p className="setting-help">
          Bei leeren/0-Werten nutzt der Schritt die Vorlagen-Defaults aus „Runtime & SLA“.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {timeoutSupported && (
            <label>
              <span className="editor-label">Timeout (Sek.)</span>
              <input
                className="editor-input"
                type="number"
                min={1}
                step={1}
                value={timeoutSeconds}
                placeholder={String(editor?.runtime.defaultStepTimeoutSeconds || DEFAULT_WORKFLOW_RUNTIME.defaultStepTimeoutSeconds)}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  updateStep(step.localId, (current) => {
                    const nextConfig = { ...normalizeStepConfig(current.type, current.config || {}) };
                    if (!value) {
                      delete nextConfig.timeoutSeconds;
                    } else {
                      nextConfig.timeoutSeconds = Math.max(1, Number(value) || 1);
                    }
                    return { ...current, config: nextConfig };
                  });
                }}
              />
            </label>
          )}
          {retrySupported && (
            <>
              <label>
                <span className="editor-label">Retry max. Versuche</span>
                <input
                  className="editor-input"
                  type="number"
                  min={0}
                  step={1}
                  value={Number(retryPolicy.maxRetries || 0)}
                  onChange={(e) => {
                    const value = Math.max(0, Number(e.target.value) || 0);
                    updateStep(step.localId, (current) => ({
                      ...current,
                      config: {
                        ...normalizeStepConfig(current.type, current.config || {}),
                        retryPolicy: {
                          maxRetries: value,
                          backoffSeconds: Math.max(
                            0,
                            Number((current.config as any)?.retryPolicy?.backoffSeconds || retryPolicy.backoffSeconds || 0)
                          ),
                        },
                      },
                    }));
                  }}
                />
              </label>
              <label>
                <span className="editor-label">Retry Backoff (Sek.)</span>
                <input
                  className="editor-input"
                  type="number"
                  min={0}
                  step={1}
                  value={Number(retryPolicy.backoffSeconds || 0)}
                  onChange={(e) => {
                    const value = Math.max(0, Number(e.target.value) || 0);
                    updateStep(step.localId, (current) => ({
                      ...current,
                      config: {
                        ...normalizeStepConfig(current.type, current.config || {}),
                        retryPolicy: {
                          maxRetries: Math.max(
                            0,
                            Number((current.config as any)?.retryPolicy?.maxRetries || retryPolicy.maxRetries || 0)
                          ),
                          backoffSeconds: value,
                        },
                      },
                    }));
                  }}
                />
              </label>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderStepConfigEditor = (step: EditableWorkflowStep) => {
    let content: React.ReactNode;
    switch (step.type) {
      case 'REDMINE_TICKET':
        content = renderRedmineStepEditor(step);
        break;
      case 'EMAIL':
      case 'EMAIL_EXTERNAL':
        content = renderEmailStepEditor(step);
        break;
      case 'EMAIL_DOUBLE_OPT_IN':
      case 'EMAIL_CONFIRMATION':
        content = renderConfirmationStepEditor(step);
        break;
      case 'MAYOR_INVOLVEMENT':
        content = renderMayorInvolvementStepEditor(step);
        break;
      case 'DATENNACHFORDERUNG':
      case 'ENHANCED_CATEGORIZATION':
      case 'FREE_AI_DATA_REQUEST':
        content = renderDataRequestStepEditor(step);
        break;
      case 'IMAGE_TO_TEXT_ANALYSIS':
        content = renderImageToTextStepEditor(step);
        break;
      case 'CITIZEN_NOTIFICATION':
        content = renderCitizenNotificationStepEditor(step);
        break;
      case 'REST_API_CALL':
        content = renderRestApiCallStepEditor(step);
        break;
      case 'INTERNAL_PROCESSING':
        content = renderInternalProcessingStepEditor(step);
        break;
      case 'END':
        content = renderEndStepEditor(step);
        break;
      case 'JOIN':
        content = renderJoinStepEditor(step);
        break;
      case 'SPLIT':
        content = renderSplitStepEditor(step);
        break;
      case 'IF':
        content = renderIfStepEditor(step);
        break;
      case 'WAIT_STATUS_CHANGE':
        content = renderWaitStatusStepEditor(step);
        break;
      case 'CHANGE_WORKFLOW':
        content = renderChangeWorkflowStepEditor(step);
        break;
      case 'SUB_WORKFLOW':
        content = renderSubWorkflowStepEditor(step);
        break;
      case 'RESPONSIBILITY_CHECK':
        content = renderResponsibilityCheckStepEditor(step);
        break;
      case 'CATEGORIZATION':
        content = renderCategorizationStepEditor(step);
        break;
      case 'CUSTOM':
      default:
        content = renderCustomStepEditor(step);
        break;
    }

    return (
      <>
        {content}
        {renderStepRuntimeOverrideEditor(step)}
        {renderDirectNextEditor(step)}
      </>
    );
  };

  const workflowTemplateTableRows = useMemo<WorkflowTemplateTableRow[]>(
    () =>
      sortedTemplates.map((template) => {
        const scopeBadge = resolveWorkflowScopeBadge(template);
        return {
          id: template.id,
          name: template.name || template.id,
          scopeLabel: scopeBadge.label,
          scopeVariant: scopeBadge.variant,
          executionMode: template.executionMode,
          stepsCount: Array.isArray(template.steps) ? template.steps.length : 0,
          enabledLabel: template.enabled === false ? 'Deaktiviert' : 'Aktiv',
          autoTriggerLabel: template.autoTriggerOnEmailVerified ? 'Ja' : 'Nein',
          description: template.description || 'Keine Beschreibung',
          templateRef: template,
        };
      }),
    [sortedTemplates]
  );

  const workflowTemplateTableColumns = useMemo<SmartTableColumnDef<WorkflowTemplateTableRow>[]>(
    () => [
      {
        field: 'name',
        headerName: 'Name',
        minWidth: 220,
        flex: 1.1,
      },
      {
        field: 'scopeLabel',
        headerName: 'Gültigkeit',
        minWidth: 170,
        renderCell: (params) => (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${workflowScopeBadgeClassName(params.row.scopeVariant)}`}
          >
            {params.row.scopeLabel}
          </span>
        ),
      },
      {
        field: 'executionMode',
        headerName: 'Modus',
        minWidth: 140,
      },
      {
        field: 'stepsCount',
        headerName: 'Schritte',
        minWidth: 110,
      },
      {
        field: 'enabledLabel',
        headerName: 'Status',
        minWidth: 140,
      },
      {
        field: 'autoTriggerLabel',
        headerName: 'Auto-Start',
        minWidth: 130,
      },
      {
        field: 'description',
        headerName: 'Beschreibung',
        minWidth: 320,
        flex: 1.4,
        renderCell: (params) => (
          <span className="smart-table-multiline-text" title={params.row.description}>
            {params.row.description}
          </span>
        ),
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 170,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        hideable: false,
        renderCell: (params) => {
          const template = params.row.templateRef;
          const isDeleting = deletingTemplateId === template.id;
          const isProtected = template.id === 'standard-redmine-ticket' || template.id === 'standard-intake-workflow';
          return (
            <SmartTableRowActions>
              <SmartTableRowActionButton
                label="Workflow bearbeiten"
                icon={<EditOutlinedIcon fontSize="inherit" />}
                tone="primary"
                onClick={() => {
                  startEditTemplate(template);
                }}
              />
              <SmartTableRowActionButton
                label="Workflow duplizieren"
                icon={<ContentCopyRoundedIcon fontSize="inherit" />}
                onClick={() => {
                  startDuplicateTemplate(template);
                }}
              />
              <SmartTableRowActionButton
                label="Workflow exportieren"
                icon={<DownloadRoundedIcon fontSize="inherit" />}
                onClick={() => {
                  handleExportSingleTemplateAsJson(template);
                }}
              />
              <SmartTableRowActionButton
                label={
                  isProtected
                    ? 'Standard-Workflow kann nicht gelöscht werden'
                    : isDeleting
                      ? 'Workflow wird gelöscht…'
                      : 'Workflow löschen'
                }
                icon={<DeleteOutlineRoundedIcon fontSize="inherit" />}
                tone="danger"
                onClick={() => {
                  void handleDeleteTemplate(template);
                }}
                disabled={isDeleting || isProtected}
                loading={isDeleting}
              />
            </SmartTableRowActions>
          );
        },
      },
    ],
    [deletingTemplateId, handleDeleteTemplate, handleExportSingleTemplateAsJson, startDuplicateTemplate, startEditTemplate]
  );

  if (loading) {
    return (
      <div className="workflow-settings">
        <div className="card p-6">
          <i className="fa-solid fa-spinner fa-spin" /> Lade Workflow-Definitionen…
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-settings">
      <h2 className="settings-title">Workflow-Definitionen</h2>
      <p className="settings-subtitle">Hier werden Prozessschritte, Automatisierungsmodus und Redmine-Wartepunkte konfiguriert.</p>
      <div className="mb-4">
        <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
          Aktueller Kontext: {workflowScopeParams.scope === 'tenant' ? 'Mandant' : 'Global'}
        </span>
      </div>

      {message && (
        <div className={`message-banner mb-6 p-4 rounded-lg ${messageType === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {message}
        </div>
      )}

      {workflowAiDialog && (
        <div className="workflow-ai-overlay" role="dialog" aria-modal="true" aria-label="Workflow mit KI erstellen">
          <div className="workflow-ai-modal">
            <div className="workflow-ai-header">
              <h3><i className="fa-solid fa-wand-magic-sparkles" /> Workflow mit KI-Assistent erstellen</h3>
              <button
                type="button"
                className="workflow-editor-close"
                onClick={closeWorkflowAiDialog}
                disabled={workflowAiDialog.generating}
                aria-label="KI-Dialog schließen"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="workflow-ai-body">
              <p className="setting-help">
                Beschreiben Sie den Ablauf in natürlicher Sprache. Die KI erzeugt daraus eine DTPN-konforme Workflow-Vorlage
                mit korrekten Schritt- und Pfadreferenzen.
              </p>
              <div className="workflow-ai-grid">
                <label>
                  <span className="editor-label">Name (Vorschlag)</span>
                  <input
                    className="editor-input"
                    value={workflowAiDialog.nameHint}
                    onChange={(event) =>
                      setWorkflowAiDialog((prev) =>
                        prev ? { ...prev, nameHint: event.target.value } : prev
                      )
                    }
                    disabled={workflowAiDialog.generating}
                  />
                </label>
                <label>
                  <span className="editor-label">Ausführungsmodus</span>
                  <select
                    className="editor-input"
                    value={workflowAiDialog.executionMode}
                    onChange={(event) =>
                      setWorkflowAiDialog((prev) =>
                        prev
                          ? {
                              ...prev,
                              executionMode: normalizeSingleImportedExecutionMode(event.target.value),
                            }
                          : prev
                      )
                    }
                    disabled={workflowAiDialog.generating}
                  >
                    <option value="MANUAL">MANUAL</option>
                    <option value="AUTO">AUTO</option>
                    <option value="HYBRID">HYBRID</option>
                  </select>
                </label>
                <label>
                  <span className="editor-label">Maximale Schritte</span>
                  <input
                    className="editor-input"
                    type="number"
                    min={3}
                    max={120}
                    value={workflowAiDialog.maxSteps}
                    onChange={(event) =>
                      setWorkflowAiDialog((prev) =>
                        prev
                          ? {
                              ...prev,
                              maxSteps: Math.max(3, Math.min(120, Number(event.target.value) || 3)),
                            }
                          : prev
                      )
                    }
                    disabled={workflowAiDialog.generating}
                  />
                </label>
              </div>

              <label>
                <span className="editor-label">Beschreibung (Vorschlag)</span>
                <input
                  className="editor-input"
                  value={workflowAiDialog.descriptionHint}
                  onChange={(event) =>
                    setWorkflowAiDialog((prev) =>
                      prev ? { ...prev, descriptionHint: event.target.value } : prev
                    )
                  }
                  disabled={workflowAiDialog.generating}
                />
              </label>

              <div className="workflow-ai-checkboxes">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={workflowAiDialog.autoTriggerOnEmailVerified}
                    onChange={(event) =>
                      setWorkflowAiDialog((prev) =>
                        prev ? { ...prev, autoTriggerOnEmailVerified: event.target.checked } : prev
                      )
                    }
                    disabled={workflowAiDialog.generating}
                  />
                  <span>Auto-Start nach E-Mail-Verifizierung</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={workflowAiDialog.enabled}
                    onChange={(event) =>
                      setWorkflowAiDialog((prev) => (prev ? { ...prev, enabled: event.target.checked } : prev))
                    }
                    disabled={workflowAiDialog.generating}
                  />
                  <span>Vorlage aktiv</span>
                </label>
              </div>

              <label>
                <span className="editor-label">Prompt</span>
                <textarea
                  className="editor-textarea"
                  rows={10}
                  value={workflowAiDialog.prompt}
                  onChange={(event) =>
                    setWorkflowAiDialog((prev) => (prev ? { ...prev, prompt: event.target.value } : prev))
                  }
                  placeholder='Beispiel: "Erst Bürger-Freigabe per E-Mail, dann Redmine-Ticket per KI ohne Assignee, parallel 10 Minuten warten, bei offenem Status Priorität auf critical setzen, danach Ende."'
                  disabled={workflowAiDialog.generating}
                />
              </label>

              <details className="workflow-ai-reference">
                <summary>
                  <span><i className="fa-solid fa-book-open" /> Verfügbare DTPN-Elemente und Regeln</span>
                  <span className="workflow-ai-reference-summary-hint">Für präzise KI-Workflows</span>
                </summary>

                <p className="setting-help">
                  Nutzen Sie die Typnamen im Prompt. Die KI erzeugt daraus eine DTPN-konforme Struktur mit gültigen
                  Schrittverweisen.
                </p>

                <div className="workflow-ai-reference-grid">
                  {WORKFLOW_AI_ELEMENT_REFERENCES.map((entry) => (
                    <article key={entry.type} className="workflow-ai-reference-card">
                      <h4>
                        <i className={`fa-solid ${entry.icon}`} /> <code>{entry.type}</code>
                      </h4>
                      <p>{entry.purpose}</p>
                      <div className="workflow-ai-reference-card-section">
                        <strong>Wichtige Config</strong>
                        <ul>
                          {entry.config.map((configLine, index) => (
                            <li key={`${entry.type}-cfg-${index}`}>{configLine}</li>
                          ))}
                        </ul>
                      </div>
                      {entry.notes && entry.notes.length > 0 && (
                        <div className="workflow-ai-reference-card-section">
                          <strong>Hinweise</strong>
                          <ul>
                            {entry.notes.map((note, index) => (
                              <li key={`${entry.type}-note-${index}`}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </article>
                  ))}
                </div>

                <div className="workflow-ai-reference-rules">
                  <h4><i className="fa-solid fa-list-check" /> DTPN-Modellierungsregeln</h4>
                  <ul>
                    <li>Task-Referenzen immer als <code>task-&lt;index&gt;</code> (Schritt 0 = <code>task-0</code>).</li>
                    <li>Workflowstart ist immer <code>task-0</code>.</li>
                    <li>Bei <code>EMAIL_CONFIRMATION</code>/<code>EMAIL_DOUBLE_OPT_IN</code>/<code>MAYOR_INVOLVEMENT</code> (nur Modus <code>approval</code>) steht <code>nextTaskIds</code> für Zustimmung und <code>rejectNextTaskIds</code> für Ablehnung; bei <code>DATENNACHFORDERUNG</code>/<code>ENHANCED_CATEGORIZATION</code>/<code>FREE_AI_DATA_REQUEST</code> für Antwortpfad und Timeout (bei KI-Varianten optional mit Vorprüfung und Folgezyklen). <code>IMAGE_TO_TEXT_ANALYSIS</code> nutzt optional Konfidenz-Logik, kann Beschreibung/OSM/Wetter als Prompt-Kontext einschließen und schreibt Bildbeschreibungen ins Ticket.</li>
                    <li><code>CATEGORIZATION</code> nutzt die normale KI-Klassifizierung und startet den Kategorie-Workflow (Intake endet typischerweise mit <code>endCurrentWorkflow=true</code>); optional kann per <code>enableOrgUnitAssignment</code> eine Primärzuweisung auf Org-Einheiten im Ticket-Mandanten erfolgen.</li>
                    <li>IF verzweigt ausschließlich über <code>trueNextTaskIds</code> und <code>falseNextTaskIds</code>.</li>
                    <li>SPLIT startet parallele Pfade; für Synchronisierung danach JOIN einsetzen.</li>
                    <li>END mit <code>scope=branch</code> beendet Pfad, mit <code>scope=workflow</code> den gesamten Ablauf.</li>
                    <li>Keine Verweise auf nicht existierende Task-IDs verwenden.</li>
                    <li>Endlosschleifen nur mit expliziter Warte-/Freigabebedingung modellieren.</li>
                  </ul>
                </div>

                <div className="workflow-ai-reference-rules">
                  <h4><i className="fa-solid fa-sliders" /> Zulässige Wertebereiche</h4>
                  <ul>
                    <li>Statuswerte: <code>{WORKFLOW_AI_REFERENCE_STATUS_VALUES.join(', ')}</code></li>
                    <li>Prioritätswerte: <code>{WORKFLOW_AI_REFERENCE_PRIORITY_VALUES.join(', ')}</code></li>
                    <li>IF-Operatoren: <code>{WORKFLOW_AI_REFERENCE_IF_OPERATORS.join(', ')}</code></li>
                    <li>Geofence-Modi: <code>inside</code> / <code>outside</code> mit <code>circle</code> oder <code>polygon</code>.</li>
                  </ul>
                </div>
              </details>
            </div>

            <div className="workflow-ai-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeWorkflowAiDialog}
                disabled={workflowAiDialog.generating}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleGenerateWorkflowViaAi}
                disabled={workflowAiDialog.generating || workflowAiDialog.prompt.trim().length < 8}
              >
                {workflowAiDialog.generating ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Generiere…
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-sparkles" /> Workflow generieren
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {workflowImportDialog && (
        <div className="workflow-import-overlay" role="dialog" aria-modal="true" aria-label="Workflow-Import">
          <div className="workflow-import-modal">
            <div className="workflow-import-header">
              <h3><i className="fa-solid fa-file-import" /> Workflow-JSON importieren</h3>
              <button
                type="button"
                className="workflow-editor-close"
                onClick={closeWorkflowImportDialog}
                disabled={workflowImportDialog.importing}
                aria-label="Import-Dialog schließen"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="workflow-import-body">
              <p className="setting-help">
                Datei: <strong>{workflowImportDialog.fileName}</strong> · gefundene Vorlagen:{' '}
                <strong>{workflowImportDialog.templates.length}</strong>
              </p>

              <div className="workflow-import-grid">
                <label>
                  <span className="editor-label">Importmodus</span>
                  <select
                    className="editor-input"
                    value={workflowImportDialog.mode}
                    onChange={(event) =>
                      setWorkflowImportDialog((prev) =>
                        prev
                          ? {
                              ...prev,
                              mode: event.target.value === 'replace' ? 'replace' : 'merge',
                            }
                          : prev
                      )
                    }
                    disabled={workflowImportDialog.importing}
                  >
                    <option value="merge">Zusammenführen</option>
                    <option value="replace">Bestehende Vorlagen ersetzen</option>
                  </select>
                </label>
                {selectedImportTemplate && (
                  <label>
                    <span className="editor-label">Name beim Import</span>
                    <input
                      className="editor-input"
                      value={workflowImportDialog.nameOverride}
                      onChange={(event) =>
                        setWorkflowImportDialog((prev) =>
                          prev ? { ...prev, nameOverride: event.target.value } : prev
                        )
                      }
                      placeholder="Neuer Name für die importierte Vorlage"
                      disabled={workflowImportDialog.importing}
                    />
                  </label>
                )}
              </div>

              {workflowImportDialog.templates.length > 1 && (
                <>
                  <div className="workflow-import-selection-head">
                    <div className="workflow-import-selection-title">
                      Auswahl: {selectedImportTemplates.length} von {workflowImportDialog.templates.length}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary split-branch-btn"
                      onClick={() =>
                        setWorkflowImportDialog((prev) => {
                          if (!prev) return prev;
                          const allSelected = prev.selectedSourceIndexes.length === prev.templates.length;
                          if (allSelected) {
                            return {
                              ...prev,
                              selectedSourceIndexes: [],
                              nameOverride: '',
                            };
                          }
                          return {
                            ...prev,
                            selectedSourceIndexes: prev.templates.map((template) => template.sourceIndex),
                            nameOverride: prev.nameOverride,
                          };
                        })
                      }
                      disabled={workflowImportDialog.importing}
                    >
                      {workflowImportDialog.selectedSourceIndexes.length === workflowImportDialog.templates.length
                        ? 'Auswahl aufheben'
                        : 'Alle auswählen'}
                    </button>
                  </div>

                  <div className="workflow-import-template-list">
                    {workflowImportDialog.templates.map((template) => {
                      const isChecked = workflowImportDialog.selectedSourceIndexes.includes(template.sourceIndex);
                      return (
                        <label
                          key={`${template.id}-${template.sourceIndex}`}
                          className={`workflow-import-template-row ${isChecked ? 'selected' : ''}`}
                        >
                          <span className="workflow-import-template-main">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setWorkflowImportDialog((prev) => {
                                  if (!prev) return prev;
                                  const currentSet = new Set(prev.selectedSourceIndexes);
                                  if (checked) currentSet.add(template.sourceIndex);
                                  else currentSet.delete(template.sourceIndex);
                                  const nextSelected = Array.from(currentSet);
                                  const nextSingle =
                                    nextSelected.length === 1
                                      ? prev.templates.find((item) => item.sourceIndex === nextSelected[0])
                                      : null;
                                  return {
                                    ...prev,
                                    selectedSourceIndexes: nextSelected,
                                    nameOverride:
                                      nextSingle?.name ??
                                      (nextSelected.length === 0 ? '' : prev.nameOverride),
                                  };
                                });
                              }}
                              disabled={workflowImportDialog.importing}
                            />
                            <span className="workflow-import-template-name">{template.name}</span>
                          </span>
                          <span className="workflow-import-template-meta">
                            {template.stepsCount} Schritte · {template.executionMode}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}

              {selectedImportTemplate && (
                <div className="workflow-import-preview">
                  <div className="workflow-import-preview-title">Vorschau</div>
                  <div className="workflow-import-preview-meta">
                    <span>ID: {selectedImportTemplate.id || '–'}</span>
                    <span>Schritte: {selectedImportTemplate.stepsCount}</span>
                    <span>Modus: {selectedImportTemplate.executionMode}</span>
                  </div>
                  {selectedImportTemplate.description && (
                    <p className="setting-help">{selectedImportTemplate.description}</p>
                  )}
                </div>
              )}
            </div>

            <div className="workflow-import-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeWorkflowImportDialog}
                disabled={workflowImportDialog.importing}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmWorkflowImport}
                disabled={
                  workflowImportDialog.importing ||
                  selectedImportTemplates.length === 0
                }
              >
                {workflowImportDialog.importing ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Importiere…
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-check" /> Import starten
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {!editor && (
        <div className="templates-panel">
          <div className="templates-header">
            <h3>Vorlagen</h3>
            <div className="templates-header-actions">
              <div className="template-view-toggle" role="tablist" aria-label="Ansicht für Workflow-Definitionen">
                <button
                  type="button"
                  role="tab"
                  aria-selected={templateViewMode === 'cards'}
                  className={`template-view-btn ${templateViewMode === 'cards' ? 'active' : ''}`}
                  onClick={() => setTemplateViewMode('cards')}
                >
                  <i className="fa-solid fa-table-cells-large" /> Kacheln
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={templateViewMode === 'table'}
                  className={`template-view-btn ${templateViewMode === 'table' ? 'active' : ''}`}
                  onClick={() => setTemplateViewMode('table')}
                >
                  <i className="fa-solid fa-table-list" /> Tabelle
                </button>
              </div>
              <button className="btn btn-secondary" type="button" onClick={openWorkflowAiDialog}>
                <i className="fa-solid fa-wand-magic-sparkles" /> KI-Assistent
              </button>
              <button className="btn btn-secondary" type="button" onClick={handleExportTemplatesAsJson}>
                <i className="fa-solid fa-file-export" /> JSON Export
              </button>
              <button className="btn btn-secondary" type="button" onClick={openImportTemplatesDialog}>
                <i className="fa-solid fa-file-import" /> JSON Import
              </button>
              <input
                ref={importTemplatesInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={handleImportTemplatesFile}
              />
              <button className="btn btn-primary" type="button" onClick={startCreateTemplate}>
                <i className="fa-solid fa-plus" /> Neue Vorlage
              </button>
            </div>
          </div>

          {sortedTemplates.length === 0 ? (
            <div className="empty-state">
              <p>Keine Workflow-Vorlagen vorhanden.</p>
              <small>Erstellen Sie eine neue Vorlage, um Prozesse für Tickets zu steuern.</small>
            </div>
          ) : templateViewMode === 'table' ? (
            <SmartTable<WorkflowTemplateTableRow>
              tableId="workflow-template-list"
              userId={getAdminToken() || 'workflow-admin'}
              title="Workflow-Vorlagen"
              rows={workflowTemplateTableRows}
              columns={workflowTemplateTableColumns}
              loading={false}
              defaultPageSize={25}
              pageSizeOptions={[10, 25, 50, 100]}
              onRowClick={(row) => startEditTemplate(row.templateRef)}
              disableRowSelectionOnClick
            />
          ) : (
            <div className="templates-list">
              {sortedTemplates.map((template) => {
                const scopeBadge = resolveWorkflowScopeBadge(template);
                return (
                <div key={template.id} className="template-card">
                  <div className="template-header">
                    <h4 className="template-name">{template.name}</h4>
                    <span className="template-mode">{template.executionMode}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${workflowScopeBadgeClassName(scopeBadge.variant)}`}
                    >
                      {scopeBadge.label}
                    </span>
                    {template.scope === 'tenant' && template.tenantId ? (
                      <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-mono text-slate-600">
                        {template.tenantId}
                      </span>
                    ) : null}
                  </div>
                  <p className="template-description">{template.description || 'Keine Beschreibung'}</p>
                  <div className="template-info">
                    <span>{template.steps?.length || 0} Schritte</span>
                    <span>{template.enabled === false ? 'Deaktiviert' : 'Aktiv'}</span>
                  </div>
                  {template.autoTriggerOnEmailVerified && <span className="auto-trigger-badge">Auto-Start nach Verifizierung</span>}
                  <div className="template-actions">
                    <button className="action-btn" type="button" onClick={() => startEditTemplate(template)}>
                      Bearbeiten
                    </button>
                    <button className="action-btn" type="button" onClick={() => startDuplicateTemplate(template)}>
                      Duplizieren
                    </button>
                    <button
                      className="action-btn"
                      type="button"
                      onClick={() => handleExportSingleTemplateAsJson(template)}
                    >
                      Export
                    </button>
                    <button
                      className="action-btn delete-btn"
                      type="button"
                      onClick={() => handleDeleteTemplate(template)}
                      disabled={deletingTemplateId === template.id || template.id === 'standard-redmine-ticket'}
                      title={template.id === 'standard-redmine-ticket' ? 'Standard-Workflow kann nicht gelöscht werden' : ''}
                    >
                      {deletingTemplateId === template.id ? 'Lösche…' : 'Löschen'}
                    </button>
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </div>
      )}

      {editor && (
        <div className="workflow-editor-page">
          <div className="workflow-editor-modal-header workflow-editor-page-header">
            <div className="workflow-editor-page-title-wrap">
              <button className="workflow-editor-back" type="button" onClick={closeEditor}>
                <i className="fa-solid fa-arrow-left" /> Zurück zur Vorlagenliste
              </button>
              <h3>{editor.id ? `Vorlage bearbeiten: ${editor.name}` : 'Neue Vorlage erstellen'}</h3>
              {activeEditorScopeBadge ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${workflowScopeBadgeClassName(activeEditorScopeBadge.variant)}`}
                  >
                    {activeEditorScopeBadge.label}
                  </span>
                  {activeEditorTemplateMeta?.scope === 'tenant' && activeEditorTemplateMeta?.tenantId ? (
                    <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-mono text-slate-600">
                      {activeEditorTemplateMeta.tenantId}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="workflow-editor-page-header-actions">
              <button className="btn btn-secondary" type="button" onClick={openWorkflowAiDialog}>
                <i className="fa-solid fa-wand-magic-sparkles" /> KI-Assistent
              </button>
              <button className="btn btn-secondary" type="button" onClick={openEditorImportTemplateDialog}>
                <i className="fa-solid fa-file-import" /> JSON Import
              </button>
              <button className="btn btn-secondary" type="button" onClick={handleExportEditorTemplateAsJson}>
                <i className="fa-solid fa-file-export" /> JSON Export
              </button>
              <input
                ref={editorImportTemplateInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={handleImportSingleTemplateIntoEditor}
              />
            </div>
          </div>

          <div className="workflow-editor-modal-body workflow-editor-page-body">
            <div className="workflow-editor-layout">
              <div className="workflow-editor-main">
                <section className="workflow-editor-panel">
                  <button
                    type="button"
                    className="workflow-editor-panel-header"
                    onClick={() => toggleEditorPanel('meta')}
                    aria-expanded={editorPanels.meta}
                  >
                    <span><i className="fa-solid fa-sliders" /> Workflow-Grunddaten</span>
                    <i className={`fa-solid ${editorPanels.meta ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
                  </button>
                  {editorPanels.meta && (
                    <div className="workflow-editor-panel-body">
                      <div className="editor-note">
                        Hinweis: Bei REDMINE-Schritten kann "Warten auf Zielstatus" direkt pro Schritt aktiviert werden.
                      </div>

                      <div className="editor-group">
                        <label className="editor-label">Name</label>
                        <input
                          className="editor-input"
                          value={editor.name}
                          onChange={(e) => setEditor((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                        />
                      </div>

                      <div className="editor-group">
                        <label className="editor-label">Beschreibung</label>
                        <textarea
                          className="editor-textarea"
                          rows={2}
                          value={editor.description}
                          onChange={(e) => setEditor((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-0">
                        <label>
                          <span className="editor-label">Ausführungsmodus</span>
                          <select
                            className="editor-input"
                            value={editor.executionMode}
                            onChange={(e) => setEditor((prev) => (prev ? { ...prev, executionMode: e.target.value as WorkflowExecutionMode } : prev))}
                          >
                            <option value="MANUAL">MANUAL</option>
                            <option value="AUTO">AUTO</option>
                            <option value="HYBRID">HYBRID</option>
                          </select>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={editor.enabled}
                            onChange={(e) => setEditor((prev) => (prev ? { ...prev, enabled: e.target.checked } : prev))}
                          />
                          <span>Vorlage aktiv</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={editor.autoTriggerOnEmailVerified}
                            onChange={(e) => setEditor((prev) => (prev ? { ...prev, autoTriggerOnEmailVerified: e.target.checked } : prev))}
                          />
                          <span>Auto-Start nach E-Mail-Verifizierung</span>
                        </label>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                        <h4 className="font-semibold text-slate-900">Runtime & SLA</h4>
                        <p className="setting-help">
                          Guardrails für Stabilität, Retry-Verhalten und SLA-Ampel dieser Vorlage.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <label>
                            <span className="editor-label">Max. Transitionen</span>
                            <input
                              className="editor-input"
                              type="number"
                              min={50}
                              step={1}
                              value={editor.runtime.maxTransitionsPerExecution}
                              onChange={(e) =>
                                setEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        runtime: {
                                          ...prev.runtime,
                                          maxTransitionsPerExecution: Math.max(50, Number(e.target.value) || 50),
                                        },
                                      }
                                    : prev
                                )
                              }
                            />
                          </label>
                          <label>
                            <span className="editor-label">Max. Besuche pro Knoten</span>
                            <input
                              className="editor-input"
                              type="number"
                              min={1}
                              step={1}
                              value={editor.runtime.maxVisitsPerTask}
                              onChange={(e) =>
                                setEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        runtime: {
                                          ...prev.runtime,
                                          maxVisitsPerTask: Math.max(1, Number(e.target.value) || 1),
                                        },
                                      }
                                    : prev
                                )
                              }
                            />
                          </label>
                          <label>
                            <span className="editor-label">Default Timeout (Sek.)</span>
                            <input
                              className="editor-input"
                              type="number"
                              min={1}
                              step={1}
                              value={editor.runtime.defaultStepTimeoutSeconds}
                              onChange={(e) =>
                                setEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        runtime: {
                                          ...prev.runtime,
                                          defaultStepTimeoutSeconds: Math.max(1, Number(e.target.value) || 1),
                                        },
                                      }
                                    : prev
                                )
                              }
                            />
                          </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <label>
                            <span className="editor-label">Retry max. Versuche</span>
                            <input
                              className="editor-input"
                              type="number"
                              min={0}
                              step={1}
                              value={editor.runtime.retryPolicy.maxRetries}
                              onChange={(e) =>
                                setEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        runtime: {
                                          ...prev.runtime,
                                          retryPolicy: {
                                            ...prev.runtime.retryPolicy,
                                            maxRetries: Math.max(0, Number(e.target.value) || 0),
                                          },
                                        },
                                      }
                                    : prev
                                )
                              }
                            />
                          </label>
                          <label>
                            <span className="editor-label">Retry Backoff (Sek.)</span>
                            <input
                              className="editor-input"
                              type="number"
                              min={0}
                              step={1}
                              value={editor.runtime.retryPolicy.backoffSeconds}
                              onChange={(e) =>
                                setEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        runtime: {
                                          ...prev.runtime,
                                          retryPolicy: {
                                            ...prev.runtime.retryPolicy,
                                            backoffSeconds: Math.max(0, Number(e.target.value) || 0),
                                          },
                                        },
                                      }
                                    : prev
                                )
                              }
                            />
                          </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <label>
                            <span className="editor-label">SLA Ziel (Wochen)</span>
                            <input
                              className="editor-input"
                              type="number"
                              min={0}
                              step={1}
                              value={slaDurationParts.weeks}
                              onChange={(e) => updateSlaDurationPart('weeks', e.target.value)}
                            />
                          </label>
                          <label>
                            <span className="editor-label">SLA Ziel (Tage)</span>
                            <input
                              className="editor-input"
                              type="number"
                              min={0}
                              step={1}
                              value={slaDurationParts.days}
                              onChange={(e) => updateSlaDurationPart('days', e.target.value)}
                            />
                          </label>
                          <label>
                            <span className="editor-label">SLA Ziel (Stunden)</span>
                            <input
                              className="editor-input"
                              type="number"
                              min={0}
                              step={1}
                              value={slaDurationParts.hours}
                              onChange={(e) => updateSlaDurationPart('hours', e.target.value)}
                            />
                          </label>
                          <label>
                            <span className="editor-label">SLA Risiko-Schwelle (%)</span>
                            <input
                              className="editor-input"
                              type="number"
                              min={1}
                              max={99}
                              step={1}
                              value={editor.runtime.sla.riskThresholdPercent}
                              onChange={(e) =>
                                setEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        runtime: {
                                          ...prev.runtime,
                                          sla: {
                                            ...prev.runtime.sla,
                                            riskThresholdPercent: Math.max(
                                              1,
                                              Math.min(99, Number(e.target.value) || 1)
                                            ),
                                          },
                                        },
                                      }
                                    : prev
                                )
                              }
                            />
                          </label>
                        </div>
                        <p className="setting-help">
                          SLA-Ziel gesamt: {editor.runtime.sla.targetMinutes} Minuten
                        </p>
                      </div>
                    </div>
                  )}
                </section>

                <section className="workflow-editor-panel">
                  <button
                    type="button"
                    className="workflow-editor-panel-header"
                    onClick={() => toggleEditorPanel('flow')}
                    aria-expanded={editorPanels.flow}
                  >
                    <span><i className="fa-solid fa-list-check" /> Ablauf-Editor</span>
                    <i className={`fa-solid ${editorPanels.flow ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
                  </button>
                  {editorPanels.flow && (
                    <div className="workflow-editor-panel-body">
            <div className="workflow-step-list">
              {editor.steps.map((step, index) => {
                const isExpanded = focusedStepId === step.localId;
                return (
                <React.Fragment key={step.localId}>
                  <div
                    className={`workflow-step-separator ${dropIndex === index ? 'active' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropIndex(index);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedStepId) {
                        reorderStepToIndex(draggedStepId, index);
                      }
                      setDropIndex(null);
                    }}
                  >
                    <span>{dropIndex === index ? 'Hier einfügen' : '⋯'}</span>
                  </div>

                  <div
                    ref={(element) => {
                      stepCardRefs.current[step.localId] = element;
                    }}
                    className={`workflow-step-card ${draggedStepId === step.localId ? 'dragging' : ''} ${
                      focusedStepId === step.localId ? 'focused' : ''
                    } ${isExpanded ? 'expanded' : 'collapsed'}`}
                    onClick={() => setFocusedStepId(step.localId)}
                  >
                    <div className="workflow-step-header">
                      <div className="workflow-step-headline">
                        <div
                          className="workflow-step-drag"
                          draggable
                          onDragStart={(event) => {
                            event.stopPropagation();
                            setDraggedStepId(step.localId);
                          }}
                          onDragEnd={(event) => {
                            event.stopPropagation();
                            setDraggedStepId(null);
                            setDropIndex(null);
                          }}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <i className="fa-solid fa-grip-vertical" /> Knoten {index + 1} · Drag & Drop
                        </div>
                        <div className="workflow-step-title">{step.title || STEP_TYPE_LABELS[step.type]}</div>
                        <div className="workflow-step-type">{STEP_TYPE_LABELS[step.type]}</div>
                      </div>
                      <div className="workflow-step-header-actions">
                        {!isExpanded && (
                          <button className="workflow-step-open-btn" type="button" onClick={() => setFocusedStepId(step.localId)}>
                            Einstellungen öffnen
                          </button>
                        )}
                        <button
                          className="workflow-step-remove"
                          type="button"
                          onClick={() => {
                            setEditor((prev) => {
                              if (!prev) return prev;
                              return { ...prev, steps: prev.steps.filter((candidate) => candidate.localId !== step.localId) };
                            });
                          }}
                        >
                          Entfernen
                        </button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <label>
                            <span className="editor-label">Titel</span>
                            <input
                              className="editor-input"
                              value={step.title}
                              onChange={(e) => updateStep(step.localId, (current) => ({ ...current, title: e.target.value }))}
                            />
                          </label>
                          <label>
                            <span className="editor-label">Typ</span>
                            <select
                              className="editor-input"
                              value={step.type}
                              onChange={(e) =>
                                updateStep(step.localId, (current) => {
                                  const type = e.target.value as WorkflowStepType;
                                  return {
                                    ...current,
                                    type,
                                    config: normalizeStepConfig(type, {}),
                                    auto: type === 'JOIN' ? true : current.auto,
                                  };
                                })
                              }
                            >
                              {Object.entries(STEP_TYPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="checkbox-label mt-7">
                            <input
                              type="checkbox"
                              checked={step.type === 'JOIN' ? true : !!step.auto}
                              disabled={step.type === 'JOIN'}
                              onChange={(e) =>
                                updateStep(step.localId, (current) => ({
                                  ...current,
                                  auto: current.type === 'JOIN' ? true : e.target.checked,
                                }))
                              }
                            />
                            <span>{step.type === 'JOIN' ? 'Immer automatisch (Join)' : 'Automatisch ausführen'}</span>
                          </label>
                        </div>

                        {renderStepConfigEditor(step)}
                      </>
                    ) : (
                      <div className="workflow-step-collapsed-note">
                        Einstellungen sind eingeklappt. Im grafischen Editor den Knoten anklicken, um diesen Schritt zu bearbeiten.
                      </div>
                    )}
                  </div>
                </React.Fragment>
                );
              })}
              <div
                className={`workflow-step-separator ${dropIndex === editor.steps.length ? 'active' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropIndex(editor.steps.length);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedStepId) {
                    reorderStepToIndex(draggedStepId, editor.steps.length);
                  }
                  setDropIndex(null);
                }}
              >
                <span>{dropIndex === editor.steps.length ? 'Am Ende einfügen' : '⋯'}</span>
              </div>
            </div>

            <div className="workflow-add-panel mt-4">
              <div className="workflow-add-row">
                <select
                  className="editor-input workflow-add-type"
                  value={newStepType}
                  onChange={(e) => setNewStepType(e.target.value as WorkflowStepType)}
                >
                  {Object.entries(STEP_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    let insertedStepId: string | null = null;
                    setEditor((prev) => {
                      if (!prev) return prev;
                      const newStep = createStep(newStepType, getNextAutoNodeNumber(prev.steps));
                      insertedStepId = newStep.localId;
                      return { ...prev, steps: [...prev.steps, newStep] };
                    });
                    if (insertedStepId) {
                      setFocusedStepId(insertedStepId);
                    }
                  }}
                >
                  <i className="fa-solid fa-plus" /> Schritt hinzufügen
                </button>
              </div>
            </div>
                    </div>
                  )}
                </section>
              </div>

              <aside className="workflow-editor-side">
                <section className="workflow-editor-panel workflow-editor-panel-graph">
                  <button
                    type="button"
                    className="workflow-editor-panel-header"
                    onClick={() => toggleEditorPanel('graph')}
                    aria-expanded={editorPanels.graph}
                  >
                    <span><i className="fa-solid fa-diagram-project" /> Grafischer Workflow-Editor</span>
                    <i className={`fa-solid ${editorPanels.graph ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
                  </button>
                  {editorPanels.graph && (
                    <div className="workflow-editor-panel-body">
                      {workflowGraph ? (
                        <div className="workflow-graph-overview">
                          <div className="workflow-graph-topbar">
                            <h4>DTPN-Prozessgrafik</h4>
                            <div className="workflow-graph-topbar-actions">
                              <div className="workflow-graph-view-toggle" role="tablist" aria-label="Graphansicht">
                                <button
                                  type="button"
                                  role="tab"
                                  aria-selected={graphViewMode === 'standard'}
                                  className={`workflow-graph-view-btn ${graphViewMode === 'standard' ? 'active' : ''}`}
                                  onClick={() => setGraphViewMode('standard')}
                                >
                                  Standard
                                </button>
                                <button
                                  type="button"
                                  role="tab"
                                  aria-selected={graphViewMode === 'compact'}
                                  className={`workflow-graph-view-btn ${graphViewMode === 'compact' ? 'active' : ''}`}
                                  onClick={() => setGraphViewMode('compact')}
                                >
                                  Kompakt
                                </button>
                              </div>
                              <div className="workflow-graph-zoom">
                                <button type="button" className="btn btn-secondary" onClick={() => updateGraphZoom((value) => value - 0.1)}>
                                  <i className="fa-solid fa-magnifying-glass-minus" />
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={() => updateGraphZoom(1)}>
                                  {Math.round(graphZoom * 100)}%
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={() => updateGraphZoom((value) => value + 0.1)}>
                                  <i className="fa-solid fa-magnifying-glass-plus" />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => setGraphNodePositions({})}
                                  title="Knotenpositionen auf Standardlayout zurücksetzen"
                                >
                                  <i className="fa-solid fa-rotate-left" /> Layout
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={handlePrintGraphAsPdf}
                                  title="DTPN-Grafik als PDF herunterladen"
                                >
                                  <i className="fa-solid fa-file-pdf" /> PDF
                                </button>
                              </div>
                            </div>
                          </div>
                          <p className="setting-help dtpn-note">DTPN = Do Troe Process Notation</p>
                          {editor.steps.length === 0 && (
                            <p className="setting-help">
                              Leerer Workflow: Start ist bereits vorhanden. Füge den ersten Knoten über die
                              Schaltflächen unten hinzu.
                            </p>
                          )}
                          <div className="workflow-graph-stats">
                            <span>{editor.steps.length + 1} Knoten inkl. Start</span>
                            <span>{workflowGraph.edges.length} Verbindungen</span>
                            <span>{workflowGraph.autoCount} Auto</span>
                            <span>{editor.steps.length - workflowGraph.autoCount} Manuell</span>
                            <span>{workflowGraph.splitCount} Split</span>
                            <span>{workflowGraph.joinCount} Join</span>
                            <span>{workflowGraph.ifCount} IF</span>
                            <span>{workflowGraph.restCallCount} REST</span>
                            <span>{workflowGraph.endNodeCount} End-Knoten</span>
                            <span>{workflowGraph.explicitPathEnds} Teilworkflow-Ende</span>
                          </div>
                          <div className="workflow-graph-controls">
                            <select
                              className="editor-input workflow-graph-insert-select"
                              value={graphInsertType}
                              onChange={(e) => setGraphInsertType(e.target.value as WorkflowStepType)}
                            >
                              {Object.entries(STEP_TYPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn btn-secondary workflow-graph-insert-btn"
                              onClick={() => insertStepFromGraph(graphInsertType)}
                            >
                              <i className="fa-solid fa-plus" /> Knoten hinzufügen
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary workflow-graph-insert-btn"
                              disabled={!focusedStepId}
                              onClick={() => insertStepFromGraph(graphInsertType, { afterNodeId: focusedStepId })}
                            >
                              <i className="fa-solid fa-diagram-next" /> Nach Auswahl einfügen
                            </button>
                            {graphConnectionDraft && (
                              <button
                                type="button"
                                className="btn btn-secondary workflow-graph-insert-btn"
                                onClick={() => {
                                  setGraphConnectionDraft(null);
                                  setGraphCursorPoint(null);
                                  setGraphQuickInsertDraft(null);
                                }}
                              >
                                Verbindung abbrechen
                              </button>
                            )}
                          </div>
                          {graphConnectionDraft && (
                            <div className="workflow-graph-connect-hint">
                              Verbindung aktiv: Ausgang <strong>{graphConnectionDraft.sourcePort.toUpperCase()}</strong> gewählt.
                              Klicken Sie jetzt auf einen <strong>Eingang</strong> eines Zielknotens oder auf eine freie
                              Fläche, um dort einen neuen Knoten einzufügen.
                            </div>
                          )}
                          {graphQuickInsertDraft && (
                            <div
                              className="workflow-graph-quick-insert"
                              style={{
                                left: Math.max(16, Math.min(window.innerWidth - 300, graphQuickInsertDraft.clientX + 10)),
                                top: Math.max(16, Math.min(window.innerHeight - 180, graphQuickInsertDraft.clientY + 10)),
                              }}
                            >
                              <div className="workflow-graph-quick-insert-title">
                                Neuer Knoten an Verbindung
                              </div>
                              <select
                                className="editor-input"
                                value={graphQuickInsertDraft.nodeType}
                                onChange={(event) =>
                                  setGraphQuickInsertDraft((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          nodeType: event.target.value as WorkflowStepType,
                                        }
                                      : prev
                                  )
                                }
                              >
                                {Object.entries(STEP_TYPE_LABELS).map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                              <div className="workflow-graph-quick-insert-actions">
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={applyQuickInsertForConnection}
                                >
                                  <i className="fa-solid fa-plus" /> Hinzufügen und verbinden
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => setGraphQuickInsertDraft(null)}
                                >
                                  Abbrechen
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="workflow-graph-canvas-wrap" ref={graphCanvasWrapRef}>
                            <svg
                              ref={graphSvgRef}
                              className={`workflow-graph-canvas ${
                                splitTargetPick || nextTargetPick || graphConnectionDraft ? 'targeting' : ''
                              } ${graphDragging ? 'dragging-node' : ''}`}
                              width={graphRenderSize?.width || workflowGraph.width}
                              height={graphRenderSize?.height || workflowGraph.height}
                              viewBox={`0 0 ${workflowGraph.width} ${workflowGraph.height}`}
                              role="img"
                              aria-label="Grafische Darstellung der Workflow-Pfade"
                              onMouseMove={(event) => {
                                if (!graphConnectionDraft) return;
                                const point = projectClientPointToGraph(event.clientX, event.clientY);
                                if (!point) return;
                                setGraphCursorPoint(point);
                              }}
                              onMouseLeave={() => {
                                if (graphConnectionDraft) setGraphCursorPoint(null);
                              }}
                              onClick={(event) => {
                                if (!graphConnectionDraft) return;
                                const graphPoint = projectClientPointToGraph(event.clientX, event.clientY);
                                if (!graphPoint) return;
                                setGraphCursorPoint(graphPoint);
                                openQuickInsertForConnection(graphPoint, {
                                  x: event.clientX,
                                  y: event.clientY,
                                });
                              }}
                            >
                              <defs>
                                <pattern id="workflowGraphGridPattern" width="32" height="32" patternUnits="userSpaceOnUse">
                                  <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e2e8f0" strokeWidth="1" />
                                </pattern>
                                <marker
                                  id="workflowGraphArrow"
                                  markerWidth="10"
                                  markerHeight="8"
                                  refX="9"
                                  refY="4"
                                  orient="auto"
                                  markerUnits="strokeWidth"
                                >
                                  <path d="M0,0 L10,4 L0,8 z" fill="#475569" />
                                </marker>
                              </defs>
                              <rect
                                x={0}
                                y={0}
                                width={workflowGraph.width}
                                height={workflowGraph.height}
                                className="workflow-graph-grid-bg"
                              />
                              <rect
                                x={0}
                                y={0}
                                width={workflowGraph.width}
                                height={workflowGraph.height}
                                fill="url(#workflowGraphGridPattern)"
                                className="workflow-graph-grid-pattern"
                              />
                              {workflowGraph.edges.map((edge) => {
                                const source = workflowGraph.nodeById.get(edge.from);
                                const target = workflowGraph.nodeById.get(edge.to);
                                if (!source || !target) return null;
                                const anchors = resolveEdgeAnchorPoints(edge, source, target, workflowGraph);
                                if (!anchors) return null;
                                const connector = buildGraphConnectorPath(anchors.start, anchors.end);
                                const stroke =
                                  edge.kind === 'if_true'
                                    ? '#0284c7'
                                    : edge.kind === 'if_false'
                                    ? '#c2410c'
                                    : edge.kind === 'confirm_reject'
                                    ? '#dc2626'
                                    : edge.kind === 'split'
                                    ? '#7c3aed'
                                    : '#64748b';
                                const labelX = connector.labelX;
                                const labelY = connector.labelY;
                                const removable = edge.explicit && edge.from !== '__start__';

                                return (
                                  <g key={edge.id}>
                                    <path
                                      d={connector.d}
                                      fill="none"
                                      stroke={stroke}
                                      strokeWidth={edge.explicit ? 2.3 : 1.9}
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeDasharray={
                                        edge.kind === 'confirm_reject'
                                          ? '4 3'
                                          : edge.explicit
                                          ? undefined
                                          : '6 4'
                                      }
                                      markerEnd="url(#workflowGraphArrow)"
                                      opacity={edge.kind === 'confirm_reject' ? 0.95 : edge.explicit ? 0.96 : 0.8}
                                    />
                                    {edge.label && (
                                      <text
                                        x={labelX}
                                        y={labelY}
                                        textAnchor="middle"
                                        className="workflow-graph-edge-label"
                                      >
                                        {edge.label}
                                      </text>
                                    )}
                                    {removable && (
                                      <g
                                        className="workflow-graph-edge-remove"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          disconnectGraphEdge(edge);
                                        }}
                                      >
                                        <circle cx={labelX + 16} cy={labelY - 8} r={8} />
                                        <text x={labelX + 16} y={labelY - 5} textAnchor="middle">
                                          ×
                                        </text>
                                      </g>
                                    )}
                                  </g>
                                );
                              })}
                              {graphConnectionDraft && graphCursorPoint && (() => {
                                const sourceNode = workflowGraph.nodeById.get(graphConnectionDraft.sourceNodeId);
                                if (!sourceNode) return null;
                                const sourcePoint = resolveGraphOutputPortPosition(
                                  sourceNode,
                                  graphConnectionDraft.sourcePort,
                                  workflowGraph
                                );
                                if (!sourcePoint) return null;
                                const connector = buildGraphConnectorPath(sourcePoint, graphCursorPoint);
                                return (
                                  <path
                                    d={connector.d}
                                    className="workflow-graph-draft-edge"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    markerEnd="url(#workflowGraphArrow)"
                                  />
                                );
                              })()}
                              {workflowGraph.nodes.map((node) => {
                                const isFocused = focusedStepId === node.id;
                                const typeLabel = node.type === 'START' ? 'Start-Ereignis' : STEP_TYPE_LABELS[node.type];
                                const titleText =
                                  node.type === 'START'
                                    ? 'Start'
                                    : `${node.index + 1}. ${node.title.length > 34 ? `${node.title.slice(0, 34)}…` : node.title}`;
                                const inputPort = resolveGraphInputPortPosition(node, workflowGraph);
                                const outputPorts = getOutputPortsForNode(node.type);
                                const canUseAsTarget =
                                  !!graphConnectionDraft &&
                                  node.id !== '__start__' &&
                                  node.id !== graphConnectionDraft.sourceNodeId;
                                return (
                                  <g key={node.id}>
                                    <g
                                      className={`workflow-graph-node ${isFocused ? 'focused' : ''} ${node.shape === 'circle' ? 'circle' : ''} ${node.shape === 'diamond' ? 'diamond' : ''} ${node.type === 'START' ? 'start' : ''}`}
                                      onMouseDown={(event) => startGraphNodeDrag(event, node)}
                                      onClick={() => {
                                        if (graphSuppressClickRef.current) {
                                          graphSuppressClickRef.current = false;
                                          return;
                                        }
                                        handleGraphNodeClick(node.id);
                                      }}
                                    >
                                      {node.shape === 'circle' ? (
                                        <>
                                          <circle
                                            cx={node.x}
                                            cy={node.y}
                                            r={node.radius || workflowGraph.endRadius}
                                          />
                                          <text x={node.x} y={node.y - 2} textAnchor="middle" className="workflow-graph-node-title centered">
                                            {node.type === 'START' ? 'Start' : 'Ende'}
                                          </text>
                                          {node.type !== 'START' && (
                                            <text x={node.x} y={node.y + 14} textAnchor="middle" className="workflow-graph-node-meta centered">
                                              {node.meta || ''}
                                            </text>
                                          )}
                                        </>
                                      ) : node.shape === 'diamond' ? (
                                        <>
                                          <polygon
                                            points={`${node.x},${node.y - workflowGraph.joinSize / 2} ${node.x + workflowGraph.joinSize / 2},${node.y} ${node.x},${node.y + workflowGraph.joinSize / 2} ${node.x - workflowGraph.joinSize / 2},${node.y}`}
                                          />
                                          <text x={node.x} y={node.y - 4} textAnchor="middle" className="workflow-graph-node-title centered">
                                            {node.type === 'IF' ? 'IF' : node.type === 'SPLIT' ? 'Split' : 'Join'}
                                          </text>
                                          {node.meta && (
                                            <text x={node.x} y={node.y + 12} textAnchor="middle" className="workflow-graph-node-meta centered">
                                              {node.meta.length > 28 ? `${node.meta.slice(0, 28)}…` : node.meta}
                                            </text>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          <rect
                                            x={node.x - workflowGraph.nodeWidth / 2}
                                            y={node.y - workflowGraph.nodeHeight / 2}
                                            width={workflowGraph.nodeWidth}
                                            height={workflowGraph.nodeHeight}
                                            rx={12}
                                            ry={12}
                                          />
                                          <text
                                            x={node.x - workflowGraph.nodeWidth / 2 + 14}
                                            y={node.y - 16}
                                            className="workflow-graph-node-title"
                                          >
                                            {titleText}
                                          </text>
                                          <text
                                            x={node.x - workflowGraph.nodeWidth / 2 + 14}
                                            y={node.y + 4}
                                            className="workflow-graph-node-type"
                                          >
                                            {`${typeLabel}${node.isAuto ? ' · AUTO' : ' · MANUELL'}`}
                                          </text>
                                          {node.meta && (
                                            <text
                                              x={node.x - workflowGraph.nodeWidth / 2 + 14}
                                              y={node.y + 24}
                                              className="workflow-graph-node-meta"
                                            >
                                              {node.meta.length > 52 ? `${node.meta.slice(0, 52)}…` : node.meta}
                                            </text>
                                          )}
                                        </>
                                      )}
                                    </g>

                                    {inputPort && (
                                      <g
                                        className={`workflow-graph-port input ${canUseAsTarget ? 'targetable' : ''}`}
                                        onMouseDown={(event) => {
                                          event.stopPropagation();
                                        }}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          if (canUseAsTarget) {
                                            completeGraphConnection(node.id);
                                          } else {
                                            handleGraphNodeClick(node.id);
                                          }
                                        }}
                                      >
                                        <circle cx={inputPort.x} cy={inputPort.y} r={5.2} />
                                      </g>
                                    )}

                                    {outputPorts.map((port) => {
                                      const position = resolveGraphOutputPortPosition(node, port.key, workflowGraph);
                                      if (!position) return null;
                                      const isActiveSource =
                                        graphConnectionDraft?.sourceNodeId === node.id &&
                                        graphConnectionDraft.sourcePort === port.key;
                                      return (
                                        <g
                                          key={`${node.id}-out-${port.key}`}
                                          className={`workflow-graph-port output ${isActiveSource ? 'active' : ''}`}
                                          onMouseDown={(event) => {
                                            event.stopPropagation();
                                          }}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            beginGraphConnection(node.id, port.key);
                                          }}
                                        >
                                          <circle cx={position.x} cy={position.y} r={5.2} />
                                          <text x={position.x} y={position.y + 15} textAnchor="middle">
                                            {port.label}
                                          </text>
                                        </g>
                                      );
                                    })}
                                  </g>
                                );
                              })}
                            </svg>
                          </div>
                          <div className="workflow-graph-legend">
                            <span><strong>Kreis:</strong> Start/Ende</span>
                            <span><strong>Raute:</strong> Join / Split / IF</span>
                            <span><strong>Violett:</strong> Split-Kanten</span>
                            <span><strong>Blau:</strong> IF TRUE</span>
                            <span><strong>Orange:</strong> IF FALSE</span>
                            <span><strong>REST:</strong> API-Aufrufknoten</span>
                            <span><strong>Gestrichelt:</strong> Auto-Verbindung</span>
                            <span><strong>Punkte:</strong> Ein-/Ausgänge</span>
                          </div>
                          {workflowDiagnostics.length > 0 && (
                            <div className="workflow-diagnostics">
                              <div className="workflow-diagnostics-title">Validierung</div>
                              <ul>
                                {workflowDiagnostics.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <p className="setting-help">
                            Knoten können per Maus gezogen werden. Für Zoom <strong>Strg/Cmd + Mausrad</strong> oder die
                            Zoom-Buttons verwenden. Klicken im Graph öffnet unten die Schritt-Einstellungen des Knotens.
                          </p>
                        </div>
                      ) : (
                        <div className="workflow-graph-overview">
                          <p className="setting-help">Keine Schritte vorhanden. Füge den ersten Schritt hinzu.</p>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </aside>
            </div>
          </div>

          <div className="editor-actions">
            <button className="editor-cancel-btn" type="button" onClick={closeEditor}>
              Abbrechen
            </button>
            <button className="btn btn-primary" type="button" onClick={handleSaveTemplate} disabled={saving}>
              {saving ? 'Speichere…' : 'Speichern'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowSettings;
