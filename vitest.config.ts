import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'scripts/bench/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // Cap parallelism so a plain `vitest run` cannot saturate a laptop.
    maxWorkers: 2,
    // Tests never fetch or run the depth or perception networks (measure_room, perceive_photo); their tests inject fakes.
    env: { AETHER_DEPTH: 'off', AETHER_PERCEPTION: 'off' },
  },
});
