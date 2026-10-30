/**
 * Core domain types shared by the app (client) and api (server).
 *
 * All dates are ISO-8601 strings (UTC) so records serialize cleanly across
 * IndexedDB, JSON APIs and SQL without timezone surprises.
 * Lengths are inches and weights are decimal pounds at rest; conversions to
 * mm / g happen only inside the fisheries math (see wr.ts).
 */

/** Species supported by the tracker. LMB = largemouth bass, BLG = bluegill, RES = redear sunfish. */
export type SpeciesCode = 'LMB' | 'BLG' | 'RES';

/** What the angler did with the fish after logging it. */
export type Outcome = 'kept' | 'released';

/** How weights are displayed/entered: "2.35 lb" or "2 lb 6 oz". */
export type WeightUnits = 'decimal' | 'lbsOz';

/**
 * Relative-weight (Wr) cut points, in percent.
 *   wr <  low  -> "low"       (skinny, forage short)
 *   wr <  ok   -> "fair"
 *   wr <  high -> "good"
 *   otherwise  -> "excellent" (fat, well fed)
 * Defaults: low 85, ok 95, high 110.
 */
export interface WrThresholds {
  low: number;
  ok: number;
  high: number;
}

/**
 * Species definition including the standard-weight (Ws) regression and the
 * Gabelhouse length-category cutoffs used for PSD and length classes.
 *
 * Standard weight equation (metric): log10 Ws(g) = a + b * log10(TL mm)
 */
export interface Species {
  code: SpeciesCode;
  /** Human readable name, e.g. "Largemouth bass". */
  name: string;
  /** Intercept of the Ws regression (log10 grams). */
  a: number;
  /** Slope of the Ws regression. */
  b: number;
  /** Minimum total length (in) for "stock" size. */
  stockIn: number;
  /** Minimum total length (in) for "quality" size. */
  qualityIn: number;
  /** Minimum total length (in) for "preferred" size. */
  preferredIn: number;
  /** Minimum total length (in) for "memorable" size. */
  memorableIn: number;
  /** Whether the species is offered in the UI picker. */
  enabled: boolean;
}

/** A pond (water body) owned by a user. Soft-deleted via deletedAt. */
export interface Pond {
  id: string;
  userId?: string;
  name: string;
  /** Approximate centre of the pond, used for geofenced auto-selection. */
  lat?: number;
  lon?: number;
  /** Geofence radius in metres around (lat, lon). */
  geofenceM: number;
  acres?: number;
  depthFt?: number;
  /** ISO date the pond was stocked. */
  stockedOn?: string;
  notes?: string;
  /** Bass harvest slot lower bound (in). Bass inside the slot are candidates to keep. */
  cullSlotMinIn: number;
  /** Bass harvest slot upper bound (in). */
  cullSlotMaxIn: number;
  /** Per-pond Wr cut points (defaults from Settings.defaultThresholds). */
  wrThresholds: WrThresholds;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** A single logged fish. wsLb and wr are stored denormalized for fast charts. */
export interface Catch {
  id: string;
  userId?: string;
  pondId: string;
  speciesId: SpeciesCode;
  /** Total length in inches. */
  lengthIn: number;
  /** Measured weight in decimal pounds. */
  weightLb: number;
  /** Standard weight (Ws) for this species/length in decimal pounds. */
  wsLb: number;
  /** Relative weight (Wr) in percent = 100 * weightLb / wsLb. */
  wr: number;
  outcome: Outcome;
  /** ISO timestamp the fish was caught. */
  caughtAt: string;
  photoId?: string;
  lat?: number;
  lon?: number;
  waterTempF?: number;
  airTempF?: number;
  lure?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** A feeding-program period for a pond (automatic feeder settings and fills). */
export interface FeedingLog {
  id: string;
  userId?: string;
  pondId: string;
  /** ISO date feeding started (or settings took effect). */
  startedOn: string;
  /** ISO date feeding stopped; open-ended while undefined. */
  endedOn?: string;
  feederModel?: string;
  /** Feeder run time per feeding, seconds. */
  secondsPerFeed?: number;
  feedsPerDay?: number;
  pelletSizeMm?: number;
  /** Pounds of feed per hopper fill. */
  lbsPerFill?: number;
  /** ISO date of the most recent fill. */
  filledOn?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** Singleton user settings record (id is always 'settings'). */
export interface Settings {
  id: 'settings';
  weightUnits: WeightUnits;
  /** Increment of the length stepper (in). */
  lengthStepIn: number;
  /** Increment of the weight stepper (lb) when weightUnits is 'decimal'. */
  weightStepLb: number;
  /** Default Wr cut points applied to new ponds. */
  defaultThresholds: WrThresholds;
  /** Default bass harvest slot applied to new ponds. */
  defaultSlot: { minIn: number; maxIn: number };
  /** Whether a catch can be saved without a weight. */
  requireWeight: boolean;
  /** Whether a catch can be saved without a photo. */
  requirePhoto: boolean;
  /** Only upload photos on Wi-Fi. */
  wifiOnlyPhotoSync: boolean;
  updatedAt: string;
}
