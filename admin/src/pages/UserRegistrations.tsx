import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

interface UserRegistrationsProps {
  token: string;
}

type RegistrationStatus =
  | 'pending_email_verification'
  | 'email_verified'
  | 'pending_review'
  | 'approved'
  | 'rejected';

interface RegistrationRequest {
  id: string;
  emailOriginal: string;
  emailNormalized: string;
  tenantId: string;
  tenantName: string;
  status: RegistrationStatus;
  workflowState: string;
  firstName: string;
  lastName: string;
  username: string;
  requestedOrgUnitIds: string[];
  reviewNote: string;
  reviewedAt: string | null;
  approvedUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface TenantOption {
  id: string;
  name: string;
}

interface OrgUnitOption {
  id: string;
  name: string;
  path: string;
}

interface DecisionDraft {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  orgUnitIds: string[];
  note: string;
}

const normalize = (value: unknown): string => String(value || '').trim();

const statusLabel = (status: RegistrationStatus): string => {
  if (status === 'pending_email_verification') return 'DOI ausstehend';
  if (status === 'email_verified') return 'Formular offen';
  if (status === 'pending_review') return 'Zur Freigabe';
  if (status === 'approved') return 'Freigeschaltet';
  return 'Abgelehnt';
};

const statusBadgeClass = (status: RegistrationStatus): string => {
  if (status === 'approved') return 'bg-green-100 text-green-700';
  if (status === 'rejected') return 'bg-red-100 text-red-700';
  if (status === 'pending_review') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-200 text-slate-700';
};

const UserRegistrations: React.FC<UserRegistrationsProps> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [statusFilter, setStatusFilter] = useState<'pending_review' | 'all' | RegistrationStatus>('pending_review');
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');
  const [selectedId, setSelectedId] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<RegistrationRequest | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [availableOrgUnits, setAvailableOrgUnits] = useState<OrgUnitOption[]>([]);
  const [draft, setDraft] = useState<DecisionDraft>({
    email: '',
    username: '',
    firstName: '',
    lastName: '',
    tenantId: '',
    orgUnitIds: [],
    note: '',
  });

  const loadTenants = async () => {
    const response = await axios.get('/api/admin/tenants', { headers });
    const list: TenantOption[] = Array.isArray(response.data)
      ? response.data
          .map((entry: any) => ({
            id: normalize(entry?.id),
            name: normalize(entry?.name) || normalize(entry?.slug) || normalize(entry?.id),
          }))
          .filter((entry) => !!entry.id)
      : [];
    setTenants(list);
  };

  const loadRequests = async (preserveSelected = true) => {
    setLoading(true);
    try {
      const response = await axios.get('/api/auth/admin/register/requests', {
        headers,
        params: {
          status: statusFilter,
          limit: 300,
        },
      });
      const list: RegistrationRequest[] = Array.isArray(response.data?.requests)
        ? response.data.requests.map((entry: any) => ({
            id: normalize(entry?.id),
            emailOriginal: normalize(entry?.emailOriginal),
            emailNormalized: normalize(entry?.emailNormalized),
            tenantId: normalize(entry?.tenantId),
            tenantName: normalize(entry?.tenantName),
            status: (normalize(entry?.status) as RegistrationStatus) || 'pending_review',
            workflowState: normalize(entry?.workflowState),
            firstName: normalize(entry?.firstName),
            lastName: normalize(entry?.lastName),
            username: normalize(entry?.username),
            requestedOrgUnitIds: Array.isArray(entry?.requestedOrgUnitIds)
              ? entry.requestedOrgUnitIds.map((id: any) => normalize(id)).filter(Boolean)
              : [],
            reviewNote: normalize(entry?.reviewNote),
            reviewedAt: normalize(entry?.reviewedAt) || null,
            approvedUserId: normalize(entry?.approvedUserId) || null,
            createdAt: normalize(entry?.createdAt) || null,
            updatedAt: normalize(entry?.updatedAt) || null,
          }))
        : [];
      setRequests(list);
      if (list.length === 0) {
        setSelectedId('');
        return;
      }
      if (preserveSelected && selectedId && list.some((entry) => entry.id === selectedId)) {
        return;
      }
      setSelectedId(list[0].id);
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Registrierungsanfragen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  const loadOrgUnitsForTenant = async (tenantId: string) => {
    const normalizedTenantId = normalize(tenantId);
    if (!normalizedTenantId) {
      setAvailableOrgUnits([]);
      return;
    }
    const response = await axios.get(`/api/admin/tenants/${normalizedTenantId}/org-units`, {
      headers,
      params: { includeInactive: false },
    });
    const list: OrgUnitOption[] = Array.isArray(response.data)
      ? response.data
          .map((entry: any) => ({
            id: normalize(entry?.id),
            name: normalize(entry?.name),
            path: normalize(entry?.name),
          }))
          .filter((entry) => !!entry.id)
      : [];
    list.sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name, 'de', { sensitivity: 'base' }));
    setAvailableOrgUnits(list);
  };

