/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * OpenAI OAuth & Admin Login Routes
 */

import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { loadConfig } from '../config.js';
import { getDatabase } from '../database.js';
import { exchangeCodeForToken } from '../services/openai.js';
import {
  createAdminUser,
  findAdminById,
  findAdminByIdentifier,
  updateAdminPassword,
} from '../services/admin.js';
import { normalizeRole } from '../utils/roles.js';
import { sendEmail } from '../services/email.js';
import { testAIProvider } from '../services/ai.js';
import { getSetting, loadGeneralSettings, setSetting } from '../services/settings.js';
import { buildCallbackLink, normalizeAdminBaseUrl } from '../services/callback-links.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  createAdminSession,
  endAdminSession,
  getRequestIp,
  getRequestUserAgent,
  writeJournalEntry,
} from '../services/admin-journal.js';
import { revokeAdminPushSubscription } from '../services/admin-push.js';
import { formatSqlDateTime } from '../utils/sql-date.js';
import {
  cleanupAllowedOrigins,
  consumeAdminAuthChallenge,
  createAdminAuthChallenge,
  deriveRelyingPartyId,
  getAdminPasskeyByCredentialId,
  isAdminTotpEnabled,
  listAdminPasskeys,
  updateAdminPasskeyUsage,
  verifyAdminTotpCode,
  verifyPasskeyAssertion,
} from '../services/admin-security.js';

const router = express.Router();
const config = loadConfig();
const adminLoginRateLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res, _next, options) => {
    const retryAfterSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));
    res.status(options.statusCode).json({
      error: 'Zu viele Login-Versuche',
      message: 'Bitte spaeter erneut anmelden.',
      retryAfterSeconds,
    });
  },
});

function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((raw) => {
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (!key) return;
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function deriveRequestOrigin(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto || 'http'}://${host}`;
}

function normalizeOriginUrl(input: string): string {
  try {
    const parsed = new URL(String(input || '').trim());
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return '';
  }
}

function resolveWebAuthnOrigins(req: Request): string[] {
  const fromRequest = normalizeOriginUrl(deriveRequestOrigin(req));
  const fromAdminConfig = normalizeOriginUrl(config.adminUrl || '');
  return cleanupAllowedOrigins([fromRequest, fromAdminConfig]);
}

function resolveWebAuthnRpId(req: Request): string {
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  const rpId = deriveRelyingPartyId(forwardedHost);
  if (rpId) return rpId;
  const configuredOrigin = normalizeOriginUrl(config.adminUrl || '');
  if (configuredOrigin) {
    return new URL(configuredOrigin).hostname;
  }
  return 'localhost';
}

async function issueAdminLoginSuccess(
  req: Request,
  res: Response,
  input: {
    user: {
      id: string;
      username: string;
      role?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
    };
    remember: boolean;
    method: 'password' | 'passkey' | 'totp';
  }
): Promise<void> {
  const user = input.user;
  const role = normalizeRole(user.role) || 'SACHBEARBEITER';
  const rememberFlag = input.remember === true;
  const ipAddress = getRequestIp(req);
  const userAgent = getRequestUserAgent(req);
  const expiryMs = rememberFlag ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const expiresAt = formatSqlDateTime(new Date(Date.now() + expiryMs));

  let sessionId: string | undefined;
  try {
    sessionId = await createAdminSession({
      adminUserId: user.id,
      username: user.username,
      role,
      rememberMe: rememberFlag,
      ipAddress,
      userAgent,
      expiresAt,
    });
  } catch (sessionError) {
    await writeJournalEntry({
      eventType: 'LOGIN_SESSION_ERROR',
      severity: 'error',
      adminUserId: user.id,
      username: user.username,
      role,
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress,
      userAgent,
      details: {
        message: sessionError instanceof Error ? sessionError.message : String(sessionError),
      },
    });
  }

  const tokenPayload: Record<string, string> = {
    userId: user.id,
    username: user.username,
    role,
  };
  if (sessionId) {
    tokenPayload.sessionId = sessionId;
  }
  const token = jwt.sign(tokenPayload, config.jwtSecret, { expiresIn: rememberFlag ? '30d' : '24h' });

  const forwardedProto = req.headers['x-forwarded-proto'];
  const isSecure = req.secure || forwardedProto === 'https';
  if (sessionId) {
    res.cookie('admin_session', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      maxAge: expiryMs,
      path: '/',
    });
  } else {
    res.clearCookie('admin_session', { path: '/' });
  }

  await writeJournalEntry({
    eventType: 'LOGIN_SUCCESS',
    severity: 'info',
    adminUserId: user.id,
    username: user.username,
    role,
    sessionId,
    method: req.method,
    path: req.originalUrl || req.path,
    ipAddress,
    userAgent,
    details: { remember: rememberFlag, expiresAt, method: input.method },
  });

  res.json({
    token,
    sessionId,
    user: {
      id: user.id,
      username: user.username,
      role,
      email: user.email || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
    },
  });
}

