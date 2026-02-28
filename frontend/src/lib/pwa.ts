export const isIosDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isAppleMobile = /iphone|ipad|ipod/i.test(ua);
  const isIpadOs = window.navigator.platform === 'MacIntel' && (window.navigator as any).maxTouchPoints > 1;
  return isAppleMobile || isIpadOs;
};

export const isStandaloneMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as any;
  return (
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    nav?.standalone === true
  );
};

export const sanitizeOpenTarget = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;
  return decoded;
};

export const buildOpenRedirectUrl = (targetPath: string): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const normalized = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  const url = new URL('/', origin || 'http://localhost');
  url.searchParams.set('open', normalized);
  return url.toString();
};
