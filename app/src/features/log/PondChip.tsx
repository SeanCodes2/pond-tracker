import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from '../../components/Sheet';
import type { CurrentPond } from '../../hooks/useCurrentPond';

export function PondChip({ current }: { current: CurrentPond }) {
  const [open, setOpen] = useState(false);
  const { ponds, pond, source, locating, select, relocate } = current;

  if (ponds && ponds.length === 0) {
    return (
      <Link to="/ponds/new" className="chip" style={{ borderColor: 'var(--accent)' }}>
        <span>+ Add your first pond</span>
      </Link>
    );
  }

  return (
    <>
      <button type="button" className="chip" onClick={() => setOpen(true)} aria-label="Change pond">
        <span className={`dot${source === 'gps' ? ' gps' : ''}`} aria-hidden />
        <span>{locating && !pond ? 'Locating…' : (pond?.name ?? 'Choose pond')}</span>
        <span aria-hidden>▾</span>
      </button>
      <Sheet open={open} title="Pond" onClose={() => setOpen(false)}>
        <div className="list">
          {ponds?.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`list-item${p.id === pond?.id ? ' active' : ''}`}
              onClick={() => {
                select(p.id);
                setOpen(false);
              }}
            >
              <div className="main">
                <div className="title">{p.name}</div>
                <div className="sub">{p.lat !== undefined ? `GPS · ${p.geofenceM} m fence` : 'No GPS location'}</div>
              </div>
            </button>
          ))}
          <button
            type="button"
            className="btn block"
            onClick={() => {
              relocate();
              setOpen(false);
            }}
          >
            Use GPS to pick
          </button>
          <Link to="/ponds/new" className="btn block" onClick={() => setOpen(false)}>
            + New pond
          </Link>
        </div>
      </Sheet>
    </>
  );
}
