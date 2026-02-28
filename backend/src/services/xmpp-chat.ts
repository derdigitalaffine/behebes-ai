/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * XMPP chat integration helpers (ejabberd + xmpp.js clients)
 */

import crypto from 'crypto';
import axios from 'axios';
import { loadConfig } from '../config.js';
import { getDatabase } from '../database.js';

interface EjabberdApiError extends Error {
  response?: {
    status?: number;
    data?: any;
  };
}

export interface XmppAccountCredentials {
  username: string;
  jid: string;
  password: string;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function toSlug(value: string): string {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return normalized || 'user';
}

function toNodePart(value: string, fallback = 'room'): string {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (normalized || fallback).slice(0, 63);
}

function deriveStableHash(value: string, size = 8): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, Math.max(4, size));
}

export function deriveXmppPassword(adminUserId: string): string {
  const config = loadConfig();
  const source = `${config.jwtSecret}::xmpp::${normalizeText(adminUserId)}`;
  return crypto.createHash('sha256').update(source).digest('base64url').slice(0, 48);
}

function buildApiAuth() {
  const config = loadConfig();
  return {
    apiUrl: String(config.xmpp.apiUrl || '').replace(/\/+$/, ''),
    apiUser: String(config.xmpp.apiUser || '').trim(),
    apiPassword: String(config.xmpp.apiPassword || ''),
    domain: String(config.xmpp.domain || '').trim(),
  };
}

function isUnauthorizedApiError(error: any): boolean {
  const err = error as EjabberdApiError;
  const status = Number(err?.response?.status || 0);
  return status === 401 || status === 403;
}

