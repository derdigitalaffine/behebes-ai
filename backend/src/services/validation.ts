/**
 * © Dominik Troester, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * Validation Service (Double Opt-In)
 */

import crypto from 'crypto';
import { renderStoredTemplate, sendEmail } from './email.js';
import type { AppDatabase } from '../database.js';
import { loadGeneralSettings } from './settings.js';
import { buildCallbackLink, buildTicketStatusCallbackLink } from './callback-links.js';
import { formatSqlDateTime } from '../utils/sql-date.js';

const VALIDATION_EXPIRY_HOURS = 48; // Tokens valid for 48 hours

export function buildValidationLink(baseUrl: string, token: string): string {
  return buildCallbackLink(baseUrl, {
    token,
    cb: 'ticket_validation',
  });
}

export function buildValidationEmailHtml(
  citizenName: string,
  validationLink: string,
  statusLink?: string
): string {
  return `
    <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #001c31;">
      <div style="background: #003762; color: #ffffff; padding: 16px 20px; border-radius: 10px 10px 0 0;">
        <h2 style="margin: 0; font-size: 20px;">Bitte E-Mail bestätigen</h2>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; padding: 20px;">
        <p>Hallo ${citizenName},</p>
        <p>vielen Dank für Ihre Meldung. Bitte bestätigen Sie Ihre E-Mail-Adresse, indem Sie den folgenden Link öffnen:</p>
        <p>Erst nach der Bestätigung können wir Ihre Meldung bearbeiten.</p>
        <p>Sollten Sie keine E-Mail erwartet haben oder diese Anfrage nicht von Ihnen stammen, können Sie diese Nachricht ignorieren.</p>
        <p>Den Bearbeitungsstatus Ihrer Meldung können Sie über folgenden Link einsehen:</p>

        <div style="margin: 20px 0 22px 0;">
          <a href="${validationLink}"
             style="display: inline-block; background: #00457c; color: #ffffff; padding: 11px 18px; text-decoration: none; border-radius: 6px; font-weight: 700; margin: 0 10px 10px 0;">
            Bestätigung Ihrer E-Mailadresse
          </a>
          ${
            statusLink
              ? `<a href="${statusLink}"
             style="display: inline-block; background: #003762; color: #ffffff; padding: 11px 18px; text-decoration: none; border-radius: 6px; font-weight: 700; margin: 0 0 10px 0;">
            Bearbeitungsstatus
          </a>`
              : ''
          }
        </div>

        <div style="background: #f1f6fb; border: 1px solid #c8d7e5; border-radius: 8px; padding: 12px 14px;">
          <p style="margin: 0 0 8px 0;"><strong>Direktlink</strong></p>
          <p style="margin: 0; word-break: break-all; font-size: 13px; color: #35556f;">${validationLink}</p>
          ${
            statusLink
              ? `<p style="margin: 8px 0 0 0; word-break: break-all; font-size: 13px; color: #35556f;">Status: ${statusLink}</p>`
              : ''
          }
        </div>

        <p style="margin-top: 14px; color: #4f667f; font-size: 12px;">
          Der Link ist ${VALIDATION_EXPIRY_HOURS} Stunden gültig.
        </p>
      </div>
    </div>
  `;
}

export async function createValidationRecord(
  db: AppDatabase,
  input: {
    ticketId: string;
    submissionId: string;
    citizenEmail: string;
  }
): Promise<{ validationId: string; validationToken: string; expiresAt: Date }> {
  const validationToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + VALIDATION_EXPIRY_HOURS * 60 * 60 * 1000);
  const validationId = `val_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  await db.run(
    `INSERT INTO ticket_validations (id, ticket_id, submission_id, citizen_email, validation_token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [validationId, input.ticketId, input.submissionId, input.citizenEmail, validationToken, formatSqlDateTime(expiresAt)]
  );

  await db.run(
    `UPDATE tickets SET validation_token = ?, status = 'pending_validation', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [validationToken, input.ticketId]
  );

  return { validationId, validationToken, expiresAt };
}

export async function sendValidationEmailToCitizen(
  citizenEmail: string,
  citizenName: string,
  validationToken: string,
  _language?: string,
  _languageName?: string
): Promise<boolean> {
  const { values } = await loadGeneralSettings();
  const validationLink = buildValidationLink(values.callbackUrl, validationToken);
  const statusLink = buildTicketStatusCallbackLink(values.callbackUrl, {
    token: validationToken,
  });
  const templateData = {
    citizenName,
    validationLink,
    statusLink,
  };
  const renderedTemplate = await renderStoredTemplate('validation-email', templateData, {
    subject: 'Bestaetigen Sie Ihre Meldung',
    htmlContent: buildValidationEmailHtml(citizenName, validationLink, statusLink),
    textContent: `Hallo ${citizenName},

vielen Dank für Ihre Meldung. Bitte bestätigen Sie Ihre E-Mail-Adresse über folgenden Link:
Bestätigungslink: ${validationLink}
Statuslink: ${statusLink}

Erst nach der Bestätigung können wir Ihre Meldung bearbeiten.
Sollten Sie keine E-Mail erwartet haben oder diese Anfrage nicht von Ihnen stammen, können Sie diese Nachricht ignorieren.`,
  });
  return sendEmail({
    to: citizenEmail,
    subject: renderedTemplate.subject,
    html: renderedTemplate.html,
    text: renderedTemplate.text,
    translateForCitizen: true,
    translationTemplateId: 'validation-email',
    translationTemplateData: templateData,
  });
}

export async function createAndSendValidation(
  db: AppDatabase,
  input: {
    ticketId: string;
    submissionId: string;
    citizenEmail: string;
    citizenName: string;
    language?: string;
    languageName?: string;
  }
): Promise<{ validationId: string; validationToken: string; expiresAt: Date }> {
  const record = await createValidationRecord(db, input);
  const sent = await sendValidationEmailToCitizen(
    input.citizenEmail,
    input.citizenName,
    record.validationToken,
    input.language,
    input.languageName
  );

  if (!sent) {
    throw new Error('Email konnte nicht versendet werden');
  }

  return record;
}

export { VALIDATION_EXPIRY_HOURS };
