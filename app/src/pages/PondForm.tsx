import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Pond } from '@pond-tracker/shared';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useToast } from '../components/Toast';
import { repo } from '../db/repo';
import { clearLastPond } from '../hooks/useCurrentPond';
import { usePond } from '../hooks/usePonds';
import { useSettings } from '../hooks/useSettings';
import { getCurrentPosition } from '../lib/geo';

interface Draft {
  name: string;
  lat: string;
  lon: string;
  geofenceM: string;
  acres: string;
  depthFt: string;
  stockedOn: string;
  slotMin: string;
  slotMax: string;
  low: string;
  ok: string;
  high: string;
  notes: string;
}

function toDraft(p: Pond | undefined, d: { slot: { minIn: number; maxIn: number }; t: Pond['wrThresholds'] }): Draft {
  return {
    name: p?.name ?? '',
    lat: p?.lat?.toString() ?? '',
    lon: p?.lon?.toString() ?? '',
    geofenceM: String(p?.geofenceM ?? 150),
    acres: p?.acres?.toString() ?? '',
    depthFt: p?.depthFt?.toString() ?? '',
    stockedOn: p?.stockedOn ?? '',
    slotMin: String(p?.cullSlotMinIn ?? d.slot.minIn),
    slotMax: String(p?.cullSlotMaxIn ?? d.slot.maxIn),
    low: String(p?.wrThresholds.low ?? d.t.low),
    ok: String(p?.wrThresholds.ok ?? d.t.ok),
    high: String(p?.wrThresholds.high ?? d.t.high),
    notes: p?.notes ?? '',
  };
}

const num = (s: string): number | undefined => {
  const v = Number(s);
  return s.trim() === '' || !Number.isFinite(v) ? undefined : v;
};

