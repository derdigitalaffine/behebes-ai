/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import * as swaggerUi from 'swagger-ui-express';
import { initDatabase } from './database.js';
import { loadConfig } from './config.js';
import { createDefaultAdminUser } from './services/admin.js';
import authRouter from './routes/auth.js';
import submissionsRouter from './routes/submissions.js';
import classifyRouter from './routes/classify.js';
import ticketsRouter from './routes/tickets.js';
import adminRouter, { initializeAdminBackgroundLoops } from './routes/admin.js';
import knowledgeRouter from './routes/knowledge.js';
import integrationsRouter from './routes/integrations.js';
import generalRouter from './routes/general.js';
import usersRouter from './routes/users.js';
import validationsRouter from './routes/validations.js';
import templatesRouter, { generateRouter } from './routes/templates.js';
import promptsRouter from './routes/prompts.js';
import workflowsRouter from './routes/workflows.js';
import realtimeRouter from './routes/realtime.js';
import translateRouter from './routes/translate.js';
import publicConfigRouter from './routes/public-config.js';
import platformRouter from './routes/platform.js';
import { startAiQueueWorker } from './services/ai.js';
import { startEmailQueueWorker } from './services/email.js';
import { startMailboxSyncWorker } from './services/mailbox.js';
import translationPlannerRouter from './routes/translation-planner.js';
import { startTranslationPlannerWorker } from './services/translation-planner.js';
import citizenRouter from './routes/citizen.js';
import adminRegistrationRouter from './routes/admin-registration.js';
import { startCitizenAuthCleanupWorker } from './services/citizen-auth.js';
import organizationRouter from './routes/organization.js';
import chatRouter from './routes/chat.js';
import { loadGeneralSettings } from './services/settings.js';
import { openApiSpec } from './openapi.js';

const logger = pinoHttp({
  autoLogging: {
    ignore: (req) =>
      req.url === '/health' ||
      req.url === '/api/health' ||
      req.url === '/api/docs.json' ||
      req.url?.startsWith('/api/docs') === true ||
      req.url?.startsWith('/api/admin/realtime/stream') === true,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["set-cookie"]',
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
    ],
    remove: true,
  },
  serializers: {
    req(req) {
      return {
        id: (req as any).id,
        method: req.method,
        url: req.url,
        query: req.query,
        params: req.params,
        remoteAddress: req.remoteAddress,
        remotePort: req.remotePort,
        userAgent: req.headers['user-agent'],
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});
const app = express();
const config = loadConfig();
let server: ReturnType<typeof app.listen> | null = null;
let processGuardsInstalled = false;

// Middleware
app.disable('x-powered-by');
app.use(helmet());
// Backend runs behind one or more reverse proxies in Docker/prod setups.
app.set('trust proxy', config.trustProxy);

function normalizeOrigin(input: string): string | null {
  try {
    const parsed = new URL(String(input || '').trim());
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

// CORS Configuration - allow all origins in development
const staticConfiguredOrigins = Array.from(
  new Set(
    [config.frontendUrl, config.adminUrl, ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',')]
      .map((origin) => normalizeOrigin(origin?.trim() || ''))
      .filter((origin): origin is string => !!origin)
  )
);

let dynamicCorsOriginsCache: {
  expiresAt: number;
  values: string[];
} = {
  expiresAt: 0,
  values: staticConfiguredOrigins,
};

async function loadAllowedOrigins(): Promise<string[]> {
  const now = Date.now();
  if (now < dynamicCorsOriginsCache.expiresAt) {
    return dynamicCorsOriginsCache.values;
  }

  const merged = new Set(staticConfiguredOrigins);
  try {
    const { values } = await loadGeneralSettings();
    const callbackOrigin = normalizeOrigin(values.callbackUrl || '');
    if (callbackOrigin) {
      merged.add(callbackOrigin);
    }
  } catch {
    // Ignore transient settings/db read errors for CORS fallback.
  }

  const values = Array.from(merged);
  dynamicCorsOriginsCache = {
    expiresAt: now + 30_000,
    values,
  };
  return values;
}

function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  const normalizedOrigin = normalizeOrigin(origin);
  if (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) return true;

  try {
    const requestUrl = new URL(origin);
    const requestHost = requestUrl.hostname.toLowerCase();
    if (requestHost === 'localhost' || requestHost === '127.0.0.1' || requestHost === '::1') {
      return true;
    }

    return allowedOrigins.some((allowed) => {
      try {
        const allowedUrl = new URL(allowed);
        if (allowedUrl.protocol !== requestUrl.protocol) return false;
        if (allowedUrl.hostname !== requestUrl.hostname) return false;
        // If configured origin has no explicit port, allow same host across ports
        if (!allowedUrl.port) return true;
        return allowedUrl.port === requestUrl.port;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // In development, allow all origins
    if (config.nodeEnv === 'development') {
      callback(null, true);
      return;
    }
    if (!origin) {
      callback(null, true);
      return;
    } else {
      // In production, allow same host/protocol as configured frontend/admin
      // plus runtime callback/public URL from general settings.
      void loadAllowedOrigins()
        .then((allowedOrigins) => {
          if (isOriginAllowed(origin, allowedOrigins)) {
            callback(null, true);
          } else {
            callback(new Error('CORS not allowed'));
          }
        })
        .catch(() => {
          callback(new Error('CORS not allowed'));
        });
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '40mb' }));
app.use(logger);

const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authorization = String(req.headers.authorization || '');
    if (/^bearer\s+/i.test(authorization)) {
      const token = authorization.replace(/^bearer\s+/i, '').trim();
      if (token) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 24);
        return `bearer:${tokenHash}`;
      }
    }
    const sessionHint = String(req.headers['x-admin-session-id'] || '').trim();
    if (sessionHint) {
      const sessionHash = crypto.createHash('sha256').update(sessionHint).digest('hex').slice(0, 24);
      return `session:${sessionHash}`;
    }
    return `ip:${String(req.ip || req.socket?.remoteAddress || 'unknown')}`;
  },
  skip: (req) =>
    req.path === '/health' ||
    req.path === '/docs' ||
    req.path === '/docs.json' ||
    req.path.startsWith('/docs/') ||
    req.path === '/auth/admin/login' ||
    req.path === '/admin/login' ||
    (req.originalUrl || '').includes('/api/auth/admin/login') ||
    req.path.startsWith('/admin/realtime/stream') ||
    req.path.startsWith('/admin/chat') ||
    req.path === '/admin/mobile/dashboard',
  handler: (_req, res, _next, options) => {
    const retryAfterSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));
    res.status(options.statusCode).json({
      error: 'Zu viele Anfragen',
      message: 'Bitte Anfragefrequenz reduzieren und spaeter erneut versuchen.',
      retryAfterSeconds,
    });
  },
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/docs.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(openApiSpec);
});
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    explorer: true,
    customSiteTitle: 'behebes.AI API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
    },
  })
);

