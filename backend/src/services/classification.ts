/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * Shared classification service (used by public /api/classify and internal ticket creation)
 */

import { testAIProvider } from './ai.js';
import { getSystemPrompt } from './settings.js';
import { loadKnowledgeBaseFromLibrary } from './content-libraries.js';
const NOMINATIM_USER_AGENT = 'behebes-ai/1.0 (Verbandsgemeinde Otterbach Otterberg)';

export interface ClassificationInput {
  description: string;
  location?: string;
  imageContext?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  city?: string;
  postalCode?: string;
  nominatimRaw?: Record<string, any> | null;
  weatherReport?: Record<string, any> | null;
}

export interface EffectiveClassificationInput extends ClassificationInput {
  nominatimSource: 'provided' | 'reverse' | 'none';
  weatherSource: 'provided' | 'none';
}

export interface ClassificationResult {
  kategorie: string;
  dringlichkeit: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
  abteilung?: string | null;
  categoryId: string;
  redmineProject?: string | null;
  _metadata?: Record<string, any>;
}

export interface KnowledgeBase {
  version?: string;
  categories?: any[];
  assignments?: any[];
  urgencies?: any[];
  redmine?: any;
  classifyPrompt?: string;
}

const DEFAULT_KNOWLEDGE: KnowledgeBase = {
  version: '1.0.0',
  categories: [
    { id: 'sonstiges', name: 'Sonstiges', description: 'Sonstige Anliegen' },
  ],
  assignments: [],
  urgencies: [],
};

export function sanitizeText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\w\.-]+@[\w\.-]+\.\w+/g, '[EMAIL]')
    .replace(/\+?[\d\s\-\(\)]{7,}/g, '[PHONE]');
}

export async function loadKnowledgeBase(): Promise<KnowledgeBase> {
  try {
    const knowledge = await loadKnowledgeBaseFromLibrary({
      scope: 'platform',
    });
    return knowledge as KnowledgeBase;
  } catch (error) {
    console.error('Error loading knowledge base:', error);
    return DEFAULT_KNOWLEDGE;
  }
}

async function loadCustomPrompt(): Promise<string> {
  return getSystemPrompt('classifyPrompt');
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeCoordinate(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return numeric;
}

function toNominatimObject(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return null;
  }
  return null;
}

function toWeatherObject(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return null;
  }
  return null;
}

function resolveNominatimCity(raw: Record<string, any> | null): string {
  if (!raw || typeof raw !== 'object') return '';
  const address = raw.address && typeof raw.address === 'object' ? raw.address : {};
  return (
    normalizeText((address as any).city) ||
    normalizeText((address as any).town) ||
    normalizeText((address as any).village) ||
    normalizeText((address as any).municipality) ||
    normalizeText((address as any).hamlet)
  );
}

function buildNominatimContext(raw: Record<string, any> | null): string {
  if (!raw) return '';
  const address = raw.address && typeof raw.address === 'object' ? raw.address : {};
  const rawJson = JSON.stringify(raw, null, 2);
  const lines: string[] = [];

  const summaryPairs: Array<[string, string]> = [
    ['display_name', normalizeText(raw.display_name)],
    ['class', normalizeText(raw.class)],
    ['type', normalizeText(raw.type)],
    ['addresstype', normalizeText(raw.addresstype)],
    ['place_rank', normalizeText(raw.place_rank)],
    ['importance', normalizeText(raw.importance)],
    ['osm_type', normalizeText(raw.osm_type)],
    ['osm_id', normalizeText(raw.osm_id)],
  ];
  const summaryLine = summaryPairs
    .filter(([, value]) => !!value)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
  if (summaryLine) {
    lines.push(`Nominatim-Kernfelder: ${summaryLine}`);
  }

  const addressEntries = Object.entries(address as Record<string, any>)
    .map(([key, value]) => `${key}=${normalizeText(value)}`)
    .filter((entry) => !entry.endsWith('='))
    .slice(0, 80);
  if (addressEntries.length > 0) {
    lines.push(`Nominatim-Adresskomponenten: ${addressEntries.join('; ')}`);
  }

  if (rawJson) {
    lines.push(`Nominatim-Geoobjekt (vollstaendig, JSON):\n${rawJson}`);
  }
  return lines.join('\n');
}

