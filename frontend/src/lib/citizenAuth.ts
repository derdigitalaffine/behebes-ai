export interface CitizenSessionResponse {
  authenticated: boolean;
  email?: string;
  emailNormalized?: string;
  accountId?: string;
  expiresAt?: string;
  frontendProfileId?: string;
  frontendProfileName?: string;
  frontendToken?: string;
  citizenAuthEnabled?: boolean;
  authenticatedIntakeWorkflowTemplateId?: string | null;
  pushAvailable?: boolean;
  pushPublicKey?: string | null;
}

export interface CitizenAppMessage {
  id: string;
  sourceType: string;
  sourceRef?: string | null;
  title: string;
  body: string;
  htmlContent?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
  readAt?: string | null;
  deliveredPushAt?: string | null;
  isRead: boolean;
}

export interface CitizenAppMessageListResponse {
  items: CitizenAppMessage[];
  total: number;
  unreadCount: number;
  limit: number;
  offset: number;
  status: 'all' | 'read' | 'unread';
}

export interface CitizenTicketSummary {
  ticketId: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt?: string | null;
  address?: string;
  postalCode?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  redmineIssueId?: number | null;
  assignedTo?: string | null;
  responsibilityAuthority?: string | null;
  citizenName?: string;
}

export interface CitizenTicketListResponse {
  items: CitizenTicketSummary[];
  nextCursor: string | null;
  limit: number;
}

export interface CitizenTicketDetail {
  ticketId: string;
  status: string;
  category: string;
  priority: string;
  createdAt: string;
  updatedAt?: string | null;
  description?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  assignedTo?: string | null;
  redmineIssueId?: number | null;
  responsibilityAuthority?: string | null;
  citizenName?: string;
  citizenEmail?: string;
  images?: Array<{
    id: string;
    fileName: string;
    createdAt?: string | null;
    byteSize?: number;
    url: string;
  }>;
  workflow?: {
    id: string;
    title: string;
    status: string;
    startedAt?: string | null;
    completedAt?: string | null;
    totalSteps: number;
    completedSteps: number;
    currentStep?: { id: string; title: string; type: string; status: string; order: number } | null;
    steps: Array<{ id: string; title: string; type: string; status: string; order: number }>;
  } | null;
}

export interface CitizenTicketHistory {
  ticketId: string;
  status: string;
  comments: Array<{
    id: string;
    authorType: string;
    authorName: string;
    commentType: string;
    content: string;
    metadata?: Record<string, unknown> | null;
    createdAt?: string | null;
  }>;
  milestones: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    order: number;
  }>;
  workflow?: {
    id: string;
    title: string;
    status: string;
    startedAt?: string | null;
    completedAt?: string | null;
  } | null;
}

interface ApiErrorPayload {
  error?: string;
  message?: string;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function ensureOk<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (response.ok) {
    const data = await readJson<T>(response);
    return (data || {}) as T;
  }

  const payload = await readJson<ApiErrorPayload>(response);
  throw new Error(payload?.message || payload?.error || fallbackMessage);
}

export async function getCitizenSession(frontendToken?: string): Promise<CitizenSessionResponse> {
  const params = new URLSearchParams();
  const normalizedToken = String(frontendToken || '').trim();
  if (normalizedToken) {
    params.set('frontendToken', normalizedToken);
  }
  const query = params.toString();
  const response = await fetch(`/api/citizen/auth/session${query ? `?${query}` : ''}`, {
    method: 'GET',
    cache: 'no-store',
  });
  return ensureOk<CitizenSessionResponse>(response, 'Session konnte nicht geladen werden');
}

export async function requestCitizenMagicLink(input: {
  email: string;
  frontendToken?: string;
  purpose?: 'login' | 'verify_and_login';
  redirectPath?: string;
}): Promise<{ message?: string }> {
  const response = await fetch('/api/citizen/auth/request-link', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: input.email,
      frontendToken: input.frontendToken || '',
      purpose: input.purpose || 'login',
      redirectPath: input.redirectPath || '/me',
    }),
  });
  return ensureOk<{ message?: string }>(response, 'Anmeldelink konnte nicht angefordert werden');
}

