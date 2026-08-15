import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApi } from '../api';
import { EmptyState, Skeleton, useToast } from '../ui';

/* ---- Palette -------------------------------------------------------------
   Validated with the data-viz palette validator against this app's own chart
   surfaces (#ffffff light, #141a25 dark). Categorical slots are used in fixed
   order; the funnel uses a single-hue ordinal ramp.                          */

const PALETTE = {
  light: {
    // Categorical slots 1-4, in order.
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
    // Single-hue ordinal ramp, light end clears 2:1 against the surface.
    ordinal: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'],
    accent: '#2a78d6',
    grid: '#e1e0d9',
    axis: '#898781',
    ink: '#0b0b0b',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500'],
    ordinal: ['#6da7ec', '#3987e5', '#256abf', '#184f95'],
    accent: '#3987e5',
    grid: '#2c2c2a',
    axis: '#898781',
    ink: '#ffffff',
  },
};

function useColorScheme() {
  const [scheme, setScheme] = useState(() =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => setScheme(event.matches ? 'dark' : 'light');
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  return scheme;
}

/* ---- Chart pieces -------------------------------------------------------- */

function ChartTooltip({ active, payload, label, colors }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="tt-row">
          <span className="tt-swatch" style={{ background: colors.accent }} />
          {entry.name}: <strong style={{ color: 'var(--text)' }}>{entry.value}</strong>
        </div>
      ))}
    </div>
  );
}

function BarList({ items, colorFor, total, emptyLabel }) {
  if (items.length === 0) {
    return <p className="muted small">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <div className="bar-list">
      {items.map((item, index) => (
        <div key={item.name} className="bar-item">
          <span className="bar-name">{item.name}</span>
          <span className="bar-value">
            {item.count}
            {total > 0 && ` · ${Math.round((item.count / total) * 100)}%`}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{
                width: `${Math.max(2, (item.count / max) * 100)}%`,
                background: colorFor(index),
              }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function Funnel({ stages, colors }) {
  const top = stages[0]?.count ?? 0;
  return (
    <div className="funnel">
      {stages.map((stage, index) => {
        const width = top > 0 ? Math.max(3, (stage.count / top) * 100) : 3;
        return (
          <div key={stage.stage} className="funnel-step">
            <span className="funnel-label">{stage.stage}</span>
            <div className="funnel-bar">
              <div
                className="funnel-fill"
                style={{ width: `${width}%`, background: colors.ordinal[index] }}
                title={`${stage.stage}: ${stage.count}`}
              >
                {stage.count}
              </div>
            </div>
            <span className="funnel-pct">
              {top > 0 ? `${Math.round((stage.count / top) * 100)}%` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---- Page ---------------------------------------------------------------- */

export default function AnalyticsPage() {
  const api = useApi();
  const toast = useToast();
  const scheme = useColorScheme();
  const colors = PALETTE[scheme];

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(90);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getAnalytics({ days: windowDays }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [api, windowDays, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Daily points are too noisy to read; bucket to weeks for the axis but keep
  // the cumulative line, which is what actually shows momentum.
  const timeSeries = useMemo(() => {
    if (!data) return [];
    return data.overTime.map((point) => ({
      ...point,
      label: new Date(point.date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
    }));
  }, [data]);

  if (loading) {
    return (
      <main className="page">
        <Skeleton rows={8} />
      </main>
    );
  }

  if (!data || data.totals.total === 0) {
    return (
      <main className="page">
        <div className="page-head">
          <div>
            <h1>Analytics</h1>
            <p className="subtitle">How your search is actually going.</p>
          </div>
        </div>
        <EmptyState
          icon="📊"
          title="No applications to analyse yet"
          action={
            <Link className="btn btn-primary" to="/feed">
              Browse listings
            </Link>
          }
        >
          Once you have a few applications in your tracker, this page shows response rates, your
          funnel, and how your volume is trending.
        </EmptyState>
      </main>
    );
  }

  const { totals, statusCounts, funnel, topCompanies, byCategory } = data;
  const pct = (value) => `${Math.round(value * 100)}%`;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="subtitle">
            Built from your own application history — {totals.total} application
            {totals.total === 1 ? '' : 's'}, {totals.imported} imported from the feed.
          </p>
        </div>
        <div className="page-head-actions">
          <div className="segmented">
            {[30, 90, 180].map((days) => (
              <button
                key={days}
                className={windowDays === days ? 'active' : ''}
                onClick={() => setWindowDays(days)}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Response rate</div>
          <div className="stat-value">{pct(totals.responseRate)}</div>
          <div className="stat-note">
            {totals.responded} of {totals.total} heard back
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Interview rate</div>
          <div className="stat-value">{pct(totals.interviewRate)}</div>
          <div className="stat-note">reached interviewing or beyond</div>
        </div>
        <div className="stat">
          <div className="stat-label">Offers</div>
          <div className="stat-value">{totals.offered}</div>
          <div className="stat-note">{pct(totals.offerRate)} of everything sent</div>
        </div>
        <div className="stat">
          <div className="stat-label">Median reply time</div>
          <div className="stat-value">
            {totals.medianDaysToResponse !== null ? `${totals.medianDaysToResponse}d` : '—'}
          </div>
          <div className="stat-note">
            {totals.medianDaysToResponse !== null
              ? 'from applying to first status change'
              : 'no responses recorded yet'}
          </div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-panel chart-span-2">
          <div className="chart-title">Applications over time</div>
          <div className="chart-sub">
            Cumulative total across the last {data.windowDays} days.
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.accent} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={colors.accent} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke={colors.grid}
                  strokeWidth={1}
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  stroke={colors.grid}
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  tickLine={false}
                  minTickGap={44}
                />
                <YAxis
                  stroke={colors.grid}
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                  allowDecimals={false}
                />
                <Tooltip
                  content={<ChartTooltip colors={colors} />}
                  cursor={{ stroke: colors.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  name="Total applications"
                  stroke={colors.accent}
                  strokeWidth={2}
                  fill="url(#areaFill)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-panel">
          <div className="chart-title">Where everything stands</div>
          <div className="chart-sub">Current status of every application you have logged.</div>
          <BarList
            items={statusCounts.map((entry) => ({ name: entry.status, count: entry.count }))}
            colorFor={(index) => colors.series[index]}
            total={totals.total}
            emptyLabel="Nothing logged yet."
          />
          <div className="chart-legend">
            {statusCounts.map((entry, index) => (
              <span key={entry.status}>
                <i style={{ background: colors.series[index] }} />
                {entry.status}
              </span>
            ))}
          </div>
        </div>

        <div className="chart-panel">
          <div className="chart-title">Your funnel</div>
          <div className="chart-sub">How far applications get, as a share of everything sent.</div>
          <Funnel stages={funnel} colors={colors} />
        </div>

        <div className="chart-panel">
          <div className="chart-title">Most-applied companies</div>
          <div className="chart-sub">Where you are concentrating effort.</div>
          <BarList
            items={topCompanies}
            colorFor={() => colors.accent}
            total={totals.total}
            emptyLabel="No company data yet."
          />
        </div>

        <div className="chart-panel">
          <div className="chart-title">By category</div>
          <div className="chart-sub">Which kinds of roles you are actually going after.</div>
          <BarList
            items={byCategory}
            colorFor={() => colors.accent}
            total={totals.total}
            emptyLabel="Imported listings carry a category — apply from the feed to populate this."
          />
        </div>
      </div>
    </main>
  );
}
