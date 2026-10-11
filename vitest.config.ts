import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Command/AI modules read config at import time; isolate each file so one
    // suite's env mutations cannot leak into another.
    pool: 'forks',
    testTimeout: 30_000,
  },
});
