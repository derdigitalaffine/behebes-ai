import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { subscribeAdminRealtime } from '../lib/realtime';
import './TicketAnalytics.css';

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

const formatHours = (value: number): string => `${value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;

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

const TicketAnalytics: React.FC<{ token: string }> = ({ token }) => {
  const [periodDays, setPeriodDays] = useState<PeriodDays>(90);
  const [data, setData] = useState<TicketAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAnalytics = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (!silent) setLoading(true);
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
        if (!silent) setLoading(false);
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
  const maxCategoryShare = useMemo(() => Math.max(1, ...topCategories.map((entry) => entry.share)), [topCategories]);
  const maxCityShare = useMemo(() => Math.max(1, ...topCities.map((entry) => entry.share)), [topCities]);
  const maxStatusCount = useMemo(() => Math.max(1, ...(data?.byStatus || []).map((entry) => entry.count)), [data]);
  const maxBacklog = useMemo(() => Math.max(1, ...(data?.backlogAge || []).map((entry) => entry.count)), [data]);
  const maxWeekday = useMemo(() => Math.max(1, ...(data?.byWeekday || []).map((entry) => entry.count)), [data]);
  const maxHour = useMemo(() => Math.max(1, ...(data?.byHour || []).map((entry) => entry.count)), [data]);

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
        `Häufigste Kategorie im Zeitraum: ${topCategory.category} (${topCategory.totalCount} Tickets, ${topCategory.share.toLocaleString(
          'de-DE',
          { minimumFractionDigits: 1, maximumFractionDigits: 1 }
        )} %).`
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

  if (loading && !data) {
    return <div className="loading">Lädt Statistikdaten...</div>;
  }

  return (
    <div className="ticket-analytics-page">
      <section className="analytics-header">
        <div>
          <h2>Ticket-Statistiken</h2>
          <p className="analytics-subtitle">
            Auswertung nach Ort, Zeit und Kategorie mit Trendanalyse und Backlog-Überblick.
          </p>
          <p className="analytics-meta">
            Letzte Aktualisierung: {formatDateTime(data?.generatedAt)} · Zeitraum: {periodDays} Tage
          </p>
        </div>
        <div className="analytics-actions">
          <label className="analytics-period-label" htmlFor="analytics-period">
            Zeitraum
            <select
              id="analytics-period"
              value={periodDays}
              onChange={(event) => setPeriodDays(Number(event.target.value) as PeriodDays)}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-secondary analytics-refresh" onClick={() => void fetchAnalytics()} disabled={loading}>
            <i className="fa-solid fa-rotate-right" /> Aktualisieren
          </button>
        </div>
      </section>

      {error ? <div className="error-message">{error}</div> : null}

      {data ? (
        <>
          <section className="analytics-kpi-grid">
            <article className="analytics-kpi-card">
              <span className="kpi-label">Tickets gesamt</span>
              <strong className="kpi-value">{data.totals.totalTickets.toLocaleString('de-DE')}</strong>
              <span className="kpi-note">Offen: {data.totals.openTickets.toLocaleString('de-DE')}</span>
            </article>
            <article className="analytics-kpi-card">
              <span className="kpi-label">Neu im Zeitraum</span>
              <strong className="kpi-value">{data.totals.createdInPeriod.toLocaleString('de-DE')}</strong>
              <span className="kpi-note">Erledigt: {data.totals.closedInPeriod.toLocaleString('de-DE')}</span>
            </article>
            <article className="analytics-kpi-card">
              <span className="kpi-label">Ø Lösungszeit</span>
              <strong className="kpi-value">{formatHours(data.totals.averageResolutionHours)}</strong>
              <span className="kpi-note">Median: {formatHours(data.totals.medianResolutionHours)}</span>
            </article>
            <article className="analytics-kpi-card">
              <span className="kpi-label">Standortqualität</span>
              <strong className="kpi-value">{data.totals.withCoordinates.toLocaleString('de-DE')}</strong>
              <span className="kpi-note">Mit Ort: {data.totals.withKnownCity.toLocaleString('de-DE')}</span>
            </article>
            <article className="analytics-kpi-card">
              <span className="kpi-label">Vielfalt</span>
              <strong className="kpi-value">{data.totals.uniqueCategories.toLocaleString('de-DE')} Kategorien</strong>
              <span className="kpi-note">{data.totals.uniqueCities.toLocaleString('de-DE')} Orte</span>
            </article>
            <article className="analytics-kpi-card">
              <span className="kpi-label">Offener Backlog</span>
              <strong className="kpi-value">{data.totals.openBacklog.toLocaleString('de-DE')}</strong>
              <span className="kpi-note">Status offen/zugewiesen/in Bearbeitung</span>
            </article>
          </section>

          <section className="analytics-trend-grid">
            <article className={`analytics-trend-card trend-${trendTone(data.trend.created.percentChange)}`}>
              <div className="trend-title">Neu eingegangene Tickets</div>
              <div className="trend-value">{data.trend.created.current.toLocaleString('de-DE')}</div>
              <div className="trend-comparison">
                Vorperiode: {data.trend.created.previous.toLocaleString('de-DE')} · {formatPercent(data.trend.created.percentChange)}
              </div>
            </article>
            <article className={`analytics-trend-card trend-${trendTone(data.trend.closed.percentChange)}`}>
              <div className="trend-title">Erledigte Tickets</div>
              <div className="trend-value">{data.trend.closed.current.toLocaleString('de-DE')}</div>
              <div className="trend-comparison">
                Vorperiode: {data.trend.closed.previous.toLocaleString('de-DE')} · {formatPercent(data.trend.closed.percentChange)}
              </div>
            </article>
            <article className={`analytics-trend-card trend-${trendTone(data.trend.resolutionHours.percentChange, true)}`}>
              <div className="trend-title">Bearbeitungszeit (Ø)</div>
              <div className="trend-value">{formatHours(data.trend.resolutionHours.current)}</div>
              <div className="trend-comparison">
                Vorperiode: {formatHours(data.trend.resolutionHours.previous)} · {formatPercent(data.trend.resolutionHours.percentChange)}
              </div>
            </article>
          </section>

          <section className="analytics-grid">
            <article className="analytics-panel">
              <div className="panel-head">
                <h3>Kategorien</h3>
                <span>Top 10 im Zeitraum</span>
              </div>
              <div className="analytics-list">
                {topCategories.map((entry) => (
                  <div key={entry.category} className="analytics-list-item">
                    <div className="list-row">
                      <strong>{entry.category}</strong>
                      <span>{entry.totalCount.toLocaleString('de-DE')} Tickets</span>
                    </div>
                    <div className="list-row list-row-meta">
                      <span>Offen {entry.openCount}</span>
                      <span>Geschlossen {entry.closedCount}</span>
                      <span>Ø {formatHours(entry.avgResolutionHours)}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${Math.max(3, (entry.share / maxCategoryShare) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="analytics-panel">
              <div className="panel-head">
                <h3>Orte</h3>
                <span>Top 10 nach Meldungsmenge</span>
              </div>
              <div className="analytics-list">
                {topCities.map((entry) => (
                  <div key={entry.city} className="analytics-list-item">
                    <div className="list-row">
                      <strong>{entry.city}</strong>
                      <span>{entry.totalCount.toLocaleString('de-DE')} Tickets</span>
                    </div>
                    <div className="list-row list-row-meta">
                      <span>Offen {entry.openCount}</span>
                      <span>Geschlossen {entry.closedCount}</span>
                      <span>Koordinaten {entry.withCoordinates}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill city" style={{ width: `${Math.max(3, (entry.share / maxCityShare) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="analytics-grid">
            <article className="analytics-panel">
              <div className="panel-head">
                <h3>Statusverteilung</h3>
                <span>Nur Tickets aus dem gewählten Zeitraum</span>
              </div>
              <div className="analytics-list">
                {data.byStatus.map((entry) => (
                  <div key={entry.status} className="analytics-list-item compact">
                    <div className="list-row">
                      <strong>{STATUS_LABELS[entry.status] || entry.status}</strong>
                      <span>{entry.count.toLocaleString('de-DE')}</span>
                    </div>
                    <div className="bar-track slim">
                      <div
                        className="bar-fill status"
                        style={{ width: entry.count === 0 ? '0%' : `${Math.max(3, (entry.count / maxStatusCount) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="analytics-panel">
              <div className="panel-head">
                <h3>Backlog-Alter</h3>
                <span>Alle aktuell offenen Tickets</span>
              </div>
              <div className="analytics-list">
                {data.backlogAge.map((entry) => (
                  <div key={entry.bucket} className="analytics-list-item compact">
                    <div className="list-row">
                      <strong>{entry.bucket}</strong>
                      <span>{entry.count.toLocaleString('de-DE')}</span>
                    </div>
                    <div className="bar-track slim">
                      <div
                        className="bar-fill backlog"
                        style={{ width: entry.count === 0 ? '0%' : `${Math.max(3, (entry.count / maxBacklog) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="analytics-panel">
            <div className="panel-head">
              <h3>Zeitverlauf</h3>
              <span>Neue vs. erledigte Tickets pro Tag</span>
            </div>
            <div className="timeline-chart">
              {timeline.map((entry) => (
                <div key={entry.day} className="timeline-col" title={`${formatShortDate(entry.day)} · Neu ${entry.createdCount} / Erledigt ${entry.closedCount}`}>
                  <div className="timeline-bars">
                    <div
                      className="timeline-bar created"
                      style={{ height: entry.createdCount === 0 ? '0%' : `${Math.max(2, (entry.createdCount / maxTimeline) * 100)}%` }}
                    />
                    <div
                      className="timeline-bar closed"
                      style={{ height: entry.closedCount === 0 ? '0%' : `${Math.max(2, (entry.closedCount / maxTimeline) * 100)}%` }}
                    />
                  </div>
                  <span className="timeline-label">{formatShortDate(entry.day)}</span>
                </div>
              ))}
            </div>
            <div className="timeline-legend">
              <span><i className="fa-solid fa-square legend-created" /> Neu</span>
              <span><i className="fa-solid fa-square legend-closed" /> Erledigt</span>
            </div>
          </section>

          <section className="analytics-grid">
            <article className="analytics-panel">
              <div className="panel-head">
                <h3>Meldetage</h3>
                <span>Wochentagsmuster</span>
              </div>
              <div className="mini-chart-row">
                {data.byWeekday.map((entry) => (
                  <div key={entry.weekday} className="mini-chart-col" title={`${entry.label}: ${entry.count} Tickets`}>
                    <div className="mini-chart-track">
                      <div
                        className="mini-chart-fill weekday"
                        style={{ height: entry.count === 0 ? '0%' : `${Math.max(2, (entry.count / maxWeekday) * 100)}%` }}
                      />
                    </div>
                    <span>{entry.label}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="analytics-panel">
              <div className="panel-head">
                <h3>Meldezeiten</h3>
                <span>Stündliche Verteilung</span>
              </div>
              <div className="hour-chart">
                {data.byHour.map((entry) => (
                  <div key={entry.hour} className="hour-row" title={`${String(entry.hour).padStart(2, '0')}:00 · ${entry.count} Tickets`}>
                    <span className="hour-label">{String(entry.hour).padStart(2, '0')}</span>
                    <div className="hour-track">
                      <div
                        className="hour-fill"
                        style={{ width: entry.count === 0 ? '0%' : `${Math.max(2, (entry.count / maxHour) * 100)}%` }}
                      />
                    </div>
                    <span className="hour-count">{entry.count}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="analytics-grid">
            <article className="analytics-panel">
              <div className="panel-head">
                <h3>Hotspots</h3>
                <span>Koordinaten-Cluster (Top 12)</span>
              </div>
              <div className="hotspot-list">
                {data.mapHotspots.slice(0, 12).map((entry, index) => (
                  <div key={`${entry.latitude}-${entry.longitude}-${index}`} className="hotspot-item">
                    <strong>#{index + 1}</strong>
                    <span>
                      {entry.latitude.toFixed(2)}, {entry.longitude.toFixed(2)}
                    </span>
                    <span>{entry.count} Tickets</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="analytics-panel">
              <div className="panel-head">
                <h3>Insights</h3>
                <span>Kurzinterpretation der Daten</span>
              </div>
              <div className="insight-list">
                {insights.length > 0 ? (
                  insights.map((insight) => (
                    <p key={insight}>
                      <i className="fa-solid fa-lightbulb" /> {insight}
                    </p>
                  ))
                ) : (
                  <p><i className="fa-solid fa-lightbulb" /> Für den gewählten Zeitraum liegen noch zu wenige Daten vor.</p>
                )}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
};

export default TicketAnalytics;
