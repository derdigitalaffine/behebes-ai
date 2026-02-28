/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Ticket Validation & Double Opt-In
 */

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database.js';
import { applyClassificationToExistingTicket, appendAiReasoningToDescription } from '../services/ai.js';
import {
  createAndSendValidation,
  sendValidationEmailToCitizen,
  VALIDATION_EXPIRY_HOURS,
} from '../services/validation.js';
import { classifySubmission, loadKnowledgeBase } from '../services/classification.js';
import { authMiddleware, staffOnly } from '../middleware/auth.js';
import { attachWorkflowToTicket } from './workflows.js';
import { sendStatusChangeNotification, sendSubmissionConfirmation } from '../services/email.js';
import { publishTicketUpdate } from '../services/realtime.js';
import { formatSqlDateTime } from '../utils/sql-date.js';
import {
  createCitizenSession,
  ensureCitizenAccount,
  getCitizenRequestContext,
  setCitizenSessionCookie,
} from '../services/citizen-auth.js';

const router = express.Router();

function normalizeLanguageCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
}

function resolveRequestLanguageCode(req: Request): string {
  const header = String(req.headers['accept-language'] || '').trim().toLowerCase();
  if (!header) return 'de';
  const first = header
    .split(',')
    .map((entry) => entry.split(';')[0].trim())
    .find(Boolean);
  return normalizeLanguageCode(first || 'de') || 'de';
}

function isGermanLanguageCode(value: unknown): boolean {
  const normalized = normalizeLanguageCode(value);
  return !normalized || normalized === 'de' || normalized.startsWith('de-');
}

function normalizeFrontendToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 80);
}

function localizeCitizenMessage(languageCode: string, deMessage: string, enMessage: string): string {
  return isGermanLanguageCode(languageCode) ? deMessage : enMessage;
}

