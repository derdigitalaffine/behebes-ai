import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import SendToMobileIcon from '@mui/icons-material/SendToMobile';
import { api, buildAuthHeaders } from '../../lib/api';
import type { AdminScopeSelection } from '../../lib/scope';
import { ensureAdminPushSubscription, revokeAdminPushSubscription } from '../pwa/push';

interface ProfilePageProps {
  token: string;
  scope: AdminScopeSelection;
}

interface NotificationPreferenceItem {
  eventType: string;
  label: string;
  description: string;
  enabled: boolean;
}

const OPS_PUSH_EVENT_TYPES = [
  'push_ticket_events',
  'push_messenger_messages',
  'push_internal_tasks',
  'push_workflow_sla_overdue',
] as const;

export default function ProfilePage({ token, scope }: ProfilePageProps) {
  const headers = useMemo(() => buildAuthHeaders(token, scope), [scope, token]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [pushPreferenceMap, setPushPreferenceMap] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const profileQuery = useQuery({
    queryKey: ['ops-profile'],
    queryFn: async () => {
      const response = await api.get('/admin/me', { headers });
      return response.data;
    },
    staleTime: 120_000,
  });

  const pushConfigQuery = useQuery({
    queryKey: ['ops-push-config'],
    queryFn: async () => {
      const response = await api.get('/admin/push/public-key', { headers });
      return response.data;
    },
    staleTime: 120_000,
  });

  const notificationPrefsQuery = useQuery({
    queryKey: ['ops-notification-preferences'],
    queryFn: async () => {
      const response = await api.get('/admin/me/notification-preferences', { headers });
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      return items as NotificationPreferenceItem[];
    },
    staleTime: 120_000,
  });

  React.useEffect(() => {
    const items = notificationPrefsQuery.data || [];
    const nextMap: Record<string, boolean> = {};
    for (const eventType of OPS_PUSH_EVENT_TYPES) {
      const found = items.find((entry) => String(entry?.eventType || '') === eventType);
      nextMap[eventType] = found?.enabled !== false;
    }
    setPushPreferenceMap(nextMap);
  }, [notificationPrefsQuery.data]);

  const handleTogglePush = async (_event: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (checked) {
        const ok = await ensureAdminPushSubscription(token, scope);
        if (!ok) {
          setError('Push ist serverseitig deaktiviert oder im Browser nicht verfügbar.');
          setPushEnabled(false);
          return;
        }
        setPushEnabled(true);
        setMessage('Push-Benachrichtigungen aktiviert.');
      } else {
        await revokeAdminPushSubscription(token, scope);
        setPushEnabled(false);
        setMessage('Push-Benachrichtigungen deaktiviert.');
      }
    } catch (err: any) {
      setError(String(err?.response?.data?.message || err?.message || 'Push-Einstellung konnte nicht gespeichert werden.'));
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePushPreference = (eventType: string, enabled: boolean) => {
    setPushPreferenceMap((prev) => ({ ...prev, [eventType]: enabled }));
  };

  const handleSavePushPreferences = async () => {
    setPrefsBusy(true);
    setMessage('');
    setError('');
    try {
      const items = OPS_PUSH_EVENT_TYPES.map((eventType) => ({
        eventType,
        enabled: pushPreferenceMap[eventType] !== false,
      }));
      await api.patch('/admin/me/notification-preferences', { items }, { headers });
      await notificationPrefsQuery.refetch();
      setMessage('Push-Kategorien gespeichert.');
    } catch (err: any) {
      setError(
        String(
          err?.response?.data?.message ||
            err?.message ||
            'Push-Kategorien konnten nicht gespeichert werden.'
        )
      );
    } finally {
      setPrefsBusy(false);
    }
  };

  const handlePushTest = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await api.post(
        '/admin/push/test',
        {
          title: 'Ops Push Test',
          body: 'Diese Testnachricht wurde erfolgreich ausgelöst.',
          url: '/ops/dashboard',
        },
        { headers }
      );
      setMessage(`Test ausgelöst (attempted: ${response.data?.attempted || 0}, success: ${response.data?.succeeded || 0}).`);
    } catch (err: any) {
      setError(String(err?.response?.data?.message || err?.message || 'Push-Test fehlgeschlagen'));
    } finally {
      setBusy(false);
    }
  };

  if (profileQuery.isLoading) {
    return (
      <Box sx={{ p: 3, display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return <Alert severity="error">Profil konnte nicht geladen werden.</Alert>;
  }

  const profile = profileQuery.data;
  const pushAvailable = pushConfigQuery.data?.available === true;
  const pushPreferenceItems = OPS_PUSH_EVENT_TYPES.map((eventType) => {
    const metadata =
      (notificationPrefsQuery.data || []).find((entry) => String(entry?.eventType || '') === eventType) ||
      ({
        eventType,
        label: eventType,
        description: '',
        enabled: true,
      } as NotificationPreferenceItem);
    return {
      ...metadata,
      enabled: pushPreferenceMap[eventType] !== false,
    };
  });

  return (
    <Stack spacing={2.2} className="ops-page-shell">
      <Card>
        <CardContent sx={{ p: { xs: 1.8, md: 2.2 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} justifyContent="space-between">
            <Box>
              <Typography variant="h5">Profil</Typography>
              <Typography variant="body2" color="text.secondary">
                Persönliche Daten und Push-Benachrichtigungen für die Ops-App.
              </Typography>
            </Box>
            <Chip color="secondary" label={profile.role || 'Rolle'} />
          </Stack>
        </CardContent>
      </Card>

      {message ? <Alert severity="success">{message}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography fontWeight={800}>{profile.username}</Typography>
            <Typography variant="body2" color="text.secondary">
              {profile.email || 'Keine E-Mail hinterlegt'}
            </Typography>
            <Typography variant="body2">
              Name: {[profile.firstName, profile.lastName].filter(Boolean).join(' ') || '–'}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1.3}>
            <Stack direction="row" spacing={0.9} alignItems="center">
              <NotificationsActiveIcon fontSize="small" />
              <Typography variant="h6">PWA Push</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Verfügbarkeit: {pushAvailable ? 'aktiv' : 'deaktiviert'}
            </Typography>
            <Divider />
            <FormControlLabel
              control={<Switch checked={pushEnabled} onChange={handleTogglePush} disabled={busy || !pushAvailable} />}
              label="Push-Benachrichtigungen aktivieren"
            />
            <Button
              variant="contained"
              color="secondary"
              startIcon={<SendToMobileIcon />}
              onClick={handlePushTest}
              disabled={busy || !pushAvailable}
            >
              Test-Push senden
            </Button>
            <Divider />
            <Typography variant="subtitle1" fontWeight={700}>
              Push-Kategorien (Ops)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Steuert, welche Ereignisse als Push in der Ops-App angezeigt werden.
            </Typography>
            <Stack spacing={0.5}>
              {pushPreferenceItems.map((entry) => (
                <FormControlLabel
                  key={entry.eventType}
                  control={
                    <Switch
                      checked={entry.enabled}
                      onChange={(event) =>
                        handleTogglePushPreference(entry.eventType, event.target.checked)
                      }
                      disabled={prefsBusy || !pushAvailable || notificationPrefsQuery.isLoading}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" fontWeight={600}>
                        {entry.label}
                      </Typography>
                      {entry.description ? (
                        <Typography variant="caption" color="text.secondary">
                          {entry.description}
                        </Typography>
                      ) : null}
                    </Box>
                  }
                />
              ))}
            </Stack>
            <Button
              variant="outlined"
              onClick={handleSavePushPreferences}
              disabled={prefsBusy || !pushAvailable || notificationPrefsQuery.isLoading}
            >
              {prefsBusy ? 'Speichert…' : 'Push-Kategorien speichern'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
