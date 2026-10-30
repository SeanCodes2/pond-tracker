import { useRef, type ReactNode } from 'react';

interface PhotoInputProps {
  onPick: (file: File) => void;
  className?: string;
  'aria-label'?: string;
  children: ReactNode;
}

/** Button that opens the rear camera (or gallery on desktop) via a hidden file input. */
export function PhotoInput({ onPick, className, children, ...rest }: PhotoInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} aria-label={rest['aria-label']} onClick={() => ref.current?.click()}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
    </>
  );
}

export function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
