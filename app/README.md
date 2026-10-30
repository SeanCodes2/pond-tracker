# Pond Tracker — app

Phone-first, offline-first catch log for farm ponds. Computes relative weight (Wr) from
length + weight and gives keep/release guidance so you can grow big bass.

## Run it

From the monorepo root:

```sh
npm install
npm run build -w shared     # once, or after changing shared/
npm run dev -w app          # http://<your-lan-ip>:5173
```

Other scripts (inside `app/`): `npm run build`, `npm run preview`, `npm run typecheck`,
`npm test`, `npm run icons` (regenerates the PNG icons in `public/`).

## Install on Android

1. Serve a production build over HTTPS (or `localhost`) — service workers and the camera
   require a secure context. `npm run build && npm run preview --host` works on the LAN
   only if you front it with HTTPS; a static host (Azure Static Web Apps, Cloudflare Pages,
   GitHub Pages) is simplest.
2. Open the URL in Chrome, tap the menu, then **Install app** / **Add to Home screen**.
3. Launch from the home screen. The first time you log a catch, allow **Location** (used to
   auto-pick the pond by geofence) and **Camera** (only when you tap the camera button).

Installed apps get persistent storage, so the browser will not evict your data under
pressure. Settings shows whether storage is persistent.

## Where data lives

Everything is in the browser's IndexedDB on the phone (database `PondTrackerDB`): ponds,
catches, feeding logs, photos (resized to 1200 px JPEG), settings. Nothing leaves the
device in Phase 1. Use **Settings → Export CSV** for backups. Every row carries a
`pending` flag so a later sync can push unsent changes to the API.

Deleting a pond or catch is a soft delete (`deletedAt`); the row stays in IndexedDB.