app.use('/api', apiRateLimiter);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/auth/admin/register', adminRegistrationRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/classify', classifyRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/admin/config/general', generalRouter);
app.use('/api/admin/templates', generateRouter); // Generate endpoint (admin only)
app.use('/api/admin/config/templates', templatesRouter);
app.use('/api/admin/config/prompts', promptsRouter);
app.use('/api/admin/config', integrationsRouter);
app.use('/api/admin/users', usersRouter);
app.use('/api/admin/translation-planner', translationPlannerRouter);
app.use('/api/admin', organizationRouter);
app.use('/api/admin/chat', chatRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/realtime', realtimeRouter);
app.use('/api/validations', validationsRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/translate', translateRouter);
app.use('/api/config', publicConfigRouter);
app.use('/api/platform', platformRouter);
app.use('/api/citizen', citizenRouter);
app.use(workflowsRouter);

// Error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.logger.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Interner Fehler',
    timestamp: new Date().toISOString(),
  });
});

// Not found
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Nicht gefunden' });
});

function installProcessGuards() {
  if (processGuardsInstalled) return;
  processGuardsInstalled = true;

  const exitOnUncaughtException = process.env.EXIT_ON_UNCAUGHT_EXCEPTION === '1';
  const gracefulShutdown = (reason: string, exitCode = 1) => {
    if (!server) {
      process.exit(exitCode);
      return;
    }
    logger.logger.error({ reason, exitCode }, 'Backend wird kontrolliert beendet');
    server.close(() => {
      process.exit(exitCode);
    });
    setTimeout(() => process.exit(exitCode), 5000).unref();
  };

  process.on('unhandledRejection', (reason) => {
    logger.logger.error({ reason }, 'Unhandled Promise Rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.logger.error({ err: error }, 'Uncaught Exception');
    if (exitOnUncaughtException) {
      gracefulShutdown('uncaught_exception', 1);
    }
  });

  process.on('SIGTERM', () => gracefulShutdown('sigterm', 0));
  process.on('SIGINT', () => gracefulShutdown('sigint', 0));
}

// Start server
async function start() {
  try {
    installProcessGuards();
    const db = await initDatabase();
    
    // Create or update default admin user
    await createDefaultAdminUser(db, config.adminDefaultUsername, config.adminDefaultPassword);
    logger.logger.info(`✓ Standard-Admin-Benutzer erstellt/aktualisiert (${config.adminDefaultUsername}/${config.adminDefaultPassword})`);
    await initializeAdminBackgroundLoops();

    startEmailQueueWorker();
    startMailboxSyncWorker();
    startAiQueueWorker();
    startTranslationPlannerWorker();
    startCitizenAuthCleanupWorker();

    server = app.listen(config.port, '0.0.0.0');
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 70_000;
    server.requestTimeout = 180_000;
    server.on('listening', () => {
      const dbInfo =
        config.databaseClient === 'mysql'
          ? `${config.mysql.user}@${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`
          : config.databasePath;
      console.log(`\n🚀 Server läuft auf http://0.0.0.0:${config.port}`);
      console.log(`📚 API: http://localhost:${config.port}/api`);
      console.log(`📖 Swagger UI: http://localhost:${config.port}/api/docs`);
      console.log(`🔗 Frontend (PWA): http://localhost:5173`);
      console.log(`🔐 Admin Panel: http://localhost:5174`);
      console.log(`👤 Standard-Login: admin / admin123`);
      console.log(`📌 Environment: ${config.nodeEnv}`);
      console.log(`🗄️  Datenbank (${config.databaseClient}): ${dbInfo}\n`);
    });
    server.on('error', (error: NodeJS.ErrnoException) => {
      logger.logger.error({ err: error }, 'HTTP-Server konnte nicht starten');
      if (error?.code === 'EADDRINUSE') {
        logger.logger.error(
          { port: config.port },
          'Port bereits in Benutzung. Bitte laufenden Prozess prüfen oder PORT anpassen.'
        );
      }
      process.exit(1);
    });
  } catch (err) {
    logger.logger.error({ err }, 'Fehler beim Starten des Servers');
    process.exit(1);
  }
}

start();