const ADMIN_LOGIN_POEM_KEY = 'adminLoginPoem';
const POEM_MANUAL_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const POEM_WEEKLY_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

interface AdminLoginPoem {
  title: string;
  lines: string[];
  generatedAt: string;
  source: 'ai' | 'fallback';
}

interface AdminLoginPoemProfile {
  title: string;
  humorStyle: 'trocken' | 'absurd' | 'satirisch';
  signatureWord: string;
  locationHint: string;
  chaosLevel: number;
}

let poemGenerationPromise: Promise<AdminLoginPoem> | null = null;

function normalizePoemLines(lines: string[]): string[] {
  return lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizePoemProfile(input: unknown): AdminLoginPoemProfile {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, any>)
      : {};
  const title = String(source.title || '').trim().slice(0, 120) || 'Verpflichtung mit Schmunzeln';
  const humorStyleRaw = String(source.humorStyle || '').trim().toLowerCase();
  const humorStyle: AdminLoginPoemProfile['humorStyle'] =
    humorStyleRaw === 'absurd' || humorStyleRaw === 'satirisch' ? humorStyleRaw : 'trocken';
  const signatureWord = String(source.signatureWord || '').trim().slice(0, 80);
  const locationHint = String(source.locationHint || '').trim().slice(0, 80);
  const chaosLevelRaw = Number(source.chaosLevel);
  const chaosLevel = Number.isFinite(chaosLevelRaw)
    ? Math.max(1, Math.min(5, Math.floor(chaosLevelRaw)))
    : 4;
  return {
    title,
    humorStyle,
    signatureWord,
    locationHint,
    chaosLevel,
  };
}

function fallbackPoem(profile?: Partial<AdminLoginPoemProfile>): AdminLoginPoem {
  const safeProfile = normalizePoemProfile(profile || {});
  const runningGag = safeProfile.signatureWord || 'Aktenzeichen';
  const locationLine = safeProfile.locationHint
    ? `Zwischen ${safeProfile.locationHint} und Formularrand bleibt Humor Pflichtprogramm.`
    : 'Zwischen Flurlicht und Formularrand bleibt Humor Pflichtprogramm.';
  return {
    title: safeProfile.title || 'Verpflichtung mit Schmunzeln',
    lines: [
      `Im Flur der Fristen lacht leise das Wort "${runningGag}".`,
      'Ein Stempel rutscht, der Kaffee nickt, das Protokoll bleibt wach.',
      'Buergerfreundlichkeit kommt zuerst, selbst wenn der Drucker huestet.',
      'Wir ordnen Chaos, ohne den Menschen aus der Zeile zu schieben.',
      locationLine,
      'Und jedes Ticket endet besser, wenn ein Amt auch schmunzeln kann.',
    ],
    generatedAt: new Date().toISOString(),
    source: 'fallback',
  };
}

function parsePoemPayload(raw: string): { title: string; lines: string[] } | null {
  if (!raw || typeof raw !== 'string') return null;

  const parseObject = (value: string): { title: string; lines: string[] } | null => {
    try {
      const parsed = JSON.parse(value) as any;
      const title = typeof parsed?.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : 'Verpflichtung';
      const lines = Array.isArray(parsed?.lines) ? normalizePoemLines(parsed.lines) : [];
      if (lines.length < 4) return null;
      return { title, lines };
    } catch {
      return null;
    }
  };

  const direct = parseObject(raw);
  if (direct) return direct;

  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    const fromMatch = parseObject(match[0]);
    if (fromMatch) return fromMatch;
  }

  const textLines = normalizePoemLines(
    raw
      .split('\n')
      .map((line) => line.replace(/^\d+[\).\s-]+/, '').trim())
  );
  if (textLines.length < 4) return null;
  return { title: 'Verpflichtung', lines: textLines };
}

async function loadStoredPoem(): Promise<AdminLoginPoem | null> {
  const stored = await getSetting<Partial<AdminLoginPoem>>(ADMIN_LOGIN_POEM_KEY);
  if (!stored || typeof stored !== 'object') return null;
  if (!stored.generatedAt || Number.isNaN(Date.parse(String(stored.generatedAt)))) return null;
  if (!Array.isArray(stored.lines) || normalizePoemLines(stored.lines).length < 4) return null;
  return {
    title: typeof stored.title === 'string' && stored.title.trim() ? stored.title.trim() : 'Verpflichtung',
    lines: normalizePoemLines(stored.lines),
    generatedAt: String(stored.generatedAt),
    source: stored.source === 'ai' ? 'ai' : 'fallback',
  };
}

