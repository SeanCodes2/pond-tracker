import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Resolve the shared workspace package from its TypeScript source so `npm run dev`
// works on a fresh clone without building shared/dist first, and edits hot-reload.
const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

// Build stamp shown in Settings, so it's obvious which version the installed app is running.
const buildStamp = `${process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(buildStamp),
  },
  resolve: {
    alias: { '@pond-tracker/shared': sharedSrc },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pond Tracker',
        short_name: 'Pond Tracker',
        description: 'Catch log with relative weight and cull guidance for farm ponds.',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        theme_color: '#0f5132',
        background_color: '#0b1a12',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  server: { port: 5173 },
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
