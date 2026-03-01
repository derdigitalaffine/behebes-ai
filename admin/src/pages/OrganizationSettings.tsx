import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';
import KeywordChipsInput from '../components/KeywordChipsInput';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  tenantType: string;
  registrationEmailDomains: string[];
  assignmentKeywords: string[];
  active: boolean;
}

interface OrgUnitType {
  id: string;
  tenantId: string;
  key: string;
  label: string;
  isAssignable: boolean;
  sortOrder: number;
  active: boolean;
  assignmentKeywords: string[];
}

interface OrgUnit {
  id: string;
  tenantId: string;
  typeId: string | null;
  parentId: string | null;
  name: string;
  code: string | null;
  contactEmail: string | null;
  active: boolean;
  assignmentKeywords: string[];
}

interface TenantDraft {
  slug: string;
  name: string;
  tenantType: string;
  registrationEmailDomainsText: string;
  assignmentKeywords: string[];
  active: boolean;
}

interface TenantProfile {
  tenantId: string;
  legalName: string;
  displayName: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  country: string;
  generalEmail: string;
  supportEmail: string;
  phone: string;
  homepage: string;
  responsiblePersonName: string;
  responsiblePersonRole: string;
  responsiblePersonEmail: string;
  responsiblePersonPhone: string;
  vatId: string;
  imprintText: string;
  privacyContact: string;
}

interface TypeDraft {
  id: string | null;
  key: string;
  label: string;
  isAssignable: boolean;
  sortOrder: number;
  active: boolean;
  assignmentKeywords: string[];
}

interface UnitDraft {
  id: string | null;
  name: string;
  code: string;
  contactEmail: string;
  typeId: string;
  parentId: string;
  active: boolean;
  assignmentKeywords: string[];
}

interface AdminUserOption {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string | null;
  active: boolean;
}

interface GroupMemberDraft {
  userId: string;
  canWrite: boolean;
}

const DEFAULT_TENANT_DRAFT: TenantDraft = {
  slug: '',
  name: '',
  tenantType: 'verbandsgemeinde',
  registrationEmailDomainsText: '',
  assignmentKeywords: [],
  active: true,
};

const DEFAULT_TENANT_PROFILE: TenantProfile = {
  tenantId: '',
  legalName: '',
  displayName: '',
  street: '',
  houseNumber: '',
  postalCode: '',
  city: '',
  country: '',
  generalEmail: '',
  supportEmail: '',
  phone: '',
  homepage: '',
  responsiblePersonName: '',
  responsiblePersonRole: '',
  responsiblePersonEmail: '',
  responsiblePersonPhone: '',
  vatId: '',
  imprintText: '',
  privacyContact: '',
};

const DEFAULT_TYPE_DRAFT: TypeDraft = {
  id: null,
  key: '',
  label: '',
  isAssignable: true,
  sortOrder: 0,
  active: true,
  assignmentKeywords: [],
};

const DEFAULT_UNIT_DRAFT: UnitDraft = {
  id: null,
  name: '',
  code: '',
  contactEmail: '',
  typeId: '',
  parentId: '',
  active: true,
  assignmentKeywords: [],
};

const TENANT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'verbandsgemeinde', label: 'Verbandsgemeinde' },
  { value: 'verbandsfreie_gemeinde', label: 'Verbandsfreie Gemeinde' },
  { value: 'ortsgemeinde', label: 'Ortsgemeinde' },
  { value: 'landkreis', label: 'Landkreis' },
  { value: 'kreisfreie_stadt', label: 'Kreisfreie Stadt' },
  { value: 'eigenbetrieb', label: 'Eigenbetrieb' },
  { value: 'zweckverband', label: 'Zweckverband' },
  { value: 'sonstige', label: 'Sonstige Organisation' },
];

const normalize = (value: unknown): string => String(value || '').trim();
const parseKeywordList = (value: unknown): string[] => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
    ? value.split(/[\n,;|]+/g)
    : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of source) {
    const keyword = normalize(entry).replace(/\s+/g, ' ').slice(0, 80);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
};
const normalizeRegistrationDomain = (value: unknown): string => normalize(value).toLowerCase().replace(/^@+/, '');
const parseTenantRegistrationDomains = (value: unknown): string[] => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
    ? value.split(/[\s,;\n\r]+/g)
    : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of source) {
    const domain = normalizeRegistrationDomain(entry);
    if (!domain) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    result.push(domain);
  }
  return result;
};
const serializeTenantRegistrationDomains = (domains: string[]): string =>
  (domains || []).filter(Boolean).join('\n');
const buildUserLabel = (user: AdminUserOption): string => {
  const fullName = [normalize(user.firstName), normalize(user.lastName)].filter(Boolean).join(' ').trim();
  if (fullName) {
    return user.username ? `${fullName} (@${user.username})` : fullName;
  }
  return normalize(user.username) || normalize(user.id);
};

interface OrganizationSettingsProps {
  mode?: 'all' | 'tenants' | 'organization';
}

