import { loadConfig } from '../config.js';
import { getDatabase } from '../database.js';
import { sendEmail } from './email.js';
import { isNotificationEnabledForUser, sendSystemChatNotifications } from './admin-notifications.js';
import { sendAdminPushToUsers } from './admin-push.js';
import { loadAdminAccessContext } from './rbac.js';

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLocation(address?: string | null, postalCode?: string | null, city?: string | null): string {
  const parts = [address, [postalCode, city].filter(Boolean).join(' ')]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return parts.join(', ');
}

function resolveRecipientName(row: { first_name?: string | null; last_name?: string | null; username?: string | null }): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return name || String(row.username || '').trim() || 'Kollegin/Kollege';
}

export type TicketAssignmentNotificationRecipient =
  | {
      type: 'user';
      id: string;
      roleLabel?: string;
    }
  | {
      type: 'org_unit';
      id: string;
      roleLabel?: string;
    };

export async function sendNewTicketEmailNotifications(ticketId: string): Promise<void> {
  const config = loadConfig();
  const normalizedTicketId = String(ticketId || '').trim();
  if (!normalizedTicketId) return;
  const db = getDatabase();

  const ticket = await db.get(
    `SELECT t.id, t.category, t.priority, t.status, t.tenant_id, t.address, t.postal_code, t.city, t.created_at,
            c.name AS citizen_name
     FROM tickets t
     LEFT JOIN citizens c ON c.id = t.citizen_id
     WHERE t.id = ?`,
    [normalizedTicketId]
  );
  if (!ticket) return;

  const tenantId = String(ticket?.tenant_id || '').trim();
  const candidates = await db.all<any>(
    `SELECT id, username, email, role, first_name, last_name, COALESCE(is_global_admin, 0) AS is_global_admin, active
     FROM admin_users
     WHERE active = 1 AND email IS NOT NULL AND TRIM(email) != ''`
  );

  const recipients: Array<{ id: string; email: string; username: string; role: string; first_name?: string; last_name?: string }> = [];
  const pushRecipientUserIds = new Set<string>();
  for (const row of candidates || []) {
    const userId = String(row?.id || '').trim();
    if (!userId) continue;
    const enabled = await isNotificationEnabledForUser({
      adminUserId: userId,
      role: row?.role,
      eventType: 'ticket_created_email',
    });
    if (!enabled) continue;
    if (tenantId) {
      const access = await loadAdminAccessContext(userId, String(row?.role || ''));
      if (!access.isGlobalAdmin && !access.tenantIds.includes(tenantId)) {
        continue;
      }
    }
    const pushEnabled = await isNotificationEnabledForUser({
      adminUserId: userId,
      role: row?.role,
      eventType: 'push_ticket_events',
    });
    if (pushEnabled) {
      pushRecipientUserIds.add(userId);
    }
    if (!enabled) {
      continue;
    }
    recipients.push({
      id: userId,
      email: String(row?.email || '').trim(),
      username: String(row?.username || '').trim(),
      role: String(row?.role || '').trim(),
      first_name: row?.first_name ? String(row.first_name) : undefined,
      last_name: row?.last_name ? String(row.last_name) : undefined,
    });
  }

  const adminBaseUrl = String(config.adminUrl || '').trim().replace(/\/+$/, '');
  const ticketLink = adminBaseUrl ? `${adminBaseUrl}/tickets/${encodeURIComponent(normalizedTicketId)}` : '';
  const category = String(ticket.category || '').trim() || '–';
  const priority = String(ticket.priority || '').trim() || '–';
  const status = String(ticket.status || '').trim() || '–';
  const createdAt = ticket.created_at ? String(ticket.created_at) : '';
  const location = formatLocation(ticket.address, ticket.postal_code, ticket.city);
  const citizenName = String(ticket.citizen_name || '').trim();
  const systemSummaryLines = [
    `Ticket ${normalizedTicketId} wurde neu erstellt.`,
    `Kategorie: ${category}`,
    `Priorität: ${priority}`,
    `Status: ${status}`,
    location ? `Ort: ${location}` : '',
    citizenName ? `Meldende Person: ${citizenName}` : '',
  ].filter(Boolean);

  try {
    await sendSystemChatNotifications({
      eventType: 'ticket_created_messenger',
      title: `Neues Ticket ${normalizedTicketId}`,
      message: systemSummaryLines.join('\n'),
      roleScope: 'staff',
      relatedTicketId: normalizedTicketId,
      tenantId: tenantId || null,
    });
  } catch (error) {
    console.warn('New ticket chat notification failed:', error);
  }

  if (pushRecipientUserIds.size > 0) {
    try {
      await sendAdminPushToUsers(Array.from(pushRecipientUserIds), {
        title: `Neues Ticket ${normalizedTicketId}`,
        body: `${category} · ${priority}${location ? ` · ${location}` : ''}`,
        url: `/ops/tickets/${encodeURIComponent(normalizedTicketId)}`,
        tag: `ticket-created-${normalizedTicketId}`,
        eventType: 'ticket_created',
        metadata: {
          ticketId: normalizedTicketId,
          tenantId: tenantId || null,
          category,
          priority,
          status,
        },
      });
    } catch (error) {
      console.warn('New ticket push notification failed:', error);
    }
  }

  const subject = `Neues Ticket ${normalizedTicketId}`;

  for (const recipient of recipients) {
    try {
      const recipientName = resolveRecipientName(recipient);
      const html = `
        <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; color:#001c31;">
          <div style="background:#003762;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
            <h2 style="margin:0;font-size:20px;">Neues Ticket eingegangen</h2>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:20px;">
            <p style="margin-top:0;">Hallo ${escapeHtml(recipientName)},</p>
            <p>es wurde soeben ein neues Ticket erstellt.</p>
            <div style="background:#f1f6fb; border:1px solid #c8d7e5; padding:14px; border-radius:8px; margin:18px 0;">
              <p style="margin:0 0 8px 0;"><strong>Ticket-ID:</strong> ${escapeHtml(normalizedTicketId)}</p>
              <p style="margin:0 0 8px 0;"><strong>Kategorie:</strong> ${escapeHtml(category)}</p>
              <p style="margin:0 0 8px 0;"><strong>Priorität:</strong> ${escapeHtml(priority)}</p>
              <p style="margin:0 0 8px 0;"><strong>Status:</strong> ${escapeHtml(status)}</p>
              ${location ? `<p style="margin:0 0 8px 0;"><strong>Ort:</strong> ${escapeHtml(location)}</p>` : ''}
              ${citizenName ? `<p style="margin:0;"><strong>Meldende Person:</strong> ${escapeHtml(citizenName)}</p>` : ''}
            </div>
            ${ticketLink ? `<p style="margin:0 0 16px 0;"><a href="${escapeHtml(ticketLink)}" style="display:inline-block;background:#003762;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Ticket öffnen</a></p>` : ''}
            ${createdAt ? `<p style="margin:0;color:#5b6b7b;font-size:12px;">Erstellt am: ${escapeHtml(createdAt)}</p>` : ''}
          </div>
        </div>
      `;

      const textLines = [
        'Neues Ticket eingegangen',
        '',
        `Ticket-ID: ${normalizedTicketId}`,
        `Kategorie: ${category}`,
        `Priorität: ${priority}`,
        `Status: ${status}`,
        location ? `Ort: ${location}` : '',
        citizenName ? `Meldende Person: ${citizenName}` : '',
        createdAt ? `Erstellt am: ${createdAt}` : '',
        ticketLink ? `Ticket öffnen: ${ticketLink}` : '',
      ].filter(Boolean);

      await sendEmail({
        to: recipient.email,
        subject,
        html,
        text: textLines.join('\n'),
      });
    } catch (error) {
      console.warn('New ticket email failed:', error);
    }
  }
}

export async function sendTicketAssignmentEmailNotifications(input: {
  ticketId: string;
  recipients: TicketAssignmentNotificationRecipient[];
  actorUserId?: string | null;
  context?: 'ticket_assignment' | 'internal_task_assignment' | 'ticket_inbound_email';
  taskTitle?: string | null;
  internalTaskId?: string | null;
  inboundEmail?: {
    sender?: string | null;
    subject?: string | null;
    receivedAt?: string | null;
    mailboxMessageId?: string | null;
  } | null;
}): Promise<void> {
  const normalizedTicketId = String(input.ticketId || '').trim();
  const recipientsRaw = Array.isArray(input.recipients) ? input.recipients : [];
  if (!normalizedTicketId || recipientsRaw.length === 0) return;

  const db = getDatabase();
  const ticket = await db.get(
    `SELECT t.id, t.category, t.priority, t.status, t.tenant_id, t.address, t.postal_code, t.city, t.created_at
     FROM tickets t
     WHERE t.id = ?`,
    [normalizedTicketId]
  );
  if (!ticket?.id) return;

  const actorUserId = String(input.actorUserId || '').trim();
  const userIdSet = new Set<string>();
  const orgIdSet = new Set<string>();
  for (const entry of recipientsRaw) {
    const id = String((entry as any)?.id || '').trim();
    if (!id) continue;
    if (entry?.type === 'org_unit') {
      orgIdSet.add(id);
    } else {
      userIdSet.add(id);
    }
  }
  if (userIdSet.size === 0 && orgIdSet.size === 0) return;

  const context =
    input.context === 'internal_task_assignment'
      ? 'internal_task_assignment'
      : input.context === 'ticket_inbound_email'
      ? 'ticket_inbound_email'
      : 'ticket_assignment';
  const taskTitle = String(input.taskTitle || '').trim();
  const internalTaskId = String(input.internalTaskId || '').trim();
  const messengerEventType = context === 'ticket_inbound_email' ? 'ticket_inbound_messenger' : 'ticket_assigned_messenger';
  const inboundSender = String(input.inboundEmail?.sender || '').trim();
  const inboundSubject = String(input.inboundEmail?.subject || '').trim();
  const inboundReceivedAt = String(input.inboundEmail?.receivedAt || '').trim();
  const inboundMailboxMessageId = String(input.inboundEmail?.mailboxMessageId || '').trim();
  const roleByUser = new Map<string, Set<string>>();
  const roleByOrg = new Map<string, Set<string>>();
  for (const entry of recipientsRaw) {
    const id = String((entry as any)?.id || '').trim();
    if (!id) continue;
    const roleLabel = String((entry as any)?.roleLabel || '').trim() || 'Zuweisung';
    if (entry?.type === 'org_unit') {
      const bucket = roleByOrg.get(id) || new Set<string>();
      bucket.add(roleLabel);
      roleByOrg.set(id, bucket);
    } else {
      const bucket = roleByUser.get(id) || new Set<string>();
      bucket.add(roleLabel);
      roleByUser.set(id, bucket);
    }
  }

  const addRolesToSet = (target: Set<string>, source: Set<string>) => {
    source.forEach((entry) => target.add(entry));
  };

  const recipientMap = new Map<
    string,
    { email: string; displayName: string; roles: Set<string>; source: 'user' | 'org_unit' }
  >();
  const pushRecipientUserIds = new Set<string>();
  const addRecipient = (
    emailInput: string,
    displayNameInput: string,
    roleSet: Set<string>,
    source: 'user' | 'org_unit'
  ) => {
    const email = String(emailInput || '').trim().toLowerCase();
    if (!email) return;
    const key = email;
    const displayName = String(displayNameInput || '').trim() || 'Team';
    const existing = recipientMap.get(key);
    if (!existing) {
      recipientMap.set(key, {
        email,
        displayName,
        roles: new Set<string>(roleSet),
        source,
      });
      return;
    }
    addRolesToSet(existing.roles, roleSet);
    if (existing.displayName === 'Team' && displayName !== 'Team') {
      existing.displayName = displayName;
    }
  };

  const userIds = Array.from(userIdSet);
  const messengerRecipientUserIds = new Set<string>();
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(', ');
    const users = await db.all<any>(
      `SELECT id, username, email, first_name, last_name, role, active
       FROM admin_users
       WHERE id IN (${placeholders})`,
      userIds
    );
    for (const row of users || []) {
      const userId = String(row?.id || '').trim();
      if (!userId) continue;
      if (actorUserId && actorUserId === userId) continue;
      if (Number(row?.active ?? 1) !== 1) continue;
      const messengerEnabled = await isNotificationEnabledForUser({
        adminUserId: userId,
        role: row?.role,
        eventType: messengerEventType,
      });
      if (messengerEnabled) {
        messengerRecipientUserIds.add(userId);
      }
      const pushPreferenceEvent =
        context === 'internal_task_assignment' ? 'push_internal_tasks' : 'push_ticket_events';
      const pushEnabled = await isNotificationEnabledForUser({
        adminUserId: userId,
        role: row?.role,
        eventType: pushPreferenceEvent,
      });
      if (pushEnabled) {
        pushRecipientUserIds.add(userId);
      }
      const email = String(row?.email || '').trim();
      if (!email) continue;
      const enabled = await isNotificationEnabledForUser({
        adminUserId: userId,
        role: row?.role,
        eventType: context === 'ticket_inbound_email' ? 'ticket_inbound_email' : 'ticket_assigned_email',
      });
      if (!enabled) continue;
      const roleSet = roleByUser.get(userId) || new Set<string>(['Zuweisung']);
      addRecipient(email, resolveRecipientName(row), roleSet, 'user');
    }
  }

  const orgIds = Array.from(orgIdSet);
  if (orgIds.length > 0) {
    const placeholders = orgIds.map(() => '?').join(', ');
    const orgRows = await db.all<any>(
      `SELECT id, name, contact_email
       FROM org_units
       WHERE id IN (${placeholders})`,
      orgIds
    );
    for (const row of orgRows || []) {
      const orgId = String(row?.id || '').trim();
      if (!orgId) continue;
      const email = String(row?.contact_email || '').trim();
      if (!email) continue;
      const roleSet = roleByOrg.get(orgId) || new Set<string>(['Zuweisung']);
      const orgName = String(row?.name || '').trim() || 'Organisationseinheit';
      addRecipient(email, orgName, roleSet, 'org_unit');
    }
  }

  if (recipientMap.size === 0) return;

  const config = loadConfig();
  const adminBaseUrl = String(config.adminUrl || '').trim().replace(/\/+$/, '');
  const ticketLink = adminBaseUrl ? `${adminBaseUrl}/tickets/${encodeURIComponent(normalizedTicketId)}` : '';
  const internalTaskLink =
    context === 'internal_task_assignment' && adminBaseUrl
      ? `${adminBaseUrl}/internal-tasks${
          internalTaskId ? `?taskId=${encodeURIComponent(internalTaskId)}` : ''
        }`
      : '';
  const actionLink = internalTaskLink || ticketLink;
  const actionLabel = context === 'internal_task_assignment' ? 'Interne Bearbeitung öffnen' : 'Ticket öffnen';
  const category = String(ticket.category || '').trim() || '–';
  const priority = String(ticket.priority || '').trim() || '–';
  const status = String(ticket.status || '').trim() || '–';
  const createdAt = ticket.created_at ? String(ticket.created_at) : '';
  const tenantId = String(ticket.tenant_id || '').trim();
  const location = formatLocation(ticket.address, ticket.postal_code, ticket.city);
  const headline =
    context === 'internal_task_assignment'
      ? 'Interne Aufgabe zugewiesen'
      : context === 'ticket_inbound_email'
      ? 'Neue E-Mail zum Ticket'
      : 'Ticket-Zuweisung';
  const subject =
    context === 'internal_task_assignment'
      ? `Interne Aufgabe zugewiesen: ${taskTitle || normalizedTicketId}`
      : context === 'ticket_inbound_email'
      ? `Neue E-Mail zu Ticket: ${normalizedTicketId}`
      : `Ticket zugewiesen: ${normalizedTicketId}`;

  if (messengerRecipientUserIds.size > 0) {
    const systemSummaryLines = [
      context === 'ticket_inbound_email'
        ? `Für Ticket ${normalizedTicketId} ist eine neue E-Mail eingegangen.`
        : context === 'internal_task_assignment'
        ? `Interne Aufgabe für Ticket ${normalizedTicketId} wurde zugewiesen.`
        : `Ticket ${normalizedTicketId} wurde zugewiesen.`,
      taskTitle ? `Aufgabe: ${taskTitle}` : '',
      context === 'ticket_inbound_email' && inboundSender ? `Absender: ${inboundSender}` : '',
      context === 'ticket_inbound_email' && inboundSubject ? `E-Mail-Betreff: ${inboundSubject}` : '',
      `Kategorie: ${category}`,
      `Priorität: ${priority}`,
      `Status: ${status}`,
      location ? `Ort: ${location}` : '',
    ].filter(Boolean);
    try {
      await sendSystemChatNotifications({
        eventType: messengerEventType,
        title: headline,
        message: systemSummaryLines.join('\n'),
        roleScope: 'staff',
        relatedTicketId: normalizedTicketId,
        tenantId: tenantId || null,
        restrictToUserIds: Array.from(messengerRecipientUserIds),
      });
    } catch (error) {
      console.warn('Ticket assignment chat notification failed:', error);
    }
  }

  if (pushRecipientUserIds.size > 0) {
    const pushTitle =
      context === 'internal_task_assignment'
        ? `Neue interne Aufgabe · Ticket ${normalizedTicketId}`
        : context === 'ticket_inbound_email'
        ? `Neue E-Mail zu Ticket ${normalizedTicketId}`
        : `Ticket-Zuweisung ${normalizedTicketId}`;
    const pushBody = [
      taskTitle ? `Aufgabe: ${taskTitle}` : '',
      `Kategorie: ${category}`,
      `Priorität: ${priority}`,
      location ? `Ort: ${location}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    try {
      await sendAdminPushToUsers(Array.from(pushRecipientUserIds), {
        title: pushTitle,
        body: pushBody || 'Neues Ticket-Ereignis',
        url: `/ops/tickets/${encodeURIComponent(normalizedTicketId)}`,
        tag:
          context === 'internal_task_assignment'
            ? `internal-task-${internalTaskId || normalizedTicketId}`
            : `ticket-assignment-${normalizedTicketId}`,
        eventType:
          context === 'internal_task_assignment'
            ? 'internal_task_assignment'
            : context === 'ticket_inbound_email'
            ? 'ticket_inbound_email'
            : 'ticket_assignment',
        metadata: {
          ticketId: normalizedTicketId,
          internalTaskId: internalTaskId || null,
          tenantId: tenantId || null,
          context,
        },
      });
    } catch (error) {
      console.warn('Ticket assignment push notification failed:', error);
    }
  }

  for (const recipient of recipientMap.values()) {
    try {
      const roleText = Array.from(recipient.roles).join(', ');
      const html = `
        <div style="font-family: Candara, 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; color:#001c31;">
          <div style="background:#003762;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
            <h2 style="margin:0;font-size:20px;">${escapeHtml(headline)}</h2>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:20px;">
            <p style="margin-top:0;">Hallo ${escapeHtml(recipient.displayName)},</p>
            <p>${
              context === 'ticket_inbound_email'
                ? 'zu einem Ihnen zugewiesenen Ticket ist eine neue E-Mail eingegangen.'
                : 'für Sie liegt eine neue Zuweisung vor.'
            }</p>
            <div style="background:#f1f6fb; border:1px solid #c8d7e5; padding:14px; border-radius:8px; margin:18px 0;">
              <p style="margin:0 0 8px 0;"><strong>Ticket-ID:</strong> ${escapeHtml(normalizedTicketId)}</p>
              ${context === 'internal_task_assignment' && internalTaskId ? `<p style="margin:0 0 8px 0;"><strong>Aufgaben-ID:</strong> ${escapeHtml(internalTaskId)}</p>` : ''}
              ${taskTitle ? `<p style="margin:0 0 8px 0;"><strong>Aufgabe:</strong> ${escapeHtml(taskTitle)}</p>` : ''}
              <p style="margin:0 0 8px 0;"><strong>Rolle:</strong> ${escapeHtml(roleText || 'Zuweisung')}</p>
              ${context === 'ticket_inbound_email' && inboundSender ? `<p style="margin:0 0 8px 0;"><strong>Absender:</strong> ${escapeHtml(inboundSender)}</p>` : ''}
              ${context === 'ticket_inbound_email' && inboundSubject ? `<p style="margin:0 0 8px 0;"><strong>E-Mail-Betreff:</strong> ${escapeHtml(inboundSubject)}</p>` : ''}
              ${context === 'ticket_inbound_email' && inboundReceivedAt ? `<p style="margin:0 0 8px 0;"><strong>Empfangen:</strong> ${escapeHtml(inboundReceivedAt)}</p>` : ''}
              ${context === 'ticket_inbound_email' && inboundMailboxMessageId ? `<p style="margin:0 0 8px 0;"><strong>Postfach-ID:</strong> ${escapeHtml(inboundMailboxMessageId)}</p>` : ''}
              <p style="margin:0 0 8px 0;"><strong>Kategorie:</strong> ${escapeHtml(category)}</p>
              <p style="margin:0 0 8px 0;"><strong>Priorität:</strong> ${escapeHtml(priority)}</p>
              <p style="margin:0 0 8px 0;"><strong>Status:</strong> ${escapeHtml(status)}</p>
              ${location ? `<p style="margin:0;"><strong>Ort:</strong> ${escapeHtml(location)}</p>` : ''}
            </div>
            ${actionLink ? `<p style="margin:0 0 16px 0;"><a href="${escapeHtml(actionLink)}" style="display:inline-block;background:#003762;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">${escapeHtml(actionLabel)}</a></p>` : ''}
            ${createdAt ? `<p style="margin:0;color:#5b6b7b;font-size:12px;">Ticket erstellt am: ${escapeHtml(createdAt)}</p>` : ''}
          </div>
        </div>
      `;
      const textLines = [
        headline,
        '',
        `Ticket-ID: ${normalizedTicketId}`,
        taskTitle ? `Aufgabe: ${taskTitle}` : '',
        `Rolle: ${roleText || 'Zuweisung'}`,
        context === 'ticket_inbound_email' && inboundSender ? `Absender: ${inboundSender}` : '',
        context === 'ticket_inbound_email' && inboundSubject ? `E-Mail-Betreff: ${inboundSubject}` : '',
        context === 'ticket_inbound_email' && inboundReceivedAt ? `Empfangen: ${inboundReceivedAt}` : '',
        context === 'ticket_inbound_email' && inboundMailboxMessageId
          ? `Postfach-ID: ${inboundMailboxMessageId}`
          : '',
        `Kategorie: ${category}`,
        `Priorität: ${priority}`,
        `Status: ${status}`,
        location ? `Ort: ${location}` : '',
        createdAt ? `Ticket erstellt am: ${createdAt}` : '',
        actionLink ? `${actionLabel}: ${actionLink}` : '',
      ].filter(Boolean);
      await sendEmail({
        to: recipient.email,
        subject,
        html,
        text: textLines.join('\n'),
      });
    } catch (error) {
      console.warn('Ticket assignment email failed:', error);
    }
  }
}
