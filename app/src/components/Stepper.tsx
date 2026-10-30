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
  /** Show the readout dimmed (a suggested value the user hasn't confirmed). */
  dim?: boolean;
  /** Makes the readout a button, e.g. to confirm a suggested value. */
  onReadoutClick?: () => void;
  onChange: (v: number) => void;
}

/** Big readout + full-width –/+ halves + a range slider for jumps. */
export function Stepper({ label, value, readout, sub, step, min, max, sliderStep, dim, onReadoutClick, onChange }: StepperProps) {
  const set = (v: number) => onChange(clamp(roundToStep(v, step), min, max));
  return (
    <div className="stepper">
      <div className="stepper-head">
        <div className="stepper-label">{label}</div>
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
      <div className="stepper-sub">{sub}</div>
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
        min={min}
        max={max}
        step={sliderStep ?? step}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
      />
    </div>
  );
}
