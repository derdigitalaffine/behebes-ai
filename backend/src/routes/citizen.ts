import express, { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  allowCitizenRequestLinkRateLimit,
  buildCitizenRedirectUrl,
  citizenAuthConstants,
  clearCitizenSessionCookie,
  consumeCitizenMagicLink,
  createCitizenMagicLink,
  createCitizenSession,
  getCitizenRequestContext,
  normalizeCitizenEmail,
  resolveCitizenSessionFromRequest,
  revokeCitizenSessionByRequest,
  setCitizenSessionCookie,
  validateCitizenEmail,
} from '../services/citizen-auth.js';
import { getDatabase } from '../database.js';
import { loadGeneralSettings, resolveCitizenFrontendProfile } from '../services/settings.js';
import { renderStoredTemplate, sendEmail } from '../services/email.js';
import { wrapLinkForPwaOpenGate } from '../services/callback-links.js';
import {
  getCitizenPushPublicKey,
  getCitizenUnreadMessageCount,
  isCitizenPushEnabled,
  listCitizenAppMessages,
  markAllCitizenMessagesRead,
  markCitizenMessageReadState,
  revokeCitizenPushSubscription,
  upsertCitizenPushSubscription,
} from '../services/citizen-messages.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXECUTIONS_FILE = resolve(__dirname, '..', '..', 'knowledge', 'executions.json');

const GENERIC_LINK_REQUEST_MESSAGE =
  'Falls ein Konto zu dieser E-Mail-Adresse existiert, wurde ein Anmeldelink versendet.';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFrontendToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 80);
}

function normalizeRedirectPath(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '/me';
  if (!raw.startsWith('/')) return '/me';
  if (raw.startsWith('//')) return '/me';
  return raw.slice(0, 240);
}

function normalizePurpose(value: unknown): 'login' | 'verify_and_login' {
  return String(value || '').trim() === 'verify_and_login' ? 'verify_and_login' : 'login';
}

function normalizePushSubscriptionPayload(value: unknown): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as any;
  const endpoint = normalizeString(source.endpoint);
  const p256dh = normalizeString(source.keys?.p256dh);
  const auth = normalizeString(source.keys?.auth);
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    keys: { p256dh, auth },
  };
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function guessImageMimeType(fileName?: string, buffer?: Buffer | null): string {
  const lowered = String(fileName || '').toLowerCase();
  if (lowered.endsWith('.png')) return 'image/png';
  if (lowered.endsWith('.gif')) return 'image/gif';
  if (lowered.endsWith('.webp')) return 'image/webp';
  if (lowered.endsWith('.bmp')) return 'image/bmp';
  if (lowered.endsWith('.svg')) return 'image/svg+xml';
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) return 'image/jpeg';
  if (!buffer || buffer.length < 4) return 'image/jpeg';

  const signature = buffer.subarray(0, 4).toString('hex');
  if (signature === '89504e47') return 'image/png';
  if (signature.startsWith('ffd8ff')) return 'image/jpeg';
  if (signature === '47494638') return 'image/gif';
  if (signature === '52494646') return 'image/webp';
  return 'image/jpeg';
}

function parseCursor(cursor: string): { createdAt: string; ticketId: string } | null {
  const raw = String(cursor || '').trim();
  if (!raw) return null;
  const parts = raw.split('|');
  if (parts.length !== 2) return null;
  const createdAt = normalizeString(parts[0]);
  const ticketId = normalizeString(parts[1]);
  if (!createdAt || !ticketId) return null;
  return { createdAt, ticketId };
}