  const loadDetail = async (registrationId: string) => {
    const normalizedId = normalize(registrationId);
    if (!normalizedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const response = await axios.get(`/api/auth/admin/register/requests/${normalizedId}`, { headers });
      const request = response.data?.request || null;
      if (!request) {
        setDetail(null);
        return;
      }
      const nextDetail: RegistrationRequest = {
        id: normalize(request.id),
        emailOriginal: normalize(request.emailOriginal),
        emailNormalized: normalize(request.emailNormalized),
        tenantId: normalize(request.tenantId),
        tenantName: normalize(request.tenantName),
        status: (normalize(request.status) as RegistrationStatus) || 'pending_review',
        workflowState: normalize(request.workflowState),
        firstName: normalize(request.firstName),
        lastName: normalize(request.lastName),
        username: normalize(request.username),
        requestedOrgUnitIds: Array.isArray(response.data?.requestedOrgUnitIds)
          ? response.data.requestedOrgUnitIds.map((id: any) => normalize(id)).filter(Boolean)
          : Array.isArray(request.requestedOrgUnitIds)
          ? request.requestedOrgUnitIds.map((id: any) => normalize(id)).filter(Boolean)
          : [],
        reviewNote: normalize(request.reviewNote),
        reviewedAt: normalize(request.reviewedAt) || null,
        approvedUserId: normalize(request.approvedUserId) || null,
        createdAt: normalize(request.createdAt) || null,
        updatedAt: normalize(request.updatedAt) || null,
      };
      const detailOrgUnits: OrgUnitOption[] = Array.isArray(response.data?.availableOrgUnits)
        ? response.data.availableOrgUnits
            .map((entry: any) => ({
              id: normalize(entry?.id),
              name: normalize(entry?.name),
              path: normalize(entry?.path) || normalize(entry?.name),
            }))
            .filter((entry: OrgUnitOption) => !!entry.id)
        : [];
      detailOrgUnits.sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name, 'de', { sensitivity: 'base' }));
      setAvailableOrgUnits(detailOrgUnits);
      setDetail(nextDetail);
      setDraft({
        email: nextDetail.emailOriginal || nextDetail.emailNormalized,
        username: nextDetail.username,
        firstName: nextDetail.firstName,
        lastName: nextDetail.lastName,
        tenantId: nextDetail.tenantId,
        orgUnitIds: nextDetail.requestedOrgUnitIds,
        note: nextDetail.reviewNote || '',
      });
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Registrierungsdetail konnte nicht geladen werden.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadTenants(), loadRequests(false)]);
  }, [token]);

  useEffect(() => {
    void loadRequests(false);
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId);
  }, [selectedId]);

  const handleApprove = async () => {
    if (!detail?.id) return;
    setSaving(true);
    setMessage('');
    setMessageType('');
    try {
      await axios.post(
        `/api/auth/admin/register/requests/${detail.id}/decision`,
        {
          action: 'approve',
          email: draft.email,
          username: draft.username,
          firstName: draft.firstName,
          lastName: draft.lastName,
          tenantId: draft.tenantId,
          orgUnitIds: draft.orgUnitIds,
          note: draft.note,
        },
        { headers }
      );
      setMessageType('success');
      setMessage('Registrierung freigeschaltet.');
      await loadRequests();
      await loadDetail(detail.id);
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Freischaltung fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!detail?.id) return;
    setSaving(true);
    setMessage('');
    setMessageType('');
    try {
      await axios.post(
        `/api/auth/admin/register/requests/${detail.id}/decision`,
        {
          action: 'reject',
          note: draft.note,
        },
        { headers }
      );
      setMessageType('success');
      setMessage('Registrierung abgelehnt.');
      await loadRequests();
      await loadDetail(detail.id);
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Ablehnung fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const detailReadonly = !detail || detail.status !== 'pending_review' || saving;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-semibold">Benutzer-Registrierungen</h2>
        <div className="flex items-center gap-2">
          <select
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter((event.target.value || 'pending_review') as any)}
          >
            <option value="pending_review">Nur Freigabe</option>
            <option value="all">Alle</option>
            <option value="pending_email_verification">DOI ausstehend</option>
            <option value="email_verified">Formular offen</option>
            <option value="approved">Freigeschaltet</option>
            <option value="rejected">Abgelehnt</option>
          </select>
          <button className="btn btn-secondary" onClick={() => void loadRequests(false)} disabled={loading || saving}>
            <i className="fa-solid fa-rotate" /> Neu laden
          </button>
        </div>
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card p-6 space-y-4">
          <h3 className="text-lg font-semibold">Anfragen</h3>
          {loading ? (
            <p className="text-slate-500">Lade Registrierungen...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2">E-Mail</th>
                    <th className="py-2">Mandant</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Aktualisiert</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((entry) => (
                    <tr
                      key={entry.id}
                      className={`border-t border-slate-200 cursor-pointer ${
                        selectedId === entry.id ? 'bg-slate-50' : ''
                      }`}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <td className="py-2">
                        <div className="font-semibold">{entry.emailOriginal || entry.emailNormalized}</div>
                        <div className="text-xs text-slate-500">{[entry.firstName, entry.lastName].filter(Boolean).join(' ') || '–'}</div>
                      </td>
                      <td className="py-2 text-slate-600">{entry.tenantName || entry.tenantId || '–'}</td>
                      <td className="py-2">
                        <span className={`badge ${statusBadgeClass(entry.status)}`}>{statusLabel(entry.status)}</span>
                      </td>
                      <td className="py-2 text-slate-600">
                        {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString('de-DE') : '–'}
                      </td>
                    </tr>
                  ))}
                  {requests.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-slate-500">
                        Keine Registrierungen gefunden.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card p-6 space-y-4">
          <h3 className="text-lg font-semibold">Prüfung & Freischaltung</h3>
          {!selectedId ? (
            <p className="text-slate-500">Bitte links eine Registrierung wählen.</p>
          ) : detailLoading ? (
            <p className="text-slate-500">Lade Detailansicht...</p>
          ) : !detail ? (
            <p className="text-slate-500">Detail konnte nicht geladen werden.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">E-Mail</label>
                  <input
                    className="input"
                    value={draft.email}
                    onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))}
                    disabled={detailReadonly}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Benutzername</label>
                  <input
                    className="input"
                    value={draft.username}
                    onChange={(event) => setDraft((prev) => ({ ...prev, username: event.target.value }))}
                    disabled={detailReadonly}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Vorname</label>
                  <input
                    className="input"
                    value={draft.firstName}
                    onChange={(event) => setDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                    disabled={detailReadonly}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Nachname</label>
                  <input
                    className="input"
                    value={draft.lastName}
                    onChange={(event) => setDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                    disabled={detailReadonly}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Mandant</label>
                  <select
                    className="input"
                    value={draft.tenantId}
                    onChange={(event) => {
                      const tenantId = event.target.value;
                      setDraft((prev) => ({ ...prev, tenantId, orgUnitIds: [] }));
                      void loadOrgUnitsForTenant(tenantId);
                    }}
                    disabled={detailReadonly}
                  >
                    <option value="">Mandant wählen</option>
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Status</label>
                  <div className="h-10 flex items-center">
                    <span className={`badge ${statusBadgeClass(detail.status)}`}>{statusLabel(detail.status)}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Organisationseinheiten</label>
                <select
                  className="input min-h-[180px]"
                  multiple
                  value={draft.orgUnitIds}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      orgUnitIds: Array.from(event.target.selectedOptions)
                        .map((option) => normalize(option.value))
                        .filter(Boolean),
                    }))
                  }
                  disabled={detailReadonly}
                >
                  {availableOrgUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.path || unit.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">Mehrfachauswahl mit Strg/Cmd oder Shift.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Notiz</label>
                <textarea
                  className="input min-h-[120px]"
                  value={draft.note}
                  onChange={(event) => setDraft((prev) => ({ ...prev, note: event.target.value }))}
                  disabled={saving}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary" onClick={() => void handleApprove()} disabled={detailReadonly}>
                  <i className="fa-solid fa-user-check" /> Freischalten
                </button>
                <button className="btn btn-danger" onClick={() => void handleReject()} disabled={saving || !detail || detail.status !== 'pending_review'}>
                  <i className="fa-solid fa-user-xmark" /> Ablehnen
                </button>
              </div>

              {(detail.reviewedAt || detail.approvedUserId) && (
                <div className="text-xs text-slate-500 border-t border-slate-200 pt-3">
                  {detail.reviewedAt && <div>Geprüft am: {new Date(detail.reviewedAt).toLocaleString('de-DE')}</div>}
                  {detail.approvedUserId && <div>Freigeschaltetes Benutzerkonto: {detail.approvedUserId}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserRegistrations;
