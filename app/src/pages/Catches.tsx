import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Outcome, SpeciesCode } from '@pond-tracker/shared';
import { SPECIES, wrBand } from '@pond-tracker/shared';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ENABLED_SPECIES } from '../components/SpeciesPicker';
import { useToast } from '../components/Toast';
import { WrBadge } from '../components/WrGauge';
import type { CatchRow } from '../db/db';
import { repo } from '../db/repo';
import { usePhotoUrl } from '../hooks/usePhotoUrl';
import { usePond, usePonds } from '../hooks/usePonds';
import { useSettings } from '../hooks/useSettings';
import { formatDateTime, formatLength, formatWeightUnits, speciesShortName } from '../lib/format';

const PAGE = 200;

type SpeciesFilter = 'all' | SpeciesCode;
type OutcomeFilter = 'all' | Outcome;
type Sort = 'newest' | 'oldest' | 'longest';

const SORT_LABEL: Record<Sort, string> = { newest: 'Newest', oldest: 'Oldest', longest: 'Longest' };
const NEXT_SORT: Record<Sort, Sort> = { newest: 'oldest', oldest: 'longest', longest: 'newest' };

export function Catches() {
  const { id: pondId } = useParams();
  const pond = usePond(pondId);
  const ponds = usePonds();
  const settings = useSettings();
  const toast = useToast();
  const all = useLiveQuery(() => repo.listCatches(pondId), [pondId]);
  const thresholds = pond?.wrThresholds ?? settings.defaultThresholds;
  const pondName = new Map((ponds ?? []).map((p) => [p.id, p.name]));

  const [species, setSpecies] = useState<SpeciesFilter>('all');
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  const [sort, setSort] = useState<Sort>('newest');

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Leaving the pond (route change) or switching filters resets the selection.
  useEffect(() => {
    setSelected(new Set());
  }, [pondId, species, outcome]);

  const shown = useMemo(() => {
    if (!all) return undefined;
    let rows = all;
    if (species !== 'all') rows = rows.filter((c) => c.speciesId === species);
    if (outcome !== 'all') rows = rows.filter((c) => c.outcome === outcome);
    if (sort === 'oldest') rows = [...rows].reverse();
    else if (sort === 'longest') rows = [...rows].sort((a, b) => b.lengthIn - a.lengthIn || b.caughtAt.localeCompare(a.caughtAt));
    return rows.slice(0, PAGE);
  }, [all, species, outcome, sort]);

  // Drop selections that are no longer in the visible list (deleted elsewhere, filtered out).
  const visibleSelected = useMemo(() => {
    if (!shown) return new Set<string>();
    const ids = new Set(shown.map((c) => c.id));
    return new Set([...selected].filter((id) => ids.has(id)));
  }, [shown, selected]);

  const toggle = (id: string) => {
    const next = new Set(visibleSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectAllShown = () => setSelected(new Set((shown ?? []).map((c) => c.id)));

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const deleteSelected = async () => {
    const ids = [...visibleSelected];
    if (ids.length === 0 || busy) return;
    setBusy(true);
    try {
      const n = await repo.softDeleteCatches(ids);
      setConfirmOpen(false);
      stopSelecting();
      toast.show({
        message: `Deleted ${n} ${n === 1 ? 'catch' : 'catches'}`,
        durationMs: 8000,
        actions: [{ label: 'Undo', onClick: () => void repo.restoreCatches(ids) }],
      });
    } finally {
      setBusy(false);
    }
  };

  const count = visibleSelected.size;

  return (
    <div className={`page${selecting ? ' selecting' : ''}`}>
      <div className="row between">
        <h1>{pond ? `${pond.name} catches` : 'Recent catches'}</h1>
        {all && all.length > 0 ? (
          <button type="button" className={`btn${selecting ? ' primary' : ''}`} onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting}>
            {selecting ? 'Done' : 'Select'}
          </button>
        ) : null}
      </div>
      {pond ? (
        <div className="subtabs">
          <Link to={`/ponds/${pond.id}`}>Dashboard</Link>
          <Link to={`/ponds/${pond.id}/catches`} className="active">
            Catches
          </Link>
          <Link to={`/ponds/${pond.id}/edit`}>Edit</Link>
        </div>
      ) : null}

      <div className="filter-row" role="group" aria-label="Filters">
        <FilterChip active={species === 'all'} onClick={() => setSpecies('all')}>
          All
        </FilterChip>
        {ENABLED_SPECIES.map((code) => (
          <FilterChip key={code} active={species === code} onClick={() => setSpecies(code)}>
            {SPECIES[code].name.replace('Largemouth bass', 'Bass')}
          </FilterChip>
        ))}
        <span className="filter-sep" aria-hidden />
        <FilterChip active={outcome === 'all'} onClick={() => setOutcome('all')}>
          Any
        </FilterChip>
        <FilterChip active={outcome === 'kept'} onClick={() => setOutcome('kept')}>
          Kept
        </FilterChip>
        <FilterChip active={outcome === 'released'} onClick={() => setOutcome('released')}>
          Released
        </FilterChip>
        <span className="filter-sep" aria-hidden />
        <FilterChip active={false} onClick={() => setSort(NEXT_SORT[sort])} aria-label={`Sort: ${SORT_LABEL[sort]}. Tap to change.`}>
          <SortIcon /> {SORT_LABEL[sort]}
        </FilterChip>
      </div>

      {selecting && shown && shown.length > 0 ? (
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="muted">{shown.length} shown</span>
          <button type="button" className="link-btn" onClick={selectAllShown}>
            Select all shown
          </button>
        </div>
      ) : null}

      {all && all.length === 0 ? <div className="empty">No catches yet. Log one from the Log tab.</div> : null}
      {all && all.length > 0 && shown && shown.length === 0 ? <div className="empty">Nothing matches these filters.</div> : null}
      <div className="list">
        {shown?.map((c) => (
          <CatchItem
            key={c.id}
            c={c}
            units={settings.weightUnits}
            pondLabel={pondId ? undefined : pondName.get(c.pondId)}
            thresholds={thresholds}
            selecting={selecting}
            checked={visibleSelected.has(c.id)}
            onToggle={() => toggle(c.id)}
          />
        ))}
      </div>
      {shown && shown.length >= PAGE ? <div className="muted" style={{ marginTop: 12 }}>Showing {PAGE}. Narrow the filters or export CSV for everything.</div> : null}

      {selecting ? (
        <div className="action-bar" role="toolbar" aria-label="Selection actions">
          <span className="action-count">{count} selected</span>
          <button type="button" className="btn danger solid" disabled={count === 0 || busy} onClick={() => setConfirmOpen(true)}>
            Delete
          </button>
          <button type="button" className="btn" onClick={stopSelecting}>
            Cancel
          </button>
        </div>
      ) : null}

      <ConfirmSheet
        open={confirmOpen}
        title={`Delete ${count} ${count === 1 ? 'catch' : 'catches'}?`}
        confirmLabel={`Delete ${count} ${count === 1 ? 'catch' : 'catches'}`}
        busy={busy}
        onConfirm={() => void deleteSelected()}
        onCancel={() => setConfirmOpen(false)}
      >
        You can undo right away, or restore from Settings → Recently deleted for 30 days.
      </ConfirmSheet>
    </div>
  );
}

function FilterChip({ active, onClick, children, ...rest }: { active: boolean; onClick: () => void; children: ReactNode; 'aria-label'?: string }) {
  return (
    <button type="button" className={`filter-chip${active ? ' active' : ''}`} aria-pressed={active} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M5 7h14M7 12h10M9 17h6" />
    </svg>
  );
}

interface CatchItemProps {
  c: CatchRow;
  units: 'decimal' | 'lbsOz';
  pondLabel?: string;
  thresholds: { low: number; ok: number; high: number };
  selecting: boolean;
  checked: boolean;
  onToggle: () => void;
}

function CatchItem({ c, units, pondLabel, thresholds, selecting, checked, onToggle }: CatchItemProps) {
  const url = usePhotoUrl(c.photoId);
  const body = (
    <>
      {selecting ? (
        <span className={`check${checked ? ' on' : ''}`} aria-hidden>
          {checked ? <CheckIcon /> : null}
        </span>
      ) : null}
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
    </>
  );
  if (selecting) {
    return (
      <button type="button" className={`list-item selectable${checked ? ' active' : ''}`} role="checkbox" aria-checked={checked} onClick={onToggle}>
        {body}
      </button>
    );
  }
  return (
    <Link to={`/catches/${c.id}`} className="list-item">
      {body}
    </Link>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12l5 5L19 7" />
    </svg>
  );
}