function parseNominatimRaw(value: unknown): Record<string, any> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseWeatherReportRaw(value: unknown): Record<string, any> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function ensureManualValidationRecord(db: any, input: {
  ticketId: string;
  submissionId: string;
  citizenEmail: string;
}): Promise<string> {
  const existing = await db.get(
    `SELECT * FROM ticket_validations WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1`,
    [input.ticketId]
  );

  if (existing) {
    if (!existing.validated_at) {
      await db.run(
        `UPDATE ticket_validations SET validated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [existing.id]
      );
    }
    if (existing.validation_token) {
      await db.run(
        `UPDATE tickets SET validation_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [existing.validation_token, input.ticketId]
      );
    }
    return existing.validation_token;
  }

  const validationToken = crypto.randomBytes(32).toString('hex');
  const validationId = `val_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const expiresAt = new Date(Date.now() + VALIDATION_EXPIRY_HOURS * 60 * 60 * 1000);

  await db.run(
    `INSERT INTO ticket_validations (id, ticket_id, submission_id, citizen_email, validation_token, validated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [validationId, input.ticketId, input.submissionId, input.citizenEmail, validationToken, formatSqlDateTime(expiresAt)]
  );

  await db.run(
    `UPDATE tickets SET validation_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [validationToken, input.ticketId]
  );

  return validationToken;
}

async function addManualValidationAuditComment(input: {
  db: any;
  ticketId: string;
  userId: string;
  username: string;
  action: 'manual_commit' | 'manual_reject';
  lines: string[];
  metadata: Record<string, any>;
}): Promise<void> {
  const commentId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await input.db.run(
    `INSERT INTO ticket_comments (
      id, ticket_id, author_type, author_id, author_name, visibility, comment_type, content, metadata_json
    ) VALUES (?, ?, 'staff', ?, ?, 'internal', 'note', ?, ?)`,
    [
      commentId,
      input.ticketId,
      input.userId || null,
      input.username || null,
      input.lines.join('\n'),
      JSON.stringify({
        source: `admin.validation.${input.action}`,
        ...input.metadata,
      }),
    ]
  );
}

async function maybeTriggerCategoryWorkflow(ticketId: string, categoryNameOrId?: string | null) {
  if (!categoryNameOrId) return;
  try {
    const knowledge = await loadKnowledgeBase();
    const needle = categoryNameOrId.toLowerCase();
    const category = (knowledge.categories || []).find(
      (c: any) =>
        (typeof c.id === 'string' && c.id.toLowerCase() === needle) ||
        (typeof c.name === 'string' && c.name.toLowerCase() === needle)
    );

    const workflowTemplateId = category?.workflowTemplateId || category?.workflowId || null;
    if (!workflowTemplateId) return;
    const normalized = String(workflowTemplateId).toLowerCase().trim();
    const resolvedWorkflowTemplateId =
      normalized === 'redmine-ticket' || normalized === 'redmine ticket' || normalized === 'redmine_ticket'
        ? 'standard-redmine-ticket'
        : workflowTemplateId;

    await attachWorkflowToTicket(ticketId, resolvedWorkflowTemplateId, { skipIfExisting: true });
  } catch (error) {
    console.error('Workflow auto-trigger failed:', error);
  }
}

async function finalizeValidatedTicketInBackground(ticketId: string, submissionId: string): Promise<void> {
  const db = getDatabase();

  try {
    await applyClassificationToExistingTicket(db, submissionId, ticketId);
  } catch (aiError: any) {
    console.error('AI classification after validation failed:', aiError);
    await db.run(
      `UPDATE tickets SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticketId]
    );
  }

  try {
    const ticketInfo = await db.get(
      `SELECT t.category, t.priority, t.validation_token, c.name as citizen_name, c.email as citizen_email
       FROM tickets t
       LEFT JOIN citizens c ON c.id = t.citizen_id
       WHERE t.id = ?`,
      [ticketId]
    );

    await maybeTriggerCategoryWorkflow(ticketId, ticketInfo?.category);

    if (ticketInfo?.citizen_email) {
      await sendSubmissionConfirmation(
        ticketInfo.citizen_email,
        ticketInfo.citizen_name || 'Bürger',
        ticketId,
        ticketInfo?.category || 'Allgemein',
        ticketInfo?.priority || 'medium',
        ticketInfo?.validation_token || undefined
      );
    }
  } catch (error) {
    console.error('Post-validation background tasks failed:', error);
  }

  publishTicketUpdate({
    reason: 'ticket.validation.processing_completed',
    ticketId,
  });
}

/**
 * POST /api/validations/send
 * Sends validation email for new ticket (Double Opt-In)
 * Internal use - called after ticket creation
 */
router.post('/send', async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId, submissionId, citizenEmail, citizenName, language, languageName } = req.body;

    if (!ticketId || !submissionId || !citizenEmail) {
      return res.status(400).json({ 
        message: 'ticketId, submissionId, citizenEmail erforderlich' 
      });
    }

    const db = getDatabase();
    const record = await createAndSendValidation(db, {
      ticketId,
      submissionId,
      citizenEmail,
      citizenName: citizenName || 'Buerger',
      language,
      languageName,
    });

    res.json({
      message: 'Validierungs-Email versendet',
      validationId: record.validationId,
    });
  } catch (error) {
    console.error('Error sending validation email:', error);
    return res.status(500).json({ message: 'Fehler beim Versenden der Validierungs-Email' });
  }
});

/**
 * GET /api/validations/verify/:token
 * Validates a ticket using the token
 */
