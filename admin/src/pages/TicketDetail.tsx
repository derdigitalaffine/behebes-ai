import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './TicketDetail.css';
import { subscribeAdminRealtime } from '../lib/realtime';
import { exportSingleTicketPdf } from '../lib/ticketPdfExport';
import {
  buildAssignmentUserLabel,
  loadAssignmentDirectory as fetchAssignmentDirectory,
  userCanBeAssignedToTenant,
  type AssignmentAdminUserOption as AdminUserOption,
  type AssignmentOrgUnitOption as OrgUnitOption,
  type AssignmentTenantOption as TenantOption,
} from '../lib/assignmentDirectory';

interface TicketDetailProps {
  token: string;
}

interface Ticket {
  id: string;
  submissionId: string;
  citizenId: string;
  citizenName?: string;
  citizenEmail?: string;
  citizenPreferredLanguage?: string;
  citizenPreferredLanguageName?: string;
  reporterPseudoName?: string;
  reporterPseudoFirstName?: string;
  reporterPseudoLastName?: string;
  reporterPseudoEmail?: string;
  reporterPseudoScopeKey?: string;
  category: string;
  responsibilityAuthority?: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending_validation' | 'open' | 'assigned' | 'in-progress' | 'completed' | 'closed' | 'pending';
  description?: string;
  anonymizedText?: string;
  originalDescription?: string;
  translatedDescriptionDe?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  nominatimRaw?: Record<string, any> | null;
  nominatimRawJson?: string | null;
  weatherReport?: Record<string, any> | null;
  weatherReportJson?: string | null;
  assignedTo?: string;
  tenantId?: string | null;
  tenantName?: string | null;
  owningOrgUnitId?: string | null;
  owningOrgUnitName?: string | null;
  primaryAssigneeUserId?: string | null;
  primaryAssigneeUserName?: string | null;
  primaryAssigneeOrgUnitId?: string | null;
  primaryAssigneeOrgUnitName?: string | null;
  collaborators?: TicketCollaborator[];
  redmineIssueId?: number;
  workflowId?: string;
  images?: TicketImage[];
  emailMessages?: TicketEmailMessage[];
  comments?: TicketComment[];
  dataRequests?: TicketDataRequest[];
  createdAt: string;
  updatedAt: string;
}

type TicketCommentVisibility = 'internal' | 'public';
type TicketCommentAuthorType = 'staff' | 'ai' | 'system' | 'citizen';
type TicketCommentType =
  | 'note'
  | 'decision'
  | 'classification'
  | 'timeout'
  | 'data_request'
  | 'data_response'
  | 'situation_label'
  | 'email_reply';

interface TicketComment {
  id: string;
  ticketId: string;
  executionId?: string | null;
  taskId?: string | null;
  authorType: TicketCommentAuthorType;
  authorId?: string | null;
  authorName?: string | null;
  visibility: TicketCommentVisibility;
  commentType: TicketCommentType | string;
  content: string;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

interface TicketDataRequestField {
  key: string;
  label: string;
  type: 'yes_no' | 'single_choice' | 'number' | 'quantity' | 'short_text' | string;
  required?: boolean;
  options?: Array<{
    value: string;
    label: string;
  }>;
}

interface TicketDataRequest {
  id: string;
  executionId?: string | null;
  taskId?: string | null;
  status: string;
  mode: 'parallel' | 'blocking';
  createdAt?: string | null;
  answeredAt?: string | null;
  expiresAt?: string | null;
  cycle?: number | null;
  maxCycles?: number | null;
  fields: TicketDataRequestField[];
  answers: Record<string, any>;
}

type InternalTaskFormFieldType = 'text' | 'textarea' | 'boolean' | 'select' | 'date' | 'number' | string;
type InternalTaskStatus = 'pending' | 'in_progress' | 'completed' | 'rejected' | 'cancelled' | string;

interface InternalTaskFormFieldOption {
  value: string;
  label?: string;
}

interface InternalTaskFormField {
  key: string;
  label: string;
  type: InternalTaskFormFieldType;
  required: boolean;
  helpText?: string;
  placeholder?: string;
  options?: InternalTaskFormFieldOption[];
}

interface TicketInternalTask {
  id: string;
  ticketId: string;
  workflowExecutionId?: string | null;
  stepId?: string | null;
  title?: string;
  description?: string;
  status: InternalTaskStatus;
  mode?: string;
  formSchema?: Record<string, any> | null;
  response?: Record<string, any> | null;
  completedAt?: string | null;
  completedBy?: string | null;
  dueAt?: string | null;
  createdAt?: string | null;
  cycleIndex?: number;
  maxCycles?: number;
}

interface TicketCollaborator {
  id: string;
  userId?: string | null;
  orgUnitId?: string | null;
  userName?: string | null;
  orgUnitName?: string | null;
  createdAt?: string | null;
}

interface TicketImage {
  id: string;
  fileName: string;
  dataUrl: string;
  mimeType?: string;
  byteSize?: number;
  createdAt?: string;
  exif?: TicketImageExif | null;
  analysis?: TicketImageAnalysis | null;
}

interface TicketImageExif {
  hasExif: boolean;
  hasGps: boolean;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  orientation: number | null;
}

interface TicketImageAnalysis {
  status: 'idle' | 'processing' | 'done' | 'failed' | string;
  description: string | null;
  confidence: number | null;
  model: string | null;
  error: string | null;
  updatedAt: string | null;
}

interface TicketEmailAttachment {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  contentDisposition?: string;
  contentId?: string | null;
  createdAt?: string | null;
  downloadUrl?: string;
}

interface TicketEmailMessage {
  id: string;
  mailboxUid: number;
  mailboxName: string;
  subject: string;
  fromName?: string | null;
  fromEmail?: string | null;
  toEmails?: string | null;
  ccEmails?: string | null;
  receivedAt?: string | null;
  ticketId?: string | null;
  matchReason?: string | null;
  preview?: string;
  textBody?: string;
  htmlBody?: string;
  attachments: TicketEmailAttachment[];
}

interface ExifMapTarget {
  latitude: number;
  longitude: number;
  label: string;
}

interface VisionModelOption {
  id: string;
  label: string;
}

interface ImageAnalyzeDialogState {
  imageId: string;
  force: boolean;
  includeDescription: boolean;
  includeOsmData: boolean;
  includeWeatherData: boolean;
  modelId: string;
}

interface AILog {
  id: string;
  aiDecision: string;
  aiReasoning?: string;
  adminFeedback?: string;
  feedbackIsCorrect?: boolean;
  originalCategory?: string;
  correctedCategory?: string;
  createdAt: string;
}

interface WorkflowTask {
  id: string;
  title: string;
  description: string;
  type:
    | 'REDMINE_TICKET'
    | 'EMAIL'
    | 'EMAIL_EXTERNAL'
    | 'EMAIL_CONFIRMATION'
    | 'MAYOR_INVOLVEMENT'
    | 'CATEGORIZATION'
    | 'EMAIL_DOUBLE_OPT_IN'
    | 'CITIZEN_NOTIFICATION'
    | 'REST_API_CALL'
    | 'INTERNAL_PROCESSING'
    | 'DATENNACHFORDERUNG'
    | 'ENHANCED_CATEGORIZATION'
    | 'FREE_AI_DATA_REQUEST'
    | 'IMAGE_TO_TEXT_ANALYSIS'
    | 'END'
    | 'JOIN'
    | 'SPLIT'
    | 'IF'
    | 'CUSTOM'
    | 'WAIT_STATUS_CHANGE'
    | 'CHANGE_WORKFLOW'
    | 'SUB_WORKFLOW'
    | 'RESPONSIBILITY_CHECK';
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  config: Record<string, any>;
  executionData?: Record<string, any>;
  order: number;
  auto?: boolean;
}

interface WorkflowExecution {
  id: string;
  templateId?: string;
  title: string;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  blockedReason?:
    | 'none'
    | 'waiting_external'
    | 'waiting_manual'
    | 'waiting_timer'
    | 'deadlock_or_orphan_path'
    | 'loop_guard'
    | 'error';
  health?: {
    slaState: 'ok' | 'risk' | 'overdue';
    transitionCount: number;
    loopGuardTrips: number;
    visitsByTask: Record<string, number>;
    slaTargetMinutes: number;
    slaRiskThresholdPercent: number;
  };
  executionMode: 'MANUAL' | 'AUTO' | 'HYBRID';
  tasks: WorkflowTask[];
  currentTaskIndex: number;
  activeTaskIds?: string[];
  startedAt: string;
  completedAt?: string;
  history?: Array<{
    at?: string;
    timestamp?: string;
    type?: string;
    message?: string;
    metadata?: Record<string, any> | null;
  }>;
}

interface WorkflowTemplateOption {
  id: string;
  name: string;
  enabled?: boolean;
}

type TicketWorkflowEdgeKind = 'default' | 'split' | 'if_true' | 'if_false' | 'confirm_reject';
type TicketWorkflowNodeShape = 'rect' | 'circle' | 'diamond';

interface TicketWorkflowGraphNode {
  id: string;
  taskId?: string;
  title: string;
  type: WorkflowTask['type'] | 'START';
  status?: WorkflowTask['status'];
  shape: TicketWorkflowNodeShape;
  x: number;
  y: number;
  lane: number;
}

interface TicketWorkflowGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: TicketWorkflowEdgeKind;
  label?: string;
}

const resolveTaskIconClass = (type: WorkflowTask['type']) => {
  if (type === 'REDMINE_TICKET') return 'fa-solid fa-thumbtack';
  if (type === 'EMAIL' || type === 'EMAIL_EXTERNAL') return 'fa-solid fa-envelope';
  if (type === 'EMAIL_CONFIRMATION') return 'fa-solid fa-circle-check';
  if (type === 'MAYOR_INVOLVEMENT') return 'fa-solid fa-user-tie';
  if (type === 'CATEGORIZATION') return 'fa-solid fa-tags';
  if (type === 'EMAIL_DOUBLE_OPT_IN') return 'fa-solid fa-user-check';
  if (type === 'CITIZEN_NOTIFICATION') return 'fa-solid fa-bell';
  if (type === 'REST_API_CALL') return 'fa-solid fa-globe';
  if (type === 'INTERNAL_PROCESSING') return 'fa-solid fa-user-gear';
  if (type === 'DATENNACHFORDERUNG') return 'fa-solid fa-file-circle-question';
  if (type === 'ENHANCED_CATEGORIZATION') return 'fa-solid fa-wand-magic-sparkles';
  if (type === 'FREE_AI_DATA_REQUEST') return 'fa-solid fa-brain';
  if (type === 'IMAGE_TO_TEXT_ANALYSIS') return 'fa-solid fa-image';
  if (type === 'END') return 'fa-solid fa-circle-stop';
  if (type === 'JOIN') return 'fa-solid fa-code-branch';
  if (type === 'WAIT_STATUS_CHANGE') return 'fa-solid fa-hourglass-half';
  if (type === 'CHANGE_WORKFLOW') return 'fa-solid fa-arrows-rotate';
  if (type === 'SUB_WORKFLOW') return 'fa-solid fa-diagram-project';
  if (type === 'RESPONSIBILITY_CHECK') return 'fa-solid fa-scale-balanced';
  if (type === 'SPLIT') return 'fa-solid fa-shuffle';
  if (type === 'IF') return 'fa-solid fa-circle-question';
  return 'fa-solid fa-gear';
};

const resolveTaskStatusIconClass = (status: WorkflowTask['status']) => {
  if (status === 'PENDING') return 'fa-solid fa-hourglass-half';
  if (status === 'RUNNING') return 'fa-solid fa-spinner fa-spin';
  if (status === 'COMPLETED') return 'fa-solid fa-check';
  if (status === 'FAILED') return 'fa-solid fa-xmark';
  if (status === 'SKIPPED') return 'fa-solid fa-ban';
  return 'fa-solid fa-circle';
};

const normalizeTaskRef = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeTaskRefList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  value.forEach((entry) => {
    const id = normalizeTaskRef(entry);
    if (!id) return;
    unique.add(id);
  });
  return Array.from(unique);
};

const parseTaskAwaitingUntilMs = (task: WorkflowTask | null | undefined): number | null => {
  if (!task) return null;
  const raw = task.executionData?.awaitingUntil;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const WORKFLOW_BLOCKED_REASON_LABELS: Record<string, string> = {
  none: 'Kein Blocker',
  waiting_external: 'Wartet auf externes System',
  waiting_manual: 'Wartet auf manuelle Freigabe',
  waiting_timer: 'Wartet auf Timer',
  deadlock_or_orphan_path: 'Deadlock / verwaister Pfad',
  loop_guard: 'Loop-Guard ausgelöst',
  error: 'Fehlerzustand',
};

const WORKFLOW_SLA_LABELS: Record<'ok' | 'risk' | 'overdue', string> = {
  ok: 'im Ziel',
  risk: 'gefährdet',
  overdue: 'überfällig',
};

const formatDurationClock = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatTimerCountdown = (targetMs: number, nowMs: number): string => {
  const diff = targetMs - nowMs;
  if (diff >= 0) {
    return formatDurationClock(diff);
  }
  return `+${formatDurationClock(Math.abs(diff))} überfällig`;
};

const COMMENT_TYPE_LABELS: Record<TicketCommentType, string> = {
  note: 'Notiz',
  decision: 'Entscheidung',
  classification: 'Klassifizierung',
  timeout: 'Timeout',
  data_request: 'Datennachforderung',
  data_response: 'Antwort',
  situation_label: 'Lagebild-Label',
  email_reply: 'E-Mail-Antwort',
};

const COMMENT_AUTHOR_LABELS: Record<TicketCommentAuthorType, string> = {
  staff: 'Bearbeitung',
  ai: 'KI',
  system: 'System',
  citizen: 'Bürger',
};

const COMMENT_VISIBILITY_LABELS: Record<TicketCommentVisibility, string> = {
  internal: 'Intern',
  public: 'Öffentlich',
};

const DEFAULT_CATEGORIES = ['Schlaglöcher', 'Abfall', 'Wasser', 'Grün', 'Verkehr', 'Sonstiges'];
const DEFAULT_RESPONSIBILITY_AUTHORITIES = [
  'Ortsgemeinde',
  'Verbandsgemeinde / verbandsfreie Gemeinde',
  'Landkreis / kreisfreie Stadt',
  'Landesbehoerde',
];

const normalizeOptionList = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  input.forEach((entry) => {
    const value = String(entry || '').trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(value);
  });
  return result;
};

const mergeOptionLists = (...lists: Array<unknown>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  lists.forEach((list) => {
    normalizeOptionList(list).forEach((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(entry);
    });
  });
  return result;
};

const parseAssignmentTarget = (value: string): { userId: string; orgUnitId: string; assignedTo: string } => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { userId: '', orgUnitId: '', assignedTo: '' };
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('user:')) {
    return { userId: trimmed.slice(5).trim(), orgUnitId: '', assignedTo: '' };
  }
  if (lower.startsWith('org:')) {
    return { userId: '', orgUnitId: trimmed.slice(4).trim(), assignedTo: '' };
  }
  if (lower.startsWith('legacy:')) {
    return { userId: '', orgUnitId: '', assignedTo: trimmed.slice(7).trim() };
  }
  return { userId: '', orgUnitId: '', assignedTo: trimmed };
};

const normalizeTicketComments = (input: unknown): TicketComment[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const source = entry as Record<string, any>;
      const id = typeof source.id === 'string' ? source.id.trim() : '';
      const ticketId = typeof source.ticketId === 'string' ? source.ticketId.trim() : '';
      const content = typeof source.content === 'string' ? source.content : '';
      const createdAt = typeof source.createdAt === 'string' ? source.createdAt : '';
      if (!id || !ticketId || !content || !createdAt) return null;
      const visibility: TicketCommentVisibility =
        source.visibility === 'public' ? 'public' : 'internal';
      const authorType: TicketCommentAuthorType =
        source.authorType === 'ai' ||
        source.authorType === 'system' ||
        source.authorType === 'citizen'
          ? source.authorType
          : 'staff';
      const metadata =
        source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
          ? (source.metadata as Record<string, any>)
          : null;
      return {
        id,
        ticketId,
        executionId: typeof source.executionId === 'string' ? source.executionId : null,
        taskId: typeof source.taskId === 'string' ? source.taskId : null,
        authorType,
        authorId: typeof source.authorId === 'string' ? source.authorId : null,
        authorName: typeof source.authorName === 'string' ? source.authorName : null,
        visibility,
        commentType:
          typeof source.commentType === 'string' && source.commentType.trim()
            ? source.commentType.trim().toLowerCase()
            : 'note',
        content,
        metadata,
        createdAt,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : createdAt,
      };
    })
    .filter((entry): entry is TicketComment => entry !== null)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
};

const normalizeTicketDataRequests = (input: unknown): TicketDataRequest[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const source = entry as Record<string, any>;
      const id = typeof source.id === 'string' ? source.id.trim() : '';
      if (!id) return null;

      const fieldsRaw = Array.isArray(source.fields) ? source.fields : [];
      const fields = fieldsRaw
        .map((field) => {
          if (!field || typeof field !== 'object') return null;
          const fieldSource = field as Record<string, any>;
          const key = typeof fieldSource.key === 'string' ? fieldSource.key.trim() : '';
          if (!key) return null;
          return {
            key,
            label:
              typeof fieldSource.label === 'string' && fieldSource.label.trim()
                ? fieldSource.label.trim()
                : key,
            type:
              typeof fieldSource.type === 'string' && fieldSource.type.trim()
                ? fieldSource.type.trim()
                : 'short_text',
            required: fieldSource.required === true,
            options: Array.isArray(fieldSource.options)
              ? fieldSource.options
                  .map((option) => {
                    if (!option) return null;
                    if (typeof option === 'string' && option.trim()) {
                      return { value: option.trim(), label: option.trim() };
                    }
                    const sourceOption = option as Record<string, any>;
                    const value =
                      typeof sourceOption.value === 'string' && sourceOption.value.trim()
                        ? sourceOption.value.trim()
                        : '';
                    if (!value) return null;
                    return {
                      value,
                      label:
                        typeof sourceOption.label === 'string' && sourceOption.label.trim()
                          ? sourceOption.label.trim()
                          : value,
                    };
                  })
                  .filter((option): option is { value: string; label: string } => option !== null)
              : [],
          } as TicketDataRequestField;
        })
        .filter((field): field is TicketDataRequestField => field !== null);

      const answers =
        source.answers && typeof source.answers === 'object' && !Array.isArray(source.answers)
          ? (source.answers as Record<string, any>)
          : {};

      return {
        id,
        executionId: typeof source.executionId === 'string' ? source.executionId : null,
        taskId: typeof source.taskId === 'string' ? source.taskId : null,
        status: typeof source.status === 'string' && source.status.trim() ? source.status.trim() : 'pending',
        mode: source.mode === 'parallel' ? 'parallel' : 'blocking',
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : null,
        answeredAt: typeof source.answeredAt === 'string' ? source.answeredAt : null,
        expiresAt: typeof source.expiresAt === 'string' ? source.expiresAt : null,
        cycle: Number.isFinite(Number(source.cycle)) ? Math.max(1, Math.floor(Number(source.cycle))) : null,
        maxCycles: Number.isFinite(Number(source.maxCycles))
          ? Math.max(1, Math.floor(Number(source.maxCycles)))
          : null,
        fields,
        answers,
      } as TicketDataRequest;
    })
    .filter((entry): entry is TicketDataRequest => entry !== null);
};

const normalizeTicketCollaborators = (input: unknown): TicketCollaborator[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const source = entry as Record<string, any>;
      const id = typeof source.id === 'string' ? source.id.trim() : '';
      if (!id) return null;
      return {
        id,
        userId: typeof source.userId === 'string' ? source.userId : null,
        orgUnitId: typeof source.orgUnitId === 'string' ? source.orgUnitId : null,
        userName: typeof source.userName === 'string' ? source.userName : null,
        orgUnitName: typeof source.orgUnitName === 'string' ? source.orgUnitName : null,
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : null,
      } as TicketCollaborator;
    })
    .filter((entry): entry is TicketCollaborator => entry !== null);
};

const normalizeTicketEmailMessages = (input: unknown): TicketEmailMessage[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const source = entry as Record<string, any>;
      const id = typeof source.id === 'string' ? source.id.trim() : '';
      if (!id) return null;
      const attachmentSource = Array.isArray(source.attachments) ? source.attachments : [];
      const attachments = attachmentSource
        .map((attachment) => {
          if (!attachment || typeof attachment !== 'object') return null;
          const data = attachment as Record<string, any>;
          const attachmentId = typeof data.id === 'string' ? data.id.trim() : '';
          if (!attachmentId) return null;
          return {
            id: attachmentId,
            messageId: typeof data.messageId === 'string' ? data.messageId : id,
            fileName: typeof data.fileName === 'string' && data.fileName.trim() ? data.fileName.trim() : 'attachment.bin',
            mimeType:
              typeof data.mimeType === 'string' && data.mimeType.trim()
                ? data.mimeType.trim()
                : 'application/octet-stream',
            byteSize: Number.isFinite(Number(data.byteSize)) ? Math.max(0, Math.floor(Number(data.byteSize))) : 0,
            contentDisposition: typeof data.contentDisposition === 'string' ? data.contentDisposition : 'attachment',
            contentId: typeof data.contentId === 'string' ? data.contentId : null,
            createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
            downloadUrl: typeof data.downloadUrl === 'string' ? data.downloadUrl : undefined,
          } as TicketEmailAttachment;
        })
        .filter((attachment): attachment is TicketEmailAttachment => attachment !== null);
      return {
        id,
        mailboxUid: Number.isFinite(Number(source.mailboxUid)) ? Number(source.mailboxUid) : 0,
        mailboxName: typeof source.mailboxName === 'string' ? source.mailboxName : 'INBOX',
        subject: typeof source.subject === 'string' ? source.subject : '',
        fromName: typeof source.fromName === 'string' ? source.fromName : null,
        fromEmail: typeof source.fromEmail === 'string' ? source.fromEmail : null,
        toEmails: typeof source.toEmails === 'string' ? source.toEmails : null,
        ccEmails: typeof source.ccEmails === 'string' ? source.ccEmails : null,
        receivedAt: typeof source.receivedAt === 'string' ? source.receivedAt : null,
        ticketId: typeof source.ticketId === 'string' ? source.ticketId : null,
        matchReason: typeof source.matchReason === 'string' ? source.matchReason : null,
        preview: typeof source.preview === 'string' ? source.preview : '',
        textBody: typeof source.textBody === 'string' ? source.textBody : '',
        htmlBody: typeof source.htmlBody === 'string' ? source.htmlBody : '',
        attachments,
      } as TicketEmailMessage;
    })
    .filter((entry): entry is TicketEmailMessage => entry !== null);
};

const hasDataRequestAnswerValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return String(value).trim().length > 0;
};

const formatDataRequestAnswerValue = (value: unknown, field?: TicketDataRequestField): string => {
  if (field?.type === 'single_choice' && typeof value === 'string' && Array.isArray(field.options)) {
    const selectedOption = field.options.find((option) => option.value === value);
    if (selectedOption?.label) return selectedOption.label;
  }
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '–';
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized === 'true') return 'Ja';
    if (normalized === 'false') return 'Nein';
    return normalized || '–';
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((entry) => formatDataRequestAnswerValue(entry)).join(', ') : '–';
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return '–';
};

const normalizeInternalTaskFormFields = (schema: any): InternalTaskFormField[] => {
  const source = Array.isArray(schema?.fields) ? schema.fields : [];
  return source
    .map((entry: any) => {
      const key = typeof entry?.key === 'string' ? entry.key.trim() : '';
      if (!key) return null;
      const typeRaw = typeof entry?.type === 'string' ? entry.type.trim().toLowerCase() : 'text';
      const type: InternalTaskFormFieldType =
        typeRaw === 'textarea' ||
        typeRaw === 'boolean' ||
        typeRaw === 'select' ||
        typeRaw === 'date' ||
        typeRaw === 'number'
          ? typeRaw
          : 'text';
      const options = Array.isArray(entry?.options)
        ? entry.options
            .map((option: any) => {
              const value = typeof option?.value === 'string' ? option.value.trim() : '';
              if (!value) return null;
              const label = typeof option?.label === 'string' ? option.label.trim() : '';
              return {
                value,
                label: label || value,
              } as InternalTaskFormFieldOption;
            })
            .filter((option: InternalTaskFormFieldOption | null): option is InternalTaskFormFieldOption => option !== null)
        : undefined;
      return {
        key,
        label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : key,
        type,
        required: !!entry?.required,
        helpText: typeof entry?.helpText === 'string' && entry.helpText.trim() ? entry.helpText.trim() : undefined,
        placeholder:
          typeof entry?.placeholder === 'string' && entry.placeholder.trim() ? entry.placeholder.trim() : undefined,
        options,
      } as InternalTaskFormField;
    })
    .filter((field: InternalTaskFormField | null): field is InternalTaskFormField => field !== null);
};

const hasInternalTaskResponseValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return String(value).trim().length > 0;
};

const formatInternalTaskResponseValue = (value: unknown, field?: InternalTaskFormField): string => {
  if (field?.type === 'select' && typeof value === 'string' && Array.isArray(field.options)) {
    const selectedOption = field.options.find((option) => option.value === value);
    if (selectedOption?.label) return selectedOption.label;
  }
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '–';
  if (typeof value === 'string') return value.trim() || '–';
  if (Array.isArray(value)) {
    return value.length > 0
      ? value.map((entry) => formatInternalTaskResponseValue(entry, field)).join(', ')
      : '–';
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '–';
};

const normalizeInternalTasks = (input: unknown): TicketInternalTask[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const source = entry as Record<string, any>;
      const id = typeof source.id === 'string' ? source.id.trim() : '';
      const ticketId =
        typeof source.ticketId === 'string'
          ? source.ticketId.trim()
          : typeof source.ticket_id === 'string'
            ? source.ticket_id.trim()
            : '';
      if (!id || !ticketId) return null;
      const response =
        source.response && typeof source.response === 'object' && !Array.isArray(source.response)
          ? (source.response as Record<string, any>)
          : null;
      const formSchema =
        source.formSchema && typeof source.formSchema === 'object' && !Array.isArray(source.formSchema)
          ? (source.formSchema as Record<string, any>)
          : null;
      return {
        id,
        ticketId,
        workflowExecutionId: typeof source.workflowExecutionId === 'string' ? source.workflowExecutionId : null,
        stepId: typeof source.stepId === 'string' ? source.stepId : null,
        title: typeof source.title === 'string' ? source.title : '',
        description: typeof source.description === 'string' ? source.description : '',
        status:
          typeof source.status === 'string' && source.status.trim()
            ? (source.status.trim().toLowerCase() as InternalTaskStatus)
            : 'pending',
        mode: typeof source.mode === 'string' ? source.mode : '',
        formSchema,
        response,
        completedAt: typeof source.completedAt === 'string' ? source.completedAt : null,
        completedBy: typeof source.completedBy === 'string' ? source.completedBy : null,
        dueAt: typeof source.dueAt === 'string' ? source.dueAt : null,
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : null,
        cycleIndex: Number.isFinite(Number(source.cycleIndex)) ? Math.max(1, Math.floor(Number(source.cycleIndex))) : 1,
        maxCycles: Number.isFinite(Number(source.maxCycles)) ? Math.max(1, Math.floor(Number(source.maxCycles))) : 1,
      } as TicketInternalTask;
    })
    .filter((entry): entry is TicketInternalTask => entry !== null);
};

const TicketDetail: React.FC<TicketDetailProps> = ({ token }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [aiLog, setAiLog] = useState<AILog | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowExecution | null>(null);
  const [feedback, setFeedback] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isExportingTicketPdf, setIsExportingTicketPdf] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [ticketSaving, setTicketSaving] = useState(false);
  const [isPseudonymizing, setIsPseudonymizing] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<string[]>(DEFAULT_CATEGORIES);
  const [responsibilityAuthorityOptions, setResponsibilityAuthorityOptions] = useState<string[]>(
    DEFAULT_RESPONSIBILITY_AUTHORITIES
  );
  const [orgUnitOptions, setOrgUnitOptions] = useState<OrgUnitOption[]>([]);
  const [adminUserOptions, setAdminUserOptions] = useState<AdminUserOption[]>([]);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [assignmentDirectoryLoading, setAssignmentDirectoryLoading] = useState(false);
  const [assignmentDirectoryError, setAssignmentDirectoryError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    tenantId: '',
    category: '',
    responsibilityAuthority: '',
    priority: 'medium' as Ticket['priority'],
    status: 'open' as Ticket['status'],
    assignedTo: '',
    assignmentTarget: '',
    collaboratorUserIds: [] as string[],
    collaboratorOrgUnitIds: [] as string[],
    description: '',
    address: '',
    postalCode: '',
    city: '',
    latitude: '',
    longitude: '',
  });
  const [validationStatus, setValidationStatus] = useState<{
    isValidated: boolean;
    validatedAt?: string;
  } | null>(null);
  const [approvalLoadingByTask, setApprovalLoadingByTask] = useState<Record<string, boolean>>({});
  const [recoveryLoadingByTask, setRecoveryLoadingByTask] = useState<Record<string, boolean>>({});
  const [isStartingWorkflow, setIsStartingWorkflow] = useState(false);
  const [isEndingWorkflow, setIsEndingWorkflow] = useState(false);
  const [isPausingTicket, setIsPausingTicket] = useState(false);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateOption[]>([]);
  const [selectedWorkflowTemplateId, setSelectedWorkflowTemplateId] = useState('');
  const [isWorkflowExpanded, setIsWorkflowExpanded] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [imageAnalysisBusyById, setImageAnalysisBusyById] = useState<Record<string, boolean>>({});
  const [imageAnalyzeDialog, setImageAnalyzeDialog] = useState<ImageAnalyzeDialogState | null>(null);
  const [imageAnalyzeDefaults, setImageAnalyzeDefaults] = useState<{
    includeDescription: boolean;
    includeOsmData: boolean;
    includeWeatherData: boolean;
    modelId: string;
  }>({
    includeDescription: true,
    includeOsmData: true,
    includeWeatherData: true,
    modelId: '',
  });
  const [imageModelOptions, setImageModelOptions] = useState<VisionModelOption[]>([]);
  const [imageModelConnectionName, setImageModelConnectionName] = useState('');
  const [imageModelDefaultRouteId, setImageModelDefaultRouteId] = useState('');
  const [imageModelOptionsLoading, setImageModelOptionsLoading] = useState(false);
  const [exifMapTarget, setExifMapTarget] = useState<ExifMapTarget | null>(null);
  const [timerNowMs, setTimerNowMs] = useState(() => Date.now());
  const [liveConnectionState, setLiveConnectionState] = useState<'live' | 'reconnecting'>('live');
  const [liveLastEventAt, setLiveLastEventAt] = useState<string | null>(null);
  const [liveLastSyncAt, setLiveLastSyncAt] = useState<string | null>(null);
  const [isLiveRefreshing, setIsLiveRefreshing] = useState(false);
  const [ticketComments, setTicketComments] = useState<TicketComment[]>([]);
  const [internalTasks, setInternalTasks] = useState<TicketInternalTask[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentVisibility, setCommentVisibility] = useState<TicketCommentVisibility>('internal');
  const [commentType, setCommentType] = useState<TicketCommentType>('note');
  const [commentFilter, setCommentFilter] = useState<'all' | TicketCommentVisibility>('all');
  const [commentTypeFilters, setCommentTypeFilters] = useState<string[]>([]);
  const [showCommentTypeFilters, setShowCommentTypeFilters] = useState(false);
  const [collapsedCommentIds, setCollapsedCommentIds] = useState<Record<string, boolean>>({});
  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState('');
  const [editingCommentVisibility, setEditingCommentVisibility] = useState<TicketCommentVisibility>('internal');
  const [editingCommentSaving, setEditingCommentSaving] = useState(false);
  const [classificationPreview, setClassificationPreview] = useState<{
    suggestion: {
      category: string;
      priority: string;
      reasoning?: string;
      categoryId?: string;
    };
    rawDecision?: any;
    knowledgeVersion?: string | null;
    categoryWorkflowTemplateId?: string | null;
  } | null>(null);
  const [classificationLoading, setClassificationLoading] = useState(false);
  const [classificationCommitting, setClassificationCommitting] = useState(false);
  const [responsibilityPreview, setResponsibilityPreview] = useState<{
    suggestion: {
      responsibilityAuthority: string;
      reasoning?: string;
      confidence?: number | null;
      legalBasis?: string[];
      notes?: string[];
    };
    rawDecision?: any;
    allowedAuthorities?: string[];
  } | null>(null);
  const [responsibilityLoading, setResponsibilityLoading] = useState(false);
  const [responsibilityCommitting, setResponsibilityCommitting] = useState(false);
  const [isRefreshingGeoWeather, setIsRefreshingGeoWeather] = useState(false);
  const workflowVisualSvgRef = useRef<SVGSVGElement | null>(null);
  const workflowSectionRef = useRef<HTMLDivElement | null>(null);
  const exifMapContainerRef = useRef<HTMLDivElement | null>(null);
  const liveRefreshTimerRef = useRef<number | null>(null);
  const liveRefreshInFlightRef = useRef(false);
  const liveRefreshQueuedRef = useRef(false);
  const liveLastWorkflowRefreshMsRef = useRef(0);
  const currentWorkflowIdRef = useRef<string>('');
  const workflowTemplatesRef = useRef<WorkflowTemplateOption[]>([]);
  const orgUnitById = useMemo(() => new Map(orgUnitOptions.map((unit) => [unit.id, unit])), [orgUnitOptions]);
  const selectedAssignmentTarget = useMemo(
    () => parseAssignmentTarget(editDraft.assignmentTarget),
    [editDraft.assignmentTarget]
  );
  const assignmentTenantId = useMemo(() => {
    const draftTenant = String(editDraft.tenantId || '').trim();
    if (draftTenant) return draftTenant;
    const directTicketTenant = String(ticket?.tenantId || '').trim();
    if (directTicketTenant) return directTicketTenant;
    const fromTicketOrg = String(
      ticket?.primaryAssigneeOrgUnitId || ticket?.owningOrgUnitId || selectedAssignmentTarget.orgUnitId || ''
    ).trim();
    if (!fromTicketOrg) return '';
    return String(orgUnitById.get(fromTicketOrg)?.tenantId || '').trim();
  }, [
    orgUnitById,
    editDraft.tenantId,
    selectedAssignmentTarget.orgUnitId,
    ticket?.owningOrgUnitId,
    ticket?.primaryAssigneeOrgUnitId,
    ticket?.tenantId,
  ]);
  const assignmentOrgOptions = useMemo(
    () => {
      const stickyIds = new Set<string>();
      [ticket?.owningOrgUnitId, ticket?.primaryAssigneeOrgUnitId, selectedAssignmentTarget.orgUnitId].forEach((entry) => {
        const normalized = String(entry || '').trim();
        if (normalized) stickyIds.add(normalized);
      });
      (Array.isArray(ticket?.collaborators) ? ticket.collaborators : []).forEach((entry) => {
        const normalized = String(entry?.orgUnitId || '').trim();
        if (normalized) stickyIds.add(normalized);
      });
      (Array.isArray(editDraft.collaboratorOrgUnitIds) ? editDraft.collaboratorOrgUnitIds : []).forEach((entry) => {
        const normalized = String(entry || '').trim();
        if (normalized) stickyIds.add(normalized);
      });
      return [...orgUnitOptions]
        .filter((unit) => !assignmentTenantId || unit.tenantId === assignmentTenantId || stickyIds.has(unit.id))
        .sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
    },
    [
      assignmentTenantId,
      orgUnitOptions,
      editDraft.collaboratorOrgUnitIds,
      selectedAssignmentTarget.orgUnitId,
      ticket?.collaborators,
      ticket?.owningOrgUnitId,
      ticket?.primaryAssigneeOrgUnitId,
    ]
  );
  const assignmentUserOptions = useMemo(
    () => {
      const stickyIds = new Set<string>();
      [ticket?.primaryAssigneeUserId, selectedAssignmentTarget.userId].forEach((entry) => {
        const normalized = String(entry || '').trim();
        if (normalized) stickyIds.add(normalized);
      });
      (Array.isArray(ticket?.collaborators) ? ticket.collaborators : []).forEach((entry) => {
        const normalized = String(entry?.userId || '').trim();
        if (normalized) stickyIds.add(normalized);
      });
      (Array.isArray(editDraft.collaboratorUserIds) ? editDraft.collaboratorUserIds : []).forEach((entry) => {
        const normalized = String(entry || '').trim();
        if (normalized) stickyIds.add(normalized);
      });
      return [...adminUserOptions]
        .filter((user) => stickyIds.has(user.id) || userCanBeAssignedToTenant(user, assignmentTenantId))
        .sort((a, b) =>
          buildAssignmentUserLabel(a).localeCompare(buildAssignmentUserLabel(b), 'de', { sensitivity: 'base' })
        );
    },
    [
      adminUserOptions,
      assignmentTenantId,
      editDraft.collaboratorUserIds,
      selectedAssignmentTarget.userId,
      ticket?.collaborators,
      ticket?.primaryAssigneeUserId,
    ]
  );
  const collaboratorUserSelectionOptions = useMemo(() => {
    const byId = new Map(
      assignmentUserOptions.map((entry) => [
        entry.id,
        {
          id: entry.id,
          label: entry.active ? buildAssignmentUserLabel(entry) : `${buildAssignmentUserLabel(entry)} (inaktiv)`,
          missing: false,
        },
      ])
    );
    const selectedIds = Array.isArray(editDraft.collaboratorUserIds) ? editDraft.collaboratorUserIds : [];
    selectedIds.forEach((entry) => {
      const id = String(entry || '').trim();
      if (!id || byId.has(id)) return;
      byId.set(id, {
        id,
        label: `${id} (nicht mehr vorhanden)`,
        missing: true,
      });
    });
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
  }, [assignmentUserOptions, editDraft.collaboratorUserIds]);
  const collaboratorOrgSelectionOptions = useMemo(() => {
    const byId = new Map(
      assignmentOrgOptions.map((entry) => [
        entry.id,
        {
          id: entry.id,
          label: entry.active ? entry.label : `${entry.label} (inaktiv)`,
          missing: false,
        },
      ])
    );
    const selectedIds = Array.isArray(editDraft.collaboratorOrgUnitIds) ? editDraft.collaboratorOrgUnitIds : [];
    selectedIds.forEach((entry) => {
      const id = String(entry || '').trim();
      if (!id || byId.has(id)) return;
      byId.set(id, {
        id,
        label: `${id} (nicht mehr vorhanden)`,
        missing: true,
      });
    });
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
  }, [assignmentOrgOptions, editDraft.collaboratorOrgUnitIds]);

  const taskTypeLabels: Record<WorkflowTask['type'], string> = {
    REDMINE_TICKET: 'Redmine-Ticket',
    EMAIL: 'E-Mail',
    EMAIL_EXTERNAL: 'E-Mail (extern)',
    EMAIL_CONFIRMATION: 'E-Mail-Bestätigung',
    MAYOR_INVOLVEMENT: 'Ortsbürgermeister involvieren',
    CATEGORIZATION: 'Kategorisierung',
    EMAIL_DOUBLE_OPT_IN: 'E-Mail Double Opt-In',
    CITIZEN_NOTIFICATION: 'Bürgerbenachrichtigung',
    REST_API_CALL: 'RESTful API Call',
    INTERNAL_PROCESSING: 'Interne Bearbeitung',
    DATENNACHFORDERUNG: 'Datennachforderung',
    ENHANCED_CATEGORIZATION: 'KI-Basierte Datennachforderung',
    FREE_AI_DATA_REQUEST: 'Freie KI-Datennachforderung',
    IMAGE_TO_TEXT_ANALYSIS: 'Bilder zu Text auswerten',
    END: 'Workflow-/Teilworkflow-Ende',
    JOIN: 'Join-Knoten',
    SPLIT: 'Split-Knoten',
    IF: 'IF-Bedingung',
    CUSTOM: 'Benutzerdefiniert',
    WAIT_STATUS_CHANGE: 'Warte auf Statuswechsel',
    CHANGE_WORKFLOW: 'Workflow wechseln',
    SUB_WORKFLOW: 'Teilworkflow starten',
    RESPONSIBILITY_CHECK: 'Verwaltungs-Zuständigkeitsprüfung',
  };

  const getActiveWorkflowTasks = (execution: WorkflowExecution): WorkflowTask[] => {
    const activeIds = new Set(Array.isArray(execution.activeTaskIds) ? execution.activeTaskIds : []);
    if (activeIds.size === 0) {
      const fallback = execution.tasks[execution.currentTaskIndex];
      return fallback ? [fallback] : [];
    }
    return execution.tasks
      .filter((task) => activeIds.has(task.id))
      .sort((a, b) => a.order - b.order);
  };

  const getPendingManualWorkflowTasks = (execution: WorkflowExecution): WorkflowTask[] =>
    getActiveWorkflowTasks(execution).filter((task) => task.status === 'PENDING' && !task.auto);

  const getCurrentWorkflowTask = (execution: WorkflowExecution): WorkflowTask | null =>
    getActiveWorkflowTasks(execution).find((task) => task.status === 'RUNNING' || task.status === 'PENDING') ||
    execution.tasks.find((task) => task.status === 'RUNNING' || task.status === 'PENDING') ||
    null;

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return 'Ungültig';
      }
      return date.toLocaleString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return 'Ungültig';
    }
  };

  const formatTimeShort = (dateString?: string | null) => {
    if (!dateString) return '–';
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return '–';
    return parsed.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatByteSize = (value?: number) => {
    if (!value || value <= 0) return '–';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatCoordinate = (value?: number | null) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
    return value.toFixed(6);
  };

  const loadImageAnalysisModelOptions = React.useCallback(async () => {
    if (!token) return;
    setImageModelOptionsLoading(true);
    let routeModelIdForFallback = '';
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [routingRes, connectionsRes] = await Promise.all([
        axios.get('/api/admin/llm/task-routing', { headers }),
        axios.get('/api/admin/llm/connections', { headers }),
      ]);

      const routing = routingRes.data?.routing || {};
      const route = routing?.routes?.image_to_text || routing?.defaultRoute || {};
      const connectionId = String(route.connectionId || '').trim();
      const routeModelId = String(route.modelId || '').trim();
      routeModelIdForFallback = routeModelId;
      setImageModelDefaultRouteId(routeModelId);

      const connectionItems = Array.isArray(connectionsRes.data?.items) ? connectionsRes.data.items : [];
      const connectionName = connectionItems.find((entry: any) => String(entry?.id || '').trim() === connectionId)?.name;
      setImageModelConnectionName(String(connectionName || connectionId || '').trim());

      let options: VisionModelOption[] = [];
      if (connectionId) {
        const modelsRes = await axios.get(
          `/api/admin/llm/connections/${encodeURIComponent(connectionId)}/models`,
          { headers, params: { visionOnly: 'true' } }
        );
        options = (Array.isArray(modelsRes.data?.items) ? modelsRes.data.items : [])
          .map((entry: any) => {
            const id = String(entry?.id || '').trim();
            if (!id) return null;
            return {
              id,
              label: String(entry?.label || id).trim() || id,
            } as VisionModelOption;
          })
          .filter((entry: VisionModelOption | null): entry is VisionModelOption => entry !== null);
      }

      if (routeModelId && !options.some((entry) => entry.id === routeModelId)) {
        options.unshift({
          id: routeModelId,
          label: `${routeModelId} (Route)`,
        });
      }

      setImageModelOptions(options);
      if (routeModelId) {
        setImageAnalyzeDefaults((prev) => ({
          ...prev,
          modelId: prev.modelId || routeModelId,
        }));
      }
    } catch {
      setImageModelOptions((current) => {
        const fallbackModelId = routeModelIdForFallback || imageModelDefaultRouteId;
        if (fallbackModelId && !current.some((entry) => entry.id === fallbackModelId)) {
          return [
            { id: fallbackModelId, label: `${fallbackModelId} (Route)` },
            ...current,
          ];
        }
        return current;
      });
    } finally {
      setImageModelOptionsLoading(false);
    }
  }, [token, imageModelDefaultRouteId]);

  const resolveEmailTextPreview = (message: TicketEmailMessage): string => {
    const text = String(message.textBody || '').trim();
    if (text) return text;
    const htmlText = String(message.htmlBody || '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*p\s*>/gi, '\n\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return htmlText;
  };

  const handleDownloadEmailAttachment = async (message: TicketEmailMessage, attachment: TicketEmailAttachment) => {
    const messageId = String(message.id || '').trim();
    const attachmentId = String(attachment.id || '').trim();
    if (!messageId || !attachmentId) return;
    try {
      const response = await axios.get(
        `/api/admin/mailbox/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(
          attachmentId
        )}/download`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'blob',
        }
      );
      const blob = new Blob([response.data], { type: attachment.mimeType || 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.fileName || 'attachment.bin';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'E-Mail-Anhang konnte nicht heruntergeladen werden.');
    }
  };

  const openExifMap = (image: TicketImage) => {
    const latitude = image.exif?.gpsLatitude;
    const longitude = image.exif?.gpsLongitude;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return;
    if (typeof longitude !== 'number' || !Number.isFinite(longitude)) return;
    setExifMapTarget({
      latitude,
      longitude,
      label: image.fileName || 'Bild',
    });
  };

  const formatImageAnalysisStatus = (status?: string): string => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'done') return 'Beschrieben';
    if (normalized === 'processing') return 'Wird analysiert';
    if (normalized === 'failed') return 'Fehlgeschlagen';
    return 'Keine Analyse';
  };

  const openImageAnalyzeDialog = (image: TicketImage) => {
    const nextModelId =
      imageAnalyzeDefaults.modelId ||
      imageModelDefaultRouteId ||
      image.analysis?.model ||
      '';
    setImageAnalyzeDialog({
      imageId: image.id,
      force: !!image.analysis?.description,
      includeDescription: imageAnalyzeDefaults.includeDescription,
      includeOsmData: imageAnalyzeDefaults.includeOsmData,
      includeWeatherData: imageAnalyzeDefaults.includeWeatherData,
      modelId: nextModelId,
    });
  };

  const handleAnalyzeImage = async (input: {
    imageId: string;
    force?: boolean;
    includeDescription?: boolean;
    includeOsmData?: boolean;
    includeWeatherData?: boolean;
    modelId?: string;
  }) => {
    const imageId = String(input?.imageId || '').trim();
    const force = input?.force === true;
    const includeDescription = input?.includeDescription !== false;
    const includeOsmData = input?.includeOsmData === true;
    const includeWeatherData = input?.includeWeatherData === true;
    const modelId = String(input?.modelId || '').trim();
    if (!id || !imageId) return;
    if (imageAnalysisBusyById[imageId]) return;

    setImageAnalysisBusyById((prev) => ({ ...prev, [imageId]: true }));
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(
        `/api/tickets/${id}/images/${imageId}/analyze`,
        {
          force,
          includeDescription,
          includeOsmData,
          includeWeatherData,
          modelId: modelId || undefined,
        },
        { headers }
      );
      const updatedImage = response.data?.image;
      if (updatedImage && typeof updatedImage === 'object') {
        setTicket((prev) =>
          prev
            ? {
                ...prev,
                images: Array.isArray(prev.images)
                  ? prev.images.map((image) =>
                      image.id === imageId ? ({ ...image, ...(updatedImage as TicketImage) } as TicketImage) : image
                    )
                  : prev.images,
              }
            : prev
        );
      } else {
        await loadTicketDetails({ showLoading: false });
      }

      const successText =
        typeof response.data?.message === 'string' && response.data.message.trim()
          ? response.data.message
          : 'Bildanalyse abgeschlossen';
      setSuccessMessage(successText);
      setTimeout(() => setSuccessMessage(''), 2500);
      setImageAnalyzeDefaults((prev) => ({
        includeDescription,
        includeOsmData,
        includeWeatherData,
        modelId: modelId || prev.modelId,
      }));
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Bildanalyse fehlgeschlagen');
      } else {
        setError('Bildanalyse fehlgeschlagen');
      }
    } finally {
      setImageAnalysisBusyById((prev) => ({ ...prev, [imageId]: false }));
    }
  };

  const copyTextToClipboard = async (value: string) => {
    const normalized = String(value || '').trim();
    if (!normalized) return false;

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(normalized);
      return true;
    }

    const textArea = document.createElement('textarea');
    textArea.value = normalized;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const copied = document.execCommand('copy');
    textArea.remove();
    return copied;
  };

  const buildEditDraft = (source: Ticket) => {
    const legacyAssignedTo = source.assignedTo || '';
    let assignmentTarget = '';
    if (source.primaryAssigneeUserId) {
      assignmentTarget = `user:${source.primaryAssigneeUserId}`;
    } else if (source.primaryAssigneeOrgUnitId) {
      assignmentTarget = `org:${source.primaryAssigneeOrgUnitId}`;
    } else if (legacyAssignedTo) {
      assignmentTarget = `legacy:${legacyAssignedTo}`;
    }
    const fallbackTenantFromOrg = String(
      orgUnitById.get(String(source.primaryAssigneeOrgUnitId || '').trim())?.tenantId ||
        orgUnitById.get(String(source.owningOrgUnitId || '').trim())?.tenantId ||
        ''
    ).trim();
    return {
      tenantId: String(source.tenantId || '').trim() || fallbackTenantFromOrg,
      category: source.category || '',
      responsibilityAuthority: source.responsibilityAuthority || '',
      priority: source.priority || 'medium',
      status: source.status || 'open',
      assignedTo: legacyAssignedTo,
      assignmentTarget,
      collaboratorUserIds: normalizeTicketCollaborators(source.collaborators)
        .map((entry) => String(entry.userId || '').trim())
        .filter(Boolean),
      collaboratorOrgUnitIds: normalizeTicketCollaborators(source.collaborators)
        .map((entry) => String(entry.orgUnitId || '').trim())
        .filter(Boolean),
      description: source.originalDescription || source.description || source.anonymizedText || '',
      address: source.address || '',
      postalCode: source.postalCode || '',
      city: source.city || '',
      latitude: source.latitude !== undefined && source.latitude !== null ? String(source.latitude) : '',
      longitude: source.longitude !== undefined && source.longitude !== null ? String(source.longitude) : '',
    };
  };

  const parseNominatimPayload = (payload: any): Record<string, any> | null => {
    const direct = payload?.nominatimRaw;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, any>;
    }
    const rawJson = payload?.nominatimRawJson;
    if (typeof rawJson === 'string' && rawJson.trim()) {
      try {
        const parsed = JSON.parse(rawJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, any>;
        }
      } catch {
        return null;
      }
    }
    return null;
  };

  const parseWeatherPayload = (payload: any): Record<string, any> | null => {
    const direct = payload?.weatherReport;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, any>;
    }
    const rawJson = payload?.weatherReportJson;
    if (typeof rawJson === 'string' && rawJson.trim()) {
      try {
        const parsed = JSON.parse(rawJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, any>;
        }
      } catch {
        return null;
      }
    }
    return null;
  };

