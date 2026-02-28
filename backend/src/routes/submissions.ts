/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Citizen Submissions API
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database.js';
import { sanitizeText } from '../services/classification.js';
import { queueSubmissionDescriptionTranslation } from '../services/ai.js';
import { enrichGeoAndWeather } from '../services/geo-enrichment.js';
import {
  loadGeneralSettings,
  normalizeJurisdictionGeofence,
  resolveCitizenFrontendProfile,
} from '../services/settings.js';
import { publishTicketUpdate } from '../services/realtime.js';
import { attachWorkflowToTicket } from './workflows.js';
import { normalizeCitizenEmail, resolveCitizenSessionFromRequest } from '../services/citizen-auth.js';
import { sendNewTicketEmailNotifications } from '../services/ticket-notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXECUTIONS_FILE = resolve(__dirname, '..', '..', 'knowledge', 'executions.json');
const router = express.Router();
const OUTSIDE_JURISDICTION_MESSAGE = 'Ihr Anliegen betrifft nicht unser Zuständigkeitsgebiet';
const MAX_IMAGES = 5;
const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_STORED_IMAGE_BYTES = 1 * 1024 * 1024;
const IMAGE_FILE_NAME_PATTERN = /\.(avif|bmp|gif|heic|heif|jpeg|jpg|png|tif|tiff|webp)$/i;
const IMAGE_UPLOAD_FALLBACK_CODES = new Set([
  'LIMIT_FILE_SIZE',
  'LIMIT_FILE_COUNT',
  'LIMIT_UNEXPECTED_FILE',
  'LIMIT_PART_COUNT',
  'LIMIT_FIELD_KEY',
  'LIMIT_FIELD_VALUE',
  'LIMIT_FIELD_COUNT',
]);
const IMAGE_MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
    files: MAX_IMAGES,
  },
});

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isGermanLanguageCode(value: unknown): boolean {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'de' || normalized.startsWith('de-');
}

function buildLocationBlob(values: Array<unknown>): string {
  return values
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeUploadFileName(name: string, fallback = 'upload'): string {
  const normalized = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function withWebpFileName(fileName: string): string {
  const safe = sanitizeUploadFileName(fileName, 'upload');
  const withoutExt = safe.replace(/\.[a-zA-Z0-9]+$/g, '');
  return `${withoutExt || 'upload'}.webp`;
}

function withMimeFileName(fileName: string, mimeType?: string): string {
  const safe = sanitizeUploadFileName(fileName, 'upload');
  const withoutExt = safe.replace(/\.[a-zA-Z0-9]+$/g, '') || 'upload';
  const extension = IMAGE_MIME_EXTENSION_MAP[String(mimeType || '').trim().toLowerCase()] || null;
  if (!extension) return safe;
  return `${withoutExt}.${extension}`;
}

function readFourCC(buffer: Buffer, offset: number): string {
  if (!buffer || offset < 0 || offset + 4 > buffer.length) return '';
  return buffer.subarray(offset, offset + 4).toString('ascii');
}

function detectImageMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 4) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 6 && buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buffer.length >= 12 && readFourCC(buffer, 0) === 'RIFF' && readFourCC(buffer, 8) === 'WEBP') return 'image/webp';
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return 'image/tiff';
  }
  if (buffer.length >= 12 && readFourCC(buffer, 4) === 'ftyp') {
    const brands = [
      readFourCC(buffer, 8).toLowerCase(),
      readFourCC(buffer, 16).toLowerCase(),
      readFourCC(buffer, 20).toLowerCase(),
      readFourCC(buffer, 24).toLowerCase(),
    ].filter(Boolean);
    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'image/avif';
    if (brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'].includes(brand))) {
      return 'image/heic';
    }
  }
  return null;
}

function parseLegacyImagesInput(raw: unknown): Array<{ dataUrl: string; fileName: string | undefined }> {
  if (!raw) return [];
  const source =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return [];
          }
        })()
      : raw;
  if (!Array.isArray(source)) return [];
  return source
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const candidate = entry as Record<string, any>;
      if (typeof candidate.dataUrl !== 'string' || !candidate.dataUrl.trim()) return null;
      return {
        dataUrl: candidate.dataUrl,
        fileName: typeof candidate.fileName === 'string' ? candidate.fileName : undefined,
      };
    })
    .filter((entry): entry is { dataUrl: string; fileName: string | undefined } => entry !== null);
}

function decodeDataUrlImage(input: { dataUrl: string; fileName?: string }): {
  fileName: string;
  mimeType: string;
  data: Buffer;
} | null {
  const raw = String(input.dataUrl || '').trim();
  if (!raw) return null;
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  const mimeType = match?.[1] || 'image/jpeg';
  const base64 = match?.[2] || raw;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
  if (!buffer.length || buffer.length > MAX_IMAGE_UPLOAD_BYTES) return null;
  if (!/^image\//i.test(mimeType)) return null;
  return {
    fileName: sanitizeUploadFileName(input.fileName || 'upload'),
    mimeType,
    data: buffer,
  };
}

async function compressImageToMaxBytes(sourceBuffer: Buffer): Promise<Buffer | null> {
  let metadata: sharp.Metadata | null = null;
  try {
    metadata = await sharp(sourceBuffer, { failOn: 'none' }).metadata();
  } catch {
    metadata = null;
  }

  const baseWidth = Number.isFinite(metadata?.width) ? Number(metadata!.width) : null;
  const baseHeight = Number.isFinite(metadata?.height) ? Number(metadata!.height) : null;
  const scales = [1, 0.88, 0.76, 0.64, 0.52];
  const qualities = [84, 78, 72, 66, 60, 54, 48, 42, 36];
  let best: Buffer | null = null;

  for (const scale of scales) {
    const targetWidth =
      baseWidth && baseHeight
        ? Math.max(320, Math.floor(baseWidth * scale))
        : undefined;
    const targetHeight =
      baseWidth && baseHeight
        ? Math.max(320, Math.floor(baseHeight * scale))
        : undefined;

    for (const quality of qualities) {
      try {
        const candidate = await sharp(sourceBuffer, { failOn: 'none' })
          .rotate()
          .resize(targetWidth, targetHeight, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality, effort: 4 })
          .toBuffer();

        if (!best || candidate.length < best.length) {
          best = candidate;
        }
        if (candidate.length <= MAX_STORED_IMAGE_BYTES) {
          return candidate;
        }
      } catch {
        // Try next combination.
      }
    }
  }

  if (best && best.length <= MAX_STORED_IMAGE_BYTES) return best;
  return null;
}

