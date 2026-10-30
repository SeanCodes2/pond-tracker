import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useToast } from '../components/Toast';
import { db, type CatchRow, type PondRow } from '../db/db';
import { repo } from '../db/repo';
import { useSettings } from '../hooks/useSettings';
import { formatDateTime, formatLength, formatWeightUnits, speciesShortName } from '../lib/format';

type Target = { kind: 'pond'; row: PondRow; catches: number } | { kind: 'catch'; row: CatchRow } | { kind: 'all' };

export function RecentlyDeleted() {
  const toast = useToast();
  const settings = useSettings();
  const deletedPonds = useLiveQuery(() => repo.listDeletedPonds(), []);
  const deletedCatches = useLiveQuery(() => repo.listDeletedCatches(), []);
  const allPonds = useLiveQuery(() => db.ponds.toArray(), []);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);

  const pondById = useMemo(() => new Map((allPonds ?? []).map((p) => [p.id, p])), [allPonds]);

  // Catches removed by a pond cascade are represented by the pond row, not listed one by one.
  const { pondItems, catchItems } = useMemo(() => {
    const cascaded = new Map<string, number>();
    const singles: CatchRow[] = [];
    for (const c of deletedCatches ?? []) {
      const pond = pondById.get(c.pondId);
      if (pond?.deletedAt && pond.deletedAt === c.deletedAt) cascaded.set(pond.id, (cascaded.get(pond.id) ?? 0) + 1);
      else singles.push(c);
    }
    return {
      pondItems: (deletedPonds ?? []).map((p) => ({ row: p, catches: cascaded.get(p.id) ?? 0 })),
      catchItems: singles,
    };
  }, [deletedCatches, deletedPonds, pondById]);

  const loading = deletedPonds === undefined || deletedCatches === undefined;
  const total = pondItems.length + catchItems.length;

  const restorePond = async (p: PondRow, catches: number) => {
    await repo.restorePondCascade(p.id);
    toast.show({ message: `Restored ${p.name}${catches ? ` and ${plural(catches, 'catch', 'catches')}` : ''}` });
  };

  const restoreCatch = async (c: CatchRow) => {
    const res = await repo.restoreCatch(c.id);
    const pond = pondById.get(c.pondId);
    toast.show({
      message: res.pondRestored ? `Restored catch and its pond ${pond?.name ?? ''}`.trim() : 'Catch restored',
    });
  };

  const restoreAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      for (const { row } of pondItems) await repo.restorePondCascade(row.id);
      await repo.restoreCatches(catchItems.map((c) => c.id));
      // A lone catch may belong to a pond that is still deleted; bring those ponds back too.
      for (const c of catchItems) {
        const pond = pondById.get(c.pondId);
        if (pond?.deletedAt) await repo.restorePondCascade(pond.id);
      }
      toast.show({ message: `Restored ${plural(total, 'item', 'items')}` });
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      if (target.kind === 'pond') {
        await repo.hardDeletePond(target.row.id);
        toast.show({ message: `Permanently deleted ${target.row.name}` });
      } else if (target.kind === 'catch') {
        await repo.hardDeleteCatches([target.row.id]);
        toast.show({ message: 'Catch permanently deleted' });
      } else {
        for (const { row } of pondItems) await repo.hardDeletePond(row.id);
        await repo.hardDeleteCatches(catchItems.map((c) => c.id));
        toast.show({ message: 'Recently deleted emptied' });
      }
    } finally {
      setBusy(false);
      setTarget(null);
    }
  };

  return (
    <div className="page">
      <div className="row" style={{ gap: 6 }}>
        <Link to="/settings" className="back-link" aria-label="Back to settings">
          ‹ Settings
        </Link>
      </div>
      <h1>Recently deleted</h1>
      <div className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
        Deleted records stay here for 30 days, then are removed for good.
      </div>

      {loading ? <div className="muted">Loading…</div> : null}
      {!loading && total === 0 ? <div className="empty">Nothing here. Deleted ponds and catches will show up for 30 days.</div> : null}

      {total > 0 ? (
        <div className="row" style={{ marginBottom: 12 }}>
          <button type="button" className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={() => void restoreAll()}>
            Restore all
          </button>
          <button type="button" className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={() => setTarget({ kind: 'all' })}>
            Empty
          </button>
        </div>
      ) : null}

      {pondItems.length > 0 ? <h2>Ponds</h2> : null}
      <div className="list">
        {pondItems.map(({ row, catches }) => (
          <div key={row.id} className="list-item deleted-item">
            <div className="main">
              <div className="title">{row.name}</div>
              <div className="sub">
                {plural(catches, 'catch', 'catches')} · deleted {row.deletedAt ? formatDateTime(row.deletedAt) : ''}
              </div>
            </div>
            <div className="deleted-actions">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void restorePond(row, catches)}>
                Restore
              </button>
              <button type="button" className="btn danger" disabled={busy} aria-label={`Delete ${row.name} permanently`} onClick={() => setTarget({ kind: 'pond', row, catches })}>
                <TrashIcon />
              </button>
            </div>
          </div>
        ))}
      </div>

      {catchItems.length > 0 ? <h2>Catches</h2> : null}
      <div className="list">
        {catchItems.map((c) => {
          const pond = pondById.get(c.pondId);
          return (
            <div key={c.id} className="list-item deleted-item">
              <div className="main">
                <div className="title">
                  {formatLength(c.lengthIn)} {speciesShortName(c.speciesId)}
                  <span className={`outcome ${c.outcome}`}>{c.outcome}</span>
                </div>
                <div className="sub">
                  {c.weightLb > 0 ? `${formatWeightUnits(c.weightLb, settings.weightUnits)} · ` : ''}
                  {formatDateTime(c.caughtAt)}
                  {pond ? ` · ${pond.name}${pond.deletedAt ? ' (deleted)' : ''}` : ''}
                </div>
              </div>
              <div className="deleted-actions">
                <button type="button" className="btn primary" disabled={busy} onClick={() => void restoreCatch(c)}>
                  Restore
                </button>
                <button type="button" className="btn danger" disabled={busy} aria-label="Delete catch permanently" onClick={() => setTarget({ kind: 'catch', row: c })}>
                  <TrashIcon />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmSheet
        open={target !== null}
        title={
          target?.kind === 'pond'
            ? `Permanently delete ${target.row.name}?`
            : target?.kind === 'catch'
              ? 'Permanently delete this catch?'
              : 'Empty recently deleted?'
        }
        confirmLabel="Delete permanently"
        busy={busy}
        onConfirm={() => void purge()}
        onCancel={() => setTarget(null)}
      >
        {target?.kind === 'pond'
          ? `The pond, its ${plural(target.catches, 'catch', 'catches')}, photos and feeding logs will be erased. This cannot be undone.`
          : target?.kind === 'catch'
            ? 'The catch and its photo will be erased. This cannot be undone.'
            : `All ${plural(total, 'item', 'items')} here will be erased, including photos. This cannot be undone.`}
      </ConfirmSheet>
    </div>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}
