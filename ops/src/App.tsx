import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppBar,
  Avatar,
  Badge,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import ForumIcon from '@mui/icons-material/Forum';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import PersonIcon from '@mui/icons-material/Person';
import DownloadIcon from '@mui/icons-material/Download';
import LogoutIcon from '@mui/icons-material/Logout';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './modules/auth/LoginPage';
import DashboardPage from './modules/dashboard/DashboardPage';
import TicketsPage from './modules/tickets/TicketsPage';
import TicketDetailPage from './modules/tickets/TicketDetailPage';
import TicketScannerPage from './modules/tickets/TicketScannerPage';
import AdminChatOverlay from './modules/messenger/AdminChatOverlay';
import MessengerPage from './modules/messenger/MessengerPage';
import ProfilePage from './modules/profile/ProfilePage';
import { clearAuthState, defaultAuthState, loadAuthState, persistAuthState, type AuthState } from './lib/auth';
import { api, buildAuthHeaders } from './lib/api';
import {
  defaultScopeSelection,
  normalizeScopeSelection,
  type AdminAccessContextPayload,
  type AdminScopeSelection,
} from './lib/scope';
import { isInstallPromptAvailable, registerServiceWorker, showInstallPrompt } from './service-worker';
import { replayOfflineMutations } from './modules/offline/offlineQueue';
import { revokeAdminPushSubscription } from './modules/pwa/push';
import { APP_BUILD_ID, APP_BUILD_TIME, APP_VERSION } from './buildInfo';

const queryClient = new QueryClient();
const INITIAL_AUTH_STATE = loadAuthState();

interface TenantOption {
  id: string;
  slug: string;
  name: string;
}