function parseSubmissionUploadFiles(
  req: Request
): Array<{ fileName: string; data: Buffer; isImage: boolean }> {
  const files = Array.isArray((req as any).files) ? ((req as any).files as any[]) : [];
  return files
    .map((file) => {
      const buffer = file?.buffer instanceof Buffer ? file.buffer : null;
      const mimeType = typeof file?.mimetype === 'string' ? file.mimetype.trim().toLowerCase() : '';
      const originalName = typeof file?.originalname === 'string' ? file.originalname : 'upload';
      const hasImageMime = /^image\//i.test(mimeType);
      const hasImageFileName = IMAGE_FILE_NAME_PATTERN.test(originalName);
      const sniffedMime = buffer ? detectImageMimeTypeFromBuffer(buffer) : null;
      if (!buffer || !buffer.length) return null;
      if (buffer.length > MAX_IMAGE_UPLOAD_BYTES) return null;
      const isImage = hasImageMime || hasImageFileName || !!sniffedMime;
      const normalizedName = isImage
        ? hasImageFileName
          ? sanitizeUploadFileName(originalName, 'upload')
          : withMimeFileName(originalName, sniffedMime || mimeType || undefined)
        : sanitizeUploadFileName(originalName, 'upload.bin');
      return {
        fileName: normalizedName,
        data: buffer,
        isImage,
      };
    })
    .filter((entry): entry is { fileName: string; data: Buffer; isImage: boolean } => entry !== null);
}

function normalizeImageBuffer(value: any): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    try {
      return Buffer.from(value, 'base64');
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    try {
      return Buffer.from(value);
    } catch {
      return null;
    }
  }
  if (value?.type === 'Buffer' && Array.isArray(value?.data)) {
    try {
      return Buffer.from(value.data);
    } catch {
      return null;
    }
  }
  return null;
}

const NON_IMAGE_EXTENSION_MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.gz': 'application/gzip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

function guessStoredFileMimeType(fileName?: string, buffer?: Buffer | null): string {
  const lowered = String(fileName || '').toLowerCase();
  if (lowered.endsWith('.png')) return 'image/png';
  if (lowered.endsWith('.gif')) return 'image/gif';
  if (lowered.endsWith('.webp')) return 'image/webp';
  if (lowered.endsWith('.bmp')) return 'image/bmp';
  if (lowered.endsWith('.svg')) return 'image/svg+xml';
  if (lowered.endsWith('.avif')) return 'image/avif';
  if (lowered.endsWith('.heic')) return 'image/heic';
  if (lowered.endsWith('.heif')) return 'image/heif';
  if (lowered.endsWith('.tif') || lowered.endsWith('.tiff')) return 'image/tiff';
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) return 'image/jpeg';
  for (const [extension, mimeType] of Object.entries(NON_IMAGE_EXTENSION_MIME_MAP)) {
    if (lowered.endsWith(extension)) return mimeType;
  }
  if (!buffer || buffer.length < 4) return 'application/octet-stream';

  const signature = buffer.subarray(0, 4).toString('hex');
  if (signature === '89504e47') return 'image/png';
  if (signature.startsWith('ffd8ff')) return 'image/jpeg';
  if (signature === '47494638') return 'image/gif';
  if (signature === '52494646') return 'image/webp';
  if (signature === '25504446') return 'application/pdf';
  if (signature === '504b0304') return 'application/zip';
  const detected = detectImageMimeTypeFromBuffer(buffer);
  if (detected) return detected;
  return 'application/octet-stream';
}

interface ExifGpsCoordinates {
  latitude: number;
  longitude: number;
}

interface UploadImageExifSummary {
  hasExif: boolean;
  hasGps: boolean;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  orientation: number | null;
}

interface ExifIfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
  valueFieldOffset: number;
}

const EXIF_TYPE_BYTE_LENGTH: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

function exifIsWithinBounds(view: DataView, offset: number, size: number): boolean {
  return offset >= 0 && size >= 0 && offset + size <= view.byteLength;
}

function exifReadUint16(view: DataView, offset: number, littleEndian: boolean): number | null {
  if (!exifIsWithinBounds(view, offset, 2)) return null;
  return view.getUint16(offset, littleEndian);
}

function exifReadUint32(view: DataView, offset: number, littleEndian: boolean): number | null {
  if (!exifIsWithinBounds(view, offset, 4)) return null;
  return view.getUint32(offset, littleEndian);
}

function parseExifIfdEntries(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  littleEndian: boolean
): ExifIfdEntry[] {
  if (!exifIsWithinBounds(view, ifdOffset, 2)) return [];
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  const entriesStart = ifdOffset + 2;
  const entries: ExifIfdEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = entriesStart + index * 12;
    if (!exifIsWithinBounds(view, entryOffset, 12)) break;

    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffset = view.getUint32(entryOffset + 8, littleEndian);
    const typeLength = EXIF_TYPE_BYTE_LENGTH[type];
    if (!typeLength) continue;

    const totalLength = typeLength * count;
    if (totalLength > 4) {
      const absoluteOffset = tiffStart + valueOffset;
      if (!exifIsWithinBounds(view, absoluteOffset, totalLength)) continue;
    }

    entries.push({
      tag,
      type,
      count,
      valueOffset,
      valueFieldOffset: entryOffset + 8,
    });
  }

  return entries;
}

