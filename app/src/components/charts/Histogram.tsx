import { linear, niceTicks, roundedTopBar } from './scale';

export interface HistogramBin {
  binStartIn: number;
  n: number;
}

export interface HistogramMarker {
  at: number;
  label: string;
  title?: string;
}

export interface HistogramProps {
  bins: HistogramBin[];
  binIn?: number;
  ariaLabel: string;
  /** Vertical reference marks, e.g. stock / quality / preferred lengths. */
  markers?: HistogramMarker[];
  /** Shaded length range (the pond's harvest slot). */
  slot?: { min: number; max: number; label?: string };
  unit?: string;
}

const W = 360;
const H = 180;
const M = { top: 22, right: 10, bottom: 30, left: 30 };
const BAR_MAX = 24;

export function Histogram({ bins, binIn = 1, ariaLabel, markers = [], slot, unit = 'in' }: HistogramProps) {
  const plotTop = M.top;
  const plotBottom = H - M.bottom;
  const plotLeft = M.left;
  const plotRight = W - M.right;

  if (bins.length === 0) {
    return (
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        <text className="chart-text-muted chart-cat" x={W / 2} y={H / 2} textAnchor="middle">
          No lengths logged yet
        </text>
      </svg>
    );
  }

  const binMin = Math.min(...bins.map((b) => b.binStartIn));
  const binMax = Math.max(...bins.map((b) => b.binStartIn)) + binIn;
  const extra = [...markers.map((m) => m.at), ...(slot ? [slot.min, slot.max] : [])];
  const xMin = Math.floor(Math.min(binMin, ...extra) - binIn);
  const xMax = Math.ceil(Math.max(binMax, ...extra) + binIn);
  const x = linear([xMin, xMax], [plotLeft, plotRight]);
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  const yTop = Math.max(2, Math.ceil(maxN / 2) * 2);
  const y = linear([0, yTop], [plotBottom, plotTop]);
  const yTicks = niceTicks(0, yTop, 4).filter((t) => Number.isInteger(t));
  const binPx = x(xMin + binIn) - x(xMin);
  const barW = Math.max(3, Math.min(BAR_MAX, binPx - 2));
  const span = xMax - xMin;
  const xStep = span > 16 ? 4 : span > 8 ? 2 : 1;
  const xTicks: number[] = [];
  for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax; v += xStep) xTicks.push(v);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
      {slot ? (
        <g>
          <rect className="chart-band" x={x(slot.min)} y={plotTop} width={Math.max(0, x(slot.max) - x(slot.min))} height={plotBottom - plotTop} />
          <text className="chart-text-muted chart-band-label" x={(x(slot.min) + x(slot.max)) / 2} y={plotTop - 11} textAnchor="middle">
            {slot.label ?? 'slot'}
          </text>
        </g>
      ) : null}
      {yTicks.map((t) => (
        <g key={t}>
          <line className="chart-grid" x1={plotLeft} x2={plotRight} y1={y(t)} y2={y(t)} />
          <text className="chart-text-muted chart-tick" x={plotLeft - 6} y={y(t) + 3.5} textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      <line className="chart-axis" x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} />
      {bins.map((b) => {
        const cx = x(b.binStartIn + binIn / 2);
        return (
          <path key={b.binStartIn} className="chart-bar series-default" d={roundedTopBar(cx - barW / 2, y(b.n), barW, plotBottom)}>
            <title>{`${b.binStartIn}–${b.binStartIn + binIn} ${unit}: ${b.n}`}</title>
          </path>
        );
      })}
      {markers.map((m) => (
        <g key={m.label}>
          <line className="chart-marker" x1={x(m.at)} x2={x(m.at)} y1={plotTop - 2} y2={plotBottom} />
          <text className="chart-text chart-marker-label" x={x(m.at)} y={plotTop - 2} textAnchor="middle">
            {m.label}
            <title>{m.title ?? `${m.label}: ${m.at} ${unit}`}</title>
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={t} className="chart-text-muted chart-tick" x={x(t)} y={plotBottom + 14} textAnchor="middle">
          {t}
        </text>
      ))}
      <text className="chart-text-muted chart-sub" x={plotRight} y={plotBottom + 26} textAnchor="end">
        {unit}
      </text>
    </svg>
  );
}
