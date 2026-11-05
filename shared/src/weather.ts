/**
 * Weather at the time and place of a catch, and moon phase.
 *
 * Weather is looked up by the server during sync (see api/src/weather.ts) and stored as its own
 * record per catch, so it never collides with edits to the catch itself.
 */

export type PressureTrend = 'rising' | 'steady' | 'falling';

export interface CatchWeather {
  /** `wx_<catchId>` */
  id: string;
  catchId: string;
  pondId: string;
  /** 'unavailable' when the weather service had no data for that time and place. */
  status: 'ok' | 'unavailable';
  /** The catch time and place the lookup was for; a change to either triggers a new lookup. */
  caughtAt: string;
  lat: number;
  lon: number;
  airTempF?: number;
  /** Sea-level pressure, inches of mercury. */
  pressureInHg?: number;
  /** Change over the 3 hours before the catch, inHg. */
  pressureChange3hInHg?: number;
  pressureTrend?: PressureTrend;
  windMph?: number;
  /** Direction the wind blows FROM, degrees. */
  windDirDeg?: number;
  cloudPct?: number;
  source: 'open-meteo';
  updatedAt: string;
}

/** 1 hPa over 3 hours is the usual line between "steady" and a real change. */
export const PRESSURE_TREND_THRESHOLD_INHG = 0.03;

export function pressureTrend(changeInHg: number): PressureTrend {
  if (changeInHg >= PRESSURE_TREND_THRESHOLD_INHG) return 'rising';
  if (changeInHg <= -PRESSURE_TREND_THRESHOLD_INHG) return 'falling';
  return 'steady';
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** 225 → "SW" */
export function compassPoint(deg: number): (typeof COMPASS)[number] {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i]!;
}

// ---------------------------------------------------------------------------------------------
// Moon
// ---------------------------------------------------------------------------------------------

export type MoonPhaseName =
  | 'New moon'
  | 'Waxing crescent'
  | 'First quarter'
  | 'Waxing gibbous'
  | 'Full moon'
  | 'Waning gibbous'
  | 'Last quarter'
  | 'Waning crescent';

export interface MoonPhase {
  /** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  age: number;
  /** Fraction of the disc lit, 0–1. */
  illumination: number;
  name: MoonPhaseName;
}

const SYNODIC_DAYS = 29.530588853;
/** A known new moon: 2000-01-06 18:14 UTC. */
const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const NAMES: MoonPhaseName[] = [
  'New moon',
  'Waxing crescent',
  'First quarter',
  'Waxing gibbous',
  'Full moon',
  'Waning gibbous',
  'Last quarter',
  'Waning crescent',
];

/** Mean-motion approximation: within about half a day of the true phase, plenty for fishing. */
export function moonPhase(at: Date | string): MoonPhase {
  const ms = typeof at === 'string' ? Date.parse(at) : at.getTime();
  const days = (ms - REFERENCE_NEW_MOON_MS) / 86_400_000;
  const age = (((days / SYNODIC_DAYS) % 1) + 1) % 1;
  const illumination = (1 - Math.cos(2 * Math.PI * age)) / 2;
  // Eight named phases centred on new, first quarter, full and last quarter.
  const name = NAMES[Math.floor(age * 8 + 0.5) % 8]!;
  return { age, illumination, name };
}
