/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * Geo + weather enrichment for tickets/submissions.
 */

import { loadWeatherApiSettings, WeatherApiSettings } from './settings.js';

const NOMINATIM_USER_AGENT = 'behebes-ai/1.0 (Verbandsgemeinde Otterbach Otterberg)';

type NominatimSource = 'none' | 'reverse' | 'search';
type WeatherSource = 'none' | 'open-meteo-archive' | 'open-meteo-forecast';

export interface GeoWeatherEnrichmentInput {
  latitude?: unknown;
  longitude?: unknown;
  address?: unknown;
  postalCode?: unknown;
  city?: unknown;
  reportedAt?: unknown;
}

export interface GeoWeatherEnrichmentResult {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  nominatimRaw: Record<string, any> | null;
  nominatimSource: NominatimSource;
  weatherReport: Record<string, any> | null;
  weatherSource: WeatherSource;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(String(value || ''));
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return new Date();
}

function toIsoDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeNominatimPayload(payload: unknown): Record<string, any> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload as Record<string, any>;
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

function resolveNominatimPostalCode(raw: Record<string, any> | null): string {
  if (!raw || typeof raw !== 'object') return '';
  const address = raw.address && typeof raw.address === 'object' ? raw.address : {};
  return normalizeText((address as any).postcode);
}

function resolveNominatimCoordinates(raw: Record<string, any> | null): { latitude: number | null; longitude: number | null } {
  if (!raw || typeof raw !== 'object') return { latitude: null, longitude: null };
  return {
    latitude: asFiniteNumber((raw as any).lat),
    longitude: asFiniteNumber((raw as any).lon),
  };
}

function buildAddressQuery(address: string, postalCode: string, city: string): string {
  return [address, postalCode, city].filter(Boolean).join(', ');
}

function normalizeBaseUrl(input: string, fallback: string): string {
  const candidate = normalizeText(input).replace(/\/+$/g, '');
  if (!candidate) return fallback;
  try {
    return new URL(candidate).toString().replace(/\/+$/g, '');
  } catch {
    return fallback;
  }
}

function normalizeWeatherRuntimeSettings(input: WeatherApiSettings): WeatherApiSettings {
  return {
    enabled: input.enabled !== false,
    provider: 'open-meteo',
    archiveBaseUrl: normalizeBaseUrl(input.archiveBaseUrl, 'https://archive-api.open-meteo.com'),
    forecastBaseUrl: normalizeBaseUrl(input.forecastBaseUrl, 'https://api.open-meteo.com'),
    apiKey: normalizeText(input.apiKey),
    apiKeyMode:
      input.apiKeyMode === 'header' || input.apiKeyMode === 'query'
        ? input.apiKeyMode
        : 'none',
    apiKeyHeaderName: normalizeText(input.apiKeyHeaderName) || 'X-API-Key',
    apiKeyQueryParam: normalizeText(input.apiKeyQueryParam) || 'apikey',
    timeoutMs: Number.isFinite(Number(input.timeoutMs)) ? Math.max(500, Math.min(30000, Number(input.timeoutMs))) : 5500,
    userAgent: normalizeText(input.userAgent) || NOMINATIM_USER_AGENT,
    temperatureUnit: input.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    windSpeedUnit:
      input.windSpeedUnit === 'ms' || input.windSpeedUnit === 'mph' || input.windSpeedUnit === 'kn'
        ? input.windSpeedUnit
        : 'kmh',
    precipitationUnit: input.precipitationUnit === 'inch' ? 'inch' : 'mm',
  };
}

function appendWeatherApiAuth(endpoint: URL, settings: WeatherApiSettings): void {
  if (!settings.apiKey || settings.apiKeyMode !== 'query') return;
  endpoint.searchParams.set(settings.apiKeyQueryParam, settings.apiKey);
}

function buildWeatherHeaders(settings: WeatherApiSettings): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': settings.userAgent || NOMINATIM_USER_AGENT,
  };
  if (settings.apiKey && settings.apiKeyMode === 'header') {
    headers[settings.apiKeyHeaderName] = settings.apiKey;
  }
  return headers;
}

