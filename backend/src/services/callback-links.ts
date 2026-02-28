/**
 * Callback-Link helpers
 */

function deriveDefaultCallbackUrl(frontendBaseInput?: string): string {
  const frontendBase = frontendBaseInput || 'http://localhost:5173';
  try {
    const url = new URL(frontendBase);
    const normalizedPath = (url.pathname || '/').replace(/\/+$/g, '');
    if (!normalizedPath || normalizedPath === '/') {
      url.pathname = '/verify';
    } else if (/\/verify$/i.test(normalizedPath)) {
      url.pathname = normalizedPath;
    } else if (/\/admin$/i.test(normalizedPath)) {
      const basePath = normalizedPath.replace(/\/admin$/i, '') || '/';
      url.pathname = `${basePath.replace(/\/+$/g, '')}/verify`.replace(/^$/, '/verify');
    } else if (!/\/verify\/?$/i.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/+$/g, '')}/verify`;
    }
    return url.toString();
  } catch {
    return 'http://localhost:5173/verify';
  }
}

const DEFAULT_CALLBACK_URL = deriveDefaultCallbackUrl(process.env.FRONTEND_URL);

function normalizeVerifyCallbackPath(pathname: string): string {
  const normalizedPath = (String(pathname || '/').replace(/\/+$/g, '') || '/');

  if (!normalizedPath || normalizedPath === '/') {
    return '/verify';
  }
  if (/\/verify$/i.test(normalizedPath)) {
    return normalizedPath;
  }
  if (/\/status$/i.test(normalizedPath)) {
    return normalizedPath.replace(/\/status$/i, '/verify');
  }
  if (/\/workflow\/confirm$/i.test(normalizedPath)) {
    return normalizedPath.replace(/\/workflow\/confirm$/i, '/verify');
  }
  if (/\/workflow\/data-request$/i.test(normalizedPath)) {
    return normalizedPath.replace(/\/workflow\/data-request$/i, '/verify');
  }
  if (/\/admin$/i.test(normalizedPath)) {
    const basePath = normalizedPath.replace(/\/admin$/i, '') || '/';
    return `${basePath.replace(/\/+$/g, '')}/verify`.replace(/^$/, '/verify');
  }
  return `${normalizedPath}/verify`;
}

function normalizeRootCallbackPath(pathname: string, searchParams: URLSearchParams): string {
  const normalizedPath = (String(pathname || '/').replace(/\/+$/g, '') || '/');
  if (normalizedPath !== '/') return normalizedPath;

  const callbackType = String(searchParams.get('cb') || '').trim().toLowerCase();
  if (callbackType === 'ticket_status') return '/status';
  if (callbackType === 'workflow_data_request') return '/workflow/data-request';
  if (callbackType) return '/verify';
  if (searchParams.has('resetToken')) return '/verify';

  return normalizedPath;
}

function deriveOpenBasePath(pathname: string): string {
  const normalized = String(pathname || '/').replace(/\/+$/g, '') || '/';
  const candidates = ['/verify', '/status', '/workflow/confirm', '/workflow/data-request'];
  const match = candidates.find((candidate) => normalized.toLowerCase().endsWith(candidate));
  if (!match) return '/';
  const base = normalized.slice(0, -match.length);
  return base || '/';
}

function wrapWithOpenGate(url: URL): URL {
  if (url.searchParams.has('open')) return url;
  const normalizedPath = normalizeRootCallbackPath(url.pathname, url.searchParams);
  if (normalizedPath !== url.pathname) {
    url.pathname = normalizedPath;
  }
  const targetPath = `${url.pathname}${url.search}${url.hash}`;
  const basePath = deriveOpenBasePath(url.pathname);
  const wrapped = new URL(basePath || '/', url.origin);
  const token = url.searchParams.get('token');
  const frontendToken = url.searchParams.get('frontendToken');
  const profileToken = url.searchParams.get('profileToken');
  if (token) {
    wrapped.searchParams.set('token', token);
  }
  if (frontendToken) {
    wrapped.searchParams.set('frontendToken', frontendToken);
  }
  if (profileToken) {
    wrapped.searchParams.set('profileToken', profileToken);
  }
  wrapped.searchParams.set('open', targetPath);
  return wrapped;
}

function derivePublicBasePath(pathname: string): string {
  const normalized = String(pathname || '/').replace(/\/+$/g, '') || '/';
  const callbackPaths = ['/verify', '/status', '/workflow/confirm', '/workflow/data-request'];
  const matched = callbackPaths.find((path) => normalized.toLowerCase().endsWith(path));
  if (matched) {
    const base = normalized.slice(0, -matched.length);
    return base || '/';
  }
  if (/\/admin$/i.test(normalized)) {
    return normalized.replace(/\/admin$/i, '') || '/';
  }
  return normalized || '/';
}

export function derivePublicBaseUrlFromCallback(callbackUrl?: string): string {
  const url = toUrl(callbackUrl);
  url.search = '';
  url.hash = '';
  url.pathname = derivePublicBasePath(url.pathname);
  return url.toString();
}

export function normalizeAdminBaseUrl(adminUrl?: string): string {
  const input = String(adminUrl || '').trim();
  if (!input) return '';
  try {
    const url = new URL(input);
    const normalizedPath = (url.pathname || '/').replace(/\/+$/g, '') || '/';
    url.pathname = normalizedPath === '/' ? '/admin' : normalizedPath;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/g, '');
  } catch {
    return '';
  }
}

export function wrapLinkForPwaOpenGate(urlString: string): string {
  try {
    const parsed = new URL(urlString);
    return wrapWithOpenGate(parsed).toString();
  } catch {
    return urlString;
  }
}

function toUrl(input?: string): URL {
  if (input && input.trim()) {
    try {
      const parsed = new URL(input.trim());
      const frontendBase = process.env.FRONTEND_URL;
      const isLegacyLocalDevUrl =
        parsed.hostname === 'localhost' &&
        (parsed.port === '5173' || parsed.port === '5174');
      if (process.env.NODE_ENV === 'production' && frontendBase && isLegacyLocalDevUrl) {
        return new URL(deriveDefaultCallbackUrl(frontendBase));
      }
      return parsed;
    } catch {
      // Fallback below
    }
  }
  return new URL(DEFAULT_CALLBACK_URL);
}

export function buildCallbackLink(
  callbackUrl: string | undefined,
  params: Record<string, string | number | boolean | null | undefined>,
  options?: { wrap?: boolean }
): string {
  const url = toUrl(callbackUrl);
  url.pathname = normalizeVerifyCallbackPath(url.pathname);
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    url.searchParams.set(key, String(value));
  });
  const shouldWrap = options?.wrap !== false;
  return (shouldWrap ? wrapWithOpenGate(url) : url).toString();
}

export function buildWorkflowConfirmationCallbackLink(
  callbackUrl: string | undefined,
  params: Record<string, string | number | boolean | null | undefined>,
  options?: { wrap?: boolean }
): string {
  const url = toUrl(callbackUrl);
  const normalizedPath = (url.pathname || '/').replace(/\/+$/g, '');

  if (!normalizedPath || normalizedPath === '/') {
    url.pathname = '/workflow/confirm';
  } else if (/\/verify$/i.test(normalizedPath)) {
    url.pathname = normalizedPath.replace(/\/verify$/i, '/workflow/confirm');
  } else if (/\/admin$/i.test(normalizedPath)) {
    const basePath = normalizedPath.replace(/\/admin$/i, '') || '/';
    url.pathname = `${basePath.replace(/\/+$/g, '')}/workflow/confirm`.replace(/^$/, '/workflow/confirm');
  } else if (!/\/workflow\/confirm\/?$/i.test(normalizedPath)) {
    url.pathname = `${normalizedPath}/workflow/confirm`;
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    url.searchParams.set(key, String(value));
  });
  const shouldWrap = options?.wrap !== false;
  return (shouldWrap ? wrapWithOpenGate(url) : url).toString();
}

export function buildTicketStatusCallbackLink(
  callbackUrl: string | undefined,
  params: Record<string, string | number | boolean | null | undefined>,
  options?: { wrap?: boolean }
): string {
  const url = toUrl(callbackUrl);
  const normalizedPath = (url.pathname || '/').replace(/\/+$/g, '');

  if (!normalizedPath || normalizedPath === '/') {
    url.pathname = '/status';
  } else if (/\/verify$/i.test(normalizedPath)) {
    url.pathname = normalizedPath.replace(/\/verify$/i, '/status');
  } else if (/\/admin$/i.test(normalizedPath)) {
    const basePath = normalizedPath.replace(/\/admin$/i, '') || '/';
    url.pathname = `${basePath.replace(/\/+$/g, '')}/status`.replace(/^$/, '/status');
  } else if (!/\/status\/?$/i.test(normalizedPath)) {
    url.pathname = `${normalizedPath}/status`;
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    url.searchParams.set(key, String(value));
  });
  url.searchParams.delete('cb');
  const shouldWrap = options?.wrap !== false;
  return (shouldWrap ? wrapWithOpenGate(url) : url).toString();
}

export { DEFAULT_CALLBACK_URL, deriveDefaultCallbackUrl };
