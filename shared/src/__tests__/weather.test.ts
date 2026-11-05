import { describe, expect, it } from 'vitest';
import { compassPoint, moonPhase, pressureTrend } from '../weather';

describe('moonPhase', () => {
  // Published phases (UTC), checked against USNO tables.
  it.each([
    ['2026-01-03T10:03:00Z', 'Full moon'],
    ['2026-01-18T19:52:00Z', 'New moon'],
    ['2026-01-10T15:48:00Z', 'Last quarter'],
    ['2026-01-26T04:47:00Z', 'First quarter'],
    ['2026-10-26T05:12:00Z', 'Full moon'],
  ])('%s is a %s', (when, name) => {
    expect(moonPhase(when).name).toBe(name);
  });

  it('illumination runs 0 at new to 1 at full', () => {
    expect(moonPhase('2026-01-18T19:52:00Z').illumination).toBeLessThan(0.02);
    expect(moonPhase('2026-01-03T10:03:00Z').illumination).toBeGreaterThan(0.98);
    const q = moonPhase('2026-01-26T04:47:00Z').illumination;
    expect(q).toBeGreaterThan(0.4);
    expect(q).toBeLessThan(0.6);
  });

  it('works before the reference date', () => {
    const p = moonPhase('1999-12-22T17:31:00Z'); // full moon
    expect(p.name).toBe('Full moon');
  });
});

describe('pressureTrend', () => {
  it('needs about 1 hPa over 3 hours to call a change', () => {
    expect(pressureTrend(0.05)).toBe('rising');
    expect(pressureTrend(-0.04)).toBe('falling');
    expect(pressureTrend(0.01)).toBe('steady');
    expect(pressureTrend(-0.02)).toBe('steady');
  });
});

describe('compassPoint', () => {
  it.each([
    [0, 'N'],
    [22, 'N'],
    [23, 'NE'],
    [225, 'SW'],
    [350, 'N'],
    [-90, 'W'],
    [720, 'N'],
  ])('%d° is %s', (deg, point) => {
    expect(compassPoint(deg)).toBe(point);
  });
});