router.get('/verify/:token', async (req: Request, res: Response): Promise<any> => {
  try {
    const { token } = req.params;
    let languageCode = resolveRequestLanguageCode(req);

    if (!token) {
      return res.status(400).json({
        message: localizeCitizenMessage(languageCode, 'Token erforderlich', 'Token is required'),
      });
    }

    const db = getDatabase();

    // Find validation record
    const validation = await db.get(`
      SELECT * FROM ticket_validations 
      WHERE validation_token = ?
    `, [token]);

    if (!validation) {
      return res.status(404).json({
        message: localizeCitizenMessage(
          languageCode,
          'Validierungs-Token ungültig oder abgelaufen',
          'Validation token is invalid or expired'
        ),
      });
    }

    const ticketLanguage = await db.get(
      `SELECT COALESCE(t.citizen_language, c.preferred_language) AS citizen_language_code
       FROM tickets t
       LEFT JOIN citizens c ON c.id = t.citizen_id
       WHERE t.id = ?
       LIMIT 1`,
      [validation.ticket_id]
    );
    languageCode = normalizeLanguageCode(ticketLanguage?.citizen_language_code || languageCode) || 'de';

    // Check expiry
    const expiresAt = new Date(validation.expires_at);
    if (expiresAt < new Date()) {
      return res.status(410).json({
        message: localizeCitizenMessage(
          languageCode,
          'Validierungs-Token abgelaufen',
          'Validation token has expired'
        ),
      });
    }

    let alreadyValidated = !!validation.validated_at;
    if (!alreadyValidated) {
      // Prevent duplicate background processing when same link is opened multiple times.
      const markResult = await db.run(
        `UPDATE ticket_validations
         SET validated_at = CURRENT_TIMESTAMP
         WHERE validation_token = ? AND validated_at IS NULL`,
        [token]
      );
      alreadyValidated = !markResult?.changes;
    }

    if (!alreadyValidated) {
      // Decouple citizen-facing verification from AI runtime:
      // the classification is queued/serialized and finishes in the background.
      void finalizeValidatedTicketInBackground(validation.ticket_id, validation.submission_id).catch((error) => {
        console.error('Validation background finalization failed:', error);
      });
    }

    let autoLoginApplied = false;
    const autoLoginQueryValue = String(req.query.autoLogin ?? '1').trim().toLowerCase();
    const autoLoginEnabled = !['0', 'false', 'no', 'off'].includes(autoLoginQueryValue);
    if (autoLoginEnabled && validation.citizen_email) {
      try {
        const account = await ensureCitizenAccount(String(validation.citizen_email));
        const context = getCitizenRequestContext(req);
        const frontendToken = normalizeFrontendToken(req.query.frontendToken || req.query.profileToken);
        const session = await createCitizenSession({
          accountId: account.id,
          frontendProfileToken: frontendToken,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });
        setCitizenSessionCookie(res, session.token);
        autoLoginApplied = true;
      } catch (sessionError) {
        console.warn('Citizen auto-login during validation failed:', sessionError);
      }
    }

    res.json({
      message: localizeCitizenMessage(
        languageCode,
        'E-Mail-Adresse erfolgreich bestätigt.',
        'Email address successfully confirmed.'
      ),
      ticketId: validation.ticket_id,
      processingQueued: !alreadyValidated,
      autoLoginApplied,
    });

    publishTicketUpdate({
      reason: alreadyValidated ? 'ticket.validation.checked' : 'ticket.validated',
      ticketId: validation.ticket_id,
    });
  } catch (error) {
    console.error('Error verifying ticket:', error);
    const languageCode = resolveRequestLanguageCode(req);
    res.status(500).json({
      message: localizeCitizenMessage(languageCode, 'Fehler bei der Validierung', 'Validation failed'),
    });
  }
});

/**
 * GET /api/validations/:ticketId/status
 * Check validation status of a ticket
 */
