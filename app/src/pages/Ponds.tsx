import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { usePonds } from '../hooks/usePonds';

export function Ponds() {
  const ponds = usePonds();
  const counts = useLiveQuery(async () => {
    const rows = await db.catches.filter((c) => !c.deletedAt).toArray();
    const m = new Map<string, number>();
    for (const c of rows) m.set(c.pondId, (m.get(c.pondId) ?? 0) + 1);
    return m;
  }, []);

  return (
    <div className="page">
      <div className="row between">
        <h1>Ponds</h1>
        <Link to="/ponds/new" className="btn primary">
          + Add
        </Link>
      </div>
      {ponds && ponds.length === 0 ? <div className="empty">No ponds yet. Add one to start logging.</div> : null}
      <div className="list">
        {ponds?.map((p) => (
          <Link key={p.id} to={`/ponds/${p.id}`} className="list-item">
            <div className="main">
              <div className="title">{p.name}</div>
              <div className="sub">
                {p.acres !== undefined ? `${p.acres} ac · ` : ''}
                {counts?.get(p.id) ?? 0} catches
                {p.lat !== undefined ? ' · GPS' : ''}
              </div>
            </div>
            <span aria-hidden>›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