function buildWeatherContext(raw: Record<string, any> | null): string {
  if (!raw || typeof raw !== 'object') return '';
  const lines: string[] = [];
  const values = raw.values && typeof raw.values === 'object' ? (raw.values as Record<string, any>) : {};
  const units = raw.units && typeof raw.units === 'object' ? (raw.units as Record<string, any>) : {};
  const provider = normalizeText(raw.provider);
  const source = normalizeText(raw.source);
  const reportTimestamp = normalizeText(raw.reportTimestampUtc);
  const observationTimestamp = normalizeText(raw.observationTimeUtc);
  const weatherCode = normalizeText(values.weatherCode ?? values.weather_code);

  const summaryPairs: Array<[string, string]> = [
    ['provider', provider],
    ['source', source],
    ['reportTimestampUtc', reportTimestamp],
    ['observationTimeUtc', observationTimestamp],
    ['temperature', `${normalizeText(values.temperatureC)} ${normalizeText(units.temperature_2m)}`.trim()],
    ['apparentTemperature', `${normalizeText(values.apparentTemperatureC)} ${normalizeText(units.apparent_temperature)}`.trim()],
    ['precipitation', `${normalizeText(values.precipitationMm)} ${normalizeText(units.precipitation)}`.trim()],
    ['windSpeed', `${normalizeText(values.windSpeed10mKmh)} ${normalizeText(units.wind_speed_10m)}`.trim()],
    ['weatherCode', weatherCode],
  ];

  const summary = summaryPairs
    .filter(([, value]) => !!value)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
  if (summary) {
    lines.push(`Wetter-Kernfelder: ${summary}`);
  }

  lines.push(`Wetterdaten (vollstaendig, JSON):\n${JSON.stringify(raw, null, 2)}`);
  return lines.join('\n');
}

async function reverseGeocodeCoordinates(latitude: number, longitude: number): Promise<Record<string, any> | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const endpoint = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
    String(latitude)
  )}&lon=${encodeURIComponent(String(longitude))}&zoom=18&addressdetails=1&extratags=1&namedetails=1`;
  try {
    const response = await fetch(endpoint, {
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload as Record<string, any>;
  } catch {
    return null;
  }
}

async function enrichInputWithNominatim(input: ClassificationInput): Promise<EffectiveClassificationInput> {
  const latitude = normalizeCoordinate(input.latitude);
  const longitude = normalizeCoordinate(input.longitude);
  const providedNominatim = toNominatimObject(input.nominatimRaw);
  const providedWeather = toWeatherObject(input.weatherReport);

  const enriched: EffectiveClassificationInput = {
    ...input,
    latitude,
    longitude,
    address: normalizeText(input.address) || undefined,
    city: normalizeText(input.city) || undefined,
    postalCode: normalizeText(input.postalCode) || undefined,
    nominatimRaw: providedNominatim || undefined,
    weatherReport: providedWeather || undefined,
    nominatimSource: providedNominatim ? 'provided' : 'none',
    weatherSource: providedWeather ? 'provided' : 'none',
  };

  if (providedNominatim) {
    if (!enriched.address) enriched.address = normalizeText(providedNominatim.display_name) || undefined;
    if (!enriched.city) enriched.city = resolveNominatimCity(providedNominatim) || undefined;
    if (!enriched.postalCode) {
      const address = providedNominatim.address && typeof providedNominatim.address === 'object' ? providedNominatim.address : {};
      enriched.postalCode = normalizeText((address as any).postcode) || undefined;
    }
    return enriched;
  }

  if (latitude === undefined || longitude === undefined) {
    return enriched;
  }

  const reverseNominatim = await reverseGeocodeCoordinates(latitude, longitude);
  if (!reverseNominatim) {
    return enriched;
  }

  const reverseAddress = reverseNominatim.address && typeof reverseNominatim.address === 'object' ? reverseNominatim.address : {};
  enriched.nominatimRaw = reverseNominatim;
  enriched.nominatimSource = 'reverse';
  if (!enriched.address) enriched.address = normalizeText(reverseNominatim.display_name) || undefined;
  if (!enriched.city) enriched.city = resolveNominatimCity(reverseNominatim) || undefined;
  if (!enriched.postalCode) enriched.postalCode = normalizeText((reverseAddress as any).postcode) || undefined;
  return enriched;
}

function buildClassificationPrompt(
  description: string,
  categories: string,
  urgencies: string,
  location?: string,
  geoInfo?: string,
  weatherInfo?: string,
  customMdPrompt?: string,
  imageContext?: string
): { system: string; user: string } {
  let systemPrompt = customMdPrompt || `# AI-Kategorisierungs-System

