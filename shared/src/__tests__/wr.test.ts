import { describe, expect, it } from 'vitest';
import {
  cullHint,
  formatWeight,
  lengthClass,
  parseLbsOz,
  relativeWeight,
  standardWeightLb,
  wrBand,
  DEFAULT_THRESHOLDS,
  SPECIES,
  gToLb,
  inToMm,
  lbToG,
} from '../index.js';

/** Pond Boss standard-weight table (inches -> lb, rounded to 0.1). */
const TABLE: Record<'LMB' | 'BLG' | 'RES', [number, number][]> = {
  LMB: [
    [10, 0.5], [10.5, 0.6], [11, 0.7], [11.5, 0.8], [12, 0.9], [12.5, 1.0], [13, 1.1], [13.5, 1.3],
    [14, 1.5], [14.5, 1.6], [15, 1.8], [15.5, 2.0], [16, 2.2], [16.5, 2.5], [17, 2.7], [17.5, 3.0],
    [18, 3.2], [18.5, 3.5], [19, 3.9], [19.5, 4.2], [20, 4.5], [20.5, 4.9], [21, 5.3], [21.5, 5.7],
    [22, 6.2], [22.5, 6.6], [23, 7.1], [23.5, 7.6], [24, 8.1], [24.5, 8.7], [25, 9.3], [25.5, 9.9],
  ],
  BLG: [
    [6, 0.2], [6.5, 0.2], [7, 0.2], [7.5, 0.3], [8, 0.4], [8.5, 0.4], [9, 0.6], [9.5, 0.7],
    [10, 0.9], [10.5, 1.0], [11, 1.2], [11.5, 1.4], [12, 1.6], [12.5, 1.8], [13, 2.1], [13.5, 2.4],
    [14, 2.7], [14.5, 3.0], [15, 3.4],
  ],
  RES: [
    [6, 0.1], [6.5, 0.2], [7, 0.3], [7.5, 0.3], [8, 0.4], [8.5, 0.5], [9, 0.5], [9.5, 0.6],
    [10, 0.7], [10.5, 0.8], [11, 1.0], [11.5, 1.1], [12, 1.3], [12.5, 1.4], [13, 1.6], [13.5, 1.8],
    [14, 2.1], [14.5, 2.3], [15, 2.5],
  ],
};

/**
 * Rows where the published (rounded) table disagrees with the regression by
 * more than 0.06 lb. Tolerance for these rows is loosened (0.1 where that is
 * enough); coefficients are never adjusted to fit the table.
 *
 * NOTE: LMB uses Wege & Anderson (1978) (-5.316, 3.191), which is the equation
 * the Pond Boss table was generated from; every LMB row lands within 0.12 lb.
 * (Henson 1991, -5.528/3.273, drifts up to +0.5 lb from the table above 18 in.)
 */
const LOOSE: Record<string, number> = {
  // BLG
  'BLG:7': 0.1,
  'BLG:8.5': 0.12,
  // RES
  'RES:10.5': 0.1,
  'RES:11.5': 0.1,
  'RES:12.5': 0.12,
  'RES:13': 0.12,
  'RES:13.5': 0.13,
  'RES:14.5': 0.1,
  'RES:15': 0.17,
};

describe('standardWeightLb vs Pond Boss table', () => {
  for (const code of ['LMB', 'BLG', 'RES'] as const) {
    for (const [inches, lb] of TABLE[code]) {
      it(`${code} ${inches} in ≈ ${lb} lb`, () => {
        const ws = standardWeightLb(code, inches);
        const tol = LOOSE[`${code}:${inches}`] ?? (code === 'LMB' ? 0.12 : 0.06);
        expect(Math.abs(ws - lb)).toBeLessThanOrEqual(tol);
      });
    }
  }

  it('throws on non-positive length', () => {
    expect(() => standardWeightLb('LMB', 0)).toThrow(RangeError);
    expect(() => standardWeightLb('LMB', -3)).toThrow(RangeError);
  });

  it('accepts a Species object', () => {
    expect(standardWeightLb(SPECIES.LMB, 15)).toBeCloseTo(standardWeightLb('LMB', 15), 10);
  });
});

describe('unit conversions', () => {
  it('round-trips', () => {
    expect(inToMm(1)).toBeCloseTo(25.4);
    expect(gToLb(lbToG(2.5))).toBeCloseTo(2.5, 10);
  });
});

