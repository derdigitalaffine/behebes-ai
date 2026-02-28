import { api, buildAuthHeaders } from '../../lib/api';
import type { AdminScopeSelection } from '../../lib/scope';

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const raw = window.atob(padded);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

export async function ensureAdminPushSubscription(token: string, scope: AdminScopeSelection): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const keyResponse = await api.get('/admin/push/public-key', {
    headers: buildAuthHeaders(token, scope),
  });
  const available = keyResponse.data?.available === true;
  const publicKey = String(keyResponse.data?.publicKey || '').trim();
  if (!available || !publicKey) return false;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    }));

  await api.post(
    '/admin/push/subscribe',
    { subscription: subscription.toJSON() },
    { headers: buildAuthHeaders(token, scope) }
  );
  return true;
}

export async function revokeAdminPushSubscription(token: string, scope: AdminScopeSelection): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const endpoint = subscription?.endpoint;
  if (subscription) {
    try {
      await subscription.unsubscribe();
    } catch {
      // ignore client-side unsubscribe failures
    }
  }

  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) return;

  try {
    await api.post(
      '/admin/push/unsubscribe',
      endpoint ? { endpoint } : {},
      { headers: buildAuthHeaders(normalizedToken, scope) }
    );
  } catch {
    // server-side cleanup is best-effort during logout/session teardown
  }
}
