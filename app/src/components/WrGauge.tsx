import type { WrBand } from '@pond-tracker/shared';

interface WrGaugeProps {
  wr: number | null;
  band: WrBand | null;
  hint?: string;
}

const BAND_LABEL: Record<WrBand, string> = {
  low: 'Low',
  fair: 'Fair',
  good: 'Good',
  excellent: 'Excellent',
};

export function WrGauge({ wr, band, hint }: WrGaugeProps) {
  const cls = band ?? '';
  return (
    <div className={`wr-gauge ${cls}`} role="status" aria-live="polite">
      <div className="wr-num">
        {wr === null ? '—' : Math.round(wr)}
        {wr === null ? null : <small>%</small>}
      </div>
      <div className="wr-text">
        <div className="wr-band">{band ? `${BAND_LABEL[band]} · Wr` : 'Relative weight'}</div>
        <div className="wr-hint">{hint ?? 'Enter length and weight'}</div>
      </div>
    </div>
  );
}

export function WrBadge({ wr, band }: { wr: number; band: WrBand }) {
  return (
    <span className={`wr-badge ${band}`} title="Relative weight">
      {Math.round(wr)}
    </span>
  );
}
