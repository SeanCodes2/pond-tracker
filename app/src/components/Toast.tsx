import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastSpec {
  message: string;
  actions?: ToastAction[];
  durationMs?: number;
}

interface ToastApi {
  show: (spec: ToastSpec) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback(
    (spec: ToastSpec) => {
      window.clearTimeout(timer.current);
      setToast(spec);
      timer.current = window.setTimeout(dismiss, spec.durationMs ?? 6000);
    },
    [dismiss],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <div className="toast" role="status">
          <div className="toast-msg">{toast.message}</div>
          {toast.actions?.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => {
                dismiss();
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
