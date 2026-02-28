/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * IMAP mailbox sync and ticket email mapping
 */

import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { getDatabase } from '../database.js';
import { formatSqlDateTime } from '../utils/sql-date.js';
import { loadImapSettings, loadImapSettingsForTenant } from './settings.js';
import { createAdminNotification } from './admin-notifications.js';
import {
  sendTicketAssignmentEmailNotifications,
  type TicketAssignmentNotificationRecipient,
} from './ticket-notifications.js';

const IMAP_DEFAULT_TIMEOUT_MS = 25000;
const MAILBOX_PREVIEW_LENGTH = 320;
const MAX_SYNC_MESSAGE_SIZE_BYTES = 30 * 1024 * 1024;
const MAX_STORED_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const DEFAULT_ATTACHMENT_MIME = 'application/octet-stream';

export interface MailboxAttachmentSummary {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  contentDisposition: string;
  contentId: string | null;
  createdAt: string | null;
}

export interface MailboxMessageSummary {
  id: string;
  mailboxUid: number;
  mailboxName: string;
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  toEmails: string | null;
  ccEmails: string | null;
  dateHeader: string | null;
  receivedAt: string | null;
  ticketId: string | null;
  ticketCommentId: string | null;
  matchReason: string | null;
  preview: string;
  hasHtmlBody: boolean;
  attachmentCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MailboxMessageDetail extends MailboxMessageSummary {
  textBody: string;
  htmlBody: string;
  attachments: MailboxAttachmentSummary[];
}

export interface MailboxListResult {
  items: MailboxMessageSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface MailboxSyncResult {
  syncedMailbox: string;
  searched: number;
  imported: number;
  linkedToTickets: number;
  skipped: number;
  maxUidAfterSync: number;
}

interface ParsedAddress {
  name: string;
  email: string;
}

interface ParsedAttachment {
  fileName: string;
  mimeType: string;
  contentDisposition: string;
  contentId: string | null;
  data: Buffer;
}

interface ParsedEmailMessage {
  subject: string;
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  from: ParsedAddress | null;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  dateHeader: string | null;
  dateParsed: Date | null;
  textBody: string;
  htmlBody: string;
  rawHeaders: string;
  rawSize: number;
  attachments: ParsedAttachment[];
}

interface TicketMatchResult {
  ticketId: string | null;
  reason: string | null;
}

const MIME_WORD_REGEX = /=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g;
const TICKET_ID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TICKET_ID_STRICT_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeWhitespace(value: string): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function toPreview(value: string, limit = MAILBOX_PREVIEW_LENGTH): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}…`;
}

function toSafeSqlDate(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return formatSqlDateTime(value);
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function imapQuote(value: string): string {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeQuotedPrintableToBuffer(input: string): Buffer {
  const normalized = String(input || '')
    .replace(/=\r?\n/g, '')
    .replace(/_/g, ' ');
  const bytes: number[] = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === '=' && i + 2 < normalized.length) {
      const code = normalized.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(code)) {
        bytes.push(parseInt(code, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(normalized.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

function decodeMimeWords(value: string): string {
  const source = String(value || '');
  if (!source.includes('=?')) return source;
  return source.replace(MIME_WORD_REGEX, (_match, charsetRaw, encodingRaw, encodedRaw) => {
    const charset = String(charsetRaw || '').trim().toLowerCase();
    const encoding = String(encodingRaw || '').trim().toLowerCase();
    const encoded = String(encodedRaw || '');
    try {
      const decodedBuffer =
        encoding === 'b'
          ? Buffer.from(encoded.replace(/\s+/g, ''), 'base64')
          : decodeQuotedPrintableToBuffer(encoded);
      if (charset.includes('iso-8859-1') || charset.includes('latin1') || charset.includes('windows-1252')) {
        return decodedBuffer.toString('latin1');
      }
      if (charset.includes('utf-8') || charset === 'utf8' || !charset) {
        return decodedBuffer.toString('utf8');
      }
      return decodedBuffer.toString('utf8');
    } catch {
      return encoded;
    }
  });
}

function parseHeaderParams(value: string): { mainValue: string; params: Record<string, string> } {
  const source = String(value || '').trim();
  if (!source) return { mainValue: '', params: {} };
  const segments = source.split(';');
  const mainValue = String(segments.shift() || '').trim().toLowerCase();
  const params: Record<string, string> = {};
  for (const segmentRaw of segments) {
    const segment = String(segmentRaw || '').trim();
    if (!segment) continue;
    const equalIndex = segment.indexOf('=');
    if (equalIndex <= 0) continue;
    const key = segment.slice(0, equalIndex).trim().toLowerCase();
    const rawValue = segment.slice(equalIndex + 1).trim();
    let value = rawValue;
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    params[key] = decodeMimeWords(value);
  }
  return { mainValue, params };
}

function splitHeaderAndBody(raw: Buffer): { headerText: string; body: Buffer } {
  const marker = Buffer.from('\r\n\r\n', 'latin1');
  const altMarker = Buffer.from('\n\n', 'latin1');
  const index = raw.indexOf(marker);
  if (index >= 0) {
    return {
      headerText: raw.slice(0, index).toString('latin1'),
      body: raw.slice(index + marker.length),
    };
  }
  const altIndex = raw.indexOf(altMarker);
  if (altIndex >= 0) {
    return {
      headerText: raw.slice(0, altIndex).toString('latin1'),
      body: raw.slice(altIndex + altMarker.length),
    };
  }
  return {
    headerText: raw.toString('latin1'),
    body: Buffer.alloc(0),
  };
}

function parseHeadersMap(headerText: string): Map<string, string[]> {
  const unfolded = String(headerText || '').replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);
  const map = new Map<string, string[]>();
  for (const lineRaw of lines) {
    const line = String(lineRaw || '');
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = decodeMimeWords(line.slice(separatorIndex + 1).trim());
    if (!key) continue;
    const existing = map.get(key) || [];
    existing.push(value);
    map.set(key, existing);
  }
  return map;
}

function getFirstHeader(headers: Map<string, string[]>, key: string): string {
  const value = headers.get(key.toLowerCase());
  return value && value.length > 0 ? String(value[0] || '') : '';
}

function decodePartBuffer(raw: Buffer, transferEncoding: string): Buffer {
  const encoding = String(transferEncoding || '').trim().toLowerCase();
  if (encoding === 'base64') {
    const compact = raw.toString('latin1').replace(/\s+/g, '');
    try {
      return Buffer.from(compact, 'base64');
    } catch {
      return raw;
    }
  }
  if (encoding === 'quoted-printable') {
    return decodeQuotedPrintableToBuffer(raw.toString('latin1'));
  }
  return raw;
}

function decodeTextBuffer(raw: Buffer, charsetRaw: string): string {
  const charset = String(charsetRaw || '').trim().toLowerCase();
  if (!charset || charset.includes('utf-8') || charset === 'utf8') {
    return raw.toString('utf8');
  }
  if (charset.includes('iso-8859-1') || charset.includes('latin1') || charset.includes('windows-1252')) {
    return raw.toString('latin1');
  }
  return raw.toString('utf8');
}

function parseAddressList(rawHeader: string): ParsedAddress[] {
  const source = decodeMimeWords(String(rawHeader || '').trim());
  if (!source) return [];
  const entries = source.split(',').map((entry) => entry.trim()).filter(Boolean);
  const addresses: ParsedAddress[] = [];
  for (const entry of entries) {
    const angleMatch = entry.match(/^(.*)<([^>]+)>$/);
    if (angleMatch) {
      const name = decodeMimeWords(String(angleMatch[1] || '').replace(/^"+|"+$/g, '').trim());
      const email = String(angleMatch[2] || '').trim().toLowerCase();
      if (email) {
        addresses.push({ name, email });
      }
      continue;
    }
    const bare = entry.replace(/[<>"]/g, '').trim().toLowerCase();
    if (bare && bare.includes('@')) {
      addresses.push({ name: '', email: bare });
    }
  }
  return addresses;
}

function splitMultipartParts(body: Buffer, boundary: string): Buffer[] {
  if (!boundary) return [];
  const marker = `--${boundary}`;
  const source = body.toString('latin1');
  const parts = source.split(marker);
  if (parts.length <= 1) return [];
  const result: Buffer[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    let segment = parts[i];
    if (!segment) continue;
    if (segment.startsWith('--')) break;
    segment = segment.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    if (!segment.trim()) continue;
    result.push(Buffer.from(segment, 'latin1'));
  }
  return result;
}

function normalizeFileName(name: string, fallback: string): string {
  const normalized = String(name || '')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .trim();
  if (!normalized) return fallback;
  return normalized.slice(0, 220);
}

function parseMimeEntity(
  headers: Map<string, string[]>,
  body: Buffer,
  collector: { textParts: string[]; htmlParts: string[]; attachments: ParsedAttachment[] }
): void {
  const contentTypeHeader = getFirstHeader(headers, 'content-type') || 'text/plain';
  const { mainValue: contentType, params: contentTypeParams } = parseHeaderParams(contentTypeHeader);
  const transferEncoding = getFirstHeader(headers, 'content-transfer-encoding');
  const contentDispositionHeader = getFirstHeader(headers, 'content-disposition');
  const { mainValue: dispositionType, params: dispositionParams } = parseHeaderParams(contentDispositionHeader);

  if (contentType.startsWith('multipart/')) {
    const boundary = contentTypeParams.boundary || '';
    const parts = splitMultipartParts(body, boundary);
    for (const part of parts) {
      const split = splitHeaderAndBody(part);
      const nestedHeaders = parseHeadersMap(split.headerText);
      parseMimeEntity(nestedHeaders, split.body, collector);
    }
    return;
  }

  const decoded = decodePartBuffer(body, transferEncoding);
  const contentIdRaw = getFirstHeader(headers, 'content-id').replace(/[<>]/g, '').trim();
  const fileNameCandidate =
    dispositionParams.filename ||
    dispositionParams['filename*'] ||
    contentTypeParams.name ||
    contentTypeParams['name*'] ||
    '';
  const hasFileName = !!String(fileNameCandidate || '').trim();
  const isAttachment =
    dispositionType === 'attachment' ||
    hasFileName ||
    (dispositionType === 'inline' && !!String(fileNameCandidate || '').trim());

  if (isAttachment) {
    const fileName = normalizeFileName(fileNameCandidate, `attachment-${collector.attachments.length + 1}.bin`);
    collector.attachments.push({
      fileName,
      mimeType: contentType || DEFAULT_ATTACHMENT_MIME,
      contentDisposition: dispositionType || 'attachment',
      contentId: contentIdRaw || null,
      data: decoded,
    });
    return;
  }

  if (contentType === 'text/html') {
    const charset = contentTypeParams.charset || '';
    collector.htmlParts.push(decodeTextBuffer(decoded, charset));
    return;
  }

  if (contentType === 'text/plain' || !contentType) {
    const charset = contentTypeParams.charset || '';
    collector.textParts.push(decodeTextBuffer(decoded, charset));
    return;
  }
}

function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseDateHeader(value: string): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseEmailMessage(rawMessage: Buffer): ParsedEmailMessage {
  const split = splitHeaderAndBody(rawMessage);
  const headers = parseHeadersMap(split.headerText);
  const collector = {
    textParts: [] as string[],
    htmlParts: [] as string[],
    attachments: [] as ParsedAttachment[],
  };
  parseMimeEntity(headers, split.body, collector);
  const textBody = normalizeWhitespace(collector.textParts.join('\n\n')) || htmlToText(collector.htmlParts.join('\n\n'));
  const htmlBody = collector.htmlParts.join('\n\n').trim();

  const fromList = parseAddressList(getFirstHeader(headers, 'from'));
  const toList = parseAddressList(getFirstHeader(headers, 'to'));
  const ccList = parseAddressList(getFirstHeader(headers, 'cc'));

  const subject = decodeMimeWords(getFirstHeader(headers, 'subject')).trim();
  const messageId = getFirstHeader(headers, 'message-id').replace(/[<>]/g, '').trim() || null;
  const inReplyTo = getFirstHeader(headers, 'in-reply-to').replace(/[<>]/g, '').trim() || null;
  const referencesHeader = getFirstHeader(headers, 'references').trim() || null;
  const dateHeader = getFirstHeader(headers, 'date').trim() || null;

  return {
    subject,
    messageId,
    inReplyTo,
    referencesHeader,
    from: fromList[0] || null,
    to: toList,
    cc: ccList,
    dateHeader,
    dateParsed: parseDateHeader(dateHeader || ''),
    textBody: textBody || '',
    htmlBody: htmlBody || '',
    rawHeaders: split.headerText || '',
    rawSize: rawMessage.length,
    attachments: collector.attachments,
  };
}

function collectTicketCandidates(message: ParsedEmailMessage): Array<{ value: string; reason: string }> {
  const candidates: Array<{ value: string; reason: string }> = [];
  const seen = new Set<string>();
  const push = (value: string, reason: string) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    if (!TICKET_ID_STRICT_REGEX.test(normalized)) return;
    seen.add(normalized);
    candidates.push({ value: normalized, reason });
  };

  const subject = String(message.subject || '');
  const textBody = String(message.textBody || '');
  const htmlBodyText = htmlToText(message.htmlBody || '');

  const markerPatterns: Array<{ regex: RegExp; reason: string }> = [
    { regex: /\[(?:ticket|meldung)\s*([0-9a-f-]{36})\]/gi, reason: 'subject_marker' },
    { regex: /ticket[\s_-]?id[:#\s]+([0-9a-f-]{36})/gi, reason: 'subject_ticket_id' },
    { regex: /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi, reason: 'subject_uuid' },
  ];
  for (const pattern of markerPatterns) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.regex.exec(subject)) !== null) {
      push(match[1], pattern.reason);
    }
  }

  const bodyPatterns: Array<{ regex: RegExp; reason: string; source: string }> = [
    { regex: /ticket[\s_-]?id[:#\s]+([0-9a-f-]{36})/gi, reason: 'body_ticket_id', source: textBody },
    { regex: /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi, reason: 'body_uuid', source: textBody },
    { regex: /ticket[\s_-]?id[:#\s]+([0-9a-f-]{36})/gi, reason: 'html_ticket_id', source: htmlBodyText },
  ];

  for (const pattern of bodyPatterns) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.regex.exec(pattern.source)) !== null) {
      push(match[1], pattern.reason);
      if (candidates.length >= 12) return candidates;
    }
  }

  return candidates;
}

async function resolveTicketMatch(message: ParsedEmailMessage): Promise<TicketMatchResult> {
  const candidates = collectTicketCandidates(message);
  if (candidates.length === 0) return { ticketId: null, reason: null };
  const db = getDatabase();
  for (const candidate of candidates) {
    const row = await db.get(
      `SELECT id
       FROM tickets
       WHERE LOWER(TRIM(id)) = LOWER(TRIM(?))
       LIMIT 1`,
      [candidate.value]
    );
    if (row?.id) {
      return {
        ticketId: String(row.id),
        reason: candidate.reason,
      };
    }
  }
  return { ticketId: null, reason: null };
}

function buildMailboxMessageId(): string {
  return `mbx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildMailboxAttachmentId(): string {
  return `matt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function buildTicketCommentId(): string {
  return `tc_mail_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseImapSearchUids(response: Buffer): number[] {
  const text = response.toString('latin1');
  const match = text.match(/(?:^|\r\n)\* SEARCH([^\r\n]*)\r\n/i);
  if (!match) return [];
  const values = String(match[1] || '')
    .trim()
    .split(/\s+/)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.floor(entry));
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function parseFetchedRfc822(response: Buffer): Buffer | null {
  const latin = response.toString('latin1');
  const literalMatch = latin.match(/RFC822\s+\{(\d+)\}\r\n/i);
  if (!literalMatch) return null;
  const literalHeader = literalMatch[0];
  const literalLength = Number(literalMatch[1] || 0);
  if (!Number.isFinite(literalLength) || literalLength <= 0) return null;
  const startIndex = latin.indexOf(literalHeader);
  if (startIndex < 0) return null;
  const payloadStart = startIndex + literalHeader.length;
  const payloadEnd = payloadStart + literalLength;
  if (payloadEnd > response.length) return null;
  return response.slice(payloadStart, payloadEnd);
}

class RawImapClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private tagCounter = 0;
  private closedError: Error | null = null;
  private dataWaiters: Array<() => void> = [];

  private notifyData(): void {
    const waiters = [...this.dataWaiters];
    this.dataWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  private async waitForData(timeoutMs = IMAP_DEFAULT_TIMEOUT_MS): Promise<void> {
    if (this.closedError) throw this.closedError;
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.dataWaiters = this.dataWaiters.filter((entry) => entry !== onData);
        reject(new Error('IMAP timeout while waiting for response data'));
      }, timeoutMs);
      const onData = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      this.dataWaiters.push(onData);
    });
    if (this.closedError) throw this.closedError;
  }

  private findTaggedCompletion(tag: string): { endIndex: number; status: string } | null {
    const text = this.buffer.toString('latin1');
    const regex = new RegExp(`(?:^|\\r\\n)${escapeRegExp(tag)}\\s+(OK|NO|BAD)(?: [^\\r\\n]*)?\\r\\n`, 'i');
    const match = regex.exec(text);
    if (!match || typeof match.index !== 'number') return null;
    return {
      endIndex: match.index + match[0].length,
      status: String(match[1] || '').toUpperCase(),
    };
  }

  private async waitForGreeting(): Promise<void> {
    const regex = /(?:^|\r\n)\* (?:OK|PREAUTH)[^\r\n]*\r\n/i;
    while (true) {
      const text = this.buffer.toString('latin1');
      const match = regex.exec(text);
      if (match && typeof match.index === 'number') {
        const endIndex = match.index + match[0].length;
        this.buffer = this.buffer.slice(endIndex);
        return;
      }
      await this.waitForData();
    }
  }

  async connect(input: { host: string; port: number; secure: boolean }): Promise<void> {
    if (this.socket) return;
    const { host, port, secure } = input;
    this.closedError = null;
    this.buffer = Buffer.alloc(0);
    this.tagCounter = 0;

    this.socket = secure
      ? tls.connect({
          host,
          port,
          servername: host,
          rejectUnauthorized: true,
        })
      : net.connect({ host, port });

    this.socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      this.notifyData();
    });
    this.socket.on('error', (error) => {
      this.closedError = error instanceof Error ? error : new Error(String(error));
      this.notifyData();
    });
    this.socket.on('close', () => {
      if (!this.closedError) {
        this.closedError = new Error('IMAP connection closed');
      }
      this.notifyData();
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('IMAP socket could not be created'));
        return;
      }
      const readyEvent = secure ? 'secureConnect' : 'connect';
      this.socket.once(readyEvent, () => resolve());
      this.socket.once('error', (error) => reject(error));
    });

    await this.waitForGreeting();
  }

  async command(commandText: string): Promise<Buffer> {
    if (!this.socket) throw new Error('IMAP connection is not open');
    const tag = `A${String(++this.tagCounter).padStart(4, '0')}`;
    this.socket.write(`${tag} ${commandText}\r\n`);
    while (true) {
      const completion = this.findTaggedCompletion(tag);
      if (completion) {
        const response = this.buffer.slice(0, completion.endIndex);
        this.buffer = this.buffer.slice(completion.endIndex);
        if (completion.status !== 'OK') {
          const tail = response.toString('latin1').split(/\r?\n/).filter(Boolean).slice(-1)[0] || completion.status;
          throw new Error(`IMAP command failed (${commandText}): ${tail}`);
        }
        return response;
      }
      await this.waitForData();
    }
  }

  async login(user: string, pass: string): Promise<void> {
    await this.command(`LOGIN ${imapQuote(user)} ${imapQuote(pass)}`);
  }

  async select(mailbox: string): Promise<void> {
    await this.command(`SELECT ${imapQuote(mailbox)}`);
  }

  async searchUidRange(startUid: number): Promise<number[]> {
    const commandText = startUid > 0 ? `UID SEARCH UID ${startUid}:*` : 'UID SEARCH ALL';
    const response = await this.command(commandText);
    return parseImapSearchUids(response);
  }

  async fetchMessageByUid(uid: number): Promise<Buffer | null> {
    const response = await this.command(`UID FETCH ${uid} (UID RFC822)`);
    return parseFetchedRfc822(response);
  }

  async close(): Promise<void> {
    if (!this.socket) return;
    try {
      this.socket.write('ZZZZ LOGOUT\r\n');
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      if (!this.socket) return resolve();
      this.socket.once('close', () => resolve());
      this.socket.end();
      setTimeout(() => resolve(), 1000);
    });
    this.socket.destroy();
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.dataWaiters = [];
  }
}

