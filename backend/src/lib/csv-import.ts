export type CsvDelimiter = ';' | ',';
export type CsvEncoding = 'utf-8' | 'windows-1252';

export interface ParsedCsvResult {
  headers: string[];
  rows: Array<Record<string, string>>;
  delimiter: CsvDelimiter;
  encoding: CsvEncoding;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeEncoding(value: unknown): CsvEncoding {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'utf8' || normalized === 'utf-8') {
    return 'utf-8';
  }
  return 'windows-1252';
}

function decodeCsvBuffer(buffer: Buffer, encoding: CsvEncoding): string {
  if (encoding === 'utf-8') {
    return new TextDecoder('utf-8').decode(buffer);
  }
  try {
    return new TextDecoder('windows-1252').decode(buffer);
  } catch (_error) {
    // Fallback for runtimes that may not expose windows-1252 in TextDecoder.
    return buffer.toString('latin1');
  }
}

function detectDelimiter(headerLine: string): CsvDelimiter {
  const semicolons = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

function parseCsvRecords(source: string, delimiter: CsvDelimiter): string[][] {
  const text = String(source || '').replace(/^\uFEFF/, '');
  const records: string[][] = [];
  const row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushRow = () => {
    row.push(field);
    field = '';
    const normalizedRow = row.map((entry) => String(entry).replace(/\r/g, '').trim());
    row.length = 0;
    if (normalizedRow.every((entry) => normalizeText(entry).length === 0)) return;
    records.push(normalizedRow);
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      pushRow();
      continue;
    }
    if (char === '\r') {
      if (next === '\n') continue;
      pushRow();
      continue;
    }
    field += char;
  }

  const hasRemainingData = row.length > 0 || field.length > 0;
  if (hasRemainingData) {
    pushRow();
  }

  return records;
}

export function parseCsvImportBuffer(buffer: Buffer, forcedEncoding?: string): ParsedCsvResult {
  const encoding = normalizeEncoding(forcedEncoding);
  const text = decodeCsvBuffer(buffer, encoding);
  const firstContentLine = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/g)
    .find((line) => normalizeText(line).length > 0) || '';
  const delimiter = detectDelimiter(firstContentLine);

  const records = parseCsvRecords(text, delimiter);
  if (records.length === 0) {
    return { headers: [], rows: [], delimiter, encoding };
  }

  const headers = records[0].map((entry) => normalizeText(entry));
  const rows: Array<Record<string, string>> = [];
  for (const fields of records.slice(1)) {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = normalizeText(fields[index] ?? '');
    });
    rows.push(row);
  }

  return { headers, rows, delimiter, encoding };
}
