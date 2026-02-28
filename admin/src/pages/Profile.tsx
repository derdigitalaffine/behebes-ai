import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';
import './Profile.css';

interface ProfileProps {
  token: string;
  onProfileUpdate?: (user: { id?: string; username?: string; role?: string }) => void;
}

interface ProfileData {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  workPhone?: string;
  role: string;
  createdAt?: string;
  updatedAt?: string;
}

interface NotificationPreferenceItem {
  eventType: string;
  label: string;
  description: string;
  roleScope: 'all' | 'admin' | 'staff';
  channel?: 'email' | 'messenger' | 'general';
  enabled: boolean;
  configured: boolean;
}

interface SecurityPasskey {
  id: string;
  label: string;
  createdAt?: string;
  lastUsedAt?: string | null;
  transports: string[];
}

interface TotpSetupPayload {
  setupToken: string;
  secret: string;
  issuer: string;
  accountName: string;
  otpAuthUrl: string;
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const raw = window.atob(padded);
  const output = new Uint8Array(raw.length);
  for (let idx = 0; idx < raw.length; idx += 1) {
    output[idx] = raw.charCodeAt(idx);
  }
  return output;
}

function arrayBufferToBase64Url(input: ArrayBuffer | null): string {
  if (!input) return '';
  const bytes = new Uint8Array(input);
  let binary = '';
  for (let idx = 0; idx < bytes.length; idx += 1) {
    binary += String.fromCharCode(bytes[idx]);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function passkeySupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials;
}

function buildQrCodeImageUrl(value: string, size = 220, provider: 'quickchart' | 'qrserver' = 'quickchart'): string {
  const payload = encodeURIComponent(String(value || ''));
  if (provider === 'qrserver') {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&ecc=M&data=${payload}`;
  }
  return `https://quickchart.io/qr?size=${size}x${size}&ecLevel=M&margin=1&text=${payload}`;
}

const Profile: React.FC<ProfileProps> = ({ token, onProfileUpdate }) => {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [form, setForm] = useState({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    workPhone: '',
  });
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferenceItem[]>([]);
  const [savingNotificationPrefs, setSavingNotificationPrefs] = useState(false);
  const [passkeys, setPasskeys] = useState<SecurityPasskey[]>([]);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [passkeyLabel, setPasskeyLabel] = useState('');
  const [savingPasskey, setSavingPasskey] = useState(false);
  const [revokingPasskeyId, setRevokingPasskeyId] = useState('');
  const [totpSetup, setTotpSetup] = useState<TotpSetupPayload | null>(null);
  const [totpSetupCode, setTotpSetupCode] = useState('');
  const [totpDisableCode, setTotpDisableCode] = useState('');
  const [totpQrProvider, setTotpQrProvider] = useState<'quickchart' | 'qrserver'>('quickchart');
  const [savingTotp, setSavingTotp] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);
        const headers = { Authorization: `Bearer ${token}` };
        const [response, prefsResponse, securityResponse] = await Promise.all([
          axios.get('/api/admin/me', { headers }),
          axios.get('/api/admin/me/notification-preferences', { headers }),
          axios.get('/api/admin/me/security', { headers }),
        ]);
        const data = response.data as ProfileData;
        setProfile(data);
        setForm({
          username: data.username || '',
          email: data.email || '',
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          jobTitle: data.jobTitle || '',
          workPhone: data.workPhone || '',
        });

        setNotificationPrefs(Array.isArray(prefsResponse.data?.items) ? prefsResponse.data.items : []);
        setTotpEnabled(securityResponse.data?.totpEnabled === true);
        setPasskeys(
          Array.isArray(securityResponse.data?.passkeys)
            ? securityResponse.data.passkeys.map((entry: any) => ({
                id: String(entry?.id || ''),
                label: String(entry?.label || ''),
                createdAt: entry?.createdAt,
                lastUsedAt: entry?.lastUsedAt,
                transports: Array.isArray(entry?.transports)
                  ? entry.transports.map((value: any) => String(value || '')).filter(Boolean)
                  : [],
              }))
            : []
        );
      } catch (error: any) {
        setMessageType('error');
        setMessage(error?.response?.data?.message || 'Profil konnte nicht geladen werden');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [token]);

  const handleProfileSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setSavingProfile(true);
      setMessage('');
      const response = await axios.patch(
        '/api/admin/me',
        {
          username: form.username,
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
          jobTitle: form.jobTitle,
          workPhone: form.workPhone,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const user = response.data?.user as ProfileData;
      if (user) {
        setProfile(user);
        setForm({
          username: user.username || '',
          email: user.email || '',
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          jobTitle: user.jobTitle || '',
          workPhone: user.workPhone || '',
        });
        onProfileUpdate?.({ id: user.id, username: user.username, role: user.role });
      }
      setMessageType('success');
      setMessage(response.data?.message || 'Profil aktualisiert');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Profil konnte nicht gespeichert werden');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');

    if (newPassword.length < 8) {
      setMessageType('error');
      setMessage('Neues Passwort muss mindestens 8 Zeichen lang sein');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessageType('error');
      setMessage('Neue Passwörter stimmen nicht überein');
      return;
    }

    try {
      setSavingPassword(true);
      const response = await axios.post(
        '/api/admin/me/password',
        { oldPassword, newPassword },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessageType('success');
      setMessage(response.data?.message || 'Passwort aktualisiert');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Passwort konnte nicht geändert werden');
    } finally {
      setSavingPassword(false);
    }
  };

  const toggleNotificationPreference = (eventType: string, enabled: boolean) => {
    setNotificationPrefs((current) =>
      current.map((entry) =>
        entry.eventType === eventType
          ? {
              ...entry,
              enabled,
            }
          : entry
      )
    );
  };

  const handleSaveNotificationPreferences = async () => {
    try {
      setSavingNotificationPrefs(true);
      const payload = notificationPrefs.map((entry) => ({
        eventType: entry.eventType,
        enabled: entry.enabled === true,
      }));
      const response = await axios.patch(
        '/api/admin/me/notification-preferences',
        { items: payload },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setNotificationPrefs(Array.isArray(response.data?.items) ? response.data.items : notificationPrefs);
      setMessageType('success');
      setMessage(response.data?.message || 'Benachrichtigungseinstellungen gespeichert');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Benachrichtigungseinstellungen konnten nicht gespeichert werden');
    } finally {
      setSavingNotificationPrefs(false);
    }
  };

  const refreshSecurity = async () => {
    const response = await axios.get('/api/admin/me/security', {
      headers: { Authorization: `Bearer ${token}` },
    });
    setTotpEnabled(response.data?.totpEnabled === true);
    setPasskeys(
      Array.isArray(response.data?.passkeys)
        ? response.data.passkeys.map((entry: any) => ({
            id: String(entry?.id || ''),
            label: String(entry?.label || ''),
            createdAt: entry?.createdAt,
            lastUsedAt: entry?.lastUsedAt,
            transports: Array.isArray(entry?.transports)
              ? entry.transports.map((value: any) => String(value || '')).filter(Boolean)
              : [],
          }))
        : []
    );
  };

  const handleRegisterPasskey = async () => {
    if (!passkeySupported()) {
      setMessageType('error');
      setMessage('Passkeys werden von diesem Browser nicht unterstützt.');
      return;
    }

    try {
      setSavingPasskey(true);
      setMessage('');
      const optionsResponse = await axios.post(
        '/api/admin/me/passkeys/registration/options',
        { label: passkeyLabel.trim() || undefined },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const challengeId = String(optionsResponse.data?.challengeId || '').trim();
      const publicKey = optionsResponse.data?.publicKey || {};
      if (!challengeId || !publicKey?.challenge || !publicKey?.user?.id) {
        throw new Error('Ungültige Passkey-Optionen erhalten.');
      }

      const createOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64UrlToUint8Array(String(publicKey.challenge)),
        rp: {
          name: String(publicKey.rp?.name || 'behebes.AI Admin'),
          id: typeof publicKey.rp?.id === 'string' ? publicKey.rp.id : undefined,
        },
        user: {
          id: base64UrlToUint8Array(String(publicKey.user.id)),
          name: String(publicKey.user.name || 'admin'),
          displayName: String(publicKey.user.displayName || publicKey.user.name || 'Admin'),
        },
        pubKeyCredParams: Array.isArray(publicKey.pubKeyCredParams)
          ? publicKey.pubKeyCredParams
              .map((entry: any) => ({
                type: entry?.type === 'public-key' ? 'public-key' : 'public-key',
                alg: Number(entry?.alg),
              }))
              .filter((entry) => Number.isFinite(entry.alg))
          : [{ type: 'public-key', alg: -7 }],
        timeout: typeof publicKey.timeout === 'number' ? publicKey.timeout : 60000,
        attestation: 'none',
        authenticatorSelection: {
          residentKey:
            publicKey.authenticatorSelection?.residentKey === 'required' ||
            publicKey.authenticatorSelection?.residentKey === 'discouraged'
              ? publicKey.authenticatorSelection.residentKey
              : 'preferred',
          userVerification:
            publicKey.authenticatorSelection?.userVerification === 'required' ||
            publicKey.authenticatorSelection?.userVerification === 'discouraged'
              ? publicKey.authenticatorSelection.userVerification
              : 'preferred',
        },
        excludeCredentials: Array.isArray(publicKey.excludeCredentials)
          ? publicKey.excludeCredentials
              .map((entry: any) => {
                const id = String(entry?.id || '').trim();
                if (!id) return null;
                const transports = Array.isArray(entry?.transports)
                  ? entry.transports.filter((value: unknown) => typeof value === 'string')
                  : undefined;
                return {
                  type: 'public-key' as PublicKeyCredentialType,
                  id: base64UrlToUint8Array(id),
                  transports,
                };
              })
              .filter(Boolean) as PublicKeyCredentialDescriptor[]
          : undefined,
      };

      const credential = (await navigator.credentials.create({
        publicKey: createOptions,
      })) as PublicKeyCredential | null;
      if (!credential) {
        throw new Error('Passkey-Registrierung wurde abgebrochen.');
      }
      const response = credential.response as AuthenticatorAttestationResponse;
      const getPublicKey = typeof response.getPublicKey === 'function' ? response.getPublicKey() : null;
      const getPublicKeyAlgorithm =
        typeof response.getPublicKeyAlgorithm === 'function' ? response.getPublicKeyAlgorithm() : -7;
      const getTransports = typeof response.getTransports === 'function' ? response.getTransports() : [];
      if (!getPublicKey) {
        throw new Error('Dieser Browser liefert den Passkey-Public-Key nicht für die Registrierung.');
      }

      await axios.post(
        '/api/admin/me/passkeys/registration/verify',
        {
          challengeId,
          label: passkeyLabel.trim() || undefined,
          credential: {
            id: credential.id,
            rawId: arrayBufferToBase64Url(credential.rawId),
            type: credential.type,
            response: {
              clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
              attestationObject: arrayBufferToBase64Url(response.attestationObject),
              publicKey: arrayBufferToBase64Url(getPublicKey),
              publicKeyAlgorithm: Number.isFinite(getPublicKeyAlgorithm) ? getPublicKeyAlgorithm : -7,
              transports: Array.isArray(getTransports) ? getTransports : [],
            },
          },
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      await refreshSecurity();
      setPasskeyLabel('');
      setMessageType('success');
      setMessage('Passkey erfolgreich registriert.');
    } catch (error: any) {
      if (error?.name === 'NotAllowedError') {
        setMessageType('error');
        setMessage('Passkey-Registrierung wurde abgebrochen oder ist abgelaufen.');
      } else {
        setMessageType('error');
        setMessage(error?.response?.data?.message || error?.message || 'Passkey konnte nicht registriert werden');
      }
    } finally {
      setSavingPasskey(false);
    }
  };

  const handleRevokePasskey = async (passkeyId: string) => {
    try {
      setRevokingPasskeyId(passkeyId);
      await axios.delete(`/api/admin/me/passkeys/${encodeURIComponent(passkeyId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshSecurity();
      setMessageType('success');
      setMessage('Passkey widerrufen.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'Passkey konnte nicht widerrufen werden');
    } finally {
      setRevokingPasskeyId('');
    }
  };

  const handleStartTotpSetup = async () => {
    try {
      setSavingTotp(true);
      setMessage('');
      const response = await axios.post(
        '/api/admin/me/security/totp/setup',
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTotpSetup({
        setupToken: String(response.data?.setupToken || ''),
        secret: String(response.data?.secret || ''),
        issuer: String(response.data?.issuer || 'behebes.AI'),
        accountName: String(response.data?.accountName || profile?.username || 'admin'),
        otpAuthUrl: String(response.data?.otpAuthUrl || ''),
      });
      setTotpSetupCode('');
      setMessageType('success');
      setMessage('TOTP-Setup erzeugt. Bitte Code aus der Authenticator-App bestätigen.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'TOTP-Setup konnte nicht gestartet werden');
    } finally {
      setSavingTotp(false);
    }
  };

  const handleEnableTotp = async () => {
    if (!totpSetup?.setupToken) {
      setMessageType('error');
      setMessage('Kein TOTP-Setup vorhanden.');
      return;
    }
    try {
      setSavingTotp(true);
      await axios.post(
        '/api/admin/me/security/totp/enable',
        {
          setupToken: totpSetup.setupToken,
          code: totpSetupCode,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTotpSetup(null);
      setTotpSetupCode('');
      await refreshSecurity();
      setMessageType('success');
      setMessage('TOTP wurde aktiviert.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'TOTP konnte nicht aktiviert werden');
    } finally {
      setSavingTotp(false);
    }
  };

  const handleDisableTotp = async () => {
    try {
      setSavingTotp(true);
      await axios.post(
        '/api/admin/me/security/totp/disable',
        { code: totpDisableCode },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTotpDisableCode('');
      setTotpSetup(null);
      await refreshSecurity();
      setMessageType('success');
      setMessage('TOTP wurde deaktiviert.');
    } catch (error: any) {
      setMessageType('error');
      setMessage(error?.response?.data?.message || 'TOTP konnte nicht deaktiviert werden');
    } finally {
      setSavingTotp(false);
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return '–';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '–';
    return parsed.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  useEffect(() => {
    setTotpQrProvider('quickchart');
  }, [totpSetup?.otpAuthUrl]);

  const totpQrUrl = useMemo(() => {
    const otpAuthUrl = String(totpSetup?.otpAuthUrl || '').trim();
    if (!otpAuthUrl) return '';
    return buildQrCodeImageUrl(otpAuthUrl, 220, totpQrProvider);
  }, [totpQrProvider, totpSetup?.otpAuthUrl]);

  const profileDisplayName = useMemo(() => {
    const full = `${form.firstName || ''} ${form.lastName || ''}`.trim();
    return full || form.username || 'Profil';
  }, [form.firstName, form.lastName, form.username]);

  const profileBadges = useMemo(
    () => [
      {
        id: 'role',
        label: `Rolle: ${profile?.role || '–'}`,
        tone: 'info' as const,
      },
      {
        id: '2fa',
        label: totpEnabled ? '2FA aktiv' : '2FA optional',
        tone: totpEnabled ? ('success' as const) : ('warning' as const),
      },
    ],
    [profile?.role, totpEnabled]
  );

  const profileKpis = useMemo(
    () => [
      {
        id: 'account',
        label: 'Konto',
        value: profileDisplayName,
        hint: form.email || 'Keine E-Mail',
        tone: 'info' as const,
      },
      {
        id: 'passkeys',
        label: 'Passkeys',
        value: passkeys.length,
        hint: passkeys.length > 0 ? 'Geräte registriert' : 'Noch keine Geräte',
        tone: passkeys.length > 0 ? ('success' as const) : ('warning' as const),
      },
      {
        id: 'totp',
        label: 'TOTP',
        value: totpEnabled ? 'Aktiv' : 'Inaktiv',
        hint: totpEnabled ? 'Schutzstufe erhöht' : 'Kann optional aktiviert werden',
        tone: totpEnabled ? ('success' as const) : ('default' as const),
      },
      {
        id: 'updated',
        label: 'Letzte Änderung',
        value: formatDate(profile?.updatedAt),
        hint: `Erstellt: ${formatDate(profile?.createdAt)}`,
        tone: 'default' as const,
      },
    ],
    [form.email, passkeys.length, profile?.createdAt, profile?.updatedAt, profileDisplayName, totpEnabled]
  );

  if (loading) {
    return (
      <div className="profile-loading">
        <i className="fa-solid fa-spinner fa-spin" /> Lade Profil…
      </div>
    );
  }

  const messengerNotificationPrefs = notificationPrefs.filter((entry) => entry.channel === 'messenger');
  const otherNotificationPrefs = notificationPrefs.filter((entry) => entry.channel !== 'messenger');

  return (
    <div className="profile-page">
      <AdminPageHero
        title="Mein Profil"
        subtitle="Persönliche Daten, Passwort, Passkeys, TOTP und Benachrichtigungen zentral verwalten."
        icon={<i className="fa-solid fa-id-card" />}
        badges={profileBadges}
      />

      {message && (
        <div className={`message-banner ${messageType === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {message}
        </div>
      )}

      <AdminKpiStrip items={profileKpis} />

      <div className="profile-grid">
        <AdminSurfaceCard
          className="profile-card"
          title="Profil bearbeiten"
          subtitle="Stammdaten und Kontaktinformationen dieses Accounts."
        >
          <form onSubmit={handleProfileSubmit} className="profile-form">
            <label>
              Benutzername
              <input
                className="input"
                value={form.username}
                onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                required
              />
            </label>

            <label>
              E-Mail
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                required
              />
            </label>

            <label>
              Vorname
              <input
                className="input"
                value={form.firstName}
                onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
              />
            </label>

            <label>
              Nachname
              <input
                className="input"
                value={form.lastName}
                onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
              />
            </label>

            <label>
              Amtsbezeichnung
              <input
                className="input"
                value={form.jobTitle}
                onChange={(e) => setForm((prev) => ({ ...prev, jobTitle: e.target.value }))}
              />
            </label>

            <label>
              Tel. dienstlich
              <input
                className="input"
                value={form.workPhone}
                onChange={(e) => setForm((prev) => ({ ...prev, workPhone: e.target.value }))}
              />
            </label>

            <div className="profile-meta">
              <div>
                <span>Rolle</span>
                <strong>{profile?.role || '–'}</strong>
              </div>
              <div>
                <span>Erstellt</span>
                <strong>{formatDate(profile?.createdAt)}</strong>
              </div>
              <div>
                <span>Geändert</span>
                <strong>{formatDate(profile?.updatedAt)}</strong>
              </div>
            </div>

            <button className="btn btn-primary" disabled={savingProfile} type="submit">
              {savingProfile ? 'Speichere…' : 'Profil speichern'}
            </button>
          </form>
        </AdminSurfaceCard>

        <AdminSurfaceCard
          className="profile-card"
          title="Passwort ändern"
          subtitle="Legen Sie ein neues Passwort für die klassische Anmeldung fest."
        >
          <form onSubmit={handlePasswordSubmit} className="profile-form">
            <label>
              Aktuelles Passwort
              <input
                className="input"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
              />
            </label>

            <label>
              Neues Passwort
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>

            <label>
              Neues Passwort bestätigen
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>

            <button className="btn btn-primary" disabled={savingPassword} type="submit">
              {savingPassword ? 'Aktualisiere…' : 'Passwort aktualisieren'}
            </button>
          </form>
        </AdminSurfaceCard>

        <AdminSurfaceCard
          className="profile-card"
          title="Sicherheit"
          subtitle="Passkeys und optionales TOTP für dieses Benutzerprofil."
        >
          <div className="profile-form">
            <div className="profile-security-block">
              <h3>Passkeys</h3>
              <p className="profile-security-hint">
                Verwenden Sie biometrische Anmeldung oder Geräteschutz statt Passwort.
              </p>
              <label>
                Anzeigename (optional)
                <input
                  className="input"
                  value={passkeyLabel}
                  onChange={(event) => setPasskeyLabel(event.target.value)}
                  placeholder="z. B. Windows Laptop"
                  maxLength={100}
                />
              </label>
              <button
                className="btn btn-primary"
                type="button"
                disabled={savingPasskey || !passkeySupported()}
                onClick={handleRegisterPasskey}
                title={
                  passkeySupported()
                    ? 'Neuen Passkey registrieren'
                    : 'Passkeys werden von diesem Browser nicht unterstützt'
                }
              >
                {savingPasskey ? 'Registriere…' : 'Passkey hinzufügen'}
              </button>
              {!passkeySupported() && (
                <small className="profile-security-hint">
                  Dieser Browser unterstützt keine Passkey-Registrierung.
                </small>
              )}
              {passkeys.length === 0 ? (
                <p className="profile-security-empty">Noch kein Passkey registriert.</p>
              ) : (
                <div className="profile-passkey-list">
                  {passkeys.map((entry) => (
                    <div key={entry.id} className="profile-passkey-item">
                      <div>
                        <strong>{entry.label || 'Passkey'}</strong>
                        <small>
                          Erstellt: {formatDate(entry.createdAt)} · Zuletzt genutzt: {formatDate(entry.lastUsedAt || undefined)}
                        </small>
                      </div>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={revokingPasskeyId === entry.id}
                        onClick={() => void handleRevokePasskey(entry.id)}
                      >
                        {revokingPasskeyId === entry.id ? 'Widerrufe…' : 'Widerrufen'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="profile-security-block">
              <h3>TOTP</h3>
              <p className="profile-security-hint">
                Optionaler zweiter Faktor mit Authenticator-App.
              </p>
              {totpEnabled ? (
                <div className="profile-totp-enabled">
                  <strong>TOTP ist aktiviert.</strong>
                  <label>
                    Code zur Deaktivierung
                    <input
                      className="input"
                      value={totpDisableCode}
                      onChange={(event) => setTotpDisableCode(event.target.value.replace(/[^\d]/g, '').slice(0, 8))}
                      placeholder="123456"
                      autoComplete="one-time-code"
                    />
                  </label>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={savingTotp || !totpDisableCode}
                    onClick={handleDisableTotp}
                  >
                    {savingTotp ? 'Deaktiviere…' : 'TOTP deaktivieren'}
                  </button>
                </div>
              ) : totpSetup ? (
                <div className="profile-totp-setup">
                  <small>
                    Konto: {totpSetup.issuer} / {totpSetup.accountName}
                  </small>
                  {totpQrUrl && (
                    <div className="profile-totp-qr-wrap">
                      <img
                        src={totpQrUrl}
                        alt="TOTP QR-Code"
                        className="profile-totp-qr"
                        onError={() => {
                          if (totpQrProvider !== 'qrserver') {
                            setTotpQrProvider('qrserver');
                          }
                        }}
                      />
                    </div>
                  )}
                  <label>
                    TOTP-Secret
                    <input className="input" value={totpSetup.secret} readOnly />
                  </label>
                  <label>
                    OTPAuth-URL
                    <input className="input" value={totpSetup.otpAuthUrl} readOnly />
                  </label>
                  <label>
                    Bestätigungscode
                    <input
                      className="input"
                      value={totpSetupCode}
                      onChange={(event) => setTotpSetupCode(event.target.value.replace(/[^\d]/g, '').slice(0, 8))}
                      placeholder="123456"
                      autoComplete="one-time-code"
                    />
                  </label>
                  <div className="profile-inline-actions">
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={savingTotp || !totpSetupCode}
                      onClick={handleEnableTotp}
                    >
                      {savingTotp ? 'Aktiviere…' : 'TOTP aktivieren'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={savingTotp}
                      onClick={() => {
                        setTotpSetup(null);
                        setTotpSetupCode('');
                      }}
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-primary" type="button" disabled={savingTotp} onClick={handleStartTotpSetup}>
                  {savingTotp ? 'Erzeuge…' : 'TOTP einrichten'}
                </button>
              )}
            </div>
          </div>
        </AdminSurfaceCard>

        <AdminSurfaceCard
          className="profile-card"
          title="Benachrichtigungen"
          subtitle="Legen Sie fest, welche Ereignisse per Teamchat-Systemuser und/oder per E-Mail gemeldet werden."
        >
          <div className="profile-form">
            {notificationPrefs.length === 0 ? (
              <p>Keine Benachrichtigungsereignisse verfügbar.</p>
            ) : (
              <>
                {messengerNotificationPrefs.length > 0 ? (
                  <>
                    <h3>Teamchat-Systemuser</h3>
                    {messengerNotificationPrefs.map((entry) => (
                      <label key={entry.eventType}>
                        <div className="profile-pref-head">
                          <input
                            type="checkbox"
                            checked={entry.enabled === true}
                            onChange={(event) => toggleNotificationPreference(entry.eventType, event.target.checked)}
                          />
                          <strong>{entry.label}</strong>
                        </div>
                        <small>{entry.description}</small>
                      </label>
                    ))}
                  </>
                ) : null}

                {otherNotificationPrefs.length > 0 ? (
                  <>
                    <h3>E-Mail und weitere Hinweise</h3>
                    {otherNotificationPrefs.map((entry) => (
                      <label key={entry.eventType}>
                        <div className="profile-pref-head">
                          <input
                            type="checkbox"
                            checked={entry.enabled === true}
                            onChange={(event) => toggleNotificationPreference(entry.eventType, event.target.checked)}
                          />
                          <strong>{entry.label}</strong>
                        </div>
                        <small>{entry.description}</small>
                      </label>
                    ))}
                  </>
                ) : null}
              </>
            )}

            <button
              className="btn btn-primary"
              disabled={savingNotificationPrefs}
              type="button"
              onClick={handleSaveNotificationPreferences}
            >
              {savingNotificationPrefs ? 'Speichere…' : 'Benachrichtigungseinstellungen speichern'}
            </button>
          </div>
        </AdminSurfaceCard>
      </div>
    </div>
  );
};

export default Profile;
