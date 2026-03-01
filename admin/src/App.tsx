import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TicketAnalytics from './pages/TicketAnalytics';
import Tickets from './pages/Tickets';
import TicketDetail from './pages/TicketDetail';
import TicketMap from './pages/TicketMap';
import Users from './pages/Users';
import UserRegistrations from './pages/UserRegistrations';
import Logs from './pages/Logs';
import AdminSettings from './pages/AdminSettings';
import AIPromptTest from './pages/AIPromptTest';
import WorkflowMonitor from './pages/WorkflowMonitor';
import InternalTasks from './pages/InternalTasks';
import EmailQueue from './pages/EmailQueue';
import MailboxClient from './pages/MailboxClient';
import AIQueue from './pages/AIQueue';
import Sessions from './pages/Sessions';
import APITokens from './pages/APITokens';
import Journal from './pages/Journal';
import AdminFooter from './components/AdminFooter';
import AdminChatOverlay from './components/AdminChatOverlay';
import Profile from './pages/Profile';
import Notifications from './pages/Notifications';
import { AuthState, clearAuthState, isAdminRole, loadAuthState, normalizeRoleLabel, persistAuthState } from './lib/auth';
import AdminScopeContext, { type AdminScopeSelection, type AdminScopeTenantOption } from './lib/adminScopeContext';
import './App.css';

type NavItem = {
  id: string;
  label: string;
  icon: string;
  to: string;
  end?: boolean;
};

type NavGroup = {
  id: string;
  label: string;
  icon: string;
  items?: NavItem[];
  groups?: NavGroup[];
  adminOnly?: boolean;
  nonAdminOnly?: boolean;
};

interface AdminAccessContextPayload {
  effectiveRole?: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'ORG_ADMIN' | 'SACHBEARBEITER' | null;
  capabilities?: string[];
  isGlobalAdmin?: boolean;
  tenantIds?: string[];
  tenantAdminTenantIds?: string[];
  orgScopes?: Array<{ tenantId?: string; orgUnitId?: string; canWrite?: boolean }>;
}

const SETTINGS_ITEMS: NavItem[] = [
  { id: 'settings-general-base', label: 'Allgemein · Basis', icon: 'fa-sliders', to: '/admin-settings/general-base' },
  { id: 'settings-general-citizen', label: 'Allgemein · Bürgerfrontend', icon: 'fa-users-viewfinder', to: '/admin-settings/general-citizen' },
  { id: 'settings-general-jurisdiction', label: 'Allgemein · Zuständigkeit', icon: 'fa-location-crosshairs', to: '/admin-settings/general-jurisdiction' },
  { id: 'settings-municipal-contacts', label: 'Kommunale Ansprechpartner', icon: 'fa-user-tie', to: '/admin-settings/municipal-contacts' },
  { id: 'settings-general-languages', label: 'Allgemein · Sprachen', icon: 'fa-language', to: '/admin-settings/general-languages' },
  { id: 'settings-general-operations', label: 'Allgemein · Betriebsalarme', icon: 'fa-bell', to: '/admin-settings/general-operations' },
  { id: 'settings-general-maintenance', label: 'Allgemein · Daten & Wartung', icon: 'fa-database', to: '/admin-settings/general-maintenance' },
  { id: 'settings-systeminfos', label: 'Systeminfos', icon: 'fa-server', to: '/admin-settings/systeminfos' },
  { id: 'settings-imports', label: 'Importe', icon: 'fa-file-import', to: '/admin-settings/imports' },
  { id: 'settings-services', label: 'Leistungen', icon: 'fa-list-check', to: '/admin-settings/services' },
  { id: 'settings-keywording', label: 'Schlagwort-Assistent', icon: 'fa-wand-magic-sparkles', to: '/admin-settings/keywording' },
  { id: 'settings-tenants', label: 'Mandanten', icon: 'fa-building', to: '/admin-settings/tenants' },
  { id: 'settings-organization-structure', label: 'Organisationsstruktur', icon: 'fa-sitemap', to: '/admin-settings/organization-structure' },
  { id: 'settings-organization-types', label: 'Organisationstypen', icon: 'fa-shapes', to: '/admin-settings/organization-types' },
  { id: 'settings-weather-api', label: 'Wetter API', icon: 'fa-cloud-sun-rain', to: '/admin-settings/weather-api' },
  { id: 'settings-categories', label: 'Kategorien', icon: 'fa-tags', to: '/admin-settings/categories' },
  { id: 'settings-ai', label: 'KI-Einstellungen', icon: 'fa-bolt', to: '/admin-settings/ai' },
  { id: 'settings-email', label: 'E-Mail SMTP/IMAP', icon: 'fa-envelope', to: '/admin-settings/email' },
  { id: 'settings-templates', label: 'E-Mail-Templates', icon: 'fa-file-lines', to: '/admin-settings/templates' },
  { id: 'settings-platform-blog', label: 'Plattform-Blog', icon: 'fa-newspaper', to: '/admin-settings/platform-blog' },
  { id: 'settings-ai-situation', label: 'KI-Lagebild', icon: 'fa-chart-line', to: '/admin-settings/ai-situation' },
  { id: 'settings-ai-memory', label: 'KI-Gedächtnis', icon: 'fa-brain', to: '/admin-settings/ai-memory' },
  { id: 'settings-ai-pseudonyms', label: 'KI-Pseudonymisierung', icon: 'fa-user-secret', to: '/admin-settings/ai-pseudonyms' },
  { id: 'settings-ai-help', label: 'KI-Hilfe', icon: 'fa-life-ring', to: '/admin-settings/ai-help' },
  { id: 'settings-redmine', label: 'Redmine', icon: 'fa-diagram-project', to: '/admin-settings/redmine' },
  { id: 'settings-workflow', label: 'Workflow-Definitionen', icon: 'fa-gears', to: '/admin-settings/workflow' },
];

