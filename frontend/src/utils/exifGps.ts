export interface ExifGpsCoordinates {
  latitude: number;
  longitude: number;
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
  valueFieldOffset: number;
}

const TYPE_BYTE_LENGTH: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] as const; // Exif\0\0

function isWithinBounds(view: DataView, offset: number, size: number): boolean {
  return offset >= 0 && size >= 0 && offset + size <= view.byteLength;
}

function readAscii(view: DataView, offset: number, size: number): string {
  if (!isWithinBounds(view, offset, size)) return '';
  let result = '';
  for (let index = 0; index < size; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}

function readUint16(view: DataView, offset: number, littleEndian: boolean): number | null {
  if (!isWithinBounds(view, offset, 2)) return null;
  return view.getUint16(offset, littleEndian);
}

function readUint32(view: DataView, offset: number, littleEndian: boolean): number | null {
  if (!isWithinBounds(view, offset, 4)) return null;
  return view.getUint32(offset, littleEndian);
}

function hasExifHeaderAt(view: DataView, offset: number): boolean {
  if (!isWithinBounds(view, offset, EXIF_HEADER.length)) return false;
  for (let index = 0; index < EXIF_HEADER.length; index += 1) {
    if (view.getUint8(offset + index) !== EXIF_HEADER[index]) return false;
  }
  return true;
}

function parseIfdEntries(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  littleEndian: boolean
): IfdEntry[] {
  if (!isWithinBounds(view, ifdOffset, 2)) return [];
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  const entries: IfdEntry[] = [];
  const entriesStart = ifdOffset + 2;

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = entriesStart + index * 12;
    if (!isWithinBounds(view, entryOffset, 12)) break;

    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffset = view.getUint32(entryOffset + 8, littleEndian);
    const typeLength = TYPE_BYTE_LENGTH[type];
    if (!typeLength) continue;

    const totalLength = typeLength * count;
    if (totalLength > 4) {
      const absoluteOffset = tiffStart + valueOffset;
      if (!isWithinBounds(view, absoluteOffset, totalLength)) continue;
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

function getEntryBytes(view: DataView, tiffStart: number, entry: IfdEntry): Uint8Array | null {
  const typeLength = TYPE_BYTE_LENGTH[entry.type];
  if (!typeLength) return null;
  const totalLength = typeLength * entry.count;
  if (totalLength <= 0) return null;

  if (totalLength <= 4) {
    if (!isWithinBounds(view, entry.valueFieldOffset, totalLength)) return null;
    return new Uint8Array(view.buffer, view.byteOffset + entry.valueFieldOffset, totalLength);
  }

  const absoluteOffset = tiffStart + entry.valueOffset;
  if (!isWithinBounds(view, absoluteOffset, totalLength)) return null;
  return new Uint8Array(view.buffer, view.byteOffset + absoluteOffset, totalLength);
}

function getAsciiValue(view: DataView, tiffStart: number, entry?: IfdEntry): string | null {
  if (!entry) return null;
  const bytes = getEntryBytes(view, tiffStart, entry);
  if (!bytes || bytes.length === 0) return null;
  const chars: string[] = [];
  for (const value of bytes) {
    if (value === 0) break;
    chars.push(String.fromCharCode(value));
  }
  const text = chars.join('').trim();
  return text || null;
}

function getUnsignedIntValue(
  view: DataView,
  tiffStart: number,
  littleEndian: boolean,
  entry?: IfdEntry
): number | null {
  if (!entry) return null;
  const bytes = getEntryBytes(view, tiffStart, entry);
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

function getRationalValues(
  view: DataView,
  tiffStart: number,
  littleEndian: boolean,
  entry?: IfdEntry
): number[] | null {
  if (!entry || entry.count <= 0) return null;
  if (entry.type !== 5 && entry.type !== 10) return null;
  const bytes = getEntryBytes(view, tiffStart, entry);
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

function toDecimalDegrees(values: number[], reference: string | null, isLatitude: boolean): number | null {
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

function parseGpsFromTiffAt(view: DataView, tiffStart: number): ExifGpsCoordinates | null {
  if (!isWithinBounds(view, tiffStart, 8)) return null;

  const byteOrder = view.getUint16(tiffStart, false);
  const littleEndian = byteOrder === 0x4949 ? true : byteOrder === 0x4d4d ? false : null;
  if (littleEndian === null) return null;

  const magic = readUint16(view, tiffStart + 2, littleEndian);
  if (magic !== 42) return null;

  const firstIfdRelative = readUint32(view, tiffStart + 4, littleEndian);
  if (firstIfdRelative === null) return null;
  const firstIfdOffset = tiffStart + firstIfdRelative;
  if (!isWithinBounds(view, firstIfdOffset, 2)) return null;

  const ifd0Entries = parseIfdEntries(view, tiffStart, firstIfdOffset, littleEndian);
  const gpsPointerEntry = ifd0Entries.find((entry) => entry.tag === 0x8825);
  const gpsIfdRelative = getUnsignedIntValue(view, tiffStart, littleEndian, gpsPointerEntry);
  if (gpsIfdRelative === null) return null;

  const gpsIfdOffset = tiffStart + gpsIfdRelative;
  if (!isWithinBounds(view, gpsIfdOffset, 2)) return null;
  const gpsEntries = parseIfdEntries(view, tiffStart, gpsIfdOffset, littleEndian);

  const latitudeRef = getAsciiValue(
    view,
    tiffStart,
    gpsEntries.find((entry) => entry.tag === 0x0001)
  );
  const latitudeValues = getRationalValues(
    view,
    tiffStart,
    littleEndian,
    gpsEntries.find((entry) => entry.tag === 0x0002)
  );
  const longitudeRef = getAsciiValue(
    view,
    tiffStart,
    gpsEntries.find((entry) => entry.tag === 0x0003)
  );
  const longitudeValues = getRationalValues(
    view,
    tiffStart,
    littleEndian,
    gpsEntries.find((entry) => entry.tag === 0x0004)
  );

  if (!latitudeValues || !longitudeValues) return null;

  const latitude = toDecimalDegrees(latitudeValues, latitudeRef, true);
  const longitude = toDecimalDegrees(longitudeValues, longitudeRef, false);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

function parseExifPayload(view: DataView, payloadOffset: number, payloadLength: number): ExifGpsCoordinates | null {
  if (!isWithinBounds(view, payloadOffset, payloadLength) || payloadLength < 8) return null;

  if (hasExifHeaderAt(view, payloadOffset) && payloadLength > EXIF_HEADER.length + 8) {
    return parseGpsFromTiffAt(view, payloadOffset + EXIF_HEADER.length);
  }

  return parseGpsFromTiffAt(view, payloadOffset);
}

function parseExifGpsFromJpeg(arrayBuffer: ArrayBuffer): ExifGpsCoordinates | null {
  const view = new DataView(arrayBuffer);
  if (!isWithinBounds(view, 0, 4)) return null;
  if (view.getUint16(0, false) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    offset += 2;

    if (marker === 0xd8 || marker === 0x01) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (!isWithinBounds(view, offset, 2)) break;

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || !isWithinBounds(view, offset, segmentLength)) break;

    if (marker === 0xe1) {
      const payloadOffset = offset + 2;
      const payloadLength = segmentLength - 2;
      const coords = parseExifPayload(view, payloadOffset, payloadLength);
      if (coords) return coords;
    }

    offset += segmentLength;
  }

  return null;
}

function parseExifGpsFromWebp(arrayBuffer: ArrayBuffer): ExifGpsCoordinates | null {
  const view = new DataView(arrayBuffer);
  if (readAscii(view, 0, 4) !== 'RIFF') return null;
  if (readAscii(view, 8, 4) !== 'WEBP') return null;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkType = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (!isWithinBounds(view, dataOffset, chunkSize)) break;

    if (chunkType === 'EXIF') {
      const coords = parseExifPayload(view, dataOffset, chunkSize);
      if (coords) return coords;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset = dataOffset + paddedSize;
  }

  return null;
}

function parseExifGpsFromTiff(arrayBuffer: ArrayBuffer): ExifGpsCoordinates | null {
  const view = new DataView(arrayBuffer);
  if (!isWithinBounds(view, 0, 4)) return null;
  const byteOrder = view.getUint16(0, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  return parseGpsFromTiffAt(view, 0);
}

function parseExifGpsBySignatureScan(arrayBuffer: ArrayBuffer): ExifGpsCoordinates | null {
  const view = new DataView(arrayBuffer);
  const maxScanOffset = Math.max(0, Math.min(view.byteLength - EXIF_HEADER.length, 8 * 1024 * 1024));

  for (let offset = 0; offset <= maxScanOffset; offset += 1) {
    if (!hasExifHeaderAt(view, offset)) continue;
    const coords = parseGpsFromTiffAt(view, offset + EXIF_HEADER.length);
    if (coords) return coords;
  }

  return null;
}

export async function extractExifGpsFromFile(file: File): Promise<ExifGpsCoordinates | null> {
  try {
    if (!file.type.startsWith('image/')) return null;
    const buffer = await file.arrayBuffer();
    return (
      parseExifGpsFromJpeg(buffer) ||
      parseExifGpsFromWebp(buffer) ||
      parseExifGpsFromTiff(buffer) ||
      parseExifGpsBySignatureScan(buffer) ||
      null
    );
  } catch {
    return null;
  }
}
