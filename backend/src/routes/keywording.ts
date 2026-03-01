import express, { Request, Response } from 'express';
import { authMiddleware, staffOnly } from '../middleware/auth.js';
import { getDatabase } from '../database.js';
import { buildAdminCapabilities, loadAdminAccessContext } from '../services/rbac.js';
import { getSystemPrompt } from '../services/settings.js';
import { testAIProvider } from '../services/ai.js';

const router = express.Router();
router.use(authMiddleware, staffOnly);

const runningJobs = new Set<string>();

const STOP_WORDS = new Set(
  [
    'und', 'oder', 'der', 'die', 'das', 'ein', 'eine', 'einer', 'eines', 'mit', 'ohne', 'fuer', 'für', 'von', 'im', 'in',
    'am', 'an', 'zu', 'zur', 'zum', 'auf', 'aus', 'bei', 'ist', 'sind', 'wird', 'werden', 'hat', 'haben', 'als', 'des',
    'den', 'dem', 'nach', 'vor', 'ueber', 'über', 'unter', 'auch', 'nur', 'mehr', 'alle', 'kein', 'keine', 'sowie',
    'service', 'leistung', 'leistungen', 'online', 'antrag', 'beantragen', 'zustandig', 'zuständig', 'kommunal',
  ].map((entry) => entry.toLowerCase())
);

const GENERIC_KEYWORD_BLACKLIST = new Set(
  [
    'amt',
    'aemter',
    'ämter',
    'anfrage',
    'anfragen',
    'anliegen',
    'bearbeitung',
    'behoerde',
    'behörde',
    'dienst',
    'dienste',
    'formular',
    'formulare',
    'formularwesen',
    'kommune',
    'kommunalverwaltung',
    'prozess',
    'prozesse',
    'sachbearbeitung',
    'serviceportal',
    'stelle',
    'stellen',
    'vorgang',
    'vorgaenge',
    'vorgänge',
    'verwaltung',
    'workflow',
    'workflowschritt',
    'zustaendigkeit',
    'zuständigkeit',
  ].map((entry) => entry.toLowerCase())
);

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stripHtml(input: string): string {
  if (!input) return '';
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKeyword(raw: unknown): string {
  return normalizeText(raw).replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeKeywordMatchKey(raw: unknown): string {
  const keyword = normalizeKeyword(raw);
  if (!keyword) return '';
  const tokens = tokenize(keyword).slice(0, 8);
  if (tokens.length > 0) return tokens.join(' ');
  return keyword
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9äöüß]+/gi, '');
}

function splitTokens(text: string): string[] {
  return tokenize(text).slice(0, 64);
}

function isKeywordAllowed(raw: unknown): boolean {
  const keyword = normalizeKeyword(raw);
  if (!keyword) return false;
  if (keyword.length < 3) return false;
  if (keyword.length > 80) return false;
  if (/https?:\/\//i.test(keyword)) return false;
  if (/@/.test(keyword)) return false;
  if (/^\d+$/.test(keyword)) return false;
  if (keyword.split(' ').length > 6) return false;

  const normalized = keyword
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!normalized) return false;
  if (STOP_WORDS.has(normalized) || GENERIC_KEYWORD_BLACKLIST.has(normalized)) return false;

  const tokenList = splitTokens(normalized);
  if (tokenList.length === 0) return false;
  if (tokenList.length === 1 && tokenList[0].length < 4) return false;
  if (tokenList.every((token) => STOP_WORDS.has(token) || GENERIC_KEYWORD_BLACKLIST.has(token))) return false;
  return true;
}

function parseKeywordArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeKeyword(entry)).filter(Boolean);
  }
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => normalizeKeyword(entry)).filter(Boolean);
      }
    } catch {
      // ignore
    }
  }
  return trimmed
    .split(/[\n,;|]+/g)
    .map((entry) => normalizeKeyword(entry))
    .filter(Boolean);
}

function serializeKeywords(input: string[]): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input || []) {
    const keyword = normalizeKeyword(raw);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
    if (out.length >= 250) break;
  }
  return out.length > 0 ? JSON.stringify(out) : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeScore(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return clamp(numeric, 0, 1);
}

function tokenize(text: string): string[] {
  if (!text) return [];
  const normalized = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9äöüß\-\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const rawTokens = normalized.split(' ');
  const out: string[] = [];
  for (const token of rawTokens) {
    const cleaned = token.replace(/^-+|-+$/g, '');
    if (!cleaned) continue;
    if (cleaned.length < 3) continue;
    if (/^\d+$/.test(cleaned)) continue;
    if (STOP_WORDS.has(cleaned)) continue;
    out.push(cleaned);
    if (out.length >= 2000) break;
  }
  return out;
}

function buildNgrams(tokens: string[], min = 2, max = 2): string[] {
  const out: string[] = [];
  for (let size = min; size <= max; size += 1) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      const joined = tokens.slice(index, index + size).join(' ');
      if (!joined) continue;
      out.push(joined);
    }
  }
  return out;
}

function scoreTokenOverlap(referenceTokens: string[], candidateTokens: string[]): number {
  if (referenceTokens.length === 0 || candidateTokens.length === 0) return 0;
  const referenceSet = new Set(referenceTokens);
  const candidateSet = new Set(candidateTokens);
  let overlap = 0;
  candidateSet.forEach((token) => {
    if (referenceSet.has(token)) overlap += 1;
  });
  return clamp(overlap / Math.max(1, candidateSet.size), 0, 1);
}

function extractJsonPayload(raw: string): any {
  const trimmed = String(raw || '').trim();
  if (!trimmed) throw new Error('Leere KI-Antwort');
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }
  const markerMatch = trimmed.match(/BEGIN_JSON\s*([\s\S]*?)\s*END_JSON/i);
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = markerMatch ? markerMatch[1].trim() : fencedMatch ? fencedMatch[1].trim() : trimmed;
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objectMatch) throw new Error('Kein JSON-Objekt gefunden');
  return JSON.parse(objectMatch[0]);
}

async function resolveAccess(req: Request) {
  const userId = normalizeText(req.userId);
  const role = normalizeText(req.role);
  const access = await loadAdminAccessContext(userId, role);
  const capabilities = new Set(buildAdminCapabilities(access));
  return { userId, access, capabilities };
}

function canManageKeywording(capabilities: Set<string>): boolean {
  return (
    capabilities.has('users.manage') ||
    capabilities.has('settings.organization.global.manage') ||
    capabilities.has('settings.organization.tenant.manage') ||
    capabilities.has('settings.categories.manage')
  );
}

function resolveTenantId(
  access: Awaited<ReturnType<typeof loadAdminAccessContext>>,
  requestedTenantIdRaw: unknown
): { tenantId: string | null; error?: string } {
  const requestedTenantId = normalizeText(requestedTenantIdRaw);
  if (access.isGlobalAdmin) {
    if (!requestedTenantId) return { tenantId: null, error: 'Im globalen Kontext muss tenantId angegeben werden.' };
    return { tenantId: requestedTenantId };
  }
  const tenantIds = Array.from(new Set((access.tenantIds || []).map((entry) => normalizeText(entry)).filter(Boolean)));
  if (tenantIds.length === 0) {
    return { tenantId: null, error: 'Keine Mandanten im Zugriffskontext vorhanden.' };
  }
  const tenantId = requestedTenantId || tenantIds[0];
  if (!tenantIds.includes(tenantId)) {
    return { tenantId: null, error: 'tenantId liegt außerhalb des erlaubten Scopes.' };
  }
  return { tenantId };
}