router.get('/:ticketId/status', async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
    const db = getDatabase();

    const validation = await db.get(`
      SELECT id, validated_at, created_at, expires_at 
      FROM ticket_validations 
      WHERE ticket_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [ticketId]);

    if (!validation) {
      return res.status(404).json({ message: 'Keine Validierung für dieses Ticket' });
    }

    res.json({
      ticketId,
      isValidated: !!validation.validated_at,
      validatedAt: validation.validated_at,
      createdAt: validation.created_at,
      expiresAt: validation.expires_at,
    });
  } catch (error) {
    console.error('Error checking validation status:', error);
    res.status(500).json({ message: 'Fehler beim Abrufen des Validierungsstatus' });
  }
});

/**
 * POST /api/validations/resend
 * Resend validation email
 */
router.post('/resend', async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId, citizenEmail, citizenName, language, languageName } = req.body;

    if (!ticketId || !citizenEmail) {
      return res.status(400).json({ 
        message: 'ticketId und citizenEmail erforderlich' 
      });
    }

    const db = getDatabase();

    // Find existing validation
    const validation = await db.get(`
      SELECT * FROM ticket_validations 
      WHERE ticket_id = ? AND validated_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [ticketId]);

    if (!validation) {
      return res.status(404).json({ message: 'Keine ausstehende Validierung für dieses Ticket' });
    }

    await db.run(
      `UPDATE tickets SET validation_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [validation.validation_token, ticketId]
    );

    const sent = await sendValidationEmailToCitizen(
      citizenEmail,
      citizenName || 'Buerger',
      validation.validation_token,
      language,
      languageName
    );

    if (!sent) {
      return res.status(500).json({ 
        message: 'Email konnte nicht versendet werden' 
      });
    }

    res.json({ message: 'Validierungs-Email erneut versendet' });
  } catch (error) {
    console.error('Error resending validation email:', error);
    res.status(500).json({ message: 'Fehler beim Erneuten Versenden der Email' });
  }
});

/**
 * POST /api/validations/manual/:ticketId/preview
 * Admin preview: KI-Klassifizierung vorschlagen
 */
router.post('/manual/:ticketId/preview', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
    const db = getDatabase();

    const record = await db.get(
      `SELECT t.id as ticket_id, t.submission_id,
              s.anonymized_text, s.original_description,
              s.address, s.postal_code, s.city, s.latitude, s.longitude, s.nominatim_raw_json, s.weather_report_json
       FROM tickets t
       JOIN submissions s ON s.id = t.submission_id
       WHERE t.id = ?`,
      [ticketId]
    );

    if (!record) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    const description = record.anonymized_text || record.original_description || '';
    if (!description) {
      return res.status(400).json({ message: 'Keine Beschreibung vorhanden' });
    }

    const existingNominatimRaw = parseNominatimRaw(record.nominatim_raw_json);
    const { result, knowledge, raw, effectiveInput } = await classifySubmission({
      description,
      latitude: record.latitude ?? undefined,
      longitude: record.longitude ?? undefined,
      address: record.address ?? undefined,
      city: record.city ?? undefined,
      postalCode: record.postal_code ?? undefined,
      nominatimRaw: existingNominatimRaw,
      weatherReport: parseWeatherReportRaw(record.weather_report_json),
    });

    if (!existingNominatimRaw && effectiveInput?.nominatimRaw) {
      const latitude =
        effectiveInput?.latitude !== undefined && effectiveInput?.latitude !== null
          ? Number(effectiveInput.latitude)
          : record.latitude || null;
      const longitude =
        effectiveInput?.longitude !== undefined && effectiveInput?.longitude !== null
          ? Number(effectiveInput.longitude)
          : record.longitude || null;
      const address = String(effectiveInput?.address || record.address || '').trim() || null;
      const postalCode = String(effectiveInput?.postalCode || record.postal_code || '').trim() || null;
      const city = String(effectiveInput?.city || record.city || '').trim() || null;
      const nominatimRawJson = JSON.stringify(effectiveInput.nominatimRaw);

      await db.run(
        `UPDATE submissions
         SET latitude = ?, longitude = ?, address = ?, postal_code = ?, city = ?, nominatim_raw_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [latitude, longitude, address, postalCode, city, nominatimRawJson, record.submission_id]
      );
      await db.run(
        `UPDATE tickets
         SET latitude = ?, longitude = ?, address = ?, postal_code = ?, city = ?, nominatim_raw_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [latitude, longitude, address, postalCode, city, nominatimRawJson, ticketId]
      );
      publishTicketUpdate({
        reason: 'ticket.geocoded',
        ticketId: String(ticketId || ''),
      });
    }

    return res.json({
      ticketId,
      suggestion: {
        category: result.kategorie,
        priority: result.dringlichkeit,
        reasoning: result.reasoning,
        categoryId: result.categoryId,
      },
      rawDecision: raw,
      knowledgeVersion: knowledge?.version || null,
    });
  } catch (error: any) {
    console.error('Manual preview failed:', error);
    return res.status(500).json({ message: error?.message || 'Fehler beim Klassifizierungs-Preview' });
  }
});

/**
 * POST /api/validations/manual/:ticketId/commit
 * Admin commit: KI-Vorschlag übernehmen
 */
router.post('/manual/:ticketId/commit', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
    const { suggestion, rawDecision, knowledgeVersion } = req.body || {};
    const category = suggestion?.category || suggestion?.kategorie || '';
    const priority = suggestion?.priority || suggestion?.dringlichkeit || '';
    const reasoning = suggestion?.reasoning || '';

    if (!category) {
      return res.status(400).json({ message: 'Kategorie fehlt' });
    }

    const priorityOptions = ['low', 'medium', 'high', 'critical'];
    const finalPriority = priorityOptions.includes(priority) ? priority : 'medium';

    const db = getDatabase();
    const record = await db.get(
      `SELECT t.id as ticket_id, t.submission_id, t.status, t.category, t.priority,
              s.anonymized_text, s.original_description,
              s.address, s.postal_code, s.city, s.latitude, s.longitude,
              c.email as citizen_email
       FROM tickets t
       JOIN submissions s ON s.id = t.submission_id
       JOIN citizens c ON c.id = t.citizen_id
       WHERE t.id = ?`,
      [ticketId]
    );

    if (!record) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    const description = record.anonymized_text || record.original_description || '';
    const descriptionWithAnalysis = appendAiReasoningToDescription(description || null, reasoning || null);
    const shouldUpdateStatus = record.status === 'pending_validation' || record.status === 'pending';
    const nextStatus = shouldUpdateStatus ? 'open' : record.status;

    await db.run(
      `UPDATE tickets SET
        category = ?,
        priority = ?,
        description = ?,
        status = ?,
        latitude = ?,
        longitude = ?,
        address = ?,
        postal_code = ?,
        city = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        category,
        finalPriority,
        descriptionWithAnalysis || null,
        nextStatus,
        record.latitude || null,
        record.longitude || null,
        record.address || null,
        record.postal_code || null,
        record.city || null,
        ticketId,
      ]
    );

    await db.run(
      `UPDATE submissions SET category = ?, priority = ?, status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [category, finalPriority, record.submission_id]
    );

    const aiLogId = uuidv4();
    const aiDecisionPayload = rawDecision || {
      kategorie: category,
      dringlichkeit: finalPriority,
      reasoning,
    };

    await db.run(
      `INSERT INTO ai_logs (
        id, ticket_id, submission_id, knowledge_version,
        ai_decision, ai_reasoning, original_category,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        aiLogId,
        ticketId,
        record.submission_id,
        knowledgeVersion || null,
        JSON.stringify(aiDecisionPayload),
        reasoning || null,
        category,
      ]
    );

    await ensureManualValidationRecord(db, {
      ticketId,
      submissionId: record.submission_id,
      citizenEmail: record.citizen_email,
    });

    const userId = String((req as any).userId || '').trim();
    const username = String((req as any).username || '').trim();
    const auditLines = [
      'Ticket manuell verifiziert (Klassifizierung übernommen).',
      `- Status: ${String(record.status || '').trim() || '—'} -> ${nextStatus || '—'}`,
      `- Kategorie: ${String(record.category || '').trim() || '—'} -> ${category || '—'}`,
      `- Priorität: ${String(record.priority || '').trim() || '—'} -> ${finalPriority || '—'}`,
    ];
    if (String(reasoning || '').trim()) {
      const shortReasoning = String(reasoning).trim().slice(0, 500);
      auditLines.push(`- Begründung: ${shortReasoning}`);
    }
    await addManualValidationAuditComment({
      db,
      ticketId,
      userId,
      username,
      action: 'manual_commit',
      lines: auditLines,
      metadata: {
        previousStatus: String(record.status || '').trim() || null,
        nextStatus: nextStatus || null,
        previousCategory: String(record.category || '').trim() || null,
        nextCategory: category || null,
        previousPriority: String(record.priority || '').trim() || null,
        nextPriority: finalPriority || null,
        reasoning: String(reasoning || '').trim() || null,
      },
    });

    await maybeTriggerCategoryWorkflow(ticketId, category);

    publishTicketUpdate({
      reason: 'ticket.validation.manual_commit',
      ticketId,
    });

    res.json({ message: 'Klassifizierung übernommen und Ticket verifiziert', ticketId });
  } catch (error: any) {
    console.error('Manual commit failed:', error);
    res.status(500).json({ message: error?.message || 'Fehler beim Übernehmen der Klassifizierung' });
  }
});

