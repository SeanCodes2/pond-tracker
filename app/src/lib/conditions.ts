/**
 * Groups catches by the conditions they were caught in, for the dashboard.
 *
 * Counts here are catches, not catch rate: the app knows when you caught fish, not when you fished
 * and caught nothing. So "most fish on falling pressure" can also mean "you fish most on falling
 * pressure". The Wr per group doesn't have that problem.
 */
import { moonPhase, type PressureTrend } from '@pond-tracker/shared';
import type { CatchRow, CatchWeatherRow } from '../db/db';

export interface ConditionBucket {
  key: string;
  label: string;
  count: number;
  /** Mean Wr of the catches in the bucket that have one. */
  meanWr: number | null;
}

/** Weather that matches the catch's current time; anything else is stale until the next sync. */
export function currentWeather(c: CatchRow, byCatch: ReadonlyMap<string, CatchWeatherRow>): CatchWeatherRow | undefined {
  const w = byCatch.get(c.id);
  return w?.status === 'ok' && w.caughtAt === c.caughtAt ? w : undefined;
}

function bucketize<K extends string>(catches: readonly CatchRow[], order: readonly { key: K; label: string }[], keyOf: (c: CatchRow) => K | undefined): ConditionBucket[] {
  const groups = new Map<K, CatchRow[]>(order.map((o) => [o.key, []]));
  for (const c of catches) {
    const k = keyOf(c);
    if (k !== undefined) groups.get(k)?.push(c);
  }
  return order.map(({ key, label }) => {
    const list = groups.get(key) ?? [];
    const wrs = list.map((c) => c.wr).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return { key, label, count: list.length, meanWr: wrs.length ? wrs.reduce((a, b) => a + b, 0) / wrs.length : null };
  });
}

const TRENDS: { key: PressureTrend; label: string }[] = [
  { key: 'falling', label: 'Falling' },
  { key: 'steady', label: 'Steady' },
  { key: 'rising', label: 'Rising' },
];

export function byPressureTrend(catches: readonly CatchRow[], byCatch: ReadonlyMap<string, CatchWeatherRow>): ConditionBucket[] {
  return bucketize(catches, TRENDS, (c) => currentWeather(c, byCatch)?.pressureTrend);
}

const MOON: { key: 'new' | 'first' | 'full' | 'last'; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'first', label: 'Waxing' },
  { key: 'full', label: 'Full' },
  { key: 'last', label: 'Waning' },
];

/** Four buckets of about a week each, centred on new and full moon. Needs no weather. */
export function byMoon(catches: readonly CatchRow[]): ConditionBucket[] {
  return bucketize(catches, MOON, (c) => {
    // Shift by an eighth of a cycle so each bucket is centred on its phase.
    const age = (moonPhase(c.caughtAt).age + 1 / 8) % 1;
    return MOON[Math.floor(age * 4)]!.key;
  });
}

const TEMPS = [
  { key: 'lt50', label: '<50°' },
  { key: '50s', label: '50s' },
  { key: '60s', label: '60s' },
  { key: '70s', label: '70s' },
  { key: '80s', label: '80s' },
  { key: 'ge90', label: '90+' },
] as const;
type TempKey = (typeof TEMPS)[number]['key'];

/** Air temperature: what you typed in, else the looked-up value. */
export function byAirTemp(catches: readonly CatchRow[], byCatch: ReadonlyMap<string, CatchWeatherRow>): ConditionBucket[] {
  return bucketize(catches, TEMPS, (c): TempKey | undefined => {
    const t = c.airTempF ?? currentWeather(c, byCatch)?.airTempF;
    if (t === undefined) return undefined;
    if (t < 50) return 'lt50';
    if (t >= 90) return 'ge90';
    return (['50s', '60s', '70s', '80s'] as const)[Math.floor((t - 50) / 10)]!;
  });
}
