import type { ReactNode } from 'react';
import { clamp, roundToStep } from '../lib/format';

interface StepperProps {
  label: string;
  value: number;
  readout: ReactNode;
  sub?: ReactNode;
  step: number;
  min: number;
  max: number;
  /** Range slider granularity (defaults to step). */
  sliderStep?: number;
  /** Slider range when narrower than the button range (defaults to min/max). */
  sliderMin?: number;
  sliderMax?: number;
  /** Show the readout dimmed (a suggested value the user hasn't confirmed). */
  dim?: boolean;
  /** Makes the readout a button, e.g. to confirm a suggested value. */
  onReadoutClick?: () => void;
  onChange: (v: number) => void;
  className?: string;
}

/** Big readout + full-width –/+ halves + a range slider for jumps. */
export function Stepper({
  label,
  value,
  readout,
  sub,
  step,
  min,
  max,
  sliderStep,
  sliderMin,
  sliderMax,
  dim,
  onReadoutClick,
  onChange,
  className,
}: StepperProps) {
  const set = (v: number) => onChange(clamp(roundToStep(v, step), min, max));
  // The slider never pins the value: its range stretches to include wherever the buttons put it.
  const sMin = Math.min(sliderMin ?? min, value);
  const sMax = Math.max(sliderMax ?? max, value);
  return (
    <div className={`stepper${className ? ` ${className}` : ''}`}>
      <div className="stepper-head">
        {/* Label and sub-line share the readout's row so the card stays short. */}
        <div className="stepper-meta">
          <div className="stepper-label">{label}</div>
          {sub ? <div className="stepper-sub">{sub}</div> : null}
        </div>
        {onReadoutClick ? (
          <button
            type="button"
            className={`stepper-readout as-button${dim ? ' dim' : ''}`}
            aria-live="polite"
            onClick={onReadoutClick}
          >
            {readout}
          </button>
        ) : (
          <div className={`stepper-readout${dim ? ' dim' : ''}`} aria-live="polite">
            {readout}
          </div>
        )}
      </div>
      <div className="stepper-buttons">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => set(value - step)} disabled={value <= min}>
          –
        </button>
        <button type="button" aria-label={`Increase ${label}`} onClick={() => set(value + step)} disabled={value >= max}>
          +
        </button>
      </div>
      <input
        type="range"
        aria-label={`${label} slider`}
        min={sMin}
        max={sMax}
        step={sliderStep ?? step}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
      />
    </div>
  );
}
