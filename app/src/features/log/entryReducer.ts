import type { SpeciesCode } from '@pond-tracker/shared';
import { clamp, roundToStep } from '../../lib/format';

export interface SpeciesRange {
  minIn: number;
  maxIn: number;
  defaultIn: number;
}

export const LENGTH_RANGE: Record<SpeciesCode, SpeciesRange> = {
  LMB: { minIn: 5, maxIn: 30, defaultIn: 12 },
  BLG: { minIn: 3, maxIn: 15, defaultIn: 6 },
  RES: { minIn: 3, maxIn: 15, defaultIn: 7 },
};

export const WEIGHT_MIN_LB = 0;
export const WEIGHT_MAX_LB = 15;

export interface EntryState {
  species: SpeciesCode;
  lengthIn: number;
  /** 0 means "not entered". */
  weightLb: number;
  photo: File | null;
  /** Last length used per species, so switching species restores a sensible value. */
  lastLength: Partial<Record<SpeciesCode, number>>;
}

/** Values carried over when duplicating an existing catch (router state from CatchEdit). */
export interface CatchPrefill {
  speciesId: SpeciesCode;
  lengthIn: number;
  weightLb: number;
}

export function isCatchPrefill(v: unknown): v is CatchPrefill {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.speciesId === 'string' &&
    o.speciesId in LENGTH_RANGE &&
    typeof o.lengthIn === 'number' &&
    Number.isFinite(o.lengthIn) &&
    typeof o.weightLb === 'number' &&
    Number.isFinite(o.weightLb)
  );
}

export type EntryAction =
  | { type: 'species'; species: SpeciesCode }
  | { type: 'prefill'; prefill: CatchPrefill }
  | { type: 'length'; lengthIn: number; step: number }
  | { type: 'weight'; weightLb: number; step: number }
  | { type: 'photo'; photo: File | null }
  | { type: 'reset' };

export function initialEntry(species: SpeciesCode, lastLength: Partial<Record<SpeciesCode, number>> = {}): EntryState {
  return {
    species,
    lengthIn: lengthFor(species, lastLength),
    weightLb: 0,
    photo: null,
    lastLength,
  };
}

function lengthFor(species: SpeciesCode, lastLength: Partial<Record<SpeciesCode, number>>): number {
  const r = LENGTH_RANGE[species];
  const last = lastLength[species];
  return last === undefined ? r.defaultIn : clamp(last, r.minIn, r.maxIn);
}

export function entryReducer(state: EntryState, action: EntryAction): EntryState {
  switch (action.type) {
    case 'species': {
      if (action.species === state.species) return state;
      return {
        ...state,
        species: action.species,
        lengthIn: lengthFor(action.species, state.lastLength),
        weightLb: 0,
      };
    }
    case 'length': {
      const r = LENGTH_RANGE[state.species];
      const lengthIn = clamp(roundToStep(action.lengthIn, action.step), r.minIn, r.maxIn);
      return { ...state, lengthIn, lastLength: { ...state.lastLength, [state.species]: lengthIn } };
    }
    case 'weight': {
      const weightLb = clamp(roundToStep(action.weightLb, action.step), WEIGHT_MIN_LB, WEIGHT_MAX_LB);
      return { ...state, weightLb };
    }
    case 'prefill': {
      const species = action.prefill.speciesId;
      const r = LENGTH_RANGE[species];
      const lengthIn = clamp(action.prefill.lengthIn, r.minIn, r.maxIn);
      const weightLb = clamp(action.prefill.weightLb, WEIGHT_MIN_LB, WEIGHT_MAX_LB);
      return { ...state, species, lengthIn, weightLb, lastLength: { ...state.lastLength, [species]: lengthIn } };
    }
    case 'photo':
      return { ...state, photo: action.photo };
    case 'reset':
      return { ...state, weightLb: 0, photo: null, lengthIn: lengthFor(state.species, state.lastLength) };
  }
}

export function isEntryValid(state: EntryState, requireWeight: boolean, requirePhoto: boolean): boolean {
  if (state.lengthIn <= 0) return false;
  if (requireWeight && state.weightLb <= 0) return false;
  if (requirePhoto && !state.photo) return false;
  return true;
}

// ---- sessionStorage persistence for last length per species ----
const KEY = 'pt:lastLength';

export function loadLastLength(): Partial<Record<SpeciesCode, number>> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Partial<Record<SpeciesCode, number>> = {};
    for (const code of Object.keys(LENGTH_RANGE) as SpeciesCode[]) {
      const v = (parsed as Record<string, unknown>)[code];
      if (typeof v === 'number' && Number.isFinite(v)) out[code] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveLastLength(map: Partial<Record<SpeciesCode, number>>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}
