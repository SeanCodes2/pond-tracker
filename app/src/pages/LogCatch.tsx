import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Outcome, SpeciesCode } from '@pond-tracker/shared';
import { cullHint, formatWeight, relativeWeight, standardWeightLb, wrBand } from '@pond-tracker/shared';
import { CameraIcon, PhotoInput } from '../components/PhotoInput';
import { SpeciesPicker, ENABLED_SPECIES } from '../components/SpeciesPicker';
import { Stepper } from '../components/Stepper';
import { useToast } from '../components/Toast';
import { WrGauge } from '../components/WrGauge';
import { repo } from '../db/repo';
import {
  LENGTH_RANGE,
  entryReducer,
  initialEntry,
  isCatchPrefill,
  isEntryValid,
  loadLastLength,
  saveLastLength,
  weightRange,
} from '../features/log/entryReducer';
import { PondChip } from '../features/log/PondChip';
import { useCurrentPond } from '../hooks/useCurrentPond';
import { useSettings } from '../hooks/useSettings';
import { formatLength, speciesShortName } from '../lib/format';

const OZ_LB = 1 / 16;
const DEFAULT_SPECIES: SpeciesCode = ENABLED_SPECIES[0] ?? 'LMB';

export function LogCatch() {
  const settings = useSettings();
  const current = useCurrentPond();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const initialWeightStep = settings.weightUnits === 'lbsOz' ? OZ_LB : settings.weightStepLb;
  const [state, dispatch] = useReducer(entryReducer, DEFAULT_SPECIES, (s) => {
    const base = initialEntry(s, loadLastLength(), initialWeightStep);
    // Arriving from "Duplicate" on an existing catch: start with its species/length/weight.
    const prefill: unknown = (location.state as { prefill?: unknown } | null)?.prefill;
    return isCatchPrefill(prefill) ? entryReducer(base, { type: 'prefill', prefill }) : base;
  });
  const [saving, setSaving] = useState(false);
  const prefilled = useRef(isCatchPrefill((location.state as { prefill?: unknown } | null)?.prefill));

  // Clear the router state so a refresh or back-navigation doesn't prefill again.
  useEffect(() => {
    if (prefilled.current) {
      prefilled.current = false;
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => saveLastLength(state.lastLength), [state.lastLength]);

  const lbsOz = settings.weightUnits === 'lbsOz';
  const lengthStep = settings.lengthStepIn;
  const weightStep = lbsOz ? OZ_LB : settings.weightStepLb;
  const range = LENGTH_RANGE[state.species];
  const wRange = weightRange(state.species, state.lengthIn, weightStep);
  const pond = current.pond;

  const wsLb = useMemo(() => standardWeightLb(state.species, state.lengthIn), [state.species, state.lengthIn]);
  // Wr only means something once the weight comes from the scale, not the suggestion.
  const wr = state.weightLb > 0 && state.weightTouched ? relativeWeight(state.species, state.lengthIn, state.weightLb) : null;
  const band = wr === null ? null : wrBand(wr, pond?.wrThresholds ?? settings.defaultThresholds);
  const hint =
    wr === null
      ? undefined
      : cullHint(
          state.species,
          state.lengthIn,
          wr,
          pond ?? {
            cullSlotMinIn: settings.defaultSlot.minIn,
            cullSlotMaxIn: settings.defaultSlot.maxIn,
            wrThresholds: settings.defaultThresholds,
          },
        );

  const valid = !!pond && !saving && isEntryValid(state, settings.requireWeight, settings.requirePhoto);

  const save = useCallback(
    async (outcome: Outcome) => {
      if (!pond || saving) return;
      setSaving(true);
      try {
        const row = await repo.addCatch({
          pondId: pond.id,
          speciesId: state.species,
          lengthIn: state.lengthIn,
          weightLb: state.weightLb,
          outcome,
          lat: pond.lat,
          lon: pond.lon,
        });
        if (state.photo) {
          void repo.savePhoto(row.id, state.photo).catch(() => {
            toast.show({ message: 'Saved catch but the photo could not be stored.' });
          });
        }
        const summary = `Saved ${formatLength(state.lengthIn)} ${speciesShortName(state.species)}, Wr ${Math.round(row.wr)}`;
        toast.show({
          message: summary,
          actions: [
            { label: 'Undo', onClick: () => void repo.softDeleteCatch(row.id) },
            ...(state.photo ? [] : [{ label: 'Add photo', onClick: () => navigate(`/catches/${row.id}?photo=1`) }]),
          ],
        });
        dispatch({ type: 'reset', weightStep });
        window.scrollTo({ top: 0 });
      } finally {
        setSaving(false);
      }
    },
    [pond, saving, state, toast, navigate, weightStep],
  );

  const hintLabel = hint ? `${HINT_WORD[hint.hint]} · ${hint.reason}` : undefined;

  const gaugeHint = state.weightTouched ? hintLabel : 'Nudge the weight to your scale, or tap it if it matches';

  return (
    <div className="page stack log-page">
      <div className="row between">
        <PondChip current={current} />
      </div>

      {/* Read-only results up top; every control sits in the lower half, within thumb reach. */}
      <WrGauge wr={wr} band={band} hint={gaugeHint} />

      {state.photo ? (
        <div className="photo-strip">
          <PhotoThumb file={state.photo} />
          <div className="main" style={{ flex: 1 }}>
            Photo attached
          </div>
          <button type="button" className="btn" onClick={() => dispatch({ type: 'photo', photo: null })}>
            Remove
          </button>
        </div>
      ) : null}

      <Stepper
        label="Length"
        value={state.lengthIn}
        readout={
          <>
            {trim(state.lengthIn)}
            <small>in</small>
          </>
        }
        step={lengthStep}
        sliderStep={0.25}
        min={range.minIn}
        max={range.maxIn}
        onChange={(lengthIn) => dispatch({ type: 'length', lengthIn, step: lengthStep, weightStep })}
      />

      <Stepper
        label="Weight"
        value={state.weightLb}
        readout={weightReadout(state.weightLb, lbsOz)}
        dim={!state.weightTouched}
        onReadoutClick={state.weightTouched ? undefined : () => dispatch({ type: 'confirmWeight' })}
        sub={
          state.weightTouched
            ? `standard: ${formatWeight(wsLb, settings.weightUnits)}`
            : 'standard weight for this length · tap to confirm'
        }
        step={weightStep}
        sliderStep={lbsOz ? OZ_LB : 0.05}
        min={Math.min(wRange.min, state.weightLb)}
        max={Math.max(wRange.max, state.weightLb)}
        onChange={(weightLb) => dispatch({ type: 'weight', weightLb, step: weightStep })}
      />

      <SpeciesPicker value={state.species} onChange={(species) => dispatch({ type: 'species', species, weightStep })} />

      <div className="save-row">
        <PhotoInput
          className="btn icon"
          aria-label="Take photo"
          onPick={(photo) => dispatch({ type: 'photo', photo })}
        >
          <CameraIcon />
        </PhotoInput>
        <button type="button" className="btn save kept" disabled={!valid} onClick={() => void save('kept')}>
          Kept
        </button>
        <button type="button" className="btn save released" disabled={!valid} onClick={() => void save('released')}>
          Released
        </button>
      </div>
      {!pond ? <div className="muted">Add a pond to start logging.</div> : null}
    </div>
  );
}

const HINT_WORD = { keep: 'Keep', release: 'Release', 'your-call': 'Your call' } as const;

function trim(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function weightReadout(weightLb: number, lbsOz: boolean) {
  if (lbsOz) {
    const total = Math.round(weightLb * 16);
    const lb = Math.floor(total / 16);
    const oz = total % 16;
    return (
      <>
        {lb}
        <small>lb</small> {oz}
        <small>oz</small>
      </>
    );
  }
  return (
    <>
      {weightLb.toFixed(2)}
      <small>lb</small>
    </>
  );
}

function PhotoThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <img src={url} alt="" /> : null;
}
