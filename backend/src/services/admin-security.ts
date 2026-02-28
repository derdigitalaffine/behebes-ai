/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { loadConfig } from '../config.js';
import type { AppDatabase } from '../database.js';
import { formatSqlDateTime } from '../utils/sql-date.js';

const config = loadConfig();

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_LOOKUP = BASE32_ALPHABET.split('').reduce<Record<string, number>>((acc, ch, idx) => {
  acc[ch] = idx;
  return acc;
}, {});

export type AdminAuthChallengePurpose =
  | 'passkey_registration'
  | 'passkey_authentication'
  | 'totp_login'
  | 'totp_setup';

export interface AdminAuthChallenge {
  id: string;
  purpose: AdminAuthChallengePurpose;
  adminUserId: string | null;
  challenge: string;
  payload: Record<string, any>;
  expiresAt: string;
  consumedAt: string | null;
}

export interface AdminPasskeyRecord {
  id: string;
  adminUserId: string;
  label: string;
  credentialId: string;
  publicKeySpki: string;
  coseAlgorithm: number;
  signCount: number;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AdminTotpFactorRecord {
  id: string;
  adminUserId: string;
  secretEncrypted: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

function parseJsonObject(input: unknown): Record<string, any> {
  if (!input) return {};
  if (typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, any>;
  }
  try {
    const parsed = JSON.parse(String(input));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // Ignore invalid payloads.
  }
  return {};
}

function normalizeOrigin(input: string): string {
  try {
    const parsed = new URL(String(input || '').trim());
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return '';
  }
}

function safeTimingEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function normalizeCode(input: unknown): string {
  return String(input || '')
    .trim()
    .replace(/\s+/g, '');
}

export function base64UrlEncode(input: string | Buffer | Uint8Array): string {
  const asBuffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return asBuffer.toString('base64url');
}

export function base64UrlDecode(value: unknown): Buffer {
  return Buffer.from(String(value || '').trim(), 'base64url');
}

export function createRandomChallenge(size = 32): string {
  return base64UrlEncode(crypto.randomBytes(Math.max(16, size)));
}

function mapChallengeRow(row: any): AdminAuthChallenge | null {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    purpose: String(row.purpose || '') as AdminAuthChallengePurpose,
    adminUserId: row.admin_user_id ? String(row.admin_user_id) : null,
    challenge: String(row.challenge || ''),
    payload: parseJsonObject(row.payload_json),
    expiresAt: String(row.expires_at || ''),
    consumedAt: row.consumed_at ? String(row.consumed_at) : null,
  };
}

function mapPasskeyRow(row: any): AdminPasskeyRecord | null {
  if (!row) return null;
  const transportsRaw = String(row.transports_json || '').trim();
  let transports: string[] = [];
  if (transportsRaw) {
    try {
      const parsed = JSON.parse(transportsRaw);
      if (Array.isArray(parsed)) {
        transports = parsed
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
          .slice(0, 8);
      }
    } catch {
      transports = [];
    }
  }
  return {
    id: String(row.id || ''),
    adminUserId: String(row.admin_user_id || ''),
    label: String(row.label || '').trim(),
    credentialId: String(row.credential_id || ''),
    publicKeySpki: String(row.public_key_spki || ''),
    coseAlgorithm: Number.isFinite(Number(row.cose_algorithm)) ? Number(row.cose_algorithm) : -7,
    signCount: Number.isFinite(Number(row.sign_count)) ? Number(row.sign_count) : 0,
    transports,
    createdAt: String(row.created_at || ''),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
  };
}

function mapTotpRow(row: any): AdminTotpFactorRecord | null {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    adminUserId: String(row.admin_user_id || ''),
    secretEncrypted: String(row.secret_encrypted || ''),
    enabled: Number(row.enabled || 0) === 1,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    disabledAt: row.disabled_at ? String(row.disabled_at) : null,
  };
}