function getExifEntryBytes(view: DataView, tiffStart: number, entry: ExifIfdEntry): Uint8Array | null {
  const typeLength = EXIF_TYPE_BYTE_LENGTH[entry.type];
  if (!typeLength) return null;
  const totalLength = typeLength * entry.count;
  if (totalLength <= 0) return null;

  if (totalLength <= 4) {
    if (!exifIsWithinBounds(view, entry.valueFieldOffset, totalLength)) return null;
    return new Uint8Array(view.buffer, view.byteOffset + entry.valueFieldOffset, totalLength);
  }

  const absoluteOffset = tiffStart + entry.valueOffset;
  if (!exifIsWithinBounds(view, absoluteOffset, totalLength)) return null;
  return new Uint8Array(view.buffer, view.byteOffset + absoluteOffset, totalLength);
}

function getExifAsciiValue(view: DataView, tiffStart: number, entry?: ExifIfdEntry): string | null {
  if (!entry) return null;
  const bytes = getExifEntryBytes(view, tiffStart, entry);
  if (!bytes || bytes.length === 0) return null;
  const chars: string[] = [];
  for (const value of bytes) {
    if (value === 0) break;
    chars.push(String.fromCharCode(value));
  }
  const text = chars.join('').trim();
  return text || null;
}

function getExifUnsignedIntValue(
  view: DataView,
  tiffStart: number,
  littleEndian: boolean,
  entry?: ExifIfdEntry
): number | null {
  if (!entry) return null;
  const bytes = getExifEntryBytes(view, tiffStart, entry);
  if (!bytes || bytes.length === 0) return null;
  const bytesView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (entry.type === 3) {
    if (bytesView.byteLength < 2) return null;
    return bytesView.getUint16(0, littleEndian);
  }
  if (entry.type === 4) {
    if (bytesView.byteLength < 4) return null;
    return bytesView.getUint32(0, littleEndian);
  }
  return null;
}

function getExifRationalValues(
  view: DataView,
  tiffStart: number,
  littleEndian: boolean,
  entry?: ExifIfdEntry
): number[] | null {
  if (!entry || entry.count <= 0) return null;
  if (entry.type !== 5 && entry.type !== 10) return null;
  const bytes = getExifEntryBytes(view, tiffStart, entry);
  if (!bytes) return null;
  const bytesView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values: number[] = [];

  for (let index = 0; index < entry.count; index += 1) {
    const offset = index * 8;
    if (offset + 8 > bytesView.byteLength) return null;
    const numerator =
      entry.type === 10 ? bytesView.getInt32(offset, littleEndian) : bytesView.getUint32(offset, littleEndian);
    const denominator =
      entry.type === 10
        ? bytesView.getInt32(offset + 4, littleEndian)
        : bytesView.getUint32(offset + 4, littleEndian);
    if (denominator === 0) return null;
    values.push(numerator / denominator);
  }

  return values;
}

function toExifDecimalDegrees(values: number[], reference: string | null, isLatitude: boolean): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const degrees = values[0] || 0;
  const minutes = values[1] || 0;
  const seconds = values[2] || 0;
  if (![degrees, minutes, seconds].every((value) => Number.isFinite(value))) return null;

  let sign = 1;
  const normalizedRef = (reference || '').trim().toUpperCase();
  if (normalizedRef === 'S' || normalizedRef === 'W') sign = -1;
  if (normalizedRef === 'N' || normalizedRef === 'E') sign = 1;
  if (!normalizedRef && degrees < 0) sign = -1;

  const absoluteDegrees = Math.abs(degrees);
  const decimal = sign * (absoluteDegrees + Math.abs(minutes) / 60 + Math.abs(seconds) / 3600);
  const maxValue = isLatitude ? 90 : 180;
  if (!Number.isFinite(decimal) || Math.abs(decimal) > maxValue) return null;
  return decimal;
}

function parseGpsFromExifTiffAt(view: DataView, tiffStart: number): ExifGpsCoordinates | null {
  if (!exifIsWithinBounds(view, tiffStart, 8)) return null;

  const byteOrder = view.getUint16(tiffStart, false);
  const littleEndian = byteOrder === 0x4949 ? true : byteOrder === 0x4d4d ? false : null;
  if (littleEndian === null) return null;

  const magic = exifReadUint16(view, tiffStart + 2, littleEndian);
  if (magic !== 42) return null;

  const firstIfdRelative = exifReadUint32(view, tiffStart + 4, littleEndian);
  if (firstIfdRelative === null) return null;
  const firstIfdOffset = tiffStart + firstIfdRelative;
  if (!exifIsWithinBounds(view, firstIfdOffset, 2)) return null;

  const ifd0Entries = parseExifIfdEntries(view, tiffStart, firstIfdOffset, littleEndian);
  const gpsPointerEntry = ifd0Entries.find((entry) => entry.tag === 0x8825);
  const gpsIfdRelative = getExifUnsignedIntValue(view, tiffStart, littleEndian, gpsPointerEntry);
  if (gpsIfdRelative === null) return null;

  const gpsIfdOffset = tiffStart + gpsIfdRelative;
  if (!exifIsWithinBounds(view, gpsIfdOffset, 2)) return null;
  const gpsEntries = parseExifIfdEntries(view, tiffStart, gpsIfdOffset, littleEndian);

  const latitudeRef = getExifAsciiValue(
    view,
    tiffStart,
    gpsEntries.find((entry) => entry.tag === 0x0001)
  );
  const latitudeValues = getExifRationalValues(
    view,
    tiffStart,
    littleEndian,
    gpsEntries.find((entry) => entry.tag === 0x0002)
  );
  const longitudeRef = getExifAsciiValue(
    view,
    tiffStart,
    gpsEntries.find((entry) => entry.tag === 0x0003)
  );
  const longitudeValues = getExifRationalValues(
    view,
    tiffStart,
    littleEndian,
    gpsEntries.find((entry) => entry.tag === 0x0004)
  );

  if (!latitudeValues || !longitudeValues) return null;

  const latitude = toExifDecimalDegrees(latitudeValues, latitudeRef, true);
  const longitude = toExifDecimalDegrees(longitudeValues, longitudeRef, false);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

function parseGpsFromExifBuffer(buffer?: Buffer | null): ExifGpsCoordinates | null {
  if (!buffer || buffer.length < 8) return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let tiffStart = 0;
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x45 && // E
    buffer[1] === 0x78 && // x
    buffer[2] === 0x69 && // i
    buffer[3] === 0x66 && // f
    buffer[4] === 0x00 &&
    buffer[5] === 0x00
  ) {
    tiffStart = 6;
  }

  return parseGpsFromExifTiffAt(view, tiffStart);
}

