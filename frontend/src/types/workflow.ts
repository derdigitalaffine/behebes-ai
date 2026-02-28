/**
 * Workflow Types
 */

export type ExecutionMode = 'MANUAL' | 'AUTO' | 'HYBRID';
export type StepType = 'REDMINE_TICKET' | 'EMAIL' | 'EMAIL_EXTERNAL' | 'EMAIL_CONFIRMATION' | 'CUSTOM';
export type StepStatus = 'PENDING' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  type: StepType;
  status: StepStatus;
  config: {
    // For REDMINE_TICKET steps
    selectionMode?: 'ai' | 'manual';
    projectId?: string;
    tracker?: string;
    assigneeId?: string;
    titleTemplate?: string;
    descriptionTemplate?: string;

    // For EMAIL steps
    templateId?: string;
    recipientId?: string;
    recipientEmail?: string;
    recipientName?: string;
    recipientType?: 'citizen' | 'external' | 'custom';

    // For CUSTOM steps
    customData?: Record<string, any>;
  };
  executionData?: {
    startedAt?: string;
    completedAt?: string;
    result?: string;
    error?: string;
  };
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  description: string;
  submissionId?: string;
  steps: WorkflowStep[];
  executionMode: ExecutionMode;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  currentStepIndex: number;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    category?: string;
    urgency?: string;
    assignedTo?: string;
  };
}

export interface WorkflowContext {
  submission?: {
    id: string;
    name: string;
    email: string;
    description: string;
    address?: string;
    category?: string;
  };
  redmineProjectId?: string;
}
