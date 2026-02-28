import { randomUUID } from 'crypto';
import { getDatabase } from '../database.js';
import {
  getSetting,
  loadAiCredentials,
  loadAiSettings,
  loadImageAiSettings,
  setSetting,
} from './settings.js';

const LLM_HUB_SETTING_KEY = 'llmHub';
const MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CHATBOT_SYSTEM_PROMPT = [
  'Du bist der persönliche behebes Assistenz-Bot im Admin-Backend.',
  'Arbeite lösungsorientiert, präzise und mit Verwaltungskontext.',
  'Falls Daten fehlen, stelle gezielte Rückfragen statt zu raten.',
  'Wenn der Kontext unklar ist, kennzeichne Unsicherheiten explizit.',
  'Gib konkrete nächste Schritte und kurze Entscheidungsoptionen.',
].join('\n');

const DEFAULT_CHATBOT_CONTEXT_SOURCES: LlmChatbotContextSources = {
  adminProfile: true,
  accessScopes: true,
  recentTickets: true,
  openNotifications: true,
  aiQueueSummary: false,
};

const DEFAULT_CHATBOT_CAPABILITY_FILTER: LlmChatbotCapabilityFilter = {
  requireVision: false,
  requireTts: false,
  requireImageGeneration: false,
};

export type LlmConnectionAuthMode = 'api_key' | 'oauth';

export interface LlmModelEntry {
  id: string;
  label: string;
  vision: boolean;
  tts: boolean;
  imageGeneration: boolean;
  updatedAt: string;
}

