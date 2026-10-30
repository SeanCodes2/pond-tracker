import type { Pond, Species, SpeciesCode, WeightUnits, WrThresholds } from './types.js';
import { DEFAULT_THRESHOLDS, resolveSpecies } from './species.js';

/** Inches to millimetres. */
export const inToMm = (inches: number): number => inches * 25.4;
/** Grams to decimal pounds. */
export const gToLb = (g: number): number => g / 453.59237;
/** Decimal pounds to grams. */
export const lbToG = (lb: number): number => lb * 453.59237;

/**
 * Standard weight (Ws) in decimal pounds for a fish of the given total length.
 * Uses the species' metric regression: log10 Ws(g) = a + b * log10(TL mm).
 * @throws RangeError if lengthIn <= 0 or not finite.
 */
export function standardWeightLb(species: SpeciesCode | Species, lengthIn: number): number {
  if (!Number.isFinite(lengthIn) || lengthIn <= 0) {
    throw new RangeError(`lengthIn must be > 0, got ${lengthIn}`);
  }
  const s = resolveSpecies(species);
  const wsG = Math.pow(10, s.a + s.b * Math.log10(inToMm(lengthIn)));
  return gToLb(wsG);
}

/**
 * Relative weight (Wr) as a percent: 100 * measured / standard.
 * Returned unrounded; callers round for display (e.g. 83.3).
 * @throws RangeError if lengthIn <= 0 (via standardWeightLb) or weightLb < 0.
 */
export function relativeWeight(
  species: SpeciesCode | Species,
  lengthIn: number,
  weightLb: number,
): number {
  if (!Number.isFinite(weightLb) || weightLb < 0) {
    throw new RangeError(`weightLb must be >= 0, got ${weightLb}`);
  }
  return (100 * weightLb) / standardWeightLb(species, lengthIn);
}

/** Condition band derived from Wr and thresholds. */
export type WrBand = 'low' | 'fair' | 'good' | 'excellent';

/**
 * Classify a Wr value: < low => 'low', < ok => 'fair', < high => 'good', else 'excellent'.
 */
export function wrBand(wr: number, t: WrThresholds = DEFAULT_THRESHOLDS): WrBand {
  if (wr < t.low) return 'low';
  if (wr < t.ok) return 'fair';
  if (wr < t.high) return 'good';
  return 'excellent';
}

/** Harvest suggestion for a single fish. */
export type CullHint = 'keep' | 'release' | 'your-call';

/**
 * Suggest whether to keep or release a fish.
 *
 * Bass (LMB) are managed by the pond's harvest slot:
 *   inside [slotMin, slotMax] => keep       ("in harvest slot")
 *   above slotMax             => release    ("over slot – let it grow")
 *   below slotMin             => your-call  ("below slot")
 *
 * Panfish (BLG / RES) are managed by condition:
 *   wr <  thresholds.low => keep      (thin forage – thin the herd)
 *   wr >= thresholds.ok  => release   (healthy – keep as forage/brood)
 *   otherwise            => your-call
 */
export function cullHint(
  species: SpeciesCode | Species,
  lengthIn: number,
  wr: number,
  pond: Pick<Pond, 'cullSlotMinIn' | 'cullSlotMaxIn' | 'wrThresholds'>,
): { hint: CullHint; reason: string } {
  const s = resolveSpecies(species);
  const t = pond.wrThresholds ?? DEFAULT_THRESHOLDS;
  if (s.code === 'LMB') {
    const lo = trimIn(pond.cullSlotMinIn);
    const hi = trimIn(pond.cullSlotMaxIn);
    // Longer than the harvest range: always release — these are the fish the pond is managed to grow.
    if (lengthIn > pond.cullSlotMaxIn) return { hint: 'release', reason: `over ${hi} in – let it grow` };
    // In the harvest range: thin fish are the clearest harvest; a healthy one is a judgment call.
    if (lengthIn >= pond.cullSlotMinIn) {
      if (wr < t.ok) return { hint: 'keep', reason: `${lo}–${hi} in and thin – harvest` };
      return { hint: 'your-call', reason: `${lo}–${hi} in, good shape` };
    }
    // Shorter than the harvest range: only flag the skinny ones.
    if (wr < t.low) return { hint: 'keep', reason: `under ${lo} in and thin` };
    return { hint: 'your-call', reason: `under ${lo} in` };
  }
  if (wr < t.low) return { hint: 'keep', reason: 'thin – harvest to thin the herd' };
  if (wr >= t.ok) return { hint: 'release', reason: 'healthy – leave as bass food' };
  return { hint: 'your-call', reason: 'fair condition' };
}

/** 13 -> "13", 12.5 -> "12.5" for short labels. */
function trimIn(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Format a decimal-pound weight for display.
 *   decimal -> "2.35 lb"
 *   lbsOz   -> "2 lb 6 oz" (rounded to the nearest ounce, carrying 16 oz into lb)
 */
export function formatWeight(weightLb: number, units: WeightUnits): string {
  if (units === 'decimal') return `${weightLb.toFixed(2)} lb`;
  const totalOz = Math.round(weightLb * 16);
  const lb = Math.floor(totalOz / 16);
  const oz = totalOz % 16;
  return `${lb} lb ${oz} oz`;
}

/** Combine whole pounds and ounces into decimal pounds (2 lb 6 oz -> 2.375). */
export function parseLbsOz(lb: number, oz: number): number {
  return lb + oz / 16;
}

/** Gabelhouse length category, plus 'sub-stock' for fish under stock size. */
export type LengthClass = 'sub-stock' | 'stock' | 'quality' | 'preferred' | 'memorable';

/** Classify a fish by total length against the species cutoffs. */
export function lengthClass(species: SpeciesCode | Species, lengthIn: number): LengthClass {
  const s = resolveSpecies(species);
  if (lengthIn >= s.memorableIn) return 'memorable';
  if (lengthIn >= s.preferredIn) return 'preferred';
  if (lengthIn >= s.qualityIn) return 'quality';
  if (lengthIn >= s.stockIn) return 'stock';
  return 'sub-stock';
}