async function extractUploadImageExifSummary(sourceBuffer: Buffer): Promise<UploadImageExifSummary | null> {
  try {
    const metadata = await sharp(sourceBuffer, { failOn: 'none' }).metadata();
    const exifBuffer = metadata.exif instanceof Buffer ? metadata.exif : null;
    const gps = parseGpsFromExifBuffer(exifBuffer);

    return {
      hasExif: !!(exifBuffer && exifBuffer.length > 0),
      hasGps: !!gps,
      gpsLatitude: gps ? Number(gps.latitude.toFixed(6)) : null,
      gpsLongitude: gps ? Number(gps.longitude.toFixed(6)) : null,
      width: Number.isFinite(metadata.width) ? Number(metadata.width) : null,
      height: Number.isFinite(metadata.height) ? Number(metadata.height) : null,
      format: typeof metadata.format === 'string' ? metadata.format : null,
      orientation: Number.isFinite(metadata.orientation) ? Number(metadata.orientation) : null,
    };
  } catch {
    return null;
  }
}

async function findTicketByStatusToken(db: any, token: string): Promise<any | null> {
  let ticket = await db.get(
    `SELECT t.*,
            s.original_description as submission_original_description,
            s.anonymized_text as submission_anonymized_text,
            s.address as submission_address,
            s.postal_code as submission_postal_code,
            s.city as submission_city,
            s.created_at as submission_created_at,
            c.name as citizen_name,
            c.email as citizen_email
     FROM tickets t
     LEFT JOIN submissions s ON s.id = t.submission_id
     LEFT JOIN citizens c ON c.id = t.citizen_id
     WHERE t.validation_token = ?`,
    [token]
  );

  if (ticket) return ticket;

  ticket = await db.get(
    `SELECT t.*,
            s.original_description as submission_original_description,
            s.anonymized_text as submission_anonymized_text,
            s.address as submission_address,
            s.postal_code as submission_postal_code,
            s.city as submission_city,
            s.created_at as submission_created_at,
            c.name as citizen_name,
            c.email as citizen_email
     FROM ticket_validations v
     JOIN tickets t ON t.id = v.ticket_id
     LEFT JOIN submissions s ON s.id = t.submission_id
     LEFT JOIN citizens c ON c.id = t.citizen_id
     WHERE v.validation_token = ?
     ORDER BY v.created_at DESC
     LIMIT 1`,
    [token]
  );
  return ticket || null;
}

interface WorkflowExecutionSummary {
  id: string;
  title: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  tasks: Array<{ id: string; title: string; type: string; status: string; order: number }>;
}