export interface LlmConnection {
  id: string;
  name: string;
  providerType: 'openai_compatible';
  baseUrl: string;
  authMode: LlmConnectionAuthMode;
  apiKey: string;
  oauthTokenId: string;
  enabled: boolean;
  defaultModel: string;
  models: LlmModelEntry[];
  modelsFetchedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LlmTaskRoute {
  connectionId: string;
  modelId: string;
}

export interface LlmTaskRouting {
  defaultRoute: LlmTaskRoute;
  routes: Record<string, LlmTaskRoute>;
}

export interface LlmHubState {
  connections: LlmConnection[];
  taskRouting: LlmTaskRouting;
  chatbotSettings: LlmChatbotSettings;
}

export interface LlmChatbotContextSources {
  adminProfile: boolean;
  accessScopes: boolean;
  recentTickets: boolean;
  openNotifications: boolean;
  aiQueueSummary: boolean;
}

export interface LlmChatbotCapabilityFilter {
  requireVision: boolean;
  requireTts: boolean;
  requireImageGeneration: boolean;
}

export interface LlmChatbotSettings {
  enabled: boolean;
  connectionId: string;
  modelId: string;
  capabilityFilter: LlmChatbotCapabilityFilter;
  systemPrompt: string;
  contextSources: LlmChatbotContextSources;
  maxHistoryMessages: number;
  maxContextChars: number;
  temperature: number;
}

export interface ResolvedLlmRuntime {
  connectionId: string;
  connectionName: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  taskKey: string;
}

export const LLM_TASK_CAPABILITIES: Record<string, { requiresVision: boolean }> = {
  default: { requiresVision: false },
  classification: { requiresVision: false },
  translation: { requiresVision: false },
  ui_translation: { requiresVision: false },
  email_translation: { requiresVision: false },
  image_to_text: { requiresVision: true },
  admin_help: { requiresVision: false },
  category_assistant: { requiresVision: false },
  template_generation: { requiresVision: false },
  template_json_repair: { requiresVision: false },
  template_placeholder_completion: { requiresVision: false },
  redmine_ticket: { requiresVision: false },
  workflow_template_generation: { requiresVision: false },
  workflow_json_repair: { requiresVision: false },
  workflow_template_selection: { requiresVision: false },
  workflow_data_request_need_check: { requiresVision: false },
  workflow_data_request: { requiresVision: false },
  workflow_data_request_answer_evaluation: { requiresVision: false },
  workflow_free_data_request_need_check: { requiresVision: false },
  workflow_free_data_request: { requiresVision: false },
  workflow_free_data_request_answer_evaluation: { requiresVision: false },
  workflow_recategorization: { requiresVision: false },
  workflow_categorization_org_assignment: { requiresVision: false },
  workflow_responsibility_check: { requiresVision: false },
  workflow_confirmation_instruction: { requiresVision: false },
  workflow_internal_task_generation: { requiresVision: false },
  workflow_api_probe_analysis: { requiresVision: false },
  situation_report: { requiresVision: false },
  situation_report_category_workflow: { requiresVision: false },
  situation_report_free_analysis: { requiresVision: false },
  situation_report_memory_compression: { requiresVision: false },
  pseudonym_pool: { requiresVision: false },
  admin_chatbot_assistant: { requiresVision: false },
};

const ROUTABLE_TASKS = Object.keys(LLM_TASK_CAPABILITIES);

function sanitizeId(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

function sanitizeText(value: unknown, maxLength = 200): string {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function normalizeFloat(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeBaseUrl(value: unknown): string {
  const fallback = 'https://api.openai.com/v1';
  const raw = sanitizeText(value, 400);
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/+$/g, '') || '/v1';
    return url.toString().replace(/\/+$/g, '');
  } catch {
    return fallback;
  }
}

function normalizeModelId(value: unknown): string {
  return sanitizeText(value, 200);
}

function detectVisionCapability(input: any): boolean {
  const modelId = String(input?.id || input?.name || input?.model || '').toLowerCase();
  const modalitiesRaw = Array.isArray(input?.modalities)
    ? input.modalities
    : Array.isArray(input?.input_modalities)
    ? input.input_modalities
    : [];
  const modalities = modalitiesRaw.map((entry: any) => String(entry || '').toLowerCase());
  if (modalities.includes('image') || modalities.includes('vision')) return true;
  return /vision|omni|gpt-4o|gpt-4\.1|gpt-5|claude-3|gemini/.test(modelId);
}

function detectTtsCapability(input: any): boolean {
  const modelId = String(input?.id || input?.name || input?.model || '').toLowerCase();
  const modalitiesRaw = Array.isArray(input?.modalities)
    ? input.modalities
    : Array.isArray(input?.output_modalities)
    ? input.output_modalities
    : [];
  const modalities = modalitiesRaw.map((entry: any) => String(entry || '').toLowerCase());
  if (modalities.includes('audio') || modalities.includes('speech')) return true;
  return /tts|speech|audio|gpt-4o-mini-tts|gpt-4o-audio|gpt-4o-realtime/.test(modelId);
}

function detectImageGenerationCapability(input: any): boolean {
  const modelId = String(input?.id || input?.name || input?.model || '').toLowerCase();
  const capabilitiesRaw = Array.isArray(input?.capabilities) ? input.capabilities : [];
  const capabilities = capabilitiesRaw.map((entry: any) => String(entry || '').toLowerCase());
  if (capabilities.includes('image_generation') || capabilities.includes('images.generate')) return true;
  return /gpt-image|dall-e|image-gen|image_generation|images/.test(modelId);
}

function normalizeModelEntry(input: any): LlmModelEntry | null {
  const id = normalizeModelId(input?.id || input?.name || input?.model);
  if (!id) return null;
  const label = sanitizeText(input?.label || id, 200) || id;
  return {
    id,
    label,
    vision: detectVisionCapability(input),
    tts: detectTtsCapability(input),
    imageGeneration: detectImageGenerationCapability(input),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeTaskRoute(input: unknown): LlmTaskRoute {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    connectionId: sanitizeId(source.connectionId),
    modelId: normalizeModelId(source.modelId),
  };
}

function normalizeTaskRouting(input: unknown): LlmTaskRouting {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const routesSource =
    source.routes && typeof source.routes === 'object' && !Array.isArray(source.routes)
      ? (source.routes as Record<string, unknown>)
      : {};
  const routes: Record<string, LlmTaskRoute> = {};
  for (const task of ROUTABLE_TASKS) {
    if (!Object.prototype.hasOwnProperty.call(routesSource, task)) continue;
    routes[task] = normalizeTaskRoute(routesSource[task]);
  }
  return {
    defaultRoute: normalizeTaskRoute(source.defaultRoute),
    routes,
  };
}

function normalizeChatbotSettings(input: unknown): LlmChatbotSettings {
  const root = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const nestedSettings =
    root.settings && typeof root.settings === 'object' && !Array.isArray(root.settings)
      ? (root.settings as Record<string, unknown>)
      : null;
  const source = nestedSettings || root;
  const capabilityFilterRaw =
    source.capabilityFilter && typeof source.capabilityFilter === 'object'
      ? (source.capabilityFilter as Record<string, unknown>)
      : {};
  const contextSourcesRaw =
    source.contextSources && typeof source.contextSources === 'object'
      ? (source.contextSources as Record<string, unknown>)
      : {};
  return {
    enabled: normalizeBoolean(source.enabled, true),
    connectionId: sanitizeId(
      source.connectionId ||
        source.connection ||
        source.connection_id ||
        source.providerConnectionId ||
        source.provider_connection_id
    ),
    modelId: normalizeModelId(
      source.modelId ||
        source.model ||
        source.model_id ||
        source.aiModel ||
        source.ai_model
    ),
    capabilityFilter: {
      requireVision: normalizeBoolean(
        capabilityFilterRaw.requireVision,
        DEFAULT_CHATBOT_CAPABILITY_FILTER.requireVision
      ),
      requireTts: normalizeBoolean(capabilityFilterRaw.requireTts, DEFAULT_CHATBOT_CAPABILITY_FILTER.requireTts),
      requireImageGeneration: normalizeBoolean(
        capabilityFilterRaw.requireImageGeneration,
        DEFAULT_CHATBOT_CAPABILITY_FILTER.requireImageGeneration
      ),
    },
    systemPrompt:
      sanitizeText(source.systemPrompt, 12000) || DEFAULT_CHATBOT_SYSTEM_PROMPT,
    contextSources: {
      adminProfile: normalizeBoolean(
        contextSourcesRaw.adminProfile,
        DEFAULT_CHATBOT_CONTEXT_SOURCES.adminProfile
      ),
      accessScopes: normalizeBoolean(
        contextSourcesRaw.accessScopes,
        DEFAULT_CHATBOT_CONTEXT_SOURCES.accessScopes
      ),
      recentTickets: normalizeBoolean(
        contextSourcesRaw.recentTickets,
        DEFAULT_CHATBOT_CONTEXT_SOURCES.recentTickets
      ),
      openNotifications: normalizeBoolean(
        contextSourcesRaw.openNotifications,
        DEFAULT_CHATBOT_CONTEXT_SOURCES.openNotifications
      ),
      aiQueueSummary: normalizeBoolean(
        contextSourcesRaw.aiQueueSummary,
        DEFAULT_CHATBOT_CONTEXT_SOURCES.aiQueueSummary
      ),
    },
    maxHistoryMessages: normalizeInteger(source.maxHistoryMessages, 16, 4, 80),
    maxContextChars: normalizeInteger(source.maxContextChars, 12000, 2000, 100000),
    temperature: normalizeFloat(source.temperature, 0.2, 0, 1.5),
  };
}

function normalizeConnection(input: unknown): LlmConnection | null {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const id = sanitizeId(source.id);
  if (!id) return null;
  const authMode: LlmConnectionAuthMode = source.authMode === 'oauth' ? 'oauth' : 'api_key';
  const modelsRaw = Array.isArray(source.models) ? source.models : [];
  const models = modelsRaw
    .map((entry) => normalizeModelEntry(entry))
    .filter((entry): entry is LlmModelEntry => entry !== null)
    .slice(0, 300);
  const now = new Date().toISOString();
  return {
    id,
    name: sanitizeText(source.name || id, 120) || id,
    providerType: 'openai_compatible',
    baseUrl: normalizeBaseUrl(source.baseUrl),
    authMode,
    apiKey: authMode === 'api_key' ? sanitizeText(source.apiKey, 600) : '',
    oauthTokenId: authMode === 'oauth' ? sanitizeText(source.oauthTokenId, 160) : '',
    enabled: source.enabled !== false,
    defaultModel: normalizeModelId(source.defaultModel),
    models,
    modelsFetchedAt: sanitizeText(source.modelsFetchedAt, 80),
    createdAt: sanitizeText(source.createdAt, 80) || now,
    updatedAt: sanitizeText(source.updatedAt, 80) || now,
  };
}

function normalizeHubState(input: unknown): LlmHubState {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const connectionsRaw = Array.isArray(source.connections) ? source.connections : [];
  const seen = new Set<string>();
  const connections: LlmConnection[] = [];
  for (const entry of connectionsRaw) {
    const normalized = normalizeConnection(entry);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    connections.push(normalized);
  }
  return {
    connections,
    taskRouting: normalizeTaskRouting(source.taskRouting),
    chatbotSettings: normalizeChatbotSettings(source.chatbotSettings),
  };
}

function inferTaskKeyFromPurpose(purposeInput: unknown): string {
  const purpose = String(purposeInput || '').trim().toLowerCase();
  if (!purpose) return 'default';

  if (purpose.includes('image_to_text') || (purpose.includes('image') && purpose.includes('text'))) {
    return 'image_to_text';
  }
  if (purpose.includes('classif')) return 'classification';

  if (
    purpose.includes('workflow_data_request_ui_locale_prefill') ||
    purpose.includes('workflow_data_request_citizen_target') ||
    purpose.includes('workflow_data_request_admin_german') ||
    purpose.includes('workflow_data_request_answers_to_german') ||
    purpose.includes('ui_translation')
  ) {
    return 'ui_translation';
  }
  if (
    purpose.includes('email_template_data_translation') ||
    purpose.includes('email_translation')
  ) {
    return 'email_translation';
  }
  if (purpose.includes('translation')) return 'translation';

  if (purpose.includes('category_assistant')) return 'category_assistant';
  if (purpose.includes('admin_help') || purpose.includes('help')) return 'admin_help';

  if (purpose.includes('email_template_generate')) return 'template_generation';
  if (purpose.includes('workflow_redmine_ai')) return 'redmine_ticket';
  if (purpose.includes('workflow_template_generate')) return 'workflow_template_generation';
  if (purpose.includes('workflow_template_select')) return 'workflow_template_selection';
  if (purpose.includes('workflow_rest_api_probe_analysis')) return 'workflow_api_probe_analysis';
  if (purpose.includes('workflow_internal_processing_generate')) return 'workflow_internal_task_generation';
  if (purpose.includes('workflow_confirmation_instruction')) return 'workflow_confirmation_instruction';
  if (purpose.includes('workflow_responsibility_check')) return 'workflow_responsibility_check';
  if (purpose.includes('workflow_categorization_org_assignment')) return 'workflow_categorization_org_assignment';
  if (purpose.includes('workflow_change_workflow_recategorization')) return 'workflow_recategorization';

  if (purpose.includes('workflow_enhanced_categorization_need_check')) {
    return 'workflow_data_request_need_check';
  }
  if (purpose.includes('workflow_free_data_request_need_check')) {
    return 'workflow_free_data_request_need_check';
  }
  if (purpose.includes('workflow_data_request_apply')) {
    return 'workflow_data_request_answer_evaluation';
  }
  if (purpose.includes('workflow_free_data_request_apply')) {
    return 'workflow_free_data_request_answer_evaluation';
  }
  if (purpose.includes('workflow_enhanced_categorization')) {
    return 'workflow_data_request';
  }
  if (purpose.includes('workflow_free_data_request')) {
    return 'workflow_free_data_request';
  }
  if (purpose.includes('workflow_data_request')) {
    return 'workflow_data_request';
  }

  if (purpose.includes('admin_pseudonym') || purpose.includes('pseudonym_pool')) {
    return 'pseudonym_pool';
  }
  if (purpose.includes('admin_situation_report_memory')) {
    return 'situation_report_memory_compression';
  }
  if (purpose.includes('admin_situation_report_category_workflow')) {
    return 'situation_report_category_workflow';
  }
  if (purpose.includes('admin_situation_report_free_analysis')) {
    return 'situation_report_free_analysis';
  }
  if (purpose.includes('situation')) return 'situation_report';

  return 'default';
}

async function readOauthToken(tokenId: string): Promise<string> {
  const normalized = sanitizeText(tokenId, 160);
  if (!normalized) return '';
  const db = getDatabase();
  const row = await db.get(
    `SELECT access_token
     FROM oauth_tokens
     WHERE id = ?
     LIMIT 1`,
    [normalized]
  );
  return sanitizeText(row?.access_token, 1200);
}

async function resolveConnectionApiKey(connection: LlmConnection): Promise<string> {
  if (connection.authMode === 'oauth') {
    return readOauthToken(connection.oauthTokenId);
  }
  return sanitizeText(connection.apiKey, 1200);
}

async function fetchOpenAiCompatibleModels(connection: LlmConnection): Promise<LlmModelEntry[]> {
  const apiKey = await resolveConnectionApiKey(connection);
  if (!apiKey) return connection.models || [];
  const base = normalizeBaseUrl(connection.baseUrl).replace(/\/+$/g, '').replace(/\/v1$/g, '');
  const candidates = [`${base}/v1/models`, `${base}/models`, `${base}/v1/provider-models`];
  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'behebes.AI/1.0.0 (LLM Hub)',
        },
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as any;
      const list = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
        ? payload.models
        : [];
      if (!Array.isArray(list)) continue;
      const models = list
        .map((entry: any) => normalizeModelEntry(entry))
        .filter((entry: LlmModelEntry | null): entry is LlmModelEntry => entry !== null)
        .slice(0, 500);
      if (models.length > 0) {
        return models;
      }
    } catch {
      // try next endpoint
    }
  }
  return connection.models || [];
}