function buildMessagePreview(textBody: string, htmlBody: string): string {
  const primary = normalizeWhitespace(textBody || '');
  if (primary) return toPreview(primary);
  const fromHtml = normalizeWhitespace(htmlToText(htmlBody || ''));
  if (fromHtml) return toPreview(fromHtml);
  return '';
}

async function upsertMailboxMessage(input: {
  id: string;
  mailboxUid: number;
  mailboxName: string;
  parsed: ParsedEmailMessage;
  ticketId: string | null;
  matchReason: string | null;
}): Promise<string> {
  const db = getDatabase();
  const preview = buildMessagePreview(input.parsed.textBody, input.parsed.htmlBody);
  await db.run(
    `INSERT INTO mailbox_messages (
      id,
      mailbox_uid,
      mailbox_name,
      message_id,
      in_reply_to,
      references_header,
      subject,
      from_name,
      from_email,
      to_emails,
      cc_emails,
      date_header,
      received_at,
      text_body,
      html_body,
      raw_headers,
      raw_size,
      ticket_id,
      match_reason,
      preview,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(mailbox_name, mailbox_uid)
    DO UPDATE SET
      message_id = excluded.message_id,
      in_reply_to = excluded.in_reply_to,
      references_header = excluded.references_header,
      subject = excluded.subject,
      from_name = excluded.from_name,
      from_email = excluded.from_email,
      to_emails = excluded.to_emails,
      cc_emails = excluded.cc_emails,
      date_header = excluded.date_header,
      received_at = excluded.received_at,
      text_body = excluded.text_body,
      html_body = excluded.html_body,
      raw_headers = excluded.raw_headers,
      raw_size = excluded.raw_size,
      ticket_id = excluded.ticket_id,
      match_reason = excluded.match_reason,
      preview = excluded.preview,
      updated_at = CURRENT_TIMESTAMP`,
    [
      input.id,
      input.mailboxUid,
      input.mailboxName,
      input.parsed.messageId,
      input.parsed.inReplyTo,
      input.parsed.referencesHeader,
      input.parsed.subject || '',
      input.parsed.from?.name || null,
      input.parsed.from?.email || null,
      input.parsed.to.map((entry) => entry.email).join(', ') || null,
      input.parsed.cc.map((entry) => entry.email).join(', ') || null,
      input.parsed.dateHeader || null,
      toSafeSqlDate(input.parsed.dateParsed),
      input.parsed.textBody || '',
      input.parsed.htmlBody || '',
      input.parsed.rawHeaders || '',
      Math.max(0, Number(input.parsed.rawSize || 0)),
      input.ticketId,
      input.matchReason,
      preview,
    ]
  );

  const row = await db.get(
    `SELECT id
     FROM mailbox_messages
     WHERE mailbox_name = ? AND mailbox_uid = ?
     LIMIT 1`,
    [input.mailboxName, input.mailboxUid]
  );
  return String(row?.id || input.id);
}

