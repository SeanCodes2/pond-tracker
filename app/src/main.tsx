import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initDb } from './db/db';
import { repo } from './db/repo';
import './styles.css';

registerSW({ immediate: true });
// Seed settings, then sweep soft-deleted rows older than 30 days (the "Recently deleted" window).
void initDb().then(() => repo.purgeDeleted(30)).catch(() => undefined);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
