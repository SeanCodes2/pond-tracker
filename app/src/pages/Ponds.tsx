import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PeopleIcon } from '../components/PondTabs';
import { JoinPondSheet } from '../components/Sharing';
import { db } from '../db/db';
import { usePonds } from '../hooks/usePonds';
import { useSharing } from '../hooks/useSharing';
import { membersOf, myMembership, shortName } from '../lib/sharing';

export function Ponds() {
  const ponds = usePonds();
  const { viewerId, members } = useSharing();
  const [joining, setJoining] = useState(false);
  const sharing = (pondId: string): string | undefined => {
    const mine = myMembership(pondId, members, viewerId);
    if (mine) return `from ${shortName(mine.ownerName)}`;
    const n = membersOf(pondId, members, viewerId).length;
    return n ? `shared with ${n}` : undefined;
  };
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
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={() => setJoining(true)}>
            Join
          </button>
          <Link to="/ponds/new" className="btn primary">
            + Add
          </Link>
        </div>
      </div>
      {ponds && ponds.length === 0 ? (
        <div className="empty">No ponds yet. Add one to start logging, or tap Join if someone sent you a code.</div>
      ) : null}
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
              {sharing(p.id) ? (
                <div className="shared-line" style={{ margin: '2px 0 0' }}>
                  <PeopleIcon /> {sharing(p.id)}
                </div>
              ) : null}
            </div>
            <span aria-hidden>›</span>
          </Link>
        ))}
      </div>
      <JoinPondSheet open={joining} onClose={() => setJoining(false)} />
    </div>
  );
}
