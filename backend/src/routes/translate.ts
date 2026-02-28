import express from 'express';
import { testAIProvider } from '../services/ai.js';
import { getDatabase } from '../database.js';
import { getSetting, getSystemPrompt } from '../services/settings.js';

const router = express.Router();
const DEFAULT_TRANSLATION_CACHE_TTL_DAYS = 30;
const MIN_TRANSLATION_CACHE_TTL_DAYS = 1;
const MAX_TRANSLATION_CACHE_TTL_DAYS = 3650;

function sanitizeTranslationCacheTtlDays(value: unknown, fallback = DEFAULT_TRANSLATION_CACHE_TTL_DAYS): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return Math.max(MIN_TRANSLATION_CACHE_TTL_DAYS, Math.min(MAX_TRANSLATION_CACHE_TTL_DAYS, rounded));
}

async function resolveTranslationCacheTtlDays(requested?: unknown): Promise<number> {
  if (requested !== undefined && requested !== null) {
    return sanitizeTranslationCacheTtlDays(requested);
  }
  const stored = await getSetting<any>('translationCacheTtlDays');
  if (typeof stored === 'number') {
    return sanitizeTranslationCacheTtlDays(stored);
  }
  if (stored && typeof stored === 'object') {
    const candidate = (stored as Record<string, unknown>).days ?? (stored as Record<string, unknown>).ttlDays;
    if (candidate !== undefined) {
      return sanitizeTranslationCacheTtlDays(candidate);
    }
  }
  return DEFAULT_TRANSLATION_CACHE_TTL_DAYS;
}

async function pruneExpiredTranslations(ttlDays: number): Promise<void> {
  const db = getDatabase();
  await db.run(
    `DELETE FROM translations
     WHERE datetime(updated_at) < datetime('now', ?)`,
    [`-${Math.max(1, ttlDays)} days`]
  );
}

function parseJsonObject(raw: string): Record<string, any> {
  if (!raw || typeof raw !== 'string') {
    throw new Error('KI-Antwort ist leer');
  }

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  }

  throw new Error('KI-Antwort ist kein gueltiges JSON');
}

router.get('/languages', async (_req, res, next) => {
  try {
    const ttlDays = await resolveTranslationCacheTtlDays(undefined);
    await pruneExpiredTranslations(ttlDays);
    const db = getDatabase();
    const rows = await db.all(
      `SELECT DISTINCT language
       FROM translations
       WHERE datetime(updated_at) >= datetime('now', ?)
       ORDER BY language ASC`,
      [`-${ttlDays} days`]
    );
    const languages = (rows || [])
      .map((row: any) => (typeof row?.language === 'string' ? row.language : null))
      .filter((lang: string | null): lang is string => !!lang);
    res.json({ languages, cacheTtlDays: ttlDays });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { targetLanguage, targetLanguageName, sourceLanguageName, strings, cacheTtlDays } = req.body || {};

    if (!targetLanguage || typeof targetLanguage !== 'string') {
      return res.status(400).json({ error: 'targetLanguage fehlt' });
    }

    if (!strings || typeof strings !== 'object') {
      return res.status(400).json({ error: 'strings fehlen' });
    }

    const entries = Object.entries(strings).filter(([, value]) => typeof value === 'string');

    if (entries.length === 0) {
      return res.json({ translations: {} });
    }

    const db = getDatabase();
    const ttlDays = await resolveTranslationCacheTtlDays(cacheTtlDays);
    await pruneExpiredTranslations(ttlDays);
    const keys = entries.map(([key]) => key);

    if (targetLanguage === 'de') {
      const passthrough = Object.fromEntries(entries);
      for (const [key, value] of entries) {
        await db.run(
          `INSERT INTO translations (language, \`key\`, \`value\`, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(language, \`key\`) DO UPDATE SET \`value\` = excluded.\`value\`, updated_at = CURRENT_TIMESTAMP`,
          ['de', key, value]
        );
      }
      return res.json({ translations: passthrough });
    }

    let cachedMap: Record<string, string> = {};
    if (keys.length > 0) {
      const placeholders = keys.map(() => '?').join(',');
      const cachedRows = await db.all(
        `SELECT \`key\`, \`value\`
         FROM translations
         WHERE language = ?
           AND \`key\` IN (${placeholders})
           AND datetime(updated_at) >= datetime('now', ?)`,
        [targetLanguage, ...keys, `-${ttlDays} days`]
      );
      cachedRows.forEach((row: any) => {
        if (row?.key && typeof row.value === 'string') {
          cachedMap[row.key] = row.value;
        }
      });
    }

    const missingKeys = keys.filter((key) => !cachedMap[key]);
    if (missingKeys.length === 0) {
      return res.json({ translations: cachedMap, cacheTtlDays: ttlDays });
    }

    const inputObject: Record<string, string> = {};
    for (const key of missingKeys) {
      inputObject[key] = strings[key];
    }

    const systemPrompt = await getSystemPrompt('uiTranslationPrompt');
    const prompt = `${systemPrompt}

Sprache:
- Quelle: ${sourceLanguageName || 'German'}
- Ziel: ${targetLanguageName || targetLanguage}

Input JSON:
${JSON.stringify(inputObject, null, 2)}

Output JSON:`;

    const raw = await testAIProvider(prompt, {
      purpose: 'ui_translation',
      meta: {
        source: 'routes.translate',
        targetLanguage,
      },
    });
    const parsed = parseJsonObject(raw);
    const root = parsed && typeof parsed === 'object' && parsed.translations && typeof parsed.translations === 'object'
      ? parsed.translations
      : parsed;

    const sanitized: Record<string, string> = { ...cachedMap };
    for (const key of missingKeys) {
      const original = strings[key];
      const value = root?.[key];
      sanitized[key] = typeof value === 'string' ? value : original;
    }

    for (const key of missingKeys) {
      const value = sanitized[key];
      if (typeof value !== 'string') continue;
      await db.run(
        `INSERT INTO translations (language, \`key\`, \`value\`, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(language, \`key\`) DO UPDATE SET \`value\` = excluded.\`value\`, updated_at = CURRENT_TIMESTAMP`,
        [targetLanguage, key, value]
      );
    }

    return res.json({ translations: sanitized, cacheTtlDays: ttlDays });
  } catch (error) {
    return next(error);
  }
});

export default router;
