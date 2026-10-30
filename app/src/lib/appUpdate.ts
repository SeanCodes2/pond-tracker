/**
 * Manual update controls for the installed PWA. The service worker normally updates itself
 * (autoUpdate + a check on every foreground), these are the "do it now" buttons.
 */

/** Ask for a new build. Resolves 'updating' if one is installing (the page reloads when it activates). */
export async function checkForUpdate(): Promise<'updating' | 'current' | 'unsupported' | 'failed'> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'unsupported';
  try {
    await reg.update();
  } catch {
    return 'failed';
  }
  if (reg.installing || reg.waiting) {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
    return 'updating';
  }
  return 'current';
}

/**
 * Last resort: drop the service worker and its caches, then reload from the network.
 * Catch data lives in IndexedDB, which this does not touch.
 */
export async function hardRefresh(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  window.location.reload();
}
