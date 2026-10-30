import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SLOT,
  DEFAULT_THRESHOLDS,
  SPECIES,
  lengthFrequency,
  pondGuidance,
  psd,
  wrByClass,
} from '../index.js';

describe('species constants', () => {
  it('match the contract', () => {
    expect(SPECIES.LMB).toMatchObject({ a: -5.316, b: 3.191, stockIn: 8, qualityIn: 12, preferredIn: 15, memorableIn: 20, enabled: true });
    expect(SPECIES.BLG).toMatchObject({ a: -5.374, b: 3.316, stockIn: 3, qualityIn: 6, preferredIn: 8, memorableIn: 10, enabled: true });
    expect(SPECIES.RES).toMatchObject({ a: -4.968, b: 3.119, stockIn: 4, qualityIn: 7, preferredIn: 9, memorableIn: 11, enabled: false });
    expect(DEFAULT_THRESHOLDS).toEqual({ low: 85, ok: 95, high: 110 });
    expect(DEFAULT_SLOT).toEqual({ minIn: 8, maxIn: 13 });
    expect(DEFAULT_SETTINGS.id).toBe('settings');
    expect(DEFAULT_SETTINGS.defaultSlot).toEqual(DEFAULT_SLOT);
  });
});

describe('psd', () => {
  it('LMB example', () => {
    const r = psd('LMB', [9, 10, 13, 14, 15, 7]);
    expect(r.nStock).toBe(5);
    expect(r.nQuality).toBe(3);
    expect(r.psd).toBe(60);
  });
  it('null when no stock fish', () => {
    expect(psd('LMB', [5, 6])).toEqual({ psd: null, nStock: 0, nQuality: 0 });
    expect(psd('LMB', [])).toEqual({ psd: null, nStock: 0, nQuality: 0 });
  });
});

describe('wrByClass', () => {
  it('groups by Gabelhouse class and ignores sub-stock', () => {
    const r = wrByClass('LMB', [
      { lengthIn: 6, wr: 50 }, // sub-stock, ignored
      { lengthIn: 9, wr: 80 },
      { lengthIn: 10, wr: 90 },
      { lengthIn: 13, wr: 100 },
      { lengthIn: 16, wr: 110 },
    ]);
    expect(r.map((s) => s.cls)).toEqual(['stock', 'quality', 'preferred', 'memorable']);
    expect(r[0]).toEqual({ cls: 'stock', n: 2, meanWr: 85 });
    expect(r[1]).toEqual({ cls: 'quality', n: 1, meanWr: 100 });
    expect(r[2]).toEqual({ cls: 'preferred', n: 1, meanWr: 110 });
    expect(r[3]).toEqual({ cls: 'memorable', n: 0, meanWr: null });
  });
});

describe('lengthFrequency', () => {
  it('floors into 1-inch bins sorted ascending', () => {
    expect(lengthFrequency([12.75, 12.1, 9.5, 14, 9])).toEqual([
      { binStartIn: 9, n: 2 },
      { binStartIn: 12, n: 2 },
      { binStartIn: 14, n: 1 },
    ]);
  });
  it('supports 0.5-inch bins', () => {
    expect(lengthFrequency([12.75, 12.1, 12.5], 0.5)).toEqual([
      { binStartIn: 12, n: 1 },
      { binStartIn: 12.5, n: 2 },
    ]);
  });
  it('empty input', () => {
    expect(lengthFrequency([])).toEqual([]);
  });
});

describe('pondGuidance', () => {
  it('reports progress when under minN', () => {
    const r = pondGuidance('LMB', [{ lengthIn: 10, wr: 80 }], 30);
    expect(r.summary).toBe('1 of 30 catches logged – more data needed');
    expect(r.actions).toEqual([]);
    expect(r.species).toBe('LMB');
  });

  it('detects crowded small bass', () => {
    const catches = [
      ...Array.from({ length: 20 }, (_, i) => ({ lengthIn: 9 + (i % 5), wr: 78 })), // 9-13 in, skinny
      ...Array.from({ length: 10 }, (_, i) => ({ lengthIn: 16 + (i % 3), wr: 100 })), // 16-18 in, healthy
    ];
    const r = pondGuidance('LMB', catches, 30);
    expect(r.summary).toBe('Too many small bass competing for forage');
    expect(r.actions).toEqual(['Harvest bass in the slot aggressively', 'Release bass over the slot']);
    expect(r.summary.length).toBeLessThan(60);
  });

  it('detects forage short overall', () => {
    const catches = Array.from({ length: 30 }, (_, i) => ({ lengthIn: 9 + (i % 10), wr: 75 }));
    const r = pondGuidance('LMB', catches, 30);
    expect(r.summary).toBe('Forage short overall');
    expect(r.actions).toContain('Harvest bass');
  });

  it('detects well fed bass', () => {
    const catches = Array.from({ length: 30 }, (_, i) => ({ lengthIn: 9 + (i % 10), wr: 112 }));
    const r = pondGuidance('LMB', catches, 30);
    expect(r.summary).toBe('Well fed, growing');
    expect(r.actions).toEqual(['Leave them alone']);
  });

  it('bluegill stunted vs feeder working', () => {
    const stunted = Array.from({ length: 30 }, () => ({ lengthIn: 5, wr: 80 }));
    expect(pondGuidance('BLG', stunted).summary).toBe('Bluegill crowded and stunted');
    expect(pondGuidance('BLG', stunted).actions).toEqual(['Stop harvesting bass', 'Thin bluegill']);
    const fat = Array.from({ length: 30 }, () => ({ lengthIn: 7, wr: 105 }));
    expect(pondGuidance('BLG', fat).summary).toBe('Feeder working, forage in good shape');
    expect(pondGuidance('BLG', fat).actions).toEqual(['Keep bass harvest modest']);
  });

  it('all summaries under 60 chars', () => {
    const cases = [
      pondGuidance('LMB', Array.from({ length: 30 }, () => ({ lengthIn: 12, wr: 100 }))),
      pondGuidance('BLG', Array.from({ length: 30 }, () => ({ lengthIn: 6, wr: 90 }))),
    ];
    for (const c of cases) expect(c.summary.length).toBeLessThan(60);
  });
});
