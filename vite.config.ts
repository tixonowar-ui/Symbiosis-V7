import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The renderer is served by the host over the LAN, so the bundle must be fully
 * self-contained: no CDN, no external fonts, no runtime network fetches beyond
 * the host itself.
 */
export default defineConfig({
  root: r('./src/web'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': r('./src/shared'),
      '@generated': r('./generated'),
    },
  },
  build: {
    outDir: r('./dist/web'),
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: true,
  },
});
