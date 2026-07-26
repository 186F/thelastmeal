import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/sim/**', 'src/shared/**'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