describe('relativeWeight', () => {
  it('15 in / 1.5 lb bass ≈ 83', () => {
    const wr = relativeWeight('LMB', 15, 1.5);
    expect(Math.abs(wr - 83)).toBeLessThanOrEqual(1.5);
  });
  it('100 when weight equals Ws', () => {
    const ws = standardWeightLb('BLG', 8);
    expect(relativeWeight('BLG', 8, ws)).toBeCloseTo(100, 10);
  });
});

describe('wrBand', () => {
  it('uses default thresholds', () => {
    expect(wrBand(80)).toBe('low');
    expect(wrBand(85)).toBe('fair');
    expect(wrBand(94.9)).toBe('fair');
    expect(wrBand(95)).toBe('good');
    expect(wrBand(109.9)).toBe('good');
    expect(wrBand(110)).toBe('excellent');
  });
  it('honours custom thresholds', () => {
    expect(wrBand(90, { low: 92, ok: 100, high: 115 })).toBe('low');
  });
});

describe('cullHint', () => {
  const pond = { cullSlotMinIn: 8, cullSlotMaxIn: 13, wrThresholds: DEFAULT_THRESHOLDS };
  it('bass in slot and thin => keep', () => {
    const r = cullHint('LMB', 10, 88, pond);
    expect(r.hint).toBe('keep');
    expect(r.reason.length).toBeLessThanOrEqual(40);
  });
  it('bass in slot and healthy => your-call', () => {
    expect(cullHint('LMB', 10, 95, pond).hint).toBe('your-call');
    expect(cullHint('LMB', 12, 112, pond).hint).toBe('your-call');
  });
  it('slot bounds are inclusive', () => {
    expect(cullHint('LMB', 8, 85, pond).hint).toBe('keep');
    expect(cullHint('LMB', 13, 85, pond).hint).toBe('keep');
  });
  it('bass over slot => release regardless of condition', () => {
    expect(cullHint('LMB', 16, 90, pond).hint).toBe('release');
    expect(cullHint('LMB', 16, 70, pond).hint).toBe('release');
  });
  it('bass below slot: thin => keep, otherwise your-call', () => {
    expect(cullHint('LMB', 6, 80, pond).hint).toBe('keep');
    expect(cullHint('LMB', 6, 90, pond).hint).toBe('your-call');
  });
  it('bluegill by Wr', () => {
    expect(cullHint('BLG', 7, 80, pond).hint).toBe('keep');
    expect(cullHint('BLG', 7, 90, pond).hint).toBe('your-call');
    expect(cullHint('BLG', 7, 95, pond).hint).toBe('release');
    expect(cullHint('RES', 7, 70, pond).hint).toBe('keep');
  });
  it('reasons are short', () => {
    for (const [sp, len, wr] of [['LMB', 6, 80], ['LMB', 6, 90], ['LMB', 10, 80], ['LMB', 10, 100], ['LMB', 16, 90], ['BLG', 7, 70], ['BLG', 7, 90], ['BLG', 7, 99]] as const) {
      expect(cullHint(sp, len, wr, pond).reason.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('formatWeight / parseLbsOz', () => {
  it('decimal', () => {
    expect(formatWeight(2.35, 'decimal')).toBe('2.35 lb');
    expect(formatWeight(2, 'decimal')).toBe('2.00 lb');
  });
  it('lbsOz', () => {
    expect(formatWeight(2.375, 'lbsOz')).toBe('2 lb 6 oz');
    expect(formatWeight(2.35, 'lbsOz')).toBe('2 lb 6 oz');
    expect(formatWeight(1.99, 'lbsOz')).toBe('2 lb 0 oz'); // 31.84 oz rounds to 32, carries
    expect(formatWeight(0.5, 'lbsOz')).toBe('0 lb 8 oz');
  });
  it('parseLbsOz', () => {
    expect(parseLbsOz(2, 6)).toBeCloseTo(2.375, 10);
    expect(parseLbsOz(0, 8)).toBe(0.5);
  });
});

describe('lengthClass', () => {
  it('bass cutoffs', () => {
    expect(lengthClass('LMB', 7.9)).toBe('sub-stock');
    expect(lengthClass('LMB', 8)).toBe('stock');
    expect(lengthClass('LMB', 12)).toBe('quality');
    expect(lengthClass('LMB', 15)).toBe('preferred');
    expect(lengthClass('LMB', 20)).toBe('memorable');
    expect(lengthClass('LMB', 24)).toBe('memorable');
  });
  it('bluegill cutoffs', () => {
    expect(lengthClass('BLG', 5)).toBe('stock');
    expect(lengthClass('BLG', 6.5)).toBe('quality');
    expect(lengthClass('BLG', 8)).toBe('preferred');
    expect(lengthClass('BLG', 10)).toBe('memorable');
  });
});
