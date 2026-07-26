import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // The determinism suites are CPU-bound for tens of seconds at a time
    // (complete canonical-stream comparison across 50-run batches). Running
    // test files sequentially keeps every worker responsive to Vitest's RPC
    // heartbeat; parallel workers starve it under full core saturation and
    // fail the run with a spurious "Timeout calling onTaskUpdate".
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/sim/**', 'src/shared/**'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
