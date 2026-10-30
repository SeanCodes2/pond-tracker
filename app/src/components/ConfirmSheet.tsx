import type { ReactNode } from 'react';
import { Sheet } from './Sheet';

interface ConfirmSheetProps {
  open: boolean;
  title: string;
  /** Body text or elements shown under the title. */
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Bottom-sheet confirmation with a big destructive button and a cancel button. */
export function ConfirmSheet({ open, title, children, confirmLabel, danger = true, busy = false, onConfirm, onCancel }: ConfirmSheetProps) {
  return (
    <Sheet open={open} title={title} onClose={onCancel}>
      {children ? <div className="confirm-body">{children}</div> : null}
      <div className="confirm-actions">
        <button type="button" className={`btn block ${danger ? 'danger solid' : 'primary'}`} disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn block" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