const OrganizationSettings: React.FC<OrganizationSettingsProps> = ({ mode = 'all' }) => {
  const token = getAdminToken();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');

  const [tenantDraft, setTenantDraft] = useState<TenantDraft>(DEFAULT_TENANT_DRAFT);
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [tenantProfile, setTenantProfile] = useState<TenantProfile>(DEFAULT_TENANT_PROFILE);
  const [tenantProfileLoading, setTenantProfileLoading] = useState(false);
  const [tenantProfileSaving, setTenantProfileSaving] = useState(false);

  const [unitTypes, setUnitTypes] = useState<OrgUnitType[]>([]);
  const [typeDraft, setTypeDraft] = useState<TypeDraft>(DEFAULT_TYPE_DRAFT);

  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [unitDraft, setUnitDraft] = useState<UnitDraft>(DEFAULT_UNIT_DRAFT);
  const [adminUsers, setAdminUsers] = useState<AdminUserOption[]>([]);
  const [selectedGroupUnitId, setSelectedGroupUnitId] = useState('');
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  const [groupMembersSaving, setGroupMembersSaving] = useState(false);
  const [groupMembersError, setGroupMembersError] = useState<string | null>(null);
  const [groupMemberRows, setGroupMemberRows] = useState<GroupMemberDraft[]>([]);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) || null,
    [tenants, selectedTenantId]
  );
  const selectedGroupUnit = useMemo(
    () => orgUnits.find((unit) => unit.id === selectedGroupUnitId) || null,
    [orgUnits, selectedGroupUnitId]
  );

  const orgUnitLabelById = useMemo(() => {
    const byId = new Map<string, OrgUnit>();
    for (const unit of orgUnits) {
      byId.set(unit.id, unit);
    }
    const cache = new Map<string, string>();
    const resolveLabel = (id: string): string => {
      const cached = cache.get(id);
      if (cached) return cached;
      const node = byId.get(id);
      if (!node) return id;
      const name = normalize(node.name) || id;
      if (!node.parentId || !byId.has(node.parentId)) {
        cache.set(id, name);
        return name;
      }
      const guard = new Set<string>([id]);
      const segments = [name];
      let currentParent = node.parentId;
      while (currentParent && byId.has(currentParent) && !guard.has(currentParent)) {
        guard.add(currentParent);
        const parent = byId.get(currentParent)!;
        segments.unshift(normalize(parent.name) || currentParent);
        currentParent = parent.parentId;
      }
      const out = segments.join(' / ');
      cache.set(id, out);
      return out;
    };
    const out: Record<string, string> = {};
    for (const unit of orgUnits) {
      out[unit.id] = resolveLabel(unit.id);
    }
    return out;
  }, [orgUnits]);
  const userLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of adminUsers) {
      map.set(user.id, buildUserLabel(user));
    }
    return map;
  }, [adminUsers]);
  const selectedGroupMemberIdSet = useMemo(
    () => new Set(groupMemberRows.map((entry) => normalize(entry.userId)).filter(Boolean)),
    [groupMemberRows]
  );
  const selectableGroupUsers = useMemo(() => {
    return [...adminUsers]
      .filter((user) => user.active || selectedGroupMemberIdSet.has(user.id))
      .sort((a, b) => buildUserLabel(a).localeCompare(buildUserLabel(b), 'de', { sensitivity: 'base' }));
  }, [adminUsers, selectedGroupMemberIdSet]);

  const loadTenants = async (preferredTenantId?: string) => {
    const response = await axios.get('/api/admin/tenants', { headers });
    const list: Tenant[] = Array.isArray(response.data)
      ? response.data
          .map((row: any) => ({
            id: normalize(row?.id),
            slug: normalize(row?.slug),
            name: normalize(row?.name),
            tenantType: normalize(row?.tenantType || row?.tenant_type || 'verbandsgemeinde'),
            registrationEmailDomains: parseTenantRegistrationDomains(
              row?.registrationEmailDomains || row?.registration_email_domains
            ),
            assignmentKeywords: parseKeywordList(row?.assignmentKeywords || row?.assignment_keywords),
            active: !!row?.active,
          }))
          .filter((entry: Tenant) => !!entry.id)
      : [];
    setTenants(list);

    const preferred = normalize(preferredTenantId);
    const hasPreferred = preferred && list.some((entry) => entry.id === preferred);
    if (hasPreferred) {
      setSelectedTenantId(preferred);
    } else if (selectedTenantId && list.some((entry) => entry.id === selectedTenantId)) {
      setSelectedTenantId(selectedTenantId);
    } else {
      setSelectedTenantId(list[0]?.id || '');
    }
  };

  const loadTenantDetails = async (tenantId: string) => {
    const normalizedTenantId = normalize(tenantId);
    if (!normalizedTenantId) {
      setUnitTypes([]);
      setOrgUnits([]);
      setTenantProfile(DEFAULT_TENANT_PROFILE);
      return;
    }

    const profileRequest = async () => {
      setTenantProfileLoading(true);
      try {
        const profileRes = await axios.get(`/api/admin/tenants/${normalizedTenantId}/profile`, { headers });
        const profilePayload = profileRes.data || {};
        setTenantProfile({
          tenantId: normalizedTenantId,
          legalName: normalize(profilePayload.legalName),
          displayName: normalize(profilePayload.displayName),
          street: normalize(profilePayload.street),
          houseNumber: normalize(profilePayload.houseNumber),
          postalCode: normalize(profilePayload.postalCode),
          city: normalize(profilePayload.city),
          country: normalize(profilePayload.country),
          generalEmail: normalize(profilePayload.generalEmail),
          supportEmail: normalize(profilePayload.supportEmail),
          phone: normalize(profilePayload.phone),
          homepage: normalize(profilePayload.homepage),
          responsiblePersonName: normalize(profilePayload.responsiblePersonName),
          responsiblePersonRole: normalize(profilePayload.responsiblePersonRole),
          responsiblePersonEmail: normalize(profilePayload.responsiblePersonEmail),
          responsiblePersonPhone: normalize(profilePayload.responsiblePersonPhone),
          vatId: normalize(profilePayload.vatId),
          imprintText: normalize(profilePayload.imprintText),
          privacyContact: normalize(profilePayload.privacyContact),
        });
      } catch (error) {
        setTenantProfile({
          ...DEFAULT_TENANT_PROFILE,
          tenantId: normalizedTenantId,
        });
      } finally {
        setTenantProfileLoading(false);
      }
    };

    const [typesRes, unitsRes] = await Promise.all([
      axios.get(`/api/admin/tenants/${normalizedTenantId}/org-unit-types`, { headers }),
      axios.get(`/api/admin/tenants/${normalizedTenantId}/org-units`, {
        headers,
        params: { includeInactive: true },
      }),
      profileRequest(),
    ]);

    const nextTypes: OrgUnitType[] = Array.isArray(typesRes.data)
      ? typesRes.data.map((row: any) => ({
          id: normalize(row?.id),
          tenantId: normalize(row?.tenantId || row?.tenant_id || normalizedTenantId),
          key: normalize(row?.key),
          label: normalize(row?.label),
          isAssignable: !!row?.isAssignable,
          sortOrder: Number.isFinite(Number(row?.sortOrder)) ? Number(row?.sortOrder) : 0,
          active: !!row?.active,
          assignmentKeywords: parseKeywordList(row?.assignmentKeywords || row?.assignment_keywords),
        }))
      : [];
    setUnitTypes(nextTypes.filter((entry) => !!entry.id));

    const nextUnits: OrgUnit[] = Array.isArray(unitsRes.data)
      ? unitsRes.data.map((row: any) => ({
          id: normalize(row?.id),
          tenantId: normalize(row?.tenantId || row?.tenant_id || normalizedTenantId),
          typeId: normalize(row?.typeId || row?.type_id) || null,
          parentId: normalize(row?.parentId || row?.parent_id) || null,
          name: normalize(row?.name),
          code: normalize(row?.code) || null,
          contactEmail: normalize(row?.contactEmail || row?.contact_email) || null,
          active: !!row?.active,
          assignmentKeywords: parseKeywordList(row?.assignmentKeywords || row?.assignment_keywords),
        }))
      : [];
    setOrgUnits(nextUnits.filter((entry) => !!entry.id));
  };

  const loadAdminUsers = async () => {
    const response = await axios.get('/api/admin/users', { headers });
    const list: AdminUserOption[] = Array.isArray(response.data)
      ? response.data
          .map((row: any) => ({
            id: normalize(row?.id),
            username: normalize(row?.username),
            firstName: normalize(row?.firstName || row?.first_name) || null,
            lastName: normalize(row?.lastName || row?.last_name) || null,
            email: normalize(row?.email) || null,
            role: normalize(row?.role) || null,
            active: row?.active !== false,
          }))
          .filter((entry: AdminUserOption) => !!entry.id)
      : [];
    setAdminUsers(list);
  };

  const loadGroupMembers = useCallback(
    async (unitId: string) => {
      const normalizedUnitId = normalize(unitId);
      if (!normalizedUnitId) {
        setGroupMemberRows([]);
        return;
      }
      setGroupMembersLoading(true);
      setGroupMembersError(null);
      try {
        const response = await axios.get(`/api/admin/org-units/${normalizedUnitId}/members`, { headers });
        const rows = Array.isArray(response.data?.members) ? response.data.members : [];
        const members: GroupMemberDraft[] = rows
          .map((entry: any) => ({
            userId: normalize(entry?.userId || entry?.adminUserId),
            canWrite: entry?.canWrite !== false,
          }))
          .filter((entry) => !!entry.userId);
        setGroupMemberRows(members);
      } catch (error: any) {
        setGroupMemberRows([]);
        setGroupMembersError(error?.response?.data?.message || 'Gruppenmitglieder konnten nicht geladen werden.');
      } finally {
        setGroupMembersLoading(false);
      }
    },
    [headers]
  );

  const fullReload = async (preferredTenantId?: string) => {
    try {
      setLoading(true);
      await loadTenants(preferredTenantId);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([fullReload(), loadAdminUsers()]);
  }, [token]);

  useEffect(() => {
    if (!selectedTenantId) {
      setUnitTypes([]);
      setOrgUnits([]);
      setTenantProfile(DEFAULT_TENANT_PROFILE);
      return;
    }
    void loadTenantDetails(selectedTenantId);
  }, [selectedTenantId]);

  useEffect(() => {
    if (!selectedGroupUnitId) return;
    const current = orgUnits.find((entry) => entry.id === selectedGroupUnitId);
    if (!current || (selectedTenantId && current.tenantId !== selectedTenantId)) {
      setSelectedGroupUnitId('');
      setGroupMemberRows([]);
      setGroupMembersError(null);
    }
  }, [orgUnits, selectedGroupUnitId, selectedTenantId]);

  useEffect(() => {
    if (!selectedGroupUnitId) return;
    void loadGroupMembers(selectedGroupUnitId);
  }, [selectedGroupUnitId, loadGroupMembers]);

  const setFeedback = (type: 'success' | 'error', text: string) => {
    setMessage(text);
    setMessageType(type);
  };

  const resetTenantDraft = () => {
    setTenantDraft(DEFAULT_TENANT_DRAFT);
    setEditingTenantId(null);
  };

  const updateTenantProfile = <K extends keyof TenantProfile>(key: K, value: TenantProfile[K]) => {
    setTenantProfile((prev) => ({ ...prev, [key]: value }));
  };

  const saveTenantProfile = async () => {
    if (!selectedTenantId) {
      setFeedback('error', 'Bitte zuerst einen Mandanten auswählen.');
      return;
    }

    setTenantProfileSaving(true);
    try {
      const payload = {
        legalName: normalize(tenantProfile.legalName),
        displayName: normalize(tenantProfile.displayName),
        street: normalize(tenantProfile.street),
        houseNumber: normalize(tenantProfile.houseNumber),
        postalCode: normalize(tenantProfile.postalCode),
        city: normalize(tenantProfile.city),
        country: normalize(tenantProfile.country),
        generalEmail: normalize(tenantProfile.generalEmail),
        supportEmail: normalize(tenantProfile.supportEmail),
        phone: normalize(tenantProfile.phone),
        homepage: normalize(tenantProfile.homepage),
        responsiblePersonName: normalize(tenantProfile.responsiblePersonName),
        responsiblePersonRole: normalize(tenantProfile.responsiblePersonRole),
        responsiblePersonEmail: normalize(tenantProfile.responsiblePersonEmail),
        responsiblePersonPhone: normalize(tenantProfile.responsiblePersonPhone),
        vatId: normalize(tenantProfile.vatId),
        imprintText: tenantProfile.imprintText || '',
        privacyContact: tenantProfile.privacyContact || '',
      };
      const response = await axios.patch(`/api/admin/tenants/${selectedTenantId}/profile`, payload, { headers });
      const nextProfile = response.data?.profile || response.data || {};
      setTenantProfile({
        tenantId: selectedTenantId,
        legalName: normalize(nextProfile.legalName),
        displayName: normalize(nextProfile.displayName),
        street: normalize(nextProfile.street),
        houseNumber: normalize(nextProfile.houseNumber),
        postalCode: normalize(nextProfile.postalCode),
        city: normalize(nextProfile.city),
        country: normalize(nextProfile.country),
        generalEmail: normalize(nextProfile.generalEmail),
        supportEmail: normalize(nextProfile.supportEmail),
        phone: normalize(nextProfile.phone),
        homepage: normalize(nextProfile.homepage),
        responsiblePersonName: normalize(nextProfile.responsiblePersonName),
        responsiblePersonRole: normalize(nextProfile.responsiblePersonRole),
        responsiblePersonEmail: normalize(nextProfile.responsiblePersonEmail),
        responsiblePersonPhone: normalize(nextProfile.responsiblePersonPhone),
        vatId: normalize(nextProfile.vatId),
        imprintText: normalize(nextProfile.imprintText),
        privacyContact: normalize(nextProfile.privacyContact),
      });
      setFeedback('success', 'Mandanten-Profil gespeichert.');
    } catch (error: any) {
      setFeedback('error', error?.response?.data?.message || 'Mandanten-Profil konnte nicht gespeichert werden.');
    } finally {
      setTenantProfileSaving(false);
    }
  };

  const resetTypeDraft = () => setTypeDraft(DEFAULT_TYPE_DRAFT);
  const resetUnitDraft = () => setUnitDraft(DEFAULT_UNIT_DRAFT);

  const submitTenant = async (event: React.FormEvent) => {
    event.preventDefault();
    const registrationEmailDomains = parseTenantRegistrationDomains(tenantDraft.registrationEmailDomainsText);
    const payload = {
      slug: normalize(tenantDraft.slug).toLowerCase(),
      name: normalize(tenantDraft.name),
      tenantType: normalize(tenantDraft.tenantType) || 'verbandsgemeinde',
      registrationEmailDomains,
      assignmentKeywords: parseKeywordList(tenantDraft.assignmentKeywords),
      active: tenantDraft.active,
    };
    if (!payload.slug || !payload.name) {
      setFeedback('error', 'Bitte Slug und Name für den Mandanten ausfüllen.');
      return;
    }

    setSaving(true);
    try {
      if (editingTenantId) {
        await axios.patch(`/api/admin/tenants/${editingTenantId}`, payload, { headers });
        setFeedback('success', 'Mandant aktualisiert.');
        await fullReload(editingTenantId);
      } else {
        const response = await axios.post('/api/admin/tenants', payload, { headers });
        const createdId = normalize(response.data?.id);
        setFeedback('success', 'Mandant erstellt.');
        await fullReload(createdId);
      }
      resetTenantDraft();
    } catch (error: any) {
      setFeedback('error', error?.response?.data?.message || 'Mandant konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const editTenant = (tenant: Tenant) => {
    setEditingTenantId(tenant.id);
    setTenantDraft({
      slug: tenant.slug,
      name: tenant.name,
      tenantType: tenant.tenantType,
      registrationEmailDomainsText: serializeTenantRegistrationDomains(tenant.registrationEmailDomains),
      assignmentKeywords: parseKeywordList(tenant.assignmentKeywords),
      active: tenant.active,
    });
  };

  const deleteTenant = async (tenantId: string) => {
    if (!window.confirm('Mandant wirklich löschen?')) return;
    setSaving(true);
    try {
      await axios.delete(`/api/admin/tenants/${tenantId}`, { headers });
      setFeedback('success', 'Mandant gelöscht.');
      await fullReload();
    } catch (error: any) {
      setFeedback('error', error?.response?.data?.message || 'Mandant konnte nicht gelöscht werden.');
    } finally {
      setSaving(false);
    }
  };

  const submitType = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTenantId) {
      setFeedback('error', 'Bitte zuerst einen Mandanten auswählen.');
      return;
    }
    const payload = {
      key: normalize(typeDraft.key).toLowerCase(),
      label: normalize(typeDraft.label),
      isAssignable: typeDraft.isAssignable,
      sortOrder: Number.isFinite(Number(typeDraft.sortOrder)) ? Math.floor(Number(typeDraft.sortOrder)) : 0,
      active: typeDraft.active,
      assignmentKeywords: parseKeywordList(typeDraft.assignmentKeywords),
    };
    if (!payload.key || !payload.label) {
      setFeedback('error', 'Bitte Key und Label für den Organisationstyp ausfüllen.');
      return;
    }

    setSaving(true);
    try {
      if (typeDraft.id) {
        await axios.patch(`/api/admin/org-unit-types/${typeDraft.id}`, payload, { headers });
        setFeedback('success', 'Organisationstyp aktualisiert.');
      } else {
        await axios.post(`/api/admin/tenants/${selectedTenantId}/org-unit-types`, payload, { headers });
        setFeedback('success', 'Organisationstyp erstellt.');
      }
      resetTypeDraft();
      await loadTenantDetails(selectedTenantId);
    } catch (error: any) {
      setFeedback('error', error?.response?.data?.message || 'Organisationstyp konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const editType = (entry: OrgUnitType) => {
    setTypeDraft({
      id: entry.id,
      key: entry.key,
      label: entry.label,
      isAssignable: entry.isAssignable,
      sortOrder: entry.sortOrder,
      active: entry.active,
      assignmentKeywords: parseKeywordList(entry.assignmentKeywords),
    });
  };

  const deleteType = async (typeId: string) => {
    if (!window.confirm('Organisationstyp wirklich löschen?')) return;
    setSaving(true);
    try {
      await axios.delete(`/api/admin/org-unit-types/${typeId}`, { headers });
      setFeedback('success', 'Organisationstyp gelöscht.');
      await loadTenantDetails(selectedTenantId);
    } catch (error: any) {
      setFeedback('error', error?.response?.data?.message || 'Organisationstyp konnte nicht gelöscht werden.');
    } finally {
      setSaving(false);
    }
  };

  const submitUnit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTenantId) {
      setFeedback('error', 'Bitte zuerst einen Mandanten auswählen.');
      return;
    }
    const payload = {
      name: normalize(unitDraft.name),
      code: normalize(unitDraft.code) || null,
      contactEmail: normalize(unitDraft.contactEmail) || null,
      typeId: normalize(unitDraft.typeId) || null,
      parentId: normalize(unitDraft.parentId) || null,
      active: unitDraft.active,
      assignmentKeywords: parseKeywordList(unitDraft.assignmentKeywords),
    };
    if (!payload.name) {
      setFeedback('error', 'Bitte Namen für die Organisationseinheit ausfüllen.');
      return;
    }

    setSaving(true);
    try {
      if (unitDraft.id) {
        await axios.patch(`/api/admin/org-units/${unitDraft.id}`, payload, { headers });
        setFeedback('success', 'Organisationseinheit aktualisiert.');
      } else {
        await axios.post(`/api/admin/tenants/${selectedTenantId}/org-units`, payload, { headers });
        setFeedback('success', 'Organisationseinheit erstellt.');
      }
      resetUnitDraft();
      await loadTenantDetails(selectedTenantId);
    } catch (error: any) {
      setFeedback('error', error?.response?.data?.message || 'Organisationseinheit konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const editUnit = (entry: OrgUnit) => {
    setUnitDraft({
      id: entry.id,
      name: entry.name,
      code: entry.code || '',
      contactEmail: entry.contactEmail || '',
      typeId: entry.typeId || '',
      parentId: entry.parentId || '',
      active: entry.active,
      assignmentKeywords: parseKeywordList(entry.assignmentKeywords),
    });
  };

  const deleteUnit = async (unitId: string) => {
    if (!window.confirm('Organisationseinheit wirklich löschen?')) return;
    setSaving(true);
    try {
      await axios.delete(`/api/admin/org-units/${unitId}`, { headers });
      setFeedback('success', 'Organisationseinheit gelöscht.');
      await loadTenantDetails(selectedTenantId);
      if (selectedGroupUnitId === unitId) {
        setSelectedGroupUnitId('');
        setGroupMemberRows([]);
      }
    } catch (error: any) {
      setFeedback('error', error?.response?.data?.message || 'Organisationseinheit konnte nicht gelöscht werden.');
    } finally {
      setSaving(false);
    }
  };

  const handleGroupMemberSelectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedIds = Array.from(event.target.selectedOptions)
      .map((option) => normalize(option.value))
      .filter(Boolean);
    const previousMap = new Map(groupMemberRows.map((entry) => [entry.userId, entry.canWrite]));
    setGroupMemberRows(
      selectedIds.map((userId) => ({
        userId,
        canWrite: previousMap.get(userId) ?? true,
      }))
    );
  };

  const saveGroupMembers = async () => {
    if (!selectedGroupUnitId) return;
    setGroupMembersSaving(true);
    setGroupMembersError(null);
    try {
      await axios.put(
        `/api/admin/org-units/${selectedGroupUnitId}/members`,
        { members: groupMemberRows },
        { headers }
      );
      setFeedback('success', 'Gruppenmitglieder gespeichert.');
      await loadGroupMembers(selectedGroupUnitId);
    } catch (error: any) {
      setGroupMembersError(error?.response?.data?.message || 'Gruppenmitglieder konnten nicht gespeichert werden.');
    } finally {
      setGroupMembersSaving(false);
    }
  };

  const unitTypeById = useMemo(() => {
    const map = new Map<string, OrgUnitType>();
    for (const entry of unitTypes) {
      map.set(entry.id, entry);
    }
    return map;
  }, [unitTypes]);

  const roots = useMemo(() => {
    const byParent = new Map<string, OrgUnit[]>();
    const rootUnits: OrgUnit[] = [];
    for (const unit of orgUnits) {
      const parentId = unit.parentId || '';
      if (!parentId) {
        rootUnits.push(unit);
      } else {
        const bucket = byParent.get(parentId) || [];
        bucket.push(unit);
        byParent.set(parentId, bucket);
      }
    }
    for (const bucket of byParent.values()) {
      bucket.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
    }
    rootUnits.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
    return { roots: rootUnits, childrenByParent: byParent };
  }, [orgUnits]);

  const renderTreeNode = (unit: OrgUnit): React.ReactNode => {
    const children = roots.childrenByParent.get(unit.id) || [];
    const unitType = unit.typeId ? unitTypeById.get(unit.typeId) : null;
    return (
      <li key={unit.id} className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-800">{unit.name}</span>
          {unitType && <span className="badge bg-slate-200 text-slate-700">{unitType.label}</span>}
          {!unit.active && <span className="badge bg-amber-100 text-amber-700">Inaktiv</span>}
          {unit.code && <span className="text-xs text-slate-500">Code: {unit.code}</span>}
          {unit.contactEmail && <span className="text-xs text-slate-500">Kontakt: {unit.contactEmail}</span>}
          {unit.assignmentKeywords.length > 0 && (
            <span className="text-xs text-slate-500">
              Schlagworte: {unit.assignmentKeywords.slice(0, 5).join(', ')}
              {unit.assignmentKeywords.length > 5 ? ' …' : ''}
            </span>
          )}
        </div>
        {children.length > 0 && <ul className="pl-4 border-l border-slate-200 space-y-2">{children.map((child) => renderTreeNode(child))}</ul>}
      </li>
    );
  };

  const showTenantManagement = mode === 'all' || mode === 'tenants';
  const showOrganizationManagement = mode === 'all' || mode === 'organization';
  const pageTitle =
    mode === 'tenants'
      ? 'Mandanten'
      : mode === 'organization'
      ? 'Organisationsstruktur'
      : 'Organisationsstruktur & Mandanten';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-semibold">{pageTitle}</h2>
        <button className="btn btn-secondary" onClick={() => void fullReload(selectedTenantId)} disabled={loading || saving}>
          <i className="fa-solid fa-rotate" /> Neu laden
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

      {showTenantManagement ? (
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-lg font-semibold">Mandanten</h3>
          <select
            className="input"
            value={selectedTenantId}
            onChange={(event) => setSelectedTenantId(event.target.value)}
            disabled={loading || tenants.length === 0}
          >
            <option value="">Mandant auswählen</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name} ({tenant.slug})
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-slate-500">Lade Mandanten...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">Name</th>
                  <th className="py-2">Slug</th>
                  <th className="py-2">Typ</th>
                  <th className="py-2">Registrierungs-Domains</th>
                  <th className="py-2">Schlagworte</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className={`border-t border-slate-200 ${tenant.id === selectedTenantId ? 'bg-slate-50' : ''}`}>
                    <td className="py-2 font-semibold">{tenant.name}</td>
                    <td className="py-2 text-slate-600">{tenant.slug}</td>
                    <td className="py-2 text-slate-600">{tenant.tenantType}</td>
                    <td className="py-2 text-slate-600">
                      {tenant.registrationEmailDomains.length > 0
                        ? `${tenant.registrationEmailDomains.length} Domain(s)`
                        : 'Keine'}
                    </td>
                    <td className="py-2 text-slate-600">
                      {tenant.assignmentKeywords.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {tenant.assignmentKeywords.slice(0, 3).map((keyword) => (
                            <span key={`${tenant.id}-${keyword}`} className="badge bg-emerald-50 text-emerald-700">
                              {keyword}
                            </span>
                          ))}
                          {tenant.assignmentKeywords.length > 3 && (
                            <span className="text-xs text-slate-500">+{tenant.assignmentKeywords.length - 3}</span>
                          )}
                        </div>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="py-2">
                      <span className={`badge ${tenant.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                        {tenant.active ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-secondary" onClick={() => setSelectedTenantId(tenant.id)}>
                          Öffnen
                        </button>
                        <button className="btn btn-secondary" onClick={() => editTenant(tenant)}>
                          Bearbeiten
                        </button>
                        {tenant.id !== 'tenant_default' && (
                          <button className="btn btn-danger" onClick={() => void deleteTenant(tenant.id)} disabled={saving}>
                            Löschen
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-slate-500">
                      Keine Mandanten vorhanden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <form className="grid grid-cols-1 md:grid-cols-4 gap-3 border border-slate-200 rounded-lg p-4" onSubmit={submitTenant}>
          <div>
            <label className="block text-sm font-semibold mb-1">Slug</label>
            <input
              className="input"
              value={tenantDraft.slug}
              onChange={(event) => setTenantDraft((prev) => ({ ...prev, slug: event.target.value }))}
              placeholder="vg-otterbach"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Name</label>
            <input
              className="input"
              value={tenantDraft.name}
              onChange={(event) => setTenantDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Verbandsgemeinde Otterbach-Otterberg"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Typ</label>
            <select
              className="input"
              value={tenantDraft.tenantType}
              onChange={(event) => setTenantDraft((prev) => ({ ...prev, tenantType: event.target.value }))}
            >
              {TENANT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Status</label>
            <select
              className="input"
              value={tenantDraft.active ? '1' : '0'}
              onChange={(event) => setTenantDraft((prev) => ({ ...prev, active: event.target.value === '1' }))}
            >
              <option value="1">Aktiv</option>
              <option value="0">Inaktiv</option>
            </select>
          </div>
          <div className="md:col-span-4">
            <label className="block text-sm font-semibold mb-1">
              Erlaubte Registrierungs-Domains (je Zeile oder komma-separiert)
            </label>
            <textarea
              className="input min-h-[120px]"
              value={tenantDraft.registrationEmailDomainsText}
              onChange={(event) =>
                setTenantDraft((prev) => ({ ...prev, registrationEmailDomainsText: event.target.value }))
              }
              placeholder={'kommune.de\nstadtwerke.de'}
            />
          </div>
          <KeywordChipsInput
            className="md:col-span-4"
            label="Schlagworte für automatische Zuweisung"
            value={tenantDraft.assignmentKeywords}
            onChange={(next) => setTenantDraft((prev) => ({ ...prev, assignmentKeywords: next }))}
            disabled={saving}
            helperText="Mandanten-Schlagworte können später in der Zuweisungslogik ausgewertet werden."
          />
          <div className="md:col-span-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {editingTenantId ? 'Mandant speichern' : 'Mandant erstellen'}
            </button>
            {editingTenantId && (
              <button type="button" className="btn btn-secondary" onClick={resetTenantDraft}>
                Bearbeitung verwerfen
              </button>
            )}
          </div>
        </form>

        <div className="border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-base font-semibold">Mandantenprofil</h4>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void saveTenantProfile()}
              disabled={!selectedTenantId || tenantProfileSaving}
            >
              {tenantProfileSaving ? 'Speichere…' : 'Profil speichern'}
            </button>
          </div>
          {!selectedTenantId ? (
            <p className="text-sm text-slate-500">Bitte zuerst einen Mandanten auswählen.</p>
          ) : tenantProfileLoading ? (
            <p className="text-sm text-slate-500">Lade Mandantenprofil…</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1">Rechtlicher Name</label>
                <input
                  className="input"
                  value={tenantProfile.legalName}
                  onChange={(event) => updateTenantProfile('legalName', event.target.value)}
                  placeholder="Musterstadt GmbH"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Anzeigename</label>
                <input
                  className="input"
                  value={tenantProfile.displayName}
                  onChange={(event) => updateTenantProfile('displayName', event.target.value)}
                  placeholder="Stadt Musterstadt"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">USt-IdNr. (optional)</label>
                <input
                  className="input"
                  value={tenantProfile.vatId}
                  onChange={(event) => updateTenantProfile('vatId', event.target.value)}
                  placeholder="DE123456789"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Straße</label>
                <input
                  className="input"
                  value={tenantProfile.street}
                  onChange={(event) => updateTenantProfile('street', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Hausnummer</label>
                <input
                  className="input"
                  value={tenantProfile.houseNumber}
                  onChange={(event) => updateTenantProfile('houseNumber', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">PLZ</label>
                <input
                  className="input"
                  value={tenantProfile.postalCode}
                  onChange={(event) => updateTenantProfile('postalCode', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Ort</label>
                <input
                  className="input"
                  value={tenantProfile.city}
                  onChange={(event) => updateTenantProfile('city', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Land</label>
                <input
                  className="input"
                  value={tenantProfile.country}
                  onChange={(event) => updateTenantProfile('country', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Homepage</label>
                <input
                  className="input"
                  value={tenantProfile.homepage}
                  onChange={(event) => updateTenantProfile('homepage', event.target.value)}
                  placeholder="https://example.org"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Allgemeine E-Mail</label>
                <input
                  type="email"
                  className="input"
                  value={tenantProfile.generalEmail}
                  onChange={(event) => updateTenantProfile('generalEmail', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Support E-Mail</label>
                <input
                  type="email"
                  className="input"
                  value={tenantProfile.supportEmail}
                  onChange={(event) => updateTenantProfile('supportEmail', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Telefon</label>
                <input
                  className="input"
                  value={tenantProfile.phone}
                  onChange={(event) => updateTenantProfile('phone', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Verantwortliche Person</label>
                <input
                  className="input"
                  value={tenantProfile.responsiblePersonName}
                  onChange={(event) => updateTenantProfile('responsiblePersonName', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Funktion</label>
                <input
                  className="input"
                  value={tenantProfile.responsiblePersonRole}
                  onChange={(event) => updateTenantProfile('responsiblePersonRole', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Kontakt E-Mail</label>
                <input
                  type="email"
                  className="input"
                  value={tenantProfile.responsiblePersonEmail}
                  onChange={(event) => updateTenantProfile('responsiblePersonEmail', event.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Kontakt Telefon</label>
                <input
                  className="input"
                  value={tenantProfile.responsiblePersonPhone}
                  onChange={(event) => updateTenantProfile('responsiblePersonPhone', event.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold mb-1">Datenschutz-Kontakt (optional)</label>
                <input
                  className="input"
                  value={tenantProfile.privacyContact}
                  onChange={(event) => updateTenantProfile('privacyContact', event.target.value)}
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-sm font-semibold mb-1">Impressumstext (optional)</label>
                <textarea
                  className="input min-h-[100px]"
                  value={tenantProfile.imprintText}
                  onChange={(event) => updateTenantProfile('imprintText', event.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      ) : showOrganizationManagement ? (
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-lg font-semibold">Mandant auswählen</h3>
          <select
            className="input"
            value={selectedTenantId}
            onChange={(event) => setSelectedTenantId(event.target.value)}
            disabled={loading || tenants.length === 0}
          >
            <option value="">Mandant auswählen</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name} ({tenant.slug})
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-slate-500">
          Organisationstypen und Einheiten werden im aktuell gewählten Mandanten bearbeitet.
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Kommunale Ansprechpartner werden künftig direkt über Organisationseinheiten und deren Zuständigkeits-Schlagworte gepflegt.
        </div>
      </div>
      ) : null}

      {showOrganizationManagement && (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card p-6 space-y-4">
          <h3 className="text-lg font-semibold">Organisationstypen</h3>
          <p className="text-sm text-slate-500">
            {selectedTenant ? `Mandant: ${selectedTenant.name}` : 'Bitte zuerst einen Mandanten auswählen.'}
          </p>

          <form className="grid grid-cols-1 md:grid-cols-4 gap-3 border border-slate-200 rounded-lg p-4" onSubmit={submitType}>
            <div>
              <label className="block text-sm font-semibold mb-1">Key</label>
              <input
                className="input"
                value={typeDraft.key}
                onChange={(event) => setTypeDraft((prev) => ({ ...prev, key: event.target.value }))}
                placeholder="fachbereich"
                disabled={!selectedTenantId}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Label</label>
              <input
                className="input"
                value={typeDraft.label}
                onChange={(event) => setTypeDraft((prev) => ({ ...prev, label: event.target.value }))}
                placeholder="Fachbereich"
                disabled={!selectedTenantId}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Sortierung</label>
              <input
                type="number"
                className="input"
                value={typeDraft.sortOrder}
                onChange={(event) => setTypeDraft((prev) => ({ ...prev, sortOrder: Number(event.target.value) }))}
                disabled={!selectedTenantId}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Status</label>
              <select
                className="input"
                value={typeDraft.active ? '1' : '0'}
                onChange={(event) => setTypeDraft((prev) => ({ ...prev, active: event.target.value === '1' }))}
                disabled={!selectedTenantId}
              >
                <option value="1">Aktiv</option>
                <option value="0">Inaktiv</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Zuweisbar</label>
              <select
                className="input"
                value={typeDraft.isAssignable ? '1' : '0'}
                onChange={(event) => setTypeDraft((prev) => ({ ...prev, isAssignable: event.target.value === '1' }))}
                disabled={!selectedTenantId}
              >
                <option value="1">Ja</option>
                <option value="0">Nein</option>
              </select>
            </div>
            <KeywordChipsInput
              className="md:col-span-4"
              label="Schlagworte für automatische Zuweisung"
              value={typeDraft.assignmentKeywords}
              onChange={(next) => setTypeDraft((prev) => ({ ...prev, assignmentKeywords: next }))}
              disabled={!selectedTenantId}
              helperText="Schlagworte auf Typ-Ebene helfen bei der späteren Regel- oder KI-Zuweisung."
            />
            <div className="md:col-span-3 flex flex-wrap items-end gap-2">
              <button className="btn btn-primary" type="submit" disabled={saving || !selectedTenantId}>
                {typeDraft.id ? 'Typ speichern' : 'Typ hinzufügen'}
              </button>
              {typeDraft.id && (
                <button type="button" className="btn btn-secondary" onClick={resetTypeDraft}>
                  Bearbeitung verwerfen
                </button>
              )}
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">Label</th>
                  <th className="py-2">Key</th>
                  <th className="py-2">Sort</th>
                  <th className="py-2">Schlagworte</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {unitTypes.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-200">
                    <td className="py-2 font-semibold">{entry.label}</td>
                    <td className="py-2 text-slate-600">{entry.key}</td>
                    <td className="py-2 text-slate-600">{entry.sortOrder}</td>
                    <td className="py-2 text-slate-600">
                      {entry.assignmentKeywords.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {entry.assignmentKeywords.slice(0, 2).map((keyword) => (
                            <span key={`${entry.id}-${keyword}`} className="badge bg-emerald-50 text-emerald-700">
                              {keyword}
                            </span>
                          ))}
                          {entry.assignmentKeywords.length > 2 && (
                            <span className="text-xs text-slate-500">+{entry.assignmentKeywords.length - 2}</span>
                          )}
                        </div>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="py-2 text-slate-600">{entry.active ? 'Aktiv' : 'Inaktiv'}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button className="btn btn-secondary" onClick={() => editType(entry)}>
                          Bearbeiten
                        </button>
                        <button className="btn btn-danger" onClick={() => void deleteType(entry.id)} disabled={saving}>
                          Löschen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {unitTypes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-slate-500">
                      Keine Typen vorhanden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-6 space-y-4">
          <h3 className="text-lg font-semibold">Organisationseinheiten</h3>
          <p className="text-sm text-slate-500">
            {selectedTenant ? `Mandant: ${selectedTenant.name}` : 'Bitte zuerst einen Mandanten auswählen.'}
          </p>

          <form className="grid grid-cols-1 md:grid-cols-2 gap-3 border border-slate-200 rounded-lg p-4" onSubmit={submitUnit}>
            <div>
              <label className="block text-sm font-semibold mb-1">Name</label>
              <input
                className="input"
                value={unitDraft.name}
                onChange={(event) => setUnitDraft((prev) => ({ ...prev, name: event.target.value }))}
                disabled={!selectedTenantId}
                placeholder="Bauamt Team 1"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Code</label>
              <input
                className="input"
                value={unitDraft.code}
                onChange={(event) => setUnitDraft((prev) => ({ ...prev, code: event.target.value }))}
                disabled={!selectedTenantId}
                placeholder="BAU-T1"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Kontakt-E-Mail</label>
              <input
                className="input"
                type="email"
                value={unitDraft.contactEmail}
                onChange={(event) => setUnitDraft((prev) => ({ ...prev, contactEmail: event.target.value }))}
                disabled={!selectedTenantId}
                placeholder="bauamt@kommune.de"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Typ</label>
              <select
                className="input"
                value={unitDraft.typeId}
                onChange={(event) => setUnitDraft((prev) => ({ ...prev, typeId: event.target.value }))}
                disabled={!selectedTenantId}
              >
                <option value="">(ohne Typ)</option>
                {unitTypes.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Parent</label>
              <select
                className="input"
                value={unitDraft.parentId}
                onChange={(event) => setUnitDraft((prev) => ({ ...prev, parentId: event.target.value }))}
                disabled={!selectedTenantId}
              >
                <option value="">(Root)</option>
                {orgUnits
                  .filter((entry) => entry.id !== unitDraft.id)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {orgUnitLabelById[entry.id] || entry.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Status</label>
              <select
                className="input"
                value={unitDraft.active ? '1' : '0'}
                onChange={(event) => setUnitDraft((prev) => ({ ...prev, active: event.target.value === '1' }))}
                disabled={!selectedTenantId}
              >
                <option value="1">Aktiv</option>
                <option value="0">Inaktiv</option>
              </select>
            </div>
            <KeywordChipsInput
              className="md:col-span-2"
              label="Schlagworte für automatische Zuweisung"
              value={unitDraft.assignmentKeywords}
              onChange={(next) => setUnitDraft((prev) => ({ ...prev, assignmentKeywords: next }))}
              disabled={!selectedTenantId}
              helperText="Einheits-Schlagworte können künftig direkt in Zuweisungsregeln verwendet werden."
            />
            <div className="flex items-end gap-2">
              <button className="btn btn-primary" type="submit" disabled={saving || !selectedTenantId}>
                {unitDraft.id ? 'Einheit speichern' : 'Einheit hinzufügen'}
              </button>
              {unitDraft.id && (
                <button type="button" className="btn btn-secondary" onClick={resetUnitDraft}>
                  Bearbeitung verwerfen
                </button>
              )}
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">Name</th>
                  <th className="py-2">Typ</th>
                  <th className="py-2">Parent</th>
                  <th className="py-2">Kontakt-E-Mail</th>
                  <th className="py-2">Schlagworte</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {orgUnits.map((entry) => (
                  <tr
                    key={entry.id}
                    className={`border-t border-slate-200 ${selectedGroupUnitId === entry.id ? 'bg-sky-50' : ''}`}
                  >
                    <td className="py-2 font-semibold">{entry.name}</td>
                    <td className="py-2 text-slate-600">{entry.typeId ? unitTypeById.get(entry.typeId)?.label || entry.typeId : '–'}</td>
                    <td className="py-2 text-slate-600">{entry.parentId ? orgUnitLabelById[entry.parentId] || entry.parentId : '–'}</td>
                    <td className="py-2 text-slate-600">{entry.contactEmail || '–'}</td>
                    <td className="py-2 text-slate-600">
                      {entry.assignmentKeywords.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {entry.assignmentKeywords.slice(0, 2).map((keyword) => (
                            <span key={`${entry.id}-${keyword}`} className="badge bg-emerald-50 text-emerald-700">
                              {keyword}
                            </span>
                          ))}
                          {entry.assignmentKeywords.length > 2 && (
                            <span className="text-xs text-slate-500">+{entry.assignmentKeywords.length - 2}</span>
                          )}
                        </div>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="py-2 text-slate-600">{entry.active ? 'Aktiv' : 'Inaktiv'}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button className="btn btn-secondary" onClick={() => editUnit(entry)}>
                          Bearbeiten
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => setSelectedGroupUnitId(entry.id)}
                        >
                          Gruppe
                        </button>
                        <button className="btn btn-danger" onClick={() => void deleteUnit(entry.id)} disabled={saving}>
                          Löschen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {orgUnits.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-slate-500">
                      Keine Einheiten vorhanden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="font-semibold text-slate-800">Benutzergruppe je Hierarchieknoten</h4>
              <div className="flex items-center gap-2">
                <select
                  className="input"
                  value={selectedGroupUnitId}
                  onChange={(event) => setSelectedGroupUnitId(event.target.value)}
                  disabled={!selectedTenantId || orgUnits.length === 0}
                >
                  <option value="">Einheit auswählen…</option>
                  {[...orgUnits]
                    .sort((a, b) => (orgUnitLabelById[a.id] || a.name).localeCompare(orgUnitLabelById[b.id] || b.name, 'de', { sensitivity: 'base' }))
                    .map((entry) => (
                      <option key={`group-unit-${entry.id}`} value={entry.id}>
                        {orgUnitLabelById[entry.id] || entry.name}
                      </option>
                    ))}
                </select>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => selectedGroupUnitId && void loadGroupMembers(selectedGroupUnitId)}
                  disabled={!selectedGroupUnitId || groupMembersLoading}
                >
                  Aktualisieren
                </button>
              </div>
            </div>

            {!selectedGroupUnit ? (
              <p className="text-sm text-slate-500">
                Eine Organisationseinheit auswählen, um deren Benutzergruppe zu bearbeiten.
              </p>
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  <strong>{selectedGroupUnit.name}</strong>
                  {selectedGroupUnit.contactEmail ? ` · Kontakt: ${selectedGroupUnit.contactEmail}` : ' · Keine Kontakt-E-Mail'}
                </p>
                {groupMembersError && <p className="text-sm text-rose-700">{groupMembersError}</p>}
                <div>
                  <label className="block text-sm font-semibold mb-1">Mitglieder auswählen (Mehrfachauswahl)</label>
                  <select
                    multiple
                    className="input w-full min-h-[180px]"
                    value={groupMemberRows.map((entry) => entry.userId)}
                    onChange={handleGroupMemberSelectionChange}
                    disabled={groupMembersLoading || groupMembersSaving}
                  >
                    {selectableGroupUsers.map((user) => (
                      <option key={`group-user-${user.id}`} value={user.id}>
                        {user.active ? buildUserLabel(user) : `${buildUserLabel(user)} (inaktiv)`}
                      </option>
                    ))}
                  </select>
                  <small className="text-slate-500">
                    Nutzer können Mitglied in mehreren Organisationseinheiten sein.
                  </small>
                </div>
                <div className="space-y-2">
                  {groupMemberRows.length === 0 ? (
                    <p className="text-sm text-slate-500">Keine Mitglieder ausgewählt.</p>
                  ) : (
                    groupMemberRows.map((entry) => (
                      <div key={`group-member-row-${entry.userId}`} className="flex items-center justify-between gap-3 border border-slate-200 rounded px-3 py-2">
                        <div className="text-sm text-slate-700">{userLabelById.get(entry.userId) || entry.userId}</div>
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                          <input
                            type="checkbox"
                            checked={entry.canWrite}
                            onChange={(event) =>
                              setGroupMemberRows((prev) =>
                                prev.map((row) =>
                                  row.userId === entry.userId ? { ...row, canWrite: event.target.checked } : row
                                )
                              )
                            }
                            disabled={groupMembersSaving}
                          />
                          Schreibrecht
                        </label>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void saveGroupMembers()}
                    disabled={groupMembersSaving}
                  >
                    {groupMembersSaving ? 'Speichere…' : 'Gruppenmitglieder speichern'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {showOrganizationManagement && (
      <div className="card p-6 space-y-3">
        <h3 className="text-lg font-semibold">Organisationsbaum</h3>
        {roots.roots.length === 0 ? (
          <p className="text-slate-500">Keine Organisationseinheiten vorhanden.</p>
        ) : (
          <ul className="space-y-2">{roots.roots.map((entry) => renderTreeNode(entry))}</ul>
        )}
      </div>
      )}
    </div>
  );
};

export default OrganizationSettings;
