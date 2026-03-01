import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { subscribeAdminRealtime } from '../lib/realtime';
import {
  SmartTable,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import { AdminKpiStrip, AdminPageHero, AdminSurfaceCard } from '../components/admin-ui';

type PeriodDays = 30 | 90 | 180 | 365;

interface AnalyticsTrendMetric {
  current: number;
  previous: number;
  percentChange: number | null;
}

interface AnalyticsTotals {
  totalTickets: number;
  openTickets: number;
  closedTickets: number;
  createdInPeriod: number;
  closedInPeriod: number;
  averageResolutionHours: number;
  medianResolutionHours: number;
  withCoordinates: number;
  withKnownCity: number;
  uniqueCategories: number;
  uniqueCities: number;
  openBacklog: number;
}

interface CategoryAnalyticsRow {
  category: string;
  totalCount: number;
  openCount: number;
  closedCount: number;
  avgResolutionHours: number;
  share: number;
}

interface CityAnalyticsRow {
  city: string;
  totalCount: number;
  openCount: number;
  closedCount: number;
  withCoordinates: number;
  share: number;
}

interface StatusAnalyticsRow {
  status: string;
  count: number;
}

interface TimeSeriesRow {
  day: string;
  createdCount: number;
  closedCount: number;
  openBalance: number;
}

interface WeekdayAnalyticsRow {
  weekday: number;
  label: string;
  count: number;
}

interface HourAnalyticsRow {
  hour: number;
  count: number;
}

interface BacklogAgeRow {
  bucket: string;
  count: number;
}

interface HotspotRow {
  latitude: number;
  longitude: number;
  count: number;
}

interface CategoryAnalyticsTableRow extends CategoryAnalyticsRow {
  id: string;
}

interface CityAnalyticsTableRow extends CityAnalyticsRow {
  id: string;
}

interface StatusAnalyticsTableRow extends StatusAnalyticsRow {
  id: string;
}

interface BacklogAgeTableRow extends BacklogAgeRow {
  id: string;
}

interface HotspotTableRow extends HotspotRow {
  id: string;
}

interface TicketAnalyticsResponse {
  generatedAt: string;
  periodDays: number;
  totals: AnalyticsTotals;
  trend: {
    created: AnalyticsTrendMetric;
    closed: AnalyticsTrendMetric;
    resolutionHours: AnalyticsTrendMetric;
  };
  byCategory: CategoryAnalyticsRow[];
  byCity: CityAnalyticsRow[];
  byStatus: StatusAnalyticsRow[];
  timeSeries: TimeSeriesRow[];
  byWeekday: WeekdayAnalyticsRow[];
  byHour: HourAnalyticsRow[];
  backlogAge: BacklogAgeRow[];
  mapHotspots: HotspotRow[];
}

const PERIOD_OPTIONS: Array<{ value: PeriodDays; label: string }> = [
  { value: 30, label: '30 Tage' },
  { value: 90, label: '90 Tage' },
  { value: 180, label: '180 Tage' },
  { value: 365, label: '365 Tage' },
];

const STATUS_LABELS: Record<string, string> = {
  pending_validation: 'Validierung ausstehend',
  pending: 'Ausstehend',
  open: 'Offen',
  assigned: 'Zugewiesen',
  'in-progress': 'In Bearbeitung',
  completed: 'Abgeschlossen',
  closed: 'Geschlossen',
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatShortDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
  });
};