const NAVIGATION_TREE: NavGroup[] = [
  {
    id: 'core',
    label: 'Kernfunktionen',
    icon: 'fa-compass',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge', to: '/', end: true },
      { id: 'analytics', label: 'Statistiken', icon: 'fa-chart-pie', to: '/analytics' },
      { id: 'tickets', label: 'Tickets', icon: 'fa-ticket', to: '/tickets' },
      { id: 'map', label: 'Karte/GIS', icon: 'fa-map-location-dot', to: '/map' },
      { id: 'workflows', label: 'Workflow-Instanzen', icon: 'fa-diagram-project', to: '/workflows' },
      { id: 'internal-tasks', label: 'Interne Aufgaben', icon: 'fa-user-check', to: '/internal-tasks' },
      { id: 'mail-queue', label: 'Mail Queue', icon: 'fa-envelope-open-text', to: '/mail-queue' },
      { id: 'mailbox-client', label: 'E-Mail Postfach', icon: 'fa-inbox', to: '/mailbox' },
      { id: 'ai-queue', label: 'KI Queue', icon: 'fa-brain', to: '/ai-queue' },
      { id: 'notifications', label: 'Benachrichtigungen', icon: 'fa-bell', to: '/notifications' },
    ],
  },
  {
    id: 'account',
    label: 'Konto',
    icon: 'fa-user',
    items: [{ id: 'profile', label: 'Mein Profil', icon: 'fa-id-badge', to: '/profile' }],
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    icon: 'fa-chart-line',
    nonAdminOnly: true,
    items: [{ id: 'logs-basic', label: 'Logs', icon: 'fa-clipboard-list', to: '/logs' }],
  },
  {
    id: 'administration',
    label: 'Administration',
    icon: 'fa-shield-halved',
    adminOnly: true,
    groups: [
      {
        id: 'administration-organisation',
        label: 'Organisationsstruktur',
        icon: 'fa-users',
        items: [
          { id: 'users', label: 'Benutzer', icon: 'fa-users', to: '/users' },
          { id: 'user-registrations', label: 'Registrierungen', icon: 'fa-user-plus', to: '/user-registrations' },
          { id: 'sessions', label: 'Sessions', icon: 'fa-user-shield', to: '/sessions' },
          { id: 'api-tokens', label: 'API-Tokens', icon: 'fa-key', to: '/api-tokens' },
          { id: 'journal', label: 'Journal', icon: 'fa-book', to: '/journal' },
          { id: 'logs-admin', label: 'Logs', icon: 'fa-clipboard-list', to: '/logs' },
        ],
      },
      {
        id: 'administration-system',
        label: 'System',
        icon: 'fa-microchip',
        items: [{ id: 'ai-test', label: 'KI-Test', icon: 'fa-flask', to: '/ai-test' }],
      },
      {
        id: 'administration-settings',
        label: 'Einstellungen',
        icon: 'fa-sliders',
        items: SETTINGS_ITEMS,
      },
    ],
  },
];

