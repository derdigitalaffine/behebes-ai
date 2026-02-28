import crypto from 'crypto';
import OpenAI from 'openai';
import { DEFAULT_IMAGE_ANALYSIS_PROMPT, getSystemPrompt, loadImageAiSettings } from './settings.js';
import { resolveLlmRuntimeSelection } from './llm-hub.js';

export interface ImageAiAnalysisResult {
  description: string;
  confidence: number | null;
  tags: string[];
  warnings: string[];
  raw: string;
  model: string;
  hash: string;
}

export interface ImageAiTicketContextInput {
  ticketId?: unknown;
  category?: unknown;
  priority?: unknown;
  status?: unknown;
  description?: unknown;
  address?: unknown;
  postalCode?: unknown;
  city?: unknown;
  locationText?: unknown;
  citizenName?: unknown;
  citizenEmail?: unknown;
  pseudoName?: unknown;
  pseudoEmail?: unknown;
  nominatimRaw?: unknown;
  weatherReport?: unknown;
  contextOptions?: {
    includeDescription?: boolean;
    includeOsmData?: boolean;
    includeWeatherData?: boolean;
  };
}

function normalizeJsonText(raw: string): string {
  return String(raw || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function extractJsonObject(raw: string): Record<string, any> | null {
  const normalized = normalizeJsonText(raw);
  if (!normalized) return null;
  try {
    const parsed = JSON.parse(normalized);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // continue with object extraction
  }

  const match = normalized.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const normalized = String(entry || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function normalizeConfidence(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

export function computeImageContentHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeOpenAiBaseUrl(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return 'https://api.openai.com/v1';
  return normalized.replace(/\/+$/g, '');
}

function buildLanguageHint(languageCode?: string | null): string {
  const normalized = String(languageCode || '').trim().toLowerCase();
  if (!normalized || normalized === 'de' || normalized.startsWith('de-')) {
    return 'Deutsch';
  }
  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 'English';
  }
  return normalized;
}

function normalizeContextValue(value: unknown): string {
  return String(value ?? '').trim();
}

function dedupeReplacementPairs(
  input: Array<{ from: string; to: string }>
): Array<{ from: string; to: string }> {
  const seen = new Set<string>();
  const result: Array<{ from: string; to: string }> = [];
  for (const entry of input) {
    const from = normalizeContextValue(entry.from);
    const to = normalizeContextValue(entry.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ from, to });
  }
  return result.sort((a, b) => b.from.length - a.from.length);
}

function applyLiteralReplacements(text: string, replacements: Array<{ from: string; to: string }>): string {
  let result = String(text || '');
  for (const replacement of replacements) {
    if (!replacement.from) continue;
    result = result.split(replacement.from).join(replacement.to);
  }
  return result;
}

function normalizeContextBlockText(value: unknown): string {
  return normalizeContextValue(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function parseContextObject(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, any>;
  }
  return null;
}

function clipContextText(value: unknown, maxLength: number): string {
  return normalizeContextBlockText(value).slice(0, maxLength);
}

function buildOsmContextSummary(raw: unknown): string {
  const source = parseContextObject(raw);
  if (!source) return 'Nicht verfuegbar';

  const address =
    source.address && typeof source.address === 'object' && !Array.isArray(source.address)
      ? (source.address as Record<string, any>)
      : {};
  const locationParts = [
    String(address.road || '').trim(),
    String(address.house_number || '').trim(),
    String(address.postcode || '').trim(),
    String(address.city || address.town || address.village || address.municipality || '').trim(),
  ].filter(Boolean);
  const location = locationParts.join(' ').trim();

  const lines: string[] = [];
  const displayName = clipContextText(source.display_name, 320);
  if (displayName) lines.push(`Treffer: ${displayName}`);
  const category = clipContextText(source.category || source.class, 80);
  const type = clipContextText(source.type, 80);
  if (category || type) lines.push(`Typ: ${[category, type].filter(Boolean).join(' / ')}`);
  if (location) lines.push(`Adresse: ${clipContextText(location, 240)}`);
  const lat = Number(source.lat);
  const lon = Number(source.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    lines.push(`Koordinaten: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
  }
  const importance = Number(source.importance);
  if (Number.isFinite(importance)) {
    lines.push(`Relevanz: ${Math.max(0, Math.min(1, importance)).toFixed(2)}`);
  }

  return clipContextText(lines.join(' | '), 900) || 'Nicht verfuegbar';
}

function buildWeatherContextSummary(raw: unknown): string {
  const source = parseContextObject(raw);
  if (!source) return 'Nicht verfuegbar';

  const values =
    source.values && typeof source.values === 'object' && !Array.isArray(source.values)
      ? (source.values as Record<string, any>)
      : {};
  const units =
    source.units && typeof source.units === 'object' && !Array.isArray(source.units)
      ? (source.units as Record<string, any>)
      : {};

  const time =
    clipContextText(source.observationTimeUtc, 60) ||
    clipContextText(source.reportTimestampUtc, 60) ||
    clipContextText(source.observedAt, 60);
  const temperature = Number(values.temperatureC ?? values.temperature ?? source.temperatureC);
  const apparent = Number(values.apparentTemperatureC ?? values.apparent_temperature ?? source.apparentTemperatureC);
  const precipitation = Number(values.precipitationMm ?? values.precipitation ?? source.precipitationMm);
  const wind = Number(values.windSpeed10mKmh ?? values.wind_speed_10m ?? source.windSpeed10mKmh);
  const weatherCode = clipContextText(values.weatherCode ?? source.weatherCode, 32);

  const lines: string[] = [];
  if (time) lines.push(`Zeitpunkt UTC: ${time}`);
  if (Number.isFinite(temperature)) {
    lines.push(`Temperatur: ${temperature.toFixed(1)} ${clipContextText(units.temperature_2m, 8) || '°C'}`);
  }
  if (Number.isFinite(apparent)) {
    lines.push(`Gefuehlt: ${apparent.toFixed(1)} ${clipContextText(units.apparent_temperature, 8) || '°C'}`);
  }
  if (Number.isFinite(precipitation)) {
    lines.push(`Niederschlag: ${precipitation.toFixed(1)} ${clipContextText(units.precipitation, 8) || 'mm'}`);
  }
  if (Number.isFinite(wind)) {
    lines.push(`Wind: ${wind.toFixed(1)} ${clipContextText(units.wind_speed_10m, 12) || 'km/h'}`);
  }
  if (weatherCode) lines.push(`Wettercode: ${weatherCode}`);

  return clipContextText(lines.join(' | '), 900) || 'Nicht verfuegbar';
}

function pseudonymizeContextText(
  value: unknown,
  replacements: Array<{ from: string; to: string }>
): string {
  const normalized = normalizeContextBlockText(value);
  if (!normalized) return '';
  return normalizeContextBlockText(applyLiteralReplacements(normalized, replacements));
}

export function buildImageAiPseudonymizedTicketContext(input: ImageAiTicketContextInput): string {
  const includeDescription = input.contextOptions?.includeDescription !== false;
  const includeOsmData = input.contextOptions?.includeOsmData === true;
  const includeWeatherData = input.contextOptions?.includeWeatherData === true;
  const ticketId = normalizeContextValue(input.ticketId);
  const category = normalizeContextValue(input.category);
  const priority = normalizeContextValue(input.priority);
  const status = normalizeContextValue(input.status);
  const realName = normalizeContextValue(input.citizenName);
  const realEmailRaw = normalizeContextValue(input.citizenEmail);
  const realEmailLower = realEmailRaw.toLowerCase();
  const pseudoName = normalizeContextValue(input.pseudoName);
  const pseudoEmail = normalizeContextValue(input.pseudoEmail).toLowerCase();
  const locationRaw =
    normalizeContextValue(input.locationText) ||
    [normalizeContextValue(input.address), normalizeContextValue(input.postalCode), normalizeContextValue(input.city)]
      .filter(Boolean)
      .join(', ');
  const replacementPairs = dedupeReplacementPairs([
    { from: realName, to: pseudoName },
    { from: realEmailRaw, to: pseudoEmail },
    { from: realEmailLower, to: pseudoEmail },
  ]);
  const pseudonymizedDescription = pseudonymizeContextText(input.description, replacementPairs).slice(0, 1400);
  const pseudonymizedLocation = pseudonymizeContextText(locationRaw, replacementPairs).slice(0, 260);
  const nominatimSummary = includeOsmData ? buildOsmContextSummary(input.nominatimRaw) : '';
  const weatherSummary = includeWeatherData ? buildWeatherContextSummary(input.weatherReport) : '';
  const lines: string[] = ['Pseudonymisierter Ticketkontext:'];
  if (ticketId) lines.push(`- Ticket-ID: ${ticketId}`);
  if (category) lines.push(`- Kategorie: ${category}`);
  if (priority) lines.push(`- Prioritaet: ${priority}`);
  if (status) lines.push(`- Status: ${status}`);
  if (pseudoName || pseudoEmail) {
    const reporter = [pseudoName, pseudoEmail ? `<${pseudoEmail}>` : ''].filter(Boolean).join(' ');
    lines.push(`- Meldende Person (Pseudonym): ${reporter}`);
  }
  if (pseudonymizedLocation) lines.push(`- Ort: ${pseudonymizedLocation}`);
  if (includeDescription && pseudonymizedDescription) {
    lines.push(`- Ticketbeschreibung (pseudonymisiert): ${pseudonymizedDescription}`);
  }
  if (includeOsmData) lines.push(`- OSM/Nominatim (kompakt): ${nominatimSummary || 'Nicht verfuegbar'}`);
  if (includeWeatherData) lines.push(`- Wetterdaten (kompakt): ${weatherSummary || 'Nicht verfuegbar'}`);
  if (lines.length === 1) {
    lines.push('- Keine zusaetzlichen Kontextdaten verfuegbar.');
  }
  return lines.join('\n');
}

export async function analyzeImageToText(input: {
  imageBuffer: Buffer;
  mimeType: string;
  fileName?: string | null;
  languageCode?: string | null;
  ticketContext?: string | null;
  modelId?: string | null;
  connectionId?: string | null;
}): Promise<ImageAiAnalysisResult> {
  const { values: imageAi } = await loadImageAiSettings(false);
  const runtime = await resolveLlmRuntimeSelection({
    purpose: 'image_to_text',
    taskKey: 'image_to_text',
    modelId: input.modelId || undefined,
    connectionId: input.connectionId || undefined,
  });
  if (imageAi.enabled !== true && !runtime.apiKey) {
    throw new Error('Bild-KI ist deaktiviert.');
  }
  if (!runtime.apiKey) {
    throw new Error('Bild-KI API-Key fehlt.');
  }

  const hash = computeImageContentHash(input.imageBuffer);
  const dataUrl = `data:${input.mimeType || 'image/jpeg'};base64,${input.imageBuffer.toString('base64')}`;
  const client = new OpenAI({
    apiKey: runtime.apiKey,
    baseURL: normalizeOpenAiBaseUrl(runtime.baseUrl),
  });

  const languageHint = buildLanguageHint(input.languageCode);
  let promptBase = '';
  try {
    promptBase = String(await getSystemPrompt('imageAnalysisPrompt') || '').trim();
  } catch {
    promptBase = '';
  }
  if (!promptBase) {
    promptBase = String(imageAi.prompt || '').trim() || DEFAULT_IMAGE_ANALYSIS_PROMPT;
  }
  const ticketContext = String(input.ticketContext || '').trim();
  const prompt = `${promptBase}

Kontext:
- Dateiname: ${String(input.fileName || 'bild')}
- Ziel-Sprache fuer description: ${languageHint}
- Pseudonymisierter Ticketkontext:
${ticketContext || 'Keine zusaetzlichen Kontextdaten verfuegbar.'}
- Antworte nur als JSON.`;

  const response = await client.chat.completions.create({
    model: runtime.model || imageAi.model,
    temperature: imageAi.temperature,
    max_tokens: imageAi.maxTokens,
    messages: [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Bitte analysiere dieses Bild und liefere die geforderte JSON-Antwort.',
          },
          {
            type: 'image_url',
            image_url: {
              url: dataUrl,
              detail: imageAi.detail,
            },
          },
        ],
      },
    ],
  });

  const raw = String(response.choices?.[0]?.message?.content || '').trim();
  const parsed = extractJsonObject(raw) || {};

  const descriptionRaw = String(parsed.description || parsed.text || parsed.summary || '').trim();
  const description = descriptionRaw || normalizeJsonText(raw).slice(0, 1200);
  const confidence = normalizeConfidence(parsed.confidence);
  const tags = normalizeList(parsed.tags, 8);
  const warnings = normalizeList(parsed.warnings, 5);

  return {
    description,
    confidence,
    tags,
    warnings,
    raw,
    model: String(response.model || runtime.model || imageAi.model || '').trim() || runtime.model || imageAi.model,
    hash,
  };
}
