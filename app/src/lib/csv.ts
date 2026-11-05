import { moonPhase, type Catch, type CatchWeather, type Pond } from '@pond-tracker/shared';

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
  'pressureInHg',
  'pressureChange3hInHg',
  'pressureTrend',
  'windMph',
  'windDirDeg',
  'cloudPct',
  'moonPhase',
  'moonIllumination',
  'lure',
  'notes',
  'loggedBy',
] as const;

function cell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * airTempF is what was typed in, falling back to the looked-up air temperature. Weather columns
 * are blank until the server has filled them in.
 */
export function catchesToCsv(
  catches: readonly Catch[],
  ponds: readonly Pond[],
  weather: ReadonlyMap<string, Pick<CatchWeather, 'status' | 'caughtAt' | 'airTempF' | 'pressureInHg' | 'pressureChange3hInHg' | 'pressureTrend' | 'windMph' | 'windDirDeg' | 'cloudPct'>> = new Map(),
): string {
  const pondName = new Map(ponds.map((p) => [p.id, p.name]));
  const lines = [COLUMNS.join(',')];
  for (const c of catches) {
    const raw = weather.get(c.id);
    const w = raw?.status === 'ok' && raw.caughtAt === c.caughtAt ? raw : undefined;
    const moon = moonPhase(c.caughtAt);
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
        c.airTempF ?? w?.airTempF,
        w?.pressureInHg,
        w?.pressureChange3hInHg,
        w?.pressureTrend,
        w?.windMph,
        w?.windDirDeg,
        w?.cloudPct,
        moon.name,
        Math.round(moon.illumination * 100) / 100,
        c.lure,
        c.notes,
        c.loggedByName,
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
