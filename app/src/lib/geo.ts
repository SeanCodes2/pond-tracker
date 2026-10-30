export interface Position {
  lat: number;
  lon: number;
  accuracyM?: number;
}

/** Resolves with the device position, or null if GPS is unavailable, denied, or slow. */
export function getCurrentPosition(timeoutMs = 8000): Promise<Position | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (p: Position | null) => {
      if (done) return;
      done = true;
      resolve(p);
    };
    const timer = setTimeout(() => finish(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        finish({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyM: pos.coords.accuracy });
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

const EARTH_R_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(h));
}

interface GeofencedPond {
  id: string;
  lat?: number;
  lon?: number;
  geofenceM: number;
}

/** Returns the nearest pond whose geofence contains pos, or undefined. */
export function pickPondByGeofence<P extends GeofencedPond>(ponds: readonly P[], pos: Position): P | undefined {
  let best: P | undefined;
  let bestD = Infinity;
  for (const p of ponds) {
    if (p.lat === undefined || p.lon === undefined) continue;
    const d = haversineM(pos.lat, pos.lon, p.lat, p.lon);
    if (d <= p.geofenceM && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