const normalizeTicketPayload = (payload: any): Ticket => ({
  ...(payload || {}),
  nominatimRaw: parseNominatimPayload(payload),
  weatherReport: parseWeatherPayload(payload),
  dataRequests: normalizeTicketDataRequests(payload?.dataRequests),
  collaborators: normalizeTicketCollaborators(payload?.collaborators),
  emailMessages: normalizeTicketEmailMessages(payload?.emailMessages),
});

  const loadTicketDetails = async (options?: { showLoading?: boolean; lightweight?: boolean }) => {
    if (!id) return;
    const showLoading = options?.showLoading !== false;
    const lightweight = options?.lightweight === true;
    if (showLoading) {
      setIsLoading(true);
    }

    try {
      const headers = { Authorization: `Bearer ${token}` };
      const shouldLoadCategories = !lightweight || categoryOptions.length === 0;
      const shouldLoadAuthorities = !lightweight || responsibilityAuthorityOptions.length === 0;
      const [ticketRes, knowledgeRes, generalRes, internalTasksRes] = await Promise.all([
        axios.get(`/api/tickets/${id}`, { headers }),
        shouldLoadCategories ? axios.get('/api/knowledge', { headers }).catch(() => null) : Promise.resolve(null),
        shouldLoadAuthorities
          ? axios.get('/api/admin/config/general', { headers }).catch(() => null)
          : Promise.resolve(null),
        axios
          .get('/api/admin/internal-tasks', {
            headers,
            params: {
              limit: 300,
              offset: 0,
              ticketId: id,
            },
          })
          .catch(() => null),
      ]);
      const normalizedTicket = normalizeTicketPayload(ticketRes.data);
      setTicket(normalizedTicket);
      setTicketComments(normalizeTicketComments(ticketRes.data?.comments));
      setInternalTasks(normalizeInternalTasks(internalTasksRes?.data?.items));
      if (knowledgeRes?.data) {
        const loadedCategories = Array.isArray(knowledgeRes.data?.categories)
          ? knowledgeRes.data.categories.map((entry: any) => String(entry?.name || '').trim()).filter(Boolean)
          : [];
        const mergedCategories = mergeOptionLists(
          DEFAULT_CATEGORIES,
          categoryOptions,
          loadedCategories,
          [normalizedTicket.category]
        ).sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
        if (mergedCategories.length > 0) {
          setCategoryOptions(mergedCategories);
        }
      } else {
        setCategoryOptions((prev) =>
          mergeOptionLists(DEFAULT_CATEGORIES, prev, [normalizedTicket.category]).sort((a, b) =>
            a.localeCompare(b, 'de', { sensitivity: 'base' })
          )
        );
      }
      if (generalRes?.data) {
        const loadedAuthorities = Array.isArray(generalRes.data?.responsibilityAuthorities)
          ? generalRes.data.responsibilityAuthorities
          : [];
        const mergedAuthorities = mergeOptionLists(
          DEFAULT_RESPONSIBILITY_AUTHORITIES,
          responsibilityAuthorityOptions,
          loadedAuthorities,
          [normalizedTicket.responsibilityAuthority]
        );
        if (mergedAuthorities.length > 0) {
          setResponsibilityAuthorityOptions(mergedAuthorities);
        }
      } else {
        setResponsibilityAuthorityOptions((prev) =>
          mergeOptionLists(DEFAULT_RESPONSIBILITY_AUTHORITIES, prev, [normalizedTicket.responsibilityAuthority])
        );
      }

      if (!lightweight || workflowTemplatesRef.current.length === 0) {
        try {
          const templatesRes = await axios.get('/api/admin/config/workflow/templates', { headers });
          const templates = Array.isArray(templatesRes.data)
            ? templatesRes.data
                .filter((template: WorkflowTemplateOption) => template?.enabled !== false)
                .map((template: WorkflowTemplateOption) => ({
                  id: String(template.id || ''),
                  name: String(template.name || template.id || ''),
                  enabled: template.enabled !== false,
                }))
                .filter((template: WorkflowTemplateOption) => template.id && template.name)
            : [];
          setWorkflowTemplates(templates);
          setSelectedWorkflowTemplateId((prev) => {
            if (prev && templates.some((template: WorkflowTemplateOption) => template.id === prev)) {
              return prev;
            }
            const suggestedTemplateId = String(ticketRes.data?.workflowTemplateId || '').trim();
            if (
              suggestedTemplateId &&
              templates.some((template: WorkflowTemplateOption) => template.id === suggestedTemplateId)
            ) {
              return suggestedTemplateId;
            }
            return templates[0]?.id || '';
          });
        } catch {
          // Workflow templates not available
        }
      }

      if (!lightweight) {
        // Try to fetch AI log
        try {
          const logRes = await axios.get(`/api/admin/logs/${id}`, { headers });
          setAiLog(logRes.data);
          if (logRes.data.adminFeedback) {
            setFeedback(logRes.data.adminFeedback);
          }
          if (logRes.data.correctedCategory) {
            setNewCategory(logRes.data.correctedCategory);
          }
        } catch {
          // No AI log found yet
        }
      }

      // Try to fetch workflow status/details
      const workflowExecutionId =
        ticketRes.data.workflowExecutionId ||
        ticketRes.data.workflowId ||
        null;
      if (workflowExecutionId) {
        try {
          const workflowRes = await axios.get(`/api/admin/workflows/${workflowExecutionId}`, { headers });
          setWorkflow(workflowRes.data);
        } catch {
          setWorkflow(null);
        }
      } else {
        setWorkflow(null);
      }

      if (!lightweight) {
        // Fetch validation status
        try {
          const validRes = await axios.get(`/api/validations/${id}/status`, { headers });
          setValidationStatus(validRes.data);
        } catch {
          // No validation data yet
        }
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Laden der Ticket-Details');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  const loadAssignmentDirectory = React.useCallback(async () => {
    if (!token) return;
    setAssignmentDirectoryLoading(true);
    setAssignmentDirectoryError(null);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const directory = await fetchAssignmentDirectory(headers, { includeInactiveOrgUnits: true });
      setTenantOptions(directory.tenants);
      setAdminUserOptions(directory.users);
      setOrgUnitOptions(directory.orgUnits);
    } catch (error) {
      setTenantOptions([]);
      setAssignmentDirectoryError('Zuweisungsdaten konnten nicht geladen werden.');
    } finally {
      setAssignmentDirectoryLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (id) loadTicketDetails();
  }, [id, token]);

  useEffect(() => {
    void loadAssignmentDirectory();
  }, [loadAssignmentDirectory]);

  useEffect(() => {
    void loadImageAnalysisModelOptions();
  }, [loadImageAnalysisModelOptions]);

  useEffect(() => {
    const tenantId = String(ticket?.tenantId || '').trim();
    if (!tenantId) return;
    void loadAssignmentDirectory();
  }, [loadAssignmentDirectory, ticket?.tenantId]);

  useEffect(() => {
    setClassificationPreview(null);
    setResponsibilityPreview(null);
  }, [id]);

  useEffect(() => {
    currentWorkflowIdRef.current = String(workflow?.id || '').trim();
  }, [workflow?.id]);

  useEffect(() => {
    workflowTemplatesRef.current = workflowTemplates;
  }, [workflowTemplates]);

  useEffect(() => {
    const pageTicketId = String(id || '').trim();
    if (!pageTicketId || !token) return;

    const scheduleSilentRefresh = (delayMs = 180) => {
      if (liveRefreshTimerRef.current) {
        window.clearTimeout(liveRefreshTimerRef.current);
      }
      liveRefreshTimerRef.current = window.setTimeout(() => {
        liveRefreshTimerRef.current = null;
        void runSilentRefresh();
      }, delayMs);
    };

    const runSilentRefresh = async () => {
      if (liveRefreshInFlightRef.current) {
        liveRefreshQueuedRef.current = true;
        return;
      }
      liveRefreshInFlightRef.current = true;
      setIsLiveRefreshing(true);
      try {
        await loadTicketDetails({ showLoading: false, lightweight: true });
        const nowIso = new Date().toISOString();
        setLiveLastSyncAt(nowIso);
        setTimerNowMs(Date.now());
      } finally {
        liveRefreshInFlightRef.current = false;
        setIsLiveRefreshing(false);
        if (liveRefreshQueuedRef.current) {
          liveRefreshQueuedRef.current = false;
          scheduleSilentRefresh(120);
        }
      }
    };

    setLiveConnectionState('live');
    const unsubscribe = subscribeAdminRealtime({
      token,
      topics: ['tickets', 'workflows'],
      onUpdate: (event) => {
        setLiveConnectionState('live');
        if (typeof event?.at === 'string' && event.at.trim()) {
          setLiveLastEventAt(event.at);
        } else {
          setLiveLastEventAt(new Date().toISOString());
        }

        const eventTicketId = String(event?.ticketId || '').trim();
        if (event.topic === 'tickets') {
          if (eventTicketId && eventTicketId !== pageTicketId) return;
          scheduleSilentRefresh(100);
          return;
        }

        if (event.topic === 'workflows') {
          const eventWorkflowId = String(event?.workflowId || '').trim();
          const currentWorkflowId = currentWorkflowIdRef.current;
          if (eventWorkflowId && currentWorkflowId && eventWorkflowId !== currentWorkflowId) return;
          if (!currentWorkflowId) return;
          const nowMs = Date.now();
          if (nowMs - liveLastWorkflowRefreshMsRef.current < 1500) return;
          liveLastWorkflowRefreshMsRef.current = nowMs;
          scheduleSilentRefresh(180);
        }
      },
      onError: () => {
        setLiveConnectionState('reconnecting');
      },
    });

    return () => {
      unsubscribe();
      if (liveRefreshTimerRef.current) {
        window.clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
      liveRefreshQueuedRef.current = false;
      liveRefreshInFlightRef.current = false;
    };
  }, [id, token]);

  useEffect(() => {
    if (!ticket || isEditing) return;
    setEditDraft(buildEditDraft(ticket));
  }, [ticket, isEditing]);

  useEffect(() => {
    if (activeImageIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveImageIndex(null);
      }
      if (event.key === 'ArrowRight' && ticket?.images?.length) {
        setActiveImageIndex((prev) => {
          const current = prev ?? 0;
          return (current + 1) % ticket.images!.length;
        });
      }
      if (event.key === 'ArrowLeft' && ticket?.images?.length) {
        setActiveImageIndex((prev) => {
          const current = prev ?? 0;
          return (current - 1 + ticket.images!.length) % ticket.images!.length;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeImageIndex, ticket?.images]);

  useEffect(() => {
    if (!imageAnalyzeDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setImageAnalyzeDialog(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [imageAnalyzeDialog]);

  useEffect(() => {
    const hasRunningTimer =
      Array.isArray(workflow?.tasks) &&
      workflow.tasks.some((task) => task.status === 'RUNNING' && parseTaskAwaitingUntilMs(task) !== null);
    if (!hasRunningTimer) return;
    setTimerNowMs(Date.now());
    const timer = window.setInterval(() => {
      setTimerNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [workflow]);

  useEffect(() => {
    if (!exifMapTarget || !exifMapContainerRef.current) return;

    const map = L.map(exifMapContainerRef.current, {
      zoomControl: true,
      minZoom: 3,
      maxZoom: 19,
    }).setView([exifMapTarget.latitude, exifMapTarget.longitude], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    const markerIcon = L.divIcon({
      className: 'exif-map-marker',
      html: '<i class="fa-solid fa-location-dot"></i>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -26],
    });

    const marker = L.marker([exifMapTarget.latitude, exifMapTarget.longitude], { icon: markerIcon }).addTo(map);
    marker.bindPopup(
      `${exifMapTarget.label}<br>${formatCoordinate(exifMapTarget.latitude)}, ${formatCoordinate(exifMapTarget.longitude)}`
    );
    marker.openPopup();

    const timer = window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      window.clearTimeout(timer);
      map.off();
      map.remove();
    };
  }, [exifMapTarget]);

  const handleApproveTask = async (taskId?: string) => {
    if (!workflow || !ticket) return;
    const pendingTasks = workflow.status === 'PAUSED' ? getPendingManualWorkflowTasks(workflow) : [];
    const targetTask =
      (taskId ? pendingTasks.find((task) => task.id === taskId) : null) ||
      pendingTasks[0] ||
      null;
    if (!targetTask) return;

    setApprovalLoadingByTask((prev) => ({ ...prev, [targetTask.id]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.post(
        `/api/admin/workflows/${workflow.id}/tasks/${targetTask.id}/approve`,
        {},
        { headers }
      );
      setSuccessMessage('Task freigegeben');
      setTimeout(() => setSuccessMessage(''), 3000);
      // Reload workflow
      const workflowRes = await axios.get(`/api/admin/workflows/${workflow.id}`, { headers });
      setWorkflow(workflowRes.data);
    } catch (err: any) {
      setError('Fehler beim Freigeben der Task');
    } finally {
      setApprovalLoadingByTask((prev) => ({ ...prev, [targetTask.id]: false }));
    }
  };

  const handleRejectTask = async (taskId?: string) => {
    if (!workflow || !ticket) return;
    const pendingTasks = workflow.status === 'PAUSED' ? getPendingManualWorkflowTasks(workflow) : [];
    const targetTask =
      (taskId ? pendingTasks.find((task) => task.id === taskId) : null) ||
      pendingTasks[0] ||
      null;
    if (!targetTask) return;
    if (!window.confirm(`Task "${targetTask.title}" wirklich ablehnen?`)) return;

    setApprovalLoadingByTask((prev) => ({ ...prev, [targetTask.id]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.post(
        `/api/admin/workflows/${workflow.id}/tasks/${targetTask.id}/reject`,
        {},
        { headers }
      );
      setSuccessMessage('Task abgelehnt');
      setTimeout(() => setSuccessMessage(''), 3000);
      // Reload workflow
      const workflowRes = await axios.get(`/api/admin/workflows/${workflow.id}`, { headers });
      setWorkflow(workflowRes.data);
    } catch (err: any) {
      setError('Fehler beim Ablehnen der Task');
    } finally {
      setApprovalLoadingByTask((prev) => ({ ...prev, [targetTask.id]: false }));
    }
  };

  const refreshWorkflowState = async (workflowId: string, headers: Record<string, string>) => {
    const workflowRes = await axios.get(`/api/admin/workflows/${workflowId}`, { headers });
    setWorkflow(workflowRes.data);
  };

  const handleRecoveryAction = async (
    task: WorkflowTask,
    action: 'retry' | 'skip' | 'resume'
  ) => {
    if (!workflow) return;
    let reason = '';
    if (action === 'skip' || action === 'resume') {
      reason = window.prompt(
        action === 'skip'
          ? 'Bitte Grund für das Überspringen eingeben:'
          : 'Bitte Grund für manuelles Fortsetzen eingeben:'
      )?.trim() || '';
      if (!reason) return;
    } else {
      reason = window.prompt('Optionaler Grund für Retry:')?.trim() || '';
    }

    setRecoveryLoadingByTask((prev) => ({ ...prev, [task.id]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.post(
        `/api/admin/workflows/${workflow.id}/tasks/${task.id}/${action}`,
        reason ? { reason } : {},
        { headers }
      );
      const successLabel =
        action === 'retry'
          ? 'Retry gestartet'
          : action === 'skip'
          ? 'Schritt übersprungen'
          : 'Schritt manuell fortgesetzt';
      setSuccessMessage(successLabel);
      setTimeout(() => setSuccessMessage(''), 3000);
      await refreshWorkflowState(workflow.id, headers);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Recovery-Aktion fehlgeschlagen');
    } finally {
      setRecoveryLoadingByTask((prev) => ({ ...prev, [task.id]: false }));
    }
  };

  const handleSaveFeedback = async () => {
    if (!feedback.trim()) {
      setError('Bitte geben Sie ein Feedback ein');
      return;
    }

    setIsSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      const headers = { Authorization: `Bearer ${token}` };
      const payload = {
        feedback,
        newCategory: newCategory || undefined,
        isCorrect: newCategory === ticket?.category,
      };

      await axios.patch(`/api/admin/logs/${ticket?.id}`, payload, { headers });

      setSuccessMessage('Feedback erfolgreich gespeichert!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Speichern des Feedbacks');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    setIsSaving(true);
    setError('');

    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.patch(
        `/api/tickets/${id}`,
        { status: newStatus },
        { headers }
      );

      setTicket((prev) => prev ? { ...prev, status: newStatus as any } : null);
      setSuccessMessage('Status aktualisiert!');
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Aktualisieren des Status');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartEdit = () => {
    if (!ticket) return;
    setEditDraft(buildEditDraft(ticket));
    setIsEditing(true);
    void loadAssignmentDirectory();
  };

  const handleCancelEdit = () => {
    if (ticket) {
      setEditDraft(buildEditDraft(ticket));
    }
    setIsEditing(false);
  };

  const handleSaveEdits = async () => {
    if (!ticket || !id) return;
    if (!editDraft.category.trim()) {
      setError('Bitte eine Kategorie angeben');
      return;
    }

    const lat = editDraft.latitude.trim();
    const lon = editDraft.longitude.trim();
    const parsedLat = lat === '' ? null : Number(lat);
    const parsedLon = lon === '' ? null : Number(lon);
    if ((lat !== '' && Number.isNaN(parsedLat)) || (lon !== '' && Number.isNaN(parsedLon))) {
      setError('Koordinaten muessen numerisch sein');
      return;
    }

    setTicketSaving(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const assignment = parseAssignmentTarget(editDraft.assignmentTarget);
      const draftTenantId = String(editDraft.tenantId || '').trim();
      const collaboratorUserIds = Array.from(
        new Set(
          (Array.isArray(editDraft.collaboratorUserIds) ? editDraft.collaboratorUserIds : [])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
        )
      ).filter((entry) => entry !== assignment.userId);
      const collaboratorOrgUnitIds = Array.from(
        new Set(
          (Array.isArray(editDraft.collaboratorOrgUnitIds) ? editDraft.collaboratorOrgUnitIds : [])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
        )
      ).filter((entry) => entry !== assignment.orgUnitId);
      await axios.patch(
        `/api/tickets/${id}`,
        {
          category: editDraft.category.trim(),
          responsibilityAuthority: editDraft.responsibilityAuthority.trim(),
          priority: editDraft.priority,
          status: editDraft.status,
          assignedTo: assignment.assignedTo,
          primaryAssigneeUserId: assignment.userId || '',
          primaryAssigneeOrgUnitId: assignment.orgUnitId || '',
          collaboratorUserIds,
          collaboratorOrgUnitIds,
          ...(draftTenantId ? { tenantId: draftTenantId } : {}),
          description: editDraft.description.trim(),
          address: editDraft.address.trim(),
          postalCode: editDraft.postalCode.trim(),
          city: editDraft.city.trim(),
          latitude: parsedLat,
          longitude: parsedLon,
        },
        { headers }
      );

      const ticketRes = await axios.get(`/api/tickets/${id}`, { headers });
      setTicket(normalizeTicketPayload(ticketRes.data));
      setIsEditing(false);
      setSuccessMessage('Ticket aktualisiert');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Speichern');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setTicketSaving(false);
    }
  };

  const handleGenerateReporterPseudonym = async () => {
    if (!ticket || !id || isPseudonymizing) return;

    const hasPseudonymAlready = [
      ticket.reporterPseudoName,
      ticket.reporterPseudoFirstName,
      ticket.reporterPseudoLastName,
      ticket.reporterPseudoEmail,
    ].some((value) => typeof value === 'string' && value.trim().length > 0);
    if (hasPseudonymAlready) return;

    setIsPseudonymizing(true);
    setError('');

    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(`/api/tickets/${id}/pseudonymize`, {}, { headers });
      const payload =
        response.data && typeof response.data === 'object'
          ? (response.data as Record<string, unknown>)
          : {};

      setTicket((prev) =>
        prev
          ? {
              ...prev,
              reporterPseudoName:
                typeof payload.reporterPseudoName === 'string' ? payload.reporterPseudoName : prev.reporterPseudoName,
              reporterPseudoFirstName:
                typeof payload.reporterPseudoFirstName === 'string'
                  ? payload.reporterPseudoFirstName
                  : prev.reporterPseudoFirstName,
              reporterPseudoLastName:
                typeof payload.reporterPseudoLastName === 'string'
                  ? payload.reporterPseudoLastName
                  : prev.reporterPseudoLastName,
              reporterPseudoEmail:
                typeof payload.reporterPseudoEmail === 'string' ? payload.reporterPseudoEmail : prev.reporterPseudoEmail,
              reporterPseudoScopeKey:
                typeof payload.reporterPseudoScopeKey === 'string'
                  ? payload.reporterPseudoScopeKey
                  : prev.reporterPseudoScopeKey,
            }
          : prev
      );

      const successText =
        typeof response.data?.message === 'string' && response.data.message.trim()
          ? response.data.message
          : 'Pseudonym wurde erzeugt';
      setSuccessMessage(successText);
      setTimeout(() => setSuccessMessage(''), 2500);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Pseudonym konnte nicht erzeugt werden');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsPseudonymizing(false);
    }
  };

  const handleManualVerification = async () => {
    if (!ticket) return;

    setIsSaving(true);
    setError('');

    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.patch(
        `/api/tickets/${ticket.id}`,
        { status: 'open' },
        { headers }
      );

      setTicket((prev) => prev ? { ...prev, status: 'open' } : null);
      setValidationStatus({ isValidated: true, validatedAt: new Date().toISOString() });
      setSuccessMessage('Ticket manuell verifiziert!');
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler bei der Verifikation');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartWorkflow = async () => {
    if (!ticket || !id) return;

    setIsStartingWorkflow(true);
    setError('');
    setSuccessMessage('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const payload =
        selectedWorkflowTemplateId && selectedWorkflowTemplateId.trim()
          ? { templateId: selectedWorkflowTemplateId.trim() }
          : {};
      const response = await axios.post(`/api/admin/workflows/ticket/${id}`, payload, { headers });
      const messageText =
        typeof response.data?.message === 'string' && response.data.message.trim()
          ? response.data.message
          : response.status === 201
          ? 'Workflow gestartet.'
          : 'Workflow ausgelöst.';
      setSuccessMessage(messageText);
      setTimeout(() => setSuccessMessage(''), 3500);
      await loadTicketDetails({ showLoading: false });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Starten des Workflows');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsStartingWorkflow(false);
    }
  };

  const handleOpenWorkflowDetailView = () => {
    if (!workflow) return;
    setIsWorkflowExpanded(true);
    window.setTimeout(() => {
      workflowSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const handleSkipCurrentWorkflowTask = async () => {
    if (!workflow) return;
    const activeTask = getCurrentWorkflowTask(workflow);
    if (!activeTask || (activeTask.status !== 'RUNNING' && activeTask.status !== 'PENDING')) {
      setError('Kein aktiver Schritt zum Überspringen vorhanden.');
      return;
    }
    await handleRecoveryAction(activeTask, 'skip');
  };

  const handleEndWorkflow = async () => {
    if (!workflow) return;
    if (!window.confirm('Workflow wirklich manuell beenden? Laufende/ausstehende Schritte werden übersprungen.')) {
      return;
    }
    const reason = window.prompt('Optionaler Grund für das manuelle Beenden:')?.trim() || '';

    setIsEndingWorkflow(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.post(`/api/admin/workflows/${workflow.id}/end`, reason ? { reason } : {}, { headers });
      setSuccessMessage('Workflow manuell beendet');
      setTimeout(() => setSuccessMessage(''), 3000);
      await loadTicketDetails({ showLoading: false });
      setIsWorkflowExpanded(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Workflow konnte nicht beendet werden');
    } finally {
      setIsEndingWorkflow(false);
    }
  };

  const handlePauseTicket = async () => {
    if (!ticket || ticket.status === 'pending') return;
    if (!window.confirm('Ticket wirklich pausieren? Der Status wird auf "Ausstehend" gesetzt.')) return;
    setIsPausingTicket(true);
    try {
      await handleUpdateStatus('pending');
    } finally {
      setIsPausingTicket(false);
    }
  };

  const handleRefreshWorkflowView = async () => {
    if (!id || isLiveRefreshing) return;
    setError('');
    setIsLiveRefreshing(true);
    try {
      await loadTicketDetails({ showLoading: false, lightweight: true });
      const nowIso = new Date().toISOString();
      setLiveLastSyncAt(nowIso);
      setLiveConnectionState('live');
      setTimerNowMs(Date.now());
    } catch {
      setLiveConnectionState('reconnecting');
    } finally {
      setIsLiveRefreshing(false);
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
      if (!context) throw new Error('Canvas-Kontext konnte nicht erstellt werden.');
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

  const handlePrintWorkflowOverviewAsPdf = async () => {
    if (!workflowVisualSvgRef.current || !workflow || !ticket) {
      setError('Keine grafische Workflowübersicht zum Export verfügbar.');
      return;
    }

    try {
      const rasterized = await rasterizeSvgToJpeg(workflowVisualSvgRef.current);
      const pdfBlob = createPdfBlobFromJpeg(
        rasterized.jpegBytes,
        rasterized.width,
        rasterized.height
      );
      const downloadUrl = window.URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      const fileBase = `ticket-${ticket.id.substring(0, 8)}-dtpn`;
      link.href = downloadUrl;
      link.download = `${fileBase}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setSuccessMessage('DTPN-Workflowübersicht als PDF heruntergeladen.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error: any) {
      setError(error?.message || 'PDF-Export fehlgeschlagen.');
    }
  };

  const handleExportTicketAsPdf = async () => {
    if (!ticket) return;
    setError('');
    setIsExportingTicketPdf(true);
    try {
      const workflowForExport =
        workflow && typeof workflow === 'object'
          ? {
              id: workflow.id,
              templateId: workflow.templateId,
              title: workflow.title,
              status: workflow.status,
              executionMode: workflow.executionMode,
              blockedReason: workflow.blockedReason,
              startedAt: workflow.startedAt,
              completedAt: workflow.completedAt,
              currentTaskIndex: workflow.currentTaskIndex,
              tasks: workflow.tasks || [],
              history: Array.isArray(workflow.history) ? workflow.history : [],
            }
          : null;

      await exportSingleTicketPdf(
        {
          ticket: {
            ...ticket,
            comments: ticket.comments || [],
            dataRequests: ticket.dataRequests || [],
            internalTasks: internalTasks || [],
            images: ticket.images || [],
            emailMessages: ticket.emailMessages || [],
            nominatimRaw: ticket.nominatimRaw || null,
            weatherReport: ticket.weatherReport || null,
          },
          workflow: workflowForExport,
        },
        {
          reportTitle: `Ticket-Auszug ${ticket.id.substring(0, 8)}`,
          subtitle: 'DIN A4 Hochformat · Ticketdetails inkl. Workflow-/Fragen-/Kommentarjournal',
          generatedBy: 'Admin-Frontend',
        }
      );
      setSuccessMessage('Ticket-Auszug als PDF erstellt.');
      setTimeout(() => setSuccessMessage(''), 3200);
    } catch (err: any) {
      setError(err?.message || 'Ticket-PDF konnte nicht erstellt werden.');
    } finally {
      setIsExportingTicketPdf(false);
    }
  };

  const handleCopyAddress = async () => {
    if (!ticket) return;
    const addressValue = [ticket.address, ticket.postalCode, ticket.city].filter(Boolean).join(', ');
    if (!addressValue.trim()) {
      setError('Keine Adresse zum Kopieren vorhanden.');
      return;
    }

    try {
      const copied = await copyTextToClipboard(addressValue);
      if (!copied) {
        setError('Adresse konnte nicht in die Zwischenablage kopiert werden.');
        return;
      }
      setSuccessMessage('Adresse in Zwischenablage kopiert.');
      setTimeout(() => setSuccessMessage(''), 2200);
    } catch {
      setError('Adresse konnte nicht in die Zwischenablage kopiert werden.');
    }
  };

  const handleCopyOpsTicketLink = async () => {
    if (!ticketOpsDeepLink) {
      setError('Kein Ticket-Link verfügbar.');
      return;
    }

    try {
      const copied = await copyTextToClipboard(ticketOpsDeepLink);
      if (!copied) {
        setError('Ticket-Link konnte nicht in die Zwischenablage kopiert werden.');
        return;
      }
      setSuccessMessage('Ticket-Link in Zwischenablage kopiert.');
      setTimeout(() => setSuccessMessage(''), 2200);
    } catch {
      setError('Ticket-Link konnte nicht in die Zwischenablage kopiert werden.');
    }
  };

  const handleRefreshGeoWeather = async () => {
    if (!id) return;
    setIsRefreshingGeoWeather(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(`/api/admin/tickets/${id}/geo-weather/refresh`, {}, { headers });
      await loadTicketDetails({ showLoading: false, lightweight: true });
      const successText =
        typeof response.data?.message === 'string' && response.data.message.trim()
          ? response.data.message
          : 'Nominatim- und Wetterdaten wurden aktualisiert.';
      setSuccessMessage(successText);
      setTimeout(() => setSuccessMessage(''), 2800);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Geo-/Wetterdaten konnten nicht aktualisiert werden.');
    } finally {
      setIsRefreshingGeoWeather(false);
    }
  };

  const handleCreateComment = async () => {
    if (!id) return;
    const content = commentDraft.trim();
    if (!content) {
      setError('Bitte Kommentartext eingeben.');
      return;
    }
    setIsCommentSubmitting(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(
        `/api/tickets/${id}/comments`,
        {
          content,
          visibility: commentVisibility,
          commentType,
        },
        { headers }
      );
      const created = normalizeTicketComments([response.data])[0];
      if (created) {
        setTicketComments((prev) =>
          [...prev, created].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        );
      }
      setCommentDraft('');
      setCommentVisibility('internal');
      setCommentType('note');
      setSuccessMessage('Kommentar gespeichert.');
      setTimeout(() => setSuccessMessage(''), 2500);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Kommentar konnte nicht gespeichert werden.');
    } finally {
      setIsCommentSubmitting(false);
    }
  };

  const startCommentEdit = (comment: TicketComment) => {
    setEditingCommentId(comment.id);
    setEditingCommentDraft(comment.content);
    setEditingCommentVisibility(comment.visibility);
  };

  const cancelCommentEdit = () => {
    setEditingCommentId(null);
    setEditingCommentDraft('');
    setEditingCommentVisibility('internal');
    setEditingCommentSaving(false);
  };

  const handleSaveCommentEdit = async (comment: TicketComment) => {
    if (!id) return;
    const content = editingCommentDraft.trim();
    if (!content) {
      setError('Kommentar darf nicht leer sein.');
      return;
    }
    setEditingCommentSaving(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.patch(
        `/api/tickets/${id}/comments/${comment.id}`,
        {
          content,
          visibility: editingCommentVisibility,
        },
        { headers }
      );
      const updated = normalizeTicketComments([response.data])[0];
      if (updated) {
        setTicketComments((prev) => prev.map((item) => (item.id === comment.id ? updated : item)));
      }
      cancelCommentEdit();
      setSuccessMessage('Kommentar aktualisiert.');
      setTimeout(() => setSuccessMessage(''), 2500);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Kommentar konnte nicht aktualisiert werden.');
    } finally {
      setEditingCommentSaving(false);
    }
  };

  const handlePreviewCategorization = async () => {
    if (!id) return;
    setClassificationLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(
        `/api/admin/workflows/ticket/${id}/categorization/preview`,
        {},
        { headers }
      );
      const suggestion = response.data?.suggestion || null;
      if (!suggestion || !suggestion.category) {
        throw new Error('Kein verwertbarer Kategorisierungsvorschlag erhalten.');
      }
      setClassificationPreview({
        suggestion: {
          category: String(suggestion.category || ''),
          priority: String(suggestion.priority || 'medium'),
          reasoning: String(suggestion.reasoning || ''),
          categoryId: String(suggestion.categoryId || ''),
        },
        rawDecision: response.data?.rawDecision || null,
        knowledgeVersion: response.data?.knowledgeVersion || null,
        categoryWorkflowTemplateId: response.data?.categoryWorkflowTemplateId || null,
      });
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Klassifizierungs-Vorschlag fehlgeschlagen.');
    } finally {
      setClassificationLoading(false);
    }
  };

  const handleCommitCategorization = async () => {
    if (!id || !classificationPreview) return;
    setClassificationCommitting(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(
        `/api/admin/workflows/ticket/${id}/categorization/commit`,
        {
          suggestion: classificationPreview.suggestion,
          rawDecision: classificationPreview.rawDecision,
          knowledgeVersion: classificationPreview.knowledgeVersion,
          startCategoryWorkflow: true,
          replaceActiveWorkflows: true,
        },
        { headers }
      );
      setSuccessMessage(
        response.data?.message || 'Klassifizierung übernommen und Kategorie-Workflow gestartet.'
      );
      setTimeout(() => setSuccessMessage(''), 3500);
      await loadTicketDetails({ showLoading: false });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Klassifizierung konnte nicht übernommen werden.');
    } finally {
      setClassificationCommitting(false);
    }
  };

  const handlePreviewResponsibility = async () => {
    if (!id) return;
    setResponsibilityLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(
        `/api/admin/workflows/ticket/${id}/responsibility/preview`,
        {},
        { headers }
      );
      const suggestion = response.data?.suggestion || null;
      if (!suggestion || !suggestion.responsibilityAuthority) {
        throw new Error('Kein verwertbarer Zuständigkeitsvorschlag erhalten.');
      }
      const allowedAuthorities = mergeOptionLists(
        DEFAULT_RESPONSIBILITY_AUTHORITIES,
        responsibilityAuthorityOptions,
        response.data?.allowedAuthorities,
        [ticket?.responsibilityAuthority, suggestion.responsibilityAuthority]
      );
      if (allowedAuthorities.length > 0) {
        setResponsibilityAuthorityOptions(allowedAuthorities);
      }
      setResponsibilityPreview({
        suggestion: {
          responsibilityAuthority: String(suggestion.responsibilityAuthority || ''),
          reasoning: String(suggestion.reasoning || ''),
          confidence:
            Number.isFinite(Number(suggestion.confidence))
              ? Math.max(0, Math.min(1, Number(suggestion.confidence)))
              : null,
          legalBasis: normalizeOptionList(suggestion.legalBasis),
          notes: normalizeOptionList(suggestion.notes),
        },
        rawDecision: response.data?.rawDecision || null,
        allowedAuthorities,
      });
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Zuständigkeits-Vorschlag fehlgeschlagen.');
    } finally {
      setResponsibilityLoading(false);
    }
  };

  const handleCommitResponsibility = async () => {
    if (!id || !responsibilityPreview) return;
    const selectedAuthority = String(responsibilityPreview.suggestion.responsibilityAuthority || '').trim();
    if (!selectedAuthority) {
      setError('Bitte einen gültigen Zuständigkeitswert auswählen.');
      return;
    }
    setResponsibilityCommitting(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(
        `/api/admin/workflows/ticket/${id}/responsibility/commit`,
        {
          suggestion: {
            ...responsibilityPreview.suggestion,
            responsibilityAuthority: selectedAuthority,
          },
          allowedAuthorities: responsibilityPreview.allowedAuthorities || responsibilityAuthorityOptions,
          addAiComment: true,
          commentVisibility: 'internal',
        },
        { headers }
      );
      const appliedAuthority =
        String(response.data?.applied?.responsibilityAuthority || selectedAuthority).trim() || selectedAuthority;
      setSuccessMessage(response.data?.message || 'Zuständigkeit übernommen.');
      setTimeout(() => setSuccessMessage(''), 3200);
      setResponsibilityPreview((prev) =>
        prev
          ? {
              ...prev,
              suggestion: {
                ...prev.suggestion,
                responsibilityAuthority: appliedAuthority,
              },
            }
          : prev
      );
      setTicket((prev) => (prev ? { ...prev, responsibilityAuthority: appliedAuthority } : prev));
      await loadTicketDetails({ showLoading: false, lightweight: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Zuständigkeit konnte nicht übernommen werden.');
    } finally {
      setResponsibilityCommitting(false);
    }
  };

  if (isLoading) return <div className="loading">Lädt...</div>;
  if (!ticket) return <div className="error-message">Ticket nicht gefunden</div>;

  const statusOptions = ['pending_validation', 'pending', 'open', 'assigned', 'in-progress', 'completed', 'closed'];
  const responsibilityOptionsForSelect = mergeOptionLists(
    responsibilityAuthorityOptions,
    responsibilityPreview?.allowedAuthorities,
    [ticket.responsibilityAuthority, editDraft.responsibilityAuthority]
  );
  const ticketCollaborators = Array.isArray(ticket.collaborators) ? ticket.collaborators : [];
  const primaryAssigneeUserLabel =
    String(ticket.primaryAssigneeUserName || '').trim() ||
    String(ticket.primaryAssigneeUserId || '').trim() ||
    '';
  const primaryAssigneeOrgLabel =
    String(ticket.primaryAssigneeOrgUnitName || '').trim() ||
    String(ticket.primaryAssigneeOrgUnitId || '').trim() ||
    '';
  const owningOrgLabel =
    String(ticket.owningOrgUnitName || '').trim() ||
    String(ticket.owningOrgUnitId || '').trim() ||
    '';
  const tenantLabel =
    String(ticket.tenantName || '').trim() ||
    String(ticket.tenantId || '').trim() ||
    '';
  const hasStructuredAssignment =
    !!primaryAssigneeUserLabel ||
    !!primaryAssigneeOrgLabel ||
    !!owningOrgLabel ||
    ticketCollaborators.length > 0;
  const collaboratorBadges = ticketCollaborators.map((entry) => {
    const userLabel = String(entry.userName || '').trim() || String(entry.userId || '').trim();
    const orgLabel = String(entry.orgUnitName || '').trim() || String(entry.orgUnitId || '').trim();
    const label = [userLabel, orgLabel].filter(Boolean).join(' · ') || entry.id;
    return {
      key: entry.id,
      label,
      isUser: !!userLabel,
      isOrg: !!orgLabel,
    };
  });
  const activeWorkflowTasks = workflow ? getActiveWorkflowTasks(workflow) : [];
  const activeTaskIdSet = new Set(activeWorkflowTasks.map((task) => task.id));
  const currentTask = workflow ? getCurrentWorkflowTask(workflow) : null;
  const currentSkippableTask =
    currentTask && (currentTask.status === 'RUNNING' || currentTask.status === 'PENDING')
      ? currentTask
      : null;
  const canSkipCurrentWorkflowTask = !!currentSkippableTask;
  const isCurrentSkipLoading = !!(currentSkippableTask && recoveryLoadingByTask[currentSkippableTask.id]);
  const pendingManualTasks = workflow ? getPendingManualWorkflowTasks(workflow) : [];
  const workflowTasksOrdered = workflow ? [...workflow.tasks].sort((a, b) => a.order - b.order) : [];
  const workflowTotalTasks = workflowTasksOrdered.length;
  const workflowCompletedTasks = workflowTasksOrdered.filter((task) => task.status === 'COMPLETED').length;
  const workflowSettledTasks = workflowTasksOrdered.filter(
    (task) => task.status === 'COMPLETED' || task.status === 'SKIPPED'
  ).length;
  const workflowTaskStatusCounts = workflowTasksOrdered.reduce(
    (acc, task) => {
      acc[task.status] += 1;
      return acc;
    },
    {
      PENDING: 0,
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      SKIPPED: 0,
    } as Record<WorkflowTask['status'], number>
  );
  const workflowPendingApprovals = pendingManualTasks.length;
  const workflowProgressPercent =
    workflowTotalTasks > 0
      ? Math.min(100, Math.round((workflowSettledTasks / workflowTotalTasks) * 100))
      : 0;
  const hasActiveWorkflow = workflow?.status === 'RUNNING' || workflow?.status === 'PAUSED';
  const getTaskTimerLabel = (task: WorkflowTask | null | undefined): string | null => {
    if (!task || task.status !== 'RUNNING') return null;
    const awaitingUntilMs = parseTaskAwaitingUntilMs(task);
    if (awaitingUntilMs === null) return null;
    return formatTimerCountdown(awaitingUntilMs, timerNowMs);
  };
  const runningTimerTasks = workflow
    ? workflow.tasks
        .filter((task) => task.status === 'RUNNING')
        .map((task) => {
          const awaitingUntilMs = parseTaskAwaitingUntilMs(task);
          return awaitingUntilMs === null
            ? null
            : {
                task,
                awaitingUntilMs,
                countdown: formatTimerCountdown(awaitingUntilMs, timerNowMs),
              };
        })
        .filter(
          (
            item
          ): item is {
            task: WorkflowTask;
            awaitingUntilMs: number;
            countdown: string;
          } => item !== null
        )
        .sort((a, b) => a.awaitingUntilMs - b.awaitingUntilMs)
    : [];
  const primaryTimer = runningTimerTasks[0] || null;
  const workflowTimerSummary = primaryTimer
    ? `${primaryTimer.countdown}${runningTimerTasks.length > 1 ? ` · +${runningTimerTasks.length - 1}` : ''}`
    : '';
  const currentTaskTimerLabel = getTaskTimerLabel(currentTask);
  const priorityLabels: Record<string, string> = {
    low: 'Niedrig',
    medium: 'Mittel',
    high: 'Hoch',
    critical: 'Kritisch',
  };
  const statusLabels: Record<Ticket['status'], string> = {
    pending_validation: 'Validierung ausstehend',
    pending: 'Ausstehend',
    open: 'Offen',
    assigned: 'Zugewiesen',
    'in-progress': 'In Bearbeitung',
    completed: 'Abgeschlossen',
    closed: 'Geschlossen',
  };
  const ticketImages = Array.isArray(ticket.images) ? ticket.images : [];
  const availableCommentTypes = Array.from(
    new Set(
      ticketComments
        .map((entry) => String(entry.commentType || '').trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
  const isCommentTypeFilterActive = commentTypeFilters.length > 0;
  const filteredTicketComments = ticketComments.filter(
    (comment) => {
      if (commentFilter !== 'all' && comment.visibility !== commentFilter) return false;
      if (
        isCommentTypeFilterActive &&
        !commentTypeFilters.includes(String(comment.commentType || '').trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    }
  );
  const commentCounterLabel =
    commentFilter === 'all'
      ? `${filteredTicketComments.length}/${ticketComments.length} gesamt`
      : `${filteredTicketComments.length} ${commentFilter === 'public' ? 'öffentlich' : 'intern'}`;
  const activeImage =
    activeImageIndex !== null && activeImageIndex >= 0 && activeImageIndex < ticketImages.length
      ? ticketImages[activeImageIndex]
      : null;
  const dialogImage = imageAnalyzeDialog
    ? ticketImages.find((image) => image.id === imageAnalyzeDialog.imageId) || null
    : null;
  const isImageAnalyzeDialogBusy = !!(
    imageAnalyzeDialog && imageAnalysisBusyById[imageAnalyzeDialog.imageId]
  );
  const showImageNav = ticketImages.length > 1;
  const locationSummary = [ticket.address, ticket.postalCode, ticket.city].filter(Boolean).join(', ');
  const ticketIdentifier = String(ticket.id || id || '').trim();
  const ticketOpsDeepLink = ticketIdentifier
    ? `${window.location.origin}/ops/tickets/${encodeURIComponent(ticketIdentifier)}`
    : '';
  const ticketQrCodeImageUrl = ticketOpsDeepLink
    ? `https://quickchart.io/qr?size=320x320&ecLevel=M&margin=1&text=${encodeURIComponent(ticketOpsDeepLink)}`
    : '';
  const ticketEmailMessages = Array.isArray(ticket.emailMessages) ? ticket.emailMessages : [];
  const hasReporterPseudonym = [
    ticket.reporterPseudoName,
    ticket.reporterPseudoFirstName,
    ticket.reporterPseudoLastName,
    ticket.reporterPseudoEmail,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
  const ticketDataRequests = Array.isArray(ticket.dataRequests) ? ticket.dataRequests : [];
  const internalTaskStatusLabelMap: Record<string, string> = {
    pending: 'Ausstehend',
    in_progress: 'In Bearbeitung',
    completed: 'Abgeschlossen',
    rejected: 'Zurückgewiesen',
    cancelled: 'Abgebrochen',
  };
  const internalTaskResults = [...internalTasks]
    .filter((task) => {
      if (task.status === 'completed' || task.status === 'rejected' || task.status === 'cancelled') return true;
      if (!task.response || typeof task.response !== 'object' || Array.isArray(task.response)) return false;
      return Object.values(task.response).some((value) => hasInternalTaskResponseValue(value));
    })
    .sort((a, b) => {
      const aTime = Date.parse(String(a.completedAt || a.createdAt || ''));
      const bTime = Date.parse(String(b.completedAt || b.createdAt || ''));
      const aSafe = Number.isFinite(aTime) ? aTime : 0;
      const bSafe = Number.isFinite(bTime) ? bTime : 0;
      return bSafe - aSafe;
    });
  const workflowDataRequestsByTaskId = ticketDataRequests.reduce<Record<string, TicketDataRequest[]>>((acc, request) => {
    const taskId = typeof request.taskId === 'string' ? request.taskId.trim() : '';
    if (!taskId) return acc;
    if (!acc[taskId]) {
      acc[taskId] = [];
    }
    acc[taskId].push(request);
    return acc;
  }, {});
  Object.values(workflowDataRequestsByTaskId).forEach((entries) => {
    entries.sort((a, b) => {
      const aCycle = Number.isFinite(Number(a.cycle)) ? Number(a.cycle) : null;
      const bCycle = Number.isFinite(Number(b.cycle)) ? Number(b.cycle) : null;
      if (aCycle !== null && bCycle !== null && aCycle !== bCycle) {
        return aCycle - bCycle;
      }
      const aTs = Date.parse(String(a.createdAt || ''));
      const bTs = Date.parse(String(b.createdAt || ''));
      const aSafe = Number.isFinite(aTs) ? aTs : 0;
      const bSafe = Number.isFinite(bTs) ? bTs : 0;
      return aSafe - bSafe;
    });
  });
  const workflowStatusLabelMap: Record<WorkflowExecution['status'], string> = {
    RUNNING: 'Läuft',
    PAUSED: 'Pausiert',
    COMPLETED: 'Abgeschlossen',
    FAILED: 'Fehler',
  };
  const workflowStatusIconMap: Record<WorkflowExecution['status'], string> = {
    RUNNING: 'fa-solid fa-play',
    PAUSED: 'fa-solid fa-pause',
    COMPLETED: 'fa-solid fa-check',
    FAILED: 'fa-solid fa-xmark',
  };
  const workflowSlaState = workflow?.health?.slaState || 'ok';
  const workflowSlaLabel = WORKFLOW_SLA_LABELS[workflowSlaState as 'ok' | 'risk' | 'overdue'] || WORKFLOW_SLA_LABELS.ok;
  const workflowBlockedReason = workflow?.blockedReason || 'none';
  const workflowBlockedReasonLabel =
    WORKFLOW_BLOCKED_REASON_LABELS[workflowBlockedReason] || workflowBlockedReason;
  const failedWorkflowTasks = workflow
    ? workflow.tasks.filter((task) => task.status === 'FAILED')
    : [];
  const workflowCurrentTaskSummary = currentTask?.title || 'Kein aktiver Schritt';
  const workflowTaskStatusLabelMap: Record<WorkflowTask['status'], string> = {
    PENDING: 'Ausstehend',
    RUNNING: 'Läuft',
    COMPLETED: 'Abgeschlossen',
    FAILED: 'Fehler',
    SKIPPED: 'Übersprungen',
  };
  const liveConnectionLabel =
    liveConnectionState === 'reconnecting' ? 'Verbindung wird hergestellt…' : 'Live verbunden';
  const workflowGraph = (() => {
    if (!workflow || !Array.isArray(workflow.tasks) || workflow.tasks.length === 0) return null;
    const tasks = [...workflow.tasks].sort((a, b) => a.order - b.order);
    const idToIndex = new Map(tasks.map((task, index) => [task.id, index]));
    const edges: TicketWorkflowGraphEdge[] = [];
    const pushEdge = (
      from: string,
      to: string,
      kind: TicketWorkflowEdgeKind,
      label?: string
    ) => {
      if (!to || from === to) return;
      if (!idToIndex.has(to)) return;
      const edgeId = `${from}:${to}:${kind}:${label || ''}`;
      if (edges.some((edge) => edge.id === edgeId)) return;
      edges.push({ id: edgeId, from, to, kind, label });
    };

    tasks.forEach((task, index) => {
      const config = task.config || {};
      const explicitNext =
        normalizeTaskRef(config.nextTaskId) ||
        normalizeTaskRefList(config.nextTaskIds).find((id) => idToIndex.has(id)) ||
        '';
      const defaultNext = explicitNext || tasks[index + 1]?.id || '';
      if (task.type === 'END') return;

      if (task.type === 'SPLIT') {
        const explicitTargets = [
          normalizeTaskRef(config.leftNextTaskId),
          normalizeTaskRef(config.rightNextTaskId),
          ...normalizeTaskRefList(config.nextTaskIds),
        ]
          .filter((id, position, list) => !!id && list.indexOf(id) === position && idToIndex.has(id))
          .slice(0, 2);
        const automaticTargets = tasks
          .slice(index + 1, index + 3)
          .map((candidate) => candidate.id)
          .filter((id) => idToIndex.has(id));
        const targets = explicitTargets.length > 0 ? explicitTargets : automaticTargets;
        targets.forEach((targetId, targetIndex) => {
          pushEdge(task.id, targetId, 'split', targetIndex === 0 ? 'Pfad A' : 'Pfad B');
        });
        return;
      }

      if (task.type === 'IF') {
        const trueTargets = [
          normalizeTaskRef(config.trueNextTaskId),
          ...normalizeTaskRefList(config.trueNextTaskIds),
        ].filter((id, position, list) => !!id && list.indexOf(id) === position && idToIndex.has(id));
        const falseTargets = [
          normalizeTaskRef(config.falseNextTaskId),
          ...normalizeTaskRefList(config.falseNextTaskIds),
        ].filter((id, position, list) => !!id && list.indexOf(id) === position && idToIndex.has(id));

        if (trueTargets.length > 0) {
          trueTargets.forEach((targetId) => pushEdge(task.id, targetId, 'if_true', 'TRUE'));
        } else if (defaultNext) {
          pushEdge(task.id, defaultNext, 'if_true', 'TRUE');
        }
        falseTargets.forEach((targetId) => pushEdge(task.id, targetId, 'if_false', 'FALSE'));
        return;
      }

      if (
        task.type === 'EMAIL_CONFIRMATION' ||
        task.type === 'EMAIL_DOUBLE_OPT_IN' ||
        task.type === 'MAYOR_INVOLVEMENT' ||
        task.type === 'DATENNACHFORDERUNG' ||
        task.type === 'ENHANCED_CATEGORIZATION' ||
        task.type === 'FREE_AI_DATA_REQUEST'
      ) {
        const rejectTargets = [
          normalizeTaskRef(config.rejectNextTaskId),
          ...normalizeTaskRefList(config.rejectNextTaskIds),
        ].filter((targetId, position, list) => !!targetId && list.indexOf(targetId) === position && idToIndex.has(targetId));
        rejectTargets.forEach((targetId) =>
          pushEdge(
            task.id,
            targetId,
            'confirm_reject',
            task.type === 'DATENNACHFORDERUNG' ||
            task.type === 'ENHANCED_CATEGORIZATION' ||
            task.type === 'FREE_AI_DATA_REQUEST'
              ? 'TIMEOUT'
              : 'ABLEHNUNG'
          )
        );
      }

      if (defaultNext) {
        pushEdge(task.id, defaultNext, 'default');
      }
    });

    if (tasks[0]) {
      pushEdge('__start__', tasks[0].id, 'default', 'START');
    }

    const laneByTask = new Map<string, number>();
    if (tasks[0]) laneByTask.set(tasks[0].id, 0);
    tasks.forEach((task) => {
      if (!laneByTask.has(task.id)) laneByTask.set(task.id, 0);
      const sourceLane = laneByTask.get(task.id) || 0;
      const outgoing = edges.filter((edge) => edge.from === task.id);
      if (outgoing.length === 1) {
        if (!laneByTask.has(outgoing[0].to)) laneByTask.set(outgoing[0].to, sourceLane);
      } else if (outgoing.length > 1) {
        const spread = outgoing.length - 1;
        outgoing.forEach((edge, edgeIndex) => {
          if (!laneByTask.has(edge.to)) {
            laneByTask.set(edge.to, sourceLane + edgeIndex - spread / 2);
          }
        });
      }
    });

    tasks.forEach((task) => {
      if (laneByTask.has(task.id)) return;
      const incomingLanes = edges
        .filter((edge) => edge.to === task.id)
        .map((edge) => laneByTask.get(edge.from))
        .filter((lane): lane is number => typeof lane === 'number');
      laneByTask.set(
        task.id,
        incomingLanes.length > 0
          ? incomingLanes.reduce((sum, lane) => sum + lane, 0) / incomingLanes.length
          : 0
      );
    });

    const laneValues = tasks.map((task) => laneByTask.get(task.id) || 0);
    const minLane = laneValues.length > 0 ? Math.min(...laneValues) : 0;
    const maxLane = laneValues.length > 0 ? Math.max(...laneValues) : 0;
    const nodeWidth = 200;
    const nodeHeight = 70;
    const diamondSize = 64;
    const laneGap = 220;
    const rowGap = 118;
    const marginX = 58;
    const marginY = 24;
    const startRadius = 18;
    const endRadius = 24;
    const width = Math.max(560, marginX * 2 + (maxLane - minLane + 1) * laneGap + nodeWidth);
    const height = Math.max(260, marginY * 2 + 66 + tasks.length * rowGap);

    const nodes: TicketWorkflowGraphNode[] = tasks.map((task, index) => {
      const lane = laneByTask.get(task.id) || 0;
      const shape: TicketWorkflowNodeShape =
        task.type === 'END' ? 'circle' : task.type === 'JOIN' ? 'diamond' : 'rect';
      return {
        id: task.id,
        taskId: task.id,
        title: task.title || taskTypeLabels[task.type],
        type: task.type,
        status: task.status,
        shape,
        lane,
        x: marginX + (lane - minLane) * laneGap + nodeWidth / 2,
        y: marginY + 66 + index * rowGap,
      };
    });

    const firstLane = tasks[0] ? laneByTask.get(tasks[0].id) || 0 : 0;
    const startNode: TicketWorkflowGraphNode = {
      id: '__start__',
      title: 'Start',
      type: 'START',
      shape: 'circle',
      lane: firstLane,
      x: marginX + (firstLane - minLane) * laneGap + nodeWidth / 2,
      y: marginY + 18,
    };
    const graphNodes = [startNode, ...nodes];
    const nodeById = new Map(graphNodes.map((node) => [node.id, node]));

    return {
      nodes: graphNodes,
      edges,
      nodeById,
      width,
      height,
      nodeWidth,
      nodeHeight,
      diamondSize,
      startRadius,
      endRadius,
    };
  })();

  const resolveWorkflowOutputAnchor = (
    node: TicketWorkflowGraphNode,
    edge: TicketWorkflowGraphEdge
  ): { x: number; y: number } => {
    if (node.type === 'START') return { x: node.x, y: node.y + 18 };
    if (node.shape === 'circle') return { x: node.x, y: node.y + 24 };
    if (node.shape === 'diamond') return { x: node.x, y: node.y + 32 };
    const baseY = node.y + 35;
    if (edge.kind === 'split' || edge.kind === 'if_true') return { x: node.x - 42, y: baseY };
    if (edge.kind === 'if_false') return { x: node.x + 42, y: baseY };
    return { x: node.x, y: baseY };
  };

  const resolveWorkflowInputAnchor = (node: TicketWorkflowGraphNode): { x: number; y: number } => {
    if (node.shape === 'circle') return { x: node.x, y: node.y - 24 };
    if (node.shape === 'diamond') return { x: node.x, y: node.y - 32 };
    return { x: node.x, y: node.y - 35 };
  };

  const buildWorkflowConnectorPath = (
    start: { x: number; y: number },
    end: { x: number; y: number }
  ) => {
    if (Math.abs(start.x - end.x) < 3) {
      return {
        d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
        labelX: start.x,
        labelY: (start.y + end.y) / 2 - 7,
      };
    }
    const direction = end.y >= start.y ? 1 : -1;
    const clearance = Math.max(16, Math.min(38, Math.abs(end.y - start.y) * 0.34));
    const midpointY = start.y + direction * clearance;
    return {
      d: `M ${start.x} ${start.y} L ${start.x} ${midpointY} L ${end.x} ${midpointY} L ${end.x} ${end.y}`,
      labelX: (start.x + end.x) / 2,
      labelY: midpointY - 7,
    };
  };

  return (
    <div className="ticket-detail">
      <button onClick={() => navigate(-1)} className="back-btn">
        <i className="fa-solid fa-arrow-left" /> Zurück
      </button>

      <div className="ticket-header">
        <div>
          <h2>Ticket {ticket.id.substring(0, 8)}</h2>
          <p className="submission-ref">Meldung: {ticket.submissionId.substring(0, 8)}</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="workflow-visual-print-btn"
            onClick={handleExportTicketAsPdf}
            disabled={isExportingTicketPdf}
            title="Ticket-Auszug als PDF herunterladen"
          >
            {isExportingTicketPdf ? (
              <>
                <i className="fa-solid fa-spinner fa-spin" /> Export...
              </>
            ) : (
              <>
                <i className="fa-solid fa-file-pdf" /> Ticket-PDF
              </>
            )}
          </button>
          <span
            className="priority-badge"
            style={{
              backgroundColor:
                ticket.priority === 'critical'
                  ? '#dc3545'
                  : ticket.priority === 'high'
                  ? '#fd7e14'
                  : ticket.priority === 'medium'
                  ? '#ffc107'
                  : '#28a745',
            }}
          >
            {ticket.priority.toUpperCase()}
          </span>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="workflow-selector-card">
        <div className="workflow-selector-header">
          <h3>
            <i className="fa-solid fa-play" /> Workflow starten
          </h3>
          <span className={`task-chip ${hasActiveWorkflow ? 'status-running' : 'status-completed'}`}>
            {hasActiveWorkflow ? (
              <>
                <i className="fa-solid fa-arrows-rotate" /> Aktiv: {workflow?.status}
              </>
            ) : (
              <>
                <i className="fa-solid fa-check" /> Kein aktiver Workflow
              </>
            )}
          </span>
        </div>
        <select
          className="workflow-selector-select"
          value={selectedWorkflowTemplateId}
          onChange={(event) => setSelectedWorkflowTemplateId(event.target.value)}
        >
          <option value="">Automatische Vorlagenauswahl (Kategorie/Standard)</option>
          {workflowTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <div className="workflow-selector-actions">
          <button
            className="workflow-attach-btn"
            type="button"
            onClick={handleStartWorkflow}
            disabled={isStartingWorkflow || hasActiveWorkflow}
            title={hasActiveWorkflow ? 'Es läuft bereits ein aktiver Workflow für dieses Ticket.' : ''}
          >
            {isStartingWorkflow ? (
              <>
                <i className="fa-solid fa-spinner fa-spin" /> Workflow wird gestartet...
              </>
            ) : (
              <>
                <i className="fa-solid fa-play" /> Workflow starten
              </>
            )}
          </button>
          {workflow && (
            <>
              <button
                className="workflow-attach-btn secondary"
                type="button"
                onClick={handleOpenWorkflowDetailView}
              >
                <i className="fa-solid fa-diagram-project" /> Workflow-Detailansicht
              </button>
              <button
                className="workflow-attach-btn warning"
                type="button"
                onClick={handleSkipCurrentWorkflowTask}
                disabled={!canSkipCurrentWorkflowTask || isCurrentSkipLoading || isEndingWorkflow}
                title={
                  canSkipCurrentWorkflowTask
                    ? 'Aktuellen Workflow-Schritt überspringen'
                    : 'Kein aktiver Workflow-Schritt zum Überspringen'
                }
              >
                {isCurrentSkipLoading ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Skip läuft...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-forward" /> Schritt skippen
                  </>
                )}
              </button>
              <button
                className="workflow-attach-btn secondary"
                type="button"
                onClick={handlePauseTicket}
                disabled={ticket.status === 'pending' || isPausingTicket || isSaving}
                title={ticket.status === 'pending' ? 'Ticket ist bereits pausiert.' : 'Ticket auf Ausstehend setzen'}
              >
                {isPausingTicket ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Pausiere...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-pause" /> Ticket pausieren
                  </>
                )}
              </button>
              <button
                className="workflow-attach-btn danger"
                type="button"
                onClick={handleEndWorkflow}
                disabled={isEndingWorkflow || workflow.status === 'COMPLETED' || workflow.status === 'FAILED'}
                title={
                  workflow.status === 'COMPLETED' || workflow.status === 'FAILED'
                    ? 'Workflow ist bereits beendet.'
                    : 'Workflow manuell beenden'
                }
              >
                {isEndingWorkflow ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Beende...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-circle-stop" /> Workflow beenden
                  </>
                )}
              </button>
            </>
          )}
        </div>
        <p className="setting-help">
          {hasActiveWorkflow
            ? 'Aktiver Workflow läuft bereits. Start ist erst nach Abschluss oder Fehler wieder möglich.'
            : 'Wahlweise eine feste Vorlage starten oder automatische Vorlagenauswahl verwenden.'}
        </p>
      </div>

      <div className="ticket-overview-strip">
        <div className="ticket-overview-item">
          <span className="ticket-overview-label">Status</span>
          <span className="ticket-overview-value">{statusLabels[ticket.status] || ticket.status}</span>
        </div>
        <div className="ticket-overview-item">
          <span className="ticket-overview-label">Kategorie</span>
          <span className="ticket-overview-value">{ticket.category || '–'}</span>
        </div>
        <div className="ticket-overview-item">
          <span className="ticket-overview-label">Zuständig ist</span>
          <span className="ticket-overview-value">{ticket.responsibilityAuthority || '–'}</span>
        </div>
        <div className="ticket-overview-item">
          <span className="ticket-overview-label">Meldende Person</span>
          <span className="ticket-overview-value">{ticket.citizenName || ticket.citizenEmail || '–'}</span>
        </div>
        <div className="ticket-overview-item">
          <span className="ticket-overview-label">Standort</span>
          <span className="ticket-overview-value">{locationSummary || '–'}</span>
        </div>
        <div className="ticket-overview-item">
          <span className="ticket-overview-label">Workflow</span>
          <span className="ticket-overview-value">
            {workflow
              ? `${workflowStatusLabelMap[workflow.status]} · SLA ${workflowSlaLabel} · ${workflowBlockedReasonLabel} · ${workflowSettledTasks}/${workflowTotalTasks}${
                  primaryTimer ? ` · Timer ${workflowTimerSummary}` : ''
                }`
              : 'Kein Workflow aktiv'}
          </span>
        </div>
      </div>

      {workflow && (
        <div ref={workflowSectionRef} className={`workflow-collapsible status-${workflow.status.toLowerCase()}`}>
          <div
            className="workflow-collapsible-summary"
            onClick={() => setIsWorkflowExpanded((prev) => !prev)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setIsWorkflowExpanded((prev) => !prev);
              }
            }}
            aria-expanded={isWorkflowExpanded}
            role="button"
            tabIndex={0}
          >
            <div className="workflow-summary-main">
              <span className={`status-badge status-${workflow.status.toLowerCase()}`}>
                <i className={workflowStatusIconMap[workflow.status]} /> {workflowStatusLabelMap[workflow.status]}
              </span>
              <span className={`workflow-summary-item workflow-sla ${workflowSlaState}`}>
                <i className="fa-solid fa-gauge-high" /> SLA: {workflowSlaLabel}
              </span>
              <span className="workflow-summary-item">
                <i className="fa-solid fa-circle-info" /> {workflowBlockedReasonLabel}
              </span>
              <span className="workflow-summary-item">
                <i className="fa-solid fa-list-check" /> {workflowSettledTasks}/{workflowTotalTasks} erledigt (
                {workflowProgressPercent}%)
              </span>
              <span className="workflow-summary-item workflow-summary-current-task" title={workflowCurrentTaskSummary}>
                <i className={currentTask ? resolveTaskIconClass(currentTask.type) : 'fa-solid fa-circle'} /> {workflowCurrentTaskSummary}
              </span>
              <span className={`workflow-summary-item ${workflowPendingApprovals > 0 ? 'manual-open' : ''}`}>
                <i className="fa-solid fa-user-check" /> {workflowPendingApprovals} manuelle Freigaben
              </span>
              {primaryTimer && (
                <span className="workflow-summary-item workflow-summary-timer">
                  <i className="fa-solid fa-stopwatch" /> Timer {workflowTimerSummary}
                </span>
              )}
            </div>
            <div className="workflow-summary-side">
              <span
                className={`workflow-live-chip ${liveConnectionState === 'reconnecting' ? 'state-reconnecting' : 'state-live'} ${
                  isLiveRefreshing ? 'is-refreshing' : ''
                }`}
              >
                <i className={`fa-solid ${liveConnectionState === 'reconnecting' ? 'fa-plug-circle-xmark' : 'fa-satellite-dish'}`} />
                {isLiveRefreshing ? 'Aktualisiere…' : liveConnectionLabel}
              </span>
              <span className="workflow-live-time" title={`Letztes Event: ${liveLastEventAt || '–'}`}>
                Event: {formatTimeShort(liveLastEventAt)} · Sync: {formatTimeShort(liveLastSyncAt)}
              </span>
              <button
                type="button"
                className="workflow-summary-refresh-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleRefreshWorkflowView();
                }}
                disabled={isLiveRefreshing}
                title="Workflow-Ansicht jetzt aktualisieren"
              >
                <i className={`fa-solid ${isLiveRefreshing ? 'fa-spinner fa-spin' : 'fa-rotate'}`} /> Jetzt aktualisieren
              </button>
              <span className="workflow-summary-toggle">
                {isWorkflowExpanded ? 'Details ausblenden' : 'Details anzeigen'}
                <i className={`fa-solid ${isWorkflowExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
              </span>
            </div>
          </div>

          {isWorkflowExpanded && (
            <div className={`workflow-status-card status-${workflow.status.toLowerCase()}`}>
              <div className="workflow-card-header">
                <h3>
                  <i className="fa-solid fa-arrows-rotate" /> Workflow in Ausführung
                </h3>
                <span className={`status-badge status-${workflow.status.toLowerCase()}`}>
                  <i className={workflowStatusIconMap[workflow.status]} /> {workflowStatusLabelMap[workflow.status]}
                </span>
              </div>

              <div className="workflow-progress">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${workflowProgressPercent}%`
                    }}
                  />
                </div>
                <small>
                  {workflowSettledTasks}/{workflowTotalTasks} Schritte erledigt ({workflowProgressPercent}%)
                  {workflowCompletedTasks !== workflowSettledTasks
                    ? ` · davon ${workflowCompletedTasks} abgeschlossen`
                    : ''}
                  {activeWorkflowTasks.length > 1 ? ` · ${activeWorkflowTasks.length} aktive Pfade` : ''}
                </small>
              </div>

              <div className="workflow-metadata-grid">
                <div className="workflow-meta-item">
                  <span className="workflow-meta-label">SLA</span>
                  <span className="workflow-meta-value">{workflowSlaLabel}</span>
                </div>
                <div className="workflow-meta-item">
                  <span className="workflow-meta-label">Blocker</span>
                  <span className="workflow-meta-value">{workflowBlockedReasonLabel}</span>
                </div>
                <div className="workflow-meta-item">
                  <span className="workflow-meta-label">Transitionen</span>
                  <span className="workflow-meta-value">{workflow.health?.transitionCount ?? 0}</span>
                </div>
                <div className="workflow-meta-item">
                  <span className="workflow-meta-label">Loop-Guard Trips</span>
                  <span className="workflow-meta-value">{workflow.health?.loopGuardTrips ?? 0}</span>
                </div>
                <div className="workflow-meta-item">
                  <span className="workflow-meta-label">Aktive Schritte</span>
                  <span className="workflow-meta-value">{workflowTaskStatusCounts.RUNNING}</span>
                </div>
                <div className="workflow-meta-item">
                  <span className="workflow-meta-label">Ausstehend</span>
                  <span className="workflow-meta-value">{workflowTaskStatusCounts.PENDING}</span>
                </div>
                <div className="workflow-meta-item">
                  <span className="workflow-meta-label">Fehlgeschlagen</span>
                  <span className="workflow-meta-value">{workflowTaskStatusCounts.FAILED}</span>
                </div>
                <div className="workflow-meta-item">
                  <span className="workflow-meta-label">Letzte Synchronisierung</span>
                  <span className="workflow-meta-value">{formatTimeShort(liveLastSyncAt)}</span>
                </div>
              </div>

              {currentTask && (
                <div className="current-task-box">
                  <h4>Aktuelle Aufgabe</h4>
                  <div className="task-box-content">
                    <span className="task-type-icon">
                      <i className={resolveTaskIconClass(currentTask.type)} />
                    </span>
                    <div className="task-details">
                      <div className="task-title">{currentTask.title}</div>
                      <div className="task-description">
                        {taskTypeLabels[currentTask.type]} · {currentTask.description}
                      </div>
                      {currentTaskTimerLabel && (
                        <div className="task-detail-tags">
                          <span className="task-chip timer-running">
                            <i className="fa-solid fa-stopwatch" /> Restzeit: {currentTaskTimerLabel}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {workflow.status === 'PAUSED' && workflowPendingApprovals > 0 && (
                    <div className="manual-task-controls">
                      <h5>
                        <i className="fa-solid fa-user-check" /> Manuelle Freigaben ({workflowPendingApprovals})
                      </h5>
                      <div className="manual-task-list">
                        {pendingManualTasks.map((task) => {
                          const taskLoading = !!approvalLoadingByTask[task.id];
                          const taskRecoveryLoading = !!recoveryLoadingByTask[task.id];
                          return (
                            <div key={task.id} className="manual-task-item">
                              <div className="manual-task-meta">
                                <span className="task-chip">#{task.order + 1}</span>
                                <span className="task-chip">{taskTypeLabels[task.type]}</span>
                                <strong>{task.title}</strong>
                              </div>
                              <div className="manual-task-actions">
                                <button
                                  className="btn-approve"
                                  type="button"
                                  onClick={() => handleApproveTask(task.id)}
                                  disabled={taskLoading}
                                >
                                  {taskLoading ? (
                                    <>
                                      <i className="fa-solid fa-spinner fa-spin" /> Wird verarbeitet...
                                    </>
                                  ) : (
                                    <>
                                      <i className="fa-solid fa-check" /> Freigeben
                                    </>
                                  )}
                                </button>
                                <button
                                  className="btn-reject"
                                  type="button"
                                  onClick={() => handleRejectTask(task.id)}
                                  disabled={taskLoading || taskRecoveryLoading}
                                >
                                  <i className="fa-solid fa-xmark" /> Ablehnen
                                </button>
                                <button
                                  className="btn-reject"
                                  type="button"
                                  onClick={() => handleRecoveryAction(task, 'skip')}
                                  disabled={taskLoading || taskRecoveryLoading}
                                >
                                  {taskRecoveryLoading ? (
                                    <>
                                      <i className="fa-solid fa-spinner fa-spin" /> Skip...
                                    </>
                                  ) : (
                                    <>
                                      <i className="fa-solid fa-forward" /> Skip
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {failedWorkflowTasks.length > 0 && (
                <div className="manual-task-controls">
                  <h5>
                    <i className="fa-solid fa-triangle-exclamation" /> Recovery ({failedWorkflowTasks.length})
                  </h5>
                  <div className="manual-task-list">
                    {failedWorkflowTasks.map((task) => {
                      const loading = !!recoveryLoadingByTask[task.id];
                      return (
                        <div key={task.id} className="manual-task-item">
                          <div className="manual-task-meta">
                            <span className="task-chip status-failed">FAILED</span>
                            <span className="task-chip">{taskTypeLabels[task.type]}</span>
                            <strong>{task.title}</strong>
                          </div>
                          <div className="manual-task-actions">
                            <button
                              className="btn-approve"
                              type="button"
                              onClick={() => handleRecoveryAction(task, 'retry')}
                              disabled={loading}
                            >
                              {loading ? (
                                <i className="fa-solid fa-spinner fa-spin" />
                              ) : (
                                <i className="fa-solid fa-rotate-right" />
                              )}{' '}
                              Retry
                            </button>
                            <button
                              className="btn-reject"
                              type="button"
                              onClick={() => handleRecoveryAction(task, 'skip')}
                              disabled={loading}
                            >
                              <i className="fa-solid fa-forward" /> Skip mit Grund
                            </button>
                            <button
                              className="btn-approve"
                              type="button"
                              onClick={() => handleRecoveryAction(task, 'resume')}
                              disabled={loading}
                            >
                              <i className="fa-solid fa-user-check" /> Manuell fortsetzen
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {workflowGraph && (
                <div className="workflow-visual-card">
                  <div className="workflow-visual-head">
                    <h4>DTPN-Workflowübersicht</h4>
                    <div className="workflow-visual-head-meta">
                      <span>{workflowGraph.nodes.length} Knoten</span>
                      <button
                        type="button"
                        className="workflow-visual-print-btn"
                        onClick={handlePrintWorkflowOverviewAsPdf}
                        title="DTPN-Übersicht als PDF herunterladen"
                      >
                        <i className="fa-solid fa-file-pdf" /> PDF
                      </button>
                    </div>
                  </div>
                  <div className="workflow-visual-canvas-wrap">
                    <svg
                      ref={workflowVisualSvgRef}
                      className="workflow-visual-canvas"
                      width={workflowGraph.width}
                      height={workflowGraph.height}
                      viewBox={`0 0 ${workflowGraph.width} ${workflowGraph.height}`}
                      role="img"
                      aria-label="Grafische Workflowansicht"
                    >
                      <defs>
                        <pattern id="ticketWorkflowGridPattern" width="28" height="28" patternUnits="userSpaceOnUse">
                          <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#e2e8f0" strokeWidth="1" />
                        </pattern>
                        <marker
                          id="ticketWorkflowArrow"
                          markerWidth="9"
                          markerHeight="8"
                          refX="8"
                          refY="4"
                          orient="auto"
                          markerUnits="strokeWidth"
                        >
                          <path d="M0,0 L9,4 L0,8 z" fill="#64748b" />
                        </marker>
                      </defs>
                      <rect x={0} y={0} width={workflowGraph.width} height={workflowGraph.height} fill="#f8fafc" />
                      <rect
                        x={0}
                        y={0}
                        width={workflowGraph.width}
                        height={workflowGraph.height}
                        fill="url(#ticketWorkflowGridPattern)"
                      />

                      {workflowGraph.edges.map((edge) => {
                        const source = workflowGraph.nodeById.get(edge.from);
                        const target = workflowGraph.nodeById.get(edge.to);
                        if (!source || !target) return null;
                        const start = resolveWorkflowOutputAnchor(source, edge);
                        const end = resolveWorkflowInputAnchor(target);
                        const connector = buildWorkflowConnectorPath(start, end);
                        const stroke =
                          edge.kind === 'split'
                            ? '#7c3aed'
                            : edge.kind === 'if_true'
                            ? '#0284c7'
                            : edge.kind === 'if_false'
                            ? '#c2410c'
                            : edge.kind === 'confirm_reject'
                            ? '#be123c'
                            : '#64748b';
                        return (
                          <g key={edge.id}>
                            <path
                              d={connector.d}
                              fill="none"
                              stroke={stroke}
                              strokeWidth={2.2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              markerEnd="url(#ticketWorkflowArrow)"
                            />
                            {edge.label && (
                              <text
                                x={connector.labelX}
                                y={connector.labelY}
                                textAnchor="middle"
                                className="workflow-visual-edge-label"
                              >
                                {edge.label}
                              </text>
                            )}
                          </g>
                        );
                      })}

                      {workflowGraph.nodes.map((node) => {
                        const isStart = node.id === '__start__';
                        const isCircle = node.shape === 'circle';
                        const isDiamond = node.shape === 'diamond';
                        const statusClass = node.status ? `status-${node.status.toLowerCase()}` : '';
                        const isActiveNode = node.taskId ? activeTaskIdSet.has(node.taskId) : false;
                        const nodeClass = `workflow-visual-node ${isStart ? 'start' : ''} ${isCircle ? 'circle' : ''} ${
                          isDiamond ? 'diamond' : ''
                        } ${statusClass} ${isActiveNode ? 'active' : ''}`;
                        if (isCircle) {
                          return (
                            <g key={node.id} className={nodeClass}>
                              <circle cx={node.x} cy={node.y} r={node.id === '__start__' ? 18 : 24} />
                              <text x={node.x} y={node.y + 4} textAnchor="middle" className="workflow-visual-node-title centered">
                                {node.id === '__start__' ? 'Start' : 'Ende'}
                              </text>
                            </g>
                          );
                        }
                        if (isDiamond) {
                          const diamondLabel =
                            node.type === 'IF' ? 'IF' : node.type === 'SPLIT' ? 'Split' : node.type === 'JOIN' ? 'Join' : 'Knoten';
                          return (
                            <g key={node.id} className={nodeClass}>
                              <polygon
                                points={`${node.x},${node.y - workflowGraph.diamondSize / 2} ${node.x + workflowGraph.diamondSize / 2},${node.y} ${node.x},${node.y + workflowGraph.diamondSize / 2} ${node.x - workflowGraph.diamondSize / 2},${node.y}`}
                              />
                              <text x={node.x} y={node.y - 4} textAnchor="middle" className="workflow-visual-node-title centered">
                                {diamondLabel}
                              </text>
                              <text x={node.x} y={node.y + 13} textAnchor="middle" className="workflow-visual-node-meta centered">
                                {node.status || ''}
                              </text>
                            </g>
                          );
                        }
                        return (
                          <g key={node.id} className={nodeClass}>
                            <rect x={node.x - 100} y={node.y - 35} width={200} height={70} rx={12} ry={12} />
                            <text x={node.x - 88} y={node.y - 14} className="workflow-visual-node-title">
                              {node.title.length > 30 ? `${node.title.slice(0, 30)}…` : node.title}
                            </text>
                            <text x={node.x - 88} y={node.y + 6} className="workflow-visual-node-meta">
                              {node.type === 'START'
                                ? 'START'
                                : `${taskTypeLabels[node.type as WorkflowTask['type']]} · ${node.status || ''}`}
                            </text>
                            {isActiveNode && (
                              <text x={node.x - 88} y={node.y + 24} className="workflow-visual-node-active">
                                Aktiver Pfad
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              )}

              {/* Tasks Overview */}
              <div className="tasks-list">
                <div className="tasks-list-head">
                  <h4>
                    <i className="fa-solid fa-list-check" /> Ablauf-Schritte
                  </h4>
                  <span>{workflowTasksOrdered.length} Schritte</span>
                </div>
                <div className="workflow-stepper">
                  {workflowTasksOrdered.map((task, idx) => {
                    const isActive = activeTaskIdSet.has(task.id);
                    const timerLabel = getTaskTimerLabel(task);
                    const isDataRequestTask =
                      task.type === 'DATENNACHFORDERUNG' ||
                      task.type === 'ENHANCED_CATEGORIZATION' ||
                      task.type === 'FREE_AI_DATA_REQUEST';
                    const taskDataRequestHistory = isDataRequestTask ? workflowDataRequestsByTaskId[task.id] || [] : [];
                    const stepNumber = Number.isFinite(task.order) ? task.order + 1 : idx + 1;
                    return (
                      <article
                        key={task.id}
                        className={`workflow-step-card ${isActive ? 'is-active' : ''} status-${task.status.toLowerCase()}`}
                      >
                        <div className="workflow-step-rail" aria-hidden="true">
                          <span className={`workflow-step-dot status-${task.status.toLowerCase()}`}>{stepNumber}</span>
                          {idx < workflowTasksOrdered.length - 1 && <span className="workflow-step-line" />}
                        </div>
                        <div className={`task-item-small status-${task.status.toLowerCase()}`}>
                          <div className="task-item-head">
                            <span className="task-item-icon">
                              <i className={resolveTaskIconClass(task.type)} />
                            </span>
                            <span className="task-title-small">{task.title}</span>
                            <span className="task-status-icon">
                              <i className={resolveTaskStatusIconClass(task.status)} />
                            </span>
                          </div>
                          <div className="task-item-meta">
                            <span className="task-chip ref">Schritt {stepNumber}</span>
                            <span className={`task-chip status-${task.status.toLowerCase()}`}>
                              {workflowTaskStatusLabelMap[task.status]}
                            </span>
                            {isActive && <span className="task-chip">Aktiver Pfad</span>}
                            {timerLabel && (
                              <span className="task-chip timer-running">
                                <i className="fa-solid fa-stopwatch" /> {timerLabel}
                              </span>
                            )}
                            <span className="task-chip">{taskTypeLabels[task.type]}</span>
                            <span className="task-chip">{task.auto ? 'Auto' : 'Manuell'}</span>
                          </div>
                          {task.description && <p className="task-item-description">{task.description}</p>}
                          {isDataRequestTask && (
                            <div className="task-data-request-history">
                              <div className="task-data-request-history-title">
                                <i className="fa-solid fa-list-check" /> Gestellte Fragen
                              </div>
                              {taskDataRequestHistory.length === 0 ? (
                                <p className="task-data-request-empty">Für diesen Schritt wurden noch keine Fragen versendet.</p>
                              ) : (
                                <div className="task-data-request-history-list">
                                  {taskDataRequestHistory.map((request, requestIndex) => (
                                    <article key={request.id} className="task-data-request-entry">
                                      <header className="task-data-request-entry-head">
                                        <span className="task-chip ref">Anfrage {requestIndex + 1}</span>
                                        {request.cycle && (
                                          <span className="task-chip ref">
                                            Zyklus {request.cycle}
                                            {request.maxCycles ? `/${request.maxCycles}` : ''}
                                          </span>
                                        )}
                                        <span className="task-chip ref">
                                          Gesendet: {request.createdAt ? formatDate(request.createdAt) : 'Unbekannt'}
                                        </span>
                                      </header>
                                      {request.fields.length === 0 ? (
                                        <p className="task-data-request-empty">Keine Fragen hinterlegt.</p>
                                      ) : (
                                        <ol className="task-data-request-question-list">
                                          {request.fields.map((field) => (
                                            <li key={`${request.id}-${field.key}`}>{field.label || field.key}</li>
                                          ))}
                                        </ol>
                                      )}
                                    </article>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {(task.status === 'RUNNING' || task.status === 'PENDING') && (
                            <div className="manual-task-actions" style={{ marginTop: '0.4rem' }}>
                              <button
                                className="btn-reject"
                                type="button"
                                onClick={() => handleRecoveryAction(task, 'skip')}
                                disabled={!!recoveryLoadingByTask[task.id]}
                              >
                                {recoveryLoadingByTask[task.id] ? (
                                  <>
                                    <i className="fa-solid fa-spinner fa-spin" /> Skip...
                                  </>
                                ) : (
                                  <>
                                    <i className="fa-solid fa-forward" /> Schritt skippen
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                          {task.status === 'FAILED' && (
                            <div className="manual-task-actions" style={{ marginTop: '0.4rem' }}>
                              <button
                                className="btn-approve"
                                type="button"
                                onClick={() => handleRecoveryAction(task, 'retry')}
                                disabled={!!recoveryLoadingByTask[task.id]}
                              >
                                <i className="fa-solid fa-rotate-right" /> Retry
                              </button>
                              <button
                                className="btn-reject"
                                type="button"
                                onClick={() => handleRecoveryAction(task, 'skip')}
                                disabled={!!recoveryLoadingByTask[task.id]}
                              >
                                <i className="fa-solid fa-forward" /> Skip
                              </button>
                              <button
                                className="btn-approve"
                                type="button"
                                onClick={() => handleRecoveryAction(task, 'resume')}
                                disabled={!!recoveryLoadingByTask[task.id]}
                              >
                                <i className="fa-solid fa-user-check" /> Fortsetzen
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <details className="ticket-comments-card" data-section="internal-task-results">
        <summary className="ticket-comments-header" style={{ cursor: 'pointer', listStyle: 'none' }}>
          <h3>
            <i className="fa-solid fa-clipboard-check" /> Interne Bearbeitung – Formularergebnisse
          </h3>
          <span className="ticket-comment-chip ref">{internalTaskResults.length} Einträge</span>
        </summary>
        <div style={{ paddingTop: '0.5rem' }}>
          {internalTaskResults.length === 0 ? (
            <p className="ticket-comments-empty">
              Für dieses Ticket sind noch keine Ergebnisse aus Formularen der internen Bearbeitung vorhanden.
            </p>
          ) : (
            <div className="ticket-comment-list">
              {internalTaskResults.map((task, index) => {
                const responsePayload =
                  task.response && typeof task.response === 'object' && !Array.isArray(task.response)
                    ? task.response
                    : {};
                const responseEntries = Object.entries(responsePayload).filter(([, value]) =>
                  hasInternalTaskResponseValue(value)
                );
                const formFieldByKey = new Map(
                  normalizeInternalTaskFormFields(task.formSchema).map((field) => [field.key, field])
                );
                const statusLabel = internalTaskStatusLabelMap[String(task.status || '').toLowerCase()] || task.status || 'Unbekannt';
                return (
                  <article key={task.id || `internal-task-result-${index}`} className="ticket-comment-item visibility-internal">
                    <header className="ticket-comment-head">
                      <div className="ticket-comment-head-left">
                        <span className="ticket-comment-chip author-system">Interne Bearbeitung</span>
                        <span className="ticket-comment-chip type">{statusLabel}</span>
                        {task.stepId ? <span className="ticket-comment-chip ref">Schritt {task.stepId}</span> : null}
                        <span className="ticket-comment-chip ref">
                          Zyklus {task.cycleIndex || 1}/{task.maxCycles || 1}
                        </span>
                        {task.completedAt ? (
                          <span className="ticket-comment-chip ref">Abschluss: {formatDate(task.completedAt)}</span>
                        ) : null}
                      </div>
                    </header>
                    <div className="ticket-comment-content">
                      <p style={{ margin: '0 0 0.65rem 0' }}>
                        <strong>{task.title || 'Interne Aufgabe'}</strong>
                        {task.description ? ` – ${task.description}` : ''}
                      </p>
                      {responseEntries.length === 0 ? (
                        <p style={{ margin: 0 }}>Für diesen Schritt wurden keine ausgefüllten Formularwerte gespeichert.</p>
                      ) : (
                        <div style={{ display: 'grid', gap: '0.5rem' }}>
                          {responseEntries.map(([key, value]) => {
                            const field = formFieldByKey.get(key);
                            return (
                              <div
                                key={`${task.id}-${key}`}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'minmax(180px, 35%) 1fr',
                                  gap: '0.65rem',
                                  padding: '0.55rem 0.7rem',
                                  borderRadius: '10px',
                                  border: '1px solid rgba(148, 163, 184, 0.35)',
                                  background: 'rgba(248, 250, 252, 0.72)',
                                }}
                              >
                                <span style={{ fontWeight: 700, color: '#334155' }}>{field?.label || key}</span>
                                <span style={{ color: '#0f172a' }}>{formatInternalTaskResponseValue(value, field)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </details>

      <div className="ticket-comments-card">
        <div className="ticket-comments-header">
          <h3>
            <i className="fa-solid fa-tags" /> Kategorisierung
          </h3>
          <div className="ticket-comments-toolbar">
            <button
              type="button"
              className="inline-copy-btn"
              onClick={handlePreviewCategorization}
              disabled={classificationLoading || classificationCommitting}
            >
              {classificationLoading ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Vorschlag läuft...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-wand-magic-sparkles" /> KI-Vorschlag erzeugen
                </>
              )}
            </button>
            <button
              type="button"
              className="inline-copy-btn"
              onClick={handleCommitCategorization}
              disabled={!classificationPreview || classificationCommitting || classificationLoading}
            >
              {classificationCommitting ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Übernehme...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-check" /> Vorschlag übernehmen
                </>
              )}
            </button>
            <button
              type="button"
              className="inline-copy-btn"
              onClick={handlePreviewResponsibility}
              disabled={responsibilityLoading || responsibilityCommitting}
              title="Verwaltungs-Zuständigkeitsprüfung auf Basis von Kategorie, OSM/Ort und Inhalt ausführen"
            >
              {responsibilityLoading ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Prüfung...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-scale-balanced" /> Verwaltungs-Zuständigkeitsprüfung
                </>
              )}
            </button>
          </div>
        </div>
        {!classificationPreview ? (
          <p className="ticket-comments-empty">
            Erzeuge einen KI-Vorschlag. Bei Übernahme werden Kategorie/Priorität gesetzt und der Kategorie-Workflow gestartet.
          </p>
        ) : (
          <div className="ticket-comment-list">
            <article className="ticket-comment-item visibility-internal">
              <header className="ticket-comment-head">
                <div className="ticket-comment-head-left">
                  <span className="ticket-comment-chip author-ai">KI</span>
                  <span className="ticket-comment-chip type">Klassifizierungsvorschlag</span>
                  {classificationPreview.categoryWorkflowTemplateId && (
                    <span className="ticket-comment-chip ref">
                      Workflow: {classificationPreview.categoryWorkflowTemplateId}
                    </span>
                  )}
                </div>
              </header>
              <p className="ticket-comment-content">
                <strong>Kategorie:</strong> {classificationPreview.suggestion.category}
                {'\n'}
                <strong>Priorität:</strong> {classificationPreview.suggestion.priority}
                {classificationPreview.suggestion.reasoning
                  ? `\n\n${classificationPreview.suggestion.reasoning}`
                  : ''}
              </p>
            </article>
          </div>
        )}
      </div>

      <div className="ticket-comments-card">
        <div className="ticket-comments-header">
          <h3>
            <i className="fa-solid fa-scale-balanced" /> Verwaltungs-Zuständigkeitsprüfung
          </h3>
          <div className="ticket-comments-toolbar">
            <button
              type="button"
              className="inline-copy-btn"
              onClick={handlePreviewResponsibility}
              disabled={responsibilityLoading || responsibilityCommitting}
            >
              {responsibilityLoading ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Prüfung läuft...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-wand-magic-sparkles" /> Verwaltungs-Zuständigkeitsprüfung
                </>
              )}
            </button>
            <button
              type="button"
              className="inline-copy-btn"
              onClick={handleCommitResponsibility}
              disabled={!responsibilityPreview || responsibilityCommitting || responsibilityLoading}
            >
              {responsibilityCommitting ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Übernehme...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-check" /> Vorschlag übernehmen
                </>
              )}
            </button>
          </div>
        </div>
        {!responsibilityPreview ? (
          <p className="ticket-comments-empty">
            Erzeuge einen KI-Vorschlag. Bei Übernahme wird das Feld "Zuständig ist" direkt am Ticket gesetzt.
          </p>
        ) : (
          <div className="ticket-comment-list">
            <article className="ticket-comment-item visibility-internal">
              <header className="ticket-comment-head">
                <div className="ticket-comment-head-left">
                  <span className="ticket-comment-chip author-ai">KI</span>
                  <span className="ticket-comment-chip type">Zuständigkeitsvorschlag</span>
                </div>
              </header>
              <div className="ticket-comment-content">
                <div className="info-field" style={{ marginBottom: '0.75rem' }}>
                  <label>Vorschlag</label>
                  <select
                    value={responsibilityPreview.suggestion.responsibilityAuthority}
                    onChange={(event) =>
                      setResponsibilityPreview((prev) =>
                        prev
                          ? {
                              ...prev,
                              suggestion: {
                                ...prev.suggestion,
                                responsibilityAuthority: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                  >
                    {responsibilityOptionsForSelect.map((entry) => (
                      <option key={`responsibility-preview-${entry}`} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </div>
                <p style={{ margin: '0 0 0.5rem 0' }}>
                  <strong>Konfidenz:</strong>{' '}
                  {typeof responsibilityPreview.suggestion.confidence === 'number'
                    ? `${Math.round(Math.max(0, Math.min(1, responsibilityPreview.suggestion.confidence)) * 100)}%`
                    : 'n/a'}
                </p>
                {responsibilityPreview.suggestion.reasoning && (
                  <p style={{ margin: '0 0 0.5rem 0' }}>{responsibilityPreview.suggestion.reasoning}</p>
                )}
                {Array.isArray(responsibilityPreview.suggestion.legalBasis) &&
                  responsibilityPreview.suggestion.legalBasis.length > 0 && (
                    <p style={{ margin: '0 0 0.5rem 0' }}>
                      <strong>Rechtsgrundlagen:</strong>{' '}
                      {responsibilityPreview.suggestion.legalBasis.join(', ')}
                    </p>
                  )}
                {Array.isArray(responsibilityPreview.suggestion.notes) &&
                  responsibilityPreview.suggestion.notes.length > 0 && (
                    <p style={{ margin: 0 }}>
                      <strong>Hinweise:</strong> {responsibilityPreview.suggestion.notes.join(' · ')}
                    </p>
                  )}
              </div>
            </article>
          </div>
        )}
      </div>

      <div className="ticket-info-grid">
        <div className="info-card edit-card">
          <div className="edit-card-header">
            <h3>Ticket bearbeiten</h3>
            {!isEditing ? (
              <button className="edit-btn" onClick={handleStartEdit}>
                <i className="fa-solid fa-pen-to-square" /> Bearbeiten
              </button>
            ) : (
              <button className="edit-btn secondary" onClick={handleCancelEdit}>
                <i className="fa-solid fa-xmark" /> Schliessen
              </button>
            )}
          </div>

          {isEditing ? (
            <>
              <div className="edit-layout">
                <section className="edit-section">
                  <div className="edit-section-head">
                    <h4>Stammdaten</h4>
                    <p>Kategorie, Zuständigkeit, Priorität, Status und Mandant.</p>
                  </div>
                  <div className="edit-grid">
                    <div className="info-field">
                      <label>Kategorie</label>
                      <input
                        list="category-options"
                        className="edit-input"
                        value={editDraft.category}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, category: e.target.value }))}
                      />
                      <datalist id="category-options">
                        {categoryOptions.map((cat) => (
                          <option key={cat} value={cat} />
                        ))}
                      </datalist>
                    </div>
                    <div className="info-field">
                      <label>Zuständig ist</label>
                      <select
                        className="edit-input"
                        value={editDraft.responsibilityAuthority}
                        onChange={(e) =>
                          setEditDraft((prev) => ({ ...prev, responsibilityAuthority: e.target.value }))
                        }
                      >
                        <option value="">-- Nicht gesetzt --</option>
                        {responsibilityOptionsForSelect.map((entry) => (
                          <option key={`responsibility-edit-${entry}`} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="info-field">
                      <label>Priorität</label>
                      <select
                        className="edit-input"
                        value={editDraft.priority}
                        onChange={(e) =>
                          setEditDraft((prev) => ({ ...prev, priority: e.target.value as Ticket['priority'] }))
                        }
                      >
                        {Object.entries(priorityLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="info-field">
                      <label>Status</label>
                      <select
                        className="edit-input"
                        value={editDraft.status}
                        onChange={(e) =>
                          setEditDraft((prev) => ({ ...prev, status: e.target.value as Ticket['status'] }))
                        }
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {statusLabels[status] || status}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="info-field">
                      <label>Mandant</label>
                      <select
                        className="edit-input"
                        value={editDraft.tenantId}
                        onChange={(e) =>
                          setEditDraft((prev) => {
                            const nextTenantId = String(e.target.value || '').trim();
                            const currentAssignment = parseAssignmentTarget(prev.assignmentTarget);
                            const currentAssignedOrgTenant = currentAssignment.orgUnitId
                              ? String(orgUnitById.get(currentAssignment.orgUnitId)?.tenantId || '').trim()
                              : '';
                            const nextAssignmentTarget =
                              nextTenantId &&
                              currentAssignment.orgUnitId &&
                              currentAssignedOrgTenant &&
                              currentAssignedOrgTenant !== nextTenantId
                                ? ''
                                : prev.assignmentTarget;
                            const nextCollaboratorOrgUnitIds = (Array.isArray(prev.collaboratorOrgUnitIds)
                              ? prev.collaboratorOrgUnitIds
                              : []
                            ).filter((entry) => {
                              const normalizedId = String(entry || '').trim();
                              if (!normalizedId) return false;
                              if (!nextTenantId) return true;
                              return String(orgUnitById.get(normalizedId)?.tenantId || '').trim() === nextTenantId;
                            });
                            return {
                              ...prev,
                              tenantId: nextTenantId,
                              assignmentTarget: nextAssignmentTarget,
                              collaboratorOrgUnitIds: nextCollaboratorOrgUnitIds,
                            };
                          })
                        }
                        disabled={assignmentDirectoryLoading}
                      >
                        {!tenantOptions.some((entry) => entry.id === editDraft.tenantId) && editDraft.tenantId ? (
                          <option value={editDraft.tenantId}>{editDraft.tenantId} (nicht mehr vorhanden)</option>
                        ) : null}
                        <option value="">-- Mandant wählen --</option>
                        {tenantOptions.map((tenant) => (
                          <option key={`tenant-${tenant.id}`} value={tenant.id}>
                            {tenant.name}
                            {!tenant.active ? ' (inaktiv)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                <section className="edit-section">
                  <div className="edit-section-head">
                    <h4>Zuweisung</h4>
                    <p>Primärzuständigkeit und Mitwirkende.</p>
                  </div>
                  <div className="edit-grid">
                    <div className="info-field">
                      <label>Zugewiesen an</label>
                      <select
                        className="edit-input"
                        value={editDraft.assignmentTarget}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, assignmentTarget: e.target.value }))}
                        disabled={assignmentDirectoryLoading}
                      >
                        <option value="">-- Nicht zugewiesen --</option>
                        {editDraft.assignmentTarget.startsWith('legacy:') && (
                          <option value={editDraft.assignmentTarget}>
                            Legacy: {editDraft.assignmentTarget.slice('legacy:'.length).trim() || '—'}
                          </option>
                        )}
                        {editDraft.assignmentTarget.startsWith('org:') &&
                          !assignmentOrgOptions.some(
                            (entry) => `org:${entry.id}` === editDraft.assignmentTarget
                          ) && (
                            <option value={editDraft.assignmentTarget}>
                              Org: {editDraft.assignmentTarget.slice('org:'.length).trim() || '—'} (nicht mehr vorhanden)
                            </option>
                          )}
                        {editDraft.assignmentTarget.startsWith('user:') &&
                          !assignmentUserOptions.some(
                            (entry) => `user:${entry.id}` === editDraft.assignmentTarget
                          ) && (
                            <option value={editDraft.assignmentTarget}>
                              User: {editDraft.assignmentTarget.slice('user:'.length).trim() || '—'} (nicht mehr vorhanden)
                            </option>
                          )}
                        {assignmentOrgOptions.length > 0 && (
                          <optgroup label="Organisationseinheiten">
                            {assignmentOrgOptions.map((unit) => (
                              <option key={`org-${unit.id}`} value={`org:${unit.id}`}>
                                {unit.active ? unit.label : `${unit.label} (inaktiv)`}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {assignmentUserOptions.length > 0 && (
                          <optgroup label="Benutzer">
                            {assignmentUserOptions.map((user) => (
                              <option key={`user-${user.id}`} value={`user:${user.id}`}>
                                {user.active
                                  ? buildAssignmentUserLabel(user)
                                  : `${buildAssignmentUserLabel(user)} (inaktiv)`}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {assignmentDirectoryError && (
                        <small className="input-hint error">{assignmentDirectoryError}</small>
                      )}
                    </div>
                    <div className="info-field span-2">
                      <label>Mitwirkende Benutzer</label>
                      <select
                        className="edit-input assignment-multi-select"
                        multiple
                        size={Math.min(8, Math.max(4, collaboratorUserSelectionOptions.length || 4))}
                        value={editDraft.collaboratorUserIds}
                        onChange={(event) =>
                          setEditDraft((prev) => ({
                            ...prev,
                            collaboratorUserIds: Array.from(event.target.selectedOptions)
                              .map((option) => option.value)
                              .filter(Boolean),
                          }))
                        }
                        disabled={assignmentDirectoryLoading}
                      >
                        {collaboratorUserSelectionOptions.map((entry) => (
                          <option key={`collab-user-${entry.id}`} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                      <small className="input-hint">Mehrfachauswahl möglich (Strg/Cmd + Klick).</small>
                    </div>
                    <div className="info-field span-2">
                      <label>Mitwirkende Organisationseinheiten</label>
                      <select
                        className="edit-input assignment-multi-select"
                        multiple
                        size={Math.min(8, Math.max(4, collaboratorOrgSelectionOptions.length || 4))}
                        value={editDraft.collaboratorOrgUnitIds}
                        onChange={(event) =>
                          setEditDraft((prev) => ({
                            ...prev,
                            collaboratorOrgUnitIds: Array.from(event.target.selectedOptions)
                              .map((option) => option.value)
                              .filter(Boolean),
                          }))
                        }
                        disabled={assignmentDirectoryLoading}
                      >
                        {collaboratorOrgSelectionOptions.map((entry) => (
                          <option key={`collab-org-${entry.id}`} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                      <small className="input-hint">Mehrfachauswahl möglich (Strg/Cmd + Klick).</small>
                    </div>
                  </div>
                </section>

                <section className="edit-section">
                  <div className="edit-section-head">
                    <h4>Beschreibung</h4>
                    <p>Freitext für den Vorgang.</p>
                  </div>
                  <div className="edit-grid">
                    <div className="info-field span-2">
                      <label>Beschreibung</label>
                      <textarea
                        className="edit-input"
                        rows={4}
                        value={editDraft.description}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, description: e.target.value }))}
                      />
                    </div>
                  </div>
                </section>

                <section className="edit-section">
                  <div className="edit-section-head">
                    <h4>Standort</h4>
                    <p>Adresse und Koordinaten.</p>
                  </div>
                  <div className="edit-grid edit-grid-location">
                    <div className="info-field span-2">
                      <label>Adresse</label>
                      <input
                        className="edit-input"
                        value={editDraft.address}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, address: e.target.value }))}
                      />
                    </div>
                    <div className="info-field">
                      <label>PLZ</label>
                      <input
                        className="edit-input"
                        value={editDraft.postalCode}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, postalCode: e.target.value }))}
                      />
                    </div>
                    <div className="info-field">
                      <label>Ort</label>
                      <input
                        className="edit-input"
                        value={editDraft.city}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, city: e.target.value }))}
                      />
                    </div>
                    <div className="info-field">
                      <label>Latitude</label>
                      <input
                        className="edit-input"
                        value={editDraft.latitude}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, latitude: e.target.value }))}
                      />
                    </div>
                    <div className="info-field">
                      <label>Longitude</label>
                      <input
                        className="edit-input"
                        value={editDraft.longitude}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, longitude: e.target.value }))}
                      />
                    </div>
                  </div>
                </section>
              </div>

              <div className="edit-actions">
                <button className="edit-btn secondary" onClick={handleCancelEdit} disabled={ticketSaving}>
                  Abbrechen
                </button>
                <button className="edit-btn primary" onClick={handleSaveEdits} disabled={ticketSaving}>
                  {ticketSaving ? 'Speichern...' : 'Speichern'}
                </button>
              </div>
            </>
          ) : (
            <p className="edit-hint">
              Mandant, Kategorie, Zuständigkeit, Status, Priorität, Beschreibung und Standort können hier angepasst werden.
            </p>
          )}
        </div>

        <div className="info-card">
          <h3>Basis-Information</h3>
          <div className="info-field">
            <label>Meldende Person</label>
            <p>{ticket.citizenName || '–'}</p>
          </div>
          <div className="info-field">
            <label>E-Mail</label>
            <p>{ticket.citizenEmail || '–'}</p>
          </div>
          <div className="info-field">
            <label>Sprache Bürger</label>
            <p>
              {ticket.citizenPreferredLanguageName || ticket.citizenPreferredLanguage
                ? `${ticket.citizenPreferredLanguageName || ticket.citizenPreferredLanguage || ''}${
                    ticket.citizenPreferredLanguage ? ` (${ticket.citizenPreferredLanguage})` : ''
                  }`
                : '–'}
            </p>
          </div>
          <div className="info-field">
            <label>Kategorie</label>
            <p>{ticket.category}</p>
          </div>
          <div className="info-field">
            <label>Zuständig ist</label>
            <p>{ticket.responsibilityAuthority || '–'}</p>
          </div>
          <div className="info-field">
            <label>Status</label>
            <select
              value={ticket.status}
              onChange={(e) => handleUpdateStatus(e.target.value)}
              disabled={isSaving || isEditing}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status] || status}
                </option>
              ))}
            </select>
          </div>
          <div className="info-field">
            <label>Mandant</label>
            <p>{tenantLabel || '–'}</p>
          </div>
          <div className="info-field">
            <label>Verantwortliche Organisation</label>
            <p>{owningOrgLabel || '–'}</p>
          </div>
          <div className="info-field">
            <label>Primärzuweisung</label>
            <p>
              {!primaryAssigneeUserLabel && !primaryAssigneeOrgLabel
                ? '–'
                : [primaryAssigneeUserLabel ? `Benutzer: ${primaryAssigneeUserLabel}` : '', primaryAssigneeOrgLabel ? `Organisation: ${primaryAssigneeOrgLabel}` : '']
                    .filter(Boolean)
                    .join(' · ')}
            </p>
          </div>
          <div className="info-field">
            <label>Mitwirkende</label>
            {collaboratorBadges.length === 0 ? (
              <p>–</p>
            ) : (
              <div className="assignment-chip-list">
                {collaboratorBadges.map((entry) => (
                  <span
                    key={entry.key}
                    className={`assignment-chip ${entry.isUser ? 'is-user' : ''} ${entry.isOrg ? 'is-org' : ''}`}
                  >
                    {entry.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          {ticket.assignedTo && (
            <div className="info-field">
              <label>Legacy-Zuweisung (alt)</label>
              <p>{ticket.assignedTo}</p>
            </div>
          )}
          {!hasStructuredAssignment && !ticket.assignedTo && (
            <div className="info-field">
              <label>Zuweisung</label>
              <p>Keine Zuweisung vorhanden.</p>
            </div>
          )}
          {!hasStructuredAssignment && ticket.assignedTo && (
            <div className="info-field">
              <label>Hinweis</label>
              <p>Dieses Ticket verwendet noch die alte Zuweisungsstruktur.</p>
            </div>
          )}
          {hasStructuredAssignment && (
            <div className="info-field">
              <label>Hinweis</label>
              <p>Dieses Ticket nutzt die neue Zuweisungsstruktur (Primär + Mitwirkende).</p>
            </div>
          )}
        </div>

        <div className="info-card ticket-qr-card">
          <div className="info-card-head">
            <h3>Ticket-QR (Ops)</h3>
            <button
              type="button"
              className="inline-copy-btn"
              onClick={() => {
                void handleCopyOpsTicketLink();
              }}
              disabled={!ticketOpsDeepLink}
              title={ticketOpsDeepLink ? 'Ops-Link in Zwischenablage kopieren' : 'Kein Link verfügbar'}
            >
              <i className="fa-solid fa-copy" /> Link kopieren
            </button>
          </div>
          <p className="ticket-qr-hint">
            QR-Code zum direkten Öffnen des Tickets in der Ops-App.
          </p>
          {ticketQrCodeImageUrl ? (
            <div className="ticket-qr-preview">
              <img src={ticketQrCodeImageUrl} alt={`QR-Code für Ticket ${ticket.id}`} loading="lazy" />
            </div>
          ) : (
            <p>QR-Code konnte nicht erstellt werden.</p>
          )}
          <div className="info-field">
            <label>Ops-Link</label>
            <p className="ticket-qr-link">{ticketOpsDeepLink || '–'}</p>
          </div>
          <div className="ticket-qr-actions">
            {ticketOpsDeepLink ? (
              <a
                className="inline-copy-btn"
                href={ticketOpsDeepLink}
                target="_blank"
                rel="noopener noreferrer"
                title="Ticket in der Ops-App öffnen"
              >
                <i className="fa-solid fa-arrow-up-right-from-square" /> In Ops öffnen
              </a>
            ) : null}
          </div>
        </div>

        <div className="info-card info-card-secondary">
          <div className="info-card-head">
            <h3>Pseudonymisierung (intern)</h3>
            <button
              type="button"
              className="inline-copy-btn pseudonymize-btn"
              onClick={handleGenerateReporterPseudonym}
              disabled={isPseudonymizing || hasReporterPseudonym || !id}
              title={hasReporterPseudonym ? 'Für dieses Ticket ist bereits ein Pseudonym vorhanden.' : ''}
            >
              {isPseudonymizing ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Pseudonymisiere...
                </>
              ) : hasReporterPseudonym ? (
                <>
                  <i className="fa-solid fa-check" /> Bereits pseudonymisiert
                </>
              ) : (
                <>
                  <i className="fa-solid fa-user-secret" /> Pseudonymisieren
                </>
              )}
            </button>
          </div>
          <div className="info-field">
            <label>Pseudonym</label>
            <p>{ticket.reporterPseudoName || '–'}</p>
          </div>
          <div className="info-field">
            <label>Pseudo-E-Mail</label>
            <p>{ticket.reporterPseudoEmail || '–'}</p>
          </div>
          <div className="info-field">
            <label>Pseudonym Vorname/Nachname</label>
            <p>
              {(ticket.reporterPseudoFirstName || ticket.reporterPseudoLastName)
                ? `${ticket.reporterPseudoFirstName || '–'} ${ticket.reporterPseudoLastName || ''}`.trim()
                : '–'}
            </p>
          </div>
          <div className="info-field">
            <label>Scope</label>
            <p>{ticket.reporterPseudoScopeKey || '–'}</p>
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-head">
            <h3>Standort-Information</h3>
            <button
              type="button"
              className="inline-copy-btn"
              onClick={handleRefreshGeoWeather}
              disabled={isRefreshingGeoWeather}
            >
              {isRefreshingGeoWeather ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Aktualisiere...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-cloud-arrow-down" /> Nominatim + Wetter neu laden
                </>
              )}
            </button>
          </div>
          <div className="info-field">
            <label>Adresse</label>
            <div className="info-field-inline">
              <p>{ticket.address || '–'}</p>
              <button
                type="button"
                className="inline-copy-btn"
                onClick={handleCopyAddress}
                disabled={!locationSummary}
                title={locationSummary ? 'Adresse in Zwischenablage kopieren' : 'Keine Adresse verfügbar'}
              >
                <i className="fa-solid fa-copy" /> Kopieren
              </button>
            </div>
          </div>
          <div className="info-field">
            <label>PLZ / Ort</label>
            <p>
              {ticket.postalCode && ticket.city
                ? `${ticket.postalCode} ${ticket.city}`
                : '–'}
            </p>
          </div>
          {ticket.latitude && ticket.longitude && (
            <div className="info-field">
              <label>Koordinaten</label>
              <p>
                {ticket.latitude.toFixed(6)}, {ticket.longitude.toFixed(6)}
              </p>
            </div>
          )}
          <div className="info-field">
            <label>Nominatim-Geoobjekt</label>
            {ticket.nominatimRaw ? (
              <details className="ticket-nominatim-details">
                <summary>Alle Nominatim-Felder anzeigen</summary>
                <pre>{JSON.stringify(ticket.nominatimRaw, null, 2)}</pre>
              </details>
            ) : (
              <p>Keine Nominatim-Daten gespeichert.</p>
            )}
          </div>
          <div className="info-field">
            <label>Wetter zum Meldezeitpunkt</label>
            {ticket.weatherReport ? (
              <div className="ticket-weather-summary">
                <p>
                  Zeitpunkt (UTC): {String(ticket.weatherReport.observationTimeUtc || ticket.weatherReport.reportTimestampUtc || '–')}
                </p>
                <p>
                  Temperatur: {ticket.weatherReport.values?.temperatureC ?? '–'} {ticket.weatherReport.units?.temperature_2m || '°C'}
                  {' · '}
                  Gefühlt: {ticket.weatherReport.values?.apparentTemperatureC ?? '–'} {ticket.weatherReport.units?.apparent_temperature || '°C'}
                </p>
                <p>
                  Niederschlag: {ticket.weatherReport.values?.precipitationMm ?? '–'} {ticket.weatherReport.units?.precipitation || 'mm'}
                  {' · '}
                  Wind: {ticket.weatherReport.values?.windSpeed10mKmh ?? '–'} {ticket.weatherReport.units?.wind_speed_10m || 'km/h'}
                </p>
                <p>
                  Wettercode (WMO): {ticket.weatherReport.values?.weatherCode ?? '–'}
                </p>
                <details className="ticket-nominatim-details">
                  <summary>Alle Wetterfelder anzeigen</summary>
                  <pre>{JSON.stringify(ticket.weatherReport, null, 2)}</pre>
                </details>
              </div>
            ) : (
              <p>Keine Wetterdaten gespeichert.</p>
            )}
          </div>
        </div>

        <div className="info-card">
          <h3>Beschreibung</h3>
          {(() => {
            const sourceText = ticket.originalDescription || ticket.description || ticket.anonymizedText || '';
            const translatedText = String(ticket.translatedDescriptionDe || '').trim();
            const citizenLanguageCode = String(ticket.citizenPreferredLanguage || '')
              .trim()
              .toLowerCase();
            const needsTranslation = !!sourceText && !!citizenLanguageCode && !citizenLanguageCode.startsWith('de');
            return (
              <>
                <div className="info-field">
                  <label>Text</label>
                  <p className="ticket-description">{sourceText || '–'}</p>
                </div>
                {(translatedText || needsTranslation) && (
                  <div className="info-field">
                    <label>Übersetzung (Deutsch)</label>
                    {translatedText ? (
                      <p className="ticket-description">{translatedText}</p>
                    ) : (
                      <p className="ticket-description-pending">Wird im Hintergrund übersetzt ...</p>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        <div className="info-card info-card-wide">
          <h3>
            <i className="fa-solid fa-file-circle-question" /> Nachgeforderte Daten
          </h3>
          {ticketDataRequests.length === 0 ? (
            <p className="ticket-comments-empty">Für dieses Ticket wurden bisher keine Datennachforderungen beantwortet.</p>
          ) : (
            <div className="ticket-data-request-list">
              {ticketDataRequests.map((request) => {
                const answeredCount = request.fields.filter((field) =>
                  hasDataRequestAnswerValue(request.answers?.[field.key])
                ).length;
                return (
                  <article key={request.id} className="ticket-data-request-item">
                    <header className="ticket-data-request-head">
                      <div className="ticket-data-request-chips">
                        <span className="ticket-comment-chip type">Status: {request.status}</span>
                        <span className="ticket-comment-chip ref">
                          Modus: {request.mode === 'parallel' ? 'Parallel' : 'Blockierend'}
                        </span>
                        <span className="ticket-comment-chip ref">
                          Antworten: {answeredCount}/{request.fields.length || 0}
                        </span>
                        {request.taskId && <span className="ticket-comment-chip ref">Task: {request.taskId}</span>}
                        {request.executionId && (
                          <span className="ticket-comment-chip ref">Execution: {request.executionId}</span>
                        )}
                      </div>
                      <div className="ticket-data-request-times">
                        {request.createdAt && <span>Erstellt: {formatDate(request.createdAt)}</span>}
                        {request.answeredAt && <span>Beantwortet: {formatDate(request.answeredAt)}</span>}
                        {request.expiresAt && <span>Frist: {formatDate(request.expiresAt)}</span>}
                      </div>
                    </header>
                    <div className="ticket-data-request-qa">
                      {request.fields.map((field) => {
                        const answerValue = request.answers?.[field.key];
                        const hasValue = hasDataRequestAnswerValue(answerValue);
                        return (
                          <div key={`${request.id}-${field.key}`} className="ticket-data-request-qa-item">
                            <div className="ticket-data-request-question">
                              {field.label}
                              {field.required && <span className="ticket-data-required">*</span>}
                            </div>
                            <div className={`ticket-data-request-answer ${hasValue ? '' : 'missing'}`}>
                              {hasValue ? formatDataRequestAnswerValue(answerValue, field) : 'Keine Angabe'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="info-card info-card-wide">
          <h3>
            <i className="fa-solid fa-inbox" /> E-Mail-Antworten & Anhänge
          </h3>
          {ticketEmailMessages.length === 0 ? (
            <p className="ticket-comments-empty">Für dieses Ticket wurden bisher keine E-Mails zugeordnet.</p>
          ) : (
            <div className="ticket-email-message-list">
              {ticketEmailMessages.map((message) => (
                <article key={message.id} className="ticket-email-message-item">
                  <header className="ticket-email-message-head">
                    <div className="ticket-email-message-title">
                      <strong>{message.subject || '(ohne Betreff)'}</strong>
                      <span>
                        Von: {message.fromName ? `${message.fromName} ` : ''}
                        {message.fromEmail || 'Unbekannt'}
                      </span>
                      <span>
                        Empfang: {message.receivedAt ? formatDate(message.receivedAt) : 'Unbekannt'}
                      </span>
                    </div>
                    <div className="ticket-email-message-tags">
                      <span className="ticket-comment-chip ref">UID: {message.mailboxUid}</span>
                      {message.matchReason && <span className="ticket-comment-chip ref">Match: {message.matchReason}</span>}
                      <span className="ticket-comment-chip ref">Anhänge: {message.attachments.length}</span>
                      {message.ticketId && (
                        <button
                          type="button"
                          className="inline-copy-btn"
                          onClick={() => navigate(`/tickets/${message.ticketId}`)}
                        >
                          <i className="fa-solid fa-ticket" /> Ticket öffnen
                        </button>
                      )}
                    </div>
                  </header>

                  <p className="ticket-email-message-preview">
                    {resolveEmailTextPreview(message) || message.preview || 'Keine Vorschau verfügbar.'}
                  </p>

                  {message.attachments.length > 0 && (
                    <ul className="ticket-email-attachment-list">
                      {message.attachments.map((attachment) => (
                        <li key={attachment.id}>
                          <div>
                            <strong>{attachment.fileName}</strong>
                            <span>{attachment.mimeType}</span>
                            <span>{formatByteSize(attachment.byteSize)}</span>
                          </div>
                          <button
                            type="button"
                            className="inline-copy-btn"
                            onClick={() => void handleDownloadEmailAttachment(message, attachment)}
                          >
                            <i className="fa-solid fa-download" /> Download
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="info-card">
          <h3>Bilder</h3>
          {ticketImages.length === 0 ? (
            <p>Keine Bilder vorhanden.</p>
          ) : (
            <div className="ticket-image-grid">
              {ticketImages.map((image, index) => {
                const analysis = image.analysis || null;
                const isAnalyzing = !!imageAnalysisBusyById[image.id];
                const analysisStatus = formatImageAnalysisStatus(analysis?.status);
                const analysisStatusClass =
                  analysis?.status === 'done'
                    ? 'has-data'
                    : analysis?.status === 'failed'
                    ? 'no-data'
                    : 'neutral';
                return (
                  <button
                    type="button"
                    key={image.id}
                    className="ticket-image-item"
                    onClick={(event) => {
                      const targetElement = event.target instanceof Element ? event.target : null;
                      const exifGpsTrigger = targetElement?.closest('[data-exif-gps]');
                      if (exifGpsTrigger && image.exif?.hasGps) {
                        event.preventDefault();
                        event.stopPropagation();
                        openExifMap(image);
                        return;
                      }
                      const analyzeTrigger = targetElement?.closest('[data-image-analyze]');
                      if (analyzeTrigger) {
                        event.preventDefault();
                        event.stopPropagation();
                        openImageAnalyzeDialog(image);
                        return;
                      }
                      setActiveImageIndex(index);
                    }}
                    title={`${image.fileName} (${formatByteSize(image.byteSize)})`}
                  >
                    <img src={image.dataUrl} alt={image.fileName || 'Ticket-Bild'} loading="lazy" />
                    <div className="ticket-image-meta">
                      <span>{image.fileName || 'Bild'}</span>
                      <span>{formatByteSize(image.byteSize)}</span>
                    </div>
                    <div className="ticket-image-exif">
                      <span className={`ticket-image-exif-chip ${image.exif?.hasExif ? 'has-data' : 'no-data'}`}>
                        <i className="fa-solid fa-camera" /> {image.exif?.hasExif ? 'EXIF vorhanden' : 'Kein EXIF'}
                      </span>
                      <span className={`ticket-image-exif-chip ${image.exif?.hasGps ? 'has-gps' : 'no-data'}`}>
                        <i className="fa-solid fa-location-dot" />{' '}
                        {image.exif?.hasGps
                          ? `${formatCoordinate(image.exif?.gpsLatitude)}, ${formatCoordinate(image.exif?.gpsLongitude)}`
                          : 'Kein GPS in EXIF'}
                      </span>
                      {image.exif?.hasGps && (
                        <span className="ticket-image-exif-chip clickable" data-exif-gps>
                          <i className="fa-solid fa-map" /> Auf Karte anzeigen
                        </span>
                      )}
                      {(image.exif?.width || image.exif?.height || image.exif?.format) && (
                        <span className="ticket-image-exif-chip neutral">
                          <i className="fa-solid fa-image" /> {image.exif?.width || '–'}×{image.exif?.height || '–'}{' '}
                          {image.exif?.format ? `· ${image.exif.format.toUpperCase()}` : ''}
                        </span>
                      )}
                      <span className={`ticket-image-exif-chip ${analysisStatusClass}`}>
                        <i className="fa-solid fa-wand-magic-sparkles" /> KI: {analysisStatus}
                      </span>
                      {typeof analysis?.confidence === 'number' && Number.isFinite(analysis.confidence) && (
                        <span className="ticket-image-exif-chip neutral">
                          <i className="fa-solid fa-gauge-high" /> {Math.round(analysis.confidence * 100)}%
                        </span>
                      )}
                      <span
                        className={`ticket-image-exif-chip clickable ${isAnalyzing ? 'disabled' : ''}`}
                        data-image-analyze
                      >
                        <i className={`fa-solid ${isAnalyzing ? 'fa-spinner fa-spin' : 'fa-sliders'}`} />{' '}
                        {isAnalyzing ? 'Analysiere...' : 'Analyse konfigurieren'}
                      </span>
                    </div>
                    <p className={`ticket-image-analysis-text ${analysis?.description ? '' : 'pending'}`}>
                      {analysis?.description ||
                        (analysis?.status === 'failed'
                          ? analysis?.error || 'KI-Bildanalyse fehlgeschlagen.'
                          : 'Noch keine KI-Bildbeschreibung vorhanden.')}
                    </p>
                    <span className="ticket-image-zoom">
                      <i className="fa-solid fa-magnifying-glass-plus" /> Vergrößern
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="info-card">
          <h3>Metadaten</h3>
          <div className="info-field">
            <label>Erstellt</label>
            <p>{formatDate(ticket.createdAt)}</p>
          </div>
          <div className="info-field">
            <label>Aktualisiert</label>
            <p>{formatDate(ticket.updatedAt)}</p>
          </div>
          {ticket.redmineIssueId && (
            <div className="info-field">
              <label>RedMine Issue</label>
              <p>#{ticket.redmineIssueId}</p>
            </div>
          )}
        </div>

        {/* Validation Status */}
        {(ticket.status === 'pending_validation' || ticket.status === 'pending') && (
          <div className="info-card" style={{ backgroundColor: '#fff3cd', borderLeft: '4px solid #ffc107' }}>
            <h3>
              <i className="fa-solid fa-envelope" /> Double Opt-In Validierung
            </h3>
            <div className="info-field">
              <label>Status</label>
              <p style={{ color: '#856404', fontWeight: 'bold' }}>
                {validationStatus?.isValidated ? (
                  <>
                    <i className="fa-solid fa-check" /> Validiert
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-hourglass-half" /> Ausstehend
                  </>
                )}
              </p>
            </div>
            {validationStatus?.validatedAt && (
              <div className="info-field">
                <label>Validiert am</label>
                <p>{formatDate(validationStatus.validatedAt)}</p>
              </div>
            )}
            {!validationStatus?.isValidated && (
              <button
                onClick={handleManualVerification}
                disabled={isSaving}
                style={{
                  marginTop: '10px',
                  padding: '8px 16px',
                  backgroundColor: '#ffc107',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                {isSaving ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Wird verarbeitet...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-check" /> Manuell verifizieren
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="ticket-comments-card">
        <div className="ticket-comments-header">
          <h3>
            <i className="fa-solid fa-comments" /> Kommentar-Timeline
          </h3>
          <div className="ticket-comments-toolbar">
            <select
              value={commentFilter}
              onChange={(event) => setCommentFilter(event.target.value as 'all' | TicketCommentVisibility)}
            >
              <option value="all">Alle</option>
              <option value="internal">Nur intern</option>
              <option value="public">Nur öffentlich</option>
            </select>
            <button
              type="button"
              className={`ticket-comment-filter-btn ${showCommentTypeFilters ? 'active' : ''}`}
              onClick={() => setShowCommentTypeFilters((prev) => !prev)}
            >
              <i className="fa-solid fa-filter" /> Typfilter
            </button>
            <span className="ticket-comments-counter">{commentCounterLabel}</span>
          </div>
        </div>

        {showCommentTypeFilters && (
          <div className="ticket-comment-type-filter-panel">
            <button
              type="button"
              className={`ticket-comment-type-pill ${!isCommentTypeFilterActive ? 'active' : ''}`}
              onClick={() => setCommentTypeFilters([])}
            >
              Alle Typen
            </button>
            {availableCommentTypes.map((typeValue) => {
              const active = commentTypeFilters.includes(typeValue);
              const label =
                COMMENT_TYPE_LABELS[typeValue as TicketCommentType] || typeValue || 'Kommentar';
              return (
                <button
                  type="button"
                  key={`filter-type-${typeValue}`}
                  className={`ticket-comment-type-pill ${active ? 'active' : ''}`}
                  onClick={() =>
                    setCommentTypeFilters((prev) =>
                      prev.includes(typeValue)
                        ? prev.filter((entry) => entry !== typeValue)
                        : [...prev, typeValue]
                    )
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <div className="ticket-comment-compose">
          <textarea
            rows={3}
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            placeholder="Kommentar verfassen..."
            disabled={isCommentSubmitting}
          />
          <div className="ticket-comment-compose-actions">
            <label>
              Sichtbarkeit
              <select
                value={commentVisibility}
                onChange={(event) => setCommentVisibility(event.target.value as TicketCommentVisibility)}
                disabled={isCommentSubmitting}
              >
                <option value="internal">Intern</option>
                <option value="public">Öffentlich</option>
              </select>
            </label>
            <label>
              Typ
              <select
                value={commentType}
                onChange={(event) => setCommentType(event.target.value as TicketCommentType)}
                disabled={isCommentSubmitting}
              >
                {Object.entries(COMMENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={handleCreateComment} disabled={isCommentSubmitting || !commentDraft.trim()}>
              {isCommentSubmitting ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" /> Speichern...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-plus" /> Kommentar hinzufügen
                </>
              )}
            </button>
          </div>
        </div>

        {filteredTicketComments.length === 0 ? (
          <p className="ticket-comments-empty">Noch keine Kommentare für diese Auswahl vorhanden.</p>
        ) : (
          <div className="ticket-comment-list">
            {filteredTicketComments.map((comment) => {
              const isEditingComment = editingCommentId === comment.id;
              const isCollapsed = !isEditingComment && collapsedCommentIds[comment.id] === true;
              const commentTypeLabel =
                COMMENT_TYPE_LABELS[comment.commentType as TicketCommentType] || comment.commentType || 'Kommentar';
              const authorLabel = COMMENT_AUTHOR_LABELS[comment.authorType] || comment.authorType;
              const authorIdentity =
                comment.authorType === 'staff'
                  ? String(comment.authorName || comment.authorId || 'Unbekannt')
                  : comment.authorType === 'ai'
                  ? String(comment.authorName || 'KI-Agent')
                  : comment.authorType === 'system'
                  ? String(comment.authorName || 'System')
                  : String(comment.authorName || 'Bürger');
              const visibilityLabel = COMMENT_VISIBILITY_LABELS[comment.visibility] || comment.visibility;
              const metadataEntries = comment.metadata ? Object.entries(comment.metadata).slice(0, 6) : [];
              return (
                <article key={comment.id} className={`ticket-comment-item visibility-${comment.visibility}`}>
                  <header className="ticket-comment-head">
                    <div className="ticket-comment-head-left">
                      <span className={`ticket-comment-chip author-${comment.authorType}`}>{authorLabel}</span>
                      <span className="ticket-comment-chip author-origin">Urheber: {authorIdentity}</span>
                      <span className={`ticket-comment-chip visibility-${comment.visibility}`}>{visibilityLabel}</span>
                      <span className="ticket-comment-chip type">{commentTypeLabel}</span>
                      {comment.taskId && <span className="ticket-comment-chip ref">Task: {comment.taskId}</span>}
                      {comment.executionId && (
                        <span className="ticket-comment-chip ref">Execution: {comment.executionId}</span>
                      )}
                    </div>
                    <div className="ticket-comment-head-right">
                      <span className="ticket-comment-time">{formatDate(comment.createdAt)}</span>
                      {!isEditingComment && (
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedCommentIds((prev) => ({
                              ...prev,
                              [comment.id]: !(prev[comment.id] === true),
                            }))
                          }
                        >
                          <i className={`fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}`} />{' '}
                          {isCollapsed ? 'Aufklappen' : 'Einklappen'}
                        </button>
                      )}
                      {!isEditingComment && (
                        <button type="button" onClick={() => startCommentEdit(comment)}>
                          <i className="fa-solid fa-pen-to-square" /> Bearbeiten
                        </button>
                      )}
                    </div>
                  </header>

                  {isEditingComment ? (
                    <div className="ticket-comment-edit">
                      <textarea
                        rows={3}
                        value={editingCommentDraft}
                        onChange={(event) => setEditingCommentDraft(event.target.value)}
                        disabled={editingCommentSaving}
                      />
                      <div className="ticket-comment-edit-actions">
                        <select
                          value={editingCommentVisibility}
                          onChange={(event) =>
                            setEditingCommentVisibility(event.target.value as TicketCommentVisibility)
                          }
                          disabled={editingCommentSaving}
                        >
                          <option value="internal">Intern</option>
                          <option value="public">Öffentlich</option>
                        </select>
                        <button type="button" onClick={cancelCommentEdit} disabled={editingCommentSaving}>
                          Abbrechen
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveCommentEdit(comment)}
                          disabled={editingCommentSaving || !editingCommentDraft.trim()}
                        >
                          {editingCommentSaving ? 'Speichert...' : 'Übernehmen'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {isCollapsed ? (
                        <p className="ticket-comment-preview">
                          {comment.content.length > 190
                            ? `${comment.content.slice(0, 190)}...`
                            : comment.content}
                        </p>
                      ) : (
                        <p className="ticket-comment-content">{comment.content}</p>
                      )}
                    </>
                  )}

                  {metadataEntries.length > 0 && !isEditingComment && !isCollapsed && (
                    <div className="ticket-comment-metadata">
                      {metadataEntries.map(([key, value]) => (
                        <span key={`${comment.id}-${key}`} className="ticket-comment-chip ref">
                          {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {aiLog && (
        <div className="ai-decision-card">
          <h3>KI-Entscheidung & Feedback</h3>
          <div className="decision-content">
            <div className="decision-field">
              <label>KI-Entscheidung</label>
              <p>{aiLog.aiDecision}</p>
            </div>
            {aiLog.aiReasoning && (
              <div className="decision-field">
                <label>KI-Begründung</label>
                <p>{aiLog.aiReasoning}</p>
              </div>
            )}
          </div>

          <div className="feedback-section">
            <h4>Feedback geben</h4>
            <div className="form-group">
              <label htmlFor="category-select">Kategorie überprüfen/korrigieren</label>
              <select
                id="category-select"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                disabled={isSaving}
              >
                <option value="">-- Empfehlung akzeptiert --</option>
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="feedback-textarea">Feedback</label>
              <textarea
                id="feedback-textarea"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Geben Sie Ihr Feedback zur KI-Entscheidung ein..."
                rows={4}
                disabled={isSaving}
              />
            </div>

            <button
              onClick={handleSaveFeedback}
              className="save-feedback-btn"
              disabled={isSaving}
            >
              {isSaving ? 'Wird gespeichert...' : 'Feedback Speichern'}
            </button>
          </div>

          {aiLog.adminFeedback && (
            <div className="past-feedback">
              <h4>Bisheriges Feedback</h4>
              <p>{aiLog.adminFeedback}</p>
              {aiLog.feedbackIsCorrect !== undefined && (
                <p className="feedback-status">
                  Status:{' '}
                  {aiLog.feedbackIsCorrect ? (
                    <>
                      <i className="fa-solid fa-check" /> Hilfreich
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-xmark" /> Nicht hilfreich
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {activeImage && (
        <div className="image-lightbox" role="dialog" aria-modal="true" onClick={() => setActiveImageIndex(null)}>
          <div className="image-lightbox-card" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="image-lightbox-close"
              onClick={() => setActiveImageIndex(null)}
              aria-label="Bildansicht schließen"
            >
              <i className="fa-solid fa-xmark" />
            </button>
            <img
              className="image-lightbox-preview"
              src={activeImage.dataUrl}
              alt={activeImage.fileName || 'Ticket-Bild'}
            />
            <div className="image-lightbox-meta">
              <span>{activeImage.fileName || 'Bild'}</span>
              <span>{formatByteSize(activeImage.byteSize)}</span>
              <a href={activeImage.dataUrl} download={activeImage.fileName || 'ticket-bild'}>
                Download
              </a>
              <button
                type="button"
                className="image-lightbox-inline-btn"
                onClick={() => openImageAnalyzeDialog(activeImage)}
                disabled={!!imageAnalysisBusyById[activeImage.id]}
              >
                {imageAnalysisBusyById[activeImage.id] ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Analysiere...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-sliders" /> Analyse-Optionen
                  </>
                )}
              </button>
              {activeImage.exif?.hasGps && (
                <button
                  type="button"
                  className="image-lightbox-inline-btn"
                  onClick={() => openExifMap(activeImage)}
                >
                  GPS in Leaflet öffnen
                </button>
              )}
            </div>
            {activeImage.exif && (
              <div className="image-lightbox-exif">
                <span className={`ticket-image-exif-chip ${activeImage.exif.hasExif ? 'has-data' : 'no-data'}`}>
                  <i className="fa-solid fa-camera" /> {activeImage.exif.hasExif ? 'EXIF vorhanden' : 'Kein EXIF'}
                </span>
                <span className={`ticket-image-exif-chip ${activeImage.exif.hasGps ? 'has-gps' : 'no-data'}`}>
                  <i className="fa-solid fa-location-dot" />{' '}
                  {activeImage.exif.hasGps
                    ? `${formatCoordinate(activeImage.exif.gpsLatitude)}, ${formatCoordinate(activeImage.exif.gpsLongitude)}`
                    : 'Kein GPS in EXIF'}
                </span>
                {activeImage.exif.hasGps && (
                  <span
                    className="ticket-image-exif-chip clickable"
                    onClick={() => openExifMap(activeImage)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openExifMap(activeImage);
                      }
                    }}
                  >
                    <i className="fa-solid fa-map-location-dot" /> Marker anzeigen
                  </span>
                )}
                {(activeImage.exif.width || activeImage.exif.height || activeImage.exif.format) && (
                  <span className="ticket-image-exif-chip neutral">
                    <i className="fa-solid fa-image" /> {activeImage.exif.width || '–'}×{activeImage.exif.height || '–'}{' '}
                    {activeImage.exif.format ? `· ${activeImage.exif.format.toUpperCase()}` : ''}
                  </span>
                )}
                {activeImage.exif.orientation && (
                  <span className="ticket-image-exif-chip neutral">
                    <i className="fa-solid fa-compass" /> Orientierung: {activeImage.exif.orientation}
                  </span>
                )}
              </div>
            )}
            <div className="image-lightbox-analysis">
              <strong>KI-Bildbeschreibung</strong>
              <p>
                {activeImage.analysis?.description ||
                  (activeImage.analysis?.status === 'failed'
                    ? activeImage.analysis?.error || 'Bildanalyse fehlgeschlagen.'
                    : 'Noch keine KI-Beschreibung vorhanden.')}
              </p>
            </div>
            {showImageNav && (
              <div className="image-lightbox-nav">
                <button
                  type="button"
                  onClick={() =>
                    setActiveImageIndex((prev) => (prev === null ? 0 : (prev - 1 + ticketImages.length) % ticketImages.length))
                  }
                >
                  <i className="fa-solid fa-chevron-left" /> Zurück
                </button>
                <span>
                  {activeImageIndex! + 1} / {ticketImages.length}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setActiveImageIndex((prev) => (prev === null ? 0 : (prev + 1) % ticketImages.length))
                  }
                >
                  Weiter <i className="fa-solid fa-chevron-right" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {imageAnalyzeDialog && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Bildanalyse konfigurieren"
          onClick={() => setImageAnalyzeDialog(null)}
        >
          <div className="image-analysis-dialog-card" onClick={(event) => event.stopPropagation()}>
            <div className="image-analysis-dialog-head">
              <h4>
                <i className="fa-solid fa-sliders" /> KI-Bildanalyse konfigurieren
              </h4>
              <button
                type="button"
                className="image-lightbox-close"
                onClick={() => setImageAnalyzeDialog(null)}
                aria-label="Dialog schließen"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="image-analysis-dialog-meta">
              <span>
                Bild: <strong>{dialogImage?.fileName || imageAnalyzeDialog.imageId}</strong>
              </span>
              {imageModelConnectionName && (
                <span>
                  Route: <strong>{imageModelConnectionName}</strong>
                </span>
              )}
            </div>

            <div className="image-analysis-dialog-grid">
              <label className="image-analysis-dialog-checkbox">
                <input
                  type="checkbox"
                  checked={imageAnalyzeDialog.includeDescription}
                  onChange={(event) =>
                    setImageAnalyzeDialog((prev) =>
                      prev ? { ...prev, includeDescription: event.target.checked } : prev
                    )
                  }
                />
                <span>Beschreibungstext der Meldung einbeziehen</span>
              </label>
              <label className="image-analysis-dialog-checkbox">
                <input
                  type="checkbox"
                  checked={imageAnalyzeDialog.includeOsmData}
                  onChange={(event) =>
                    setImageAnalyzeDialog((prev) => (prev ? { ...prev, includeOsmData: event.target.checked } : prev))
                  }
                />
                <span>OSM-/Nominatim-Daten einbeziehen</span>
              </label>
              <label className="image-analysis-dialog-checkbox">
                <input
                  type="checkbox"
                  checked={imageAnalyzeDialog.includeWeatherData}
                  onChange={(event) =>
                    setImageAnalyzeDialog((prev) =>
                      prev ? { ...prev, includeWeatherData: event.target.checked } : prev
                    )
                  }
                />
                <span>Wetterdaten einbeziehen</span>
              </label>
              <label className="image-analysis-dialog-checkbox">
                <input
                  type="checkbox"
                  checked={imageAnalyzeDialog.force}
                  onChange={(event) =>
                    setImageAnalyzeDialog((prev) => (prev ? { ...prev, force: event.target.checked } : prev))
                  }
                />
                <span>Vorhandene Beschreibung überschreiben</span>
              </label>
            </div>

            <label className="image-analysis-dialog-model">
              <span>Modell</span>
              <select
                value={imageAnalyzeDialog.modelId}
                disabled={imageModelOptionsLoading}
                onChange={(event) =>
                  setImageAnalyzeDialog((prev) => (prev ? { ...prev, modelId: event.target.value } : prev))
                }
              >
                <option value="">Standardmodell der Route verwenden</option>
                {imageModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="image-analysis-dialog-actions">
              <button type="button" className="image-analysis-dialog-btn secondary" onClick={() => setImageAnalyzeDialog(null)}>
                Abbrechen
              </button>
              <button
                type="button"
                className="image-analysis-dialog-btn primary"
                disabled={isImageAnalyzeDialogBusy}
                onClick={() => {
                  const payload = imageAnalyzeDialog;
                  setImageAnalyzeDialog(null);
                  void handleAnalyzeImage(payload);
                }}
              >
                {isImageAnalyzeDialogBusy ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Analysiere...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-wand-magic-sparkles" /> Analyse starten
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {exifMapTarget && (
        <div className="image-lightbox exif-map-overlay" role="dialog" aria-modal="true" onClick={() => setExifMapTarget(null)}>
          <div className="exif-map-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="exif-map-modal-head">
              <h4>
                <i className="fa-solid fa-location-dot" /> EXIF-GPS (Leaflet)
              </h4>
              <button
                type="button"
                className="image-lightbox-close"
                onClick={() => setExifMapTarget(null)}
                aria-label="GPS-Karte schließen"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="exif-map-modal-meta">
              <span>{exifMapTarget.label}</span>
              <span>
                {formatCoordinate(exifMapTarget.latitude)}, {formatCoordinate(exifMapTarget.longitude)}
              </span>
              <a
                href={`https://www.google.com/maps?q=${encodeURIComponent(
                  `${exifMapTarget.latitude},${exifMapTarget.longitude}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Extern öffnen
              </a>
            </div>
            <div ref={exifMapContainerRef} className="exif-map-modal-canvas" />
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketDetail;
