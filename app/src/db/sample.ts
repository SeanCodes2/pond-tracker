import type { Outcome, SpeciesCode } from '@pond-tracker/shared';
import { standardWeightLb } from '@pond-tracker/shared';

/**
 * Deterministic demo data generator. Pure: no database access, no Date.now().
 * The story it tells: crowded small bass (low Wr under 12 in, better over 15 in)
 * and healthy, fed bluegill (Wr ~104).
 */

export const SAMPLE_POND_NAME = 'Sample pond';
export const SAMPLE_SEED = 0x5eed_2026;

export interface SampleCatchInput {
  speciesId: SpeciesCode;
  lengthIn: number;
  weightLb: number;
  outcome: Outcome;
  caughtAt: string;
  waterTempF: number;
  lure?: string;
}

export interface SampleFeedingLogInput {
  startedOn: string;
  endedOn?: string;
  feederModel?: string;
  secondsPerFeed?: number;
  feedsPerDay?: number;
  pelletSizeMm?: number;
  lbsPerFill?: number;
  filledOn?: string;
  notes?: string;
}

/** mulberry32: small, fast, seedable PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller. */
function gaussian(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const roundTo = (x: number, step: number): number => Math.round(x / step) * step;

/** Round a weight the way an angler reads a scale: 0.05 lb over a pound, 0.01 lb under. */
function roundWeight(lb: number): number {
  const step = lb >= 1 ? 0.05 : 0.01;
  return Math.max(step, Number(roundTo(lb, step).toFixed(2)));
}

const BASS_LURES = ['Senko', 'Spinnerbait', 'Chatterbait', 'Topwater frog', 'Ned rig', 'Square bill'];
const BLUEGILL_LURES = ['Cricket', 'Worm', 'Beetle spin', 'Fly'];

/** Approximate pond surface temperature by month (0-based) for eastern Kansas. */
const WATER_TEMP_BY_MONTH = [38, 42, 50, 60, 70, 79, 84, 83, 76, 65, 52, 42];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Build a local-time ISO timestamp for year/month(0-based)/day at hour:minute. */
function localIso(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month, day, hour, minute, 0, 0).toISOString();
}

/** 18 trip dates spread over March–October, sorted. */
function tripDates(rand: () => number): { month: number; day: number }[] {
  const trips: { month: number; day: number }[] = [];
  const count = 18;
  for (let i = 0; i < count; i++) {
    const month = 2 + Math.floor((i * 8) / count); // Mar (2) .. Oct (9)
    const day = 1 + Math.floor(rand() * 28);
    trips.push({ month, day });
  }
  return trips.sort((a, b) => a.month - b.month || a.day - b.day);
}

function bassLength(rand: () => number): number {
  // 82% in the crowded 9–15 in band, the rest a tail out to 19.5 in.
  const len = rand() < 0.82 ? clamp(12 + gaussian(rand) * 1.7, 9, 15) : 15 + Math.pow(rand(), 1.6) * 4.5;
  return roundTo(len, 0.25);
}

function bassWr(lengthIn: number, rand: () => number): number {
  // Small bass skinny (stock+quality mean must land under the 85 "low" cut),
  // bigger bass in good shape: the classic crowded-bass signature.
  const mean = lengthIn < 12 ? 80 : lengthIn < 15 ? 86 : 103;
  return clamp(mean + gaussian(rand) * 6, 60, 130);
}

function bluegillLength(rand: () => number): number {
  const len = rand() < 0.08 ? 9.5 + rand() * 1 : clamp(7.2 + gaussian(rand) * 1.2, 5, 9.5);
  return roundTo(len, 0.25);
}

function bassOutcome(lengthIn: number, rand: () => number): Outcome {
  const keepP = lengthIn < 13 ? 0.6 : lengthIn <= 14 ? 0.3 : 0.05;
  return rand() < keepP ? 'kept' : 'released';
}

export function generateSampleCatches(year: number, seed = SAMPLE_SEED): SampleCatchInput[] {
  const rand = mulberry32(seed);
  const trips = tripDates(rand);
  const out: SampleCatchInput[] = [];

  const push = (speciesId: SpeciesCode, lengthIn: number, wr: number, outcome: Outcome, lures: string[]) => {
    const trip = trips[Math.floor(rand() * trips.length)] ?? { month: 5, day: 15 };
    const hour = 17 + Math.floor(rand() * 4); // 17:00–20:59
    const minute = Math.floor(rand() * 60);
    const weightLb = roundWeight(standardWeightLb(speciesId, lengthIn) * (wr / 100));
    const tempJitter = Math.round((rand() - 0.5) * 6);
    out.push({
      speciesId,
      lengthIn,
      weightLb,
      outcome,
      caughtAt: localIso(year, trip.month, trip.day, hour, minute),
      waterTempF: (WATER_TEMP_BY_MONTH[trip.month] ?? 65) + tempJitter,
      lure: rand() < 0.7 ? lures[Math.floor(rand() * lures.length)] : undefined,
    });
  };

  for (let i = 0; i < 45; i++) {
    const len = bassLength(rand);
    push('LMB', len, bassWr(len, rand), bassOutcome(len, rand), BASS_LURES);
  }
  for (let i = 0; i < 35; i++) {
    const len = bluegillLength(rand);
    push('BLG', len, clamp(104 + gaussian(rand) * 7, 75, 130), rand() < 0.4 ? 'kept' : 'released', BLUEGILL_LURES);
  }

  return out.sort((a, b) => a.caughtAt.localeCompare(b.caughtAt));
}

export function generateSampleFeedingLogs(year: number): SampleFeedingLogInput[] {
  return [
    {
      startedOn: `${year}-04-01`,
      endedOn: `${year}-10-15`,
      feederModel: 'Directional feeder',
      feedsPerDay: 2,
      secondsPerFeed: 8,
      pelletSizeMm: 4.5,
      lbsPerFill: 50,
      filledOn: `${year}-08-${pad(20)}`,
      notes: 'Season program: 2 feeds/day, 8 s each',
    },
    {
      startedOn: `${year}-06-14`,
      endedOn: `${year}-06-14`,
      lbsPerFill: 50,
      filledOn: `${year}-06-14`,
      notes: 'Hopper refill',
    },
  ];
}
