import { compassPoint, moonPhase, type PressureTrend } from '@pond-tracker/shared';
import type { CatchWeatherRow } from '../db/db';

const ARROW: Record<PressureTrend, string> = { rising: '↑', steady: '→', falling: '↓' };

/**
 * Conditions when the fish was caught: looked-up weather (when the server has it) and the moon,
 * which is worked out on the phone and always shown.
 */
export function WeatherCard({ caughtAt, weather, hasLocation }: { caughtAt: string; weather: CatchWeatherRow | undefined; hasLocation: boolean }) {
  const moon = moonPhase(caughtAt);
  const ok = weather?.status === 'ok' && weather.caughtAt === caughtAt;
  const items: { label: string; value: string }[] = [];
  if (ok) {
    if (weather.airTempF !== undefined) items.push({ label: 'Air', value: `${Math.round(weather.airTempF)}°F` });
    if (weather.windMph !== undefined) {
      const dir = weather.windDirDeg !== undefined && weather.windMph >= 1 ? ` ${compassPoint(weather.windDirDeg)}` : '';
      items.push({ label: 'Wind', value: `${Math.round(weather.windMph)} mph${dir}` });
    }
    if (weather.cloudPct !== undefined) items.push({ label: 'Clouds', value: `${weather.cloudPct}%` });
    if (weather.pressureInHg !== undefined) {
      const trend = weather.pressureTrend ? ` ${ARROW[weather.pressureTrend]} ${weather.pressureTrend}` : '';
      items.push({ label: 'Pressure', value: `${weather.pressureInHg.toFixed(2)} inHg${trend}` });
    }
  }
  items.push({ label: 'Moon', value: `${moon.name} · ${Math.round(moon.illumination * 100)}%` });

  let note: string | undefined;
  if (!ok) {
    if (!hasLocation) note = 'Add GPS to the pond to get the weather for its catches.';
    else if (weather?.status === 'unavailable' && weather.caughtAt === caughtAt) note = 'No weather data for this time.';
    else note = 'Weather fills in after the next sync.';
  }

  return (
    <div className="weather-card" aria-label="Conditions">
      <div className="weather-grid">
        {items.map((i) => (
          <div key={i.label} className={i.label === 'Pressure' || i.label === 'Moon' ? 'wide' : undefined}>
            <div className="weather-label">{i.label}</div>
            <div className="weather-value">{i.value}</div>
          </div>
        ))}
      </div>
      {note ? <div className="muted weather-note">{note}</div> : null}
      {ok ? <div className="muted weather-note">Weather from Open-Meteo</div> : null}
    </div>
  );
}