async function insertMailboxAttachments(
  messageId: string,
  rawMessage: Buffer,
  parsed: ParsedEmailMessage
): Promise<number> {
  const db = getDatabase();
  let created = 0;

  const emlSize = rawMessage.length;
  if (emlSize > 0 && emlSize <= MAX_SYNC_MESSAGE_SIZE_BYTES) {
    await db.run(
      `INSERT INTO mailbox_attachments (
        id,
        message_id,
        file_name,
        mime_type,
        content_disposition,
        content_id,
        byte_size,
        file_data,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        buildMailboxAttachmentId(),
        messageId,
        'original-message.eml',
        'message/rfc822',
        'attachment',
        null,
        emlSize,
        rawMessage,
      ]
    );
    created += 1;
  }

  for (const attachment of parsed.attachments) {
    const size = Number(attachment?.data?.length || 0);
    if (!size || size > MAX_STORED_ATTACHMENT_BYTES) continue;
    await db.run(
      `INSERT INTO mailbox_attachments (
        id,
        message_id,
        file_name,
        mime_type,
        content_disposition,
        content_id,
        byte_size,
        file_data,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        buildMailboxAttachmentId(),
        messageId,
        normalizeFileName(attachment.fileName, `attachment-${created + 1}.bin`),
        attachment.mimeType || DEFAULT_ATTACHMENT_MIME,
        attachment.contentDisposition || 'attachment',
        attachment.contentId || null,
        size,
        attachment.data,
      ]
    );
    created += 1;
  }

  return created;
}

