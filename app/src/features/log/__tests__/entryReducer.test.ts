import { describe, expect, it } from 'vitest';
import { LENGTH_RANGE, WEIGHT_MAX_LB, entryReducer, initialEntry, isEntryValid } from '../entryReducer';

describe('entryReducer', () => {
  it('starts at the species default length with no weight', () => {
    const s = initialEntry('LMB');
    expect(s.lengthIn).toBe(LENGTH_RANGE.LMB.defaultIn);
    expect(s.weightLb).toBe(0);
    expect(s.photo).toBeNull();
  });

  it('restores the last length used for a species', () => {
    const s = initialEntry('LMB', { LMB: 17.5, BLG: 7.25 });
    expect(s.lengthIn).toBe(17.5);
    const b = entryReducer(s, { type: 'species', species: 'BLG' });
    expect(b.lengthIn).toBe(7.25);
    expect(b.weightLb).toBe(0);
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

  it('rounds weight to the step without float drift', () => {
    let s = initialEntry('LMB');
    for (let i = 0; i < 7; i++) s = entryReducer(s, { type: 'weight', weightLb: s.weightLb + 0.05, step: 0.05 });
    expect(s.weightLb).toBe(0.35);
    s = entryReducer(s, { type: 'weight', weightLb: 1 / 16 + 1 / 16, step: 1 / 16 });
    expect(s.weightLb).toBeCloseTo(0.125, 6);
    s = entryReducer(s, { type: 'weight', weightLb: 40, step: 0.05 });
    expect(s.weightLb).toBe(WEIGHT_MAX_LB);
  });

  it('reset keeps species and last length but clears weight and photo', () => {
    let s = initialEntry('BLG');
    s = entryReducer(s, { type: 'length', lengthIn: 8, step: 0.25 });
    s = entryReducer(s, { type: 'weight', weightLb: 0.4, step: 0.05 });
    s = entryReducer(s, { type: 'photo', photo: new File([new Uint8Array([1])], 'x.jpg', { type: 'image/jpeg' }) });
    s = entryReducer(s, { type: 'reset' });
    expect(s.species).toBe('BLG');
    expect(s.lengthIn).toBe(8);
    expect(s.weightLb).toBe(0);
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