const NAV_ITEM_CAPABILITY_REQUIREMENTS: Record<string, string[]> = {
  'users': ['users.manage'],
  'user-registrations': ['registrations.manage'],
  'sessions': ['sessions.manage'],
  'api-tokens': ['api_tokens.manage'],
  'journal': ['journal.read'],
  'logs-admin': ['logs.admin', 'logs.read'],
  'ai-test': ['settings.ai.global.manage'],
  'settings-general-base': ['settings.global.manage'],
  'settings-general-citizen': ['settings.global.manage'],
  'settings-general-jurisdiction': ['settings.global.manage'],
  'settings-municipal-contacts': ['settings.global.manage'],
  'settings-general-languages': ['settings.global.manage'],
  'settings-general-operations': ['settings.global.manage'],
  'settings-general-maintenance': ['maintenance.manage'],
  'settings-systeminfos': ['settings.system.manage'],
  'settings-imports': ['users.manage', 'settings.organization.global.manage', 'settings.organization.tenant.manage'],
  'settings-services': ['settings.organization.global.manage', 'settings.organization.tenant.manage', 'settings.categories.manage', 'tickets.read', 'workflows.read'],
  'settings-keywording': ['users.manage', 'settings.organization.global.manage', 'settings.organization.tenant.manage', 'settings.categories.manage'],
  'settings-tenants': ['settings.organization.global.manage'],
  'settings-organization': ['settings.organization.global.manage', 'settings.organization.tenant.manage'],
  'settings-organization-structure': ['settings.organization.global.manage', 'settings.organization.tenant.manage'],
  'settings-organization-types': ['settings.organization.global.manage', 'settings.organization.tenant.manage'],
  'settings-weather-api': ['settings.weather.manage'],
  'settings-categories': ['settings.categories.manage'],
  'settings-ai': ['settings.ai.global.manage'],
  'settings-email': ['settings.email.global.manage', 'settings.email.tenant.manage'],
  'settings-templates': ['settings.templates.manage'],
  'settings-platform-blog': ['settings.platform_blog.manage'],
  'settings-ai-situation': ['settings.ai_situation.read', 'settings.ai_situation.manage'],
  'settings-ai-memory': ['settings.ai.global.manage'],
  'settings-ai-pseudonyms': ['settings.ai_pseudonyms.manage'],
  'settings-ai-help': ['settings.ai.global.manage', 'settings.ai_situation.read', 'settings.ai_situation.manage'],
  'settings-redmine': ['settings.redmine.manage'],
  'settings-workflow': ['settings.workflows.manage'],
};

const NAV_ITEM_PLATFORM_ONLY = new Set<string>(['settings-ai-memory']);

const isItemActive = (pathname: string, item: NavItem): boolean => {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
};

const isGroupActive = (pathname: string, group: NavGroup): boolean => {
  if (group.items?.some((item) => isItemActive(pathname, item))) return true;
  if (group.groups?.some((child) => isGroupActive(pathname, child))) return true;
  return false;
};

const filterNavigationByRole = (groups: NavGroup[], isAdmin: boolean): NavGroup[] =>
  groups
    .filter((group) => {
      if (group.adminOnly) return isAdmin;
      if (group.nonAdminOnly) return !isAdmin;
      return true;
    })
    .map((group) => ({
      ...group,
      groups: group.groups?.filter((child) => {
        if (child.adminOnly) return isAdmin;
        if (child.nonAdminOnly) return !isAdmin;
        return true;
      }),
    }));

const filterNavigationByCapabilities = (
  groups: NavGroup[],
  capabilities: Set<string>,
  effectiveRole: AdminAccessContextPayload['effectiveRole']
): NavGroup[] => {
  const hasAccess = (item: NavItem): boolean => {
    if (NAV_ITEM_PLATFORM_ONLY.has(item.id) && effectiveRole !== 'PLATFORM_ADMIN') {
      return false;
    }
    const required = NAV_ITEM_CAPABILITY_REQUIREMENTS[item.id];
    if (!required || required.length === 0) return true;
    return required.some((capability) => capabilities.has(capability));
  };

  const visit = (group: NavGroup): NavGroup | null => {
    const filteredItems = (group.items || []).filter((item) => hasAccess(item));
    const filteredGroups = (group.groups || [])
      .map((child) => visit(child))
      .filter((child): child is NavGroup => child !== null);

    if (filteredItems.length === 0 && filteredGroups.length === 0) return null;
    return {
      ...group,
      items: filteredItems,
      groups: filteredGroups,
    };
  };

  return groups
    .map((group) => visit(group))
    .filter((group): group is NavGroup => group !== null);
};

const filterNavigationByQuery = (groups: NavGroup[], queryRaw: string): NavGroup[] => {
  const query = queryRaw.trim().toLowerCase();
  if (!query) return groups;

  const filterGroup = (group: NavGroup): NavGroup | null => {
    const selfMatch = group.label.toLowerCase().includes(query);
    const matchedItems = (group.items || []).filter((item) => item.label.toLowerCase().includes(query));
    const matchedGroups = (group.groups || [])
      .map((child) => filterGroup(child))
      .filter((child): child is NavGroup => child !== null);

    if (selfMatch) {
      return {
        ...group,
        items: group.items || [],
        groups: group.groups || [],
      };
    }

    if (matchedItems.length || matchedGroups.length) {
      return {
        ...group,
        items: matchedItems,
        groups: matchedGroups,
      };
    }

    return null;
  };

  return groups
    .map((group) => filterGroup(group))
    .filter((group): group is NavGroup => group !== null);
};