/**
 * POST /api/validations/manual/:ticketId/reject
 * Admin reject: KI-Vorschlag verwerfen, Ticket nur verifizieren
 */
router.post('/manual/:ticketId/reject', authMiddleware, staffOnly, async (req: Request, res: Response): Promise<any> => {
  try {
    const { ticketId } = req.params;
    const db = getDatabase();

    const record = await db.get(
      `SELECT t.id as ticket_id, t.submission_id, t.category, t.priority, t.status, t.validation_token,
              c.email as citizen_email
       FROM tickets t
       JOIN citizens c ON c.id = t.citizen_id
       WHERE t.id = ?`,
      [ticketId]
    );

    if (!record) {
      return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    const shouldUpdateStatus = record.status === 'pending_validation' || record.status === 'pending';
    const nextStatus = shouldUpdateStatus ? 'open' : record.status;
    await db.run(
      `UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextStatus, ticketId]
    );

    if (record.status !== nextStatus && record.citizen_email) {
      await sendStatusChangeNotification(
        record.citizen_email,
        'Buerger',
        ticketId,
        record.status,
        nextStatus,
        undefined,
        record.validation_token || undefined
      );
    }

    await db.run(
      `UPDATE submissions SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [record.submission_id]
    );

    await ensureManualValidationRecord(db, {
      ticketId,
      submissionId: record.submission_id,
      citizenEmail: record.citizen_email,
    });

    const userId = String((req as any).userId || '').trim();
    const username = String((req as any).username || '').trim();
    await addManualValidationAuditComment({
      db,
      ticketId,
      userId,
      username,
      action: 'manual_reject',
      lines: [
        'Ticket manuell verifiziert (Klassifizierung verworfen).',
        `- Status: ${String(record.status || '').trim() || '—'} -> ${nextStatus || '—'}`,
        `- Kategorie bleibt: ${String(record.category || '').trim() || '—'}`,
        `- Priorität bleibt: ${String(record.priority || '').trim() || '—'}`,
      ],
      metadata: {
        previousStatus: String(record.status || '').trim() || null,
        nextStatus: nextStatus || null,
        category: String(record.category || '').trim() || null,
        priority: String(record.priority || '').trim() || null,
      },
    });

    publishTicketUpdate({
      reason: 'ticket.validation.manual_reject',
      ticketId,
    });

    res.json({ message: 'Ticket verifiziert, Klassifizierung verworfen', ticketId });
  } catch (error: any) {
    console.error('Manual reject failed:', error);
    res.status(500).json({ message: error?.message || 'Fehler beim Verwerfen der Klassifizierung' });
  }
});

export default router;
