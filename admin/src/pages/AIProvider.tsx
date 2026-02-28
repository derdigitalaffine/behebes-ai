import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { getAdminToken } from '../lib/auth';
import { formatLlmTaskLabel } from '../lib/llmTaskLabels';
import SystemPrompts from './SystemPrompts';

type AuthMode = 'api_key' | 'oauth';

interface LlmConnection {
  id: string;
  name: string;
  providerType: 'openai_compatible';
  baseUrl: string;
  authMode: AuthMode;
  apiKey: string;
  oauthTokenId: string;
  enabled: boolean;
  defaultModel: string;
  modelsFetchedAt?: string;
}

interface LlmModel {
  id: string;
  label: string;
  vision: boolean;
  updatedAt?: string;
}

interface LlmTaskRoute {
  connectionId: string;
  modelId: string;
}

interface LlmTaskRouting {
  defaultRoute: LlmTaskRoute;
  routes: Record<string, LlmTaskRoute>;
}

interface LlmTaskMeta {
  taskKey: string;
  requiresVision: boolean;
}

interface LlmTaskRoutingResponse {
  routing: LlmTaskRouting;
  tasks: LlmTaskMeta[];
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const createDraftConnection = (): LlmConnection => ({
  id: '',
  name: '',
  providerType: 'openai_compatible',
  baseUrl: DEFAULT_BASE_URL,
  authMode: 'api_key',
  apiKey: '',
  oauthTokenId: '',
  enabled: true,
  defaultModel: '',
  modelsFetchedAt: '',
});

const AIProvider: React.FC = () => {
  const [tab, setTab] = useState<'connections' | 'routing' | 'prompts'>('connections');
  const [connections, setConnections] = useState<LlmConnection[]>([]);
  const [routing, setRouting] = useState<LlmTaskRouting | null>(null);
  const [tasks, setTasks] = useState<LlmTaskMeta[]>([]);
  const [modelsByConnection, setModelsByConnection] = useState<Record<string, LlmModel[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');
  const [draftConnection, setDraftConnection] = useState<LlmConnection>(createDraftConnection());
  const [editingConnectionId, setEditingConnectionId] = useState('');

  const token = getAdminToken();

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
    }),
    [token]
  );

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessageType(type);
    setMessage(text);
    window.setTimeout(() => setMessage(''), 3000);
  };

  const loadModels = useCallback(
    async (connectionId: string, refresh = false) => {
      const normalized = String(connectionId || '').trim();
      if (!normalized) return;
      try {
        const response = await axios.get(`/api/admin/llm/connections/${encodeURIComponent(normalized)}/models`, {
          headers,
          params: refresh ? { refresh: 'true' } : undefined,
        });
        const models = Array.isArray(response.data?.items) ? response.data.items : [];
        setModelsByConnection((current) => ({ ...current, [normalized]: models }));
      } catch {
        setModelsByConnection((current) => ({ ...current, [normalized]: [] }));
      }
    },
    [headers]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [connectionsRes, routingRes] = await Promise.all([
        axios.get('/api/admin/llm/connections', { headers }),
        axios.get('/api/admin/llm/task-routing', { headers }),
      ]);
      const connectionItems = Array.isArray(connectionsRes.data?.items)
        ? (connectionsRes.data.items as LlmConnection[])
        : [];
      setConnections(connectionItems);

      const routingPayload = routingRes.data as LlmTaskRoutingResponse;
      setRouting(routingPayload.routing || null);
      setTasks(Array.isArray(routingPayload.tasks) ? routingPayload.tasks : []);

      await Promise.all(
        connectionItems
          .slice(0, 6)
          .map((entry) => loadModels(entry.id, false))
      );
    } catch (err: any) {
      showMessage('error', err.response?.data?.message || 'KI-Einstellungen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [headers, loadModels]);

  useEffect(() => {
    if (!token) return;
    void loadData();
  }, [loadData, token]);

  const enabledConnections = useMemo(
    () => connections.filter((connection) => connection.enabled !== false),
    [connections]
  );

  const routeRows = useMemo(() => {
    const sortedTasks = [...tasks].sort((a, b) => {
      if (a.taskKey === 'default') return -1;
      if (b.taskKey === 'default') return 1;
      return a.taskKey.localeCompare(b.taskKey, 'de');
    });

    const allRows = sortedTasks.length > 0 ? sortedTasks : [{ taskKey: 'default', requiresVision: false }];
    return allRows.map((taskMeta) => {
      if (!routing) {
        return {
          ...taskMeta,
          route: { connectionId: '', modelId: '' },
        };
      }
      const route =
        taskMeta.taskKey === 'default'
          ? routing.defaultRoute
          : routing.routes?.[taskMeta.taskKey] || routing.defaultRoute;
      return {
        ...taskMeta,
        route: {
          connectionId: String(route?.connectionId || '').trim(),
          modelId: String(route?.modelId || '').trim(),
        },
      };
    });
  }, [routing, tasks]);

  const updateRoute = (taskKey: string, nextRoute: LlmTaskRoute) => {
    setRouting((current) => {
      if (!current) return current;
      if (taskKey === 'default') {
        return {
          ...current,
          defaultRoute: nextRoute,
        };
      }
      return {
        ...current,
        routes: {
          ...current.routes,
          [taskKey]: nextRoute,
        },
      };
    });
  };

  const saveRouting = async () => {
    if (!routing) return;
    setSaving(true);
    try {
      await axios.patch(
        '/api/admin/llm/task-routing',
        { routing },
        { headers }
      );
      showMessage('success', 'Task-Routing gespeichert.');
      await loadData();
    } catch (err: any) {
      showMessage('error', err.response?.data?.message || 'Task-Routing konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const saveConnection = async () => {
    const payload = {
      ...draftConnection,
      id: String(draftConnection.id || '').trim() || undefined,
      name: String(draftConnection.name || '').trim(),
      baseUrl: String(draftConnection.baseUrl || '').trim() || DEFAULT_BASE_URL,
      defaultModel: String(draftConnection.defaultModel || '').trim(),
    };

    if (!payload.name) {
      showMessage('error', 'Bitte einen Namen für die Verbindung angeben.');
      return;
    }

    setSaving(true);
    try {
      if (editingConnectionId) {
        await axios.patch(
          `/api/admin/llm/connections/${encodeURIComponent(editingConnectionId)}`,
          payload,
          { headers }
        );
      } else {
        await axios.post('/api/admin/llm/connections', payload, { headers });
      }

      setDraftConnection(createDraftConnection());
      setEditingConnectionId('');
      showMessage('success', 'Verbindung gespeichert.');
      await loadData();
    } catch (err: any) {
      showMessage('error', err.response?.data?.message || 'Verbindung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const deleteConnection = async (id: string) => {
    const normalized = String(id || '').trim();
    if (!normalized) return;
    if (!window.confirm('Verbindung wirklich löschen?')) return;

    setSaving(true);
    try {
      await axios.delete(`/api/admin/llm/connections/${encodeURIComponent(normalized)}`, { headers });
      showMessage('success', 'Verbindung gelöscht.');
      if (editingConnectionId === normalized) {
        setDraftConnection(createDraftConnection());
        setEditingConnectionId('');
      }
      await loadData();
    } catch (err: any) {
      showMessage('error', err.response?.data?.message || 'Verbindung konnte nicht gelöscht werden.');
    } finally {
      setSaving(false);
    }
  };

  const editConnection = (connection: LlmConnection) => {
    setDraftConnection({ ...connection });
    setEditingConnectionId(connection.id);
  };

  const resetDraft = () => {
    setDraftConnection(createDraftConnection());
    setEditingConnectionId('');
  };

  if (loading) {
    return <div className="loading">Lädt...</div>;
  }

  return (
    <div>
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>KI-Einstellungen</Typography>
        <Typography variant="body2" sx={{ color: 'var(--admin-text-muted)' }}>
          Zentrale Verwaltung aller OpenAI-kompatiblen LLM-Verbindungen, Aufgabenrouting und Systemprompts.
        </Typography>
      </Stack>

      {message && (
        <Alert severity={messageType === 'error' ? 'error' : 'success'} sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          <Tab value="connections" label="Verbindungen" />
          <Tab value="routing" label="Task-Routing" />
          <Tab value="prompts" label="System-Prompts" />
        </Tabs>
      </Paper>

      {tab === 'connections' && (
        <Stack spacing={2.2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              {editingConnectionId ? 'Verbindung bearbeiten' : 'Neue Verbindung'}
            </Typography>
            <Stack spacing={1.2}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                <TextField
                  label="ID (optional)"
                  value={draftConnection.id}
                  onChange={(event) => setDraftConnection((current) => ({ ...current, id: event.target.value }))}
                  fullWidth
                  helperText="Leer lassen für automatische ID"
                />
                <TextField
                  label="Name"
                  value={draftConnection.name}
                  onChange={(event) => setDraftConnection((current) => ({ ...current, name: event.target.value }))}
                  fullWidth
                />
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                <TextField
                  label="Base URL"
                  value={draftConnection.baseUrl}
                  onChange={(event) => setDraftConnection((current) => ({ ...current, baseUrl: event.target.value }))}
                  fullWidth
                  placeholder="https://api.openai.com/v1"
                />
                <TextField
                  label="Default Modell"
                  value={draftConnection.defaultModel}
                  onChange={(event) =>
                    setDraftConnection((current) => ({ ...current, defaultModel: event.target.value }))
                  }
                  fullWidth
                />
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                <TextField
                  select
                  label="Auth"
                  value={draftConnection.authMode}
                  onChange={(event) =>
                    setDraftConnection((current) => ({ ...current, authMode: event.target.value as AuthMode }))
                  }
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="api_key">API Key</MenuItem>
                  <MenuItem value="oauth">OAuth Token</MenuItem>
                </TextField>

                {draftConnection.authMode === 'api_key' ? (
                  <TextField
                    label="API Key"
                    value={draftConnection.apiKey}
                    onChange={(event) => setDraftConnection((current) => ({ ...current, apiKey: event.target.value }))}
                    fullWidth
                    placeholder="sk-..."
                  />
                ) : (
                  <TextField
                    label="OAuth Token ID"
                    value={draftConnection.oauthTokenId}
                    onChange={(event) =>
                      setDraftConnection((current) => ({ ...current, oauthTokenId: event.target.value }))
                    }
                    fullWidth
                    placeholder="oauth_token_id"
                  />
                )}
              </Stack>

              <FormControlLabel
                control={
                  <Switch
                    checked={draftConnection.enabled !== false}
                    onChange={(event) =>
                      setDraftConnection((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                }
                label="Verbindung aktiv"
              />

              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={saveConnection} disabled={saving}>
                  {editingConnectionId ? 'Speichern' : 'Anlegen'}
                </Button>
                <Button variant="outlined" onClick={resetDraft} disabled={saving}>
                  Zurücksetzen
                </Button>
              </Stack>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Aktive Verbindungen</Typography>
            <Stack spacing={1.2}>
              {connections.length === 0 && (
                <Typography variant="body2" sx={{ color: 'var(--admin-text-muted)' }}>
                  Noch keine Verbindungen vorhanden.
                </Typography>
              )}

              {connections.map((connection) => {
                const models = modelsByConnection[connection.id] || [];
                return (
                  <Paper key={connection.id} variant="outlined" sx={{ p: 1.2 }}>
                    <Stack spacing={0.8}>
                      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
                        <Box>
                          <Typography sx={{ fontWeight: 700 }}>{connection.name}</Typography>
                          <Typography variant="body2" sx={{ color: 'var(--admin-text-muted)' }}>
                            {connection.id} · {connection.baseUrl}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <Chip size="small" label={connection.authMode === 'oauth' ? 'OAuth' : 'API Key'} />
                          <Chip
                            size="small"
                            color={connection.enabled !== false ? 'success' : 'default'}
                            label={connection.enabled !== false ? 'aktiv' : 'inaktiv'}
                          />
                        </Stack>
                      </Stack>

                      <Stack direction="row" spacing={1}>
                        <Button size="small" variant="outlined" onClick={() => editConnection(connection)}>
                          Bearbeiten
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            void loadModels(connection.id, true);
                          }}
                        >
                          Modelle refresh
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => {
                            void deleteConnection(connection.id);
                          }}
                        >
                          Löschen
                        </Button>
                      </Stack>

                      <Typography variant="caption" sx={{ color: 'var(--admin-text-muted)' }}>
                        Modelle: {models.length}
                        {connection.defaultModel ? ` · Default: ${connection.defaultModel}` : ''}
                      </Typography>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          </Paper>
        </Stack>
      )}

      {tab === 'routing' && (
        <Stack spacing={1.6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Task-Routing</Typography>
            <Typography variant="body2" sx={{ color: 'var(--admin-text-muted)', mb: 1.4 }}>
              Für jede Aufgabe kann ein Provider/Modell-Profil gesetzt werden. Vision-Aufgaben zeigen nur passende Modelle.
            </Typography>

            <Stack spacing={1.2}>
              {routeRows.map((entry) => {
                const route = entry.route;
                const connectionId = route.connectionId;
                const models = modelsByConnection[connectionId] || [];
                const filteredModels = entry.requiresVision ? models.filter((model) => model.vision) : models;
                return (
                  <Paper key={entry.taskKey} variant="outlined" sx={{ p: 1.1 }}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
                      <Box sx={{ minWidth: 210 }}>
                        <Typography sx={{ fontWeight: 700 }}>
                          {formatLlmTaskLabel(entry.taskKey)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'var(--admin-text-muted)' }}>
                          {entry.taskKey}
                          {entry.requiresVision ? ' · benötigt Vision-Modell' : ''}
                        </Typography>
                      </Box>

                      <TextField
                        select
                        size="small"
                        label="Verbindung"
                        value={route.connectionId}
                        onChange={(event) => {
                          const nextConnectionId = event.target.value;
                          updateRoute(entry.taskKey, {
                            connectionId: nextConnectionId,
                            modelId: '',
                          });
                          if (nextConnectionId) {
                            void loadModels(nextConnectionId, false);
                          }
                        }}
                        sx={{ minWidth: 260 }}
                      >
                        <MenuItem value="">Nicht gesetzt</MenuItem>
                        {enabledConnections.map((connection) => (
                          <MenuItem key={connection.id} value={connection.id}>
                            {connection.name}
                          </MenuItem>
                        ))}
                      </TextField>

                      <TextField
                        select
                        size="small"
                        label="Modell"
                        value={route.modelId}
                        onChange={(event) => {
                          updateRoute(entry.taskKey, {
                            ...route,
                            modelId: event.target.value,
                          });
                        }}
                        sx={{ minWidth: 300 }}
                      >
                        <MenuItem value="">Default / automatisch</MenuItem>
                        {filteredModels.map((model) => (
                          <MenuItem key={model.id} value={model.id}>
                            {model.label || model.id}
                          </MenuItem>
                        ))}
                      </TextField>

                      {route.connectionId && (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            void loadModels(route.connectionId, true);
                          }}
                        >
                          Modelle refresh
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>

            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button variant="contained" onClick={saveRouting} disabled={saving}>
                Routing speichern
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  void loadData();
                }}
                disabled={saving}
              >
                Neu laden
              </Button>
            </Stack>
          </Paper>
        </Stack>
      )}

      {tab === 'prompts' && <SystemPrompts />}
    </div>
  );
};

export default AIProvider;
