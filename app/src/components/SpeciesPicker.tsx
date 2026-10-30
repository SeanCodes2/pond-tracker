import type { SpeciesCode } from '@pond-tracker/shared';
import { SPECIES } from '@pond-tracker/shared';

interface SpeciesPickerProps {
  value: SpeciesCode;
  onChange: (code: SpeciesCode) => void;
}

export const ENABLED_SPECIES: SpeciesCode[] = (Object.keys(SPECIES) as SpeciesCode[]).filter(
  (c) => SPECIES[c].enabled,
);

export function SpeciesPicker({ value, onChange }: SpeciesPickerProps) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Species">
      {ENABLED_SPECIES.map((code) => (
        <button
          key={code}
          type="button"
          role="radio"
          aria-checked={value === code}
          className={value === code ? 'active' : ''}
          onClick={() => onChange(code)}
        >
          {SPECIES[code].name.replace('Largemouth bass', 'Bass')}
        </button>
      ))}
    </div>
  );
}