function OpsShell(props: {
  auth: AuthState;
  scope: AdminScopeSelection;
  accessContext: AdminAccessContextPayload | null;
  tenantOptions: TenantOption[];
  messageBadgeCount: number;
  installAvailable: boolean;
  onSelectScope: (selection: AdminScopeSelection) => void;
  onLogout: () => void;
}) {
  const { auth, scope, accessContext, tenantOptions, messageBadgeCount, installAvailable, onSelectScope, onLogout } = props;
  const location = useLocation();
  const navigate = useNavigate();

  const navValue = useMemo(() => {
    if (location.pathname.startsWith('/tickets')) return '/tickets';
    if (location.pathname.startsWith('/scan')) return '/scan';
    if (location.pathname.startsWith('/messenger')) return '/messenger';
    if (location.pathname.startsWith('/profile')) return '/profile';
    return '/dashboard';
  }, [location.pathname]);
  const messengerRouteActive = location.pathname.startsWith('/messenger');
  const messengerRouteConversationId = useMemo(() => {
    if (!messengerRouteActive) return '';
    const match = location.pathname.match(/^\/messenger\/(.+)$/);
    if (!match?.[1]) return '';
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }, [location.pathname, messengerRouteActive]);

  useEffect(() => {
    if (messengerRouteActive) {
      document.body.classList.add('ops-no-scroll');
      return () => {
        document.body.classList.remove('ops-no-scroll');
      };
    }
    document.body.classList.remove('ops-no-scroll');
    return () => {
      document.body.classList.remove('ops-no-scroll');
    };
  }, [messengerRouteActive]);

  const canSwitchGlobal = accessContext?.isGlobalAdmin === true;
  const buildTimeLabel = Number.isNaN(Date.parse(APP_BUILD_TIME))
    ? APP_BUILD_TIME
    : new Date(APP_BUILD_TIME).toLocaleString('de-DE');

  return (
    <Box
      sx={
        messengerRouteActive
          ? {
              height: '100dvh',
              minHeight: '100dvh',
              overflow: 'hidden',
              pb: 0,
            }
          : { minHeight: '100vh', pb: 9 }
      }
    >
      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: '1px solid #d8e2f0',
          backdropFilter: 'blur(10px)',
          bgcolor: 'rgba(255,255,255,0.86)',
        }}
      >
        <Toolbar sx={{ gap: 1.2, px: { xs: 1.2, md: 2 } }}>
          <Box component="img" src="/ops/logo.png" alt="behebes" sx={{ width: 70, height: 28, objectFit: 'contain' }} />
          <Stack spacing={0} sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography fontWeight={800} sx={{ lineHeight: 1.1 }}>Ops</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1 }}>
              Mobile Einsatzoberfläche
            </Typography>
          </Stack>

          <Chip
            size="small"
            color="secondary"
            variant="filled"
            label={accessContext?.effectiveRole || auth.role || 'staff'}
            sx={{ maxWidth: 150 }}
          />
          <Chip
            size="small"
            variant="outlined"
            label={`v${APP_VERSION}`}
            title={`Build ${APP_BUILD_ID} · ${buildTimeLabel}`}
            sx={{ bgcolor: 'white', borderColor: '#cbd5e1', color: '#334155', fontWeight: 700 }}
          />

          {canSwitchGlobal ? (
            <Select
              size="small"
              value={scope.mode === 'global' ? 'global' : scope.tenantId}
              onChange={(event) => {
                const value = String(event.target.value || 'global');
                if (value === 'global') {
                  onSelectScope({ mode: 'global', tenantId: '' });
                  return;
                }
                onSelectScope({ mode: 'tenant', tenantId: value });
              }}
              sx={{ minWidth: 170, bgcolor: 'white' }}
            >
              <MenuItem value="global">Plattform/Global</MenuItem>
              {tenantOptions.map((tenant) => (
                <MenuItem key={tenant.id} value={tenant.id}>{tenant.name || tenant.slug || tenant.id}</MenuItem>
              ))}
            </Select>
          ) : null}

          {installAvailable ? (
            <Tooltip title="App installieren">
              <IconButton color="primary" onClick={() => void showInstallPrompt()}>
                <DownloadIcon />
              </IconButton>
            </Tooltip>
          ) : null}

          <Tooltip title="Abmelden">
            <Button size="small" variant="outlined" startIcon={<LogoutIcon />} onClick={onLogout}>
              Logout
            </Button>
          </Tooltip>
          <Avatar
            sx={{
              width: 32,
              height: 32,
              fontSize: 14,
              bgcolor: '#0f172a',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            {String(auth.user?.username || 'U').slice(0, 1).toUpperCase()}
          </Avatar>
        </Toolbar>
      </AppBar>

      <Container
        maxWidth="lg"
        sx={
          messengerRouteActive
            ? { display: 'none' }
            : { pt: 2.2, pb: 2.5 }
        }
      >
        <Routes>
          <Route path="/dashboard" element={<DashboardPage token={auth.token || ''} scope={scope} />} />
          <Route path="/tickets" element={<TicketsPage token={auth.token || ''} scope={scope} />} />
          <Route path="/tickets/:ticketId" element={<TicketDetailPage token={auth.token || ''} scope={scope} />} />
          <Route path="/scan" element={<TicketScannerPage />} />
          <Route path="/messenger" element={<MessengerPage />} />
          <Route path="/messenger/:conversationId" element={<MessengerPage />} />
          <Route path="/profile" element={<ProfilePage token={auth.token || ''} scope={scope} />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Container>
      <AdminChatOverlay
        token={auth.token || ''}
        embedded={messengerRouteActive}
        hideLauncher
        routeConversationId={messengerRouteConversationId}
      />

      <Divider />
      <BottomNavigation
        value={navValue}
        onChange={(_event, value) => navigate(value)}
        showLabels
        sx={{ position: 'fixed', bottom: 0, left: 0, right: 0 }}
      >
        <BottomNavigationAction value="/dashboard" label="Dashboard" icon={<DashboardIcon />} />
        <BottomNavigationAction value="/tickets" label="Tickets" icon={<ConfirmationNumberIcon />} />
        <BottomNavigationAction value="/scan" label="Scan" icon={<QrCodeScannerIcon />} />
        <BottomNavigationAction
          value="/messenger"
          label="Messenger"
          icon={
            <Badge
              color="error"
              badgeContent={messageBadgeCount > 99 ? '99+' : messageBadgeCount}
              invisible={messageBadgeCount <= 0 || navValue === '/messenger'}
            >
              <ForumIcon />
            </Badge>
          }
        />
        <BottomNavigationAction value="/profile" label="Profil" icon={<PersonIcon />} />
      </BottomNavigation>
    </Box>
  );
}

function AppRoot() {
  const [auth, setAuth] = useState<AuthState>(() => INITIAL_AUTH_STATE);
  const [loadingAccess, setLoadingAccess] = useState(() => Boolean(INITIAL_AUTH_STATE.token));
  const [accessContext, setAccessContext] = useState<AdminAccessContextPayload | null>(null);
  const [scope, setScope] = useState<AdminScopeSelection>({ mode: 'global', tenantId: '' });
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [messageBadgeCount, setMessageBadgeCount] = useState(0);
  const [installAvailable, setInstallAvailable] = useState<boolean>(() => isInstallPromptAvailable());

  const updateAppBadge = useCallback(async (count: number) => {
    const nav = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (typeof nav.setAppBadge !== 'function' || typeof nav.clearAppBadge !== 'function') {
      return;
    }
    try {
      if (count > 0) {
        await nav.setAppBadge(count);
      } else {
        await nav.clearAppBadge();
      }
    } catch {
      // ignore unsupported badge operations
    }
  }, []);

  const refreshUnreadBadges = useCallback(async () => {
    if (!auth.token) {
      setMessageBadgeCount(0);
      await updateAppBadge(0);
      return;
    }
    try {
      const response = await api.get('/admin/mobile/dashboard', {
        headers: buildAuthHeaders(auth.token, scope),
        params: {
          timeRange: '24h',
          tenantId: scope.mode === 'tenant' ? scope.tenantId : undefined,
        },
      });
      const unreadChat = Number(response.data?.me?.unreadChatCount || 0);
      const unreadNotifications = Number(response.data?.me?.openNotifications || 0);
      const count = Math.max(0, unreadChat + unreadNotifications);
      setMessageBadgeCount(count);
      await updateAppBadge(count);
    } catch {
      // keep last known count on transient errors
    }
  }, [auth.token, scope, updateAppBadge]);

  useEffect(() => {
    void registerServiceWorker();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ available?: boolean }>).detail;
      setInstallAvailable(!!detail?.available);
    };
    window.addEventListener('ops-pwa-install-available', handler as EventListener);
    return () => {
      window.removeEventListener('ops-pwa-install-available', handler as EventListener);
    };
  }, []);

  useEffect(() => {
    persistAuthState(auth);
  }, [auth]);

  useEffect(() => {
    if (!auth.token) {
      setLoadingAccess(false);
      setAccessContext(null);
      setScope({ mode: 'global', tenantId: '' });
      setTenantOptions([]);
      setMessageBadgeCount(0);
      void updateAppBadge(0);
      void revokeAdminPushSubscription('', { mode: 'global', tenantId: '' });
      return;
    }

    let active = true;
    const load = async () => {
      setLoadingAccess(true);
      try {
        const accessResponse = await api.get('/admin/me/access-context', {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        if (!active) return;
        const payload = accessResponse.data as AdminAccessContextPayload;
        setAccessContext(payload);

        const savedRaw = localStorage.getItem('ops.scope.v1');
        const saved = savedRaw ? (JSON.parse(savedRaw) as Partial<AdminScopeSelection>) : null;
        const nextScope = normalizeScopeSelection(payload, saved || defaultScopeSelection(payload));
        setScope(nextScope);
        localStorage.setItem('ops.scope.v1', JSON.stringify(nextScope));

        if (payload?.isGlobalAdmin || (Array.isArray(payload?.tenantIds) && payload.tenantIds.length > 0)) {
          const tenantResponse = await api.get('/admin/tenants', {
            headers: { Authorization: `Bearer ${auth.token}` },
          });
          if (!active) return;
          const rows = Array.isArray(tenantResponse.data) ? tenantResponse.data : [];
          setTenantOptions(
            rows.map((row: any) => ({
              id: String(row?.id || ''),
              slug: String(row?.slug || ''),
              name: String(row?.name || row?.slug || row?.id || ''),
            }))
          );
        }
      } catch {
        if (!active) return;
        setAuth(defaultAuthState());
        clearAuthState();
        void revokeAdminPushSubscription('', { mode: 'global', tenantId: '' });
      } finally {
        if (active) setLoadingAccess(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [auth.token]);

  useEffect(() => {
    if (!auth.token) return;
    const onOnline = () => {
      void replayOfflineMutations(auth.token || '', scope);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [auth.token, scope]);

  useEffect(() => {
    if (!auth.token) return;
    void refreshUnreadBadges();
    const timer = window.setInterval(() => {
      void refreshUnreadBadges();
    }, 45_000);
    const onFocus = () => {
      void refreshUnreadBadges();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [auth.token, refreshUnreadBadges]);

  const handleLogin = (next: AuthState) => {
    if (next?.token) {
      setLoadingAccess(true);
    }
    setAuth(next);
  };

  const handleLogout = useCallback(() => {
    const logoutToken = String(auth.token || '').trim();
    const logoutScope = scope;

    void (async () => {
      await revokeAdminPushSubscription(logoutToken, logoutScope);
      if (logoutToken) {
        try {
          await api.post('/auth/admin/logout', {}, { headers: buildAuthHeaders(logoutToken, logoutScope) });
        } catch {
          // best-effort session close
        }
      }
      setAuth(defaultAuthState());
      clearAuthState();
      setLoadingAccess(false);
      setMessageBadgeCount(0);
      await updateAppBadge(0);
    })();
  }, [auth.token, scope, updateAppBadge]);

  const handleSelectScope = (selection: AdminScopeSelection) => {
    const normalized = normalizeScopeSelection(accessContext || {}, selection);
    setScope(normalized);
    localStorage.setItem('ops.scope.v1', JSON.stringify(normalized));
    void queryClient.invalidateQueries();
  };

  if (loadingAccess && auth.isAuthenticated) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <BrowserRouter basename="/ops">
      {!auth.isAuthenticated || !auth.token ? (
        <Routes>
          <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      ) : (
        <OpsShell
          auth={auth}
          scope={scope}
          accessContext={accessContext}
          tenantOptions={tenantOptions}
          messageBadgeCount={messageBadgeCount}
          installAvailable={installAvailable}
          onSelectScope={handleSelectScope}
          onLogout={handleLogout}
        />
      )}
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoot />
    </QueryClientProvider>
  );
}