async function logJobEvent(jobId: string, eventType: string, message: string, payload?: Record<string, any>, adminId?: string | null) {
  const db = getDatabase();
  await db.run(
    `INSERT INTO keyword_inference_events (id, job_id, event_type, message, payload_json, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [createId('kiev'), jobId, eventType, message, payload ? JSON.stringify(payload) : null, adminId || null]
  );
}

interface ServiceRow {
  id: string;
  name: string;
  description: string;
  assignmentKeywords: string[];
  leikaKey: string;
  ozgServices: string[];
  chatbotRelevant: boolean;
  appointmentAllowed: boolean;
}

interface TargetRow {
  id: string;
  label: string;
  existingKeywords: string[];
}

interface StageKeywordSeed {
  keyword: string;
  canonicalKeyword: string;
  confidence: number;
  source: 'deterministic' | 'llm';
  serviceEvidence: string[];
}

interface CandidateRow {
  id: string;
  targetType: 'org_unit' | 'user';
  targetId: string;
  keyword: string;
  canonicalKeyword: string;
  action: 'add' | 'keep' | 'remove' | 'skip';
  confidence: number;
  reasoning: string;
  evidence: Record<string, any>;
  stageScores: Record<string, number>;
}

async function loadDictionaryMap(tenantId: string): Promise<Map<string, string>> {
  const db = getDatabase();
  const rows = await db.all<any>(
    `SELECT canonical_keyword, synonyms_json
     FROM keyword_dictionary
     WHERE tenant_id = ? AND COALESCE(active, 1) = 1`,
    [tenantId]
  );
  const map = new Map<string, string>();
  for (const row of rows || []) {
    const canonical = normalizeKeyword(row?.canonical_keyword);
    if (!canonical) continue;
    const canonicalKey = canonical.toLowerCase();
    map.set(canonicalKey, canonical);
    const synonyms = parseKeywordArray(row?.synonyms_json);
    for (const synonym of synonyms) {
      map.set(synonym.toLowerCase(), canonical);
    }
  }
  return map;
}

function canonicalizeKeyword(raw: string, dictionary: Map<string, string>): string {
  const normalized = normalizeKeyword(raw);
  if (!normalized) return '';
  return dictionary.get(normalized.toLowerCase()) || normalized;
}

function buildServiceText(service: ServiceRow): string {
  const segments = [
    service.name,
    service.description,
    service.leikaKey,
    service.ozgServices.join(' '),
    service.assignmentKeywords.join(' '),
    service.chatbotRelevant ? 'chatbot relevant' : '',
    service.appointmentAllowed ? 'terminvereinbarung' : '',
  ].filter(Boolean);
  return segments.join(' ');
}

function rankServiceForLlm(service: ServiceRow): number {
  const nameTokens = splitTokens(service.name);
  const descTokens = splitTokens(service.description);
  const explicitKeywordWeight = Math.min(10, service.assignmentKeywords.length) * 1.6;
  const signalWeight =
    (service.chatbotRelevant ? 2 : 0) +
    (service.appointmentAllowed ? 1.2 : 0) +
    Math.min(8, service.ozgServices.length) * 0.9;
  return (
    nameTokens.length * 2.2 +
    Math.min(180, descTokens.length) * 0.08 +
    explicitKeywordWeight +
    signalWeight
  );
}

function chunkServicesForLlm(services: ServiceRow[], maxChunkChars = 4200, maxChunks = 10): string[] {
  const chunks: string[] = [];
  let buffer = '';
  for (const service of services) {
    const compactDescription = service.description.slice(0, 760);
    const line = [
      `Service ${service.id}: ${service.name}`,
      `Beschreibung: ${compactDescription}`,
      `Keywords: ${service.assignmentKeywords.slice(0, 24).join(', ')}`,
      `LeiKa: ${service.leikaKey}`,
      `OZG: ${service.ozgServices.slice(0, 16).join(', ')}`,
      `Flags: ${service.chatbotRelevant ? 'chatbot' : '-'} ${service.appointmentAllowed ? 'termin' : '-'}`,
      '',
    ].join('\n');
    if (buffer.length + line.length > maxChunkChars && buffer.trim()) {
      chunks.push(buffer.trim());
      buffer = '';
      if (chunks.length >= maxChunks) break;
    }
    buffer += `${line}\n`;
  }
  if (buffer.trim() && chunks.length < maxChunks) chunks.push(buffer.trim());
  return chunks;
}

async function stage1LlmSeedExtraction(
  tenantId: string,
  services: ServiceRow[],
  dictionary: Map<string, string>,
  jobId: string
): Promise<StageKeywordSeed[]> {
  if (services.length === 0) return [];
  const promptBase = await getSystemPrompt('serviceKeywordSeedExtractionPrompt');
  const ranked = [...services].sort((a, b) => rankServiceForLlm(b) - rankServiceForLlm(a));
  const chunks = chunkServicesForLlm(ranked.slice(0, 180), 4200, 10);
  const out: StageKeywordSeed[] = [];

  for (const chunk of chunks) {
    const prompt = `${promptBase}

Mandant: ${tenantId}

Extrahiere Keyword-Seeds aus folgenden Leistungen.
Nutze nur Begriffe, die in Verwaltungsprozessen wirklich trennscharf sind.

${chunk}

Antworte ausschließlich mit JSON im Format:
{
  "seeds": [
    {
      "keyword": "string",
      "canonicalCandidate": "string",
      "serviceEvidence": ["serviceId"],
      "domain": "string",
      "confidence": 0.0
    }
  ]
}`;
    try {
      const raw = await testAIProvider(prompt, {
        purpose: 'keyword_seed_extraction',
        taskKey: 'keyword_seed_extraction',
        maxAttempts: 1,
        waitTimeoutMs: 120000,
        meta: { source: 'keywording.seed', tenantId, jobId },
      });
      const parsed = extractJsonPayload(raw);
      const seeds = Array.isArray(parsed?.seeds) ? parsed.seeds : [];
      for (const seed of seeds) {
        const keyword = normalizeKeyword(seed?.keyword);
        if (!keyword || !isKeywordAllowed(keyword)) continue;
        const canonical = canonicalizeKeyword(seed?.canonicalCandidate || keyword, dictionary);
        if (!isKeywordAllowed(canonical)) continue;
        const confidence = normalizeScore(seed?.confidence, 0.62);
        const evidence = Array.isArray(seed?.serviceEvidence)
          ? seed.serviceEvidence.map((entry: any) => normalizeText(entry)).filter(Boolean)
          : [];
        out.push({
          keyword,
          canonicalKeyword: canonical || keyword,
          confidence,
          source: 'llm',
          serviceEvidence: evidence,
        });
      }
    } catch {
      // LLM fallback: ignore chunk-level failure.
    }
  }

  return out;
}

async function stage2LlmConsolidation(
  tenantId: string,
  seeds: StageKeywordSeed[],
  dictionary: Map<string, string>,
  jobId: string
): Promise<StageKeywordSeed[]> {
  if (seeds.length === 0) return [];
  const promptBase = await getSystemPrompt('serviceKeywordConsolidationPrompt');
  const batch = seeds
    .slice(0, 260)
    .filter((seed) => isKeywordAllowed(seed.keyword))
    .map((seed) => `${seed.keyword} => ${seed.canonicalKeyword}`)
    .join('\n');
  const prompt = `${promptBase}

Mandant: ${tenantId}

Konsolidiere die folgenden Keywords zu kanonischen Begriffen:
${batch}

Nur JSON:
{ "items": [{ "keyword": "string", "canonicalKeyword": "string", "confidence": 0.0 }] }`;
  try {
    const raw = await testAIProvider(prompt, {
      purpose: 'keyword_consolidation',
      taskKey: 'keyword_consolidation',
      maxAttempts: 1,
      waitTimeoutMs: 120000,
      meta: { source: 'keywording.consolidation', tenantId, jobId },
    });
    const parsed = extractJsonPayload(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    const byKeyword = new Map<string, { canonicalKeyword: string; confidence: number }>();
    for (const item of items) {
      const keyword = normalizeKeyword(item?.keyword).toLowerCase();
      if (!keyword) continue;
      const canonical = canonicalizeKeyword(item?.canonicalKeyword || item?.keyword, dictionary);
      if (!isKeywordAllowed(keyword) || !isKeywordAllowed(canonical)) continue;
      byKeyword.set(keyword, {
        canonicalKeyword: canonical || normalizeKeyword(item?.keyword),
        confidence: normalizeScore(item?.confidence, 0.68),
      });
    }
    return seeds.map((seed) => {
      const hit = byKeyword.get(seed.keyword.toLowerCase());
      if (!hit) return seed;
      return {
        ...seed,
        canonicalKeyword: hit.canonicalKeyword,
        confidence: clamp((seed.confidence + hit.confidence) / 2, 0, 1),
      };
    });
  } catch {
    return seeds;
  }
}

async function stage3LlmTargetAssignment(
  tenantId: string,
  canonicalKeywords: string[],
  targets: Array<{ type: 'org_unit' | 'user'; id: string; label: string; existingKeywords: string[] }>,
  dictionary: Map<string, string>,
  jobId: string
): Promise<Array<{ targetType: 'org_unit' | 'user'; targetId: string; keyword: string; confidence: number; reasoning: string }>> {
  if (canonicalKeywords.length === 0 || targets.length === 0) return [];
  const promptBase = await getSystemPrompt('serviceKeywordTargetAssignmentPrompt');
  const validKeywords = canonicalKeywords.filter((entry) => isKeywordAllowed(entry)).slice(0, 140);
  const out: Array<{ targetType: 'org_unit' | 'user'; targetId: string; keyword: string; confidence: number; reasoning: string }> = [];
  const validTarget = new Set(targets.map((target) => `${target.type}:${target.id}`));
  const validKeywordByKey = new Map<string, string>();
  for (const keyword of validKeywords) {
    const key = normalizeKeywordMatchKey(keyword);
    if (key && !validKeywordByKey.has(key)) {
      validKeywordByKey.set(key, keyword);
    }
  }

  if (validKeywords.length === 0) return out;

  const targetBatchSize = 40;
  const maxCalls = 10;
  let calls = 0;

  for (let index = 0; index < targets.length && calls < maxCalls; index += targetBatchSize) {
    const targetBatch = targets.slice(index, index + targetBatchSize);
    if (targetBatch.length === 0) continue;
    const prompt = `${promptBase}

Mandant: ${tenantId}

Keywords:
${validKeywords.join(', ')}

Targets:
${targetBatch
  .map((target, idx) => `${idx + 1}. ${target.type}:${target.id} ${target.label} | existing: ${target.existingKeywords.join(', ')}`)
  .join('\n')}

JSON only:
{ "assignments": [{ "targetType": "org_unit|user", "targetId": "...", "keyword": "...", "confidence": 0.0, "reasoning": "..." }] }`;

    try {
      calls += 1;
      const raw = await testAIProvider(prompt, {
        purpose: 'keyword_target_assignment',
        taskKey: 'keyword_target_assignment',
        maxAttempts: 1,
        waitTimeoutMs: 120000,
        meta: { source: 'keywording.target_assignment', tenantId, jobId, batch: calls },
      });
      const parsed = extractJsonPayload(raw);
      const assignments = Array.isArray(parsed?.assignments) ? parsed.assignments : [];
      for (const row of assignments) {
        const targetType = normalizeText(row?.targetType).toLowerCase() === 'user' ? 'user' : 'org_unit';
        const targetId = normalizeText(row?.targetId);
        const rawKeyword = normalizeKeyword(row?.keyword);
        if (!targetId || !rawKeyword) continue;
        if (!validTarget.has(`${targetType}:${targetId}`)) continue;

        let keyword = canonicalizeKeyword(rawKeyword, dictionary);
        if (!isKeywordAllowed(keyword)) continue;

        const exact = validKeywords.find((entry) => entry.toLowerCase() === keyword.toLowerCase());
        const byKey = validKeywordByKey.get(normalizeKeywordMatchKey(keyword));
        if (!exact && !byKey) {
          const keywordTokens = tokenize(keyword).slice(0, 8);
          let bestMatch = '';
          let bestScore = 0;
          for (const validKeyword of validKeywords) {
            const validTokens = tokenize(validKeyword).slice(0, 8);
            const overlapScore = scoreTokenOverlap(validTokens, keywordTokens);
            if (overlapScore > bestScore) {
              bestScore = overlapScore;
              bestMatch = validKeyword;
            }
          }
          if (bestScore >= 0.67 && bestMatch) {
            keyword = bestMatch;
          } else {
            continue;
          }
        } else {
          keyword = exact || byKey || keyword;
        }

        out.push({
          targetType,
          targetId,
          keyword,
          confidence: normalizeScore(row?.confidence, 0.6),
          reasoning: normalizeText(row?.reasoning).slice(0, 280) || 'LLM-Zuordnung',
        });
        if (out.length >= 5000) break;
      }
    } catch {
      // Per-Batch Fehler tolerant behandeln.
      continue;
    }
    if (out.length >= 5000) break;
  }

  return out;
}

async function stage4LlmQualityGuard(
  tenantId: string,
  keywords: string[],
  jobId: string
): Promise<Map<string, { accepted: boolean; confidence: number; reason: string }>> {
  const out = new Map<string, { accepted: boolean; confidence: number; reason: string }>();
  if (keywords.length === 0) return out;
  const promptBase = await getSystemPrompt('serviceKeywordQualityGuardPrompt');
  const prompt = `${promptBase}\n\nMandant: ${tenantId}\n\nZu prüfen:\n${keywords
    .slice(0, 260)
    .map((entry) => `- ${entry}`)
    .join('\n')}\n\nNur JSON:\n{\n  "accepted":[{"keyword":"...","confidence":0.0,"reason":"..."}],\n  "rejected":[{"keyword":"...","reason":"..."}]\n}`;
  try {
    const raw = await testAIProvider(prompt, {
      purpose: 'keyword_quality_guard',
      taskKey: 'keyword_quality_guard',
      maxAttempts: 1,
      waitTimeoutMs: 120000,
      meta: { source: 'keywording.quality_guard', tenantId, jobId },
    });
    const parsed = extractJsonPayload(raw);
    const accepted = Array.isArray(parsed?.accepted) ? parsed.accepted : [];
    const rejected = Array.isArray(parsed?.rejected) ? parsed.rejected : [];
    for (const item of accepted) {
      const keyword = normalizeKeyword(item?.keyword).toLowerCase();
      if (!keyword || !isKeywordAllowed(keyword)) continue;
      out.set(keyword, {
        accepted: true,
        confidence: normalizeScore(item?.confidence, 0.7),
        reason: normalizeText(item?.reason) || 'Qualitätsprüfung akzeptiert',
      });
    }
    for (const item of rejected) {
      const keyword = normalizeKeyword(item?.keyword).toLowerCase();
      if (!keyword) continue;
      out.set(keyword, {
        accepted: false,
        confidence: 0,
        reason: normalizeText(item?.reason) || 'Qualitätsprüfung verworfen',
      });
    }
  } catch {
    return out;
  }
  return out;
}

function buildTargetSignalTokens(target: { label: string; existingKeywords: string[] }): string[] {
  const combined = [target.label, ...(target.existingKeywords || [])].join(' ');
  return tokenize(combined).slice(0, 120);
}

function scoreKeywordAgainstTarget(keyword: string, target: { label: string; existingKeywords: string[] }): number {
  if (!keyword) return 0;
  const keywordTokens = tokenize(keyword).slice(0, 10);
  const targetTokens = buildTargetSignalTokens(target);
  if (keywordTokens.length === 0 || targetTokens.length === 0) return 0;

  const overlap = scoreTokenOverlap(targetTokens, keywordTokens);
  const targetLabel = normalizeText(target.label).toLowerCase();
  const keywordLc = normalizeKeyword(keyword).toLowerCase();
  const phraseMatch = targetLabel.includes(keywordLc) ? 0.35 : 0;
  const prefixMatch = keywordTokens.some((token) => targetTokens.some((targetToken) => targetToken.startsWith(token) || token.startsWith(targetToken)))
    ? 0.2
    : 0;
  return clamp(overlap * 0.8 + phraseMatch + prefixMatch, 0, 1);
}

async function loadJob(jobId: string) {
  const db = getDatabase();
  const row = await db.get<any>(`SELECT * FROM keyword_inference_jobs WHERE id = ? LIMIT 1`, [jobId]);
  return row || null;
}

async function ensureJobScope(req: Request, job: any) {
  const { access, capabilities } = await resolveAccess(req);
  if (!canManageKeywording(capabilities)) {
    throw new Error('Keine Berechtigung für Schlagwort-Assistent.');
  }
  const scoped = resolveTenantId(access, job?.tenant_id || req.header('x-admin-context-tenant-id'));
  if (scoped.error || !scoped.tenantId) throw new Error(scoped.error || 'tenantId fehlt');
  if (normalizeText(job?.tenant_id) !== scoped.tenantId) {
    throw new Error('Kein Zugriff auf diesen Mandanten.');
  }
  return { access, capabilities, scoped, userId: normalizeText(req.userId) };
}

async function runKeywordJob(jobId: string, actorUserId: string): Promise<void> {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  const db = getDatabase();
  try {
    const job = await loadJob(jobId);
    if (!job?.id) throw new Error('Job nicht gefunden');
    if (normalizeText(job.status) === 'cancelled') return;

    await db.run(
      `UPDATE keyword_inference_jobs
       SET status = 'running', started_at = CURRENT_TIMESTAMP, finished_at = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [jobId]
    );
    await logJobEvent(jobId, 'run_start', 'Schlagwort-Inferenz gestartet', {}, actorUserId);

    const tenantId = normalizeText(job.tenant_id);
    const options = parseJsonObject(job.options_json);
    const sourceScope = normalizeText(job.source_scope || options.sourceScope || 'services_all').toLowerCase();
    const targetScope = normalizeText(job.target_scope || options.targetScope || 'both').toLowerCase();
    const includeExisting = Number(job.include_existing_keywords || 0) === 1;
    const minSuggest = clamp(Number(job.min_suggest_confidence || 0.42), 0.05, 0.99);
    const maxKeywordsPerTarget = Math.max(1, Math.min(40, Number(job.max_keywords_per_target || 15)));

    const serviceRows = await db.all<any>(
      `SELECT id, name, description_html, assignment_keywords_json, leika_key, ozg_services_json,
              COALESCE(chatbot_relevant, 0) AS chatbot_relevant,
              COALESCE(appointment_allowed, 0) AS appointment_allowed
       FROM services_catalog
       WHERE tenant_id = ?
         AND COALESCE(active, 1) = 1`,
      [tenantId]
    );

    const allServices: ServiceRow[] = (serviceRows || []).map((row: any) => ({
      id: normalizeText(row?.id),
      name: normalizeText(row?.name),
      description: stripHtml(String(row?.description_html || '')),
      assignmentKeywords: parseKeywordArray(row?.assignment_keywords_json),
      leikaKey: normalizeText(row?.leika_key),
      ozgServices: parseKeywordArray(row?.ozg_services_json),
      chatbotRelevant: Number(row?.chatbot_relevant || 0) === 1,
      appointmentAllowed: Number(row?.appointment_allowed || 0) === 1,
    }));

    let services = allServices;
    if (sourceScope === 'services_filtered') {
      const includeServiceIds = Array.isArray(options?.serviceIds)
        ? options.serviceIds.map((entry: any) => normalizeText(entry)).filter(Boolean)
        : [];
      if (includeServiceIds.length > 0) {
        const includeSet = new Set(includeServiceIds);
        services = allServices.filter((service) => includeSet.has(service.id));
      }
    } else if (sourceScope === 'services_recent_import') {
      const recentImportJob = await db.get<any>(
        `SELECT report_json
         FROM import_jobs
         WHERE tenant_id = ?
           AND kind = 'services'
           AND status = 'completed'
         ORDER BY finished_at DESC, updated_at DESC
         LIMIT 1`,
        [tenantId]
      );
      const report = parseJsonObject(recentImportJob?.report_json);
      const touched = Array.isArray(report?.touchedServiceIds)
        ? report.touchedServiceIds.map((entry: any) => normalizeText(entry)).filter(Boolean)
        : [];
      if (touched.length > 0) {
        const touchedSet = new Set(touched);
        services = allServices.filter((service) => touchedSet.has(service.id));
      }
    }

    if (services.length === 0) {
      await db.run(
        `UPDATE keyword_inference_jobs
         SET status = 'failed', error_message = ?, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        ['Keine Leistungen im Mandanten vorhanden.', jobId]
      );
      await logJobEvent(jobId, 'run_failed', 'Keine Leistungen gefunden', { tenantId }, actorUserId);
      return;
    }

    const dictionary = await loadDictionaryMap(tenantId);

    // Stage 0 deterministic extraction
    const keywordStats = new Map<string, { score: number; serviceIds: Set<string>; keyword: string }>();
    for (const service of services) {
      const nameTokens = tokenize(service.name).slice(0, 24);
      const descriptionTokens = tokenize(service.description).slice(0, 220);
      const nameNgrams = buildNgrams(nameTokens, 2, 3).slice(0, 40);

      const weightedCandidates: Array<{ keyword: string; weight: number }> = [];
      for (const explicit of service.assignmentKeywords.slice(0, 30)) {
        weightedCandidates.push({ keyword: explicit, weight: 3.4 });
      }
      for (const ozgKeyword of service.ozgServices.slice(0, 18)) {
        weightedCandidates.push({ keyword: ozgKeyword, weight: 1.7 });
      }
      for (const token of nameTokens) {
        weightedCandidates.push({ keyword: token, weight: 2.1 });
      }
      for (const ngram of nameNgrams) {
        weightedCandidates.push({ keyword: ngram, weight: 2.6 });
      }
      for (const token of descriptionTokens.slice(0, 180)) {
        weightedCandidates.push({ keyword: token, weight: 0.95 });
      }

      const serviceWeight = (service.chatbotRelevant ? 1.16 : 1) + (service.appointmentAllowed ? 0.08 : 0);
      for (const candidate of weightedCandidates) {
        const canonical = canonicalizeKeyword(candidate.keyword, dictionary);
        if (!canonical || !isKeywordAllowed(canonical)) continue;
        const key = canonical.toLowerCase();
        const current = keywordStats.get(key) || { score: 0, serviceIds: new Set<string>(), keyword: canonical };
        current.score += candidate.weight * serviceWeight;
        current.serviceIds.add(service.id);
        current.keyword = canonical;
        keywordStats.set(key, current);
      }
    }

    const maxDeterministicScore = Array.from(keywordStats.values()).reduce((max, entry) => Math.max(max, entry.score), 0.01);
    const deterministicSeeds: StageKeywordSeed[] = Array.from(keywordStats.entries())
      .map(([key, value]) => {
        const relativeScore = value.score / maxDeterministicScore;
        const evidenceBoost = Math.min(0.1, value.serviceIds.size / 14);
        const confidence = clamp(0.24 + relativeScore * 0.66 + evidenceBoost, 0.2, 0.96);
        return {
          keyword: value.keyword || key,
          canonicalKeyword: value.keyword || dictionary.get(key) || key,
          confidence,
          source: 'deterministic' as const,
          serviceEvidence: Array.from(value.serviceIds).slice(0, 14),
        };
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 500);

    await logJobEvent(jobId, 'stage_0_done', 'Deterministische Vorverarbeitung abgeschlossen', {
      sourceScope,
      seedCount: deterministicSeeds.length,
    }, actorUserId);

    // Stage 1 LLM seeds
    const llmSeeds = await stage1LlmSeedExtraction(tenantId, services, dictionary, jobId);
    await logJobEvent(jobId, 'stage_1_done', 'LLM Seed Extraction abgeschlossen', { seedCount: llmSeeds.length }, actorUserId);

    // Stage 2 consolidation
    const mergedSeeds = [...deterministicSeeds, ...llmSeeds];
    const consolidated = await stage2LlmConsolidation(tenantId, mergedSeeds, dictionary, jobId);
    await logJobEvent(jobId, 'stage_2_done', 'Keyword-Konsolidierung abgeschlossen', {
      seedCount: consolidated.length,
    }, actorUserId);

    const pooledByCanonical = new Map<string, StageKeywordSeed[]>();
    for (const seed of consolidated) {
      const canonical = canonicalizeKeyword(seed.canonicalKeyword || seed.keyword, dictionary);
      if (!canonical || !isKeywordAllowed(canonical)) continue;
      const bucket = pooledByCanonical.get(canonical.toLowerCase()) || [];
      bucket.push({ ...seed, canonicalKeyword: canonical });
      pooledByCanonical.set(canonical.toLowerCase(), bucket);
    }

    const qualityGuard = await stage4LlmQualityGuard(
      tenantId,
      Array.from(pooledByCanonical.values()).map((bucket) => bucket[0]?.canonicalKeyword || '').filter(Boolean),
      jobId
    );

    const canonicalPool = Array.from(pooledByCanonical.entries())
      .map(([key, bucket]) => {
        const confidence = clamp(bucket.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, bucket.length), 0, 1);
        const evidence = Array.from(new Set(bucket.flatMap((item) => item.serviceEvidence))).slice(0, 12);
        const guard = qualityGuard.get((dictionary.get(key) || bucket[0].canonicalKeyword || '').toLowerCase());
        const guardPenalty = guard && guard.accepted === false ? 0.35 : 0;
        const guardBoost = guard && guard.accepted ? (guard.confidence - 0.5) * 0.2 : 0;
        const guardedConfidence = clamp(confidence + guardBoost - guardPenalty, 0, 1);
        return {
          canonicalKeyword: dictionary.get(key) || bucket[0].canonicalKeyword,
          confidence: guardedConfidence,
          serviceEvidence: evidence,
          deterministicScore: bucket
            .filter((item) => item.source === 'deterministic')
            .reduce((sum, item) => sum + item.confidence, 0),
          llmScore: bucket.filter((item) => item.source === 'llm').reduce((sum, item) => sum + item.confidence, 0),
        };
      })
      .sort((a, b) => b.confidence - a.confidence)
      .filter((entry) => {
        if (!isKeywordAllowed(entry.canonicalKeyword)) return false;
        const guard = qualityGuard.get(entry.canonicalKeyword.toLowerCase());
        return !guard || guard.accepted !== false;
      })
      .slice(0, 300);

    await logJobEvent(jobId, 'stage_4_done', 'Keyword-Qualitätsprüfung abgeschlossen', {
      checkedCount: qualityGuard.size,
      poolSize: canonicalPool.length,
    }, actorUserId);

    // target load
    const targets: Array<{ type: 'org_unit' | 'user'; id: string; label: string; existingKeywords: string[] }> = [];
    if (targetScope === 'both' || targetScope === 'org_units') {
      const orgRows = await db.all<any>(
        `SELECT id, name, assignment_keywords_json
         FROM org_units
         WHERE tenant_id = ? AND COALESCE(active, 1) = 1`,
        [tenantId]
      );
      for (const row of orgRows || []) {
        targets.push({
          type: 'org_unit',
          id: normalizeText(row?.id),
          label: normalizeText(row?.name),
          existingKeywords: parseKeywordArray(row?.assignment_keywords_json),
        });
      }
    }
    if (targetScope === 'both' || targetScope === 'users') {
      const userRows = await db.all<any>(
        `SELECT u.id, u.username, u.first_name, u.last_name, u.assignment_keywords_json
         FROM admin_users u
         WHERE COALESCE(u.active, 1) = 1
           AND EXISTS (
             SELECT 1
             FROM admin_user_tenant_scopes ts
             WHERE ts.admin_user_id = u.id AND ts.tenant_id = ?
           )`,
        [tenantId]
      );
      for (const row of userRows || []) {
        const label = `${normalizeText(row?.first_name)} ${normalizeText(row?.last_name)}`.trim() || normalizeText(row?.username);
        targets.push({
          type: 'user',
          id: normalizeText(row?.id),
          label,
          existingKeywords: parseKeywordArray(row?.assignment_keywords_json),
        });
      }
    }

    if (targets.length === 0) {
      throw new Error('Keine Zielobjekte (Mitarbeiter/Organisationseinheiten) für den Mandanten gefunden.');
    }

    const serviceOrgLinks = await db.all<any>(
      `SELECT service_id, org_unit_id FROM service_org_unit_links WHERE tenant_id = ?`,
      [tenantId]
    );
    const serviceUserLinks = await db.all<any>(
      `SELECT service_id, admin_user_id FROM service_admin_user_links WHERE tenant_id = ?`,
      [tenantId]
    );

    const serviceIdsByOrg = new Map<string, Set<string>>();
    const serviceIdsByUser = new Map<string, Set<string>>();
    for (const row of serviceOrgLinks || []) {
      const orgId = normalizeText(row?.org_unit_id);
      const serviceId = normalizeText(row?.service_id);
      if (!orgId || !serviceId) continue;
      const set = serviceIdsByOrg.get(orgId) || new Set<string>();
      set.add(serviceId);
      serviceIdsByOrg.set(orgId, set);
    }
    for (const row of serviceUserLinks || []) {
      const userId = normalizeText(row?.admin_user_id);
      const serviceId = normalizeText(row?.service_id);
      if (!userId || !serviceId) continue;
      const set = serviceIdsByUser.get(userId) || new Set<string>();
      set.add(serviceId);
      serviceIdsByUser.set(userId, set);
    }

    // Stage 3 LLM target assignment
    const llmAssignments = await stage3LlmTargetAssignment(
      tenantId,
      canonicalPool.map((entry) => entry.canonicalKeyword),
      targets,
      dictionary,
      jobId
    );
    await logJobEvent(jobId, 'stage_3_done', 'LLM Target Assignment abgeschlossen', {
      assignmentCount: llmAssignments.length,
    }, actorUserId);

    const llmByTargetKeyword = new Map<string, { confidence: number; reasoning: string }>();
    for (const assignment of llmAssignments) {
      llmByTargetKeyword.set(
        `${assignment.targetType}:${assignment.targetId}:${assignment.keyword.toLowerCase()}`,
        {
          confidence: assignment.confidence,
          reasoning: assignment.reasoning,
        }
      );
    }

    const llmFallbackMode = llmSeeds.length === 0 || llmAssignments.length === 0;
    const effectiveMinSuggest = llmFallbackMode ? Math.min(minSuggest, 0.42) : minSuggest;

    const candidateRows: CandidateRow[] = [];
    let fallbackTargetCount = 0;
    for (const target of targets) {
      const linkedServiceIds =
        target.type === 'org_unit'
          ? serviceIdsByOrg.get(target.id) || new Set<string>()
          : serviceIdsByUser.get(target.id) || new Set<string>();

      const targetSignalScore = (keyword: string) => scoreKeywordAgainstTarget(keyword, target);
      const topPool = canonicalPool
        .map((entry) => {
          let linkedHits = 0;
          for (const serviceId of entry.serviceEvidence) {
            if (linkedServiceIds.has(serviceId)) linkedHits += 1;
          }
          const evidenceCount = Math.max(1, entry.serviceEvidence.length);
          const serviceLinkScore = clamp(linkedHits / evidenceCount, 0, 1);
          const existingHit = target.existingKeywords.some(
            (keyword) => keyword.toLowerCase() === entry.canonicalKeyword.toLowerCase()
          );
          const deterministicScore = clamp(entry.deterministicScore / 3, 0, 1);
          const llmSeedScore = clamp(entry.llmScore / 2, 0, 1);
          const lexicalScore = targetSignalScore(entry.canonicalKeyword);
          const llmAssign = llmByTargetKeyword.get(
            `${target.type}:${target.id}:${entry.canonicalKeyword.toLowerCase()}`
          );
          const llmAssignScore = llmAssign ? llmAssign.confidence : 0;
          const finalScore = llmFallbackMode
            ? clamp(
                deterministicScore * 0.55 +
                  lexicalScore * 0.2 +
                  serviceLinkScore * 0.25 +
                  (existingHit ? 0.05 : 0),
                0,
                1
              )
            : clamp(
                deterministicScore * 0.42 +
                  llmSeedScore * 0.16 +
                  llmAssignScore * 0.22 +
                  lexicalScore * 0.14 +
                  serviceLinkScore * 0.22 +
                  (existingHit ? 0.06 : 0),
                0,
                1
              );
          return {
            canonicalKeyword: entry.canonicalKeyword,
            serviceEvidence: entry.serviceEvidence,
            deterministicScore,
            llmSeedScore,
            llmAssignScore,
            lexicalScore,
            serviceLinkScore,
            finalScore,
            existingHit,
            llmReasoning: llmAssign?.reasoning || '',
          };
        })
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, maxKeywordsPerTarget * 2);

      const selected = topPool.slice(0, maxKeywordsPerTarget);
      let pushedForTarget = 0;
      for (const poolEntry of selected) {
        const action: CandidateRow['action'] = poolEntry.existingHit ? 'keep' : 'add';
        if (!isKeywordAllowed(poolEntry.canonicalKeyword)) continue;
        if (poolEntry.finalScore < effectiveMinSuggest) continue;
        candidateRows.push({
          id: createId('kic'),
          targetType: target.type,
          targetId: target.id,
          keyword: poolEntry.canonicalKeyword,
          canonicalKeyword: poolEntry.canonicalKeyword,
          action,
          confidence: poolEntry.finalScore,
          reasoning:
            poolEntry.llmReasoning ||
            (linkedServiceIds.size > 0
              ? 'Treffer über verknüpfte Leistungen und Schlüsselbegriffe.'
              : 'Treffer über Leistungsinhalte und vorhandene Schlagworte.'),
          evidence: {
            serviceIds: poolEntry.serviceEvidence,
            targetLabel: target.label,
            linkedServiceCount: linkedServiceIds.size,
          },
          stageScores: {
            deterministic: poolEntry.deterministicScore,
            llmSeed: poolEntry.llmSeedScore,
            llmAssignment: poolEntry.llmAssignScore,
            lexical: poolEntry.lexicalScore,
            serviceLink: poolEntry.serviceLinkScore,
            final: poolEntry.finalScore,
          },
        });
        pushedForTarget += 1;
      }

      if (pushedForTarget === 0 && selected.length > 0) {
        const fallbackRows = selected
          .filter((entry) => isKeywordAllowed(entry.canonicalKeyword))
          .slice(0, Math.min(3, maxKeywordsPerTarget));
        if (fallbackRows.length > 0) {
          fallbackTargetCount += 1;
        }
        for (const poolEntry of fallbackRows) {
          const action: CandidateRow['action'] = poolEntry.existingHit ? 'keep' : 'add';
          const fallbackScore = clamp(Math.max(poolEntry.finalScore, 0.24), 0.24, Math.max(0.24, effectiveMinSuggest));
          candidateRows.push({
            id: createId('kic'),
            targetType: target.type,
            targetId: target.id,
            keyword: poolEntry.canonicalKeyword,
            canonicalKeyword: poolEntry.canonicalKeyword,
            action,
            confidence: fallbackScore,
            reasoning:
              poolEntry.llmReasoning ||
              'Fallback-Vorschlag bei schwacher Signalqualität; bitte manuell prüfen.',
            evidence: {
              serviceIds: poolEntry.serviceEvidence,
              targetLabel: target.label,
              linkedServiceCount: linkedServiceIds.size,
              fallback: true,
            },
            stageScores: {
              deterministic: poolEntry.deterministicScore,
              llmSeed: poolEntry.llmSeedScore,
              llmAssignment: poolEntry.llmAssignScore,
              lexical: poolEntry.lexicalScore,
              serviceLink: poolEntry.serviceLinkScore,
              final: fallbackScore,
            },
          });
        }
      }

      if (!includeExisting) {
        for (const existingKeyword of target.existingKeywords.slice(0, 30)) {
          const existsInSuggestions = selected.some(
            (entry) => entry.canonicalKeyword.toLowerCase() === existingKeyword.toLowerCase()
          );
          if (existsInSuggestions) continue;
          candidateRows.push({
            id: createId('kic'),
            targetType: target.type,
            targetId: target.id,
            keyword: existingKeyword,
            canonicalKeyword: existingKeyword,
            action: 'skip',
            confidence: 0.35,
            reasoning: 'Bestehendes Schlagwort ohne aktuelle Leistungsbelege.',
            evidence: {
              targetLabel: target.label,
              serviceIds: [],
            },
            stageScores: {
              deterministic: 0,
              llmSeed: 0,
              llmAssignment: 0,
              final: 0.35,
            },
          });
        }
      }
    }

    // Save candidates
    await db.run(`DELETE FROM keyword_inference_candidates WHERE job_id = ?`, [jobId]);
    for (const candidate of candidateRows) {
      await db.run(
        `INSERT INTO keyword_inference_candidates (
          id, job_id, tenant_id, target_type, target_id,
          keyword_text, canonical_keyword, action, confidence, reasoning,
          evidence_json, stage_scores_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed')`,
        [
          candidate.id,
          jobId,
          tenantId,
          candidate.targetType,
          candidate.targetId,
          candidate.keyword,
          candidate.canonicalKeyword,
          candidate.action,
          candidate.confidence,
          candidate.reasoning,
          JSON.stringify(candidate.evidence),
          JSON.stringify(candidate.stageScores),
        ]
      );
    }

    const report = {
      finishedAt: nowIso(),
      sourceScope,
      candidateCount: candidateRows.length,
      targetCount: targets.length,
      serviceCount: services.length,
      poolSize: canonicalPool.length,
      minSuggestConfidence: minSuggest,
      effectiveMinSuggestConfidence: effectiveMinSuggest,
      fallbackUsed: llmFallbackMode,
      fallbackTargetCount,
      llmSeedCount: llmSeeds.length,
      llmAssignmentCount: llmAssignments.length,
    };

    await db.run(
      `UPDATE keyword_inference_jobs
       SET status = 'completed', report_json = ?, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(report), jobId]
    );

    if (normalizeText(job.apply_mode) === 'auto_if_confident') {
      const autoApplyResult = await applyCandidatesForJob({
        job,
        actorUserId,
        mode: 'all_above_threshold',
        threshold: Number(job.min_auto_apply_confidence || 0.82),
        preserveManualKeywords: true,
      });
      await logJobEvent(jobId, 'auto_apply', 'Auto-Apply durchgeführt', autoApplyResult, actorUserId);
    }

    await logJobEvent(jobId, 'run_completed', 'Schlagwort-Inferenz abgeschlossen', report, actorUserId);
  } catch (error: any) {
    const message = error?.message || String(error || 'Fehler');
    await db.run(
      `UPDATE keyword_inference_jobs
       SET status = 'failed', error_message = ?, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [message, jobId]
    );
    await logJobEvent(jobId, 'run_failed', 'Schlagwort-Inferenz fehlgeschlagen', { error: message }, actorUserId);
  } finally {
    runningJobs.delete(jobId);
  }
}