const formatHours = (value: number): string =>
  `${value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;

const formatPercent = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return 'n/v';
  const abs = Math.abs(value).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (value > 0) return `+${abs} %`;
  if (value < 0) return `-${abs} %`;
  return '0,0 %';
};

const trendTone = (change: number | null, inverse = false): 'positive' | 'negative' | 'neutral' => {
  if (change === null || !Number.isFinite(change) || change === 0) return 'neutral';
  const isPositive = change > 0;
  const good = inverse ? !isPositive : isPositive;
  return good ? 'positive' : 'negative';
};

const trendStyle = (
  tone: 'positive' | 'negative' | 'neutral'
): { borderColor: string; color: string; bg: string } => {
  if (tone === 'positive') {
    return { borderColor: 'success.main', color: 'success.main', bg: 'rgba(34,197,94,.08)' };
  }
  if (tone === 'negative') {
    return { borderColor: 'error.main', color: 'error.main', bg: 'rgba(239,68,68,.08)' };
  }
  return { borderColor: 'divider', color: 'text.secondary', bg: 'rgba(148,163,184,.08)' };
};

const TicketAnalytics: React.FC<{ token: string }> = ({ token }) => {
  const [periodDays, setPeriodDays] = useState<PeriodDays>(90);
  const [data, setData] = useState<TicketAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchAnalytics = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const headers = { Authorization: `Bearer ${token}` };
        const response = await axios.get('/api/admin/dashboard/analytics', {
          headers,
          params: { days: periodDays },
        });

        setData(response.data as TicketAnalyticsResponse);
        setError('');
      } catch (err: any) {
        setError(err?.response?.data?.message || 'Fehler beim Laden der Statistikdaten');
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [token, periodDays]
  );

  useEffect(() => {
    void fetchAnalytics();

    let queuedRefresh = false;
    const requestRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (queuedRefresh) return;
      queuedRefresh = true;
      window.setTimeout(() => {
        queuedRefresh = false;
        void fetchAnalytics({ silent: true });
      }, 180);
    };

    const unsubscribe = subscribeAdminRealtime({
      token,
      topics: ['tickets'],
      onUpdate: requestRefresh,
    });

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchAnalytics({ silent: true });
      }
    }, 45000);

    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [fetchAnalytics, token]);

  const topCategories = useMemo(() => (data?.byCategory || []).slice(0, 10), [data]);
  const topCities = useMemo(() => (data?.byCity || []).slice(0, 10), [data]);
  const maxWeekday = useMemo(() => Math.max(1, ...(data?.byWeekday || []).map((entry) => entry.count)), [data]);
  const maxHour = useMemo(() => Math.max(1, ...(data?.byHour || []).map((entry) => entry.count)), [data]);

  const categoryRows = useMemo<CategoryAnalyticsTableRow[]>(
    () =>
      topCategories.map((entry) => ({
        ...entry,
        id: entry.category,
      })),
    [topCategories]
  );

  const cityRows = useMemo<CityAnalyticsTableRow[]>(
    () =>
      topCities.map((entry) => ({
        ...entry,
        id: entry.city,
      })),
    [topCities]
  );

  const statusRows = useMemo<StatusAnalyticsTableRow[]>(
    () =>
      (data?.byStatus || []).map((entry) => ({
        ...entry,
        id: entry.status,
      })),
    [data]
  );

  const backlogRows = useMemo<BacklogAgeTableRow[]>(
    () =>
      (data?.backlogAge || []).map((entry) => ({
        ...entry,
        id: entry.bucket,
      })),
    [data]
  );

  const hotspotRows = useMemo<HotspotTableRow[]>(
    () =>
      (data?.mapHotspots || []).slice(0, 12).map((entry, index) => ({
        ...entry,
        id: `${entry.latitude}-${entry.longitude}-${index}`,
      })),
    [data]
  );

  const categoryColumns = useMemo<SmartTableColumnDef<CategoryAnalyticsTableRow>[]>(
    () => [
      { field: 'category', headerName: 'Kategorie', minWidth: 220, flex: 1 },
      { field: 'totalCount', headerName: 'Tickets', minWidth: 110 },
      { field: 'openCount', headerName: 'Offen', minWidth: 100 },
      { field: 'closedCount', headerName: 'Geschlossen', minWidth: 120 },
      {
        field: 'avgResolutionHours',
        headerName: 'Ø Lösungszeit',
        minWidth: 140,
        valueFormatter: (value) => formatHours(Number(value || 0)),
      },
      {
        field: 'share',
        headerName: 'Anteil',
        minWidth: 100,
        valueFormatter: (value) =>
          `${Number(value || 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`,
      },
    ],
    []
  );

  const cityColumns = useMemo<SmartTableColumnDef<CityAnalyticsTableRow>[]>(
    () => [
      { field: 'city', headerName: 'Ort', minWidth: 220, flex: 1 },
      { field: 'totalCount', headerName: 'Tickets', minWidth: 110 },
      { field: 'openCount', headerName: 'Offen', minWidth: 100 },
      { field: 'closedCount', headerName: 'Geschlossen', minWidth: 120 },
      { field: 'withCoordinates', headerName: 'Mit Koordinaten', minWidth: 140 },
      {
        field: 'share',
        headerName: 'Anteil',
        minWidth: 100,
        valueFormatter: (value) =>
          `${Number(value || 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`,
      },
    ],
    []
  );

  const statusColumns = useMemo<SmartTableColumnDef<StatusAnalyticsTableRow>[]>(
    () => [
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 240,
        flex: 1,
        valueGetter: (_value, row) => STATUS_LABELS[row.status] || row.status,
      },
      { field: 'count', headerName: 'Tickets', minWidth: 120 },
    ],
    []
  );

  const backlogColumns = useMemo<SmartTableColumnDef<BacklogAgeTableRow>[]>(
    () => [
      { field: 'bucket', headerName: 'Altersklasse', minWidth: 240, flex: 1 },
      { field: 'count', headerName: 'Offene Tickets', minWidth: 140 },
    ],
    []
  );

  const hotspotColumns = useMemo<SmartTableColumnDef<HotspotTableRow>[]>(
    () => [
      {
        field: 'coordinate',
        headerName: 'Koordinate',
        minWidth: 260,
        flex: 1,
        valueGetter: (_value, row) => `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`,
      },
      { field: 'count', headerName: 'Tickets', minWidth: 120 },
    ],
    []
  );

  const timeline = useMemo(() => {
    if (!data?.timeSeries?.length) return [];
    const maxColumns = 42;
    if (data.timeSeries.length <= maxColumns) return data.timeSeries;
    const step = Math.ceil(data.timeSeries.length / maxColumns);
    return data.timeSeries.filter((_, index) => index % step === 0 || index === data.timeSeries.length - 1);
  }, [data]);

  const maxTimeline = useMemo(
    () => Math.max(1, ...timeline.map((entry) => Math.max(entry.createdCount, entry.closedCount))),
    [timeline]
  );

  const insights = useMemo(() => {
    if (!data) return [];
    const list: string[] = [];
    const topCategory = data.byCategory[0];
    const topCity = data.byCity[0];
    const topWeekday = [...data.byWeekday].sort((a, b) => b.count - a.count)[0];
    const topHour = [...data.byHour].sort((a, b) => b.count - a.count)[0];
    const oldBacklog = data.backlogAge.find((entry) => entry.bucket === '>= 14 Tage');

    if (topCategory) {
      list.push(
        `Häufigste Kategorie: ${topCategory.category} (${topCategory.totalCount} Tickets, ${topCategory.share.toLocaleString('de-DE', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} %).`
      );
    }
    if (topCity) {
      list.push(
        `Meiste Meldungen aus ${topCity.city} (${topCity.totalCount} Tickets, davon ${topCity.withCoordinates} mit Koordinaten).`
      );
    }
    if (topWeekday && topHour) {
      list.push(`Melde-Peak: ${topWeekday.label} um ${String(topHour.hour).padStart(2, '0')}:00 Uhr.`);
    }
    if (oldBacklog && oldBacklog.count > 0) {
      list.push(`${oldBacklog.count} offene Tickets sind älter als 14 Tage.`);
    }
    return list;
  }, [data]);

  const kpis = useMemo(() => {
    if (!data) return [];
    return [
      {
        id: 'kpi-total',
        label: 'Tickets gesamt',
        value: data.totals.totalTickets.toLocaleString('de-DE'),
        hint: `Offen: ${data.totals.openTickets.toLocaleString('de-DE')}`,
      },
      {
        id: 'kpi-period',
        label: 'Neu im Zeitraum',
        value: data.totals.createdInPeriod.toLocaleString('de-DE'),
        hint: `Erledigt: ${data.totals.closedInPeriod.toLocaleString('de-DE')}`,
      },
      {
        id: 'kpi-resolution',
        label: 'Ø Lösungszeit',
        value: formatHours(data.totals.averageResolutionHours),
        hint: `Median: ${formatHours(data.totals.medianResolutionHours)}`,
      },
      {
        id: 'kpi-geo',
        label: 'Standortqualität',
        value: data.totals.withCoordinates.toLocaleString('de-DE'),
        hint: `Mit Ort: ${data.totals.withKnownCity.toLocaleString('de-DE')}`,
      },
      {
        id: 'kpi-diversity',
        label: 'Vielfalt',
        value: `${data.totals.uniqueCategories.toLocaleString('de-DE')} Kategorien`,
        hint: `${data.totals.uniqueCities.toLocaleString('de-DE')} Orte`,
      },
      {
        id: 'kpi-backlog',
        label: 'Offener Backlog',
        value: data.totals.openBacklog.toLocaleString('de-DE'),
        tone: data.totals.openBacklog > 0 ? ('warning' as const) : ('default' as const),
        hint: 'Status offen/zugewiesen/in Bearbeitung',
      },
    ];
  }, [data]);

  const generatedAtLabel = formatDateTime(data?.generatedAt);

  return (
    <Stack spacing={2.5} className="admin-page">
      <AdminPageHero
        title="Ticket-Statistik"
        subtitle="Operative Auswertung nach Kategorie, Ort, Zeit und Backlog mit konsistentem SmartTable/MUI-Layout."
        badges={[
          { label: `Zeitraum: ${periodDays} Tage`, tone: 'info' },
          { label: `Stand: ${generatedAtLabel}`, tone: 'default' },
        ]}
        actions={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="stretch">
            <TextField
              select
              size="small"
              label="Zeitraum"
              value={periodDays}
              onChange={(event) => setPeriodDays(Number(event.target.value) as PeriodDays)}
              sx={{ minWidth: 150 }}
            >
              {PERIOD_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon fontSize="small" />}
              onClick={() => {
                void fetchAnalytics();
              }}
              disabled={loading}
            >
              Aktualisieren
            </Button>
          </Stack>
        }
      />

      {refreshing ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {loading && !data ? (
        <Typography variant="body2" color="text.secondary">
          Lade Statistikdaten...
        </Typography>
      ) : null}

      {data ? <AdminKpiStrip items={kpis} /> : null}

      {data ? (
        <AdminSurfaceCard title="Trendvergleich" subtitle="Vergleich zum vorherigen Zeitraum für Eingang, Abschluss und Bearbeitungszeit.">
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            {[
              {
                id: 'created',
                title: 'Neu eingegangene Tickets',
                metric: data.trend.created,
                value: data.trend.created.current.toLocaleString('de-DE'),
                previous: data.trend.created.previous.toLocaleString('de-DE'),
                inverse: false,
              },
              {
                id: 'closed',
                title: 'Erledigte Tickets',
                metric: data.trend.closed,
                value: data.trend.closed.current.toLocaleString('de-DE'),
                previous: data.trend.closed.previous.toLocaleString('de-DE'),
                inverse: false,
              },
              {
                id: 'resolution',
                title: 'Bearbeitungszeit (Ø)',
                metric: data.trend.resolutionHours,
                value: formatHours(data.trend.resolutionHours.current),
                previous: formatHours(data.trend.resolutionHours.previous),
                inverse: true,
              },
            ].map((item) => {
              const visual = trendStyle(trendTone(item.metric.percentChange, item.inverse));
              return (
                <Box
                  key={item.id}
                  sx={{
                    border: '1px solid',
                    borderColor: visual.borderColor,
                    borderRadius: 2,
                    p: 1.5,
                    bgcolor: visual.bg,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {item.title}
                  </Typography>
                  <Typography variant="h6" sx={{ color: visual.color, fontWeight: 700, mt: 0.3 }}>
                    {item.value}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Vorperiode: {item.previous} · {formatPercent(item.metric.percentChange)}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </AdminSurfaceCard>
      ) : null}

      {data ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 2.5 }}>
          <AdminSurfaceCard title="Kategorien" subtitle="Top 10 im Zeitraum">
            <SmartTable<CategoryAnalyticsTableRow>
              tableId="analytics-categories"
              userId={token}
              title="Kategorien"
              rows={categoryRows}
              columns={categoryColumns}
              loading={loading}
              onRefresh={() => {
                void fetchAnalytics();
              }}
              defaultPageSize={10}
              pageSizeOptions={[5, 10, 20]}
              disableRowSelectionOnClick
            />
          </AdminSurfaceCard>

          <AdminSurfaceCard title="Orte" subtitle="Top 10 nach Meldungsmenge">
            <SmartTable<CityAnalyticsTableRow>
              tableId="analytics-cities"
              userId={token}
              title="Orte"
              rows={cityRows}
              columns={cityColumns}
              loading={loading}
              onRefresh={() => {
                void fetchAnalytics();
              }}
              defaultPageSize={10}
              pageSizeOptions={[5, 10, 20]}
              disableRowSelectionOnClick
            />
          </AdminSurfaceCard>
        </Box>
      ) : null}

      {data ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 2.5 }}>
          <AdminSurfaceCard title="Statusverteilung" subtitle="Nur Tickets aus dem gewählten Zeitraum">
            <SmartTable<StatusAnalyticsTableRow>
              tableId="analytics-status"
              userId={token}
              title="Statusverteilung"
              rows={statusRows}
              columns={statusColumns}
              loading={loading}
              onRefresh={() => {
                void fetchAnalytics();
              }}
              defaultPageSize={10}
              pageSizeOptions={[5, 10, 20]}
              disableRowSelectionOnClick
            />
          </AdminSurfaceCard>

          <AdminSurfaceCard title="Backlog-Alter" subtitle="Alle aktuell offenen Tickets">
            <SmartTable<BacklogAgeTableRow>
              tableId="analytics-backlog-age"
              userId={token}
              title="Backlog-Alter"
              rows={backlogRows}
              columns={backlogColumns}
              loading={loading}
              onRefresh={() => {
                void fetchAnalytics();
              }}
              defaultPageSize={10}
              pageSizeOptions={[5, 10, 20]}
              disableRowSelectionOnClick
            />
          </AdminSurfaceCard>
        </Box>
      ) : null}

      {data ? (
        <AdminSurfaceCard title="Zeitverlauf" subtitle="Neue vs. erledigte Tickets pro Tag (kompakt).">
          <Stack spacing={1.2}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 0.55,
                minHeight: 150,
                overflowX: 'auto',
                pb: 0.5,
              }}
            >
              {timeline.map((entry) => (
                <Box
                  key={entry.day}
                  title={`${formatShortDate(entry.day)} · Neu ${entry.createdCount} / Erledigt ${entry.closedCount}`}
                  sx={{
                    minWidth: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'flex-end', height: 110 }}>
                    <Box
                      sx={{
                        width: 6,
                        borderRadius: 0.8,
                        bgcolor: 'primary.main',
                        height: `${entry.createdCount === 0 ? 0 : Math.max(2, (entry.createdCount / maxTimeline) * 100)}%`,
                      }}
                    />
                    <Box
                      sx={{
                        width: 6,
                        borderRadius: 0.8,
                        bgcolor: 'success.main',
                        height: `${entry.closedCount === 0 ? 0 : Math.max(2, (entry.closedCount / maxTimeline) * 100)}%`,
                      }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {formatShortDate(entry.day)}
                  </Typography>
                </Box>
              ))}
            </Box>

            <Stack direction="row" spacing={2} alignItems="center">
              <Chip size="small" label="Neu" color="primary" variant="outlined" />
              <Chip size="small" label="Erledigt" color="success" variant="outlined" />
            </Stack>
          </Stack>
        </AdminSurfaceCard>
      ) : null}

      {data ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 2.5 }}>
          <AdminSurfaceCard title="Meldetage" subtitle="Wochentagsmuster">
            <Stack spacing={1}>
              {data.byWeekday.map((entry) => {
                const percent = entry.count === 0 ? 0 : Math.max(2, (entry.count / maxWeekday) * 100);
                return (
                  <Box key={entry.weekday}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2">{entry.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {entry.count}
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={percent}
                      sx={{ height: 8, borderRadius: 999, mt: 0.3 }}
                    />
                  </Box>
                );
              })}
            </Stack>
          </AdminSurfaceCard>

          <AdminSurfaceCard title="Meldezeiten" subtitle="Stündliche Verteilung">
            <Stack spacing={0.9}>
              {data.byHour.map((entry) => {
                const percent = entry.count === 0 ? 0 : Math.max(2, (entry.count / maxHour) * 100);
                return (
                  <Stack key={entry.hour} direction="row" spacing={1.1} alignItems="center">
                    <Typography variant="caption" color="text.secondary" sx={{ width: 32 }}>
                      {String(entry.hour).padStart(2, '0')}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={percent}
                      sx={{ flex: 1, height: 8, borderRadius: 999 }}
                    />
                    <Typography variant="caption" sx={{ width: 30, textAlign: 'right' }}>
                      {entry.count}
                    </Typography>
                  </Stack>
                );
              })}
            </Stack>
          </AdminSurfaceCard>
        </Box>
      ) : null}

      {data ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 2.5 }}>
          <AdminSurfaceCard title="Hotspots" subtitle="Koordinaten-Cluster (Top 12)">
            <SmartTable<HotspotTableRow>
              tableId="analytics-hotspots"
              userId={token}
              title="Hotspots"
              rows={hotspotRows}
              columns={hotspotColumns}
              loading={loading}
              onRefresh={() => {
                void fetchAnalytics();
              }}
              defaultPageSize={12}
              pageSizeOptions={[6, 12, 24]}
              disableRowSelectionOnClick
            />
          </AdminSurfaceCard>

          <AdminSurfaceCard title="Insights" subtitle="Kurzinterpretation der Datenlage">
            <Stack spacing={1}>
              {insights.length > 0 ? (
                insights.map((insight) => (
                  <Alert key={insight} severity="info" variant="outlined">
                    {insight}
                  </Alert>
                ))
              ) : (
                <Alert severity="info" variant="outlined">
                  Für den gewählten Zeitraum liegen noch zu wenige Daten vor.
                </Alert>
              )}
            </Stack>
          </AdminSurfaceCard>
        </Box>
      ) : null}
    </Stack>
  );
};

export default TicketAnalytics;