function buildPoemResponse(poem: AdminLoginPoem) {
  const generatedAtMs = Date.parse(poem.generatedAt);
  const baseMs = Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now();
  const refreshAvailableAt = new Date(baseMs + POEM_MANUAL_MIN_AGE_MS).toISOString();
  const nextAutomaticRefreshAt = new Date(baseMs + POEM_WEEKLY_REFRESH_MS).toISOString();
  return {
    ...poem,
    refreshAvailableAt,
    nextAutomaticRefreshAt,
    canRequestManualRefresh: Date.now() >= Date.parse(refreshAvailableAt),
  };
}

async function generateAndStorePoem(
  previousPoem?: AdminLoginPoem | null,
  profileInput?: Partial<AdminLoginPoemProfile>
): Promise<AdminLoginPoem> {
  if (poemGenerationPromise) {
    return poemGenerationPromise;
  }

  poemGenerationPromise = (async () => {
    const profile = normalizePoemProfile(profileInput || {});
    const runningGagHint = profile.signatureWord
      ? `- Running-Gag-Wort: "${profile.signatureWord}" (mindestens 2x verwenden)`
      : '- Running-Gag-Wort: "Aktenzeichen" (mindestens 2x verwenden)';
    const locationHint = profile.locationHint
      ? `- Ortsbezug: "${profile.locationHint}" in mindestens einer Zeile erwaehnen`
      : '- Ortsbezug: optional';
    const styleHint =
      profile.humorStyle === 'absurd'
        ? 'absurd, verspielt, aber nicht albern'
        : profile.humorStyle === 'satirisch'
        ? 'satirisch, pointiert, freundlich'
        : 'trocken, pointiert, verwaltungsnah';
    const prompt = `Erstelle ein neues sehr lustiges deutsches Gedicht fuer die Admin-Loginseite einer kommunalen Anwendung.

Regeln:
- Sprache: Deutsch
- Titel MUSS exakt sein: "${profile.title}"
- Ton: ${styleHint}
- Humor-Intensitaet: ${profile.chaosLevel} von 5
- 6 bis 8 Zeilen
- Kein Reimzwang, aber poetisch und klar lesbar
- Alleinstellungsmerkmal: baue in vier aufeinanderfolgenden Zeilen ein Mini-Akrostichon mit den Anfangsbuchstaben B-E-H-E ein.
${runningGagHint}
${locationHint}
- Vermeide Wiederholungen und benutze nicht exakt das letzte Gedicht.
- Antworte NUR mit JSON

Format:
{"title":"...","lines":["...","...","...","...","...","..."]}

Letztes Gedicht:
${previousPoem ? previousPoem.lines.join('\n') : 'Kein Vorheriges vorhanden.'}`;

    try {
      const raw = await testAIProvider(prompt, {
        purpose: 'admin_login_poem',
        meta: {
          source: 'routes.auth',
        },
      });
      const parsed = parsePoemPayload(raw);
      if (!parsed) {
        throw new Error('Gedicht konnte nicht als JSON/Text geparst werden');
      }
      const poem: AdminLoginPoem = {
        title: parsed.title || profile.title,
        lines: parsed.lines,
        generatedAt: new Date().toISOString(),
        source: 'ai',
      };
      await setSetting(ADMIN_LOGIN_POEM_KEY, poem);
      return poem;
    } catch {
      // Keep the previous poem if generation fails; only use fallback when no poem exists yet.
      if (previousPoem) {
        return previousPoem;
      }
      const poem = fallbackPoem(profile);
      await setSetting(ADMIN_LOGIN_POEM_KEY, poem);
      return poem;
    }
  })();

  try {
    return await poemGenerationPromise;
  } finally {
    poemGenerationPromise = null;
  }
}

async function ensureCurrentPoem(): Promise<AdminLoginPoem> {
  const stored = await loadStoredPoem();
  if (!stored) {
    return generateAndStorePoem(null);
  }

  const ageMs = Date.now() - Date.parse(stored.generatedAt);
  if (!Number.isFinite(ageMs) || ageMs >= POEM_WEEKLY_REFRESH_MS) {
    return generateAndStorePoem(stored);
  }

  return stored;
}

// ============================================================================
// OpenAI OAuth Flow
// ============================================================================

/**
 * GET /auth/openai/login
 * Initiiert OpenAI OAuth Login (PKCE Flow)
 */