Du bist ein KI-Kategorisierungs-System für eine Verwaltung.
Analysiere die folgende Bürgermeldung und kategorisiere sie strukturiert mit JSON-Antwort.`;

  systemPrompt += `

## VERFÜGBARE KATEGORIEN
${categories || '- Keine Kategorien verfügbar'}

## DRINGLICHKEITSSTUFEN
${urgencies}

## KONTEXT: ORT & ADRESSE
${geoInfo || '(Keine Standortinformationen verfügbar)'}

## KONTEXT: WETTER ZUM MELDEZEITPUNKT
${weatherInfo || '(Keine Wetterinformationen verfügbar)'}

## JSON-RESPONSE-FORMAT
\`\`\`json
{
  "kategorie": "Exakter Kategoriename",
  "dringlichkeit": "low|medium|high|critical",
  "reasoning": "Sachliche Begründung"
}
\`\`\``;

  let userMessage = `Meldung: "${description}"`;
  if (location && location.trim().length > 0) {
    userMessage += `\nOrt (Adresse): "${location}"`;
  }
  if (geoInfo && geoInfo.trim().length > 0) {
    userMessage += `\n${geoInfo}`;
  }
  if (weatherInfo && weatherInfo.trim().length > 0) {
    userMessage += `\n${weatherInfo}`;
  }
  if (imageContext && imageContext.trim().length > 0) {
    userMessage += `\nKI-BILDBESCHREIBUNGEN (stammen direkt aus den angehaengten Bildern):\n${imageContext.trim()}`;
  }

  return {
    system: systemPrompt,
    user: userMessage,
  };
}

export async function buildClassificationPromptForDebug(
  input: ClassificationInput
): Promise<{
  knowledge: KnowledgeBase;
  systemPrompt: string;
  userPrompt: string;
  combinedPrompt: string;
  sanitizedDescription: string;
  sanitizedLocation: string;
  geoContext: string;
  weatherContext: string;
  effectiveInput: EffectiveClassificationInput;
}> {
  const effectiveInput = await enrichInputWithNominatim(input);
  const knowledge = await loadKnowledgeBase();

  const sanitizedDescription = sanitizeText(effectiveInput.description);
  const sanitizedLocation = sanitizeText(effectiveInput.location || '');

  let geoContext = '';
  if (effectiveInput.latitude !== undefined && effectiveInput.longitude !== undefined) {
    geoContext = `Koordinaten: ${effectiveInput.latitude}, ${effectiveInput.longitude}`;
  }
  if (effectiveInput.address) {
    geoContext += geoContext ? `; Adresse: ${effectiveInput.address}` : `Adresse: ${effectiveInput.address}`;
  }
  if (effectiveInput.city) {
    geoContext += geoContext ? `; Stadt/Ort: ${effectiveInput.city}` : `Stadt/Ort: ${effectiveInput.city}`;
  }
  if (effectiveInput.postalCode) {
    geoContext += geoContext ? `; PLZ: ${effectiveInput.postalCode}` : `PLZ: ${effectiveInput.postalCode}`;
  }
  const nominatimContext = buildNominatimContext(effectiveInput.nominatimRaw || null);
  if (nominatimContext) {
    geoContext += `${geoContext ? '\n' : ''}${nominatimContext}`;
  }
  const weatherContext = buildWeatherContext(effectiveInput.weatherReport || null);

  const categoryContext = (knowledge.categories || [])
    .map((cat: any) => {
      const kws = Array.isArray(cat.keywords) && cat.keywords.length > 0 ? ` [${cat.keywords.join(', ')}]` : '';
      const dept = cat.assignedTo ? ` → ${cat.assignedTo}` : '';
      return `- ${cat.name}: ${cat.description || ''}${dept}${kws}`;
    })
    .join('\n');

  const urgencyContext = knowledge.urgencies
    ?.map((u: any) => `- ${u.label} (${u.level}): ${u.description} - Antwortzeit: ${u.responseTime}`)
    .join('\n') || '- low: Niedrig\n- medium: Mittel\n- high: Hoch\n- critical: Kritisch';

  const customPrompt = await loadCustomPrompt();

  const { system: systemPrompt, user: userPrompt } = buildClassificationPrompt(
    sanitizedDescription,
    categoryContext,
    urgencyContext,
    sanitizedLocation,
    geoContext,
    weatherContext,
    customPrompt,
    effectiveInput.imageContext
  );

  return {
    knowledge,
    systemPrompt,
    userPrompt,
    combinedPrompt: `${systemPrompt}\n\n${userPrompt}`,
    sanitizedDescription,
    sanitizedLocation,
    geoContext,
    weatherContext,
    effectiveInput,
  };
}

