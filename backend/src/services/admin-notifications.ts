/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 *
 * Admin notification center helpers
 */

import { getDatabase } from '../database.js';
import { normalizeRole, type NormalizedRole } from '../utils/roles.js';
import { sendAdminPushToUsers } from './admin-push.js';
import { loadAdminAccessContext } from './rbac.js';

export type AdminNotificationSeverity = 'info' | 'warning' | 'error';
export type AdminNotificationStatus = 'open' | 'read' | 'resolved';
export type AdminNotificationRoleScope = 'all' | 'admin' | 'staff';

export interface NotificationEventDefinition {
  eventType: string;
  label: string;
  description: string;
  roleScope: AdminNotificationRoleScope;
  channel: 'email' | 'messenger' | 'general';
  defaultEnabledByRole: Record<NormalizedRole, boolean>;
}

export const NOTIFICATION_EVENT_DEFINITIONS: NotificationEventDefinition[] = [
  {
    eventType: 'ticket_created_email',
    label: 'Neue Tickets per E-Mail',
    description: 'Erhalte eine E-Mail, sobald ein neues Ticket erstellt wurde.',
    roleScope: 'staff',
    channel: 'email',
    defaultEnabledByRole: {
      ADMIN: false,
      SACHBEARBEITER: false,
    },
  },
  {
    eventType: 'ticket_created_messenger',
    label: 'Neue Tickets im Teamchat',
    description: 'Erhalte vom System-User im Teamchat eine Meldung, sobald ein neues Ticket erstellt wurde.',
    roleScope: 'staff',
    channel: 'messenger',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'ticket_assigned_email',
    label: 'Ticket-/Aufgaben-Zuweisung per E-Mail',
    description: 'Erhalte eine E-Mail, wenn dir ein Ticket oder eine interne Aufgabe neu zugewiesen wird.',
    roleScope: 'staff',
    channel: 'email',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'ticket_assigned_messenger',
    label: 'Ticket-/Aufgaben-Zuweisung im Teamchat',
    description: 'Erhalte vom System-User im Teamchat eine Meldung bei Ticket- oder Aufgaben-Zuweisungen.',
    roleScope: 'staff',
    channel: 'messenger',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'ticket_inbound_email',
    label: 'Eingehende Ticket-E-Mails',
    description: 'Erhalte eine E-Mail, wenn zu einem dir zugewiesenen Ticket eine neue Antwort eingeht.',
    roleScope: 'staff',
    channel: 'email',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'ticket_inbound_messenger',
    label: 'Eingehende Ticket-E-Mails im Teamchat',
    description: 'Erhalte vom System-User im Teamchat eine Meldung über neue eingehende Ticket-E-Mails.',
    roleScope: 'staff',
    channel: 'messenger',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'ticket_inbound_email_unassigned',
    label: 'Eingehende E-Mails ohne Zuweisung',
    description: 'Interne Benachrichtigung, wenn eine Ticket-E-Mail eingeht, aber keine Zuweisung gesetzt ist.',
    roleScope: 'admin',
    channel: 'email',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: false,
    },
  },
  {
    eventType: 'admin_user_registration_pending',
    label: 'Neue Benutzerregistrierung',
    description: 'Eine neue Selbstregistrierung wartet auf Pruefung und Freischaltung.',
    roleScope: 'admin',
    channel: 'general',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: false,
    },
  },
  {
    eventType: 'email_send_failed',
    label: 'E-Mail-Versandfehler',
    description: 'Nachricht konnte nach allen Retry-Versuchen nicht gesendet werden.',
    roleScope: 'staff',
    channel: 'general',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'workflow_aborted',
    label: 'Workflow-Abbruch',
    description: 'Eine Workflow-Instanz wurde mit Fehler beendet.',
    roleScope: 'staff',
    channel: 'general',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'workflow_task_failed',
    label: 'Workflow-Schrittfehler',
    description: 'Ein einzelner Workflow-Schritt ist fehlgeschlagen.',
    roleScope: 'admin',
    channel: 'general',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: false,
    },
  },
  {
    eventType: 'chat_message_email',
    label: 'Teamchat per E-Mail',
    description: 'Erhalte eine E-Mail, wenn im Teamchat neue Nachrichten für dich eingehen.',
    roleScope: 'staff',
    channel: 'email',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'system_notification_messenger',
    label: 'Systemmeldungen im Teamchat',
    description: 'Erhalte vom System-User Hinweise zu wichtigen Plattform- und Workflow-Ereignissen.',
    roleScope: 'staff',
    channel: 'messenger',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'situation_report_abuse_detected',
    label: 'Lagebild: Missbrauchsversuch',
    description: 'KI-Lagebild hat Muster erkannt, die auf Missbrauch oder systematische Banalmeldungen hindeuten.',
    roleScope: 'staff',
    channel: 'general',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'situation_report_risk_detected',
    label: 'Lagebild: Gefährliche Lage',
    description: 'KI-Lagebild hat riskante oder potenziell gefährliche Muster erkannt.',
    roleScope: 'staff',
    channel: 'general',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'situation_report_new_messenger',
    label: 'Lagebild: Neues Ergebnis im Teamchat',
    description: 'Erhalte vom System-User eine Teamchat-Meldung, sobald ein neues KI-Lagebild vorliegt.',
    roleScope: 'staff',
    channel: 'messenger',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'push_ticket_events',
    label: 'Ops Push: Tickets',
    description: 'Push-Benachrichtigung für neue Tickets sowie relevante Ticket-Ereignisse.',
    roleScope: 'staff',
    channel: 'general',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'push_messenger_messages',
    label: 'Ops Push: Messenger',
    description: 'Push-Benachrichtigung bei neuen Messenger-Nachrichten.',
    roleScope: 'staff',
    channel: 'general',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'push_internal_tasks',
    label: 'Ops Push: Interne Aufgaben',
    description: 'Push-Benachrichtigung bei neuen oder geänderten internen Aufgaben.',
    roleScope: 'staff',
    channel: 'general',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
  {
    eventType: 'push_workflow_sla_overdue',
    label: 'Ops Push: Workflow-SLA',
    description: 'Push-Benachrichtigung, wenn eine Workflow-Instanz SLA-Risiko oder Überfälligkeit erreicht.',
    roleScope: 'staff',
    channel: 'general',
    defaultEnabledByRole: {
      ADMIN: true,
      SACHBEARBEITER: true,
    },
  },
];

