import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import SubmissionForm from './components/SubmissionForm';
import Footer from './components/Footer';
import Verify from './pages/Verify';
import WorkflowConfirm from './pages/WorkflowConfirm';
import WorkflowDataRequest from './pages/WorkflowDataRequest';
import TicketStatus from './pages/TicketStatus';
import Guide from './pages/Guide';
import Privacy from './pages/Privacy';
import CitizenLogin from './pages/CitizenLogin';
import CitizenReports from './pages/CitizenReports';
import CitizenReportDetail from './pages/CitizenReportDetail';
import CitizenMessages from './pages/CitizenMessages';
import PlatformLanding from './pages/PlatformLanding';
import LanguageSelector from './components/LanguageSelector';
import { isInstallPromptAvailable, showInstallPrompt } from './service-worker';
import { useI18n } from './i18n/I18nProvider';
import { getCitizenSession, getCitizenUnreadMessageCount } from './lib/citizenAuth';
import { isIosDevice, isStandaloneMode, sanitizeOpenTarget } from './lib/pwa';
import './App.css';

const normalizePath = (input: unknown): string => {
  const raw = String(input || '').trim();
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const normalized = withLeadingSlash.replace(/\/+$/g, '') || '/';
  return normalized;
};

const extractTenantBasePath = (pathname: string, tenantBasePath = '/c'): string => {
  const normalizedPath = normalizePath(pathname);
  const base = normalizePath(tenantBasePath);
  const prefix = `${base}/`;
  if (!normalizedPath.startsWith(prefix)) return '/';
  const rest = normalizedPath.slice(prefix.length);
  const slug = rest.split('/')[0] || '';
  return slug ? `${base}/${slug}` : '/';
};

const stripBaseFromPath = (pathname: string, basePath: string): string => {
  const normalizedPath = normalizePath(pathname);
  const normalizedBase = normalizePath(basePath);
  if (normalizedBase === '/') return normalizedPath;
  if (normalizedPath === normalizedBase) return '/';
  if (normalizedPath.startsWith(`${normalizedBase}/`)) {
    return normalizedPath.slice(normalizedBase.length) || '/';
  }
  return normalizedPath;
};

const joinBaseAndPath = (basePath: string, targetPath: string): string => {
  const normalizedBase = normalizePath(basePath);
  const normalizedTarget = normalizePath(targetPath);
  if (normalizedBase === '/') return normalizedTarget;
  if (normalizedTarget === '/') return normalizedBase;
  return `${normalizedBase}${normalizedTarget}`.replace(/\/{2,}/g, '/');
};

const shouldRedirectLegacyRootCallback = (pathname: string, search: string): boolean => {
  const normalizedPath = normalizePath(pathname);
  if (normalizedPath !== '/') return false;
  const params = new URLSearchParams(search || '');
  const token = String(params.get('token') || '').trim();
  if (!token) return false;
  const callbackType = String(params.get('cb') || '').trim();
  if (callbackType) return true;
  return params.has('resetToken');
};

const ROUTING_SPLASH_MIN_VISIBLE_MS = 500;

const resolveCanonicalRedirectTarget = (input: {
  publicConfigLoaded: boolean;
  canonicalBasePath: string;
  pathname: string;
  search: string;
  hash: string;
  platformPath: string;
  rootMode: 'platform' | 'tenant';
  tenantBasePath: string;
  tenantMismatch: boolean;
}): string | null => {
  if (!input.publicConfigLoaded) return null;
  const canonicalBase = normalizePath(input.canonicalBasePath || '/');
  const currentBase = extractTenantBasePath(input.pathname, input.tenantBasePath);
  if (!canonicalBase || canonicalBase === currentBase) return null;

  const normalizedPath = normalizePath(input.pathname);
  const platformPath = normalizePath(input.platformPath || '/plattform');
  const onTenantPath = currentBase !== '/';
  const onCitizenRootPath =
    normalizedPath === '/verify' ||
    normalizedPath === '/status' ||
    normalizedPath === '/workflow/confirm' ||
    normalizedPath === '/workflow/data-request' ||
    normalizedPath === '/login' ||
    normalizedPath === '/me' ||
    normalizedPath.startsWith('/me/') ||
    normalizedPath === '/guide' ||
    normalizedPath === '/privacy';
  const onPlatformRootPath = normalizedPath === '/';
  const onConfiguredPlatformPath =
    platformPath !== '/' && (normalizedPath === platformPath || normalizedPath.startsWith(`${platformPath}/`));

  const shouldCanonicalize =
    onTenantPath || input.rootMode === 'tenant' || input.tenantMismatch || onCitizenRootPath;
  if (onConfiguredPlatformPath) return null;
  if (onPlatformRootPath && input.rootMode === 'platform' && !input.tenantMismatch) return null;
  if (!shouldCanonicalize) return null;

  const relativePath = stripBaseFromPath(input.pathname, currentBase);
  const targetPath = joinBaseAndPath(canonicalBase, relativePath);
  const nextUrl = `${targetPath}${input.search || ''}${input.hash || ''}`;
  const currentUrl = `${input.pathname}${input.search || ''}${input.hash || ''}`;
  if (nextUrl === currentUrl) return null;
  return nextUrl;
};

