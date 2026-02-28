import { APP_BUILD_ID } from './buildInfo';

let registration: ServiceWorkerRegistration | null = null;
let deferredPrompt: BeforeInstallPromptEvent | null = null;

const INSTALL_EVENT_NAME = 'ops-pwa-install-available';

function emitInstallAvailability() {
  window.dispatchEvent(
    new CustomEvent(INSTALL_EVENT_NAME, {
      detail: { available: !!deferredPrompt },
    })
  );
}

function buildServiceWorkerUrl() {
  return `/ops/sw.js?build=${encodeURIComponent(APP_BUILD_ID)}`;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  registration = await navigator.serviceWorker.register(buildServiceWorkerUrl(), {
    scope: '/ops/',
  });
  void registration.update();
}

export function isInstallPromptAvailable(): boolean {
  return !!deferredPrompt;
}

export async function showInstallPrompt() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  emitInstallAvailability();
  return choice.outcome === 'accepted';
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event as unknown as BeforeInstallPromptEvent;
  emitInstallAvailability();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  emitInstallAvailability();
});

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
