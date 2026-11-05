import { describe, expect, it } from 'vitest';
import type { CatchRow, CatchWeatherRow } from '../../db/db';
import { byAirTemp, byMoon, byPressureTrend } from '../conditions';

const fish = (id: string, caughtAt: string, wr: number, extra: Partial<CatchRow> = {}) => ({ id, caughtAt, wr, ...extra }) as CatchRow;
const wx = (catchId: string, caughtAt: string, extra: Partial<CatchWeatherRow>) =>
  [catchId, { catchId, caughtAt, status: 'ok', ...extra } as CatchWeatherRow] as const;

describe('dashboard condition buckets', () => {
  const catches = [
    fish('a', '2026-06-01T10:00:00Z', 90),
    fish('b', '2026-06-02T10:00:00Z', 100),
    fish('c', '2026-06-03T10:00:00Z', 110),
    fish('d', '2026-06-04T10:00:00Z', 95, { airTempF: 45 }),
  ];
  const weather = new Map([
    wx('a', '2026-06-01T10:00:00Z', { pressureTrend: 'falling', airTempF: 72 }),
    wx('b', '2026-06-02T10:00:00Z', { pressureTrend: 'falling', airTempF: 79.9 }),
    wx('c', '2026-06-03T10:00:00Z', { pressureTrend: 'rising', airTempF: 91 }),
    // Looked up for an older catch time: ignored until the server refreshes it.
    wx('d', '2026-06-01T00:00:00Z', { pressureTrend: 'steady', airTempF: 60 }),
  ]);

  it('groups by pressure trend with mean Wr', () => {
    expect(byPressureTrend(catches, weather)).toEqual([
      { key: 'falling', label: 'Falling', count: 2, meanWr: 95 },
      { key: 'steady', label: 'Steady', count: 0, meanWr: null },
      { key: 'rising', label: 'Rising', count: 1, meanWr: 110 },
    ]);
  });

  it('groups by air temp, preferring what was typed in', () => {
    const r = Object.fromEntries(byAirTemp(catches, weather).map((b) => [b.key, b.count]));
    expect(r).toEqual({ lt50: 1, '50s': 0, '60s': 0, '70s': 2, '80s': 0, ge90: 1 });
  });

  it('puts catches into moon quarters centred on new and full', () => {
    const r = byMoon([
      fish('n', '2026-01-18T19:52:00Z', 100), // new moon
      fish('n2', '2026-01-15T12:00:00Z', 100), // 3 days before new
      fish('f', '2026-01-03T10:03:00Z', 100), // full moon
      fish('q', '2026-01-26T04:47:00Z', 100), // first quarter
      fish('l', '2026-01-10T15:48:00Z', 100), // last quarter
    ]);
    expect(Object.fromEntries(r.map((b) => [b.key, b.count]))).toEqual({ new: 2, first: 1, full: 1, last: 1 });
  });
});
