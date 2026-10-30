import type { CatchRow } from '../db/db';
import { db } from '../db/db';
import { formatWeightUnits, formatLength, speciesShortName } from './format';
import type { WeightUnits } from '@pond-tracker/shared';

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Shares a catch's photo through the phone's share sheet (Messages, Facebook, Save to Photos…),
 * or downloads it where the browser can't share files (most desktops).
 */
export async function shareCatchPhoto(
  c: CatchRow,
  opts: { pondName?: string; units: WeightUnits },
): Promise<ShareResult> {
  if (!c.photoId) throw new Error('This catch has no photo.');
  const blob = await loadPhotoBlob(c.photoId);
  const type = blob.type || 'image/jpeg';
  const file = new File([blob], photoFileName(c, opts.pondName, type), { type });
  const caption = photoCaption(c, opts);

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption });
      return 'shared';
    } catch (err) {
      // Closing the share sheet isn't an error worth reporting.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a moment to start the download before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return 'downloaded';
}

/** Local blob when the phone has it; otherwise fetch the synced copy from the cloud. */
async function loadPhotoBlob(photoId: string): Promise<Blob> {
  const row = await db.photos.get(photoId);
  if (row?.blob) return row.blob;
  const res = await fetch(`/api/photos/${encodeURIComponent(photoId)}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Could not load the photo (${res.status}).`);
  return res.blob();
}

export function photoFileName(c: CatchRow, pondName: string | undefined, type: string): string {
  const d = new Date(c.caughtAt);
  const date = Number.isNaN(d.getTime())
    ? 'catch'
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const length = `${trimZeros(c.lengthIn.toFixed(2))}in`;
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const parts = [pondName, date, length, speciesShortName(c.speciesId)]
    .filter((p): p is string => !!p)
    .map(slug)
    .filter(Boolean);
  return `${parts.join('-')}.${ext}`;
}

export function photoCaption(c: CatchRow, opts: { pondName?: string; units: WeightUnits }): string {
  const bits = [`${formatLength(c.lengthIn)} ${speciesShortName(c.speciesId)}`];
  if (c.weightLb > 0) bits.push(formatWeightUnits(c.weightLb, opts.units));
  const where = opts.pondName ? ` · ${opts.pondName}` : '';
  return `${bits.join(', ')}${where}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function trimZeros(s: string): string {
  return s.replace(/\.?0+$/, '');
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
