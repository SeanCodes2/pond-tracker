/** Tiny scale helpers shared by the inline-SVG charts. No chart library. */

export type Domain = readonly [number, number];

/** Linear map from domain to range. Degenerate domains map to the range midpoint. */
export function linear(domain: Domain, range: Domain): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** "Nice" tick values covering [min, max] with at most maxTicks ticks. */
export function niceTicks(min: number, max: number, maxTicks = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max < min) [min, max] = [max, min];
  const span = max - min || 1;
  const rough = span / Math.max(1, maxTicks - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * pow);
  const step = candidates.find((c) => c >= rough) ?? 10 * pow;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/** Expand [min, max] outward to the nearest multiple of step. */
export function padDomain(min: number, max: number, step: number): Domain {
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

/** Path for a vertical bar anchored at the baseline with a rounded top (data end). */
export function roundedTopBar(x: number, yTop: number, width: number, yBase: number, r = 4): string {
  const h = Math.max(0, yBase - yTop);
  const rr = Math.min(r, width / 2, h);
  if (h <= 0) return '';
  return [
    `M${x},${yBase}`,
    `V${yTop + rr}`,
    `Q${x},${yTop} ${x + rr},${yTop}`,
    `H${x + width - rr}`,
    `Q${x + width},${yTop} ${x + width},${yTop + rr}`,
    `V${yBase}`,
    'Z',
  ].join(' ');
}

export const fmt1 = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));