export async function createAdminAuthChallenge(
  db: AppDatabase,
  input: {
    purpose: AdminAuthChallengePurpose;
    adminUserId?: string | null;
    challenge?: string;
    payload?: Record<string, any>;
    ttlSeconds?: number;
  }
): Promise<AdminAuthChallenge> {
  const id = uuidv4();
  const challenge = String(input.challenge || createRandomChallenge()).trim();
  const ttlSeconds = Number.isFinite(input.ttlSeconds) ? Number(input.ttlSeconds) : 300;
  const expiresAt = formatSqlDateTime(new Date(Date.now() + Math.max(30, ttlSeconds) * 1000));

  await db.run(
    `INSERT INTO admin_auth_challenges (id, purpose, admin_user_id, challenge, payload_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.purpose,
      input.adminUserId ? String(input.adminUserId).trim() : null,
      challenge,
      JSON.stringify(input.payload || {}),
      expiresAt,
    ]
  );

  return {
    id,
    purpose: input.purpose,
    adminUserId: input.adminUserId ? String(input.adminUserId).trim() : null,
    challenge,
    payload: input.payload || {},
    expiresAt,
    consumedAt: null,
  };
}

export async function consumeAdminAuthChallenge(
  db: AppDatabase,
  input: {
    challengeId: string;
    purpose: AdminAuthChallengePurpose;
    adminUserId?: string | null;
  }
): Promise<AdminAuthChallenge | null> {
  const challengeId = String(input.challengeId || '').trim();
  if (!challengeId) return null;

  const row = await db.get<any>(
    `SELECT id, purpose, admin_user_id, challenge, payload_json, expires_at, consumed_at
     FROM admin_auth_challenges
     WHERE id = ?
       AND purpose = ?
       AND consumed_at IS NULL
       AND datetime(expires_at) > datetime('now')
     LIMIT 1`,
    [challengeId, input.purpose]
  );
  const mapped = mapChallengeRow(row);
  if (!mapped) return null;

  const requestedUser = String(input.adminUserId || '').trim();
  if (requestedUser && mapped.adminUserId && mapped.adminUserId !== requestedUser) {
    return null;
  }
  if (requestedUser && !mapped.adminUserId) {
    return null;
  }

  const result = await db.run(
    `UPDATE admin_auth_challenges
     SET consumed_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND consumed_at IS NULL`,
    [challengeId]
  );
  if (!result?.changes) return null;

  mapped.consumedAt = formatSqlDateTime(new Date());
  return mapped;
}

export async function listAdminPasskeys(
  db: AppDatabase,
  adminUserId: string,
  options?: {
    includeRevoked?: boolean;
  }
): Promise<AdminPasskeyRecord[]> {
  const rows = await db.all<any>(
    `SELECT id, admin_user_id, label, credential_id, public_key_spki, cose_algorithm,
            sign_count, transports_json, created_at, last_used_at, revoked_at
     FROM admin_passkeys
     WHERE admin_user_id = ?
       ${options?.includeRevoked ? '' : 'AND revoked_at IS NULL'}
     ORDER BY datetime(created_at) DESC`,
    [adminUserId]
  );
  return (rows || [])
    .map((row: any) => mapPasskeyRow(row))
    .filter((row: AdminPasskeyRecord | null): row is AdminPasskeyRecord => !!row);
}

export async function getAdminPasskeyByCredentialId(
  db: AppDatabase,
  credentialId: string
): Promise<AdminPasskeyRecord | null> {
  const row = await db.get<any>(
    `SELECT id, admin_user_id, label, credential_id, public_key_spki, cose_algorithm,
            sign_count, transports_json, created_at, last_used_at, revoked_at
     FROM admin_passkeys
     WHERE credential_id = ?
       AND revoked_at IS NULL
     LIMIT 1`,
    [credentialId]
  );
  return mapPasskeyRow(row);
}

export async function createAdminPasskey(
  db: AppDatabase,
  input: {
    adminUserId: string;
    credentialId: string;
    publicKeySpki: string;
    coseAlgorithm: number;
    label?: string;
    transports?: string[];
    createdByAdminId?: string | null;
  }
): Promise<AdminPasskeyRecord> {
  const id = uuidv4();
  const label = String(input.label || '').trim().slice(0, 100);
  const transports = Array.isArray(input.transports)
    ? input.transports
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  await db.run(
    `INSERT INTO admin_passkeys (
      id, admin_user_id, label, credential_id, public_key_spki, cose_algorithm, sign_count,
      transports_json, created_by_admin_id
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      input.adminUserId,
      label || null,
      input.credentialId,
      input.publicKeySpki,
      Number.isFinite(input.coseAlgorithm) ? Math.trunc(input.coseAlgorithm) : -7,
      JSON.stringify(transports),
      input.createdByAdminId ? String(input.createdByAdminId).trim() : null,
    ]
  );

  const created = await db.get<any>(
    `SELECT id, admin_user_id, label, credential_id, public_key_spki, cose_algorithm,
            sign_count, transports_json, created_at, last_used_at, revoked_at
     FROM admin_passkeys
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  const mapped = mapPasskeyRow(created);
  if (!mapped) {
    throw new Error('Passkey konnte nicht gespeichert werden.');
  }
  return mapped;
}

export async function updateAdminPasskeyUsage(
  db: AppDatabase,
  input: {
    passkeyId: string;
    signCount: number;
  }
): Promise<void> {
  await db.run(
    `UPDATE admin_passkeys
     SET sign_count = ?,
         last_used_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [Math.max(0, Math.trunc(input.signCount)), input.passkeyId]
  );
}

