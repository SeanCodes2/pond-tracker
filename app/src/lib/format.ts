import type { SpeciesCode, WeightUnits } from '@pond-tracker/shared';
import { formatWeight, SPECIES } from '@pond-tracker/shared';

export function formatLength(lengthIn: number): string {
  return `${trimZeros(lengthIn.toFixed(2))} in`;
}

export function formatWeightUnits(weightLb: number, units: WeightUnits): string {
  return formatWeight(weightLb, units);
}

export function formatWr(wr: number): string {
  return `${Math.round(wr)}`;
}

export function speciesShortName(code: SpeciesCode): string {
  switch (code) {
    case 'LMB':
      return 'bass';
    case 'BLG':
      return 'bluegill';
    case 'RES':
      return 'redear';
  }
}

export function speciesName(code: SpeciesCode): string {
  return SPECIES[code].name;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** ISO timestamp → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Rounds to the nearest multiple of step, avoiding float drift. */
export function roundToStep(value: number, step: number): number {
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step))) + 1);
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
