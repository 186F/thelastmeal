import { defineConfig } from 'vite';

/** Production build for the Node gateway (npm run build:gateway): a single
 * bundled ESM entry under dist-gateway/, with the OpenAI SDK left external
 * (it stays a pinned node_modules dependency of the gateway process only). */
export default defineConfig({
  build: {
    ssr: 'gateway/main.ts',
    outDir: 'dist-gateway',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: {
      external: ['openai'],
    },
  },
});
