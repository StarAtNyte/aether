import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'scripts/bench/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // Cap parallelism so a plain `vitest run` cannot saturate a laptop.
    maxWorkers: 2,
    // Tests never fetch or run the depth network (the photo flow's measure_room); depth tests inject a fake.
    env: { AETHER_DEPTH: 'off' },
  },
});