export async function logoutCitizen(): Promise<void> {
  const response = await fetch('/api/citizen/auth/logout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  await ensureOk<{ ok: boolean }>(response, 'Abmeldung fehlgeschlagen');
}

export async function listCitizenTickets(input?: {
  cursor?: string;
  limit?: number;
  status?: string;
}): Promise<CitizenTicketListResponse> {
  const params = new URLSearchParams();
  if (input?.cursor) params.set('cursor', input.cursor);
  if (typeof input?.limit === 'number') params.set('limit', String(input.limit));
  if (input?.status) params.set('status', input.status);
  const query = params.toString();
  const response = await fetch(`/api/citizen/tickets${query ? `?${query}` : ''}`, {
    method: 'GET',
    cache: 'no-store',
  });
  return ensureOk<CitizenTicketListResponse>(response, 'Meldungen konnten nicht geladen werden');
}

export async function getCitizenTicket(ticketId: string): Promise<CitizenTicketDetail> {
  const response = await fetch(`/api/citizen/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'GET',
    cache: 'no-store',
  });
  return ensureOk<CitizenTicketDetail>(response, 'Ticket konnte nicht geladen werden');
}

export async function getCitizenTicketHistory(ticketId: string): Promise<CitizenTicketHistory> {
  const response = await fetch(`/api/citizen/tickets/${encodeURIComponent(ticketId)}/history`, {
    method: 'GET',
    cache: 'no-store',
  });
  return ensureOk<CitizenTicketHistory>(response, 'Historie konnte nicht geladen werden');
}

export async function listCitizenMessages(input?: {
  status?: 'all' | 'read' | 'unread';
  limit?: number;
  offset?: number;
}): Promise<CitizenAppMessageListResponse> {
  const params = new URLSearchParams();
  if (input?.status) params.set('status', input.status);
  if (typeof input?.limit === 'number') params.set('limit', String(input.limit));
  if (typeof input?.offset === 'number') params.set('offset', String(input.offset));
  const query = params.toString();
  const response = await fetch(`/api/citizen/messages${query ? `?${query}` : ''}`, {
    method: 'GET',
    cache: 'no-store',
  });
  return ensureOk<CitizenAppMessageListResponse>(response, 'Nachrichten konnten nicht geladen werden');
}

export async function getCitizenUnreadMessageCount(): Promise<number> {
  const response = await fetch('/api/citizen/messages/unread-count', {
    method: 'GET',
    cache: 'no-store',
  });
  const data = await ensureOk<{ unreadCount?: number }>(response, 'Ungelesene Nachrichten konnten nicht geladen werden');
  return Number(data?.unreadCount || 0);
}

export async function markCitizenMessageReadState(messageId: string, read: boolean): Promise<number> {
  const response = await fetch(`/api/citizen/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ read }),
  });
  const data = await ensureOk<{ unreadCount?: number }>(response, 'Nachricht konnte nicht aktualisiert werden');
  return Number(data?.unreadCount || 0);
}

export async function markAllCitizenMessagesRead(): Promise<number> {
  const response = await fetch('/api/citizen/messages/read-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const data = await ensureOk<{ unreadCount?: number }>(response, 'Nachrichten konnten nicht aktualisiert werden');
  return Number(data?.unreadCount || 0);
}

export async function subscribeCitizenPush(
  subscription: PushSubscriptionJSON
): Promise<{ ok: boolean; id?: string }> {
  const response = await fetch('/api/citizen/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subscription }),
  });
  return ensureOk<{ ok: boolean; id?: string }>(response, 'Push-Subscription konnte nicht gespeichert werden');
}

export async function unsubscribeCitizenPush(endpoint?: string): Promise<{ ok: boolean; revoked?: number }> {
  const response = await fetch('/api/citizen/push/unsubscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ endpoint: endpoint || '' }),
  });
  return ensureOk<{ ok: boolean; revoked?: number }>(response, 'Push-Subscription konnte nicht entfernt werden');
}
