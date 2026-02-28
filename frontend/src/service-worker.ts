import { APP_BUILD_ID } from './buildInfo';

let registration: ServiceWorkerRegistration | null = null;
let refreshing = false;
let updateBannerVisible = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let updateHooksRegistered = false;
let controllerChangeListenerRegistered = false;
let updateIntervalId: number | null = null;
let currentRegisteredScope = '/';

const INSTALL_EVENT_NAME = 'pwa-install-available';

function buildServiceWorkerUrl() {
  return `/sw.js?build=${encodeURIComponent(APP_BUILD_ID)}`;
}

function normalizeScopePath(input?: string): string {
  const raw = String(input || '/').trim();
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailing = withLeadingSlash.replace(/\/+$/g, '');
  const normalized = withoutTrailing || '/';
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function forceReloadWithBuildToken() {
  const url = new URL(window.location.href);
  url.searchParams.set('build', APP_BUILD_ID);
  window.location.replace(url.toString());
}

function emitInstallAvailability() {
  window.dispatchEvent(
    new CustomEvent(INSTALL_EVENT_NAME, {
      detail: { available: !!deferredPrompt },
    })
  );
}

export function isInstallPromptAvailable(): boolean {
  return !!deferredPrompt;
}

export async function registerServiceWorker(scopeInput = '/') {
  if (!('serviceWorker' in navigator)) {
    console.warn('[PWA] Service Workers not supported');
    return;
  }

  const desiredScope = normalizeScopePath(scopeInput);
  try {
    if (registration && currentRegisteredScope === desiredScope) {
      return;
    }
    if (registration && currentRegisteredScope !== desiredScope) {
      await registration.unregister();
      registration = null;
    }

    registration = await navigator.serviceWorker.register(buildServiceWorkerUrl(), {
      scope: desiredScope,
    });
    currentRegisteredScope = desiredScope;
    console.log('[PWA] Service Worker registered:', registration);

    if (!controllerChangeListenerRegistered) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        forceReloadWithBuildToken();
      });
      controllerChangeListenerRegistered = true;
    }

    const triggerUpdateCheck = () => registration?.update();

    if (!updateHooksRegistered) {
      // Check for updates periodically (every 30 minutes)
      updateIntervalId = window.setInterval(triggerUpdateCheck, 30 * 60 * 1000);
      window.addEventListener('focus', triggerUpdateCheck);
      window.addEventListener('online', triggerUpdateCheck);
      updateHooksRegistered = true;
    } else if (updateIntervalId === null) {
      updateIntervalId = window.setInterval(triggerUpdateCheck, 30 * 60 * 1000);
    }

    // If a waiting service worker already exists, prompt immediately
    if (registration.waiting) {
      notifyUserOfUpdate(() => activateWaitingWorker(registration));
    }

    registration.addEventListener('updatefound', () => {
      const newWorker = registration!.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          notifyUserOfUpdate(() => activateWaitingWorker(registration));
        }
      });
    });

    console.log('[PWA] Service Worker setup complete');
  } catch (error) {
    console.error('[PWA] Service Worker registration failed:', error);
  }
}

export async function reloadAppWithServiceWorkerRefresh() {
  if (!('serviceWorker' in navigator)) {
    forceReloadWithBuildToken();
    return;
  }

  try {
    const existingRegistration =
      registration ||
      (await navigator.serviceWorker.getRegistration(currentRegisteredScope)) ||
      (await navigator.serviceWorker.getRegistration());

    if (existingRegistration?.waiting) {
      activateWaitingWorker(existingRegistration);
      return;
    }

    if (existingRegistration) {
      await existingRegistration.unregister();
    }

    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
    }

    registration = await navigator.serviceWorker.register(buildServiceWorkerUrl(), {
      scope: currentRegisteredScope,
    });
    await registration.update();
  } catch (error) {
    console.error('[PWA] Manual service worker refresh failed:', error);
  }

  forceReloadWithBuildToken();
}

export function ensureServiceWorkerScope(scopeInput: string) {
  void registerServiceWorker(scopeInput);
}

function getStoredTranslation(key: string, fallback: string) {
  try {
    const language = localStorage.getItem('citizenLanguage') || 'de';
    if (language === 'de') return fallback;
    const raw = localStorage.getItem(`citizenTranslations_${language}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed?.[key] || fallback;
  } catch {
    return fallback;
  }
}

export function notifyUserOfUpdate(onReload?: () => void) {
  if (updateBannerVisible) return;
  updateBannerVisible = true;
  const title = getStoredTranslation('pwa_update_title', 'Eine neue Version von behebes.AI ist verfügbar.');
  const reloadLabel = getStoredTranslation('pwa_update_reload', 'Aktualisieren');
  const laterLabel = getStoredTranslation('pwa_update_later', 'Später');

  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    right: 20px;
    background: linear-gradient(135deg, #15365f 0%, #214575 100%);
    color: white;
    padding: 16px;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    z-index: 9999;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    font-family: 'Candara', 'Segoe UI', Tahoma, sans-serif;
  `;

  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <img src="/logo.png" alt="behebes.AI" style="width: 48px; height: 16px; object-fit: contain;" />
      <span>${title}</span>
    </div>
    <div style="display: flex; gap: 8px;">
      <button id="update-reload" style="
        background: white;
        color: #15365f;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
      ">${reloadLabel}</button>
      <button id="update-dismiss" style="
        background: rgba(255, 255, 255, 0.2);
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      ">${laterLabel}</button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById('update-reload')?.addEventListener('click', () => {
    if (onReload) {
      onReload();
    } else {
      window.location.reload();
    }
  });

  document.getElementById('update-dismiss')?.addEventListener('click', () => {
    banner.remove();
    updateBannerVisible = false;
  });

  setTimeout(() => {
    banner.remove();
    updateBannerVisible = false;
  }, 8000);
}

function activateWaitingWorker(current: ServiceWorkerRegistration | null) {
  if (!current) return;
  const waiting = current.waiting;
  if (waiting) {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  current.update();
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event as unknown as BeforeInstallPromptEvent;
  emitInstallAvailability();
  console.log('[PWA] Install prompt ready');
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  emitInstallAvailability();
  console.log('[PWA] App installed');
});

export async function showInstallPrompt() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`[PWA] User choice: ${outcome}`);
  deferredPrompt = null;
  emitInstallAvailability();
  return outcome === 'accepted';
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