async function createTicketEmailCommentIfMissing(input: {
  ticketId: string;
  messageId: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string;
  receivedAt: string | null;
  attachmentCount: number;
}): Promise<string | null> {
  const db = getDatabase();
  const existing = await db.get(
    `SELECT ticket_comment_id
     FROM mailbox_messages
     WHERE id = ?
     LIMIT 1`,
    [input.messageId]
  );
  const existingCommentId = String(existing?.ticket_comment_id || '').trim();
  if (existingCommentId) return null;

  const commentId = buildTicketCommentId();
  const sender =
    input.fromEmail && input.fromName
      ? `${input.fromName} <${input.fromEmail}>`
      : input.fromEmail || input.fromName || 'Unbekannt';
  const contentLines = [
    'E-Mail-Antwort automatisch importiert.',
    `Absender: ${sender}`,
    `Betreff: ${input.subject || '–'}`,
    input.receivedAt ? `Empfangen: ${input.receivedAt}` : '',
    `Anhänge: ${input.attachmentCount}`,
  ].filter(Boolean);

  await db.run(
    `INSERT INTO ticket_comments (
      id,
      ticket_id,
      author_type,
      author_name,
      visibility,
      comment_type,
      content,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, 'system', 'email-sync', 'internal', 'email_reply', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      commentId,
      input.ticketId,
      contentLines.join('\n'),
      JSON.stringify({
        source: 'imap_sync',
        mailboxMessageId: input.messageId,
        sender,
        subject: input.subject || null,
        attachmentCount: input.attachmentCount,
      }),
    ]
  );

  await db.run(
    `UPDATE mailbox_messages
     SET ticket_comment_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [commentId, input.messageId]
  );
  return commentId;
}