function parseJsonObject(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
  } catch {
    // ignore
  }
  return {};
}

async function applyCandidatesForJob(input: {
  job: any;
  actorUserId: string;
  mode: 'selected' | 'all_above_threshold';
  threshold: number;
  preserveManualKeywords: boolean;
  selectedCandidateIds?: string[];
}) {
  const { job, actorUserId, mode, threshold, preserveManualKeywords } = input;
  const jobId = normalizeText(job?.id);
  const tenantId = normalizeText(job?.tenant_id);
  const selectedCandidateIds = Array.isArray(input.selectedCandidateIds)
    ? input.selectedCandidateIds.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  const db = getDatabase();

  const where: string[] = ['job_id = ?'];
  const params: any[] = [jobId];
  if (mode === 'selected') {
    if (selectedCandidateIds.length === 0) {
      throw new Error('selectedCandidateIds fehlt.');
    }
    where.push(`id IN (${selectedCandidateIds.map(() => '?').join(', ')})`);
    params.push(...selectedCandidateIds);
  } else {
    where.push('confidence >= ?');
    params.push(clamp(threshold, 0, 1));
  }

  const candidates = await db.all<any>(
    `SELECT *
     FROM keyword_inference_candidates
     WHERE ${where.join(' AND ')}
     ORDER BY confidence DESC`,
    params
  );

  const grouped = new Map<string, any[]>();
  for (const candidate of candidates || []) {
    const targetType = normalizeText(candidate?.target_type);
    const targetId = normalizeText(candidate?.target_id);
    if (!targetType || !targetId) continue;
    const key = `${targetType}:${targetId}`;
    const bucket = grouped.get(key) || [];
    bucket.push(candidate);
    grouped.set(key, bucket);
  }

  let appliedTargets = 0;
  let appliedCandidates = 0;
  for (const [groupKey, groupCandidates] of grouped.entries()) {
    const [targetType, targetId] = groupKey.split(':');
    let currentKeywords: string[] = [];
    if (targetType === 'org_unit') {
      const row = await db.get<any>(`SELECT assignment_keywords_json FROM org_units WHERE id = ? LIMIT 1`, [targetId]);
      currentKeywords = parseKeywordArray(row?.assignment_keywords_json);
    } else {
      const row = await db.get<any>(`SELECT assignment_keywords_json FROM admin_users WHERE id = ? LIMIT 1`, [targetId]);
      currentKeywords = parseKeywordArray(row?.assignment_keywords_json);
    }

    const before = [...currentKeywords];
    const set = new Set(currentKeywords.map((entry) => entry.toLowerCase()));
    for (const candidate of groupCandidates) {
      const action = normalizeText(candidate?.action).toLowerCase();
      const keyword = normalizeKeyword(candidate?.canonical_keyword || candidate?.keyword_text);
      if (!keyword) continue;
      const key = keyword.toLowerCase();
      if (action === 'add' || action === 'keep') {
        if (!set.has(key)) {
          set.add(key);
          currentKeywords.push(keyword);
          appliedCandidates += 1;
        }
      } else if (action === 'remove' && !preserveManualKeywords) {
        if (set.has(key)) {
          set.delete(key);
          currentKeywords = currentKeywords.filter((entry) => entry.toLowerCase() !== key);
          appliedCandidates += 1;
        }
      }
    }

    const after = Array.from(new Set(currentKeywords.map((entry) => normalizeKeyword(entry)).filter(Boolean)));
    if (JSON.stringify(before) === JSON.stringify(after)) continue;

    if (targetType === 'org_unit') {
      await db.run(
        `UPDATE org_units
         SET assignment_keywords_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [serializeKeywords(after), targetId]
      );
    } else {
      await db.run(
        `UPDATE admin_users
         SET assignment_keywords_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [serializeKeywords(after), targetId]
      );
    }

    await db.run(
      `INSERT INTO keyword_apply_audit (
        id, job_id, tenant_id, target_type, target_id,
        before_keywords_json, after_keywords_json, applied_by_admin_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createId('kiaud'),
        jobId,
        tenantId,
        targetType,
        targetId,
        JSON.stringify(before),
        JSON.stringify(after),
        actorUserId || null,
      ]
    );

    appliedTargets += 1;
  }

  await db.run(
    `UPDATE keyword_inference_candidates
     SET status = 'applied', updated_at = CURRENT_TIMESTAMP
     WHERE ${where.join(' AND ')}`,
    params
  );

  return {
    mode,
    threshold: clamp(threshold, 0, 1),
    preserveManualKeywords,
    appliedTargets,
    appliedCandidates,
  };
}

router.post('/keywording/jobs', async (req: Request, res: Response) => {
  try {
    const { userId, access, capabilities } = await resolveAccess(req);
    if (!canManageKeywording(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung für Schlagwort-Assistent.' });
    }

    const scoped = resolveTenantId(access, req.body?.tenantId || req.header('x-admin-context-tenant-id'));
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }

    const sourceScope = ['services_all', 'services_filtered', 'services_recent_import'].includes(normalizeText(req.body?.sourceScope))
      ? normalizeText(req.body?.sourceScope)
      : 'services_all';
    const targetScope = ['org_units', 'users', 'both'].includes(normalizeText(req.body?.targetScope))
      ? normalizeText(req.body?.targetScope)
      : 'both';
    const applyMode = ['review', 'auto_if_confident'].includes(normalizeText(req.body?.applyMode))
      ? normalizeText(req.body?.applyMode)
      : 'review';

    const minSuggestConfidence = clamp(Number(req.body?.minSuggestConfidence ?? 0.42), 0.05, 0.99);
    const minAutoApplyConfidence = clamp(Number(req.body?.minAutoApplyConfidence ?? 0.82), 0.05, 0.99);
    const maxKeywordsPerTarget = Math.max(1, Math.min(40, Number(req.body?.maxKeywordsPerTarget ?? 15)));
    const includeExistingKeywords = req.body?.includeExistingKeywords !== false;

    const jobId = createId('kijob');
    const db = getDatabase();
    await db.run(
      `INSERT INTO keyword_inference_jobs (
        id, tenant_id, status, source_scope, target_scope,
        include_existing_keywords, apply_mode,
        min_suggest_confidence, min_auto_apply_confidence, max_keywords_per_target,
        options_json, created_by_admin_id
      ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        jobId,
        scoped.tenantId,
        sourceScope,
        targetScope,
        includeExistingKeywords ? 1 : 0,
        applyMode,
        minSuggestConfidence,
        minAutoApplyConfidence,
        maxKeywordsPerTarget,
        JSON.stringify(parseJsonObject(req.body?.options)),
        userId || null,
      ]
    );

    await logJobEvent(jobId, 'created', 'Keywording-Job erstellt', {
      tenantId: scoped.tenantId,
      sourceScope,
      targetScope,
      includeExistingKeywords,
      applyMode,
      minSuggestConfidence,
      minAutoApplyConfidence,
      maxKeywordsPerTarget,
    }, userId);

    return res.status(201).json({
      job: {
        id: jobId,
        tenantId: scoped.tenantId,
        status: 'draft',
        sourceScope,
        targetScope,
        includeExistingKeywords,
        applyMode,
        minSuggestConfidence,
        minAutoApplyConfidence,
        maxKeywordsPerTarget,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Keywording-Job konnte nicht erstellt werden.' });
  }
});

router.get('/keywording/jobs', async (req: Request, res: Response) => {
  try {
    const { access, capabilities } = await resolveAccess(req);
    if (!canManageKeywording(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung für Schlagwort-Assistent.' });
    }

    const scoped = resolveTenantId(access, req.query?.tenantId || req.header('x-admin-context-tenant-id'));
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }

    const status = normalizeText(req.query?.status).toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 40)));
    const offset = Math.max(0, Number(req.query?.offset || 0));

    const params: any[] = [scoped.tenantId];
    const where: string[] = ['tenant_id = ?'];
    if (['draft', 'running', 'completed', 'failed', 'cancelled'].includes(status)) {
      where.push('status = ?');
      params.push(status);
    }

    const db = getDatabase();
    const [rows, totalRow] = await Promise.all([
      db.all<any>(
        `SELECT *
         FROM keyword_inference_jobs
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      db.get<any>(
        `SELECT COUNT(*) AS count
         FROM keyword_inference_jobs
         WHERE ${where.join(' AND ')}`,
        params
      ),
    ]);

    return res.json({
      items: (rows || []).map((row: any) => {
        const report = parseJsonObject(row?.report_json);
        return {
          id: normalizeText(row?.id),
          tenantId: normalizeText(row?.tenant_id),
          status: normalizeText(row?.status),
          sourceScope: normalizeText(row?.source_scope),
          targetScope: normalizeText(row?.target_scope),
          includeExistingKeywords: Number(row?.include_existing_keywords || 0) === 1,
          applyMode: normalizeText(row?.apply_mode),
          minSuggestConfidence: Number(row?.min_suggest_confidence || 0.42),
          minAutoApplyConfidence: Number(row?.min_auto_apply_confidence || 0.82),
          maxKeywordsPerTarget: Number(row?.max_keywords_per_target || 15),
          report,
          candidateCount: Number(report?.candidateCount || 0),
          errorMessage: normalizeText(row?.error_message) || null,
          running: runningJobs.has(normalizeText(row?.id)),
          createdByAdminId: normalizeText(row?.created_by_admin_id) || null,
          startedAt: row?.started_at || null,
          finishedAt: row?.finished_at || null,
          createdAt: row?.created_at || null,
          updatedAt: row?.updated_at || null,
        };
      }),
      total: Number(totalRow?.count || 0),
      limit,
      offset,
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Keywording-Jobs konnten nicht geladen werden.' });
  }
});

router.get('/keywording/jobs/:id', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const job = await loadJob(jobId);
    if (!job?.id) return res.status(404).json({ message: 'Job nicht gefunden.' });
    await ensureJobScope(req, job);

    const db = getDatabase();
    const [events, stats] = await Promise.all([
      db.all<any>(
        `SELECT id, event_type, message, payload_json, created_by_admin_id, created_at
         FROM keyword_inference_events
         WHERE job_id = ?
         ORDER BY created_at DESC
         LIMIT 300`,
        [jobId]
      ),
      db.all<any>(
        `SELECT action, COUNT(*) AS count
         FROM keyword_inference_candidates
         WHERE job_id = ?
         GROUP BY action`,
        [jobId]
      ),
    ]);

    const counts = (stats || []).reduce<Record<string, number>>((acc, row: any) => {
      acc[normalizeText(row?.action) || 'unknown'] = Number(row?.count || 0);
      return acc;
    }, {});

    return res.json({
      job: {
        id: normalizeText(job.id),
        tenantId: normalizeText(job.tenant_id),
        status: normalizeText(job.status),
        sourceScope: normalizeText(job.source_scope),
        targetScope: normalizeText(job.target_scope),
        includeExistingKeywords: Number(job.include_existing_keywords || 0) === 1,
        applyMode: normalizeText(job.apply_mode),
        minSuggestConfidence: Number(job.min_suggest_confidence || 0.42),
        minAutoApplyConfidence: Number(job.min_auto_apply_confidence || 0.82),
        maxKeywordsPerTarget: Number(job.max_keywords_per_target || 15),
        options: parseJsonObject(job.options_json),
        report: parseJsonObject(job.report_json),
        errorMessage: normalizeText(job.error_message) || null,
        createdByAdminId: normalizeText(job.created_by_admin_id) || null,
        startedAt: job.started_at || null,
        finishedAt: job.finished_at || null,
        createdAt: job.created_at || null,
        updatedAt: job.updated_at || null,
      },
      candidateStats: counts,
      running: runningJobs.has(jobId),
      events: (events || []).map((row: any) => ({
        id: normalizeText(row?.id),
        eventType: normalizeText(row?.event_type),
        message: normalizeText(row?.message),
        payload: parseJsonObject(row?.payload_json),
        createdByAdminId: normalizeText(row?.created_by_admin_id) || null,
        createdAt: row?.created_at || null,
      })),
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Job konnte nicht geladen werden.' });
  }
});

router.post('/keywording/jobs/:id/run', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const job = await loadJob(jobId);
    if (!job?.id) return res.status(404).json({ message: 'Job nicht gefunden.' });
    const { userId } = await ensureJobScope(req, job);

    if (runningJobs.has(jobId)) {
      return res.status(409).json({ message: 'Job läuft bereits.' });
    }

    void runKeywordJob(jobId, userId);
    return res.status(202).json({ id: jobId, status: 'running' });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Job konnte nicht gestartet werden.' });
  }
});

router.get('/keywording/jobs/:id/candidates', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const job = await loadJob(jobId);
    if (!job?.id) return res.status(404).json({ message: 'Job nicht gefunden.' });
    await ensureJobScope(req, job);

    const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 150)));
    const offset = Math.max(0, Number(req.query?.offset || 0));
    const minConfidence = Number.isFinite(Number(req.query?.minConfidence)) ? Number(req.query?.minConfidence) : null;
    const targetType = normalizeText(req.query?.targetType);
    const action = normalizeText(req.query?.action);
    const q = normalizeText(req.query?.q).toLowerCase();

    const where: string[] = ['job_id = ?'];
    const params: any[] = [jobId];

    if (targetType === 'user' || targetType === 'org_unit') {
      where.push('target_type = ?');
      params.push(targetType);
    }
    if (action) {
      where.push('action = ?');
      params.push(action);
    }
    if (minConfidence !== null) {
      where.push('confidence >= ?');
      params.push(clamp(minConfidence, 0, 1));
    }
    if (q) {
      where.push("(LOWER(COALESCE(keyword_text, '')) LIKE ? OR LOWER(COALESCE(canonical_keyword, '')) LIKE ?)");
      const needle = `%${q}%`;
      params.push(needle, needle);
    }

    const db = getDatabase();
    const [rows, totalRow] = await Promise.all([
      db.all<any>(
        `SELECT *
         FROM keyword_inference_candidates
         WHERE ${where.join(' AND ')}
         ORDER BY confidence DESC, target_type ASC, target_id ASC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      db.get<any>(
        `SELECT COUNT(*) AS count
         FROM keyword_inference_candidates
         WHERE ${where.join(' AND ')}`,
        params
      ),
    ]);

    return res.json({
      items: (rows || []).map((row: any) => ({
        id: normalizeText(row?.id),
        jobId: normalizeText(row?.job_id),
        tenantId: normalizeText(row?.tenant_id),
        targetType: normalizeText(row?.target_type),
        targetId: normalizeText(row?.target_id),
        keyword: normalizeText(row?.keyword_text),
        canonicalKeyword: normalizeText(row?.canonical_keyword),
        action: normalizeText(row?.action),
        confidence: Number(row?.confidence || 0),
        reasoning: normalizeText(row?.reasoning),
        evidence: parseJsonObject(row?.evidence_json),
        stageScores: parseJsonObject(row?.stage_scores_json),
        status: normalizeText(row?.status),
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
      })),
      total: Number(totalRow?.count || 0),
      limit,
      offset,
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Kandidaten konnten nicht geladen werden.' });
  }
});

router.post('/keywording/jobs/:id/apply', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const job = await loadJob(jobId);
    if (!job?.id) return res.status(404).json({ message: 'Job nicht gefunden.' });
    const { userId } = await ensureJobScope(req, job);

    const mode = normalizeText(req.body?.mode) === 'selected' ? 'selected' : 'all_above_threshold';
    const thresholdOverrideRaw = req.body?.thresholdOverride;
    const thresholdOverride = Number.isFinite(Number(thresholdOverrideRaw))
      ? clamp(Number(thresholdOverrideRaw), 0, 1)
      : null;
    const preserveManualKeywords = req.body?.preserveManualKeywords !== false;
    const selectedCandidateIds = Array.isArray(req.body?.selectedCandidateIds)
      ? req.body.selectedCandidateIds.map((entry: any) => normalizeText(entry)).filter(Boolean)
      : [];

    const minThreshold = thresholdOverride !== null
      ? thresholdOverride
      : normalizeText(job.apply_mode) === 'auto_if_confident'
      ? Number(job.min_auto_apply_confidence || 0.82)
      : Number(job.min_suggest_confidence || 0.42);
    const applyResult = await applyCandidatesForJob({
      job,
      actorUserId: userId,
      mode,
      threshold: minThreshold,
      preserveManualKeywords,
      selectedCandidateIds,
    });

    await logJobEvent(jobId, 'apply', 'Kandidaten übernommen', {
      ...applyResult,
    }, userId);

    return res.json({
      message: 'Kandidaten übernommen.',
      ...applyResult,
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Kandidaten konnten nicht übernommen werden.' });
  }
});

router.post('/keywording/jobs/:id/revert', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const job = await loadJob(jobId);
    if (!job?.id) return res.status(404).json({ message: 'Job nicht gefunden.' });
    const { userId } = await ensureJobScope(req, job);

    const db = getDatabase();
    const audits = await db.all<any>(
      `SELECT *
       FROM keyword_apply_audit
       WHERE job_id = ?
       ORDER BY applied_at DESC`,
      [jobId]
    );

    let reverted = 0;
    for (const audit of audits || []) {
      const targetType = normalizeText(audit?.target_type);
      const targetId = normalizeText(audit?.target_id);
      const before = parseKeywordArray(audit?.before_keywords_json);
      if (!targetType || !targetId) continue;
      if (targetType === 'org_unit') {
        await db.run(
          `UPDATE org_units
           SET assignment_keywords_json = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [serializeKeywords(before), targetId]
        );
      } else {
        await db.run(
          `UPDATE admin_users
           SET assignment_keywords_json = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [serializeKeywords(before), targetId]
        );
      }
      reverted += 1;
    }

    await logJobEvent(jobId, 'revert', 'Übernahme zurückgesetzt', { revertedTargets: reverted }, userId);

    return res.json({ message: 'Übernahme zurückgesetzt.', revertedTargets: reverted });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Revert fehlgeschlagen.' });
  }
});