// Main App Layout Component
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    citizenAnnouncement,
    citizenProfileTexts,
    t,
    frontendToken,
    routing,
    canonicalBasePath,
    tenantMismatch,
    publicConfigLoaded,
  } = useI18n();
  const [serviceHealth, setServiceHealth] = useState<'loading' | 'ok' | 'error'>('loading');
  const [lastHealthCheck, setLastHealthCheck] = useState('');
  const [showServiceDownScreen, setShowServiceDownScreen] = useState(false);
  const [installAvailable, setInstallAvailable] = useState<boolean>(() => isInstallPromptAvailable());
  const [installing, setInstalling] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  const [citizenAuthenticated, setCitizenAuthenticated] = useState(false);
  const [citizenSessionEmail, setCitizenSessionEmail] = useState('');
  const [citizenUnreadCount, setCitizenUnreadCount] = useState(0);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const splashShownAtRef = useRef<number>(0);
  const splashHideTimerRef = useRef<number | null>(null);
  const runningInTenantBase = /^\/c\/[^/]+(?:\/|$)/i.test(window.location.pathname);
  const normalizedPath = normalizePath(location.pathname);
  const platformPath = normalizePath(routing.platformPath || '/plattform');
  const tenantBasePath = extractTenantBasePath(window.location.pathname, routing.tenantBasePath);
  const relativePath = stripBaseFromPath(normalizedPath, tenantBasePath);
  const onConfiguredPlatformPath =
    platformPath !== '/' &&
    (relativePath === platformPath || relativePath.startsWith(`${platformPath}/`));
  const onPlatformRoot = relativePath === '/' && routing.rootMode === 'platform' && !runningInTenantBase;
  const isPlatformPresentationRoute = onConfiguredPlatformPath || onPlatformRoot;
  const isSubmissionRoute = location.pathname === '/' && (routing.rootMode === 'tenant' || runningInTenantBase);
  const headerTag = citizenProfileTexts.headerTag || 'Online-Service';
  const headerGuideCta = 'Anleitung & Hilfe';
  const headerKicker = citizenProfileTexts.headerKicker || 'Verbandsgemeinde';
  const headerTitle = citizenProfileTexts.headerTitle || 'Otterbach-Otterberg';
  const headerSubtitle = citizenProfileTexts.headerSubtitle || 'Bürgermeldung · behebes.AI';
  const installCta = 'App installieren';
  const installPending = 'Wird geöffnet...';
  const openTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return sanitizeOpenTarget(params.get('open'));
  }, [location.search]);
  const canonicalRedirectTarget = useMemo(
    () =>
      resolveCanonicalRedirectTarget({
        publicConfigLoaded,
        canonicalBasePath,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        platformPath: routing.platformPath || '/plattform',
        rootMode: routing.rootMode,
        tenantBasePath: routing.tenantBasePath,
        tenantMismatch,
      }),
    [
      canonicalBasePath,
      location.hash,
      location.pathname,
      location.search,
      publicConfigLoaded,
      routing.platformPath,
      routing.rootMode,
      routing.tenantBasePath,
      tenantMismatch,
    ]
  );
  const currentRelativeUrl = `${location.pathname}${location.search || ''}${location.hash || ''}`;
  const openRedirectPending = !!openTarget && openTarget !== currentRelativeUrl;
  const legacyVerifyRedirectPending = shouldRedirectLegacyRootCallback(location.pathname, location.search);
  const waitingForInitialRootRouting = normalizePath(location.pathname) === '/' && !publicConfigLoaded;
  const showRoutingSplash =
    waitingForInitialRootRouting || openRedirectPending || legacyVerifyRedirectPending || !!canonicalRedirectTarget;
  const [routingSplashVisible, setRoutingSplashVisible] = useState(showRoutingSplash);

  const applyAppBadgeCount = useCallback((count: number) => {
    const safeCount = Math.max(0, Math.floor(Number(count || 0)));
    const nav = navigator as any;
    if (!nav || typeof nav.setAppBadge !== 'function' || typeof nav.clearAppBadge !== 'function') return;
    if (safeCount > 0) {
      void nav.setAppBadge(safeCount).catch(() => undefined);
      return;
    }
    void nav.clearAppBadge().catch(() => undefined);
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) {
        setServiceHealth('error');
        setLastHealthCheck(new Date().toISOString());
        return;
      }
      const data = await response.json();
      setServiceHealth(data?.status === 'ok' ? 'ok' : 'error');
      setLastHealthCheck(data?.timestamp || new Date().toISOString());
    } catch {
      setServiceHealth('error');
      setLastHealthCheck(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const runHealthcheck = async () => {
      if (!mounted) return;
      await checkHealth();
    };

    runHealthcheck();
    const interval = setInterval(runHealthcheck, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [checkHealth]);

  useEffect(() => {
    if (serviceHealth !== 'error') {
      setShowServiceDownScreen(false);
      return;
    }
    const timerId = window.setTimeout(() => {
      setShowServiceDownScreen(true);
    }, 1200);
    return () => window.clearTimeout(timerId);
  }, [serviceHealth, lastHealthCheck]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ available?: boolean }>).detail;
      setInstallAvailable(!!detail?.available);
    };
    window.addEventListener('pwa-install-available', handler as EventListener);
    setInstallAvailable(isInstallPromptAvailable());
    return () => {
      window.removeEventListener('pwa-install-available', handler as EventListener);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const loadSession = async () => {
      try {
        const response = await getCitizenSession(frontendToken);
        if (!alive) return;
        const authenticated = response.authenticated === true;
        setCitizenAuthenticated(authenticated);
        setCitizenSessionEmail(authenticated ? String(response.email || '') : '');
        if (!authenticated) {
          setCitizenUnreadCount(0);
          applyAppBadgeCount(0);
        }
      } catch {
        if (!alive) return;
        setCitizenAuthenticated(false);
        setCitizenSessionEmail('');
        setCitizenUnreadCount(0);
        applyAppBadgeCount(0);
      }
    };

    void loadSession();
    const intervalId = window.setInterval(() => {
      void loadSession();
    }, 30000);
    window.addEventListener('focus', loadSession);

    return () => {
      alive = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', loadSession);
    };
  }, [applyAppBadgeCount, frontendToken]);

  useEffect(() => {
    const onUnreadEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail;
      const nextCount = Math.max(0, Math.floor(Number(detail?.count || 0)));
      setCitizenUnreadCount(nextCount);
      applyAppBadgeCount(nextCount);
    };
    window.addEventListener('citizen-unread-count', onUnreadEvent as EventListener);
    return () => {
      window.removeEventListener('citizen-unread-count', onUnreadEvent as EventListener);
    };
  }, [applyAppBadgeCount]);

  useEffect(() => {
    if (!citizenAuthenticated) {
      setCitizenUnreadCount(0);
      applyAppBadgeCount(0);
      return;
    }

    let alive = true;
    const loadUnread = async () => {
      try {
        const count = await getCitizenUnreadMessageCount();
        if (!alive) return;
        const safeCount = Math.max(0, Math.floor(Number(count || 0)));
        setCitizenUnreadCount(safeCount);
        applyAppBadgeCount(safeCount);
      } catch {
        if (!alive) return;
      }
    };

    void loadUnread();
    const timer = window.setInterval(() => {
      void loadUnread();
    }, 20000);
    window.addEventListener('focus', loadUnread);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', loadUnread);
    };
  }, [applyAppBadgeCount, citizenAuthenticated]);

  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    setHeaderCollapsed(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    setAnnouncementDismissed(false);
  }, [citizenAnnouncement.enabled, citizenAnnouncement.mode, citizenAnnouncement.sourceHash]);

  useEffect(() => {
    if (!openTarget) return;
    const standalone = isStandaloneMode();
    const isIos = isIosDevice();
    if (standalone || !isIos) {
      navigate(openTarget, { replace: true });
      return;
    }
    const timerId = window.setTimeout(() => {
      navigate(openTarget, { replace: true });
    }, 400);
    return () => window.clearTimeout(timerId);
  }, [navigate, openTarget]);

  useEffect(() => {
    if (!shouldRedirectLegacyRootCallback(location.pathname, location.search)) return;
    navigate(`/verify${location.search || ''}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!canonicalRedirectTarget) return;
    window.location.replace(canonicalRedirectTarget);
  }, [canonicalRedirectTarget]);

  const handleMainScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const shouldCollapse = event.currentTarget.scrollTop > 24;
    setHeaderCollapsed((prev) => (prev === shouldCollapse ? prev : shouldCollapse));
  }, []);

  useEffect(() => {
    const onWindowScroll = () => {
      const container = mainScrollRef.current;
      if (container && container.scrollHeight > container.clientHeight + 4) {
        return;
      }
      const shouldCollapse = window.scrollY > 24;
      setHeaderCollapsed((prev) => (prev === shouldCollapse ? prev : shouldCollapse));
    };
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onWindowScroll);
    };
  }, []);

  const handleInstallClick = async () => {
    setInstalling(true);
    try {
      await showInstallPrompt();
    } finally {
      setInstalling(false);
      setInstallAvailable(isInstallPromptAvailable());
    }
  };

  const backendReady = serviceHealth === 'ok';
  const showAnnouncementBanner = citizenAnnouncement.enabled && citizenAnnouncement.mode === 'banner';
  const showAnnouncementModal =
    citizenAnnouncement.enabled &&
    citizenAnnouncement.mode === 'modal' &&
    !announcementDismissed;
  const dismissAnnouncementModal = useCallback(() => {
    setAnnouncementDismissed(true);
  }, []);

  useEffect(() => {
    if (!showAnnouncementModal) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissAnnouncementModal();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dismissAnnouncementModal, showAnnouncementModal]);

  useEffect(() => {
    if (showRoutingSplash) {
      if (splashHideTimerRef.current) {
        window.clearTimeout(splashHideTimerRef.current);
        splashHideTimerRef.current = null;
      }
      if (!splashShownAtRef.current) {
        splashShownAtRef.current = Date.now();
      }
      setRoutingSplashVisible(true);
      return;
    }

    if (!splashShownAtRef.current) {
      setRoutingSplashVisible(false);
      return;
    }

    const elapsed = Date.now() - splashShownAtRef.current;
    const remaining = Math.max(0, ROUTING_SPLASH_MIN_VISIBLE_MS - elapsed);
    if (remaining === 0) {
      splashShownAtRef.current = 0;
      setRoutingSplashVisible(false);
      return;
    }

    splashHideTimerRef.current = window.setTimeout(() => {
      splashShownAtRef.current = 0;
      splashHideTimerRef.current = null;
      setRoutingSplashVisible(false);
    }, remaining);

    return () => {
      if (splashHideTimerRef.current) {
        window.clearTimeout(splashHideTimerRef.current);
        splashHideTimerRef.current = null;
      }
    };
  }, [showRoutingSplash]);

  useEffect(() => {
    return () => {
      if (splashHideTimerRef.current) {
        window.clearTimeout(splashHideTimerRef.current);
        splashHideTimerRef.current = null;
      }
    };
  }, []);
  if (!backendReady && serviceHealth === 'error' && showServiceDownScreen) {
    return (
      <div className="service-down-shell" role="alert" aria-live="assertive">
        <div className="service-down-card">
          <div className="service-down-icon">
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
          </div>
          <h1>Dienst aktuell nicht verfügbar</h1>
          <p>
            Das Bürgerportal ist vorübergehend nicht erreichbar. Bitte versuchen Sie es in Kürze erneut.
          </p>
          {lastHealthCheck && (
            <p className="service-down-meta">
              Letzte Prüfung: {new Date(lastHealthCheck).toLocaleTimeString('de-DE')}
            </p>
          )}
          <p className="service-down-meta">Automatische Wiederholung läuft.</p>
          <button type="button" className="service-down-retry" onClick={checkHealth}>
            Erneut prüfen
          </button>
        </div>
      </div>
    );
  }

  if (routingSplashVisible) {
    return (
      <div className="routing-splash-shell" role="status" aria-live="polite" aria-busy="true">
        <div className="routing-splash-card">
          <img src="/logo.png" alt="behebes" className="routing-splash-logo" />
          <p className="routing-splash-title">behebes lädt…</p>
          <p className="routing-splash-subtitle">Route wird vorbereitet</p>
          <div className="routing-splash-progress" aria-hidden="true">
            <span />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`app-shell${isSubmissionRoute ? ' app-shell--submission' : ''}${
        headerCollapsed ? ' app-shell--header-collapsed' : ''
      }${isPlatformPresentationRoute ? ' app-shell--platform' : ''}`}
    >
      {!isPlatformPresentationRoute ? (
        <header className="app-header">
          <div className="app-header-utility">
            <div className="app-header-utility-inner">
              <div className="app-header-tag">{headerTag}</div>
              <div className="app-header-tools">
                <LanguageSelector />
                <div className="app-header-actions">
                  <Link to={citizenAuthenticated ? '/me' : '/login'} className="app-guide-link">
                    <i className="fa-solid fa-user-check" />{' '}
                    {citizenAuthenticated ? 'Meine Meldungen' : 'Anmelden'}
                  </Link>
                  {citizenAuthenticated && (
                    <Link to="/me/messages" className="app-guide-link app-guide-link--messages">
                      <i className="fa-solid fa-bell" /> Nachrichten
                      {citizenUnreadCount > 0 && (
                        <span className="app-link-badge">{citizenUnreadCount > 99 ? '99+' : citizenUnreadCount}</span>
                      )}
                    </Link>
                  )}
                  <Link to="/guide" className="app-guide-link">
                    <i className="fa-solid fa-book-open-reader" /> {headerGuideCta}
                  </Link>
                  {installAvailable && (
                    <button
                      type="button"
                      className="pwa-install-btn"
                      onClick={handleInstallClick}
                      disabled={installing}
                    >
                      <i className="fa-solid fa-download" /> {installing ? installPending : installCta}
                    </button>
                  )}
                </div>
                {citizenAuthenticated && citizenSessionEmail && (
                  <span className="app-header-tag">{citizenSessionEmail}</span>
                )}
              </div>
            </div>
          </div>

          <div className="app-header-main">
            <div className="app-header-inner">
              <div className="app-brand">
                <div className="app-header-logo">
                  <img src="/logo.png" alt="Verbandsgemeinde Otterbach-Otterberg" />
                </div>
                <div className="app-header-content">
                  <p className="app-kicker">{headerKicker}</p>
                  <h1>{headerTitle}</h1>
                  <p className="app-subtitle">{headerSubtitle}</p>
                </div>
              </div>
            </div>
          </div>
        </header>
      ) : null}

      <div
        className={`app-main${isSubmissionRoute ? ' app-main--submission' : ''}${
          isPlatformPresentationRoute ? ' app-main--platform' : ''
        }`}
        ref={mainScrollRef}
        onScroll={handleMainScroll}
      >
        {!isPlatformPresentationRoute && showAnnouncementBanner ? (
          <section className="citizen-announcement citizen-announcement--banner" role="status" aria-live="polite">
            <div className="citizen-announcement-content">
              {citizenAnnouncement.title && <h2>{citizenAnnouncement.title}</h2>}
              {citizenAnnouncement.message && <p>{citizenAnnouncement.message}</p>}
            </div>
          </section>
        ) : null}
        {children}
      </div>

      {!isPlatformPresentationRoute ? (
        <div className="app-footer-shell">
          <Footer compact />
        </div>
      ) : null}

      {!isPlatformPresentationRoute && showAnnouncementModal && (
        <div
          className="citizen-announcement-modal"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              dismissAnnouncementModal();
            }
          }}
        >
          <div className="citizen-announcement-modal-card">
            <button
              type="button"
              className="citizen-announcement-modal-close"
              onClick={dismissAnnouncementModal}
              aria-label={t('translation_modal_dismiss')}
              title={t('translation_modal_dismiss')}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
            <div className="citizen-announcement-content">
              {citizenAnnouncement.title && <h2>{citizenAnnouncement.title}</h2>}
              {citizenAnnouncement.message && <p>{citizenAnnouncement.message}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const { routing, publicConfigLoaded } = useI18n();
  const runningInTenantBase = /^\/c\/[^/]+(?:\/|$)/i.test(window.location.pathname);
  const platformPath = normalizePath(routing.platformPath || '/plattform');
  const renderCitizenRoot = runningInTenantBase || routing.rootMode === 'tenant';

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={renderCitizenRoot ? <SubmissionForm /> : <PlatformLanding />} />
        {platformPath !== '/' && <Route path={`${platformPath}/*`} element={<PlatformLanding />} />}
        <Route path="/guide" element={<Guide />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/login" element={<CitizenLogin />} />
        <Route path="/me" element={<CitizenReports />} />
        <Route path="/me/messages" element={<CitizenMessages />} />
        <Route path="/me/tickets/:ticketId" element={<CitizenReportDetail />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/status" element={<TicketStatus />} />
        <Route path="/workflow/confirm" element={<WorkflowConfirm />} />
        <Route path="/workflow/data-request" element={<WorkflowDataRequest />} />
        <Route path="*" element={publicConfigLoaded ? <Navigate to="/" /> : <></>} />
      </Routes>
    </AppLayout>
  );
};

// Root component with Router
const RootApp: React.FC = () => {
  const basename = useMemo(() => {
    const tenantBase = extractTenantBasePath(window.location.pathname, '/c');
    return tenantBase === '/' ? undefined : tenantBase;
  }, []);

  return (
    <Router basename={basename}>
      <App />
    </Router>
  );
};

export default RootApp;