router.get('/openai/login', (req: Request, res: Response) => {
  // Generate PKCE challenge
  const codeVerifier = Buffer.from(uuidv4() + uuidv4()).toString('base64url');
  const codeChallenge = Buffer.from(codeVerifier).toString('base64url');
  const state = uuidv4();
  
  // Store in session/cookie für später (oder im Query-Parameter)
  res.cookie('oauth_state', state, { httpOnly: true, secure: true, maxAge: 600000 });
  res.cookie('oauth_verifier', codeVerifier, { httpOnly: true, secure: true, maxAge: 600000 });
  
  const authUrl = new URL('https://auth.openai.com/oauth/authorize');
  authUrl.searchParams.set('client_id', config.openaiClientId);
  authUrl.searchParams.set('redirect_uri', `${config.adminUrl.split(':')[0]}://${config.adminUrl.split('//')[1]}/auth/openai/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'offline_access');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  
  res.redirect(authUrl.toString());
});

/**
 * GET /auth/openai/callback
 * OpenAI OAuth Callback - empfängt Authorization Code
 */
router.get('/auth/openai/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    const cookies = parseCookieHeader(req.headers.cookie);
    const storedState = cookies.oauth_state;
    const codeVerifier = cookies.oauth_verifier;
    
    if (state !== storedState) {
      return res.status(400).json({ error: 'State mismatch - OAuth-Sicherheitscheck fehlgeschlagen' });
    }
    
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'No authorization code received' });
    }
    
    // Exchange code for tokens
    const tokens = await exchangeCodeForToken(code, codeVerifier);
    
    // Store tokens in database
    const db = getDatabase();
    await db.run(
      `INSERT OR REPLACE INTO oauth_tokens (id, provider, access_token, refresh_token, expires_at, account_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [uuidv4(), 'openai-codex', tokens.accessToken, tokens.refreshToken, tokens.expiresAt, tokens.accountId]
    );
    
    // Clear cookies
    res.clearCookie('oauth_state');
    res.clearCookie('oauth_verifier');
    
    // Redirect to admin panel
    res.redirect(`${config.adminUrl}?oauth_success=true`);
  } catch (error) {
    res.status(500).json({ 
      error: 'OAuth-Austausch fehlgeschlagen',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /auth/openai/status
 * Prüfe OpenAI OAuth Status
 */
router.get('/openai/status', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const token = await db.get(
      `SELECT * FROM oauth_tokens WHERE provider = 'openai-codex' ORDER BY updated_at DESC LIMIT 1`
    );
    
    if (!token) {
      return res.json({ connected: false });
    }
    
    const isExpired = token.expires_at && token.expires_at < Date.now();
    
    res.json({
      connected: true,
      expiresAt: token.expires_at,
      isExpired,
      accountId: token.account_id,
    });
  } catch (error) {
    res.status(500).json({ error: 'Status-Check fehlgeschlagen' });
  }
});

// ============================================================================
// Admin Login (Username/Password)
// ============================================================================

/**
 * POST /auth/admin/login
 * Admin-Login mit Username/Password
 */
router.post('/admin/login', adminLoginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password, remember } = (req.body ?? {}) as {
      username?: string;
      password?: string;
      remember?: boolean | string;
    };
    const identifier = typeof username === 'string' ? username.trim() : '';
    const ipAddress = getRequestIp(req);
    const userAgent = getRequestUserAgent(req);
    
    if (!identifier || !password) {
      await writeJournalEntry({
        eventType: 'LOGIN_FAILED',
        severity: 'warning',
        username: identifier || null,
        method: req.method,
        path: req.originalUrl || req.path,
        ipAddress,
        userAgent,
        details: { reason: 'missing_credentials' },
      });
      return res.status(400).json({ error: 'Username und Passwort erforderlich' });
    }
    
    const db = getDatabase();
    const user = await findAdminByIdentifier(db, identifier);
    
    if (!user) {
      await writeJournalEntry({
        eventType: 'LOGIN_FAILED',
        severity: 'warning',
        username: identifier,
        method: req.method,
        path: req.originalUrl || req.path,
        ipAddress,
        userAgent,
        details: { reason: 'unknown_user' },
      });
      return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    }
    
    const passwordHash = typeof user.passwordHash === 'string' ? user.passwordHash : '';
    if (!passwordHash || !passwordHash.startsWith('$2')) {
      await writeJournalEntry({
        eventType: 'LOGIN_FAILED',
        severity: 'warning',
        adminUserId: user.id,
        username: user.username,
        role: user.role || null,
        method: req.method,
        path: req.originalUrl || req.path,
        ipAddress,
        userAgent,
        details: { reason: 'invalid_password_hash' },
      });
      return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    }

    // Check password
    let passwordMatch = false;
    try {
      passwordMatch = await bcryptjs.compare(password, passwordHash);
    } catch {
      await writeJournalEntry({
        eventType: 'LOGIN_FAILED',
        severity: 'warning',
        adminUserId: user.id,
        username: user.username,
        role: user.role || null,
        method: req.method,
        path: req.originalUrl || req.path,
        ipAddress,
        userAgent,
        details: { reason: 'password_compare_failed' },
      });
      return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    }
    if (!passwordMatch) {
      await writeJournalEntry({
        eventType: 'LOGIN_FAILED',
        severity: 'warning',
        adminUserId: user.id,
        username: user.username,
        role: user.role,
        method: req.method,
        path: req.originalUrl || req.path,
        ipAddress,
        userAgent,
        details: { reason: 'wrong_password' },
      });
      return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    }
    
    if (!user.active) {
      await writeJournalEntry({
        eventType: 'LOGIN_FAILED',
        severity: 'warning',
        adminUserId: user.id,
        username: user.username,
        role: user.role,
        method: req.method,
        path: req.originalUrl || req.path,
        ipAddress,
        userAgent,
        details: { reason: 'inactive_user' },
      });
      return res.status(401).json({ error: 'Benutzer ist deaktiviert' });
    }
    
    const role = normalizeRole(user.role) || 'SACHBEARBEITER';
    const rememberFlag = remember === true || remember === 'true';
    const totpEnabled = await isAdminTotpEnabled(db, user.id);
    if (totpEnabled) {
      const mfaChallenge = await createAdminAuthChallenge(db, {
        purpose: 'totp_login',
        adminUserId: user.id,
        payload: {
          remember: rememberFlag,
          role,
          username: user.username,
          loginMethod: 'password',
        },
        ttlSeconds: 300,
      });
      await writeJournalEntry({
        eventType: 'LOGIN_MFA_REQUIRED',
        severity: 'info',
        adminUserId: user.id,
        username: user.username,
        role,
        method: req.method,
        path: req.originalUrl || req.path,
        ipAddress,
        userAgent,
        details: {
          mfaMethod: 'totp',
          remember: rememberFlag,
        },
      });
      return res.json({
        mfaRequired: true,
        mfaMethod: 'totp',
        mfaToken: mfaChallenge.id,
        user: {
          id: user.id,
          username: user.username,
          role,
        },
      });
    }

    await issueAdminLoginSuccess(req, res, {
      user: {
        id: user.id,
        username: user.username,
        role,
        email: user.email || '',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
      },
      remember: rememberFlag,
      method: 'password',
    });
    return;
  } catch (error) {
    await writeJournalEntry({
      eventType: 'LOGIN_ERROR',
      severity: 'error',
      username: typeof req.body?.username === 'string' ? req.body.username : null,
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      details: { message: error instanceof Error ? error.message : String(error) },
    });
    res.status(500).json({ 
      error: 'Login fehlgeschlagen',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /auth/admin/login/totp
 * Zweiter Login-Schritt mit TOTP (nach Passwortprüfung)
 */
router.post('/admin/login/totp', adminLoginRateLimiter, async (req: Request, res: Response): Promise<any> => {
  try {
    const mfaToken = typeof req.body?.mfaToken === 'string' ? req.body.mfaToken.trim() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const ipAddress = getRequestIp(req);
    const userAgent = getRequestUserAgent(req);

    if (!mfaToken || !code) {
      return res.status(400).json({ error: 'mfaToken und TOTP-Code sind erforderlich' });
    }

    const db = getDatabase();
    const challenge = await consumeAdminAuthChallenge(db, {
      challengeId: mfaToken,
      purpose: 'totp_login',
    });
    if (!challenge || !challenge.adminUserId) {
      await writeJournalEntry({
        eventType: 'LOGIN_FAILED',
        severity: 'warning',
        method: req.method,
        path: req.originalUrl || req.path,
        ipAddress,
        userAgent,
        details: { reason: 'invalid_totp_mfa_token' },
      });
      return res.status(401).json({ error: 'MFA-Token ungültig oder abgelaufen' });
    }

    const user = await findAdminById(db, challenge.adminUserId);
    if (!user || !user.active) {
      await writeJournalEntry({
        eventType: 'LOGIN_FAILED',
        severity: 'warning',
        adminUserId: challenge.adminUserId,
        method: req.method,
        path: req.originalUrl || req.path,
        ipAddress,
        userAgent,
        details: { reason: 'totp_user_inactive_or_missing' },
      });
      return res.status(401).json({ error: 'Benutzer ist deaktiviert' });
    }

    const codeValid = await verifyAdminTotpCode(db, {
      adminUserId: user.id,
      code,
      window: 1,
    });
    if (!codeValid) {
      const retryChallenge = await createAdminAuthChallenge(db, {
        purpose: 'totp_login',
        adminUserId: user.id,
        payload: {
          remember: challenge.payload?.remember === true,
          role: user.role,
          username: user.username,
          loginMethod: 'password',
          retry: true,
        },
        ttlSeconds: 300,
      });
      await writeJournalEntry({
        eventType: 'LOGIN_FAILED',
        severity: 'warning',
        adminUserId: user.id,
        username: user.username,
        role: user.role,
        method: req.method,
        path: req.originalUrl || req.path,
        ipAddress,
        userAgent,
        details: { reason: 'invalid_totp_code' },
      });
      return res.status(401).json({
        error: 'TOTP-Code ungültig',
        mfaRequired: true,
        mfaMethod: 'totp',
        mfaToken: retryChallenge.id,
      });
    }

    await issueAdminLoginSuccess(req, res, {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email || '',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
      },
      remember: challenge.payload?.remember === true,
      method: 'totp',
    });
    return;
  } catch (error) {
    return res.status(500).json({
      error: 'MFA-Anmeldung fehlgeschlagen',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /auth/admin/passkeys/authentication/options
 * Startet eine Passkey-Anmeldung (WebAuthn Assertion Request)
 */
router.post(
  '/admin/passkeys/authentication/options',
  adminLoginRateLimiter,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const identifier = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const rememberFlag = req.body?.remember === true || req.body?.remember === 'true';
      const db = getDatabase();
      const user = identifier ? await findAdminByIdentifier(db, identifier) : null;

      const rpId = resolveWebAuthnRpId(req);
      const origins = resolveWebAuthnOrigins(req);
      const passkeys = user ? await listAdminPasskeys(db, user.id) : [];
      const allowCredentials = passkeys
        .map((entry) => ({
          type: 'public-key',
          id: entry.credentialId,
          transports: entry.transports,
        }))
        .filter((entry) => entry.id);
      const challenge = await createAdminAuthChallenge(db, {
        purpose: 'passkey_authentication',
        adminUserId: user?.id || null,
        payload: {
          remember: rememberFlag,
          rpId,
          origins,
          requestedIdentifier: identifier || null,
        },
        ttlSeconds: 300,
      });

      return res.json({
        challengeId: challenge.id,
        publicKey: {
          challenge: challenge.challenge,
          timeout: 60000,
          rpId,
          userVerification: 'preferred',
          ...(allowCredentials.length > 0 ? { allowCredentials } : {}),
        },
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Passkey-Anmeldung konnte nicht gestartet werden',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /auth/admin/passkeys/authentication/verify
 * Verifiziert eine Passkey-Anmeldung und stellt JWT/Session aus
 */
router.post(
  '/admin/passkeys/authentication/verify',
  adminLoginRateLimiter,
  async (req: Request, res: Response): Promise<any> => {
    try {
      const challengeId = typeof req.body?.challengeId === 'string' ? req.body.challengeId.trim() : '';
      const credential = req.body?.credential && typeof req.body.credential === 'object'
        ? req.body.credential
        : null;
      if (!challengeId || !credential) {
        return res.status(400).json({ error: 'challengeId und credential sind erforderlich' });
      }

      const db = getDatabase();
      const challenge = await consumeAdminAuthChallenge(db, {
        challengeId,
        purpose: 'passkey_authentication',
      });
      if (!challenge) {
        return res.status(401).json({ error: 'Passkey-Challenge ungültig oder abgelaufen' });
      }

      const credentialIdRaw =
        typeof credential.rawId === 'string'
          ? credential.rawId.trim()
          : typeof credential.id === 'string'
          ? credential.id.trim()
          : '';
      if (!credentialIdRaw) {
        return res.status(400).json({ error: 'credential id fehlt' });
      }
      const passkey = await getAdminPasskeyByCredentialId(db, credentialIdRaw);
      if (!passkey || !passkey.adminUserId) {
        return res.status(401).json({ error: 'Passkey nicht gefunden oder widerrufen' });
      }
      if (challenge.adminUserId && challenge.adminUserId !== passkey.adminUserId) {
        return res.status(401).json({ error: 'Passkey gehört nicht zur angeforderten Anmeldung' });
      }

      const user = await findAdminById(db, passkey.adminUserId);
      if (!user || !user.active) {
        return res.status(401).json({ error: 'Benutzer ist deaktiviert' });
      }

      const response = credential.response || {};
      const assertion = verifyPasskeyAssertion({
        clientDataJSON: String(response.clientDataJSON || ''),
        authenticatorData: String(response.authenticatorData || ''),
        signature: String(response.signature || ''),
        expectedChallenge: challenge.challenge,
        expectedRpId: String(challenge.payload?.rpId || resolveWebAuthnRpId(req)),
        allowedOrigins: cleanupAllowedOrigins(
          Array.isArray(challenge.payload?.origins)
            ? challenge.payload.origins.map((entry: any) => String(entry || ''))
            : resolveWebAuthnOrigins(req)
        ),
        publicKeySpki: passkey.publicKeySpki,
        coseAlgorithm: Number.isFinite(passkey.coseAlgorithm) ? passkey.coseAlgorithm : -7,
        requireUserVerification: false,
      });

      const signCountCandidate = Number(assertion.signCount);
      if (
        Number.isFinite(signCountCandidate) &&
        signCountCandidate > 0 &&
        passkey.signCount > 0 &&
        signCountCandidate <= passkey.signCount
      ) {
        return res.status(401).json({ error: 'Passkey-Zähler ungültig (möglicher Klon erkannt)' });
      }
      const signCount = Number.isFinite(signCountCandidate)
        ? Math.max(passkey.signCount, Math.trunc(signCountCandidate))
        : passkey.signCount;
      await updateAdminPasskeyUsage(db, {
        passkeyId: passkey.id,
        signCount,
      });

      await issueAdminLoginSuccess(req, res, {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          email: user.email || '',
          firstName: user.firstName || '',
          lastName: user.lastName || '',
        },
        remember: challenge.payload?.remember === true,
        method: 'passkey',
      });
      return;
    } catch (error) {
      return res.status(401).json({
        error: 'Passkey-Anmeldung fehlgeschlagen',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /auth/admin/setup
 * Erstelle ersten Admin-Benutzer (nur falls keine existieren)
 */
router.post('/admin/setup', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    
    // Check if any admin exists
    const existingAdmin = await db.get(`SELECT id FROM admin_users LIMIT 1`);
    if (existingAdmin) {
      return res.status(400).json({ error: 'Admin-Benutzer existiert bereits' });
    }
    
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username und Passwort erforderlich' });
    }
    
    // Create first admin as ADMIN
    const admin = await createAdminUser(db, {
      username,
      password,
      role: 'ADMIN',
    });
    
    res.json({ 
      message: 'Erster Admin-Benutzer erstellt',
      admin: { id: admin.id, username: admin.username, role: admin.role }
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Admin-Setup fehlgeschlagen',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ============================================================================
// Admin Password Recovery
// ============================================================================

/**
 * GET /auth/admin/login-poem
 * Liefert das aktuelle Login-Gedicht und erneuert es woechentlich automatisch.
 */
router.get('/admin/login-poem', async (_req: Request, res: Response) => {
  try {
    const poem = await ensureCurrentPoem();
    return res.json(buildPoemResponse(poem));
  } catch (error) {
    return res.status(500).json({ message: 'Gedicht konnte nicht geladen werden' });
  }
});

/**
 * POST /auth/admin/login-poem/refresh
 * Erstellt fruehestens nach 24h ein neues Gedicht.
 */
router.post('/admin/login-poem/refresh', async (req: Request, res: Response): Promise<any> => {
  try {
    const rawTitle = String(req.body?.title || '').trim();
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'title') && !rawTitle) {
      return res.status(400).json({ message: 'Bitte einen Titel fuer das Gedicht angeben.' });
    }

    const poemProfile = normalizePoemProfile({
      title: rawTitle || undefined,
      humorStyle: req.body?.humorStyle,
      signatureWord: req.body?.signatureWord,
      locationHint: req.body?.locationHint,
      chaosLevel: req.body?.chaosLevel,
    });

    const current = await ensureCurrentPoem();
    const generatedAtMs = Date.parse(current.generatedAt);
    const nextAllowedAtMs = generatedAtMs + POEM_MANUAL_MIN_AGE_MS;

    if (Number.isFinite(nextAllowedAtMs) && Date.now() < nextAllowedAtMs) {
      return res.status(429).json({
        message: `Ein neues Gedicht ist fruehestens ab ${new Date(nextAllowedAtMs).toLocaleString('de-DE')} moeglich`,
        poem: buildPoemResponse(current),
      });
    }

    const poem = await generateAndStorePoem(current, poemProfile);
    return res.json(buildPoemResponse(poem));
  } catch (error) {
    return res.status(500).json({ message: 'Neues Gedicht konnte nicht erstellt werden' });
  }
});

const RESET_EXPIRY_HOURS = 24;

async function buildResetLink(token: string, req: Request): Promise<string> {
  const { values: general } = await loadGeneralSettings();
  let adminBase = normalizeAdminBaseUrl(`${deriveRequestOrigin(req).replace(/\/+$/g, '')}/admin`);
  if (!adminBase) {
    adminBase = normalizeAdminBaseUrl(config.adminUrl);
  }
  if (!adminBase) {
    adminBase = 'http://localhost:5174/admin';
  }
  return buildCallbackLink(general.callbackUrl, {
    token,
    resetToken: token,
    cb: 'admin_password_reset',
    adminBase,
  });
}

function buildResetEmailHtml(username: string, resetLink: string): string {
  return `
    <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Passwort zurücksetzen</h2>
      <p>Hallo ${username},</p>
      <p>Sie haben eine Passwort-Zurücksetzung angefordert. Bitte klicken Sie auf den folgenden Link:</p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${resetLink}" style="display:inline-block;background:#003762;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">
          Neues Passwort setzen
        </a>
      </div>
      <p>Oder kopieren Sie diesen Link:</p>
      <p style="background:#ecf3f9;padding:10px;border-radius:6px;word-break:break-all;">${resetLink}</p>
      <p style="color:#666;font-size:12px;">Dieser Link ist ${RESET_EXPIRY_HOURS} Stunden gültig.</p>
    </div>
  `;
}

/**
 * POST /auth/admin/forgot
 * Startet Passwort-Reset per Mail
 */
router.post('/admin/forgot', async (req: Request, res: Response) => {
  try {
    const rawIdentifier = req.body?.identifier;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';

    if (!identifier) {
      return res.status(400).json({ message: 'Benutzername oder Email erforderlich' });
    }

    const db = getDatabase();
    const user = await findAdminByIdentifier(db, identifier);

    if (user && user.email) {
      const token = crypto.randomBytes(32).toString('hex');
      const resetId = uuidv4();
      const expiresAt = new Date(Date.now() + RESET_EXPIRY_HOURS * 60 * 60 * 1000);

      await db.run(
        `INSERT INTO admin_password_resets (id, admin_user_id, reset_token, expires_at)
         VALUES (?, ?, ?, ?)`,
        [resetId, user.id, token, formatSqlDateTime(expiresAt)]
      );

      const resetLink = await buildResetLink(token, req);
      const html = buildResetEmailHtml(user.username, resetLink);

      await sendEmail({
        to: user.email,
        subject: 'Passwort zurücksetzen',
        html,
      });
    }

    // Always return generic message to prevent enumeration
    res.json({ message: 'Wenn ein Konto existiert, wurde eine E-Mail versendet.' });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Versenden der Reset-Email' });
  }
});

/**
 * POST /auth/admin/reset
 * Passwort mit Token zurücksetzen
 */
router.post('/admin/reset', async (req: Request, res: Response) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!token) {
      return res.status(400).json({ message: 'Token erforderlich' });
    }

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'Passwort muss mindestens 8 Zeichen lang sein' });
    }

    const db = getDatabase();
    const record = await db.get(`SELECT * FROM admin_password_resets WHERE reset_token = ?`, [token]);

    if (!record) {
      return res.status(400).json({ message: 'Token ungültig oder bereits verwendet' });
    }

    if (record.used_at) {
      return res.status(400).json({ message: 'Token ungültig oder bereits verwendet' });
    }

    const expiresMs = Date.parse(String(record.expires_at || ''));
    if (!Number.isNaN(expiresMs) && expiresMs < Date.now()) {
      return res.status(410).json({ message: 'Token abgelaufen' });
    }

    await updateAdminPassword(db, record.admin_user_id, newPassword);
    await db.run(
      `UPDATE admin_password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [record.id]
    );

    res.json({ message: 'Passwort aktualisiert' });
  } catch (error) {
    res.status(500).json({ message: 'Fehler beim Zurücksetzen des Passworts' });
  }
});

/**
 * POST /auth/admin/logout
 * Admin-Logout
 */
router.post('/admin/logout', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (req.sessionId) {
      await endAdminSession(req.sessionId, 'logout');
    }
    if (req.userId) {
      await revokeAdminPushSubscription({
        adminUserId: req.userId,
        sessionId: req.sessionId || undefined,
      });
    }
    await writeJournalEntry({
      eventType: 'LOGOUT',
      severity: 'info',
      adminUserId: req.userId || null,
      username: req.username || null,
      role: req.role || null,
      sessionId: req.sessionId || null,
      method: req.method,
      path: req.originalUrl || req.path,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
    });
  } catch (error) {
    console.warn('Logout journaling/session cleanup failed:', error);
  }

  res.clearCookie('admin_session', { path: '/' });
  res.json({ message: 'Logout erfolgreich' });
});

export default router;