async function migrateLegacyState(state: LlmHubState): Promise<LlmHubState> {
  if (state.connections.length > 0) return state;

  const now = new Date().toISOString();
  const connections: LlmConnection[] = [];
  const aiSettings = await loadAiSettings();
  const aiCredentials = await loadAiCredentials(false);
  const imageAi = await loadImageAiSettings(false);

  if (aiCredentials.values.askcodiApiKey) {
    connections.push({
      id: 'legacy-askcodi',
      name: 'Legacy AskCodi',
      providerType: 'openai_compatible',
      baseUrl: normalizeBaseUrl(aiCredentials.values.askcodiBaseUrl || 'https://api.askcodi.com/v1'),
      authMode: 'api_key',
      apiKey: aiCredentials.values.askcodiApiKey,
      oauthTokenId: '',
      enabled: true,
      defaultModel: normalizeModelId(aiSettings.values.model || 'openai/gpt-5-mini'),
      models: [],
      modelsFetchedAt: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  const openAiApiKey = sanitizeText(process.env.OPENAI_API_KEY, 1200);
  if (openAiApiKey) {
    connections.push({
      id: 'legacy-openai',
      name: 'Legacy OpenAI',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      authMode: 'api_key',
      apiKey: openAiApiKey,
      oauthTokenId: '',
      enabled: true,
      defaultModel: 'gpt-4o',
      models: [],
      modelsFetchedAt: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (imageAi.values.enabled && imageAi.values.apiKey) {
    connections.push({
      id: 'legacy-image-ai',
      name: 'Legacy Bild-KI',
      providerType: 'openai_compatible',
      baseUrl: normalizeBaseUrl(imageAi.values.baseUrl || 'https://api.openai.com/v1'),
      authMode: 'api_key',
      apiKey: imageAi.values.apiKey,
      oauthTokenId: '',
      enabled: true,
      defaultModel: normalizeModelId(imageAi.values.model || 'gpt-4o-mini'),
      models: [],
      modelsFetchedAt: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (connections.length === 0) {
    connections.push({
      id: 'default-openai-compatible',
      name: 'Standard OpenAI-kompatibel',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      authMode: 'api_key',
      apiKey: '',
      oauthTokenId: '',
      enabled: true,
      defaultModel: normalizeModelId(aiSettings.values.model || 'gpt-4o-mini'),
      models: [],
      modelsFetchedAt: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  const primaryConnectionId =
    aiSettings.values.provider === 'askcodi'
      ? connections.find((entry) => entry.id === 'legacy-askcodi')?.id || connections[0].id
      : connections.find((entry) => entry.id === 'legacy-openai')?.id || connections[0].id;

  const defaultModel = normalizeModelId(aiSettings.values.model || connections[0].defaultModel || 'gpt-4o-mini');
  const imageRouteConnectionId =
    connections.find((entry) => entry.id === 'legacy-image-ai')?.id || primaryConnectionId;
  const imageRouteModel = normalizeModelId(imageAi.values.model || defaultModel);

  return {
    connections,
    taskRouting: {
      defaultRoute: {
        connectionId: primaryConnectionId,
        modelId: defaultModel,
      },
      routes: {
        image_to_text: {
          connectionId: imageRouteConnectionId,
          modelId: imageRouteModel,
        },
      },
    },
    chatbotSettings: normalizeChatbotSettings({
      connectionId: primaryConnectionId,
      modelId: defaultModel,
    }),
  };
}

async function persistHubState(state: LlmHubState): Promise<LlmHubState> {
  const normalized = normalizeHubState(state);
  await setSetting(LLM_HUB_SETTING_KEY, normalized);
  return normalized;
}

export async function loadLlmHubState(): Promise<LlmHubState> {
  const stored = await getSetting<LlmHubState>(LLM_HUB_SETTING_KEY);
  let normalized = normalizeHubState(stored);
  const migrated = await migrateLegacyState(normalized);
  if (JSON.stringify(migrated) !== JSON.stringify(normalized)) {
    normalized = await persistHubState(migrated);
  }
  return normalized;
}

export async function listLlmConnections(maskSecrets = true): Promise<LlmConnection[]> {
  const state = await loadLlmHubState();
  if (!maskSecrets) return state.connections;
  return state.connections.map((entry) => ({
    ...entry,
    apiKey: entry.apiKey ? '***' : '',
  }));
}

export async function upsertLlmConnection(input: Partial<LlmConnection> & { id?: string }): Promise<LlmConnection> {
  const state = await loadLlmHubState();
  const now = new Date().toISOString();
  const requestedId = sanitizeId(input.id) || `conn-${randomUUID().slice(0, 8)}`;
  const existingIndex = state.connections.findIndex((entry) => entry.id === requestedId);
  const existing = existingIndex >= 0 ? state.connections[existingIndex] : null;

  const next: LlmConnection = {
    id: requestedId,
    name: sanitizeText(input.name || existing?.name || requestedId, 120) || requestedId,
    providerType: 'openai_compatible',
    baseUrl: normalizeBaseUrl(input.baseUrl || existing?.baseUrl),
    authMode: input.authMode === 'oauth' ? 'oauth' : input.authMode === 'api_key' ? 'api_key' : existing?.authMode || 'api_key',
    apiKey:
      input.apiKey === '***'
        ? existing?.apiKey || ''
        : sanitizeText(input.apiKey, 1200) || existing?.apiKey || '',
    oauthTokenId: sanitizeText(input.oauthTokenId || existing?.oauthTokenId, 160),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : existing?.enabled !== false,
    defaultModel: normalizeModelId(input.defaultModel || existing?.defaultModel),
    models: Array.isArray(input.models)
      ? input.models
          .map((entry) => normalizeModelEntry(entry))
          .filter((entry): entry is LlmModelEntry => entry !== null)
      : existing?.models || [],
    modelsFetchedAt: sanitizeText(input.modelsFetchedAt || existing?.modelsFetchedAt, 80),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    state.connections[existingIndex] = next;
  } else {
    state.connections.push(next);
  }
  await persistHubState(state);
  return next;
}

export async function deleteLlmConnection(connectionId: string): Promise<boolean> {
  const normalizedId = sanitizeId(connectionId);
  if (!normalizedId) return false;
  const state = await loadLlmHubState();
  const nextConnections = state.connections.filter((entry) => entry.id !== normalizedId);
  if (nextConnections.length === state.connections.length) return false;
  const taskRouting = normalizeTaskRouting(state.taskRouting);
  const fallbackConnectionId = nextConnections[0]?.id || '';

  const sanitizeRoute = (route: LlmTaskRoute): LlmTaskRoute => {
    if (route.connectionId !== normalizedId) return route;
    return {
      connectionId: fallbackConnectionId,
      modelId: '',
    };
  };
  taskRouting.defaultRoute = sanitizeRoute(taskRouting.defaultRoute);
  for (const taskKey of Object.keys(taskRouting.routes)) {
    taskRouting.routes[taskKey] = sanitizeRoute(taskRouting.routes[taskKey]);
  }

  await persistHubState({
    connections: nextConnections,
    taskRouting,
    chatbotSettings: normalizeChatbotSettings(state.chatbotSettings),
  });
  return true;
}

export async function loadLlmTaskRouting(): Promise<LlmTaskRouting> {
  const state = await loadLlmHubState();
  return normalizeTaskRouting(state.taskRouting);
}

export async function saveLlmTaskRouting(input: unknown): Promise<LlmTaskRouting> {
  const state = await loadLlmHubState();
  const nextRouting = normalizeTaskRouting(input);
  state.taskRouting = nextRouting;
  await persistHubState(state);
  return nextRouting;
}

export function modelMatchesCapabilityFilter(
  model: LlmModelEntry,
  filter?: Partial<LlmChatbotCapabilityFilter> | null
): boolean {
  if (!model) return false;
  if (!filter) return true;
  if (filter.requireVision && !model.vision) return false;
  if (filter.requireTts && !model.tts) return false;
  if (filter.requireImageGeneration && !model.imageGeneration) return false;
  return true;
}

export async function loadLlmChatbotSettings(): Promise<LlmChatbotSettings> {
  const state = await loadLlmHubState();
  return normalizeChatbotSettings(state.chatbotSettings);
}

export async function saveLlmChatbotSettings(input: unknown): Promise<LlmChatbotSettings> {
  const state = await loadLlmHubState();
  const current = normalizeChatbotSettings(state.chatbotSettings);
  const incoming = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const merged = normalizeChatbotSettings({
    ...current,
    ...incoming,
    capabilityFilter: {
      ...current.capabilityFilter,
      ...(incoming.capabilityFilter && typeof incoming.capabilityFilter === 'object'
        ? (incoming.capabilityFilter as Record<string, unknown>)
        : {}),
    },
    contextSources: {
      ...current.contextSources,
      ...(incoming.contextSources && typeof incoming.contextSources === 'object'
        ? (incoming.contextSources as Record<string, unknown>)
        : {}),
    },
  });
  state.chatbotSettings = merged;
  await persistHubState(state);
  return merged;
}

export async function getConnectionModels(
  connectionId: string,
  options?: { refresh?: boolean }
): Promise<LlmModelEntry[]> {
  const normalizedId = sanitizeId(connectionId);
  const state = await loadLlmHubState();
  const connection = state.connections.find((entry) => entry.id === normalizedId);
  if (!connection) return [];

  const shouldRefresh =
    options?.refresh === true ||
    !connection.modelsFetchedAt ||
    Date.now() - Date.parse(connection.modelsFetchedAt || '') > MODEL_CACHE_TTL_MS;
  if (!shouldRefresh) {
    return connection.models || [];
  }

  const models = await fetchOpenAiCompatibleModels(connection);
  const now = new Date().toISOString();
  const nextConnection: LlmConnection = {
    ...connection,
    models,
    modelsFetchedAt: now,
    updatedAt: now,
  };
  const index = state.connections.findIndex((entry) => entry.id === normalizedId);
  if (index >= 0) {
    state.connections[index] = nextConnection;
    await persistHubState(state);
  }
  return models;
}

export async function resolveLlmRuntimeSelection(input?: {
  purpose?: string;
  taskKey?: string;
  connectionId?: string;
  modelId?: string;
}): Promise<ResolvedLlmRuntime> {
  const state = await loadLlmHubState();
  const taskRouting = normalizeTaskRouting(state.taskRouting);
  const taskKey = sanitizeId(input?.taskKey) || inferTaskKeyFromPurpose(input?.purpose) || 'default';
  const taskRoute = taskRouting.routes[taskKey] || taskRouting.defaultRoute;

  const explicitConnectionId = sanitizeId(input?.connectionId);
  const routedConnectionId = sanitizeId(taskRoute?.connectionId);
  const fallbackConnection = state.connections.find((entry) => entry.enabled !== false) || state.connections[0];
  const selectedConnection =
    state.connections.find((entry) => entry.id === explicitConnectionId && entry.enabled !== false) ||
    state.connections.find((entry) => entry.id === routedConnectionId && entry.enabled !== false) ||
    fallbackConnection;

  if (!selectedConnection) {
    return {
      connectionId: '',
      connectionName: 'Unconfigured',
      model: normalizeModelId(input?.modelId) || 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      taskKey,
    };
  }

  const explicitModel = normalizeModelId(input?.modelId);
  const routedModel = normalizeModelId(taskRoute?.modelId);
  const selectedModel =
    explicitModel ||
    routedModel ||
    normalizeModelId(selectedConnection.defaultModel) ||
    selectedConnection.models?.[0]?.id ||
    'gpt-4o-mini';
  const apiKey = await resolveConnectionApiKey(selectedConnection);

  return {
    connectionId: selectedConnection.id,
    connectionName: selectedConnection.name,
    model: selectedModel,
    baseUrl: normalizeBaseUrl(selectedConnection.baseUrl),
    apiKey,
    taskKey,
  };
}

export async function listVisionCapableModels(connectionId: string): Promise<LlmModelEntry[]> {
  const models = await getConnectionModels(connectionId, { refresh: false });
  return models.filter((entry) => entry.vision);
}