export async function revokeAdminPasskey(
  db: AppDatabase,
  input: {
    passkeyId: string;
    adminUserId: string;
    revokedByAdminId: string;
  }
): Promise<boolean> {
  const result = await db.run(
    `UPDATE admin_passkeys
     SET revoked_at = CURRENT_TIMESTAMP,
         revoked_by_admin_id = ?
     WHERE id = ?
       AND admin_user_id = ?
       AND revoked_at IS NULL`,
    [input.revokedByAdminId, input.passkeyId, input.adminUserId]
  );
  return Number(result?.changes || 0) > 0;
}

export async function getAdminTotpFactor(
  db: AppDatabase,
  adminUserId: string
): Promise<AdminTotpFactorRecord | null> {
  const row = await db.get<any>(
    `SELECT id, admin_user_id, secret_encrypted, enabled, created_at, updated_at, disabled_at
     FROM admin_totp_factors
     WHERE admin_user_id = ?
     LIMIT 1`,
    [adminUserId]
  );
  return mapTotpRow(row);
}

export async function isAdminTotpEnabled(db: AppDatabase, adminUserId: string): Promise<boolean> {
  const row = await db.get<any>(
    `SELECT enabled
     FROM admin_totp_factors
     WHERE admin_user_id = ?
       AND enabled = 1
     LIMIT 1`,
    [adminUserId]
  );
  return Number(row?.enabled || 0) === 1;
}

