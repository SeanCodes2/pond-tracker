import type { Catch, Pond } from '@pond-tracker/shared';

const COLUMNS = [
  'id',
  'pond',
  'species',
  'caughtAt',
  'lengthIn',
  'weightLb',
  'wsLb',
  'wr',
  'outcome',
  'lat',
  'lon',
  'waterTempF',
  'airTempF',
  'lure',
  'notes',
] as const;

function cell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function catchesToCsv(catches: readonly Catch[], ponds: readonly Pond[]): string {
  const pondName = new Map(ponds.map((p) => [p.id, p.name]));
  const lines = [COLUMNS.join(',')];
  for (const c of catches) {
    lines.push(
      [
        c.id,
        pondName.get(c.pondId) ?? c.pondId,
        c.speciesId,
        c.caughtAt,
        c.lengthIn,
        c.weightLb,
        c.wsLb,
        c.wr,
        c.outcome,
        c.lat,
        c.lon,
        c.waterTempF,
        c.airTempF,
        c.lure,
        c.notes,
      ]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
