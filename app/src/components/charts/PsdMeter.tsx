import { linear } from './scale';

export interface PsdMeterProps {
  /** PSD 0–100, or null when there are no stock-size fish. */
  value: number | null;
  /** Balanced range to shade, e.g. [40, 70] for bass. */
  band: readonly [number, number];
  ariaLabel: string;
}

const W = 360;
const H = 40;
const TRACK_Y = 10;
const TRACK_H = 12;
const PAD = 8;

/** Horizontal 0–100 meter with a shaded "balanced" band and a value marker. */
export function PsdMeter({ value, band, ariaLabel }: PsdMeterProps) {
  const x = linear([0, 100], [PAD, W - PAD]);
  const v = value === null ? null : Math.max(0, Math.min(100, value));
  return (
    <svg className="chart chart-meter" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
      <rect className="meter-track" x={PAD} y={TRACK_Y} width={W - PAD * 2} height={TRACK_H} rx={6} />
      <rect className="meter-band" x={x(band[0])} y={TRACK_Y} width={x(band[1]) - x(band[0])} height={TRACK_H} rx={6}>
        <title>{`Balanced ${band[0]}–${band[1]}`}</title>
      </rect>
      {v !== null ? (
        <rect className="meter-marker" x={x(v) - 3} y={TRACK_Y - 4} width={6} height={TRACK_H + 8} rx={3}>
          <title>{`PSD ${Math.round(v)}`}</title>
        </rect>
      ) : null}
      {[0, band[0], band[1], 100].map((t) => (
        <text key={t} className="chart-text-muted chart-sub" x={x(t)} y={H - 4} textAnchor={t === 0 ? 'start' : t === 100 ? 'end' : 'middle'}>
          {t}
        </text>
      ))}
    </svg>
  );
}