export async function saveAdminTotpFactor(
  db: AppDatabase,
  input: {
    adminUserId: string;
    secretBase32: string;
    enabled: boolean;
    updatedByAdminId?: string | null;
  }
): Promise<void> {
  const existing = await db.get<any>(
    `SELECT id
     FROM admin_totp_factors
     WHERE admin_user_id = ?
     LIMIT 1`,
    [input.adminUserId]
  );
  const encrypted = encryptTotpSecret(String(input.secretBase32 || '').trim().toUpperCase());
  if (existing?.id) {
    await db.run(
      `UPDATE admin_totp_factors
       SET secret_encrypted = ?,
           enabled = ?,
           disabled_at = ?,
           updated_by_admin_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        encrypted,
        input.enabled ? 1 : 0,
        input.enabled ? null : formatSqlDateTime(new Date()),
        input.updatedByAdminId ? String(input.updatedByAdminId).trim() : null,
        String(existing.id),
      ]
    );
    return;
  }

  await db.run(
    `INSERT INTO admin_totp_factors (
      id, admin_user_id, secret_encrypted, enabled, disabled_at, updated_by_admin_id
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      input.adminUserId,
      encrypted,
      input.enabled ? 1 : 0,
      input.enabled ? null : formatSqlDateTime(new Date()),
      input.updatedByAdminId ? String(input.updatedByAdminId).trim() : null,
    ]
  );
}

export async function disableAdminTotpFactor(
  db: AppDatabase,
  input: {
    adminUserId: string;
    updatedByAdminId?: string | null;
  }
): Promise<boolean> {
  const result = await db.run(
    `UPDATE admin_totp_factors
     SET enabled = 0,
         disabled_at = CURRENT_TIMESTAMP,
         updated_by_admin_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE admin_user_id = ?
       AND enabled = 1`,
    [input.updatedByAdminId ? String(input.updatedByAdminId).trim() : null, input.adminUserId]
  );
  return Number(result?.changes || 0) > 0;
}

export async function verifyAdminTotpCode(
  db: AppDatabase,
  input: {
    adminUserId: string;
    code: string;
    window?: number;
  }
): Promise<boolean> {
  const factor = await getAdminTotpFactor(db, input.adminUserId);
  if (!factor || !factor.enabled) return false;
  let secret = '';
  try {
    secret = decryptTotpSecret(factor.secretEncrypted);
  } catch {
    return false;
  }
  return verifyTotpCode(secret, input.code, { window: input.window ?? 1 });
}

export function cleanupAllowedOrigins(origins: string[]): string[] {
  const set = new Set<string>();
  for (const origin of origins || []) {
    const normalized = normalizeOrigin(origin);
    if (normalized) set.add(normalized);
  }
  return Array.from(set);
}

export function deriveRelyingPartyId(hostHeader: string): string {
  const host = String(hostHeader || '')
    .split(',')
    .map((entry) => entry.trim())
    .find(Boolean) || '';
  if (!host) return 'localhost';
  if (host.startsWith('[')) {
    const closing = host.indexOf(']');
    if (closing > 0) {
      return host.slice(1, closing).toLowerCase();
    }
  }
  return host.replace(/:\d+$/, '').toLowerCase();
}

function challengeMatches(received: string, expected: string): boolean {
  const r = String(received || '').trim();
  const e = String(expected || '').trim();
  if (!r || !e) return false;
  try {
    return safeTimingEqual(base64UrlDecode(r), base64UrlDecode(e));
  } catch {
    return r === e;
  }
}

function ensureAllowedOrigin(origin: string, allowedOrigins: string[]) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    throw new Error('WebAuthn-Origin fehlt oder ist ungültig.');
  }
  const normalizedAllowed = cleanupAllowedOrigins(allowedOrigins);
  if (normalizedAllowed.length === 0) {
    throw new Error('Keine erlaubten WebAuthn-Origins konfiguriert.');
  }
  if (!normalizedAllowed.includes(normalizedOrigin)) {
    throw new Error(`WebAuthn-Origin nicht erlaubt: ${normalizedOrigin}`);
  }
}

function parseClientData(clientDataJSONB64: string): {
  type: string;
  challenge: string;
  origin: string;
} {
  const rawBuffer = base64UrlDecode(clientDataJSONB64);
  const parsed = JSON.parse(rawBuffer.toString('utf8')) as Record<string, any>;
  return {
    type: String(parsed?.type || ''),
    challenge: String(parsed?.challenge || ''),
    origin: String(parsed?.origin || ''),
  };
}