async function callEjabberdApi(command: string, payload: Record<string, any>): Promise<any> {
  const config = loadConfig();
  if (!config.xmpp.enabled) return null;

  const { apiUrl, apiUser, apiPassword, domain } = buildApiAuth();
  if (!apiUrl) {
    throw new Error('XMPP API URL ist nicht konfiguriert.');
  }

  const endpoint = `${apiUrl}/${encodeURIComponent(command)}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (domain) {
    headers.Host = domain;
  }

  const attemptWithAuth = !!apiUser && !!apiPassword;
  const attempts: Array<{ useAuth: boolean }> = attemptWithAuth ? [{ useAuth: true }, { useAuth: false }] : [{ useAuth: false }];
  let lastError: any = null;

  for (const attempt of attempts) {
    try {
      const response = await axios.post(endpoint, payload, {
        timeout: 10000,
        auth: attempt.useAuth
          ? {
              username: apiUser,
              password: apiPassword,
            }
          : undefined,
        headers,
      });
      return response.data;
    } catch (error: any) {
      lastError = error;
      if (!attempt.useAuth) {
        break;
      }
      if (!isUnauthorizedApiError(error)) {
        break;
      }
    }
  }

  throw lastError || new Error('XMPP API Aufruf fehlgeschlagen.');
}

function isAccountAlreadyExistsError(error: any): boolean {
  const err = error as EjabberdApiError;
  const status = Number(err?.response?.status || 0);
  const message = String(err?.response?.data?.error || err?.response?.data?.message || err?.message || '').toLowerCase();
  return (
    status === 409 ||
    status === 400 ||
    message.includes('already') ||
    message.includes('exists') ||
    message.includes('registered') ||
    message.includes('conflict')
  );
}

async function upsertXmppAccountMapping(adminUserId: string, preferredUsername: string): Promise<string> {
  const userId = normalizeText(adminUserId);
  if (!userId) throw new Error('adminUserId fehlt.');

  const db = getDatabase();
  const existing = await db.get<any>(
    `SELECT xmpp_username
     FROM admin_chat_accounts
     WHERE admin_user_id = ?
     LIMIT 1`,
    [userId]
  );
  const existingUsername = normalizeText(existing?.xmpp_username);
  if (existingUsername) return existingUsername;

  const base = toSlug(preferredUsername || userId);
  const username = `${base}-${deriveStableHash(userId, 10)}`;
  await db.run(
    `INSERT INTO admin_chat_accounts (id, admin_user_id, xmpp_username, created_at, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(admin_user_id)
     DO UPDATE SET xmpp_username = excluded.xmpp_username, updated_at = CURRENT_TIMESTAMP`,
    [createId('chatacct'), userId, username]
  );
  return username;
}

export async function ensureXmppAccountForAdmin(input: {
  adminUserId: string;
  preferredUsername: string;
}): Promise<XmppAccountCredentials> {
  const config = loadConfig();
  const domain = normalizeText(config.xmpp.domain) || 'localhost';
  const adminUserId = normalizeText(input.adminUserId);
  if (!adminUserId) throw new Error('adminUserId fehlt.');

  const username = await upsertXmppAccountMapping(adminUserId, input.preferredUsername);
  const password = deriveXmppPassword(adminUserId);

  if (config.xmpp.enabled) {
    try {
      await callEjabberdApi('register', {
        user: username,
        host: domain,
        password,
      });
    } catch (error) {
      if (!isAccountAlreadyExistsError(error)) {
        console.warn('XMPP account provisioning failed:', error);
      }
    }
  }

  return {
    username,
    jid: `${username}@${domain}`,
    password,
  };
}

export async function ensureXmppAccountsForAdmins(users: Array<{ id: string; username: string }>): Promise<void> {
  for (const user of users || []) {
    const id = normalizeText(user?.id);
    if (!id) continue;
    try {
      await ensureXmppAccountForAdmin({
        adminUserId: id,
        preferredUsername: normalizeText(user?.username) || id,
      });
    } catch (error) {
      console.warn(`XMPP account provisioning failed for admin ${id}:`, error);
    }
  }
}

export function resolveXmppWebsocketUrl(baseOrigin: string): string {
  const config = loadConfig();
  const raw = normalizeText(config.xmpp.websocketUrl) || '/xmpp-websocket';
  const normalizedOrigin = normalizeText(baseOrigin).replace(/\/+$/, '');
  const secureOrigin = /^https:\/\//i.test(normalizedOrigin);
  const wsScheme = secureOrigin ? 'wss' : 'ws';

  if (/^wss?:\/\//i.test(raw)) {
    if (secureOrigin && /^ws:\/\//i.test(raw)) {
      return raw.replace(/^ws:\/\//i, 'wss://');
    }
    return raw;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/^https?:\/\//i, `${wsScheme}://`);
  }
  if (!normalizedOrigin) return raw;

  const wsOrigin = normalizedOrigin.replace(/^https?:\/\//i, `${wsScheme}://`);
  if (raw.startsWith('/')) {
    return `${wsOrigin}${raw}`;
  }
  return `${wsOrigin}/${raw}`;
}

export function parseXmppNodeFromJid(jid: string): string {
  const value = normalizeText(jid);
  const at = value.indexOf('@');
  return at > 0 ? value.slice(0, at) : value;
}

export function buildOrgRoomJid(orgUnitId: string): string {
  const config = loadConfig();
  const mucService = normalizeText(config.xmpp.mucService) || `conference.${config.xmpp.domain || 'localhost'}`;
  const node = `org-${toNodePart(orgUnitId, 'org')}`;
  return `${node}@${mucService}`;
}

export function buildCustomGroupRoomJid(groupId: string): string {
  const config = loadConfig();
  const mucService = normalizeText(config.xmpp.mucService) || `conference.${config.xmpp.domain || 'localhost'}`;
  const node = `grp-${toNodePart(groupId, 'grp')}`;
  return `${node}@${mucService}`;
}

export async function ensureXmppRoom(roomJid: string, roomName: string): Promise<void> {
  const config = loadConfig();
  if (!config.xmpp.enabled) return;

  const jid = normalizeText(roomJid);
  const atPos = jid.indexOf('@');
  if (atPos <= 0) return;
  const roomNode = jid.slice(0, atPos);
  const service = jid.slice(atPos + 1);
  if (!roomNode || !service) return;

  try {
    await callEjabberdApi('create_room_with_opts', {
      name: roomNode,
      service,
      host: normalizeText(config.xmpp.domain) || 'localhost',
      options: {
        persistent: true,
        public: false,
        mam: true,
        title: normalizeText(roomName) || roomNode,
      },
    });
  } catch (error) {
    // Room might already exist or command may vary per ejabberd build.
    console.warn(`XMPP room ensure failed for ${roomJid}:`, error);
  }
}

export function buildDirectConversationId(a: string, b: string): string {
  const first = normalizeText(a);
  const second = normalizeText(b);
  if (!first || !second) return '';
  const [left, right] = [first, second].sort();
  return `direct:${left}:${right}`;
}