router.post('/keywording/jobs/:id/cancel', async (req: Request, res: Response) => {
  try {
    const jobId = normalizeText(req.params.id);
    const job = await loadJob(jobId);
    if (!job?.id) return res.status(404).json({ message: 'Job nicht gefunden.' });
    const { userId } = await ensureJobScope(req, job);

    if (runningJobs.has(jobId)) {
      await getDatabase().run(
        `UPDATE keyword_inference_jobs
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [jobId]
      );
      await logJobEvent(jobId, 'cancelled', 'Jobabbruch angefordert', {}, userId);
      return res.json({ id: jobId, status: 'cancelled' });
    }

    await getDatabase().run(
      `UPDATE keyword_inference_jobs
       SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [jobId]
    );
    await logJobEvent(jobId, 'cancelled', 'Job abgebrochen', {}, userId);
    return res.json({ id: jobId, status: 'cancelled' });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Job konnte nicht abgebrochen werden.' });
  }
});

router.get('/keywording/dictionary', async (req: Request, res: Response) => {
  try {
    const { access, capabilities } = await resolveAccess(req);
    if (!canManageKeywording(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung für Schlagwort-Assistent.' });
    }
    const scoped = resolveTenantId(access, req.query?.tenantId || req.header('x-admin-context-tenant-id'));
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }

    const db = getDatabase();
    const rows = await db.all<any>(
      `SELECT *
       FROM keyword_dictionary
       WHERE tenant_id = ?
       ORDER BY LOWER(canonical_keyword) ASC`,
      [scoped.tenantId]
    );

    return res.json({
      items: (rows || []).map((row: any) => ({
        id: normalizeText(row?.id),
        tenantId: normalizeText(row?.tenant_id),
        canonicalKeyword: normalizeKeyword(row?.canonical_keyword),
        synonyms: parseKeywordArray(row?.synonyms_json),
        category: normalizeText(row?.category) || null,
        active: Number(row?.active ?? 1) === 1,
        notes: normalizeText(row?.notes) || '',
        createdByAdminId: normalizeText(row?.created_by_admin_id) || null,
        updatedByAdminId: normalizeText(row?.updated_by_admin_id) || null,
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
      })),
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Keyword-Wörterbuch konnte nicht geladen werden.' });
  }
});

router.patch('/keywording/dictionary', async (req: Request, res: Response) => {
  try {
    const { userId, access, capabilities } = await resolveAccess(req);
    if (!canManageKeywording(capabilities)) {
      return res.status(403).json({ message: 'Keine Berechtigung für Schlagwort-Assistent.' });
    }
    const scoped = resolveTenantId(access, req.body?.tenantId || req.header('x-admin-context-tenant-id'));
    if (scoped.error || !scoped.tenantId) {
      return res.status(400).json({ message: scoped.error || 'tenantId fehlt.' });
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const db = getDatabase();

    for (const item of items.slice(0, 1000)) {
      const id = normalizeText(item?.id);
      const canonicalKeyword = normalizeKeyword(item?.canonicalKeyword || item?.canonical_keyword);
      if (!canonicalKeyword) continue;
      const synonyms = parseKeywordArray(item?.synonyms || item?.synonyms_json);
      const category = normalizeText(item?.category) || null;
      const active = item?.active === false ? 0 : 1;
      const notes = normalizeText(item?.notes) || null;

      if (id) {
        await db.run(
          `UPDATE keyword_dictionary
           SET canonical_keyword = ?, synonyms_json = ?, category = ?, active = ?, notes = ?, updated_by_admin_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND tenant_id = ?`,
          [canonicalKeyword, JSON.stringify(synonyms), category, active, notes, userId || null, id, scoped.tenantId]
        );
      } else {
        await db.run(
          `INSERT INTO keyword_dictionary (
            id, tenant_id, canonical_keyword, synonyms_json, category, active, notes, created_by_admin_id, updated_by_admin_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [createId('kidic'), scoped.tenantId, canonicalKeyword, JSON.stringify(synonyms), category, active, notes, userId || null, userId || null]
        );
      }
    }

    return res.json({ message: 'Keyword-Wörterbuch gespeichert.' });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Keyword-Wörterbuch konnte nicht gespeichert werden.' });
  }
});

export default router;
