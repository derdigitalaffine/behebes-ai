import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import { Link } from 'react-router-dom';
import { api, buildAuthHeaders } from '../../lib/api';
import { subscribeAdminRealtime } from '../../lib/realtime';
import type { AdminScopeSelection } from '../../lib/scope';

interface DashboardPageProps {
  token: string;
  scope: AdminScopeSelection;
}

const formatDateTime = (value: unknown): string => {
  const normalized = String(value || '').trim();
  if (!normalized) return '–';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function DashboardPage({ token, scope }: DashboardPageProps) {
  const query = useQuery({
    queryKey: ['ops-mobile-dashboard', scope.mode, scope.tenantId],
    queryFn: async () => {
      const response = await api.get('/admin/mobile/dashboard', {
        headers: buildAuthHeaders(token, scope),
        params: {
          timeRange: '7d',
          tenantId: scope.mode === 'tenant' ? scope.tenantId : undefined,
        },
      });
      return response.data;
    },
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const unsubscribe = subscribeAdminRealtime({
      token,
      topics: ['tickets', 'workflows'],
      onUpdate: () => {
        void query.refetch();
      },
    });
    return unsubscribe;
  }, [query, token]);

  if (query.isLoading) {
    return (
      <Box sx={{ p: 3, display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (query.isError) {
    return <Alert severity="error">Dashboard konnte nicht geladen werden.</Alert>;
  }

  const data = query.data || {};
  const me = data?.me || {};
  const team = data?.team || {};
  const recentTickets = Array.isArray(data?.recent?.tickets) ? data.recent.tickets : [];
  const hotspots = Array.isArray(data?.recent?.workflowHotspots) ? data.recent.workflowHotspots : [];
  const tasks = Array.isArray(data?.recent?.tasks) ? data.recent.tasks : [];

  return (
    <Stack spacing={2.2} className="ops-page-shell">
      <Card>
        <CardContent sx={{ p: { xs: 1.8, md: 2.2 } }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.2}
            alignItems={{ xs: 'flex-start', md: 'center' }}
            justifyContent="space-between"
          >
            <Box>
              <Typography variant="h5">Operations Dashboard</Typography>
              <Typography variant="body2" color="text.secondary">
                Fokus auf laufende Arbeit, Engpässe und teamrelevante Ereignisse.
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<RefreshIcon />} onClick={() => void query.refetch()}>
              Aktualisieren
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
          gap: 1.2,
        }}
      >
        {[
          {
            label: 'Meine offenen Tickets',
            value: Number(me.openTickets || 0),
            icon: <ConfirmationNumberIcon fontSize="small" />,
            tone: 'rgba(2,132,199,0.10)',
          },
          {
            label: 'Überfällige Tickets',
            value: Number(me.overdueTickets || 0),
            icon: <NotificationsActiveIcon fontSize="small" />,
            tone: 'rgba(217,119,6,0.14)',
          },
          {
            label: 'Meine Aufgaben',
            value: Number(me.openTasks || 0),
            icon: <TaskAltIcon fontSize="small" />,
            tone: 'rgba(34,197,94,0.14)',
          },
          {
            label: 'Ungelesene Chats',
            value: Number(me.unreadChatCount || 0),
            icon: <MarkChatUnreadIcon fontSize="small" />,
            tone: 'rgba(153,192,0,0.18)',
          },
          {
            label: 'Offene Hinweise',
            value: Number(me.openNotifications || 0),
            icon: <NotificationsActiveIcon fontSize="small" />,
            tone: 'rgba(59,130,246,0.12)',
          },
          {
            label: 'Team offene Tickets',
            value: Number(team.openTickets || 0),
            icon: <GroupWorkIcon fontSize="small" />,
            tone: 'rgba(15,23,42,0.08)',
          },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent sx={{ p: 1.8 }}>
              <Stack spacing={0.8}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    {item.label}
                  </Typography>
                  <Box
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      display: 'grid',
                      placeItems: 'center',
                      background: item.tone,
                    }}
                  >
                    {item.icon}
                  </Box>
                </Stack>
                <Typography variant="h4" fontWeight={800} sx={{ lineHeight: 1 }}>
                  {item.value}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
          gap: 1.2,
        }}
      >
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Letzte Ticketänderungen
            </Typography>
            <List dense disablePadding>
              {recentTickets.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Keine aktuellen Ticketereignisse.
                </Typography>
              ) : (
                recentTickets.map((ticket: any) => (
                  <ListItemButton
                    key={ticket.id}
                    component={Link}
                    to={`/tickets/${encodeURIComponent(ticket.id)}`}
                    sx={{ borderRadius: 2, mb: 0.6 }}
                  >
                    <ListItemText
                      primary={`${ticket.id} · ${ticket.category || 'Unkategorisiert'}`}
                      secondary={`${ticket.status || 'open'} · ${ticket.priority || 'medium'} · ${formatDateTime(ticket.updatedAt)}`}
                    />
                  </ListItemButton>
                ))
              )}
            </List>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Workflow Hotspots
            </Typography>
            <Stack spacing={0.8}>
              {hotspots.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Keine Hotspots im gewählten Zeitraum.
                </Typography>
              ) : (
                hotspots.map((item: any) => (
                  <Stack key={item.title} direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2">{item.title}</Typography>
                    <Chip size="small" label={Number(item.count || 0)} />
                  </Stack>
                ))
              )}
            </Stack>
          </CardContent>
        </Card>
      </Box>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Interne Aufgaben
          </Typography>
          <List dense disablePadding>
            {tasks.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Keine offenen internen Aufgaben.
              </Typography>
            ) : (
              tasks.map((task: any) => (
                <ListItemButton
                  key={task.id}
                  component={Link}
                  to={`/tickets/${encodeURIComponent(task.ticketId)}`}
                  sx={{ borderRadius: 2, mb: 0.6 }}
                >
                  <ListItemText
                    primary={`${task.title || 'Workflow-Aufgabe'} · ${task.ticketId || 'Ticket'}`}
                    secondary={`${task.status || 'pending'} · ${task.taskType || 'TASK'} · ${formatDateTime(task.updatedAt)}`}
                  />
                </ListItemButton>
              ))
            )}
          </List>
        </CardContent>
      </Card>
    </Stack>
  );
}

