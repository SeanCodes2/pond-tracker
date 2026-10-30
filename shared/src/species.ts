import type { Settings, Species, SpeciesCode, WrThresholds } from './types.js';

/**
 * Species table.
 *
 * Standard-weight (Ws) coefficients are the widely published metric
 * regressions (log10 Ws g = a + b * log10 TL mm):
 *   Largemouth bass  Wege & Anderson 1978  a = -5.316  b = 3.191
 *   Bluegill         Hillman 1982          a = -5.374  b = 3.316
 *   Redear sunfish   Pope et al. 1995      a = -4.968  b = 3.119
 *
 * LMB uses Wege & Anderson because that is the equation behind the Pond Boss
 * standard-weight table the app is checked against. The newer AFS standard,
 * Henson 1991 (a = -5.528, b = 3.273), reads ~4-5% lower Wr on 20+ in bass;
 * swap the two numbers below to use it.
 *
 * Length cutoffs are Gabelhouse (1984) five-cell categories in inches.
 * Redear is defined but disabled until the UI supports it.
 */
export const SPECIES: Record<SpeciesCode, Species> = {
  LMB: {
    code: 'LMB',
    name: 'Largemouth bass',
    a: -5.316,
    b: 3.191,
    stockIn: 8,
    qualityIn: 12,
    preferredIn: 15,
    memorableIn: 20,
    enabled: true,
  },
  BLG: {
    code: 'BLG',
    name: 'Bluegill',
    a: -5.374,
    b: 3.316,
    stockIn: 3,
    qualityIn: 6,
    preferredIn: 8,
    memorableIn: 10,
    enabled: true,
  },
  RES: {
    code: 'RES',
    name: 'Redear sunfish',
    a: -4.968,
    b: 3.119,
    stockIn: 4,
    qualityIn: 7,
    preferredIn: 9,
    memorableIn: 11,
    enabled: false,
  },
};

/** Default relative-weight cut points (percent). */
export const DEFAULT_THRESHOLDS: WrThresholds = { low: 85, ok: 95, high: 110 };

/** Default bass harvest slot (inches). */
export const DEFAULT_SLOT = { minIn: 8, maxIn: 13 };

/** Default user settings used when no settings record exists yet. */
export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  weightUnits: 'decimal',
  lengthStepIn: 0.25,
  weightStepLb: 0.05,
  defaultThresholds: { ...DEFAULT_THRESHOLDS },
  defaultSlot: { ...DEFAULT_SLOT },
  requireWeight: true,
  requirePhoto: false,
  wifiOnlyPhotoSync: true,
  updatedAt: '1970-01-01T00:00:00.000Z',
};

/**
 * Accepts either a species code or a full Species object and returns the
 * Species object. Throws if the code is unknown.
 */
export function resolveSpecies(species: SpeciesCode | Species): Species {
  if (typeof species === 'string') {
    const s = SPECIES[species];
    if (!s) throw new RangeError(`Unknown species code: ${species}`);
    return s;
  }
  return species;
}
