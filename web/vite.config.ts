import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * One config for dev, build and tests.
 *
 * The dev server proxies `/api` to the gateway so the browser talks to a single
 * origin: no CORS preflight in dev, and the same relative base URL works behind
 * any reverse proxy in production. `/actuator` is proxied for the same reason:
 * the admin overview reads the gateway's own health, which is not part of `/api`.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_GATEWAY_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
      '/actuator': {
        target: process.env.VITE_GATEWAY_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    /**
     * Vitest runs one worker per file. The page tests mount the real router, so a
     * single test can initialise Leaflet, wait for a debounce and settle two queries
     * — work that comfortably takes a second on an idle machine and several when
     * sixteen files run at once. The default 5 s budget produced random timeouts;
     * twenty is still short enough to fail a genuinely stuck test quickly.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