export function verifyPasskeyRegistrationClientData(input: {
  clientDataJSON: string;
  expectedChallenge: string;
  allowedOrigins: string[];
}) {
  const clientData = parseClientData(input.clientDataJSON);
  if (clientData.type !== 'webauthn.create') {
    throw new Error('Ungültiger WebAuthn-Typ für Registrierung.');
  }
  if (!challengeMatches(clientData.challenge, input.expectedChallenge)) {
    throw new Error('WebAuthn-Challenge stimmt nicht überein.');
  }
  ensureAllowedOrigin(clientData.origin, input.allowedOrigins);
}

function normalizeCoseAlgorithm(input: unknown): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return -7;
  return Math.trunc(parsed);
}

function verifySignature(input: {
  signedData: Buffer;
  signature: Buffer;
  publicKeySpki: Buffer;
  coseAlgorithm: number;
}): boolean {
  const verifyWith = (algorithm: string | null): boolean => {
    try {
      return crypto.verify(
        algorithm as any,
        input.signedData,
        {
          key: input.publicKeySpki,
          format: 'der',
          type: 'spki',
        },
        input.signature
      );
    } catch {
      return false;
    }
  };

  const alg = normalizeCoseAlgorithm(input.coseAlgorithm);
  if (alg === -8) {
    return verifyWith(null);
  }
  if (alg === -257 || alg === -37 || alg === -7) {
    return verifyWith('sha256');
  }
  return verifyWith('sha256');
}

export function verifyPasskeyAssertion(input: {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  expectedChallenge: string;
  expectedRpId: string;
  allowedOrigins: string[];
  publicKeySpki: string;
  coseAlgorithm: number;
  requireUserVerification?: boolean;
}): {
  signCount: number;
  userPresent: boolean;
  userVerified: boolean;
} {
  const clientDataBuffer = base64UrlDecode(input.clientDataJSON);
  const clientData = JSON.parse(clientDataBuffer.toString('utf8')) as Record<string, any>;
  if (String(clientData?.type || '') !== 'webauthn.get') {
    throw new Error('Ungültiger WebAuthn-Typ für Anmeldung.');
  }
  if (!challengeMatches(String(clientData?.challenge || ''), input.expectedChallenge)) {
    throw new Error('WebAuthn-Challenge stimmt nicht überein.');
  }
  ensureAllowedOrigin(String(clientData?.origin || ''), input.allowedOrigins);

  const authenticatorData = base64UrlDecode(input.authenticatorData);
  if (authenticatorData.length < 37) {
    throw new Error('Ungültige WebAuthn-Authenticatordaten.');
  }
  const rpIdHash = authenticatorData.subarray(0, 32);
  const flags = authenticatorData[32];
  const signCount = authenticatorData.readUInt32BE(33);
  const expectedRpIdHash = crypto.createHash('sha256').update(String(input.expectedRpId || '')).digest();

  if (!safeTimingEqual(rpIdHash, expectedRpIdHash)) {
    throw new Error('WebAuthn-RP-ID stimmt nicht überein.');
  }

  const userPresent = (flags & 0x01) !== 0;
  const userVerified = (flags & 0x04) !== 0;
  if (!userPresent) {
    throw new Error('Passkey-Anmeldung nicht bestätigt (UP flag fehlt).');
  }
  if (input.requireUserVerification && !userVerified) {
    throw new Error('Passkey-Anmeldung erfordert Benutzerverifikation (UV flag fehlt).');
  }

  const signatureBase = Buffer.concat([
    authenticatorData,
    crypto.createHash('sha256').update(clientDataBuffer).digest(),
  ]);
  const signature = base64UrlDecode(input.signature);
  const publicKeySpki = base64UrlDecode(input.publicKeySpki);

  if (
    !verifySignature({
      signedData: signatureBase,
      signature,
      publicKeySpki,
      coseAlgorithm: normalizeCoseAlgorithm(input.coseAlgorithm),
    })
  ) {
    throw new Error('Passkey-Signatur konnte nicht verifiziert werden.');
  }

  return {
    signCount,
    userPresent,
    userVerified,
  };
}