function parseTimestamp(input?: string): number {
  if (!input) return 0;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function loadLatestWorkflowSummary(ticketId: string): WorkflowExecutionSummary | null {
  try {
    const raw = readFileSync(EXECUTIONS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const executions = Array.isArray(parsed) ? parsed : [];
    const candidates = executions
      .filter((entry: any) => String(entry?.ticketId || '') === ticketId)
      .sort((a: any, b: any) => parseTimestamp(b?.startedAt) - parseTimestamp(a?.startedAt));
    const latest = candidates[0];
    if (!latest) return null;
    const tasks = Array.isArray(latest.tasks) ? latest.tasks : [];
    return {
      id: String(latest.id || ''),
      title: String(latest.title || ''),
      status: String(latest.status || ''),
      startedAt: typeof latest.startedAt === 'string' ? latest.startedAt : undefined,
      completedAt: typeof latest.completedAt === 'string' ? latest.completedAt : undefined,
      tasks: tasks
        .map((task: any) => ({
          id: String(task?.id || ''),
          title: String(task?.title || ''),
          type: String(task?.type || ''),
          status: String(task?.status || ''),
          order: Number.isFinite(Number(task?.order)) ? Number(task.order) : 0,
        }))
        .sort((a, b) => a.order - b.order),
    };
  } catch {
    return null;
  }
}

function hasValidCoordinate(value: unknown): boolean {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num);
}

function haversineDistanceMeters(latA: number, lonA: number, latB: number, lonB: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const deltaLat = toRad(latB - latA);
  const deltaLon = toRad(lonB - lonA);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function isPointInPolygon(lat: number, lon: number, points: Array<{ lat: number; lon: number }>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const yi = points[i].lat;
    const xi = points[i].lon;
    const yj = points[j].lat;
    const xj = points[j].lon;
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function matchesJurisdictionGeofence(
  latitude: number | null,
  longitude: number | null,
  geofenceInput: unknown
): boolean | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const geofence = normalizeJurisdictionGeofence(geofenceInput);
  if (!geofence.enabled) return null;

  if (geofence.shape === 'polygon') {
    const points = Array.isArray(geofence.points) ? geofence.points : [];
    if (points.length < 3) return null;
    return isPointInPolygon(Number(latitude), Number(longitude), points);
  }

  if (!Number.isFinite(geofence.centerLat) || !Number.isFinite(geofence.centerLon)) {
    return null;
  }
  const radius = Number.isFinite(geofence.radiusMeters) ? Math.max(1, Number(geofence.radiusMeters)) : 5000;
  const distance = haversineDistanceMeters(
    Number(latitude),
    Number(longitude),
    Number(geofence.centerLat),
    Number(geofence.centerLon)
  );
  return distance <= radius;
}

interface PersistGeoWeatherInput {
  ticketId: string;
  submissionId: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
  postalCode: string;
  city: string;
  reportedAt: string;
}

async function persistSubmissionGeoWeatherEnrichment(input: PersistGeoWeatherInput): Promise<void> {
  const db = getDatabase();
  const enriched = await enrichGeoAndWeather({
    latitude: input.latitude,
    longitude: input.longitude,
    address: input.address,
    postalCode: input.postalCode,
    city: input.city,
    reportedAt: input.reportedAt,
  });

  const latitude = enriched.latitude !== null ? Number(enriched.latitude) : null;
  const longitude = enriched.longitude !== null ? Number(enriched.longitude) : null;
  const address = normalizeString(enriched.address) || normalizeString(input.address) || null;
  const postalCode = normalizeString(enriched.postalCode) || normalizeString(input.postalCode) || null;
  const city = normalizeString(enriched.city) || normalizeString(input.city) || null;
  const nominatimRawJson = enriched.nominatimRaw ? JSON.stringify(enriched.nominatimRaw) : null;
  const weatherReportJson = enriched.weatherReport ? JSON.stringify(enriched.weatherReport) : null;

  await db.run(
    `UPDATE tickets
     SET latitude = ?, longitude = ?, address = ?, postal_code = ?, city = ?, nominatim_raw_json = ?, weather_report_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [latitude, longitude, address, postalCode, city, nominatimRawJson, weatherReportJson, input.ticketId]
  );
  await db.run(
    `UPDATE submissions
     SET latitude = ?, longitude = ?, address = ?, postal_code = ?, city = ?, nominatim_raw_json = ?, weather_report_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [latitude, longitude, address, postalCode, city, nominatimRawJson, weatherReportJson, input.submissionId]
  );
}

/**
 * POST /api/submissions
 * Neue Bürgermeldung einreichen mit Standortdaten
 * 
 * Body:
 * {
 *   name: "Max Mustermann",
 *   email: "max@example.com",
 *   issueType: "Schlaglöcher",
 *   description: "Es gibt ein großes Schlagloch in der Hauptstraße",
 *   imageBase64: "data:image/png;base64,...",  (optional, legacy single)
 *   images: [{ dataUrl: "data:image/png;base64,...", fileName: "foto.png" }], (optional, multiple)
 *   latitude: 50.1234,
 *   longitude: 7.5678,
 *   address: "Hauptstraße 42",
 *   postalCode: "67697",
 *   city: "Otterbach"
 * }
 */
router.post('/', (req: Request, res: Response) => {
  upload.array('images', MAX_IMAGES)(req, res, async (uploadError: any) => {
    let imageUploadFallbackUsed = false;
    let imageUploadFallbackCode = '';
    if (uploadError) {
      const uploadErrorCode = String(uploadError?.code || '').trim().toUpperCase();
      const shouldFallbackWithoutImages =
        IMAGE_UPLOAD_FALLBACK_CODES.has(uploadErrorCode) || uploadErrorCode.startsWith('LIMIT_');
      if (shouldFallbackWithoutImages) {
        imageUploadFallbackUsed = true;
        imageUploadFallbackCode = uploadErrorCode;
        (req as any).files = [];
        console.warn(
          `Submission image upload failed (${uploadErrorCode}). Continuing intake without images for this request.`
        );
      } else {
        return res.status(400).json({
          code: 'UPLOAD_FAILED',
          message: uploadError?.message || 'Fehler beim Bild-Upload',
        });
      }
    }

    try {
      const { values: general } = await loadGeneralSettings();
      if (general.maintenanceMode) {
        return res.status(503).json({
          message:
            general.maintenanceMessage ||
            'Das Meldungsformular ist aktuell wegen Wartung nicht verfügbar.',
        });
      }

      const name = normalizeString(req.body?.name);
      let email = normalizeString(req.body?.email);
      const issueType = normalizeString(req.body?.issueType);
      const description = normalizeString(req.body?.description);
      const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : '';
      const images = req.body?.images;
      const latitudeRaw = req.body?.latitude;
      const longitudeRaw = req.body?.longitude;
      const address = req.body?.address;
      const postalCode = req.body?.postalCode;
      const city = req.body?.city;
      const language = req.body?.language;
      const languageName = req.body?.languageName;
      const frontendToken = req.body?.frontendToken;
      const citizenSession = await resolveCitizenSessionFromRequest(req);
      const requestedFrontendToken = normalizeString(frontendToken);
      const effectiveFrontendToken = requestedFrontendToken || citizenSession?.frontendProfileToken || '';
      const resolvedFrontendProfile = resolveCitizenFrontendProfile(general, effectiveFrontendToken);

      if (!email && citizenSession?.emailOriginal) {
        email = normalizeString(citizenSession.emailOriginal);
      }
      const normalizedCitizenEmail = normalizeCitizenEmail(email);

      const normalizedAddress = normalizeString(address);
      const normalizedPostalCode = normalizeString(postalCode);
      const normalizedCity = normalizeString(city);
      const latitude = asOptionalNumber(latitudeRaw);
      const longitude = asOptionalNumber(longitudeRaw);
      const reportedAt = new Date().toISOString();
      const locationBlob = buildLocationBlob([normalizedAddress, normalizedPostalCode, normalizedCity]);
      const hasCoordinateInput = hasValidCoordinate(latitude) && hasValidCoordinate(longitude);
      const hasLocationInput = locationBlob.length > 0 || hasCoordinateInput;

      const geofenceMatch = matchesJurisdictionGeofence(
        hasValidCoordinate(latitude) ? Number(latitude) : null,
        hasValidCoordinate(longitude) ? Number(longitude) : null,
        general.jurisdictionGeofence
      );
      const restrictLocations = !!general.restrictLocations;
      const allowedLocations = Array.isArray(general.allowedLocations)
        ? general.allowedLocations.filter((loc) => typeof loc === 'string' && loc.trim().length > 0)
        : [];
      const matchesAllowedLocations =
        allowedLocations.length > 0 &&
        allowedLocations.some((loc) => locationBlob.includes(loc.toLowerCase()));

      if (restrictLocations && hasLocationInput) {
        const allowByGeofence = geofenceMatch === true;
        const allowByTextFallback = geofenceMatch === null ? matchesAllowedLocations : false;
        if (!allowByGeofence && !allowByTextFallback) {
          return res.status(400).json({
            code: 'OUTSIDE_JURISDICTION',
            message: OUTSIDE_JURISDICTION_MESSAGE,
          });
        }
      }

      if (!name || !email || !description) {
        return res.status(400).json({
          message: 'Fehler: Name, Email und Beschreibung sind erforderlich',
        });
      }

      if (!description.trim() || description.length < 10) {
        return res.status(400).json({
          message: 'Fehler: Beschreibung muss mindestens 10 Zeichen lang sein',
        });
      }

      const configuredLanguages = Array.isArray(general.languages) ? general.languages : [];
      const requestedLanguage = normalizeString(language).toLowerCase();
      const defaultLanguageCode = normalizeString(general.defaultLanguage || 'de').toLowerCase() || 'de';
      const selectedLanguageCode = requestedLanguage || defaultLanguageCode;
      const selectedLanguageConfig = configuredLanguages.find(
        (entry) => normalizeString(entry.code).toLowerCase() === selectedLanguageCode
      );
      const selectedLanguageName =
        normalizeString(languageName) ||
        normalizeString(selectedLanguageConfig?.aiName) ||
        normalizeString(selectedLanguageConfig?.label) ||
        selectedLanguageCode;

      const uploadImages = imageUploadFallbackUsed ? [] : parseSubmissionUploadFiles(req);
      const legacyImages = imageUploadFallbackUsed ? [] : parseLegacyImagesInput(images);
      if (imageBase64 && !imageUploadFallbackUsed) {
        legacyImages.unshift({ dataUrl: imageBase64, fileName: 'upload' });
      }

      const decodedLegacyImages = legacyImages
        .map((entry) => decodeDataUrlImage(entry))
        .filter((entry): entry is { fileName: string; mimeType: string; data: Buffer } => entry !== null);

      const incomingImages = [...uploadImages, ...decodedLegacyImages.map((entry) => ({ ...entry, isImage: true }))]
        .slice(0, MAX_IMAGES);

      const storedFiles: Array<{
        fileName: string;
        data: Buffer;
        exifSummary: UploadImageExifSummary | null;
        isImage: boolean;
      }> = [];
      const nonImageFileNames: string[] = [];
      for (const incoming of incomingImages) {
        if (incoming.isImage) {
          const exifSummary = await extractUploadImageExifSummary(incoming.data);
          const compressed = await compressImageToMaxBytes(incoming.data);
          if (!compressed) continue;
          storedFiles.push({
            fileName: withWebpFileName(incoming.fileName),
            data: compressed,
            exifSummary,
            isImage: true,
          });
          continue;
        }

        const safeFileName = sanitizeUploadFileName(incoming.fileName, 'upload.bin');
        storedFiles.push({
          fileName: safeFileName,
          data: incoming.data,
          exifSummary: null,
          isImage: false,
        });
        nonImageFileNames.push(safeFileName);
      }

      const primaryImage = storedFiles.find((entry) => entry.isImage) || null;
      const db = getDatabase();
      const configuredTenantId = normalizeString(resolvedFrontendProfile.tenantId);
      let effectiveTenantId = configuredTenantId || 'tenant_default';
      if (effectiveTenantId) {
        const tenantRow = await db.get(`SELECT id FROM tenants WHERE id = ?`, [effectiveTenantId]);
        if (!tenantRow?.id) {
          effectiveTenantId = 'tenant_default';
        }
      }

      const existingCitizen = await db.get(
        `SELECT id
         FROM citizens
         WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))
         LIMIT 1`,
        [email]
      );
      const citizenId = existingCitizen?.id || uuidv4();

      if (!existingCitizen) {
        await db.run(
          `INSERT INTO citizens (id, email, name, preferred_language, preferred_language_name, image_path, image_data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            citizenId,
            email,
            name,
            selectedLanguageCode,
            selectedLanguageName,
            primaryImage ? `images/${citizenId}.webp` : null,
            primaryImage ? primaryImage.data : null,
          ]
        );
      } else if (primaryImage) {
        await db.run(
          `UPDATE citizens
           SET image_data = ?, name = ?, preferred_language = ?, preferred_language_name = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [primaryImage.data, name, selectedLanguageCode, selectedLanguageName, citizenId]
        );
      } else {
        await db.run(
          `UPDATE citizens
           SET name = ?, preferred_language = ?, preferred_language_name = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [name, selectedLanguageCode, selectedLanguageName, citizenId]
        );
      }

      const submissionId = uuidv4();
      const anonymizedText = sanitizeText(description);
      const initialCategory = issueType ? issueType : 'Sonstiges';

      await db.run(
        `INSERT INTO submissions (
          id, citizen_id, anonymized_text, original_description, category,
          latitude, longitude, address, postal_code, city, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_validation')`,
        [
          submissionId,
          citizenId,
          anonymizedText,
          description,
          initialCategory,
          latitude,
          longitude,
          normalizedAddress || null,
          normalizedPostalCode || null,
          normalizedCity || null,
        ]
      );

      const ticketId = uuidv4();
      await db.run(
        `INSERT INTO tickets (
          citizen_language, citizen_language_name,
          id, submission_id, citizen_id, citizen_email_normalized, category, priority, description, status,
          tenant_id, latitude, longitude, address, postal_code, city
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          selectedLanguageCode,
          selectedLanguageName,
          ticketId,
          submissionId,
          citizenId,
          normalizedCitizenEmail || null,
          initialCategory,
          'medium',
          anonymizedText || null,
          'pending_validation',
          effectiveTenantId,
          latitude,
          longitude,
          normalizedAddress || null,
          normalizedPostalCode || null,
          normalizedCity || null,
        ]
      );

      if (!isGermanLanguageCode(selectedLanguageCode) && description.trim()) {
        void queueSubmissionDescriptionTranslation({
          submissionId,
          ticketId,
          sourceText: description,
          sourceLanguage: selectedLanguageCode,
          sourceLanguageName: selectedLanguageName,
        }).catch((error) => {
          console.warn('Background translation enqueue failed for submission description:', error);
        });
      }

      publishTicketUpdate({
        reason: 'ticket.created',
        ticketId,
      });
      void sendNewTicketEmailNotifications(ticketId).catch((error) => {
        console.warn('New ticket email notification failed:', error);
      });

      await db.run(
        `UPDATE submissions SET status = 'pending_validation', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [submissionId]
      );

      for (const fileEntry of storedFiles) {
        await db.run(
          `INSERT INTO submission_images (id, submission_id, file_name, image_data, exif_json)
           VALUES (?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            submissionId,
            fileEntry.fileName,
            fileEntry.data,
            fileEntry.exifSummary ? JSON.stringify(fileEntry.exifSummary) : null,
          ]
        );
      }

      for (const nonImageFileName of nonImageFileNames) {
        await db.run(
          `INSERT INTO ticket_comments (
            id, ticket_id, author_type, author_name, visibility, comment_type, content, metadata_json
          ) VALUES (?, ?, 'system', 'upload', 'internal', 'note', ?, ?)`,
          [
            uuidv4(),
            ticketId,
            `Datei "${nonImageFileName}" wurde angehängt: das ist kein bild.`,
            JSON.stringify({
              source: 'submission.upload',
              kind: 'non_image_attachment',
              fileName: nonImageFileName,
            }),
          ]
        );
      }

      const authenticatedIntakeWorkflowTemplateId = normalizeString(
        resolvedFrontendProfile.authenticatedIntakeWorkflowTemplateId
      );
      const standardProfileIntakeWorkflowTemplateId =
        normalizeString(resolvedFrontendProfile.intakeWorkflowTemplateId) || 'standard-intake-workflow';
      const intakeWorkflowTemplateId =
        citizenSession && resolvedFrontendProfile.citizenAuthEnabled && authenticatedIntakeWorkflowTemplateId
          ? authenticatedIntakeWorkflowTemplateId
          : standardProfileIntakeWorkflowTemplateId;

      // Respond immediately to keep citizen UX fast. Workflow (incl. email/translation work)
      // continues asynchronously in the background.
      res.status(201).json({
        ticketId,
        workflowIntakeQueued: true,
        imageUploadFallbackUsed,
        imageUploadFallbackCode: imageUploadFallbackCode || null,
        message: 'Ihre Meldung wurde erfasst.',
      });

      void (async () => {
        try {
          await persistSubmissionGeoWeatherEnrichment({
            ticketId,
            submissionId,
            latitude,
            longitude,
            address: normalizedAddress,
            postalCode: normalizedPostalCode,
            city: normalizedCity,
            reportedAt,
          });
          publishTicketUpdate({
            reason: 'ticket.geo_enriched',
            ticketId,
          });
        } catch (geoError) {
          console.warn('Asynchronous geo/weather enrichment failed:', geoError);
        }

        try {
          await attachWorkflowToTicket(ticketId, intakeWorkflowTemplateId, { skipIfExisting: true });
        } catch (workflowError) {
          console.error('Asynchronous intake workflow start failed:', workflowError);
        }
      })();
      return;
    } catch (error) {
      return res.status(500).json({
        error: 'Fehler beim Verarbeiten der Meldung',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

/**
 * GET /api/submissions/unsubscribe?token=...
 * Bürger kann Statusänderungs-Mails für ein Ticket abbestellen
 */
router.get('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const token = req.query.token;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token erforderlich' });
    }

    const db = getDatabase();
    const ticket = await findTicketByStatusToken(db, token);
    if (!ticket?.id) {
      return res.status(404).json({ error: 'Meldung nicht gefunden' });
    }

    await db.run(
      `UPDATE tickets
       SET status_notifications_enabled = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [ticket.id]
    );

    return res.json({
      message: 'Automatische Benachrichtigungen wurden erfolgreich abbestellt.',
      ticketId: ticket.id,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Fehler beim Abbestellen der Benachrichtigungen' });
  }
});

/**
 * GET /api/submissions/status?token=...
 * Status einer Meldung via Validierungs-Token abfragen
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const token = req.query.token;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token erforderlich' });
    }

    const db = getDatabase();
    const ticket = await findTicketByStatusToken(db, token);

    if (!ticket) {
      return res.status(404).json({ error: 'Meldung nicht gefunden' });
    }

    const imageRows = await db.all(
      `SELECT id, file_name, created_at, length(image_data) as byte_size
       FROM submission_images
       WHERE submission_id = ?
       ORDER BY created_at ASC`,
      [ticket.submission_id]
    );
    const images = (imageRows || []).map((row: any) => {
      const imageId = String(row?.id || '');
      return {
        id: imageId,
        fileName: row?.file_name || 'bild',
        createdAt: row?.created_at || null,
        byteSize: Number(row?.byte_size || 0),
        url: `/api/submissions/status/image/${encodeURIComponent(token)}/${encodeURIComponent(imageId)}`,
      };
    });

    const workflow = loadLatestWorkflowSummary(String(ticket.id || ''));
    const workflowSummary = workflow
      ? {
          id: workflow.id,
          title: workflow.title,
          status: workflow.status,
          startedAt: workflow.startedAt || null,
          completedAt: workflow.completedAt || null,
          totalSteps: workflow.tasks.length,
          completedSteps: workflow.tasks.filter((task) => task.status === 'COMPLETED').length,
          currentStep:
            workflow.tasks.find((task) => task.status === 'RUNNING') ||
            workflow.tasks.find((task) => task.status === 'PENDING') ||
            null,
          steps: workflow.tasks,
        }
      : null;

    const description =
      ticket.submission_original_description ||
      ticket.description ||
      ticket.submission_anonymized_text ||
      '';
    const location = [
      ticket.address || ticket.submission_address || '',
      ticket.postal_code || ticket.submission_postal_code || '',
      ticket.city || ticket.submission_city || '',
    ]
      .filter(Boolean)
      .join(', ');
    const publicComments = await db.all(
      `SELECT id, author_type, author_name, comment_type, content, metadata_json, created_at
       FROM ticket_comments
       WHERE ticket_id = ? AND visibility = 'public'
       ORDER BY created_at ASC`,
      [ticket.id]
    );

    res.json({
      ticketId: ticket.id,
      status: ticket.status,
      category: ticket.category,
      priority: ticket.priority,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at || null,
      description,
      location,
      address: ticket.address || ticket.submission_address || '',
      postalCode: ticket.postal_code || ticket.submission_postal_code || '',
      city: ticket.city || ticket.submission_city || '',
      latitude: hasValidCoordinate(ticket.latitude) ? Number(ticket.latitude) : null,
      longitude: hasValidCoordinate(ticket.longitude) ? Number(ticket.longitude) : null,
      assignedTo: ticket.assigned_to || null,
      redmineIssueId: ticket.redmine_issue_id || null,
      citizenName: ticket.citizen_name || '',
      citizenEmail: ticket.citizen_email || '',
      images,
      comments: (publicComments || []).map((comment: any) => {
        let metadata: Record<string, any> | null = null;
        if (typeof comment?.metadata_json === 'string' && comment.metadata_json.trim()) {
          try {
            metadata = JSON.parse(comment.metadata_json);
          } catch {
            metadata = null;
          }
        }
        return {
          id: comment.id,
          authorType: comment.author_type || 'system',
          authorName: '',
          commentType: comment.comment_type || 'note',
          content: comment.content || '',
          metadata,
          createdAt: comment.created_at || null,
        };
      }),
      workflow: workflowSummary,
      workflowInfo: workflowSummary
        ? `Workflow "${workflowSummary.title}" aktiv/abgeschlossen mit ${workflowSummary.totalSteps} Schritten.`
        : 'Für dieses Ticket ist aktuell kein Workflow hinterlegt.',
    });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen des Status' });
  }
});

/**
 * GET /api/submissions/status/image/:token/:imageId
 * Liefert ein einzelnes Ticketbild für die öffentliche Statusseite
 */
router.get('/status/image/:token/:imageId', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || '');
    const imageId = String(req.params.imageId || '');
    if (!token || !imageId) {
      return res.status(400).json({ error: 'Token und Bild-ID erforderlich' });
    }

    const db = getDatabase();
    const ticket = await findTicketByStatusToken(db, token);
    if (!ticket?.submission_id) {
      return res.status(404).json({ error: 'Meldung nicht gefunden' });
    }

    const row = await db.get(
      `SELECT file_name, image_data
       FROM submission_images
       WHERE id = ? AND submission_id = ?
       LIMIT 1`,
      [imageId, ticket.submission_id]
    );
    if (!row) {
      return res.status(404).json({ error: 'Bild nicht gefunden' });
    }

    const buffer = normalizeImageBuffer((row as any)?.image_data);
    if (!buffer) {
      return res.status(404).json({ error: 'Bilddaten nicht verfügbar' });
    }

    const mimeType = guessStoredFileMimeType((row as any)?.file_name, buffer);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({ error: 'Fehler beim Laden des Bildes' });
  }
});

/**
 * GET /api/submissions/:ticketId/status
 * Status einer Meldung abfragen (anonyme Anfrage, nur mit Ticket-ID)
 */
router.get('/:ticketId/status', async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const db = getDatabase();
    
    const ticket = await db.get(
      `SELECT status, category, priority, created_at 
       FROM tickets WHERE id = ?`,
      [ticketId]
    );
    
    if (!ticket) {
      return res.status(404).json({ error: 'Meldung nicht gefunden' });
    }
    
    res.json({
      ticketId,
      status: ticket.status,
      category: ticket.category,
      priority: ticket.priority,
      createdAt: ticket.created_at,
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Abrufen des Status' });
  }
});

export default router;