const findActiveNavItemLabel = (groups: NavGroup[], pathname: string): string | null => {
  const walk = (group: NavGroup): string | null => {
    const activeItem = (group.items || []).find((item) => isItemActive(pathname, item));
    if (activeItem) return activeItem.label;
    for (const child of group.groups || []) {
      const nested = walk(child);
      if (nested) return nested;
    }
    return null;
  };

  for (const group of groups) {
    const found = walk(group);
    if (found) return found;
  }
  return null;
};

const effectiveRoleLabel = (
  effectiveRole: AdminAccessContextPayload['effectiveRole'],
  fallbackRole: AuthState['role']
): string => {
  if (effectiveRole === 'PLATFORM_ADMIN') return 'Platform Admin';
  if (effectiveRole === 'TENANT_ADMIN') return 'Mandanten-Admin';
  if (effectiveRole === 'ORG_ADMIN') return 'Orga Admin';
  if (effectiveRole === 'SACHBEARBEITER') return 'Sachbearbeiter';
  return normalizeRoleLabel(fallbackRole);
};

const ADMIN_SCOPE_STORAGE_KEY_PREFIX = 'admin.scope-selection.v1';

function buildAdminScopeStorageKey(userId?: string | null): string {
  return `${ADMIN_SCOPE_STORAGE_KEY_PREFIX}:${String(userId || 'anonymous')}`;
}

function parseStoredScopeSelection(raw: string | null): AdminScopeSelection | null {
  if (!raw) return null;
  const normalized = String(raw).trim();
  if (!normalized) return null;
  if (normalized === 'platform') {
    return {
      scope: 'platform',
      tenantId: '',
    };
  }
  if (normalized.startsWith('tenant:')) {
    const tenantId = normalized.slice('tenant:'.length).trim();
    if (!tenantId) return null;
    return {
      scope: 'tenant',
      tenantId,
    };
  }
  return null;
}

function toStoredScopeSelection(selection: AdminScopeSelection): string {
  if (selection.scope === 'tenant' && selection.tenantId) {
    return `tenant:${selection.tenantId}`;
  }
  return 'platform';
}

