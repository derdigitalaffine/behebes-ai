/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 */

// Citizen / Bürgerdaten
export interface Citizen {
  id: string;
  email: string;
  name: string;
  imagePath?: string;
  createdAt: string;
  updatedAt: string;
}

// Chat Session (für Chatbot-Meldungen)
export interface ChatSession {
  id: string;
  citizenEmail: string;
  status: 'active' | 'pending_verification' | 'completed' | 'expired';
  extractedData: {
    description?: string;
    latitude?: number;
    longitude?: number;
    address?: string;
    postalCode?: string;
    city?: string;
    category?: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
  };
  verificationToken?: string;
  messages: ChatMessage[];
  createdAt: string;
  expiresAt: string;
  submissionId?: string; // After verification
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// Submission / Meldung (anonymisiert)
export interface Submission {
  id: string;
  citizenId: string;
  anonymizedText: string;
  originalDescription?: string;
  category?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  latitude?: number;
  longitude?: number;
  address?: string;
  postalCode?: string;
  city?: string;
  nominatimRawJson?: string;
  weatherReportJson?: string;
  status: 'pending' | 'processing' | 'pending_validation' | 'completed' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

// Ticket (nach KI-Verarbeitung)
export interface Ticket {
  id: string;
  submissionId: string;
  citizenId: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'assigned' | 'in-progress' | 'pending_validation' | 'completed' | 'closed';
  description?: string;
  originalDescription?: string;
  anonymizedText?: string;
  validationToken?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  postalCode?: string;
  city?: string;
  nominatimRawJson?: string;
  weatherReportJson?: string;
  redmineIssueId?: number;
  redmineProject?: string;
  assignedTo?: string;
  learningMode: boolean;
  createdAt: string;
  updatedAt: string;
}

// AI Log / KI-Entscheidung
export interface AILog {
  id: string;
  ticketId: string;
  submissionId: string;
  knowledgeVersion?: string;
  aiDecision: string;
  aiReasoning?: string;
  adminFeedback?: string;
  feedbackIsCorrect?: boolean;
  originalCategory?: string;
  correctedCategory?: string;
  createdAt: string;
  updatedAt: string;
}

// Admin User
export interface AdminUser {
  id: string;
  username: string;
  passwordHash: string;
  role: 'ADMIN' | 'SACHBEARBEITER' | 'SUPERADMIN' | 'MODERATOR' | 'VIEWER';
  email?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  workPhone?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// OAuth Token
export interface OAuthToken {
  id: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
  createdAt: string;
  updatedAt: string;
}

// Request/Response DTOs
export interface CreateSubmissionRequest {
  citizenName: string;
  citizenEmail: string;
  citizenImage?: string; // base64
  description: string;
}

export interface SubmissionResponse {
  ticketId: string;
  message: string;
}

export interface AIToolInput {
  method: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
  to?: string;
  subject?: string;
  text?: string;
  ticketId?: string;
  category?: string;
  priority?: string;
  description?: string;
  action?: string;
  reasoning?: string;
}

// Wissensdatenbank Types
export interface KnowledgeBase {
  version: string;
  categories: Category[];
  assignments: Assignment[];
  escalation: EscalationRule[];
  prompts: PromptVersion[];
  rules: CustomRule[];
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  defaultPriority?: 'low' | 'medium' | 'high' | 'critical';
  keywords?: string[];
  externalRecipientEmail?: string;
  externalRecipientName?: string;
  internalOrgUnitId?: string;
  processingMode?: 'internal' | 'external';
}

export interface Assignment {
  id: string;
  condition: string; // "contains:Wasser" oder "category:Abfall"
  assignedTo: string; // Abteilung oder Person
  department?: string;
}

export interface EscalationRule {
  id: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  condition?: string;
  escalateTo: string;
  notifyEmailTemplate?: string;
}

export interface PromptVersion {
  version: string;
  systemPrompt: string;
  createdAt: string;
  createdBy?: string;
  active: boolean;
}

export interface CustomRule {
  id: string;
  name: string;
  condition: string; // JSON logic or simple string matching
  action: string; // "require_approval", "auto_escalate", etc.
}