function randomBase32Secret(bytes = 20): string {
  const source = crypto.randomBytes(Math.max(10, bytes));
  let bits = '';
  for (const value of source) {
    bits += value.toString(2).padStart(8, '0');
  }

  let output = '';
  for (let idx = 0; idx < bits.length; idx += 5) {
    const chunk = bits.slice(idx, idx + 5);
    if (chunk.length < 5) {
      output += BASE32_ALPHABET[parseInt(chunk.padEnd(5, '0'), 2)];
    } else {
      output += BASE32_ALPHABET[parseInt(chunk, 2)];
    }
  }

  return output.replace(/=+$/g, '');
}

function decodeBase32(secret: string): Buffer {
  const normalized = String(secret || '')
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/[^A-Z2-7]/g, '');
  if (!normalized) return Buffer.alloc(0);

  let bits = '';
  for (const char of normalized) {
    const value = BASE32_LOOKUP[char];
    if (typeof value !== 'number') {
      throw new Error('Ungültiges Base32-Zeichen.');
    }
    bits += value.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let idx = 0; idx + 8 <= bits.length; idx += 8) {
    bytes.push(parseInt(bits.slice(idx, idx + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateHotp(secretBase32: string, counter: number, digits = 6): string {
  const secret = decodeBase32(secretBase32);
  if (secret.length === 0) {
    throw new Error('Leeres TOTP-Secret.');
  }

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = 10 ** Math.max(6, digits);
  return String(binaryCode % mod).padStart(Math.max(6, digits), '0');
}

export function generateTotpSecret(): string {
  return randomBase32Secret(20);
}

export function buildTotpOtpAuthUri(input: {
  issuer: string;
  accountName: string;
  secret: string;
}): string {
  const issuer = String(input.issuer || 'behebes.AI').trim() || 'behebes.AI';
  const accountName = String(input.accountName || 'admin').trim() || 'admin';
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const secret = String(input.secret || '').trim().toUpperCase();
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(
    issuer
  )}&algorithm=SHA1&digits=6&period=30`;
}

export function verifyTotpCode(
  secret: string,
  codeInput: unknown,
  options?: {
    window?: number;
    stepSeconds?: number;
    digits?: number;
    nowMs?: number;
  }
): boolean {
  const code = normalizeCode(codeInput);
  if (!/^\d{6,8}$/.test(code)) return false;

  const window = Number.isFinite(options?.window) ? Number(options?.window) : 1;
  const stepSeconds = Number.isFinite(options?.stepSeconds) ? Number(options?.stepSeconds) : 30;
  const digits = Number.isFinite(options?.digits) ? Number(options?.digits) : 6;
  const nowMs = Number.isFinite(options?.nowMs) ? Number(options?.nowMs) : Date.now();
  const counter = Math.floor(nowMs / 1000 / Math.max(15, stepSeconds));

  for (let drift = -Math.max(0, window); drift <= Math.max(0, window); drift += 1) {
    try {
      const expected = generateHotp(secret, counter + drift, digits);
      if (safeTimingEqual(Buffer.from(code), Buffer.from(expected))) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

function deriveTotpEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(String(config.jwtSecret || 'behebes-ai')).digest();
}

export function encryptTotpSecret(secret: string): string {
  const plain = Buffer.from(String(secret || '').trim(), 'utf8');
  if (plain.length === 0) {
    throw new Error('Leeres TOTP-Secret kann nicht verschlüsselt werden.');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveTotpEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return base64UrlEncode(Buffer.concat([iv, tag, encrypted]));
}

export function decryptTotpSecret(value: string): string {
  const payload = base64UrlDecode(value);
  if (payload.length <= 28) {
    throw new Error('Ungültiges TOTP-Secret-Format.');
  }
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveTotpEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString('utf8');
}