const EVENT_DEFINITION_MAP = new Map(
  NOTIFICATION_EVENT_DEFINITIONS.map((entry) => [entry.eventType, entry])
);

function resolveEventDefinition(eventType: string): NotificationEventDefinition | null {
  const key = String(eventType || '').trim();
  if (!key) return null;
  return EVENT_DEFINITION_MAP.get(key) || null;
}

function resolveRoleScope(value: unknown, fallback: AdminNotificationRoleScope = 'all'): AdminNotificationRoleScope {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'admin' || normalized === 'staff' || normalized === 'all') {
    return normalized;
  }
  return fallback;
}

function resolveSeverity(value: unknown, fallback: AdminNotificationSeverity = 'warning'): AdminNotificationSeverity {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'info' || normalized === 'warning' || normalized === 'error') {
    return normalized;
  }
  return fallback;
}

function resolveStatus(value: unknown, fallback: AdminNotificationStatus = 'open'): AdminNotificationStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'open' || normalized === 'read' || normalized === 'resolved') {
    return normalized;
  }
  return fallback;
}

function roleCanSeeScope(role: NormalizedRole | null, scope: AdminNotificationRoleScope): boolean {
  if (scope === 'all') return true;
  if (!role) return false;
  if (scope === 'admin') return role === 'ADMIN';
  if (scope === 'staff') return role === 'ADMIN' || role === 'SACHBEARBEITER';
  return false;
}

const SYSTEM_CHAT_CONVERSATION_PREFIX = 'system:';

