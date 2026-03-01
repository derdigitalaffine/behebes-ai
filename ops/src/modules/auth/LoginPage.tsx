import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../../lib/api';
import type { AuthState } from '../../lib/auth';
import { APP_BUILD_ID, APP_BUILD_TIME, APP_VERSION } from '../../buildInfo';

interface LoginPageProps {
  onLogin: (next: AuthState) => void;
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
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

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [totpCode, setTotpCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const passkeyAvailable = useMemo(() => isPasskeySupported(), []);
  const buildTimeLabel = useMemo(() => {
    const parsed = Date.parse(APP_BUILD_TIME);
    return Number.isNaN(parsed) ? APP_BUILD_TIME : new Date(parsed).toLocaleString('de-DE');
  }, []);

  const commitLogin = (payload: any) => {
    const token = String(payload?.token || '').trim();
    if (!token) throw new Error('Login erfolgreich, aber kein Token erhalten.');
    onLogin({
      isAuthenticated: true,
      token,
      role: (payload?.role || payload?.user?.role || null) as any,
      remember,
      user: payload?.user || null,
    });
  };

  const handlePasswordLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/auth/admin/login', { username, password, remember });
      if (response.data?.mfaRequired === true && response.data?.mfaMethod === 'totp') {
        setMfaToken(String(response.data?.mfaToken || ''));
        return;
      }
      commitLogin(response.data);
    } catch (err: any) {
      setError(String(err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Login fehlgeschlagen'));
    } finally {
      setLoading(false);
    }
  };

  const handleTotpLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mfaToken) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/auth/admin/login/totp', {
        mfaToken,
        code: totpCode,
        remember,
      });
      commitLogin(response.data);
    } catch (err: any) {
      setError(String(err?.response?.data?.message || err?.response?.data?.error || err?.message || 'TOTP-Login fehlgeschlagen'));
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!passkeyAvailable) {
      setError('Passkeys werden von diesem Browser nicht unterstützt.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const optionsResponse = await api.post('/auth/admin/passkeys/authentication/options', {
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

      const verifyResponse = await api.post('/auth/admin/passkeys/authentication/verify', {
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

      commitLogin(verifyResponse.data);
    } catch (err: any) {
      setError(String(err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Passkey-Login fehlgeschlagen'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
        background:
          'radial-gradient(900px 400px at 88% -40px, rgba(153,192,0,.30), transparent 70%), radial-gradient(700px 380px at -20% 10%, rgba(2,132,199,.30), transparent 64%), linear-gradient(145deg,#020617 0%,#0f172a 56%, #1e293b 100%)',
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 430, borderRadius: 5, boxShadow: '0 28px 60px rgba(2,6,23,.5)' }}>
        <CardContent sx={{ p: 3 }}>
          <Stack spacing={2.2}>
            <Stack direction="row" spacing={1.2} alignItems="center">
              <Box component="img" src="/ops/logo.png" alt="behebes" sx={{ width: 70, height: 28, objectFit: 'contain' }} />
              <Stack spacing={0}>
                <Typography variant="h6" fontWeight={800}>Ops Login</Typography>
                <Typography variant="caption" color="text.secondary">Sicherer Zugang für Einsatzteams</Typography>
              </Stack>
            </Stack>

            {error ? <Alert severity="error">{error}</Alert> : null}

            {!mfaToken ? (
              <Box component="form" onSubmit={handlePasswordLogin}>
                <Stack spacing={1.5}>
                  <TextField label="Benutzername" value={username} onChange={(e) => setUsername(e.target.value)} required fullWidth />
                  <TextField label="Passwort" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required fullWidth />
                  <Button type="submit" variant="contained" size="large" color="secondary" disabled={loading}>
                    {loading ? <CircularProgress size={20} /> : 'Anmelden'}
                  </Button>
                </Stack>
              </Box>
            ) : (
              <Box component="form" onSubmit={handleTotpLogin}>
                <Stack spacing={1.5}>
                  <Alert severity="info">TOTP erforderlich. Bitte Code eingeben.</Alert>
                  <TextField label="TOTP-Code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} required fullWidth />
                  <Button type="submit" variant="contained" size="large" color="secondary" disabled={loading}>
                    {loading ? <CircularProgress size={20} /> : 'Code prüfen'}
                  </Button>
                </Stack>
              </Box>
            )}

            <Divider />
            <Button variant="outlined" onClick={handlePasskeyLogin} disabled={loading || !passkeyAvailable}>
              Mit Passkey anmelden
            </Button>
            <Typography variant="caption" color="text.secondary">
              Falls aktiviert, wird TOTP automatisch berücksichtigt.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Version v{APP_VERSION} · Build {APP_BUILD_ID} · {buildTimeLabel}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
