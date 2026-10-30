import { useEffect, useState, type ReactNode } from 'react';
import { checkAccess, previouslyAllowed } from '../lib/access';

/**
 * Renders the app once access is confirmed. A device approved before opens immediately and
 * works offline; the check still runs in the background and sends a revoked or signed-out
 * user to the login / not-invited page.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(previouslyAllowed);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const r = await checkAccess();
      if (cancelled) return;
      if (r === 'allowed') setAllowed(true);
      else if (r === 'signed-out') window.location.replace('/login.html');
      else if (r === 'not-invited') window.location.replace('/denied.html');
      // 'offline': keep whatever we had. A device never approved stays on the notice below.
    };
    void run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (allowed) return <>{children}</>;
  return (
    <div className="page empty" style={{ paddingTop: 80, textAlign: 'center' }}>
      Checking access…
      <div className="muted" style={{ marginTop: 12, fontSize: 14 }}>
        The first launch needs a connection to sign in.
      </div>
    </div>
  );
}
