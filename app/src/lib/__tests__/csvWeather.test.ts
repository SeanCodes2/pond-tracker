import { describe, expect, it } from 'vitest';
import type { Catch } from '@pond-tracker/shared';
import { catchesToCsv } from '../csv';

const c = (extra: Partial<Catch> = {}): Catch =>
  ({
    id: 'C1',
    pondId: 'P1',
    speciesId: 'LMB',
    lengthIn: 15,
    weightLb: 1.5,
    wsLb: 1.8,
    wr: 83,
    outcome: 'released',
    caughtAt: '2026-01-03T10:03:00.000Z',
    createdAt: '2026-01-03T10:03:00.000Z',
    updatedAt: '2026-01-03T10:03:00.000Z',
    ...extra,
  }) as Catch;

const parse = (csv: string) => {
  const [head, row] = csv.trim().split('\r\n');
  const keys = head!.split(',');
  const vals = row!.split(',');
  return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
};

describe('CSV weather columns', () => {
  const wx = {
    status: 'ok' as const,
    caughtAt: '2026-01-03T10:03:00.000Z',
    airTempF: 31.4,
    pressureInHg: 30.12,
    pressureChange3hInHg: -0.05,
    pressureTrend: 'falling' as const,
    windMph: 9,
    windDirDeg: 200,
    cloudPct: 75,
  };

  it('adds looked-up weather and the moon', () => {
    const r = parse(catchesToCsv([c()], [{ id: 'P1', name: 'Big' } as never], new Map([['C1', wx]])));
    expect(r).toMatchObject({ airTempF: '31.4', pressureInHg: '30.12', pressureTrend: 'falling', windMph: '9', cloudPct: '75', moonPhase: 'Full moon' });
  });

  it('prefers a typed-in air temp and ignores weather for an old catch time', () => {
    expect(parse(catchesToCsv([c({ airTempF: 40 })], [], new Map([['C1', wx]])))['airTempF']).toBe('40');
    const stale = parse(catchesToCsv([c({ caughtAt: '2026-01-05T10:00:00.000Z' })], [], new Map([['C1', wx]])));
    expect(stale['pressureInHg']).toBe('');
  });
});
