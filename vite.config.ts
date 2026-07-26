import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  server: {
    // Playwright's webServer starts Vite with an explicit port; interactive use may pick any port.
  },
});
