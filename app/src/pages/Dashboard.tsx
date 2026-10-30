import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import type { SpeciesCode } from '@pond-tracker/shared';
import { SPECIES, pondGuidance, psd, wrBand, wrByClass } from '@pond-tracker/shared';
import { ENABLED_SPECIES } from '../components/SpeciesPicker';
import type { CatchRow } from '../db/db';
import { repo } from '../db/repo';
import { usePond } from '../hooks/usePonds';
import { useSettings } from '../hooks/useSettings';

export function Dashboard() {
  const { id = '' } = useParams();
  const pond = usePond(id);
  const settings = useSettings();
  const catches = useLiveQuery(() => repo.listCatches(id), [id]);

  if (pond === undefined || catches === undefined) return <div className="page muted">Loading…</div>;
  if (!pond) return <div className="page empty">Pond not found.</div>;

  const seasonStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const thresholds = pond.wrThresholds ?? settings.defaultThresholds;

  return (
    <div className="page">
      <h1>{pond.name}</h1>
      <div className="subtabs">
        <Link to={`/ponds/${pond.id}`} className="active">
          Dashboard
        </Link>
        <Link to={`/ponds/${pond.id}/catches`}>Catches</Link>
        <Link to={`/ponds/${pond.id}/edit`}>Edit</Link>
      </div>
      <div className="muted" style={{ marginBottom: 12 }}>
        {pond.acres !== undefined ? `${pond.acres} ac · ` : ''}
        slot {pond.cullSlotMinIn}–{pond.cullSlotMaxIn} in · {catches.length} catches
      </div>

      {catches.length === 0 ? <div className="empty">Log a few fish to see stats here.</div> : null}

      <div className="stack">
        {ENABLED_SPECIES.map((code) => (
          <SpeciesCard key={code} code={code} catches={catches.filter((c) => c.speciesId === code)} seasonStart={seasonStart} thresholds={thresholds} />
        ))}
      </div>
    </div>
  );
}

interface SpeciesCardProps {
  code: SpeciesCode;
  catches: CatchRow[];
  seasonStart: string;
  thresholds: { low: number; ok: number; high: number };
}

function SpeciesCard({ code, catches, seasonStart, thresholds }: SpeciesCardProps) {
  if (catches.length === 0) return null;
  const season = catches.filter((c) => c.caughtAt >= seasonStart);
  const count = (list: CatchRow[], o: 'kept' | 'released') => list.filter((c) => c.outcome === o).length;
  const lengths = catches.map((c) => c.lengthIn);
  const p = psd(code, lengths);
  const classes = wrByClass(code, catches);
  const guidance = pondGuidance(code, catches, undefined, thresholds);
  const maxWr = Math.max(130, ...classes.map((c) => c.meanWr ?? 0));

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

      <h3 style={{ marginTop: 14 }}>Mean Wr by length class</h3>
      <div className="bars">
        {classes.map((c) => {
          const wr = c.meanWr;
          return (
            <div className="bar-row" key={c.cls}>
              <div className="bar-label">
                {c.cls} <span className="muted">({c.n})</span>
              </div>
              <div className="bar-track">
                {wr !== null ? (
                  <div className={`bar-fill ${wrBand(wr, thresholds)}`} style={{ width: `${Math.min(100, (wr / maxWr) * 100)}%` }} />
                ) : null}
              </div>
              <div className="bar-val">{wr === null ? '—' : Math.round(wr)}</div>
            </div>
          );
        })}
      </div>

      <div className="guidance" style={{ marginTop: 14 }}>
        <h3>Guidance</h3>
        <div>{guidance.summary}</div>
        {guidance.actions.length ? (
          <ul>
            {guidance.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
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