interface AdminLayoutProps {
  auth: AuthState;
  healthStatus: 'loading' | 'ok' | 'error';
  healthTimestamp: string;
  onLogout: () => Promise<void>;
  onProfileUpdate: (user: { id?: string; username?: string; role?: string }) => void;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ auth, healthStatus, healthTimestamp, onLogout, onProfileUpdate }) => {
  const location = useLocation();
  const admin = isAdminRole(auth.role);
  const [effectiveRole, setEffectiveRole] = useState<AdminAccessContextPayload['effectiveRole']>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const value = localStorage.getItem('admin.sidebar.collapsed');
    return value === '1';
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(() => window.matchMedia('(max-width: 1080px)').matches);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [navSearch, setNavSearch] = useState('');
  const [openNotificationCount, setOpenNotificationCount] = useState(0);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [scopeTenants, setScopeTenants] = useState<AdminScopeTenantOption[]>([]);
  const [scopeSelection, setScopeSelection] = useState<AdminScopeSelection>({
    scope: 'platform',
    tenantId: '',
  });
  const navSearchRef = useRef<HTMLInputElement | null>(null);

  const capabilitySet = useMemo(() => new Set(capabilities), [capabilities]);
  const roleNavigation = useMemo(() => {
    const roleFiltered = filterNavigationByRole(NAVIGATION_TREE, admin);
    return filterNavigationByCapabilities(roleFiltered, capabilitySet, effectiveRole || null);
  }, [admin, capabilitySet, effectiveRole]);
  const navigation = useMemo(() => filterNavigationByQuery(roleNavigation, navSearch), [roleNavigation, navSearch]);
  const searchActive = navSearch.trim().length > 0;
  const activeAreaLabel = useMemo(
    () => findActiveNavItemLabel(roleNavigation, location.pathname) || 'Übersicht',
    [roleNavigation, location.pathname]
  );

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1080px)');
    const handler = () => setIsMobileLayout(media.matches);
    handler();
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    localStorage.setItem('admin.sidebar.collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!isMobileLayout) {
      setMobileSidebarOpen(false);
    }
  }, [isMobileLayout]);

  useEffect(() => {
    let cancelled = false;
    const loadOpenNotificationCount = async () => {
      if (!auth.token) {
        if (!cancelled) setOpenNotificationCount(0);
        return;
      }
      try {
        const response = await axios.get('/api/admin/notifications', {
          headers: { Authorization: `Bearer ${auth.token}` },
          params: {
            status: 'open',
            limit: 1,
            offset: 0,
          },
        });
        if (cancelled) return;
        setOpenNotificationCount(Number(response.data?.total || 0));
      } catch {
        if (!cancelled) setOpenNotificationCount(0);
      }
    };

    void loadOpenNotificationCount();
    const timer = window.setInterval(() => {
      void loadOpenNotificationCount();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [auth.token, location.pathname]);

  useEffect(() => {
    let cancelled = false;
    const loadScopeContext = async () => {
      if (!auth.token || !admin) {
        if (!cancelled) {
          setIsGlobalAdmin(false);
          setEffectiveRole(null);
          setCapabilities([]);
          setScopeTenants([]);
          setScopeSelection({ scope: 'platform', tenantId: '' });
        }
        return;
      }

      try {
        const headers = { Authorization: `Bearer ${auth.token}` };
        const accessResponse = await axios.get<AdminAccessContextPayload>('/api/admin/me/access-context', { headers });
        const accessPayload = accessResponse.data || {};
        const nextIsGlobalAdmin = accessPayload.isGlobalAdmin === true;
        const nextEffectiveRole =
          accessPayload.effectiveRole === 'PLATFORM_ADMIN' ||
          accessPayload.effectiveRole === 'TENANT_ADMIN' ||
          accessPayload.effectiveRole === 'ORG_ADMIN' ||
          accessPayload.effectiveRole === 'SACHBEARBEITER'
            ? accessPayload.effectiveRole
            : null;
        const nextCapabilities = Array.isArray(accessPayload.capabilities)
          ? accessPayload.capabilities
              .map((entry) => String(entry || '').trim())
              .filter(Boolean)
          : [];
        const allowedTenantIds = Array.isArray(accessPayload.tenantIds)
          ? accessPayload.tenantIds
              .map((entry) => String(entry || '').trim())
              .filter(Boolean)
          : [];

        const tenantsResponse = await axios.get('/api/admin/tenants', { headers });
        const tenants = (Array.isArray(tenantsResponse.data) ? tenantsResponse.data : [])
          .map((row: any) => ({
            id: String(row?.id || '').trim(),
            name: String(row?.name || row?.id || '').trim() || String(row?.id || '').trim(),
            active: row?.active !== false,
          }))
          .filter((row: AdminScopeTenantOption) => !!row.id);

        const visibleTenants =
          nextIsGlobalAdmin || allowedTenantIds.length === 0
            ? tenants
            : tenants.filter((tenant) => allowedTenantIds.includes(tenant.id));

        if (cancelled) return;

        setIsGlobalAdmin(nextIsGlobalAdmin);
        setEffectiveRole(nextEffectiveRole);
        setCapabilities(nextCapabilities);
        setScopeTenants(visibleTenants);

        const storageKey = buildAdminScopeStorageKey(auth.userId || auth.username);
        const storedSelection = parseStoredScopeSelection(localStorage.getItem(storageKey));
        const normalizedStoredSelection =
          storedSelection &&
          (storedSelection.scope === 'platform' ||
            visibleTenants.some((tenant) => tenant.id === storedSelection.tenantId))
            ? storedSelection
            : null;

        const fallbackSelection: AdminScopeSelection =
          visibleTenants.length > 0
            ? { scope: 'tenant', tenantId: visibleTenants[0].id }
            : { scope: 'platform', tenantId: '' };
        const nextSelection = nextIsGlobalAdmin
          ? normalizedStoredSelection || { scope: 'platform', tenantId: '' }
          : normalizedStoredSelection || fallbackSelection;

        const normalizedSelection =
          nextSelection.scope === 'platform' && !nextIsGlobalAdmin
            ? fallbackSelection
            : nextSelection;
        setScopeSelection(normalizedSelection);
      } catch {
        if (cancelled) return;
        setIsGlobalAdmin(false);
        setEffectiveRole(null);
        setCapabilities([]);
        setScopeTenants([]);
        setScopeSelection({ scope: 'platform', tenantId: '' });
      }
    };

    void loadScopeContext();
    return () => {
      cancelled = true;
    };
  }, [admin, auth.token, auth.userId, auth.username]);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    const storageKey = buildAdminScopeStorageKey(auth.userId || auth.username);
    localStorage.setItem(storageKey, toStoredScopeSelection(scopeSelection));
  }, [auth.isAuthenticated, auth.userId, auth.username, scopeSelection]);

  useEffect(() => {
    if (!auth.token || !admin) {
      delete axios.defaults.headers.common['X-Admin-Context-Mode'];
      delete axios.defaults.headers.common['X-Admin-Context-Tenant-Id'];
      return;
    }
    const mode = scopeSelection.scope === 'tenant' && scopeSelection.tenantId ? 'tenant' : 'global';
    axios.defaults.headers.common['X-Admin-Context-Mode'] = mode;
    if (mode === 'tenant') {
      axios.defaults.headers.common['X-Admin-Context-Tenant-Id'] = scopeSelection.tenantId;
    } else {
      delete axios.defaults.headers.common['X-Admin-Context-Tenant-Id'];
    }
  }, [admin, auth.token, scopeSelection.scope, scopeSelection.tenantId]);

  useEffect(() => {
    if (!isMobileLayout) return;
    setMobileSidebarOpen(false);
  }, [location.pathname, isMobileLayout]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase() || '';
      const isTypingTarget =
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable === true;

      if (event.key === '/' && !isTypingTarget) {
        event.preventDefault();
        if (!isMobileLayout && sidebarCollapsed) {
          setSidebarCollapsed(false);
        }
        if (isMobileLayout) {
          setMobileSidebarOpen(true);
        }
        window.setTimeout(() => navSearchRef.current?.focus(), 0);
      }

      if (event.key === 'Escape' && navSearch.trim()) {
        setNavSearch('');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileLayout, navSearch, sidebarCollapsed]);

  useEffect(() => {
    setOpenGroups((current) => {
      if (searchActive) {
        let changed = false;
        const next = { ...current };
        const openAll = (group: NavGroup) => {
          if (!next[group.id]) {
            next[group.id] = true;
            changed = true;
          }
          group.groups?.forEach(openAll);
        };
        navigation.forEach(openAll);
        return changed ? next : current;
      }

      let changed = false;
      const next = { ...current };
      const hydrate = (group: NavGroup) => {
        if (isGroupActive(location.pathname, group) && !next[group.id]) {
          next[group.id] = true;
          changed = true;
        }
        group.groups?.forEach(hydrate);
      };
      navigation.forEach(hydrate);
      return changed ? next : current;
    });
  }, [location.pathname, navigation, searchActive]);

  const collapsed = !isMobileLayout && sidebarCollapsed;

  const toggleSidebar = () => {
    if (isMobileLayout) {
      setMobileSidebarOpen((prev) => !prev);
      return;
    }
    setSidebarCollapsed((prev) => !prev);
  };

  const toggleGroup = (groupId: string, fallbackOpen: boolean) => {
    setOpenGroups((current) => ({
      ...current,
      [groupId]: !(current[groupId] ?? fallbackOpen),
    }));
  };

  const renderItems = (items: NavItem[], level: number) => (
    <div className={`sidebar-items sidebar-level-${level}`}>
      {items.map((item) => {
        const itemBadgeCount = item.id === 'notifications' ? openNotificationCount : 0;
        const itemBadgeLabel = itemBadgeCount > 99 ? '99+' : String(itemBadgeCount);
        return (
        <NavLink
          key={item.id}
          to={item.to}
          end={item.end}
          title={collapsed ? item.label : undefined}
          onClick={() => {
            if (isMobileLayout) setMobileSidebarOpen(false);
          }}
          className={({ isActive }) => `sidebar-link sidebar-level-${level} ${isActive ? 'active' : ''}`}
        >
          <i className={`fa-solid ${item.icon}`} />
          <span className="sidebar-link-content">
            <span className="sidebar-label">{item.label}</span>
            {itemBadgeCount > 0 ? <span className="menu-badge">{itemBadgeLabel}</span> : null}
          </span>
        </NavLink>
        );
      })}
    </div>
  );

  const renderGroup = (group: NavGroup, level = 0) => {
    const active = isGroupActive(location.pathname, group);
    const hasChildren = Boolean(group.groups?.length);
    const hasItems = Boolean(group.items?.length);
    const defaultOpen = level === 0;
    const open = openGroups[group.id] ?? (defaultOpen || active);

    return (
      <div key={group.id} className={`sidebar-group sidebar-level-${level} ${active ? 'is-active' : ''}`}>
        <button
          type="button"
          className="sidebar-group-toggle"
          onClick={() => toggleGroup(group.id, defaultOpen || active)}
          title={collapsed ? group.label : undefined}
          aria-expanded={open}
        >
          <i className={`fa-solid ${group.icon}`} />
          <span className="sidebar-label">{group.label}</span>
          <i className={`fa-solid fa-chevron-${open ? 'down' : 'right'} sidebar-chevron`} />
        </button>
        <div className={`sidebar-group-content ${open ? 'open' : ''}`}>
          {hasItems && renderItems(group.items!, level + 1)}
          {hasChildren && group.groups!.map((child) => renderGroup(child, level + 1))}
        </div>
      </div>
    );
  };

  const notificationBadgeLabel = openNotificationCount > 99 ? '99+' : String(openNotificationCount);
  const scopeSelectValue =
    scopeSelection.scope === 'tenant' && scopeSelection.tenantId
      ? `tenant:${scopeSelection.tenantId}`
      : 'platform';
  const activeScopeTenant = scopeTenants.find((tenant) => tenant.id === scopeSelection.tenantId) || null;
  const activeScopeLabel =
    scopeSelection.scope === 'tenant'
      ? activeScopeTenant?.name || scopeSelection.tenantId || 'Mandant'
      : 'Plattform / Global';

  return (
    <AdminScopeContext.Provider
      value={{
        selection: scopeSelection,
        setSelection: setScopeSelection,
        isGlobalAdmin,
        tenants: scopeTenants,
        effectiveRole,
        capabilities,
        hasCapability: (capability: string) => capabilitySet.has(String(capability || '').trim()),
      }}
    >
      {isMobileLayout && mobileSidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Navigation schließen"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <div className={`admin-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className={`admin-sidebar ${mobileSidebarOpen ? 'mobile-open' : ''}`}>
          <div className="sidebar-top">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Navigation erweitern' : 'Navigation einklappen'}
              title={collapsed ? 'Navigation erweitern' : 'Navigation einklappen'}
            >
              <i className="fa-solid fa-bars" />
            </button>
            <div className="sidebar-brand">
              <img src="/logo-admin.png" alt="behebes Admin Logo" className="admin-logo" />
              <div className="sidebar-brand-copy">
                <p className="admin-kicker">Verbandsgemeinde</p>
                <h1>Admin Portal</h1>
              </div>
            </div>
            <label className="sidebar-search" htmlFor="admin-nav-search">
              <i className="fa-solid fa-magnifying-glass" />
              <input
                id="admin-nav-search"
                ref={navSearchRef}
                type="search"
                value={navSearch}
                onChange={(event) => setNavSearch(event.target.value)}
                placeholder="Menü durchsuchen (/)"
                autoComplete="off"
              />
              {navSearch ? (
                <button
                  type="button"
                  className="sidebar-search-clear"
                  onClick={() => {
                    setNavSearch('');
                    navSearchRef.current?.focus();
                  }}
                  aria-label="Suche zurücksetzen"
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              ) : null}
            </label>
          </div>
          <nav className="sidebar-nav" aria-label="Admin Navigation">
            {navigation.length > 0 ? (
              navigation.map((group) => renderGroup(group))
            ) : (
              <div className="sidebar-empty">
                <i className="fa-solid fa-filter-circle-xmark" /> Keine Menüpunkte gefunden
              </div>
            )}
          </nav>
        </aside>
        <div className="admin-content-wrap">
          <header className="admin-header">
            <div className="header-title-row">
              <button
                type="button"
                className="sidebar-toggle header-toggle"
                onClick={toggleSidebar}
                aria-label={collapsed ? 'Navigation erweitern' : 'Navigation einklappen'}
                title={collapsed ? 'Navigation erweitern' : 'Navigation einklappen'}
              >
                <i className="fa-solid fa-bars" />
              </button>
              <div>
                <p className="admin-kicker">Verbandsgemeinde Otterbach-Otterberg</p>
                <h2>Admin Backend</h2>
                <p className="header-context">Bereich: {activeAreaLabel}</p>
              </div>
            </div>
            <div className="header-info">
              {isGlobalAdmin && (
                <label className="header-context-switch" title="Arbeitskontext für Einstellungen">
                  <span>Kontext</span>
                  <select
                    value={scopeSelectValue}
                    onChange={(event) => {
                      const value = String(event.target.value || '');
                      if (value === 'platform') {
                        setScopeSelection({ scope: 'platform', tenantId: '' });
                        return;
                      }
                      if (value.startsWith('tenant:')) {
                        const tenantId = value.slice('tenant:'.length).trim();
                        if (!tenantId) return;
                        setScopeSelection({ scope: 'tenant', tenantId });
                      }
                    }}
                  >
                    <option value="platform">Plattform / Global</option>
                    {scopeTenants.map((tenant) => (
                      <option key={tenant.id} value={`tenant:${tenant.id}`}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <NavLink to="/notifications" className={({ isActive }) => `header-bell ${isActive ? 'active' : ''}`} title="Benachrichtigungen">
                <i className="fa-solid fa-bell" />
                {openNotificationCount > 0 ? <span className="menu-badge header-bell-badge">{notificationBadgeLabel}</span> : null}
              </NavLink>
              <div className="header-user">
                <strong>{auth.username || 'Unbekannt'}</strong>
                <span>{effectiveRoleLabel(effectiveRole, auth.role)} · {activeScopeLabel}</span>
              </div>
              <button onClick={onLogout} className="btn-logout">
                Logout
              </button>
            </div>
          </header>

          <main className="admin-main">
            <Routes>
              <Route path="/" element={<Dashboard token={auth.token!} role={auth.role!} />} />
              <Route path="/analytics" element={<TicketAnalytics token={auth.token!} />} />
              <Route path="/tickets" element={<Tickets token={auth.token!} role={auth.role!} />} />
              <Route path="/tickets/:id" element={<TicketDetail token={auth.token!} />} />
              <Route path="/map" element={<TicketMap token={auth.token!} />} />
              <Route path="/workflows" element={<WorkflowMonitor token={auth.token!} />} />
              <Route path="/internal-tasks" element={<InternalTasks token={auth.token!} />} />
              {admin && <Route path="/knowledge" element={<Navigate to="/admin-settings/categories" replace />} />}
              {!admin && <Route path="/knowledge" element={<Navigate to="/" replace />} />}
              <Route path="/profile" element={<Profile token={auth.token!} onProfileUpdate={onProfileUpdate} />} />
              <Route path="/notifications" element={<Notifications token={auth.token!} />} />
              {admin && <Route path="/users" element={<Users token={auth.token!} />} />}
              {admin && <Route path="/user-registrations" element={<UserRegistrations token={auth.token!} />} />}
              {admin && <Route path="/ai-test" element={<AIPromptTest />} />}
              {admin && <Route path="/admin-settings" element={<Navigate to="/admin-settings/general-base" replace />} />}
              {admin && <Route path="/admin-settings/:section" element={<AdminSettings />} />}
              {admin && <Route path="/settings" element={<Navigate to="/admin-settings/general-base" replace />} />}
              {admin && <Route path="/redmine-config" element={<Navigate to="/admin-settings/redmine" replace />} />}
              {admin && <Route path="/sessions" element={<Sessions token={auth.token!} />} />}
              {admin && <Route path="/api-tokens" element={<APITokens token={auth.token!} />} />}
              {admin && <Route path="/journal" element={<Journal token={auth.token!} />} />}
              <Route path="/logs" element={<Logs token={auth.token!} />} />
              <Route path="/mail-queue" element={<EmailQueue token={auth.token!} />} />
              <Route path="/mailbox" element={<MailboxClient token={auth.token!} />} />
              <Route path="/ai-queue" element={<AIQueue token={auth.token!} />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
          <AdminChatOverlay token={auth.token!} />
          <AdminFooter healthStatus={healthStatus} healthTimestamp={healthTimestamp} />
        </div>
      </div>
    </AdminScopeContext.Provider>
  );
};

const App: React.FC = () => {
  const [auth, setAuth] = useState<AuthState>(() => loadAuthState());
  const [healthStatus, setHealthStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [healthTimestamp, setHealthTimestamp] = useState<string>('');

  useEffect(() => {
    persistAuthState(auth, auth.remember ?? false);
  }, [auth]);

  useEffect(() => {
    const selector = '.message-banner, .error-message, .success-message, .alert.error, .alert.success';
    const scrollTo = (el: Element) => {
      if (!(el instanceof HTMLElement)) return;
      // Avoid scroll-linked smooth animation warnings in Firefox.
      el.scrollIntoView({ behavior: 'auto', block: 'start' });
    };
    const findTarget = (node: Node): Element | null => {
      if (!(node instanceof Element)) return null;
      if (node.matches(selector)) return node;
      return node.querySelector(selector);
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          const target = findTarget(node);
          if (target) {
            scrollTo(target);
            return;
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch('/api/health');
        if (!response.ok) {
          setHealthStatus('error');
          setHealthTimestamp(new Date().toISOString());
          return;
        }
        const data = await response.json();
        setHealthStatus(data?.status === 'ok' ? 'ok' : 'error');
        setHealthTimestamp(data?.timestamp || new Date().toISOString());
      } catch {
        setHealthStatus('error');
        setHealthTimestamp(new Date().toISOString());
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleLogin = (
    token: string,
    role: string,
    remember: boolean,
    user?: { id?: string; username?: string; role?: string }
  ) => {
    const nextAuth: AuthState = {
      isAuthenticated: true,
      token,
      role: (user?.role || role) as AuthState['role'],
      userId: user?.id || null,
      username: user?.username || null,
      remember,
    };
    persistAuthState(nextAuth, remember);
    setAuth(nextAuth);
  };

  const handleLogout = async () => {
    if (auth.token) {
      try {
        await axios.post(
          '/api/auth/admin/logout',
          {},
          { headers: { Authorization: `Bearer ${auth.token}` } }
        );
      } catch {
        // Ignore backend logout errors and clear local state anyway
      }
    }
    clearAuthState();
    setAuth({
      isAuthenticated: false,
      token: null,
      role: null,
      userId: null,
      username: null,
      remember: false,
    });
  };

  const handleProfileUpdate = (user: { id?: string; username?: string; role?: string }) => {
    setAuth((prev) => {
      const next: AuthState = {
        ...prev,
        username: user.username || prev.username || null,
        userId: user.id || prev.userId || null,
        role: (user.role as AuthState['role']) || prev.role,
      };
      persistAuthState(next, next.remember ?? false);
      return next;
    });
  };

  if (!auth.isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  const routerBasename = /^\/admin(\/|$)/.test(window.location.pathname) ? '/admin' : undefined;

  return (
    <Router
      basename={routerBasename}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AdminLayout
        auth={auth}
        healthStatus={healthStatus}
        healthTimestamp={healthTimestamp}
        onLogout={handleLogout}
        onProfileUpdate={handleProfileUpdate}
      />
    </Router>
  );
};

export default App;
