import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initDb } from './db/db';
import { repo } from './db/repo';
import { startSync } from './sync/startSync';
import './styles.css';

// autoUpdate: a new build activates and the page reloads itself. Browsers only re-check on a
// full launch, so also check whenever the installed app returns to the foreground, and hourly.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    setInterval(check, 60 * 60 * 1000);
  },
});
// Seed settings, then sweep soft-deleted rows older than 30 days (the "Recently deleted" window).
// Then start cloud sync (no-op in local dev unless localStorage['pt:forceSync'] === '1').
void initDb()
  .then(() => repo.purgeDeleted(30))
  .catch(() => undefined)
  .then(() => startSync())
  .catch(() => undefined);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