function createSystemChatMessageId(): string {
  return `chatmsg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeSystemChatBody(value: unknown): string {
  return String(value || '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, 12000);
}

async function resolveRecipientsByEvent(input: {
  eventType: string;
  roleScope: AdminNotificationRoleScope;
  tenantId?: string | null;
  restrictToUserIds?: string[];
}): Promise<string[]> {
  const eventType = String(input.eventType || '').trim();
  if (!eventType) return [];
  const tenantId = String(input.tenantId || '').trim();
  const restrictedUserIds = Array.from(
    new Set((input.restrictToUserIds || []).map((entry) => String(entry || '').trim()).filter(Boolean))
  );
  const db = getDatabase();
  const rows =
    restrictedUserIds.length > 0
      ? await db.all<any>(
          `SELECT id, role
           FROM admin_users
           WHERE COALESCE(active, 1) = 1
             AND id IN (${restrictedUserIds.map(() => '?').join(', ')})`,
          restrictedUserIds
        )
      : await db.all<any>(
          `SELECT id, role
           FROM admin_users
           WHERE COALESCE(active, 1) = 1`
        );

  const result: string[] = [];
  for (const row of rows || []) {
    const adminUserId = String(row?.id || '').trim();
    const role = normalizeRole(row?.role);
    if (!adminUserId || !role) continue;
    if (!roleCanSeeScope(role, input.roleScope)) continue;
    if (tenantId) {
      const access = await loadAdminAccessContext(adminUserId, role);
      if (!access.isGlobalAdmin && !(access.tenantIds || []).includes(tenantId)) {
        continue;
      }
    }
    const enabled = await isNotificationEnabledForUser({
      adminUserId,
      role,
      eventType,
    });
    if (!enabled) continue;
    result.push(adminUserId);
  }
  return Array.from(new Set(result));
}

async function resolvePushRecipientIds(input: {
  eventType: string;
  roleScope: AdminNotificationRoleScope;
}): Promise<string[]> {
  return resolveRecipientsByEvent(input);
}

export async function sendSystemChatNotifications(input: {
  eventType: string;
  title: string;
  message: string;
  roleScope?: AdminNotificationRoleScope;
  relatedTicketId?: string | null;
  tenantId?: string | null;
  restrictToUserIds?: string[];
}): Promise<{ attempted: number; delivered: number }> {
  const eventType = String(input.eventType || '').trim();
  if (!eventType) return { attempted: 0, delivered: 0 };
  const title = String(input.title || '').trim();
  const message = String(input.message || '').trim();
  const body = sanitizeSystemChatBody([title, message].filter(Boolean).join('\n\n'));
  if (!body) return { attempted: 0, delivered: 0 };
  const roleScope = resolveRoleScope(input.roleScope, 'staff');

  const recipients = await resolveRecipientsByEvent({
    eventType,
    roleScope,
    tenantId: String(input.tenantId || '').trim() || null,
    restrictToUserIds: Array.isArray(input.restrictToUserIds) ? input.restrictToUserIds : [],
  });
  if (recipients.length === 0) return { attempted: 0, delivered: 0 };

  const db = getDatabase();
  let delivered = 0;
  for (const recipientId of recipients) {
    try {
      const conversationId = `${SYSTEM_CHAT_CONVERSATION_PREFIX}${recipientId}`;
      await db.run(
        `INSERT INTO admin_chat_messages (
          id,
          sender_admin_user_id,
          conversation_type,
          conversation_id,
          recipient_admin_user_id,
          group_kind,
          group_id,
          message_kind,
          body,
          file_id,
          ticket_id,
          xmpp_stanza_id,
          quoted_message_id,
          quoted_body,
          quoted_sender_name,
          created_at
        ) VALUES (?, ?, 'system', ?, ?, NULL, NULL, 'system_notice', ?, NULL, ?, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP)`,
        [
          createSystemChatMessageId(),
          recipientId,
          conversationId,
          recipientId,
          body,
          String(input.relatedTicketId || '').trim() || null,
        ]
      );
      delivered += 1;
    } catch (error) {
      console.warn('System chat notification dispatch failed:', error);
    }
  }

  return {
    attempted: recipients.length,
    delivered,
  };
}

function parseContext(raw: unknown): Record<string, any> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, any>;
  } catch {
    return null;
  }
}

function resolveDefaultEnabled(eventType: string, role: NormalizedRole | null): boolean {
  const definition = resolveEventDefinition(eventType);
  if (!definition || !role) return true;
  return definition.defaultEnabledByRole[role] !== false;
}

export async function getUserNotificationPreferences(
  adminUserId: string,
  role?: string | null
): Promise<{
  items: Array<{
    eventType: string;
    label: string;
    description: string;
    roleScope: AdminNotificationRoleScope;
    channel: 'email' | 'messenger' | 'general';
    enabled: boolean;
    configured: boolean;
  }>;
}> {
  const normalizedRole = normalizeRole(role) || 'SACHBEARBEITER';
  const db = getDatabase();
  const rows = await db.all(
    `SELECT event_type, enabled
     FROM admin_user_notification_preferences
     WHERE admin_user_id = ?`,
    [adminUserId]
  );
  const configuredMap = new Map<string, boolean>();
  for (const row of rows || []) {
    configuredMap.set(String(row?.event_type || ''), Number(row?.enabled || 0) === 1);
  }

  const items = NOTIFICATION_EVENT_DEFINITIONS.map((definition) => {
    const configured = configuredMap.has(definition.eventType);
    const enabled = configured
      ? configuredMap.get(definition.eventType) === true
      : definition.defaultEnabledByRole[normalizedRole] !== false;
    return {
      eventType: definition.eventType,
      label: definition.label,
      description: definition.description,
      roleScope: definition.roleScope,
      channel: definition.channel,
      enabled,
      configured,
    };
  });

  return { items };
}

export async function setUserNotificationPreferences(
  adminUserId: string,
  preferences: Array<{ eventType: string; enabled: boolean }>
): Promise<void> {
  const db = getDatabase();
  for (const pref of preferences || []) {
    const eventType = String(pref?.eventType || '').trim();
    if (!eventType || !EVENT_DEFINITION_MAP.has(eventType)) continue;
    await db.run(
      `INSERT INTO admin_user_notification_preferences (
        admin_user_id, event_type, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(admin_user_id, event_type)
      DO UPDATE SET enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP`,
      [adminUserId, eventType, pref.enabled === true ? 1 : 0]
    );
  }
}

export async function createAdminNotification(input: {
  eventType: string;
  severity?: AdminNotificationSeverity;
  title: string;
  message: string;
  roleScope?: AdminNotificationRoleScope;
  context?: Record<string, any> | null;
  relatedTicketId?: string | null;
  relatedExecutionId?: string | null;
}): Promise<{ id: string }> {
  const db = getDatabase();
  const eventType = String(input.eventType || '').trim() || 'system_warning';
  const definition = resolveEventDefinition(eventType);
  const roleScope = resolveRoleScope(input.roleScope, definition?.roleScope || 'all');
  const severity = resolveSeverity(input.severity, 'warning');
  const id = `an_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await db.run(
    `INSERT INTO admin_notifications (
      id, event_type, severity, role_scope, title, message, context_json,
      related_ticket_id, related_execution_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      id,
      eventType,
      severity,
      roleScope,
      String(input.title || '').trim() || 'Systemhinweis',
      String(input.message || '').trim() || 'Es liegt ein neuer Hinweis vor.',
      input.context ? JSON.stringify(input.context) : null,
      input.relatedTicketId || null,
      input.relatedExecutionId || null,
    ]
  );

  void (async () => {
    try {
      const contextTenantId = String(input.context?.tenantId || input.context?.tenant_id || '').trim();
      try {
        await sendSystemChatNotifications({
          eventType: 'system_notification_messenger',
          title: String(input.title || '').trim() || 'Systemhinweis',
          message: String(input.message || '').trim() || 'Es liegt ein neuer Hinweis vor.',
          roleScope,
          relatedTicketId: input.relatedTicketId || null,
          tenantId: contextTenantId || null,
        });
      } catch (chatNotificationError) {
        console.warn('Admin system chat notification dispatch failed:', chatNotificationError);
      }
      const recipients = await resolvePushRecipientIds({
        eventType,
        roleScope,
      });
      if (recipients.length === 0) return;
      const path = input.relatedTicketId
        ? `/ops/tickets/${encodeURIComponent(String(input.relatedTicketId))}`
        : '/ops/dashboard';
      await sendAdminPushToUsers(recipients, {
        title: String(input.title || '').trim() || 'Systemhinweis',
        body: String(input.message || '').trim() || 'Es liegt ein neuer Hinweis vor.',
        url: path,
        tag: `admin-notification-${id}`,
        eventType,
        metadata: {
          notificationId: id,
          roleScope,
          relatedTicketId: input.relatedTicketId || null,
          relatedExecutionId: input.relatedExecutionId || null,
        },
      });
    } catch (error) {
      console.warn('Admin notification push dispatch failed:', error);
    }
  })();

  return { id };
}

export async function isNotificationEnabledForUser(input: {
  adminUserId?: string | null;
  role?: string | null;
  eventType: string;
}): Promise<boolean> {
  const role = normalizeRole(input.role);
  if (!input.adminUserId) return resolveDefaultEnabled(input.eventType, role);
  const db = getDatabase();
  const pref = await db.get(
    `SELECT enabled
     FROM admin_user_notification_preferences
     WHERE admin_user_id = ? AND event_type = ?
     LIMIT 1`,
    [input.adminUserId, input.eventType]
  );
  if (pref) {
    return Number(pref.enabled || 0) === 1;
  }
  return resolveDefaultEnabled(input.eventType, role);
}

export async function listAdminNotifications(input: {
  adminUserId?: string | null;
  role?: string | null;
  status?: 'all' | AdminNotificationStatus;
  severity?: 'all' | AdminNotificationSeverity;
  eventType?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  items: Array<{
    id: string;
    eventType: string;
    severity: AdminNotificationSeverity;
    roleScope: AdminNotificationRoleScope;
    title: string;
    message: string;
    context: Record<string, any> | null;
    relatedTicketId: string | null;
    relatedExecutionId: string | null;
    status: AdminNotificationStatus;
    createdAt: string | null;
    updatedAt: string | null;
    resolvedAt: string | null;
    resolvedByAdminId: string | null;
  }>;
  total: number;
  limit: number;
  offset: number;
}> {
  const role = normalizeRole(input.role);
  const status = input.status && input.status !== 'all' ? resolveStatus(input.status) : null;
  const severity = input.severity && input.severity !== 'all' ? resolveSeverity(input.severity) : null;
  const eventType = String(input.eventType || '').trim();
  const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
  const offset = Math.max(0, Number(input.offset || 0));
  const db = getDatabase();

  const whereParts: string[] = [];
  const params: Array<string | number> = [];
  if (status) {
    whereParts.push('status = ?');
    params.push(status);
  }
  if (severity) {
    whereParts.push('severity = ?');
    params.push(severity);
  }
  if (eventType) {
    whereParts.push('event_type = ?');
    params.push(eventType);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const baseRows = await db.all(
    `SELECT id, event_type, severity, role_scope, title, message, context_json, related_ticket_id,
            related_execution_id, status, created_at, updated_at, resolved_at, resolved_by_admin_id
     FROM admin_notifications
     ${whereSql}
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, limit * 4, 0]
  );

  const visibleRows: any[] = [];
  for (const row of baseRows || []) {
    const scope = resolveRoleScope(row?.role_scope, 'all');
    if (!roleCanSeeScope(role, scope)) continue;
    const enabled = await isNotificationEnabledForUser({
      adminUserId: input.adminUserId,
      role,
      eventType: String(row?.event_type || ''),
    });
    if (!enabled) continue;
    visibleRows.push(row);
  }

  const pagedRows = visibleRows.slice(offset, offset + limit);

  return {
    items: pagedRows.map((row) => ({
      id: String(row?.id || ''),
      eventType: String(row?.event_type || ''),
      severity: resolveSeverity(row?.severity, 'warning'),
      roleScope: resolveRoleScope(row?.role_scope, 'all'),
      title: String(row?.title || ''),
      message: String(row?.message || ''),
      context: parseContext(row?.context_json),
      relatedTicketId: row?.related_ticket_id ? String(row.related_ticket_id) : null,
      relatedExecutionId: row?.related_execution_id ? String(row.related_execution_id) : null,
      status: resolveStatus(row?.status, 'open'),
      createdAt: row?.created_at || null,
      updatedAt: row?.updated_at || null,
      resolvedAt: row?.resolved_at || null,
      resolvedByAdminId: row?.resolved_by_admin_id ? String(row.resolved_by_admin_id) : null,
    })),
    total: visibleRows.length,
    limit,
    offset,
  };
}

export async function updateAdminNotificationStatus(input: {
  id: string;
  status: AdminNotificationStatus;
  resolvedByAdminId?: string | null;
}): Promise<boolean> {
  const id = String(input.id || '').trim();
  if (!id) return false;
  const status = resolveStatus(input.status, 'open');
  const db = getDatabase();
  if (status === 'resolved') {
    const result = await db.run(
      `UPDATE admin_notifications
       SET status = 'resolved',
           resolved_at = CURRENT_TIMESTAMP,
           resolved_by_admin_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [input.resolvedByAdminId || null, id]
    );
    return Number(result?.changes || 0) > 0;
  }
  const result = await db.run(
    `UPDATE admin_notifications
     SET status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, id]
  );
  return Number(result?.changes || 0) > 0;
}

export async function deleteAdminNotification(id: string): Promise<boolean> {
  const db = getDatabase();
  const result = await db.run(`DELETE FROM admin_notifications WHERE id = ?`, [id]);
  return Number(result?.changes || 0) > 0;
}
