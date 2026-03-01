import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTableSelection } from '../lib/tableSelection';
import { useAdminScopeContext } from '../lib/adminScopeContext';
import KeywordChipsInput from '../components/KeywordChipsInput';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  type SmartTableColumnDef,
} from '../modules/smart-table';

interface UsersProps {
  token: string;
}

interface TenantScope {
  tenantId: string;
  isTenantAdmin: boolean;
}

interface OrgScope {
  tenantId: string;
  orgUnitId: string;
  canWrite: boolean;
}

interface AdminUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  workPhone?: string | null;
  externalPersonId?: string | null;
  profileData?: Record<string, any>;
  role: 'ADMIN' | 'SACHBEARBEITER';
  active: boolean;
  isGlobalAdmin?: boolean;
  assignmentKeywords?: string[];
  tenantScopes?: TenantScope[];
  orgScopes?: OrgScope[];
  created_at?: string;
  updated_at?: string;
}

interface TenantOption {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

interface OrgUnitOption {
  id: string;
  tenantId: string;
  name: string;
  label: string;
  active: boolean;
}

interface CreateFormState {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  workPhone: string;
  externalPersonId: string;
  profileDataText: string;
  role: AdminUser['role'];
  password: string;
  isGlobalAdmin: boolean;
  assignmentKeywords: string[];
  tenantScopes: TenantScope[];
  orgScopes: OrgScope[];
}

interface EditFormState {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  workPhone: string;
  externalPersonId: string;
  profileDataText: string;
  role: AdminUser['role'];
  active: boolean;
  newPassword: string;
  isGlobalAdmin: boolean;
  assignmentKeywords: string[];
  tenantScopes: TenantScope[];
  orgScopes: OrgScope[];
}

const roleLabels: Record<AdminUser['role'], string> = {
  ADMIN: 'Admin',
  SACHBEARBEITER: 'Sachbearbeiter',
};

const buildOrgUnitPathMap = (rows: any[]): Record<string, string> => {
  const byId = new Map<string, any>();
  for (const row of rows || []) {
    const id = String(row?.id || '').trim();
    if (!id) continue;
    byId.set(id, row);
  }

  const cache = new Map<string, string>();

  const resolveLabel = (id: string): string => {
    if (!id) return '';
    const cached = cache.get(id);
    if (cached) return cached;

    const row = byId.get(id);
    if (!row) {
      cache.set(id, id);
      return id;
    }

    const ownName = String(row?.name || '').trim() || id;
    const parentId = String(row?.parentId || row?.parent_id || '').trim();
    if (!parentId || !byId.has(parentId)) {
      cache.set(id, ownName);
      return ownName;
    }

    const chainGuard = new Set<string>();
    chainGuard.add(id);
    let currentParent = parentId;
    const segments = [ownName];
    while (currentParent && byId.has(currentParent) && !chainGuard.has(currentParent)) {
      chainGuard.add(currentParent);
      const parentRow = byId.get(currentParent);
      const parentName = String(parentRow?.name || '').trim() || currentParent;
      segments.unshift(parentName);
      currentParent = String(parentRow?.parentId || parentRow?.parent_id || '').trim();
    }
    const value = segments.join(' / ');
    cache.set(id, value);
    return value;
  };

  const out: Record<string, string> = {};
  for (const id of byId.keys()) {
    out[id] = resolveLabel(id);
  }
  return out;
};

const normalizeTenantScopesPayload = (scopes: TenantScope[]): TenantScope[] => {
  const seen = new Set<string>();
  const normalized: TenantScope[] = [];
  for (const scope of scopes || []) {
    const tenantId = String(scope?.tenantId || '').trim();
    if (!tenantId) continue;
    const isTenantAdmin = !!scope?.isTenantAdmin;
    const key = `${tenantId}::${isTenantAdmin ? '1' : '0'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ tenantId, isTenantAdmin });
  }
  return normalized;
};

const normalizeOrgScopesPayload = (scopes: OrgScope[]): OrgScope[] => {
  const seen = new Set<string>();
  const normalized: OrgScope[] = [];
  for (const scope of scopes || []) {
    const tenantId = String(scope?.tenantId || '').trim();
    const orgUnitId = String(scope?.orgUnitId || '').trim();
    if (!tenantId || !orgUnitId) continue;
    const canWrite = !!scope?.canWrite;
    const key = `${tenantId}::${orgUnitId}::${canWrite ? '1' : '0'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ tenantId, orgUnitId, canWrite });
  }
  return normalized;
};

const createEmptyTenantScope = (): TenantScope => ({ tenantId: '', isTenantAdmin: false });
const createEmptyOrgScope = (): OrgScope => ({ tenantId: '', orgUnitId: '', canWrite: false });

const parseProfileDataText = (raw: string): { ok: boolean; value: Record<string, any>; error?: string } => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, value: {}, error: 'Erweiterte Profildaten müssen ein JSON-Objekt sein.' };
    }
    return { ok: true, value: parsed as Record<string, any> };
  } catch {
    return { ok: false, value: {}, error: 'Erweiterte Profildaten enthalten ungültiges JSON.' };
  }
};

