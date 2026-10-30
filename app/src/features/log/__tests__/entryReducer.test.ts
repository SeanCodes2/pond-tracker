import { describe, expect, it } from 'vitest';
import { standardWeightLb } from '@pond-tracker/shared';
import { LENGTH_RANGE, WEIGHT_CAP_LB, entryReducer, initialEntry, isEntryValid, suggestedWeight, weightRange } from '../entryReducer';

describe('entryReducer', () => {
  it('starts at the species default length with the standard weight, untouched', () => {
    const s = initialEntry('LMB');
    expect(s.lengthIn).toBe(LENGTH_RANGE.LMB.defaultIn);
    expect(s.weightLb).toBeCloseTo(standardWeightLb('LMB', 12), 1);
    expect(s.weightTouched).toBe(false);
    expect(s.photo).toBeNull();
  });

  it('restores the last length used for a species and suggests its weight', () => {
    const s = initialEntry('LMB', { LMB: 17.5, BLG: 7.25 });
    expect(s.lengthIn).toBe(17.5);
    const b = entryReducer(s, { type: 'species', species: 'BLG' });
    expect(b.lengthIn).toBe(7.25);
    expect(b.weightLb).toBe(suggestedWeight('BLG', 7.25));
    expect(b.weightTouched).toBe(false);
  });

  it('steps and clamps length, remembering it per species', () => {
    let s = initialEntry('LMB');
    s = entryReducer(s, { type: 'length', lengthIn: s.lengthIn + 0.25, step: 0.25 });
    expect(s.lengthIn).toBe(12.25);
    expect(s.lastLength.LMB).toBe(12.25);
    s = entryReducer(s, { type: 'length', lengthIn: 99, step: 0.25 });
    expect(s.lengthIn).toBe(LENGTH_RANGE.LMB.maxIn);
    s = entryReducer(s, { type: 'length', lengthIn: 0, step: 0.25 });
    expect(s.lengthIn).toBe(LENGTH_RANGE.LMB.minIn);
  });

  it('weight follows length until touched, then stays put', () => {
    let s = initialEntry('LMB');
    s = entryReducer(s, { type: 'length', lengthIn: 18, step: 0.25 });
    expect(s.weightLb).toBe(suggestedWeight('LMB', 18));
    s = entryReducer(s, { type: 'weight', weightLb: s.weightLb - 0.25, step: 0.05 });
    const adjusted = s.weightLb;
    expect(s.weightTouched).toBe(true);
    s = entryReducer(s, { type: 'length', lengthIn: 19, step: 0.25 });
    expect(s.weightLb).toBe(adjusted);
  });

  it('confirmWeight marks the suggested weight as entered', () => {
    let s = initialEntry('BLG');
    expect(isEntryValid(s, true, false)).toBe(false);
    s = entryReducer(s, { type: 'confirmWeight' });
    expect(s.weightTouched).toBe(true);
    expect(isEntryValid(s, true, false)).toBe(true);
  });

  it('suggested weight respects the ounce step', () => {
    const oz = 1 / 16;
    const w = suggestedWeight('LMB', 15, oz);
    expect(Math.abs(w * 16 - Math.round(w * 16))).toBeLessThan(0.02);
  });

  it('rounds weight to the step without float drift', () => {
    let s = initialEntry('LMB');
    s = entryReducer(s, { type: 'weight', weightLb: 0, step: 0.05 });
    for (let i = 0; i < 7; i++) s = entryReducer(s, { type: 'weight', weightLb: s.weightLb + 0.05, step: 0.05 });
    expect(s.weightLb).toBe(0.35);
    s = entryReducer(s, { type: 'weight', weightLb: 1 / 16 + 1 / 16, step: 1 / 16 });
    expect(s.weightLb).toBeCloseTo(0.125, 6);
    s = entryReducer(s, { type: 'weight', weightLb: 40, step: 0.05 });
    expect(s.weightLb).toBe(WEIGHT_CAP_LB.LMB);
  });

  it('weight range scales with length and respects species caps', () => {
    const small = weightRange('LMB', 10);
    const big = weightRange('LMB', 20);
    expect(small.max).toBeLessThan(big.min + 3);
    expect(small.min).toBeLessThan(standardWeightLb('LMB', 10));
    expect(small.max).toBeGreaterThan(standardWeightLb('LMB', 10));
    expect(weightRange('LMB', 30).max).toBeLessThanOrEqual(WEIGHT_CAP_LB.LMB);
    expect(weightRange('BLG', 15).max).toBeLessThanOrEqual(WEIGHT_CAP_LB.BLG);
  });

  it('reset keeps species and last length, re-suggests weight, clears photo', () => {
    let s = initialEntry('BLG');
    s = entryReducer(s, { type: 'length', lengthIn: 8, step: 0.25 });
    s = entryReducer(s, { type: 'weight', weightLb: 0.4, step: 0.05 });
    s = entryReducer(s, { type: 'photo', photo: new File([new Uint8Array([1])], 'x.jpg', { type: 'image/jpeg' }) });
    s = entryReducer(s, { type: 'reset' });
    expect(s.species).toBe('BLG');
    expect(s.lengthIn).toBe(8);
    expect(s.weightLb).toBe(suggestedWeight('BLG', 8));
    expect(s.weightTouched).toBe(false);
    expect(s.photo).toBeNull();
  });

  it('validates according to settings', () => {
    const s = initialEntry('LMB');
    expect(isEntryValid(s, true, false)).toBe(false);
    expect(isEntryValid(s, false, false)).toBe(true);
    const w = entryReducer(s, { type: 'weight', weightLb: 1.2, step: 0.05 });
    expect(isEntryValid(w, true, false)).toBe(true);
    expect(isEntryValid(w, true, true)).toBe(false);
  });
});
