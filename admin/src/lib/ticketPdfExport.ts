import { jsPDF } from 'jspdf';

export interface TicketPdfDataRequestFieldOption {
  value: string;
  label?: string;
}

export interface TicketPdfDataRequestField {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: TicketPdfDataRequestFieldOption[];
}

export interface TicketPdfDataRequest {
  id: string;
  executionId?: string | null;
  taskId?: string | null;
  status?: string | null;
  mode?: string | null;
  createdAt?: string | null;
  answeredAt?: string | null;
  expiresAt?: string | null;
  cycle?: number | null;
  maxCycles?: number | null;
  fields?: TicketPdfDataRequestField[];
  answers?: Record<string, unknown> | null;
}

export interface TicketPdfInternalTask {
  id: string;
  ticketId?: string | null;
  workflowExecutionId?: string | null;
  stepId?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  mode?: string | null;
  assigneeUserId?: string | null;
  assigneeOrgUnitId?: string | null;
  dueAt?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  completedBy?: string | null;
  cycleIndex?: number | null;
  maxCycles?: number | null;
  formSchema?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
}

export interface TicketPdfComment {
  id: string;
  executionId?: string | null;
  taskId?: string | null;
  authorType?: string | null;
  authorName?: string | null;
  visibility?: string | null;
  commentType?: string | null;
  content?: string | null;
  createdAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TicketPdfImageAnalysis {
  status?: string | null;
  description?: string | null;
  confidence?: number | null;
  model?: string | null;
  error?: string | null;
  updatedAt?: string | null;
}

export interface TicketPdfImageExif {
  hasExif?: boolean;
  hasGps?: boolean;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  orientation?: number | null;
}

export interface TicketPdfImage {
  id: string;
  fileName?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  createdAt?: string | null;
  exif?: TicketPdfImageExif | null;
  analysis?: TicketPdfImageAnalysis | null;
}

export interface TicketPdfEmailAttachment {
  id: string;
  fileName?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  contentDisposition?: string | null;
  contentId?: string | null;
  createdAt?: string | null;
}

export interface TicketPdfEmailMessage {
  id: string;
  mailboxUid?: number | null;
  mailboxName?: string | null;
  subject?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  toEmails?: string | null;
  ccEmails?: string | null;
  receivedAt?: string | null;
  ticketId?: string | null;
  matchReason?: string | null;
  preview?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  attachments?: TicketPdfEmailAttachment[];
}

export interface TicketPdfCollaborator {
  id: string;
  userId?: string | null;
  orgUnitId?: string | null;
  userName?: string | null;
  orgUnitName?: string | null;
  createdAt?: string | null;
}

export interface TicketPdfTicket {
  id: string;
  submissionId?: string;
  citizenId?: string;
  citizenName?: string;
  citizenEmail?: string;
  citizenPreferredLanguage?: string;
  citizenPreferredLanguageName?: string;
  reporterPseudoName?: string;
  reporterPseudoEmail?: string;
  category?: string;
  priority?: string;
  status?: string;
  description?: string | null;
  anonymizedText?: string | null;
  originalDescription?: string | null;
  translatedDescriptionDe?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  responsibilityAuthority?: string | null;
  assignedTo?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
  owningOrgUnitId?: string | null;
  owningOrgUnitName?: string | null;
  primaryAssigneeUserId?: string | null;
  primaryAssigneeUserName?: string | null;
  primaryAssigneeOrgUnitId?: string | null;
  primaryAssigneeOrgUnitName?: string | null;
  collaborators?: TicketPdfCollaborator[];
  nominatimRaw?: Record<string, unknown> | null;
  weatherReport?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  images?: TicketPdfImage[];
  emailMessages?: TicketPdfEmailMessage[];
  comments?: TicketPdfComment[];
  dataRequests?: TicketPdfDataRequest[];
  internalTasks?: TicketPdfInternalTask[];
}

export interface TicketPdfWorkflowTask {
  id: string;
  title?: string;
  description?: string;
  type?: string;
  status?: string;
  order?: number;
  auto?: boolean;
  config?: Record<string, unknown> | null;
  executionData?: Record<string, unknown> | null;
}

export interface TicketPdfWorkflowHistoryEntry {
  at?: string;
  timestamp?: string;
  type?: string;
  message?: string;
  metadata?: Record<string, unknown> | null;
}

export interface TicketPdfWorkflow {
  id: string;
  title?: string;
  templateId?: string;
  status?: string;
  executionMode?: string;
  blockedReason?: string;
  startedAt?: string;
  completedAt?: string;
  currentTaskIndex?: number;
  tasks?: TicketPdfWorkflowTask[];
  history?: TicketPdfWorkflowHistoryEntry[];
}

export interface TicketPdfBundle {
  ticket: TicketPdfTicket;
  workflow?: TicketPdfWorkflow | null;
}

export interface TicketPdfListOptions {
  fileName?: string;
  reportTitle?: string;
  subtitle?: string;
  filterSummary?: string[];
  generatedBy?: string;
  orientation?: 'portrait' | 'landscape' | 'auto';
  tableLayoutMode?: 'compact' | 'expanded';
  tableTextSize?: 'sm' | 'md' | 'lg';
  tableColumns?: Array<{
    field: string;
    headerName?: string;
  }>;
}

export interface TicketPdfSingleOptions {
  fileName?: string;
  reportTitle?: string;
  subtitle?: string;
  generatedBy?: string;
}

type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

interface PdfContext {
  doc: jsPDF;
  y: number;
  pageNumber: number;
  pageLabel: string;
}

interface JournalEntry {
  title: string;
  meta?: string;
  body?: string;
}

const PAGE_MARGIN_X = 42;
const PAGE_MARGIN_BOTTOM = 42;
const TOP_BAR_HEIGHT = 22;
const CONTENT_TOP_START = 38;
const SECTION_GAP = 12;
const SMALL_GAP = 6;
const LINE_HEIGHT = 12;

const COLOR = {
  topBar: [15, 23, 42] as const,
  hero: [10, 53, 105] as const,
  heroAccent: [2, 132, 199] as const,
  textMain: [15, 23, 42] as const,
  textMuted: [71, 85, 105] as const,
  sectionLine: [37, 99, 235] as const,
  cardBg: [248, 250, 252] as const,
  cardBorder: [203, 213, 225] as const,
};

const TICKET_STATUS_LABELS: Record<string, string> = {
  pending_validation: 'Validierung ausstehend',
  pending: 'Ausstehend',
  open: 'Offen',
  assigned: 'Zugewiesen',
  'in-progress': 'In Bearbeitung',
  completed: 'Abgeschlossen',
  closed: 'Geschlossen',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  critical: 'Kritisch',
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  RUNNING: 'Läuft',
  PAUSED: 'Pausiert',
  COMPLETED: 'Abgeschlossen',
  FAILED: 'Fehler',
};

function nowIso(): string {
  return new Date().toISOString();
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function valueOrDash(value: unknown): string {
  const text = safeString(value);
  return text || '–';
}

function toIsoDateString(value: unknown): string {
  const raw = safeString(value);
  if (!raw) return nowIso();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return nowIso();
  return date.toISOString();
}

function formatDateTime(value: unknown): string {
  const raw = safeString(value);
  if (!raw) return '–';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDateTimeCompact(value: unknown): string {
  const raw = safeString(value);
  if (!raw) return '–';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '–';
  if (num < 1024) return `${Math.round(num)} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\t ]+/g, ' ').trim();
}

function toMultilineText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return normalizeWhitespace(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function htmlToText(value: string): string {
  return String(value || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toCompactJson(value: unknown, maxChars = 1200): string {
  if (value === null || value === undefined) return '';
  let text = '';
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (gekürzt)`;
}

function getPageWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth();
}

function getPageHeight(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight();
}

function contentWidth(doc: jsPDF): number {
  return getPageWidth(doc) - PAGE_MARGIN_X * 2;
}

function setTextColor(doc: jsPDF, rgb: readonly [number, number, number]) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function drawTopBar(ctx: PdfContext) {
  const doc = ctx.doc;
  const pageWidth = getPageWidth(doc);

  doc.setFillColor(COLOR.topBar[0], COLOR.topBar[1], COLOR.topBar[2]);
  doc.rect(0, 0, pageWidth, TOP_BAR_HEIGHT, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setTextColor(doc, [241, 245, 249]);
  doc.text(`Ticket-Export · ${ctx.pageLabel}`, PAGE_MARGIN_X, 14);
  doc.text(`Seite ${ctx.pageNumber}`, pageWidth - PAGE_MARGIN_X, 14, { align: 'right' });

  ctx.y = CONTENT_TOP_START;
}

function addPage(ctx: PdfContext) {
  ctx.doc.addPage('a4', 'portrait');
  ctx.pageNumber += 1;
  drawTopBar(ctx);
}

function ensureSpace(ctx: PdfContext, minHeight: number) {
  const maxY = getPageHeight(ctx.doc) - PAGE_MARGIN_BOTTOM;
  if (ctx.y + minHeight <= maxY) return;
  addPage(ctx);
}

function splitLines(doc: jsPDF, text: string, width: number, fontSize = 10, style: FontStyle = 'normal'): string[] {
  const safe = text.trim();
  if (!safe) return [];
  doc.setFont('helvetica', style);
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(safe, width) as string[];
}

function writeLines(
  ctx: PdfContext,
  lines: string[],
  opts?: {
    x?: number;
    fontSize?: number;
    style?: FontStyle;
    color?: readonly [number, number, number];
    lineHeight?: number;
  }
) {
  if (lines.length === 0) return;
  const x = opts?.x ?? PAGE_MARGIN_X;
  const fontSize = opts?.fontSize ?? 10;
  const style = opts?.style ?? 'normal';
  const color = opts?.color ?? COLOR.textMain;
  const lineHeight = opts?.lineHeight ?? LINE_HEIGHT;

  ctx.doc.setFont('helvetica', style);
  ctx.doc.setFontSize(fontSize);
  setTextColor(ctx.doc, color);
  for (const line of lines) {
    ensureSpace(ctx, lineHeight + 2);
    ctx.doc.text(line, x, ctx.y);
    ctx.y += lineHeight;
  }
}

function drawHero(
  ctx: PdfContext,
  title: string,
  subtitle: string,
  generatedBy?: string
) {
  const doc = ctx.doc;
  const pageWidth = getPageWidth(doc);
  const boxX = PAGE_MARGIN_X;
  const boxY = ctx.y;
  const boxW = pageWidth - PAGE_MARGIN_X * 2;
  const boxH = 96;

  ensureSpace(ctx, boxH + 10);

  doc.setFillColor(COLOR.hero[0], COLOR.hero[1], COLOR.hero[2]);
  doc.roundedRect(boxX, boxY, boxW, boxH, 8, 8, 'F');

  doc.setFillColor(COLOR.heroAccent[0], COLOR.heroAccent[1], COLOR.heroAccent[2]);
  doc.roundedRect(boxX, boxY, 9, boxH, 8, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(21);
  setTextColor(doc, [255, 255, 255]);
  doc.text(title, boxX + 18, boxY + 30);

  const subtitleLines = splitLines(doc, subtitle, boxW - 32, 11, 'normal');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  let subtitleY = boxY + 48;
  for (const line of subtitleLines.slice(0, 2)) {
    doc.text(line, boxX + 18, subtitleY);
    subtitleY += 14;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const generated = `Exportiert: ${formatDateTime(nowIso())}${generatedBy ? ` · ${generatedBy}` : ''}`;
  doc.text(generated, boxX + 18, boxY + boxH - 13);

  ctx.y = boxY + boxH + 14;
}

function drawSectionTitle(ctx: PdfContext, title: string) {
  ensureSpace(ctx, 24);
  const doc = ctx.doc;
  const w = contentWidth(doc);

  doc.setFillColor(COLOR.cardBg[0], COLOR.cardBg[1], COLOR.cardBg[2]);
  doc.setDrawColor(COLOR.cardBorder[0], COLOR.cardBorder[1], COLOR.cardBorder[2]);
  doc.roundedRect(PAGE_MARGIN_X, ctx.y - 12, w, 20, 4, 4, 'FD');

  doc.setDrawColor(COLOR.sectionLine[0], COLOR.sectionLine[1], COLOR.sectionLine[2]);
  doc.setLineWidth(1.2);
  doc.line(PAGE_MARGIN_X + 8, ctx.y - 2, PAGE_MARGIN_X + 44, ctx.y - 2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setTextColor(doc, COLOR.textMain);
  doc.text(title, PAGE_MARGIN_X + 50, ctx.y + 2);

  ctx.y += 20;
}

function drawLabeledRows(
  ctx: PdfContext,
  rows: Array<{ label: string; value: string }>,
  options?: { labelWidth?: number }
) {
  const labelWidth = options?.labelWidth ?? 120;
  const valueWidth = Math.max(80, contentWidth(ctx.doc) - labelWidth - 8);

  for (const row of rows) {
    const valueLines = splitLines(ctx.doc, valueOrDash(row.value), valueWidth, 10, 'normal');
    const rowHeight = Math.max(16, valueLines.length * LINE_HEIGHT + 4);
    ensureSpace(ctx, rowHeight + SMALL_GAP);

    ctx.doc.setFont('helvetica', 'bold');
    ctx.doc.setFontSize(10);
    setTextColor(ctx.doc, COLOR.textMuted);
    ctx.doc.text(`${row.label}:`, PAGE_MARGIN_X, ctx.y);

    ctx.doc.setFont('helvetica', 'normal');
    ctx.doc.setFontSize(10);
    setTextColor(ctx.doc, COLOR.textMain);

    let lineY = ctx.y;
    for (const line of valueLines) {
      ctx.doc.text(line, PAGE_MARGIN_X + labelWidth, lineY);
      lineY += LINE_HEIGHT;
    }

    ctx.y += rowHeight;
  }

  ctx.y += SMALL_GAP;
}

function drawParagraphCard(ctx: PdfContext, title: string, body: string) {
  const normalizedBody = toMultilineText(body);
  const cleanBody =
    normalizedBody.length > 4500 ? `${normalizedBody.slice(0, 4500)}\n... (gekürzt)` : normalizedBody;
  const rawLines = cleanBody.split('\n').map((line) => line.trim()).filter(Boolean);
  const bodyLines = rawLines.length === 0 ? ['–'] : rawLines;

  const innerWidth = contentWidth(ctx.doc) - 18;
  const wrappedBody: string[] = [];
  for (const line of bodyLines) {
    const lines = splitLines(ctx.doc, line, innerWidth, 10, 'normal');
    if (lines.length === 0) {
      wrappedBody.push('');
    } else {
      wrappedBody.push(...lines);
    }
  }

  const titleLines = splitLines(ctx.doc, title, innerWidth, 11, 'bold');
  const height = 10 + titleLines.length * 13 + 4 + wrappedBody.length * LINE_HEIGHT + 8;
  ensureSpace(ctx, height + 6);

  const boxX = PAGE_MARGIN_X;
  const boxY = ctx.y - 10;
  const boxW = contentWidth(ctx.doc);

  ctx.doc.setFillColor(COLOR.cardBg[0], COLOR.cardBg[1], COLOR.cardBg[2]);
  ctx.doc.setDrawColor(COLOR.cardBorder[0], COLOR.cardBorder[1], COLOR.cardBorder[2]);
  ctx.doc.roundedRect(boxX, boxY, boxW, height, 4, 4, 'FD');

  let textY = boxY + 16;
  writeLines(ctx, titleLines, {
    x: boxX + 9,
    fontSize: 11,
    style: 'bold',
    color: COLOR.textMain,
    lineHeight: 13,
  });
  textY = ctx.y + 1;
  ctx.y = textY;

  writeLines(ctx, wrappedBody, {
    x: boxX + 9,
    fontSize: 10,
    style: 'normal',
    color: COLOR.textMain,
    lineHeight: LINE_HEIGHT,
  });

  ctx.y += 8;
}

function drawJournalSection(
  ctx: PdfContext,
  sectionTitle: string,
  entries: JournalEntry[],
  emptyText: string
) {
  drawSectionTitle(ctx, sectionTitle);

  if (entries.length === 0) {
    drawParagraphCard(ctx, sectionTitle, emptyText);
    ctx.y += SECTION_GAP;
    return;
  }

  for (const entry of entries) {
    const bodyParts = [safeString(entry.meta), safeString(entry.body)].filter(Boolean);
    drawParagraphCard(ctx, valueOrDash(entry.title), bodyParts.join('\n'));
    ctx.y += SMALL_GAP;
  }

  ctx.y += SECTION_GAP;
}

function summarizeNominatim(raw: Record<string, unknown> | null | undefined): string {
  if (!raw || typeof raw !== 'object') return 'Keine Nominatim-Daten gespeichert.';
  const r = raw as Record<string, unknown>;
  const lines = [
    `Display Name: ${valueOrDash(r.display_name)}`,
    `Kategorie: ${valueOrDash(r.class)} / ${valueOrDash(r.type)}`,
    `Objekt-ID: ${valueOrDash(r.osm_type)} ${valueOrDash(r.osm_id)}`,
    `Bedeutung: ${valueOrDash(r.importance)}`,
  ];

  const address = r.address && typeof r.address === 'object' ? (r.address as Record<string, unknown>) : null;
  if (address) {
    const addressParts = [
      valueOrDash(address.road),
      valueOrDash(address.house_number),
      valueOrDash(address.postcode),
      valueOrDash(address.city || address.town || address.village),
      valueOrDash(address.country),
    ].filter((part) => part !== '–');
    if (addressParts.length > 0) {
      lines.push(`Adressdetails: ${addressParts.join(', ')}`);
    }
  }

  return lines.join('\n');
}

function summarizeWeather(raw: Record<string, unknown> | null | undefined): string {
  if (!raw || typeof raw !== 'object') return 'Keine Wetterdaten gespeichert.';
  const source = raw as Record<string, unknown>;
  const entries: string[] = [];

  const summary = safeString(source.summary);
  if (summary) entries.push(`Zusammenfassung: ${summary}`);

  const observationTime = safeString(source.observationTime || source.time || source.timestamp);
  if (observationTime) entries.push(`Messzeitpunkt: ${formatDateTime(observationTime)}`);

  const metric = source.metric && typeof source.metric === 'object' ? (source.metric as Record<string, unknown>) : null;
  const imperial = source.imperial && typeof source.imperial === 'object' ? (source.imperial as Record<string, unknown>) : null;
  const preferred = metric || imperial;

  if (preferred) {
    const temp = preferred.temperatureC ?? preferred.temperatureF ?? preferred.temperature;
    const feels = preferred.feelsLikeC ?? preferred.feelsLikeF ?? preferred.feelsLike;
    const wind = preferred.windKph ?? preferred.windMph ?? preferred.wind;
    const precip = preferred.precipMm ?? preferred.precipIn ?? preferred.precipitation;
    const humidity = preferred.humidity;

    if (temp !== undefined) entries.push(`Temperatur: ${valueOrDash(temp)}`);
    if (feels !== undefined) entries.push(`Gefühlt: ${valueOrDash(feels)}`);
    if (wind !== undefined) entries.push(`Wind: ${valueOrDash(wind)}`);
    if (precip !== undefined) entries.push(`Niederschlag: ${valueOrDash(precip)}`);
    if (humidity !== undefined) entries.push(`Luftfeuchte: ${valueOrDash(humidity)}`);
  }

  if (entries.length === 0) {
    entries.push(toCompactJson(source));
  }

  return entries.join('\n');
}

function buildQuestionJournalEntries(requests: TicketPdfDataRequest[]): JournalEntry[] {
  const formatAnswerValue = (value: unknown, optionMap?: Map<string, string>): string => {
    if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '–';
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return '–';
      if (optionMap && optionMap.has(trimmed)) return optionMap.get(trimmed) || trimmed;
      if (trimmed === 'true') return 'Ja';
      if (trimmed === 'false') return 'Nein';
      return trimmed;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '–';
      return value.map((entry) => formatAnswerValue(entry, optionMap)).join(', ');
    }
    if (value && typeof value === 'object') return toCompactJson(value, 650);
    return valueOrDash(value);
  };

  return requests.map((request, index) => {
    const fields = Array.isArray(request.fields) ? request.fields : [];
    const answers = request.answers && typeof request.answers === 'object' ? request.answers : {};
    const fieldsByKey = new Map(fields.map((field) => [safeString(field.key), field]));

    const questionLines =
      fields.length > 0
        ? fields.map((field) => {
            const requiredLabel = field.required ? ' (Pflicht)' : '';
            return `- ${valueOrDash(field.label || field.key)} [${valueOrDash(field.type)}]${requiredLabel}`;
          })
        : ['- Keine Fragen gespeichert'];

    const answerEntries = Object.entries(answers as Record<string, unknown>);
    const answerLines =
      answerEntries.length > 0
        ? answerEntries.map(([key, value]) => {
            const field = fieldsByKey.get(safeString(key));
            const optionMap = new Map(
              (Array.isArray(field?.options) ? field?.options : [])
                .map((option) => [safeString(option.value), safeString(option.label || option.value)])
                .filter((entry) => entry[0])
            );
            const label = safeString(field?.label || key) || key;
            const type = safeString(field?.type);
            const requiredInfo = field?.required ? ' · Pflicht' : '';
            return `- ${label}${type ? ` [${type}]` : ''}${requiredInfo}: ${formatAnswerValue(value, optionMap)}`;
          })
        : ['- Keine Bürgerantworten'];

    const meta = [
      `Status: ${valueOrDash(request.status)}`,
      `Modus: ${valueOrDash(request.mode)}`,
      `Erstellt: ${formatDateTime(request.createdAt)}`,
      `Beantwortet: ${formatDateTime(request.answeredAt)}`,
      `Ablauf: ${formatDateTime(request.expiresAt)}`,
      request.cycle && request.maxCycles ? `Zyklus: ${request.cycle}/${request.maxCycles}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      title: `Bürgerformular ${index + 1} (${request.id.slice(0, 8)})`,
      meta,
      body: `Fragen:\n${questionLines.join('\n')}\n\nAntworten:\n${answerLines.join('\n')}`,
    };
  });
}

function buildInternalTaskEntries(tasks: TicketPdfInternalTask[]): JournalEntry[] {
  const sorted = [...tasks].sort((a, b) => {
    const aTime = Date.parse(String(a.completedAt || a.createdAt || ''));
    const bTime = Date.parse(String(b.completedAt || b.createdAt || ''));
    const aSafe = Number.isFinite(aTime) ? aTime : 0;
    const bSafe = Number.isFinite(bTime) ? bTime : 0;
    return bSafe - aSafe;
  });

  return sorted.map((task, index) => {
    const responsePayload =
      task.response && typeof task.response === 'object' && !Array.isArray(task.response)
        ? (task.response as Record<string, unknown>)
        : {};
    const responseEntries = Object.entries(responsePayload);
    const formFields =
      task.formSchema && typeof task.formSchema === 'object' && Array.isArray((task.formSchema as any).fields)
        ? ((task.formSchema as any).fields as Array<Record<string, unknown>>)
        : [];
    const fieldByKey = new Map(formFields.map((field) => [safeString(field?.key), field]));

    const responseLines =
      responseEntries.length > 0
        ? responseEntries.map(([key, value]) => {
            const field = fieldByKey.get(safeString(key));
            const label = safeString(field?.label) || key;
            return `- ${label}: ${toMultilineText(value)}`;
          })
        : ['- Keine Formularantwort gespeichert'];

    return {
      title: `Aufgabe ${index + 1}: ${valueOrDash(task.title || task.id)}`,
      meta: [
        `Status: ${valueOrDash(task.status)}`,
        `Modus: ${valueOrDash(task.mode)}`,
        `Workflow: ${valueOrDash(task.workflowExecutionId)}`,
        `Schritt: ${valueOrDash(task.stepId)}`,
        `Fällig: ${formatDateTime(task.dueAt)}`,
        `Erstellt: ${formatDateTime(task.createdAt)}`,
        `Abgeschlossen: ${formatDateTime(task.completedAt)}`,
        task.cycleIndex && task.maxCycles ? `Zyklus: ${task.cycleIndex}/${task.maxCycles}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      body: [
        safeString(task.description) ? `Beschreibung:\n${safeString(task.description)}` : '',
        `Antworten:\n${responseLines.join('\n')}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  });
}

function buildCommentJournalEntries(comments: TicketPdfComment[]): JournalEntry[] {
  return comments.map((comment, index) => {
    const metaParts = [
      `Zeit: ${formatDateTime(comment.createdAt)}`,
      `Autor: ${valueOrDash(comment.authorName || comment.authorType)}`,
      `Typ: ${valueOrDash(comment.commentType)}`,
      `Sichtbarkeit: ${valueOrDash(comment.visibility)}`,
    ];
    const metadataSnippet = toCompactJson(comment.metadata, 600);
    const body = [valueOrDash(comment.content), metadataSnippet ? `Meta:\n${metadataSnippet}` : '']
      .filter(Boolean)
      .join('\n\n');

    return {
      title: `Kommentar ${index + 1} (${comment.id.slice(0, 8)})`,
      meta: metaParts.join(' · '),
      body,
    };
  });
}

function buildWorkflowTaskEntries(tasks: TicketPdfWorkflowTask[]): JournalEntry[] {
  const ordered = [...tasks].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  return ordered.map((task, index) => {
    const parts: string[] = [];
    const description = safeString(task.description);
    if (description) {
      parts.push(`Beschreibung:\n${description}`);
    }
    if (task.config && typeof task.config === 'object') {
      parts.push(`Konfiguration:\n${toCompactJson(task.config, 1000)}`);
    }
    if (task.executionData && typeof task.executionData === 'object') {
      parts.push(`Ausführungsdaten:\n${toCompactJson(task.executionData, 1000)}`);
    }
    return {
      title: `Schritt ${index + 1}: ${valueOrDash(task.title || task.id)}`,
      meta: [
        `Status: ${valueOrDash(task.status)}`,
        `Typ: ${valueOrDash(task.type)}`,
        `Order: ${Number.isFinite(Number(task.order)) ? String(task.order) : '–'}`,
        `Auto: ${task.auto === true ? 'ja' : 'nein'}`,
      ].join(' · '),
      body: parts.join('\n\n') || 'Keine Konfigurations-/Ausführungsdaten gespeichert.',
    };
  });
}

function buildWorkflowHistoryEntries(history: TicketPdfWorkflowHistoryEntry[]): JournalEntry[] {
  const sorted = [...history].sort((a, b) => {
    const aTime = Date.parse(toIsoDateString(a.at || a.timestamp));
    const bTime = Date.parse(toIsoDateString(b.at || b.timestamp));
    return aTime - bTime;
  });

  return sorted.map((entry, index) => {
    const meta = toCompactJson(entry.metadata, 700);
    return {
      title: `Workflow-Ereignis ${index + 1} · ${valueOrDash(entry.type)}`,
      meta: `Zeit: ${formatDateTime(entry.at || entry.timestamp)}`,
      body: [valueOrDash(entry.message), meta ? `Meta:\n${meta}` : ''].filter(Boolean).join('\n\n'),
    };
  });
}

function buildImageEntries(images: TicketPdfImage[]): JournalEntry[] {
  return images.map((image, index) => {
    const exif = image.exif || null;
    const analysis = image.analysis || null;

    const meta = [
      `Datei: ${valueOrDash(image.fileName)}`,
      `MIME: ${valueOrDash(image.mimeType)}`,
      `Groesse: ${formatBytes(image.byteSize)}`,
      `Erstellt: ${formatDateTime(image.createdAt)}`,
    ].join(' · ');

    const exifLines = exif
      ? [
          `EXIF: ${exif.hasExif ? 'ja' : 'nein'}`,
          `GPS: ${exif.hasGps ? 'ja' : 'nein'}`,
          `Koordinaten: ${valueOrDash(exif.gpsLatitude)}, ${valueOrDash(exif.gpsLongitude)}`,
          `Bildformat: ${valueOrDash(exif.format)} · ${valueOrDash(exif.width)}x${valueOrDash(exif.height)}`,
        ].join('\n')
      : 'Keine EXIF-Daten gespeichert.';

    const analysisLines = analysis
      ? [
          `Analyse-Status: ${valueOrDash(analysis.status)}`,
          `Beschreibung: ${valueOrDash(analysis.description)}`,
          `Konfidenz: ${valueOrDash(analysis.confidence)}`,
          `Modell: ${valueOrDash(analysis.model)}`,
          analysis.error ? `Fehler: ${analysis.error}` : '',
          `Aktualisiert: ${formatDateTime(analysis.updatedAt)}`,
        ]
          .filter(Boolean)
          .join('\n')
      : 'Keine Bildanalyse gespeichert.';

    return {
      title: `Bild ${index + 1} (${image.id.slice(0, 8)})`,
      meta,
      body: `EXIF:\n${exifLines}\n\nKI-Bildauswertung:\n${analysisLines}`,
    };
  });
}

function buildEmailJournalEntries(messages: TicketPdfEmailMessage[]): JournalEntry[] {
  return messages.map((message, index) => {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const sender = [safeString(message.fromName), safeString(message.fromEmail)].filter(Boolean).join(' ') || '–';
    const bodyPreview = safeString(message.textBody) || htmlToText(safeString(message.htmlBody)) || safeString(message.preview);
    const attachmentLines =
      attachments.length > 0
        ? attachments.map((attachment) => {
            const label = valueOrDash(attachment.fileName);
            const mime = valueOrDash(attachment.mimeType);
            const size = formatBytes(attachment.byteSize);
            return `- ${label} · ${mime} · ${size}`;
          })
        : ['- Keine Anhänge gespeichert'];

    return {
      title: `E-Mail ${index + 1} (${message.id.slice(0, 8)})`,
      meta: [
        `Mailbox: ${valueOrDash(message.mailboxName)} · UID ${valueOrDash(message.mailboxUid)}`,
        `Empfangen: ${formatDateTime(message.receivedAt)}`,
        `Ticket: ${valueOrDash(message.ticketId)}`,
        `Match: ${valueOrDash(message.matchReason)}`,
      ].join(' · '),
      body: [
        `Betreff: ${valueOrDash(message.subject)}`,
        `Absender: ${sender}`,
        `Empfänger: ${valueOrDash(message.toEmails)}`,
        message.ccEmails ? `CC: ${message.ccEmails}` : '',
        '',
        `Textauszug:\n${valueOrDash(bodyPreview)}`,
        '',
        `Anhänge:\n${attachmentLines.join('\n')}`,
      ]
        .filter(Boolean)
        .join('\n'),
    };
  });
}

function renderTicketBundle(
  ctx: PdfContext,
  bundle: TicketPdfBundle,
  options?: { titlePrefix?: string }
) {
  const ticket = bundle.ticket;
  const workflow = bundle.workflow || null;
  const prefix = safeString(options?.titlePrefix);
  const collaborators = Array.isArray(ticket.collaborators) ? ticket.collaborators : [];
  const collaboratorLines =
    collaborators.length > 0
      ? collaborators.map((entry, index) => {
          const userLabel = safeString(entry.userName) || safeString(entry.userId);
          const orgLabel = safeString(entry.orgUnitName) || safeString(entry.orgUnitId);
          const joined = [userLabel, orgLabel].filter(Boolean).join(' · ');
          return `${index + 1}. ${joined || valueOrDash(entry.id)}`;
        })
      : [];

  drawSectionTitle(ctx, `${prefix ? `${prefix} · ` : ''}Ticketstammdaten`);
  drawLabeledRows(ctx, [
    { label: 'Ticket-ID', value: valueOrDash(ticket.id) },
    { label: 'Meldung-ID', value: valueOrDash(ticket.submissionId) },
    { label: 'Mandant', value: valueOrDash(ticket.tenantName || ticket.tenantId) },
    { label: 'Kategorie', value: valueOrDash(ticket.category) },
    { label: 'Zuständigkeit', value: valueOrDash(ticket.responsibilityAuthority) },
    { label: 'Status', value: valueOrDash(TICKET_STATUS_LABELS[safeString(ticket.status)] || ticket.status) },
    { label: 'Priorität', value: valueOrDash(PRIORITY_LABELS[safeString(ticket.priority)] || ticket.priority) },
    { label: 'Workflow', value: workflow ? `${valueOrDash(workflow.title)} (${valueOrDash(workflow.status)})` : 'Nicht gestartet' },
    { label: 'Erstellt', value: formatDateTime(ticket.createdAt) },
    { label: 'Aktualisiert', value: formatDateTime(ticket.updatedAt) },
  ]);

  drawSectionTitle(ctx, 'Meldende Person');
  drawLabeledRows(ctx, [
    { label: 'Citizen-ID', value: valueOrDash(ticket.citizenId) },
    { label: 'Name', value: valueOrDash(ticket.citizenName) },
    { label: 'E-Mail', value: valueOrDash(ticket.citizenEmail) },
    {
      label: 'Sprache',
      value: valueOrDash(
        ticket.citizenPreferredLanguageName || ticket.citizenPreferredLanguage
      ),
    },
    { label: 'Pseudonym Name', value: valueOrDash(ticket.reporterPseudoName) },
    { label: 'Pseudonym E-Mail', value: valueOrDash(ticket.reporterPseudoEmail) },
  ]);

  drawSectionTitle(ctx, 'Zuweisung und Organisation');
  drawLabeledRows(ctx, [
    { label: 'Legacy assignedTo', value: valueOrDash(ticket.assignedTo) },
    { label: 'Federfuehrende Einheit', value: valueOrDash(ticket.owningOrgUnitName || ticket.owningOrgUnitId) },
    { label: 'Primärer Bearbeiter', value: valueOrDash(ticket.primaryAssigneeUserName || ticket.primaryAssigneeUserId) },
    {
      label: 'Primäre Bearbeitungseinheit',
      value: valueOrDash(ticket.primaryAssigneeOrgUnitName || ticket.primaryAssigneeOrgUnitId),
    },
  ]);
  drawParagraphCard(
    ctx,
    'Kollaborationen',
    collaboratorLines.length > 0 ? collaboratorLines.join('\n') : 'Keine Kollaboratoren gespeichert.'
  );
  ctx.y += SECTION_GAP;

  drawSectionTitle(ctx, 'Meldungsinhalt');
  drawParagraphCard(ctx, 'Beschreibung (aktueller Tickettext)', valueOrDash(ticket.description));
  drawParagraphCard(ctx, 'Anonymisierter Text', valueOrDash(ticket.anonymizedText));
  drawParagraphCard(ctx, 'Originaltext (Bürgerinput)', valueOrDash(ticket.originalDescription));
  drawParagraphCard(ctx, 'Übersetzung Deutsch', valueOrDash(ticket.translatedDescriptionDe));
  ctx.y += SECTION_GAP;

  drawSectionTitle(ctx, 'Standort und Kontext');
  drawLabeledRows(ctx, [
    { label: 'Adresse', value: valueOrDash([ticket.address, ticket.postalCode, ticket.city].filter(Boolean).join(', ')) },
    {
      label: 'Koordinaten',
      value:
        Number.isFinite(Number(ticket.latitude)) && Number.isFinite(Number(ticket.longitude))
          ? `${Number(ticket.latitude).toFixed(6)}, ${Number(ticket.longitude).toFixed(6)}`
          : '–',
    },
  ]);

  drawParagraphCard(ctx, 'Nominatim-Geoobjekt', summarizeNominatim(ticket.nominatimRaw));
  drawParagraphCard(
    ctx,
    'Nominatim-Geoobjekt (Rohdaten)',
    ticket.nominatimRaw && typeof ticket.nominatimRaw === 'object'
      ? toCompactJson(ticket.nominatimRaw, 2200)
      : 'Keine Nominatim-Rohdaten gespeichert.'
  );
  drawParagraphCard(ctx, 'Wetter zum Meldezeitpunkt', summarizeWeather(ticket.weatherReport));
  drawParagraphCard(
    ctx,
    'Wetter zum Meldezeitpunkt (Rohdaten)',
    ticket.weatherReport && typeof ticket.weatherReport === 'object'
      ? toCompactJson(ticket.weatherReport, 2200)
      : 'Keine Wetter-Rohdaten gespeichert.'
  );
  ctx.y += SECTION_GAP;

  const images = Array.isArray(ticket.images) ? ticket.images : [];
  drawJournalSection(ctx, 'Bildjournal', buildImageEntries(images), 'Keine Bilder gespeichert.');

  const dataRequests = Array.isArray(ticket.dataRequests) ? ticket.dataRequests : [];
  drawJournalSection(
    ctx,
    'Bürgerantworten (Formulare)',
    buildQuestionJournalEntries(dataRequests),
    'Keine Bürgerformular-Antworten gespeichert.'
  );

  const internalTasks = Array.isArray(ticket.internalTasks) ? ticket.internalTasks : [];
  drawJournalSection(
    ctx,
    'Aufgabenjournal (Interne Bearbeitung)',
    buildInternalTaskEntries(internalTasks),
    'Keine internen Aufgaben für dieses Ticket gespeichert.'
  );

  const emailMessages = Array.isArray(ticket.emailMessages) ? ticket.emailMessages : [];
  drawJournalSection(
    ctx,
    'E-Mail-Journal (IMAP)',
    buildEmailJournalEntries(emailMessages),
    'Keine zugeordneten E-Mails gespeichert.'
  );

  const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
  drawJournalSection(
    ctx,
    'Kommentarjournal',
    buildCommentJournalEntries(comments),
    'Keine Ticketkommentare gespeichert.'
  );

  drawSectionTitle(ctx, 'Workflow-Zusammenfassung');
  if (!workflow) {
    drawParagraphCard(ctx, 'Workflow', 'Kein Workflow an dieses Ticket angebunden.');
  } else {
    drawLabeledRows(ctx, [
      { label: 'Workflow-ID', value: valueOrDash(workflow.id) },
      { label: 'Titel', value: valueOrDash(workflow.title) },
      { label: 'Template', value: valueOrDash(workflow.templateId) },
      { label: 'Status', value: valueOrDash(WORKFLOW_STATUS_LABELS[safeString(workflow.status)] || workflow.status) },
      { label: 'Modus', value: valueOrDash(workflow.executionMode) },
      { label: 'Blockiert durch', value: valueOrDash(workflow.blockedReason) },
      { label: 'Gestartet', value: formatDateTime(workflow.startedAt) },
      { label: 'Beendet', value: formatDateTime(workflow.completedAt) },
    ]);

    const tasks = Array.isArray(workflow.tasks) ? workflow.tasks : [];
    drawJournalSection(ctx, 'Workflowjournal: Schritte', buildWorkflowTaskEntries(tasks), 'Keine Workflow-Schritte gespeichert.');

    const history = Array.isArray(workflow.history) ? workflow.history : [];
    drawJournalSection(ctx, 'Workflowjournal: Historie', buildWorkflowHistoryEntries(history), 'Keine Workflow-Historie gespeichert.');
  }
}

function buildDefaultFileName(prefix: string, suffix: string): string {
  const normalizedPrefix = safeString(prefix).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${normalizedPrefix || 'ticket-export'}-${suffix}-${stamp}.pdf`;
}

const PDF_APP_NAME = 'behebes.AI';
const PDF_ORG_NAME = 'Verbandsgemeinde Otterbach-Otterberg';

function resolveAdminBasenameForPdfLink(): string {
  if (typeof window === 'undefined') return '';
  return /^\/admin(\/|$)/.test(window.location.pathname) ? '/admin' : '';
}

function buildAdminTicketUrlForPdf(ticketId: unknown): string {
  const normalizedTicketId = encodeURIComponent(safeString(ticketId));
  const ticketPath = `${resolveAdminBasenameForPdfLink()}/tickets/${normalizedTicketId}`;
  if (typeof window === 'undefined') return ticketPath;
  return `${window.location.origin}${ticketPath}`;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('QR konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsDataUrl(url: string, timeoutMs = 3200): Promise<string | null> {
  if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return null;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutHandle = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (!response.ok) return null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function loadTicketQrCodeDataUrl(ticketUrl: string, sizePx = 120): Promise<string | null> {
  const encoded = encodeURIComponent(ticketUrl);
  const candidates = [
    `https://quickchart.io/qr?size=${sizePx}x${sizePx}&ecLevel=M&margin=1&text=${encoded}`,
    `https://api.qrserver.com/v1/create-qr-code/?size=${sizePx}x${sizePx}&ecc=M&data=${encoded}`,
  ];
  for (const candidate of candidates) {
    const dataUrl = await fetchImageAsDataUrl(candidate);
    if (dataUrl) return dataUrl;
  }
  return null;
}

export function exportSingleTicketPdf(bundle: TicketPdfBundle, options?: TicketPdfSingleOptions) {
  const ticketIdShort = safeString(bundle.ticket.id).slice(0, 8) || 'ticket';
  const fileName =
    safeString(options?.fileName) ||
    buildDefaultFileName(`ticket-${ticketIdShort}`, 'detail');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const ctx: PdfContext = {
    doc,
    y: CONTENT_TOP_START,
    pageNumber: 1,
    pageLabel: 'Ticketdetail Vollreport',
  };

  drawTopBar(ctx);
  const title = safeString(options?.reportTitle) || `Ticket-Auszug ${ticketIdShort}`;
  const subtitle =
    safeString(options?.subtitle) ||
    'DIN A4 Hochformat · Vollständiger Ticketreport inkl. Workflow-/Fragen-/Kommentarjournal';
  drawHero(ctx, title, subtitle, options?.generatedBy);

  renderTicketBundle(ctx, bundle, { titlePrefix: `Ticket ${ticketIdShort}` });

  drawSectionTitle(ctx, 'Technische Rohdaten');
  drawParagraphCard(
    ctx,
    'Nominatim (JSON)',
    bundle.ticket.nominatimRaw && typeof bundle.ticket.nominatimRaw === 'object'
      ? toCompactJson(bundle.ticket.nominatimRaw, 4200)
      : 'Keine Nominatim-Rohdaten gespeichert.'
  );
  drawParagraphCard(
    ctx,
    'Wetter (JSON)',
    bundle.ticket.weatherReport && typeof bundle.ticket.weatherReport === 'object'
      ? toCompactJson(bundle.ticket.weatherReport, 4200)
      : 'Keine Wetter-Rohdaten gespeichert.'
  );
  if (bundle.workflow && typeof bundle.workflow === 'object') {
    drawParagraphCard(ctx, 'Workflow (JSON)', toCompactJson(bundle.workflow, 4200));
  }

  doc.save(fileName);
}

export function exportTicketListPdf(bundles: TicketPdfBundle[], options?: TicketPdfListOptions) {
  const safeBundles = bundles.filter((entry) => entry && entry.ticket && safeString(entry.ticket.id));
  const fileName = safeString(options?.fileName) || buildDefaultFileName('ticketliste', 'report');
  const layoutMode = options?.tableLayoutMode === 'expanded' ? 'expanded' : 'compact';
  const orientationPref = options?.orientation || 'auto';
  const textScale =
    options?.tableTextSize === 'sm'
      ? 0.92
      : options?.tableTextSize === 'lg'
      ? 1.12
      : 1;

  interface GridColumn {
    key: string;
    title: string;
    minWidth: number;
    weight: number;
    align?: 'left' | 'right';
    resolve: (bundle: TicketPdfBundle, index: number) => string;
  }

  const compactCellText = (value: unknown, maxChars: number): string => {
    const text = normalizeWhitespace(valueOrDash(value));
    if (!text || text === '–') return '–';
    if (layoutMode === 'expanded') return text;
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  };

  const statusShort: Record<string, string> = {
    pending_validation: 'PV',
    pending: 'PE',
    open: 'OF',
    assigned: 'ZU',
    'in-progress': 'IB',
    completed: 'AB',
    closed: 'GE',
  };
  const priorityShort: Record<string, string> = {
    low: 'L',
    medium: 'M',
    high: 'H',
    critical: 'K',
  };

  const columnCatalog: Record<string, GridColumn> = {
    id: {
      key: 'id',
      title: 'Ticket',
      minWidth: 46,
      weight: 0.72,
      resolve: (bundle) => safeString(bundle.ticket.id).slice(0, 8) || '–',
    },
    reporter: {
      key: 'reporter',
      title: 'Meldende Person',
      minWidth: 88,
      weight: 1.15,
      resolve: (bundle) =>
        compactCellText(safeString(bundle.ticket.citizenName) || safeString(bundle.ticket.citizenEmail) || '–', 40),
    },
    citizenEmail: {
      key: 'citizenEmail',
      title: 'E-Mail',
      minWidth: 98,
      weight: 1.15,
      resolve: (bundle) => compactCellText(bundle.ticket.citizenEmail, 44),
    },
    submissionId: {
      key: 'submissionId',
      title: 'Submission',
      minWidth: 86,
      weight: 0.95,
      resolve: (bundle) => compactCellText(bundle.ticket.submissionId, 36),
    },
    assignedTo: {
      key: 'assignedTo',
      title: 'Zugewiesen an',
      minWidth: 90,
      weight: 1.0,
      resolve: (bundle) =>
        compactCellText(
          safeString(bundle.ticket.primaryAssigneeUserName) ||
            safeString(bundle.ticket.primaryAssigneeUserId) ||
            safeString(bundle.ticket.primaryAssigneeOrgUnitName) ||
            safeString(bundle.ticket.primaryAssigneeOrgUnitId) ||
            safeString(bundle.ticket.assignedTo) ||
            '–',
          44
        ),
    },
    primaryAssigneeUserId: {
      key: 'primaryAssigneeUserId',
      title: 'Primär User-ID',
      minWidth: 86,
      weight: 0.95,
      resolve: (bundle) => compactCellText(bundle.ticket.primaryAssigneeUserId, 34),
    },
    primaryAssigneeOrgUnitId: {
      key: 'primaryAssigneeOrgUnitId',
      title: 'Primär Org-Unit-ID',
      minWidth: 92,
      weight: 1.0,
      resolve: (bundle) => compactCellText(bundle.ticket.primaryAssigneeOrgUnitId, 34),
    },
    owningOrgUnitId: {
      key: 'owningOrgUnitId',
      title: 'Owning Org-Unit-ID',
      minWidth: 92,
      weight: 1.0,
      resolve: (bundle) => compactCellText(bundle.ticket.owningOrgUnitId, 34),
    },
    category: {
      key: 'category',
      title: 'Kategorie',
      minWidth: 74,
      weight: 1.0,
      resolve: (bundle) => compactCellText(bundle.ticket.category, 34),
    },
    status: {
      key: 'status',
      title: 'Status',
      minWidth: 52,
      weight: 0.55,
      resolve: (bundle) => {
        const statusCode = safeString(bundle.ticket.status).toLowerCase();
        const statusLabel = statusShort[statusCode] || compactCellText(TICKET_STATUS_LABELS[statusCode] || statusCode, 8);
        return statusLabel || '–';
      },
    },
    priority: {
      key: 'priority',
      title: 'Priorität',
      minWidth: 50,
      weight: 0.45,
      resolve: (bundle) => {
        const priorityCode = safeString(bundle.ticket.priority).toLowerCase();
        return priorityShort[priorityCode] || compactCellText(PRIORITY_LABELS[priorityCode] || priorityCode, 8);
      },
    },
    location: {
      key: 'location',
      title: 'Ort',
      minWidth: 100,
      weight: 1.3,
      resolve: (bundle) => {
        const location = [safeString(bundle.ticket.city), safeString(bundle.ticket.address)].filter(Boolean).join(', ');
        return compactCellText(location || '–', 52);
      },
    },
    createdAt: {
      key: 'createdAt',
      title: 'Erstellt',
      minWidth: 62,
      weight: 0.68,
      resolve: (bundle) => formatDateTimeCompact(bundle.ticket.createdAt),
    },
    updatedAt: {
      key: 'updatedAt',
      title: 'Aktualisiert',
      minWidth: 62,
      weight: 0.68,
      resolve: (bundle) => formatDateTimeCompact(bundle.ticket.updatedAt),
    },
    assignmentUpdatedAt: {
      key: 'assignmentUpdatedAt',
      title: 'Assignment aktualisiert',
      minWidth: 70,
      weight: 0.72,
      resolve: (bundle) => compactCellText((bundle.ticket as any)?.assignmentUpdatedAt, 26),
    },
    assignmentUpdatedBy: {
      key: 'assignmentUpdatedBy',
      title: 'Assignment von',
      minWidth: 78,
      weight: 0.84,
      resolve: (bundle) => compactCellText((bundle.ticket as any)?.assignmentUpdatedBy, 32),
    },
    imageCount: {
      key: 'imageCount',
      title: 'Bilder',
      minWidth: 36,
      weight: 0.28,
      align: 'right',
      resolve: (bundle) =>
        String(
          Math.max(
            0,
            Array.isArray(bundle.ticket.images)
              ? bundle.ticket.images.length
              : Number.isFinite(Number((bundle.ticket as any)?.imageCount))
              ? Number((bundle.ticket as any).imageCount)
              : 0
          )
        ),
    },
    workflowStatus: {
      key: 'workflowStatus',
      title: 'Workflow',
      minWidth: 84,
      weight: 0.92,
      resolve: (bundle) => {
        const workflow = bundle.workflow;
        const workflowStatus = safeString(workflow?.status || '').toUpperCase();
        const workflowStatusLabel = workflowStatus ? WORKFLOW_STATUS_LABELS[workflowStatus] || workflowStatus : '';
        if (!workflow) return '–';
        const label = `${workflowStatusLabel ? `${workflowStatusLabel} · ` : ''}${valueOrDash(
          workflow.title || workflow.templateId || workflow.id
        )}`;
        return compactCellText(label, 48);
      },
    },
    workflowExecutionId: {
      key: 'workflowExecutionId',
      title: 'Workflow-ID',
      minWidth: 84,
      weight: 0.86,
      resolve: (bundle) => compactCellText(bundle.workflow?.id || '', 32),
    },
  };

  const defaultFieldOrder = [
    'id',
    'status',
    'priority',
    'category',
    'location',
    'reporter',
    'workflowStatus',
    'imageCount',
    'createdAt',
  ];

  const requestedColumns = Array.isArray(options?.tableColumns)
    ? options!.tableColumns
        .map((entry) => ({
          field: safeString(entry?.field),
          headerName: safeString(entry?.headerName),
        }))
        .filter((entry) => !!entry.field)
    : [];

  const selectedColumns = (requestedColumns.length > 0 ? requestedColumns : defaultFieldOrder.map((field) => ({ field })))
    .map((entry) => {
      const base = columnCatalog[entry.field];
      if (!base) return null;
      return {
        ...base,
        title: entry.headerName || base.title,
      };
    })
    .filter((entry): entry is GridColumn => !!entry);

  const columns = selectedColumns.length > 0
    ? selectedColumns
    : defaultFieldOrder
        .map((field) => columnCatalog[field])
        .filter((entry): entry is GridColumn => !!entry);

  const resolvedOrientation: 'portrait' | 'landscape' =
    orientationPref === 'portrait' || orientationPref === 'landscape'
      ? orientationPref
      : columns.length >= 8
      ? 'landscape'
      : 'portrait';

  const doc = new jsPDF({ orientation: resolvedOrientation, unit: 'pt', format: 'a4' });
  const ctx: PdfContext = {
    doc,
    y: CONTENT_TOP_START,
    pageNumber: 1,
    pageLabel: layoutMode === 'expanded' ? 'Ticketliste SmartGrid Erweitert' : 'Ticketliste SmartGrid Kompakt',
  };

  drawTopBar(ctx);
  const title = safeString(options?.reportTitle) || 'Ticketliste SmartGrid';
  const subtitle =
    safeString(options?.subtitle) ||
    `DIN A4 ${resolvedOrientation === 'landscape' ? 'Querformat' : 'Hochformat'} · ${
      layoutMode === 'expanded' ? 'erweiterte Tabellenansicht' : 'kompakte Tabellenansicht'
    }`;
  const filterSummary = Array.isArray(options?.filterSummary)
    ? options!.filterSummary.map((line) => safeString(line)).filter(Boolean)
    : [];

  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(13);
  setTextColor(ctx.doc, COLOR.textMain);
  ctx.doc.text(title, PAGE_MARGIN_X, ctx.y + 9);
  ctx.y += 16;

  const subtitleText = `${subtitle} · Tickets: ${safeBundles.length} · Export: ${formatDateTime(nowIso())}${
    options?.generatedBy ? ` · ${safeString(options.generatedBy)}` : ''
  }`;
  const subtitleLines = splitLines(ctx.doc, subtitleText, contentWidth(ctx.doc), 8, 'normal');
  writeLines(ctx, subtitleLines, {
    x: PAGE_MARGIN_X,
    fontSize: 7.2,
    style: 'normal',
    color: COLOR.textMuted,
    lineHeight: 8,
  });

  if (filterSummary.length > 0) {
    const filterLines = splitLines(
      ctx.doc,
      `Filter: ${filterSummary.join(' · ')}`,
      contentWidth(ctx.doc),
      7.2,
      'normal'
    ).slice(0, 2);
    writeLines(ctx, filterLines, {
      x: PAGE_MARGIN_X,
      fontSize: 7.2,
      style: 'normal',
      color: COLOR.textMuted,
      lineHeight: 8,
    });
  }
  ctx.y += 4;

  const tableWidth = contentWidth(ctx.doc);
  const minWidthTotal = columns.reduce((sum, column) => sum + column.minWidth, 0);
  const extraWidth = Math.max(0, tableWidth - minWidthTotal);
  const weightTotal = columns.reduce((sum, column) => sum + column.weight, 0) || 1;
  const columnWidths = columns.map((column) => column.minWidth + (extraWidth * column.weight) / weightTotal);
  const widthDelta = tableWidth - columnWidths.reduce((sum, width) => sum + width, 0);
  columnWidths[columnWidths.length - 1] += widthDelta;

  const rows = safeBundles.map((bundle, index) => {
    const row: Record<string, string> = {};
    columns.forEach((column) => {
      row[column.key] = valueOrDash(column.resolve(bundle, index));
    });
    return row;
  });

  const headerHeight = layoutMode === 'expanded' ? 14 : 12;
  const cellPaddingX = layoutMode === 'expanded' ? 3 : 2;
  const cellPaddingY = layoutMode === 'expanded' ? 2 : 1;
  const rowFontSize = (layoutMode === 'expanded' ? 6.9 : 6.3) * textScale;
  const rowLineHeight = (layoutMode === 'expanded' ? 8.1 : 7) * textScale;
  const maxCellLines = layoutMode === 'expanded' ? 3 : 1;
  const headerFontSize = (layoutMode === 'expanded' ? 7.5 : 7) * textScale;

  const clampLines = (
    lines: string[],
    maxLines: number,
    maxWidth: number,
    fontSize: number,
    style: FontStyle
  ): string[] => {
    if (lines.length <= maxLines) return lines;
    const next = lines.slice(0, maxLines);
    const ellipsis = '...';
    ctx.doc.setFont('helvetica', style);
    ctx.doc.setFontSize(fontSize);
    let tail = next[maxLines - 1] || '';
    while (tail.length > 0 && ctx.doc.getTextWidth(`${tail}${ellipsis}`) > maxWidth) {
      tail = tail.slice(0, -1);
    }
    next[maxLines - 1] = `${tail}${ellipsis}`;
    return next;
  };

  const drawTableHeader = () => {
    ensureSpace(ctx, headerHeight + 1);
    const y = ctx.y;
    ctx.doc.setFillColor(30, 41, 59);
    ctx.doc.rect(PAGE_MARGIN_X, y, tableWidth, headerHeight, 'F');

    let x = PAGE_MARGIN_X;
    ctx.doc.setFont('helvetica', 'bold');
    ctx.doc.setFontSize(headerFontSize);
    setTextColor(ctx.doc, [241, 245, 249]);
    columns.forEach((column, columnIndex) => {
      const width = columnWidths[columnIndex];
      const textX = column.align === 'right' ? x + width - cellPaddingX : x + cellPaddingX;
      ctx.doc.text(column.title, textX, y + (layoutMode === 'expanded' ? 9.5 : 8), {
        align: column.align === 'right' ? 'right' : 'left',
      });
      x += width;
    });

    ctx.doc.setDrawColor(148, 163, 184);
    ctx.doc.setLineWidth(0.4);
    let gridX = PAGE_MARGIN_X;
    for (let index = 0; index < columns.length - 1; index += 1) {
      gridX += columnWidths[index];
      ctx.doc.line(gridX, y, gridX, y + headerHeight);
    }
    ctx.doc.line(PAGE_MARGIN_X, y + headerHeight, PAGE_MARGIN_X + tableWidth, y + headerHeight);
    ctx.y += headerHeight;
  };

  if (rows.length === 0) {
    writeLines(ctx, ['Keine Tickets für den Export vorhanden.'], {
      x: PAGE_MARGIN_X,
      fontSize: 10,
      style: 'italic',
      color: COLOR.textMuted,
      lineHeight: 12,
    });
    doc.save(fileName);
    return;
  }

  drawTableHeader();

  rows.forEach((row, rowIndex) => {
    const cellLinesByColumn: string[][] = columns.map((column, columnIndex) => {
      const rawValue = valueOrDash(row[column.key]);
      const maxWidth = Math.max(16, columnWidths[columnIndex] - cellPaddingX * 2);
      const wrapped = splitLines(ctx.doc, rawValue, maxWidth, rowFontSize, 'normal');
      const normalized = wrapped.length > 0 ? wrapped : ['–'];
      return clampLines(normalized, maxCellLines, maxWidth, rowFontSize, 'normal');
    });

    const rowLineCount = Math.max(...cellLinesByColumn.map((entry) => entry.length), 1);
    const rowHeight = Math.max(layoutMode === 'expanded' ? 13 : 9, cellPaddingY * 2 + rowLineCount * rowLineHeight);
    const maxY = getPageHeight(ctx.doc) - PAGE_MARGIN_BOTTOM;
    if (ctx.y + rowHeight > maxY) {
      addPage(ctx);
      ctx.pageLabel = layoutMode === 'expanded' ? 'Ticketliste SmartGrid Erweitert' : 'Ticketliste SmartGrid Kompakt';
      drawTopBar(ctx);
      drawTableHeader();
    }

    const rowY = ctx.y;
    if (rowIndex % 2 === 0) {
      ctx.doc.setFillColor(248, 250, 252);
      ctx.doc.rect(PAGE_MARGIN_X, rowY, tableWidth, rowHeight, 'F');
    }

    let x = PAGE_MARGIN_X;
    ctx.doc.setFont('helvetica', 'normal');
    ctx.doc.setFontSize(rowFontSize);
    setTextColor(ctx.doc, COLOR.textMain);
    columns.forEach((column, columnIndex) => {
      const width = columnWidths[columnIndex];
      const lines = cellLinesByColumn[columnIndex];
      const baseY = rowY + cellPaddingY + rowLineHeight - 1.2;
      lines.forEach((line, lineIndex) => {
        const textY = baseY + lineIndex * rowLineHeight;
        const textX = column.align === 'right' ? x + width - cellPaddingX : x + cellPaddingX;
        ctx.doc.text(line, textX, textY, {
          align: column.align === 'right' ? 'right' : 'left',
        });
      });
      x += width;
    });

    ctx.doc.setDrawColor(226, 232, 240);
    ctx.doc.setLineWidth(0.25);
    let gridX = PAGE_MARGIN_X;
    for (let index = 0; index < columns.length - 1; index += 1) {
      gridX += columnWidths[index];
      ctx.doc.line(gridX, rowY, gridX, rowY + rowHeight);
    }
    ctx.doc.line(PAGE_MARGIN_X, rowY + rowHeight, PAGE_MARGIN_X + tableWidth, rowY + rowHeight);
    ctx.y += rowHeight;
  });

  doc.save(fileName);
}