async function fetchJson(
  url: string,
  options?: {
    timeoutMs?: number;
    headers?: Record<string, string>;
  }
): Promise<any | null> {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(Number(options?.timeoutMs)) ? Math.max(250, Number(options?.timeoutMs)) : 4500;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: options?.headers,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function reverseGeocodeWithNominatim(latitude: number, longitude: number): Promise<Record<string, any> | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const endpoint = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
    String(latitude)
  )}&lon=${encodeURIComponent(String(longitude))}&zoom=18&addressdetails=1&extratags=1&namedetails=1`;
  const payload = await fetchJson(endpoint, {
    timeoutMs: 5000,
    headers: {
      'User-Agent': NOMINATIM_USER_AGENT,
      Accept: 'application/json',
    },
  });
  return normalizeNominatimPayload(payload);
}

async function searchAddressWithNominatim(query: string): Promise<Record<string, any> | null> {
  const normalized = normalizeText(query);
  if (!normalized) return null;
  const endpoint = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(
    normalized
  )}`;
  const payload = await fetchJson(endpoint, {
    timeoutMs: 5000,
    headers: {
      'User-Agent': NOMINATIM_USER_AGENT,
      Accept: 'application/json',
    },
  });
  const first = Array.isArray(payload) ? payload[0] : null;
  return normalizeNominatimPayload(first);
}

function toNearestHourlySnapshot(
  payload: any,
  reportTimestampUtcMs: number
): {
  index: number;
  timeUtc: string;
  values: Record<string, number | null>;
  units: Record<string, string>;
} | null {
  const hourly = payload?.hourly && typeof payload.hourly === 'object' ? payload.hourly : null;
  if (!hourly) return null;
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  if (times.length === 0) return null;

  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestTimeIso = '';

  for (let index = 0; index < times.length; index += 1) {
    const candidateRaw = String(times[index] || '').trim();
    if (!candidateRaw) continue;
    const candidateIso = candidateRaw.endsWith('Z') ? candidateRaw : `${candidateRaw}Z`;
    const timestamp = Date.parse(candidateIso);
    if (!Number.isFinite(timestamp)) continue;
    const distance = Math.abs(timestamp - reportTimestampUtcMs);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
      nearestTimeIso = new Date(timestamp).toISOString();
    }
  }

  if (nearestIndex < 0 || !nearestTimeIso) return null;

  const readHourlyValue = (field: string): number | null => {
    const values = Array.isArray((hourly as any)[field]) ? (hourly as any)[field] : [];
    if (nearestIndex >= values.length) return null;
    return asFiniteNumber(values[nearestIndex]);
  };

  const unitsRaw = payload?.hourly_units && typeof payload.hourly_units === 'object' ? payload.hourly_units : {};
  const readUnit = (field: string, fallback: string): string => normalizeText((unitsRaw as any)[field]) || fallback;

  return {
    index: nearestIndex,
    timeUtc: nearestTimeIso,
    values: {
      temperature_2m: readHourlyValue('temperature_2m'),
      apparent_temperature: readHourlyValue('apparent_temperature'),
      precipitation: readHourlyValue('precipitation'),
      rain: readHourlyValue('rain'),
      showers: readHourlyValue('showers'),
      snowfall: readHourlyValue('snowfall'),
      cloud_cover: readHourlyValue('cloud_cover'),
      relative_humidity_2m: readHourlyValue('relative_humidity_2m'),
      surface_pressure: readHourlyValue('surface_pressure'),
      wind_speed_10m: readHourlyValue('wind_speed_10m'),
      wind_direction_10m: readHourlyValue('wind_direction_10m'),
      weather_code: readHourlyValue('weather_code'),
    },
    units: {
      temperature_2m: readUnit('temperature_2m', '°C'),
      apparent_temperature: readUnit('apparent_temperature', '°C'),
      precipitation: readUnit('precipitation', 'mm'),
      rain: readUnit('rain', 'mm'),
      showers: readUnit('showers', 'mm'),
      snowfall: readUnit('snowfall', 'cm'),
      cloud_cover: readUnit('cloud_cover', '%'),
      relative_humidity_2m: readUnit('relative_humidity_2m', '%'),
      surface_pressure: readUnit('surface_pressure', 'hPa'),
      wind_speed_10m: readUnit('wind_speed_10m', 'km/h'),
      wind_direction_10m: readUnit('wind_direction_10m', '°'),
      weather_code: readUnit('weather_code', 'wmo'),
    },
  };
}

