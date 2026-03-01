import type { AppDatabase } from '../db-adapter.js';

export interface ResponsibilityCandidate {
  type: 'org_unit' | 'user';
  id: string;
  tenantId: string | null;
  orgUnitId?: string | null;
  name: string;
  confidence: number;
  score: number;
  matchedKeywords: string[];
  reasoning: string;
}

export interface ResponsibilityQueryInput {
  query: string;
  tenantId?: string | null;
  includeUsers?: boolean;
  limit?: number;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeKeyword(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ');
}

function splitTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2);
}

function parseKeywords(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeKeyword(entry)).filter(Boolean);
  }
  const text = String(raw || '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => normalizeKeyword(entry)).filter(Boolean);
      }
    } catch {
      // ignore
    }
  }
  return text
    .split(/[\n,;|]+/g)
    .map((entry) => normalizeKeyword(entry))
    .filter(Boolean);
}

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeKeyword(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function scoreKeywordMatch(queryTokens: string[], queryText: string, keywords: string[]): {
  score: number;
  matchedKeywords: string[];
} {
  let score = 0;
  const matched: string[] = [];
  for (const keyword of uniqueText(keywords)) {
    if (!keyword) continue;
    const keywordTokens = splitTokens(keyword);
    const overlapCount = keywordTokens.filter((token) => queryTokens.includes(token)).length;
    if (overlapCount <= 0) continue;
    const overlapRatio = overlapCount / Math.max(1, keywordTokens.length);
    const specificityBoost = Math.min(1.4, keywordTokens.length / 3);
    const phraseBoost = queryText.includes(keyword) ? 0.7 : 0;
    const value = overlapRatio * (1 + specificityBoost) + phraseBoost;
    score += value;
    matched.push(keyword);
  }
  return { score, matchedKeywords: uniqueText(matched) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function confidenceFromScore(score: number): number {
  const normalized = 1 / (1 + Math.exp(-0.85 * (score - 1.8)));
  return clamp(Number(normalized.toFixed(4)), 0, 1);
}

export async function queryResponsibilityCandidates(
  db: AppDatabase,
  input: ResponsibilityQueryInput
): Promise<ResponsibilityCandidate[]> {
  const query = normalizeText(input.query);
  if (!query) return [];
  const tenantId = normalizeText(input.tenantId || '');
  const queryTokens = uniqueText(splitTokens(query));
  if (queryTokens.length === 0) return [];
  const includeUsers = input.includeUsers !== false;
  const limit = Math.max(1, Math.min(50, Number(input.limit || 8)));

  const orgRows = await db.all<any>(
    `SELECT ou.id,
            ou.tenant_id,
            ou.name,
            ou.assignment_keywords_json,
            out.label AS type_label,
            out.assignment_keywords_json AS type_assignment_keywords_json
     FROM org_units ou
     LEFT JOIN org_unit_types out ON out.id = ou.type_id
     WHERE (ou.active = 1 OR ou.active IS NULL)
       ${tenantId ? `AND ou.tenant_id = ?` : ''}`,
    tenantId ? [tenantId] : []
  );

  const orgCandidates: ResponsibilityCandidate[] = [];
  for (const row of orgRows || []) {
    const name = normalizeText(row?.name);
    if (!name) continue;
    const ownKeywords = parseKeywords(row?.assignment_keywords_json);
    const typeKeywords = parseKeywords(row?.type_assignment_keywords_json);
    const labelKeywords = splitTokens(`${normalizeText(row?.type_label)} ${name}`);
    const { score, matchedKeywords } = scoreKeywordMatch(queryTokens, query.toLowerCase(), [
      ...ownKeywords,
      ...typeKeywords,
      ...labelKeywords,
      ...splitTokens(name),
    ]);
    if (score <= 0) continue;
    const confidence = confidenceFromScore(score);
    orgCandidates.push({
      type: 'org_unit',
      id: normalizeText(row?.id),
      tenantId: normalizeText(row?.tenant_id) || null,
      orgUnitId: normalizeText(row?.id) || null,
      name,
      score,
      confidence,
      matchedKeywords,
      reasoning: `Treffer in Organisationseinheit (${matchedKeywords.slice(0, 6).join(', ') || 'Namenstokens'})`,
    });
  }

  const userCandidates: ResponsibilityCandidate[] = [];
  if (includeUsers) {
    const userRows = await db.all<any>(
      `SELECT u.id,
              u.assignment_keywords_json,
              u.first_name,
              u.last_name,
              u.username,
              s.tenant_id,
              s.org_unit_id
       FROM admin_users u
       LEFT JOIN admin_user_org_scopes s ON s.admin_user_id = u.id
       WHERE (u.active = 1 OR u.active IS NULL)
         ${tenantId ? `AND (s.tenant_id = ? OR s.tenant_id IS NULL)` : ''}`,
      tenantId ? [tenantId] : []
    );
    for (const row of userRows || []) {
      const id = normalizeText(row?.id);
      if (!id) continue;
      const displayName =
        [normalizeText(row?.first_name), normalizeText(row?.last_name)].filter(Boolean).join(' ').trim() ||
        normalizeText(row?.username) ||
        id;
      const keywords = parseKeywords(row?.assignment_keywords_json);
      const nameTokens = splitTokens(displayName);
      const { score, matchedKeywords } = scoreKeywordMatch(queryTokens, query.toLowerCase(), [
        ...keywords,
        ...nameTokens,
      ]);
      if (score <= 0) continue;
      const boostedScore = score + (matchedKeywords.length >= 2 ? 0.45 : 0);
      const confidence = confidenceFromScore(boostedScore);
      userCandidates.push({
        type: 'user',
        id,
        tenantId: normalizeText(row?.tenant_id) || null,
        orgUnitId: normalizeText(row?.org_unit_id) || null,
        name: displayName,
        score: boostedScore,
        confidence,
        matchedKeywords,
        reasoning: `Treffer in Benutzerprofil (${matchedKeywords.slice(0, 6).join(', ') || 'Namenstokens'})`,
      });
    }
  }

  return [...userCandidates, ...orgCandidates]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.type !== b.type) return a.type === 'user' ? -1 : 1;
      return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
    })
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      confidence: clamp(Number(entry.confidence.toFixed(4)), 0, 1),
      score: Number(entry.score.toFixed(4)),
    }));
}

