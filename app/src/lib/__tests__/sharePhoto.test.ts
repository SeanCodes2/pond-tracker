import { describe, expect, it } from 'vitest';
import type { CatchRow } from '../../db/db';
import { photoCaption, photoFileName } from '../sharePhoto';

const c = {
  id: 'c1',
  pondId: 'p1',
  speciesId: 'LMB',
  lengthIn: 12.25,
  weightLb: 0.97,
  caughtAt: '2026-10-30T21:59:00.000Z',
} as unknown as CatchRow;

describe('photoFileName', () => {
  it('names the file by pond, local date, length and species', () => {
    const d = new Date(c.caughtAt);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(photoFileName(c, 'Home Pond', 'image/jpeg')).toBe(`home-pond-${date}-12.25in-bass.jpg`);
  });

  it('leaves out a missing pond and picks the extension from the type', () => {
    expect(photoFileName({ ...c, lengthIn: 8 }, undefined, 'image/webp')).toMatch(/^\d{4}-\d{2}-\d{2}-8in-bass\.webp$/);
  });
});

describe('photoCaption', () => {
  it('describes the fish and pond', () => {
    expect(photoCaption(c, { pondName: 'Home', units: 'decimal' })).toMatch(/^12\.25 in bass, .+ · Home$/);
  });

  it('skips weight when none was recorded', () => {
    expect(photoCaption({ ...c, weightLb: 0 }, { units: 'decimal' })).toBe('12.25 in bass');
  });
});
