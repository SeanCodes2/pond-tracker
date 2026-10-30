import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { wrBand } from '@pond-tracker/shared';
import { WrBadge } from '../components/WrGauge';
import type { CatchRow } from '../db/db';
import { repo } from '../db/repo';
import { usePhotoUrl } from '../hooks/usePhotoUrl';
import { usePond, usePonds } from '../hooks/usePonds';
import { useSettings } from '../hooks/useSettings';
import { formatDateTime, formatLength, formatWeightUnits, speciesShortName } from '../lib/format';

const PAGE = 200;

export function Catches() {
  const { id: pondId } = useParams();
  const pond = usePond(pondId);
  const ponds = usePonds();
  const settings = useSettings();
  const catches = useLiveQuery(() => repo.listCatches(pondId, { limit: PAGE }), [pondId]);
  const thresholds = pond?.wrThresholds ?? settings.defaultThresholds;
  const pondName = new Map((ponds ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="page">
      <h1>{pond ? `${pond.name} catches` : 'Recent catches'}</h1>
      {pond ? (
        <div className="subtabs">
          <Link to={`/ponds/${pond.id}`}>Dashboard</Link>
          <Link to={`/ponds/${pond.id}/catches`} className="active">
            Catches
          </Link>
          <Link to={`/ponds/${pond.id}/edit`}>Edit</Link>
        </div>
      ) : null}
      {catches && catches.length === 0 ? <div className="empty">No catches yet. Log one from the Log tab.</div> : null}
      <div className="list">
        {catches?.map((c) => (
          <CatchItem
            key={c.id}
            c={c}
            units={settings.weightUnits}
            pondLabel={pondId ? undefined : pondName.get(c.pondId)}
            thresholds={thresholds}
          />
        ))}
      </div>
      {catches && catches.length >= PAGE ? <div className="muted" style={{ marginTop: 12 }}>Showing newest {PAGE}. Export CSV for everything.</div> : null}
    </div>
  );
}

interface CatchItemProps {
  c: CatchRow;
  units: 'decimal' | 'lbsOz';
  pondLabel?: string;
  thresholds: { low: number; ok: number; high: number };
}

function CatchItem({ c, units, pondLabel, thresholds }: CatchItemProps) {
  const url = usePhotoUrl(c.photoId);
  return (
    <Link to={`/catches/${c.id}`} className="list-item">
      {url ? <img className="thumb" src={url} alt="" /> : <div className="thumb">{c.speciesId}</div>}
      <div className="main">
        <div className="title">
          {formatLength(c.lengthIn)} {speciesShortName(c.speciesId)}
          <WrBadge wr={c.wr} band={wrBand(c.wr, thresholds)} />
          <span className={`outcome ${c.outcome}`}>{c.outcome}</span>
        </div>
        <div className="sub">
          {c.weightLb > 0 ? `${formatWeightUnits(c.weightLb, units)} · ` : ''}
          {formatDateTime(c.caughtAt)}
          {pondLabel ? ` · ${pondLabel}` : ''}
        </div>
      </div>
    </Link>
  );
}
