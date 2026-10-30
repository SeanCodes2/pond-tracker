import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Outcome, SpeciesCode } from '@pond-tracker/shared';
import { formatWeight, relativeWeight, standardWeightLb, wrBand } from '@pond-tracker/shared';
import { CameraIcon, PhotoInput } from '../components/PhotoInput';
import { SpeciesPicker } from '../components/SpeciesPicker';
import { useToast } from '../components/Toast';
import { WrBadge } from '../components/WrGauge';
import { repo } from '../db/repo';
import { usePhotoUrl } from '../hooks/usePhotoUrl';
import { usePond, usePonds } from '../hooks/usePonds';
import { useSettings } from '../hooks/useSettings';
import { fromLocalInput, toLocalInput } from '../lib/format';
import { shareCatchPhoto } from '../lib/sharePhoto';
import type { CatchPrefill } from '../features/log/entryReducer';

interface Draft {
  pondId: string;
  speciesId: SpeciesCode;
  lengthIn: string;
  weightLb: string;
  outcome: Outcome;
  caughtAt: string;
  waterTempF: string;
  airTempF: string;
  lure: string;
  notes: string;
}

export function CatchEdit() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const settings = useSettings();
  const ponds = usePonds();
  const row = useLiveQuery(() => repo.getCatch(id), [id]);
  const pond = usePond(row?.pondId);
  const photoUrl = usePhotoUrl(row?.photoId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoPhoto = useRef(params.get('photo') === '1');
  const cameraBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (draft || !row) return;
    setDraft({
      pondId: row.pondId,
      speciesId: row.speciesId,
      lengthIn: String(row.lengthIn),
      weightLb: String(row.weightLb),
      outcome: row.outcome,
      caughtAt: toLocalInput(row.caughtAt),
      waterTempF: row.waterTempF?.toString() ?? '',
      airTempF: row.airTempF?.toString() ?? '',
      lure: row.lure ?? '',
      notes: row.notes ?? '',
    });
  }, [draft, row]);

  // Arriving from the "Add photo" toast action: open the camera straight away.
  useEffect(() => {
    if (draft && autoPhoto.current) {
      autoPhoto.current = false;
      cameraBtn.current?.click();
    }
  }, [draft]);

  if (row === undefined && draft === null) return <div className="page muted">Loading…</div>;
  if (!row || !draft) return <div className="page empty">Catch not found.</div>;

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  const lengthNum = Number(draft.lengthIn);
  const weightNum = Number(draft.weightLb);
  const liveWr = lengthNum > 0 && weightNum > 0 ? relativeWeight(draft.speciesId, lengthNum, weightNum) : null;
  const liveWs = lengthNum > 0 ? standardWeightLb(draft.speciesId, lengthNum) : null;
  const thresholds = pond?.wrThresholds ?? settings.defaultThresholds;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!(lengthNum > 0)) {
      setError('Length must be greater than zero.');
      return;
    }
    if (settings.requireWeight && !(weightNum > 0)) {
      setError('Weight is required.');
      return;
    }
    const n = (s: string) => (s.trim() === '' ? undefined : Number(s));
    await repo.updateCatch(row.id, {
      pondId: draft.pondId,
      speciesId: draft.speciesId,
      lengthIn: lengthNum,
      weightLb: weightNum,
      outcome: draft.outcome,
      caughtAt: fromLocalInput(draft.caughtAt),
      waterTempF: n(draft.waterTempF),
      airTempF: n(draft.airTempF),
      lure: draft.lure.trim() || undefined,
      notes: draft.notes.trim() || undefined,
    });
    navigate(-1);
  };

  const remove = async () => {
    if (!window.confirm('Delete this catch?')) return;
    await repo.softDeleteCatch(row.id);
    toast.show({ message: 'Catch deleted', actions: [{ label: 'Undo', onClick: () => void repo.restoreCatch(row.id) }] });
    navigate(-1);
  };

  const duplicate = () => {
    const prefill: CatchPrefill = {
      speciesId: draft.speciesId,
      lengthIn: lengthNum > 0 ? lengthNum : row.lengthIn,
      weightLb: weightNum > 0 ? weightNum : row.weightLb,
    };
    navigate('/', { state: { prefill } });
  };

  const onShare = async () => {
    try {
      const r = await shareCatchPhoto(row, { pondName: pond?.name, units: settings.weightUnits });
      if (r === 'downloaded') toast.show({ message: 'Photo downloaded.' });
    } catch {
      toast.show({ message: 'Could not share that photo. Check your connection and try again.' });
    }
  };

  const onPhoto = async (file: File) => {
    try {
      await repo.savePhoto(row.id, file);
    } catch {
      toast.show({ message: 'Could not store that photo.' });
    }
  };

  return (
    <div className="page">
      <h1>Edit catch</h1>
      <form className="form" onSubmit={(e) => void submit(e)}>
        {photoUrl ? <img className="photo-preview" src={photoUrl} alt="Catch" /> : null}
        <div className="row">
          <PhotoInput className="btn block" onPick={(f) => void onPhoto(f)} aria-label={photoUrl ? 'Retake photo' : 'Add photo'}>
            <span ref={cameraBtn} className="row" style={{ gap: 8 }}>
              <CameraIcon /> {photoUrl ? 'Retake' : 'Add photo'}
            </span>
          </PhotoInput>
          {photoUrl ? (
            <button type="button" className="btn" onClick={() => void onShare()}>
              <ShareIcon /> Share
            </button>
          ) : null}
          {photoUrl ? (
            <button type="button" className="btn danger" onClick={() => void repo.deletePhoto(row.id)}>
              Remove
            </button>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="pond">Pond</label>
          <select id="pond" value={draft.pondId} onChange={set('pondId')}>
            {ponds?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <SpeciesPicker value={draft.speciesId} onChange={(speciesId) => setDraft({ ...draft, speciesId })} />

        <div className="field-grid">
          <div className="field">
            <label htmlFor="len">Length (in)</label>
            <input id="len" type="number" inputMode="decimal" step="0.25" value={draft.lengthIn} onChange={set('lengthIn')} />
          </div>
          <div className="field">
            <label htmlFor="wt">Weight (lb)</label>
            <input id="wt" type="number" inputMode="decimal" step="0.01" value={draft.weightLb} onChange={set('weightLb')} />
          </div>
        </div>
        <div className="row between live-wr">
          <span className="muted">Standard weight: {liveWs !== null ? formatWeight(liveWs, settings.weightUnits) : '—'}</span>
          <span className="row" style={{ gap: 6 }}>
            <span className="muted">Wr</span>
            {liveWr !== null ? <WrBadge wr={liveWr} band={wrBand(liveWr, thresholds)} /> : <span className="muted">—</span>}
          </span>
        </div>

        <div className="segmented" role="radiogroup" aria-label="Outcome">
          {(['kept', 'released'] as const).map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={draft.outcome === o}
              className={draft.outcome === o ? 'active' : ''}
              onClick={() => setDraft({ ...draft, outcome: o })}
            >
              {o === 'kept' ? 'Kept' : 'Released'}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="when">Caught at</label>
          <input id="when" type="datetime-local" value={draft.caughtAt} onChange={set('caughtAt')} style={{ minHeight: 48, fontSize: 18, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', padding: '8px 12px' }} />
        </div>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="water">Water °F</label>
            <input id="water" type="number" inputMode="decimal" value={draft.waterTempF} onChange={set('waterTempF')} />
          </div>
          <div className="field">
            <label htmlFor="air">Air °F</label>
            <input id="air" type="number" inputMode="decimal" value={draft.airTempF} onChange={set('airTempF')} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="lure">Lure</label>
          <input id="lure" type="text" value={draft.lure} onChange={set('lure')} />
        </div>
        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" value={draft.notes} onChange={set('notes')} />
        </div>

        {error ? <div style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</div> : null}
        <button type="submit" className="btn primary block" style={{ minHeight: 56 }}>
          Save changes
        </button>
        <button type="button" className="btn block" onClick={duplicate}>
          Duplicate as new catch
        </button>
        <button type="button" className="btn danger block" onClick={() => void remove()}>
          Delete catch
        </button>
      </form>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 13v6h14v-6" />
    </svg>
  );
}
