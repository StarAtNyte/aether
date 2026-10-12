import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // Cap parallelism so a plain `vitest run` cannot saturate a laptop.
    maxWorkers: 2,
  },
});