function buildWeatherPayload(input: {
  source: 'archive' | 'forecast';
  provider: string;
  reportTimestamp: Date;
  latitude: number;
  longitude: number;
  snapshot: {
    timeUtc: string;
    values: Record<string, number | null>;
    units: Record<string, string>;
  };
}): Record<string, any> {
  return {
    provider: input.provider || 'open-meteo',
    source: input.source,
    requestedAt: new Date().toISOString(),
    reportTimestampUtc: input.reportTimestamp.toISOString(),
    observationTimeUtc: input.snapshot.timeUtc,
    latitude: Number(input.latitude.toFixed(6)),
    longitude: Number(input.longitude.toFixed(6)),
    units: input.snapshot.units,
    values: {
      temperatureC: input.snapshot.values.temperature_2m,
      apparentTemperatureC: input.snapshot.values.apparent_temperature,
      precipitationMm: input.snapshot.values.precipitation,
      rainMm: input.snapshot.values.rain,
      showersMm: input.snapshot.values.showers,
      snowfallCm: input.snapshot.values.snowfall,
      cloudCoverPercent: input.snapshot.values.cloud_cover,
      relativeHumidityPercent: input.snapshot.values.relative_humidity_2m,
      surfacePressureHpa: input.snapshot.values.surface_pressure,
      windSpeed10mKmh: input.snapshot.values.wind_speed_10m,
      windDirection10mDeg: input.snapshot.values.wind_direction_10m,
      weatherCode: input.snapshot.values.weather_code,
    },
  };
}

async function fetchWeatherFromArchive(
  latitude: number,
  longitude: number,
  reportTimestamp: Date,
  settings: WeatherApiSettings
): Promise<Record<string, any> | null> {
  const reportDate = toIsoDate(reportTimestamp);
  const hourlyFields = [
    'temperature_2m',
    'apparent_temperature',
    'precipitation',
    'rain',
    'showers',
    'snowfall',
    'cloud_cover',
    'relative_humidity_2m',
    'surface_pressure',
    'wind_speed_10m',
    'wind_direction_10m',
    'weather_code',
  ].join(',');
  const endpoint = new URL(`${settings.archiveBaseUrl}/v1/archive`);
  endpoint.searchParams.set('latitude', String(latitude));
  endpoint.searchParams.set('longitude', String(longitude));
  endpoint.searchParams.set('start_date', reportDate);
  endpoint.searchParams.set('end_date', reportDate);
  endpoint.searchParams.set('hourly', hourlyFields);
  endpoint.searchParams.set('timezone', 'UTC');
  endpoint.searchParams.set('temperature_unit', settings.temperatureUnit);
  endpoint.searchParams.set('wind_speed_unit', settings.windSpeedUnit);
  endpoint.searchParams.set('precipitation_unit', settings.precipitationUnit);
  appendWeatherApiAuth(endpoint, settings);

  const payload = await fetchJson(endpoint.toString(), {
    timeoutMs: settings.timeoutMs,
    headers: buildWeatherHeaders(settings),
  });
  if (!payload || typeof payload !== 'object') return null;

  const snapshot = toNearestHourlySnapshot(payload, reportTimestamp.getTime());
  if (!snapshot) return null;

  return buildWeatherPayload({
    source: 'archive',
    provider: settings.provider,
    reportTimestamp,
    latitude,
    longitude,
    snapshot: {
      timeUtc: snapshot.timeUtc,
      values: snapshot.values,
      units: snapshot.units,
    },
  });
}

