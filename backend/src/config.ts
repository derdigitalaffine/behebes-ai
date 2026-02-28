/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname polyfill for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load default .env then override with project-root .env.local if present
dotenv.config();
const projectRootEnv = path.resolve(__dirname, '..', '..', '.env.local');
dotenv.config({ path: projectRootEnv });

export interface Config {
  nodeEnv: string;
  port: number;
  frontendUrl: string;
  adminUrl: string;
  trustProxy: boolean | number;
  databaseClient: 'sqlite' | 'mysql';
  databasePath: string;
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectTimeoutMs: number;
    connectionRetries: number;
    connectionRetryDelayMs: number;
    migrateFromSqlite: boolean;
    migrationSourcePath: string;
  };
  logLevel: string;
  
  // AI Provider Configuration
  aiProvider: 'openai' | 'askcodi';
  aiModel: string;
  
  // OpenAI OAuth
  openaiClientId: string;
  openaiClientSecret: string;
  
  // AskCodi Integration
  askcodi: {
    apiKey: string;
    baseUrl: string;
  };
  
  // JWT
  jwtSecret: string;

  // Rate limiting
  rateLimit: {
    windowMs: number;
    max: number;
    authWindowMs: number;
    authMax: number;
  };
  
  // Admin defaults
  adminDefaultUsername: string;
  adminDefaultPassword: string;
  
  // Email (SMTP)
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;

  // Web Push (PWA notifications)
  webPush: {
    vapidPublicKey: string;
    vapidPrivateKey: string;
    vapidSubject: string;
  };

  // XMPP chat integration
  xmpp: {
    enabled: boolean;
    domain: string;
    mucService: string;
    websocketUrl: string;
    apiUrl: string;
    apiUser: string;
    apiPassword: string;
    emailNotificationsDefault: boolean;
    rtcStunUrls: string[];
    rtcTurnUrls: string[];
    rtcTurnUsername: string;
    rtcTurnCredential: string;
  };
  
  // RedMine (optional)
  redmineApiUrl?: string;
  redmineApiKey?: string;
  
  // Features
  enableLearningMode: boolean;
  autoModeAfterNFeedbacks: number;
}