function normalizeEntityId(value: unknown): string {
  return String(value || '').trim();
}

function buildInboundSenderLabel(message: ParsedEmailMessage): string {
  const senderEmail = String(message.from?.email || '').trim();
  const senderName = String(message.from?.name || '').trim();
  if (senderEmail && senderName) {
    return `${senderName} <${senderEmail}>`;
  }
  return senderEmail || senderName || 'Unbekannt';
}

async function loadPrimaryAssignmentRecipientsForTicket(
  ticketId: string
): Promise<TicketAssignmentNotificationRecipient[]> {
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT primary_assignee_user_id, primary_assignee_org_unit_id
     FROM tickets
     WHERE id = ?
     LIMIT 1`,
    [ticketId]
  );
  if (!row) return [];

  const recipients: TicketAssignmentNotificationRecipient[] = [];
  const assigneeUserId = normalizeEntityId(row.primary_assignee_user_id);
  const assigneeOrgUnitId = normalizeEntityId(row.primary_assignee_org_unit_id);
  if (assigneeUserId) {
    recipients.push({
      type: 'user',
      id: assigneeUserId,
      roleLabel: 'Primaerzuweisung',
    });
  }
  if (assigneeOrgUnitId) {
    recipients.push({
      type: 'org_unit',
      id: assigneeOrgUnitId,
      roleLabel: 'Primaerzuweisung',
    });
  }
  return recipients;
}

async function notifyInboundMailboxMessage(input: {
  ticketId: string;
  mailboxMessageId: string;
  parsed: ParsedEmailMessage;
  receivedAt: string | null;
}): Promise<void> {
  const ticketId = normalizeEntityId(input.ticketId);
  if (!ticketId) return;

  const recipients = await loadPrimaryAssignmentRecipientsForTicket(ticketId);
  const sender = buildInboundSenderLabel(input.parsed);
  const inboundSubject = String(input.parsed.subject || '').trim();

  if (recipients.length > 0) {
    await sendTicketAssignmentEmailNotifications({
      ticketId,
      recipients,
      context: 'ticket_inbound_email',
      inboundEmail: {
        sender,
        subject: inboundSubject || null,
        receivedAt: input.receivedAt || null,
        mailboxMessageId: normalizeEntityId(input.mailboxMessageId) || null,
      },
    });
    return;
  }

  const messageParts = [
    `Zum Ticket ${ticketId} ist eine neue E-Mail eingegangen, aber es ist keine Zuweisung gesetzt.`,
    sender ? `Absender: ${sender}.` : '',
    inboundSubject ? `Betreff: ${inboundSubject}.` : '',
  ].filter(Boolean);

  await createAdminNotification({
    eventType: 'ticket_inbound_email_unassigned',
    severity: 'warning',
    roleScope: 'admin',
    title: 'E-Mail zu Ticket ohne Zuweisung',
    message: messageParts.join(' '),
    relatedTicketId: ticketId,
    context: {
      ticketId,
      mailboxMessageId: normalizeEntityId(input.mailboxMessageId) || null,
      sender: sender || null,
      emailSubject: inboundSubject || null,
      receivedAt: input.receivedAt || null,
    },
  });
}

export async function syncMailboxInbox(input?: { tenantId?: string }): Promise<MailboxSyncResult> {
  const tenantId = String(input?.tenantId || '').trim();
  const imapPayload = tenantId ? await loadImapSettingsForTenant(tenantId, false) : await loadImapSettings(false);
  const imapSettings = imapPayload.values;
  if (!parseBoolean(imapSettings.enabled, false)) {
    throw new Error('IMAP-Synchronisierung ist deaktiviert.');
  }
  const host = String(imapSettings.imapHost || '').trim();
  const user = String(imapSettings.imapUser || '').trim();
  const pass = String(imapSettings.imapPassword || '');
  const mailbox = String(imapSettings.imapMailbox || 'INBOX').trim() || 'INBOX';
  const port = Math.max(1, Math.min(65535, Number(imapSettings.imapPort || 993) || 993));
  const secure = parseBoolean(imapSettings.imapSecure, true);
  const syncLimit = Math.max(1, Math.min(500, Number(imapSettings.syncLimit || 80) || 80));

  if (!host || !user || !pass) {
    throw new Error('IMAP ist unvollständig konfiguriert (Host, Benutzer, Passwort erforderlich).');
  }

  const db = getDatabase();
  const state = await db.get(
    `SELECT MAX(mailbox_uid) AS max_uid
     FROM mailbox_messages
     WHERE mailbox_name = ?`,
    [mailbox]
  );
  const lastUid = Number(state?.max_uid || 0);
  const client = new RawImapClient();

  let searched = 0;
  let imported = 0;
  let linkedToTickets = 0;
  let skipped = 0;
  let maxUidAfterSync = lastUid;

  try {
    await client.connect({ host, port, secure });
    await client.login(user, pass);
    await client.select(mailbox);

    const uids = await client.searchUidRange(lastUid > 0 ? lastUid + 1 : 0);
    searched = uids.length;
    const selectedUids = uids.slice(-syncLimit);

    for (const uid of selectedUids) {
      maxUidAfterSync = Math.max(maxUidAfterSync, uid);
      const rawMessage = await client.fetchMessageByUid(uid);
      if (!rawMessage || rawMessage.length === 0) {
        skipped += 1;
        continue;
      }
      if (rawMessage.length > MAX_SYNC_MESSAGE_SIZE_BYTES) {
        skipped += 1;
        continue;
      }

      const existing = await db.get(
        `SELECT id, ticket_id, ticket_comment_id
         FROM mailbox_messages
         WHERE mailbox_name = ? AND mailbox_uid = ?
         LIMIT 1`,
        [mailbox, uid]
      );

      const parsed = parseEmailMessage(rawMessage);
      const ticketMatch = await resolveTicketMatch(parsed);
      const messageId = await upsertMailboxMessage({
        id: String(existing?.id || buildMailboxMessageId()),
        mailboxUid: uid,
        mailboxName: mailbox,
        parsed,
        ticketId: ticketMatch.ticketId,
        matchReason: ticketMatch.reason,
      });

      let attachmentCount = 0;
      if (!existing?.id) {
        attachmentCount = await insertMailboxAttachments(messageId, rawMessage, parsed);
        imported += 1;
      } else {
        const countRow = await db.get(
          `SELECT COUNT(*) AS count
           FROM mailbox_attachments
           WHERE message_id = ?`,
          [messageId]
        );
        attachmentCount = Number(countRow?.count || 0);
      }

      if (ticketMatch.ticketId) {
        const receivedAt = toSafeSqlDate(parsed.dateParsed);
        const commentId = await createTicketEmailCommentIfMissing({
          ticketId: ticketMatch.ticketId,
          messageId,
          fromName: parsed.from?.name || null,
          fromEmail: parsed.from?.email || null,
          subject: parsed.subject || '',
          receivedAt,
          attachmentCount,
        });
        if (commentId) {
          linkedToTickets += 1;
          try {
            await notifyInboundMailboxMessage({
              ticketId: ticketMatch.ticketId,
              mailboxMessageId: messageId,
              parsed,
              receivedAt,
            });
          } catch (notificationError) {
            console.warn('Inbound ticket email notification failed:', notificationError);
          }
        }
      }
    }
  } finally {
    await client.close();
  }

  return {
    syncedMailbox: mailbox,
    searched,
    imported,
    linkedToTickets,
    skipped,
    maxUidAfterSync,
  };
}

function normalizeMailboxMessageRow(row: any): MailboxMessageSummary {
  return {
    id: String(row?.id || ''),
    mailboxUid: Number(row?.mailbox_uid || 0),
    mailboxName: String(row?.mailbox_name || ''),
    messageId: row?.message_id ? String(row.message_id) : null,
    inReplyTo: row?.in_reply_to ? String(row.in_reply_to) : null,
    referencesHeader: row?.references_header ? String(row.references_header) : null,
    subject: String(row?.subject || ''),
    fromName: row?.from_name ? String(row.from_name) : null,
    fromEmail: row?.from_email ? String(row.from_email) : null,
    toEmails: row?.to_emails ? String(row.to_emails) : null,
    ccEmails: row?.cc_emails ? String(row.cc_emails) : null,
    dateHeader: row?.date_header ? String(row.date_header) : null,
    receivedAt: row?.received_at ? String(row.received_at) : null,
    ticketId: row?.ticket_id ? String(row.ticket_id) : null,
    ticketCommentId: row?.ticket_comment_id ? String(row.ticket_comment_id) : null,
    matchReason: row?.match_reason ? String(row.match_reason) : null,
    preview: String(row?.preview || ''),
    hasHtmlBody: String(row?.html_body || '').trim().length > 0,
    attachmentCount: Number(row?.attachment_count || 0),
    createdAt: row?.created_at ? String(row.created_at) : null,
    updatedAt: row?.updated_at ? String(row.updated_at) : null,
  };
}

function normalizeMailboxAttachmentRow(row: any): MailboxAttachmentSummary {
  return {
    id: String(row?.id || ''),
    messageId: String(row?.message_id || ''),
    fileName: String(row?.file_name || 'attachment.bin'),
    mimeType: String(row?.mime_type || DEFAULT_ATTACHMENT_MIME),
    byteSize: Number(row?.byte_size || 0),
    contentDisposition: String(row?.content_disposition || 'attachment'),
    contentId: row?.content_id ? String(row.content_id) : null,
    createdAt: row?.created_at ? String(row.created_at) : null,
  };
}

export async function listMailboxMessages(input?: {
  limit?: number;
  offset?: number;
  ticketId?: string;
  query?: string;
}): Promise<MailboxListResult> {
  const db = getDatabase();
  const limit = Math.max(1, Math.min(300, Math.floor(Number(input?.limit || 80) || 80)));
  const offset = Math.max(0, Math.floor(Number(input?.offset || 0) || 0));
  const ticketId = String(input?.ticketId || '').trim();
  const query = String(input?.query || '').trim();

  const where: string[] = [];
  const params: any[] = [];

  if (ticketId) {
    where.push('m.ticket_id = ?');
    params.push(ticketId);
  }
  if (query) {
    where.push(
      `(LOWER(COALESCE(m.subject, '')) LIKE LOWER(?) OR LOWER(COALESCE(m.from_email, '')) LIKE LOWER(?) OR LOWER(COALESCE(m.preview, '')) LIKE LOWER(?) OR LOWER(COALESCE(m.ticket_id, '')) LIKE LOWER(?))`
    );
    const wildcard = `%${query}%`;
    params.push(wildcard, wildcard, wildcard, wildcard);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.all(
    `SELECT
       m.*,
       COALESCE((
         SELECT COUNT(*)
         FROM mailbox_attachments a
         WHERE a.message_id = m.id
       ), 0) AS attachment_count
     FROM mailbox_messages m
     ${whereSql}
     ORDER BY datetime(COALESCE(m.received_at, m.created_at)) DESC, datetime(m.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const countRow = await db.get(
    `SELECT COUNT(*) AS total
     FROM mailbox_messages m
     ${whereSql}`,
    params
  );

  return {
    items: (rows || []).map((row: any) => normalizeMailboxMessageRow(row)),
    total: Number(countRow?.total || 0),
    limit,
    offset,
  };
}

export async function getMailboxMessageById(messageId: string): Promise<MailboxMessageDetail | null> {
  const db = getDatabase();
  const row = await db.get(
    `SELECT
       m.*,
       COALESCE((
         SELECT COUNT(*)
         FROM mailbox_attachments a
         WHERE a.message_id = m.id
       ), 0) AS attachment_count
     FROM mailbox_messages m
     WHERE m.id = ?
     LIMIT 1`,
    [messageId]
  );
  if (!row) return null;
  const attachmentRows = await db.all(
    `SELECT id, message_id, file_name, mime_type, byte_size, content_disposition, content_id, created_at
     FROM mailbox_attachments
     WHERE message_id = ?
     ORDER BY datetime(created_at) ASC`,
    [messageId]
  );
  const base = normalizeMailboxMessageRow(row);
  return {
    ...base,
    textBody: String(row?.text_body || ''),
    htmlBody: String(row?.html_body || ''),
    attachments: (attachmentRows || []).map((attachment: any) => normalizeMailboxAttachmentRow(attachment)),
  };
}

export async function getMailboxAttachmentBinary(
  messageId: string,
  attachmentId: string
): Promise<{
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  data: Buffer;
} | null> {
  const db = getDatabase();
  const row = await db.get(
    `SELECT id, message_id, file_name, mime_type, byte_size, file_data
     FROM mailbox_attachments
     WHERE id = ? AND message_id = ?
     LIMIT 1`,
    [attachmentId, messageId]
  );
  if (!row) return null;
  const data =
    row.file_data instanceof Buffer
      ? row.file_data
      : row.file_data instanceof Uint8Array
      ? Buffer.from(row.file_data)
      : typeof row.file_data === 'string'
      ? Buffer.from(row.file_data, 'base64')
      : null;
  if (!data) return null;
  return {
    id: String(row.id || ''),
    messageId: String(row.message_id || ''),
    fileName: String(row.file_name || 'attachment.bin'),
    mimeType: String(row.mime_type || DEFAULT_ATTACHMENT_MIME),
    byteSize: Number(row.byte_size || data.length || 0),
    data,
  };
}

export async function listMailboxMessagesForTicket(ticketId: string): Promise<MailboxMessageDetail[]> {
  const ticket = String(ticketId || '').trim();
  if (!ticket) return [];
  const db = getDatabase();
  const messageRows = await db.all(
    `SELECT
       m.*,
       COALESCE((
         SELECT COUNT(*)
         FROM mailbox_attachments a
         WHERE a.message_id = m.id
       ), 0) AS attachment_count
     FROM mailbox_messages m
     WHERE m.ticket_id = ?
     ORDER BY datetime(COALESCE(m.received_at, m.created_at)) DESC, datetime(m.created_at) DESC`,
    [ticket]
  );
  if (!messageRows || messageRows.length === 0) return [];

  const messageIds = messageRows
    .map((row: any) => String(row?.id || '').trim())
    .filter(Boolean);
  if (messageIds.length === 0) return [];

  const placeholders = messageIds.map(() => '?').join(', ');
  const attachmentRows = await db.all(
    `SELECT id, message_id, file_name, mime_type, byte_size, content_disposition, content_id, created_at
     FROM mailbox_attachments
     WHERE message_id IN (${placeholders})
     ORDER BY datetime(created_at) ASC`,
    messageIds
  );
  const attachmentsByMessageId = new Map<string, MailboxAttachmentSummary[]>();
  for (const row of attachmentRows || []) {
    const normalized = normalizeMailboxAttachmentRow(row);
    const list = attachmentsByMessageId.get(normalized.messageId) || [];
    list.push(normalized);
    attachmentsByMessageId.set(normalized.messageId, list);
  }

  return messageRows.map((row: any) => {
    const base = normalizeMailboxMessageRow(row);
    return {
      ...base,
      textBody: String(row?.text_body || ''),
      htmlBody: String(row?.html_body || ''),
      attachments: attachmentsByMessageId.get(base.id) || [],
    };
  });
}

const MAILBOX_SYNC_WORKER_DEFAULT_INTERVAL_MINUTES = 2;
const MAILBOX_SYNC_WORKER_MIN_INTERVAL_MINUTES = 1;
const MAILBOX_SYNC_WORKER_MAX_INTERVAL_MINUTES = 1440;
let mailboxSyncWorkerTimer: NodeJS.Timeout | null = null;
let mailboxSyncWorkerRunning = false;
let mailboxSyncWorkerStarted = false;

function normalizeSyncIntervalMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return MAILBOX_SYNC_WORKER_DEFAULT_INTERVAL_MINUTES;
  }
  return Math.max(
    MAILBOX_SYNC_WORKER_MIN_INTERVAL_MINUTES,
    Math.min(MAILBOX_SYNC_WORKER_MAX_INTERVAL_MINUTES, Math.floor(parsed))
  );
}

