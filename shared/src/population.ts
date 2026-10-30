import type { Catch, Species, SpeciesCode, WrThresholds } from './types.js';
import { DEFAULT_THRESHOLDS, resolveSpecies } from './species.js';
import { lengthClass } from './wr.js';

/** Mean Wr and count for one Gabelhouse length category. */
export interface ClassStat {
  cls: 'stock' | 'quality' | 'preferred' | 'memorable';
  n: number;
  /** Mean relative weight, or null when n === 0. */
  meanWr: number | null;
}

const CLASSES: ClassStat['cls'][] = ['stock', 'quality', 'preferred', 'memorable'];

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Proportional Size Distribution (PSD, formerly PSD/RSD):
 * percent of stock-size fish that are also quality size or larger.
 * Returns psd null when there are no stock-size fish.
 */
export function psd(
  species: SpeciesCode | Species,
  lengths: number[],
): { psd: number | null; nStock: number; nQuality: number } {
  const s = resolveSpecies(species);
  let nStock = 0;
  let nQuality = 0;
  for (const l of lengths) {
    if (l >= s.stockIn) {
      nStock++;
      if (l >= s.qualityIn) nQuality++;
    }
  }
  return { psd: nStock === 0 ? null : (100 * nQuality) / nStock, nStock, nQuality };
}

/**
 * Mean Wr by Gabelhouse length category. Sub-stock fish are ignored.
 * Always returns all four classes in order, with n 0 / meanWr null when empty.
 */
export function wrByClass(
  species: SpeciesCode | Species,
  catches: Pick<Catch, 'lengthIn' | 'wr'>[],
): ClassStat[] {
  const s = resolveSpecies(species);
  const buckets: Record<ClassStat['cls'], number[]> = {
    stock: [],
    quality: [],
    preferred: [],
    memorable: [],
  };
  for (const c of catches) {
    const cls = lengthClass(s, c.lengthIn);
    if (cls === 'sub-stock') continue;
    buckets[cls].push(c.wr);
  }
  return CLASSES.map((cls) => ({ cls, n: buckets[cls].length, meanWr: mean(buckets[cls]) }));
}

/**
 * Length-frequency histogram. Each length is floored to the start of its bin
 * (e.g. 12.75 with binIn 1 -> 12). Empty bins are omitted; result is sorted
 * ascending by binStartIn.
 */
export function lengthFrequency(
  lengths: number[],
  binIn = 1,
): { binStartIn: number; n: number }[] {
  if (!(binIn > 0)) throw new RangeError(`binIn must be > 0, got ${binIn}`);
  const counts = new Map<number, number>();
  for (const l of lengths) {
    // Round to avoid float drift such as 12.000000001 landing in the wrong bin.
    const start = Math.round(Math.floor(l / binIn + 1e-9) * binIn * 1e6) / 1e6;
    counts.set(start, (counts.get(start) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([binStartIn, n]) => ({ binStartIn, n }))
    .sort((a, b) => a.binStartIn - b.binStartIn);
}

/** Plain-language pond management guidance for one species. */
export interface PondGuidance {
  species: SpeciesCode;
  /** One line (< 60 chars) describing the state of the population. */
  summary: string;
  /** Recommended actions; empty when there is not enough data. */
  actions: string[];
}

/**
 * Derive management guidance from logged catches.
 *
 * Largemouth bass (LMB), evaluated by length class mean Wr:
 *   - small (stock+quality) < low  AND  large (preferred+memorable) >= ok
 *       => "Too many small bass competing for forage"
 *   - every class with data < low
 *       => "Forage short overall"
 *   - any class > high
 *       => "Well fed, growing"
 *   - otherwise => balanced
 *
 * Bluegill (BLG) / redear (RES), evaluated by overall mean Wr:
 *   - mean < low  => "Bluegill crowded and stunted"
 *   - mean > 100  => "Feeder working, forage in good shape"
 *   - otherwise   => fair
 *
 * When fewer than minN catches are logged, the summary reports progress and
 * actions is empty.
 */
export function pondGuidance(
  species: SpeciesCode,
  catches: Pick<Catch, 'lengthIn' | 'wr'>[],
  minN = 30,
  t: WrThresholds = DEFAULT_THRESHOLDS,
): PondGuidance {
  const n = catches.length;
  if (n < minN) {
    return {
      species,
      summary: `${n} of ${minN} catches logged – more data needed`,
      actions: [],
    };
  }

  if (species === 'LMB') {
    const stats = wrByClass(species, catches);
    const smallWr = mean(
      catches
        .filter((c) => {
          const cls = lengthClass(species, c.lengthIn);
          return cls === 'stock' || cls === 'quality';
        })
        .map((c) => c.wr),
    );
    const largeWr = mean(
      catches
        .filter((c) => {
          const cls = lengthClass(species, c.lengthIn);
          return cls === 'preferred' || cls === 'memorable';
        })
        .map((c) => c.wr),
    );
    const withData = stats.filter((s) => s.meanWr !== null);

    if (smallWr !== null && smallWr < t.low && largeWr !== null && largeWr >= t.ok) {
      return {
        species,
        summary: 'Too many small bass competing for forage',
        actions: ['Harvest bass in the slot aggressively', 'Release bass over the slot'],
      };
    }
    if (withData.length > 0 && withData.every((s) => (s.meanWr as number) < t.low)) {
      return {
        species,
        summary: 'Forage short overall',
        actions: ['Harvest bass', 'Check feeder and bluegill numbers'],
      };
    }
    if (withData.some((s) => (s.meanWr as number) > t.high)) {
      return { species, summary: 'Well fed, growing', actions: ['Leave them alone'] };
    }
    return {
      species,
      summary: 'Bass in balance – keep logging',
      actions: ['Keep harvesting in the slot', 'Release bass over the slot'],
    };
  }

  // Panfish (BLG / RES): judged on overall condition.
  const overall = mean(catches.map((c) => c.wr));
  const label = species === 'BLG' ? 'Bluegill' : 'Redear';
  if (overall !== null && overall < t.low) {
    return {
      species,
      summary: `${label} crowded and stunted`,
      actions: ['Stop harvesting bass', `Thin ${label.toLowerCase()}`],
    };
  }
  if (overall !== null && overall > 100) {
    return {
      species,
      summary: 'Feeder working, forage in good shape',
      actions: ['Keep bass harvest modest'],
    };
  }
  return {
    species,
    summary: `${label} in fair shape`,
    actions: ['Keep feeding', 'Keep logging'],
  };
}