let cachedConfig: Config | null = null;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseCsvList(value: string | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseTrustProxy(value: string | undefined): boolean | number {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    // Default to one reverse proxy hop (nginx/proxy container).
    return 1;
  }
  if (normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  const asNumber = Number.parseInt(normalized, 10);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return asNumber;
  }
  return 1;
}

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const databaseClientRaw = String(process.env.DATABASE_CLIENT || 'sqlite')
    .trim()
    .toLowerCase();
  const databaseClient: 'sqlite' | 'mysql' = databaseClientRaw === 'mysql' ? 'mysql' : 'sqlite';
  const databasePath = process.env.DATABASE_PATH || './data/app.db';
  const defaultRateLimitWindowMs = 15 * 60 * 1000;
  const defaultRateLimitMax = 1500;
  const defaultAuthRateLimitWindowMs = 10 * 60 * 1000;
  const defaultAuthRateLimitMax = 30;

  const config: Config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.EXPRESS_PORT || process.env.PORT || '3001'),
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    adminUrl: process.env.ADMIN_URL || 'http://localhost:5174',
    trustProxy: parseTrustProxy(process.env.EXPRESS_TRUST_PROXY),
    databaseClient,
    databasePath,
    mysql: {
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'behebes_ai',
      connectTimeoutMs: parseInt(process.env.MYSQL_CONNECT_TIMEOUT_MS || '10000'),
      connectionRetries: parseInt(process.env.MYSQL_CONNECTION_RETRIES || '30'),
      connectionRetryDelayMs: parseInt(process.env.MYSQL_CONNECTION_RETRY_DELAY_MS || '2000'),
      migrateFromSqlite: process.env.MYSQL_MIGRATE_FROM_SQLITE !== 'false',
      migrationSourcePath:
        process.env.MYSQL_MIGRATION_SQLITE_PATH || databasePath,
    },
    logLevel: process.env.LOG_LEVEL || 'info',
    
    // AI Provider - temporarily force AskCodi only
    aiProvider: 'askcodi',
    // Use a provider-qualified model id compatible with AskCodi by default
    aiModel: process.env.AI_MODEL || 'openai/gpt-5-mini',
    
    // Support the more common env var names used in .env.example
    openaiClientId: process.env.OPENAI_CLIENT_ID || process.env.OPENAI_OAUTH_CLIENT_ID || '',
    openaiClientSecret: process.env.OPENAI_CLIENT_SECRET || process.env.OPENAI_OAUTH_CLIENT_SECRET || '',
    
    // AskCodi
    askcodi: {
      apiKey: process.env.ASKCODI_API_KEY || '',
      baseUrl: process.env.ASKCODI_BASE_URL || 'https://api.askcodi.com/v1',
    },
    
    jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
    rateLimit: {
      windowMs: parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, defaultRateLimitWindowMs),
      max: parsePositiveInt(process.env.RATE_LIMIT_MAX, defaultRateLimitMax),
      authWindowMs: parsePositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, defaultAuthRateLimitWindowMs),
      authMax: parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, defaultAuthRateLimitMax),
    },
    
    adminDefaultUsername: process.env.ADMIN_DEFAULT_USERNAME || 'admin',
    adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || 'admin123',
    
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '587'),
    smtpUser: process.env.SMTP_USER || '',
    // accept both SMTP_PASS and SMTP_PASSWORD for compatibility with .env.example
    smtpPass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '',
    // accept SMTP_FROM_EMAIL or SMTP_FROM
    smtpFrom: process.env.SMTP_FROM_EMAIL || process.env.SMTP_FROM || 'noreply@example.com',

    webPush: {
      vapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '',
      vapidPrivateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '',
      vapidSubject: process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:noreply@example.com',
    },

    xmpp: {
      enabled: process.env.XMPP_ENABLED !== 'false',
      domain: process.env.XMPP_DOMAIN || 'localhost',
      mucService: process.env.XMPP_MUC_SERVICE || `conference.${process.env.XMPP_DOMAIN || 'localhost'}`,
      websocketUrl: process.env.XMPP_WEBSOCKET_URL || '/xmpp-websocket',
      apiUrl: process.env.XMPP_API_URL || 'http://xmpp:5280/api',
      apiUser: process.env.XMPP_API_USER || '',
      apiPassword: process.env.XMPP_API_PASSWORD || '',
      emailNotificationsDefault: process.env.XMPP_EMAIL_NOTIFICATIONS_DEFAULT !== 'false',
      rtcStunUrls: parseCsvList(process.env.XMPP_RTC_STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478'),
      rtcTurnUrls: parseCsvList(process.env.XMPP_RTC_TURN_URLS),
      rtcTurnUsername: process.env.XMPP_RTC_TURN_USERNAME || '',
      rtcTurnCredential: process.env.XMPP_RTC_TURN_CREDENTIAL || '',
    },
    
    redmineApiUrl: process.env.REDMINE_API_URL,
    redmineApiKey: process.env.REDMINE_API_KEY,
    
    enableLearningMode: process.env.ENABLE_LEARNING_MODE !== 'false',
    autoModeAfterNFeedbacks: parseInt(process.env.AUTO_MODE_AFTER_N_FEEDBACKS || '10'),
  };
  
  // Validate required config
  // Only validate OpenAI if using openai provider
  if (config.aiProvider === 'openai') {
    const required = ['openaiClientId', 'openaiClientSecret'];
    for (const key of required) {
      if (!config[key as keyof Config]) {
        console.warn(`Warning: Missing ${key} for OpenAI provider`);
      }
    }
  }
  
  // Validate AskCodi if using askcodi provider
  if (config.aiProvider === 'askcodi' && !config.askcodi.apiKey) {
    console.warn('Warning: Missing ASKCODI_API_KEY for askcodi provider (DB settings may provide it)');
  }

  if (config.xmpp.enabled) {
    if (!config.xmpp.apiUser || !config.xmpp.apiPassword) {
      console.warn('Warning: XMPP enabled but API credentials are missing (XMPP_API_USER / XMPP_API_PASSWORD).');
    }
  }
  
    // Validate JWT Secret (always required)
  if (!config.jwtSecret) {
    throw new Error('Missing required environment variable: JWT_SECRET');
  }

  if (config.nodeEnv === 'production') {
    const insecureJwtSecrets = new Set([
      'change-me-in-production',
      'change-this-in-production',
      'dev-secret-key-change-in-production',
      'secret',
      'changeme',
    ]);
    const normalizedSecret = String(config.jwtSecret || '').trim().toLowerCase();
    if (!normalizedSecret || normalizedSecret.length < 24 || insecureJwtSecrets.has(normalizedSecret)) {
      console.warn(
        'Warning: JWT_SECRET appears weak for production. Use a long random secret (>= 24 chars).'
      );
    }
  }
  
  cachedConfig = config;
  return config;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