async function resolveMailboxSyncWorkerIntervalMs(): Promise<number> {
  try {
    const { values } = await loadImapSettings(false);
    const minutes = normalizeSyncIntervalMinutes(values.syncIntervalMinutes);
    return minutes * 60 * 1000;
  } catch {
    return MAILBOX_SYNC_WORKER_DEFAULT_INTERVAL_MINUTES * 60 * 1000;
  }
}

async function runMailboxSyncWorkerTick(): Promise<void> {
  if (mailboxSyncWorkerRunning) return;
  mailboxSyncWorkerRunning = true;
  try {
    const { values: imapSettings } = await loadImapSettings(false);
    if (!parseBoolean(imapSettings.enabled, false)) {
      return;
    }
    await syncMailboxInbox();
  } catch (error) {
    console.warn('Mailbox sync worker tick failed:', error);
  } finally {
    mailboxSyncWorkerRunning = false;
  }
}

async function scheduleNextMailboxSyncWorkerTick(): Promise<void> {
  if (!mailboxSyncWorkerStarted) return;
  const intervalMs = await resolveMailboxSyncWorkerIntervalMs();
  if (mailboxSyncWorkerTimer) {
    clearTimeout(mailboxSyncWorkerTimer);
    mailboxSyncWorkerTimer = null;
  }
  mailboxSyncWorkerTimer = setTimeout(() => {
    void runMailboxSyncWorkerCycle();
  }, intervalMs);
}