export function PondForm() {
  const { id } = useParams();
  const isNew = id === undefined || id === 'new';
  const existing = usePond(isNew ? undefined : id);
  const settings = useSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const catchCount = useLiveQuery(() => (isNew || !id ? Promise.resolve(0) : repo.countCatches(id)), [id, isNew]) ?? 0;

  useEffect(() => {
    if (draft) return;
    if (isNew) setDraft(toDraft(undefined, { slot: settings.defaultSlot, t: settings.defaultThresholds }));
    else if (existing) setDraft(toDraft(existing, { slot: settings.defaultSlot, t: settings.defaultThresholds }));
  }, [draft, isNew, existing, settings]);

  if (!draft) return <div className="page muted">Loading…</div>;

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });

  const useGps = async () => {
    setLocating(true);
    const pos = await getCurrentPosition(15_000);
    setLocating(false);
    if (!pos) {
      setError('Could not get a GPS fix. Allow location for this site and try again outdoors.');
      return;
    }
    setDraft({ ...draft, lat: pos.lat.toFixed(6), lon: pos.lon.toFixed(6) });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const name = draft.name.trim();
    if (!name) {
      setError('Name is required.');
      return;
    }
    const slotMin = num(draft.slotMin);
    const slotMax = num(draft.slotMax);
    const low = num(draft.low);
    const ok = num(draft.ok);
    const high = num(draft.high);
    if (slotMin === undefined || slotMax === undefined || slotMin >= slotMax) {
      setError('Harvest slot min must be less than max.');
      return;
    }
    if (low === undefined || ok === undefined || high === undefined || !(low < ok && ok < high)) {
      setError('Wr thresholds must increase: low < ok < high.');
      return;
    }
    const saved = await repo.savePond({
      id: isNew ? undefined : id,
      name,
      lat: num(draft.lat),
      lon: num(draft.lon),
      geofenceM: num(draft.geofenceM) ?? 150,
      acres: num(draft.acres),
      depthFt: num(draft.depthFt),
      stockedOn: draft.stockedOn || undefined,
      notes: draft.notes.trim() || undefined,
      cullSlotMinIn: slotMin,
      cullSlotMaxIn: slotMax,
      wrThresholds: { low, ok, high },
    });
    navigate(`/ponds/${saved.id}`, { replace: true });
  };

  const remove = async () => {
    if (!id || isNew || deleting) return;
    setDeleting(true);
    try {
      const res = await repo.softDeletePondCascade(id);
      clearLastPond(id);
      const name = draft.name.trim() || 'Pond';
      toast.show({
        message: `Deleted ${name} and ${plural(res.catches, 'catch', 'catches')}`,
        durationMs: 8000,
        actions: [
          {
            label: 'Undo',
            onClick: () => {
              void repo.restorePondCascade(id, res.deletedAt).then(() => toast.show({ message: `Restored ${name}` }));
            },
          },
        ],
      });
      navigate('/ponds', { replace: true });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="page">
      <h1>{isNew ? 'New pond' : 'Edit pond'}</h1>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" type="text" value={draft.name} onChange={set('name')} autoFocus={isNew} />
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="lat">Latitude</label>
            <input id="lat" type="number" inputMode="decimal" step="any" value={draft.lat} onChange={set('lat')} />
          </div>
          <div className="field">
            <label htmlFor="lon">Longitude</label>
            <input id="lon" type="number" inputMode="decimal" step="any" value={draft.lon} onChange={set('lon')} />
          </div>
        </div>
        <button type="button" className="btn block" onClick={() => void useGps()} disabled={locating}>
          {locating ? 'Getting GPS fix…' : 'Use current GPS location'}
        </button>
        <div className="field">
          <label htmlFor="fence">Geofence radius (m)</label>
          <input id="fence" type="number" inputMode="numeric" value={draft.geofenceM} onChange={set('geofenceM')} />
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="acres">Acres</label>
            <input id="acres" type="number" inputMode="decimal" step="any" value={draft.acres} onChange={set('acres')} />
          </div>
          <div className="field">
            <label htmlFor="depth">Max depth (ft)</label>
            <input id="depth" type="number" inputMode="decimal" step="any" value={draft.depthFt} onChange={set('depthFt')} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="stocked">Stocked on</label>
          <input id="stocked" type="date" value={draft.stockedOn} onChange={set('stockedOn')} />
        </div>

        <h2>Bass harvest slot (in)</h2>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="slotMin">Min</label>
            <input id="slotMin" type="number" inputMode="decimal" step="any" value={draft.slotMin} onChange={set('slotMin')} />
          </div>
          <div className="field">
            <label htmlFor="slotMax">Max</label>
            <input id="slotMax" type="number" inputMode="decimal" step="any" value={draft.slotMax} onChange={set('slotMax')} />
          </div>
        </div>

        <h2>Wr thresholds (%)</h2>
        <div className="field-grid three">
          <div className="field">
            <label htmlFor="low">Low</label>
            <input id="low" type="number" inputMode="numeric" value={draft.low} onChange={set('low')} />
          </div>
          <div className="field">
            <label htmlFor="ok">OK</label>
            <input id="ok" type="number" inputMode="numeric" value={draft.ok} onChange={set('ok')} />
          </div>
          <div className="field">
            <label htmlFor="high">High</label>
            <input id="high" type="number" inputMode="numeric" value={draft.high} onChange={set('high')} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" value={draft.notes} onChange={set('notes')} />
        </div>

        {error ? <div style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</div> : null}

        <button type="submit" className="btn primary block" style={{ minHeight: 56 }}>
          Save pond
        </button>
        {!isNew ? (
          <button type="button" className="btn danger block" onClick={() => setConfirmDelete(true)}>
            Delete pond
          </button>
        ) : null}
      </form>
      <ConfirmSheet
        open={confirmDelete}
        title={`Delete ${draft.name.trim() || 'this pond'}?`}
        confirmLabel={`Delete pond and ${plural(catchCount, 'catch', 'catches')}`}
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      >
        This removes the pond and its {plural(catchCount, 'catch', 'catches')} from every list. You can restore them from
        Settings → Recently deleted for 30 days.
      </ConfirmSheet>
    </div>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