function makeCursor(createdAt: string, ticketId: string): string {
  return `${createdAt}|${ticketId}`;
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

async function requireCitizenSession(req: Request, res: Response): Promise<Awaited<ReturnType<typeof resolveCitizenSessionFromRequest>> | null> {
  const session = await resolveCitizenSessionFromRequest(req);
  if (!session) {
    clearCitizenSessionCookie(res);
    res.status(401).json({
      authenticated: false,
      error: 'Authentifizierung erforderlich',
    });
    return null;
  }
  return session;
}

async function findTicketForCitizen(ticketId: string, citizenEmailNormalized: string): Promise<any | null> {
  const db = getDatabase();
  const ticket = await db.get(
    `SELECT t.*,
            s.original_description AS submission_original_description,
            s.anonymized_text AS submission_anonymized_text,
            s.address AS submission_address,
            s.postal_code AS submission_postal_code,
            s.city AS submission_city,
            s.created_at AS submission_created_at,
            c.name AS citizen_name,
            c.email AS citizen_email
     FROM tickets t
     LEFT JOIN submissions s ON s.id = t.submission_id
     LEFT JOIN citizens c ON c.id = t.citizen_id
     WHERE t.id = ?
       AND (
         t.citizen_email_normalized = ?
         OR (
           (t.citizen_email_normalized IS NULL OR TRIM(t.citizen_email_normalized) = '')
           AND LOWER(TRIM(c.email)) = ?
         )
       )
     LIMIT 1`,
    [ticketId, citizenEmailNormalized, citizenEmailNormalized]
  );
  return ticket || null;
}

/**
 * POST /api/citizen/auth/request-link
 */
router.post('/auth/request-link', async (req: Request, res: Response) => {
  const email = normalizeString(req.body?.email);
  const frontendToken = normalizeFrontendToken(req.body?.frontendToken);
  const purpose = normalizePurpose(req.body?.purpose);
  const redirectPath = normalizeRedirectPath(req.body?.redirectPath);
  const ctx = getCitizenRequestContext(req);

  if (!validateCitizenEmail(email)) {
    return res.status(202).json({ message: GENERIC_LINK_REQUEST_MESSAGE });
  }

  if (!allowCitizenRequestLinkRateLimit(email, ctx.ipAddress)) {
    return res.status(202).json({ message: GENERIC_LINK_REQUEST_MESSAGE });
  }

  try {
    const { values: general } = await loadGeneralSettings();
    const resolvedProfile = resolveCitizenFrontendProfile(general, frontendToken);
    if (!resolvedProfile.citizenAuthEnabled) {
      return res.status(202).json({ message: GENERIC_LINK_REQUEST_MESSAGE });
    }

    const created = await createCitizenMagicLink({
      email,
      purpose,
      frontendProfileToken: resolvedProfile.token || frontendToken,
      redirectPath,
      requestIp: ctx.ipAddress,
    });

    const loginUrl = new URL(
      await buildCitizenRedirectUrl(req, '/verify', resolvedProfile.token || frontendToken)
    );
    loginUrl.searchParams.set('token', created.token);
    loginUrl.searchParams.set('cb', 'citizen_login');
    const loginLink = wrapLinkForPwaOpenGate(loginUrl.toString());

    const templateData = {
      citizenName: email,
      loginLink,
      expiresInMinutes: String(citizenAuthConstants.MAGIC_LINK_TTL_MINUTES),
      ticketId: '',
    };

    const fallbackSubject = 'Anmeldelink für Ihre behebes.AI-App';
    const fallbackHtml = `
      <p>Guten Tag,</p>
      <p>Sie haben eine Anmeldung für die behebes.AI-Bürger-App angefordert.</p>
      <p><a href="${loginLink}" style="display:inline-block;padding:12px 20px;background:#003762;color:#ffffff;text-decoration:none;font-weight:700;">Jetzt in der App anmelden</a></p>
      <p>Der Link ist ${citizenAuthConstants.MAGIC_LINK_TTL_MINUTES} Minuten gültig.</p>
      <p>Falls Sie die Anmeldung nicht angefordert haben, können Sie diese E-Mail ignorieren.</p>
    `;

    const rendered = await renderStoredTemplate('citizen_login_magic_link', templateData, {
      subject: fallbackSubject,
      htmlContent: fallbackHtml,
      textContent: `Guten Tag,\n\nSie haben eine Anmeldung für die behebes.AI-Bürger-App angefordert.\n\nJetzt anmelden: ${loginLink}\n\nDer Link ist ${citizenAuthConstants.MAGIC_LINK_TTL_MINUTES} Minuten gültig.`,
    });

    await sendEmail({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      translateForCitizen: true,
      translationTemplateId: 'citizen_login_magic_link',
      translationTemplateData: templateData,
    });
  } catch (error) {
    console.warn('Citizen magic-link request failed:', error);
  }

  return res.status(202).json({ message: GENERIC_LINK_REQUEST_MESSAGE });
});

/**
 * GET /api/citizen/auth/verify?token=...
 */
router.get('/auth/verify', async (req: Request, res: Response) => {
  const token = normalizeString(req.query.token);
  const fallbackFrontendToken = normalizeFrontendToken(req.query.frontendToken || req.query.profileToken);

  const redirectToLoginWithError = async () => {
    const loginUrl = new URL(await buildCitizenRedirectUrl(req, '/login', fallbackFrontendToken));
    loginUrl.searchParams.set('state', 'invalid_link');
    return res.redirect(loginUrl.toString());
  };

  if (!token) {
    return redirectToLoginWithError();
  }

  try {
    const consumed = await consumeCitizenMagicLink(token);
    if (!consumed) {
      return redirectToLoginWithError();
    }

    const session = await createCitizenSession({
      accountId: consumed.accountId,
      frontendProfileToken: consumed.frontendProfileToken || fallbackFrontendToken,
      ipAddress: getCitizenRequestContext(req).ipAddress,
      userAgent: getCitizenRequestContext(req).userAgent,
    });

    setCitizenSessionCookie(res, session.token);
    const redirectUrl = await buildCitizenRedirectUrl(
      req,
      consumed.redirectPath || '/me',
      consumed.frontendProfileToken || fallbackFrontendToken
    );
    return res.redirect(redirectUrl);
  } catch (error) {
    console.warn('Citizen auth verify failed:', error);
    return redirectToLoginWithError();
  }
});

/**
 * GET /api/citizen/auth/session
 */
router.get('/auth/session', async (req: Request, res: Response) => {
  try {
    const pushAvailable = isCitizenPushEnabled();
    const pushPublicKey = getCitizenPushPublicKey();
    const session = await resolveCitizenSessionFromRequest(req);
    if (!session) {
      clearCitizenSessionCookie(res);
      return res.json({ authenticated: false, pushAvailable, pushPublicKey });
    }

    const requestedToken = normalizeFrontendToken(req.query.frontendToken || req.query.profileToken);
    const tokenForProfile = requestedToken || session.frontendProfileToken;
    const { values: general } = await loadGeneralSettings();
    const profile = resolveCitizenFrontendProfile(general, tokenForProfile);

    return res.json({
      authenticated: true,
      email: session.emailOriginal || session.email,
      emailNormalized: session.email,
      accountId: session.accountId,
      expiresAt: session.expiresAt,
      frontendProfileId: profile.profileId,
      frontendProfileName: profile.profileName,
      frontendToken: profile.token || tokenForProfile,
      citizenAuthEnabled: profile.citizenAuthEnabled,
      authenticatedIntakeWorkflowTemplateId: profile.authenticatedIntakeWorkflowTemplateId || null,
      pushAvailable,
      pushPublicKey,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Sessionstatus konnte nicht geladen werden' });
  }
});

/**
 * POST /api/citizen/auth/logout
 */
router.post('/auth/logout', async (req: Request, res: Response) => {
  try {
    await revokeCitizenSessionByRequest(req, 'logout');
  } catch {
    // ignore
  }
  clearCitizenSessionCookie(res);
  return res.json({ ok: true });
});

/**
 * GET /api/citizen/messages
 */
router.get('/messages', async (req: Request, res: Response) => {
  const session = await requireCitizenSession(req, res);
  if (!session) return;

  try {
    const statusRaw = normalizeString(req.query.status).toLowerCase();
    const status = statusRaw === 'read' || statusRaw === 'unread' ? statusRaw : 'all';
    const limitRaw = Number(req.query.limit);
    const offsetRaw = Number(req.query.offset);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 30;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const result = await listCitizenAppMessages(session.accountId, {
      status,
      limit,
      offset,
    });
    return res.json(result);
  } catch {
    return res.status(500).json({ error: 'Nachrichten konnten nicht geladen werden' });
  }
});

/**
 * GET /api/citizen/messages/unread-count
 */
router.get('/messages/unread-count', async (req: Request, res: Response) => {
  const session = await requireCitizenSession(req, res);
  if (!session) return;

  try {
    const unreadCount = await getCitizenUnreadMessageCount(session.accountId);
    return res.json({ unreadCount });
  } catch {
    return res.status(500).json({ error: 'Ungelesene Nachrichten konnten nicht geladen werden' });
  }
});

/**
 * PATCH /api/citizen/messages/:messageId
 */
router.patch('/messages/:messageId', async (req: Request, res: Response) => {
  const session = await requireCitizenSession(req, res);
  if (!session) return;

  try {
    const messageId = normalizeString(req.params.messageId);
    if (!messageId) return res.status(400).json({ error: 'Nachrichten-ID erforderlich' });
    const read = req.body?.read !== false;
    const updated = await markCitizenMessageReadState(session.accountId, messageId, read);
    if (!updated) return res.status(404).json({ error: 'Nachricht nicht gefunden' });
    const unreadCount = await getCitizenUnreadMessageCount(session.accountId);
    return res.json({ ok: true, unreadCount });
  } catch {
    return res.status(500).json({ error: 'Nachricht konnte nicht aktualisiert werden' });
  }
});

/**
 * POST /api/citizen/messages/read-all
 */
router.post('/messages/read-all', async (req: Request, res: Response) => {
  const session = await requireCitizenSession(req, res);
  if (!session) return;

  try {
    const changed = await markAllCitizenMessagesRead(session.accountId);
    return res.json({ ok: true, changed, unreadCount: 0 });
  } catch {
    return res.status(500).json({ error: 'Nachrichten konnten nicht als gelesen markiert werden' });
  }
});

/**
 * POST /api/citizen/push/subscribe
 */
router.post('/push/subscribe', async (req: Request, res: Response) => {
  const session = await requireCitizenSession(req, res);
  if (!session) return;

  if (!isCitizenPushEnabled() || !getCitizenPushPublicKey()) {
    return res.status(409).json({ error: 'Push-Benachrichtigungen sind derzeit nicht aktiviert' });
  }

  try {
    const subscription = normalizePushSubscriptionPayload(req.body?.subscription || req.body);
    if (!subscription) {
      return res.status(400).json({ error: 'Ungültige Push-Subscription' });
    }
    const saved = await upsertCitizenPushSubscription({
      accountId: session.accountId,
      sessionId: session.sessionId,
      userAgent: getCitizenRequestContext(req).userAgent,
      subscription,
    });
    return res.json({ ok: true, id: saved.id });
  } catch (error) {
    return res.status(500).json({ error: 'Push-Subscription konnte nicht gespeichert werden' });
  }
});

/**
 * POST /api/citizen/push/unsubscribe
 */
router.post('/push/unsubscribe', async (req: Request, res: Response) => {
  const session = await requireCitizenSession(req, res);
  if (!session) return;

  try {
    const endpoint = normalizeString(req.body?.endpoint);
    const revoked = await revokeCitizenPushSubscription({
      accountId: session.accountId,
      sessionId: session.sessionId,
      endpoint: endpoint || undefined,
    });
    return res.json({ ok: true, revoked });
  } catch {
    return res.status(500).json({ error: 'Push-Subscription konnte nicht entfernt werden' });
  }
});

/**
 * GET /api/citizen/tickets
 */
router.get('/tickets', async (req: Request, res: Response) => {
  const session = await requireCitizenSession(req, res);
  if (!session) return;

  try {
    const db = getDatabase();
    const statusFilter = normalizeString(req.query.status);
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 20;
    const cursor = parseCursor(normalizeString(req.query.cursor));

    const whereParts: string[] = [
      `(t.citizen_email_normalized = ? OR ((t.citizen_email_normalized IS NULL OR TRIM(t.citizen_email_normalized) = '') AND LOWER(TRIM(c.email)) = ?))`,
    ];
    const params: any[] = [session.email, session.email];

    if (statusFilter) {
      whereParts.push(`LOWER(TRIM(t.status)) = ?`);
      params.push(statusFilter.toLowerCase());
    }

    if (cursor) {
      whereParts.push(`(t.created_at < ? OR (t.created_at = ? AND t.id < ?))`);
      params.push(cursor.createdAt, cursor.createdAt, cursor.ticketId);
    }

    const rows = await db.all(
      `SELECT t.id,
              t.category,
              t.priority,
              t.status,
              t.created_at,
              t.updated_at,
              t.address,
              t.postal_code,
              t.city,
              t.latitude,
              t.longitude,
              t.redmine_issue_id,
              t.assigned_to,
              t.responsibility_authority,
              c.name AS citizen_name
       FROM tickets t
       LEFT JOIN citizens c ON c.id = t.citizen_id
       WHERE ${whereParts.join(' AND ')}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ?`,
      [...params, limit + 1]
    );

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const last = sliced[sliced.length - 1];
    const nextCursor = hasMore && last ? makeCursor(String(last.created_at || ''), String(last.id || '')) : null;

    return res.json({
      items: sliced.map((row: any) => ({
        ticketId: row.id,
        category: row.category,
        priority: row.priority,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        address: row.address,
        postalCode: row.postal_code,
        city: row.city,
        latitude: normalizeOptionalNumber(row.latitude),
        longitude: normalizeOptionalNumber(row.longitude),
        redmineIssueId: row.redmine_issue_id || null,
        assignedTo: row.assigned_to || null,
        responsibilityAuthority: row.responsibility_authority || null,
        citizenName: row.citizen_name || '',
      })),
      nextCursor,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Meldungen konnten nicht geladen werden' });
  }
});

/**
 * GET /api/citizen/tickets/:ticketId
 */
router.get('/tickets/:ticketId', async (req: Request, res: Response) => {
  const session = await requireCitizenSession(req, res);
  if (!session) return;

  try {
    const ticketId = normalizeString(req.params.ticketId);
    if (!ticketId) {
      return res.status(400).json({ error: 'Ticket-ID erforderlich' });
    }

    const ticket = await findTicketForCitizen(ticketId, session.email);
    if (!ticket) {
      return res.status(403).json({ error: 'Kein Zugriff auf dieses Ticket' });
    }

    const db = getDatabase();
    const imageRows = await db.all(
      `SELECT id, file_name, created_at, length(image_data) AS byte_size
       FROM submission_images
       WHERE submission_id = ?
       ORDER BY created_at ASC`,
      [ticket.submission_id]
    );
    const images = (imageRows || []).map((row: any) => ({
      id: String(row?.id || ''),
      fileName: row?.file_name || 'bild',
      createdAt: row?.created_at || null,
      byteSize: Number(row?.byte_size || 0),
      url: `/api/citizen/tickets/${encodeURIComponent(ticketId)}/images/${encodeURIComponent(String(row?.id || ''))}`,
    }));

    const workflow = loadLatestWorkflowSummary(ticketId);
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

    return res.json({
      ticketId: ticket.id,
      status: ticket.status,
      category: ticket.category,
      priority: ticket.priority,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at || null,
      description,
      address: ticket.address || ticket.submission_address || '',
      postalCode: ticket.postal_code || ticket.submission_postal_code || '',
      city: ticket.city || ticket.submission_city || '',
      latitude: normalizeOptionalNumber(ticket.latitude),
      longitude: normalizeOptionalNumber(ticket.longitude),
      assignedTo: ticket.assigned_to || null,
      redmineIssueId: ticket.redmine_issue_id || null,
      responsibilityAuthority: ticket.responsibility_authority || null,
      citizenName: ticket.citizen_name || '',
      citizenEmail: ticket.citizen_email || '',
      images,
      workflow: workflowSummary,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Ticket konnte nicht geladen werden' });
  }
});

/**
 * GET /api/citizen/tickets/:ticketId/history
 */
router.get('/tickets/:ticketId/history', async (req: Request, res: Response) => {
  const session = await requireCitizenSession(req, res);
  if (!session) return;

  try {
    const ticketId = normalizeString(req.params.ticketId);
    if (!ticketId) {
      return res.status(400).json({ error: 'Ticket-ID erforderlich' });
    }

    const ticket = await findTicketForCitizen(ticketId, session.email);
    if (!ticket) {
      return res.status(403).json({ error: 'Kein Zugriff auf dieses Ticket' });
    }

    const db = getDatabase();
    const publicComments = await db.all(
      `SELECT id, author_type, author_name, comment_type, content, metadata_json, created_at
       FROM ticket_comments
       WHERE ticket_id = ? AND visibility = 'public'
       ORDER BY created_at ASC`,
      [ticketId]
    );

    const comments = (publicComments || []).map((comment: any) => {
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
        authorName: comment.author_name || '',
        commentType: comment.comment_type || 'note',
        content: comment.content || '',
        metadata,
        createdAt: comment.created_at || null,
      };
    });

    const workflow = loadLatestWorkflowSummary(ticketId);
    const milestones = workflow
      ? workflow.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          type: task.type,
          status: task.status,
          order: task.order,
        }))
      : [];

    return res.json({
      ticketId,
      status: ticket.status,
      comments,
      milestones,
      workflow: workflow
        ? {
            id: workflow.id,
            title: workflow.title,
            status: workflow.status,
            startedAt: workflow.startedAt || null,
            completedAt: workflow.completedAt || null,
          }
        : null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Historie konnte nicht geladen werden' });
  }
});

/**
 * GET /api/citizen/tickets/:ticketId/images/:imageId
 */
router.get('/tickets/:ticketId/images/:imageId', async (req: Request, res: Response) => {
  const session = await requireCitizenSession(req, res);
  if (!session) return;

  try {
    const ticketId = normalizeString(req.params.ticketId);
    const imageId = normalizeString(req.params.imageId);
    if (!ticketId || !imageId) {
      return res.status(400).json({ error: 'Ticket-ID und Bild-ID erforderlich' });
    }

    const ticket = await findTicketForCitizen(ticketId, session.email);
    if (!ticket?.submission_id) {
      return res.status(403).json({ error: 'Kein Zugriff auf dieses Bild' });
    }

    const db = getDatabase();
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

    const mimeType = guessImageMimeType((row as any)?.file_name, buffer);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({ error: 'Bild konnte nicht geladen werden' });
  }
});

export default router;
