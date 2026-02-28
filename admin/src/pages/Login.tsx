import React, { useState, FormEvent, useEffect } from 'react';
import axios from 'axios';
import AdminFooter from '../components/AdminFooter';
import './Login.css';

interface LoginProps {
  onLogin: (
    token: string,
    role: string,
    remember: boolean,
    user?: { id?: string; username?: string; role?: string }
  ) => void;
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

function isPasskeySupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials;
}

interface LoginPoem {
  title: string;
  lines: string[];
  generatedAt: string;
  refreshAvailableAt: string;
  nextAutomaticRefreshAt: string;
  canRequestManualRefresh: boolean;
  source?: 'ai' | 'fallback';
}

interface RegistrationOrgUnitOption {
  id: string;
  name: string;
  path: string;
}

type RegistrationFlowStatus =
  | 'idle'
  | 'email_sent'
  | 'profile'
  | 'pending_review'
  | 'approved'
  | 'rejected';

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const fallbackPoemLines = [
    'Wenn Akten sprechen, muss ein Herz noch hören,',
    'damit aus Regeln wieder Wege werden.',
    'Ein Amt ist stark, wenn es im Leisen dient,',
    'wenn Antwort schneller kommt als Zweifel wächst.',
    'Bürgerfreundlichkeit ist Pflicht und Würde zugleich:',
    'den Menschen sehen, bevor man Fälle zählt.',
  ];

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [remember, setRemember] = useState(true);
  const [mode, setMode] = useState<'login' | 'request' | 'reset' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [registrationConfigIssue, setRegistrationConfigIssue] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerToken, setRegisterToken] = useState('');
  const [registerTenantName, setRegisterTenantName] = useState('');
  const [registerFirstName, setRegisterFirstName] = useState('');
  const [registerLastName, setRegisterLastName] = useState('');
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [registerOrgUnits, setRegisterOrgUnits] = useState<RegistrationOrgUnitOption[]>([]);
  const [registerOrgUnitIds, setRegisterOrgUnitIds] = useState<string[]>([]);
  const [registerFlowStatus, setRegisterFlowStatus] = useState<RegistrationFlowStatus>('idle');
  const [registerReviewNote, setRegisterReviewNote] = useState('');
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);
  const [healthStatus, setHealthStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [healthTimestamp, setHealthTimestamp] = useState('');
  const [poem, setPoem] = useState<LoginPoem | null>(null);
  const [poemLoading, setPoemLoading] = useState(true);
  const [poemRefreshing, setPoemRefreshing] = useState(false);
  const [poemError, setPoemError] = useState('');
  const [poemDraftTitle, setPoemDraftTitle] = useState('Verwaltung auf Lachspur');
  const [poemDraftHumorStyle, setPoemDraftHumorStyle] = useState<'trocken' | 'absurd' | 'satirisch'>('trocken');
  const [poemDraftSignatureWord, setPoemDraftSignatureWord] = useState('');
  const [poemDraftLocationHint, setPoemDraftLocationHint] = useState('');
  const [poemDraftChaosLevel, setPoemDraftChaosLevel] = useState(4);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const handleModeSwitch = (nextMode: 'login' | 'request' | 'reset' | 'register') => {
    setMode(nextMode);
    setError('');
    setSuccess('');
    setCapsLockOn(false);
    if (nextMode !== 'login') {
      setMfaToken('');
      setTotpCode('');
    }
  };

  const handlePasswordKeyboardState = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof event.getModifierState === 'function') {
      setCapsLockOn(event.getModifierState('CapsLock'));
    }
  };

  const normalize = (value: unknown): string => String(value || '').trim();

  const applyRegistrationVerificationPayload = (payload: any, fallbackToken: string) => {
    const status = normalize(payload?.status).toLowerCase();
    const registration = payload?.registration || {};
    const orgUnits: RegistrationOrgUnitOption[] = Array.isArray(payload?.orgUnits)
      ? payload.orgUnits
          .map((entry: any) => ({
            id: normalize(entry?.id),
            name: normalize(entry?.name),
            path: normalize(entry?.path) || normalize(entry?.name),
          }))
          .filter((entry: RegistrationOrgUnitOption) => !!entry.id)
      : [];

    setRegisterToken(normalize(payload?.registrationToken || fallbackToken));
    setRegisterEmail(normalize(registration?.email || registerEmail));
    setRegisterTenantName(normalize(registration?.tenantName));
    setRegisterFirstName(normalize(registration?.firstName));
    setRegisterLastName(normalize(registration?.lastName));
    setRegisterUsername(normalize(registration?.username));
    setRegisterOrgUnits(orgUnits);
    setRegisterOrgUnitIds([]);
    setRegisterReviewNote('');

    if (status === 'pending_review') {
      setRegisterFlowStatus('pending_review');
      return;
    }
    if (status === 'approved') {
      setRegisterFlowStatus('approved');
      return;
    }
    if (status === 'rejected') {
      setRegisterFlowStatus('rejected');
      return;
    }
    setRegisterFlowStatus('profile');
  };

  const handleVerifyRegistrationToken = async (tokenInput?: string, silent = false) => {
    const tokenValue = normalize(tokenInput || registerToken);
    if (!tokenValue) {
      if (!silent) setError('Bitte einen Registrierungs-Token angeben.');
      return;
    }

    setIsLoading(true);
    if (!silent) {
      setError('');
      setSuccess('');
    }
    try {
      const response = await axios.post('/api/auth/admin/register/verify-email', { token: tokenValue });
      applyRegistrationVerificationPayload(response.data, tokenValue);
      if (!silent) {
        setSuccess('E-Mail bestätigt. Bitte Profildaten ausfüllen.');
      }
    } catch (err) {
      if (!silent) {
        if (axios.isAxiosError(err)) {
          setError(err.response?.data?.message || 'Token-Prüfung fehlgeschlagen');
        } else {
          setError('Ein Fehler ist aufgetreten');
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const registerTokenParam = params.get('registerToken');
    if (registerTokenParam) {
      setRegisterToken(registerTokenParam);
      handleModeSwitch('register');
      setRegisterFlowStatus('email_sent');
      void handleVerifyRegistrationToken(registerTokenParam, true);
      return;
    }
    const tokenParam = params.get('resetToken') || params.get('token');
    if (tokenParam) {
      setResetToken(tokenParam);
      handleModeSwitch('reset');
    }
  }, []);

  useEffect(() => {
    const loadRegistrationConfig = async () => {
      try {
        const response = await axios.get('/api/auth/admin/register/config');
        setRegistrationEnabled(response.data?.enabled === true);
        const issues = Array.isArray(response.data?.configurationIssues)
          ? response.data.configurationIssues.map((entry: any) => normalize(entry)).filter(Boolean)
          : [];
        setRegistrationConfigIssue(issues.join(' '));
      } catch {
        setRegistrationEnabled(false);
        setRegistrationConfigIssue('');
      }
    };

    void loadRegistrationConfig();
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
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchPoem = async () => {
      try {
        setPoemLoading(true);
        const response = await axios.get('/api/auth/admin/login-poem');
        setPoem(response.data || null);
        setPoemError('');
      } catch (err: any) {
        setPoemError(err?.response?.data?.message || 'Gedicht konnte nicht geladen werden');
      } finally {
        setPoemLoading(false);
      }
    };

    fetchPoem();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await axios.post('/api/auth/admin/login', { username, password, remember });
      if (response.data?.mfaRequired === true && response.data?.mfaMethod === 'totp') {
        const tokenValue = String(response.data?.mfaToken || '').trim();
        if (!tokenValue) {
          setError('MFA-Token fehlt in der Serverantwort.');
          return;
        }
        setMfaToken(tokenValue);
        setTotpCode('');
        setSuccess('Bitte geben Sie den TOTP-Code aus Ihrer Authenticator-App ein.');
        return;
      }
      const role = response.data?.role || response.data?.user?.role || null;
      onLogin(response.data.token, role, remember, response.data?.user);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || err.response?.data?.error || 'Login fehlgeschlagen');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitTotp = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await axios.post('/api/auth/admin/login/totp', {
        mfaToken,
        code: totpCode,
      });
      const role = response.data?.role || response.data?.user?.role || null;
      onLogin(response.data.token, role, remember, response.data?.user);
      setMfaToken('');
      setTotpCode('');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const retryToken = String(err.response?.data?.mfaToken || '').trim();
        if (retryToken) {
          setMfaToken(retryToken);
        }
        setError(err.response?.data?.message || err.response?.data?.error || 'TOTP-Login fehlgeschlagen');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!isPasskeySupported()) {
      setError('Passkeys werden von diesem Browser nicht unterstützt.');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const optionsResponse = await axios.post('/api/auth/admin/passkeys/authentication/options', {
        username: username.trim() || undefined,
        remember,
      });
      const challengeId = String(optionsResponse.data?.challengeId || '').trim();
      const publicKey = optionsResponse.data?.publicKey || {};
      if (!challengeId || !publicKey?.challenge) {
        throw new Error('Ungültige Passkey-Optionen vom Server.');
      }

      const requestOptions: PublicKeyCredentialRequestOptions = {
        challenge: base64UrlToUint8Array(String(publicKey.challenge)),
        rpId: typeof publicKey.rpId === 'string' ? publicKey.rpId : undefined,
        timeout: typeof publicKey.timeout === 'number' ? publicKey.timeout : 60000,
        userVerification:
          publicKey.userVerification === 'required' ||
          publicKey.userVerification === 'discouraged' ||
          publicKey.userVerification === 'preferred'
            ? publicKey.userVerification
            : 'preferred',
        allowCredentials: Array.isArray(publicKey.allowCredentials)
          ? publicKey.allowCredentials
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

      const credential = (await navigator.credentials.get({
        publicKey: requestOptions,
      })) as PublicKeyCredential | null;
      if (!credential) {
        throw new Error('Passkey-Anmeldung wurde abgebrochen.');
      }
      const assertion = credential.response as AuthenticatorAssertionResponse;

      const verifyResponse = await axios.post('/api/auth/admin/passkeys/authentication/verify', {
        challengeId,
        credential: {
          id: credential.id,
          rawId: arrayBufferToBase64Url(credential.rawId),
          type: credential.type,
          response: {
            clientDataJSON: arrayBufferToBase64Url(assertion.clientDataJSON),
            authenticatorData: arrayBufferToBase64Url(assertion.authenticatorData),
            signature: arrayBufferToBase64Url(assertion.signature),
            userHandle: arrayBufferToBase64Url(assertion.userHandle),
          },
        },
      });

      const role = verifyResponse.data?.role || verifyResponse.data?.user?.role || null;
      onLogin(verifyResponse.data.token, role, remember, verifyResponse.data?.user);
      setMfaToken('');
      setTotpCode('');
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') {
        setError('Passkey-Anmeldung wurde abgebrochen oder ist abgelaufen.');
      } else if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || err.response?.data?.error || 'Passkey-Login fehlgeschlagen');
      } else {
        setError(err?.message || 'Passkey-Login fehlgeschlagen');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestReset = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      await axios.post('/api/auth/admin/forgot', { identifier });
      setSuccess('Wenn ein Konto existiert, wurde eine E-Mail versendet.');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Versenden der E-Mail');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    if (!newPassword || newPassword.length < 6) {
      setError('Passwort muss mindestens 6 Zeichen lang sein');
      setIsLoading(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwörter stimmen nicht überein');
      setIsLoading(false);
      return;
    }

    try {
      await axios.post('/api/auth/admin/reset', { token: resetToken, newPassword });
      setSuccess('Passwort aktualisiert. Bitte melden Sie sich an.');
      handleModeSwitch('login');
      setNewPassword('');
      setConfirmPassword('');
      window.history.replaceState({}, '', window.location.pathname);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Fehler beim Zurücksetzen des Passworts');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestRegistrationEmail = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await axios.post('/api/auth/admin/register/request-email', {
        email: registerEmail,
      });
      setRegisterFlowStatus('email_sent');
      setSuccess(
        response.data?.message ||
          'Bitte bestätigen Sie Ihre E-Mail-Adresse über den Link in der E-Mail.'
      );
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Registrierungslink konnte nicht angefordert werden.');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteRegistrationProfile = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    if (!registerPassword || registerPassword.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen lang sein');
      setIsLoading(false);
      return;
    }
    if (registerPassword !== registerConfirmPassword) {
      setError('Passwörter stimmen nicht überein');
      setIsLoading(false);
      return;
    }
    if (registerOrgUnitIds.length === 0) {
      setError('Bitte mindestens eine Organisationseinheit wählen.');
      setIsLoading(false);
      return;
    }

    try {
      const response = await axios.post('/api/auth/admin/register/complete-profile', {
        token: registerToken,
        firstName: registerFirstName,
        lastName: registerLastName,
        username: registerUsername,
        password: registerPassword,
        orgUnitIds: registerOrgUnitIds,
      });
      setRegisterFlowStatus('pending_review');
      setRegisterPassword('');
      setRegisterConfirmPassword('');
      setSuccess(response.data?.message || 'Registrierung eingereicht. Ein Admin prüft Ihre Angaben.');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Registrierung konnte nicht eingereicht werden.');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckRegistrationStatus = async () => {
    const tokenValue = normalize(registerToken);
    if (!tokenValue) {
      setError('Kein Registrierungs-Token vorhanden.');
      return;
    }
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await axios.post('/api/auth/admin/register/status', {
        token: tokenValue,
      });
      const status = normalize(response.data?.status).toLowerCase();
      const note = normalize(response.data?.reviewNote);
      setRegisterReviewNote(note);
      if (status === 'approved') {
        setRegisterFlowStatus('approved');
        setSuccess('Registrierung wurde freigeschaltet.');
      } else if (status === 'rejected') {
        setRegisterFlowStatus('rejected');
        setSuccess('Registrierung wurde abgelehnt.');
      } else if (status === 'pending_review') {
        setRegisterFlowStatus('pending_review');
        setSuccess('Registrierung ist weiterhin in Prüfung.');
      } else {
        setSuccess('Registrierungsstatus aktualisiert.');
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Status konnte nicht geladen werden.');
      } else {
        setError('Ein Fehler ist aufgetreten');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshPoem = async () => {
    const title = poemDraftTitle.trim();
    if (!title) {
      setPoemError('Bitte einen Titel für das Gedicht angeben.');
      return;
    }
    try {
      setPoemRefreshing(true);
      const response = await axios.post('/api/auth/admin/login-poem/refresh', {
        title,
        humorStyle: poemDraftHumorStyle,
        signatureWord: poemDraftSignatureWord.trim(),
        locationHint: poemDraftLocationHint.trim(),
        chaosLevel: poemDraftChaosLevel,
      });
      setPoem(response.data || null);
      setPoemError('');
    } catch (err: any) {
      setPoemError(err?.response?.data?.message || 'Neues Gedicht konnte nicht erstellt werden');
      if (err?.response?.data?.poem) {
        setPoem(err.response.data.poem);
      }
    } finally {
      setPoemRefreshing(false);
    }
  };

  const formatDate = (value?: string, withTime = false) => {
    if (!value) return '–';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '–';
    return parsed.toLocaleString(
      'de-DE',
      withTime
        ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: '2-digit', month: '2-digit', year: 'numeric' }
    );
  };

  const healthStatusLabel =
    healthStatus === 'ok' ? 'Backend online' : healthStatus === 'loading' ? 'Backend wird geprüft' : 'Backend gestört';
  const displayedPoemLines = poem?.lines && poem.lines.length > 0 ? poem.lines : fallbackPoemLines;

  return (
    <div className="login-container">
      <div className="login-shell">
        <aside className="login-intro" aria-label="Portal-Informationen">
          <div className="login-brand">
            <img src="/logo.png" alt="Verbandsgemeinde Otterbach-Otterberg" className="login-logo" />
            <div>
              <p className="login-kicker">behebes.AI</p>
              <h1>Admin Portal</h1>
              <p className="login-subtitle">Verbandsgemeinde Otterbach-Otterberg</p>
            </div>
          </div>

          <p className="login-intro-text">
            Steuern Sie Ticketbearbeitung, Workflows, Benachrichtigungen und Systemeinstellungen über einen zentralen,
            sicheren Arbeitsbereich.
          </p>

          <div className="login-trust-list" aria-label="Sicherheitsmerkmale">
            <div className="trust-item">
              <i className="fa-solid fa-shield-check" aria-hidden="true" />
              <span>Anmeldeversuche werden begrenzt und protokolliert.</span>
            </div>
            <div className="trust-item">
              <i className="fa-solid fa-fingerprint" aria-hidden="true" />
              <span>Sitzungen sind nutzerbezogen und serverseitig nachvollziehbar.</span>
            </div>
          </div>

          <div className={`login-health login-health-${healthStatus}`}>
            <span className="health-dot" />
            <span>{healthStatusLabel}</span>
            <span className="health-time">
              {healthTimestamp
                ? new Date(healthTimestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                : '–'}
            </span>
          </div>

          <div className="login-poem">
            <div className="login-poem-header">
              <h2>
                <i className="fa-solid fa-feather-pointed" aria-hidden="true" /> {poem?.title || 'Verpflichtung'}
              </h2>
              <button
                type="button"
                className="login-poem-refresh"
                onClick={handleRefreshPoem}
                disabled={
                  poemRefreshing ||
                  poemLoading ||
                  (poem?.canRequestManualRefresh === false && !!poem?.refreshAvailableAt)
                }
              >
                {poemRefreshing ? 'Erzeuge…' : 'Neues Gedicht'}
              </button>
            </div>
            <div className="login-poem-badges">
              <span className={`login-poem-source ${poem?.source === 'ai' ? 'is-ai' : 'is-fallback'}`}>
                {poem?.source === 'ai' ? 'KI-generiert' : 'Fallback'}
              </span>
              <span className="login-poem-meta">Aktuell seit: {formatDate(poem?.generatedAt)}</span>
              <span className="login-poem-meta">Nächstes Wochen-Update: {formatDate(poem?.nextAutomaticRefreshAt)}</span>
            </div>
            <div className="login-poem-body">
              {displayedPoemLines.map((line, idx) => (
                <p key={`${line}-${idx}`} className="login-poem-line">
                  {line}
                </p>
              ))}
            </div>
            <div className="login-poem-controls">
              <p className="login-poem-controls-title">
                Gedicht beeinflussen
              </p>
              <div className="login-poem-control-grid">
                <label>
                  <span>Titel (Pflicht)</span>
                  <input
                    type="text"
                    value={poemDraftTitle}
                    onChange={(event) => setPoemDraftTitle(event.target.value)}
                    placeholder="Titel für das nächste Gedicht"
                    maxLength={120}
                  />
                </label>
                <label>
                  <span>Humorstil</span>
                  <select
                    value={poemDraftHumorStyle}
                    onChange={(event) =>
                      setPoemDraftHumorStyle(
                        event.target.value === 'absurd' || event.target.value === 'satirisch'
                          ? (event.target.value as 'absurd' | 'satirisch')
                          : 'trocken'
                      )
                    }
                  >
                    <option value="trocken">Trocken</option>
                    <option value="absurd">Absurd</option>
                    <option value="satirisch">Satirisch</option>
                  </select>
                </label>
                <label>
                  <span>Running-Gag</span>
                  <input
                    type="text"
                    value={poemDraftSignatureWord}
                    onChange={(event) => setPoemDraftSignatureWord(event.target.value)}
                    placeholder="z. B. Aktenzeichen 42"
                    maxLength={80}
                  />
                </label>
                <label>
                  <span>Ortsbezug</span>
                  <input
                    type="text"
                    value={poemDraftLocationHint}
                    onChange={(event) => setPoemDraftLocationHint(event.target.value)}
                    placeholder="z. B. Otterberg"
                    maxLength={80}
                  />
                </label>
                <label>
                  <span>Chaos-Level ({poemDraftChaosLevel}/5)</span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={poemDraftChaosLevel}
                    onChange={(event) => setPoemDraftChaosLevel(Number(event.target.value) || 4)}
                  />
                </label>
              </div>
              <p className="login-poem-controls-note">
                USP: Das Gedicht baut automatisch ein Mini-Akrostichon (B-E-H-E) ein.
              </p>
            </div>
            {poemLoading && <p className="login-poem-note">Gedicht wird geladen…</p>}
            {poem?.canRequestManualRefresh === false && (
              <p className="login-poem-note">Neues Gedicht frühestens ab: {formatDate(poem.refreshAvailableAt, true)}</p>
            )}
            {poemError && <p className="login-poem-error">{poemError}</p>}
          </div>
        </aside>

        <section className="login-box" aria-label="Anmeldung">
          <div className="login-box-head">
            <p className="box-kicker">Sicherer Bereich</p>
            <h2>
              {mode === 'login'
                ? 'Anmeldung'
                : mode === 'request'
                ? 'Passwort zurücksetzen'
                : mode === 'reset'
                ? 'Neues Passwort setzen'
                : 'Selbstregistrierung'}
            </h2>
            <p>
              {mode === 'login'
                ? 'Melden Sie sich mit Ihrem Admin-Konto an.'
                : mode === 'request'
                ? 'Fordern Sie einen sicheren Reset-Link per E-Mail an.'
                : mode === 'reset'
                ? 'Setzen Sie ein neues Passwort für Ihren Adminzugang.'
                : 'Registrieren Sie ein neues Konto mit Double-Opt-In und Admin-Freigabe.'}
            </p>
          </div>

          <div className="login-mode-switch" role="tablist" aria-label="Login-Modus">
            <button
              type="button"
              className={`mode-chip ${mode === 'login' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('login')}
              disabled={isLoading}
              role="tab"
              aria-selected={mode === 'login'}
            >
              <i className="fa-solid fa-right-to-bracket" /> Login
            </button>
            <button
              type="button"
              className={`mode-chip ${mode === 'request' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('request')}
              disabled={isLoading}
              role="tab"
              aria-selected={mode === 'request'}
            >
              <i className="fa-solid fa-key" /> Reset-Link
            </button>
            {registrationEnabled && (
              <button
                type="button"
                className={`mode-chip ${mode === 'register' ? 'active' : ''}`}
                onClick={() => handleModeSwitch('register')}
                disabled={isLoading}
                role="tab"
                aria-selected={mode === 'register'}
              >
                <i className="fa-solid fa-user-plus" /> Registrieren
              </button>
            )}
            {mode === 'reset' && (
              <span className="mode-chip active" role="tab" aria-selected="true">
                <i className="fa-solid fa-lock" /> Passwort setzen
              </span>
            )}
          </div>

          {error && (
            <div className="error-message" role="alert" aria-live="assertive">
              {error}
            </div>
          )}
          {success && (
            <div className="success-message" role="status" aria-live="polite">
              {success}
            </div>
          )}

          {mode === 'login' && (
            mfaToken ? (
              <form onSubmit={handleSubmitTotp} className="auth-form">
                <div className="form-group">
                  <label htmlFor="totpCode">TOTP-Code</label>
                  <div className="input-shell">
                    <span className="input-icon" aria-hidden="true">
                      <i className="fa-solid fa-mobile-screen-button" />
                    </span>
                    <input
                      type="text"
                      id="totpCode"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
                      required
                      disabled={isLoading}
                      autoComplete="one-time-code"
                      autoFocus
                    />
                  </div>
                </div>
                <button type="submit" className="btn-primary-auth" disabled={isLoading}>
                  {isLoading ? 'Prüfe…' : 'TOTP bestätigen'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isLoading}
                  onClick={() => {
                    setMfaToken('');
                    setTotpCode('');
                    setSuccess('');
                    setError('');
                  }}
                >
                  Zurück zum Login
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="auth-form">
                <div className="form-group">
                  <label htmlFor="username">Benutzername oder E-Mail</label>
                  <div className="input-shell">
                    <span className="input-icon" aria-hidden="true">
                      <i className="fa-solid fa-user" />
                    </span>
                    <input
                      type="text"
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      disabled={isLoading}
                      autoComplete="username"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="password">Passwort</label>
                  <div className="input-shell">
                    <span className="input-icon" aria-hidden="true">
                      <i className="fa-solid fa-lock" />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={handlePasswordKeyboardState}
                      onKeyUp={handlePasswordKeyboardState}
                      required
                      disabled={isLoading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="input-action"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                      disabled={isLoading}
                    >
                      <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
                    </button>
                  </div>
                  {capsLockOn && <p className="caps-lock-hint">Feststelltaste ist aktiviert.</p>}
                </div>

                <div className="form-row">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      disabled={isLoading}
                    />
                    <span>Angemeldet bleiben</span>
                  </label>
                  <button type="button" className="link-button" onClick={() => handleModeSwitch('request')} disabled={isLoading}>
                    Passwort vergessen?
                  </button>
                  {registrationEnabled && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => handleModeSwitch('register')}
                      disabled={isLoading}
                    >
                      Neues Konto registrieren
                    </button>
                  )}
                </div>

                <button type="submit" className="btn-primary-auth" disabled={isLoading}>
                  {isLoading ? 'Wird angemeldet...' : 'Anmelden'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isLoading || !isPasskeySupported()}
                  onClick={handlePasskeyLogin}
                  title={isPasskeySupported() ? 'Mit Passkey anmelden' : 'Passkeys werden von diesem Browser nicht unterstützt'}
                >
                  <i className="fa-solid fa-fingerprint" /> Mit Passkey anmelden
                </button>
              </form>
            )
          )}

          {mode === 'request' && (
            <form onSubmit={handleRequestReset} className="auth-form">
              <div className="form-group">
                <label htmlFor="identifier">Benutzername oder E-Mail</label>
                <div className="input-shell">
                  <span className="input-icon" aria-hidden="true">
                    <i className="fa-solid fa-envelope" />
                  </span>
                  <input
                    type="text"
                    id="identifier"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    disabled={isLoading}
                    autoComplete="email"
                    autoFocus
                  />
                </div>
              </div>
              <button type="submit" className="btn-primary-auth" disabled={isLoading}>
                {isLoading ? 'Sende...' : 'Reset-Link senden'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => handleModeSwitch('login')} disabled={isLoading}>
                Zurück zum Login
              </button>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleResetPassword} className="auth-form">
              <div className="form-group">
                <label htmlFor="newPassword">Neues Passwort</label>
                <div className="input-shell">
                  <span className="input-icon" aria-hidden="true">
                    <i className="fa-solid fa-key" />
                  </span>
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    onKeyDown={handlePasswordKeyboardState}
                    onKeyUp={handlePasswordKeyboardState}
                    required
                    minLength={6}
                    disabled={isLoading}
                    autoComplete="new-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="input-action"
                    onClick={() => setShowNewPassword((value) => !value)}
                    aria-label={showNewPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                    disabled={isLoading}
                  >
                    <i className={`fa-solid ${showNewPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="confirmPassword">Passwort bestätigen</label>
                <div className="input-shell">
                  <span className="input-icon" aria-hidden="true">
                    <i className="fa-solid fa-check" />
                  </span>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyDown={handlePasswordKeyboardState}
                    onKeyUp={handlePasswordKeyboardState}
                    required
                    minLength={6}
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="input-action"
                    onClick={() => setShowConfirmPassword((value) => !value)}
                    aria-label={showConfirmPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                    disabled={isLoading}
                  >
                    <i className={`fa-solid ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
                  </button>
                </div>
                {capsLockOn && <p className="caps-lock-hint">Feststelltaste ist aktiviert.</p>}
              </div>

              <button type="submit" className="btn-primary-auth" disabled={isLoading}>
                {isLoading ? 'Speichern...' : 'Passwort speichern'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => handleModeSwitch('login')} disabled={isLoading}>
                Zurück zum Login
              </button>
            </form>
          )}

          {mode === 'register' && (
            <div className="auth-form">
              {!registrationEnabled && (
                <div className="error-message" role="alert">
                  Selbstregistrierung ist aktuell nicht aktiv.
                  {registrationConfigIssue ? ` ${registrationConfigIssue}` : ''}
                </div>
              )}

              {registrationEnabled && (registerFlowStatus === 'idle' || registerFlowStatus === 'email_sent') && (
                <>
                  <form onSubmit={handleRequestRegistrationEmail} className="auth-form">
                    <div className="form-group">
                      <label htmlFor="registerEmail">Dienstliche E-Mail</label>
                      <div className="input-shell">
                        <span className="input-icon" aria-hidden="true">
                          <i className="fa-solid fa-envelope" />
                        </span>
                        <input
                          type="email"
                          id="registerEmail"
                          value={registerEmail}
                          onChange={(event) => setRegisterEmail(event.target.value)}
                          required
                          disabled={isLoading}
                          autoComplete="email"
                          autoFocus
                        />
                      </div>
                    </div>
                    <button type="submit" className="btn-primary-auth" disabled={isLoading}>
                      {isLoading ? 'Sende...' : 'Verifizierungslink senden'}
                    </button>
                  </form>

                  <div className="form-group">
                    <label htmlFor="registerToken">Registrierungs-Token (aus E-Mail)</label>
                    <div className="input-shell">
                      <span className="input-icon" aria-hidden="true">
                        <i className="fa-solid fa-link" />
                      </span>
                      <input
                        type="text"
                        id="registerToken"
                        value={registerToken}
                        onChange={(event) => setRegisterToken(event.target.value)}
                        disabled={isLoading}
                        placeholder="Token hier einfügen"
                      />
                    </div>
                    <div className="form-row">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void handleVerifyRegistrationToken()}
                        disabled={isLoading || !registerToken.trim()}
                      >
                        Token prüfen
                      </button>
                    </div>
                  </div>
                </>
              )}

              {registrationEnabled && registerFlowStatus === 'profile' && (
                <form onSubmit={handleCompleteRegistrationProfile} className="auth-form">
                  <p className="text-sm text-slate-600">
                    Mandant: <strong>{registerTenantName || '–'}</strong>
                  </p>
                  <div className="form-group">
                    <label htmlFor="registerFirstName">Vorname</label>
                    <input
                      className="input"
                      id="registerFirstName"
                      value={registerFirstName}
                      onChange={(event) => setRegisterFirstName(event.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="registerLastName">Nachname</label>
                    <input
                      className="input"
                      id="registerLastName"
                      value={registerLastName}
                      onChange={(event) => setRegisterLastName(event.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="registerUsername">Benutzername</label>
                    <input
                      className="input"
                      id="registerUsername"
                      value={registerUsername}
                      onChange={(event) => setRegisterUsername(event.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="registerPassword">Passwort</label>
                    <div className="input-shell">
                      <span className="input-icon" aria-hidden="true">
                        <i className="fa-solid fa-key" />
                      </span>
                      <input
                        type={showRegisterPassword ? 'text' : 'password'}
                        id="registerPassword"
                        value={registerPassword}
                        onChange={(event) => setRegisterPassword(event.target.value)}
                        onKeyDown={handlePasswordKeyboardState}
                        onKeyUp={handlePasswordKeyboardState}
                        minLength={8}
                        required
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        className="input-action"
                        onClick={() => setShowRegisterPassword((value) => !value)}
                        aria-label={showRegisterPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                        disabled={isLoading}
                      >
                        <i className={`fa-solid ${showRegisterPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
                      </button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="registerConfirmPassword">Passwort bestätigen</label>
                    <div className="input-shell">
                      <span className="input-icon" aria-hidden="true">
                        <i className="fa-solid fa-check" />
                      </span>
                      <input
                        type={showRegisterConfirmPassword ? 'text' : 'password'}
                        id="registerConfirmPassword"
                        value={registerConfirmPassword}
                        onChange={(event) => setRegisterConfirmPassword(event.target.value)}
                        onKeyDown={handlePasswordKeyboardState}
                        onKeyUp={handlePasswordKeyboardState}
                        minLength={8}
                        required
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        className="input-action"
                        onClick={() => setShowRegisterConfirmPassword((value) => !value)}
                        aria-label={showRegisterConfirmPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                        disabled={isLoading}
                      >
                        <i className={`fa-solid ${showRegisterConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
                      </button>
                    </div>
                    {capsLockOn && <p className="caps-lock-hint">Feststelltaste ist aktiviert.</p>}
                  </div>
                  <div className="form-group">
                    <label htmlFor="registerOrgUnits">Organisationseinheiten</label>
                    <select
                      id="registerOrgUnits"
                      className="input"
                      multiple
                      value={registerOrgUnitIds}
                      onChange={(event) =>
                        setRegisterOrgUnitIds(
                          Array.from(event.target.selectedOptions)
                            .map((option) => option.value.trim())
                            .filter(Boolean)
                        )
                      }
                      disabled={isLoading}
                      required
                    >
                      {registerOrgUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.path || unit.name}
                        </option>
                      ))}
                    </select>
                    <p className="caps-lock-hint">Mehrfachauswahl mit Strg/Cmd oder Shift.</p>
                  </div>

                  <button type="submit" className="btn-primary-auth" disabled={isLoading}>
                    {isLoading ? 'Sende...' : 'Registrierung einreichen'}
                  </button>
                </form>
              )}

              {registrationEnabled &&
                (registerFlowStatus === 'pending_review' ||
                  registerFlowStatus === 'approved' ||
                  registerFlowStatus === 'rejected') && (
                  <div className="space-y-3">
                    <div
                      className={`${
                        registerFlowStatus === 'approved'
                          ? 'success-message'
                          : registerFlowStatus === 'rejected'
                          ? 'error-message'
                          : 'message-banner bg-amber-100 text-amber-800'
                      }`}
                    >
                      {registerFlowStatus === 'approved'
                        ? 'Registrierung wurde freigeschaltet.'
                        : registerFlowStatus === 'rejected'
                        ? 'Registrierung wurde abgelehnt.'
                        : 'Registrierung wurde eingereicht und wird geprüft.'}
                    </div>
                    {registerReviewNote && <p className="text-sm text-slate-600">Hinweis: {registerReviewNote}</p>}
                    <div className="form-row">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void handleCheckRegistrationStatus()}
                        disabled={isLoading}
                      >
                        Status aktualisieren
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleModeSwitch('login')}
                        disabled={isLoading}
                      >
                        Zum Login
                      </button>
                    </div>
                  </div>
                )}
            </div>
          )}

          <div className="login-assurance" aria-label="Anmeldehinweise">
            <span>
              <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" /> Zeitstempel und Sitzungen werden geprüft.
            </span>
            <span>
              <i className="fa-solid fa-user-lock" aria-hidden="true" /> Nur autorisierte Rollen erhalten Zugang.
            </span>
          </div>
        </section>
      </div>
      <AdminFooter compact />
    </div>
  );
};

export default Login;
