import { fmt1, linear, niceTicks, padDomain, type Domain } from './scale';

export interface LinePoint {
  x: number;
  y: number;
  title?: string;
}

export interface LineSeries {
  name: string;
  /** CSS class carrying the series colour (e.g. "series-lmb"). */
  colorClass: string;
  points: LinePoint[];
}

export interface LineChartProps {
  series: LineSeries[];
  ariaLabel: string;
  xTicks: { x: number; label: string }[];
  xDomain?: Domain;
  /** Shaded x ranges drawn behind the data (e.g. feeder on). */
  bands?: { from: number; to: number; label?: string }[];
  refLine?: { value: number; label?: string };
  yStep?: number;
  format?: (v: number) => string;
}

const W = 360;
const H = 200;
const M = { top: 16, right: 40, bottom: 26, left: 30 };

export function LineChart({ series, ariaLabel, xTicks, xDomain, bands = [], refLine, yStep = 10, format = fmt1 }: LineChartProps) {
  const plotTop = M.top;
  const plotBottom = H - M.bottom;
  const plotLeft = M.left;
  const plotRight = W - M.right;
  const withData = series.filter((s) => s.points.length > 0);
  const allPts = withData.flatMap((s) => s.points);

  const xs = [...allPts.map((p) => p.x), ...bands.flatMap((b) => [b.from, b.to]), ...xTicks.map((t) => t.x)];
  const [x0, x1]: Domain = xDomain ?? (xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1]);
  const x = linear([x0, x1], [plotLeft, plotRight]);

  const ys = [...allPts.map((p) => p.y), ...(refLine ? [refLine.value] : [])];
  const [y0, y1] = ys.length ? padDomain(Math.min(...ys) - yStep / 2, Math.max(...ys) + yStep / 2, yStep) : [0, yStep * 4];
  const y = linear([y0, y1], [plotBottom, plotTop]);
  const yTicks = niceTicks(y0, y1, 5);
  const ptsByX = (pts: LinePoint[]) => [...pts].sort((a, b) => a.x - b.x);

  // Nudge end labels apart so two series ending near the same value stay readable.
  const endLabelY = new Map<string, number>();
  const ends = withData
    .map((s) => {
      const pts = ptsByX(s.points);
      const last = pts[pts.length - 1];
      return { name: s.name, y: last ? y(last.y) : 0 };
    })
    .sort((a, b) => a.y - b.y);
  let prevLabelY = -Infinity;
  for (const e of ends) {
    const placed = Math.max(e.y, prevLabelY + 13);
    endLabelY.set(e.name, placed);
    prevLabelY = placed;
  }

  return (
    <div className="chart-wrap">
      {series.length >= 2 ? (
        <div className="chart-legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.name} className="chart-legend-item">
              <span className={`chart-swatch ${s.colorClass}`} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        {bands.map((b, i) => {
          const bx0 = x(Math.max(b.from, x0));
          const bx1 = x(Math.min(b.to, x1));
          if (bx1 <= bx0) return null;
          return (
            <g key={i}>
              <rect className="chart-band" x={bx0} y={plotTop} width={bx1 - bx0} height={plotBottom - plotTop}>
                <title>{b.label ?? 'band'}</title>
              </rect>
              {b.label ? (
                <text className="chart-text-muted chart-band-label" x={bx0 + 4} y={plotTop + 10}>
                  {b.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {yTicks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={plotLeft} x2={plotRight} y1={y(t)} y2={y(t)} />
            <text className="chart-text-muted chart-tick" x={plotLeft - 6} y={y(t) + 3.5} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {refLine ? (
          <g>
            <line className="chart-ref" x1={plotLeft} x2={plotRight} y1={y(refLine.value)} y2={y(refLine.value)} />
            {refLine.label ? (
              <text className="chart-text-muted chart-band-label" x={plotRight} y={y(refLine.value) - 3} textAnchor="end">
                {refLine.label}
              </text>
            ) : null}
          </g>
        ) : null}
        <line className="chart-axis" x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} />
        {xTicks
          .filter((t) => t.x >= x0 && t.x <= x1)
          .map((t) => (
            <text key={t.label} className="chart-text-muted chart-tick" x={x(t.x)} y={plotBottom + 14} textAnchor="middle">
              {t.label}
            </text>
          ))}
        {withData.map((s) => {
          const pts = ptsByX(s.points);
          const last = pts[pts.length - 1];
          if (!last) return null;
          const d =pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
          return (
            <g key={s.name} className={s.colorClass}>
              {pts.length > 1 ? <path className="chart-line" d={d} /> : null}
              {pts.map((p, i) => (
                <circle key={i} className="chart-dot" cx={x(p.x)} cy={y(p.y)} r={i === pts.length - 1 ? 5 : 3.5}>
                  <title>{p.title ?? `${s.name}: ${format(p.y)}`}</title>
                </circle>
              ))}
              <text className="chart-text chart-value" x={x(last.x) + 8} y={(endLabelY.get(s.name) ?? y(last.y)) + 4}>
                {format(last.y)}
              </text>
            </g>
          );
        })}
        {withData.length === 0 ? (
          <text className="chart-text-muted chart-cat" x={(plotLeft + plotRight) / 2} y={(plotTop + plotBottom) / 2} textAnchor="middle">
            No catches this season
          </text>
        ) : null}
      </svg>
    </div>
  );
}
