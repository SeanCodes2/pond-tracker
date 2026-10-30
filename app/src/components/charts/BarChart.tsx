import { linear, niceTicks, roundedTopBar, type Domain } from './scale';

export interface BarCategory {
  label: string;
  /** null renders an empty slot with a dash. */
  value: number | null;
  /** Small line under the category label, e.g. "n 17". */
  sub?: string;
  /** CSS class applied to the bar (e.g. a wrBand). Falls back to the accent fill. */
  colorClass?: string;
  /** Native tooltip text. */
  title?: string;
}

export interface BarChartProps {
  categories: BarCategory[];
  ariaLabel: string;
  /** Value-axis domain. Defaults to [0, nice max]. */
  domain?: Domain;
  /** Shaded range on the value axis. */
  refBand?: { from: number; to: number; label?: string };
  /** Reference line on the value axis. */
  refLine?: { value: number; label?: string };
  format?: (v: number) => string;
}

const W = 360;
const H = 190;
const M = { top: 20, right: 10, bottom: 38, left: 30 };
const BAR_MAX = 24;

export function BarChart({ categories, ariaLabel, domain, refBand, refLine, format = (v) => String(Math.round(v)) }: BarChartProps) {
  const values = categories.map((c) => c.value).filter((v): v is number => v !== null);
  const dataMax = Math.max(0, ...values, refBand?.to ?? 0, refLine?.value ?? 0);
  const [d0, d1] = domain ?? [0, Math.max(10, Math.ceil(dataMax / 10) * 10)];
  const plotTop = M.top;
  const plotBottom = H - M.bottom;
  const plotLeft = M.left;
  const plotRight = W - M.right;
  const y = linear([d0, d1], [plotBottom, plotTop]);
  const ticks = niceTicks(d0, d1, 4);
  const n = Math.max(1, categories.length);
  const slot = (plotRight - plotLeft) / n;
  const barW = Math.min(BAR_MAX, slot - 2);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
      {refBand ? (
        <g>
          <rect className="chart-band" x={plotLeft} y={y(refBand.to)} width={plotRight - plotLeft} height={Math.max(0, y(refBand.from) - y(refBand.to))} />
          {refBand.label ? (
            <text className="chart-text-muted chart-band-label" x={plotRight} y={y(refBand.to) + 10} textAnchor="end">
              {refBand.label}
            </text>
          ) : null}
        </g>
      ) : null}
      {ticks.map((t) => (
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
      {categories.map((c, i) => {
        const cx = plotLeft + slot * i + slot / 2;
        const x0 = cx - barW / 2;
        const v = c.value;
        return (
          <g key={c.label}>
            {v !== null ? (
              <path className={`chart-bar ${c.colorClass ?? ''}`} d={roundedTopBar(x0, y(Math.min(v, d1)), barW, plotBottom)}>
                <title>{c.title ?? `${c.label}: ${format(v)}`}</title>
              </path>
            ) : null}
            <text className="chart-text chart-value" x={cx} y={(v !== null ? y(Math.min(v, d1)) : plotBottom) - 5} textAnchor="middle">
              {v === null ? '—' : format(v)}
            </text>
            <text className="chart-text chart-cat" x={cx} y={plotBottom + 15} textAnchor="middle">
              {c.label}
            </text>
            {c.sub ? (
              <text className="chart-text-muted chart-sub" x={cx} y={plotBottom + 29} textAnchor="middle">
                {c.sub}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
