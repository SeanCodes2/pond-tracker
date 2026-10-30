import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import type { SpeciesCode, WrThresholds } from '@pond-tracker/shared';
import { SPECIES, lengthFrequency, pondGuidance, psd, wrBand, wrByClass } from '@pond-tracker/shared';
import { ENABLED_SPECIES } from '../components/SpeciesPicker';
import { BarChart } from '../components/charts/BarChart';
import { Histogram } from '../components/charts/Histogram';
import { LineChart, type LineSeries } from '../components/charts/LineChart';
import { PsdMeter } from '../components/charts/PsdMeter';
import type { CatchRow, FeedingLogRow, PondRow } from '../db/db';
import { repo } from '../db/repo';
import { usePond } from '../hooks/usePonds';
import { useSettings } from '../hooks/useSettings';

/** Minimum catches per species before pondGuidance gives real advice. */
const GUIDANCE_MIN_N = 30;

/** PSD ranges generally considered "balanced" for a bass–bluegill pond. */
const PSD_BALANCED: Record<SpeciesCode, readonly [number, number]> = {
  LMB: [40, 70],
  BLG: [20, 60],
  RES: [20, 60],
};

const SERIES_CLASS: Record<SpeciesCode, string> = { LMB: 'series-lmb', BLG: 'series-blg', RES: 'series-res' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const shortName = (code: SpeciesCode): string => SPECIES[code].name.replace('Largemouth bass', 'Bass');

export function Dashboard() {
  const { id = '' } = useParams();
  const pond = usePond(id);
  const settings = useSettings();
  const catches = useLiveQuery(() => repo.listCatches(id), [id]);
  const feedingLogs = useLiveQuery(() => repo.listFeedingLogs(id), [id]);

  if (pond === undefined || catches === undefined) return <div className="page muted">Loading…</div>;
  if (!pond) return <div className="page empty">Pond not found.</div>;

  const year = new Date().getFullYear();
  const seasonStart = new Date(year, 0, 1).toISOString();
  const thresholds = pond.wrThresholds ?? settings.defaultThresholds;
  const present = ENABLED_SPECIES.filter((code) => catches.some((c) => c.speciesId === code));
  const bySpecies = (code: SpeciesCode) => catches.filter((c) => c.speciesId === code);

  return (
    <div className="page">
      <h1>{pond.name}</h1>
      <div className="subtabs">
        <Link to={`/ponds/${pond.id}`} className="active">
          Dashboard
        </Link>
        <Link to={`/ponds/${pond.id}/catches`}>Catches</Link>
        <Link to={`/ponds/${pond.id}/feeder`}>Feeder</Link>
        <Link to={`/ponds/${pond.id}/edit`}>Edit</Link>
      </div>
      <div className="muted" style={{ marginBottom: 12 }}>
        {pond.acres !== undefined ? `${pond.acres} ac · ` : ''}
        harvest {pond.cullSlotMinIn}–{pond.cullSlotMaxIn} in · {catches.length} catches
      </div>

      {catches.length === 0 ? <div className="empty">Log a few fish to see stats here.</div> : null}

      <div className="stack">
        {present.map((code) => (
          <GuidanceCard key={code} code={code} catches={bySpecies(code)} thresholds={thresholds} />
        ))}

        {present.map((code) => (
          <StatsCard key={code} code={code} catches={bySpecies(code)} seasonStart={seasonStart} />
        ))}

        {present.length ? (
          <div className="card">
            <h3>Mean Wr by length class</h3>
            {present.map((code) => (
              <WrClassChart key={code} code={code} catches={bySpecies(code)} thresholds={thresholds} />
            ))}
          </div>
        ) : null}

        {present.length ? (
          <div className="card">
            <h3>Length frequency</h3>
            {present.map((code) => (
              <LengthChart key={code} code={code} catches={bySpecies(code)} pond={pond} />
            ))}
          </div>
        ) : null}

        {present.length ? (
          <div className="card">
            <h3>Wr by month</h3>
            <div className="muted chart-caption">{year} season · shaded when the feeder was running</div>
            <WrByMonthChart catches={catches.filter((c) => c.caughtAt >= seasonStart)} species={present} feedingLogs={feedingLogs ?? []} year={year} thresholds={thresholds} />
          </div>
        ) : null}

        {present.length ? (
          <div className="card">
            <h3>Size structure (PSD)</h3>
            {present.map((code) => (
              <PsdReadout key={code} code={code} catches={bySpecies(code)} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface SpeciesProps {
  code: SpeciesCode;
  catches: CatchRow[];
}

function GuidanceCard({ code, catches, thresholds }: SpeciesProps & { thresholds: WrThresholds }) {
  const guidance = pondGuidance(code, catches, GUIDANCE_MIN_N, thresholds);
  const belowMin = catches.length < GUIDANCE_MIN_N;
  return (
    <div className={`card guidance ${belowMin ? 'pending' : ''}`}>
      <h3>{SPECIES[code].name}</h3>
      <div className="guidance-summary">{guidance.summary}</div>
      {belowMin ? (
        <div className="muted guidance-note">
          Guidance appears at {GUIDANCE_MIN_N} logged {shortName(code).toLowerCase()} ({catches.length} so far).
        </div>
      ) : null}
      {guidance.actions.length ? (
        <ul>
          {guidance.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StatsCard({ code, catches, seasonStart }: SpeciesProps & { seasonStart: string }) {
  const season = catches.filter((c) => c.caughtAt >= seasonStart);
  const count = (list: CatchRow[], o: 'kept' | 'released') => list.filter((c) => c.outcome === o).length;
  const p = psd(
    code,
    catches.map((c) => c.lengthIn),
  );
  return (
    <div className="card">
      <h3>{SPECIES[code].name}</h3>
      <div className="stat-grid">
        <Stat v={count(season, 'kept')} l="Kept this season" />
        <Stat v={count(season, 'released')} l="Released this season" />
        <Stat v={count(catches, 'kept')} l="Kept all time" />
        <Stat v={count(catches, 'released')} l="Released all time" />
        <Stat v={p.psd === null ? '—' : Math.round(p.psd)} l={`PSD (${p.nQuality}/${p.nStock} stock)`} />
        <Stat v={catches.length} l="Logged" />
      </div>
    </div>
  );
}

function WrClassChart({ code, catches, thresholds }: SpeciesProps & { thresholds: WrThresholds }) {
  const classes = wrByClass(code, catches);
  const s = SPECIES[code];
  const cut: Record<(typeof classes)[number]['cls'], number> = { stock: s.stockIn, quality: s.qualityIn, preferred: s.preferredIn, memorable: s.memorableIn };
  const maxWr = Math.max(130, ...classes.map((c) => c.meanWr ?? 0));
  return (
    <div className="chart-block">
      <h4>{SPECIES[code].name}</h4>
      <BarChart
        ariaLabel={`Mean relative weight of ${SPECIES[code].name} by length class`}
        domain={[0, Math.ceil(maxWr / 10) * 10]}
        refBand={{ from: thresholds.ok, to: thresholds.high, label: `good ${thresholds.ok}–${thresholds.high}` }}
        refLine={{ value: thresholds.low, label: `low ${thresholds.low}` }}
        categories={classes.map((c) => ({
          label: c.cls,
          value: c.meanWr,
          sub: `n ${c.n}`,
          colorClass: c.meanWr === null ? undefined : wrBand(c.meanWr, thresholds),
          title: `${c.cls} (${cut[c.cls]}+ in): ${c.meanWr === null ? 'no fish' : `Wr ${Math.round(c.meanWr)}, n ${c.n}`}`,
        }))}
      />
    </div>
  );
}

function LengthChart({ code, catches, pond }: SpeciesProps & { pond: PondRow }) {
  const s = SPECIES[code];
  const bins = lengthFrequency(
    catches.map((c) => c.lengthIn),
    1,
  );
  return (
    <div className="chart-block">
      <h4>{SPECIES[code].name}</h4>
      <Histogram
        ariaLabel={`Length frequency of ${SPECIES[code].name}, one inch bins`}
        bins={bins}
        markers={[
          { at: s.stockIn, label: 'S', title: `Stock ${s.stockIn} in` },
          { at: s.qualityIn, label: 'Q', title: `Quality ${s.qualityIn} in` },
          { at: s.preferredIn, label: 'P', title: `Preferred ${s.preferredIn} in` },
        ]}
        slot={code === 'LMB' ? { min: pond.cullSlotMinIn, max: pond.cullSlotMaxIn, label: 'harvest range' } : undefined}
      />
    </div>
  );
}

interface WrByMonthProps {
  catches: CatchRow[];
  species: SpeciesCode[];
  feedingLogs: FeedingLogRow[];
  year: number;
  thresholds: WrThresholds;
}

/** Fractional month index (0 = 1 Jan, 11.97 = 31 Dec) for an ISO date, clipped to the given year. */
function monthFraction(iso: string, year: number): number {
  const d = new Date(iso);
  if (d.getFullYear() < year) return 0;
  if (d.getFullYear() > year) return 12;
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getMonth() + (d.getDate() - 1) / daysInMonth;
}

function WrByMonthChart({ catches, species, feedingLogs, year, thresholds }: WrByMonthProps) {
  const series: LineSeries[] = species.map((code) => {
    const buckets = new Map<number, number[]>();
    for (const c of catches) {
      if (c.speciesId !== code) continue;
      const m = new Date(c.caughtAt).getMonth();
      const list = buckets.get(m) ?? [];
      list.push(c.wr);
      buckets.set(m, list);
    }
    return {
      name: shortName(code),
      colorClass: SERIES_CLASS[code],
      points: [...buckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([m, wrs]) => {
          const mean = wrs.reduce((a, b) => a + b, 0) / wrs.length;
          return { x: m + 0.5, y: mean, title: `${shortName(code)} ${MONTHS[m]}: Wr ${Math.round(mean)} (n ${wrs.length})` };
        }),
    };
  });

  const bands = feedingLogs
    .filter((f) => f.kind !== 'fill')
    .map((f) => ({
      from: monthFraction(`${f.startedOn}T12:00:00`, year),
      to: f.endedOn ? monthFraction(`${f.endedOn}T12:00:00`, year) : 12,
      label: 'feeder on',
    }))
    .filter((b) => b.to > b.from);

  const xsWithData = [...series.flatMap((s) => s.points.map((p) => p.x)), ...bands.flatMap((b) => [b.from, b.to])];
  const lo = xsWithData.length ? Math.max(0, Math.floor(Math.min(...xsWithData)) - 0.5) : 0;
  const hi = xsWithData.length ? Math.min(12, Math.ceil(Math.max(...xsWithData)) + 0.5) : 12;
  const xTicks = MONTHS.map((label, i) => ({ x: i + 0.5, label })).filter((t) => t.x > lo && t.x < hi);

  return (
    <LineChart
      ariaLabel={`Mean relative weight by month for ${species.map((c) => SPECIES[c].name).join(' and ')}`}
      series={series}
      xTicks={xTicks}
      xDomain={[lo, hi]}
      bands={bands}
      refLine={{ value: thresholds.ok, label: `ok ${thresholds.ok}` }}
    />
  );
}

function PsdReadout({ code, catches }: SpeciesProps) {
  const p = psd(
    code,
    catches.map((c) => c.lengthIn),
  );
  const band = PSD_BALANCED[code];
  const s = SPECIES[code];
  return (
    <div className="chart-block psd-block">
      <div className="row between">
        <h4>{SPECIES[code].name}</h4>
        <div className="psd-value">
          {p.psd === null ? '—' : Math.round(p.psd)}
          <small> PSD</small>
        </div>
      </div>
      <PsdMeter value={p.psd} band={band} ariaLabel={`${SPECIES[code].name} PSD ${p.psd === null ? 'not available' : Math.round(p.psd)}, balanced range ${band[0]} to ${band[1]}`} />
      <div className="muted chart-caption">
        {p.nQuality} of {p.nStock} stock-size fish ({s.stockIn}+ in) are quality size ({s.qualityIn}+ in) · balanced {band[0]}–{band[1]}
      </div>
    </div>
  );
}

function Stat({ v, l }: { v: number | string; l: string }) {
  return (
    <div className="stat">
      <div className="stat-v">{v}</div>
      <div className="stat-l">{l}</div>
    </div>
  );
}
