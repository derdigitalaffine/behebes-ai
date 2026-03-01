import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
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
import ForumIcon from '@mui/icons-material/Forum';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded';
import AccessTimeFilledIcon from '@mui/icons-material/AccessTimeFilled';
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
      <Box sx={{ p: 3, display: 'grid', placeItems: 'center', minHeight: '40vh' }}>
        <Stack spacing={1.2} alignItems="center">
          <CircularProgress size={32} />
          <Typography variant="body2" color="text.secondary">
            Dashboard wird geladen...
          </Typography>
        </Stack>
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
  const generatedAt = formatDateTime(data?.generatedAt);

  return (
    <Stack spacing={1.5} className="ops-page-shell">
      <Card>
        <CardContent sx={{ p: { xs: 1.45, sm: 1.75 } }}>
          <Stack spacing={1.15}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h5" sx={{ fontSize: { xs: '1.2rem', sm: '1.45rem' } }}>
                  Ops Dashboard
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Fokus auf Tickets, Aufgaben und Live-Betrieb.
                </Typography>
              </Box>
              <IconButton
                color="primary"
                size="large"
                onClick={() => void query.refetch()}
                aria-label="Dashboard aktualisieren"
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 2.4,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'rgba(255,255,255,0.72)',
                  flexShrink: 0,
                }}
              >
                <RefreshIcon />
              </IconButton>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.6}>
              <AccessTimeFilledIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary">
                Stand: {generatedAt}
              </Typography>
            </Stack>
            <Stack
              direction="row"
              spacing={0.8}
              useFlexGap
              flexWrap="wrap"
              sx={{
                '& .MuiButton-root': {
                  minHeight: 48,
                  borderRadius: 2.5,
                  px: 1.4,
                  justifyContent: 'space-between',
                  minWidth: { xs: 'calc(50% - 4px)', sm: 0 },
                  flexGrow: { sm: 1 },
                },
              }}
            >
              <Button component={Link} to="/tickets" variant="contained" endIcon={<ArrowForwardIosRoundedIcon sx={{ fontSize: 14 }} />}>
                Tickets
              </Button>
              <Button component={Link} to="/messenger" variant="outlined" endIcon={<ArrowForwardIosRoundedIcon sx={{ fontSize: 14 }} />}>
                Messenger
              </Button>
              <Button component={Link} to="/scan" variant="outlined" endIcon={<QrCodeScannerIcon sx={{ fontSize: 16 }} />}>
                Ticket-Scan
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
          gap: 1,
        }}
      >
        {[
          {
            label: 'Meine offenen Tickets',
            value: Number(me.openTickets || 0),
            icon: <ConfirmationNumberIcon fontSize="small" />,
            tone: 'rgba(2,132,199,0.11)',
          },
          {
            label: 'Überfällige Tickets',
            value: Number(me.overdueTickets || 0),
            icon: <NotificationsActiveIcon fontSize="small" />,
            tone: 'rgba(217,119,6,0.16)',
          },
          {
            label: 'Meine Aufgaben',
            value: Number(me.openTasks || 0),
            icon: <TaskAltIcon fontSize="small" />,
            tone: 'rgba(34,197,94,0.15)',
          },
          {
            label: 'Ungelesene Chats',
            value: Number(me.unreadChatCount || 0),
            icon: <MarkChatUnreadIcon fontSize="small" />,
            tone: 'rgba(153,192,0,0.19)',
          },
          {
            label: 'Offene Hinweise',
            value: Number(me.openNotifications || 0),
            icon: <NotificationsActiveIcon fontSize="small" />,
            tone: 'rgba(59,130,246,0.13)',
          },
          {
            label: 'Team in Bearbeitung',
            value: Number(team.processingTickets || 0),
            icon: <GroupWorkIcon fontSize="small" />,
            tone: 'rgba(15,23,42,0.08)',
          },
        ].map((item) => (
          <Card key={item.label}>
            <CardActionArea
              component={item.label.includes('Chat') ? Link : 'button'}
              {...(item.label.includes('Chat') ? { to: '/messenger' } : {})}
              sx={{
                minHeight: 112,
                borderRadius: 2.3,
                p: 1.2,
                display: 'flex',
                alignItems: 'stretch',
              }}
            >
              <CardContent sx={{ p: 0, width: '100%', '&:last-child': { pb: 0 } }}>
                <Stack spacing={0.7} sx={{ height: '100%' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" gap={0.6}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        fontSize: '0.72rem',
                        lineHeight: 1.25,
                        display: '-webkit-box',
                        overflow: 'hidden',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {item.label}
                    </Typography>
                    <Box
                      sx={{
                        width: 30,
                        height: 30,
                        borderRadius: 999,
                        display: 'grid',
                        placeItems: 'center',
                        background: item.tone,
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </Box>
                  </Stack>
                  <Typography variant="h4" fontWeight={800} sx={{ lineHeight: 1.05, fontSize: { xs: '1.45rem', sm: '1.7rem' } }}>
                    {item.value}
                  </Typography>
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>

      <Card>
        <CardContent sx={{ p: { xs: 1.2, sm: 1.5 }, '&:last-child': { pb: { xs: 1.2, sm: 1.5 } } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography variant="h6" sx={{ fontSize: { xs: '1rem', sm: '1.1rem' } }}>
              Interne Aufgaben
            </Typography>
            <Chip size="small" color="primary" label={tasks.length} />
          </Stack>
          <List disablePadding sx={{ mt: 0.8 }}>
            {tasks.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                Keine offenen internen Aufgaben.
              </Typography>
            ) : (
              tasks.slice(0, 8).map((task: any, idx: number) => (
                <React.Fragment key={task.id}>
                  <ListItemButton
                    component={Link}
                    to={`/tickets/${encodeURIComponent(task.ticketId)}`}
                    sx={{
                      minHeight: 56,
                      borderRadius: 2.5,
                      px: 1.1,
                      alignItems: 'flex-start',
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 30, mt: 0.3 }}>
                      <TaskAltIcon fontSize="small" color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary={`${task.title || 'Workflow-Aufgabe'} · ${task.ticketId || 'Ticket'}`}
                      secondary={`${task.status || 'pending'} · ${task.taskType || 'TASK'} · ${formatDateTime(task.updatedAt)}`}
                      primaryTypographyProps={{
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        lineHeight: 1.25,
                      }}
                      secondaryTypographyProps={{
                        color: 'text.secondary',
                        fontSize: '0.76rem',
                      }}
                    />
                    <ArrowForwardIosRoundedIcon sx={{ fontSize: 14, color: 'text.disabled', mt: 1.4 }} />
                  </ListItemButton>
                  {idx < Math.min(tasks.length, 8) - 1 ? <Divider component="li" sx={{ ml: 4.8 }} /> : null}
                </React.Fragment>
              ))
            )}
          </List>
        </CardContent>
      </Card>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1.45fr 1fr' },
          gap: 1,
        }}
      >
        <Card>
          <CardContent sx={{ p: { xs: 1.2, sm: 1.5 }, '&:last-child': { pb: { xs: 1.2, sm: 1.5 } } }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Typography variant="h6" sx={{ fontSize: { xs: '1rem', sm: '1.1rem' } }}>
                Letzte Ticketänderungen
              </Typography>
              <Button component={Link} to="/tickets" size="small" variant="text" endIcon={<ArrowForwardIosRoundedIcon sx={{ fontSize: 14 }} />}>
                Alle
              </Button>
            </Stack>
            <List disablePadding sx={{ mt: 0.8 }}>
              {recentTickets.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                  Keine aktuellen Ticketereignisse.
                </Typography>
              ) : (
                recentTickets.slice(0, 8).map((ticket: any, idx: number) => (
                  <React.Fragment key={ticket.id}>
                    <ListItemButton
                      component={Link}
                      to={`/tickets/${encodeURIComponent(ticket.id)}`}
                      sx={{
                        minHeight: 56,
                        borderRadius: 2.5,
                        px: 1.1,
                        alignItems: 'flex-start',
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 30, mt: 0.3 }}>
                        <ConfirmationNumberIcon fontSize="small" color="info" />
                      </ListItemIcon>
                      <ListItemText
                        primary={`${ticket.id} · ${ticket.category || 'Unkategorisiert'}`}
                        secondary={`${ticket.status || 'open'} · ${ticket.priority || 'medium'} · ${formatDateTime(ticket.updatedAt)}`}
                        primaryTypographyProps={{
                          fontWeight: 700,
                          fontSize: '0.9rem',
                          lineHeight: 1.25,
                        }}
                        secondaryTypographyProps={{
                          color: 'text.secondary',
                          fontSize: '0.76rem',
                        }}
                      />
                      <ArrowForwardIosRoundedIcon sx={{ fontSize: 14, color: 'text.disabled', mt: 1.4 }} />
                    </ListItemButton>
                    {idx < Math.min(recentTickets.length, 8) - 1 ? <Divider component="li" sx={{ ml: 4.8 }} /> : null}
                  </React.Fragment>
                ))
              )}
            </List>
          </CardContent>
        </Card>

        <Card>
          <CardContent sx={{ p: { xs: 1.2, sm: 1.5 }, '&:last-child': { pb: { xs: 1.2, sm: 1.5 } } }}>
            <Typography variant="h6" sx={{ fontSize: { xs: '1rem', sm: '1.1rem' } }}>
              Workflow Hotspots
            </Typography>
            <Stack spacing={0.7} sx={{ mt: 1 }}>
              {hotspots.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Keine Hotspots im gewählten Zeitraum.
                </Typography>
              ) : (
                hotspots.map((item: any) => (
                  <Stack
                    key={item.title}
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    spacing={1}
                    sx={{
                      minHeight: 46,
                      px: 1,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: 'rgba(255,255,255,0.6)',
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                      {item.title}
                    </Typography>
                    <Chip size="small" color="primary" label={Number(item.count || 0)} />
                  </Stack>
                ))
              )}
            </Stack>
            <Divider sx={{ my: 1.2 }} />
            <Stack direction="row" spacing={0.7} alignItems="center">
              <ForumIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                Ungelesene Chats: <strong>{Number(me.unreadChatCount || 0)}</strong>
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mt: 0.6 }}>
              <NotificationsActiveIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                Offene Hinweise: <strong>{Number(me.openNotifications || 0)}</strong>
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mt: 0.6 }}>
              <AccessTimeFilledIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                Zeitraum: 7 Tage
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      </Box>

      <Card>
        <CardActionArea component={Link} to="/tickets" sx={{ minHeight: 56, borderRadius: 2.5 }}>
          <CardContent sx={{ p: { xs: 1.2, sm: 1.4 }, '&:last-child': { pb: { xs: 1.2, sm: 1.4 } } }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
              <Stack direction="row" spacing={1} alignItems="center">
                <ConfirmationNumberIcon color="primary" />
                <Typography sx={{ fontWeight: 700 }}>
                  Team gesamt offen: {Number(team.openTickets || 0)} Tickets
                </Typography>
              </Stack>
              <ArrowForwardIosRoundedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
            </Stack>
          </CardContent>
        </CardActionArea>
      </Card>
    </Stack>
  );
}
