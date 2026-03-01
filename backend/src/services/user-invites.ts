import crypto from 'crypto';
import { getDatabase } from '../database.js';
import { loadGeneralSettings } from './settings.js';
import { loadConfig } from '../config.js';
import { buildCallbackLink } from './callback-links.js';
import { sendEmail } from './email.js';
import { formatSqlDateTime } from '../utils/sql-date.js';

const INVITE_EXPIRY_HOURS = 72;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeAdminBaseUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/g, '') : '/admin';
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return '';
  }
}

async function buildInviteLink(token: string): Promise<string> {
  const { values: general } = await loadGeneralSettings();
  const config = loadConfig();
  const adminBase = normalizeAdminBaseUrl(config.adminUrl) || 'http://localhost:5174/admin';
  return buildCallbackLink(general.callbackUrl, {
    token,
    resetToken: token,
    cb: 'admin_password_reset',
    adminBase,
  });
}

function buildInviteEmailHtml(username: string, inviteLink: string): string {
  return `
    <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 640px; margin: 0 auto; line-height:1.45;">
      <h2 style="margin:0 0 12px 0;">Einladung zum behebes Admin-Bereich</h2>
      <p>Hallo ${username},</p>
      <p>für Ihr Benutzerkonto wurde ein Einladungslink erstellt. Über den Button können Sie ein Passwort setzen und Ihr Konto aktivieren.</p>
      <div style="text-align:center; margin:24px 0;">
        <a href="${inviteLink}" style="display:inline-block;background:#003762;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px;font-weight:700;">
          Passwort setzen und anmelden
        </a>
      </div>
      <p style="margin:0 0 8px 0;">Direktlink:</p>
      <p style="background:#ecf3f9;padding:12px;border-radius:8px;word-break:break-all;margin:0;">${inviteLink}</p>
      <p style="margin-top:12px;color:#526173;font-size:12px;">Der Link ist ${INVITE_EXPIRY_HOURS} Stunden gültig.</p>
    </div>
  `;
}

export async function issueUserInvite(input: {
  adminUserId: string;
  sentByAdminId?: string | null;
  metadata?: Record<string, any> | null;
  sendEmailNow?: boolean;
}): Promise<{ inviteId: string; resetId: string; token: string; expiresAt: string; inviteLink: string; sent: boolean }> {
  const db = getDatabase();
  const adminUserId = normalizeText(input.adminUserId);
  if (!adminUserId) {
    throw new Error('adminUserId fehlt');
  }

  const user = await db.get<any>(
    `SELECT id, username, email, active
     FROM admin_users
     WHERE id = ?
     LIMIT 1`,
    [adminUserId]
  );
  if (!user?.id) {
    throw new Error('Benutzer nicht gefunden');
  }
  const email = normalizeText(user?.email);
  if (!email) {
    throw new Error('Benutzer hat keine E-Mail-Adresse');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAtDate = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);
  const expiresAt = formatSqlDateTime(expiresAtDate);
  const inviteId = createId('uinvite');
  const resetId = createId('pwdreset');
  const sentByAdminId = normalizeText(input.sentByAdminId || '') || null;

  await db.run(
    `INSERT INTO admin_password_resets (id, admin_user_id, reset_token, expires_at)
     VALUES (?, ?, ?, ?)`,
    [resetId, adminUserId, token, expiresAt]
  );

  await db.run(
    `INSERT INTO user_invites (
       id, admin_user_id, invite_token, expires_at, sent_by_admin_id, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [inviteId, adminUserId, token, expiresAt, sentByAdminId, input.metadata ? JSON.stringify(input.metadata) : null]
  );

  const inviteLink = await buildInviteLink(token);
  let sent = false;
  if (input.sendEmailNow !== false) {
    await sendEmail({
      to: email,
      subject: 'Einladung: behebes Admin-Zugang aktivieren',
      html: buildInviteEmailHtml(normalizeText(user?.username) || 'Nutzer', inviteLink),
    });
    sent = true;
    await db.run(
      `UPDATE user_invites
       SET sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [inviteId]
    );
  }

  return {
    inviteId,
    resetId,
    token,
    expiresAt,
    inviteLink,
    sent,
  };
}