async function fetchWeatherFromForecastFallback(
  latitude: number,
  longitude: number,
  reportTimestamp: Date,
  settings: WeatherApiSettings
): Promise<Record<string, any> | null> {
  const now = Date.now();
  const reportDeltaMs = Math.abs(reportTimestamp.getTime() - now);
  const maxFallbackRangeMs = 8 * 24 * 60 * 60 * 1000;
  if (reportDeltaMs > maxFallbackRangeMs) return null;

  const hourlyFields = [
    'temperature_2m',
    'apparent_temperature',
    'precipitation',
    'rain',
    'showers',
    'snowfall',
    'cloud_cover',
    'relative_humidity_2m',
    'surface_pressure',
    'wind_speed_10m',
    'wind_direction_10m',
    'weather_code',
  ].join(',');
  const endpoint = new URL(`${settings.forecastBaseUrl}/v1/forecast`);
  endpoint.searchParams.set('latitude', String(latitude));
  endpoint.searchParams.set('longitude', String(longitude));
  endpoint.searchParams.set('hourly', hourlyFields);
  endpoint.searchParams.set('timezone', 'UTC');
  endpoint.searchParams.set('past_days', '7');
  endpoint.searchParams.set('forecast_days', '2');
  endpoint.searchParams.set('temperature_unit', settings.temperatureUnit);
  endpoint.searchParams.set('wind_speed_unit', settings.windSpeedUnit);
  endpoint.searchParams.set('precipitation_unit', settings.precipitationUnit);
  appendWeatherApiAuth(endpoint, settings);

  const payload = await fetchJson(endpoint.toString(), {
    timeoutMs: settings.timeoutMs,
    headers: buildWeatherHeaders(settings),
  });
  if (!payload || typeof payload !== 'object') return null;

  const snapshot = toNearestHourlySnapshot(payload, reportTimestamp.getTime());
  if (!snapshot) return null;

  const matchedTimestampMs = Date.parse(snapshot.timeUtc);
  if (!Number.isFinite(matchedTimestampMs)) return null;
  if (Math.abs(matchedTimestampMs - reportTimestamp.getTime()) > 48 * 60 * 60 * 1000) return null;

  return buildWeatherPayload({
    source: 'forecast',
    provider: settings.provider,
    reportTimestamp,
    latitude,
    longitude,
    snapshot: {
      timeUtc: snapshot.timeUtc,
      values: snapshot.values,
      units: snapshot.units,
    },
  });
}

export async function enrichGeoAndWeather(input: GeoWeatherEnrichmentInput): Promise<GeoWeatherEnrichmentResult> {
  let latitude = asFiniteNumber(input.latitude);
  let longitude = asFiniteNumber(input.longitude);
  let address = normalizeText(input.address);
  let postalCode = normalizeText(input.postalCode);
  let city = normalizeText(input.city);
  const reportedAt = parseTimestamp(input.reportedAt);

  let nominatimRaw: Record<string, any> | null = null;
  let nominatimSource: NominatimSource = 'none';

  if (latitude !== null && longitude !== null) {
    nominatimRaw = await reverseGeocodeWithNominatim(latitude, longitude);
    if (nominatimRaw) {
      nominatimSource = 'reverse';
    }
  }

  if (!nominatimRaw) {
    const query = buildAddressQuery(address, postalCode, city);
    if (query) {
      nominatimRaw = await searchAddressWithNominatim(query);
      if (nominatimRaw) {
        nominatimSource = 'search';
      }
    }
  }

  if (nominatimRaw) {
    const nominatimCoordinates = resolveNominatimCoordinates(nominatimRaw);
    if (latitude === null && nominatimCoordinates.latitude !== null) {
      latitude = nominatimCoordinates.latitude;
    }
    if (longitude === null && nominatimCoordinates.longitude !== null) {
      longitude = nominatimCoordinates.longitude;
    }
    if (!address) {
      address = normalizeText(nominatimRaw.display_name);
    }
    if (!postalCode) {
      postalCode = resolveNominatimPostalCode(nominatimRaw);
    }
    if (!city) {
      city = resolveNominatimCity(nominatimRaw);
    }
  }

  let weatherReport: Record<string, any> | null = null;
  let weatherSource: WeatherSource = 'none';
  if (latitude !== null && longitude !== null) {
    try {
      const { values: weatherSettingsRaw } = await loadWeatherApiSettings(false);
      const weatherSettings = normalizeWeatherRuntimeSettings(weatherSettingsRaw);
      if (weatherSettings.enabled !== false) {
        weatherReport = await fetchWeatherFromArchive(latitude, longitude, reportedAt, weatherSettings);
        if (weatherReport) {
          weatherSource = 'open-meteo-archive';
        } else {
          weatherReport = await fetchWeatherFromForecastFallback(latitude, longitude, reportedAt, weatherSettings);
          if (weatherReport) {
            weatherSource = 'open-meteo-forecast';
          }
        }
      }
    } catch {
      weatherReport = null;
      weatherSource = 'none';
    }
  }

  return {
    latitude,
    longitude,
    address: address || null,
    postalCode: postalCode || null,
    city: city || null,
    nominatimRaw,
    nominatimSource,
    weatherReport,
    weatherSource,
  };
}
