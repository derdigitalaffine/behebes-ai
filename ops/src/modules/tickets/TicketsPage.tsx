import React, { useEffect, useMemo, useState } from 'react';
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
  InputAdornment,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { Link, useNavigate } from 'react-router-dom';
import { api, buildAuthHeaders } from '../../lib/api';
import { subscribeAdminRealtime } from '../../lib/realtime';
import type { AdminScopeSelection } from '../../lib/scope';

interface TicketsPageProps {
  token: string;
  scope: AdminScopeSelection;
}

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Alle Status' },
  { value: 'open', label: 'Offen' },
  { value: 'in_progress', label: 'In Bearbeitung' },
  { value: 'waiting', label: 'Warten' },
  { value: 'resolved', label: 'Gelöst' },
  { value: 'closed', label: 'Geschlossen' },
  { value: 'cancelled', label: 'Abgebrochen' },
] as const;

type TicketStatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]['value'];

const normalizeText = (value: unknown): string => String(value || '').trim();

const statusChipColor = (statusInput: unknown): 'success' | 'warning' | 'error' | 'info' | 'default' => {
  const status = normalizeText(statusInput).toLowerCase();
  if (status === 'resolved' || status === 'closed') return 'success';
  if (status === 'in_progress' || status === 'waiting') return 'warning';
  if (status === 'cancelled') return 'error';
  if (status === 'open') return 'info';
  return 'default';
};

const formatDateTime = (value: unknown): string => {
  const normalized = normalizeText(value);
  if (!normalized) return '–';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function TicketsPage({ token, scope }: TicketsPageProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const [queryText, setQueryText] = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatusFilter>('all');

  const query = useQuery({
    queryKey: ['ops-tickets', scope.mode, scope.tenantId],
    queryFn: async () => {
      const response = await api.get('/tickets', {
        headers: buildAuthHeaders(token, scope),
        params: {
          tenantId: scope.mode === 'tenant' ? scope.tenantId : undefined,
        },
      });
      return Array.isArray(response.data) ? response.data : [];
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

  const sourceItems = Array.isArray(query.data) ? query.data : [];

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of sourceItems) {
      const status = normalizeText(item?.status).toLowerCase() || 'open';
      counts.set(status, Number(counts.get(status) || 0) + 1);
    }
    return counts;
  }, [sourceItems]);

  const filteredItems = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    return sourceItems.filter((item: any) => {
      const status = normalizeText(item?.status).toLowerCase() || 'open';
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!needle) return true;
      return [
        item?.id,
        item?.category,
        item?.priority,
        item?.status,
        item?.address,
        item?.city,
        item?.assigned_to,
        item?.description,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [queryText, sourceItems, statusFilter]);

  const resetFilters = () => {
    setQueryText('');
    setStatusFilter('all');
  };

  if (query.isLoading) {
    return (
      <Box sx={{ p: 3, display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (query.isError) {
    return <Alert severity="error">Tickets konnten nicht geladen werden.</Alert>;
  }

  return (
    <Stack spacing={2.2} className="ops-page-shell">
      <Card sx={{ overflow: 'hidden' }}>
        <CardContent sx={{ p: { xs: 1.8, md: 2.2 } }}>
          <Stack spacing={1.6}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              justifyContent="space-between"
            >
              <Box>
                <Typography variant="h5">Ticketübersicht</Typography>
                <Typography variant="body2" color="text.secondary">
                  Echtzeitfähiger Arbeitsbestand mit Fokus auf klare Priorisierung.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<RestartAltIcon />}
                  onClick={resetFilters}
                >
                  Filter zurücksetzen
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<RefreshIcon />}
                  onClick={() => void query.refetch()}
                >
                  Aktualisieren
                </Button>
              </Stack>
            </Stack>
            <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
              <Chip size="small" label={`Gesamt ${sourceItems.length}`} color="secondary" />
              <Chip size="small" label={`Offen ${statusCounts.get('open') || 0}`} color="info" />
              <Chip size="small" label={`In Arbeit ${statusCounts.get('in_progress') || 0}`} color="warning" />
              <Chip size="small" label={`Gelöst ${statusCounts.get('resolved') || 0}`} color="success" />
              <Chip size="small" label={`Geschlossen ${statusCounts.get('closed') || 0}`} />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: { xs: 1.6, md: 1.8 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
            <TextField
              placeholder="Tickets durchsuchen (ID, Kategorie, Ort, Beschreibung …)"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              fullWidth
              size="small"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              select
              size="small"
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as TicketStatusFilter)}
              sx={{ minWidth: { xs: '100%', md: 220 } }}
            >
              {STATUS_FILTER_OPTIONS.map((entry) => (
                <MenuItem key={entry.value} value={entry.value}>
                  {entry.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      {isMobile ? (
        <Stack spacing={1.1}>
          {filteredItems.map((ticket: any) => (
            <Card key={ticket.id} sx={{ overflow: 'hidden' }}>
              <CardActionArea component={Link} to={`/tickets/${encodeURIComponent(ticket.id)}`}>
                <CardContent sx={{ p: 1.6 }}>
                  <Stack spacing={1.1}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography fontWeight={800}>{ticket.id}</Typography>
                      <ArrowForwardIosIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    </Stack>
                    <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                      <Chip size="small" label={ticket.status || 'open'} color={statusChipColor(ticket.status)} />
                      <Chip size="small" label={ticket.priority || 'medium'} />
                      <Chip size="small" label={ticket.category || 'Unkategorisiert'} variant="outlined" />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {ticket.address || 'Ohne Adresse'} {ticket.city ? `· ${ticket.city}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Aktualisiert: {formatDateTime(ticket.updated_at || ticket.updatedAt || ticket.created_at)}
                    </Typography>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      ) : (
        <Card>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>ID</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Priorität</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Kategorie</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Ort</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Aktualisiert</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Aktion</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredItems.map((ticket: any) => (
                  <TableRow
                    key={ticket.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/tickets/${encodeURIComponent(ticket.id)}`)}
                  >
                    <TableCell sx={{ fontWeight: 700 }}>{ticket.id}</TableCell>
                    <TableCell>
                      <Chip size="small" label={ticket.status || 'open'} color={statusChipColor(ticket.status)} />
                    </TableCell>
                    <TableCell>{ticket.priority || 'medium'}</TableCell>
                    <TableCell>{ticket.category || '–'}</TableCell>
                    <TableCell>{ticket.address || ticket.city || '–'}</TableCell>
                    <TableCell>{formatDateTime(ticket.updated_at || ticket.updatedAt || ticket.created_at)}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<VisibilityIcon />}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/tickets/${encodeURIComponent(ticket.id)}`);
                        }}
                      >
                        Öffnen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Card>
      )}

      {filteredItems.length === 0 ? (
        <Alert severity="info">Keine Tickets für die aktuelle Filterkombination gefunden.</Alert>
      ) : null}
    </Stack>
  );
}