export async function classifySubmission(
  input: ClassificationInput
): Promise<{ result: ClassificationResult; knowledge: KnowledgeBase; raw: any | null; effectiveInput: EffectiveClassificationInput } > {
  const { knowledge, systemPrompt, userPrompt, effectiveInput } = await buildClassificationPromptForDebug(input);

  const priorityOptions = ['low', 'medium', 'high', 'critical'];

  try {
    const aiResponse = await testAIProvider(systemPrompt + '\n\n' + userPrompt, {
      purpose: 'classification',
      meta: {
        source: 'services.classification',
      },
    });

    let classificationResult: any;
    try {
      classificationResult = JSON.parse(aiResponse);
    } catch {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        classificationResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Keine JSON in KI-Antwort gefunden');
      }
    }

    if (!classificationResult.kategorie) {
      classificationResult.kategorie = 'Sonstiges';
    }

    if (!classificationResult.dringlichkeit || !priorityOptions.includes(classificationResult.dringlichkeit)) {
      classificationResult.dringlichkeit = 'medium';
    }

    const allCategories = [...(knowledge.categories || [])];
    const normalizedModelCategory = String(classificationResult.kategorie || '').trim().toLowerCase();
    let categoryData = allCategories.find(
      (cat: any) => String(cat?.name || '').trim().toLowerCase() === normalizedModelCategory
    );
    if (!categoryData) {
      categoryData = allCategories.find(
        (cat: any) => String(cat?.id || '').trim().toLowerCase() === normalizedModelCategory
      );
    }
    if (!categoryData) {
      categoryData =
        allCategories.find((cat: any) => String(cat?.name || '').trim().toLowerCase() === 'sonstiges') ||
        allCategories.find((cat: any) => String(cat?.id || '').trim().toLowerCase() === 'sonstiges') ||
        allCategories[0] ||
        null;
    }

    const categoryId = categoryData?.id || 'sonstiges';
    const categoryName = categoryData?.name || 'Sonstiges';

    const assignment = categoryData
      ? knowledge.assignments?.find(
          (assign: any) => assign.condition?.includes(categoryId) || assign.categoryId === categoryId
        )
      : null;

    const redmineProject = classificationResult.redmineProject || null;

    const result: ClassificationResult = {
      kategorie: categoryName,
      dringlichkeit: classificationResult.dringlichkeit,
      reasoning: classificationResult.reasoning || 'Keine Begründung verfügbar',
      abteilung: assignment?.assignedTo || null,
      categoryId,
      redmineProject,
      _metadata: {
        defaultPriority: categoryData?.defaultPriority || null,
      },
    };

    return { result, knowledge, raw: classificationResult, effectiveInput };
  } catch (aiError) {
    console.error('AI categorization error:', aiError);
    return {
      result: {
        kategorie: 'Sonstiges',
        dringlichkeit: 'medium',
        reasoning: 'Automatische Kategorisierung nicht verfügbar. Ihre Meldung wird manuell überprüft.',
        abteilung: null,
        categoryId: 'sonstiges',
        _metadata: { error: 'AI_FAILED' },
      },
      knowledge,
      raw: null,
      effectiveInput,
    };
  }
}