const Users: React.FC<UsersProps> = ({ token }) => {
  const { isGlobalAdmin: isPlatformAdmin, selection: scopeSelection } = useAdminScopeContext();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [orgUnitsByTenant, setOrgUnitsByTenant] = useState<Record<string, OrgUnitOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');
  const [search, setSearch] = useState('');

  const [createForm, setCreateForm] = useState<CreateFormState>({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    workPhone: '',
    externalPersonId: '',
    profileDataText: '{}',
    role: 'SACHBEARBEITER' as AdminUser['role'],
    password: '',
    isGlobalAdmin: false,
    assignmentKeywords: [],
    tenantScopes: [],
    orgScopes: [],
  });

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    email: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    workPhone: '',
    externalPersonId: '',
    profileDataText: '{}',
    role: 'SACHBEARBEITER' as AdminUser['role'],
    active: true,
    newPassword: '',
    isGlobalAdmin: false,
    assignmentKeywords: [],
    tenantScopes: [],
    orgScopes: [],
  });

  const headers = { Authorization: `Bearer ${token}` };

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/admin/users', { headers });
      setUsers(response.data || []);
    } catch {
      setMessageType('error');
      setMessage('Fehler beim Laden der Benutzer');
    } finally {
      setLoading(false);
    }
  };

  const loadDirectoryData = async () => {
    try {
      setDirectoryLoading(true);
      const tenantResponse = await axios.get('/api/admin/tenants', { headers });
      const nextTenants: TenantOption[] = Array.isArray(tenantResponse.data)
        ? tenantResponse.data.map((row: any) => ({
            id: String(row?.id || '').trim(),
            name: String(row?.name || '').trim(),
            slug: String(row?.slug || '').trim(),
            active: !!row?.active,
          }))
        : [];
      setTenants(nextTenants.filter((tenant) => !!tenant.id));

      const unitResponses = await Promise.all(
        nextTenants.map(async (tenant) => {
          try {
            const response = await axios.get(`/api/admin/tenants/${tenant.id}/org-units`, {
              headers,
              params: { includeInactive: true },
            });
            return { tenantId: tenant.id, rows: Array.isArray(response.data) ? response.data : [] };
          } catch {
            return { tenantId: tenant.id, rows: [] as any[] };
          }
        })
      );

      const map: Record<string, OrgUnitOption[]> = {};
      for (const entry of unitResponses) {
        const labelsById = buildOrgUnitPathMap(entry.rows);
        map[entry.tenantId] = entry.rows
          .map((row: any) => ({
            id: String(row?.id || '').trim(),
            tenantId: String(row?.tenantId || row?.tenant_id || entry.tenantId).trim(),
            name: String(row?.name || '').trim(),
            label: labelsById[String(row?.id || '').trim()] || String(row?.name || '').trim(),
            active: !!row?.active,
          }))
          .filter((row: OrgUnitOption) => !!row.id)
          .sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
      }
      setOrgUnitsByTenant(map);
    } finally {
      setDirectoryLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    loadDirectoryData();
  }, [token]);

  useEffect(() => {
    if (isPlatformAdmin) return;
    setCreateForm((prev) => ({
      ...prev,
      isGlobalAdmin: false,
      tenantScopes: prev.tenantScopes.map((scope) => ({ ...scope, isTenantAdmin: false })),
    }));
    setEditForm((prev) => ({
      ...prev,
      isGlobalAdmin: false,
      tenantScopes: prev.tenantScopes.map((scope) => ({ ...scope, isTenantAdmin: false })),
    }));
  }, [isPlatformAdmin]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => {
      const tenantScopeSummary = (user.tenantScopes || [])
        .map((scope) => `${scope.tenantId}${scope.isTenantAdmin ? ':admin' : ''}`)
        .join(' ');
      const orgScopeSummary = (user.orgScopes || [])
        .map((scope) => `${scope.tenantId}/${scope.orgUnitId}${scope.canWrite ? ':w' : ':r'}`)
        .join(' ');
      const haystack = [user.username, user.email, user.role, user.active ? 'aktiv' : 'inaktiv']
        .concat(
          tenantScopeSummary,
          orgScopeSummary,
          user.isGlobalAdmin ? 'global admin' : '',
          (user.assignmentKeywords || []).join(' ')
        )
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [users, search]);

  const selection = useTableSelection(filteredUsers);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setMessageType('');

    if (!createForm.username || !createForm.password) {
      setMessageType('error');
      setMessage('Benutzername und Passwort sind erforderlich');
      return;
    }
    const parsedProfile = parseProfileDataText(createForm.profileDataText);
    if (!parsedProfile.ok) {
      setMessageType('error');
      setMessage(parsedProfile.error || 'Ungültige Profildaten');
      return;
    }

    setSaving(true);
    try {
      const sanitizedTenantScopes = normalizeTenantScopesPayload(
        createForm.tenantScopes.map((scope) => ({
          ...scope,
          isTenantAdmin: isPlatformAdmin ? scope.isTenantAdmin : false,
        }))
      );
      await axios.post(
        '/api/admin/users',
        {
          username: createForm.username,
          email: createForm.email || undefined,
          firstName: createForm.firstName || undefined,
          lastName: createForm.lastName || undefined,
          jobTitle: createForm.jobTitle || undefined,
          workPhone: createForm.workPhone || undefined,
          externalPersonId: createForm.externalPersonId || undefined,
          profileData: parsedProfile.value,
          password: createForm.password,
          role: createForm.role,
          isGlobalAdmin: isPlatformAdmin && createForm.role === 'ADMIN' && createForm.isGlobalAdmin === true,
          assignmentKeywords: createForm.assignmentKeywords,
          tenantScopes: sanitizedTenantScopes,
          orgScopes: normalizeOrgScopesPayload(createForm.orgScopes),
        },
        { headers }
      );
      setMessageType('success');
      setMessage('Benutzer erstellt');
      setCreateForm({
        username: '',
        email: '',
        firstName: '',
        lastName: '',
        jobTitle: '',
        workPhone: '',
        externalPersonId: '',
        profileDataText: '{}',
        role: 'SACHBEARBEITER',
        password: '',
        isGlobalAdmin: false,
        assignmentKeywords: [],
        tenantScopes: [],
        orgScopes: [],
      });
      await loadUsers();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error.response?.data?.message || 'Fehler beim Erstellen des Benutzers');
    } finally {
      setSaving(false);
    }
  };

  const handleEditUser = (user: AdminUser) => {
    setEditingUser(user);
    setEditForm({
      email: user.email || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      jobTitle: user.jobTitle || '',
      workPhone: user.workPhone || '',
      externalPersonId: user.externalPersonId || '',
      profileDataText: JSON.stringify(user.profileData || {}, null, 2),
      role: user.role,
      active: user.active,
      newPassword: '',
      isGlobalAdmin: !!user.isGlobalAdmin,
      assignmentKeywords: Array.isArray(user.assignmentKeywords) ? user.assignmentKeywords : [],
      tenantScopes: (user.tenantScopes || []).map((entry) => ({
        tenantId: String(entry?.tenantId || ''),
        isTenantAdmin: !!entry?.isTenantAdmin,
      })),
      orgScopes: (user.orgScopes || []).map((entry) => ({
        tenantId: String(entry?.tenantId || ''),
        orgUnitId: String(entry?.orgUnitId || ''),
        canWrite: !!entry?.canWrite,
      })),
    });
    setMessage('');
    setMessageType('');
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;
    const parsedProfile = parseProfileDataText(editForm.profileDataText);
    if (!parsedProfile.ok) {
      setMessageType('error');
      setMessage(parsedProfile.error || 'Ungültige Profildaten');
      return;
    }
    setSaving(true);
    try {
      const sanitizedTenantScopes = normalizeTenantScopesPayload(
        editForm.tenantScopes.map((scope) => ({
          ...scope,
          isTenantAdmin: isPlatformAdmin ? scope.isTenantAdmin : false,
        }))
      );
      await axios.patch(
        `/api/admin/users/${editingUser.id}`,
        {
          email: editForm.email,
          firstName: editForm.firstName || undefined,
          lastName: editForm.lastName || undefined,
          jobTitle: editForm.jobTitle || undefined,
          workPhone: editForm.workPhone || undefined,
          externalPersonId: editForm.externalPersonId || undefined,
          profileData: parsedProfile.value,
          role: editForm.role,
          active: editForm.active,
          isGlobalAdmin: isPlatformAdmin && editForm.role === 'ADMIN' && editForm.isGlobalAdmin === true,
          assignmentKeywords: editForm.assignmentKeywords,
          tenantScopes: sanitizedTenantScopes,
          orgScopes: normalizeOrgScopesPayload(editForm.orgScopes),
        },
        { headers }
      );

      if (editForm.newPassword.trim()) {
        await axios.patch(
          `/api/admin/users/${editingUser.id}/password`,
          { newPassword: editForm.newPassword },
          { headers }
        );
      }

      setMessageType('success');
      setMessage('Benutzer aktualisiert');
      setEditingUser(null);
      await loadUsers();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error.response?.data?.message || 'Fehler beim Aktualisieren');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Benutzer wirklich löschen?')) return;
    setSaving(true);
    try {
      await axios.delete(`/api/admin/users/${userId}`, { headers });
      setMessageType('success');
      setMessage('Benutzer gelöscht');
      await loadUsers();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error.response?.data?.message || 'Fehler beim Löschen');
    } finally {
      setSaving(false);
    }
  };

  const handleDisableUserTfa = async (user: AdminUser) => {
    const username = String(user?.username || '').trim() || 'diesem Benutzer';
    const confirmed = window.confirm(
      `TFA für "${username}" deaktivieren?\n\nEs werden TOTP und alle registrierten Passkeys zurückgesetzt.`
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      const response = await axios.post(`/api/admin/users/${user.id}/security/tfa/disable`, {}, { headers });
      const revokedPasskeys = Number(response?.data?.revokedPasskeys || 0);
      const totpDisabled = response?.data?.totpDisabled === true;
      setMessageType('success');
      setMessage(
        `TFA deaktiviert für ${username}${totpDisabled ? ' (TOTP aus)' : ''}${
          revokedPasskeys > 0 ? `, Passkeys widerrufen: ${revokedPasskeys}` : ''
        }`
      );
    } catch (error: any) {
      setMessageType('error');
      setMessage(error.response?.data?.message || 'TFA konnte nicht deaktiviert werden.');
    } finally {
      setSaving(false);
    }
  };

  const handleInviteUser = async (user: AdminUser, sendEmail = true) => {
    const username = String(user?.username || '').trim() || 'Benutzer';
    if (sendEmail && !String(user?.email || '').trim()) {
      setMessageType('error');
      setMessage(`Für ${username} ist keine E-Mail hinterlegt. Einladung kann nicht versendet werden.`);
      return;
    }
    setInvitingUserId(user.id);
    setMessage('');
    setMessageType('');
    try {
      const response = await axios.post(
        `/api/admin/users/${encodeURIComponent(user.id)}/invite`,
        { sendEmail },
        { headers }
      );
      const inviteLink = String(response?.data?.invite?.inviteLink || '').trim();
      if (!sendEmail && inviteLink) {
        await navigator.clipboard.writeText(inviteLink).catch(() => undefined);
      }
      setMessageType('success');
      setMessage(
        sendEmail
          ? `Einladung an ${username} versendet.`
          : `Einladungslink für ${username} erstellt${inviteLink ? ' und in die Zwischenablage kopiert' : ''}.`
      );
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Einladung konnte nicht erstellt werden.');
    } finally {
      setInvitingUserId(null);
    }
  };

  const handleBulkInvite = async (sendEmail = true) => {
    if (selection.selectedRows.length === 0) {
      setMessageType('error');
      setMessage('Keine Benutzer ausgewählt');
      return;
    }
    if (sendEmail) {
      const usersWithoutEmail = selection.selectedRows.filter((entry) => !String(entry?.email || '').trim());
      if (usersWithoutEmail.length > 0) {
        setMessageType('error');
        setMessage(
          `Für ${usersWithoutEmail.length} ausgewählte Benutzer fehlt eine E-Mail-Adresse. Versand wurde nicht gestartet.`
        );
        return;
      }
    }
    setSaving(true);
    setMessage('');
    setMessageType('');
    try {
      const response = await axios.post(
        '/api/admin/users/invite/batch',
        {
          userIds: selection.selectedRows.map((row) => row.id),
          sendEmail,
        },
        { headers }
      );
      const successCount = Number(response?.data?.successCount || 0);
      const total = Number(response?.data?.total || selection.selectedRows.length);
      setMessageType(successCount === total ? 'success' : 'error');
      setMessage(
        sendEmail
          ? `Einladungen versendet: ${successCount}/${total}.`
          : `Einladungslinks erstellt: ${successCount}/${total}.`
      );
      selection.clearSelection();
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Batch-Einladung fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const runBulkUpdate = async (
    actionName: string,
    updater: (userId: string) => Promise<void>,
    options?: { confirmText?: string }
  ) => {
    if (selection.selectedRows.length === 0) {
      setMessageType('error');
      setMessage('Keine Benutzer ausgewählt');
      return;
    }
    if (options?.confirmText && !window.confirm(options.confirmText)) {
      return;
    }

    setSaving(true);
    setMessage('');
    setMessageType('');
    try {
      const results = await Promise.allSettled(selection.selectedRows.map((user) => updater(user.id)));
      const failed = results.filter((result) => result.status === 'rejected').length;
      const ok = results.length - failed;
      if (failed > 0) {
        setMessageType('error');
        setMessage(`${actionName}: ${ok} erfolgreich, ${failed} fehlgeschlagen`);
      } else {
        setMessageType('success');
        setMessage(`${actionName}: ${ok} Benutzer aktualisiert`);
      }
      selection.clearSelection();
      await loadUsers();
    } finally {
      setSaving(false);
    }
  };

  const handleBulkSetActive = async (active: boolean) =>
    runBulkUpdate(active ? 'Aktivieren' : 'Deaktivieren', async (userId) => {
      await axios.patch(`/api/admin/users/${userId}`, { active }, { headers });
    });

  const handleBulkSetRole = async (role: AdminUser['role']) =>
    runBulkUpdate(role === 'ADMIN' ? 'Rolle Admin setzen' : 'Rolle Sachbearbeiter setzen', async (userId) => {
      await axios.patch(
        `/api/admin/users/${userId}`,
        role === 'ADMIN' ? { role } : { role, isGlobalAdmin: false },
        { headers }
      );
    });

  const handleBulkDelete = async () =>
    runBulkUpdate(
      'Löschen',
      async (userId) => {
        await axios.delete(`/api/admin/users/${userId}`, { headers });
      },
      { confirmText: `${selection.selectedRows.length} Benutzer wirklich löschen?` }
    );

  const addCreateTenantScope = () =>
    setCreateForm((prev) => ({ ...prev, tenantScopes: [...prev.tenantScopes, createEmptyTenantScope()] }));
  const updateCreateTenantScope = (index: number, patch: Partial<TenantScope>) =>
    setCreateForm((prev) => ({
      ...prev,
      tenantScopes: prev.tenantScopes.map((scope, idx) =>
        idx === index
          ? {
              ...scope,
              ...patch,
              isTenantAdmin: isPlatformAdmin ? !!(patch.isTenantAdmin ?? scope.isTenantAdmin) : false,
            }
          : scope
      ),
    }));
  const removeCreateTenantScope = (index: number) =>
    setCreateForm((prev) => ({ ...prev, tenantScopes: prev.tenantScopes.filter((_, idx) => idx !== index) }));

  const addCreateOrgScope = () =>
    setCreateForm((prev) => ({ ...prev, orgScopes: [...prev.orgScopes, createEmptyOrgScope()] }));
  const updateCreateOrgScope = (index: number, patch: Partial<OrgScope>) =>
    setCreateForm((prev) => ({
      ...prev,
      orgScopes: prev.orgScopes.map((scope, idx) => (idx === index ? { ...scope, ...patch } : scope)),
    }));
  const removeCreateOrgScope = (index: number) =>
    setCreateForm((prev) => ({ ...prev, orgScopes: prev.orgScopes.filter((_, idx) => idx !== index) }));

  const addEditTenantScope = () =>
    setEditForm((prev) => ({ ...prev, tenantScopes: [...prev.tenantScopes, createEmptyTenantScope()] }));
  const updateEditTenantScope = (index: number, patch: Partial<TenantScope>) =>
    setEditForm((prev) => ({
      ...prev,
      tenantScopes: prev.tenantScopes.map((scope, idx) =>
        idx === index
          ? {
              ...scope,
              ...patch,
              isTenantAdmin: isPlatformAdmin ? !!(patch.isTenantAdmin ?? scope.isTenantAdmin) : false,
            }
          : scope
      ),
    }));
  const removeEditTenantScope = (index: number) =>
    setEditForm((prev) => ({ ...prev, tenantScopes: prev.tenantScopes.filter((_, idx) => idx !== index) }));

  const addEditOrgScope = () => setEditForm((prev) => ({ ...prev, orgScopes: [...prev.orgScopes, createEmptyOrgScope()] }));
  const updateEditOrgScope = (index: number, patch: Partial<OrgScope>) =>
    setEditForm((prev) => ({
      ...prev,
      orgScopes: prev.orgScopes.map((scope, idx) => (idx === index ? { ...scope, ...patch } : scope)),
    }));
  const removeEditOrgScope = (index: number) =>
    setEditForm((prev) => ({ ...prev, orgScopes: prev.orgScopes.filter((_, idx) => idx !== index) }));

  const getTenantLabel = (tenantId: string) => {
    const match = tenants.find((tenant) => tenant.id === tenantId);
    return match ? `${match.name} (${match.slug})` : tenantId;
  };

  const getOrgUnitLabel = (tenantId: string, orgUnitId: string) => {
    const unit = (orgUnitsByTenant[tenantId] || []).find((entry) => entry.id === orgUnitId);
    return unit ? unit.label : orgUnitId;
  };

  const renderTenantScopeChips = (user: AdminUser) => {
    const scopes = user.tenantScopes || [];
    if (user.isGlobalAdmin) {
      return <span className="badge bg-blue-100 text-blue-700">Global Admin</span>;
    }
    if (scopes.length === 0) return '–';
    return (
      <div className="flex flex-wrap gap-1">
        {scopes.slice(0, 3).map((scope, idx) => (
          <span key={`${scope.tenantId}-${idx}`} className="badge bg-slate-200 text-slate-700">
            {getTenantLabel(scope.tenantId)}
            {scope.isTenantAdmin ? ' · Mandanten-Admin' : ''}
          </span>
        ))}
        {scopes.length > 3 && <span className="text-xs text-slate-500">+{scopes.length - 3}</span>}
      </div>
    );
  };

  const renderOrgScopeChips = (user: AdminUser) => {
    const scopes = user.orgScopes || [];
    if (scopes.length === 0) return '–';
    return (
      <div className="flex flex-wrap gap-1">
        {scopes.slice(0, 3).map((scope, idx) => (
          <span key={`${scope.tenantId}-${scope.orgUnitId}-${idx}`} className="badge bg-indigo-100 text-indigo-700">
            {getOrgUnitLabel(scope.tenantId, scope.orgUnitId)}
            {scope.canWrite ? ' · W' : ' · R'}
          </span>
        ))}
        {scopes.length > 3 && <span className="text-xs text-slate-500">+{scopes.length - 3}</span>}
      </div>
    );
  };

  const renderAssignmentKeywordChips = (user: AdminUser) => {
    const keywords = Array.isArray(user.assignmentKeywords) ? user.assignmentKeywords : [];
    if (keywords.length === 0) return '–';
    return (
      <div className="flex flex-wrap gap-1">
        {keywords.slice(0, 4).map((keyword) => (
          <span key={`${user.id}-${keyword}`} className="badge bg-emerald-50 text-emerald-700">
            {keyword}
          </span>
        ))}
        {keywords.length > 4 && <span className="text-xs text-slate-500">+{keywords.length - 4}</span>}
      </div>
    );
  };

  const userColumns = useMemo<SmartTableColumnDef<AdminUser>[]>(() => {
    return [
      {
        field: 'username',
        headerName: 'Benutzername',
        minWidth: 180,
        flex: 0.8,
      },
      {
        field: 'nameFunction',
        headerName: 'Name / Funktion',
        minWidth: 260,
        flex: 1.2,
        sortable: false,
        valueGetter: (_value, row) => {
          const fullName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || '–';
          const secondary = row.jobTitle || row.workPhone || row.externalPersonId || 'Keine Zusatzdaten';
          return `${fullName} · ${secondary}`;
        },
        renderCell: (params) => {
          const user = params.row;
          const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || '–';
          const secondary = user.jobTitle || user.workPhone || user.externalPersonId || 'Keine Zusatzdaten';
          return (
            <div className="flex flex-col">
              <span>{fullName}</span>
              <span className="text-xs text-slate-500">{secondary}</span>
            </div>
          );
        },
      },
      {
        field: 'email',
        headerName: 'E-Mail',
        minWidth: 220,
        flex: 1,
        valueGetter: (_value, row) => row.email || '–',
      },
      {
        field: 'roleLabel',
        headerName: 'Rolle',
        minWidth: 170,
        flex: 0.7,
        valueGetter: (_value, row) => {
          if (row.isGlobalAdmin) return 'Plattform-Admin';
          return roleLabels[row.role] || row.role;
        },
      },
      {
        field: 'active',
        headerName: 'Status',
        minWidth: 120,
        flex: 0.55,
        valueGetter: (_value, row) => (row.active ? 'Aktiv' : 'Inaktiv'),
        renderCell: (params) => {
          const user = params.row;
          return (
            <span className={`badge ${user.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
              {user.active ? 'Aktiv' : 'Inaktiv'}
            </span>
          );
        },
      },
      {
        field: 'assignmentKeywords',
        headerName: 'Schlagworte',
        minWidth: 220,
        flex: 1.1,
        sortable: false,
        valueGetter: (_value, row) => (Array.isArray(row.assignmentKeywords) ? row.assignmentKeywords.join(', ') : ''),
        renderCell: (params) => renderAssignmentKeywordChips(params.row),
      },
      {
        field: 'tenantScopes',
        headerName: 'Mandanten',
        minWidth: 260,
        flex: 1.15,
        sortable: false,
        valueGetter: (_value, row) =>
          row.isGlobalAdmin
            ? 'Global Admin'
            : (row.tenantScopes || [])
                .map((scope) => `${getTenantLabel(scope.tenantId)}${scope.isTenantAdmin ? ' · Mandanten-Admin' : ''}`)
                .join(', '),
        renderCell: (params) => renderTenantScopeChips(params.row),
      },
      {
        field: 'orgScopes',
        headerName: 'Organisation',
        minWidth: 280,
        flex: 1.2,
        sortable: false,
        valueGetter: (_value, row) =>
          (row.orgScopes || [])
            .map((scope) => `${getOrgUnitLabel(scope.tenantId, scope.orgUnitId)} ${scope.canWrite ? '(W)' : '(R)'}`)
            .join(', '),
        renderCell: (params) => renderOrgScopeChips(params.row),
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 175,
        flex: 0.8,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (params) => {
          const user = params.row;
          const rowBusy = saving || invitingUserId === user.id;
          const hasEmail = !!String(user.email || '').trim();
          return (
            <SmartTableRowActions>
              <SmartTableRowActionButton
                label="Benutzer bearbeiten"
                icon={<i className="fa-solid fa-user-pen" aria-hidden="true" />}
                onClick={() => handleEditUser(user)}
                disabled={saving}
              />
              <SmartTableRowActionButton
                label="Einladung senden"
                icon={<i className="fa-solid fa-envelope" aria-hidden="true" />}
                onClick={() => {
                  void handleInviteUser(user, true);
                }}
                disabled={rowBusy || !hasEmail}
                loading={invitingUserId === user.id}
              />
              <SmartTableRowActionButton
                label="TFA deaktivieren"
                icon={<i className="fa-solid fa-shield-halved" aria-hidden="true" />}
                tone="warning"
                onClick={() => {
                  void handleDisableUserTfa(user);
                }}
                disabled={saving}
              />
            </SmartTableRowActions>
          );
        },
      },
    ];
  }, [getOrgUnitLabel, getTenantLabel, invitingUserId, saving]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-2xl font-semibold">Benutzerverwaltung</h2>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            const tenantQuery = scopeSelection?.tenantId ? `&tenantId=${encodeURIComponent(scopeSelection.tenantId)}` : '';
            window.location.assign(`/admin-settings/keywording?targetType=user${tenantQuery}`);
          }}
        >
          <i className="fa-solid fa-wand-magic-sparkles" /> KI-Schlagworte aus Leistungen
        </button>
      </div>

      {message && (
        <div
          className={`message-banner p-4 rounded-lg flex items-center gap-2 ${
            messageType === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          <i className={`fa-solid ${messageType === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`} />
          {message}
        </div>
      )}

      {directoryLoading && (
        <div className="card p-4 text-sm text-slate-500">Lade Mandanten- und Organisationsdaten...</div>
      )}

      <div className="card p-6 space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <i className="fa-solid fa-user-plus" /> Neuen Benutzer anlegen
        </h3>
        <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Benutzername</label>
            <input
              className="input"
              value={createForm.username}
              onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Email (optional)</label>
            <input
              type="email"
              className="input"
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
            />
            <small className="text-slate-500">
              Ohne E-Mail wird der Account als inaktiv angelegt, bis eine E-Mail ergänzt wurde.
            </small>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Vorname (optional)</label>
            <input
              className="input"
              value={createForm.firstName}
              onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Nachname (optional)</label>
            <input
              className="input"
              value={createForm.lastName}
              onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Funktion / Stelle (optional)</label>
            <input
              className="input"
              value={createForm.jobTitle}
              onChange={(e) => setCreateForm({ ...createForm, jobTitle: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Telefon (optional)</label>
            <input
              className="input"
              value={createForm.workPhone}
              onChange={(e) => setCreateForm({ ...createForm, workPhone: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold mb-1">Externe Personal-ID (optional)</label>
            <input
              className="input"
              value={createForm.externalPersonId}
              onChange={(e) => setCreateForm({ ...createForm, externalPersonId: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold mb-1">Erweiterte Profildaten (JSON, optional)</label>
            <textarea
              className="input font-mono text-xs"
              rows={5}
              value={createForm.profileDataText}
              onChange={(e) => setCreateForm({ ...createForm, profileDataText: e.target.value })}
              placeholder='{"zimmer":"1.14","sprechzeit":"Mo-Fr 08:00-12:00"}'
            />
          </div>
          <KeywordChipsInput
            className="md:col-span-2"
            label="Schlagworte für automatische Zuweisung"
            value={createForm.assignmentKeywords}
            onChange={(next) => setCreateForm((prev) => ({ ...prev, assignmentKeywords: next }))}
            helperText="Diese Schlagworte können in der automatischen Zuweisung ausgewertet werden."
          />
          <div>
            <label className="block text-sm font-semibold mb-1">Rolle</label>
            <select
              className="input"
              value={createForm.role}
              onChange={(e) =>
                setCreateForm((prev) => ({
                  ...prev,
                  role: e.target.value as AdminUser['role'],
                  isGlobalAdmin: e.target.value === 'ADMIN' ? prev.isGlobalAdmin : false,
                }))
              }
            >
              <option value="SACHBEARBEITER">Sachbearbeiter</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Startpasswort</label>
            <input
              type="password"
              className="input"
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Globaler Admin</label>
            <select
              className="input"
              value={createForm.isGlobalAdmin ? '1' : '0'}
              disabled={!isPlatformAdmin || createForm.role !== 'ADMIN'}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, isGlobalAdmin: e.target.value === '1' }))}
            >
              <option value="0">Nein</option>
              {isPlatformAdmin && <option value="1">Ja</option>}
            </select>
            {!isPlatformAdmin && (
              <small className="text-slate-500">Nur Plattform-Admins können globale Adminrechte vergeben.</small>
            )}
          </div>
          {!isPlatformAdmin && createForm.role === 'ADMIN' && (
            <div className="md:col-span-2 text-sm text-slate-500">
              Für neue Orga-Admins bitte mindestens einen Organisations-Scope mit Schreibrecht setzen.
            </div>
          )}
          <div className="md:col-span-2 space-y-3 border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-800">Mandanten-Scope</h4>
              <button type="button" className="btn btn-secondary" onClick={addCreateTenantScope}>
                <i className="fa-solid fa-plus" /> Scope hinzufügen
              </button>
            </div>
            {createForm.tenantScopes.length === 0 ? (
              <p className="text-sm text-slate-500">Keine Mandanten-Scope gesetzt.</p>
            ) : (
              <div className="space-y-2">
                {createForm.tenantScopes.map((scope, index) => (
                  <div key={`create-tenant-scope-${index}`} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <select
                      className="input md:col-span-2"
                      value={scope.tenantId}
                      onChange={(e) => updateCreateTenantScope(index, { tenantId: e.target.value })}
                    >
                      <option value="">Mandant wählen</option>
                      {tenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.name} ({tenant.slug})
                        </option>
                      ))}
                    </select>
                    <select
                      className="input"
                      value={scope.isTenantAdmin ? '1' : '0'}
                      disabled={!isPlatformAdmin}
                      onChange={(e) => updateCreateTenantScope(index, { isTenantAdmin: e.target.value === '1' })}
                    >
                      <option value="0">Nur Scope</option>
                      {isPlatformAdmin && <option value="1">Mandanten-Admin</option>}
                    </select>
                    <button type="button" className="btn btn-danger" onClick={() => removeCreateTenantScope(index)}>
                      Entfernen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="md:col-span-2 space-y-3 border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-800">Organisations-Scope</h4>
              <button type="button" className="btn btn-secondary" onClick={addCreateOrgScope}>
                <i className="fa-solid fa-plus" /> Scope hinzufügen
              </button>
            </div>
            {createForm.orgScopes.length === 0 ? (
              <p className="text-sm text-slate-500">Keine Organisations-Scope gesetzt.</p>
            ) : (
              <div className="space-y-2">
                {createForm.orgScopes.map((scope, index) => (
                  <div key={`create-org-scope-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <select
                      className="input md:col-span-2"
                      value={scope.tenantId}
                      onChange={(e) =>
                        updateCreateOrgScope(index, {
                          tenantId: e.target.value,
                          orgUnitId: '',
                        })
                      }
                    >
                      <option value="">Mandant wählen</option>
                      {tenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.name} ({tenant.slug})
                        </option>
                      ))}
                    </select>
                    <select
                      className="input md:col-span-2"
                      value={scope.orgUnitId}
                      onChange={(e) => updateCreateOrgScope(index, { orgUnitId: e.target.value })}
                    >
                      <option value="">Organisationseinheit wählen</option>
                      {(orgUnitsByTenant[scope.tenantId] || []).map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="input"
                      value={scope.canWrite ? '1' : '0'}
                      onChange={(e) => updateCreateOrgScope(index, { canWrite: e.target.value === '1' })}
                    >
                      <option value="0">Lesen</option>
                      <option value="1">Lesen + Schreiben</option>
                    </select>
                    <button type="button" className="btn btn-danger" onClick={() => removeCreateOrgScope(index)}>
                      Entfernen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              Benutzer erstellen
            </button>
          </div>
        </form>
      </div>

      {editingUser && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <i className="fa-solid fa-user-pen" /> Benutzer bearbeiten
            </h3>
            <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>
              Abbrechen
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Benutzername</label>
              <input className="input" value={editingUser.username} disabled />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Email</label>
              <input
                type="email"
                className="input"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Vorname</label>
              <input
                className="input"
                value={editForm.firstName}
                onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Nachname</label>
              <input
                className="input"
                value={editForm.lastName}
                onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Funktion / Stelle</label>
              <input
                className="input"
                value={editForm.jobTitle}
                onChange={(e) => setEditForm({ ...editForm, jobTitle: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Telefon</label>
              <input
                className="input"
                value={editForm.workPhone}
                onChange={(e) => setEditForm({ ...editForm, workPhone: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-1">Externe Personal-ID</label>
              <input
                className="input"
                value={editForm.externalPersonId}
                onChange={(e) => setEditForm({ ...editForm, externalPersonId: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-1">Erweiterte Profildaten (JSON)</label>
              <textarea
                className="input font-mono text-xs"
                rows={5}
                value={editForm.profileDataText}
                onChange={(e) => setEditForm({ ...editForm, profileDataText: e.target.value })}
              />
            </div>
            <KeywordChipsInput
              className="md:col-span-2"
              label="Schlagworte für automatische Zuweisung"
              value={editForm.assignmentKeywords}
              onChange={(next) => setEditForm((prev) => ({ ...prev, assignmentKeywords: next }))}
              helperText="Diese Schlagworte werden beim Benutzerprofil für Zuweisungslogik gespeichert."
            />
            <div>
              <label className="block text-sm font-semibold mb-1">Rolle</label>
              <select
                className="input"
                value={editForm.role}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    role: e.target.value as AdminUser['role'],
                    isGlobalAdmin: e.target.value === 'ADMIN' ? prev.isGlobalAdmin : false,
                  }))
                }
              >
                <option value="SACHBEARBEITER">Sachbearbeiter</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Aktiv</label>
              <select
                className="input"
                value={editForm.active ? '1' : '0'}
                onChange={(e) => setEditForm({ ...editForm, active: e.target.value === '1' })}
              >
                <option value="1">Aktiv</option>
                <option value="0">Deaktiviert</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Globaler Admin</label>
              <select
                className="input"
                value={editForm.isGlobalAdmin ? '1' : '0'}
                disabled={!isPlatformAdmin || editForm.role !== 'ADMIN'}
                onChange={(e) => setEditForm((prev) => ({ ...prev, isGlobalAdmin: e.target.value === '1' }))}
              >
                <option value="0">Nein</option>
                {isPlatformAdmin && <option value="1">Ja</option>}
              </select>
              {!isPlatformAdmin && (
                <small className="text-slate-500">Nur Plattform-Admins können globale Adminrechte vergeben.</small>
              )}
            </div>
            {!isPlatformAdmin && editForm.role === 'ADMIN' && (
              <div className="md:col-span-2 text-sm text-slate-500">
                Für Orga-Admins muss mindestens ein Organisations-Scope mit Schreibrecht gesetzt sein.
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-1">Neues Passwort (optional)</label>
              <input
                type="password"
                className="input"
                value={editForm.newPassword}
                onChange={(e) => setEditForm({ ...editForm, newPassword: e.target.value })}
              />
            </div>
            <div className="md:col-span-2 space-y-3 border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-800">Mandanten-Scope</h4>
                <button type="button" className="btn btn-secondary" onClick={addEditTenantScope}>
                  <i className="fa-solid fa-plus" /> Scope hinzufügen
                </button>
              </div>
              {editForm.tenantScopes.length === 0 ? (
                <p className="text-sm text-slate-500">Keine Mandanten-Scope gesetzt.</p>
              ) : (
                <div className="space-y-2">
                  {editForm.tenantScopes.map((scope, index) => (
                    <div key={`edit-tenant-scope-${index}`} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <select
                        className="input md:col-span-2"
                        value={scope.tenantId}
                        onChange={(e) => updateEditTenantScope(index, { tenantId: e.target.value })}
                      >
                        <option value="">Mandant wählen</option>
                        {tenants.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.name} ({tenant.slug})
                          </option>
                        ))}
                      </select>
                      <select
                        className="input"
                        value={scope.isTenantAdmin ? '1' : '0'}
                        disabled={!isPlatformAdmin}
                        onChange={(e) => updateEditTenantScope(index, { isTenantAdmin: e.target.value === '1' })}
                      >
                        <option value="0">Nur Scope</option>
                        {isPlatformAdmin && <option value="1">Mandanten-Admin</option>}
                      </select>
                      <button type="button" className="btn btn-danger" onClick={() => removeEditTenantScope(index)}>
                        Entfernen
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="md:col-span-2 space-y-3 border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-800">Organisations-Scope</h4>
                <button type="button" className="btn btn-secondary" onClick={addEditOrgScope}>
                  <i className="fa-solid fa-plus" /> Scope hinzufügen
                </button>
              </div>
              {editForm.orgScopes.length === 0 ? (
                <p className="text-sm text-slate-500">Keine Organisations-Scope gesetzt.</p>
              ) : (
                <div className="space-y-2">
                  {editForm.orgScopes.map((scope, index) => (
                    <div key={`edit-org-scope-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <select
                        className="input md:col-span-2"
                        value={scope.tenantId}
                        onChange={(e) =>
                          updateEditOrgScope(index, {
                            tenantId: e.target.value,
                            orgUnitId: '',
                          })
                        }
                      >
                        <option value="">Mandant wählen</option>
                        {tenants.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.name} ({tenant.slug})
                          </option>
                        ))}
                      </select>
                      <select
                        className="input md:col-span-2"
                        value={scope.orgUnitId}
                        onChange={(e) => updateEditOrgScope(index, { orgUnitId: e.target.value })}
                      >
                        <option value="">Organisationseinheit wählen</option>
                        {(orgUnitsByTenant[scope.tenantId] || []).map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="input"
                        value={scope.canWrite ? '1' : '0'}
                        onChange={(e) => updateEditOrgScope(index, { canWrite: e.target.value === '1' })}
                      >
                        <option value="0">Lesen</option>
                        <option value="1">Lesen + Schreiben</option>
                      </select>
                      <button type="button" className="btn btn-danger" onClick={() => removeEditOrgScope(index)}>
                        Entfernen
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="btn btn-primary" onClick={handleUpdateUser} disabled={saving}>
              Änderungen speichern
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => void handleInviteUser(editingUser, true)}
              disabled={saving || invitingUserId === editingUser.id || !String(editingUser.email || '').trim()}
              title={!String(editingUser.email || '').trim() ? 'Keine E-Mail-Adresse hinterlegt.' : undefined}
            >
              <i className="fa-solid fa-envelope" /> Einladung senden
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => void handleInviteUser(editingUser, false)}
              disabled={saving || invitingUserId === editingUser.id}
            >
              <i className="fa-solid fa-link" /> Link erzeugen
            </button>
            <button className="btn btn-secondary" onClick={() => void handleDisableUserTfa(editingUser)} disabled={saving}>
              <i className="fa-solid fa-shield-halved" /> TFA deaktivieren
            </button>
            <button className="btn btn-danger" onClick={() => handleDeleteUser(editingUser.id)} disabled={saving}>
              Benutzer löschen
            </button>
          </div>
        </div>
      )}

      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <i className="fa-solid fa-users" /> Alle Benutzer
          </h3>
          <input
            className="input"
            style={{ maxWidth: 320 }}
            placeholder="Suche Benutzer, Rolle, E-Mail, Schlagwort..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {selection.selectedCount > 0 && (
          <div className="bulk-actions-bar">
            <div className="bulk-actions-meta">
              <span className="count">{selection.selectedCount}</span>
              <span>ausgewählt</span>
            </div>
            <div className="bulk-actions-buttons">
              <button className="bulk-btn success" type="button" onClick={() => handleBulkSetActive(true)} disabled={saving}>
                <i className="fa-solid fa-user-check" /> Aktivieren
              </button>
              <button className="bulk-btn warning" type="button" onClick={() => handleBulkSetActive(false)} disabled={saving}>
                <i className="fa-solid fa-user-slash" /> Deaktivieren
              </button>
              {isPlatformAdmin && (
                <button className="bulk-btn info" type="button" onClick={() => handleBulkSetRole('ADMIN')} disabled={saving}>
                  <i className="fa-solid fa-user-shield" /> Als Admin
                </button>
              )}
              <button
                className="bulk-btn info"
                type="button"
                onClick={() => handleBulkSetRole('SACHBEARBEITER')}
                disabled={saving}
              >
                <i className="fa-solid fa-user-gear" /> Als Sachbearbeiter
              </button>
              <button className="bulk-btn info" type="button" onClick={() => void handleBulkInvite(true)} disabled={saving}>
                <i className="fa-solid fa-envelope" /> Einladung senden
              </button>
              <button className="bulk-btn info" type="button" onClick={() => void handleBulkInvite(false)} disabled={saving}>
                <i className="fa-solid fa-link" /> Invite-Link
              </button>
              <button className="bulk-btn danger" type="button" onClick={handleBulkDelete} disabled={saving}>
                <i className="fa-solid fa-trash" /> Löschen
              </button>
              <button className="bulk-btn" type="button" onClick={selection.clearSelection} disabled={saving}>
                Auswahl aufheben
              </button>
            </div>
          </div>
        )}

        <SmartTable<AdminUser>
          tableId="users-overview"
          userId={token}
          title="Benutzerliste"
          rows={filteredUsers}
          columns={userColumns}
          loading={loading}
          checkboxSelection
          selectionModel={selection.selectedIds}
          onSelectionModelChange={(ids) => selection.setSelectedIds(ids)}
          onRefresh={loadUsers}
          defaultPageSize={25}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </div>
    </div>
  );
};

export default Users;
