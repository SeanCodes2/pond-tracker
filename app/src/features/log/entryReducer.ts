import type { SpeciesCode } from '@pond-tracker/shared';
import { standardWeightLb } from '@pond-tracker/shared';
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
/** Hard ceilings per species — comfortably above state-record fish (Kansas LMB record is 11.8 lb). */
export const WEIGHT_CAP_LB: Record<SpeciesCode, number> = { LMB: 13, BLG: 4, RES: 5 };

/** The weight slider/stepper spans relative weight 50–160 for the current length. */
const WR_RANGE = { min: 0.5, max: 1.6 };

export function weightRange(species: SpeciesCode, lengthIn: number, weightStep = 0.05): { min: number; max: number } {
  const ws = standardWeightLb(species, lengthIn);
  const min = Math.max(weightStep, roundToStep(ws * WR_RANGE.min, weightStep));
  const max = Math.min(WEIGHT_CAP_LB[species], Math.max(min + weightStep, roundToStep(ws * WR_RANGE.max, weightStep)));
  return { min, max };
}

export interface EntryState {
  species: SpeciesCode;
  lengthIn: number;
  /**
   * Starts at the standard weight for the current length and follows the length until the
   * user adjusts it (weightTouched). The user only nudges it to what the scale says.
   */
  weightLb: number;
  /** True once the user has adjusted or confirmed the weight. */
  weightTouched: boolean;
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
  | { type: 'species'; species: SpeciesCode; weightStep?: number }
  | { type: 'prefill'; prefill: CatchPrefill }
  | { type: 'length'; lengthIn: number; step: number; weightStep?: number }
  | { type: 'weight'; weightLb: number; step: number }
  | { type: 'confirmWeight' }
  | { type: 'photo'; photo: File | null }
  | { type: 'reset'; weightStep?: number };

const DEFAULT_WEIGHT_STEP = 0.05;

/** Standard weight for a length, rounded to the weight step so the +/- buttons land on clean values. */
export function suggestedWeight(species: SpeciesCode, lengthIn: number, weightStep = DEFAULT_WEIGHT_STEP): number {
  const ws = standardWeightLb(species, lengthIn);
  return clamp(Math.max(weightStep, roundToStep(ws, weightStep)), WEIGHT_MIN_LB, WEIGHT_CAP_LB[species]);
}

export function initialEntry(
  species: SpeciesCode,
  lastLength: Partial<Record<SpeciesCode, number>> = {},
  weightStep = DEFAULT_WEIGHT_STEP,
): EntryState {
  const lengthIn = lengthFor(species, lastLength);
  return {
    species,
    lengthIn,
    weightLb: suggestedWeight(species, lengthIn, weightStep),
    weightTouched: false,
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
      const lengthIn = lengthFor(action.species, state.lastLength);
      return {
        ...state,
        species: action.species,
        lengthIn,
        weightLb: suggestedWeight(action.species, lengthIn, action.weightStep),
        weightTouched: false,
      };
    }
    case 'length': {
      const r = LENGTH_RANGE[state.species];
      const lengthIn = clamp(roundToStep(action.lengthIn, action.step), r.minIn, r.maxIn);
      const weightLb = state.weightTouched ? state.weightLb : suggestedWeight(state.species, lengthIn, action.weightStep);
      return { ...state, lengthIn, weightLb, lastLength: { ...state.lastLength, [state.species]: lengthIn } };
    }
    case 'weight': {
      const weightLb = clamp(roundToStep(action.weightLb, action.step), WEIGHT_MIN_LB, WEIGHT_CAP_LB[state.species]);
      return { ...state, weightLb, weightTouched: true };
    }
    case 'confirmWeight':
      return state.weightLb > 0 ? { ...state, weightTouched: true } : state;
    case 'prefill': {
      const species = action.prefill.speciesId;
      const r = LENGTH_RANGE[species];
      const lengthIn = clamp(action.prefill.lengthIn, r.minIn, r.maxIn);
      const weightLb = clamp(action.prefill.weightLb, WEIGHT_MIN_LB, WEIGHT_CAP_LB[species]);
      return { ...state, species, lengthIn, weightLb, weightTouched: weightLb > 0, lastLength: { ...state.lastLength, [species]: lengthIn } };
    }
    case 'photo':
      return { ...state, photo: action.photo };
    case 'reset': {
      const lengthIn = lengthFor(state.species, state.lastLength);
      return {
        ...state,
        lengthIn,
        weightLb: suggestedWeight(state.species, lengthIn, action.weightStep),
        weightTouched: false,
        photo: null,
      };
    }
  }
}

export function isEntryValid(state: EntryState, requireWeight: boolean, requirePhoto: boolean): boolean {
  if (state.lengthIn <= 0) return false;
  if (requireWeight && (state.weightLb <= 0 || !state.weightTouched)) return false;
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