async function runMailboxSyncWorkerCycle(): Promise<void> {
  await runMailboxSyncWorkerTick();
  await scheduleNextMailboxSyncWorkerTick();
}

export function startMailboxSyncWorker(): void {
  if (mailboxSyncWorkerStarted) return;
  mailboxSyncWorkerStarted = true;
  void runMailboxSyncWorkerCycle();
  console.log(
    `Mailbox sync worker started (dynamic interval, default: ${MAILBOX_SYNC_WORKER_DEFAULT_INTERVAL_MINUTES} minute(s))`
  );
}

export async function getMailboxStats(): Promise<{
  totalMessages: number;
  linkedMessages: number;
  totalAttachments: number;
}> {
  const db = getDatabase();
  const [messageCountRow, linkedCountRow, attachmentCountRow] = await Promise.all([
    db.get(`SELECT COUNT(*) AS total FROM mailbox_messages`),
    db.get(`SELECT COUNT(*) AS total FROM mailbox_messages WHERE ticket_id IS NOT NULL AND TRIM(ticket_id) <> ''`),
    db.get(`SELECT COUNT(*) AS total FROM mailbox_attachments`),
  ]);
  return {
    totalMessages: Number(messageCountRow?.total || 0),
    linkedMessages: Number(linkedCountRow?.total || 0),
    totalAttachments: Number(attachmentCountRow?.total || 0),
  };
}

export function generateMailboxMessageFingerprint(input: {
  messageId?: string | null;
  subject?: string | null;
  fromEmail?: string | null;
  dateHeader?: string | null;
}): string {
  const source = [
    String(input.messageId || '').trim().toLowerCase(),
    String(input.subject || '').trim().toLowerCase(),
    String(input.fromEmail || '').trim().toLowerCase(),
    String(input.dateHeader || '').trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(source).digest('hex');
}
